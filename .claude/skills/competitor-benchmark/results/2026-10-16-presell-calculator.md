# Head to head: agsist.com/presell-calculator (a redirect; scored as /harvest-price-tracker#presell)

Checked Oct 16, 2026. presell-calculator.html is still a noindex redirect (meta refresh plus location.replace) to /harvest-price-tracker#presell, canonical /harvest-price-tracker. I confirmed the redirect fires in the browser; the extensionless target 404s on a plain local server, as expected, and GitHub Pages serves it. So I scored the pre-sell step on harvest-price-tracker.html, rendered at 390x844 and 1280x800, and looked at both before and after filling it in. No sideways scroll, no JS errors, about 863 KB loaded for the whole tracker page. The full tracker has its own report; this one scores only the pre-sell step.

Competitors are scored only from the copies saved on the references branch (fetched Oct 16):
- MSU Extension: the saved copy is 958 bytes, header only. **Not readable.** All cells "?".
- ISU FM1853: the saved copy is the Extension Store product listing (title, "3 pages", "02/2021", a one-line description). The publication itself is not in it. **Content not readable.** Cells "?" except what the listing shows.
- ADM/CRS crop insurance worksheet (2021 PDF): **readable.**
- Farm Progress over-contracting article: **fetch failed** (HTTP 403, no Wayback copy). All cells "?".
- ISU Ag Decision Maker A1-54: in the competitor list but **not fetched** (no entry in the references index). All cells "?".

## Numbers checked by hand (filled in through the page, Oct 16 data)
- **Iowa corn, APH 200, 80%, 500 ac:** 200 x 0.80 = 160 bu/ac, x 500 = 80,000 bu. Guarantee 160 x $4.62 = $739.20 (shown $739). At the running harvest price 160 x $4.93 = $788.80 (shown $789, +6.7%, $50). Cautious mark 200 x 0.75 = 150 bu/ac, 75,000 bu. All match.
- **Georgia corn, APH 150, 75%, 300 ac:** 112.5 bu/ac, 33,750 bu. 112.5 x $4.42 = $497.25 ($497); x $4.69 = $527.63 ($528, +6.1%, $30). No cautious mark shown, correct, since 75% coverage is already at the 75% mark. Match.
- **Iowa soybeans, APH 60, 85%, 400 ac:** 51 bu/ac, 20,400 bu. 51 x $11.09 = $565.59 ($566); 51 x $12.87 = $656.37 ($656, +16.1%, $91). Cautious 45 bu/ac, 18,000 bu. Match.
- **Two harvest prices on one page (not a bug):** the top of the page shows corn $4.92 (our own average of 11 settles through Oct 15; I re-averaged the series in data/harvest-prices.json and got 4.92), the calculator uses RMA's running $4.93 from data/rma-prices.json. The page says the two can differ by a cent or two and RMA's is official.
- **Oct 15 fixes shipped:** the "floor of $4.62" wording is gone. It now reads "inside your revenue guarantee of $789 /ac ... It is a guarantee on revenue, not a price for each bushel." A cautious mark at 75% of APH was added.

## Scores (1-5)

| Page | First screen | Current | Accurate/sourced | Local | Clear | Depth | Phone | Trust | Speed | Unique | Total | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **AGSIST pre-sell step (/harvest-price-tracker#presell)** | 3 | 3 | 5 | 4 | 4 | 4 | 4 | 4 | 3 | 4 | **38** | rendered Oct 16, 390 and 1280, four cases run |
| ADM/CRS Crop Insurance Worksheet (2021 PDF) | 2 | 1 | 4 | 3 | 3 | 4 | 1 | 2 | 3 | 3 | 26 | fetched Oct 16 |
| ISU FM1853 Revenue Protection (store listing) | 1 | 1 | ? | ? | ? | ? | ? | ? | ? | ? | ? | fetched Oct 16; listing only, publication not readable |
| MSU Extension, how many bushels should I market | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | not readable (empty copy) |
| Farm Progress, falling short on contracted bushels | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | not readable (HTTP 403) |
| ISU Ag Decision Maker A1-54 | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | not fetched this run |

## Where we win
- **Live and personal.** Your state's own projected price, your APH, coverage and acres, and the running harvest price, with bushels per acre and whole-farm bushels. The ADM worksheet is a blank 2021 form you fill by hand.
- **Both a full and a cautious number** now, with the reason for the cautious one.
- **No sales agenda.** The ADM sheet ends "Contact your local ADM representative".

## Where they beat us, and how
- **ADM worksheet prices the short crop.** Its Step 3 and Step 4 walk from "Revenue Guarantee (greater of spring or fall)" minus "Actual Yield x Harvest Price" to the indemnity, then to the "Cancellation Payment (if you sold more bushels than you grew)": harvest price minus contract price plus a cancellation fee, times the bushels to cancel, ending in a gross revenue per acre. Our step says a short crop "may" mean buying bushels back but never shows the dollars.
- **ADM includes the contract price.** It adds forward-contracted revenue to the picture. Ours ignores the price the farmer sold at.
- The other four could not be read, so I cannot say whether they beat us.

## Bugs
1. **Low:** on a phone the Acres box is so narrow its placeholder "e.g. 500" shows as "e.g. 5".
2. **Low (first screen):** landing on #presell with no state picked shows empty grey boxes and "Pick your state first" in the step above, with no number anywhere in view.

## Five changes, ranked
1. **A one-line short-crop example from the numbers on screen (S).** For the Iowa case: "Sell 160, raise 120: RP pays about $197/ac (guarantee $789 minus 120 x $4.93), and you buy back 40 bu at the cash price, basis not covered." Pure arithmetic from inputs already entered. Honesty risk: low if labeled as an example, not a forecast.
2. **Season note (S).** From the end of the harvest window until February: "Planning 2027? The projected price is set in February; until then this uses 2026 prices." Optionally show Dec '27 futures as a labeled estimate. Honesty risk: low with the label.
3. **Optional contract price (M).** One more box: "price you sold at". Show contract revenue plus any indemnity minus buyback cost for the example yield, as the ADM sheet does by hand. Honesty risk: medium (scenario math; must say basis and fees are not in it).
4. **A number on first screen (S).** If no state is picked, pin "pick your state above" next to the step heading, or remember the last state in localStorage. Honesty risk: none.
5. **Widen the Acres box on phone (S).** Full width at 390. Honesty risk: none.

## Verdict
Best on the internet today? **Close.** It is the only live pre-sell number I could read, every case checks out, and both Oct 15 fixes shipped. The one readable competitor, a 2021 vendor worksheet, still does something ours does not: it prices what happens when you sold more than you grew.

**Change since Oct 15:** 35 to 38 (+3). The wording fix and cautious mark raised accuracy, depth and unique value.
