# Head to head: agsist.com/milk-prices

Checked Oct 15, 2026, from the read-only checkout. I rendered milk-prices.html at 390x844 and 1280x800. No sideways scroll, no JS errors (one blocked analytics call). On a phone the page is about 15,400 px long.
- Class prices and components: September 2026, USDA AMS.
- All-milk and DMC: August 2026, NASS.
- Mailbox price: March 2026, labeled "Older figure, not current".
- Class III futures: from data/prices.json, which lists "milk" in stale_keys (the continuous series was repaired for roll contamination). The contract quotes are dated Oct 14 and 15.

**What I could not see:** I could not open any competitor host (DNS refusal). Competitor cells are from search-result text and are marked *.

## Numbers checked by hand
- **Class III, September 2026:**
  - Skim = protein $2.6619 x 3.30 + other solids $0.4147 x 6.00 = $8.7843 + $2.4882 = $11.2725, rounded to $11.27.
  - Class III = 0.965 x $11.27 + $1.4762 x 3.5 = $10.8756 + $5.1667 = **$16.04**.
  - That matches the page, and it matches USDA Dairy Market News as quoted in search: "Class III: $16.04 ($-0.60)", skim $11.27.
- **Other solids:** (dry whey $0.6694 - whey make allowance $0.2668) x 1.03 = $0.4147. Matches.
- **Butterfat:** (butter - $0.2272) x 1.211 = $1.4762 implies butter at $1.4462, shown rounded as $1.45. Consistent.
- **DMC:** $19.80 - $10.46 = $9.34, which is under the $9.50 tier. Matches.
- **100-cow example:**
  - 2,170 cwt x $19.80 = $42,966.
  - 2,170 x $19 = $41,230.
  - Left over: $1,736. Matches.
- **Class III minus Class IV:** $16.04 - $18.94 = -$2.90. Matches.
- **No math errors.**
- **To check (not shown wrong):**
  - Search snippets quote CME settlements on Sep 30 of Oct $14.94, Nov $15.50 and Dec $15.83. The page shows Oct $15.05, Nov $17.07 and Dec $17.18 two weeks later.
  - A $1.57 rally in Nov in two weeks is possible, but the milk feed is the one flagged stale in prices.json. Someone should compare it with a CME settlement before it is trusted.
- **Framing issue (low):** "The trap: when your best milk pays you less" is written for Class III above Class IV. This month it is the other way round (III is $2.90 under IV), and the page links the trap right from that line without saying the current gap runs the other direction.

## Scores (1-5)

| Page | First screen | Current | Accurate/sourced | Local | Clear | Depth | Phone | Trust | Speed | Unique | Total |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **AGSIST /milk-prices** | 4 | 4 | 5 | 3 | 3 | 5 | 3 | 5 | 3 | 5 | **40** |
| USDA AMS Dairy Market News and FMMA class price announcements (fmmacentral.com)* | 2 | 5 | 5 | 3 | 2 | 4 | 2 | 5 | 3 | 3 | 34 |
| Center for Dairy Excellence (PA) milk price pages* | 3 | 4 | 4 | 3 | 3 | 3 | 3 | 4 | 3 | 3 | 33 |
| CME Group Class III/IV futures* | 3 | 5 | 4 | 1 | 3 | 3 | 3 | 4 | 2 | 2 | 30 |
| Progressive Dairy (agproud.com) monthly class price articles* | 3 | 4 | 4 | 1 | 4 | 2 | 3 | 4 | 3 | 2 | 30 |
| UW-Madison Extension dairy situation and outlook* | 2 | 2 | 5 | 2 | 3 | 4 | 2 | 5 | 3 | 3 | 31 |
| Dairy Herd (Farm Journal) milk price market stories* | 3 | 4 | 3 | 1 | 3 | 2 | 3 | 3 | 2 | 2 | 26 |

\* from search snippets only; not opened. The UW outlook items found in search were from 2023. I could not confirm a 2026 edition. dairymarkets.org did not appear in search at all.

## Where we win
- **It shows how the check is built, with this month's real numbers.** It walks from cheese, whey and butter to protein, other solids and butterfat, then to Class III, then to blend, PPD and hauling, and finally to the mailbox. I found no other free page that does the whole chain with live USDA figures and lets you move the prices yourself.
- **State all-milk table, the DMC margin, and a farm-sized example,** each dated and sourced.
- **Risk tools with the catch spelled out** (DRP, DMC, forwards), and AGSIST sells none of them.

## Where a competitor beats us, and how
- **Mailbox price (AMS, CDE).** Our mailbox figure is March, six months old, and the page says it is "not in a public machine-readable feed". The farmer's real number is the one we are weakest on.
- **Speed to the answer on a phone.** The page is about 15,400 px long. AMS and agproud give the class prices in one screen. Ours is also near the top, but the page then runs very long.
- **Class IV and the strip (CME).** We show four Class III months only. With Class IV $2.90 over Class III, Class IV futures matter for most blend checks.

## Five changes, ranked by impact
1. **Get a current mailbox price (M).** AMS publishes mailbox prices by order each month (PDF). Parse the latest month, or at least print "Latest AMS mailbox report: <month>, <link>" so the farmer knows a newer one exists. Keep the dash rule for anything we cannot read.
2. **Sanity-check the milk futures feed before showing it (S).** prices.json flags milk as stale. Compare each contract with the last CME settlement, and show a dash, not a number, when they disagree. Nov $17.07 vs the Sep 30 settlement of $15.50 is the case to test.
3. **Say which way the gap runs this month (S).** Under the III-minus-IV line, add: "This month Class IV leads by $2.90. The trap below is the reverse case (cheese above butter-powder)." State only what the formula says, with no forecast.
4. **A component check estimator (M).** Inputs: fat and protein test, your order, hauling. It multiplies by this month's component prices and adds a PPD input. Load it on demand. No competitor I found does it for free.
5. **Shorten the phone page (S).** Collapse "What changed in 2025" and "Background" behind toggles, and add Class IV futures next to Class III. Target under 9,000 px.

## Verdict
Best on the internet today? **Close.** For explaining a milk check with this month's real numbers, nothing I found comes near it, and the Class III math is exact. It falls short on the one number a dairy farmer banks (a six-month-old mailbox price), and the futures block rests on a feed marked stale.
