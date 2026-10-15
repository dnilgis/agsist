#!/usr/bin/env bash
# After a fertilizer source file changes (data/fertilizer-coops.json or
# data/fertilizer-ams.json): rebuild the one price list every page reads,
# then rebake every page that carries a fertilizer number in its HTML.
# Run by .github/workflows/fertilizer-coops.yml and fertilizer-ams.yml inside
# their commit loop, so the list and the baked pages always match the two
# source files on the branch being pushed. No network.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 scripts/build_fert_prices.py
python3 scripts/bake_fert_defaults.py          # breakeven.html CROP_DEFAULTS fertilizer and its source line
node scripts/bake_manure_value.mjs              # manure-value.html, fast-facts.html manure table
python3 scripts/bake_seo.py --page fertilizer.html
python3 scripts/bake_seo.py --page breakeven.html
# Share cards: best effort, a card must never block the price commit.
python3 scripts/build_share_images.py --only manure-value,fertilizer || echo "::warning::share images not redrawn"
