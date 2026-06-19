import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { GameService } from "./game.service";

@Controller('game')
export class GameController {
    constructor(private readonly gameService: GameService) { }
}