import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsString } from 'class-validator';

export class MakeMoveReqDto {
    @Type(() => Number)
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