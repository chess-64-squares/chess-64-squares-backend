import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { IsIn, IsOptional } from 'class-validator';
import type { LeaderboardEntry, TimeControlCategory } from 'chess-64-squares-shared';
import { Public } from '../common/auth/jwt-auth.guard';
import { RatingsService } from './ratings.service';

const CATEGORIES = ['bullet', 'blitz', 'rapid', 'classical'] as const;

class LeaderboardQueryDto {
  @IsOptional()
  @IsIn(CATEGORIES)
  category?: TimeControlCategory;
}

@Controller('ratings')
export class RatingsController {
  constructor(private readonly ratingsService: RatingsService) {}

  @Public()
  @Get('leaderboard')
  leaderboard(@Query() query: LeaderboardQueryDto): Promise<LeaderboardEntry[]> {
    return this.ratingsService.leaderboard(query.category ?? 'blitz');
  }

  @Get('history/:userId')
  history(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query() query: LeaderboardQueryDto,
  ): Promise<Array<{ rating: number; gameId: string | null; at: string }>> {
    return this.ratingsService.ratingHistory(userId, query.category ?? 'blitz');
  }
}
