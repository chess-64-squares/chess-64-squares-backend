import { Injectable, Logger, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly redis: Redis;
  private readonly memoryStore = new Map<string, { value: string; expiresAt: number | null }>();
  private hasWarnedFallback = false;

  constructor() {
    this.redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: (times) => (times > 3 ? null : Math.min(times * 200, 1000)),
    });

    this.redis.on('error', (error) => {
      this.warnFallback(error.message);
    });
  }

  private async ensureConnected(): Promise<void> {
    if (this.redis.status === 'ready') {
      return;
    }

    try {
      await this.redis.connect();
    } catch {
      this.warnFallback();
      throw new ServiceUnavailableException('Redis is not available');
    }
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    const connected = await this.tryConnect();
    if (!connected) {
      this.memoryStore.set(key, {
        value,
        expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
      });
      return;
    }

    if (ttlSeconds) {
      await this.redis.set(key, value, 'EX', ttlSeconds);
    } else {
      await this.redis.set(key, value);
    }
  }

  async get(key: string): Promise<string | null> {
    const connected = await this.tryConnect();
    if (!connected) {
      const item = this.memoryStore.get(key);
      if (!item) {
        return null;
      }
      if (item.expiresAt && item.expiresAt <= Date.now()) {
        this.memoryStore.delete(key);
        return null;
      }
      return item.value;
    }

    return this.redis.get(key);
  }

  async del(key: string): Promise<void> {
    const connected = await this.tryConnect();
    if (!connected) {
      this.memoryStore.delete(key);
      return;
    }

    await this.redis.del(key);
  }

  private async tryConnect(): Promise<boolean> {
    try {
      await this.ensureConnected();
      return true;
    } catch {
      return false;
    }
  }

  private warnFallback(reason?: string): void {
    if (this.hasWarnedFallback) {
      return;
    }
    this.hasWarnedFallback = true;
    this.logger.warn(
      `Redis is not available${reason ? `: ${reason}` : ''}. Using in-memory cache for development; data will be lost when the server restarts.`,
    );
  }

  async onModuleDestroy() {
    if (this.redis.status === 'ready') {
      await this.redis.quit();
    } else {
      this.redis.disconnect();
    }
  }
}
