import { Injectable } from '@nestjs/common';
import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from 'prom-client';

/** ARCHITECTURE.md §2.10 — the gateway tier's Prometheus metrics. */
@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  readonly wsConnections = new Gauge({
    name: 'c64_ws_active_connections',
    help: 'Active WebSocket connections on this instance',
    labelNames: ['namespace'] as const,
    registers: [this.registry],
  });

  readonly movesTotal = new Counter({
    name: 'c64_moves_total',
    help: 'Accepted moves processed by this instance',
    registers: [this.registry],
  });

  readonly gamesStarted = new Counter({
    name: 'c64_games_started_total',
    help: 'Games created',
    labelNames: ['kind'] as const, // pvp | bot | private
    registers: [this.registry],
  });

  readonly matchmakingWait = new Histogram({
    name: 'c64_matchmaking_wait_seconds',
    help: 'Time from queue join to match found',
    buckets: [1, 2, 5, 10, 20, 40, 80, 160],
    registers: [this.registry],
  });

  readonly wsErrors = new Counter({
    name: 'c64_ws_errors_total',
    help: 'Structured error events emitted to clients',
    labelNames: ['code'] as const,
    registers: [this.registry],
  });

  constructor() {
    collectDefaultMetrics({ register: this.registry });
  }

  metrics(): Promise<string> {
    return this.registry.metrics();
  }
}
