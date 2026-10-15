# Head to head: agsist.com/fertilizer

Checked Oct 15, 2026, from the read-only checkout. I rendered fertilizer.html at 390x844 and 1280x800. No sideways scroll, no JS errors (one blocked analytics call). Prices come from data/fertilizer.json: six products, "Midwest dealer". The sheet is dated Sep 1, 2026, which is 43 days old; K-Mag and lime are dated Jul 20, 86 days old. The page says up front that the sheet is 43 days old.

**What I could not see:** I could not open any competitor host (DNS refusal). Competitor cells are from search-result text and are marked *.

## Numbers checked by hand
- **Cost per pound of nutrient:**
  - Urea $590 / 920 lb N = $0.641.
  - Potash $460 / 1,200 lb K2O = $0.383.
  - MAP+S $930 / 800 lb P2O5 = $1.1625. Per lb of N it is $930 / 240 = $3.875, and per lb of S $930 / 200 = $4.65.
  - AMS $460 / 420 lb N = $1.095, and per lb of S $460 / 480 = $0.958.
  - K-Mag $650 / 400 lb K2O = $1.625, and per lb of S $650 / 440 = $1.477.
  - All of these match.
- **Fertility bill, corn at 180 bu, default rates:**
  - N: 0.9 x 180 = 162 lb. P2O5: 0.37 x 180 = 66.6 lb. K2O: 0.24 x 180 = 43.2 lb.
  - MAP: 66.6 / 0.40 = 166.5 lb, x $0.465 = $77.42. That supplies 20.0 lb N and 16.7 lb S.
  - Urea: (162 - 20) / 0.46 = 308.7 lb, x $0.295 = $91.07 ($91.08 shown).
  - Potash: 43.2 / 0.60 = 72 lb, x $0.23 = $16.56.
  - Total $185.06, and divided by 180 bu that is $1.03/bu. Matches.
- **N:corn ratio:** $0.641 / $4.79 = 0.134. A ton of urea at $590 / $4.79 = 123 bu. Matches, and it is labeled as futures before basis.
- **FAQ:** "$100/ton urea adds about $17/acre, $0.10/bu" at 160 lb N: 160 / 0.46 = 348 lb, which is 0.174 ton x $100 = $17.39, and divided by 180 bu that is $0.097. Matches.
- **No math errors.**
- **The inputs are the weak part (medium):**
  - DTN's national retail survey for the last week of September 2026 (published Oct 7, from search snippets) has urea at $683, MAP $974, potash $499, DAP $934 and anhydrous $979, with 7 of 8 products higher than a month earlier.
  - Our urea is $590, dated Sep 1 and marked "▼ $105". That is 14% below DTN, and it moved the other way.
  - At DTN's $683, N costs $0.742/lb, not $0.64. At 162 lb N that is about $16/acre more than our calculator says.
  - This is not a math error: one dealer can honestly be cheaper, and the date is printed. But a farmer budgeting from the "Cheapest nitrogen $0.64" box would budget low.
- **Labeling issues (low):**
  - The JSON-LD description says "Current US fertilizer prices" for a 43-day-old sheet.
  - "▼ $105" does not say what it compares against (the Jul 20 sheet).
  - data/fertilizer-history.json stops at Jul 20 and is missing the Sep 1 sheet it is supposed to append.

## Scores (1-5)

| Page | First screen | Current | Accurate/sourced | Local | Clear | Depth | Phone | Trust | Speed | Unique | Total |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **AGSIST /fertilizer** | 4 | 2 | 2 | 2 | 4 | 4 | 4 | 3 | 4 | 3 | **32** |
| farmdoc daily fertilizer price articles (AMS Illinois data, Aug 2026 "higher heading into fall")* | 3 | 3 | 5 | 3 | 4 | 4 | 4 | 5 | 4 | 3 | 38 |
| DTN Retail Fertilizer Trends (weekly, 8 products, national average)* | 4 | 4 | 4 | 2 | 4 | 3 | 3 | 4 | 2 | 2 | 32 |
| USDA AMS Illinois Production Cost Report (biweekly: anhydrous, UAN, DAP, potash, diesel)* | 2 | 4 | 5 | 3 | 2 | 3 | 2 | 5 | 3 | 3 | 32 |

\* from search snippets only; not opened. I did not find a free farmer app with a fertilizer price calculator in search. FBN, ag retailers and input marketplaces may carry prices behind a login, and I could not check them.

## Where we win
- **A fertility bill, not just a price list.** Pick a crop and yield, and it picks the cheapest source per nutrient, credits MAP's nitrogen and sulfur, and gives $/acre and $/bu. Every number checks out. The price reports (DTN, AMS) do not do this.
- **Cost per pound of nutrient** for six products, including AMS and K-Mag sulfur.
- **Honest about age.** The 43-day warning box is right at the top.

## Where a competitor beats us, and how
- **Current and broad (DTN weekly, AMS biweekly).** Both carry anhydrous, UAN28/32 and DAP, the products most Corn Belt farmers price this fall. Our page says outright that it does not price them.
- **Sourced.** AMS and DTN say whose prices they are and how many. Ours is "Midwest dealer", one unnamed source.
- **Trend (farmdoc, DTN).** Both give year-ago and month-ago comparisons. We have a history file but show no line, and the file is missing the last sheet.

## Five changes, ranked by impact
1. **Add the public USDA AMS production cost series next to the dealer sheet (M).** Use the Illinois report (and Iowa's, if it is still published): anhydrous, UAN28, UAN32, DAP, potash, urea, biweekly, public domain. Show it as "USDA AMS Illinois, <date>" beside "our dealer sheet, <date>". The fresher of the two leads, and both are always labeled.
2. **Price anhydrous, UAN and DAP in the calculator (S, after 1).** Most fall N in the Corn Belt is anhydrous. Leaving it out makes the "cheapest nitrogen" box misleading.
3. **Say whose prices these are (S).** For example "one dealer in western Wisconsin, quoted by phone" (Sig to confirm the true wording). Add "vs Jul 20" to the change arrows and drop "Current" from the JSON-LD.
4. **Fix the history and show it (S).** Append the Sep 1 sheet to fertilizer-history.json (update_fertilizer.py did not), and draw a small price line per product on demand.
5. **Use local cash corn for the ratio (S).** Offer "my state" and use the state's network basis median from basis-states.json. Wisconsin corn at -58¢ is $4.21, so the ratio is 0.152, not 0.134. Keep the futures version as a reference.

## Verdict
Best on the internet today? **No.** The calculator is good and the math is right, but the prices are one unnamed dealer's, 43 days old, and missing anhydrous, UAN and DAP. DTN and USDA AMS are fresher and broader. Change 1 alone (a public, dated USDA series) would make this the best free fertilizer page I found, because nobody else turns the prices into a per-acre bill.
