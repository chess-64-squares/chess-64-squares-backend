import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { randomInt } from 'crypto';
import { v4 as uuidv4 } from 'uuid';

import { UserService } from '../user/user.service';
import { RedisService } from '../redis/redis.service';
import { MailService } from '../mail/mail.service';

import { LoginReqDto } from './dto/login-req.dto';
import { RegisterReqDto } from './dto/register-req';
import { VerifyEmailReqDto } from './dto/verify-email-req';
import { JwtPayload } from './types/jwt-payload.type';

import { UserStatus } from '../../common/enum/user-status.enum';
import { AppException, ErrorCode } from '../../common/exceptions';
import { LoginResDto } from './dto';
import { ApiResponse } from '../../common/response/api-response';

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
    private readonly redisService: RedisService,
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
  ) { }

  async register(registerReqDto: RegisterReqDto) {
    const existingUser = await this.userService.findByEmail(registerReqDto.email);

    if (existingUser) {
      throw new BadRequestException('Email đã được sử dụng');
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
      Number(this.configService.get<string>('EMAIL_VERIFY_TOKEN_TTL_SECONDS'))
    );

    await this.mailService.sendVerifyEmail(user.email, otp);

    return {
      message: 'Đăng kí thành công. Vui lòng kiểm tra email để lấy mã OTP',
      user: {
        id: user.userId,
        email: user.email,
        username: user.username,
        isEmailVerified: user.isEmailVerified,
      },
    };
  }

  async verifyEmail(verifyEmailReqDto: VerifyEmailReqDto) {
    const { email, otp } = verifyEmailReqDto;

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
      return {
        message: 'Email đã được xác thực trước đó',
      };
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

    return {
      message: 'Xác thực email thành công',
    };
  }

  async resendVerifyOtp(email: string) {
    if (!email) {
      throw new BadRequestException('Email không được để trống');
    }

    const user = await this.userService.findByEmail(email);

    if (!user) {
      throw new BadRequestException('Email không tồn tại');
    }

    if (user.isEmailVerified) {
      return {
        message: 'Email đã được xác thực trước đó',
      };
    }

    const otp = this.generateOtp();

    const redisKey = this.getEmailOtpKey(email);

    await this.redisService.set(
      redisKey,
      otp,
      Number(this.configService.get<string>('EMAIL_VERIFY_TOKEN_TTL_SECONDS')),
    );

    await this.mailService.sendVerifyEmail(email, otp);

    return {
      message: 'Đã gửi lại OTP xác thực email',
    };
  }

  async login(loginReqDto: LoginReqDto) {
    const { username, password } = loginReqDto;

    let user = await this.userService.findByUsername(username);

    if (!user) {
      user = await this.userService.findByEmail(username);
    }

    if (!user) {
      throw new AppException(ErrorCode.INVALID_USERNAME, 'Invalid username or email');
    }

    const isPasswordValid = await bcrypt.compare(
      loginReqDto.password,
      user.password,
    );

    if (!isPasswordValid) {
      throw new AppException(ErrorCode.INVALID_PASSWORD, 'Invalid password');
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new AppException(ErrorCode.ACCOUNT_NOT_ACTIVE, 'Account is not active');
    }

    if (!user.isEmailVerified) {
      throw new AppException(ErrorCode.EMAIL_NOT_VERIFIED, 'Please verify your email before logging in');
    }

    const token = await this.generateToken(user.userId, user.username);

    const loginRes: LoginResDto = { token };

    return ApiResponse.success(loginRes, 'Successfully');
  }

  async logout(userId: number, jti: string) {
    const redisKey = this.getRedisTokenKey(userId, jti);

    await this.redisService.del(redisKey);

    return {
      message: 'Đăng xuất thành công',
    };
  }

  async validateToken(payload: JwtPayload): Promise<boolean> {
    const redisKey = this.getRedisTokenKey(parseInt(payload.sub), payload.jti);

    const tokenInRedis = await this.redisService.get(redisKey);

    return !!tokenInRedis;
  }

  private async generateToken(userId: number, email: string): Promise<string> {
    const jti = uuidv4();

    const payload: JwtPayload = {
      sub: userId + '',
      email,
      jti,
    };

    const accessToken = await this.jwtService.signAsync(payload);

    const redisKey = this.getRedisTokenKey(userId, jti);

    await this.redisService.set(
      redisKey,
      accessToken,
      Number(this.configService.get<string>('JWT_TTL_SECONDS'))
    );

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
}