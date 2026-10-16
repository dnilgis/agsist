# Head to head: agsist.com/planting-date

Checked Oct 16, 2026, from the checkout. I served the repo locally and rendered planting-date.html at 390x844 and 1280x800, then drove it at 1280 (southern WI and southern MN zones, corn and soybeans).
- No sideways scroll and no page errors.
- About 420 KB loaded. The page HTML is 77 KB.
- Open-Meteo is blocked here, so the soil temperature boxes stay empty ("-") until a location loads.

**Competitors.** I scored them only from the copies GitHub Actions saved on Oct 16 (references branch). Phone is "?" because I did not render them, so totals are out of 45.
- **Read (1):** Iowa Environmental Mesonet (IEM) county 4-inch soil temperature maps (bench-planting-date-2). The saved copy has the page text, not the map images.
- **Could not read for this topic (5):**
  - NC State corn planting guidance (-1): the fetch failed.
  - FBN (-3): the saved copy is the FBN blog index, not the soil-temperature article. Only the headline "Is It Too Late to Plant?" shows.
  - Penn State (-4): the copy is the "Soil Fertility" category listing, not the article.
  - Iowa Farm Bureau (-5): members-only. The teaser, dated Apr 8, 2024, says the tool gives 30 years of 4-inch soil temperature statistics.
  - Cool Bean (-6): the copy is the Badger Crop Network front page, with no planting-date content.

## Changes since Oct 15
- **The meta description now says Wisconsin and Minnesota.** Oct 15 change 5 is done.
- **A hybrid verdict line was added (Oct 15 change 3).** It is the source of bug 1.
- **The soybean penalty is unchanged.** It is still 0.4 bu a day from May 1 (Oct 15 change 2 is open).
- **The frost table is unchanged.** Its dates still run early, and the page says so (Oct 15 change 1 is open).

## Numbers checked by hand
- **GDUs to the 50% first fall frost, central WI (Sep 18):**
  - May 1: 31 x 7.5 + 30 x 15.5 + 31 x 21.5 + 31 x 19.5 + 17 x 10 = **2,138.5**, shown as 2,139.
  - May 10: 2,071. Jun 1: 1,906.
  - All match.
- **Southern WI (Sep 25):** 2,138.5 + 7 x 10 = 2,208.5, shown as 2,209. Matches.
- **Soybean table:**
  - May 5: 4 x 0.4 = 1.6 bu, so 53.4 bu, 97%.
  - Jun 15: 45 x 0.4 = 18.0 bu, so 37 bu, 67%.
  - Both match the page's own rule.
- **GDU targets:**
  - Corn: 108 x 22 + 250 = 2,626. Matches.
  - Soybean MG 1: 1,750 + 280 = 2,030. Matches.

## Bugs found
1. **Medium-high, accuracy: the new verdict says a 108-day hybrid cannot mature in southern Wisconsin or southern Minnesota. The page itself says 108-day corn is typical there.**
   - The input hint reads "108-day corn typical for south-central WI".
   - With the 108 default, every zone prints a verdict like this one for Southern Wisconsin: "A 108-day hybrid needs about 2,626 GDUs and does not reach black layer before Sep 25 from any of these dates on these numbers. May 1 planting gets about 2,209, 417 short."
   - Southern MN reads 2,199 and 427 short.
   - Three things stack up behind it:
     - The fall frost dates are ones the page calls early and unchecked against a station.
     - The GDU table is a statewide monthly average with no April rate.
     - The target is a line through 110- and 112-day figures.
   - So a southern Wisconsin grower is told his normal hybrid will not mature. That runs against the page's own hint, and against what farmers there plant every year.
   - Until the frost and GDU inputs are station-based, the verdict is a confident claim built on inputs the page admits are rough.
   - Fix: hide the verdict (or show only "check your station") until change 2 lands.
2. **Medium, accuracy: the soybean penalty is still a flat 0.4 bu a day from May 1.**
   - At Jun 15 the page shows 18 bu lost.
   - The Oct 15 run cited UMN's faster June loss rate. That came from search snippets, not a saved copy, so it is not re-verified this run.
3. **Low:** at 1280 wide the first screen is setup and empty soil boxes. No answer shows until a location loads, and in October there is no planting answer to give.

## Scores (1-5)

| Page | First screen | Current | Accurate/sourced | Local | Clear | Depth | Phone | Trust | Speed | Unique | Total | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **AGSIST /planting-date** | 3 | 4 | 2 | 2 | 3 | 4 | 3 | 4 | 4 | 3 | **32/50** | rendered Oct 16, soil temp fetch blocked |
| IEM county 4-inch soil temperature maps (Iowa) | 3 | 5 | 4 | 4 | 3 | 3 | ? | 5 | 3 | 3 | 33/45 | fetched Oct 16; page text read, map images not in the copy |
| NC State corn planting guidance | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | not scored | fetch failed |
| FBN soil temperature article | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | not scored | fetched Oct 16: blog index, not the article |
| Penn State soil thresholds | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | not scored | fetched Oct 16: category listing, not the article |
| Iowa Farm Bureau soil temperature tool article | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | not scored | fetched Oct 16: members-only teaser (Apr 8, 2024) |
| UW-Madison Cool Bean | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | not scored | fetched Oct 16: Badger Crop Network front page, no planting-date content |

**Why our score moved (-1):** accurate/sourced went from 3 to 2. The verdict line added since Oct 15 prints a wrong-looking maturity call by default (bug 1), and the soybean penalty is unchanged.

**What IEM's scores rest on:**
- Daily county 4-inch soil temperature maps.
- They combine ISU Soil Moisture Network observations with bias-corrected NWS NAM analyses, and the page says so.
- A GFS forecast column, the past three days of observations, an archive and an observation download.
- Iowa only. It gives no planting advice.

## Where we win
- **One page that ties together soil temperature at your location, frost percentiles, the yield penalty by week, and heat units to frost.** IEM gives soil temperature only, for Iowa only.
- **Plain caveats.** The page says its frost dates run early, and it says the soil temperature is a model estimate, not a probe.

## Where they beat us
- **Measured soil temperature at 4 inches, county by county, daily (IEM).** The data comes from a station network with stated bias correction, plus an archive and a download. Ours is a single model point at 6 cm, and it is empty until the reader enters a location.
- **Station sources.** IEM is built on a named network. Our frost dates and GDU rates are zone and state approximations.

## Five changes, ranked
1. **Pull or soften the hybrid verdict now (S).**
   - What: until the inputs are station-based, replace it with "On these approximate numbers May 1 gets about 2,209 GDUs before the median frost; a 108-day hybrid is rated about 2,626. Check your station's frost date and your seed rating."
   - Why: today it tells southern WI and MN growers their normal hybrid will not mature (bug 1).
   - Honesty risk: this is the honesty fix.
2. **Station frost dates and GDU normals from NCEI 1991-2020 (M).**
   - What: for the nearest station to the ZIP, the 32°F and 28°F dates at the 10/50/90% levels, plus daily GDD normals that include April. One data file per state, loaded on demand.
   - Why: it fixes the frost table, the GDU cards and the verdict at once, and lets the page reach beyond six zones.
   - Honesty risk: low. Name the station and its distance.
3. **Fix the soybean penalty (S).**
   - What: use a range, about 0.2-0.5 bu a day from late April through May and a steeper June rate. Each rate must be read at its primary source (UW Conley, UMN) before it ships, since the June figure here came from snippets.
4. **Default maturity follows the zone (S).**
   - What: when the zone changes, set the default RM and hint to that zone's typical range, and label it "typical, change to yours".
   - Why: the 108 default in central WI produces a "short" verdict on the first screen.
5. **A first screen for the off-season (S).**
   - What: from October to March, lead with the zone's frost dates and "next spring's window", and show the dated last soil reading once a location is in.
   - Why: in October the first screen today is an empty soil box.

## Verdict
**No.**
- Score: 32/50, down 1 from Oct 15 (33).
- The new verdict line contradicts the page's own hint and prints a maturity call it cannot support.
- The frost and GDU inputs are still approximations, and the soybean penalty is unchanged.
- IEM is more trustworthy for soil temperature in Iowa.
- Five of the six competitor copies were not readable for this topic, so the field this run is thin.
