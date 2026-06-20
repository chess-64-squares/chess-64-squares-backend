import { GameStatus } from '../../../common/enum/game-status.enum';
import { ReasonForEnding } from '../../../common/enum/reason-for-ending.enum';
import { UserResDto } from '../../user/dto/user-res.dto';
import { GameModeResDto } from './';

export class GameResDto {
  gameId: number;
  playerWhite: UserResDto;
  playerBlack: UserResDto;
  gameMode: GameModeResDto;
  playerWhiteElo: number;
  playerBlackElo: number;
  fen: string;
  status: GameStatus;
  reasonForEnding: ReasonForEnding | null;
  date: Date;
}
