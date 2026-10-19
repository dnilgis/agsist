#!/usr/bin/env bash
# After data/fertilizer-coops.json changes: rebuild the one price list every
# page reads (co-op prices only), then rebake every page that carries a
# fertilizer number in its HTML. Run by .github/workflows/fertilizer-coops.yml
# inside its commit loop, so the list and the baked pages always match the
# co-op file on the branch being pushed. No network.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 scripts/build_fert_prices.py
python3 scripts/build_coop_places.py            # co-op town points for the nearest-co-op lines (components/near-coop.js)
python3 scripts/bake_fert_defaults.py          # breakeven.html CROP_DEFAULTS fertilizer and its source line
node scripts/bake_manure_value.mjs              # manure-value.html, fast-facts.html manure table
python3 scripts/bake_seo.py --page fertilizer.html
node scripts/bake_fert_page.mjs                 # fertilizer.html co-op cards and lede line, drawn by components/fert-coops.js (layout shift, Oct 19)
python3 scripts/bake_seo.py --page breakeven.html
# Share cards: best effort, a card must never block the price commit.
python3 scripts/build_share_images.py --only manure-value,fertilizer || echo "::warning::share images not redrawn"
