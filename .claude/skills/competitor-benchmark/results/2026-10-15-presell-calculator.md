# Head to head: agsist.com/presell-calculator (now the pre-sell step on /harvest-price-tracker#presell)

Checked Oct 15, 2026, from the read-only checkout. presell-calculator.html is a noindex redirect to /harvest-price-tracker#presell. On my local server the extensionless target 404s; GitHub Pages serves it. So I rendered harvest-price-tracker.html#presell directly at 390x844 and 1280x800 and ran two cases. No sideways scroll, no JS errors, about 790 KB loaded for the whole tracker page. The full tracker has its own report (2026-10-15-harvest-price-tracker.md). This one scores only the pre-sell step against pre-sell guidance.

**What I could not see:** I could not open any competitor host (DNS refusal). Competitor cells are from search-result text and are marked *.

## Numbers checked by hand
- **Iowa corn, APH 200, 80% coverage, 500 ac:**
  - Guarantee: 200 x 0.80 x $4.62 = $739.20, shown as **$739/ac**.
  - At the running harvest price: 200 x 0.80 x $4.95 = $792, which is +$52.80 and +7.1%. Shown as **$792, +7.1%, $53**.
  - Pre-sell: 200 x 0.80 = **160 bu/ac**, x 500 = **80,000 bu**. Matches.
- **Georgia corn, APH 150, 75%, 300 ac:**
  - Guarantee: 150 x 0.75 x $4.42 = $497.25, shown as $497.
  - At the final harvest price: x $4.69 = $527.63, shown as $528, +6.1%, $30.
  - Pre-sell: 112.5 bu/ac and 33,750 bu. All match.
- **The rule matches extension guidance:** APH x coverage = guaranteed bushels, as ISU and an ADM worksheet both describe.* ISU's own example is more cautious (75% of APH at 80% coverage).*
- **Wording issue (low):** the result says selling ahead "keeps every one of them inside your floor of $4.62 (the Corn projected price)". RP guarantees revenue, not a price per bushel. In Iowa today the guarantee is already at $4.95, since the harvest price is running above projected. So "$4.62 floor" understates it and could be read as a price floor. Better: "inside your revenue guarantee (now $792/ac at the running harvest price)".
- **Season:** the step answers a spring and summer question. In mid-October most of the crop is priced or in the bin. The page does not say "for next year, come back in February".

## Scores (1-5)

| Page | First screen | Current | Accurate/sourced | Local | Clear | Depth | Phone | Trust | Speed | Unique | Total |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **AGSIST pre-sell step (/harvest-price-tracker#presell)** | 3 | 3 | 4 | 4 | 4 | 3 | 4 | 4 | 3 | 3 | **35** |
| MSU Extension, "High grain prices: how many bushels should I market?"* | 3 | 2 | 5 | 2 | 4 | 3 | 3 | 5 | 4 | 2 | 33 |
| ISU Ag Decision Maker guidance on guaranteed bushels (FM1853 and related)* | 2 | 2 | 5 | 2 | 3 | 4 | 2 | 5 | 3 | 3 | 31 |
| ADM Investor Services crop insurance worksheet (PDF)* | 2 | 2 | 4 | 3 | 3 | 3 | 1 | 3 | 3 | 2 | 26 |
| Farm Progress / DTN articles on over-contracting* | 3 | 2 | 4 | 1 | 3 | 2 | 3 | 3 | 2 | 1 | 24 |

\* from search snippets only; not opened.

Search for "how many bushels should I forward contract before harvest crop insurance guarantee calculator" found articles and a PDF worksheet, but no live calculator.

## Where we win
- **It is the only live version I found.** It uses your state's own projected price and your APH and coverage from the step above. It shows bushels per acre and whole-farm bushels, with no PDF or spreadsheet.
- **The caveat is plain and correct.** RP protects revenue, not delivery. A short crop can mean buying back bushels, and basis is not covered.

## Where a competitor beats us, and how
- **Cautious tiers (ISU, MSU, DTN).** They suggest starting under the guarantee (50 to 75% of APH) and adding as the crop firms up.* Ours gives one number.
- **Worked short-crop example (Farm Progress).** It shows what happens at 90% contracted in a bad year.* Ours states the risk but does not price it.

## Five changes, ranked by impact
1. **Fix the floor wording (S).** Say "revenue guarantee", and show the guarantee at the current harvest price when it is higher.
2. **Show a cautious and a full number (S).** For example, "Cautious: 75% of APH = 150 bu/ac. Full guarantee: 160 bu/ac." Credit the extension rule for the cautious one.
3. **A one-line short-crop example (S).** For example: "Sell 160, raise 120: buy back 40 bu at harvest price; RP pays $X." It uses the numbers already on screen.
4. **Season note (S).** After harvest, write "planning 2027? Projected price is set in February; this step will use it then". Or show it against Dec '27 futures as an estimate, labeled.
5. **Keep the redirect and its noindex (none).** It works. Point the old page's title at the step name.

## Verdict
Best on the internet today? **Close.** It is the only live pre-sell calculator I found, and the math is right. It is also only one line of arithmetic, and extension guidance is more careful about how much to sell before the crop is made. The "floor of $4.62" wording is the first fix.
