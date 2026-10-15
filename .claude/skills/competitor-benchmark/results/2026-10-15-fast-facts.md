# Head to head: agsist.com/fast-facts

Checked Oct 15, 2026, from the read-only checkout. I rendered fast-facts.html at 390x844 and 1280x800 and opened all 10 tabs. No sideways scroll and no JS errors. fast-facts.html is 130 KB, and the page loads about 200-240 KB. The fertilizer sheet is dated Sep 1 (urea $590), and K-Mag and pelletized lime are dated Jul 20.

**What I could not see:** I could not open any competitor host or the UW A2809 PDF (DNS refusal). I did not check the MRTN table values and P/K breakpoints against A2809 itself. Competitor cells are from search-result text and are marked *.

## Numbers checked by hand
- **N:corn ratio:**
  - $590 / (2000 x 0.46) = $0.641 per lb N.
  - Divided by $4.7925 corn, that is **0.134**, which falls in the 0.15 column ("above-average N cost"). Matches.
- **Corn cost builder:**
  - 160 lb N x $0.64 = $102.40.
  - P2O5 from MAP+S with its N credited: (930 - 240 x 0.641) / 800 = $0.97/lb, so 75 lb is $72.75.
  - Potash: 460 / 1200 = $0.38, so 60 lb is $22.80.
  - Adding seed 105, chemical 55, rent 150 and other 75 gives **$582.95**. Matches.
- **Manure calculator (dairy liquid 4-11%, worked in 1 hr-3 days, 6,000 gal, 80 ac):**
  - 60 lb N x 0.641 = $38.48, 36 lb P2O5 x 0.97 = $34.92, 102 lb K2O x 0.383 = $39.10.
  - Total $112.50 an acre, which is $18.75 per 1,000 gal, about $4.50 a ton (1,000 gal is 4.17 t), and $9,000 for 80 acres. Matches.
- **Manure output:** dairy 148 lb/day = 27 t/yr = 17.7 gal/day = 6.5 thousand gal/yr. Matches.
- **Row length for 1/1000 acre:** 30 in = 17'5", 20 in = 26'2", 38 in = 13'9". Correct.
- **Nutrient removal:** 200 bu x 0.38 = 76 lb P2O5, and x 0.29 = 58 lb K2O. Matches.
- **US 2025:** 91.3 M ac x 186.5 = 17.0 B bu, and 80.4 x 53.0 = 4.26 B. Iowa 2026: 12.8 x 219 = 2,803. All consistent.

### Wrong numbers found
1. **WRONG (high): lime cost per acre.**
   - Default case: SMP buffer 6.5, target 6.8, 75% CCE aglime. The page says 1.7 t pure CaCO3 = 2.3 t aglime, then **"$646/ac at $285/ton pelletized"**.
   - The code (components/fast-facts.js `calcLime`) multiplies tons of 75% aglime by the pelletized price (data/fertilizer.json "Pell Lime", SuperCal 98G, $285).
   - Ag lime by the ton costs a fraction of that. Search snippets* give about $15-40/t at the quarry and $30-75/t delivered and spread, and the 2026 Iowa custom-rate survey puts spreading at about $8.30/t.
   - So 2.3 t of aglime is roughly $70-170 an acre, not $646.
   - A farmer reading $646 could skip lime the field needs. Fix: price aglime tons at an aglime price, or show cost only when "98% CCE (pelletized)" is picked. Even then, 1.7 t of pellets an acre is not how pellets are used.
2. **WRONG (medium): corn rootworm adult threshold.**
   - The page says "0.75 beetles per plant + silk clipping <1/2 in, VT-R1".
   - The silk-clipping threshold in extension guides is about **5 beetles per plant** during pollen shed with silks clipped to within 1/2 in (search snippets* from SDSU, ISU/Wallaces Farmer, MSU and UW).
   - 0.75 per plant is a figure used for judging next year's rootworm risk, not for a rescue spray at silking. As printed, it would trigger spraying at about one-seventh of the real threshold.
3. **WRONG sometimes (medium-low): the N:corn calculator can show a result from a price that is not in the box.**
   - In 1 of 8 loads (and in my first phone screenshot) the result read **$0.61 / 0.127** while the box showed $590. That result is the HTML default of $560 (560 / 920 = 0.609).
   - The urea auto-fill sets `nc-fertprice` but does not call `calcNC()`. Whether the result catches up depends on which file loads first.
   - At today's prices both land in the 0.15 column. With corn near $4.95, though, $560 gives 0.123 (0.10 column) and $590 gives 0.130 (0.15 column), so the recommended rate column can flip.

### Smaller issues (low)
- **Live label:** prices are marked "CBOT · live", but they are delayed Yahoo quotes. The homepage says "Delayed 15 min".
- **K-Mag analysis:** the fertilizer card says K-Mag Premium 0-0-20-22S-11Mg, while the products table says K-Mag is 22% K2O. The K-Mag price is from Jul 20 but sits under "Updated Sep 1".
- **Group 3 row:** it reads "Treflan, Sonalan (trifluralin)". Sonalan is ethalfluralin, and the crops column says "Soybean, corn" for a group mostly used in soybeans.
- **Soybean aphid timing:** shown as V4-R5. Extension guides usually give R1-R5.
- **Soybean credit:** "Soybean (field crop) 20 lb N/ac" sits in the credits to subtract, while the note says the soybean credit is already in the MRTN table. The note covers it, but listing it invites a double count.
- **Soybean tissue test:** there is a gap between deficient (<4.0) and sufficient (4.5-5.5) with no label.

## Scores (1-5)

| Page | First screen | Current | Accurate/sourced | Local | Clear | Depth | Phone | Trust | Speed | Unique | Total |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **AGSIST /fast-facts** | 4 | 4 | 2 | 2 | 3 | 5 | 3 | 4 | 3 | 4 | **34** |
| Purdue Corn and Soybean Field Guide / Field Scout apps* | 3 | 3 | 5 | 2 | 4 | 5 | 4 | 5 | 3 | 3 | 37 |
| Iowa State Corn Nitrogen Rate Calculator (MRTN)* | 3 | 4 | 5 | 3 | 3 | 4 | 2 | 5 | 3 | 4 | 36 |
| Ohio State Corn N Rate Calculator* | 3 | 3 | 5 | 3 | 3 | 3 | 2 | 5 | 3 | 3 | 33 |
| UW Extension A2809 (the PDF the page is built on)* | 1 | 2 | 5 | 2 | 2 | 5 | 1 | 5 | 2 | 3 | 28 |

\* from search snippets only; not opened. Snippet facts used:
- The ISU calculator gives the MRTN rate, a profitable range (within $1/ac of MRTN), net return and product cost.
- Purdue's apps have lime, N, P and K calculators, thresholds and herbicide MOA, at $5.99 with a free preview.

I scored our accuracy 2 because of the lime cost and the rootworm threshold. Both are easy fixes.

## Where we win
- **Today's prices built into the tables:** the N:corn ratio from today's corn and a dated urea sheet, a cost builder, and manure value at dealer prices. University tools ask you to type every price.
- **Breadth in one free page,** from N rate to tissue tests to conversions to state yields, with a print button. No login and no app purchase.
- **Honest staleness:** "dealer sheet Sep 1 (aging, check your dealer)".

## Where a competitor beats us, and how
- **Accuracy and authority (Purdue\*, ISU\*).** Extension tools carry their research behind each number. Two of our numbers above are wrong in a way an agronomist would catch.
- **N rate by state (ISU MRTN\*).** It is calibrated for Iowa, Illinois, Minnesota, Wisconsin and others, with a profitable range and net return. Ours is a single Wisconsin (A2809) table, labeled as such.
- **In-field app (Purdue\*).** Works without a browser tab and is built around scouting.

## Five changes, ranked by impact
1. **Fix the lime cost (S).** Price aglime tons at an aglime $/ton (an input with a sourced default), or hide the cost unless pelletized is picked. This is the most expensive wrong number on the page.
2. **Fix the corn rootworm adult threshold to about 5 beetles per plant with silks clipped to 1/2 in before pollination is done (S).** Cite the extension source in the row.
3. **Call `calcNC()` after the urea auto-fill (S),** and add a test that the shown ratio equals box price / (2000 x %N) / corn.
4. **Clean the small labels (S).**
   - Change "CBOT · live" to "CBOT, delayed".
   - Make the K-Mag analysis agree, and give K-Mag and lime their own dates.
   - Fix Group 3 (trifluralin; Sonalan is ethalfluralin) and change soybean aphid timing to R1-R5.
   - Take the soybean line out of the credits list, since MRTN already includes it.
5. **Link to the state MRTN calculator by state (S).** One line: "Outside Wisconsin, your state's MRTN rate: ISU calculator", so farmers in Iowa, Illinois and Minnesota get their own rate. Later (M), load per-state MRTN tables from data on demand.

## Verdict
Best on the internet today? **No**, until the lime cost and the rootworm threshold are fixed. After that it is **close**. It is the broadest free reference page with live prices that I found, but extension guides beat it on authority, and a reference page has to be right first.
