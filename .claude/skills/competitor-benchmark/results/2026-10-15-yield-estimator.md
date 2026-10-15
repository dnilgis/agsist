# Head to head: yield-estimator.html (agsist.com/yield-estimator), 2026-10-15

I rendered it locally at 390 x 844 and 1280 x 800 (shots in scratchpad/h2h/b4/). There was no sideways scroll and no JS errors. The page needs no live data.
**What I could not see:** WebFetch was blocked here for every outside host (DNS fails for agry.purdue.edu and eupdate.agronomy.ksu.edu). Competitor facts below come from search-result text, and I mark them that way. Nothing about a competitor is guessed.

Farmer queries: "corn yield calculator", "corn yield estimator ear count", "soybean yield calculator pods per plant". Competitors that rank or that experts cite:
- Purdue (Nielsen) "Estimating Corn Grain Yield Prior to Harvest"
- UNL CropWatch "Estimating corn yields" (PDF)
- K-State eUpdate yield component articles and the KSUSoyYieldCalc Android app
- Ohio State C.O.R.N. "Estimating soybean yield" (also behind Corteva's soybean page)
- Omni Calculator corn yield
- Pioneer's in-app Corn Yield Estimator (counts kernels from a photo with machine learning)
- Bayer Canada "corn yield calculator" article

Search also returned a lot of scraped spam ("7+ Best Corn Yield Calculator App"). Our page is one of the few real tools in a noisy results page.

## Scores (1-5)

| | First screen | Current | Accurate+sourced | Local/personal | Clear | Depth | Phone | Trust | Speed | Unique | Total |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **AGSIST** | 3 (number is below the fold at 390 and 1280) | 3 (no date; default 90k is the older constant) | 4 (formulas right; sources named, not linked) | 4 (your counts) | 5 | 4 | 4 | 4 | 5 | 3 | **39** |
| Purdue Nielsen (snippets) | 3 (article, no calculator) | 4 (says modern hybrids run 80-85k) | 5 | 1 | 4 | 5 | 3 | 5 | 4 | 3 | 37 |
| UNL CropWatch PDF (snippets) | 2 | 2 | 5 | 1 | 4 | 4 | 2 (PDF) | 5 | 3 | 2 | 30 |
| K-State eUpdate + soy app (snippets) | 3 | 3 | 5 | 3 | 4 | 4 | 4 (Android only) | 5 | 4 | 3 | 38 |
| Ohio State C.O.R.N. soy (snippets) | 3 | 3 | 5 | 1 | 5 | 3 | 3 | 5 | 4 | 2 | 34 |
| Omni corn yield (snippets) | 4 | 3 | 3 (120k "small kernel" option is extreme) | 3 | 3 | 3 | 3 | 2 | 2 (ads) | 2 | 28 |
| Pioneer app (snippets) | 4 | 3 | 4 | 4 | 4 | 3 | 5 | 3 (seed company) | 3 (app install) | 5 (photo kernel count) | 38 |

## Where we win
- It is the only free web tool that does both crops with extension formulas, handles every common row width (1/1000-acre lengths are all correct: 30" 17'5", 20" 26'2", 36" 14'6", 38" 13'9", 40" 13'1", 15" 34'10", 7.5" 69'8"), and shows an honest range next to the point estimate.
- The math is exposed and plain. The page says the 65k to 95k range is kernel weight, not field error, which most tools blur.
- It refuses to compute when a box is blank instead of filling a hidden default, and it carries a CCA byline. It is fast and has no ads.

## Where competitors beat us, and how
- **Kernel factor.** Purdue (Nielsen), whom we cite, now says 80 to 85 is "more realistic" for modern hybrids than 90 (search snippets of the Corny News article, also on Ohio State and Farm Progress). Michigan State and K-State give 75-80k for excellent fill, 85-90k average and 95-105k poor (snippets). We headline 90 with no fill-condition choice. At the default counts that is 193 bu, vs 205 at 85k and 217 at 80k. We sit on the conservative side of what our own named source says.
- **Several sites.** Every extension method says to sample 4 or 5+ sites and average them. Our tool takes one site, so the farmer averages on paper.
- **Photo counting.** Pioneer's app counts kernels from a phone photo (snippets). We can't match that cheaply, and we don't need to.
- **Sourcing.** Purdue, K-State and UNL are primary sources. We name them but link none.

## Math check (worked by hand)

| Case | Inputs | Page | Hand | OK |
|---|---|---|---|---|
| Corn default | 34 ears, 16 x 32 | 193; range 183-268 | 34,000 x 512 / 90,000 = 193.4; /95k = 183.2; /65k = 267.8 | yes |
| Corn "High" | 34 x 16 x 36 | 218 | 217.6 | yes |
| Soy default | 125 plants, 25 pods, 2.5, 3,000 | 43 | 125,000 x 62.5 / 180,000 = 43.4 | yes |
| Soy "Low" | 110, 22, 2.4, 3,000 | 32 | 32.3 | yes |

The formulas match Purdue, ISU, K-State and Ohio State: ears x rows x kernels / kernels-per-bu; plants x pods x seeds / (seeds per lb x 60).

| # | Finding | Severity |
|---|---|---|
| Y1 | The WebApplication JSON-LD featureList claims "Break-even / profit per acre at estimated yield" and "Auto-filled cash price by crop". Neither is on the page; it only links to /breakeven. That is structured data describing a feature that does not exist. | Medium (honesty) |
| Y2 | The scenario buttons are dated. Soybean "Average ~43" and "High ~54" sit against Pro Farmer's 2026 national estimate of 53.3 (snippet) and USDA's 2025 final of about 53. "High" is a normal year. Corn "Average ~180" is fine. | Low-medium |
| Y3 | The headline kernel factor is 90 while the cited Purdue source suggests 80-85. It is defensible and inside the range, but the page should say so or offer a fill-condition pick. | Low |
| Y4 | The soybean tab never links to /pod-counts, AGSIST's own measurement of pod counts vs NASS yields. That is the one thing no competitor has. | Low (missed value) |
| Y5 | The "±25% or worse before R6" figure is credited to Michigan State, and "±20 bu all four extension services give" is a group claim. I could not verify either here. They need a link each. | Low (sourcing) |

## The 5 changes, ranked
1. **Multi-site averaging (M).** Add "Add another site" to keep 5+ rows (ears, rows, kernels) and show the field average, the spread between sites and n. This is the step every extension guide asks for and no web tool does. It stays in-page and small.
2. **Grain fill selector (S).** Add Excellent 80k / Normal 85k / Stressed 95k (Purdue, MSU, K-State) with the factor shown. Keep the 65-95k range. Either move the default to 85k or say why we keep 90k ("conservative, ISU's long-standing default").
3. **Result on the first screen (S).** At 390 a sticky bottom bar "193 bu/ac (183-268)" like the grain-bin page. At 1280, put the result card beside the inputs.
4. **Fix the JSON-LD and the scenarios (S).** Drop the two features that aren't there (or build a one-line "x your price = $/ac" that reads the site's local cash bid). Set the soybean scenarios to roughly 45/55/65 and corn to about 160/190/220, and date them.
5. **Link the evidence (S).** Link Purdue Corny News, K-State eUpdate, UNL CropWatch, Ohio State and MSU in the method note. On the soy tab add: "Pod counts carry signal but no published formula converts them; see our 28 state-year check" linking /pod-counts.

**Best on the internet today? Close.** It is the cleanest free two-crop web calculator, and the math is right. But it takes one site where the method needs five, headlines a kernel factor its own cited source has moved off, and lists two features in its structured data that it does not have.
