# Head to head: agsist.com/field-scout

Checked Oct 16, 2026, from the read-only checkout. I rendered field-scout.html at 390x844 and 1280x800, serving Leaflet from the repo's own vendor/leaflet-1.9.4 because the sandbox blocks the CDN. There was no sideways scroll. About 860 KB loaded with Leaflet, without map tiles. The page's script, field-scout.js, is 248 KB.

**Still provisional.** These are blocked here, so I could not draw a field and watch a live readout:
- the field-scout worker (agsist-fieldscout.dnilgis.workers.dev, connect refused)
- leaflet-draw on unpkg.com
- the map tiles
- Open-Meteo

field-scout.html and field-scout.js have not changed since the Oct 15 report.

Competitors were scored only from copies saved on the references branch (fetched Oct 16). Only two of the six had saved copies: the Acres.com help article and the ISU CSR2 map page. AcreValue, FBN AcreVision, CropScape and Web Soil Survey are JS apps and were not fetched, so their cells are "?".

## Numbers checked by hand
- **Acreage (`polyAcres`, a spherical-excess formula).** I tested it on squares and triangles with exact side lengths on the WGS84 ellipsoid:
  - 1-mile square at 41.5°N: 640.46 ac (exact 640.00). Half of it: 320.23.
  - 1/4-mile square at 42°N: 40.03 ac (exact 40.00).
  - 1/2-mile square at 38°N: 160.25 ac (exact 160.00).
  - It runs 0.07% to 0.16% high, more so further south (the sphere against the ellipsoid). That is about a quarter acre on a quarter section. Fine.
- **Field CSR2 (`field-scout.js`, the acre-weighted mean of map-unit CSR2).**
  - Case: 80 ac at CSR2 85, 60 ac at 70, and 20 ac unrated.
  - (85 x 80 + 70 x 60) / 140 = **78.6**. The code gives the same, and it returns no CSR2 unless rated acres are at least half the field. That is right.
  - The map-unit value in the worker query is the component-percent-weighted mean of `iacornsr`. That is standard.
  - The label says "(0–100)", while ISU's saved page says CSR2 "range from 5 to 100". This is trivial.
- **Cash bids.** `FS_LICENSED_FEED = false` (Barchart off), which matches the standing decision.
- **Soil classes, CDL rotation, NCCPI, rent, drought, NDVI:** not exercised (the worker is blocked).

## Scores (1-5)

| Page | First screen | Current | Accurate/sourced | Local | Clear | Depth | Phone | Trust | Speed | Unique | Total | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **AGSIST /field-scout (provisional)** | 3 | 4? | 4? | 5 | 3 | 5 | 3 | 4 | 2 | 5 | **38** | rendered Oct 16 empty state; acres and CSR2 math by hand; live readout not exercised |
| Acres.com "Land Cover" help article | 2 | 4 | 4 | 5 | 4 | ? | ? | ? | ? | 3 | 22 + ? | fetched Oct 16 (bench-field-scout-5, redirected to support.acres.com/land-cover); dated June 23, 2026; describes the feature, the tool itself not seen |
| ISU GLSI, "CSR2 Distribution Across Iowa" | 2 | 2 | 5 | 1 | 4 | 1 | ? | 5 | ? | 2 | 22 + ? | fetched Oct 16 (bench-field-scout-6); static statewide image; data "downloaded August 2015", map "created in January 2016" |
| AcreValue | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | not fetched (JS map); not readable |
| FBN AcreVision | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | not fetched; not readable |
| USDA CropScape | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | not fetched (JS map); not readable |
| NRCS Web Soil Survey | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | not fetched (JS app); not readable |

"?" in our row means not exercised live.

## Where we win
- **More public data in one read, with no login.** Its source line names 10 (SSURGO, CDL, Sentinel-2, Open-Meteo, Drought Monitor, NASS condition, Census of Agriculture, AFIDA, the Atlas, the AGSIST bid feed), and the data section adds Sentinel-1 and ERA5. It says plainly that it "doesn't know who owns the land" and stores saved fields "on your device only".
- **Field-level CSR2.** ISU's saved page is one static statewide image from 2015 data. We compute an acre-weighted CSR2 for the field you draw.
- **Land cover is free.** Acres.com shows land cover by year for a selection, but it is behind its product. We show a 10-year CDL rotation for free.

## Where they beat us, and how
- **Land cover as a share of the field (Acres.com).**
  - Their article: "a radial chart and legend for the type of land cover (crops, trees, development, grasses, wetlands, etc.) on the selected land". You "click on the desired year — this will show the coverage breakdown for that year and change the overlay on the map".
  - Our rotation reads the CDL for the field. I could not see live whether it shows a percent mix per year or a single crop per year, so this needs the live audit.
- **Big selections (Acres.com).** It calculates up to "150 square miles or 96,000 acres" in one selection. Field Scout is built for one field at a time.
- **Everything else is unknown.** AcreValue, FBN, CropScape and Web Soil Survey were not readable from the saved set.

## Bugs found
- **None confirmed in the numbers.** The acreage formula is accurate to within 0.16%, and the CSR2 weighting is right.
- **Low to medium (risk, not seen in production):** the drawing tool depends on leaflet-draw from unpkg.com.
  - When unpkg is unreachable, the panel says "The field-drawing tool failed to load ... your network may be blocking unpkg.com".
  - The repo already vendors Leaflet itself (vendor/leaflet-1.9.4) but not leaflet-draw. One third-party host can take down the drawing step, even though "Drop a pin" and search use other code.

## Five changes, ranked
1. **Live audit from Sig's machine or GitHub Actions (S).**
   - Draw three real fields: Iowa (CSR2), Illinois and Kansas (NCCPI).
   - Check acres, the soil mix against Web Soil Survey, and the rotation against CropScape.
   - Have Actions also save copies of AcreValue and Web Soil Survey through a headless browser so they can be scored.
   - Why: accuracy is unverified for two runs in a row, and this decides the verdict.
   - Honesty risk: none.
2. **Vendor leaflet-draw next to Leaflet (S).**
   - Serve vendor/leaflet-draw-1.0.4 from agsist.com, as vendor/leaflet-1.9.4 already is. It is about 60 KB, one file set, and adds nothing per page.
   - Why: it removes a single point of failure for the main action.
   - Honesty risk: none.
3. **One-line verdict above the cards (S).**
   - Example: "160 ac · CSR2 78.6 · corn-soy 9 of 10 years · county rent $X (NASS 2025) · nearest corn bid $Y (elevator, time)".
   - The print report already has a "Bottom line". Put it first on screen.
   - Why: on a phone, 12 cards bury the answer.
   - Honesty risk: low, if every number keeps its source and date.
4. **Land cover mix per year (S to M).**
   - Show the percent of the field in each CDL class for each year (for example, 2024: 92% corn, 6% grass, 2% developed), not only the dominant crop.
   - Use the CDL accuracy note already on the page.
   - Why: this is what Acres.com sells. Mixed fields and waterways are common, and one crop per year hides them.
   - Honesty risk: low. CDL is per-pixel, about 85-90% accurate, as the page says.
5. **Start near the farmer (S).**
   - `tryAutoLocate()` already centers the map when `AGSIST_STATE` has a location. Also fall back to the last saved field on this device, and confirm what a first-time visitor sees.
   - Why: on a phone the first screen is an empty map and a prompt.
   - Honesty risk: none. It is local to the device.

## Verdict
Best on the internet today? **Close (provisional).** Both pieces of math I could check are right, and no saved competitor offers this much free, no-login field data. The live readout and the four big app competitors could not be seen from here. Change 1 decides it.

**Change since Oct 15:** 38 to **38** (no change). The code has not changed, and the run is still provisional.
