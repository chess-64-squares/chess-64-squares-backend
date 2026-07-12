import { JwtService } from '@nestjs/jwt';
import type { Socket } from 'socket.io';
import type { AccessTokenPayload, AuthedUser } from './jwt-payload';

export interface AuthedSocket extends Socket {
  data: Socket['data'] & { user: AuthedUser; gameIds?: Set<string> };
}

/**
 * Namespace-level handshake middleware: verifies the JWT from
 * `socket.handshake.auth.token`, attaches `socket.data.user`, and puts the
 * socket in its private `user:<id>` room. Rejects the connection otherwise.
 */
export function wsAuthMiddleware(jwt: JwtService, accessSecret: string) {
  return async (socket: Socket, next: (err?: Error) => void): Promise<void> => {
    try {
      const token =
        (socket.handshake.auth?.token as string | undefined) ??
        (typeof socket.handshake.headers.authorization === 'string' &&
        socket.handshake.headers.authorization.startsWith('Bearer ')
          ? socket.handshake.headers.authorization.slice(7)
          : undefined);
      if (!token) return next(new Error('UNAUTHORIZED'));
      const payload = await jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: accessSecret,
      });
      (socket as AuthedSocket).data.user = {
        id: payload.sub,
        username: payload.username,
        isGuest: payload.isGuest,
      };
      await socket.join(`user:${payload.sub}`);
      next();
    } catch {
      next(new Error('UNAUTHORIZED'));
    }
  };
}
