# Head to head: agsist.com/foreign-land

Checked Oct 15, 2026, from the read-only checkout. I rendered foreign-land.html at 390x844 and 1280x800. No sideways scroll and no page JS errors. About 1.9 MB loaded, mostly data/afida/county.json (774 KB) plus map tiles. The county map showed "Map unavailable" here because the sandbox blocks the topojson-client and Leaflet CDNs. The same layer drew in the Farmland Atlas, which uses local files, so I do not count this as a site bug. It does mean the page depends on two outside hosts for its map.

**What I could not see:** I could not open any competitor host (DNS refusal). Competitor cells are from search-result text and are marked *.

## Numbers checked by hand (data/afida/national.json, county.json)
- **National:**
  - Growth: 47,241,820 / 24,841,588 = 1.902, so **+90%**. Matches.
  - Forest: 22,232,297 / 47,241,820 = **47.1%**. Matches "47%".
  - Canada: 16,131,408 / 47,241,820 = **34.1%**. Matches.
  - Not ranked: 1,546,303 + 1,382,633 = **2,928,936**. Matches.
- **USDA headline:** 46.3 million acres and 3.6% of privately held agricultural land through Dec 31, 2024 matches search results quoting the January 2026 USDA report.* China at 247,659 acres also matches.* The page uses USDA's figure for the headline and its own row sums (47.24M) for the maps, and says so.
- **Iowa:**
  - County rows sum to 509,583 acres in 2024 against 174,083 in 2010, so 2.927x, **+193%**. Matches.
  - **Framing issue (low to medium):** the card says "GROWING FAST", but the Iowa rows peaked at 554,032 in 2020 and are 8% lower now (491,391 in 2022, 490,690 in 2023, 509,583 in 2024). The growth is real since 2010 but not recent.
  - CARD and USDA both say much of Iowa's foreign "holding" is long-term wind leases, not ownership.* USDA counts 10.6 million acres of foreign wind leases nationally.* The page mentions 10+ year leases in the fine print only.
  - One news report cites nearly 514,000 Iowa acres for 2022 from USDA's state table, against our row sum of 491,391.* That is a different table, so this is a check item, not an error.

## Scores (1-5)

| Page | First screen | Current | Accurate/sourced | Local | Clear | Depth | Phone | Trust | Speed | Unique | Total |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **AGSIST /foreign-land** | 5 | 4 | 4 | 5 | 4 | 4 | 4 | 4 | 3 | 4 | **41** |
| farmdoc daily / TIAA Center foreign-ownership mapping utility (Sep 2026)* | 3 | 5 | 5 | 4 | 3 | 4 | 3 | 5 | 3 | 4 | 39 |
| Iowa State CARD Foreign Interest Tool* | 3 | 3 | 5 | 5 | 3 | 4 | 3 | 5 | 3 | 4 | 38 |
| USDA FSA AFIDA annual report and ArcGIS map* | 2 | 4 | 5 | 4 | 2 | 5 | 2 | 5 | 2 | 3 | 34 |
| Acres.com foreign-owned land layer (sales contact)* | 3 | 3 | 3 | 5 | 3 | 3 | 3 | 3 | 3 | 3 | 32 |
| K-State AgManager, foreign holdings of Kansas ag land (data through 2021)* | 3 | 1 | 4 | 4 | 3 | 3 | 3 | 5 | 3 | 2 | 31 |

\* from search snippets only; not opened.

## Where we win
- **The answer is in the first screen.** It gives 46.3M acres and 3.6%, says Canada not China, says nearly half is forest, and shows your state's number. No competitor I found leads with all four.
- **County and holder country in one free page, with the trend since 2010.** It honestly breaks the line at 2015 and 2021, the years USDA's files skip.
- **It explains the gap between the row sums and USDA's headline.** It also refuses to print county percentages until it has a matching denominator.

## Where a competitor beats us, and how
- **Ownership vs lease, and land use (CARD, USDA).** CARD splits cropland, pasture and forest by country at the county level.* USDA splits out wind leases.* Our county card shows land type but not owned vs leased. That is the single biggest source of misreading (Iowa).
- **Newer analysis (farmdoc/TIAA Center, Sep 2026).** They cover ownership by type and use.*
- **China is named but not counted.** The FAQ "How much American farmland does China own?" answers "Not much" without the 247,659 acres (0.5%) that is already in our data.

## Five changes, ranked by impact
1. **Put the China number in the FAQ and the hero (S).** Say "247,659 acres, 0.5% of foreign-held land, USDA Dec 31, 2024", and use the same line in the JSON-LD answer. It is the question most people search.
2. **Split owned vs long-term lease, and flag wind (M).** If the detail file carries the interest type, add it to county.json and the state card: "of Iowa's 510k, X is leases". If it does not, say in the card that AFIDA counts 10+ year leases (wind) as holdings.
3. **Fix the trend label (S).** Base "growing fast" on the last 3 to 5 years, not since 2010. Iowa would read "+193% since 2010, down 8% from its 2020 peak".
4. **Self-host the map libraries (S).** Use local copies of topojson-client and Leaflet, as the Atlas does, so the map does not depend on two outside CDNs.
5. **Visible byline and data date under the H1 (S).** Write "Sigurd Lindquist, CCA. USDA AFIDA through Dec 31, 2024, refreshed 2026-07-18."

## Verdict
Best on the internet today? **Close.** It is the fastest free answer to "who owns our farmland from abroad, and in my county", and its numbers check out. But it does not separate leases from ownership, and it does not count China in the place people look. CARD and the new farmdoc/TIAA tool go deeper on type and use.
