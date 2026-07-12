import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { AppConfig } from '../../config/configuration';
import type { AccessTokenPayload, AuthedUser } from './jwt-payload';

export const IS_PUBLIC = 'isPublic';
/** Route requires no authentication. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const NO_GUESTS = 'noGuests';
/** Route rejects guest accounts (friends, profile edits, …). */
export const NoGuests = () => SetMetadata(NO_GUESTS, true);

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request & { user?: AuthedUser }>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing access token');
    }

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(header.slice(7), {
        secret: this.config.get('jwt', { infer: true }).accessSecret,
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }

    req.user = { id: payload.sub, username: payload.username, isGuest: payload.isGuest };

    const noGuests = this.reflector.getAllAndOverride<boolean>(NO_GUESTS, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (noGuests && req.user.isGuest) {
      throw new ForbiddenException('Create an account to use this feature');
    }
    return true;
  }
}
