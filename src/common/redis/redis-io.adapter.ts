import { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import type { ServerOptions } from 'socket.io';

/**
 * Socket.IO server adapter backed by Redis pub/sub so a `to(room).emit(...)`
 * on any gateway instance reaches sockets on every other instance.
 *
 * Scale note (ARCHITECTURE.md §2.2): this is the CLASSIC adapter — fine to
 * ~10⁵ connections. The 1M-connection deployment swaps `createAdapter` for
 * `createShardedAdapter` (Redis 7 sharded pub/sub, dynamic subscription mode)
 * right here; nothing else in the codebase changes.
 */
export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor?: ReturnType<typeof createAdapter>;
  private pub?: Redis;
  private sub?: Redis;

  constructor(
    app: INestApplicationContext,
    private readonly corsOrigins: string[],
  ) {
    super(app);
  }

  async connectToRedis(host: string, port: number, password?: string): Promise<void> {
    this.pub = new Redis({ host, port, password, retryStrategy: (t) => Math.min(t * 200, 5000) });
    this.sub = this.pub.duplicate();
    this.pub.on('error', () => undefined);
    this.sub.on('error', () => undefined);
    this.adapterConstructor = createAdapter(this.pub, this.sub);
  }

  override createIOServer(port: number, options?: ServerOptions): unknown {
    const server = super.createIOServer(port, {
      ...options,
      cors: {
        origin: this.corsOrigins,
        credentials: true,
      },
      // long-poll fallback needs LB stickiness; pure WS does not (§ Load balancing)
      transports: ['websocket', 'polling'],
    });
    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }
    return server;
  }

  async quitRedis(): Promise<void> {
    await Promise.all([this.pub?.quit(), this.sub?.quit()]);
  }
}
