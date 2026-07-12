import { Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import type {
  AnalysisProgressBroadcast,
  GameAnalysisResult,
} from 'chess-64-squares-shared';
import { CurrentUser } from '../common/auth/current-user.decorator';
import type { AuthedUser } from '../common/auth/jwt-payload';
import { AnalysisService } from './analysis.service';

@Controller('games/:id/analysis')
export class AnalysisController {
  constructor(private readonly analysis: AnalysisService) {}

  @Get()
  result(@Param('id', ParseUUIDPipe) id: string): Promise<GameAnalysisResult> {
    return this.analysis.result(id);
  }

  @Post()
  request(
    @CurrentUser() user: AuthedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AnalysisProgressBroadcast> {
    return this.analysis.request(id, user.id);
  }
}
