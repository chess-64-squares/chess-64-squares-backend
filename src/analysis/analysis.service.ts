import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { Repository } from 'typeorm';
import type {
  AnalysisProgressBroadcast,
  GameAnalysisResult,
  MoveAnalysisRecord,
} from 'chess-64-squares-shared';
import { REDIS_CLIENT } from '../common/redis/redis.module';
import {
  GameAnalysisEntity,
  GameEntity,
  GameMoveEntity,
  MoveAnalysisEntity,
} from '../database/entities';
import { QueueProducerService } from '../queues/queue-producer.service';

/** rolling average job duration, maintained by the worker */
export const ANALYSIS_AVG_MS_KEY = 'c64:analysis:avgms';
const MAX_BACKLOG = parseInt(process.env.ANALYSIS_MAX_BACKLOG ?? '1000', 10);

@Injectable()
export class AnalysisService {
  constructor(
    @InjectRepository(GameEntity) private readonly games: Repository<GameEntity>,
    @InjectRepository(GameMoveEntity) private readonly moves: Repository<GameMoveEntity>,
    @InjectRepository(GameAnalysisEntity)
    private readonly analyses: Repository<GameAnalysisEntity>,
    @InjectRepository(MoveAnalysisEntity)
    private readonly moveAnalyses: Repository<MoveAnalysisEntity>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly producer: QueueProducerService,
  ) {}

  /**
   * Request analysis for a finished game. Results are computed ONCE and
   * reused; saturated workers put requests in 'deferred' instead of failing
   * (ARCHITECTURE.md §2.9).
   */
  async request(gameId: string, requesterId: string): Promise<AnalysisProgressBroadcast> {
    const game = await this.games.findOneBy({ id: gameId });
    if (!game) throw new NotFoundException('Game not found');
    if (!game.endedAt) throw new BadRequestException('The game is still running');
    if (game.plyCount < 2) throw new BadRequestException('Nothing to analyze');

    const existing = await this.analyses.findOneBy({ gameId });
    if (existing && ['queued', 'running', 'complete'].includes(existing.status)) {
      if (existing.status === 'complete') {
        throw new ConflictException('Analysis already available');
      }
      return {
        gameId,
        status: existing.status as AnalysisProgressBroadcast['status'],
        completedPlies: 0,
        totalPlies: game.plyCount,
      };
    }

    const backlog = await this.producer.analysisBacklog();
    if (backlog >= MAX_BACKLOG) {
      await this.analyses.upsert(
        { gameId, status: 'deferred', requestedAt: new Date() },
        ['gameId'],
      );
      return { gameId, status: 'deferred', completedPlies: 0, totalPlies: game.plyCount };
    }

    await this.analyses.upsert(
      { gameId, status: 'queued', requestedAt: new Date(), error: null },
      ['gameId'],
    );
    const { queuePosition } = await this.producer.enqueueAnalysis({
      gameId,
      notifyUserIds: [game.whiteUserId, game.blackUserId, requesterId].filter(
        (v, i, arr): v is string => v !== null && arr.indexOf(v) === i,
      ),
    });

    const avgMs = Number(await this.redis.get(ANALYSIS_AVG_MS_KEY).catch(() => null)) || 15_000;
    return {
      gameId,
      status: 'queued',
      completedPlies: 0,
      totalPlies: game.plyCount,
      queuePosition,
      etaSeconds: Math.round(((queuePosition + 1) * avgMs) / 1000),
    };
  }

  async result(gameId: string): Promise<GameAnalysisResult> {
    const [analysis, moveRows, analysisRows] = await Promise.all([
      this.analyses.findOneBy({ gameId }),
      this.moves.find({ where: { gameId }, order: { plyNumber: 'ASC' } }),
      this.moveAnalyses.find({ where: { gameId }, order: { plyNumber: 'ASC' } }),
    ]);
    if (!analysis) {
      return {
        gameId,
        status: 'none',
        accuracyWhite: null,
        accuracyBlack: null,
        depth: null,
        moves: [],
        requestedAt: null,
        completedAt: null,
      };
    }

    const sanByPly = new Map(moveRows.map((m: GameMoveEntity) => [m.plyNumber, m.san]));
    const moves: MoveAnalysisRecord[] = analysisRows.map((r: MoveAnalysisEntity) => ({
      ply: r.plyNumber,
      san: sanByPly.get(r.plyNumber) ?? '?',
      evalCp: r.evalCp,
      evalMate: r.evalMate,
      bestMoveSan: r.bestMoveSan,
      bestMoveUci: r.bestMoveUci,
      classification: r.classification as MoveAnalysisRecord['classification'],
      winPctWhite: r.winPctWhite,
    }));

    return {
      gameId,
      status: analysis.status as GameAnalysisResult['status'],
      accuracyWhite: analysis.accuracyWhite,
      accuracyBlack: analysis.accuracyBlack,
      depth: analysis.depth,
      moves,
      requestedAt: analysis.requestedAt?.toISOString() ?? null,
      completedAt: analysis.completedAt?.toISOString() ?? null,
    };
  }
}
