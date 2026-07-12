import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  GameAnalysisEntity,
  GameEntity,
  GameMoveEntity,
  UserEntity,
} from '../database/entities';
import { ChatModule } from '../chat/chat.module';
import { RatingsModule } from '../ratings/ratings.module';
import { UsersModule } from '../users/users.module';
import { GameActionsService } from './game-actions.service';
import { GamesController } from './games.controller';
import { GamesService } from './games.service';
import { PlayGateway } from './play.gateway';

@Module({
  imports: [
    TypeOrmModule.forFeature([GameEntity, GameMoveEntity, GameAnalysisEntity, UserEntity]),
    ChatModule,
    RatingsModule,
    UsersModule,
  ],
  controllers: [GamesController],
  providers: [GamesService, GameActionsService, PlayGateway],
  exports: [GamesService, GameActionsService],
})
export class GamesModule {}
