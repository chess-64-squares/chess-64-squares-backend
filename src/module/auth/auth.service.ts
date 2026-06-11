import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';

import { UsersService } from '../user/user.service';
import { RedisService } from '../../redis/redis.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtPayload } from './types/jwt-payload.type';
import { UserStatus } from '../../common/enum/user-status.enum';

@Injectable()
export class AuthService {
  private readonly JWT_EXPIRES_IN = '7d';

  private readonly JWT_TTL_SECONDS = 7 * 24 * 60 * 60;

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly redisService: RedisService,
  ) {}

  async register(registerDto: RegisterDto) {
    const existingUser = await this.usersService.findByEmail(registerDto.email);

    if (existingUser) {
      throw new BadRequestException('Email đã được sử dụng');
    }

    const hashedPassword = await bcrypt.hash(registerDto.password, 10);

    const user = await this.usersService.create({
      email: registerDto.email,
      username: registerDto.username,
      password: hashedPassword,
    });

    const token = await this.generateToken(user.userId, user.email);

    return {
      message: 'Đăng kí thành công',
      user: {
        id: user.userId,
        email: user.email,
        username: user.username,
      },
      accessToken: token.accessToken,
    };
  }

  async login(loginDto: LoginDto) {
    const user = await this.usersService.findByEmail(loginDto.email);

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

    const accessToken = await this.jwtService.signAsync(payload, {
      expiresIn: this.JWT_EXPIRES_IN,
    });

    const redisKey = this.getRedisTokenKey(userId, jti);

    await this.redisService.set(redisKey, accessToken, this.JWT_TTL_SECONDS);

    return {
      accessToken,
    };
  }

  private getRedisTokenKey(userId: string, jti: string): string {
    return `auth:user:${userId}:token:${jti}`;
  }
}