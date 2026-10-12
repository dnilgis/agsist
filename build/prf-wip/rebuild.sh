#!/bin/bash
set -e
cd /home/claude/agsist
python3 scripts/make_prf_html.py . >/dev/null
python3 scripts/inject_static_nav.py >/dev/null
python3 scripts/stamp_prf.py >/dev/null
python3 scripts/stamp_prf.py --check
node --check components/prf.js && node --check components/prf-math.js
