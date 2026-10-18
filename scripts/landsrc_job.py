#!/usr/bin/env python3
"""Where each corn-belt county posts its land sales, and on what terms.

Ten county-by-county states (IA, OH, NE, SD, MN, MI, KS, MO, IN, ND). The bids
repo builds the county home page list from Wikidata and captures each home
page plus the links that look like the assessor, auditor, recorder, sales,
transfers, downloads or GIS (capture.yml prep=county-sites
list=probe-lists/county-sites.txt pick=land follow=6 depth=2 save=countysites).
This file:

  bundle CAPS_CLONE OUT     newest caps/ folder on the bids `countysites`
                            branch (or $LANDSRC_CAPS): one request per county
                            with a captured page; the county list (names,
                            states) comes from agsist's data/atlas/atlas.json,
                            so a county with no site on file is still counted
  collect BUNDLE RESULTS DIR
                            URLs must be ones we saved or saw linked, quotes
                            must be in the saved text; a "yes" with no quote is
                            "unclear". Writes DIR/counties.json and
                            DIR/counties.md: counties ranked by what a free
                            parser could use (a download with price and acres
                            first), per state.

The model call goes through scripts/api_jobs.py (job kind "landsrc"). Sonnet:
naming the office, the vendor and the format from saved pages is plain
reading, and every answer is checked against the copy. Nothing here touches a
page; fx/landnation owns the state-level sources (its sources.md), this is
the county-level list for phase 2.
"""
import json
import os
import re
import sys

import elevsites_job as EJ

STATES = {"IA": "19", "OH": "39", "NE": "31", "SD": "46", "MN": "27", "MI": "26", "KS": "20", "MO": "29", "IN": "18", "ND": "38"}
TEXT_BUDGET = 22000
MIN_PAGE_TEXT = 2000
FORMATS = ["csv", "xls", "gis_service", "gis_download", "search_only", "pdf_list", "none", "unclear"]
VENDORS = ["beacon", "qpublic", "vanguard", "gworks", "bsa", "tyler", "devnet", "orka", "pictometry", "arcgis", "county_own", "other", "none"]
YNU = ("yes", "no", "unclear")
TERMS = ("reuse_allowed", "reuse_restricted", "no_terms_seen", "login_or_fee")

SYSTEM = """You read saved copies of one U.S. county government's website for agsist.com, a free farm website that wants to show recent farmland sale prices county by county. You get the county and state, then each saved page: its URL, title, links, frames and text.

Answer about the site as saved:
- offices: the county offices that handle property records that the pages show, each {"role": "assessor|auditor|recorder|treasurer|gis|other", "url": "<a URL copied exactly from a page line, a link or a frame>"}. At most 6.
- free_sale_data: "yes" if a saved page offers recorded property sales (sale price by parcel, or a sales list or file) to the public at no charge; "no" if the pages plainly show sales are not offered, or only for a fee or a login; "unclear" if a likely page is linked but not saved, or you cannot tell.
- format: how the sales come: csv, xls (a spreadsheet file), gis_service (an ArcGIS or similar map service you can query), gis_download (a shapefile or geodatabase download), search_only (a parcel search one sale at a time), pdf_list (a PDF or printed list of sales), none, unclear.
- data_url: the page or file that holds the sales, copied exactly. Empty if none.
- includes_price, includes_acres, includes_class (farm or agricultural land class): "yes" if the saved text shows that field for sales, "no" if it plainly lacks it, "unclear" if you cannot tell.
- vendor: who runs the property site: beacon (Schneider), qpublic, vanguard, gworks, bsa (BS&A), tyler, devnet, orka (Kansas), pictometry, arcgis, county_own, other, none.
- terms: reuse_allowed (a disclaimer or license that allows reuse, or plain public record with no limit stated alongside), reuse_restricted (terms forbid copying, scraping, bulk or commercial use), no_terms_seen, login_or_fee.
- terms_quote: up to 300 characters copied exactly from a page that shows the terms. Empty if none seen.
- evidence_quote: up to 200 characters copied exactly from one page that shows your free_sale_data answer.
- confidence: high, medium or low.
- notes: one short line ("sales search behind a click-through disclaimer", "state site does sales for all counties").

Rules: never invent a URL, a vendor or a term. Do not write any price. A login, captcha or fee is "login_or_fee", never worked around. If the pages failed to load or are empty, say unclear with low confidence.

Answer with one JSON object in a ```json fenced block and nothing after it:
{"county": "<as given>", "offices": [], "free_sale_data": "yes|no|unclear", "format": "", "data_url": "", "includes_price": "unclear", "includes_acres": "unclear", "includes_class": "unclear", "vendor": "", "terms": "", "terms_quote": "", "evidence_quote": "", "confidence": "low", "notes": ""}"""


def cid_of(key):
    return ("l_" + re.sub(r"[^a-zA-Z0-9_-]", "_", key))[:64]


def prompt(e):
    parts = [f"County: {e['name']}, {e['state']} (FIPS {e['fips']})", ""]
    for i, p in enumerate(e["pages"], 1):
        parts.append(f"=== PAGE {i}: {p['url']}" + (f"  (linked from {p['parent']})" if p.get("parent") else "") + ("  (PDF)" if p.get("pdf") else ""))
        if p.get("skipped"):
            parts.append(f"Not saved: {p['skipped']}"); continue
        if p.get("error") or p.get("navError"):
            parts.append(f"Load problem: {p.get('error') or p.get('navError')}")
        parts.append(f"Title: {p.get('title') or '(none)'}")
        if p.get("iframes"):
            parts.append("Frames: " + " ".join(p["iframes"]))
        if p.get("responseHosts"):
            parts.append("Hosts: " + ", ".join(f"{h} {n}" for h, n in list(p["responseHosts"].items())[:15]))
        if p.get("pdfLinks"):
            parts.append("PDF links: " + " ".join(f"{l['url']} ({l['text']})" for l in p["pdfLinks"]))
        if p.get("links"):
            parts.append("Links:\n" + "\n".join(f"- {l['text'] or '(no text)'} -> {l['url']}" for l in p["links"]))
        parts.append("Text:\n" + (p.get("text") or "(empty)"))
        parts.append("")
    return "\n".join(parts)


def params(e, model, max_tokens, effort):
    return {"model": model, "max_tokens": max_tokens, "thinking": {"type": "adaptive"}, "output_config": {"effort": effort},
            "system": SYSTEM, "messages": [{"role": "user", "content": prompt(e)}]}


LANDWORD = re.compile(r"assessor|auditor|recorder|deeds|treasurer|property|parcel|real estate|sales?\b|transfer|gis|download|valuation|beacon|qpublic", re.I)


def county_list(atlas_path):
    d = json.load(open(atlas_path))
    st_of = {v: k for k, v in STATES.items()}
    return {f: {"fips": f, "name": c.get("name", ""), "state": c.get("state") or st_of.get(f[:2])}
            for f, c in d["counties"].items() if f[:2] in st_of}


def build_bundle(caps, atlas_path):
    counties = county_list(atlas_path)
    by = EJ.group_by_seed(caps, EJ.load_pages(caps))
    rows, nosite = [], []
    for key, ps in by.items():
        m = re.match(r"(\d{5})\b", key)
        if not m or m.group(1) not in counties:
            continue
        live = [p for p in ps if p.get("text")]
        per = max(MIN_PAGE_TEXT, TEXT_BUDGET // max(1, len(live)))
        for p in ps:
            p["text"] = (p.get("text") or "")[:per]
            p["links"] = sorted(p.get("links", []), key=lambda l: not LANDWORD.search(f"{l.get('text')} {l.get('url')}"))[:40]
            for k in ("scripts", "facebook"):
                p.pop(k, None)
        c = counties[m.group(1)]
        prev = next((r for r in rows if r["fips"] == c["fips"]), None)
        if prev:
            prev["pages"] += ps
            continue
        rows.append(dict(c, key=key, pages=ps))
    have = {r["fips"] for r in rows}
    nosite = [c for f, c in sorted(counties.items()) if f not in have]
    rows.sort(key=lambda r: r["fips"])
    return {"job": "landsrc", "caps": os.path.basename(caps), "landsrc": rows, "noSite": nosite}


# ── collect ───────────────────────────────────────────────────────────────
norm = EJ.norm


def pick(v, allowed, default):
    return v if v in allowed else default


def check(e, a):
    flags = []
    base = {"fips": e["fips"], "county": e["name"], "state": e["state"]}
    if not isinstance(a, dict):
        return dict(base, offices=[], free_sale_data="unclear", format="unclear", data_url="", includes_price="unclear",
                    includes_acres="unclear", includes_class="unclear", vendor="none", terms="no_terms_seen", terms_quote="",
                    evidence_quote="", confidence="low", notes="", flags=["no answer"])
    seen = EJ.seen_urls(e)
    alltext = norm(" ".join(p.get("text", "") for p in e["pages"]))
    out = dict(base)
    offices = []
    for o in (a.get("offices") or [])[:6]:
        if isinstance(o, dict) and str(o.get("url") or "").rstrip("/") in seen:
            offices.append({"role": pick(o.get("role"), ("assessor", "auditor", "recorder", "treasurer", "gis", "other"), "other"), "url": o["url"]})
        elif isinstance(o, dict):
            flags.append(f"office URL not in the saved pages; dropped: {str(o.get('url'))[:80]}")
    out["offices"] = offices
    out["free_sale_data"] = pick(a.get("free_sale_data"), YNU, "unclear")
    out["format"] = pick(a.get("format"), FORMATS, "unclear")
    for k in ("includes_price", "includes_acres", "includes_class"):
        out[k] = pick(a.get(k), YNU, "unclear")
    out["vendor"] = pick(a.get("vendor"), VENDORS, "other")
    out["terms"] = pick(a.get("terms"), TERMS, "no_terms_seen")
    out["confidence"] = pick(a.get("confidence"), ("high", "medium", "low"), "low")
    url = str(a.get("data_url") or "").strip()
    if url and url.rstrip("/") not in seen:
        flags.append("data_url not in the saved pages; dropped"); url = ""
    out["data_url"] = url
    for k, lim in (("evidence_quote", 200), ("terms_quote", 300)):
        q = str(a.get(k) or "")[:lim]
        if q and norm(q) not in alltext:
            flags.append(f"{k} not found in the saved text; dropped"); q = ""
            out["confidence"] = "low"
        out[k] = q
    if out["free_sale_data"] == "yes" and not (out["evidence_quote"] or out["data_url"]):
        out["free_sale_data"] = "unclear"; flags.append("yes with no quote and no URL")
    if out["terms"] in ("reuse_allowed", "reuse_restricted") and not out["terms_quote"]:
        flags.append(f"terms {out['terms']} with no quote; set to no_terms_seen"); out["terms"] = "no_terms_seen"
    if re.search(r"\$\s?\d", str(a.get("notes") or "")):
        flags.append("a price in notes; notes dropped"); out["notes"] = ""
    else:
        out["notes"] = str(a.get("notes") or "")[:200]
    out["flags"] = flags
    return out


def score(r):
    """What a free parser could use: higher first."""
    if r["free_sale_data"] != "yes":
        return 0
    s = {"csv": 50, "xls": 50, "gis_download": 45, "gis_service": 40, "pdf_list": 25, "search_only": 10}.get(r["format"], 5)
    s += 15 * (r["includes_price"] == "yes") + 10 * (r["includes_acres"] == "yes") + 8 * (r["includes_class"] == "yes")
    s += {"reuse_allowed": 10, "no_terms_seen": 3, "reuse_restricted": -20, "login_or_fee": -30}[r["terms"]]
    s += {"high": 3, "medium": 1, "low": 0}[r["confidence"]]
    return s


def collect(bundle, results):
    items = results.get("items", {})
    rows = []
    for e in bundle["landsrc"]:
        it = items.get(cid_of(e["key"]), {})
        r = check(e, it.get("parsed") if it.get("result") == "succeeded" else None)
        r["result"] = it.get("result", "missing")
        r["score"] = score(r)
        rows.append(r)
    rows.sort(key=lambda r: (-r["score"], r["state"], r["county"]))
    per = {}
    for st in STATES:
        rs = [r for r in rows if r["state"] == st]
        per[st] = {"captured": len(rs), "noSite": sum(c["state"] == st for c in bundle.get("noSite", [])),
                   "free": sum(r["free_sale_data"] == "yes" for r in rs),
                   "download": sum(r["free_sale_data"] == "yes" and r["format"] in ("csv", "xls", "gis_download", "gis_service") for r in rs),
                   "withPrice": sum(r["free_sale_data"] == "yes" and r["includes_price"] == "yes" for r in rs),
                   "vendors": dict(sorted({v: sum(r["vendor"] == v for r in rs) for v in VENDORS if any(r["vendor"] == v for r in rs)}.items(), key=lambda x: -x[1]))}
    return {"job": "landsrc", "caps": bundle.get("caps"), "batch": results.get("batch_id"), "actual_cost_usd": results.get("actual_cost_usd"),
            "counts": {"counties": len(rows) + len(bundle.get("noSite", [])), "captured": len(rows), "noSite": len(bundle.get("noSite", [])),
                       "free": sum(r["free_sale_data"] == "yes" for r in rows), "flagged": sum(bool(r["flags"]) for r in rows)},
            "perState": per, "counties": rows, "noSite": bundle.get("noSite", [])}


def markdown(t, landnation_note=""):
    c = t["counts"]
    L = [f"# County land sale sources, ten corn-belt states ({t.get('caps')})", "",
         f"{c['counties']} counties: {c['captured']} with a captured site, {c['noSite']} with no site on file. "
         f"{c['free']} show free sale data. {c['flagged']} answers had something dropped. Batch {t.get('batch')}, cost ${t.get('actual_cost_usd')}.", "",
         "Every URL is one we saved or saw linked, every quote is in the saved text. Findings for a person; terms must be read in full "
         "before anything is fetched in bulk.", ""]
    if landnation_note:
        L += [landnation_note, ""]
    L += ["| State | Captured | No site | Free sales | Download or service | With price | Vendors |", "|---|---|---|---|---|---|---|"]
    for st, p in t["perState"].items():
        L.append(f"| {st} | {p['captured']} | {p['noSite']} | {p['free']} | {p['download']} | {p['withPrice']} | "
                 f"{', '.join(f'{k} {v}' for k, v in p['vendors'].items())} |")
    L += ["", "## Counties, most usable first", "",
          "| Score | County | Free | Format | Price | Acres | Class | Vendor | Terms | Data URL | Flags |", "|---|---|---|---|---|---|---|---|---|---|---|"]
    for r in t["counties"]:
        L.append(f"| {r['score']} | {r['county']}, {r['state']} ({r['fips']}) | {r['free_sale_data']} | {r['format']} | {r['includes_price']} | "
                 f"{r['includes_acres']} | {r['includes_class']} | {r['vendor']} | {r['terms']} | {r['data_url']} | {'; '.join(r['flags'])} |")
    return "\n".join(L).replace("—", "-") + "\n"


def selftest():
    e = {"fips": "19169", "name": "Story", "state": "IA", "key": "19169 Story County, IA", "pages": [
        {"url": "https://www.storycountyiowa.gov/", "parent": None, "title": "Story County", "text": "Departments Assessor",
         "links": [{"url": "https://www.storycountyiowa.gov/assessor", "text": "Assessor"}]},
        {"url": "https://www.storycountyiowa.gov/assessor", "parent": "https://www.storycountyiowa.gov/", "title": "Assessor",
         "text": "Sales data: download the 2025 sales file (CSV) with sale price, acres and class. Data is public record and may be reused.",
         "links": [{"url": "https://www.storycountyiowa.gov/files/sales-2025.csv", "text": "2025 sales (CSV)"}]}]}
    p = prompt(e)
    assert "County: Story, IA (FIPS 19169)" in p and "2025 sales (CSV)" in p
    good = {"offices": [{"role": "assessor", "url": "https://www.storycountyiowa.gov/assessor"}, {"role": "gis", "url": "https://invented.gov/gis"}],
            "free_sale_data": "yes", "format": "csv", "data_url": "https://www.storycountyiowa.gov/files/sales-2025.csv",
            "includes_price": "yes", "includes_acres": "yes", "includes_class": "yes", "vendor": "county_own", "terms": "reuse_allowed",
            "terms_quote": "Data is public record and may be reused.", "evidence_quote": "download the 2025 sales file (CSV)", "confidence": "high", "notes": ""}
    a = check(e, good)
    assert a["free_sale_data"] == "yes" and a["data_url"] and len(a["offices"]) == 1 and a["terms"] == "reuse_allowed", a
    assert score(a) == 50 + 15 + 10 + 8 + 10 + 3
    bad = dict(good, data_url="https://x.gov/s.csv", evidence_quote="sales back to 1990", terms_quote="anything", vendor="acme", format="json")
    b = check(e, bad)
    assert b["free_sale_data"] == "unclear" and b["terms"] == "no_terms_seen" and b["vendor"] == "other" and b["format"] == "unclear", b
    assert score(b) == 0 and check(e, None)["flags"] == ["no answer"]
    res = {"batch_id": "b", "actual_cost_usd": 1.0, "items": {cid_of(e["key"]): {"result": "succeeded", "parsed": good}}}
    t = collect({"landsrc": [e], "caps": "c", "noSite": [{"fips": "19001", "name": "Adair", "state": "IA"}]}, res)
    assert t["perState"]["IA"] == {"captured": 1, "noSite": 1, "free": 1, "download": 1, "withPrice": 1, "vendors": {"county_own": 1}}, t["perState"]["IA"]
    md = markdown(t, "Statewide sources: see fx/landnation.")
    assert "| IA | 1 | 1 | 1 | 1 | 1 | county_own 1 |" in md and "Story, IA (19169)" in md and "fx/landnation" in md
    print("landsrc selftest ok")


if __name__ == "__main__":
    a = sys.argv[1:]
    if not a or a[0] == "selftest":
        selftest()
    elif a[0] == "bundle":
        caps = os.path.join(a[1], os.environ["LANDSRC_CAPS"]) if os.environ.get("LANDSRC_CAPS") else EJ.newest_caps(a[1])
        b = build_bundle(caps, os.environ.get("LANDSRC_ATLAS", "data/atlas/atlas.json"))
        os.makedirs(os.path.dirname(a[2]) or ".", exist_ok=True)
        from redact_secrets import redact
        text, n = redact(json.dumps(b))
        open(a[2], "w").write(text)
        print(f"redacted {n} secret-looking string(s) from the captures")
        print(f"::notice title=landsrc bundle::{len(b['landsrc'])} counties to read, {len(b['noSite'])} with no site, from {b['caps']}")
    elif a[0] == "collect":
        t = collect(json.load(open(a[1])), json.load(open(a[2])))
        os.makedirs(a[3], exist_ok=True)
        json.dump(t, open(os.path.join(a[3], "counties.json"), "w"), indent=1)
        note = os.environ.get("LANDSRC_NOTE", "Statewide sources (Indiana's sales disclosure file and others) are fx/landnation's (its sources.md); this list is county by county.")
        open(os.path.join(a[3], "counties.md"), "w").write(markdown(t, note))
        print(f"::notice title=landsrc::{t['counts']}")
    else:
        sys.exit("modes: selftest | bundle CAPS_CLONE OUT | collect BUNDLE RESULTS DIR")
