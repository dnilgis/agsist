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
    # FIX 2026-09-30 (audit panel, round 6): this used \\u2014 (double
    # backslash) inside a plain Python string, which produces the six
    # literal characters "\\u2014" in the HTML text, not an em dash. Every
    # other em dash in this file is inside a JS string (single backslash,
    # e.g. '\\u2014'), which the browser's own JS engine decodes at
    # runtime -- but this one sits in static HTML text, which nothing
    # decodes. Caught by a panelist reading the live rendered DOM text,
    # not the source: a visitor reading this exact caption -- the one
    # written to explain the COT methodology to a skeptical reader --
    # saw two literal backslash-u sequences mid-sentence. Uses a real
    # em-dash character now, like the rest of this file's static HTML text.
    new_caption = '''<div class="cot-caption">Net contracts held long vs short by large money managers. Bar shows where that position sits within the past 52 weeks (not the 3-yr COT Index some desks use — this window runs shorter, which can read positioning as more extreme). The badge above averages all four commodities&rsquo; position-in-range, not a headcount of who&rsquo;s long or short — one row can run the other way. Interpretation of public CFTC data, not a trading signal.</div>'''
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

    # ---- phase 5, 2026-09-30: real bugs from a 3-lens audit panel ----
    data = apply_panel_round2_fixes(data)

    # ---- phase 6, 2026-10-01: IA panel -- Cash Bids promoted, radar demoted ----
    data = apply_ia_panel_round(data)

    # ---- phase 7, 2026-10-01: round 8 -- Dec'27 forward contracts, weather
    # centerpiece, hero collapse, scorecard teaser, speakable, price table,
    # ZIP sync fix ----
    data = apply_round8_build(data)

    # ---- phase 8, 2026-10-01: round 9 -- Quick Tools visual-language pass
    # (hairlines, not boxes) ----
    data = apply_round9_build(data)

    # ---- phase 9, 2026-10-01: round 10 -- the price-alert client widget ----
    data = apply_round10_build(data)

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


def apply_panel_round2_fixes(data: str) -> str:
    """Round 6, 2026-09-30: real bugs a 3-lens panel (end-user run was
    stopped mid-flight; hostile domain pro, accessibility/failure-modes,
    and quantitative reviewer all completed) found by actually driving the
    live page and reading the real JSON, not by reading the diff. Each
    one verified independently before being fixed here:

      1. "Skip to Market Intelligence" moved the URL hash and scrolled the
         page, but never moved keyboard focus -- #market-intel had no
         tabindex, so document.activeElement stayed on <body> after
         activating the link. The one control built specifically to solve
         "the rail is far away" didn't actually get a keyboard user there.
      2. A malformed/partial scorecard.json (deterministic object present
         but missing played/missed -- a realistic drift case, not a
         contrived one) rendered the literal string "undefined-undefined"
         into the rail card's record line for real visitors, because
         det.played/det.missed were concatenated without being checked.
      3. The rail's "pending" number (6) is the GLOBAL pending count across
         both scoring eras, but sits next to played/missed counts (18/67)
         that are deterministic-method-only. Only 1 of those 6 pending
         calls is actually deterministic-method; the other 5 are stale
         self-graded pending calls from Apr-Jun 2026. Now computed from
         the same records array, scoped to method=='deterministic', so
         the three numbers in "W-L-Pending" are drawn from the same
         population for the first time.
      4. The record numbers had no label at all on the compact card
         (scorecard.html spells out "W - L - pending"; this card didn't).
      5. The verdict sentence's "right on direction about 48%" was framed
         as the flattering half of the contrast without noting 48% is
         below a coin flip -- two independent panelists flagged this as
         the kind of thing a skeptical reader reads as either not
         understanding the math or trying to paper over it.
      6. No aria-live region, so a screen-reader user who has moved past
         the card before the fetch resolves never hears the numbers
         land -- "Loading..." is the last thing announced.
      7. No as-of date, unlike every other rail card, so a stalled
         pipeline would leave this card showing old numbers with zero
         visual signal that anything's wrong.

    Deliberately NOT done this round (flagged, not fixed, to keep this
    round bounded and verifiable): reordering the skip-link tab sequence
    (loader.js's global a.skip cleanup interacts with header injection
    timing sitewide, not just this page -- a real fix belongs in
    components/loader.js with its own verification pass, not bundled into
    an index1-only patch); surfacing scorecard.json's band_flags ("most
    misses called a level outside a realistic one-session move") on the
    compact card, which both the quant and hostile-pro panelists flagged
    as genuinely useful missing context, not a bug -- a real content
    addition that deserves its own round rather than being folded in
    silently; rounding the 21.2% headline to a whole percent to avoid
    implying false precision on n=85 -- the site's own scorecard.html
    already leads with one decimal place, so changing it here only would
    make the two pages disagree, which is its own rule violation."""

    def apply(old, new, label):
        n = data.count(old)
        assert n == 1, f"{label}: found {n} matches, need exactly 1"
        return data.replace(old, new, 1)

    # ---- fix 1: skip-to-rail link now actually moves focus ----
    old_aside = '<aside class="intel-rail" aria-label="Market intelligence" id="market-intel">'
    new_aside = '<aside class="intel-rail" aria-label="Market intelligence" id="market-intel" tabindex="-1" style="outline:none">'
    data = apply(old_aside, new_aside, "tabindex on rail aside")

    old_skip = '<a href="#market-intel" class="idx1-skip-rail">Skip to Market Intelligence</a>'
    new_skip = '''<a href="#market-intel" class="idx1-skip-rail" id="idx1-skip-rail-link">Skip to Market Intelligence</a>
<script>
/* FIX 2026-09-30 (accessibility panel): tabindex="-1" alone doesn't move
   focus in every browser on a hash-only navigation -- some only scroll.
   Focusing explicitly on click/keydown matches the pattern the header's
   own working "Skip to main content" link already uses via loader.js. */
(function(){
  var l=document.getElementById('idx1-skip-rail-link');
  if(l)l.addEventListener('click',function(){
    var t=document.getElementById('market-intel');
    if(t)setTimeout(function(){t.focus();},0);
  });
})();
</script>'''
    data = apply(old_skip, new_skip, "focus-on-click for rail skip link")

    # ---- fixes 2-4 + 7: scorecard record validation, scoped pending,
    #      label, and as-of date ----
    old_card_html = '''      <div style="font-family:'JetBrains Mono',monospace;font-size:.735rem;color:var(--text-muted);margin-top:.55rem;display:flex;justify-content:space-between;gap:.5rem" id="rsc-stats">
        <span id="rsc-record">&mdash;</span>
        <span id="rsc-sample">&mdash;</span>
      </div>
    </div>
    <p style="font-size:.735rem;color:var(--text-muted);margin:.4rem .1rem 0;line-height:1.45">Every forward call this site's own daily briefing makes, graded against the next settlement, misses included. Not a trading signal &mdash; a public record of whether the calls actually played out.</p>'''
    new_card_html = '''      <div style="font-family:'JetBrains Mono',monospace;font-size:.735rem;color:var(--text-muted);margin-top:.55rem;display:flex;justify-content:space-between;gap:.5rem" id="rsc-stats">
        <span><span id="rsc-record">&mdash;</span> <span style="opacity:.75">W&ndash;L&ndash;Pending</span></span>
        <span id="rsc-sample">&mdash;</span>
      </div>
      <div style="font-size:.7rem;color:var(--text-muted);margin-top:.25rem" id="rsc-asof">&nbsp;</div>
    </div>
    <p style="font-size:.735rem;color:var(--text-muted);margin:.4rem .1rem 0;line-height:1.45">Every forward call this site's own daily briefing makes, graded against the next settlement, misses included. Not a trading signal &mdash; a public record of whether the calls actually played out.</p>'''
    data = apply(old_card_html, new_card_html, "label + as-of line on scorecard card")

    old_wrap_open = '<div class="fade-up" id="f-rail-scorecard">'
    new_wrap_open = '<div class="fade-up" id="f-rail-scorecard" aria-live="polite" aria-atomic="true">'
    data = apply(old_wrap_open, new_wrap_open, "aria-live on scorecard card")

    old_script = '''  <script>
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
  </script>'''
    new_script = '''  <script>
  (function(){
    fetch('/data/scorecard.json',{cache:'no-store'}).then(function(r){if(!r.ok)throw new Error('no-scorecard');return r.json();}).then(function(d){
      var det=(d&&d.by_method&&d.by_method.deterministic)||null;
      var dirOnly=(d&&d.direction_only)||null;
      if(!det||det.hit_rate==null){document.getElementById('rsc-verdict').textContent='Scorecard unavailable right now.';return;}
      document.getElementById('rsc-hit').textContent=det.hit_rate.toFixed(1)+'%';
      /* FIX 2026-09-30 (accessibility panel): played/missed weren't
         validated before being concatenated -- a partial payload with
         a valid deterministic.hit_rate but a missing played/missed
         rendered the literal string "undefined-undefined-N" here. */
      var haveRecord=typeof det.played==='number'&&typeof det.missed==='number';
      /* FIX 2026-09-30 (quant panel): "pending" was the GLOBAL pending
         count across both scoring eras (6), sitting next to played/missed
         counts that are deterministic-only (18/67 of 85). Scope pending
         to the same method from the raw records array so the three
         numbers are drawn from the same population. */
      var pending=0;
      if(d.records&&d.records.length){
        for(var i=0;i<d.records.length;i++){
          if(d.records[i].method==='deterministic'&&d.records[i].outcome==='pending')pending++;
        }
      }else if(d.pending!=null){
        pending=d.pending; /* records array unavailable -- falls back to the unscoped figure rather than showing nothing */
      }
      document.getElementById('rsc-record').textContent=haveRecord?(det.played+'\\u2013'+det.missed+'\\u2013'+pending):'\\u2014';
      document.getElementById('rsc-sample').textContent=(det.graded!=null?det.graded:'\\u2014')+' calls graded';
      var asof=document.getElementById('rsc-asof');
      if(asof){
        var last=det.last||d.updated;
        asof.textContent=last?('Through '+last):'';
      }
      /* FIX 2026-09-30 (hostile-pro + quant panels, independently): the
         comparison number (48%) is itself below a coin flip. Framing it
         as the "generous" half of the contrast without saying so reads,
         to a skeptical pro, as either not understanding the math or
         trying to paper over it. State the baseline plainly instead. */
      var v='Hitting the called price level about 1 in 5 times.';
      if(dirOnly&&dirOnly.rate!=null){
        var dr=Math.round(dirOnly.rate);
        var drNote=dr<50?' (below a coin flip)':'';
        v='Right on direction about '+dr+'% of the time'+drNote+' &mdash; hitting the exact level called, only '+det.hit_rate.toFixed(0)+'%.';
      }
      document.getElementById('rsc-verdict').innerHTML=v;
    }).catch(function(){
      document.getElementById('rsc-verdict').textContent='Scorecard unavailable right now.';
    });
  })();
  </script>'''
    data = apply(old_script, new_script, "validate record fields, scope pending, coin-flip framing")

    return data


def apply_ia_panel_round(data: str) -> str:
    """Round 7, 2026-10-01: Sig asked for a panel to figure out what deserves
    real estate on the homepage, aiming for "New York Times-caliber" -- tight,
    crisp, easy to read. Ran three lenses in parallel (an IA/editor lens, a
    real end-user farmer lens, and an SEO/monetization lens), all driving the
    live rendered page, not reading the diff. All three converged
    independently on the same finding: Cash Bids -- the single highest-stakes,
    most money-relevant thing on this page -- gets the exact same visual
    weight as a weather box and a list of tool links (three same-sized grid
    siblings, confirmed via live getBoundingClientRect measurement, not
    assumed from markup). Meanwhile the live radar embed (a 320-375px Windy
    iframe) sits above all of it, and the end-user panelist measured ~2400px
    of scroll on mobile -- roughly three phone screens -- before reaching the
    ZIP box for Cash Bids.

    This round makes the single highest-confidence, most convergent, lowest-
    risk fix: promotes Cash Bids to its own full-width row at the top of the
    "Live Now" zone, and demotes the radar/drought section below it, using
    CSS order/grid-column on the EXISTING flex and grid containers rather
    than physically relocating any markup. .idx1-content is already
    `display:flex;flex-direction:column` and .dash-grid is already
    `display:grid` (components/styles.css:339) -- both already support the
    CSS `order` property, so this is three one-line style additions, not a
    DOM rewrite: zero risk of breaking the carefully-tested calculator/basis-
    chart/trust-ledger wiring inside #f1, because none of that markup moves.
    Also adds the one-line hint the end-user panelist flagged as a real,
    specific gap: the storage calculator and basis-history chart inside Cash
    Bids are genuinely built and wired (confirmed in components/
    homepage-extras.js and bids-homepage.js) but completely invisible until a
    bid resolves, with nothing telling a first-time visitor they exist.

    Deliberately NOT done this round (real, convergent findings, each
    deserving its own careful pass rather than being bundled in sight-unseen):
      - Collapsing the daily-briefing hero's email-signup/Wire/Harvest-band
        stack that currently sits above Cash Bids even after this fix --
        touches the daily-hero component shared with other state, bigger
        surface area to verify.
      - Shrinking or cutting the Windy radar iframe itself (only its
        position changes this round, not its size) -- a real live feature,
        cutting it is a product call Sig should make explicitly.
      - Unifying the three separate ZIP inputs on the page (top chip, Local
        Conditions, Cash Bids) into one -- real friction, but cross-component
        state sync is exactly the kind of change this project's history says
        to test hard before shipping, not fold into a layout-order patch.
      - Promoting a compact Call Scorecard teaser into the main column for
        mobile (it sits at 85% scroll depth there, confirmed live) -- a
        second instance of the same card needs its own dedupe-with-aria-live
        thinking, not a copy-paste.
      - Adding the scorecard's hit-rate and the trust-ledger's elevator-count
        to the JSON-LD graph / speakable list for AEO citability -- a real,
        specific, scoped SEO fix, next in queue.
      - Compressing the 21+ individual price cards and crypto/outside-market
        cards into a denser table (incl. dropping Kaspa, which the SEO
        panelist flagged as unexplained scope creep on a farm site) -- the
        biggest visual-language change recommended, and the one most likely
        to need its own round of screenshots and iteration, not a quick patch.
    """

    def apply(old, new, label):
        n = data.count(old)
        assert n == 1, f"{label}: found {n} matches, need exactly 1"
        return data.replace(old, new, 1)

    # ---- promote Cash Bids (#f1) to its own full-width row, first in the
    #      "Live Now" grid, ahead of Local Conditions (#f2) and Quick Tools
    #      (#f3) -- order:-1 within the same auto-fit grid so it renders
    #      first and spans every column, with zero change to its contents. ----
    data = apply(
        '<div class="fade-up" id="f1">',
        '<div class="fade-up" id="f1" style="order:-1;grid-column:1/-1">',
        "promote Cash Bids to full-width first row in dash-grid",
    )

    # ---- demote the radar/drought section below the Live Now zone (Cash
    #      Bids / Local Conditions / Quick Tools) by giving the zone label
    #      and the grid that follows it order:-1 within their shared flex
    #      parent (.idx1-content). #f-radar itself is untouched -- it stays
    #      at the default order:0, which now simply means "after everything
    #      marked -1" instead of "first", with none of its own markup (the
    #      Windy iframe, drought image, fallback states) touched or re-tested. ----
    data = apply(
        '<div class="idx1-zone-label idx1-zone-live">Live Now <small>&mdash; your location, your bids, right now</small></div>',
        '<div class="idx1-zone-label idx1-zone-live" style="order:-1">Live Now <small>&mdash; your location, your bids, right now</small></div>',
        "promote Live Now zone label above radar via flex order",
    )
    data = apply(
        '<div class="dash-grid" id="dash-grid">',
        '<div class="dash-grid" id="dash-grid" style="order:-1">',
        "promote dash-grid above radar via flex order",
    )

    # ---- the end-user panelist's specific, named gap: the calculator and
    #      basis chart are real and wired but invisible until a bid loads,
    #      with nothing telling a first-time visitor to look up their
    #      elevator to unlock them. One line, no behavior change. ----
    data = apply(
        '<div id="bids-list-area"><div class="bids-skeleton" aria-label="Loading cash bids"><div class="bids-skel-row"></div><div class="bids-skel-row"></div><div class="bids-skel-row"></div></div></div>',
        '<div class="idx1-bids-hint" style="font-size:0.74rem;color:var(--text-muted);margin-bottom:.55rem">Look up your bid below to unlock a store-or-sell calculator and that elevator’s basis history.</div>\n        <div id="bids-list-area"><div class="bids-skeleton" aria-label="Loading cash bids"><div class="bids-skel-row"></div><div class="bids-skel-row"></div><div class="bids-skel-row"></div></div></div>',
        "hint that the calculator/basis chart exist before a bid loads",
    )

    return data


def apply_round8_build(data: str) -> str:
    """Round 8, 2026-10-01. Sig: "i want this homepage to be a legit
    dashboard... bids, weather, news" as the centerpiece trio, baseline
    radar size kept (his pick over shrink/cut), drought map collapsed,
    GDU/rainfall accumulation (already real, already built into Local
    Conditions) carried along for free once that card is promoted. Also:
    corn/soybean forward-year tiles so harvest season never collapses to
    one tile, Kaspa dropped (Bitcoin kept), the Wire/harvest stack
    tightened without deleting anything, a mobile scorecard teaser, two
    speakable selectors, and a real one-way-sync bug fixed in the ZIP
    inputs (not a missing feature -- window.agsistSetZip already existed
    and already synced Cash Bids -> Weather; Weather -> Cash Bids was the
    only direction that bypassed it)."""

    def apply(old, new, label):
        n = data.count(old)
        assert n == 1, f"{label}: found {n} matches, need exactly 1"
        return data.replace(old, new, 1)

    # ---- 1. Corn/soybean Dec'27 forward-year tiles. When front-month and
    # this-year's-harvest contract are the same contract (true corn/beans
    # from early fall through year end), used to hide the second tile and
    # append "+ new crop". Now swaps the second tile to NEXT year's harvest
    # contract instead -- corn-dec27 / beans-nov27, both already fetched
    # live by scripts/fetch_prices.py into data/prices.json, no new data
    # source needed. ----
    old_collapse = '''  function collapseSameContract(){
    [['corn-near','corn-dec'],['bean-near','bean-nov']].forEach(function(pair){
      var a=document.getElementById('pcp-'+pair[0]), b=document.getElementById('pcp-'+pair[1]);
      var ap=document.getElementById('pcprev-'+pair[0]), bp=document.getElementById('pcprev-'+pair[1]);
      if(!a||!b||!ap||!bp)return;
      var at=(a.textContent||'').trim(), bt=(b.textContent||'').trim();
      var as=(ap.textContent||'').trim(), bs=(bp.textContent||'').trim();
      var card=b.parentNode;
      while(card&&card!==document.body&&(' '+(card.className||'')+' ').indexOf(' pc ')<0)card=card.parentNode;
      if(!card||card===document.body)return;
      var same=at&&at!=='--'&&at===bt&&as&&as===bs;
      card.style.display=same?'none':'';
      var keep=a.parentNode;
      while(keep&&keep!==document.body&&(' '+(keep.className||'')+' ').indexOf(' pc ')<0)keep=keep.parentNode;
      var lbl=keep&&keep.querySelector?keep.querySelector('.pc-contract'):null;
      if(lbl){
        var base=(lbl.getAttribute('data-base')||lbl.textContent||'').trim();
        lbl.setAttribute('data-base',base);
        lbl.textContent=same?(base+' + new crop'):base;
      }'''
    new_collapse = '''  var FORWARD_YEAR={
    'corn-dec':{dataKey:'corn-dec27',rangeId:'corn-dec',label:"Dec '27"},
    'bean-nov':{dataKey:'beans-nov27',rangeId:'beans-nov',label:"Nov '27"}
  };
  function applyForwardYear(domSuffix,fwd){
    var q=window.AGSIST_PRICE_DATA||{};
    var fq=q[fwd.dataKey];
    if(!fq||fq.close==null||fq.wk52_lo==null||fq.wk52_hi==null)return false;
    if(typeof fmtPrice!=='function'||typeof fmtChange!=='function')return false;
    var priceEl=document.getElementById('pcp-'+domSuffix);
    var chgEl=document.getElementById('pcc-'+domSuffix);
    var prevEl=document.getElementById('pcprev-'+domSuffix);
    if(!priceEl||!chgEl)return false;
    priceEl.textContent=fmtPrice(fq.close,2,true);
    var chgObj=fmtChange(fq.close,fq.open,true,fq.netChange,fq.pctChange);
    chgEl.textContent=chgObj.text;
    chgEl.className='pc-chg-val '+chgObj.cls;
    if(prevEl&&fq.open!=null)prevEl.textContent='prev: '+fmtPrice(fq.open,2,true)+' '+(fq.ticker||'');
    var lo=fq.wk52_lo/100,hi=fq.wk52_hi/100,cl=fq.close/100;
    if(hi>lo){
      var pct=Math.max(0,Math.min(100,((cl-lo)/(hi-lo))*100));
      var elLo=document.getElementById('pcrl-'+fwd.rangeId+'-lo'), elHi=document.getElementById('pcrl-'+fwd.rangeId+'-hi');
      var elF=document.getElementById('pcrf-'+fwd.rangeId), elD=document.getElementById('pcrd-'+fwd.rangeId);
      if(elLo)elLo.textContent='$'+lo.toFixed(2);
      if(elHi)elHi.textContent='$'+hi.toFixed(2);
      if(elF)elF.style.width=pct.toFixed(1)+'%';
      if(elD)elD.style.left=pct.toFixed(1)+'%';
    }
    return true;
  }
  /* 2026-10-01: when the front-month and this-year's-harvest contract are
     the same contract (true for corn/beans from early fall through year end),
     this used to hide the second tile and append "+ new crop" to the first.
     Sig's call: never drop to one tile for corn or beans -- when that
     happens, swap the second tile to NEXT year's harvest contract
     (corn-dec27 / beans-nov27) instead, so the reader always sees two real,
     distinct corn (or bean) prices. Both symbols are already fetched live by
     scripts/fetch_prices.py into data/prices.json -- no new data source. */
  function collapseSameContract(){
    [['corn-near','corn-dec'],['bean-near','bean-nov']].forEach(function(pair){
      var a=document.getElementById('pcp-'+pair[0]), b=document.getElementById('pcp-'+pair[1]);
      var ap=document.getElementById('pcprev-'+pair[0]), bp=document.getElementById('pcprev-'+pair[1]);
      if(!a||!b||!ap||!bp)return;
      var at=(a.textContent||'').trim(), bt=(b.textContent||'').trim();
      var as=(ap.textContent||'').trim(), bs=(bp.textContent||'').trim();
      var card=b.parentNode;
      while(card&&card!==document.body&&(' '+(card.className||'')+' ').indexOf(' pc ')<0)card=card.parentNode;
      if(!card||card===document.body)return;
      var same=at&&at!=='--'&&at===bt&&as&&as===bs;
      var fwd=FORWARD_YEAR[pair[1]];
      var swapped=(same&&fwd)?applyForwardYear(pair[1],fwd):false;
      card.style.display=(same&&!swapped)?'none':'';
      var keep=a.parentNode;
      while(keep&&keep!==document.body&&(' '+(keep.className||'')+' ').indexOf(' pc ')<0)keep=keep.parentNode;
      var lbl=keep&&keep.querySelector?keep.querySelector('.pc-contract'):null;
      if(lbl){
        var base=(lbl.getAttribute('data-base')||lbl.textContent||'').trim();
        lbl.setAttribute('data-base',base);
        lbl.textContent=(same&&!swapped)?(base+' + new crop'):base;
      }
      if(same&&swapped){
        var bLbl=card.querySelector&&card.querySelector('.pc-contract');
        if(bLbl)bLbl.textContent=fwd.label;
      }'''
    data = apply(old_collapse, new_collapse, "Dec'27 forward-year tile swap")

    # ---- 2. Fold Metals & Digital Assets into #f-prices as its final
    # subsection (one continuous view instead of two stacked cards), drop
    # Kaspa (unexplained scope creep on a farm-market site, per a prior
    # SEO/monetization review), keep Bitcoin and XRP (Sig's explicit call). ----
    old_treasury_close = '''      <div class="pc pc-sm" data-spark="treasury10"><div class="pc-head"><span class="pc-name"><span class="pc-name-icon"><svg class="ic" aria-hidden="true"><use href="#i-landmark"/></svg></span>10-Yr Treasury</span><span class="pc-contract">Yield %</span></div><div class="pc-price" id="pcp-treasury">--</div><div class="pc-change"><span class="pc-chg-val nc" id="pcc-treasury">--</span></div><div class="pc-prev" id="pcprev-treasury"></div><div class="pc-range"><div class="pc-range-labels"><span id="pcrl-treasury10-lo">3.9%</span><span>Land &amp; Loan Rates</span><span id="pcrl-treasury10-hi">4.6%</span></div><div class="pc-range-track"><div class="pc-range-fill" id="pcrf-treasury10" style="width:56.6%"></div><div class="pc-range-dot" id="pcrd-treasury10" style="left:56.6%"></div></div></div></div>
    </div>
  </div>
  
  
  <div class="fade-up" id="f-noaa">'''
    new_treasury_close = '''      <div class="pc pc-sm" data-spark="treasury10"><div class="pc-head"><span class="pc-name"><span class="pc-name-icon"><svg class="ic" aria-hidden="true"><use href="#i-landmark"/></svg></span>10-Yr Treasury</span><span class="pc-contract">Yield %</span></div><div class="pc-price" id="pcp-treasury">--</div><div class="pc-change"><span class="pc-chg-val nc" id="pcc-treasury">--</span></div><div class="pc-prev" id="pcprev-treasury"></div><div class="pc-range"><div class="pc-range-labels"><span id="pcrl-treasury10-lo">3.9%</span><span>Land &amp; Loan Rates</span><span id="pcrl-treasury10-hi">4.6%</span></div><div class="pc-range-track"><div class="pc-range-fill" id="pcrf-treasury10" style="width:56.6%"></div><div class="pc-range-dot" id="pcrd-treasury10" style="left:56.6%"></div></div></div></div>
    </div>
    <!-- 2026-10-01: Metals & Digital Assets folded in here from its own
         separate #f-crypto card -- same section, one continuous view instead
         of two stacked boxes, per Sig's "logical order in one view" ask.
         Kaspa dropped (flagged by a prior SEO/monetization review as
         unexplained scope creep on a farm-market site); Bitcoin and XRP kept
         at Sig's explicit instruction. No ids changed, no data binding touched. -->
    <div class="pc-section-lbl"><svg class="ic" aria-hidden="true"><use href="#i-medal"/></svg> Metals &amp; Digital Assets</div>
    <div class="price-cards-grid-2">
      <div class="pc pc-sm" data-spark="gold"><div class="pc-head"><span class="pc-name"><span class="pc-name-icon"><svg class="ic" aria-hidden="true"><use href="#i-medal"/></svg></span>Gold</span><span class="pc-contract">Spot</span></div><div class="pc-price" id="pcp-gold">--</div><div class="pc-change"><span class="pc-chg-val nc" id="pcc-gold">--</span></div><div class="pc-prev" id="pcprev-gold"></div><div class="pc-range"><div class="pc-range-labels"><span id="pcrl-gold-lo">$3,125</span><span></span><span id="pcrl-gold-hi">$5,586</span></div><div class="pc-range-track"><div class="pc-range-fill" id="pcrf-gold" style="width:65.0%"></div><div class="pc-range-dot" id="pcrd-gold" style="left:65.0%"></div></div></div></div>
      <div class="pc pc-sm" data-spark="silver"><div class="pc-head"><span class="pc-name"><span class="pc-name-icon"><svg class="ic" aria-hidden="true"><use href="#i-medal"/></svg></span>Silver</span><span class="pc-contract">Spot</span></div><div class="pc-price" id="pcp-silver">--</div><div class="pc-change"><span class="pc-chg-val nc" id="pcc-silver">--</span></div><div class="pc-prev" id="pcprev-silver"></div><div class="pc-range"><div class="pc-range-labels"><span id="pcrl-silver-lo">$32</span><span></span><span id="pcrl-silver-hi">$121</span></div><div class="pc-range-track"><div class="pc-range-fill" id="pcrf-silver" style="width:49.0%"></div><div class="pc-range-dot" id="pcrd-silver" style="left:49.0%"></div></div></div></div>
      <div class="pc pc-sm" data-spark="bitcoin"><div class="pc-head"><span class="pc-name"><span class="pc-name-icon">&#x20BF;</span>Bitcoin</span><span class="pc-contract">USD</span></div><div class="pc-price" id="pc-btc">--</div><div class="pc-change"><span class="pc-chg-val nc" id="pcc-btc">--</span></div><div class="pc-prev" id="pcprev-btc"></div><div class="pc-range"><div class="pc-range-labels"><span id="pcrl-bitcoin-lo">$60,074</span><span></span><span id="pcrl-bitcoin-hi">$126,198</span></div><div class="pc-range-track"><div class="pc-range-fill" id="pcrf-bitcoin" style="width:27.1%"></div><div class="pc-range-dot" id="pcrd-bitcoin" style="left:27.1%"></div></div></div></div>
      <div class="pc pc-sm" data-spark="ripple"><div class="pc-head"><span class="pc-name"><span class="pc-name-icon">&#x25CE;</span>XRP</span><span class="pc-contract">USD</span></div><div class="pc-price" id="pc-xrp">--</div><div class="pc-change"><span class="pc-chg-val nc" id="pcc-xrp">--</span></div><div class="pc-prev" id="pcprev-xrp"></div><div class="pc-range"><div class="pc-range-labels"><span id="pcrl-ripple-lo">$1.13</span><span></span><span id="pcrl-ripple-hi">$3.65</span></div><div class="pc-range-track"><div class="pc-range-fill" id="pcrf-ripple" style="width:12.1%"></div><div class="pc-range-dot" id="pcrd-ripple" style="left:12.1%"></div></div></div></div>
    </div>
  </div>


  <div class="fade-up" id="f-noaa">'''
    data = apply(old_treasury_close, new_treasury_close, "fold metals/crypto into price-prices section")

    old_crypto_card = '''  <div class="fade-up" id="f-crypto">
    <div class="pc-section-lbl"><svg class="ic" aria-hidden="true"><use href="#i-medal"/></svg> Metals &amp; Digital Assets</div>
    <div class="price-cards-grid-2" style="margin-bottom:1rem">
      <div class="pc pc-sm" data-spark="gold"><div class="pc-head"><span class="pc-name"><span class="pc-name-icon"><svg class="ic" aria-hidden="true"><use href="#i-medal"/></svg></span>Gold</span><span class="pc-contract">Spot</span></div><div class="pc-price" id="pcp-gold">--</div><div class="pc-change"><span class="pc-chg-val nc" id="pcc-gold">--</span></div><div class="pc-prev" id="pcprev-gold"></div><div class="pc-range"><div class="pc-range-labels"><span id="pcrl-gold-lo">$3,125</span><span></span><span id="pcrl-gold-hi">$5,586</span></div><div class="pc-range-track"><div class="pc-range-fill" id="pcrf-gold" style="width:65.0%"></div><div class="pc-range-dot" id="pcrd-gold" style="left:65.0%"></div></div></div></div>
      <div class="pc pc-sm" data-spark="silver"><div class="pc-head"><span class="pc-name"><span class="pc-name-icon"><svg class="ic" aria-hidden="true"><use href="#i-medal"/></svg></span>Silver</span><span class="pc-contract">Spot</span></div><div class="pc-price" id="pcp-silver">--</div><div class="pc-change"><span class="pc-chg-val nc" id="pcc-silver">--</span></div><div class="pc-prev" id="pcprev-silver"></div><div class="pc-range"><div class="pc-range-labels"><span id="pcrl-silver-lo">$32</span><span></span><span id="pcrl-silver-hi">$121</span></div><div class="pc-range-track"><div class="pc-range-fill" id="pcrf-silver" style="width:49.0%"></div><div class="pc-range-dot" id="pcrd-silver" style="left:49.0%"></div></div></div></div>
      <div class="pc pc-sm" data-spark="bitcoin"><div class="pc-head"><span class="pc-name"><span class="pc-name-icon">&#x20BF;</span>Bitcoin</span><span class="pc-contract">USD</span></div><div class="pc-price" id="pc-btc">--</div><div class="pc-change"><span class="pc-chg-val nc" id="pcc-btc">--</span></div><div class="pc-prev" id="pcprev-btc"></div><div class="pc-range"><div class="pc-range-labels"><span id="pcrl-bitcoin-lo">$60,074</span><span></span><span id="pcrl-bitcoin-hi">$126,198</span></div><div class="pc-range-track"><div class="pc-range-fill" id="pcrf-bitcoin" style="width:27.1%"></div><div class="pc-range-dot" id="pcrd-bitcoin" style="left:27.1%"></div></div></div></div>
      <div class="pc pc-sm" data-spark="ripple"><div class="pc-head"><span class="pc-name"><span class="pc-name-icon">&#x25CE;</span>XRP</span><span class="pc-contract">USD</span></div><div class="pc-price" id="pc-xrp">--</div><div class="pc-change"><span class="pc-chg-val nc" id="pcc-xrp">--</span></div><div class="pc-prev" id="pcprev-xrp"></div><div class="pc-range"><div class="pc-range-labels"><span id="pcrl-ripple-lo">$1.13</span><span></span><span id="pcrl-ripple-hi">$3.65</span></div><div class="pc-range-track"><div class="pc-range-fill" id="pcrf-ripple" style="width:12.1%"></div><div class="pc-range-dot" id="pcrd-ripple" style="left:12.1%"></div></div></div></div>
    </div>
    <div class="price-cards-grid-2" style="margin-bottom:2rem">
      <div class="pc pc-sm" data-spark="kaspa" style="grid-column:1/-1"><div class="pc-head"><span class="pc-name"><span class="pc-name-icon"><svg class="ic" aria-hidden="true"><use href="#i-gem"/></svg></span>Kaspa</span><span class="pc-contract">USD</span></div><div class="pc-price" id="pc-kas">--</div><div class="pc-change"><span class="pc-chg-val nc" id="pcc-kas">--</span></div><div class="pc-prev" id="pcprev-kas"></div><div class="pc-range"><div class="pc-range-labels"><span id="pcrl-kaspa-lo">$0.014</span><span></span><span id="pcrl-kaspa-hi">$0.131</span></div><div class="pc-range-track"><div class="pc-range-fill" id="pcrf-kaspa" style="width:17.0%"></div><div class="pc-range-dot" id="pcrd-kaspa" style="left:17.0%"></div></div></div></div>
    </div>
  </div>
  <section class="fade-up" id="f-read" aria-labelledby="read-heading">'''
    new_crypto_card = '''  <section class="fade-up" id="f-read" aria-labelledby="read-heading">'''
    data = apply(old_crypto_card, new_crypto_card, "remove now-redundant standalone #f-crypto card")

    # ---- 3. Drought map collapsed by default; radar itself stays baseline
    # size (Sig's pick over shrink/cut). Native <details>, no JS. ----
    old_drought = '''      <div class="radar-sidebar" style="display:flex;flex-direction:column;">
        <div class="drought-embed" style="flex:1;display:flex;flex-direction:column;">
          <div style="padding:.6rem 1rem;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between">
            <span style="font-size:0.77rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--gold)">Drought Monitor</span>
            <a href="/drought-monitor" style="font-size:0.77rem;color:var(--text-muted)">Full Map &rarr;</a>
          </div>
          <a href="https://droughtmonitor.unl.edu" target="_blank" rel="noopener" title="View full interactive drought map" style="flex:1;display:flex;align-items:center;">
            <img id="drought-img" src="" alt="US Drought Monitor &mdash; current week" style="display:block;width:100%;height:auto" loading="lazy">
          </a>
          <div id="drought-fallback" class="drought-fallback" style="display:none">
            <span style="font-size:1.5rem"><svg class="ic" aria-hidden="true"><use href="#i-sun"/></svg></span>
            <span style="font-size:.82rem;color:var(--text-dim)">Drought map loading&hellip;</span>
            <a href="https://droughtmonitor.unl.edu" target="_blank" rel="noopener">View on droughtmonitor.unl.edu &rarr;</a>
          </div>
          <div style="padding:.4rem .8rem;font-size:0.77rem;color:var(--text-muted);text-align:right;border-top:1px solid var(--border)">
            Source: USDA NDMC &middot; Updated Thursday &middot; <a href="https://droughtmonitor.unl.edu" target="_blank" rel="noopener" style="color:var(--gold);text-decoration:underline;">Full Interactive Map &rarr;</a>
          </div>
        </div>
      </div>'''
    new_drought = '''      <div class="radar-sidebar" style="display:flex;flex-direction:column;">
        <!-- 2026-10-01: collapsed by default per Sig's call -- radar itself
             stays full baseline size (his pick over the shrink/cut options),
             but the static drought image doesn't need to be open by default.
             Native <details>, no JS: keyboard- and screen-reader-accessible
             for free, nothing hidden, just closed until asked for. -->
        <details class="drought-embed" style="flex:1;display:flex;flex-direction:column;">
          <summary style="padding:.6rem 1rem;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;cursor:pointer;list-style:none">
            <span style="font-size:0.77rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--gold)">Drought Monitor <small style="font-weight:400;color:var(--text-muted);text-transform:none;letter-spacing:0">&mdash; tap to view</small></span>
            <a href="/drought-monitor" style="font-size:0.77rem;color:var(--text-muted)" onclick="event.stopPropagation()">Full Map &rarr;</a>
          </summary>
          <a href="https://droughtmonitor.unl.edu" target="_blank" rel="noopener" title="View full interactive drought map" style="flex:1;display:flex;align-items:center;">
            <img id="drought-img" src="" alt="US Drought Monitor &mdash; current week" style="display:block;width:100%;height:auto" loading="lazy">
          </a>
          <div id="drought-fallback" class="drought-fallback" style="display:none">
            <span style="font-size:1.5rem"><svg class="ic" aria-hidden="true"><use href="#i-sun"/></svg></span>
            <span style="font-size:.82rem;color:var(--text-dim)">Drought map loading&hellip;</span>
            <a href="https://droughtmonitor.unl.edu" target="_blank" rel="noopener">View on droughtmonitor.unl.edu &rarr;</a>
          </div>
          <div style="padding:.4rem .8rem;font-size:0.77rem;color:var(--text-muted);text-align:right;border-top:1px solid var(--border)">
            Source: USDA NDMC &middot; Updated Thursday &middot; <a href="https://droughtmonitor.unl.edu" target="_blank" rel="noopener" style="color:var(--gold);text-decoration:underline;">Full Interactive Map &rarr;</a>
          </div>
        </details>
      </div>'''
    data = apply(old_drought, new_drought, "collapse drought map into <details>, radar untouched")

    # ---- 4. Weather (Local Conditions, #f2) becomes a second full-width
    # centerpiece, right after Cash Bids -- "bids, weather, news" per Sig.
    # #f1 uses order:-2 (not -1) specifically so it still sorts before #f2
    # despite #f2 being earlier in DOM order; GDU/rainfall accumulation
    # need no separate work, they're already real and already inside #f2. ----
    data = apply(
        '<div class="fade-up" id="f1" style="order:-1;grid-column:1/-1">',
        '<div class="fade-up" id="f1" style="order:-2;grid-column:1/-1">',
        "give Cash Bids a more-negative order than Weather so it still sorts first",
    )
    data = apply(
        '<div class="fade-up" id="f2" style="transition-delay:.08s">',
        '<div class="fade-up" id="f2" style="transition-delay:.08s;order:-1;grid-column:1/-1">',
        "promote Local Conditions (Weather) to a second full-width centerpiece",
    )

    # ---- 5. Hero stack: Wire + harvest bands become collapsed-by-default
    # <details> (native, no JS). News survives -- nothing deleted -- but no
    # longer pushes Cash Bids/Weather down the page. Daily-hero itself was
    # already collapsed (is-brief) before this round and is untouched. ----
    old_bands = '''  <div class="wr fade-up" id="wire-band" hidden>
    <div class="wr-top">
      <div class="wr-k">The wire</div>
      <div class="wr-sub" id="wire-sub"></div>
      <a class="wr-all" href="/news">Everything that moved &rarr;</a>
    </div>
    <div class="wr-g" id="wire-g"></div>
  </div>

  <div class="hbz fade-up" id="harvest-band">
    <div class="hbz-k" id="hbz-kicker">Harvest 2026</div>
    <div class="hbz-g">
      <a class="hbz-c" href="/yield-estimator"><strong>What&rsquo;s the field going to make?</strong><em>Ear and pod counts to bushels</em></a>
      <a class="hbz-c" href="/harvest-price-tracker"><strong>Your harvest price</strong><em>Discovery window, live daily average</em></a>
      <a class="hbz-c" href="/grain-bin-calculator"><strong>Will it fit in the bin?</strong><em>Capacity, shrink, size a new one</em></a>
      <a class="hbz-c" href="/breakeven"><strong>What do I need to sell at?</strong><em>Break-even by the bushel</em></a>
      <a class="hbz-c" href="/storage-crunch"><strong>Store it or move it?</strong><em>Your state&rsquo;s storage squeeze</em></a>
    </div>
  </div>'''
    new_bands = '''  <details class="wr fade-up" id="wire-band" hidden>
    <summary class="wr-summary"><span class="wr-k">The wire</span><span class="wr-sub" id="wire-sub"></span></summary>
    <div class="wr-body">
      <div class="wr-g" id="wire-g"></div>
      <a class="wr-all" href="/news">Everything that moved &rarr;</a>
    </div>
  </details>

  <details class="hbz fade-up" id="harvest-band">
    <summary class="hbz-summary"><span class="hbz-k" id="hbz-kicker">Harvest 2026</span></summary>
    <div class="hbz-g">
      <a class="hbz-c" href="/yield-estimator"><strong>What&rsquo;s the field going to make?</strong><em>Ear and pod counts to bushels</em></a>
      <a class="hbz-c" href="/harvest-price-tracker"><strong>Your harvest price</strong><em>Discovery window, live daily average</em></a>
      <a class="hbz-c" href="/grain-bin-calculator"><strong>Will it fit in the bin?</strong><em>Capacity, shrink, size a new one</em></a>
      <a class="hbz-c" href="/breakeven"><strong>What do I need to sell at?</strong><em>Break-even by the bushel</em></a>
      <a class="hbz-c" href="/storage-crunch"><strong>Store it or move it?</strong><em>Your state&rsquo;s storage squeeze</em></a>
    </div>
  </details>'''
    data = apply(old_bands, new_bands, "wire + harvest bands collapse to <details>")

    data = apply(
        '.hbz-c em{font-style:normal;font-size:.79rem;color:var(--text-muted);line-height:1.45;display:block;margin-top:.12rem}',
        '''.hbz-c em{font-style:normal;font-size:.79rem;color:var(--text-muted);line-height:1.45;display:block;margin-top:.12rem}
.wr>summary,.hbz>summary{cursor:pointer;display:flex;align-items:baseline;gap:.5rem;flex-wrap:wrap;list-style:none;padding:0;min-height:44px}
.wr>summary::-webkit-details-marker,.hbz>summary::-webkit-details-marker{display:none}
.wr>summary::marker,.hbz>summary::marker{content:''}
.wr>summary::after,.hbz>summary::after{content:'+ show';margin-left:auto;font-size:.72rem;color:var(--text-muted);font-family:'JetBrains Mono',monospace;align-self:center}
.wr[open]>summary::after,.hbz[open]>summary::after{content:'- hide'}
.wr[open]>summary{margin-bottom:.55rem}
.hbz[open]>summary{margin-bottom:.55rem}
.wr-body{margin-top:0}
.wr-body .wr-all{display:inline-block;margin:.5rem 0 0;font-size:.8rem;color:var(--gold);text-decoration:none}
.wr-body .wr-all:hover{text-decoration:underline}
@media(max-width:520px){ .wr>summary::after,.hbz>summary::after{font-size:.68rem} }''',
        "disclosure CSS for wire/harvest bands",
    )

    # ---- 6. Mobile Call Scorecard teaser -- mirrors the rail card's hit
    # rate only, same single fetch, no second data source. Hidden >900px
    # (the real breakpoint that governs rail-stacking, per index1's own
    # inline <style>, not any of styles.css's breakpoints). ----
    data = apply(
        '''      </div></div>
    </div>
    <div class="fade-up" id="f3" style="transition-delay:.16s">''',
        '''      </div></div>
    </div>
    <div class="fade-up" id="f-rail-scorecard-teaser">
      <a href="/scorecard" class="rsc-teaser-link" aria-label="AGSIST Call Scorecard — see full record">
        <span class="rsc-teaser-num" id="rsct-hit">&mdash;</span>
        <span class="rsc-teaser-body">
          <span class="rsc-teaser-label">Call Scorecard hit rate<span id="rsct-sample"></span></span>
          <span class="rsc-teaser-cta">Full record &rarr;</span>
        </span>
      </a>
    </div>
    <div class="fade-up" id="f3" style="transition-delay:.16s">''',
        "mobile scorecard teaser markup",
    )
    data = apply(
        '@media(max-width:520px){ .wr>summary::after,.hbz>summary::after{font-size:.68rem} }',
        '''@media(max-width:520px){ .wr>summary::after,.hbz>summary::after{font-size:.68rem} }
.rsc-teaser-link { display: none; align-items: baseline; gap: .6rem; padding: .65rem .9rem; background: var(--surface2); border: 1px solid var(--border); border-radius: var(--r-sm, 8px); text-decoration: none; margin: .5rem 0 }
.rsc-teaser-num { font-family: var(--font-display); font-weight: 700; font-size: 1.5rem; line-height: 1; color: var(--text); flex: none }
.rsc-teaser-body { display: flex; flex-direction: column; gap: .15rem; min-width: 0 }
.rsc-teaser-label { font-size: .76rem; color: var(--text-dim) }
.rsc-teaser-cta { font-size: .72rem; color: var(--gold); font-weight: 600 }
@media (max-width: 900px) { .rsc-teaser-link { display: flex } }''',
        "mobile scorecard teaser CSS",
    )
    data = apply(
        "document.getElementById('rsc-hit').textContent=det.hit_rate.toFixed(1)+'%';",
        "document.getElementById('rsc-hit').textContent=det.hit_rate.toFixed(1)+'%';\n      var rsctHit=document.getElementById('rsct-hit');\n      if(rsctHit)rsctHit.textContent=det.hit_rate.toFixed(1)+'%';",
        "scorecard teaser: mirror hit-rate write",
    )
    data = apply(
        "document.getElementById('rsc-sample').textContent=(det.graded!=null?det.graded:'\\u2014')+' calls graded';",
        "document.getElementById('rsc-sample').textContent=(det.graded!=null?det.graded:'\\u2014')+' calls graded';\n      var rsctSample=document.getElementById('rsct-sample');\n      if(rsctSample)rsctSample.textContent=(det.graded!=null?' (n='+det.graded+')':'');",
        "scorecard teaser: mirror sample-size write",
    )
    data = apply(
        '''    }).catch(function(){
      document.getElementById('rsc-verdict').textContent='Scorecard unavailable right now.';
    });
  })();
  </script>
</aside>''',
        '''    }).catch(function(){
      document.getElementById('rsc-verdict').textContent='Scorecard unavailable right now.';
      var rsctHitErr=document.getElementById('rsct-hit');
      if(rsctHitErr)rsctHitErr.textContent='\\u2014';
    });
  })();
  </script>
</aside>''',
        "scorecard teaser: catch-path fallback",
    )

    # ---- 7. speakable: scorecard hit-rate + trust-ledger citable by answer
    # engines. Reads the live DOM via selector, never a static number copied
    # into JSON-LD (that would go stale the moment either value updates). ----
    data = apply(
        '"speakable": {"@type": "SpeakableSpecification", "cssSelector": [".sec-title", ".pc-price", ".pc-change"]}',
        '"speakable": {"@type": "SpeakableSpecification", "cssSelector": [".sec-title", ".pc-price", ".pc-change", "#rsc-verdict", "#rsc-stats", "#idx1-trust-ledger"]}',
        "speakable: scorecard + trust-ledger selectors",
    )

    # ---- 8. ZIP sync: window.agsistSetZip (geo.js) already existed and
    # already synced Cash Bids -> Weather (bids-homepage.js's lookupBids()
    # already calls it). Weather -> Cash Bids was the one direction that
    # bypassed it, calling loadWeatherZip() directly -- a real one-way-sync
    # bug, not a missing feature. ----
    data = apply(
        '''  var btnWxGo=document.getElementById('btn-wx-go');if(btnWxGo)btnWxGo.addEventListener('click',function(){if(typeof loadWeatherZip==='function')loadWeatherZip();});
  var wxZip=document.getElementById('wx-zip');if(wxZip)wxZip.addEventListener('keydown',function(e){if(e.key==='Enter'&&typeof loadWeatherZip==='function')loadWeatherZip();});''',
        '''  /* 2026-10-01: these two used to call loadWeatherZip() directly, which only
     ever updated the weather pane -- a ZIP typed here never reached Cash
     Bids, even though window.agsistSetZip (geo.js) already exists specifically
     to keep every ZIP box on the page in sync and was already used by the
     Cash Bids -> weather direction (bids-homepage.js's lookupBids()). This
     was a one-way sync, not a missing feature. Routing through the same
     real entry point both ways closes it, and a direct lookupBids() call
     (guarded, real, already wired) forces the bids card to actually reload
     with the synced ZIP rather than only updating the visible field. */
  function wxZipSubmit(){
    var el=document.getElementById('wx-zip');
    var zip=el?el.value.trim():'';
    if(zip.length===5&&!isNaN(zip)&&typeof window.agsistSetZip==='function'){
      window.agsistSetZip(zip);
      if(typeof window.lookupBids==='function')window.lookupBids();
    }else if(typeof loadWeatherZip==='function'){
      loadWeatherZip();
    }
  }
  var btnWxGo=document.getElementById('btn-wx-go');if(btnWxGo)btnWxGo.addEventListener('click',wxZipSubmit);
  var wxZip=document.getElementById('wx-zip');if(wxZip)wxZip.addEventListener('keydown',function(e){if(e.key==='Enter')wxZipSubmit();});''',
        "fix one-way ZIP sync (weather -> bids direction)",
    )

    return data


def apply_round9_build(data: str) -> str:
    """2026-10-01, round 9: a real audit-panel finding fixed (clipped
    price-change text -- handled in components/styles.css, see
    build/patch_styles.py, not here), plus the visual-language pivot Sig
    asked for: 'make it the best, a lot of finer tuning of layout and
    containers... like in the mockup.' Quick Tools was the one section the
    2026-09-30 shell rebuild explicitly left out of the mockup's
    'hairlines, not boxes' rule (a live, data-dense widget set, so it was
    deferred rather than flattened in a rush). Scoped entirely to #f3 --
    .card / .tool-widget-inner / .tool-btn are shared classes used on 10+
    other pages (fertilizer.html, the futures-price pages, etc.), so their
    base rules in components/styles.css are untouched; only this page's own
    copies change.
    """

    def apply(old: str, new: str, label: str) -> str:
        count = data.count(old)
        if count != 1:
            raise AssertionError(f"{label}: found {count} matches, need exactly 1")
        return data.replace(old, new, 1)

    data = apply(
        "/* quick-tools card: pin to top, don't let tool-list stretch (pin so the tool list doesn't stretch) */\n"
        "#f3>.card>.card-body{justify-content:flex-start}\n"
        "#f3 .tool-list{flex:0 0 auto}",
        "/* quick-tools card: pin to top, don't let tool-list stretch (pin so the tool list doesn't stretch) */\n"
        "#f3>.card>.card-body{justify-content:flex-start}\n"
        "#f3 .tool-list{flex:0 0 auto}\n"
        "/* 2026-10-01: visual-language pass -- \"hairlines, not boxes\" everywhere except\n"
        "   the hero row (the mockup's stated rule: a box means \"this is the lead\n"
        "   item\"). Quick Tools was still full boxed-card chrome from the old shell, the\n"
        "   one deferred item from the shell rebuild. Scoped to #f3 only -- .card,\n"
        "   .tool-widget-inner and .tool-btn are shared classes used on 10+ other pages\n"
        "   (fertilizer.html, the futures-price pages, etc.), so the base rules in\n"
        "   components/styles.css are untouched; only this page's own copies change. */\n"
        "#f3>.card{background:transparent;border:none;border-radius:0;border-top:1px solid var(--border);border-bottom:1px solid var(--border);transition:none}\n"
        "#f3>.card:hover{border-color:var(--border)}\n"
        "#f3 .card-body{padding:.3rem 0}\n"
        "#f3 .tool-widget-inner{background:transparent;border:none;border-radius:0;padding:.65rem 0;border-bottom:1px solid var(--border);transition:background .15s}\n"
        "#f3 .tool-widget:hover .tool-widget-inner{background:var(--surface2);border-color:var(--border)}\n"
        "#f3 .tool-btn{background:transparent;border:none;border-radius:0;padding:.55rem 0;border-bottom:1px solid var(--border);transition:background .15s,color .15s}\n"
        "#f3 .tool-btn:hover{background:var(--surface2);border-color:var(--border)}\n"
        "#f3 .spray-windows{border-top:none;padding-top:.2rem}",
        "quick tools: hairline-not-boxed visual pass",
    )

    return data


def apply_round10_build(data: str) -> str:
    """2026-10-01, round 10: the price-alert client widget -- "build the
    watch this elevator and price alert features... and yes i want weather
    and frost alerts please." Watch-this-elevator (any-change) needed no new
    code (see the round-9 writeup); this is the genuinely new piece: a
    user-set target price and direction, one-shot (fires once, clears
    itself), server side in workers/subs-worker.js's WATCH A PRICE TARGET
    block. The id (pid) is derived client-side with the same Math.imul
    FNV-1a scheme as components/bids-homepage.js's widFor() -- plain * would
    silently round once the accumulator exceeds 2^53 mid-string, the exact
    bug that bit the elevator-watch id before it was caught and fixed.
    Placed in the intel rail, after the Call Scorecard section and before
    </aside>, matching the Design-canvas mockup's own rail placement for its
    "Watch this elevator" widget.
    """

    def apply(old: str, new: str, label: str) -> str:
        count = data.count(old)
        if count != 1:
            raise AssertionError(f"{label}: found {count} matches, need exactly 1")
        return data.replace(old, new, 1)

    data = apply(
        '    <p style="font-size:.735rem;color:var(--text-muted);margin:.4rem .1rem 0;line-height:1.45">Every forward call this site\'s own daily briefing makes, graded against the next settlement, misses included. Not a trading signal &mdash; a public record of whether the calls actually played out.</p>\n  </div>\n  <script>\n  (function(){\n    fetch(\'/data/scorecard.json\',{cache:\'no-store\'}).then(function(r){if(!r.ok)throw new Error(\'no-scorecard\');return r.json();}).then(function(d){',
        '    <p style="font-size:.735rem;color:var(--text-muted);margin:.4rem .1rem 0;line-height:1.45">Every forward call this site\'s own daily briefing makes, graded against the next settlement, misses included. Not a trading signal &mdash; a public record of whether the calls actually played out.</p>\n  </div>\n<div class="fade-up" id="f-price-alert">\n    <div class="sec-head"><h2 class="sec-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="width:1.05em;height:1.05em;vertical-align:-.13em;margin-right:.34em;flex:none"><path d="M12 2v20"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>Price Alert &mdash; free</h2></div>\n    <div class="usda-cal-card" style="padding:.85rem 1rem">\n      <p style="font-size:.76rem;color:var(--text-muted);margin:0 0 .6rem;line-height:1.45">Tell us a price, we\'ll email you the day a contract crosses it &mdash; one email, then it clears itself. Not a cash bid at your elevator; check your local basis separately.</p>\n      <div id="pa-form" style="display:flex;flex-direction:column;gap:.45rem">\n        <div style="display:flex;gap:.4rem;flex-wrap:wrap">\n          <select id="pa-symbol" aria-label="Contract" style="flex:1;min-width:120px;padding:.4rem .5rem;background:var(--surface2);border:1px solid var(--border);border-radius:5px;font-size:.76rem;color:var(--text)">\n            <option value="corn">Corn (front month)</option>\n            <option value="corn-dec">Corn (new crop)</option>\n            <option value="beans">Soybeans (front month)</option>\n            <option value="beans-nov">Soybeans (new crop)</option>\n            <option value="wheat">Wheat</option>\n            <option value="cattle">Live Cattle</option>\n          </select>\n          <select id="pa-direction" aria-label="Direction" style="padding:.4rem .5rem;background:var(--surface2);border:1px solid var(--border);border-radius:5px;font-size:.76rem;color:var(--text)">\n            <option value="above">goes above</option>\n            <option value="below">goes below</option>\n          </select>\n        </div>\n        <div style="display:flex;gap:.4rem;align-items:center">\n          <span style="font-family:\'JetBrains Mono\',monospace;font-size:.85rem;color:var(--text-muted)">$</span>\n          <input type="number" id="pa-target" step="0.01" min="0.01" max="1000" placeholder="4.50" aria-label="Target price in dollars" style="flex:1;padding:.4rem .5rem;background:var(--surface2);border:1px solid var(--border);border-radius:5px;font-size:.85rem;font-family:\'JetBrains Mono\',monospace;color:var(--text)">\n        </div>\n        <input type="email" id="pa-email" placeholder="your@email.com" autocomplete="email" aria-label="Email for the alert" style="padding:.4rem .5rem;background:var(--surface2);border:1px solid var(--border);border-radius:5px;font-size:.76rem;color:var(--text)">\n        <button type="button" id="pa-go" style="padding:.5rem .7rem;background:var(--gold);color:#0a0c0d;border:none;border-radius:5px;font-size:.78rem;font-weight:700;cursor:pointer">Set alert &mdash; free</button>\n        <div id="pa-status" style="font-size:.68rem;color:var(--text-muted);min-height:1.1em"></div>\n      </div>\n    </div>\n  </div>\n  <script>\n  (function(){\n    // Same double opt-in shape as "Watch this elevator" (components/homepage-extras.js)\n    // and the county watch -- see workers/subs-worker.js\'s WATCH A PRICE TARGET\n    // block. pid is derived client-side so the worker never has to parse what an\n    // alert means, only store what this page already computed and labeled.\n    var PA_WORKER=\'https://agsist-subs.dnilgis.workers.dev\';\n    var PA_LABELS={\'corn\':\'Corn\',\'corn-dec\':\'Corn (new crop)\',\'beans\':\'Soybeans\',\'beans-nov\':\'Soybeans (new crop)\',\'wheat\':\'Wheat\',\'cattle\':\'Live Cattle\'};\n    // Byte-identical to scripts/send_price_watch.py\'s expectations and to\n    // components/bids-homepage.js\'s widFor() -- FNV-1a 32-bit, Math.imul\n    // required (plain `*` silently rounds once h exceeds 2^53 mid-string,\n    // the exact bug that bit the elevator-watch id before it was fixed).\n    function paId(symbol,direction,targetCents){\n      var s=(symbol+\'|\'+direction+\'|\'+targetCents).toUpperCase();\n      var h=0x811c9dc5;\n      for(var i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,0x01000193); }\n      return (\'00000000\'+(h>>>0).toString(16)).slice(-8);\n    }\n    var sym=document.getElementById(\'pa-symbol\'), dir=document.getElementById(\'pa-direction\'),\n        tgt=document.getElementById(\'pa-target\'), email=document.getElementById(\'pa-email\'),\n        go=document.getElementById(\'pa-go\'), status=document.getElementById(\'pa-status\');\n    if(!go) return;\n    function submit(){\n      var dollars=parseFloat(tgt.value);\n      var addr=(email.value||\'\').trim();\n      if(!(dollars>0&&dollars<=1000&&isFinite(dollars))){\n        status.textContent=\'Enter a target price between $0.01 and $1000.\';\n        status.style.color=\'var(--red,#ef4444)\';\n        return;\n      }\n      if(!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$/.test(addr)){\n        status.textContent=\'Enter a real email address.\';\n        status.style.color=\'var(--red,#ef4444)\';\n        return;\n      }\n      var symbol=sym.value, direction=dir.value;\n      var targetCents=Math.round(dollars*100);\n      var label=(PA_LABELS[symbol]||symbol)+\' \'+(direction===\'above\'?\'above\':\'below\')+\' $\'+dollars.toFixed(2);\n      var pid=paId(symbol,direction,targetCents);\n      go.disabled=true; go.textContent=\'Sending…\'; status.textContent=\'\'; status.style.color=\'var(--text-muted)\';\n      fetch(PA_WORKER+\'/price-watch-subscribe\',{\n        method:\'POST\',\n        headers:{\'Content-Type\':\'application/json\'},\n        body:JSON.stringify({email:addr,pid:pid,symbol:symbol,direction:direction,target_cents:targetCents,label:label})\n      }).then(function(r){ return r.json().catch(function(){ return {}; }); })\n        .then(function(data){\n          if(data&&data.error===\'limit\'){\n            status.textContent=\'You already have 5 price alerts set — the most one address can track at once.\';\n            status.style.color=\'var(--red,#ef4444)\';\n            go.disabled=false; go.textContent=\'Set alert — free\';\n            return;\n          }\n          document.getElementById(\'pa-form\').innerHTML=\'<span style="font-size:.76rem;color:var(--green)">Check your email to confirm — nothing is sent until you do.</span>\';\n        })\n        .catch(function(){\n          status.textContent=\'Could not reach the alert service — try again in a minute.\';\n          status.style.color=\'var(--red,#ef4444)\';\n          go.disabled=false; go.textContent=\'Set alert — free\';\n        });\n    }\n    go.addEventListener(\'click\',submit);\n    [tgt,email].forEach(function(el){ el.addEventListener(\'keydown\',function(e){ if(e.key===\'Enter\') submit(); }); });\n  })();\n  </script>\n  <script>\n  (function(){\n    fetch(\'/data/scorecard.json\',{cache:\'no-store\'}).then(function(r){if(!r.ok)throw new Error(\'no-scorecard\');return r.json();}).then(function(d){',
        "price alert: client widget in the intel rail",
    )

    # The Wire's KIND label map needs the new "weather" kind so an alert item
    # doesn't render with its raw key instead of a human label. news.html
    # carries the identical map and is hand-edited directly (it isn't part of
    # this patch pipeline).
    data = apply(
        "var KIND={usda:'USDA',positioning:'Positioning',board:'Board',crop:'Crop'};",
        "var KIND={usda:'USDA',positioning:'Positioning',board:'Board',crop:'Crop',weather:'Weather'};",
        "wire: weather kind label",
    )

    return data


if __name__ == "__main__":
    main()
