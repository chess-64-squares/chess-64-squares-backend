import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import type {
  ChatMessagePayload,
  GameStateSnapshot,
  GameSummary,
  TimeControl,
} from 'chess-64-squares-shared';
import { GameStateStore } from 'chess-64-squares-shared';
import { CurrentUser } from '../common/auth/current-user.decorator';
import type { AuthedUser } from '../common/auth/jwt-payload';
import { TooManyRequestsException } from '../common/errors';
import { LIMITS, RateLimiterService } from '../common/redis/rate-limiter.service';
import { ChatService } from '../chat/chat.service';
import {
  ChallengeFriendDto,
  CreateBotGameDto,
  CreateInviteDto,
  PageQueryDto,
} from './dto/games.dto';
import { GamesService } from './games.service';

@Controller('games')
export class GamesController {
  constructor(
    private readonly gamesService: GamesService,
    private readonly chatService: ChatService,
    private readonly rateLimiter: RateLimiterService,
    private readonly store: GameStateStore,
  ) {}

  private async enforceCreateLimit(userId: string): Promise<void> {
    const ok = await this.rateLimiter.consume(`create:${userId}`, LIMITS.gameCreate);
    if (!ok) throw new TooManyRequestsException('You are creating games too quickly');
  }

  // ── creation ─────────────────────────────────────────────────────

  @Post('bot')
  async createBotGame(
    @CurrentUser() user: AuthedUser,
    @Body() dto: CreateBotGameDto,
  ): Promise<{ gameId: string }> {
    await this.enforceCreateLimit(user.id);
    const state = await this.gamesService.createBotGame(
      user.id,
      dto.level,
      dto.timeControlId ?? null,
      dto.color ?? 'random',
    );
    return { gameId: state.gameId };
  }

  @Post('invite')
  async createInvite(
    @CurrentUser() user: AuthedUser,
    @Body() dto: CreateInviteDto,
  ): Promise<{ inviteCode: string }> {
    await this.enforceCreateLimit(user.id);
    return this.gamesService.createInvite(
      user.id,
      dto.timeControlId,
      dto.rated ?? false,
      dto.color ?? 'random',
    );
  }

  @Get('invite/:code')
  peekInvite(@Param('code') code: string): Promise<{
    timeControl: TimeControl;
    rated: boolean;
    creator: { id: string; username: string };
  }> {
    return this.gamesService.peekInvite(code);
  }

  @Post('invite/:code/join')
  async joinInvite(
    @CurrentUser() user: AuthedUser,
    @Param('code') code: string,
  ): Promise<{ gameId: string }> {
    const state = await this.gamesService.joinInvite(code, user.id);
    return { gameId: state.gameId };
  }

  @Post('challenge')
  async challengeFriend(
    @CurrentUser() user: AuthedUser,
    @Body() dto: ChallengeFriendDto,
  ): Promise<{ inviteCode: string }> {
    await this.enforceCreateLimit(user.id);
    return this.gamesService.challengeFriend(
      user.id,
      dto.toUserId,
      dto.timeControlId,
      dto.rated ?? false,
    );
  }

  // ── reads ────────────────────────────────────────────────────────

  @Get('user/:userId')
  listUserGames(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query() query: PageQueryDto,
  ): Promise<{ games: GameSummary[]; total: number }> {
    return this.gamesService.listUserGames(userId, query.page ?? 1, query.pageSize ?? 20);
  }

  @Get(':id')
  snapshot(
    @CurrentUser() user: AuthedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<GameStateSnapshot> {
    return this.gamesService.snapshot(id, user.id);
  }

  @Get(':id/pgn')
  @Header('Content-Type', 'application/x-chess-pgn')
  pgn(@Param('id', ParseUUIDPipe) id: string): Promise<string> {
    return this.gamesService.pgn(id);
  }

  @Get(':id/chat')
  async chat(
    @CurrentUser() user: AuthedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ChatMessagePayload[]> {
    // chat stays between the two players, even after the game
    const state = await this.store.load(id);
    if (state) {
      const isParticipant =
        state.white.userId === user.id || state.black.userId === user.id;
      if (!isParticipant) throw new ForbiddenException('Chat is for players of this game');
    } else {
      const snapshot = await this.gamesService.snapshot(id, user.id);
      if (snapshot.yourColor === null) {
        throw new ForbiddenException('Chat is for players of this game');
      }
    }
    return this.chatService.list(id);
  }
}
