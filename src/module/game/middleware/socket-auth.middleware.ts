import { Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';

export function createSocketAuthMiddleware(jwtService: JwtService) {
    return (socket: Socket, next: (err?: Error) => void) => {
        try {
            const token =
                socket.handshake.auth?.token ||
                socket.handshake.headers?.authorization?.split(' ')[1];

            if (!token) {
                return next(new Error('Thiếu token xác thực'));
            }

            const payload = jwtService.verify(token); // điều chỉnh secret/options theo cấu hình hiện tại
            const userId = Number(payload.sub ?? payload.userId);

            if (!Number.isInteger(userId)) {
                return next(new Error('Token không hợp lệ'));
            }

            (socket as any).data = { userId };

            next();
        } catch (error) {
            next(new Error('Token không hợp lệ'));
        }
    };
}
