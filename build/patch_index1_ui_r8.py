#!/usr/bin/env python3
"""index1.html UI round 8: legibility, one type scale, fewer boxes.

Sig, 2026-10-02: "i thin index1 still needs ui work ... visuals, elements,
contrast, colors, etc".

Measured on the page before this (rendered, both themes, 390 and 1440):
30 distinct font sizes, all of the strays from shared components (the bids
card in components/bids-homepage.js, the spray strip, the 7-day cells, a
7.7px ticker fraction); form-field borders at 1.2-1.3:1; range tracks at
1.0-1.5:1; four places where text is cut off; one text contrast failure
(menu labels in light, 4.06:1).

Everything here is scoped to index1.html. The shared files
(components/styles.css, components/bids-homepage.js) are not touched, so
index.html and cash-bids.html do not change.

Idempotent: every edit asserts its anchor matches exactly once, and the
style block is replaced, not stacked, on a re-run.

    python3 build/patch_index1_ui_r8.py            # patches index1.html in place
"""
import pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
PAGE = ROOT / "index1.html"

CSS = r"""<style id="ui-r8">
/* UI round 8 (2026-10-03). Scoped to this page; see build/patch_index1_ui_r8.py. */

/* Tokens. Light-theme muted text was rgba(22,26,24,.66): 4.06:1 on the menu
   panel. .74 clears 4.5:1 on every light surface. Field borders and range
   tracks get their own tokens so they reach 3:1 (WCAG 1.4.11). */
:root{--ui-field:rgba(132,160,168,.6);--ui-track:rgba(132,160,168,.5)}
[data-theme="light"]{--text-muted:rgba(22,26,24,.74);--ui-field:rgba(20,30,28,.5);--ui-track:rgba(20,30,28,.42)}
/* Light gold #a87d1e is 3.5:1 as text; #86600f (already used on the
   briefing link) is 4.96:1. Text only; fills keep the brand gold. */
[data-theme="light"] #bids-cta-link,[data-theme="light"] .daily-eyebrow{color:#86600f!important}

/* Form fields: visible edges, and a real focus ring on the two ZIP boxes
   (their inline outline:none beat the page's :focus-visible). */
.idx1-shell input:not([type=checkbox]):not([type=radio]):not([type=range]),.idx1-shell select{border-color:var(--ui-field)!important}
#bids-zip:focus,#wx-zip:focus{outline:2px solid var(--gold)!important;outline-offset:2px}

/* Range tracks. The price-card track keeps its red-gold-green gradient
   (Sig, 2026-10-03: "i like the color gradient for 52wk range bar, my
   personal preference"); the label sits on its own line instead of an
   ellipsis. */
.idx1-shell .pc-range-labels{display:grid!important;grid-template-columns:auto 1fr auto;row-gap:2px}
.idx1-shell .pc-range-labels>span:nth-child(2){grid-row:1;grid-column:1/-1;text-align:left!important;overflow:visible!important;text-overflow:clip!important;white-space:normal!important}
.idx1-shell .pc-range-labels>span:first-child{grid-row:2;grid-column:1}
.idx1-shell .pc-range-labels>span:last-child{grid-row:2;grid-column:3;text-align:right}
.cot-bar-wrap{box-shadow:inset 0 0 0 1px var(--ui-track)}
.crop-plant-bar{box-shadow:inset 0 0 0 1px var(--ui-track)}
.crop-plant-fill{opacity:1}
#f-prices .r7-bar{background:var(--ui-track)}

/* The bids card was the one large box on a hairline page. */
#f1>.card{border:0!important;border-top:1px solid var(--border-2)!important;border-radius:0!important;background:transparent!important;box-shadow:none!important}
#f1>.card>.card-body{padding-left:0!important;padding-right:0!important}

/* One type scale (12/14/17/22). The bids card is built by a shared script
   with its own sizes (12.75, 14.45, 16.15, 17.85px); snap them here. */
#bids-list-area [style*="font-size:.75rem"]{font-size:.706rem!important}
#bids-list-area [style*="font-size:.82rem"],#bids-list-area [style*="font-size:.85rem"]{font-size:.824rem!important}
#bids-list-area [style*="font-size:.95rem"],#bids-list-area [style*="font-size:1.05rem"]{font-size:1rem!important}
#bids-list-area .r7-per{font-size:.706rem!important}
.spray-day-name,.spray-day-reason,.spray-day-status{font-size:.706rem!important}
.wx-7day-name{font-size:.824rem!important}
.t-item .r7-frac{font-size:.706rem!important}
.idx1-zone-label small{font-size:.706rem!important}
#bids-list-area a[style*="font-size:.76rem"]{font-size:.824rem!important}
[data-theme="light"] #bids-list-area a[style*="color:var(--gold)"]{color:#86600f!important}
#s7-usdm-valid,summary small{font-size:.706rem!important}
.footer-adspace .adspace-lbl,.ad-slot-tag{font-size:.706rem!important}
.footer-adspace .adspace-sub,.ad-slot-cta{font-size:.824rem!important}

/* Mono for numbers, not for sentences. */
.bids-read-time,.r7-cov,#idx1-trust-ledger,.s7-line small{font-family:var(--font-body,'Inter',system-ui,sans-serif)!important}

/* Section labels: tracking .14em to .08em. Same words, less shouting. */
.sec-title,.daily-eyebrow{letter-spacing:.08em!important}

/* Header: the briefing eyebrow was a bordered chip that looked like a
   button and did nothing. The empty "Become a sponsor" row was a strip of
   its own; the same offer sits in the briefing header. A sold slot is not
   empty-state and still shows. */
.daily-eyebrow,.teaser-badge{border:0!important;padding:0!important;background:none!important}
.teaser-line1{flex-wrap:wrap;row-gap:.2rem}
.teaser-badge{white-space:nowrap}
.teaser-left{flex:0 1 auto!important;overflow:visible!important}
.s7-adrow:has(>#daily-teaser-sponsor.empty-state){display:none}

/* Cut-off text. */
.bidnet-txt{white-space:normal!important;overflow:visible!important;text-overflow:clip!important}
@media(max-width:600px){
  #daily-teaser-text{white-space:normal!important;overflow:hidden!important;text-overflow:clip!important;display:-webkit-box!important;-webkit-line-clamp:3;-webkit-box-orient:vertical}
  /* Phone: the ZIP bar repeated the bids card's own "Change ZIP" and ran
     off the screen at "Funds and yield". Its two jump links go to sections
     that are folded on a phone, so the bar goes with them. */
  .idx1-subbar{display:none!important}
  /* USDA report cards scrolled sideways with no hint, cut at "Expor". */
  #usda-cal-strip{display:grid!important;grid-template-columns:1fr 1fr;overflow:visible!important}
  #usda-cal-strip .cal-card{min-width:0!important}
}

/* Tabs: one style. NOAA's boxed tabs now match the underline tabs above. */
.noaa-tab{border:0!important;border-bottom:2px solid transparent!important;border-radius:0!important;background:none!important;padding:.4rem .1rem!important;margin-right:1rem}
.noaa-tab.active{border-bottom-color:var(--text)!important}

/* Folds: one open/close mark, the same "+" and minus the phone folds use. */
details.wr>summary::after,details.hbz>summary::after{content:'+'!important;font-size:1rem!important;font-family:inherit!important}
details.wr[open]>summary::after,details.hbz[open]>summary::after{content:'\2212'!important}
details.wr>summary,details.hbz>summary{align-items:center!important}

/* The newsletter headline was the only all-caps headline on the page. */
.signup-headline{text-transform:none!important;letter-spacing:-.01em!important}
.signup-eyebrow{letter-spacing:.08em!important}
/* The Privacy link was a 44px flex box inside a sentence, which doubled the
   line height. A link inside a sentence is exempt from the target-size
   minimum (WCAG 2.5.8), so it is a plain inline link again. */
#signup-full .signup-disc a{display:inline!important;min-height:0!important;padding:0!important}

/* Quick tools: one row pattern; the gold left bar marked nothing. */
.tool-widget--scout{border-left:0!important;padding-left:0!important}

/* Fertilizer rises used #ef4444, off the palette. */
.fert-chg-val.up{color:var(--red)!important}
</style>
"""

EDITS = [
    # The October grid label wrapped to two lines next to one-line labels.
    ("report:'Next major USDA report',", "report:'Next USDA report',"),
]


def once(s, old, new):
    n = s.count(old)
    if n != 1:
        sys.exit(f"anchor found {n} times, expected 1: {old[:70]!r}")
    return s.replace(old, new)


def main():
    s = PAGE.read_text(encoding="utf-8")
    s = re.sub(r'<style id="ui-r8">.*?</style>\n', "", s, flags=re.S)
    for old, new in EDITS:
        if new in s and old not in s:
            continue
        s = once(s, old, new)
    s = once(s, "</head>", CSS + "</head>")
    PAGE.write_text(s, encoding="utf-8")
    print("index1.html patched: ui-r8")


if __name__ == "__main__":
    main()
