import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { QUEUES } from 'chess-64-squares-shared';
import type { AppConfig } from '../config/configuration';
import { GatewayRegistry } from './gateway-registry.service';
import { QueueProducerService } from './queue-producer.service';
import { BackendEffectSink } from './backend-effect-sink.service';

/**
 * The gateway tier only PRODUCES jobs (hot path stays hot); all consumers
 * live in chess-64-squares-worker (ARCHITECTURE.md §2.4).
 */
@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => {
        const redis = config.get('redis', { infer: true });
        return {
          connection: {
            host: redis.host,
            port: redis.port,
            password: redis.password,
          },
          defaultJobOptions: {
            removeOnComplete: { count: 1000 },
            removeOnFail: { count: 5000 },
            attempts: 3,
            backoff: { type: 'exponential', delay: 1000 },
          },
        };
      },
    }),
    BullModule.registerQueue(
      { name: QUEUES.ANALYSIS },
      { name: QUEUES.BOT_MOVES },
      { name: QUEUES.PERSISTENCE },
      { name: QUEUES.GAME_TIMERS },
    ),
  ],
  providers: [GatewayRegistry, QueueProducerService, BackendEffectSink],
  exports: [BullModule, GatewayRegistry, QueueProducerService, BackendEffectSink],
})
export class QueuesModule {}
