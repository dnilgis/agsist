/* agsist GA gate (2026-11-13, honest numbers). Readers anywhere count; data
 * centers, automated browsers and visits with no real reading do not (Sig,
 * Nov 13: "i want honest numbers"). The inline agsist-ga-guard in every
 * page's head loads this file on the reader's first scroll, tap or key press,
 * and only when its own rules (Global Privacy Control, the /privacy switch,
 * navigator.webdriver and bot user agents, prerender) already allow analytics.
 *
 * Four layers, all before gtag.js is fetched:
 *
 * 1. Automation score. A few browser tells, each counted once: navigator.
 *    webdriver, a HeadlessChrome user agent and known automation globals
 *    (Nightmare, PhantomJS, Selenium, ChromeDriver cdc_ keys, Playwright)
 *    score 2 each; no plugins on desktop Chrome, an empty language list, a
 *    window with no outer size, desktop Chrome without window.chrome, and a
 *    user agent whose system differs from navigator.platform score 1 each.
 *    2 or more: no GA, and the worker is not asked. One odd value alone (a
 *    privacy setting, a PDF policy) does not drop a reader.
 *
 * 2. Engagement bar, on this page, counted from the moment this file runs.
 *    All three: (a) 5 seconds with the page visible; (b) trusted (isTrusted)
 *    input of at least two different kinds out of: scroll by wheel or touch,
 *    pointer movement, a key press, a click or press; (c) a scroll of a
 *    quarter of the page's scrollable height, made while the reader was
 *    giving input, or real pointer movement (150 px over 4 or more moves,
 *    finger travel included). Script-made events (isTrusted false) count for
 *    nothing.
 *
 * 3. The subs worker (agsist-api), GET /ga-ok, asked once when this file runs:
 *    {"ok":false} for a cloud or hosting network, or a network and city
 *    sending a burst of fresh visits (v5.70). A clear answer is kept for the
 *    tab in sessionStorage (agsist-ga-ok, 1 or 0); a failure is not kept.
 *
 * 4. Fail closed only for doubtful visits. An error, an odd answer, no fetch
 *    or no answer within 3 seconds loads GA only for a visit with an
 *    automation score of 0 that has passed the bar. Oct 21 (the worker was
 *    blocked for a day and GA counted nobody): an outage never blanks a clean,
 *    engaged reader.
 *
 * No replay. The guard's stub queues gtag() calls in window.dataLayer, and
 * gtag.js sends the whole queue when it loads. Before loading, this file
 * drops every queued event except page_view (the config line's own), so an
 * event a page fired before the bar (an ask shown on load, a grid from the
 * address) is never sent afterwards as if a reader had seen it. Events after
 * the bar are sent as usual. The honest reading: event counts are counts for
 * visits that passed the bar, from the moment they passed it.
 *
 * Tagging. Every hit carries ga_gate (ok, cached, timeout, error, badreply:
 * how the visit got in) and ga_auto (the score, 0 or 1), as an event
 * parameter and a user property, so fail-open can be measured in GA. Nothing
 * else about the browser is sent.
 */
(function (w, d) {
  var K = 'agsist-ga-ok', API = 'https://agsist-api.dnilgis.workers.dev/ga-ok';
  var SRC = 'https://www.googletagmanager.com/gtag/js?id=G-6KXCTD5Z9H';
  var VISIBLE_MS = 5000, WAIT_MS = 3000, DEPTH = 0.25, MOVE_PX = 150, MOVES = 4, INPUT_MS = 1500;
  var n = w.navigator || {};
  if (w.agsistGaOff === true || w.agsistGaGate) return;
  w.agsistGaGate = 1;
  /* the /privacy switch may have been set on this page after the guard ran */
  try { if (w.localStorage.getItem('agsist-ga-off') === '1') return; } catch (e) {}
  if (n.globalPrivacyControl === true) return;

  // ------------------------------------------------------------ 1. the score
  var AUTO_GLOBALS = ['__nightmare', '_phantom', 'callPhantom', '__phantomas', '_selenium', 'calledSelenium',
    '_Selenium_IDE_Recorder', '__webdriver_script_fn', '__webdriver_evaluate', '__selenium_evaluate',
    '__driver_evaluate', '__webdriver_unwrapped', '__selenium_unwrapped', '__fxdriver_unwrapped',
    'domAutomation', 'domAutomationController', '__playwright', '__pwInitScripts', '__playwright__binding__',
    '__lastWatirAlert', '__webdriverFunc'];
  var AUTO_KEY = /^(\$?cdc_|\$wdc_|__pw_|__playwright|__puppeteer)/;
  function autoGlobals() {
    var i, k;
    for (i = 0; i < AUTO_GLOBALS.length; i++) { try { if (AUTO_GLOBALS[i] in w) return true; } catch (e) {} }
    var lists = [];
    try { lists.push(Object.getOwnPropertyNames(w)); } catch (e) {}
    try { lists.push(Object.getOwnPropertyNames(d)); } catch (e) {}
    for (i = 0; i < lists.length; i++) for (k = 0; k < lists[i].length; k++) if (AUTO_KEY.test(lists[i][k])) return true;
    try {
      var de = d.documentElement;
      if (de && de.getAttribute && (de.getAttribute('webdriver') !== null || de.getAttribute('selenium') !== null || de.getAttribute('driver') !== null)) return true;
    } catch (e) {}
    return false;
  }
  function platformMismatch(ua, p) {
    if (typeof p !== 'string' || !p) return false;
    if (/iPhone|iPad|iPod/.test(ua)) return !/^(iPhone|iPad|iPod|MacIntel)/.test(p);
    if (/Android/.test(ua)) return !/Linux|Android|arm|aarch/i.test(p);
    if (/Windows NT/.test(ua)) return !/^Win/.test(p);
    if (/Macintosh|Mac OS X/.test(ua)) return !/^Mac/.test(p);
    if (/CrOS|X11|Linux/.test(ua)) return !/Linux|X11|CrOS|BSD/i.test(p);
    return false;
  }
  function autoScore() {
    var s = 0, ua = String(n.userAgent || '');
    var mobile = /Mobi|Android|iPhone|iPad|iPod/.test(ua);
    var chromeDesktop = /Chrome\/\d/.test(ua) && !mobile && !/ wv\)/.test(ua);
    try { if (n.webdriver === true) s += 2; } catch (e) {}
    if (/HeadlessChrome/.test(ua)) s += 2;
    if (autoGlobals()) s += 2;
    try { if (chromeDesktop && n.plugins && n.plugins.length === 0) s += 1; } catch (e) {}
    try { if (n.languages && typeof n.languages.length === 'number' && n.languages.length === 0) s += 1; } catch (e) {}
    try { if (w.outerWidth === 0 || w.outerHeight === 0) s += 1; } catch (e) {}
    try { if (chromeDesktop && !w.chrome) s += 1; } catch (e) {}
    try { if (platformMismatch(ua, n.platform)) s += 1; } catch (e) {}
    return s;
  }
  var score = autoScore();
  if (score >= 2) return;

  var kept = null;
  try { kept = w.sessionStorage.getItem(K); } catch (e) {}
  if (kept === '0') return;

  // ----------------------------------------------------- 2. the engagement bar
  var clock = w.performance && typeof w.performance.now === 'function' ? function () { return w.performance.now(); } : function () { return Date.now(); };
  var shownMs = 0, shownFrom = d.visibilityState === 'hidden' ? null : clock();
  var kinds = {}, kindCount = 0, moved = 0, moves = 0, lastInput = -1e9, depthMet = false;
  var lastPt = null, lastTouch = null, barTimer = null, met = false, done = false, answer = null;
  function shown() { return shownMs + (shownFrom === null ? 0 : clock() - shownFrom); }
  function kind(k) { if (!kinds[k]) { kinds[k] = 1; kindCount++; } }
  function travel(dx, dy) {
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 0) { moved += dist; moves++; }
  }
  function onInput(e) {
    if (!e || e.isTrusted !== true || done) return;
    var t = e.type, now = clock();
    if (t === 'wheel' || t === 'touchmove') kind('scroll');
    else if (t === 'pointermove') kind('pointer');
    else if (t === 'keydown') kind('key');
    else if (t === 'click' || t === 'pointerdown') kind('press');
    if (t === 'pointermove') {
      var x = +e.clientX, y = +e.clientY, pt = String(e.pointerType || 'mouse');
      if (isFinite(x) && isFinite(y)) {
        if (lastPt && lastPt.t === pt) travel(x - lastPt.x, y - lastPt.y);
        lastPt = { x: x, y: y, t: pt };
      }
    } else if (t === 'touchstart' || t === 'touchmove') {
      var tc = e.touches && e.touches[0];
      if (tc && isFinite(+tc.clientX) && isFinite(+tc.clientY)) {
        if (t === 'touchmove' && lastTouch) travel(tc.clientX - lastTouch.x, tc.clientY - lastTouch.y);
        lastTouch = { x: +tc.clientX, y: +tc.clientY };
      }
    }
    if (t !== 'touchstart') lastInput = now;
    check();
  }
  function onScroll(e) {
    if (!e || done || depthMet) return;
    /* a scroll counts toward depth only while the reader is giving trusted input; window.scrollTo alone does not */
    if (clock() - lastInput > INPUT_MS) return;
    try {
      var de = d.documentElement || {}, b = d.body || {};
      var y = w.scrollY || w.pageYOffset || de.scrollTop || 0;
      var room = Math.max(de.scrollHeight || 0, b.scrollHeight || 0) - (w.innerHeight || de.clientHeight || 0);
      if (room > 0 && y / room >= DEPTH) depthMet = true;
    } catch (x) {}
    check();
  }
  function onVisibility() {
    if (d.visibilityState === 'hidden') { if (shownFrom !== null) { shownMs += clock() - shownFrom; shownFrom = null; } }
    else if (shownFrom === null) { shownFrom = clock(); }
    check();
  }
  var INPUTS = ['wheel', 'touchstart', 'touchmove', 'pointermove', 'pointerdown', 'click', 'keydown'];
  var opt = { capture: true, passive: true };
  function listen(on) {
    var f = on ? 'addEventListener' : 'removeEventListener';
    try {
      for (var i = 0; i < INPUTS.length; i++) w[f](INPUTS[i], onInput, opt);
      w[f]('scroll', onScroll, opt);
      d[f]('visibilitychange', onVisibility, opt);
    } catch (e) {}
  }
  function stop() {
    done = true;
    listen(false);
    if (barTimer) { w.clearTimeout(barTimer); barTimer = null; }
  }
  function barMet() {
    return shown() >= VISIBLE_MS && kindCount >= 2 && (depthMet || (moved >= MOVE_PX && moves >= MOVES));
  }
  function check() {
    if (done) return;
    if (!met && barMet()) met = true;
    if (met) { decide(); return; }
    /* wake when the visible time runs out, in case the reader has already done the rest and then sits reading */
    if (shownFrom !== null && !barTimer) {
      var left = VISIBLE_MS - shown();
      if (left > 0) barTimer = w.setTimeout(function () { barTimer = null; check(); }, Math.ceil(left) + 20);
    }
  }

  // ---------------------------------------------- 4. decide, and no replay
  function args() { return arguments; }
  function isArgs(x) { return Object.prototype.toString.call(x) === '[object Arguments]'; }
  function load(how) {
    stop();
    var q = w.dataLayer = w.dataLayer || [], i, at = -1, x;
    for (i = q.length - 1; i >= 0; i--) {
      x = q[i];
      if (isArgs(x) ? (x[0] === 'event' && x[1] !== 'page_view') : (x && typeof x === 'object' && 'event' in x)) q.splice(i, 1);
    }
    for (i = 0; i < q.length; i++) { if (isArgs(q[i]) && q[i][0] === 'config') { at = i; break; } }
    var tag = { ga_gate: how, ga_auto: String(score) };
    var sets = [args('set', 'user_properties', tag), args('set', tag)];
    if (at < 0) q.push(sets[0], sets[1]); else q.splice(at, 0, sets[0], sets[1]);
    var s = d.createElement('script');
    s.async = true;
    s.src = SRC;
    (d.head || d.documentElement).appendChild(s);
  }
  function decide() {
    if (done || !met || answer === null) return;
    if (answer === 'ok' || answer === 'cached') { load(answer); return; }
    if (answer === 'no') { stop(); return; }
    /* timeout, error, badreply: only a clean visit (the bar is already met) */
    if (score === 0) load(answer); else stop();
  }
  function settle(a) {
    if (answer !== null) return;
    answer = a;
    if (a === 'no') { stop(); return; }
    decide();
  }

  // ------------------------------------------------------------ 3. the worker
  listen(true);
  if (kept === '1') settle('cached');
  else if (typeof w.fetch !== 'function') settle('error');
  else {
    var ac = typeof w.AbortController === 'function' ? new w.AbortController() : null;
    var timer = w.setTimeout(function () { if (ac) ac.abort(); settle('timeout'); }, WAIT_MS);
    var bad = false;
    try {
      w.fetch(API, { credentials: 'omit', cache: 'default', signal: ac ? ac.signal : undefined })
        .then(function (r) { if (!r || !r.ok) { bad = true; return null; } return r.json(); })
        .then(function (j) {
          if (answer !== null) return;
          w.clearTimeout(timer);
          if (!j || typeof j.ok !== 'boolean') { settle(bad ? 'error' : 'badreply'); return; }
          try { w.sessionStorage.setItem(K, j.ok ? '1' : '0'); } catch (e) {}
          settle(j.ok ? 'ok' : 'no');
        })
        .catch(function (e) { if (answer !== null) return; w.clearTimeout(timer); settle(e && e.name === 'SyntaxError' ? 'badreply' : 'error'); });
    } catch (e) { w.clearTimeout(timer); settle('error'); }
  }
  check();
})(window, document);
