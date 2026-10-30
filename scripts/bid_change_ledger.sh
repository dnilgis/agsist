#!/bin/bash
# The bid change-time ledger in Actions (scripts/bid_change_ledger.py has the why).
#
#   NIGHTLY=1 bash scripts/bid_change_ledger.sh  nightly: carry on from the saved state (none: does nothing)
#   SNAPSHOTS=1 MAX_MINUTES=300 bash scripts/bid_change_ledger.sh
#                                                the backfill: walks from the first bids commit (or
#                                                where the saved state stopped) and rebuilds the
#                                                Aug 20 to Oct 16 daily snapshots on the way
#
# 1. The saved state from the private-data branch. Missing = first run, from the first
#    commit. A branch that cannot be read stops the run (a fresh state pushed over the
#    saved one would walk everything again and rewrite every day).
# 2. A blobless clone of dnilgis/bids: commits and trees only, no file contents. A nightly
#    run clones only the last few days (--shallow-since). The walk then fetches just the
#    board files' blobs it needs, a day at a time (never merged-all.json, never data/merged/).
# 3. The walk, whole Central days only (it stops at the last commit before midnight CT).
# 4. Saves: the ledger and state to private-data, the rebuilt snapshots to raw (where
#    scripts/bid_snapshots.py reads them). RAW_SOFT=1: a failed save is a warning.
# Never touches main or Pages.
_g="$(dirname "${BASH_SOURCE[0]}")/_argguard.sh"; [ -f "$_g" ] && { . "$_g"; argguard "${BASH_SOURCE[0]}" "$@"; }
set -u
set -o pipefail
ROOT=$(git rev-parse --show-toplevel) || exit 1
cd "$ROOT" || exit 1
LEDGER=private/ledger/bid-changes
STATE="$LEDGER/state.json.gz"
BIDS_URL="${BIDS_URL:-https://github.com/dnilgis/bids.git}"
CLONE="${BIDS_CLONE:-$(dirname "$ROOT")/bids-history}"
MAX_MINUTES="${MAX_MINUTES:-25}"

rc=0
out=$(RAW_BRANCH=private-data bash scripts/pull_raw.sh "$STATE" 2>&1) || rc=$?
echo "$out"
if [ "$rc" -ne 0 ]; then
  if printf '%s' "$out" | grep -q "is not on the"; then
    if [ "${NIGHTLY:-}" = 1 ]; then
      echo "::notice::no saved ledger state yet: dispatch bid-change-ledger.yml once for the backfill (the nightly run never starts it)"
      exit 0
    fi
    echo "first run: walking from the first bids commit"
  else
    echo "::error::could not read the private-data branch; not starting"; exit 1
  fi
fi

since_arg=()
if [ -f "$STATE" ]; then
  last=$(python3 -c 'import gzip,json,sys; s=json.loads(gzip.decompress(open(sys.argv[1],"rb").read())); print(s.get("lastCommitTs") or "")' "$STATE")
  if [ -n "$last" ]; then
    since_arg=(--shallow-since="$(date -u -d "@$((last - 2*86400))" +%Y-%m-%d)")
  fi
fi
rm -rf "$CLONE"
git clone -q --filter=blob:none --no-checkout --single-branch --branch main "${since_arg[@]}" "$BIDS_URL" "$CLONE" \
  || { echo "::error::could not clone dnilgis/bids"; exit 1; }
echo "bids clone: $(git -C "$CLONE" rev-list --count HEAD) commits, $(du -sh "$CLONE/.git" | cut -f1)"

args=(run --repo "$CLONE" --out . --state "$STATE" --until-ct-midnight --fetch-blobs --max-minutes "$MAX_MINUTES")
if [ "${SNAPSHOTS:-}" = 1 ]; then
  RAW_BRANCH=raw RAW_SOFT=1 bash scripts/pull_raw.sh bids-daily || true
  args+=(--snapshots --snap-dir .)
fi
[ -n "${GITHUB_STEP_SUMMARY:-}" ] && args+=(--summary "$GITHUB_STEP_SUMMARY")
python3 scripts/bid_change_ledger.py "${args[@]}"
walk=$?
# what the walk finished is saved even if it stopped on an error, so the next run carries on
if [ -d "$LEDGER" ]; then
  RAW_BRANCH=private-data RAW_SOFT=1 bash scripts/push_raw.sh "bid change ledger" "$LEDGER"
fi
if [ "${SNAPSHOTS:-}" = 1 ] && [ -d bids-daily ]; then
  RAW_BRANCH=raw RAW_SOFT=1 bash scripts/push_raw.sh "bid snapshots rebuilt from bids history" bids-daily
fi
rm -rf "$CLONE"
exit "$walk"
