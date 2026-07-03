/**
 * AGSIST Service Worker — v4
 * ─────────────────────────────────────────────────────────────────
 * CACHE STRATEGY:
 *   HTML pages      → Network first, cache fallback (always fresh)
 *   JS/CSS/images   → Cache first IF versioned (?v=N), else network first
 *   Data (JSON)     → Network only, no caching (prices must be live)
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
var CACHE_VERSION = 7;
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
];

// ── Install: open new cache (don't pre-cache anything) ────────────
self.addEventListener('install', function(e) {
  self.skipWaiting(); // activate immediately, don't wait for old tabs to close
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
    handleFetch(e.request).catch(function() {
      // Last resort: bypass SW entirely; if THAT fetch also fails (offline,
      // blocked tracker, flaky API) return a quiet 504 instead of rejecting —
      // an unhandled rejection here logs a console error on every failure.
      return fetch(e.request).catch(function(){
        return new Response('', { status: 504, statusText: 'network unavailable' });
      });
    })
  );
});

// ── Strategy router ───────────────────────────────────────────────
function handleFetch(request) {
  var url = request.url;

  // Never cache data endpoints or external APIs — straight to network
  for (var i = 0; i < NEVER_CACHE.length; i++) {
    if (url.indexOf(NEVER_CACHE[i]) >= 0) {
      return fetch(request);
    }
  }

  // HTML pages → network first, cache fallback
  var accept = request.headers.get('accept');
  var isHTML = accept && accept.indexOf('text/html') >= 0;
  if (isHTML) {
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
    }
    return response;
  }).catch(function() {
    return caches.match(request).then(function(cached) {
      return cached || Promise.reject('network-and-cache-both-failed');
    });
  });
}

// ── Cache first: serve cache immediately, refresh in background ───
function cacheFirst(request) {
  return caches.match(request).then(function(cached) {
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
