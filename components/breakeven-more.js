/* components/breakeven-more.js: the parts of /breakeven a reader opens, not
   the ones he reads first. Loaded by components/breakeven.js when the reader
   has a saved county or saved location, first touches the county box, or taps
   a ? tip. Holds the county box and the tips under the ? buttons.

   One small file per state, data/breakeven/<ST>.json
   (scripts/build_breakeven_data.py): NASS county cash rent, the paired county
   trend yield, and the expected ARC-CO and PLC payments per base acre as
   scripts/build_arc_plc.py figured them. The saved location is read only
   (agsist-wx-loc, written by geo.js) and never sent. A ZIP with no county
   saved is not enough to pick a county.

   Tests: test/breakeven-h2h.test.mjs, test/breakeven-best.test.mjs. */
(function () {
  'use strict';
  var W = window, D = document, B = W.AgBE;
  if (!B || W.AgBECounty) return;
  var $ = B.$, esc = B.esc, money = B.money, day = B.day, crop = B.crop, cropYear = B.cropYear, setSrc = B.setSrc, lsGet = B.lsGet, lsSet = B.lsSet;
  var calcBreakeven = B.calc, renderSrc = B.renderSrc;
  var CO_STATES = { AL: 'Alabama', AR: 'Arkansas', AZ: 'Arizona', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia', IA: 'Iowa', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', MA: 'Massachusetts', MD: 'Maryland', ME: 'Maine', MI: 'Michigan', MN: 'Minnesota', MO: 'Missouri', MS: 'Mississippi', MT: 'Montana', NC: 'North Carolina', ND: 'North Dakota', NE: 'Nebraska', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NV: 'Nevada', NY: 'New York', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VA: 'Virginia', VT: 'Vermont', WA: 'Washington', WI: 'Wisconsin', WV: 'West Virginia', WY: 'Wyoming' };
  var PRACTICE = { nonirr: 'non-irrigated', irr: 'irrigated', all: 'all-practice' };
  var NO_ARC_PAGE = { CT: 1 };
  var _coData = null, _coSt = '', _coAuto = '';
  function coSave() { var c = $('co-co'); lsSet('agsist-be-county', _coSt && c && c.value ? _coSt + '|' + c.value : ''); }
  function coLoad(st, fips, fill, auto) {
    var cs = $('co-co'), note = $('co-note'); _coData = null; _coSt = st; cs.disabled = true;
    cs.innerHTML = '<option value="">' + (st ? 'Loading counties...' : 'Pick a state first') + '</option>';
    if (!st) { note.hidden = true; coSave(); return; }
    fetch('/data/breakeven/' + st + '.json').then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(function (d) {
      if (_coSt !== st) return; _coData = d;
      cs.innerHTML = '<option value="">Pick a county</option>' + (d.c || []).map(function (c) { return '<option value="' + esc(c.f) + '">' + esc(c.n) + '</option>'; }).join('');
      cs.disabled = false;
      if (typeof fips === 'function') fips = fips(d);
      if (fips && (d.c || []).some(function (c) { return c.f === fips; })) { cs.value = fips; if (auto) { _coAuto = auto; coSave(); } coFill(fill); }
    }).catch(function () { if (_coSt !== st) return; cs.innerHTML = '<option value="">Could not load</option>'; note.hidden = false; note.textContent = 'The county file did not load. Type your own rent and yield.'; });
  }
  function onCoState() { _coAuto = ''; coLoad($('co-st').value, '', false); }
  function onCoCounty() { _coAuto = ''; coFill(true, false, true); coSave(); }
  function stateSlug(st) { return (CO_STATES[st] || '').toLowerCase().replace(/ /g, '-'); }
  /* The ARC/PLC estimate that goes with this county, crop and crop year.
     The build's own verdict picks the program; close or neither takes the
     larger expected payment. Payments are per base acre. */
  function arcFor(c, cr, yr) {
    var a = c && c.a && c.a[cr], row = a && a[String(yr)];
    if (!row) return { why: a && a.why === 'two practices' ? 'irrigated and non-irrigated estimates differ here' : 'no estimate for this county and crop' };
    var v = row[0];
    if (v === 'withheld') return { why: 'not enough county history to estimate' };
    if (v === 'mismatch') return { why: 'FSA&rsquo;s county PLC yield is above the benchmark, so there is no typical-farm estimate' };
    if (v === 'noprice') return { why: 'no ' + yr + ' price outlook to estimate from yet' };
    if (v === 'pending') return { why: 'waiting on the price that sets the ' + yr + ' reference price' };
    if (row.length < 3) return { why: 'no estimate' };
    var plc = row[1], arc = row[2], prog = /plc/.test(v) ? 'PLC' : /arc/.test(v) ? 'ARC-CO' : (plc > arc ? 'PLC' : 'ARC-CO');
    var cents = prog === 'PLC' ? plc : arc;
    return { prog: prog, usd: cents / 100, other: prog === 'PLC' ? ['ARC-CO', arc / 100] : ['PLC', plc / 100], verdict: v };
  }
  /* fill writes into the fields; force (a county he just picked) writes over
     his rent and yield too; yearOnly (a new crop year) leaves the rent. */
  function coFill(fill, yearOnly, force) {
    var note = $('co-note'), cs = $('co-co'); if (!note || !cs) return;
    var fips = cs.value, c = _coData && fips ? (_coData.c || []).filter(function (x) { return x.f === fips; })[0] : null;
    var ot = $('other');
    if (!c) {
      note.hidden = true;
      if (ot && ot.dataset.arc === '1' && fill) { ot.value = ''; delete ot.dataset.arc; setSrc('other', 'none'); }
      return;
    }
    var cr = crop(), unit = _coSt === 'LA' ? ' Parish' : ' County', nm = esc(c.n) + unit, out = [], yr = cropYear();
    var ty = parseInt(String(_coData.rent_gen || '').slice(0, 4), 10) || yr;
    if (_coAuto) out.push('<b>' + nm + ', ' + esc(_coSt) + '</b>, from the location you saved on AGSIST. Pick another county any time.');
    var r = c.r;
    if (r && !yearOnly) {
      var sp = $('split-panel'), land = $('land'), tgt = (sp && !sp.hidden && land && land.hasAttribute('readonly')) ? $('rentRate') : land;
      if (fill && tgt && (force || B.src('land').k !== 'user')) { tgt.value = r[0]; if (tgt === land) { land.dataset.userVal = String(r[0]); setSrc('land', 'county', 'USDA NASS ' + r[1] + ' cash rent, ' + nm); } }
    }
    if (r) out.push('Land rent <b>' + money(r[0]) + '/ac</b>: USDA NASS ' + r[1] + ' county average cash rent, ' + PRACTICE[r[2]] + ' cropland, ' + nm + '.');
    else out.push('NASS publishes no cropland cash rent for ' + nm + ', so land rent is left as it was.');
    if (cr === 'corn' || cr === 'soybeans') {
      var t = c.y && c.y[cr === 'corn' ? 'corn' : 'beans'];
      if (t && t.v != null) {
        /* the trend is a straight line: one more year adds one slope */
        var tv = t.v + (t.s != null ? t.s * (yr - ty) : 0), shown = Math.round(tv), py = t.s != null ? yr : ty;
        if (fill && (force || B.src('yield').k !== 'user')) { $('yield').value = shown; setSrc('yield', 'county', 'county trend projected to ' + py + ', ' + nm); }
        out.push('Yield <b>' + shown + ' bu/ac</b>: the county&rsquo;s 15-year trend projected to ' + py + ', a straight line through NASS ' + PRACTICE[t.b] + ' county yields. A fit, not a forecast; your own APH is better.');
      } else out.push('No county trend yield' + (t && t.w ? ': ' + esc(t.w) : '') + '. Yield is left as it was.');
      /* ARC/PLC into other revenue, as an estimate, only where his own number is not */
      var e = arcFor(c, cr, yr), page = (_coData.c && c.s && !NO_ARC_PAGE[_coSt]) ? '/arc-plc/' + stateSlug(_coSt) + '/' + c.s : '';
      var mine = ot && B.src('other').k === 'user';
      if (e.prog) {
        var pay = _coData.pay && _coData.pay[String(yr)];
        if (fill && ot && !mine) { ot.value = e.usd % 1 ? e.usd.toFixed(2) : String(e.usd); ot.dataset.arc = '1'; setSrc('other', 'arc', 'estimate: ' + e.prog + ', ' + nm + ', ' + yr + ' program year'); }
        out.push('Other revenue ' + (mine ? '(yours kept; our estimate is ' : '<b>') + money(e.usd) + '/ac' + (mine ? ')' : '</b>') + ': AGSIST&rsquo;s ' + e.prog + ' estimate for ' + (cr === 'corn' ? 'corn' : 'soybean') + ' base acres in ' + nm + ', ' + yr + ' program year (' + e.other[0] + ' ' + money(e.other[1]) + '). ' +
          'Per base acre at FSA&rsquo;s 85% payment acres, before sequestration' + (pay ? ', paid after ' + day(pay) : '') + '. It counts one base acre for each planted acre; change it if yours differ. An estimate, not a sure payment.' +
          (page ? ' <a href="' + page + '">How the estimate is figured</a>.' : ''));
      } else {
        if (fill && ot && ot.dataset.arc === '1') { ot.value = ''; delete ot.dataset.arc; setSrc('other', 'none'); }
        out.push('No ARC/PLC estimate in other revenue: ' + e.why + '.' + (page ? ' <a href="' + page + '">' + nm + ' on AGSIST ARC or PLC</a>.' : ''));
      }
    } else {
      out.push('County yield fills for corn and soybeans only.');
      var stn = CO_STATES[_coSt] || ''; if (stn && !NO_ARC_PAGE[_coSt]) out.push('ARC or PLC estimates for your county: <a href="/arc-plc/' + stateSlug(_coSt) + '">' + esc(stn) + ' on AGSIST ARC or PLC</a>.');
    }
    note.innerHTML = '<p>' + out.join('</p><p>') + '</p>'; note.hidden = false;
    if (fill) calcBreakeven(); else renderSrc();
  }
  function normCounty(s) { return String(s || '').toLowerCase().replace(/\b(county|parish|borough|census area)\b/g, '').replace(/\bsaint\b/g, 'st').replace(/[^a-z]/g, ''); }
  function initCounty(hadSaved) {
    var s = $('co-st'); if (!s) return;
    var sv = (lsGet('agsist-be-county') || '').split('|');
    if (sv[0] && CO_STATES[sv[0]]) { s.value = sv[0]; coLoad(sv[0], sv[1] || '', false); return; }
    var loc = B.savedLoc(); if (!loc || !CO_STATES[loc.state]) return;
    s.value = loc.state;
    var want = normCounty(loc.county);
    /* a first visit fills from the saved county; a returning reader's own numbers stand */
    coLoad(loc.state, function (d) { if (!want) return ''; var m = (d.c || []).filter(function (c) { return normCounty(c.n) === want; }); return m.length === 1 ? m[0].f : ''; }, !hadSaved, 'saved');
  }


  /* the ? tips, drawn the first time one is tapped */
  var HINTS = {
  "yield": "<div class=\"hint-title\">Yield Checklist</div><ul class=\"hint-list\"><li>Your APH (actual production history)</li><li>County average vs. your field history</li><li>Trend-adjusted yield for this year</li><li>Soil type &amp; drainage quality</li><li>Planting date impact on potential</li></ul><div class=\"hint-note\">Conservative estimates protect your plan.</div>",
  "price": "<div class=\"hint-title\">Price Considerations</div><ul class=\"hint-list\"><li>Dec corn / Nov beans for the crop year you are planning</li><li>Forward contract commitments</li><li>Harvest vs. spring delivery timing</li><li>On-farm storage premium potential</li></ul><div class=\"hint-note\">Pick the crop year in the price bar above.</div>",
  "basis": "<div class=\"hint-title\">Basis</div><ul class=\"hint-list\"><li>Your elevator&rsquo;s bid minus the futures price</li><li>Usually negative in the Corn Belt (e.g. -0.35)</li><li>Enter 0 to work in futures terms</li></ul><div class=\"hint-note\">Find yours on <a href=\"/cash-bids\" style=\"color:var(--gold,#d4a23f)\">AGSIST cash bids</a>: bid minus board.</div>",
  "seed": "<div class=\"hint-title\">Don't Forget</div><ul class=\"hint-list\"><li>Base seed cost per bag</li><li>Seed treatment</li><li>Technology / trait fees</li><li>Replant seed reserve</li><li>Inoculant (soybeans)</li></ul>",
  "fertilizer": "<div class=\"hint-title\">Don't Forget</div><ul class=\"hint-list\"><li>Nitrogen (anhydrous, urea, UAN)</li><li>Phosphorus (MAP/DAP)</li><li>Potash (K2O)</li><li>Lime (amortized)</li><li>Sulfur &amp; micros</li><li>Application fees</li></ul><div class=\"hint-note\">Soil test recommendations should drive rates.</div>",
  "chemicals": "<div class=\"hint-title\">Don't Forget</div><ul class=\"hint-list\"><li>Pre-emerge herbicides</li><li>Post-emerge herbicides</li><li>Fungicide</li><li>Insecticide</li><li>Adjuvants &amp; surfactants</li><li>Custom application fees</li></ul>",
  "insurance": "<div class=\"hint-title\">Don't Forget</div><ul class=\"hint-list\"><li>Net premium (after subsidy)</li><li>Hail / wind endorsement</li><li>Replant provision</li><li>SCO or ECO add-on</li><li>Private hail policy</li></ul><div class=\"hint-note\">Ask your agent about SCO and ECO. Premium support improved for 2026.</div>",
  "machinery": "<div class=\"hint-title\">Don't Forget</div><ul class=\"hint-list\"><li>Fuel &amp; lube</li><li>Repairs &amp; maintenance</li><li>Depreciation</li><li>Custom hire</li><li>Hauling / trucking</li></ul>",
  "labor": "<div class=\"hint-title\">Don't Forget</div><ul class=\"hint-list\"><li>Hired labor</li><li>Owner/operator time value</li><li>Seasonal help</li><li>Benefits &amp; payroll taxes</li></ul>",
  "land": "<div class=\"hint-title\">Don't Forget</div><ul class=\"hint-list\"><li>Cash rent (or flex rent)</li><li>Property tax (if owned)</li><li>Drainage tile payments</li><li>Opportunity cost of owned land</li></ul><div class=\"hint-note\">See your county&rsquo;s published rate on <a href=\"/rent/\" style=\"color:var(--gold,#d4a23f)\">AGSIST cash rent by state</a>.</div>",
  "overhead": "<div class=\"hint-title\">Don't Forget</div><ul class=\"hint-list\"><li>Interest on operating loan</li><li>Crop drying</li><li>Storage / bin costs</li><li>Marketing &amp; basis fees</li><li>Farm liability insurance</li><li>Accounting &amp; legal</li></ul>",
  "other": "<div class=\"hint-title\">Other revenue</div><ul class=\"hint-list\"><li>ARC or PLC payment you expect (it is paid on base acres, so spread it over the acres in this crop)</li><li>Stalks, straw or other sales off these acres</li></ul><div class=\"hint-note\">Your estimate, not a sure payment. It lowers the break-even. ARC and PLC estimates by county are on <a href=\"/arc-plc\" style=\"color:var(--gold,#d4a23f)\">AGSIST ARC or PLC</a>.</div>"
  };
  function closeAllHints() {
    D.querySelectorAll('.hint-popup.hint-open').forEach(function (p) { p.classList.remove('hint-open'); p.setAttribute('inert', ''); });
    D.querySelectorAll('.hint-icon.active').forEach(function (i) { i.classList.remove('active'); i.setAttribute('aria-expanded', 'false'); });
  }
  function hint(icon) {
    var wrap = icon.closest('.input-wrap'); if (!wrap) return;
    var popup = wrap.querySelector('.hint-popup');
    if (!popup) {
      var inp = wrap.querySelector('input'), h = inp && HINTS[inp.id]; if (!h) return;
      popup = D.createElement('div'); popup.className = 'hint-popup'; popup.setAttribute('inert', ''); popup.innerHTML = h; wrap.appendChild(popup);
    }
    var was = popup.classList.contains('hint-open'); closeAllHints();
    if (!was) { popup.classList.add('hint-open'); popup.removeAttribute('inert'); icon.classList.add('active'); icon.setAttribute('aria-expanded', 'true'); }
  }
  D.addEventListener('click', function (e) { if (!e.target.closest('.hint-icon') && !e.target.closest('.hint-popup')) closeAllHints(); });
  D.addEventListener('focusin', function (e) { if (e.target.matches && e.target.matches('input,select') && !e.target.closest('.hint-popup')) closeAllHints(); });

  function boot() {
    $('co-st').addEventListener('change', onCoState);
    $('co-co').addEventListener('change', onCoCounty);
    var s = $('co-st');
    if (s.value && !_coSt) { coLoad(s.value, '', false); return; }   /* picked before this file arrived */
    initCounty(B.hadSaved());
  }
  W.AgBECounty = {
    fill: function (a, b, c) { coFill(a, b, c); },
    info: function () { var cs = $('co-co'), c = _coData && cs.value ? (_coData.c || []).filter(function (x) { return x.f === cs.value; })[0] : null; return c ? { name: c.n + (_coSt === 'LA' ? ' Parish' : ' County') + ', ' + _coSt, st: _coSt, auto: !!_coAuto } : null; },
    arcFor: arcFor, normCounty: normCounty, hint: hint
  };
  boot();
})();
