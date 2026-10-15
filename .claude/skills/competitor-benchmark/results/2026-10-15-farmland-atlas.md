# Head to head: agsist.com/farmland-atlas (hub plus county pages)

Checked Oct 15, 2026, from the read-only checkout. I rendered farmland-atlas.html, farmland-atlas/wisconsin/barron-county.html and farmland-atlas/iowa/story-county.html at 390x844 and 1280x800. No sideways scroll, no JS errors. Page weight on load:
- **Hub:** 7.7 MB uncompressed. That is the 213 KB page, atlas.json at 4.5 MB, counties.geo.json at 2.0 MB and tenure.json at 575 KB.
- **County page:** about 370 KB total, with each HTML file about 33 KB, well under the 150 KB cap.

**What I could not see:** I could not open any competitor host. Competitor cells come from search-result text and are marked *. FBN AcreVision county reports are behind a sign-in according to search.

## Numbers checked by hand (data/cash-rent, data/atlas)
- **Barron County, WI:**
  - Rent: $103 non-irrigated (2026), WI median $136, tied 17th lowest of 68. $72 in 2016 to $103 is +43.1%. Irrigated $216, pasture $31.
  - Corn yield: the 2021-25 average with the high and low dropped is (155.9 + 160.0 + 167.3) / 3 = 161.1. The 2008-2025 median is 151.9.
  - Rent ÷ value: the 2022 dry rent of $95.50 rounds to $96, and $96 / $4,336 = 2.2%.
  - All match.
- **Story County, IA:**
  - Rent: $290, tied 18th highest of 99. $230 in 2016 to $290 is +26.1%. The 2022 rent of $266 / $10,914 = 2.44%.
  - The trend fit on 2012-2025 gives 217.2 bu for 2026 and the fit on 2008-2025 gives +3.1 bu a year. Both match the page.
- **Wording issues (low):**
  - "15-yr trend" is fitted on 14 years (n=14 in the data).
  - Barron's top card says "trend withheld: county yield mixes irrigated and dryland acres", but its own narrative and corn section print a +2.0 bu/yr trend. The withheld item is the rent-per-bushel trend, and the card should say that.
- **Currency issue (medium):** the land value layer, its cards and rankings are the **2022 Census** (operators' estimate of land plus buildings). The page labels this well. But the NASS Land Values 2026 Summary (Jul 31, 2026: Iowa cropland $10,700, Illinois $10,200) and the ISU 2025 county survey (Dec 9, 2025: Iowa $11,549) are newer. Neither appears anywhere on the site. A reader asking "what is land worth in my county" gets a number four years old.

## Scores (1-5)

| Page | First screen | Current | Accurate/sourced | Local | Clear | Depth | Phone | Trust | Speed | Unique | Total |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **AGSIST Farmland Atlas county pages** | 5 | 3 | 5 | 5 | 4 | 5 | 4 | 5 | 5 | 5 | **46** |
| **AGSIST Farmland Atlas hub (map)** | 4 | 3 | 5 | 5 | 3 | 5 | 4 | 5 | 2 | 5 | **41** |
| ISU Land Value Survey portal (Iowa counties, Dec 2025)* | 4 | 4 | 5 | 4 | 4 | 4 | 3 | 5 | 4 | 4 | 41 |
| USDA NASS Land Values 2026 Summary (states)* | 2 | 5 | 5 | 1 | 3 | 2 | 2 | 5 | 3 | 2 | 30 |
| FBN AcreVision county farmland value reports (model, sign-in)* | 4 | 5 | 2 | 5 | 4 | 3 | 4 | 3 | 3 | 3 | 36 |
| AcreValue (parcel AVM + comps, freemium)* | 4 | 4 | 3 | 5 | 3 | 4 | 3 | 3 | 3 | 4 | 36 |
| Acres.com (parcel, comps, ownership)* | 3 | 4 | 3 | 5 | 3 | 4 | 3 | 3 | 3 | 4 | 35 |
| FCSAmerica / Farmers National land value pages (own transactions)* | 3 | 4 | 3 | 4 | 4 | 2 | 4 | 3 | 4 | 3 | 34 |
| UNL Nebraska Farm Real Estate survey 2026 (regions)* | 3 | 5 | 5 | 2 | 4 | 4 | 3 | 5 | 4 | 3 | 38 |

\* from search snippets only; not opened.

## Where we win
- **One public-record page per county, for every county in 50 states.** Each has rent (dry, irrigated, pasture), land value, yield record, insurance loss record, drought weeks, July night heat, CRP, wells, tile, no-till, cattle and neighbors. All of it is sourced, dated and ranked within the state, with CSV and a citation. ISU covers one state, NASS stops at states, and FBN and AcreValue are model estimates behind sign-ins and sales funnels.
- **Honest labels.** "What operators guessed land and buildings were worth", "not an appraisal of any farm", and "a zero is no report, not proof of no hail". The partial-year drought bug was fixed this week (e-group audit).
- **The county pages are fast and ready for search.** About 33 KB each, with the answer in the first line (rent and value, then FIPS and date).

## Where a competitor beats us, and how
- **Current land value (ISU, NASS, UNL).** ISU gives every Iowa county's value as of Nov 2025, with high, medium and low land. NASS gives 2026 state cropland and pasture values. We lead with 2022.
- **A value for this parcel (AcreValue, Acres, FBN).** They estimate a field from soils and comparable sales. That is not something the public record supports, and the planned "Parcel Report" waitlist is undated.
- **Simplicity on the hub (ISU portal).** Ours has 16 layer tabs plus sub-tabs and a 7.7 MB first load on a phone. ISU's map shows one thing.

## Five changes, ranked by impact
1. **Put the newest public land value next to the 2022 census (S-M).** On every county card, add "State cropland, NASS 2026: $10,700 (+3.9%)". It is public domain, one number per state, so it is a few bytes per page. Rescale the county census value by the state's change since 2022, labeled "derived: 2022 census value x state change since", and keep the census number as the record. Link the state university survey where one exists (ISU, UNL, Illinois ISPFMRA, K-State, UMN Land Economics) with its date. This is a link, not a copy of their county data.
2. **Lighten the hub's first load (M).** Open on the Land value layer with only that layer's column, plus a compact topojson, instead of the full 4.5 MB atlas.json and the 2.0 MB GeoJSON. Load the other layers when their tab is tapped. That is the CLAUDE.md pattern applied to data weight, and it should cut the phone first load to about 1 MB.
3. **Fix the two label slips (S).** Rename "15-yr trend" to "14-yr" (or fit 15 years). On counties where the rent-per-bushel trend is withheld, have the card say "rent per bushel withheld", so it does not contradict the printed yield trend.
4. **Date or cut the "Coming: the Parcel Report" waitlist (S).** The e-group audit asked Sig. An undated "it will cost something" box on a public-record page costs trust. If it stays, give it a month.
5. **Group the 16 layers into 4 on the hub (S).** Use Land & rent, Yield & insurance, Weather & water, Farm & programs. Keep every layer, just behind fewer first-screen choices.

## Verdict
Best on the internet today? **Yes for the county record as a whole.** Nothing free puts rent, yield, insurance, drought and land use for every US county on one sourced page. It is **not** the best answer to "what is land worth in my county", because it leads with a 2022 figure while NASS 2026 and ISU 2025 are out.
