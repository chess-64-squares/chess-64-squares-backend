import { Logger, UseFilters, forwardRef, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Namespace } from 'socket.io';
import { wsAuthMiddleware, type AuthedSocket } from '../common/auth/ws-auth';
import { WsExceptionsFilter } from '../common/filters/ws-exceptions.filter';
import type { AppConfig } from '../config/configuration';
import { FriendsService } from '../friends/friends.service';
import { MetricsService } from '../metrics/metrics.service';
import { GatewayRegistry } from '../queues/gateway-registry.service';
import { PresenceService } from './presence.service';

export const PRESENCE_NAMESPACE = '/presence';
const REFRESH_INTERVAL_MS = 30_000;

/**
 * Connecting to /presence = "I'm online". No client events; the server pushes
 * presence:update to the user's FRIENDS only (never a global broadcast) and
 * presence:challenge when a friend challenges them.
 */
@UseFilters(WsExceptionsFilter)
@WebSocketGateway({ namespace: PRESENCE_NAMESPACE })
export class PresenceGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(PresenceGateway.name);
  private refreshTimer?: NodeJS.Timeout;

  @WebSocketServer()
  server!: Namespace;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly registry: GatewayRegistry,
    private readonly presence: PresenceService,
    @Inject(forwardRef(() => FriendsService))
    private readonly friends: FriendsService,
    private readonly metrics: MetricsService,
  ) {}

  afterInit(server: Namespace): void {
    server.use(
      wsAuthMiddleware(this.jwt, this.config.get('jwt', { infer: true }).accessSecret),
    );
    this.registry.register(PRESENCE_NAMESPACE, server);

    // keep presence TTLs alive for sockets on this instance
    this.refreshTimer = setInterval(() => {
      const ids = new Set<string>();
      for (const socket of this.server.sockets.values()) {
        const user = (socket as AuthedSocket).data.user;
        if (user) ids.add(user.id);
      }
      void this.presence.refresh([...ids]).catch(() => undefined);
    }, REFRESH_INTERVAL_MS);
    this.refreshTimer.unref?.();
  }

  async handleConnection(socket: AuthedSocket): Promise<void> {
    this.metrics.wsConnections.inc({ namespace: PRESENCE_NAMESPACE });
    const user = socket.data.user;
    if (!user) return;
    try {
      const wentOnline = await this.presence.connected(user.id);
      if (wentOnline && !user.isGuest) await this.broadcastToFriends(user.id, true);
    } catch (err) {
      this.logger.debug(`presence connect failed: ${(err as Error).message}`);
    }
  }

  async handleDisconnect(socket: AuthedSocket): Promise<void> {
    this.metrics.wsConnections.dec({ namespace: PRESENCE_NAMESPACE });
    const user = socket.data.user;
    if (!user) return;
    try {
      const wentOffline = await this.presence.disconnected(user.id);
      if (wentOffline && !user.isGuest) await this.broadcastToFriends(user.id, false);
    } catch (err) {
      this.logger.debug(`presence disconnect failed: ${(err as Error).message}`);
    }
  }

  private async broadcastToFriends(userId: string, online: boolean): Promise<void> {
    const friendIds = await this.friends.friendIds(userId);
    for (const friendId of friendIds) {
      this.server.to(`user:${friendId}`).emit('presence:update', { userId, online });
    }
  }
}
