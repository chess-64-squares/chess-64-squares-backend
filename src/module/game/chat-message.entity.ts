import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('chat_messages')
export class ChatMessage {
  @PrimaryGeneratedColumn({ name: 'id' })
  id: number;

  @Column({ name: 'game_id', type: 'int' })
  gameId: number;

  @Column({ name: 'sender_id', type: 'int' })
  senderId: number;

  @Column({ name: 'message', type: 'varchar', length: 500 })
  message: string;

  @Column({
    name: 'created_at',
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
  })
  createdAt: Date;
}
