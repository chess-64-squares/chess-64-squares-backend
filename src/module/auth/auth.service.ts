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
import { RedisService } from '../../redis/redis.service';
import { MailService } from '../mail/mail.service';

import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { JwtPayload } from './types/jwt-payload.type';

import { UserStatus } from '../../common/enum/user-status.enum';

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
    private readonly redisService: RedisService,
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
  ) {}

  async register(registerDto: RegisterDto) {
    const existingUser = await this.userService.findByEmail(registerDto.email);

    if (existingUser) {
      throw new BadRequestException('Email đã được sử dụng');
    }

    const hashedPassword = await bcrypt.hash(registerDto.password, 10);

    const user = await this.userService.create({
      email: registerDto.email,
      username: registerDto.username,
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

  async verifyEmail(verifyEmailDto: VerifyEmailDto) {
    const { email, otp } = verifyEmailDto;

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

  async login(loginDto: LoginDto) {
    const user = await this.userService.findByEmail(loginDto.email);

    if (!user) {
      throw new UnauthorizedException('Email hoặc mật khẩu không đúng');
    }

    const isPasswordValid = await bcrypt.compare(
      loginDto.password,
      user.password,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Email hoặc mật khẩu không đúng');
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Tài khoản đã bị khóa');
    }

    if (!user.isEmailVerified) {
      throw new UnauthorizedException(
        'Vui lòng xác thực email trước khi đăng nhập',
      );
    }

    const token = await this.generateToken(user.userId, user.email);

    return {
      message: 'Đăng nhập thành công',
      user: {
        id: user.userId,
        email: user.email,
        username: user.username,
      },
      accessToken: token.accessToken,
    };
  }

  async logout(userId: string, jti: string) {
    const redisKey = this.getRedisTokenKey(userId, jti);

    await this.redisService.del(redisKey);

    return {
      message: 'Đăng xuất thành công',
    };
  }

  async validateToken(payload: JwtPayload): Promise<boolean> {
    const redisKey = this.getRedisTokenKey(payload.sub, payload.jti);

    const tokenInRedis = await this.redisService.get(redisKey);

    return !!tokenInRedis;
  }

  private async generateToken(userId: string, email: string) {
    const jti = uuidv4();

    const payload: JwtPayload = {
      sub: userId,
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

    return {
      accessToken,
    };
  }

  private generateOtp(): string {
    return randomInt(100000, 999999).toString();
  }

  private getEmailOtpKey(email: string): string {
    return `auth:email-verify:${email}:otp`;
  }

  private getRedisTokenKey(userId: string, jti: string): string {
    return `auth:user:${userId}:token:${jti}`;
  }
}