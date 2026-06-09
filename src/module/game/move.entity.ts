import { Entity, ManyToOne, JoinColumn, PrimaryColumn, Column } from 'typeorm';
import { Game } from './game.entity';

@Entity('moves')
export class Move {
    @ManyToOne(() => Game, (game) => game.gameId)
    @JoinColumn({ name: 'game_id' })
    game: Game;

    @PrimaryColumn({ name: 'move_number', type: 'int' })
    moveNumber: number;

    @PrimaryColumn({ name: 'is_white_move', type: 'boolean' })
    isWhiteMove: boolean;

    @Column({ name: 'move_notation' })
    moveNotation: string;

    @Column({ name: 'time_taken', type: 'int' })
    timeTaken: number;
}