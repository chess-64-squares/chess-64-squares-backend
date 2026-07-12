import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  AnalysisJob,
  BotMoveJob,
  EnqueueCommand,
  GameTimerJob,
  PersistCommand,
  PersistenceJob,
  QUEUES,
  TimerCommand,
  jobIds,
} from 'chess-64-squares-shared';

/** Thin, typed façade over the BullMQ queues the gateway tier produces into. */
@Injectable()
export class QueueProducerService {
  private readonly logger = new Logger(QueueProducerService.name);

  constructor(
    @InjectQueue(QUEUES.ANALYSIS) private readonly analysisQueue: Queue<AnalysisJob>,
    @InjectQueue(QUEUES.BOT_MOVES) private readonly botQueue: Queue<BotMoveJob>,
    @InjectQueue(QUEUES.PERSISTENCE) private readonly persistenceQueue: Queue<PersistenceJob>,
    @InjectQueue(QUEUES.GAME_TIMERS) private readonly timerQueue: Queue<GameTimerJob>,
  ) {}

  async schedule(timer: TimerCommand): Promise<void> {
    if (timer.kind === 'flag-check') {
      await this.timerQueue.add(
        'flag-check',
        { kind: 'flag-check', gameId: timer.gameId, ply: timer.ply },
        { delay: timer.delayMs, jobId: jobIds.flagCheck(timer.gameId, timer.ply) },
      );
    } else {
      await this.timerQueue.add(
        'disconnect-forfeit',
        {
          kind: 'disconnect-forfeit',
          gameId: timer.gameId,
          userId: timer.userId,
          ply: timer.ply,
        },
        {
          delay: timer.delayMs,
          jobId: jobIds.disconnectForfeit(timer.gameId, timer.userId, timer.ply),
        },
      );
    }
  }

  async enqueue(cmd: EnqueueCommand): Promise<void> {
    await this.botQueue.add(
      'bot-move',
      {
        gameId: cmd.gameId,
        botLevel: cmd.botLevel,
        ply: cmd.ply,
        expectedFen: cmd.expectedFen,
      },
      { jobId: jobIds.botMove(cmd.gameId, cmd.ply), priority: 1 },
    );
  }

  async persist(cmd: PersistCommand): Promise<void> {
    if (cmd.kind === 'move') {
      await this.persistenceQueue.add('move', cmd, {
        jobId: jobIds.move(cmd.gameId, cmd.ply),
      });
    } else {
      await this.persistenceQueue.add(
        'game-finished',
        { kind: 'game-finished', gameId: cmd.gameId },
        { jobId: jobIds.gameFinished(cmd.gameId), priority: 1 },
      );
    }
  }

  async enqueueAnalysis(job: AnalysisJob): Promise<{ queuePosition: number }> {
    const counts = await this.analysisQueue.getJobCounts('waiting', 'active');
    await this.analysisQueue.add('analyze', job, {
      jobId: jobIds.analysis(job.gameId),
    });
    return { queuePosition: (counts.waiting ?? 0) + (counts.active ?? 0) };
  }

  async analysisBacklog(): Promise<number> {
    const counts = await this.analysisQueue.getJobCounts('waiting', 'active');
    return (counts.waiting ?? 0) + (counts.active ?? 0);
  }
}
