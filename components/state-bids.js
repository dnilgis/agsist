/* state-bids.js: the full elevator table on /cash-bids/<state>/, loaded when
   the reader asks for it. The page itself carries the best bid, the state's
   basis and the top bids; every elevator's nearest bid per crop lives in
   /data/state-basis/<ST>.json (written by scripts/build_cash_bid_pages.py from
   the same snapshot), so a big state's page stays small. Nothing is computed
   here: the file's numbers are printed as they are. */
(function () {
  'use strict';
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(v) {
    var a = Math.abs(v).toFixed(2);
    if (a === '0.00') return 'even';
    return (v > 0 ? '+' : '−') + '$' + a;
  }
  function cents(v) {
    if (v == null) return '';
    if (v === 0) return '0¢';
    return (v > 0 ? '+' : '−') + Math.abs(v) + '¢';
  }
  var FMT = null;
  try {
    FMT = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch (e) {}
  function when(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return FMT ? FMT.format(d) : d.toISOString().slice(0, 16).replace('T', ' ');
  }
  var FLAG = {
    outlier: 'outlier, not counted in the state number',
    suspect: 'cash and basis did not check out, not counted',
    nocon: 'futures month not named, not counted'
  };
  function render(doc) {
    var c = doc.cols, ix = {};
    c.forEach(function (k, i) { ix[k] = i; });
    var by = {};
    doc.rows.forEach(function (r) { (by[r[ix.crop]] = by[r[ix.crop]] || []).push(r); });
    var wk = !!doc.prev, out = '';
    Object.keys(doc.crops).forEach(function (g) {
      var rs = by[g];
      if (!rs || !rs.length) return;
      out += '<h3>' + esc(doc.crops[g]) + ': ' + rs.length + ' elevator' + (rs.length === 1 ? '' : 's') + '</h3>'
        + '<div class="cbt-scroll"><table class="cbt-t cbt-full-t"><thead><tr><th>Elevator</th>'
        + '<th class="n">Cash</th><th class="n">Basis</th>' + (wk ? '<th class="n" title="change in a week">Wk</th>' : '')
        + '</tr></thead><tbody>';
      rs.forEach(function (r) {
        var town = r[ix.path] ? '<a href="' + esc(r[ix.path]) + '">' + esc(r[ix.town]) + '</a>' : esc(r[ix.town]);
        var vs = r[ix.vs] ? 'vs ' + esc(r[ix.vs]) : 'month not named';
        var fl = r[ix.flag] ? '<br><span class="mut">' + esc(FLAG[r[ix.flag]] || r[ix.flag]) + '</span>' : '';
        out += '<tr><td>' + esc(r[ix.elevator]) + '<br><span class="mut">' + town + ' &middot; ' + esc(r[ix.delivery])
          + ' &middot; posted ' + esc(when(r[ix.priced])) + '</span>' + fl + '</td>'
          + '<td class="n">$' + Number(r[ix.cash]).toFixed(2) + '</td>'
          + '<td class="n">' + money(r[ix.basis]) + '<br><span class="mut">' + vs + '</span></td>'
          + (wk ? '<td class="n">' + (r[ix.wow_cents] == null ? '<span class="mut" title="not posted both weeks">n/a</span>' : cents(r[ix.wow_cents])) + '</td>' : '')
          + '</tr>';
      });
      out += '</tbody></table></div>';
    });
    return out || '<p class="cbt-sub">No elevator rows in the file.</p>';
  }
  function open(btn) {
    var st = btn.getAttribute('data-state-table');
    var box = document.getElementById(btn.getAttribute('aria-controls'));
    if (!st || !box) return;
    if (btn.getAttribute('aria-expanded') === 'true') {
      box.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
      btn.textContent = btn.getAttribute('data-label');
      return;
    }
    if (!btn.getAttribute('data-label')) btn.setAttribute('data-label', btn.textContent);
    if (box.getAttribute('data-done')) {
      box.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      btn.textContent = 'Hide the full table';
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Loading the full table';
    fetch('/data/state-basis/' + encodeURIComponent(st) + '.json', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (doc) {
        box.innerHTML = render(doc);
        box.setAttribute('data-done', '1');
        box.hidden = false;
        btn.disabled = false;
        btn.setAttribute('aria-expanded', 'true');
        btn.textContent = 'Hide the full table';
        try { if (window.gaEvent) gaEvent('state_table_open', { st: st }); } catch (e) {}
      })
      .catch(function () {
        btn.disabled = false;
        btn.textContent = btn.getAttribute('data-label');
        box.hidden = false;
        box.innerHTML = '<p class="cbt-sub">The full table did not load. Try again, or open a town below.</p>';
      });
  }
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest && e.target.closest('[data-state-table]');
    if (b) open(b);
  });
})();
