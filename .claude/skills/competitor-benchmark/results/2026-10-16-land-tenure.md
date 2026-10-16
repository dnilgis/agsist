# Head to head: agsist.com/land-tenure (the "Who farms it: Rented, 2022" layer of /farmland-atlas)

Checked Oct 16, 2026. land-tenure.html redirects to /farmland-atlas#l=ten_rent. My local Python server turned /farmland-atlas into a directory listing, because farmland-atlas/ has no index.html. The rest of the site links /farmland-atlas the same way, so I treated this as a local-server artifact, not a site bug.

I rendered farmland-atlas.html#l=ten_rent at 390x844 and 1280x800, full page and first screen, and searched "Story, IA" to open a county card. There was no sideways scroll and no page JS errors. The page loaded about 8.3 MB: data/atlas/atlas.json is 4.4 MB, counties.geo.json 2.0 MB and tenure.json 575 KB.

Competitors were scored only from the copies GitHub Actions saved on the references branch (fetched Oct 16, 2026).

## What changed since Oct 15
- **The tenure fold now opens on #l=ten_rent.** It shows "39.3% of U.S. farmland is rented from someone else: 346 million of 880 million acres in the 2022 census. In 1997 it was 40.3%. 691 of 3,020 counties with a 2022 figure are majority-rented."
- **But the answer is still not by the legend.** On a 390 phone that line sits at about y=2,265, roughly 2.7 screens below the top. The first screen is the Atlas title, the search box and the layer tabs.

## Numbers checked by hand (data/tenure/tenure.json)
- **National, 2022:** 345,889,019 / 880,100,848 = **39.30%**. Matches. ERS (saved copy) says "Thirty-nine percent of the 880 million acres".
- **National, 1997:** 384,832,113 / 954,752,502 = **40.31%**. Matches.
- **Majority-rented counties:** 691 of 3,020 counties with a usable 2022 figure are above 50%. Matches the fold.
- **States:**
  - Iowa 49.8%, -4.1 points since 1997. Illinois 55.8%, -4.1. Alaska 69.9% on 0.6M rented acres, -7.6. Kansas 54.3%. Arizona 7.6%. All match the state table.
  - AFBF (saved copy) says "92% of acres are operated by owners" in Arizona, consistent with 7.6% rented.
- **Counties:** Story County, IA 0.549, shown as 55%, "35th highest of 99 in Iowa". Plaquemines, LA 0.981, shown as 98%. Both match.
- **No calculation errors.**

## Scores (1-5)

| Page | First screen | Current | Accurate/sourced | Local | Clear | Depth | Phone | Trust | Speed | Unique | Total | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **AGSIST tenure layer (/farmland-atlas#l=ten_rent)** | 4 | 4 | 5 | 5 | 4 | 5 | 4 | 4 | 3 | 4 | **42** | Rendered Oct 16; hand checks above |
| USDA ERS Charts of Note 109182, "Share of farmland rented holds steady at 39 percent" | 4 | 4 | 5 | 3 | 5 | 2 | 3 | 5 | 4 | 3 | 38 | fetched Oct 16 |
| farmdoc daily, "Projected Incomes on Owned vs Rented Farmland for 2026" (adjacent) | 3 | 4 | 5 | 2 | 4 | 4 | 3 | 5 | 3 | 4 | 37 | fetched Oct 16 |
| USDA ERS topic, Farmland Ownership and Tenure | 3 | 3 | 5 | 2 | 3 | 4 | 3 | 5 | 3 | 4 | 35 | fetched Oct 16 |
| AFBF Market Intel, "Agricultural Land: To Own or To Rent?" | 3 | 4 | 4 | 2 | 4 | 3 | 3 | 4 | 2 | 4 | 33 | fetched Oct 16 |
| ISU / CARD (registered as the Iowa tenure survey) | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | not readable as a tenure source: the saved URL is the CARD Farmland Portal home (land values), with no tenure content |

Notes on the cells:
- **ERS Chart of Note:**
  - Dated 5/22/2024. That is still the latest census.
  - The headline is the answer. The county map is a static image.
  - It adds: "more than half the cropland ... is rented, but just over a quarter of pastureland", and "68 percent of rented farmland is on operations with 2,000 acres or more".
- **ERS topic:**
  - Updated 2/13/2026, but the substance is the 2014 TOTAL survey.
  - Landlord facts: 80% of rented land is owned by non-operator landlords, 38% of those are retired farmers, and 41% of acres have had the same tenant for over 10 years.
- **AFBF:**
  - Dated Jan 9, 2025 (datePublished in the saved HTML).
  - Tenure class shares: full owners about 312M acres, part owners 52%, tenants under 10%.
  - Rented share by crop: 53% of oilseed/grain harvested acres, cotton 49% in 2022.
  - No county or state table.
- **farmdoc:** worked central-Illinois math. Debt-free owned land returns $232/ac and cash-rented land returns -$15/ac, so one owned acre offsets 15 rented. I checked 232/15 = 15.5 and 182 x 375 - 15 x 1,125 = $51,375: both right.

## Where we win
- **Every county, every state ranked with change since 1997, and the national line, free and in one place.** It sits beside the same county's rent, value and yield. No saved competitor has a county figure you can look up: ERS's map is an image, and AFBF and farmdoc have no county data.
- **Honest scope.** It explains what "rented from others" means, and that county history is shown only for 2022 because older county files do not add up.

## Where they beat us, and how
- **Cropland vs pasture (ERS).** ERS says "more than half the cropland ... is rented, but just over a quarter of pastureland". That explains the map, and we do not show it.
- **Who the landlords are (ERS topic, TOTAL).** ERS gives non-operator landlord share (80%), retired farmers (38%), tenure length, and how land is acquired (inheritance). The census cannot give this. We do not link it.
- **What tenure does to income (farmdoc).** farmdoc works out a projected -$15/ac on cash-rented vs +$232/ac on debt-free owned central-Illinois ground. Our layer says how much is rented, but not what that means for a farm's income.
- **Tenure by crop and tenure class (AFBF).** AFBF splits rented share by crop (53% grain and oilseed) and gives the full-owner, part-owner and tenant shares. We have only the rented share.

## Bugs found
- **Low: tenure.json is requested twice.** The Atlas core loader (farmland-atlas.html line 956) and components/atlas-tenure.js (line 82) both fetch /data/tenure/tenure.json. Locally both returned 575 KB bodies. On the live site the second may come from the HTTP cache. Worth one shared promise.
- **Low: the national answer is still not on the first screen** of the redirect target. See change 1.
- **No calculation errors.**

## Five changes, ranked
1. **Show the national line by the legend when l=ten_rent.**
   - What: "39.3% of U.S. farmland is rented (2022 census), 40.3% in 1997", right under the legend.
   - Effort: S.
   - Why: the redirect page promises it, and ERS leads with it. Today it is 2.7 phone screens down.
   - Honesty risk: none. The numbers are checked above.
2. **A county card line comparing the county with its state and the US.**
   - What: "55% rented; Iowa 50%; US 39%".
   - Effort: S.
   - Why: the card gives ranks but no reference shares. A farmer reads the comparison faster than "35th of 99".
   - Honesty risk: none.
3. **A cropland vs pasture rented share, national and state, from the 2022 census tenure tables where published, loaded with the tenure fold.**
   - Effort: M.
   - Why: it is ERS's key explanatory fact and absent here.
   - Honesty risk: medium. Use only published census cells, and label suppressed (D) values as missing.
4. **"Who the landlords are" links.**
   - What: link the ERS TOTAL survey (2014) and ISU's Iowa tenure survey, with the survey year stated.
   - Effort: S.
   - Why: it answers the question the census cannot.
   - Honesty risk: low. Say plainly that TOTAL is from 2014.
5. **Fetch tenure.json once (one shared promise).**
   - Effort: S.
   - Why: up to 575 KB saved on a page that already loads 8.3 MB.
   - Honesty risk: none.

Also: fix the registry entry for "ISU Iowa Farmland Ownership and Tenure survey". It points at the CARD Farmland Portal home, which has no tenure content. Find and pin the survey's own URL before the next fetch.

## Verdict
Best on the internet today? **Yes.** Among the copies I could read, no other free page gives county, state and national rented shares together, with history and honest caveats, and every number I checked matched. ERS still states the national answer faster, and explains it better with the cropland vs pasture split.

**Total: 42, unchanged from Oct 15.** The fold opening is an improvement, but the answer is still below the first screen. Oct 15 competitor totals came from snippets, so competitor columns are not comparable between runs.
