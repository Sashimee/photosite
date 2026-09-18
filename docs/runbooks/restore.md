# Restore runbook (Postgres)

Background and decisions: `docs/steps/1E.3-backups.md`. `infra/dokploy/preview/README.md`
"Backups" is the "how a backup happens"; this is the "how you get it back".

**Recovery point: 24 hours.** `backup.sh` runs once a day (03:00 UTC by
default). Whatever changed since the last successful run is gone if you're
restoring — there is no WAL archiving or point-in-time recovery in this
setup (`docs/steps/1E.3-backups.md` "Decisions for this step": `pg_dump`,
not a volume snapshot). If you need a finer recovery point than "last
night", it doesn't exist yet; say so to whoever's asking, don't imply
otherwise.

**Recovery time: measured on a local drill, not yet on a real environment.**
`BACKUP_AGE_RECIPIENT` is unset on preview as of this writing (Alex hasn't
generated the keypair yet — `docs/steps/human-followups.md`), so the drill
behind this runbook ran against the local dev stack (`pnpm stack:up`), not
against `dok.seil.pro`. Every command below was actually run there; see
"The drill" at the end for the transcript and the timing. **Once
`BACKUP_AGE_RECIPIENT` exists on preview, this runbook needs a second drill
against a real object on `dok.seil.pro`, with its own measured time — don't
assume the local number holds at a different data size or over a real
network.**

## Before you touch anything

Figure out which situation you're in, because the safe first move is
different:

- **Postgres is up and fine, you just need old data back** (bad migration,
  someone deleted rows, a bug wrote garbage) → "Restore a whole database"
  or "Restore a single table" below, into the live database, after stopping
  the app.
- **Postgres itself is damaged, or you're not sure what state it's in, and
  the backup might be all that's left** → read "When the dump is the only
  surviving copy" *first*, before running anything else.

## Troubleshooting: the backup container itself

As of this writing, `backup` is the one failing container on preview: it
crash-loops with `schedule.sh: refusing to start - BACKUP_AGE_RECIPIENT is
not set.` This is the intended behaviour (`docs/steps/1E.3-backups.md`,
`infra/dokploy/preview/README.md` "Setting `BACKUP_AGE_RECIPIENT`"), not a
bug to chase — it means no backup has run yet, not that a backup failed.
Nothing in this runbook applies until Alex generates the keypair
(`age-keygen`), keeps the private half in the password manager, and sets
`BACKUP_AGE_RECIPIENT` in the Dokploy env to the public half. Don't attempt
a restore against preview before that line in the log changes to an actual
`backup.sh` run — there is nothing in `photoo-backups` to restore from yet.

## Finding the environment

Every command below needs the Dokploy compose project name and the
internal Docker network it runs on. Preview only, for now:

```bash
ssh alex@dok.seil.pro
proj=$(docker compose ls --format json | python3 -c \
  "import json,sys; print([p['Name'] for p in json.load(sys.stdin) if 'photoo' in p['Name'].lower()][0])")
# or read it off the Dokploy UI (project → Advanced → the compose command
# it runs), or `ls /etc/dokploy/compose/` — see infra/dokploy/preview/README.md
# "Seed" for the same pattern.
minio_id=$(docker ps -q -f "label=com.docker.compose.project=$proj" -f "label=com.docker.compose.service=minio")
postgres_id=$(docker ps -q -f "label=com.docker.compose.project=$proj" -f "label=com.docker.compose.service=postgres")
net=$(docker inspect "$postgres_id" --format '{{range $k,$v := .NetworkSettings.Networks}}{{println $k}}{{end}}' | grep internal)
getenv() { docker inspect "$1" --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n "s/^$2=//p"; }
```

`getenv "$postgres_id" POSTGRES_PASSWORD` and friends pull the already-set
values out of the running containers so you never have to type them, and
they never appear in your shell history as a literal secret you typed —
same trick as the seed runbook.

## 1. Restore a whole database

This is the "I have an encrypted object, I need the app running against
what it contains" path, for when Postgres itself is healthy and reachable
— you're rolling the *data* back, not recovering from a dead host.

**The private key never lives on the server's persistent disk.** It's in
Alex's password manager. Download it to your own laptop only when you need
it, and when you do need it on the VPS (there's no practical way to decrypt
a multi-container internal network from your laptop without a tunnel this
runbook doesn't set up yet), put it in `/dev/shm` — tmpfs, RAM-backed, gone
on reboot — and `shred` it the moment you're done. It must never land in a
regular file, a bind-mounted named volume, a log, or a `docker cp`'d
directory that outlives the session.

```bash
# 1. Get the key onto the VPS, RAM-backed only. Run this from your laptop,
#    with the age private key exported from your password manager into a
#    local temp file first (delete that local temp file too when you're done).
scp ./restore.key alex@dok.seil.pro:/dev/shm/restore.key

# 2. Back on the VPS: find the object to restore. The backup user
#    (MINIO_BACKUP_ACCESS_KEY) can list and write but not read — use the
#    MinIO root credentials (Dokploy env) to list and fetch.
root_user=$(getenv "$minio_id" MINIO_ROOT_USER)
root_pass=$(getenv "$minio_id" MINIO_ROOT_PASSWORD)
image=ghcr.io/sashimee/photosite-backup:main   # match the IMAGE_TAG the project is running

docker run --rm --network "$net" \
  -e MC_HOST_backup="http://${root_user}:${root_pass}@minio:9000" \
  --entrypoint mc "$image" \
  find "backup/photoo-backups/photoo/preview/" --name '*.dump.age'
# pick the object you want, e.g. photoo/preview/2026/09/2026-09-17T03-00-04Z.dump.age

# 3. Fetch it and decrypt it into /dev/shm — never onto the postgres-data
#    volume or any other persistent path.
docker run --rm --network "$net" -v /dev/shm:/keys \
  -e MC_HOST_backup="http://${root_user}:${root_pass}@minio:9000" \
  --entrypoint mc "$image" \
  cp "backup/photoo-backups/<object-key-from-step-2>" /keys/restore.dump.age

docker run --rm -v /dev/shm:/keys --entrypoint sh "$image" -c \
  "age --decrypt -i /keys/restore.key -o /keys/restore.dump /keys/restore.dump.age"

# 4. STOP THE APP FIRST. Anything still writing to Postgres during the
#    restore either errors out mid-transaction or gets silently clobbered
#    by --clean. This is the destructive step: it drops and recreates every
#    object pg_dump captured, in the live database.
docker stop $(docker ps -q -f "label=com.docker.compose.project=$proj" -f "label=com.docker.compose.service=api") \
             $(docker ps -q -f "label=com.docker.compose.project=$proj" -f "label=com.docker.compose.service=worker")

# 5. DESTRUCTIVE: restores over the live database, dropping and recreating
#    every table pg_dump captured. There is no undo once this runs beyond
#    taking another backup first — see "when the dump is the only
#    surviving copy" if you're not confident the live data is worth losing.
pg_user=$(getenv "$postgres_id" POSTGRES_USER)
pg_pass=$(getenv "$postgres_id" POSTGRES_PASSWORD)
pg_db=$(getenv "$postgres_id" POSTGRES_DB)

docker run --rm --network "$net" -v /dev/shm:/keys \
  -e PGPASSWORD="$pg_pass" \
  --entrypoint pg_restore "$image" \
  --host postgres --port 5432 --username "$pg_user" --dbname "$pg_db" \
  --no-owner --clean --if-exists /keys/restore.dump

# 6. Clean up the plaintext and the key before anything else.
ssh alex@dok.seil.pro 'shred -u /dev/shm/restore.key /dev/shm/restore.dump /dev/shm/restore.dump.age'

# 7. Restart the app and verify (see "Verify the restore" below) before
#    calling it done.
docker start $(docker ps -aq -f "label=com.docker.compose.project=$proj" -f "label=com.docker.compose.service=api") \
              $(docker ps -aq -f "label=com.docker.compose.project=$proj" -f "label=com.docker.compose.service=worker")
```

`pg_restore --clean --if-exists` (no `--create`) targets the database name
that's already there, dropping and recreating each object inside it rather
than the database itself — that's what the drill below used, restoring
into an existing empty database created ahead of time. It behaves the same
against an existing populated one: everything it has a definition for gets
dropped and replaced.

## 2. Restore a single table

Use `pg_restore -t <TableName>` when only one table needs to come back —
e.g. someone ran a bad `UPDATE`/`DELETE` against one table and the rest of
the database is fine. Same fetch-and-decrypt steps as above, then:

```bash
docker run --rm --network "$net" -v /dev/shm:/keys \
  -e PGPASSWORD="$pg_pass" \
  --entrypoint pg_restore "$image" \
  --host postgres --port 5432 --username "$pg_user" --dbname "$pg_db" \
  --data-only -t PhotographerProfile /keys/restore.dump
```

**The foreign-key caveat, confirmed by running both ways in the drill:**

- **Without `--disable-triggers`** (the command above), Postgres enforces
  every foreign key while the rows load. If a row references something
  that isn't in the target database (the drill's own example:
  `PhotographerProfile.avatarUploadId` pointing at an `Upload` row that
  wasn't there), the restore fails loudly:

  ```
  pg_restore: error: COPY failed for table "PhotographerProfile": ERROR:  insert or update on table "PhotographerProfile" violates foreign key constraint "PhotographerProfile_avatarUploadId_fkey"
  DETAIL:  Key (avatarUploadId)=(...) is not present in table "Upload".
  pg_restore: warning: errors ignored on restore: 1
  ```

  That's the safe failure mode — nothing partially wrong lands in the
  table. Restore whatever it's complaining about first (in this example,
  `Upload`, then retry `PhotographerProfile`), in dependency order, table
  by table.

- **With `--disable-triggers`**, Postgres skips the FK check entirely (it's
  implemented as a trigger) and the restore reports success — but the
  drill's own test left four `PhotographerProfile` rows pointing at `User`
  ids that didn't exist:

  ```sql
  select p."userId" from "PhotographerProfile" p
  left join "User" u on u.id = p."userId"
  where u.id is null;
  -- returned 4 rows: silently orphaned foreign keys, exit code 0
  ```

  Only reach for `--disable-triggers` when you are about to restore every
  table the target one references, in the same maintenance window, before
  anyone reads the data — and run the orphan-check query above (adjusted
  for the relevant foreign keys) afterward regardless. A `pg_restore` that
  exits 0 is not proof the data is referentially intact.

Check `packages/db/prisma/schema.prisma` for a table's `@relation` fields
before restoring it alone, so you know which parent tables to check or
restore first.

## 3. When the dump is the only surviving copy

This is the disaster case: Postgres is damaged, gone, or you don't trust
its current state, and the nightly dump might be the only thing left.

**Do first:**

1. **Stop anything from writing to the damaged database.** Don't restart
   `api`/`worker` pointed at it, don't run manual `UPDATE`s "just to
   check", don't `VACUUM` or otherwise touch it hoping to fix it in place.
   Every write is a chance to overwrite data that might still be more
   recent than last night's backup, and destroys any hope of a filesystem-
   or WAL-level recovery attempt later if it turns out you need one.
2. **Copy the encrypted object you intend to restore somewhere else before
   you touch it** — your laptop, a second bucket, anywhere outside
   `photoo-backups`. `prune.sh` runs weekly and will delete this exact
   object once it ages out of retention; more importantly, if you fat-
   finger a `mc rm` or overwrite it while experimenting, this may be the
   last copy of the data that exists anywhere. Get a copy of the copy
   before you start.
3. **Do every restore attempt against a scratch database**, not the
   original name, until you've verified it (see below). Never point the
   `--clean` restore at the real database name as your first attempt —
   that's a one-way door.

**Do not:**

- Do not decrypt or restore using the *only* copy of the object as your
  working copy — work from the duplicate you made in step 2.
- Do not assume the backup is current. There's no finer recovery point
  than the last nightly dump in this setup (see the RPO note at the top) —
  if the incident happened after 03:00 UTC, everything since is gone, and
  that's a fact to state plainly to whoever's asking, not a detail to
  gloss over.
- Do not skip straight to `--clean` into the live database name once
  you've verified the scratch restore looks right — rename or swap only
  after you've checked row counts and spot-checked content (below).

Once the scratch restore is verified, follow "Restore a whole database"
above to land it in the real database name and bring the app back.

## Verify the restore

`pg_restore` exiting 0 means the commands it ran succeeded, not that the
data is complete or correct — the single-table drill above exited 0 while
producing four rows with a foreign key pointing at nothing. Check, in this
order:

1. **`pg_restore`'s own output.** Zero exit code and no "errors ignored on
   restore" line. If either is off, the restore is not done — do not treat
   it as good.
2. **Row counts, against a number you captured before the incident** — the
   database's own state right before things went wrong (from monitoring,
   from a manual count you ran before starting the restore, or from the
   dump's own `pg_restore --list | grep -c ' TABLE DATA '` if you have
   nothing else), not against fixed numbers baked into this runbook. The
   local drill's seed produced a specific, reproducible set of counts
   (`User=10`, `PhotographerProfile=4`, `Request=2`, `Quote=2`, etc.) and
   the restored scratch database matched every one of them exactly — that
   proves the mechanism works, but preview/production will have different,
   growing counts that this file can't predict.
3. **Spot-check actual content**, not just counts — a table can have the
   right row count and the wrong rows (e.g. after a botched `--disable-
   triggers` restore). `select email from "User" order by email;` and
   confirm the names you expect are actually there, not just that ten rows
   exist.
4. **Foreign-key integrity** if you restored fewer than all tables — the
   orphan-check query pattern in "Restore a single table" above, adapted
   to the relationship you're worried about.
5. **The application, not just the database.** Restart `api`/`worker`
   against the restored data and hit the real path, per
   `infra/dokploy/preview/README.md` "Health":
   `curl -s https://footoo.bas.lu/v1/photographers | head -c 200` — data in
   Postgres that the API can't or won't serve isn't a finished restore.

## The drill

Performed locally against `pnpm stack:up` (postgres+postgis, redis, minio,
mailpit), **not** against preview — `BACKUP_AGE_RECIPIENT` doesn't exist
there yet (see the top of this file). Steps, in the order run:

1. `pnpm stack:up`, then `pnpm --filter @photoo/db exec prisma migrate
   deploy` and `pnpm db:seed` to get a known, reproducible dataset (the
   counts in "Verify the restore" above).
2. A throwaway `age` keypair, generated inside a container built from
   `infra/docker/backup.Dockerfile` (`age-keygen`) — never printed or
   committed; the private half lived only in a Docker volume for the
   duration of the drill and was deleted (`docker volume rm`) afterward.
   Only the public key (safe to share, and useless without the private
   half) appeared in any output.
3. A `photoo-backups` bucket and a scoped, put/list-only MinIO user created
   by hand against the dev MinIO (the dev compose's `minio-init` doesn't
   create these — only `infra/dokploy/preview/compose.yml`'s does; see
   "Known gaps" below).
4. `backup.sh`, run exactly as the `backup` compose service runs it, via
   `docker run --network docker_default` against that stack:

   ```
   backup.sh: dumping photoo@postgres:5432
   backup.sh: verifying the dump's table of contents reads back
   backup.sh: dump is 105207 bytes, 35 tables
   backup.sh: encrypting for BACKUP_AGE_RECIPIENT
   backup.sh: uploading to photoo-backups/photoo/drill/2026/09/2026-09-18T01-36-40Z.dump.age
   backup.sh: done - photoo/drill/2026/09/2026-09-18T01-36-40Z.dump.age (105423 bytes encrypted, 35 tables)
   ```
5. A scratch database (`photoo_restore_drill`), and the full whole-database
   restore path: `mc cp` the object out with root credentials (the backup
   user's own credentials correctly refused — no `s3:GetObject` in its
   policy, confirming the README's claim), `age --decrypt`, `pg_restore
   --no-owner --clean --if-exists`.
6. Row counts compared against the live database at backup time — exact
   match on every table checked (`User`, `PhotographerProfile`, `Country`,
   `Request`, `Quote`, `Message`, `Conversation`, `VerificationCase`,
   `AdminPermissionGrant`, `PlatformSetting`), plus a spot check of
   `User.email` values, including some non-seed rows another session had
   added — confirming this was a real restore of real data, not the
   scratch database coincidentally matching the seed.
7. The single-table FK behaviour in "Restore a single table" above, both
   ways (with and without `--disable-triggers`), against the same restored
   scratch database.
8. Cleanup: scratch databases dropped, the drill's MinIO user/policy/bucket
   removed, the key volume removed, the local backup image untagged.

**Measured time**, `time`-wrapped, for the mechanical fetch-decrypt-restore
pipeline (step 5), against a 105 KB / 35-table dump on the same Docker
network (no real network hop):

```
real    0m1.385s   # mc cp + age --decrypt + pg_restore --clean --if-exists, combined
real    0m1.115s   # pg_restore alone, re-run for confirmation
```

Take this as evidence the mechanism works and is fast at this data size,
**not** as the recovery time to quote anyone. It excludes every human step
(retrieving the key from the password manager, SSH access, finding the
compose project, stopping the app, verifying afterward) and every bit of
network transfer a real VPS restore would need for the encrypted object.
The number that matters for an incident — total wall-clock from "I've been
paged" to "the app is serving restored data" — has to come from the
preview drill once `BACKUP_AGE_RECIPIENT` exists, and that number belongs
in this file next to this one, not instead of it.

## Known gaps this drill surfaced

- The dev compose (`infra/docker/compose.dev.yml`) has no `photoo-backups`
  bucket or backup/prune users — only `infra/dokploy/preview/compose.yml`
  creates them. A local backup/restore drill has to create both by hand
  (as this one did). Worth adding to the dev compose if local backup
  drills become routine; not done here since it's outside 1E.3b's scope.
- The backup user's policy is correctly write/list-only and cannot fetch
  its own uploads back — confirmed by the drill (`mc cp` with those
  credentials failed with "Insufficient permissions"), matching
  `infra/dokploy/preview/README.md`. Restoring always needs the root
  credentials or the prune user, never the backup user's own.
- No tooling in this repo sets up an SSH tunnel for decrypting from an
  operator's own laptop without the private key ever touching the VPS at
  all. The procedure above is the pragmatic middle ground (RAM-backed,
  shredded immediately, never on persistent disk) rather than that ideal;
  revisit if a tunnel-based approach turns out to be worth the setup.
