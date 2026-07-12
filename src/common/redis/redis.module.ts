import { Global, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { GameStateStore } from 'chess-64-squares-shared';
import type { AppConfig } from '../../config/configuration';
import { RateLimiterService } from './rate-limiter.service';
import { REDIS_CLIENT } from './redis.tokens';

export { REDIS_CLIENT } from './redis.tokens';

/**
 * One shared ioredis client for app data (game state, matchmaking, caches,
 * rate limits). The Socket.IO adapter and BullMQ maintain their own
 * connections (they need dedicated/subscriber connections anyway).
 *
 * Resilience: retryStrategy keeps reconnecting forever with capped backoff;
 * commands fail fast while disconnected instead of buffering unboundedly —
 * handlers catch and return structured RETRY errors (ARCHITECTURE.md §2.9).
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => {
        const { host, port, password } = config.get('redis', { infer: true });
        const client = new Redis({
          host,
          port,
          password,
          lazyConnect: false,
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
          retryStrategy: (times) => Math.min(times * 200, 5_000),
        });
        client.on('error', () => {
          /* logged by health checks; never let an error event crash the process */
        });
        return client;
      },
    },
    {
      provide: GameStateStore,
      inject: [REDIS_CLIENT],
      useFactory: (redis: Redis) => new GameStateStore(redis),
    },
    RateLimiterService,
  ],
  exports: [REDIS_CLIENT, GameStateStore, RateLimiterService],
})
export class RedisModule implements OnApplicationShutdown {
  constructor() {}
  onApplicationShutdown(): void {
    /* client closed by Nest lifecycle via provider GC; explicit quit in main */
  }
}
