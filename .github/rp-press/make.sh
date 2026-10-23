#!/usr/bin/env bash
# make.sh <site dir (a checkout of main)> <dir with the downloaded rp-press-data/*.json> <out dir>
# For each recorded design: draw it with the page's own maker "Test print PDF (standard code)"
# from the saved answers only (press.mjs), cut the art box, write <slug>-1600.png, <slug>-1200x630.png
# and <slug>.json (what the page said: station, status, missed requests, the print's words).
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"; SITE="$1"; DATA="$2"; OUT="$3"; mkdir -p "$OUT"
for f in "$DATA"/*.json; do
  slug="$(basename "$f" .json)"
  q="$(python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))["pages"][0]["query"])' "$f")"
  echo "== $slug ($q)"
  node "$HERE/press.mjs" "$SITE" "$q" "$OUT/$slug-sheet.jpg" "$f" > "$OUT/$slug.json"
  python3 -I -c 'import json,sys; d=json.load(open(sys.argv[1])); print(" status:", d.get("status")); print(" missed:", len(d.get("missed",[])), "errors:", d.get("errors"))' "$OUT/$slug.json"
  [ -s "$OUT/$slug-sheet.jpg" ] && python3 -I "$HERE/crop.py" "$OUT/$slug-sheet.jpg" "$OUT/$slug-1600.png" "$OUT/$slug-1200x630.png"
done
