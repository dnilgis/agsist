#!/usr/bin/env python3
"""Round 7, design layer (2026-10-01). Runs after r7-prices, r7-season and
r7-bids, before the claim form, the consent guard and the bake.

What the design director's notes asked for, approved by Sig:
  1. Gold budget: gold only for the one primary action per view, the
     "today" marker, the NEW tag, the header rule, the logo dot, the Read's
     dots and the focus ring. Everything else that was gold goes to text
     colour. Ad orange is untouched (paid space is always ad orange).
  2. Boxes to hairlines. Cash Bids stays the only box.
  3. One type scale: 12, 14, 17, 22, 32, 40, 52 px. Every plain font-size in
     this page's own CSS and inline styles snaps to the nearest step.
  4. Pressed and hover states; 44px tap targets on phones.
  5. Phone order: the month strip goes right after Cash Bids, so bids stay
     first on a phone.
  6. Copy: "Advertise here" -> "Become a sponsor" (one name for
     sponsorship) and the panel's vocabulary pass (COPY below).
  7. Sig: crop icons beside Corn, Soybeans, Wheat, Cattle and Milk removed
     (homepage, menu, footer); the elevator count line names the network's
     own boards (1,110 read of 8,566 known) apart from the second feed.
  8. Tooltips readable in light theme and kept on screen; phone focus order
     follows what is on screen.

Usage: python3 patch_home_r7_design.py --repo DIR   (patches DIR/index.html)
Every anchor must match exactly once; a second run is refused.
"""
import argparse, os, re, sys

MARK = '2026-10-01 r7-design'
STEPS = [12, 14, 17, 22, 32, 40, 52]
ROOT_PX = 17.0   # components/styles.css: html{font-size:var(--base)} and --base:17px


def once(t, old, new, label):
    n = t.count(old)
    if n != 1:
        sys.exit('ANCHOR %s matched %d times, expected 1' % (label, n))
    return t.replace(old, new)


CSS = r"""<style>
/* ===== 2026-10-01 r7-design: gold budget, hairlines, states, phone order ===== */
/* 1. Gold budget. These were gold; they are text now. */
#daily-teaser-date.teaser-badge{color:var(--text-muted)!important;background:none!important;border-color:var(--hair)!important}
#f1 .sec-title>span{color:var(--text-muted)!important}
#bids-list-area>a,#bids-cta-link{color:var(--text)!important;text-decoration:underline;text-underline-offset:3px;text-decoration-color:var(--border-2)}
#prices-age{color:var(--text-muted)!important}
.crop-ge-val.fair,.tariff-row-rate.mixed,.spray-day.caution .spray-day-status{color:var(--text)!important}
.crop-full-link,.export-full-link,.tariff-full-link,.fert-full-link,.cot-full-link,.ratio-link{color:var(--text-dim)!important;border:0!important;background:none!important;padding:0!important;text-decoration:underline;text-underline-offset:3px;text-decoration-color:var(--border-2)}
.tariff-status-badge{color:var(--text-dim)!important;background:none!important;border:0!important;padding:0!important}
.wx-today-text strong,#wire-g .wr-c.hi strong,#sig-cattle-read b{color:var(--text)!important}
.wx-chart-toggle,#wire-band .wr-all{color:var(--text-dim)!important}
#wire-band .wr-k,#hbz-kicker,.radar-card>div>span,.drought-embed>summary>span,#pdw>label,.signup-eyebrow,#cot-date,#cot-countdown,.footer-col h2{color:var(--text-muted)!important}
.drought-embed>div>a,.noaa-note a,.pdw-ft a,.faq-a a,.idx1-content a[style*="color:var(--gold)"],.main a[style*="color:var(--gold)"]{color:var(--text)!important;text-decoration:underline;text-underline-offset:3px;text-decoration-color:var(--border-2)}
.tool-widget.tool-widget--scout{border-left-color:var(--hair)!important;border-color:var(--hair)!important}
#bids-geo-bar>span[aria-hidden="true"]{background:var(--text-muted)!important}
#f-rail-scorecard-teaser a{color:var(--text-dim)!important}
.tool-widget--scout .tool-widget-badge{background:none!important;color:var(--text-dim)!important}
.noaa-tab.active{background:none!important;color:var(--text)!important;border-color:transparent!important;box-shadow:inset 0 -2px 0 var(--text)!important}
#sig-corn-num,#sig-beans-num,#sig-wheat-num,#sig-cattle-num{color:var(--text)!important}
.sig-fill{background:var(--text-muted)!important}
.cal-card:not(.today):not(.is-today) .cal-date{color:var(--text)!important}
.ratio-verdict,.cot-verdict{background:none!important;border:0!important;padding:0!important}
.ratio-verdict{color:var(--text-dim)!important}
.wx-summary-title{color:var(--text)!important}
footer.footer{border-top-color:var(--hair)!important}
.footer-status .status-dot{background:var(--text-muted)!important}
#drawer .draw-lbl,#drawer .draw-lbl-ic{color:var(--text-muted)!important}
#drawer .draw-item{color:var(--text)!important}
/* What stays gold, darker in the light theme so it reads (4.96:1 on the
   light page's deepest background, measured; #a87d1e was 3.4:1). */
html[data-theme="light"] .teaser-action,html[data-theme="light"] .bidnet-tag{color:#86600f!important;border-color:#86600f!important}

/* 2. Boxes to hairlines. Cash Bids is the only box. */
.crop-week-badge,.export-mkt-yr,.sig-tag,#f-whats-priced a[href="/whats-priced-in"],a[href="/whats-priced-in"][style*="border-radius:5px"]{border:0!important;padding:0!important;background:none!important;color:var(--text-muted)!important}
.cal-card,.hbz-c,.radar-card,.drought-embed,.spray-day{background:none!important;border:0!important;border-top:1px solid var(--hair)!important;border-radius:0!important;box-shadow:none!important}
.hbz-c,.spray-day{padding-left:0!important;padding-right:0!important}
.wx-7day-cell{background:none!important;border-radius:0!important;border-top:1px solid var(--hair)!important}
#nowcast-widget div[style*="border-radius:9px"]{background:none!important;border:0!important;border-top:1px solid var(--hair)!important;border-radius:0!important}
.cot-dir{background:none!important;padding:0!important}
.pdw-pill.open{background:none!important;color:var(--green)!important;padding:0!important}
.wx-hourly-toggle{background:none!important;border:0!important;border-top:1px solid var(--hair)!important;border-radius:0!important;color:var(--text-dim)!important}

/* One section-title style for the widget heads. */
.crop-widget-title,.export-widget-title,.tariff-widget-title,.fert-widget-title,.ratio-widget-title,.wx-summary-title{font-family:'JetBrains Mono',monospace!important;font-weight:700!important;letter-spacing:.12em!important;text-transform:uppercase!important;color:var(--text)!important}

.r7-cov{font-family:'JetBrains Mono',monospace;font-size:.706rem;color:var(--text-muted);padding:8px 0 0;border-top:1px solid var(--hair)}
#idx1-trust-ledger{border-top:0!important;padding-top:4px!important}
/* Tooltips: theme colours (the box was hard-coded #161b1c, unreadable in
   light theme at 1:1), and an open tip rises above the next card. */
.tip-t{background:var(--surface2)!important;color:var(--text)!important;border-color:var(--border-2)!important;box-shadow:0 8px 24px rgba(0,0,0,.18)}
.fade-up:has(.tip-t:not([hidden])),.card:has(.tip-t:not([hidden])){position:relative;z-index:61}
/* Light-theme contrast, measured against the real background (before ->
   after): skip links 3.48 -> 5.69, subbar chip words 2.58 -> 6.11 (#2d5d82),
   Live Now 1.56 -> 5.60 (#276b43), muted COT/scorecard notes 3.26-3.98 ->
   text-dim, footer sponsor label 3.0 -> ad-orange-ink. */
html[data-theme="light"] .skip-link,html[data-theme="light"] .idx1-skip-rail{background:#86600f!important;color:#fff!important}
html[data-theme="light"] .idx1-zip-change{color:#2d5d82!important}
html[data-theme="light"] .idx1-zone-live,html[data-theme="light"] .idx1-zone-live small{color:#276b43!important;opacity:1!important}
html[data-theme="light"] .r7-dim,html[data-theme="light"] #rsc-stats span{color:var(--text-dim)!important}
html[data-theme="light"] .adspace-lbl{color:var(--ad-orange-ink)!important}
.rsc-teaser-cta{color:var(--text-dim)!important}
/* The calculator tooltip sits inside the Cash Bids card, which clipped it
   (overflow:hidden); let it show. */
#f1>.card,.card:has(.tip-t:not([hidden])){overflow:visible!important}
/* No ZIP set: there are no "your bids" yet, so the Live Now line waits. */
html:not(.has-zip) .idx1-zone-live small{display:none}
/* Gold budget: the NEW line's arrow is text, not a second gold mark. */
.bidnet-go{color:var(--text-muted)!important}
/* The three chips above the ticker: plain links on a hairline, not boxes. */
.idx1-zip-chip{background:none!important;border:0!important;border-radius:0!important;box-shadow:none!important;padding-left:0!important;padding-right:12px!important}
/* 4. States. */
a:active,button:active,summary:active,[role="button"]:active{opacity:.72}
details>summary{cursor:pointer}
details>summary:hover{color:var(--text)}
.m-fold>summary:hover .sec-title,.wr-summary:hover .wr-k{text-decoration:underline;text-underline-offset:3px}
@media(max-width:900px){
  #bids-list-area>a,a[href="/contact"],.land-links a,a[href="/whats-priced-in"]:not(.wr-c),.tip-b,.noaa-note a,.pdw-ft a,.signup-disc a,.footer-col a,.footer-legal a,.tool-btn,#f1>.bidnet-note,.drought-embed>div>a,.main a[href^="tel:"],.main a[href^="mailto:"],.main a[href="/privacy"],.signup-disc a{min-height:44px!important;display:inline-flex!important;align-items:center}
  .idx1-extras-field input{min-height:44px!important;font-size:1rem!important}
  .ticker-track .t-link{min-height:44px;display:inline-flex!important;align-items:center}
  .crop-full-link,.export-full-link,.tariff-full-link,.fert-full-link,.cot-full-link,.ratio-link,.wx-chart-toggle,.wx-hourly-toggle,#wire-band .wr-all,.faq-a a{display:inline-flex!important;align-items:center;min-height:44px}
  /* 5. Bids first on a phone; the month strip right after them. */
  .idx1-content>.s7-month,#dash-grid>.s7-month{order:25!important}
}
</style>
"""


FOCUS_JS = r'''<script>
/* 2026-10-01 r7-design: on a phone the month strip shows after Cash Bids
   (CSS order). Move it there in the document too, so keyboard and screen
   reader order match what is on screen; put it back on a wide screen. */
(function(){
  var m=document.getElementById('s7-month'),f1=document.getElementById('f1');
  if(!m||!f1||!m.parentNode)return;
  var home=document.createComment('s7-month home');m.parentNode.insertBefore(home,m);
  var mq=window.matchMedia('(max-width:900px)');
  function place(){ if(mq.matches){ if(f1.nextSibling!==m) f1.parentNode.insertBefore(m,f1.nextSibling); } else if(home.nextSibling!==m){ home.parentNode.insertBefore(m,home.nextSibling); } }
  place(); if(mq.addEventListener)mq.addEventListener('change',place);
  /* the bid-network note shows under the card (CSS order): same order in
     the document */
  var card=f1.querySelector(':scope>.card'),note=f1.querySelector(':scope>.bidnet-note');
  if(card&&note&&card.nextElementSibling!==note)f1.insertBefore(note,card.nextSibling);
})();
</script>
'''

# Copy pass from the panel (vocabulary). (old, new, expected count). Counts
# above 1 are the visible FAQ plus its FAQPage JSON-LD copy, which must match.
COPY = [
    ('Crop Progress &mdash; Good/Excellent', 'Crop Condition &mdash; Good/Excellent', 1),
    ('Show 5-yr history', 'Show 5-year history', 1),
    ("fd2===1?'Tom':", "fd2===1?'Tmrw':", 1),
    ('Ag odds', 'Prediction markets', 1),
    ('> Ag Prediction Markets</span>', '> Prediction markets</span>', 1),
    ('5-yr crop history', '5-year crop history', 1),
    ("What today's prices actually mean", "What today's prices mean", 1),
    ('What today&rsquo;s prices actually mean', 'What today&rsquo;s prices mean', 0),
    ('published every morning', 'published every weekday morning', 2),
    ('The front-month contract and the new-crop December contract are both shown', 'The front-month contract and the next December contract are both shown', 2),
    ('the nearby CME futures contract price', 'the futures contract it is quoted against', 2),
    ('A basis of -30 cents', 'A basis of \u221230 cents', 2),
]


def copy_pass(t):
    for old, new, n in COPY:
        c = t.count(old)
        if n and c != n:
            sys.exit('COPY %r matched %d times, expected %d' % (old, c, n))
        t = t.replace(old, new)
    return t


def snap(px):
    best = min(STEPS, key=lambda s: (abs(s - px), -s))
    return best


def fmt_rem(step):
    v = ('%.3f' % (step / ROOT_PX)).rstrip('0').rstrip('.')
    if v.startswith('0.'):
        v = v[1:]
    return v + 'rem'


def to_px(num, unit):
    return float(num) * (ROOT_PX if unit == 'rem' else 1.0)


SIZE_RX = re.compile(r'(font-size\s*:\s*)(\d*\.?\d+)(rem|px)(?=\s*(?:!important)?\s*[;}"\'])')
FONT_RX = re.compile(r'(\bfont\s*:\s*(?:(?:italic|normal|bold|[1-9]00)\s+)*)(\d*\.?\d+)(rem|px)(?=[\s/])')


def typescale(t):
    """Snap plain font sizes in <style> blocks and style="" attributes."""
    counts = {'n': 0}

    def fix(m):
        px = to_px(m.group(2), m.group(3))
        step = snap(px)
        counts['n'] += 1
        return m.group(1) + fmt_rem(step)

    def in_css(css):
        css = SIZE_RX.sub(fix, css)
        css = FONT_RX.sub(fix, css)
        return css

    t = re.sub(r'(<style[^>]*>)(.*?)(</style>)', lambda m: m.group(1) + in_css(m.group(2)) + m.group(3), t, flags=re.S)
    t = re.sub(r'(\sstyle=")([^"]*)(")', lambda m: m.group(1) + in_css(m.group(2) + ';')[:-1] + m.group(3), t)
    return t, counts['n']


def css_blocks(css):
    """Yield (prelude, body) for each top-level block; strips comments."""
    css = re.sub(r'/\*.*?\*/', '', css, flags=re.S)
    i, n = 0, len(css)
    while i < n:
        j = css.find('{', i)
        if j < 0:
            return
        pre = css[i:j].strip()
        depth, k = 1, j + 1
        while k < n and depth:
            if css[k] == '{':
                depth += 1
            elif css[k] == '}':
                depth -= 1
            k += 1
        yield pre, css[j + 1:k - 1]
        i = k


def mirror_shared(css):
    """Homepage-only copy of components/styles.css font sizes, snapped to the
    scale. Inserted right after that stylesheet's <link>, so it beats the
    shared sheet at equal specificity and the page's own (already snapped)
    style blocks still come later and win. The shared sheet itself is not
    touched: every other page keeps its sizes."""
    out = []

    def rules(css_text, indent=''):
        for pre, body in css_blocks(css_text):
            if pre.startswith('@media') or pre.startswith('@supports'):
                inner = rules(body, indent)
                if inner:
                    out_local = '%s{%s}' % (pre, ''.join(inner))
                    yield out_local
                continue
            if pre.startswith('@'):
                continue
            m = re.search(r'font-size\s*:\s*(\d*\.?\d+)(rem|px)\s*(!important)?\s*(?:;|$)', body)
            if not m:
                continue
            step = snap(to_px(m.group(1), m.group(2)))
            yield '%s{font-size:%s%s}' % (re.sub(r'\s+', ' ', pre), fmt_rem(step), '!important' if m.group(3) else '')

    for r in rules(css):
        out.append(r)
    return out


CROP_ICONS = r'(?:sprout|bean|wheat|beef|milk)'


def strip_crop_icons(t):
    """Sig, 2026-10-01: the drawn icons beside Corn, Soybeans, Wheat, Cattle
    and Milk don't read as those crops. They go: an icon-only wrapper span
    (no id) goes with its icon; a wrapper with an id stays, empty."""
    n0 = len(re.findall(r'<use href="#i-%s"/>' % CROP_ICONS, t))
    t = re.sub(r'<span class="[a-z-]*icon"[^>]*><svg class="ic"[^>]*><use href="#i-%s"/></svg></span>\s?' % CROP_ICONS, '', t)
    t = re.sub(r'<svg class="ic"[^>]*><use href="#i-%s"/></svg>\s?' % CROP_ICONS, '', t)
    # menu and footer lists: keep the 17px slot so the link column stays aligned
    t = re.sub(r'<svg class="lic"[^>]*><use href="#i-%s"/></svg>' % CROP_ICONS, '<span class="lic" aria-hidden="true"></span>', t)
    n1 = len(re.findall(r'<use href="#i-%s"/>' % CROP_ICONS, t))
    if n1:
        sys.exit('crop icons left after strip: %d' % n1)
    return t, n0


LEDGER_OLD = """  fetch('/data/bids.json').then(function(r){
    if(!r.ok) throw new Error('bids.json ' + r.status);
    return r.json();
  }).then(function(d){"""
LEDGER_NEW = """  /* 2026-10-01 r7-design: Sig, "that location count of elevators is way
     understated". The old line printed only the second bid feed (494
     locations in data/bids.json). The elevator network reads its own boards
     (data/elevator-coverage.json: read 1,110 of 8,566 known on Oct 1). Both
     are printed, separately: the two can overlap, so they are never added. */
  var cov = document.createElement('div');
  cov.className = 'r7-cov';
  el.parentNode.insertBefore(cov, el);
  fetch('/data/elevator-coverage.json').then(function(r){
    if(!r.ok) throw new Error('coverage ' + r.status);
    return r.json();
  }).then(function(c){
    var k = c && c.counts;
    if(!k || typeof k.read !== 'number' || typeof k.elevators !== 'number'){ cov.textContent = 'Elevator network: Not loaded yet'; return; }
    var t = new Date(c.generated);
    var w = isNaN(t.getTime()) ? '' : ' \\u00b7 ' + t.toLocaleString('en-US', {month:'short', day:'numeric', hour:'numeric', minute:'2-digit', timeZone:'America/Chicago'}) + ' CT';
    cov.textContent = 'Elevator network: ' + k.read.toLocaleString('en-US') + ' boards read directly, of ' + k.elevators.toLocaleString('en-US') + ' elevators known' + w;
  }).catch(function(){ cov.textContent = 'Elevator network: Not loaded yet'; });
  fetch('/data/bids.json').then(function(r){
    if(!r.ok) throw new Error('bids.json ' + r.status);
    return r.json();
  }).then(function(d){"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--repo', required=True)
    a = ap.parse_args()
    p = os.path.join(a.repo, 'index.html')
    t = open(p, encoding='utf-8', newline='').read()
    if MARK in t:
        sys.exit('r7-design already applied to %s. Start from a clean base.' % p)

    t = once(t, '<span class="teaser-sponsor-dot"></span>Advertise here<span', '<span class="teaser-sponsor-dot"></span>Become a sponsor<span', 'sponsor name')

    t = once(t, LEDGER_OLD, LEDGER_NEW, 'coverage line')
    t = once(t, "    el.textContent = 'National pull: ' + stats.total_bids.toLocaleString('en-US') + ' bids from '\n      + stats.facilities.toLocaleString('en-US') + ' locations · ' + when;",
             "    el.textContent = 'Second bid feed: ' + stats.total_bids.toLocaleString('en-US') + ' bids from '\n      + stats.facilities.toLocaleString('en-US') + ' locations · ' + when;", 'feed line')
    t = once(t, "  t.hidden=false;t.style.left='0';t.style.right='auto';\n  if(t.getBoundingClientRect().right>innerWidth-8){t.style.left='auto';t.style.right='0';}",
             "  t.hidden=false;t.style.right='auto';t.style.left='0';\n"
             "  /* keep the tip 8px inside both edges of the screen */\n"
             "  var _r=t.getBoundingClientRect(),_s=0;if(_r.right>innerWidth-8)_s=innerWidth-8-_r.right;if(_r.left+_s<8)_s=8-_r.left;t.style.left=_s+'px';", 'tip clamp')
    t = copy_pass(t)
    t, ni = strip_crop_icons(t)
    for comp in ('components/header.html', 'components/footer.html'):
        cp = os.path.join(a.repo, comp)
        c = open(cp, encoding='utf-8', newline='').read()
        if MARK in c:
            sys.exit('r7-design already applied to %s' % comp)
        c, nc = strip_crop_icons(c)
        c = '<!-- %s: crop icons removed (%d) -->\n' % (MARK, nc) + c
        open(cp, 'w', encoding='utf-8', newline='').write(c)
    t, n = typescale(t)
    shared = mirror_shared(open(os.path.join(a.repo, 'components/styles.css'), encoding='utf-8').read())
    link = re.findall(r'<link rel="stylesheet" href="/components/styles\.css\?v=\d+">\n', t)
    if len(link) != 1:
        sys.exit('ANCHOR styles.css link matched %d times' % len(link))
    t = t.replace(link[0], link[0] + '<style>/* %s: type scale for the shared sheet, this page only (%d rules) */\n%s\n</style>\n' % (MARK, len(shared), '\n'.join(shared)), 1)
    if t.count('</head>') != 1:
        sys.exit('ANCHOR </head> count')
    t = t.replace('</head>', CSS + '</head>', 1)
    if t.count('</body>') != 1:
        sys.exit('ANCHOR </body> count')
    t = t.replace('</body>', FOCUS_JS + '</body>', 1)
    assert MARK in t
    open(p, 'w', encoding='utf-8', newline='').write(t)
    print('ok (%d font sizes snapped)' % n)


if __name__ == '__main__':
    main()
