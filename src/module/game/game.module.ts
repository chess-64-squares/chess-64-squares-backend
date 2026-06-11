// src/modules/game/game.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Game } from './game.entity';
import { Move } from './move.entity';
import { GameMode } from './game-mode.entity';
import { User } from '../user/user.entity';
import { GameService } from './game.service';
import { GameGateway } from './game.gateway';
import { GameController } from './game.controller';

@Module({
    imports: [TypeOrmModule.forFeature([Game, Move, GameMode, User])],
    providers: [GameService, GameGateway],
    controllers: [GameController],
    exports: [GameService],
})
export class GameModule {}