/* The booking page (/sponsor), Nov 11, 2026: two spots, one business in each.
 *
 * Everything a buyer sees here is read, not typed:
 *   prices, terms, card links   data/rate-card.json (pay_links: an empty link means card payment
 *                               is not open yet; the button says so and the invoice path still works)
 *   numbers                     data/sponsor-spots.json (engaged visits and page views, 28 days)
 *   sitewide taken              data/sponsor.json (the sitewide sponsor, active)
 *   states taken                data/geo-sponsors.json (a live entry for that state)
 *
 * The form ("Mail me a yearly invoice") goes to the subs worker (/sponsor-apply), which stores
 * tier page|daily: the Sitewide Sponsor travels as tier "daily", a State Sponsor as tier "page"
 * with the slot state-<xx> (scripts/sponsor_apply.py card_tier reads both back). Nothing
 * is published from here: the applicant confirms by email, every ad is checked by hand, and it
 * goes live within one business day. If the worker cannot take it, the form offers the same
 * details as an email instead of losing them.
 *
 * ?sponsor-preview=1 shows the sitewide spot as taken (a picture of a sold spot) and sends nothing.
 */
(function () {
  'use strict';
  var WORKER = 'https://agsist-api.dnilgis.workers.dev';
  var $ = function (id) { return document.getElementById(id); };
  var form = $('spa-form');
  if (!form) return;
  var SLUGS = 'alabama:AL alaska:AK arizona:AZ arkansas:AR california:CA colorado:CO connecticut:CT delaware:DE florida:FL georgia:GA hawaii:HI idaho:ID illinois:IL indiana:IN iowa:IA kansas:KS kentucky:KY louisiana:LA maine:ME maryland:MD massachusetts:MA michigan:MI minnesota:MN mississippi:MS missouri:MO montana:MT nebraska:NE nevada:NV new-hampshire:NH new-jersey:NJ new-mexico:NM new-york:NY north-carolina:NC north-dakota:ND ohio:OH oklahoma:OK oregon:OR pennsylvania:PA rhode-island:RI south-carolina:SC south-dakota:SD tennessee:TN texas:TX utah:UT vermont:VT virginia:VA washington:WA west-virginia:WV wisconsin:WI wyoming:WY';
  var STATES = SLUGS.split(' ').map(function (p) {
    var kv = p.split(':');
    return { code: kv[1], slug: kv[0], name: kv[0].split('-').map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(' ') };
  }).sort(function (a, b) { return a.name < b.name ? -1 : 1; });
  var S = { card: null, spots: null, swTaken: false, taken: {} };
  var preview = /[?&]sponsor-preview=1(?:&|$)/.test(location.search);

  function get(u) { return fetch(u, { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw 0; return r.json(); }).catch(function () { return null; }); }
  function tier(id) { return S.card && (S.card.tiers || []).filter(function (t) { return t.id === id; })[0]; }
  function months() { return (S.card && S.card.year_months) || 10; }
  function n(x) { return Number(x).toLocaleString('en-US'); }
  function byCode(c) { return STATES.filter(function (s) { return s.code === c; })[0]; }
  function statePrice(c) { var t = tier('state'); return t ? ((t.price_by_state && t.price_by_state[c]) || t.price_month) : 0; }
  function big(c) { var t = tier('state'); return !!(t && t.price_by_state && t.price_by_state[c]); }
  function soon(c) { var t = tier('state'); return !!(t && (t.opens_soon || []).indexOf(c) >= 0); }
  function stateOpen(c) { return !!c && !soon(c) && !S.taken[c]; }
  function val(id) { return ($(id).value || '').trim(); }
  function today() {
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date()); }
    catch (e) { return new Date().toISOString().slice(0, 10); }
  }
  /* a card payment link from the rate card, or '' while card payment is not open */
  function payLink(spot, c) {
    var l = (S.card && S.card.pay_links && S.card.pay_links[spot]) || {};
    var k = spot === 'state' && big(c) ? 'big_' : '';
    var u = l[k + 'month'] || l[k + 'year'] || '';
    return /^https:\/\/(buy\.stripe\.com|checkout\.stripe\.com)\/[^\s"'<>]+$/.test(u) ? u : '';
  }

  function fillSelect(sel, withBlank) {
    var html = withBlank ? '<option value="">Pick a state</option>' : '';
    STATES.forEach(function (s) {
      var p = statePrice(s.code);
      var note = soon(s.code) ? 'opens soon' : S.taken[s.code] ? 'taken' : (p ? '$' + p + ' a month' : '');
      html += '<option value="' + s.code + '"' + (soon(s.code) || S.taken[s.code] ? (withBlank ? '' : ' disabled') : '') + '>' +
        s.name + (note ? ' · ' + note : '') + '</option>';
    });
    sel.innerHTML = html;
  }

  function stateLine(c) {
    var s = byCode(c), el = $('sp-state-live');
    if (!s) { el.textContent = 'Pick a state to see its numbers and price.'; return; }
    var e = (S.spots && S.spots.states && S.spots.states[c]) || {};
    var nums = '';
    if (typeof e.engaged === 'number' && e.engaged > 0 && typeof e.views === 'number' && e.views > 0)
      nums = n(e.engaged) + ' engaged visits from ' + s.name + ' and ' + n(e.views) + ' views of ' + s.name + ' pages in the last 28 days. ';
    else if (typeof e.engaged === 'number' && e.engaged > 0) nums = n(e.engaged) + ' engaged visits from ' + s.name + ' in the last 28 days. ';
    else if (typeof e.views === 'number' && e.views > 0) nums = n(e.views) + ' views of ' + s.name + ' pages in the last 28 days. ';
    var p = statePrice(c);
    el.innerHTML = '<b>' + s.name + ':</b> ' + nums +
      (soon(c) ? 'This state opens soon.' : S.taken[c] ? 'Taken right now.' : p ? '$' + n(p) + ' a month or $' + n(p * months()) + ' a year.' : '');
  }

  function setButtons(spot, open, c) {
    var box = document.querySelector('[data-btns="' + spot + '"]'), st = document.querySelector('[data-status="' + spot + '"]');
    if (!box) return;
    box.hidden = !open;
    if (st) {
      st.hidden = open;
      st.innerHTML = open ? '' : spot === 'sitewide'
        ? 'Taken right now. <a href="mailto:sig@agsist.com?subject=AGSIST%20sitewide%20spot">Ask to be next.</a>'
        : (c && soon(c) ? 'This state opens soon.' : 'Taken right now.') + ' <a href="mailto:sig@agsist.com?subject=AGSIST%20state%20spot">Ask to be next.</a>';
    }
    var pay = box.querySelector('[data-pay]'), link = payLink(spot, c);
    if (spot === 'state' && !c) link = '';
    if (link) {
      pay.href = link; pay.removeAttribute('aria-disabled'); pay.textContent = 'Pay by card';
      pay.target = '_blank'; pay.rel = 'noopener';
    } else {
      pay.href = '#book'; pay.setAttribute('aria-disabled', 'true'); pay.textContent = 'Card payment opens soon';
      pay.removeAttribute('target'); pay.removeAttribute('rel');
    }
  }

  function syncState() {
    var c = $('sp-state').value;
    stateLine(c);
    setButtons('state', !c || stateOpen(c), c);
  }

  function pick(spot, c) {
    var r = form.querySelector('input[name=tier][value="' + spot + '"]');
    if (r) r.checked = true;
    if (c && stateOpen(c)) $('spa-state').value = c;
    syncForm();
  }

  function syncForm() {
    var t = (form.querySelector('input[name=tier]:checked') || {}).value;
    $('spa-state-row').hidden = t !== 'state';
  }

  Promise.all([get('/data/rate-card.json'), get('/data/sponsor-spots.json'), get('/data/sponsor.json'), get('/data/geo-sponsors.json')]).then(function (r) {
    S.card = r[0]; S.spots = r[1];
    var sp = r[2];
    S.swTaken = preview || !!(sp && sp.active === true && !sp.is_house_ad && sp.advertiser);
    var day = today();
    ((r[3] && r[3].sponsors) || []).forEach(function (e) {
      if (!e || e.active !== true || !Array.isArray(e.states)) return;
      if (e.start && e.start > day) return;
      if (e.end && e.end < day) return;
      e.states.forEach(function (c) { S.taken[c] = true; });
    });
    fillSelect($('sp-state'), true);
    fillSelect($('spa-state'), false);
    var q = new URLSearchParams(location.search);
    var want = String(q.get('state') || '').toUpperCase();
    var slot = q.get('slot') || '';
    var m = /^(?:cash-bids|rent)-([a-z-]+)$/.exec(slot);
    if (!byCode(want) && m) { var bs = STATES.filter(function (s) { return s.slug === m[1] || s.code.toLowerCase() === m[1]; })[0]; if (bs) want = bs.code; }
    if (byCode(want)) $('sp-state').value = want;
    var first = $('spa-state').querySelector('option:not([disabled])');
    if (first) $('spa-state').value = first.value;
    setButtons('sitewide', !S.swTaken, '');
    syncState();
    var t = q.get('tier');
    if (t === 'sitewide' || t === 'daily') pick('sitewide');
    else pick('state', byCode(want) ? want : '');
    if (S.swTaken) { var sr = form.querySelector('input[name=tier][value="sitewide"]'); if (sr) { sr.disabled = true; if (sr.checked) pick('state'); } }
  });

  $('sp-state').addEventListener('change', syncState);
  form.addEventListener('change', syncForm);
  [].forEach.call(document.querySelectorAll('[data-invoice]'), function (a) {
    a.addEventListener('click', function () {
      var spot = a.getAttribute('data-invoice');
      pick(spot, spot === 'state' ? $('sp-state').value : '');
      var pr = form.querySelector('input[name=pay][value="invoice"]');
      if (pr) pr.checked = true;
    });
  });
  [].forEach.call(document.querySelectorAll('[data-pay]'), function (a) {
    a.addEventListener('click', function (e) {
      if (a.getAttribute('aria-disabled') === 'true') {
        e.preventDefault();
        var spot = a.getAttribute('data-pay');
        pick(spot, spot === 'state' ? $('sp-state').value : '');
        msg('Card payment opens soon. Send this form for a yearly invoice by mail.');
        $('book').scrollIntoView({ behavior: 'smooth' });
      } else {
        try { if (typeof gtag === 'function') gtag('event', 'sponsor_pay_click', { spot: a.getAttribute('data-pay') }); } catch (x) {}
      }
    });
  });

  function msg(t, err) { var m = $('spa-msg'); m.textContent = t; m.className = 'sp-msg full' + (err ? ' err' : ''); }

  function fallbackMail(p, what) {
    var lines = ['Spot: ' + what, 'How I pay: ' + p.pay, 'Business: ' + p.company, 'Link: ' + p.url, 'Ad line: ' + p.headline,
      'Name: ' + p.contact, 'Phone: ' + (p.phone || ''), 'Email: ' + p.email];
    return 'mailto:sig@agsist.com?subject=' + encodeURIComponent('AGSIST sponsor spot: ' + p.company) +
      '&body=' + encodeURIComponent(lines.join('\n'));
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var t = (form.querySelector('input[name=tier]:checked') || {}).value || '';
    var c = t === 'state' ? $('spa-state').value : '';
    var s = byCode(c);
    var pay = (form.querySelector('input[name=pay]:checked') || {}).value === 'card' ? 'paid by card' : 'yearly invoice by mail';
    var p = { tier: t === 'sitewide' ? 'daily' : 'page', slot: t === 'state' && s ? 'state-' + s.code.toLowerCase() : '',
      company: val('spa-company'), url: val('spa-url'), headline: val('spa-headline'), body: 'How I pay: ' + pay,
      contact: val('spa-contact'), phone: val('spa-phone'), email: val('spa-email'), logo: '',
      terms: $('spa-terms').checked, _gotcha: (form.querySelector('[name=_gotcha]') || {}).value || '', pay: pay };
    var miss = [];
    if (t !== 'sitewide' && t !== 'state') miss.push('a spot');
    if (t === 'sitewide' && S.swTaken) miss.push('a spot that is open');
    if (t === 'state' && !stateOpen(c)) miss.push('an open state');
    if (p.company.length < 2) miss.push('your business name');
    if (!p.contact) miss.push('your name');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(p.email)) miss.push('a working email');
    if (p.headline.length < 3) miss.push('an ad line');
    if (!p.url) miss.push('your link');
    if (!p.terms) miss.push('a tick in the box');
    if (miss.length) { msg('Almost there. Please add ' + miss.join(', ') + '.', true); return; }
    if (preview) { msg('Preview: nothing was sent.'); return; }
    var what = t === 'sitewide' ? 'Sitewide Sponsor' : 'State Sponsor, ' + (s ? s.name : '');
    var go = $('spa-go');
    go.disabled = true; msg('Sending...');
    var body = {}; for (var k in p) if (k !== 'pay') body[k] = p[k];
    fetch(WORKER + '/sponsor-apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return { ok: false, http: r.status }; }).then(function (j) { j.http = r.status; return j; }); })
      .then(function (j) {
        if (j && j.ok === true) {
          form.hidden = true; $('spa-done-email').textContent = p.email; $('spa-done').hidden = false;
          try { if (typeof gtag === 'function') gtag('event', 'sponsor_apply', { tier: t, slot: p.slot || t }); } catch (x) {}
          $('book').scrollIntoView({ behavior: 'smooth' });
          return;
        }
        if (j && j.error && j.http !== 404) { go.disabled = false; msg(j.error.charAt(0).toUpperCase() + j.error.slice(1) + '.', true); return; }
        throw 0;
      })
      .catch(function () {
        go.disabled = false;
        var m = $('spa-msg');
        m.className = 'sp-msg full err';
        m.innerHTML = 'The form could not reach our server just now. Nothing is lost: <a href="' +
          fallbackMail(p, what).replace(/"/g, '&quot;') + '">send these details by email</a> instead, or call 715-797-2428.';
      });
  });
})();
