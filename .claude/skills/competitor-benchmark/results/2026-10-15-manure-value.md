# Head to head: agsist.com/manure-value

Checked Oct 15, 2026, from the read-only checkout (main 3d3fe0b678). I rendered manure-value.html at 390x844 and 1280x800. No sideways scroll, no JS errors, about 400 KB loaded. Screenshots are in scratchpad/h2h/land/.

**What I could not see:** WebFetch and curl could not reach any competitor host (DNS refusal for extension.wisc.edu, apps.extension.umn.edu, extension.psu.edu, ipic.iastate.edu and the rest). Competitor cells come from search-result text only and are marked *. I also could not open A2809 itself (see the accuracy note).

## Numbers checked by hand
- Prices: urea $590 / 920 lb N = $0.641 a lb. MAP+S 12-40-0-10S: ($930 - 240 lb N x $0.641 = $153.9) / 800 lb P2O5 = $0.970. Potash $460 / 1,200 = $0.383. All match.
- Liquid dairy, 4-11% DM, worked in within 3 days: 10 lb N x 0.641 + 6 lb P2O5 x 0.970 + 17 lb K2O x 0.383 = $6.41 + $5.82 + $6.52 = **$18.75** per 1,000 gal. 1,000 gal = 4.17 tons, so $4.50 a ton. At 6,000 gal: $112.50 an acre, $9,000 on 80 acres. All match.
- Hog liquid, indoor pit, within 1 hour: 28 / 14 / 22 lb gives $39.97. Chicken solid, worked in within 3 days: 27 / 35 / 26 lb gives $61.24. Both match the table.
- **Accuracy issue (high, verify first):** the page says "This is the value of all the manure: all its P and K". The P2O5 and K2O figures in the table look like A2809's *first-year available* values, not the total. UW's crediting guidance says 60% of total P2O5 and 80% of K2O count in year one. 6 and 17 lb fit 60% of about 10 and 80% of about 21 lb total. UW A3392 gives about 28-14-28 lb total for dairy liquid. If that is right, the page undervalues "all the nutrients" by roughly 40 to 45%. At the same prices, about 24-10-21 lb total would be worth about $33 per 1,000 gal, not $18.75. N is first-year only too, which the page does say. Sig's Oct 14 ruling is "the value of ALL the nutrients". Check A2809's tables. Then either switch to total pounds or change the words to "what the crop gets the first year". Right now the words and the numbers disagree.
- Smaller issues:
  - The headline says "today's fertilizer prices", but the quotes are from Sep 1 (44 days old).
  - P is priced from MAP+S, a premium product. The page says the sulfur is not credited. Crediting the S at the AMS price would put P2O5 near $0.87.
  - The "Selling to a neighbor" section and FAQ are still on the page, which the f-group audit flagged against the Oct 14 ruling.

## Scores (1-5)

| Page | First screen | Current | Accurate/sourced | Local | Clear | Depth | Phone | Trust | Speed | Unique | Total |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **AGSIST /manure-value** | 5 | 3 | 3 | 3 | 4 | 5 | 5 | 5 | 4 | 4 | **41** |
| UMN Extension "What's manure worth?" web calculator* | 3 | 3 | 5 | 4 | 3 | 5 | 3 | 5 | 3 | 4 | 38 |
| Penn State Manure Nutrient Value Calculator (Excel)* | 1 | 3 | 5 | 4 | 2 | 5 | 1 | 5 | 2 | 4 | 32 |
| ISU Iowa Pork Industry Center calculator v1.2 (software)* | 1 | 2 | 5 | 4 | 2 | 4 | 1 | 5 | 2 | 3 | 29 |
| Univ. of Maryland Organic Nutrient Value Calculator (Excel)* | 1 | 2 | 5 | 4 | 2 | 4 | 1 | 5 | 2 | 4 | 30 |
| UW Extension Chippewa Co., "Estimating the value of manure" (2023)* | 3 | 1 | 4 | 2 | 4 | 2 | 4 | 5 | 4 | 2 | 31 |
| Univ. of Kentucky, "Use dairy manure nutrients wisely" (PDF)* | 3 | 2 | 4 | 2 | 4 | 2 | 3 | 5 | 4 | 3 | 32 |

\* from search snippets only; not opened.

## Where we win
- **A dollar answer on the first screen, at dated prices.** No competitor I found prints a number without you typing in fertilizer prices first. UMN, Penn State, ISU, Maryland and Kentucky all start blank or use 2022 examples. Search for "dairy manure worth per 1000 gallons 2026" turned up no current figure at all.
- **Every manure type at three incorporation timings, in one table**, with the pounds behind it, the MAP N credit explained and the worked example. It is a real web page that works on a phone. Penn State, Maryland and ISU are Excel or desktop downloads, and Penn State says many functions do not work on a Mac.
- **Trust.** It has a byline, sells nothing and says plainly what it does not count (sulfur).

## Where a competitor beats us, and how
- **Your own manure test (all of them).** Every extension tool takes lab results in lb/1,000 gal or lb/ton. Ours only offers book types, though the page tells you three times to get a test and "redo it with the real pounds". There is nowhere to type them.
- **Total versus available, said clearly (Penn State).** Penn State shows both the "potential value if all N-P-K were used" and the value against what the soil test calls for. We say "all" while showing first-year available (see above).
- **Net of application cost and second-year N (UMN).** UMN gives gross and net value after hauling (1 to 2 cents a gallon) and adds second-year N. Our second-year N sits in brackets and is never priced. Sig's ruling rules out the buyer/seller split and soil-test "fair range", so I would not copy the soil-need part.
- **Prices that are current (in principle).** Their user-entered prices are as fresh as the user's. Our default is 44 days old while the headline says "today's".

## Five changes, ranked by impact
1. **Settle total versus first-year, and make the words match the numbers (S-M).** Check A2809 (current edition) for total N, P2O5 and K2O by type. Per the Oct 14 ruling, lead with the value of the total pounds. Keep the first-year N column as a labeled second line ("what the crop can use the first year"). Fix the hero, FAQ and JSON-LD in the baker (scripts/bake_manure_value.mjs) and the TYPES table in components/manure-value.js, which is the one copy.
2. **Add "I have a manure test" to the calculator (S).** Add three boxes (N, P2O5, K2O, in lb per 1,000 gal or per ton). When they are filled in, they replace the book row, and the result says "from your test". This closes the biggest gap with every extension tool. It is all client-side, so there is no page-size cost.
3. **Keep the price date honest (S).** Drop "today's" from the H1 or refresh data/fertilizer.json monthly as promised. Show "quotes 44 days old" in the hero when they are more than 30 days old.
4. **Resolve the "Selling to a neighbor" section (S).** Fold the useful parts (test, dated prices, per-1,000-gal vs per-ton, hauling) into "Getting it tested" and "Rules that can apply". Rename the FAQ "What should I charge a neighbor" to "What is the manure worth?" so the page matches the ruling.
5. **Price second-year N as its own labeled line (S).** The bracketed numbers already exist. Add "plus about $X of N the year after" under the result. That answers UMN's second-year credit with no soil-need logic.

## Verdict
Best on the internet today? **Close.** It is the only page that gives a dated dollar figure per 1,000 gallons for every manure type without a spreadsheet. But it calls first-year-available P and K "all", which an extension reviewer would catch, and it cannot take a farmer's own test, which every competitor can.
