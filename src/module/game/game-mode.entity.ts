import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity('game_modes')
export class GameMode {
    @PrimaryGeneratedColumn({ name: 'game_mode_id' })
    gameModeId: number;

    @Column({ name: 'game_mode_name', unique: true })
    gameModeName: string;

    @Column({ name: 'time', default: 10 })
    time: number;

    @Column({ name: 'plus_per_move', default: 0 })
    plusPerMove: number;
}