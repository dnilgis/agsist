# Head to head: agsist.com/usda-quick-stats

Checked Oct 15, 2026, from the read-only checkout. I rendered usda-quick-stats.html at 390x844 and 1280x800. No sideways scroll on the page, though the data table scrolls sideways inside its box. No JS errors (the analytics host is blocked here). About 400 KB loaded.

**What I could not see:** I could not open NASS or any competitor host (DNS refusal). Competitor cells and outside figures are from search-result text and are marked *.

## Numbers checked by hand
- **2025 national (Jan 2026 annual):**
  - Corn: 17.0 B bu at 186.5 bu/ac. Soybeans: 4.26 B bu at 53.0 bu/ac, up 2.3. Both match farmdoc and the USDA summary as reported.*
  - Corn change: 17.0 / 14.87 (2024) = +14%. Matches.
  - Soybean change: 4.26 / 4.37 = -2.4%, shown as -2%. Matches.
  - Wheat: 1.98 vs 1.97 is "under 1%". Matches.
  - Yield changes: +7.2 corn (179.3), +2.1 wheat (51.2). Match.
- **2025 state soybean finals** (data/nass/soy-yield.json): IL 62.5, IA 63.5, MN 52.5, IN 59.5, NE 65.5. These are exactly the figures in the NASS Jan 12, 2026 executive briefing as quoted.* Iowa corn 210 matches.*
- **2026 October forecast:**
  - Iowa 219 bu/ac matches DTN/Farm Progress coverage of the Oct 9 report.*
  - Production checks: 2,803 / 219 = 12.80 M ac harvested, and the file says 12.8. Illinois 2,278 / 208 = 10.95, file 10.9. Nebraska 1,807 / 188 = 9.61, file 9.6. Consistent.
- **Marketing-year averages:**
  - Corn $4.16 and soybeans $10.50 for 2025/26, labeled final. The 2024/25 values ($4.24 and $10.00) match FSA's final table.*
  - FSA's August preliminary table had 2025/26 at $4.15 corn and $10.40 soybeans.* The final could move after the last month, and NASS rounds soybeans to the dime. **Check item, not an error:** confirm $10.50 against the Sep 30 Agricultural Prices release.
- **No math errors found.**

## Scores (1-5)

| Page | First screen | Current | Accurate/sourced | Local | Clear | Depth | Phone | Trust | Speed | Unique | Total |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **AGSIST /usda-quick-stats** | 5 | 5 | 5 | 3 | 4 | 5 | 3 | 4 | 3 | 3 | **40** |
| USDA NASS Quick Stats (quickstats.nass.usda.gov)* | 1 | 5 | 5 | 5 | 1 | 5 | 1 | 5 | 2 | 4 | 34 |
| farmdoc FAST crop yield database (IL, IN, IA, MN)* | 2 | 3 | 5 | 4 | 3 | 4 | 2 | 5 | 3 | 3 | 34 |
| USDA NASS Charts and Maps (national yield PDFs)* | 3 | 4 | 5 | 2 | 4 | 2 | 3 | 5 | 4 | 2 | 34 |
| DTN / Farm Progress USDA report summaries* | 4 | 5 | 4 | 2 | 4 | 2 | 4 | 4 | 3 | 2 | 34 |

\* from search snippets only; not opened.

## Where we win
- **The answer is above the fold.** The October state yields for the top five states are in one sentence, followed by 2025 finals with changes and a top-states ranking.
- **Every state's yields since 2010 in one table, with CSV download.** NASS Quick Stats has the data but takes several form steps. farmdoc's tool covers four states.*
- **It is honest about mixed years.** "33 of 42 states are the October forecast (est.); the rest are finals." Calendar-year prices are kept apart from marketing-year prices.

## Where a competitor beats us, and how
- **County level (NASS Quick Stats, farmdoc FAST).** This page stops at the state. AGSIST has county yields in the Atlas and the yield pages, but this page does not link a county view from the table.
- **Any commodity (NASS).** We cover corn, soybeans and wheat, and send everything else to the query builder. That is fine, but the builder's state list is missing states (no Delaware, Maryland, New York and others).
- **Phone.** The 16-column table is hard to read at 390 px. A small chart per state, or one state at a time, would read better.

## Five changes, ranked by impact
1. **"Your state" view on phone (M).** Pick a state and get its corn, soybean and wheat yields since 2010 as a short chart plus the last 5 years. Keep the full table behind a button. Load it from the existing JSON.
2. **Link each state row to its county yields (S).** Use the Atlas or the yield-by-county page the site already has.
3. **Confirm the soybean MYA (S).** Check $10.50 against the Sep 30, 2026 NASS release, and show the release date next to "final".
4. **Complete the query builder's state list (S).** It should have all 50 states.
5. **Visible byline and "data pulled <date> from NASS" under the H1 (S).**

## Verdict
Best on the internet today? **Yes, for quick state numbers.** For "what did my state yield, and what is USDA saying now", it is faster and plainer than NASS's own tool, and every number I could check matched. It is close overall, because it has no county view on the page and the main table is weak on a phone.
