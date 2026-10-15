# Head to head: agsist.com/rain (hub) and rain/<state>/<county>

Checked Oct 15, 2026, from the read-only checkout. I rendered rain.html and rain/iowa/story-county.html at 390x844 and 1280x800. No sideways scroll and no JS errors. The hub is 20 KB. County pages are 17-46 KB each and 2,691 of them in all, 54 MB with state pages. None is near the 150 KB cap.

**What I could not see:** I could not open any competitor host, or NOAA/ACIS to re-pull a station. Competitor cells are from search-result text and are marked *.

## Numbers checked by hand
- **Story County, IA (US1IASR0002, through Oct 13):**
  - Months: 1.61 + 0.71 + 2.34 + 6.67 + 2.78 + 7.35 + 12.65 + 5.43 + 5.29 + 3.44 = **48.27**. Matches.
  - Usual adds to **33.35**. Matches.
  - 48.27 / 33.35 = 144.7%, shown as **145%**.
  - Against 2025: 48.27 - 38.01 = **10.26**. Matches.
  - Outside check: NWS Des Moines* reports 4-7 in of rain around Ames on Jul 2-4, 2026. That fits the page's 5.34 in on Jul 4 and 12.65 in July.
- **Every county page with a month table (2,326):** By script, the months add to the "So far" row for both rain and usual (within 0.02 in), and the headline percent matches total / usual. **0 errors.**
- **Coverage gaps (medium, by count):**
  - **365 of 2,691 county pages (14%) have no NOAA normal for their gauge.** They give a total but cannot say wetter or drier than usual. Example: Butler County, AL.
  - Counties with no qualifying station get no page. For example, 13 of 67 Alabama counties get only a "nearest county" note on the state page. That is honest, but the hub's "54 counties" can read as if Alabama had 54.
- **Small presentation issues (low):**
  - The Story County staircase has no "usual" line, while the no-normal variant does. The "PREVIEW THROUGH OCT 13" band covers part of the Apr-May line.
  - The caption says "Light blue is snow" on a station whose note says no snow is drawn.
  - At 390 px the chart text is unreadable without "Up close".
  - "Rebuilt every Monday" sits next to "read Oct 15" (a Thursday).

## Scores (1-5)

| Page | First screen | Current | Accurate/sourced | Local | Clear | Depth | Phone | Trust | Speed | Unique | Total |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **AGSIST /rain county pages** | 5 | 4 | 5 | 4 | 5 | 4 | 4 | 5 | 4 | 4 | **44** |
| precip.ai (radar + gauge, by ZIP; free web, app)* | 4 | 5 | 3 | 5 | 4 | 3 | 4 | 3 | 3 | 4 | 38 |
| CoCoRaHS station climatology pages (YTD vs normal)* | 3 | 5 | 5 | 4 | 3 | 4 | 3 | 5 | 3 | 3 | 38 |
| NWS climate / NOWData, state climate office summaries* | 2 | 5 | 5 | 3 | 2 | 5 | 2 | 5 | 3 | 2 | 34 |

\* from search snippets only; not opened. A search for "Story County Iowa rainfall 2026 year to date" found no year-to-date total for the county. It found only a stale CoCoRaHS snapshot through Feb 14, an undated precip.ai page and monthly state summaries*. So the query a farmer types is not answered well by anyone else that I could find.

## Where we win
- **The answer in the first line,** with the station, distance and date, plus a usual that is counted over the same days. The month-by-month arithmetic is clean across every page I could parse.
- **Honest about missing days, late NOAA data and the station choice.** Every page explains why that gauge was picked.

## Where a competitor beats us, and how
- **"My field", not "my county" (precip.ai).** It uses radar plus gauges at any ZIP, with 24-hour and 7-day totals*. Accuracy is the vendor's own claim, backed by a testimonial.
- **Freshness (CoCoRaHS, NWS).** Their station pages update daily*. Ours are rebuilt weekly and run about 2 days behind NOAA.
- **A normal for every place (PRISM-based products).** NERFC tables use PRISM 1991-2020 normals*. We have none for 14% of counties.

## Five changes, ranked by impact
1. **Give the 365 no-normal counties a usual (M).** Use the nearest station with NOAA normals within N miles, or the PRISM 1991-2020 normal at the gauge, labeled "usual from <station>, X mi" or "PRISM normal at this point".
2. **Draw the usual line on the staircase (S),** and move the "PREVIEW" band off the data, so the chart answers "vs usual" at a glance.
3. **Last 7 and 30 days next to the year total (S).** Example: "Last 7 days: 0.42 in". Farmers decide fieldwork on that, and the data is already in the per-day series.
4. **Rebuild more often than weekly (S),** for example daily in the growing season, or fix the "rebuilt every Monday" line to match the real schedule.
5. **Hub wording (S).** Say "54 of 67 counties have a qualifying station", and add a ZIP box that jumps to the county page.

## Verdict
Best on the internet today? **Yes, for "how much rain has my county had this year".** No one else I found answers that query with a dated, sourced number and a same-days normal. It is close against radar-by-ZIP for a single field, and the 14% of counties with no normal are the biggest hole.
