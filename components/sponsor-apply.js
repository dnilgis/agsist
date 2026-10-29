/* Self-serve sponsor sign-up (sponsor-apply.html), 2026-10-07; the rate card of Oct 29, 2026.
 *
 * Everything a buyer sees here is read, not typed:
 *   prices          data/rate-card.json (the one rate card; a State Sponsor's price by state)
 *   states offered  data/sponsor-slots.json (scripts/stamp_rates.py reads the ribbons; tier "state")
 *   slots taken     data/page-sponsors.json (sold ribbons)
 *   Daily slot      data/sponsors.json (a Daily Sponsor deal on file means it is spoken for)
 *   town pages      data/state-basis/<ST>.json (the town pages with a current bid), for a Featured elevator
 * The preview is drawn by window.AgsistSlots in components/loader.js, the same
 * code that draws a sold ribbon on the live site.
 *
 * The application goes to the subs worker (/sponsor-apply), which stores tier
 * page|daily. The new tiers travel as tier "page" with a slot that names them
 * (scripts/sponsor_apply.py card_tier reads it back):
 *   State Sponsor      slot = one of the state's ribbons (cash-bids-<state> or rent-xx)
 *   Cash Bids Sponsor  slot = cash-bids
 *   Featured elevator  slot = fe-<st>-<town>   (the town page /cash-bids/<state>/<town>)
 * Nothing is published from here: the applicant confirms by email, Sig approves,
 * and scripts/sponsor_apply.py puts it live. If the worker cannot take it, the
 * form hands the same details to an email to Sig instead of losing them.
 */
(function () {
  'use strict';
  var WORKER = 'https://agsist-api.dnilgis.workers.dev';
  var MAX_LOGO = 250 * 1024;
  var $ = function (id) { return document.getElementById(id); };
  var form = $('spa-form');
  if (!form) return;
  var S = { card: null, slots: [], taken: {}, fndReserved: false, logo: '', states: [], towns: {} };

  function get(u) { return fetch(u, { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw 0; return r.json(); }).catch(function () { return null; }); }
  function tier() { var c = form.querySelector('input[name=tier]:checked'); return c ? c.value : ''; }
  function card(t) { return S.card && (S.card.tiers || []).filter(function (z) { return z.id === t; })[0]; }
  function soon(code) { var c = card('state'); return !!(c && (c.opens_soon || []).indexOf(code) >= 0); }
  function priceNum(t, code) {
    var x = card(t);
    if (!x) return 0;
    return (code && x.price_by_state && x.price_by_state[code]) || x.price_month;
  }
  function price(t, code) { var p = priceNum(t, code); return p ? '$' + p + '/mo' : ''; }
  function val(id) { return ($(id).value || '').trim(); }
  function esc(s) { return String(s).replace(/[<&>"]/g, function (c) { return { '<': '&lt;', '&': '&amp;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  Promise.all([get('/data/rate-card.json'), get('/data/sponsor-slots.json'), get('/data/page-sponsors.json'),
               get('/data/sponsors.json')]).then(function (r) {
    S.card = r[0];
    S.slots = (r[1] && r[1].slots) || [];
    var sold = (r[2] && r[2].slots) || {};
    Object.keys(sold).forEach(function (k) { if (sold[k] && sold[k].active !== false) S.taken[k] = true; });
    S.fndReserved = !!(r[3] && (r[3].sponsors || []).some(function (s) {
      return s && s.active !== false && s.billing && s.billing.tier === 'daily';
    }));
    ['state', 'cashbids', 'elevator', 'daily'].forEach(function (t) {
      var el = form.querySelector('[data-price="' + t + '"]');
      var lo = priceNum(t), hi = lo;
      var c = card(t);
      if (c && c.price_by_state) Object.keys(c.price_by_state).forEach(function (k) { hi = Math.max(hi, c.price_by_state[k]); });
      if (el) el.innerHTML = lo ? (hi > lo ? '$' + lo + ' to $' + hi + '/mo' : '$' + lo + '/mo') + ' &middot; first month free' : '-';
    });
    if (S.fndReserved) $('spa-fnd-note').textContent = 'In talks with one business. Apply and you are next in line.';
    if (S.taken['cash-bids']) $('spa-cb-note').textContent = 'Taken. Apply and you are next in line.';
    buildStates();
    fillStates();
    fillElevStates();
    var q = new URLSearchParams(location.search);
    var slot = q.get('slot') || '', want = q.get('tier') || '';
    var se = S.slots.filter(function (s) { return s.id === slot; })[0];
    /* an older link (tier=page or tier=supporter) lands on the tier its slot is sold under now */
    if (!card(want)) want = se && se.tier ? se.tier : 'state';
    /* a link to a held or taken state does not pick it: the first open state stays chosen */
    if (want === 'state' && se && se.state && stateOf(se.state) && !soon(se.state) && !stateTaken(stateOf(se.state))) $('spa-state').value = se.state;
    var radio = form.querySelector('input[name=tier][value="' + want + '"]');
    if (radio) radio.checked = true;
    loadTowns();
    sync();
  });

  /* One entry per state that has a State Sponsor ribbon: its code, its name and its ribbons. */
  function buildStates() {
    var by = {};
    S.slots.forEach(function (s) {
      if (s.tier !== 'state' || !s.state) return;
      var e = by[s.state] || (by[s.state] = { code: s.state, name: '', ids: [], bids: '' });
      e.ids.push(s.id);
      var m = /^\/cash-bids\/([a-z-]+)$/.exec(s.page || '');
      if (m) e.bids = m[1];
      if (!e.name) e.name = String(s.name || '').replace(/ cash (?:bids|rent)$/, '');
    });
    S.states = Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return a.name < b.name ? -1 : 1; });
  }
  function stateOf(code) { return S.states.filter(function (e) { return e.code === code; })[0]; }
  function stateTaken(e) { return e.ids.some(function (id) { return S.taken[id]; }); }

  function fillStates() {
    var sel = $('spa-state'), html = '';
    S.states.forEach(function (e) {
      var off = soon(e.code) || stateTaken(e);
      html += '<option value="' + e.code + '"' + (off ? ' disabled' : '') + '>' + esc(e.name) + ' &middot; ' +
        (soon(e.code) ? 'opens soon' : stateTaken(e) ? 'taken' : price('state', e.code)) + '</option>';
    });
    sel.innerHTML = html;
    var first = sel.querySelector('option:not([disabled])');
    if (first) sel.value = first.value;
  }

  function fillElevStates() {
    var sel = $('spa-elev-state'), html = '';
    S.states.forEach(function (e) { if (e.bids) html += '<option value="' + e.code + '">' + esc(e.name) + '</option>'; });
    sel.innerHTML = html;
  }

  /* The town pages with a current bid, from the same file the state's bid table reads. */
  function loadTowns() {
    var code = $('spa-elev-state').value, sel = $('spa-town');
    if (!code) return;
    if (S.towns[code]) { fillTowns(code); return; }
    sel.innerHTML = '<option value="">Loading town pages&hellip;</option>';
    get('/data/state-basis/' + code + '.json').then(function (d) {
      var seen = {}, list = [];
      ((d && d.rows) || []).forEach(function (r) {
        var town = r[2], path = r[3];
        if (path && /^\/cash-bids\/[a-z-]+\/[a-z0-9][a-z0-9-]*$/.test(path) && !seen[path]) { seen[path] = 1; list.push([town, path]); }
      });
      list.sort(function (a, b) { return a[0] < b[0] ? -1 : 1; });
      S.towns[code] = list;
      if ($('spa-elev-state').value === code) fillTowns(code);
    });
  }
  function fillTowns(code) {
    var sel = $('spa-town'), list = S.towns[code] || [];
    sel.innerHTML = list.length ? list.map(function (t) { return '<option value="' + esc(t[1]) + '">' + esc(t[0]) + '</option>'; }).join('')
      : '<option value="">No town pages loaded. Email Sig your town.</option>';
    $('spa-town-note').textContent = list.length ? 'Town pages with a current bid. Your box goes on your own town’s page.'
      : 'The town list did not load. Send the form anyway and name your town in the headline, or email Sig.';
    sync();
  }

  /* The slot the worker stores (see the top of this file). */
  function slotFor(t) {
    if (t === 'cashbids') return 'cash-bids';
    if (t === 'state') {
      var e = stateOf($('spa-state').value);
      if (!e) return '';
      return e.ids.filter(function (id) { return id.indexOf('cash-bids-') === 0; })[0] || e.ids[0];
    }
    if (t === 'elevator') {
      var code = $('spa-elev-state').value, path = $('spa-town').value || '';
      var m = /^\/cash-bids\/[a-z-]+\/([a-z0-9][a-z0-9-]{0,50})$/.exec(path);
      return code && m ? 'fe-' + code.toLowerCase() + '-' + m[1] : '';
    }
    return '';
  }
  function where(t) {
    if (t === 'state') { var e = stateOf($('spa-state').value); return e ? e.name : ''; }
    if (t === 'elevator') { var o = $('spa-town').selectedOptions && $('spa-town').selectedOptions[0]; return o && o.value ? o.textContent + ' (' + o.value + ')' : ''; }
    if (t === 'cashbids') return '/cash-bids';
    return '';
  }

  function sync() {
    var t = tier();
    $('spa-state-row').hidden = t !== 'state';
    $('spa-elev-row').hidden = t !== 'elevator';
    var c = card(t), code = t === 'state' ? $('spa-state').value : '';
    $('spa-state-pitch').textContent = (t === 'state' && c) ? c.placement : '';
    var p = price(t, code) || 'the monthly price above';
    $('spa-terms-text').textContent = 'I understand: the first month is free. On day 30 I get a report and a yes or no email; no reply means the ad comes down and nothing is owed. If I say yes, an invoice each month for ' + p +
      ', month to month. Sig reviews every ad and can decline one.';
    $('spa-insurance').hidden = !/insur/i.test(val('spa-company') + ' ' + val('spa-headline') + ' ' + val('spa-body'));
    ['spa-headline', 'spa-body'].forEach(function (id) {
      var el = $(id), n = form.querySelector('[data-for="' + id + '"]');
      if (n) { n.textContent = el.value.length + ' / ' + el.maxLength; n.classList.toggle('over', el.value.length > el.maxLength - 10); }
    });
    preview();
  }

  function preview() {
    var box = $('spa-preview'), t = tier(), slots = window.AgsistSlots;
    var company = val('spa-company') || 'Your business', link = val('spa-url') || 'https://example.com';
    if (!/^https?:\/\//i.test(link)) link = 'https://' + link;
    if (!slots) { box.innerHTML = '<p class="spa-small">Preview loads with the page.</p>'; return; }
    if (t === 'state' || t === 'cashbids') {
      box.innerHTML = '<aside class="ag-sponsor-ribbon ag-sponsor-ribbon--sold">' + slots.ribbon({
        company: company, headline: val('spa-headline') || 'Your headline here', body: val('spa-body'),
        url: link, logo: S.logo }, slotFor(t) || 'page') + '</aside>';
      $('spa-preview-lbl').textContent = t === 'cashbids' ? 'On Cash Bids near me, in place of the "Sponsor this page" line:'
        : 'On the ' + (where('state') || 'state') + ' cash bids page, its town pages and its cash rent page:';
    } else if (t === 'elevator') {
      box.innerHTML = '<p class="spa-small">Sig builds your box with you from what you send here: your logo, phone and a &ldquo;call to sell&rdquo; line on your town page, labeled Sponsored. It never changes bid order or any bid. You approve it before it runs.</p>';
      $('spa-preview-lbl').textContent = 'Featured elevator' + (where('elevator') ? ': ' + where('elevator') : '') + ':';
    } else {
      box.innerHTML = '<p class="spa-small">The Daily Sponsor card runs in every briefing and at the top of the homepage. Sig builds it with you from what you send here, and you approve the final version before it runs.</p>';
      $('spa-preview-lbl').textContent = 'Daily Sponsor card:';
    }
  }

  $('spa-logo').addEventListener('change', function () {
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
  form.addEventListener('change', function (e) {
    if (e.target.id === 'spa-elev-state') { loadTowns(); return; }
    if (e.target.id !== 'spa-logo') sync();
  });

  function msg(t, err) { var m = $('spa-msg'); m.textContent = t; m.className = 'spa-msg' + (err ? ' err' : ''); }

  function fallbackMail(p, t) {
    var c = card(t);
    var lines = ['Placement: ' + (c ? c.name : t) + (where(t) ? ' (' + where(t) + ')' : ''), 'Business: ' + p.company, 'Website: ' + p.url,
      'Headline: ' + (p.headline || ''), 'Copy: ' + (p.body || ''), 'Contact: ' + p.contact, 'Phone: ' + (p.phone || ''), 'Email: ' + p.email,
      '', '(Logo: I will attach it to this email.)'];
    return 'mailto:sig@agsist.com?subject=' + encodeURIComponent('AGSIST ad: ' + p.company) +
      '&body=' + encodeURIComponent(lines.join('\n'));
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var t = tier(), slot = slotFor(t);
    var p = { tier: t === 'daily' ? 'daily' : 'page', slot: t === 'daily' ? '' : slot, company: val('spa-company'), url: val('spa-url'),
      headline: val('spa-headline'), body: val('spa-body'),
      contact: val('spa-contact'), phone: val('spa-phone'), email: val('spa-email'), logo: S.logo,
      terms: $('spa-terms').checked, _gotcha: (form.querySelector('[name=_gotcha]') || {}).value || '' };
    var miss = [];
    if (!t || !card(t)) miss.push('a placement');
    if (t === 'state') { var se = stateOf($('spa-state').value); if (!se || soon(se.code) || stateTaken(se)) miss.push('an open state'); }
    if (t === 'cashbids' && S.taken['cash-bids']) miss.push('a placement that is open');
    if (t === 'elevator' && !slot) miss.push('your town page');
    if (p.company.length < 2) miss.push('your business name');
    if (!p.url) miss.push('your website');
    if (p.headline.length < 3) miss.push('a headline');
    if (!p.contact) miss.push('your name');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(p.email)) miss.push('a working email');
    if (!p.terms) miss.push('a tick in the terms box');
    if (miss.length) { msg('Almost there. Please add ' + miss.join(', ') + '.', true); return; }
    var go = $('spa-go');
    go.disabled = true; msg('Sending…');
    fetch(WORKER + '/sponsor-apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) })
      .then(function (r) { return r.json().catch(function () { return { ok: false, http: r.status }; }).then(function (j) { j.http = r.status; return j; }); })
      .then(function (j) {
        if (j && j.ok === true) {
          form.hidden = true; $('spa-done-email').textContent = p.email; $('spa-done').hidden = false;
          try { if (typeof gtag === 'function') gtag('event', 'sponsor_apply', { tier: t, slot: p.slot || t }); } catch (x) {}
          window.scrollTo({ top: 0, behavior: 'smooth' });
          return;
        }
        if (j && j.error && j.http !== 404) { go.disabled = false; msg(j.error.charAt(0).toUpperCase() + j.error.slice(1) + '.', true); return; }
        throw 0;
      })
      .catch(function () {
        go.disabled = false;
        var m = $('spa-msg');
        m.className = 'spa-msg err';
        m.innerHTML = 'The form could not reach our server just now. Nothing is lost: <a href="' +
          fallbackMail(p, t).replace(/"/g, '&quot;') + '">send these details to Sig by email</a> instead, or call 715-797-2428.';
      });
  });
})();
