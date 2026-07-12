import { Injectable } from '@nestjs/common';
import type {
  EffectSink,
  EnqueueCommand,
  GameEvent,
  PersistCommand,
  TimerCommand,
} from 'chess-64-squares-shared';
import { GatewayRegistry } from './gateway-registry.service';
import { QueueProducerService } from './queue-producer.service';

/**
 * Executes game-core ActionEffects in the gateway tier: events go out through
 * the Socket.IO Redis adapter (cross-instance), everything else becomes a
 * BullMQ job. The worker has its own sink (redis-emitter based).
 */
@Injectable()
export class BackendEffectSink implements EffectSink {
  constructor(
    private readonly registry: GatewayRegistry,
    private readonly producer: QueueProducerService,
  ) {}

  emit(event: GameEvent): void {
    this.registry.emitToRoom(event.namespace, event.room, event.event, event.payload);
  }

  schedule(timer: TimerCommand): Promise<void> {
    return this.producer.schedule(timer);
  }

  enqueue(cmd: EnqueueCommand): Promise<void> {
    return this.producer.enqueue(cmd);
  }

  persist(cmd: PersistCommand): Promise<void> {
    return this.producer.persist(cmd);
  }
}
