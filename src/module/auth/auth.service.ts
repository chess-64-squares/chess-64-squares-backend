import { BadRequestException, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { randomInt } from 'crypto';
import { v4 as uuidv4 } from 'uuid';

import { UserService } from '../user/user.service';
import { RedisService } from '../redis/redis.service';
import { MailService } from '../mail/mail.service';

import {
  LoginReqDto,
  RegisterReqDto,
  VerifyEmailReqDto,
  LoginResDto,
} from './dto';
import { JwtPayload } from './types/jwt-payload.type';

import { UserStatus } from '../../common/enum/user-status.enum';
import { AppException, ErrorCode } from '../../common/exceptions';

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
    private readonly redisService: RedisService,
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
  ) {}

  async register(registerReqDto: RegisterReqDto): Promise<void> {
    const existingUser = await this.userService.findByEmail(
      registerReqDto.email,
    );

    if (existingUser) {
      throw new AppException(ErrorCode.EMAIL_EXISTS, 'Email already exists');
    }

    const existingUsername = await this.userService.findByUsername(
      registerReqDto.username,
    );

    if (existingUsername) {
      throw new AppException(
        ErrorCode.USERNAME_EXISTS,
        'Username already exists',
      );
    }

    const hashedPassword = await bcrypt.hash(registerReqDto.password, 10);

    const user = await this.userService.create({
      email: registerReqDto.email,
      username: registerReqDto.username,
      password: hashedPassword,
      isEmailVerified: false,
    });

    const otp = this.generateOtp();

    const redisKey = this.getEmailOtpKey(user.email);

    await this.redisService.set(
      redisKey,
      otp,
      Number(this.configService.get<string>('EMAIL_VERIFY_TOKEN_TTL_SECONDS')),
    );

    await this.mailService.sendVerifyEmail(
      user.email,
      this.createEmailVerifyToken(user.email, otp),
    );
  }

  async verifyEmail(verifyEmailReqDto: VerifyEmailReqDto): Promise<void> {
    let { email, otp } = verifyEmailReqDto;

    if (verifyEmailReqDto.token) {
      const decoded = this.parseEmailVerifyToken(verifyEmailReqDto.token);
      email = decoded.email;
      otp = decoded.otp;
    }

    if (!email) {
      throw new BadRequestException('Email không được để trống');
    }

    if (!otp) {
      throw new BadRequestException('OTP không được để trống');
    }

    const user = await this.userService.findByEmail(email);

    if (!user) {
      throw new BadRequestException('Email không tồn tại');
    }

    if (user.isEmailVerified) {
      throw new AppException(
        ErrorCode.EMAIL_VERIFIED,
        'Email is already verified',
      );
    }

    const redisKey = this.getEmailOtpKey(email);

    const otpInRedis = await this.redisService.get(redisKey);

    if (!otpInRedis) {
      throw new BadRequestException('OTP đã hết hạn hoặc không tồn tại');
    }

    if (otpInRedis !== otp) {
      throw new BadRequestException('OTP không đúng');
    }

    await this.userService.updateEmailVerified(user.userId);

    await this.redisService.del(redisKey);
  }

  async resendVerifyOtp(email: string): Promise<void> {
    if (!email) {
      throw new BadRequestException('Email không được để trống');
    }

    const user = await this.userService.findByEmail(email);

    if (!user) {
      throw new BadRequestException('Email không tồn tại');
    }

    if (user.isEmailVerified) {
      throw new AppException(
        ErrorCode.EMAIL_VERIFIED,
        'Email is already verified',
      );
    }

    const otp = this.generateOtp();

    const redisKey = this.getEmailOtpKey(email);

    await this.redisService.set(
      redisKey,
      otp,
      Number(this.configService.get<string>('EMAIL_VERIFY_TOKEN_TTL_SECONDS')),
    );

    await this.mailService.sendVerifyEmail(
      email,
      this.createEmailVerifyToken(email, otp),
    );
  }

  async login(loginReqDto: LoginReqDto): Promise<LoginResDto> {
    const { username, password } = loginReqDto;

    let user = await this.userService.findByUsername(username);

    if (!user) {
      user = await this.userService.findByEmail(username);
    }

    if (!user) {
      throw new AppException(
        ErrorCode.INVALID_USERNAME,
        'Invalid username or email',
      );
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      throw new AppException(ErrorCode.INVALID_PASSWORD, 'Invalid password');
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new AppException(
        ErrorCode.ACCOUNT_NOT_ACTIVE,
        'Account is not active',
      );
    }

    if (!user.isEmailVerified) {
      throw new AppException(
        ErrorCode.EMAIL_NOT_VERIFIED,
        'Please verify your email before logging in',
      );
    }

    const token = await this.generateToken(user.userId, user.username);

    const loginRes: LoginResDto = { token };

    return loginRes;
  }

  async logout(userId: number, jti: string): Promise<void> {
    const redisKey = this.getRedisTokenKey(userId, jti);

    await this.redisService.del(redisKey);
  }

  async validateToken(payload: JwtPayload): Promise<boolean> {
    const redisKey = this.getRedisTokenKey(parseInt(payload.sub), payload.jti);

    const tokenInRedis = await this.redisService.get(redisKey);

    return !!tokenInRedis;
  }

  private async generateToken(userId: number, email: string): Promise<string> {
    const jti = uuidv4();

    const payload: JwtPayload = {
      sub: userId.toString(),
      email,
      jti,
    };

    const accessToken = await this.jwtService.signAsync(payload);

    const redisKey = this.getRedisTokenKey(userId, jti);

    await this.redisService.set(redisKey, accessToken);

    return accessToken;
  }

  private generateOtp(): string {
    return randomInt(100000, 999999).toString();
  }

  private getEmailOtpKey(email: string): string {
    return `auth:email-verify:${email}:otp`;
  }

  private getRedisTokenKey(userId: number, jti: string): string {
    return `auth:user:${userId}:token:${jti}`;
  }

  private createEmailVerifyToken(email: string, otp: string): string {
    return Buffer.from(JSON.stringify({ email, otp })).toString('base64url');
  }

  private parseEmailVerifyToken(token: string): { email: string; otp: string } {
    try {
      const parsed = JSON.parse(
        Buffer.from(token, 'base64url').toString('utf8'),
      ) as unknown;
      if (
        !parsed ||
        typeof parsed !== 'object' ||
        !('email' in parsed) ||
        !('otp' in parsed)
      ) {
        throw new BadRequestException('Invalid verification token');
      }
      const { email, otp } = parsed;
      if (typeof email !== 'string' || typeof otp !== 'string') {
        throw new BadRequestException('Invalid verification token');
      }
      return { email, otp };
    } catch {
      throw new BadRequestException('Invalid verification token');
    }
  }
}
