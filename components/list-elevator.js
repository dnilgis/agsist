/* components/list-elevator.js: the request form on /list-your-elevator.

   An elevator asks to post its own bids on AGSIST. The form posts to the
   subs worker (POST /form, kind elevator-listing, worker v5.21) through
   components/form-post.js; scripts/form_digest.py mails Sig, and the request
   shows under Requests on elev-admin.html. Nothing is published from a
   request: Sig calls the elevator first, then makes the listing.

   Prefill: links from the coverage map and the town pages carry
   ?id=<bids directory id, known:... or reg:...>&name=&town=&state=&zip=.
   Every value is cut to the field's length, control characters removed, and
   the state and ZIP must have the right shape or they are dropped. The values
   only ever go into input values (never into markup).

   The pure parts are on window.ListElevator and under module.exports, so
   test/list-elevator.test.mjs runs the same code the page runs. */
(function (root) {
  'use strict';

  var TO = 'sig@agsist.com';
  var PAGE = '/list-your-elevator';
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  /* The worker's dirid rule, the same characters refused. */
  var DIR_ID_RE = /^(known|reg):[^<>"`\\]{1,190}$/;
  var CROPS = ['corn', 'soybeans', 'wheat', 'sorghum', 'oats', 'other'];
  var HOW = ['email', 'phone', 'not-sure'];
  var HOW_TEXT = { email: 'From the bid sheet we already send', phone: 'A private phone link', 'not-sure': 'Not sure yet' };
  var MAX = { elevator: 120, town: 80, name: 80, role: 80, phone: 30, email: 254, note: 600 };
  var STATES = [['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'], ['CA', 'California'], ['CO', 'Colorado'],
    ['CT', 'Connecticut'], ['DE', 'Delaware'], ['FL', 'Florida'], ['GA', 'Georgia'], ['HI', 'Hawaii'], ['ID', 'Idaho'],
    ['IL', 'Illinois'], ['IN', 'Indiana'], ['IA', 'Iowa'], ['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'],
    ['ME', 'Maine'], ['MD', 'Maryland'], ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'], ['MS', 'Mississippi'],
    ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'], ['NV', 'Nevada'], ['NH', 'New Hampshire'], ['NJ', 'New Jersey'],
    ['NM', 'New Mexico'], ['NY', 'New York'], ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'], ['OK', 'Oklahoma'],
    ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'], ['SC', 'South Carolina'], ['SD', 'South Dakota'],
    ['TN', 'Tennessee'], ['TX', 'Texas'], ['UT', 'Utah'], ['VT', 'Vermont'], ['VA', 'Virginia'], ['WA', 'Washington'],
    ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming']];
  var STATE_SET = {};
  STATES.forEach(function (s) { STATE_SET[s[0]] = 1; });

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' }[c];
    });
  }
  /* One line, no control characters, cut to n. */
  function clean(s, n) {
    s = String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    return n ? s.slice(0, n).trim() : s;
  }
  /* Registry names come in capitals ("PINE BLUFFS"): shown as people write them. */
  function niceCase(s) {
    s = clean(s);
    if (!s || !(s === s.toUpperCase() || s === s.toLowerCase()) || !/[a-z]/i.test(s)) return s;
    return s.toLowerCase().replace(/(^|[\s\-'(/.])([a-z])/g, function (m, a, b) { return a + b.toUpperCase(); })
      .replace(/\b(Llc|Inc|Co-op|Coop)\b/g, function (w) { return { Llc: 'LLC', Inc: 'Inc', 'Co-op': 'Co-op', Coop: 'Coop' }[w]; });
  }
  /* A town written "ALBIN, WY" by the directory: the town part only. */
  function townOnly(s, st) {
    s = clean(s);
    var m = /^(.*?),\s*([A-Za-z]{2})$/.exec(s);
    if (m && (!st || m[2].toUpperCase() === st)) s = m[1];
    return s;
  }

  /* The query string a link to this page carries -> the values to fill in. */
  function prefill(search) {
    var q;
    try { q = new URLSearchParams(String(search || '').replace(/^\?/, '')); } catch (e) { return {}; }
    var out = {};
    var id = clean(q.get('id'), 200);
    if (id && DIR_ID_RE.test(id)) out.dir_id = id;
    var st = clean(q.get('state')).toUpperCase();
    if (STATE_SET[st]) out.state = st;
    var name = niceCase(clean(q.get('name'), MAX.elevator));
    if (name) out.elevator = name;
    var town = niceCase(townOnly(clean(q.get('town'), MAX.town + 4), out.state)).slice(0, MAX.town);
    if (town) out.town = town;
    var zip = clean(q.get('zip'));
    if (/^\d{5}$/.test(zip)) out.zip = zip;
    return out;
  }

  /* A link to this page for one elevator, the way the map and town pages build it. */
  function link(e) {
    e = e || {};
    var p = [];
    if (e.id && DIR_ID_RE.test(String(e.id))) p.push('id=' + encodeURIComponent(e.id));
    if (e.name) p.push('name=' + encodeURIComponent(clean(e.name, MAX.elevator)));
    if (e.town) p.push('town=' + encodeURIComponent(clean(e.town, MAX.town + 4)));
    if (e.state && STATE_SET[String(e.state).toUpperCase()]) p.push('state=' + String(e.state).toUpperCase());
    if (e.zip && /^\d{5}$/.test(String(e.zip))) p.push('zip=' + e.zip);
    return PAGE + (p.length ? '?' + p.join('&') : '');
  }

  /* Field rules, the same as the worker's. Returns '' or the message to show. */
  var RULES = {
    elevator: function (s) { return !s ? 'Enter the elevator name.' : s.length > MAX.elevator ? 'Keep the name under 120 letters.' : ''; },
    town: function (s) { return !s ? 'Enter the town.' : s.length > MAX.town ? 'Keep the town under 80 letters.' : ''; },
    state: function (s) { return STATE_SET[s] ? '' : 'Choose a state.'; },
    zip: function (s) { return /^\d{5}$/.test(s) ? '' : 'Enter the elevator’s 5-digit ZIP.'; },
    name: function (s) { return !s ? 'Enter your name.' : s.length > MAX.name ? 'Keep your name under 80 letters.' : ''; },
    role: function (s) { return !s ? 'Enter your job there, for example manager or merchandiser.' : s.length > MAX.role ? 'Keep it under 80 letters.' : ''; },
    phone: function (s) {
      if (!s) return 'Enter a phone number where I can reach you.';
      return /^[0-9+().\-\s]+$/.test(s) && s.replace(/\D/g, '').length >= 10 && s.length <= MAX.phone ? '' : 'Enter a full phone number with area code.';
    },
    email: function (s) {
      if (!s) return 'Enter your email.';
      return EMAIL_RE.test(s) && s.length <= MAX.email ? '' : 'That email does not look complete. Check it for a typo.';
    },
    crops: function (a) { return a && a.length && a.every(function (c) { return CROPS.indexOf(c) >= 0; }) ? '' : 'Tick at least one crop.'; },
    how: function (s) { return HOW.indexOf(s) >= 0 ? '' : 'Choose how you would like to post.'; },
    note: function (s) { return s.length > MAX.note ? 'Keep the note under 600 letters.' : ''; }
  };
  function check(x) {
    var errs = {};
    Object.keys(RULES).forEach(function (k) { var m = RULES[k](x[k] == null ? '' : x[k]); if (m) errs[k] = m; });
    return errs;
  }
  /* What goes to the worker. dir_id only when it has the directory's shape. */
  function payload(x) {
    var p = { elevator: x.elevator, town: x.town, state: x.state, zip: x.zip, name: x.name, role: x.role,
      phone: x.phone, email: x.email, crops: CROPS.filter(function (c) { return (x.crops || []).indexOf(c) >= 0; }).join(', '),
      how: x.how, page: PAGE };
    if (x.note) p.note = x.note;
    if (x.dir_id && DIR_ID_RE.test(x.dir_id)) p.dir_id = x.dir_id;
    return p;
  }
  function subject(p) { return 'Elevator wants to post bids: ' + p.elevator + ', ' + p.town + ' ' + p.state; }
  function bodyText(p) {
    var l = ['Elevator: ' + p.elevator, 'Town: ' + p.town + ', ' + p.state + ' ' + p.zip, '',
      'Contact: ' + p.name, 'Role: ' + p.role, 'Phone: ' + p.phone, 'Email: ' + p.email,
      'Crops: ' + p.crops, 'How to post: ' + (HOW_TEXT[p.how] || p.how)];
    if (p.note) l.push('Note: ' + p.note);
    if (p.dir_id) l.push('Directory id: ' + p.dir_id);
    return l.concat(['', 'Sent from agsist.com' + PAGE]).join('\n');
  }

  var api = { prefill: prefill, link: link, check: check, payload: payload, subject: subject, bodyText: bodyText,
    niceCase: niceCase, townOnly: townOnly, clean: clean, esc: esc, RULES: RULES, CROPS: CROPS, HOW: HOW,
    DIR_ID_RE: DIR_ID_RE, STATES: STATES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ListElevator = api;

  /* ---------------- the page ---------------- */
  if (typeof document === 'undefined') return;
  var f = document.getElementById('le-form');
  var out = document.getElementById('le-out');
  var sec = document.getElementById('le-ask');
  if (!f || !out || !sec) return;
  var btn = document.getElementById('le-send');
  function ga(n, p) { try { if (window.gaEvent) window.gaEvent(n, p); } catch (e) {} }

  var sel = f.elements.state;
  if (sel && sel.options.length < 2) {
    STATES.forEach(function (s) { var o = document.createElement('option'); o.value = s[0]; o.textContent = s[1]; sel.appendChild(o); });
  }

  /* Prefill from the link. Only input values are set. */
  var pre = prefill(root.location ? root.location.search : '');
  ['elevator', 'town', 'state', 'zip'].forEach(function (k) { if (pre[k] && f.elements[k]) f.elements[k].value = pre[k]; });
  if (pre.dir_id && f.elements.dir_id) f.elements.dir_id.value = pre.dir_id;
  var fromMap = document.getElementById('le-from');
  if (fromMap && pre.elevator) {
    fromMap.textContent = 'From the AGSIST map: ' + pre.elevator + (pre.town ? ', ' + pre.town : '') + (pre.state ? ' ' + pre.state : '') +
      '. Check the name and town below and fix anything that is wrong.';
    fromMap.hidden = false;
  }

  function v(n) { var e = f.elements[n]; return e && typeof e.value === 'string' ? String(e.value).trim() : ''; }
  function fields() {
    var crops = [];
    Array.prototype.forEach.call(f.querySelectorAll('input[name="crops"]:checked'), function (c) { crops.push(c.value); });
    var how = f.querySelector('input[name="how"]:checked');
    return { elevator: v('elevator'), town: v('town'), state: v('state'), zip: v('zip'), name: v('name'), role: v('role'),
      phone: v('phone'), email: v('email'), crops: crops, how: how ? how.value : '', note: v('note'), dir_id: v('dir_id') };
  }
  function target(k) {
    if (k === 'crops') return f.querySelector('input[name="crops"]');
    if (k === 'how') return f.querySelector('input[name="how"]');
    return f.elements[k];
  }
  function mark(errs, only) {
    Object.keys(RULES).forEach(function (k) {
      if (only && k !== only) return;
      var err = document.getElementById('le-' + k + '-e'), inp = target(k);
      if (err) err.textContent = errs[k] || '';
      if (inp && k !== 'crops' && k !== 'how') { if (errs[k]) inp.setAttribute('aria-invalid', 'true'); else inp.removeAttribute('aria-invalid'); }
    });
  }
  /* Errors show when Send is pressed. After that a field's line updates as it
     is typed in, so it clears the moment the field is right. Nothing is checked
     on blur: a line that appears or goes as focus leaves a field moves the
     page under the pointer, and the tap meant for the next box misses. */
  Object.keys(RULES).forEach(function (k) {
    var group = k === 'crops' || k === 'how' ? f.querySelectorAll('input[name="' + k + '"]') : [f.elements[k]];
    Array.prototype.forEach.call(group, function (inp) {
      if (!inp) return;
      var again = function () { var e = document.getElementById('le-' + k + '-e'); if (e && e.textContent) mark(check(fields()), k); };
      inp.addEventListener('change', again);
      inp.addEventListener('input', again);
    });
  });
  var note = f.elements.note, cnt = document.getElementById('le-note-n');
  if (note && cnt) note.addEventListener('input', function () { cnt.textContent = note.value.length + ' / 600'; });

  var busy = false;
  f.addEventListener('submit', function (e) {
    e.preventDefault();
    if (busy) return;
    if (f.elements._gotcha && f.elements._gotcha.value) return;
    var x = fields(), errs = check(x);
    mark(errs);
    var first = Object.keys(RULES).filter(function (k) { return errs[k]; })[0];
    if (first) { try { target(first).focus(); } catch (err) {} return; }
    var p = payload(x);
    /* What Formspree gets if the worker cannot take it. */
    var fd = { _subject: subject(p), form: 'elevator-listing' };
    Object.keys(p).forEach(function (k) { fd[k] = p[k]; });
    busy = true; btn.disabled = true;
    var was = btn.textContent;
    btn.textContent = 'Sending…';
    out.innerHTML = '';
    var send = root.agsistFormPost || function () { return Promise.reject(new Error('no form helper')); };
    send('elevator-listing', p, fd)
      .then(function () {
        ga('elev_listing_submit', { result: 'ok' });
        sec.classList.add('sent');
        out.innerHTML = '<div class="cl-msg ok"><p><b>Sent.</b> I have your request for ' + esc(p.elevator) + ' in ' + esc(p.town) + ', ' + esc(p.state) + '.</p>' +
          '<p>Next I call the elevator at its own number to make sure you work there. Then I send your link to ' + esc(p.email) +
          '. Nothing shows on the site until you post. Questions: ' + TO + ' or 715-797-2428. Sig</p></div>';
        try { var m = out.querySelector('.cl-msg'); m.setAttribute('tabindex', '-1'); m.focus(); } catch (err) {}
      })
      .catch(function () {
        ga('elev_listing_submit', { result: 'fail' });
        var body = bodyText(p);
        var href = 'mailto:' + TO + '?subject=' + encodeURIComponent(subject(p)) + '&body=' + encodeURIComponent(body);
        out.innerHTML = '<div class="cl-msg bad"><p><b>That did not go through. Nothing was sent.</b></p>' +
          '<p>Send it by email instead. The message is written out for you, addressed to ' + TO + '.</p>' +
          '<div class="cl-acts"><a class="cl-btn2" id="le-mail" href="' + esc(href) + '">Email it instead</a>' +
          '<button type="button" class="cl-btn2" id="le-copy">Copy the message</button></div>' +
          '<textarea id="le-copy-ta" readonly rows="10" aria-label="Your request, as text">' + esc(body) + '</textarea></div>';
        var ml = document.getElementById('le-mail');
        if (ml) { try { ml.focus(); } catch (err) {} }
        var cp = document.getElementById('le-copy');
        if (cp) cp.addEventListener('click', function () {
          var ta = document.getElementById('le-copy-ta');
          var done = function () { cp.textContent = 'Copied'; setTimeout(function () { cp.textContent = 'Copy the message'; }, 2000); };
          ta.select();
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(ta.value).then(done, function () { try { document.execCommand('copy'); done(); } catch (err) {} });
          else { try { document.execCommand('copy'); done(); } catch (err) {} }
        });
      })
      .then(function () { busy = false; btn.disabled = false; btn.textContent = was; });
  });
})(typeof window !== 'undefined' ? window : globalThis);
