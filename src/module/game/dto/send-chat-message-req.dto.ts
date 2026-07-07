import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsString, Length } from 'class-validator';

export class SendChatMessageReqDto {
  @Type(() => Number)
  @IsInt()
  @IsNotEmpty()
  gameId: number;

  @IsString()
  @IsNotEmpty()
  @Length(1, 500)
  message: string;
}
