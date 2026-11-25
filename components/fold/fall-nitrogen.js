/* fold/fall-nitrogen.js: the fall anhydrous tab of /spray (was the inline script of /fall-nitrogen until
 * Nov 11, 2026). Loaded by components/page-tabs.js the first time the tab opens. */
/*falln:start*/
var FN_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fnMiles(a, b, c, d) {
  var r = 3958.8, p1 = a * Math.PI / 180, p2 = c * Math.PI / 180, dp = p2 - p1, dl = (d - b) * Math.PI / 180;
  var h = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(h)));
}
function fnDate(iso) { var p = String(iso).split('-'); return FN_MON[+p[1] - 1] + ' ' + (+p[2]); }
function fnAgeDays(iso, now) {
  var t = Date.parse(iso + 'T12:00:00Z'); if (!isFinite(t)) return Infinity;
  var n = new Date(now), today = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()) + 432e5;
  return Math.round((today - t) / 864e5);
}
// One station's last 7 days. Mirrors read() in scripts/fetch_fall_nitrogen.py.
function fnRead(s, now, maxAge) {
  var t = s.t || [], week = t.slice(-7).filter(function (v) { return typeof v === 'number'; });
  var latest = null, first = null, i;
  for (i = t.length - 1; i >= 0; i--) if (typeof t[i] === 'number') { latest = t[i]; break; }
  var w = t.slice(-7); for (i = 0; i < w.length; i++) if (typeof w[i] === 'number') { first = w[i]; break; }
  var below = week.filter(function (v) { return v < 50; }).length;
  var age = fnAgeDays(s.last, now), stale = age > (maxAge == null ? 3 : maxAge);
  var state = latest === null ? null : latest >= 50 ? 'warm' : (below === week.length && week.length >= 5 ? 'holding' : 'dipping');
  return {latest: latest, change: latest === null || first === null ? null : Math.round((latest - first) * 10) / 10,
    below: below, n: week.length, state: stale ? 'stale' : state, age: age};
}
function fnRange(lo, hi) {
  if (lo === null || hi === null) return '';
  lo = Math.round(lo); hi = Math.round(hi);
  return '<span style="white-space:nowrap">' + (lo === hi ? lo : lo + '&ndash;' + hi) + '&deg;F</span>';
}
function fnTrend(c) {
  if (c === null) return '';
  if (Math.abs(c) < 1) return 'about flat over the last 7 days';
  return (c < 0 ? 'down ' : 'up ') + Math.round(Math.abs(c)) + '°F over the last 7 days';
}
function fnNearest(lat, lon, stations, maxMi) {
  var best = null;
  (stations || []).forEach(function (s, i) {
    var d = fnMiles(lat, lon, s.lat, s.lon);
    if (d <= maxMi && (!best || d < best.mi)) best = {i: i, mi: d};
  });
  return best;
}
function fnNearestCounty(lat, lon, counties) {
  var best = null;
  Object.keys(counties || {}).forEach(function (f) {
    var c = counties[f], d = fnMiles(lat, lon, c[2], c[3]);
    if (!best || d < best.mi) best = {fips: f, mi: d};
  });
  return best && best.mi <= 40 ? best : null;
}
// The answer for one place, as plain data. place: {fips} or {lat, lon, label}.
function fnView(d, place, now) {
  if (!d || !d.stations || !d.stations.length || !place) return null;
  var max = d.max_miles || 50, pick = null, label = '', st = '', county = null;
  if (place.fips) {
    county = d.counties && d.counties[place.fips];
    if (!county) return null;
    label = county[0] + ' County, ' + county[1]; st = county[1];
    if (county.length > 5) pick = {i: county[4], mi: county[5]};
  } else {
    if (!isFinite(place.lat) || !isFinite(place.lon)) return null;
    pick = fnNearest(place.lat, place.lon, d.stations, max);
    if (pick) pick.mi = Math.round(pick.mi);
    var nc = fnNearestCounty(place.lat, place.lon, d.counties);
    county = nc ? d.counties[nc.fips] : null;
    st = county ? county[1] : '';
    label = place.label + (county ? ' (' + county[0] + ' County, ' + county[1] + ')' : '');
  }
  if (!pick) return {blank: true, label: label, st: st, max: max};
  var s = d.stations[pick.i];
  if (!s) return null;
  var r = fnRead(s, now, d.max_age_days);
  var head = {
    warm: 'Not below 50°F yet',
    dipping: 'Below 50°F, not for a full week yet',
    holding: 'Below 50°F every day this week',
    stale: 'No fresh reading from the nearest station'
  }[r.state] || 'No reading';
  var why = {
    warm: 'Extension says wait until soil at 4 in stays below 50°F.',
    dipping: 'One cold snap is not enough. Extension wants it below 50°F and staying there.',
    holding: 'That is the soil condition extension describes for fall anhydrous: below 50°F and staying there. It is not a forecast. A warm spell can push it back up, so check the forecast and your own field.',
    stale: 'It last reported ' + fnDate(s.last) + '. This page does not guess.'
  }[r.state] || '';
  return {blank: false, label: label, st: st || s.st, station: s, mi: pick.mi, read: r, head: head, why: why,
    trend: fnTrend(r.change), cold: r.state === 'holding'};
}
// State rows for the summary table. Mirrors summary() in the fetcher.
function fnStates(d, now) {
  var by = {}, out = [];
  (d.stations || []).forEach(function (s) { (by[s.st] = by[s.st] || []).push(s); });
  Object.keys(by).forEach(function (st) {
    var r = by[st].map(function (s) { return fnRead(s, now, d.max_age_days); });
    var lat = r.filter(function (x) { return x.latest !== null && x.state !== 'stale'; }).map(function (x) { return x.latest; });
    out.push({st: st, name: (d.state_names && d.state_names[st]) || st, n: by[st].length,
      holding: r.filter(function (x) { return x.state === 'holding'; }).length,
      warm: r.filter(function (x) { return x.state === 'warm'; }).length,
      lo: lat.length ? Math.min.apply(null, lat) : null, hi: lat.length ? Math.max.apply(null, lat) : null});
  });
  return out.sort(function (a, b) { return a.name < b.name ? -1 : 1; });
}
// Daily readings against the 50 F line. Returns SVG markup.
function fnSpark(t, last, w, h) {
  var vals = t || [], n = vals.length, lo = 50, hi = 50;
  vals.forEach(function (v) { if (typeof v === 'number') { lo = Math.min(lo, v); hi = Math.max(hi, v); } });
  lo = Math.floor(lo - 3); hi = Math.ceil(hi + 3);
  var padL = 34, padR = 10, padT = 8, padB = 20;
  var x = function (k) { return padL + (w - padL - padR) * k / Math.max(1, n - 1); };
  var y = function (v) { return padT + (h - padT - padB) * (1 - (v - lo) / (hi - lo)); };
  var path = '', on = false, dots = '';
  vals.forEach(function (v, k) {
    if (typeof v === 'number') {
      path += (on ? 'L' : 'M') + x(k).toFixed(1) + ',' + y(v).toFixed(1); on = true;
      dots += '<circle cx="' + x(k).toFixed(1) + '" cy="' + y(v).toFixed(1) + '" r="3" class="fn-dot' + (v < 50 ? ' fn-under' : '') + '"/>';
    } else on = false;
  });
  var end = Date.parse(last + 'T12:00:00Z'), lab = '';
  [0, n - 1].forEach(function (k) {
    var dt = new Date(end - (n - 1 - k) * 864e5);
    lab += '<text x="' + x(k).toFixed(1) + '" y="' + (h - 4) + '" text-anchor="' + (k ? 'end' : 'start') + '" class="fn-ax">' + FN_MON[dt.getUTCMonth()] + ' ' + dt.getUTCDate() + '</text>';
  });
  return '<svg viewBox="0 0 ' + w + ' ' + h + '" aria-hidden="true" focusable="false">' +
    '<line x1="' + padL + '" x2="' + (w - padR) + '" y1="' + y(50).toFixed(1) + '" y2="' + y(50).toFixed(1) + '" class="fn-fifty"/>' +
    '<text x="' + (padL - 5) + '" y="' + (y(50) + 4).toFixed(1) + '" text-anchor="end" class="fn-ax fn-gold">50°</text>' +
    '<text x="' + (padL - 5) + '" y="' + (padT + 8) + '" text-anchor="end" class="fn-ax">' + hi + '°</text>' +
    '<text x="' + (padL - 5) + '" y="' + (h - padB) + '" text-anchor="end" class="fn-ax">' + lo + '°</text>' +
    '<path d="' + path + '" class="fn-line"/>' + dots + lab + '</svg>';
}
/*falln:end*/
(function () {
  var live = document.getElementById('fn-live');
  if (!live || !window.fetch) return;
  var DATA = null, PLACE = null, seq = 0;
  var OWN_ZIPS = '/data/places/zip/', ZIPS = 'https://dnilgis.github.io/bids/data/zips/';
  var $ = function (id) { return document.getElementById(id); };
  // Every reading names its network, linked to it (Wisconet's CC BY terms ask for the credit).
  function netCredit(net) {
    return esc((DATA.net_labels && DATA.net_labels[net]) || net);  // named, not linked
  }
  var esc = function (t) { return String(t).replace(/[&<>"]/g, function (c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]; }); };
  var RULE = {IA: 'rule-IA', IL: 'rule-IL', MN: 'rule-MN', KS: 'rule-KS', NE: 'rule-NE'};
  function status(t, err) { var s = $('fn-status'); s.textContent = t || ''; s.className = 'fn-status' + (err ? ' fn-err' : ''); }
  function save() { try { localStorage.setItem('agsist-falln', JSON.stringify(PLACE)); } catch (e) {} }
  function ruleLine(st) {
    var id = RULE[st] || 'rule-other', li = $(id);
    var name = (DATA.state_names && DATA.state_names[st]) || '';
    if (!li) return '';
    var rt = li.querySelector('.fn-rt');
    return '<p class="fn-fine fn-rule">' + (RULE[st] ? '' : '<b>' + esc(name || 'Your state') + ':</b> ') +
      esc((rt ? rt.textContent : '').replace(/\s+/g, ' ').trim()) + ' <a href="#' + id + '">Sources</a></p>';
  }
  function summaryTable() {
    var rows = fnStates(DATA, Date.now()), h = '<table class="fn-t"><caption>Soil near 4 in, by state, newest daily readings</caption><thead><tr><th scope="col">State</th><th scope="col">Stations</th><th scope="col">Under 50&deg;F all week</th><th scope="col">50&deg;F+ now</th><th scope="col">Now</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      h += '<tr><th scope="row">' + esc(r.name) + '</th><td>' + r.n + '</td><td>' + r.holding + '</td><td>' + r.warm + '</td><td>' +
        fnRange(r.lo, r.hi) + '</td></tr>';
    });
    return '<div class="fn-tw">' + h + '</tbody></table></div>';
  }
  var CW = 640;
  function render() {
    if (!live.style.minHeight) live.style.minHeight = live.offsetHeight + 'px';  // the static table's height: the live block never ends shorter, so what follows does not rise
    CW = Math.max(280, Math.min(720, Math.round((live.clientWidth || 640) - 34)));
    var h = '';
    if (PLACE) {
      var v = fnView(DATA, PLACE, Date.now());
      if (v && v.blank) {
        h += '<div class="fn-answer"><p class="fn-k">' + esc(v.label) + '</p><p class="fn-head">No station within ' + v.max + ' miles</p>' +
          '<p class="fn-sub">This page leaves it blank rather than fill it from a model. Check your own field with a soil thermometer at 4 in, in the afternoon.</p>' + (v.st ? ruleLine(v.st) : '') + '</div>';
      } else if (v) {
        var s = v.station, r = v.read;
        h += '<div class="fn-answer' + (v.cold ? ' fn-cold' : '') + '" id="fn-answer"><p class="fn-k">' + esc(v.label) + '</p>' +
          '<p class="fn-head">' + esc(v.head) + '</p>';
        if (r.state !== 'stale' && r.latest !== null) {
          h += '<p class="fn-big">' + Math.round(r.latest) + '&deg;F<span> on ' + esc(fnDate(s.last)) + '</span></p>' +
            '<p class="fn-sub">' + esc(v.trend ? v.trend[0].toUpperCase() + v.trend.slice(1) + '. ' : '') +
            r.below + ' of the last ' + r.n + ' days below 50&deg;F.</p>' +
            '<div class="fn-chart" role="img" aria-label="' + esc('Daily soil temperature at ' + s.name + ', last ' + s.t.length + ' days, against the 50 degree line') + '">' + fnSpark(s.t, s.last, CW, 150) + '</div>';
        }
        h += '<p class="fn-sub">' + esc(v.why) + '</p>' +
          '<p class="fn-fine">Station: ' + esc(s.name) + ' (' + netCredit(s.net) + '), ' + v.mi + ' mi away. Soil at ' + esc(s.depth) + ', ' + esc(s.stat) + '.</p>' +
          ruleLine(v.st) + '</div>';
      }
    }
    h += '<h2 id="states">Where the soil is, state by state</h2>' + summaryTable() +
      '<p class="fn-fine">Readings checked ' + esc(fnDate(String(DATA.updated_utc).slice(0, 10)) + ', ' + String(DATA.updated_utc).slice(0, 4)) + '. &ldquo;Under 50&deg;F all week&rdquo; means all of a station&rsquo;s last 7 daily readings were under 50&deg;F.</p>';
    live.innerHTML = h;
  }
  function allStations() {
    var b = $('fn-all-body'); if (!b || b.getAttribute('data-done')) return;
    var h = '<div class="fn-tw"><table class="fn-t"><caption>Newest daily mean, depth and the last 7 days</caption><thead><tr><th scope="col">Station</th><th scope="col">Depth</th><th scope="col">Newest</th><th scope="col">Days under 50&deg;F</th></tr></thead><tbody>';
    DATA.stations.forEach(function (s) {
      var r = fnRead(s, Date.now(), DATA.max_age_days);
      h += '<tr><th scope="row">' + esc(s.name) + ' (' + netCredit(s.net) + ')</th><td>' + esc(s.depth) + '</td><td>' + (r.latest === null || r.state === 'stale' ? 'old' : Math.round(r.latest) + '&deg;F ' + esc(fnDate(s.last))) + '</td><td>' + r.below + ' of ' + r.n + '</td></tr>';
    });
    b.innerHTML = h + '</tbody></table></div>';
    b.setAttribute('data-done', '1');
  }
  function fillStates() {
    var sel = $('fn-st'), seen = {};
    Object.keys(DATA.counties || {}).forEach(function (f) { seen[DATA.counties[f][1]] = 1; });
    Object.keys(seen).sort(function (a, b) { return (DATA.state_names[a] || a) < (DATA.state_names[b] || b) ? -1 : 1; }).forEach(function (st) {
      var o = document.createElement('option'); o.value = st; o.textContent = DATA.state_names[st] || st; sel.appendChild(o);
    });
  }
  function fillCounties(st, pick) {
    var sel = $('fn-co');
    sel.innerHTML = '<option value="">Pick a county</option>';
    var list = Object.keys(DATA.counties || {}).filter(function (f) { return DATA.counties[f][1] === st; })
      .sort(function (a, b) { return DATA.counties[a][0] < DATA.counties[b][0] ? -1 : 1; });
    list.forEach(function (f) {
      var c = DATA.counties[f], o = document.createElement('option');
      o.value = f; o.textContent = c[0] + (c.length > 5 ? '' : ' (no station within ' + (DATA.max_miles || 50) + ' mi)');
      sel.appendChild(o);
    });
    sel.disabled = !st;
    if (pick) sel.value = pick;
  }
  function setCounty(f) {
    var c = DATA.counties && DATA.counties[f];
    if (!c) return false;
    $('fn-st').value = c[1]; fillCounties(c[1], f);
    PLACE = {fips: f}; status(''); save(); render(); return true;
  }
  function byZip(z) {
    z = String(z || '').replace(/\D/g, '').slice(0, 5);
    if (z.length !== 5) { status('Enter a 5-digit ZIP.', true); return; }
    $('fn-zip').value = z; status('Looking up ' + z + '...');
    var my = ++seq;
    var getJSON = function (u) { return fetch(u).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }); };
    [OWN_ZIPS, ZIPS].reduce(function (prev, base) {
      // our own ZIP table first, then the bids repo's copy of the same points (2026-10-29: no outside geocoder)
      return prev.catch(function () { return getJSON(base + z.slice(0, 2) + '.json').then(function (t) {
      var p = t && t[z];
      if (Array.isArray(p) && isFinite(+p[0]) && isFinite(+p[1]) && !(+p[0] === 0 && +p[1] === 0)) return {lat: +p[0], lon: +p[1]};
      throw new Error('not in table');
      }); });
    }, Promise.reject()).then(function (p) {
      if (my !== seq) return;
      PLACE = {lat: p.lat, lon: p.lon, label: 'ZIP ' + z, zip: z};
      $('fn-st').value = ''; fillCounties('', null);
      status(''); save(); render();
    }).catch(function () { if (my === seq) status('Could not find ZIP ' + z + '. Check it and try again.', true); });
  }
  var rz = null;
  window.addEventListener('resize', function () {
    clearTimeout(rz);
    rz = setTimeout(function () { live.style.minHeight = ''; if (DATA && PLACE && Math.abs((live.clientWidth || 0) - 34 - CW) > 40) render(); }, 200);
  });
  fetch('/data/fall-nitrogen.json', {cache: 'no-cache'}).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
    if (!d || !d.stations || !d.stations.length) return;
    DATA = d;
    $('fn-pick').hidden = false; $('fn-all').hidden = false;
    fillStates();
    $('fn-st').addEventListener('change', function () { fillCounties(this.value, null); });
    $('fn-co').addEventListener('change', function () { if (this.value) setCounty(this.value); });
    $('fn-zipgo').addEventListener('click', function () { byZip($('fn-zip').value); });
    $('fn-zip').addEventListener('keydown', function (e) { if (e.key === 'Enter') byZip(this.value); });
    $('fn-all').addEventListener('toggle', allStations);
    var q = new URLSearchParams(location.search), saved = null;
    try { saved = JSON.parse(localStorage.getItem('agsist-falln') || 'null'); } catch (e) {}
    if (q.get('county') && setCounty(q.get('county'))) return;
    if (q.get('zip')) { render(); byZip(q.get('zip')); return; }
    if (saved && saved.fips && setCounty(saved.fips)) return;
    if (saved && isFinite(saved.lat)) { PLACE = saved; if (saved.zip) $('fn-zip').value = saved.zip; }
    render();
  }).catch(function () {});
})();
