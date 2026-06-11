import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";
import { UserStatus } from "../../common/enum/user-status.enum";

@Entity('user')
export class User {
    @PrimaryGeneratedColumn({ name: 'user_id' })
    userId: number;

    @Column({ name: 'username', unique: true })
    username: string;

    @Column({ name: 'password' })
    password: string;

    @Column({ name: 'email', unique: true })
    email: string;

    @Column({ name: 'elo', default: 800 })
    elo: number;

    @Column({ name: 'status', default: UserStatus.ACTIVE })
    status: UserStatus;

    @Column({ default: false })
    isEmailVerified: boolean;

    @Column({ name: 'created_at', default: new Date() })
    createdAt: Date;
}