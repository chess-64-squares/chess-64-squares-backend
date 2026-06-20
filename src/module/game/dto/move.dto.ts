import { IsInt } from 'class-validator';

export class MoveDto {
  @IsInt()
  gameId: number;
  moveNumber: number;
  isWhite: boolean;
  san: string;
  fen: string;
  timeTaken: number;
}
