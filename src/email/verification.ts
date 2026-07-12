import { createHash, randomBytes } from 'crypto';

/**
 * Pure email-verification token logic — unit-tested without I/O
 * (test/verification.spec.ts).
 */

export interface GeneratedToken {
  /** the raw, unguessable link token — only ever leaves via email */
  token: string;
  /** what we persist */
  tokenHash: string;
}

/** 256 bits of entropy, hex-encoded (64 chars) — not a numeric code. */
export function generateVerificationToken(): GeneratedToken {
  const token = randomBytes(32).toString('hex');
  return { token, tokenHash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface TokenRecordLike {
  expiresAt: Date;
  usedAt: Date | null;
}

export type TokenEvaluation = 'valid' | 'expired' | 'used' | 'invalid';

/** Order matters: a used token reports 'used' even after it also expired. */
export function evaluateTokenRecord(
  record: TokenRecordLike | null,
  now: Date = new Date(),
): TokenEvaluation {
  if (!record) return 'invalid';
  if (record.usedAt !== null) return 'used';
  if (record.expiresAt.getTime() <= now.getTime()) return 'expired';
  return 'valid';
}

export function buildVerificationLink(frontendBaseUrl: string, token: string): string {
  return `${frontendBaseUrl}/verify-email?token=${token}`;
}

export function verificationEmail(username: string, link: string): {
  subject: string;
  text: string;
  html: string;
} {
  const subject = 'Verify your chess-64-squares email';
  const text = `Hi ${username},

Confirm your email address to unlock rated play on chess-64-squares:

${link}

The link expires in 24 hours. If you didn't create this account, ignore this email.`;
  const html = `<div style="font-family:sans-serif;max-width:480px">
  <h2>Welcome to chess-64-squares, ${username}!</h2>
  <p>Confirm your email address to unlock <strong>rated play</strong>:</p>
  <p><a href="${link}" style="display:inline-block;background:#E8A33D;color:#211605;padding:10px 22px;border-radius:8px;text-decoration:none;font-weight:bold">Verify my email</a></p>
  <p style="color:#666;font-size:13px">Or paste this link into your browser:<br>${link}</p>
  <p style="color:#666;font-size:13px">The link expires in 24 hours. If you didn't create this account, ignore this email.</p>
</div>`;
  return { subject, text, html };
}
