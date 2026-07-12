import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Email verification (prompt-02 §2):
 * - users.is_email_verified, default false for NEW accounts.
 *   Existing accounts are grandfathered to `true` — they registered before
 *   verification existed and locking them out of rated play retroactively
 *   would punish users for our schema change.
 * - email_verification_tokens stores the SHA-256 hash of each link token
 *   (never the raw token — see EmailVerificationTokenEntity).
 */
export class EmailVerification1752300000000 implements MigrationInterface {
  name = 'EmailVerification1752300000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE users ADD COLUMN is_email_verified boolean NOT NULL DEFAULT false`,
    );
    await q.query(`UPDATE users SET is_email_verified = true`);

    await q.query(`
      CREATE TABLE email_verification_tokens (
        id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash varchar(64) NOT NULL,
        expires_at timestamptz NOT NULL,
        used_at    timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_email_verification_tokens_hash UNIQUE (token_hash)
      )`);
    await q.query(
      `CREATE INDEX idx_email_verification_tokens_user ON email_verification_tokens (user_id)`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS email_verification_tokens`);
    await q.query(`ALTER TABLE users DROP COLUMN IF EXISTS is_email_verified`);
  }
}
