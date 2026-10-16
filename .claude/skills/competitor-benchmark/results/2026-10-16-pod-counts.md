# Head to head: agsist.com/pod-counts

Checked Oct 16, 2026, from the checkout. I served the repo locally and rendered pod-counts.html at 390x844 and 1280x800:
- No sideways scroll and no page errors. The only failed loads are outside hosts, which are blocked here.
- About 400 KB loaded. The page HTML is 50 KB.
- The content has not changed since the Oct 15 run. The only commits are to the shared nav and footer.
- The byline ("By Sigurd Lindquist, Certified Crop Adviser (CCA)") now sits in the header line, which closes Oct 15 change 5.

**Competitors.** I scored them only from the copies GitHub Actions saved on Oct 16 (references branch). Phone is "?" for every competitor because I did not render them, so their totals are out of 45.
- **Read (4):**
  - Pro Farmer "Scout your fields, too" (bench-pod-counts-2, dated Aug 13, 2021)
  - DTN "Simple formulas" (-4, 2020)
  - Canterra (-5, undated)
  - BMO Nesbitt Burns, "Historical Accuracy of Profarmer Crop Tour" (-6). The saved text is navigation only, but the saved HTML holds the full table.
- **Could not read (2):**
  - AgWeb "3 steps" (-1): the fetch failed with HTTP 403, and there is no Wayback copy.
  - K-State eUpdate app article (-3): the saved copy is the eUpdate front page (a redirect), not the article.

## Numbers checked by hand
I re-derived the fits from the 56 points printed in the chart tooltips:
- **Soybeans, within state:**
  - r = **0.658**, shown as +0.66.
  - Slope 0.02272 bu per pod, so **44.0 pods per bushel**, shown as "about 44 (0.0227)".
  - Residual SD on 20 degrees of freedom: **2.89 bu**, shown as 2.89.
  - All three match.
- **Corn control:**
  - r = 0.851, shown as +0.85.
  - Residual SD 5.61, against 5.55 printed. The tooltips are rounded to whole numbers, so this is within rounding, same as Oct 15.
- **Year-over-year direction:**
  - Soybeans agree 14 of 21, which matches.
  - Corn agrees 15 of 21 from the rounded tooltips, against 16 printed. One pair rounds to a tie, so this is within rounding.
- **Divisor arithmetic:**
  - 22.0 / 15 = 1.47 and 23.5 / 15 = 1.57, so 47-57%. Matches.
  - 2.89 x 1.96 = 5.7, printed as "about ±6". Matches.
- **Against the saved copies:**
  - DTN's 2020 copy says "There is not a reliable method to convert pod counts to bushels per acre." That is consistent with the page.
  - The page quotes the method as "any pod ¼″ or larger". The saved 2021 Pro Farmer copy says only "Count all the pods on those three plants" and has no ¼-inch rule. DTN's copy has the rule ("Ignore pods less than 1/4 inch"). The page's quote may come from a different Pro Farmer text, which I could not read here. **Unverified, not a bug:** name the source of the quote.

## Bugs found
- None in the arithmetic.
- **Low:** the chart labels inside the SVGs are about 6-7 px at 1280 wide and unreadable without zooming. The table under the charts carries the numbers, so nothing is lost.

## Scores (1-5)

| Page | First screen | Current | Accurate/sourced | Local | Clear | Depth | Phone | Trust | Speed | Unique | Total | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **AGSIST /pod-counts** | 4 | 3 | 5 | 2 | 4 | 4 | 4 | 5 | 5 | 5 | **41/50** | rendered Oct 16 |
| BMO, historical accuracy of the Pro Farmer tour | 3 | 5 | 3 | 1 | 3 | 2 | ? | 3 | 3 | 4 | 27/45 | fetched Oct 16 (table read from the saved HTML) |
| DTN simple formulas (2020) | 3 | 2 | 4 | 4 | 4 | 2 | ? | 4 | 2 | 2 | 27/45 | fetched Oct 16 |
| Pro Farmer "Scout your fields, too" (2021) | 3 | 2 | 3 | 4 | 4 | 1 | ? | 3 | 3 | 2 | 25/45 | fetched Oct 16 |
| Canterra, how to estimate soybean yields | 4 | 1 | 2 | 4 | 4 | 1 | ? | 2 | 4 | 2 | 24/45 | fetched Oct 16 |
| K-State soybean yield app (eUpdate) | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | not scored | fetched Oct 16: redirect to the eUpdate front page, not readable |
| AgWeb "3 steps" (Pro Farmer) | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | not scored | fetch failed (403), no Wayback copy |

**What each competitor's scores rest on:**
- **BMO:**
  - It has the Pro Farmer national corn and soybean yields against the NASS September and final figures, 2003-2025, plus Pro Farmer's 2026 soybean number (53.3). It gives a source link per year and an average difference (soybeans, Pro Farmer less NASS final: -0.55 bu).
  - From its own table, the mean absolute miss on soybeans is **2.0 bu** (2003-2025, 23 years). That is my arithmetic.
  - It is national only.
  - One cell looks like a typo: corn 2014, "NASS September 147.4", which gives a 21.9 bu gap. I did not check it at the source.
- **DTN:**
  - It gives a named author and the corn formula.
  - It gives the soybean pods-in-a-3x3-square method, and states plainly that pods do not convert to bushels.
  - The page is full of ads, and it is from 2020.
- **Pro Farmer:**
  - The corn yield formula, and the soybean pods-in-a-3x3 method with a worked example (1,075 pods).
  - No conversion, and no author beyond "Pro Farmer Editors".
- **Canterra:**
  - "Pods x Seeds per Pod / Seed Size = bu/ac", with 2.5 seeds a pod and a seed-size factor of 18 (15 to 21). The example is 300 x 2.5 / 18 = 41.6 bu.
  - No validation and no date. It cites "www.soybeanstation.org". The calculator sits behind an offers.canterra.com link.

## Where we win
- **Still the only published measurement of what a tour pod count says about state yield.** It has a corn control, degrees of freedom and in-sample caveats. Of the copies read, DTN and Pro Farmer say outright, or imply, that pods do not convert. Canterra converts with an untested divisor.
- **The honest-numbers stance.** No point yield, a stated ±6 bu band, and the "divide by 27" rule traced to its source and taken apart.

## Where they beat us
- **Current (BMO).** BMO already lists Pro Farmer's 2026 soybean estimate. This page stops at 2025 and does not mention the 2026 tour.
- **National track record (BMO).** Twenty-three years of tour vs NASS final, with a source for every year. This page measures four years at state level and says nothing about how the tour's national soybean call has done.
- **Your own field (Pro Farmer, DTN, Canterra).** All three give a farmer a method to count his own field today. This page tells him not to borrow extension divisors, which is right, but gives him nothing to do in his own field.

## Five changes, ranked
1. **A dated 2026 line (S).**
   - What: show the 2026 tour pod counts by state as differences from each state's mean, with the ±6 bu band. Label it "AGSIST calibration, not a Pro Farmer number". Mark it "checked against NASS January 2027".
   - Why: the page is two months old and silent on this year. BMO is current.
   - Honesty risk: low, if it stays a range and is labeled.
2. **A national track record panel (S-M).**
   - What: the Pro Farmer national soybean yield vs the NASS final, by year, built from Pro Farmer's own releases and the NASS annual summaries. Do not take it from BMO's table. Report the mean absolute miss and the bias.
   - Why: it answers the second question a reader has ("how good is the tour's soybean number?"), and it is small as data.
   - Honesty risk: low. Cite every year, and leave a year out if its release cannot be found.
3. **Add the pre-2022 state years (M).**
   - What: back to about 2015, from the year-ago figures in the nightly reports, against the NASS finals. Keep 2021's revision caveat.
   - Why: dropping 2025 takes r from +0.66 to +0.47. More years firm the fit or show it is weaker.
4. **A short "count your own field" box (S).**
   - What: why the tour's pod scale is not the scale extension formulas use, and a link to an extension method. No calculator.
   - Why: every competitor read gives the farmer a field method. This page gives none.
5. **CSV of the 28 rows plus a contentUrl in the Dataset JSON-LD (S).**
   - What: the JSON-LD declares a Dataset, but nothing is downloadable (no contentUrl).
   - Why: it lets anyone check the measurement.

## Verdict
**Yes.**
- Score: 41/50, unchanged from Oct 15 (+0).
- No copy read measures what pod counts predict.
- BMO shows the tour's national record and is more current. Adding 2026 (change 1) closes that gap.
