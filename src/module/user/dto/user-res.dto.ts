import { UserStatus } from "../../../common/enum/user-status.enum";

export class UserResDto {
    userId: number;
    username: string;
    email: string;
    elo: number;
    status: UserStatus;
    isEmailVerified: boolean;
    createdAt: Date;
}