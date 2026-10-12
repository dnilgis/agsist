/* Gauge Lab (/gauge-lab): the page code. Photo in, reading confirmed, log kept.
 *
 * The reading itself is components/gauge-read.js (pure, tested in node).
 * This file only wires the page: file input, canvases, buttons, the log in
 * localStorage, downloads, and the printable test strip.
 *
 * Nothing here sends a photo or a reading anywhere. The photo is decoded into
 * a canvas on the device and dropped when the page closes.
 */
(function () {
  'use strict';
  var G = window.GaugeRead;
  var $ = function (id) { return document.getElementById(id); };

  /* ------------------------------------------------------------------
   * CLOUD VISION FALLBACK: STUB, NOT BUILT.
   * If on-device reading keeps failing on real photos, a server-side
   * vision read could go here later. It is deliberately empty: it is never
   * called, it sends nothing, and adding it would need its own consent step
   * on the page saying where the photo goes. Keep it that way until then.
   * ------------------------------------------------------------------ */
  function cloudVisionFallback(/* imageBlob */) {
    return Promise.resolve(null);
  }
  void cloudVisionFallback;

  var MAX_SIDE = 1600, R_ZOOM = 200;
  var spec = null;
  var gauge = G.cleanGaugeId(new URLSearchParams(location.search).get('g'));
  var LOG_KEY = 'agsist-gauge-log:' + (gauge || 'default');
  var SEASON_KEY = 'agsist-gauge-season';
  var storageOK = true;

  var state = { img: null, res: null, value: null, auto: null, src: 'typed', tap: false };
  var log = [];

  // ---------- storage ----------
  function loadLog() {
    try {
      var raw = localStorage.getItem(LOG_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      log = Array.isArray(arr) ? arr.filter(function (e) {
        return e && typeof e.when === 'string' && typeof e.rain === 'number' && isFinite(e.rain);
      }) : [];
    } catch (e) { storageOK = false; log = []; }
  }
  function saveLog() {
    try { localStorage.setItem(LOG_KEY, JSON.stringify(log)); storageOK = true; }
    catch (e) { storageOK = false; }
    $('gl-nosave').hidden = storageOK;
  }
  function seasonStart() {
    var y = new Date().getFullYear() + '-04-01', v = null;
    try { v = localStorage.getItem(SEASON_KEY); } catch (e) { /* default */ }
    return /^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : y;
  }

  // ---------- small helpers ----------
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function nowLocal() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function niceWhen(when) {
    var p = when.slice(0, 10).split('-').map(Number);
    var d = new Date(p[0], p[1] - 1, p[2]);
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) +
      ', ' + G.clock12(when.slice(11, 16));
  }
  function say(msg, kind) {
    var el = $('gl-status');
    el.textContent = msg || '';
    el.className = 'gl-status' + (kind ? ' is-' + kind : '');
    el.hidden = !msg;
  }
  function clampRain(v) { return Math.max(0, Math.min(9.99, Math.round(v * 100) / 100)); }
  function download(name, text, type) {
    var blob = new Blob([text], { type: type });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function fileStem() { return 'rain-log-' + (gauge || 'gauge') + '-' + nowLocal().slice(0, 10); }

  // ---------- photo in ----------
  function decode(file) {
    if (window.createImageBitmap) {
      return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(function () { return viaImg(file); });
    }
    return viaImg(file);
  }
  function viaImg(file) {
    return new Promise(function (ok, bad) {
      var url = URL.createObjectURL(file), im = new Image();
      im.onload = function () { ok(im); setTimeout(function () { URL.revokeObjectURL(url); }, 0); };
      im.onerror = function () { URL.revokeObjectURL(url); bad(new Error('decode')); };
      im.src = url;
    });
  }

  function onFile(ev) {
    var f = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!f) return;
    say('Reading the photo…');
    decode(f).then(function (bmp) {
      var w = bmp.width, h = bmp.height, k = Math.min(1, MAX_SIDE / Math.max(w, h));
      var c = document.createElement('canvas');
      c.width = Math.round(w * k); c.height = Math.round(h * k);
      var cx = c.getContext('2d', { willReadFrequently: true });
      cx.drawImage(bmp, 0, 0, c.width, c.height);
      if (bmp.close) bmp.close();
      state.img = cx.getImageData(0, 0, c.width, c.height);
      state.photoCanvas = c;
      setTimeout(runRead, 20);
    }).catch(function () {
      say("That file didn't open as a photo. Try a JPEG or PNG from the camera.", 'bad');
    });
  }

  function runRead() {
    if (!spec) { say("The strip settings didn't load. Refresh the page and try again.", 'bad'); return; }
    var res;
    try { res = G.read(state.img, spec); }
    catch (e) { res = { ok: false, code: 'markers', message: G.MSG.markers }; }
    state.res = res;
    state.tap = false;
    $('gl-card').hidden = false;
    $('gl-photo-wrap').hidden = !!res.rect;
    if (!res.rect) drawPhoto();
    $('gl-views').hidden = !res.rect;
    if (res.ok) {
      state.auto = res.rain; state.src = 'photo';
      setValue(res.rain);
      var how = { arrow: 'Read from the arrowhead on the blue stripe.', step: 'Read from where the blue stripe widens.',
        meniscus: res.note || 'Read from the meniscus.', empty: res.note || 'No water found.' }[res.method] || '';
      say('Check the line against the water, then log it. ' + how, 'ok');
    } else {
      state.auto = null; state.src = 'typed';
      setValue(state.value == null ? 0 : state.value);
      say(res.message + (res.rect ? '' : ' Or read the tube by eye and type the number below.'), 'bad');
      if (res.rect) setTap(true);
    }
    $('gl-when').value = nowLocal();
    drawViews();
    $('gl-status').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function drawPhoto() {
    var c = $('gl-photo'), src = state.photoCanvas;
    if (!src) return;
    var k = Math.min(1, 900 / Math.max(src.width, src.height));
    c.width = Math.round(src.width * k); c.height = Math.round(src.height * k);
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  }

  // ---------- reading views ----------
  function levelIn() { return (state.value || 0) * spec.ratio; }

  function putImage(canvas, rect) {
    canvas.width = rect.width; canvas.height = rect.height;
    var cx = canvas.getContext('2d');
    cx.putImageData(new ImageData(rect.data, rect.width, rect.height), 0, 0);
    return cx;
  }
  function drawLine(cx, w, y, thick) {
    cx.save();
    cx.lineWidth = thick + 2; cx.strokeStyle = 'rgba(0,0,0,.75)';
    cx.beginPath(); cx.moveTo(0, y); cx.lineTo(w, y); cx.stroke();
    cx.lineWidth = thick; cx.strokeStyle = '#e8743a';
    cx.beginPath(); cx.moveTo(0, y); cx.lineTo(w, y); cx.stroke();
    cx.restore();
  }

  function zoomBox() {
    var L = levelIn();
    return { x0: spec.tube.x0 - 0.15, x1: spec.tube.x1 + 0.15, y0: L - 0.45, y1: L + 0.45 };
  }

  function drawViews() {
    var res = state.res;
    if (!res || !res.rect) return;
    var rect = res.rect, L = levelIn();
    var cx = putImage($('gl-over'), rect);
    drawLine(cx, rect.width, (rect.box.y1 - L) * rect.R, 6);
    var zb = zoomBox();
    var z = G.rectify(state.img, res.H, zb, R_ZOOM);
    var zx = putImage($('gl-zoom'), z);
    drawLine(zx, z.width, (zb.y1 - L) * R_ZOOM, 3);
    $('gl-views').classList.toggle('is-tap', state.tap);
  }

  function setValue(v) {
    state.value = clampRain(v);
    $('gl-val').value = state.value.toFixed(2);
    drawViews();
  }
  function nudge(d) {
    setValue((state.value || 0) + d);
    if (state.src === 'photo') state.src = 'adjusted';
  }
  function setTap(on) {
    state.tap = on;
    var b = $('gl-tap');
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.textContent = on ? 'Tap the water line on the picture' : 'Tap the water line';
    $('gl-views').classList.toggle('is-tap', on);
  }
  function onCanvasTap(ev, which) {
    if (!state.tap || !state.res || !state.res.rect) return;
    var c = ev.currentTarget, r = c.getBoundingClientRect();
    var py = (ev.clientY - r.top) / r.height * c.height, y;
    if (which === 'over') y = state.res.rect.box.y1 - py / state.res.rect.R;
    else y = zoomBox().y1 - py / R_ZOOM;
    state.src = 'tap';
    setValue(Math.max(0, y) / spec.ratio);
    say('Line set to ' + G.fmtRain(state.value) + '. Tap again to move it, or use − and +.', 'ok');
  }

  // ---------- log ----------
  function logIt() {
    var when = $('gl-when').value;
    var v = parseFloat($('gl-val').value);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(when)) { say('Set the date and time of the reading first.', 'bad'); return; }
    if (!isFinite(v) || v < 0) { say('The amount has to be a number, like 0.42.', 'bad'); return; }
    var e = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), when: when.slice(0, 16),
      rain: clampRain(v), src: state.src };
    if (state.auto != null) e.read = state.auto;
    log.push(e);
    saveLog();
    renderLog(e.id);
    say('Logged ' + G.fmtRain(e.rain) + ' for ' + niceWhen(e.when) + '.', 'ok');
    $('gl-log').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  var undo = null;
  function renderLog(pickId) {
    var list = G.sortLog(log), tb = $('gl-rows'), now = nowLocal();
    var t = G.totals(log, now.slice(0, 7), seasonStart());
    $('gl-month').textContent = G.fmtRain(t.month);
    $('gl-season').textContent = G.fmtRain(t.season);
    $('gl-count').textContent = t.count + (t.count === 1 ? ' reading' : ' readings');
    $('gl-empty').hidden = list.length > 0;
    $('gl-table').hidden = list.length === 0;
    $('gl-dl').hidden = list.length === 0;
    tb.textContent = '';
    list.forEach(function (e) {
      var tr = document.createElement('tr');
      tr.dataset.id = e.id;
      tr.innerHTML = '<td class="gl-w"></td><td class="gl-r num"></td><td class="gl-act"></td>';
      tr.children[0].textContent = niceWhen(e.when);
      tr.children[1].textContent = G.fmtRain(e.rain);
      var ed = btn('Edit', 'btn btn-secondary gl-sm'), del = btn('Delete', 'btn btn-secondary gl-sm'), cp = btn('CoCoRaHS', 'btn btn-secondary gl-sm');
      ed.onclick = function () { editRow(tr, e); };
      del.onclick = function () { removeEntry(e); };
      cp.onclick = function () { showCocorahs(e); };
      cp.setAttribute('aria-label', 'Show CoCoRaHS text for ' + niceWhen(e.when));
      tr.children[2].append(cp, ed, del);
      tb.appendChild(tr);
    });
    var pick = list.filter(function (e) { return e.id === pickId; })[0] || list[0];
    if (pick) showCocorahs(pick); else $('gl-coco-wrap').hidden = true;
  }
  function btn(text, cls) { var b = document.createElement('button'); b.type = 'button'; b.className = cls; b.textContent = text; return b; }

  function editRow(tr, e) {
    tr.innerHTML = '<td colspan="3"><div class="gl-edit">' +
      '<label class="field"><span>Date and time</span><input type="datetime-local" class="gl-e-when"></label>' +
      '<label class="field"><span>Rain (in)</span><input type="number" inputmode="decimal" step="0.01" min="0" class="gl-e-rain"></label>' +
      '<div class="gl-edit-b"></div></div></td>';
    tr.querySelector('.gl-e-when').value = e.when;
    tr.querySelector('.gl-e-rain').value = e.rain.toFixed(2);
    var save = btn('Save', 'btn btn-primary gl-sm'), cancel = btn('Cancel', 'btn btn-secondary gl-sm');
    save.onclick = function () {
      var w = tr.querySelector('.gl-e-when').value, v = parseFloat(tr.querySelector('.gl-e-rain').value);
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(w) || !isFinite(v) || v < 0) { say('Check the date and the amount.', 'bad'); return; }
      e.when = w.slice(0, 16); e.rain = clampRain(v); e.edited = true;
      saveLog(); renderLog(e.id); say('Saved.', 'ok');
    };
    cancel.onclick = function () { renderLog(e.id); };
    tr.querySelector('.gl-edit-b').append(save, cancel);
    tr.querySelector('.gl-e-rain').focus();
  }

  function removeEntry(e) {
    log = log.filter(function (x) { return x.id !== e.id; });
    saveLog(); renderLog();
    undo = e;
    var el = $('gl-undo');
    $('gl-undo-msg').textContent = 'Deleted ' + G.fmtRain(e.rain) + ' from ' + niceWhen(e.when) + '.';
    el.hidden = false;
  }
  function undoDelete() {
    if (!undo) return;
    log.push(undo); saveLog(); renderLog(undo.id);
    undo = null; $('gl-undo').hidden = true;
  }

  function showCocorahs(e) {
    $('gl-coco').value = G.cocorahsText(e);
    $('gl-coco-wrap').hidden = false;
    $('gl-copied').textContent = '';
  }
  function copyCocorahs() {
    var ta = $('gl-coco'), done = function () { $('gl-copied').textContent = 'Copied.'; };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(ta.value).then(done, function () { ta.select(); try { document.execCommand('copy'); done(); } catch (x) { /* select is enough */ } });
    } else { ta.select(); try { document.execCommand('copy'); done(); } catch (x) { /* select is enough */ } }
  }

  // ---------- test strip (true size, letter paper) ----------
  function f2(n) { return Math.round(n * 1000) / 1000; }
  function stripSVG(y0, y1) {
    var s = spec, W = s.width, H = y1 - y0, Y = function (y) { return f2(y1 - y); };
    var o = ['<svg xmlns="http://www.w3.org/2000/svg" width="' + W + 'in" height="' + f2(H) + 'in" viewBox="0 0 ' + W + ' ' + f2(H) + '" role="img" aria-label="Test strip from ' + Math.max(0, y0 / s.ratio).toFixed(2) + ' to ' + Math.min(1, y1 / s.ratio).toFixed(2) + ' in">'];
    o.push('<rect x="0" y="0" width="' + W + '" height="' + f2(H) + '" fill="#fff" stroke="#bbb" stroke-width="0.01"/>');
    var st = s.stripe, sy0 = Math.max(y0, s.scale.zero_y - 0.3), sy1 = Math.min(y1, s.scale.full_y + 0.3);
    if (sy1 > sy0) o.push('<rect x="' + f2(st.x - st.width / 2) + '" y="' + Y(sy1) + '" width="' + st.width + '" height="' + f2(sy1 - sy0) + '" fill="' + st.color + '"/>');
    var L = s.ticks.left, Rr = s.ticks.right, n = Math.round((s.scale.full_y - s.scale.zero_y) / s.scale.minor);
    for (var i = 0; i <= n; i++) {
      var y = s.scale.zero_y + i * s.scale.minor;
      if (y < y0 - 1e-9 || y > y1 + 1e-9) continue;
      var major = i % 10 === 0, mid = i % 5 === 0, len = major ? 0.6 : mid ? 0.3 : 0.15, th = major ? 0.02 : 0.012;
      o.push('<rect x="' + f2(L[1] - len) + '" y="' + f2(Y(y) - th / 2) + '" width="' + len + '" height="' + th + '" fill="#111"/>');
      o.push('<rect x="' + Rr[0] + '" y="' + f2(Y(y) - th / 2) + '" width="' + len + '" height="' + th + '" fill="#111"/>');
      if (major) o.push('<text x="0.1" y="' + f2(Y(y) - 0.05) + '" font-size="0.13" font-family="Inter,Arial,sans-serif" font-weight="700" fill="#111">' + (y / s.ratio).toFixed(2) + '</text>');
    }
    var M = s.markers;
    ['tl', 'tr', 'bl', 'br'].forEach(function (k) {
      var c = M[k];
      if (c[1] + M.size / 2 < y0 || c[1] - M.size / 2 > y1) return;
      o.push('<rect x="' + f2(c[0] - M.size / 2) + '" y="' + f2(Y(c[1]) - M.size / 2) + '" width="' + M.size + '" height="' + M.size + '" fill="#000"/>');
      o.push('<rect x="' + f2(c[0] - M.hole / 2) + '" y="' + f2(Y(c[1]) - M.hole / 2) + '" width="' + M.hole + '" height="' + M.hole + '" fill="#fff"/>');
    });
    if (y0 <= s.y_min + 1e-9) o.push('<text x="' + st.x + '" y="' + Y(s.y_min + 0.22) + '" font-size="0.07" text-anchor="middle" font-family="Arial,sans-serif" fill="#777">' + s.id + ' · 10:1</text>');
    o.push('</svg>');
    return o.join('');
  }

  function buildStrip() {
    var tiles = spec.tiles, out = [];
    tiles.forEach(function (t, i) {
      var lap = i === 0 ? 'Top edge goes under piece ' + tiles[1].name + '.' : 'Lay this over piece ' + tiles[0].name + ' so the ticks match.';
      out.push('<figure class="gl-tile"><figcaption><b>Piece ' + t.name + '</b> ' +
        (i === 0 ? '(bottom, 0.00 to ' + (t.y1 / spec.ratio).toFixed(2) + ')' : '(top, ' + (t.y0 / spec.ratio).toFixed(2) + ' to 1.00)') +
        '<br>' + lap + '</figcaption>' + stripSVG(t.y0, t.y1) + '</figure>');
    });
    $('gl-tiles').innerHTML = out.join('');
  }

  // ---------- wiring ----------
  function init() {
    if (gauge) { $('gl-gauge').hidden = false; $('gl-gauge-id').textContent = gauge; }
    loadLog();
    $('gl-nosave').hidden = storageOK;
    $('gl-season-start').value = seasonStart();
    renderLog();

    $('gl-cam').addEventListener('change', onFile);
    $('gl-lib').addEventListener('change', onFile);
    $('gl-minus').onclick = function () { nudge(-0.01); };
    $('gl-plus').onclick = function () { nudge(0.01); };
    $('gl-val').addEventListener('change', function () {
      var v = parseFloat(this.value);
      if (isFinite(v)) { state.src = state.res ? 'adjusted' : 'typed'; setValue(v); }
      else this.value = (state.value || 0).toFixed(2);
    });
    $('gl-tap').onclick = function () { setTap(!state.tap); };
    $('gl-over').addEventListener('click', function (ev) { onCanvasTap(ev, 'over'); });
    $('gl-zoom').addEventListener('click', function (ev) { onCanvasTap(ev, 'zoom'); });
    $('gl-logit').onclick = logIt;
    $('gl-now').onclick = function () { $('gl-when').value = nowLocal(); };
    $('gl-type').onclick = function () {
      state.res = null; state.auto = null; state.src = 'typed';
      $('gl-card').hidden = false; $('gl-views').hidden = true; $('gl-photo-wrap').hidden = true;
      setValue(state.value || 0);
      $('gl-when').value = nowLocal();
      say('Read the tube by eye and type the amount.', '');
      $('gl-val').focus();
    };
    $('gl-csv').onclick = function () { download(fileStem() + '.csv', G.toCSV(log, gauge), 'text/csv'); };
    $('gl-ics').onclick = function () {
      var stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
      download(fileStem() + '.ics', G.toICS(log, gauge, stamp), 'text/calendar');
    };
    $('gl-copy').onclick = copyCocorahs;
    $('gl-undo-b').onclick = undoDelete;
    $('gl-season-start').addEventListener('change', function () {
      if (/^\d{4}-\d{2}-\d{2}$/.test(this.value)) { try { localStorage.setItem(SEASON_KEY, this.value); } catch (e) { /* this visit only */ } }
      renderLog();
    });
    $('gl-print').onclick = function () { window.print(); };

    fetch('/data/gauge-strip.json', { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    }).then(function (j) {
      spec = j;
      buildStrip();
      $('gl-start').disabled = false;
    }).catch(function () {
      say("The strip settings didn't load, so photos can't be read right now. Typing a reading still works.", 'bad');
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
