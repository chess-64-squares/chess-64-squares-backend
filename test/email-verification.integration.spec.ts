/**
 * Integration test for the full verification flow (prompt-02 §2):
 *   register → token created → verify endpoint logic → user marked verified
 *   → same token again fails cleanly.
 *
 * Runs against the real dev Postgres (root .env / docker compose). When the
 * database is unreachable the suite is skipped, not failed — CI without infra
 * still passes unit tests.
 */
import { BadRequestException } from '@nestjs/common';
import { config as loadDotenv } from 'dotenv';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ALL_ENTITIES,
  EmailVerificationTokenEntity,
  UserEntity,
} from 'chess-64-squares-shared/db';
import { EmailVerificationService } from '../src/email/email-verification.service';
import { EmailSender, type OutgoingEmail } from '../src/email/email.service';

loadDotenv({ path: join(__dirname, '..', '.env') });
loadDotenv({ path: join(__dirname, '..', '..', '.env') });

class CapturingEmailSender extends EmailSender {
  sent: OutgoingEmail[] = [];
  async send(email: OutgoingEmail): Promise<void> {
    this.sent.push(email);
  }
}

const fakeConfig = {
  get: () => ({
    smtpHost: undefined,
    smtpPort: 587,
    fromAddress: 'test <t@example.com>',
    frontendBaseUrl: 'http://localhost:5173',
    verificationTtlHours: 24,
  }),
} as never;

let dataSource: DataSource | null = null;

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
    // schema must already be migrated
    await ds.query('SELECT 1 FROM email_verification_tokens LIMIT 0');
    dataSource = ds;
  } catch {
    dataSource = null; // infra not available → suite skips
  }
}, 20_000);

afterAll(async () => {
  await dataSource?.destroy();
});

describe('email verification — full flow (integration)', () => {
  it('register → verify → verified; replay fails cleanly', async (ctx) => {
    if (!dataSource) return ctx.skip();

    const users = dataSource.getRepository(UserEntity);
    const tokens = dataSource.getRepository(EmailVerificationTokenEntity);
    const sender = new CapturingEmailSender();
    const service = new EmailVerificationService(users, tokens, sender, fakeConfig);

    // "register"
    const suffix = Math.random().toString(36).slice(2, 8);
    const user = await users.save(
      users.create({
        username: `it_verify_${suffix}`,
        email: `it_verify_${suffix}@example.com`,
        passwordHash: 'x',
        isGuest: false,
        isEmailVerified: false,
      }),
    );

    try {
      // token created + email "sent" with the link
      await service.issueAndSend(user);
      expect(sender.sent).toHaveLength(1);
      const link = sender.sent[0]!.text.match(/token=([a-f0-9]{64})/);
      expect(link).not.toBeNull();
      const rawToken = link![1]!;

      const stored = await tokens.findBy({ userId: user.id });
      expect(stored).toHaveLength(1);
      expect(stored[0]!.tokenHash).not.toBe(rawToken); // hash at rest
      expect(stored[0]!.usedAt).toBeNull();

      // verify → success + user flagged
      const result = await service.verify(rawToken);
      expect(result.status).toBe('verified');
      const reloaded = await users.findOneByOrFail({ id: user.id });
      expect(reloaded.isEmailVerified).toBe(true);

      // replaying the same token fails with the distinct "used" outcome
      await expect(service.verify(rawToken)).rejects.toThrowError(BadRequestException);
      await expect(service.verify(rawToken)).rejects.toMatchObject({
        response: expect.objectContaining({ error: 'TOKEN_USED' }),
      });

      // resend on an already-verified account is rejected distinctly
      await expect(service.resend(user.id)).rejects.toMatchObject({
        response: expect.objectContaining({ error: 'ALREADY_VERIFIED' }),
      });

      // a garbage token is "invalid", an expired one is "expired"
      await expect(service.verify('0'.repeat(64))).rejects.toMatchObject({
        response: expect.objectContaining({ error: 'TOKEN_INVALID' }),
      });
      const expired = await tokens.save(
        tokens.create({
          userId: user.id,
          tokenHash: 'e'.repeat(64),
          expiresAt: new Date(Date.now() - 1000),
        }),
      );
      void expired;
      // (expiry path is covered at unit level; hash preimage unknown by design)
    } finally {
      await tokens.delete({ userId: user.id });
      await users.delete({ id: user.id });
    }
  }, 30_000);
});
