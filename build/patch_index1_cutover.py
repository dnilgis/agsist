#!/usr/bin/env python3
"""Cutover patch for the homepage (2026-10-01).

Reads the pristine files from --src (a clean clone) and writes the patched
files to --out (the working copy). Every anchor must match exactly once, or
the script stops. Running it twice from the same --src gives byte-identical
output.

Covers, from the cutover plan:
  A  phone length: dash-grid flattened under 900px so each card takes its own
     place in the column; bids, then the futures board, then weather; long
     secondary panels fold into closed <details> on a phone (open on desktop)
  B  "since your last visit" removed (it could never display)
  C  bid rows readable on a phone (sizes in components/bids-homepage.js)
  D  basis reference month printed when the feed names the contract; special
     grades marked
  E  read time on the bids card
  J  ticker: ag items only, linked where a futures page exists, one speed
  L  ZIP chip reads the ZIP the homepage actually stores, repaints same-tab
  M  hairline walk: one boxed lead item (Cash Bids), everything else ruled

Usage: python3 build/patch_index1_cutover.py --src <clean clone> --out <repo>
"""
import argparse, os, re, sys

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

# The bids loader is indented two spaces less than the copies these anchors
# were written from; D() strips two leading spaces from every line.
def D(s): return re.sub(r'(^|\n)  ', r'\1', s)
def DRX(s): return re.sub(r'(^|\\n)  ', r'\1', s)
def once_d(text, old, new, label): return once(text, D(old), D(new), label)
def rx_once_d(text, pattern, repl, label):
    return rx_once(text, DRX(pattern), lambda m: D(repl(m)), label)

def rd(root, p):
    with open(os.path.join(root, p), encoding='utf-8', newline='') as f:
        return f.read()

def wr(root, p, s):
    with open(os.path.join(root, p), 'w', encoding='utf-8', newline='') as f:
        f.write(s)

# ─────────────────────────────────────────────────────────────── index1.html
FOLD_CSS = r'''
<style>
/* ===== 2026-10-01 cutover: phone length, folds, hairlines =====
   One boxed lead item on this page: the Cash Bids card. Everything else is
   ruled with a hairline. Spacing on the 4/8/12/16/24/32/48 scale. */
body{--hair:rgba(132,160,168,.12);--sp-md:12px;--sp-lg:16px;--sp-xl:24px;--sp-2xl:32px}

/* Folds. Open on desktop with the summary hidden, so desktop reads exactly as
   before. A script below closes them on a phone. */
.m-fold>summary.m-fold-sum{display:none}
@media(max-width:900px){
  .m-fold>summary.m-fold-sum{display:flex;align-items:center;justify-content:space-between;gap:12px;
    min-height:48px;padding:12px 0;border-top:1px solid var(--hair);border-bottom:1px solid var(--hair);
    cursor:pointer;list-style:none;font-family:'JetBrains Mono',monospace;font-size:.75rem;font-weight:700;
    letter-spacing:.1em;text-transform:uppercase;color:var(--text-dim)}
  .m-fold>summary.m-fold-sum::-webkit-details-marker{display:none}
  .m-fold>summary.m-fold-sum::after{content:'+';font-size:1rem;color:var(--text-muted)}
  .m-fold[open]>summary.m-fold-sum::after{content:'\2212'}
  .m-fold>summary.m-fold-sum small{font-weight:400;letter-spacing:0;text-transform:none;color:var(--text-muted)}
  .m-fold[open]>summary.m-fold-sum{border-bottom:0;margin-bottom:8px}
  .m-fold{margin:0 0 8px}
}

/* Phone order. dash-grid stops being a box of its own so each card takes its
   own place in the column: bids, the futures board, weather, then the rest. */
@media(max-width:900px){
  #dash-grid{display:contents!important}
  .idx1-content>.home-h1{order:0}
  .idx1-content>.idx1-zone-label{order:10!important}
  #f1{order:20!important;margin-bottom:24px}
  #f-prices{order:30}
  #f2{order:40!important;margin-bottom:24px}
  #f-rail-scorecard-teaser{order:50;margin-bottom:16px}
  .idx1-content>.m-fold--radar{order:60}
  #wire-band{order:70}
  #harvest-band{order:80}
  .m-fold--tools{order:90}
  .idx1-content>.m-fold--noaa{order:100}
  #pdw{order:110}
  #f-read{order:120}
  .idx1-content>.m-fold--kalshi{order:130}
  #idx1-discovery{order:140}
  .idx1-content>.m-fold--faq{order:150}
  #signup-compact{order:160}
  #signup-full{order:170}
  /* The bid-network note goes under the card on a phone, one line. */
  #f1{display:flex;flex-direction:column}
  #f1>.sec-head{order:1}
  #f1>.card{order:2}
  #f1>.bidnet-note{order:3;margin:8px 0 0;padding:8px 0;border:0;border-top:1px solid var(--hair);border-radius:0;background:none;font-size:.75rem}
  #f1>.bidnet-note .bidnet-txt{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  /* Three signup asks on one phone screen was two too many. The compact one
     shows only when a reader asks for it from the bids card. */
  #signup-compact:not(.is-asked){display:none!important}
  /* Futures tiles two to a row on a phone. */
  #f-prices .price-cards-grid,#f-prices .price-cards-grid-2{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:0 12px!important}
  #f-prices .pc{padding:12px 0!important}
  #f-prices .pc-price{font-size:1.45rem!important}
  #f-prices .pc-sm .pc-price{font-size:1.2rem!important}
  #f-prices .pc-head{margin-bottom:4px}
  #f-prices .pc-contract{padding:0;background:none}
}

/* Hairline walk (desktop and phone). Gradients and boxes come off the panels
   that are not the lead item. */
#f2 .card,#f-prices .pc,.crop-widget,.export-widget,.tariff-widget,.fert-widget,
.ratio-widget,.cot-widget,.noaa-card,#f-read .sig,#f-faq .faq-item,.usda-cal-card,.km-card{
  background:transparent!important;border:0!important;border-top:1px solid var(--hair)!important;
  border-radius:0!important;box-shadow:none!important}
#f-prices .pc::before{display:none}
#f-prices .pc:hover,#f-read .sig:hover,.km-card:hover{border-top-color:var(--border-2)!important;transform:none!important}
.crop-widget,.export-widget,.tariff-widget,.fert-widget,.ratio-widget,.cot-widget{padding:12px 0!important}
#f2 .card-body{padding:12px 0}
#f-read .sig{padding:12px 0!important}
#f-faq .faq-item{margin-bottom:0!important}
.usda-cal-card{padding:12px 0!important}
@media(max-width:900px){
  .m-fold--calc:not(:has(.idx1-extras-card[style*="block"])):not(:has(.idx1-extras-line[style*="block"])){display:none}
  .card-body:has(.idx1-extras-card[style*="block"]) .idx1-bids-hint{display:none}
  .idx1-content>.m-fold--read{order:120}
  #signup-full .signup-icon,#signup-full .signup-sub{display:none}
  #signup-full{padding:16px 12px!important}
  #signup-full .signup-headline{font-size:1.25rem!important;margin-bottom:12px}
}
@media(max-width:900px){
  /* Footer links flow as two columns of text, not a grid of equal-height
     rows: same links, same 36px tap rows, about 450px less empty space. */
  footer .footer-cols{display:block!important;columns:2;column-gap:16px}
  footer .footer-col{break-inside:avoid;display:flex;flex-direction:column;margin-bottom:16px}
  /* The field-scout link in the weather card: one ruled line, not a box. */
  #f2 .wx-fs-bridge{padding:8px 0!important;border:0!important;border-top:1px solid var(--hair)!important;border-bottom:1px solid var(--hair)!important;border-radius:0!important;background:none!important}
}
@media(min-width:1240px){
  /* Wide screens: bids and weather side by side, so the board is not three
     screens down on a desktop either. Bids stays left, the lead item. */
  #dash-grid{grid-template-columns:minmax(0,1.15fr) minmax(0,1fr)!important;align-items:start}
  #f1{grid-column:1!important;grid-row:1/span 2}
  #f2{grid-column:2!important;grid-row:1}
  #f-rail-scorecard-teaser{grid-column:2;grid-row:2}
  #dash-grid>.m-fold--tools{grid-column:1/-1;grid-row:4}
}
@media(min-width:901px){
  /* Desktop: the futures board follows the bids and weather row directly;
     the signup, wire, harvest band and radar move below it. */
  #f-prices{order:-1}
}
@media(max-width:640px){
  /* The two chips share one row on a phone; the row scrolls sideways
     inside itself if a long ZIP label ever needs it. */
  .idx1-subbar{flex-wrap:nowrap!important;overflow-x:auto;scrollbar-width:none}
  .idx1-subbar>*{flex:none}
}
@media(max-width:900px){
  /* Content ran edge to edge on a phone (main had no side padding). */
  #main.main{padding-left:16px!important;padding-right:16px!important}
}
/* Wire, harvest band and RMA discovery: ruled, not boxed. */
#wire-band.wr,#harvest-band.hbz,#pdw.pdw{background:none!important;border:0!important;border-top:1px solid var(--hair)!important;border-radius:0!important;padding:12px 0!important;margin:0 0 8px!important}
@media(max-width:640px){
  /* styles.css stacks the signup row in a column but keeps flex-basis 160px,
     which made each input 160px TALL on a phone. */
  #signup-full .signup-input{flex:none!important}
  /* One tab ("Email") is not a choice. */
  #signup-full .signup-tabs{display:none}
}
/* The lead item keeps its box. */
#f1>.card{border:1px solid var(--border-2);border-radius:8px;background:var(--surface)}
</style>
'''

FOLD_SCRIPT = r'''
<script>
/* Folds close on a phone and stay open on desktop. Desktop is never left with
   a closed fold whose summary is hidden. */
(function(){
  var mq = window.matchMedia ? window.matchMedia('(max-width:900px)') : null;
  function apply(){
    var phone = !!(mq && mq.matches);
    var f = document.querySelectorAll('details.m-fold');
    for(var i = 0; i < f.length; i++){
      if(phone){ if(!f[i].hasAttribute('data-touched')) f[i].open = false; }
      else f[i].open = true;
    }
  }
  document.addEventListener('toggle', function(e){
    var t = e.target; if(t && t.classList && t.classList.contains('m-fold') && e.isTrusted) t.setAttribute('data-touched', '1');
  }, true);
  apply();
  if(mq){ if(mq.addEventListener) mq.addEventListener('change', apply); else if(mq.addListener) mq.addListener(apply); }
})();
</script>
'''

def fold_open(cls, label, sub=''):
    s = ' <small>%s</small>' % sub if sub else ''
    return ('<details class="m-fold %s" open><summary class="m-fold-sum"><span>%s%s</span></summary>\n'
            % (cls, label, s))

# Ticker: ag only. Links only where a futures page for it exists in the repo.
TICKER_KEEP = ['corn', 'corn-dec', 'beans', 'beans-nov', 'wheat', 'oats',
               'cattle', 'feeders', 'hogs', 'milk', 'meal']
TICKER_HREF = {'corn': '/corn-futures-prices', 'corn-dec': '/corn-futures-prices',
               'beans': '/soybean-futures-prices', 'beans-nov': '/soybean-futures-prices',
               'wheat': '/wheat-futures-prices', 'cattle': '/cattle-futures-prices',
               'feeders': '/cattle-futures-prices'}

def patch_ticker(t):
    m = re.search(r'(<div id="ticker-items-single">\n)(.*?)(\n        </div>\n      </div>\n    </div>\n  </div>)', t, re.S)
    if not m or t.count('<div id="ticker-items-single">') != 1:
        sys.exit('ANCHOR ticker block not found exactly once')
    items = re.findall(r'^( *)<div class="t-item" data-sym="([^"]+)">(.*?)</div>$', m.group(2), re.M)
    have = {s: (ind, inner) for ind, s, inner in items}
    for s in TICKER_KEEP:
        if s not in have: sys.exit('ticker item %s missing' % s)
    out = []
    for i, s in enumerate(TICKER_KEEP):
        ind, inner = have[s]
        if s in TICKER_HREF:
            out.append('%s<a class="t-item t-link" data-sym="%s" href="%s">%s</a>' % (ind, s, TICKER_HREF[s], inner))
        else:
            out.append('%s<div class="t-item" data-sym="%s">%s</div>' % (ind, s, inner))
        if i < len(TICKER_KEEP) - 1:
            out.append('%s<div class="t-sep" aria-hidden="true">&middot;</div>' % ind)
    return t[:m.start(2)] + '\n'.join(out) + t[m.end(2):]

def patch_index1(t):
    # B: since-your-last-visit, CSS and markup
    t = once(t, ".idx1-last-visit{display:flex;align-items:center;gap:.5rem;max-width:1400px;margin:.5rem auto 0;padding:0 1rem;font-family:'JetBrains Mono',monospace;font-size:.78rem;color:var(--text-dim)}\n", '', 'last-visit css 1')
    t = once(t, ".idx1-last-visit .idx1-badge{font-size:.66rem;color:#0a0c0d;background:var(--blue,#4a90d9);padding:1px 5px;border-radius:3px;font-weight:700}\n", '', 'last-visit css 2')
    t = once(t, '<div id="idx1-last-visit" class="idx1-last-visit" style="display:none"></div>\n', '', 'last-visit markup')

    # L: ZIP chip reads the ZIP the homepage stores (agsist-wx-loc.zip), then
    # the /cash-bids key; repaints when bids load or the location resolves.
    t = once(t,
        "    try { z = localStorage.getItem('agsist_zip') || localStorage.getItem('bids_zip') || ''; } catch(e){}\n",
        "    /* 2026-10-01: the homepage stores its ZIP in agsist-wx-loc (geo.js), not\n"
        "       agsist_zip, so the chip read \"Not set\" beside a card showing bids for\n"
        "       a ZIP. Read the homepage key first, then the /cash-bids one. */\n"
        "    try { var wl = JSON.parse(localStorage.getItem('agsist-wx-loc') || 'null'); z = (wl && /^\\d{5}$/.test(wl.zip || '')) ? wl.zip : ''; } catch(e){}\n"
        "    if(!z){ try { z = localStorage.getItem('agsist_zip') || ''; } catch(e){} }\n",
        'zip chip read')
    t = once(t,
        "      var field = document.getElementById('bids-zip');\n"
        "      var target = field || document.getElementById('dash-grid');\n",
        "      var field = document.getElementById('bids-zip');\n"
        "      /* With a ZIP saved the ZIP row is hidden; open it before scrolling to it. */\n"
        "      var row = document.getElementById('bids-zip-row');\n"
        "      if(row && row.style.display === 'none'){ var ez = document.getElementById('bids-enter-zip-btn'); if(ez) ez.click(); else row.style.display = 'block'; }\n"
        "      var target = field || document.getElementById('dash-grid');\n",
        'zip chip click')
    t = rx_once(t, r"(  paint\(\);\n)(  window\.addEventListener\('storage', paint\);\n)",
        lambda m: m.group(1) + m.group(2) +
        "  /* Same tab: the storage event never fires in the tab that wrote. */\n"
        "  window.addEventListener('agsist:bids', paint);\n"
        "  window._AGSIST_GEO_CALLBACKS = window._AGSIST_GEO_CALLBACKS || [];\n"
        "  window._AGSIST_GEO_CALLBACKS.push(function(){ setTimeout(paint, 0); });\n",
        'zip chip listeners')

    # J: ticker
    t = patch_ticker(t)
    t = once(t, "track.style.animationDuration=Math.max(20,Math.round(w/45))+'s';",
             "/* one speed: the same 20 px/s geo.js rebuildTickerLoop() uses */track.style.animationDuration=Math.max(20,Math.round(w/20))+'s';",
             'ticker resize speed')

    # cache-busts for the components this kit changes
    t = once(t, '/components/bids-homepage.js?v=15', '/components/bids-homepage.js?v=16', 'v bids-homepage')
    t = once(t, '/components/homepage-extras.js?v=1"', '/components/homepage-extras.js?v=2"', 'v homepage-extras')

    # A: folds
    t = once(t, '  <div class="radar-section fade-up" id="f-radar">\n',
             '  ' + fold_open('m-fold--radar', 'Radar, Forecast &amp; Drought') + '  <div class="radar-section fade-up" id="f-radar">\n', 'fold radar open')
    t = once(t, '\n  <div class="idx1-zone-label idx1-zone-live" style="order:-1">',
             '  </details>\n\n  <div class="idx1-zone-label idx1-zone-live" style="order:-1">', 'fold radar close')
    t = once(t, '    <div class="fade-up" id="f3" style="transition-delay:.16s">\n',
             '    ' + fold_open('m-fold--tools', 'Quick Tools') + '    <div class="fade-up" id="f3" style="transition-delay:.16s">\n', 'fold tools open')
    t = once(t, '    </div>\n  </div>\n  <div class="price-cards-section fade-up" id="f-prices">\n',
             '    </div>\n    </details>\n  </div>\n  <div class="price-cards-section fade-up" id="f-prices">\n', 'fold tools close')
    t = once(t, '    <div class="crop-export-grid" id="crop-export-grid-inner">\n',
             '    ' + fold_open('m-fold--usda', 'Crops, exports, inputs', 'progress &middot; sales &middot; tariffs &middot; fertilizer') + '    <div class="crop-export-grid" id="crop-export-grid-inner">\n', 'fold usda open')
    t = once(t, '    <div class="pc-section-lbl"><svg class="ic" aria-hidden="true"><use href="#i-wheat"/></svg> More Grains',
             '    </details>\n    <div class="pc-section-lbl"><svg class="ic" aria-hidden="true"><use href="#i-wheat"/></svg> More Grains', 'fold usda close')
    t = once(t, '    <div class="pc-section-lbl"><svg class="ic" aria-hidden="true"><use href="#i-zap"/></svg> Energy',
             '    ' + fold_open('m-fold--outside', 'Energy, metals &amp; outside markets') + '    <div class="pc-section-lbl"><svg class="ic" aria-hidden="true"><use href="#i-zap"/></svg> Energy', 'fold outside open')
    t = once(t, '    </div>\n  </div>\n\n\n  <div class="fade-up" id="f-noaa">\n',
             '    </div>\n    </details>\n  </div>\n\n\n  ' + fold_open('m-fold--noaa', 'NOAA Seasonal Outlooks') + '  <div class="fade-up" id="f-noaa">\n', 'fold outside close / noaa open')
    t = once(t, '\n  </div>\n  <div class="pdw fade-up" id="pdw">',
             '\n  </div>\n  </details>\n  <div class="pdw fade-up" id="pdw">', 'fold noaa close')
    t = once(t, '  <div class="fade-up" id="f-kalshi">\n',
             '  ' + fold_open('m-fold--kalshi', 'What&rsquo;s Moving Agriculture') + '  <div class="fade-up" id="f-kalshi">\n', 'fold kalshi open')
    t = once(t, '  </div>\n  <div class="fade-up" id="idx1-discovery">',
             '  </div>\n  </details>\n  <div class="fade-up" id="idx1-discovery">', 'fold kalshi close')
    t = once(t, '  <section class="fade-up" id="f-faq" aria-labelledby="faq-heading">\n',
             '  ' + fold_open('m-fold--faq', 'Frequently Asked Questions') + '  <section class="fade-up" id="f-faq" aria-labelledby="faq-heading">\n', 'fold faq open')
    t = once(t, '  </section>\n  <div class="signup fade-up" id="signup-full"',
             '  </section>\n  </details>\n  <div class="signup fade-up" id="signup-full"', 'fold faq close')
    t = once(t, '<div class="fade-up" id="f-cot-intel">\n',
             fold_open('m-fold--cot', 'Market Intelligence', 'COT positioning &middot; yield nowcast') + '<div class="fade-up" id="f-cot-intel">\n', 'fold cot open')
    t = once(t, '  </div>\n<div class="fade-up" id="f5">',
             '  </div>\n</details>\n<div class="fade-up" id="f5">', 'fold cot close')

    # A (cont.): the store-or-sell calculator, nearby compare and basis chart
    # fold on a phone; the fold only appears once one of them has data.
    t = once(t, '        <div id="idx1-store-sell" class="idx1-extras-card" style="display:none">\n',
             '        ' + fold_open('m-fold--calc', 'Store or sell? Basis history') + '        <div id="idx1-store-sell" class="idx1-extras-card" style="display:none">\n', 'fold calc open')
    t = once(t, '        <div id="idx1-trust-ledger">',
             '        </details>\n        <div id="idx1-trust-ledger">', 'fold calc close')
    t = once(t, '  <section class="fade-up" id="f-read" aria-labelledby="read-heading">\n',
             '  ' + fold_open('m-fold--read', 'The Read', '&mdash; what today&rsquo;s prices mean') + '  <section class="fade-up" id="f-read" aria-labelledby="read-heading">\n', 'fold read open')
    t = once(t, '    </div>\n  </section>\n  <script>\n  (function(){\n',
             '    </div>\n  </section>\n  </details>\n  <script>\n  (function(){\n', 'fold read close')
    t = once(t, '</head>', FOLD_CSS + '</head>', 'fold css')
    t = once(t, '</aside>', '</aside>\n' + FOLD_SCRIPT.strip('\n'), 'fold script')
    return t


# ───────────────────────────────────────────── round 2: panel findings fixed
R2_CSS = r"""
<style>
/* ===== 2026-10-01 cutover, round 2 (panel findings) ===== */
/* Keyboard: a focused ticker link stops the track, and the hidden clone
   copy is never a tab stop (geo.js marks it inert). */
.ticker-track:focus-within{animation-play-state:paused}
.t-link{color:inherit;text-decoration:none;min-height:24px;display:inline-flex;align-items:center}
.t-link:hover .t-label{text-decoration:underline}
/* Futures: the change is coloured text, not a filled chip; the contract
   label is plain text; the range ends never break mid-number. */
#f-prices .pc-chg-val{background:none!important;border:0!important;padding:0!important;border-radius:0!important}
#f-prices .pc-contract{background:none!important;padding:0!important}
#f-prices .pc-range-labels{gap:8px}
#f-prices .pc-range-labels>span:first-child,#f-prices .pc-range-labels>span:last-child{white-space:nowrap;flex:none}
#f-prices .pc-range-labels>span:nth-child(2){min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:center}
/* Section labels in text colour; gold is kept for live and lead items. */
#main .sec-title{color:var(--text)}
/* Boxes that are not the lead item: weather sub-tiles, signup, teaser. */
#f2 .wx-grid>*,#f2 .wx-data-extra>*,#f2 .wx-today,#f2 .wx-fs-bridge,#f-rail-scorecard-teaser .rsc-teaser-link,
#signup-full,.tariff-row,.fert-card{background:none!important;border:0!important;border-top:1px solid var(--hair)!important;border-radius:0!important;box-shadow:none!important}
#f2 .wx-today{border-left:0!important}
@media(max-width:900px){
  /* A fold's own summary is its heading on a phone; the h2 inside would
     read the same title twice. */
  .m-fold>summary.m-fold-sum~* .sec-head>.sec-title{display:none}
  .m-fold>summary.m-fold-sum small{font-size:.75rem}
  .m-fold--more>summary~.pc-section-lbl{display:none}
  /* The weather card was pulled 16px past the gutter on each side. */
  #f1>.card,#f2 .wx-card{margin-left:0!important;margin-right:0!important;width:auto!important;max-width:100%}
}
@media(min-width:901px){
  #dash-grid>#f-prices{grid-column:1/-1}
}
@media(min-width:1240px){
  #dash-grid>#f-prices{grid-row:3}
}
@media(min-width:901px){
  /* Four key contracts on one row, no empty fifth column. */
  #f-prices .price-cards-grid{grid-template-columns:repeat(4,minmax(0,1fr))!important}
}
</style>
"""

def move_block(t, start, end_before, insert_before, label):
    """Cut text from `start` (inclusive) up to `end_before` (exclusive) and
    paste it immediately before `insert_before`. Each anchor exactly once."""
    for a in (start, end_before, insert_before):
        if t.count(a) != 1: sys.exit('ANCHOR %s: %r matched %d times' % (label, a[:60], t.count(a)))
    i = t.index(start); j = t.index(end_before, i)
    block = t[i:j]; t = t[:i] + t[j:]
    k = t.index(insert_before)
    return t[:k] + block + t[k:]

def patch_index1_r2(t):
    # DOM order now matches the order a reader sees on a phone, so Tab and a
    # screen reader walk the page the same way: bids, the board, weather,
    # then the rest. 1) f1 (bids) before f2 (weather) inside dash-grid.
    t = move_block(t, '    <div class="fade-up" id="f2"', '    <div class="fade-up" id="f1"',
                   '    <div class="fade-up" id="f-rail-scorecard-teaser">', 'move f2 after f1')
    # 2) the futures board inside dash-grid, right after the bids card.
    t = move_block(t, '  <div class="price-cards-section fade-up" id="f-prices">',
                   '\n\n\n  <details class="m-fold m-fold--noaa"',
                   '    <div class="fade-up" id="f2"', 'move f-prices')
    # 3) signup, wire, harvest band and radar after dash-grid.
    t = move_block(t, '  <div class="signup--compact fade-up" id="signup-compact"',
                   '  <div class="idx1-zone-label idx1-zone-live"',
                   '\n\n\n  <details class="m-fold m-fold--noaa"', 'move signup..radar')
    # Phone orders follow the new DOM order.
    old_orders = """  #f1{order:20!important;margin-bottom:24px}
  #f-prices{order:30}
  #f2{order:40!important;margin-bottom:24px}
  #f-rail-scorecard-teaser{order:50;margin-bottom:16px}
  .idx1-content>.m-fold--radar{order:60}
  #wire-band{order:70}
  #harvest-band{order:80}
  .m-fold--tools{order:90}"""
    new_orders = """  #f1{order:20!important;margin-bottom:24px}
  #f-prices{order:30}
  #f2{order:40!important;margin-bottom:24px}
  #f-rail-scorecard-teaser{order:50;margin-bottom:16px}
  .m-fold--tools{order:55}
  #signup-compact{order:56}
  #wire-band{order:57}
  #harvest-band{order:58}
  .idx1-content>.m-fold--radar{order:60}"""
    t = once(t, old_orders, new_orders, 'phone orders')
    t = once(t, "  #signup-compact{order:160}\n", "", 'drop old signup order')
    t = once(t, """@media(min-width:901px){
  /* Desktop: the futures board follows the bids and weather row directly;
     the signup, wire, harvest band and radar move below it. */
  #f-prices{order:-1}
}
""", "", 'drop desktop prices order')
    # Folds: a summary click marks a fold as the reader's own choice; the
    # browser's toggle events from our own open/close no longer do.
    t = once(t, """  document.addEventListener('toggle', function(e){
    var t = e.target; if(t && t.classList && t.classList.contains('m-fold') && e.isTrusted) t.setAttribute('data-touched', '1');
  }, true);""", """  document.addEventListener('click', function(e){
    var s = e.target && e.target.closest ? e.target.closest('summary.m-fold-sum') : null;
    if(s && s.parentNode) s.parentNode.setAttribute('data-touched', '1');
  }, true);""", 'fold touched')
    # The second tiles are the deferred Dec / Nov contracts (Dec '27 today),
    # not this harvest. "Harvest" on them was wrong in October.
    t = once(t, 'Corn Harvest</span>', 'Corn Deferred</span>', 'tile name corn')
    t = once(t, 'Beans Harvest</span>', 'Beans Deferred</span>', 'tile name beans')
    # Grain Stocks was released Sep 30 (data/wpi-history.json), not "today".
    t = once(t, 'September Grain Stocks &mdash; released today</div>',
             'September Grain Stocks &mdash; released Sep 30</div>', 'grain stocks date')
    # The ticker says LIVE only after prices.json has loaded and is fresh.
    t = once(t, '<div class="ticker-live"><div class="live-dot" aria-hidden="true"></div><span id="ticker-age">LIVE</span></div>',
             '<div class="ticker-live stale"><div class="live-dot" aria-hidden="true"></div><span id="ticker-age">&hellip;</span></div>', 'ticker live static')
    # Scorecard: 41 of 86 on direction is a coin flip, not below one.
    t = once(t, "        var drNote=dr<50?' (below a coin flip)':'';\n        v='Right on direction about '+dr+'% of the time'+drNote+' &mdash; hitting the exact level called, only '+det.hit_rate.toFixed(0)+'%.';",
             "        var dn=(dirOnly.played!=null&&dirOnly.graded)?' ('+dirOnly.played+' of '+dirOnly.graded+')':'';\n        v=(dr>=40&&dr<=60?'No better than a coin flip on direction':'Right on direction about '+dr+'% of the time')+dn+' &mdash; hitting the exact level called, only '+det.hit_rate.toFixed(0)+'%.';",
             'scorecard wording')
    # Cattle Read card: a range position is not a percentile.
    t = once(t, "+' contracts, '+cp+ord(cp)+' pctile of its 52-wk range'",
             "+' contracts, '+cp+'% of the way up its 52-wk range'", 'cattle pctile wording')
    # The Read: say when its price was taken and what the 5-yr series is.
    t = once(t, "if($(pre+'-price'))$(pre+'-price').textContent='$'+cur.toFixed(2)+' \\u00b7 '+(tag==='5-YR'?'5-yr':'52-wk')+' range $'+lo.toFixed(2)+'\\u2013$'+hi.toFixed(2);",
             "if($(pre+'-price'))$(pre+'-price').textContent='$'+cur.toFixed(2)+(tag==='5-YR'&&asOf?' at '+asOf:'')+' \\u00b7 '+(tag==='5-YR'?'5-yr front-month':'52-wk')+' range $'+lo.toFixed(2)+'\\u2013$'+hi.toFixed(2);",
             'read asof')
    t = once(t, "      var px=(R[0]&&R[0].quotes)||{},stats=R[1]||{},cot=R[2]||{};\n",
             "      var px=(R[0]&&R[0].quotes)||{},stats=R[1]||{},cot=R[2]||{};\n"
             "      /* price-stats.json is built after the close, not live: name the time. */\n"
             "      var asOf='';try{if(stats.updated){var _d=new Date(stats.updated);if(!isNaN(_d))asOf=_d.toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZone:'America/Chicago'})+' CT';}}catch(e){}\n",
             'read asof var')
    # Trust ledger: CT, and not "boards" (the file counts every location).
    t = once(t, "    var when = isNaN(dt.getTime()) ? d.fetched : dt.toLocaleString('en-US', {month:'short', day:'numeric', hour:'numeric', minute:'2-digit'});\n"
               "    el.textContent = stats.facilities.toLocaleString('en-US') + ' elevator boards, '\n"
               "      + stats.total_bids.toLocaleString('en-US') + ' bids read · last pull ' + when;\n",
               "    /* 2026-10-01: CT, like the card above it, and \"locations\", not \"boards\":\n"
               "       this file counts every location in the national pull, not only\n"
               "       the boards the elevator network reads itself. */\n"
               "    var when = isNaN(dt.getTime()) ? d.fetched : dt.toLocaleString('en-US', {month:'short', day:'numeric', hour:'numeric', minute:'2-digit', timeZone:'America/Chicago'}) + ' CT';\n"
               "    el.textContent = 'National pull: ' + stats.total_bids.toLocaleString('en-US') + ' bids from '\n"
               "      + stats.facilities.toLocaleString('en-US') + ' locations \u00b7 ' + when;\n",
               'trust ledger text')
    t = once(t, "#idx1-trust-ledger{font-size:.74rem;color:var(--gold);font-weight:600;margin-top:.4rem;text-align:center;padding:.3rem;background:rgba(212,162,63,.08);border-radius:6px}",
             "#idx1-trust-ledger{font-family:'JetBrains Mono',monospace;font-size:.75rem;color:var(--text-muted);font-weight:400;margin-top:8px;text-align:left;padding:8px 0 0;border-top:1px solid var(--border)}",
             'trust ledger style')
    # Farmer panel: weather sat 3,158px down on a phone behind eight more
    # tiles. "More grains, feed & livestock" folds on a phone like the rest.
    t = once(t, '    <div class="pc-section-lbl"><svg class="ic" aria-hidden="true"><use href="#i-wheat"/></svg> More Grains',
             '    ' + fold_open('m-fold--more', 'More Grains, Feed &amp; Livestock') + '    <div class="pc-section-lbl"><svg class="ic" aria-hidden="true"><use href="#i-wheat"/></svg> More Grains', 'fold more open')
    t = once(t, '    <details class="m-fold m-fold--outside" open>',
             '    </details>\n    <details class="m-fold m-fold--outside" open>', 'fold more close')
    t = once(t, '</head>', R2_CSS + '</head>', 'r2 css')
    t = once(t, '/components/geo.js?v=18', '/components/geo.js?v=19', 'v geo')
    return t

# ───────────────────────────────────────────────── components/bids-homepage.js
def patch_bids_homepage(t):
    # D: carry the futures symbol the licensed feed sends.
    t = once(t,
        "            deliveryStart: bid.deliveryStart || bid.delivery_start || '',\n"
        "            category: classifyCommodity(bid.commodity || bid.commodity_display_name || bid.commodityName || '')\n",
        "            deliveryStart: bid.deliveryStart || bid.delivery_start || '',\n"
        "            symbol: bid.symbol || item.symbol || '',\n"
        "            category: classifyCommodity(bid.commodity || bid.commodity_display_name || bid.commodityName || '')\n",
        'flatten symbol 1')
    t = once(t,
        "          deliveryStart: item.deliveryStart || item.delivery_start || '',\n"
        "          category: classifyCommodity(item.commodity || item.commodity_display_name || item.commodityName || '')\n",
        "          deliveryStart: item.deliveryStart || item.delivery_start || '',\n"
        "          symbol: item.symbol || '',\n"
        "          category: classifyCommodity(item.commodity || item.commodity_display_name || item.commodityName || '')\n",
        'flatten symbol 2')
    t = once(t,
        "  var COMM_ORDER = ['corn','soybeans','wheat','other'];\n",
        "  /* 2026-10-01: the futures month a basis is quoted against, read from the\n"
        "     symbol the licensed feed sends (ZCZ26 -> Dec). The elevator network\n"
        "     rows carry no symbol, so they print no month rather than a guessed one. */\n"
        "  var FUT_MON = {F:'Jan',G:'Feb',H:'Mar',J:'Apr',K:'May',M:'Jun',N:'Jul',Q:'Aug',U:'Sep',V:'Oct',X:'Nov',Z:'Dec'};\n"
        "  function refMonth(sym){\n"
        "    var m = /^[A-Z]{1,3}([FGHJKMNQUVXZ])(\\d{2})$/.exec(String(sym || '').trim().toUpperCase());\n"
        "    return m ? FUT_MON[m[1]] : '';\n"
        "  }\n"
        "  function ctTime(iso){\n"
        "    var d = new Date(iso); if(!iso || isNaN(d)) return '';\n"
        "    try{\n"
        "      var t = d.toLocaleTimeString('en-US', {hour:'numeric', minute:'2-digit', timeZone:'America/Chicago'});\n"
        "      var day = d.toLocaleDateString('en-US', {month:'short', day:'numeric', timeZone:'America/Chicago'});\n"
        "      var today = new Date().toLocaleDateString('en-US', {month:'short', day:'numeric', timeZone:'America/Chicago'});\n"
        "      return (day === today ? '' : day + ' ') + t + ' CT';\n"
        "    }catch(e){ return ''; }\n"
        "  }\n"
        "  var feedTimes = { network: null, licensed: null };\n\n"
        "  var COMM_ORDER = ['corn','soybeans','wheat','other'];\n",
        'helpers')

    # C: sizes. Old -> new, each exact once.
    sizes = [
        ("html += '<div style=\"font-size:.82rem;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis\">' + escHtml(elev.facility) + '</div>';",
         "html += '<div style=\"font-size:.95rem;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis\">' + escHtml(elev.facility) + '</div>';"),
        ("html += '<div style=\"font-size:.62rem;color:var(--text-muted)\">' + escHtml(cityState)",
         "html += '<div style=\"font-size:.75rem;color:var(--text-muted)\">' + escHtml(cityState)"),
        ("html += '<span style=\"font-family:\\'JetBrains Mono\\',monospace;font-size:.62rem;font-weight:700;color:var(--text-muted);white-space:nowrap;flex-shrink:0\">' + distStr + '</span>';",
         "html += '<span style=\"font-family:\\'JetBrains Mono\\',monospace;font-size:.75rem;font-weight:700;color:var(--text-muted);white-space:nowrap;flex-shrink:0\">' + distStr + '</span>';"),
        ("margin:.2rem 0 .1rem;font-size:.58rem;font-weight:700;letter-spacing:.06em",
         "margin:.35rem 0 .1rem;font-size:.75rem;font-weight:700;letter-spacing:.06em"),
    ]
    for i, (o, n) in enumerate(sizes):
        t = once(t, o, n, 'size %d' % i)

    # Bid rows: sizes, basis month, special grade, redundant grade line.
    t = rx_once_d(t,
        r"          var gradeTxt = grade \+ \(perTon \? \(grade \? ' \\u00b7 ' : ''\) \+ 'per ton, not per bushel' : ''\);\n"
        r"          var bColor = [^\n]*\n\n"
        r"          html \+= '<div style=\"display:grid;grid-template-columns:1fr auto auto;gap:\.1rem \.45rem;align-items:baseline;padding:\.1rem \.15rem\">';\n"
        r"          html \+= [^\n]*escHtml\(del\)[^\n]*\n"
        r"          html \+= [^\n]*cashStr[^\n]*\n"
        r"          html \+= [^\n]*basis\.str[^\n]*\n"
        r"          if\(gradeTxt\)\{\n"
        r"            html \+= [^\n]*escHtml\(gradeTxt\)[^\n]*\n"
        r"          \}\n",
        lambda m: (
        "          var special = isSpecialGrade(bid);\n"
        "          /* The grade line used to repeat the crop (\"Corn\" under CORN). Shown\n"
        "             only when it says something the heading does not. */\n"
        "          var sameAsCrop = grade.toLowerCase() === String(COMM_NAMES[cat] || '').toLowerCase() || grade.toLowerCase() === cat;\n"
        "          var gradeTxt = (sameAsCrop && !perTon && !special) ? '' : grade\n"
        "            + (perTon ? (grade ? ' \\u00b7 ' : '') + 'per ton, not per bushel' : '')\n"
        "            + (special && !perTon ? (grade ? ' \\u00b7 ' : '') + 'special grade' : '');\n"
        "          /* A special grade's basis is not the futures grade's basis: no red or green on it. */\n"
        "          var bColor = special ? 'var(--text-muted)' : basis.cls === 'pos' ? 'var(--green)' : basis.cls === 'neg' ? 'var(--red,#ef4444)' : 'var(--text-muted)';\n"
        "          var rm = perTon ? '' : refMonth(bid.symbol);\n"
        "          var basisCell = basis.str + (rm && basis.str !== '\\u2014' ? ' <span style=\"font-weight:400;color:var(--text-muted)\" title=\"basis vs the ' + rm + ' futures contract\">' + rm + '</span>' : '');\n\n"
        "          html += '<div style=\"display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:.1rem .6rem;align-items:baseline;padding:.15rem 0\">';\n"
        "          html += '<span style=\"font-size:.85rem;color:var(--text-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis\">' + escHtml(del) + '</span>';\n"
        "          html += '<span style=\"font-family:\\'JetBrains Mono\\',monospace;font-size:1.05rem;font-weight:700;color:var(--text);text-align:right;white-space:nowrap\">' + cashStr + '</span>';\n"
        "          html += '<span style=\"font-family:\\'JetBrains Mono\\',monospace;font-size:.85rem;font-weight:700;color:' + bColor + ';text-align:right;white-space:nowrap;min-width:48px\">' + basisCell + '</span>';\n"
        "          if(gradeTxt){\n"
        "            html += '<span style=\"grid-column:1/-1;font-size:.75rem;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis\">' + escHtml(gradeTxt) + '</span>';\n"
        "          }\n"),
        'bid row')
    t = once(t, "html += '<div style=\"font-size:.6rem;color:var(--text-muted);padding:.02rem .15rem\">+' + overflow + ' more</div>';",
             "html += '<div style=\"font-size:.75rem;color:var(--text-muted);padding:.1rem 0\">+' + overflow + ' more</div>';", 'overflow size')
    t = once(t, "font-size:.66rem;color:var(--text-muted);text-decoration:underline;cursor:pointer;min-height:24px\">Watch this elevator",
             "font-size:.75rem;color:var(--text-muted);text-decoration:underline;cursor:pointer;min-height:32px\">Watch this elevator", 'watch size')
    # header row
    t = rx_once_d(t,
        r"          // FIX: \.65rem font-size for readability \(was \.5rem — too small\)\n"
        r"          var html = '<div style=\"display:grid;grid-template-columns:1fr auto auto;gap:\.1rem \.45rem;padding:0 \.15rem \.15rem;'\n"
        r"            \+ '[^\n]*font-size:\.65rem;[^\n]*'\n",
        lambda m: (
        "          // 2026-10-01: column labels at .75rem; the rows below are what a\n"
        "          // farmer reads in a truck (cash 1.05rem, basis and month .85rem).\n"
        "          var html = '<div style=\"display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:.1rem .6rem;padding:0 0 .2rem;'\n"
        "            + 'font-family:\\'JetBrains Mono\\',monospace;font-size:.75rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted)\">'\n"),
        'header row')

    # E: read time. Network: the time the network file was built. Licensed:
    # the moment this page read it.
    t = once(t,
        "        var now = thisMonth();\n        var rows = [];\n        snap.bids.forEach(function(r){\n",
        "        var now = thisMonth();\n        var rows = [];\n        feedTimes.network = snap.fetched || null;\n        snap.bids.forEach(function(r){\n",
        'net fetched')
    t = once(t,
        "      .then(function(data){ return {rows: flattenBarchartResponse(data), ok: true}; })\n",
        "      .then(function(data){ feedTimes.licensed = new Date().toISOString(); return {rows: flattenBarchartResponse(data), ok: true}; })\n",
        'lic fetched')
    t = once_d(t,
        "          // Footer link\n          var extra = totalElevators - MAX_ELEVATORS;\n",
        "          // When these numbers were read. Only feeds that put a row on the card.\n"
        "          var anyNet = top.some(function(e){ return e.fromNetwork; });\n"
        "          var anyLic = top.some(function(e){ return !e.fromNetwork; });\n"
        "          var when = [];\n"
        "          if(anyNet && ctTime(feedTimes.network)) when.push('Elevator boards as of ' + ctTime(feedTimes.network));\n"
        "          if(anyLic && ctTime(feedTimes.licensed)) when.push((when.length ? 'other quotes' : 'quotes') + ' read ' + ctTime(feedTimes.licensed));\n"
        "          if(when.length){\n"
        "            var w = when.join(' \\u00b7 ');\n"
        "            html += '<div class=\"bids-read-time\" style=\"font-family:\\'JetBrains Mono\\',monospace;font-size:.75rem;color:var(--text-muted);padding:.45rem 0 0\">' + escHtml(w.charAt(0).toUpperCase() + w.slice(1)) + '</div>';\n"
        "          }\n\n"
        "          // Footer link\n          var extra = totalElevators - MAX_ELEVATORS;\n",
        'read time')
    # The signup ask inside the card: a hairline line, not a second box. It
    # also marks the compact form as asked-for so the phone layout shows it.
    t = once_d(t,
        "            html += '<div style=\"margin-top:.5rem;padding:.6rem .7rem;background:var(--surface2);border:1px solid var(--border);border-radius:6px;text-align:center\">'\n",
        "            html += '<div style=\"margin-top:.5rem;padding:.5rem 0 0;border-top:1px solid var(--border);text-align:center\">'\n",
        'cta box')
    t = once_d(t,
        "                su.style.display = 'flex';\n",
        "                su.style.display = 'flex';\n                su.classList.add('is-asked');\n",
        'cta asked')
    return t

# ──────────────────────────────────────────────── components/homepage-extras.js
def patch_extras(t):
    t = once(t,
        " * Four real, wired features that were prototyped as a design-canvas mockup\n",
        " * Three real, wired features that were prototyped as a design-canvas mockup\n",
        'extras header count')
    t = rx_once(t, r" \*   3\. \"Since your last visit\".*? \*   4\. Add-to-home-screen",
        " *   (3, \"since your last visit\", removed 2026-10-01: it keyed on\n"
        " *   data/daily.json `basis.headline`, a field the Daily never writes, so it\n"
        " *   refetched the Daily on every load and could never display.)\n"
        " *   4. Add-to-home-screen", 'extras header item 3')
    t = rx_once(t, r"  // ── 3: since your last visit ─+\n.*?  loadDailyForSnapshot\(\);\n\n", '', 'extras section 3')
    return t


def patch_bids_r2(t):
    t = once(t, "var NET_SCRIPT = '/components/bids-network.js?v=1';", "var NET_SCRIPT = '/components/bids-network.js?v=2';", 'net script v')
    # Wheat basis names its exchange: Dec KC is not Dec Chicago or Dec MGEX.
    t = once(t, "  function refMonth(sym){\n    var m = /^[A-Z]{1,3}([FGHJKMNQUVXZ])(\\d{2})$/.exec(String(sym || '').trim().toUpperCase());\n    return m ? FUT_MON[m[1]] : '';\n  }\n",
        "  var WHEAT_EXCH = {KE:'KC', ZW:'Chi', MW:'MGEX'};\n"
        "  function refMonth(sym){\n    var m = /^([A-Z]{1,3})([FGHJKMNQUVXZ])(\\d{2})$/.exec(String(sym || '').trim().toUpperCase());\n"
        "    return m ? FUT_MON[m[2]] + (WHEAT_EXCH[m[1]] ? ' ' + WHEAT_EXCH[m[1]] : '') : '';\n  }\n", 'refMonth exch')
    # One elevator's network rows and licensed rows are grouped apart, so a
    # licensed price never sits under "direct from elevator".
    t = once(t, "      var key = (b.facility||'') + '||' + (b.branch||'') + '||' + (b.city||'');\n",
        "      var key = (b.facility||'') + '||' + (b.branch||'') + '||' + (b.city||'') + '||' + (b.source === 'network' ? 'n' : 'l');\n", 'group key')
    # Network rows: a window that is still open is a bid. The old test used
    # the window's START month, so "2026-08/2026-11" was dropped in October.
    t = once(t, "          if(/^\\d{4}-\\d{2}/.test(r.period || '') && r.period.slice(0, 7) < now) return;\n",
        "          var pEnd = String(r.period || '').split('/').pop();\n"
        "          if(/^\\d{4}-\\d{2}/.test(pEnd) && pEnd.slice(0, 7) < now) return;\n", 'open window')
    t = once(t, "            basis: r.basis == null ? null : r.basis,\n            deliveryMonth: periodLabel(r.period) || r.delivery || '',\n",
        "            // The network says its basis in cents; carry that, no unit guess.\n"
        "            basis: r.basisCents != null && isFinite(r.basisCents) ? r.basisCents / 100 : (r.basis == null ? null : r.basis),\n"
        "            deliveryMonth: periodLabel(r.period) || r.delivery || '',\n"
        "            checkedAt: r.checkedAt || null,\n", 'net basis cents')
    t = once(t, "  function periodLabel(p){\n    var m = /^(\\d{4})-(\\d{2})/.exec(p || '');\n    return m && MON[+m[2] - 1] ? MON[+m[2] - 1] + ' ' + m[1] : '';\n  }\n",
        "  function periodLabel(p){\n"
        "    var m = /^(\\d{4})-(\\d{2})(?:\\/(\\d{4})-(\\d{2}))?/.exec(p || '');\n"
        "    if(!m || !MON[+m[2] - 1]) return '';\n"
        "    /* A window: \\\"Aug\\u2013Nov 2026\\\", so an open Aug-Nov bid does not read as August. */\n"
        "    if(m[3] && (m[3] !== m[1] || m[4] !== m[2]) && MON[+m[4] - 1])\n"
        "      return MON[+m[2] - 1] + (m[3] === m[1] ? '' : ' ' + m[1]) + '\\u2013' + MON[+m[4] - 1] + ' ' + m[3];\n"
        "    return MON[+m[2] - 1] + ' ' + m[1];\n  }\n", 'period label')
    t = once(t, "    var m = /^(\\d{4})-(\\d{2})/.exec(String(r.deliveryStart || ''));\n    return m ? m[1] + '-' + m[2] : '';\n  }\n",
        "    var m = /^(\\d{4})-(\\d{2})(?:\\/(\\d{4})-(\\d{2}))?/.exec(String(r.deliveryStart || ''));\n"
        "    if(!m) return '';\n"
        "    var st = m[1] + '-' + m[2], nw = thisMonth();\n"
        "    /* An open window counts as this month, not the month it opened. */\n"
        "    if(m[3] && st < nw && (m[3] + '-' + m[4]) >= nw) return nw;\n"
        "    return st;\n  }\n", 'rowMonthKey window')
    # Licensed rows: the delivery window's end, and drop windows already closed.
    t = once(t, "            symbol: bid.symbol || item.symbol || '',\n",
        "            symbol: bid.symbol || item.symbol || '',\n            deliveryEnd: bid.deliveryEnd || bid.delivery_end || '',\n", 'lic end 1')
    t = once(t, "          symbol: item.symbol || '',\n",
        "          symbol: item.symbol || '',\n          deliveryEnd: item.deliveryEnd || item.delivery_end || '',\n", 'lic end 2')
    t = once(t, "return {rows: flattenBarchartResponse(data), ok: true}; })\n",
        "var today = new Date().toISOString().slice(0, 10);\n"
        "        /* A delivery window that ended before today is not a bid (Sep 26 corn on Oct 1). */\n"
        "        var rows = flattenBarchartResponse(data).filter(function(b){ var e = String(b.deliveryEnd || '').slice(0, 10); return !(/^\\d{4}-\\d{2}-\\d{2}$/.test(e) && e < today); });\n"
        "        return {rows: rows, ok: true}; })\n", 'lic drop closed')
    # Summary: basis in one unit (dollars) before any average; count elevators.
    t = once(t, "        if(pool[bi].basis != null) basisVals.push(pool[bi].basis);\n",
        "        if(pool[bi].basis != null){ basisVals.push(basisCents(pool[bi].basis) / 100); basisElev[rowKey(pool[bi])] = 1; }\n", 'avg unit')
    t = once(t, "      var basisVals = [];\n", "      var basisVals = [], basisElev = {};\n", 'avg elev init')
    t = once(t, "          if(typeof np.lat !== 'number' || typeof np.lon !== 'number' || np.basis == null) continue;\n          if(milesBetween(best.lat, best.lon, np.lat, np.lon) <= NEARBY_RADIUS_MI) nearVals.push(np.basis);\n",
        "          if(typeof np.lat !== 'number' || typeof np.lon !== 'number' || np.basis == null) continue;\n          if(milesBetween(best.lat, best.lon, np.lat, np.lon) <= NEARBY_RADIUS_MI){ nearVals.push(basisCents(np.basis) / 100); nearElev[rowKey(np)] = 1; }\n", 'near unit')
    t = once(t, "        var nearVals = [];\n", "        var nearVals = [], nearElev = {};\n", 'near init')
    t = once(t, "        avgBasisNearbyCount = nearVals.length;\n",
        "        avgBasisNearbyCount = nearVals.length;\n        avgBasisNearbyElevators = Object.keys(nearElev).length;\n", 'near elev count')
    t = once(t, "      var nearbyRadiusMiles, avgBasisNearby, avgBasisNearbyCount;\n",
        "      var nearbyRadiusMiles, avgBasisNearby, avgBasisNearbyCount, avgBasisNearbyElevators;\n", 'near vars')
    t = once(t, "        basis: (best.basis == null ? null : best.basis),\n",
        "        basis: (best.basis == null ? null : basisCents(best.basis) / 100),\n        monthKey: bestMonthKey,\n", 'sum basis unit')
    t = once(t, "        avgBasisCount: basisVals.length,\n",
        "        avgBasisCount: basisVals.length,\n        avgBasisElevators: Object.keys(basisElev).length,\n        avgBasisNearbyElevators: avgBasisNearbyElevators,\n", 'sum elev counts')
    # Read time: the oldest board read among the network elevators shown.
    t = once(t, "        if(anyNet && ctTime(feedTimes.network)) when.push('Elevator boards as of ' + ctTime(feedTimes.network));\n",
        "        /* Each network board carries the time it was last read (checkedAt).\n"
        "           The file's build time is not that, so it is not printed here. */\n"
        "        var oldest = null;\n"
        "        top.forEach(function(e){ if(!e.fromNetwork) return; COMM_ORDER.forEach(function(c){ (e.commodities[c] || []).forEach(function(b){ if(b.checkedAt && (!oldest || b.checkedAt < oldest)) oldest = b.checkedAt; }); }); });\n"
        "        if(anyNet && ctTime(oldest)) when.push('Elevator boards read ' + ctTime(oldest) + (top.filter(function(e){ return e.fromNetwork; }).length > 1 ? ' or later' : ''));\n", 'read time oldest')
    return t

def patch_net_r2(t):
    t = once(t, "      basisCents: n.basisCents,\n",
        "      basisCents: n.basisCents,\n      /* When this elevator's own board was last read. */\n      checkedAt: p.checkedAt || p.pricedAt || null,\n", 'net checkedAt')
    return t

def patch_extras_r2(t):
    # Compare lines: elevators, not bids; at least 3 for the any-distance
    # line; the 50-mile search radius and same month stated.
    t = once(t, "      if(sum.avgBasis != null && sum.avgBasisCount >= MIN_COMPARE_N && sum.basis != null){\n",
        "      if(sum.avgBasis != null && (sum.avgBasisElevators || 0) >= 3 && sum.basis != null){\n", 'cmp gate')
    t = once(t, "the average of ' + sum.avgBasisCount + ' other corn bid' + (sum.avgBasisCount === 1 ? '' : 's') + ' found.';",
        "the average at ' + sum.avgBasisElevators + ' other elevators within 50 mi, same delivery month.';", 'cmp text')
    t = once(t, "<strong>This search, any distance:</strong>", "<strong>Best bid vs. this search:</strong>", 'cmp label')
    t = once(t, "      if(sum.nearbyRadiusMiles && sum.avgBasisNearbyCount >= MIN_COMPARE_N && sum.avgBasisNearby != null && sum.basis != null){\n",
        "      if(sum.nearbyRadiusMiles && (sum.avgBasisNearbyElevators || 0) >= MIN_COMPARE_N && sum.avgBasisNearby != null && sum.basis != null){\n", 'ring gate')
    t = once(t, "the average of ' + sum.avgBasisNearbyCount + ' other bid' + (sum.avgBasisNearbyCount === 1 ? '' : 's') + ' in that fixed ring, not road miles.';",
        "the average at ' + sum.avgBasisNearbyElevators + ' other elevators in that fixed ring, not road miles.';", 'ring text')
    # Basis chart: prefer the series for the headline's delivery month, plot
    # by date, and say the month and the date range.
    t = once(t, "      var best = null, bestLen = 0;\n",
        "      var best = null, bestLen = 0, bestMon = '', wantMon = '';\n"
        "      var MM = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];\n"
        "      var mk = /^(\\d{4})-(\\d{2})$/.exec(sum.monthKey || '');\n"
        "      if(mk) wantMon = MM[+mk[2] - 1] + mk[1].slice(2);\n"
        "      var bestMatch = false;\n", 'chart vars')
    t = once(t, "        var pts = data.series[key];\n        if(pts.length > bestLen){ best = pts; bestLen = pts.length; }\n",
        "        var pts = data.series[key], match = !!wantMon && parts[5] === wantMon;\n"
        "        if((match && !bestMatch) || (match === bestMatch && pts.length > bestLen)){ best = pts; bestLen = pts.length; bestMon = parts[5]; bestMatch = match; }\n", 'chart pick')
    t = once(t, "      var xs = pts.map(function(_, i){ return pts.length === 1 ? w / 2 : pad + i * (w - 2 * pad) / (pts.length - 1); });\n",
        "      /* x by date, so a three-month gap looks like one. */\n"
        "      var tms = pts.map(function(p){ return Date.parse(p.date); });\n"
        "      var t0 = tms[0], t1 = tms[tms.length - 1];\n"
        "      var xs = tms.map(function(tm, i){ return (pts.length === 1 || !(t1 > t0)) ? pad + i * (w - 2 * pad) / Math.max(1, pts.length - 1) : pad + (tm - t0) * (w - 2 * pad) / (t1 - t0); });\n", 'chart x by date')
    t = once(t, "      fine.textContent = pts.length + ' real basis change' + (pts.length === 1 ? '' : 's') + ' logged at this elevator since ' + firstDate + '. Corn only; the delivery month here may not match the month quoted above.';\n",
        "      var monTxt = /^[A-Z]{3}\\d{2}$/.test(bestMon) ? bestMon.charAt(0) + bestMon.slice(1, 3).toLowerCase() + ' \\u2019' + bestMon.slice(3) + ' delivery' : 'one delivery month';\n"
        "      fine.textContent = pts.length + ' basis change' + (pts.length === 1 ? '' : 's') + ' logged at this elevator for ' + monTxt + ', ' + firstDate + ' through ' + pts[pts.length - 1].date + ', ' + lo + '\\u00a2 to ' + hi + '\\u00a2.'\n"
        "        + (bestMatch ? '' : ' Not the month quoted above.');\n", 'chart fine')
    return t

def patch_geo_r2(t):
    # The ticker's loop copy is hidden from screen readers; now it is also
    # out of the tab order (its items are links on the homepage).
    t = once(t, "    c.setAttribute('aria-hidden', 'true');\n    track.appendChild(c);\n",
        "    c.setAttribute('aria-hidden', 'true');\n    c.inert = true;\n"
        "    Array.prototype.forEach.call(c.querySelectorAll('a'), function(a){ a.tabIndex = -1; });\n    track.appendChild(c);\n", 'ticker clone inert')
    return t

# ───────────────────────────────────────────── round 3: mini-panel findings
def patch_index1_r3(t):
    t = once(t, "var dn=(dirOnly.played!=null&&dirOnly.graded)?' ('+dirOnly.played+' of '+dirOnly.graded+')':'';",
             "var dn=(typeof dirOnly.right_way==='number'&&dirOnly.graded)?' ('+dirOnly.right_way+' of '+dirOnly.graded+')':'';", 'scorecard n field')
    t = once(t, "+' contracts, '+cp+'% of the way up its 52-wk range'+(_fclause==='.'?'.':_fclause);}",
             "+' contracts, '+cp+'% of the way up its 52-wk range'+(_fclause==='.'?'.':_fclause)+(cotAsOf?' COT as of '+cotAsOf+'.':'');}", 'cot asof use')
    t = once(t, "      var asOf='';try{",
             "      /* cot.json `updated` is when the file was built; report_date is the positions' date. */\n"
             "      var cotAsOf='';try{if(cot.report_date){var _c=new Date(cot.report_date);if(!isNaN(_c))cotAsOf=_c.toLocaleDateString('en-US',{month:'short',day:'numeric'});}}catch(e){}\n"
             "      var asOf='';try{", 'cot asof var')
    t = once(t, "#idx1-trust-ledger{font-family:", ".idx1-extras-card .idx1-extras-title{margin-top:16px}\n#idx1-trust-ledger{font-family:", 'calc title gap')
    return t

def patch_bids_r3(t):
    # "Other elevators" excludes every row of the headline elevator.
    t = once(t, "        if(pool[bi] === best) continue;\n", "        if(pool[bi] === best || rowKey(pool[bi]) === rowKey(best)) continue;\n", 'skip own elevator 1')
    t = once(t, "          if(np === best) continue;\n", "          if(np === best || rowKey(np) === rowKey(best)) continue;\n", 'skip own elevator 2')
    # Licensed basis unit: under 1 is dollars, 5 or more is cents, between is
    # ambiguous (-3 could be -3c or -$3.00) and is withheld, never guessed.
    t = once(t, "  function flatNum(v){ var n = parseFloat(v); return isFinite(n) ? n : null; }\n",
        "  function flatNum(v){ var n = parseFloat(v); return isFinite(n) ? n : null; }\n"
        "  function licBasis(v){ var n = flatNum(v); if(n == null) return null; var a = Math.abs(n); return a < 1 ? n : a >= 5 ? n / 100 : null; }\n", 'licBasis fn')
    t = once(t, "            basis: flatNum(bid.basis),\n", "            basis: licBasis(bid.basis),\n", 'licBasis 1')
    t = once(t, "          basis: flatNum(item.basis),\n", "          basis: licBasis(item.basis),\n", 'licBasis 2')
    # Dates in Central time, the same clock the read-time line uses.
    t = once(t, "  function thisMonth(){ var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2); }\n",
        "  function ctToday(){ try{ return new Date().toLocaleDateString('en-CA', {timeZone:'America/Chicago'}); }catch(e){ return new Date().toISOString().slice(0, 10); } }\n"
        "  function thisMonth(){ return ctToday().slice(0, 7); }\n", 'ct month')
    t = once(t, "var today = new Date().toISOString().slice(0, 10);\n", "var today = ctToday();\n", 'ct today')
    return t

def patch_extras_r3(t):
    t = once(t, "      var lo = Math.min.apply(null, cents), hi = Math.max.apply(null, cents);\n      if(lo === hi){ lo -= 1; hi += 1; }\n",
        "      var lo = Math.min.apply(null, cents), hi = Math.max.apply(null, cents);\n"
        "      var rawLo = lo, rawHi = hi;   // printed; lo/hi below may be widened for drawing only\n"
        "      if(lo === hi){ lo -= 1; hi += 1; }\n", 'raw lo hi')
    t = once(t, "'Basis at this elevator ranged from ' + lo + ' to ' + hi + ' cents", "'Basis at this elevator ranged from ' + rawLo + ' to ' + rawHi + ' cents", 'aria raw')
    t = once(t, "' through ' + pts[pts.length - 1].date + ', ' + lo + '\\u00a2 to ' + hi + '\\u00a2.'", "' through ' + pts[pts.length - 1].date + ', ' + rawLo + '\\u00a2 to ' + rawHi + '\\u00a2.'", 'fine raw')
    return t

# ───────────────────────────────────────────── round 4: Sig's rail order, the Wire up
R4_CSS = r"""
<style>
/* ===== 2026-10-01 round 4: the Wire sits under the board, open ===== */
#dash-grid>#wire-band{grid-column:1/-1}
@media(min-width:1240px){
  #dash-grid>#wire-band{grid-row:4}
  #dash-grid>.m-fold--tools{grid-row:5!important}
}
@media(max-width:900px){
  #wire-band{order:45!important}
}
</style>
"""
def patch_index1_r4(t):
    # Sig, 2026-10-01: "the top tile on the right be upcoming usda reports,
    # then cot then yield nowcast."
    # 1) Inside the USDA block, the upcoming-dates strip leads; the Grain
    #    Stocks recap follows it.
    t = move_block(t, '    <div class="usda-cal-card"><div class="cal-strip" id="usda-cal-strip"',
                   '  </div>\n<div class="fade-up" id="f-rail-scorecard"',
                   "    <!-- 2026-09-30: today's real September Grain Stocks print", 'usda strip first')
    # 2) COT before the yield nowcast inside the Market Intelligence block.
    t = move_block(t, '      <div class="cot-widget" id="cot-widget">',
                   '    </div>\n  </div>\n</details>\n<div class="fade-up" id="f5">',
                   '      <div class="idx1-nowcast-na"', 'cot before nowcast')
    # 3) USDA reports at the top of the rail.
    t = move_block(t, '<div class="fade-up" id="f5">', '<div class="fade-up" id="f-rail-scorecard"',
                   '<details class="m-fold m-fold--cot" open>', 'usda top of rail')
    # Sig: "what about our news wire, where is that". It was a closed row at
    # 3,568px on a phone and 5,213px on desktop. Now: right after weather,
    # inside the bids/board/weather group, open, four items.
    t = move_block(t, '  <details class="wr fade-up" id="wire-band" hidden>',
                   '  <details class="hbz fade-up" id="harvest-band">',
                   '    <div class="fade-up" id="f-rail-scorecard-teaser">', 'wire into dash-grid')
    t = once(t, '<details class="wr fade-up" id="wire-band" hidden>', '<details class="wr fade-up" id="wire-band" open hidden>', 'wire open')
    t = once(t, "    g.innerHTML=items.slice(0,3).map(function(i){", "    g.innerHTML=items.slice(0,4).map(function(i){", 'wire 4 items')
    t = once(t, '</head>', R4_CSS + '</head>', 'r4 css')
    return t

# ───────────────────────────────────────────── round 5: second panel (layout, IA, SEO, analytics, growth)
R5_HEAD = r"""<script>
/* Before first paint: a reader with a saved ZIP gets bids, so the bids box
   reserves its height (phone CLS measured 0.32 without this). */
try{var _w=JSON.parse(localStorage.getItem('agsist-wx-loc')||'null');if(_w&&/^\d{5}$/.test(_w.zip||''))document.documentElement.classList.add('has-zip');}catch(e){}
</script>
"""

R5_CSS = r"""
<style>
/* ===== 2026-10-01 round 5: second panel ===== */
/* Reserve the bids card's height for a returning reader. */
html.has-zip #bids-list-area{min-height:820px}
@media(min-width:901px){html.has-zip #bids-list-area{min-height:760px}}
/* Tooltip: a visible text trigger, tap or Enter opens, Esc closes. */
.tip{position:relative;display:inline-block}
.tip-b{font:500 12px/24px 'JetBrains Mono',monospace;color:var(--text-dim);background:none;border:0;border-bottom:1px dotted currentColor;padding:0 2px;min-height:24px;cursor:pointer;letter-spacing:0;text-transform:none}
.tip-b:focus-visible{outline:2px solid var(--gold);outline-offset:2px}
.tip-t{position:absolute;z-index:60;top:calc(100% + 4px);left:0;width:max-content;max-width:min(300px,calc(100vw - 32px));padding:8px 12px;background:#161b1c;border:1px solid rgba(132,160,168,.24);font:400 13px/1.5 Inter,system-ui,sans-serif;color:var(--text);white-space:normal;text-align:left;text-transform:none;letter-spacing:0}
.tip-t[hidden]{display:none}
.cot-full-link{white-space:nowrap}
/* One email ask: the compact bar only when a reader asks for it. */
#signup-compact:not(.is-asked){display:none!important}
#signup-full .signup-icon,#signup-full .signup-tabs{display:none}
@media(min-width:901px){
  #signup-full{padding:24px!important}
  #signup-full .signup-headline{font-size:1.5rem!important;margin-bottom:8px}
  #signup-full .signup-sub{font-size:.9rem;margin-bottom:12px}
}
/* The bid-network note: one ruled line under the card at every width. */
#f1{display:flex;flex-direction:column}
#f1>.sec-head{order:1}#f1>.card{order:2}
#f1>.bidnet-note{order:3;margin:8px 0 0;padding:8px 0;border:0;border-top:1px solid var(--hair);border-radius:0;background:none;font-size:.75rem}
#f1>.bidnet-note .bidnet-txt{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* The Wire: two columns of cards on wide screens, ruled not boxed. */
#wire-g{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(260px,100%),1fr));gap:0 24px}
#wire-g .wr-c{background:none!important;border:0!important;border-top:1px solid var(--hair)!important;border-radius:0!important;padding:12px 0!important}
#wire-g .wr-c.hi strong{color:var(--gold)}
.wr-meta{font-family:'JetBrains Mono',monospace;font-size:.75rem;color:var(--text-muted);margin:4px 0 0}
/* Land, storage & risk band. */
.idx1-land{margin:0 0 24px;padding-top:16px;border-top:1px solid var(--hair)}
.land-grid{display:grid;grid-template-columns:minmax(0,2fr) repeat(3,minmax(0,1fr));gap:0 24px}
.land-cell{display:flex;flex-direction:column;gap:4px;padding:12px 0;border-top:1px solid var(--hair);text-decoration:none;color:inherit;min-height:44px}
.land-cell:hover .land-v{text-decoration:underline}
.land-k{font-family:'JetBrains Mono',monospace;font-size:.75rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--text-muted)}
.land-v{font-size:1rem;font-weight:700;color:var(--text);line-height:1.3}
.land-lead .land-v{font-size:1.15rem}
.land-v .n{font-family:'JetBrains Mono',monospace}
.land-s{font-size:.8rem;color:var(--text-dim);line-height:1.45}
.land-links{list-style:none;margin:12px 0 0;padding:0;display:flex;flex-wrap:wrap;gap:4px 16px;font-size:.85rem}
.land-links a{color:var(--text-dim);text-decoration:none;display:inline-flex;min-height:32px;align-items:center}
.land-links a:hover{color:var(--text);text-decoration:underline}
@media(max-width:900px){
  .land-grid{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}
  .land-lead{grid-column:1/-1}
  #idx1-land{order:55}
  .idx1-content>.m-fold--tools{order:56!important}
  #signup-compact{order:57!important}
}
/* 901-1239: the gutter, and Quick Tools full width. */
@media(min-width:901px) and (max-width:1239px){
  #main.main{padding-left:16px!important;padding-right:16px!important}
  #dash-grid>.m-fold--tools{grid-column:1/-1}
}
/* Desktop: the lower page runs full width under the rail. */
@media(min-width:1240px){
  .idx1-shell{grid-template-columns:minmax(0,1.15fr) minmax(0,1fr) 340px!important;column-gap:24px;row-gap:0}
  .idx1-content,#dash-grid,#f-prices{display:contents!important}
  .idx1-content>*{grid-column:1/-1}
  .idx1-content>.home-h1{grid-column:1/3}
  .idx1-content>.idx1-zone-label{grid-column:1/3;grid-row:1}
  #f1{grid-column:1!important;grid-row:2/5!important;align-self:start;margin-bottom:24px}
  #f2{grid-column:2!important;grid-row:2!important;align-self:start}
  #wire-band{grid-column:2!important;grid-row:3!important;align-self:start}
  #wire-g{grid-template-columns:minmax(0,1fr)!important}
  /* Under the weather card there is room for two; the rest is one tap away. */
  #wire-g .wr-c:nth-child(n+3){display:none}
  #f-rail-scorecard-teaser{display:none}
  #market-intel{grid-column:3!important;grid-row:1/9!important;align-self:start}
  #f-prices>.sec-head{grid-column:1/3;grid-row:5;margin-top:24px}
  #f-prices>.pc-section-lbl{grid-column:1/3;grid-row:6}
  #f-prices>.price-cards-grid{grid-column:1/3;grid-row:7}
  #f-prices>.m-fold--usda{grid-column:1/3;grid-row:8}
  #f-prices>.m-fold--more{grid-column:1/-1;grid-row:9}
  #f-prices>.m-fold--outside{grid-column:1/-1;grid-row:10}
  #dash-grid>.m-fold--tools{grid-column:1/-1!important;grid-row:11!important}
  .faq-list{columns:2;column-gap:24px}
  .faq-list .faq-item{break-inside:avoid}
}
</style>
"""

R5_TIP_JS = r"""
<script>
/* Tooltips: one open at a time; tap, click or Enter toggles; Esc closes and
   returns focus; a tap outside closes. */
(function(){var cur=null;
function close(f){if(!cur)return;cur.b.setAttribute('aria-expanded','false');cur.t.hidden=true;var b=cur.b;cur=null;if(f)b.focus();}
document.addEventListener('click',function(e){var b=e.target.closest?e.target.closest('.tip-b'):null;
  if(!b){if(cur&&!(e.target.closest&&e.target.closest('.tip-t')))close();return;}
  e.preventDefault();e.stopPropagation();
  var t=document.getElementById(b.getAttribute('aria-describedby'));if(!t)return;
  if(cur&&cur.b===b){close();return;}close();
  t.hidden=false;t.style.left='0';t.style.right='auto';
  if(t.getBoundingClientRect().right>innerWidth-8){t.style.left='auto';t.style.right='0';}
  b.setAttribute('aria-expanded','true');cur={b:b,t:t};},true);
document.addEventListener('keydown',function(e){if(e.key==='Escape')close(true);});
})();
</script>
"""

R5_LAND_HTML = r"""  <section class="fade-up idx1-land" id="idx1-land" aria-labelledby="land-h">
    <div class="sec-head"><h2 class="sec-title" id="land-h">Land, Storage &amp; Risk</h2><a href="/farmland-atlas" class="sec-all" data-track="land">Farmland Atlas &rarr;</a></div>
    <div class="land-grid">
      <a class="land-cell land-lead" id="land-atlas" href="/farmland-atlas" data-track="land"><span class="land-k">Farmland Atlas</span><span class="land-v" id="land-atlas-v">Rent, land value and risk for every US county</span><span class="land-s" id="land-atlas-s">Open the map</span></a>
      <a class="land-cell" id="land-hail" href="/hail-map" data-track="land" hidden><span class="land-k">Hail, 30 days</span><span class="land-v" id="land-hail-v"></span><span class="land-s" id="land-hail-s"></span></a>
      <a class="land-cell" id="land-storage" href="/storage-crunch" data-track="land" hidden><span class="land-k">Storage</span><span class="land-v" id="land-storage-v"></span><span class="land-s" id="land-storage-s"></span></a>
      <a class="land-cell" id="land-foreign" href="/foreign-land" data-track="land" hidden><span class="land-k">Foreign-held land</span><span class="land-v" id="land-foreign-v"></span><span class="land-s" id="land-foreign-s"></span></a>
    </div>
    <ul class="land-links">
      <li><a href="/cash-rent" data-track="land">Cash rent by county</a></li>
      <li><a href="/land-tenure" data-track="land">Who rents the land</a></li>
      <li><a href="/cash-lease" data-track="land">Cash lease</a></li>
      <li><a href="/harvest-price-tracker" data-track="land">Harvest price</a></li>
      <li><a href="/crop-tour" data-track="land">Crop tour</a></li>
      <li><a href="/basis" data-track="land">Basis vs normal</a></li>
      <li><a href="/farm-bill" data-track="land">Farm bill</a></li>
      <li><a href="/milk-prices" data-track="land">Milk prices</a></li>
      <li><a href="/ag-odds" data-track="land">Ag odds</a></li>
      <li><a href="/archive" data-track="land">Every Daily briefing</a></li>
    </ul>
  </section>
  <script>
  /* Land band. Every number comes from a file in /data or the Atlas build,
     fetched only when the band is near the screen. A cell whose file fails
     stays hidden; the Atlas cell keeps its plain text. */
  (function(){
    var band=document.getElementById('idx1-land'); if(!band) return;
    function $(i){return document.getElementById(i);}
    function get(u){return fetch(u).then(function(r){return r.ok?r.json():null;}).catch(function(){return null;});}
    function show(id,v,s){var c=$(id),a=$(id+'-v'),b=$(id+'-s');if(!c||!a)return;a.innerHTML=v;if(b)b.textContent=s||'';c.hidden=false;}
    function n(x){return '<span class="n">'+x+'</span>';}
    var MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    function day(s){var m=/^(\d{4})-(\d{2})-(\d{2})/.exec(s||'');return m?MON[+m[2]-1]+' '+(+m[3]):'';}
    var loc=null;try{loc=JSON.parse(localStorage.getItem('agsist-wx-loc')||'null');}catch(e){}
    var st=loc&&/^[A-Z]{2}$/.test(loc.state||'')?loc.state:'';
    var cty=loc&&loc.county?String(loc.county).replace(/\s+County$/i,''):'';
    function run(){
      get('/farmland-atlas/data/cards.json').then(function(d){
        if(!d||!d.counties)return;
        var hit=null;
        if(st&&cty){for(var k in d.counties){var c=d.counties[k];if(c.st===st&&String(c.n||'').replace(/\s+County$/i,'').toLowerCase()===cty.toLowerCase()){hit=c;break;}}}
        if(hit&&hit.r!=null){
          var a=$('land-atlas');if(a&&hit.u)a.href=hit.u;
          show('land-atlas',hit.n+', '+hit.st+': cash rent '+n('$'+Math.round(hit.r))+'/ac'+(hit.ry?' ('+hit.ry+')':''),
            (hit.v!=null?'Land $'+Math.round(hit.v).toLocaleString('en-US')+'/ac'+(hit.vy?' ('+hit.vy+' Census)':''):'')
            +(d.states&&d.states[st]&&d.states[st].r!=null?' · '+(d.states[st].n||st)+' average rent $'+Math.round(d.states[st].r)+'/ac':''));
        } else {
          show('land-atlas',n(Object.keys(d.counties).length.toLocaleString('en-US'))+' counties: rent, land value and risk','Open the map');
        }
      });
      get('/data/hail/recent.json').then(function(h){
        if(!h||!h.reports||!h.reports.length)return;
        var big=h.reports.reduce(function(a,b){return (b.mag||0)>(a.mag||0)?b:a;});
        var inSt=st?h.reports.filter(function(r){return r.st===st;}).length:null;
        show('land-hail',n((h.count||h.reports.length).toLocaleString('en-US'))+' reports',
          'Largest '+big.mag+' in, '+big.city+' '+big.st+', '+day(big.date)+(inSt!=null?' · '+st+': '+inSt+' report'+(inSt===1?'':'s'):''));
      });
      get('/data/storage/storage.json').then(function(s){
        if(!s||!s.national||!s.latest_year)return;var y=s.latest_year,N=s.national;
        var p=N.prod&&N.prod[y],c=N.cap&&N.cap[y];if(!p||!c)return;
        var sr=st&&s.states&&s.states[st]&&s.states[st].ratio?s.states[st].ratio[y]:null;
        show('land-storage',n((p/1e9).toFixed(1)+'B')+' bu grown, '+n((c/1e9).toFixed(1)+'B')+' storable',
          'US, '+y+(sr!=null?' · '+st+' grew '+Math.round(sr*100)+'% of its storage':''));
      });
      get('/data/afida/national.json').then(function(a){
        if(!a||!a.total_by_year||!a.latest_year)return;var y=a.latest_year,t=a.total_by_year[y];if(!t)return;
        var f=a.by_land_type&&a.by_land_type.Forest?Math.round(a.by_land_type.Forest/t*100):null;
        show('land-foreign',n((t/1e6).toFixed(1)+'M')+' acres',
          'US, '+y+', self-reported to USDA'+(f!=null?' · '+f+'% of it forest':''));
      });
    }
    if('IntersectionObserver' in window){var io=new IntersectionObserver(function(es){if(es.some(function(e){return e.isIntersecting;})){io.disconnect();run();}},{rootMargin:'600px'});io.observe(band);}
    else run();
  })();
  </script>
"""

R5_ANALYTICS = r"""
<script>
/* Homepage analytics. Event names and coarse labels only: no ZIP, no email,
   no price a reader typed. Does nothing if gtag is not on the page. */
(function(){
  'use strict';
  function t(n,p){try{p=p||{};p.page='home';if(typeof window.gtag==='function')window.gtag('event',n,p);}catch(e){}}
  window.agTrack=t;
  document.addEventListener('click',function(e){try{
    var el=e.target&&e.target.closest?e.target.closest('[data-track]'):null;
    if(el){var a=el.tagName==='A'?el:el.closest('a');
      t('module_click',{module:el.getAttribute('data-track'),target:(a?(a.getAttribute('href')||''):'').split(/[?#]/)[0].slice(0,80)});}
    var s=e.target&&e.target.closest?e.target.closest('summary.m-fold-sum'):null;
    if(s&&s.parentNode){var m=/m-fold--(\w+)/.exec(s.parentNode.className);t('fold_toggle',{fold:m?m[1]:'x',state:s.parentNode.open?'close':'open'});}
  }catch(x){}},true);
  var hit={},raf=0;
  addEventListener('scroll',function(){if(raf)return;raf=requestAnimationFrame(function(){raf=0;try{
    var h=document.documentElement,d=h.scrollHeight-innerHeight;if(d<=0)return;var p=Math.round(scrollY/d*100);
    [25,50,75,100].forEach(function(m){if(p>=m&&!hit[m]){hit[m]=1;t('scroll_depth',{pct:m});}});}catch(x){}});},{passive:true});
  (function(){var area=document.getElementById('bids-list-area');if(!area||!window.MutationObserver)return;var t0=Date.now(),done=false;
    new MutationObserver(function(){if(done)return;var txt=area.textContent||'';
      var st=area.querySelector('.bh-elev')?'ok':/No elevator bids/.test(txt)?'empty':/unavailable/.test(txt)?'error':'';
      if(!st)return;done=true;t('bids_render',{status:st,n:area.querySelectorAll('.bh-elev').length,ms:Date.now()-t0});
      if(st!=='ok')t('data_health',{feed:'bids',status:st});}).observe(area,{childList:true,subtree:true});})();
  if(typeof window.agsistSetZip==='function'){var o=window.agsistSetZip;window.agsistSetZip=function(){t('zip_set',{});return o.apply(this,arguments);};}
  var f=window.fetch;if(f){window.fetch=function(u){var s='';try{s=String(u&&u.url||u);}catch(x){}
    var kind=/price-watch-subscribe/.test(s)?'price':/elevator-watch-subscribe/.test(s)?'elevator':/\/subscribe(\?|$)/.test(s)?'signup':'';
    var p=f.apply(this,arguments);
    if(kind){p.then(function(r){return r.clone().json().catch(function(){return null;}).then(function(j){
        var res=!r.ok?'fail':(j&&j.error==='limit')?'limit':'ok';t(kind==='signup'?'signup_submit':'alert_submit',{kind:kind,result:res});});})
      .catch(function(){t(kind==='signup'?'signup_submit':'alert_submit',{kind:kind,result:'fail'});});}
    return p;};}
})();
</script>
"""

def tip(id_, label, text):
    return ('<span class="tip"><button type="button" class="tip-b" aria-expanded="false" aria-describedby="%s">%s</button>'
            '<span id="%s" role="tooltip" class="tip-t" hidden>%s</span></span>' % (id_, label, id_, text))

def patch_index1_r5(t):
    # SEO head. Hand-owned (bake_seo.py has no index entry).
    t = once(t, 'Corn, Soybean &amp; Wheat Prices Today | AGSIST</title>', 'Corn, Soybean &amp; Wheat Prices &amp; Cash Grain Bids Today | AGSIST</title>', 'title')
    t = once(t, '<meta name="description" content="Live corn, soybean & wheat futures updated every 30 min. Farm dashboard: spray advisory, urea risk, cash grain bids, USDA reports, daily briefing.">',
             '<meta name="description" content="Live corn, soybean and wheat futures, cash grain bids near you, farm weather, spray and urea risk, and USDA reports. Free, updated every 30 minutes.">', 'description')
    t = once(t, '<link rel="preload" href="/components/styles.css?v=18" as="style">\n', '', 'redundant preload')
    t = once(t, '"logo": {"@type": "ImageObject", "url": "https://agsist.com/img/og/agsist.jpg", "width": 1200, "height": 630}',
             '"logo": {"@type": "ImageObject", "url": "https://agsist.com/img/icon-512.png", "width": 512, "height": 512}', 'org logo')
    t = once(t, '{"@type": "ListItem", "position": 10, "name": "Ag Prediction Markets", "url": "https://agsist.com/ag-odds"}]}',
             '{"@type": "ListItem", "position": 10, "name": "Ag Prediction Markets", "url": "https://agsist.com/ag-odds"}, '
             '{"@type": "ListItem", "position": 11, "name": "Wheat Futures Prices Today", "url": "https://agsist.com/wheat-futures-prices"}, '
             '{"@type": "ListItem", "position": 12, "name": "Farmland Atlas", "url": "https://agsist.com/farmland-atlas"}, '
             '{"@type": "ListItem", "position": 13, "name": "Hail Map", "url": "https://agsist.com/hail-map"}, '
             '{"@type": "ListItem", "position": 14, "name": "Cash Rent by County", "url": "https://agsist.com/cash-rent"}]}', 'itemlist')
    t = once(t, 'Start every day knowing<br>what moves your markets.', 'Start every day knowing <br>what moves your markets.', 'headline space')
    t = once(t, '</head>', R5_HEAD + R5_CSS + '</head>', 'r5 head+css')

    # Text cuts and tooltips. Nothing the long text said is lost: it moves
    # into a tooltip a reader can open.
    t = rx_once(t, r'<div class="cot-caption">(.*?)</div>',
        lambda m: '<div class="cot-caption">Funds&rsquo; net position, placed within its past 52 weeks. ' + tip('tip-cot', 'How to read', m.group(1)) + '</div>', 'cot caption')
    t = rx_once(t, r'(<div style="font-size:0\.755rem;color:var\(--text-muted\);line-height:1\.55;margin-bottom:\.35rem">)(Built from Monday&rsquo;s USDA crop ratings.*?Tightens as the season ages\.) USDA&rsquo;s first survey forecast doesn&rsquo;t land until mid-August\.</div>',
        lambda m: m.group(1) + 'Weekly, from USDA crop ratings. ' + tip('tip-nowcast', 'How it works', m.group(2)) + '</div>', 'nowcast prose')
    t = once(t, 'AGSIST Yield Nowcast &mdash; This Year&rsquo;s Crop, Called Weekly</span>', 'Yield Nowcast &mdash; this year&rsquo;s crop</span>', 'nowcast title')
    t = once(t, "    <p style=\"font-size:.735rem;color:var(--text-muted);margin:.4rem .1rem 0;line-height:1.45\">Every forward call this site's own daily briefing makes, graded against the next settlement, misses included. Not a trading signal &mdash; a public record of whether the calls actually played out.</p>",
             '    <p style="font-size:.75rem;color:var(--text-muted);margin:8px 0 0;line-height:1.45">' + tip('tip-score', 'What&rsquo;s graded', "Every forward call this site's own daily briefing makes, graded against the next settlement, misses included. Not a trading signal; a public record of whether the calls played out.") + '</p>', 'scorecard prose')
    t = once(t, "<p style=\"font-size:.76rem;color:var(--text-muted);margin:0 0 .6rem;line-height:1.45\">Tell us a price, we'll email you the day a contract crosses it &mdash; one email, then it clears itself. Not a cash bid at your elevator; check your local basis separately.</p>",
             '<p style="font-size:.8rem;color:var(--text-muted);margin:0 0 8px;line-height:1.45">One email when a contract crosses your price, then it clears. ' + tip('tip-alert', 'Not a cash bid', 'This watches the futures price, not your elevator&rsquo;s bid. Check your local basis separately.') + '</p>', 'alert prose')
    t = once(t, '<div class="idx1-extras-fine">Storage cost over your months vs. the carry you are betting on — that is it. Does not include interest on the money tied up, shrink, or quality risk; call your elevator for their exact terms.</div>',
             '<div class="idx1-extras-fine">Storage cost over your months vs. the carry you expect. ' + tip('tip-calc', 'What&rsquo;s not counted', 'Interest on the money tied up, shrink and quality risk are not included. Call your elevator for their exact terms.') + '</div>', 'calc fine')
    t = once(t, '<div class="idx1-extras-sub">Plug in your own bin or commercial-storage numbers. Cash price fills in from your bid lookup above; edit it if it does not match what you would actually haul.</div>',
             '<div class="idx1-extras-sub">Your own bin or storage numbers. Cash price fills from your bid; change it to match your haul.</div>', 'calc sub')
    t = once(t, 'Posted cash price, not a contract. Freight, moisture and grade discounts are set by the elevator, not shown here &mdash; call to confirm before you haul. ',
             'Posted price, not a contract. Freight, moisture and grade discounts are the elevator&rsquo;s; call before you haul. ', 'bids disclaimer')
    t = once(t, "'M MT booked \\u00b7 AGSIST has not loaded USDA\\u2019s'+(EX_MY?' '+EX_MY:'')+' export projection yet, so no pace shown';",
             "'M MT booked \\u00b7 no pace shown';", 'export line')
    t = once(t, '<div class="export-footer"><span class="export-footer-date" id="exp-date">USDA FAS &middot; Weekly</span>',
             '<div class="export-footer"><span class="export-footer-date" id="exp-date">USDA FAS &middot; Weekly</span>' + tip('tip-export', 'Why no pace', 'Pace is bookings against USDA&rsquo;s 2026/27 export projection. That projection is not loaded on this site yet, so no pace is shown rather than one against last year&rsquo;s target.'), 'export tip')

    # The Wire. Ranked, guarded against the board, labelled with its age.
    t = once(t, "    g.innerHTML=items.slice(0,4).map(function(i){",
        "    /* 2026-10-01: news.json built at 8:10 PM CT Sep 30 carried Sep 30's\n"
        "       corn move (-20c) stamped Oct 1, and corn and December corn as two\n"
        "       items, while the board read +3 1/2c. On the homepage a board-move\n"
        "       item shows only if it is today's session (CT) and its direction\n"
        "       agrees with the live board; same headline twice shows once; high\n"
        "       significance first, then newest. */\n"
        "    var live=window.AGSIST_PRICE_DATA||null;   /* the quotes object, set by the board script */\n"
        "    var todayCT='';try{todayCT=new Date().toLocaleDateString('en-CA',{timeZone:'America/Chicago'});}catch(e){}\n"
        
        "    var seen={};\n"
        "    items=items.filter(function(i){\n"
        "      var k=(i.detail||'')+'|'+(i.kind||'');if(seen[k])return false;seen[k]=1;\n"
        "      var m=/^px:(\\d{4}-\\d{2}-\\d{2}):([a-z-]+):move$/.exec(i.id||'');\n"
        "      if(!m)return true;\n"
        "      if(!todayCT||m[1]!==todayCT||!live)return false;\n"
        "      var q=live[m[2]];if(!q||q.pctChange==null)return false;\n"
        "      var down=/ down /.test(' '+(i.headline||'')+' ');\n"
        "      return down?(q.pctChange<0):(q.pctChange>0);\n"
        "    });\n"
        "    if(!items.length) return;\n"
        "    items.sort(function(a,b){var s=(b.significance==='high')-(a.significance==='high');return s||String(b.ts||'').localeCompare(String(a.ts||''));});\n"
        "    if(sub) sub.textContent=items.length===1?'1 thing the numbers said':items.length+' things the numbers said';\n"
        "    g.innerHTML=items.slice(0,4).map(function(i){", 'wire guard')
    t = once(t, "      return '<a class=\"wr-c'+(i.significance==='high'?' hi':'')+'\" href=\"'+esc(i.url||'/news')+'\">'",
             "      return '<a class=\"wr-c'+(i.significance==='high'?' hi':'')+'\" data-track=\"wire\" href=\"'+esc(i.url||'/news')+'\">'", 'wire track')
    t = once(t, "    band.hidden=false;\n    if(window.gaEvent) gaEvent('wire_band_shown',{items:items.length});",
        "    var up=d.updated?new Date(d.updated):null;\n"
        "    if(up&&!isNaN(up)){var hrs=Math.round((Date.now()-up.getTime())/36e5);\n"
        "      if(hrs>36){return;} /* a wire older than a day and a half is not news */\n"
        "      var meta=document.createElement('p');meta.className='wr-meta';meta.textContent='Wire updated '+(hrs<1?'within the hour':hrs+' h ago');\n"
        "      var all=band.querySelector('.wr-all');if(all){all.parentNode.insertBefore(meta,all);}}\n"
        "    band.hidden=false;\n    if(window.gaEvent) gaEvent('wire_band_shown',{items:items.length,shown:Math.min(4,items.length)});", 'wire age')
    # The wire waits for the board so it can check it.
    t = once(t, "  fetch('/data/news.json',{cache:'no-store'}).then(function(r){",
        "  var _boardReady=new Promise(function(res){var n=0;(function w(){if(window.AGSIST_PRICE_DATA||n++>40)return res();setTimeout(w,150);})();});\n"
        "  _boardReady.then(function(){return fetch('/data/news.json',{cache:'no-store'});}).then(function(r){", 'wire waits for board')

    # Land band replaces the six-link "More on AGSIST" list, and moves up
    # under the bids/board/weather group.
    i = t.index('  <div class="fade-up" id="idx1-discovery">')
    j = t.index("  <style>@media(max-width:640px){.idx1-discovery-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important}}</style>\n")
    if t.count('  <div class="fade-up" id="idx1-discovery">') != 1: sys.exit('ANCHOR discovery')
    t = t[:i] + t[j + len("  <style>@media(max-width:640px){.idx1-discovery-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important}}</style>\n"):]
    t = once(t, '  <div class="signup--compact fade-up" id="signup-compact"', R5_LAND_HTML + '  <div class="signup--compact fade-up" id="signup-compact"', 'land band in')
    t = once(t, '  #idx1-discovery{order:140}\n', '', 'drop discovery order')
    # Quick Tools after the land band, so the land band follows the board.
    t = move_block(t, '    <details class="m-fold m-fold--tools" open>', '  </div>\n  <section class="fade-up idx1-land"',
                   '  <div class="signup--compact fade-up" id="signup-compact"', 'tools after land')

    # Ticker links: a stable accessible name instead of the moving price text.
    t = re.sub(r'<a class="t-item t-link" data-sym="([^"]+)" href="([^"]+)">',
               lambda m: '<a class="t-item t-link" data-sym="%s" href="%s" data-track="ticker" aria-label="%s">' % (m.group(1), m.group(2), {
                   '/corn-futures-prices':'Corn futures prices','/soybean-futures-prices':'Soybean futures prices',
                   '/wheat-futures-prices':'Wheat futures prices','/cattle-futures-prices':'Cattle futures prices'}[m.group(2)]), t)
    if t.count('data-track="ticker"') != 7: sys.exit('ticker labels: expected 7, got %d' % t.count('data-track="ticker"'))

    t = once(t, '</aside>', '</aside>\n' + R5_TIP_JS.strip('\n') + R5_ANALYTICS, 'tip+analytics js')
    t = once(t, '/components/bids-homepage.js?v=16', '/components/bids-homepage.js?v=17', 'v bids r5')
    return t

def patch_bids_r5(t):
    t = once(t, "    var html = '<div style=\"padding:.55rem 0;border-bottom:1px solid var(--border)\">';",
             "    var html = '<div class=\"bh-elev\" style=\"padding:.55rem 0;border-bottom:1px solid var(--border)\">';", 'elev class')
    return t

# ───────────────────────────────────────────── round 6: sponsor pill muted
R6_CSS = r"""
<style>
/* ===== 2026-10-01 round 6. Sig: "lets mute the sponsor this and not be in
   your face with it." The empty slot is a quiet ad-orange text link (paid
   space is always ad orange), no box, no pulse, no price; gone on a phone (the footer strip still sells the slot). A paid
   sponsor, when there is one, keeps its ad-orange label, smaller. ===== */
#daily-teaser-sponsor.empty-state{font-size:.75rem!important;font-weight:500!important;letter-spacing:0!important;text-transform:none!important;
  color:var(--ad-orange)!important;background:none!important;border:0!important;padding:0 4px!important;box-shadow:none!important}
#daily-teaser-sponsor.empty-state:hover{color:var(--ad-orange)!important;background:none!important;text-decoration:underline}
/* Sig's rule: anything that sells or shows paid space is ad orange, always.
   Light theme needs a darker orange to stay readable as text (4.5:1). */
html[data-theme="light"] #daily-teaser-sponsor{color:var(--ad-orange-ink)!important}
#daily-teaser-sponsor.empty-state .teaser-sponsor-dot,#daily-teaser-sponsor.empty-state .teaser-sponsor-tag{display:none!important}
#daily-teaser-sponsor.has-sponsor{font-size:.75rem!important;padding:2px 6px!important}
@media(max-width:640px){#daily-teaser-sponsor.empty-state{display:none!important}}
</style>
"""
def patch_index1_r6(t):
    t = once(t, '<span class="teaser-sponsor-dot"></span>Sponsor this &rarr;<span class="teaser-sponsor-tag">$100/wk</span></a>',
             '<span class="teaser-sponsor-dot"></span>Advertise here<span class="teaser-sponsor-tag">$100/wk</span></a>', 'sponsor text')
    t = once(t, '</head>', R6_CSS + '</head>', 'r6 css')
    return t

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', required=True)
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    if 'http-equiv="refresh"' in rd(a.src, 'index1.html'):
        sys.exit('index1.html is a stub: the homepage is index.html now. This script is a record of the cutover; write a new patch script for index.html.')
    wr(a.out, 'index1.html', patch_index1_r6(patch_index1_r5(patch_index1_r4(patch_index1_r3(patch_index1_r2(patch_index1(rd(a.src, 'index1.html'))))))))
    wr(a.out, 'components/bids-homepage.js', patch_bids_r5(patch_bids_r3(patch_bids_r2(patch_bids_homepage(rd(a.src, 'components/bids-homepage.js'))))))
    wr(a.out, 'components/homepage-extras.js', patch_extras_r3(patch_extras_r2(patch_extras(rd(a.src, 'components/homepage-extras.js')))))
    wr(a.out, 'components/bids-network.js', patch_net_r2(rd(a.src, 'components/bids-network.js')))
    wr(a.out, 'components/geo.js', patch_geo_r2(rd(a.src, 'components/geo.js')))
    print('ok')

if __name__ == '__main__':
    main()
