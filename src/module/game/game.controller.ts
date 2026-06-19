import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { GameService } from "./game.service";
import { ApiResponse } from "../../common/response/api-response";
import { GameResDto } from "./dto";

@Controller('game')
export class GameController {
    constructor(private readonly gameService: GameService) { }

    @Get('user/:userId')
    async getGamesByUserId(@Param('userId') userId: string): Promise<ApiResponse<GameResDto[]>> {
        return ApiResponse.success(await this.gameService.getGamesByUserId(Number(userId)));
    }

    @Get('user/:username')
    async getGamesByUsername(@Param('username') username: string): Promise<ApiResponse<GameResDto[]>> {
        return ApiResponse.success(await this.gameService.getGamesByUsername(username));
    }
}