# Rain Print head to head, 2026-10-16

Our page: /home/user/agsist at d578415f0 (rain-print.html 114 KB, components/rain-print.js v39). Served locally and rendered at 390 x 844 and 1280 x 800. No sideways scroll at 390. The phone page is 7,556 px tall. NOAA ACIS is blocked from this sandbox, so no live draw ran. The static example print (2012 Ames) did show in the hero frame at both widths.

Competitors: scored only from the copies saved on the references branch (fetched Oct 16, 16:06 UTC).
- Show Your Stripes (bench-rain-print-1): the saved copy is an empty app shell (`<div id="app"></div>`, page text "#ShowYourStripes"). Not readable, so "?".
- Weather Portraits, c82.net (bench-rain-print-5): fetch failed (HTTP 403, no Wayback copy). "?".
- temperature-blanket.com (-2) and the Etsy search (-6): not in the Oct 16 fetch index. "?".
- Extreme Weather Watch (-3) and the Weather Radials showcase page (-4): read.
- Phone is not judged from a text copy, so those two are out of 45.

## Scores (1-5)

| | First screen | Current | Accurate+sourced | Local/personal | Clear | Depth | Phone | Trust | Speed | Unique | Total | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **AGSIST Rain Print** | 5 | 5 | 5 | 5 | 4 | 5 | 4 | 5 | 4 | 5 | **47** | rendered Oct 16; example checked against saved NOAA data |
| Extreme Weather Watch (Auburn Dec.) | 4 | 2 | 3 | 3 | 4 | 3 | ? | 3 | 4 | 2 | 28/45 | fetched Oct 16 |
| Weather Radials (IIB showcase) | 2 | 1 | 2 | 1 | 3 | 2 | ? | 4 | 3 | 3 | 21/45 | fetched Oct 16 |
| Show Your Stripes | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | fetched Oct 16, empty app shell, not readable |
| Weather Portraits (c82.net) | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | fetch failed (403) |
| temperature-blanket.com | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | not in fetch index |
| Weathered Moments / Etsy search | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | not in fetch index |

What the saved copies show:
- **Extreme Weather Watch:** "Auburn December Precipitation Totals ... from 1906–2024". It leads with the rainiest December (2015, 19.12 in) and the driest (1955, 0.82 in), then a sortable table by year. Its notes say months with "more than 10% missing data are excluded" (1992 to 1994 and 2006 are absent) and that totals "include both rain and melted snowfall". It names no data source or author ("© H Brothers Inc"). As of Oct 2026 the newest year is still 2024.
- **Weather Radials:** an Information is Beautiful Awards showcase entry. It describes Timm Kekeritz's poster of "35 cities ... 2013" (Silver, 2014). The copy shows no price, no way to buy, no personalization and no data source.

Nothing read today contradicts Oct 15's finding that no one else sells a real station's year of daily rain and snow, named and framed. The snippet-only rivals from Oct 15 (Etsy shops, star maps) could not be re-read, so their prices are not repeated here.

## Where we win
- **A real print is now in the first screen.** The hero frame holds an eager, `fetchpriority="high"` image of the 2012 Ames print, labeled "Example". Its alt text names the town, the year and the totals. Oct 15's biggest complaint was an empty frame and a red error.
- **The search words are in.** The title is "Rain Print: custom rainfall art of any US town and year". The description says "A gift for the farmer" and gives the prices. The lead line names weddings and births. The FAQ has wedding/birth year, snow, free year total and "farmer who has everything".
- **Store basics a buyer looks for, on the page in plain words:** $89 / $45 / $19 with shipping included, Christmas order-by dates (framed Dec 9, print Dec 10), a proof before printing with "a full refund any time before I print", a free gift note with no prices in the box, ships in 3 business days after the proof OK to all 50 states, a $15 reprint if lost or damaged, numbered and initialed prints, the maker named, and Stripe receipts.
- **Honest data.** The example's numbers come from saved NOAA ACIS answers, and every one checks by hand (below).

## Where they beat us
- **Extreme Weather Watch answers "<town> rainfall <year>" in text.** It has rainiest and driest on record and a 100+ year table on a crawlable page. A Rain Print shows a year only after a draw. The year in numbers is hidden until the draw too (`rp-stats-wrap` hidden), so a crawler sees no town numbers.
- **Weather Radials has outside credibility:** an award and a named designer. Rain Print has no press mention or outside link yet. Oct 15 found no backlinks; that was not rechecked.

## Example print checked by hand (data/rain-print-examples/2012-ames-ia.json, station US1IASR0005 "AMES 2.6 NNW")
- Year total: sum of 366 daily values (T counted as 0, none missing) = **25.52 in**. The print says 25.52 ✓
- NOAA normal: sum of ACIS daily normals (normal "91", 366 days) = **37.73 in**. The print says 37.73 ✓. 1 − 25.52/37.73 = 32.4%, and the print says "32% less than a usual year" ✓
- Snow 28.3 in ✓; days with rain or snow 95 ✓; biggest rain 1.89 in on Apr 15 ✓
- Monthly totals 0.50, 1.45, 2.62, 4.03, 2.15, 2.79, 2.28, 2.45, 2.33, 2.48, 1.03, 1.41 all match the print's month row ✓
- Christmas cutoff, framed: order Wed Dec 9; proof Thu Dec 10; OK Fri Dec 11; ships by Wed Dec 16 (3 business days); 6 business days in transit = Thu Dec 24 ✓. Print: Dec 10 order gives Dec 24 with 5 transit days ✓. Both land on Dec 24 only if every step takes its full allowance, so there is no slack (see the store notes).

## Bugs found
| # | Finding | Severity |
|---|---|---|
| R1 | With NOAA not answering (as here), the page loads with red text under Draw my year: "NOAA's data service isn't answering right now, so the sample can't be drawn." No one pressed anything, and the example print already fills the frame. To a buyer it reads like a broken store. It only shows when ACIS is down or slow, which does happen. | Medium (costs orders when it shows) |
| R2 | The FAQ says "Under More options, The year in numbers shows..." but that panel is hidden until a year is drawn, so the More options box a reader opens first has no such item. | Low |
| OK | Prices, cutoffs, refund terms and shipping wording match data/rain-print.json and STANDING-DECISIONS (prices $19/$45/$89 with shipping, 3 business days, $15 reprint, 50 states). All three Stripe payment links are filled in data/rain-print.json; checkout itself could not be opened from here. | |

## As a store: would a gift buyer trust it and pay $89?
**Mostly yes. These are what would cost orders, worst first. Nothing here was edited.**
1. **There is no photo of a real print anywhere.** The only physical-looking image is "Mockup: a framed 12 x 18 Rain Print ... on the painted steel wall of a farm shop", and it sits inside the collapsed "What you get". Someone paying $89 for a framed gift wants to see the actual frame, glass, paper and the pencil-initialed number, ideally in a hand or on a wall. The example in the hero is a flat render in a drawn frame. The fix is a photo of one of Sig's own test prints, labeled as such (needs Sig and a camera).
2. **The red NOAA error on load (R1)** sits right where the eye goes after the price. Show it only after the buyer presses Draw.
3. **The proof email comes from a different business's domain.** "Your proof comes from sig@farmers1st.com" on an agsist.com store can read as a handoff to another company, and a gift buyer may not open mail from a domain they did not buy from. A rain-print or sig@agsist.com sender would match the store. That is Sig's call.
4. **The frame is under-described for $89.** The page says "black frame, real glass, no mat, ready to hang" but not the frame material, the moulding width, the outside size framed, or the hanger type. Buyers comparing framed gifts look for exactly those. (Never call the paper archival, per the standing rule.)
5. **Christmas dates have zero slack.** Both cutoffs land on Dec 24 only when the buyer OKs the proof within a business day and the carrier uses its full window. The page explains the arithmetic. One line such as "OK the proof the day it comes" next to the date would save late gifts and refund asks.
6. **The pay button is far down on the phone,** about 3,700 px into a 7,556 px page, after the options. The fixed phone bar (`.rp-bar`) carries the buyer there. Fine as is; noted only because the page is long.

What already earns trust: a named maker in a named town with a credential, a proof before printing, a full refund before printing, a stated reprint policy, prices with shipping included, no fake reviews and no review schema, and an honest "Example" tag and "Mockup" alt.

## The 5 changes, ranked
1. **Real photos of a real print (M).** 2-3 photos of Sig's own framed and unframed test prints: one on a wall, a corner close-up showing the glass and frame edge, and the serial with pencil initials. Put one beside the price cards, open by default, with the rest in "What you get". Keep each under about 120 KB (webp + jpg in /img; one page, so no budget issue). Honesty risk: low, if they are photos of real prints and labeled as such. The mockup stays labeled "Mockup" or goes.
2. **Quiet failure when NOAA is down (S).** On load, leave the example up and show nothing. Only after Draw my year, say NOAA is slow and offer Try again. Honesty risk: none.
3. **Frame and size facts (S).** In "What you get" and "How big is it?": frame material, moulding width, outside size framed, hanger, and weight boxed, all as Sig measures them. Add one line next to the Christmas dates: "OK your proof the day it arrives." Honesty risk: only if a spec is guessed. Leave anything unmeasured out.
4. **A matching sender address (S, Sig's call).** Send proofs from an agsist.com address and say so on the page. Honesty risk: none.
5. **Be found for "<town> rainfall <year>" without bloating the page (M).** The 2,754 county rain pages already link in. The two example years could each get a short crawlable "The year in numbers" block (total, normal, snow, wettest day: the numbers checked above), and the FAQ line R2 should be fixed. Gift-guide outreach before mid-November (Oct 15 change 5) is still open and could not be checked from here. Honesty risk: low; numbers only from the saved NOAA answers.

## Verdict
**Yes for the product, close as a store.** No readable competitor does what it does, and the example print checks to the hundredth. To be the store a gift buyer pays $89 at without hesitating, it needs a photo of a real framed print, no error on load, and a fuller frame description.

**Change since Oct 15: 46 → 47 (+1).** The real example print in the hero, the search words in the title and FAQ, and the gift FAQ all shipped. Competitor totals are not comparable run to run (Oct 15 used snippets; Oct 16 used saved copies, and four of six were unreadable).
