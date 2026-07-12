import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  GameAnalysisEntity,
  GameEntity,
  GameMoveEntity,
  MoveAnalysisEntity,
} from '../database/entities';
import { AnalysisController } from './analysis.controller';
import { AnalysisService } from './analysis.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      GameEntity,
      GameMoveEntity,
      GameAnalysisEntity,
      MoveAnalysisEntity,
    ]),
  ],
  controllers: [AnalysisController],
  providers: [AnalysisService],
})
export class AnalysisModule {}
