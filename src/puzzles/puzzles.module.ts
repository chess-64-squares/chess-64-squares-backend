import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  PuzzleAttemptEntity,
  PuzzleEntity,
  RatingEntity,
  RatingHistoryEntity,
} from '../database/entities';
import { PuzzlesController } from './puzzles.controller';
import { PuzzlesService } from './puzzles.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PuzzleEntity,
      PuzzleAttemptEntity,
      RatingEntity,
      RatingHistoryEntity,
    ]),
  ],
  controllers: [PuzzlesController],
  providers: [PuzzlesService],
})
export class PuzzlesModule {}
