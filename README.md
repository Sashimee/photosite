# photosite (photoo.lu)

Marketplace for photography services: clients post requests or book a photographer's products directly, local photographers quote and chat with them, professionals post job offers for photographers. Web app, iOS and Android apps, admin backend. Luxembourg at launch, other countries later. The platform keeps 5 % of each booking.

Status: Phase 0 (foundations). See `docs/PLAN.md` for the phased build plan, `docs/steps/` for per-step subplans and `docs/DECISIONS.md` for the stack and product decisions.

## Setup

Requires Node 24, pnpm 12 and Docker with the Compose v2 CLI plugin (on hosts where `docker compose` isn't already available, install the pinned binary for your platform into `~/.docker/cli-plugins/docker-compose` from the [official releases](https://github.com/docker/compose/releases) and `chmod +x` it).

```
pnpm install
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

## Local dev stack

Copy `infra/docker/.env.example` to `infra/docker/.env` and each app's `.env.example` to `.env`, then:

```
pnpm stack:up     # postgres+postgis, redis, minio, mailpit on 127.0.0.1
pnpm stack:down   # stop the stack
pnpm stack:reset  # stop the stack and remove its volumes
```

Mailpit UI: http://localhost:8025. MinIO console: http://localhost:9001.

## Branching

`feature -> dev -> main`. Branch off `dev` (`feat/<slug>`, `fix/<slug>`, `chore/<slug>`) and open PRs into `dev`.
