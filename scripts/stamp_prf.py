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
FACTS = os.path.join(ROOT, "data", "prf", "facts.json")   # scripts/prf_facts.mjs
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
URL = "https://agsist.com/prf"
TITLE = "PRF Insurance Calculator {cy}: Every Year Since {y0} | AGSIST"
OGTITLE = "PRF insurance calculator: what your grid would have paid, every year since {y0}"
DESC = ("Free PRF (Pasture, Rangeland, Forage) calculator for every USDA grid: {cy} premium, USDA's share, "
        "and what it would have paid each year since {y0}.")
OGALT = ("PRF insurance calculator, crop year {cy}: {grids} grids in {states} states, every year since {y0}. "
         "Sign-up deadline {sales_long}.")
# The day prf.html's wording last changed (scripts/make_prf_html.py). The page's
# dateModified is the later of this and the date of USDA's files, in every
# JSON-LD block (Oct 16: the Dataset used to carry the files' date alone, so the
# page showed search engines two dates). Move it in the same commit as a wording change.
PAGE_REVISED = "2026-10-15"
LONG_IV = ["January to February", "February to March", "March to April", "April to May", "May to June", "June to July",
           "July to August", "August to September", "September to October", "October to November", "November to December"]


def money(x):
    return f"${x:,.0f}"


def money2(x):
    return f"${x:,.2f}"


def example_html(ex):
    """The worked example, from facts.json. Two uses of land, one policy."""
    rows = []
    for k in ("grazing", "hay"):
        e = ex[k]
        rows.append(f'<tr><th scope="row">{html.escape(e["use"])}</th><td>{money2(e["cbv"])}</td><td>{money(e["premium"])}</td>'
                    f'<td>{money(e["usda"])}</td><td>{money(e["you"])} <span class="prf-th-s">{money2(e["per_acre"])} an acre</span></td>'
                    f'<td>{money(e["protection"])}</td><td>{e["paid_years"]} of {e["years"]}</td><td>{money(e["avg"])}</td></tr>')
    return (f'<p>Grid {ex["grid"]} in {ex["county"]}: {ex["acres"]} acres, {ex["coverage"]}% coverage, productivity factor 100, '
            f'{ex["months"]}. Figures at {{cy}} rates.</p>'
            f'<div class="prf-scroll" tabindex="0" role="region" aria-label="Worked example, scrolls sideways"><table class="prf-sub-t prf-ex-t"><caption class="prf-sr">What PRF costs for grid {ex["grid"]}: grazing and hay at the same policy</caption><thead><tr><th scope="col">Use of the land</th><th scope="col">County base value per acre</th>'
            '<th scope="col">Premium</th><th scope="col">USDA pays</th><th scope="col">You pay, a year</th><th scope="col">Most it can pay in a year</th>'
            '<th scope="col">Years it would have paid</th><th scope="col">Average payout a year</th></tr></thead><tbody>' + "".join(rows) + '</tbody></table></div>'
            '<p>Hay ground costs more than grazing land because USDA values an acre of hay higher. Both use the same grid and months, so they would have paid in the same years. '
            'Rates differ from grid to grid and month to month, and USDA&rsquo;s share is not automatic. Use the calculator above for your own land.</p>')


def ex_line(ex):
    g, h = ex["grazing"], ex["hay"]
    return (f'For grid {ex["grid"]} in {ex["county"]}, {ex["acres"]} acres at {ex["coverage"]}% coverage with the policy split between April to May and June to July, '
            f'the producer&rsquo;s share after USDA&rsquo;s comes to {money(g["you"])} a year ({money2(g["per_acre"])} an acre) for grazing land '
            f'and {money(h["you"])} ({money2(h["per_acre"])} an acre) for non-irrigated hay, plus the administrative fee.')


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


def values(meta, chk, facts):
    d, y = meta["dates"], meta["years"]
    for k in ("sales_closing", "acreage_reporting", "premium_billing"):
        if not d.get(k):
            raise ValueError(f"meta.json has no {k} date")
    sub = meta["subsidy"]
    rows = "".join(f'<tr><th scope="row">{c}%</th><td>{pct(sub[c])}%</td><td>{100 - pct(sub[c])}%</td></tr>'
                   for c in sorted(sub, key=int))
    built = meta["built"][:10]
    if not facts or facts.get("crop_year") != meta["crop_year"] or facts.get("built_from") != meta["built"]:
        raise ValueError("data/prf/facts.json is missing or from another build of data/prf: run node scripts/prf_facts.mjs")
    pb = facts["payback"]["all"]
    iv_rows = "".join(f'<tr><th scope="row">{LONG_IV[i]}</th><td>{r["mid_normal_in"]:.2f} in</td><td>{money2(r["mid_rate_per_100"])}</td><td>{r["mid_years_below"]}</td><td>{r["grids"]:,}</td></tr>'
                      for i, r in enumerate(facts["intervals_at_90"]))
    states_html = "".join(f'<li><a href="/prf/{re.sub(r"[^a-z0-9]+", "-", x["name"].lower()).strip("-")}">{html.escape(x["name"])}</a> <span>{x["counties"]} {"county" if x["counties"] == 1 else "counties"}, {x["grids"]:,} grids</span></li>'
                          for x in facts["states"])
    jf = facts["limits"]["jan_feb_max"].get("25", 0)
    dry = facts["largest_net_in_two_driest"]
    return {
        "lr_mid": f'{pb["mid"]:.2f}', "lr_lo": f'{pb["p05"]:.2f}', "lr_hi": f'{pb["p95"]:.2f}', "lr_n": f'{pb["n"]:,}',
        "jf_capped": f"{jf:,}", "multi_grids": f'{facts["grids_in_more_than_one_county"]:,}',
        "dry_two": f'{dry["grids"]:,} of {dry["of"]:,}',
        "example": example_html(facts["example"]).replace("{cy}", str(meta["crop_year"])), "ex_line": ex_line(facts["example"]),
        "iv_rows": iv_rows, "state_list": states_html,
        "_built": built,
        "crop_year": str(meta["crop_year"]),
        "y0": str(y["first"]), "y1": str(y["last_complete"]),
        "nyears": str(y["last_complete"] - y["first"] + 1),
        "_sales_short": short_date(d["sales_closing"]), "sales_long": long_date(d["sales_closing"]),
        "acreage_long": long_date(d["acreage_reporting"]),
        "_billing_short": short_date(d["premium_billing"]), "billing_long": long_date(d["premium_billing"]),
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


def jsonld(page, v, meta=None):
    desc = DESC.format(y0=v["y0"], cy=v["crop_year"])
    blocks = [
        {"@context": "https://schema.org", "@type": "WebApplication", "@id": URL + "#app",
         "name": "PRF rainfall index calculator: every year on record", "url": URL,
         "applicationCategory": "FinanceApplication", "operatingSystem": "Any",
         "offers": {"@type": "Offer", "price": "0", "priceCurrency": "USD"}, "isAccessibleForFree": True, "description": desc,
         "dateModified": max(v["_built"], PAGE_REVISED), "inLanguage": "en-US",
         "author": {"@type": "Person", "name": "Sigurd Lindquist", "jobTitle": "Certified Crop Adviser (CCA)", "url": "https://agsist.com/about"},
         "publisher": {"@type": "Organization", "name": "AGSIST", "url": "https://agsist.com/"}},
        {"@context": "https://schema.org", "@type": "FAQPage",
         "mainEntity": [{"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}}
                        for q, a in faq_pairs(page)]},
        {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Home", "item": "https://agsist.com/"},
            {"@type": "ListItem", "position": 2, "name": "Tools", "item": "https://agsist.com/tools"},
            {"@type": "ListItem", "position": 3, "name": "PRF rainfall insurance", "item": URL}]},
    ]
    if meta:
        # the data behind the page, as a schema.org Dataset: USDA's files, public domain
        blocks.append({"@context": "https://schema.org", "@type": "Dataset",
                       "name": f"PRF premium rates, county base values and rainfall index history, crop year {meta['crop_year']}",
                       "description": (f"USDA RMA's Pasture, Rangeland, Forage rainfall index insurance for crop year {meta['crop_year']}: premium rates, "
                                       f"county base values and interval limits for {meta['counts']['counties']:,} counties, and the precipitation index "
                                       f"for {meta['counts']['grids']:,} grids from {meta['years']['first']} to {meta['years']['last_complete']}."),
                       "url": URL, "temporalCoverage": f"{meta['years']['first']}/{meta['years']['last_complete']}",
                       "spatialCoverage": {"@type": "Place", "name": "48 contiguous United States"},
                       "dateModified": max(v["_built"], PAGE_REVISED), "isAccessibleForFree": True, "license": "https://www.usa.gov/government-works",
                       "creator": {"@type": "Organization", "name": "USDA Risk Management Agency", "url": "https://www.rma.usda.gov/"},
                       "publisher": {"@type": "Organization", "name": "AGSIST", "url": "https://agsist.com/"},
                       "isBasedOn": [meta["sources"]["adm"], meta["sources"]["index"]],
                       "variableMeasured": ["premium rate", "county base value per acre", "precipitation index"]})
    return "".join('<script type="application/ld+json">' + json.dumps(b, ensure_ascii=False).replace("</", "<\\/") + "</script>"
                   for b in blocks)


def stamp(page, meta, chk, facts):
    v = values(meta, chk, facts)
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
    desc = html.escape(DESC.format(y0=v["y0"], cy=v["crop_year"]), quote=True)
    if len(html.unescape(desc)) > 160:
        raise ValueError(f"description is {len(html.unescape(desc))} characters")
    for pat in (r'(<meta name="description" content=")[^"]*(")', r'(<meta property="og:description" content=")[^"]*(")',
                r'(<meta name="twitter:description" content=")[^"]*(")'):
        page, n = re.subn(pat, lambda m: m.group(1) + desc + m.group(2), page)
        if n != 1:
            raise ValueError(f"expected one match for {pat}, found {n}")
    og = html.escape(OGTITLE.format(y0=v["y0"]), quote=True)
    alt = html.escape(OGALT.format(cy=v["crop_year"], grids=v["grids"], states=v["states"], y0=v["y0"], sales_long=v["sales_long"]), quote=True)
    for pat, val in ((r'(<meta property="og:title"\s+content=")[^"]*(")', og), (r'(<meta name="twitter:title"\s+content=")[^"]*(")', og),
                     (r'(<meta property="og:image:alt"\s+content=")[^"]*(")', alt)):
        page, n = re.subn(pat, lambda m, val=val: m.group(1) + val + m.group(2), page)
        if n != 1:
            raise ValueError(f"expected one match for {pat}, found {n}")
    for k in ("mid", "lo", "hi"):
        page, n = re.subn(rf'data-lr-{k}="[^"]*"', f'data-lr-{k}="{v["lr_" + k]}"', page)
        if n > 1:
            raise ValueError(f"more than one data-lr-{k}")
    title = TITLE.format(y0=v["y0"], cy=v["crop_year"])
    page, n = re.subn(r"<title>.*?</title>", f"<title>{title}</title>", page, flags=re.S)
    if n != 1:
        raise ValueError("expected one <title>")
    page, n = re.subn(r"<!-- prf:jsonld -->.*?<!-- /prf:jsonld -->",
                      lambda m: "<!-- prf:jsonld -->" + jsonld(page, v, meta) + "<!-- /prf:jsonld -->", page, flags=re.S)
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
            # the real meta.json carries its sources; the stamp cites them (isBasedOn)
            "sources": {"adm": "https://pubfs-rma.fpac.usda.gov/pub/References/actuarial_data_master/2027/2027_ADM_YTD.zip",
                        "index": "https://public-rma.fpac.usda.gov/apps/PrfWebApi/PrfExternalIndexes/GetIndexValues"},
            "counts": {"grids": 13414, "counties": 3070, "states": 48}}
    ex = {"use": "Grazing", "cbv": 32.8, "premium": 305, "usda": 155, "you": 150, "per_acre": 1.5, "protection": 2952, "years": 75, "paid_years": 44, "ahead_years": 33, "avg": 261}
    facts = {"crop_year": 2027, "built_from": meta["built"], "payback": {"all": {"n": 722380, "p05": 0.78, "mid": 0.87, "p95": 0.89}},
             "intervals_at_90": [{"mid_normal_in": 3.08, "mid_rate_per_100": 17.4, "mid_years_below": 35, "grids": 13414}] * 11,
             "states": [{"name": "Wisconsin", "counties": 72, "grids": 300}], "limits": {"jan_feb_max": {"25": 3067, "50": 3}},
             "largest_net_in_two_driest": {"grids": 7899, "of": 13307}, "grids_in_more_than_one_county": 9601,
             "example": {"grid": 30454, "county": "Barron County, Wisconsin", "acres": 100, "coverage": 90, "months": "April to May and June to July, half in each",
                         "grazing": ex, "hay": dict(ex, use="Haying, non-irrigated", you=1047, per_acre=10.47)}}
    v = values(meta, None, facts)
    ok(v["lr_mid"] == "0.87" and v["lr_n"] == "722,380" and v["jf_capped"] == "3,067" and v["dry_two"] == "7,899 of 13,307", "facts")
    ok("$150 a year ($1.50 an acre) for grazing land and $1,047 ($10.47 an acre)" in v["ex_line"], v["ex_line"])
    try:
        values(meta, None, dict(facts, built_from="2026-01-01T00:00:00Z"))
        ok(False, "facts from another build should stop the run")
    except ValueError as e:
        ok("another build" in str(e), str(e))
    ok(v["sales_long"] == "Dec 1, 2026" and v["_sales_short"] == "Dec 1" and v["billing_long"] == "Sep 1, 2027", "dates")
    ok(v["nyears"] == "75" and v["grids"] == "13,414", "counts")
    ok(v["subsidy_sentence"] == "59% at the 70% and 75% coverage levels, 55% at 80% and 85%, and 51% at 90%", v["subsidy_sentence"])
    ok(subsidy_sentence({"70": 0.6, "75": 0.6, "80": 0.6, "85": 0.6, "90": 0.6}) == "60% at the 70%, 75%, 80%, 85% and 90% coverage levels", "one rate")
    ok('<td>51%</td><td>49%</td>' in v["subsidy_rows"], "rows")
    ok(check_sentence(None) == "", "no check file")
    ok("did not answer" in check_sentence({"checked": "2026-10-12T02:40:00Z", "reached": 0, "agreed": 0}), "nothing reached is said")
    ok(check_sentence({"checked": "2026-10-12T02:40:00Z", "reached": 12, "agreed": 12}).endswith(
        "12 of 12 policies priced here matched it to the dollar."), "check sentence")
    page = ('<title>x</title><meta name="description" content=""><meta property="og:description" content="">'
            '<meta property="og:title" content=""><meta name="twitter:title" content=""><meta property="og:image:alt" content="">'
            '<div data-prf data-lr-mid="" data-lr-lo="" data-lr-hi=""></div>'
            '<meta name="twitter:description" content=""><!-- prf:jsonld --><!-- /prf:jsonld -->'
            '<div data-deadlines="1999-01-01"></div>'
            + "".join(f"<!--prf:{k}-->old<!--/prf:{k}-->" for k in v if not k.startswith("_"))
            + '<!--prf:faq--><details><summary>When?</summary><p>Closes <!--prf:sales_long-->x<!--/prf:sales_long-->.</p></details>'
              '<details><summary>Q2 &amp; more</summary><p>A2 <a href="/x">link</a>.</p></details>'
              '<details><summary>Q3</summary><p>A3</p></details><!--/prf:faq-->')
    out = stamp(page, meta, {"checked": "2026-10-12T02:40:00Z", "reached": 12, "agreed": 12}, facts)
    ok(stamp(out, meta, {"checked": "2026-10-12T02:40:00Z", "reached": 12, "agreed": 12}, facts) == out, "idempotent")
    ok('data-deadlines="2026-12-01"' in out, "deadline attribute")
    ok('"name": "When?"' in out and '"text": "Closes Dec 1, 2026."' in out, "FAQ JSON-LD reads the stamped page")
    ok('"name": "Q2 & more"' in out and '"text": "A2 link."' in out, "FAQ text is the visible text")
    ok("Free PRF (Pasture, Rangeland, Forage) calculator" in out and "<title>PRF Insurance Calculator 2027: Every Year Since 1951 | AGSIST</title>" in out, "head")
    ok('data-lr-mid="0.87"' in out and 'Sign-up deadline Dec 1, 2026.' in out, "root attributes and image text")
    nodl = page.replace('<div data-deadlines="1999-01-01"></div>', "")
    ok(stamp(nodl, meta, None, facts).count("data-deadlines") == 0, "a page with no reminder ask stamps")
    ok('data-prf-written-for="2027"' in stamp(page + '<h2 data-prf-written-for="2027">x</h2>', meta, None, facts), "a section written for this crop year passes")
    try:
        stamp(page + '<h2 data-prf-written-for="2026">x</h2>', meta, None, facts)
        ok(False, "a section written for another crop year should stop the run")
    except ValueError as e:
        ok("written for crop year 2026" in str(e), str(e))
    for bad, needle in ((page + "<!--prf:mystery-->x<!--/prf:mystery-->", "does not fill"),
                        (page.replace("<!--prf:grids-->old<!--/prf:grids-->", ""), "lacks markers")):
        try:
            stamp(bad, meta, None, facts)
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
    with open(FACTS, encoding="utf-8") as f:
        facts = json.load(f)
    with open(PAGE, encoding="utf-8") as f:
        page = f.read()
    out = stamp(page, meta, chk, facts)
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
