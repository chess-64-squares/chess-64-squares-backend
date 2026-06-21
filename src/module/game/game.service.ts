import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Game } from './game.entity';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { UserService } from '../user/user.service';
import { GameModeService } from './game-mode.service';
import { Chess, Move as ChessMove } from 'chess.js';
import { MakeMoveReqDto, GameResDto } from './dto';
import { ReasonForEnding } from '../../common/enum/reason-for-ending.enum';
import { GameStatus } from '../../common/enum/game-status.enum';
import { MoveService } from './move.service';
import { AppException, ErrorCode } from '../../common/exceptions';

interface QueueEntry {
  userId: number;
  gameModeId: number;
  socketId: string;
}

export interface PaginatedGames {
  items: GameResDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

@Injectable()
export class GameService {
  private matchmakingQueue: Map<number, QueueEntry[]> = new Map();
  constructor(
    @InjectRepository(Game)
    private readonly gameRepository: Repository<Game>,
    private readonly moveService: MoveService,
    private readonly userService: UserService,
    private readonly gameModeService: GameModeService,
  ) {}

  async create(
    playerWhiteId: number,
    playerBlackId: number,
    gameModeId: number,
  ): Promise<GameResDto> {
    const playerWhite = await this.userService.findById(playerWhiteId);

    if (!playerWhite) {
      throw new AppException(
        ErrorCode.USER_NOT_FOUND,
        'Player white not found',
      );
    }

    const playerBlack = await this.userService.findById(playerBlackId);

    if (!playerBlack) {
      throw new AppException(
        ErrorCode.USER_NOT_FOUND,
        'Player black not found',
      );
    }

    const gameMode = await this.gameModeService.findById(gameModeId);

    if (!gameMode) {
      throw new AppException(
        ErrorCode.GAME_MODE_NOT_FOUND,
        'Game mode not found',
      );
    }

    if (playerWhite.userId === playerBlack.userId) {
      throw new AppException(
        ErrorCode.USERS_SAME,
        'Players cannot be the same',
      );
    }

    const newGame = this.gameRepository.create({
      playerWhite,
      playerBlack,
      gameMode,
      playerWhiteElo: playerWhite.elo,
      playerBlackElo: playerBlack.elo,
      status: GameStatus.IN_PROGRESS,
    });

    const savedGame = await this.gameRepository.save(newGame);
    const gameRes: GameResDto = {
      gameId: savedGame.gameId,
      playerWhite: savedGame.playerWhite,
      playerBlack: savedGame.playerBlack,
      gameMode: savedGame.gameMode,
      playerWhiteElo: savedGame.playerWhiteElo,
      playerBlackElo: savedGame.playerBlackElo,
      playerWhiteEloChange: savedGame.playerWhiteEloChange,
      playerBlackEloChange: savedGame.playerBlackEloChange,
      fen: savedGame.fen,
      status: savedGame.status,
      reasonForEnding: savedGame.reasonForEnding,
      date: savedGame.date,
    };
    return gameRes;
  }

  async findMatch(
    userId: number,
    gameModeId: number,
    socketId: string,
  ): Promise<GameResDto | null> {
    const gameMode = await this.gameModeService.findById(gameModeId);
    if (!gameMode) {
      throw new NotFoundException('Game mode không tồn tại');
    }

    if (!this.matchmakingQueue.has(gameModeId)) {
      this.matchmakingQueue.set(gameModeId, []);
    }
    const queue = this.matchmakingQueue.get(gameModeId)!;

    // Kiểm tra người chơi đã có trong queue chưa (tránh duplicate)
    const alreadyInQueue = queue.find((entry) => entry.userId === userId);
    if (alreadyInQueue) {
      return null;
    }

    // Tìm đối thủ khác trong queue (không phải chính mình)
    const opponentIndex = queue.findIndex((entry) => entry.userId !== userId);

    if (opponentIndex === -1) {
      // Chưa có đối thủ -> thêm vào queue, chờ
      queue.push({ userId, gameModeId, socketId });
      return null;
    }

    // Có đối thủ -> lấy ra khỏi queue và tạo trận
    const opponent = queue.splice(opponentIndex, 1)[0];

    // Random màu quân cho công bằng
    const isCurrentUserWhite = Math.random() < 0.5;
    const playerWhiteId = isCurrentUserWhite ? userId : opponent.userId;
    const playerBlackId = isCurrentUserWhite ? opponent.userId : userId;

    return this.create(playerWhiteId, playerBlackId, gameModeId);
  }

  removeFromQueue(userId: number): void {
    for (const queue of this.matchmakingQueue.values()) {
      const index = queue.findIndex((entry) => entry.userId === userId);
      if (index !== -1) {
        queue.splice(index, 1);
      }
    }
  }

  getQueueEntry(userId: number, gameModeId: number): QueueEntry | undefined {
    return this.matchmakingQueue
      .get(gameModeId)
      ?.find((e) => e.userId === userId);
  }

  async getGameById(gameId: unknown): Promise<GameResDto> {
    const safeGameId = this.normalizeGameId(gameId);
    const game = await this.gameRepository.findOne({
      where: { gameId: safeGameId },
      relations: ['playerWhite', 'playerBlack', 'gameMode'],
    });
    if (!game) {
      throw new AppException(ErrorCode.GAME_NOT_FOUND, 'Game not found');
    }
    return game;
  }

  async makeMove(
    userId: number,
    dto: MakeMoveReqDto,
  ): Promise<{ game: GameResDto; san: string }> {
    const safeGameId = this.normalizeGameId(dto.gameId);
    const game = await this.getGameById(safeGameId);

    if (game.status !== GameStatus.IN_PROGRESS) {
      throw new AppException(
        ErrorCode.GAME_NOT_IN_PROGRESS,
        'Game not in progress',
      );
    }

    if (
      game.playerWhite.userId !== userId &&
      game.playerBlack.userId !== userId
    ) {
      throw new AppException(
        ErrorCode.USER_NOT_IN_GAME,
        'You are not a player in this game',
      );
    }

    const isWhite = game.playerWhite.userId === userId;

    const chess = new Chess(game.fen);

    // Kiểm tra đúng lượt
    const turn = chess.turn(); // 'w' hoặc 'b'
    if ((turn === 'w' && !isWhite) || (turn === 'b' && isWhite)) {
      throw new AppException(ErrorCode.NOT_YOUR_TURN, 'Not your turn');
    }

    // Thử thực hiện nước đi
    let moveResult: ChessMove | null;
    try {
      moveResult = chess.move({
        from: dto.from,
        to: dto.to,
        promotion: dto.promotion,
      });
    } catch {
      moveResult = null;
    }

    if (!moveResult) {
      throw new AppException(ErrorCode.INVALID_MOVE, 'Invalid move');
    }

    // Cập nhật FEN mới vào game
    game.fen = chess.fen();

    // Lưu lịch sử nước đi
    const moveCount = await this.moveService.count(safeGameId, isWhite);

    await this.moveService.create({
      gameId: safeGameId,
      isWhite,
      moveNumber: moveCount + 1,
      san: moveResult.san,
      fen: chess.fen(),
      timeTaken: 0,
    });

    if (chess.isGameOver()) {
      if (chess.isCheckmate()) {
        game.reasonForEnding = ReasonForEnding.CHECKMATED;
        // Người vừa đi là người thắng (đối phương bị chiếu hết)
        if (isWhite) {
          game.status = GameStatus.WHITE_WINS;
        } else {
          game.status = GameStatus.BLACK_WINS;
        }
        await this.applyElo(game);
      } else if (chess.isStalemate()) {
        game.reasonForEnding = ReasonForEnding.STALEMATE;
        game.status = GameStatus.DRAW;
        await this.applyElo(game);
      } else if (chess.isThreefoldRepetition()) {
        game.reasonForEnding = ReasonForEnding.REPETITION;
        game.status = GameStatus.DRAW;
        await this.applyElo(game);
      } else if (chess.isInsufficientMaterial()) {
        game.reasonForEnding = ReasonForEnding.INSUFFICIENT_MATERIAL;
        game.status = GameStatus.DRAW;
        await this.applyElo(game);
      } else if (chess.isDraw()) {
        game.reasonForEnding = ReasonForEnding.DRAW_AGREEMENT;
        game.status = GameStatus.DRAW;
        await this.applyElo(game);
      }
    }

    await this.gameRepository.save(game);

    return { game, san: moveResult.san };
  }

  async resign(userId: number, gameId: unknown): Promise<GameResDto> {
    const game = await this.getGameById(gameId);

    if (game.status !== GameStatus.IN_PROGRESS) {
      throw new AppException(
        ErrorCode.GAME_NOT_IN_PROGRESS,
        'Game not in progress',
      );
    }

    if (
      game.playerWhite.userId !== userId &&
      game.playerBlack.userId !== userId
    ) {
      throw new AppException(
        ErrorCode.USER_NOT_IN_GAME,
        'You are not a player in this game',
      );
    }

    const isWhite = game.playerWhite.userId === userId;

    game.status = isWhite ? GameStatus.BLACK_WINS : GameStatus.WHITE_WINS;
    game.reasonForEnding = ReasonForEnding.RESIGNED;

    await this.applyElo(game);
    await this.gameRepository.save(game);

    return game;
  }

  async drawByAgreement(userId: number, gameId: unknown): Promise<GameResDto> {
    const game = await this.getGameById(gameId);

    if (game.status !== GameStatus.IN_PROGRESS) {
      throw new AppException(
        ErrorCode.GAME_NOT_IN_PROGRESS,
        'Game not in progress',
      );
    }

    if (
      game.playerWhite.userId !== userId &&
      game.playerBlack.userId !== userId
    ) {
      throw new AppException(
        ErrorCode.USER_NOT_IN_GAME,
        'You are not a player in this game',
      );
    }

    game.status = GameStatus.DRAW;
    game.reasonForEnding = ReasonForEnding.DRAW_AGREEMENT;

    await this.applyElo(game);
    await this.gameRepository.save(game);

    return game;
  }

  async abortGame(userId: number, gameId: unknown): Promise<GameResDto> {
    const safeGameId = this.normalizeGameId(gameId);
    const game = await this.getGameById(gameId);

    if (game.status !== GameStatus.IN_PROGRESS) {
      throw new AppException(
        ErrorCode.GAME_NOT_IN_PROGRESS,
        'Game not in progress',
      );
    }

    if (
      game.playerWhite.userId !== userId &&
      game.playerBlack.userId !== userId
    ) {
      throw new AppException(
        ErrorCode.USER_NOT_IN_GAME,
        'You are not a player in this game',
      );
    }

    const moveCount = await this.moveService.countAll(safeGameId);
    if (moveCount >= 3) {
      throw new AppException(
        ErrorCode.INVALID_MOVE,
        'Game can no longer be aborted',
      );
    }

    game.status = GameStatus.ABORTED;
    game.reasonForEnding = ReasonForEnding.ABORTED;

    await this.gameRepository.save(game);

    return game;
  }

  async forfeitByDisconnect(
    userId: number,
    gameId: unknown,
  ): Promise<GameResDto | null> {
    const game = await this.getGameById(gameId);

    if (!game) {
      throw new AppException(ErrorCode.GAME_NOT_FOUND, 'Game not found');
    }

    if (game.status !== GameStatus.IN_PROGRESS) {
      throw new AppException(
        ErrorCode.GAME_NOT_IN_PROGRESS,
        'Game not in progress',
      );
    }

    if (
      game.playerWhite.userId !== userId &&
      game.playerBlack.userId !== userId
    )
      throw new AppException(
        ErrorCode.USER_NOT_IN_GAME,
        'You are not a player in this game',
      );

    const isWhite = game.playerWhite.userId === userId;

    game.status = isWhite ? GameStatus.BLACK_WINS : GameStatus.WHITE_WINS;
    game.reasonForEnding = ReasonForEnding.DISCONNECT;

    await this.applyElo(game);
    await this.gameRepository.save(game);

    return game;
  }

  async getMovesByGameId(gameId: unknown) {
    const safeGameId = this.normalizeGameId(gameId);
    await this.getGameById(safeGameId);
    return this.moveService.findByGameId(safeGameId);
  }

  async getMoveCount(gameId: unknown): Promise<number> {
    return this.moveService.countAll(this.normalizeGameId(gameId));
  }

  async getGameDetail(
    gameId: unknown,
  ): Promise<
    GameResDto & { moves: Awaited<ReturnType<MoveService['findByGameId']>> }
  > {
    const safeGameId = this.normalizeGameId(gameId);
    const game = await this.getGameById(safeGameId);
    const moves = await this.moveService.findByGameId(safeGameId);
    return { ...game, moves };
  }

  async getGamesByUserId(
    userId: number,
    page = 1,
    limit = 10,
  ): Promise<PaginatedGames> {
    const safePage = Math.max(1, page);
    const safeLimit = [10, 20, 50, 100].includes(limit) ? limit : 10;
    const [games, total] = await this.gameRepository.findAndCount({
      where: [{ playerWhite: { userId } }, { playerBlack: { userId } }],
      relations: ['playerWhite', 'playerBlack', 'gameMode'],
      order: {
        date: 'DESC',
      },
      skip: (safePage - 1) * safeLimit,
      take: safeLimit,
    });
    return {
      items: games,
      total,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.max(1, Math.ceil(total / safeLimit)),
    };
  }

  async getGamesByUsername(username: string): Promise<GameResDto[]> {
    const games = await this.gameRepository.find({
      where: [{ playerWhite: { username } }, { playerBlack: { username } }],
      relations: ['playerWhite', 'playerBlack', 'gameMode'],
      order: {
        date: 'DESC',
      },
    });
    return games;
  }

  private async applyElo(game: GameResDto): Promise<void> {
    if (
      game.status === GameStatus.ABORTED ||
      game.status === GameStatus.IN_PROGRESS
    ) {
      return;
    }

    const whiteScore =
      game.status === GameStatus.WHITE_WINS
        ? 1
        : game.status === GameStatus.DRAW
          ? 0.5
          : 0;
    const blackScore =
      game.status === GameStatus.BLACK_WINS
        ? 1
        : game.status === GameStatus.DRAW
          ? 0.5
          : 0;

    const whiteElo = game.playerWhite.elo;
    const blackElo = game.playerBlack.elo;
    const whiteQ = Math.pow(10, whiteElo / 400);
    const blackQ = Math.pow(10, blackElo / 400);
    const whiteExpected = whiteQ / (whiteQ + blackQ);
    const blackExpected = blackQ / (whiteQ + blackQ);

    const nextWhiteElo = Math.round(
      whiteElo + this.getKFactor(whiteElo) * (whiteScore - whiteExpected),
    );
    const nextBlackElo = Math.round(
      blackElo + this.getKFactor(blackElo) * (blackScore - blackExpected),
    );

    game.playerWhite.elo = nextWhiteElo;
    game.playerBlack.elo = nextBlackElo;
    game.playerWhiteEloChange = nextWhiteElo - whiteElo;
    game.playerBlackEloChange = nextBlackElo - blackElo;

    await this.userService.updateElo(game.playerWhite.userId, nextWhiteElo);
    await this.userService.updateElo(game.playerBlack.userId, nextBlackElo);
  }

  private getKFactor(elo: number): number {
    if (elo < 1600) return 25;
    if (elo < 2000) return 20;
    if (elo < 2400) return 15;
    return 10;
  }

  private normalizeGameId(value: unknown): number {
    let candidate = value;

    if (typeof candidate === 'string' && candidate.trim().startsWith('{')) {
      try {
        candidate = JSON.parse(candidate) as unknown;
      } catch {
        throw new BadRequestException('Invalid gameId');
      }
    }

    if (candidate && typeof candidate === 'object' && 'gameId' in candidate) {
      candidate = candidate.gameId;
    }

    if (candidate && typeof candidate === 'object' && 'gameId' in candidate) {
      candidate = candidate.gameId;
    }

    const gameId =
      typeof candidate === 'number'
        ? candidate
        : typeof candidate === 'string'
          ? Number(candidate)
          : Number.NaN;

    if (!Number.isInteger(gameId) || gameId <= 0) {
      throw new BadRequestException('Invalid gameId');
    }

    return gameId;
  }
}
