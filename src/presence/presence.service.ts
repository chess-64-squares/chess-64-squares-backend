import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../common/redis/redis.module';

const connKey = (userId: string): string => `c64:conn:${userId}`;
/** stale-connection safety: refreshed by the presence gateway every 30 s */
const CONN_TTL_SEC = 90;

/**
 * Presence = "has at least one live socket anywhere in the fleet".
 * A per-user connection counter with a TTL: INCR on connect, DECR on
 * disconnect; the TTL cleans up after crashed instances that never DECRed.
 */
@Injectable()
export class PresenceService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /** returns true when this connect took the user offline → online */
  async connected(userId: string): Promise<boolean> {
    const key = connKey(userId);
    const count = await this.redis.incr(key);
    await this.redis.expire(key, CONN_TTL_SEC);
    return count === 1;
  }

  /** returns true when this disconnect took the user online → offline */
  async disconnected(userId: string): Promise<boolean> {
    const key = connKey(userId);
    const count = await this.redis.decr(key);
    if (count <= 0) {
      await this.redis.del(key);
      return true;
    }
    return false;
  }

  async refresh(userIds: string[]): Promise<void> {
    if (userIds.length === 0) return;
    const pipeline = this.redis.pipeline();
    for (const id of userIds) pipeline.expire(connKey(id), CONN_TTL_SEC);
    await pipeline.exec();
  }

  async isOnline(userId: string): Promise<boolean> {
    return (await this.redis.exists(connKey(userId))) === 1;
  }

  async onlineAmong(userIds: string[]): Promise<Set<string>> {
    if (userIds.length === 0) return new Set();
    const pipeline = this.redis.pipeline();
    for (const id of userIds) pipeline.exists(connKey(id));
    const results = await pipeline.exec();
    const online = new Set<string>();
    results?.forEach(([, value], i) => {
      if (value === 1) online.add(userIds[i]!);
    });
    return online;
  }
}
