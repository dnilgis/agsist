#!/bin/bash
# The PR checks' skip rule (checks.sh node-test with AGSIST_NO_SKIPS=1): a skipped node test fails,
# unless test/skips-allowed.txt names it exactly. That list is only for one half of an either/or pair
# whose other half runs (e.g. "without the file" vs "with the file"). A skip is not a pass.
# Usage: check-skips.sh <node --test output>. Exit 1 on any other skip, or when the skips cannot be read.
NT="$1"; ALLOW="$(cd "$(dirname "$0")/../.." && pwd)/test/skips-allowed.txt"
n=$(sed -n 's/^# skipped \([0-9][0-9]*\)$/\1/p' "$NT" | tail -1)
[ "${n:-0}" -eq 0 ] && exit 0
skips=$(grep -E '^\s*ok [0-9]+ - .* # SKIP' "$NT" | sed -E 's/^\s*ok [0-9]+ - //')
got=$(printf '%s\n' "$skips" | grep -c .)
pat=$(mktemp); [ -f "$ALLOW" ] && grep -v '^#' "$ALLOW" | grep . > "$pat"
left=$(printf '%s\n' "$skips" | grep -vxF -f "$pat" | grep .)
rm -f "$pat"
if [ "$got" -ne "$n" ]; then echo "# skipped $n, but $got skip line(s) could be read; failing rather than guessing"; printf '%s\n' "$skips"; exit 1; fi
if [ -n "$left" ]; then
  echo "# skipped $n; a skipped test is not a pass (AGSIST_NO_SKIPS=1, as in pr-checks). Not in test/skips-allowed.txt:"
  printf '%s\n' "$left" | head -40
  exit 1
fi
echo "# skipped $n, each one half of an either/or pair in test/skips-allowed.txt"
exit 0
