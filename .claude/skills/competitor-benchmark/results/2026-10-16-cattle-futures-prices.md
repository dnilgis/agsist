# Head to head: agsist.com/cattle-futures-prices

Checked Oct 16, 2026, from the read-only checkout. I rendered cattle-futures-prices.html at 390x844 and 1280x800. No sideways scroll and no JS errors (one blocked outside call). The HTML is 80 KB, and the phone page is about 7,300 px long.

What the page shows:
- Quotes from data/prices.json, Oct 16 at 11:16 a.m. CT: Oct '26 live cattle $227.35 (+$1.40) and Oct '26 feeders $343.70 (+$0.33).
- A new cash block from data/cattle-cash.json: 5-area fed steers $220.14 (week ending Oct 11) and Choice cutout $373.98 (Oct 15).
- A link to the new sale barn page.
- Fund positioning from CFTC as of Oct 6.

Competitors were scored only from the copies GitHub Actions fetched on Oct 16 (references branch, ids bench-cattle-futures-prices-1..3):
- **Barchart (-1):** saved as a 212-byte empty app shell. Not readable, all cells "?".
- **Drovers (-3):** the fetch failed (HTTP 403, no archive copy). Not readable.
- **CME Group, TradingView and DTN (-4..6):** app-only and not fetched. Not readable.
- **K-State (-2):** the only competitor with a readable copy. The URL in the list is the September 2025 edition, so it is scored as that dated edition. Phone is "?" and its total is out of 45.

## Numbers checked by hand
- **Title and meta (the Oct 15 bug is fixed):**
  - They now say "Feeder Cattle Futures $343.38 & Live Cattle $225.95 ... on Oct 15".
  - The Oct 15 settles in prices.json are $343.375 and $225.95. Match.
- **Feeder/live ratio:** $343.70 / $227.35 = 1.5118, shown 1.512. Matches.
- **Forward curve:**
  - Apr '27 $231.775 - Oct '26 $227.35 = $4.425 (shown $4.42). Over 6 months that is $0.74 a month.
  - The curve eases back to $226.20 for Jun '27.
  - Matches, apart from rounding (below).
- **5-year percentiles:**
  - Live cattle: $227.35 is above 214 of 261 weekly closes (82.0%), shown 82nd.
  - Feeders: $343.70 is above 82.4% of them, shown 82nd.
  - Both match data/price-stats.json.
- **Cost-of-gain calculator, default case:**
  - Purchase: 800 lb x $343.70 = $2,749.60.
  - Feeding: 600 lb x $1.15 = $690.00.
  - Total $3,439.60. Break-even: $3,439.60 / 1,400 x 100 = $245.69/cwt.
  - All match.
  - Sale at $231.77: 14 cwt x $231.77 = $3,244.78, which is -$194.82 a head. Matches the page.
- **Fed steers:**
  - From data/cattle-cash-raw/fed_steer.txt (LM_CT150, Oct 12): Steers Live FOB, total all grades, 19,561 head at $220.14.
  - Worked: (19,383 x $220.11 + 178 x $223.00) / 19,561 = $220.14. Matches.
- **Managed money:**
  - Live cattle (50,695 - 47,696) / (138,018 - 47,696) = 3% of the 52-week range.
  - Feeders 11%.
  - Both match data/cot.json.
- **Cutout:** I could not check it by hand. data/cattle-cash.json says Oct 15, Choice $373.98. The raw copy in data/cattle-cash-raw/cutout.txt is still the Oct 14 report ($376.50, which the json showed before the Oct 15 update). The bot commits the json but not the raw text.

## Scores (1-5)

| Page | First screen | Current | Accurate/sourced | Local | Clear | Depth | Phone | Trust | Speed | Unique | Total | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **AGSIST /cattle-futures-prices** | 4 | 5 | 4 | 2 | 4 | 5 | 4 | 4 | 4 | 4 | **40/50** | rendered Oct 16 |
| K-State Kansas feedlot returns (Tonsor), Sep 2025 PDF | 2 | 1 | 5 | 3 | 3 | 4 | ? | 5 | 3 | 4 | 30/45 | fetched Oct 16; dated Sep 12, 2025 |
| Barchart feeder cattle futures | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | not readable: empty app shell (212 bytes) |
| Drovers 2026 breakevens story | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | not readable: fetch failed, HTTP 403 |
| CME Group live cattle | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | not readable: app-only, not fetched |
| TradingView LE1! | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | not readable: app-only, not fetched |
| DTN livestock markets | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | not readable: not fetched |

What the K-State copy has:
- **Monthly projected net returns for Kansas finishing steers and heifers:**
  - Each closeout month runs through May 2026.
  - Columns: net return, feeding cost of gain, fed price, fed futures, fed basis, feeder price, and break-even cost of gain, fed price and feeder price.
  - Example row: "Aug-25 735.51 97.81 238.21 236.76 1.45 255.57 ...".
- **Closeouts:** it starts from Focus on Feedlots closeouts ("lots closed out in July of 2025 ... +$533.39/hd").
- **Edition:** it is the Sep 2025 edition, 13 months old as saved.

## Where we win
- **One page, board and cash.** Live and feeder quotes, the forward curve, 5-year percentiles, the feeder/live ratio and fund positioning are all on one page. It now adds the 5-area fed steer price and the Choice cutout, each dated by its own USDA report, plus a sale barn link. No readable competitor copy has this.
- **A break-even pre-filled from today's board,** with the finish month matched to the right contract.
- **Honest labels:** "not CME settlements", "4 years is a short window", "These are cash prices, not futures".

## Where they beat us, and how
- **Cost of gain from real closeouts (K-State).** K-State's feeding cost of gain comes from feedlot closeouts by month, and its break-even fed price and break-even feeder price come from that series. Our default is $1.15/lb with no source, against a stated "typical $0.90 to $1.30".
- **Basis (K-State).** K-State prints fed basis (cash minus futures) for each month. We now show the cash fed steer price ($220.14) and the futures ($227.35) but never the difference, and the two are dated a week apart.
- **Break-even feeder price (K-State).** It answers "what can I pay for a feeder". Our calculator answers only "what do I need to sell at".

## Bugs found
- **No math errors.**
- **Low:** the Apr '27 contract at $231.775 is shown and used as $231.77; half-up rounding gives $231.78. The effect on the calculator is 7¢ a head (-$194.82 vs -$194.75).
- **Low:** the fed steer label says "steers sold live, all grades". The figure is negotiated cash, live FOB only (the report's 374 live-delivered head are separate). Say "negotiated, live FOB".
- **Low:** the positioning block says "Updated yesterday" for positions as of Oct 6, released Oct 9. The file was re-read, but the data did not change.
- **Low-medium (framing):** the positioning text says the live cattle reading (3% of its 52-week range) "leaves room for funds to buy back in". /cot ranks the same position at the 36th percentile since 2010, middling, and says positioning is not a timing signal. The two pages disagree in tone, and this sentence leans toward a forecast.
- **Low (audit trail):** data/cattle-cash-raw lags data/cattle-cash.json, so the published cutout cannot be checked from the repo.

## Five changes, ranked
1. **Cost of gain that is not a bare default.**
   - What: build the default from parts the reader can see: today's corn futures x a stated feed conversion, plus yardage, interest and death loss as separate inputs. Say where each default comes from, and let the reader overwrite it.
   - Why: the break-even is the reason a feeder opens the page, and the cost of gain drives it. K-State's closeout-based cost of gain is the gap.
   - Effort: M. Honesty risk: medium. A ration-based cost is an estimate, so label it as one. Do not import K-State's numbers.
2. **Basis and a break-even feeder price.**
   - What: show "cash minus nearby futures" for fed steers (both from the same week), with its date. Add a second calculator output: the most you can pay for the feeder at today's deferred board and your cost of gain.
   - Why: a seller's cash price is futures plus basis, and "what can I pay" is the buyer's question.
   - Effort: S. Honesty risk: low, if the dates are matched and said.
3. **Next Cattle on Feed date on the page.**
   - What: "Next Cattle on Feed: Fri Oct 23, 3 p.m. ET (NASS)", read from the dates usda-calendar.html already lists (Oct 23, Nov 20, Dec 18). Do the same in the FAQ, which now says only "third or fourth Friday".
   - Why: it is the scheduled mover for this market, and the date is already in our calendar.
   - Effort: S. Honesty risk: none.
4. **Local feeder price in the calculator.**
   - What: a "use my sale barn" option that fills the feeder price from data/cattle-auction.json for the reader's weight class and auction, dated, in place of the 700-899 lb futures.
   - Why: lighter calves bring more per cwt than the index, and the sale barn data is already on the site. Local is our lowest score.
   - Effort: M. Honesty risk: low. Show the auction, date and head count; show a dash if no recent sale.
5. **One positioning yardstick across pages.**
   - What: use the /cot share-of-open-interest percentile since 2010 here, link to /cot, and drop "leaves room for funds to buy back in". Say "as of Oct 6, released Oct 9" in place of "Updated yesterday".
   - Why: two pages giving different reads of the same CFTC number costs trust, and /cot found no timing signal.
   - Effort: S. Honesty risk: none (it removes one).

## Verdict
**Close.** It is the most complete free one-page cattle read I could check: board, cash, cutout, curve, positioning and a break-even, and every number I worked matches. Two gaps remain. The cost of gain is still an unsourced default, and the page has no basis or Cattle on Feed date. I could not read most competitors (Barchart shell, Drovers 403, CME/DTN/TradingView not fetched), so this verdict rests on one readable rival.

## Change since Oct 15
36 to 40 (+4):
- current 4 to 5 (intraday quotes, cash dated Oct 15)
- local 1 to 2 (the sale barn link and the cash block)
- depth 4 to 5 (the cash side)
- unique 3 to 4

Oct 15 changes done: 1 (cash side, partly: fed steers and cutout, but no Feeder Cattle Index or basis) and 2 (title and meta now use the Oct 15 settles). Open: 3 (Cattle on Feed date on the page; it is now in usda-calendar), 4 (sourced cost of gain) and 5 (weight slide). Competitor totals are not comparable with Oct 15: those were from search snippets out of 50.
