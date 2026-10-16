# Head to head: agsist.com/scorecard (prediction bot), 2026-10-16

I rendered scorecard.html locally at 390 x 844 and 1280 x 800, with the service worker and outside hosts blocked. There was no sideways scroll and no page errors (the only console error is the blocked analytics tag). The phone page is 6,046 px tall.
- **Data on the page:** data/predictions.json, updated 2026-10-15 22:40Z. There are four open calls made at the Oct 5 close, grading Nov 2. The live record has 0 graded calls.

**Competitor copies** come from origin/references, fetched Oct 16:
- **Read:**
  - bench-scorecard-1: the farmdoc AgMAS 1995-2004 publication page.
  - The farmdoc daily yield model article. It has the same URL as bench-conditions-5 (Aug 12).
- **Not readable:**
  - OSU advisory-firm PDF (-2): HTTP 403, no archive.
  - AgMAS wheat study (-3): an HTML landing page came back, not the PDF.
  - Pro Farmer Daily Advice Monitor: profarmer.com home and member content, no copy fetched.
  - These are marked "?".

## What changed since Oct 15
- **Change #2 shipped.** The first paragraph now reads: "In plain words: replayed on history since 2013, the bot's rule was right 47.6% of the time, no better than a coin flip. I publish its calls anyway, graded by code, so you can hold any market call to the same test."
- **Change #4 partly shipped.** The "96 in 100" figure is tied to a named test (Newey-West on all calls, explained in the folded definitions). The adjustment is Benjamini-Hochberg across the 5 records (scripts/prediction_bot.py, family()), but the page says only "adjusting for the records tested at once".
- **Not done:**
  - #1: where each open call stands
  - #3: the Chicago wheat reason still reads "13-week trend up (87th percentile of the last 156 reports)"
  - #5: grading outside calls
- **New since Oct 15:** "Days with no call" lists all four crops for the Oct 6 COT report: "missed: no run at its entry close on 2026-10-13; never made late".

## Numbers checked by hand
- **Backtest:**
  - 347 + 318 + 330 + 306 = 1,301 of 2,736 = **47.6%**.
  - By crop: 50.7 / 46.5 / 48.2 / 44.7%.
  - Match.
- **"96 in 100":** the stored hac_z is -1.7352.
  - Φ(1.7352) = 0.9587, so **about 96 in 100** guess at least this well.
  - p_worse = 0.0413, so **about 4 in 100**.
  - The adjusted p_worse of 0.103 ("about 10 in 100") is the BH output in the file.
  - Match.
- **"Below half in 4 of 5 ways":** the five ways are 47.6, 44.6, 51.2 and two more offsets. The verdict function counts ways under 50, and the stored verdict_text agrees. Consistent.
- **Entries against data/harvest-prices.json:**
  - Dec corn Oct 5 settle 4.9725 = entry **$4.9725**.
  - Nov beans 12.8075 = **$12.8075**.
  - Match.
- **Where the open calls stand (not graded):**
  - Dec corn Oct 15 settle 4.7825, which is 19.0 cents under entry on a down call.
  - Nov beans 12.6425, 16.5 cents under entry on a down call.
  - The page shows neither.
- **No calculation errors.**

## Scores (1-5)

| | First screen | Current | Accurate+sourced | Local | Clear | Depth | Phone | Trust | Speed | Unique | Total | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **AGSIST /scorecard** | 5 | 3 | 5 | 1 | 4 | 5 | 4 | 5 | 4 | 5 | **41** | rendered Oct 16; numbers hand-checked |
| farmdoc daily / Ibendahl model vs USDA (forecast-accuracy record) | 3 | 2 | 5 | 2 | 3 | 5 | 3 | 5 | 4 | 3 | 35 | fetched Oct 16 (article of Aug 12) |
| farmdoc AgMAS advisory pricing performance 1995-2004 | 3 | 1 | 5 | 2 | 2 | 4 | 3 | 5 | 4 | 4 | 33 | fetched Oct 16 (publication page and abstract; 2006 report) |
| OSU performance of market advisory firms | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | n/a | not readable (HTTP 403, no archive) |
| AgMAS wheat study (AgEcon Search) | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | n/a | not readable (HTML landing page, no PDF) |
| Pro Farmer Daily Advice Monitor | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | n/a | not readable (member content, no copy) |

**Why the scores moved:**
- **First screen 4 → 5:** the plain-words lead.
- **Clear 3 → 4:** the statistics now sit under that plain sentence.
- **Current 4 → 3:** a full week of calls was missed, so the live record grows at half speed and still shows only the Oct 5 calls.

## Where we win
- **There is still no public, code-graded record of grain direction calls anywhere I can read.** The rule is written down before the first call, there is a backtest that says "no better than a coin flip", and the live record is kept apart from it. Hand corrections and missed days are disclosed.
- **The tests are stated.** Newey-West on overlapping calls, disjoint groups by report week, and a family adjustment. The academic copies use comparable rigor, but on 20-year-old data.

## Where they beat us (from the saved copies)
- **AgMAS measures money, not direction.** The copy says it computes "the net price received by a subscriber" after "storage costs ... interest opportunity costs ... brokerage costs". It reports the result per acre: "the average advisory return relative to the farmer benchmarks is 8 to $12 per acre". A farmer can act on dollars per acre. A 47.6% hit rate does not say whether following the calls made or lost money per bushel.
- **AgMAS tests persistence.** "It is difficult to predict the year-to-year pricing performance of advisory programs based on past pricing performance." That is the question a farmer has about any advisor. We have the data to ask it of our bot (backtest hit rate year by year) and do not show it.
- **Ibendahl turns a forecast record into a usable rule of thumb.** USDA's August corn number has missed by "a standard deviation of about 5.3 bu/ac ... 4.5 in September and 3.0 in October", and "roughly 77% of August's miss remained in the September report". Our page tells a farmer the bot is a coin flip but gives nothing comparable to carry to other calls.

## Bugs

| # | Finding | Severity |
|---|---|---|
| SC1 | **A full week of calls missed.** All four crops for the Oct 6 COT report were "missed: no run at its entry close on 2026-10-13; never made late". That was the Columbus Day week, when the release date shifted. Half of the possible live calls to date (4 of 8) were never made, so the live record will take twice as long to reach the 40-call gate. It is disclosed honestly, but the scheduler should not miss a holiday-shifted entry. | Medium |
| SC2 | "Days with no call" shows the date as "Oct 15, 2026" while the missed entry close was Oct 13 and the report is dated Oct 6. Three dates for one miss; a reader can't tell which is the call date. | Low |
| SC3 | The Chicago wheat reason "13-week trend up (87th percentile of the last 156 reports)" still reads as if the percentile is the trend. It is the fund rank (carried from Oct 15). | Low |

## Five changes, ranked
1. **Add a "where it stands" column for open calls (S).**
   - What: the latest settle against the entry, for example "Dec corn $4.78 1/4 on Oct 15, 19 cents under entry; a down call is on the right side so far". Label it "not graded; the grade uses the Nov 2 close only".
   - Why: it is the first thing a visitor wants to know, and the settles are already in data/harvest-prices.json.
   - Honesty risk: low if it is clearly marked as not a grade and never counted in the record.
2. **Stop missing holiday weeks (S).**
   - What: run a catch-up job the day after a holiday-shifted COT release, plus an alert when a scheduled entry passes with no call. Show one date per miss (the entry close) in "Days with no call".
   - Why: half the live calls so far were never made, and the live record is the whole point of the page.
   - Honesty risk: none; a call made late must still never be made (current rule).
3. **Cents per bushel next to the hit rate (M).**
   - What: from the backtest, the average move in the called direction per call, and the share of calls where the move beat 5 cents, before costs. Put it in a fold, loaded from predictions-backtest.json.
   - Why: AgMAS shows farmers judge advice in dollars. A 47.6% hit rate could still gain or lose money, and the page should say which.
   - Honesty risk: medium. It must be labeled hypothetical, before brokerage and basis, not a trading result, with "not advice" kept. Withhold it if the cents figure is within its own noise band.
4. **A year-by-year backtest strip (S).**
   - What: the hit rate for each year 2013-2026, plus one line on whether a good year predicted the next. Load it from the backtest file on demand.
   - Why: it answers AgMAS's persistence question for our own rule. It also shows a farmer why a hot streak from any advisor means little.
   - Honesty risk: low; show every year, the bad ones included.
5. **Grade outside public calls the same way (L; needs Sig's say).**
   - What: dated, public direction calls from named analysts, graded by the same code.
   - Why: it gives the page a use beyond our own coin flip.
   - Honesty risk: medium. Only quotable, dated calls, never paraphrased; no copying of paid content; publish misses and hits alike.

## Verdict
**Yes, with no readable direct competitor.**
- The closest work is academic and 20 years old (AgMAS) or about USDA yields (Ibendahl).
- The numbers check.
- The weak spots are usefulness (no money view, no "where it stands") and the missed holiday week.
- Change in our total since Oct 15: **40 → 41 (+1)**.
