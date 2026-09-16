# photosite (photoo.lu)

Marketplace for photography services: clients post requests or book a photographer's products directly, local photographers quote and chat with them, professionals post job offers for photographers. Web app, iOS and Android apps, admin backend. Luxembourg at launch, other countries later. The platform keeps 5 % of each booking.

Status: Phase 0 (foundations). See `docs/PLAN.md` for the phased build plan, `docs/steps/` for per-step subplans and `docs/DECISIONS.md` for the stack and product decisions.

## Setup

Requires Node 24 and pnpm 12.

```
pnpm install
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

## Branching

`feature -> dev -> main`. Branch off `dev` (`feat/<slug>`, `fix/<slug>`, `chore/<slug>`) and open PRs into `dev`.
