#!/bin/bash
# Fetch one private branch (raw, references, private-data) so the scripts that
# read it by name keep working:
#
#   bash scripts/fetch_private.sh raw            -> origin/raw and FETCH_HEAD
#   bash scripts/fetch_private.sh references     -> origin/references
#
# The branches moved to the private repo dnilgis/agsistretired on Oct 20, 2026.
# This puts the tip at refs/remotes/origin/<branch>, the name
# scripts/bid_snapshots.py, build_ids.py, accuracy_sets.py and
# build_custom_rates.py already read, and at FETCH_HEAD for the workflows that
# `git show FETCH_HEAD:...`. Where from: scripts/private_remote.sh (in Actions,
# PRIVATE_REPO_TOKEN; locally RAW_REMOTE=/path/to/agsistretired, else origin).
# DEPTH (default 1). Fails, saying so, when the branch cannot be fetched.
set -u
set -o pipefail
BR="${1:-}"
case "$BR" in raw|references|private-data) ;; *) echo "::error::fetch_private.sh: branch must be raw, references or private-data"; exit 1;; esac
ROOT=$(git rev-parse --show-toplevel) || exit 1
cd "$ROOT" || exit 1
. "$ROOT/scripts/private_remote.sh" || exit 1
for i in 1 2 3; do
  if out=$(git fetch -q --depth "${DEPTH:-1}" "$REMOTE" "+refs/heads/$BR:refs/remotes/origin/$BR" 2>&1); then
    echo "private: fetched $BR $(git rev-parse --short "refs/remotes/origin/$BR") from $WHERE"; exit 0
  fi
  echo "::warning::git fetch $BR failed: $(printf '%s' "$out" | tail -3 | tr '\n' ' ' | hide)"
  sleep $((${RAW_SLEEP:-10} * i))
done
echo "::error::could not fetch the $BR branch from $WHERE"; exit 1
