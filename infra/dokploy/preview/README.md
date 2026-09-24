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
   - `VERIFICATION_ENCRYPTION_KEY`: `openssl rand -base64 32`, same
     constraint as `AUTH_ENCRYPTION_KEY` - used by both the `api` service and
     the `seed` profile, which must get the same value or the api can't
     decrypt what the seed encrypts.
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

With Dokploy's "Create environment file" option on, Dokploy writes the
project env as a `.env` **beside the compose file** it deploys
(`/etc/dokploy/compose/<appName>/code/infra/dokploy/preview/.env`), not
at the repository root, and Compose loads it from there on its own. So
the normal invocation works from the checkout:

```bash
cd /etc/dokploy/compose/compose-index-back-end-application-k6x26o/code
docker compose -p compose-index-back-end-application-k6x26o \
  -f infra/dokploy/preview/compose.yml --profile seed run --rm seed
```

Do not pass `--env-file .env` — that resolves against the working
directory, where Dokploy never writes one, and Compose then refuses to
parse this file with any `${VAR:?}` unset.

If that file is missing (the option was turned on after the last deploy,
so no deploy has written it yet), either redeploy once or run the
one-shot container directly, taking the already-resolved connection
strings out of the running **worker** container. It has to be the worker
and not the api: the api's MinIO user is scoped to `photoo-private`
("Object storage users" below), while the seed writes placeholder images
to `photoo-public`, so the api's key fails with `AccessDenied`. Only
`SEED_USER_PASSWORD` has to be typed (copy it from the compose service's
Environment tab), because the seed is its only consumer and no running
container carries it:

```bash
proj=compose-index-back-end-application-k6x26o
wkr=$(docker ps -q -f "label=com.docker.compose.project=$proj" \
                  -f "label=com.docker.compose.service=worker" | head -1)
getenv() { docker inspect "$1" --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n "s/^$2=//p"; }
net=$(docker inspect "$wkr" --format '{{range $k,$v := .NetworkSettings.Networks}}{{println $k}}{{end}}' | grep internal)

read -rsp 'SEED_USER_PASSWORD: ' seedpw; echo

docker run --rm --network "$net" -w /app/packages/db --entrypoint node \
  -e NODE_ENV=development \
  -e DATABASE_URL="$(getenv "$wkr" DATABASE_URL)" \
  -e SEED_USER_PASSWORD="$seedpw" \
  -e S3_ENDPOINT=http://minio:9000 \
  -e S3_REGION=eu-west-1 \
  -e S3_ACCESS_KEY_ID="$(getenv "$wkr" S3_ACCESS_KEY_ID)" \
  -e S3_SECRET_ACCESS_KEY="$(getenv "$wkr" S3_SECRET_ACCESS_KEY)" \
  -e S3_FORCE_PATH_STYLE=true \
  -e S3_PRIVATE_BUCKET=photoo-private \
  -e S3_PUBLIC_BUCKET=photoo-public \
  ghcr.io/sashimee/photosite-api:main-migrate dist/seed.js

unset seedpw
```

`read -rsp` does not echo, and `$net` is the project's `internal`
network, where `postgres` and `minio` resolve by name. Verify with
`curl -s https://footoo.bas.lu/v1/photographers | head -c 200`.

This is not part of the automatic deploy graph, so it never re-runs on
its own. It is idempotent: re-running it against an already-seeded
database is a no-op for every row it already created.

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

**If images 404 with a Next.js page instead of MinIO's XML**, the router
is disabled, not missing. Traefik drops a router whose rule fails to
parse and the request falls through to the catch-all web router, which
answers with its own 404 - so the symptom looks like a missing object.
Check the rule, not the bucket:

```bash
sudo docker exec dokploy-traefik wget -qO- \
  http://localhost:8080/api/http/routers/photoo-preview-public@docker
```

`status` must be `enabled`; an `error` field holds the parse failure.
Traefik v3 matchers take exactly one parameter each, so `Method` needs
`(Method(`GET`) || Method(`HEAD`))` rather than a two-verb list.

**Browser uploads still don't work.** Presigned PUT/GET URLs are signed
against `S3_ENDPOINT=http://minio:9000` (the internal address, used for
both buckets), which a browser can't resolve. Fixing this needs MinIO to be
reachable at a stable public hostname whose signature matches - e.g. DNS
for `s3.footoo.bas.lu` routed to `minio:9000` and `S3_ENDPOINT` pointed at
it - not just the read-only path this compose file adds. `web`'s CSP
`connect-src`/`img-src` (`apps/web/src/proxy.ts`, #322) already allow
whatever `NEXT_PUBLIC_STORAGE_ORIGIN` is set to; once that public hostname
exists, set `S3_ENDPOINT` and `NEXT_PUBLIC_STORAGE_ORIGIN` to it (build arg
and runtime env, like `NEXT_PUBLIC_MEDIA_BASE_URL` - see #310 and #303 for
the general build-arg/cache gaps in this deploy path).

## Object storage users

`minio-init` creates four IAM users on top of the root pair, matching what
each app actually calls (`apps/api/src/storage/storage.service.ts`,
`apps/worker/src/storage/storage.service.ts`):

| User | Bucket | Actions |
|------|--------|---------|
| `MINIO_API_ACCESS_KEY` (`api`) | `photoo-private` | Get, Put, Delete (covers presigned PUT/GET, HEAD, and same-bucket Copy) |
| `MINIO_WORKER_ACCESS_KEY` (`worker`, and `seed` which only calls the same public-write path) | `photoo-private`: Get, Delete; `photoo-public`: Put | |
| `MINIO_BACKUP_ACCESS_KEY` (`backup`'s `backup.sh`) | `photoo-backups` | List, Put - no Get, no Delete |
| `MINIO_PRUNE_ACCESS_KEY` (`backup`'s `prune.sh`) | `photoo-backups` (`photoo/*` only) | List (whole bucket), Get, Delete (`photoo/*` only) |

Root credentials (`MINIO_ROOT_USER`/`PASSWORD`) are used only by `minio`
itself and by `minio-init` to create the buckets, the anonymous read policy
on `photoo-public`, and these four users - never by `api`, `worker` or
`backup`.

## Backups

Background and decisions: `docs/steps/1E.3-backups.md`. This section is the
"how".

**What runs.** The `backup` compose service is a long-running sidecar
(`infra/dokploy/backup/schedule.sh`, `restart: unless-stopped`) built from
`infra/docker/backup.Dockerfile` - the same `postgis/postgis` digest as
`postgres`, so `pg_dump`/`pg_restore` match the server exactly, plus `age`
and `mc` layered on top (that base has no `age` package and the `internal`
network has no internet at runtime to install one). It schedules itself
rather than relying on a Dokploy scheduled-task feature, which we could not
verify exists on this Dokploy instance - if one is confirmed later, switch
to a `restart: "no"` one-shot service triggered by that instead and drop
`schedule.sh`. Inside the container:

- `backup.sh` runs daily at `BACKUP_HOUR_UTC` (default 3am UTC): `pg_dump
  -Fc`, `pg_restore --list` against the plaintext dump to catch a corrupt
  dump before it's ever uploaded, encrypts with `age` for
  `BACKUP_AGE_RECIPIENT`, uploads, then writes a heartbeat object. It
  refuses to run - and never writes a plaintext dump - if
  `BACKUP_AGE_RECIPIENT` is unset, if the bucket is unreachable, or if the
  dump (plaintext or encrypted) is smaller than `BACKUP_MIN_BYTES` (10 KiB
  default; an empty database's dump already clears this).
- `prune.sh` runs weekly on Sundays at `PRUNE_HOUR_UTC` (default 4am UTC):
  keeps the newest 7 daily, 4 weekly, 6 monthly dumps and deletes the rest,
  using a separate MinIO user that can only delete under the backup prefix
  - the backup user itself cannot delete anything, so a compromised backup
    job can't destroy its own history.

**Where objects land.** Bucket `photoo-backups`, private (no anonymous
access, unlike `photoo-public`). Key format:
`photoo/preview/<YYYY>/<MM>/<YYYY-MM-DDTHH-mm-ssZ>.dump.age`, plus a
`photoo/preview/heartbeat.json` overwritten on every successful run. Staging
and production reuse the same image and scripts with `BACKUP_ENV` set to
`staging`/`production`, so their objects live under a different top-level
prefix in the same or a different bucket and can never collide.

**How to list them**, from a shell with SSH access to the VPS (or the
`minio` container's exec/terminal in the Dokploy UI):

```bash
docker run --rm --network <project>_internal \
  -e MC_HOST_local=http://<MINIO_BACKUP_ACCESS_KEY>:<MINIO_BACKUP_SECRET_KEY>@minio:9000 \
  quay.io/minio/mc:RELEASE.2025-08-13T08-35-41Z \
  find local/photoo-backups/photoo/preview/ --name '*.dump.age'
```

The backup user can list and write but has no `s3:GetObject` at all, so it
cannot download an object's contents - use the root credentials (Dokploy
env) or the prune user (which can read under this prefix) if you need to
fetch an object for a restore. See `docs/runbooks/restore.md` for the full
restore procedure (whole database, single table, disaster recovery,
verification) and the measured time from its drill.

**How to read a failure.** `docker logs` (or Dokploy's Logs tab) on the
`backup` container: every guard prints which variable or check failed,
never a secret. A missing or stale `photoo/preview/heartbeat.json` (compare
its `ranAt` to "now minus a day") means the last run never got as far as
uploading - check the log for which guard fired. There is no alert on a
missing heartbeat yet: `docs/steps/1E.3-backups.md` "Failure is visible
without a person watching" tracks this as blocked on 1E.2 monitoring, not
silently assumed to be covered.

**Setting `BACKUP_AGE_RECIPIENT`** (`docs/steps/human-followups.md`): Alex
runs `age-keygen` locally, keeps the private key in a password manager (it
must never touch this server), and pastes the `age1...` public key into the
Dokploy env as `BACKUP_AGE_RECIPIENT`. Until it's set, `backup` refuses to
start and restarts in a crash loop, logging the same refusal each time -
that is the intended failure mode, not a bug. The refusal is checked when
the container starts, not when the 03:00 UTC run comes round, so an unset
key is visible immediately instead of looking healthy all day and failing
overnight. The variable deliberately has no `:?` default in `compose.yml`:
compose interpolates the whole file before it filters services, so a
required-but-unset variable there would abort the deploy of the entire
stack rather than this one container.

**Known limitation.** MinIO shares this host with Postgres, so this backup
protects against a bad migration or a dropped database, not against losing
the machine. Off-host replication (a second S3 target in the EU) is a
production follow-up, not implemented here. Redis and MinIO's own object
contents (user uploads) are not backed up by this step either -
`docs/steps/1E.3-backups.md` "Decisions for this step" records why.

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
