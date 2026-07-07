import { BadRequestException, Injectable } from '@nestjs/common';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { ChatMessage } from './chat-message.entity';

@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(ChatMessage)
    private readonly chatMessageRepository: Repository<ChatMessage>,
  ) { }

  async create(
    gameId: number,
    senderId: number,
    message: string,
  ): Promise<ChatMessage> {
    const chatMessage = this.chatMessageRepository.create({
      gameId,
      senderId,
      message,
    });

    return this.chatMessageRepository.save(chatMessage);
  }

  async findByGameId(gameId: unknown): Promise<ChatMessage[]> {
    return this.chatMessageRepository
      .createQueryBuilder('chatMessage')
      .where('chatMessage.game_id = :gameId', {
        gameId: this.normalizeGameId(gameId),
      })
      .orderBy('chatMessage.created_at', 'ASC')
      .getMany();
  }

  private normalizeGameId(value: unknown): number {
    const gameId =
      typeof value === 'number'
        ? value
        : typeof value === 'string'
          ? Number(value)
          : Number.NaN;

    if (!Number.isInteger(gameId) || gameId <= 0) {
      throw new BadRequestException('Invalid gameId');
    }

    return gameId;
  }
}
