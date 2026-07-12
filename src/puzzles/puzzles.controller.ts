import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsString, Matches } from 'class-validator';
import type {
  PuzzleAttemptResponse,
  PuzzlePublic,
  PuzzleStats,
} from 'chess-64-squares-shared';
import { CurrentUser } from '../common/auth/current-user.decorator';
import type { AuthedUser } from '../common/auth/jwt-payload';
import { LIMITS, RateLimiterService } from '../common/redis/rate-limiter.service';
import { TooManyRequestsException } from '../common/errors';
import { PuzzlesService } from './puzzles.service';

class PuzzleAttemptDto {
  /** the whole line played so far (user + scripted replies), UCI */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(60)
  @IsString({ each: true })
  @Matches(/^[a-h][1-8][a-h][1-8][qrbn]?$/, { each: true })
  moves!: string[];
}

/** Guests may solve puzzles too — their rating just lives with the guest account. */
@Controller('puzzles')
export class PuzzlesController {
  constructor(
    private readonly puzzlesService: PuzzlesService,
    private readonly rateLimiter: RateLimiterService,
  ) {}

  @Get('next')
  next(@CurrentUser() user: AuthedUser): Promise<PuzzlePublic> {
    return this.puzzlesService.next(user.id);
  }

  @Get('stats')
  stats(@CurrentUser() user: AuthedUser): Promise<PuzzleStats> {
    return this.puzzlesService.stats(user.id);
  }

  @Post(':id/attempt')
  async attempt(
    @CurrentUser() user: AuthedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PuzzleAttemptDto,
  ): Promise<PuzzleAttemptResponse> {
    // same budget as live moves — puzzles must not become a write-amplifier
    const ok = await this.rateLimiter.consume(`puzzle:${user.id}`, LIMITS.move);
    if (!ok) throw new TooManyRequestsException('Slow down');
    return this.puzzlesService.attempt(user.id, id, dto.moves);
  }
}
