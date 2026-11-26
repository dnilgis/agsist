/* components/home-friday-chart.js -- the home page's "Friday Chart" block (Nov 20, 2026): the newest published
   Friday Chart (Infographic of the Week), one a week, under the first screen (below the answer, bids and jobs).
   It reads /infographic/latest.json, which the infographic set writes on main (scripts/build_infographic_pages.py:
   the date, the hook, the page, the link card picture, the source); nothing here is typed by hand.
   - Shown only when latest.json names a chart dated today or in the last MAX_AGE days (Central date). No chart,
     an old one, a date ahead of today or any error: the block stays hidden, as baked.
   - No layout shift: the block is baked hidden with its room fixed by its own styles (the picture's box from its
     1200 x 630 shape, the hook held to two lines). It is shown only while its spot is below the screen, so showing
     it moves nothing a reader can see; if the reader is already at or past the spot, it waits until the spot is
     below the screen again (a reload, or scrolling back up), and otherwise stays hidden for this visit.
   Fail soft: any error leaves the block hidden. Exports window.AgHomeFridayChart (and module.exports for tests). */
(function (root) {
  'use strict';
  var ISO = /^\d{4}-\d{2}-\d{2}$/;
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MAX_AGE = 13, SRC = '/infographic/latest.json';
  function chicagoToday(now) {
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(now || new Date()); }
    catch (e) { return (now || new Date()).toISOString().slice(0, 10); }
  }
  function dayNum(iso) { var p = iso.split('-').map(Number); return Math.floor(Date.UTC(p[0], p[1] - 1, p[2]) / 864e5); }
  function mdy(iso) { var p = iso.split('-').map(Number); return MON[p[1] - 1] + ' ' + p[2] + ', ' + p[0]; }
  /* the chart to show, or null: a dated hook, an internal page and picture, dated today or up to MAX_AGE days ago */
  function pick(lt, today) {
    if (!lt || typeof lt !== 'object' || !ISO.test(lt.date || '') || !ISO.test(today || '')) return null;
    var age = dayNum(today) - dayNum(lt.date);
    if (age < 0 || age > MAX_AGE) return null;
    if (typeof lt.title !== 'string' || !lt.title.trim()) return null;
    var href = String(lt.href || ''), img = String(lt.img || '');
    if (!/^\/infographic\/\d{4}-\d{2}-\d{2}$/.test(href) || !/^\/infographic\/og\/\d{4}-\d{2}-\d{2}\.jpg(\?v=[\w-]+)?$/.test(img)) return null;
    return { date: lt.date, title: lt.title.trim(), href: href, img: img, alt: String(lt.alt || lt.title), shown: mdy(lt.date) };
  }
  var api = { pick: pick, chicagoToday: chicagoToday, MAX_AGE: MAX_AGE, SRC: SRC };
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }
  root.AgHomeFridayChart = api;

  var doc = root.document, sec = doc && doc.getElementById('fc');
  if (!sec || !root.fetch) return;
  function below() {
    /* the spot: the block is display:none, so its place is where the next drawn element starts (scripts and
       hidden elements have no box), else the bottom of its parent */
    var next = sec.nextElementSibling;
    while (next && !next.getClientRects().length) next = next.nextElementSibling;
    var top = next ? next.getBoundingClientRect().top : sec.parentNode.getBoundingClientRect().bottom;
    return top >= (root.innerHeight || doc.documentElement.clientHeight);
  }
  function fill(c) {
    var a = doc.getElementById('fc-a'), im = doc.getElementById('fc-img'), t = doc.getElementById('fc-t'), d = doc.getElementById('fc-d');
    if (!a || !im || !t || !d) return false;
    a.href = c.href; im.src = c.img; im.alt = c.alt; t.textContent = c.title;
    d.textContent = c.shown; d.setAttribute('datetime', c.date);
    return true;
  }
  function show(c) {
    if (!fill(c)) return;
    if (below()) { sec.hidden = false; api.shown = c.date; return; }
    var on = function () { if (below()) { root.removeEventListener('scroll', on); sec.hidden = false; api.shown = c.date; } };
    root.addEventListener('scroll', on, { passive: true });
  }
  root.fetch(SRC, { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (lt) {
    var c = pick(lt, chicagoToday());
    api.picked = c ? c.date : null;
    if (c) show(c);
  }).catch(function () { api.picked = null; });
})(typeof window !== 'undefined' ? window : this);
