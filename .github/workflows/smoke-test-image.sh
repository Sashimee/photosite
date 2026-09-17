#!/usr/bin/env bash
# Boots a just-built api/worker runtime image with no network and no env.
# Every static ESM import is resolved before any application code runs, so
# a workspace package missing from the Dockerfile's runtime stage still
# throws ERR_MODULE_NOT_FOUND here - the app never gets far enough to hit
# its (expected) env-validation failure. Added after a crash loop caused by
# infra/docker/worker.Dockerfile's runtime stage not copying @photoo/i18n.
set -euo pipefail

image="$1"

set +e
output=$(timeout 20 docker run --rm --network none "$image" 2>&1)
status=$?
set -e

echo "$output"

if echo "$output" | grep -q 'ERR_MODULE_NOT_FOUND'; then
  echo "::error::$image failed to resolve a module at boot" >&2
  exit 1
fi

if [ "$status" -eq 124 ]; then
  echo "::error::$image did not exit within the smoke-test timeout (expected a fast env-validation failure)" >&2
  exit 1
fi
