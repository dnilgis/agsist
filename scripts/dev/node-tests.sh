#!/bin/bash
# The node test run behind checks.sh's node-test line: node-tests.sh <tap output> [N/M]
#   AGSIST_TEST_FILES unset or empty: every test (node --test, its own file discovery), shard N/M
#                                     by node's own --test-shard
#   AGSIST_TEST_FILES="a b c":        only those files (the PR checks' pick, scripts/dev/test_map.py
#                                     --select-base), shard N/M balanced by test_map.py --split
NT="$1"; SHARD="${2:-}"
if [ -n "${AGSIST_TEST_FILES:-}" ]; then
  read -ra F <<< "$AGSIST_TEST_FILES"
  if [ -n "$SHARD" ]; then
    mapfile -t F < <(python3 "$(dirname "$0")/test_map.py" --split "$SHARD" "${F[@]}") || exit 2
  fi
  if [ ${#F[@]} -eq 0 ]; then
    printf 'TAP version 13\n1..0\n# tests 0\n# pass 0\n# fail 0\n# skipped 0\n' > "$NT"
    echo "node-tests: no test files in this shard of the pick"
    exit 0
  fi
  echo "node-tests: ${#F[@]} picked test file(s)${SHARD:+ in shard $SHARD}"
  # the tests themselves never see the pick (a test that runs checks.sh's node-test line runs it whole)
  env -u AGSIST_TEST_FILES node --test "${F[@]}" > "$NT" 2>&1
else
  node --test ${SHARD:+--test-shard=$SHARD} > "$NT" 2>&1
fi
