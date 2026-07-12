import { Global, Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { MetricsService } from './metrics.service';

@Global()
@Module({
  providers: [MetricsService],
  controllers: [HealthController],
  exports: [MetricsService],
})
export class MetricsModule {}
