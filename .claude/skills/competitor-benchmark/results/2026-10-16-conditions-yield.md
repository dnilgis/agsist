# Head to head: agsist.com/conditions-yield ("2026 crop size: every forecast"), 2026-10-16

I rendered conditions-yield.html locally at 390 x 844 and 1280 x 800, with the service worker and outside hosts blocked. There was no sideways scroll and no page errors (the only console error is the blocked analytics tag). The phone page is 5,325 px tall.
- **Data on the page:** data/yield-nowcast.json, generated Oct 13 10:36Z from ratings for the week ending **Oct 4**. data/conditions/conditions.json already carries the week ending Oct 11 (released Tue Oct 13 after the holiday).

**Competitor copies** come from origin/references, fetched Oct 16:
- **bench-conditions-yield-1:** NASS October Crop Production board briefing (Oct 9, 39-page PDF).
- **bench-conditions-yield-3:** Southeast AgNet audio summary of StoneX (Sep 10).
- **bench-conditions-yield-5:** K-State wheat yield outlook (Mar 30, PDF).
- **farmdoc / Ibendahl model:** same URL as bench-conditions-5 (Aug 12 article), read from that copy.
- **Not readable:** Pro Farmer / AgWeb (-4) returned HTTP 403 with no archive copy. It is marked "?".

## What changed since Oct 15
- **Nothing on this page.** None of the five Oct 15 changes shipped: StoneX row, trade average row, state rows, holiday rerun, "who was closest" promise.
- **The holiday problem got worse.** cond-yield.yml now has a Wednesday 03:18 UTC catch-up run for holiday weeks. But the nowcast file is still the Oct 13 10:36Z build on the Oct 4 week. Three days after the Oct 11 ratings came out, the hero still says "ratings week ending 2026-10-04 · updates Tuesdays".

## Numbers checked by hand
- **Corn order:** 173.2 / 178.5 / 180.6 / 181.2. Ours is 3 of 4, 180.6 - 173.2 = **7.4** over the lowest, and the spread is 181.2 - 173.2 = **8.0**. Match.
- **Soybean order:** 52.1 / 53.1 / 53.3 / 53.5. Ours is the highest, 53.5 - 52.1 = **1.4**. Match.
- **USDA's 181.2 corn and 53.1 soybeans:** match the NASS Oct 9 briefing copy (US corn 181.2, 16,033,944 thousand bu; soybeans 53.1).
- **Bands:** 180.6 ± 6.9 = 173.7-187.5, and 53.5 ± 2.4 = 51.1-55.9. Match.
- **Gaps:** 188.7 - 180.6 = **8.1**, and 183.0 - 180.6 = **2.4**. Match.
- **Skill:** 1 - 4.2/5.5 = 23.6%, shown as **24%**. 1 - 1.3/2.4 = 45.8%, shown as **46%**. Match.
- **Record:**
  - The graded, non-superseded calls are Oct beans right (52.8 → 53.1 up), Oct corn right (178.5 → 181.2 up), Sep beans right (52.7 → 52.8), Sep corn wrong (180.7 → 178.5), Aug beans wrong and Aug corn wrong.
  - That is **3 of 6**. Match.
- **No calculation errors.**

## Scores (1-5)

| | First screen | Current | Accurate+sourced | Local | Clear | Depth | Phone | Trust | Speed | Unique | Total | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **AGSIST /conditions-yield** | 5 | 3 | 5 | 2 | 4 | 5 | 4 | 5 | 4 | 5 | **42** | rendered Oct 16; numbers hand-checked |
| NASS Oct Crop Production briefing | 3 | 5 | 5 | 4 | 3 | 4 | 2 | 5 | 3 | 3 | 37 | fetched Oct 16 (Oct 9 PDF) |
| farmdoc daily / Ibendahl condition model | 3 | 2 | 5 | 4 | 3 | 5 | 3 | 5 | 4 | 4 | 38 | fetched Oct 16 (article of Aug 12) |
| K-State wheat yield from ratings | 4 | 1 | 5 | 4 | 4 | 5 | 2 | 5 | 4 | 3 | 37 | fetched Oct 16 (Mar 30 PDF; Kansas wheat, a method peer, not a 2026 corn forecast) |
| StoneX via Southeast AgNet | 3 | 2 | 3 | 1 | 4 | 1 | 3 | 3 | 2 | 2 | 24 | fetched Oct 16 (Sep 10 item) |
| Pro Farmer / AgWeb national forecast | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | n/a | not readable (HTTP 403, no archive) |

**Why the scores moved:**
- **Ours:** Current drops 4 → 3 because the nowcast is a full release behind and the Wednesday catch-up did not refresh it.
- **Competitors:** they rose against Oct 15 because they were read this time instead of scored from snippets. The NASS briefing is one example: it has top-5 state yields and objective-yield detail.

## Where we win
- **It is still the only page that puts every source side by side.** USDA, the tour, DTN and a backtested ratings model sit low to high, dated and linked. Nobody is scored until January.
- **Our own record is printed, misses included.** It shows 3 of 6, "defective input" calls graded as called, and superseded locks kept. No competitor copy grades itself.
- **Two trends are shown and explained.** One is our straight line at 188.7, the other is USDA's weather-adjusted 183.0.

## Where they beat us (from the saved copies)
- **NASS gives an honest range on its own number.** It says: "Based on 20 years of actual results, there is a 90% chance that the final production will be between 15.5 billion bushels and 16.6 billion bushels." Our USDA row has no range, so a farmer can't see how far USDA's October number usually moves.
- **NASS state yields on the first page:** Iowa 219, Illinois 208, Nebraska 188, Minnesota 195 and Indiana 200, each with the change from last year. We have no state number on the top screen.
- **Ibendahl (farmdoc daily) works state by state:**
  - a model for each of 18 states, with R-squared and upper and lower bounds for each one
  - the probability of finishing below trend for each state (North Dakota 93%, South Dakota 80%) and for the nation (65%)
  - the gap state by state against USDA's August number
  - USDA's own monthly accuracy history: an August miss SD of 5.3 bu, 4.5 in September and 3.0 in October, with about 77% of August's miss still there in September
  - We have none of the probability or persistence framing.
- **Missing forecasts.** The StoneX copy has a dated private forecast: "StoneX places the corn yield nationally 182.9 ... Their soybean estimates more in line at 53 bushels per acre" (Sep 10). Ibendahl published 183.0 (range 179.1-186.8, Aug 9) and 182.8 on USDA acres. Neither is on a page titled "every forecast".
- **The DTN row may be stale.** The DTN crops page copy says "The DTN Digital Yield Tour continues with updated national yield estimates for corn and soybeans based on Oct. 1 conditions." Our DTN row is still dated Aug 10 (178.5 / 52.1). The copy does not carry the new figures, so I can't confirm them.

## Bugs

| # | Finding | Severity |
|---|---|---|
| CY1 | **The nowcast is a release behind.** The hero says "ratings week ending 2026-10-04 · updates Tuesdays" on Oct 16. The Oct 11 ratings came out Tue Oct 13 and are already in data/conditions/conditions.json. The Wednesday holiday catch-up in cond-yield.yml did not produce a new data/yield-nowcast.json (still generated 2026-10-13T10:36:18Z). The same stale figure shows on /crop-tour ("week ending Oct 4"). Check whether the Oct 14 03:18 UTC run ran, failed or found nothing. | Medium |
| CY2 | **"Every published forecast" is not true.** StoneX 182.9 / 53 (Sep 10) and Ibendahl's 183.0 (Aug 9) are dated public forecasts that are not on the board. DTN's row may be superseded by its Oct 1-conditions update. | Low-medium |
| CY3 | The footer says "Everything here was published by somebody else", but the AGSIST row is in the same list. | Low |

## Five changes, ranked
1. **Make the nowcast follow the ratings week (S).**
   - What: find out why the Wednesday catch-up did not refresh it, and rerun now. When the nowcast week lags conditions.json, print "last run on the week ending X; this week's ratings are not in yet" instead of "updates Tuesdays".
   - Why: the page's own number is the thing a visitor came for, and it is 12 days old.
   - Honesty risk: none; it removes one.
2. **Complete the board (S).**
   - What: add StoneX (182.9 / 53, Sep 10) and the Ibendahl condition model (183.0, Aug 9; dated, linked to farmdoc daily). Check DTN's Oct 1-conditions update and replace the Aug 10 row if it is newer. Keep the hand-kept file.
   - Why: the title promises every forecast.
   - Honesty risk: the StoneX figure is from a radio summary. Confirm it at a StoneX or wire primary before printing, or label the source as the summary.
3. **Add a "how far USDA's October number moves by January" range to the USDA row (S-M).**
   - What: compute it ourselves from NASS October and January corn and soybean yields, with the years used printed. NASS's own 90% production range can be shown beside it, quoted and dated.
   - Why: it answers "is 181.2 settled?", which is the question in October.
   - Honesty risk: low if the years, n and method are printed; withhold it if n is under 15.
4. **A "your state" block (M).**
   - What: USDA's latest state yield, our state fit, and the tour sample where one exists. Load one per-state file on demand when the reader picks a state (CLAUDE.md budget).
   - Why: Local is our lowest score (2), and NASS and Ibendahl both work state by state.
   - Honesty risk: low; withhold states with under 15 paired years, as the fit file already does.
5. **Promise and then post "who was closest" in January (M).**
   - What: one dated line now ("graded when USDA prints the January final, about Jan 12, 2027"). Then a table with the same rules as /crop-tour's record.
   - Why: it closes the loop the page opens.
   - Honesty risk: grade every source on its last public figure before the final, not its best one.

## Verdict
**Yes, on substance, but slipping.**
- Nothing read today combines dated forecasts from every camp, a backtested model and a graded self-record, and every number I checked is right.
- But the page's own number is a release behind, and two public forecasts are missing from a page titled "every forecast".
- Change in our total since Oct 15: **43 → 42 (-1)**. That is the Current score, from the stale nowcast.
