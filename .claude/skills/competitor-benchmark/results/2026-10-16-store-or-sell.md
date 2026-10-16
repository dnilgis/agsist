# Head to head: agsist.com/store-or-sell

Checked Oct 16, 2026, from the read-only checkout (d578415f0). I rendered store-or-sell.html at 390x844 and 1280x800 in three states: no ZIP (the board), ZIP 62565 (Assumption, IL) and ZIP 54728 (Chetek, WI). Every details panel was open. Elevator bids came from the local dnilgis/bids copy, read Oct 15 at 8:40 PM CT. Futures came from data/prices.json, fetched 2026-10-16 16:01 UTC. No sideways scroll and no JS errors. The page loads about 470 KB before a ZIP. A ZIP lookup then fetches data/merged-index.json, which is 2.8 MB raw and about 200 KB gzipped.

**Since Oct 15:**
- **Elevator mode is now seen working.** 54728 now gets CDR Farms, Bloomer, plus five ALCIVIA locations. On Oct 15 that ZIP got only "the board".
- **The board counts months from today.** It now uses Oct '26 to Jul '27, 9 months, and says why.
- **A lock-the-carry line shows when net is positive.** For futures it reads "selling Jul futures or a hedge-to-arrive ... not the basis". For a posted bid it suggests a forward contract.
- **The FAQ now covers the on-farm cost logic.**
- **Still open:** expected basis gain on the board, and an on-farm preset.

**Competitor copies:**
- Read: University of Kentucky (Oct 13, 2025 article) and the K-State AgManager / UMN Usset webinar PDF (May 29, 2024), both fetched Oct 16.
- Not readable:
  - ISU decision tools page and ISU A2-35: HTTP 403.
  - Farm Progress: HTTP 403.
  - DTN cost of carry: app only, not fetched.
- I did not score phone for any competitor, so their totals are out of 45.

## Numbers checked by hand
- **Board (no ZIP):**
  - Carry: Jul '27 $4.985 - Dec '26 $4.74 = +24.5 cents.
  - Storage: 3.5 x 9 = 31.5 cents.
  - Interest: 4.74 x 7% x 9/12 = 24.9 cents.
  - Net: 24.5 - 31.5 - 24.9 = -31.9, shown as "-32 cents". Matches.
- **ZIP 62565, Assumption Coop Westervelt** (the shard has Oct $4.54, Dec $4.60, Jan $4.63, Mar $4.67 and Oct '27 $4.75):
  - Dec: 6 - 7.0 - (4.54 x 7% x 2/12 = 5.30) = -6.3, shown as -6 cents.
  - Jan: 9 - 10.5 - 7.9 = -9.4, shown as -9 cents.
  - Mar: 13 - 17.5 - 13.2 = -17.7, shown as -18 cents.
  - Oct '27 is correctly left out as new crop. The "Show the math" panel matches to the tenth of a cent.
- **ZIP 54728:**
  - ALCIVIA Menomonie, Oct $4.14 to Jan $4.36: 22 - 10.5 - 7.2 = +4.3, shown as +4 cents.
  - CDR Farms, Oct to Nov flat: 0 - 3.5 - 2.4 = -5.9, shown as -6 cents. Both match.
- **FAQ:** at $4.80, 7% a year is 2.8 cents a month. Correct.

## Bugs
- **Low to medium: the label says "closes" during the session.** The board line says "Carry from Dec '26 to Jul '27 corn futures, closes of 2026-10-16". The prices file was fetched at 11:01 AM CT on Oct 16, mid-session, so these are delayed intraday quotes, not closes. The "Show the math" text also says "futures are Yahoo Finance daily closes".
  - Where: components/store-or-sell.js:204 builds `'closes of ' + fm.date` from close_date without checking whether the session has ended.
  - The math is right. The label is not.
- **Unconfirmed, possibly low: merged-index may download twice.** On a ZIP lookup, bids-network.js (fetchOnce) and storesell.js (getJson, line 426) each fetch data/merged-index.json. The code comment says the browser answers the second from cache. In my harness the routed responses bypass the cache, so I saw two 2.8 MB responses, which proves nothing. Check in a real browser on a cold cache. If both download, that is about 200 KB extra gzipped on phones.

## Scores (1-5)

| Page | First screen | Current | Accurate/sourced | Local | Clear | Depth | Phone | Trust | Speed | Unique | Total | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **AGSIST /store-or-sell** | 5 | 5 | 4 | 5 | 4 | 5 | 5 | 5 | 4 | 5 | **47/50 (42/45 without phone)** | rendered Oct 16, three ZIP states |
| Univ. of Kentucky, Large crops and low prices put pressure on grain storage (Oct 13, 2025) | 3 | 2 | 4 | 2 | 4 | 3 | ? | 5 | 4 | 3 | 30/45 | fetched Oct 16 |
| K-State AgManager / UMN (Usset) marketing plans webinar PDF (May 29, 2024) | 1 | 1 | 4 | 1 | 2 | 4 | ? | 5 | 2 | 3 | 23/45 | fetched Oct 16 |
| ISU Ag Decision Maker decision tools | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | not readable (HTTP 403, Wayback 429/timeout) |
| ISU A2-35 Grain Storage Alternatives | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | not readable (HTTP 403, no archive) |
| Farm Progress, sell, store or sell-and-re-own | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | not readable (HTTP 403, no archive) |
| DTN ProphetX cost of carry calculator | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | not fetched (paid app) |

## Where we win
- **A signed cents-a-bushel answer from your nearest elevator's own later bids.** It also shows every posted month, five more elevators nearby, and the math line by line. No readable competitor reads a local board. Kentucky can only say river terminals "are currently offering strong basis bids" in general terms.
- **Current to the day.** Bids were read last night and futures this morning. Kentucky is a 2025-crop article, and the K-State PDF is from May 2024.
- **Honest handling of new crop and of interest.** Oct '27 is left out as new crop. Interest is charged on today's price, and the board counts the months before December that earn no carry.

## Where they beat us
- **Expected basis appreciation (K-State/UMN).** Their method: "To assess the potential for basis appreciation, start with the historical basis at the expected time of sale. The 5-year average ... basis in mid January is ($0.18). Compare that to ... basis today ... ($0.57)." Our board fallback still says "This assumes your basis stays where it is today". That matters most where no elevator posts later bids.
- **On-farm and commercial cost structures (K-State/UMN).** They charge on-farm grain a one-time "1% shrink and 5-cent in/out", and commercial grain a flat "$0.06/mo". They use a 3.5% or 7% rate on November value. We have one monthly default with no on-farm preset. The FAQ explains the idea but the inputs do not follow it.
- **More than store-or-sell (K-State/UMN, Farm Progress by title).** K-State lists five alternatives: store and hedge, store unhedged, sell, sell and buy a call, and sell with a call spread. We now cover the hedge when net is positive. When net is negative we say nothing about re-owning.
- **Condition of stored grain (Kentucky).** Kentucky says to hold grain "at least one point below market moisture" into late summer, 2-3 points lower for poor quality. It also covers bags versus bins, with a cost spreadsheet. We do not connect the hold month to grain condition.

## Five changes, ranked
1. **Expected basis change on the board fallback, from AGSIST basis history (M).**
   - What: for the ZIP's area, compute the median change from this week to the delivery month over the last N years. Add it as its own labeled line with the range. Show nothing when the history is thin.
   - Why: this fixes the one bias left in the answer for ZIPs without posted later bids.
   - Honesty risk: medium. It must be labeled "past years, not a forecast", with N and the range.
2. **Fix the "closes" label (S).** Say "prices as of <time> CT" until the session's settle is in, and in the math panel say "delayed quotes" during the session. Honesty risk: low. This fixes the bug.
3. **On-farm and commercial preset (S).** On-farm would be one-time in/out plus shrink and fan power. Commercial would be monthly. Each needs a stated source and date, and the 7% rate needs a dated source. Honesty risk: low, if sourced.
4. **When net is negative, one line on sell-and-re-own (S).** It would read: "If you expect a rally but storing loses money, some sell the grain and buy a call; that keeps the futures upside without the storage cost or the basis." This is education with no recommendation. Honesty risk: low. It must not read as advice.
5. **Link the hold month to grain condition (S).** When the chosen month is May or later, add one line: the target moisture for that month from the Grain EMC page, linked. Honesty risk: low.

## Verdict
**Yes.** No other free page gives a current, local, signed answer from your own elevator's posted later bids with the math shown. I saw it working in Illinois and Wisconsin. The board fallback still ignores basis gain, and the futures timestamp label is wrong during the session.

**Change since Oct 15:** 44 to 47 (+3). Local went from 3 to 5 now that elevator mode was seen working in Chetek. Depth went from 4 to 5. Accurate stays at 4 because basis gain is still left out and the closes label is wrong. The Oct 15 competitor cells were snippet-based and are not comparable one to one.
