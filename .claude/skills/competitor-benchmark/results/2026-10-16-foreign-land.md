# Head to head: agsist.com/foreign-land

Checked Oct 16, 2026. I served the read-only checkout locally and rendered foreign-land.html at 390x844 and 1280x800, full page and first screen. There was no sideways scroll and no page JS errors. The page loaded about 1.9 MB, mostly data/afida/county.json (774 KB).

The county map still shows "Map unavailable". It loads Leaflet from cdnjs, and topojson-client@3 and us-atlas@3 from jsdelivr, all with floating major versions. The sandbox blocks those hosts. The Atlas draws the same layer from local files, so this is a dependency risk rather than a confirmed live break.

Competitors were scored only from the copies GitHub Actions saved on the references branch (fetched Oct 16, 2026).

## What changed since Oct 15
- **Trend label fixed.** It now reads the last five years. Iowa reads "HOLDING STEADY SINCE 2020 ... down 8% from its 2020 peak, up 193% since 2010".
- **Iowa card now explains leases.** It says "Most of it is not ownership: Iowa State's CARD finds most foreign interest in Iowa land is long-term leases, mostly for wind turbines (2023 filings)". Other states get the general note that AFIDA counts leases of 10 years or more.
- **Byline and data date added under the H1.**
- **Not changed:** the China FAQ still answers "Not much" with no number. The map libraries are still on outside CDNs.

## Numbers checked by hand (data/afida/national.json, county.json)
- **Iowa:**
  - Row sums: 2024 is 509,583; 2020 is 554,032; 2010 is 174,083.
  - 509,583 / 554,032 = 0.920, so **down 8%**. 509,583 / 174,083 = 2.927, so **up 193%**.
  - The change since 2020 is -8.0%, inside the ±10% "holding steady" band. Label and sentence both match.
- **National shares:**
  - Canada 16,131,408 / 47,241,820 = 34.1%.
  - Netherlands 4,699,916 / 47,241,820 = 9.95%, shown as 9.9%. That is a rounding call, fine.
  - China 247,659 / 47,241,820 = **0.52%**. The same 247,659 appears in the saved farmdoc daily copy ("247,659 acres are attributable to Chinese interests ... about 0.5 percent").
- **Counties with 2024 holdings:** county.json has 2,559, matching the hero. The rows sum to 47,241,800 acres, against 47,241,820 in national.json (rounding).
- **No calculation errors.**

## Scores (1-5)

| Page | First screen | Current | Accurate/sourced | Local | Clear | Depth | Phone | Trust | Speed | Unique | Total | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **AGSIST /foreign-land** | 5 | 4 | 4 | 5 | 4 | 4 | 4 | 5 | 3 | 4 | **42** | Rendered Oct 16; hand checks above |
| farmdoc daily / TIAA Center, "Foreign Ownership of U.S. Agricultural Land" (Sep 23, 2026) | 3 | 5 | 5 | 4 | 3 | 5 | 3 | 5 | 3 | 5 | 41 | fetched Oct 16 |
| K-State AgManager, Foreign Holdings of Kansas Ag Land | 2 | 4 | 5 | 4 | 3 | 3 | ? | 5 | 2 | 4 | partial (32 on 9 cells) | fetched Oct 16; map is embedded and not in the copy |
| USDA FSA AFIDA page | 1 | 4 | 5 | 1 | 2 | 4 | 3 | 4 | 2 | 3 | 29 | fetched Oct 16 |
| Acres.com foreign-owned land map post | 2 | 3 | 2 | 4 | 3 | 2 | 3 | 2 | 3 | 3 | 27 | fetched Oct 16 |
| Iowa State CARD Foreign Interest Tool (resource page) | 2 | 3 | ? | 5 | 3 | 4 | ? | 5 | ? | 4 | partial (26 on 7 cells) | fetched Oct 16; description page only, the tool (/tools/afida) was not fetched |

Notes on the cells:
- **farmdoc/TIAA:**
  - Dated Sep 23, 2026, with full method and references.
  - Gives a 15-state table by owner type, and land-type shares (forest 88.5% of the confirmed-ownership subset).
  - Links a county map with four measures (all ag, farmland, forest, cropland) and a country filter. The map itself is not in the text copy, so Local is 4, not 5.
  - The answer sits about five paragraphs down.
- **K-State:**
  - Data "through Dec. 31st, 2024", and the file was obtained "for the purpose of differentiating energy leases from other types of holdings". The Oct 15 report said "data through 2021" from snippets; that was wrong.
  - Kansas only.
- **USDA FSA:**
  - The page opens with a policy statement ("The Trump Administration is taking bold action ..."), then filing instructions.
  - It has no acreage numbers. It links the annual reports and detail data.
- **Acres.com:**
  - Gives no data year. It says ownership "has steadily increased".
  - County layer access is "connect with our sales team", and parcel-level data is behind a contact.
- **CARD:**
  - The saved page describes the tool: county level, cropland, pasture, forest and other, by country. It was updated Sep 12, 2025.

## Where we win
- **The answer is in the first screen, plus your state.** It gives 46.3M acres, 3.6%, Canada not China, nearly half forest, and a state card with trend and lease caveat. farmdoc needs five paragraphs. USDA's page has no numbers. Acres gates the layer behind sales.
- **Every state and county, free, with a trend since 2010.** Gaps are drawn as breaks for 2015 and 2021. Of the competitors, only farmdoc and CARD cover counties nationally, and neither saved copy shows a time series.
- **Honest labeling.** Trend words come from the last five years. The page explains the row-sum vs headline gap. It refuses county percentages without a matching denominator.

## Where they beat us, and how
- **Confirmed ownership vs everything AFIDA counts (farmdoc/TIAA).** This is the big one. farmdoc separates out direct foreign ownership: "foreign ownership interests amount to 0.67 percent" of U.S. land in farms, "direct foreign owners hold about 690,000 acres" of cropland, pasture and other ag land. It says the 3.6% figure is "difficult to reconstruct" and includes leases and unconfirmed records. It also shows that energy leases are "96 percent of reported acres in Kansas ... 77 percent in Illinois". Our hero leads with 46.3M and 3.6%, and only Iowa gets a lease note.
- **China by measure (farmdoc).** farmdoc gives two China numbers: "direct individual ownership attributed to China with full information ... 1,938 acres, placing it 31st among 49 countries", and 247,659 including affiliates. Our China FAQ still says "Not much" with no number, although 247,659 is in our data.
- **Owner type (farmdoc).** farmdoc splits holdings into corporation, partnership, individual, trust and other (LLCs), by state. We do not.
- **Land use by country (CARD, farmdoc).** Both split cropland, pasture and forest by country. Our county card shows land type but not by country.

## Bugs found
- **Low to medium: the map depends on floating outside CDN versions.** "topojson-client@3" and "us-atlas@3" are not pinned to exact versions. This was open on Oct 15 too.
- **Low: the China FAQ has no number.** It answers "Not much" with no figure, in both the visible FAQ and the JSON-LD.
- **No calculation errors.**

## Five changes, ranked
1. **Put the China number in the FAQ, the JSON-LD and one hero line.**
   - What: "247,659 acres, 0.5% of foreign-held acres (USDA AFIDA, Dec 31, 2024)".
   - Effort: S.
   - Why: it is the most-searched question, and we already hold the number.
   - Honesty risk: low. Our row sum, cited.
2. **Split each state into owned and long-term lease from the AFIDA detail file.**
   - What: process_afida.py adds interest type (fee vs lease) per county and state. The state card then reads "of Kansas's X, Y% is leases". Keep it in county.json/national.json, so there is no page bloat.
   - Effort: M.
   - Why: this is farmdoc's main advantage and the biggest source of misreading. It also replaces the Iowa-only hand note with numbers for every state.
   - Honesty risk: medium. The method must be stated (share of ownership, codes 998/999), and the result will not match farmdoc exactly.
3. **Self-host Leaflet, topojson-client and the county topology (as the Atlas does), pinned.**
   - Effort: S.
   - Why: the map is the local answer, and today it rests on two outside hosts and floating versions.
   - Honesty risk: none.
4. **A "confirmed ownership" line next to the 3.6%.**
   - What: once change 2 exists, say "of 46.3M, about X is owned outright; the rest is 10+ year leases and records with no foreign country listed".
   - Effort: S after change 2.
   - Why: it answers what farmdoc says the headline hides, in our own numbers.
   - Honesty risk: medium. It needs our own tabulation, not farmdoc's figure.
5. **Owner type by state (corporation, partnership, individual, LLC/other), loaded on demand.**
   - Effort: M.
   - Why: matches farmdoc's Table 1 for all states, not 16. It goes in the per-state data file, rendered when opened.
   - Honesty risk: low.

## Verdict
Best on the internet today? **Close.** Ours is still the fastest free answer with every state and county, a trend, and numbers that check. farmdoc/TIAA (Sep 2026) now goes deeper on the question that matters most: how much is owned outright rather than leased or unconfirmed. Until we split owned from leased in our own data, farmdoc is the better source on depth.

**Total: 42, up 1 from 41 on Oct 15** (trust +1 for the byline and data date). The trend label fix is real but did not move a whole point. Oct 15 competitor totals came from snippets, so competitor columns are not comparable between runs.
