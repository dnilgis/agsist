# Head to head: agsist.com/fertilizer

Checked Oct 16, 2026. I rendered fertilizer.html from the checkout at 390x844 and 1280x800. No sideways page scroll and no JS errors (one blocked outside call). The page was rebuilt on Oct 16:
- Every price now comes from 4 named Kansas co-ops (data/fertilizer-prices.json, built from data/fertilizer-coops.json, read Oct 15), as the standing decisions require.
- It prices 10 products, including anhydrous, UAN28/32, DAP, 10-34-0 and Thio-Sul.
- The title reads "Kansas Co-op Fertilizer per Ton: Urea $623, Anhydrous $832".

Competitors were scored only from the copies GitHub Actions fetched on Oct 16 (references branch, ids bench-fertilizer-1..5). I did not render them, so phone is "?" and their totals are out of 45. Every fetched competitor URL is a dated item: DTN's Apr 22, 2026 column, a 2023 Farm Policy News post, and two USDA AMS text reports discontinued in Feb 2022. Their "current" scores rate those copies, not the live services. DTN publishes weekly at a new URL each time, so the competitor list needs DTN's current column URL to score its live product.

## Numbers checked by hand (no errors)
- **Middle prices:**
  - Urea: co-ops at $608, $615.95, $630 and $840. The middle of 4 is ($615.95 + $630) / 2 = $622.98. Matches.
  - Anhydrous: ($830 + $834.20) / 2 = $832.10. UAN28: ($403.16 + $427.50) / 2 = $415.33.
  - DAP: ($921.50 + $936.05) / 2 = $928.78. Potash: ($465.50 + $475.30) / 2 = $470.40. All match.
- **Per pound:**
  - Anhydrous $832.10 / 1,640 lb N = $0.507. Urea $622.98 / 920 = $0.677. UAN28 $415.33 / 560 = $0.742.
  - DAP $928.77 / 920 lb P2O5 = $1.01. AMS $509.25 / 480 lb S = $1.06. Thio-Sul $420 / 520 lb S = $0.81. All match.
- **N:corn ratio:** $0.507 / $4.74 = 0.107, and $832 / $4.74 = 175 bu per ton. Matches. It is labeled as Dec futures before basis.
- **Fertility bill, corn at 180 bu, defaults:**
  - Needs: N 162 lb, P2O5 0.38 x 180 = 68.4 lb, K2O 0.29 x 180 = 52.2 lb.
  - P from 10-34-0 ($0.941/lb P2O5, vs MAP at $0.942): 68.4 / 0.34 = 201 lb x $0.32 = $64.38.
  - K: 52.2 / 0.60 = 87 lb x $0.2352 = $20.46.
  - N: (162 - 20.1 lb N credited from 10-34-0) / 0.82 = 173 lb NH3 x $0.416 = $71.99.
  - Total $156.83, which is $0.87/bu. Matches.

## Labeling issues (low)
- **"Posted Oct 6" overstates freshness.** The cheapest-nitrogen card and cost table say "Kansas co-ops, middle of 4, posted Oct 6, 2026", but one of the four prices is from Sep 24. The price cards say it right ("newest posted Oct 6, oldest Sep 24"); the src_label in fertilizer-prices.json does not.
- **An undated price is counted.** Two Rivers' DAP at $820 has no date and still counts in the DAP middle. Without it, DAP would be $936.05, not $929. The card discloses "1 with no date shown", but the 60-day rule cannot be applied to an undated row.
- **The Henry Hub figure ($3.099/MMBtu) shows no date.**
- **One co-op picks the "cheapest phosphate".** 10-34-0 comes from a single co-op, and it beats MAP by $0.001/lb. The bill builds all P from 201 lb of liquid starter, which few farmers would do.

## Scores (1-5)

| Page | First screen | Current | Accurate/sourced | Local | Clear | Depth | Phone | Trust | Speed | Unique | Total | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **AGSIST /fertilizer** | 4 | 4 | 4 | 2 | 4 | 5 | 3 | 5 | 4 | 4 | **39/50** | rendered Oct 16 |
| DTN Retail Fertilizer Trends (Apr 22, 2026 column) | 4 | 1 | 4 | 1 | 4 | 4 | ? | 4 | 3 | 3 | 28/45 | fetched Oct 16 |
| FarmWeek DTN repost (Apr 2026) | 4 | 1 | 4 | 1 | 4 | 2 | ? | 4 | 3 | 2 | 25/45 | fetched Oct 16 |
| Farm Policy News (Oct 2023 post) | 2 | 1 | 4 | 1 | 3 | 2 | ? | 4 | 4 | 1 | 22/45 | fetched Oct 16 |
| USDA AMS Illinois Production Cost (gx_gr210.txt) | 3 | 1 | 5 | 3 | 3 | 1 | ? | 5 | 5 | 2 | 28/45 | fetched Oct 16; report dated Feb 24, 2022, marked discontinued |
| USDA AMS Iowa Production Cost (nw_gr210.txt) | 3 | 1 | 5 | 3 | 3 | 1 | ? | 5 | 5 | 2 | 28/45 | fetched Oct 16; dated Feb 8, 2022, moved to MARS report 2863 |

Notes on the copies:
- **DTN:**
  - It gives national averages for 8 products: "Urea ... $858/ton", "Anhydrous ... $1,114/ton".
  - It gives $/lb N for 4 products: "urea $0.93/lb.N, anhydrous $0.68/lb.N".
  - It gives month and year changes, and a 13-month table of all 8 products (Apr 2025 to Apr 2026).
  - Method: "DTN gathers fertilizer price bids from agriculture retailers each week", with no count of retailers. State averages are paywalled ("MyDTN subscribers can access ... state averages").
- **AMS Illinois:** a statewide range and average per product (anhydrous $1,460-1,550, average $1,503.50). The report says "This text report will be discontinued on February 24, 2022. The new pdf report can be viewed at ams_3195.pdf".

## Where we win
- **Named, linked sources.** Every price names its co-ops, region and posting dates, and the range is shown. DTN gives a national average from an unstated number of retailers.
- **A per-acre fertility bill** from today's posted prices: the cheapest source per nutrient, co-nutrient credits, and $/acre and $/bu. No competitor copy turns prices into a bill.
- **Freshness.** Prices are read each weekday, and the newest sheet is 4 days old. Every fetched competitor copy is 6 months to 4 years old.
- **Breadth.** 10 products, including 10-34-0, Thio-Sul and AMS sulfur cost per lb.

## Where they beat us, and how
- **Coverage (DTN, AMS).** DTN's average is national; AMS is statewide for Illinois and Iowa. Ours is 4 co-ops in Kansas. For a farmer in Iowa or Wisconsin, a Kansas price is a proxy at best. The page says so plainly, but the answer is still not local.
- **Trend (DTN).** DTN's 13-month table shows every product month by month, plus month-ago and year-ago percent changes. We show no history, though data/fertilizer-coops-history.json now logs every change.
- **Diesel and propane (AMS).** AMS listed farm diesel and LP per gallon alongside fertilizer. We do not.

## Bugs found
- **No math errors.**
- **Low:** source labels say "posted Oct 6" for medians that include a Sep 24 sheet.
- **Low:** the undated Two Rivers DAP row counts in the middle price.
- **Low:** no date on the Henry Hub price.
- **Low (phone):** the cost-per-pound table is cramped at 390 px. Each row wraps to 4-5 lines, and most cells read "n/a".

## Five changes, ranked
1. **More states, each standing alone.**
   - What: add co-op sources outside Kansas as Sig sends links (WI, IA, MN, IL first; reminder set Oct 19). Add a "my state" picker that shows only that state's co-ops, and say "no posted prices for <state> yet" rather than falling back to Kansas.
   - Why: local is our lowest score, and the Corn Belt is where most readers farm.
   - Effort: M. Honesty risk: low, if states are never blended and each price keeps its co-op names.
2. **Show the trend from our own history.**
   - What: draw a small per-product line of the middle price from data/fertilizer-coops-history.json, loaded on demand. Mark where the set of co-ops changed.
   - Why: DTN's month and year view is the one thing a farmer timing a purchase uses, and our log already exists.
   - Effort: S. Honesty risk: medium. A median moves when a co-op joins, so mark set changes and do not claim a "month ago" until a month of reads exists.
3. **Exact freshness on every label.**
   - What: when the oldest and newest posting differ, src_label says "posted Sep 24 to Oct 6". Leave undated rows out of the middle price (list them, do not count them). Date the Henry Hub figure.
   - Why: accuracy beats every score, and the shared price file feeds other pages.
   - Effort: S. Honesty risk: none.
4. **Let the farmer set the bill.**
   - What: in the calculator, let the reader pick the P and N source (MAP vs 10-34-0, anhydrous vs urea vs UAN). Add an optional application cost the reader types in, with no default number from us.
   - Why: the auto-pick builds all P from 201 lb of 10-34-0 on a $0.001 edge from one co-op, and anhydrous is cheapest only before application.
   - Effort: S. Honesty risk: low.
5. **Phone layout for cost per pound.**
   - What: at phone width, show each product as one line with only the nutrients it carries (for example "DAP: N $2.58, P2O5 $1.01"), dropping the n/a cells.
   - Why: the table is the second-most useful block and is hard to read on a phone.
   - Effort: S. Honesty risk: none.

## Verdict
**Close.** For a Kansas farmer it is the best free fertilizer page I found: current named co-op prices, every figure checks, and a per-acre bill no competitor offers. For everyone else it is a Kansas proxy, and it has no trend line yet.

## Change since Oct 15
32 to 39 (+7). The gains come from the switch to named co-op prices read each weekday:
- current: 2 to 4
- accurate/sourced: 2 to 4
- trust: 3 to 5
- breadth (anhydrous, UAN, DAP now priced): depth 4 to 5, unique 3 to 4

Phone dropped from 4 to 3 because the wider table is cramped. Note on the Oct 15 plan: its change 1 (blend in USDA AMS Illinois) is now off the table under Sig's Oct 16 decision (co-op prices only). The AMS text reports in the competitor list were discontinued in 2022 in any case.
