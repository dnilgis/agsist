# Head to head: agsist.com/drought-monitor

Checked Oct 16, 2026. I rendered drought-monitor.html from the checkout at 390x844 and 1280x800. No sideways page scroll and no JS errors (two blocked outside calls). The main map is still hotlinked from droughtmonitor.unl.edu, which the sandbox blocks, so I saw the fallback. The "Map valid Oct 13" label comes from data/outlooks/manifest.json. The new "Your county since 2000" box works: I typed "Story" and got Story County, IA, 2000-2025: 117 of 1,304 weekly maps at half the county in D2+ (9%), worst year 2013 (33 weeks).

Competitors were scored only from the copies GitHub Actions fetched on Oct 16 (references branch, ids bench-drought-monitor-1..5). I did not render them, so phone is "?" for every competitor and their totals are out of 45.

## Numbers checked by hand
- **County lookup:** I recomputed three counties from data/atlas/counties/<fips>.json series: Story IA (19169), Pawnee OK (40139) and an Alabama county (01065). The d2/d3 sums, shares (9.0%, 32.6%, 10.0%) and worst years (2013, 2013, 2007) match what the page prints.
- **Bug (medium-high): 2024 is missing from every county's drought record.** In data/atlas/raw/drought.json, 3,132 of 3,141 counties have `"2024": {"maps": 1}` and the other 9 have no 2024 entry. 2024 should have 53 weekly maps. drought_layer drops years with under 40 maps, so the "2000-2025" line on this page really covers 25 years, not 26, and says nothing about the gap. "1,304 weekly maps" should be about 1,357. The Atlas "last 5 years" (labeled 2020-2025, 260 maps) is really 2020-2023 plus 2025. A county that was in drought in 2024 is undercounted.
  - **Likely cause (not proven):** scripts/fetch_atlas_drought.py refetches only the last 2 years (2025-2026), and it keeps older years from the file. The API seems to return the map dated 2024-12-31 for a query starting 1/1/2025. count_weeks files that one map under 2024, and `counties[fips].update(results[fips])` then replaces the kept 53-map 2024 record with the 1-map one. Every county showing exactly 1 map fits this. If that is right, it happens again each January (2025 gets wiped in 2027).
- **Partial year:** "2026 so far: 40 maps" is right. The data was built Oct 15 at 06:33 UTC, before that day's release, so it counts maps valid Jan 6 through Oct 6.
- **Date label vs image (low, still open):** the image is NDMC's live current_usdm.png, but the label comes from our manifest. The repo already fetches a dated copy (data/outlooks/usdm_latest.png, valid 2026-10-13), and the page does not use it.

## Scores (1-5)

| Page | First screen | Current | Accurate/sourced | Local | Clear | Depth | Phone | Trust | Speed | Unique | Total | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **AGSIST /drought-monitor** | 3 | 4 | 3 | 3 | 4 | 3 | 3 | 4 | 4 | 2 | **33/50** | rendered Oct 16 |
| drought.gov county page (Story Co, IA) | 4 | 5 | 5 | 5 | 3 | 5 | ? | 5 | 2 | 4 | 38/45 | fetched Oct 16 |
| drought.gov national current conditions | 4 | 5 | 5 | 1 | 4 | 4 | ? | 5 | 3 | 3 | 34/45 | fetched Oct 16 |
| droughtmonitor.unl.edu Current Map (NDMC) | ? | 5 | 5 | ? | ? | 4 | ? | 5 | ? | 5 | 24/25 (partial) | fetched Oct 16; the text copy is an app shell, and only the release line and links show in the HTML |
| WVUA23 local drought post | 3 | 1 | 3 | 4 | 4 | 1 | ? | 3 | 2 | 2 | 23/45 | fetched Oct 16 |
| USDA OCE Agriculture in Drought (PDF) | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | not readable (HTTP 403, no archive copy) |

Notes on the copies:
- **drought.gov county page:**
  - The first screen shows "0 people in Story County are affected by drought", the percent of the county in D1-D4, and the change since last week and last month. It also shows "14th wettest September on record, over the past 132 years" and "4th wettest year to date", with inches from normal.
  - The page also carries 7/30/60-day precipitation, temperature anomaly, soil moisture (SPoRT-LIS and Crop-CASMA), the Vegetation Health Index, streamflow, CPC outlooks and historical conditions, each with a data-valid date (USDM 10/13/26).
  - The registry said it shows hay acres and cattle head in drought. The saved copy has no hay, cattle or acreage figures. It does carry a lot of repeated boilerplate, plus AQI and heat panels.
- **drought.gov national page:** "As of October 13, 2026, 45.05% of the United States and Puerto Rico and 53.73% of the Lower 48 states are in drought", with week and month changes and a weekly narrative.
- **NDMC:** "Map released: October 15, 2026 Data valid: October 13, 2026", with links to comprehensive statistics, tabular data, time series and GIS downloads.
- **WVUA23:** the saved article is dated Oct 30, 2025 (datePublished), a year old. It is what search still surfaces. It names the West Alabama counties in D3 and D2.

## Where we win
- **County drought history since 2000 in one box:** weeks at D2+, at D3+, and the worst year, loaded on demand, with a link to the county's Atlas record and rain page. drought.gov's county page has "historical conditions" but no plain count of drought weeks per year. The count is currently wrong by one year (the bug above).
- **Crop stress windows** (corn, soybeans, wheat, hay by month and category) and the PRF-vs-USDM note. No competitor copy connects the categories to crop stages.

## Where they beat us, and how
- **This week, for my county (drought.gov):** it gives the percent of the county in D1-D4 this week and the change vs last week and last month. Our county box gives only history, and its own copy says "This week's map is above".
- **One national number with a date (drought.gov national):** for example "53.73% of the Lower 48 in drought, valid Oct 13", with the weekly change. We print no number at all.
- **Rain context on the same page (drought.gov):** 30- and 60-day percent of normal and the September rank for the county. AGSIST has county rain pages, but this page only links to them after a lookup.
- **Depth for agronomy (drought.gov):** county soil moisture percentile and the Vegetation Health Index.

## Bugs found
1. **Medium-high:** 2024 is missing from every county's drought weeks (data/atlas/raw/drought.json, 1 map in 2024). The "since 2000" totals, worst year and "last 5" on this page and in the Atlas are silently short a year. The likely cause is the refetch-window merge in scripts/fetch_atlas_drought.py.
2. **Low:** the map is still hotlinked, so the label and image can disagree on Thursday mornings. The dated copy (data/outlooks/usdm_latest.png) already exists. The copy "AGSIST links directly to the official NDMC map with no delay" sits on the page twice.
3. **Low:** "ask your crop insurance agent" and "Contact your crop insurance agent" still appear in the LFP/insurance box and the FAQ. That is agent routing, and FSA, not an agent, runs LFP.
4. **Low (phone):** the crop stress table scrolls sideways at 390 px, and the "What's at stake" column is cut off on the first screen.

## Five changes, ranked
1. **Fix the 2024 hole and guard it.**
   - What: refetch 2024 for all counties. Change the merge so a refetch never replaces a year outside its window, or drop records dated before the window start. Add a test that every full past year has 52 or 53 maps.
   - Why: every county number on this page and in the Atlas is short a year right now.
   - Effort: S. Honesty risk: none; it removes a silent error.
2. **This week's status in the county box.**
   - What: show the percent of the county in D0-D4 for the latest map, the change vs 1 and 4 weeks ago, and consecutive weeks at D2+ this year. The source is the same NDMC county statistics API the Atlas already uses, fetched once a week into one national file of about 3,141 rows, loaded only when the box is used.
   - Why: "is my county in drought this week" is the main query, and drought.gov answers it while we do not.
   - Effort: M. Honesty risk: low, if every figure carries the map's valid date and stays the NDMC number.
3. **Serve our own dated map.**
   - What: use data/outlooks/usdm_latest.png (and state copies, fetched the same way) with its valid date. Keep the NDMC link. Drop the "no delay" line.
   - Why: the label and image can never disagree, and the page no longer depends on a third-party host.
   - Effort: S. Honesty risk: none. Watch the budget: one PNG of about 400 KB replaced weekly, not one per week kept.
4. **State the LFP rule, not the agent.**
   - What: give the FSA LFP drought-intensity ladder (8 consecutive weeks at D2, D3, D4) from the FSA fact sheet saved to references. Show the county's consecutive D2+ weeks next to it, and say plainly that FSA uses any part of the county during the normal grazing period, which this page does not check. Remove both "ask/contact your crop insurance agent" lines.
   - Why: LFP is the only USDA payment tied directly to this map, and ranchers search for it.
   - Effort: M. Honesty risk: medium. The Atlas "half the county" line is not FSA's rule, so the count must be FSA's own definition or be clearly labeled as different.
5. **Rain next to drought, and a phone-sized stress table.**
   - What: after a lookup, show "Rain since Jan 1: X% of normal (station, date)" from the county rain data, and stack the stress table into cards at phone width.
   - Why: it joins two AGSIST datasets no competitor joins, and it fixes the cut-off column.
   - Effort: S. Honesty risk: low (show the station and dates).

## Verdict
**No.** The page gained a real county history since Oct 15. But drought.gov's county page answers "is my county in drought this week" and we still do not, and our history quietly leaves out 2024.

## Change since Oct 15
31 to 33 (+2). Local went from 2 to 3 and depth from 2 to 3 because of the county box. Accuracy went from 4 to 3 because of the missing 2024. Unique went from 1 to 2.
