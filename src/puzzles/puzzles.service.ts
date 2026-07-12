import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  ChessGameEngine,
  RATING_DEFAULT,
  evaluatePuzzleAttempt,
  parseUci,
  puzzleEloUpdate,
  type Color,
  type PuzzleAttemptResponse,
  type PuzzlePublic,
  type PuzzleStats,
} from 'chess-64-squares-shared';
import {
  PuzzleAttemptEntity,
  PuzzleEntity,
  RatingEntity,
  RatingHistoryEntity,
} from '../database/entities';

const PUZZLE_CATEGORY = 'puzzle';
/** matchmaking window around the user's puzzle rating */
const RATING_WINDOW = 250;

@Injectable()
export class PuzzlesService {
  constructor(
    @InjectRepository(PuzzleEntity) private readonly puzzles: Repository<PuzzleEntity>,
    @InjectRepository(PuzzleAttemptEntity)
    private readonly attempts: Repository<PuzzleAttemptEntity>,
    @InjectRepository(RatingEntity) private readonly ratings: Repository<RatingEntity>,
    private readonly dataSource: DataSource,
  ) {}

  private toPublic(puzzle: PuzzleEntity): PuzzlePublic {
    return {
      id: puzzle.id,
      fen: puzzle.fen,
      rating: puzzle.rating,
      themes: puzzle.themes ? puzzle.themes.split(',') : [],
      sideToMove: puzzle.fen.split(' ')[1] as Color,
    };
  }

  async userPuzzleRating(userId: string): Promise<number> {
    const row = await this.ratings.findOneBy({ userId, category: PUZZLE_CATEGORY });
    return row?.rating ?? RATING_DEFAULT;
  }

  /**
   * Next puzzle near the user's puzzle rating (±250), excluding ones they
   * already SOLVED; widens to any unsolved, then to anything (repeat play is
   * better than a dead end on a small seed set).
   */
  async next(userId: string): Promise<PuzzlePublic> {
    const rating = await this.userPuzzleRating(userId);

    const pick = async (windowed: boolean, excludeSolved: boolean): Promise<PuzzleEntity | null> => {
      const qb = this.puzzles.createQueryBuilder('p');
      if (windowed) {
        qb.where('p.rating BETWEEN :lo AND :hi', {
          lo: rating - RATING_WINDOW,
          hi: rating + RATING_WINDOW,
        });
      }
      if (excludeSolved) {
        qb.andWhere(
          `p.id NOT IN (SELECT puzzle_id FROM puzzle_attempts WHERE user_id = :userId AND solved = true)`,
          { userId },
        );
      }
      // ORDER BY random() is fine at seed-set scale; a big imported library
      // would switch to a random rating-offset probe on idx_puzzles_rating
      return qb.orderBy('random()').limit(1).getOne();
    };

    const puzzle =
      (await pick(true, true)) ?? (await pick(false, true)) ?? (await pick(false, false));
    if (!puzzle) throw new NotFoundException('No puzzles available');
    return this.toPublic(puzzle);
  }

  /**
   * Validate the submitted line against the stored solution. Moves are
   * replayed through the SHARED engine (single rules authority — no separate
   * validation logic here): an illegal move can never be marked correct, and
   * the scripted reply's SAN comes from the same replay.
   */
  async attempt(
    userId: string,
    puzzleId: string,
    moves: string[],
  ): Promise<PuzzleAttemptResponse> {
    const puzzle = await this.puzzles.findOneBy({ id: puzzleId });
    if (!puzzle) throw new NotFoundException('Puzzle not found');
    const solution = puzzle.solution.split(' ');

    // replay the submitted prefix — rejects illegal/malformed lines outright
    const engine = new ChessGameEngine(puzzle.fen);
    try {
      for (const uci of moves) engine.applyMove(parseUci(uci));
    } catch {
      throw new BadRequestException('Submitted moves are not legal from this position');
    }

    const evaluation = evaluatePuzzleAttempt(solution, moves);

    let reply: { uci: string; san: string } | null = null;
    if (evaluation.correct && !evaluation.complete && evaluation.replyUci) {
      const applied = engine.applyMove(parseUci(evaluation.replyUci));
      reply = { uci: evaluation.replyUci, san: applied.san };
    }

    // a finished outcome (solved, or any wrong move) rates ONCE per user+puzzle
    let ratingUpdate: { rating: number; delta: number } | null = null;
    const finished = evaluation.complete || !evaluation.correct;
    if (finished) {
      ratingUpdate = await this.recordOutcome(userId, puzzle, evaluation.complete);
    }

    return {
      correct: evaluation.correct,
      complete: evaluation.complete,
      reply,
      ratingUpdate,
    };
  }

  /** First finished attempt per (user, puzzle) adjusts the Elo; retries don't. */
  private async recordOutcome(
    userId: string,
    puzzle: PuzzleEntity,
    solved: boolean,
  ): Promise<{ rating: number; delta: number } | null> {
    return this.dataSource.transaction(async (manager) => {
      const existing = await manager.findOneBy(PuzzleAttemptEntity, {
        userId,
        puzzleId: puzzle.id,
      });
      if (existing) {
        // retry: keep history, never re-rate
        await manager.insert(PuzzleAttemptEntity, {
          userId,
          puzzleId: puzzle.id,
          solved,
          ratingDelta: null,
        });
        return null;
      }

      let row = await manager
        .getRepository(RatingEntity)
        .createQueryBuilder('r')
        .setLock('pessimistic_write')
        .where('r.user_id = :userId AND r.category = :category', {
          userId,
          category: PUZZLE_CATEGORY,
        })
        .getOne();
      if (!row) {
        await manager
          .createQueryBuilder()
          .insert()
          .into(RatingEntity)
          .values({
            userId,
            category: PUZZLE_CATEGORY,
            rating: RATING_DEFAULT,
            gamesPlayed: 0,
          })
          .orIgnore()
          .execute();
        row = await manager
          .getRepository(RatingEntity)
          .createQueryBuilder('r')
          .setLock('pessimistic_write')
          .where('r.user_id = :userId AND r.category = :category', {
            userId,
            category: PUZZLE_CATEGORY,
          })
          .getOneOrFail();
      }

      const update = puzzleEloUpdate(row.rating, puzzle.rating, solved);
      await manager.update(
        RatingEntity,
        { userId, category: PUZZLE_CATEGORY },
        { rating: update.rating, gamesPlayed: row.gamesPlayed + 1 },
      );
      await manager.insert(RatingHistoryEntity, {
        userId,
        category: PUZZLE_CATEGORY,
        rating: update.rating,
        gameId: null,
      });
      await manager.insert(PuzzleAttemptEntity, {
        userId,
        puzzleId: puzzle.id,
        solved,
        ratingDelta: update.delta,
      });
      return update;
    });
  }

  async stats(userId: string): Promise<PuzzleStats> {
    const [rating, rows] = await Promise.all([
      this.userPuzzleRating(userId),
      this.attempts.find({
        where: { userId },
        order: { attemptedAt: 'DESC' },
        take: 500,
      }),
    ]);
    // streak: consecutive solves over DISTINCT puzzles from the latest backwards
    let streak = 0;
    const seen = new Set<string>();
    for (const a of rows) {
      if (seen.has(a.puzzleId)) continue;
      seen.add(a.puzzleId);
      if (a.solved) streak += 1;
      else break;
    }
    return {
      rating,
      solvedCount: new Set(rows.filter((r) => r.solved).map((r) => r.puzzleId)).size,
      attemptCount: rows.length,
      streak,
    };
  }
}
