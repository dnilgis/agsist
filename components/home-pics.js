/* home-pics.js: the home page's two small pictures (Nov 11, 2026).

   1. FUTURES: corn and soybeans as two line charts of the last 20 weekly closes (data/price-stats.json, the nearby
      contract, Yahoo Finance, delayed), under the two prices in the hero. The prices stay the cells' own; this only
      draws the history. The dates run back from the file's own last week, one week per point. A file that is missing,
      short, older than three weeks or with a number that is not a price draws nothing and the figure stays hidden.
   2. FARMLAND SALE: the one recorded sale against its county's median, two bars, from data/land-sales/lead.json
      (home-land.js hands the numbers in). Drawn only when the median and its count are in the file.

   Each picture has a "Save the picture" button: the card is drawn again in fixed dark colors with the date, the units and the
   source on it, then shared with the phone's share sheet or downloaded as a PNG. Nothing here works out a price; it
   draws numbers the site already published. window.AgHomePics = { series, futuresSvg, landSvg, card } (test/home-pics.test.mjs
   runs them in node). */
(function (root) {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var WEEKS = 20, MAX_AGE_DAYS = 21;
  var SCREEN = { ink: 'var(--text)', dim: 'var(--text-dim)', gold: 'var(--gold)', rule: 'var(--border-2)', bar2: 'var(--text-muted)' };
  var SAVED = { ink: '#e9edeb', dim: '#b9c1be', gold: '#d4a23f', rule: '#2a3033', bar2: '#7f8a87', bg: '#0a0c0d' };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function day(iso, delta) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + (delta || 0))) : null;
  }
  function md(d) { return MON[d.getUTCMonth()] + ' ' + d.getUTCDate(); }
  function mdy(d) { return md(d) + ', ' + d.getUTCFullYear(); }
  function money(x, dp) { return '$' + Number(x).toLocaleString('en-US', { minimumFractionDigits: dp || 0, maximumFractionDigits: dp || 0 }); }
  function n(x) { return typeof x === 'number' && isFinite(x); }

  /* the last WEEKS weekly closes of one crop, with the dates they ran on; null when the file cannot back a chart */
  function series(stats, key, now) {
    var s = stats && stats[key], h = s && s.hist, end = day(s && s.hist_to, 0);
    if (!Array.isArray(h) || h.length < WEEKS || !end) return null;
    var t = now && typeof now.getTime === 'function' ? now : new Date();
    if ((t.getTime() - end.getTime()) / 864e5 > MAX_AGE_DAYS) return null;
    var v = h.slice(-WEEKS);
    for (var i = 0; i < v.length; i++) if (!n(v[i]) || v[i] <= 0) return null;
    var lo = Math.min.apply(null, v), hi = Math.max.apply(null, v);
    return { v: v, lo: lo, hi: hi, last: v[v.length - 1], from: day(s.hist_to, -7 * (WEEKS - 1)), to: end };
  }

  /* one line chart, W x H, in a palette (CSS variables on screen, hex in the saved card) */
  function lineSvg(v, lo, hi, W, H, pal, label) {
    var padX = 6, padT = 6, padB = 6, span = hi - lo || 1, pts = [];
    for (var i = 0; i < v.length; i++) {
      var x = padX + (W - 2 * padX - 6) * i / (v.length - 1), y = padT + (H - padT - padB) * (1 - (v[i] - lo) / span);
      pts.push(x.toFixed(1) + ',' + y.toFixed(1));
    }
    var last = pts[pts.length - 1].split(',');
    return '<svg xmlns="' + NS + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(label) + '">'
      + '<line x1="0" y1="' + (H - 1) + '" x2="' + W + '" y2="' + (H - 1) + '" style="stroke:' + pal.rule + '" stroke-width="1"/>'
      + '<polyline points="' + pts.join(' ') + '" fill="none" style="stroke:' + pal.ink + '" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>'
      + '<circle cx="' + last[0] + '" cy="' + last[1] + '" r="4" style="fill:' + pal.gold + '"/></svg>';
  }
  function futLabel(name, s) { return name + ', last ' + WEEKS + ' weeks: ' + money(s.lo, 2) + ' to ' + money(s.hi, 2); }

  function futuresSvg(c, b, pal) {
    return { corn: lineSvg(c.v, c.lo, c.hi, 160, 64, pal, futLabel('Corn', c)), beans: lineSvg(b.v, b.lo, b.hi, 160, 64, pal, futLabel('Soybeans', b)) };
  }
  function futuresCaption(c) {
    return 'Weekly closes of the nearby contract, ' + md(c.from) + ' to ' + md(c.to) + '. Yahoo Finance, delayed.';
  }

  /* the sale against the county median: two bars on one scale */
  function landSvg(ppa, med, W, pal) {
    var H = 62, max = Math.max(ppa, med), lab = 112, bw = W - lab - 64, rows = [['This sale', ppa, pal.gold], ['County median', med, pal.bar2]], out = '';
    rows.forEach(function (r, i) {
      var y = 4 + i * 30, w = Math.max(3, bw * r[1] / max);
      out += '<text x="0" y="' + (y + 15) + '" style="fill:' + pal.dim + '" font-size="12" font-family="Inter,system-ui,sans-serif">' + esc(r[0]) + '</text>'
        + '<rect x="' + lab + '" y="' + y + '" width="' + w.toFixed(1) + '" height="22" rx="3" style="fill:' + r[2] + '"/>'
        + '<text x="' + (lab + w + 6).toFixed(1) + '" y="' + (y + 16) + '" style="fill:' + pal.ink + '" font-size="13" font-weight="700" font-family="JetBrains Mono,ui-monospace,monospace">' + money(r[1]) + '</text>';
    });
    return '<svg xmlns="' + NS + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc('This sale ' + money(ppa) + ' an acre, county median ' + money(med) + ' an acre') + '">' + out + '</svg>';
  }

  /* the saved card: a page-black card, the gold bar, a title, the picture(s), the dated source line, agsist.com */
  function card(title, sub, inner, foot, W, H) {
    var t = SAVED;
    return '<svg xmlns="' + NS + '" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">'
      + '<rect width="' + W + '" height="' + H + '" fill="' + t.bg + '"/><rect width="' + W + '" height="12" fill="' + t.gold + '"/>'
      + '<text x="60" y="100" fill="' + t.ink + '" font-size="44" font-weight="800" font-family="Inter,system-ui,sans-serif">' + esc(title) + '</text>'
      + '<text x="60" y="146" fill="' + t.dim + '" font-size="26" font-family="Inter,system-ui,sans-serif">' + esc(sub) + '</text>'
      + inner
      + '<text x="60" y="' + (H - 64) + '" fill="' + t.dim + '" font-size="24" font-family="Inter,system-ui,sans-serif">' + esc(foot) + '</text>'
      + '<text x="60" y="' + (H - 26) + '" fill="' + t.gold + '" font-size="26" font-weight="700" font-family="Inter,system-ui,sans-serif">agsist.com</text></svg>';
  }
  function nest(svg, x, y, w, h) { return svg.replace('<svg ', '<svg x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" '); }
  function label(x, y, t) { return '<text x="' + x + '" y="' + y + '" fill="' + SAVED.ink + '" font-size="28" font-weight="700" font-family="Inter,system-ui,sans-serif">' + esc(t) + '</text>'; }

  function futuresCard(c, b) {
    var p = futuresSvg(c, b, SAVED);
    var inner = label(60, 230, 'Corn: ' + money(c.lo, 2) + ' to ' + money(c.hi, 2) + ', last ' + money(c.last, 2)) + nest(p.corn, 60, 250, 470, 188)
      + label(560, 230, 'Soybeans: ' + money(b.lo, 2) + ' to ' + money(b.hi, 2) + ', last ' + money(b.last, 2)) + nest(p.beans, 560, 250, 470, 188);
    return card('Corn and soybean futures, ' + WEEKS + ' weeks', 'Weekly closes of the nearby contract, ' + mdy(c.from) + ' to ' + mdy(c.to), inner, 'Source: Yahoo Finance, delayed. Dollars a bushel.', 1080, 560);
  }
  function landCard(o) {
    var inner = nest(landSvg(o.ppa, o.med, 300, SAVED), 60, 190, 960, 200)
      + '<text x="60" y="440" fill="' + SAVED.dim + '" font-size="26" font-family="Inter,system-ui,sans-serif">' + esc(o.line) + '</text>';
    return card('What a farm sold for in ' + o.county + ' County', o.sub, inner, o.foot, 1080, 560);
  }

  /* an SVG string to a PNG: the share sheet with the file, else a download; the reader's own cancel is not an error */
  function savePng(svgText, name, say) {
    var W = 1080, H = 560, m = /viewBox="0 0 (\d+) (\d+)"/.exec(svgText);
    if (m) { W = +m[1]; H = +m[2]; }
    var img = new Image(), url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText);
    img.onload = function () {
      var cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      cv.getContext('2d').drawImage(img, 0, 0, W, H);
      cv.toBlob(function (blob) {
        if (!blob) { say('The picture could not be made here.'); return; }
        var file = null;
        try { file = new File([blob], name + '.png', { type: 'image/png' }); } catch (e) {}
        if (file && navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
          navigator.share({ files: [file], title: 'AGSIST' }).then(function () { say(''); }, function (e) {
            if (e && e.name === 'AbortError') { say(''); return; }
            download(blob, name, say);
          });
        } else download(blob, name, say);
      }, 'image/png');
    };
    img.onerror = function () { say('The picture could not be made here.'); };
    img.src = url;
  }
  function download(blob, name, say) {
    var a = document.createElement('a'), u = URL.createObjectURL(blob);
    a.href = u; a.download = name + '.png'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(u); }, 4000);
    say('Saved.');
  }
  function saveButton(host, getSvg, name) {
    var b = document.createElement('button'), s = document.createElement('span');
    b.type = 'button'; b.className = 'pic-save'; b.textContent = 'Save the picture';
    s.className = 'pic-say'; s.setAttribute('role', 'status');
    b.addEventListener('click', function () { savePng(getSvg(), name, function (t) { s.textContent = t; }); });
    host.appendChild(b); host.appendChild(s);
  }

  function drawFutures(stats) {
    var fig = document.getElementById('hb-fut-pic');
    if (!fig) return;
    var now = new Date(), c = stats && series(stats, 'corn', now), b = stats && series(stats, 'soybean', now);
    if (!c || !b) { fig.hidden = true; return; }
    var p = futuresSvg(c, b, SCREEN);
    fig.innerHTML = '<div class="hb-pic-row">'
      + '<div class="hb-pic-c"><span class="hb-pic-k">Corn, ' + WEEKS + ' weeks: ' + money(c.lo, 2) + ' to ' + money(c.hi, 2) + '</span>' + p.corn + '</div>'
      + '<div class="hb-pic-c"><span class="hb-pic-k">Soybeans, ' + WEEKS + ' weeks: ' + money(b.lo, 2) + ' to ' + money(b.hi, 2) + '</span>' + p.beans + '</div></div>'
      + '<figcaption>' + esc(futuresCaption(c)) + ' </figcaption>';
    saveButton(fig.querySelector('figcaption'), function () { return futuresCard(c, b); }, 'agsist-futures-' + c.to.toISOString().slice(0, 10));
  }

  /* o: { ppa, med, n, county, st, when (ISO), src } from the lead file */
  function land(host, o) {
    var fig = host && host.querySelector('#hl-pic');
    if (!fig) return false;
    if (!n(o.ppa) || !n(o.med) || !n(o.n) || o.med <= 0 || o.ppa <= 0) { fig.hidden = true; return false; }
    var when = day(o.when, 0), src = o.src ? ' ' + o.src + ' records.' : '';
    var cap = 'County median of ' + o.n + ' farm sales in 24 months.' + src;
    fig.innerHTML = landSvg(o.ppa, o.med, 300, SCREEN) + '<figcaption>' + esc(cap) + ' </figcaption>';
    saveButton(fig.querySelector('figcaption'), function () {
      return landCard({ ppa: o.ppa, med: o.med, county: o.county, sub: when ? 'Recorded ' + mdy(when) + ', dollars an acre' : 'Dollars an acre',
        line: cap.slice(0, 90), foot: (o.src ? 'Source: ' + o.src + '. ' : '') + 'Never who bought or sold.' });
    }, 'agsist-land-sale-' + String(o.st || 'us').toLowerCase());
    return true;
  }

  var api = { series: series, futuresSvg: futuresSvg, landSvg: landSvg, card: futuresCard, land: land, caption: futuresCaption };
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.document) {
    root.AgHomePics = api;
    var go = function () {
      if (!document.getElementById('hb-fut-pic')) return;
      fetch('/data/price-stats.json').then(function (r) { return r.ok ? r.json() : null; }).then(drawFutures).catch(function () { drawFutures(null); });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
  }
})(typeof self !== 'undefined' ? self : this);
