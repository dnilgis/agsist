# Head to head: agsist.com/planting-date

Checked Oct 15, 2026, from the read-only checkout. I rendered planting-date.html at 390x844 and 1280x800. No sideways scroll, no JS errors, about 400 KB loaded. I could not run the live soil-temperature fetch, because the sandbox blocks Open-Meteo.

**What I could not see:** I could not open any competitor host. Competitor cells are from search-result text and are marked *.

## Numbers checked by hand
- **GDUs before the 50% first fall frost, central Wisconsin (Sep 18), Wisconsin monthly rates:**
  - Planted May 1: 31 x 7.5 + 465 + 666.5 + 604.5 + 17 x 10 = 2,138.5. The page shows **2,139**, counting up to but not including Sep 18.
  - Planted May 10: -67.5, shown as -68. Matches.
- **Corn yield table:** 200 bu x 97% = 194 and so on. All rows match their own percentages.
- **Soybean table:**
  - The rule is 55 bu minus 0.4 bu a day after May 1.
  - Jun 15: 45 days x 0.4 = 18 bu, so 37 bu and 67%. Matches its own rule.
- **Accuracy flags (medium):**
  - **The frost table runs early, and the page knows it.** It says its southern WI 50% date (Apr 22) is 13 days before the UW-Madison SSEC Madison median (about May 5). It still uses these zone dates to count GDUs before fall frost. If the fall dates run early by a similar amount, the "GDUs to Sep 18" card understates usable season by about 100 September GDUs. That is an inference, and it needs a station check.
  - **The soybean penalty is too gentle in June.** It uses a flat 0.4 bu a day from May 1. UMN* puts it at about 0.4 a day in May but 1.0 (CROPGRO) to 1.5 (Naeve) a day in June. Wisconsin* starts the 0.4-0.5 loss at Apr 20-25, not May 1. At Jun 15 that suggests about 26-33 bu lost, not 18. The page calls it an approximation, but the June rows understate the cost of waiting.
  - **No verdict where one is needed.** The default is 108 RM in the central WI zone. The page prints a 2,626 GDU target beside "2,139 GDUs to Sep 18 if planted May 1", but never says that hybrid will not reach black layer before the median frost on its own numbers.
- **Label mismatch (low):** The meta description says "for US growers". The page says, correctly, that it is built for Wisconsin and Minnesota.

## Scores (1-5)

| Page | First screen | Current | Accurate/sourced | Local | Clear | Depth | Phone | Trust | Speed | Unique | Total |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **AGSIST /planting-date** | 3 | 4 | 3 | 2 | 3 | 4 | 3 | 4 | 4 | 3 | **33** |
| Iowa State / IEM soil temperature climatology + live soil temps* | 3 | 5 | 5 | 3 | 3 | 4 | 3 | 5 | 3 | 4 | 38 |
| UMN Extension, corn and soybean planting date pages* | 3 | 3 | 5 | 2 | 4 | 4 | 4 | 5 | 4 | 3 | 37 |
| NC State Climate Office corn planting guidance dashboard (NC)* | 3 | 4 | 5 | 1 | 3 | 4 | 3 | 5 | 3 | 4 | 35 |
| UW-Madison soybean (Conley) planting date guidance* | 3 | 3 | 5 | 2 | 4 | 4 | 3 | 5 | 3 | 3 | 35 |

\* from search snippets only; not opened.

## Where we win
- **Everything in one place.** Live soil temperature (a 3-day mean at 2 in, with no verdict when data is missing), frost percentiles, the yield table and GDUs before frost.
- **Plain caveats.** The page states its own frost table runs early instead of hiding it.

## Where a competitor beats us, and how
- **Coverage.** The extension pages and IEM cover their whole state from station records*. We cover six hand-made zones in two states.
- **Sources for the frost dates (SSEC, NCEI normals).** The extension and climate offices print station dates. Our zone dates are approximate and admittedly early.
- **Soybean penalty.** UMN's June figures are 2-4x ours*.

## Five changes, ranked by impact
1. **Replace the zone frost table with station dates from NCEI 1991-2020 normals (M).** Use spring and fall 32°F and 28°F at the 10/50/90% levels for the nearest station to the ZIP. Ship one file per state and load it on demand. This fixes both the table and the GDU-to-frost card, and opens the page beyond WI and MN.
2. **Fix the soybean curve (S).** Use 0.4-0.5 bu a day from about Apr 25 through May, then 1.0 a day in June, citing UW (Conley) and UMN. Show it as a range.
3. **Add a hybrid verdict line (S).** For example: "108 RM needs about 2,626; May 1 planting gets about 2,139 before the median frost here. Consider about 95 RM." Label it as AGSIST math.
4. **Use local GDU normals, not the Wisconsin table (M).** This is shared with the GDU calculator change.
5. **Make the meta description match (S).** Say "Wisconsin and Minnesota" until change 1 widens coverage.

## Verdict
Best on the internet today? **No.** The idea of putting soil temperature, frost, penalty and heat units on one page is good. But the frost dates it rests on are ones the page itself calls early, the June soybean penalty is too small, and it covers only parts of two states. Iowa State/IEM and the UMN pages are more trustworthy for their areas.
