import { Injectable } from '@nestjs/common';
import type { Namespace } from 'socket.io';

/**
 * Gateways register their namespace servers here so non-gateway services
 * (effect sink, matchmaking sweeper) can emit through the Redis adapter
 * without owning a gateway reference.
 */
@Injectable()
export class GatewayRegistry {
  private readonly namespaces = new Map<string, Namespace>();

  register(namespace: string, server: Namespace): void {
    this.namespaces.set(namespace, server);
  }

  get(namespace: string): Namespace | undefined {
    return this.namespaces.get(namespace);
  }

  emitToRoom(namespace: string, room: string, event: string, payload: unknown): void {
    this.namespaces.get(namespace)?.to(room).emit(event, payload);
  }
}
