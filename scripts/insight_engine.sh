#!/bin/bash
# The weekly re-test engine in Actions (scripts/insight_engine.py has the why).
#
#   bash scripts/insight_engine.sh
#
# Rides the morning report job (morning-report.yml, job insight-retest): no schedule of its own.
# The job opens every morning; this does the work only when a run is due (Sunday in Central
# time, or a catch-up when the last run is 9 days old), so most mornings it stops at step 2.
#
# 1. The ledger so far (private/ledger/tests) from the private-data branch. Missing = first
#    run. A branch that cannot be read stops the run: without the earlier rows the engine
#    cannot tell a changed spec, a verdict change or a sign that held.
# 2. Due? (insight_engine.py due). Not due: exit 0.
# 3. The inputs: history from the raw branch, the change-time ledger from private-data. Each
#    is pulled on its own and a missing one is only a warning: its specs come out WAIT.
# 4. The run: one result row per spec, appended as a new day file; latest.json for the report.
# 5. Saves private/ledger/tests to private-data (RAW_SOFT=1: a failed save is a warning).
# Never touches main or Pages; nothing it writes is published.
_g="$(dirname "${BASH_SOURCE[0]}")/_argguard.sh"; [ -f "$_g" ] && { . "$_g"; argguard "${BASH_SOURCE[0]}" "$@"; }
set -u
set -o pipefail
ROOT=$(git rev-parse --show-toplevel) || exit 1
cd "$ROOT" || exit 1
LEDGER=private/ledger/tests

rc=0
out=$(RAW_BRANCH=private-data bash scripts/pull_raw.sh "$LEDGER" 2>&1) || rc=$?
echo "$out"
if [ "$rc" -ne 0 ]; then
  if printf '%s' "$out" | grep -q "is not on the"; then
    echo "first run: no test ledger yet"
  else
    echo "::error::could not read the private-data branch; not starting"; exit 1
  fi
fi

due=0
python3 scripts/insight_engine.py due --ledger "$LEDGER" || due=$?
if [ "$due" -eq 3 ]; then exit 0; fi
[ "$due" -eq 0 ] || { echo "::error::insight_engine.py due failed"; exit 1; }

for p in history/agtransport/barge_rates history/agtransport/grain_basis history/agtransport/inspections \
         history/nass-progress/condition history/nass-progress/progress history/nass-yield; do
  RAW_BRANCH=raw RAW_SOFT=1 bash scripts/pull_raw.sh "$p" || true
done
RAW_BRANCH=private-data RAW_SOFT=1 bash scripts/pull_raw.sh private/ledger/bid-changes || true

# The daily basis log before 2026-10-11 is not in the public folder (build_basis_history.py PUBLIC_FROM).
# The re-test reads those days from a private copy on private-data, with the elevator records of that
# time (data/ids/elevators.json) so each day still joins to its elevator; the first run without one
# makes it from the last main commit that still held them and saves it there.
BASIS_LOG=private/ledger/basis-log
BASIS_LOG_PIN=f2e960400e5b0ee07451885e5b1535da659bc7c0
RAW_BRANCH=private-data RAW_SOFT=1 bash scripts/pull_raw.sh "$BASIS_LOG" || true
if [ ! -d "$BASIS_LOG" ]; then
  if git cat-file -e "$BASIS_LOG_PIN^{commit}" 2>/dev/null || git fetch -q --no-tags --depth 1 origin "$BASIS_LOG_PIN"; then
    mkdir -p "$BASIS_LOG"
    for f in $(git ls-tree --name-only "$BASIS_LOG_PIN" data/basis/ | grep -E '/changes-[0-9]{4}-[0-9]{2}-[0-9]{2}\.json$'); do
      day=$(basename "$f" .json); day=${day#changes-}
      [[ "$day" < "2026-10-11" ]] && git show "$BASIS_LOG_PIN:$f" > "$BASIS_LOG/changes-$day.json"
    done
    git show "$BASIS_LOG_PIN:data/ids/elevators.json" > "$BASIS_LOG/elevators.json" || rm -f "$BASIS_LOG/elevators.json"
    n=$(ls "$BASIS_LOG" | grep -c '^changes-')
    echo "basis log before Oct 11, 2026: $n day file(s) from $BASIS_LOG_PIN"
    [ "$n" -gt 0 ] && RAW_BRANCH=private-data RAW_SOFT=1 bash scripts/push_raw.sh "basis log before Oct 11, 2026" "$BASIS_LOG"
  else
    echo "::warning::basis log before Oct 11, 2026 not readable; the basis log specs read the public days only"
  fi
fi

args=(run --ledger "$LEDGER" --root . --raw .)
[ -n "${GITHUB_STEP_SUMMARY:-}" ] && args+=(--summary "$GITHUB_STEP_SUMMARY")
python3 scripts/insight_engine.py "${args[@]}"
run=$?
if [ "$run" -eq 0 ] && [ -d "$LEDGER" ]; then
  RAW_BRANCH=private-data RAW_SOFT=1 bash scripts/push_raw.sh "re-test engine results" "$LEDGER"
fi
exit "$run"
