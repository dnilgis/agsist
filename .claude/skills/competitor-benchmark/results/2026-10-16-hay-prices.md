# Head to head: agsist.com/hay-prices

Checked Oct 16, 2026, from the checkout at main 084d358c4. I rendered hay-prices.html at 390x844 and 1280x800 and looked at both. No sideways scroll, no JS errors (only the blocked Google Tag Manager call), about 390 KB loaded, 41 KB of HTML. test/hay-prices.test.mjs passes. This is the first scoring of this page; there is no Oct 15 report.

Competitors were scored only from the copies GitHub Actions saved on Oct 16 (references branch, bench-hay-prices-1, 3, 4, 5, 7). I did not render them, so phone is "?" and their totals are out of 45.
- **Not scored:** Farms.com (bench-hay-prices-6) failed to fetch. The NASS Agricultural Prices listing on Cornell (competitor 2) was never fetched; it has no entry in the index.
- **Mislabeled in competitors.json:** AMS_3183.pdf is the **South Dakota Direct Hay Report** (Oct 16, 2026), not a national summary. The "Southeast AgNet" PDF is a repost of AMS's Alabama report 3050 (Sep 2, 2026).

## Numbers checked by hand (no errors)
- **Year-over-year changes,** from data/hay/hay-prices.json (August 2026, NASS released Sep 29, 2026):
  - US alfalfa: $206 vs $171 = +$35 (+20.5%, shown +20%).
  - Colorado: $235 vs $155 = +$80 (+51.6%, shown +52%).
  - Minnesota: $145 vs $97 = +$48 (+49.5%, shown +49%).
  - All match.
- **Per bale at 1,200 lb:** US $206 x 0.6 = $123.60, shown $124. New Mexico $285 x 0.6 = $171. Both match.
- **Cross-check against a competitor.** The saved Hay & Forage Grower column gives April alfalfa at $181, $17 under a year earlier, with the prior year peaking in May at $204. The column has no year in the saved text. Our series has Apr 2025 at $180, Apr 2024 at $195 and May 2024 at $202. That is within the few dollars NASS revises, so it fits the column being April 2025. It neither confirms nor contradicts our file. NASS itself could not be opened from here.
- **SD gap, not an error but worth knowing.** NASS has South Dakota alfalfa in August at $101 a ton. AMS's SD Direct Hay Report for the week ending Oct 16 shows alfalfa trades at $180-300 a ton, with drought-driven demand. The page's FAQ explains why the NASS average sits under sale prices, but a seller who stops at the table would underprice his hay.

## Scores (1-5)

| Page | First screen | Current | Accurate/sourced | Local | Clear | Depth | Phone | Trust | Speed | Unique | Total | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **AGSIST /hay-prices** | 5 | 4 | 4 | 3 | 5 | 4 | 4 | 5 | 4 | 3 | **41/50** | rendered Oct 16 |
| USDA AMS SD Direct Hay Report (AMS_3183, Oct 16, 2026) | 3 | 5 | 5 | 4 | 3 | 3 | ? | 5 | 4 | 4 | 36/45 | fetched Oct 16 |
| USDA AMS Alabama Direct Hay Report (AMS_3050, Oct 1, 2026) | 3 | 4 | 5 | 4 | 2 | 3 | ? | 5 | 4 | 4 | 34/45 | fetched Oct 16 |
| Southeast AgNet repost of AMS 3050 (Sep 2, 2026) | 3 | 3 | 5 | 4 | 2 | 3 | ? | 4 | 3 | 1 | 28/45 | fetched Oct 16 |
| Hay & Forage Grower monthly alfalfa column (April, year not in text) | 4 | 1 | 4 | 2 | 4 | 2 | ? | 4 | 3 | 3 | 27/45 | fetched Oct 16 |
| Utah State alfalfa hay pricing fact sheet (data 2013-2022) | 1 | 1 | 4 | 2 | 3 | 4 | ? | 5 | 2 | 4 | 26/45 | fetched Oct 16 (PDF) |
| Farms.com USDA weekly hay market report | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | n/a | fetch failed |
| USDA NASS Agricultural Prices (Cornell listing) | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | n/a | not fetched |

## Where we win
- **Every NASS state on one screen,** with the US number, a year-ago comparison and three years of history per state. The answer ($206 a ton, August 2026, released Sep 29) is on the first phone screen. NASS's own report is a PDF. Hay & Forage Grower names only the top and bottom few states.
- **Price per bale for your bale weight,** for every state.
- **Withheld vs too few reports vs blank** is spelled out, never shown as zero, and the coming revision is flagged.

## Where they beat us
- **This week's trades by quality and bale type (AMS direct reports).** SD (Oct 16) lists Supreme alfalfa in 3x4 large squares at $300, Premium large rounds at $210, Good/Premium at $200, Fair at $180 and Premium grass at $200. Each row has tons, F.O.B. terms and a one-paragraph read on demand. Alabama (Oct 1) splits Bermuda and Bahia by grade and bale size, with tons this week vs last report vs last year. Our number is a month-old average of all qualities, which in SD sits half under this week's trades.
- **Dairy-quality alfalfa (Hay & Forage Grower).** It reports NASS's Premium/Supreme alfalfa price for the five big milk states, the one DMC uses ($209 that month). We do not carry it.
- **Forecasts (Utah State).** USU describes a tool forecasting alfalfa prices up to 9 months out for seven western states. I would not copy this without a tested record (honest-numbers rule).

## Five changes, ranked
1. **Add the latest AMS direct hay report rows for the reader's state (M-L).**
   - What: show quality x bale type, weighted average, range, tons and report date beside the NASS monthly number, loaded on demand from one data file per state.
   - Why: this is what a farmer pricing a load needs, and it closes the SD-type gap.
   - Honesty risk: medium. Each state's report has its own date and cadence, so show each date and never blend AMS into NASS.
2. **Add NASS's Premium/Supreme alfalfa series, the DMC 5-state average (S).**
   - Why: dairy hay buyers and sellers search for it, and it comes from the same NASS report the page already reads.
   - Honesty risk: low.
3. **Put the reader's state first (S).**
   - What: a ZIP or state picker that moves your state and its neighbors to the top, with its three-year line opened.
   - Why: "hay prices near me" is a top query. Today a reader scrolls a 27-row table.
   - Honesty risk: none.
4. **Show the next NASS release date and what changed in the last revision (S).**
   - What: for example "Next: Oct 30" and "July revised from $X to $Y".
   - Why: makes "current" checkable.
   - Honesty risk: none, if the date comes from the NASS calendar.
5. **Add straw and cornstalk bale prices from AMS reports where states publish them (M).**
   - What: link them both ways with /nutrient-removal, so a stalk seller sees sale price next to nutrient cost.
   - Honesty risk: medium. Few states report them, so missing stays missing.

## Verdict
**Close.** It is the clearest, best-dated view of NASS hay prices I found, and the math is exact. But a farmer pricing hay this week gets a month-old all-quality average. AMS's weekly direct reports give trades by quality and bale for the states they cover, and in South Dakota this week they run $80-200 a ton over our number.

**Change since Oct 15:** none to compare. This is the first report on this page (41/50).
