# Head to head: agsist.com/drought-monitor

Checked Oct 15, 2026, from the read-only checkout. I rendered drought-monitor.html at 390x844 and 1280x800. No sideways scroll and no JS errors. The map is hotlinked from droughtmonitor.unl.edu, which the sandbox blocks, so I saw the page's fallback ("The drought map image did not load"). The fallback works as designed.

**What I could not see:** the NDMC map images, and every competitor host. Competitor cells are from search-result text and are marked *.

## Numbers checked by hand
- **Dates:** "Map valid Oct 6" is a Tuesday, the USDM valid day. The next release, Thu Oct 15, is correct.
- **Date mismatch risk (low):**
  - The image is hotlinked live from NDMC, but the "Map valid" label comes from data/outlooks/manifest.json.
  - From Thursday morning until the manifest refreshes, the label can say Oct 6 over an Oct 13 map.
- **The page computes nothing,** so there is no arithmetic to check.
- **LFP wording:** "sustained D2 or worse ... can make you eligible" is fair as a summary. The payment ladder (8 consecutive weeks of D2, any D3, and so on) is not stated.

## Scores (1-5)

| Page | First screen | Current | Accurate/sourced | Local | Clear | Depth | Phone | Trust | Speed | Unique | Total |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **AGSIST /drought-monitor** | 3 | 4 | 4 | 2 | 4 | 2 | 3 | 4 | 4 | 1 | **31** |
| drought.gov county pages (NIDIS)* | 4 | 5 | 5 | 5 | 4 | 5 | 4 | 5 | 3 | 4 | 44 |
| droughtmonitor.unl.edu (NDMC, the source)* | 4 | 5 | 5 | 3 | 3 | 5 | 3 | 5 | 3 | 5 | 41 |
| USDA OCE "Agriculture in Drought" (percent of corn and soy area in drought)* | 3 | 5 | 5 | 2 | 4 | 3 | 3 | 5 | 3 | 4 | 37 |

\* from search snippets only; not opened.

## Where we win
- **A plain crop-stress table** (when D1 or D2 hurts corn, beans, wheat and hay). It explains that PRF does not use USDM, with a link to the PRF page, and links to the Atlas county drought record since 2000.

## Where a competitor beats us, and how
- **My county (drought.gov).** drought.gov has a page per county with the current category and history*. Ours is a state image.
- **Ag share (USDA OCE).** USDA publishes the percent of corn and soybean area in D1+ weekly*. We show no number at all.
- **Our own data, unused.** AGSIST already holds county USDM history (Farmland Atlas) and county rain (rain pages). The drought page uses neither on the page itself.

## Five changes, ranked by impact
1. **Add a county lookup from data AGSIST already builds (M).** Show this week's USDM category for the county, weeks in D2+ (the LFP trigger), and a link to that county's rain page and Atlas record. Use one state file on demand.
2. **Print this week's ag numbers (S).** For example "Corn area in drought: X% (USDA OCE, valid Oct 13)", with source and date.
3. **Show the map as our own dated copy (S).** Mirror the USDM PNG in data/ with its valid date, so the label and image can never disagree.
4. **State the LFP ladder (S).** Give the D2 8-week, D3 and D4 tiers as FSA states them, with the link. That is more useful than "ask your agent", which is better dropped under the standing decisions.
5. **Rain-vs-drought line (S).** Example: "Your county: 85% of usual rain since Jan 1, D1 this week". It joins the two AGSIST datasets.

## Verdict
Best on the internet today? **No.** It is a clean wrapper around the NDMC image, with a useful stress table. But drought.gov answers "my county" and NDMC is the source. AGSIST already has the county data to make this page unique, and it is not on the page.
