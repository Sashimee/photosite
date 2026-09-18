#!/bin/sh
# Runs with a separate, delete-only-under-this-prefix MinIO user: a backup
# user that can delete is a backup that ransomware deletes.
#
# Required environment variables:
#   BACKUP_ENV                            - e.g. preview, staging, production
#   PRUNE_ACCESS_KEY, PRUNE_SECRET_KEY    - MinIO user scoped to DeleteObject
#                                            (and ListBucket/GetObject to find
#                                            what to delete) under
#                                            photoo/<BACKUP_ENV>/* only
# Optional:
#   MINIO_ENDPOINT (default http://minio:9000)
#   BACKUP_BUCKET (default photoo-backups)
#   BACKUP_RETAIN_DAILY (default 7)
#   BACKUP_RETAIN_WEEKLY (default 4)
#   BACKUP_RETAIN_MONTHLY (default 6)
set -eu

require() {
  var_name=$1
  eval "var_value=\${$var_name:-}"
  if [ -z "$var_value" ]; then
    echo "prune.sh: refusing to run - $var_name is not set" >&2
    exit 1
  fi
}

require BACKUP_ENV
require PRUNE_ACCESS_KEY
require PRUNE_SECRET_KEY

MINIO_ENDPOINT=${MINIO_ENDPOINT:-http://minio:9000}
BACKUP_BUCKET=${BACKUP_BUCKET:-photoo-backups}
BACKUP_RETAIN_DAILY=${BACKUP_RETAIN_DAILY:-7}
BACKUP_RETAIN_WEEKLY=${BACKUP_RETAIN_WEEKLY:-4}
BACKUP_RETAIN_MONTHLY=${BACKUP_RETAIN_MONTHLY:-6}

endpoint_scheme=${MINIO_ENDPOINT%%://*}
endpoint_host=${MINIO_ENDPOINT#*://}
export MC_HOST_prune="${endpoint_scheme}://${PRUNE_ACCESS_KEY}:${PRUNE_SECRET_KEY}@${endpoint_host}"

prefix="photoo/${BACKUP_ENV}/"

echo "prune.sh: checking ${BACKUP_BUCKET} is reachable at ${MINIO_ENDPOINT}"
if ! mc ls "prune/${BACKUP_BUCKET}" >/dev/null 2>&1; then
  echo "prune.sh: refusing to run - cannot reach bucket ${BACKUP_BUCKET} at ${MINIO_ENDPOINT} with PRUNE_ACCESS_KEY (check MINIO_ENDPOINT/BACKUP_BUCKET/PRUNE_ACCESS_KEY/PRUNE_SECRET_KEY)" >&2
  exit 1
fi

objects=$(mktemp)
dated=$(mktemp)
daily_seen=$(mktemp)
weekly_seen=$(mktemp)
monthly_seen=$(mktemp)
cleanup() { rm -f "$objects" "$dated" "$daily_seen" "$weekly_seen" "$monthly_seen"; }
trap cleanup EXIT

mc find "prune/${BACKUP_BUCKET}/${prefix}" --name '*.dump.age' >"$objects" || true

if [ ! -s "$objects" ]; then
  echo "prune.sh: no backup objects found under ${prefix}, nothing to prune"
  exit 0
fi

# One line per object: "<epoch> <alias/bucket/key>", derived from the
# filename's own timestamp (not mc's listing time, which is upload time and
# drifts from the backup's run time under retries).
while IFS= read -r path; do
  filename=$(basename "$path")
  ts=$(printf '%s' "$filename" | sed -n 's/^\(.*\)\.dump\.age$/\1/p')
  iso=$(printf '%s' "$ts" | sed -E 's/^([0-9]{4}-[0-9]{2}-[0-9]{2})T([0-9]{2})-([0-9]{2})-([0-9]{2})Z$/\1T\2:\3:\4Z/')
  if [ "$iso" = "$ts" ]; then
    echo "prune.sh: skipping ${path} - filename doesn't match the expected <timestamp>.dump.age pattern" >&2
    continue
  fi
  epoch=$(date -u -d "$iso" +%s)
  printf '%s %s\n' "$epoch" "$path" >>"$dated"
done <"$objects"

# Newest first: each object is kept by the first tier with room for it and a
# group key (day/week/month) it hasn't already filled - the standard
# grandfather-father-son shuffle, and correct here because a nightly run
# gives each calendar day at most one object.
sort -rn "$dated" | while IFS=' ' read -r epoch path; do
  day_key=$(date -u -d "@${epoch}" +%Y-%m-%d)
  week_key=$(date -u -d "@${epoch}" +%G-W%V)
  month_key=$(date -u -d "@${epoch}" +%Y-%m)

  keep=0
  if [ "$(wc -l <"$daily_seen")" -lt "$BACKUP_RETAIN_DAILY" ] && ! grep -Fxq "$day_key" "$daily_seen" 2>/dev/null; then
    echo "$day_key" >>"$daily_seen"
    keep=1
  elif [ "$(wc -l <"$weekly_seen")" -lt "$BACKUP_RETAIN_WEEKLY" ] && ! grep -Fxq "$week_key" "$weekly_seen" 2>/dev/null; then
    echo "$week_key" >>"$weekly_seen"
    keep=1
  elif [ "$(wc -l <"$monthly_seen")" -lt "$BACKUP_RETAIN_MONTHLY" ] && ! grep -Fxq "$month_key" "$monthly_seen" 2>/dev/null; then
    echo "$month_key" >>"$monthly_seen"
    keep=1
  fi

  if [ "$keep" -eq 1 ]; then
    echo "prune.sh: keeping ${path} (day=${day_key} week=${week_key} month=${month_key})"
  else
    echo "prune.sh: deleting ${path}"
    mc rm "$path"
  fi
done
