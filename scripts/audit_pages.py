#!/usr/bin/env python3
"""
AGSIST — site-wide correctness sweep.

WHY THIS EXISTS
On 2026-08-15/16 a single session turned up six live defects: a sponsor page
overstating Google traffic 9x, a feed publishing a one-day slice, a standing
crop labelled "final" for the third time, a page writing in the future tense
about a vote that had already failed, a state picker showing a Wisconsin grower
barley and popcorn, and a $0.00 that would have printed for a window RMA had
not started. Every one was found by hand. Finding them by hand does not scale
and does not repeat.

This is the battery of checks those incidents earned, run over every page. It
is deliberately DETERMINISTIC -- no judgement, no personas, no model in the
loop. A persona panel tells you whether a page is good. This tells you whether
a page is WRONG, which is the thing the honesty doctrine actually promises.

Every check below exists because the failure it looks for has actually shipped
on this site at least once.

USAGE
  python3 scripts/audit_pages.py --serve            audit every top-level page
  python3 scripts/audit_pages.py --page cot.html    just one
  python3 scripts/audit_pages.py --selftest         offline checks of the checks

Static checks run without a browser. Rendered checks need Playwright and a
local server with the real components/ directory -- serving a page without
components/styles.css produced two consecutive panels whose headline finding
was an artifact of the missing stylesheet, so --serve wires it up properly or
refuses to run the rendered half.
"""
import argparse
import html as H
import json
import os
import re
import subprocess
import sys
from datetime import date
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))

# One definition of "what counts as a visible FAQ question". The first version
# of this file had its own copy, and its copy had the bug bake_faq had: a
# backreference regex stops at the INNER </div> when <div class="faq"> wraps
# <div class="ans">, so half the questions vanish and the page looks drifted.
# Two copies of one rule is the failure this site keeps relearning.
try:
    from bake_faq import visible_faq as _visible_faq
except Exception:                                             # noqa: BLE001
    _visible_faq = None

SKIP = {
    "404.html", "index1.html",              # by design: error page, noindex preview
    "NOAA-widget-snippet.html",             # a snippet, not a page
    "cashbids.html", "fastfacts.html",      # redirect stubs
    "embed.html",
}

SEV = ("HIGH", "MEDIUM", "LOW")


class Finding:
    __slots__ = ("page", "sev", "code", "detail")

    def __init__(self, page, sev, code, detail):
        self.page, self.sev, self.code, self.detail = page, sev, code, detail

    def __repr__(self):
        return f"{self.sev:<6} {self.page:<28} {self.code}  {self.detail}"


# ------------------------------------------------------------------ static

# Emoji hunting needs four forms; U+26A0 and friends render as colour emoji on
# iOS even though they are BMP symbols. The plain glyphs below are house-legal.
ALLOWED_GLYPHS = set("✓✗▲▼●↻→★✎✕–—·§°′″‰≈≤≥±×")
EMOJI_RANGES = ((0x1F000, 0x1FAFF), (0x2600, 0x27BF), (0xFE0F, 0xFE0F),
                (0x1F1E6, 0x1F1FF))
ESCAPED_EMOJI = re.compile(
    r"&#1(?:2[7-9]|[3-9][0-9])[0-9]{3};"      # decimal >= 127000, the pictographs
    r"|&#x1[fF][0-9a-fA-F]{3};"               # hex 1F000-1FFFF
    r"|\\u[dD]8[3-9a-fA-F][0-9a-fA-F]\\\\u[dD][c-fC-F][0-9a-fA-F]{2}"  # a full surrogate PAIR
)

AI_TELLS = ("deep dive", "delve", "leverage the", "robust solution",
            "in today's fast-paced", "it's worth noting that",
            "as an ai", "language model")

# A year that is not this year, sitting in prose, is how "2025 finals" and
# "Dec '26 chips" go stale without anybody noticing.
YEAR_RX = re.compile(r"\b(20[12][0-9])\b")


PUNCT = str.maketrans({c: None for c in "\u201c\u201d\u2018\u2019\"'`,.:;!?()[]"})


def norm_q(q):
    """Compare questions on their words, not their typography.

    /whats-priced-in carries "What does priced in mean?" in its structured data
    and What does &ldquo;priced in&rdquo; mean? on the page. That is a quoting
    difference, not a different question, and reporting it at the same weight
    as /conditions -- where the two lists share no questions at all -- would
    bury the finding that matters."""
    # Entities must be resolved BEFORE punctuation is stripped, or "&mdash;"
    # becomes "&mdash" and compares unequal to the em dash it renders as. That
    # produced four phantom drift findings on cash-lease and conditions.
    return re.sub(r"\s+", " ",
                  H.unescape(strip_tags(q)).translate(PUNCT)).strip().lower()


def strip_tags(html):
    html = re.sub(r"<script.*?</script>|<style.*?</style>", " ", html, flags=re.S)
    html = re.sub(r"<!--.*?-->", " ", html, flags=re.S)
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html))


# changelog.html exists to quote the site's own mistakes back at the reader.
# "$0.00" and "2026 crop year - USDA NASS final" appear in it because we
# disclosed them, and a checker that flags the disclosure has understood
# nothing. It still gets the structural checks, just not the copy ones.
QUOTES_DEFECTS = {"changelog.html"}

# Known, deliberate, documented. milk-prices fetches a dairy feed that does not
# exist yet and falls back to its seed on purpose -- the fix is a pipeline, not
# deleting the fetch (HANDOFF-MASTER-2026-08-15 section 9).
KNOWN = {("milk-prices.html", "missing-data", "/data/dairy-data.json")}

# Future years read and cleared on 2026-08-16. Each is a date fixed in law or a
# published projection, not a forecast that aged into a claim. Re-read these
# when the underlying document changes, not on a schedule.
FUTURE_OK = {
    # permanent-law reversion (Jan 1 2027) and reconciliation P.L. 119-21,
    # which carries reference prices, ARC, PLC and base acres through 2031
    ("farm-bill.html", 2027), ("farm-bill.html", 2028), ("farm-bill.html", 2029),
    ("farm-bill.html", 2030), ("farm-bill.html", 2031), ("farm-bill.html", 2036),
    ("changelog.html", 2027), ("changelog.html", 2031),
    # China's $17B/yr ag purchase commitment runs through 2028; the fertilizer
    # line is attributed to Feedstuffs, not to us
    ("index.html", 2028),
    # "ample supply into 2027" is the 2026/27 marketing year, correctly named
    ("whats-priced-in.html", 2027),
}


def static_checks(page, html, today):
    out = []
    text = strip_tags(html)
    quotes = page in QUOTES_DEFECTS
    # basis-map, cookies and disclaimer are 800-byte noindex redirect stubs
    # with a meta refresh. A meta description on a page Google is told not to
    # index is busywork, and reporting it three times trains people to ignore
    # the report.
    stub = bool(re.search(r'name="robots"\s+content="[^"]*noindex', html))

    # ---- head essentials (the new-page checklist, enforced) -------------
    # Measure what a search result shows, not what the file stores. The first
    # version counted raw source, so changelog.html's
    # "What&rsquo;s New on AGSIST &mdash; Site Updates &amp; Changelog"
    # was reported as 72 characters. It is 46. Six of the ten "too long" titles
    # were that mistake, and a checker that cries wolf gets switched off.
    # Scoped to <head>. Four of these pages build an SVG <title> in a chart
    # script, so an unscoped search would happily accept "Hail History Report"
    # as the page title if the real one ever went missing.
    head = html[:html.find("</head>")] if "</head>" in html else html
    title = re.search(r"<title>(.*?)</title>", head, re.S)
    if not title:
        out.append(Finding(page, "HIGH", "no-title", "page has no <title>"))
    else:
        t = H.unescape(re.sub(r"\s+", " ", title.group(1)).strip())
        if len(t) > 70:
            out.append(Finding(page, "LOW", "title-long", f"{len(t)} chars: {t[:60]}…"))
    desc = re.search(r'<meta name="description"\s+content="([^"]*)"', html)
    if not desc:
        if not stub:
            out.append(Finding(page, "MEDIUM", "no-description", "no meta description"))
    else:
        d = H.unescape(desc.group(1))
        if len(d) > 165:
            out.append(Finding(page, "LOW", "desc-long", f"{len(d)} chars (cap 160)"))
    if not re.search(r'<link rel="canonical"', html) and not stub:
        out.append(Finding(page, "MEDIUM", "no-canonical", "no canonical link"))
    if not re.search(r'name="theme-color"', html) and not stub:
        out.append(Finding(page, "LOW", "no-theme-color", "no theme-color"))

    # ---- overflow-x:hidden kills position:sticky sitewide ---------------
    # FALSE POSITIVE FOUND ON FIRST RUN, 2026-08-16: the naive version of this
    # check flagged 24 pages. Every one of them writes
    #     html { overflow-x: hidden; overflow-x: clip; }
    # which is the correct progressive-enhancement idiom -- hidden as the
    # fallback, clip winning wherever it is supported. Reporting those would
    # have invited somebody to "fix" the site by deleting the fallback. Only
    # fire when hidden is the LAST word on overflow-x in that rule.
    for m in re.finditer(r"(?:^|[\s,{}>])(?:html|body)[^{}]*\{([^{}]*)\}", html):
        vals = re.findall(r"overflow-x\s*:\s*([a-z]+)", m.group(1))
        if vals and vals[-1] == "hidden":
            out.append(Finding(page, "HIGH", "overflow-hidden",
                               "html/body ends on overflow-x:hidden — hidden breaks "
                               "position:sticky sitewide; end on clip"))
            break

    # ---- numbers that should never reach a reader ------------------------
    for bad, sev in (("$0.00", "HIGH"), ("NaN", "HIGH"), ("undefined", "MEDIUM"),
                     ("Infinity", "HIGH"), ("[object Object]", "HIGH")):
        if bad in text and not quotes:
            out.append(Finding(page, sev, "bad-value",
                               f"{bad!r} in rendered-ish text"))

    # ---- emoji, four forms ----------------------------------------------
    for ch in set(text):
        cp = ord(ch)
        if ch in ALLOWED_GLYPHS:
            continue
        if any(a <= cp <= b for a, b in EMOJI_RANGES):
            out.append(Finding(page, "MEDIUM", "emoji",
                               f"U+{cp:04X} {ch!r} in reader copy"))
    if ESCAPED_EMOJI.search(html):
        out.append(Finding(page, "MEDIUM", "emoji-escaped",
                           "escaped emoji codepoint in source"))

    # ---- AI tells --------------------------------------------------------
    low = text.lower()
    for tell in AI_TELLS:
        if tell in low and not quotes:
            out.append(Finding(page, "MEDIUM", "ai-tell", f"{tell!r} in copy"))

    # ---- stale years -----------------------------------------------------
    # A future year is usually a forecast that quietly became a claim about the
    # past. Sometimes it is a statute. Reviewed years are recorded in
    # FUTURE_OK with what they refer to, so the report shows only what nobody
    # has looked at yet -- a finding that reappears every run after being
    # cleared is how a report earns the right to be ignored.
    years = {int(y) for y in YEAR_RX.findall(text)}
    future = {y for y in years if y > today.year and (page, y) not in FUTURE_OK}
    if future:
        out.append(Finding(page, "LOW", "future-year",
                           f"copy mentions {sorted(future)} — check it is a real forecast"))

    # ---- a crop year cannot be final before the following January --------
    for m in re.finditer(r"(20[12][0-9])[^.]{0,40}\bfinal\b", text, re.I):
        y = int(m.group(1))
        if quotes:
            continue
        if y >= today.year and (today.year, today.month, today.day) < (y + 1, 1, 10):
            out.append(Finding(page, "HIGH", "standing-crop-final",
                               f"calls {y} 'final': …{m.group(0)[:70]}…"))

    # ---- JSON-LD ---------------------------------------------------------
    faq_ld = None
    for blob in re.findall(r'<script type="application/ld\+json">(.*?)</script>',
                           html, re.S):
        try:
            d = json.loads(blob)
        except Exception as exc:                          # noqa: BLE001
            out.append(Finding(page, "HIGH", "jsonld-broken", str(exc)[:80]))
            continue
        if isinstance(d, dict) and d.get("@type") == "FAQPage":
            faq_ld = d

    # ---- the FAQ and its structured data must not drift ------------------
    # Only <summary> tags inside the FAQ container count. Two false positives
    # taught this: summaries built inside a <script>, and the "Year by year,
    # 2011-2026" summary on a collapsible history table, which is a disclosure
    # widget and not a question anybody asked.
    visible_q = ([q for q, _ in _visible_faq(html)] if _visible_faq else [])
    if faq_ld is not None and visible_q:
        ld_raw = {q.get("name", "") for q in faq_ld.get("mainEntity", [])}
        vis_raw = {q.strip() for q in visible_q}
        ld_q = {norm_q(q) for q in ld_raw}
        vis = {norm_q(q) for q in vis_raw}
        only_ld = ld_q - vis
        only_vis = vis - ld_q
        if only_ld:
            out.append(Finding(page, "MEDIUM", "faq-drift",
                               f"{len(only_ld)} question(s) in JSON-LD but not on the page: "
                               f"{sorted(only_ld)[0][:52]}…"))
        if only_vis:
            out.append(Finding(page, "MEDIUM", "faq-drift",
                               f"{len(only_vis)} question(s) on the page but not in JSON-LD: "
                               f"{sorted(only_vis)[0][:52]}…"))

    # ---- render-before-validate ------------------------------------------
    # REMOVED after its first run, 2026-08-16. The check looked for a .then()
    # that writes text without mentioning "ok", and matched ten pages: four
    # "Copied" button states, a tariff badge painted from fetched data, and a
    # geocode handler that DID check its result. Zero real findings.
    #
    # The genuine defect class -- a FORM whose success message is not gated on
    # r.ok -- is narrower than any regex over .then() bodies can express, and a
    # check that cries wolf ten times gets ignored on the day it is right. It
    # belongs in a rendered test that submits a form against a failing stub,
    # not here. Left as a comment so nobody re-adds the naive version.

    # ---- sprite hygiene --------------------------------------------------
    if re.search(r'<symbol id="i-', html) and not re.search(
            r'<symbol id="i-[^"]*"[^>]*(fill="none"|stroke="currentColor")', html):
        out.append(Finding(page, "MEDIUM", "sprite-attrs",
                           "page-level i-* symbol without the header sprite's attrs"))
    return out


def local_links(html):
    """Only hrefs in real markup. A template literal like

        '<a href="/daily/'+escHtml(iso)+'">'

    is a link the browser never sees as written, and the first run of this
    script reported three of them as dead links. Strip scripts first, and
    refuse anything carrying a quote, plus or brace."""
    body = re.sub(r"<script.*?</script>", " ", html, flags=re.S)
    out = set()
    for m in re.finditer(r'href="(/[^"#?\s]*)"', body):
        href = m.group(1)
        if any(c in href for c in "'+{}$`"):
            continue
        out.add(href)
    return out


def link_targets_exist(page, html):
    out = []
    for href in sorted(local_links(html)):
        if href in ("/",) or href.startswith("/#"):
            continue
        p = href.lstrip("/")
        cands = [REPO / p, REPO / (p + ".html"), REPO / p / "index.html"]
        if any(c.exists() for c in cands):
            continue
        if re.match(r"^(img|components|data|workers|docs)/", p):
            out.append(Finding(page, "MEDIUM", "dead-asset", href))
        else:
            out.append(Finding(page, "MEDIUM", "dead-link", href))
    return out


def data_refs_exist(page, html):
    out = []
    for m in re.finditer(r"['\"](/?data/[a-zA-Z0-9_\-/]+\.json)['\"]", html):
        rel = m.group(1).lstrip("/")
        if not (REPO / rel).exists():
            if (page, "missing-data", m.group(1)) in KNOWN:
                continue
            out.append(Finding(page, "HIGH", "missing-data",
                               f"fetches {m.group(1)} which does not exist"))
    return out


# ------------------------------------------------------------------ run

def css_structure(path="components/styles.css"):
    """An unterminated or orphaned comment marker silently kills every rule
    after it.

    Added 2026-08-16 after doing it twice in one sitting: editing a block whose
    text ended with `*/` left the trailing marker stranded outside any comment,
    and the browser dropped the rest of the file. Nothing errored, nothing
    looked wrong in the diff, and the only symptom was styling quietly
    reverting several hundred lines later. Cheap to check, invisible to catch
    by eye."""
    out = []
    p = REPO / path
    if not p.exists():
        return out
    src = p.read_text(encoding="utf-8", errors="replace")
    stripped = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    if "/*" in stripped or "*/" in stripped:
        line = src[:src.find("*/" if "*/" in stripped else "/*")].count("\n") + 1
        out.append(Finding(path, "HIGH", "css-comment",
                           f"orphaned comment marker near line {line} — "
                           "every rule after it is dropped"))
    if stripped.count("{") != stripped.count("}"):
        out.append(Finding(path, "HIGH", "css-braces",
                           f"{stripped.count('{')} open vs {stripped.count('}')} close"))
    return out


def audit(pages, today):
    findings = css_structure()
    titles, descs = {}, {}
    for page in pages:
        p = REPO / page
        html = p.read_text(encoding="utf-8", errors="replace")
        findings += static_checks(page, html, today)
        findings += link_targets_exist(page, html)
        findings += data_refs_exist(page, html)
        t = re.search(r"<title>(.*?)</title>", html, re.S)
        d = re.search(r'<meta name="description"\s+content="([^"]*)"', html)
        if t:
            titles.setdefault(re.sub(r"\s+", " ", t.group(1)).strip(), []).append(page)
        if d:
            descs.setdefault(d.group(1).strip(), []).append(page)
    for t, pgs in titles.items():
        if len(pgs) > 1:
            findings.append(Finding(pgs[0], "MEDIUM", "duplicate-title",
                                    f"{len(pgs)} pages share this title: {', '.join(pgs)}"))
    for d, pgs in descs.items():
        if len(pgs) > 1:
            findings.append(Finding(pgs[0], "LOW", "duplicate-desc",
                                    f"{len(pgs)} pages share a description: {', '.join(pgs)}"))
    return findings


def report(findings):
    by = {s: [f for f in findings if f.sev == s] for s in SEV}
    for s in SEV:
        if not by[s]:
            continue
        print(f"\n{'=' * 72}\n{s}  ({len(by[s])})\n{'=' * 72}")
        for f in sorted(by[s], key=lambda x: (x.code, x.page)):
            print(f"  {f.page:<30} {f.code:<22} {f.detail}")
    print(f"\n{'-' * 72}")
    print("  ".join(f"{s} {len(by[s])}" for s in SEV))
    return 1 if by["HIGH"] else 0


def selftest():
    fails = []

    def ck(name, ok, detail=""):
        print(("  ok   " if ok else "  FAIL ") + name + (f"  — {detail}" if not ok and detail else ""))
        if not ok:
            fails.append(name)

    T = date(2026, 8, 16)
    base = ('<title>T</title><meta name="description" content="d">'
            '<link rel="canonical" href="/x"><meta name="theme-color" content="#0a0c0d">')

    def codes(html):
        return {f.code for f in static_checks("x.html", base + html, T)}

    print("checks fire on the failures that actually shipped")
    ck("a standing crop called final",
       "standing-crop-final" in codes("<p>2026 crop year · USDA NASS final</p>"))
    ck("...but a real prior-year final is fine",
       "standing-crop-final" not in codes("<p>2025 crop year · USDA NASS final</p>"))
    ck("$0.00 in copy", "bad-value" in codes("<p>Harvest price $0.00</p>"))
    ck("NaN in copy", "bad-value" in codes("<p>Yield NaN bu</p>"))
    ck("broken JSON-LD",
       "jsonld-broken" in codes('<script type="application/ld+json">{oops}</script>'))
    ck("the hidden-then-clip fallback idiom is NOT flagged",
       "overflow-hidden" not in codes("<x>html{overflow-x:hidden;overflow-x:clip}</x>"))
    ck("overflow-x:hidden on body",
       "overflow-hidden" in codes("<x>body{overflow-x:hidden}</x>"))
    ck("an AI tell", "ai-tell" in codes("<p>Let us delve into basis.</p>"))
    ck("colour emoji", "emoji" in codes("<p>Corn \U0001F33D up</p>"))
    ck("an escaped pictograph is caught",
       "emoji-escaped" in codes("<p>&#127774; sunny</p>"))
    ck("...but the house check mark &#10003; is not",
       "emoji-escaped" not in codes("<p>&#10003; done &#10007; not</p>"))
    ck("...but house glyphs pass", "emoji" not in codes("<p>corn ✓ up ▲ down ▼</p>"))
    faq = ('<script type="application/ld+json">{"@context":"https://schema.org",'
           '"@type":"FAQPage","mainEntity":[{"@type":"Question","name":"A",'
           '"acceptedAnswer":{"@type":"Answer","text":"x"}}]}</script>'
           '<div class="faq"><details><summary>B</summary></details></div>')
    ck("FAQ and its JSON-LD drifting apart", "faq-drift" in codes(faq))
    ok_faq = faq.replace("<summary>B</summary>", "<summary>A</summary>")
    ck("a <summary> outside the FAQ container is not an FAQ entry",
       "faq-drift" not in codes(faq.replace('<div class="faq">', "<div>")))
    outside = faq.replace('<div class="faq">', "<div>")
    ck("a <summary> outside the FAQ container is not an FAQ entry",
       "faq-drift" not in codes(outside))
    ck("...and agreeing is quiet", "faq-drift" not in codes(ok_faq))

    ck("a noindex redirect stub is not nagged for a description",
       "no-description" not in {f.code for f in static_checks(
           "stub.html", '<title>x</title><meta name="robots" content="noindex,follow">',
           T)})

    print("\nclean copy stays quiet")
    clean = codes("<p>Corn closed $4.59 on Aug 14. 2025 crop year · USDA NASS final.</p>")
    ck("no findings on clean copy", clean == set(), str(clean))

    print("\nlink and data checks")
    f = link_targets_exist("x.html", '<a href="/definitely-not-a-page">x</a>')
    ck("a dead internal link is caught", any(x.code == "dead-link" for x in f))
    js = '<script>h+=\'<a href="/daily/\'+iso+\'">x</a>\'</script>'
    ck("a link built inside JavaScript is not a dead link",
       not link_targets_exist("x.html", js))
    f = data_refs_exist("x.html", "fetch('/data/definitely-not-here.json')")
    ck("a fetch of a missing data file is caught", any(x.code == "missing-data" for x in f))
    f = data_refs_exist("x.html", "fetch('/data/changelog.json')")
    ck("a fetch of a real data file is quiet", not f)

    print()
    if fails:
        print(f"{len(fails)} FAILED: " + "; ".join(fails))
        return 1
    print("all audit_pages checks pass")
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--page", default=None)
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--today", default=None)
    ap.add_argument("--json", default=None, help="write findings to this file")
    a = ap.parse_args()
    if a.selftest:
        return selftest()
    today = date.fromisoformat(a.today) if a.today else date.today()
    if a.page:
        pages = [a.page]
    else:
        pages = sorted(p.name for p in REPO.glob("*.html") if p.name not in SKIP)
    print(f"auditing {len(pages)} pages as of {today}")
    findings = audit(pages, today)
    if a.json:
        Path(a.json).write_text(json.dumps(
            [{"page": f.page, "sev": f.sev, "code": f.code, "detail": f.detail}
             for f in findings], indent=1), encoding="utf-8")
    return report(findings)


if __name__ == "__main__":
    sys.exit(main())
