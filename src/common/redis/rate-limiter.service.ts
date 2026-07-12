import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.tokens';

/**
 * Distributed token bucket (atomic Lua). Buckets live in Redis so limits hold
 * across all gateway instances (ARCHITECTURE.md §2.8).
 */
const TOKEN_BUCKET_LUA = `
local key   = KEYS[1]
local rate  = tonumber(ARGV[1]) -- tokens per second
local burst = tonumber(ARGV[2])
local now   = tonumber(ARGV[3]) -- ms
local cost  = tonumber(ARGV[4])
local data = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(data[1])
local ts = tonumber(data[2])
if tokens == nil then tokens = burst; ts = now end
tokens = math.min(burst, tokens + (now - ts) * rate / 1000)
local allowed = 0
if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
end
redis.call('HSET', key, 'tokens', tokens, 'ts', now)
redis.call('PEXPIRE', key, tonumber(ARGV[5]))
return allowed
`;

export interface RateLimit {
  /** tokens replenished per second */
  rate: number;
  /** bucket size */
  burst: number;
}

/** bucket key TTL: long enough for the bucket to fully refill, min 2 minutes */
function bucketTtlMs(limit: RateLimit): number {
  return Math.max(120_000, Math.ceil((limit.burst / limit.rate) * 1000 * 1.5));
}

/** The platform's limits, in one place. */
export const LIMITS = {
  move: { rate: 4, burst: 8 },
  chat: { rate: 1, burst: 3 },
  wsGeneric: { rate: 10, burst: 20 },
  matchmakingJoin: { rate: 0.1, burst: 6 },
  authAttempt: { rate: 0.17, burst: 10 },
  gameCreate: { rate: 0.2, burst: 5 },
} as const satisfies Record<string, RateLimit>;

@Injectable()
export class RateLimiterService {
  private sha: string | null = null;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /**
   * Returns true when the action is allowed. Fails OPEN on Redis outage:
   * rate limiting is protection, not correctness — a brief blip must not
   * take gameplay down with it.
   */
  async consume(key: string, limit: RateLimit, cost = 1): Promise<boolean> {
    const args = [
      `c64:rl:${key}`,
      String(limit.rate),
      String(limit.burst),
      String(Date.now()),
      String(cost),
      String(bucketTtlMs(limit)),
    ];
    try {
      if (!this.sha) {
        this.sha = (await this.redis.script('LOAD', TOKEN_BUCKET_LUA)) as string;
      }
      const allowed = await this.redis.evalsha(this.sha, 1, ...args);
      return allowed === 1;
    } catch (err) {
      if ((err as Error).message?.includes('NOSCRIPT')) {
        this.sha = null;
        try {
          const allowed = await this.redis.eval(TOKEN_BUCKET_LUA, 1, ...args);
          return allowed === 1;
        } catch {
          return true;
        }
      }
      return true;
    }
  }
}
