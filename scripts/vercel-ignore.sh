#!/usr/bin/env sh
# Vercel runs this before the build.
#
# Exit 0: skip the build.
# Exit 1: build.
#
# The only commit that may skip a deploy is one that changes nothing except the
# keep-alive log. A merge or an unknown commit always builds.

set -eu

sha="${VERCEL_GIT_COMMIT_SHA:-HEAD}"
changed="$(git diff-tree --no-commit-id --name-only -r "$sha" 2>/dev/null || true)"

if [ -z "$changed" ]; then
  exit 1
fi

if [ "$changed" = ".github/keepalive.log" ]; then
  echo "Only .github/keepalive.log changed; skipping the build."
  exit 0
fi

exit 1
