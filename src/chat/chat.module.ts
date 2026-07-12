import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatMessageEntity, UserEntity } from '../database/entities';
import { ChatService } from './chat.service';

@Module({
  imports: [TypeOrmModule.forFeature([ChatMessageEntity, UserEntity])],
  providers: [ChatService],
  exports: [ChatService],
})
export class ChatModule {}
