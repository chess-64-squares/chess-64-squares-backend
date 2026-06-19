import { UserStatus } from "../../../common/enum/user-status.enum";
import { GameResDto } from "../../game/dto";

export class UserResDto {
    userId: number;
    username: string;
    email: string;
    elo: number;
    status: UserStatus;
    isEmailVerified: boolean;
    createdAt: Date;
}