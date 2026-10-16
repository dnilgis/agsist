# Head to head: agsist.com/whats-priced-in, 2026-10-16

Checked Oct 16, 2026 from the checkout (claude/gracious-cori-qspito, same as origin/main for this page and its data). I rendered whats-priced-in.html at 390x844 and 1280x800 and opened every collapsed section. There was no sideways scroll and no JS errors (one blocked outside call). The page loads about 510 KB, of which 120 KB is the HTML. The data is whats-priced-in.json, updated Oct 16, plus analyst-scorecard.json.

Competitors were scored only from the copies GitHub Actions fetched on Oct 16 (references branch, bench-whats-priced-in-1..6). I did not render them, so phone is "?" and their totals are out of 45. For a fair comparison, ours without phone is 38/45. Two copies failed with HTTP 403 and have no archived copy, so I could not read them: Farm Progress "USDA yield shocker" (-4) and AgWeb "USDA delivers unexpected blow" (-5). Their cells are "?".

Since Oct 15 the page has fixed 3 of the 4 findings:
- **W1 fixed.** The positioning line now fills from cot.json.
- **W3 fixed.** All times are Central.
- **Change 1 shipped.** The first screen now leads with the October result and the Dec corn move.

## Numbers checked by hand
- **October WASDE, checked against the saved DTN and Pro Farmer copies:**
  - Corn stocks: 1.849 vs 1.677 = +10.3%, inside DTN's 1.522-1.895 range. OK.
  - Corn production: 16.034 vs 15.716 = +2.0%, inside 15.344-16.115. OK.
  - Wheat stocks: 740 vs 722 = +2.5%, inside 701-750. OK.
  - Soy yield: 53.1 vs 52.9 = +0.4%. Soy stocks: 315 vs 311 = +1.3%. Soy production: 4,562 vs 4,541 = +0.5%. OK.
  - Corn yield: 181.2 vs 177.8 (Reuters, via Pro Farmer: range 173.2-182.1, average 177.8) = +1.9%. OK.
  - "3 of 7 graded figures landed in line" and "4 surprises" match the 8 lines (wheat production has no trade estimate). OK.
- **Scorecard:**
  - AGSIST nowcast average error: (0.77 + 1.13 + 2.30 + 2.46 + 1.60 + 2.09) / 6 = 1.73%, beat trade 1 of 6. OK.
  - McClure: (0.06 + 1.90) / 2 = 0.98%, bias (+0.06 - 1.90) / 2 = -0.92%. OK.
  - Suderman yield: (2.27 + 0.57) / 2 = 1.42%. OK.
- **Dec corn on Oct 9:** $5.00¼ to $4.79¾, down 20½¢. This matches DTN's review ("finished down 20 1/2 cents at $4.79 3/4").

## Scores (1-5)

| Page | First screen | Current | Accurate/sourced | Local | Clear | Depth | Phone | Trust | Speed | Unique | Total | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **AGSIST /whats-priced-in** | 4 | 5 | 5 | 2 | 3 | 5 | 4 | 5 | 4 | 5 | **42/50** (38/45 without phone) | rendered Oct 16 |
| DTN report review (Oct 9) | 5 | 4 | 4 | 1 | 4 | 4 | ? | 4 | 2 | 3 | 31/45 | fetched Oct 16 |
| DTN preview (Oct 7) | 4 | 3 | 5 | 1 | 3 | 4 | ? | 4 | 2 | 3 | 29/45 | fetched Oct 16 |
| Pro Farmer October WASDE preview (Oct 9) | 4 | 3 | 4 | 1 | 4 | 3 | ? | 4 | 3 | 2 | 28/45 | fetched Oct 16 |
| farmdoc daily (home page; no preview or review page) | 1 | 4 | 4 | 1 | 3 | 2 | ? | 5 | 3 | 1 | 24/45 | fetched Oct 16 |
| Farm Progress report reaction | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | not readable (HTTP 403, no archive) |
| AgWeb report coverage | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | not readable (HTTP 403, no archive) |

How I scored the competitors:
- **Current:** each is a dated article about the Oct 9 report. That is still the latest report, so the review gets a 4. The previews get a 3: they are now stale and say nothing about Nov 10.
- **Speed:** DTN's saved HTML carries 16 ad-tag references, and the text shows ad slots ("P[L1] D[0x0] M[300x250]").

## Where we win
- **A graded record of the forecasters.** There are 15 tracked public forecasters plus our own nowcast, marked OURS, scored by the same rules. Yield and stocks are scored apart, and no places are printed until records are long enough. No saved competitor grades anyone.
- **Every report in one place.** The page has June to October WASDEs and September Grain Stocks. Each metric shows trade, actual, % gap and where the print fell in the range, plus the price move for the corn and soybean lines. DTN and Pro Farmer each cover one report per article, at a new URL each time.
- **Corrections to the trade numbers.** DTN's review prints corn yield as "181.1 bpa ... 2.7 bpa higher than September". September was 178.5, so +2.7 gives 181.2, which is our figure. DTN's preview gives the Dow Jones yield average as 177.6 and its review says 177.7. We cite one survey (Reuters 177.8) by name and date.
- **Positioning filled from data.** "Managed money corn net long 329,839, down 51,381 ... positions as of October 06" now appears on the next-report card.

## Where they beat us, and how
- **The trade table for the next report (DTN preview).** The preview shows a table for every big number: production, yield, harvested acres, US ending stocks and world stocks. Each row gives the survey's average, high and low next to USDA's last number. Between reports, our next-report card shows three "No trade range yet / No market odds / No surprise thresholds" boxes. We also do not show USDA's standing number (the October print) as the number to beat, although whats-priced-in.json carries `usda_current` for every graded line.
- **A price move on every line (DTN review).** DTN gives the close for corn, soybeans and KC wheat ("December Kansas City wheat finished 17 cents lower at $7.19 1/4"). Both of our wheat lines and both September WASDE lines still read "No note written on how the market took it."
- **Why the number matters (Pro Farmer).** Pro Farmer ties the yield to stocks-to-use: "a yield of 176.6 or lower ... would be needed to return to the stocks-to-use previously expected". We grade the result but never say what yield would change the balance sheet. Any such number of ours would have to come from USDA's own balance sheet, labeled, and never from a model of ours.
- **Clarity.** The rule that yield and stocks are never pooled is still explained 4 or more times: in the group headers twice, the legend, the scoring panel and the methodology. That makes the page 22,000 px tall on a phone with the sections open.

## Bugs found

| # | Finding | Severity |
|---|---|---|
| B1 | Under the yield board: "Below the line, records still building have landed closer than the consensus on 2 of 7 calls." The yield records below the line are Suderman 0/2, McClure 1/2, Gulke 1/1 and Pro Farmer 0/1, which makes 2 of 6. The 7th is Suderman's ending-stocks call, so this line pools the two groups that the page says it never pools. | Low |
| B2 | Oct 9 Nov soybeans: we print "settled 4½¢ higher, $12.87½ to $12.92". DTN's review prints "finished up 4 1/2 cents at $12.94". The change agrees but the level is 2¢ apart. DTN's two figures do not agree with each other ($12.94 - 4½¢ = $12.89½, not our $12.87½ Oct 8). Check against the CME settle before the next report. Our series is the Yahoo-fed harvest-prices.json, and the page labels it "CBOT settles". | Low (verify) |
| B3 | Wheat ending stocks (bearish, +2.5%) and wheat production have no price line, though the lede promises "which way price moved". Same for the Sept 11 corn and soy yield lines. (Oct 15 W2, partly fixed.) | Low |
| B4 | May WASDE: all 5 lines say "Trade survey source date unknown", but they are still graded and count in the history. | Low |

## The 5 changes, ranked
1. **Show the number to beat during the gap.** On the next-report card, show USDA's standing October figures: corn yield 181.2, corn stocks 1.849 bb, soy yield 53.1, soy stocks 315 mb, wheat stocks 740 mb. Each gets its report date and is labeled "USDA, Oct 9". When a survey posts, add the average, high and low in our own layout, with source and time. Why: this is DTN's table, the one thing a farmer wants in the 25 days before Nov 10, and we already hold the data. Effort S. Honesty risk low: these are USDA's own published numbers.
2. **Fill every "how the market took it" line from stored settles.** Add a Dec KC or Chicago wheat series for the wheat lines, and backfill the Sep 11 corn and soy lines from the series we keep. Settle B2 against the CME settle, and label the source honestly (Yahoo close vs CME settle). Why: the lede promises it, and DTN does it for all three crops. Effort S-M. Honesty risk: only if a close is called a settle.
3. **Put a one-line verdict at the top of the board and explain pooling once.** For example: "Our nowcast beat the trade on 1 of 6 yield calls; no outside forecaster has 3 graded calls yet." Keep the pooling rule in the legend only, and fix B1. Why: it cuts phone length and makes the unique part readable. Effort S. Honesty risk none.
4. **Type in the survey on survey day.** For Nov 10, enter Reuters and Dow Jones averages, highs and lows within hours of their posting (about Nov 6-9). Show both surveys when they differ (they differed by 0.1-0.2 bpa on Oct 9). Why: the page is weakest in the 2 days before a report, and that is when farmers look. Effort M (a recurring manual task). Honesty risk: cite each survey by name and time, and never average them ourselves.
5. **Either date the May WASDE survey sources or take those 5 lines out of the graded history (B4).** Mark them "not graded: source date unknown", as the July WASDE is. Why: graded lines with no source date weaken the page's main claim that every number is sourced. Effort S. Honesty risk: this change removes a risk.

## Verdict
**Best on the internet today? Close.** Right after a report it is the best page on the internet. It is the only one that grades every big number and the forecasters against the print, and its numbers check out against DTN's own copy and even catch DTN's 181.1 slip. Between reports, the next-report card has nothing to show, while DTN's preview table gives the averages, ranges and USDA's last number. Change 1 (small, data on file) would close that.

**Change since Oct 15: 39 → 42 (+3).** First screen went from 2 to 4 (the October result leads, with the price move). Current went from 4 to 5 (updated Oct 16, positioning filled). Everything else is unchanged, including clear (3) and local (2).
