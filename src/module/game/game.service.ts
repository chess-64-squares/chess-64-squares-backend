import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Game } from "./game.entity";
import { Repository } from "typeorm";
import { InjectRepository } from "@nestjs/typeorm";
import { CreateGameDto } from "./dto/create-game.dto";
import { GameMode } from "./game-mode.entity";
import { UserService } from "../user/user.service";
import { GameModeService } from "./game-mode.service";
import { Chess, Move } from "chess.js";
import { MakeMoveDto } from "./dto/make-move.dto";
import { ReasonForEnding } from "../../common/enum/reason-for-ending.enum";
import { GameStatus } from "../../common/enum/game-status.enum";
import { MoveService } from "./move.service";

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

    async create(playerWhiteId: number, playerBlackId: number, gameModeId: number): Promise<Game> {
        const playerWhite = await this.userService.findById(playerWhiteId);

        if (!playerWhite) {
            throw new BadRequestException('Player white not found');
        }

        const playerBlack = await this.userService.findById(playerBlackId);

        if (!playerBlack) {
            throw new BadRequestException('Player black not found');
        }

        const gameMode = await this.gameModeService.findById(gameModeId);

        if (!gameMode) {
            throw new BadRequestException('Game mode not found');
        }

        if (playerWhite.userId === playerBlack.userId) {
            throw new BadRequestException('Player white and player black must be different');
        }

        const newGame = this.gameRepository.create({
            playerWhite,
            playerBlack,
            gameMode,
        });

        return this.gameRepository.save(newGame);
    }

    async findMatch(
        userId: number,
        gameModeId: number,
        socketId: string,
    ): Promise<Game | null> {
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

    async getGameById(gameId: number): Promise<Game> {
        const game = await this.gameRepository.findOne({
            where: { gameId },
            relations: ['playerWhite', 'playerBlack', 'gameMode'],
        });
        if (!game) {
            throw new NotFoundException('Trận đấu không tồn tại');
        }
        return game;
    }

    async makeMove(
        userId: number,
        dto: MakeMoveDto,
    ): Promise<{
        game: Game;
        san: string;
        status: GameStatus;
        reasonForEnding: ReasonForEnding | null;
    }> {
        const game = await this.getGameById(dto.gameId);

        if (game.status !== GameStatus.IN_PROGRESS) {
            throw new BadRequestException('Trận đấu không ở trạng thái đang diễn ra');
        }

        if (game.playerWhite.userId !== userId && game.playerBlack.userId !== userId) {
            throw new BadRequestException('Bạn không phải người chơi trong trận này');
        }

        const isWhite = game.playerWhite.userId === userId;


        const chess = new Chess(game.fen);

        // Kiểm tra đúng lượt
        const turn = chess.turn(); // 'w' hoặc 'b'
        if ((turn === 'w' && !isWhite) || (turn === 'b' && isWhite)) {
            throw new BadRequestException('Chưa đến lượt của bạn');
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
            throw new BadRequestException('Nước đi không hợp lệ');
        }

        // Cập nhật FEN mới vào game
        game.fen = chess.fen();

        // Lưu lịch sử nước đi
        const moveCount = await this.moveService.count(game.gameId, isWhite);
        await this.moveService.create({
            game,
            isWhite,
            moveNumber: moveCount + 1,
            san: moveResult.san,
            fen: chess.fen(),
        });
        // Kiểm tra kết thúc ván
        let isGameOver = false;
        let reasonForEnding: ReasonForEnding | undefined;
        let winnerId: number | null | undefined;

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

        return {
            game,
            san: moveResult.san,
            status: game.status,
            reasonForEnding: game.reasonForEnding,
        };
    }

    async resign(userId: number, gameId: number,): Promise<{ game: Game; status: GameStatus; reasonForEnding: ReasonForEnding }> {
        const game = await this.getGameById(gameId);

        if (game.status !== GameStatus.IN_PROGRESS) {
            throw new BadRequestException('Trận đấu không ở trạng thái đang diễn ra');
        }

        if (game.playerWhite.userId !== userId && game.playerBlack.userId !== userId) {
            throw new BadRequestException('Bạn không phải người chơi trong trận này');
        }

        const isWhite = game.playerWhite.userId === userId;

        game.status = isWhite ? GameStatus.BLACK_WINS : GameStatus.WHITE_WINS;
        game.reasonForEnding = ReasonForEnding.RESIGNED;

        await this.gameRepository.save(game);

        return { game, status: game.status, reasonForEnding: game.reasonForEnding };
    }

    async forfeitByDisconnect(userId: number, gameId: number): Promise<{ game: Game; status: GameStatus; reasonForEnding: ReasonForEnding } | null> {
        const game = await this.getGameById(gameId);

        if (game.status !== GameStatus.IN_PROGRESS) {
            return null;
        }

        if(game.playerWhite.userId !== userId && game.playerBlack.userId !== userId) 
            throw new BadRequestException('Bạn không phải người chơi trong trận này');

        const isWhite = game.playerWhite.userId === userId;

        if (!isWhite) {
            return null;
        }

        game.status = isWhite ? GameStatus.BLACK_WINS : GameStatus.WHITE_WINS;
        game.reasonForEnding = ReasonForEnding.DISCONNECT;

        await this.gameRepository.save(game);

        return { game, status: game.status, reasonForEnding: game.reasonForEnding };
    }
}