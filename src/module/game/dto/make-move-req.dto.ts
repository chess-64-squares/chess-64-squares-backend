import { IsInt, IsNotEmpty, IsString } from 'class-validator';

export class MakeMoveReqDto {
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