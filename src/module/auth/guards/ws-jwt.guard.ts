import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Socket } from 'socket.io';

type WsJwtPayload = {
  sub?: string;
  userId?: number;
};

interface AuthenticatedSocket extends Socket {
  data: {
    userId?: number;
  };
}

@Injectable()
export class WsJwtGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const client: Socket = context.switchToWs().getClient<Socket>();

    try {
      const token = this.extractToken(client);

      if (!token) {
        throw new UnauthorizedException('Thiếu token xác thực');
      }

      const payload = this.jwtService.verify<WsJwtPayload>(token, {
        ignoreExpiration: true,
      });
      const userId = Number(payload.sub ?? payload.userId);

      const authenticatedClient = client as AuthenticatedSocket;
      authenticatedClient.data.userId = userId;

      return true;
    } catch {
      throw new UnauthorizedException('Token không hợp lệ hoặc đã hết hạn');
    }
  }

  private extractToken(client: Socket): string | undefined {
    // Ưu tiên lấy từ auth payload khi connect
    const authToken = client.handshake.auth.token as unknown;
    if (typeof authToken === 'string') {
      return authToken;
    }

    // Fallback: lấy từ header Authorization
    const authHeader = client.handshake.headers?.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.split(' ')[1];
    }

    return undefined;
  }
}
