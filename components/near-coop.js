/* components/near-coop.js: "Your area" on /fertilizer and /nutrient-removal.
   The page holds <aside class="nc" data-near-coop="fert|nr"> with a link to the
   ZIP search, and loads this file only when a location is saved (agsist-wx-loc,
   else agsist_zip). Reads that location, writes and sends nothing about the
   reader (a ZIP with no point asks the bids site for its two-digit ZIP table,
   as the cash bids search does). Public files, arithmetic here; a stale or
   missing number stays missing. Tests: test/near-coop.test.mjs. */
(function (root) {
  'use strict';
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var FR = { 0: '', 25: '¼', 50: '½', 75: '¾' };
  var DAY = 864e5, FAR_MI = 150;
  var NM = {};
  var Z3 = '005NY006--010MA028RI030NH039ME050VT055MA056VT060CT070NJ090--100NY150PA197DE200DC201VA202DC206MD220VA247WV270NC290SC300GA320FL340--341FL350AL370TN386MS398GA400KY430OH460IN480MI500IA530WI550MN569DC570SD580ND590MT600IL630MO660KS680NE700LA716AR730OK733TX734OK750TX800CO820WY832ID840UT850AZ870NM885TX889NV900CA962--967HI969--970OR980WA995AK';
  function zipState(zip) {
    if (!/^\d{5}$/.test(zip || '')) return '';
    var p = +zip.slice(0, 3), st = '';
    for (var i = 0; i < Z3.length; i += 5) { if (+Z3.substr(i, 3) > p) break; st = Z3.substr(i + 3, 2); }
    return st === '--' ? '' : st;
  }
  function readLoc(ls) {
    var o = null, z = '';
    try { o = JSON.parse(ls.getItem('agsist-wx-loc') || 'null'); } catch (e) { o = null; }
    if (o && typeof o === 'object') {
      var st = /^[A-Z]{2}$/.test(o.state || '') ? o.state : '';
      z = /^\d{5}$/.test(o.zip || '') ? o.zip : '';
      var lat = +o.lat, lon = +o.lon, pt = isFinite(lat) && isFinite(lon) && o.lat != null && o.lon != null && !(lat === 0 && lon === 0);
      if (st || z || pt) return { state: st || zipState(z), zip: z, lat: pt ? lat : null, lon: pt ? lon : null };
    }
    try { z = String(ls.getItem('agsist_zip') || ''); } catch (e) { z = ''; }
    return /^\d{5}$/.test(z) ? { state: zipState(z), zip: z, lat: null, lon: null } : null;
  }
  function miles(a1, o1, a2, o2) {
    var d = Math.PI / 180, s = Math.sin((a2 - a1) * d / 2), t = Math.sin((o2 - o1) * d / 2);
    return 3958.8 * 2 * Math.asin(Math.sqrt(s * s + Math.cos(a1 * d) * Math.cos(a2 * d) * t * t));
  }
  function good(x) { return typeof x === 'number' && isFinite(x) && x > 0; }
  function isDay(s) { return typeof s === 'string' && /^\d{4}-\d\d-\d\d$/.test(s); }
  function ct(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    try { return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric' }).format(d); }
    catch (e) { return MON[d.getUTCMonth()] + ' ' + d.getUTCDate(); }
  }
  function day(iso) { var m = /^(\d{4})-(\d\d)-(\d\d)/.exec(iso || ''); return m ? MON[+m[2] - 1] + ' ' + (+m[3]) : ''; }
  function age(iso, now) { var t = Date.parse(iso); return isNaN(t) ? Infinity : (now - t) / DAY; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function usd(n) { return '$' + (Math.round(n) === Math.round(n * 100) / 100 ? Math.round(n).toLocaleString('en-US') : (Math.round(n * 100) / 100).toFixed(2)); }
  function usd2(n) { return '$' + (Math.round(n * 100) / 100).toFixed(2); }
  function fut(c) {
    var q = Math.round(c * 4) / 4, w = Math.floor(q / 100), r = q - w * 100, rc = Math.floor(r);
    return '$' + w + '.' + (rc < 10 ? '0' : '') + rc + FR[Math.round((r - rc) * 100)];
  }
  function qc(c) { var q = Math.round(Math.abs(c) * 4) / 4, w = Math.floor(q), f = Math.round((q - w) * 100); return (w || !f ? String(w) : '') + FR[f]; }
  function stName(st) { return NM[st] || st; }
  function names(bs) { NM = {}; var s = bs && bs.states; for (var k in s) if (s[k] && s[k].name) NM[k] = s[k].name; }
  function coops(doc, places, loc) {
    var names = {}, out = [];
    ((doc && doc.summary) || []).forEach(function (s) { if (s && s.key) names[s.key] = s.name; });
    var pl = (places && places.coops) || {};
    ((doc && doc.coops) || []).forEach(function (c) {
      if (!c || !c.id || c.ok === false) return;
      var seen = {}, rows = [];
      (c.rows || []).forEach(function (r) {
        if (!r || !names[r.product] || seen[r.product] || r.stale || (r.flags && r.flags.length) || !good(r.cash) || !isDay(r.date)) return;
        seen[r.product] = 1;
        rows.push({ key: r.product, name: names[r.product], cash: r.cash, date: r.date });
      });
      if (!rows.length) return;
      var p = pl[c.id], mi = null;
      if (p && loc && loc.lat != null && good(Math.abs(p.lat)) && good(Math.abs(p.lng))) mi = miles(loc.lat, loc.lon, p.lat, p.lng);
      out.push({ id: c.id, name: c.name, town: p ? p.town : (c.town || ''), state: c.state, url: /^https:\/\//.test(c.url || '') ? c.url : '', basis: c.cash_label || 'cash', rows: rows, mi: mi });
    });
    var st = loc && loc.state;
    out.sort(function (a, b) {
      if (a.mi != null && b.mi != null) return a.mi - b.mi;
      if (a.mi != null || b.mi != null) return a.mi != null ? -1 : 1;
      return (b.state === st) - (a.state === st);
    });
    return out;
  }
  function rowOf(c, key) { for (var i = 0; i < c.rows.length; i++) if (c.rows[i].key === key) return c.rows[i]; return null; }
  function where(c) { return esc(c.name) + (c.town ? ', ' + esc(c.town) : '') + ', ' + esc(c.state); }
  function far(c) { return c.mi == null ? '' : c.mi < 5 ? 'under 5 miles' : 'about ' + Math.round(c.mi / 5) * 5 + ' miles'; }
  function posted(c) {
    var ds = c.rows.map(function (r) { return r.date; }).sort(), lo = ds[0], hi = ds[ds.length - 1];
    return 'posted ' + (lo === hi ? day(hi) : day(lo) + ' to ' + day(hi)) + ' (' + esc(c.basis) + ')';
  }
  function stateCorn(bs, prices, st, now) {
    var s = bs && bs.states && st ? bs.states[st] : null, b = s && s.crops && s.crops.corn;
    if (!b || typeof b.median !== 'number' || !isFinite(b.median) || !bs.generated || age(bs.generated, now) > 10) return null;
    var q = null, qs = prices && prices.quotes, t = b.contract + '.CBT';
    for (var k in qs) if (qs[k] && qs[k].ticker === t && typeof qs[k].close === 'number') { q = qs[k]; break; }
    if (!q || !isDay(q.close_date) || Math.abs(age(q.close_date + 'T12:00:00Z', Date.parse(bs.generated))) > 5) return null;
    var cash = Math.round(Math.round((q.close + b.median * 100) * 1e6) / 1e6) / 100;
    return { cash: cash, close: q.close, closeDate: q.close_date, basis: b.median, label: b.label || b.contract, n: b.n, name: s.name || stName(st), asOf: bs.generated, path: s.path || '' };
  }
  function basisWords(m) { var c = Math.round(m * 1e4) / 100; return Math.abs(c) < 0.125 ? 'even' : qc(c) + '¢ ' + (c < 0 ? 'under' : 'over'); }
  function cornWords(sc) {
    return sc.label + ' corn ' + fut(sc.close) + ' (close ' + day(sc.closeDate) + ') ' + (sc.basis < 0 ? 'less' : 'plus') + ' the ' + esc(sc.name) + ' median basis of ' + qc(Math.abs(sc.basis * 100)) + '¢';
  }
  function cheapN(pl) {
    var best = null;
    ((pl && pl.prices) || []).forEach(function (r) {
      var m = r && /^(\d+(?:\.\d+)?)-0-0\b/.exec(r.symbol || '');
      if (!m || !good(r.price) || !(+m[1] > 0) || !isDay(r.as_of)) return;
      var lb = r.price / (20 * +m[1]);
      if (!best || lb < best.lb) best = { name: r.name, price: r.price, lb: lb, region: r.region || '', label: r.short_label || r.src_label || day(r.as_of) };
    });
    return best;
  }

  function head(loc) { var n = loc.state ? stName(loc.state) : ''; return '<p class="nc-k">Your area' + (n ? ': ' + esc(n) : '') + '</p>'; }
  function coopLines(list, loc) {
    var out = [], st = loc.state, inSt = list.filter(function (c) { return c.state === st; });
    var near = list[0];
    if (!list.length) return out;
    if (st && !inSt.length) {
      out.push('No co-op in ' + esc(stName(st)) + ' posts prices we read yet.' + (near.mi != null
        ? ' The nearest we read is ' + where(near) + ', ' + far(near) + ' away' + (near.mi > FAR_MI ? ': a reference for what co-ops charge, not your price' : '') + '.'
        : ' The co-ops we read are in ' + list.map(function (c) { return c.state; }).filter(function (s, i, a) { return a.indexOf(s) === i; }).map(stName).join(' and ') + '.'));
      return out;
    }
    var first = inSt.length ? inSt[0] : near;
    out.push('<b>' + (first.mi != null ? 'Nearest co-op we read' : 'Co-op we read in ' + esc(stName(first.state))) + ':</b> ' + where(first) + (first.mi != null ? ', ' + far(first) : '') + '. ' +
      first.rows.map(function (r) { return esc(r.name) + ' ' + usd(r.cash); }).join(', ') + ' a ton, ' + posted(first) + '.');
    var rest = (inSt.length ? inSt : list).filter(function (c) { return c !== first; }).slice(0, 3);
    if (rest.length) out.push('Also read' + (inSt.length ? ' in ' + esc(stName(st)) : '') + ': ' + rest.map(function (c) {
      return esc(c.name) + (c.town ? ', ' + esc(c.town) : '') + ' (' + (c.mi != null ? far(c) : c.town ? 'no distance' : 'town not posted') + ')';
    }).join('; ') + '.');
    return out;
  }
  function links(loc, sc) {
    var l = [];
    if (loc.zip) l.push('<a href="/cash-bids?zip=' + loc.zip + '">Bids near ' + loc.zip + ' &rarr;</a>');
    if (sc && sc.path) l.push('<a href="' + esc(sc.path) + '">' + esc(sc.name) + ' basis</a>');
    return l.length ? '<p class="nc-l">' + l.join(' &middot; ') + '</p>' : '';
  }
  function srcLine(parts) { return parts.length ? '<p class="nc-s">' + parts.join(' ') + '</p>' : ''; }
  function milesNote(list) {
    return list.some(function (c) { return c.mi != null; }) ? 'Miles are straight line from your saved spot to the co-op’s town (a town point, not its address); roads run farther.' : '';
  }
  function buildFert(o) {
    names(o.basis);
    var loc = o.loc, now = o.now || Date.now(), list = coops(o.coops, o.places, loc), out = coopLines(list, loc), src = [];
    var sc = stateCorn(o.basis, o.prices, loc.state, now), n = cheapN(o.list);
    if (sc && n) {
      var r = n.lb / sc.cash, rf = n.lb / (sc.close / 100);
      out.push('<b>N:corn at ' + esc(sc.name) + ' basis: ' + r.toFixed(3) + '</b>. ' + esc(n.name) + (n.region ? ' (' + esc(n.region) + ' co-ops, middle)' : '') + ' at ' + usd(n.price) + ' a ton is ' + usd2(n.lb) + ' a lb of N. ' +
        cornWords(sc) + ' is about ' + usd2(sc.cash) + ' cash. On futures alone the ratio is ' + rf.toFixed(3) + '; basis makes N ' + (r > rf ? 'dearer' : 'cheaper') + ' against your corn.');
      src.push('N: ' + esc(n.label) + '. Basis: median of ' + sc.n + ' AGSIST network elevators in ' + esc(sc.name) + ', bids as of ' + ct(sc.asOf) + '.');
    }
    if (list.length) src.unshift('Co-op prices as each co-op posted them. Call to confirm.');
    src.push(milesNote(list));
    if (!out.length) out.push('No co-op prices or state basis to show for your area right now.');
    return head(loc) + out.map(function (s) { return '<p>' + s + '</p>'; }).join('') + links(loc, sc) + srcLine(src.filter(Boolean));
  }
  function buildNR(o) {
    names(o.basis);
    var loc = o.loc, now = o.now || Date.now(), NR = o.NR, out = [], src = [];
    var sc = stateCorn(o.basis, o.prices, loc.state, now);
    var stover = NR && NR.crop && NR.crop('corn_stover'), pr = NR && o.list ? NR.nutrientPrices(o.list) : null;
    var v = stover && pr ? NR.value({ p: stover.p, k: stover.k, n: null }, pr) : null;
    if (sc && v && v.pk != null) {
      out.push('<b>A dry ton of stalks is about ' + (v.pk / sc.cash).toFixed(1) + ' bushels of your corn.</b> Putting its P and K back costs ' + usd2(v.pk) + ' at the co-op prices this page uses; ' + cornWords(sc) + ' is about ' + usd2(sc.cash) + ' cash.');
      src.push('Basis: median of ' + sc.n + ' AGSIST network elevators in ' + esc(sc.name) + ', bids as of ' + ct(sc.asOf) + '.');
    }
    var list = coops(o.coops, o.places, loc).filter(function (c) { return rowOf(c, 'potash'); });
    var inSt = list.filter(function (c) { return c.state === loc.state; }), c = inSt[0] || list[0];
    if (c && stover && (c.state === loc.state || (c.mi != null && c.mi <= FAR_MI))) {
      var k = rowOf(c, 'potash'), kLb = k.cash / 1200, ph = rowOf(c, 'map') || rowOf(c, 'dap'), u = rowOf(c, 'urea'), pLb = null;
      if (ph && u) { var g = ph.key === 'map' ? [11, 52] : [18, 46]; pLb = (ph.cash - 20 * g[0] * u.cash / 920) / (20 * g[1]); if (!(pLb > 0)) pLb = null; }
      var kv = stover.k * kLb;
      out.push('<b>At ' + where(c) + (c.mi != null ? ' (' + far(c) + ')' : '') + ':</b> potash ' + usd(k.cash) + ' a ton (' + day(k.date) + ') is ' + usd2(kLb) + ' a lb of K₂O, so a dry ton of stalks’ ' + stover.k + ' lb is ' + usd2(kv) + '.' +
        (pLb != null ? ' With its ' + esc(ph.name) + ' (' + usd(ph.cash) + ', N credited at its urea), the ' + stover.p + ' lb of P₂O₅ adds ' + usd2(stover.p * pLb) + ': ' + usd2(kv + stover.p * pLb) + ' a dry ton there.' : ' This co-op posts no MAP or DAP with urea, so phosphate is not priced at its prices.'));
      src.unshift('Co-op prices as that co-op posted them (' + esc(c.basis) + '); A2809 pounds. Call to confirm.');
    } else if (loc.state && c) {
      out.push('No co-op in ' + esc(stName(loc.state)) + ' posts a potash price we read yet' + (c && c.mi != null ? '; the nearest is ' + where(c) + ', ' + far(c) + ' away' : '') + '.');
    }
    src.push(c && c.mi != null ? milesNote([c]) : '');
    if (!out.length) out.push('No state basis or co-op price to show for your area right now.');
    return head(loc) + out.map(function (s) { return '<p>' + s + '</p>'; }).join('') + links(loc, sc) + srcLine(src.filter(Boolean));
  }
  function none() { return '<p class="nc-none"><a href="/cash-bids">See this for your area</a></p>'; }

  var api = { zipState: zipState, readLoc: readLoc, miles: miles, coops: coops, stateCorn: stateCorn, cheapN: cheapN, buildFert: buildFert, buildNR: buildNR, none: none, basisWords: basisWords };
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }
  root.AGSIST_NEAR_COOP = api;

  var doc = root.document;
  var CSS = 'aside.nc{margin:1rem 0;padding:.7rem .9rem;border:1px solid var(--border);border-left:3px solid var(--green);border-radius:8px;background:var(--surface);font-size:.88rem;line-height:1.55;color:var(--text-dim)}aside.nc p{margin:.3rem 0;font-size:inherit;line-height:inherit;color:inherit}aside.nc b{color:var(--text)}aside.nc .nc-k{font-family:"JetBrains Mono",monospace;font-size:.68rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--green)}aside.nc a{color:var(--gold);display:inline-block;padding:.35rem 0}aside.nc .nc-s{font-size:.76rem;color:var(--text-muted)}';
  function get(u) { return fetch(u, { cache: 'default' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); }
  function point(loc) {
    if (loc.lat != null || !loc.zip) return Promise.resolve(loc);
    return get('https://dnilgis.github.io/bids/data/zips/' + loc.zip.slice(0, 2) + '.json').then(function (t) {
      var p = t && t[loc.zip];
      if (Array.isArray(p) && isFinite(+p[0]) && isFinite(+p[1]) && !(+p[0] === 0 && +p[1] === 0)) { loc.lat = +p[0]; loc.lon = +p[1]; }
      return loc;
    });
  }
  function fill(el, loc) {
    var mode = el.getAttribute('data-near-coop');
    Promise.all([get('/data/fertilizer-coops.json'), get('/data/fert-coop-places.json'), get('/data/basis-states.json'), get('/data/prices.json'), get('/data/fertilizer-prices.json'), point(loc)]).then(function (r) {
      var o = { loc: r[5], coops: r[0], places: r[1], basis: r[2], prices: r[3], list: r[4], NR: root.NutrientRemoval };
      el.innerHTML = mode === 'nr' ? buildNR(o) : buildFert(o);
    });
  }
  function boot() {
    var loc = null;
    try { loc = readLoc(root.localStorage); } catch (e) { loc = null; }
    if (!loc) return;
    var st = doc.createElement('style'); st.textContent = CSS; doc.head.appendChild(st);
    Array.prototype.forEach.call(doc.querySelectorAll('[data-near-coop]'), function (el) {
      el.className = 'nc';
      el.innerHTML = head(loc) + '<p>Loading prices for your area&hellip;</p>';
      fill(el, loc);
    });
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot); else boot();
})(typeof window !== 'undefined' ? window : this);
