import { Entity, ManyToOne, JoinColumn, PrimaryColumn, Column } from 'typeorm';
import { Game } from './game.entity';

@Entity('moves')
export class Move {
  @ManyToOne(() => Game, { nullable: false })
  @JoinColumn({ name: 'game_id' })
  game: Game;

  @PrimaryColumn({ name: 'game_id', type: 'int' })
  gameId: number;

  @PrimaryColumn({ name: 'move_number', type: 'int' })
  moveNumber: number;

  @PrimaryColumn({ name: 'is_white', type: 'boolean' })
  isWhite: boolean;

  @Column({ name: 'san' })
  san: string;

  @Column({ name: 'fen' })
  fen: string;

  @Column({ name: 'time_taken', type: 'int' })
  timeTaken: number;
}
