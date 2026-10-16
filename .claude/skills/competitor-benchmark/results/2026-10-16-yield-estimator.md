# Head to head: agsist.com/yield-estimator

Checked Oct 16, 2026. I rendered yield-estimator.html (58 KB) at 390x844 and 1280x800, and drove it in a browser:
- two corn sites
- the kernels-per-bushel pick
- the soybean tab
- a 15" soybean row

There was no sideways scroll and no page errors. The page needs no live data. Shots are in scratchpad/bench/syb/shots/yield-*.png.

**Shipped since Oct 15:** most of the Oct 15 list.
- **Multi-site:** averaging is in, with up to 5 sites, the mean and the site spread.
- **Kernels per bushel:** there is now a 80,000/85,000/90,000 pick, and the default is 85,000.
- **First screen:** the yield shows at 390 and at 1280.
- **Structured data:** the JSON-LD now lists only real features.
- **Scenarios:** the soybean scenarios run about 40/55/65.
- **Links:** the soybean tab links /pod-counts.

**Competitors:** I scored them only from the copies GitHub Actions saved on Oct 16 (references branch). Phone is "?" for every competitor because I did not render them, so their totals are out of 45.
- **Read (3):** Purdue Nielsen (bench-yield-estimator-1), Bayer/Channel (-4) and DTN (-6).
- **Not readable:**
  - K-State (-2): the copy is the eUpdate home page, not the article.
  - MSU (-3): empty copy.
  - Ohio State (-5): HTTP 403, no copy.
- **Pioneer app:** app only, not fetched.

## Scores (1-5)

| Page | First screen | Current | Accurate+sourced | Local | Clear | Depth | Phone | Trust | Speed | Unique | Total | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **AGSIST /yield-estimator** | 4 | 3 | 3 | 4 | 5 | 4 | 4 | 4 | 5 | 4 | **40** (36 of 45 without phone) | rendered Oct 16, math worked by hand |
| Purdue Nielsen, Estimating Corn Grain Yield | 3 | 3 | 5 | 1 | 4 | 5 | ? | 5 | 4 | 3 | 33/45 | fetched Oct 16; dated Aug 2021 |
| DTN Easy Formulas | 2 | 3 | 4 | 1 | 3 | 4 | ? | 4 | 2 | 3 | 26/45 | fetched Oct 16; 2022 update, ad units in copy |
| Bayer/Channel Estimating Corn Yield | 3 | 3 | 4 | 1 | 4 | 2 | ? | 3 | 3 | 2 | 25/45 | fetched Oct 16; Aug 14, 2023 |
| K-State eUpdate | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | fetched Oct 16, eUpdate home page, not the article: not readable |
| MSU estimating grain yields | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | fetched Oct 16, empty: not readable |
| Ohio State C.O.R.N. | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | fetch failed (HTTP 403): not readable |

Current is 3 for us because the page shows no date: there is no dateModified and no "updated" line.

## Numbers checked by hand

| Case | Inputs | Page | Hand | OK |
|---|---|---|---|---|
| Corn default | 34 ears, 16 x 32, 85k | 205; range 183-268 | 34,000 x 512 / 85,000 = 204.8; /95k = 183.2; /65k = 267.8 | yes |
| Two sites | site 1 as above, site 2 28 x 16 x 30 | 181, "2 of 2 sites" | 204.8 and 158.1, mean 181.5 | yes |
| Same, 80k | | 193; sites 168 to 218; range 162-237 | 217.6 and 168.0, mean 192.8. Range: mean of the per-site results at 95k = 162.4, at 65k = 237.3 | yes |
| Soy default | 125k, 25 pods, 2.5, 3,000 | 43; range 37-52 | 125,000 x 62.5 / 180,000 = 43.4; at 2,500 = 52.1; at 3,500 = 37.2 | yes |
| Soy scenarios | High / Avg / Low | ~65 / ~55 / ~40 | 130x36x2.5/180 = 65.0; 132x30x2.5/180 = 55.0; 120x25x2.4/180 = 40.0 | yes |
| Row lengths | 30" / 15" | 17'5" / 34'10" | 43,560 / 2.5 / 1000 = 17.42 ft; / 1.25 = 34.85 ft | yes |
| Purdue's own example | 30 ears, 511 kernels | (not on page) | 30 x 511 / 75 = 204, matching the fetched Purdue page | n/a |

The math is right.

## Where we win
- **The only free web tool in the set that does all of this:**
  - both crops
  - every common row width
  - several sites averaged, with the site spread
  - the kernel-weight range next to the point estimate
- **Purdue's own complaint about apps:** its saved page says apps "do not allow you to sample AND save the results of multiple sites within a field". We now average the sites, though we do not save them (see change 2).
- **The kernel-weight range is explained.** The page says the 65k-95k range is kernel weight, not field error. It links to /pod-counts, AGSIST's own check of pod counts against USDA yields, which no competitor has.
- **Plain and quick.** It is fast, has no ads and carries a CCA byline.

## Where they beat us, and how
- **Purdue gives three factors and says which is typical.** From the saved copy:
  - "I suggest simply performing separate calculations using kernel weight 'fudge factor' values equal to 65, 75, and 85."
  - "Average kernel weight in several of our recent trials has ranged from 67,000 to 94,000 kernels per 56-lb bushel, with an average of about 76,000."
  - Use 90 to 100 only after a stressful grain fill.
  - It works one example three ways: 236, 204 and 180 bu.
- **DTN brings field truth.** It quotes Purdue's Dan Quinn recommending 75, 85 and 95. It also has a farmer whose 80,000 estimate (273) came close to his actual 268.9 bu/ac.
- **A second method.** Purdue and DTN both give the Pro Farmer/Hicks ear-length method: ears x ear length x rows / row width. Crop-tour farmers use it. We have only the component method.
- **Primary sources linked.** Purdue lists 15 references with URLs. We link only Purdue. The Michigan State "±25% or worse before R6" claim is still unlinked.

## Bugs found
| # | Finding | Severity |
|---|---|---|
| Y1 | **The kernel factor is attributed to Purdue wrongly.** The page says four times that Purdue's Bob Nielsen "suggests 80,000 to 85,000 for today's hybrids": the field note, the method line, the FAQ text and the FAQ JSON-LD. The Purdue page it links says something else (fetched Oct 16, dated Aug 2021): calculate at 65, 75 and 85; recent trials averaged about 76,000; use 90-100 after stress. So our default of 85,000 is the top of Purdue's normal range, not its suggestion. At the default counts, Purdue's middle factor (75k) gives 232 bu, while we headline 205. The dropdown offers no 75k. | **Medium** (sourcing; understates yield about 12% against the cited source's middle) |
| Y2 | **The tiles do not match the average.** With 2+ sites, the EARS/ACRE and KERNELS/EAR tiles show the site being edited (28k, 480) next to a FIELD AVERAGE yield (181). A reader multiplies the tiles and does not get the headline. | Low |
| Y3 | **Sites stop at 5.** The page caps sites at 5, while its own text says "Count at least 5 sites". A sixth site cannot be added. | Low |
| Y4 | **No date.** The page shows no date anywhere: no dateModified, no "updated" line. | Low |

## The 5 changes, ranked
1. **Fix Y1 and match Purdue's three factors (S).**
   - Quote Purdue exactly.
   - Offer 75k / 85k / 95k (plus 65k for an excellent fill), and show all three results the way Purdue's example does.
   - Pick the headline factor openly. For example: "85k shown; Purdue's recent trials averaged 76k."
   - Fix the FAQ JSON-LD in the same edit.
   - Farmers helped: many. Gap: medium. Honesty risk: low once quoted.
2. **Save the sites and fields on the device, and lift the 5-site cap (S).**
   - Keep sites per field in browser storage, as a per-viewer convenience: the field name, the sites and the date counted.
   - Allow 10+ sites.
   - Purdue names this exact gap in apps.
   - Farmers helped: some. Gap: medium. Honesty risk: none.
3. **Make the tiles agree with the headline (S).**
   - When averaging, show the average ears/acre and kernels/ear, and label the per-site values.
   - Farmers helped: some. Gap: small. Honesty risk: none.
4. **Add the ear-length method as an option (M).**
   - Ears in 30 ft of two rows, ear length and rows, as Purdue and DTN describe.
   - Say plainly that Purdue warns it is meant for regions, not single fields.
   - Farmers helped: some. Gap: small. Honesty risk: low with that caveat.
5. **Date the page and link the evidence (S).**
   - Add a visible "Reviewed <date>" line and dateModified.
   - Link Purdue, ISU, OSU, Penn State and the MSU soybean ±25% source.
   - Farmers helped: few. Gap: small. Honesty risk: none.

## Verdict
**Close.**
- **Why ours leads:** it is the best free two-crop web calculator, with correct math, several sites averaged and an honest range. Most of the Oct 15 list shipped.
- **What holds it back:** it misquotes the source it relies on for the one number that matters most, the kernels per bushel. Fixing Y1 makes it a yes.

**Change since Oct 15:** 39 to 40 (+1).
- **Gained:** first screen +1 (the result is on screen) and unique +1 (sites, pod-count link).
- **Lost:** accurate and sourced -1 (the Purdue misquote, found by reading the saved Purdue page) and current 0 (no date shown).
