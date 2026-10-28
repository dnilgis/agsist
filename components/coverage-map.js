/* The elevator coverage map on /list-your-elevator#coverage (its own page, /elevators, until
   Oct 22, 2026). Loaded by the page once a reader nears the map, after Leaflet. */
/* THE COVERAGE MAP.
 *
 * Leaflet 1.9.4 from cdnjs, already used by five other pages on this site,
 * so no new dependency and no new host. There is no tile service: the ground
 * is data/us-states.geo.json, drawn from this repository.
 *
 * IT FAILS HONESTLY. If Leaflet does not load, or the data does not, the map
 * replaces itself with one sentence and every other thing on this page is
 * untouched. A coverage page that breaks silently is worse than one that says
 * it broke.
 *
 * CANVAS, NOT AN SVG CIRCLE EACH. 2,929 SVG dots is what makes a Leaflet map
 * crawl on a phone in a field.
 */
(function () {
  var el = document.getElementById('cov-map');
  if (!el) return;
  var fallback = document.getElementById('cov-fallback');
  /* THE COUNTS DO NOT NEED THE MAP. They are read from the same file and set
     here, before Leaflet is even checked for, so a blocked map library leaves
     the numbers in place. Before this, the counts were set only inside the map
     path and a blocked Leaflet left them as dashes under a sentence saying
     they were unaffected. */
  var covData = fetch('/data/elevator-coverage.json', { cache: 'no-cache' })
    .then(function (r) { if (!r.ok) throw 0; return r.json(); });
  function set(id, v) {
    var e = document.getElementById(id);
    if (e) e.textContent = (v == null ? '-' : v.toLocaleString());
  }
  function paintCounts(d) {
      var n = d.counts || {};
      set('cov-n-read', n.read); set('cov-n-quiet', n.quiet); set('cov-n-known', n.known);
      /* r7-claim: the claim section prints the same counts. */
      try { window.__agCov = d; if (window.__agClaimNet) window.__agClaimNet(d); } catch (e) {}

      /* A MAP THAT QUIETLY OMITS WHAT IT COULD NOT PLACE TELLS THE READER THE
         GAP IS SMALLER THAN IT IS. So the unplaced are printed under it. */
      var foot = document.getElementById('cov-foot');
      if (foot) {
        /* One line: the total, and why a pin can hold more than one. The
           unplaced handful and the build timestamp are ours to watch, not the
           reader's to read. */
        foot.textContent = (n.elevators != null ? n.elevators.toLocaleString() + ' elevators tracked. ' : '') +
          (n.unplaced ? n.unplaced.toLocaleString() + ' could not be placed on the map and are not drawn. ' : '') +
          'Several share a town centre, so one pin can cover more than one. Click to see what is there.';
        /* THE SAMPLE, BESIDE THE CLAIM. Green counts what answered one pass of
           our readers; the fleet is bigger and steadier than any one pass. A
           page that printed only the first read 599 on a day it had 935. */
        if (n.readers != null) {
          var when = (d.directoryGenerated || '').slice(0, 16).replace('T', ' ');
          foot.textContent += ' We have readers for ' + n.readers.toLocaleString() +
            ' of them; ' + (n.read || 0).toLocaleString() + ' answered the pass this map ' +
            'was built from' + (when ? ' (' + when + ' UTC)' : '') + '.';
        }
      }

  }
  var countsOk = false;
  covData.then(function (d) { if (d && d.counts) { paintCounts(d); countsOk = true; } }).catch(function () {
    /* say it, in the line under the map, with a retry that fetches the file again */
    var f = document.getElementById('cov-foot');
    if (!f) return;
    /* an early failure can beat the deferred states kit: run when it lands */
    if (!window.AgStates) { (window.AgStatesQ = window.AgStatesQ || []).push(function () { failBox(); }); return; }
    failBox();
    function failBox() { (function fail() {
      AgStates.error(f, { inline: true, msg: 'The coverage counts didn\u2019t load.', retry: function () {
        fetch('/data/elevator-coverage.json', { cache: 'no-cache' })
          .then(function (r) { if (!r.ok) throw 0; return r.json(); })
          .then(function (d) { if (d && d.counts) { f.innerHTML = ''; paintCounts(d); countsOk = true; } else fail(); })
          .catch(fail);
      } });
    })(); }
  });
  var gaveUp = false;
  function giveUp() {
    if (el) el.style.display = 'none';
    if (fallback) fallback.hidden = false;
    var hint = el && el.parentNode && el.parentNode.querySelector('.el-map-hint');
    if (hint) hint.style.display = 'none';
    if (gaveUp) return;
    gaveUp = true;
    /* Only say the counts are fine if they are. */
    covData.then(function (d) {
      if (fallback && d && d.counts) fallback.textContent = 'The coverage map could not load just now. The counts below are unaffected.';
    }).catch(function () {});
  }
  if (typeof L === 'undefined') return giveUp();

  /* These sit on dark_all or on voyager, so they carry a thin dark halo
     rather than relying on the basemap being pale. A green dot that vanishes
     over a green field is not a map. */
  var COLOUR = { read: '#4ade80', quiet: '#fbbf24', known: '#9ca3af' };
  var EDGE = 'rgba(6,10,9,.85)';
  var RADIUS = { read: 4.2, quiet: 4.2, known: 2.6 };
  /* Grey is drawn smaller and underneath on purpose: it is the larger number
     by far, and at full weight it buries the green the page exists to show.
     Smaller, not hidden — the whole argument is that it is visible. */
  var ORDER = ['known', 'quiet', 'read'];

  covData
    .then(function (d) {
      if (!d || !d.places || !d.places.length) throw 0;

      var map = L.map(el, {
        preferCanvas: true,
        /* SCROLL TO ZOOM, but only once the map has been clicked. A map that
           grabs the wheel as you scroll past it hijacks the page; one that
           needs a button to zoom is not a map. Click it and it behaves like
           every other map you have used. */
        scrollWheelZoom: false,
        zoomControl: true, attributionControl: true,
        worldCopyJump: true, zoomSnap: 0.5, wheelDebounceTime: 25,
        /* ZOOM STOPS AT 9. The tile version allowed 16, which put a pin on a
           specific building — and about 73% of these pins (81% of elevators) are
           town or county centroids. Zoom 9 is a county-sized
           view, which is as precise as this data honestly gets. */
        minZoom: 3, maxZoom: 9
      }).setView([41.5, -93.5], 4.5);
      try { window.__covmap = map; } catch (e) {}
      map.on('click focus', function () { map.scrollWheelZoom.enable(); });
      map.on('mouseout', function () { map.scrollWheelZoom.disable(); });

      /* TWO REAL BASEMAPS, FOLLOWING THE SITE'S OWN THEME.
         Both carry roads, water and place names —
         light_all, which was here, is a near-white slab with almost nothing on
         it. Same host as the other five maps on this site, free with
         attribution, no key.
         Esri's satellite imagery is the obvious alternative and is not
         available: Esri state the tile service needs an ArcGIS licence and is
         not for commercial use. */
      /* THE STYLE NAMES ARE THE RASTER PATHS, NOT THE VECTOR NAMES.
         This shipped as 'dark_matter' and 'voyager' and the map had NO
         BASEMAP AT ALL -- 4,581 dots on a black void, with the CARTO
         attribution underneath them implying tiles were there. Measured
         2026-09-05:

             /dark_matter/4/4/6.png          404
             /voyager/4/4/6.png              404
             /dark_all/4/4/6.png             an image
             /rastertiles/voyager/4/4/6.png  an image

         `dark_matter` and `voyager` are what CARTO calls these basemaps in its
         VECTOR styles. The raster service uses different paths, and a wrong one
         is a 404 per tile -- silent, because Leaflet draws nothing and leaves
         the attribution in place. */
      /* NO TILE VENDOR. The basemap is one file in this repository.

         CARTO changed terms and started serving a watermarked "API KEY
         REQUIRED" tile in place of the map. Nothing here noticed: the tiles
         returned 200, so the tileerror guard below never fired and
         basemap-checks went green while the live page was defaced. Esri's
         keyless endpoints are the same bet one repricing behind — their own
         staff will not state the licence for commercial use of them.

         Measured before choosing: the 51 US state outlines, simplified with
         topology preserved, are 36KB raw and 10KB gzipped, fetched once. One
         view of this map at zoom 4 pulled 12–20 raster tiles, 200–700KB, on
         every pan. Self-hosting the basemap is CHEAPER than renting one, and
         it cannot be watermarked, repriced or keyed.

         WHAT IS LOST: streets and place names, and zoom past 9. Both were
         promising more than this map has. About 73% of these pins are town
         or county centroids, so a dot at zoom 16 sat on a building
         it has nothing to do with. Capping the zoom is a correction, not a
         concession.

         Source: Natural Earth 1:50m admin-1, public domain, no attribution
         required. Rebuilt by build/make_outline.sh. */
      var OUTLINE_URL = '/data/us-states.geo.json';
      var ATTR = 'Boundaries: <a href="https://www.naturalearthdata.com/">Natural Earth</a> (public domain)';
      var PALETTE = {
        dark:  { fill: '#141a1b', stroke: '#2b3335', page: '#0e1211' },
        /* THE LIGHT FILL IS NEARLY WHITE ON PURPOSE. At #e7ece8 the grey
           "in the queue" pins (#9ca3af) sat on a background two shades away
           and the largest group on the map was the hardest to see. Renting
           tiles meant living with whoever's palette; self-hosting means the
           basemap can get out of the data's way. */
        light: { fill: '#f4f7f4', stroke: '#c0cac3', page: '#eef2ef' }
      };
      var outlineGeo = null, outlineFailed = false;

      function tileWarn(show, msg) {
        var warn = document.getElementById('covmap-tilewarn');
        if (!show) { if (warn) warn.hidden = true; return; }
        if (warn) { warn.hidden = false; return; }
        warn = document.createElement('div');
        warn.id = 'covmap-tilewarn';
        warn.className = 'covmap-tilewarn';
        warn.textContent = msg;
        if (el && el.parentNode) el.parentNode.insertBefore(warn, el.nextSibling);
      }

      /* THE SAME PROMISE THE TILE VERSION MADE, KEPT THE SAME WAY: if the
         basemap does not draw, the page says so rather than showing dots on a
         void and letting it read as a design choice. */
      function outlineLayer(theme) {
        var pal = PALETTE[theme];
        return L.geoJSON(outlineGeo, {
          attribution: ATTR,
          interactive: false,
          style: function () {
            return { color: pal.stroke, weight: 0.8, opacity: 1,
                     fillColor: pal.fill, fillOpacity: 1 };
          }
        });
      }

      var base = null;
      function paint() {
        var dark = document.documentElement.getAttribute('data-theme') !== 'light';
        var want = dark ? 'dark' : 'light';
        el.style.background = PALETTE[want].page;
        if (!outlineGeo || (base && base._style === want)) return;
        if (base) map.removeLayer(base);
        base = outlineLayer(want);
        base._style = want;
        base.addTo(map);
        base.bringToBack();
      }
      paint();
      fetch(OUTLINE_URL).then(function (r) { return r.ok ? r.json() : null; })
        .then(function (g) {
          if (!g) throw new Error('no outline');
          outlineGeo = g;
          paint();
          tileWarn(false);
        })
        .catch(function () {
          outlineFailed = true;
          tileWarn(true, 'The state outlines are not loading right now. The ' +
            'elevator pins are correct and complete: only the background ' +
            'map behind them is missing.');
        });
      /* loader.js writes data-theme on <html>; follow it rather than reading
         localStorage, so the map turns over at the same moment the site does. */
      try {
        new MutationObserver(paint).observe(document.documentElement,
          { attributes: true, attributeFilter: ['data-theme'] });
      } catch (e) {}

      var layers = {};
      ORDER.forEach(function (c) {
        var g = L.layerGroup().addTo(map);
        layers[c] = g;
      });

      var panel = document.getElementById('cov-panel');
      /* WHAT THE PIN ACTUALLY CLAIMS ABOUT WHERE IT IS. Standing rule 45: a
         town centroid drawn as a street address is the same lie as a made-up
         number, only quieter. */
      /* Standing rule 45 still applies — a town centroid drawn as a street
         address is a quiet lie — but the reader needs the caveat, not the
         mechanism. */
      var PREC = {
        street: 'Located to the street address.',
        zip: 'Located to the ZIP, not the driveway.',
        town: 'Located to the town, not the driveway.',
        county: 'Located to the county only.',
        unknown: ''
      };
      var LABEL = { read: 'read direct', quiet: 'checking', known: 'in the queue' };

      /* A grey elevator can ask to post its own bids: the form on
         /list-your-elevator, filled in from this pin (name, town, state). */
      function claimLink(a, st) {
        var q = 'name=' + encodeURIComponent(a[0] || '') + (a[1] ? '&town=' + encodeURIComponent(a[1]) : '') +
          (st && /^[A-Z]{2}$/.test(st) ? '&state=' + st : '');
        return ' <a class="el-claim" href="/list-your-elevator?' + esc(q) + '" data-track="elev_listing_pin">Is this yours? Post your bids free</a>';
      }
      function show(p) {
        if (!panel) return;
        var rows = p.a.map(function (a) {
          return '<li><span class="el-dot el-dot-' + a[2] + '"></span>' +
                 '<b>' + esc(a[0]) + '</b>' + (a[1] ? ', ' + esc(a[1]) : '') +
                 ' <em>' + LABEL[a[2]] + '</em>' + (a[2] === 'known' ? claimLink(a, p.s) : '') + '</li>';
        }).join('');
        var more = p.n > p.a.length ? '<li class="el-more">and ' + (p.n - p.a.length) + ' more at this point</li>' : '';
        panel.innerHTML = '<div class="el-panel-head">' + p.n + ' elevator' + (p.n === 1 ? '' : 's') +
          (p.s ? ' in ' + esc(p.s) : '') + '</div><ul class="el-panel-list">' + rows + more +
          '</ul><div class="el-panel-prec">' + (PREC[p.p] || PREC.unknown) + '</div>';
        panel.hidden = false;
      }
      

      d.places.forEach(function (p) {
        var m = L.circleMarker([p.y, p.x], {
          radius: RADIUS[p.c] || 3,
          color: EDGE, weight: p.c === 'known' ? 0.5 : 1,
          fillColor: COLOUR[p.c], fillOpacity: p.c === 'known' ? 0.6 : 0.95
        });
        m.on('click', function () { show(p); });
        m.addTo(layers[p.c]);
      });

      /* The key doubles as a filter. Three buttons, and turning the grey off
         is the fastest way to see what we actually cover. */
      var keys = document.getElementById('cov-key');
      if (keys) keys.addEventListener('click', function (ev) {
        var b = ev.target.closest('button[data-c]');
        if (!b) return;
        var c = b.getAttribute('data-c');
        var on = b.getAttribute('aria-pressed') !== 'true';
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        if (on) layers[c].addTo(map); else map.removeLayer(layers[c]);
      });
    })
    .catch(giveUp);
})();
