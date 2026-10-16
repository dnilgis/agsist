# Head to head: agsist.com/fast-facts

Checked Oct 16, 2026. I rendered fast-facts.html from the checkout at 390x844 and 1280x800. No sideways scroll, no JS errors, about 642 KB loaded uncompressed (one blocked outside call, Google Tag Manager). Prices come from data/fertilizer-prices.json (Kansas co-ops, posted Sep 24 to Oct 12) and data/prices.json (corn $4.7425, CBOT, delayed). I drove the calculators in the browser and worked each case by hand.

This run I could read the source the page is built on. GitHub Actions saved UW Extension A2809 (Laboski and Peters) as a PDF and text copy (bench-fast-facts-6, fetched Oct 16), so I checked our tables against it line by line.

Competitors were scored only from the copies fetched on Oct 16 (references branch, bench-fast-facts-1..6). I did not render them, so phone and speed are "?" unless the copy shows them.
- **Iowa State Corn N Rate Calculator:** the landing page is readable; the calculator itself is behind a form. The Illinois Extension article (also fetched) describes how it works, so I used both.
- **MSU corn N guidelines:** the saved text is empty (244 bytes). Not readable.
- **Illinois Extension MRTN explainer (Feb 27, 2026):** readable.
- **Ohio State N tool news repost (Crescent-News):** readable. It describes the tool but gives no tool URL.
- **Purdue PPDL:** readable, but it is the diagnostic lab page, not the Field Guide app. Not comparable.
- **UW A2809 PDF:** readable in full.

## What changed since Oct 15
- **Fixed:** the lime cost is priced only at the reader's own $/ton (no more $646/ac).
- **Fixed:** corn rootworm is now "5 or more beetles per plant in the first week of pollen shed, or silks clipped to 1/2 in", with SDSU and Iowa State named and the date read.
- **Fixed:** `calcNC()` runs after the urea auto-fill. The box and the result agree ($623, $0.68, 0.143) on every load I ran.
- **Fixed:** "CBOT, delayed" labels, the K-Mag analysis with its source, trifluralin and ethalfluralin named correctly, and soybean aphid "Through R5".
- **Still open:** the soybean 20 lb credit is still listed under credits to subtract (the note says not to double count).

## Numbers checked by hand
- **N table vs A2809 Table 6.1:** all 8 rows x 4 price ratios, MRTN rate and profitable range, match exactly (24 cells).
- **N:corn ratio:** urea $622.98, shown as $623. $623 / 920 lb N = $0.677. Divided by $4.74 that is 0.143, which is the 0.15 column. The page shows $0.68, 0.143, 0.15, and the top card shows 0.14 "N is getting pricey". Matches.
- **P and K cost line, default case:** 75 lb P2O5 x $0.80 + 60 lb K2O x $0.39 = $83.40. Matches the page, but the 75 lb is wrong (see bug 1).

### Wrong numbers found
1. **WRONG (high): P and K soil test categories do not match A2809, the source the page names.**
   - The page uses one set of breakpoints for every crop: P (Bray) VL <11, L 11-15, O 16-25, H 26-50, VH 51-75; K VL <61, L 61-90, O 91-130, H 131-200, VH 201-300.
   - A2809 Table 7.1 (loamy soils, demand level 1: corn grain, soybean) has P VL <10, L 10-15, O 16-20, H 21-30, EH >30. It has no VH class for P. Table 7.2 has K VL <70, L 70-100, O 101-130, H 131-160, VH 161-190, EH >190. Sandy and organic soils have their own rows, and the page offers no soil group.
   - **Default case (corn, 200 bu, P 22, K 110):** the page says P Optimum, 75 lb P2O5. A2809 says P High, 40 lb (191-210 bu row). That is 35 lb too much, about $28/ac at the page's own $0.80.
   - **Corn, P 35, K 195:** the page says 40 lb P2O5 and 30 lb K2O. A2809 says both are excessively high, so 0 and 0. That is about $44/ac of fertilizer the source says not to apply.
   - **Corn, K 65:** the page says Low, 90 lb K2O. A2809 says Very Low, 105 lb.
   - The rate rows themselves (corn and soybean, Table 7.4) do match A2809. Only the category cutoffs are wrong.
2. **WRONG (high): Corn silage and alfalfa get corn grain rates.**
   - In components/fast-facts.js, `corn_silage` and `alfalfa` copy the corn grain table, and the yield goal is read as bushels.
   - **Corn silage, 25 t, P 20, K 120:** the page says 55 lb P2O5 and 40 lb K2O. A2809 (silage 20.1-25 t, demand level 2, both Optimum) says 80 and 185.
   - **Alfalfa, 5 t, P 20, K 120:** the page says 55 and 40. A2809 (established, 4.6-5.5 t) says 65 and 300.
   - A dairy farmer using this for alfalfa would put on about one-seventh of the potash the source recommends.
   - Soybean (60 bu, P 20, K 120 gives 50 and 85) matches A2809.
3. **WRONG (medium-high): the lime table is credited to A2809, but A2809 does not use it.**
   - The page says "Based on UW Extension A2809 SMP-buffer calibration". It uses a buffer-only table of pure CaCO3 tons, then divides by % CCE.
   - A2809 Table 5.1 uses formulas with both buffer pH and water pH. They give tons of 60-69 neutralizing-index lime, adjusted by 65 / NI.
   - **Buffer 6.5, water pH 6.0, target 6.8:** A2809 gives 195 - 28.4 x 6.5 + 0.144 x 6.0 = 11.3 t of 60-69 lime (about 8.5 t of 80-89 grade). The page gives 1.7 t pure, 2.3 t of 75% aglime. That is about 4 to 5 times too little for an alfalfa target.
   - **Same soil, target 6.3:** A2809 gives 103 - 12.6 x 6.5 - 3.18 x 6.0 = 2.0 t (1.5 t of 80-89). The page gives 1.7 t. That is close.
   - NI and CCE are not the same measure, so these comparisons are approximate. The source credit is still wrong, and the 6.8 target is far off.
4. **INCONSISTENT (medium): GDU stage tables disagree with /gdu-calculator.**
   - The Fast Facts timeline and quick GDU calculator use corn V12 900, VT 1,250, R3 1,750, R5 2,200. The GDU page's source notes call those values wrong or unsourced, and it uses NCH-40 (V12 870, VT 1,135-1,350, no R3).
   - Soybeans: Fast Facts puts R1 at 550, R5 at 1,000 and R8 at 1,650. The GDU page has R1 800 and R2 1,000, and NDSU's model puts R8 at about 1,694 to 2,058 GDD.
   - At 1,020 GDU, Fast Facts says soybeans are at R5 and the GDU page says R2.
   - The timeline is labeled "GDU accumulation from emergence" but starts VE at 0 and ends R6 at 2,700, which is the from-planting scale.

### Smaller issues (low)
- The soybean 20 lb N/ac credit is still listed under "Other Legume Credits", while A2809 footnote e says not to subtract it for the soybean rows.
- The page header says "Rates calibrated to UW A2809 (Upper Midwest)", but today's prices are Kansas co-ops. Each label says so, which is honest, but the N:corn call mixes a Kansas price with a Wisconsin table.

## Scores (1-5)

| Page | First screen | Current | Accurate/sourced | Local | Clear | Depth | Phone | Trust | Speed | Unique | Total | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **AGSIST /fast-facts** | 4 | 4 | 2 | 2 | 3 | 5 | 3 | 4 | 3 | 4 | **34/50** | rendered Oct 16, checked against A2809 |
| UW Extension A2809 (PDF) | 1 | 2 | 5 | 2 | 2 | 5 | 1 | 5 | 1 | 3 | 27/50 | fetched Oct 16; 16 MB PDF, R-11-2012 |
| Iowa State Corn N Rate Calculator (MRTN) | 2 | 4 | 5 | 4 | 3 | 4 | ? | 5 | ? | 4 | 31/40 | fetched Oct 16: landing page, plus how it works from the Illinois Extension article (region, previous crop, two prices; profitable range within $1/ac; database updated yearly) |
| Illinois Extension MRTN explainer (Feb 27, 2026) | 3 | 4 | 5 | 2 | 4 | 3 | ? | 5 | ? | 2 | 28/40 | fetched Oct 16 |
| Ohio State N rate calculator (Crescent-News repost) | 2 | ? | 4 | 3 | 4 | 2 | ? | 4 | 2 | 2 | 23/40 | fetched Oct 16; no tool URL; comments, share bars and sign-up box in the copy |
| MSU corn N guidelines | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | not readable: empty copy |
| Purdue Field Guide / Field Scout | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | wrong page fetched (PPDL lab), not the app |

On Iowa State's 8 parts we score 28 to its 31. On Illinois Extension's 8 parts, 28 to 28. On the Ohio State repost's 8 parts, 27 to 23.

I scored our accuracy 2 again. The Oct 15 errors are fixed, but the P/K categories, the silage and alfalfa rates, and the lime credit are wrong against the very source the page names.

## Where we win
- **Today's prices built into the tables.** The N:corn ratio comes from today's corn and a dated co-op urea price, and the P/K and manure costs come from the same file. ISU and Ohio State ask you to type both prices.
- **Breadth in one free page:** N, P/K, manure, removal, lime, stages, pests, herbicide groups, conversions and state stats, with a print button and no login. A2809 has the depth, but as a 16 MB PDF that is unusable on a phone.
- **The N table is exact to A2809,** including the profitable ranges.

## Where they beat us, and how
- **Iowa State calculator:** state and region calibration from "hundreds of nitrogen response trials", and "The tool does not use a yield goal". The database "is updated annually. Trials more than 10 years old have recently been removed" (Illinois Extension, Feb 27, 2026). Ours is one Wisconsin table, labeled as such.
- **A2809 itself:** P and K categories by soil group (loamy vs sandy and organic) and by crop demand level, and lime by water pH plus buffer pH. Our interpreter collapses all of that into one cutoff set, and gets the corn cutoffs wrong.
- **Ohio State:** "timing corn fertilizer applications to after about 800 growing degree days". This is a practical timing cue we do not tie to our GDU tools.

## Five changes, ranked
1. **Use A2809's P and K categories (S-M).** Add a soil group pick (loamy, or sandy and organic) and set the demand level by crop, with cutoffs from Tables 7.1 and 7.2 (a small data file loaded with the tab). Add a test that P 22 and K 110 for corn on loamy soil gives High and Optimum, 40 and 60 lb. Why: the default case is wrong by 35 lb P2O5, and high-testing soils get a rate the source says to skip. Honesty risk: low; it brings the page in line with its own source.
2. **Give corn silage and alfalfa their own A2809 rows, with yield in tons, or remove them until then (S).** Why: alfalfa K2O at 40 vs 300 lb is the largest wrong number on the page. Honesty risk: low.
3. **Lime from A2809 Table 5.1, or credit the table to its real source (S-M).** Take water pH and buffer pH, compute tons of 60-69 lime, convert by 65 / NI, and round as A2809 says, with the 12 t cap and the minimum rates. If the current table came from another state's SMP calibration, name that state and stop citing A2809. Why: an alfalfa target gets about a fifth of the source's lime. Honesty risk: medium; NI is not CCE, so label the input as NI.
4. **One stage table for the site (S).** The timeline and quick calculator read the GDU page's NCH-40 table, label it "from planting", and drop the unsourced soybean GDU stages (or source them). Honesty risk: low.
5. **Out-of-Wisconsin N pointer (S).** One line under the N table: "Outside Wisconsin, your state's MRTN rate: Iowa State's Corn N Rate Calculator," linked. Move the soybean credit out of the subtract list. Later (M), load per-state MRTN tables from data on demand, only where a state publishes them. Honesty risk: low.

## Verdict
Best on the internet today? **No.** Every Oct 15 error is fixed and the N table matches A2809 exactly. But checking against the full A2809 found three larger problems: the P and K category cutoffs, the silage and alfalfa rates, and a lime table credited to A2809 that A2809 does not contain. After changes 1 to 3 it is **close**. It would then be the broadest free reference page with live prices, and right where it names its source.

**Change since Oct 15: 34 to 34 (0).** The fixes and the new errors cancel out; accuracy stays 2.
