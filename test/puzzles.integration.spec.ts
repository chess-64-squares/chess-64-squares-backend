/**
 * Integration test (prompt-02 §3): fetch-puzzle → attempt (correct, full
 * line) → marked solved → puzzle rating updated; plus fail path and the
 * retry-doesn't-re-rate rule. Real Postgres (skips when unreachable), real
 * PuzzlesService, real shared engine.
 */
import { config as loadDotenv } from 'dotenv';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RATING_DEFAULT, puzzleEloUpdate } from 'chess-64-squares-shared';
import {
  ALL_ENTITIES,
  PuzzleAttemptEntity,
  PuzzleEntity,
  RatingEntity,
  RatingHistoryEntity,
  UserEntity,
} from 'chess-64-squares-shared/db';
import { PuzzlesService } from '../src/puzzles/puzzles.service';

loadDotenv({ path: join(__dirname, '..', '.env') });
loadDotenv({ path: join(__dirname, '..', '..', '.env') });

let dataSource: DataSource | null = null;
let service: PuzzlesService;

beforeAll(async () => {
  const ds = new DataSource({
    type: 'postgres',
    host: process.env.POSTGRES_HOST ?? '127.0.0.1',
    port: parseInt(process.env.POSTGRES_PORT ?? '5432', 10),
    username: process.env.POSTGRES_USER ?? 'chess64',
    password: process.env.POSTGRES_PASSWORD ?? 'chess64_dev_password',
    database: process.env.POSTGRES_DB ?? 'chess64',
    entities: ALL_ENTITIES,
    synchronize: false,
  });
  try {
    await ds.initialize();
    const seeded = await ds.getRepository(PuzzleEntity).count();
    if (seeded === 0) throw new Error('puzzles not seeded');
    dataSource = ds;
    service = new PuzzlesService(
      ds.getRepository(PuzzleEntity),
      ds.getRepository(PuzzleAttemptEntity),
      ds.getRepository(RatingEntity),
      ds,
    );
  } catch {
    dataSource = null;
  }
}, 20_000);

afterAll(async () => {
  await dataSource?.destroy();
});

async function makeUser(): Promise<UserEntity> {
  const users = dataSource!.getRepository(UserEntity);
  return users.save(
    users.create({
      username: `it_puzzle_${Math.random().toString(36).slice(2, 8)}`,
      isGuest: true,
      isEmailVerified: false,
    }),
  );
}

async function cleanup(userId: string): Promise<void> {
  await dataSource!.getRepository(PuzzleAttemptEntity).delete({ userId });
  await dataSource!.getRepository(RatingHistoryEntity).delete({ userId });
  await dataSource!.getRepository(RatingEntity).delete({ userId });
  await dataSource!.getRepository(UserEntity).delete({ id: userId });
}

describe('puzzles — full flow (integration)', () => {
  it('solve path: correct line → solved → rating goes up; retry never re-rates', async (ctx) => {
    if (!dataSource) return ctx.skip();
    const user = await makeUser();
    try {
      const puzzle = await service.next(user.id);
      expect(puzzle.fen).toBeTruthy();
      expect(puzzle).not.toHaveProperty('solution'); // never leaked to clients

      const { solution } = await dataSource
        .getRepository(PuzzleEntity)
        .findOneByOrFail({ id: puzzle.id });
      const line = solution.split(' ');

      // play the line the way the client does: submit after each user move
      const played: string[] = [];
      for (let i = 0; i < line.length; i += 2) {
        played.push(line[i]!);
        const res = await service.attempt(user.id, puzzle.id, [...played]);
        expect(res.correct).toBe(true);
        if (i + 1 < line.length) {
          expect(res.complete).toBe(false);
          expect(res.reply?.uci).toBe(line[i + 1]);
          expect(res.reply?.san).toBeTruthy(); // SAN from the shared engine
          played.push(res.reply!.uci);
        } else {
          expect(res.complete).toBe(true);
          const expected = puzzleEloUpdate(RATING_DEFAULT, puzzle.rating, true);
          expect(res.ratingUpdate).toEqual(expected);
          expect(res.ratingUpdate!.delta).toBeGreaterThan(0);
        }
      }

      // marked solved + stats reflect it
      const stats = await service.stats(user.id);
      expect(stats.solvedCount).toBe(1);
      expect(stats.streak).toBe(1);
      expect(stats.rating).toBeGreaterThan(RATING_DEFAULT);

      // replaying the same puzzle completes but does NOT re-rate
      const replay = await service.attempt(user.id, puzzle.id, line);
      expect(replay.complete).toBe(true);
      expect(replay.ratingUpdate).toBeNull();
      expect((await service.stats(user.id)).rating).toBe(stats.rating);
    } finally {
      await cleanup(user.id);
    }
  }, 30_000);

  it('fail path: a wrong first move rates down once and breaks the streak', async (ctx) => {
    if (!dataSource) return ctx.skip();
    const user = await makeUser();
    try {
      const puzzle = await service.next(user.id);
      const { solution, fen } = await dataSource
        .getRepository(PuzzleEntity)
        .findOneByOrFail({ id: puzzle.id });

      // find a legal move that is NOT the solution's first move
      const { ChessGameEngine } = await import('chess-64-squares-shared');
      const engine = new ChessGameEngine(fen);
      const wrong = engine
        .legalMoves()
        .map((m) => `${m.from}${m.to}${m.promotion ?? ''}`)
        .find((uci) => uci !== solution.split(' ')[0]);
      expect(wrong).toBeTruthy();

      const res = await service.attempt(user.id, puzzle.id, [wrong!]);
      expect(res.correct).toBe(false);
      expect(res.complete).toBe(false);
      expect(res.ratingUpdate!.delta).toBeLessThan(0);

      const stats = await service.stats(user.id);
      expect(stats.rating).toBeLessThan(RATING_DEFAULT);
      expect(stats.streak).toBe(0);
      expect(stats.solvedCount).toBe(0);

      // illegal junk is rejected outright
      await expect(service.attempt(user.id, puzzle.id, ['a1a1'])).rejects.toThrow();
    } finally {
      await cleanup(user.id);
    }
  }, 30_000);
});
