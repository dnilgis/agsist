#!/usr/bin/env python3
"""index1 round 9: say it once, in fewer words.

Sig, 2026-10-03: "i still feeel like the new indes is a bit wordy or redundant
in somme places, to much ai feel for my ttast. the find elevators link above
the elevators card caould easly be fodled into a different aread or removed
entirely, less ai more real and concise"

Run after build/patch_index1_ui_r8.py. Measured on the rendered page before
this round (1440, ZIP 54728):
  - insurance harvest price shown 4 times (October grid, Quick Tools row,
    Harvest 2026 band, RMA price discovery section)
  - the fall-nitrogen paragraph printed word for word twice
  - "free" 6 times; three headings stacked over the bids card
  - "Find Elevators" above the card and "View All" below it, same page

Edits text only. No number, date or source attribution is removed: where a
sentence carried one, the shorter sentence carries the same one. Sections
that only repeated another section are hidden with CSS, not deleted, so the
data scripts that fill them still find them.

Also edits two shared scripts (text only):
  components/bids-homepage.js  - used by index.html, index1.html, cash-bids.html
  components/homepage-extras.js - used by index.html, index1.html
so those wordings change on those pages too.

    python3 build/patch_index1_copy_r9.py
"""
import pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent


def once(s, old, new, where):
    n = s.count(old)
    if n != 1:
        sys.exit(f"{where}: anchor found {n} times, expected 1: {old[:80]!r}")
    return s.replace(old, new)


def apply(path, edits):
    p = ROOT / path
    s = p.read_text(encoding="utf-8")
    for old, new in edits:
        # Applied already: the old text is gone. Anything else must match once.
        # (The Yield Estimator insert keeps its anchor, so it is keyed on its
        # own new link instead.)
        if 'href="/yield-estimator" class="tool-btn"' in new and 'href="/yield-estimator" class="tool-btn"' in s:
            continue
        if old not in s:
            if new and new not in s:
                sys.exit(f"{path}: neither old nor new text found: {old[:80]!r}")
            continue
        s = once(s, old, new, path)
    return p, s


PAGE_EDITS = [
    # Three headings over the bids card become one.
    ('<div class="idx1-zone-label idx1-zone-live" style="order:-1">Live Now <small>&mdash; your location, your bids</small></div>', ''),
    # A tagline, not a control. The Worth the Drive ranking lives on /cash-bids.
    (' <span style="font-size:.706rem;font-weight:600;color:var(--gold);letter-spacing:.04em">+ Worth the Drive&trade;</span>', ''),
    # "View All" at the foot of the card goes to the same page.
    ('<a href="/cash-bids" class="sec-all">Find Elevators &rarr;</a>', ''),
    # Explained a calculator that sits directly below it.
    ('<div class="idx1-bids-hint" style="font-size:.706rem;color:var(--text-muted);margin-bottom:.55rem">Look up your bid below to unlock a store-or-sell calculator and that elevator’s basis history.</div>', ''),
    ('Posted price, not a contract. Freight, moisture and grade discounts are the elevator&rsquo;s; call before you haul.',
     'Posted prices, not contracts. Freight, moisture and grade discounts are the elevator&rsquo;s; call before you haul.'),
    ('See a wrong number? Tell us', 'Wrong number? Tell us'),
    ('Store, or sell at this price now?', 'Store or sell?'),
    ('Your own bin or storage numbers. Cash price fills from your bid; change it to match your haul.',
     'Cash price fills from your bid. Change any number to match your bin.'),
    ('Run an elevator? Claim your board, free.', 'Run an elevator? Claim your board.'),
    ('<span class="signup-eyebrow">AGSIST Daily &mdash; Free Delivery Every Weekday</span>',
     '<span class="signup-eyebrow">AGSIST Daily</span>'),
    ('Get the AGSIST Daily briefing before the market open &mdash; overnight markets, what to watch, one number to know, and farm weather &mdash; for farmers across the US.',
     'Every weekday before the open: overnight markets, what to watch, and farm weather.'),
    ('Available at no charge. Unsubscribe any time. We never sell your data.',
     'Free. Unsubscribe any time. We never sell your data.'),
    ('Corn printed above the entire pre-report trade range (1.843&ndash;2.005 billion bu). Soybeans printed inside the survey range but below average. Full grading, every number, and sourcing: ',
     'Corn printed above the whole trade range (1.843&ndash;2.005 billion bu). Soybeans printed inside it, below average. '),
    ('One email the first time the price we check every 30 minutes (delayed about 15 minutes) is at or past your target. Then it clears. ',
     'One email when the futures price reaches your target, then it clears. Checked every 30 minutes, delayed about 15. '),
    ('Price Alert &mdash; free</h2>', 'Price Alert</h2>'),
    ('cursor:pointer">Set alert &mdash; free</button>', 'cursor:pointer">Set alert</button>'),
    ('<span id="s7-usdm-valid"></span>tap to view</small>', '<span id="s7-usdm-valid"></span></small>'),
    ("dv.textContent=(u&&u.data_valid)?'valid '+isoDay(u.data_valid)+' · ':'';",
     "dv.textContent=(u&&u.data_valid)?'valid '+isoDay(u.data_valid):'';"),
    # The COT header already links the full chart.
    ('<a href="/cot" class="cot-full-link">Full Chart &rarr;</a>', ''),
    # "Farmland Atlas" was the header link and the first cell's title.
    ('<a href="/farmland-atlas" class="sec-all" data-track="land">Farmland Atlas &rarr;</a>', ''),
    # The yield estimator was only reachable from the Harvest 2026 band,
    # which is hidden below because its other four links repeat Quick Tools.
    ('<a href="/breakeven" class="tool-btn">',
     '<a href="/yield-estimator" class="tool-btn"><span class="tool-name"><svg class="ic" aria-hidden="true"><use href="#i-ruler"/></svg> Yield Estimator</span><span class="tool-arr">&rarr;</span></a>\n          <a href="/breakeven" class="tool-btn">'),
    # Generated sentences (JS), same facts.
    ("' University extension guidance: wait until soil at 4 in stays below 50°F. Not advised on sandy or poorly drained soils.'",
     "' Extension guidance: wait for 4 in soil to stay below 50°F; not on sandy or poorly drained soils.'"),
    ("'Elevator network: ' + k.read.toLocaleString('en-US') + ' boards read directly, of ' + k.elevators.toLocaleString('en-US') + ' elevators known' + w",
     "k.read.toLocaleString('en-US') + ' elevator boards read directly, of ' + k.elevators.toLocaleString('en-US') + ' known' + w"),
    ("'Second bid feed: '", "'Second feed: '"),
    ("' above projected. With Revenue Protection, the guarantee rises with the harvest price.'",
     "' above projected, so the Revenue Protection guarantee rises with the harvest price.'"),
    ("'A claim needs yield × harvest price below the guarantee.'",
     "'A claim pays when yield × harvest price falls below it.'"),
    ("legNote='Harvest price: '+rng+' average, trading day '+(isTrading(today)?nth:nth+' done')+' of '+tot+'.';",
     "legNote=rng+' average, '+(isTrading(today)?'trading day '+nth+' of '+tot:nth+' of '+tot+' trading days done')+'.';"),
]

SHARED_EDITS = {
    "components/bids-homepage.js": [
        ("'</span> (this elevator\\u2019s board)</span>';", "'</span></span>';"),
        # Without the tag, "board carry" reads like a futures spread. Say whose.
        ("color:var(--text-muted)\">Board carry ' + escHtml(bc.from)", "color:var(--text-muted)\">Elevator carry ' + escHtml(bc.from)"),
        ("cursor:pointer;min-height:44px\">Watch this elevator — free</button>'",
         "cursor:pointer;min-height:44px\">Watch this elevator</button>'"),
        ("note.textContent = 'A basis month is shown only where the board\\u2019s cash minus its basis is nearest that futures contract on this page, within 8\\u00a2.'\n          + (ft ? ' Futures on this page: ' + fut + ' at ' + ft + (bt ? '; the boards were read ' + bt + ', so cash minus basis will not equal those prices exactly.' : '.') : '');",
         "note.textContent = 'Basis month shown where cash minus basis lands within 8\\u00a2 of that contract.'\n          + (ft ? ' Futures ' + fut + ' at ' + ft + (bt ? ', read at a different time than the boards, so the two will not match exactly.' : '.') : '');"),
    ],
    "components/homepage-extras.js": [
        ("note.textContent = 'Carry from the board at ' + String(sum.where || 'this elevator') + ' (the bid filled above): '",
         "note.textContent = String(sum.where || 'This elevator') + ' board (the bid filled above): '"),
        ("', +' + qc(bc.cents) + ' per bu' + (bc.months != null ? ', covering ' + bc.months",
         "', +' + qc(bc.cents) + ' per bu' + (bc.months != null ? ' over ' + bc.months"),
    ],
}

CSS = r"""<style id="copy-r9">
/* Round 9 (2026-10-03): sections that only repeated another one. Hidden,
   not deleted, so the scripts that fill them still find them. */
#s7-month-k{display:none!important}          /* "Changes with the month" */
#harvest-band{display:none!important}        /* 4 of 5 links repeat Quick Tools; the 5th moved there */
#pdw{display:none!important}                 /* 4th insurance harvest price on the page; October grid links the tracker */
#s7-hp-link{display:none!important}          /* Quick Tools insurance row, same */
#s7-falln-rec{display:none!important}        /* fall-N paragraph, printed in full in the October grid */
#wsp-spray-detail{display:none!important}    /* "Today: wind up to..." also in Local conditions */
#rsc-sample{display:none!important}          /* "87 calls graded": the headline is "41 of 87" */
#f1>.bidnet-note,.bidnet-note{display:none!important}         /* "NEW" strip from Sep 5; the network line and claim link stay */
#bids-list-area div:has(>#bids-cta-link){display:none!important} /* newsletter ask inside the bids card; the signup block is on the page */
</style>
"""


def main():
    p, s = apply("index1.html", PAGE_EDITS)
    # The two error paths reset the button with the same statement.
    pair = "go.textContent='Set alert — free';"
    n = s.count(pair)
    if n not in (0, 2):
        sys.exit(f"index1.html: {n} button resets found, expected 2")
    s = s.replace(pair, "go.textContent='Set alert';")
    s = re.sub(r'<style id="copy-r9">.*?</style>\n', "", s, flags=re.S)
    s = once(s, "</head>", CSS + "</head>", "index1.html")
    p.write_text(s, encoding="utf-8")
    for path, edits in SHARED_EDITS.items():
        q, t = apply(path, edits)
        q.write_text(t, encoding="utf-8")
    # A replacement that is short enough to exist elsewhere in a file can
    # make a missed anchor look applied. Check the result, not the run.
    page = p.read_text(encoding="utf-8")
    left = [o for o, n in PAGE_EDITS if "yield-estimator" not in n and o in page]
    left += [o for path, eds in SHARED_EDITS.items() for o, n in eds if o in (ROOT / path).read_text(encoding="utf-8")]
    if left or page.count('href="/yield-estimator" class="tool-btn"') != 1:
        sys.exit("not applied: %r" % [x[:60] for x in left])
    print("index1.html, components/bids-homepage.js, components/homepage-extras.js patched: copy-r9")


if __name__ == "__main__":
    main()
