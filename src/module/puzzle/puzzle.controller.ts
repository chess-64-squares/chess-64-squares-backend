import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { PuzzleService } from './puzzle.service';
import { ApiResponse } from '../../common/response/api-response';
import { PuzzleResDto, RecordAttemptReqDto } from './dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

type AuthenticatedRequest = {
  user: {
    sub: string;
  };
};

@Controller('puzzle')
@UseGuards(JwtAuthGuard)
export class PuzzleController {
  constructor(private readonly puzzleService: PuzzleService) {}

  @Get('random')
  async getRandom(): Promise<ApiResponse<PuzzleResDto>> {
    return ApiResponse.success(await this.puzzleService.findRandom());
  }

  @Get(':puzzleId')
  async getById(
    @Param('puzzleId') puzzleId: string,
  ): Promise<ApiResponse<PuzzleResDto>> {
    return ApiResponse.success(await this.puzzleService.findById(Number(puzzleId)));
  }

  @Post(':puzzleId/attempt')
  async recordAttempt(
    @Param('puzzleId') puzzleId: string,
    @Body() dto: RecordAttemptReqDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<ApiResponse<null>> {
    await this.puzzleService.recordAttempt(
      Number(req.user.sub),
      Number(puzzleId),
      dto.solved,
    );
    return ApiResponse.success(null, 'Attempt recorded');
  }
}
