import { Injectable } from "@nestjs/common";
import { Move } from "./move.entity";
import { Repository } from "typeorm";
import { InjectRepository } from "@nestjs/typeorm";
import { MoveDto } from "./dto";
import { Game } from "./game.entity";
import { AppException, ErrorCode } from "../../common/exceptions";

@Injectable()
export class MoveService {
    constructor(
        @InjectRepository(Move)
        private readonly moveRepository: Repository<Move>,
        private readonly gameRepository: Repository<Game>,

    ) { }

    async create(moveDto: MoveDto): Promise<Move> {
        const game = await this.gameRepository.findOne({
            where: { gameId: moveDto.gameId },
        });

        if (!game) {
            throw new AppException(ErrorCode.GAME_NOT_FOUND, "Game not found")
        }

        const move = this.moveRepository.create({
            game,
            moveNumber: moveDto.moveNumber,
            isWhite: moveDto.isWhite,
            san: moveDto.san,
            fen: moveDto.fen,
            timeTaken: moveDto.timeTaken,
        });

        return this.moveRepository.save(move);
    }

    async count(gameId: number, isWhite: boolean): Promise<number> {
        return this.moveRepository.count({ where: { game: { gameId }, isWhite } });
    }
}