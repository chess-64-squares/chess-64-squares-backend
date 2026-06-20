import { BadRequestException, Injectable } from '@nestjs/common';
import { Move } from './move.entity';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { MoveDto } from './dto';
import { Game } from './game.entity';
import { AppException, ErrorCode } from '../../common/exceptions';

@Injectable()
export class MoveService {
  constructor(
    @InjectRepository(Move)
    private readonly moveRepository: Repository<Move>,
    @InjectRepository(Game)
    private readonly gameRepository: Repository<Game>,
  ) { }

  async create(moveDto: MoveDto): Promise<Move> {
    const gameId = this.normalizeGameId(moveDto.gameId);
    const game = await this.gameRepository.findOne({
      where: { gameId },
    });

    if (!game) {
      throw new AppException(ErrorCode.GAME_NOT_FOUND, 'Game not found');
    }

    const move = this.moveRepository.create({
      game,
      moveNumber: moveDto.moveNumber,
      isWhite: moveDto.isWhite,
      san: moveDto.san,
      fen: moveDto.fen,
      timeTaken: moveDto.timeTaken,
    });

    return this.moveRepository.save(move);
  }

  async count(gameId: unknown, isWhite: boolean): Promise<number> {
    return this.moveRepository
      .createQueryBuilder('move')
      .where('move.game_id = :gameId', { gameId: this.normalizeGameId(gameId) })
      .andWhere('move.is_white = :isWhite', { isWhite })
      .getCount();
  }

  async countAll(gameId: unknown): Promise<number> {
    return this.moveRepository
      .createQueryBuilder('move')
      .where('move.game_id = :gameId', { gameId: this.normalizeGameId(gameId) })
      .getCount();
  }

  async findByGameId(gameId: unknown): Promise<Move[]> {
    return this.moveRepository
      .createQueryBuilder('move')
      .where('move.game_id = :gameId', { gameId: this.normalizeGameId(gameId) })
      .orderBy('move.move_number', 'ASC')
      .addOrderBy('move.is_white', 'DESC')
      .getMany();
  }

  private normalizeGameId(value: unknown): number {
    let candidate = value;

    if (typeof candidate === 'string' && candidate.trim().startsWith('{')) {
      try {
        candidate = JSON.parse(candidate) as unknown;
      } catch {
        throw new BadRequestException('Invalid gameId');
      }
    }

    if (candidate && typeof candidate === 'object' && 'gameId' in candidate) {
      candidate = candidate.gameId;
    }

    if (candidate && typeof candidate === 'object' && 'gameId' in candidate) {
      candidate = candidate.gameId;
    }

    const gameId =
      typeof candidate === 'number'
        ? candidate
        : typeof candidate === 'string'
          ? Number(candidate)
          : Number.NaN;

    if (!Number.isInteger(gameId) || gameId <= 0) {
      throw new BadRequestException('Invalid gameId');
    }

    return gameId;
  }
}
