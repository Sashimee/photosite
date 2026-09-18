#!/bin/sh
# Dump the Postgres database, encrypt it, upload it to the backup bucket and
# verify the upload - one run, then exit. Not pipefail (POSIX sh; see
# infra/dokploy/preview/README.md "Backups" for why pipefail isn't used here):
# every step that matters writes to a file and is checked on its own, so no
# pipeline's exit status needs to survive a `|`.
#
# Required environment variables:
#   POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB   - database to dump
#   BACKUP_AGE_RECIPIENT                            - age public key (age1...);
#                                                      never falls back to a
#                                                      plaintext dump if unset
#   BACKUP_ENV                                       - e.g. preview, staging,
#                                                      production; used in the
#                                                      object key
#   BACKUP_ACCESS_KEY, BACKUP_SECRET_KEY             - MinIO user scoped to
#                                                      PutObject+ListBucket on
#                                                      BACKUP_BUCKET, no delete
# Optional:
#   POSTGRES_HOST (default postgres), POSTGRES_PORT (default 5432)
#   MINIO_ENDPOINT (default http://minio:9000)
#   BACKUP_BUCKET (default photoo-backups)
#   BACKUP_MIN_BYTES (default 10240 - an empty database's dump already clears this)
set -eu

require() {
  var_name=$1
  eval "var_value=\${$var_name:-}"
  if [ -z "$var_value" ]; then
    echo "backup.sh: refusing to run - $var_name is not set" >&2
    exit 1
  fi
}

require POSTGRES_USER
require POSTGRES_PASSWORD
require POSTGRES_DB
# The single most important guard in this script: no environment silently
# falls back to writing an unencrypted dump when this is missing.
require BACKUP_AGE_RECIPIENT
require BACKUP_ENV
require BACKUP_ACCESS_KEY
require BACKUP_SECRET_KEY

POSTGRES_HOST=${POSTGRES_HOST:-postgres}
POSTGRES_PORT=${POSTGRES_PORT:-5432}
MINIO_ENDPOINT=${MINIO_ENDPOINT:-http://minio:9000}
BACKUP_BUCKET=${BACKUP_BUCKET:-photoo-backups}
BACKUP_MIN_BYTES=${BACKUP_MIN_BYTES:-10240}

# mc reads credentials from this env var, never from argv - `ps` and
# container inspection expose command lines, an env var does not.
endpoint_scheme=${MINIO_ENDPOINT%%://*}
endpoint_host=${MINIO_ENDPOINT#*://}
export MC_HOST_backup="${endpoint_scheme}://${BACKUP_ACCESS_KEY}:${BACKUP_SECRET_KEY}@${endpoint_host}"

run_ts=$(date -u +%Y-%m-%dT%H-%M-%SZ)
run_year=$(printf '%s' "$run_ts" | cut -c1-4)
run_month=$(printf '%s' "$run_ts" | cut -c6-7)
object_key="photoo/${BACKUP_ENV}/${run_year}/${run_month}/${run_ts}.dump.age"
heartbeat_key="photoo/${BACKUP_ENV}/heartbeat.json"

plain_dump=$(mktemp)
encrypted_dump=$(mktemp)
toc_file=$(mktemp)
cleanup() { rm -f "$plain_dump" "$encrypted_dump" "$toc_file"; }
trap cleanup EXIT

echo "backup.sh: checking ${BACKUP_BUCKET} is reachable at ${MINIO_ENDPOINT}"
if ! mc ls "backup/${BACKUP_BUCKET}" >/dev/null 2>&1; then
  echo "backup.sh: refusing to run - cannot reach bucket ${BACKUP_BUCKET} at ${MINIO_ENDPOINT} with BACKUP_ACCESS_KEY (check MINIO_ENDPOINT/BACKUP_BUCKET/BACKUP_ACCESS_KEY/BACKUP_SECRET_KEY)" >&2
  exit 1
fi

echo "backup.sh: dumping ${POSTGRES_DB}@${POSTGRES_HOST}:${POSTGRES_PORT}"
PGPASSWORD=$POSTGRES_PASSWORD pg_dump \
  --host "$POSTGRES_HOST" \
  --port "$POSTGRES_PORT" \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --format custom \
  --file "$plain_dump"

dump_bytes=$(wc -c <"$plain_dump" | tr -d ' ')
if [ "$dump_bytes" -lt "$BACKUP_MIN_BYTES" ]; then
  echo "backup.sh: refusing to upload - dump is ${dump_bytes} bytes, below BACKUP_MIN_BYTES (${BACKUP_MIN_BYTES}); a truncated or empty dump is not a backup" >&2
  exit 1
fi

echo "backup.sh: verifying the dump's table of contents reads back"
# Checked as its own command, not piped into grep: under `set -e` without
# pipefail (see the top of this file), a pipe's exit status is its last
# command's, so a failing pg_restore feeding a non-matching grep would
# otherwise go unnoticed.
if ! pg_restore --list "$plain_dump" >"$toc_file" 2>&1; then
  echo "backup.sh: refusing to upload - pg_restore --list failed against the dump (corrupt or truncated)" >&2
  cat "$toc_file" >&2
  exit 1
fi
table_count=$(grep -c ' TABLE DATA ' "$toc_file" || true)
echo "backup.sh: dump is ${dump_bytes} bytes, ${table_count} tables"

echo "backup.sh: encrypting for BACKUP_AGE_RECIPIENT"
age --encrypt --recipient "$BACKUP_AGE_RECIPIENT" --output "$encrypted_dump" "$plain_dump"

encrypted_bytes=$(wc -c <"$encrypted_dump" | tr -d ' ')
if [ "$encrypted_bytes" -lt "$BACKUP_MIN_BYTES" ]; then
  echo "backup.sh: refusing to upload - encrypted dump is ${encrypted_bytes} bytes, below BACKUP_MIN_BYTES (${BACKUP_MIN_BYTES})" >&2
  exit 1
fi

echo "backup.sh: uploading to ${BACKUP_BUCKET}/${object_key}"
mc cp "$encrypted_dump" "backup/${BACKUP_BUCKET}/${object_key}"

heartbeat=$(printf '{"env":"%s","object":"%s","ranAt":"%s","dumpBytes":%s,"encryptedBytes":%s,"tables":%s,"status":"ok"}\n' \
  "$BACKUP_ENV" "$object_key" "$run_ts" "$dump_bytes" "$encrypted_bytes" "${table_count:-0}")
printf '%s' "$heartbeat" | mc pipe "backup/${BACKUP_BUCKET}/${heartbeat_key}"

echo "backup.sh: done - ${object_key} (${encrypted_bytes} bytes encrypted, ${table_count} tables)"
