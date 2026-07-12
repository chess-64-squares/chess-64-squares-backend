# Load Testing Plan

Goal: validate the scalability claims in [ARCHITECTURE.md](ARCHITECTURE.md)
empirically — connection budget per instance, cross-instance broadcast
latency, matchmaking under contention, and worker backpressure — not just
assert them.

## Tooling

- **Artillery + `artillery-engine-socketio-v3`** for the WebSocket paths
  (Socket.IO speaks engine.io framing, so raw-WS tools like k6's `ws` module
  can't exercise the real handshake; Artillery's socket.io engine can).
  A starter scenario ships in [`load/artillery-game.yml`](load/artillery-game.yml):
  every virtual user registers a guest over REST, connects `/matchmaking` with
  a real JWT, queues for 1+0 and holds the connection.
  ```bash
  npm i -g artillery artillery-engine-socketio-v3
  artillery run load/artillery-game.yml
  ```
- **k6** stays useful for the pure REST surface (auth, history, profiles,
  leaderboard against replicas).

## What to measure (Prometheus, both tiers)

| Metric | Where | Pass criterion (per-instance dev baseline) |
|---|---|---|
| `c64_ws_active_connections` | backend | reaches target CCU without RSS > 75% of pod limit |
| engine.io handshake p95 | Artillery report | < 500 ms at sustained arrival rate |
| move round-trip p95 (emit → `game:move` broadcast) | custom scenario | < 150 ms same-instance, < 250 ms cross-instance |
| `c64_matchmaking_wait_seconds` | backend | p50 < 3 s at ≥ 50 queued/min per pool |
| `c64_bull_queue_depth{queue="persistence"}` | worker | drains to ~0 within 60 s after load stops (write-behind keeps up) |
| `c64_bull_queue_depth{queue="analysis"}` | worker | grows under burst but is bounded; requests beyond `ANALYSIS_MAX_BACKLOG` become `deferred`, never failures |
| `c64_worker_job_duration_seconds{queue="analysis"}` | worker | stable p95 while bot-move p95 stays < 2 s (priority isolation) |

## Test matrix

1. **Connection ceiling (single instance):** ramp idle sockets on `/play`
   until failure; record max CCU, RSS/CCU, CPU. This calibrates the
   25k/instance budget from ARCHITECTURE.md §2.3. Raise `ulimit -n` first.
2. **Cross-instance broadcast:** run 2+ backend replicas behind nginx
   (`least_conn`, sticky), pair players pinned to different instances
   (join queue from two Artillery pools), assert move RTT delta between
   same-instance and cross-instance pairs stays < 100 ms — that delta is the
   Redis adapter hop.
3. **Matchmaking contention:** 500 joins/min into one pool; assert zero
   duplicate matches (DB check: no user with two active games from the same
   minute) — this validates the atomic Lua claim — and wait-time histogram.
4. **Persistence write-behind:** sustained 100 moves/s of bot games; watch
   persistence queue depth and Postgres write latency; kill the worker for
   30 s mid-run and verify the queue drains after restart with **no lost
   moves** (row count == ply count).
5. **Analysis backpressure:** finish 200 games at once (script rapid 2-ply
   bot resigns); verify analysis queue position/ETA events arrive, bot moves
   stay fast (separate queue), and backlog beyond the cap defers.
6. **Redis blip:** `docker compose pause redis` for 5 s under load; gateways
   must stay up, `readyz` flips not-ready, clients receive `RETRY` errors,
   and everything recovers on unpause with no crashed instances.

## Scaling the numbers to 1M

The dev-laptop test proves *shape*, not absolute capacity. The production
extrapolation methodology: measure RSS/connection and CPU/move on one
production-sized pod (2 vCPU / 4 GB), then instance count =
`1M / measured-CCU-per-pod × 1.5 headroom` (ARCHITECTURE.md §2.3). Re-run
matrix items 2–6 unchanged at any scale — they validate invariants
(atomicity, isolation, backpressure), which do not depend on fleet size.
