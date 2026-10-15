# Head to head: agsist.com/field-scout

Checked Oct 15, 2026, from the read-only checkout. I rendered field-scout.html at 390x844 and 1280x800. No sideways scroll, and about 700 KB loaded before the map libraries. The scores here are **provisional**. The sandbox blocks the Leaflet CDN, the map tiles, the AGSIST field-scout worker and Open-Meteo. I saw the empty state and read field-scout.js, but could not draw a field and see a live readout.

**What I could not see:** the live field readout, and every competitor host. Competitor cells are from search-result text and are marked *.

## Numbers checked by hand
- **Field acres:** `polyAcres` is a spherical-excess area. I ran it on squares at 42°N:
  - A 1/4-mile square gives **40.03 ac**.
  - A 1/2-mile square gives **160.10 ac**.
  - About 0.1% high against a perfect 40 and 160, which is the usual sphere-vs-ellipsoid gap. Fine.
- **Cash bids:** These come from the AGSIST elevator network. The Barchart path is switched off in code (`FS_LICENSED_FEED = false`), which matches the standing decision. If the network fails, the page says it could not reach the feed. It does not say "no elevators", which is the right call.
- **Soil, CDL rotation, NCCPI and CSR2, rent, drought:** not exercised (worker blocked). Each card names its source in code, for example CSR2 "weighted by acres" and NCCPI on a 0-100 scale.

## Scores (1-5)

| Page | First screen | Current | Accurate/sourced | Local | Clear | Depth | Phone | Trust | Speed | Unique | Total |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **AGSIST /field-scout (provisional)** | 3 | 4? | 4? | 5 | 3 | 5 | 3 | 4 | 2 | 5 | **38** |
| AcreValue (free Basic tier, 3 snapshots/mo)* | 4 | 3 | 4 | 5 | 4 | 4 | 4 | 3 | 3 | 4 | 38 |
| FBN AcreVision (members only)* | 3 | 3 | 4 | 5 | 4 | 4 | 4 | 3 | 3 | 3 | 36 |
| USDA CropScape + NRCS Web Soil Survey* | 1 | 4 | 5 | 5 | 2 | 5 | 1 | 5 | 2 | 3 | 33 |

\* from search snippets only; not opened. "?" means not exercised live.

## Where we win
- **No login and no snapshot limit.** AcreValue's free tier is capped at 3 snapshots a month*, and AcreVision is members only*.
- **Agronomy and money on one readout.** Soil and productivity, 10-year CDL rotation, season vs normal, drought, nearby cash bids, county rent and the Atlas county record. Each competitor I found covers part of that.

## Where a competitor beats us, and how
- **Plat and ownership maps (AcreValue)*.** That is out of scope by choice, and I would leave it.
- **First screen.** AcreValue lets you click a field that is already outlined*. We ask you to zoom and tap, or trace. On a phone, the empty map and prompt fill the first screen.
- **Weight.** About 700 KB plus Leaflet, leaflet-draw and tiles before any readout, against a CLAUDE.md-minded site.

## Five changes, ranked by impact
1. **Run a live audit from Sig's machine or Actions (S).** Draw 3 real fields (Iowa CSR2, Illinois PI, Kansas NCCPI) and check acres, the soil mix against Web Soil Survey, and the rotation against CropScape. Until then these scores stay provisional.
2. **Start from the farmer's location (S).** On first load, with permission or a ZIP, zoom to farmland near them, so the tap-a-field step is one action.
3. **Lead with a one-line verdict (S).** Example: "160 ac · CSR2 82 · corn-soy 9 of 10 years · rents about $X (NASS county) · nearest corn bid $Y". Put it above the 12 cards.
4. **Lazy-load the heavy cards (M).** Load Atlas, market and "who farms here" only when opened, to cut the first readout's weight.
5. **Printable field sheet through one shared page (S).** Use a query parameter, not a file per field, per CLAUDE.md.

## Verdict
Best on the internet today? **Close (provisional).** On scope and price it beats every free option I found. But I could not watch a single live readout, so accuracy is unverified here. Change 1 decides the verdict.
