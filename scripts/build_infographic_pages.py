#!/usr/bin/env python3
"""build_infographic_pages.py: the Infographic of the Week pages, from the specs in data/infographics/.

OFFLINE. Reads committed files only. MACHINE-OWNED: edit this script, never infographic/*.html. Built on main
(infographic-pages.yml when a spec lands; scripts/generated_sets.py set "infographic"); a pull request carries
this builder and its fixture tests, never the pages.

READS   data/infographics/<yyyy-mm-dd>.json   one spec each (scripts/build_infographic.py writes them)
        cot.html                              only the ?v= of the shared files it loads (styles, loader, share kit,
                                              QR), so these pages load the same copies
WRITES  infographic/<yyyy-mm-dd>.html         the hook as title and H1, the big number, the link preview picture,
                                              the chart as a table, the facts with source and date, the sources
                                              (collapsed), the share and print buttons (components/infographic.js),
                                              links to the related page and the last 4 infographics; ImageObject,
                                              Dataset and BreadcrumbList JSON-LD; og:image = the link preview card
        infographic/og/<yyyy-mm-dd>.jpg       that card, 1200 x 630 (scripts/share_cards.py, look C)
        infographic/index.html                the archive, newest first (noindex while it is empty)
        infographic/_indexable.txt            the paths for the sitemap (the workflow adds them)
A page whose spec is gone is removed. A file is written only when its bytes change.

RULES: a spec is checked before a page is made (keys, a hook of at most 60 characters, a source and a date on
every fact, no em dash); one bad spec fails the build and names the file. Nothing on a page is computed here but
the layout: every number comes from the spec.

  python3 scripts/build_infographic_pages.py
  python3 scripts/build_infographic_pages.py --root DIR --out DIR     (tests: a fixture data folder)
  python3 scripts/build_infographic_pages.py --no-images              (pages only, no card drawing)
  python3 scripts/build_infographic_pages.py --selftest
"""
import hashlib
import html
import json
import os
import re
import sys

try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = "https://agsist.com"
SPECS = os.path.join("data", "infographics")
OUT = "infographic"
JS_V = "1"          # components/infographic.js?v=
CSS_V = "1"         # infographic/infographic.css?v=
LAST_N = 4
DATE_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})\.json$")
PAGE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}\.html$")
MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
RELATED = {"/conditions": "Crop progress, size and yield", "/cot": "Fund positions (COT)"}
SHARED = {"styles.css": "28", "loader.js": "19", "share-kit.js": "1", "share-kit.css": "1", "qr.js": "11"}


class BadSpec(Exception):
    pass


def esc(s):
    return html.escape(str(s if s is not None else ""), quote=True)


def mdy(iso):
    y, m, d = iso[:10].split("-")
    return "%s %d, %s" % (MON[int(m) - 1], int(d), y)


def fmt(n):
    return ("−" if n < 0 else "") + "{:,}".format(abs(int(n))) if isinstance(n, (int, float)) else esc(n)


def versions(root):
    """the ?v= of the shared files, from cot.html (the share kit's first page)"""
    out = dict(SHARED)
    try:
        src = open(os.path.join(root, "cot.html"), encoding="utf-8").read()
    except OSError:
        return out
    for name in out:
        m = re.search(r"/components/%s\?v=([\w.-]+)" % re.escape(name), src)
        if m:
            out[name] = m.group(1)
    return out


def check(spec, fname):
    need = ("date", "slug", "kind", "title", "big", "chart", "facts", "sources", "topic", "related_page")
    miss = [k for k in need if k not in spec]
    if miss:
        raise BadSpec("%s: missing %s" % (fname, ", ".join(miss)))
    if spec["date"] + ".json" != fname:
        raise BadSpec("%s: its date is %s" % (fname, spec["date"]))
    if not spec["title"] or len(spec["title"]) > 60:
        raise BadSpec("%s: the hook must be 1 to 60 characters" % fname)
    if "—" in json.dumps(spec, ensure_ascii=False):
        raise BadSpec("%s: an em dash" % fname)
    if not spec["facts"] or any(not f.get("source") or not f.get("date") or not f.get("text") for f in spec["facts"]):
        raise BadSpec("%s: every fact needs text, a source and a date" % fname)
    if any(f["date"] > spec["date"] for f in spec["facts"]):
        raise BadSpec("%s: a fact dated after the infographic" % fname)
    if not spec["sources"] or any(not s.get("name") or not s.get("period") for s in spec["sources"]):
        raise BadSpec("%s: every source needs a name and a period" % fname)
    t = spec["chart"].get("type")
    if t == "bars":
        if not spec["chart"].get("panels") or any(not p.get("rows") for p in spec["chart"]["panels"]):
            raise BadSpec("%s: a bars chart needs panels with rows" % fname)
    elif t == "line":
        if len(spec["chart"].get("points") or []) < 2:
            raise BadSpec("%s: a line chart needs 2 points or more" % fname)
    else:
        raise BadSpec("%s: chart type %r" % (fname, t))
    return spec


def load(root):
    d = os.path.join(root, SPECS)
    out = []
    if not os.path.isdir(d):
        return out
    for f in sorted(os.listdir(d)):
        if DATE_RE.match(f):
            try:
                spec = json.load(open(os.path.join(d, f), encoding="utf-8"))
            except ValueError as e:
                raise BadSpec("%s: %s" % (f, e))
            out.append(check(spec, f))
    out.sort(key=lambda s: s["date"], reverse=True)
    return out


# ── the share card (og:image) ──────────────────────────────────────────────
def card(spec):
    import share_cards as SC
    ch, b = spec["chart"], spec["big"]
    big = fmt(b["value"]) + ("%" if b["unit"] == "%" else "")
    if ch["type"] == "bars":
        pan, hi = ch["panels"][0], set(ch.get("highlight") or [])
        rows = sorted(pan["rows"], key=lambda r: (r["values"][0] - r["values"][1], r["label"]))[:5]
        pic = ("hbars", {"rows": [(r["label"], max(1, r["values"][0]), "%d vs %d" % tuple(r["values"][:2]), r["key"] in hi) for r in rows]})
        cap = pan["title"].replace(" by state,", ", % vs 5-yr avg,")
    else:
        pts = ch["points"]
        pic = ("line", {"values": [p["y"] for p in pts], "big": big, "big_label": b["unit"],
                        "start_label": pts[0]["label"], "end_label": pts[-1]["label"]})
        cap = ch["title"]
    meta = "Source: %s  \u00b7  Infographic of the Week, %s" % (spec["sources"][0]["name"], mdy(spec["date"]))
    return SC.card_c([(spec["title"], False)], meta, cap, pic)


# ── page parts ─────────────────────────────────────────────────────────────
def chrome():
    try:
        import inject_static_nav as NAV
        return NAV.block("header"), NAV.block("footer"), NAV.FONT_BLOCK
    except Exception:  # pragma: no cover
        return "", "", ""


def head(title, desc, path, og, og_alt, jsonld, indexable, v, fonts, extra=""):
    robots = "index,follow" if indexable else "noindex,follow"
    ld = "\n".join('<script type="application/ld+json">%s</script>' % json.dumps(j, ensure_ascii=False).replace("</", "<\\/") for j in jsonld)
    return f"""<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="theme-color" content="#0a0c0d">
  <script>/* agsist-theme-early: saved theme, else the device's, set before first paint so pages do not flash the wrong color. loader.js applies the same rule. */try{{var _t=localStorage.getItem('agsist-theme');if(_t!=='light'&&_t!=='dark')_t=window.matchMedia&&matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';document.documentElement.setAttribute('data-theme',_t);}}catch(e){{}}</script><script>/* agsist-ga-guard 2026-10-20b: rules in /components/ga-gate.js */(function(w,d,n){{var off=false,i,s,u;w.dataLayer=w.dataLayer||[];if(typeof w.gtag!=='function'){{w.gtag=function(){{w.dataLayer.push(arguments);}};}}try{{off=w.localStorage.getItem('agsist-ga-off')==='1';}}catch(e){{}}if(n.globalPrivacyControl===true){{off=true;}}u=n.userAgent||'';if(n.webdriver===true||(/HeadlessChrome|PhantomJS|Lighthouse|bot|crawler|spider/i.test(u)&&!/cubot/i.test(u))){{off=true;}}w.agsistGaOff=off;w.gtag('set','allow_google_signals',false);w.gtag('set','allow_ad_personalization_signals',false);if(off){{return;}}i=function(){{if(s||d.prerendering){{return;}}s=d.createElement('script');s.src='/components/ga-gate.js?v=1';(d.head||d.documentElement).appendChild(s);}};['scroll','pointerdown','keydown','touchstart'].forEach(function(t){{w.addEventListener(t,i,{{capture:true,passive:true}});}});}})(window,document,navigator);</script>
  <script>window.dataLayer=window.dataLayer||[];function gtag(){{dataLayer.push(arguments);}}gtag('js',new Date());gtag('config','G-6KXCTD5Z9H');function gaEvent(n,p){{try{{gtag('event',n,p||{{}});}}catch(e){{}}}}</script>
  {fonts}
  <link rel="preload" href="/components/styles.css?v={v['styles.css']}" as="style">
  <link rel="stylesheet" href="/components/styles.css?v={v['styles.css']}">
  <link rel="stylesheet" href="/infographic/infographic.css?v={CSS_V}">{extra}
  <link rel="icon" href="/img/favicon.ico" sizes="32x32">
  <link rel="icon" type="image/svg+xml" href="/img/icon.svg">
  <link rel="apple-touch-icon" href="/img/apple-touch-icon.png">
  <link rel="manifest" href="/manifest.json">
  <title>{esc(title)}</title>
  <meta name="description" content="{esc(desc)}">
  <meta name="robots" content="{robots}">
  <link rel="canonical" href="{SITE}{path}">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="AGSIST">
  <meta property="og:locale" content="en_US">
  <meta property="og:title" content="{esc(title)}">
  <meta property="og:description" content="{esc(desc)}">
  <meta property="og:url" content="{SITE}{path}">
  <meta property="og:image" content="{esc(og)}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="{esc(og_alt)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:site" content="@agsist">
  <meta name="twitter:title" content="{esc(title)}">
  <meta name="twitter:description" content="{esc(desc)}">
  <meta name="twitter:image" content="{esc(og)}">
{ld}
</head>"""


def chart_html(spec):
    ch = spec["chart"]
    hi = set(ch.get("highlight") or [])
    if ch["type"] == "bars":
        out = []
        for p in ch["panels"]:
            rows = "".join(
                '<tr%s><td>%s</td><td class="n">%s%%</td><td class="n">%s%%</td><td class="n">%s</td>'
                '<td><span class="ig-meter" aria-hidden="true"><i style="width:%s%%"></i><u style="left:%s%%"></u></span></td></tr>' % (
                    ' class="hi"' if r["key"] in hi else "", esc(r["label"]), r["values"][0], r["values"][1],
                    fmt(r["values"][0] - r["values"][1]) if r["values"][0] != r["values"][1] else "0",
                    max(0, min(100, r["values"][0])), max(0, min(100, r["values"][1])))
                for r in p["rows"])
            out.append('<h2>%s</h2><div class="ig-scroll"><table class="ig-t"><thead><tr><th>State</th><th class="n">%s</th>'
                       '<th class="n">%s</th><th class="n">Points</th><th>Bar: %s, line: average</th></tr></thead><tbody>%s</tbody></table></div>' % (
                           esc(p["title"]), esc(ch["series"][0]), esc(ch["series"][1]), esc(ch["series"][0]), rows))
        return "\n".join(out)
    rows = "".join('<tr%s><td>%s</td><td class="n">%s</td></tr>' % (' class="hi"' if i in hi else "", esc(mdy(p["x"])), fmt(p["y"]))
                   for i, p in enumerate(ch["points"]))
    split = ch.get("split")
    note = ""
    if split:
        note = '<p class="ig-sub">The last week: longs %s, shorts %s%s.</p>' % (
            fmt(split["long_change"]) if split["long_change"] < 0 else "+" + fmt(split["long_change"]),
            fmt(split["short_change"]) if split["short_change"] < 0 else "+" + fmt(split["short_change"]),
            (", " + esc(split["label"])) if split.get("label") else "")
    return ('<h2>%s</h2><div class="ig-scroll"><table class="ig-t"><thead><tr><th>%s</th><th class="n">%s</th></tr></thead>'
            '<tbody>%s</tbody></table></div>%s' % (esc(ch["title"]), esc(ch["axis"]["x"]), esc(ch["axis"]["y"]), rows, note))


def jsonld(spec, og, path):
    url = SITE + path
    names = [s["name"] for s in spec["sources"]]
    desc = " ".join(f["text"] for f in spec["facts"])
    return [
        {"@context": "https://schema.org", "@type": "ImageObject", "contentUrl": og.split("?")[0], "url": url,
         "width": 1200, "height": 630, "caption": spec["title"], "datePublished": spec["date"],
         "creditText": "AGSIST, from " + "; ".join(names), "creator": {"@type": "Organization", "name": "AGSIST", "url": SITE}},
        {"@context": "https://schema.org", "@type": "Dataset", "name": spec["title"], "description": desc,
         "url": url, "datePublished": spec["date"], "temporalCoverage": spec.get("data_date") or spec["date"],
         "creator": {"@type": "Organization", "name": "AGSIST", "url": SITE},
         "isBasedOn": [{"@type": "CreativeWork", "name": "%s (%s)" % (s["name"], s["period"])} for s in spec["sources"]],
         "isAccessibleForFree": True,
         "distribution": [{"@type": "DataDownload", "encodingFormat": "application/json",
                           "contentUrl": "%s/data/infographics/%s.json" % (SITE, spec["date"])}]},
        {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "AGSIST", "item": SITE + "/"},
            {"@type": "ListItem", "position": 2, "name": "Infographic of the Week", "item": SITE + "/infographic/"},
            {"@type": "ListItem", "position": 3, "name": spec["title"], "item": url}]},
    ]


def page(spec, specs, og, v, parts):
    hdr, ftr, fonts = parts
    path = "/infographic/" + spec["date"]
    b = spec["big"]
    big = fmt(b["value"]) + ("%" if b["unit"] == "%" else " " + esc(b["unit"]))
    desc = "%s, %s. %s" % (spec["title"], mdy(spec["date"]), " ".join(f["text"] for f in spec["facts"][:2]))
    if len(desc) > 300:
        desc = desc[:297].rsplit(" ", 1)[0] + "..."
    facts = "".join("<li>%s <small>%s, %s.</small></li>" % (esc(f["text"]), esc(f["source"]), esc(mdy(f["date"]))) for f in spec["facts"])
    srcs = "".join("<li>%s: %s.</li>" % (esc(s["name"]), esc(s["period"])) for s in spec["sources"])
    others = [s for s in specs if s["date"] != spec["date"]][:LAST_N]
    more = "".join('<li><a href="/infographic/%s">%s</a><time datetime="%s">%s</time></li>' % (s["date"], esc(s["title"]), s["date"], mdy(s["date"])) for s in others)
    rel = spec["related_page"]
    spec_json = json.dumps(spec, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    extra = '\n  <link rel="stylesheet" href="/components/share-kit.css?v=%s">' % v["share-kit.css"]
    body = f"""
<body>
<div id="site-header">{hdr}</div>
<main class="ig-wrap" id="main">
  <p class="ig-sub" style="margin-top:14px"><a href="/infographic/" style="color:var(--text-muted)">Infographic of the Week</a> &rsaquo; <b style="color:var(--text)">{esc(mdy(spec["date"]))}</b></p>
  <h1>{esc(spec["title"])}</h1>
  <div class="ig-big"><b>{big}</b><span>{esc(b["label"])}</span></div>
  <img class="ig-img" src="{esc(og)}" width="1200" height="630" alt="{esc(spec["title"])}: {esc(b["label"])}">
  <div class="ig-tools" id="ig-tools" hidden>
    <button type="button" id="ig-pic">Save the phone picture</button>
    <button type="button" id="ig-wide">Save the wide picture</button>
    <button type="button" id="ig-print">Print the sheet</button>
    <button type="button" id="ig-link">Copy link</button>
  </div>
  <p class="ig-st" id="ig-st" aria-live="polite"></p>
  <h2>The facts</h2>
  <ul class="ig-facts">{facts}</ul>
  {chart_html(spec)}
  <details><summary>Sources</summary><ul>{srcs}</ul><p>Facts from the sources above and plain arithmetic on them; no forecast and no advice.</p></details>
  <p class="ig-links ig-sub">Related: <a href="{esc(rel)}">{esc(RELATED.get(rel, rel))}</a> &middot; <a href="/infographic/">Every infographic</a></p>
  {('<h2>Recent infographics</h2><ul class="ig-list">' + more + '</ul>') if more else ''}
</main>
<div id="site-footer">{ftr}</div>
<script type="application/json" id="ig-spec">{spec_json}</script>
<script src="/components/share-kit.js?v={v['share-kit.js']}" defer></script>
<script src="/components/qr.js?v={v['qr.js']}" defer></script>
<script src="/components/infographic.js?v={JS_V}" defer></script>
<script src="/components/loader.js?v={v['loader.js']}" defer></script>
</body>
</html>
"""
    return head(spec["title"] + " | AGSIST", desc, path, og, spec["title"], jsonld(spec, og, path), True, v, fonts, extra) + body


def archive(specs, ogs, v, parts):
    hdr, ftr, fonts = parts
    path = "/infographic/"
    title = "Infographic of the Week: farm numbers in one picture | AGSIST"
    desc = "One farm number a week in one picture, from USDA, CFTC and other public sources, with the source and date on every fact. Save it, send it or print it."
    if specs:
        items = "".join(
            '<li><a href="/infographic/%s">%s</a><time datetime="%s">%s</time></li>' % (s["date"], esc(s["title"]), s["date"], mdy(s["date"]))
            for s in specs)
        lst = '<ul class="ig-list">%s</ul>' % items
        og = ogs[specs[0]["date"]]
        alt = specs[0]["title"]
    else:
        lst = '<p class="ig-sub">No infographic is posted yet.</p>'
        og = SITE + "/img/og/agsist.jpg"
        alt = "AGSIST"
    ld = [{"@context": "https://schema.org", "@type": "CollectionPage", "name": "Infographic of the Week", "url": SITE + path,
           "description": desc, "hasPart": [{"@type": "CreativeWork", "name": s["title"], "url": SITE + "/infographic/" + s["date"],
                                             "datePublished": s["date"]} for s in specs[:20]]}]
    body = f"""
<body>
<div id="site-header">{hdr}</div>
<main class="ig-wrap" id="main">
  <h1>Infographic of the Week</h1>
  <p class="ig-sub">One farm number a week in one picture. Every fact carries its source and date. Newest first.</p>
  {lst}
</main>
<div id="site-footer">{ftr}</div>
<script src="/components/loader.js?v={v['loader.js']}" defer></script>
</body>
</html>
"""
    return head(title, desc, path, og, alt, ld, bool(specs), v, fonts) + body


def write(path, data, wrote):
    mode = "wb" if isinstance(data, bytes) else "w"
    try:
        old = open(path, "rb" if mode == "wb" else "r", **({} if mode == "wb" else {"encoding": "utf-8"})).read()
    except OSError:
        old = None
    if old == data:
        return
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, mode, **({} if mode == "wb" else {"encoding": "utf-8"})) as fh:
        fh.write(data)
    wrote.append(path)


def build_all(root=ROOT, out=None, images=True, parts=None):
    out = out or os.path.join(root, OUT)
    specs = load(root)
    v = versions(root)
    parts = parts if parts is not None else chrome()
    wrote, ogs = [], {}
    for s in specs:
        jp = os.path.join(out, "og", s["date"] + ".jpg")
        if images:
            write(jp, card(s), wrote)
        h = hashlib.sha1(open(jp, "rb").read()).hexdigest()[:8] if os.path.exists(jp) else "0"
        ogs[s["date"]] = "%s/infographic/og/%s.jpg?v=%s" % (SITE, s["date"], h)
    keep = set()
    for s in specs:
        p = os.path.join(out, s["date"] + ".html")
        keep.add(s["date"])
        write(p, page(s, specs, ogs[s["date"]], v, parts), wrote)
    write(os.path.join(out, "index.html"), archive(specs, ogs, v, parts), wrote)
    write(os.path.join(out, "_indexable.txt"), "".join("/infographic/%s\n" % s["date"] for s in specs) + ("/infographic/\n" if specs else ""), wrote)
    removed = []
    if os.path.isdir(out):
        for f in os.listdir(out):
            if PAGE_RE.match(f) and f[:-5] not in keep:
                os.remove(os.path.join(out, f)); removed.append(f)
        od = os.path.join(out, "og")
        for f in (os.listdir(od) if os.path.isdir(od) else []):
            if f.endswith(".jpg") and f[:-4] not in keep:
                os.remove(os.path.join(od, f)); removed.append("og/" + f)
    return specs, wrote, removed


def selftest():
    import shutil
    import tempfile
    ok = True

    def ck(name, cond):
        nonlocal ok
        print(("ok   " if cond else "FAIL ") + name)
        ok = ok and bool(cond)

    d = tempfile.mkdtemp()
    os.makedirs(os.path.join(d, SPECS))
    base = {"slug": "x", "kind": "funds-corn", "title": "Funds' corn net down 450 contracts in 4 weeks",
            "big": {"value": 50, "unit": "contracts net long", "label": "Managed money in corn futures"},
            "chart": {"type": "line", "title": "Net", "unit": "contracts", "axis": {"x": "Week", "y": "Net"}, "series": ["Net"],
                      "points": [{"x": "2026-10-27", "label": "Oct 27", "y": 200}, {"x": "2026-11-03", "label": "Nov 3", "y": 50}],
                      "highlight": [0, 1]},
            "facts": [{"text": "Net down 150.", "source": "CFTC", "date": "2026-11-03"}],
            "sources": [{"name": "CFTC", "url": "", "period": "Nov 3, 2026"}], "topic": "grain", "related_page": "/cot"}
    for dt in ("2026-11-06", "2026-11-13"):
        s = dict(base, date=dt)
        json.dump(s, open(os.path.join(d, SPECS, dt + ".json"), "w"))
    specs, wrote, _ = build_all(d, images=False, parts=("", "", ""))
    ck("two pages, newest first", [s["date"] for s in specs] == ["2026-11-13", "2026-11-06"])
    pg = open(os.path.join(d, OUT, "2026-11-06.html"), encoding="utf-8").read()
    ck("title is the hook", "<title>Funds&#x27; corn net down 450 contracts in 4 weeks | AGSIST</title>" in pg)
    ck("one H1", pg.count("<h1>") == 1)
    ck("links the newer one", 'href="/infographic/2026-11-13"' in pg)
    ck("ImageObject and Dataset", '"@type": "ImageObject"' in pg and '"@type": "Dataset"' in pg)
    ck("no em dash", "—" not in pg)
    os.remove(os.path.join(d, SPECS, "2026-11-13.json"))
    _, _, removed = build_all(d, images=False, parts=("", "", ""))
    ck("a page whose spec is gone is removed", removed == ["2026-11-13.html"])
    json.dump(dict(base, date="2026-11-20", title="x" * 61), open(os.path.join(d, SPECS, "2026-11-20.json"), "w"))
    try:
        build_all(d, images=False, parts=("", "", ""))
        ck("a long hook fails the build", False)
    except BadSpec:
        ck("a long hook fails the build", True)
    shutil.rmtree(d)
    return 0 if ok else 1


def main(argv):
    if "--selftest" in argv:
        return selftest()
    root, out = ROOT, None
    if "--root" in argv:
        root = argv[argv.index("--root") + 1]
    if "--out" in argv:
        out = argv[argv.index("--out") + 1]
    try:
        specs, wrote, removed = build_all(root, out, images="--no-images" not in argv)
    except BadSpec as e:
        print("refused: %s" % e)
        return 1
    print("infographic: %d spec(s); wrote %d file(s); removed %d" % (len(specs), len(wrote), len(removed)))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
