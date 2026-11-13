/* agsist GA gate (2026-11-13, honest numbers, round 2). Readers anywhere
 * count; data centers, automated browsers and visits with no real reading
 * mostly do not (Sig, Nov 13: "i want honest numbers"). The inline
 * agsist-ga-guard in every page's head loads this file on the reader's first
 * scroll, tap or key press, and only when its own rules (Global Privacy
 * Control, the /privacy switch, navigator.webdriver and bot user agents,
 * prerender) already allow analytics.
 *
 * Only on agsist.com: a copy of a page on another host never loads GA.
 *
 * Four layers, all before gtag.js is fetched:
 *
 * 1. Automation score. A few browser tells, each counted once: navigator.
 *    webdriver, a HeadlessChrome user agent and known automation globals
 *    (Nightmare, PhantomJS, Selenium, ChromeDriver cdc_ keys, Playwright)
 *    score 2 each; no plugins on desktop Chrome, an empty language list, a
 *    window with no outer size, desktop Chrome without window.chrome, and a
 *    user agent whose system differs from navigator.platform score 1 each.
 *    2 or more: no GA, the worker is not asked, and the tab keeps
 *    agsist-ga-ok = 0 so /privacy says analytics is off. One odd value alone
 *    (a privacy setting, a PDF policy) does not drop a reader.
 *
 * 2. Engagement bar, on this page, counted from the moment this file runs.
 *    The main path needs all three:
 *    (a) 5 seconds with the page visible;
 *    (b) trusted (isTrusted) input of two different kinds out of: scroll (a
 *        wheel or touch scroll, or the page scrolling within 1.5 s of any
 *        other trusted input: Tab, arrows, a scroll bar drag), pointer
 *        movement, a key press, a click or press. On a page that cannot
 *        scroll, 3 key presses 1 s apart stand in for the scroll;
 *    (c) a quarter of the page scrolled within 1.5 s of trusted input, or
 *        150 px of pointer or finger travel over 4 or more moves, or 3 key
 *        presses, or 3 presses (taps) 1 s apart.
 *    A slow path for screen readers in browse mode, which pass the page no
 *    keys: 15 seconds visible and the page moved by 3 scrolls at least 2 s
 *    apart. No signal there is one a script cannot copy; it is kept so those
 *    readers count. Script-made events (isTrusted false) count for nothing.
 *
 * 3. The subs worker (agsist-api), GET /ga-ok, asked once when this file runs:
 *    {"ok":false} for a cloud or hosting network (the main network cut), and
 *    as a backstop for a network and city sending a burst of fresh checks in
 *    one minute (v5.70). A clear answer is kept for the tab in sessionStorage
 *    (agsist-ga-ok, 1 or 0); a failure is not kept. The gate waits for the
 *    answer until the bar is met, and at least 8 s from the start, so a slow
 *    answer (a slow proxy exit) is still used, never skipped.
 *
 * 4. Fail closed only for doubtful visits. An error, an odd answer, no fetch
 *    or no answer by then loads GA only for a visit with an automation score
 *    of 0 that has passed the bar. Oct 21 (the worker was blocked for a day
 *    and GA counted nobody): an outage never blanks a clean, engaged reader.
 *
 * The queue. The guard's stub queues gtag() calls in window.dataLayer and
 * gtag.js sends the whole queue when it loads. A visit that passes the bar is
 * a reader, so what that reader was shown before it passed (an ask, a sponsor
 * slot, a sale on return from checkout) is sent as it stands. A visit that
 * never passes never loads gtag.js, and its queue is never sent.
 *
 * Right before gtag.js is added, the /privacy switch, the guard's flag and
 * Global Privacy Control are read again: a switch turned off in another tab
 * while this page waited wins.
 *
 * Tagging. Every hit carries ga_gate (ok, cached, timeout, error, badreply:
 * how the visit got in) and ga_auto (the score, 0 or 1), as an event
 * parameter and a user property, so fail-open can be measured in GA. Nothing
 * else about the browser is sent.
 */
(function (w, d) {
  var K = 'agsist-ga-ok', API = 'https://agsist-api.dnilgis.workers.dev/ga-ok';
  var SRC = 'https://www.googletagmanager.com/gtag/js?id=G-6KXCTD5Z9H';
  var VISIBLE_MS = 5000, WAIT_MS = 8000, DEPTH = 0.25, MOVE_PX = 150, MOVES = 4, INPUT_MS = 1500;
  var KEYS = 3, PRESSES = 3, SPACED_MS = 1000, SLOW_MS = 15000, SLOW_SCROLLS = 3, SLOW_GAP_MS = 2000;
  var n = w.navigator || {};
  if (w.agsistGaOff === true || w.agsistGaGate) return;
  w.agsistGaGate = 1;
  function switchedOff() {
    if (w.agsistGaOff === true || n.globalPrivacyControl === true) return true;
    /* the /privacy switch may have been set on this page, or in another tab, after the guard ran */
    try { if (w.localStorage.getItem('agsist-ga-off') === '1') return true; } catch (e) {}
    return false;
  }
  if (switchedOff()) return;
  var host = '';
  try { host = String(w.location.hostname || ''); } catch (e) {}
  if (host !== 'agsist.com' && host !== 'www.agsist.com') return;
  function keep(v) { try { w.sessionStorage.setItem(K, v); } catch (e) {} }

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
  if (score >= 2) { keep('0'); return; }

  var kept = null;
  try { kept = w.sessionStorage.getItem(K); } catch (e) {}
  if (kept === '0') return;

  // ----------------------------------------------------- 2. the engagement bar
  var clock = w.performance && typeof w.performance.now === 'function' ? function () { return w.performance.now(); } : function () { return Date.now(); };
  var started = clock();
  var shownMs = 0, shownFrom = d.visibilityState === 'hidden' ? null : started;
  var kinds = {}, kindCount = 0, moved = 0, moves = 0, lastInput = -1e9, depthMet = false;
  var keyPresses = 0, spacedKeys = 0, lastSpacedKey = -1e9, spacedPresses = 0, lastSpacedPress = -1e9;
  var slowScrolls = 0, lastSlowScroll = -1e9, lastY = null;
  var lastPt = null, lastTouch = null, barTimer = null, waitTimer = null, met = false, done = false, answer = null;
  function shown() { return shownMs + (shownFrom === null ? 0 : clock() - shownFrom); }
  function kind(k) { if (!kinds[k]) { kinds[k] = 1; kindCount++; } }
  function travel(dx, dy) {
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 0) { moved += dist; moves++; }
  }
  function metrics() {
    var de = d.documentElement || {}, b = d.body || {};
    return {
      y: w.scrollY || w.pageYOffset || de.scrollTop || 0,
      room: Math.max(de.scrollHeight || 0, b.scrollHeight || 0) - (w.innerHeight || de.clientHeight || 0)
    };
  }
  function onInput(e) {
    if (!e || e.isTrusted !== true || done) return;
    var t = e.type, now = clock();
    if (t === 'wheel' || t === 'touchmove') kind('scroll');
    else if (t === 'pointermove') kind('pointer');
    else if (t === 'keydown') {
      kind('key');
      if (!e.repeat) {
        keyPresses++;
        if (now - lastSpacedKey >= SPACED_MS) { spacedKeys++; lastSpacedKey = now; }
      }
    }
    else if (t === 'click' || t === 'pointerdown') {
      kind('press');
      if (t === 'pointerdown' && now - lastSpacedPress >= SPACED_MS) { spacedPresses++; lastSpacedPress = now; }
    }
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
  function onScroll() {
    if (done) return;
    /* the browser marks every scroll event trusted, window.scrollTo included, so a
       scroll counts only near trusted input: a key (Tab, arrows), a pointer, a press */
    var now = clock(), m;
    try { m = metrics(); } catch (x) { return; }
    if (now - lastInput <= INPUT_MS) {
      kind('scroll');
      if (m.room > 0 && m.y / m.room >= DEPTH) depthMet = true;
    }
    /* the slow path (screen readers in browse mode): the page really moved, 2 s or more apart */
    if (lastY === null || m.y !== lastY) {
      if (lastY !== null && now - lastSlowScroll >= SLOW_GAP_MS) { slowScrolls++; lastSlowScroll = now; }
      lastY = m.y;
    }
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
    if (waitTimer) { w.clearTimeout(waitTimer); waitTimer = null; }
  }
  function barMet() {
    var t = shown(), k = kindCount, room = 1;
    try { room = metrics().room; } catch (e) {}
    /* a page that cannot scroll: 3 key presses 1 s apart stand in for the scroll */
    if (!kinds.scroll && room <= 0 && spacedKeys >= KEYS) k++;
    var main = t >= VISIBLE_MS && k >= 2 &&
      (depthMet || (moved >= MOVE_PX && moves >= MOVES) || keyPresses >= KEYS || spacedPresses >= PRESSES);
    return main || (t >= SLOW_MS && slowScrolls >= SLOW_SCROLLS);
  }
  function check() {
    if (done) return;
    if (!met && barMet()) met = true;
    if (met) { decide(); return; }
    /* wake when the visible time runs out (5 s, then 15 s), in case the reader has already done the rest */
    if (shownFrom !== null && !barTimer) {
      var s = shown(), left = s < VISIBLE_MS ? VISIBLE_MS - s : SLOW_MS - s;
      if (left > 0) barTimer = w.setTimeout(function () { barTimer = null; check(); }, Math.ceil(left) + 20);
    }
  }

  // ------------------------------------------------------------ 4. decide
  function args() { return arguments; }
  function isArgs(x) { return Object.prototype.toString.call(x) === '[object Arguments]'; }
  function load(how) {
    stop();
    if (switchedOff()) return;
    var q = w.dataLayer = w.dataLayer || [], i, at = -1;
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
    if (done || !met) return;
    if (answer === null) {
      /* keep waiting for the worker until 8 s from the start; a late answer is used */
      var left = WAIT_MS - (clock() - started);
      if (left > 0) { if (!waitTimer) waitTimer = w.setTimeout(function () { waitTimer = null; settle('timeout'); }, Math.ceil(left)); return; }
      settle('timeout');
      return;
    }
    if (answer === 'ok' || answer === 'cached') { load(answer); return; }
    if (answer === 'no') { stop(); return; }
    /* timeout, error, badreply: only a clean visit (the bar is already met) */
    if (score === 0) load(answer); else stop();
  }
  var ac = null;
  function settle(a) {
    if (answer !== null) return;
    answer = a;
    if (a === 'timeout' && ac) { try { ac.abort(); } catch (e) {} }
    if (a === 'no') { stop(); return; }
    decide();
  }

  // ------------------------------------------------------------ 3. the worker
  listen(true);
  if (kept === '1') settle('cached');
  else if (typeof w.fetch !== 'function') settle('error');
  else {
    ac = typeof w.AbortController === 'function' ? new w.AbortController() : null;
    var bad = false;
    try {
      w.fetch(API, { credentials: 'omit', cache: 'default', signal: ac ? ac.signal : undefined })
        .then(function (r) { if (!r || !r.ok) { bad = true; return null; } return r.json(); })
        .then(function (j) {
          if (answer !== null) return;
          if (!j || typeof j.ok !== 'boolean') { settle(bad ? 'error' : 'badreply'); return; }
          keep(j.ok ? '1' : '0');
          settle(j.ok ? 'ok' : 'no');
        })
        .catch(function (e) { if (answer !== null) return; settle(e && e.name === 'SyntaxError' ? 'badreply' : 'error'); });
    } catch (e) { settle('error'); }
  }
  check();
})(window, document);
