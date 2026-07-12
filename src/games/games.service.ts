import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes, randomUUID } from 'crypto';
import Redis from 'ioredis';
import { IsNull, Not, Repository } from 'typeorm';
import {
  BOT_LEVELS,
  ChallengeBroadcast,
  Color,
  FIRST_MOVE_TIMEOUT_MS,
  GameResult,
  GameStateRecord,
  GameStateStore,
  GameStateSnapshot,
  GameSummary,
  PLAY_NAMESPACE,
  SidePlayer,
  StatePlayer,
  TerminationReason,
  TimeControl,
  buildPgn,
  createInitialState,
  findBotLevel,
  findTimeControl,
  opponentColor,
  parseTimeControl,
  toSnapshot,
} from 'chess-64-squares-shared';
import { REDIS_CLIENT } from '../common/redis/redis.module';
import {
  GameAnalysisEntity,
  GameEntity,
  GameMoveEntity,
  UserEntity,
} from '../database/entities';
import { MetricsService } from '../metrics/metrics.service';
import { GatewayRegistry } from '../queues/gateway-registry.service';
import { QueueProducerService } from '../queues/queue-producer.service';
import { RatingsService } from '../ratings/ratings.service';
import { UsersService } from '../users/users.service';

interface PendingInvite {
  creatorId: string;
  timeControlId: string;
  rated: boolean;
  creatorColor: Color | 'random';
  /** when set, only this user may accept (friend challenge) */
  onlyUserId?: string;
}

const inviteKey = (code: string): string => `c64:invite:${code}`;
const PRESENCE_NAMESPACE = '/presence';

@Injectable()
export class GamesService {
  constructor(
    @InjectRepository(GameEntity) private readonly games: Repository<GameEntity>,
    @InjectRepository(GameMoveEntity) private readonly moves: Repository<GameMoveEntity>,
    @InjectRepository(GameAnalysisEntity)
    private readonly analyses: Repository<GameAnalysisEntity>,
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly store: GameStateStore,
    private readonly producer: QueueProducerService,
    private readonly registry: GatewayRegistry,
    private readonly ratingsService: RatingsService,
    private readonly usersService: UsersService,
    private readonly metrics: MetricsService,
  ) {}

  // ─────────────────────────────────────────────────────────────────
  // Creation
  // ─────────────────────────────────────────────────────────────────

  private async statePlayerFor(userId: string, tc: TimeControl | null): Promise<StatePlayer> {
    const user = await this.users.findOneBy({ id: userId });
    if (!user) throw new NotFoundException('User not found');
    const rating = tc
      ? await this.ratingsService.getOrDefault(userId, tc.category)
      : { rating: null as number | null, gamesPlayed: 0 };
    return {
      userId: user.id,
      username: user.username,
      avatarUrl: user.avatarUrl,
      isGuest: user.isGuest,
      rating: rating.rating,
      gamesPlayed: rating.gamesPlayed,
    };
  }

  private botStatePlayer(level: number): StatePlayer {
    const spec = findBotLevel(level);
    if (!spec) throw new BadRequestException(`Unknown bot level ${level}`);
    return {
      userId: null,
      username: `${spec.name} (bot)`,
      avatarUrl: null,
      isGuest: false,
      rating: null,
      gamesPlayed: 0,
    };
  }

  /** Core creation path used by matchmaking, bot play, invites and rematches. */
  async createGame(params: {
    white: StatePlayer;
    black: StatePlayer;
    botLevel?: number | null;
    botColor?: Color | null;
    rated: boolean;
    timeControl: TimeControl | null;
    kind: 'pvp' | 'bot' | 'private';
  }): Promise<GameStateRecord> {
    const now = Date.now();
    const gameId = randomUUID();
    let rated =
      params.rated &&
      !params.botColor &&
      !params.white.isGuest &&
      !params.black.isGuest &&
      params.timeControl !== null;

    // Limited-access policy (prompt-02 §2): unverified users keep full access
    // to casual/bot/private play, but a game only counts as RATED when both
    // players have verified emails — nobody is blocked, the rating pool stays
    // clean. (Chosen over hard "can't log in": less hostile, same integrity.)
    if (rated && params.white.userId && params.black.userId) {
      const rows: Array<{ is_email_verified: boolean }> = await this.users.query(
        'SELECT is_email_verified FROM users WHERE id IN ($1, $2)',
        [params.white.userId, params.black.userId],
      );
      rated = rows.length === 2 && rows.every((r) => r.is_email_verified);
    }

    const state = createInitialState({
      gameId,
      white: params.white,
      black: params.black,
      botLevel: params.botLevel ?? null,
      botColor: params.botColor ?? null,
      rated,
      timeControl: params.timeControl,
      now,
    });

    await this.store.save(state);

    // durable row now (FKs for chat/analysis hold during play); finish data
    // is written by the persistence worker
    await this.games.insert({
      id: gameId,
      whiteUserId: params.white.userId,
      blackUserId: params.black.userId,
      botLevel: params.botLevel ?? null,
      botColor: params.botColor ?? null,
      timeControlId: params.timeControl?.id ?? null,
      category: params.timeControl?.category ?? null,
      rated,
      isBotGame: params.botColor != null,
      startedAt: new Date(now),
    });

    // if nobody moves, abort (worker adjudicates)
    await this.producer.schedule({
      kind: 'flag-check',
      gameId,
      ply: 0,
      delayMs: FIRST_MOVE_TIMEOUT_MS,
    });

    // bot plays white → it moves first
    if (params.botColor === 'w' && params.botLevel != null) {
      await this.producer.enqueue({
        kind: 'bot-move',
        gameId,
        botLevel: params.botLevel,
        ply: 0,
        expectedFen: state.fen,
      });
    }

    this.metrics.gamesStarted.inc({ kind: params.kind });
    return state;
  }

  async createPvpGame(
    userIdA: string,
    userIdB: string,
    tc: TimeControl,
    rated: boolean,
  ): Promise<GameStateRecord> {
    const [a, b] = await Promise.all([
      this.statePlayerFor(userIdA, tc),
      this.statePlayerFor(userIdB, tc),
    ]);
    const aIsWhite = Math.random() < 0.5;
    return this.createGame({
      white: aIsWhite ? a : b,
      black: aIsWhite ? b : a,
      rated,
      timeControl: tc,
      kind: 'pvp',
    });
  }

  async createBotGame(
    userId: string,
    level: number,
    timeControlId: string | null,
    color: Color | 'random',
  ): Promise<GameStateRecord> {
    const tc = timeControlId ? (parseTimeControl(timeControlId) ?? null) : null;
    if (timeControlId && !tc) throw new BadRequestException('Unknown time control');
    if (!findBotLevel(level)) {
      throw new BadRequestException(
        `Bot level must be 1–${BOT_LEVELS[BOT_LEVELS.length - 1]!.level}`,
      );
    }
    const humanColor: Color = color === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : color;
    const botColor = opponentColor(humanColor);
    const human = await this.statePlayerFor(userId, tc);
    const bot = this.botStatePlayer(level);
    return this.createGame({
      white: humanColor === 'w' ? human : bot,
      black: humanColor === 'b' ? human : bot,
      botLevel: level,
      botColor,
      rated: false, // bot games never touch the competitive pool
      timeControl: tc,
      kind: 'bot',
    });
  }

  // ─────────────────────────────────────────────────────────────────
  // Private games / friend challenges
  // ─────────────────────────────────────────────────────────────────

  async createInvite(
    creatorId: string,
    timeControlId: string,
    rated: boolean,
    creatorColor: Color | 'random',
    onlyUserId?: string,
  ): Promise<{ inviteCode: string }> {
    const tc = parseTimeControl(timeControlId);
    if (!tc) throw new BadRequestException('Unknown time control');
    const inviteCode = randomBytes(4).toString('hex');
    const invite: PendingInvite = { creatorId, timeControlId, rated, creatorColor, onlyUserId };
    await this.redis.set(inviteKey(inviteCode), JSON.stringify(invite), 'EX', 24 * 3600);
    return { inviteCode };
  }

  async peekInvite(code: string): Promise<{
    timeControl: TimeControl;
    rated: boolean;
    creator: { id: string; username: string };
  }> {
    const raw = await this.redis.get(inviteKey(code));
    if (!raw) throw new NotFoundException('Invite not found or expired');
    const invite = JSON.parse(raw) as PendingInvite;
    const creator = await this.users.findOneBy({ id: invite.creatorId });
    if (!creator) throw new NotFoundException('Invite creator no longer exists');
    return {
      timeControl: parseTimeControl(invite.timeControlId)!,
      rated: invite.rated,
      creator: { id: creator.id, username: creator.username },
    };
  }

  async joinInvite(code: string, joinerId: string): Promise<GameStateRecord> {
    // GETDEL: two simultaneous accepts cannot both win
    const raw = await this.redis.getdel(inviteKey(code));
    if (!raw) throw new NotFoundException('Invite not found, expired, or already used');
    const invite = JSON.parse(raw) as PendingInvite;
    if (invite.creatorId === joinerId) {
      // put it back — the creator opening their own link must not burn it
      await this.redis.set(inviteKey(code), raw, 'EX', 24 * 3600);
      throw new ConflictException('You cannot accept your own invite');
    }
    if (invite.onlyUserId && invite.onlyUserId !== joinerId) {
      await this.redis.set(inviteKey(code), raw, 'EX', 24 * 3600);
      throw new ForbiddenException('This challenge is for someone else');
    }

    const tc = parseTimeControl(invite.timeControlId)!;
    const [creator, joiner] = await Promise.all([
      this.statePlayerFor(invite.creatorId, tc),
      this.statePlayerFor(joinerId, tc),
    ]);
    const creatorIsWhite =
      invite.creatorColor === 'random' ? Math.random() < 0.5 : invite.creatorColor === 'w';

    const state = await this.createGame({
      white: creatorIsWhite ? creator : joiner,
      black: creatorIsWhite ? joiner : creator,
      rated: invite.rated,
      timeControl: tc,
      kind: 'private',
    });

    // the creator is waiting on /play — tell them the game is ready
    this.registry.emitToRoom(PLAY_NAMESPACE, `user:${invite.creatorId}`, 'game:inviteAccepted', {
      inviteCode: code,
      gameId: state.gameId,
    });
    return state;
  }

  async challengeFriend(
    fromUserId: string,
    toUserId: string,
    timeControlId: string,
    rated: boolean,
  ): Promise<{ inviteCode: string }> {
    if (fromUserId === toUserId) throw new BadRequestException('You cannot challenge yourself');
    const target = await this.users.findOneBy({ id: toUserId });
    if (!target) throw new NotFoundException('User not found');
    const tc = parseTimeControl(timeControlId);
    if (!tc) throw new BadRequestException('Unknown time control');

    const { inviteCode } = await this.createInvite(
      fromUserId,
      timeControlId,
      rated,
      'random',
      toUserId,
    );
    const from = await this.statePlayerFor(fromUserId, tc);
    const payload: ChallengeBroadcast = {
      inviteCode,
      from: { id: fromUserId, username: from.username, rating: from.rating },
      timeControlId,
    };
    this.registry.emitToRoom(PRESENCE_NAMESPACE, `user:${toUserId}`, 'presence:challenge', payload);
    return { inviteCode };
  }

  // ─────────────────────────────────────────────────────────────────
  // Rematch
  // ─────────────────────────────────────────────────────────────────

  /** Accepting a rematch offer creates the color-swapped game atomically. */
  async acceptRematch(gameId: string, userId: string): Promise<GameStateRecord> {
    return this.store.withLock(gameId, async (state) => {
      if (!state) throw new NotFoundException('Game not found');
      if (state.phase === 'active') throw new ConflictException('The game is still running');
      const myColor =
        state.white.userId === userId ? 'w' : state.black.userId === userId ? 'b' : null;
      if (!myColor) throw new ForbiddenException('You are not a player in this game');
      const offerBy = state.rematchOfferBy;
      const botGame = state.botColor !== null;
      if (!botGame && (!offerBy || offerBy === myColor)) {
        throw new ConflictException('No rematch offer from your opponent');
      }
      state.rematchOfferBy = null;

      const newState = await this.createGame({
        // swap colors
        white: state.black,
        black: state.white,
        botLevel: state.botLevel,
        botColor: state.botColor ? opponentColor(state.botColor) : null,
        rated: state.rated,
        timeControl: state.timeControl,
        kind: botGame ? 'bot' : 'private',
      });

      this.registry.emitToRoom(PLAY_NAMESPACE, `game:${gameId}`, 'game:rematch:accepted', {
        gameId,
        newGameId: newState.gameId,
      });
      return { save: state, result: newState };
    });
  }

  // ─────────────────────────────────────────────────────────────────
  // Reads: snapshot, history, PGN
  // ─────────────────────────────────────────────────────────────────

  /** Live snapshot from Redis; finished games fall back to Postgres. */
  async snapshot(gameId: string, viewerUserId: string | null): Promise<GameStateSnapshot> {
    const state = await this.store.load(gameId);
    if (state) return toSnapshot(state, viewerUserId, Date.now());
    return this.snapshotFromDb(gameId, viewerUserId);
  }

  private async snapshotFromDb(
    gameId: string,
    viewerUserId: string | null,
  ): Promise<GameStateSnapshot> {
    const game = await this.games.findOneBy({ id: gameId });
    if (!game) throw new NotFoundException('Game not found');
    const moveRows = await this.moves.find({
      where: { gameId },
      order: { plyNumber: 'ASC' },
    });
    const [white, black] = await Promise.all([
      this.sidePlayerFromDb(game, 'w'),
      this.sidePlayerFromDb(game, 'b'),
    ]);
    const tc = game.timeControlId ? (parseTimeControl(game.timeControlId) ?? null) : null;
    const lastMove = moveRows[moveRows.length - 1];
    return {
      gameId,
      phase: game.endedAt ? (game.result ? 'finished' : 'aborted') : 'active',
      fen:
        game.finalFen ??
        lastMove?.fenAfter ??
        'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      turn: (lastMove ? (lastMove.plyNumber % 2 === 0 ? 'w' : 'b') : 'w') as Color,
      ply: moveRows.length,
      moves: moveRows.map((m) => ({
        ply: m.plyNumber,
        san: m.san,
        uci: m.uci,
        fenAfter: m.fenAfter,
        whiteMs: m.clockWhiteMs,
        blackMs: m.clockBlackMs,
      })),
      white,
      black,
      timeControl: tc,
      clock: null,
      rated: game.rated,
      isBotGame: game.isBotGame,
      drawOfferBy: null,
      result: (game.result as GameResult | null) ?? null,
      terminationReason: (game.terminationReason as TerminationReason | null) ?? null,
      yourColor:
        viewerUserId === null
          ? null
          : game.whiteUserId === viewerUserId
            ? 'w'
            : game.blackUserId === viewerUserId
              ? 'b'
              : null,
      ratingDelta:
        game.ratingDeltaWhite !== null && game.ratingDeltaBlack !== null
          ? { white: game.ratingDeltaWhite, black: game.ratingDeltaBlack }
          : null,
    };
  }

  private async sidePlayerFromDb(game: GameEntity, color: Color): Promise<SidePlayer> {
    if (game.botColor === color && game.botLevel != null) {
      const spec = findBotLevel(game.botLevel);
      return {
        kind: 'bot',
        bot: {
          isBot: true,
          level: game.botLevel,
          name: spec ? `${spec.name} (lvl ${game.botLevel})` : `Bot lvl ${game.botLevel}`,
          approxElo: spec?.approxElo ?? 0,
        },
      };
    }
    const userId = color === 'w' ? game.whiteUserId : game.blackUserId;
    if (!userId) {
      return {
        kind: 'user',
        user: { id: 'deleted', username: 'Deleted user', avatarUrl: null, isGuest: false, rating: null },
      };
    }
    const user = await this.users.findOneBy({ id: userId });
    return {
      kind: 'user',
      user: {
        id: userId,
        username: user?.username ?? 'Unknown',
        avatarUrl: user?.avatarUrl ?? null,
        isGuest: user?.isGuest ?? false,
        rating: null,
      },
    };
  }

  async listUserGames(
    userId: string,
    page = 1,
    pageSize = 20,
  ): Promise<{ games: GameSummary[]; total: number }> {
    const [rows, total] = await this.games.findAndCount({
      where: [
        { whiteUserId: userId, endedAt: Not(IsNull()) },
        { blackUserId: userId, endedAt: Not(IsNull()) },
      ],
      order: { startedAt: 'DESC' },
      take: Math.min(pageSize, 50),
      skip: (Math.max(page, 1) - 1) * Math.min(pageSize, 50),
    });

    const analysisRows = rows.length
      ? await this.analyses
          .createQueryBuilder('a')
          .where('a.game_id IN (:...ids)', { ids: rows.map((r) => r.id) })
          .getMany()
      : [];
    const analysisById = new Map(analysisRows.map((a) => [a.gameId, a.status]));

    const summaries = await Promise.all(
      rows.map(async (g): Promise<GameSummary> => {
        const [white, black] = await Promise.all([
          this.sidePlayerFromDb(g, 'w'),
          this.sidePlayerFromDb(g, 'b'),
        ]);
        return {
          gameId: g.id,
          white,
          black,
          result: (g.result as GameResult | null) ?? null,
          terminationReason: (g.terminationReason as TerminationReason | null) ?? null,
          timeControlId: g.timeControlId,
          category: (g.category as GameSummary['category']) ?? null,
          rated: g.rated,
          isBotGame: g.isBotGame,
          plyCount: g.plyCount,
          startedAt: g.startedAt.toISOString(),
          endedAt: g.endedAt?.toISOString() ?? null,
          analysisStatus:
            (analysisById.get(g.id) as GameSummary['analysisStatus']) ?? 'none',
        };
      }),
    );
    return { games: summaries, total };
  }

  async pgn(gameId: string): Promise<string> {
    const snapshot = await this.snapshot(gameId, null);
    const name = (side: SidePlayer): string =>
      side.kind === 'bot' ? side.bot.name : side.user.username;
    return buildPgn(
      {
        white: name(snapshot.white),
        black: name(snapshot.black),
        result: snapshot.result ?? '*',
        timeControl: snapshot.timeControl?.id,
        termination: snapshot.terminationReason ?? undefined,
        date: new Date(),
      },
      snapshot.moves.map((m) => m.san),
    );
  }
}
