import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('puzzles')
export class Puzzle {
  @PrimaryGeneratedColumn({ name: 'puzzle_id' })
  puzzleId: number;

  @Column({ name: 'fen' })
  fen: string;

  @Column({ name: 'solution_moves' })
  solutionMoves: string;

  @Column({ name: 'rating', type: 'int', default: 1200 })
  rating: number;

  @Column({ name: 'theme' })
  theme: string;

  @Column({ name: 'side_to_move' })
  sideToMove: 'white' | 'black';
}
