import { UseFilters, UsePipes, ValidationPipe } from '@nestjs/common';
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
import { IsIn } from 'class-validator';
import type { Namespace } from 'socket.io';
import { GameActionError, TIME_CONTROLS } from 'chess-64-squares-shared';
import { wsAuthMiddleware, type AuthedSocket } from '../common/auth/ws-auth';
import { WsExceptionsFilter } from '../common/filters/ws-exceptions.filter';
import { LIMITS, RateLimiterService } from '../common/redis/rate-limiter.service';
import type { AppConfig } from '../config/configuration';
import { MetricsService } from '../metrics/metrics.service';
import { GatewayRegistry } from '../queues/gateway-registry.service';
import { MATCHMAKING_NAMESPACE, MatchmakingService } from './matchmaking.service';

class JoinQueueWsDto {
  @IsIn(TIME_CONTROLS.map((tc) => tc.id))
  timeControlId!: string;
}

const wsValidation = new ValidationPipe({
  whitelist: true,
  transform: true,
  exceptionFactory: (errors) =>
    new WsException({
      code: 'VALIDATION',
      message: errors.flatMap((e) => Object.values(e.constraints ?? {})).join('; '),
    }),
});

@UseFilters(WsExceptionsFilter)
@UsePipes(wsValidation)
@WebSocketGateway({ namespace: MATCHMAKING_NAMESPACE })
export class MatchmakingGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Namespace;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly registry: GatewayRegistry,
    private readonly matchmaking: MatchmakingService,
    private readonly rateLimiter: RateLimiterService,
    private readonly metrics: MetricsService,
  ) {}

  afterInit(server: Namespace): void {
    server.use(
      wsAuthMiddleware(this.jwt, this.config.get('jwt', { infer: true }).accessSecret),
    );
    this.registry.register(MATCHMAKING_NAMESPACE, server);
  }

  handleConnection(): void {
    this.metrics.wsConnections.inc({ namespace: MATCHMAKING_NAMESPACE });
  }

  async handleDisconnect(socket: AuthedSocket): Promise<void> {
    this.metrics.wsConnections.dec({ namespace: MATCHMAKING_NAMESPACE });
    // leaving the page = leaving the queue (unless another tab is queued,
    // which re-joins on its own)
    if (socket.data.user) await this.matchmaking.leave(socket.data.user.id);
  }

  @SubscribeMessage('matchmaking:joinQueue')
  async onJoinQueue(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() dto: JoinQueueWsDto,
  ): Promise<void> {
    const ok = await this.rateLimiter.consume(
      `mmjoin:${socket.data.user.id}`,
      LIMITS.matchmakingJoin,
    );
    if (!ok) throw new GameActionError('RATE_LIMITED', 'Too many queue joins — wait a moment');
    await this.matchmaking.join(socket.data.user, dto.timeControlId);
  }

  @SubscribeMessage('matchmaking:leaveQueue')
  async onLeaveQueue(@ConnectedSocket() socket: AuthedSocket): Promise<void> {
    await this.matchmaking.leave(socket.data.user.id);
    socket.emit('matchmaking:status', {
      status: 'cancelled',
      timeControlId: '',
      waitSeconds: 0,
      ratingWindow: 0,
    });
  }
}
