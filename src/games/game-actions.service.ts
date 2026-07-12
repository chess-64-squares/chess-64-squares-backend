import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ActionEffects,
  Actor,
  GameActionError,
  GameStateRecord,
  GameStateStore,
  MoveInput,
  abortAction,
  acceptDrawAction,
  applyMoveAction,
  declineDrawAction,
  declineRematchAction,
  executeEffects,
  markDisconnectedAction,
  markReconnectedAction,
  offerDrawAction,
  offerRematchAction,
  resignAction,
} from 'chess-64-squares-shared';
import type { AppConfig } from '../config/configuration';
import { MetricsService } from '../metrics/metrics.service';
import { BackendEffectSink } from '../queues/backend-effect-sink.service';

/**
 * The gateway-side orchestrator: every player action is
 *   lock → load → pure action → save → release → execute effects.
 * Any backend instance can run this for any game (stateless tier).
 */
@Injectable()
export class GameActionsService {
  private readonly logger = new Logger(GameActionsService.name);

  constructor(
    private readonly store: GameStateStore,
    private readonly sink: BackendEffectSink,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly metrics: MetricsService,
  ) {}

  private async run(
    gameId: string,
    action: (state: GameStateRecord) => ActionEffects,
  ): Promise<ActionEffects> {
    const effects = await this.store.withLock(gameId, async (state) => {
      if (!state) throw new GameActionError('NOT_FOUND', 'Game not found');
      const fx = action(state);
      return { save: fx.state, result: fx };
    });
    await executeEffects(effects, this.sink);
    return effects;
  }

  async applyMove(gameId: string, actor: Actor, move: MoveInput): Promise<void> {
    await this.run(gameId, (state) => applyMoveAction(state, actor, move, Date.now()));
    this.metrics.movesTotal.inc();
  }

  async resign(gameId: string, userId: string): Promise<void> {
    await this.run(gameId, (state) => resignAction(state, { userId }, Date.now()));
  }

  async abort(gameId: string, userId: string): Promise<void> {
    await this.run(gameId, (state) => abortAction(state, { userId }, Date.now()));
  }

  async offerDraw(gameId: string, userId: string): Promise<void> {
    await this.run(gameId, (state) => offerDrawAction(state, { userId }, Date.now()));
  }

  async acceptDraw(gameId: string, userId: string): Promise<void> {
    await this.run(gameId, (state) => acceptDrawAction(state, { userId }, Date.now()));
  }

  async declineDraw(gameId: string, userId: string): Promise<void> {
    await this.run(gameId, (state) => declineDrawAction(state, { userId }));
  }

  async offerRematch(gameId: string, userId: string): Promise<void> {
    await this.run(gameId, (state) => offerRematchAction(state, { userId }));
  }

  async declineRematch(gameId: string, userId: string): Promise<void> {
    await this.run(gameId, (state) => declineRematchAction(state, { userId }));
  }

  /** Tolerant (no throw): called from disconnect handlers. */
  async markDisconnected(gameId: string, userId: string): Promise<void> {
    const graceMs = this.config.get('disconnectGraceSec', { infer: true }) * 1000;
    try {
      await this.run(gameId, (state) =>
        markDisconnectedAction(state, userId, graceMs, Date.now()),
      );
    } catch (err) {
      if (!(err instanceof GameActionError)) {
        this.logger.warn(`markDisconnected(${gameId}) failed: ${(err as Error).message}`);
      }
    }
  }

  async markReconnected(gameId: string, userId: string): Promise<void> {
    try {
      await this.run(gameId, (state) => markReconnectedAction(state, userId));
    } catch (err) {
      if (!(err instanceof GameActionError)) {
        this.logger.warn(`markReconnected(${gameId}) failed: ${(err as Error).message}`);
      }
    }
  }
}
