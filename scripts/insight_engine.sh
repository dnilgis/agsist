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
         history/nass-progress/condition history/nass-progress/progress; do
  RAW_BRANCH=raw RAW_SOFT=1 bash scripts/pull_raw.sh "$p" || true
done
RAW_BRANCH=private-data RAW_SOFT=1 bash scripts/pull_raw.sh private/ledger/bid-changes || true

args=(run --ledger "$LEDGER" --root . --raw .)
[ -n "${GITHUB_STEP_SUMMARY:-}" ] && args+=(--summary "$GITHUB_STEP_SUMMARY")
python3 scripts/insight_engine.py "${args[@]}"
run=$?
if [ "$run" -eq 0 ] && [ -d "$LEDGER" ]; then
  RAW_BRANCH=private-data RAW_SOFT=1 bash scripts/push_raw.sh "re-test engine results" "$LEDGER"
fi
exit "$run"
