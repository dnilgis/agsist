/* /farm-bill: depth on demand.
 *
 * The "what this means for my operation" picker and the twelve-title / CBO
 * detail are not in farm-bill.html. They live in data/farm-bill.json and are
 * rendered here only when a reader clicks, so they add nothing to page weight.
 *
 * The render functions are pure (string in, string out) so test/farm-bill.test.mjs
 * runs this same file in a bare context. The DOM wiring at the bottom only runs
 * when there is a document. The data is our own file and carries trusted HTML
 * (entities, <b>, links), the same fields build_farmbill.py bakes.
 *
 * Dates that fall out: anything marked data-until="YYYY-MM-DD" (each next-90-days
 * item, and status words tied to a day) is hidden once the reader's own date is
 * past that day, so a page baked a while ago never shows a past date as upcoming.
 * build_farmbill.py drops the same items whenever it bakes.
 */
(function (root) {
  'use strict';

  function srcLabel(data, key) {
    var s = data && data.byOperation && data.byOperation._sources;
    return key && s && s[key] ? s[key] : '';
  }

  function renderOperation(data, key) {
    var op = data && data.byOperation && data.byOperation[key];
    if (!op || key === '_sources') return '';
    var h = '<h4 class="fy-op-h">' + op.label + '</h4><ul class="fy-op-list">';
    (op.lines || []).forEach(function (ln) {
      var s = srcLabel(data, ln.src);
      h += '<li>' + ln.t + (s ? ' <span class="fy-src">(' + s + ')</span>' : '') + '</li>';
    });
    h += '</ul>';
    if (op.tools && op.tools.length) {
      h += '<p class="fy-tools">' + op.tools.map(function (t) {
        return '<a href="' + t[0] + '">' + t[1] + '</a>';
      }).join(' &middot; ') + '</p>';
    }
    return h;
  }

  function renderTitles(data) {
    var rows = (data && data.titles) || [];
    if (!rows.length) return '';
    return '<div class="titles">' + rows.map(function (t) {
      var figs = '<div class="amt">' + t.amt + '</div><div class="share">' + t.share + '</div>' +
        (t.disc ? '<div class="disc">' + t.disc + '</div>'
                : '<div class="tr-mini"><i style="width:' + t.bar + '%"></i></div>');
      return '<div class="title-row"><div class="tr-num">' + t.num + '</div><div class="tr-body">' +
        '<div class="tr-name">' + t.name + '</div><div class="tr-cover">' + t.cover + '</div>' +
        '<div class="tr-change">' + t.change + '</div></div><div class="tr-figs">' + figs + '</div></div>';
    }).join('') + '</div>';
  }

  function renderLedger(data) {
    var rows = (data && data.ledger) || [];
    if (!rows.length) return '';
    return '<div class="chg">' + rows.map(function (r) {
      return '<div class="chg-row"><div class="what"><b>' + r.what + '</b><span>' + r.detail +
        '</span></div><div class="amt ' + r.cls + '">' + r.amt + '</div></div>';
    }).join('') + '</div>';
  }

  function renderDetail(data) {
    var t = renderTitles(data), l = renderLedger(data);
    if (!t && !l) return '';
    return '<h3 class="dt-h">All twelve titles</h3>' +
      (data.detailNote ? '<p class="sec-intro">' + data.detailNote + '</p>' : '') + t +
      '<h3 class="dt-h">The largest line items in the House score</h3>' + l +
      (data.ledgerNote ? '<p class="note">' + data.ledgerNote + '</p>' : '');
  }

  function isoDay(d) {
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  }
  // shown through its own day, gone the next; a malformed date is left alone
  function expired(until, today) {
    return /^\d{4}-\d{2}-\d{2}$/.test(until || '') && until < today;
  }
  function hidePast(doc, today) {
    var n = 0;
    [].slice.call(doc.querySelectorAll('[data-until]')).forEach(function (el) {
      if (expired(el.getAttribute('data-until'), today)) { el.hidden = true; n++; }
    });
    var list = doc.querySelector('.n90-dates');
    if (list && list.querySelectorAll('li:not([hidden])').length === 0) list.hidden = true;
    return n;
  }

  var api = { renderOperation: renderOperation, renderTitles: renderTitles,
              renderLedger: renderLedger, renderDetail: renderDetail,
              isoDay: isoDay, expired: expired, hidePast: hidePast };
  root.AgFarmBill = api;

  if (typeof document === 'undefined' || !document.querySelector) return;

  // runs at once: the script is deferred, so the page is parsed by now
  hidePast(document, isoDay(new Date()));

  var pending = null;
  function load() {
    if (!pending) {
      pending = fetch('/data/farm-bill.json', { cache: 'no-cache' })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .catch(function (e) { pending = null; throw e; });
    }
    return pending;
  }
  var FAIL = '<p class="note">That did not load. Check your connection and try again.</p>';

  function wire() {
    var panel = document.getElementById('fy-op');
    var btns = [].slice.call(document.querySelectorAll('[data-op]'));
    btns.forEach(function (b) {
      b.addEventListener('click', function () {
        var key = b.getAttribute('data-op');
        var was = b.getAttribute('aria-pressed') === 'true';
        btns.forEach(function (x) { x.setAttribute('aria-pressed', 'false'); });
        if (was) { panel.hidden = true; panel.innerHTML = ''; return; }
        b.setAttribute('aria-pressed', 'true');
        panel.hidden = false;
        panel.innerHTML = '<p class="note">Loading&hellip;</p>';
        load().then(function (d) { panel.innerHTML = renderOperation(d, key) || FAIL; })
          .catch(function () { panel.innerHTML = FAIL; });
        if (typeof gtag === 'function') gtag('event', 'select_content', { content_type: 'farm_bill_operation', item_id: key });
      });
    });

    var db = document.getElementById('fb-detail-btn');
    var dp = document.getElementById('fb-detail');
    if (db && dp) {
      db.addEventListener('click', function () {
        var open = db.getAttribute('aria-expanded') === 'true';
        if (open) { dp.hidden = true; db.setAttribute('aria-expanded', 'false'); db.textContent = db.getAttribute('data-show'); return; }
        db.setAttribute('aria-expanded', 'true');
        db.textContent = db.getAttribute('data-hide');
        dp.hidden = false;
        if (dp.getAttribute('data-done') === '1') return;
        dp.innerHTML = '<p class="note">Loading&hellip;</p>';
        load().then(function (d) { dp.innerHTML = renderDetail(d) || FAIL; dp.setAttribute('data-done', '1'); })
          .catch(function () { dp.innerHTML = FAIL; });
      });
      // a link to #titles (subnav) or printing should show the detail
      var openDetail = function () { if (db.getAttribute('aria-expanded') !== 'true') db.click(); };
      if (location.hash === '#titles' || location.hash === '#changes-ledger') openDetail();
      window.addEventListener('hashchange', function () {
        if (location.hash === '#titles' || location.hash === '#changes-ledger') openDetail();
      });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})(typeof window !== 'undefined' ? window : this);
