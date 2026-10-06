#!/usr/bin/env python3
"""patch_claim_board.py -- 2026-10-01 r7-claim: "Claim your board" on /elevators.

usage: python3 patch_claim_board.py --repo DIR

Patches DIR/elevators.html IN PLACE. Nothing else.

  * Replaces the old mailto-only "Get your bids listed" section (#list-bids)
    with a #claim section: what a free verified listing gets an elevator,
    what it costs (nothing), and the promise (payment never changes bid order
    or ranking). The old #list-bids id is kept on an anchor inside the new
    section so any old link still lands.
  * The form posts to the site's existing Formspree form
    (https://formspree.io/f/xnjbwepn -- already used by /farmland-atlas and
    /sponsor-report, emails Sig). No worker change. If the post fails, the
    page says nothing was sent and offers a prefilled email to
    sig@farmers1st.com plus the same text to copy.
  * Network counts (boards read, elevators known but not read) are read live
    from data/elevator-coverage.json -- the same file the coverage map uses --
    with its as-of time. "Not loaded yet" if the file does not load.
  * Analytics: gaEvent('claim_submit', {result:'ok'|'fail'}). No PII.
  * Adds one FAQ (visible and in the existing FAQPage JSON-LD): can an
    elevator pay to rank higher? No.
  * Removes the old section's CSS and its script (dead once its form is gone).

Anchor-asserted: every old string must match exactly once. Refuses a second run.
"""
import argparse, os, re, sys

MARK = '2026-10-01 r7-claim'


def once(text, old, new, label):
    n = text.count(old)
    if n != 1:
        sys.exit('ANCHOR %s matched %d times, expected 1' % (label, n))
    return text.replace(old, new)


def rx_once(text, pattern, repl, label, flags=re.S):
    m = list(re.finditer(pattern, text, flags))
    if len(m) != 1:
        sys.exit('ANCHOR %s matched %d times, expected 1' % (label, len(m)))
    return text[:m[0].start()] + (repl(m[0]) if callable(repl) else repl) + text[m[0].end():]


def rd(p):
    with open(p, encoding='utf-8', newline='') as f:
        return f.read()


def wr(p, s):
    with open(p, 'w', encoding='utf-8', newline='') as f:
        f.write(s)


STATES = [
    ('AL', 'Alabama'), ('AK', 'Alaska'), ('AZ', 'Arizona'), ('AR', 'Arkansas'),
    ('CA', 'California'), ('CO', 'Colorado'), ('CT', 'Connecticut'), ('DE', 'Delaware'),
    ('DC', 'District of Columbia'), ('FL', 'Florida'), ('GA', 'Georgia'), ('HI', 'Hawaii'),
    ('ID', 'Idaho'), ('IL', 'Illinois'), ('IN', 'Indiana'), ('IA', 'Iowa'),
    ('KS', 'Kansas'), ('KY', 'Kentucky'), ('LA', 'Louisiana'), ('ME', 'Maine'),
    ('MD', 'Maryland'), ('MA', 'Massachusetts'), ('MI', 'Michigan'), ('MN', 'Minnesota'),
    ('MS', 'Mississippi'), ('MO', 'Missouri'), ('MT', 'Montana'), ('NE', 'Nebraska'),
    ('NV', 'Nevada'), ('NH', 'New Hampshire'), ('NJ', 'New Jersey'), ('NM', 'New Mexico'),
    ('NY', 'New York'), ('NC', 'North Carolina'), ('ND', 'North Dakota'), ('OH', 'Ohio'),
    ('OK', 'Oklahoma'), ('OR', 'Oregon'), ('PA', 'Pennsylvania'), ('RI', 'Rhode Island'),
    ('SC', 'South Carolina'), ('SD', 'South Dakota'), ('TN', 'Tennessee'), ('TX', 'Texas'),
    ('UT', 'Utah'), ('VT', 'Vermont'), ('VA', 'Virginia'), ('WA', 'Washington'),
    ('WV', 'West Virginia'), ('WI', 'Wisconsin'), ('WY', 'Wyoming'),
]
STATE_OPTS = '\n'.join('          <option value="%s">%s</option>' % s for s in STATES)

CSS = """<style>
/* ===== 2026-10-01 r7-claim: "Claim your board" section on /elevators =====
   Hairlines, not boxes. Text colours only; the one gold thing is the submit
   (it replaces the old section's gold submit, so the page's gold count does
   not go up) plus the site-wide focus ring. Not ad orange: this is not ad
   space and nothing here is sold. */
.cl{margin:2.4rem 0 1.8rem;padding-top:1.5rem;border-top:1px solid var(--border-2);scroll-margin-top:84px}
.cl-alias{display:block;height:0;overflow:hidden}
.cl-kick{font-family:var(--font-mono);font-size:.75rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--text-muted);margin:0 0 .5rem}
.cl h2{font-family:var(--font-display);font-size:1.6rem;font-weight:800;line-height:1.1;letter-spacing:-.01em;color:var(--text);margin:0 0 .6rem}
@media(min-width:640px){.cl h2{font-size:2rem}}
.cl-lede{font-size:1rem;color:var(--text-dim);line-height:1.6;max-width:62ch;margin:0 0 1.5rem}
.cl-net{font-family:var(--font-body);font-size:.875rem;color:var(--text-muted);line-height:1.6;margin:0 0 1.5rem;max-width:70ch}
.cl-net .num{font-family:var(--font-mono);font-variant-numeric:tabular-nums;color:var(--text);font-weight:600}
.cl-pts{display:grid;grid-template-columns:1fr;margin:0 0 1.25rem;padding:0;list-style:none;border-top:1px solid var(--border)}
.cl-pt{padding:1rem 0;border-bottom:1px solid var(--border)}
@media(min-width:800px){
  .cl-pts{grid-template-columns:repeat(3,1fr)}
  .cl-pt{padding:1rem 1.5rem 1rem 0}
  .cl-pt+.cl-pt{padding-left:1.5rem;border-left:1px solid var(--border)}
}
.cl-pt-k{font-family:var(--font-mono);font-size:.75rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--text-muted);margin:0 0 .4rem}
.cl-pt-h{font-family:var(--font-display);font-size:1.05rem;font-weight:700;color:var(--text);margin:0 0 .35rem;line-height:1.3}
.cl-pt p{font-size:.875rem;color:var(--text-dim);line-height:1.6;margin:0}
.cl-pt ul{margin:.1rem 0 0;padding:0 0 0 1.05rem;font-size:.875rem;color:var(--text-dim);line-height:1.6}
.cl-pt li{margin:0 0 .2rem}
.cl-soon{font-size:.875rem;color:var(--text-dim);line-height:1.6;margin:0 0 1.5rem;max-width:70ch}
.cl-form{display:grid;grid-template-columns:1fr 1fr;gap:1rem 1.25rem;max-width:760px}
.cl-f{display:flex;flex-direction:column;gap:.35rem;min-width:0}
.cl-f.full{grid-column:1/-1}
.cl-f label{font-family:var(--font-mono);font-size:.75rem;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted)}
.cl-f label .opt{text-transform:none;letter-spacing:0;font-weight:400}
.cl-f input,.cl-f select{background:var(--bg);border:1px solid var(--border-2);border-radius:var(--r-sm);padding:.6rem .75rem;font-family:var(--font-body);font-size:.95rem;color:var(--text);min-height:44px;width:100%}
.cl-f select{appearance:auto}
.cl-f input:focus,.cl-f select:focus{outline:2px solid var(--gold);outline-offset:1px;border-color:var(--border-2)}
.cl-f input[aria-invalid="true"],.cl-f select[aria-invalid="true"]{border-color:var(--red)}
.cl-err{font-size:.8rem;color:var(--red);line-height:1.4;margin:0;min-height:0}
.cl-err:empty{display:none}
.cl-chk{grid-column:1/-1;display:flex;gap:.75rem;align-items:center;min-height:44px;font-size:.9rem;color:var(--text-dim);line-height:1.45;cursor:pointer}
.cl-chk input{width:20px;height:20px;flex:none;margin:0;accent-color:var(--text)}
.cl-go{grid-column:1/-1;display:flex;flex-wrap:wrap;align-items:center;gap:.75rem 1rem}
.cl-btn{display:inline-flex;align-items:center;justify-content:center;padding:.75rem 1.4rem;border:0;border-radius:var(--r-sm);background:var(--gold-fill,var(--gold));color:#0a0c0d;font-family:var(--font-mono);font-size:.85rem;font-weight:700;letter-spacing:.03em;cursor:pointer;min-height:44px;transition:filter .15s}
.cl-btn:hover{filter:brightness(1.07)}
.cl-btn:active{filter:brightness(.92)}
.cl-btn:disabled{opacity:.6;cursor:default}
.cl-btn2{display:inline-flex;align-items:center;justify-content:center;padding:.65rem 1.1rem;border:1px solid var(--border-2);border-radius:var(--r-sm);background:transparent;color:var(--text);font-family:var(--font-mono);font-size:.8rem;font-weight:600;text-decoration:none;cursor:pointer;min-height:44px}
.cl-btn2:hover{border-color:var(--text-muted)}
.cl-note{font-size:.8rem;color:var(--text-muted);line-height:1.55;margin:0;flex:1 1 260px}
.cl-note a{color:var(--text-dim)}
.cl-hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
.cl-out{grid-column:1/-1}
.cl-out:empty{display:none}
.cl-msg{border-top:1px solid var(--border-2);border-bottom:1px solid var(--border-2);padding:1rem 0;font-size:.95rem;color:var(--text);line-height:1.6;max-width:760px}
.cl-msg p{margin:0 0 .6rem}
.cl-msg p:last-child{margin-bottom:0}
.cl-msg.ok{border-left:2px solid var(--green);padding-left:1rem}
.cl-msg.bad{border-left:2px solid var(--red);padding-left:1rem}
.cl-msg .cl-acts{display:flex;flex-wrap:wrap;gap:.6rem;margin-top:.75rem}
.cl-msg textarea{width:100%;font-family:var(--font-mono);font-size:.8rem;line-height:1.5;background:var(--bg);color:var(--text-dim);border:1px solid var(--border-2);border-radius:var(--r-sm);padding:.6rem;margin-top:.6rem}
.cl.sent .cl-form{display:none}
@media(max-width:600px){
  .cl-form{grid-template-columns:1fr}
  .cl-f input,.cl-f select{font-size:16px}
  .cl-btn{width:100%}
}
</style>
"""

SECTION = """<section class="cl" id="claim" aria-labelledby="cl-h">
    <span class="cl-alias" id="list-bids"></span>
    <p class="cl-kick">For elevators and co-ops</p>
    <h2 id="cl-h">Run an elevator? Claim your board.</h2>
    <p class="cl-lede">Producers in your area already look up bids here. Claim your listing so what they see is right: your name, your town, your phone and your own board.</p>
    <p class="cl-net" id="cl-net">Network counts: Not loaded yet.</p>
    <ul class="cl-pts">
      <li class="cl-pt">
        <p class="cl-pt-k">What you get</p>
        <p class="cl-pt-h">A verified listing</p>
        <ul>
          <li>Your elevator&rsquo;s name and town, checked with you</li>
          <li>Your phone on the call button beside your bids</li>
          <li>Your own posted board read through the trading day and marked &ldquo;direct from the elevator&rdquo;</li>
        </ul>
        <p style="margin-top:.35rem">Hours and a link to your bid page are not on the results yet. Send the link now and it is on file.</p>
      </li>
      <li class="cl-pt">
        <p class="cl-pt-k">What it costs</p>
        <p class="cl-pt-h">Nothing</p>
        <p>The listing is free and stays free. No contract, no card.</p>
      </li>
      <li class="cl-pt">
        <p class="cl-pt-k">The promise</p>
        <p class="cl-pt-h">Money never moves a bid</p>
        <p>Payment never changes bid order or ranking. Bids are shown as you posted them, with the time they were read.</p>
      </li>
    </ul>
    <p class="cl-soon">Coming later: a hosted bid board, or an embed for your own website. Tick the box in the form to hear about it.</p>

    <form class="cl-form" id="cl-form" novalidate data-track="claim_board">
      <input type="text" name="_gotcha" class="cl-hp" tabindex="-1" autocomplete="off" aria-hidden="true">
      <div class="cl-f full">
        <label for="cl-elev">Elevator or co-op name</label>
        <input id="cl-elev" name="elevator" type="text" autocomplete="organization" maxlength="120" required aria-describedby="cl-elev-e">
        <p class="cl-err" id="cl-elev-e" aria-live="polite"></p>
      </div>
      <div class="cl-f">
        <label for="cl-town">Town</label>
        <input id="cl-town" name="town" type="text" autocomplete="address-level2" maxlength="80" required aria-describedby="cl-town-e">
        <p class="cl-err" id="cl-town-e" aria-live="polite"></p>
      </div>
      <div class="cl-f">
        <label for="cl-state">State</label>
        <select id="cl-state" name="state" autocomplete="address-level1" required aria-describedby="cl-state-e">
          <option value="">Choose a state</option>
%s
        </select>
        <p class="cl-err" id="cl-state-e" aria-live="polite"></p>
      </div>
      <div class="cl-f">
        <label for="cl-name">Your name</label>
        <input id="cl-name" name="contact_name" type="text" autocomplete="name" maxlength="80" required aria-describedby="cl-name-e">
        <p class="cl-err" id="cl-name-e" aria-live="polite"></p>
      </div>
      <div class="cl-f">
        <label for="cl-role">Your role</label>
        <input id="cl-role" name="role" type="text" autocomplete="organization-title" maxlength="80" placeholder="Manager, merchandiser" required aria-describedby="cl-role-e">
        <p class="cl-err" id="cl-role-e" aria-live="polite"></p>
      </div>
      <div class="cl-f">
        <label for="cl-email">Work email</label>
        <input id="cl-email" name="email" type="email" autocomplete="email" maxlength="254" required aria-describedby="cl-email-e">
        <p class="cl-err" id="cl-email-e" aria-live="polite"></p>
      </div>
      <div class="cl-f">
        <label for="cl-phone">Phone <span class="opt">(optional)</span></label>
        <input id="cl-phone" name="phone" type="tel" autocomplete="tel" maxlength="30" aria-describedby="cl-phone-e">
        <p class="cl-err" id="cl-phone-e" aria-live="polite"></p>
      </div>
      <div class="cl-f full">
        <label for="cl-url">Page where you post bids <span class="opt">(optional)</span></label>
        <input id="cl-url" name="bid_page_url" type="url" inputmode="url" autocomplete="url" maxlength="300" placeholder="https://" aria-describedby="cl-url-e">
        <p class="cl-err" id="cl-url-e" aria-live="polite"></p>
      </div>
      <label class="cl-chk"><input type="checkbox" name="hosted_board" value="yes"> Tell me about a hosted bid board for our website</label>
      <div class="cl-go">
        <button type="submit" class="cl-btn" id="cl-send">Claim our board</button>
        <p class="cl-note">Goes to Sig at <a href="mailto:sig@farmers1st.com">sig@farmers1st.com</a> through Formspree. Nothing changes on the site until he confirms it with you.</p>
      </div>
    </form>
    <div class="cl-out" id="cl-out" role="status" aria-live="polite"></div>
  </section>""" % STATE_OPTS

FAQ_VISIBLE = """    <div class="el-faq-item">
      <div class="el-faq-q" role="button" tabindex="0" aria-expanded="false">Can an elevator pay to rank higher?</div>
      <div class="el-faq-a"><div class="el-faq-ai">No. Listing is free, and payment never changes bid order or ranking. Bids are shown as the elevator posted them, with the time they were read. Elevators can <a href="#claim">claim their board</a> to check their name, town and phone.</div></div>
    </div>
  </div>

  <div class="el-disc">"""

FAQ_LD = """    {"@type":"Question","name":"Can an elevator pay to rank higher?",
     "acceptedAnswer":{"@type":"Answer","text":"No. Listing is free, and payment never changes bid order or ranking. Bids are shown as the elevator posted them, with the time they were read. Elevators can claim their board to check their name, town and phone."}}
  ]}
]}
</script>"""

JS = r"""<script>
/* ===== 2026-10-01 r7-claim: "Claim your board" form =====
   WHERE IT GOES: the site's existing Formspree form, the same one
   /farmland-atlas and /sponsor-report post to, which emails Sig. Fields:
   _subject, form, elevator, town, state, contact_name, role, email, phone,
   bid_page_url, hosted_board, page (+ the _gotcha honeypot). Nothing else.
   IF IT FAILS the page says nothing was sent and hands over the same text as
   a prefilled email and as text to copy. A claim that quietly vanishes is the
   worst thing this form could do.
   ANALYTICS: claim_submit with result ok|fail. No field values, ever. */
(function () {
  'use strict';
  var FORM_URL = 'https://formspree.io/f/xnjbwepn';
  var TO = 'sig@farmers1st.com';
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  var f = document.getElementById('cl-form');
  var out = document.getElementById('cl-out');
  var sec = document.getElementById('claim');
  if (!f || !out || !sec) return;
  function ga(n, p) { try { if (window.gaEvent) window.gaEvent(n, p); } catch (e) {} }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function v(n) { var e = f.elements[n]; return e ? String(e.value || '').trim() : ''; }

  /* ---- network counts, from the file the coverage map already reads ---- */
  function fmtCT(iso) {
    var t = Date.parse(iso || '');
    if (isNaN(t)) return '';
    try {
      var d = new Date(t);
      var day = d.toLocaleDateString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric' });
      var tm = d.toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' });
      return day + ', ' + tm + ' CT';
    } catch (e) { return ''; }
  }
  function paintNet(d) {
    var el = document.getElementById('cl-net');
    var n = d && d.counts;
    if (!el || !n || typeof n.read !== 'number' || typeof n.known !== 'number') return;
    var when = fmtCT(d.directoryGenerated || d.generated);
    el.innerHTML = 'In the read ' + (when ? 'of ' + esc(when) : 'this page was built from') +
      ', AGSIST read <span class="num">' + n.read.toLocaleString('en-US') + '</span> elevator boards direct. ' +
      'It knows <span class="num">' + n.known.toLocaleString('en-US') + '</span> more elevators whose boards it does not read yet. ' +
      '<a href="#coverage-map">See the map</a>.';
  }
  /* /elevators#claim: the map and its counts load after the browser has
     jumped to the anchor and push the section down. Put it back in view once
     they settle, unless the reader has already started scrolling. */
  var moved = false;
  ['wheel', 'touchstart', 'keydown', 'mousedown'].forEach(function (ev) {
    window.addEventListener(ev, function () { moved = true; }, { passive: true, once: true });
  });
  function reland() {
    if (moved || location.hash !== '#claim') return;
    var top = sec.getBoundingClientRect().top;
    if (Math.abs(top - 84) > 24) { try { sec.scrollIntoView(); } catch (e) {} }
  }
  function paintNetAndLand(d) { paintNet(d); setTimeout(reland, 250); }
  window.__agClaimNet = paintNetAndLand;
  if (window.__agCov) paintNetAndLand(window.__agCov);
  window.addEventListener('load', function () { setTimeout(reland, 600); setTimeout(reland, 2000); });

  var btn = document.getElementById('cl-send');

  /* ---- validation ---- */
  var RULES = {
    elevator: function (s) { return s ? '' : 'Enter the elevator or co-op name.'; },
    town: function (s) { return s ? '' : 'Enter the town.'; },
    state: function (s) { return s ? '' : 'Choose a state.'; },
    contact_name: function (s) { return s ? '' : 'Enter your name.'; },
    role: function (s) { return s ? '' : 'Enter your role, for example manager or merchandiser.'; },
    email: function (s) {
      if (!s) return 'Enter your work email.';
      return EMAIL_RE.test(s) && s.length <= 254 ? '' : 'That email does not look complete. Check it for a typo.';
    },
    phone: function (s) {
      if (!s) return '';
      var d = s.replace(/\D/g, '');
      return d.length >= 10 && d.length <= 15 ? '' : 'Enter a full phone number with area code, or leave it blank.';
    },
    bid_page_url: function (s) {
      if (!s) return '';
      var u = /^https?:\/\//i.test(s) ? s : 'https://' + s;
      try { var p = new URL(u); return /\./.test(p.hostname) ? '' : 'Enter a full web address, or leave it blank.'; }
      catch (e) { return 'Enter a full web address, or leave it blank.'; }
    }
  };
  function check(name) {
    var inp = f.elements[name];
    if (!inp) return '';
    var msg = RULES[name](v(name));
    var err = document.getElementById(inp.id + '-e');
    if (err) err.textContent = msg;
    if (msg) inp.setAttribute('aria-invalid', 'true'); else inp.removeAttribute('aria-invalid');
    return msg;
  }
  Object.keys(RULES).forEach(function (name) {
    var inp = f.elements[name];
    if (!inp) return;
    /* Not when focus is moving to the submit button: an error line appearing
       on mousedown pushes the button down and the click misses it. The
       submit handler checks every field anyway. */
    inp.addEventListener('blur', function (ev) {
      if (ev.relatedTarget === btn) return;
      if (v(name) || inp.getAttribute('aria-invalid')) check(name);
    });
    inp.addEventListener(inp.tagName === 'SELECT' ? 'change' : 'input', function () {
      if (inp.getAttribute('aria-invalid')) check(name);
    });
  });

  function normUrl(s) { return !s ? '' : (/^https?:\/\//i.test(s) ? s : 'https://' + s); }
  function fields() {
    return {
      elevator: v('elevator'), town: v('town'), state: v('state'),
      contact_name: v('contact_name'), role: v('role'), email: v('email'),
      phone: v('phone'), bid_page_url: normUrl(v('bid_page_url')),
      hosted_board: f.elements.hosted_board && f.elements.hosted_board.checked ? 'yes' : 'no'
    };
  }
  function subject(x) { return 'Claim your board: ' + x.elevator + ', ' + x.town + ' ' + x.state; }
  function bodyText(x) {
    return [
      'Elevator or co-op: ' + x.elevator,
      'Town: ' + x.town,
      'State: ' + x.state,
      '',
      'Contact: ' + x.contact_name,
      'Role: ' + x.role,
      'Work email: ' + x.email,
      'Phone: ' + (x.phone || '(not given)'),
      'Bid page: ' + (x.bid_page_url || '(not given)'),
      '',
      'Tell me about a hosted bid board: ' + x.hosted_board,
      '',
      'Sent from agsist.com/elevators#claim'
    ].join('\n');
  }

  var busy = false;
  f.addEventListener('submit', function (e) {
    e.preventDefault();
    if (busy) return;
    if (f.elements._gotcha && f.elements._gotcha.value) return;
    var first = null;
    Object.keys(RULES).forEach(function (name) {
      if (check(name) && !first) first = f.elements[name];
    });
    if (first) { try { first.focus(); } catch (err) {} return; }

    var x = fields();
    var fd = new FormData();
    fd.append('_subject', subject(x));
    fd.append('form', 'claim-board');
    Object.keys(x).forEach(function (k) { fd.append(k, x[k]); });
    fd.append('page', '/elevators#claim');
    busy = true;
    btn.disabled = true;
    var was = btn.textContent;
    btn.textContent = 'Sending…';
    out.innerHTML = '';

    fetch(FORM_URL, { method: 'POST', body: fd, headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json().catch(function () { return {}; }) : null; })
      .then(function (j) {
        if (!j || j.ok === false || j.errors) throw 0;
        ga('claim_submit', { result: 'ok' });
        sec.classList.add('sent');
        out.innerHTML = '<div class="cl-msg ok"><p><b>Sent.</b> Sig has your claim for ' + esc(x.elevator) +
          ' in ' + esc(x.town) + ', ' + esc(x.state) + '.</p><p>He replies to ' + esc(x.email) +
          ' to confirm you work there. Nothing changes on the site until then.</p></div>';
        try { out.querySelector('.cl-msg').setAttribute('tabindex', '-1'); out.querySelector('.cl-msg').focus(); } catch (err) {}
      })
      .catch(function () {
        ga('claim_submit', { result: 'fail' });
        var body = bodyText(x);
        var href = 'mailto:' + TO + '?subject=' + encodeURIComponent(subject(x)) + '&body=' + encodeURIComponent(body);
        out.innerHTML = '<div class="cl-msg bad"><p><b>That did not go through. Nothing was sent.</b></p>' +
          '<p>Send it by email instead. The message is written out for you, addressed to ' + TO + '.</p>' +
          '<div class="cl-acts"><a class="cl-btn2" id="cl-mail" href="' + esc(href) + '">Email it instead</a>' +
          '<button type="button" class="cl-btn2" id="cl-copy">Copy the message</button></div>' +
          '<textarea id="cl-copy-ta" readonly rows="9" aria-label="Your claim, as text">' + esc(body) + '</textarea></div>';
        /* The submit button is disabled while sending, so focus fell to the
           page body. Put it on the way out instead (panel F25). */
        var ml = document.getElementById('cl-mail');
        if (ml) { try { ml.focus(); } catch (err) {} }
        var cp = document.getElementById('cl-copy');
        if (cp) cp.addEventListener('click', function () {
          var ta = document.getElementById('cl-copy-ta');
          if (!ta) return;
          var done = function () { cp.textContent = 'Copied'; setTimeout(function () { cp.textContent = 'Copy the message'; }, 2000); };
          ta.select();
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(ta.value).then(done, function () { try { document.execCommand('copy'); done(); } catch (err) {} });
          else { try { document.execCommand('copy'); done(); } catch (err) {} }
        });
      })
      .then(function () { busy = false; btn.disabled = false; btn.textContent = was; });
  });
})();
</script>
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--repo', required=True)
    a = ap.parse_args()
    p = os.path.join(a.repo, 'elevators.html')
    t = rd(p)
    if MARK in t:
        sys.exit('patch_claim_board: already applied to %s (marker "%s" found); refusing a second run' % (p, MARK))

    # 1. old section -> #claim
    t = rx_once(t, r'<section class="el-list" id="list-bids">.*?</section>', lambda m: SECTION, 'old-list-section')

    # 2. old section CSS out (dead once its markup is gone)
    t = rx_once(t, '/\\* lead funnel \u2014 list your bids \\*/\n.*?@media\\(max-width:560px\\)\\{\\.el-form\\{grid-template-columns:1fr\\}\\}\n\n', '', 'old-list-css')

    # 3. old section script out (it returned early without its form anyway)
    t = rx_once(t, r"\(function\(\)\{\n  var f=document\.getElementById\('el-list-form'\); if\(!f\)return;\n.*?\n\}\)\(\);\n(?=\(function\(\)\{var zf=)",
                '', 'old-list-js')

    # 4. coverage counts: hand the file the map already fetched to the claim section
    t = once(t, "set('cov-n-read', n.read); set('cov-n-quiet', n.quiet); set('cov-n-known', n.known);",
             "set('cov-n-read', n.read); set('cov-n-quiet', n.quiet); set('cov-n-known', n.known);\n"
             "      /* r7-claim: the claim section prints the same counts. */\n"
             "      try { window.__agCov = d; if (window.__agClaimNet) window.__agClaimNet(d); } catch (e) {}",
             'cov-counts')

    # 5. FAQ: visible item + JSON-LD
    t = once(t, "    </div>\n  </div>\n\n  <div class=\"el-disc\">", "    </div>\n" + FAQ_VISIBLE, 'faq-visible')
    t = once(t, "with no elevator paying for placement.\"}}\n  ]}\n]}\n</script>",
             "with no elevator paying for placement.\"}},\n" + FAQ_LD, 'faq-ld')

    # 6. CSS before </head>, JS before </body>
    if t.count('</head>') != 1:
        sys.exit('ANCHOR </head> matched %d times, expected 1' % t.count('</head>'))
    t = t.replace('</head>', CSS + '</head>', 1)
    if t.count('</body>') != 1:
        sys.exit('ANCHOR </body> matched %d times, expected 1' % t.count('</body>'))
    t = t.replace('</body>', JS + '</body>', 1)

    wr(p, t)
    print('patch_claim_board: patched %s' % p)


if __name__ == '__main__':
    main()
