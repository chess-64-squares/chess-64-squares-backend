import { Controller, Get, Header, Inject, ServiceUnavailableException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { DataSource } from 'typeorm';
import { Public } from '../common/auth/jwt-auth.guard';
import { REDIS_CLIENT } from '../common/redis/redis.module';
import { MetricsService } from './metrics.service';

/**
 * Kubernetes probes: /healthz (liveness — process is up) and /readyz
 * (readiness — dependencies reachable; flips not-ready during a Redis blip so
 * the LB stops routing NEW connections while existing sockets stay up).
 */
@Controller()
export class HealthController {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly metricsService: MetricsService,
  ) {}

  @Public()
  @Get('healthz')
  healthz(): { status: string } {
    return { status: 'ok' };
  }

  @Public()
  @Get('readyz')
  async readyz(): Promise<{ status: string; redis: string; postgres: string }> {
    const [redisOk, pgOk] = await Promise.all([
      this.redis
        .ping()
        .then(() => true)
        .catch(() => false),
      this.dataSource
        .query('SELECT 1')
        .then(() => true)
        .catch(() => false),
    ]);
    if (!redisOk || !pgOk) {
      throw new ServiceUnavailableException({
        status: 'not-ready',
        redis: redisOk ? 'ok' : 'down',
        postgres: pgOk ? 'ok' : 'down',
      });
    }
    return { status: 'ready', redis: 'ok', postgres: 'ok' };
  }

  @Public()
  @Get('metrics')
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  metrics(): Promise<string> {
    return this.metricsService.metrics();
  }
}
