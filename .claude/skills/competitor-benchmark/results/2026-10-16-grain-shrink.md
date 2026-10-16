# Head to head: agsist.com/grain-shrink (first benchmark)

Checked Oct 16, 2026. I rendered grain-shrink.html (38 KB, plus 30 KB of script) at 390x844 and 1280x800 in five states:
- the defaults
- "Example: wet corn, 20.5%"
- "Example: beans at 10%"
- ZIP 54728, with bids from the local dnilgis/bids copy of Oct 16 01:47 UTC
- state = Iowa, with no ZIP

There was no sideways scroll and no page errors. The grain-shrink tests pass, 17/17. The page is new on Oct 16, so there is no Oct 15 score.

**Competitors.** I scored them only from the copies GitHub Actions saved on Oct 16 (references branch). Phone is "?" for every competitor because I did not render them, so their totals are out of 45. Coverage of the six:
- **Read (2):** the Purdue Pest&Crop article (-3) and Iowa State ICM "Options for Fall Grain Drying and Marketing", Oct 20, 2022 (-5).
- **Could not read (4):**
  - UW-Madison "Determining Grain Shrinkage Rates": the saved copy redirected to the Extension home page.
  - Iowa State Ag Decision Maker A2-32: HTTP 403, and the Wayback Machine returned 429.
  - SDSU "Corn grain moisture discount": not in the fetch index.
  - University of Kentucky shrink calculator: no URL was found.

## Numbers checked by hand (all match)
- **Water shrink per point:**
  - 100 / 84.5 = 1.1834 (base 15.5)
  - 100 / 85 = 1.1765 (base 15)
  - 100 / 86 = 1.1628 (base 14)
  - 100 / 86.5 = 1.1561 (base 13.5)
  - 100 / 87 = 1.1494 (base 13)
  - The table shows 1.183, 1.176, 1.163, 1.156 and 1.149.
- **25% corn dried to 15.5%:**
  - 9.5 / 84.5 = 11.24%.
  - Plus 0.5 handling = 11.74%. At a 1.3 factor: 12.35%.
- **28% corn:**
  - Water is 12.5 / 84.5 = 14.79%.
  - A 1.25 factor is 15.625%, which builds in 0.83% of handling loss.
  - A 1.4 factor is 17.5%, which builds in 2.71%.
- **Default load (20% corn, 56,000 lb, 1.4%/pt):**
  - 4.5 x 1.4 = 6.30%, so 1,000 wet bu leaves 937.0 dry.
  - Water is 5.33%. Handling is 0.97%.
- **ZIP 54728:**
  - The nearest bid is CDR Farms, Bloomer, $4.14.
  - 937 x 4.14 = $3,879.18, so $3.88 a wet bushel, 26¢ under the bid.
  - 63 bu x 4.14 = $261 of shrink.
- **State default, Iowa:**
  - Dec '26 at 474.25 less the Iowa median of 40¢ (219 elevators) = $4.3425, shown as $4.34.
  - 937 x 4.34 = $4,067.
- **Overdry soybeans:**
  - 10%: 1,000 x 90 / 87 = 1,034.5 bu; 60,000 lb x 90 / 87 = 62,069 lb; 3.3% not paid for.
  - 9%: 1,046 bu, 4.4%. 8%: 57.5 bu per 1,000, 5.4%.
- **Overdry corn, 13%:** 87 / 84.5 gives 29.6 bu per 1,000, 2.9%.
- **Nebraska example:** 75 x 87 / 91 = 71.70, so 3.3 bu an acre fewer, or $33 an acre at $10.
- **Iowa State 2019 example in the FAQ:**
  - Sold wet: 923 bu x $3.50 = $3,230.50, less a $264 drying charge = $2,966.50, shown as $2,967.
  - Dried on the farm: 56,000 x 79.5 / 85 = 52,376 lb, less 560 lb handling = 925.3 bu x $3.50 = $3,238.50, less $165 and $40 = $3,033.
  - I could not read the 2019 source itself, so the inputs are checked only for consistency.

## Bugs found
1. **Low: an intraday quote is labeled "settle".**
   - The state default reads "Dec '26 futures $4.74 (settle Oct 16)".
   - data/prices.json was fetched at 15:01 UTC (10:01 am CT), mid-session. Its corn-dec26 close of 474.25 carries close_date 2026-10-16, while its recorded settles stop at Oct 15 (478.25).
   - So the $4.74 is a live price, not a settle.
   - Fix: say "futures $4.74 at 10:01 am CT" when the session is open. Say "settle" only when the quote is the recorded settle.
2. **Low, consistency: the ZIP bid is the elevator's posted cash, while /cash-bids re-marks day-old boards to today's futures.**
   - This page used CDR Farms at $4.14, posted Oct 15 at 8:40 pm. /cash-bids showed the same board's corn as posted $4.14, and would re-mark it to about $4.09.
   - The label says "Posted Oct 15, 8:40 PM CT", so this is honest, but the two pages give different numbers for one bid.

## Scores (1-5)

| Page | First screen | Current | Accurate/sourced | Local | Clear | Depth | Phone | Trust | Speed | Unique | Total | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **AGSIST /grain-shrink** | 4 | 5 | 4 | 5 | 4 | 4 | 4 | 5 | 5 | 5 | **45/50** | rendered Oct 16 |
| Iowa State ICM, Options for Fall Grain Drying and Marketing (Oct 2022) | 3 | 2 | 4 | 1 | 4 | 4 | ? | 5 | 4 | 4 | 31/45 | fetched Oct 16 |
| Purdue Pest&Crop, Converting Wet Corn Weight to Dry | 3 | 2 | 5 | 1 | 4 | 2 | ? | 4 | 4 | 2 | 27/45 | fetched Oct 16 |
| UW-Madison Extension, Determining Grain Shrinkage Rates | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | not scored | fetched Oct 16: redirected to the Extension home page, not readable |
| SDSU Extension corn moisture discount | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | not scored | not in the Oct 16 fetch |
| Iowa State Ag Decision Maker A2-32 | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | not scored | fetch failed (403; Wayback 429) |
| University of Kentucky shrink calculator | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | not scored | no URL found |

**What our score rests on:**
- **First screen 4:**
  - At 1280 the answer card ("1,000 wet bushels shrink to 937 dry bushels") is on the first screen.
  - At 390 the inputs and ZIP box fill it, and the answer starts below the fold.
- **Accurate 4:** bug 1.
- **Depth 4:**
  - It has show-the-math, the per-point table, overdry tables, per-acre figures and the elevator's own drying-charge table.
  - It has no "dry it on the farm" side of the comparison.

**What the competitor scores rest on:**
- **Iowa State (Oct 2022):** it works three options side by side on 1,000 bu of 20% corn at $6.50:
  - sold wet with a 2% per point price discount
  - sold wet with a drying charge plus a shrink factor
  - dried on the farm, with a propane rule of thumb per bushel per point, a drying cost and hauling
  - It adds an allowable-storage-time table and names three authors. The prices are 2022's.
- **Purdue:**
  - It gives the wet-to-dry weight method with one worked example and cites NCH-61.
  - It explains that buyers do not pay for water under 15%.
  - It has no drying charge, no handling factor and no tool. The references were last accessed Sep 2020.

## Where we win
- **We work it for the farmer's load, and with a real bid.**
  - The farmer enters a moisture and a scale weight. The page uses the nearest posted elevator bid for the ZIP, or the state median basis on futures, labeled as an estimate.
  - Iowa State and Purdue work one fixed example each.
- **We show what the elevator's factor costs.** The page splits a flat factor into water and implied handling loss, for example "Of that 6.30%, water is 5.33% and the rest, 0.97%, is handling loss the factor assumes". It then compares that with the measured handling-loss ranges. Neither copy read does this.
- **Both directions.** Wet grain into town, and overdry beans or corn under base, with tables per 1,000 bu and per acre.
- **The elevator's own discount table.** It is entered as moisture bands with flat cents, the way a scale-ticket sheet is printed.
- **It is fast.** 38 KB of page, and the tables and math work without JavaScript.

## Where they beat us
- **Drying it yourself (Iowa State).**
  - Iowa State prices the on-farm side next to the elevator side: propane use per bushel per point removed, a drying cost per bushel per point, hauling per bushel per mile, and handling loss. It then nets all three options.
  - Our calculator only nets the elevator side. The FAQ quotes Iowa State's 2019 numbers but does not let the farmer run their own.
- **Price discount as a method (Iowa State).** Iowa State works "2.0% for each moisture point above 15%" taken off the price. Our page tells the farmer to enter it as a flat shrink factor (FAQ). That gives the same dollars, but it is a workaround the farmer has to read about.
- **Storage time for wet corn (Iowa State).** Iowa State prints allowable storage days by grain temperature and moisture next to the decision. We do not cover holding wet corn.

## Five changes, ranked
1. **Add a "dry it myself" column (M).**
   - What: the farmer enters fuel price, gallons per bushel per point (default left blank, with a sourced typical range shown as a hint), electricity, hauling miles, and handling loss (default 1%, already cited). The page shows net per wet bushel for the elevator and for the farm side by side.
   - Why: "sell wet or dry it myself" is the decision behind most shrink searches, and it is the one place a readable competitor out-answers us.
   - Honesty risk: medium if a fuel-use default is presented as the farmer's number. Show the range from the primary source as a hint, not a value.
2. **Make "% off the price per point" its own option (S).**
   - What: add a third shrink method so a farmer can copy their discount sheet as written, and print the equivalence the FAQ already explains.
   - Why: buyers that discount the price are common, and the workaround hides it.
3. **Put the answer on the first phone screen (S).**
   - What: at 390 px, move the verdict line directly under Moisture/Base/Load/Bid, put the ZIP box after the answer, and keep a one-line sticky result while the farmer edits the elevator settings.
4. **Fix the "settle" label (S).**
   - What: name the quote time while the market is open, and say "settle" only for the recorded settle (bug 1).
   - Also decide whether the ZIP bid should be re-marked like /cash-bids, or keep posted with its time (bug 2), and do the same on both pages.
5. **Allowable storage time for wet grain on demand (M).**
   - What: a "holding it wet?" fold that reads a small data file of allowable storage days by temperature and moisture from the primary source (the ASABE/MWPS tables, not Iowa State's copy), and links to /grain-emc for the fans.
   - It stays out of the page HTML.
   - Honesty risk: low, if the source table and its conditions (clean corn, damage level) are printed with it.

## Verdict
**Yes, against the copies that could be read.**
- Score: 45/50. Best readable competitor: Iowa State at 31/45.
- There is no Oct 15 score to compare with; this is the first run.
- What keeps it from beyond doubt:
  - The UW-Madison, SDSU, A2-32 and Kentucky tools could not be read.
  - Iowa State's on-farm drying comparison is a real gap.
