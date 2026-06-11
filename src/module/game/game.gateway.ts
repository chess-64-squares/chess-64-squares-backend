// src/modules/game/game.gateway.ts
import {
    WebSocketGateway,
    WebSocketServer,
    SubscribeMessage,
    OnGatewayConnection,
    OnGatewayDisconnect,
    ConnectedSocket,
    MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { UseGuards, Logger } from '@nestjs/common';

import { GameService } from './game.service';
import { FindMatchDto } from './dto/find-match.dto';
import { MakeMoveDto } from './dto/make-move.dto';
import { WsJwtGuard } from '../auth/guards/ws-jwt.guard'; // điều chỉnh theo guard hiện có của bạn
import { GameStatus } from '../../common/enum/game-status.enum';

interface AuthenticatedSocket extends Socket {
    data: {
        userId: number;
    };
}

@WebSocketGateway({
    cors: {
        origin: '*', // thay bằng domain frontend thực tế khi deploy
    },
    namespace: '/game',
})
export class GameGateway implements OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer()
    server: Server;

    private readonly logger = new Logger(GameGateway.name);

    // Map userId -> socketId, dùng để gửi message riêng cho từng user
    private userSocketMap: Map<number, string> = new Map();

    constructor(private readonly gameService: GameService) {}

    handleConnection(client: AuthenticatedSocket) {
        // userId nên được gán từ middleware xác thực JWT (xem ghi chú bên dưới)
        const userId = client.data?.userId;
        if (userId) {
            this.userSocketMap.set(userId, client.id);
            this.logger.log(`User ${userId} connected with socket ${client.id}`);
        } else {
            this.logger.warn(`Socket ${client.id} connected without userId, disconnecting`);
            client.disconnect();
        }
    }

    handleDisconnect(client: AuthenticatedSocket) {
        const userId = client.data?.userId;
        if (!userId) return;

        this.logger.log(`User ${userId} disconnected`);

        // Xóa khỏi hàng đợi ghép trận nếu đang chờ
        this.gameService.removeFromQueue(userId);

        // Xóa khỏi map
        this.userSocketMap.delete(userId);

        // TODO: nếu user đang trong 1 trận in_progress, có thể bắt đầu
        // đếm ngược thời gian reconnect trước khi gọi forfeitByDisconnect
    }

    /**
     * Client gửi yêu cầu ghép đấu.
     * event: 'findMatch'
     * payload: { gameModeId: number }
     */
    @SubscribeMessage('findMatch')
    async handleFindMatch(
        @ConnectedSocket() client: AuthenticatedSocket,
        @MessageBody() dto: FindMatchDto,
    ) {
        const userId = client.data.userId;

        try {
            const game = await this.gameService.findMatch(
                userId,
                dto.gameModeId,
                client.id,
            );

            if (!game) {
                // Chưa tìm được đối thủ -> báo cho client đang chờ
                client.emit('matchmakingStatus', { status: 'waiting' });
                return;
            }

            // Tìm thấy trận -> join cả 2 người chơi vào room theo gameId
            const room = `game_${game.gameId}`;

            const whiteSocketId = this.userSocketMap.get(game.playerWhite.userId);
            const blackSocketId = this.userSocketMap.get(game.playerBlack.userId);

            if (whiteSocketId) {
                this.server.sockets.sockets.get(whiteSocketId)?.join(room);
            }
            if (blackSocketId) {
                this.server.sockets.sockets.get(blackSocketId)?.join(room);
            }

            // Gửi thông tin trận đấu cho cả 2 người chơi (mỗi người biết mình cầm quân gì)
            this.server.to(room).emit('matchFound', {
                gameId: game.gameId,
                fen: game.fen,
                playerWhite: {
                    userId: game.playerWhite.userId,
                    username: game.playerWhite.username, // điều chỉnh field theo User entity
                },
                playerBlack: {
                    userId: game.playerBlack.userId,
                    username: game.playerBlack.username,
                },
                status: game.status,
            });
        } catch (error) {
            client.emit('error', { message: 'Đã xảy ra lỗi khi tìm trận' });
        }
    }

    /**
     * Client hủy yêu cầu ghép đấu.
     * event: 'cancelFindMatch'
     */
    @SubscribeMessage('cancelFindMatch')
    handleCancelFindMatch(@ConnectedSocket() client: AuthenticatedSocket) {
        const userId = client.data.userId;
        this.gameService.removeFromQueue(userId);
        client.emit('matchmakingStatus', { status: 'cancelled' });
    }

    /**
     * Client thực hiện một nước đi.
     * event: 'makeMove'
     * payload: { gameId, from, to, promotion? }
     */
    @SubscribeMessage('makeMove')
    async handleMakeMove(
        @ConnectedSocket() client: AuthenticatedSocket,
        @MessageBody() dto: MakeMoveDto,
    ) {
        const userId = client.data.userId;
        const room = `game_${dto.gameId}`;

        try {
            const result = await this.gameService.makeMove(userId, dto);

            // Gửi nước đi mới cho cả 2 người chơi trong room
            this.server.to(room).emit('moveMade', {
                gameId: result.game.gameId,
                from: dto.from,
                to: dto.to,
                san: result.san,
                fen: result.game.fen,
            });

            // Nếu ván kết thúc -> thông báo riêng
            if (result.status in [GameStatus.WHITE_WINS, GameStatus.BLACK_WINS, GameStatus.DRAW, GameStatus.ABORTED]) {
                this.server.to(room).emit('gameOver', {
                    gameId: result.game.gameId,
                    reasonForEnding: result.reasonForEnding,
                    status: result.status,
                });
            }
        } catch (error) {
            // Chỉ báo lỗi cho người gửi nước đi sai
            client.emit('moveError', { message: 'Đã xảy ra lỗi khi thực hiện nước đi' });
        }
    }

    /**
     * Client xin đầu hàng.
     * event: 'resign'
     * payload: { gameId: number }
     */
    @SubscribeMessage('resign')
    async handleResign(
        @ConnectedSocket() client: AuthenticatedSocket,
        @MessageBody() data: { gameId: number },
    ) {
        const userId = client.data.userId;
        const room = `game_${data.gameId}`;

        try {
            const result = await this.gameService.resign(userId, data.gameId);

            this.server.to(room).emit('gameOver', {
                gameId: result.game.gameId,
                reasonForEnding: result.game.reasonForEnding,
                status: result.game.status,
            });
        } catch (error) {
            client.emit('error', { message: 'Đã xảy ra lỗi khi đầu hàng' });
        }
    }

    /**
     * Client join lại room của 1 trận đang diễn ra (vd sau khi reconnect hoặc
     * load lại trang).
     * event: 'joinGame'
     * payload: { gameId: number }
     */
    @SubscribeMessage('joinGame')
    async handleJoinGame(
        @ConnectedSocket() client: AuthenticatedSocket,
        @MessageBody() data: { gameId: number },
    ) {
        const userId = client.data.userId;

        try {
            const game = await this.gameService.getGameById(data.gameId);

            const isPlayer =
                game.playerWhite.userId === userId || game.playerBlack.userId === userId;

            if (!isPlayer) {
                client.emit('error', { message: 'Bạn không phải người chơi trong trận này' });
                return;
            }

            const room = `game_${data.gameId}`;
            client.join(room);

            client.emit('gameState', {
                gameId: game.gameId,
                fen: game.fen,
                status: game.status,
                playerWhite: {
                    userId: game.playerWhite.userId,
                    username: game.playerWhite.username,
                },
                playerBlack: {
                    userId: game.playerBlack.userId,
                    username: game.playerBlack.username,
                },
            });
        } catch (error) {
            client.emit('error', { message: 'Đã xảy ra lỗi khi tìm trận' });
        }
    }
}