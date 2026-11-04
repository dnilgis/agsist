/* bids-fallback.js: the one failure path for a slow or failed elevator network (Nov 4, 2026, site panel).

   WHY. The live bids come from the network's own files (components/bids-network.js, cash-bids.js), which
   miss their deadline on a slow phone connection. Home and /cash-bids then said "did not load" with a
   link to /cash-bids, which fails the same way: a dead end. Fast Facts and the Atlas county page fell
   back to the small committed file the futures pages use and printed "Best of 4 within 50 mi" as if it
   were the local market. Nothing counted how often a reader hit any of it.

   WHAT IT DOES
   - count(page, why): one GA event, bids_net_fallback {page, why}, once per page and reason per view.
   - town(zip): the nearest cash bid town page in the ZIP's state, from our own ZIP table and the state's
     basis table (data/state-basis/<ST>.json "towns": [path, town, lat, lon, latest], written by
     scripts/build_cash_bid_pages.py). A table without towns: the town page named like the ZIP's town,
     else the state's page, with the table's own time.
   - line(el, zip, page, why): counts, then writes "Bids as posted at <town> page, as of <time>" into el.
     The baked pages are built from the same boards when the network last answered; the line says so.
   - partial(): the words a bid row uses when it comes from the small committed file instead.
   Nothing here sends the ZIP anywhere: both files are our own, the event carries no place.

   window.AgBidsFallback; node: module.exports (test/bids-fallback.test.mjs). */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && typeof root === 'object' && typeof root.document !== 'undefined') root.AgBidsFallback = api.bind(root);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var MAX_MI = 60;
  var PARTIAL = 'From the short list of bids the price pages use, because the full elevator network did not answer in time. Not every elevator near here is in it.';
  function miles(a, b, c, d) {
    var R = 3958.8, p = Math.PI / 180, x = Math.sin((c - a) * p / 2), y = Math.sin((d - b) * p / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(x * x + Math.cos(a * p) * Math.cos(c * p) * y * y)));
  }
  function slug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function when(iso) {
    var d = new Date(iso);
    if (!iso || isNaN(d)) return '';
    try {
      return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' }) + ' CT';
    } catch (e) { return d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC'; }
  }
  /* pick(doc, zipRow): the nearest town page, as {path, name, st, mi, latest} (mi null when not measured) */
  function pick(doc, z) {
    if (!doc || !Array.isArray(z)) return null;
    var st = String(doc.state || z[3] || ''), lat = +z[0], lon = +z[1], best = null;
    (doc.towns || []).forEach(function (t) {
      if (!Array.isArray(t) || !t[0] || !isFinite(+t[2]) || !isFinite(+t[3])) return;
      var m = miles(lat, lon, +t[2], +t[3]);
      if (m <= MAX_MI && (!best || m < best.mi)) best = { path: t[0], name: t[1], st: st, mi: Math.round(m), latest: t[4] || doc.generated };
    });
    if (best) return best;
    var own = String(z[2] || '').toLowerCase(), path = '', latest = '';
    (doc.rows || []).forEach(function (r) {
      if (!path && Array.isArray(r) && r[3] && String(r[2] || '').toLowerCase() === own) { path = r[3]; latest = r[9]; }
    });
    if (path) return { path: path, name: z[2], st: st, mi: null, latest: latest || doc.generated };
    if (doc.name) return { path: '/cash-bids/' + slug(doc.name) + '/', name: doc.name, st: st, mi: null, latest: doc.generated, state: true };
    return null;
  }
  function html(t) {
    if (!t) return '';
    var at = t.state ? 'the ' + esc(t.name) + ' cash bids page' : 'the ' + esc(t.name) + ', ' + esc(t.st) + ' bids page';
    var w = when(t.latest);
    return 'Bids as last posted are on <a href="' + esc(t.path) + '">' + at + '</a>'
      + (t.mi != null ? ', ' + t.mi + ' mi away' : '') + (w ? ', as of ' + w : '')
      + '. That page is built from the same elevator boards each time they answer.';
  }
  function bind(w) {
    var sent = {};
    function count(page, why) {
      var k = page + '|' + why;
      if (sent[k]) return false;
      sent[k] = 1;
      try { if (typeof w.gtag === 'function') w.gtag('event', 'bids_net_fallback', { page: String(page || ''), why: String(why || '') }); } catch (e) {}
      return true;
    }
    function json(u) { return w.fetch(u).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); }
    function town(zip) {
      var z = String(zip || '');
      if (!/^\d{5}$/.test(z)) return Promise.resolve(null);
      return json('/data/places/zip/' + z.slice(0, 2) + '.json').then(function (t) {
        var r = t && t[z];
        if (!Array.isArray(r) || !/^[A-Z]{2}$/.test(String(r[3] || ''))) return null;
        return json('/data/state-basis/' + r[3] + '.json').then(function (doc) { return pick(doc, r); });
      });
    }
    function line(el, zip, page, why) {
      count(page, why);
      if (!el) return Promise.resolve(null);
      return town(zip).then(function (t) {
        if (t) { el.innerHTML = html(t); el.hidden = false; }
        return t;
      }, function () { return null; });
    }
    return { count: count, town: town, line: line, partial: function () { return PARTIAL; }, pick: pick, html: html };
  }
  return { bind: bind, pick: pick, html: html, PARTIAL: PARTIAL, MAX_MI: MAX_MI };
});
