#!/usr/bin/env python3
"""Consent option B, site-wide (2026-10-01).

Sig's call: honor Global Privacy Control and Do Not Track, an off switch on
the privacy page, no cookie banner, Google signals off.

  1  Every Google Analytics loader becomes a guard. gtag.js is not requested
     at all when navigator.globalPrivacyControl is true, when Do Not Track is
     "1"/"yes", or when localStorage 'agsist-ga-off' is '1'. window.dataLayer
     and window.gtag always exist, so page code that calls them never throws.
     Covers: inline GA on root pages, components/analytics.html (the loader's
     copy for hail and hail-map pages), the three generators and every page
     they already wrote (Atlas, Daily archive, rent).
  2  privacy.html rewritten to say only true things, with a working switch.
  3  cookies.html and terms.html agree with it.
  4  Owner disclosure on about.html, sponsor.html, and next to any sponsor
     disclosure that mentions insurance (components/sponsor-ad.js and
     generate_daily.build_sponsor_block, which feeds every other surface).

Runs LAST in the chain. On index.html it touches only the GA loader tag.
Every anchor must match exactly once or the script stops. A second run is
refused. Same input, byte-identical output.

Usage: python3 consent_b.py --repo DIR
"""
import argparse, os, re, sys

MARK = 'agsist-ga-guard'

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

# ─────────────────────────────────────────────────────────────── the guard
TAG = '<script async src="https://www.googletagmanager.com/gtag/js?id=G-6KXCTD5Z9H"></script>'

# No double quotes and no backslashes in here, so the same text drops into a
# plain Python string, a triple-quoted f-string (after brace doubling) and HTML.
GUARD = (
    "<script>/* " + MARK + " 2026-10-01: Google Analytics loads only when the browser sends "
    "no Global Privacy Control or Do Not Track signal and the off switch on /privacy is not set. "
    "dataLayer and gtag always exist, so page code that calls them never throws. */"
    "(function(w,d,n){var off=false,v,i,s;w.dataLayer=w.dataLayer||[];"
    "if(typeof w.gtag!=='function'){w.gtag=function(){w.dataLayer.push(arguments);};}"
    "try{off=w.localStorage.getItem('agsist-ga-off')==='1';}catch(e){}"
    "if(n.globalPrivacyControl===true){off=true;}"
    "v=[n.doNotTrack,w.doNotTrack,n.msDoNotTrack];"
    "for(i=0;i<v.length;i++){if(v[i]==='1'||v[i]==='yes'){off=true;}}"
    "w.agsistGaOff=off;"
    "w.gtag('set','allow_google_signals',false);"
    "w.gtag('set','allow_ad_personalization_signals',false);"
    "if(off){return;}"
    "s=d.createElement('script');s.async=true;"
    "s.src='https://www.googletagmanager.com/gtag/js?id=G-6KXCTD5Z9H';"
    "(d.head||d.documentElement).appendChild(s);"
    "})(window,document,navigator);</script>"
)
assert '"' not in GUARD and '\\' not in GUARD
GUARD_F = GUARD.replace('{', '{{').replace('}', '}}')   # for f-string / .format templates

SKIP_DIRS = {'.git', 'build', 'node_modules', '__pycache__'}

def html_files(repo):
    out = []
    for dp, dn, fn in os.walk(repo):
        dn[:] = sorted(d for d in dn if d not in SKIP_DIRS)
        for f in sorted(fn):
            if f.endswith('.html'):
                out.append(os.path.join(dp, f))
    return out

# ───────────────────────────────────────────── 4: owner disclosure wording
OWNER_SPONSOR = ("AGSIST's founder also owns Farmers First Agri Service LLC in Chetek, WI "
                 "(crop insurance, agronomy and ag technology services; a licensed crop-insurance agency) "
                 "and Loke Drone LC (agricultural drone spraying), which may compete with this sponsor. "
                 "Sponsors never change data, rankings or bid order.")
# Sponsor lines that may compete with either business. Matched against the
# sponsor's advertiser, headline, body and disclosure; never on the house ad.
OWNER_RX = 'insurance|spray|drone|aerial|agronom|fertili'
assert '"' not in OWNER_RX and "'" not in OWNER_RX
assert '"' not in OWNER_SPONSOR

# ─────────────────────────────────────────────────────────── privacy.html
PRIVACY_DESC_OLD = 'content="Privacy Policy for AGSIST. Short version: almost nothing is collected, nothing is sold, and your location never leaves your browser."'
PRIVACY_DESC_NEW = 'content="What AGSIST collects, who processes it, how long it is kept, and how to turn analytics off. Global Privacy Control and Do Not Track are honored. Nothing is sold."'
PRIVACY_OG_OLD = 'content="AGSIST collects almost nothing, sells nothing, and respects your time. Location stays in your browser. Email only used to deliver what you signed up for."'
PRIVACY_OG_NEW = 'content="What AGSIST collects, who processes it, and how to turn analytics off. Global Privacy Control and Do Not Track are honored. Nothing is sold."'
PRIVACY_TW_OLD = 'content="AGSIST collects almost nothing and sells nothing. Your location never leaves your browser."'
PRIVACY_TW_NEW = 'content="What AGSIST collects and how to turn analytics off. Global Privacy Control and Do Not Track are honored. Nothing is sold."'

PRIVACY_CSS_ANCHOR = '    @media (max-width: 520px) {\n      .legal-page { padding: 1.5rem .9rem 3rem }'
PRIVACY_CSS = '''    /* 2026-10-01 consent B: the analytics switch. Hairlines, no new colours. */
    .ga-switch { margin: .5rem 0 1.5rem; padding: 4px 0 12px; border-bottom: 1px solid var(--border) }
    .ga-switch .ga-state { color: var(--text); font-size: .88rem; line-height: 1.6; margin: 0 0 12px }
    .ga-switch .ga-note { color: var(--text-muted); font-size: .82rem; line-height: 1.6; margin: 12px 0 0 }
    .ga-switch button { min-height: 44px; padding: 8px 16px; font: inherit; font-size: .88rem; font-weight: 600; color: var(--text); background: transparent; border: 1px solid var(--border); border-radius: 6px; cursor: pointer }
    .ga-switch button:hover { border-color: var(--text-dim) }
    .ga-switch button:active { transform: translateY(1px) }
    .ga-switch button:focus-visible { outline: 2px solid var(--gold); outline-offset: 2px }
    .ga-switch button:disabled { opacity: .5; cursor: not-allowed }
    .legal-page .keys li { margin-bottom: .2rem }
    @media (max-width: 520px) { .ga-switch button { width: 100%; font-size: 16px } }
'''

PRIVACY_MAIN = '''<main id="main" tabindex="-1">
    <div class="legal-page">

      <h1>Privacy Policy</h1>
      <p class="updated">Last updated: Oct 1, 2026</p>

      <div class="tldr">
        <strong>Plain English</strong>
        AGSIST counts visits with Google Analytics, unless your browser asks not to be tracked or you turn it off below. If you give me your email, it is used for what you signed up for and kept until you stop. Some features send what they need, like a ZIP code, to the services named on this page. Nothing is sold.
      </div>

      <h2 id="analytics">Analytics: On or Off</h2>
      <div class="ga-switch" id="ga-switch">
        <p class="ga-state" id="ga-state" role="status" aria-live="polite">Checking this browser&hellip;</p>
        <button type="button" id="ga-toggle" aria-pressed="false" disabled>Turn analytics off</button>
        <p class="ga-note" id="ga-signal" hidden>Your browser sends a do-not-track signal, and that keeps analytics off on every AGSIST page. The switch comes back if you turn the signal off in your browser.</p>
        <noscript><p class="ga-note">The switch needs JavaScript. With JavaScript off, Google Analytics does not load either.</p></noscript>
      </div>
      <p>The switch is saved in this browser only, under the name <code>agsist-ga-off</code>. It does not follow you to another browser or device, and clearing your browser data clears it.</p>

      <h2>What Is Collected</h2>
      <ul>
        <li><strong>Visits, through Google Analytics 4.</strong> Only when analytics is on. Google records the pages you open, the site that sent you, your device, browser and screen size, a rough location it works out from your IP address, and events such as a click on a module, a calculator used, or a sponsor seen. Cookies with a random ID let repeat visits count as one reader. Google signals and ad personalization are switched off in the site&rsquo;s code. On the cash bids page and the basis box on the corn, soybean and wheat futures pages, the ZIP code you search is sent along with the search event.</li>
        <li><strong>Settings in your browser.</strong> Your last location and ZIP, calculator inputs, saved Field Scout fields, theme and similar choices are kept in your browser&rsquo;s local storage so the tools remember your work. They stay on your device. The full list is under Cookies and Local Storage below.</li>
        <li><strong>A location you give.</strong> Your browser&rsquo;s location, if you allow it, or a ZIP code you type. It is sent to the service that answers the question (weather, a place name, nearby cash bids), as listed below.</li>
        <li><strong>Your email, if you sign up.</strong> For the AGSIST Daily, a price alert, an elevator watch, a county watch or a hail alert, together with what you asked to watch. Details are under Alerts and Watches below.</li>
        <li><strong>What you send me.</strong> Emails you write to me, and three forms that go through Formspree: the Parcel Report waitlist, the sponsor approval form, and the elevator claim form on the <a href="/elevators">elevators page</a>. The claim form sends the business name, town and state, a contact name and role, a work email, a phone number and bid-page address if you give them, and whether you want to hear about a hosted bid board.</li>
      </ul>

      <h2>What Is Not Collected</h2>
      <ul>
        <li>No accounts, no passwords, no payment details.</li>
        <li>No advertising cookies, no retargeting pixels, no cross-site ad tracking.</li>
        <li>Your data is not sold or rented. Sponsors never get your email, your location or what you watch.</li>
      </ul>

      <h2>Who Processes It</h2>
      <p>These services handle part of what the site does. Each one gets only what that feature needs. Every service your browser talks to also sees your IP address, as any website does.</p>
      <ul>
        <li><strong>GitHub Pages</strong> &mdash; hosts the site itself.</li>
        <li><strong>Google Analytics</strong> &mdash; the visit counts described above, when analytics is on.</li>
        <li><strong>Gmail (Google)</strong> &mdash; sends the AGSIST Daily, the alert and watch emails, and their confirmation emails, so Google handles those messages in transit.</li>
        <li><strong>Cloudflare</strong> &mdash; runs AGSIST&rsquo;s small server programs (Workers). They take signups and store your email with what you watch (Cloudflare KV), look up cash bids by ZIP, and answer Field Scout requests. Cloudflare&rsquo;s cdnjs also hosts some code the pages load.</li>
        <li><strong>Barchart</strong> &mdash; the second cash-bid feed. When you look up bids by ZIP, your browser sends the ZIP and search radius to AGSIST&rsquo;s Cloudflare Worker, and the worker asks Barchart for bids near that ZIP. Barchart gets the ZIP from the worker, not from your browser.</li>
        <li><strong>Open-Meteo</strong> &mdash; weather. It receives the coordinates of the place you asked about, and turns a ZIP into a place on the home page&rsquo;s bid search.</li>
        <li><strong>OpenStreetMap Nominatim</strong> &mdash; turns coordinates into a place name.</li>
        <li><strong>National Weather Service (api.weather.gov) and Iowa Environmental Mesonet</strong> &mdash; the hail map loads live storm warnings and the last 24 hours of storm reports from them. The requests carry no location from you.</li>
        <li><strong>Field Scout services</strong> &mdash; a field you draw or look up goes to AGSIST&rsquo;s Cloudflare Worker, which asks USDA (soils, crop history) and Copernicus Sentinel (imagery). Map tiles come from Esri (satellite) and CARTO (base map).</li>
        <li><strong>TradingView</strong> &mdash; the price charts on the corn, soybean and wheat futures pages load from TradingView.</li>
        <li><strong>Windy</strong> &mdash; the radar map on the home page is a frame from Windy.</li>
        <li><strong>Formspree</strong> &mdash; receives the Parcel Report waitlist form on the Farmland Atlas, the approval form on sponsor proofs, and the elevator claim form on the elevators page.</li>
        <li><strong>Google Fonts</strong> &mdash; older Daily archive pages and two Farmland Atlas pages load typefaces from Google. Other pages use fonts served by AGSIST.</li>
        <li><strong>jsDelivr, cdnjs and unpkg</strong> &mdash; host map and chart code some pages load.</li>
      </ul>
      <p>Futures prices (Yahoo Finance) and prediction-market odds are fetched by AGSIST&rsquo;s own scheduled jobs and saved as files on this site. Your browser does not contact those services, and they learn nothing about you.</p>

      <h2 id="alerts">Alerts and Watches</h2>
      <p>Each of these stores your email address on Cloudflare together with what you asked for, and nothing else.</p>
      <ul>
        <li><strong>AGSIST Daily</strong> &mdash; your email, the page you signed up on, and when.</li>
        <li><strong>Price alerts</strong> &mdash; your email, the contract, above or below, and your target price. An alert fires once and is then deleted.</li>
        <li><strong>Elevator watch</strong> &mdash; your email and the elevator you picked.</li>
        <li><strong>County watch</strong> (Farmland Atlas) &mdash; your email and the county codes you watch.</li>
        <li><strong>Hail alerts</strong> &mdash; your email, the spot you pinned, its place name and the radius you chose.</li>
      </ul>
      <p>Price alerts, elevator watches and county watches start only after you confirm from a link in an email. An unconfirmed request is not mailed again, and its link stops working after 14 days. Up to five of each per address.</p>
      <p>Everything is kept until you stop it. Every email carries an unsubscribe link: it opens a page with one button, and pressing it removes you right away. Watch and alert emails let you stop one item or all of them. Mail apps that offer a one-click unsubscribe use the same route. You can also email me and I will remove you by hand. Your browser also keeps its own list of elevators you watch (<code>agsist_watching</code>) so the page can mark them; that list never leaves your device.</p>

      <h2 id="sponsors">Sponsor Impression Counting</h2>
      <p>Sponsors pay to be seen, so the site counts when a sponsor slot is actually seen: at least half of it on screen for one continuous second. When that happens, the page sends one event to Google Analytics with the slot name, the page, and how long the slot was in view. A click on a sponsor link sends a click event the same way.</p>
      <p>It sets no cookie of its own, uses no ID, and stores nothing. Sponsors see totals for their own slots, never anything about one reader. When analytics is off, nothing is counted.</p>

      <h2 id="dnt">Do Not Track and Global Privacy Control</h2>
      <p>If your browser sends Global Privacy Control or Do Not Track, Google Analytics is not loaded at all, on any AGSIST page. No analytics cookies are set, your visit is not counted, and sponsor views are not counted. Everything else on the site works the same. There is no cookie banner because there is nothing to accept: the browser signal and the switch above are the choice.</p>

      <h2 id="cookies">Cookies and Local Storage</h2>
      <p>Cookies:</p>
      <ul>
        <li><code>_ga</code> and <code>_ga_&lt;ID&gt;</code> &mdash; set by Google Analytics, only when analytics is on. They hold a random ID; Google keeps <code>_ga</code> for up to two years.</li>
        <li><code>agsist_subscribed</code> &mdash; set by AGSIST when you sign up for the Daily, for two years, so the signup prompts stop. It is never sent to another site.</li>
      </ul>
      <p>Local storage (stays in your browser):</p>
      <ul class="keys">
        <li>Location: <code>agsist-wx-loc</code>, <code>agsist_user_zip</code>, <code>agsist_zip</code>, <code>agsist_state</code></li>
        <li>Tools: <code>agsist-breakeven</code>, <code>agsist-be-split</code>, <code>agsist_be_&lt;crop&gt;</code>, <code>agsist_priced_&lt;crop&gt;</code>, <code>agsist_gdu</code>, <code>agsist_gbc_v1</code>, <code>agsist-urea-field</code>, <code>agsist-spray-product</code>, <code>agsist-fs-fields</code>, <code>agsist-fs-snap-&lt;id&gt;</code>, <code>agsist-lease-draft</code>, <code>agsist-pd-state</code>, <code>agsist-rma-state</code>, <code>agsist_delivery</code>, <code>cot_market</code></li>
        <li>Display: <code>agsist-theme</code>, <code>agsist-daily-&lt;date&gt;</code>, <code>agsist_visits</code>, <code>agsist_watching</code></li>
        <li>Prompts: <code>agsist_subscribed</code>, <code>agsist_bar_snooze</code>, <code>agsist_pwa_dismissed</code>, <code>agsist_home_prompt_dismissed_v1</code>, <code>agsist_signup_slim_dismissed</code>, <code>agsist_signup_compact_dismissed</code></li>
        <li>Sponsor proofs: <code>agsist_approved_&lt;code&gt;</code></li>
        <li>Privacy: <code>agsist-ga-off</code> (the switch above)</li>
      </ul>
      <p>Clearing your browser data removes all of it. Clearing local storage also resets the theme to dark.</p>

      <h2>How Long It Is Kept</h2>
      <ul>
        <li>Emails and what you watch: until you unsubscribe. A price alert also ends when it fires.</li>
        <li>Browser settings: until you clear them.</li>
        <li>Google Analytics: detailed records for at most 14 months, the longest Google allows for this kind of account.</li>
        <li>Emails you send me: in my mailbox, as with any email.</li>
      </ul>

      <h2>Your Rights</h2>
      <p>You can ask what I hold about you, ask me to correct it, or ask me to delete it. Email <a href="mailto:sig@farmers1st.com">sig@farmers1st.com</a> from the address in question and I will answer myself. You can turn analytics off above, unsubscribe from any email with its link, and clear your browser storage at any time. Your data is not sold or shared for advertising, so there is no sale to opt out of.</p>

      <h2>Who Runs AGSIST</h2>
      <p>AGSIST is run by Sigurd Lindquist, PO Box 243, Chetek, WI 54728. He also owns Farmers First Agri Service LLC (crop insurance, agronomy and ag technology services) and Loke Drone LC (agricultural drone spraying). See the <a href="/about">About page</a>.</p>

      <h2>Changes</h2>
      <p>When this page changes, the date at the top changes with it.</p>

      <div class="contact-line">
        Questions about this policy? <strong style="color:var(--text)">Sigurd Lindquist</strong> &mdash; <a href="tel:+17157972428">715-797-2428</a> &middot; <a href="mailto:sig@farmers1st.com">sig@farmers1st.com</a><br>AGSIST, PO Box 243, Chetek, WI 54728
      </div>

    </div>
  </main>'''

PRIVACY_JS = '''<script>
/* 2026-10-01 consent B: the analytics switch. Sets or clears localStorage
   'agsist-ga-off'; the guard in every page's head reads the same key. */
(function () {
  var K = 'agsist-ga-off', ID = 'G-6KXCTD5Z9H';
  var st = document.getElementById('ga-state'), btn = document.getElementById('ga-toggle'), note = document.getElementById('ga-signal');
  if (!st || !btn) return;
  var offAtLoad = window.agsistGaOff === true;
  function signal() {
    var n = navigator, v = [n.doNotTrack, window.doNotTrack, n.msDoNotTrack], i;
    if (n.globalPrivacyControl === true) return 'Global Privacy Control';
    for (i = 0; i < v.length; i++) if (v[i] === '1' || v[i] === 'yes') return 'Do Not Track';
    return '';
  }
  function stored() {
    try { return window.localStorage.getItem(K) === '1'; } catch (e) { return null; }
  }
  function paint() {
    var s = signal(), o = stored();
    note.hidden = !s;
    if (o === null) {
      btn.disabled = true;
      btn.textContent = 'Turn analytics off';
      btn.setAttribute('aria-pressed', 'false');
      st.textContent = s ? 'Off. Your browser sends ' + s + ', so Google Analytics does not load on any AGSIST page.'
                         : 'This browser blocks site storage, so the switch cannot be saved here.';
      return;
    }
    btn.disabled = false;
    btn.textContent = o ? 'Turn analytics back on' : 'Turn analytics off';
    btn.setAttribute('aria-pressed', o ? 'true' : 'false');
    if (s) {
      /* The browser signal wins. A live switch here would flip to 'back on'
         while analytics stays off, so it is shown off and disabled. */
      btn.disabled = true;
      btn.textContent = 'Kept off by your browser';
      btn.setAttribute('aria-pressed', 'true');
      st.textContent = 'Off. Your browser sends ' + s + ', so Google Analytics does not load on any AGSIST page.';
    }
    else if (o) st.textContent = 'Off in this browser. Google Analytics does not load on AGSIST pages.';
    else if (offAtLoad) st.textContent = 'On. Google Analytics loads from the next AGSIST page you open.';
    else st.textContent = 'On. Google Analytics loads on AGSIST pages in this browser.';
  }
  btn.addEventListener('click', function () {
    var o = stored();
    try {
      if (o) window.localStorage.removeItem(K);
      else window.localStorage.setItem(K, '1');
    } catch (e) {}
    window['ga-disable-' + ID] = !o;   /* stops this page's tag at once, if it loaded */
    paint();
  });
  paint();
})();
</script>
'''

# ─────────────────────────────────────────────────────────── cookies.html
COOKIES_OLD = '<p>The cookie policy is now part of the AGSIST Privacy Policy.</p>'
COOKIES_NEW = ('<p>The cookie policy is now part of the AGSIST Privacy Policy. Google Analytics sets cookies only when '
               'analytics is on; it stays off when your browser sends Global Privacy Control or Do Not Track, or when '
               'you turn it off on that page. The page lists every cookie and local storage key the site uses.</p>')

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--repo', required=True)
    repo = ap.parse_args().repo
    P = lambda *a: os.path.join(repo, *a)

    # ── refuse a second run, before writing anything
    for f in ('components/analytics.html', 'privacy.html', 'scripts/build_atlas_pages.py'):
        if MARK in rd(P(f)) or 'ga-switch' in rd(P(f)):
            sys.exit('consent_b already applied (%s carries the marker); refusing to run twice' % f)

    files = html_files(repo)
    out = {}    # path -> new text (written at the end, after every anchor passed)
    cur = lambda p: out[p] if p in out else rd(p)

    # ── 1a: every page that carries the loader tag inline
    before = 0
    for p in files:
        t = rd(p)
        n = t.count(TAG)
        if not n:
            continue
        rel = os.path.relpath(p, repo)
        if n != 1:
            sys.exit('ANCHOR GA tag in %s matched %d times, expected 1' % (rel, n))
        if rel == os.path.join('components', 'analytics.html'):
            continue    # handled below
        # the config script must follow, or this is not the snippet we know
        i = t.index(TAG) + len(TAG)
        if not re.match(r'\s*<script>\s*window\.dataLayer\s*=\s*window\.dataLayer\s*\|\|\s*\[\];\s*function gtag\(\)', t[i:]):
            sys.exit('ANCHOR GA config after tag in %s not recognised' % rel)
        before += 1
        out[p] = t.replace(TAG, GUARD, 1)

    # ── 1b: components/analytics.html (hail and hail-map pages get GA from here)
    p = P('components', 'analytics.html'); t = rd(p)
    t = once(t, TAG, GUARD, 'analytics.html tag')
    t = once(t, "  gtag('config', 'G-6KXCTD5Z9H', {\n    cookie_flags: 'SameSite=None;Secure',\n    send_page_view: true\n  });",
             "  gtag('config', 'G-6KXCTD5Z9H', {\n    send_page_view: true\n  });",
             'analytics.html config')
    t = once(t, '     5. Commit and push — analytics will activate site-wide instantly\n',
             '     5. Commit and push — analytics will activate site-wide instantly\n'
             '     2026-10-01 consent B: the guard script loads gtag.js only when the browser\n'
             '     sends no Global Privacy Control / Do Not Track and localStorage\n'
             '     agsist-ga-off is not 1. The same guard is inline on every page that\n'
             '     carries GA itself; cookie_flags dropped to match those pages.\n',
             'analytics.html comment')
    out[p] = t

    # ── 1c: generators
    p = P('scripts', 'build_atlas_pages.py'); t = rd(p)
    t = once(t, 'GA = ("<script async src=\\"https://www.googletagmanager.com/gtag/js?id=G-6KXCTD5Z9H\\"></script>\\n"',
             'GA = ("' + GUARD + '\\n"', 'build_atlas_pages GA')
    out[p] = t
    for f, label in (('generate_daily.py', 'generate_daily GA'), ('build_state_rent_pages.py', 'build_state_rent_pages GA')):
        p = P('scripts', f); t = rd(p)
        t = once(t, TAG, GUARD_F, label)
        out[p] = t

    # ── 2: privacy.html (its GA tag was replaced in 1a)
    p = P('privacy.html'); t = cur(p)
    t = once(t, PRIVACY_DESC_OLD, PRIVACY_DESC_NEW, 'privacy meta description')
    t = once(t, PRIVACY_OG_OLD, PRIVACY_OG_NEW, 'privacy og:description')
    t = once(t, PRIVACY_TW_OLD, PRIVACY_TW_NEW, 'privacy twitter:description')
    t = once(t, PRIVACY_CSS_ANCHOR, PRIVACY_CSS + PRIVACY_CSS_ANCHOR, 'privacy css')
    t = rx_once(t, r'<main id="main" tabindex="-1">.*?</main>', lambda m: PRIVACY_MAIN, 'privacy main')
    assert t.count('</body>') == 1, 'privacy </body>'
    t = t.replace('</body>', PRIVACY_JS + '</body>', 1)
    out[p] = t

    # ── 3: cookies.html, terms.html
    p = P('cookies.html'); t = cur(p)
    t = once(t, COOKIES_OLD, COOKIES_NEW, 'cookies text')
    t = once(t, 'content="0; url=/privacy"', 'content="0; url=/privacy#cookies"', 'cookies refresh')
    t = once(t, "location.replace('/privacy');", "location.replace('/privacy#cookies');", 'cookies js')
    t = once(t, '<p><a href="/privacy" style=', '<p><a href="/privacy#cookies" style=', 'cookies link')
    out[p] = t

    p = P('terms.html'); t = cur(p)
    t = once(t, '<p class="updated">Last updated: September 26, 2026</p>', '<p class="updated">Last updated: Oct 1, 2026</p>', 'terms date')
    t = once(t, '      <h2>What AGSIST Is Not</h2>',
             '      <h2 id="who">Who Runs AGSIST</h2>\n'
             '      <p>AGSIST is run by Sigurd Lindquist, PO Box 243, Chetek, WI 54728. He also owns Farmers First Agri Service LLC in Chetek, WI (crop insurance, agronomy and ag technology services; a licensed crop-insurance agency) and Loke Drone LC (agricultural drone spraying).</p>\n\n'
             '      <h2>What AGSIST Is Not</h2>', 'terms who')
    t = once(t, '      <h2>Updates</h2>',
             '      <h2>Privacy</h2>\n'
             '      <p>What the site collects, who processes it, and how it answers Do Not Track and Global Privacy Control are in the <a href="/privacy">Privacy Policy</a>. Google Analytics sets cookies only when analytics is on, and you can turn it off there.</p>\n\n'
             '      <h2>Sponsors</h2>\n'
             '      <p>Sponsored placements are labeled. Sponsors never change data, rankings or bid order. An insurance sponsor may compete with Farmers First Agri Service LLC, which the owner of AGSIST also owns.</p>\n\n'
             '      <h2>Updates</h2>', 'terms privacy+sponsors')
    out[p] = t

    # ── 4: owner disclosure
    p = P('about.html'); t = cur(p)
    t = once(t, '<h2>How This Stays Running</h2>',
             '<h2>My Other Businesses</h2>\n'
             '      <p>I also own Farmers First Agri Service LLC in Chetek, WI (crop insurance, agronomy and ag technology services; a licensed crop-insurance agency) and Loke Drone LC (agricultural drone spraying). An insurance company that sponsors AGSIST may compete with Farmers First. Sponsors never change data, rankings or bid order on this site.</p>\n\n'
             '      <h2>How This Stays Running</h2>', 'about owner')
    out[p] = t

    p = P('sponsor.html'); t = cur(p)
    t = once(t, '        <div class="sp-operator-links">',
             '        <p class="sp-operator-bio"><strong>Disclosure.</strong> I also own Farmers First Agri Service LLC in Chetek, WI (crop insurance, agronomy and ag technology services; a licensed crop-insurance agency) and Loke Drone LC (agricultural drone spraying). If you sell insurance, Farmers First may compete with you, and you should know that before you buy. Sponsors never change data, rankings or bid order on AGSIST.</p>\n'
             '        <div class="sp-operator-links">', 'sponsor owner')
    out[p] = t

    p = P('components', 'sponsor-ad.js'); t = cur(p)
    t = once(t, "    if (sp.disclosure) h += '<p class=\"sa-disc\">' + esc(sp.disclosure) + '</p>';",
             "    var disc = ownerNote(sp);\n"
             "    if (disc) h += '<p class=\"sa-disc\">' + esc(disc) + '</p>';", 'sponsor-ad disclosure')
    t = once(t, '  var api = { render: render, esc: esc };',
             '  /* 2026-10-01 owner disclosure: an insurance sponsor may compete with the\n'
             '     owner\'s own agency. Said next to the sponsor\'s disclosure, every time.\n'
             '     generate_daily.build_sponsor_block adds the same sentence upstream; this\n'
             '     skips it when it is already there. */\n'
             '  var OWNER_NOTE = "' + OWNER_SPONSOR + '";\n'
             '  function ownerNote(sp) {\n'
             '    var d = sp.disclosure || \'\';\n'
             '    if (sp.is_house_ad) return d;\n'
             '    var hay = [sp.advertiser, sp.headline, sp.body, d].join(\' \');\n'
             '    if (/' + OWNER_RX + '/i.test(hay) && d.indexOf(\'Farmers First\') < 0) return d ? d + \' \' + OWNER_NOTE : OWNER_NOTE;\n'
             '    return d;\n'
             '  }\n\n'
             '  var api = { render: render, esc: esc };', 'sponsor-ad api')
    out[p] = t

    p = P('scripts', 'generate_daily.py'); t = cur(p)
    t = once(t, 'def build_sponsor_block():\n    if SPONSOR_OVERRIDE:\n        out = dict(SPONSOR_OVERRIDE)\n',
             '# 2026-10-01 owner disclosure: an insurance sponsor may compete with the\n'
             '# owner\'s own agency, so every surface fed from here (homepage, archive,\n'
             '# RSS, the email) says so next to the sponsor\'s own disclosure.\n'
             'OWNER_SPONSOR_NOTE = "' + OWNER_SPONSOR + '"\n\n\n'
             'OWNER_SPONSOR_RX = "' + OWNER_RX + '"\n\n\n'
             'def _owner_note_text(sp):\n'
             '    disc = sp.get("disclosure") or ""\n'
             '    if sp.get("is_house_ad"):\n'
             '        return disc\n'
             '    hay = " ".join(str(sp.get(k) or "") for k in ("advertiser", "headline", "body", "disclosure"))\n'
             '    if re.search(OWNER_SPONSOR_RX, hay, re.I) and "Farmers First" not in disc:\n'
             '        return (disc + " " + OWNER_SPONSOR_NOTE) if disc else OWNER_SPONSOR_NOTE\n'
             '    return disc\n\n\n'
             'def _owner_note(d):\n'
             '    note = _owner_note_text(d)\n'
             '    if note:\n'
             '        d["disclosure"] = note\n'
             '    return d\n\n\n'
             'def build_sponsor_block():\n    if SPONSOR_OVERRIDE:\n        out = dict(SPONSOR_OVERRIDE)\n', 'generate_daily owner helper')
    t = once(t, '        out["cta_urls"] = sponsor_cta_urls(out)\n        return out\n',
             '        out["cta_urls"] = sponsor_cta_urls(out)\n        return _owner_note(out)\n', 'generate_daily override return')
    t = once(t, '                data["cta_urls"] = sponsor_cta_urls(data)\n                return data\n',
             '                data["cta_urls"] = sponsor_cta_urls(data)\n                return _owner_note(data)\n', 'generate_daily active return')
    # the archive renderer applies it too, so it matches components/sponsor-ad.js
    # byte for byte on any sponsor dict (scripts/sponsor-checks.mjs parity cases)
    t = once(t, '    if sp.get("disclosure"):\n        h.append(f\'<p class="sa-disc">{html_esc(sp.get("disclosure"))}</p>\')\n',
             '    if _owner_note_text(sp):\n        h.append(f\'<p class="sa-disc">{html_esc(_owner_note_text(sp))}</p>\')\n',
             'generate_daily archive disclosure')
    out[p] = t

    for p in sorted(out):
        wr(p, out[p])

    # ── after: no page may still carry an unguarded loader tag
    left = [os.path.relpath(p, repo) for p in html_files(repo) if TAG in rd(p)]
    if left:
        sys.exit('unguarded GA loader left in %d files, e.g. %s' % (len(left), left[:3]))
    guarded = sum(1 for p in html_files(repo) if MARK in rd(p))
    print('consent_b: %d inline loaders guarded (+ components/analytics.html); %d pages now carry the guard; %d files written'
          % (before, guarded, len(out)))

if __name__ == '__main__':
    main()
