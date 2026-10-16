# Head to head: agsist.com/conditions, 2026-10-16

I rendered conditions.html locally at 390 x 844 and 1280 x 800, with service worker blocked and outside hosts blocked. There was no sideways page scroll and no JS errors. Load was 468 KB.
- **Data on the page:** data/conditions/conditions.json (generated Oct 15 00:14Z) and data/crop-progress.json (updated Oct 15), both for the week ending Oct 11.
- **Scope:** this run scores conditions.html only. conditions-yield (the forecast board) was scored with it on Oct 15 and is not re-scored here.

**Competitor copies** come from origin/references, fetched Oct 16:
- **bench-conditions-1:** the NASS Crop Progress PDF prog4026, released Oct 5 for the week ending Oct 4. It is the URL in the list, so it is a week older than the current issue.
- **bench-conditions-2:** the DTN article for the week ending Oct 11.
- **bench-conditions-5:** the farmdoc daily Aug 12 article.
- **Not readable:** Farm Progress (-3) and Brownfield (-4) both returned HTTP 403 with no archive copy. They are marked "?".

## What changed since Oct 15
- **C1 fixed.** The title, hero, stats line and table caption all say week ending Oct 11 (corn 56%, beans 57%, harvest 33% vs 39%, 46% vs 50%). There is one week on the screen.
- **Harvest progress by state added (change #2).** It is a sortable table for corn and soybeans: harvested, 5-year average and the gap. The national line sits on the first screen.
- **The week and national number are on the first screen (change #3).**
- **C2 partly fixed.** The state card now says "record ... starts in 2001; it has no rating at this week in 2012 or 2025". But the header still says "Ranked against 2000-present" and "every year since 2000", and the table note says "most go back to 2000". No state has a 2000 rating.

## Scores (1-5)

| | First screen | Current | Accurate+sourced | Local | Clear | Depth | Phone | Trust | Speed | Unique | Total | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **AGSIST conditions** | 5 | 4 | 5 | 4 | 4 | 5 | 4 | 5 | 4 | 5 | **45** | rendered Oct 16; numbers hand-checked |
| USDA NASS Crop Progress PDF | 2 | 5 | 5 | 3 | 2 | 5 | 2 | 5 | 3 | 3 | 35 | fetched Oct 16 (17-page PDF) |
| DTN weekly article (Oct 13) | 4 | 5 | 5 | 2 | 4 | 3 | 4 | 4 | 2 | 2 | 35 | fetched Oct 16 |
| farmdoc daily condition model (Aug 12) | 3 | 2 | 5 | 3 | 3 | 5 | 3 | 5 | 4 | 4 | 37 | fetched Oct 16 |
| Farm Progress weekly | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | n/a | not readable (403) |
| Brownfield weekly | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | n/a | not readable (403) |

**How I scored the competitors:**
- **NASS:** every state in the main states, including mature %, harvested %, the 5-year average and condition. It is a fixed-width PDF table and hard to read on a phone. The copy carries a special note that 2025 Oct-Nov reports were canceled.
- **DTN:**
  - It was published 3:04 p.m. CDT Tuesday Oct 13, within minutes of the release.
  - It has a national summary table (this week, last week, last year, 5-year average) for 13 progress items, including wheat, cotton, sorghum, rice, sugarbeets and sunflowers.
  - State notes are prose only: IA corn 14% harvested, IA soy 31% vs 59%, IL soy 48% vs 46%, KS wheat 44% vs 56%. There is a weather outlook from their meteorologist.
  - No state ranking.
- **farmdoc:**
  - A trend-and-condition model for each of the 18 states, with R-squared per state, confidence bounds, and the yield before and after the USDA report.
  - The saved copy is from Aug 12, so it is stale for October. The note says the weekly series is on the author's Substack.

## Numbers checked by hand

| Item | Page | Check | OK |
|---|---|---|---|
| National corn harvest, soy harvest | 33% vs 39%, 46% vs 50% | DTN copy: same | yes |
| IA soy harvest | 31% vs 59% avg | DTN copy: "31% ... five-year average of 59%" | yes |
| IL soy harvest | 48% vs 46% | DTN copy: same | yes |
| IA corn harvest | 14% | DTN copy: "just 14%" | yes |
| IA corn G+E rank | 71%, 16 of 24, "better than 15 of the last 23", avg 66, worst 43, best 82 | I recomputed it from the hist in conditions.json: 15 years below, mean 65.7, min 43, max 82 | yes |
| NC 14%, rank 2 of 24; CO 36%, 5 of 24; NY 87%, 11 of 11 | same | 1, 4 and 10 years below; avg 51.3 / 59.0 / 70.3 | yes |

No calculation errors found.

| # | Finding | Severity |
|---|---|---|
| C2b | **"Since 2000" when the data starts in 2001.** The header, H1 ("every year since 2000"), the kicker "2000-present" and the table note ("most go back to 2000") all say 2000. Every state's history starts in 2001, and the page's own table paragraph says "No state has a rating at this week in 2000". The page contradicts itself. | Low-medium |
| C8 | **Phone: the ranking table hides its point.** At 390 px the state table is 603 px wide in a 320 px scroll box. The Rank and "vs its own average" bar columns sit off screen, and the header shows "RANK (1" cut off. A phone reader sees only G+E now and own average, unless they find the side-swipe. The harvest table fits. | Medium (phone) |
| C9 | Five harvest rows (AL, UT, VA, WY corn) have no 5-yr average and show blanks with no note. The method line explains when the average is withheld, but not next to those rows. | Low |
| C10 | The kicker says "Every Monday", but this week's report came Tuesday (Columbus Day). The page does not say when the next one is due. | Low |

## Where we win
- **Each state against its own history for this week.** Nobody else ranks that way. DTN and NASS give last week, last year and the 5-year average only.
- **Harvest by state in one sortable table.** It has the gap to average and both crops, on a phone, two days after release. DTN gives a few states in prose. NASS gives a PDF table.
- **Honest method.** It never carries a stale week forward, it withholds the 5-year average when a year is missing, and it says our average can differ from NASS's by a point.

## Where they beat us, and how
- **DTN, speed:** up within minutes of the 3 PM CT release. Ours refreshed overnight (Updated Oct 14), about 9 hours later.
- **DTN, breadth:** its summary table covers 13 progress items (winter wheat planted and emerged, cotton, sorghum, rice, sugarbeets, sunflowers) and a weather outlook. Ours covers corn and soy condition and harvest only, though crop-progress.json already holds wheat, cotton, sorghum, rice and peanuts.
- **NASS, maturity:** NASS prints mature % by state for corn and soybeans dropping leaves. We don't.
- **farmdoc, model detail:** each state's model fit (R-squared) and a range for each state. That lives on conditions-yield, not this page.

## Five changes, ranked
1. **Make the ranking table fit a phone (S).** At under 480 px, drop the bar column into a second line under each row, or replace Rank with a compact "rank/N" and a colored dot. Keep the swipe for the bar. This is the core of the page, and most October readers are on a phone in a combine. Honesty risk: none.
2. **Show the other crops already in crop-progress.json (S-M).** Add winter wheat planted and emerged, cotton, sorghum and peanuts harvested, nationally and by state, behind a crop picker loaded from the same file. That matches DTN's breadth with no new data source. Honesty risk: low. Keep the "our arithmetic" note on 5-year averages.
3. **Fix the 2000 wording (S).** Say "since 2001" in the kicker, H1, title text and table note, or fetch 2000 if NASS has it. Honesty risk: none. It removes a self-contradiction.
4. **Refresh on report day (M).** Run the fetch at about 3:15 PM CT Monday, plus Tuesday on holiday weeks, and print "Released Tue Oct 13, 3 PM CT; on this page at <time>". Honesty risk: none, as long as a partial pull never publishes.
5. **Add a mature / dropping leaves column to the harvest table (S).** It comes from the same NASS series. It answers "how much is left standing and dry enough", which is the October question after harvest %. Honesty risk: low.

## Verdict
**Yes.** For a farmer asking "how is my state's crop rated and how far along is harvest", this is now the best free page I can find. It has the right week, a hand-checked harvest table, and the state-against-its-own-history ranking nobody else has. The gaps are a phone table that hides the rank column, and DTN's speed and crop breadth.

**Change since Oct 15:** 40 to **45 (+5)**, from the stale-week fix, the harvest table and the first-screen date.
