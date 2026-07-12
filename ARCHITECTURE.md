# chess-64-squares — Architecture

Target: a chess.com-style platform designed **up front** for **1,000,000 concurrent users**.
This document is the design contract; every module in the codebase follows it.

---

## 1. Topology

```
                                   ┌──────────────────────────────────────────────┐
                                   │                  INTERNET                    │
                                   └──────────────────────┬───────────────────────┘
                                                          │
                                            ┌─────────────▼──────────────┐
                                            │        Load Balancer       │
                                            │  (L7, sticky by cookie /   │
                                            │   IP-hash for WS upgrade)  │
                                            └─────────────┬──────────────┘
                                                          │
                        ┌─────────────────────────────────┼─────────────────────────────────┐
                        │                                 │                                 │
              ┌─────────▼─────────┐             ┌─────────▼─────────┐             ┌─────────▼─────────┐
              │ chess-64-squares- │             │ chess-64-squares- │     ...     │ chess-64-squares- │
              │   backend #1      │             │   backend #2      │   (N≈60)    │   backend #N      │
              │  NestJS HTTP+WS   │             │  NestJS HTTP+WS   │             │  NestJS HTTP+WS   │
              │  ── STATELESS ──  │             │  ── STATELESS ──  │             │  ── STATELESS ──  │
              └───┬──────────┬────┘             └───┬──────────┬────┘             └───┬──────────┬────┘
                  │          │                      │          │                      │          │
                  │          └──────────────┬───────┘          │                      │          │
                  │                         │                  │                      │          │
        writes /  │            ┌────────────▼──────────────────▼──────────┐           │          │
        reads     │            │                REDIS (cluster)           │◄──────────┘          │
                  │            │  a) Socket.IO adapter (pub/sub)          │                      │
                  │            │  b) matchmaking queues (ZSET + Lua)      │                      │
                  │            │  c) active game state (hash per game)    │                      │
                  │            │  d) BullMQ queues (analysis / bot /      │                      │
                  │            │     persistence / game-timers)           │                      │
                  │            │  e) rate-limit token buckets, presence,  │                      │
                  │            │     leaderboard & profile cache          │                      │
                  │            └────────────┬─────────────────────────────┘                      │
                  │                         │ consumes jobs                                      │
                  │            ┌────────────▼─────────────────┐                                  │
                  │            │   chess-64-squares-worker    │  (M replicas, scaled            │
                  │            │   BullMQ consumers, no HTTP  │   independently on CPU /        │
                  │            │   listeners except /healthz  │   queue depth)                  │
                  │            │  ┌────────────────────────┐  │                                  │
                  │            │  │ Stockfish process pool │  │  ◄── native UCI binaries,       │
                  │            │  │ (UCI over stdio)       │  │      1 engine per vCPU          │
                  │            │  └────────────────────────┘  │                                  │
                  │            └────────────┬─────────────────┘                                  │
                  │                         │ persists results                                   │
        ┌─────────▼─────────────────────────▼─────────┐                                          │
        │              PostgreSQL                     │◄─────────────────────────────────────────┘
        │  PRIMARY  ──streaming──►  REPLICA(s)        │        reads (history, leaderboards,
        │  (writes: moves batch,    (reads: history,  │         profiles) go to replicas
        │   accounts, ratings)       leaderboards)    │
        └─────────────────────────────────────────────┘

Bot-play compute:
  • Levels 1–2 ("Pawn", "Novice"): pure-TS heuristic engine in chess-64-squares-shared,
    executed IN THE WORKER (µs of CPU per move — cheaper than shipping browser WASM,
    and it keeps a single authoritative move path). See §8.
  • Levels 3–8: Stockfish via UCI in the worker pool, same queue as analysis but a
    separate BullMQ queue with higher priority (bot moves are latency-sensitive-ish,
    analysis is not).

Frontend (chess-64-squares-web) is static assets served from CDN / nginx — it holds no state.
```

---

## 2. The ten principles, with reasoning (not assertions)

### 2.1 Stateless application servers

No gateway instance holds game state that is not in Redis. Every socket event handler
follows the same pattern: *load state from Redis → validate → mutate in Redis (atomically) →
broadcast via the Redis adapter → (async) enqueue persistence*. **Why:** the load balancer
may route a reconnecting player to any instance; an instance may be killed by a deploy or
an HPA scale-down at any moment. If instance A dies mid-game, the game continues the
instant both players' sockets land anywhere else, because nothing was lost.
The only in-process state is the socket registry itself, which Socket.IO already
externalizes logically through rooms + the Redis adapter.

### 2.2 Horizontal scaling of WebSocket gateways

Socket.IO with `@socket.io/redis-adapter`: an emit to room `game:<id>` on instance A is
published through Redis and delivered by instance B to the opponent's socket. Rooms are
the unit of isolation (see §2.8 on leakage).

At 1M connections the *classic* adapter has a known ceiling: it publishes on one channel
per namespace, so **every** instance receives **every** message and filters locally. The
deployment path for the top end is the **sharded adapter** (`createShardedAdapter`,
Redis 7 sharded pub/sub) with `subscriptionMode: 'dynamic'`, so a `game:<id>` room message
is only delivered to instances that actually have a member of that room. The code isolates
adapter construction in one place (`common/redis/socket-adapter.ts`) precisely so this
swap is a config change, not a refactor. Local/dev uses the classic adapter.

### 2.3 Connection budget per instance

A Node.js WebSocket connection is bounded by memory and file descriptors, not CPU:

- Kernel TCP buffers: ~8–16 KB per idle socket (tunable via `net.ipv4.tcp_rmem/wmem`).
- Node socket object + Socket.IO/engine.io per-socket structures: ~15–25 KB.
- Total ≈ **25–40 KB per idle connection** → 25,000 connections ≈ 0.6–1.0 GB.

Budget **25,000 connections per instance** on a 2 vCPU / 4 GB pod (socket overhead ~1 GB,
V8 heap + app ~1 GB, headroom for GC spikes and burst traffic ~2 GB). CPU check:
engine.io heartbeats at 25 s interval → 1,000 pings/s per instance — negligible; the real
CPU cost is JSON serialization of move broadcasts and Redis round-trips, both measured in
tens of microseconds.

**Instance count:** 1,000,000 / 25,000 = 40 instances at theoretical capacity.
Run **60 instances** (50% headroom) so that a rolling deploy (drain 1/6 of the fleet),
an AZ failure, or a reconnect storm (thundering herd after an LB blip) never pushes
survivors past ~80% of budget. OS prerequisites per pod: `ulimit -n ≥ 65536`,
`net.core.somaxconn` raised, keep-alive tuned.

### 2.4 Hot path vs heavy path

The hot path is: *socket event → Redis (a few `EVALSHA`/`HSET`, <1 ms) → broadcast*.
Nothing on it may block on CPU-heavy work:

| Work                     | Where it runs                              | Queue           |
|--------------------------|--------------------------------------------|-----------------|
| Move validation          | gateway (chess.js, ~50 µs)                 | inline (cheap)  |
| Stockfish analysis       | worker pool                                | `analysis`      |
| Bot move computation     | worker pool                                | `bot-moves`     |
| Move persistence to PG   | worker pool                                | `persistence`   |
| Clock flag-fall checks   | worker pool (BullMQ **delayed** jobs)      | `game-timers`   |
| Rating updates           | worker, inside game-finish persistence job | `persistence`   |

chess.js validation stays inline because it is microseconds — queueing it would *add*
latency. Stockfish is 100 ms–seconds of pinned CPU; one inline call would stall the event
loop for every one of the 25k sockets on that instance. Hence the hard rule enforced in
code: **the gateway tier has no dependency on the Stockfish module at all** — it can only
enqueue jobs.

### 2.5 Redis for live state, PostgreSQL for durable state

Live game state (`game:<id>` hash: FEN, move list, clocks, last-move server timestamp,
draw-offer flags, disconnect flags) lives in Redis:

- A move is a read-modify-write on ~1 KB of state; Redis does this in <1 ms at any scale
  we need (sharded by game id in cluster mode). Postgres round-trip + WAL fsync on the
  hot path would put a disk in the latency budget of every move and melt the primary at
  ~30k moves/s (350k concurrent games × 1 move/~10 s ≈ 35k moves/s peak).
- Persistence is **write-behind**: each accepted move enqueues an idempotent
  `persistence` job (jobId `move:<gameId>:<ply>`, `ON CONFLICT DO NOTHING` on
  `(game_id, ply_number)`), and game end persists the full record transactionally
  (result, final FEN, rating delta) sourced from Redis. If Postgres lags, games are
  unaffected; the queue absorbs the backlog. At the top end the persistence workers
  switch from row inserts to multi-row `INSERT ... VALUES` / `COPY` batches — the
  processor already groups by game.
- Crash safety: Redis (AOF everysec + replica) can lose ≤1 s of moves in the worst case;
  the persistence queue usually has those same moves in flight anyway. A finished game
  is durable in Postgres before its Redis key is expired (TTL applied only after
  successful persist).

### 2.6 Read replicas

TypeORM is configured with `replication`: writes → primary, reads → replicas. All
read-heavy endpoints (game history, leaderboards, profiles, analysis results) run on
`QueryRunner`s pinned to replicas. Consistency note: after game end we serve "your last
game" from the primary-written response payload (not a replica read) to avoid
read-your-own-write anomalies from replication lag.

### 2.7 Caching

- Leaderboards: Redis ZSET per time-control category, updated on rating write, read
  directly from Redis (Postgres only rebuilds it on cold start / drift check).
  TTL-less but bounded (`ZREMRANGEBYRANK` keeps top N).
- Public profiles: Redis string cache `profile:<userId>` with 60 s TTL + explicit
  invalidation on profile/rating write. A profile view never hits Postgres while warm.

### 2.8 Rate limiting at the edge

A shared Lua **token bucket** (`rate-limit.lua`, atomic, per key) is enforced:
- per-connection: `move` (4/s burst 8), `chat` (1/s burst 3), generic events (10/s);
- per-user: matchmaking joins (6/min), auth endpoints (10/min per IP + username);
Exceeding limits gets a structured `error` event (WS) or 429 (REST) — never a crash,
never a silent drop. Buckets live in Redis so limits hold across instances.

**Room isolation:** each socket joins exactly `user:<id>` and the `game:<id>` rooms it is
a participant of; all game broadcasts target the game room; per-player secrets (e.g. your
own queue status) target `user:<id>`. No global broadcasts on the game namespace.

### 2.9 Graceful degradation

- **Stockfish saturation:** `analysis` queue has bounded concurrency per worker
  (= vCPUs) and a max backlog; on enqueue the client immediately receives
  `analysis:progress {status:'queued', position, etaSeconds}` (position = queue depth
  ahead, ETA = position × rolling avg job duration). The UI shows a queue position, not
  a spinner. If the queue exceeds `ANALYSIS_MAX_BACKLOG`, new requests are accepted as
  `deferred` (analysis on demand later) instead of failing. Bot-move jobs are on a
  separate, higher-priority queue so a tournament-end analysis burst can never make
  bots stop moving.
- **Redis briefly unavailable:** gateways do not crash — the Redis provider attaches
  error handlers, socket handlers catch and emit structured `error` events, health
  `/readyz` flips to not-ready so the LB stops routing *new* connections, existing
  sockets stay open. Moves during the blip fail fast with `error {code:'RETRY'}` and
  the client retries with backoff. BullMQ producers buffer/fail-fast rather than block.

### 2.10 Observability

- Structured JSON logging (nestjs-pino): game start/end, disconnect/reconnect,
  matchmaking events, job lifecycle, all with gameId/userId correlation fields.
- Prometheus `/metrics` on both tiers: `ws_active_connections` (per instance),
  `bull_queue_depth{queue}`, `matchmaking_wait_seconds` (histogram),
  `analysis_job_duration_seconds`, `moves_total`, `stockfish_pool_busy`.
- Kubernetes probes: `/healthz` (liveness: process up), `/readyz` (readiness:
  Redis ping + Postgres ping OK). Worker exposes the same on its metrics port.

---

## 3. Monorepo layout & naming

**pnpm workspaces** monorepo, root `chess-64-squares`, with the four projects as
direct siblings (flat layout — no intermediate `apps/`/`packages/` nesting).
Justification: the worker and the backend must share the game-rules engine, DTOs and
queue contracts *by construction* (one package, one version — not copy-paste that
drifts). pnpm gives strict, fast, disk-cheap linking without adding an orchestration
layer we don't need yet; if the build graph grows, Turborepo can be layered on top
without moving files.

```
chess-64-squares/
  chess-64-squares-backend/   # NestJS HTTP + WS gateway tier (stateless)
  chess-64-squares-web/       # React + Vite + Tailwind v4
  chess-64-squares-worker/    # NestJS app, BullMQ consumers + Stockfish pool
  chess-64-squares-shared/    # chess engine wrapper, game-core state machine, DTOs,
                              # WS event contract, Elo, classification, clock math
```

Docker services follow the same names; infra services are plainly `postgres`, `redis`.

## 4. Tech choices (stated once, used consistently)

| Concern            | Choice                                   | Why |
|--------------------|------------------------------------------|-----|
| ORM                | **TypeORM** + hand-written migrations    | mature Nest integration, `replication` support for read replicas |
| Rating             | **Elo**, per time-control category       | O(1), trivially testable; Glicko-2 is a drop-in later behind the same `RatingCalculator` interface |
| WS                 | Socket.IO 4 + Redis adapter              | required; rooms + reconnection semantics |
| Queue              | BullMQ 5                                 | required; delayed jobs power clock timers & disconnect forfeits |
| Chess rules        | chess.js behind `ChessGameEngine` wrapper in shared | single source of truth for backend AND worker |
| Auth               | JWT access (15 min) + rotating refresh (30 d, httpOnly cookie, hashed in PG) | standard, revocable |
| Frontend state     | Zustand                                  | small, no boilerplate, fits socket-driven updates |
| Styling            | Tailwind v4 + custom design system (no component library) | full control of the visual identity required by the spec |
| Tests              | Vitest (shared/web/backend unit), Artillery (load) | fast, one runner |

## 5. Clock correctness (server-authoritative)

Redis stores `{whiteMs, blackMs, lastMoveAt (server epoch ms), turn}`. On a move the
gateway computes `elapsed = now - lastMoveAt`, applies increment/delay
(Fischer: `remaining - elapsed + increment`; delay: only time beyond the delay counts),
rejects the move if the mover's clock is already ≤ 0 (flag fall). Because a player who
never moves again would otherwise never be flagged, every move also (re)schedules a
BullMQ **delayed job** `game-timers` with jobId `flag:<gameId>:<ply>` at
`remaining + grace`; the processor re-reads Redis and only forfeits if the ply hasn't
advanced. Client-reported elapsed time is never read; `game:clockSync` pushes the
server's numbers after every move and every 5 s in low-activity games.

## 6. Matchmaking without races

One Redis ZSET per pool: `mm:<category>` (score = rating), plus a hash with ticket
metadata (joinedAt, socket instance, widening window). Join and match are a single
**Lua script**: it `ZRANGEBYSCORE`s around the joiner's rating (window widens with wait
time: ±50 → ±400 over 30 s), picks the longest-waiting compatible opponent, and
`ZREM`s **both** tickets in the same atomic script — two instances can never match the
same player twice because whichever script runs second no longer finds the ticket.
A 1 s sweep (distributed, guarded by `SET NX` lock) retries widened windows for waiting
players. Match found → both players' `user:<id>` rooms get `matchmaking:matchFound`.

## 7. Reconnection

Game state is in Redis, so reconnect works on any instance: client reconnects with the
same JWT, emits `game:join {gameId}`, server verifies membership, re-joins the room, and
replies with full `game:state`. On disconnect the gateway sets a flag and schedules a
delayed forfeit job (`forfeit:<gameId>:<userId>:<ply>`, 60 s grace in timed games);
reconnect clears the flag, and the job no-ops if the flag is gone or the ply advanced.
The opponent sees `game:opponentConnection {connected:false, graceSeconds}`.

## 8. Bot difficulty mapping

All bot moves flow through the **same** validated move path as human moves (the worker
submits the move to the same `GameActionService` the gateway uses). Levels:

| Lvl | Name        | ~Elo | Engine & config |
|-----|-------------|------|-----------------|
| 1   | Pawn        | 400  | heuristic TS engine: weighted random over legal moves, prefers captures/checks, 15% pure random |
| 2   | Novice      | 700  | heuristic TS engine: 1-ply material eval + randomness, hangs pieces occasionally by design |
| 3   | Apprentice  | 1000 | Stockfish: Skill Level 3, depth 5, movetime 200 ms, pick from top-4 MultiPV weighted |
| 4   | Club        | 1300 | Stockfish: Skill Level 7, depth 8, movetime 400 ms, top-3 MultiPV weighted |
| 5   | Expert      | 1600 | Stockfish: Skill Level 12, depth 12, movetime 600 ms, top-2 MultiPV weighted |
| 6   | Master      | 1900 | Stockfish: Skill Level 16, depth 15, movetime 800 ms |
| 7   | Grandmaster | 2300 | Stockfish: Skill Level 20, depth 18, movetime 1200 ms |
| 8   | Engine      | 3000+| Stockfish: full strength, movetime 2000 ms |

Levels 1–2 use the heuristic engine *in the worker* rather than browser WASM: a
heuristic move costs microseconds of server CPU (cheaper than the bytes to ship WASM),
keeps one authoritative code path, and MultiPV weighted-pick + Skill Level (not just a
depth cap) makes weak levels blunder believably instead of playing shallow-but-perfect
tactics. Browser WASM remains a documented option if bot volume ever dominates worker
CPU. Bot games are stored like any game (`is_bot_game`, `bot_level`), replayable and
analyzable, but **excluded from competitive rating**; a per-user vs-bot win streak is
tracked on the profile instead.

## 9. Analysis pipeline

Game ends → `analysis` job (gameId). Worker: loads moves from PG (or Redis if not yet
flushed), replays with the shared engine, runs Stockfish `go depth 14` (config) on each
position, computes for every ply: eval (cp / mate-in-N), best move, classification from
centipawn loss (converted through win-percentage so a 100 cp loss in a won position
matters less than in an equal one):

- win% = `50 + 50 · (2 / (1 + e^(−0.00368208·cp)) − 1)` (from the mover's perspective)
- move accuracy = `103.1668 · e^(−0.04354·(winBefore − winAfter)) − 3.1669`, clamped 0–100
- game accuracy = mean of move accuracies per player

| Classification | Condition (win% drop)         |
|----------------|-------------------------------|
| Best           | played = engine best, or drop ≤ 0.5 |
| Excellent      | drop ≤ 2                      |
| Good           | drop ≤ 5                      |
| Inaccuracy     | drop ≤ 10                     |
| Mistake        | drop ≤ 20                     |
| Blunder        | drop > 20, or missed/allowed mate |

Progress is published per-ply to Redis pub/sub → gateway relays `analysis:progress` to
`user:<id>`; results land in `game_analysis` + `move_analysis` (computed once, reused
forever). Worker pool sizing: Stockfish pins a core, so concurrency = vCPUs per pod and
the tier scales with **KEDA/HPA on queue depth** (target: depth / (replicas × vCPU × jobs
per minute) < 5 min). Backlog is bounded (§2.9).

## 10. Production topology (K8s sketch)

- `chess-64-squares-backend`: Deployment, 60 replicas (HPA on connections/CPU),
  Service + Ingress with sticky sessions (cookie). PodDisruptionBudget ≥ 90%.
- `chess-64-squares-worker`: Deployment, HPA/KEDA on BullMQ queue depth; CPU-request =
  concurrency. Separate node pool (compute-optimized) from the gateway tier.
- Redis: managed cluster (or Redis Cluster + Sentinel), AOF everysec; logically
  separated usage by key prefix; adapter can move to its own instance if pub/sub
  bandwidth demands.
- PostgreSQL: primary + ≥2 streaming replicas behind PgBouncer (transaction pooling).
- Web: static bundle on CDN.
- Future extension points (not implemented): tournaments (bracket service consuming the
  same game engine + a scheduler), spectator mode (read-only room membership).
