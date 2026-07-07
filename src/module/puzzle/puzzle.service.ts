import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Puzzle } from './puzzle.entity';
import { PuzzleAttempt } from './puzzle-attempt.entity';
import { PUZZLE_SEED_DATA } from './puzzle-seed-data';
import { AppException, ErrorCode } from '../../common/exceptions';

@Injectable()
export class PuzzleService implements OnModuleInit {
  constructor(
    @InjectRepository(Puzzle)
    private readonly puzzleRepository: Repository<Puzzle>,
    @InjectRepository(PuzzleAttempt)
    private readonly puzzleAttemptRepository: Repository<PuzzleAttempt>,
  ) { }

  async onModuleInit(): Promise<void> {
    await this.seedPuzzles();
  }

  async findRandom(): Promise<Puzzle> {
    const puzzle = await this.puzzleRepository
      .createQueryBuilder('puzzle')
      .orderBy('RANDOM()')
      .getOne();

    if (!puzzle) {
      throw new AppException(ErrorCode.PUZZLE_NOT_FOUND, 'No puzzles available');
    }

    return puzzle;
  }

  async findById(puzzleId: number): Promise<Puzzle> {
    const puzzle = await this.puzzleRepository.findOne({ where: { puzzleId } });

    if (!puzzle) {
      throw new AppException(ErrorCode.PUZZLE_NOT_FOUND, 'Puzzle not found');
    }

    return puzzle;
  }

  async recordAttempt(
    userId: number,
    puzzleId: number,
    solved: boolean,
  ): Promise<PuzzleAttempt> {
    await this.findById(puzzleId);

    const attempt = this.puzzleAttemptRepository.create({
      userId,
      puzzleId,
      solved,
    });

    return this.puzzleAttemptRepository.save(attempt);
  }

  private async seedPuzzles(): Promise<void> {
    const count = await this.puzzleRepository.count();
    if (count > 0) return;

    for (const entry of PUZZLE_SEED_DATA) {
      await this.puzzleRepository.save(this.puzzleRepository.create(entry));
    }
  }
}
