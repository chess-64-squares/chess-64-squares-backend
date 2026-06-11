import { BadRequestException, Injectable } from "@nestjs/common";
import { Game } from "./game.entity";
import { Repository } from "typeorm";
import { InjectRepository } from "@nestjs/typeorm";
import { CreateGameDto } from "./dto/create-game.dto";
import { GameMode } from "./game-mode.entity";
import { UserService } from "../user/user.service";
import { GameModeService } from "./game-mode.service";

@Injectable()
export class GameService {
    constructor(
        @InjectRepository(Game)
        private readonly gameRepository: Repository<Game>,

        private readonly userService: UserService,
        private readonly gameModeService: GameModeService
    ) { }

    async create(createGameDto: CreateGameDto): Promise<Game> {
        const playerWhite = await this.userService.findById(
            createGameDto.playerWhiteId,
        );

        if(!playerWhite) {
            throw new BadRequestException('Player white not found');
        }

        const playerBlack = await this.userService.findById(
            createGameDto.playerBlackId,
        );

        if(!playerBlack) {
            throw new BadRequestException('Player black not found');
        }

        const gameMode = await this.gameModeService.findById(
            createGameDto.gameModeId,
        );

        if(!gameMode) {
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
}