#!/bin/sh
# Long-running entrypoint for the `backup` compose service: this exists
# because we could not verify a scheduled-task feature on this Dokploy
# instance (docs/steps/1E.3-backups.md), so the container schedules itself
# rather than relying on one. `backup.sh` and `prune.sh` each still run and
# exit on their own; this only decides when.
#
# Required/optional variables: everything backup.sh and prune.sh require, plus:
#   BACKUP_HOUR_UTC (default 3)  - daily backup.sh run time
#   PRUNE_HOUR_UTC  (default 4)  - weekly prune.sh run time (Sundays)
set -eu

BACKUP_HOUR_UTC=${BACKUP_HOUR_UTC:-3}
PRUNE_HOUR_UTC=${PRUNE_HOUR_UTC:-4}

next_daily_epoch() {
  hour=$1
  now=$(date -u +%s)
  today=$(date -u -d "today ${hour}:00:00" +%s)
  if [ "$today" -gt "$now" ]; then
    echo "$today"
  else
    date -u -d "tomorrow ${hour}:00:00" +%s
  fi
}

# GNU date's "next Sunday" is always strictly after today, which is what a
# weekly cadence needs even when today happens to be Sunday.
next_sunday_epoch() {
  hour=$1
  date -u -d "next Sunday ${hour}:00:00" +%s
}

echo "schedule.sh: backup.sh daily at ${BACKUP_HOUR_UTC}:00 UTC, prune.sh weekly on Sundays at ${PRUNE_HOUR_UTC}:00 UTC"

while true; do
  backup_at=$(next_daily_epoch "$BACKUP_HOUR_UTC")
  prune_at=$(next_sunday_epoch "$PRUNE_HOUR_UTC")

  if [ "$backup_at" -le "$prune_at" ]; then
    now=$(date -u +%s)
    sleep $((backup_at - now))
    echo "schedule.sh: running backup.sh at $(date -u -Iseconds)"
    backup.sh || echo "schedule.sh: backup.sh exited $? - see logs above" >&2
  else
    now=$(date -u +%s)
    sleep $((prune_at - now))
    echo "schedule.sh: running prune.sh at $(date -u -Iseconds)"
    prune.sh || echo "schedule.sh: prune.sh exited $? - see logs above" >&2
  fi
done
