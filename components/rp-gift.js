/* components/rp-gift.js: Rain Print gift cards (2026-10-13).
 *
 * The subs worker (v5.16) holds the cards: POST /rp-gift/check, POST
 * /rp-gift/redeem, GET /rp-gift/card. This file is the client for both pages:
 * rp-gift.html (the printable card) and rain-print.html (redeeming a card).
 * It draws nothing on rain-print.html by itself; the page calls it.
 *
 * Code: RP-XXXX-XXXX-XXXX. 11 random Crockford base32 characters (0-9 A-Z
 * without I L O U) and a mod-37 check character. Typed any case, with or
 * without spaces, dashes or the RP; I and L read as 1, O as 0.
 *
 * THE HOOK FOR rain-print.html (window.AgRpGift):
 *
 *   AgRpGift.fromUrl()  -> 'RP-....' or ''. Reads ?gift=CODE, takes it out of
 *     the address bar (history.replaceState; the page's analytics already send
 *     the bare path only) and keeps it in sessionStorage, so a reload in the
 *     same tab still knows the card. Also answers a code kept from earlier in
 *     this tab. Call it once on load.
 *   AgRpGift.open(code, { banner: el }) -> Promise of a gift state G:
 *     { ok, usable, code, kind 'open'|'locked', product, to, from_line, ships,
 *       status, redeemed_on, lock: null | { design_code, edit 'none'|'name',
 *       design: RainPrint.decodeCode(design_code) or null }, locked: [field
 *       names the reader may not change], text: the banner sentence, error }
 *     usable is true only for an unused card. prepaid (worker v5.40) is a
 *     card set when it was bought (the giver gave the address at checkout):
 *     not usable, nothing to fill in, its design shown. head, steps and note
 *     are the banner's lines (2026-10-20, Sig: what they get, how to use it). With banner, it fills that
 *     element with the banner (and a box to type a code if the link's was
 *     wrong). It never throws; a network failure answers ok:false.
 *   AgRpGift.redeem(G, order) -> Promise of {ok:true, redeemed_on, ships,
 *     upgrade} or {ok:false, error, status}. order is what the page already
 *     posts for an order: name, email, address, notes, design_url, design_code,
 *     and choice (leave it out to take the card's product).
 *   AgRpGift.doneHtml(G, result, choice) -> the thank-you message for the order
 *     box. choice is the product ordered (the card's when left out): a print
 *     gets a proof first; the digital file comes finished, no proof step, and
 *     Sig redoes it free on request (2026-10-14).
 *   Smaller pieces: norm(code), product(p) ("one framed 13 x 19 Rain Print"),
 *   dayText(day) ("Dec 26, 2026" from that or from 2026-12-26),
 *   summary(designCode) (place, year, name, dedication, style), LOCKABLE.
 *
 * Nothing here is sent anywhere except the worker, and only the code and the
 * order the reader typed. */
(function (root) {
  'use strict';
  if (root.AgRpGift) return;

  var API = 'https://agsist-subs.dnilgis.workers.dev/rp-gift/';
  var KEY = 'agsist-rp-gift';
  var TIMEOUT_MS = 12000;
  var B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  var RE = /^[0-9A-HJKMNP-TV-Z]{12}$/;
  var PRODUCT = {
    digital: ['the digital file of one Rain Print', 'Rain Print digital file'],
    print12x18: ['one 13 x 19 Rain Print, shipping included', '13 x 19 print'],
    framed12x18: ['one framed 13 x 19 Rain Print, shipping included', 'Framed 13 x 19 print']
  };
  // Every design input on rain-print.html a locked card can hold still.
  var LOCKABLE = ['place', 'station', 'year', 'style', 'layout', 'palette', 'size', 'cmp', 'name', 'dedication', 'markers', 'normals', 'records'];

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' }[c]; }); }
  function check(body) { var m = 0; for (var i = 0; i < body.length; i++) m = (m * 32 + B32.indexOf(body[i])) % 37; return m; }
  function norm(v) {
    var s = String(v == null ? '' : v).toUpperCase().replace(/[\s._\u2010-\u2015-]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
    if (s.length === 14 && s.indexOf('RP') === 0) s = s.slice(2);
    if (!RE.test(s) || check(s.slice(0, 11)) !== B32.indexOf(s[11])) return '';
    return 'RP-' + s.slice(0, 4) + '-' + s.slice(4, 8) + '-' + s.slice(8);
  }
  function product(p, short) { var x = PRODUCT[p]; return x ? x[short ? 1 : 0] : 'one Rain Print'; }
  // A day as people write it: "Dec 26, 2026". The worker already sends that;
  // an ISO day (2026-12-26, from an older worker or the admin page) is turned
  // into it, and anything else is shown as it came.
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function dayText(v) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v == null ? '' : v));
    if (!m || +m[2] < 1 || +m[2] > 12) return v == null ? '' : String(v);
    return MON[+m[2] - 1] + ' ' + (+m[3]) + ', ' + m[1];
  }

  // A design code's words, without loading the whole Rain Print page script:
  // base64url of "2|place|station|year|keys|name[|day|label]...[|dedication]".
  function summary(code) {
    code = String(code || '').replace(/^GIFT-/, '');
    if (!/^[A-Za-z0-9_-]{8,400}$/.test(code)) return null;
    var raw;
    try {
      var b = code.replace(/-/g, '+').replace(/_/g, '/');
      while (b.length % 4) b += '=';
      var bin = atob(b), bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (e) { return null; }
    var f = raw.split('|'), v2 = f[0] === '2', ded = '';
    if ((f[0] !== '1' && !v2) || f.length < 6) return null;
    if (v2 && (f.length - 6) % 2) ded = f.pop();
    var x5 = v2 ? 'abcdefgh'.indexOf((f[4] || '')[4]) : -1;
    var year = parseInt(f[3], 10);
    if (!(year >= 1850 && year <= 2200)) return null;
    var dates = [];
    for (var j = 6; j + 1 < f.length; j += 2) if (f[j + 1]) dates.push(f[j + 1]);
    return { place: f[1], station: f[2], year: year, name: f[5] || '', dedication: ded, dates: dates,
      style: x5 >= 0 && (x5 & 4) ? 'Roots' : 'Staircase' };
  }

  function post(path, body) {
    var ctl = root.AbortController ? new root.AbortController() : null;
    var t = ctl ? setTimeout(function () { ctl.abort(); }, TIMEOUT_MS) : null;
    return fetch(API + path, { method: 'POST', body: JSON.stringify(body), signal: ctl ? ctl.signal : undefined,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' } })
      .then(function (r) {
        return r.json().then(function (j) { return { j: j, json: true }; }, function () { return { j: {}, json: false }; }).then(function (a) {
          var j = a.j && typeof a.j === 'object' ? a.j : {};
          j.status_code = r.status;
          if (!r.ok) j.ok = false;
          // the block page, a 5xx or no JSON at all: the worker did not answer (2026-10-22)
          if (!r.ok && (!a.json || r.status >= 500)) j.down = true;
          return j;
        });
      }, function () { return { ok: false, status_code: 0, down: true }; })
      .then(function (j) { if (t) clearTimeout(t); return j; });
  }
  function errorText(j) {
    if (j.status_code === 429) return 'Too many tries from this connection. Wait an hour and try again, or write to sig@agsist.com.';
    if (!j.status_code || j.status_code >= 500 || j.down) return 'The gift card check didn\u2019t answer. Try again in a minute.';
    return j.error || 'That code didn\u2019t work. Check it against the card.';
  }

  function stateFrom(j, code) {
    var G = { ok: !!j.ok, usable: false, code: code, kind: j.kind, product: j.product, to: j.to || '', from_line: j.from_line || '',
      ships: j.ships || 'now', status: j.status, redeemed_on: j.redeemed_on || null, lock: null, locked: [], text: '', error: '',
      prepaid: !!j.ok && j.prepaid === true && j.status === 'redeemed', head: '', steps: [], note: '' };
    if (!j.ok && j.down && j.deferrable) {
      /* THE WORKER DOWN (2026-10-22): the card can't be checked, so the
         order is taken and kept in this browser (components/outbox.js); the
         worker checks and uses the card when it answers again. */
      G.ok = true; G.usable = true; G.deferred = true; G.head = 'A gift for you';
      G.text = 'Our system is down, so your card can\u2019t be checked right now. Make your print and tap Use my gift; your order is saved and goes through when our system is back.';
      G.steps = ['Our system is down, so your card can\u2019t be checked right now. You can still use it.',
        'Type the farm or town and pick a year, then tap Use my gift and fill in the order. It is saved on this device and goes through when our system is back.'];
      G.note = 'If the giver already picked a design, the card keeps that one; this page tells you on your next visit, and you can send it again.';
      return G;
    }
    if (!j.ok) { G.error = errorText(j); return G; }
    if (j.lock && j.lock.design_code) {
      var d = null;
      try { d = root.RainPrint && root.RainPrint.decodeCode ? root.RainPrint.decodeCode(j.lock.design_code) : null; } catch (e) { d = null; }
      G.lock = { design_code: j.lock.design_code, edit: j.lock.edit === 'name' ? 'name' : 'none', design: d, summary: summary(j.lock.design_code) };
      G.locked = LOCKABLE.filter(function (k) { return !(G.lock.edit === 'name' && k === 'name'); });
    }
    var from = G.from_line ? 'A gift from ' + G.from_line : 'A gift for you';
    var what = product(G.product);
    var yr = G.lock && G.lock.summary ? G.lock.summary.year : '';
    var jan = G.ships === 'january' ? 'Your ' + (yr || '') + (yr ? ' ' : '') + 'print comes in January, once the full year is in.' : '';
    // the banner's own lines (2026-10-20, Sig: what the receiver gets and how to use it, plainly, at phone width)
    G.head = G.to && G.from_line ? 'A gift for ' + G.to + ' from ' + G.from_line : G.to ? 'A gift for ' + G.to : G.from_line ? 'A gift from ' + G.from_line : 'A gift for you';
    if (G.prepaid) {
      // set when it was bought (worker v5.40): the giver gave the address at checkout, so nothing to fill in
      G.text = from + ': ' + what + '. It\u2019s paid for and on its way, so there\u2019s nothing to fill in.' + (jan ? ' ' + jan : '');
      G.steps = ['It\u2019s paid for and on its way, so there\u2019s nothing to fill in.' + (G.lock ? ' Below is ' + (G.ships === 'january' ? 'the print so far' : 'your print') + '.' : '')];
      G.note = jan;
      return G;
    }
    if (G.status === 'redeemed') G.text = 'This card was used on ' + dayText(G.redeemed_on) + '. If that wasn\u2019t you, write to sig@agsist.com.';
    else if (G.status === 'void') G.text = 'This card is no longer active. Write to me at sig@agsist.com and I\u2019ll sort it out.';
    else if (G.status === 'pending') G.text = 'This card is being used right now. Try again in two minutes.';
    else {
      G.usable = true;
      G.text = from + ': ' + what + '. ' + (G.lock
        ? 'The design is already chosen' + (G.lock.edit === 'name' ? '; you can change the name line' : '') + '. Add where it goes and press Use my gift.'
        : 'Pick the farm and the year, then press Use my gift.') +
        (jan ? ' ' + jan : '');
      var where = G.product === 'digital' ? 'give your email for the file' : 'say where it goes';
      G.steps = [G.lock ? 'Your print is below, already picked' + (G.lock.edit === 'name' ? '. You can change the name line.' : '.')
        : 'Type the farm or town and pick a year. Your print draws below.', 'Tap Use my gift, then ' + where + '. Nothing to pay.'];
      G.note = (jan ? jan + ' ' : '') + 'The card never expires; it works once.';
    }
    return G;
  }

  var BANNER_CSS = '.rpg-banner{border:1px solid var(--border-2,#c9ccc4);border-left:4px solid #2B5C8A;border-radius:6px;padding:12px 14px;margin:0 0 1rem;background:var(--surface,#fff);color:var(--text,#1E2125);line-height:1.55}' +
    '.rpg-banner p{margin:0 0 .4rem}.rpg-banner p:last-child{margin:0}.rpg-banner b{font-weight:600}' +
    '.rpg-banner .rpg-code{font-family:"IBM Plex Mono",monospace;font-size:.85em;color:var(--text-dim,#5E6475)}' +
    '.rpg-banner.rpg-bad{border-left-color:#A8321E}.rpg-banner form{display:flex;flex-wrap:wrap;gap:.5rem;margin-top:.5rem}' +
    '.rpg-banner input{font:inherit;font-family:"IBM Plex Mono",monospace;min-height:40px;padding:0 .6rem;border:1px solid var(--border-2,#c9ccc4);border-radius:4px;background:var(--bg,#fff);color:inherit;text-transform:uppercase;flex:1 1 14em;max-width:20em}' +
    '.rpg-banner .rpg-h{font-size:1.1em}.rpg-banner .rpg-steps{margin:.2rem 0 .5rem;padding-left:1.4em}.rpg-banner .rpg-steps li{margin:0 0 .25rem}' +
    '.rpg-banner .rpg-note{font-size:.92em;color:var(--text-dim,#5E6475)}' +
    '.rpg-banner .rpg-go{display:inline-flex;align-items:center;min-height:44px;padding:0 1rem;border-radius:4px;background:#2B5C8A;color:#fff;font-weight:600;text-decoration:none}' +
    '.rpg-banner button{font:inherit;font-weight:600;min-height:40px;padding:0 .9rem;border-radius:4px;border:1px solid #2B5C8A;background:#2B5C8A;color:#fff;cursor:pointer}';
  function css(doc) {
    if (doc.getElementById('rpg-css')) return;
    var s = doc.createElement('style'); s.id = 'rpg-css'; s.textContent = BANNER_CSS;
    (doc.head || doc.documentElement).appendChild(s);
  }
  function banner(el, G, retry) {
    if (!el) return;
    var doc = el.ownerDocument;
    css(doc);
    el.hidden = false;
    el.className = 'rpg-banner' + (G.usable || G.prepaid ? '' : ' rpg-bad');
    el.setAttribute('role', 'status');
    var html;
    if (G.ok && (G.usable || G.prepaid)) {
      html = '<p class="rpg-h"><b>' + esc(G.head) + '</b></p><p>' + (G.deferred ? 'Your card covers what the giver paid for' : G.prepaid ? esc(product(G.product).charAt(0).toUpperCase() + product(G.product).slice(1)) : 'Your card covers ' + esc(product(G.product))) + '.</p>' +
        (G.usable ? '<ol class="rpg-steps">' + G.steps.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ol>'
          : G.steps.map(function (t) { return '<p>' + esc(t) + '</p>'; }).join('')) +
        (G.note ? '<p class="rpg-note">' + esc(G.note) + '</p>' : '') +
        (G.usable && doc.getElementById('rp-gift-use-wrap') ? '<p><a class="rpg-go" href="#rp-gift-use-wrap">Go to Use my gift</a></p>' : '') +
        '<p class="rpg-code">Card ' + esc(G.code) + '</p>';
    } else {
      html = '<p><b>' + esc(G.ok ? G.text : G.error) + '</b></p>';
      if (G.ok && G.to) html += '<p>For ' + esc(G.to) + '. <span class="rpg-code">Card ' + esc(G.code) + '</span></p>';
    }
    if (!G.ok) html += '<form novalidate><label class="sr-only" for="rpg-in">Gift card code</label><input id="rpg-in" autocomplete="off" spellcheck="false" placeholder="RP-XXXX-XXXX-XXXX" value="' + esc(G.code || '') + '"><button type="submit">Check the code</button></form>';
    el.innerHTML = html;
    var f = el.querySelector('form');
    if (f && retry) f.addEventListener('submit', function (e) {
      e.preventDefault();
      var c = norm(el.querySelector('input').value);
      if (!c) { el.querySelector('b').textContent = 'That isn\u2019t a gift card code. It looks like RP-7K3M-Q9TW-H2F4.'; return; }
      retry(c);
    });
  }

  function remember(code) { try { root.sessionStorage.setItem(KEY, code); } catch (e) { /* only this load knows it */ } }
  function fromUrl() {
    var code = '';
    try {
      var q = new URLSearchParams(root.location.search);
      if (q.has('gift') && q.get('gift') !== '1') {   // ?gift=1 is the January design flag, not a card
        code = norm(q.get('gift')) || String(q.get('gift')).slice(0, 40);
        q.delete('gift');
        var s = q.toString();
        root.history.replaceState(root.history.state, '', root.location.pathname + (s ? '?' + s : '') + root.location.hash);
      }
    } catch (e) { code = ''; }
    if (code) { remember(code); return code; }
    try { code = root.sessionStorage.getItem(KEY) || ''; } catch (e) { code = ''; }
    return code;
  }
  function open(code, opts) {
    opts = opts || {};
    var c = norm(code);
    var go = function (cc) {
      return post('check', { code: cc }).then(function (j) {
        if (j.down && root.AgOutbox) j.deferrable = true;
        var G = stateFrom(j, cc);
        // a prepaid card is only looked at: a later visit in this tab is the ordinary page
        if (G.ok && !G.prepaid) remember(cc);
        else if (G.prepaid) { try { root.sessionStorage.removeItem(KEY); } catch (e) {} }
        banner(opts.banner, G, function (again) { go(again).then(opts.onChange || function () {}); });
        return G;
      });
    };
    if (!c) {
      var G = stateFrom({ ok: false, status_code: 400, error: 'That isn\u2019t a gift card code. Type it as it is on the card.' }, String(code || ''));
      banner(opts.banner, G, function (again) { go(again).then(opts.onChange || function () {}); });
      return Promise.resolve(G);
    }
    return go(c);
  }
  function redeem(G, order) {
    if (!G || !G.usable) return Promise.resolve({ ok: false, error: 'This card can\u2019t be used.' });
    var body = { code: G.code };
    // the logo goes too: a long design is sent as its RPS- reference, which carries no logo (2026-10-15)
    ['name', 'email', 'address', 'notes', 'design_url', 'design_code', 'choice', 'page', 'logo'].forEach(function (k) {
      if (order && order[k] != null && order[k] !== '') body[k] = order[k];
    });
    return post('redeem', body).then(function (j) {
      // the worker down: kept in this browser, sent when it answers (components/outbox.js)
      if (!j.ok && j.down && root.AgOutbox) {
        var id = root.AgOutbox.add({ url: API + 'redeem', body: body, label: 'your Rain Print gift card order', kind: 'rp-gift-redeem' });
        if (id) { G.usable = false; G.status = 'queued'; try { root.sessionStorage.removeItem(KEY); } catch (e) {} return { ok: true, queued: true }; }
      }
      if (j.ok) { G.usable = false; G.status = 'redeemed'; try { root.sessionStorage.removeItem(KEY); } catch (e) {} return j; }
      return { ok: false, error: errorText(j), status: j.status_code };
    });
  }
  function doneHtml(G, r, choice) {
    if (r && r.queued) return '<div class="rp-msg rp-ok" tabindex="-1"><p><b>' + esc(root.AgOutbox ? root.AgOutbox.LINE : 'Saved.') + '</b></p>' +
      '<p>Our system is down right now. When it is back, your card is checked and used, and I email you ' +
      ((choice || (G && G.product)) === 'digital' ? 'the finished file' : 'a proof') + ' as usual.</p></div>';
    var jan = r && r.ships === 'january', when = jan ? ' in January, once the full year is in' : ' within 1 business day';
    var file = (choice || (G && G.product)) === 'digital';
    return '<div class="rp-msg rp-ok" tabindex="-1"><p><b>Your gift is in.</b> ' + (file
      ? 'I have your order and will email you the finished file' + when + '. If you want anything changed, write to me and I\u2019ll fix it or redo it by hand and send it again, no charge.</p>'
      : 'I have your order and will email you a proof' + when + '. Nothing prints until you say it looks right.</p>') +
      (r && r.upgrade ? '<p>You picked more than the card covers, so I\u2019ll email you a link for the difference.</p>' : '') +
      '<p>Card ' + esc(G.code) + ' is now used.</p></div>';
  }
  // For rp-gift.html: the card's own data (needs the k from Sig's link).
  function card(c, k) {
    var ctl = root.AbortController ? new root.AbortController() : null;
    var t = ctl ? setTimeout(function () { ctl.abort(); }, TIMEOUT_MS) : null;
    return fetch(API + 'card?c=' + encodeURIComponent(c) + '&k=' + encodeURIComponent(k), { signal: ctl ? ctl.signal : undefined, headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { j = j || {}; j.status_code = r.status; if (!r.ok) j.ok = false; return j; }); },
        function () { return { ok: false, status_code: 0 }; })
      .then(function (j) { if (t) clearTimeout(t); return j; });
  }

  root.AgRpGift = { norm: norm, product: product, summary: summary, fromUrl: fromUrl, open: open, redeem: redeem,
    doneHtml: doneHtml, card: card, errorText: errorText, dayText: dayText, LOCKABLE: LOCKABLE, API: API, _state: stateFrom };
})(typeof window !== 'undefined' ? window : this);
