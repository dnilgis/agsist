/* storm-replay.js: "Storm replay over your field" on /hail-map and /rain-radar.
 * Loaded only when a reader opens a replay (each page carries a few lines
 * that fetch this file, components/storm-replay-core.js and, on /hail-map,
 * components/radar-rain.js). Leaflet is already on both pages.
 *
 * On one clock, every 15 minutes for 24 hours (30 minutes for 48):
 *   NOAA radar           NWS NEXRAD mosaic, Iowa Environmental Mesonet tiles (archived, every 5 min)
 *   NOAA lightning       nowCOAST 15-minute strike density (WMS with TIME)
 *   NOAA satellite       nowCOAST GOES infrared (WMS with TIME), off unless picked
 *   radar hail estimate  our MRMS MESH, hour by hour (data/hail/mesh/hours.json)
 *   NWS hail reports     Local Storm Reports via the Iowa Environmental Mesonet
 *   rain total           our MRMS 24-hour total at the field (data/radar-rain/)
 * Each source says when it is down; a frame it cannot fill is labeled, not blank.
 * Share links carry the whole view: place, layers, window and frame. */
(function () {
  'use strict';
  var C = window.AgStormCore, L = window.L;
  if (!C) return;
  var MIN = C.MIN, HOUR = C.HOUR;
  var FRAME_MS = 200, STORM_FRAME_MS = 800, LAST_HOLD_MS = 1400, WAIT_MS = 5000;
  var KEEP_BEHIND = 2, AHEAD_PLAY = 6, AHEAD_IDLE = 2, WARM_CONC = 2;
  var BASE_URL = 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}';
  var HAIL_COL = { 0.75: '#f1c453', 1: '#ee8d3a', 1.5: '#d8452b', 2: '#8e1b56' };
  var OPAC = { radar: 0.72, lightning: 0.85, clouds: 0.45 };
  var REP_COL = '#cfe9ff', REP_NEW = '#7cc4ff';
  var R = null;

  function $(sel, el) { return (el || document).querySelector(sel); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function timed(p, ms) {
    var to;
    return Promise.race([p, new Promise(function (_, no) { to = setTimeout(function () { no(new Error('timeout')); }, ms); })])
      .then(function (v) { clearTimeout(to); return v; }, function (e) { clearTimeout(to); throw e; });
  }
  function getJSON(u, ms) { return timed(fetch(u).then(function (r) { if (!r.ok) { var e = new Error('HTTP ' + r.status); e.status = r.status; throw e; } return r.json(); }), ms || 12000); }
  function getText(u, ms) { return timed(fetch(u).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); }), ms || 12000); }
  function reduced() { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }
  function saveData() { try { return !!(navigator.connection && navigator.connection.saveData); } catch (e) { return false; } }
  function tz() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { return undefined; } }

  /* ---------- styles (only when the replay opens) ---------- */
  var CSS = [
    '.sr{position:fixed;inset:0;z-index:10050;background:rgba(6,8,9,.62);display:flex;align-items:stretch;justify-content:center;overscroll-behavior:contain}',
    '.sr-panel{background:var(--bg,#0a0c0d);color:var(--text,#e9edeb);width:100%;max-width:1180px;display:flex;flex-direction:column;overflow:auto;-webkit-overflow-scrolling:touch}',
    '@media(min-width:900px){.sr{padding:24px}.sr-panel{border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,.45);display:grid;grid-template-columns:minmax(0,1fr) 360px;grid-template-rows:auto 1fr;overflow:hidden}',
    '.sr-top{grid-column:1/-1}.sr-left{display:flex;flex-direction:column;min-height:0}.sr-right{overflow:auto;border-left:1px solid var(--border,rgba(132,160,168,.13))}.sr-mapwrap{flex:1;min-height:420px}}',
    '.sr-top{display:flex;align-items:center;gap:.6rem;padding:.6rem 16px;border-bottom:1px solid var(--border,rgba(132,160,168,.13))}',
    '.sr-top h2{font-size:1rem;margin:0;font-weight:700;letter-spacing:.01em;outline:0}.sr-place{color:var(--text-muted,#aab);font-size:.86rem;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.sr-x{appearance:none;border:1px solid var(--border-2,rgba(132,160,168,.24));background:transparent;color:inherit;border-radius:999px;width:36px;height:36px;font-size:1.25rem;line-height:1;cursor:pointer}',
    '.sr-cap{padding:.75rem 16px .5rem}',
    '.sr-head{font-size:1.08rem;line-height:1.38;font-weight:650;margin:0 0 .45rem}',
    '.sr-lines{list-style:none;margin:0;padding:0;display:grid;gap:.4rem}',
    '.sr-lines li{font-size:.88rem;line-height:1.42;color:var(--text-dim,#dde);display:grid;grid-template-columns:auto 1fr;gap:.5rem;align-items:baseline}',
    '.sr-tag{font-size:.66rem;text-transform:uppercase;letter-spacing:.06em;font-weight:700;border-radius:999px;padding:.12rem .45rem;border:1px solid;white-space:nowrap}',
    '.sr-tag.est{color:#e8b55a;border-color:rgba(232,181,90,.55)}.sr-tag.obs{color:#7fcf9c;border-color:rgba(127,207,156,.55)}',
    '[data-theme="light"] .sr-tag.est{color:#8a5a00}[data-theme="light"] .sr-tag.obs{color:#1e6b3a}',
    '.sr-mapwrap{position:relative;height:min(52vh,430px);min-height:280px;background:#1a2022}',
    '.sr-map{position:absolute;inset:0}',
    '.sr-map .sr-base{filter:grayscale(.9) contrast(.92) brightness(1.04)}',
    '.sr-fr{transition:opacity .22s linear}',
    '@media(prefers-reduced-motion:reduce){.sr-fr{transition:none}}',
    '.sr-clock{position:absolute;left:10px;top:10px;z-index:500;background:rgba(10,12,13,.82);color:#f3f5f4;border-radius:10px;padding:.35rem .6rem;font-variant-numeric:tabular-nums;pointer-events:none}',
    '.sr-clock b{font-size:1.02rem;font-weight:700}.sr-clock small{opacity:.75;margin-left:.3rem}',
    '.sr-flag{position:absolute;left:10px;right:10px;bottom:22px;z-index:500;display:flex;flex-wrap:wrap;gap:.35rem;pointer-events:none}',
    '.sr-flag span{background:rgba(10,12,13,.84);color:#f3f5f4;border-radius:8px;padding:.25rem .5rem;font-size:.78rem}',
    '.sr-flag span.hail{background:rgba(142,27,86,.9)}',
    '.sr-tl{padding:.55rem 16px .2rem;user-select:none}',
    '.sr-track{position:relative;height:50px;border-radius:8px;background:var(--surface2,#161b1c);overflow:hidden}',
    '.sr-track i{position:absolute;display:block}',
    '.sr-past{left:0;top:0;bottom:0;background:rgba(212,162,63,.10)}',
    '.sr-tick{top:0;bottom:0;width:1px;background:var(--border,rgba(132,160,168,.13))}',
    '.sr-tick.day{background:var(--border-2,rgba(132,160,168,.3))}',
    '.sr-hh{top:6px;height:12px;border-radius:3px}',
    '.sr-rp{top:22px;width:10px;height:10px;margin-left:-5px;border-radius:50%;background:#cfe9ff;border:2px solid #141410}',
    '.sr-lb{bottom:5px;width:3px;margin-left:-1px;background:#ffd25a;border-radius:1px}',
    '.sr-rw{bottom:0;height:3px;background:#4eb3d3}',
    '.sr-head-line{top:0;bottom:0;width:2px;margin-left:-1px;background:var(--gold,#d4a23f);box-shadow:0 0 0 1px rgba(0,0,0,.25)}',
    '.sr-range{position:absolute;inset:0;width:100%;height:100%;margin:0;opacity:0;cursor:pointer}',
    '.sr-track:focus-within{outline:2px solid var(--gold,#d4a23f);outline-offset:2px}',
    '.sr-hours{position:relative;height:16px;font-size:.68rem;color:var(--text-muted,#aab);margin-top:3px}',
    '.sr-hours span{position:absolute;transform:translateX(-50%);white-space:nowrap}',
    '.sr-ctl{display:flex;flex-wrap:wrap;align-items:center;gap:.4rem;padding:.35rem 16px .55rem}',
    '.sr-btn{appearance:none;display:inline-flex;align-items:center;justify-content:center;gap:.35rem;min-height:44px;min-width:44px;padding:0 .7rem;border-radius:10px;border:1px solid var(--border-2,rgba(132,160,168,.24));background:var(--surface,#101415);color:inherit;font:inherit;font-size:.9rem;cursor:pointer}',
    '.sr-btn svg{width:18px;height:18px;fill:currentColor}',
    '.sr-btn.play{background:var(--gold,#d4a23f);color:var(--bg,#141410);border-color:transparent;font-weight:700;min-width:92px}',
    '.sr-btn[aria-pressed="true"]{border-color:var(--gold,#d4a23f);box-shadow:inset 0 0 0 1px var(--gold,#d4a23f)}',
    '.sr-tlhead{display:flex;align-items:center;justify-content:space-between;gap:.5rem;margin-bottom:.4rem;font-size:.82rem;color:var(--text-muted,#aab)}',
    '.sr-seg{display:inline-flex}.sr-seg .sr-btn{border-radius:0;min-width:50px;min-height:36px;font-size:.8rem;padding:0 .55rem}.sr-seg .sr-btn:first-child{border-radius:8px 0 0 8px}.sr-seg .sr-btn:last-child{border-radius:0 8px 8px 0;margin-left:-1px}',
    '.sr-tlkey{display:flex;flex-wrap:wrap;gap:.2rem .8rem;font-size:.7rem;color:var(--text-muted,#aab);margin-top:.15rem}.sr-tlkey span{display:inline-flex;align-items:center;gap:.3rem}.sr-tlkey i{display:inline-block}',
    '.k-hh{width:12px;height:7px;border-radius:2px;background:#ee8d3a}.k-rp{width:8px;height:8px;border-radius:50%;background:#cfe9ff;border:1.5px solid #141410}.k-lb{width:3px;height:10px;background:#ffd25a}.k-rw{width:14px;height:3px;background:#4eb3d3}',
    '.sr-sec{padding:.5rem 16px;border-top:1px solid var(--border,rgba(132,160,168,.13))}',
    '.sr-sec h3{font-size:.74rem;text-transform:uppercase;letter-spacing:.07em;color:var(--text-muted,#aab);margin:0 0 .4rem;font-weight:700}',
    '.sr-chips{display:flex;flex-wrap:wrap;gap:.4rem}',
    '.sr-chip{min-height:40px;font-size:.84rem}.sr-chip i{width:12px;height:12px;border-radius:3px;display:inline-block}',
    '.sr-src{list-style:none;margin:0;padding:0;display:grid;gap:.3rem;font-size:.82rem;line-height:1.4}',
    '.sr-src li{display:grid;grid-template-columns:10px 1fr;gap:.5rem;align-items:baseline}',
    '.sr-src li::before{content:"";width:8px;height:8px;border-radius:50%;background:#7fcf9c;transform:translateY(-1px)}',
    '.sr-src li.warn::before{background:#e8b55a}.sr-src li.down::before{background:#e0685f}.sr-src li.off::before{background:var(--border-2,#556)}',
    '.sr-key{display:flex;flex-wrap:wrap;gap:.25rem .8rem;font-size:.76rem;color:var(--text-muted,#aab)}.sr-key span{display:inline-flex;align-items:center;gap:.3rem}.sr-key i{width:12px;height:10px;border-radius:2px;display:inline-block}',
    '.sr-dbz{width:90px!important;background:linear-gradient(90deg,#04e9e7,#019ff4,#02fd02,#01c501,#fdf802,#fd9500,#fd0000,#bc0000,#f800fd)}',
    '.sr-cred{font-size:.74rem;line-height:1.5;color:var(--text-muted,#aab);margin:0}.sr-cred a{color:inherit;text-decoration:underline}',
    '.sr-note{font-size:.8rem;color:var(--text-muted,#aab);margin:.3rem 0 0;min-height:1em}',
    '.sr-field{background:#fff;border:3px solid #141410;border-radius:50%;box-shadow:0 0 0 2px #fff,0 1px 6px rgba(0,0,0,.45)}.sr-field i{position:absolute;left:50%;top:50%;width:6px;height:6px;margin:-3px 0 0 -3px;border-radius:50%;background:#141410}',
    '.leaflet-tooltip.sr-fieldtip{background:rgba(10,12,13,.84);color:#f3f5f4;border:0;box-shadow:none;font-weight:700;font-size:.74rem;padding:.1rem .4rem}.leaflet-tooltip.sr-fieldtip::before{display:none}',
    '.sr-tip{font-size:.8rem}',
    'html.sr-open,html.sr-open body{overflow:hidden}'
  ].join('\n');
  function injectCSS() {
    if (document.getElementById('sr-css')) return;
    var s = document.createElement('style');
    s.id = 'sr-css'; s.textContent = CSS;
    document.head.appendChild(s);
  }

  var ICON = {
    back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h2v14H6zM20 5v14L9 12z"/></svg>',
    fwd: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 5h2v14h-2zM4 5l11 7-11 7z"/></svg>',
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4l13 8-13 8z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>',
    end: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5l8 7-8 7zM12 5l8 7-8 7z"/></svg>',
    share: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 16a3 3 0 00-2.4 1.2l-6.7-3.4a3 3 0 000-1.6l6.7-3.4A3 3 0 1015 7l-6.7 3.4a3 3 0 100 3.2L15 17a3 3 0 103-1z"/></svg>'
  };
  var LAYER_NAME = { radar: 'Radar', lightning: 'Lightning', swaths: 'Hail estimate', reports: 'Hail reports', clouds: 'Clouds' };
  var LAYER_SWATCH = { radar: '#02c502', lightning: '#ffd25a', swaths: '#ee8d3a', reports: '#cfe9ff', clouds: '#9aa6ad' };

  /* ---------- build ---------- */
  function build() {
    var wrap = document.createElement('div');
    wrap.className = 'sr';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-labelledby', 'sr-h');
    var chips = C.LAYERS.map(function (k) {
      return '<button type="button" class="sr-btn sr-chip" data-layer="' + k + '" aria-pressed="false"><i style="background:' + LAYER_SWATCH[k] + '"></i>' + LAYER_NAME[k] + '</button>';
    }).join('');
    var cred = ['radar', 'lightning', 'clouds', 'swaths', 'reports', 'rain', 'map'].map(function (k) {
      var c = C.CREDITS[k];
      return '<span data-credit="' + k + '">' + esc(c.name) + ': <a href="' + esc(c.url) + '"' + (/^https?:/.test(c.url) ? ' rel="noopener" target="_blank"' : '') + '>' + esc(c.what) + '</a>.</span>';
    }).join(' ');
    wrap.innerHTML =
      '<div class="sr-panel">' +
        '<header class="sr-top"><h2 id="sr-h">Storm replay</h2><span class="sr-place" id="sr-place"></span>' +
        '<button type="button" class="sr-x" id="sr-x" aria-label="Close the storm replay">×</button></header>' +
        '<div class="sr-left">' +
          '<div class="sr-mapwrap"><div class="sr-map" id="sr-map" aria-label="Map of the storm around your field"></div>' +
            '<div class="sr-clock" id="sr-clock" aria-hidden="true"></div><div class="sr-flag" id="sr-flag"></div></div>' +
          '<div class="sr-tl"><div class="sr-tlhead"><span id="sr-span"></span>' +
            '<span class="sr-seg" role="group" aria-label="How far back"><button type="button" class="sr-btn" data-h="24" aria-pressed="true">24 h</button><button type="button" class="sr-btn" data-h="48" aria-pressed="false">48 h</button></span></div>' +
            '<div class="sr-track" id="sr-track"><i class="sr-past" id="sr-past"></i><div id="sr-marks"></div><i class="sr-head-line" id="sr-headline"></i>' +
            '<input type="range" class="sr-range" id="sr-range" min="0" max="0" value="0" aria-label="Time in the replay"></div>' +
            '<div class="sr-hours" id="sr-hours" aria-hidden="true"></div>' +
            '<div class="sr-tlkey" aria-hidden="true"><span><i class="k-hh"></i>radar hail</span><span><i class="k-rp"></i>hail report</span><span><i class="k-lb"></i>lightning</span><span><i class="k-rw"></i>rain total</span></div></div>' +
          '<div class="sr-ctl">' +
            '<button type="button" class="sr-btn" id="sr-back" aria-label="Step back">' + ICON.back + '</button>' +
            '<button type="button" class="sr-btn play" id="sr-play">' + ICON.play + '<span>Play</span></button>' +
            '<button type="button" class="sr-btn" id="sr-fwd" aria-label="Step forward">' + ICON.fwd + '</button>' +
            '<button type="button" class="sr-btn" id="sr-latest">' + ICON.end + '<span>Latest</span></button>' +
          '</div>' +
        '</div>' +
        '<div class="sr-right">' +
          '<div class="sr-cap" aria-live="polite"><p class="sr-head" id="sr-headtext">Reading the storm sources…</p><ul class="sr-lines" id="sr-lines"></ul></div>' +
          '<div class="sr-sec"><h3>Layers</h3><div class="sr-chips" id="sr-chips">' + chips + '</div>' +
            '<div class="sr-key" style="margin-top:.5rem"><span><i class="sr-dbz"></i>radar, light to heavy</span>' +
            '<span><i style="background:' + HAIL_COL[0.75] + '"></i>0.75</span><span><i style="background:' + HAIL_COL[1] + '"></i>1</span><span><i style="background:' + HAIL_COL[1.5] + '"></i>1.5</span><span><i style="background:' + HAIL_COL[2] + '"></i>2+ in hail (estimate)</span>' +
            '<span><i style="background:#cfe9ff;border:2px solid #141410;border-radius:50%;width:10px"></i>hail report (observed)</span></div></div>' +
          '<div class="sr-sec"><button type="button" class="sr-btn" id="sr-share">' + ICON.share + '<span>Share this replay</span></button><p class="sr-note" id="sr-sharenote" role="status"></p></div>' +
          '<div class="sr-sec"><h3>Sources right now</h3><ul class="sr-src" id="sr-src"></ul></div>' +
          '<div class="sr-sec"><p class="sr-cred" id="sr-cred">' + cred + ' Radar sizes and totals are estimates; a hail report is what someone saw. No key, no signup.</p></div>' +
        '</div>' +
      '</div>';
    return wrap;
  }

  /* ---------- open / close ---------- */
  function open(opts) {
    opts = opts || {};
    if (R) close(true);
    if (!L) return;
    injectCSS();
    var now = Date.now();
    var v = opts.view || C.decodeShare(location.search, now);
    if (!v) {
      if (!(isFinite(opts.lat) && isFinite(opts.lon))) return;
      var sp = C.windowSpec(24), end = C.latestEnd(now, sp.step);
      v = { lat: +opts.lat, lon: +opts.lon, label: opts.label || null, hours: 24, step: sp.step, end: end, frame: end, layers: Object.assign({}, C.DEFAULT_LAYERS), live: true, fresh: true };
    }
    R = {
      opts: opts, v: v, tz: tz(), times: [], idx: 0, playing: false, timer: null, urlT: null,
      frames: { radar: {}, lightning: {}, clouds: {} }, rst: [], caps: {}, data: {}, warmQ: [], warmN: 0, warmGen: 0,
      prevUrl: location.pathname + location.search + location.hash, prevFocus: document.activeElement
    };
    var el = build();
    document.body.appendChild(el);
    document.documentElement.classList.add('sr-open');
    R.el = el;
    $('#sr-place', el).textContent = v.label || (v.lat.toFixed(3) + ', ' + v.lon.toFixed(3));
    wire(el);
    makeMap();
    setWindow(v.hours, v.frame, true);
    loadAll();
    var hd = $('#sr-h', el); hd.setAttribute('tabindex', '-1');
    try { hd.focus({ preventScroll: true }); } catch (e) {}
  }
  function close(silent) {
    if (!R) return;
    pause();
    R.closed = true;
    try { R.map.remove(); } catch (e) {}
    if (R.el && R.el.parentNode) R.el.parentNode.removeChild(R.el);
    document.documentElement.classList.remove('sr-open');
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('visibilitychange', onVis);
    if (!silent) {
      var back = /[?&]sr=1/.test(R.prevUrl) ? location.pathname : R.prevUrl;
      try { history.replaceState(null, '', back); } catch (e) {}
      try { if (R.prevFocus && R.prevFocus.focus) R.prevFocus.focus({ preventScroll: true }); } catch (e) {}
    }
    R = null;
  }
  function onKey(e) {
    if (!R) return;
    if (e.key === 'Escape') { close(); return; }
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName) && e.target.id !== 'sr-range') return;
    if (e.key === ' ' && e.target.id !== 'sr-range' && !/BUTTON/.test(e.target.tagName)) { e.preventDefault(); toggle(); }
    if (e.key === 'Tab') { // keep focus inside the replay
      var f = R.el.querySelectorAll('button,input,a[href]'), first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }
  function onVis() { if (document.hidden) pause(); }

  function wire(el) {
    $('#sr-x', el).addEventListener('click', function () { close(); });
    el.addEventListener('click', function (e) { if (e.target === el) close(); });
    document.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', onVis);
    $('#sr-play', el).addEventListener('click', toggle);
    $('#sr-back', el).addEventListener('click', function () { pause(); go(R.idx - 1); });
    $('#sr-fwd', el).addEventListener('click', function () { pause(); go(R.idx + 1); });
    $('#sr-latest', el).addEventListener('click', function () {
      pause();
      var sp = C.windowSpec(R.v.hours), end = C.latestEnd(Date.now(), sp.step);
      if (end !== R.v.end) { R.v.live = true; setWindow(R.v.hours, end, false, end); reloadWindowData(); } else go(R.times.length - 1);
    });
    var rng = $('#sr-range', el);
    rng.addEventListener('input', function () { pause(); go(+rng.value); });
    Array.prototype.forEach.call(el.querySelectorAll('[data-h]'), function (b) {
      b.addEventListener('click', function () {
        var h = +b.getAttribute('data-h');
        if (h === R.v.hours) return;
        pause();
        var t = R.times[R.idx];
        setWindow(h, t, false, R.v.end);
        reloadWindowData();
      });
    });
    Array.prototype.forEach.call(el.querySelectorAll('[data-layer]'), function (b) {
      b.addEventListener('click', function () {
        var k = b.getAttribute('data-layer');
        R.v.layers[k] = !R.v.layers[k];
        paintChips();
        if (k === 'clouds' && R.v.layers.clouds && !R.caps.clouds) loadCaps('clouds');
        if (!R.v.layers[k]) dropLayer(k);
        show(R.idx);
        renderSources();
        saveUrl();
      });
    });
    $('#sr-share', el).addEventListener('click', share);
    paintChips();
  }
  function paintChips() {
    Array.prototype.forEach.call(R.el.querySelectorAll('[data-layer]'), function (b) {
      b.setAttribute('aria-pressed', String(!!R.v.layers[b.getAttribute('data-layer')]));
    });
  }

  /* ---------- map ---------- */
  function makeMap() {
    var v = R.v;
    /* no tile fade: frames swap by their own short crossfade, and a fade per tile
       would flicker every frame during play */
    var m = R.map = L.map($('#sr-map', R.el), { zoomControl: false, attributionControl: true, fadeAnimation: false, zoomSnap: 1, maxZoom: 11, minZoom: 5, worldCopyJump: false });
    L.control.zoom({ position: 'topright' }).addTo(m);
    m.attributionControl.setPrefix(false);
    m.attributionControl.addAttribution('Radar: NOAA via IEM | Map: USGS');
    m.setView([v.lat, v.lon], 9);
    R.base = L.tileLayer(BASE_URL, { maxNativeZoom: 16, maxZoom: 16, className: 'sr-base' }).addTo(m);
    var baseLoaded = 0;
    R.base.on('tileload', function () { baseLoaded++; R.baseOk = true; });
    R.base.on('tileerror', function () { setTimeout(function () { if (R && !baseLoaded) { R.baseDown = true; renderSources(); } }, 6000); });
    m.createPane('sr-hail'); m.getPane('sr-hail').style.zIndex = 420;
    m.createPane('sr-pts'); m.getPane('sr-pts').style.zIndex = 640;
    R.ring = L.circle([v.lat, v.lon], { radius: C.REPORT_MI * 1609.34, color: '#ffd23f', weight: 1.2, opacity: 0.8, fill: false, dashArray: '4 5', interactive: false, pane: 'sr-pts' }).addTo(m);
    R.field = L.marker([v.lat, v.lon], { icon: L.divIcon({ className: 'sr-field', iconSize: [18, 18], html: '<i></i>' }), keyboard: false, interactive: false, pane: 'sr-pts', zIndexOffset: 1000 }).addTo(m);
    R.field.bindTooltip('Your field', { permanent: true, direction: 'right', offset: [10, 0], className: 'sr-fieldtip' });
    R.hailG = L.layerGroup().addTo(m);
    R.repG = L.layerGroup().addTo(m);
    m.on('moveend', function () { warmStart(); });
  }
  function dropLayer(k) {
    if (R.frames[k]) { Object.keys(R.frames[k]).forEach(function (key) { R.map.removeLayer(R.frames[k][key].layer); }); R.frames[k] = {}; }
    if (k === 'swaths') R.hailG.clearLayers(), (R.hailLayers = null);
    if (k === 'reports') R.repG.clearLayers(), (R.repMarks = null);
  }

  /* ---------- the window and its frames ---------- */
  function setWindow(hours, frameT, first, endT) {
    var sp = C.windowSpec(hours), now = Date.now();
    var e0 = endT != null ? Math.min(C.snapDown(endT, sp.step), C.latestEnd(now, sp.step)) : R.v.end;
    e0 = C.snapDown(e0, sp.step);
    R.v.hours = sp.hours; R.v.step = sp.step; R.v.end = e0;
    R.times = C.frameTimes(e0, sp.hours, sp.step);
    R.rst = R.times.map(function (t) { return { t: t, st: 'wait' }; });
    ['radar', 'lightning', 'clouds'].forEach(function (k) { dropLayer(k); });
    R.hailLayers = null; R.repMarks = null; R.hailG.clearLayers(); R.repG.clearLayers();
    var rng = $('#sr-range', R.el);
    rng.max = String(R.times.length - 1);
    Array.prototype.forEach.call(R.el.querySelectorAll('[data-h]'), function (b) { b.setAttribute('aria-pressed', String(+b.getAttribute('data-h') === sp.hours)); });
    $('#sr-span', R.el).textContent = C.span(start(), end(), R.tz) + ' ' + C.tzName(end(), R.tz);
    drawHours();
    drawMarks();
    go(C.nearestIndex(R.times, frameT == null ? e0 : frameT), true);
    if (!first) saveUrl();
  }
  function start() { return R.times[0]; }
  function end() { return R.times[R.times.length - 1]; }

  function go(i, force) {
    if (!R) return;
    i = Math.max(0, Math.min(R.times.length - 1, i));
    if (i === R.idx && !force) return;
    R.idx = i;
    show(i);
    if (!R.playing) saveUrl();
  }

  function show(i) {
    var t = R.times[i], v = R.v, rng = $('#sr-range', R.el);
    rng.value = String(i);
    var lab = C.frameLabel(t, R.tz) + ' ' + C.tzName(t, R.tz);
    rng.setAttribute('aria-valuetext', lab);
    $('#sr-clock', R.el).innerHTML = '<b>' + esc(C.clock(t, R.tz)) + '</b><small>' + esc(C.frameLabel(t, R.tz).split(',').slice(0, 2).join(',') + ' ' + C.tzName(t, R.tz)) + '</small>';
    var pct = R.times.length > 1 ? i / (R.times.length - 1) * 100 : 100;
    $('#sr-past', R.el).style.width = pct + '%';
    $('#sr-headline', R.el).style.left = pct + '%';
    $('#sr-play', R.el).disabled = false;
    var flags = [];
    // radar
    if (v.layers.radar) { showTiles('radar', String(i), function () { return radarLayer(i); }); if (R.rst[i].st === 'bad') flags.push('No radar frame for this time'); }
    // nowCOAST layers
    ['lightning', 'clouds'].forEach(function (k) {
      if (!v.layers[k]) return;
      var cp = R.caps[k];
      if (!cp || !cp.times) { showTiles(k, null); return; }
      var w = C.WMS[k], mt = C.matchTime(cp.times, t, w.before, w.after);
      if (mt == null) { showTiles(k, null); flags.push((k === 'lightning' ? 'No NOAA lightning map' : 'No satellite image') + ' for this time'); return; }
      showTiles(k, String(mt), function () { return wmsLayer(k, mt); });
    });
    // hail estimate, this hour bright, earlier hours faint
    var hn = paintHail(t);
    if (hn) flags.unshift('<span class="hail">' + esc(hn) + '</span>');
    paintReports(t);
    $('#sr-flag', R.el).innerHTML = flags.map(function (f) { return /^<span/.test(f) ? f : '<span>' + esc(f) + '</span>'; }).join('');
    preload(i);
  }

  /* one of the frame layers on, the rest hidden; keeps a few around, drops the rest */
  function showTiles(k, key, make) {
    var store = R.frames[k];
    if (key != null && !store[key] && make) {
      var lyr = make();
      store[key] = { layer: lyr, at: Date.now() };
      lyr.addTo(R.map);
    }
    Object.keys(store).forEach(function (kk) {
      setOp(store[kk].layer, kk === key ? OPAC[k] : 0);
      if (kk === key) store[kk].at = Date.now();
    });
    trim(k, key);
  }
  /* the frame's whole layer at once (Leaflet's setOpacity also restarts a fade on
     every tile, which reads as flicker when frames change four times a second) */
  function setOp(layer, v) {
    layer.options.opacity = v;
    if (layer._container) layer._container.style.opacity = v;
  }
  function trim(k, keep) {
    var store = R.frames[k], keys = Object.keys(store);
    var max = k === 'radar' ? KEEP_BEHIND + AHEAD_PLAY + 2 : 6;
    if (keys.length <= max) return;
    if (k === 'radar') {
      keys.forEach(function (kk) {
        var d = +kk - R.idx;
        if (kk !== keep && (d < -KEEP_BEHIND || d > AHEAD_PLAY)) { R.map.removeLayer(store[kk].layer); delete store[kk]; }
      });
    } else {
      keys.sort(function (a, b) { return store[a].at - store[b].at; });
      while (keys.length > max) { var kk = keys.shift(); if (kk === keep) continue; R.map.removeLayer(store[kk].layer); delete store[kk]; }
    }
  }
  function radarLayer(i) {
    var lyr = L.tileLayer(C.radarTileUrl(R.times[i]), { opacity: 0, className: 'sr-fr', maxNativeZoom: 10, maxZoom: 11, keepBuffer: 0, updateWhenZooming: false });
    var ok = 0, bad = 0, gen = R.times[i];
    lyr.on('tileload', function () { ok++; });
    lyr.on('tileerror', function () { bad++; });
    lyr.on('load', function () {
      if (!R || R.times[i] !== gen) return;
      R.rst[i].st = ok ? 'ok' : (bad ? 'bad' : 'ok');
      if (i === R.idx) { var fl = $('#sr-flag', R.el); if (R.rst[i].st === 'bad' && fl && !/No radar frame/.test(fl.textContent)) show(i); }
      renderSourcesSoon();
    });
    return lyr;
  }
  function wmsLayer(k, t) {
    var w = C.WMS[k];
    var lyr = L.tileLayer.wms(C.wmsUrl(k), { layers: w.layer, styles: '', format: 'image/png', transparent: true, version: '1.3.0', time: new Date(t).toISOString(), opacity: 0, className: 'sr-fr', keepBuffer: 0, updateWhenZooming: false });
    var ok = 0, bad = 0;
    lyr.on('tileload', function () { ok++; });
    lyr.on('tileerror', function () { bad++; });
    lyr.on('load', function () {
      if (!R) return;
      var cp = R.caps[k];
      if (cp && !ok && bad) { cp.tileFail = (cp.tileFail || 0) + 1; renderSourcesSoon(); }
      else if (cp && ok) { cp.tileOk = true; }
    });
    return lyr;
  }
  /* next frames load while this one shows; when playing, further ahead */
  function preload(i) {
    var ahead = R.playing ? AHEAD_PLAY : AHEAD_IDLE;
    if (saveData()) ahead = Math.min(ahead, 2);
    for (var j = i + 1; j <= i + ahead && j < R.times.length; j++) {
      if (R.v.layers.radar && !R.frames.radar[String(j)]) {
        var jj = j, lyr = radarLayer(jj);
        R.frames.radar[String(jj)] = { layer: lyr, at: 0 };
        lyr.addTo(R.map);
      }
      if (R.v.layers.lightning && R.caps.lightning && R.caps.lightning.times) {
        var mt = C.matchTime(R.caps.lightning.times, R.times[j], C.WMS.lightning.before, C.WMS.lightning.after);
        if (mt != null && !R.frames.lightning[String(mt)]) { var l2 = wmsLayer('lightning', mt); R.frames.lightning[String(mt)] = { layer: l2, at: Date.now() - 1 }; l2.addTo(R.map); }
      }
    }
    trim('radar', String(i));
    if (!R.warmStarted) { R.warmStarted = true; setTimeout(warmStart, 1500); }
  }

  /* Warm the browser cache with every radar frame for the tiles on screen, nearest
     frames first, three at a time, so play and scrub do not wait on the network.
     Off with Data Saver. */
  function warmStart() {
    if (!R || saveData() || !R.v.layers.radar) return;
    var gen = ++R.warmGen, m = R.map, z = Math.round(m.getZoom());
    z = Math.min(z, 10);
    var b = m.getPixelBounds(), s = 256 * Math.pow(2, z) / (256 * Math.pow(2, m.getZoom()));
    var x0 = Math.floor(b.min.x * s / 256), x1 = Math.floor(b.max.x * s / 256), y0 = Math.floor(b.min.y * s / 256), y1 = Math.floor(b.max.y * s / 256);
    var tiles = [];
    for (var x = x0; x <= x1; x++) for (var y = y0; y <= y1; y++) tiles.push([x, y]);
    var order = R.times.map(function (t, i) { return i; }).sort(function (a, b) {
      var da = a - R.idx, db = b - R.idx;
      return (da < 0 ? 1000 - da : da) - (db < 0 ? 1000 - db : db);
    });
    R.warmQ = [];
    order.forEach(function (i) {
      var tpl = C.radarTileUrl(R.times[i]);
      tiles.forEach(function (c) { R.warmQ.push(tpl.replace('{z}', z).replace('{x}', c[0]).replace('{y}', c[1])); });
    });
    for (var k = 0; k < WARM_CONC; k++) warmNext(gen);
  }
  function warmNext(gen) {
    if (!R || gen !== R.warmGen || !R.warmQ.length || document.hidden) return;
    // while playing, the frames just ahead come first; warming waits for a pause
    if (R.playing) { R.warmT = setTimeout(function () { warmNext(gen); }, 1000); return; }
    var u = R.warmQ.shift(), img = new Image();
    img.decoding = 'async';
    img.onload = img.onerror = function () { setTimeout(function () { warmNext(gen); }, 30); };
    img.src = u;
  }

  /* ---------- play ---------- */
  function toggle() { if (R.playing) pause(); else play(); }
  function play() {
    if (!R) return;
    if (R.idx >= R.times.length - 1) go(0);
    R.playing = true;
    var b = $('#sr-play', R.el);
    b.innerHTML = ICON.pause + '<span>Pause</span>';
    b.setAttribute('aria-pressed', 'true');
    preload(R.idx);
    tick();
  }
  function pause() {
    if (!R) return;
    var was = R.playing;
    R.playing = false;
    clearTimeout(R.timer);
    var b = $('#sr-play', R.el);
    if (b) { b.innerHTML = ICON.play + '<span>Play</span>'; b.setAttribute('aria-pressed', 'false'); }
    if (was) saveUrl();
  }
  function tick() {
    if (!R || !R.playing) return;
    if (R.idx >= R.times.length - 1) { R.timer = setTimeout(pause, LAST_HOLD_MS); return; }
    var next = R.idx + 1, waited = 0;
    (function wait() {
      if (!R || !R.playing) return;
      var ready = !R.v.layers.radar || R.rst[next].st !== 'wait';
      if (ready || waited >= WAIT_MS) { go(next); R.timer = setTimeout(tick, busy(R.times[next]) ? STORM_FRAME_MS : FRAME_MS); return; }
      if (!R.frames.radar[String(next)]) preload(R.idx);
      waited += 100;
      R.timer = setTimeout(wait, 100);
    })();
  }

  /* Quiet hours go by fast; the hour before, during and after anything at the
     field (radar hail near it, a report, lightning in its square) plays slowly. */
  function busy(t) {
    var w = R.busyW;
    if (!w) {
      var ev = [];
      ((R.data.hours && R.data.hours.hours) || []).forEach(function (h) { ev.push(h.start, h.end); });
      ((R.data.reports && R.data.reports.list) || []).forEach(function (r) { ev.push(r.t); });
      ((R.data.lightning && R.data.lightning.readings) || []).forEach(function (r) { if (r.v > 0) ev.push(r.t); });
      w = R.busyW = ev.length ? [Math.min.apply(null, ev) - HOUR, Math.max.apply(null, ev) + 30 * MIN] : [0, 0];
      if (R.data.lightning && R.data.lightning.state === 'loading') R.busyW = null;   // ask again once the count is in
    }
    return t >= w[0] && t <= w[1];
  }

  /* ---------- hail estimate and reports on the map ---------- */
  function hailStyle(th, now) {
    var c = HAIL_COL[th] || HAIL_COL[2];
    return now ? { color: c, weight: 1.4, opacity: 0.95, fillColor: c, fillOpacity: 0.4 } : { color: c, weight: 0.8, opacity: 0.55, fillColor: c, fillOpacity: 0.16 };
  }
  function paintHail(t) {
    var d = R.data.hours;
    if (!R.v.layers.swaths) { R.hailG.clearLayers(); R.hailLayers = null; return ''; }
    if (!d || !d.doc) {
      if (R.data.dailyFc && !R.dailyLayer) {
        R.dailyLayer = L.geoJSON(R.data.dailyFc, { pane: 'sr-hail', interactive: false, style: function (f) { return hailStyle(+f.properties.thresh_in, false); } });
        R.hailG.addLayer(R.dailyLayer);
      }
      return '';
    }
    if (!R.hailLayers) {
      R.hailLayers = [];
      (d.doc.hours || []).forEach(function (h) {
        var e = Date.parse(h.end);
        if (!(e > start() && e - HOUR < end()) || !(h.features && h.features.length)) return;
        var g = L.geoJSON({ type: 'FeatureCollection', features: h.features }, { pane: 'sr-hail', interactive: false, style: function (f) { return hailStyle(+f.properties.thresh_in, false); } });
        R.hailLayers.push({ end: e, layer: g, on: false, now: null });
      });
    }
    var note = '';
    R.hailLayers.forEach(function (h) {
      var vis = h.end - HOUR < t, isNow = vis && t <= h.end;
      if (vis !== h.on) { if (vis) R.hailG.addLayer(h.layer); else R.hailG.removeLayer(h.layer); h.on = vis; }
      if (vis && isNow !== h.now) { h.layer.setStyle(function (f) { return hailStyle(+f.properties.thresh_in, isNow); }); h.now = isNow; }
    });
    var cur = (d.hours || []).filter(function (h) { return h.start < t && t <= h.end; })[0];
    if (cur) note = 'Radar hail estimate this hour: up to ' + C.hailIn(cur.maxIn) + (cur.onField ? ' at your field' : ' near your field');
    return note;
  }
  function paintReports(t) {
    var list = R.data.reports && R.data.reports.all;
    if (!R.v.layers.reports || !list) { R.repG.clearLayers(); R.repMarks = null; return; }
    if (!R.repMarks) {
      R.repMarks = list.map(function (r) {
        var mk = L.circleMarker([r.lat, r.lon], { pane: 'sr-pts', radius: Math.min(9, 4 + (r.mag || 0.75) * 2), color: '#141410', weight: 1.5, fillColor: REP_COL, fillOpacity: 0.95 });
        mk.bindTooltip(esc((r.mag ? C.hailIn(r.mag) + ' hail' : 'Hail') + ' reported ' + C.when(r.t, R.tz, end()) + (r.city ? ', ' + r.city : '') + ' (observed)'), { className: 'sr-tip' });
        return { r: r, mk: mk, on: false };
      });
    }
    var step = R.v.step * MIN;
    R.repMarks.forEach(function (m) {
      var vis = m.r.t <= t;
      if (vis !== m.on) { if (vis) R.repG.addLayer(m.mk); else R.repG.removeLayer(m.mk); m.on = vis; }
      if (vis) m.mk.setStyle(t - m.r.t < step ? { fillColor: REP_NEW, weight: 3, color: '#fff' } : { fillColor: REP_COL, weight: 1.5, color: '#141410' });
    });
  }

  /* ---------- timeline marks ---------- */
  function pctOf(t) { return Math.max(0, Math.min(100, (t - start()) / (end() - start()) * 100)); }
  function drawHours() {
    var out = [], h0 = Math.ceil(start() / HOUR) * HOUR, every = R.v.hours === 48 ? 12 : 6, marks = '';
    for (var t = h0; t <= end(); t += HOUR) {
      var hr = +new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: R.tz }).format(new Date(t)) % 24;
      var day = hr === 0;
      if (hr % 3 === 0) marks += '<i class="sr-tick' + (day ? ' day' : '') + '" style="left:' + pctOf(t) + '%"></i>';
      if (hr % every === 0) {
        var p = pctOf(t);
        if (p > 4 && p < 96) out.push('<span style="left:' + p + '%">' + esc(day ? C.weekday(t, R.tz) : C.clock(t, R.tz)) + '</span>');
      }
    }
    R.tickHtml = marks;
    $('#sr-hours', R.el).innerHTML = out.join('');
  }
  function drawMarks() {
    var h = R.tickHtml || '';
    var hh = (R.data.hours && R.data.hours.hours) || [];
    hh.forEach(function (x) {
      var l = pctOf(x.start), r = pctOf(x.end);
      h += '<i class="sr-hh" style="left:' + l + '%;width:' + Math.max(0.8, r - l) + '%;background:' + (HAIL_COL[x.maxIn] || HAIL_COL[2]) + '" title="Radar hail estimate"></i>';
    });
    var lr = R.data.lightning && R.data.lightning.readings;
    if (lr && lr.length) {
      var mx = 0;
      lr.forEach(function (x) { if (x.v > mx) mx = x.v; });
      if (mx > 0) lr.forEach(function (x) { if (x.v > 0) h += '<i class="sr-lb" style="left:' + pctOf(x.t) + '%;height:' + Math.max(3, Math.round(x.v / mx * 18)) + 'px"></i>'; });
    }
    var rn = R.data.rain;
    if (rn && rn.ok) { var a = pctOf(rn.start), b = pctOf(rn.end); if (b > a) h += '<i class="sr-rw" style="left:' + a + '%;width:' + (b - a) + '%" title="Window of the rain total"></i>'; }
    ((R.data.reports && R.data.reports.list) || []).forEach(function (x) { h += '<i class="sr-rp" style="left:' + pctOf(x.t) + '%" title="Hail report"></i>'; });
    $('#sr-marks', R.el).innerHTML = h;
  }

  /* ---------- data ---------- */
  function loadAll() {
    R.loads = [loadHours(), loadReports(), loadRain(), loadCaps('lightning')];
    if (R.v.layers.clouds) loadCaps('clouds');
    renderSources();
    recaption();
    var settle = Promise.all(R.loads.map(function (p) { return p.catch(function () {}); }));
    timed(settle, 6000).catch(function () {}).then(function () { if (R) startStory(); });
  }
  function reloadWindowData() {
    R.data = {}; R.dailyLayer = null;
    var ls = [loadHours(), loadReports(), loadRain()];
    if (R.caps.lightning && R.caps.lightning.times) countLightning();
    renderSources(); recaption();
    Promise.all(ls.map(function (p) { return p.catch(function () {}); })).then(function () { if (R) { drawMarks(); show(R.idx); } });
  }
  /* where the replay starts: a shared frame stays put; a fresh open goes an hour
     before the first hail and plays once, or plays the whole window */
  function startStory() {
    if (!R.v.fresh) return;
    var hh = (R.data.hours && R.data.hours.hours) || [], rp = (R.data.reports && R.data.reports.list) || [];
    var first = hh.length ? hh[0].start : rp.length ? rp[0].t : null;
    if (reduced()) {
      var peak = hh.length ? hh[0].end : rp.length ? rp[0].t : end();
      go(C.nearestIndex(R.times, peak));
      return;
    }
    go(first != null ? C.nearestIndex(R.times, first - HOUR) : 0);
    play();
  }

  function loadHours() {
    var s = start(), e = end(), now = Date.now(), lat = R.v.lat, lon = R.v.lon;
    R.data.hours = { state: 'loading' };
    return getJSON('/data/hail/mesh/hours.json', 12000).then(function (doc) {
      var hs = (doc && doc.hours) || [];
      var first = hs.length ? Date.parse(hs[0].end) - HOUR : null, asOf = doc && doc.meta && Date.parse(doc.meta.as_of);
      if (first == null || e <= first) throw Object.assign(new Error('old'), { old: true, doc: doc });
      var out = { state: 'ok', doc: doc, hours: C.hailHours(doc, lat, lon, s, e), coverage: C.hoursCoverage(doc, s, e), asOf: asOf };
      if (asOf && e - asOf > C.HOURS_STALE_H * HOUR && now - asOf > C.HOURS_STALE_H * HOUR) { out.state = 'stale'; out.since = asOf; }
      return out;
    }).catch(function (err) {
      // no hourly file, or the window is older than it keeps: the day's swath, without the clock
      return getJSON('/data/hail/mesh/index.json', 9000).then(function (ix) {
        var days = {}, d = s;
        for (; d <= e; d += 24 * HOUR) days[new Date(d).toISOString().slice(0, 10)] = 1;
        days[new Date(e).toISOString().slice(0, 10)] = 1;
        var want = Object.keys(days).filter(function (k) { return (ix.dates || []).indexOf(k) >= 0; });
        var near = now - e < 26 * HOUR;
        return Promise.all(want.map(function (k) { return getJSON('/data/hail/mesh/' + k + '.json', 9000).catch(function () { return null; }); })
          .concat(near ? [getJSON('/data/hail/mesh/today-partial.json', 9000).catch(function () { return null; })] : []))
          .then(function (fcs) {
            var feats = [];
            fcs.forEach(function (fc) { if (fc && fc.features) feats = feats.concat(fc.features); });
            var fc = { type: 'FeatureCollection', features: feats };
            R.data.dailyFc = fc;
            return { state: err && err.old ? 'old' : 'nohours', daily: C.dailyHail(fc, lat, lon), hours: [] };
          });
      }).catch(function () { return { state: 'down', hours: [] }; });
    }).then(function (res) {
      if (!R) return;
      R.data.hours = res; R.busyW = null; R.hailLayers = null; R.dailyLayer = null; R.hailG.clearLayers();
      drawMarks(); show(R.idx); recaption(); renderSources();
    });
  }
  function loadReports() {
    var s = start(), e = end(), lat = R.v.lat, lon = R.v.lon;
    R.data.reports = { state: 'loading' };
    return getJSON(C.lsrUrl(s - 5 * MIN, e + 5 * MIN, lat, lon), 15000).then(function (fc) {
      if (!fc || !fc.features) throw new Error('bad');
      return { state: 'ok', list: C.lsrHail(fc, lat, lon, s, e), all: C.lsrHail(fc, lat, lon, s, e, 120) };
    }).catch(function () { return { state: 'down' }; }).then(function (res) {
      if (!R) return;
      R.data.reports = res; R.busyW = null; R.repMarks = null; R.repG.clearLayers();
      drawMarks(); show(R.idx); recaption(); renderSources();
    });
  }
  function loadRain() {
    var lat = R.v.lat, lon = R.v.lon, RR = window.AgRadarRain;
    R.data.rain = { state: 'loading' };
    var got = R.opts.rain && R.opts.rain.header ? Promise.resolve(R.opts.rain)
      : !RR ? Promise.reject(new Error('no reader'))
      : getJSON('/data/radar-rain/index.json', 9000).then(function (idx) {
          var st = RR.pickState(idx, lat, lon);
          if (!st) throw Object.assign(new Error('outside'), { outside: true });
          return timed(fetch('/data/radar-rain/' + st.toLowerCase() + '.bin').then(function (r) { if (!r.ok) throw new Error('HTTP'); return r.arrayBuffer(); }), 25000).then(RR.parse);
        });
    return got.then(function (f) {
      var w = (f.header.windows || []).filter(function (x) { return x.id === '24h'; })[0];
      if (!w || !f.grids['24h']) throw new Error('no window');
      var rs = Date.parse(w.start), re = Date.parse(w.end);
      if (!(re > start() && rs < end())) return { state: 'old', ok: false };
      var c = Math.round((lon - f.header.x0) / f.header.d), r = Math.round((f.header.y0 - lat) / f.header.d), h = f.header;
      var q = f.grids['24h'], v = r >= 0 && r < h.ny && c >= 0 && c < h.nx ? q[r * h.nx + c] : null;
      if (v == null || v < 0) return { state: 'gap', ok: false };
      return { state: 'ok', ok: true, v: v, start: rs, end: re };
    }).catch(function (e) { return { state: e && e.outside ? 'outside' : 'down', ok: false }; }).then(function (res) {
      if (!R) return;
      R.data.rain = res; drawMarks(); recaption(); renderSources();
    });
  }
  function loadCaps(k) {
    R.caps[k] = { state: 'loading' };
    renderSourcesSoon();
    return getText(C.capsUrl(k), 12000).then(function (xml) {
      var times = C.capsTimes(xml, C.WMS[k].layer);
      if (!times || !times.length) throw new Error('no times');
      var newest = times[times.length - 1], oldest = times[0], now = Date.now();
      var cp = { state: 'ok', times: times, newest: newest, oldest: oldest };
      if (now - newest > (k === 'lightning' ? 45 : 40) * MIN) { cp.state = 'stale'; cp.since = newest; }
      else if (oldest > start() + R.v.step * MIN) cp.state = 'short';
      return cp;
    }).catch(function () { return { state: 'down' }; }).then(function (cp) {
      if (!R) return;
      R.caps[k] = cp;
      show(R.idx); renderSources();
      if (k === 'lightning' && cp.times) countLightning();
      else if (k === 'lightning') recaption();
    });
  }
  /* strikes in the field's cell: one reading per NOAA lightning map in the window */
  function countLightning() {
    var cp = R.caps.lightning, s = start(), e = end(), lat = R.v.lat, lon = R.v.lon, gen = e + ':' + s;
    var ts = cp.times.filter(function (t) { return t > s && t <= e; });
    var readings = ts.map(function (t) { return { t: t, v: null }; });
    R.data.lightning = { state: 'loading', readings: readings, gen: gen };
    if (!ts.length) { R.data.lightning = { state: 'none', readings: [], gen: gen }; recaption(); return; }
    var cacheKey = 'sr-lt:' + lat.toFixed(2) + ',' + lon.toFixed(2);
    var cache = {};
    try { cache = JSON.parse(sessionStorage.getItem(cacheKey) || '{}') || {}; } catch (e2) { cache = {}; }
    var i = 0, active = 0, fails = 0, done = 0, got = 0, dead = false;
    function finish() {
      if (!R || !R.data.lightning || R.data.lightning.gen !== gen) return;
      R.data.lightning.state = dead ? 'unread' : 'ok';
      try { sessionStorage.setItem(cacheKey, JSON.stringify(cache)); } catch (e3) {}
      drawMarks(); recaption(); renderSources();
    }
    function next() {
      if (!R || !R.data.lightning || R.data.lightning.gen !== gen) return;
      if (dead) { if (!active) finish(); return; }
      if (i >= readings.length) { if (!active) finish(); return; }
      var rd = readings[i++];
      if (cache[rd.t] != null) { rd.v = cache[rd.t]; done++; next(); return; }
      active++;
      var u = C.featureInfoUrl('lightning', lat, lon, new Date(rd.t).toISOString());
      getJSON(u, 10000).catch(function () { return getJSON(u, 12000); }).then(function (j) {
        var v = C.featureInfoValue(j);
        if (v == null) throw new Error('not a value');
        rd.v = v; cache[rd.t] = v; got++;
      }).catch(function () {
        fails++;
        if (fails >= 3 && got === 0) dead = true; // the counts cannot be read here; the map can still show
      }).then(function () {
        active--; done++;
        if (done % 16 === 0) recaption();
        next();
      });
    }
    for (var k = 0; k < 4; k++) next();
  }

  /* ---------- caption and sources ---------- */
  function recaption() {
    if (!R) return;
    var d = R.data, hd = d.hours || {}, rp = d.reports || {}, rn = d.rain || {}, lt = d.lightning;
    var lres = lt && lt.state === 'ok' ? C.lightningStrikes(lt.readings) : null;
    var cap = C.caption({
      start: start(), end: end(), tz: R.tz,
      hail: { ok: /^(ok|stale|old|nohours)$/.test(hd.state || ''), hours: hd.hours, coverage: hd.coverage, daily: hd.daily },
      reports: { ok: rp.state === 'ok', list: rp.list },
      rain: { ok: rn.ok, v: rn.v, start: rn.start, end: rn.end },
      lightning: lres ? { ok: true, strikes: lres.strikes, read: lres.read, total: lres.total, peak: lres.peak } : { ok: false }
    });
    var loading = [hd, rp, rn].some(function (x) { return x.state === 'loading'; });
    $('#sr-headtext', R.el).textContent = loading && !/[0-9]/.test(cap.headline) ? 'Reading the storm sources…' : cap.headline;
    $('#sr-lines', R.el).innerHTML = cap.lines.map(function (l) {
      return '<li data-kind="' + l.kind + '"><span class="sr-tag ' + (l.tag === 'observed' ? 'obs' : 'est') + '">' + (l.tag === 'observed' ? 'Observed' : 'Estimate') + '</span><span>' + esc(l.text) + '</span></li>';
    }).join('') + (lt && lt.state === 'loading' && R.v.layers.lightning ? '<li data-kind="lightning-wait"><span class="sr-tag est">Estimate</span><span>Counting lightning near your field…</span></li>' : '');
  }
  function renderSourcesSoon() { if (!R || R.srcT) return; R.srcT = setTimeout(function () { if (R) { R.srcT = null; renderSources(); } }, 400); }
  function renderSources() {
    if (!R) return;
    var tz = R.tz, ref = end(), items = [], v = R.v;
    function add(cls, txt, id) { items.push('<li class="' + cls + '" data-src="' + id + '">' + esc(txt) + '</li>'); }
    function cls(st) { return st === 'ok' ? '' : st === 'off' ? 'off' : st === 'down' ? 'down' : 'warn'; }
    // radar
    if (!v.layers.radar) add('off', C.sourceLine({ id: 'radar', state: 'off' }, tz, ref), 'radar');
    else { var rs = C.radarState(R.rst); add(cls(rs.state === 'loading' ? 'ok' : rs.state), C.sourceLine(rs, tz, ref), 'radar'); }
    // nowCOAST
    ['lightning', 'clouds'].forEach(function (k) {
      var cp = R.caps[k];
      if (!v.layers[k] && !(k === 'lightning' && cp)) { add('off', C.sourceLine({ id: k, state: 'off' }, tz, ref), k); return; }
      if (!cp) { add('off', C.sourceLine({ id: k, state: 'off' }, tz, ref), k); return; }
      var s = { id: k, state: cp.state, since: cp.since, newest: cp.newest, oldest: cp.oldest };
      var txt = C.sourceLine(s, tz, ref);
      if (cp.state === 'ok' && cp.tileFail && !cp.tileOk) { s.state = 'down'; txt = C.sourceLine({ id: k, state: 'down', since: null }, tz, ref).replace('.', ': its maps did not load.'); }
      if (k === 'lightning' && R.data.lightning && R.data.lightning.state === 'unread') txt += ' Strike counts could not be read, so the caption leaves lightning out.';
      if (!v.layers[k]) txt += ' (layer off)';
      add(cls(s.state), txt, k);
    });
    // our hail estimate
    var hd = R.data.hours || {};
    var ht = hd.state === 'ok' ? C.CREDITS.swaths.name + ': hour by hour, up to ' + C.when(hd.asOf, tz, ref) + (hd.coverage && hd.coverage.read < hd.coverage.need ? ' (' + (hd.coverage.need - hd.coverage.read) + ' hours missing)' : '') + '.'
      : hd.state === 'stale' ? C.CREDITS.swaths.name + ' has not updated since ' + C.when(hd.since, tz, ref) + '.'
      : hd.state === 'old' ? C.CREDITS.swaths.name + ': hour by hour is kept 2 days; this shows the whole day’s swath, with no clock.'
      : hd.state === 'nohours' ? C.CREDITS.swaths.name + ': the hour-by-hour file did not load; this shows the 24-hour swath, with no clock.'
      : hd.state === 'down' ? C.CREDITS.swaths.name + ': our hail file did not load just now.'
      : C.CREDITS.swaths.name + ': loading.';
    add(cls(hd.state === 'ok' ? 'ok' : hd.state === 'down' ? 'down' : hd.state === 'loading' ? 'ok' : 'warn'), ht, 'swaths');
    // reports
    var rp = R.data.reports || {};
    add(cls(rp.state === 'down' ? 'down' : 'ok'), rp.state === 'down' ? C.sourceLine({ id: 'reports', state: 'down' }, tz, ref) : rp.state === 'ok' ? C.CREDITS.reports.name + ': ' + rp.list.length + ' within ' + C.REPORT_MI + ' miles in this window.' : C.sourceLine({ id: 'reports', state: 'loading' }, tz, ref), 'reports');
    // rain
    var rn = R.data.rain || {};
    var rt = rn.state === 'ok' ? C.CREDITS.rain.name + ': ' + C.span(rn.start, rn.end, tz, ref) + '.'
      : rn.state === 'old' ? C.CREDITS.rain.name + ': our file keeps the newest 24 hours to 7 days, not this window.'
      : rn.state === 'gap' ? C.CREDITS.rain.name + ': the radar has a gap at this spot, so there is no number.'
      : rn.state === 'outside' ? C.sourceLine({ id: 'rain', state: 'outside' }, tz, ref)
      : rn.state === 'down' ? C.CREDITS.rain.name + ': our rain file did not load just now.'
      : C.CREDITS.rain.name + ': loading.';
    add(cls(rn.state === 'ok' || rn.state === 'loading' ? 'ok' : rn.state === 'down' ? 'down' : 'warn'), rt, 'rain');
    if (R.baseDown) add('warn', 'Map: the USGS map underneath did not load. The storm layers still draw.', 'map');
    $('#sr-src', R.el).innerHTML = items.join('');
  }

  /* ---------- share ---------- */
  function shareUrl() {
    return location.origin + location.pathname + C.encodeShare({ lat: R.v.lat, lon: R.v.lon, label: R.v.label, hours: R.v.hours, end: end(), frame: R.times[R.idx], layers: R.v.layers });
  }
  function saveUrl() {
    if (!R) return;
    clearTimeout(R.urlT);
    R.urlT = setTimeout(function () { if (R) try { history.replaceState(null, '', shareUrl().slice(location.origin.length)); } catch (e) {} }, 250);
  }
  function share() {
    pause();
    var u = shareUrl(), note = $('#sr-sharenote', R.el);
    var title = 'Storm replay' + (R.v.label ? ': ' + R.v.label : '');
    if (navigator.share && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent || '')) {
      navigator.share({ title: title, url: u }).catch(function () {});
      return;
    }
    var done = function () { note.textContent = 'Link copied. It opens this replay at ' + C.when(R.times[R.idx], R.tz, end()) + ', same layers.'; };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(u).then(done, function () { note.textContent = u; });
    else note.textContent = u;
  }

  window.AgStormReplay = { open: open, close: close, _state: function () { return R; } };
})();
