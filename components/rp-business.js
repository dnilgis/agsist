/* components/rp-business.js: /rain-print-business, the landing page for
 * business Christmas orders of Rain Prints (2026-10-16).
 *
 * The quote form posts the same kind as the business card on /rain-print
 * (rain-print-business, subs worker v5.12+, same fields and limits), with
 * page "/rain-print-business" so Sig can see where it came from.
 *
 * Every price, tier and date comes from data/rain-print.json through the pure
 * business functions in components/rain-print.js (RainPrint.bizRows,
 * bizQuote, bizCutoffNote, bizRange); this file keeps no copy of that math.
 * The page's own table and dates are the same numbers written out for
 * readers without script (test/rain-print-business.test.mjs checks they match
 * the data). Past the cutoff, the date lines go.
 *
 * A customer list can be loaded from a CSV: it is read in the browser and put
 * in the towns box for the buyer to check; nothing is uploaded until they
 * send. Over the form's 20,000 characters (2026-10-20: room for 100 customers
 * with mailing addresses, about 150 characters a line), the page says to email the file.
 *
 * The request goes to the AGSIST worker only, never to Formspree (form-post.js
 * WORKER_ONLY, 2026-10-19): a failed or silent worker leaves the form filled in
 * and says to call or text Sig, or try again.
 *
 * Analytics: rain_print_business {result, product, qty, placement:'landing'},
 * rp_business_cta {cta}, rp_business_template, rp_business_csv {result}.
 */
(function (root) {
  'use strict';
  var doc = root.document;
  var $ = function (id) { return doc.getElementById(id); };
  var ORDER_TO = 'sig@farmers1st.com';
  var PHONE = '715-797-2428';
  var LOGO_LINK = 'https://agsist-subs.dnilgis.workers.dev/rp-logo/';
  var EMAIL_RE = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[A-Za-z]{2,}$/;
  var TOWNS_MAX = 20000;   // the worker's rain-print-business towns cap (subs-worker.js v5.34)
  var PAGE = '/rain-print-business';
  var BIZ_PRODUCT = { print: 'print12x18', framed: 'framed12x18', digital: 'digital' };
  var BIZ_WORD = { print: ['print', 'prints'], framed: ['framed print', 'framed prints'], digital: ['digital file', 'digital files'],
    'not-sure': ['not sure yet', 'not sure yet'] };
  var BIZ_SHIP = { one: 'All to one address', each: 'One to each customer', 'not-sure': 'Not sure yet' };
  var BIZ_DEST = { one: ' to one address', each: ' to each customer' };
  var TEMPLATE = 'Name for the print,Town,State,Year,Mailing address (only if shipped to each customer),Note (optional)\r\n';
  var PRICES = null;

  function ga(n, p) { try { if (root.gaEvent) root.gaEvent(n, p); else if (root.gtag) root.gtag('event', n, p); } catch (e) {} }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function clean(s, n) { return String(s || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n); }
  function money(x) {
    var s = Math.round(x * 100) % 100 ? x.toFixed(2) : String(Math.round(x));
    return '$' + s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function radioVal(name) { var r = doc.querySelector('input[name="' + name + '"]:checked'); return r ? r.value : ''; }
  function chicagoToday() {
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date()); }
    catch (e) { return new Date().toISOString().slice(0, 10); }
  }
  function RP() { return root.RainPrint || null; }

  /* The sample date (data/rain-print.json business_sample_by, Sig sets it; null shows nothing): through that
     day, 'To see one before Christmas, order the sample by Nov 6.'; a bad date or a day past it, ''. */
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function sampleByLine(todayIso, by) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(by || ''));
    if (!m || +m[2] < 1 || +m[2] > 12 || +m[3] < 1 || +m[3] > 31) return '';
    if (String(todayIso || '') > by) return '';
    return 'To see one before Christmas, order the sample by ' + MON[+m[2] - 1] + ' ' + (+m[3]) + '.';
  }

  /* ---------- table, dates and the quote line, from the data ---------- */
  function syncFromData(j) {
    var R = RP();
    if (!R || !j) return;
    var cut = R.bizCutoffNote(chicagoToday(), j.business_cutoff);   // "For Christmas, send your list by Nov 20." or ''
    var c1 = $('rbz-cutoff'), c2 = $('rbz-cutoff2');
    if (c1) { c1.textContent = cut; c1.hidden = !cut; }
    if (c2) {
      var m = /by (\w+ \d+)\.$/.exec(cut), px = $('rbz-xmas');
      if (m) c2.textContent = 'send it by ' + m[1];
      /* chaos-6: past the list date the sentence follows the gift line's own
         cutoffs (RainPrint.bizChristmasLine): ask through the print cutoff,
         then plainly after Christmas, and no Christmas clause after Dec 25 */
      else if (px && R.bizChristmasLine) px.textContent = R.bizChristmasLine(chicagoToday(), j) + ' This year\u2019s print ships in January, once the full year\u2019s numbers are in.';
      else c2.textContent = 'ask me for dates';
    }
    var sb = $('rbz-sample-by'), sbt = sampleByLine(chicagoToday(), j.business_sample_by);
    if (sb) { sb.textContent = sbt; sb.hidden = !sbt; }
    var rows = R.bizRows(j), body = $('rbz-tiers-body');
    if (body && rows.length) {
      body.innerHTML = rows.map(function (r) {
        var off = r.retail ? '<span class="rbz-off">regular price, one invoice</span>' : '';
        return '<tr><th scope="row">' + esc(R.bizRange(r)) + off + '</th><td data-label="Print">' + money(r.prices.print12x18) +
          '</td><td data-label="Framed">' + money(r.prices.framed12x18) + '</td><td data-label="All to one address">' +
          money(r.one.print12x18) + ' / ' + money(r.one.framed12x18) + '</td></tr>';
      }).join('');
    }
    syncTier();
  }
  function syncTier() {
    var out = $('rb-tier'), R = RP(), raw = String($('rb-qty').value || '').trim(), qty = /^\d{1,4}$/.test(raw) ? +raw : 0;
    var pick = radioVal('rb-product'), dest = radioVal('rb-ship'), id = BIZ_PRODUCT[pick];
    out.textContent = '';
    if (!qty || !PRICES || !R) return;
    if (qty < R.BIZ_MIN) {
      out.innerHTML = 'For fewer than ' + R.BIZ_MIN + ', <a href="/rain-print#rp-buy">order the regular way</a>. Shipping is included in those prices.';
      return;
    }
    if (qty > R.BIZ_MAX) { out.textContent = 'Up to ' + R.BIZ_MAX + ' here. For more, put ' + R.BIZ_MAX + ' and say how many in the notes.'; return; }
    if (!id) return;
    var what = qty + ' ' + BIZ_WORD[pick][1];
    var one = R.bizQuote(PRICES, qty, id, 'one'), each = R.bizQuote(PRICES, qty, id, 'each');
    if (!one || !each) { out.textContent = 'For ' + qty + ', I quote it myself. Send the request and I’ll write back.'; return; }
    if (id === 'digital') { out.textContent = what + ': ' + money(one.unit) + ' each, ' + money(one.total) + ' total, emailed.'; return; }
    var q = dest === 'one' ? one : dest === 'each' ? each : null;
    out.textContent = q
      ? what + BIZ_DEST[dest] + ': ' + money(q.unit) + ' each, delivered, ' + money(q.total) + ' total.'
      : one.unit === each.unit
        ? what + ': ' + money(each.unit) + ' each, delivered, ' + money(each.total) + ' total.'
        : what + ': ' + money(each.unit) + ' each, delivered, ' + money(each.total) + ' total. All to one address: ' + money(one.unit) + ' each, ' + money(one.total) + ' total.';
  }
  function syncShip() { $('rb-note-all-wrap').hidden = radioVal('rb-ship') !== 'each'; }

  /* ---------- the customer list: a blank CSV, and loading one ---------- */
  function csvMsg(t, bad) { var m = $('rb-csv-msg'); m.textContent = t || ''; m.classList.toggle('rbz-bad', !!bad); }
  function downloadTemplate() {
    try {
      var url = URL.createObjectURL(new Blob([TEMPLATE], { type: 'text/csv' }));
      var a = doc.createElement('a'); a.href = url; a.download = 'rain-print-customer-list.csv';
      doc.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      ga('rp_business_template', { page: PAGE });
    } catch (e) {}
  }
  /* What goes in the box: the file's own lines, blank lines dropped, the
     header row kept so Sig can read the columns. null when it will not fit. */
  function listText(raw) {
    var t = String(raw || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n')
      .map(function (l) { return l.replace(/\s+$/, ''); }).filter(function (l) { return /[^,;\s]/.test(l); }).join('\n');
    return t.length > TOWNS_MAX ? null : t;
  }
  function loadCsv(file) {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { csvMsg('That file is too big for the form. Email it to ' + ORDER_TO + ' instead.', true); ga('rp_business_csv', { result: 'big' }); return; }
    var r = new FileReader();
    r.onload = function () {
      var t = listText(r.result);
      if (t === null) {
        csvMsg('That list is longer than the form takes. Send the rest of the form, and email the file to ' + ORDER_TO + '; say so in the notes.', true);
        ga('rp_business_csv', { result: 'long' });
        return;
      }
      if (!t) { csvMsg('That file looks empty.', true); ga('rp_business_csv', { result: 'empty' }); return; }
      $('rb-towns').value = t;
      var n = t.split('\n').length;
      csvMsg('Read ' + n + (n === 1 ? ' line' : ' lines') + ' from ' + file.name + '. Check the box above, then send.');
      ga('rp_business_csv', { result: 'ok', lines: n });
    };
    r.onerror = function () { csvMsg('That file could not be read. Paste the list into the box instead.', true); };
    r.readAsText(file);
  }

  /* ---------- the logo (same reader and upload as /rain-print) ---------- */
  var LOGO = null, LOGO_ASK = 0;
  function logoMsg(t, bad) { $('rb-logo-msg').textContent = t || ''; $('rb-logo-msg').classList.toggle('rbz-bad', !!bad); }
  function syncLogo() {
    var th = $('rb-logo-thumb'), has = !!(LOGO && LOGO.url);
    th.hidden = !has; if (has) th.src = LOGO.url; else th.removeAttribute('src');
    $('rb-logo-remove').hidden = !LOGO;
    $('rb-logo-pick').textContent = LOGO ? 'Choose another file' : 'Choose a file';
  }
  function pickLogo(file) {
    var A = root.AgRpLogo;
    if (!file) return;
    if (!A) { logoMsg('The logo reader did not load. Email the logo to ' + ORDER_TO + ' instead.', true); return; }
    var my = ++LOGO_ASK;
    logoMsg('Reading the logo…');
    A.process(file).then(function (p) {
      if (my !== LOGO_ASK) return;
      LOGO = { id: '', url: p.url, saving: true };
      syncLogo(); logoMsg('Saving the logo…');
      return A.upload(p.blob).then(function (id) {
        if (my !== LOGO_ASK) return;
        LOGO = { id: id, url: p.url };
        syncLogo(); logoMsg('Logo saved. It goes with your request.');
      });
    }).catch(function (e) {
      if (my !== LOGO_ASK) return;
      LOGO = null; syncLogo();
      logoMsg(e && e.plain ? e.message : 'That logo didn’t work. Try a PNG or JPG copy.', true);
    }).then(function () { try { $('rb-logo-file').value = ''; } catch (err) {} });
  }

  /* ---------- sending ---------- */
  function subject(x) { return 'Rain Print business quote: ' + x.business + ', ' + x.quantity + ' ' + BIZ_WORD[x.product][x.quantity === '1' ? 0 : 1]; }
  function asText(x) {
    return subject(x) + '\n\nBusiness: ' + x.business + '\nContact: ' + x.name + '\nEmail: ' + x.email + (x.phone ? '\nPhone: ' + x.phone : '') +
      '\nHow many: ' + x.quantity + '\nProduct: ' + BIZ_WORD[x.product][0] + '\nShip to: ' + BIZ_SHIP[x.ship] +
      (x.note_all ? '\nNote for every print: ' + x.note_all : '') + '\nTowns and years:\n' + x.towns + (x.notes ? '\nNotes: ' + x.notes : '') +
      (x.logo ? '\nLogo: ' + LOGO_LINK + x.logo : '') + '\n';
  }
  var NOTES_MAX = 2000;
  /* -> {text, bad}: "PO number: ...\nSend the invoice to: name, email", '' when all three are empty;
     bad when an invoice email is given and doesn't read as one. */
  function invoiceLines(po, name, email) {
    po = clean(po, 40); name = clean(name, 80); email = String(email || '').trim();
    if (email && !EMAIL_RE.test(email)) return { text: '', bad: true };
    var who = [name, email].filter(Boolean).join(', '), out = [];
    if (po) out.push('PO number: ' + po);
    if (who) out.push('Send the invoice to: ' + who);
    return { text: out.join('\n'), bad: false };
  }
  var sending = false, ASKED = '';   // ASKED: the list the mismatch question was asked about
  function submit(e) {
    e.preventDefault();
    if (sending) return;
    var R = RP(), MIN = R ? R.BIZ_MIN : 5, MAX = R ? R.BIZ_MAX : 500;
    var out = $('rb-out'), qraw = String($('rb-qty').value || '').trim();
    var x = {
      business: clean($('rb-business').value, 120), name: clean($('rb-name').value, 80), email: $('rb-email').value.trim(),
      phone: clean($('rb-phone').value, 30), quantity: qraw, product: radioVal('rb-product') || 'not-sure',
      towns: $('rb-towns').value.replace(/\r\n?/g, '\n').trim().slice(0, TOWNS_MAX), ship: radioVal('rb-ship') || 'not-sure',
      notes: $('rb-notes').value.replace(/\r\n?/g, '\n').trim().slice(0, 2000), page: PAGE
    };
    var qn = /^\d{1,4}$/.test(qraw) ? +qraw : 0;
    var bad = !x.business ? ['rb-business', 'Add the business name.'] : !x.name ? ['rb-name', 'Add your name.']
      : !EMAIL_RE.test(x.email) ? ['rb-email', 'Add an email address I can reply to.']
      : qn >= 1 && qn < MIN ? ['rb-qty', 'Business orders start at ' + MIN + '. For fewer, order on the Rain Print page.']
      : !(qn >= MIN && qn <= MAX) ? ['rb-qty', 'Put how many prints, from ' + MIN + ' to ' + MAX + '. For more than ' + MAX + ', put ' + MAX + ' and say how many in the notes.']
      : !x.towns ? ['rb-towns', 'Add the towns and years, or the one town for all of them.'] : null;
    /* PO number and invoice contact (2026-10-19): the worker keeps only the fields it knows (subs-worker.js
       FORM_KINDS, unknown fields dropped), so they ride at the top of the notes, where Sig reads them. */
    var inv = invoiceLines($('rb-po').value, $('rb-inv-name').value, $('rb-inv-email').value);
    if (!bad && inv.bad) bad = ['rb-inv-email', 'Check the invoice email, or leave it empty.'];
    if (!bad && inv.text) {
      var both = inv.text + (x.notes ? '\n\n' + x.notes : '');
      if (both.length > NOTES_MAX) bad = ['rb-notes', 'The notes and the invoice details are too long together. Shorten the notes a little.'];
      else x.notes = both;
    }
    if (!bad && LOGO && LOGO.saving) bad = ['rb-logo-file', 'The logo is still saving. Send again in a moment.'];
    if (bad) { out.innerHTML = '<p class="rbz-out rbz-bad">' + esc(bad[1]) + '</p>'; try { $(bad[0]).focus(); } catch (err) {} return; }
    // 30 prints and 3 towns: asked once (RainPrint.bizTownCheck); Send again sends it as it is
    var ask = R && R.bizTownCheck ? R.bizTownCheck(qn, x.towns) : '', sig = qn + '|' + x.towns;
    if (ask && ASKED !== sig) { ASKED = sig; out.innerHTML = '<p class="rbz-out rbz-bad">' + esc(ask) + '</p>'; try { $('rb-towns').focus(); } catch (err) {} return; }
    x.quantity = String(qn);
    if (LOGO && LOGO.id) x.logo = LOGO.id;
    if (x.ship === 'each') { var na = $('rb-note-all').value.replace(/\r\n?/g, '\n').trim().slice(0, 300); if (na) x.note_all = na; }
    var hp = doc.querySelector('#rb-form input[name="_gotcha"]');
    var data = Object.assign({ _gotcha: hp ? hp.value : '' }, x);
    var subj = subject(x);
    var fs = Object.assign({ _subject: subj, _replyto: x.email, form: 'rain-print-business' }, x);
    if (hp && hp.value) fs._gotcha = hp.value;
    var btn = $('rb-submit'), was = btn.textContent;
    sending = true; btn.disabled = true; btn.textContent = 'Sending…'; out.innerHTML = '';
    var send = root.agsistFormPost || function () { return Promise.reject(new Error('no form helper')); };
    send('rain-print-business', data, fs).then(function () {
      ga('rain_print_business', { result: 'ok', product: x.product, qty: qn, placement: 'landing' });
      out.innerHTML = '<div class="rbz-out ok" tabindex="-1"><p><b>Sent.</b> I’ll write to ' + esc(x.email) + ' within 1 business day with a quote, then a proof sheet.</p>' +
        '<p>Nothing is printed or charged until you OK both.</p></div>';
      $('rb-form').reset(); syncShip(); syncTier(); csvMsg('');
      LOGO_ASK++; LOGO = null; syncLogo(); logoMsg('');
      try { out.firstChild.focus(); } catch (err) {}
    }).catch(function (err) {
      /* The list never goes to Formspree (form-post.js WORKER_ONLY, Sig 2026-10-19): when the worker fails or
         goes quiet, everything stays filled in on the page and the reader calls or sends again. A worker that
         only went quiet may still have it, so that case says so. Email to Sig stays as a second way. */
      var slow = !!(err && err.slow);
      ga('rain_print_business', { result: slow ? 'slow' : 'fail', product: x.product, qty: qn, placement: 'landing' });
      var body = asText(x);
      var href = 'mailto:' + ORDER_TO + '?subject=' + encodeURIComponent(subj) + '&body=' + encodeURIComponent(body);
      out.innerHTML = '<div class="rbz-out rbz-bad" id="rb-fail" tabindex="-1"><p><b>' + (slow ? 'That may not have sent.' : 'That didn’t send.') +
        ' Call or text <a href="tel:+17157972428">' + PHONE + '</a>, or try again.</b></p>' +
        '<p>Everything you typed is still in the form above.' + (slow ? ' If it went through after all, I’ll catch the repeat.' : '') + '</p>' +
        '<p>Or email it to ' + ORDER_TO + '. The request is written out below.</p>' +
        '<p><a class="rbz-ghost" id="rb-mail" href="' + esc(href) + '">Email the request</a></p><textarea readonly rows="7" aria-label="Your quote request, as text">' + esc(body) + '</textarea></div>';
      try { $('rb-fail').focus(); } catch (e2) {}
    }).then(function () { sending = false; btn.disabled = false; btn.textContent = was; });
  }

  root.RpBusiness = { listText: listText, TEMPLATE: TEMPLATE, money: money, invoiceLines: invoiceLines, NOTES_MAX: NOTES_MAX, sampleByLine: sampleByLine };
  if (!doc || !$('rb-form')) return;

  function init() {
    $('rb-form').addEventListener('submit', submit);
    $('rb-qty').addEventListener('input', syncTier);
    Array.prototype.forEach.call(doc.querySelectorAll('input[name="rb-product"], input[name="rb-ship"]'), function (r) {
      r.addEventListener('change', function () { syncShip(); syncTier(); });
    });
    $('rbz-template').addEventListener('click', downloadTemplate);
    $('rb-csv').addEventListener('change', function () { loadCsv(this.files && this.files[0]); try { this.value = ''; } catch (e) {} });
    $('rb-logo-file').addEventListener('change', function () { pickLogo(this.files && this.files[0]); });
    $('rb-logo-remove').addEventListener('click', function () { LOGO_ASK++; LOGO = null; syncLogo(); logoMsg(''); });
    Array.prototype.forEach.call(doc.querySelectorAll('[data-rbz-cta]'), function (a) {
      a.addEventListener('click', function () { ga('rp_business_cta', { cta: a.getAttribute('data-rbz-cta'), page: PAGE }); });
    });
    syncShip();
    fetch('/data/rain-print.json', { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { if (j) { PRICES = j; syncFromData(j); } })
      .catch(function () {});
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init); else init();
})(typeof window !== 'undefined' ? window : globalThis);
