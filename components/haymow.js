/* The hay board (haymow.html, The Haymow): hay and forage for sale or wanted, posted
 * by readers so buyers and sellers call each other. AGSIST takes no cut,
 * routes nothing and ranks nothing by payment: the list is nearest first.
 *
 * Talks to the subs worker (workers/subs-worker.js v5.30):
 *   GET  /hay/feed        public posts, never a phone or an email
 *   POST /hay/contact     one post's contact, when a reader taps Show contact
 *   POST /hay/post        a new post -> {id, key}; the key is the poster's
 *                         private edit link, kept in this browser too
 *   POST /hay/mine, /hay/edit, /hay/renew, /hay/delete   with id and key
 *   POST /hay/report      3 reports from different people hide a post
 *
 * The pure helpers at the top are exported for node tests
 * (test/haymow.test.mjs); the page code runs only in a browser.
 */
(function () {
  'use strict';
  var WORKER = 'https://agsist-subs.dnilgis.workers.dev';
  var ZIPS = 'https://dnilgis.github.io/bids/data/zips/';
  var MINE_KEY = 'agsist-hay-mine';

  var PRODUCTS = { alfalfa: 'Alfalfa', grass: 'Grass hay', mixed: 'Mixed hay', straw: 'Straw', 'corn-stalks': 'Corn stalks', baleage: 'Baleage or haylage', other: 'Other forage' };
  var BALES = { 'small-square': 'small squares', 'large-square': 'large squares', round: 'round bales', wrapped: 'wrapped bales', bulk: 'bulk' };
  var CUT = { '1': '1st cutting', '2': '2nd cutting', '3': '3rd cutting', '4': '4th cutting or later' };
  var LINK_RE = /(https?:|ftp:|www\.|\b[a-z0-9-]+\s?\.\s?(com|net|org|biz|info|io|co|us|xyz|ly|me|site|online|shop|app|link|top)\b)/i;
  var PHONE_IN = /(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/;
  var EMAIL_IN = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function distMi(aLat, aLng, bLat, bLng) {
    var r = Math.PI / 180, dLat = (bLat - aLat) * r, dLng = (bLng - aLng) * r;
    var h = Math.pow(Math.sin(dLat / 2), 2) + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.pow(Math.sin(dLng / 2), 2);
    return 3958.8 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function money(v) {
    var d = Math.round(v * 100) / 100;
    return '$' + (d % 1 ? d.toFixed(2) : String(d)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function comma(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  // Price per ton. A per-bale price converts only when the poster gave a bale
  // weight, and the math is spelled out. -> {ton, perBale, math} or null
  function perTon(price, unit, weight) {
    if (!(price > 0)) return null;
    if (unit === 'ton') {
      return { ton: price, perBale: weight > 0 ? Math.round(price * weight / 2000 * 100) / 100 : null,
        math: weight > 0 ? money(price) + ' a ton x ' + comma(weight) + ' lb / 2,000' : '' };
    }
    if (unit === 'bale' && weight > 0) {
      return { ton: Math.round(price * 2000 / weight * 100) / 100, perBale: price,
        math: money(price) + ' a bale x 2,000 / ' + comma(weight) + ' lb' };
    }
    return null;
  }
  // Nearest first when we know where the reader is; a post with no pin goes
  // last; ties and the no-location case go newest first.
  function sortRows(rows, here) {
    var out = rows.map(function (r) {
      var mi = here && r.lat != null && r.lng != null ? Math.round(distMi(here.lat, here.lng, r.lat, r.lng)) : null;
      return Object.assign({}, r, { mi: mi });
    });
    out.sort(function (a, b) {
      if (here) {
        if ((a.mi == null) !== (b.mi == null)) return a.mi == null ? 1 : -1;
        if (a.mi !== b.mi) return a.mi - b.mi;
      }
      return (b.ts || 0) - (a.ts || 0);
    });
    return out;
  }
  function filterRows(rows, kind, mi) {
    return rows.filter(function (r) {
      if (kind && kind !== 'both' && r.kind !== kind) return false;
      if (mi > 0 && r.mi != null && r.mi > mi) return false;
      if (mi > 0 && r.mi == null) return false;
      return true;
    });
  }
  function num(v) {
    var s = String(v == null ? '' : v).replace(/[$,\s]/g, '');
    if (s === '') return null;
    var x = Number(s);
    return isFinite(x) ? x : NaN;
  }
  // The form, checked the way the worker checks it. f is a plain object of
  // the form's values. -> {errors: {field: message}, body}
  function validatePost(f) {
    var e = {}, b = {};
    b.kind = f.kind === 'wanted' ? 'wanted' : (f.kind === 'sale' ? 'sale' : '');
    if (!b.kind) e.kind = 'Pick for sale or wanted.';
    b.zip = String(f.zip || '').replace(/\D/g, '');
    if (!/^\d{5}$/.test(b.zip)) e.zip = 'Enter a 5-digit ZIP.';
    b.product = PRODUCTS[f.product] ? f.product : '';
    if (!b.product) e.product = 'Pick what it is.';
    b.cutting = CUT[f.cutting] ? f.cutting : '';
    b.bale = BALES[f.bale] ? f.bale : '';
    if (b.kind === 'sale' && !b.bale) e.bale = 'Pick the bale type.';
    var c = num(f.count);
    if (c === null) { if (b.kind === 'sale') e.count = 'How many?'; }
    else if (!(c >= 1 && c <= 100000) || Math.round(c) !== c) e.count = 'A whole number, 1 to 100,000.';
    b.count = c;
    var p = num(f.price);
    if (p !== null && !(p > 0 && p <= 5000)) e.price = 'A price from $0.01 to $5,000.';
    b.price = p;
    b.unit = p !== null ? (f.unit === 'ton' ? 'ton' : (f.unit === 'bale' ? 'bale' : '')) : '';
    if (p !== null && !b.unit) e.unit = 'Per bale or per ton?';
    var wt = num(f.weight);
    if (wt !== null && !(wt >= 20 && wt <= 3000)) e.weight = 'Pounds, 20 to 3,000.';
    b.weight = wt;
    var rfv = num(f.rfv), rfq = num(f.rfq), cp = num(f.cp);
    if (rfv !== null && !(rfv >= 1 && rfv <= 400)) e.rfv = '1 to 400.';
    if (rfq !== null && !(rfq >= 1 && rfq <= 400)) e.rfq = '1 to 400.';
    if (cp !== null && !(cp > 0 && cp <= 40)) e.cp = 'Percent, up to 40.';
    b.rfv = rfv; b.rfq = rfq; b.cp = cp;
    if (f.delivery === 'yes') {
      var dm = num(f.miles);
      if (dm === null) b.delivery = 'yes';
      else if (dm >= 1 && dm <= 1000) b.delivery = Math.round(dm);
      else e.miles = 'Miles, 1 to 1,000.';
    } else b.delivery = 'no';
    b.note = String(f.note || '').replace(/\s+/g, ' ').trim();
    if (b.note.length > 300) e.note = '300 letters at most.';
    else if (LINK_RE.test(b.note)) e.note = 'No links, please.';
    else if (PHONE_IN.test(b.note) || EMAIL_IN.test(b.note)) e.note = 'Put your phone or email in the boxes below, not the note.';
    b.name = String(f.name || '').replace(/\s+/g, ' ').trim();
    if (b.name.length > 60) e.name = '60 letters at most.';
    else if (LINK_RE.test(b.name) || PHONE_IN.test(b.name) || EMAIL_IN.test(b.name)) e.name = 'Just a first name or the farm name.';
    b.phone = String(f.phone || '').trim();
    if (b.phone && (!/^[0-9()+\-. ]+$/.test(b.phone) || b.phone.replace(/\D/g, '').length < 10)) e.phone = 'A 10-digit phone number.';
    b.email = String(f.email || '').trim();
    if (b.email && !EMAIL_RE.test(b.email)) e.email = 'Check the email.';
    if (!b.phone && !b.email && !e.phone && !e.email) e.phone = 'A phone or an email, so people can reach you.';
    b._gotcha = f._gotcha || '';
    return { errors: e, body: b };
  }
  function title(r) {
    var bits = [PRODUCTS[r.product] || 'Hay'];
    if (r.cutting && CUT[r.cutting]) bits.push(CUT[r.cutting]);
    return bits.join(', ');
  }
  function amount(r) {
    if (r.count != null) return comma(r.count) + ' ' + (BALES[r.bale] || 'bales');
    return r.bale ? BALES[r.bale] || '' : '';
  }
  function delivery(r) {
    if (r.delivery === 'yes') return 'Will deliver';
    if (typeof r.delivery === 'number') return 'Delivers up to ' + comma(r.delivery) + ' miles';
    return r.kind === 'wanted' ? 'Will haul it' : 'Pick up';
  }
  function testLine(r) {
    var t = [];
    if (r.rfv != null) t.push('RFV ' + r.rfv);
    if (r.rfq != null) t.push('RFQ ' + r.rfq);
    if (r.cp != null) t.push('CP ' + r.cp + '%');
    return t.join(', ');
  }
  function priceHtml(r) {
    if (!(r.price > 0)) return r.kind === 'wanted' ? '<span class="hb-p">Make an offer</span>' : '<span class="hb-p">Call for price</span>';
    var t = perTon(r.price, r.unit, r.weight);
    var main = money(r.price) + (r.unit === 'ton' ? ' a ton' : ' a bale');
    var s = '<span class="hb-p">' + esc(main) + '</span>';
    if (t && r.unit === 'bale') s += '<span class="hb-t">about ' + esc(money(t.ton)) + ' a ton <span class="hb-m">(' + esc(t.math) + ', the poster\'s weight)</span></span>';
    else if (t && t.perBale) s += '<span class="hb-t">about ' + esc(money(t.perBale)) + ' a bale <span class="hb-m">(' + esc(t.math) + ')</span></span>';
    else if (r.unit === 'bale') s += '<span class="hb-t hb-m">No bale weight given, so no price per ton</span>';
    return s;
  }
  function ago(ts, now) {
    var d = Math.floor(((now || Date.now()) - ts) / 86400000);
    return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d + ' days ago';
  }
  function cardHtml(r, now) {
    var where = (r.mi != null ? comma(r.mi) + ' mi, ' : '') + 'ZIP ' + r.zip;
    var meta = [amount(r), r.weight ? comma(r.weight) + ' lb bales' : '', testLine(r), delivery(r)].filter(Boolean);
    return '<li class="hb-card" data-id="' + esc(r.id) + '">' +
      '<div class="hb-top"><span class="hb-k ' + (r.kind === 'wanted' ? 'w' : 's') + '">' + (r.kind === 'wanted' ? 'Wanted' : 'For sale') + '</span>' +
      '<span class="hb-where">' + esc(where) + '</span></div>' +
      '<h3 class="hb-h">' + esc(title(r)) + '</h3>' +
      '<div class="hb-price">' + priceHtml(r) + '</div>' +
      (meta.length ? '<p class="hb-meta">' + esc(meta.join(' · ')) + '</p>' : '') +
      (r.note ? '<p class="hb-note">' + esc(r.note) + '</p>' : '') +
      '<p class="hb-by">' + (r.name ? esc(r.name) + ', posted ' : 'Posted ') + esc(ago(r.ts, now)) + '</p>' +
      '<div class="hb-acts"><button type="button" class="hb-btn" data-contact="' + esc(r.id) + '">Show contact</button>' +
      '<button type="button" class="hb-link" data-report="' + esc(r.id) + '">Report</button></div>' +
      '<div class="hb-contact" id="hb-c-' + esc(r.id) + '" aria-live="polite"></div></li>';
  }
  function contactHtml(c) {
    var out = [];
    if (c.name) out.push('<b>' + esc(c.name) + '</b>');
    if (c.phone) out.push('<a href="tel:' + esc(c.phone.replace(/[^0-9+]/g, '')) + '">' + esc(c.phone) + '</a>');
    if (c.email) out.push('<a href="mailto:' + esc(c.email) + '">' + esc(c.email) + '</a>');
    return out.join(' · ') || 'No contact on this post.';
  }
  function parseEdit(hash) {
    var m = /(?:^#|&)edit=([0-9a-hjkmnp-tv-z]{10})\.([0-9a-hjkmnp-tv-z]{24})(?:&|$)/i.exec(String(hash || ''));
    return m ? { id: m[1].toLowerCase(), key: m[2].toLowerCase() } : null;
  }
  function editLink(id, key) { return 'https://agsist.com/haymow#edit=' + id + '.' + key; }

  var H = { WORKER: WORKER, PRODUCTS: PRODUCTS, BALES: BALES, distMi: distMi, perTon: perTon, sortRows: sortRows, filterRows: filterRows,
    validatePost: validatePost, cardHtml: cardHtml, contactHtml: contactHtml, priceHtml: priceHtml, parseEdit: parseEdit, editLink: editLink, esc: esc };
  if (typeof module === 'object' && module.exports) module.exports = H;
  if (typeof document === 'undefined') return;

  // ------------------------------------------------------------------ page
  var $ = function (id) { return document.getElementById(id); };
  var S = { rows: null, here: null, seq: 0, edit: null };

  function getJSON(url, ms) {
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var t = setTimeout(function () { if (ctl) ctl.abort(); }, ms || 8000);
    return fetch(url, { signal: ctl ? ctl.signal : undefined }).then(function (r) {
      clearTimeout(t);
      if (!r.ok) { var e = new Error('http ' + r.status); e.status = r.status; throw e; }
      return r.json();
    }, function (e) { clearTimeout(t); throw e; });
  }
  function post(path, body) {
    return fetch(WORKER + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) {
        return r.json().then(function (j) { return { j: j, json: true }; }, function () { return { j: {}, json: false }; }).then(function (a) {
          var j = a.j;
          if (r.ok && j && j.ok) return j;
          var e = new Error((j && j.error) || ('http ' + r.status)); e.status = r.status;
          // the block page, a 5xx, a 429 page or no JSON: the worker did not answer (2026-10-22)
          e.down = !a.json || r.status >= 500;
          throw e;
        });
      }, function () { var e = new Error('no answer'); e.status = 0; e.down = true; throw e; });
  }
  /* THE WORKER DOWN (2026-10-22): a new post or a change is kept in this
     browser (components/outbox.js) and goes to the worker on the next visit
     after it is back; a new post's private edit link then shows under
     "Your posts" on this page. -> true when kept. */
  function keep(path, b, kind) {
    if (!window.AgOutbox) return false;
    var id = window.AgOutbox.add({ url: WORKER + path, body: b, kind: 'hay' + path.replace(/\//g, '-'),
      label: path === '/hay/post' ? 'your hay board post' : 'the change to your hay board post',
      after: path === '/hay/post' ? 'hay-mine' : '', meta: { kind: kind } });
    if (!id) return false;
    $('hb-out').innerHTML = '<div class="cl-msg ok"><p><b>' + esc(window.AgOutbox.LINE) + '</b></p><p>' +
      (path === '/hay/post' ? 'Our system is down right now. Your post goes up then, and your private edit link shows on this page under your posts.'
        : 'Our system is down right now. Your change shows on the board then.') + '</p></div>';
    return true;
  }
  function zipLL(z) {
    return getJSON(ZIPS + z.slice(0, 2) + '.json', 6000).then(function (t) {
      var p = t && t[z];
      if (Array.isArray(p) && isFinite(+p[0]) && isFinite(+p[1]) && !(+p[0] === 0 && +p[1] === 0)) return { lat: +p[0], lng: +p[1] };
      throw new Error('not in table');
    }).catch(function () {
      return getJSON('https://geocoding-api.open-meteo.com/v1/search?name=' + z + '&count=1&language=en&format=json&countryCode=US', 6000).then(function (d) {
        var r = d && d.results && d.results[0];
        if (!r) throw new Error('none');
        return { lat: r.latitude, lng: r.longitude };
      });
    });
  }
  function store(get, val) {
    try {
      if (get) { var v = JSON.parse(localStorage.getItem(MINE_KEY) || '[]'); return Array.isArray(v) ? v : []; }
      localStorage.setItem(MINE_KEY, JSON.stringify(val));
    } catch (e) { return get ? [] : undefined; }
  }
  function prefs(save) {
    try {
      if (save) { localStorage.setItem('agsist-hay-find', JSON.stringify({ zip: $('hb-zip').value, mi: $('hb-mi').value, kind: kindNow() })); return null; }
      return JSON.parse(localStorage.getItem('agsist-hay-find') || 'null');
    } catch (e) { return null; }
  }
  function kindNow() {
    var b = document.querySelector('[data-kind][aria-pressed="true"]');
    return b ? b.getAttribute('data-kind') : 'both';
  }
  function status(msg, bad) { var s = $('hb-status'); s.textContent = msg || ''; s.className = 'hb-status' + (bad ? ' bad' : ''); }

  function render() {
    var list = $('hb-list');
    if (!S.rows) return;
    var rows = filterRows(sortRows(S.rows, S.here), kindNow(), S.here ? Number($('hb-mi').value) : 0);
    if (!rows.length) {
      list.innerHTML = '';
      status(S.rows.length ? 'Nothing posted within ' + $('hb-mi').selectedOptions[0].textContent.toLowerCase() + ' yet. Try a wider circle, or post yours below.'
        : 'No posts yet. Be the first: post yours below.');
      return;
    }
    status(rows.length + (rows.length === 1 ? ' post' : ' posts') + (S.here ? ', nearest first.' : ', newest first. Enter your ZIP to sort by distance.'));
    var now = Date.now();
    list.innerHTML = rows.map(function (r) { return cardHtml(r, now); }).join('');
  }
  function load() {
    status('Loading posts...');
    getJSON(WORKER + '/hay/feed', 10000).then(function (j) {
      S.rows = (j && Array.isArray(j.listings)) ? j.listings : [];
      render();
    }).catch(function (e) {
      S.rows = null;
      status(e && e.status === 404 ? 'The board opens in a day or so. Check back soon.' : 'Could not load the posts. Check your connection and try again.', true);
    });
  }
  function find() {
    var z = String($('hb-zip').value || '').replace(/\D/g, '').slice(0, 5);
    if (!z) { S.here = null; prefs(true); render(); return; }
    if (z.length !== 5) { status('Enter a 5-digit ZIP.', true); return; }
    $('hb-zip').value = z; prefs(true);
    var my = ++S.seq;
    status('Looking up ' + z + '...');
    zipLL(z).then(function (p) { if (my !== S.seq) return; S.here = p; render(); })
      .catch(function () { if (my === S.seq) status('Could not find ZIP ' + z + '. Check it and try again.', true); });
  }

  function formValues() {
    var f = $('hb-form'), v = {};
    ['zip', 'product', 'cutting', 'bale', 'count', 'price', 'weight', 'rfv', 'rfq', 'cp', 'miles', 'note', 'name', 'phone', 'email', '_gotcha'].forEach(function (k) {
      var el = f.elements[k]; v[k] = el ? el.value : '';
    });
    var kind = f.querySelector('input[name="pkind"]:checked'); v.kind = kind ? kind.value : '';
    var unit = f.querySelector('input[name="unit"]:checked'); v.unit = unit ? unit.value : '';
    var del = f.querySelector('input[name="delivery"]:checked'); v.delivery = del ? del.value : 'no';
    return v;
  }
  function showErrors(errs) {
    var f = $('hb-form'), first = null;
    Array.prototype.forEach.call(f.querySelectorAll('.cl-err'), function (p) { p.textContent = ''; });
    Array.prototype.forEach.call(f.querySelectorAll('[aria-invalid]'), function (el) { el.removeAttribute('aria-invalid'); });
    Object.keys(errs).forEach(function (k) {
      var p = $('hb-' + k + '-e'); if (p) p.textContent = errs[k];
      var el = f.elements[k] || f.querySelector('[name="p' + k + '"]');
      if (el && el.setAttribute) el.setAttribute('aria-invalid', 'true');
      if (!first) first = el && el.focus ? el : null;
    });
    if (first) first.focus();
    return !Object.keys(errs).length;
  }
  function fillForm(p) {
    var f = $('hb-form');
    var set = function (k, v) { if (f.elements[k]) f.elements[k].value = v == null ? '' : v; };
    ['zip', 'product', 'cutting', 'bale', 'count', 'price', 'weight', 'rfv', 'rfq', 'cp', 'note', 'name', 'phone', 'email'].forEach(function (k) { set(k, p[k]); });
    var pick = function (name, val) { var el = f.querySelector('input[name="' + name + '"][value="' + val + '"]'); if (el) el.checked = true; };
    pick('pkind', p.kind); if (p.unit) pick('unit', p.unit);
    pick('delivery', p.delivery === 'no' ? 'no' : 'yes');
    set('miles', typeof p.delivery === 'number' ? p.delivery : '');
    syncKind();
  }
  function syncKind() {
    var w = ($('hb-form').querySelector('input[name="pkind"]:checked') || {}).value === 'wanted';
    $('hb-bale-l').textContent = w ? 'Bale type (optional)' : 'Bale type';
    $('hb-count-l').textContent = w ? 'How many you need (optional)' : 'How many';
    $('hb-del-l').textContent = w ? 'Can the seller deliver?' : 'Will you deliver?';
    $('hb-send').textContent = S.edit ? 'Save changes' : (w ? 'Post what you need' : 'Post your hay');
  }
  function mineSave(id, key, kind) {
    var m = store(true).filter(function (x) { return x && x.id !== id; });
    m.unshift({ id: id, key: key, kind: kind, ts: Date.now() });
    store(false, m.slice(0, 20));
    renderMine();
  }
  function mineDrop(id) { store(false, store(true).filter(function (x) { return x && x.id !== id; })); renderMine(); }
  function renderMine() {
    var m = store(true), box = $('hb-mine');
    if (!m.length) { box.hidden = true; return; }
    box.hidden = false;
    $('hb-mine-list').innerHTML = m.map(function (x) {
      return '<li><a href="' + esc(editLink(x.id, x.key)) + '" data-open="' + esc(x.id) + '">' + (x.kind === 'wanted' ? 'Wanted post' : 'Hay for sale') +
        ', posted ' + esc(new Date(x.ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })) + '</a></li>';
    }).join('');
  }
  function sent(j, kind) {
    var link = editLink(j.id, j.key);
    mineSave(j.id, j.key, kind);
    var held = j.status === 'held';
    $('hb-out').innerHTML = '<div class="cl-msg ok"><p><b>' + (held ? 'Got it. Your post shows once Sig takes a quick look at it.' : 'Your post is up.') + '</b> ' +
      'It comes down by itself in 30 days.</p><p>This is your private link to change, renew or take down your post. Keep it: there is no account and no password, ' +
      'and anyone with the link can change the post. This browser saves it too.</p>' +
      '<textarea readonly rows="2" id="hb-link" aria-label="Your private edit link">' + esc(link) + '</textarea>' +
      '<div class="cl-acts"><button type="button" class="cl-btn2" id="hb-copy">Copy the link</button>' +
      '<a class="cl-btn2" href="mailto:?subject=' + encodeURIComponent('My hay board post') + '&body=' + encodeURIComponent('Edit or take down my post: ' + link) + '">Email it to myself</a></div></div>';
    $('hb-copy').addEventListener('click', function () {
      var t = $('hb-link'); t.select();
      try { navigator.clipboard.writeText(link).then(function () { $('hb-copy').textContent = 'Copied'; }, function () { document.execCommand('copy'); }); }
      catch (e) { try { document.execCommand('copy'); } catch (e2) { /* select is enough */ } }
    });
    $('hb-form').reset(); syncKind();
    load();
  }
  function submit(ev) {
    ev.preventDefault();
    var v = validatePost(formValues());
    if (!showErrors(v.errors)) return;
    var btn = $('hb-send'); btn.disabled = true; btn.textContent = 'Sending...';
    $('hb-out').innerHTML = '';
    var b = v.body;
    var go = function (ll) {
      if (ll) { b.lat = ll.lat; b.lng = ll.lng; }
      if (S.edit) {
        b.id = S.edit.id; b.key = S.edit.key;
        return post('/hay/edit', b).then(function (j) {
          $('hb-out').innerHTML = '<div class="cl-msg ok"><p><b>Saved.</b> ' + (j.post.status === 'live' ? 'The change shows on the board within a minute.' : 'It shows once Sig takes a look.') + '</p></div>';
          load();
        });
      }
      return post('/hay/post', b).then(function (j) { if (j.id && j.key) sent(j, b.kind); else $('hb-out').innerHTML = '<div class="cl-msg ok"><p>Thanks.</p></div>'; });
    };
    zipLL(b.zip).then(go, function () { return go(null); }).catch(function (e) {
      if (e && e.down && keep(S.edit ? '/hay/edit' : '/hay/post', b, b.kind)) { if (!S.edit) { $('hb-form').reset(); syncKind(); } return; }
      var msg = e && e.status === 429 ? 'That is a lot of posts from here today. Try again in an hour.'
        : e && e.status === 404 && !S.edit ? 'The board opens in a day or so. Your post did not go through; try again soon.'
        : e && e.status === 400 ? 'It did not go through: ' + e.message + '.'
        : e && e.status === 404 ? 'That link does not open a post anymore. It may have expired or been taken down.'
        : 'It did not go through. Check your connection and try again.';
      $('hb-out').innerHTML = '<div class="cl-msg bad"><p>' + esc(msg) + '</p></div>';
    }).then(function () { btn.disabled = false; syncKind(); });
  }
  function openEdit(e) {
    S.edit = e;
    $('hb-post-h').textContent = 'Change your post';
    $('hb-own').hidden = false;
    $('hb-own-msg').textContent = 'Opening your post...';
    post('/hay/mine', e).then(function (j) {
      fillForm(j.post);
      var exp = new Date(j.post.exp).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
      $('hb-own-msg').textContent = (j.post.status === 'live' ? 'Your post is up. ' : 'Your post is not showing right now. ') + 'It comes down on ' + exp + ' unless you renew it.';
      mineSave(e.id, e.key, j.post.kind);
      $('hb-post').scrollIntoView({ block: 'start' });
    }).catch(function () {
      $('hb-own-msg').textContent = 'That link does not open a post anymore. It may have expired or been taken down.';
      mineDrop(e.id); S.edit = null; $('hb-own-acts').hidden = true;
    });
  }
  function own(path, done) {
    if (!S.edit) return;
    post(path, S.edit).then(done).catch(function () { $('hb-own-msg').textContent = 'That did not go through. Try again.'; });
  }

  function init() {
    // a post kept while the worker was down went through: its edit link is now under "Your posts"
    window.addEventListener('agsist:outbox', function () { renderMine(); load(); });
    var p = prefs(false);
    if (p) {
      if (p.zip) $('hb-zip').value = p.zip;
      if (p.mi) $('hb-mi').value = p.mi;
      if (p.kind) Array.prototype.forEach.call(document.querySelectorAll('[data-kind]'), function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-kind') === p.kind)); });
    }
    $('hb-find').addEventListener('submit', function (e) { e.preventDefault(); find(); });
    $('hb-mi').addEventListener('change', function () { prefs(true); render(); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-kind]'), function (b) {
      b.addEventListener('click', function () {
        Array.prototype.forEach.call(document.querySelectorAll('[data-kind]'), function (x) { x.setAttribute('aria-pressed', String(x === b)); });
        prefs(true); render();
      });
    });
    $('hb-list').addEventListener('click', function (e) {
      var t = e.target.closest ? e.target.closest('button') : null;
      if (!t) return;
      var cid = t.getAttribute('data-contact'), rid = t.getAttribute('data-report');
      if (cid) {
        t.disabled = true; t.textContent = 'Getting it...';
        post('/hay/contact', { id: cid }).then(function (c) { $('hb-c-' + cid).innerHTML = contactHtml(c); t.hidden = true; })
          .catch(function (er) { t.disabled = false; t.textContent = 'Show contact'; $('hb-c-' + cid).textContent = er && er.status === 429 ? 'That is a lot of contacts from here. Try again in an hour.' : er && er.status === 404 ? 'This post is gone.' : 'Could not get it. Try again.'; });
      }
      if (rid) {
        var box = $('hb-c-' + rid);
        box.innerHTML = '<span class="hb-rq">What is wrong with it? <button type="button" class="hb-link" data-why="sold">Sold or gone</button> ' +
          '<button type="button" class="hb-link" data-why="wrong">Wrong info</button> <button type="button" class="hb-link" data-why="scam">Looks like a scam</button> ' +
          '<button type="button" class="hb-link" data-why="spam">Spam</button></span>';
        box.setAttribute('data-for', rid);
      }
      var why = t.getAttribute('data-why');
      if (why) {
        var b2 = t.closest('.hb-contact'), id2 = b2.getAttribute('data-for');
        post('/hay/report', { id: id2, why: why }).then(function () { b2.textContent = 'Thanks. Three reports from different people take a post down until Sig looks at it.'; },
          function () { b2.textContent = 'Could not send that. Try again.'; });
      }
    });
    $('hb-form').addEventListener('submit', submit);
    Array.prototype.forEach.call($('hb-form').querySelectorAll('input[name="pkind"]'), function (r) { r.addEventListener('change', syncKind); });
    $('hb-note').addEventListener('input', function () { $('hb-note-n').textContent = this.value.length + ' / 300'; });
    $('hb-renew').addEventListener('click', function () {
      own('/hay/renew', function (j) { $('hb-own-msg').textContent = 'Renewed. It now comes down on ' + new Date(j.post.exp).toLocaleDateString('en-US', { month: 'long', day: 'numeric' }) + '.'; });
    });
    $('hb-delete').addEventListener('click', function () {
      if (!window.confirm('Take this post down for good?')) return;
      own('/hay/delete', function () {
        mineDrop(S.edit.id); S.edit = null;
        $('hb-own-msg').textContent = 'Taken down. It leaves the board within a minute.';
        $('hb-own-acts').hidden = true; $('hb-post-h').textContent = 'Post your hay';
        $('hb-form').reset(); syncKind();
        try { history.replaceState(null, '', location.pathname); } catch (e) { /* fine */ }
        load();
      });
    });
    $('hb-mine-list').addEventListener('click', function (e) {
      var a = e.target.closest ? e.target.closest('a[data-open]') : null;
      if (!a) return;
      var ed = parseEdit(a.getAttribute('href').split('#')[1] ? '#' + a.getAttribute('href').split('#')[1] : '');
      if (ed) { e.preventDefault(); try { history.replaceState(null, '', '#edit=' + ed.id + '.' + ed.key); } catch (x) { /* fine */ } openEdit(ed); }
    });
    window.addEventListener('hashchange', function () { var ed = parseEdit(location.hash); if (ed) openEdit(ed); });
    syncKind(); renderMine();
    var ed = parseEdit(location.hash);
    if (ed) openEdit(ed);
    load();
    if ($('hb-zip').value) find();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
