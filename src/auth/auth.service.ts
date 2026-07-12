import {
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { hash as bcryptHash, compare as bcryptCompare } from 'bcryptjs';
import { IsNull, MoreThan, Repository } from 'typeorm';
import { EmailVerificationService } from '../email/email-verification.service';
import type { AuthResponse, PublicUser } from 'chess-64-squares-shared';
import type { AppConfig } from '../config/configuration';
import type {
  AccessTokenPayload,
  AuthedUser,
  RefreshTokenPayload,
} from '../common/auth/jwt-payload';
import {
  PasswordResetTokenEntity,
  RefreshTokenEntity,
  UserEntity,
} from '../database/entities';

const BCRYPT_ROUNDS = 10;

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresInSec: number;
  refreshTokenExpiresInSec: number;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function toPublicUser(user: UserEntity): PublicUser {
  return {
    id: user.id,
    username: user.username,
    avatarUrl: user.avatarUrl,
    country: user.country,
    isGuest: user.isGuest,
    // guests have no email to verify — report true so no UI nags them
    isEmailVerified: user.isGuest ? true : user.isEmailVerified,
    createdAt: user.createdAt.toISOString(),
  };
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    @InjectRepository(RefreshTokenEntity)
    private readonly refreshTokens: Repository<RefreshTokenEntity>,
    @InjectRepository(PasswordResetTokenEntity)
    private readonly resetTokens: Repository<PasswordResetTokenEntity>,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly emailVerification: EmailVerificationService,
  ) {}

  // ── register / login / guest ─────────────────────────────────────

  async register(username: string, email: string, password: string): Promise<{ user: UserEntity; tokens: IssuedTokens }> {
    const existing = await this.users
      .createQueryBuilder('u')
      .where('lower(u.username) = lower(:username)', { username })
      .orWhere('lower(u.email) = lower(:email)', { email })
      .getOne();
    if (existing) {
      throw new ConflictException(
        existing.username.toLowerCase() === username.toLowerCase()
          ? 'Username is already taken'
          : 'Email is already registered',
      );
    }
    const user = await this.users.save(
      this.users.create({
        username,
        email: email.toLowerCase(),
        passwordHash: await bcryptHash(password, BCRYPT_ROUNDS),
        isGuest: false,
        isEmailVerified: false,
      }),
    );
    // verification link (limited-access policy: the user may log in and play
    // casual/bot games right away, but rated play requires verification —
    // see EmailVerificationService / README)
    await this.emailVerification.issueAndSend(user);
    return { user, tokens: await this.issueTokens(user) };
  }

  async login(usernameOrEmail: string, password: string): Promise<{ user: UserEntity; tokens: IssuedTokens }> {
    const user = await this.users
      .createQueryBuilder('u')
      .where('lower(u.username) = lower(:v)', { v: usernameOrEmail })
      .orWhere('lower(u.email) = lower(:v)', { v: usernameOrEmail })
      .getOne();
    if (!user?.passwordHash || !(await bcryptCompare(password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return { user, tokens: await this.issueTokens(user) };
  }

  /**
   * Guest play: a real (FK-safe) user row flagged is_guest, no credentials.
   * Guest games are always unrated; the client offers registration afterwards.
   */
  async createGuest(): Promise<{ user: UserEntity; tokens: IssuedTokens }> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const username = `Guest-${randomBytes(3).toString('hex')}`;
      try {
        const user = await this.users.save(
          this.users.create({ username, isGuest: true }),
        );
        return { user, tokens: await this.issueTokens(user) };
      } catch {
        /* username collision — retry */
      }
    }
    throw new ConflictException('Could not allocate a guest identity');
  }

  // ── refresh rotation ─────────────────────────────────────────────

  async refresh(rawRefreshToken: string): Promise<{ user: UserEntity; tokens: IssuedTokens }> {
    const jwtCfg = this.config.get('jwt', { infer: true });
    let payload: RefreshTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<RefreshTokenPayload>(rawRefreshToken, {
        secret: jwtCfg.refreshSecret,
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const stored = await this.refreshTokens.findOne({
      where: {
        tokenHash: sha256(rawRefreshToken),
        revokedAt: IsNull(),
        expiresAt: MoreThan(new Date()),
      },
    });
    if (!stored || stored.userId !== payload.sub) {
      throw new UnauthorizedException('Refresh token is revoked or unknown');
    }

    const user = await this.users.findOneBy({ id: payload.sub });
    if (!user) throw new UnauthorizedException('User no longer exists');

    // rotate: revoke old, issue new
    stored.revokedAt = new Date();
    await this.refreshTokens.save(stored);
    return { user, tokens: await this.issueTokens(user) };
  }

  async logout(rawRefreshToken: string | undefined): Promise<void> {
    if (!rawRefreshToken) return;
    await this.refreshTokens.update(
      { tokenHash: sha256(rawRefreshToken) },
      { revokedAt: new Date() },
    );
  }

  // ── password reset (email delivery stubbed) ──────────────────────

  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.users.findOneBy({ email: email.toLowerCase() });
    // always succeed to avoid account enumeration
    if (!user || user.isGuest) return;
    const token = randomBytes(32).toString('hex');
    await this.resetTokens.save(
      this.resetTokens.create({
        userId: user.id,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      }),
    );
    // EMAIL STUB: a mail service would send a link with this token. Logged so
    // the flow is fully exercisable in dev.
    this.logger.log(`Password reset token for user ${user.id} (email stub): ${token}`);
  }

  async confirmPasswordReset(token: string, newPassword: string): Promise<void> {
    const stored = await this.resetTokens.findOne({
      where: { tokenHash: sha256(token), expiresAt: MoreThan(new Date()) },
    });
    if (!stored || stored.usedAt !== null) {
      throw new UnauthorizedException('Reset token is invalid or expired');
    }
    stored.usedAt = new Date();
    await this.resetTokens.save(stored);
    await this.users.update(
      { id: stored.userId },
      { passwordHash: await bcryptHash(newPassword, BCRYPT_ROUNDS) },
    );
    // revoke every session on password change
    await this.refreshTokens.update({ userId: stored.userId }, { revokedAt: new Date() });
  }

  // ── token issuance ───────────────────────────────────────────────

  async issueTokens(user: UserEntity): Promise<IssuedTokens> {
    const jwtCfg = this.config.get('jwt', { infer: true });
    const accessPayload: AccessTokenPayload = {
      sub: user.id,
      username: user.username,
      isGuest: user.isGuest,
    };
    const refreshPayload: RefreshTokenPayload = { sub: user.id, jti: randomUUID() };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(accessPayload, {
        secret: jwtCfg.accessSecret,
        expiresIn: jwtCfg.accessTtlSec,
      }),
      this.jwt.signAsync(refreshPayload, {
        secret: jwtCfg.refreshSecret,
        expiresIn: jwtCfg.refreshTtlSec,
      }),
    ]);

    await this.refreshTokens.save(
      this.refreshTokens.create({
        userId: user.id,
        tokenHash: sha256(refreshToken),
        expiresAt: new Date(Date.now() + jwtCfg.refreshTtlSec * 1000),
      }),
    );

    return {
      accessToken,
      refreshToken,
      accessTokenExpiresInSec: jwtCfg.accessTtlSec,
      refreshTokenExpiresInSec: jwtCfg.refreshTtlSec,
    };
  }

  buildAuthResponse(user: UserEntity, tokens: IssuedTokens): AuthResponse {
    return {
      user: toPublicUser(user),
      accessToken: tokens.accessToken,
      accessTokenExpiresInSec: tokens.accessTokenExpiresInSec,
    };
  }

  async me(authed: AuthedUser): Promise<PublicUser> {
    const user = await this.users.findOneBy({ id: authed.id });
    if (!user) throw new UnauthorizedException('User no longer exists');
    return toPublicUser(user);
  }
}
