import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";
import { User } from "../user/user.entity";
import { GameStatus } from "../../common/enum/game-status.enum";
import { GameResult } from "../../common/enum/game-result.enum";
import { GameMode } from "./game-mode.entity";

@Entity('games')
export class Game {
    @PrimaryGeneratedColumn({ name: 'game_id' })
    gameId: number;

    @Column({ name: 'player_white_id' })
    playerWhite: User;

    @Column({ name: 'player_black_id' })
    playerBlack: User;

    @Column({ name: 'status', default: GameStatus.WAITING_FOR_OPPONENT })
    status: GameStatus;

    @Column({ name: 'date', default: new Date() })
    date: Date;

    @Column({ name: 'result', default: null })
    result: GameResult;

    @Column({ name: 'game_mode' })
    gameMode: GameMode;
}