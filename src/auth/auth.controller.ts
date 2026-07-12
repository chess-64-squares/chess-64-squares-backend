import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { TooManyRequestsException } from '../common/errors';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import type { AuthResponse, PublicUser } from 'chess-64-squares-shared';
import type { AppConfig } from '../config/configuration';
import { CurrentUser } from '../common/auth/current-user.decorator';
import { NoGuests, Public } from '../common/auth/jwt-auth.guard';
import type { AuthedUser } from '../common/auth/jwt-payload';
import { LIMITS, RateLimiterService } from '../common/redis/rate-limiter.service';
import { EmailVerificationService } from '../email/email-verification.service';
import type { VerifyOutcome } from '../email/email-verification.service';
import { AuthService, IssuedTokens } from './auth.service';
import {
  LoginDto,
  PasswordResetConfirmDto,
  PasswordResetRequestDto,
  RegisterDto,
  VerifyEmailDto,
} from './dto/auth.dto';

const REFRESH_COOKIE = 'c64_refresh';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly rateLimiter: RateLimiterService,
    private readonly emailVerification: EmailVerificationService,
  ) {}

  private setRefreshCookie(res: Response, tokens: IssuedTokens): void {
    res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.get('nodeEnv', { infer: true }) === 'production',
      path: '/auth',
      maxAge: tokens.refreshTokenExpiresInSec * 1000,
    });
  }

  private async enforceAuthRate(req: Request, extraKey = ''): Promise<void> {
    const ip = req.ip ?? 'unknown';
    const ok = await this.rateLimiter.consume(`auth:${ip}:${extraKey}`, LIMITS.authAttempt);
    if (!ok) throw new TooManyRequestsException('Too many attempts — slow down');
  }

  @Public()
  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    await this.enforceAuthRate(req);
    const { user, tokens } = await this.auth.register(dto.username, dto.email, dto.password);
    this.setRefreshCookie(res, tokens);
    return this.auth.buildAuthResponse(user, tokens);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    await this.enforceAuthRate(req, dto.usernameOrEmail.toLowerCase());
    const { user, tokens } = await this.auth.login(dto.usernameOrEmail, dto.password);
    this.setRefreshCookie(res, tokens);
    return this.auth.buildAuthResponse(user, tokens);
  }

  @Public()
  @Post('guest')
  async guest(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    await this.enforceAuthRate(req);
    const { user, tokens } = await this.auth.createGuest();
    this.setRefreshCookie(res, tokens);
    return this.auth.buildAuthResponse(user, tokens);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const raw = (req.cookies?.[REFRESH_COOKIE] as string | undefined) ?? '';
    const { user, tokens } = await this.auth.refresh(raw);
    this.setRefreshCookie(res, tokens);
    return this.auth.buildAuthResponse(user, tokens);
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    await this.auth.logout(req.cookies?.[REFRESH_COOKIE] as string | undefined);
    res.clearCookie(REFRESH_COOKIE, { path: '/auth' });
    return { ok: true };
  }

  @Public()
  @Post('password-reset/request')
  @HttpCode(200)
  async passwordResetRequest(
    @Body() dto: PasswordResetRequestDto,
    @Req() req: Request,
  ): Promise<{ ok: true }> {
    await this.enforceAuthRate(req);
    await this.auth.requestPasswordReset(dto.email);
    return { ok: true };
  }

  @Public()
  @Post('password-reset/confirm')
  @HttpCode(200)
  async passwordResetConfirm(
    @Body() dto: PasswordResetConfirmDto,
    @Req() req: Request,
  ): Promise<{ ok: true }> {
    await this.enforceAuthRate(req);
    await this.auth.confirmPasswordReset(dto.token, dto.newPassword);
    return { ok: true };
  }

  /**
   * POST (not GET): mail scanners prefetch GET links and would burn the
   * single-use token — the frontend /verify-email page issues this call.
   * Public: the link may be opened in a browser with no session.
   */
  @Public()
  @Post('verify-email')
  @HttpCode(200)
  async verifyEmail(
    @Body() dto: VerifyEmailDto,
    @Req() req: Request,
  ): Promise<{ status: VerifyOutcome }> {
    await this.enforceAuthRate(req);
    return this.emailVerification.verify(dto.token);
  }

  /** Rate-limited per user: 1/minute AND 5/day (two token buckets). */
  @Post('verify-email/resend')
  @NoGuests()
  @HttpCode(200)
  async resendVerification(@CurrentUser() user: AuthedUser): Promise<{ ok: true }> {
    const [minuteOk, dayOk] = await Promise.all([
      this.rateLimiter.consume(`evresend:min:${user.id}`, { rate: 1 / 60, burst: 1 }),
      this.rateLimiter.consume(`evresend:day:${user.id}`, { rate: 5 / 86_400, burst: 5 }),
    ]);
    if (!minuteOk) {
      throw new TooManyRequestsException('Please wait a minute before resending.');
    }
    if (!dayOk) {
      throw new TooManyRequestsException('Daily resend limit reached — try again tomorrow.');
    }
    await this.emailVerification.resend(user.id);
    return { ok: true };
  }

  @Get('me')
  me(@CurrentUser() user: AuthedUser): Promise<PublicUser> {
    return this.auth.me(user);
  }
}
