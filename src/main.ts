import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger, LoggerErrorInterceptor } from 'nestjs-pino';
import { AppModule } from './app.module';
import { RedisIoAdapter } from './common/redis/redis-io.adapter';
import type { AppConfig } from './config/configuration';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.useGlobalInterceptors(new LoggerErrorInterceptor());

  const config = app.get(ConfigService<AppConfig, true>);
  const corsOrigins = config.get('corsOrigins', { infer: true });
  const redis = config.get('redis', { infer: true });

  // security & parsing
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({ origin: corsOrigins, credentials: true });

  // class-validator on every REST inbound payload
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  // Socket.IO over the Redis adapter — cross-instance broadcasts
  const ioAdapter = new RedisIoAdapter(app, corsOrigins);
  await ioAdapter.connectToRedis(redis.host, redis.port, redis.password);
  app.useWebSocketAdapter(ioAdapter);

  app.enableShutdownHooks();

  const port = config.get('port', { infer: true });
  await app.listen(port);
  app.get(Logger).log(`chess-64-squares-backend listening on :${port}`);
}

void bootstrap();
