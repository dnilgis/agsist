/* components/elev-post.js: the elevator's own page, /post?k=<key>.

   One page for every elevator. The key in ?k= opens one listing on the subs
   worker (v5.20: POST /elev/me, POST /elev/save). The page shows the
   elevator's bids, hours, contact and note, lets the manager change them, and
   saves them in one tap. A failed save never clears what was typed: the form
   is only redrawn from the server after a save that worked, and every change
   is also kept on this phone (localStorage) until it is saved.

   Cash prices on this page are an estimate: the newest delayed futures price
   in /data/prices.json plus the basis typed here. A contract that file has
   no clean price for (missing, stale, held back or retired) shows no estimate.

   The pure parts (contract months, new-row defaults, basis parsing, the cash
   estimate, the checks) are on window.ElevPost and under module.exports, so
   test/elev-portal.test.mjs runs the same code the page runs. */
(function (root) {
  'use strict';

  var WORKER = 'https://agsist-api.dnilgis.workers.dev';
  var SIG_EMAIL = 'sig@agsist.com';
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var CODES = 'FGHJKMNQUVXZ';
  /* The same table as the worker's ELEV_FUT. */
  var FUT = { corn: ['ZC', 'HKNUZ'], soybeans: ['ZS', 'FHKNQUX'], wheat: ['ZW', 'HKNUZ'] };
  var CROP_LABEL = { corn: 'Corn', soybeans: 'Soybeans', wheat: 'Wheat' };
  var MAX_ROWS = 12, NOTE_MAX = 140, PERIOD_MAX = 16;

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(y, m, d) { return y + '-' + pad(m) + '-' + pad(d); }
  function lastDay(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  /* The first contract for a crop that comes due AFTER the given month: corn
     delivered in October hangs on December, soybeans on November, corn in
     December on March. y, m: the delivery month (m 1-12). */
  function nextFutures(crop, y, m) {
    var f = FUT[crop];
    if (!f) return '';
    for (var i = 1; i <= 24; i++) {
      var mm = (m - 1 + i) % 12 + 1, yy = y + Math.floor((m - 1 + i) / 12);
      var code = CODES.charAt(mm - 1);
      if (f[1].indexOf(code) >= 0) return f[0] + code + String(yy).slice(-2);
    }
    return '';
  }
  /* The contracts offered for a crop: the next n listed months after this one. */
  function futuresChoices(crop, today, n) {
    var f = FUT[crop], out = [];
    if (!f) return out;
    var y = today.getFullYear(), m = today.getMonth() + 1;
    for (var i = 1; i <= 36 && out.length < (n || 8); i++) {
      var mm = (m - 1 + i) % 12 + 1, yy = y + Math.floor((m - 1 + i) / 12);
      var code = CODES.charAt(mm - 1);
      if (f[1].indexOf(code) >= 0) out.push(f[0] + code + String(yy).slice(-2));
    }
    return out;
  }
  function futuresOk(crop, code) {
    var f = FUT[crop], m = /^(Z[CSW])([FGHJKMNQUVXZ])(\d{2})$/.exec(String(code || ''));
    return !!(f && m && m[1] === f[0] && f[1].indexOf(m[2]) >= 0);
  }
  function futuresLabel(code) {
    var m = /^Z[CSW]([FGHJKMNQUVXZ])(\d{2})$/.exec(String(code || ''));
    return m ? MON[CODES.indexOf(m[1])] + " '" + m[2] : String(code || '');
  }

  /* A delivery month as a row: "Nov" this year, "Jan '27" another year. The
     current month starts today; later months start on the 1st. */
  function periodFor(y, m, today) {
    var ty = today.getFullYear(), tm = today.getMonth() + 1;
    var startDay = (y === ty && m === tm) ? today.getDate() : 1;
    return { period: MON[m - 1] + (y === ty ? '' : " '" + String(y).slice(-2)),
      start: ymd(y, m, startDay), end: ymd(y, m, lastDay(y, m)) };
  }
  /* A new row: the crop of the last row (corn when there is none), the month
     after that crop's latest row (this month when it has none), the next
     contract for that month, and that crop's latest basis to start from. */
  function newRow(rows, today) {
    rows = rows || [];
    var last = rows.length ? rows[rows.length - 1] : null;
    var crop = last && FUT[last.crop] ? last.crop : 'corn';
    var y = today.getFullYear(), m = today.getMonth() + 1, latest = null;
    rows.forEach(function (r) { if (r.crop === crop && /^\d{4}-\d{2}-\d{2}$/.test(r.end || '') && (!latest || r.end > latest.end)) latest = r; });
    if (latest) {
      var ly = +latest.end.slice(0, 4), lm = +latest.end.slice(5, 7);
      var ny = lm === 12 ? ly + 1 : ly, nm = lm === 12 ? 1 : lm + 1;
      if (ny > y || (ny === y && nm >= m)) { y = ny; m = nm; }
    }
    var p = periodFor(y, m, today);
    var basis = latest && latest.basis !== '' && latest.basis != null ? latest.basis : '';
    return { crop: crop, period: p.period, start: p.start, end: p.end, futures: nextFutures(crop, y, m), basis: basis };
  }

  /* What was typed in the basis box, in dollars, or NaN. "-0.35", "-.35" and
     "−0.35" are dollars; a whole number past the range ("-35") is cents,
     which is how basis is said out loud ("35 under"). */
  function parseBasis(v) {
    if (typeof v === 'number') return isFinite(v) ? v : NaN;
    var s = String(v == null ? '' : v).trim().replace(/[−–]/g, '-').replace(/\s+/g, '');
    if (!s || !/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return NaN;
    var n = Number(s);
    if (s.indexOf('.') < 0 && Math.abs(n) > 3 && Math.abs(n) <= 300) n = n / 100;
    return Math.round(n * 100) / 100;
  }
  function basisText(n) { return isFinite(n) ? (n < 0 ? '-' : '') + Math.abs(n).toFixed(2) : ''; }

  /* The futures quote for one contract from prices.json, or null when the
     file has no clean price for it. */
  function quoteFor(code, prices) {
    if (!prices || !prices.quotes || !code) return null;
    var bad = {};
    (prices.stale_keys || []).forEach(function (k) { bad[k] = 1; });
    (prices.retired_keys || []).forEach(function (k) { bad[k] = 1; });
    var wk = prices.withheld_keys || {};
    if (Array.isArray(wk)) wk.forEach(function (k) { bad[k] = 1; }); else Object.keys(wk).forEach(function (k) { bad[k] = 1; });
    var want = code + '.CBT', keys = Object.keys(prices.quotes);
    for (var i = 0; i < keys.length; i++) {
      var q = prices.quotes[keys[i]];
      if (!q || bad[keys[i]] || q.ticker !== want) continue;
      var c = Number(q.close);
      if (q.close == null || !isFinite(c) || c <= 0) continue;
      return { key: keys[i], close: c, date: q.close_date || '' };
    }
    return null;
  }
  /* Cash estimate in dollars: futures (cents) / 100 + basis (dollars). */
  function cashEstimate(code, basis, prices) {
    var q = quoteFor(code, prices);
    if (!q || !isFinite(basis)) return null;
    return { cash: Math.round((q.close / 100 + basis) * 10000) / 10000, futures: q.close, date: q.date };
  }

  /* The same checks as the worker, with words for a person. Returns
     {bids, errors:[{row, field, msg}]} where bids are ready to send. */
  function checkRows(rows) {
    var out = [], errors = [];
    if (rows.length > MAX_ROWS) errors.push({ row: -1, field: 'rows', msg: 'At most ' + MAX_ROWS + ' rows.' });
    rows.forEach(function (r, i) {
      var e = function (field, msg) { errors.push({ row: i, field: field, msg: msg }); };
      var period = String(r.period || '').trim();
      if (!period) e('period', 'Type the delivery period, like Oct/Nov.');
      else if (period.length > PERIOD_MAX) e('period', 'Keep the period to ' + PERIOD_MAX + ' letters.');
      var okDate = function (s) { return /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !isNaN(Date.parse(s + 'T00:00:00Z')); };
      if (!okDate(r.start) || !okDate(r.end)) e('dates', 'Pick both delivery dates.');
      else if (r.end < r.start) e('dates', 'The last day is before the first day.');
      if (!futuresOk(r.crop, r.futures)) e('futures', 'Pick a futures month for ' + (CROP_LABEL[r.crop] || 'this crop').toLowerCase() + '.');
      var b = parseBasis(r.basis);
      if (!isFinite(b)) e('basis', 'Type the basis, like -0.35 for 35 under.');
      else if (b < -3 || b > 2) e('basis', 'Basis runs from -3.00 to +2.00.');
      out.push({ crop: r.crop, period: period, start: r.start, end: r.end, futures: r.futures, basis: b === 0 ? 0 : b });
    });
    return { bids: out, errors: errors };
  }

  var API = { nextFutures: nextFutures, futuresChoices: futuresChoices, futuresOk: futuresOk, futuresLabel: futuresLabel,
    periodFor: periodFor, newRow: newRow, parseBasis: parseBasis, basisText: basisText, quoteFor: quoteFor,
    cashEstimate: cashEstimate, checkRows: checkRows, FUT: FUT, WORKER: WORKER };
  root.ElevPost = API;
  if (typeof module === 'object' && module.exports) module.exports = API;
  if (typeof document === 'undefined' || !document.getElementById('ep')) return;

  /* ── the page ─────────────────────────────────────────────────────────── */
  var box = document.getElementById('ep');
  var key = '';
  try { key = new URLSearchParams(location.search).get('k') || ''; } catch (e) { key = ''; }
  var rec = null, prices = null, base = '', busy = false;
  var form = null;   // {bids:[...], hours, harvest, cname, cphone, note, closed}
  var esc = (root.AG && root.AG.esc) || function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var px = root.AG && root.AG.px;
  var today = new Date();

  function post(path, body) {
    return fetch(WORKER + path, { method: 'POST', cache: 'no-store', referrerPolicy: 'no-referrer',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) {
        // no JSON (Cloudflare's block page) or a 5xx: the worker did not answer (2026-10-22)
        return r.json().then(function (j) { j = j || {}; j._status = r.status; if (r.status >= 500) j._down = true; return j; },
          function () { return { ok: false, _status: r.status, _down: true }; });
      }, function () { return { ok: false, _status: 0, _down: true }; });
  }

  function message(title, html) {
    box.innerHTML = '<div class="ep-msg"><h1>' + esc(title) + '</h1><p>' + html + '</p></div>';
  }
  var MAIL = '<a href="mailto:' + SIG_EMAIL + '">' + SIG_EMAIL + '</a>';
  function refused(j) {
    if (j._down && j._status) return message('Could not reach AGSIST', 'Our system is down right now. Open the link again later. If it keeps happening, email Sig at ' + MAIL + '.');
    if (j._status === 403) return message('This listing is turned off', 'Your bids are not showing on AGSIST right now. To turn the listing back on, email Sig at ' + MAIL + '.');
    if (j._status === 429) return message('Too many tries', 'This phone has opened the page a lot in the last hour. Wait a while and open it again. If it keeps happening, email Sig at ' + MAIL + '.');
    if (j._status === 0 || j._status >= 500) return message('Could not reach AGSIST', 'Check your signal and open the link again. If it keeps happening, email Sig at ' + MAIL + '.');
    return message('This link does not open a listing', 'Use the whole link from your text or email, or ask Sig for a new one: ' + MAIL + '.');
  }

  function when(iso) {
    var t = Date.parse(iso || '');
    if (!isFinite(t)) return null;
    var d = new Date(t), now = Date.now(), mins = Math.round((now - t) / 60000);
    var clock = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
    var day = d.toDateString() === new Date().toDateString() ? 'today' :
      d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    var ago = mins < 1 ? 'just now' : mins < 60 ? mins + ' min ago' : mins < 1440 ? Math.round(mins / 60) + ' hr ago' : Math.round(mins / 1440) + ' days ago';
    return { text: day + ' at ' + clock, ago: ago, hours: (now - t) / 3600000 };
  }

  function fromRecord(r) {
    var closed = !!(r.closed_until && Date.parse(r.closed_until) > Date.now());
    return {
      bids: (r.bids || []).map(function (b) { return { crop: b.crop, period: b.period, start: b.start, end: b.end, futures: b.futures, basis: basisText(Number(b.basis)) }; }),
      hours: (r.hours && r.hours.text) || '', harvest: (r.hours && r.hours.harvest) || '',
      cname: (r.contact && r.contact.name) || '', cphone: (r.contact && r.contact.phone) || '',
      note: r.note || '', closed: closed };
  }
  function snapshot(f) {
    return JSON.stringify({ bids: f.bids.map(function (b) { var p = parseBasis(b.basis); return [b.crop, String(b.period).trim(), b.start, b.end, b.futures, isFinite(p) ? p : String(b.basis)]; }),
      hours: f.hours.trim(), harvest: f.harvest.trim(), cname: f.cname.trim(), cphone: f.cphone.trim(), note: f.note.trim(), closed: f.closed });
  }
  function bidsDirty() { return JSON.stringify(JSON.parse(snapshot(form)).bids) !== JSON.stringify(JSON.parse(base).bids); }
  function dirty() { return snapshot(form) !== base; }

  var DRAFT = function () { return 'elev-draft:' + (rec && rec.id); };
  function keepDraft() {
    try {
      if (dirty()) localStorage.setItem(DRAFT(), JSON.stringify({ form: form, b: rec.bids_updated_at || '', i: rec.info_updated_at || '' }));
      else localStorage.removeItem(DRAFT());
    } catch (e) {}
  }
  function takeDraft() {
    try {
      var d = JSON.parse(localStorage.getItem(DRAFT()) || 'null');
      if (d && d.form && d.b === (rec.bids_updated_at || '') && d.i === (rec.info_updated_at || '') && Array.isArray(d.form.bids)) return d.form;
      localStorage.removeItem(DRAFT());
    } catch (e) {}
    return null;
  }

  /* ── drawing ── */
  function stampHtml() {
    var w = when(rec.bids_updated_at);
    if (!w) return 'Prices not posted yet.';
    return 'Prices last updated <b>' + esc(w.text) + '</b> <span class="' + (w.hours > 30 ? 'old' : '') + '">(' + esc(w.ago) + ')</span>';
  }
  function cropOptions(sel) {
    return Object.keys(FUT).map(function (c) { return '<option value="' + c + '"' + (c === sel ? ' selected' : '') + '>' + CROP_LABEL[c] + '</option>'; }).join('');
  }
  function futOptions(crop, sel) {
    var list = futuresChoices(crop, today, 8);
    if (sel && futuresOk(crop, sel) && list.indexOf(sel) < 0) list.unshift(sel);
    return list.map(function (c) { return '<option value="' + c + '"' + (c === sel ? ' selected' : '') + '>' + esc(futuresLabel(c)) + '</option>'; }).join('');
  }
  function rowHtml(r, i) {
    var id = 'r' + i;
    return '<div class="ep-row" data-i="' + i + '">' +
      '<div class="top">' +
        '<div class="crop"><label for="' + id + 'c">Crop</label><select id="' + id + 'c" data-f="crop">' + cropOptions(r.crop) + '</select></div>' +
        '<div class="per"><label for="' + id + 'p">Delivery</label><input id="' + id + 'p" type="text" data-f="period" maxlength="' + PERIOD_MAX + '" value="' + esc(r.period) + '" placeholder="Oct/Nov" autocomplete="off"></div>' +
        '<div class="fut"><label for="' + id + 'f">Futures month</label><select id="' + id + 'f" data-f="futures">' + futOptions(r.crop, r.futures) + '</select></div>' +
      '</div>' +
      '<div class="dates">' +
        '<div><label for="' + id + 's">First day</label><input id="' + id + 's" type="date" data-f="start" value="' + esc(r.start) + '"></div>' +
        '<div><label for="' + id + 'e">Last day</label><input id="' + id + 'e" type="date" data-f="end" value="' + esc(r.end) + '"></div>' +
      '</div>' +
      '<div class="lower"><div class="money">' +
        '<div><label for="' + id + 'b">Basis ($/bu)</label><div class="ep-step">' +
          '<button type="button" data-step="-1" aria-label="Basis down one cent">&minus;</button>' +
          '<input id="' + id + 'b" type="number" step="0.01" min="-3" max="2" data-f="basis" value="' + esc(r.basis) + '" placeholder="-0.35">' +
          '<button type="button" data-step="1" aria-label="Basis up one cent">+</button></div></div>' +
        '<div class="ep-cash" data-cash aria-live="polite"></div>' +
      '</div>' +
      '<div class="foot"><span class="fut-px" data-futpx></span><button type="button" class="ep-del" data-del>Remove</button></div></div>' +
      '<div class="ep-err" data-err hidden></div>' +
    '</div>';
  }
  function asOf() {
    var t = prices && Date.parse(prices.fetched || '');
    if (!isFinite(t)) return '';
    var w = when(new Date(t).toISOString());
    return w ? w.text : '';
  }
  function paintRow(i) {
    var el = box.querySelector('.ep-row[data-i="' + i + '"]');
    if (!el) return;
    var r = form.bids[i], b = parseBasis(r.basis);
    var cashEl = el.querySelector('[data-cash]'), futEl = el.querySelector('[data-futpx]');
    var est = cashEstimate(r.futures, b, prices);
    var words = isFinite(b) && px ? px.basis(Math.round(b * 10000) / 100, { contract: futuresLabel(r.futures) }) : '';
    if (est) {
      cashEl.innerHTML = (px ? esc(px.priceDollars(est.cash)) : '$' + est.cash.toFixed(4)) + '<small>Cash price (estimate)</small>';
      var bw = px ? px.basis(Math.round(b * 10000) / 100) : basisText(b);
      futEl.textContent = futuresLabel(r.futures) + ' futures ' + (px ? px.price(est.futures) : '$' + (est.futures / 100).toFixed(4)) +
        ' (delayed' + (asOf() ? ', ' + asOf() : '') + ') plus ' + bw + ' basis';
    } else {
      cashEl.innerHTML = '<span style="color:var(--text-muted)">--</span><small>' + (isFinite(b) ? 'no futures price on file for ' + esc(futuresLabel(r.futures)) : 'type a basis to see cash') + '</small>';
      futEl.textContent = words || '';
    }
  }
  function paintAll() { form.bids.forEach(function (_, i) { paintRow(i); }); }
  function drawRows() {
    var list = box.querySelector('#ep-rows');
    list.innerHTML = form.bids.length ? form.bids.map(rowHtml).join('') :
      '<p class="hint" style="margin:.75rem 0">No bids posted. Add a row for each crop and delivery month you buy.</p>';
    box.querySelector('#ep-add').disabled = form.bids.length >= MAX_ROWS;
    paintAll();
  }
  function draw() {
    box.innerHTML =
      '<h1>' + esc(rec.name) + '</h1>' +
      '<p class="ep-where">' + esc(rec.town) + ', ' + esc(rec.state) + '. Your listing on AGSIST.</p>' +
      '<p class="ep-stamp" id="ep-stamp" aria-live="polite">' + stampHtml() + '</p>' +
      '<button type="button" class="ep-nochange" id="ep-nochange">No change today</button>' +
      '<p class="ep-nochange-note" id="ep-nochange-note">Same prices as last time? One tap tells farmers they are current.</p>' +
      '<section class="ep-card"><h2>Bids</h2><p class="hint">Basis in dollars a bushel: -0.35 is 35 under. The cash price is worked out for you.</p>' +
        '<div id="ep-rows"></div><button type="button" class="ep-add" id="ep-add">+ Add a row</button>' +
        '<p class="ep-foot-note">Cash here is an estimate: the latest delayed futures price on AGSIST plus your basis. Farmers see your basis added to the futures price when they look.</p></section>' +
      '<section class="ep-card"><h2>Hours</h2>' +
        '<label class="ep-switch"><input type="checkbox" id="ep-closed"' + (form.closed ? ' checked' : '') + '> Closed today</label>' +
        '<p class="hint">Shows farmers you are closed until midnight tonight, Central time. It turns off on its own.</p>' +
        '<label for="ep-hours">Regular hours</label><input id="ep-hours" type="text" maxlength="80" placeholder="Mon-Fri 7-5, Sat 7-12" value="' + esc(form.hours) + '">' +
        '<label for="ep-harvest">Harvest hours (leave empty after harvest)</label><input id="ep-harvest" type="text" maxlength="80" placeholder="7am-9pm through Nov 15" value="' + esc(form.harvest) + '"></section>' +
      '<section class="ep-card"><h2>Who farmers call</h2><div class="two">' +
        '<div><label for="ep-cname">Name</label><input id="ep-cname" type="text" maxlength="60" autocomplete="name" value="' + esc(form.cname) + '"></div>' +
        '<div><label for="ep-cphone">Phone</label><input id="ep-cphone" type="tel" maxlength="24" autocomplete="tel" value="' + esc(form.cphone) + '"></div></div></section>' +
      '<section class="ep-card"><h2>Note for farmers</h2>' +
        '<label for="ep-note">Short and current, like "Corn dump open till 9 tonight"</label>' +
        '<textarea id="ep-note" maxlength="' + NOTE_MAX + '" rows="2">' + esc(form.note) + '</textarea><div class="ep-count" id="ep-count"></div></section>' +
      '<p class="ep-foot-note">This page is private to you. Anyone with this link can change your listing, so keep it to yourself. Lost it, or want a new one? Email Sig at ' + MAIL + '.</p>' +
      '<div class="ep-bar"><div class="in"><button type="button" class="ep-save" id="ep-save">Save</button><div class="ep-state" id="ep-state" role="status" aria-live="polite"></div></div></div>';
    drawRows();
    count();
    status();
  }
  function count() { var c = box.querySelector('#ep-count'); if (c) c.textContent = form.note.length + ' / ' + NOTE_MAX; }

  var lastState = { cls: '', text: '' };
  function status(cls, text) {
    var el = box.querySelector('#ep-state');
    if (!el) return;
    if (cls === undefined) {
      if (dirty()) { cls = 'dirty'; text = 'Changes not saved yet.'; }
      else if (lastState.cls === 'ok' || lastState.cls === 'bad') { cls = lastState.cls; text = lastState.text; }
      else { cls = ''; text = 'Everything here is saved.'; }
    } else lastState = { cls: cls, text: text };
    el.className = 'ep-state' + (cls ? ' ' + cls : '');
    el.textContent = text;
    var nc = box.querySelector('#ep-nochange'), note = box.querySelector('#ep-nochange-note');
    if (nc && !busy) {
      var bd = bidsDirty();
      nc.disabled = bd || !form.bids.length;
      note.textContent = bd ? 'You changed prices. Tap Save to post them.' :
        !form.bids.length ? 'Add your bids below first.' : 'Same prices as last time? One tap tells farmers they are current.';
    }
  }
  function changed() { keepDraft(); status(); }

  /* ── reading the form ── */
  function rowOf(el) { var r = el.closest('.ep-row'); return r ? +r.getAttribute('data-i') : -1; }
  box.addEventListener('input', function (e) {
    var t = e.target, f = t.getAttribute && t.getAttribute('data-f');
    if (f) {
      var i = rowOf(t), r = form.bids[i];
      if (!r) return;
      r[f] = t.value;
      t.classList.remove('ep-bad');
      if (f === 'crop' && !futuresOk(r.crop, r.futures)) {
        var y = +String(r.start).slice(0, 4) || today.getFullYear(), m = +String(r.start).slice(5, 7) || today.getMonth() + 1;
        r.futures = nextFutures(r.crop, y, m);
        var sel = t.closest('.ep-row').querySelector('[data-f="futures"]');
        sel.innerHTML = futOptions(r.crop, r.futures);
      }
      paintRow(i);
      return changed();
    }
    var map = { 'ep-hours': 'hours', 'ep-harvest': 'harvest', 'ep-cname': 'cname', 'ep-cphone': 'cphone', 'ep-note': 'note' };
    if (map[t.id]) { form[map[t.id]] = t.value; if (t.id === 'ep-note') count(); return changed(); }
    if (t.id === 'ep-closed') { form.closed = t.checked; return changed(); }
  });
  box.addEventListener('change', function (e) {
    var t = e.target;
    if (t.id === 'ep-closed') { form.closed = t.checked; return changed(); }
    if (t.getAttribute && t.getAttribute('data-f') === 'basis') {
      /* a whole number like -35 becomes -0.35 once the box is left */
      var i = rowOf(t), b = parseBasis(t.value);
      if (isFinite(b) && String(b) !== t.value) { t.value = basisText(b); form.bids[i].basis = t.value; paintRow(i); changed(); }
    }
    if (t.getAttribute && (t.getAttribute('data-f') === 'crop' || t.getAttribute('data-f') === 'futures')) {
      var j = rowOf(t); form.bids[j][t.getAttribute('data-f')] = t.value; paintRow(j); changed();
    }
  });
  box.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('button') : null;
    if (!t) return;
    if (t.hasAttribute('data-step')) {
      var i = rowOf(t), r = form.bids[i], b = parseBasis(r.basis);
      if (!isFinite(b)) b = 0;
      b = Math.max(-3, Math.min(2, Math.round((b + Number(t.getAttribute('data-step')) / 100) * 100) / 100));
      r.basis = basisText(b);
      var inp = t.parentNode.querySelector('input'); inp.value = r.basis; inp.classList.remove('ep-bad');
      paintRow(i); return changed();
    }
    if (t.hasAttribute('data-del')) {
      form.bids.splice(rowOf(t), 1); drawRows(); return changed();
    }
    if (t.id === 'ep-add') {
      if (form.bids.length >= MAX_ROWS) return;
      var nr = newRow(form.bids.map(function (x) { return { crop: x.crop, end: x.end, basis: x.basis }; }), today);
      form.bids.push(nr); drawRows(); changed();
      var last = box.querySelector('.ep-row[data-i="' + (form.bids.length - 1) + '"]');
      if (last) { try { last.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (err) {} }
      return;
    }
    if (t.id === 'ep-save') return save();
    if (t.id === 'ep-nochange') return noChange();
  });

  function showErrors(errors) {
    box.querySelectorAll('.ep-row [data-err]').forEach(function (x) { x.hidden = true; x.textContent = ''; });
    errors.forEach(function (er) {
      var row = box.querySelector('.ep-row[data-i="' + er.row + '"]');
      if (!row) return;
      var msg = row.querySelector('[data-err]');
      msg.hidden = false; msg.textContent = (msg.textContent ? msg.textContent + ' ' : '') + er.msg;
      var sel = er.field === 'dates' ? '[data-f="start"],[data-f="end"]' : '[data-f="' + er.field + '"]';
      row.querySelectorAll(sel).forEach(function (x) { x.classList.add('ep-bad'); });
    });
    if (errors.length) {
      var first = box.querySelector('.ep-row[data-i="' + errors[0].row + '"]');
      if (first) { try { first.scrollIntoView({ block: 'center' }); } catch (e) {} }
    }
  }

  /* THE WORKER DOWN (2026-10-22). The last listing this phone opened is kept
     here (LAST), so the page still opens with the worker blocked; a save is
     kept in this browser (components/outbox.js) and posts when the worker
     answers and this page is opened again on this phone. Every save carries
     entered_at, the moment Save was pressed; the worker (v5.50) stores that
     time, not the time a kept save arrives, so the board shows how old the
     prices really are ("Updated 6:10 AM Wed"), and a kept save never
     overwrites a newer one (Sig, Oct 22). */
  var LAST = 'elev-last', LAST_DAYS = 14, OFFLINE = false;
  function keepLast(r) { try { localStorage.setItem(LAST, JSON.stringify({ k: key.trim(), rec: r, t: Date.now() })); } catch (e) {} }
  function lastRec() {
    try {
      var d = JSON.parse(localStorage.getItem(LAST) || 'null');
      if (d && d.k === key.trim() && d.rec && Date.now() - d.t < LAST_DAYS * 86400000) return d.rec;
    } catch (e) {}
    return null;
  }
  var KEPT_LINE = 'Kept on this phone. It posts, with the time you saved it, when our system is back and you open this page again.';
  function keepSave(body) {
    if (!root.AgOutbox) return false;
    var id = root.AgOutbox.add({ url: WORKER + '/elev/save', body: body, kind: 'elev-save', label: 'your bids' });
    if (!id) return false;
    keepDraft();
    status('ok', KEPT_LINE);
    return true;
  }

  function save() {
    if (busy) return;
    var c = checkRows(form.bids);
    showErrors(c.errors);
    var phone = form.cphone.trim();
    if (phone && (!/^[0-9()+\-. ]+$/.test(phone) || phone.replace(/\D/g, '').length < 7)) {
      box.querySelector('#ep-cphone').classList.add('ep-bad');
      return status('bad', 'Not saved. The phone number does not look right.');
    }
    if (c.errors.length) return status('bad', 'Not saved. Fix the row marked in red, then tap Save.');
    var hadBids = rec.bids_updated_at, priceChange = bidsDirty();
    busy = true;
    var btn = box.querySelector('#ep-save');
    btn.disabled = true; btn.textContent = 'Saving...';
    var body = { k: key, bids: c.bids, hours: { text: form.hours, harvest: form.harvest }, contact: { name: form.cname, phone: phone },
      note: form.note, closed_today: form.closed, entered_at: new Date().toISOString() };
    post('/elev/save', body).then(function (j) {
      busy = false; btn.disabled = false; btn.textContent = 'Save';
      if (!j.ok && j._down && keepSave(body)) return;
      if (!j.ok || !j.record) {
        var why = j._status === 0 ? 'No signal or AGSIST could not be reached.' :
          j._status === 403 ? 'This listing has been turned off. Email Sig at ' + SIG_EMAIL + '.' :
          j._status === 404 ? 'This link no longer works. Email Sig at ' + SIG_EMAIL + ' for a new one.' :
          j._status === 429 ? 'Too many saves this hour. Wait a few minutes.' :
          j._status === 409 && j.newer ? 'A newer save is already posted. Open the page again to see it.' :
          'AGSIST said: ' + String(j.error || 'something went wrong') + '.';
        status('bad', 'Not saved. ' + why + ' Your changes are still here; tap Save to try again.');
        return;
      }
      rec = j.record; keepLast(rec);
      form = fromRecord(rec); base = snapshot(form);
      try { localStorage.removeItem(DRAFT()); } catch (e) {}
      draw();
      var w = when(new Date().toISOString());
      status('ok', priceChange || !hadBids ? 'Saved ' + w.text + '. Farmers see it now.' :
        'Saved ' + w.text + '. Prices were the same, so the time did not move. Tap No change today to show they are current.');
    });
  }

  function noChange() {
    if (busy || bidsDirty()) return;
    busy = true;
    var b = box.querySelector('#ep-nochange');
    b.disabled = true; b.textContent = 'Marking...';
    var nb = { k: key, no_change: true, entered_at: new Date().toISOString() };
    post('/elev/save', nb).then(function (j) {
      busy = false;
      if (!j.ok && j._down && keepSave(nb)) { b.textContent = 'No change today'; return; }
      if (!j.ok || !j.record) {
        b.textContent = 'No change today';
        status('bad', j._status === 0 ? 'Not marked. No signal or AGSIST could not be reached. Tap again.' : 'Not marked. ' + String(j.error || 'Something went wrong') + '.');
        return;
      }
      rec.bids_updated_at = j.record.bids_updated_at;
      /* only the time moved; anything typed and not saved stays as it is */
      box.querySelector('#ep-stamp').innerHTML = stampHtml();
      b.textContent = 'Marked current';
      setTimeout(function () { b.textContent = 'No change today'; status(); }, 4000);
      keepDraft();
      status('ok', 'Prices marked current ' + when(rec.bids_updated_at).text + '.');
    });
  }

  // a save kept while the worker was down went through: show the listing as the worker has it now
  root.addEventListener('agsist:outbox', function (e) {
    if (e && e.detail && e.detail.sent && e.detail.sent.length && !busy) { LEAVING = true; try { localStorage.removeItem(DRAFT()); } catch (x) {} location.reload(); }
  });
  var LEAVING = false;
  root.addEventListener('beforeunload', function (e) { if (form && dirty() && !LEAVING) { e.preventDefault(); e.returnValue = ''; } });

  /* ── start ── */
  if (!/^[a-zA-Z2-7]{24}$/.test(key.trim())) { refused({ _status: 404 }); return; }
  var pricesP = (root.AG && root.AG.json ? root.AG.json('/data/prices.json') : fetch('/data/prices.json').then(function (r) { return r.json(); }))
    .then(function (d) { prices = d; if (form) paintAll(); }, function () { prices = null; });
  post('/elev/me', { k: key.trim() }).then(function (j) {
    var kept = !j.ok && j._down ? lastRec() : null;
    if (kept) { OFFLINE = true; j = { ok: true, record: kept }; }
    if (!j.ok || !j.record) return refused(j);
    rec = j.record;
    if (!OFFLINE) keepLast(rec);
    var saved = fromRecord(rec);
    base = snapshot(saved);
    var draft = takeDraft();
    form = draft || saved;
    if (!form.bids.length && !draft) form.bids.push(newRow([], today));
    draw();
    if (OFFLINE) status('bad', 'Our system is down right now, so this is your listing as this phone last saw it. You can still change it and tap Save.');
    else if (draft && dirty()) status('dirty', 'Brought back changes you had not saved. Tap Save to post them.');
    document.title = rec.name + ', ' + rec.town + ' | Post your bids | AGSIST';
    return pricesP;
  });
})(typeof window !== 'undefined' ? window : globalThis);
