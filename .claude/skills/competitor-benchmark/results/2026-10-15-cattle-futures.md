# Head to head: agsist.com/cattle-futures-prices

Checked Oct 15, 2026, from the read-only checkout. I rendered cattle-futures-prices.html at 390x844 and 1280x800. No sideways scroll, no JS errors (one blocked analytics call). The quotes come from data/prices.json (Oct 14 closes): Oct '26 live cattle $223.90 and Oct '26 feeders $340.95. Positioning comes from CFTC as of Oct 6.

**What I could not see:** I could not open any competitor host (DNS refusal). Competitor cells are from search-result text and are marked *.

## Numbers checked by hand
- **Feeder/live ratio:** $340.95 / $223.90 = 1.5228, shown 1.523. Matches.
- **Forward curve:**
  - Apr '27 $228.75 - Oct '26 $223.90 = $4.85. Over 6 months that is $0.81 a month.
  - The curve then dips to $223.475 in Jun '27.
  - Matches.
- **Cost-of-gain calculator, default case:**
  - Purchase: 800 lb x $340.95 = $2,727.60.
  - Gain: 1,400 - 800 = 600 lb. Feeding: 600 x $1.15 = $690.00.
  - Total cost $3,417.60, divided by 1,400 lb x 100 = $244.11/cwt.
  - At Apr '27 $228.75: 14 cwt x $228.75 = $3,202.50, which is -$215.10 a head.
  - Finish date: 600 / 3.5 = 171 days from mid-October, which is early April, so Apr '27 is the right contract.
  - All match.
- **Managed money:**
  - Live cattle (50.7k - 47.7k) / (138.0k - 47.7k) = 3% of the 52-week range.
  - Feeders (9.4k - 7.2k) / (26.8k - 7.2k) = 11%.
  - Both match data/cot.json.
- **No math errors in the page body.**
- **Wrong numbers in the title and meta (low):**
  - The SEO title, meta description and first-screen note are baked in at build time. They say "Live cattle closed near $223.95, feeders near $340.83 ... as of Oct 14".
  - The Oct 14 closes in prices.json are $223.90 and $340.95, and the live hero right above shows $223.90.
  - So the "closed" figures are an intraday print, 5¢ and 12¢ off. Small, but a search snippet says "closed" with a number that was not the close.
- **Default cost of gain (low):**
  - $1.15/lb is inside the stated $0.90 to $1.30 range, with no source.
  - Purdue's Langemeier (farmdoc daily, July 2026, from snippets) put 2026 feeding cost of gain at $101 to $104/cwt, about $1.01 to $1.04/lb, and finishing break-evens above $250/cwt into late 2026. His break-even includes interest and other costs that our simple formula leaves out.

## Scores (1-5)

| Page | First screen | Current | Accurate/sourced | Local | Clear | Depth | Phone | Trust | Speed | Unique | Total |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **AGSIST /cattle-futures-prices** | 4 | 4 | 4 | 1 | 4 | 4 | 4 | 4 | 4 | 3 | **36** |
| farmdoc daily / Purdue, cattle finishing break-evens and returns (Jul 2026)* | 3 | 4 | 5 | 1 | 4 | 3 | 4 | 5 | 4 | 3 | 36 |
| Barchart live and feeder cattle quotes, COT charts, daily cattle story* | 4 | 5 | 4 | 1 | 3 | 5 | 3 | 3 | 2 | 3 | 33 |
| DTN livestock quotes and commentary* | 3 | 4 | 4 | 2 | 3 | 4 | 3 | 4 | 2 | 3 | 32 |
| K-State feedlot returns PDF and Oklahoma State BEFLCALC (break-even purchase price)* | 2 | 3 | 5 | 2 | 3 | 4 | 2 | 5 | 3 | 3 | 32 |
| CME Group live and feeder cattle* | 3 | 5 | 5 | 1 | 2 | 4 | 3 | 4 | 2 | 2 | 31 |
| TradingView LE1!/GF1!* | 3 | 5 | 3 | 1 | 3 | 4 | 3 | 3 | 3 | 2 | 30 |
| Drovers market news* | 3 | 4 | 3 | 1 | 3 | 2 | 3 | 3 | 2 | 2 | 26 |

\* from search snippets only; not opened. Barchart's quote pages in search were for 2025 and early-2026 contracts.

## Where we win
- **One page for a cow-calf or feedlot reader.** It has live and feeder prices, the feeder/live ratio, the forward curve, 5-year percentiles, managed-money positioning and a break-even calculator pre-filled from the board, with the finish month matched to the right contract. Barchart has all the pieces but spread across pages and ads. The university tools are PDFs or spreadsheets.
- **Honest labels.** "Not CME settlements", "4 years is a short window", "positioning, not a price forecast".

## Where a competitor beats us, and how
- **Cash cattle.** A cattle seller's number is the cash trade: the 5-area fed steer weighted average, the CME Feeder Cattle Index, auction prices by weight, and the boxed beef cutout. USDA AMS publishes all of them, and DTN and Barchart carry them. Our page is futures only. The calculator even uses Oct feeder futures as the price of an 800 lb steer.
- **Sourced cost of gain (farmdoc, K-State).** Their cost-of-gain and break-even numbers come from closeouts with a date. Ours is a default.
- **Report dates.** The page explains Cattle on Feed but never gives the next date. NASS's 2026 schedule (from snippets) has it on Oct 23, Nov 20 and Dec 18, and our USDA calendar does not list it either.

## Five changes, ranked by impact
1. **Add the cash side (M).** Show the CME Feeder Cattle Index, the USDA AMS 5-area weighted average fed steer price (weekly) and the choice boxed beef cutout, each dated and sourced. Show basis = cash minus nearby futures. All three are public USDA/CME numbers.
2. **Fix the baked title and meta (S).** Seed them from the same close the hero uses ($223.90 / $340.95), or say "last trade" instead of "closed".
3. **Next Cattle on Feed date on the page (S).** "Next Cattle on Feed: Fri Oct 23, 2 p.m. CT (NASS)". Add the same report to usda-calendar.
4. **Source the default cost of gain (S).** Default it to a dated published figure (for example Purdue's 2026 $101 to $104/cwt) and add interest and death loss as separate lines, so the break-even is comparable with farmdoc's.
5. **Weight slide for lighter calves (M).** Let the farmer enter a cash feeder price, or apply a sourced price slide from a USDA AMS weekly auction summary for 500 to 700 lb steers. Then the calculator is not stuck on the 700 to 899 lb index.

## Verdict
Best on the internet today? **Close.** It is the most complete free one-page cattle futures read I found, and every computed number checks out. But a cattle seller sells cash cattle, and the page has no cash price, no Feeder Cattle Index and no cutout. The SEO title also says "closed" with an intraday number.
