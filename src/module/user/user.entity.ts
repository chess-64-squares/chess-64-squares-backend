import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity('user')
export class User {
    @PrimaryGeneratedColumn({ name: 'user_id' })
    userId: string;

    @Column({ name: 'username', unique: true })
    username: string;

    @Column({ name: 'password' })
    password: string;

    @Column({ name: 'email', unique: true })
    email: string;

    @Column({ name: 'elo', default: 800 })
    elo: number;

    @Column({ name: 'created_at', default: new Date() })
    createdAt: Date;
}