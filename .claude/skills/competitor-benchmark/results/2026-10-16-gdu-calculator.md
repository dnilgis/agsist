# Head to head: agsist.com/gdu-calculator

Checked Oct 16, 2026. I rendered gdu-calculator.html from the checkout at 390x844 and 1280x800. No sideways scroll, no JS errors, about 434 KB loaded uncompressed (one blocked outside call, Google Tag Manager). The checkout matches origin/main for this page (main is ahead only by data commits).

Weather hosts are blocked here, so I ran the live path with mocked Open-Meteo and Nominatim answers (service worker off so the mocks reach the page): a fixed daily high and low for the season, and a fixed high and low for the 1991-2020 normal download. Then I worked the output by hand.

Competitors were scored only from the copies GitHub Actions fetched on Oct 16 (references branch, bench-gdu-calculator-1..5). I did not render them, so phone and speed are "?" unless the copy shows them, and their totals are out of fewer than 50.
- **U2U / MRCC (mrcc.purdue.edu/U2U/gdd/):** HTTP 404 from direct and curl, no Wayback copy. Not readable. The URL in our list is dead; the tool may live elsewhere.
- **Pioneer tools page:** HTTP 404, no Wayback copy. Not readable.
- **Golden Harvest GDU article:** the saved text is an empty shell (only a feedback form). Not readable.
- **NC State corn dashboard:** not in this run's fetch set. Not readable.
- **Kansas Mesonet degree days:** readable, but only the form and method, no computed values.
- **Ag PhD GDU Calculator (App Store listing):** readable listing; the app itself is not.

## What changed since Oct 15
- **Fixed: matured-crop date.** A crop past the target now gets the day it crossed, walked from the real daily series, and the freeze verdict compares with that day.
- **Fixed: Wisconsin rates in Iowa and Illinois.** The projection now walks forward at this spot's own 1991-2020 daily GDU average (ERA5 via Open-Meteo, kept in the browser per spot) and runs through Oct 31. Wisconsin monthly rates are only the fallback when that download fails, and outside the Upper Midwest the date is then withheld.
- **Still open:** no late-planting target adjustment, freeze date still typed by hand, answer still below the setup form on a phone, FAQ "110-day roughly 2,670" vs the tool's 2,650.

## Numbers checked by hand (no errors in the math)
- **A. Mid-season (May 1 to Aug 1, 84/62 every day, normal 80/60, 108 RM, freeze Sep 20):**
  - Daily GDU (84 + 62) / 2 - 50 = 23. 93 days (inclusive) x 23 = 2,139. Matches.
  - Target 108 x 22 + 250 = 2,626, rounded to 2,650. Left 511 at the normal's 20 a day = 25.6, so day 26 after Aug 1 = Aug 27. Page: "August 27, 2026", "26 days". Matches.
  - Freeze Sep 20 minus Aug 27 = 24 days. Page: "24 days to spare". Matches.
- **B. Matured (May 1 to Oct 14, 84/62, freeze Oct 5): the Oct 15 high bug, now fixed.**
  - 167 x 23 = 3,841. 2,650 / 23 = 115.2, so the 116th day, May 1 + 115 = Aug 24.
  - Page: "Reached black layer about August 24, 2026", "42 days to spare" (Oct 5 minus Aug 24 = 42). Matches.
  - Example mode (82/58, 20 a day): 2,650 / 20 = 132.5, day 133 = Sep 11; freeze Oct 5 gives 24 days. Page matches.
- **C. Late planting with archive lag (Jun 10, data through Oct 10, end Oct 14, 76/56, normal 70/50):**
  - 123 days x 16 = 1,968. Matches, and the status line says the last 4 days are projected at the local normal.
  - Left 682; Oct 11-31 is 21 days x 10 = 210. Not reached, so no date and "Not reached by Oct 31". Correct.
- **D. Kansas, normal download fails (Jun 10 to Aug 15, 90/68):** the high is capped at 86, so (86 + 68) / 2 - 50 = 27, and 67 days x 27 = 1,809. Page 1,809. Matches. The date is withheld with a plain reason. Correct.
- **E. 115 RM planted Jun 5 (86/66, normal 80/58, freeze Oct 10):**
  - 72 days x 26 = 1,872. Target 115 x 22 + 250 = 2,780, rounded to 2,800.
  - Left 928 at 19 a day = 48.8, so day 49 = Oct 3; 7 days to spare. Page matches.
  - No late-planting cut is applied. On Oct 15 a Purdue (Nielsen) search snippet said hybrids planted after about May 1 need about 6.8 fewer GDD per day of delay; I could not re-read that source this run, so this stays a gap to verify, not a bug.

## Bugs and loose ends
- **Low: FAQ and tool disagree for a 110-day hybrid.** The FAQ and JSON-LD say "a 110-day hybrid roughly 2,670"; the tool rounds 110 x 22 + 250 = 2,670 to 2,650 and shows 2,650.
- **Medium (cross-page): Fast Facts carries older stage tables.** components/fast-facts.js has two corn tables (timeline and quick GDU calc) with V12 900, VT 1,250, R3 1,750, R5 2,200, values this page's own source notes call wrong or unsourced (it uses NCH-40: V12 870, VT 1,135-1,350, no R3, R5 2,190). Soybean stages disagree far more: at 1,020 GDU Fast Facts says R5, this page's table says R2. A farmer who checks both gets two answers.
- **Low: tools hub card is stale.** /tools still says "Wisconsin 30-year normals shown as a reference"; the page now projects from local 1991-2020 normals.
- **Low: "Days since planting 166" next to 167 days of data counted** (the archive range is inclusive). The average divides by 167, so the math is right; only the label differs by a day.

## Scores (1-5)

| Page | First screen | Current | Accurate/sourced | Local | Clear | Depth | Phone | Trust | Speed | Unique | Total | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **AGSIST /gdu-calculator** | 3 | 4 | 4 | 5 | 4 | 4 | 3 | 4 | 4 | 4 | **39/50** | rendered Oct 16, mocked weather, hand-checked |
| Kansas Mesonet degree days (K-State) | 2 | ? | 4 | 3 | 2 | 4 | ? | 5 | ? | 3 | 23/35 | fetched Oct 16; form, equation, caps, CSV, graph, stress degree days and references visible; no computed values in the copy |
| Ag PhD GDU Calculator (iOS listing) | ? | 3 | 2 | ? | ? | 3 | 4 | 3 | ? | 3 | 18/30 | fetched Oct 16; listing only; v1.6.0 Nov 2024; no method or source stated |
| U2U / MRCC Corn GDD tool | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | not readable: HTTP 404, no archive |
| Pioneer GDU calculator | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | not readable: HTTP 404, no archive |
| Golden Harvest GDU guide | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | not readable: empty shell |
| NC State corn GDD dashboard | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | not fetched this run |

On the same 7 parts Kansas Mesonet was scored on, we score 28 to its 23. On Ag PhD's 6 parts, 23 to 18.

## Where we win
- **Your own weather from a ZIP, projected at your spot's own normal.** Kansas Mesonet covers its own stations only; Ag PhD's listing does not say where its temperatures come from.
- **Honest about what it does not know.** Missing archive days are named and not counted, pending days are projected and said so, a failed normal download withholds the date outside the Upper Midwest, and soybean groups past MG 1.1 get no target.
- **No login, no seed brand, method on the page.**

## Where they beat us, and how
- **Kansas Mesonet:** "CSV Data ... Download" of the full daily table, a graph, adjustable caps ("Temperatures above ATmax will be set to ATmax") and a stress degree day count above 86. We show a total and stages but give no daily table to download.
- **Ag PhD app:** "push notifications informing growers of potential problems in their fields based on their crop growth stage". We have no reminder of any kind. (A push channel is not worth building here; noted for completeness.)
- **U2U (Oct 15 snippet, not re-read):** frost odds from history at your location. We still ask the farmer to type a freeze date.

## Five changes, ranked
1. **Fill the typical first 28°F freeze from the normal we already download (S-M).** The 1991-2020 daily lows for the spot are already in the browser. Take the median first day at or below 28°F after Jul 1 and prefill the box, labeled "ERA5 grid cell, 1991-2020 median, not a station". Why: in October the question is "did the freeze beat black layer?", and today the box is blank. Honesty risk: medium. ERA5 grid cells run warmer than low spots on cold nights, so say that and keep the box editable.
2. **Answer first on a phone (S).** After a fetch or a saved field, put the GDU total, stage and black-layer line above the setup form at 390 px. Why: the first phone screen is all inputs. Honesty risk: low.
3. **One corn and one soybean stage table for the site (S).** Make Fast Facts read this page's NCH-40 table (or a shared data file) and drop its own two copies. Why: two pages give different stages for the same GDU total. Honesty risk: low; it removes unsourced numbers.
4. **Late-planting target cut, after reading the primary source (S).** Read Nielsen et al. (Purdue) first; if it holds, subtract its per-day amount after its cutoff date, labeled with the source and its region. Why: a June-planted field looks further from black layer than it is. Honesty risk: medium; the effect is regional and year-dependent, so show it as a range or a labeled adjustment, never silently.
5. **Daily table on demand and the small label fixes (S).** A "show the days" table and a CSV download built from the series already in memory (no page weight). Fix the FAQ 2,670 vs 2,650 line and the /tools card. Honesty risk: low.

## Verdict
Best on the internet today? **Close.** The two Oct 15 errors are fixed and every case I worked matches by hand. No readable competitor matched it this run, but the U2U and NC State tools could not be read, so I can't call it the best. What is left is the freeze date, phone order and the late-planting cut.

**Change since Oct 15: 36 to 39 (+3).** Accurate 3 to 4 (matured-crop date fixed), local 4 to 5 (local normals), unique 3 to 4.
