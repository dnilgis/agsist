# Head to head: conditions.html + conditions-yield.html (one report), 2026-10-15

I rendered both locally at 390 x 844 and 1280 x 800 (shots in scratchpad/h2h/b4/). There was no sideways scroll and no JS errors. Both pages read local data: data/conditions/conditions.json (generated Oct 15 00:14Z, week ending Oct 11) and data/cond-yield/fit.json.
**What I could not see:** NASS, DTN, Farm Progress and farmdoc were all blocked to WebFetch (DNS failure), so competitor facts come from search-result text and are marked that way.

Farmer queries: "crop progress", "corn condition this week", "crop ratings by state", "harvest progress corn", "2026 corn yield estimate", "do crop ratings predict yield". Competitors:
- USDA NASS Crop Progress (the weekly report plus NASS's national charts)
- DTN's weekly "USDA Crop Progress" article (national numbers, 5-year averages, state notes)
- Farm Progress / Farm Futures weekly write-ups
- farmdoc daily's 2026 condition-based yield forecast (Ibendahl, K-State, Aug 12 and Aug 19, 2026, updated weekly since late May, 18 states, state R-squared printed). This is the direct rival to our nowcast.
- Pro Farmer and USDA WASDE, which are sources on our forecast board rather than rival pages

## Scores (1-5)

| | First screen | Current | Accurate+sourced | Local/personal | Clear | Depth | Phone | Trust | Speed | Unique | Total |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **AGSIST (both pages)** | 4 | 2 (Oct 4 and Oct 11 shown side by side; see C1) | 3 | 4 (state, no district) | 4 | 5 | 4 | 5 | 4 | 5 | **40** |
| USDA NASS Crop Progress (snippets) | 2 | 5 | 5 | 3 (state) | 2 | 5 | 2 (PDF/text) | 5 | 3 | 3 | 35 |
| DTN weekly article (snippets) | 4 | 5 | 5 | 3 | 4 | 3 | 4 | 4 | 2 | 2 | 36 |
| Farm Progress weekly (snippets) | 3 | 5 | 4 | 2 | 4 | 2 | 3 | 4 | 2 | 2 | 31 |
| farmdoc daily condition model (snippets) | 3 | 4 | 5 | 3 | 3 | 5 | 3 | 5 | 4 | 4 | 39 |

## Where we win
- **Ranks every state against its own history for the same week.** "IA corn 71%: better than 15 of the last 23 years at this week, average 66, worst 43, best 82" answers "is this the worst ever?" in one line. NASS gives the number and last year/5-yr average; DTN does the same. Nobody ranks a state against its own record. The hex map plus the worst-first table is unique and reads well on a phone.
- **Every forecast on one board with dates and links, plus our own model on the record.** The board shows USDA 181.2, Pro Farmer 173.2, DTN 178.5 and ours 180.6 (80% band ±6.9). We lock direction calls before each WASDE and grade them in public, misses included ("3 of 6 correct; 2 on a defective input, graded as called"). farmdoc publishes a condition model but does not keep a graded call record on the page.
- **Honest method notes.** It ranks rather than predicts, omits states with under 10 years of data, never carries last week's number forward, and uses a pseudo real-time backtest for the band with n printed.

## Where competitors beat us, and how
- **Harvest progress.** DTN and NASS lead in October with harvest % by state vs the 5-year average. Our menu calls this page "Crop ratings and harvest progress", but the page has no harvest table. The only harvest number is one sentence, and it is stale.
- **Being current on report day.** DTN publishes within minutes of the Monday 3 PM CT release. Our page still headlines the week ending Oct 4 two days after the Oct 13 release (C1).
- **The trend line.** farmdoc's model is trend plus condition by state with R-squared shown. Ours shows "trend 188.7, 8.1 below trend". USDA's own 2026 trend at the Feb Outlook Forum was 183 (snippets: Pro Farmer, AgWeb). See C3.
- **Completeness of the board.** It claims "every published forecast" but shows four. farmdoc's weekly condition-based number, farmer surveys (Farm Futures) and private firms are missing.

## Numbers checked by hand

| Item | Page | Check | OK |
|---|---|---|---|
| IA rank 16 of 24 = "better than 15 of the last 23" | | 16-1 = 15; 24-1 = 23 | yes |
| Board: ours 3rd of 4 corn, 7.4 over lowest; beans highest, 1.4 over; 8.0 apart | | 180.6-173.2 = 7.4; 53.5-52.1 = 1.4; 181.2-173.2 = 8.0 | yes |
| Call record 3 of 6 | | Oct C, C; Sep C, I; Aug I, I | yes |
| Corn trend 188.7 (straight line 2010-2025 finals) | | My OLS on NASS finals (2025 = 186.5) gives 188.7, slope 2.5 bu/yr | yes, but see C3 |
| Soy trend 53.9 | | 53.86 | yes |

| # | Finding | Severity |
|---|---|---|
| C1 | **Stale and contradictory week.** conditions.json and crop-progress.json are both on the week ending Oct 11 (corn 56% G+E, harvest 33% vs 39% avg; beans 57%, 46% vs 50%). The page still prints these from the baked seed: the `<title>` "Corn 54% Good-Excellent", the hero sentence and the stats line "week ending Oct 4... 54%... harvest 23% vs 27%... 32 corn states", and the table caption "Corn, week ending Oct 4". The JS-rendered table header meanwhile says "week ending 2026-10-11". A reader sees two weeks on one screen, and search engines see only the old one. The seeds are not re-baked when the data refreshes. | **High** |
| C2 | **"Since 2000" has no 2000.** Every state's history starts at 2001 for both crops, and corn has no 2012 at this week. 2025 is absent too (shutdown, which is fine and explained elsewhere). 2012 is the drought benchmark everyone means by "worst ever". Its absence at this week is likely real (an early harvest ended the ratings), but the card's "Worst ever: 43%" for Iowa without a note invites "what about 2012?". Fix: check the 2000 fetch range, and print "2012: no rating this week (harvest ended early)" when a year is missing. | Medium |
| C3 | **Trend framing.** "8.1 below trend" uses a straight line through 2010-2025 that starts right after 2012's 123 bu, which tilts the slope up to 2.5 bu/yr. Dropping 2012 gives 186.0. USDA's 2026 Outlook trend was 183. Against USDA's trend the crop is about 2 below, not 8. Fix: print USDA's trend beside ours, or use a 1988-2025 or weather-adjusted trend, and say which. | Medium |
| C4 | The nowcast is still on ratings week Oct 4 while the ratings file has Oct 11 ("updates Tuesdays", and this was the Columbus Day week). That's the same catch-up gap as C1. | Medium (fixed by the catch-up cron going forward) |
| C5 | The card says "a better **mid-season** rating" in October. Make it "a better rating for this week". | Low |
| C6 | "Every published forecast" with four entries. Add farmdoc's condition model and any other dated public numbers, or retitle it "the main published forecasts". | Low-medium |
| C7 | "Nobody is scored until USDA prints the January final" appears twice above the fold on conditions-yield (already flagged by the page audit). | Low |

## The 5 changes, ranked
1. **Re-bake the seeds from the same JSON on every data run (S).** Title, hero, stats line and table caption should all come from conditions.json and crop-progress.json, with a test that fails if the seed week differs from the data week. That fixes C1 and keeps the page truthful on report day, which is the one day farmers come.
2. **Add harvest progress by state (M).** A sortable table: corn and soy harvest % this week, last week, last year, 5-year average and the gap, with the national line on the first screen ("Corn 33% harvested vs 39% avg, week ending Oct 11"). Load it from crop-progress data on demand. This is what DTN wins on in October, and our menu already promises it.
3. **Show the week and the national number on the first screen (S).** Above the state card: "Week ending Oct 11 (released Tue Oct 13): US corn 56% G+E, rank X of 25 since 2001." Right now "this week" has no date until the table.
4. **Honest trend and missing years (S).** Put USDA's 2026 trend (183) next to ours with one line on why they differ. Mark missing years on each state card (2012, 2025) and fix the 2000 start or change the copy to "since 2001".
5. **Fill out the forecast board (S-M).** Add farmdoc daily's weekly condition-based estimate and any other public dated numbers (Farm Futures survey, StoneX if public), each linked and dated, so "every forecast" is true. Keep ours graded.

**Best on the internet today? Close.** No one else ranks each state's rating against its own history or keeps a graded record of their own model. But two days after the Crop Progress release the page still headlines last week in its title and summary, beside a table for the new week, and it has no harvest-by-state table, which is the October question.
