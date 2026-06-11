import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CreateGameDto } from "./dto/create-game.dto";
import { GameService } from "./game.service";

@Controller('game')
export class GameController {
    constructor(private readonly gameService: GameService) { }
    @Post()
    @UseGuards(JwtAuthGuard)
    async createGame(@Body() createGameDto: CreateGameDto) {

        return this.gameService.create(createGameDto);
    }
}