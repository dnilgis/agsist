# Head to head: agsist.com/store-or-sell

Checked Oct 15, 2026, from the read-only checkout. I rendered store-or-sell.html at 390x844 and 1280x800, opened every details panel, and tried ZIP 54728 (Chetek). No sideways scroll, no JS errors, about 450 KB loaded.

**What I could not see:**
- **Elevator mode.** For 54728 the page said "No elevator we read near 54728 posts a later corn bid right now, so this is the board." So I saw only the futures fallback. I did not see the page working from an elevator's own later bids, which is its headline feature.
- **Competitors.** I could not open any competitor host. Their cells come from search-result text and are marked *.

## Numbers checked by hand
- **Board case:**
  - Futures (data/prices.json, closes of 2026-10-14): Dec '26 $4.7875, Jul '27 $5.0575. Carry +27.0 cents.
  - Storage: 3.5 cents x 7 months = 24.5 cents.
  - Interest: $4.7875 x 7% x 7/12 = 19.55 cents.
  - Net: 27.0 - 24.5 - 19.55 = **-17.05 cents**, shown as "-17¢". Matches the page and its "Show the math" panel.
- **FAQ:** "$4.80 x 7% = about 2.8 cents a month, so a carry must beat about 6.3 cents a month." Correct: 4.80 x 0.07 / 12 = 2.8 cents.
- **Method issues (medium, labeled but they bias the answer):**
  - **The month count starts in December, not today.** On Oct 15 a farmer choosing between selling now and July stores about 9 months, not 7. At the default storage and interest that is about 12 cents more cost. The page does say "Dec '26 to Jul '27, 7 months".
  - **"Assumes your basis stays where it is today."** Harvest basis usually firms into spring, and that gain is often most of what storage pays. Extension methods (ISU, UMN, K-State, Kentucky*) all ask for an expected basis. So the board fallback leans against storing.
  - **The 3.5 cents a month default is a commercial storage rate.** On-farm variable cost is lower. The c-group audit already noted the defaults have no source.

## Scores (1-5)

| Page | First screen | Current | Accurate/sourced | Local | Clear | Depth | Phone | Trust | Speed | Unique | Total |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **AGSIST /store-or-sell** | 4 | 5 | 4 | 3 (5 with elevator bids) | 4 | 4 | 5 | 5 | 5 | 5 | **44** |
| UMN Extension carry-vs-interest method (the 140% rule, Agweek, Farm Progress)* | 3 | 3 | 4 | 1 | 4 | 2 | 4 | 5 | 4 | 3 | 33 |
| ISU Ag Decision Maker grain storage cost worksheets* | 2 | 2 | 5 | 2 | 3 | 5 | 2 | 5 | 3 | 3 | 32 |
| Univ. of Kentucky, "To store or not to store: old crop exit strategies"* | 3 | 2 | 4 | 1 | 4 | 3 | 3 | 5 | 4 | 2 | 31 |
| K-State AgManager storage and marketing papers (2025 WTG)* | 2 | 3 | 5 | 2 | 3 | 4 | 2 | 5 | 3 | 3 | 32 |
| Farm Progress / Farm Futures store-vs-sell commentary (Oct 2025)* | 4 | 2 | 3 | 1 | 4 | 2 | 4 | 3 | 2 | 2 | 27 |
| Texas A&M AgriLife, "Sell or store decisions for wheat"* | 3 | 2 | 5 | 1 | 4 | 3 | 3 | 5 | 4 | 2 | 32 |

\* from search snippets only; not opened.

## Where we win
- **A signed answer in cents a bushel on the first screen, from yesterday's closes.** It shows the math line by line, with your own storage, interest and shrink kept on the device. Every competitor I found is a method or a worksheet. Search turned up no current-year carry at all ("I couldn't find current 2026 carry data").
- **The elevator's own posted later bids, where they exist.** No extension tool reads local bids. That is unique, though I could not see it work here.
- **Interest counted honestly.** The FAQ answer on why storage can lose money even with a carry is the clearest I saw.

## Where a competitor beats us, and how
- **Expected basis (ISU, UMN, Kentucky, TAMU).** They all build in a harvest-to-later basis change. Ours assumes none on the board, the case most ZIPs will see until more elevators post deferred bids.
- **Full cost list (ISU).** ISU lists seven costs: facility, interest, extra drying, shrink, quality loss, handling and aeration. It also splits on-farm from commercial. We have three inputs and a commercial default.
- **Selling the carry (UMN, Farm Futures).** They show the store-and-hedge choice (sell July futures or an HTA now). We never mention that the carry can be locked in today.

## Five changes, ranked by impact
1. **Add expected basis gain to the board fallback (M).** AGSIST already has basis history (the Basis vs Normal page). For the ZIP's area, show "basis has firmed about X cents from mid-October to July in the last N years (median)". Add it as its own labeled line in the math, with the range, and leave it out by default if Sig prefers. If the data is thin for the area, say so and show nothing. This fixes the one bias in the answer.
2. **Count months from today, not from December (S).** In the board case, use today's month to the delivery month. Or keep December but add one line: "If you sell now instead, add about N cents for Oct-Dec storage." The elevator mode already counts from the spot month.
3. **On-farm versus commercial preset (S).** Add a toggle that sets storage to an on-farm variable figure (with a source) or the commercial 3.5 cents. Add a source line for both defaults and the 7% interest (for example the Farm Credit or prime rate on a stated date).
4. **One line on locking the carry (S).** "When net is positive, you can lock it now by selling Jul futures or an HTA for July. This removes the futures risk but not the basis." This is plain education, not advice.
5. **Show which ZIPs get elevator mode (S).** When the fallback fires, name the nearest elevator that does post later bids and how far away it is. Or say how many in the network do. Then a farmer can tell whether the board answer is all there is.

## Verdict
Best on the internet today? **Yes, narrowly.** No other free page gives a current, signed, local cents-a-bushel answer with the math shown. But the board fallback leaves out basis gain and the Oct-Dec months, the two things an extension economist would point out first.
