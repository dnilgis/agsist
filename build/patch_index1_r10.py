#!/usr/bin/env python3
"""index1 round 10: the panel round.

Sig, 2026-10-03: "too much deadspace in the elevator cash bids, and can you
please have a panel do the same type of audits to the rest of the page"

Run after build/patch_index1_ui_r8.py and build/patch_index1_copy_r9.py.

Six reviewers (copy editor, farmer on a phone, grain/insurance professional,
spacing designer, quantitative reviewer, accessibility and failure modes);
every claim of a wrong number or wrong mechanics then went to an adversary
told to refute it. Two died (the cattle "price since" line compares October
to October; the soybean-meal fund position is real CFTC data). What survived
and is fixed here:

  - Insurance: "RMA running average $5.02 ... 2 of 22 trading days done".
    RMA's posted figure covered Oct 1 only (5.0225); the 2-day average is
    4.9975. The label now says what RMA's figure is, and that it can trail.
  - Yield nowcast said "Above USDA" with both gaps inside its own 80% band.
  - Frost tile: the 5-day line tested <=32F while the flag beside it says
    "Frost possible" at <=36F, so a 34F night said both. One threshold.
  - USDA calendar: only the holiday's own rows were flagged; later reports
    that week (Oct 15 Export Sales) showed a firm time.
  - Harvest progress is national; it now says so.
  - Scorecard "Exact level right": the rule is "direction right AND closed
    at or through the level", so it is "Target reached", and the W-L line
    is that same count.
  - Cattle Read: three measures in one sentence; the feeder figure is its
    own sentence now.

Plus: dead space in the bids card, a few copy cuts, and the error paths that
showed "Updating..." forever, "Loading..." beside "unavailable", or a
"CACHED" tag on nothing.

Idempotent; verifies its own result.

    python3 build/patch_index1_r10.py
"""
import pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

EDITS = [
    # --- numbers and mechanics ------------------------------------------
    ("<small>RMA running average $'+pick.h_price.toFixed(2)+' vs projected '",
     "<small>RMA posted average $'+pick.h_price.toFixed(2)+' vs projected '"),
    ("legNote=rng+' average, '+(isTrading(today)?'trading day '+nth+' of '+tot:nth+' of '+tot+' trading days done')+'.';",
     "legNote=rng+' average, '+(isTrading(today)?'trading day '+nth+' of '+tot:nth+' of '+tot+' trading days done')+'. RMA\\u2019s posted average can trail the latest settle by a day.';"),
    ("var df=Math.round((c.nowcast-m.value)*10)/10;n++;if(df>0.4)ab++;else if(df<-0.4)bl++;",
     "var df=Math.round((c.nowcast-m.value)*10)/10,bd=(typeof c.band80==='number'&&c.band80>0)?c.band80:0.4;n++;if(df>bd)ab++;else if(df<-bd)bl++;"),
    ("for(var i=1;i<t.length;i++){if(v[i]!=null&&v[i]<=32){",
     "for(var i=1;i<t.length;i++){if(v[i]!=null&&v[i]<=36){"),
    ("esc(ff?'First frost night in the forecast: '+ff.day+' morning, '+ff.lo+'°F.':(ff===false?'No frost in the 5-day forecast.':''))",
     "esc(ff?'First frost risk in the forecast: '+ff.day+' morning, '+ff.lo+'°F ('+frostFlag(ff.lo).toLowerCase()+').':(ff===false?'No frost in the 5-day forecast.':''))"),
    ("weekly.forEach(function(r){if(r.wd!==wd)return;var at=etToUtc(y,mo,da,r.h,r.mi),hol=!!HOL[di];",
     "var mon=new Date(dd.getTime()-((wd+6)%7)*864e5),holWk=!!HOL[iso(mon.getUTCFullYear(),mon.getUTCMonth()+1,mon.getUTCDate())];\n      weekly.forEach(function(r){if(r.wd!==wd)return;var at=etToUtc(y,mo,da,r.h,r.mi),hol=!!HOL[di];"),
    ("time:hol?'Federal holiday · date may shift, check USDA':clock(r.h,r.mi)});",
     "time:hol?'Federal holiday · date may shift, check USDA':clock(r.h,r.mi)+(holWk?' · holiday week, may shift':'')});"),
    ("esc(hd?'Harvested. USDA Crop Progress, week ending '",
     "esc(hd?'US harvested. USDA Crop Progress, week ending '"),
    ("_fclause=' &mdash; feeders '+(_fp>=80?'near the top of':_fp<=20?'near the bottom of':'mid-range in')+' their 52-week range ('+_fp+'%).';",
     "_fclause='. Feeder futures sit at '+_fp+'% of their 52-week range.';"),
    ("_hl.innerHTML='Exact level right,<br>graded by rule';", "_hl.innerHTML='Target reached,<br>graded by rule';"),
    ("('Exact level right '+det.played+' of '+det.graded+' ('+det.hit_rate.toFixed(1)+'%).'):('Exact level right '+det.hit_rate.toFixed(1)+'% of the time.')",
     "('Target reached '+det.played+' of '+det.graded+' ('+det.hit_rate.toFixed(1)+'%).'):('Target reached '+det.hit_rate.toFixed(1)+'% of the time.')"),
    ('<span style="opacity:.75">W&ndash;L&ndash;Pending</span>',
     '<span style="opacity:.75">reached&ndash;missed&ndash;pending</span>'),
    # --- error paths -------------------------------------------------------
    ("if(verdict){verdict.className='cot-verdict mixed';verdict.textContent='Updating\\u2026';}",
     "if(verdict){verdict.className='cot-verdict mixed';verdict.textContent='Not loaded yet';}var _cw=document.getElementById('cot-widget');if(_cw)_cw.classList.add('cot-na');"),
    ("badge.textContent='Data unavailable';}});",
     "badge.textContent='Data unavailable';}var _tr=document.getElementById('tariff-rows');if(_tr)_tr.innerHTML='';});"),
    (".catch(function(){var d=document.getElementById('fert-date');if(d)d.textContent='Price data unavailable';});",
     ".catch(function(){var d=document.getElementById('fert-date');if(d)d.textContent='Price data unavailable';var g=document.getElementById('fert-grid');if(g)g.innerHTML='';});"),
    ("if($(pre+'-tag'))$(pre+'-tag').textContent='CACHED';}",
     "if($(pre+'-tag'))$(pre+'-tag').textContent='';}"),
    # --- copy ----------------------------------------------------------------
    ("<summary class=\"m-fold-sum\"><span>Radar, Forecast &amp; Drought</span></summary>",
     "<summary class=\"m-fold-sum\"><span>Radar &amp; Drought</span></summary>"),
    (">Radar, Forecast &amp; Drought</h2>", ">Radar &amp; Drought</h2>"),
    (' &middot; <span id="noaa-period-label">1-Month (30-Day)</span>',
     '<span id="noaa-period-label" hidden>1-Month (30-Day)</span>'),
    ('data-track="land">Every Daily briefing</a>', 'data-track="land">Daily archive</a>'),
    ('<h2 class="signup-headline">Start every day knowing <br>what moves your markets.</h2>',
     '<h2 class="signup-headline">Market news before the open.</h2>'),
    ('<span class="tool-widget-rec">Soil, 5-year crop history, satellite crop-vigor &amp; local cash bids for any field you draw</span>',
     '<span class="tool-widget-rec">Soil, 5-year crop history, satellite crop vigor and nearby cash bids.</span>'),
    ("tl.textContent='AGSIST trend, own '+(c.backtest_years||'')+'-year fit: '",
     "tl.textContent='Our '+(c.backtest_years||'')+'-year trend: '"),
    ("sub.textContent=shown.length===1?'1 thing the numbers said':shown.length+' things the numbers said';",
     "sub.textContent='latest '+shown.length;"),
    ("if(sub)sub.textContent=n===1?'1 thing the numbers said':n+' things the numbers said';}",
     "if(sub)sub.textContent='latest '+n;}"),
    # A held min-height left blank space under one or two elevators; hold it
    # only while the skeleton is showing.
    ("html.has-zip #bids-list-area{min-height:820px}", "html.has-zip #bids-list-area:has(.bids-skeleton){min-height:820px}"),
    ("html.has-zip #bids-list-area{min-height:760px}", "html.has-zip #bids-list-area:has(.bids-skeleton){min-height:760px}"),
    # The two price tables side by side only where both fit (1,036px of
    # content at 1240+); at 1100-1239 the 52-week ends ran out of their cells.
    ("@media(min-width:1100px){\n  .r7-ledgers{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));column-gap:32px;align-items:start}",
     "@media(min-width:1240px){\n  .r7-ledgers{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));column-gap:32px;align-items:start}"),
    # Four key contracts in one row only where four fit (151px each at 1024).
    ("@media(min-width:901px){\n  /* Four key contracts on one row, no empty fifth column. */",
     "@media(min-width:1240px){\n  /* Four key contracts on one row, no empty fifth column. */"),
    (".s7-month{grid-column:1/3;grid-row:1;align-self:start;margin-bottom:48px}",
     ".s7-month{grid-column:1/3;grid-row:1;align-self:start;margin-bottom:24px}"),
]

CSS = r"""<style id="r10">
/* Round 10 (2026-10-03): the bids card without the air. */
/* Crop and its basis contract on one line. */
#bids-list-area span[style="min-width:0"]>span{display:inline!important}
#bids-list-area span[style="min-width:0"]>.r7-ref:not(:empty)::before{content:"\00a0\00b7\00a0";color:var(--text-muted)}
#bids-list-area .r7-per{margin:.35rem 0 0!important}
#bids-list-area .r7-carry{margin-top:-.1rem}
#bids-list-area .bh-elev{position:relative;padding:.45rem 0!important}
/* "Watch this elevator" had its own 44px row under every elevator. */
@media(min-width:601px){
  #bids-list-area .bh-elev>div:first-child{padding-right:10rem}
  #bids-list-area .watch-elevator-wrap{position:absolute;top:.45rem;right:0;margin:0!important}
  #bids-list-area .watch-elevator-btn{min-height:32px!important}
}
@media(max-width:600px){
  #bids-list-area .watch-elevator-wrap{margin-top:0!important}
  #bids-list-area .watch-elevator-btn{min-height:36px!important}
}
/* The footnote stack under the elevators. */
#bids-list-area .r7-ref-note,#bids-list-area .bids-read-time{margin:.25rem 0 0!important;padding:0!important;line-height:1.45}
#bids-list-area a[href^="/cash-bids?zip="]{text-align:left!important;padding:.35rem 0 .1rem!important}
#f1 .r7-claim{display:inline-block!important;min-height:0!important;margin:.25rem 0 0!important;padding:.35rem 0!important;border:0!important}
#idx1-trust-ledger{margin-top:.25rem!important}
/* Store or sell: four inputs across on desktop instead of 3 + 1. */
@media(min-width:601px){
  .idx1-extras-row{display:grid!important;grid-template-columns:repeat(4,minmax(0,1fr));gap:.6rem}
  .idx1-extras-field input{width:100%!important;box-sizing:border-box}
  .idx1-extras-field{justify-content:flex-end}
}
/* With the card tighter, bids (1,177px at 1440) and weather (1,139px) are
   nearly level; the Wire under weather left 350px of nothing under bids.
   It runs full width beneath both now, two items side by side. */
@media(min-width:1240px){
  #f1{grid-row:2/3!important}
  #wire-band{grid-column:1/3!important;grid-row:3!important}
  #wire-g{grid-template-columns:repeat(2,minmax(0,1fr))!important;column-gap:24px}
}
/* Fund positioning with no data: no markers pinned at the left of a bar. */
.cot-na .cot-bar-wrap{visibility:hidden}
/* Quick Tools: plain links three across on wide screens. */
@media(min-width:1240px){
  .tool-list{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr));column-gap:24px}
  .tool-list>.tool-widget,.tool-list>.tool-widget--scout{grid-column:1/-1}
}
/* The NOAA source line ran into The Read heading. */
#f-noaa,.m-fold--noaa{margin-bottom:24px}
/* Section headers read as content (Sig: "cash bids & basis ... blends in
   with the content, it should jump out as a header"). Headers take the
   accent: gold text and icon on dark (#d4a23f, 8:1 on the page), #86600f on
   light (4.96:1; the light brand gold #a87d1e is 3.5:1 as text). The phone
   fold titles are the same headers, so they match. */
.sec-title,.m-fold>summary.m-fold-sum>span,.wr-k{color:var(--gold)!important}
[data-theme="light"] .sec-title,[data-theme="light"] .m-fold>summary.m-fold-sum>span,[data-theme="light"] .wr-k{color:#86600f!important}
.sec-title>span,.m-fold>summary.m-fold-sum small{color:var(--text-muted)!important}
/* The store-or-sell fold sits inside the bids card; it is not a section. */
.m-fold--calc>summary.m-fold-sum>span{color:var(--text-dim)!important}
/* Price cards. The price is a flex item with min-width:0, so at 1024-1280
   it shrank below its own digits and the fraction ran under "per bu"
   ("$12.77 1/4per bu", the 1/4 struck through). The price keeps its width
   and the unit wraps; under 1240 the cards are two across, not four at
   151px each. */
.r7-pl{flex-wrap:wrap;row-gap:0}
.r7-pl .pc-price{flex:none!important}
@media(min-width:601px) and (max-width:1239px){.price-cards-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important}}
/* Four across at 1240-1599 is 222-300px a card: "per bu" wrapped on three
   cards and not the fourth. It sits on its own line on all four there. */
@media(min-width:1240px) and (max-width:1599px){.price-cards-grid .r7-pl .r7-unit{flex-basis:100%}}
/* At 901-1000 the price-table rows are narrowest; the 52-week high ran
   14px out of its cell at 901. Up to 960 they stack, as on a phone. */
@media(min-width:901px) and (max-width:1000px){#f-prices .r7-led .pc.r7-row{column-gap:8px!important}}
@media(min-width:901px) and (max-width:960px){
  #f-prices .r7-lh{display:none!important}
  #f-prices .r7-led .pc.r7-row{grid-template-columns:minmax(0,1fr) auto auto!important;grid-template-areas:"nm last last" "rg ch pc";row-gap:6px}
  #f-prices .r7-nm{grid-area:nm}#f-prices .r7-last{grid-area:last}#f-prices .r7-ch{grid-area:ch}#f-prices .r7-pc{grid-area:pc}#f-prices .r7-rg{grid-area:rg}
}
/* "+4 basis points" ran past its column at 768-1280. */
#f-prices .r7-chg{white-space:normal;overflow-wrap:anywhere}
/* A tip longer than the screen scrolls inside itself. */
.tip-t{max-height:min(60vh,420px);overflow:auto}
/* Spray windows were stretched across 1,000px. */
.spray-days{max-width:640px}
</style>
"""


def once(s, old, new, where):
    n = s.count(old)
    if n != 1:
        sys.exit(f"{where}: anchor found {n} times, expected 1: {old[:80]!r}")
    return s.replace(old, new)


def main():
    p = ROOT / "index1.html"
    s = p.read_text(encoding="utf-8")
    for old, new in EDITS:
        if old in new and new in s:      # an insert in front of its own anchor, already applied
            continue
        if old not in s:
            if new not in s:
                sys.exit(f"index1.html: neither old nor new text found: {old[:80]!r}")
            continue
        s = once(s, old, new, "index1.html")
    # Text links: an arrow on every one meant nothing. Buttons and the
    # Quick Tools row arrows (.tool-arr) keep theirs. FAQ schema has none.
    s = re.sub(r' &rarr;</a>', '</a>', s)
    s = re.sub(r' &rarr;</div></a>', '</div></a>', s)
    s = re.sub(r'<style id="r10">.*?</style>\n', "", s, flags=re.S)
    s = once(s, "</head>", CSS + "</head>", "index1.html")
    p.write_text(s, encoding="utf-8")
    left = [o for o, n in EDITS if o in s and not (o in n and n in s)]
    if left:
        sys.exit("not applied: %r" % [x[:60] for x in left])
    print("index1.html patched: r10")


if __name__ == "__main__":
    main()
