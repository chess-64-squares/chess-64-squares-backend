import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { ChatMessagePayload } from 'chess-64-squares-shared';
import { ChatMessageEntity, UserEntity } from '../database/entities';

@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(ChatMessageEntity)
    private readonly messages: Repository<ChatMessageEntity>,
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
  ) {}

  async save(gameId: string, userId: string, message: string): Promise<void> {
    await this.messages.insert({ gameId, userId, message });
  }

  async list(gameId: string, limit = 100): Promise<ChatMessagePayload[]> {
    const rows = await this.messages.find({
      where: { gameId },
      order: { sentAt: 'ASC' },
      take: limit,
    });
    if (rows.length === 0) return [];
    const userIds = [...new Set(rows.map((r) => r.userId))];
    const userRows = await this.users.createQueryBuilder('u').whereInIds(userIds).getMany();
    const byId = new Map(userRows.map((u) => [u.id, u.username]));
    return rows.map((r) => ({
      gameId: r.gameId,
      userId: r.userId,
      username: byId.get(r.userId) ?? 'Unknown',
      message: r.message,
      sentAt: r.sentAt.toISOString(),
    }));
  }
}
