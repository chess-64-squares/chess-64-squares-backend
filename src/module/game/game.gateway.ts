import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Namespace, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';

import { GameService } from './game.service';
import { FindMatchReqDto, MakeMoveReqDto } from './dto';
import { GameStatus } from '../../common/enum/game-status.enum';

interface AuthenticatedSocket extends Socket {
  data: {
    userId: number;
  };
}

type OfferType = 'draw' | 'resign';

@WebSocketGateway({
  cors: {
    origin: '*', // thay bằng domain frontend thực tế khi deploy
  },
  namespace: '/game',
})
export class GameGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Namespace;

  private readonly logger = new Logger(GameGateway.name);

  // Map userId -> socketId, dùng để gửi message riêng cho từng user
  private userSocketMap: Map<number, string> = new Map();
  private pendingOffers: Map<
    string,
    { gameId: number; fromUserId: number; toUserId: number; type: OfferType }
  > = new Map();

  constructor(private readonly gameService: GameService) {}

  handleConnection(client: AuthenticatedSocket) {
    // userId nên được gán từ middleware xác thực JWT (xem ghi chú bên dưới)
    const userId = client.data?.userId;
    if (userId) {
      this.userSocketMap.set(userId, client.id);
      this.logger.log(`User ${userId} connected with socket ${client.id}`);
    } else {
      this.logger.warn(
        `Socket ${client.id} connected without userId, disconnecting`,
      );
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
    @MessageBody() dto: FindMatchReqDto,
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
      const whiteSocket = whiteSocketId
        ? this.server.sockets.get(whiteSocketId)
        : undefined;
      const blackSocket = blackSocketId
        ? this.server.sockets.get(blackSocketId)
        : undefined;

      if (!whiteSocket || !blackSocket) {
        this.logger.warn(
          `Match ${game.gameId} created but a player socket is missing. white=${whiteSocketId ?? 'none'}, black=${blackSocketId ?? 'none'}`,
        );
      }

      if (whiteSocket) {
        await whiteSocket.join(room);
      }
      if (blackSocket) {
        await blackSocket.join(room);
      }

      // Gửi thông tin trận đấu cho cả 2 người chơi (mỗi người biết mình cầm quân gì)
      const payload = {
        gameId: game.gameId,
        fen: game.fen,
        playerWhite: {
          userId: game.playerWhite.userId,
          username: game.playerWhite.username, // điều chỉnh field theo User entity
          elo: game.playerWhite.elo,
        },
        playerBlack: {
          userId: game.playerBlack.userId,
          username: game.playerBlack.username,
          elo: game.playerBlack.elo,
        },
        gameMode: game.gameMode,
        playerWhiteElo: game.playerWhiteElo,
        playerBlackElo: game.playerBlackElo,
        playerWhiteEloChange: game.playerWhiteEloChange,
        playerBlackEloChange: game.playerBlackEloChange,
        status: game.status,
        reasonForEnding: game.reasonForEnding,
        date: game.date,
      };

      whiteSocket?.emit('matchFound', payload);
      blackSocket?.emit('matchFound', payload);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Đã xảy ra lỗi khi tìm trận';
      this.logger.error(
        `Find match failed for user ${userId}: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
      client.emit('error', { message });
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
    @MessageBody() dto: MakeMoveReqDto,
  ) {
    const userId = client.data.userId;

    try {
      const result = await this.gameService.makeMove(userId, dto);
      const room = `game_${result.game.gameId}`;

      // Gửi nước đi mới cho cả 2 người chơi trong room
      this.server.to(room).emit('moveMade', {
        gameId: result.game.gameId,
        from: dto.from,
        to: dto.to,
        san: result.san,
        fen: result.game.fen,
        moveCount: await this.gameService.getMoveCount(result.game.gameId),
      });

      // Nếu ván kết thúc -> thông báo riêng
      if (
        [
          GameStatus.WHITE_WINS,
          GameStatus.BLACK_WINS,
          GameStatus.DRAW,
          GameStatus.ABORTED,
        ].includes(result.game.status)
      ) {
        this.server.to(room).emit('gameOver', {
          gameId: result.game.gameId,
          reasonForEnding: result.game.reasonForEnding,
          status: result.game.status,
          playerWhiteEloChange: result.game.playerWhiteEloChange,
          playerBlackEloChange: result.game.playerBlackEloChange,
        });
      }
    } catch (error) {
      // Chỉ báo lỗi cho người gửi nước đi sai
      const message =
        error instanceof Error
          ? error.message
          : 'Đã xảy ra lỗi khi thực hiện nước đi';
      this.logger.error(
        `Make move failed for user ${userId}: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
      client.emit('moveError', { message });
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
      const game = await this.gameService.resign(userId, data.gameId);

      this.server.to(room).emit('gameOver', {
        gameId: game.gameId,
        reasonForEnding: game.reasonForEnding,
        status: game.status,
        playerWhiteEloChange: game.playerWhiteEloChange,
        playerBlackEloChange: game.playerBlackEloChange,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Đã xảy ra lỗi khi đầu hàng';
      this.logger.error(
        `Resign failed for user ${userId}: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
      client.emit('error', { message });
    }
  }

  @SubscribeMessage('requestGameAction')
  async handleRequestGameAction(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { gameId: number; type: OfferType },
  ) {
    const userId = client.data.userId;

    try {
      const game = await this.gameService.getGameById(data.gameId);
      const opponentId =
        game.playerWhite.userId === userId
          ? game.playerBlack.userId
          : game.playerWhite.userId;

      if (
        game.playerWhite.userId !== userId &&
        game.playerBlack.userId !== userId
      ) {
        client.emit('error', { message: 'You are not a player in this game' });
        return;
      }

      if (data.type !== 'draw' && data.type !== 'resign') {
        client.emit('error', { message: 'Invalid request type' });
        return;
      }

      const offerId = `${data.gameId}:${data.type}:${userId}:${Date.now()}`;
      this.pendingOffers.set(offerId, {
        gameId: data.gameId,
        fromUserId: userId,
        toUserId: opponentId,
        type: data.type,
      });

      const opponentSocketId = this.userSocketMap.get(opponentId);
      const opponentSocket = opponentSocketId
        ? this.server.sockets.get(opponentSocketId)
        : undefined;

      if (!opponentSocket) {
        this.pendingOffers.delete(offerId);
        client.emit('error', { message: 'Opponent is not connected' });
        return;
      }

      opponentSocket.emit('gameActionRequested', {
        offerId,
        gameId: data.gameId,
        type: data.type,
        fromUserId: userId,
      });
      client.emit('gameActionPending', { type: data.type });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed';
      this.logger.error(
        `Game action request failed for user ${userId}: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
      client.emit('error', { message });
    }
  }

  @SubscribeMessage('respondGameAction')
  async handleRespondGameAction(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { offerId: string; accepted: boolean },
  ) {
    const userId = client.data.userId;
    const offer = this.pendingOffers.get(data.offerId);

    if (!offer || offer.toUserId !== userId) {
      client.emit('error', { message: 'Request is no longer available' });
      return;
    }

    this.pendingOffers.delete(data.offerId);
    const requesterSocketId = this.userSocketMap.get(offer.fromUserId);
    const requesterSocket = requesterSocketId
      ? this.server.sockets.get(requesterSocketId)
      : undefined;

    if (!data.accepted) {
      requesterSocket?.emit('gameActionDeclined', { type: offer.type });
      client.emit('gameActionResponded', { type: offer.type, accepted: false });
      return;
    }

    const room = `game_${offer.gameId}`;

    try {
      const game =
        offer.type === 'draw'
          ? await this.gameService.drawByAgreement(userId, offer.gameId)
          : await this.gameService.resign(offer.fromUserId, offer.gameId);

      this.server.to(room).emit('gameOver', {
        gameId: game.gameId,
        reasonForEnding: game.reasonForEnding,
        status: game.status,
        playerWhite: game.playerWhite,
        playerBlack: game.playerBlack,
        playerWhiteEloChange: game.playerWhiteEloChange,
        playerBlackEloChange: game.playerBlackEloChange,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed';
      this.logger.error(
        `Game action response failed for user ${userId}: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
      client.emit('error', { message });
    }
  }

  @SubscribeMessage('abortGame')
  async handleAbortGame(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { gameId: number },
  ) {
    const userId = client.data.userId;
    const room = `game_${data.gameId}`;

    try {
      const game = await this.gameService.abortGame(userId, data.gameId);

      this.server.to(room).emit('gameOver', {
        gameId: game.gameId,
        reasonForEnding: game.reasonForEnding,
        status: game.status,
        playerWhiteEloChange: game.playerWhiteEloChange,
        playerBlackEloChange: game.playerBlackEloChange,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Could not abort game';
      this.logger.error(
        `Abort failed for user ${userId}: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
      client.emit('error', { message });
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
        game.playerWhite.userId === userId ||
        game.playerBlack.userId === userId;

      if (!isPlayer) {
        client.emit('error', {
          message: 'Bạn không phải người chơi trong trận này',
        });
        return;
      }

      const room = `game_${data.gameId}`;
      await client.join(room);

      client.emit('gameState', {
        gameId: game.gameId,
        fen: game.fen,
        status: game.status,
        playerWhite: {
          userId: game.playerWhite.userId,
          username: game.playerWhite.username,
          elo: game.playerWhite.elo,
        },
        playerBlack: {
          userId: game.playerBlack.userId,
          username: game.playerBlack.username,
          elo: game.playerBlack.elo,
        },
        gameMode: game.gameMode,
        playerWhiteElo: game.playerWhiteElo,
        playerBlackElo: game.playerBlackElo,
        playerWhiteEloChange: game.playerWhiteEloChange,
        playerBlackEloChange: game.playerBlackEloChange,
        reasonForEnding: game.reasonForEnding,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Đã xảy ra lỗi khi tìm trận';
      this.logger.error(
        `Join game failed for user ${userId}: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
      client.emit('error', { message });
    }
  }
}
