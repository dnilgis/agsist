# Head to head: agsist.com/manure-value, 2026-10-16

Checked Oct 16, 2026 from the checkout (same as origin/main for this page, components/manure-value.js and data/fertilizer-prices.json). I rendered manure-value.html at 390x844 and 1280x800 and opened every section. I also drove the calculator in three cases:
- Book dairy liquid.
- My own test, 30/10/20 lb per 1,000 gal.
- Hog indoor pit, with my own N price of $0.70.

There was no sideways scroll and no JS errors. The page loads about 440 KB, of which 46 KB is the HTML.

Competitors were scored only from the Oct 16 copies (references branch, bench-manure-value-1..6). The UMN calculator's .txt copy came out as an empty shell. Its saved .html is complete (an ASP.NET form), so I read it by rendering the saved file offline. I also rendered the saved Penn State file. I did not score any competitor's phone layout, so phone is "?" and their totals are out of 45. Ours without phone is 39/45. All six copies were readable.

Since Oct 15 the page fixed the main accuracy finding:
- The headline is now all the N, P2O5 and K2O, from A2809 Table 9.2 totals, with the first-year part beside it (Table 9.3).
- A "Use my manure test" box was added.
- Prices are now Kansas co-op posted prices with dates.
- "Selling to a neighbor" became "Rules when manure leaves the farm".

Second-year N is still only in brackets and is not priced.

## Numbers checked by hand
- **Against A2809, using the saved 2026 web copy (refs/uw-a2809-2026):**
  - Table 9.2 dairy slurry (4.1-11.0% DM) is 24 / 8 / 21 lb per 1,000 gal. Hog indoor pit is 43 / 18 / 28, chicken 49 / 44 / 33 lb/ton, and solid dairy over 20% DM is 9 / 4 / 7. These match the page.
  - Table 9.1 counts 80% of P and K and 30/40/50% of dairy N in the first year. Table 9.3 dairy slurry at 1 to 72 hours is 10 / 6 / 17. These match the page.
- **Prices per lb:**
  - N: urea $622.98 / 920 = $0.677.
  - P2O5: MAP ($980 - 220 x 0.677) / 1,040 = $0.799.
  - K2O: potash $470.40 / 1,200 = $0.392. All match.
- **Values:**
  - Dairy liquid: 24 x 0.677 + 8 x 0.799 + 21 x 0.392 = **$30.88** per 1,000 gal. That is $7.40 a ton at 8.34 lb/gal, $185.26 an acre at 6,000 gal, and $14,821 on 80 acres. All match.
  - First year at 10/6/17: $18.23, which is $109.38 an acre. Matches.
  - Hog indoor pit $54.48, chicken $81.28 and solid dairy $12.03 all match.
- **Calculator with my own test (30/10/20):** $36.15 per 1,000 gal and $216.87 an acre. First year 72/48/96 lb an acre = 30 x 40%, 10 x 80% and 20 x 80%, times 6. Matches.
- **Hog with N typed at $0.70:** 258 lb x $0.70 = $180.60. Matches. P2O5 stays at $0.799 because the MAP N credit still uses the urea price, which is defensible.

## Scores (1-5)

| Page | First screen | Current | Accurate/sourced | Local | Clear | Depth | Phone | Trust | Speed | Unique | Total | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **AGSIST /manure-value** | 5 | 4 | 4 | 4 | 4 | 5 | 5 | 5 | 4 | 4 | **44/50** (39/45 without phone) | rendered Oct 16 |
| Penn State Manure Nutrient Value Calculator (web) | 1 | 2 | 5 | 4 | 3 | 4 | ? | 5 | 5 | 4 | 33/45 | fetched Oct 16; rendered the saved file: all inputs start at 0, no viewport tag |
| UNL Water, "Calculating the Value of Nutrients in Manure" (Sep 25, 2025) | 3 | 3 | 5 | 2 | 4 | 4 | ? | 5 | 4 | 3 | 33/45 | fetched Oct 16 |
| UMN Extension "What's manure worth?" calculator | 2 | 1 | 4 | 4 | 2 | 5 | ? | 5 | 2 | 4 | 29/45 | fetched Oct 16; .txt empty, read from the saved .html |
| ISU Iowa Pork Industry Center, "Start with Nutrient Analysis" (Sep 8, 2026) | 2 | 4 | 4 | 2 | 4 | 2 | ? | 5 | 4 | 2 | 29/45 | fetched Oct 16 |
| UW Extension Manure Value Calculator spreadsheet (article) | 2 | 2 | 4 | 3 | 4 | 2 | ? | 5 | 3 | 2 | 27/45 | fetched Oct 16 |
| Univ. of Maryland ONVC (resources page, Excel download) | 1 | 2 | 4 | 3 | 2 | 3 | ? | 5 | 3 | 2 | 25/45 | fetched Oct 16 |

How I scored the competitors:
- **UMN, current = 1:** its default prices are N $0.30, P2O5 $0.35 and K2O $0.27 a lb. Today's co-op urea works out to $0.68. The default answer is "$84.05 /acre".
- **Penn State, phone:** the saved HTML has no viewport tag and was 429 px wide at a 390 px viewport.

## Where we win
- **A dated dollar answer on the first screen.** "$30.88 per 1,000 gallons ... What the crop can use the first year $18.23". Penn State opens at "Total Potential Value = $0.00/ac". UMN opens on prices of 30 to 35 cents. UNL's example uses "urea is $580" prices from 2025.
- **Totals and first year, both shown, both sourced to a table.** Penn State does split "potential economic value ... if all N-P-K nutrients were to be fully utilized" from the annual value, but only after you type everything in. We show both for 12 manure types and 3 incorporation timings, with the pounds behind them.
- **The farmer's own test and own prices, on a phone.** Typed test pounds replace the book values and are labeled "from your test". Prices can be typed over. UMN needs a Recalculate postback on each of 3 steps. Penn State has no viewport tag. Maryland and UW are Excel downloads.
- **Sound P pricing.** We take MAP's N out of the P price at the urea price, and say so ("Charging it all to P would make P₂O₅ $0.94 a lb"). Penn State does the same; UNL and UW price phosphate as DAP or MAP whole.

## Where they beat us, and how
- **Net of hauling (UMN, UNL).** UMN: "Cost of Applying at Your Planned Rate, per Unit $0.0125 ... Net Value of Manure Above Appl. Cost". UNL separates "gross value" from "net value". We give gross only. A cost box the farmer fills in, blank by default, would answer this without us inventing a hauling rate.
- **N in later years, in dollars (UMN, UNL).** UMN adds "Gross Nutrient Value, Year 2 $7.50". UNL credits "35 percent available over next 3 years". We print second-year N in brackets ([2] lb for dairy slurry) and say "UW counts a little more of the N over the next two years", but never price it. A2809 Table 9.1 gives 10% and 5% for years 2 and 3.
- **Sulfur and zinc (UNL).** UNL's example is "worth about $25.75 per ton, accounting for N, P, K, S and Zn". We count N, P2O5 and K2O only. That follows Sig's Oct 14 ruling ("N, P2O5, K2O at today's prices, period"), so this gap stays unless Sig changes the ruling.
- **Local prices.** Our prices are Kansas co-op prices, applied to Wisconsin book pounds. Both are labeled, but a Wisconsin or Iowa reader's urea may differ. The competitors use your own prices, which our page also allows, below the fold.
- **A fact we lean on less (ISU).** ISU explains sampling before and after agitation, and that "phosphorus tends to settle out". Our "Getting it tested" covers agitation in one line.

## Bugs found

| # | Finding | Severity |
|---|---|---|
| M1 | **The price date is stale on the main labels.** The H1 ("at Oct 6, 2026 fertilizer prices"), the hero, the FAQ answers and the JSON-LD say prices were "posted through Oct 6, 2026". The MAP price, which sets every P2O5 dollar, is "posted Oct 12, 2026" per the card beside it. The code uses the N price's date (`data-mv="asof-n"`) for the whole set. "Through Oct 6" is wrong in a way that undersells freshness. Per the fertilizer report, one of the four urea quotes is also from Sep 24, so "Oct 6 to 12" is not exact either. Use the oldest and newest dates. | Low-Medium |
| M2 | **"Where these prices come from" contradicts the Oct 16 decision.** It says prices come from co-ops "or, where the co-ops do not cover a product, the USDA AMS Illinois average". Sig's Oct 16 decision and data/fertilizer-prices.json both say co-ops only, with no USDA blending. The same old wording is in the header comment of components/manure-value.js (line 33). | Low |

## The 5 changes, ranked
1. **Fix the price-date wording (M1, M2).** Build the H1, hero, FAQ and JSON-LD date from all three products: "co-op prices posted Sep 24 to Oct 12, 2026" or "newest Oct 12". Delete the USDA fallback sentence. Why: accuracy beats every score, and the headline date is the first thing a skeptical reader checks. Effort S (baker plus one component). Honesty risk: this change removes one.
2. **An optional hauling cost box, blank by default, giving net value.** "Your cost to haul and spread: $__ per 1,000 gal (or per acre)" turns into "worth $X more than it costs to put on". Print no default number and no "typical" rate unless one is sourced and dated. Why: net value is the next question every farmer asks, and UMN and UNL both answer it. Effort S. Honesty risk: only if we supply a default cost.
3. **Price the later-year N as its own labeled line.** "Plus about $X of N the next two years (A2809 Table 9.1: 10% and 5% of total N)". For dairy slurry that is 24 x 15% = 3.6 lb, worth $2.44 per 1,000 gal at $0.677. Why: it closes UMN's and UNL's year-2 credit with UW's own shares. It stays within Sig's "value of all the nutrients" ruling, since the total is already priced and this only shows when it arrives. Effort S. Honesty risk low.
4. **A local price path above the fold.** Under the price cards, add one line: "Not in Kansas? Type your dealer's urea, MAP and potash", which opens the price boxes already in the calculator. When the fertilizer page gains co-ops in other states (fertilizer change 1), add a state picker. Why: Kansas prices on Wisconsin manure are the page's weakest link for most readers. Effort S now, M later. Honesty risk none. Never blend or fill in a state from another state's prices.
5. **Per-load value.** Add "Your tanker or spreader holds __ gal / tons: each load is worth $X". Why: farmers think in loads when they trade manure or pay a custom hauler. No competitor does it. Effort S. Honesty risk none (it is the reader's own number).

Not recommended: valuing sulfur and zinc as UNL does, or soil-test "crop need" valuation as Penn State, Maryland and UMN do. Both go against Sig's Oct 14 ruling.

## Verdict
**Best on the internet today? Yes.** Every number I worked by hand matches A2809 and the posted prices. It is the only page among the saved competitors that gives a current, dated dollar value for every common manure type, totals and first year, without typing anything, and that also takes your own test and prices on a phone. What remains is a wrong date on the headline (M1, small) and two depth gaps, net of hauling and later-year N, that UMN and UNL cover.

**Change since Oct 15: 41 → 44 (+3).**
- Accurate went from 3 to 4: the total versus first-year mismatch is fixed, and the date label (M1) holds it below 5.
- Current went from 3 to 4: co-op prices Oct 6-12, against 44-day-old quotes before.
- Local went from 3 to 4: own test and own prices.
