# Head to head: agsist.com/nutrient-removal

Checked Oct 16, 2026, from the checkout at main 084d358c4. I rendered nutrient-removal.html at 390x844 and 1280x800 and looked at both. No sideways scroll, no JS errors (only the blocked Google Tag Manager call), about 410 KB loaded, 34 KB of HTML. test/nutrient-removal.test.mjs passes. This is the first scoring of this page, so there is no Oct 15 report to compare with.

Competitors were scored only from the copies GitHub Actions saved on Oct 16 (references branch, bench-nutrient-removal-1..7). I did not render them, so phone is "?" and their totals are out of 45. All seven are extension articles. The newest is SDSU (it cites Oct 2, 2026 fertilizer prices). The rest date from 2007 to 2021.

## Numbers checked by hand (no math errors)
- **Pounds:** I read A2809 Table 4.2 in the saved copy (scratchpad/bench/a2809.txt) and checked every row on the page. Stover 4.6/32, silage 3.6/8.3, soybean straw 5.4/19, wheat straw 6/28, oat straw 9.4/47, barley straw 10/32, small grain silage 11/44, alfalfa and red clover 13/60, grass hay 15/55 (A2809 "Grass, hay", 0.5-8 ton), and both legume-grass lines 13/60 and 13/51. All match, and so do the grain rows.
- **Prices:**
  - P2O5: 10-34-0 at $640, less 200 lb N at anhydrous $0.5073 ($101.46), / 680 lb = $0.792.
  - K2O: potash $470.40 / 1,200 = $0.392.
  - I checked the other P sources at the same N credit: MAP $0.835, DAP $0.811. 10-34-0 is the cheapest, as the page says.
- **Stover:** 4.6 x 0.792 + 32 x 0.392 = $3.64 + $12.54 = $16.19 a dry ton. At 15% moisture: x 0.85 = $13.76.
  - Default 1,000 lb bale at 15%: 0.425 dry ton, $6.88 a bale, 7.06 bales an acre. At 3 dry ton: $48.56 an acre, $3,885 on 80 acres. All match.
  - With a 1,200 lb bale and a $40 sale price: $8.26 a bale, 21% of the sale, $31.74 left. Matches.
- **Corn grain, 180 bu:** 68.4 lb P2O5 and 52.2 lb K2O. $54.17 + $20.46 = $74.63 an acre, $5,971 on 80 acres. Matches.

## Bugs and labeling issues
- **Low, copy bug.** Pick corn, soybean or wheat grain and the hint reads: "Starting yield 180 bu: the corn yield /fertilizer prices a program at. Put in yours." The defWhy strings in components/nutrient-removal.js (corn_grain, soy_grain, wheat_grain) are garbled.
- **Low, P price disagrees with the shared list.** The page works out its own P2O5 price: $0.79, from one co-op's 10-34-0 (Mulvane, Oct 6). data/fertilizer-prices.json already carries a shared per_lb.p of $0.80 (MAP, 2 co-ops, Oct 12). The two pages can show different phosphate prices from the same file. It is also odd to price stover P from a liquid starter quoted by a single co-op.
- **Low, "today's".** The FAQ says the calculator "prices it at today's posted co-op prices", but the prices were posted Oct 6, 10 days ago. The hero dates them correctly.
- **Low, wrong note on grain rows.** The grain results still carry the note "A2809 gives no N or S removal per ton", which reads oddly for a crop counted by the bushel.

## Scores (1-5)

| Page | First screen | Current | Accurate/sourced | Local | Clear | Depth | Phone | Trust | Speed | Unique | Total | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **AGSIST /nutrient-removal** | 5 | 4 | 4 | 3 | 4 | 4 | 4 | 5 | 4 | 4 | **41/50** | rendered Oct 16 |
| SDSU "Should We Sell Corn Stalks?" | 4 | 3 | 4 | 1 | 4 | 3 | ? | 5 | 3 | 3 | 30/45 | fetched Oct 16; cites Oct 2, 2026 prices |
| ISU ICM "Nutrient removal when harvesting corn stover" (2007) | 3 | 1 | 5 | 1 | 3 | 3 | ? | 5 | 4 | 3 | 28/45 | fetched Oct 16 |
| UNL CropWatch "Valuing Cornstalk Bales" (Nov 2021) | 3 | 1 | 3 | 1 | 4 | 4 | ? | 5 | 3 | 4 | 28/45 | fetched Oct 16 |
| Purdue "Corn Stover Baling - P and K Removal" (2008) | 4 | 1 | 4 | 1 | 4 | 2 | ? | 5 | 4 | 2 | 27/45 | fetched Oct 16 |
| UNL CropWatch "Harvesting Crop Residue: What's it Worth?" (2009) | 3 | 1 | 3 | 1 | 3 | 4 | ? | 5 | 3 | 3 | 26/45 | fetched Oct 16 |
| Univ. of Kentucky Corn & Soybean News (Oct 2007) | 3 | 1 | 3 | 1 | 3 | 3 | ? | 5 | 3 | 3 | 25/45 | fetched Oct 16 |
| ISU "Estimating a Value for Corn Stover" (PM 3053C, 2014) | ? | 1 | ? | ? | ? | ? | ? | ? | ? | ? | n/a | not readable: the saved copy is the store page; the PDF was not saved |

## Where we win
- **A dated dollar answer on the first screen.** It shows $16.19 a dry ton of stalks at prices posted Oct 6, 2026, with the per-pound math one click away. Every competitor uses a price from its publication year: $0.25-0.75 a lb in 2007-2009, $34 a ton in 2021. Only SDSU is close to current.
- **18 crops in one calculator**, with bale weight, moisture, acres and a sale price. It shows the share of a bale sale that goes to replace P and K. No competitor turns dry tons into a bale price for your own bale weight and moisture.
- **One cited table, checked row by row,** with what it leaves out (N, S, earlage) said in plain words.

## Where they beat us
- **Nitrogen and sulfur.** UNL (both pages), SDSU and Kentucky count N and S. SDSU uses 17 lb N and 3 lb S a ton at $0.62 and $0.42. The ISU saved copy has a published Table 1 with N 12, S 1, Ca 9 and Mg 6 lb per dry ton of vegetation. That is the kind of table the page says it is waiting for, and it is now saved.
- **Range across sources, and K loss to rain.** ISU says K leaches from stalks with rain after harvest, so baled stover tests lower than the plant did at maturity. ISU PM 1688 gives 18 lb K2O per ton at 15% moisture (about 21 per dry ton). Purdue gives 20 per dry ton. Kentucky's 17 lb on a 1,200 lb bale works out to about 28 per dry ton. A2809's 32 is at the high end, and the page shows no range. A farmer selling stalks after a wet fall may be told his potash is worth about 50% more than ISU would say.
- **The rest of the bale's value (UNL 2021).** UNL works out a feed value from what the stalks replace: 1.16 ton of hay less 0.22 ton of distillers grains, minus grinding. It also gives a full cost (baling $20-25 a ton, plus high/medium/low nutrient cases). UNL 2009 adds yield loss, erosion and lime value in a worksheet. SDSU gives grazing rent at $0.50-2.00 per head per day. We show only the fertilizer side, and say so.
- **Soybean hay (Kentucky).** Kentucky gives P and K removal for soybeans cut for hay at R3 and R5. We do not cover it.

## Five changes, ranked
1. **Show the source range for stalk and straw K2O and P2O5 (S-M).**
   - What: put ISU PM 1688 (per ton at 15%) and Purdue (per dry ton) next to A2809, each cited. Add ISU's note that rain after harvest leaches K, and have the calculator show a low-high dollar range.
   - Why: potash is most of the bill, and our single source is the high one.
   - Honesty risk: low, as long as each source stays labeled and nothing is blended into a "consensus" number.
2. **Let the reader enter their own fertilizer prices and forage test (S).**
   - What: add boxes for $/ton potash and P product, and for lab P and K (% or lb/ton), each replacing the default and marked "yours".
   - Why: the page already says "Put your own pounds and prices through the same math" but gives nowhere to do it. Kansas prices do not fit most readers.
   - Honesty risk: none. It runs client side, with no page-size cost.
3. **Add N and S as their own line (S).**
   - What: show N and S from the saved ISU table, outside the replacement total, with the residue-N caveat the page already has.
   - Why: every competitor that prices stalks counts N, so readers compare our $16 with their $28-34.
   - Honesty risk: low if the line is kept separate and cited.
4. **Fix the copy bugs and use the shared phosphate price (S).**
   - What: rewrite the three garbled defWhy strings, drop "today's" from the FAQ, and use fertilizer-prices.json per_lb.p, or state why this page differs.
   - Why: two AGSIST pages should not show different P prices from the same file.
   - Honesty risk: none.
5. **Put a market price for stalk and straw bales next to the replacement cost (M).**
   - What: show the latest USDA AMS hay report price for cornstalk and straw bales, where a state reports one, with date and state, loaded on demand.
   - Why: UNL and SDSU frame the decision as sale price against nutrient cost. We have the cost side and an empty sale box.
   - Honesty risk: medium. Many states report no stalk bales, so a missing price must stay missing.

## Verdict
**Close.** I found nothing current that does the same job. It is the only page that prices P and K removal for 18 crops at dated prices, with a bale calculator, and the math is exact. Two things keep it from yes:
- it gives one high-end potash figure with no range, and no way to enter your own prices or test
- it leaves out the N and S that every competitor counts

**Change since Oct 15:** none to compare. This is the first report on this page (41/50).
