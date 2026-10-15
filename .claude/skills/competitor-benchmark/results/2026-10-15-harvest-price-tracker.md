# Head to head: harvest-price-tracker.html, 2026-10-15

Checkout: wt/h2h at 3d3fe0b678. I rendered the page at 390 x 844 and 1280 x 800 (shots and text are in scratchpad/h2h/mk/). The page does not scroll sideways (phone height 10,580 px). harvest-prices.json (updated Oct 14) and the RMA discovery mirror both loaded. The phone's first screen shows the state picker plus Corn: projected $4.62, harvest price so far $4.93 (10 of 22 settles).
**What I could not see:** I could not open any outside site (DNS/proxy), including prices.rma.usda.gov. Competitor facts come from search snippets, marked (s). I did not try every state in the picker; I checked the national view.

Queries searched: "2026 harvest price crop insurance corn soybeans October", "harvest price tracker … average so far", "RMA price discovery harvest price 2026", "Ag Decision Maker harvest price". No result gives a 2026 October running average. What ranks: AFBF Market Intel, farmdoc daily (March projected-price pieces), ISU AgDM, DTN (it posts after Oct 31; "Harvest Prices for 2025" ran 10/31/25), Farm Credit Services of America "Crop Price History and Calculation Periods", GreenStone FCS "Crop Insurance Commodity Pricing", RMA notices (PM-26-051 for the August window), and actuary.info.

## Scores (1-5)

| | First screen | Current | Accurate+sourced | Local | Clear | Depth | Phone | Trust | Speed | Unique | Total |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **AGSIST** | 5 | 5 | 4 | 5 (state windows and prices) | 4 | 5 | 4 | 4 | 4 | 5 | **45** |
| USDA RMA Price Discovery (s) | 3 | 5 | 5 | 4 | 2 | 3 | 2 | 5 | 3 | 3 | 35 |
| farmdoc daily (s) | 3 | 3 (projected in March, harvest after Oct) | 5 | 2 | 4 | 4 | 3 | 5 | 4 | 3 | 36 |
| ISU Ag Decision Maker (s) | 2 | 2 | 5 | 3 | 3 | 4 | 2 | 5 | 3 | 3 | 32 |
| AFBF Market Intel (s) | 2 | 3 | 5 | 1 | 4 | 4 | 3 | 4 | 4 | 2 | 32 |
| FCS America / GreenStone price pages (s) | 3 | 3 | 4 | 2 | 4 | 2 | 3 | 3 (sell insurance) | 4 | 2 | 30 |
| DTN harvest price article (s) | 3 | 2 (after month end) | 4 | 1 | 4 | 2 | 3 | 4 | 3 | 2 | 28 |

## Where we win
- **The running number, before the month ends.** We show the running average every evening, with days counted (10 of 22), next to RMA's own mirrored figure. That covers 14 crop and type combinations, organic separately, with the states listed for each. DTN, farmdoc and the lenders publish after Oct 31.
- **State aware.** It shows windows by state (the South in August, the Northwest in November), and the calculator uses your state's projected price (Georgia corn $4.42).
- **The math a farmer needs next:** the RP guarantee, guaranteed bushels for safe forward sales, and the plain warning that RP protects revenue, not delivery, and does not cover basis.
- **History, checked by hand.** "Harvest below projected in 10 of 15 years, corn and soybeans (2011-2025)" checks against RMA prices. Corn was below in 2013-19 and 2023-25. Soybeans were below in 2011, 2014, 2015, 2017-19 and 2022-25, and 2013 was equal at $12.87, correctly not counted. 2012 corn 5.68 → 7.50 = +32%; 2014 corn 4.62 → 3.49 = −24%. Trading days in Oct 2026 = 22, with 10 through Oct 14. RMA's mirror ($4.95 / $12.88) equals our 9-day average through Oct 13 ($4.948 / $12.883): OK.

## Where competitors beat us, and how
- **Official status.** RMA is the price. We mirror it and say so plainly, which is right. But our own running average and RMA's figure differ by 2¢ corn and 1¢ soy on one screen, and the note explains the gap backwards (W2).
- **Lender and university trust.** farmdoc and ISU carry university bylines and peer-reviewed method. We have a CCA byline and a Method line, which is good, but the page twice says "confirm it with your agent", and the contact is a farmers1st.com address on an insurance topic. Both make the page read less neutral than farmdoc.
- **Search presence.** None of the queries surfaced us. The H1 "When does your price get set?" answers *when*, but the searcher wants *what is it so far*.

| # | Finding | Severity |
|---|---|---|
| W1 | The Oct 14 value in the series ("s", called a settle) is a pre-settle Yahoo last: corn 4.81 vs 4.7875 and soybeans 12.775 vs 12.7225 in prices.json at 03:16 UTC. The build ran at 21:54 UTC, before Yahoo posted the close. The averages still round the same today ($4.93 / $12.87; corrected $4.932 / $12.867), but on a close day it could move the cent shown. | Low-Medium |
| W2 | The note says the running average "can lag RMA's posted figure by a day". Today ours includes Oct 14 and RMA's runs through Oct 13, so ours is a day *ahead*. Say which days each covers. | Low |
| W3 | "Confirm it with your agent" and "work it through with your agent" go against the no-routing-to-agents rule in spirit. Use "check your policy's actual guarantee" instead. | Low |

## The 5 changes, ranked by impact
1. **Answer the October question with arithmetic, not a forecast:** "Your guarantee is up 6.7% on corn ($4.93 vs $4.62) and 16.1% on soybeans ($12.87 vs $11.09) so far. For corn's harvest price to finish under $4.62, the remaining 12 settles would have to average under $4.36 (Dec closed $4.78¾). Soybeans would have to average under $9.61 ($12.72¼)." Recompute it each evening. No one else shows this. Effort S.
2. **Put the number in the H1 and title:** "2026 harvest price so far: corn $4.93, soybeans $12.87 (Oct 1-14)". Keep "When does your price get set?" as the second line. Effort S. This is the search fix.
3. **Fix provisional settles (W1, W2):** build after the close, or mark today's figure "provisional" until the next run confirms it. Label the two figures "ours through Oct 14 · RMA's through Oct 13". Effort S.
4. **A small chart of the window:** the daily settles, the running-average line and the projected-price line, from the series already in the file. Follow the dataviz skill and keep it inline SVG. Effort S.
5. **Show the guarantee change in dollars per acre** in the calculator: "200 bu APH at 80%: 160 bu x $4.93 = $788.80/ac vs $739.20 at projected (+$49.60) so far". Apply the W3 wording fix and a neutral contact address along with it. Effort S.

**Best on the internet today? Yes, for corn and soybean farmers in October.** It is the only page I found that shows the running harvest price before Oct 31, state by state, next to RMA's own figure, with checked history and guarantee math. The caveats: I read competitors only through search snippets, and the page is not yet found in search. Changes 1 and 2 would make the lead obvious.
