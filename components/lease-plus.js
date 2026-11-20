/* components/lease-plus.js: the first screen of /cash-lease (fx/lease-plus, Nov 20, 2026).

   1. Your county's rent: the USDA NASS county cash rent and, where a state survey publishes one, that
      survey's figure for the county (or its region), each with its source, year and count.
   2. Where your ground sits: only where the survey itself ties its rent tiers to a soil or yield number.
        Iowa      the typical corn yield of each quality third (Cash Rental Rates for Iowa 2026 Survey, C2-10);
                  ISU's rent per CSR2 point and the county's average CSR2 are printed as ISU prints them and
                  never multiplied by a field's CSR2 (that product would be our own rent formula)
        Illinois  ISPFMRA's Bulletin 811 P/I class ranges (2026 Illinois Farmland Values and Lease Trends)
        Indiana   the corn yield Purdue's respondents gave for top, average and poor land
        Ohio      the corn yield OSU's respondents gave for top, average and bottom land
      No other rent-per-point formula is used, and no other state places a field.
   3. Flex lease: the two forms ISPFMRA's 2026 regional reports describe (a base rent plus a bonus tied to
      revenue; rent as a percentage of the crop's gross proceeds; the floor and cap are our option), with the reader's own terms,
      yield and price, and RMA's projected price as an option. No number is suggested.

   One source of numbers: every figure is read from the same files the rent pages and the Atlas read
   (data/cash-rent/<ST>.json, data/land/..., data/harvest-prices.json); nothing is typed in here. The notice
   deadlines are the page's own RULES (window.AgLeaseRules), the same object the notice card uses.
   Nothing the reader types leaves the browser.

   node: module.exports (test/cash-lease-plus.test.mjs). */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && typeof root === 'object' && typeof root.document !== 'undefined') {
    root.AgLease = api;
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', function () { api.boot(root); });
    else api.boot(root);
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var NAMES = {AL:'Alabama',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',CT:'Connecticut',DE:'Delaware',FL:'Florida',GA:'Georgia',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming'};
  /* the state survey file that holds a county's rent figure (the rent pages' columns read the same files) */
  var FILES = {IA:'/data/land/ia/isu-rent.json', MN:'/data/land/mn/survey.json', ND:'/data/land/nd/survey.json',
    KS:'/data/land/ks/rent.json', IN:'/data/land/in/regions.json', NE:'/data/land/ne/regions.json',
    SD:'/data/land/sd/regions.json', OH:'/data/land/oh/regions.json', KY:'/data/land/ky/regions.json',
    CO:'/data/land/co/regions.json', IL:'/data/land/il/regions.json'};
  ['CT','MA','NH','NY','PA','RI','VT'].forEach(function (s) { FILES[s] = '/data/land/neus/regions.json'; });
  var KEY = 'agsist-lease-plus';

  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function money(v) { return isNum(v) ? '$' + (Math.round(v) === v ? v.toLocaleString('en-US') : v.toFixed(2)) : ''; }
  function money0(v) { return isNum(v) ? '$' + Math.round(v).toLocaleString('en-US') : ''; }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
  function latest(s) {
    var ys = Object.keys(s || {}).filter(function (y) { return isNum(s[y]); }).map(Number);
    if (!ys.length) return null;
    var y = Math.max.apply(null, ys); return {y: y, v: s[String(y)]};
  }
  /* the state rent page, the one home of the county rent tables (rent/<state>.html) */
  function rentSlug(st) { return String(NAMES[st] || '').toLowerCase().replace(/\s+/g, '-'); }
  function rentHref(st) { return '/rent/' + rentSlug(st); }
  function cname(name, st) { return st === 'LA' ? name + ' Parish' : name + ' County'; }
  var MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function day(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? MON[+m[2] - 1] + ' ' + (+m[3]) + ', ' + m[1] : ''; }

  /* ---- USDA NASS county cash rent (data/cash-rent/<ST>.json, scripts/fetch_cash_rent.py) ---- */
  function nass(F, fips) {
    var c = F && (F.counties || []).filter(function (x) { return x.fips === fips; })[0];
    if (!c) return null;
    var rows = [], R = c.rent || {};
    [['nonirr', 'Non-irrigated cropland'], ['irr', 'Irrigated cropland'], ['pasture', 'Pasture']].forEach(function (k) {
      var l = latest(R[k[0]]); if (l) rows.push({k: k[0], label: k[1], v: l.v, y: l.y});
    });
    var trend = c.yield && c.yield.corn && isNum(c.yield.corn.trend) ? c.yield.corn.trend : null;
    return {name: c.name, rows: rows, read: F.generated || '', corn_trend: trend};
  }

  /* ---- the state survey's figure for a county, in one shape ----
     {who, title, org, released, year, unit, where, n, nWhat, main:{label,v}, tiers:[{k,label,v,corn?,printed?}],
      kind ('survey'|'records'|'model'), notes:[...], withheld, extra} or null where the file has no row */
  function src(S) { var s = S.source || {}; return {org: s.org || '', title: s.title || '', released: s.released || ''}; }
  function base(S, who, unit, where) { var s = src(S); return {who: who, org: s.org, title: s.title, released: s.released, year: S.year, unit: unit, where: where, n: null, nWhat: '', main: null, tiers: [], kind: 'survey', notes: [], withheld: '', extra: null}; }
  function region(S, fips) { var r = S && S.counties && S.counties[fips]; return r && S.regions && S.regions[r.region] ? {r: r, R: S.regions[r.region]} : null; }
  function rcount(S, R) { return (R.counties || []).length; }
  function rwhere(S, name, R) { var n = rcount(S, R); return name + ' ' + S.unit + (n ? ' (' + n + ' counties)' : ''); }

  var SURVEY = {
    IA: function (S, fips) {
      var c = S.counties && S.counties[fips]; if (!c) return null;
      var o = base(S, 'Iowa State', 'county', cname(c.name, 'IA'));
      o.n = c.n; o.nWhat = 'responses';
      if (c.reported_with) o.notes.push('Reported together with ' + c.reported_with.join(' and ') + '.');
      if (c.withheld) { o.withheld = c.withheld; return o; }
      o.main = {label: 'Typical rent, corn and soybean land, overall average', v: c.overall};
      var cy = c.corn || {};
      o.tiers = [['high', 'High quality third'], ['medium', 'Medium quality third'], ['low', 'Low quality third']].map(function (t) {
        return {k: t[0], label: t[1], v: c[t[0]], corn: cy[t[0]]};
      });
      o.extra = {csr2: c.csr2, per_csr2: c.per_csr2};
      return o;
    },
    MN: function (S, fips) {
      var c = S.counties && S.counties[fips]; if (!c) return null;
      var o = base(S, 'University of Minnesota', 'county', cname(c.name, 'MN'));
      o.kind = 'records'; o.nWhat = 'farms';
      if (c.withheld) { o.withheld = c.withheld; return o; }
      o.main = {label: 'Cash rent farmers paid, weighted average', v: c.rent};
      if (isNum(c.median)) o.tiers.push({k: 'median', label: 'Median rent paid', v: c.median});
      if (isNum(c.p10) && isNum(c.p90)) o.tiers.push({k: 'p10', label: '10th percentile', v: c.p10}, {k: 'p90', label: '90th percentile', v: c.p90});
      o.notes.push('From FINBIN farm records; a county needs at least ' + (S.min_farms || 10) + ' reporting farms, and no count is printed for each county.');
      return o;
    },
    ND: function (S, fips) {
      var c = S.counties && S.counties[fips]; if (!c) return null;
      var o = base(S, 'North Dakota Trust Lands', 'county', cname(c.name, 'ND')), k = c.cropland || {};
      o.n = isNum(k.n) ? k.n : null; o.nWhat = 'reports';
      if (!isNum(k.rent)) { o.withheld = 'the survey withheld it (D)'; return o; }
      o.main = {label: 'Average cash rent, non-irrigated cropland', v: k.rent};
      if (isNum(k.rent_min) && isNum(k.rent_max)) o.tiers.push({k: 'min', label: 'Lowest local average reported', v: k.rent_min}, {k: 'max', label: 'Highest local average reported', v: k.rent_max});
      return o;
    },
    KS: function (S, fips) {
      var c = S.counties && S.counties[fips]; if (!c) return null;
      var o = base(S, 'K-State', 'county', cname(c.name, 'KS')), d = c.nonirr || {}, i = c.irr || {};
      o.kind = 'model';
      if (!isNum(d.est)) { o.withheld = 'no estimate for this county'; return o; }
      o.main = {label: 'Model estimate, non-irrigated', v: d.est};
      if (isNum(d.low) && isNum(d.high)) o.tiers.push({k: 'low', label: 'All crops at the 10th percentile price (scenario, not a range of rents)', v: d.low}, {k: 'high', label: 'All crops at the 90th percentile price (scenario, not a range of rents)', v: d.high});
      if (isNum(i.est)) o.tiers.push({k: 'irr', label: 'Model estimate, irrigated' + (i.anchor === 'NASS' ? ', blended toward the NASS 2026 irrigated rent' : ''), v: i.est});
      o.notes.push('A model of what a tenant can pay, not a survey of rents paid. K-State publishes no count.');
      return o;
    },
    IN: function (S, fips) {
      var g = region(S, fips); if (!g) return null;
      var o = base(S, 'Purdue', S.unit, rwhere(S, g.r.region, g.R)), R = g.R, rt = R.rent || {}, cy = R.corn || {};
      o.n = isNum(R.responses) ? R.responses : null; o.nWhat = 'responses';
      o.main = {label: 'Cash rent, average land', v: rt.average};
      o.tiers = [['top', 'Top land'], ['average', 'Average land'], ['poor', 'Poor land']].map(function (t) { return {k: t[0], label: t[1], v: rt[t[0]], corn: cy[t[0]]}; });
      if (R.limited) o.notes.push('Purdue marks this region: limited responses; interpret with caution.');
      return o;
    },
    OH: function (S, fips) {
      var g = region(S, fips); if (!g) return null;
      var o = base(S, 'Ohio State', S.unit, rwhere(S, g.r.region, g.R)), R = g.R, rt = R.rent || {}, cy = R.corn || {};
      o.n = isNum(S.respondents) ? S.respondents : null; o.nWhat = 'respondents across western Ohio';
      o.main = {label: 'Cash rent, average land (projected for ' + S.year + ')', v: rt.average};
      o.tiers = [['top', 'Top land'], ['average', 'Average land'], ['bottom', 'Bottom land']].map(function (t) { return {k: t[0], label: t[1], v: rt[t[0]], corn: cy[t[0]]}; });
      return o;
    },
    IL: function (S, fips) {
      var g = region(S, fips); if (!g) return null;
      var o = base(S, 'ISPFMRA', S.unit, rwhere(S, g.r.region, g.R)), C = g.R.classes || {}, pi = S.pi || {};
      o.year = S.year; o.nWhat = '';
      o.head = 'ISPFMRA ' + S.year + ' report (' + (S.sales_year || S.year - 1) + ' sales and leases)';
      o.tiers = [['excellent', 'Excellent productivity'], ['good', 'Good productivity'], ['average', 'Average productivity'], ['fair', 'Fair productivity']]
        .filter(function (t) { return C[t[0]] && C[t[0]].rent; })
        .map(function (t) { var r = C[t[0]].rent; return {k: t[0], label: t[1], v: isNum(r.value) ? r.value : null, printed: r.printed, pi: pi[t[0]]}; });
      o.extra = {pi: pi};
      var g2 = C.good && C.good.rent;
      if (g2) o.main = {label: 'Typical cash rent, good productivity land', v: isNum(g2.value) ? g2.value : null, printed: g2.printed};
      o.notes.push('ISPFMRA prints no count of leases behind each figure.');
      return o;
    },
    NE: function (S, fips) {
      var g = region(S, fips); if (!g) return null;
      var o = base(S, 'UNL', S.unit, rwhere(S, g.r.region, g.R)), rt = g.R.rent || {}, d = rt.dry || {}, p = rt.pivot || {};
      o.main = {label: 'Cash rent, dryland cropland', v: d.avg};
      o.tiers = [{k: 'dhigh', label: 'Dryland, high third', v: d.high}, {k: 'dlow', label: 'Dryland, low third', v: d.low}, {k: 'pivot', label: 'Center pivot irrigated, average', v: p.avg}];
      o.notes.push('UNL prints no count by district.');
      return o;
    },
    SD: function (S, fips) {
      var g = region(S, fips); if (!g) return null;
      /* the region's figure first, as the rent page and the Atlas print it; the county group's (where SDSU prints one) below */
      var R = g.R, cl = isNum(g.r.cluster) && R.clusters ? R.clusters[g.r.cluster] : null, c = (R.rent || {}).crop || {}, k = cl ? ((cl.rent || {}).crop || {}) : {};
      var o = base(S, 'SDSU', S.unit, rwhere(S, g.r.region, R));
      o.main = {label: 'Cash rent, non-irrigated cropland, average', v: c.average};
      o.tiers = [{k: 'high', label: 'High productivity', v: c.high}, {k: 'low', label: 'Low productivity', v: c.low}];
      if (cl && isNum(k.average)) o.tiers.push({k: 'group', label: 'County group ' + cl.name + ', average', v: k.average});
      if (R.limited) o.notes.push('SDSU: data for this region are limited; interpret with caution.');
      return o;
    },
    KY: function (S, fips) {
      var g = region(S, fips); if (!g) return null;
      var o = base(S, 'University of Kentucky', S.unit, rwhere(S, g.r.region, g.R)), c = (g.R.rent || {}).crop || [];
      o.n = isNum(g.R.responses) ? g.R.responses : null; o.nWhat = 'agent surveys';
      o.main = {label: 'Cash rent, good to excellent cropland', v: c[0]};
      o.tiers = [{k: 'fair', label: 'Fair cropland', v: c[1]}];
      o.notes.push('An average of county agents’ estimates for the subregion.');
      return o;
    },
    CO: function (S, fips) {
      var g = region(S, fips); if (!g) return null;
      var o = base(S, 'Colorado State', S.unit, rwhere(S, g.r.region, g.R)), rt = g.R.rent || {}, d = (rt.dry || {}).corn || {}, i = (rt.irr || {}).corn || {};
      o.main = isNum(i.median) ? {label: 'Cash rent, irrigated corn ground, median', v: i.median} : null;
      if (isNum(i.low) && isNum(i.high)) o.tiers.push({k: 'irange', label: 'Irrigated corn, range reported', printed: money(i.low) + ' to ' + money(i.high)});
      var al = (rt.irr || {}).alfalfa || {};
      if (isNum(al.median)) o.tiers.push({k: 'alfalfa', label: 'Irrigated alfalfa, median', v: al.median});
      if (isNum(d.median)) o.tiers.push({k: 'dry', label: 'Dryland corn, median', v: d.median});
      o.notes.push('CSU: the rates reported are not recommended rates.');
      return o;
    },
    NEUS: function (S, fips) {
      var g = region(S, fips); if (!g) return null;
      var o = base(S, 'Northeast ASFMRA and Cornell', S.unit, rwhere(S, g.r.region, g.R)), rt = g.R.rent;
      if (!rt) { o.withheld = 'no cropland rent printed for this region'; return o; }
      o.main = {label: 'Cropland cash rent range', v: null, printed: rt.printed};
      o.notes.push('A range seen in the region, not a typical figure.');
      return o;
    }
  };
  function survey(st, S, fips) {
    if (!S || !fips) return null;
    var f = SURVEY[st] || (S.state === 'NEUS' && (S.states || []).indexOf(st) >= 0 ? SURVEY.NEUS : null);
    return f ? f(S, fips) : null;
  }

  /* ---- where a field sits: only by the number the survey itself ties its tiers to ---- */
  function bracket(tiers, y) {
    var t = tiers.filter(function (x) { return isNum(x.corn) && isNum(x.v); }).sort(function (a, b) { return b.corn - a.corn; });
    if (t.length < 2 || !isNum(y)) return null;
    for (var i = 0; i < t.length; i++) if (y === t[i].corn) return {at: t[i]};
    if (y > t[0].corn) return {above: t[0]};
    if (y < t[t.length - 1].corn) return {below: t[t.length - 1]};
    for (var j = 0; j < t.length - 1; j++) if (y < t[j].corn && y > t[j + 1].corn) return {hi: t[j], lo: t[j + 1]};
    return null;
  }
  function piClass(pi, P) {
    if (!isNum(P) || !pi || !pi.fair) return null;
    if (P < pi.fair.below) return 'fair';
    for (var k of ['average', 'good', 'excellent']) if (pi[k] && P >= pi[k].low && P <= pi[k].high) return k;
    return pi.excellent && P > pi.excellent.high ? 'excellent' : null;
  }
  function tierLine(t) { return t.label.toLowerCase() + ' (' + t.corn + ' bu, ' + money(t.v) + ')'; }
  function place(st, P, inp) {
    if (!P || P.withheld) return null;
    var out = [];
    /* Iowa: ISU's per point figure is printed as ISU prints it (in the county block), never multiplied by a field's CSR2 */
    if ((st === 'IA' || st === 'IN' || st === 'OH') && isNum(inp.corn)) {
      var b = bracket(P.tiers, inp.corn), who = st === 'IA' ? 'USDA NASS typical yields for each third, as Iowa State prints them' : P.who + '’s respondents’ corn yields for each class';
      if (b) {
        var t;
        if (b.at) t = 'At ' + inp.corn + ' bu, your corn yield matches ' + tierLine(b.at) + '.';
        else if (b.above) t = 'At ' + inp.corn + ' bu, your corn yield is above ' + tierLine(b.above) + ', the top of the published tiers.';
        else if (b.below) t = 'At ' + inp.corn + ' bu, your corn yield is below ' + tierLine(b.below) + ', the bottom of the published tiers.';
        else t = 'At ' + inp.corn + ' bu, your corn yield sits between ' + tierLine(b.hi) + ' and ' + tierLine(b.lo) + '.';
        out.push({k: 'corn', tier: (b.at || b.above || b.below || {}).k || null, between: b.hi ? [b.hi.k, b.lo.k] : null, text: t + ' (' + who + '.)'});
      }
    }
    if (st === 'IL' && isNum(inp.pi)) {
      inp = {pi: Math.floor(inp.pi)};     /* the printed ranges are whole numbers: 116.5 is in 100 to 116 */
      var pis = (P.extra && P.extra.pi) || {}, k = piClass(pis, inp.pi), tt = P.tiers.filter(function (x) { return x.k === k; })[0];
      if (k) {
        var rg = pis[k].below ? 'below ' + pis[k].below : pis[k].low + ' to ' + pis[k].high, lbl = k + ' productivity';
        var top = pis.excellent && inp.pi > pis.excellent.high ? '; above the top of the printed scale' : '';
        out.push({k: 'pi', tier: k, v: tt ? tt.v : null, text: 'A P/I of ' + inp.pi + ' falls in ISPFMRA’s ' + lbl + ' class (' + rg + top + '). ' +
          (tt ? 'Its typical cash rent in the ' + P.where.replace(/ \(.*$/, '') + ': ' + (isNum(tt.v) ? money(tt.v) : tt.printed) + '.' : 'ISPFMRA prints no rent for that class in the ' + P.where.replace(/ \(.*$/, '') + '.') +
          ' ISPFMRA classes a tract by a significant amount of its soils, not by an average.'});
      }
    }
    return out;
  }
  function placeHow(st) {
    return st === 'IL' ? 'pi' : (st === 'IA' || st === 'IN' || st === 'OH') ? 'corn' : '';
  }

  /* ---- flex lease ----
     bonus: rent = base + share% x (gross - trigger) when gross is above the trigger, else base
     pct:   rent = pct% x gross, held between the floor and the cap when the lease sets them
     gross = yield x price, dollars an acre */
  function round2(v) { return Math.round(v * 100) / 100; }
  function flexRent(t, y, p) {
    if (!isNum(y) || !isNum(p) || y <= 0 || p <= 0) return null;
    var g = y * p, r;
    if (t.mode === 'pct') {
      if (!isNum(t.pct) || t.pct <= 0 || t.pct > 100) return null;
      if (isNum(t.floor) && isNum(t.cap) && t.floor > t.cap) return null;   /* the page says "floor is above cap" */
      r = g * t.pct / 100;
      if (isNum(t.floor) && r < t.floor) r = t.floor;
      if (isNum(t.cap) && r > t.cap) r = t.cap;
    } else {
      if (!isNum(t.base) || t.base < 0) return null;
      r = t.base;
      if (isNum(t.share) && t.share > 0 && isNum(t.trigger) && g > t.trigger) r += (g - t.trigger) * t.share / 100;
    }
    return {gross: round2(g), rent: round2(r)};
  }
  var YSTEP = [0.85, 1, 1.15], PSTEP = [0.8, 1, 1.2];
  function flexGrid(t, y, p) {
    if (!isNum(y) || !isNum(p)) return null;
    var ys = YSTEP.map(function (f) { return Math.round(y * f); }), ps = PSTEP.map(function (f) { return round2(p * f); });
    return {ys: ys, ps: ps, cells: ys.map(function (yy) { return ps.map(function (pp) { return flexRent(t, yy, pp); }); })};
  }
  function projected(H, crop) {
    if (!H || !H.commodities) return null;
    var c = H.commodities.filter(function (x) { return (x.label || '').toLowerCase() === crop; })[0];
    var p = c && c.projected;
    return p && isNum(p.price) ? {price: p.price, year: H.crop_year, status: p.status, contract: c.contract, window: p.window} : null;
  }

  /* ---- the page ---- */
  function getJSON(w, u) { return w.fetch(u).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); }
  function num(el) { if (!el) return null; var v = String(el.value || '').replace(/[$,\s]/g, ''); if (!v) return null; v = Number(v); return isFinite(v) ? v : null; }
  function load(w) { try { return JSON.parse(w.localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; } }
  function store(w, o) { try { w.localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) {} }

  function boot(w) {
    var d = w.document, box = d.getElementById('lp-county');
    if (!box || box.getAttribute('data-on')) return;
    box.setAttribute('data-on', '1');
    var $ = function (id) { return d.getElementById(id); };
    var stSel = $('lp-st'), coSel = $('lp-co'), out = $('lp-out'), mem = load(w), cache = {}, cur = {st: '', fips: '', P: null, N: null};
    function get(u) { if (!cache[u]) cache[u] = getJSON(w, u); return cache[u]; }
    stSel.innerHTML = '<option value="">Pick a state</option>' + Object.keys(NAMES).sort(function (a, b) { return NAMES[a] < NAMES[b] ? -1 : 1; })
      .map(function (s) { return '<option value="' + s + '">' + NAMES[s] + '</option>'; }).join('');

    function counties(st) {
      coSel.disabled = true; coSel.innerHTML = '<option value="">Loading counties</option>';
      return get('/data/cash-rent/' + st + '.json').then(function (F) {
        var cs = (F && F.counties || []).slice().sort(function (a, b) { return a.name < b.name ? -1 : 1; });
        coSel.innerHTML = '<option value="">Pick a county</option>' + cs.map(function (c) { return '<option value="' + esc(c.fips) + '">' + esc(c.name) + '</option>'; }).join('');
        coSel.disabled = !cs.length;
        if (!cs.length) out.innerHTML = '<p class="lp-msg">USDA NASS publishes no county cash rent for ' + esc(NAMES[st] || st) + '.</p>';
        return F;
      });
    }
    function rentHtml(st, N, P) {
      var h = '<h2 class="lp-where">' + esc(cname(N.name, st)) + ', ' + esc(NAMES[st]) + '</h2>';
      var top = N.rows[0];
      if (top) {
        h += '<div class="lp-big"><span class="lp-v">' + money(top.v) + '</span><span class="lp-u"> an acre</span></div>'
          + '<p class="lp-k">' + esc(top.label) + ', USDA NASS ' + top.y + '</p>';
        var rest = N.rows.slice(1).map(function (r) { return esc(r.label) + ' ' + money(r.v) + (r.y !== top.y ? ' (' + r.y + ')' : ''); });
        if (rest.length) h += '<p class="lp-s">' + rest.join(' &middot; ') + '</p>';
        h += '<p class="lp-src">USDA NASS Cash Rents Survey, county estimates' + (N.read ? ', read ' + day(N.read) : '') + '. This page shows no response count for the NASS figure.</p>';
      } else h += '<p class="lp-msg">NASS shows no recent cash rent for this county.</p>';
      if (P) {
        h += '<div class="lp-sv"><h3>' + esc(P.head || (P.who + (P.kind === 'model' ? ' model estimate ' : P.kind === 'records' ? ' farm records ' : ' survey ') + P.year)) + ': ' + esc(P.where) + '</h3>';
        if (P.withheld) h += '<p class="lp-s">No figure: ' + esc(P.withheld) + '.</p>';
        else {
          if (P.main) h += '<p class="lp-m"><b>' + (isNum(P.main.v) ? money(P.main.v) : esc(P.main.printed || '')) + '</b> ' + esc(P.main.label.charAt(0).toLowerCase() + P.main.label.slice(1)) + '</p>';
          /* compact: the tiers show only where the soil placement below uses them; every other figure lives on /rent/<state> */
          var tl = placeHow(st) ? P.tiers.filter(function (t) { return isNum(t.v) || t.printed; }) : [];
          if (tl.length) h += '<ul class="lp-tiers">' + tl.map(function (t) {
            return '<li data-k="' + esc(t.k) + '"><span>' + esc(t.label) + (isNum(t.corn) ? ' <i>' + t.corn + ' bu corn</i>' : '') + (t.pi ? ' <i>P/I ' + (t.pi.below ? 'under ' + t.pi.below : t.pi.low + ' to ' + t.pi.high) + '</i>' : '') + '</span><b>' + (isNum(t.v) ? money(t.v) : esc(t.printed)) + '</b></li>';
          }).join('') + '</ul>';
          /* Iowa: ISU's own per point figure and the county's average CSR2, as printed; no rent is figured from them */
          if (P.extra && isNum(P.extra.per_csr2) && isNum(P.extra.csr2)) h += '<p class="lp-s">ISU: ' + money(P.extra.per_csr2) + ' per CSR2 point, county average CSR2 ' + P.extra.csr2 + '.</p>';
        }
        var cnt = isNum(P.n) ? P.n + ' ' + P.nWhat : '';
        h += '<p class="lp-src">' + esc(P.org) + ', ' + esc(P.title) + (P.released ? ', ' + esc(P.released) : '') + (cnt ? '. ' + esc(cnt) : '') + '.' + (P.notes.length ? ' ' + esc(P.notes.join(' ')) : '') + '</p></div>';
      }
      h += '<p class="lp-all"><a href="' + rentHref(st) + '">Every county in ' + esc(NAMES[st]) + ': /rent/' + rentSlug(st) + '</a></p>';
      var R = w.AgLeaseRules && w.AgLeaseRules[st];
      if (R && R.v) h += '<p class="lp-notice"><b>' + esc(NAMES[st]) + ' notice deadline:</b> ' + esc(R.short || '') + ' (' + esc(R.s || '') + ', read against the statute text saved ' + esc(day(R.v)) + '). <a href="#notice">Count your date and print the notice</a>.</p>';
      return h;
    }
    function show(st, fips) {
      cur = {st: st, fips: fips, P: null, N: null};
      mem.st = st; mem.fips = fips; store(w, mem);
      if (!st || !fips) { soil(); flexDraw(); return Promise.resolve(); }
      out.setAttribute('aria-busy', 'true');
      return Promise.all([get('/data/cash-rent/' + st + '.json'), FILES[st] ? get(FILES[st]) : Promise.resolve(null)]).then(function (r) {
        if (cur.st !== st || cur.fips !== fips) return;
        var N = nass(r[0], fips), P = survey(st, r[1], fips);
        cur.N = N; cur.P = P;
        out.removeAttribute('aria-busy');
        out.innerHTML = N ? rentHtml(st, N, P) : '<p class="lp-msg">No NASS row for this county.</p>';
        soil(); flexSeed(); flexDraw();
      });
    }
    stSel.addEventListener('change', function () { var st = stSel.value; mem.fips = ''; if (!st) { coSel.innerHTML = ''; return show('', ''); } counties(st).then(function () { show(st, ''); }); });
    coSel.addEventListener('change', function () { show(stSel.value, coSel.value); });

    /* soil tier */
    var sBox = $('lp-soil');
    function soil() {
      if (!sBox) return;
      var st = cur.st, P = cur.P, how = placeHow(st);
      var ins = sBox.querySelectorAll('[data-how]');
      for (var i = 0; i < ins.length; i++) ins[i].hidden = !how || ins[i].getAttribute('data-how').split(' ').indexOf(how) < 0;
      var res = $('lp-soil-out');
      if (!st || !cur.fips) { res.innerHTML = '<p class="lp-msg">Pick a county above first.</p>'; return; }
      if (!how || !P || P.withheld) { res.innerHTML = '<p class="lp-msg">' + (P && P.withheld ? 'The survey has no figure for this county, so there is nothing to place a field against.' : 'No survey we read in ' + esc(NAMES[st]) + ' ties its rent tiers to a soil index or a yield, so we do not place a field here. The county figures above are the benchmark.') + '</p>'; return; }
      /* the field's numbers are not kept between visits: a figure from a last visit would read as this field's */
      var inp = {corn: num($('lp-corn')), pi: num($('lp-pi'))};
      if (isNum(inp.pi) && (inp.pi < 40 || inp.pi > 160)) inp.pi = null;
      if (isNum(inp.corn) && (inp.corn < 20 || inp.corn > 400)) inp.corn = null;
      var L = place(st, P, inp) || [];
      var lis = out.querySelectorAll('.lp-tiers li');
      for (var j = 0; j < lis.length; j++) lis[j].classList.remove('lp-hit');
      L.forEach(function (x) { (x.between || (x.tier ? [x.tier] : [])).forEach(function (k) { var li = out.querySelector('.lp-tiers li[data-k="' + k + '"]'); if (li) li.classList.add('lp-hit'); }); });
      res.innerHTML = L.length ? L.map(function (x) { return '<p class="lp-pl">' + esc(x.text) + '</p>'; }).join('')
        : '<p class="lp-msg">' + (how === 'pi' ? 'Enter the field’s P/I (Bulletin 811) to see its class.' : how === 'corn' ? 'Enter the field’s typical corn yield to see where it sits among the tiers.' : '') + '</p>';
    }
    ['lp-corn', 'lp-pi'].forEach(function (id) { var e = $(id); if (e) e.addEventListener('input', soil); });

    /* flex lease */
    var fBox = $('lp-flex'), H = null;
    var F = {mode: $('lp-f-mode'), crop: $('lp-f-crop'), base: $('lp-f-base'), share: $('lp-f-share'), trigger: $('lp-f-trigger'), pct: $('lp-f-pct'), floor: $('lp-f-floor'), cap: $('lp-f-cap'), yld: $('lp-f-yield'), price: $('lp-f-price')};
    function flexTerms() {
      return {mode: F.mode && F.mode.value === 'pct' ? 'pct' : 'bonus', base: num(F.base), share: num(F.share), trigger: num(F.trigger), pct: num(F.pct), floor: num(F.floor), cap: num(F.cap)};
    }
    function flexSeed() {
      /* the county's figures as starting points the reader can see and change: the NASS rent as a base and the
         county's trend corn yield (the same figure the Atlas county page prints); never the share, trigger or percent */
      var N = cur.N; if (!N || !F.base) return;
      var hint = $('lp-f-hint');
      if (hint) hint.textContent = (N.rows[0] ? 'This county’s NASS rent is ' + money(N.rows[0].v) + '. ' : '') + (isNum(N.corn_trend) ? 'Its corn trend yield is ' + Math.round(N.corn_trend) + ' bu.' : '');
    }
    function flexDraw() {
      if (!fBox) return;
      var t = flexTerms(), crop = F.crop && F.crop.value === 'soybeans' ? 'soybeans' : 'corn', y = num(F.yld), p = num(F.price);
      var shows = fBox.querySelectorAll('[data-mode]');
      for (var i = 0; i < shows.length; i++) shows[i].hidden = shows[i].getAttribute('data-mode') !== t.mode;
      var pj = projected(H, crop), pb = $('lp-f-proj');
      if (pb) { pb.hidden = !pj; if (pj) pb.textContent = 'Use the ' + pj.year + ' projected price, ' + money(pj.price) + (pj.status === 'final' ? '' : ' so far'); }
      var res = $('lp-f-out');
      var ok = t.mode === 'pct' ? isNum(t.pct) : isNum(t.base);
      mem.flex = {mode: t.mode, crop: crop, base: t.base, share: t.share, trigger: t.trigger, pct: t.pct, floor: t.floor, cap: t.cap, y: y, p: p}; store(w, mem);
      if (t.mode === 'pct' && isNum(t.floor) && isNum(t.cap) && t.floor > t.cap) { res.innerHTML = '<p class="lp-msg">The floor is above the cap. Lower the floor or raise the cap.</p>'; return; }
      if (!ok || !isNum(y) || !isNum(p)) { res.innerHTML = '<p class="lp-msg">Enter your lease terms, a yield and a price to see the rent at nine outcomes.</p>'; return; }
      var G = flexGrid(t, y, p), unit = 'bu';
      var h = '<table class="lp-grid"><caption>Rent per acre at three yields (rows) and three prices (columns), gross per acre below each</caption><thead><tr><th scope="col">Yield</th>'
        + G.ps.map(function (pp) { return '<th scope="col">' + money(pp) + '</th>'; }).join('') + '</tr></thead><tbody>'
        + G.ys.map(function (yy, a) {
          return '<tr><th scope="row">' + yy + ' ' + unit + '</th>' + G.cells[a].map(function (c, b) {
            return '<td' + (a === 1 && b === 1 ? ' class="lp-mid"' : '') + '>' + (c ? '<b>' + money0(c.rent) + '</b><small>' + money0(c.gross) + '</small>' : '') + '</td>';
          }).join('') + '</tr>';
        }).join('') + '</tbody></table>';
      var mid = G.cells[1][1];
      h += '<p class="lp-s">At ' + y + ' bu and ' + money(p) + ', gross is ' + money0(mid.gross) + ' an acre and the rent is ' + money0(mid.rent) + ' (' + Math.round(mid.rent / mid.gross * 1000) / 10 + '% of gross). The other cells move yield 15% and price 20% either way; they are outcomes to compare, not forecasts.</p>';
      res.innerHTML = h;
    }
    if (fBox) {
      var fm = mem.flex || {};
      if (F.mode && fm.mode) F.mode.value = fm.mode;
      if (F.crop && fm.crop) F.crop.value = fm.crop;
      [['base', 'base'], ['share', 'share'], ['trigger', 'trigger'], ['pct', 'pct'], ['floor', 'floor'], ['cap', 'cap'], ['yld', 'y'], ['price', 'p']].forEach(function (k) { if (F[k[0]] && fm[k[1]] != null) F[k[0]].value = fm[k[1]]; });
      Object.keys(F).forEach(function (k) { if (F[k]) { F[k].addEventListener('input', flexDraw); F[k].addEventListener('change', flexDraw); } });
      var pbtn = $('lp-f-proj');
      if (pbtn) pbtn.addEventListener('click', function () { var pj = projected(H, F.crop && F.crop.value === 'soybeans' ? 'soybeans' : 'corn'); if (pj && F.price) { F.price.value = pj.price; flexDraw(); } });
      get('/data/harvest-prices.json').then(function (h) { H = h; flexDraw(); });
    }

    /* start: the reader's last pick, else the saved place, else nothing */
    function startWith(st, countyName, fips) {
      if (!NAMES[st]) return;
      stSel.value = st;
      counties(st).then(function (Fl) {
        var f = fips;
        if (!f && countyName && Fl) { var c = (Fl.counties || []).filter(function (x) { return x.name.toLowerCase() === countyName.toLowerCase(); })[0]; if (c) f = c.fips; }
        if (f && coSel.querySelector('option[value="' + f + '"]')) { coSel.value = f; show(st, f); } else show(st, '');
      });
    }
    /* a rent page's link (/cash-lease?st=IA) opens on that state; the reader picks the county */
    var qst = ''; try { qst = String(new w.URLSearchParams(w.location.search).get('st') || '').toUpperCase(); } catch (e) { qst = ''; }
    if (NAMES[qst] && qst !== mem.st) startWith(qst, '', '');
    else if (mem.st) startWith(mem.st, '', mem.fips);
    else {
      var p = null; try { p = w.AgSavedPlace ? w.AgSavedPlace.read() : null; } catch (e) { p = null; }
      if (p && p.state) startWith(p.state, p.county, '');
      else if (p && p.zip && w.AgSavedPlace && w.AgSavedPlace.full) w.AgSavedPlace.full().then(function (q) { if (q && q.state && !stSel.value) startWith(q.state, q.county, ''); });
      else { soil(); flexDraw(); }
    }
  }

  return {NAMES: NAMES, FILES: FILES, rentHref: rentHref, nass: nass, survey: survey, place: place, placeHow: placeHow, bracket: bracket, piClass: piClass,
    flexRent: flexRent, flexGrid: flexGrid, projected: projected, money: money, boot: boot};
});
