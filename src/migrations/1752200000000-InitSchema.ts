import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Full initial schema — hand-written (no synchronize in any environment).
 * Matches the entity decorators in src/database/entities.
 */
export class InitSchema1752200000000 implements MigrationInterface {
  name = 'InitSchema1752200000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE users (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        username      varchar(32)  NOT NULL,
        email         varchar(255),
        password_hash varchar(100),
        avatar_url    text,
        country       varchar(2),
        is_guest      boolean      NOT NULL DEFAULT false,
        bot_streak    integer      NOT NULL DEFAULT 0,
        created_at    timestamptz  NOT NULL DEFAULT now(),
        updated_at    timestamptz  NOT NULL DEFAULT now(),
        CONSTRAINT uq_users_username UNIQUE (username),
        CONSTRAINT uq_users_email UNIQUE (email)
      )`);
    await q.query(`CREATE INDEX idx_users_username_lower ON users (lower(username))`);

    await q.query(`
      CREATE TABLE ratings (
        user_id      uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        category     varchar(16) NOT NULL,
        rating       integer     NOT NULL DEFAULT 1200,
        games_played integer     NOT NULL DEFAULT 0,
        updated_at   timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, category)
      )`);
    await q.query(`CREATE INDEX idx_ratings_category_rating ON ratings (category, rating DESC)`);

    await q.query(`
      CREATE TABLE rating_history (
        id         bigserial PRIMARY KEY,
        user_id    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        category   varchar(16) NOT NULL,
        rating     integer     NOT NULL,
        game_id    uuid,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(
      `CREATE INDEX idx_rating_history_user ON rating_history (user_id, category, created_at)`,
    );

    await q.query(`
      CREATE TABLE refresh_tokens (
        id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash varchar(64) NOT NULL,
        expires_at timestamptz NOT NULL,
        revoked_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_refresh_tokens_hash UNIQUE (token_hash)
      )`);
    await q.query(`CREATE INDEX idx_refresh_tokens_user ON refresh_tokens (user_id)`);

    await q.query(`
      CREATE TABLE password_reset_tokens (
        id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash varchar(64) NOT NULL,
        expires_at timestamptz NOT NULL,
        used_at    timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_password_reset_tokens_hash UNIQUE (token_hash)
      )`);
    await q.query(
      `CREATE INDEX idx_password_reset_tokens_user ON password_reset_tokens (user_id)`,
    );

    await q.query(`
      CREATE TABLE games (
        id                 uuid PRIMARY KEY,
        white_user_id      uuid REFERENCES users(id) ON DELETE SET NULL,
        black_user_id      uuid REFERENCES users(id) ON DELETE SET NULL,
        bot_level          integer,
        bot_color          char(1),
        time_control_id    varchar(16),
        category           varchar(16),
        rated              boolean     NOT NULL DEFAULT false,
        is_bot_game        boolean     NOT NULL DEFAULT false,
        result             varchar(8),
        termination_reason varchar(40),
        final_fen          varchar(120),
        ply_count          integer     NOT NULL DEFAULT 0,
        rating_delta_white integer,
        rating_delta_black integer,
        started_at         timestamptz NOT NULL,
        ended_at           timestamptz
      )`);
    await q.query(`CREATE INDEX idx_games_white ON games (white_user_id, started_at DESC)`);
    await q.query(`CREATE INDEX idx_games_black ON games (black_user_id, started_at DESC)`);
    await q.query(`CREATE INDEX idx_games_ended ON games (ended_at)`);

    await q.query(`
      CREATE TABLE game_moves (
        game_id        uuid         NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        ply_number     integer      NOT NULL,
        san            varchar(16)  NOT NULL,
        uci            varchar(8)   NOT NULL,
        fen_after      varchar(120) NOT NULL,
        clock_white_ms integer,
        clock_black_ms integer,
        played_at      timestamptz  NOT NULL,
        PRIMARY KEY (game_id, ply_number)
      )`);

    await q.query(`
      CREATE TABLE game_analysis (
        game_id        uuid PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
        status         varchar(16) NOT NULL DEFAULT 'none',
        accuracy_white real,
        accuracy_black real,
        depth          integer,
        requested_at   timestamptz,
        completed_at   timestamptz,
        error          text
      )`);

    await q.query(`
      CREATE TABLE move_analysis (
        game_id       uuid        NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        ply_number    integer     NOT NULL,
        eval_cp       integer,
        eval_mate     integer,
        best_move_san varchar(16),
        best_move_uci varchar(8),
        classification varchar(16) NOT NULL,
        win_pct_white real        NOT NULL,
        PRIMARY KEY (game_id, ply_number)
      )`);

    await q.query(`
      CREATE TABLE friend_requests (
        id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        from_user_id uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        to_user_id   uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status       varchar(16) NOT NULL DEFAULT 'pending',
        created_at   timestamptz NOT NULL DEFAULT now(),
        responded_at timestamptz,
        CONSTRAINT uq_friend_requests_pair UNIQUE (from_user_id, to_user_id)
      )`);
    await q.query(
      `CREATE INDEX idx_friend_requests_to ON friend_requests (to_user_id, status)`,
    );

    await q.query(`
      CREATE TABLE chat_messages (
        id      bigserial PRIMARY KEY,
        game_id uuid         NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        user_id uuid         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        message varchar(240) NOT NULL,
        sent_at timestamptz  NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX idx_chat_messages_game ON chat_messages (game_id, sent_at)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS chat_messages`);
    await q.query(`DROP TABLE IF EXISTS friend_requests`);
    await q.query(`DROP TABLE IF EXISTS move_analysis`);
    await q.query(`DROP TABLE IF EXISTS game_analysis`);
    await q.query(`DROP TABLE IF EXISTS game_moves`);
    await q.query(`DROP TABLE IF EXISTS games`);
    await q.query(`DROP TABLE IF EXISTS password_reset_tokens`);
    await q.query(`DROP TABLE IF EXISTS refresh_tokens`);
    await q.query(`DROP TABLE IF EXISTS rating_history`);
    await q.query(`DROP TABLE IF EXISTS ratings`);
    await q.query(`DROP TABLE IF EXISTS users`);
  }
}
