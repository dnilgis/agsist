# Head to head: agsist.com/storage-crunch (a redirect; scored as /basis#storage, "Why basis is wide this fall")

Checked Oct 16, 2026. storage-crunch.html is still a redirect (meta refresh plus location.replace) to /basis#storage, canonical /basis. I confirmed it fires in the browser. I scored the storage section of basis.html#storage, rendered at 390x844 and 1280x800, and looked at both. The section opens itself on the hash. No sideways scroll, no JS errors, about 480 KB loaded. The section was built Oct 14 from the Oct 9 NASS forecast (data/storage/storage.json). The basis page as a whole has its own report.

Competitors are scored only from copies saved on the references branch (fetched Oct 16). farmdoc daily, AFBF, High Plains Journal and Purdue were readable. **Univ. of Kentucky ("large crops put pressure on grain storage") was not fetched** (no entry in the references index), so its cells are "?".

## Numbers checked by hand (ratio = (Sept 1 stocks + 2026 fall crop) / capacity)
- Missouri (99 + 910) / 860 = **1.17**. Indiana 1,537 / 1,410 = **1.09**. Michigan 566 / 540 = **1.05**. Minnesota 2,352 / 2,370 = **0.99**. Kansas (431 + 1,133) / 1,605 = **0.97**, and Kansas's 1,133 = 818.75 corn + 154.77 soybeans + 159.25 sorghum, so sorghum is now in. All match.
- **Lower bounds, new since Oct 15:** Kentucky (13 + 374) / 357 = 1.084, shown "at least 1.08x". Mississippi 277 / 200 = 1.385, "at least 1.38x". Tennessee 254 / 188 = 1.351, "at least 1.35x". Wisconsin 808 / 780 = 1.036, "at least 1.03x". The floors round down, which is the honest direction.
- **Against farmdoc (fetched copy):** farmdoc's range is "about 85% to 119%"; ours runs 0.86 to 1.17 for the full-data states. farmdoc lists 10 of 13 states over 100% and names Kentucky and Wisconsin among them; ours shows both as "at least" over 1.0, consistent. Our order differs a little (we put Ohio above Indiana and Iowa; farmdoc puts Ohio below Wisconsin). farmdoc's Oct 7 article predates the Oct 9 NASS forecast we use, so a different order is expected. The page does not say that.
- **Oct 15 fixes shipped:** the section now gives farmdoc's conclusion ("a storage crunch is unlikely in 2026", the cleared-by-December history), shows Wisconsin and three more states as lower bounds, includes sorghum, and the phone layout now shows state, ratio and the inputs on one line, with no hidden columns.

## Scores (1-5)

| Page | First screen | Current | Accurate/sourced | Local | Clear | Depth | Phone | Trust | Speed | Unique | Total | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **AGSIST storage section (/basis#storage)** | 4 | 5 | 5 | 3 | 4 | 3 | 4 | 4 | 4 | 4 | **40** | rendered Oct 16, 390 and 1280 |
| farmdoc daily, Enough Room for the Harvest? (Oct 7, 2026) | 3 | 5 | 5 | 3 | 4 | 5 | 3 | 5 | 3 | 5 | 41 | fetched Oct 16 |
| Purdue basis update (Aug 21, 2026, PDF) | 3 | 3 | 5 | 4 | 4 | 3 | 2 | 5 | 3 | 3 | 35 | fetched Oct 16 |
| High Plains Journal, storage capacity bulging (Jan 23, 2026) | 2 | 2 | 4 | 3 | 3 | 3 | 3 | 3 | 3 | 2 | 28 | fetched Oct 16 |
| AFBF Market Intel, Grain storage remains tight (Oct 16, 2025) | 3 | 1 | 4 | 1 | 4 | 3 | 3 | 4 | 2 | 2 | 27 | fetched Oct 16; a year old, about the 2025 crop |
| Univ. of Kentucky, large crops pressure storage | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | not fetched this run |

Phone and speed for competitors are judged from the saved files (HTML with a viewport tag, or PDF) and size, not a render.

## Where we win
- **It rebuilds with every NASS forecast** and sits next to the farmer's basis. farmdoc's article is fixed at Oct 7 and used the September forecast.
- **More states, honestly bounded.** 11 full ratios plus 4 "at least" floors and a list of 21 states with no ratio and why. farmdoc covers 13 Corn Belt states.
- **Every input is printed** on the row (stocks, crop, bins), so a farmer can check the ratio himself.
- **It now carries the source's own conclusion**, so 1.08x does not read as "Iowa is out of room".

## Where farmdoc beats us, and how
- **History of how fast each state clears the pressure.** farmdoc compares fall pressure with December 1 utilization for 2000-2025, with 10th and 90th percentile ranges, and names state drawdowns: Illinois "relieves only about 22 percentage points, leaving December utilization at 81%", Kentucky and Missouri about 51 and 38 points. We quote their conclusion but show no history of our own.
- **Trend decomposition.** farmdoc splits each state's crop into a trend-yield part and an above or below trend part, so a reader sees which states are crowded because of a big crop.
- **National line.** farmdoc: stocks plus the forecast crop are "about 99% of total US storage capacity". We have no national figure.
- **Capacity trend.** farmdoc cites "storage capacity increases have not kept pace in the past five years". Our storage.json has capacity back to 2000 but the section does not use it.
- **Purdue, for the basis half of the heading:** district-level basis with "lowest for this time of year since the 2009-2010 marketing year" history. Our section asserts storage drives basis but shows no basis against normal for the crowded states.

## Bugs
1. **Low:** the lower-bound rows say "no figure for corn, soybeans" (Mississippi) right above "277 crop". The missing figure is the September 1 stocks, not the crop, so the note reads as if the crop left out corn and soybeans. It should say "no Sept 1 stocks figure for corn, soybeans".
2. **Low:** the page does not say its ranking can differ from farmdoc's because it uses the later Oct 9 forecast, though it cites farmdoc as the "same measure".

## Five changes, ranked
1. **Our own Sept-to-December history per state (M).** From NASS December 1 stocks over capacity, 2000-2025: "Iowa: fall pressure averaged X, December use Y; this year Z." Load it from a per-state data file when the reader opens a row, not in the page. Honesty risk: low (published NASS data, our arithmetic, printed method).
2. **A national line (S).** "US total: X.XX (all states with capacity)." The national block in storage.json already has capacity. Honesty risk: low.
3. **Fix the "no figure for" wording (S).** "No Sept 1 stocks figure for ..." Honesty risk: none.
4. **Capacity trend per state (S).** "Bins +X% since 2020, fall crop +Y%," from storage.json. Honesty risk: low; say which years.
5. **Say which forecast and why the order differs from farmdoc (S).** One line: "farmdoc used the September forecast; this uses the Oct 9 forecast, so the order can differ." Honesty risk: none.

## Verdict
Best on the internet today? **Close.** Every ratio checks out, all three Oct 15 fixes shipped, and it is the only live, every-state version of the measure. farmdoc still edges it by one point because it shows how fast each state has cleared the pressure in past years, which is the part that tells a farmer whether 1.08x matters.

**Change since Oct 15:** 38 to 40 (+2). Accuracy (farmdoc's conclusion, lower bounds, sorghum) and phone layout each gained a point. farmdoc moved from 40 (snippets) to 41 (read in full).
