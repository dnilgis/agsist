/* Self-serve sponsor sign-up (sponsor-apply.html), 2026-10-07.
 *
 * Everything a buyer sees here is read, not typed:
 *   prices          data/rate-card.json (the one rate card)
 *   pages offered   data/sponsor-slots.json (scripts/stamp_rates.py reads the ribbons)
 *   pages taken     data/page-sponsors.json (sold page slots)
 *   footer room     data/supporters.json (active supporters against its cap)
 *   sponsor slot   data/sponsors.json (a founding deal on file means it is spoken for)
 * The preview is drawn by window.AgsistSlots in components/loader.js, the same
 * code that draws a sold ribbon or footer card on the live site.
 *
 * The application goes to the subs worker (/sponsor-apply). Nothing is
 * published from here: the applicant confirms by email, Sig approves, and
 * scripts/sponsor_apply.py puts it live. If the worker cannot take it (not
 * deployed yet, offline), the form hands the same details to an email to Sig
 * instead of losing them.
 */
(function () {
  'use strict';
  var WORKER = 'https://agsist-subs.dnilgis.workers.dev';
  var MAX_LOGO = 250 * 1024;
  var $ = function (id) { return document.getElementById(id); };
  var form = $('sa-form');
  if (!form) return;
  var S = { card: null, slots: [], taken: {}, supFull: false, fndReserved: false, logo: '' };

  function get(u) { return fetch(u, { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw 0; return r.json(); }).catch(function () { return null; }); }
  function tier() { var c = form.querySelector('input[name=tier]:checked'); return c ? c.value : ''; }
  function price(t) {
    var x = S.card && (S.card.tiers || []).filter(function (z) { return z.id === t; })[0];
    return x ? '$' + x.price_month + '/mo' : '';
  }
  function val(id) { return ($(id).value || '').trim(); }

  Promise.all([get('/data/rate-card.json'), get('/data/sponsor-slots.json'), get('/data/page-sponsors.json'),
               get('/data/supporters.json'), get('/data/sponsors.json')]).then(function (r) {
    S.card = r[0];
    S.slots = (r[1] && r[1].slots) || [];
    var sold = (r[2] && r[2].slots) || {};
    Object.keys(sold).forEach(function (k) { if (sold[k] && sold[k].active !== false) S.taken[k] = true; });
    if (r[3]) {
      var act = (r[3].supporters || []).filter(function (s) { return s && s.active === true; }).length;
      S.supFull = r[3].cap ? act >= r[3].cap : false;
    }
    S.fndReserved = !!(r[4] && (r[4].sponsors || []).some(function (s) {
      return s && s.active !== false && s.billing && s.billing.tier === 'founding';
    }));
    ['page', 'supporter', 'founding'].forEach(function (t) {
      var el = form.querySelector('[data-price="' + t + '"]');
      if (el) el.innerHTML = price(t) ? price(t) + ' &middot; first month free' : '-';
    });
    if (S.supFull) $('sa-sup-note').textContent = 'All supporter spots are taken. Apply and you are first in line.';
    if (S.fndReserved) $('sa-fnd-note').textContent = 'In talks with one business. Apply and you are next in line.';
    fillSlots();
    var q = new URLSearchParams(location.search);
    var want = q.get('tier') || (q.get('slot') ? 'page' : '');
    if (q.get('slot') && S.slots.some(function (s) { return s.id === q.get('slot'); })) $('sa-slot').value = q.get('slot');
    var radio = form.querySelector('input[name=tier][value="' + (want || 'page') + '"]');
    if (radio) radio.checked = true;
    sync();
  });

  function fillSlots() {
    var sel = $('sa-slot'), groups = { tools: [], rent: [] };
    S.slots.forEach(function (s) { (s.page.indexOf('/rent/') === 0 ? groups.rent : groups.tools).push(s); });
    var html = '';
    [['tools', 'Tools and markets'], ['rent', 'Cash rent by state']].forEach(function (g) {
      if (!groups[g[0]].length) return;
      html += '<optgroup label="' + g[1] + '">';
      groups[g[0]].forEach(function (s) {
        var t = S.taken[s.id];
        html += '<option value="' + s.id + '"' + (t ? ' disabled' : '') + '>' +
          s.name.replace(/[<&]/g, '') + ' (' + s.page + ')' + (t ? ' · taken' : '') + '</option>';
      });
      html += '</optgroup>';
    });
    sel.innerHTML = html;
    var first = sel.querySelector('option:not([disabled])');
    if (first && (!sel.value || S.taken[sel.value])) sel.value = first.value;
  }

  function slotInfo() { var id = $('sa-slot').value; return S.slots.filter(function (s) { return s.id === id; })[0]; }

  function sync() {
    var t = tier();
    $('sa-page-row').hidden = t !== 'page';
    $('sa-head-row').hidden = t === 'supporter';
    $('sa-body-row').hidden = t === 'supporter';
    var si = slotInfo();
    $('sa-slot-pitch').textContent = (t === 'page' && si) ? si.pitch : '';
    var p = price(t) || 'the monthly price above';
    $('sa-terms-text').textContent = 'I understand: the first month is free, then an invoice each month for ' + p +
      ', month to month. I can cancel any time by replying to any AGSIST email. Sig reviews every ad and can decline one.';
    $('sa-insurance').hidden = !/insur/i.test(val('sa-company') + ' ' + val('sa-headline') + ' ' + val('sa-body'));
    ['sa-headline', 'sa-body'].forEach(function (id) {
      var el = $(id), c = form.querySelector('[data-for="' + id + '"]');
      if (c) { c.textContent = el.value.length + ' / ' + el.maxLength; c.classList.toggle('over', el.value.length > el.maxLength - 10); }
    });
    preview();
  }

  function preview() {
    var box = $('sa-preview'), t = tier(), slots = window.AgsistSlots;
    var company = val('sa-company') || 'Your business', link = val('sa-url') || 'https://example.com';
    if (!/^https?:\/\//i.test(link)) link = 'https://' + link;
    if (!slots) { box.innerHTML = '<p class="sa-small">Preview loads with the page.</p>'; return; }
    if (t === 'page') {
      box.innerHTML = '<aside class="ag-sponsor-ribbon ag-sponsor-ribbon--sold">' + slots.ribbon({
        company: company, headline: val('sa-headline') || 'Your headline here', body: val('sa-body'),
        url: link, logo: S.logo }, $('sa-slot').value || 'page') + '</aside>';
      $('sa-preview-lbl').textContent = 'On ' + ((slotInfo() || {}).page || 'the page') + ', in place of the "Sponsor this page" ribbon:';
    } else if (t === 'supporter') {
      box.innerHTML = '<div class="adspace-row sa-preview-foot"><a class="ad-slot ad-slot--filled" href="#" onclick="return false">' +
        slots.supporter({ name: company, logo: S.logo }) + '</a></div>';
      $('sa-preview-lbl').textContent = 'In the footer of every page:';
    } else {
      box.innerHTML = '<p class="sa-small">The sponsor card runs in every briefing and at the top of the homepage. Sig builds it with you from what you send here, and you approve the final version before it runs.</p>';
      $('sa-preview-lbl').textContent = 'Sponsor card:';
    }
  }

  $('sa-logo').addEventListener('change', function () {
    var f = this.files && this.files[0];
    S.logo = '';
    msg('');
    if (!f) { sync(); return; }
    if (!/^image\/(png|jpeg|webp)$/.test(f.type)) { this.value = ''; msg('The logo must be a PNG, JPG or WebP image.', true); sync(); return; }
    if (f.size > MAX_LOGO) { this.value = ''; msg('That logo is ' + Math.round(f.size / 1024) + ' KB. Please use one under 250 KB.', true); sync(); return; }
    var rd = new FileReader();
    rd.onload = function () { S.logo = String(rd.result || ''); sync(); };
    rd.readAsDataURL(f);
  });
  form.addEventListener('input', sync);
  form.addEventListener('change', function (e) { if (e.target.id !== 'sa-logo') sync(); });

  function msg(t, err) { var m = $('sa-msg'); m.textContent = t; m.className = 'sa-msg' + (err ? ' err' : ''); }

  function fallbackMail(p) {
    var lines = ['Placement: ' + p.tier + (p.tier === 'page' ? ' (' + p.slot + ')' : ''), 'Business: ' + p.company, 'Website: ' + p.url,
      'Headline: ' + (p.headline || ''), 'Copy: ' + (p.body || ''), 'Contact: ' + p.contact, 'Phone: ' + (p.phone || ''), 'Email: ' + p.email,
      '', '(Logo: I will attach it to this email.)'];
    return 'mailto:sig@farmers1st.com?subject=' + encodeURIComponent('AGSIST ad: ' + p.company) +
      '&body=' + encodeURIComponent(lines.join('\n'));
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var t = tier();
    var p = { tier: t, slot: t === 'page' ? $('sa-slot').value : '', company: val('sa-company'), url: val('sa-url'),
      headline: t === 'supporter' ? '' : val('sa-headline'), body: t === 'supporter' ? '' : val('sa-body'),
      contact: val('sa-contact'), phone: val('sa-phone'), email: val('sa-email'), logo: S.logo,
      terms: $('sa-terms').checked, _gotcha: (form.querySelector('[name=_gotcha]') || {}).value || '' };
    var miss = [];
    if (!t) miss.push('a placement');
    if (t === 'page' && (!p.slot || S.taken[p.slot])) miss.push('an open page');
    if (p.company.length < 2) miss.push('your business name');
    if (!p.url) miss.push('your website');
    if (t !== 'supporter' && p.headline.length < 3) miss.push('a headline');
    if (!p.contact) miss.push('your name');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(p.email)) miss.push('a working email');
    if (!p.terms) miss.push('a tick in the terms box');
    if (miss.length) { msg('Almost there. Please add ' + miss.join(', ') + '.', true); return; }
    var go = $('sa-go');
    go.disabled = true; msg('Sending…');
    fetch(WORKER + '/sponsor-apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) })
      .then(function (r) { return r.json().catch(function () { return { ok: false, http: r.status }; }).then(function (j) { j.http = r.status; return j; }); })
      .then(function (j) {
        if (j && j.ok === true) {
          form.hidden = true; $('sa-done-email').textContent = p.email; $('sa-done').hidden = false;
          try { if (typeof gtag === 'function') gtag('event', 'sponsor_apply', { tier: t, slot: p.slot || t }); } catch (x) {}
          window.scrollTo({ top: 0, behavior: 'smooth' });
          return;
        }
        if (j && j.error && j.http !== 404) { go.disabled = false; msg(j.error.charAt(0).toUpperCase() + j.error.slice(1) + '.', true); return; }
        throw 0;
      })
      .catch(function () {
        go.disabled = false;
        var m = $('sa-msg');
        m.className = 'sa-msg err';
        m.innerHTML = 'The form could not reach our server just now. Nothing is lost: <a href="' +
          fallbackMail(p).replace(/"/g, '&quot;') + '">send these details to Sig by email</a> instead, or call 715-797-2428.';
      });
  });
})();
