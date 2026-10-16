# Head to head: agsist.com/cattle-auction-prices

Checked Oct 16, 2026, from the checkout at main 084d358c4. I rendered cattle-auction-prices.html at 390x844 and 1280x800 in three states and looked at each:
- blank
- after ZIP 68801 (Grand Island, NE), with the ZIP lookup served from the local bids checkout
- after picking TN

No sideways scroll, no JS errors (only the blocked Google Tag Manager call), about 445-457 KB loaded, 28 KB of HTML. test/cattle-auction.test.mjs passes. This is the first scoring of this page; there is no Oct 15 report.

Competitors were scored only from the copies GitHub Actions saved on Oct 16 (references branch, bench-cattle-auction-prices-1, 2, 3, 5). I did not render them, so phone is "?" and their totals are out of 45. CattleRange (-4) and USDA MyMarketNews (-6) failed to fetch. Every saved competitor copy is old:
- the AMS national summary is for the week ending Apr 4, 2026
- the ESMIS Missouri listing's latest release is Aug 23, 2025
- the cattle.com barn page's latest report is Jul 13, 2023
- the Oklahoma report is from Jan 13, 2026

Their "current" cells rate those copies, not the live services.

## Numbers checked by hand (no errors)
I checked against the raw AMS report saved in data/cattle-auction-raw/ams_1245.txt (Joplin Regional Stockyards, Oct 12, 2026), steers Medium and Large 1.
- **300-399 class.** USDA rows: 17 head at 344 lb, $585.51; 20 head at 366 lb, $530.45.
  - Total weight: 5,848 + 7,320 = 13,168 lb. Average weight 13,168 / 37 = 356 lb.
  - Dollars: $34,240.6 + $38,829.0 = $73,069.6.
  - $/cwt: $73,069.6 / 131.68 = $554.90. $/head: $73,069.6 / 37 = $1,974.85.
  - The data file has 37 head, 356 lb, $554.90 and $1,974.85. Match.
- **400-499 class.** 17 head at 415 lb, $464.76; 70 head at 477 lb, $418.65.
  - $172,576 / 404.45 cwt = $426.69. Matches.
- The weighting by total weight is as the page says ("dollars over hundredweight sold").

## Issues
- **Medium: "the change from that barn's last sale" never shows.** The intro promises it, and the table has a "vs prior" column. data/cattle-auction.json keeps one sale per barn, so every barn reads "No change shown: first sale on file." Either keep history or drop the promise until there is some.
- **Low: the barn list is larger than the barns read.** "Barns this page reads" lists 30 barns. 19 have no AMS report number yet ("run the probe"), and Oklahoma National Stockyards fails with HTTP 404. The note says a barn shows up "once its report has been read", which is honest. Still, the list reads like coverage the page does not have: only 11 barns plus 10 state summaries have a sale on file.
- **Low: thin coverage near the reader.** From Grand Island, NE, the nearest barn with data is 131 miles away. Burwell, Lexington and Ogallala, all closer, are listed but not read.
- **To check:** the "TN weekly summary" (report 2082) shows 1,109 head on the report, and its classes hold 4-29 head. That looks like one sale, not a statewide week. Confirm which report 2082 is before calling it a state summary.

## Scores (1-5)

| Page | First screen | Current | Accurate/sourced | Local | Clear | Depth | Phone | Trust | Speed | Unique | Total | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **AGSIST /cattle-auction-prices** | 3 | 5 | 4 | 4 | 4 | 3 | 4 | 5 | 4 | 4 | **40/50** | rendered Oct 16 |
| USDA AMS National Weekly Feeder & Stocker Summary (w/e Apr 4, 2026 copy) | 3 | 1 | 5 | 3 | 3 | 5 | ? | 5 | 3 | 4 | 32/45 | fetched Oct 16 (PDF) |
| cattle.com barn report, Cattlemen's Livestock Auction, Dalhart TX (7/13/2023) | 4 | 1 | 3 | 4 | 4 | 3 | ? | 3 | 3 | 3 | 28/45 | fetched Oct 16 |
| Oklahoma Dept. of Agriculture Market Report (Jan 13, 2026) | 2 | 1 | 5 | 4 | 2 | 4 | ? | 5 | 2 | 3 | 28/45 | fetched Oct 16 (PDF) |
| USDA ESMIS Missouri Weekly Cattle Auction Summary (listing) | ? | 1 | ? | ? | ? | ? | ? | ? | ? | ? | n/a | not readable: listing page only, newest release Aug 23, 2025, no prices in the copy |
| CattleRange | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | n/a | fetch failed |
| USDA MyMarketNews | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | n/a | fetch failed |

## Where we win
- **Nearest barns to a ZIP, with miles, on one phone screen,** each with its own sale date. Rows are pooled into 100 lb classes with head count, $/cwt, range and $/head at the average weight. AMS publishes one PDF or text report per barn. The OK report is a 13-barn PDF.
- **Honest per-head math.** We weight by total weight. cattle.com's "Approx" per head is the middle weight times the midpoint of high and low, by its own note, which is not what the cattle brought.
- **Calves with a note are left out of the averages and counted** (value added, fleshy, unweaned), and the change rule (within 3 weeks, at least 5 head) is spelled out.

## Where they beat us
- **Trend and context (AMS national summary).** It gives this week vs last week vs a year ago in receipts, regional weighted steer prices (e.g. North Central 600-700 lb $448.05 vs $439.66 vs $344.50), the CME feeder index chart and a written market read. We have one sale per barn and no history.
- **Breadth (Oklahoma report).** It covers OKC and 13 Oklahoma barns in one issue, plus fed cattle, sheep and hay. We read 0 of 2 Oklahoma barns.
- **Cull cows and bulls (cattle.com, Oklahoma).** Both report slaughter cow and bull prices. Our page is feeder steers and heifers only, and cow-calf farmers sell culls every fall.

## Five changes, ranked
1. **Keep each barn's sales history (S-M).**
   - What: append to one data file per state, loaded on demand, so "vs prior sale" fills in.
   - Why: the page already promises the change, and the shown column is empty for every barn.
   - Honesty risk: low. The 3-week and 5-head rules already exist.
2. **Read the 19 listed barns that have no report number, and fix OKC's 404 (M).**
   - What: probe the AMS listing, then add more barns in IA, MO, OK, KY, MT and ND.
   - Why: "near you" is the page's promise, and coverage is 11 barns.
   - Honesty risk: none, if unread barns stay out of the results.
3. **Put a number on the first screen without input (S).**
   - What: show the reader's saved ZIP, or failing that the national or regional weighted steer price by class from the AMS national summary, dated.
   - Why: today the first screen is a form.
   - Honesty risk: low. Label it as the national summary week.
4. **Add slaughter cows and bulls where the barn report has them (M).**
   - What: show $/cwt by grade (Lean, Boner, Breaker) with dressing.
   - Why: every cow-calf farmer sells culls, and the reports already carry it.
   - Honesty risk: low.
5. **Add a weekly trend per class for state summaries and barns (M, after 1).**
   - What: a small line on demand with this week, last week and a year ago.
   - Why: matches the AMS summary's best feature, at barn level.
   - Honesty risk: medium. A mix change can look like a market move, so show head counts on the line.

## Verdict
**Close.** It is the only free page I found that turns USDA auction reports into nearest-barn prices by 100 lb class, with honest per-head math, and the pooling is exact. To be the best it needs three things:
- the history it promises
- more than 11 barns
- a number before you type a ZIP

**Change since Oct 15:** none to compare. This is the first report on this page (40/50).
