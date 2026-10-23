#!/usr/bin/env bash
# Records every NOAA RCC-ACIS and Open-Meteo answer rain-print.html asks for while it
# draws each design in designs.txt (one JSON per design in $OUT). Read-only on the repo:
# nothing is committed; the workflow uploads $OUT as a run artifact.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${OUT:-$RUNNER_TEMP/rp-press}"
mkdir -p "$OUT"
fails=0
while IFS='|' read -r slug query; do
  case "$slug" in ''|\#*) continue ;; esac
  echo "== $slug"
  if ! timeout 900 node "$HERE/record.mjs" "$OUT/$slug.json" "$query"; then
    echo "::warning title=rp press::$slug did not draw cleanly (see the notices; its file keeps what came back)"
    fails=$((fails + 1))
  fi
done < "$HERE/designs.txt"
ls -la "$OUT"
echo "designs with a problem: $fails"
exit 0
