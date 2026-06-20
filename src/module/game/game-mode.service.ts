import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GameMode } from './game-mode.entity';

@Injectable()
export class GameModeService implements OnModuleInit {
  constructor(
    @InjectRepository(GameMode)
    private readonly gameModeRepository: Repository<GameMode>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.seedDefaultModes();
  }

  async findById(gameModeId: number): Promise<GameMode | null> {
    return this.gameModeRepository.findOne({
      where: { gameModeId },
    });
  }

  async findAll(): Promise<GameMode[]> {
    return this.gameModeRepository.find({
      order: {
        time: 'DESC',
        plusPerMove: 'DESC',
      },
    });
  }

  private async seedDefaultModes(): Promise<void> {
    const defaultModes: Partial<GameMode>[] = [
      { gameModeId: 1, gameModeName: 'Rapid 10+0', time: 10, plusPerMove: 0 },
      { gameModeId: 2, gameModeName: 'Blitz 5+0', time: 5, plusPerMove: 0 },
      { gameModeId: 3, gameModeName: 'Bullet 1+0', time: 1, plusPerMove: 0 },
    ];

    for (const mode of defaultModes) {
      const existing = await this.gameModeRepository.findOne({
        where: [
          { gameModeId: mode.gameModeId },
          { gameModeName: mode.gameModeName },
        ],
      });

      if (!existing) {
        await this.gameModeRepository.save(
          this.gameModeRepository.create(mode),
        );
      }
    }
  }
}
