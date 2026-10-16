# Head to head: agsist.com/usda-quick-stats

Checked Oct 16, 2026, from the read-only checkout. I served the repo locally and rendered usda-quick-stats.html at 390x844 and 1280x800. No sideways page scroll at either width. The only failed request was the blocked analytics host. About 466 KB loaded, and the HTML is 86 KB.

Competitors were scored only from the copies GitHub Actions saved on the references branch (fetched Oct 16). Two of the five registry entries had no saved copy under the bench-usda-quick-stats ids. The NASS October briefing and the DTN Oct 9 report were saved under other ids (bench-conditions-yield-1 and bench-whats-priced-in-3), so I used those copies. NASS Quick Stats itself was not fetched because it is a JS query app, so its cells are "?".

## Numbers checked by hand
- **October 2026 state forecasts against the saved NASS Oct 9 briefing (bench-conditions-yield-1).** All ten match exactly:
  - Corn yield and production: Iowa 219 bu/ac and 2,803 M bu (NASS 2,803,200 thousand bu). Illinois 208 and 2,278 (NASS 2,277,600). Nebraska 188 and 1,807 (NASS 1,806,680). Minnesota 195 and 1,618. Indiana 200 and 1,032.
  - Soybean yield and production: Illinois 68 and 709. Iowa 63 and 613. Minnesota 49 and 359. Indiana 63 and 355. Nebraska 59 and 312.
  - Harvested acres in data/state-stats.json: Iowa 12.8 M (NASS 12,800 thousand). Illinois 10.9 (NASS 10,950). Nebraska 9.6 (NASS 9,610). These are consistent.
- **Year-over-year changes in the briefing agree with our 2025 finals table:**
  - Iowa 210 to 219 is +4.3%, and NASS prints +4.3.
  - Illinois 214 to 208 is -2.8%, and NASS prints -2.8.
  - Nebraska 194 to 188 is -3.1%, and NASS prints -3.1.
  - Illinois soybeans: 68 / 1.088 = 62.5, which matches the 2025 final.
- **2025 national cards (production = harvested acres x yield):**
  - Corn: 91.3 M ac x 186.5 = 17.03 B bu, shown as 17.0. +14% matches.
  - Soybeans: 80.4 x 53.0 = 4.26 B bu. Shown as -2% against 4.37.
  - Wheat: 37.2 x 53.3 = 1.98 B bu. Yield 53.3 - 51.2 = +2.1.
  - The "record yield" tags are right. Soybeans at 53.0 beat the 2016 high of 51.9, and corn at 186.5 beats 179.3.
- **No math errors found.**
- **Carried over from Oct 15 (not an error):** the $10.50 soybean MYA for 2025/26 is still shown as "final" with no release date.

## Scores (1-5)

| Page | First screen | Current | Accurate/sourced | Local | Clear | Depth | Phone | Trust | Speed | Unique | Total | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **AGSIST /usda-quick-stats** | 5 | 5 | 5 | 4 | 4 | 5 | 3 | 5 | 3 | 3 | **42** | rendered Oct 16; 10 of 10 state figures match NASS briefing |
| USDA NASS Oct 9 Crop Production briefing (PDF) | 3 | 5 | 5 | 3 | 3 | 3 | 2 | 5 | 1 | 4 | 34 | fetched Oct 16 (bench-conditions-yield-1), 4.8 MB slide PDF |
| DTN, "October WASDE's Shocking Rise in Corn Yield" (Oct 9) | 4 | 5 | 4 | 2 | 4 | 2 | ? | 4 | 2 | 3 | 30 + ? | fetched Oct 16 (bench-whats-priced-in-3); ad slots in text; phone not rendered |
| USDA NASS Charts and Maps | 1 | 4 | 5 | 2 | 2 | 4 | ? | 5 | ? | 2 | 25 + ? | fetched Oct 16 (bench-usda-quick-stats-3); a link hub, no numbers on the page |
| farmdoc FAST crop yield database ("Yield Risk Evaluator") | 1 | 2 | ? | 4 | ? | 4 | ? | 5 | ? | 3 | 19 + ? | fetched Oct 16 (bench-usda-quick-stats-2); the copy is only a title, a four-line description and a download link |
| USDA NASS Quick Stats | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | not fetched (JS query app); not readable |

## Where we win
- **The state answer is on the first screen, and it is exact.** "Corn Iowa 219, Illinois 208..." matches the NASS briefing to the bushel. The briefing makes you page through a 4.8 MB slide deck to find the same table. DTN's story leads with national numbers and has no USDA state table.
- **Every state since 2010 in one place, with CSV.** farmdoc's saved copy says its tool covers "Minnesota, Indiana, Illinois, and Iowa", was "Last Updated: June 30, 2025", and is a download. NASS Charts and Maps is a page of links.
- **Three Oct 15 fixes shipped.**
  - The byline is under the H1.
  - Each state links to /yield/<state> with its top counties.
  - The query builder now lists all 50 states.

## Where a competitor beats us, and how
- **The national October number (NASS briefing, DTN).** The briefing's first crop table gives U.S. corn at 181.2 bu/ac and 16,033,944 thousand bu, and soybeans at 53.1 bu/ac and 4,561,605 thousand bu. DTN's lead is the national yield against the trade guess. Our page never states the 2026 national forecast: the hero has only state yields, and the national cards are 2025. Someone searching "USDA October 2026 yield" has to click away for the U.S. number. (DTN's copy says 181.1. The NASS table says 181.2, and 16,033,944 / 88,506 = 181.16.)
- **Context for the change (NASS briefing).** The briefing prints each state's change from last month and last year next to the number, for example Iowa ↑4.3 and Nebraska ↓3.1. Our hero line gives the October number with no change, so the reader cannot tell whether 219 is up or down.
- **Phone table order.** The data explorer table starts at 2010 on the left. At 390 px only 2010 to 2013 show, and the newest year (2025) needs four screens of sideways scrolling. Neither competitor does better on a phone, but this is our weakest cell.

## Bugs found
- None in the numbers.
- Low (phone usability, not accuracy): the yield table opens on 2010 to 2013 at 390 px, with 2025 off-screen to the right.

## Five changes, ranked
1. **Put the U.S. October forecast and the change on the first screen (S).**
   - Line: "U.S. corn 181.2 bu/ac, 16.03 B bu (USDA Oct 9); soybeans 53.1, 4.56 B bu".
   - Add each state's change from 2025 next to its October number (Iowa 219, +9).
   - Bake it from the same NASS pull that writes data/state-stats.json.
   - Why: it is the first number a farmer wants after a report, and NASS's own briefing leads with it.
   - Honesty risk: low, if the release date is printed and the label says "forecast".
2. **Phone table, newest first (S).**
   - At narrow widths, reverse the columns (2025 on the left) or default to the last 5 years, with "show all years" opening the rest from the same JSON.
   - Why: the current year is invisible on a phone.
   - Honesty risk: none.
3. **"Your state" view (M).**
   - Pick a state and get corn, soybean and wheat yields since 2010 as a small chart, plus the October forecast against its 5-year average, read from the existing JSON.
   - Link to /yield/<state> for counties.
   - Why: this was rank 1 on Oct 15 and is still open. It does more for local and phone use than anything else here.
   - Honesty risk: low. Keep forecast and final visibly apart, as the table note already does.
4. **Date the MYA "final" (S).** Print "NASS Agricultural Prices, <release date>" next to $4.16 and $10.50.
   - Why: "final" with no date is a claim a reader cannot check.
   - Honesty risk: none.
5. **Next report on the page (S).** Add "Next USDA Crop Production: Nov <date>" with a link to /usda-calendar.
   - Why: the forecast changes monthly, and the briefing's own header is its date.
   - Honesty risk: none, if read from the calendar data, not typed by hand.

## Verdict
Best on the internet today? **Yes, for state yield numbers.** All ten October state figures I checked match the NASS briefing exactly, and no saved competitor puts every state on one fast page. The missing U.S. national forecast on the first screen is the gap that matters most.

**Change since Oct 15:** 40 to **42** (+2). Local went from 3 to 4 with the county links, and trust from 4 to 5 with the visible byline.
