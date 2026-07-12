import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import configuration from './config/configuration';
import { JwtAuthGuard } from './common/auth/jwt-auth.guard';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { RedisModule } from './common/redis/redis.module';
import { DatabaseModule } from './database/database.module';
import { MetricsModule } from './metrics/metrics.module';
import { QueuesModule } from './queues/queues.module';
import { AuthModule } from './auth/auth.module';
import { EmailModule } from './email/email.module';
import { UsersModule } from './users/users.module';
import { RatingsModule } from './ratings/ratings.module';
import { GamesModule } from './games/games.module';
import { MatchmakingModule } from './matchmaking/matchmaking.module';
import { AnalysisModule } from './analysis/analysis.module';
import { FriendsModule } from './friends/friends.module';
import { ChatModule } from './chat/chat.module';
import { PresenceModule } from './presence/presence.module';
import { PuzzlesModule } from './puzzles/puzzles.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      // repo-root .env works whether the app runs from its own dir or the root
      envFilePath: ['.env', '../.env'],
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
        transport:
          process.env.NODE_ENV === 'production'
            ? undefined
            : { target: 'pino-pretty', options: { singleLine: true } },
        autoLogging: false,
        quietReqLogger: true,
      },
    }),
    DatabaseModule,
    RedisModule,
    MetricsModule,
    QueuesModule,
    EmailModule,
    AuthModule,
    UsersModule,
    RatingsModule,
    GamesModule,
    MatchmakingModule,
    AnalysisModule,
    FriendsModule,
    ChatModule,
    PresenceModule,
    PuzzlesModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}
