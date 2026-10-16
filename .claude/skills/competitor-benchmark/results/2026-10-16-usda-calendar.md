# Head to head: agsist.com/usda-calendar

Checked Oct 16, 2026 (about 11:20 am CT). I served the repo locally and rendered usda-calendar.html at 390x844 and 1280x800. No sideways scroll and no JS errors (the only console error is a blocked outside request). It loaded about 409 KB uncompressed in 15 requests, and the phone page is 10,800 px tall. The first screen shows the next WASDE (Tue Nov 10, noon ET, 11 a.m. CT), the 2026 WASDE dates, and a "Next USDA report" card: Crop Progress, Mon Oct 19, 4:00 PM ET, 3 days away.

**Competitor copies (references branch, fetched Oct 16):**
- NASS 2026 Agricultural Statistics Board Calendar (PDF): readable, 47k characters.
- ESMIS Cattle on Feed: readable.
- USDA OCE WASDE page: failed (HTTP 403, then Wayback 429). Not readable.
- CME/Econoday: failed (HTTP 403). Not readable.
- TradingView WASDE script: no saved copy (not fetched, app-only). Not readable.

## Since Oct 15
- **Livestock and dairy reports added** (Oct 15 change 1). The page now lists 10 rows: Milk Production, Cattle on Feed, Cold Storage and the December Hogs and Pigs, with a Livestock & Dairy filter and links to the cattle and milk pages.
- **January 2027 note added** (Oct 15 change 2): "USDA has not posted its 2027 report dates yet..."
- **Not done:**
  - CFTC COT is still not on the calendar.
  - The subscribe feed is still "monthly reports only".
  - There is no "what it did" on past reports.

## Dates checked against the saved NASS calendar PDF
- **All 10 livestock rows match the PDF:**
  - Milk Production: Oct 22, Nov 20, Dec 22.
  - Cattle on Feed: Oct 23, Nov 20, Dec 18. ESMIS also lists these, "3:00 PM".
  - Cold Storage: Oct 23, Nov 24, Dec 23.
  - Hogs and Pigs: Dec 23.
- **Grain report dates match:** Crop Production on Oct 9, Nov 10 and Dec 10; Grain Stocks on Sep 30; Crop Progress starting Apr 6.
- **Countdown:** Fri Oct 16 to Mon Oct 19 is 3 calendar days. 4:00 PM ET is 3:00 PM CT. Correct.
- **Weekdays:** Nov 1, 2026 is a Sunday, so Nov 10 is a Tuesday. Dec 10 is a Thursday. Both correct.
- **.ics times:**
  - Oct 9 is 16:00Z, which is noon EDT.
  - Nov 10 is 17:00Z, which is noon EST.
  - The StatCan release on Dec 4 is 13:30Z, which is 8:30 EST.
  - All correct.

## Bugs found
1. **Low-medium: the subscribe feed and the homepage strip leave out every livestock report.**
   - usda-calendar.ics is a hand-kept second copy of the dates. It has 16 events and no Cattle on Feed, Milk Production, Cold Storage or Hogs and Pigs.
   - The homepage "Upcoming USDA reports" strip builds its monthly rows from that file, so it skips Oct 22 Milk Production and Oct 23 Cattle on Feed.
   - A cattle feeder who taps "Subscribe" gets none of their reports.
2. **Low: the last Crop Progress of the season (Mon Nov 30) is missing.**
   - The NASS PDF lists Crop Progress on Nov 30, 2026.
   - The generator stops at `end:'2026-11-23'`, and the explainer card says "through Thanksgiving week".
   - components/home.js uses the same rule (`cpSeason` ends on the Monday of Thanksgiving week).
3. **Low: the Dec 10 Crop Production row is missing.** The NASS PDF lists Crop Production on Thu Dec 10, the same day as the WASDE. The page has the WASDE row only. It is a smaller report (cotton and citrus), but it is a NASS release on a day the page already covers.

## Scores (1-5)

| Page | First screen | Current | Accurate/sourced | Local | Clear | Depth | Phone | Trust | Speed | Unique | Total | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **AGSIST /usda-calendar** | 5 | 5 | 4 | 2 | 4 | 4 | 4 | 4 | 4 | 4 | **40** | rendered Oct 16, dates checked against the NASS PDF |
| NASS 2026 Ag Statistics Board Calendar (PDF) | 2 | 5 | 5 | 1 | 2 | 4 | 1 | 5 | 3 | 3 | 31 | fetched Oct 16 |
| ESMIS Cattle on Feed | 4 | 5 | 5 | 1 | 4 | 4 | ? | 5 | ? | 2 | 30 of 40 | fetched Oct 16, not rendered |
| USDA OCE WASDE schedule | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | not readable (403/429) |
| CME Group / Econoday | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | not readable (403) |
| TradingView WASDE Dates V2 | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | not readable (no saved copy, app-only) |

## Where we win
- **One list across agencies** (NASS, OCE, FAS, FSA, CONAB, StatCan), with:
  - a countdown in the reader's own time zone;
  - an impact tag on each row;
  - FSA deadlines with what missing them costs.
- **The NASS PDF is an 11x17 grid of about 60 report names.** It has no times, no impact and no filter, and it cannot be read on a phone. Ours lets you filter to WASDE, livestock and so on.
- **The ESMIS pages cover one report each.** A farmer would need about eight of them to see what our page shows at once.

## Where they beat us
- **NASS completeness.** The PDF carries every NASS release: Agricultural Prices (Oct 30, Nov 30, Dec 30), Chickens and Eggs, Hatchery, Peanut, Cotton Ginnings, and the Nov 30 Crop Progress. Ours is a selection. That is fine for grain and livestock farmers, but bugs 2 and 3 are dates a grain farmer would want.
- **ESMIS release history.** Each past Cattle on Feed (Dec 19, 2025 to Sep 18, 2026) has pdf, txt and zip downloads. With "Show past" on, our past rows link to nothing from USDA's own release.
- **ESMIS states its time precisely ("Oct 23 2026 3:00 PM").** Ours does too for livestock. No gap.

## Five changes, ranked
1. **Build the .ics and the homepage strip from the same report list as the page (S).** Generate usda-calendar.ics from one data file that the page also reads, and include the livestock rows, possibly as a second "Livestock" feed. Why: it fixes bug 1 at the root, and two hand-kept copies will drift again. Honesty risk: none; it removes a stale copy.
2. **Add the Nov 30 Crop Progress and the Dec 10 Crop Production (S).** End the season on the last Monday NASS lists, not on Thanksgiving week, and fix the explainer and home.js `cpSeason`. Honesty risk: none.
3. **A "USDA release" link on past rows (S).** Link each past WASDE, Crop Production, Cattle on Feed and so on to its ESMIS release page, so "what did it say" is one tap away. Honesty risk: none.
4. **CFTC COT on Fridays, 3:30 PM ET, linked to /cot (S).** It was carried over from Oct 15. The homepage already counts down to it ("next in 3h 7m"), but the calendar does not list it. Honesty risk: holiday shifts must be stated the way the weekly rows already do it.
5. **"What it did" on past report days (M).** Show the corn and soybean move from the prior settle, plus the What's priced in grade, using the settle series the site already keeps. Load it on demand, only when "Show past" is on. Honesty risk: medium. Use settle to settle, name the contract, and do not imply the report alone caused the move.

## Verdict
**Close.** For a farmer, this is the most complete and readable single report calendar among the copies I could read, and every date I checked against the NASS PDF is right. It is not "yes" yet: the subscribe feed and the homepage strip leave out the livestock reports the page now lists, and the season's last Crop Progress is missing.

**Change since Oct 15:** 38 to 40 (+2: depth and unique, from the livestock rows and the January note). The competitor scores are now from saved copies, not snippets: NASS 32 to 31, and ESMIS is new.
