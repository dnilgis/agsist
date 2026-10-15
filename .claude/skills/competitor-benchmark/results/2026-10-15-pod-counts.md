# Head to head: agsist.com/pod-counts

Checked Oct 15, 2026, from the read-only checkout. I rendered pod-counts.html at 390x844 and 1280x800. No sideways scroll, no JS errors, about 390 KB loaded, and the charts are inline SVG.

**What I could not see:** I could not open any competitor host. Competitor cells are from search-result text and are marked *.

## Numbers checked by hand
I re-derived the fits from the 28 demeaned points printed in the chart tooltips.
- **Soybeans, within state:**
  - r = **0.658**, shown as +0.66. Matches.
  - Slope 0.02272 bu per pod, so **44.0 pods per bushel**. Matches "about 44 (0.0227)".
  - Residual SD over 20 degrees of freedom: **2.89 bu**. Matches.
- **Corn control:**
  - r = 0.851, shown as +0.85. Matches.
  - Residual SD: 5.61, against 5.55 printed. That gap is consistent with the tooltips being rounded to whole numbers.
- **Year-over-year direction:**
  - Soybeans agree in 14 of 21. Matches.
  - Corn agrees in 15 of 21 from the rounded tooltips, against 16 printed. One pair (OH 2023 to 2024) rounds to a tie, so 16 is plausible.
- **Overstatement from extension divisors:**
  - 22.0 / 15 = 1.47 and 23.5 / 15 = 1.57, so 47-57%. Matches.
  - At 18: 22-31%. Matches.
- **Band and ratio:**
  - 95% band: 2.89 x 1.96 = 5.7, so "about ±6". Pooled 3.95 x 1.96 = 7.7, so "nearly ±8". Matches.
  - 5.3% / 3.0% = 1.77, shown as "about 1.8x". Matches.
- **No errors found.** I could not check the source pod counts and NASS yields against Pro Farmer or NASS from here.

## Scores (1-5)

| Page | First screen | Current | Accurate/sourced | Local | Clear | Depth | Phone | Trust | Speed | Unique | Total |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **AGSIST /pod-counts** | 4 | 3 | 5 | 2 | 4 | 4 | 4 | 5 | 5 | 5 | **41** |
| Extension pod-count yield formulas (Purdue, Iowa State, Ohio State)* | 3 | 2 | 5 | 4 | 4 | 3 | 3 | 5 | 4 | 3 | 36 |
| Pro Farmer Crop Tour coverage (and wire reports of it)* | 3 | 4 | 4 | 2 | 4 | 3 | 4 | 4 | 3 | 4 | 35 |

\* from search snippets only; not opened. A search for "Pro Farmer pod count yield conversion divide by" returned no conversion anywhere, only Pro Farmer's line that pods per bushel vary by state and year*. That gap is what this page fills.

## Where we win
- **The only published measurement I found** of what tour pod counts predict, with a control (corn), out-of-sample caveats, and degrees of freedom stated.
- **It debunks the "divide by 27" rule with three routes,** and refuses to print a point yield. That is the honest-numbers rule done right.

## Where a competitor beats us, and how
- **Your own field (extension formulas).** Purdue and ISU let a farmer count his own pods and get a yield*. This page is state-level only, by design.
- **Currency.** The 2026 tour ran in August. The page is 2022-2025 and dated Aug 19. It should say when 2026 joins: after the January 2027 NASS annual.

## Five changes, ranked by impact
1. **Put a dated line on the 2026 state pod counts now (S).** Show them as a difference from each state's mean, with the ±6 bu band, labeled "AGSIST calibration, not a Pro Farmer number". Mark it "final check January 2027".
2. **Add the 2021 and earlier year-ago pairs (M).** The page notes each nightly report carries a year-ago figure. Adding them would firm up the year that carries the fit (dropping 2025 takes r to 0.47).
3. **A short "count your own field" sidebar (S).** It explains why extension divisors (15-18) do not apply to tour counts, and links to Purdue's or ISU's own method. No calculator: the page's point is the scale difference.
4. **Download the 28 rows as CSV (S).** The Dataset JSON-LD promises data. Give it a contentUrl.
5. **Visible byline (S).** "Sigurd Lindquist, Certified Crop Adviser (CCA)" next to the working-paper date.

## Verdict
Best on the internet today? **Yes.** No one else publishes this measurement. The statistics re-derive from the page's own points, and it is careful about what it will not claim.
