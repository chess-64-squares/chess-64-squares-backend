import { IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { MAX_CHAT_LENGTH } from 'chess-64-squares-shared';

const SQUARE = /^[a-h][1-8]$/;

export class GameJoinWsDto {
  @IsUUID()
  gameId!: string;
}

export class GameMoveWsDto {
  @IsUUID()
  gameId!: string;

  @Matches(SQUARE)
  from!: string;

  @Matches(SQUARE)
  to!: string;

  @IsOptional()
  @IsIn(['q', 'r', 'b', 'n'])
  promotion?: 'q' | 'r' | 'b' | 'n';
}

export class GameChatWsDto {
  @IsUUID()
  gameId!: string;

  @IsString()
  @MaxLength(MAX_CHAT_LENGTH)
  message!: string;
}
