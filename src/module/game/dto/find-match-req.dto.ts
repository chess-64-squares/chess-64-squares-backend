import { IsInt, IsNotEmpty } from 'class-validator';

export class FindMatchReqDto {
    @IsInt()
    @IsNotEmpty()
    gameModeId: number;
}