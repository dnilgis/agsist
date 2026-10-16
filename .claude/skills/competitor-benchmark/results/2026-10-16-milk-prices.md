# Head to head: agsist.com/milk-prices

Checked Oct 16, 2026, from the read-only checkout. I rendered milk-prices.html at 390x844 and 1280x800. No sideways scroll and no JS errors (one blocked outside call). The HTML is 144 KB, and the phone page is about 15,600 px long (15,400 on Oct 15).

What the page shows:
- Class prices and components: September 2026, USDA AMS.
- All-milk and DMC: August 2026, NASS.
- Mailbox price: June 2026, $20.18, from AMS report 3357. This was March on Oct 15.
- Class III futures: Oct 15 closes. Oct $15.20, Nov $17.25, Dec $17.36, Jan $17.33.

Competitors were scored only from the copies GitHub Actions fetched on Oct 16 (references branch, ids bench-milk-prices-1..7). I did not render them, so phone is "?" and their totals are out of 45. CME Group (bench-milk-prices-4) was not fetched because it is an app-only quote page, so its cells are "?" (not readable). Two saved copies are not the article in the competitor list:
- The Center for Dairy Excellence link resolved to its Sep 9, 2026 "Dairy Week in Review".
- The agproud URL saved Progressive Dairy's news hub. That copy carries an Oct 15, 2026 item on the September uniform price.

## Numbers checked by hand (no errors)
- **Class III, September:**
  - Skim = protein $2.6619 x 3.3 + other solids $0.4147 x 6.0 = $11.2725, rounded to $11.27.
  - Class III = 0.965 x $11.27 + butterfat $1.4762 x 3.5 = $10.8756 + $5.1667 = **$16.04**.
  - Matches the page, the AMS copy and the FMMA Central copy.
- **Class IV, September:** nonfat solids $1.5343 x 9.3 = $14.269, rounded to $14.27. Then 0.965 x $14.27 + $5.1667 = **$18.94**. Matches.
- **Month changes:**
  - Class III $16.64 to $16.04 is -$0.60. Class IV $17.36 to $18.94 is +$1.58. Class II $18.71 to $17.60 is -$1.11.
  - All match the AMS 2026 table.
- **Product averages vs August:**
  - Cheese $1.5577 - $1.6203 = -6.3¢. NFDM $1.7891 - $1.5985 = +19.1¢.
  - Butter $1.4462 - $1.4747 = -2.9¢. Whey $0.6694 - $0.6602 = +0.9¢.
  - All match.
- **Mailbox, June 2026:**
  - All Federal Order Areas $20.18. May 2026 was $20.43, a change of -$0.25. June 2025 was $20.55, a change of -$0.37.
  - Matches data/dairy-raw/ams-mailbox.txt (AMS, Sep 23, 2026).
- **DMC and the 100-cow example:**
  - DMC: $19.80 - $10.46 = $9.34.
  - Example: 2,170 cwt x $19.80 = $42,966, minus 2,170 x $19 = $41,230, leaves $1,736.
  - Both match.
- **State gap:** Georgia $25.40 - Kansas $17.30 = $8.10. Matches.
- **Oct 15 open item, the futures feed:**
  - prices.json no longer lists milk in stale_keys.
  - The Nov contract (DCX26) closed $17.25 on Oct 15 and trades $17.49 on Oct 16. The continuous series rolled to the same $17.49.
  - Two Yahoo series agree, but no CME settlement copy was fetched, so this is still not checked against CME.

## Scores (1-5)

| Page | First screen | Current | Accurate/sourced | Local | Clear | Depth | Phone | Trust | Speed | Unique | Total | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **AGSIST /milk-prices** | 4 | 5 | 5 | 3 | 3 | 5 | 3 | 5 | 3 | 5 | **41/50** | rendered Oct 16 |
| FMMA Central, Central Order 32, Sep 2026 class prices (cp2609.pdf) | 3 | 5 | 5 | 3 | 3 | 3 | ? | 5 | 4 | 3 | 34/45 | fetched Oct 16; released Sep 30, 2026 |
| USDA AMS Announcement of Class and Component Prices (dymclassprices.pdf) | 3 | 5 | 5 | 1 | 3 | 4 | ? | 5 | 4 | 3 | 33/45 | fetched Oct 16; CLS-0926, Sep 30, 2026 |
| USDA AMS Class III and IV history (dymaclassiii.pdf) | 3 | 3 | 5 | 1 | 4 | 3 | ? | 5 | 4 | 2 | 30/45 | fetched Oct 16; released Sep 2, 2026, Sep shows #N/A |
| Progressive Dairy (agproud.com), news hub as saved | 2 | 5 | 4 | 1 | 3 | 1 | ? | 3 | 2 | 3 | 24/45 | fetched Oct 16; requested Feb article not in copy |
| Center for Dairy Excellence, Sep 9, 2026 week in review | 3 | 2 | 3 | 1 | 4 | 1 | ? | 4 | 3 | 2 | 23/45 | fetched Oct 16; 781-byte summary |
| Dairy Herd (Farm Journal), "Class III Futures Stay in the Mid $19s" | 3 | 1 | 3 | 1 | 3 | 1 | ? | 3 | 2 | 1 | 18/45 | fetched Oct 16; article dated Dec 16, 2021 |
| CME Group Class III/IV futures | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | not readable (app-only, not fetched) |

Notes on the copies:
- **FMMA Central:**
  - Gives the order's Class I price at its location ("$3.20 Location Adjustment @ Jackson County (MO) ... $20.24 /cwt"), the ESL adjustment and the advanced pricing factors.
  - Also gives the weekly NDPSR product prices behind the month: butter $1.4723, $1.4907, $1.4412, $1.3871; weighted monthly average $1.4462.
- **AMS CLS-0926:**
  - Same September figures as ours, plus 2025 and 2026 monthly tables for every class and component, and the formulas.
  - Also prints the October Class I/II product averages (cheese $1.5598, butter $1.4678).
- **AMS history:** five years of Class III and IV by month in one table (2022 to Aug 2026).
- **CDE:** "August's Class III price landed at $16.61 per cwt, up $1.12 from July's $15.52". AMS has August at $16.64, and $15.52 + $1.12 = $16.64, so the CDE figure is a typo on their side.
- **Progressive Dairy (Oct 15, 2026):** "The average uniform milk price across the 11 Federal Milk Marketing Orders (FMMOs) was at $18.98 per hundredweight (cwt) last month, down 78 cents from August."
- **Dairy Herd:** a 2021 market wrap. The URL in the competitor list is stale.

## Where we win
- **The whole check, built from this month's real numbers.** It walks from cheese, whey and butter to components, then the class price, then blend, PPD and hauling, and finally the mailbox. It has a sandbox to move prices. No copy does this. AMS prints the formulas but not the walk.
- **Every figure dated and current to its source:** class and component prices for September, all-milk for August and mailbox for June. Mailbox is now the newest AMS month, not March.
- **Cost side and tools:** the DMC margin, a farm-sized example, and DRP, DMC and forwards each with the catch spelled out. AGSIST sells none of them.
- **Says which way the gap runs this month.** It says Class IV is $2.90 over Class III, the reverse of the trap it explains. That was Oct 15's change 3, and it is done.

## Where they beat us, and how
- **The uniform (blend) price (Progressive Dairy).** They report September's federal order uniform average, $18.98, on Oct 15. Our page shows "varies/cwt" on the blend and PPD rows, and its newest pay-side figure is June's mailbox. The uniform price is one month behind; the mailbox is three.
- **Order-specific prices (FMMA Central).** The market administrator gives the order's own Class I price at its location, the PPD inputs and the weekly product prices. Our page is national.
- **History in one table (AMS).** AMS shows five years of Class III and IV by month. We show this month and last month.
- **A gap in local data (from our own data, not a competitor).** The AMS mailbox report we already download lists June by area: Wisconsin $18.13, Minnesota $18.04, Iowa $18.29, Florida $27.59. The page shows only the $20.18 national average, which is about $2 above what an Upper Midwest shipper got.

## Bugs found
- **No math errors.**
- **Low:** the futures table's "Change, last session" column is "-" for every contract. Milk contracts carry no settles in prices.json, so the column is always empty. Fill it or drop it.
- **Low (open):** the Class III futures still have no CME settlement cross-check (see above).
- **Note:** at 144 KB the HTML is close to the 150 KB cap that applies to generated sets. This page is not in a generated set, but it is heavy for one page.

## Five changes, ranked
1. **Mailbox price for my area.**
   - What: a picker (or a short table) of the AMS mailbox price by reporting area, read from the report we already fetch (data/dairy-raw/ams-mailbox.txt), with month, year-ago and the national average beside it.
   - Why: the national $20.18 overstates Wisconsin ($18.13) and Minnesota ($18.04) by about $2/cwt. This is the one number a dairy farmer banks, and local is our lowest score.
   - Effort: S. Honesty risk: low. Label each area as AMS defines it, and say some areas are groups of states.
2. **Uniform price and PPD for the latest month, by order.**
   - What: replace "varies/cwt" on the blend and PPD rows with each order's announced uniform price and PPD, read from the market administrators' monthly announcements, dated and linked. Load the by-order table on demand.
   - Why: it is one month behind (mailbox is three), and it is what fills the gap between the class price and the check.
   - Effort: M. Honesty risk: low. Show a dash for any order not read.
3. **Component check estimator.**
   - What: inputs for fat, protein and other solids tests, the order's PPD and hauling. Multiply by this month's component prices. Load it on demand.
   - Why: most federal-order farmers are paid on components. No copy turns component prices into a check.
   - Effort: M. Honesty risk: medium. It is an estimate, so say it leaves out co-op premiums and deductions the reader does not enter.
4. **Class IV futures and a working change column.**
   - What: add Class IV contracts beside Class III. Fill "change, last session" from two finished closes, or drop the column.
   - Why: Class IV is $2.90 over Class III this month, so it matters for the blend. An all-dash column looks broken.
   - Effort: S. Honesty risk: low. Keep "not CME settlements".
5. **Shorter phone page plus a 5-year class table on demand.**
   - What: collapse "What changed in 2025" and "Background" behind toggles. Add a Class III/IV by-month table for 5 years that loads from data/dairy-history.json when opened.
   - Why: the page is 15,600 px on a phone, and AMS's history table is the one depth item we lack.
   - Effort: S. Honesty risk: none.

## Verdict
**Close.** It is still the only free page that builds the milk check from this month's USDA numbers, and every figure checks. The mailbox is now current to AMS. What it lacks is the farmer's own number: the mailbox for his area (already in our raw data) and his order's uniform price and PPD.

## Change since Oct 15
40 to 41 (+1). Current went from 4 to 5: the mailbox moved from March to June (the newest AMS month), and the milk futures are no longer flagged stale. The Oct 15 change 3 (which way the gap runs) is done. Changes 1 (current mailbox, partly), 2 (futures cross-check), 4 and 5 are open. Competitor totals are not comparable with Oct 15: those were from search snippets out of 50; these are from fetched copies out of 45.
