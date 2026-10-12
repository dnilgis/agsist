#!/usr/bin/env python3
"""
stamp_prf.py — write the facts /prf prints in its HTML from data/prf/meta.json.

WHY THIS EXISTS
  prf.html says the sign-up date, the billing date, the subsidy rates, how many
  grids and years it covers and how the last check against RMA went. A crawler
  and a reader without JavaScript see only the HTML, so those have to be in the
  HTML; and they are USDA's facts, which change every crop year. One copy of
  each fact lives in data/prf/ (scripts/fetch_prf.py, scripts/check_prf_rma.mjs).
  This copies them into the page between markers:

      <!--prf:sales_long-->Dec 1, 2026<!--/prf:sales_long-->

  It also writes the meta descriptions and the JSON-LD. The FAQPage JSON-LD is
  built from the visible FAQ on the page, after stamping, so the two cannot
  drift. The data-deadlines attribute of a reminder ask is stamped too, when
  the page carries one (it does not yet: the subs worker only takes arcplc:
  and rent: topics).

  SOME OF THE PAGE IS ABOUT ONE CROP YEAR AND CANNOT BE STAMPED
  "What changed for 2027" is prose about 2027's rules. It carries
  data-prf-written-for="2027". When the crop year in data/prf/meta.json moves
  on, this script stops and names that section, so the data cannot roll to
  2028 under a paragraph that still describes 2027. Rewrite the section, set
  the attribute to the new year, run again.

  Idempotent. A marker the page uses and this script does not know stops the
  run, and so does a marker this script knows and the page lacks.

USAGE
  python scripts/stamp_prf.py            # write prf.html
  python scripts/stamp_prf.py --check    # exit 1 if prf.html is not what this would write
  python scripts/stamp_prf.py --selftest
"""

import html
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGE = os.path.join(ROOT, "prf.html")
META = os.path.join(ROOT, "data", "prf", "meta.json")
CHECK = os.path.join(ROOT, "data", "prf", "check.json")
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
URL = "https://agsist.com/prf"
TITLE = "PRF Insurance Calculator: Every Year Since {y0} | AGSIST"
DESC = ("See what a Pasture, Rangeland, Forage rainfall policy would have paid in every year since {y0} "
        "for your grid and intervals. {cy} rates. Sign-up closes {sales_short}.")


def long_date(iso):
    y, m, d = iso.split("-")
    return f"{MONTHS[int(m) - 1]} {int(d)}, {y}"


def short_date(iso):
    _, m, d = iso.split("-")
    return f"{MONTHS[int(m) - 1]} {int(d)}"


def pct(x):
    v = x * 100
    if abs(v - round(v)) > 1e-9:
        raise ValueError(f"subsidy {x} is not a whole percent")
    return int(round(v))


def subsidy_sentence(sub):
    """'59% at the 70% and 75% coverage levels, 55% at 80% and 85%, and 51% at 90%'"""
    groups = []
    for cov in sorted(sub, key=int):
        p = pct(sub[cov])
        if groups and groups[-1][0] == p:
            groups[-1][1].append(cov)
        else:
            groups.append((p, [cov]))
    parts = []
    for i, (p, covs) in enumerate(groups):
        levels = " and ".join(c + "%" for c in covs) if len(covs) <= 2 else ", ".join(c + "%" for c in covs[:-1]) + " and " + covs[-1] + "%"
        parts.append(f"{p}% at {'the ' if i == 0 else ''}{levels}{' coverage level' + ('s' if len(covs) > 1 else '') if i == 0 else ''}")
    return parts[0] if len(parts) == 1 else ", ".join(parts[:-1]) + ", and " + parts[-1]


def check_sentence(chk):
    """What the last run against RMA's tool found. Says so when nothing was reached."""
    if not chk:
        return ""
    day = long_date(chk["checked"][:10])
    if not chk.get("reached"):
        return f"RMA&rsquo;s tool did not answer the check on {day}, so that refresh was not checked."
    n, a = chk["reached"], chk["agreed"]
    noun = "policy" if n == 1 else "policies"
    return (f"Last checked against RMA&rsquo;s own tool on {day}: {a} of {n} {noun} priced here matched it to the dollar.")


def values(meta, chk):
    d, y = meta["dates"], meta["years"]
    for k in ("sales_closing", "acreage_reporting", "premium_billing"):
        if not d.get(k):
            raise ValueError(f"meta.json has no {k} date")
    sub = meta["subsidy"]
    rows = "".join(f'<tr><th scope="row">{c}%</th><td>{pct(sub[c])}%</td><td>{100 - pct(sub[c])}%</td></tr>'
                   for c in sorted(sub, key=int))
    built = meta["built"][:10]
    return {
        "crop_year": str(meta["crop_year"]),
        "y0": str(y["first"]), "y1": str(y["last_complete"]),
        "nyears": str(y["last_complete"] - y["first"] + 1),
        "sales_short": short_date(d["sales_closing"]), "sales_long": long_date(d["sales_closing"]),
        "acreage_long": long_date(d["acreage_reporting"]),
        "billing_short": short_date(d["premium_billing"]), "billing_long": long_date(d["premium_billing"]),
        "grids": f"{meta['counts']['grids']:,}", "counties": f"{meta['counts']['counties']:,}",
        "states": str(meta["counts"]["states"]),
        "built": f'<time datetime="{built}">Data read {long_date(built)}</time>',
        "subsidy_rows": rows, "subsidy_sentence": subsidy_sentence(sub),
        "check": check_sentence(chk),
        "_sales_iso": d["sales_closing"],
    }


def text_of(fragment):
    t = re.sub(r"<!--.*?-->", "", fragment, flags=re.S)
    t = re.sub(r"<[^>]+>", "", t)
    return re.sub(r"\s+", " ", html.unescape(t)).strip()


def faq_pairs(page):
    m = re.search(r"<!--prf:faq-->(.*?)<!--/prf:faq-->", page, flags=re.S)
    if not m:
        raise ValueError("prf.html has no <!--prf:faq--> block")
    pairs = re.findall(r"<details><summary>(.*?)</summary>(.*?)</details>", m.group(1), flags=re.S)
    if len(pairs) < 3:
        raise ValueError(f"only {len(pairs)} questions found in the FAQ block")
    return [(text_of(q), text_of(a)) for q, a in pairs]


def jsonld(page, v):
    desc = DESC.format(y0=v["y0"], cy=v["crop_year"], sales_short=v["sales_short"])
    blocks = [
        {"@context": "https://schema.org", "@type": "WebApplication", "@id": URL + "#app",
         "name": "PRF rainfall index calculator: every year on record", "url": URL,
         "applicationCategory": "FinanceApplication", "operatingSystem": "Any",
         "offers": {"@type": "Offer", "price": "0", "priceCurrency": "USD"}, "description": desc,
         "publisher": {"@type": "Organization", "name": "AGSIST", "url": "https://agsist.com/"}},
        {"@context": "https://schema.org", "@type": "FAQPage",
         "mainEntity": [{"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}}
                        for q, a in faq_pairs(page)]},
        {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Home", "item": "https://agsist.com/"},
            {"@type": "ListItem", "position": 2, "name": "Tools", "item": "https://agsist.com/tools"},
            {"@type": "ListItem", "position": 3, "name": "PRF rainfall insurance", "item": URL}]},
    ]
    return "".join('<script type="application/ld+json">' + json.dumps(b, ensure_ascii=False).replace("</", "<\\/") + "</script>"
                   for b in blocks)


def stamp(page, meta, chk):
    v = values(meta, chk)
    used = set(re.findall(r"<!--prf:([a-z0-9_]+)-->", page))
    known = set(k for k in v if not k.startswith("_")) | {"faq"}
    if used - known:
        raise ValueError(f"prf.html uses markers this script does not fill: {sorted(used - known)}")
    if known - used:
        raise ValueError(f"prf.html lacks markers this script fills: {sorted(known - used)}")
    for k, val in v.items():
        if k.startswith("_"):
            continue
        page, n = re.subn(rf"<!--prf:{k}-->.*?<!--/prf:{k}-->", lambda m, val=val, k=k: f"<!--prf:{k}-->{val}<!--/prf:{k}-->",
                          page, flags=re.S)
        if not n:
            raise ValueError(f"marker {k} was not found twice-tagged (open and close)")
    page, n = re.subn(r'data-deadlines="[^"]*"', f'data-deadlines="{v["_sales_iso"]}"', page)
    if n > 1:
        raise ValueError(f"expected at most one data-deadlines attribute, found {n}")
    for yr in re.findall(r'data-prf-written-for="(\d{4})"', page):
        if yr != v["crop_year"]:
            raise ValueError(f"prf.html has a section written for crop year {yr} and the data is crop year {v['crop_year']}: "
                             "rewrite that section, then set its data-prf-written-for")
    desc = html.escape(DESC.format(y0=v["y0"], cy=v["crop_year"], sales_short=v["sales_short"]), quote=True)
    if len(html.unescape(desc)) > 160:
        raise ValueError(f"description is {len(html.unescape(desc))} characters")
    for pat in (r'(<meta name="description" content=")[^"]*(")', r'(<meta property="og:description" content=")[^"]*(")',
                r'(<meta name="twitter:description" content=")[^"]*(")'):
        page, n = re.subn(pat, lambda m: m.group(1) + desc + m.group(2), page)
        if n != 1:
            raise ValueError(f"expected one match for {pat}, found {n}")
    title = TITLE.format(y0=v["y0"])
    page, n = re.subn(r"<title>.*?</title>", f"<title>{title}</title>", page, flags=re.S)
    if n != 1:
        raise ValueError("expected one <title>")
    page, n = re.subn(r"<!-- prf:jsonld -->.*?<!-- /prf:jsonld -->",
                      lambda m: "<!-- prf:jsonld -->" + jsonld(page, v) + "<!-- /prf:jsonld -->", page, flags=re.S)
    if n != 1:
        raise ValueError("expected one <!-- prf:jsonld --> block")
    return page


def selftest():
    fails = []

    def ok(c, what):
        if not c:
            fails.append(what)
            print("  FAIL", what)

    meta = {"crop_year": 2027, "built": "2026-10-12T02:30:00Z",
            "years": {"first": 1951, "last_complete": 2025, "open": {}},
            "dates": {"sales_closing": "2026-12-01", "acreage_reporting": "2026-12-01", "premium_billing": "2027-09-01"},
            "subsidy": {"70": 0.59, "75": 0.59, "80": 0.55, "85": 0.55, "90": 0.51},
            "counts": {"grids": 13414, "counties": 3070, "states": 48}}
    v = values(meta, None)
    ok(v["sales_long"] == "Dec 1, 2026" and v["sales_short"] == "Dec 1" and v["billing_long"] == "Sep 1, 2027", "dates")
    ok(v["nyears"] == "75" and v["grids"] == "13,414", "counts")
    ok(v["subsidy_sentence"] == "59% at the 70% and 75% coverage levels, 55% at 80% and 85%, and 51% at 90%", v["subsidy_sentence"])
    ok(subsidy_sentence({"70": 0.6, "75": 0.6, "80": 0.6, "85": 0.6, "90": 0.6}) == "60% at the 70%, 75%, 80%, 85% and 90% coverage levels", "one rate")
    ok('<td>51%</td><td>49%</td>' in v["subsidy_rows"], "rows")
    ok(check_sentence(None) == "", "no check file")
    ok("did not answer" in check_sentence({"checked": "2026-10-12T02:40:00Z", "reached": 0, "agreed": 0}), "nothing reached is said")
    ok(check_sentence({"checked": "2026-10-12T02:40:00Z", "reached": 12, "agreed": 12}).endswith(
        "12 of 12 policies priced here matched it to the dollar."), "check sentence")
    page = ('<title>x</title><meta name="description" content=""><meta property="og:description" content="">'
            '<meta name="twitter:description" content=""><!-- prf:jsonld --><!-- /prf:jsonld -->'
            '<div data-deadlines="1999-01-01"></div>'
            + "".join(f"<!--prf:{k}-->old<!--/prf:{k}-->" for k in v if not k.startswith("_"))
            + '<!--prf:faq--><details><summary>When?</summary><p>Closes <!--prf:sales_long-->x<!--/prf:sales_long-->.</p></details>'
              '<details><summary>Q2 &amp; more</summary><p>A2 <a href="/x">link</a>.</p></details>'
              '<details><summary>Q3</summary><p>A3</p></details><!--/prf:faq-->')
    out = stamp(page, meta, {"checked": "2026-10-12T02:40:00Z", "reached": 12, "agreed": 12})
    ok(stamp(out, meta, {"checked": "2026-10-12T02:40:00Z", "reached": 12, "agreed": 12}) == out, "idempotent")
    ok('data-deadlines="2026-12-01"' in out, "deadline attribute")
    ok('"name": "When?"' in out and '"text": "Closes Dec 1, 2026."' in out, "FAQ JSON-LD reads the stamped page")
    ok('"name": "Q2 & more"' in out and '"text": "A2 link."' in out, "FAQ text is the visible text")
    ok("Sign-up closes Dec 1." in out and "<title>PRF Insurance Calculator: Every Year Since 1951 | AGSIST</title>" in out, "head")
    nodl = page.replace('<div data-deadlines="1999-01-01"></div>', "")
    ok(stamp(nodl, meta, None).count("data-deadlines") == 0, "a page with no reminder ask stamps")
    ok('data-prf-written-for="2027"' in stamp(page + '<h2 data-prf-written-for="2027">x</h2>', meta, None), "a section written for this crop year passes")
    try:
        stamp(page + '<h2 data-prf-written-for="2026">x</h2>', meta, None)
        ok(False, "a section written for another crop year should stop the run")
    except ValueError as e:
        ok("written for crop year 2026" in str(e), str(e))
    for bad, needle in ((page + "<!--prf:mystery-->x<!--/prf:mystery-->", "does not fill"),
                        (page.replace("<!--prf:grids-->old<!--/prf:grids-->", ""), "lacks markers")):
        try:
            stamp(bad, meta, None)
            ok(False, "should have stopped: " + needle)
        except ValueError as e:
            ok(needle in str(e), str(e))
    print("stamp_prf selftest:", "ok" if not fails else f"{len(fails)} failure(s)")
    return 1 if fails else 0


def main():
    if "--selftest" in sys.argv:
        return selftest()
    with open(META, encoding="utf-8") as f:
        meta = json.load(f)
    chk = None
    if os.path.exists(CHECK):
        with open(CHECK, encoding="utf-8") as f:
            chk = json.load(f)
    with open(PAGE, encoding="utf-8") as f:
        page = f.read()
    out = stamp(page, meta, chk)
    if "--check" in sys.argv:
        if out != page:
            print("prf.html is not what scripts/stamp_prf.py would write from data/prf/meta.json. Run it.")
            return 1
        print("prf.html matches data/prf/meta.json")
        return 0
    if out != page:
        with open(PAGE, "w", encoding="utf-8") as f:
            f.write(out)
        print("prf.html stamped")
    else:
        print("prf.html already current")
    return 0


if __name__ == "__main__":
    sys.exit(main())
