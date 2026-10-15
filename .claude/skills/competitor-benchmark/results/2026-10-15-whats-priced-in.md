# Head to head: whats-priced-in.html, 2026-10-15

Checkout: wt/h2h at 3d3fe0b678. I rendered the page at 390 x 844 and 1280 x 800, then opened every collapsed section (shots and text are in scratchpad/h2h/mk/). The page does not scroll sideways, and both data files (whats-priced-in.json updated Oct 14, analyst-scorecard.json) loaded.
**What I could not see:** I could not open any outside page (DNS/proxy). Competitor facts come from search snippets, marked (s). Prediction-market odds were empty in the data, so I saw only the "withheld" text.

Queries searched: "WASDE trade estimates vs actual", "October 2026 WASDE trade estimates corn ending stocks", "November WASDE analysts expect", "analyst accuracy scorecard USDA yield". The results show DTN's "USDA Reports Preview" (Oct 7) and "USDA Reports Review/Summary" (Oct 9), Pro Farmer previews, Farm Progress / Farm Futures survey stories, farmdoc daily's pre- and post-report yield look, Purdue PAER on USDA accuracy, CME's options-vol notes and Successful Farming / Reuters poll pickups. **Nobody else I found grades public forecasters against the print.**

## Scores (1-5)

| | First screen | Current | Accurate+sourced | Local | Clear | Depth | Phone | Trust | Speed | Unique | Total |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **AGSIST** | 2 | 4 | 5 | 2 | 3 | 5 | 4 | 5 | 4 | 5 | **39** |
| DTN Reports Preview + Review (s) | 5 (in report week) | 5 | 5 | 1 | 4 | 4 | 3 | 4 | 3 | 3 | 37 |
| farmdoc daily (s) | 3 | 4 | 5 | 1 | 3 | 5 | 3 | 5 | 4 | 4 | 37 |
| Farm Progress / Farm Futures survey (s) | 4 | 5 | 4 | 1 | 4 | 3 | 3 | 3 | 2 | 3 | 32 |
| Pro Farmer previews (s) | 4 | 5 | 4 | 1 | 4 | 3 | 3 | 3 (subscription upsell) | 3 | 2 | 32 |
| Successful Farming / Reuters poll pickups (s) | 4 | 5 | 4 | 1 | 4 | 2 | 3 | 3 | 2 | 2 | 30 |
| CME options / implied vol (s) | 2 | 4 | 5 | 1 | 2 | 4 | 2 | 4 | 3 | 3 | 30 |

## Where we win
- **A graded record of who called what.** It covers 15 public forecasters (StoneX, Allendale, Pro Farmer, Gulke, McClure, Hultman, Braun, Irwin and others). Each record gives avg error, beat-trade and bias. Yield and stocks are never pooled, and no places are printed until records are long enough. Our own nowcast is marked OURS and scored by the same rules. No competitor does this.
- **Every metric graded the same way, with the range as context.** For example: "Corn stocks Sept 1: 2.095 vs 1.918 expected, +9.2%, outside the trade range." The source and the date it was typed in are attached to each figure, and gaps are named ("July WASDE went unscored").
- **The numbers check out against DTN.** I checked against DTN's snippets: Oct trade 1.677 bb corn stocks vs 1.849 actual; USDA yield 181.2 (DTN cites Dow Jones 177.7 and we cite Reuters 177.8, so different surveys). Gap math (1.849 − 1.677) / 1.677 = 10.3% and (181.2 − 177.8) / 177.8 = 1.9%: OK. The board footnote counts (1 of 6, 2 of 7) and each forecaster's avg error (e.g. Pro Farmer 173.2 vs 178.5 = 2.97%): OK.

## Where competitors beat us, and how
- **The first screen, for most of the month.** Today, 26 days before the next report, the phone's first screen holds the title, a date callout and four links. The card below says what is missing (no range, no odds, no thresholds, no positioning). The lede promises "how the last one landed", but the October WASDE result sits in a collapsed "Track record". DTN's Review leads with exactly that: "USDA raises corn yield 2.7 bpa to 181.2; ending stocks 1.849 bb vs ~1.67 expected; Dec corn about 20¢ lower".
- **How the market took it.** Every graded line except one reads "No note written on how the market took it", although the section promises "which way price moved". DTN reports the move. Our own harvest-prices.json already shows Dec corn 5.0025 → 4.7975 (−20½¢) on Oct 9.
- **Pre-report week.** DTN and Pro Farmer publish the survey table with averages and ranges 2-3 days out. We type it in 1-2 days ahead. Until then we do not show USDA's standing number, the one the trade is guessing against.
- **Options view.** CME notes show implied vol into the report, which is what "priced in" means to a trader. We have nothing on vol.

| # | Finding | Severity |
|---|---|---|
| W1 | The "No positioning" box says "No Commitments of Traders file … could be read". data/cot.json is present (Oct 6 report) and feeds the corn page. The real cause: calendar-built cards have `commodity: null`, so `cot_positioning()` in scripts/build_whats_priced_in.py matches no commodity. The page states a false reason. | Low-Medium |
| W2 | The lede and the Track record header promise "which way price moved", but 13 of 14 recent lines say "No note written". | Low-Medium |
| W3 | The callout "Nov 10, 11:00 a.m. Central" and the card "12:00 PM ET" agree, but the page uses two time zones. Pick one (CT, like the rest of the site). | Low |
| W4 | The rule "groups are never pooled" is explained four times (board header, legend, scoring panel, methodology). | Low (clarity) |

## The 5 changes, ranked by impact
1. **Lead with the last report between reports.** Show an open card above the fold built from `latest_result`: "October WASDE, Oct 9: corn stocks 1.849 bb vs 1.677 expected (+10.3%, bearish); corn yield 181.2 vs 177.8; soybeans in line." Then the countdown to Nov 10. Effort S.
2. **Fill "how the market took it" automatically** from data we already store: the report-day change in the front new-crop contract (Dec corn, Nov soy, Dec wheat), labeled "Yahoo close, not CME settle". Oct 9 would read "Dec corn −20½¢". Sourced price move only, no story. Effort S-M.
3. **Show USDA's standing number during the gap:** "Number to beat on Nov 10: USDA's current corn yield 181.2, stocks 1.849 bb, soy 53.1 / 315 mb." The data already holds `usda_current`. Add the trade range the moment a survey posts, with source and time. Effort S.
4. **Fix the positioning wiring (W1):** default `positioning_commodities` to corn, soybeans and wheat for WASDE and Crop Production cards, so the COT line fills from cot.json. If it still cannot fill, state the true reason. Effort S.
5. **Tighten for the phone:** explain the pooling rule once (in the legend) and move the methodology into one toggle. Put a one-line plain verdict at the top of the board, for example: "So far no outside forecaster has 3 graded yield calls; our nowcast beat the trade once in 6 tries." Use CT times only (W3). Effort S.

**Best on the internet today? Close.** The graded forecaster board is unique, and the numbers match DTN. But between reports the first screen answers nothing, the last result is folded away, and the promised price reaction is blank. DTN's Preview/Review answers "what was priced in and what happened" faster. Changes 1 to 3 (all small, all from data on file) would make it the best.
