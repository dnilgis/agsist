---
name: prf-page-regen
description: Use whenever anything feeding prf.html changes (scripts/make_prf_html.py, components/prf*.js, data/prf/*). Regenerates the page in the only correct order and verifies it.
---
# Regenerate and verify the PRF page

prf.html is generated. Never hand-edit it, and never run these scripts with --help (that once rewrote the page).

1. If components/prf-optimize.js or prf-optimize-ui.js (or other prf JS) changed, bump their `?v=` inside scripts/make_prf_html.py.
2. `python3 scripts/make_prf_html.py .` (the repo path argument is required)
3. `python3 scripts/inject_static_nav.py`
4. `python3 scripts/stamp_prf.py`, then `python3 scripts/stamp_prf.py --check` must print "prf.html matches data/prf/meta.json".
5. `PRF_CHROMIUM=/opt/pw-browsers/chromium PRF_SHOTS=<scratch dir> node build/prf-wip/wire-check.mjs` must print "all wire checks pass". Look at the opt-*.png screenshot.
6. `python3 scripts/build_feeds.py && python3 scripts/test_feeds.py`, because new script tags change the manifest.

Rules: the page stays neutral except the labeled "What the numbers would pick" panel. Every derived number is walk-forward with no look-ahead (nothing a buyer could not know on Dec 1). Predictors count in a declared Holm family; kept means adjusted p < 0.05 and positive at 90% and 70%. The sponsor price is on request, never printed.
