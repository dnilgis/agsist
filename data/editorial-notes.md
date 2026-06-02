# AGSIST Editorial Notes

This file is a cumulative log of editorial corrections, preferences, and red lines from past briefings. The generator loads the most recent 15 bullets and injects them into the system prompt every run, so the rules grow organically with editorial judgment without bloating the static prompt.

Format: date heading (`## YYYY-MM-DD`), then short bullets under it. Keep each bullet to one sentence. Newest sections go at the top.

The loader (`scripts/generate_daily.py:load_editorial_notes()`) reads this file every generation. No service restart required.

## 2026-05-30

- v4.6.1 deterministic scrubber now runs AFTER critic rewrite as belt-and-suspenders. Every banned drama verb (crashed, crater, exploded, surged, plunged, soared, spiked, jumped, etc.) is regex-substituted with case preservation. This catches what the critic's single-target rewrite misses (headlines, section titles, takeaways, TMYK titles). Scrubber audit log appears in workflow output.
- The model should STILL aim for working-ag voice without drama verbs in the first place. The scrubber is a safety net, not permission to use banned vocabulary; substitutions can read slightly mechanical ("hogs fell sharply 6%" vs more natural "hogs had their biggest day in N weeks"). Aim for the natural form.

## 2026-05-29

- Cattle on Feed is MONTHLY (third or fourth Friday), NEVER weekly. After a release, the next one is approximately 4 weeks out. Do NOT list "Weekly Cattle on Feed" anywhere; do NOT schedule Cattle on Feed on any Friday or Tuesday between monthly releases.
- USDA Crop Progress is published MONDAYS at 3 PM CT only (or Tuesdays at 3 PM CT when Monday is a federal holiday). It is NEVER published on Friday, Wednesday, or Tuesday morning.
- Spread/ratio math sanity: when describing a spread, the percentage and the dollar figure must match the math. "$110 spread" means $110 absolute. "46% premium" means a ratio. "4.6% spread" between two contracts trading $111 apart is a decimal-place error.

## 2026-05-28

- The HEADLINE and LEAD are where drama verbs slip most. "Spike", "spiked", "jumped", "surges" are banned in the headline, subhead, and lead specifically. A 2% move "leads", "runs higher", or "tops the complex"; it does not "spike".
- Planting percentage is monotonic within a season: it only increases week-over-week. If last week's brief said corn was 76% planted, this week cannot be 42%. Cross-check planting figures against the prior briefing's number before publishing.

## 2026-05-26

- Drama verbs ban is ABSOLUTE on session-magnitude basis: crude moving 4.7% does not license "crashed", "crater", "rout", "collapse", "plunged". Use "tumbled", "fell sharply", "had its biggest drop in [N] weeks", or describe the size and rarity directly. The bigger the move, the stricter the discipline.
- Section titles: NEVER use "ENERGY CRATER", "CATTLE CRASH", "FEEDERS SURGE", or any drama-verb construction. Use "ENERGY LEADS LOWER", "CATTLE FALL", "FEEDERS RUN HIGHER" instead.
- The Number unit text counts as voice. "Crude oil collapse" / "crude oil crash" / "cattle surge" all violate. Use "single-day decline", "weekly gain", "session move" instead.

## 2026-05-24

- "Binary test" / "binary week" is banned, use "make-or-break", "line in the sand", "either/or".
- When citing a numeric spread in The Number block, the unit and magnitude MUST be mathematically verifiable from locked_prices. Use unambiguous units: "$110 dollar spread", "14-cent corn carry", "1.46 feeder/live ratio". Never invent point or ratio counts.

## 2026-05-22

- Drama verbs ban applies equally to CATTLE COMPLEX moves. "Cattle crash", "livestock collapse", "feeders surge", "cattle explode" all violate.
- Magnitude coherence: stated cents/dollar move MUST match math implied by close vs prior close. Wheat at $6.70 up 1.32% is ~9 cents, not 87 cents.

## 2026-05-20

- Direction coherence: percent change direction must match the ticker arrow on the page. Natural gas at $2.91 up 7.24% is UP, not "crashed". Never say a commodity "crashed" or "fell" when the ticker shows it advancing.
- USDA Weekly Export Sales releases Thursday 7:30 AM CT only. Never Friday. Never Wednesday.

## 2026-05-18

- CNBC drama verbs (exploded, crater, surge, soar, plunge, slash, ignite, bloodbath, exodus, rout) are never appropriate. Use working-ag vocabulary at every magnitude.
