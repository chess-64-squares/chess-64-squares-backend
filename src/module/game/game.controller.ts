import { Controller, Get, Param, Query } from '@nestjs/common';
import { GameService } from './game.service';
import { GameModeService } from './game-mode.service';
import { ApiResponse } from '../../common/response/api-response';
import { GameModeResDto, GameResDto } from './dto';

@Controller('game')
export class GameController {
  constructor(
    private readonly gameService: GameService,
    private readonly gameModeService: GameModeService,
  ) {}

  @Get('modes')
  async getGameModes(): Promise<ApiResponse<GameModeResDto[]>> {
    return ApiResponse.success(await this.gameModeService.findAll());
  }

  @Get('user/:userId')
  async getGamesByUserId(
    @Param('userId') userId: string,
    @Query('page') page = '1',
    @Query('limit') limit = '10',
  ) {
    return ApiResponse.success(
      await this.gameService.getGamesByUserId(
        Number(userId),
        Number(page),
        Number(limit),
      ),
    );
  }

  @Get(':gameId')
  async getGameDetail(@Param('gameId') gameId: string) {
    return ApiResponse.success(await this.gameService.getGameDetail(gameId));
  }

  @Get('username/:username')
  async getGamesByUsername(
    @Param('username') username: string,
  ): Promise<ApiResponse<GameResDto[]>> {
    return ApiResponse.success(
      await this.gameService.getGamesByUsername(username),
    );
  }
}
