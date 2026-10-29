/* components/soil-near.js: measured soil temperature at the nearest station (2026-10-29).
 *
 * No free forecast gives soil temperature (the National Weather Service grid that replaced
 * Open-Meteo has none), so the pages that showed Open-Meteo's modeled soil now show a measured
 * one: data/fall-nitrogen.json, written by scripts/fetch_fall_nitrogen.py from NOAA's Climate
 * Reference Network, USDA NRCS SCAN, Iowa State's soil network and Wisconet (4 in daily means,
 * the last 10 days per station). The station is not the reader's field, and pages say so.
 *
 *   AgSoilNear.near(feed, lat, lon, todayIso, {miles: 50, ageDays: 3})
 *     -> {st, mi, net, url, mean (last 3 days), now (last day), last3, last5, trend} for a station
 *        within `miles` whose last reading is at most `ageDays` old, or {st?, mi?, why} when there
 *        is no current reading (no station near, an old reading, a missing day).
 *   AgSoilNear.load() -> Promise of the feed, or null (never rejects)
 */
(function (root) {
  'use strict';
  var FEED = '/data/fall-nitrogen.json';
  function miles(a, b, c, d) {
    var t = Math.PI / 180, x = (c - a) * t, y = (d - b) * t;
    var h = Math.sin(x / 2) * Math.sin(x / 2) + Math.cos(a * t) * Math.cos(c * t) * Math.sin(y / 2) * Math.sin(y / 2);
    return 2 * 3958.8 * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function ok(v) { return typeof v === 'number' && isFinite(v); }
  function near(feed, lat, lon, todayIso, o) {
    o = o || {};
    var maxMi = o.miles || 50, maxAge = o.ageDays != null ? o.ageDays : 3;
    if (!feed || !Array.isArray(feed.stations)) return { why: 'The soil station file did not load.' };
    var best = null, bd = Infinity;
    feed.stations.forEach(function (s) {
      if (!ok(s.lat) || !ok(s.lon)) return;
      var d = miles(lat, lon, s.lat, s.lon); if (d < bd) { bd = d; best = s; }
    });
    if (!best || bd > maxMi) return { why: 'No soil station reports within ' + maxMi + ' miles of this spot.' };
    var net = (feed.net_labels && feed.net_labels[best.net]) || best.net, url = (feed.net_urls && feed.net_urls[best.net]) || '';
    var base = { st: best, mi: bd, net: net, url: url };
    var age = (Date.parse(todayIso) - Date.parse(best.last)) / 864e5;
    if (!(age <= maxAge)) {
      base.why = 'The nearest soil station (' + best.name + ', ' + Math.round(bd) + ' mi) last reported ' + best.last + '. Its readings are gathered September to December, so there is no current reading.';
      return base;
    }
    var t = best.t || [], l3 = t.slice(-3), l5 = t.slice(-5);
    if (l3.length < 3 || !l3.every(ok)) { base.why = 'The nearest soil station (' + best.name + ') is missing a day of its last 3, so there is no 3-day mean.'; return base; }
    base.last3 = l3; base.now = l3[2]; base.mean = (l3[0] + l3[1] + l3[2]) / 3;
    if (l5.length === 5 && l5.every(ok)) { var df = l5[4] - l5[0]; base.last5 = l5; base.trend = df >= 2 ? 'warming' : df <= -2 ? 'cooling' : 'steady'; }
    return base;
  }
  var loadP = null;
  function load() {
    if (!loadP) loadP = fetch(FEED).then(function (r) { return r.ok ? r.json() : null; }).then(null, function () { loadP = null; return null; });
    return loadP;
  }
  function todayIso() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  var OUT = { near: near, load: load, todayIso: todayIso, miles: miles, FEED: FEED };
  if (typeof module === 'object' && module.exports) module.exports = OUT;
  else root.AgSoilNear = OUT;
})(typeof window !== 'undefined' ? window : this);
