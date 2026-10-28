/* components/rain-print-hero.js: the example print at the top of /rain-print
 * draws itself, a silent loop (Sig, 2026-10-21: "a nice little sample rendering
 * with all the different options on and some fake dates inserted").
 *
 * WHAT IT SHOWS. One real year at one real place, from NOAA's daily records,
 * baked into data/rain-print-hero.json by scripts/build_rp_hero.mjs (the page's
 * own engine draws it there, every option on: the 30-year normals, snow, the
 * temperature stripes, frost, corn stages, remarkable days, and hail near town
 * from our own records). The name is "Example Farm" and the three marked days
 * ("Planted", "First cutting", "Harvest done") are made-up sample dates, so the
 * print carries a small "Example print" tag the whole time it shows.
 *
 * HOW IT PLAYS. The same player as Watch it draw (components/rain-print-draw.js,
 * AgRainDraw.prepare and frameAt), in place, over the example picture:
 *   - nothing loads until the print is on screen (IntersectionObserver); until
 *     the loop is ready, the example picture shows as before
 *   - it pauses off screen and in a background tab, and starts again from the
 *     paper after a short hold on the finished print
 *   - reduced motion: the finished print, still
 *   - no sound (there is none), no NOAA request: the year is in the file
 *   - it stops for good once the reader draws a print of their own (the engine
 *     replaces the frame's contents), or a shared design opens first
 * If the file is missing or anything fails, the picture simply stays.
 */
(function (root) {
  'use strict';

  var DATA_URL = '/data/rain-print-hero.json?v=1', HOLD_END = 3.2;

  /* The baked file back to the art's input. Days are kept as columns (the date,
     month, day and day of the year follow from the year); matrix: the standard QR
     (RainPrint.standardMatrix(), the same one every preview carries). */
  function expand(f, matrix) {
    var I = JSON.parse(JSON.stringify(f.input)), c = I.days, n = c.v.length, days = [];
    for (var i = 0; i < n; i++) {
      var dt = new Date(Date.UTC(+f.year, 0, 1) + i * 86400000), x = { date: dt.toISOString().slice(0, 10) };
      x.v = c.v[i]; x.flag = c.flag.charAt(i) === ' ' ? '' : c.flag.charAt(i); x.t = c.t[i]; x.s = c.s[i];
      x.m = dt.getUTCMonth(); x.d = dt.getUTCDate(); x.doy = i;
      if (c.sT && c.sT.indexOf(i) >= 0) x.sT = true;
      days.push(x);
    }
    I.days = days;
    I.qr = { matrix: matrix || null, serial: '' };
    return I;
  }
  root.AgRainHero = { expand: expand, DATA_URL: DATA_URL, HOLD_END: HOLD_END };

  var doc = root.document;
  if (!doc || typeof doc.getElementById !== 'function') return;

  function reducedMotion() { try { return root.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }
  // the scripts it plays with load deferred on the same page; wait for them a while, then give up quietly
  function ready(tries) {
    if (root.AgRainArt && root.AgRainDraw && root.AgRainDraw.prepare && root.RainPrint) return Promise.resolve(true);
    if (!tries) return Promise.resolve(false);
    return new Promise(function (r) { setTimeout(r, 150); }).then(function () { return ready(tries - 1); });
  }

  var art, pic, cv, ctx, S = null, visible = false, loading = null, t = 0, last = 0, raf = 0, dead = false, still = false;

  function alive() { return !dead && cv && cv.isConnected && art.classList.contains('rp-empty') && !doc.documentElement.classList.contains('rp-from-link'); }
  function stop() {
    dead = true;
    if (raf) { (root.cancelAnimationFrame || clearTimeout)(raf); raf = 0; }
    var line = doc.getElementById('rp-hero-line'); if (line) line.hidden = true;
    var tag = art && art.querySelector('.rp-ex-tag'); if (tag && tag.getAttribute('data-was')) tag.textContent = tag.getAttribute('data-was');
    if (pic && pic.isConnected) pic.removeAttribute('aria-hidden');
  }
  function size() {
    var r = pic.getBoundingClientRect(), dpr = Math.min(2, root.devicePixelRatio || 1);
    var w = Math.max(300, Math.round(r.width * dpr)), h = Math.round(w * 2 / 3);
    if (cv.width !== w) { cv.width = w; cv.height = h; if (S) S.comp = null; }
    if (S) { S.cw = cv.width; S.ch = cv.height; }
  }
  function frame(now) {
    raf = 0;
    if (!alive()) { stop(); return; }
    if (!visible || doc.hidden) { last = 0; return; }
    var dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    t += dt;
    if (t > S.plan.total + HOLD_END) { t = 0; S.comp = null; }
    size();
    root.AgRainDraw.frameAt(ctx, S, 'inplace', Math.min(t, S.plan.total));
    raf = (root.requestAnimationFrame || setTimeout)(frame);
  }
  function kick() { if (S && !still && !raf && visible && !doc.hidden && alive()) raf = (root.requestAnimationFrame || setTimeout)(frame); }

  function load() {
    if (loading) return loading;
    loading = fetch(DATA_URL).then(function (r) { if (!r.ok) throw new Error('none'); return r.json(); }).then(function (f) {
      if (!f || !f.input || !f.input.days) throw new Error('bad file');
      return ready(120).then(function (ok) {
        if (!ok || !alive0()) throw new Error('not here');
        var I = expand(f, root.RainPrint.standardMatrix ? root.RainPrint.standardMatrix() : null);
        var src = { input: I, place: f.place, year: f.year, name: I.name, lat: f.lat, lon: f.lon, ca: false, url: '', from: 'hero', style: I.style };
        still = reducedMotion();
        return root.AgRainDraw.prepare(src, { hail: f.hail && f.hail.list ? f.hail : false, scale: Math.min(1, Math.max(0.5, pic.getBoundingClientRect().width * Math.min(2, root.devicePixelRatio || 1) / 1800)) });
      });
    }).then(function (show) {
      if (!alive0()) return;
      S = show;
      cv = doc.createElement('canvas');
      cv.className = 'rp-hero-cv';
      cv.setAttribute('role', 'img');
      cv.setAttribute('aria-label', 'Example print drawing itself, day by day: ' + S.year + ' at ' + (S.src.place || '') + ', from NOAA daily records, with every option on. The farm name and the three marked days are made up for the example.');
      ctx = cv.getContext('2d');
      pic.appendChild(cv);
      pic.setAttribute('aria-hidden', 'true');
      var tag = art.querySelector('.rp-ex-tag');
      if (tag) { tag.setAttribute('data-was', tag.textContent); tag.textContent = 'Example print'; }
      var line = doc.getElementById('rp-hero-line'); if (line) line.hidden = false;
      art.setAttribute('data-hero', still ? 'still' : 'loop');
      size();
      if (still) { root.AgRainDraw.frameAt(ctx, S, 'inplace', S.plan.total); return; }
      kick();
    }).catch(function () { /* the picture stays */ });
    return loading;
  }
  function alive0() { return art.classList.contains('rp-empty') && art.contains(pic) && !doc.documentElement.classList.contains('rp-from-link'); }

  function init() {
    art = doc.getElementById('rp-art');
    pic = art && art.querySelector('.rp-ex');
    if (!pic || !alive0() || typeof root.IntersectionObserver !== 'function') return;
    var io = new root.IntersectionObserver(function (es) {
      visible = es.some(function (e) { return e.isIntersecting; });
      if (visible) { load(); kick(); }
    }, { threshold: 0.2 });
    io.observe(art);
    doc.addEventListener('visibilitychange', kick);
    root.addEventListener('resize', function () { if (S && cv && alive()) { size(); if (still) root.AgRainDraw.frameAt(ctx, S, 'inplace', S.plan.total); } });
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init); else init();
})(typeof window !== 'undefined' ? window : this);
