# Preview runbook (footoo.bas.lu)

Noindexed preview of `main`, hosted on the Dokploy instance at `dok.seil.pro`.
Staging (`dev` → `staging.photoo.lu`) and production (`main` → `photoo.lu`)
are separate, later Dokploy projects (1E.1, 2.4) - this project only ever
serves `footoo.bas.lu`.

Background: `docs/steps/0.5-preview-deploy.md`. This file is the "how", that
one is the "why".

## One-time setup (Alex, in the Dokploy UI at `dok.seil.pro`)

1. **Create the project.** New Project → name it `photoo-preview`.
2. **Add a Compose service.** Inside the project, add a service of type
   Compose:
   - Source: this repository, branch `main`, compose path
     `infra/dokploy/preview/compose.yml`. (Or paste the file's contents
     directly if Dokploy in this version doesn't support a repo-tracked
     compose path - functionally identical, just update it manually here
     when the file changes instead of it tracking `main` automatically.)
   - Dokploy provisions `dokploy-network` itself (shared by every app on the
     host); the compose file expects it as an `external: true` network and
     only attaches `web`, `api` and `minio` to it - everything else is on a
     project-private `internal` network Compose creates.
3. **Set environment variables.** Copy every key from
   `infra/dokploy/preview/.env.example` into the service's environment
   editor and fill in the blanks:
   - `POSTGRES_PASSWORD`, `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`,
     `REDIS_PASSWORD`: generate with `openssl rand -base64 24` (or
     Dokploy's own generator).
   - `MINIO_API_ACCESS_KEY`/`MINIO_API_SECRET_KEY`,
     `MINIO_WORKER_ACCESS_KEY`/`MINIO_WORKER_SECRET_KEY`: generate the same
     way - see "Object storage users" for what each is scoped to.
   - `AUTH_SECRET`: `openssl rand -base64 48`.
   - `AUTH_ENCRYPTION_KEY`: `openssl rand -base64 32` - must decode to
     exactly 32 bytes, so use exactly this command, not a different length.
   - `SEED_USER_PASSWORD`: `openssl rand -base64 24` (only used by the
     `seed` profile below).
   - `IMAGE_TAG`: `main` (the workflow always also pushes `sha-<short>`
     tags for rollback - see "Rollback").
   - OAuth client id/secret pairs: leave blank until 0.6 creates those
     accounts; each provider only activates once both its vars are set.
   - Never fill in a value in this list by editing `compose.yml` or the
     `.env.example` file itself - both are committed and readable by
     anyone with repo access.
4. **GHCR pull access.** Keep the three `ghcr.io/sashimee/photosite-*`
   packages private (never make them public - `photosite-api`'s `-migrate`
   tag ships the whole workspace source tree, per infra/docker/api.Dockerfile).
   Create a dedicated machine-user GitHub account, generate a read-only,
   package-scoped PAT from it, and add that as a registry credential in
   Dokploy (Settings → Registries) - not a PAT from a real human account.
5. **Confirm Traefik settings** in Dokploy before relying on this compose
   file's labels:
   - Entrypoint names: the labels below assume Traefik's default
     `web` (HTTP) / `websecure` (HTTPS) entrypoint names - check Dokploy's
     Traefik static config (or its dashboard) and adjust the
     `traefik.http.routers.*.entrypoints` labels if it names them
     differently.
   - `forwardedHeaders.insecure` must be **off** (Traefik's default) on the
     entrypoint(s) above. If it's on, Traefik trusts `X-Forwarded-For` from
     any client, not just from inside `dokploy-network`, which would let an
     external request spoof its way past `apps/api`'s per-IP rate limits
     despite `TRUSTED_PROXIES` below.
6. **Enable the deploy webhook.** In the Compose service's settings, enable
   "Deploy Webhook" and copy its URL.
7. **Add the webhook to GitHub** as the repository secret
   `DOKPLOY_PREVIEW_WEBHOOK_URL` (Settings → Secrets and variables →
   Actions → New repository secret). `.github/workflows/deploy-preview.yml`
   still builds and pushes all four image tags without it, but its last
   step (calling the webhook) fails loudly if it's missing.
8. **Add the two repository variables** (Settings → Secrets and variables →
   Actions → Variables) the same workflow bakes into the `web` image at
   build time - not secrets, they end up in the client bundle either way:
   - `NEXT_PUBLIC_API_URL` = `https://footoo.bas.lu`
   - `NEXT_PUBLIC_ALLOW_INDEXING` = `false`
   - Optionally `NEXT_PUBLIC_SENTRY_DSN` / `SENTRY_REQUIRED` once Sentry
     exists (`docs/steps/human-followups.md`).
9. **DNS.** Confirm `footoo.bas.lu` resolves to the VPS (it already did as
   of 2026-09-17: `dok.seil.pro` and `footoo.bas.lu` both point at
   `57.131.136.250`). Traefik requests its own Let's Encrypt certificate
   for the host on first request via the `letsencrypt` resolver - no
   manual certificate step.
10. **First deploy.** Push to `main` (or re-run
    `.github/workflows/deploy-preview.yml` manually) once CI is green. The
    workflow builds and pushes the four image tags (`api`, `api-migrate`,
    `worker`, `web`), then calls the webhook. Dokploy pulls the images,
    waits for `migrate` to exit 0, then starts `api`, `worker` and `web`.
11. **Seed demo content**: see "Seed" below - it does not run automatically.

## Reading logs

In the Dokploy UI: project → service → the container you want (`api`,
`worker`, `web`, `migrate`, `postgres`, ...) → Logs tab. From a shell with
SSH access to the VPS (not available from this workstation as of
2026-09-17 - see `docs/steps/human-followups.md`): `docker compose -f
infra/dokploy/preview/compose.yml logs -f api worker web`.

Mail sent by the worker goes to the internal `mailpit` container, not a
public inbox - see "Email" below for how to read it.

## Rollback

Every deploy pushes both a moving `main` tag and an immutable `sha-<short>`
tag for `api`, `api-migrate`, `worker` and `web` (short SHA = the first 7
characters `git rev-parse --short` prints for the commit CI validated).

To roll back:

1. Find the short SHA of the last known-good commit (`git log --oneline`
   on `main`, or the tag suffix in a previous successful GitHub Actions
   run).
2. In Dokploy, set the service's `IMAGE_TAG` environment variable to
   `sha-<short>` (not the full commit hash - the workflow only pushes the
   short form).
3. Redeploy (Dokploy's "Redeploy" button, or re-trigger the webhook). This
   re-runs `migrate` against the target SHA's schema first - rolling back
   past a migration that has already run forward is a manual Postgres
   operation, not something this rollback path does for you.
4. Once fixed, set `IMAGE_TAG` back to `main` and redeploy again so the
   next push resumes normal auto-deploy.

## Seed

The preview is meant to carry the same demo content
(`packages/db/src/seed.ts`: one demo user per role, three published
photographer profiles, a request/quote pair) local dev gets from
`pnpm db:seed`. Run it once after the first successful deploy (and again
any time the schema/seed data changes in a way you want reflected):

```
docker compose -f infra/dokploy/preview/compose.yml --profile seed run --rm seed
```

(From the Dokploy host or terminal - this is not part of the automatic
deploy graph, so it never re-runs on its own. It is idempotent: re-running
it against an already-seeded database is a no-op for every row it already
created.)

### Known limitation

`docs/steps/0.5-preview-deploy.md` describes an `ALLOW_DEMO_SEED=true` flag
gating the seed's production guard, but `packages/db/src/seed.ts`'s
`seedDatabase()` only checks `NODE_ENV === 'production'` today - no such
flag exists yet. The `seed` service works around this by setting
`NODE_ENV=development` for that one-shot container only (`api`, `worker`
and `migrate` all stay on `NODE_ENV=production`); every other value it uses
matches the real preview, so it seeds the actual preview database and
buckets. Filed for the schema-migrator agent: add an explicit
`ALLOW_DEMO_SEED` check to `seedDatabase()` so this workaround can go away.

## Email

The worker delivers all mail (auth verification/reset, and notifications)
through nodemailer against the internal `mailpit` container - `api` only
enqueues jobs, it holds no SMTP config of its own. Mailpit has no real
accounts, so `worker`'s SMTP_USER/SMTP_PASSWORD are just placeholders;
`mailpit` accepts them via `MP_SMTP_AUTH_ACCEPT_ANY`/
`MP_SMTP_AUTH_ALLOW_INSECURE` (safe here since `internal` never reaches the
internet).

Mailpit isn't exposed publicly (`mailpit` only joins the project's
`internal` network, not `dokploy-network`), so reading a verification/reset
link means reaching its UI (port 8025) from inside the stack:

- Dokploy's container terminal/exec on the `mailpit` service, then `curl
  http://localhost:8025/api/v1/messages` for the raw JSON; or
- an SSH tunnel to the VPS once SSH access exists
  (`docs/steps/human-followups.md`): `ssh -L 8025:mailpit:8025
  <vps-user>@dok.seil.pro`, then open `http://localhost:8025` in a browser.

The seeded demo users (`packages/db/src/seed.ts`, e.g. `client@photoo.test`)
are pre-verified, so signing in as one of them never needs Mailpit at all.

## Rate limiting

`TRUSTED_PROXIES` defaults (in `compose.yml`, not `.env`) to
`10.0.0.0/8,172.16.0.0/12,192.168.0.0/16` so `apps/api`'s per-IP rate
limits (login, sign-up, quote creation, ...) see the real client IP from
Traefik's `X-Forwarded-For` instead of collapsing every request onto
Traefik's own container IP.

The tradeoff, since `dokploy-network` is shared by every app on the host
(setup step 2): `api` trusts `X-Forwarded-For` from *any* container able to
reach it there, not only Traefik, so another app on the same Dokploy
instance could spoof it. Two follow-ups, both from setup step 5:

- Confirm `forwardedHeaders.insecure` is off in Dokploy's Traefik config -
  if it's on, this default buys nothing (Traefik itself would already
  trust a forged header from the internet).
- Narrow `TRUSTED_PROXIES` from the broad private-range default to
  `dokploy-network`'s actual subnet (`docker network inspect
  dokploy-network`, once SSH access exists) as a `.env` override, so only
  containers on that specific network are trusted rather than any RFC1918
  address.

## Public images

`api`'s `S3_PUBLIC_BASE_URL` is
`https://footoo.bas.lu/photoo-public`, routed by Traefik straight to
`minio:9000` (`GET`/`HEAD` only, path-style, so `/photoo-public/<key>`
maps onto the bucket 1:1). This makes seeded/uploaded public image variants
browser-reachable.

**Browser uploads still don't work.** Presigned PUT URLs are signed against
`S3_ENDPOINT=http://minio:9000` (the internal address, used for both
buckets), which a browser can't resolve. Fixing this needs MinIO to be
reachable at a stable public hostname whose signature matches - e.g. DNS
for `s3.footoo.bas.lu` routed to `minio:9000` and `S3_ENDPOINT` pointed at
it - not just the read-only path this compose file adds.

## Object storage users

`minio-init` creates two IAM users on top of the root pair, matching what
each app actually calls (`apps/api/src/storage/storage.service.ts`,
`apps/worker/src/storage/storage.service.ts`):

| User | Bucket | Actions |
|------|--------|---------|
| `MINIO_API_ACCESS_KEY` (`api`) | `photoo-private` | Get, Put, Delete (covers presigned PUT/GET, HEAD, and same-bucket Copy) |
| `MINIO_WORKER_ACCESS_KEY` (`worker`, and `seed` which only calls the same public-write path) | `photoo-private`: Get, Delete; `photoo-public`: Put | |

Root credentials (`MINIO_ROOT_USER`/`PASSWORD`) are used only by `minio`
itself and by `minio-init` to create the buckets, the anonymous read policy
on `photoo-public`, and these two users - never by `api` or `worker`.

## ClamAV

Off by default (`clamav` compose profile). `clamav/clamav`'s entrypoint
runs `freshclam` once, synchronously, before `clamd` starts, to fetch the
~200 MB signature database - several minutes on a cold volume - and `clamd`
itself needs roughly 1.5 GB of RAM once loaded
(`docs/steps/human-followups.md`, item 0.4). Check the VPS has that headroom
before enabling it:

```
docker compose -f infra/dokploy/preview/compose.yml --profile clamav up -d
```

With it off, uploads that reach the worker's file-scan queue fail: the
`clamd` connection is refused, the job retries, and on the final attempt
`Upload.status` becomes `'failed'` (`apps/worker/src/queues/processors/file-scan.processor.ts`)
rather than staying in some soft "pending scan" state - there is no code
path that leaves them pending indefinitely. This only affects uploads made
through the live app (profile photos, portfolio images); the seed's
placeholder images bypass the queue entirely and are written directly as
`status: 'processed'`.

## Health

`api` (`GET /health`, `GET /ready`) and `worker` (same paths on
`HEALTH_PORT`) each have a container `HEALTHCHECK`; `web` has one on `/en`.
None of the three are routed through Traefik (`docs/steps/0.5-preview-deploy.md`:
"Health endpoints stay internal") - check them via Dokploy's per-container
health status, or `docker inspect --format '{{.State.Health.Status}}'`.

From outside, the closest equivalent is the 0.5b smoke check:

```
curl -sI https://footoo.bas.lu/en          # 200, X-Robots-Tag: noindex, nofollow
curl -s  https://footoo.bas.lu/robots.txt  # Disallow: /
curl -s  https://footoo.bas.lu/v1/photographers  # seeded profiles, once seeded
```

## Future hardening

Not implemented here; noted for when they matter more:

- **Deploy by `sha-<short>` instead of the moving `main` tag.** Would make
  every deploy pin an exact, already-built image rather than "whatever
  `main` resolves to when Dokploy pulls" - closer to how "Rollback" above
  already works, just as the default path rather than a recovery path.
- **A future Sentry auth token (`docs/steps/human-followups.md`) must be
  passed to `docker build` as a BuildKit secret (`--secret`,
  `RUN --mount=type=secret`), never a build arg or `ENV`** - both of those
  land in the image's layer history and are readable from any pulled image
  with `docker history`, even non-root ones.
