import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('puzzle_attempts')
export class PuzzleAttempt {
  @PrimaryGeneratedColumn({ name: 'id' })
  id: number;

  @Column({ name: 'user_id', type: 'int' })
  userId: number;

  @Column({ name: 'puzzle_id', type: 'int' })
  puzzleId: number;

  @Column({ name: 'solved', type: 'boolean' })
  solved: boolean;

  @Column({
    name: 'attempted_at',
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
  })
  attemptedAt: Date;
}
