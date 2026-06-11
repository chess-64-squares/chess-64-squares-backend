// src/modules/game/dto/make-move.dto.ts
import { IsInt, IsNotEmpty, IsString } from 'class-validator';

export class MakeMoveDto {
    @IsInt()
    @IsNotEmpty()
    gameId: number;

    @IsString()
    @IsNotEmpty()
    from: string;

    @IsString()
    @IsNotEmpty()
    to: string;

    @IsString()
    promotion: string;
}