import { GameStatus } from '../../../common/enum/game-status.enum';
import { ReasonForEnding } from '../../../common/enum/reason-for-ending.enum';

export type RedisGameState = {
  gameId: number;
  whitePlayerId: number;
  blackPlayerId: number;
  gameModeId: number;
  fen: string;
  moves: string[];
  status: GameStatus;
  reasonForEnding: ReasonForEnding | null;
  whiteTimeLeftSeconds: number;
  blackTimeLeftSeconds: number;
  startedAt: string;
};
