import {
    Column,
    Entity,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
} from 'typeorm';

import { User } from '../user/user.entity';
import { GameStatus } from '../../common/enum/game-status.enum';
import { GameMode } from './game-mode.entity';
import { ReasonForEnding } from '../../common/enum/reason-for-ending.enum';

@Entity('games')
export class Game {
    @PrimaryGeneratedColumn({ name: 'game_id' })
    gameId: number;

    @ManyToOne(() => User, { nullable: false })
    @JoinColumn({ name: 'player_white_id' })
    playerWhite: User;

    @ManyToOne(() => User, { nullable: false })
    @JoinColumn({ name: 'player_black_id' })
    playerBlack: User;

    @ManyToOne(() => GameMode, { nullable: false })
    @JoinColumn({ name: 'game_mode_id' })
    gameMode: GameMode;

    @Column({ name: 'fen', default: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1' })
    fen: string;

    @Column({ name: 'status', type: 'enum', enum: GameStatus, default: GameStatus.WAITING_FOR_OPPONENT })
    status: GameStatus;

    @Column({ name: 'reason_for_ending', type: 'enum', enum: ReasonForEnding, nullable: true, default: null })
    reasonForEnding: ReasonForEnding | null;

    @Column({ name: 'date', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
    date: Date;
}