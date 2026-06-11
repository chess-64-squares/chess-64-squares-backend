import { Injectable } from "@nestjs/common";
import { Move } from "./move.entity";
import { Repository } from "typeorm";
import { InjectRepository } from "@nestjs/typeorm";

@Injectable()
export class MoveService {
    constructor(
        @InjectRepository(Move)
        private readonly moveRepository: Repository<Move>,
    ) { }

    async create(moveData: Partial<Move>): Promise<Move> {
        const move = this.moveRepository.create(moveData);
        return this.moveRepository.save(move);
    }

    async count(gameId: number, isWhite: boolean): Promise<number> {
        return this.moveRepository.count({ where: { game: { gameId }, isWhite } });
    }
}