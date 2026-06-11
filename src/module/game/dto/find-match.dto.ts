import { IsInt, IsNotEmpty } from 'class-validator';

export class FindMatchDto {
    @IsInt()
    @IsNotEmpty()
    gameModeId: number;
}