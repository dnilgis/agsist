# Head to head: agsist.com/land-tenure (now the "Who farms it: Rented, 2022" layer of /farmland-atlas)

Checked Oct 15, 2026, from the read-only checkout. land-tenure.html redirects to /farmland-atlas#l=ten_rent. I rendered farmland-atlas.html#l=ten_rent at 390x844 and 1280x800 and opened the "Rented vs owner-farmed, 1997 to 2022" fold. No sideways scroll and no JS errors. The county map drew from local files. The Atlas as a whole has its own report (2026-10-15-farmland-atlas.md). This one scores the tenure layer against tenure sources.

**What I could not see:** I could not open any competitor host (DNS refusal). Competitor cells are from search-result text and are marked *.

## Numbers checked by hand
- **National:**
  - 2022: 345.9 / 880.1 = **39.3%**. 1997: 384.8 / 954.8 = **40.3%**. Both match.
  - USDA ERS headline: "Share of farmland rented holds steady at 39 percent" (2022 Census).* Matches.
- **States:**
  - Iowa: 14.9 / (14.9 + 15.0) = 49.8%. Matches.
  - Illinois: 14.7 / 26.3 = 55.9%; the page shows 55.8%, a rounding difference in the displayed acres. Fine.
  - Oregon: 29.4% against an Oregon State figure of 29%.* Matches.
- **Counties** (farmland-atlas/data/counties.csv): Story County, IA 0.5495, shown as 55%. Plaquemines, LA 0.9806, shown as 98%. Both match the map.
- **No math errors.**
- **Caveats are honest.** "Rented from others is what farms reported; the census does not say where the landlord lives." Small states can show big shares on few acres (Alaska tops the state list at 69.9% on 0.9M acres).

## Scores (1-5)

| Page | First screen | Current | Accurate/sourced | Local | Clear | Depth | Phone | Trust | Speed | Unique | Total |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **AGSIST tenure layer (/farmland-atlas#l=ten_rent)** | 4 | 4 | 5 | 5 | 4 | 5 | 4 | 4 | 3 | 4 | **42** |
| USDA ERS Charts of Note, 2022 rented share with county map* | 4 | 4 | 5 | 4 | 4 | 2 | 3 | 5 | 4 | 3 | 38 |
| ISU Iowa Farmland Ownership and Tenure survey (Iowa only)* | 3 | 3 | 5 | 3 | 3 | 5 | 2 | 5 | 3 | 4 | 36 |
| USDA ERS topic page, Farmland Ownership and Tenure* | 3 | 3 | 5 | 3 | 3 | 4 | 3 | 5 | 3 | 3 | 35 |
| AFBF Market Intel, "Agricultural land: to own or to rent?"* | 4 | 3 | 4 | 3 | 4 | 3 | 3 | 4 | 4 | 3 | 35 |

\* from search snippets only; not opened.

## Where we win
- **Every county on a map, every state ranked with its change since 1997, and the national line, all in one place.** It sits beside the same county's rent, land value and yield.
- **Honest about the census.** It says 2022 only at county level, because the older county files do not add up to state totals (IL 19.3M vs 27.0M in 2017). It says what "rented" does and does not mean.

## Where a competitor beats us, and how
- **The answer is not on the first screen of the redirect.** The old page promised "the national trend since 1997 and every state ranked". The redirect lands on the map with "Rented, 2022" picked, and the "39.3% of U.S. farmland is rented" answer sits in a closed fold far below. ERS leads with the 39% line.*
- **Cropland vs pasture (ERS).** ERS says more than half of cropland is rented but only about a quarter of pasture.* That explains why grain states rank high, and we do not split it.
- **Who the landlords are (ISU, ERS TOTAL).** Surveys cover landlord age, residence and how ground changes hands.* The census cannot. We could link ISU's survey for Iowa.

## Five changes, ranked by impact
1. **On #l=ten_rent, show the national line by the legend and open the tenure fold (S).** Show "39.3% of U.S. farmland is rented (2022 census), 40.3% in 1997". That keeps the promise the redirect page makes.
2. **Cropland vs pasture split, where the census has it (M).** Show at least the national and state numbers, from the 2022 census tenure tables, labeled.
3. **"Owned vs rented" in the county card (S).** Add a one-line share with the state and US comparison next to the county's cash rent: "55% rented; Iowa 50%; US 39%".
4. **Link the landlord surveys (S).** ISU for Iowa, ERS TOTAL nationally, as "who the landlords are".
5. **Keep the redirect (none).** It works. Consider noindex on the stub, as presell-calculator has.

## Verdict
Best on the internet today? **Yes.** No other free page I found gives county, state and national rented shares together, with history and honest caveats, and every number I checked matched. The one fix is to put the national answer where the redirect lands.
