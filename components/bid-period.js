/* ONE RULE FOR "IS THIS SEASON BID STILL OPEN", read by every page that ranks
   a cash bid (cash-bids.js, the Daily's local line). Nov 12, 2026: /cash-bids
   treated every "Harvest 2026" row as a closed month from November on, so the
   best corn at 54728 was a Harvest 2027 contract. A harvest-year bid
   (period "newcrop-YYYY") is a window, not a month:
     corn, soybeans, sorghum, anything unnamed   Sep to Dec of YYYY
     wheat, oats                                  Jun to Sep of YYYY
   The same windows as deliveryMonth() in dnilgis/bids scripts/merge_bids.mjs,
   delivery_month() in scripts/build_cash_bid_pages.py and tokenMonth() in
   components/bids-homepage.js (test/bid-period.test.mjs holds all four to the
   same table). Inside the window the bid is for the current month; before it,
   for its first month; after it, past.
   THE FEED'S ANSWER COMES FIRST. dnilgis/bids sets `periodPast` when it builds
   the row: true means past, false means open, and only a row that carries
   neither falls back to the window. `now` is always passed in (a Date, a
   millisecond count or an ISO day), so nothing here reads the clock. */
(function (root) {
  'use strict';
  var WIN = { corn: [9, 12], soybeans: [9, 12], sorghum: [9, 12], wheat: [6, 9], oats: [6, 9] };
  var DEFAULT_WIN = [9, 12];
  function pad(n) { return ('0' + n).slice(-2); }
  function monthKey(now) {
    if (typeof now === 'string' && /^\d{4}-\d{2}/.test(now)) return now.slice(0, 7);
    var d = now instanceof Date ? now : new Date(now);
    return isNaN(d) ? '' : d.getFullYear() + '-' + pad(d.getMonth() + 1);
  }
  function seasonYear(period) {
    var m = /^newcrop-(\d{4})$/.exec(String(period || ''));
    return m ? +m[1] : 0;
  }
  function crop(b) {
    var c = String(b && (b.category || b.crop || b.netCrop) || '').toLowerCase();
    return WIN[c] ? c : '';
  }
  /* { key, open } for a harvest-year bid, or null when the period is not one.
     past: the row's periodPast (true, false or undefined). */
  function season(period, cropName, now, past) {
    var y = seasonYear(period), cur = monthKey(now);
    if (!y || !cur) return null;
    var w = WIN[cropName] || DEFAULT_WIN, s = y + '-' + pad(w[0]), e = y + '-' + pad(w[1]);
    if (past === true) return { key: e, open: false };
    if (cur < s) return { key: s, open: true };
    if (past === false || cur <= e) return { key: cur, open: true };
    return { key: e, open: false };
  }
  /* The row-shaped call: b carries deliveryPeriod (or period), periodPast and a crop. */
  function rowSeason(b, now) {
    return season(b && (b.deliveryPeriod || b.period), crop(b), now, b && typeof b.periodPast === 'boolean' ? b.periodPast : undefined);
  }
  /* The harvest year a reader means: this year while its window is not over, else next. */
  function harvestYear(now, cropName) {
    var cur = monthKey(now), y = +cur.slice(0, 4), w = WIN[cropName] || DEFAULT_WIN;
    return cur.slice(5) > pad(w[1]) ? y + 1 : y;
  }
  var api = { monthKey: monthKey, seasonYear: seasonYear, season: season, rowSeason: rowSeason, harvestYear: harvestYear, cropOf: crop, WINDOWS: WIN };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AgBidPeriod = api;
})(typeof window !== 'undefined' ? window : this);
