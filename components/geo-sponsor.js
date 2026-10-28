/* STATE-TARGETED SPONSOR (Sig, Oct 28, 2026; first use RootLot in CA, NV, TX).
 *
 * components/loader.js loads this file once its page sponsor check is done
 * and the page has no sold page sponsor; it never loads it where the page
 * hides /sponsor or on a Rain Print, gift card or rain gauge page.
 *
 * Who sees an entry from data/geo-sponsors.json:
 *   - a page about one of its states (rain/california and its counties, the
 *     PRF, ARC/PLC, Atlas, rent, yield, hail map and cash bid pages of that
 *     state): drawn with no lookup, utm_content=state-page;
 *   - any other page: the worker's GET /where is asked once per browser
 *     session, only the 2-letter region_code is kept (sessionStorage,
 *     "agsist-geo-rc"), and the entry draws when the visit is in the US and
 *     the state is one of its states, utm_content=reader-state.
 * No active entry, no lookup. A failed or slow answer draws nothing.
 *
 * Where: below the fold only (nothing on screen moves), in place of the
 * page's open "Sponsor this page" line, else above the byline, else at the
 * end of the page's main column. No space is reserved.
 *
 * Looks and counts: components/sponsor-ad.js (AgsistAd.render) and
 * sponsor-ad.css; views and clicks through components/sponsor-metrics.js
 * under the slot "geo-<id>". The reader's state is in no event.
 *
 * Preview for Sig: ?geo-preview=CA on any page (not linked anywhere; pages
 * carry their canonical URL, so the flag is never indexed). It draws even an
 * inactive entry, once its copy is filled in, and counts nothing.
 *
 * Tested by test/geo-sponsor.test.mjs (node loads the pure part below).
 */
(function (root) {
  'use strict';
  var SLUGS = 'alabama:AL alaska:AK arizona:AZ arkansas:AR california:CA colorado:CO connecticut:CT delaware:DE florida:FL georgia:GA hawaii:HI idaho:ID illinois:IL indiana:IN iowa:IA kansas:KS kentucky:KY louisiana:LA maine:ME maryland:MD massachusetts:MA michigan:MI minnesota:MN mississippi:MS missouri:MO montana:MT nebraska:NE nevada:NV new-hampshire:NH new-jersey:NJ new-mexico:NM new-york:NY north-carolina:NC north-dakota:ND ohio:OH oklahoma:OK oregon:OR pennsylvania:PA rhode-island:RI south-carolina:SC south-dakota:SD tennessee:TN texas:TX utah:UT vermont:VT virginia:VA washington:WA west-virginia:WV wisconsin:WI wyoming:WY';
  var ST = {};
  SLUGS.split(' ').forEach(function (p) { var kv = p.split(':'); ST[kv[0]] = kv[1]; });
  var SECTIONS = /^\/(rain|prf|arc-plc|farmland-atlas|rent|yield|hail-map|cash-bids)\/([a-z-]+?)(?:\.html|\/|$)/;
  var EXCLUDE = /^\/(rain-print|rp-gift|rain-gauge|gifts-for-farmers|birth-year-weather-gift|wedding-year-weather-gift|farm-anniversary-gifts|farmer-retirement-gifts)(?:[.\/-]|$)/;
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  var WORKER = 'https://agsist-api.dnilgis.workers.dev';
  var KEY = 'agsist-geo-rc';

  function pageState(path) {
    var m = SECTIONS.exec(String(path || ''));
    return (m && ST[m[2]]) || '';
  }
  function excluded(path) { return EXCLUDE.test(String(path || '')); }

  function today(now) {
    var d = now || new Date();
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); }
    catch (e) { return d.toISOString().slice(0, 10); }
  }

  /* drawable: copy filled in; live: also switched on and inside its dates (null = no limit) */
  function drawable(e) {
    return !!(e && typeof e.id === 'string' && /^[a-z0-9-]+$/.test(e.id) && e.name && e.headline && e.body &&
      /^https:\/\/[^\s"'<>\\`]+$/i.test(e.url || '') && Array.isArray(e.states));
  }
  function live(e, day) {
    if (!drawable(e) || e.active !== true) return false;
    if (e.start != null && (!DATE_RE.test(e.start) || e.start > day)) return false;
    if (e.end != null && (!DATE_RE.test(e.end) || e.end < day)) return false;
    return true;
  }
  function anyLive(data, day) {
    var l = (data && data.sponsors) || [];
    for (var i = 0; i < l.length; i++) if (live(l[i], day)) return true;
    return false;
  }
  function choose(data, st, day, preview) {
    if (!/^[A-Z]{2}$/.test(st || '')) return null;
    var l = (data && data.sponsors) || [];
    for (var i = 0; i < l.length; i++) {
      var e = l[i];
      if (!(preview ? drawable(e) : live(e, day))) continue;
      if (e.states.indexOf(st) >= 0) return e;
    }
    return null;
  }

  function withUtm(url, campaign, surface) {
    var s = String(url), h = '', i = s.indexOf('#');
    if (i >= 0) { h = s.slice(i); s = s.slice(0, i); }
    var q = 'utm_source=agsist&utm_medium=sponsor&utm_campaign=' + encodeURIComponent(campaign) +
      '&utm_content=' + encodeURIComponent(surface);
    var sep = s.indexOf('?') < 0 ? '?' : (/[?&]$/.test(s) ? '' : '&');
    return s + sep + q + h;
  }

  /* the object AgsistAd.render draws */
  function toAd(e, surface) {
    var logo = /^(\/img\/sponsors\/[a-z0-9._-]+|https:\/\/[^\s"'<>\\`]+)\.(png|jpe?g|webp|svg)$/i.test(e.logo || '') ? e.logo : '';
    return {
      label: 'Sponsor', advertiser: e.name, headline: e.headline, body: e.body,
      facts: Array.isArray(e.facts) ? e.facts.filter(function (f) { return typeof f === 'string' && f; }).slice(0, 4) : [],
      cta_text: e.cta_text || 'Learn more',
      cta_url: withUtm(e.url, e.utm_campaign || ('geo-' + e.id), surface),
      phone: e.phone || '', logo: logo
    };
  }

  /* region_code from a /where answer: a US visit with a 2-letter state, else '-' */
  function regionOf(j) {
    return (j && j.ok === true && /^[A-Z]{2}$/.test(j.region_code || '')) ? j.region_code : '-';
  }

  var api = { pageState: pageState, excluded: excluded, today: today, drawable: drawable, live: live, anyLive: anyLive,
    choose: choose, withUtm: withUtm, toAd: toAd, regionOf: regionOf };
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }

  var doc = root.document;
  function getJSON(url, ms, opts) {
    var ctl = null, t = null;
    try { ctl = new AbortController(); t = setTimeout(function () { ctl.abort(); }, ms); } catch (e) {}
    var o = opts || {};
    if (ctl) o.signal = ctl.signal;
    return root.fetch(url, o)
      .then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then(function (j) { if (t) clearTimeout(t); return j; }, function (e) { if (t) clearTimeout(t); throw e; });
  }
  function lookup() {
    var have = null;
    try { have = root.sessionStorage.getItem(KEY); } catch (e) {}
    if (have === '-' || /^[A-Z]{2}$/.test(have || '')) return Promise.resolve(have);
    return getJSON(WORKER + '/where', 2500, { credentials: 'omit', cache: 'no-store' }).then(function (j) {
      var rc = regionOf(j);
      try { root.sessionStorage.setItem(KEY, rc); } catch (e) {}
      return rc;
    }, function () { return '-'; });
  }
  function shown(el) { try { return el.getClientRects().length > 0; } catch (e) { return false; } }
  function soldOnPage() {
    var l = doc.querySelectorAll('[data-sponsor-slot]');
    for (var i = 0; i < l.length; i++) if (shown(l[i])) return true;
    return false;
  }
  function prfSold(st, day) {
    if (!/^\/prf\//.test(root.location.pathname)) return Promise.resolve(false);
    return getJSON('/data/prf-sponsors.json', 4000, { cache: 'no-cache' }).then(function (d) {
      var e = d && d[st];
      return !!(e && e.name && e.url && (!e.through || e.through >= day));
    }, function () { return false; });
  }
  function need(tag, attr, url, test) {
    return new Promise(function (ok) {
      if (test()) return ok();
      var el = doc.createElement(tag);
      if (tag === 'link') el.rel = 'stylesheet';
      el[attr] = url;
      el.onload = el.onerror = function () { ok(); };
      doc.head.appendChild(el);
    });
  }
  function anchor(rib, force) {
    var main = doc.querySelector('main#main') || doc.querySelector('main');
    var open = rib && rib.isConnected && !/--sold/.test(rib.className) && rib.id !== 'idx1-sponsor' ? rib : null;
    var spot = open || (main && main.querySelector('.rc-byline, .by-end, .prf-byline'));
    var where = spot ? { el: spot, mode: 'before' } : (main ? { el: main, mode: 'append' } : null);
    if (!where) return null;
    var top = where.mode === 'before' ? where.el.getBoundingClientRect().top : where.el.getBoundingClientRect().bottom;
    if (!force && top < (root.innerHeight || doc.documentElement.clientHeight)) return null;
    return where;
  }
  function draw(e, surface, rib, preview) {
    Promise.all([
      need('link', 'href', '/components/sponsor-ad.css?v=2', function () { return !!doc.querySelector('link[href*="/components/sponsor-ad.css"]'); }),
      need('script', 'src', '/components/sponsor-ad.js?v=2', function () { return !!root.AgsistAd; })
    ]).then(function () {
      if (!root.AgsistAd || (!preview && soldOnPage())) return;
      var html = root.AgsistAd.render(toAd(e, surface), surface, preview ? {} : { slot: 'geo-' + e.id });
      if (!html) return;
      var where = anchor(rib, preview);
      if (!where) return;
      var box = doc.createElement('div');
      box.className = 'geo-spon';
      box.style.cssText = 'margin:1.5rem 0;max-width:760px';
      box.innerHTML = html;
      if (where.mode === 'before') where.el.parentNode.insertBefore(box, where.el); else where.el.appendChild(box);
      if (where.el === rib) rib.hidden = true;
    }).catch(function () {});
  }
  function run(rib) {
    var path = root.location.pathname;
    if (excluded(path)) return;
    var pv = /[?&]geo-preview=([A-Za-z]{2})(?:&|$)/.exec(root.location.search);
    var day = today();
    getJSON('/data/geo-sponsors.json', 4000, { cache: 'no-cache' }).then(function (data) {
      if (pv) {
        var p = choose(data, pv[1].toUpperCase(), day, true);
        if (p) draw(p, 'preview', rib, true);
        return;
      }
      if (!anyLive(data, day)) return;
      var ps = pageState(path), e = choose(data, ps, day, false);
      var go = e ? Promise.resolve({ e: e, st: ps, s: 'state-page' })
        : lookup().then(function (rc) { var x = choose(data, rc, day, false); return x && { e: x, st: rc, s: 'reader-state' }; });
      return go.then(function (r) {
        if (!r) return;
        return prfSold(ps || r.st, day).then(function (sold) { if (!sold) draw(r.e, r.s, rib, false); });
      });
    }).catch(function () {});
  }
  root.AgsistGeo = { run: run };
})(typeof window !== 'undefined' ? window : this);
