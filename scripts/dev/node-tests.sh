#!/bin/bash
# The node test run behind checks.sh's node-test line: node-tests.sh <tap output> [N/M]
#   AGSIST_TEST_FILES="a b c":        only those files (the PR checks' pick, scripts/dev/test_map.py
#                                     --select-base), shard N/M balanced by test_map.py --split
#   AGSIST_PICK_BASE=<ref>:           (AGSIST_TEST_FILES empty) make that pick here first, the same command
#                                     the guard job runs: test_map.py --select-base <ref>; "every test" when
#                                     it says so (the PR checks' shards, so they need not wait for the guard)
#   neither, shard N/M:               every file node's own discovery runs (scripts/dev/list-tests.mjs),
#                                     shard N/M balanced by test_map.py --split (measured times)
#   neither, no shard:                every test (node --test, its own file discovery)
# Beside the TAP output, each test file's wall time goes to <tap output>.times (scripts/dev/file-times.mjs).
_g="$(dirname "${BASH_SOURCE[0]}")/../_argguard.sh"; [ -f "$_g" ] && { . "$_g"; argguard "${BASH_SOURCE[0]}" "$@"; }
NT="$1"; SHARD="${2:-}"
DEV="$(cd "$(dirname "$0")" && pwd)"
REP=(--test-reporter=tap --test-reporter-destination=stdout --test-reporter="$DEV/file-times.mjs" --test-reporter-destination="$NT.times")
if [ -z "${AGSIST_TEST_FILES:-}" ] && [ -n "${AGSIST_PICK_BASE:-}" ]; then
  GO=$(mktemp "${TMPDIR:-/tmp}/pick.XXXXXX")
  GITHUB_OUTPUT="$GO" python3 "$DEV/test_map.py" --select-base "$AGSIST_PICK_BASE" --github-output --why || { echo "node-tests: the pick against $AGSIST_PICK_BASE failed"; rm -f "$GO"; exit 2; }
  mode=$(sed -n 's/^mode=//p' "$GO"); picked=$(sed -n 's/^files=//p' "$GO"); rm -f "$GO"
  case "$mode" in
    some) AGSIST_TEST_FILES="$picked" ;;
    all) ;;
    *) echo "node-tests: the pick against $AGSIST_PICK_BASE gave no answer"; exit 2 ;;
  esac
fi
if [ -n "${AGSIST_TEST_FILES:-}" ]; then
  read -ra F <<< "$AGSIST_TEST_FILES"
  what="picked test file(s)"
elif [ -n "$SHARD" ]; then
  mapfile -t F < <(node "$DEV/list-tests.mjs")
  [ ${#F[@]} -gt 0 ] || { echo "node-tests: node's discovery found no test files"; exit 2; }
  what="test file(s) of every test"
else
  node --test "${REP[@]}" > "$NT" 2>&1
  exit $?
fi
if [ -n "$SHARD" ]; then
  mapfile -t F < <(python3 "$DEV/test_map.py" --split "$SHARD" "${F[@]}") || exit 2
fi
if [ ${#F[@]} -eq 0 ]; then
  printf 'TAP version 13\n1..0\n# tests 0\n# pass 0\n# fail 0\n# skipped 0\n' > "$NT"
  : > "$NT.times"
  echo "node-tests: no test files in this shard"
  exit 0
fi
echo "node-tests: ${#F[@]} $what${SHARD:+ in shard $SHARD}"
# the tests themselves never see the pick (a test that runs checks.sh's node-test line runs it whole)
env -u AGSIST_TEST_FILES -u AGSIST_PICK_BASE node --test "${REP[@]}" "${F[@]}" > "$NT" 2>&1
