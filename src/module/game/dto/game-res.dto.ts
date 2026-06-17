import { GameStatus } from "../../../common/enum/game-status.enum";
import { ReasonForEnding } from "../../../common/enum/reason-for-ending.enum";
import { User } from "../../user/user.entity";
import { GameMode } from "../game-mode.entity";

export class GameResDto {
    gameId: number;
    playerWhite: User;
    playerBlack: User;
    gameMode: GameMode;
    fen: string;
    status: GameStatus;
    reasonForEnding: ReasonForEnding | null;
    date: Date;
}