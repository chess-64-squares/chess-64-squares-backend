# chess-64-squares-backend

NestJS HTTP API + Socket.IO gateway tier (stateless — any instance serves any
game). System design: [ARCHITECTURE.md](ARCHITECTURE.md). Load testing:
[load-testing/LOAD_TESTING.md](load-testing/LOAD_TESTING.md).

Requires the sibling `../chess-64-squares-shared` to be **installed and
built** first (it's consumed via `file:../chess-64-squares-shared`).

## First-time setup (run in this folder)

```bash
# 1. shared library
cd ../chess-64-squares-shared && npm install && npm run build && cd ../chess-64-squares-backend

# 2. this app
npm install
cp .env.example .env       # set POSTGRES_PORT=5433 if 5432 is taken locally

# 3. infra + schema (docker-compose.yml lives in this folder)
docker compose up -d postgres redis
npm run migration:run
```

## Run

```bash
npm run start:dev    # watch mode — http://localhost:3000
# or
npm run build && npm start
```

Probes: `/healthz`, `/readyz`, Prometheus `/metrics`.

## Tests

```bash
npm test    # token/verification unit tests + DB integration tests for the
            # email-verification and puzzle flows (integration auto-skips
            # when Postgres isn't reachable)
```

## Full docker stack

```bash
docker compose up --build    # backend :3000, worker :3001, web :8080
```
