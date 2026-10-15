# Head to head: agsist.com/scorecard (prediction bot)

Checked Oct 15, 2026, from the read-only checkout. I rendered scorecard.html at 390x844 and 1280x800. No sideways scroll, no JS errors, about 100 KB loaded. There are four live calls, all open (made Oct 5, grading Nov 2). The live record reads "Not enough calls yet", and the backtest covers 2013-2026.

**What I could not see:** I could not open any competitor host (DNS refusal). Competitor cells are from search-result text and are marked *.

## Numbers checked by hand
- **Backtest:** 347 + 318 + 330 + 306 = 1,301 right of 4 x 684 = 2,736, which is **47.6%**. Matches.
  - Corn 347 / 684 = 50.7%.
  - Soybeans 318 / 684 = 46.5%.
  - Chicago wheat 330 / 684 = 48.2%.
  - KC wheat 306 / 684 = 44.7%.
  - All match.
- **"Always down 51.1% / always up 48.9%":** they sum to 100. Consistent.
- **Entry closes against AGSIST's own settle series (data/harvest-prices.json):**
  - Dec corn Oct 5 settle 4.9725 = entry **$4.9725**.
  - Nov beans 12.8075 = **$12.8075**.
  - Chicago wheat and KC wheat entries ($6.9225, $7.4225) match the cents in each note (692.25, 742.25).
- **Not reproduced:** "odds pure guessing does at least this well: about 96 in 100". A plain binomial on all 2,736 overlapping calls gives about 99.5 in 100. Treating it as 684 non-overlapping calls gives about 90. The page's figure sits between those and depends on its stated method, which I did not re-run. Not an error on its face. The verdict ("no better than a coin flip") holds either way.
- **No errors.**
- **Low:**
  - In "Latest calls", Chicago wheat's reason reads "13-week trend up (87th percentile of the last 156 reports)". The percentile is the fund rank, not the trend, which a reader can misread.
  - There is no "where it stands now" for open calls. Dec corn is $4.79 against the $4.97 entry on a down call.

## Scores (1-5)

| Page | First screen | Current | Accurate/sourced | Local | Clear | Depth | Phone | Trust | Speed | Unique | Total |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **AGSIST /scorecard** | 4 | 4 | 5 | 1 | 3 | 5 | 4 | 5 | 4 | 5 | **40** |
| Academic forecast-accuracy research (farmdoc daily, Irwin et al.)* | 2 | 2 | 5 | 1 | 2 | 4 | 2 | 5 | 3 | 3 | 29 |

\* from search snippets only; not opened.
- **Not scored:** Pro Farmer's Daily Advice Monitor and paid marketing letters. I could not see whether any publishes a graded, timestamped record of its calls. Search for "grain market forecast accuracy track record" found academic studies of USDA and analyst accuracy, but no public scorecard that grades price calls.

## Where we win
- **There is no direct competitor that I could find.** No farm media site or advisory service I found publishes a rule written down before the first call, a backtest that says plainly "no better than a coin flip", and a live record kept apart from it.
- **The hand corrections are disclosed call by call** (evening-trade bars, settle used), and the old briefing scorecard is retired with a note saying so.

## Where a competitor beats us, and how
- **Nobody beats it on honesty.** The weakness is usefulness. A farmer learns the bot is a coin flip, and the page then offers nothing to act on. That is honest and on purpose, but a farmer gets little from the visit.
- **Clarity:** "4 of 5 ways of counting", "170 windows" and "records tested at once" are statistician's terms. The first screen is right but dense.

## Five changes, ranked by impact
1. **A "where each open call stands" column (S):** today's close against the entry, labeled "not graded until Nov 2; the grade uses the Nov 2 close only". It answers the first question a visitor has.
2. **One plain sentence at the top (S):** "So far the rule is a coin flip in 13 years of history. We publish it anyway so you can judge any market call the same way." Move the statistics below it.
3. **Separate the reason from the percentile in "Latest calls" (S).** Write "13-week trend up (funds at 87th percentile, not crowded under the bot's rule)".
4. **Link the method behind "96 in 100" to the exact test (S),** so a reader can rerun it the way I tried to.
5. **Grade outside calls the same way (L, later, needs Sig's say).** Score public, dated price calls from named analysts with the same rule, as /whats-priced-in does for report estimates. That would give the page a reason to exist beyond our own bot.

## Verdict
Best on the internet today? **Yes, with no real competitor.** It is the only public, code-graded record of grain direction calls I found, and the numbers check. Its limit is usefulness to a farmer, not accuracy.
