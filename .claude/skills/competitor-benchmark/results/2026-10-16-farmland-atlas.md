# Head to head: agsist.com/farmland-atlas (hub plus county pages), 2026-10-16

I rendered farmland-atlas.html, farmland-atlas/iowa/story-county.html and farmland-atlas/wisconsin/barron-county.html at 390 x 844 and 1280 x 800, with service worker blocked and outside hosts blocked. There was no sideways scroll and no JS errors.
- **Hub:** the first load is still 7.7 MB (atlas.json 4.5 MB plus counties.geo.json).
- **County page:** about 378 KB on load. The HTML is about 33 KB, under the 150 KB cap.

**Competitor copies** come from origin/references, fetched Oct 16:
- **ISU survey page (bench-farmland-atlas-1):** readable through its HTML. The .txt extraction is mostly empty, so I read the saved .html.
- **NASS Land Values 2026 Summary (-2):** readable, a 22-page PDF.
- **Not fetched:** FBN AcreVision, AcreValue, Acres.com and UNL had no saved copy, so they are "?". I did not reuse the Oct 15 snippet scores.

**Known bug:** drought weeks for 2024 are missing in the atlas. Another helper is fixing it, and I did not investigate it. It shows on Story County as "D2 or worse ... 2000-2025: 117 of 1,304 weeks". That is 1,304 weeks, a year short of 26 x 52 = 1,352. The "Last five years, 2020-2025" label also spans six years. I counted it under Accurate on both rows until the fix ships.

## What changed since Oct 15
- **Change #1 done: the newest public land value sits next to the 2022 census.**
  - Each county card adds the state's 2026 cropland value, for example "IA cropland 2026: $10,700 (state survey)".
  - The land value section adds state cropland with % change, farm real estate and pasture.
  - It says plainly "NASS publishes that survey by state, not by county, so this page does not scale one into the other". That is a sound choice over the derived rescale I suggested.
  - State survey links (ISU, UNL) are not added.
- **Change #3 done.** The card says "14-yr trend". Barron's card now says "rent-per-bushel trend withheld", so it no longer contradicts the yield trend.
- **Change #5 done.** The hub layers are grouped into four: Land & rent, Yield & insurance, Weather & water, Farm & programs.
- **Change #2 not done.** The hub first load is still 7.7 MB.
- **Change #4 not done.** "Coming: the Parcel Report ... It isn't built yet, and it will cost something" is still undated on the hub. It is not on county pages.

## Scores (1-5)

| | First screen | Current | Accurate+sourced | Local | Clear | Depth | Phone | Trust | Speed | Unique | Total | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **AGSIST county pages** | 5 | 4 | 4 | 5 | 4 | 5 | 4 | 5 | 5 | 5 | **46** | rendered Oct 16; hand-checked |
| **AGSIST hub (map)** | 4 | 3 | 4 | 5 | 4 | 5 | 4 | 5 | 2 | 5 | **41** | rendered Oct 16 |
| ISU Land Value Survey 2025 page | 4 | 4 | 5 | 3 | 4 | 4 | 3 | 5 | 4 | 4 | 40 | fetched Oct 16 |
| USDA NASS Land Values 2026 Summary | 2 | 5 | 5 | 1 | 3 | 3 | 2 | 5 | 2 | 2 | 30 | fetched Oct 16 (PDF) |
| FBN AcreVision county reports | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | n/a | not fetched |
| AcreValue | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | n/a | not fetched |
| Acres.com | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | n/a | not fetched |
| UNL Nebraska Farm Real Estate 2026 | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | n/a | not fetched |

**How I scored the competitors:**
- **ISU:**
  - It leads with the statewide average, $11,549 per acre (+0.7%), and the inflation-adjusted value, $8,475 in 2015 dollars (-1.8%), with the reasons.
  - Dated Dec 9, 2025, with a named contact and phone.
  - County values, % change maps, crop reporting districts, values by quality (high/medium/low) and a dollar ranking are all in linked PDFs. There are also slides and video.
  - County detail is one click away and in PDF only, for Iowa only.
- **NASS:** state and region values for farm real estate, cropland (with irrigated and non-irrigated split) and pasture, 2022-2026 with % change, released Jul 31, 2026. No counties.

## Numbers checked by hand

| Item | Page | Check | OK |
|---|---|---|---|
| IA cropland / farm real estate / pasture 2026 | $10,700 (+3.9%) / $10,100 / $3,800 | NASS PDF copy: Iowa 10,700 (3.9), 10,100, 3,800 | yes |
| WI cropland / farm real estate / pasture 2026 | $7,600 (+4.8%) / $6,700 / $3,500 | NASS PDF copy: 7,600 (4.8), 6,700, 3,500 | yes |
| Story: dry rent per bushel | $1.34 | 290 / 217.2 = 1.335 | yes |
| Story: rent share of corn gross 2025 | 33.2% | 278 / (204.0 x 4.10) = 33.24% | yes |
| Story: census change 2017-22 | +15.3%, +2.9%/yr | 10,914 / 9,467 = 1.1528; ^(1/5) = 1.0289 | yes |
| Barron: rent 2016-26 | +43.1% | 103 / 72 = 1.431 | yes |

Every computed figure matched.

| # | Finding | Severity |
|---|---|---|
| A1 | **Known bug, being fixed elsewhere:** drought 2024 is missing, so 1,304 weeks shows where 1,352 are expected, and "Last five years, 2020-2025" spans six years. | Medium (another helper) |
| A2 | **Mixed comparison on the card.** The Barron card shows "$4,336 ... land and buildings (2022) · WI cropland 2026: $7,600". A county all-land value sits beside a state cropland-only value. Barron is 65% cropland, so a farmer can read it as "my county is 43% below the state", which is not what either number says. Show WI farm real estate ($6,700, same definition as the census) on the card, or put "cropland only" in the label. | Low-medium |
| A3 | The undated "Coming: the Parcel Report ... it will cost something" box is still on the hub. | Low (trust) |
| A4 | The hub's "Highest in the US" leads with Napa, Miami-Dade and King County. Those are true values but urban-edge, and of little use to a farmer. A filter on farmland share would read better. | Trivial |

## Where we win
- **A sourced, ranked record for every US county on one page.** Rent (dry, irrigated, pasture), the census value plus the 2026 state survey, yield trend, insurance record, drought, night heat, land use and a rent calculator. ISU covers one state in PDFs. NASS stops at states.
- **The current state number, without inventing a county one.** The 2026 NASS figure sits next to the census, and the page refuses to scale them, with a clear reason.
- **Fast county pages** at about 33 KB, with the answer in the first line.

## Where they beat us, and how
- **ISU: a current county value (Iowa).** It surveys county values each November, published Dec 9, 2025, with high, medium and low quality land and % change maps. Our county figure is the 2022 census, and we do not link the ISU survey.
- **ISU: a plain lead.** One statewide number, its change and its inflation-adjusted change, with the why in two sentences. Our hub opens with a 16-layer tool and a 2022 map.
- **NASS: irrigated vs non-irrigated cropland values by state**, which we do not show.
- **Parcel-level estimates** (AcreValue, Acres, FBN) were not fetched this run, so they are not scored. They estimate a field. We do not, by design.

## Five changes, ranked
1. **Lighten the hub's first load (M).** Open on Land value with just that column and a compact topojson. Fetch other layers when tapped. That takes it from 7.7 MB to about 1 MB on a phone, which is the CLAUDE.md data-on-demand rule. Honesty risk: none.
2. **Link the state university county survey where one exists (S).** Add a dated link: ISU for Iowa, UNL for Nebraska, the Illinois society survey, K-State, UMN Land Economics, Purdue. Use a "newer county survey: <name>, <date>" line on that state's county pages, from a small per-state file. It is a link, not their data. Honesty risk: low. Keep the date and say it is theirs.
3. **Same-definition comparison on the card (S).** Put state farm real estate 2026 (land and buildings, the census definition) next to the county census value. Keep cropland in the land value section. Fixes A2. Honesty risk: none. It removes a misleading comparison.
4. **Irrigated and non-irrigated state cropland values (S).** Show them on county pages in states where NASS publishes them (the same PDF table), beside our irrigated and dry rent. Honesty risk: low. Label them state averages.
5. **Date or remove the Parcel Report box (S).** Give it a month or take it off. Honesty risk: it currently costs trust. Sig's call.

## Verdict
**Yes for the county record, close for "what is my county's land worth".** The page now carries the 2026 state survey beside the 2022 census, and every number I checked matched. A farmer in Iowa still gets a fresher county value from ISU, and the hub still costs 7.7 MB on a phone.

**Change since Oct 15:** county pages 46 to **46 (0)**, hub 41 to **41 (0)**. Current (+1 on county pages) and Clear (+1 on the hub) improved. Accurate dropped 5 to 4 on both for the known drought 2024 gap, so the totals hold until that fix ships, when both rise by 1.
