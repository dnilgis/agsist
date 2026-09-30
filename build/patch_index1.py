#!/usr/bin/env python3
"""
patch_index1.py — builds index1.html from the pristine clone.

This is a REAL two-column page-shell rebuild, not the earlier "Option-B
zoning" CSS-order hack (which only reordered sections in place and grafted
one two-column row into a single section). It:

  1. Adds a secondary bar under the real global header — a ZIP quick-access
     chip that jumps to the real Cash Bids ZIP field already on the page.
     Deliberately does NOT add "last 18h" delta chips: no real feed backs
     fabricated deltas like the mockup's example chips, and this project's
     own honest-numbers rule says drop a chip rather than invent one.
  2. Removes the CSS `order:` hack entirely.
  3. Wraps the main column's real content in `.idx1-content` and adds a
     real `<aside class="intel-rail">` as a DOM sibling that runs the full
     height of the page (not just one row): moves the already-real,
     already-wired COT 2x2 grid + AGSIST Yield Nowcast (#f-cot-intel) and
     the Grain Stocks/WASDE card (#f5) into it, verbatim — same ids, same
     script hooks, only their position in the DOM changes.
  4. `.idx1-shell{display:grid;grid-template-columns:minmax(0,1fr) 340px}`
     is the real shell; collapses to one column under 900px, matching the
     mockup's own breakpoint. DOM order is unchanged (aside after content),
     so mobile naturally keeps the bid list / weather / prices first and
     the rail below — the same call the mockup's own comment makes for why
     it reverted rail-first on mobile.

Idempotent: always runs against the PRISTINE clone of index1.html (passed
as --src, default ../index1.html read from the original repo checkout via
git if available, else this expects a .orig backup). Each anchor string is
asserted to appear exactly once before any edit is made.
"""
import argparse
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent


def must_count(haystack: str, needle: str, expected: int, label: str):
    n = haystack.count(needle)
    if n != expected:
        raise SystemExit(
            f"anchor check failed for {label!r}: expected {expected} occurrence(s), found {n}\n"
            f"needle: {needle[:120]!r}"
        )


def find_matching_div_close(s: str, start_idx: int) -> int:
    """Given an index right after an opening <div ...> tag's '>', return the
    index right after the matching closing </div> tag, counting nested divs."""
    depth = 1
    tag_re = re.compile(r"<(/?)div\b[^>]*>")
    for m in tag_re.finditer(s, start_idx):
        if m.group(1) == "":
            depth += 1
        else:
            depth -= 1
        if depth == 0:
            return m.end()
    raise SystemExit("could not find matching </div> — anchor drift, re-check the source")


def extract_div_block(s: str, open_tag: str) -> tuple[str, int, int]:
    """Return (full_block_text, start_index, end_index) for a <div ...>...</div>
    block whose exact opening tag string is `open_tag` (must be unique)."""
    must_count(s, open_tag, 1, open_tag)
    start = s.index(open_tag)
    content_start = start + len(open_tag)
    end = find_matching_div_close(s, content_start)
    return s[start:end], start, end


SECONDARY_BAR_ANCHOR = '<div class="prices-strip"'

SECONDARY_BAR_CSS = """
/* ===== 2026-09-30: secondary bar under the real global header -- ZIP
   quick-access chip, ported from the Design canvas mockup's top-bar
   concept. Deliberately does NOT carry the mockup's "last 18h" example
   delta chips (up 6 cents / funds flipped short beans / frost advisory):
   no real feed on this page computes an 18-hour delta for those three
   things in one place, and honest-numbers says drop a chip rather than
   invent one. The ZIP chip is real: it focuses the actual bids-zip input
   already wired to live data below, it does not display or imply any
   number of its own.
   FIX 2026-09-30, round one: this block was first wrapped in its own
   nested style element, spliced in front of this page's already-open
   style element's own closing tag. Browsers do not parse nested style
   elements -- the HTML tokenizer stays in raw-text mode from the real
   opening tag and scans for the next literal closing-tag string, so that
   inner opening tag just became plain text inside the stylesheet, sitting
   in front of the idx1-subbar selector with no semicolon or brace between
   them; the CSS parser folded both into one invalid prelude and silently
   dropped that rule. Fixed by removing the inner tag pair.
   FIX 2026-09-30, round two: the fix above then repeated the same mistake
   one level up, inside this very comment, by spelling out that literal
   closing-tag text three times in prose. The HTML tokenizer has no idea
   CSS comments exist; once it is scanning raw text after a real style
   opening tag it ends that element at the first occurrence of that exact
   literal string it meets anywhere, even inside a slash-star comment.
   That first occurrence sat in this paragraph, truncating the whole style
   element right there and dumping every rule written after it back out as
   unstyled tag soup -- including idx1-subbar itself, again, silently,
   with no console error either time. Caught only by asking the real
   browser for its parsed stylesheet rules and finding none. Fixed by
   describing the tag in words from here on rather than ever spelling out
   that literal bracketed sequence inside a style element again. ===== */
.idx1-subbar{width:100%;box-sizing:border-box;padding:.5rem 1rem;background:var(--surface);border-bottom:1px solid var(--border);display:flex;align-items:center;gap:.6rem;flex-wrap:wrap}
.idx1-zip-chip{display:inline-flex;align-items:center;gap:.4rem;padding:.3rem .7rem;background:var(--surface2,rgba(255,255,255,.03));border:1px solid var(--border-2,var(--border));border-radius:20px;font-family:'JetBrains Mono',monospace;font-size:.72rem;color:var(--text-muted);cursor:pointer;min-height:30px}
.idx1-zip-chip:hover{border-color:var(--blue)}
.idx1-zip-chip .idx1-zip-label{color:var(--text-muted)}
.idx1-zip-chip .idx1-zip-val{color:var(--text);font-weight:600}
.idx1-zip-chip .idx1-zip-change{color:var(--blue);margin-left:.2rem}
@media(max-width:640px){.idx1-subbar{padding:.4rem .75rem}}
"""

SECONDARY_BAR_HTML = """
<div class="idx1-subbar">
  <button type="button" id="idx1-zip-chip" class="idx1-zip-chip" aria-label="Jump to Cash Bids ZIP lookup">
    <span class="idx1-zip-label">ZIP</span>
    <span class="idx1-zip-val" id="idx1-zip-val">Not set</span>
    <span class="idx1-zip-change">Set / change &rarr;</span>
  </button>
</div>
<script>
/* Real behavior, no fabricated data: reads the same ZIP the Cash Bids
   widget already stores (bids-homepage.js's own localStorage key, if any)
   only to DISPLAY it here; clicking always scrolls to and focuses the
   real #bids-zip field rather than opening a second, parallel ZIP flow. */
(function(){
  function paint(){
    var out = document.getElementById('idx1-zip-val');
    if(!out) return;
    var z = '';
    try { z = localStorage.getItem('agsist_zip') || localStorage.getItem('bids_zip') || ''; } catch(e){}
    out.textContent = z ? z : 'Not set';
  }
  var chip = document.getElementById('idx1-zip-chip');
  if(chip){
    chip.addEventListener('click', function(){
      var field = document.getElementById('bids-zip');
      var target = field || document.getElementById('dash-grid');
      if(target && target.scrollIntoView){ target.scrollIntoView({behavior:'smooth', block:'center'}); }
      if(field && field.focus){ setTimeout(function(){ field.focus(); }, 350); }
    });
  }
  paint();
  window.addEventListener('storage', paint);
})();
</script>
"""

ORDER_HACK_ANCHOR_START = (
    "/* ===== index1 preview: Option-B zoning. CSS reorders the real top-level\n"
    "   sections via `order`; the one physical move (COT+Nowcast out of #f-prices\n"
    "   into #f-cot-intel, done in this file's build step, not by hand) keeps every\n"
    "   widget's ids and scripts untouched -- getElementById does not care where in\n"
    "   the DOM a node sits. */\n"
    "main#main{display:flex;flex-direction:column}\n"
    "#dash-grid{order:-3}\n"
    "#f-radar{order:-2}\n"
    "#f-prices{order:-1}\n"
    "#f-cot-intel{order:0}\n"
    "#f5{order:1}\n"
    "#f-noaa{order:2}\n"
    "#wire-band{order:3}\n"
    "#harvest-band{order:4}\n"
    "#pdw{order:5}\n"
)

GRID_SHELL_CSS = """/* ===== 2026-09-30: real two-column page shell, replacing the Option-B
   `order:` hack above. .idx1-shell is a sibling wrapper inside <main>
   holding .idx1-content (everything that used to be main's direct
   children, now in real DOM order — no more CSS reordering) and a real
   <aside class="intel-rail"> that runs the FULL height of the page next
   to it, not just one grafted row. minmax(0,1fr) on the content track,
   same reasoning as the old .idx1-intel-row fix this replaces: a bare 1fr
   track's implicit minimum is its content's max-content width, which is
   how the 390px scrollWidth bug happened before. Collapses to one column
   under 900px; DOM order (content, then aside) is unchanged at that
   breakpoint, so a first-time mobile visitor still hits price/weather
   content before the rail — same call the mockup's own comment makes for
   reverting rail-first-on-mobile. ===== */
.idx1-shell{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:1.1rem;align-items:start}
.idx1-content{min-width:0;display:flex;flex-direction:column}
.intel-rail{display:flex;flex-direction:column;gap:1.1rem;min-width:0}
@media(max-width:900px){.idx1-shell{grid-template-columns:minmax(0,1fr)}}
/* Inside the 340px rail, COT + Nowcast stack (they sat side-by-side only
   when the row was 2x as wide as it is now as a standalone rail column). */
.intel-rail .ratio-cot-grid{grid-template-columns:1fr}
.intel-rail #f-cot-intel .sec-head,.intel-rail #f5 .sec-head{margin-bottom:.35rem}
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=str(REPO.parent / "pristine" / "index1.html"),
                     help="pristine index1.html to build FROM")
    ap.add_argument("--out", default=str(REPO / "index1.html"),
                     help="where to write the patched index1.html")
    args = ap.parse_args()

    src_path = Path(args.src)
    data = src_path.read_text(encoding="utf-8")
    original_len = len(data)

    # ---- 1. secondary ZIP bar: insert CSS in <head> area and HTML+script
    # right after the real global header, before the prices ticker. ----
    must_count(data, SECONDARY_BAR_ANCHOR, 1, "prices-strip anchor")
    must_count(data, "</style>\n<meta name=\"robots\"", 1, "head style close anchor")
    data = data.replace(
        "</style>\n<meta name=\"robots\"",
        SECONDARY_BAR_CSS.strip() + "\n</style>\n<meta name=\"robots\"",
        1,
    )
    data = data.replace(SECONDARY_BAR_ANCHOR, SECONDARY_BAR_HTML.strip() + "\n" + SECONDARY_BAR_ANCHOR, 1)

    # ---- 2. remove the order: hack, install the real grid-shell CSS ----
    must_count(data, ORDER_HACK_ANCHOR_START, 1, "order-hack CSS block")
    data = data.replace(ORDER_HACK_ANCHOR_START, GRID_SHELL_CSS, 1)

    # dead CSS cleanup: .idx1-zone-intel and .idx1-intel-row no longer have
    # any element using them once the row-hack is removed (the rail gets
    # its own .idx1-rail-heading instead of the old zone-label variant).
    dead_css_block = (
        '.idx1-zone-label.idx1-zone-intel{border-top-color:var(--blue);color:var(--blue)}\n'
        '.idx1-zone-label.idx1-zone-intel::before{background:var(--blue)}\n'
    )
    must_count(data, dead_css_block, 1, "dead idx1-zone-intel CSS")
    data = data.replace(dead_css_block, "", 1)

    dead_intel_row_css = (
        "/* 2026-09-30: COT + Grain Stocks/USDA side by side, ported from the Design\n"
        "   canvas mockup's main+rail split. #f-cot-intel keeps its own internal\n"
        "   .ratio-cot-grid (nowcast + COT widget side by side); this just gives the\n"
        "   PAIR of top-level sections a second, outer column next to it. minmax(0,1fr)\n"
        "   on the left stops the COT widget's own grid from overflowing its track. */\n"
        ".idx1-intel-row{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:1rem;align-items:start}\n"
        "/* minmax(0,...) on BOTH rules, not bare 1fr: a bare 1fr track's implicit\n"
        "   minimum is its content's max-content width, so a wide flex row inside\n"
        "   (the I-raise toggle, the COT bar labels) keeps the track -- and the whole\n"
        "   page -- from ever actually shrinking to the viewport. Found by the\n"
        "   project's own 390px scrollWidth check: docScrollWidth was 492 against a\n"
        "   390 viewport before this fix, traced to gridTemplateColumns computing to\n"
        "   ~1525px instead of 390px. */\n"
        "@media(max-width:900px){.idx1-intel-row{grid-template-columns:minmax(0,1fr)}}\n"
    )
    must_count(data, dead_intel_row_css, 1, "dead idx1-intel-row CSS")
    data = data.replace(dead_intel_row_css, "", 1)

    # ---- 3. extract the real COT/Nowcast block and the Grain Stocks/WASDE
    # block, and delete the old "idx1-intel-row" one-row hack (zone label +
    # comment + the row wrapper) entirely. ----
    f_cot_intel_block, _, _ = extract_div_block(data, '<div class="fade-up" id="f-cot-intel">')
    f5_block, _, _ = extract_div_block(data, '<div class="fade-up" id="f5">')

    zone_label = ('<div class="idx1-zone-label idx1-zone-intel">Market Intelligence '
                  '<small>&mdash; where the money\'s actually positioned</small></div>')
    must_count(data, zone_label, 1, "intel zone label")
    intel_row_open = '<div class="idx1-intel-row">'
    must_count(data, intel_row_open, 1, "idx1-intel-row open")

    zone_start = data.index(zone_label)
    row_full, row_start, row_end = extract_div_block(data, intel_row_open)
    assert row_start > zone_start, "zone label should precede the intel-row wrapper"
    # sanity: the row block we extracted must contain both sub-blocks we pulled
    assert f_cot_intel_block in row_full, "f-cot-intel block not found inside idx1-intel-row"
    assert f5_block in row_full, "f5 block not found inside idx1-intel-row"

    # delete from the zone label through the end of the idx1-intel-row block
    data = data[:zone_start] + data[row_end:]

    # ---- 4. wrap main's remaining real content in .idx1-content, and add
    # the real <aside class="intel-rail"> holding the two extracted blocks,
    # as a DOM sibling of .idx1-content (not nested inside one grafted row). ----
    must_count(data, "</fieldset>", 1, "fieldset close (I raise toggle)")
    data = data.replace("</fieldset>", '</fieldset>\n<div class="idx1-shell"><div class="idx1-content">', 1)

    must_count(data, "</main>", 1, "main close tag")
    # No extra rail heading here: #f-cot-intel already carries its own
    # "Market Intelligence" sec-head (with the Full COT Chart link) — a
    # second heading above it duplicated the same words for no reason.
    aside_html = (
        "</div>\n"  # closes .idx1-content
        '<aside class="intel-rail" aria-label="Market intelligence" id="market-intel">\n'
        + f_cot_intel_block + "\n"
        + f5_block + "\n"
        "</aside>\n"
        "</div>\n"  # closes .idx1-shell
    )
    data = data.replace("</main>", aside_html + "</main>", 1)

    data = apply_panel_fixes(data)

    out_path = Path(args.out)
    out_path.write_text(data, encoding="utf-8")
    print(f"wrote {out_path} ({len(data)} bytes, was {original_len} bytes in source)")


def apply_panel_fixes(data: str) -> str:
    """2026-09-30, second pass: fixes for real findings from a three-lens
    audit panel (end-user / hostile domain professional / accessibility)
    run against the shell rebuild above, after Sig said "if we are going to
    migrate this optimized homepage then yes i want it to all be wired in
    and working seamlessly please, no cutting corners." Each fix below was
    confirmed against a real rendered page, not just read from source —
    see this kit's README for exactly how each one was verified, including
    two cases where an initial "fix" silently failed to take effect at all
    (a skip link loader.js quietly deleted, and a .catch() that a 404 never
    actually reached) and was only caught by re-testing, not by reading the
    diff and assuming it worked."""

    def apply(old, new, label):
        n = data.count(old)
        assert n == 1, f"{label}: found {n} matches, need exactly 1"
        return data.replace(old, new, 1)

    # Nowcast: real staleness badge (matching COT's own >=14-day convention)
    # and a real failure fallback (matching COT's own .catch pattern) —
    # the card previously had neither, and its fetch resolved null on a
    # 404 instead of throwing, so even a .catch() bolted on afterward would
    # never have run for the single most common failure mode.
    old_fetch = "fetch('/data/yield-nowcast.json').then(function(r){return r.ok?r.json():null;}).then(function(d){"
    new_fetch = "fetch('/data/yield-nowcast.json').then(function(r){if(!r.ok)throw new Error('no-nowcast');return r.json();}).then(function(d){"
    data = apply(old_fetch, new_fetch, "nowcast: throw on !r.ok so .catch actually runs")

    old_nowcast_tail = '''      var wk=document.getElementById('nc-week');
      if(wk&&d.crops.corn)wk.textContent='Ratings week ending '+d.crops.corn.week_ending+' \\u00b7 updates Tuesdays';
      var yr=document.getElementById('nc-years');
      if(yr&&d.crops.corn)yr.textContent=d.crops.corn.backtest_years;
    }).catch(function(){});
  }'''
    new_nowcast_tail = '''      var wk=document.getElementById('nc-week');
      if(wk&&d.crops.corn){
        var _wkEnd=d.crops.corn.week_ending;
        var _rd=/^\\d{4}-\\d{2}-\\d{2}$/.test(String(_wkEnd))?new Date(_wkEnd+'T12:00:00'):new Date(_wkEnd);
        var _daysOld=(_rd&&!isNaN(_rd.getTime()))?Math.round((Date.now()-_rd.getTime())/86400000):null;
        var _age=_daysOld==null?'':_daysOld<=13?'':' <svg class="ic" aria-hidden="true"><use href="#i-triangle-alert"/></svg> '+_daysOld+'d old';
        wk.innerHTML='Ratings week ending '+_wkEnd+' \\u00b7 updates Tuesdays'+_age;
        if(_daysOld!=null&&_daysOld>=14){wk.style.color='#f0913a';}
      }
      var yr=document.getElementById('nc-years');
      if(yr&&d.crops.corn)yr.textContent=d.crops.corn.backtest_years;
    }).catch(function(){
      var v=document.getElementById('nc-verdict');
      if(v){v.className='ratio-verdict neutral';v.textContent='Data unavailable';}
      var wk=document.getElementById('nc-week');
      if(wk){wk.textContent='Could not load this week\\u2019s ratings.';wk.style.color='';}
    });
  }'''
    data = apply(old_nowcast_tail, new_nowcast_tail, "nowcast: staleness badge + real failure fallback")

    # I-raise toggle: Cattle Only now actually hides the crop-only Nowcast
    # card instead of leaving stale-looking corn/soybean numbers up for a
    # user who just said they don't raise crops.
    old_toggle_css = '''fieldset:has(#i-raise-cattle:checked) ~ * .cot-rows::before{content:'Showing Cattle first';display:block;order:-2;font-size:.68rem;color:var(--green);margin-bottom:.3rem}
fieldset:has(#i-raise-mixed:checked) ~ * .cot-rows::before{content:'Cattle pinned, crops still shown';display:block;order:-2;font-size:.68rem;color:var(--green);margin-bottom:.3rem}'''
    new_toggle_css = '''fieldset:has(#i-raise-cattle:checked) ~ * .cot-rows::before{content:'Showing Cattle first';display:block;order:-2;font-size:.68rem;color:var(--green);margin-bottom:.3rem}
fieldset:has(#i-raise-mixed:checked) ~ * .cot-rows::before{content:'Cattle pinned, crops still shown';display:block;order:-2;font-size:.68rem;color:var(--green);margin-bottom:.3rem}
fieldset:has(#i-raise-cattle:checked) ~ * #nowcast-widget{display:none}
fieldset:has(#i-raise-cattle:checked) ~ * .idx1-nowcast-na{display:block!important}'''
    data = apply(old_toggle_css, new_toggle_css, "toggle: hide Nowcast for Cattle Only")

    old_nowcast_open = '''      <div class="ratio-widget" id="nowcast-widget">'''
    new_nowcast_open = '''      <div class="idx1-nowcast-na" style="display:none;padding:.6rem .1rem;font-size:.78rem;color:var(--text-muted)">Yield Nowcast (corn/soybean bu/ac) isn&rsquo;t shown for a cattle-only operation &mdash; switch to Row Crops or Mixed to see it.</div>
      <div class="ratio-widget" id="nowcast-widget">'''
    data = apply(old_nowcast_open, new_nowcast_open, "toggle: cattle-only Nowcast placeholder note")

    # COT caption: the verdict pill averages 4 commodities' position-in-range,
    # not a headcount of who's long/short, and the 52-wk window isn't the
    # desk-standard 3-yr COT Index — neither was stated on the page before.
    old_caption = '''<div class="cot-caption">Net contracts held long vs short by large money managers. Bar shows where that position sits within the past 52 weeks. Interpretation of public CFTC data, not a trading signal.</div>'''
    new_caption = '''<div class="cot-caption">Net contracts held long vs short by large money managers. Bar shows where that position sits within the past 52 weeks (not the 3-yr COT Index some desks use \\u2014 this window runs shorter, which can read positioning as more extreme). The badge above averages all four commodities&rsquo; position-in-range, not a headcount of who&rsquo;s long or short \\u2014 one row can run the other way. Interpretation of public CFTC data, not a trading signal.</div>'''
    data = apply(old_caption, new_caption, "COT caption microcopy")

    # Skip link to the rail. NOTE: the obvious approach — a second <a
    # class="skip"> — was tried first and silently failed: components/
    # loader.js (~line 88) deletes every a.skip once its own live
    # a.skip-link exists ("two tab stops for one action"), so a duplicate
    # a.skip never survives past page load. Only caught by querying the
    # live DOM after load, not by reading the static source. Uses its own
    # class with the same visually-hidden-until-focus treatment instead.
    old_skip = '<a href="#main" class="skip">Skip to content</a>'
    new_skip = '''<a href="#main" class="skip">Skip to content</a>
<a href="#market-intel" class="idx1-skip-rail">Skip to Market Intelligence</a>
<style>
.idx1-skip-rail{position:absolute;left:-9999px;top:0;z-index:1000;background:var(--brand);color:var(--bg);font-family:var(--font-mono,'JetBrains Mono',monospace);font-size:.8rem;font-weight:700;padding:.6rem 1rem;border-radius:0 0 var(--r-sm) 0;text-decoration:none}
.idx1-skip-rail:focus{left:110px}
</style>'''
    data = apply(old_skip, new_skip, "skip link to rail (survives loader.js cleanup)")

    # Visible jump-to-rail link in the ZIP subbar, at every width (not just
    # mobile) — the mockup's own build comments already named this as the
    # right fix for a rail that sits at the end of the DOM: "A future fix
    # for returning visitors belongs in a real 'jump to market intel' link,
    # not in silently reordering the page."
    old_subbar = '''<div class="idx1-subbar">
  <button type="button" id="idx1-zip-chip" class="idx1-zip-chip" aria-label="Jump to Cash Bids ZIP lookup">
    <span class="idx1-zip-label">ZIP</span>
    <span class="idx1-zip-val" id="idx1-zip-val">Not set</span>
    <span class="idx1-zip-change">Set / change &rarr;</span>
  </button>
</div>'''
    new_subbar = '''<div class="idx1-subbar">
  <button type="button" id="idx1-zip-chip" class="idx1-zip-chip" aria-label="Jump to Cash Bids ZIP lookup">
    <span class="idx1-zip-label">ZIP</span>
    <span class="idx1-zip-val" id="idx1-zip-val">Not set</span>
    <span class="idx1-zip-change">Set / change &rarr;</span>
  </button>
  <a href="#market-intel" class="idx1-zip-chip" style="text-decoration:none">
    <span class="idx1-zip-label">Market Intelligence</span>
    <span class="idx1-zip-change">Jump to COT / Nowcast &darr;</span>
  </a>
</div>'''
    data = apply(old_subbar, new_subbar, "visible jump-to-rail link in subbar")

    # ---- phase 3, 2026-09-30: teaser/discovery strip ----
    data = apply_discovery_section(data)

    # ---- phase 4, 2026-09-30: rail scorecard card ----
    data = apply_rail_scorecard(data)

    return data


def apply_discovery_section(data: str) -> str:
    """Adds the mockup's 'More on AGSIST' hairline-divided discovery list
    (the one real mockup feature that hadn't been built yet), after Sig
    said he wants teasers to other content as part of perfecting this page
    in place before it becomes the real homepage. Picks pages not already
    surfaced elsewhere on this page (Quick Tools already covers Field
    Scout/Spray/Urea; the hero/rail already cover Cash Bids/COT/Grain
    Stocks) so it's genuinely new discovery. Every link and icon id was
    checked against the real nav and the real icon sprite before shipping
    -- two of the first icon ids picked (a generic "map" and a "cloud-hail")
    don't exist in this page's sprite and would have rendered as invisible
    icons; caught by asking the live DOM whether each <use> resolved to a
    real symbol id, not by assuming a plausible-sounding icon name exists.
    Deliberately does NOT restyle Quick Tools or the sponsor block to the
    mockup's hairline treatment: Quick Tools is a real, data-driven widget
    set (live spray-window status, RMA planting dates, urea risk) with far
    more going on than the mockup's 3-icon placeholder strip, and stripping
    its card boundaries risked making working widgets look broken rather
    than more "on-brand" -- a design regression dressed as parity, not an
    optimization. Flagged plainly rather than done quietly either way."""

    def apply(old, new, label):
        n = data.count(old)
        assert n == 1, f"{label}: found {n} matches, need exactly 1"
        return data.replace(old, new, 1)

    old_anchor = '  <section class="fade-up" id="f-faq" aria-labelledby="faq-heading">'
    new_section = '''  <div class="fade-up" id="idx1-discovery">
    <h2 class="mono" style="margin:0 0 .5rem;font-size:.72rem;font-weight:700;letter-spacing:.11em;color:var(--text-muted);text-transform:uppercase">More on AGSIST</h2>
    <ul class="idx1-discovery-grid" style="list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:0;border-top:1px solid var(--border);border-left:1px solid var(--border)">
      <li style="border-right:1px solid var(--border);border-bottom:1px solid var(--border)"><a href="/farmland-atlas" class="card-link" style="display:flex;align-items:center;gap:.5rem;padding:.7rem .8rem;font-size:.82rem;color:var(--text);text-decoration:none"><svg class="ic" aria-hidden="true" style="flex:none"><use href="#i-map-pin"/></svg>Farmland Atlas</a></li>
      <li style="border-right:1px solid var(--border);border-bottom:1px solid var(--border)"><a href="/hail-map" class="card-link" style="display:flex;align-items:center;gap:.5rem;padding:.7rem .8rem;font-size:.82rem;color:var(--text);text-decoration:none"><svg class="ic" aria-hidden="true" style="flex:none"><use href="#i-cloud-lightning"/></svg>Hail Map</a></li>
      <li style="border-right:1px solid var(--border);border-bottom:1px solid var(--border)"><a href="/cash-rent" class="card-link" style="display:flex;align-items:center;gap:.5rem;padding:.7rem .8rem;font-size:.82rem;color:var(--text);text-decoration:none"><svg class="ic" aria-hidden="true" style="flex:none"><use href="#i-landmark"/></svg>Cash Rent by County</a></li>
      <li style="border-right:1px solid var(--border);border-bottom:1px solid var(--border)"><a href="/harvest-price-tracker" class="card-link" style="display:flex;align-items:center;gap:.5rem;padding:.7rem .8rem;font-size:.82rem;color:var(--text);text-decoration:none"><svg class="ic" aria-hidden="true" style="flex:none"><use href="#i-chart-column"/></svg>Harvest Price Tracker</a></li>
      <li style="border-right:1px solid var(--border);border-bottom:1px solid var(--border)"><a href="/milk-prices" class="card-link" style="display:flex;align-items:center;gap:.5rem;padding:.7rem .8rem;font-size:.82rem;color:var(--text);text-decoration:none"><svg class="ic" aria-hidden="true" style="flex:none"><use href="#i-beef"/></svg>Milk Prices</a></li>
      <li style="border-right:1px solid var(--border);border-bottom:1px solid var(--border)"><a href="/ag-odds" class="card-link" style="display:flex;align-items:center;gap:.5rem;padding:.7rem .8rem;font-size:.82rem;color:var(--text);text-decoration:none"><svg class="ic" aria-hidden="true" style="flex:none"><use href="#i-hourglass"/></svg>Ag Prediction Markets</a></li>
    </ul>
  </div>
  <style>@media(max-width:640px){.idx1-discovery-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important}}</style>
  <section class="fade-up" id="f-faq" aria-labelledby="faq-heading">'''
    data = apply(old_anchor, new_section, "insert discovery/teaser section before FAQ")
    return data


def apply_rail_scorecard(data: str) -> str:
    """Round 4, 2026-09-30: fills the rail, which the audit panel flagged as
    running dry about a quarter of the way down the page while the main
    column keeps going. The mockup's own fix for this was a premium-alerts
    upsell and a rail-native email signup -- neither exists in this codebase,
    so building either would mean fabricating a feature, which the project's
    honest-numbers rule rules out.

    Used something real instead: AGSIST's own call scorecard (already a
    shipped, live page at /scorecard, fed by data/scorecard.json) has never
    been surfaced on the homepage at all. It is exactly the kind of thing a
    market-intel rail should carry, and it costs nothing to add honestly --
    the number it leads with is real and not flattering (21.2% hit rate,
    graded strict), which is the whole point of this site's transparency
    stance. Card fetches the live JSON itself rather than hardcoding today's
    number, and uses data.by_method.deterministic -- the JSON's own
    "hit_rate_note" field says in so many words that this is the figure the
    page should be judged on, not the blended headline, matching how
    scorecard.html itself reads the same file.

    Deliberately does not touch #f-cot-intel or #f5 -- this is a new,
    independent card appended at the end of the rail, so it cannot regress
    anything already wired and verified in earlier rounds."""

    def apply(old, new, label):
        n = data.count(old)
        assert n == 1, f"{label}: found {n} matches, need exactly 1"
        return data.replace(old, new, 1)

    old_anchor = "</aside>"
    new_section = '''<div class="fade-up" id="f-rail-scorecard">
    <div class="sec-head"><h2 class="sec-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="width:1.05em;height:1.05em;vertical-align:-.13em;margin-right:.34em;flex:none"><use href="#i-target"/></svg>AGSIST Call Scorecard</h2><a href="/scorecard" class="sec-all">Full Record &rarr;</a></div>
    <div class="usda-cal-card" style="padding:.85rem 1rem">
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:.5rem;margin-bottom:.45rem">
        <span style="font-family:var(--font-display);font-weight:700;font-size:1.95rem;line-height:1;color:var(--text)" id="rsc-hit">&mdash;</span>
        <span style="font-size:.735rem;color:var(--text-muted);text-align:right;line-height:1.3">Hit rate,<br>graded by rule</span>
      </div>
      <div style="font-size:.8rem;color:var(--text-dim);line-height:1.5" id="rsc-verdict">Loading&hellip;</div>
      <div style="font-family:'JetBrains Mono',monospace;font-size:.735rem;color:var(--text-muted);margin-top:.55rem;display:flex;justify-content:space-between;gap:.5rem" id="rsc-stats">
        <span id="rsc-record">&mdash;</span>
        <span id="rsc-sample">&mdash;</span>
      </div>
    </div>
    <p style="font-size:.735rem;color:var(--text-muted);margin:.4rem .1rem 0;line-height:1.45">Every forward call this site's own daily briefing makes, graded against the next settlement, misses included. Not a trading signal &mdash; a public record of whether the calls actually played out.</p>
  </div>
  <script>
  (function(){
    fetch('/data/scorecard.json',{cache:'no-store'}).then(function(r){if(!r.ok)throw new Error('no-scorecard');return r.json();}).then(function(d){
      var det=(d&&d.by_method&&d.by_method.deterministic)||null;
      var dirOnly=(d&&d.direction_only)||null;
      if(!det||det.hit_rate==null){document.getElementById('rsc-verdict').textContent='Scorecard unavailable right now.';return;}
      document.getElementById('rsc-hit').textContent=det.hit_rate.toFixed(1)+'%';
      var pending=(d.pending!=null)?d.pending:0;
      document.getElementById('rsc-record').textContent=det.played+'\\u2013'+det.missed+'\\u2013'+pending;
      document.getElementById('rsc-sample').textContent=det.graded+' calls graded';
      var v='Hitting the called price level about 1 in 5 times.';
      if(dirOnly&&dirOnly.rate!=null){
        v='Right on direction about '+Math.round(dirOnly.rate)+'% of the time &mdash; hitting the exact level called, only '+det.hit_rate.toFixed(0)+'%.';
      }
      document.getElementById('rsc-verdict').innerHTML=v;
    }).catch(function(){
      document.getElementById('rsc-verdict').textContent='Scorecard unavailable right now.';
    });
  })();
  </script>
</aside>'''
    data = apply(old_anchor, new_section, "append call-scorecard card to end of rail")
    return data


if __name__ == "__main__":
    main()
