#!/usr/bin/env python3
"""
seo_opportunities.py - the weekly "what to fix" list for search.

Reads data/site-usage.json (Search Console, 90 days, per page: clicks,
impressions, CTR, average position, top queries) and each page's current
<title> and meta description, and writes data/seo-opportunities.json, which
/seo-report renders (noindex, in no sitemap).

Three lists:

  1. CTR gaps. Pages at average position POS_MIN-POS_MAX with at least
     MIN_IMPRESSIONS impressions whose CTR is under GAP_RATIO of the expected
     CTR for that position (EXPECTED_CTR below). Ranked by estimated missed
     clicks = impressions x (expected CTR - actual CTR). For each: the top
     queries by impressions, the current title and description, and the words
     of the top three queries (GAP_WORD_MIN+ impressions) the title lacks.
  2. Queries to strengthen. Queries ranking at position 8-20 with at least
     STRENGTHEN_MIN impressions: on page one's edge or page two, where a
     better page moves the most.
  3. Zero-click pages. At least ZERO_MIN impressions and no clicks.

THE EXPECTED-CTR CURVE IS A ROUGH BENCHMARK, NOT A TARGET. It is a smoothed
reading of published organic CTR-by-position studies (blended desktop and
mobile, all query types). Real CTR at a given position swings with the query:
price and date queries often get answered on the results page itself, brand
queries click far more. Missed clicks are therefore an estimate of the gap to
an average page, labelled as such everywhere they are shown, and only good
for ranking pages against each other. Average position is impression-weighted
across every query a page shows for, so a page "at 8" may be at 3 for one
query and 40 for another.

Search Console only returns the top 10 queries for a page and hides rare ones
for privacy, so a page's listed queries can cover a small part of its
impressions. The file says how much (queryShare).

    python3 scripts/seo_opportunities.py             # write the file
    python3 scripts/seo_opportunities.py --print     # write and print a summary
    python3 scripts/seo_opportunities.py --selftest
"""
import json
import os
import re
import sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import check_seo  # noqa: E402

USAGE = "data/site-usage.json"
OUT = "data/seo-opportunities.json"

# (position, expected CTR). Linear between points; flat past the ends.
EXPECTED_CTR = [
    (1, 0.28), (2, 0.16), (3, 0.11), (4, 0.08), (5, 0.06), (6, 0.05),
    (7, 0.04), (8, 0.032), (9, 0.026), (10, 0.022), (12, 0.015), (15, 0.01),
    (20, 0.006),
]
POS_MIN, POS_MAX = 3.0, 20.0
MIN_IMPRESSIONS = 500
GAP_RATIO = 0.5            # "well below" = under half the benchmark
TOP_OPPS = 25
STRENGTHEN_POS = (8.0, 20.0)
STRENGTHEN_MIN = 50
ZERO_MIN = 100
QUERIES_SHOWN = 5
GAP_WORD_MIN = 10          # a query needs this many impressions to count toward the title-gap flag

STOP = set("""a an and are as at be by can do does for from how i in is it its
me my near of on or the this to vs what when where which who why will with
you your today now""".split())
BRAND = ("agsist",)


def expected_ctr(pos):
    pts = EXPECTED_CTR
    if pos <= pts[0][0]:
        return pts[0][1]
    for (p0, c0), (p1, c1) in zip(pts, pts[1:]):
        if pos <= p1:
            return c0 + (c1 - c0) * (pos - p0) / (p1 - p0)
    return pts[-1][1]


def junk_query(q):
    """Operator searches, pasted questions and bare numbers say nothing about
    what a title should say."""
    q = q.strip()
    if any(ch in q for ch in '"%+') or "site:" in q:
        return True
    if re.fullmatch(r"[\d\s.,-]+", q):
        return True
    if len(q.split()) > 9:
        return True
    return any(b in q.lower() for b in BRAND)


def words(s):
    return [w for w in re.findall(r"[a-z0-9]+", s.lower())]


def stem(w):
    if len(w) > 4 and w.endswith("ies"):
        return w[:-3] + "y"
    if len(w) > 4 and w.endswith(("sses", "xes", "ches", "shes")):
        return w[:-2]
    if len(w) > 3 and w.endswith("s") and not w.endswith("ss"):
        return w[:-1]
    return w


def missing_words(queries, title):
    have = {stem(w) for w in words(title)}
    miss = []
    for q in queries:
        for w in words(q):
            if w in STOP or len(w) < 3 and not w.isdigit():
                continue
            if stem(w) not in have and w not in miss:
                miss.append(w)
    return miss


def page_file(path, root=ROOT):
    p = path.strip("/")
    for c in ([p + ".html", p + "/index.html"] if p else ["index.html"]):
        if os.path.isfile(os.path.join(root, c)):
            return c
    return None


def build(usage, root=ROOT, now=None):
    gsc = (usage or {}).get("gsc")
    if not gsc or not gsc.get("pages"):
        return None
    pages = gsc["pages"]
    meta = {}

    def page_meta(path):
        if path not in meta:
            f = page_file(path, root)
            if not f:
                meta[path] = {"file": None, "title": None, "description": None}
            else:
                i = check_seo.inspect(root, f)
                meta[path] = {"file": f, "title": (i["titles"] or [None])[0],
                              "description": i["desc"], "noindex": i["noindex"]}
        return meta[path]

    opps = []
    for path, v in pages.items():
        imp, clicks, pos = v.get("impressions") or 0, v.get("clicks") or 0, v.get("position")
        if pos is None or not (POS_MIN <= pos <= POS_MAX) or imp < MIN_IMPRESSIONS:
            continue
        ctr = clicks / imp if imp else 0
        exp = expected_ctr(pos)
        if ctr >= GAP_RATIO * exp:
            continue
        qs = sorted(v.get("topQueries") or [], key=lambda q: -(q.get("impressions") or 0))
        good = [q for q in qs if not junk_query(q["query"])]
        m = page_meta(path)
        top3 = [q["query"] for q in good[:3] if (q.get("impressions") or 0) >= GAP_WORD_MIN]
        opps.append({
            "page": path,
            "file": m["file"],
            "impressions": imp,
            "clicks": clicks,
            "ctr": round(ctr, 4),
            "position": pos,
            "expectedCtr": round(exp, 4),
            "estMissedClicks": round(imp * (exp - ctr)),
            "queryShare": round(sum(q.get("impressions") or 0 for q in qs) / imp, 3) if imp else 0,
            "topQueries": [{k: q.get(k) for k in ("query", "impressions", "clicks", "position")}
                           for q in good[:QUERIES_SHOWN]],
            "junkQueries": len(qs) - len(good),
            "title": m["title"],
            "description": m["description"],
            "titleMissing": missing_words(top3, m["title"] or "") if m["title"] else [],
        })
    opps.sort(key=lambda o: -o["estMissedClicks"])

    strengthen = []
    for path, v in pages.items():
        for q in v.get("topQueries") or []:
            p = q.get("position")
            if (p is not None and STRENGTHEN_POS[0] <= p <= STRENGTHEN_POS[1]
                    and (q.get("impressions") or 0) >= STRENGTHEN_MIN and not junk_query(q["query"])):
                strengthen.append({"query": q["query"], "page": path, "impressions": q["impressions"],
                                   "clicks": q.get("clicks") or 0, "position": p})
    strengthen.sort(key=lambda s: -s["impressions"])

    zero = []
    for path, v in pages.items():
        if (v.get("clicks") or 0) == 0 and (v.get("impressions") or 0) >= ZERO_MIN:
            qs = sorted(v.get("topQueries") or [], key=lambda q: -(q.get("impressions") or 0))
            zero.append({"page": path, "impressions": v["impressions"], "position": v.get("position"),
                         "title": page_meta(path)["title"],
                         "topQueries": [q["query"] for q in qs if not junk_query(q["query"])][:3]})
    zero.sort(key=lambda z: -z["impressions"])

    return {
        "schema": "agsist-seo-opportunities/1",
        "generated": (now or datetime.now(timezone.utc)).replace(microsecond=0).isoformat(),
        "source": {"file": USAGE, "generated": usage.get("generated"),
                   "start": gsc.get("start"), "end": gsc.get("end"),
                   "clicks": (gsc.get("totals") or {}).get("clicks"),
                   "impressions": (gsc.get("totals") or {}).get("impressions")},
        "method": {
            "expectedCtr": [{"position": p, "ctr": c} for p, c in EXPECTED_CTR],
            "expectedCtrNote": ("A rough benchmark smoothed from published organic CTR-by-position "
                                "studies. Real CTR varies a lot by query type. Missed clicks are an "
                                "estimate of the gap to an average page, for ranking only."),
            "positionRange": [POS_MIN, POS_MAX], "minImpressions": MIN_IMPRESSIONS,
            "gapRatio": GAP_RATIO, "strengthenPosition": list(STRENGTHEN_POS),
            "strengthenMinImpressions": STRENGTHEN_MIN, "zeroClickMinImpressions": ZERO_MIN,
            "queriesNote": ("Search Console returns at most 10 queries per page and hides rare "
                            "ones; queryShare is the share of the page's impressions they cover. "
                            "Operator searches, pasted questions, bare numbers and brand "
                            "searches are left out of the lists."),
        },
        "opportunities": opps[:TOP_OPPS],
        "strengthen": strengthen[:40],
        "zeroClick": zero[:40],
    }


def write(payload, root=ROOT):
    with open(os.path.join(root, OUT), "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=1, ensure_ascii=False)
        fh.write("\n")


def summary(p):
    out = [f"SEO opportunities from Search Console {p['source']['start']} to {p['source']['end']}"]
    out.append("CTR gaps (est. missed clicks = impressions x (benchmark CTR - actual), a rough estimate):")
    for o in p["opportunities"][:10]:
        out.append(f"  {o['page']:32s} pos {o['position']:4.1f}  {o['impressions']:6d} impr  "
                   f"CTR {o['ctr'] * 100:.2f}% vs ~{o['expectedCtr'] * 100:.1f}%  "
                   f"est. missed ~{o['estMissedClicks']}"
                   + (f"  title lacks: {', '.join(o['titleMissing'][:5])}" if o["titleMissing"] else ""))
    out.append(f"Queries at position 8-20: {len(p['strengthen'])}; zero-click pages: {len(p['zeroClick'])}")
    return "\n".join(out)


def main():
    try:
        usage = json.load(open(os.path.join(ROOT, USAGE), encoding="utf-8"))
    except (OSError, ValueError) as e:
        print(f"[seo-opps] cannot read {USAGE}: {type(e).__name__}; nothing written")
        return 0
    p = build(usage)
    if p is None:
        print(f"[seo-opps] {USAGE} has no Search Console block ({usage.get('gscReason')}); nothing written")
        return 0
    write(p)
    print(f"[seo-opps] wrote {OUT}: {len(p['opportunities'])} CTR gaps, "
          f"{len(p['strengthen'])} queries to strengthen, {len(p['zeroClick'])} zero-click pages")
    if "--print" in sys.argv:
        print(summary(p))
    return 0


def selftest():
    import tempfile
    fails = []

    def ok(c, m):
        if not c:
            fails.append(m)

    ok(abs(expected_ctr(7) - 0.04) < 1e-9, "curve point")
    ok(abs(expected_ctr(7.5) - 0.036) < 1e-9, "curve interpolates")
    ok(expected_ctr(50) == 0.006 and expected_ctr(0.5) == 0.28, "curve flat past the ends")
    ok(junk_query('"monthly for lemons" "quick stats lite"'), "quoted query is junk")
    ok(junk_query("46776") and junk_query("agsist"), "numbers and brand are junk")
    ok(not junk_query("wasde report dates 2026"), "real query kept")
    ok(missing_words(["wasde report dates 2026"], "Next WASDE: Nov 10, 2026 | USDA Report Calendar")
       == ["dates"], "missing words, case-insensitive")
    ok(missing_words(["grain bin calculators"], "Grain Bin Calculator") == [], "plural matches singular")
    ok(missing_words(["cbot soybean price"], "CBOT Soybean Futures: Live Prices") == [], "prices matches price")
    ok(missing_words(["usda report dates"], "USDA Report Calendar") == ["dates"], "missing word reported as typed")

    with tempfile.TemporaryDirectory() as d:
        os.makedirs(os.path.join(d, "rent"))
        open(os.path.join(d, "cal.html"), "w").write(
            '<html><head><title>USDA Report Calendar | AGSIST</title>'
            '<meta name="description" content="Every report."></head></html>')
        open(os.path.join(d, "rent", "index.html"), "w").write("<html><head><title>Rent</title></head></html>")
        usage = {"generated": "2026-10-10", "gsc": {"start": "2026-07-10", "end": "2026-10-07",
                 "totals": {"clicks": 100, "impressions": 30000}, "pages": {
            "/cal": {"clicks": 10, "impressions": 10000, "position": 7.0, "topQueries": [
                {"query": "usda report calendar", "impressions": 50, "clicks": 1, "position": 9},
                {"query": "cocoa cot", "impressions": 3, "clicks": 0, "position": 4},
                {"query": "wasde report dates", "impressions": 400, "clicks": 2, "position": 6},
                {"query": '"quick stats lite"', "impressions": 900, "clicks": 0, "position": 5}]},
            "/rent": {"clicks": 400, "impressions": 10000, "position": 7.0, "topQueries": []},
            "/far": {"clicks": 0, "impressions": 9000, "position": 35.0, "topQueries": []},
            "/tiny": {"clicks": 0, "impressions": 200, "position": 5.0, "topQueries": []},
        }}}
        p = build(usage, root=d, now=datetime(2026, 10, 11, tzinfo=timezone.utc))
        o = p["opportunities"]
        ok([x["page"] for x in o] == ["/cal"], f"only the low-CTR page in range: {[x['page'] for x in o]}")
        c = o[0]
        ok(c["estMissedClicks"] == 390, f"missed clicks = 10000 x (0.04 - 0.001): {c['estMissedClicks']}")
        ok(c["topQueries"][0]["query"] == "wasde report dates", "queries sorted by impressions")
        ok(c["junkQueries"] == 1 and len(c["topQueries"]) == 3, "junk query dropped")
        ok(c["titleMissing"] == ["wasde", "dates"], f"title gap words: {c['titleMissing']}")
        ok(c["title"] == "USDA Report Calendar | AGSIST" and c["description"] == "Every report.", "title read")
        ok(c["queryShare"] == 0.135, f"query share: {c['queryShare']}")
        ok([s["query"] for s in p["strengthen"]] == ["usda report calendar"], f"strengthen: {p['strengthen']}")
        ok([z["page"] for z in p["zeroClick"]] == ["/far", "/tiny"], f"zero-click: {p['zeroClick']}")
        ok(build({"gsc": None}, root=d) is None, "no gsc block: nothing")
    if fails:
        print("SELFTEST FAIL")
        for f in fails:
            print("  -", f)
        return 1
    print("selftest ok")
    return 0


if __name__ == "__main__":
    sys.exit(selftest() if "--selftest" in sys.argv else main())
