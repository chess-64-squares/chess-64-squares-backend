import { describe, expect, it } from 'vitest';
import {
  buildVerificationLink,
  evaluateTokenRecord,
  generateVerificationToken,
  hashToken,
} from '../src/email/verification';

describe('email verification — token generation', () => {
  it('produces a 64-char hex token (256 bits), not a numeric code', () => {
    const { token } = generateVerificationToken();
    expect(token).toMatch(/^[a-f0-9]{64}$/);
  });

  it('persists only the SHA-256 hash of the token', () => {
    const { token, tokenHash } = generateVerificationToken();
    expect(tokenHash).toBe(hashToken(token));
    expect(tokenHash).not.toBe(token);
    expect(tokenHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('tokens are unique across generations', () => {
    const seen = new Set(
      Array.from({ length: 200 }, () => generateVerificationToken().token),
    );
    expect(seen.size).toBe(200);
  });

  it('builds the frontend link from the configured base URL', () => {
    expect(buildVerificationLink('https://play.example.com', 'abc')).toBe(
      'https://play.example.com/verify-email?token=abc',
    );
  });
});

describe('email verification — token evaluation', () => {
  const now = new Date('2026-07-12T12:00:00Z');
  const future = new Date('2026-07-13T12:00:00Z');
  const past = new Date('2026-07-11T12:00:00Z');

  it('missing record is invalid', () => {
    expect(evaluateTokenRecord(null, now)).toBe('invalid');
  });

  it('unexpired, unused record is valid', () => {
    expect(evaluateTokenRecord({ expiresAt: future, usedAt: null }, now)).toBe('valid');
  });

  it('expiry boundary: exactly-at-expiry counts as expired', () => {
    expect(evaluateTokenRecord({ expiresAt: now, usedAt: null }, now)).toBe('expired');
    expect(evaluateTokenRecord({ expiresAt: past, usedAt: null }, now)).toBe('expired');
  });

  it('used token cannot be reused — reports "used" even when also expired', () => {
    expect(evaluateTokenRecord({ expiresAt: future, usedAt: past }, now)).toBe('used');
    expect(evaluateTokenRecord({ expiresAt: past, usedAt: past }, now)).toBe('used');
  });
});
