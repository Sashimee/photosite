#!/usr/bin/env bash
# Polls one or more origins' x-photoo-revision response header (set by
# apps/api/src/bootstrap/configure-app.ts and apps/web/src/proxy.ts) until
# every one of them reports the expected commit, or the timeout elapses.
# A bare curl -f against /health succeeds against Dokploy's old container
# the instant the webhook is accepted - see docs/issue #257 - so this checks
# the actual revision serving instead of any response at all.
set -euo pipefail

expected="$1"
timeout_seconds="$2"
shift 2
urls=("$@")

if [ -z "$expected" ] || [ "$timeout_seconds" -le 0 ] || [ "${#urls[@]}" -eq 0 ]; then
  echo "usage: wait-for-revision.sh <expected-sha> <timeout-seconds> <url> [url...]" >&2
  exit 2
fi

revision_of() {
  curl -sS --max-time 10 -D - -o /dev/null "$1" 2>/dev/null \
    | tr -d '\r' \
    | grep -i '^x-photoo-revision:' \
    | tail -1 \
    | cut -d ':' -f2- \
    | tr -d ' '
}

declare -A ok
deadline=$((SECONDS + timeout_seconds))
while [ "$SECONDS" -lt "$deadline" ]; do
  all_ok=true
  for url in "${urls[@]}"; do
    if [ "${ok[$url]:-}" != "1" ]; then
      got=$(revision_of "$url") || got=""
      if [ "$got" = "$expected" ]; then
        ok[$url]=1
        echo "$url is serving $expected"
      else
        all_ok=false
      fi
    fi
  done
  if [ "$all_ok" = true ]; then
    exit 0
  fi
  sleep 5
done

echo "::error::timed out after ${timeout_seconds}s waiting for revision $expected" >&2
for url in "${urls[@]}"; do
  if [ "${ok[$url]:-}" != "1" ]; then
    echo "::error::$url never reported revision $expected (last seen: $(revision_of "$url" || echo '<no response>'))" >&2
  fi
done
exit 1
