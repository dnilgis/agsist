#!/bin/bash
# Unpack raw build inputs from the `raw` branch into this checkout.
#
#   bash scripts/pull_raw.sh <path> [<path> ...]
#
# The raw branch (never deployed; see scripts/push_raw.sh) holds the inputs
# no page reads, at the same paths they had on main. This puts the named paths
# back into the working tree, NOT the index: they are in .gitignore on main, so
# `git add -A` never commits them there.
#
# It fails, and says so, if the branch or any named path is missing. A builder
# that finds no raw file marks the layer "not yet measured" by design
# (build_farmland_atlas.py), so a build run on half its inputs would commit a
# dark map that looks like a working one. Better a red run than that.
#
# By hand, for a local build: bash scripts/pull_raw.sh data/atlas/raw
# Test knobs: RAW_REMOTE (default origin), RAW_BRANCH (default raw).
set -u
set -o pipefail
[ $# -gt 0 ] || { echo "::error::pull_raw.sh: no paths given"; exit 1; }
ROOT=$(git rev-parse --show-toplevel) || exit 1
cd "$ROOT" || exit 1
REMOTE="${RAW_REMOTE:-origin}"
BR="${RAW_BRANCH:-raw}"
ok=0
for i in 1 2 3; do
  if out=$(git fetch -q --depth 1 "$REMOTE" "$BR" 2>&1); then ok=1; break; fi
  echo "::warning::git fetch $BR failed: $(printf '%s' "$out" | tail -3 | tr '\n' ' ')"
  sleep $((10 * i))
done
[ "$ok" = 1 ] || { echo "::error::could not fetch the $BR branch from $REMOTE; the raw inputs are not here, so nothing is built"; exit 1; }
SHA=$(git rev-parse FETCH_HEAD) || exit 1
for p in "$@"; do
  git cat-file -e "$SHA:$p" 2>/dev/null || { echo "::error::$p is not on the $BR branch ($SHA); nothing is built without it"; exit 1; }
done
git archive "$SHA" -- "$@" | tar -x -C "$ROOT" || { echo "::error::could not unpack $* from $BR"; exit 1; }
echo "raw: unpacked $* from $BR $(git rev-parse --short "$SHA")"
