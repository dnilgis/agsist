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
var CACHE_VERSION = 40;  // v40 2026-10-09: ARC/PLC calculator works offline on saved pages; v39 2026-10-09: ARC or PLC in the menu, footer and homepage; v38 2026-10-09: ARC/PLC decision tiers; v37 2026-10-09: ARC/PLC calculator; v36 2026-10-09: plainer site copy; v35 2026-10-09: card tokens, spray states, page titles; v34 2026-10-09: one look, variable fonts (old font files removed); v33 2026-10-09: no-jump layout, loading states; v32 2026-10-09: menu and footer change; v31 2026-10-09: instant pages, offline copies of key data; v30 2026-10-09: search, My elevators, tap targets; v29 2026-10-09: em-dash cleanup, link fixes, homepage coverage counts file; v28 2026-10-08: phone audit 2 (contrast, 16px inputs, 40px taps, footer pill); v27 2026-10-08: styles.css phone fixes (16px inputs so iOS stops zooming, .sr-only, light-mode change chips); was: v26 (2026-08-15 nav-panel visibility fix)
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
    // county page still runs offline (they change a few times a year)
    if (u.pathname === '/data/arc-plc.json' || /^\/data\/arc-plc\/[A-Z]{2}\.json$/.test(u.pathname)) return 'arc-plc';
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
