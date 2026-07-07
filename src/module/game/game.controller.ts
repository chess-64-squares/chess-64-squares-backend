import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { GameService } from './game.service';
import { GameModeService } from './game-mode.service';
import { ChatService } from './chat.service';
import { ApiResponse } from '../../common/response/api-response';
import { ChatMessageResDto, GameModeResDto, GameResDto } from './dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

type AuthenticatedRequest = {
  user: {
    sub: string;
  };
};

@Controller('game')
export class GameController {
  constructor(
    private readonly gameService: GameService,
    private readonly gameModeService: GameModeService,
    private readonly chatService: ChatService,
  ) {}

  @Get('modes')
  async getGameModes(): Promise<ApiResponse<GameModeResDto[]>> {
    return ApiResponse.success(await this.gameModeService.findAll());
  }

  @Get('active/me')
  @UseGuards(JwtAuthGuard)
  async getMyActiveGame(
    @Req() req: AuthenticatedRequest,
  ): Promise<ApiResponse<GameResDto | null>> {
    return ApiResponse.success(
      await this.gameService.getActiveGameByUserId(Number(req.user.sub)),
    );
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

  @Get('username/:username')
  async getGamesByUsername(
    @Param('username') username: string,
  ): Promise<ApiResponse<GameResDto[]>> {
    return ApiResponse.success(
      await this.gameService.getGamesByUsername(username),
    );
  }

  @Get(':gameId')
  async getGameDetail(@Param('gameId') gameId: string) {
    return ApiResponse.success(await this.gameService.getGameDetail(gameId));
  }

  @Get(':gameId/chat')
  @UseGuards(JwtAuthGuard)
  async getChatHistory(
    @Param('gameId') gameId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<ApiResponse<ChatMessageResDto[]>> {
    const game = await this.gameService.getGameById(gameId);
    const userId = Number(req.user.sub);

    if (game.playerWhite.userId !== userId && game.playerBlack.userId !== userId) {
      return ApiResponse.success([]);
    }

    const messages = await this.chatService.findByGameId(gameId);
    const usernameById = new Map<number, string>([
      [game.playerWhite.userId, game.playerWhite.username],
      [game.playerBlack.userId, game.playerBlack.username],
    ]);

    return ApiResponse.success(
      messages.map((message) => ({
        id: message.id,
        gameId: message.gameId,
        senderId: message.senderId,
        senderUsername: usernameById.get(message.senderId) ?? 'Unknown',
        message: message.message,
        createdAt: message.createdAt,
      })),
    );
  }
}
