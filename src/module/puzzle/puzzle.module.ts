import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Puzzle } from './puzzle.entity';
import { PuzzleAttempt } from './puzzle-attempt.entity';

import { PuzzleService } from './puzzle.service';
import { PuzzleController } from './puzzle.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Puzzle, PuzzleAttempt])],
  providers: [PuzzleService],
  controllers: [PuzzleController],
  exports: [PuzzleService],
})
export class PuzzleModule {}
