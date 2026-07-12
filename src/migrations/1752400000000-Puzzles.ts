import { MigrationInterface, QueryRunner } from 'typeorm';
import { SEED_PUZZLES } from 'chess-64-squares-shared';

/**
 * Puzzles feature (prompt-02 §3): schema + development seed in one migration
 * (an empty puzzles table makes the feature untestable). The seed set lives in
 * chess-64-squares-shared/src/puzzles/seed-data.ts where the shared test
 * suite replays every entry through the real engine before it can ship.
 *
 * Per-user puzzle rating deliberately reuses the existing `ratings` table
 * (category = 'puzzle') — same Elo scale, same history mechanism, no new
 * rating infrastructure.
 */
export class Puzzles1752400000000 implements MigrationInterface {
  name = 'Puzzles1752400000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE puzzles (
        id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        fen        varchar(120) NOT NULL,
        solution   text         NOT NULL,
        rating     integer      NOT NULL,
        themes     text         NOT NULL DEFAULT '',
        created_at timestamptz  NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX idx_puzzles_rating ON puzzles (rating)`);

    await q.query(`
      CREATE TABLE puzzle_attempts (
        id           bigserial PRIMARY KEY,
        user_id      uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        puzzle_id    uuid        NOT NULL REFERENCES puzzles(id) ON DELETE CASCADE,
        solved       boolean     NOT NULL,
        rating_delta integer,
        attempted_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(
      `CREATE INDEX idx_puzzle_attempts_user ON puzzle_attempts (user_id, attempted_at)`,
    );
    await q.query(
      `CREATE INDEX idx_puzzle_attempts_user_puzzle ON puzzle_attempts (user_id, puzzle_id)`,
    );

    for (const p of SEED_PUZZLES) {
      await q.query(
        `INSERT INTO puzzles (fen, solution, rating, themes) VALUES ($1, $2, $3, $4)`,
        [p.fen, p.solution.join(' '), p.rating, p.themes.join(',')],
      );
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS puzzle_attempts`);
    await q.query(`DROP TABLE IF EXISTS puzzles`);
  }
}
