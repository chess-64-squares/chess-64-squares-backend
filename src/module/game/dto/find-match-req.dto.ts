import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty } from 'class-validator';

export class FindMatchReqDto {
  @Type(() => Number)
  @IsInt()
  @IsNotEmpty()
  gameModeId: number;
}
