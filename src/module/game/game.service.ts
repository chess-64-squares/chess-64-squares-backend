import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Game } from "./game.entity";
import { Repository } from "typeorm";
import { InjectRepository } from "@nestjs/typeorm";
import { UserService } from "../user/user.service";
import { GameModeService } from "./game-mode.service";
import { Chess } from "chess.js";
import { MakeMoveReqDto, GameResDto } from "./dto";
import { ReasonForEnding } from "../../common/enum/reason-for-ending.enum";
import { GameStatus } from "../../common/enum/game-status.enum";
import { MoveService } from "./move.service";
import { AppException, ErrorCode } from "../../common/exceptions";

interface QueueEntry {
    userId: number;
    gameModeId: number;
    socketId: string;
}

@Injectable()
export class GameService {
    private matchmakingQueue: Map<number, QueueEntry[]> = new Map();
    constructor(
        @InjectRepository(Game)
        private readonly gameRepository: Repository<Game>,

        private readonly moveService: MoveService,
        private readonly userService: UserService,
        private readonly gameModeService: GameModeService
    ) { }

    async create(playerWhiteId: number, playerBlackId: number, gameModeId: number): Promise<GameResDto> {
        const playerWhite = await this.userService.findById(playerWhiteId);

        if (!playerWhite) {
            throw new AppException(ErrorCode.USER_NOT_FOUND, 'Player white not found');
        }

        const playerBlack = await this.userService.findById(playerBlackId);

        if (!playerBlack) {
            throw new AppException(ErrorCode.USER_NOT_FOUND, 'Player black not found');
        }

        const gameMode = await this.gameModeService.findById(gameModeId);

        if (!gameMode) {
            throw new AppException(ErrorCode.GAME_MODE_NOT_FOUND, 'Game mode not found');
        }

        if (playerWhite.userId === playerBlack.userId) {
            throw new AppException(ErrorCode.USERS_SAME, 'Players cannot be the same');
        }

        const newGame = this.gameRepository.create({
            playerWhite,
            playerBlack,
            gameMode,
        });

        const savedGame = await this.gameRepository.save(newGame);
        const gameRes: GameResDto = {
            gameId: savedGame.gameId,
            playerWhite: savedGame.playerWhite,
            playerBlack: savedGame.playerBlack,
            gameMode: savedGame.gameMode,
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
        return this.matchmakingQueue.get(gameModeId)?.find((e) => e.userId === userId);
    }

    async getGameById(gameId: number): Promise<GameResDto> {
        const game = await this.gameRepository.findOne({
            where: { gameId },
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
    ): Promise<{ game: GameResDto; san: string; }> {
        const game = await this.getGameById(dto.gameId);

        if (game.status !== GameStatus.IN_PROGRESS) {
            throw new AppException(ErrorCode.GAME_NOT_IN_PROGRESS, 'Game not in progress');
        }

        if (game.playerWhite.userId !== userId && game.playerBlack.userId !== userId) {
            throw new AppException(ErrorCode.USER_NOT_IN_GAME, 'You are not a player in this game');
        }

        const isWhite = game.playerWhite.userId === userId;


        const chess = new Chess(game.fen);

        // Kiểm tra đúng lượt
        const turn = chess.turn(); // 'w' hoặc 'b'
        if ((turn === 'w' && !isWhite) || (turn === 'b' && isWhite)) {
            throw new AppException(ErrorCode.NOT_YOUR_TURN, 'Not your turn');
        }

        // Thử thực hiện nước đi
        let moveResult;
        try {
            moveResult = chess.move({
                from: dto.from,
                to: dto.to,
                promotion: dto.promotion,
            });
        } catch (error) {
            moveResult = null;
        }

        if (!moveResult) {
            throw new AppException(ErrorCode.INVALID_MOVE, 'Invalid move');
        }

        // Cập nhật FEN mới vào game
        game.fen = chess.fen();

        // Lưu lịch sử nước đi
        const moveCount = await this.moveService.count(game.gameId, isWhite);

        await this.moveService.create({
            gameId: game.gameId,
            isWhite,
            moveNumber: moveCount + 1,
            san: moveResult.san,
            fen: chess.fen(),
            timeTaken: 0,
        });
        // Kiểm tra kết thúc ván
        let isGameOver = false;
        let reasonForEnding: ReasonForEnding | undefined;

        if (chess.isGameOver()) {
            isGameOver = true;

            if (chess.isCheckmate()) {
                reasonForEnding = ReasonForEnding.CHECKMATED;
                // Người vừa đi là người thắng (đối phương bị chiếu hết)
                if (isWhite) {
                    game.status = GameStatus.WHITE_WINS;
                } else {
                    game.status = GameStatus.BLACK_WINS;
                }
            } else if (chess.isStalemate()) {
                reasonForEnding = ReasonForEnding.STALEMATE;
                game.status = GameStatus.DRAW;
            } else if (chess.isThreefoldRepetition()) {
                reasonForEnding = ReasonForEnding.REPETITION;
                game.status = GameStatus.DRAW;
            } else if (chess.isInsufficientMaterial()) {
                reasonForEnding = ReasonForEnding.INSUFFICIENT_MATERIAL;
                game.status = GameStatus.DRAW;
            } else if (chess.isDraw()) {
                game.status = GameStatus.DRAW;
            }

            game.reasonForEnding = reasonForEnding ?? null;
        }

        await this.gameRepository.save(game);

        return { game, san: moveResult.san };
    }

    async resign(userId: number, gameId: number,): Promise<GameResDto> {
        const game = await this.getGameById(gameId);

        if (game.status !== GameStatus.IN_PROGRESS) {
            throw new AppException(ErrorCode.GAME_NOT_IN_PROGRESS, 'Game not in progress');
        }

        if (game.playerWhite.userId !== userId && game.playerBlack.userId !== userId) {
            throw new AppException(ErrorCode.USER_NOT_IN_GAME, 'You are not a player in this game');
        }

        const isWhite = game.playerWhite.userId === userId;

        game.status = isWhite ? GameStatus.BLACK_WINS : GameStatus.WHITE_WINS;
        game.reasonForEnding = ReasonForEnding.RESIGNED;

        await this.gameRepository.save(game);

        return game;
    }

    async forfeitByDisconnect(userId: number, gameId: number): Promise<GameResDto | null> {
        const game = await this.getGameById(gameId);

        if (!game) {
            throw new AppException(ErrorCode.GAME_NOT_FOUND, 'Game not found');
        }

        if (game.status !== GameStatus.IN_PROGRESS) {
            throw new AppException(ErrorCode.GAME_NOT_IN_PROGRESS, 'Game not in progress');
        }

        if (game.playerWhite.userId !== userId && game.playerBlack.userId !== userId)
            throw new AppException(ErrorCode.USER_NOT_IN_GAME, 'You are not a player in this game');

        const isWhite = game.playerWhite.userId === userId;

        game.status = isWhite ? GameStatus.BLACK_WINS : GameStatus.WHITE_WINS;
        game.reasonForEnding = ReasonForEnding.DISCONNECT;

        await this.gameRepository.save(game);

        return game;
    }
}