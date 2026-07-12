import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import Redis from 'ioredis';
import {
  MatchFoundPayload,
  TIME_CONTROLS,
  TimeControl,
  findTimeControl,
} from 'chess-64-squares-shared';
import type { AuthedUser } from '../common/auth/jwt-payload';
import { REDIS_CLIENT } from '../common/redis/redis.module';
import { GamesService } from '../games/games.service';
import { MetricsService } from '../metrics/metrics.service';
import { GatewayRegistry } from '../queues/gateway-registry.service';
import { RatingsService } from '../ratings/ratings.service';

export const MATCHMAKING_NAMESPACE = '/matchmaking';

const queueKey = (tcId: string): string => `c64:mm:q:${tcId}`;
const TICKET_PREFIX = 'c64:mm:t:';
const SWEEP_LOCK_KEY = 'c64:mm:sweep-lock';
const SWEEP_INTERVAL_MS = 1_000;

/** rating window: ±BASE at join, widening WINDOW_GROW/s up to ±WINDOW_MAX */
const WINDOW_BASE = 100;
const WINDOW_GROW_PER_SEC = 15;
const WINDOW_MAX = 600;

/**
 * Atomic join-or-match. Being a single Lua script, two gateway instances can
 * NEVER match the same player twice: whichever script runs second no longer
 * finds the ticket (ZREM/DEL happen inside the same atomic execution).
 *
 * Cluster note: queue + tickets must share a hash slot in Redis Cluster —
 * add hash tags to the keys (e.g. c64:mm:{3+2}:q) when moving to cluster.
 */
const MATCH_LUA = `
local me      = ARGV[1]
local myRating = tonumber(ARGV[2])
local now     = tonumber(ARGV[3])
local base    = tonumber(ARGV[4])
local grow    = tonumber(ARGV[5])
local maxWin  = tonumber(ARGV[6])
local tp      = ARGV[7]

local myTicket = tp .. me
local myJoined = redis.call('HGET', myTicket, 'joinedAt')
local myWin = base
if myJoined then
  myWin = math.min(maxWin, base + grow * (now - tonumber(myJoined)) / 1000)
end

local candidates = redis.call('ZRANGEBYSCORE', KEYS[1], myRating - maxWin, myRating + maxWin, 'WITHSCORES', 'LIMIT', 0, 50)
local bestId = nil
local bestDiff = nil
for i = 1, #candidates, 2 do
  local cid = candidates[i]
  local cRating = tonumber(candidates[i + 1])
  if cid ~= me then
    local cJoined = redis.call('HGET', tp .. cid, 'joinedAt')
    if cJoined then
      local cWin = math.min(maxWin, base + grow * (now - tonumber(cJoined)) / 1000)
      local diff = math.abs(cRating - myRating)
      if diff <= myWin and diff <= cWin then
        if bestDiff == nil or diff < bestDiff then
          bestId = cid
          bestDiff = diff
        end
      end
    else
      redis.call('ZREM', KEYS[1], cid)
    end
  end
end

if bestId then
  redis.call('ZREM', KEYS[1], bestId)
  redis.call('ZREM', KEYS[1], me)
  local theirJoined = redis.call('HGET', tp .. bestId, 'joinedAt')
  redis.call('DEL', tp .. bestId)
  redis.call('DEL', tp .. me)
  return {bestId, theirJoined}
end

redis.call('ZADD', KEYS[1], myRating, me)
if not myJoined then
  redis.call('HSET', myTicket, 'joinedAt', now, 'rating', myRating, 'queue', KEYS[1], 'tc', ARGV[8])
  redis.call('EXPIRE', myTicket, 1800)
end
return nil
`;

const LEAVE_LUA = `
local queue = redis.call('HGET', KEYS[1], 'queue')
if queue then
  redis.call('ZREM', queue, ARGV[1])
end
redis.call('DEL', KEYS[1])
return 1
`;

@Injectable()
export class MatchmakingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MatchmakingService.name);
  private sweepTimer?: NodeJS.Timeout;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly gamesService: GamesService,
    private readonly ratingsService: RatingsService,
    private readonly registry: GatewayRegistry,
    private readonly metrics: MetricsService,
  ) {}

  onModuleInit(): void {
    // every instance ticks; a SET NX lock ensures only ONE sweeps per tick,
    // so the sweep survives any instance dying without a coordinator
    this.sweepTimer = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
    this.sweepTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
  }

  // ── public API (called from the gateway) ─────────────────────────

  async join(user: AuthedUser, timeControlId: string): Promise<void> {
    const tc = findTimeControl(timeControlId);
    if (!tc) throw new BadRequestException('Unknown quick-play time control');

    const { rating } = await this.ratingsService.getOrDefault(user.id, tc.category);
    await this.tryMatch(user.id, rating, tc);
  }

  async leave(userId: string): Promise<void> {
    await this.redis
      .eval(LEAVE_LUA, 1, `${TICKET_PREFIX}${userId}`, userId)
      .catch(() => undefined);
  }

  // ── internals ────────────────────────────────────────────────────

  private async tryMatch(userId: string, rating: number, tc: TimeControl): Promise<void> {
    const result = (await this.redis.eval(
      MATCH_LUA,
      1,
      queueKey(tc.id),
      userId,
      String(rating),
      String(Date.now()),
      String(WINDOW_BASE),
      String(WINDOW_GROW_PER_SEC),
      String(WINDOW_MAX),
      TICKET_PREFIX,
      tc.id,
    )) as [string, string | null] | null;

    if (result) {
      const [opponentId, theirJoinedAt] = result;
      if (theirJoinedAt) {
        this.metrics.matchmakingWait.observe((Date.now() - Number(theirJoinedAt)) / 1000);
      }
      await this.startMatchedGame(userId, opponentId, tc);
    } else {
      this.emitStatus(userId, tc.id, 0);
    }
  }

  private async startMatchedGame(
    userIdA: string,
    userIdB: string,
    tc: TimeControl,
  ): Promise<void> {
    const state = await this.gamesService.createPvpGame(userIdA, userIdB, tc, true);

    const emitTo = (userId: string): void => {
      const color = state.white.userId === userId ? 'w' : 'b';
      const opp = color === 'w' ? state.black : state.white;
      const payload: MatchFoundPayload = {
        gameId: state.gameId,
        color,
        opponent: {
          id: opp.userId!,
          username: opp.username,
          avatarUrl: opp.avatarUrl,
          isGuest: opp.isGuest,
          rating: opp.rating,
        },
        timeControl: tc,
      };
      this.registry.emitToRoom(
        MATCHMAKING_NAMESPACE,
        `user:${userId}`,
        'matchmaking:matchFound',
        payload,
      );
    };
    emitTo(userIdA);
    emitTo(userIdB);
  }

  private emitStatus(userId: string, tcId: string, waitSeconds: number): void {
    const window = Math.min(WINDOW_MAX, WINDOW_BASE + WINDOW_GROW_PER_SEC * waitSeconds);
    this.registry.emitToRoom(MATCHMAKING_NAMESPACE, `user:${userId}`, 'matchmaking:status', {
      status: 'searching',
      timeControlId: tcId,
      waitSeconds: Math.round(waitSeconds),
      ratingWindow: Math.round(window),
    });
  }

  /**
   * 1 Hz sweep (single instance via distributed lock): retries matching for
   * waiting players as their windows widen, and pushes status updates.
   */
  private async sweep(): Promise<void> {
    try {
      const locked = await this.redis.set(SWEEP_LOCK_KEY, '1', 'PX', 900, 'NX');
      if (locked !== 'OK') return;

      for (const tc of TIME_CONTROLS) {
        const members = await this.redis.zrange(queueKey(tc.id), 0, 99);
        for (const userId of members) {
          const ticket = await this.redis.hgetall(`${TICKET_PREFIX}${userId}`);
          if (!ticket.joinedAt) continue;
          const rating = Number(ticket.rating ?? 1200);
          const before = Date.now();
          const result = (await this.redis.eval(
            MATCH_LUA,
            1,
            queueKey(tc.id),
            userId,
            String(rating),
            String(before),
            String(WINDOW_BASE),
            String(WINDOW_GROW_PER_SEC),
            String(WINDOW_MAX),
            TICKET_PREFIX,
            tc.id,
          )) as [string, string | null] | null;

          if (result) {
            const waited = (before - Number(ticket.joinedAt)) / 1000;
            this.metrics.matchmakingWait.observe(waited);
            await this.startMatchedGame(userId, result[0], tc);
          } else {
            this.emitStatus(userId, tc.id, (before - Number(ticket.joinedAt)) / 1000);
          }
        }
      }
    } catch (err) {
      this.logger.debug(`sweep failed: ${(err as Error).message}`);
    }
  }
}
