import { Module } from '@nestjs/common';
import { GamesModule } from '../games/games.module';
import { RatingsModule } from '../ratings/ratings.module';
import { MatchmakingGateway } from './matchmaking.gateway';
import { MatchmakingService } from './matchmaking.service';

@Module({
  imports: [GamesModule, RatingsModule],
  providers: [MatchmakingService, MatchmakingGateway],
})
export class MatchmakingModule {}
