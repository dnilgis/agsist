/* bids-network.js — read the live elevator scrape, in the browser.
 *
 * WHY THIS EXISTS
 *
 * dnilgis/bids reads 1,096 elevator boards every ten minutes, all day. Until
 * now that work reached agsist only through fetch_bids.yml, which pulls
 * Barchart, merges the scrape into it and commits data/bids.json roughly twice
 * an hour. Every cash surface on the site except the ZIP search on /cash-bids
 * read that committed file.
 *
 * So when fetch_bids.yml died on 2026-09-23, the scrape kept running and none
 * of it reached a reader. The file froze for 27 hours carrying 889 rows, 250
 * of them from our own boards, while those same boards were being read every
 * ten minutes and published. Sig, on being told:
 *
 *     "wtf i thought that bids repo was scraping continusly throught the day
 *      and contiunously feed ing agsist the most recent data"
 *
 * It was. Nothing was carrying it the last mile. This is the last mile.
 *
 * WHAT IT RETURNS, AND WHY THAT SHAPE
 *
 * snapshot() hands back an object shaped exactly like data/bids.json --
 * { fetched, bids[], zip_grid[] } -- so a page swaps its source and keeps its
 * renderer. The cash card on the three futures pages carries a lot of hard-won
 * judgement about what to show and what to withhold, and none of that is worth
 * re-deriving against a new payload shape.
 *
 * ONE REQUEST, NOT ONE PER ELEVATOR. data/merged-index.json is 102 KB gzipped
 * and carries every place's coordinates and, since 2026-09-24, its `now` --
 * the nearest still-open delivery window per crop, decided in the merge where
 * the delivery data lives.
 *
 * `now` IS NOT `best`, AND THE DIFFERENCE IS THE WHOLE POINT. `best` is the
 * top cash across every period a place quotes, which on 2026-09-22 was a 2027
 * contract for 1,467 of them. scripts/fetch_bids.py already refuses to select
 * from it for that reason -- "the index alone will not do either" -- and
 * walks the 8 MB flat file instead. A browser cannot do that. `now` is what
 * makes one 102 KB request enough.
 *
 * IT NEVER REJECTS AND IT NEVER HANGS. Every path resolves, with null meaning
 * "use whatever you were going to use". A cash card that disappears because a
 * CDN was slow is worse than a cash card reading a file from this morning.
 */
(function () {
  'use strict';

  var BASE = 'https://dnilgis.github.io/bids/';
  /* A HAULING RADIUS, NOT A COVERAGE ONE, AND THE DATA SAYS THE CHOICE IS FREE.
     Counted against the live index for twelve real ZIPs, places carrying a
     usable bid:

         Chetek WI  4 within 50mi, 10 within 75, 27 within 100
         Mankato MN 28 / 45 / 74      Abbyville KS 34 / 54 / 69
         Madison WI  8 / 21 / 54      Champaign IL 21 / 51 / 95
         Lubbock TX  0 / 0 / 0        Fresno CA 0 / 0 / 0
         Bozeman MT  0 / 0 / 0        Syracuse NY 0 / 0 / 0

     Inside the footprint fifty miles is already more than a card needs;
     outside it no radius helps at all and the reader falls back to Barchart
     either way. So the number is not buying coverage, and it should be the
     distance a person would actually drive a load. Seventy-five.

     A reader with nothing inside it gets null and the page falls back to the
     committed file, which has its own national branch and its own words for
     saying a bid is not near them. */
  var MAX_MILES = 75;
  var MAX_PLACES = 40;
  /* THE WHOLE CALL, NOT EACH REQUEST. Two hundred milliseconds of budget spent
     three times is still a card that arrives late. */
  var DEADLINE_MS = 4000;

  var indexCache = null;      // one fetch per page view, shared by every caller
  var zipCache = {};

  function log() {
    try {
      if (window.location.search.indexOf('netdebug') >= 0)
        console.log.apply(console, ['[bids-net]'].concat([].slice.call(arguments)));
    } catch (e) {}
  }

  function get(path) {
    return new Promise(function (resolve) {
      var done = false;
      var t = setTimeout(function () {
        if (!done) { done = true; log('timeout', path); resolve(null); }
      }, DEADLINE_MS);
      fetch(BASE + path, { cache: 'default' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          if (!done) { done = true; clearTimeout(t); resolve(j); }
        })
        .catch(function () {
          if (!done) { done = true; clearTimeout(t); log('failed', path); resolve(null); }
        });
    });
  }

  function miles(lat1, lon1, lat2, lon2) {
    var R = 3958.8, d = Math.PI / 180;
    var a = Math.sin((lat2 - lat1) * d / 2) * Math.sin((lat2 - lat1) * d / 2) +
            Math.cos(lat1 * d) * Math.cos(lat2 * d) *
            Math.sin((lon2 - lon1) * d / 2) * Math.sin((lon2 - lon1) * d / 2);
    return R * 2 * Math.asin(Math.sqrt(a));
  }

  /* A ZIP TO A COORDINATE WITHOUT SHIPPING THE WHOLE TABLE. 41,917 centroids
     is 334 KB gzipped, which down a phone on a gravel road is the wrong trade
     to answer one question. The table is sharded on the first two digits:
     54728 asks for zips/54.json, which is about 5 KB. */
  function zipCoord(zip) {
    var z = String(zip == null ? '' : zip).trim().slice(0, 5);
    if (!/^\d{5}$/.test(z)) return Promise.resolve(null);
    var k = z.slice(0, 2);
    if (zipCache[k]) {
      return zipCache[k].then(function (tbl) { return readZip(tbl, z); });
    }
    zipCache[k] = get('data/zips/' + k + '.json');
    return zipCache[k].then(function (tbl) { return readZip(tbl, z); });
  }

  function readZip(tbl, z) {
    if (!tbl) return null;
    var p = tbl[z];
    if (!Array.isArray(p) || p.length < 2) return null;
    var lat = Number(p[0]), lon = Number(p[1]);
    if (!isFinite(lat) || !isFinite(lon)) return null;
    /* 0,0 IS THE ATLANTIC. The builder drops these, but a coordinate meaning
       "we did not know" must never travel as one meaning Ghana. */
    if (lat === 0 && lon === 0) return null;
    return { lat: lat, lon: lon };
  }

  function index() {
    if (!indexCache) indexCache = get('data/merged-index.json');
    return indexCache;
  }

  /* A STABLE JOIN KEY THAT CANNOT BE READ AS A POSTCODE.
     The cash card matches a row to a grid entry on `sourceZip` or `zip`, and
     346 of the 1,002 places have no ZIP on file. A synthetic key keeps the
     join working; the "net:" prefix means it can never collide with a real
     ZIP, can never equal the reader's own, and can never be printed as one by
     accident. Nothing displays it. */
  function keyFor(p) {
    return 'net:' + String(p.place || (p.operator + '|' + p.city + '|' + p.state))
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 48);
  }

  /* THE WORDS THAT GO ON THE CARD.
   *
   * Measured on the live index: of the 933 places a card could show, six carry
   * a city that already ends in its own state code -- "Aztalan Jefferson, WI"
   * in Wisconsin, which appended reads "Aztalan Jefferson, WI, WI" -- six
   * carry a city identical to the operator's name, so the card would print
   * "Turon Mill & Elevator, Inc." twice, and eleven carry a city long enough
   * to push the line. Small numbers, and every one of them lands in front of
   * somebody who lives there.
   *
   * Nothing is invented and nothing is corrected: a repeat is not printed
   * twice, and a state code the city already carries is not added again. The
   * underlying directory rows are the bids repo's to fix.
   */
  function placeLabel(p) {
    var city = String(p.city == null ? '' : p.city).trim();
    var st = String(p.state == null ? '' : p.state).trim();
    var op = String(p.operator == null ? '' : p.operator).trim();
    if (city && op && city.toLowerCase() === op.toLowerCase()) city = '';
    if (!city) return st ? (op ? op + ', ' + st : st) : op;
    /* "Aztalan Jefferson, WI" + ", WI" */
    var tail = city.match(/,\s*([A-Za-z]{2})\s*$/);
    if (tail && st && tail[1].toUpperCase() === st.toUpperCase()) return city;
    return st ? city + ', ' + st : city;
  }

  /* One place, one crop, in the row shape data/bids.json uses.
   *
   * `verified` IS DELIBERATELY ABSENT. In data/bids.json that flag is
   * fetch_bids.py's cohort test -- cash minus basis against every other
   * facility quoting the same contract. These rows have not been through it;
   * they have been through the bids repo's own guards instead, which refuse a
   * whole board rather than a row, plus the freshness gate in `now` itself.
   * The card's rule is that a row with no `verified` field is allowed through,
   * written so an older payload could not empty the card, and it is the right
   * answer here too. Writing `verified: true` would be claiming a check that
   * was never run.
   */
  function rowFor(p, crop, n, dist, anchor) {
    var k = keyFor(p);
    return {
      facility: p.operator || '', branch: p.branch || null,
      city: p.city || '', state: p.state || '',
      zip: p.zip || k,
      /* sourceZip IS "THE GRID ZIP WHOSE RADIUS QUERY RETURNED THIS ROW", and
         that is not a shape borrowed loosely -- it is what the field means in
         data/bids.json, where Barchart's query runs around each of 50 sample
         ZIPs. Here the radius query runs around the READER, so every row in a
         snapshot carries the reader's anchor.
         It matters because the card's local test is `sourceZip === z || zip
         === z` against the single nearest grid entry. Stamping each row with
         its own place made every elevator except the very nearest one look
         national: a reader at Chetek was shown a corn bid at Thorp, 50 miles
         away, labelled "not near you - highest checked bid in the sample",
         while a bid at Bloomer 17 miles off sat in the same payload. Every row
         here is inside the radius by construction; none of them is the
         national fallback that sentence was written for. */
      sourceZip: anchor || p.zip || k,
      lat: p.lat, lon: p.lon,
      commodity: n.commodity || crop,
      cashPrice: n.cash, basis: n.basis,
      basisCents: n.basisCents,
      delivery: n.delivery || '', period: n.period || '',
      distance: dist == null ? null : Math.round(dist * 10) / 10,
      source: 'network', via: 'scrape'
    };
  }

  /* Everything within MAX_MILES, nearest first, as { fetched, bids, zip_grid }.
     Resolves null when there is nothing to say. */
  function snapshot(lat, lon, opts) {
    opts = opts || {};
    var radius = opts.radiusMi || MAX_MILES;
    if (!isFinite(lat) || !isFinite(lon)) return Promise.resolve(null);
    return index().then(function (idx) {
      if (!idx || !idx.places || !idx.places.length) return null;
      var near = [];
      for (var i = 0; i < idx.places.length; i++) {
        var p = idx.places[i];
        if (typeof p.lat !== 'number' || typeof p.lon !== 'number') continue;
        /* A PAGE THAT DRAWS "$" IN FRONT OF A NUMBER CANNOT SHOW CAD. Four of
           the 1,002 places publish in Canadian dollars and they are correct to.
           There is no exchange rate in this repository and inventing one is
           worse than leaving the elevator out -- the same call
           scripts/fetch_bids.py makes on the same rows. */
        if ((p.currency || 'USD') !== 'USD') continue;
        if (!p.now) continue;
        var d = miles(lat, lon, p.lat, p.lon);
        if (d > radius) continue;
        near.push({ p: p, d: d });
      }
      if (!near.length) return null;
      near.sort(function (a, b) { return a.d - b.d; });
      if (near.length > MAX_PLACES) near.length = MAX_PLACES;

      /* The nearest place is the anchor: the grid entry findNearestGridZip
         will land on, and therefore the one the card measures "local" from. */
      var anchorKey = near[0].p.zip || keyFor(near[0].p);
      var bids = [], grid = [];
      for (var j = 0; j < near.length; j++) {
        var q = near[j].p, dist = near[j].d, k = keyFor(q);
        grid.push({
          zip: q.zip || k, lat: q.lat, lng: q.lon,
          label: placeLabel(q)
        });
        for (var crop in q.now) {
          if (!Object.prototype.hasOwnProperty.call(q.now, crop)) continue;
          var n = q.now[crop];
          if (!n || n.cash == null) continue;
          bids.push(rowFor(q, crop, n, dist, anchorKey));
        }
      }
      if (!bids.length) return null;
      log(bids.length + ' bids at ' + near.length + ' places within ' + radius + 'mi');
      return {
        fetched: idx.generated || null,
        source: 'network',
        /* THE COORDINATE THE SEARCH WAS RUN FROM, handed back so the card can
           do its own distance arithmetic. getUserLoc() returns {source:'saved',
           zip} with no coordinate whenever the reader has saved a ZIP, and the
           card's distance label, its nearest-grid lookup and its local test all
           need lat/lng. Without this it fell through to "not near you" for any
           reader whose ZIP is not itself an elevator's ZIP. `lng` not `lon`:
           the card reads lng. */
        origin: { lat: lat, lng: lon, zip: opts.zip || null },
        places: near.length,
        nearestMiles: Math.round(near[0].d * 10) / 10,
        zip_grid: grid,
        bids: bids
      };
    }).catch(function () { return null; });
  }

  /* The same thing when all you have is a ZIP, which is what getUserLoc()
     returns whenever the reader has saved one. */
  function snapshotForZip(zip, opts) {
    var o = {};
    for (var k in (opts || {})) if (Object.prototype.hasOwnProperty.call(opts, k)) o[k] = opts[k];
    o.zip = zip;
    return zipCoord(zip).then(function (c) {
      return c ? snapshot(c.lat, c.lon, o) : null;
    }).catch(function () { return null; });
  }

  /* Whichever of the two the caller can offer, preferring a real coordinate.
     Takes the object getUserLoc() already returns on every futures page. */
  function snapshotForLoc(loc, opts) {
    if (!loc) return Promise.resolve(null);
    if (loc.lat != null && (loc.lng != null || loc.lon != null))
      return snapshot(Number(loc.lat), Number(loc.lng != null ? loc.lng : loc.lon), opts);
    if (loc.zip) return snapshotForZip(loc.zip, opts);
    return Promise.resolve(null);
  }

  window.AGSIST_BIDS_NET = {
    snapshot: snapshot,
    snapshotForZip: snapshotForZip,
    snapshotForLoc: snapshotForLoc,
    zipCoord: zipCoord,
    placeLabel: placeLabel,
    miles: miles,
    BASE: BASE
  };
})();
