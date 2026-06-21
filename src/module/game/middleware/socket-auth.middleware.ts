import { Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';

type SocketJwtPayload = {
  sub?: string;
  userId?: number;
};

interface AuthenticatedSocket extends Socket {
  data: {
    userId?: number;
  };
}

export function createSocketAuthMiddleware(jwtService: JwtService) {
  return (socket: Socket, next: (err?: Error) => void) => {
    try {
      const authToken = socket.handshake.auth.token as unknown;
      const headerToken = socket.handshake.headers.authorization?.split(' ')[1];
      const token = typeof authToken === 'string' ? authToken : headerToken;

      if (!token) {
        return next(new Error('Thiếu token xác thực'));
      }

      const payload = jwtService.verify<SocketJwtPayload>(token, {
        ignoreExpiration: true,
      });
      const userId = Number(payload.sub ?? payload.userId);

      if (!Number.isInteger(userId)) {
        return next(new Error('Token không hợp lệ'));
      }

      const authenticatedSocket = socket as AuthenticatedSocket;
      authenticatedSocket.data.userId = userId;

      next();
    } catch {
      next(new Error('Token không hợp lệ'));
    }
  };
}
