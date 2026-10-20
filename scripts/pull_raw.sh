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
# (since Oct 20 the branches are in the private repo dnilgis/agsistretired; from
# a session that has it cloned: RAW_REMOTE=/path/to/agsistretired bash scripts/pull_raw.sh data/fsa)
#
# Where from: scripts/private_remote.sh (RAW_REMOTE wins; in Actions,
# PRIVATE_REPO_TOKEN picks the private repo; else origin). RAW_BRANCH (default
# raw). RAW_SOFT=1 is only for inputs a job can run without (the Daily's
# editorial notes, the last job health file): a miss is then a ::warning:: and
# exit 0. Build inputs (the Atlas pulls, the FSA files) never set it.
set -u
set -o pipefail
[ $# -gt 0 ] || { echo "::error::pull_raw.sh: no paths given"; exit 1; }
ROOT=$(git rev-parse --show-toplevel) || exit 1
cd "$ROOT" || exit 1
. "$ROOT/scripts/private_remote.sh" || { echo "::error::pull_raw.sh: scripts/private_remote.sh is missing"; exit 1; }
BR="${RAW_BRANCH:-raw}"
fail() {
  if [ "${RAW_SOFT:-}" = 1 ]; then echo "::warning::$* (going on without it)"; exit 0; fi
  echo "::error::$*"; exit 1
}
ok=0
for i in 1 2 3; do
  if out=$(git fetch -q --depth 1 "$REMOTE" "$BR" 2>&1); then ok=1; break; fi
  echo "::warning::git fetch $BR failed: $(printf '%s' "$out" | tail -3 | tr '\n' ' ' | hide)"
  sleep $((${RAW_SLEEP:-10} * i))
done
[ "$ok" = 1 ] || fail "could not fetch the $BR branch from $WHERE (missing, or the key cannot read it); the raw inputs are not here, so nothing is built"
SHA=$(git rev-parse FETCH_HEAD) || exit 1
for p in "$@"; do
  git cat-file -e "$SHA:$p" 2>/dev/null || fail "$p is not on the $BR branch ($SHA); nothing is built without it"
done
git archive "$SHA" -- "$@" | tar -x -C "$ROOT" || fail "could not unpack $* from $BR"
echo "raw: unpacked $* from $BR $(git rev-parse --short "$SHA") on $WHERE"
