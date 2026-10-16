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
 *   Navigations     → when network and cache both fail: offline.html
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
var CACHE_VERSION = 119;  // v119 2026-10-16: crop and weather fixes (planting date no maturity call, spray inversion networks and dicamba cutoff, urea rain advice and Montana citations, GDU freeze prefill, hail map phone table and 10 mile wording, conditions phone table and first year 2001); v118 2026-10-16: /fall-nitrogen and /harvest-or-wait (harvest-wait.js?v=1, harvest-wait-ui.js?v=1), menu CV 53; Fast Facts from UW A2809 (fast-facts.js?v=7, a2809.js?v=1, gdu-stages.js?v=1 on fast-facts and gdu-calculator); yield estimator 75/85/95 (yield-est.js?v=2), tools phone lines, scorecard where it stands; milk mailbox by area, what is priced in number to beat, harvest tracker chart and per-state RMA files, COT one crowding phrase (cot-analysis.js?v=2, cot-market.js?v=2), USDA .ics from the page list (home.js?v=4, home-season.js?v=5: fall nitrogen tile opens /fall-nitrogen); nutrient-removal.js?v=2, lrp.js and lrp-ui.js?v=3, lrp.css?v=2, hay-ams.js?v=1; v117 2026-10-16: cash lease notice to end a lease, foreign land and Atlas map libraries self-hosted (vendor/topojson-client-3.1.0, vendor/us-atlas-3.0.1), atlas-tenure.js?v=2, state rent pages with the NASS state average, Atlas county card compares farm real estate value; v116 2026-10-16: helper batch: futures one quote per contract (futures.js?v=13), cash bids delivery labels and Best basis color (cash-bids.js?v=5, cb-rank.js?v=4), grain bin eave rows (grain-bin.js?v=3), Rain Print engine v41 and county print v11, /rain-print-business (rp-business.js?v=1), retirement and anniversary gift pages, hay AMS weekly, LRP example, grain shrink dry-it-myself, ARC/PLC big-state tables on open; v115 2026-10-16: drought 2024 gap named on every since-2000 total, county drought this week box, saved national map (drought-monitor, farmland-atlas, field-scout.js?v=10); v114 2026-10-16: /combine-loss (combine-loss.js?v=1, combine-loss-ui.js?v=1), /commodity-loan (commodity-loan.js?v=1, commodity-loan-ui.js?v=1), menu CV 52; v113 2026-10-16: season fixes (manure-value.js?v=7, store-or-sell.js?v=5, cash-bids signup placement, fall copy); v112 2026-10-16: Rain Print engine v40 (arrival date under Pay, funnel events, buy-another prompt, business price shown, old-iPhone pay bar fix), rain-county-print.js v10; v111 2026-10-16: /cattle-auction-prices live (cattle-auction.js?v=1), Sale barn prices in the menu and footer (loader.js CV 51); v110 2026-10-16: /hay-prices page, Hay prices in the menu and footer (loader.js CV 50); v109 2026-10-16: cash bids audit fixes: outlier bids never Best, road miles, Read vs Posted, clean elevator names (cash-bids.js?v=4, cb-rank.js?v=3, storesell.js?v=7, store-or-sell.js?v=4); v108 2026-10-16: soybeans on grain EMC (grain-emc.js?v=4, grain-emc-ui.js?v=4), site search knows grain shrink and nutrient removal; v107 2026-10-16: /nutrient-removal page (nutrient-removal.js?v=1), Nutrient removal value in the menu and footer (loader.js CV 49); v106 2026-10-16: /grain-shrink page (grain-shrink.js?v=1, grain-shrink-ui.js?v=1), Grain shrink in the menu and footer (loader.js CV 48); v105 2026-10-16: fertilizer prices from the Kansas co-op posted prices Sig sent, one shared price file, hand dealer sheet and the USDA Illinois box removed (fert-sources.js?v=5, fert-coops.js?v=3, fast-facts.js?v=6, manure-value.js?v=6, home.js?v=3); v104 2026-10-15: Rain Print links written by hand (story links, county rain pages, emails) open with the 30-year normals and remarkable days on, the example prints redrawn with both (rain-print.js?v=39 on rain-print and rp-gift; v103 2026-10-15: menu and footer name the Harvest price tracker in full, under Markets (loader.js CV 47); v102 2026-10-15: /lrp redesign: calculator first (lrp.js?v=2, lrp-ui.js?v=2, new lrp.css?v=1 on lrp and lrp/record), the record and tests moved to /lrp/record; v101 2026-10-15: Rain Print opens with remarkable days on (rain-print.js?v=38 on rain-print and rp-gift; rain-county-print.js?v=8 loads the same engine); v100 2026-10-15: source sweep (fast-facts.js?v=4, grain-emc.js and grain-emc-ui.js?v=3, grain-bin.js?v=2), manure totals; v99 2026-10-15: manure value headline is all the nutrients in the manure (UW A2809 Table 9.2 totals) with the first-year part beside it (manure-value.js?v=4, manure-value.css?v=3 on manure-value and fast-facts); v98 2026-10-15: /lrp page (lrp.js?v=1, lrp-ui.js?v=1), LRP in the menu and footer (loader.js CV 46); v97 2026-10-15: Rain Print copy (one name per product, the promise, who makes it), the file says PNG and PDF, a gift day past the preview says January, favicons in the page (rain-print.js?v=37 on rain-print and rp-gift; rain-county-print.js?v=7); v96 2026-10-15: Rain Print buying path 2: a failed redraw keeps the print up, faster first draw, typing redraws after a pause, tick and Pay pinned in the review sheet, short link asked at every pay press, thank-you only names a print it is sure of, gift card fixes (rain-print.js?v=36, rp-short.js?v=5, rp-gift.js?v=4 on rain-print and rp-gift; rain-county-print.js?v=6); v95 2026-10-15: Rain Print phone scroll after Draw, county-link town from the station, product pick kept after Back (rain-print.js?v=35, rain-county-print.js?v=5); v94 2026-10-15: /grain-emc page (grain-emc.js?v=2, grain-emc-ui.js?v=2), Grain EMC in the menu and footer (loader.js CV 45); v93 2026-10-15: Rain Print serial reads "No. 0001" only (Sig initials each print by hand in pencil), hand-initialed line in the box lists and size FAQ (rain-print.js?v=34 on rain-print, rp-gift and rain-county-print.js?v=4); v92 2026-10-15: GDU calculator black-layer date, cash lease state notes, storage floors, foreign land trend label, presell revenue guarantee wording, tariffs timeline, fertilizer USDA box single price (fert-sources.js?v=2); v91 2026-10-15: Fast Facts N:corn race fixed and delayed-price labels (fast-facts.js?v=3), homepage trend label and Set ZIP cell (home-yield.js?v=3), tools hub order, COT page scripts split out with the market panel on demand, basis map on demand, fertilizer USDA series box, milk and cattle settled closes; v90 2026-10-15: Fast Facts lime cost prices the product chosen (fast-facts.js?v=2); store-or-sell counts months from today and names a farther elevator (storesell.js?v=6, store-or-sell.js?v=3); break-even county fill and crop year; rent for your ground on state rent pages; atlas 14-yr trend label (rent-calc.js?v=2); Rain Print links on county rain pages; v89 2026-10-15: cash bids: delivery label never wraps, basis color key, best after the drive line (cash-bids.js?v=3); town pages: Basis since June box (cb-basis-hist.js?v=1); conditions one week and harvest by state, yield estimator sites (yield-est.js); spray and hail map fixes; futures titles take only a settled close, futures.js?v=12, harvest tracker and What's Priced In fixes; v88 2026-10-15: farm bill next 90 days and operation picker (farm-bill.js?v=1), grain bin dealer setting and test weight (grain-bin.js?v=1), PRF pick card and dead ends (prf-optimize-ui.js), ARC/PLC answer first (arc-plc-simple.js, CALC_V 10), manure first-year wording and test box (manure-value.js?v=3); v87 2026-10-15: plain station words on county rain pages and the Rain Print promo line (rain-print-promo.js content); v86 2026-10-15: Rain Print thumbnail redrawn from the real 2012 Ames example (the image cache is cleared by this bump); gauge page says the nearest weather station; v85 2026-10-15: rain-print.js?v=33 (example print + Your words polish together); v84 2026-10-15: Rain Print Mark a day on one line per day, up to five marked days with a note under a day the art cannot place, one plain maker line, one text width under the tool (rain-print.js?v=32 on rain-print and rp-gift); v83 2026-10-15: county rain pages draw the year so far as a Rain Print from data/rain/daily (rain-county-print.js?v=1, rain-county.css?v=4); v82 2026-10-15: Rain Print example print (2012 Ames, real NOAA data) in the empty frame until the live draw (rain-print.js?v=32 on rain-print and rp-gift); v81 2026-10-15: Rain Print remarkable days print their dates (a day, or a stretch's range) in gray after the words, the biggest rain's date the same way, the foot line says "Gaps: N days with no report" only past 3 missing days, and up to five marked days (rain-print-art.js?v=11 on rain-print and rp-gift); v80 2026-10-15: Rain Print plain station words (rain-print.js?v=31); v79 2026-10-15: Rain Print picks the nearest station with rain and snowfall records (rain-print.js?v=30); v78 2026-10-15: print redesign (Rain Print print design (panel 4): the name is the biggest words, dates on the line, Roots scales fit the year, one foot line, snowfall note (rain-print-art.js?v=9 on rain-print and rp-gift)); Rain Print three-step flow: one picker, a review sheet before Stripe in the same tab, a paid page, example words as hints only, month and day lists (rain-print.js?v=28 on rain-print and rp-gift); marked days: the date after the words on the print, Mark a day rows numbered with Remove and messages under their own row (rain-print-art.js?v=10, rain-print.js?v=29 on rain-print and rp-gift); the station pick takes one that records snowfall too, a few miles farther, and the station list says rain and snow or rain only (rain-print.js?v=30 on rain-print and rp-gift); v77 2026-10-15: page audit fixes across about 60 pages (copy, stale facts, Barchart mentions gone, farm bill status, manure wording); v76 2026-10-14: manure value is the value of all the manure: calculator drops the buyer and seller boxes, hauling and the fair range, and adds the whole field (manure-value.js?v=2, manure-value.css?v=2 on manure-value and fast-facts); v75 2026-10-14: Rain Print previews carry the standard code and make no short link on a redraw; order files, checkout and the order form make one at the press (rain-print.js?v=27 and rp-short.js?v=4 on rain-print and rp-gift); v74 2026-10-14: Rain Print standard code on every preview, the print's own short link only on the maker's order files, Test print PDF (standard code) (rain-print.js?v=26 on rain-print and rp-gift; qr.js?v=10 on rain-print, rp-gift, sponsor-kit, prf-sponsor-kit, arc-plc/sheet); v73 2026-10-14: /manure-value page (manure-value.js?v=1, manure-value.css?v=1, shared with fast-facts), Fast Facts page script moved to fast-facts.js?v=1, fast-facts on util.js?v=19, menu and footer gain Manure value and Fast Facts (loader.js CV 44); v72 2026-10-14: Rain Print panel 3 fixes (rain-print.js?v=25, rain-print-art.js?v=8, rain-print-records.js?v=3, rp-logo.js?v=2, rp-short.js?v=3 on rain-print and rp-gift; form-post.js?v=4 on elevators, list-your-elevator, sponsor-report, farmland-atlas, prf-sponsor, rain-print), privacy page, rain gauge page, gifts page, styles.css?v=24 and loader.js?v=19 sitewide (both changed since their last bump); v71 2026-10-14: PRF sponsor offer moved up to a slim band under the opening answer on /prf, the state pages and the county pages (prf-sponsor.js?v=3, prf.css?v=6); v70 2026-10-14: Rain Print logo upload (rp-logo.js?v=1, rain-print-art.js?v=7, rain-print.js?v=24 on rain-print and rp-gift); v69 2026-10-14: Rain Print "Your print" rebuilt as a full-window view with the print fitted and one side panel (rain-print.js?v=23 on rain-print and rp-gift); v68 2026-10-14: Rain Print order fixes: ?d=RPS- references open, example words explained under the Order button, checkout note under the tapped button, proof orders what it showed, label counters, new share image and thumb (rain-print.js?v=22, rp-short.js?v=2 on rain-print and rp-gift; rain-print-promo.js?v=4 on index and gifts-for-farmers); v67 2026-10-14: rain gauge page rebuilt with the prototype design (charcoal renders in img/rain-gauge/, old concept images removed, waitlist top and bottom, no new scripts); v66 2026-10-14: Rain Print digital file needs no proof, ships within 3 business days, 8 x 10 gift card with a preview of the print so far (rain-print.js?v=21, rain-print-art.js?v=6, rp-gift.js?v=3 on rain-print and rp-gift); v65 2026-10-14: Rain Print polish: NOAA daily data (data.rcc-acis.org) never cached; forms give up on a silent worker after 12 s (form-post.js?v=3 on elevators, list-your-elevator, sponsor-report, farmland-atlas, prf-sponsor, rain-print); gift card wording (rp-gift.js?v=2 on rp-gift and rain-print); Rain Print page, engine and art fixes (every Rain Print script's ?v bumped once in rain-print.html); v64 2026-10-14: county rain polish (rain-county.css?v=3), prose keeps proportional figures (styles.css); v63 2026-10-13: Rain by county in the menu and footer (loader.js CV 43); v62 2026-10-13: county rain pages (rain-county.css), Rain Print finds the town from a county page link (rain-print.js?v=18); v61 2026-10-13: gifts for farmers page, homepage Christmas card links to it (rain-print-promo.js?v=3); v60 2026-10-13: Rain Print labels never collide (rain-print-art.js?v=3); v59 2026-10-13: Rain Print page steps, print beside the name and dates, up-close order row (rain-print.js?v=17); v58 2026-10-13: /prf-sponsor page and form (prf-sponsor.js?v=2, prf.css?v=5, prf-sponsor-page.js); v57 2026-10-13: PRF state sponsors (prf-sponsor.js, prf.js?v=5, prf.css?v=4), List your elevator (list-elevator.js); v56 2026-10-13: Rain Print own-area first print, example to trim, zoom (rain-print.js?v=16), bid alert box (cb-signup.js?v=2), elevator portal (post, elev-admin), portal elevator info on cash bids (cash-bids.js?v=2); v55 2026-10-13: Rain Print and rain gauge in the menu and footer, homepage card and related-page lines (loader.js CV 42, rain-print-promo.js?v=2), /rain-gauge; v54 2026-10-13: Rain Print business prices delivered, minimum 5, ships flat, reprint and refund terms (rain-print.js?v=14); v53 2026-10-13: Rain Print launch fixes and gift card redeem (rain-print.js?v=13, rain-print-art.js?v=2, rp-gift.js?v=1); v52 2026-10-13: Rain Print R1 Staircase and R2 Roots (rain-print.js?v=12, rain-print-art.js, new Rain Print fonts); v51 2026-10-13: futures chart loads on scroll, cash-bids page script file, one fetch per data file (util.js?v=19); v50 2026-10-12: craft pass (price, basis and contract formats, agronomy tools, hail, shared styles, homepage script file, offline mode on every loader page); v49 2026-10-12: menu and footer icons complete; v48 2026-10-11: signup asks take an optional ZIP, rent and ARC/PLC notice asks (signup-ask.js?v=6, loader.js CV 39); v47 2026-10-11: menu says Harvest price, wheat deferred card rolls, polish pass; v46 2026-10-11: unsold sponsor slots show nothing (footer, ribbons, homepage, daily), Rain Print sample and promo; v45 2026-10-11: email bar off the briefing archive, sponsor pages and worksheets (signup-ask.js?v=5, loaded by loader.js?v=18, which this clears); v44 2026-10-10: the menu grouped by question, shorter phone drawer; v43 2026-10-10: one price formatter, shared futures script, store-or-sell; v42 2026-10-10: ARC or PLC math loads on open and works offline, one shared counter sheet; v41 2026-10-09: ARC or PLC short-answer county pages and counter sheets; v40 2026-10-09: ARC/PLC calculator works offline on saved pages; v39 2026-10-09: ARC or PLC in the menu, footer and homepage; v38 2026-10-09: ARC/PLC decision tiers; v37 2026-10-09: ARC/PLC calculator; v36 2026-10-09: plainer site copy; v35 2026-10-09: card tokens, spray states, page titles; v34 2026-10-09: one look, variable fonts (old font files removed); v33 2026-10-09: no-jump layout, loading states; v32 2026-10-09: menu and footer change; v31 2026-10-09: instant pages, offline copies of key data; v30 2026-10-09: search, My elevators, tap targets; v29 2026-10-09: em-dash cleanup, link fixes, homepage coverage counts file; v28 2026-10-08: phone audit 2 (contrast, 16px inputs, 40px taps, footer pill); v27 2026-10-08: styles.css phone fixes (16px inputs so iOS stops zooming, .sr-only, light-mode change chips); was: v26 (2026-08-15 nav-panel visibility fix)
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
  'workers.dev',                             // any Cloudflare Worker
  'geocoding-api.open-meteo.com',            // ZIP lookup
  'api.weather.gov',                         // live NWS alerts: an expired warning must never come back from cache
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
    return networkFirst(request);
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
function networkFirst(request) {
  return fetch(request, { cache: 'no-cache' }).then(function(response) {
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
    return net.then(function(response) {
      if (response && response.ok) return response;
      return cached || response;
    }, function() {
      return cached || caches.match(request).then(function(c) {
        return c || Promise.reject('network-and-cache-both-failed');
      });
    });
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
