# Head to head: agsist.com/gdu-calculator

Checked Oct 15, 2026, from the read-only checkout. I rendered gdu-calculator.html at 390x844 and 1280x800. No sideways scroll, no JS errors, about 420 KB loaded. The sandbox cannot reach Open-Meteo, so I ran the live path with mocked weather: I fed the page a known daily high and low, then checked its output by hand.

**What I could not see:** I could not open any competitor host (DNS refusal). Competitor cells are from search-result text and are marked *.

## Numbers checked by hand
- **Example mode (82/58 every day, May 1 to Oct 15):**
  - Daily GDU: (82 + 58) / 2 - 50 = 20.
  - Days: 167, so 167 x 20 = 3,340. Matches.
  - Target for 108 RM: 108 x 22 + 250 = 2,626, rounded to the nearest 50 = 2,650. Matches.
- **Fetched, mid-season (84/62 every day, May 1 to Aug 1, Iowa ZIP):**
  - 93 days x 23 = 2,139 GDU. Matches.
  - Left: 511 GDU at the Wisconsin August rate of 19.5 a day is 26.2 days, so black layer lands Aug 28. The page says Aug 28, "27 days".
  - Margin to a Sep 20 freeze: 23 days. Matches.
- **BUG (high): a crop that already reached black layer gets today's date and a wrong frost verdict.**
  - Case: 84/62 every day, May 1 to Oct 14, 28°F freeze Oct 5.
  - It hit 2,650 GDU on day 116 (2,650 / 23 = 115.2), which is Aug 24.
  - The page shows "Est. black layer: October 14, 2026" and "Frost risk: 9 days short".
  - The right reading is that it reached black layer about Aug 24, 42 days before the freeze. Example mode does the same thing (3,340 GDU, matured about Sep 11, shown as Oct 15).
  - Cause: when `gduRemaining<=0` the code sets `matDate=new Date(todayD)`. October is exactly when a farmer asks "did the freeze beat black layer?", and the page tells him it did.
- **Wisconsin rates used for Iowa and Illinois (medium):**
  - `UPPER_MW` includes IA and IL, so their dates are projected at central-Wisconsin rates.
  - The page's own reference note says the central Corn Belt runs 15-20% higher. Dates for IA and IL will run late, and frost verdicts will be too pessimistic.
  - Anything not done by Sep 30 gets no date, because October counts zero.
- **No late-planting adjustment (medium):** Purdue (Nielsen et al. 2002)* says hybrids planted after about May 1 need about 6.8 fewer GDD per day of delay. The page uses the full target for a June planting, so a late-planted field looks further from black layer than it is.
- **Small inconsistency (low):** The FAQ says "a 110-day hybrid roughly 2,670". The tool rounds that to 2,650.

## Scores (1-5)

| Page | First screen | Current | Accurate/sourced | Local | Clear | Depth | Phone | Trust | Speed | Unique | Total |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **AGSIST /gdu-calculator** | 3 | 4 | 3 | 4 | 4 | 4 | 3 | 4 | 4 | 3 | **36** |
| U2U / MRCC Corn GDD tool (Purdue, Iowa State et al.)* | 3 | 4 | 5 | 4 | 3 | 5 | 3 | 5 | 3 | 4 | 39 |
| NC State Climate Office corn GDD dashboard (NC only)* | 3 | 4 | 5 | 3 | 3 | 4 | 3 | 5 | 3 | 3 | 36 |
| Pioneer (Corteva) GDU calculator* | 3 | 4 | 4 | 4 | 4 | 3 | 3 | 3 | 4 | 3 | 35 |
| Purdue Nielsen late-planting GDD calculator + articles* | 2 | 3 | 5 | 2 | 3 | 4 | 2 | 5 | 3 | 3 | 32 |

\* from search snippets only; not opened. One snippet (NOAA Climate Toolkit) says the U2U site "will not be updated", so its current upkeep is unconfirmed.

## Where we win
- **Your own daily weather since your planting date, from a ZIP.** It shows stages scaled to your hybrid, and the method and sources are on the page. There is no login and no seed brand.
- **It handles archive gaps honestly.** Missing days are counted and named, and days after the last archive day are projected, not treated as zero.

## Where a competitor beats us, and how
- **Location-specific projection and frost odds (U2U).** U2U projects the rest of the season from a 30-year climatology at your location and plots the first freeze from history*. We project at Wisconsin rates and ask you to type a freeze date.
- **Late-planting target (Purdue).** Purdue's calculator lowers the target for late planting*. We do not.
- **Hybrid-specific (Pioneer).** Pioneer looks up its own hybrids by CRM*. We use a single rule-of-thumb line, which the page says plainly.

## Five changes, ranked by impact
1. **Fix the matured-crop date (S).** Walk the fetched daily series and record the first day accumulation reaches the target. Show "Reached black layer about Aug 24", and compare the freeze with that date. Add a test for that case.
2. **Project with local normals, not Wisconsin rates (M).** Open-Meteo offers a climate/normals endpoint. Alternatively, put one 30-year daily GDU file per state in data/ and load it on demand. Then drop the "withheld outside the Upper Midwest" rule and let October count.
3. **Late-planting adjustment (S).** Subtract 6.8 GDU per day after May 1, through mid-June, labeled "Purdue (Nielsen 2002), eastern Corn Belt; did not hold in 2019".
4. **Typical first-freeze date filled in (M).** Use the station or ZIP 28°F median, labeled with its source, instead of a blank field and a regional hint.
5. **Answer above the fold on a phone (S).** After a fetch, or from a saved field, put the GDU total, stage and black-layer line above the setup form at 390 px.

## Verdict
Best on the internet today? **No, not yet.** The fetch-your-own-weather idea is good and the in-season math is right. But the October black-layer date and frost verdict are wrong for any crop that is already mature, and the projection uses Wisconsin rates in Iowa and Illinois. Once 1 and 2 are fixed, it is close to U2U, with a cleaner phone experience.
