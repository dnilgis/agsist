# Head to head: agsist.com/rain (hub), rain/<state> and rain/<state>/<county>

Checked Oct 16, 2026, from the checkout. I served the repo locally and rendered these pages at 390x844 and 1280x800:
- rain.html
- rain/iowa.html
- rain/iowa/story-county.html
- rain/alabama/butler-county.html, a county with no NOAA normal

What I saw:
- No sideways scroll and no page errors. The only failed loads are outside hosts, which are blocked here.
- The county page HTML is now at most 20 KB; it was 17-46 KB on Oct 15.
- In all, 2,691 county pages plus the state pages come to 50 MB.
- Rendered, a county page pulls in about 0.9 MB, which is the shared Rain Print engine and its fonts plus one state file of days. That loads only when the chart scrolls into view, and it is cached across counties.
- Since Oct 15 the page text has not changed. The county pages were rebuilt to load Rain Print engine v40.

**Competitors.** I scored them only from the copies GitHub Actions saved on Oct 16 (references branch). Phone is "?" for every competitor because I did not render them, so their totals are out of 45.
- **Read (2):**
  - NWS Hastings Nebraska precipitation maps (bench-rain-county-4). The saved copy has the page text and the list of maps, but not the map images themselves.
  - NOAA CPC monthly graphics archive (-5).
- **Could not read (4):**
  - CoCoRaHS (-2): the saved copy is an empty shell, list markers only.
  - HPRCC maps (-6): HTTP 404, and there is no Wayback copy.
  - precip.ai and NWS NOWData: not in the Oct 16 fetch index (marked app-only), so not read.

## Numbers checked by hand
- **Story County, IA** (US1IASR0002, through Oct 13). The data is the same as Oct 15:
  - The months add to 48.27, against a usual of 33.35, giving 144.7%, shown as **145%**.
  - Against 2025: 48.27 - 38.01 = 10.26. Matches.
- **Hall County, NE** (Grand Island airport):
  - Months: 0.52 + 0.14 + 0.12 + 1.96 + 4.20 + 5.44 + 4.46 + 4.25 + 5.72 + 0.02 = **26.83**. Matches.
  - Usual: 0.61 + 0.74 + 1.39 + 2.52 + 4.70 + 4.01 + 3.51 + 3.20 + 2.00 + 0.99 = **23.67**. Matches.
  - 26.83 / 23.67 = 113.4%, shown as **113%**.
  - Against 2025: 26.83 - 23.88 = 2.95. Matches.
- **All 2,691 county pages, by script:**
  - Month rain and usual add to the "So far" row within 0.02 in.
  - The headline percent equals total / usual.
  - **0 errors.**
- **Coverage, unchanged:**
  - 365 of 2,691 pages (14%) still have no NOAA normal. Butler County, AL is one: "This gauge has no NOAA normal, so there is no usual year to compare it with."
  - Iowa has 86 county pages and 13 counties with only a "nearest county" note, 99 in all.
- **Freshness:**
  - 2,363 pages run through Oct 13. 328 pages stop earlier, the oldest on Oct 3.
  - Each page dates itself ("As of Oct 3, 2026, the latest day this gauge has reported"), so this is honest, but it is 13 days old on Oct 16.
  - The footer reads "read Oct 15, 2026; rebuilt weekly". The Oct 15 "rebuilt every Monday" mismatch is gone.

## Bugs found
1. **Medium, clarity: on 2,326 pages the "vs usual" chart is swapped out for a Rain Print preview with no usual line.**
   - Each county page ships a running-total chart, the year against a dashed usual line ("Running total of rain ... against a usual year").
   - When it scrolls into view, components/rain-county-print.js replaces it with the Rain Print art and calls it with `showNormals: false`.
   - What a reader sees is the year's staircase with no usual line, a dark "PREVIEW THROUGH OCT 13" band across the Apr-May part of the line, and text unreadable at 390 px without "Up close". I saw this on the Story County render.
   - The numbers under the chart are right. But the chart no longer answers "wetter or drier than usual", which is the page's question.
   - Sig asked for the print in place of the chart (comment in the script, Oct 15). So the fix is to turn the normals on in the preview, not to bring back the old chart. His Oct 15/16 rule already opens Rain Print with normals on for county-page links.
2. **Low, wording:** the hub still reads "Alabama 54 counties" and "Iowa 86 counties". A reader can take that as the state's county count. Alabama has 67 and Iowa 99.

## Scores (1-5)

| Page | First screen | Current | Accurate/sourced | Local | Clear | Depth | Phone | Trust | Speed | Unique | Total | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **AGSIST /rain county pages** | 5 | 4 | 5 | 4 | 4 | 4 | 4 | 5 | 4 | 4 | **43/50** | rendered Oct 16 |
| NWS Hastings Nebraska precipitation maps | 3 | 5 | 4 | 3 | 3 | 4 | ? | 5 | 3 | 3 | 33/45 | fetched Oct 16; page text and map list read, map images not in the copy |
| NOAA CPC monthly graphics archive | 1 | 1 | 4 | 1 | 2 | 3 | ? | 5 | 3 | 1 | 21/45 | fetched Oct 16 |
| CoCoRaHS | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | not scored | fetched Oct 16: empty shell, not readable |
| precip.ai | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | not scored | not in the Oct 16 fetch (app-only) |
| NWS NOWData | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | not scored | not in the Oct 16 fetch (app-only) |
| HPRCC ACIS maps | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | not scored | fetch failed (HTTP 404, no Wayback copy) |

**Why our score moved (-1):** clear went from 5 to 4. Since the Oct 15 run, the chart on most county pages is a Rain Print preview with no usual line (bug 1). The Oct 15 report noted the missing line on one page. It is now the case on every page that has a normal.

**What each competitor's scores rest on:**
- **NWS Hastings:**
  - "These maps should update daily by mid morning."
  - Totals for 24, 48 and 72 hours, the last 7, 30 and 90 days, month to date, year to date and since Oct 1, with percent of normal for 7, 30 and 90 days, year to date and since Oct 1.
  - Snow totals and departure. The sources are named (AHPS and NOHRSC).
  - Nebraska only. A reader reads his county off a map; there is no number for his county.
- **CPC:**
  - Monthly U.S. total and percent-of-normal maps, 1999-2015.
  - "Page last modified: November 19, 2015."
  - No county answer.

## Where we win
- **A number for the county, in words, with the station, the distance and the date.** Plus a usual year counted over the same days, a month table, and 2025 at the same date. Neither copy read gives a county a number. Hastings gives a state map, and CPC is a 2015 archive.
- **The arithmetic is clean on every page**, and the pages are honest about missing days, late NOAA data and why a gauge was picked.

## Where they beat us
- **Recent windows (NWS Hastings).** 24 hours to 90 days, each with percent of normal, updated daily. We give the year to date and months only, and the data runs about 3 days behind.
- **Snow (NWS Hastings).** Season snow and departure from normal. Our county pages draw no snow when the gauge's snowfall record has holes.
- **A normal for every place.** A gridded analysis has a normal everywhere. We have none for 14% of counties.

## Five changes, ranked
1. **Turn the 30-year normals on in the county Rain Print preview (S).**
   - What: call the art with `showNormals: true` (the art already draws them on /rain-print), using the page's own daily normals. Move the PREVIEW band off the drawn line. Where no normal exists, keep it off and say so.
   - Why: on 2,326 pages the chart no longer shows wetter or drier than usual.
   - Honesty risk: none, if the normals are the same days the page already counts.
2. **Usual for the 365 no-normal counties (M).**
   - What: the nearest NOAA-normal station within a stated distance, or the PRISM 1991-2020 normal at the gauge. Label which, for example "usual from <station>, X mi".
   - Why: 14% of county pages cannot answer "vs usual".
3. **Last 7 and 30 days, each with percent of usual (S).**
   - What: one line under the headline. The days and normals are already in the per-state file.
   - Why: fieldwork and drydown decisions run on the last week, and Hastings has it.
4. **Rebuild daily from April to November (S).**
   - What: the ACIS read is already scripted. Drop pages more than 7 days stale to a "station late" note, or flag them on the hub.
   - Why: 328 pages stop before Oct 13, the oldest on Oct 3.
5. **Hub wording and a ZIP box (S).**
   - What: "54 of 67 counties have a qualifying station". Add a ZIP or town box that jumps to the county page, or to its nearest county.
   - Why: a stranger lands on the hub and should not have to know his county name.

## Verdict
**Yes, for "how much rain has my county had this year".**
- Score: 43/50, down 1 from Oct 15 (44), because of bug 1.
- No copy read gives a dated county number with a same-days normal.
- NWS Hastings is better on recent windows and snow, in Nebraska only.
- precip.ai and NOWData could not be read this run.
