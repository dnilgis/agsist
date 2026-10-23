/**
 * AGSIST Service Worker — v4
 * ─────────────────────────────────────────────────────────────────
 * CACHE STRATEGY:
 *   HTML pages      → Network first, cache fallback (always fresh), EXCEPT
 *                     the shells in SHELLS below: a copy cached in the last
 *                     SHELL_MAX_AGE is served at once and refreshed behind it
 *   (2026-10-09)      (their prices come from /data/ and the workers, fetched
 *                     live by the page, so the shell itself holds no price)
 *   JS/CSS/images   → Cache first IF versioned (?v=N), else network first
 *   Data (JSON)     → Network only, no caching (prices must be live), EXCEPT
 *                     the few key files savedDataFeed() names (bottom of file,
 *                     prices, daily brief, bids, weather, ARC/PLC program data):
 *                     network first with a 3 s limit, then the last good copy,
 *                     and the page is told so it can say "Offline. Showing ..."
 *   Navigations     → network gets NAV_TIMEOUT_MS (3.5 s), then a cached copy
 *                     if there is one (else keep waiting on the network);
 *                     when network and cache both fail: offline.html
 *   External APIs   → Network only (NEVER_CACHE list below)
 *
 * v4 FIXES:
 *   - cacheFirst clone race (response consumed before clone) → clone sync
 *   - Added Cloudflare Workers + Polymarket to NEVER_CACHE
 *   - Top-level safety net: any SW error falls back to plain fetch()
 *   - cache.put failures swallowed (quota errors no longer kill fetches)
 *
 * TO BUST CACHE FOR ALL USERS ON DEPLOY:
 *   Increment CACHE_VERSION below by 1, commit, push.
 *
 * ─────────────────────────────────────────────────────────────────
 * BUMP THIS ON EVERY DEPLOY:
 */
// v7 (2026-06-14): networkFirst now revalidates with the server (cache:'no-cache'),
// so bare JS/HTML deploys (field-scout.js etc.) show up immediately instead of
// staying stale for up to 10 min behind the browser HTTP cache. Version bump also
// clears any stale entries cached during today's rapid deploys.
// v8 (2026-07-26): cache bust for the big deploy week — chips, signup bar,
// nowcast, contrast, iOS text fix, sponsor pricing. Returning phones were
// pinned to old ?v= assets by cacheFirst; this clears every device's cache.
var CACHE_VERSION = 241;  // v241 2026-10-23: fx/b24fix (past 238 on main; 239 and 240 held by other helpers). Grain on the move shows USDA's real railcar bids (it read the delivery month), car orders past due no longer added to their own total, grain carloads count cars originated only, train speed reads again, a tile USDA never answers gives its place to Gulf ship loadings, and a source that cannot be read says so in plain words. Was v238 2026-10-23: fx/rpdefaults (past 237 on main). Rain Print opens with every layer on (the daily temperature stripes and every year behind join normals, remarkable days, frost and hottest/coldest); codes and tool links open as made. A station picked for every year behind says so in one short line with a tap back to the nearer gauge. Phones: one 12px gutter on the Rain Print, gift card and business pages, 44px taps in the tool, and a call or email Sig line by Pay and in every failure on the way to an order. rain-print.js?v=79, rain-county-print.js?v=38 on the county pages (engine pin), here.js?v=22. Was v237 2026-10-22: fx/advertise (past 234 on main; 235 fx/ciharden, 236 fx/rpdefaults). Advertise is easy to find: a quiet Advertise link in the header bar on wide screens, Advertise with AGSIST beside About in the phone menu and in the footer bottom row (seen on phones without opening a folded column); an unsold page slot shows one small Sponsor this page link; cash bid state and town pages get one sponsor slot per state; loader CV 85, sponsor-apply.js?v=6. Was v234 2026-10-22: fx/fastfacts. Fast Facts is the one page for a place (two tabs, My place and Reference tables, Print on one shared print sheet); /here, /fastfacts and the H/ short link forward to it; /status retired to the homepage; fertilizer prices by the reader's state (fert-pick.js); loader CV 83; versions one past main (list in the PR). Branch notes kept (never shipped as such): v221 2026-10-21: fx/fastfacts round 2: two tabs (My place, Reference tables), one shared print sheet (components/print-sheet.js), fertilizer prices by the reader's state, /status retired; v220 2026-10-21: fx/fastfacts. Fast Facts gets five tabs (My place, State, United States, Reference tables, Print); /here forwards there and the H/ short link opens it. here.js?v=20, place.js?v=5, here.css?v=5, fast-facts.js?v=13, manure-value.js?v=9, report-link.js?v=3, loader CV 78. Was v233 2026-10-22: fx/agsistmail. Public email addresses move to agsist.com (sig@, privacy@, news@, bids@); no farmers1st.com address left. elev-post.js?v=4, futures.js?v=26, home.js?v=16, list-elevator.js?v=2, outbox.js?v=3, prf-sponsor-page.js?v=3, rain-print.js?v=77, rp-business.js?v=9, rp-gift.js?v=9, signup-ask.js?v=15 (loader CV 82), sponsor-apply.js?v=5, field-scout.js?v=24 (field-scout-extras.js?v=2, field-scout-read.js?v=11), rain-county-print.js?v=37 on the county pages, here.js?v=20; subs worker v5.53. Was v232 2026-10-22: fx/flakes (past 230 fx/newworker on main, 231 fx/agsistmail). Rain Print on a phone: a tap on a card or button under the pinned strip, made while a box has focus, is no longer lost when the strip unfolds. rain-print.js?v=76. A glossary mark clicked and closed stays closed (a waiting hover reopened it), glossary.js?v=3. Free daily email in the menu puts the box in focus on a slow device too (loader.js). Was v230 2026-10-22: fx/newworker (past v228 #40 and v229 #38, both on main). The subs worker moves to the new agsist-api Worker: every page and component calls agsist-api.dnilgis.workers.dev (cb-alerts 5, cb-myelev 6, elev-post 3, form-post 8, futures 25, haymow 3, homepage-extras 18, outbox 2, rain-print 74, rp-business 8, rp-gift 8, rp-logo 4, rp-short 7, signup-ask 14, sponsor-apply 4; loader, ga-gate and cb-signup change in place; Atlas watch.js restamped). v228 2026-10-22: fx/rpnamespace (past v227, kept for #38). Rain Print: the year always keeps its space after the farm name (and the town), in any font, in the preview and every file. rain-print-art.js?v=21, rain-print.js?v=72 (past v71, kept for #38). Was v226 2026-10-22: fx/deferred. With the subs worker down, a gift card order, a Rain Print business quote, a hay board post, an elevator's bids and an alert confirm are kept in the browser (components/outbox.js?v=1) and sent when it answers; Email me this design goes by the backup form. rain-print.js?v=70 (past fx/qrfallback's 69), form-post.js?v=7, rp-gift.js?v=7, rp-business.js?v=7, haymow.js?v=2, elev-post.js?v=2 (a kept elevator save posts later with the time it was typed, subs worker v5.50), cash-bids.js?v=12 (an elevator that posts its own bids says "Updated 6:10 AM Wed"), loader CV 79 (226: past fx/qrfallback's 225). Was v224 2026-10-22: fx/rplayout. Rain Print layout: the print pinned in view, one Layers card of chips, the line under the print, the video bar under it, crop days set in the crop row, a place link opens on the tool. rain-print.js?v=68, rain-print-draw.js?v=4, rp-canada.js?v=3. Was v223 2026-10-22: fx/rpcrop. Rain Print: a crop day picked by hand stays picked (it went blank until both were set), and a crop with no days says what it needs. rain-print.js?v=67 (past v222, fx/frontdoor). Was v222 2026-10-22: fx/frontdoor. Every emailed link goes to agsist.com/e (the front door, subs worker v5.48); /e is never cached (its link carries a signed id). Was v221 2026-10-22: fx/rpcheckout. Rain Print takes orders with the subs worker out: checkout goes to Stripe whatever the worker does (a long design as RPH-<hash>, its record by the backup form), a logo that cannot upload is kept in the browser. rain-print.js?v=66, form-post.js?v=6, rp-short.js?v=6, rp-logo.js?v=3 (subs worker v5.47). Was v220 2026-10-22: fx/redundant. Signups that cannot reach the blocked subs worker go to the backup form and say "Got it. You'll be added within a day." (loader.js, loader CV 78, signup-ask.js?v=13). Was v219 v219 2026-10-21: fx/rpfix (on fx/rptemp). Rain Print: the town typed while the sample draws is drawn; Every year behind your year on the sample moves to the nearest long record, says why by the station line, and a short station picked by hand offers the way back; the auto pick ranks the near stations by a full rain and snow year, then distance, inside the snow slack, and says why; the town said back in its own capitals; plainer words when the worker is blocked. rain-print.js?v=65, rain-county-print.js?v=36 on the county pages, here.js?v=19. Was v218 2026-10-21: ship26. The red barn icon set (img/icon.svg, favicon.ico, favicon-16/32, apple-touch, icon-192/512 and maskable; SVG icon link on every page). fx/feederidx: feeder-index.js?v=2. fx/reportasks: signup-ask.js?v=12, loader CV 76 (past fx/transport CV 74). fx/rptemp: rain-print.js?v=64, rain-print-art.js?v=20, rain-print-draw.js?v=3, rain-print-extras.js?v=2, rp-insert.js?v=6, rain-county-print.js?v=35, here.js?v=18 (past ship23 draw v2, rain-county-print v34, here v17). Was v217 v217 2026-10-21: fx/notice: site notice bar (loader CV 75, data/site-notice.json). Was v216 v216 2026-10-21: fx/gaopen: ga-gate.js loads GA when the worker fails or is slow (only a clear no keeps it off). Was v215 v215 2026-10-21: ship24. fx/dailybids: your elevators and near-you lines in the Daily (worker v5.42, cb-myelev.js?v=5, cb-myelev.css?v=2). fx/transport: Grain on the move (/grain-transport) in the Prices menu, loader CV 74. fx/collect: history backfills (dispatch-only) and collection riding existing jobs (worker v5.45). Was v214 v214 2026-10-21: ship23. fx/rpconv: Christmas order-by line, numbered and initialed, the guarantee, Send this to your family, Email me this design (worker v5.43, hourly reminders). fx/rpdraw: Watch it draw (rain-print-draw.js?v=1, art v19). fx/onemore: One more? after alerts (signup-ask.js?v=11, loader CV 73, worker v5.41). fx/spraywind: wind at your field and best spray windows on /spray. fx/stormreplay: storm replay on /rain-radar and /hail-map. rain-print.js?v=63, rain-county-print.js?v=34 on the county pages, here.js?v=17, rain-print-draw.js?v=2 (chip in the markup, no layout shift). Was v213 v213 2026-10-20: ship22. fx/giftmail: this-year gift card issued and emailed to the buyer at once (subs worker v5.40, rain-print.js?v=62, rp-gift.js?v=6). fx/elevadmin: the elevator desk answers Save next to the button. fx/quietmail: old forwarding brief off, critic email only on a weak issue. fx/backup: subs worker v5.39 GET /export for the monthly SSD backup. rain-county-print.js?v=32 on the county pages, here.js?v=15. Was v212 v212 2026-10-20: ship21. fx/rpdigital: digital Rain Print files by email on approval (rain-print.js?v=61, rp-insert.js?v=5, subs worker v5.38), rain-county-print.js?v=31 on the county pages, here.js?v=14. Was v211 v211 2026-10-20: ship19. fx/rporder: Rain Print order records, Stripe webhook alerts, buyer proof email with Approve this print (new rain-print-approve.html), subs worker v5.36 and v5.37, rain-print.js?v=60, rain-county-print.js?v=30 on 2,685 county pages, here.js?v=13. Was v210 v210 2026-10-20: ship18. fx/bizfix: business list of 100 (rp-business.js?v=6, subs worker v5.35), From $32 a print, sample line, prf-sponsor-page.js?v=2 (states fold with ?state=), footer List your elevator, free, loader CV 72. fx/mrfix: morning report job checks out its Today fixture. Was v209 v209 2026-10-20: ship17. fx/bidsnc-paste: New Cooperative paste box and elev-today.html, paste-bids.js, cash-bids.js?v=11 (Last updated stamp on pasted boards), subs worker v5.34. fx/privmove: raw, references, skills and four job files on the private repo; no page change. Was v208 v208 2026-10-20: ship16. fx/radarmap: USGS basemap under the radar rain, radar-rain-page.js?v=4; no AI names in served files. instructions file cut to a pointer. fx/prffix: PRF ten fixes (prf.css 9, prf.js 8, prf-math 3, prf-now 3, prf-outlook 3, prf-optimize 5, prf-optimize-ui 7, prf-sponsor 5). fx/arcfix: ARC/PLC 2025 estimates, no Ask FSA, CALC_V 14. Was v207 v207 2026-10-20: new Rain Print maker key (MAKER_HASH), rain-print.js?v=59. Was v206 v206 2026-10-20: ship15. fx/gadc: GA guard 2026-10-20b, new components/ga-gate.js?v=1 (GA after the first scroll, tap or key, only when the subs worker /ga-ok says not a cloud network; time-zone rule gone). fx/newcoop: a board that could not be read keeps its town pages 7 days. Was v205 v205 2026-10-20: ship14, value of gain, hail map opens on the last 24 hours (state links too), GA guard 2026-10-20 (US and Canada time zones only), test fixes, reseeded prices. Was v204 v204 2026-10-20: ship13, panel fixes, one bump for four branches. fx/pinfra: navigation requests fall back to the cached page after 3.5 s; data/fsa moved to the raw branch; grain bin focus ring. fx/pbids: geo.js?v=31, cash-bids.js?v=10 (ZIP carries to /cash-bids; wrong-town boards moved; best bid first; county links). fx/pdaily: cot-page.js?v=3. fx/psmall: loader CV 71 (menu: Everything near me, Yield by state, Farmland sale index), rain-county-print.js?v=28, here.js?v=11, grain bin uses grain-shrink.js, dated futures titles. Was v203 v203 2026-10-20: ship12, one bump for seven branches. fx/tenure: field-scout.js?v=23, field-scout-read.js?v=10 (county tenure 2022 only, 1997-2017 county rows withheld). fx/pricefix: home-yield.js?v=8 (night badge), price-local.js?v=6 (settle range), harvest tracker closed-not-released wording and our running average in the window bar (Sig). fx/atlasfix: inline Atlas fixes, snow wording, station pick (snowfall record beats NOAA normals, Sig). fx/asks: signup-ask.js?v=10 (One more? after any signup, first-visit bar after engagement, one Daily ask per page, ask_shown events), home.js?v=15, loader CV 70. fx/climdiv: raw only. Preview note off the data: rain-print-art.js and county print. fx/snowtrace: rain-print-art.js?v=18 (trace of snow as a flake, Sig). fx/summertrace: rain-print.js?v=58, rain-county-print.js?v=27, here.js?v=10 (no snow traces June to August, Sig). Was v202 v202 2026-10-19: ship11, monetization board fixes, one bump for four branches. fx/rpretail: county rain pages offer "Last year, by Christmas" beside "This year, in January" (rain-county.css?v=5, rain-county-print.js?v=24, 2,684 county pages rebuilt); rain-print.js?v=56 (gift address asked once, at Stripe; "Make another for someone else"; "Make it 2025, by Christmas"), here.js?v=7. fx/rpbiz: form-post.js?v=5 (a business list never falls back to Formspree), rp-business.js?v=4 (PO and invoice contact, same-station line). fx/gauge: sponsor-apply.js?v=2 (tier "daily"), /rain-gauge waitlist first. fx/daily: email only, no page assets. Was v201 2026-10-19: ship10, one bump for three branches. fx/cls: layout shift on /fertilizer and the homepage (test/cls-oct19.test.mjs). /fertilizer opens with the co-op cards and the lede line baked (scripts/bake_fert_page.mjs, no component change); homepage: price-local.js?v=5 (a saved state reserves its line; on index, the futures pages, markets, scorecard and fast-facts), home.css?v=25 (phone header placeholder held to 62px, ticker status holds two lines), home.js?v=14 ("Also today" moved inline into index.html). fx/smallcalls: futures.js?v=23 (store-or-sell link underlined) on corn, soybean and wheat futures; loader.js reads an unsold sponsor slot from data-slot (ribbons now ship empty, no price text; loader.js?v=19 left as is, this bump refreshes it); source and note line links underlined (inline CSS on 25 pages, rent and cash bid town pages). fx/mo-rates: custom-rates.js?v=3 and custom-rates.css?v=3 (median under the average where a survey prints one, median-only anecdotal rows, percent-of-crop rows) for Missouri G302 revised March 2026 (2025 rates); custom rate pages rebuilt. Sitewide: styles.css?v=26 (the phone header placeholder is held to the live nav's 62px on every page, the rule moved out of home.css, home.css?v=26; test/cls-header-phone.test.mjs). Was v200 2026-10-19: ship9, one bump for four branches. fx/locprice: location is asked only on a tap of "Use my location", never on load (geo.js?v=30 on index, cash-bids, corn, soybean, wheat and cattle futures, fertilizer, spray and the page template; home.js?v=13 no-location bid box at once with a Use my location button; home-planting.js?v=2 no 3.5 s geolocation fallback; home.css?v=24); spray and urea pages wait for a tap; homepage hero futures tiles and the fertilizer co-op line are baked with dated prices. fx/dailywords: no add-on ask pre-ticks the Daily, the cash bid town and company email box keeps its main offer ticked (signup-ask.js?v=9, prf-notice.js?v=2 on /prf and PRF county pages, homepage-extras.js?v=16); menu and footer Daily asks say every morning (loader CV 69). fx/rpshared: rain-print.js?v=55 (a design link opens with its print first), rain-county-print.js?v=23 (ENGINE pin; county pages rebuilt), here.js?v=6. fx/atlastop: atlas-sales.js?v=c3fa7673 (recorded-sales headline tile on IL and WI county pages and the printable sheet; rent tiles over three survey years old show n/a). Was v199 2026-10-19: fx/a11y: styles.css?v=25 sitewide (--base 106.25% so a larger default font is respected; menu folds at 60em; light --blue #2a6390; Daily tag override), loader CV 68 (header.html 60em), cash-bids.js?v=9 and cb-glance.css?v=2 (basis arrow and screen-reader words, light row red), here.css?v=4 and custom-rates.css?v=2 (light gold buttons on --gold-fill), home.css?v=23, home.js?v=12, home-yield.js?v=7, geo.js?v=29 (var(--orange), var(--blue)), futures.js?v=22 (flat move is unch). Was v198 2026-10-19: Rain Print a normal or station history that failed to load is said so and holds the order and the maker files (rain-print.js?v=54 on rain-print, rain-print-business and rp-gift; rain-county-print.js?v=22 ENGINE pin, on every county rain page and in here.js?v=5); the letter's code line says a print or framed print (rp-insert.js?v=4). Was v197 2026-10-19: futures.js?v=21 on corn, soybean and wheat futures pages (live quote written into the seed note in place, no layout shift). Was v196 2026-10-19: fx/nightseo: night SEO and AI fixes (futures.js?v=20: the hero line names the settle; one rounding for the benchmark yield) on top of fx/nightmoney, so ARC/PLC goes to CALC_V 13 (arc-plc.js, arc-plc-math.js, arc-plc-simple.js, arc-plc-sheet.js, arc-plc.css, arc-plc-simple.css ?v=13: both v12s together). Was v195 2026-10-19: fx/nightmoney: ARC/PLC shows no expected dollars on any borrowed 2026 spread, county-yield wording (arc-plc CALC_V 12); custom rates Nebraska dryland combine corn and Missouri 2022 rates (custom-rates.js?v=2); break-even corn N at the A2809 MRTN rate, flat, not per bushel (breakeven.js?v=5). Was v194 2026-10-19: rain-county-print.js?v=21 (/here mount + rain-print.js?v=53 together); Rain Print asks "Email me when <year> is finished" after a this-year draw (rain-print.js?v=53 on rain-print, rain-print-business and rp-gift; rain-county-print.js?v=20 loads it). Was v193 2026-10-19: place.js?v=4 and here.js?v=4 (short QR + first screen together); /here first screen: the county station's year drawn as a Rain Print and ranked against its own record, what is unusual against its own past, nearest elevators against their neighbors (place.js?v=3, here.js?v=3, here.css?v=3, rain-county.css on /here, rain-county-print.js?v=20 mountable, bids-network.js?v=7 exports index and shard, bids-homepage.js?v=39, field-scout-read.js?v=9, field-scout.js?v=22). Was v192 2026-10-19: /here QR as a short path (place.js?v=3, here.js?v=3, report-link.js?v=2 /H/<fips>[/<zip>], qr.js?v=11 everywhere): 25 x 25. Was v191 2026-10-19: printed report QRs (comp-report.js?v=3, field-report.js?v=4, qr.js?v=11 mixed mode on those pages and hail-map, new print-qr.js?v=1, report-link.js?v=1, short links /C/ /F/ /S/ /H/ opened by 404.html). Was v190 2026-10-19: home.js?v=11 (holiday week + price rows together); price labels and Atlas details (home-yield.js?v=6, home.js?v=10, home.css?v=22, price-local.js?v=4, drought-county.js?v=2). Was v189 2026-10-19: /here one entry point, role chips gone, go deeper row and designed print report (place.js?v=2, here.js?v=2, here.css?v=2, qr.js?v=10 on /here). Was v188 2026-10-18: loader CV 67, The Haymow in the menu and footer. Was v187 2026-10-19: Rain Print snowfall not in yet is not a gap in a year still going (rain-print.js?v=52, rain-print-art.js?v=16, rain-county-print.js?v=19); county rain picks a station with full rain and snowfall records. Was v186 2026-10-19: Export Sales says Thu or Fri in a holiday week (home.js?v=10, usda-calendar). Was v185 2026-10-19: PRF print sheet + neutral wording (prf.js?v=7, prf.css?v=8, prf-sponsor.js?v=4, prf-now.js?v=2, qr.js on /prf). Was v184 2026-10-18: /here place page (place.js?v=1, here.js?v=1, here.css?v=1, layers.js?v=1), search.js offers Everything about a place (loader CV 66). Was v183 2026-10-18: The Haymow, hay for sale and wanted (new haymow.js?v=1 on /haymow). Was v182 2026-10-18: land audit fixes (field-scout-land.js?v=7, comp-report.js?v=2, field-scout-read.js?v=8, field-scout.js?v=21). Was v181 2026-10-18: loader CV 65 (footer wording), name moved from the top of pages to one line at the end. Was v180 2026-10-18: Field Scout layers fixed against the live answers (field-scout-layers.js?v=2, field-scout.js?v=20). Was v179 2026-10-18: loader CV 64 (sponsor metrics load first). Was v178: comp-report.js?v=1, field-scout-land.js?v=6, field-scout-read.js?v=7, field-scout.js?v=19. Was v177: footer on one grid (loader CV 63), next-links.js?v=3 per-page data, whats-new card, home.js?v=9, field-scout.js?v=18 + field-scout-layers.js?v=1, Indiana sales. Was 176: v176 2026-10-18: land sale detail panel (field-scout-land.js?v=5), printed report sales (field-report.js?v=3); v175 2026-10-18: first-time visitor fixes (glossary.js?v=1, next-links.js?v=1, data/glossary.json, data/next-links.json, cb-sample.js?v=3), /glossary; v174 2026-10-18: accuracy fixes 3 (cot-market.js?v=3, cot-analysis.js?v=3, planting-date.js?v=5), tool FAQ answers; v173 2026-10-18: Farmland Atlas county stories; v172 2026-10-18: the new menu (loader CV 62, ZIP chip, signup footer, Bids by state), PRF county stories; v171 2026-10-18: cb-sample.js?v=2, cash-bids no-jump, homepage hero prices sooner; v170 2026-10-18: gift guide photos, rain-county-print.js?v=18, Rain Print share image from the real photo; v169 2026-10-18: real Rain Print photos (img/photos), story sets ready; v168 2026-10-18: land sources (field-scout.js?v=16, field-scout-read.js?v=6, field-scout-land.js?v=4), search gap titles and FAQs, menu fixes round 1 (loader CV 61, search.js, data/search-places.json), Rain Print Oct 18 decisions (rain-print.js?v=51: free damage replacement, phone line, paper wording, gift fields on page); v167 2026-10-18: Rain Print panel fixes (rain-print.js?v=50, rain-print-art.js?v=15, rp-canada.js?v=2, rp-business.js?v=3, rp-insert.js?v=3, rain-print-records.js?v=4, rain-print-promo.js?v=5, letter sample image), maker key gate, county stories; v166 2026-10-17: own-report sale barns live (cattle-auction.js?v=5); v165 2026-10-17: sale barns 88 + own-report barns (cattle-auction.js?v=4), PRF grid index email (signup-ask.js?v=8, new prf-notice.js?v=1), menu CV 60; v164 2026-10-17: alert asks (signup-ask.js?v=8, county rain year ask, co-op bid box, report-day ask), held skipped bid boards (cash-bids.js?v=8), menu CV 59; v163 2026-10-17: box letter code line, off until set (rain-print.js?v=49, rp-insert.js?v=2); v162 2026-10-17: radar rain map without keyed tiles (radar-rain-page.js?v=3), serial No. 0000 test prints (rain-print.js?v=48), accuracy fixes 2 (fast-facts.js?v=12, planting-date.js?v=4), search answers (price-local.js?v=3, futures.js?v=19, cattle-auction.js?v=3, new cb-sample.js?v=1); v161 2026-10-17: PRF this interval so far (new prf-now.js?v=1, data/prf/now network-first), hail storm days; v160 2026-10-17: image and chart labels (futures.js?v=18 carries cleanup and chart labels); v159 2026-10-17: cleanup (futures.js?v=17, basis-map.js?v=2, fast-facts.js?v=11, home.js?v=8, Rain Print share image), custom rates page (custom-rates.js?v=1, custom-rates.css?v=1), menu CV 58, accuracy fixes; v158 2026-10-17: radar rain page (radar-rain.js?v=1, radar-rain-page.js?v=2, field-scout.js?v=15, field-scout-read.js?v=5), menu CV 57; monthly land update; v157 2026-10-17: Rain Print A2 clean and options (rain-print-art.js?v=14, rain-print.js?v=47, new rain-print-extras.js?v=1, gdu-stages.js on rain-print, rain-county-print.js?v=17); v156 2026-10-17: field audit fixes (rain-county-print.js?v=16, bids-network.js?v=6, bids-homepage.js?v=38, rain-print.js?v=46, storesell.js?v=8, store-or-sell.js?v=7, breakeven.js?v=4), menu CV 56; hail, atlas and cash-bids pages; v155 2026-10-17: lens fixes (futures.js?v=16, cot-page.js?v=2, cb-basis-hist.js?v=2), stale-data fixes (util.js?v=20, price-local.js?v=2, geo.js?v=28, cb-rank.js?v=5, cash-bids.js?v=7, rp-business.js?v=2, rain-print.js?v=45, rain-county-print.js?v=15, home.js?v=7, home-season.js?v=7, home-yield.js?v=5), co-op company pages; v154 2026-10-17: analytics guard skips automated browsers (every page head); v153 2026-10-17: fertilizer trend line and bill picks (new fert-trend.js?v=1), daily local line above the quote strip (daily-local.js?v=2), strip settle or last trade note; v152 2026-10-17: tariffs trade-aid row (FSA Farmer Bridge Assistance rates and limits); v151 2026-10-17: tariffs China purchase gauge, pre-sell short-crop check and contract box, tools hub cards; v150 2026-10-17: phone folds on futures pages, state cash line (new price-local.js?v=1, futures.js?v=14), cards for wide tables (field-scout-land.js?v=3, field-scout-read.js?v=4, field-scout.js?v=14), settle stamps; v149 2026-10-17: re-score 7 fixes (field-scout.js?v=13, field-scout-read.js?v=3, field-scout-land.js?v=2, field-report.js?v=2, breakeven.js?v=3, geo.js?v=27, home.js?v=6): Illinois multi-parcel acres held back, market sales exclude related-party deeds, settle wording from close_kind, cattle to the thousandth, break-even on Dec 27, census county names; v148 2026-10-17: break-even basis from the state median (breakeven.js?v=2, breakeven-more.js?v=2); v147 2026-10-17: break-even rebuilt (new breakeven.js?v=1, breakeven-more.js?v=1, data/breakeven), Illinois land transfers and WI/MN parcel owners on the field scout land card; v146 2026-10-17: Rain Print on 13 x 19 paper (rain-print.js?v=44, rain-print-art.js?v=13, rp-gift.js?v=5), box letter (new rp-insert.js?v=1), What's in the box with img/rain-print-insert-letter-sample.webp, rain-print-promo.js text; v145 2026-10-17: settle vs last trade (your-area.js?v=2, ys-cattle data-v=2, grain-shrink.js?v=3, lrp.js?v=4, home-yield.js?v=4, bids-homepage.js?v=37), lean hogs roll on the 10th business day; v144 2026-10-17: Only on AGSIST facts and local line on the Daily (daily-edge.js?v=1, daily-local.js?v=1), /cash-bid-index, menu CV 55; v143 2026-10-17: field scout land card (field-scout-read.js v2, new field-scout-land.js), /field-report page; v142 2026-10-17: Your area box on 7 pages (your-state.js?v=1, ys-*.js), USDA grain and livestock .ics; near-coop.js v1, cb-vs-state.js v1, fast-facts.js v10, cash-bids.js v6, fert-coop-places.json; Rain Print gift line on markets and futures pages; v141 2026-10-17: tools cards carry each tool data date (data/tools-fresh.json), Everything else folds on phones; v140 2026-10-17: rain gauge page opens with Rain Print (rain-print-promo.js?v=4 on rain-gauge); v139 2026-10-17: storage chart 1:1 labels (storage-detail.js?v=2), homepage counts from bids-stats.json, field scout in parts (field-scout.js?v=12, field-scout-read.js?v=1, field-scout-extras.js?v=1), this year hail in cells; v138 2026-10-17: your-area box on daily, issue pages, cot, scorecard, whats-priced-in (your-area.js?v=1); past issues rebuilt with the current byline; v137 2026-10-16: storage section past falls from the first NASS pull; v136 2026-10-16: field scout rebuild (field-scout.js?v=11, field-scout.css?v=1, vendored Leaflet and Leaflet.draw, per-state data slices); v135 2026-10-16: homepage no-location bid card with state basis, first-screen byline, Also today line, COT analysis on demand, install banner built on demand, home.css dead rules removed (home.js?v=5, home.css?v=20); v134 2026-10-16: storage section rebuild with past falls (storage-detail.js?v=1); v133 2026-10-16: Fast Facts N box uses state basis by default (fast-facts.js?v=9); v132 2026-10-16: planting date one set of numbers, station names, outside WI and MN wording (planting-date.js?v=3); v131 2026-10-16: re-score gap fixes: fertilizer true date ranges and undated prices not counted (fert-coops.js?v=5, fert-sources.js?v=6), manure-value.js?v=8, store-or-sell.js?v=6, rain-county-print.js?v=14 usual line, arc-plc CALC_V 11 (nav once, math on demand), urea soil surface term, presell example, tariffs 9.97 MMT; v130 2026-10-16: Fast Facts corn N rate box at posted prices (fast-facts.js?v=8, a2809.js?v=2); v129 2026-10-16: planting date soybean table on the UW source (planting-date.js?v=2); v128 2026-10-16: drought page rebuilt (drought-county.js?v=1), Lower 48 headline, county streaks, rain since Jan 1; v127 2026-10-16: planting date rebuilt answer first (new planting-date.js?v=1), station frost and heat units; v126 2026-10-16: tools hub find box, task chips, your-state links; v125 2026-10-16: Synergy Cooperative (WI) is one more co-op in the fertilizer prices; separate price sheet box removed (fert-coops.js?v=4, fert-sheets.js gone); v124 2026-10-16: Rain Print for Canada (metric, French, NOAA GHCN-Daily incl. Environment Canada stations): rain-print.js?v=43, rain-print-art.js?v=12, rp-canada.js?v=1 on rain-print and rp-gift, rain-county-print.js?v=13; v123 2026-10-16: Rain Print Christmas line asks for the proof OK the day it comes (rain-print.js?v=42, rain-county-print.js?v=12); v122 2026-10-16: the Daily as news (NewsArticle, byline and publish time, corrections, feed times), /editorial-standards, footer CV 54; v121 2026-10-16: hay AMS weekly trades read from real reports (hay-ams.js?v=6); v120 2026-10-16: fertilizer page shows emailed co-op booking sheets apart from posted prices (fert-sheets.js?v=1); v119 2026-10-16: crop and weather fixes (planting date no maturity call, spray inversion networks and dicamba cutoff, urea rain advice and Montana citations, GDU freeze prefill, hail map phone table and 10 mile wording, conditions phone table and first year 2001); v118 2026-10-16: /fall-nitrogen and /harvest-or-wait (harvest-wait.js?v=1, harvest-wait-ui.js?v=1), menu CV 53; Fast Facts from UW A2809 (fast-facts.js?v=7, a2809.js?v=1, gdu-stages.js?v=1 on fast-facts and gdu-calculator); yield estimator 75/85/95 (yield-est.js?v=2), tools phone lines, scorecard where it stands; milk mailbox by area, what is priced in number to beat, harvest tracker chart and per-state RMA files, COT one crowding phrase (cot-analysis.js?v=2, cot-market.js?v=2), USDA .ics from the page list (home.js?v=4, home-season.js?v=5: fall nitrogen tile opens /fall-nitrogen); nutrient-removal.js?v=2, lrp.js and lrp-ui.js?v=3, lrp.css?v=2, hay-ams.js?v=1; v117 2026-10-16: cash lease notice to end a lease, foreign land and Atlas map libraries self-hosted (vendor/topojson-client-3.1.0, vendor/us-atlas-3.0.1), atlas-tenure.js?v=2, state rent pages with the NASS state average, Atlas county card compares farm real estate value; v116 2026-10-16: helper batch: futures one quote per contract (futures.js?v=13), cash bids delivery labels and Best basis color (cash-bids.js?v=5, cb-rank.js?v=4), grain bin eave rows (grain-bin.js?v=3), Rain Print engine v41 and county print v11, /rain-print-business (rp-business.js?v=1), retirement and anniversary gift pages, hay AMS weekly, LRP example, grain shrink dry-it-myself, ARC/PLC big-state tables on open; v115 2026-10-16: drought 2024 gap named on every since-2000 total, county drought this week box, saved national map (drought-monitor, farmland-atlas, field-scout.js?v=10); v114 2026-10-16: /combine-loss (combine-loss.js?v=1, combine-loss-ui.js?v=1), /commodity-loan (commodity-loan.js?v=1, commodity-loan-ui.js?v=1), menu CV 52; v113 2026-10-16: season fixes (manure-value.js?v=7, store-or-sell.js?v=5, cash-bids signup placement, fall copy); v112 2026-10-16: Rain Print engine v40 (arrival date under Pay, funnel events, buy-another prompt, business price shown, old-iPhone pay bar fix), rain-county-print.js v10; v111 2026-10-16: /cattle-auction-prices live (cattle-auction.js?v=1), Sale barn prices in the menu and footer (loader.js CV 51); v110 2026-10-16: /hay-prices page, Hay prices in the menu and footer (loader.js CV 50); v109 2026-10-16: cash bids audit fixes: outlier bids never Best, road miles, Read vs Posted, clean elevator names (cash-bids.js?v=4, cb-rank.js?v=3, storesell.js?v=7, store-or-sell.js?v=4); v108 2026-10-16: soybeans on grain EMC (grain-emc.js?v=4, grain-emc-ui.js?v=4), site search knows grain shrink and nutrient removal; v107 2026-10-16: /nutrient-removal page (nutrient-removal.js?v=1), Nutrient removal value in the menu and footer (loader.js CV 49); v106 2026-10-16: /grain-shrink page (grain-shrink.js?v=1, grain-shrink-ui.js?v=1), Grain shrink in the menu and footer (loader.js CV 48); v105 2026-10-16: fertilizer prices from the Kansas co-op posted prices Sig sent, one shared price file, hand dealer sheet and the USDA Illinois box removed (fert-sources.js?v=5, fert-coops.js?v=3, fast-facts.js?v=6, manure-value.js?v=6, home.js?v=3); v104 2026-10-15: Rain Print links written by hand (story links, county rain pages, emails) open with the 30-year normals and remarkable days on, the example prints redrawn with both (rain-print.js?v=39 on rain-print and rp-gift; v103 2026-10-15: menu and footer name the Harvest price tracker in full, under Markets (loader.js CV 47); v102 2026-10-15: /lrp redesign: calculator first (lrp.js?v=2, lrp-ui.js?v=2, new lrp.css?v=1 on lrp and lrp/record), the record and tests moved to /lrp/record; v101 2026-10-15: Rain Print opens with remarkable days on (rain-print.js?v=38 on rain-print and rp-gift; rain-county-print.js?v=8 loads the same engine); v100 2026-10-15: source sweep (fast-facts.js?v=4, grain-emc.js and grain-emc-ui.js?v=3, grain-bin.js?v=2), manure totals; v99 2026-10-15: manure value headline is all the nutrients in the manure (UW A2809 Table 9.2 totals) with the first-year part beside it (manure-value.js?v=4, manure-value.css?v=3 on manure-value and fast-facts); v98 2026-10-15: /lrp page (lrp.js?v=1, lrp-ui.js?v=1), LRP in the menu and footer (loader.js CV 46); v97 2026-10-15: Rain Print copy (one name per product, the promise, who makes it), the file says PNG and PDF, a gift day past the preview says January, favicons in the page (rain-print.js?v=37 on rain-print and rp-gift; rain-county-print.js?v=7); v96 2026-10-15: Rain Print buying path 2: a failed redraw keeps the print up, faster first draw, typing redraws after a pause, tick and Pay pinned in the review sheet, short link asked at every pay press, thank-you only names a print it is sure of, gift card fixes (rain-print.js?v=36, rp-short.js?v=5, rp-gift.js?v=4 on rain-print and rp-gift; rain-county-print.js?v=6); v95 2026-10-15: Rain Print phone scroll after Draw, county-link town from the station, product pick kept after Back (rain-print.js?v=35, rain-county-print.js?v=5); v94 2026-10-15: /grain-emc page (grain-emc.js?v=2, grain-emc-ui.js?v=2), Grain EMC in the menu and footer (loader.js CV 45); v93 2026-10-15: Rain Print serial reads "No. 0001" only (Sig initials each print by hand in pencil), hand-initialed line in the box lists and size FAQ (rain-print.js?v=34 on rain-print, rp-gift and rain-county-print.js?v=4); v92 2026-10-15: GDU calculator black-layer date, cash lease state notes, storage floors, foreign land trend label, presell revenue guarantee wording, tariffs timeline, fertilizer USDA box single price (fert-sources.js?v=2); v91 2026-10-15: Fast Facts N:corn race fixed and delayed-price labels (fast-facts.js?v=3), homepage trend label and Set ZIP cell (home-yield.js?v=3), tools hub order, COT page scripts split out with the market panel on demand, basis map on demand, fertilizer USDA series box, milk and cattle settled closes; v90 2026-10-15: Fast Facts lime cost prices the product chosen (fast-facts.js?v=2); store-or-sell counts months from today and names a farther elevator (storesell.js?v=6, store-or-sell.js?v=3); break-even county fill and crop year; rent for your ground on state rent pages; atlas 14-yr trend label (rent-calc.js?v=2); Rain Print links on county rain pages; v89 2026-10-15: cash bids: delivery label never wraps, basis color key, best after the drive line (cash-bids.js?v=3); town pages: Basis since June box (cb-basis-hist.js?v=1); conditions one week and harvest by state, yield estimator sites (yield-est.js); spray and hail map fixes; futures titles take only a settled close, futures.js?v=12, harvest tracker and What's Priced In fixes; v88 2026-10-15: farm bill next 90 days and operation picker (farm-bill.js?v=1), grain bin dealer setting and test weight (grain-bin.js?v=1), PRF pick card and dead ends (prf-optimize-ui.js), ARC/PLC answer first (arc-plc-simple.js, CALC_V 10), manure first-year wording and test box (manure-value.js?v=3); v87 2026-10-15: plain station words on county rain pages and the Rain Print promo line (rain-print-promo.js content); v86 2026-10-15: Rain Print thumbnail redrawn from the real 2012 Ames example (the image cache is cleared by this bump); gauge page says the nearest weather station; v85 2026-10-15: rain-print.js?v=33 (example print + Your words polish together); v84 2026-10-15: Rain Print Mark a day on one line per day, up to five marked days with a note under a day the art cannot place, one plain maker line, one text width under the tool (rain-print.js?v=32 on rain-print and rp-gift); v83 2026-10-15: county rain pages draw the year so far as a Rain Print from data/rain/daily (rain-county-print.js?v=1, rain-county.css?v=4); v82 2026-10-15: Rain Print example print (2012 Ames, real NOAA data) in the empty frame until the live draw (rain-print.js?v=32 on rain-print and rp-gift); v81 2026-10-15: Rain Print remarkable days print their dates (a day, or a stretch's range) in gray after the words, the biggest rain's date the same way, the foot line says "Gaps: N days with no report" only past 3 missing days, and up to five marked days (rain-print-art.js?v=11 on rain-print and rp-gift); v80 2026-10-15: Rain Print plain station words (rain-print.js?v=31); v79 2026-10-15: Rain Print picks the nearest station with rain and snowfall records (rain-print.js?v=30); v78 2026-10-15: print redesign (Rain Print print design (panel 4): the name is the biggest words, dates on the line, Roots scales fit the year, one foot line, snowfall note (rain-print-art.js?v=9 on rain-print and rp-gift)); Rain Print three-step flow: one picker, a review sheet before Stripe in the same tab, a paid page, example words as hints only, month and day lists (rain-print.js?v=28 on rain-print and rp-gift); marked days: the date after the words on the print, Mark a day rows numbered with Remove and messages under their own row (rain-print-art.js?v=10, rain-print.js?v=29 on rain-print and rp-gift); the station pick takes one that records snowfall too, a few miles farther, and the station list says rain and snow or rain only (rain-print.js?v=30 on rain-print and rp-gift); v77 2026-10-15: page audit fixes across about 60 pages (copy, stale facts, Barchart mentions gone, farm bill status, manure wording); v76 2026-10-14: manure value is the value of all the manure: calculator drops the buyer and seller boxes, hauling and the fair range, and adds the whole field (manure-value.js?v=2, manure-value.css?v=2 on manure-value and fast-facts); v75 2026-10-14: Rain Print previews carry the standard code and make no short link on a redraw; order files, checkout and the order form make one at the press (rain-print.js?v=27 and rp-short.js?v=4 on rain-print and rp-gift); v74 2026-10-14: Rain Print standard code on every preview, the print's own short link only on the maker's order files, Test print PDF (standard code) (rain-print.js?v=26 on rain-print and rp-gift; qr.js?v=10 on rain-print, rp-gift, sponsor-kit, prf-sponsor-kit, arc-plc/sheet); v73 2026-10-14: /manure-value page (manure-value.js?v=1, manure-value.css?v=1, shared with fast-facts), Fast Facts page script moved to fast-facts.js?v=1, fast-facts on util.js?v=19, menu and footer gain Manure value and Fast Facts (loader.js CV 44); v72 2026-10-14: Rain Print panel 3 fixes (rain-print.js?v=25, rain-print-art.js?v=8, rain-print-records.js?v=3, rp-logo.js?v=2, rp-short.js?v=3 on rain-print and rp-gift; form-post.js?v=4 on elevators, list-your-elevator, sponsor-report, farmland-atlas, prf-sponsor, rain-print), privacy page, rain gauge page, gifts page, styles.css?v=24 and loader.js?v=19 sitewide (both changed since their last bump); v71 2026-10-14: PRF sponsor offer moved up to a slim band under the opening answer on /prf, the state pages and the county pages (prf-sponsor.js?v=3, prf.css?v=6); v70 2026-10-14: Rain Print logo upload (rp-logo.js?v=1, rain-print-art.js?v=7, rain-print.js?v=24 on rain-print and rp-gift); v69 2026-10-14: Rain Print "Your print" rebuilt as a full-window view with the print fitted and one side panel (rain-print.js?v=23 on rain-print and rp-gift); v68 2026-10-14: Rain Print order fixes: ?d=RPS- references open, example words explained under the Order button, checkout note under the tapped button, proof orders what it showed, label counters, new share image and thumb (rain-print.js?v=22, rp-short.js?v=2 on rain-print and rp-gift; rain-print-promo.js?v=4 on index and gifts-for-farmers); v67 2026-10-14: rain gauge page rebuilt with the prototype design (charcoal renders in img/rain-gauge/, old concept images removed, waitlist top and bottom, no new scripts); v66 2026-10-14: Rain Print digital file needs no proof, ships within 3 business days, 8 x 10 gift card with a preview of the print so far (rain-print.js?v=21, rain-print-art.js?v=6, rp-gift.js?v=3 on rain-print and rp-gift); v65 2026-10-14: Rain Print polish: NOAA daily data (data.rcc-acis.org) never cached; forms give up on a silent worker after 12 s (form-post.js?v=3 on elevators, list-your-elevator, sponsor-report, farmland-atlas, prf-sponsor, rain-print); gift card wording (rp-gift.js?v=2 on rp-gift and rain-print); Rain Print page, engine and art fixes (every Rain Print script's ?v bumped once in rain-print.html); v64 2026-10-14: county rain polish (rain-county.css?v=3), prose keeps proportional figures (styles.css); v63 2026-10-13: Rain by county in the menu and footer (loader.js CV 43); v62 2026-10-13: county rain pages (rain-county.css), Rain Print finds the town from a county page link (rain-print.js?v=18); v61 2026-10-13: gifts for farmers page, homepage Christmas card links to it (rain-print-promo.js?v=3); v60 2026-10-13: Rain Print labels never collide (rain-print-art.js?v=3); v59 2026-10-13: Rain Print page steps, print beside the name and dates, up-close order row (rain-print.js?v=17); v58 2026-10-13: /prf-sponsor page and form (prf-sponsor.js?v=2, prf.css?v=5, prf-sponsor-page.js); v57 2026-10-13: PRF state sponsors (prf-sponsor.js, prf.js?v=5, prf.css?v=4), List your elevator (list-elevator.js); v56 2026-10-13: Rain Print own-area first print, example to trim, zoom (rain-print.js?v=16), bid alert box (cb-signup.js?v=2), elevator portal (post, elev-admin), portal elevator info on cash bids (cash-bids.js?v=2); v55 2026-10-13: Rain Print and rain gauge in the menu and footer, homepage card and related-page lines (loader.js CV 42, rain-print-promo.js?v=2), /rain-gauge; v54 2026-10-13: Rain Print business prices delivered, minimum 5, ships flat, reprint and refund terms (rain-print.js?v=14); v53 2026-10-13: Rain Print launch fixes and gift card redeem (rain-print.js?v=13, rain-print-art.js?v=2, rp-gift.js?v=1); v52 2026-10-13: Rain Print R1 Staircase and R2 Roots (rain-print.js?v=12, rain-print-art.js, new Rain Print fonts); v51 2026-10-13: futures chart loads on scroll, cash-bids page script file, one fetch per data file (util.js?v=19); v50 2026-10-12: craft pass (price, basis and contract formats, agronomy tools, hail, shared styles, homepage script file, offline mode on every loader page); v49 2026-10-12: menu and footer icons complete; v48 2026-10-11: signup asks take an optional ZIP, rent and ARC/PLC notice asks (signup-ask.js?v=8, loader.js CV 39); v47 2026-10-11: menu says Harvest price, wheat deferred card rolls, polish pass; v46 2026-10-11: unsold sponsor slots show nothing (footer, ribbons, homepage, daily), Rain Print sample and promo; v45 2026-10-11: email bar off the briefing archive, sponsor pages and worksheets (signup-ask.js?v=5, loaded by loader.js?v=18, which this clears); v44 2026-10-10: the menu grouped by question, shorter phone drawer; v43 2026-10-10: one price formatter, shared futures script, store-or-sell; v42 2026-10-10: ARC or PLC math loads on open and works offline, one shared counter sheet; v41 2026-10-09: ARC or PLC short-answer county pages and counter sheets; v40 2026-10-09: ARC/PLC calculator works offline on saved pages; v39 2026-10-09: ARC or PLC in the menu, footer and homepage; v38 2026-10-09: ARC/PLC decision tiers; v37 2026-10-09: ARC/PLC calculator; v36 2026-10-09: plainer site copy; v35 2026-10-09: card tokens, spray states, page titles; v34 2026-10-09: one look, variable fonts (old font files removed); v33 2026-10-09: no-jump layout, loading states; v32 2026-10-09: menu and footer change; v31 2026-10-09: instant pages, offline copies of key data; v30 2026-10-09: search, My elevators, tap targets; v29 2026-10-09: em-dash cleanup, link fixes, homepage coverage counts file; v28 2026-10-08: phone audit 2 (contrast, 16px inputs, 40px taps, footer pill); v27 2026-10-08: styles.css phone fixes (16px inputs so iOS stops zooming, .sr-only, light-mode change chips); was: v26 (2026-08-15 nav-panel visibility fix)
/* ───────────────────────────────────────────────────────────────── */

var CACHE_NAME = 'agsist-v' + CACHE_VERSION;

// These paths/hosts are always fetched from network — never cached
var NEVER_CACHE = [
  '/data/',                                  // prices.json, daily.json — must be live
  '/api/',
  'open-meteo.com',                          // weather
  'nominatim.openstreetmap.org',             // geocoding
  'ondemand.websol.barchart.com',            // (legacy, no longer called from client)
  'farmers1st.com/api',
  'agsist-barchart.dnilgis.workers.dev',     // cash bids proxy (Cloudflare Worker)
  'gamma-api.polymarket.com',                // ag-odds source (CORS-restricted)
  'agsist-api.dnilgis.workers.dev',          // the subs worker (new home, Oct 22)
  'agsist-subs.dnilgis.workers.dev',         // the subs worker (old home, blocked Oct 21; kept while both may answer)
  'workers.dev',                             // any Cloudflare Worker
  'geocoding-api.open-meteo.com',            // ZIP lookup
  'api.weather.gov',                         // live NWS alerts: an expired warning must never come back from cache
  'agsist.com/e?',                           // the email front door: a signed link, never kept
  'data.rcc-acis.org',                       // NOAA daily data for Rain Print: big, dated by the day, never reused
];

// ── Install: open new cache (only the offline set, precacheOffline) ─
self.addEventListener('install', function(e) {
  self.skipWaiting(); // activate immediately, don't wait for old tabs to close
  e.waitUntil(precacheOffline());
});

// ── Activate: delete all old caches ──────────────────────────────
self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.map(function(key) {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(function() {
      return self.clients.claim(); // take control of all open tabs immediately
    })
  );
});

// ── Fetch: top-level safety net wraps every strategy ─────────────
// If ANYTHING inside the SW throws or rejects, fall through to
// plain network fetch — the SW must never break a request.
self.addEventListener('fetch', function(e) {
  // Skip non-GET requests
  if (e.request.method !== 'GET') return;

  // Skip chrome-extension and non-http requests
  if (!e.request.url.startsWith('http')) return;

  e.respondWith(
    (savedDataFeed(e.request.url) ? savedDataFetch(e.request, e.clientId) : handleFetch(e.request, e)).catch(function() {
      // Last resort: bypass SW entirely; if THAT fetch also fails (offline,
      // blocked tracker, flaky API) return a quiet 504 instead of rejecting —
      // an unhandled rejection here logs a console error on every failure.
      return fetch(e.request).catch(function(){
        return offlineFallback(e.request);
      });
    })
  );
});

// ── Strategy router ───────────────────────────────────────────────
function handleFetch(request, event) {
  var url = request.url;

  // Never cache data endpoints or external APIs — straight to network
  for (var i = 0; i < NEVER_CACHE.length; i++) {
    if (url.indexOf(NEVER_CACHE[i]) >= 0) {
      return fetch(request);
    }
  }

  // HTML pages → network first, cache fallback; client-side shells → recent
  // cached copy at once, refreshed in the background
  var accept = request.headers.get('accept');
  var isHTML = accept && accept.indexOf('text/html') >= 0;
  if (isHTML) {
    if (isShell(url)) return shellFirst(request, event);
    return networkFirst(request, event);
  }

  // Versioned assets (?v=N in URL) → cache first
  if (url.indexOf('?v=') >= 0) {
    return cacheFirst(request);
  }

  // Everything else → network first
  return networkFirst(request);
}

// ── Network first: try network, fall back to cache ────────────────
// `cache: 'no-cache'` forces the SW's fetch to revalidate with the server
// instead of silently accepting the browser's HTTP-cached copy (GitHub Pages
// sets max-age=600). Changed files come back fresh; unchanged files return a
// cheap 304. Without this, a fresh deploy stays invisible for up to 10 minutes
// even though this is "network first" — the staleness lived in the HTTP cache,
// not the SW cache.
// HTML pages (event given) do not wait on a stalled network for longer than
// NAV_TIMEOUT_MS when a cached copy exists: see navRace below.
function networkFirst(request, event) {
  var net = fetch(request, { cache: 'no-cache' }).then(function(response) {
    if (response && response.ok) {
      var copy = response.clone(); // clone SYNCHRONOUSLY before any await
      caches.open(CACHE_NAME).then(function(cache) {
        cache.put(request, copy).catch(function(){}); // swallow quota errors
      }).catch(function(){});
      return response;
    }
    // A 404/5xx used to be handed straight to the page. During a Pages deploy
    // blip that replaced a perfectly good cached page with an error shell, and
    // the reader saw a broken or near-empty page. Prefer the last good copy;
    // only pass the error through if we have nothing better.
    return caches.match(request).then(function(cached) {
      return cached || response;
    });
  }).catch(function() {
    return caches.match(request).then(function(cached) {
      return cached || Promise.reject('network-and-cache-both-failed');
    });
  });
  if (!event) return net;
  return navRace(net, function() { return caches.match(request); }, event);
}

// ── Navigations on a weak signal (2026-10-20) ─────────────────────
// A page with a cached copy used to show a blank screen for as long as a
// one-bar connection held the request open (25 s and more on a stalled
// response). Now the network gets NAV_TIMEOUT_MS; after that the cached copy
// is served if there is one, and the network answer, when it comes, still
// refreshes the cache (waitUntil keeps the worker alive for it). With no
// cached copy it keeps waiting on the network: a late page beats no page.
var NAV_TIMEOUT_MS = 3500;
function navRace(net, cachedCopy, event) {
  try { if (event && event.waitUntil) event.waitUntil(net.catch(function(){})); } catch (e) {}
  return new Promise(function(resolve, reject) {
    var done = false;
    var timer = setTimeout(function() {
      if (done) return;
      Promise.resolve(cachedCopy()).then(function(cached) {
        if (cached && !done) { done = true; resolve(cached); }
      }, function(){});
    }, NAV_TIMEOUT_MS);
    net.then(function(r) {
      if (!done) { done = true; clearTimeout(timer); resolve(r); }
    }, function(err) {
      if (!done) { done = true; clearTimeout(timer); reject(err); }
    });
  });
}

// ── Shells: recent cached copy at once, refresh behind it ─────────
// Only pages whose HTML holds no price, bid or date that the page does not
// re-read live on load. The town pages (cash-bids/<state>/<town>), the state
// pages, the daily archive and every page a workflow rewrites with baked
// numbers stay network first. The homepage carries a baked briefing, but the
// page re-reads daily.json on load and dates what it shows.
// A copy older than SHELL_MAX_AGE (the 10 minutes GitHub Pages lets the
// browser keep a page anyway) is not used: that request goes network first.
var SHELLS = ['/', '/index.html', '/markets', '/markets.html', '/cash-bids', '/cash-bids.html'];
var SHELL_MAX_AGE = 10 * 60 * 1000;
var STAMP = 'x-agsist-cached-at';

function isShell(url) {
  try {
    var u = new URL(url);
    if (u.origin !== self.location.origin) return false;
    return SHELLS.indexOf(u.pathname) >= 0;
  } catch (e) { return false; }
}

// Cache key without the query: /cash-bids?zip=50601 and /cash-bids share one
// shell (the page reads ?zip itself). Navigations are matched the same way.
function shellKey(request) {
  var u = new URL(request.url);
  u.search = ''; u.hash = '';
  return u.href;
}

function putShell(key, response) {
  // Re-wrap to stamp when it was stored; the body streams straight through.
  var h = new Headers(response.headers);
  h.set(STAMP, String(Date.now()));
  var stamped = new Response(response.body, { status: response.status, statusText: response.statusText, headers: h });
  return caches.open(CACHE_NAME).then(function(cache) {
    return cache.put(key, stamped).catch(function(){});
  }).catch(function(){});
}

function shellFirst(request, event) {
  var key = shellKey(request);
  return caches.match(key).then(function(cached) {
    var at = cached ? +cached.headers.get(STAMP) : 0;
    var fresh = cached && at && (Date.now() - at) < SHELL_MAX_AGE;
    var net = fetch(request, { cache: 'no-cache' }).then(function(response) {
      // only a full, same-site 200 replaces the shell (no redirects, no errors)
      if (response && response.status === 200 && response.type === 'basic' && !response.redirected) {
        putShell(key, response.clone());
      }
      return response;
    });
    if (fresh) {
      var bg = net.catch(function(){});   // background refresh; never affects this response
      try { if (event && event.waitUntil) event.waitUntil(bg); } catch (e) {}
      return cached;
    }
    var answer = net.then(function(response) {
      if (response && response.ok) return response;
      return cached || response;
    }, function() {
      return cached || caches.match(request).then(function(c) {
        return c || Promise.reject('network-and-cache-both-failed');
      });
    });
    // an old shell copy still beats a stalled network
    return navRace(answer, function() { return cached || caches.match(request); }, event);
  });
}

// ── Cache first: serve cache immediately, refresh in background ───
var CRITICAL = ['/components/styles.css', '/components/loader.js', '/components/header.html', '/components/footer.html'];
function isCritical(url) {
  for (var i = 0; i < CRITICAL.length; i++) { if (url.indexOf(CRITICAL[i]) >= 0) return true; }
  return false;
}

function serveCached(request, cached) {
  // Background refresh — fire and forget, never affects the response.
  fetch(request).then(function(response) {
    if (response && response.ok) {
      var copy = response.clone();
      caches.open(CACHE_NAME).then(function(cache) {
        cache.put(request, copy).catch(function(){});
      }).catch(function(){});
    }
  }).catch(function(){});
  return cached;
}

function cacheFirst(request) {
  return caches.match(request).then(function(cached) {
    // A truncated or empty cached stylesheet/loader takes the entire page down
    // — no styling, no nav, no footer, which reads as "the site is blank".
    // Refuse to serve a critical asset from cache if it looks wrong; go to the
    // network instead and let the fresh copy replace it.
    if (cached && isCritical(request.url)) {
      return cached.clone().text().then(function(body) {
        if (!body || body.length < 500) {
          return fetch(request).then(function(response) {
            if (response && response.ok) {
              var copy = response.clone();
              caches.open(CACHE_NAME).then(function(cache) {
                cache.put(request, copy).catch(function(){});
              }).catch(function(){});
            }
            return response;
          }).catch(function(){ return cached; });
        }
        return serveCached(request, cached);
      }).catch(function(){ return serveCached(request, cached); });
    }
    if (cached) {
      // Background refresh — fire and forget, never affects response
      fetch(request).then(function(response) {
        if (response && response.ok) {
          var copy = response.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(request, copy).catch(function(){});
          }).catch(function(){});
        }
      }).catch(function(){});
      return cached;
    }
    // No cache hit → network, then cache the result
    return fetch(request).then(function(response) {
      if (response && response.ok) {
        var copy = response.clone(); // clone SYNCHRONOUSLY before async
        caches.open(CACHE_NAME).then(function(cache) {
          cache.put(request, copy).catch(function(){});
        }).catch(function(){});
      }
      return response;
    });
  });
}

// ══ Offline: saved data copies and the offline page ═══════════════════
// Kept apart from the strategies above on purpose (merge-friendly). Hooks:
// install -> precacheOffline(); fetch -> savedDataFeed()/savedDataFetch()
// before handleFetch(); the last-resort catch -> offlineFallback().

var OFFLINE_PAGE = '/offline.html';
var SAVED_TIMEOUT_MS = 3000;

// url -> feed name the page's offline line uses (components/asof.js), or ''.
// Only these are saved; every other data file and API stays network only.
function savedDataFeed(url) {
  var u;
  try { u = new URL(url); } catch (err) { return ''; }
  if (u.origin === self.location.origin) {
    if (u.pathname === '/data/prices.json') return 'prices';
    if (u.pathname === '/data/daily.json') return 'daily';
    // the ARC/PLC calculator's program numbers and county files, so a saved
    // county page still runs offline (they change a few times a year); the
    // county list (nav.json), and the per-state math files behind "Show the math"
    // and the counter sheet (math/<ST>.json) and the crop pages' county lists (hub/<crop>.json)
    if (u.pathname === '/data/arc-plc.json' || /^\/data\/arc-plc\/((math\/)?[A-Z]{2}|nav|hub\/[a-z_]+)\.json$/.test(u.pathname)) return 'arc-plc';
    return '';
  }
  if (u.hostname === 'dnilgis.github.io' && u.pathname.indexOf('/bids/') === 0 && /\.json$/.test(u.pathname)) return 'bids';
  if (u.hostname === 'api.open-meteo.com' && u.pathname === '/v1/forecast') return 'weather';
  return '';
}

// Same-origin data is saved without its query (a ?t= buster must not make a
// new copy each load); outside data keeps its full URL (lat/lon, shard name).
function savedDataKey(request) {
  var u = new URL(request.url);
  if (u.origin === self.location.origin) return u.origin + u.pathname;
  return request.url;
}

// The data's own time, read from the file (never the save time, which would
// make an 8:46 price file read as "from 9:17"): the first of these top-level
// fields, or an Open-Meteo forecast's current.time placed by its UTC offset.
function dataTimeOf(text) {
  var j;
  try { j = JSON.parse(text); } catch (err) { return ''; }
  if (!j || typeof j !== 'object') return '';
  var keys = ['fetched', 'generated_at', 'generated', 'updated', 'pricedAt'];
  for (var i = 0; i < keys.length; i++) {
    var v = j[keys[i]];
    if (typeof v === 'string' && !isNaN(Date.parse(v))) return v;
  }
  if (j.current && typeof j.current.time === 'string' && typeof j.utc_offset_seconds === 'number') {
    var t = Date.parse(j.current.time + 'Z') - j.utc_offset_seconds * 1000;
    if (!isNaN(t)) return new Date(t).toISOString();
  }
  return '';
}

function saveDataCopy(key, response) {
  if (!response || !response.ok || response.type === 'opaque') return;
  var copy = response.clone();
  copy.text().then(function(body) {
    var h = new Headers(copy.headers);
    h.set('x-agsist-saved', new Date().toISOString());
    var dt = dataTimeOf(body);
    if (dt) h.set('x-agsist-data-time', dt);
    h.delete('content-encoding'); h.delete('content-length'); // the body is stored decoded
    return caches.open(CACHE_NAME).then(function(cache) {
      return cache.put(key, new Response(body, { status: copy.status, statusText: copy.statusText, headers: h }));
    });
  }).catch(function(){}); // quota or a body error: just no saved copy
}

function tellPage(clientId, feed, cached, reason) {
  if (!clientId || !self.clients || !self.clients.get) return;
  self.clients.get(clientId).then(function(c) {
    if (c) c.postMessage({ type: 'agsist-saved-data', feed: feed, reason: reason,
      dataTime: cached.headers.get('x-agsist-data-time') || '', saved: cached.headers.get('x-agsist-saved') || '' });
  }).catch(function(){});
}

// Network first; after SAVED_TIMEOUT_MS with no answer, or on a failure, the
// last good copy. A late network answer still refreshes the saved copy.
function savedDataFetch(request, clientId) {
  var feed = savedDataFeed(request.url), key = savedDataKey(request);
  return new Promise(function(resolve, reject) {
    var done = false, timer = null;
    function fromCache(reason, otherwise) {
      return caches.match(key).then(function(cached) {
        if (done) return;
        if (cached) { done = true; clearTimeout(timer); tellPage(clientId, feed, cached, reason); resolve(cached); }
        else if (otherwise) otherwise();
      }).catch(function() { if (!done && otherwise) otherwise(); });
    }
    timer = setTimeout(function() { fromCache('timeout'); }, SAVED_TIMEOUT_MS);
    fetch(request).then(function(response) {
      saveDataCopy(key, response);
      if (done) return;
      if (response && response.ok) { done = true; clearTimeout(timer); resolve(response); return; }
      fromCache('failed', function() { done = true; clearTimeout(timer); resolve(response); });
    }, function(err) {
      if (done) return;
      fromCache('failed', function() { done = true; clearTimeout(timer); reject(err); });
    });
  });
}

// Install: the offline page, plus the page that installed this worker and
// the price file. That first page loaded before the worker was in control,
// so without this a reader who opens the site once and loses signal has
// nothing saved. The page usually comes from the browser's HTTP cache (no
// second download). Best effort, capped at 5 s, never blocks install.
function precacheOffline() {
  var base = caches.open(CACHE_NAME).then(function(cache) {
    return cache.add(new Request(OFFLINE_PAGE, { cache: 'reload' }));
  }).catch(function(){});
  var extra = self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(list) {
    var jobs = list.map(function(c) {
      var u = new URL(c.url);
      if (u.origin !== self.location.origin) return null;
      return fetch(c.url, { credentials: 'same-origin' }).then(function(res) {
        if (!res || !res.ok || (res.headers.get('content-type') || '').indexOf('text/html') < 0) return;
        return caches.open(CACHE_NAME).then(function(cache) { return cache.put(c.url, res); });
      }).catch(function(){});
    });
    jobs.push(fetch(self.location.origin + '/data/prices.json').then(function(res) {
      saveDataCopy(self.location.origin + '/data/prices.json', res);
    }).catch(function(){}));
    return Promise.all(jobs);
  }).catch(function(){});
  var cap = new Promise(function(resolve) { setTimeout(resolve, 5000); });
  return Promise.all([base, Promise.race([extra, cap])]);
}

// Network and cache both failed. A page: its saved copy under any query
// (/cash-bids?zip=54728 -> /cash-bids), else the offline page.
function offlineFallback(request) {
  var quiet = new Response('', { status: 504, statusText: 'network unavailable' });
  if (request.mode !== 'navigate') return quiet;
  return caches.match(request, { ignoreSearch: true }).then(function(page) {
    return page || caches.match(OFFLINE_PAGE);
  }).then(function(page) { return page || quiet; }).catch(function() { return quiet; });
}
