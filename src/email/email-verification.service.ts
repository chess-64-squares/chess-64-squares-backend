import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EmailVerificationTokenEntity, UserEntity } from '../database/entities';
import type { AppConfig } from '../config/configuration';
import { EmailSender } from './email.service';
import {
  buildVerificationLink,
  evaluateTokenRecord,
  generateVerificationToken,
  hashToken,
  verificationEmail,
} from './verification';

export type VerifyOutcome = 'verified' | 'already_verified';

/**
 * Endpoint choice (prompt-02 §2): verification consumes the token via
 * **POST /auth/verify-email** with the token in the body, NOT a GET with side
 * effects. Mail scanners and link-prefetchers (Outlook SafeLinks & co.)
 * follow GET links automatically and would burn single-use tokens before the
 * human ever clicks. The emailed link opens the frontend page, which issues
 * the POST.
 */
@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger(EmailVerificationService.name);

  constructor(
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    @InjectRepository(EmailVerificationTokenEntity)
    private readonly tokens: Repository<EmailVerificationTokenEntity>,
    private readonly emailSender: EmailSender,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  /** Issue (or re-issue) a token and send the link. Returns quietly on no-op cases. */
  async issueAndSend(user: UserEntity): Promise<void> {
    if (user.isGuest || !user.email || user.isEmailVerified) return;

    const email = this.config.get('email', { infer: true });
    const { token, tokenHash } = generateVerificationToken();
    await this.tokens.save(
      this.tokens.create({
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + email.verificationTtlHours * 3600 * 1000),
      }),
    );

    const link = buildVerificationLink(email.frontendBaseUrl, token);
    const message = verificationEmail(user.username, link);
    try {
      await this.emailSender.send({ to: user.email, ...message });
    } catch (err) {
      // registration must not fail because SMTP hiccuped — the user can resend
      this.logger.error(`verification email to ${user.email} failed: ${(err as Error).message}`);
    }
  }

  /**
   * Consume a token. Distinct outcomes (spec): success / already-verified are
   * 200s; invalid / expired / used are 400s with machine-readable `error`
   * codes the frontend maps to distinct screens.
   */
  async verify(rawToken: string): Promise<{ status: VerifyOutcome }> {
    const record = await this.tokens.findOneBy({ tokenHash: hashToken(rawToken) });
    const evaluation = evaluateTokenRecord(record);

    if (evaluation === 'invalid') {
      throw new BadRequestException({ error: 'TOKEN_INVALID', message: 'This verification link is not valid.' });
    }
    if (evaluation === 'expired') {
      throw new BadRequestException({ error: 'TOKEN_EXPIRED', message: 'This verification link has expired.' });
    }
    if (evaluation === 'used') {
      throw new BadRequestException({ error: 'TOKEN_USED', message: 'This verification link was already used.' });
    }

    // single-use: mark consumed atomically-enough (unique row, one UPDATE)
    record!.usedAt = new Date();
    await this.tokens.save(record!);

    const user = await this.users.findOneBy({ id: record!.userId });
    if (!user) throw new NotFoundException('User no longer exists');
    if (user.isEmailVerified) return { status: 'already_verified' };

    user.isEmailVerified = true;
    await this.users.save(user);
    this.logger.log(`email verified for user ${user.id}`);
    return { status: 'verified' };
  }

  async resend(userId: string): Promise<void> {
    const user = await this.users.findOneBy({ id: userId });
    if (!user) throw new NotFoundException('User not found');
    if (user.isGuest || !user.email) {
      throw new BadRequestException({ error: 'NO_EMAIL', message: 'This account has no email address.' });
    }
    if (user.isEmailVerified) {
      throw new BadRequestException({ error: 'ALREADY_VERIFIED', message: 'Your email is already verified.' });
    }
    await this.issueAndSend(user);
  }
}
