import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { AuthService } from '../auth.service';
import { JwtPayload } from '../types/jwt-payload.type';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly authService: AuthService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'secret-key',
    });
  }

  async validate(payload: JwtPayload) {
    const isTokenValid = await this.authService.validateToken(payload);

    if (!isTokenValid) {
      throw new UnauthorizedException('Token không hợp lệ hoặc đã đăng xuất');
    }

    return {
      userId: payload.sub,
      email: payload.email,
      jti: payload.jti,
    };
  }
}