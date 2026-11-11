/* home-land.js: the home page's Farmland sales block (Nov 4, 2026; "there is dead space on the home
   page, maybe we can link it somehow with the unusual sales or something to get people's attention").

   One real recorded sale from data/land-sales/lead.json (scripts/build_land_sales.py lead_pick, LEAD_RULE):
   the highest price per acre among bare farmland sales of 40 acres or more in the state's newest 30 days on
   file, inside its county's usual range, in a county with 5 or more comparable sales over 24 months. The rule
   is printed word for word under "How this sale was picked".

   WHICH STATE: the reader's saved state when it has a lead; otherwise the newest lead of any covered state,
   labeled with its state (and, for a saved state we do not cover yet, "Not yet in <state>").
   NEVER A NAME: only county, acres, $/acre, the date, the county median and its count are read from the file.
   NO DATA (file missing, malformed, or no state has a lead): the baked plain words stay, the links still work.
   NO LAYOUT SHIFT: the baked words and the sale fill the same lines; css/home.css holds each line's room.

   STALE: a state's sale more than 60 days past its window's end is withheld (fresh, the page's own clock).
   window.AgHomeLand = { pick, words } (test/home-land.test.mjs runs both in node on fixtures and a fake clock). */
(function (root) {
  'use strict';
  var NAMES = { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut',
    DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas',
    KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
    MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
    NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon',
    PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
    VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming' };
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

  function num(x) { return typeof x === 'number' && isFinite(x) ? x : null; }
  function day(iso, year) {
    var m = DAY.exec(String(iso || ''));
    return m ? MON[+m[2] - 1] + ' ' + (+m[3]) + (year ? ', ' + m[1] : '') : '';
  }
  function money(x) { return '$' + Math.round(x).toLocaleString('en-US'); }
  function acres(a) { return (a >= 100 ? Math.round(a) : Math.round(a * 10) / 10).toLocaleString('en-US') + ' acres'; }
  /* a lead the block may print: every field it shows is there and of the right kind */
  function ok(r, st) {
    return !!(r && typeof r === 'object' && r.st === st && typeof r.county === 'string' && r.county && r.county.length < 40
      && num(r.ppa) && r.ppa > 0 && num(r.acres) && r.acres > 0 && DAY.test(String(r.when || ''))
      && r.window && DAY.test(String(r.window[1] || '')) && typeof r.url === 'string' && /^\/land-sales\/[a-z-]+\/[a-z0-9-]+(#s-[0-9a-f]+)?$/.test(r.url));
  }
  function states(L) { return (L && Array.isArray(L.states) ? L.states : []).filter(function (s) { return /^[A-Z]{2}$/.test(s); }); }

  /* STALE (lead's call, Nov 4): a state whose newest 30 days on file ended more than STALE_DAYS before today (the
     page's own clock) has no sale line; New Jersey's June sale in November is withheld, never shown as news. */
  var STALE_DAYS = 60;
  function fresh(r, now) {
    var m = DAY.exec(String(r.window[1] || '')), t = now && typeof now.getTime === 'function' ? now : new Date();
    if (!m || isNaN(t.getTime())) return false;
    var end = Date.UTC(+m[1], +m[2] - 1, +m[3]), today = Date.UTC(t.getFullYear(), t.getMonth(), t.getDate());
    return (today - end) / 864e5 <= STALE_DAYS;
  }

  /* {lead, st, covered} for a reader in state `mine` ('' when unknown), or null when no state has a fresh lead.
     now: the page clock (a Date); tests pass their own. */
  function pick(L, mine, now) {
    var sts = states(L), leads = (L && L.lead) || {}, have = sts.filter(function (s) { return ok(leads[s], s) && fresh(leads[s], now); });
    if (!have.length) return null;
    if (mine && have.indexOf(mine) >= 0) return { lead: leads[mine], st: mine, covered: true, mine: mine };
    have.sort(function (a, b) { var x = leads[a], y = leads[b]; return x.when < y.when ? 1 : x.when > y.when ? -1 : y.ppa - x.ppa; });
    return { lead: leads[have[0]], st: have[0], covered: sts.indexOf(mine) >= 0, mine: mine || '' };
  }

  /* the words for each line */
  function words(L, p) {
    var r = p.lead, name = NAMES[p.st] || p.st;
    var k = (p.mine && !p.covered && NAMES[p.mine] ? 'Not yet in ' + NAMES[p.mine] + '. ' : '')
      + 'Top bare-land price in ' + name + ', 30 days to ' + day(r.window[1]);
    var pct = num(r.pct), med = num(r.med), n = num(r.n24);
    var vs = med && n ? ' ' + (pct == null || pct === 0 ? 'At' : Math.abs(pct) + '% ' + (pct > 0 ? 'above' : 'under'))
      + ' the county median, ' + money(med) + ' (' + n + ' sales in 24 months).' : '';
    var src = typeof r.src === 'string' && r.src.length < 80 ? ' ' + r.src + ' records.' : '';
    var base = acres(r.acres) + ', ' + r.county + ' County, ' + (r.basis === 'sale date' ? 'sold ' : 'recorded ') + day(r.when, true) + '.';
    var s = base + vs + src;
    var all = states(L).slice().sort();
    return { k: k, v: money(r.ppa) + ' an acre', s: s, base: base + src, href: r.url, rule: typeof r.rule === 'string' ? r.rule : '',
      all: all.length ? 'Farmland sales by county in ' + all.join(', ') : '' };
  }

  function mineState() {
    try { if (root.AgSavedPlace) { var p = root.AgSavedPlace.read(); if (p && /^[A-Z]{2}$/.test(p.state || '')) return p.state; } } catch (e) {}
    try { var o = JSON.parse(root.localStorage.getItem('agsist-wx-loc') || 'null'); if (o && /^[A-Z]{2}$/.test(o.state || '')) return o.state; } catch (e) {}
    return '';
  }
  function txt(id, t) { var e = document.getElementById(id); if (e && t) e.textContent = t; return e; }

  function hidePic() { var hp = document.getElementById('hl-pic'); if (hp) hp.hidden = true; }
  function draw(L) {
    var p = pick(L, mineState(), new Date());
    var all = states(L).slice().sort();
    if (all.length) txt('hl-all-l', 'Farmland sales by county in ' + all.join(', '));
    if (!p) { hidePic(); return; }   /* withheld: the plain words and the links stay */
    var w = words(L, p);
    txt('hl-k', w.k); txt('hl-s', w.s);
    /* picture first: the median comparison is drawn as two bars, so the line keeps only the sale's own facts */
    var pics = root.AgHomePics, r = p.lead;
    if (pics && pics.land(document.getElementById('job-land'), { ppa: r.ppa, med: num(r.med), n: num(r.n24), county: r.county, st: p.st, when: r.when, src: typeof r.src === 'string' && r.src.length < 80 ? r.src : '' })) txt('hl-s', w.base);
    var v = document.getElementById('hl-v');
    if (v) { v.textContent = w.v.replace(/ an acre$/, ''); var u = document.createElement('span'); u.className = 'hl-u'; u.textContent = ' an acre'; v.appendChild(u); }
    var a = document.getElementById('hl-sale'); if (a) { a.setAttribute('href', w.href); a.setAttribute('data-st', p.st); }
  }

  function go() {
    if (!document.getElementById('job-land')) return;
    fetch('/data/land-sales/lead.json').then(function (r) { return r.ok ? r.json() : null; }).then(function (L) { if (L) draw(L); else hidePic(); }).catch(hidePic);
  }

  var api = { pick: pick, words: words };
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.document) {
    root.AgHomeLand = api;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
  }
})(typeof self !== 'undefined' ? self : this);
