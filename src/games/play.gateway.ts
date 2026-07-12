import { Logger, UseFilters, UsePipes, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import type { Namespace } from 'socket.io';
import {
  GameActionError,
  GameStateStore,
  PLAY_NAMESPACE,
  sanitizeChatMessage,
  toSnapshot,
} from 'chess-64-squares-shared';
import { wsAuthMiddleware, type AuthedSocket } from '../common/auth/ws-auth';
import { WsExceptionsFilter } from '../common/filters/ws-exceptions.filter';
import { LIMITS, RateLimiterService } from '../common/redis/rate-limiter.service';
import type { AppConfig } from '../config/configuration';
import { MetricsService } from '../metrics/metrics.service';
import { GatewayRegistry } from '../queues/gateway-registry.service';
import { ChatService } from '../chat/chat.service';
import { GameActionsService } from './game-actions.service';
import { GamesService } from './games.service';
import { GameChatWsDto, GameJoinWsDto, GameMoveWsDto } from './dto/ws.dto';

const wsValidation = new ValidationPipe({
  whitelist: true,
  transform: true,
  exceptionFactory: (errors) =>
    new WsException({
      code: 'VALIDATION',
      message: errors
        .flatMap((e) => Object.values(e.constraints ?? {}))
        .join('; '),
    }),
});

const CLOCK_SYNC_INTERVAL_MS = 10_000;

/**
 * The live-gameplay namespace. Thin by design: every handler is
 * rate-limit → validate → delegate to GameActionsService (which runs the
 * shared, pure game logic against Redis) → effects broadcast themselves.
 */
@UseFilters(WsExceptionsFilter)
@UsePipes(wsValidation)
@WebSocketGateway({ namespace: PLAY_NAMESPACE })
export class PlayGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(PlayGateway.name);
  private clockSyncTimer?: NodeJS.Timeout;

  @WebSocketServer()
  server!: Namespace;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly registry: GatewayRegistry,
    private readonly rateLimiter: RateLimiterService,
    private readonly store: GameStateStore,
    private readonly actions: GameActionsService,
    private readonly gamesService: GamesService,
    private readonly chatService: ChatService,
    private readonly metrics: MetricsService,
  ) {}

  afterInit(server: Namespace): void {
    server.use(
      wsAuthMiddleware(this.jwt, this.config.get('jwt', { infer: true }).accessSecret),
    );
    this.registry.register(PLAY_NAMESPACE, server);

    // periodic clock sync for sockets on THIS instance (clients interpolate
    // between syncs; every move also carries fresh clocks)
    this.clockSyncTimer = setInterval(() => {
      void this.broadcastClockSyncs();
    }, CLOCK_SYNC_INTERVAL_MS);
    this.clockSyncTimer.unref?.();
  }

  handleConnection(socket: AuthedSocket): void {
    socket.data.gameIds = new Set();
    this.metrics.wsConnections.inc({ namespace: PLAY_NAMESPACE });
  }

  async handleDisconnect(socket: AuthedSocket): Promise<void> {
    this.metrics.wsConnections.dec({ namespace: PLAY_NAMESPACE });
    const user = socket.data.user;
    if (!user) return;
    try {
      for (const gameId of socket.data.gameIds ?? []) {
        // only mark disconnected when NO other socket of this user remains in
        // the room (multi-tab safe; fetchSockets spans instances via adapter)
        const room = `game:${gameId}`;
        const remaining = await this.server.in(room).fetchSockets();
        const stillThere = remaining.some(
          (s) => (s.data as AuthedSocket['data']).user?.id === user.id,
        );
        if (!stillThere) {
          await this.actions.markDisconnected(gameId, user.id);
        }
      }
    } catch (err) {
      this.logger.warn(`disconnect cleanup failed: ${(err as Error).message}`);
    }
  }

  // ── room membership ──────────────────────────────────────────────

  @SubscribeMessage('game:join')
  async onJoin(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() dto: GameJoinWsDto,
  ): Promise<void> {
    await this.enforce(socket, LIMITS.wsGeneric, `ws:${socket.data.user.id}`);
    const userId = socket.data.user.id;

    const state = await this.store.load(dto.gameId);
    if (state) {
      const isParticipant =
        state.white.userId === userId || state.black.userId === userId;
      if (!isParticipant && state.phase === 'active') {
        // no spectators on live games — room isolation, no data leaks
        throw new GameActionError('FORBIDDEN', 'You are not a player in this game');
      }
      await socket.join(`game:${dto.gameId}`);
      socket.data.gameIds!.add(dto.gameId);
      socket.emit('game:state', toSnapshot(state, userId, Date.now()));
      if (isParticipant) await this.actions.markReconnected(dto.gameId, userId);
      return;
    }

    // finished game (Redis expired) — serve from Postgres, room join is
    // harmless (no live events will flow)
    const snapshot = await this.gamesService.snapshot(dto.gameId, userId).catch(() => null);
    if (!snapshot) throw new GameActionError('NOT_FOUND', 'Game not found');
    await socket.join(`game:${dto.gameId}`);
    socket.data.gameIds!.add(dto.gameId);
    socket.emit('game:state', snapshot);
  }

  @SubscribeMessage('game:leave')
  async onLeave(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() dto: GameJoinWsDto,
  ): Promise<void> {
    await socket.leave(`game:${dto.gameId}`);
    socket.data.gameIds?.delete(dto.gameId);
  }

  // ── gameplay ─────────────────────────────────────────────────────

  @SubscribeMessage('game:move')
  async onMove(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() dto: GameMoveWsDto,
  ): Promise<void> {
    await this.enforce(socket, LIMITS.move, `move:${socket.data.user.id}`);
    await this.actions.applyMove(dto.gameId, { userId: socket.data.user.id }, {
      from: dto.from,
      to: dto.to,
      promotion: dto.promotion,
    });
  }

  @SubscribeMessage('game:resign')
  async onResign(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() dto: GameJoinWsDto,
  ): Promise<void> {
    await this.enforce(socket, LIMITS.wsGeneric, `ws:${socket.data.user.id}`);
    await this.actions.resign(dto.gameId, socket.data.user.id);
  }

  @SubscribeMessage('game:abort')
  async onAbort(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() dto: GameJoinWsDto,
  ): Promise<void> {
    await this.enforce(socket, LIMITS.wsGeneric, `ws:${socket.data.user.id}`);
    await this.actions.abort(dto.gameId, socket.data.user.id);
  }

  @SubscribeMessage('game:draw:offer')
  async onDrawOffer(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() dto: GameJoinWsDto,
  ): Promise<void> {
    await this.enforce(socket, LIMITS.wsGeneric, `ws:${socket.data.user.id}`);
    await this.actions.offerDraw(dto.gameId, socket.data.user.id);
  }

  @SubscribeMessage('game:draw:accept')
  async onDrawAccept(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() dto: GameJoinWsDto,
  ): Promise<void> {
    await this.actions.acceptDraw(dto.gameId, socket.data.user.id);
  }

  @SubscribeMessage('game:draw:decline')
  async onDrawDecline(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() dto: GameJoinWsDto,
  ): Promise<void> {
    await this.actions.declineDraw(dto.gameId, socket.data.user.id);
  }

  // ── rematch ──────────────────────────────────────────────────────

  @SubscribeMessage('game:rematch:offer')
  async onRematchOffer(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() dto: GameJoinWsDto,
  ): Promise<void> {
    await this.enforce(socket, LIMITS.wsGeneric, `ws:${socket.data.user.id}`);
    const state = await this.store.load(dto.gameId);
    // offering a rematch against the bot just starts the new game
    if (state?.botColor != null) {
      await this.gamesService.acceptRematch(dto.gameId, socket.data.user.id);
      return;
    }
    await this.actions.offerRematch(dto.gameId, socket.data.user.id);
  }

  @SubscribeMessage('game:rematch:accept')
  async onRematchAccept(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() dto: GameJoinWsDto,
  ): Promise<void> {
    await this.enforce(socket, LIMITS.wsGeneric, `ws:${socket.data.user.id}`);
    await this.gamesService.acceptRematch(dto.gameId, socket.data.user.id);
  }

  @SubscribeMessage('game:rematch:decline')
  async onRematchDecline(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() dto: GameJoinWsDto,
  ): Promise<void> {
    await this.actions.declineRematch(dto.gameId, socket.data.user.id);
  }

  // ── chat ─────────────────────────────────────────────────────────

  @SubscribeMessage('game:chat:send')
  async onChat(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() dto: GameChatWsDto,
  ): Promise<void> {
    const user = socket.data.user;
    await this.enforce(socket, LIMITS.chat, `chat:${user.id}`);

    const state = await this.store.load(dto.gameId);
    const participant =
      state !== null &&
      (state.white.userId === user.id || state.black.userId === user.id);
    if (!participant) {
      throw new GameActionError('FORBIDDEN', 'Chat is for players of this game');
    }

    const message = sanitizeChatMessage(dto.message);
    if (!message) return;

    // persistence is fire-and-forget: chat must never block gameplay
    void this.chatService
      .save(dto.gameId, user.id, message)
      .catch((err) => this.logger.warn(`chat persist failed: ${err.message}`));

    this.server.to(`game:${dto.gameId}`).emit('game:chat:message', {
      gameId: dto.gameId,
      userId: user.id,
      username: user.username,
      message,
      sentAt: new Date().toISOString(),
    });
  }

  // ── helpers ──────────────────────────────────────────────────────

  private async enforce(
    socket: AuthedSocket,
    limit: (typeof LIMITS)[keyof typeof LIMITS],
    key: string,
  ): Promise<void> {
    const ok = await this.rateLimiter.consume(key, limit);
    if (!ok) {
      this.metrics.wsErrors.inc({ code: 'RATE_LIMITED' });
      throw new GameActionError('RATE_LIMITED', 'Slow down');
    }
  }

  private async broadcastClockSyncs(): Promise<void> {
    try {
      const rooms = this.server.adapter?.rooms;
      if (!rooms) return;
      for (const room of rooms.keys()) {
        if (!room.startsWith('game:')) continue;
        const gameId = room.slice(5);
        const state = await this.store.load(gameId);
        if (!state?.clock || state.phase !== 'active') continue;
        this.server.to(room).emit('game:clockSync', {
          gameId,
          whiteMs: state.clock.whiteMs,
          blackMs: state.clock.blackMs,
          running: state.ply >= 2 ? (state.fen.split(' ')[1] as 'w' | 'b') : null,
          serverAt: Date.now(),
        });
      }
    } catch (err) {
      this.logger.debug(`clock sync sweep failed: ${(err as Error).message}`);
    }
  }
}
