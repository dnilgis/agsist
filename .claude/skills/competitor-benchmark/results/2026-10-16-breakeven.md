# Head to head: agsist.com/breakeven

Checked Oct 16, 2026, from the read-only checkout (branch claude/gracious-cori-qspito, d578415f0). I rendered breakeven.html at 390x844 and 1280x800 and ran four cases: the default corn case, Iowa > Story County fill, Dec '27 corn, and soybeans at Nov '27 with a -$0.40 basis and $25/ac other revenue. No sideways scroll and no JS errors (the only failed request is the blocked analytics host). About 469 KB loaded. The sticky phone bar reads "Break-even $5.06/bu, -$57/ac". Futures are from data/prices.json, fetched 2026-10-16 16:01 UTC: Dec '26 corn $4.74, Dec '27 corn $5.0525, Nov '27 beans $12.3675.

**Since Oct 15:** four of the five ranked changes shipped:
- County fill for rent and yield.
- A Dec '27 / 2027 crop option, with the 2026 label fixed.
- The farmdoc 2027 figures cited in place of the uncited "similar range".
- An ARC/PLC or other-income line.
- A visible byline and date.

Also new: the fertilizer default is priced from posted co-op prices, with the math shown.

**Competitor copies:** all are from the references branch.
- Read: farmdoc spring revision (fetched Oct 16), farmdoc 2027 budgets (the shared ref farmdoc-budgets-2027, fetched Oct 15 by the same workflow), Purdue (fetched Oct 16) and AFBF (the shared ref bench-harvest-price-tracker-4, fetched Oct 16).
- Not readable:
  - ISU A1-20: HTTP 403, and Wayback returned 429.
  - MSU: the saved copy is an Incapsula block page.
  - Farm Progress: HTTP 403, with no archived copy.
- I did not score phone for any competitor, because a text copy cannot show layout. Their totals are out of 45, and ours is shown both ways.

## Numbers checked by hand
- **Corn default:**
  - Costs: 125 + 180 + 65 + 35 + 145 + 35 + 250 + 75 = $910. Divided by 180 bu, that is **$5.06**.
  - Revenue: 180 x 4.74 = $853.20, so the result is -$56.80, shown as -$57.
  - Margin: -56.8 / 910 = -6.2%.
  - Yield needed: 910 / 4.74 = 191.98, shown as 192.
  - Farm: 500 ac x -56.8 = -$28,400.
  - What-if: 200 bu at $4.94 gives +$78, and 150 bu at $4.14 gives -$289. Both match.
- **Fertilizer default, $180:**
  - N: urea at 622.98 / 920 = $0.677/lb, x 162 lb = $109.70.
  - P: MAP (980 - 220 x 0.677) / 1040 = $0.799/lb, x 67 lb = $53.50.
  - K: potash at 470.40 / 1200 = $0.392/lb, x 43 lb = $16.90.
  - Total $180.10. Matches.
- **Iowa, Story County:**
  - The rent of $290 matches data/cash-rent/IA.json (2026 non-irrigated). The trend yield of 217 matches pair.corn.t.v = 217.2.
  - Total: 910 - 250 + 290 = $950, so 950 / 217 = $4.38.
  - Revenue: 217 x 4.74 = $1,028.58, so the result is +$79/ac and +$39,290 on the farm.
  - Yield needed: 200.4, which the page rounds up to 201.
- **Soybeans, Nov '27 $12.3675, basis -0.40, other revenue $25, Story County:**
  - Cost: 668 - 250 + 290 = $708. At 66 bu that is $10.73.
  - After other revenue: (708 - 25) / 66 = $10.35. Futures needed: $10.75.
  - Revenue: 66 x 11.9675 = $789.86, so profit is +$107/ac.
  - Yield needed: 683 / 11.9675 = 57.07, shown as 58. All match.
- **farmdoc sentence on the page:** "just under $5 in northern and central Illinois and $5.39 in southern Illinois; soybeans $11.10 to $11.28 ... nearly $12 in the south." This matches the saved farmdoc 2027 copy word for word in substance.

## Bugs
- **Low: the 2027 crop keeps a 2026 county yield.** With Dec '27 corn picked, the county note still says "the county's 15-year trend projected to 2026", and yield stays at 217. Projected to 2027 at the stored slope (3.867), Story is about 221. The page also says "Planning the 2027 crop", so the two lines disagree.
- **No math errors** in four cases.

## Scores (1-5)

| Page | First screen | Current | Accurate/sourced | Local | Clear | Depth | Phone | Trust | Speed | Unique | Total | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **AGSIST /breakeven** | 4 | 4 | 4 | 4 | 4 | 5 | 4 | 5 | 4 | 5 | **43/50 (39/45 without phone)** | rendered Oct 16 |
| farmdoc daily, Illinois Crop Budgets for 2027 (Sep 1, 2026) | 3 | 5 | 5 | 3 | 4 | 4 | ? | 5 | 4 | 5 | 38/45 | fetched Oct 15 (ref farmdoc-budgets-2027) |
| farmdoc daily, Spring Revision to 2026 Illinois Crop Budgets (May 19, 2026) | 3 | 3 | 5 | 3 | 4 | 4 | ? | 5 | 4 | 3 | 34/45 | fetched Oct 16 |
| Purdue 2026 Crop Cost and Return Guide (PAER, Mar 23, 2026) | 3 | 3 | 5 | 3 | 4 | 5 | ? | 5 | 3 | 4 | 35/45 | fetched Oct 16 |
| AFBF Market Intel, Risk Management Options for 2026 (Mar 3, 2026) | 3 | 2 | 4 | 1 | 4 | 2 | ? | 4 | 2 | 2 | 24/45 | fetched Oct 16 (ref bench-harvest-price-tracker-4) |
| ISU Ag Decision Maker A1-20 | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | not readable (HTTP 403, Wayback 429) |
| MSU 2026 corn cost of production tool | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | not readable (Incapsula block page saved) |
| Farm Progress, breakeven prices in budget (Oct 14, 2026) | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | not readable (HTTP 403, no archive) |

## Where we win
- **It starts from your county.** Pick a state and county, and rent and yield fill from NASS 2026 county rent and the county trend, each labeled. It then links your county's ARC/PLC page. None of the readable competitors does this. farmdoc's finest level is four Illinois regions, and Purdue's is three Indiana soil classes.
- **Live futures for both crop years, your basis, and other revenue,** plus a 36-cell what-if grid and an owned/rented split. The math was right in all four cases.
- **The fertilizer line is priced from posted co-op prices** dated Oct 6-12, with the per-pound arithmetic shown. The university budgets use January or August cost assumptions.

## Where they beat us
- **Dated 2027 cost lines (farmdoc 2027).** farmdoc projects 2027 costs line by line. It names larger increases for "fertilizers and crop insurance ... fuel and oil ... interest charges". Our 2027 option says "the cost lines below are still this page's example".
- **Expected program and insurance money in the break-even (farmdoc 2027).** farmdoc's budgets include a projected ARC/PLC payment, and for 2026 also "expectations for crop insurance proceeds". Ours has an empty other-revenue box and a link.
- **Productivity tiers with every line shown (Purdue).** Purdue has three full budgets: low, average and high soil. Each lists fertilizer, seed, pesticides, dryer fuel, machinery fuel, repairs, hauling, interest and insurance, ending at $5.68 / $5.34 / $4.94 corn. Our defaults are one "representative Upper Midwest example". The seed, chemical, machinery, labor and overhead lines have no source, and drying, hauling and interest are not split out.
- **Price sensitivity in words (farmdoc 2027).** farmdoc says "a $0.50 move in corn prices ... results in a more than $100 shift in returns." Our grid shows the same thing, but the page never says it.

## Five changes, ranked
1. **Prefill other revenue from AGSIST's own county ARC/PLC estimate when a county is picked (M).**
   - Why: farmdoc counts it, and we already publish the county number. Label it "estimate, paid on base acres, Oct of the following year" and leave it editable.
   - Honesty risk: medium. It must say it is per base acre and not certain, and show nothing where the estimate is withheld.
2. **Keep the crop year consistent (S).**
   - Why: with Dec '27 picked, the county trend should project to 2027 and say so. Rent should be labeled "2026 NASS, the newest". This fixes the low bug.
   - Honesty risk: low.
3. **Source each default cost line, or let the reader pick a dated public budget as the starting point (M).**
   - Why: give each line a source and date ("from <state> extension 2026 budget, <date>"). Or offer low, typical and high presets built from our own county yield spread, with the budget linked rather than copied. Load the presets from one data file on demand.
   - Honesty risk: medium. Never reprint a university table. Cite only the headline figures, with a link and date.
4. **Split drying, hauling and operating interest out of overhead (S).**
   - Why: these are three lines a farmer actually varies in a wet fall. Purdue lists all three. Interest can come from the same rate store-or-sell uses.
   - Honesty risk: low.
5. **One sentence of price sensitivity under the grid, computed from the reader's yield (S).**
   - Why: for example, "Each 50 cents on futures moves this field $X an acre." This is the sentence farmdoc readers remember.
   - Honesty risk: low.

## Verdict
**Close.** On total it is ahead of every competitor I could read. It is the only free tool that starts from your county's rent and trend yield, at live 2026 or 2027 futures, with the math right. It is not "yes" yet because the hero number rests on unsourced example lines for seed, chemicals, machinery, labor and overhead. In October, farmdoc's dated 2027 budgets with program money included are the better-sourced answer for Illinois.

**Change since Oct 15:** 36 to 43 (+7). The gains were local, depth, trust, unique and current. The Oct 15 competitor cells were snippet-based and are not comparable one to one.
