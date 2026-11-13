/* STATE-TARGETED SPONSOR (Oct 28, 2026; first use RootLot in CA, NV, TX).
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
 * Where, on a page about one state (Nov 11, 2026): in the page's state spot, the
 * [data-state-spot] box each page builder writes directly below the main answer.
 * The box holds its height from the first paint (components/styles.css), so the
 * card lands without moving anything. With no live sponsor for that state the
 * spot shows that it is open: the state's engaged visits and page views from
 * data/sponsor-spots.json (engaged visits from the state, views of its pages) and its price from data/rate-card.json. Two sponsor
 * names never share a screen: when the sitewide line is sold and the spot is in
 * the first screen, a sold state card goes to the first place below the fold.
 *
 * Where, on any other page: below the fold only, so nothing on screen moves when it lands. The
 * first of these, in page order, that is still below the fold when the ad is
 * ready: a section heading of the main column that comes after the page's main
 * answer (rain pages, Nov 5: the ad used to sit at the very end of a long page),
 * the page's open "Sponsor this page" line, the byline; else the end of the
 * page's main column. Never above the main answer. The card's picture has a
 * fixed size, so the card never grows after it lands.
 *
 * Looks and counts: components/sponsor-ad.js (AgsistAd.render), sponsor-ad.css
 * and geo-sponsor.css (the card's own green panel, its logo at the left, the
 * whole card opening the one counted link); views and clicks through
 * components/sponsor-metrics.js under the slot "geo-<id>", unchanged. The
 * reader's state is in no event.
 *
 * ?sponsor-preview=1 (with the sample sitewide line) or ?sponsor-preview=state (the card alone) on a
 * state page draws a sample sold card in the state spot
 * and counts nothing.
 *
 * Preview for the owner: ?geo-preview=CA on any page (not linked anywhere; pages
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
    var logo = /^(\/img\/sponsors\/(?:[a-z0-9_-]+\/)?[a-z0-9._-]+|https:\/\/[^\s"'<>\\`]+)\.(png|jpe?g|webp|svg)$/i.test(e.logo || '') ? e.logo : '';
    return {
      label: 'Supported by', advertiser: e.name, headline: e.headline, body: e.body,
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

  var NAMES = {};
  SLUGS.split(' ').forEach(function (p) {
    var kv = p.split(':');
    NAMES[kv[1]] = kv[0].split('-').map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(' ');
  });
  function esc(x) {
    return String(x == null ? '' : x).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  /* the state's monthly price from data/rate-card.json, or 0 */
  function statePrice(card, st) {
    var t = card && (card.tiers || []).filter(function (x) { return x.id === 'state'; })[0];
    if (!t) return 0;
    return (t.price_by_state && t.price_by_state[st]) || t.price_month || 0;
  }
  function held(card, st) {
    var t = card && (card.tiers || []).filter(function (x) { return x.id === 'state'; })[0];
    return !!(t && (t.opens_soon || []).indexOf(st) >= 0);
  }
  function num(n) { return Number(n).toLocaleString('en-US'); }
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function dayTxt(s) { var p = String(s || '').split('-'); return p.length === 3 ? MON[+p[1] - 1] + ' ' + (+p[2]) : ''; }
  /* The open state spot sells itself (Sig, Nov 13): that STATE's own engaged visits (readers in the state) over the
     week's window in data/sponsor-spots.json proof.states, its dates, and one button to /sponsor with the state
     picked. State-level only: a state without its own figure prints none, never a national one. No price here. */
  function openHtml(st, card, spots) {
    var name = NAMES[st];
    if (!name) return '';
    var ps = (spots && spots.proof && spots.proof.states) || {};
    var e = ps.engaged && ps.engaged[st];
    var has = typeof e === 'number' && e > 0 && ps.start && ps.end && ps.days > 0;
    var soon = held(card, st);
    var nums = has ? '<b>' + num(e) + '</b> engaged visits from ' + esc(name) + ' readers, ' + dayTxt(ps.start) + ' to ' + dayTxt(ps.end) +
      ' (' + num(Math.round(e / ps.days)) + ' a day). ' : '';
    return '<div class="ss-box ss-open"><p class="ss-tag">' + esc(name) + ' sponsor spot ' + (soon ? 'opens soon' : 'open') + '</p>' +
      '<p class="ss-txt">' + nums + 'One business per state.</p>' +
      '<a class="ss-go" href="/sponsor?state=' + st + '#state">Sponsor ' + esc(name) + ' on AGSIST</a></div>';
  }
  /* A state page's spot that cannot carry its state's card on this page (the page has its own paid sponsor, or the
     sitewide sponsor is on the same screen) keeps its room and says so, with no sponsor name: never an empty box,
     never collapsed after the first paint. */
  function heldHtml(st, lower) {
    var name = NAMES[st];
    if (!name) return '';
    return '<div class="ss-box ss-held"><p class="ss-tag">' + esc(name) + ' sponsor card</p>' +
      '<p class="ss-txt">' + (lower ? 'It is further down this page.' : 'It shows on other ' + esc(name) + ' pages.') + '</p></div>';
  }
  var SAMPLE = { id: 'sample', name: 'Your Business', states: [], headline: 'Your headline here',
    body: 'One or two lines about your business, for readers in this state.', cta_text: 'Visit', url: 'https://agsist.com/sponsor', logo: '' };

  var api = { openHtml: openHtml, heldHtml: heldHtml, statePrice: statePrice, NAMES: NAMES, pageState: pageState, excluded: excluded, today: today, drawable: drawable, live: live, anyLive: anyLive,
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
    var l = doc.querySelectorAll('[data-sponsor-slot]:not(#ag-sw)');
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
  /* Section headings of the main column after the page's main answer (the
     answer stays above the ad). Only pages that mark their answer take part. */
  var ANSWER = '.rc-answer';
  function breaks(main) {
    var ans = main && main.querySelector(ANSWER), out = [];
    if (!ans || !ans.parentNode) return out;
    for (var n = ans.nextElementSibling; n; n = n.nextElementSibling)
      if (n.tagName === 'H2' && shown(n)) out.push(n);
    return out;
  }
  function anchor(rib, force) {
    var main = doc.querySelector('main#main') || doc.querySelector('main');
    var open = rib && rib.isConnected && !/--sold/.test(rib.className) && rib.id !== 'idx1-sponsor' ? rib : null;
    var by = main && main.querySelector('.rc-byline, .by-end, .prf-byline');
    var spots = breaks(main);
    if (open) spots.push(open);
    if (by) spots.push(by);
    spots.sort(function (a, b) { return a === b ? 0 : (a.compareDocumentPosition(b) & 4 ? -1 : 1); });
    var fold = root.innerHeight || doc.documentElement.clientHeight;
    for (var i = 0; i < spots.length; i++) {
      if (force || spots[i].getBoundingClientRect().top >= fold) return { el: spots[i], mode: 'before' };
    }
    if (!main || (!force && main.getBoundingClientRect().bottom < fold)) return null;
    return { el: main, mode: 'append' };
  }
  function spot() { return doc.querySelector('[data-state-spot]'); }
  function firstScreen(el) { try { return el.getBoundingClientRect().top < (root.innerHeight || doc.documentElement.clientHeight); } catch (x) { return false; } }
  function sitewideSold() { var l = doc.getElementById('ag-sw'); return !!(l && /sw-line--sold/.test(l.className) && shown(l)); }
  var CSS = '/components/geo-sponsor.css?v=3';
  function css() { return need('link', 'href', CSS, function () { return !!doc.querySelector('link[href*="/components/geo-sponsor.css"]'); }); }
  function hold(lower) {
    var sp = spot(), st = sp && sp.getAttribute('data-state-spot');
    var html = st ? heldHtml(st, lower) : '';
    if (html) css().then(function () { sp.innerHTML = html; });
  }
  function draw(e, surface, rib, preview) {
    var onSpot = surface === 'state-page' || surface === 'preview-state';
    Promise.all([
      need('link', 'href', '/components/sponsor-ad.css?v=3', function () { return !!doc.querySelector('link[href*="/components/sponsor-ad.css"]'); }),
      need('link', 'href', '/components/geo-sponsor.css?v=3', function () { return !!doc.querySelector('link[href*="/components/geo-sponsor.css"]'); }),
      need('script', 'src', '/components/sponsor-ad.js?v=4', function () { return !!root.AgsistAd; })
    ]).then(function () {
      if (!root.AgsistAd || (!preview && soldOnPage())) { if (onSpot) hold(false); return; }
      var html = root.AgsistAd.render(toAd(e, surface), surface, preview ? {} : { slot: 'geo-' + e.id });
      if (!html) return;
      var box = doc.createElement('div');
      box.className = 'geo-spon';
      box.innerHTML = html;
      var sp = onSpot ? spot() : null;
      if (sp && !(sitewideSold() && firstScreen(sp))) {
        box.className = 'geo-spon geo-spon--spot';
        sp.innerHTML = '';
        sp.appendChild(box);
        return;
      }
      var where = anchor(rib, preview);
      if (sp) sp.innerHTML = heldHtml(sp.getAttribute('data-state-spot'), !!where);
      if (!where) return;
      box.style.cssText = 'margin:1.5rem 0;max-width:760px';
      if (where.mode === 'before') where.el.parentNode.insertBefore(box, where.el); else where.el.appendChild(box);
      if (where.el === rib) rib.hidden = true;
    }).catch(function () {});
  }
  /* The open spot on a state page: no live sponsor for this state. */
  function drawOpen(st) {
    var sp = spot();
    if (!sp) return;
    Promise.all([getJSON('/data/rate-card.json', 4000, { cache: 'no-cache' }).catch(function () { return null; }),
                 getJSON('/data/sponsor-spots.json', 4000, { cache: 'no-cache' }).catch(function () { return null; }),
                 css()]).then(function (r) {
      var html = openHtml(st, r[0], r[1]);
      if (html) sp.innerHTML = html;
    });
  }
  function run(rib) {
    var path = root.location.pathname;
    if (excluded(path)) return;
    var pv = /[?&]geo-preview=([A-Za-z]{2})(?:&|$)/.exec(root.location.search);
    var ps = pageState(path);
    var slotSt = (spot() && spot().getAttribute('data-state-spot')) || '';
    if (/^[A-Z]{2}$/.test(slotSt)) ps = slotSt;
    if (ps && /[?&]sponsor-preview=(?:1|state)(?:&|$)/.test(root.location.search)) {
      var smp = {}; for (var k in SAMPLE) smp[k] = SAMPLE[k];
      smp.states = [ps];
      draw(smp, 'preview-state', rib, true);
      return;
    }
    var day = today();
    getJSON('/data/geo-sponsors.json', 4000, { cache: 'no-cache' }).then(function (data) {
      if (pv) {
        var p = choose(data, pv[1].toUpperCase(), day, true);
        if (p) draw(p, ps ? 'preview-state' : 'preview', rib, true);
        return;
      }
      var e = choose(data, ps, day, false);
      if (ps && !e && spot()) {
        return drawOpen(ps);
      }
      if (!anyLive(data, day)) return;
      var go = e ? Promise.resolve({ e: e, st: ps, s: 'state-page' })
        : lookup().then(function (rc) { var x = choose(data, rc, day, false); return x && { e: x, st: rc, s: 'reader-state' }; });
      return go.then(function (r) {
        if (!r) return;
        return prfSold(ps || r.st, day).then(function (sold) { if (!sold) draw(r.e, r.s, rib, false); else if (r.s === 'state-page') hold(false); });
      });
    }).catch(function () { if (ps && spot()) drawOpen(ps); });
  }
  root.AgsistGeo = { run: run };
})(typeof window !== 'undefined' ? window : this);
