# Head to head: agsist.com/breakeven

Checked Oct 15, 2026, from the read-only checkout. I rendered breakeven.html at 390x844 and 1280x800, and ran the default corn case and a soybean case with a -$0.40 basis. No sideways scroll, no JS errors, about 440 KB loaded. A sticky phone bar shows "Break-even $5.03/bu, -$43/ac". The futures quote is from data/prices.json (Dec '26 corn $4.7875, closes of Oct 14).

**What I could not see:** I could not open any competitor host (DNS refusal). Competitor cells are from search-result text and are marked *.

## Numbers checked by hand
- **Corn default:**
  - Costs: 125 + 175 + 65 + 35 + 145 + 35 + 250 + 75 = $905 an acre. Divided by 180 bu, that is **$5.03** a bushel.
  - Revenue: 180 x $4.7875 = $861.75, so the loss is -$43 an acre and the margin is -4.8%.
  - Yield needed: 905 / 4.7875 = 189.0 bu. The page shows 190. It rounds up, which is fair.
  - Whole farm: 500 ac x -$43.25 = -$21,625.
  - What-if table: 180 bu at $4.79 gives -$43, and 200 bu at $4.99 gives +$93. Both match.
- **Soybeans, futures $12.7225, basis -$0.40:**
  - Cost: $650 / 55 bu = $11.82.
  - Futures needed: $11.82 + $0.40 = $12.22.
  - Revenue: 55 x $12.3225 = $677.74, so profit is +$28 an acre and +$13,869 on 500 ac.
  - Yield needed: 52.75 bu, shown as 53.
  - What-if table: 55 bu at $12.22 gives $0. Matches.
- **FAQ arithmetic:**
  - $850 / 200 = $4.25. At -$0.30 basis that needs $4.55 futures.
  - $50 more rent is $0.28 at 180 bu, $0.25 at 200 bu and $0.91 for beans at 55 bu.
  - The WI and MN rent figures ($247 max and $136 median for WI, $280 and $189 for MN) match data/cash-rent.
- **No math errors.**
- **Labeling issues (low):**
  - "Dec corn (new crop)" in mid-October is the crop being harvested. The new crop for planning is now Dec '27 ($5.0975).
  - "2026 university crop budgets ... in a similar range" cites no figure. Purdue says $5.34 on average soil. farmdoc says about $4.80 north and central Illinois, over $5 south. MSU says $4.60.

## Scores (1-5)

| Page | First screen | Current | Accurate/sourced | Local | Clear | Depth | Phone | Trust | Speed | Unique | Total |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **AGSIST /breakeven** | 4 | 3 | 4 | 2 | 4 | 4 | 4 | 4 | 4 | 3 | **36** |
| farmdoc daily, 2026 Illinois crop budgets + spring revision (and 2027 outlook)* | 4 | 5 | 5 | 3 | 4 | 4 | 4 | 5 | 4 | 4 | 42 |
| Purdue 2026 Crop Cost and Return Guide* | 3 | 4 | 5 | 3 | 3 | 5 | 2 | 5 | 3 | 4 | 37 |
| ISU Ag Decision Maker, Estimated Costs of Crop Production 2026 (A1-20)* | 2 | 4 | 5 | 3 | 3 | 5 | 2 | 5 | 3 | 3 | 35 |
| MSU 2026 Corn Cost of Production projection tool* | 3 | 4 | 5 | 3 | 3 | 4 | 2 | 5 | 3 | 3 | 35 |
| AFBF Market Intel, 2026 risk management (national break-evens)* | 4 | 4 | 4 | 1 | 4 | 2 | 4 | 4 | 4 | 2 | 33 |

\* from search snippets only; not opened.

## Where we win
- **It is an actual calculator on a phone, with a live futures price and your basis.** University budgets are PDFs or spreadsheets (Purdue, ISU, MSU), and none I found takes a live price. Search for "corn break-even price calculator 2026" turned up budgets and articles, not an online tool.
- **Futures needed at your basis, yield needed, and a 6x6 what-if grid**, all as you type, plus a split of owned and rented ground. The math is right in every case I ran.
- **No sales agenda.** It is not a lender lead form.

## Where a competitor beats us, and how
- **Source and date for the defaults (farmdoc, Purdue, ISU).** Their numbers come with region, rotation and soil class, plus a date. Ours are "a representative Upper Midwest example" with no source line. That is fine as an input, but weaker when the hero leads with "$5.03".
- **Next year (farmdoc, Illinois Extension Oct 9 "2027 crop budget outlook").** Rent talks and input booking in October are about 2027. Our page has no 2027 view or Dec '27 price.
- **Other revenue (farmdoc).** farmdoc shows a break-even before and after ARC/PLC and insurance payments. AGSIST has an ARC/PLC page and county pages but does not link those dollars in.
- **Soil productivity tiers (Purdue).** Purdue gives low, average and high soil ($5.68 / $5.34 / $4.94). Our single default does not show the spread.
- **Trust signal on the page.** The page carries the author only in a meta tag. There is no visible byline like on the manure page.

## Five changes, ranked by impact
1. **Fill rent and yield from the farmer's county (M).** AGSIST already has 2026 NASS county rent (data/cash-rent/<ST>.json) and the county 15-yr trend yield the Atlas uses. Add "Your county" (or ZIP) to fill LAND RENT and EXPECTED YIELD, labeled "NASS 2026 county average" and "county trend". Load the one state file on demand, so there is no page-size cost. No competitor does this.
2. **Add a 2027 toggle (S).** It would switch the quote to Dec '27 / Nov '27 and label the defaults "2027 planning". Rename the 2026 label from "new crop" to "harvest (Dec '26)".
3. **Source line under the defaults (S).** Write, for example: "Close to farmdoc's 2026 northern Illinois budget ($X/ac) and Purdue's average-soil guide ($5.34/bu)". Use the real figures from the PDFs, and replace the uncited "similar range" sentence with them.
4. **Optional "other revenue" line (S).** Add one input, in $/ac (ARC/PLC or other), that lowers the break-even. Link to the county ARC/PLC page for the number. Say it is an estimate.
5. **Visible byline and date on the page (S).** Add "Sigurd Lindquist, Certified Crop Adviser (CCA)" and "defaults reviewed <date>" under the H1, as on manure-value.

## Verdict
Best on the internet today? **Close.** It is the cleanest free break-even calculator with live futures, basis and a what-if grid, and the math is right. But university budgets beat it on sourced, dated, regional defaults and on 2027. It ignores the county rent and yield data AGSIST already holds, which would make it the only calculator that starts from your own county.
