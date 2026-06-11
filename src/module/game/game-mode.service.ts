import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { GameMode } from "./game-mode.entity";

@Injectable()
export class GameModeService {
    constructor(
        @InjectRepository(GameMode)
        private readonly gameModeRepository: Repository<GameMode>
    ) { }

    async findById(gameModeId: number): Promise<GameMode | null> {
        return this.gameModeRepository.findOne({
            where: { gameModeId },
        });
    }
}