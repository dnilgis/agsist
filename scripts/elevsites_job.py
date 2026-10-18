#!/usr/bin/env python3
"""Unread elevators' own websites: does each company post cash bids, where, on what.

The bids repo (dnilgis/bids, public) captures each unread company's home page
and the bid-looking pages it links to (capture.yml list=probe-lists/elevsites.txt
follow=3 save=elevsites). Those captures land on the bids `elevsites` branch
under caps/<date>-<run id>/ with the worklist that drove them. This file:

  bundle CAPS_CLONE OUT     read the newest caps/ folder (or $ELEVSITES_CAPS),
                            one request row per company: its names, unread rows,
                            towns, and a digest of every page captured for it
  collect BUNDLE RESULTS DIR
                            check every answer against the captured pages
                            (the bid page URL must be one we saw; the quote must
                            be in the page text), then write DIR/todo.json and
                            DIR/todo.md: platform -> companies -> rows unlocked,
                            Upper Midwest first, with the platforms bids already
                            reads marked "point existing reader"

The model call itself goes through scripts/api_jobs.py (job kind "elevsite").
Nothing here writes a manifest or touches a page: the to-do is a finding for a
person to act on in the bids repo.
"""
import glob
import json
import os
import re
import sys

UPPER_MIDWEST = {"WI", "MN", "IA", "IL", "SD", "ND", "NE"}
PLATFORMS = ["dtn", "agricharts", "barchart", "bushel", "grainbridge", "cih", "aghost", "graindesk", "stonehedge",
             "gradable", "qtmarket", "corporate", "plain_html", "pdf", "image", "facebook_only", "other", "none"]
# Platforms bids already has a reader for (lib/adapters/*.mjs on bids main, Oct 18, 2026).
EXISTING_READER = {"dtn": "lib/adapters/dtn-cs.mjs", "agricharts": "lib/adapters/agricharts.mjs (+ agricharts-cashgrid.mjs)",
                   "bushel": "lib/adapters/bushel.mjs", "cih": "lib/adapters/cih.mjs", "aghost": "lib/adapters/aghost.mjs",
                   "graindesk": "lib/adapters/graindesk.mjs", "stonehedge": "lib/adapters/stonehedge.mjs",
                   "gradable": "lib/adapters/gradable.mjs", "qtmarket": "lib/adapters/qtmarket.mjs"}
TEXT_BUDGET = 24000     # characters of page text per company, split over its pages
MIN_PAGE_TEXT = 2500
MAX_LINKS = 40

SYSTEM = """You read saved copies of one grain company's own website for agsist.com's free cash bid map. The company runs grain elevators that the map does not read yet. You get the company's names as the licence rolls spell them, the towns of its unread elevators, and a digest of each page we saved from its site: title, the readable text, the links, the scripts and frames the page loaded, and the hosts it talked to.

Answer these about the site as saved, nothing else:
- has_cash_bids: "yes" if a saved page shows posted cash grain bids (prices or basis by crop, for one or more locations), or plainly loads them from a bid vendor; "no" if the saved pages show the site has no bids (a feed store, an agronomy-only site, a parked domain, a different business); "unclear" if a bid page is linked but not saved, needs a login, is behind a bot check, or you cannot tell.
- bid_page_url: the page that shows the bids, copied exactly from a saved page's URL, a link, or a frame source in the digest. Empty if none.
- platform: who serves the bids. One of: dtn, agricharts, barchart, bushel, grainbridge, cih, aghost, graindesk, stonehedge, gradable, qtmarket, corporate (a big company's own system), plain_html (typed into the site's own page), pdf, image, facebook_only, other, none. Judge from the script, frame and host names (for example dtn or dtnpf, agricharts, barchart or cmdty, bushelpowered, grainbridge, cihedging, aghost.net, graindesk, stonehedge, gradable), not from guesses. "none" when there are no bids.
- platform_evidence: the script, frame, host or link that shows the platform, copied from the digest.
- locations_seen: the elevator or town names the bid page lists, as written, at most 60. Empty if none.
- confidence: "high" (the bids and the platform are plain in the saved copy), "medium", or "low".
- evidence_quote: up to 200 characters copied exactly from one page's text that shows your answer (a bid row, "Cash Bids", a "no longer buying grain" line). Must be an exact substring of the text given.
- notes: one short line, for example "bid page linked but robots.txt disallows it" or "site is a feed store, grain moved to X".

Rules: never invent a URL, a price or a town. Do not write any price in your answer. If the pages failed to load or are empty, say unclear with low confidence.

Answer with one JSON object in a ```json fenced block and nothing after it:
{"company": "<as given>", "has_cash_bids": "yes|no|unclear", "bid_page_url": "", "platform": "...", "platform_evidence": "", "locations_seen": [], "confidence": "high|medium|low", "evidence_quote": "", "notes": ""}"""


def prompt(e):
    parts = [f"Company: {e['company']}",
             f"Names on the rolls: {'; '.join(e.get('names', [])) or '(none)'}",
             f"Unread elevators: {e.get('realRows', 0)} (states: {', '.join(f'{k} {v}' for k, v in sorted(e.get('states', {}).items(), key=lambda x: -x[1]))})",
             f"Towns: {'; '.join(e.get('towns', [])[:40]) or '(none)'}",
             ""]
    for i, p in enumerate(e["pages"], 1):
        parts.append(f"=== PAGE {i}: {p['url']}" + (f"  (linked from {p['parent']})" if p.get("parent") else ""))
        if p.get("skipped"):
            parts.append(f"Not saved: {p['skipped']}")
            continue
        if p.get("pdf"):
            parts.append("(a PDF; its text below)")
        if p.get("error") or p.get("navError"):
            parts.append(f"Load problem: {p.get('error') or p.get('navError')}")
        parts.append(f"Title: {p.get('title') or '(none)'}")
        if p.get("scripts"):
            parts.append("Scripts: " + " ".join(p["scripts"]))
        if p.get("iframes"):
            parts.append("Frames: " + " ".join(p["iframes"]))
        if p.get("responseHosts"):
            parts.append("Hosts: " + ", ".join(f"{h} {n}" for h, n in p["responseHosts"].items()))
        if p.get("pdfLinks"):
            parts.append("PDF links: " + " ".join(f"{l['url']} ({l['text']})" for l in p["pdfLinks"]))
        if p.get("facebook"):
            parts.append("Facebook: " + " ".join(p["facebook"]))
        if p.get("links"):
            parts.append("Links:\n" + "\n".join(f"- {l['text'] or '(no text)'} -> {l['url']}" for l in p["links"]))
        parts.append("Text:\n" + (p.get("text") or "(empty)"))
        parts.append("")
    return "\n".join(parts)


def params(e, model, max_tokens, effort):
    return {"model": model, "max_tokens": max_tokens, "thinking": {"type": "adaptive"}, "output_config": {"effort": effort},
            "system": SYSTEM, "messages": [{"role": "user", "content": prompt(e)}]}


def cid_of(company):
    return ("e_" + re.sub(r"[^a-zA-Z0-9_-]", "_", company))[:64]


# ── bundle ────────────────────────────────────────────────────────────────
BIDWORD = re.compile(r"cash|bid|market|grain|price|commodit|elevator|location", re.I)


def trim_links(links):
    keep = [l for l in links if BIDWORD.search(f"{l.get('text', '')} {l.get('url', '')}")]
    rest = [l for l in links if l not in keep]
    return (keep + rest)[:MAX_LINKS]


def newest_caps(clone):
    if os.environ.get("ELEVSITES_CAPS"):
        return os.path.join(clone, os.environ["ELEVSITES_CAPS"])
    dirs = sorted(d for d in glob.glob(os.path.join(clone, "caps", "*")) if os.path.isdir(d))
    if not dirs:
        sys.exit("::error::no caps/ folder on the bids elevsites branch; run capture.yml with save=elevsites first")
    return dirs[-1]


def seed_companies(list_txt):
    out = {}
    for line in list_txt.splitlines():
        m = re.match(r"\s*(https?://\S+)\s*#\s*(.+?)\s*$", line)
        if m:
            out[m.group(1)] = m.group(2)
    return out


def load_pages(caps, text_cap=None):
    """Every page captured under caps/: digest fields the jobs read, keyed by URL."""
    pages = {}
    for idx in sorted(glob.glob(os.path.join(caps, "*", "index.json"))):
        shard = os.path.dirname(idx)
        for row in json.load(open(idx)):
            dg = os.path.join(shard, row["slug"], "digest.json")
            d = json.load(open(dg)) if os.path.exists(dg) and not row.get("skipped") else {}
            status = d.get("httpStatus") or row.get("httpStatus")
            bad = isinstance(status, int) and status >= 400
            pages[row["pageUrl"]] = {"url": row["pageUrl"], "parent": row.get("parent"), "skipped": row.get("skipped"),
                                     "navError": d.get("navError") or row.get("navError"),
                                     "error": d.get("error") or row.get("error") or (f"HTTP {status}" if bad else None),
                                     "title": d.get("title", ""), "text": "" if bad else d.get("text", ""),
                                     "links": [] if bad else trim_links(d.get("links", [])),
                                     "scripts": d.get("scripts", []), "iframes": d.get("iframes", []),
                                     "responseHosts": dict(sorted(d.get("responseHosts", {}).items(), key=lambda x: -x[1])[:25]),
                                     "pdfLinks": d.get("pdfLinks", []), "facebook": d.get("facebook", []),
                                     "pdf": bool(d.get("pdf") or row.get("pdf")), "probe": bool(row.get("probe")),
                                     "looksLikeBoard": bool(d.get("looksLikeBoard")), "fixture": f"{os.path.relpath(shard, caps)}/{row['slug']}" if row.get("kept") else None}
    return pages


def group_by_seed(caps, pages):
    """Pages per listed key (the comment after each list.txt URL), following parents back to the listed page."""
    seeds = seed_companies(open(os.path.join(caps, "list.txt")).read())
    by = {}
    for url, p in pages.items():
        root = url
        for _ in range(4):
            if pages.get(root, {}).get("parent"):
                root = pages[root]["parent"]
        c = seeds.get(root) or seeds.get(url)
        if c:
            by.setdefault(c, []).append(p)
    for ps in by.values():
        ps.sort(key=lambda p: (p.get("parent") is not None, p.get("probe", False), p["url"]))
    return by


def build_bundle(caps):
    wl = json.load(open(os.path.join(caps, "worklist.json")))
    comp = {c["company"]: c for c in wl["companies"]}
    by = group_by_seed(caps, load_pages(caps))
    rows = []
    for c, ps in by.items():
        meta = comp.get(c, {"company": c})
        live = [p for p in ps if p.get("text")]
        per = max(MIN_PAGE_TEXT, TEXT_BUDGET // max(1, len(live)))
        for p in ps:
            p["text"] = (p.get("text") or "")[:per]
        rows.append({"company": c, "names": meta.get("names", [])[:12], "realRows": meta.get("realRows", 0),
                     "upperMidwest": meta.get("upperMidwest", 0), "states": meta.get("states", {}),
                     "towns": meta.get("towns", [])[:40], "alsoRead": bool(meta.get("alsoRead")), "pages": ps})
    rows.sort(key=lambda r: (-(r["upperMidwest"] > 0), -r["realRows"], r["company"]))
    out = {"job": "elevsites", "caps": os.path.basename(caps), "elevsite": rows}
    if os.environ.get("ELEVSITES_MERGE_WITH"):
        out["mergeWith"] = re.sub(r"[^a-zA-Z0-9_-]", "", os.environ["ELEVSITES_MERGE_WITH"])
    return out


# ── collect ───────────────────────────────────────────────────────────────
def norm(s):
    return re.sub(r"\s+", " ", str(s or "")).strip().lower()


def seen_urls(e):
    out = set()
    for p in e["pages"]:
        out.add(p["url"])
        out.update(l["url"] for l in p.get("links", []))
        out.update(p.get("iframes", []))
        out.update(l["url"] for l in p.get("pdfLinks", []))
        out.update(p.get("facebook", []))
    return {u.rstrip("/") for u in out}


def check(e, a):
    """The model's answer, kept only where the saved pages back it."""
    flags = []
    if not isinstance(a, dict):
        return {"company": e["company"], "has_cash_bids": "unclear", "platform": "other", "confidence": "low",
                "flags": ["no answer"], "bid_page_url": "", "locations_seen": [], "evidence_quote": ""}
    out = {k: a.get(k) for k in ("has_cash_bids", "bid_page_url", "platform", "platform_evidence", "locations_seen",
                                 "confidence", "evidence_quote", "notes")}
    out["company"] = e["company"]
    if out["has_cash_bids"] not in ("yes", "no", "unclear"):
        out["has_cash_bids"] = "unclear"; flags.append("bad has_cash_bids")
    if out["platform"] not in PLATFORMS:
        flags.append(f"platform not in the list: {out['platform']}"); out["platform"] = "other"
    if out["confidence"] not in ("high", "medium", "low"):
        out["confidence"] = "low"
    url = str(out.get("bid_page_url") or "").strip()
    if url and url.rstrip("/") not in seen_urls(e):
        flags.append("bid_page_url not in the saved pages; dropped"); url = ""
    out["bid_page_url"] = url
    q = norm(out.get("evidence_quote"))
    alltext = norm(" ".join(p.get("text", "") for p in e["pages"]))
    if q and q not in alltext:
        flags.append("evidence_quote not found in the saved text"); out["confidence"] = "low"
        if out["has_cash_bids"] == "yes":
            out["has_cash_bids"] = "unclear"
    if out["has_cash_bids"] == "yes" and not (q or url):
        out["has_cash_bids"] = "unclear"; flags.append("yes with no quote and no page")
    if re.search(r"\$\s?\d|\b\d{1,2}\.\d{2}\b", " ".join(str(out.get(k) or "") for k in ("notes", "platform_evidence"))):
        flags.append("a number in notes or evidence")
    locs = out.get("locations_seen") if isinstance(out.get("locations_seen"), list) else []
    out["locations_seen"] = [str(x)[:80] for x in locs[:60] if norm(x) and norm(x) in alltext]
    if len(out["locations_seen"]) < len(locs[:60]):
        flags.append(f"{len(locs[:60]) - len(out['locations_seen'])} location name(s) not in the saved text; dropped")
    out["flags"] = flags
    fx = [p["fixture"] for p in e["pages"] if p.get("fixture") and (not url or p["url"].rstrip("/") == url.rstrip("/"))]
    out["fixture"] = fx[0] if fx else None
    return out


def collect(bundle, results):
    items = results.get("items", {})
    rows = []
    for e in bundle["elevsite"]:
        it = items.get(cid_of(e["company"]), {})
        a = check(e, it.get("parsed")) if it.get("result") == "succeeded" else check(e, None)
        a.update(realRows=e["realRows"], upperMidwest=e["upperMidwest"], states=e["states"], alsoRead=e.get("alsoRead", False),
                 result=it.get("result", "missing"))
        rows.append(a)
    return ranked_todo(rows, {"job": "elevsites", "caps": bundle.get("caps"), "batch": results.get("batch_id"),
                              "actual_cost_usd": results.get("actual_cost_usd")})


def ranked_todo(rows, head):
    plats = {}
    for r in rows:
        k = r["platform"] if r["has_cash_bids"] == "yes" else ("unclear" if r["has_cash_bids"] == "unclear" else "no bids")
        plats.setdefault(k, []).append(r)
    ranked = []
    for k, rs in plats.items():
        rs.sort(key=lambda r: (-r["upperMidwest"], -r["realRows"], r["company"]))
        ranked.append({"platform": k, "action": ("point existing reader: " + EXISTING_READER[k]) if k in EXISTING_READER
                       else ("no reader yet" if k not in ("unclear", "no bids") else ("a person looks" if k == "unclear" else "nothing to read")),
                       "companies": len(rs), "rows": sum(r["realRows"] for r in rs),
                       "upperMidwestRows": sum(r["upperMidwest"] for r in rs), "items": rs})
    order = lambda g: (g["platform"] in ("unclear", "no bids"), g["platform"] not in EXISTING_READER, -g["upperMidwestRows"], -g["rows"])
    ranked.sort(key=order)
    return dict(head, counts={"companies": len(rows), "yes": sum(r["has_cash_bids"] == "yes" for r in rows),
                              "no": sum(r["has_cash_bids"] == "no" for r in rows), "unclear": sum(r["has_cash_bids"] == "unclear" for r in rows),
                              "flagged": sum(bool(r["flags"]) for r in rows)},
                platforms=ranked)


def merge(v1, v2):
    """Round two's answers in place of round one's for the companies it re-read; the same ranking."""
    new = {r["company"]: dict(r, round=2) for g in v2["platforms"] for r in g["items"] if r.get("result") == "succeeded"}
    rows, changed = [], {}
    for g in v1["platforms"]:
        for r in g["items"]:
            n = new.get(r["company"])
            if n:
                key = f"{r['has_cash_bids']} -> {n['has_cash_bids']}"
                changed[key] = changed.get(key, 0) + 1
            rows.append(n or dict(r, round=1))
    t = ranked_todo(rows, {"job": "elevsites", "caps": f"{v1.get('caps')} + {v2.get('caps')}", "batch": f"{v1.get('batch')} + {v2.get('batch')}",
                           "actual_cost_usd": round((v1.get("actual_cost_usd") or 0) + (v2.get("actual_cost_usd") or 0), 4)})
    t["round2"] = {"reread": len(new), "changed": changed}
    return t


def markdown(todo):
    c = todo["counts"]
    L = [f"# Unread elevators' own sites: what to read next ({todo.get('caps')})", "",
         f"{c['companies']} companies read from saved copies: {c['yes']} post bids, {c['no']} do not, {c['unclear']} unclear "
         f"({c['flagged']} answers had something dropped by the checks). Batch {todo.get('batch')}, cost ${todo.get('actual_cost_usd')}.",
         "", "Every answer was checked against the saved pages: a bid page URL must be one we saved or saw linked, the quote must be "
         "in the saved text, and town names not in the text are dropped. These are findings for a person, not manifests.", "",
         *([f"Round two re-read {todo['round2']['reread']} of the unclear companies (deeper capture): "
            + ", ".join(f"{k}: {v}" for k, v in sorted(todo['round2']['changed'].items())), ""] if todo.get("round2") else []),
         "| Platform | Next step | Companies | Unread rows | Upper Midwest rows |", "|---|---|---|---|---|"]
    for g in todo["platforms"]:
        L.append(f"| {g['platform']} | {g['action']} | {g['companies']} | {g['rows']} | {g['upperMidwestRows']} |")
    for g in todo["platforms"]:
        if g["platform"] == "no bids":
            continue
        L += ["", f"## {g['platform']} ({g['action']})", "",
              "| Company | Rows (UM) | Bid page | Locations seen | Conf. | Fixture | Flags |", "|---|---|---|---|---|---|---|"]
        for r in g["items"]:
            L.append(f"| {r['company']}{' (also read elsewhere)' if r.get('alsoRead') else ''} | {r['realRows']} ({r['upperMidwest']}) | "
                     f"{r['bid_page_url'] or ''} | {len(r['locations_seen'])} | {r['confidence']} | {r.get('fixture') or ''} | "
                     f"{'; '.join(r['flags'])} |")
    return "\n".join(L) + "\n"


def selftest():
    e = {"company": "MEYER BROTHERS GRAIN", "names": ["Meyer Brothers Grain"], "realRows": 3, "upperMidwest": 3, "states": {"WI": 3},
         "towns": ["Elk Mound, WI"], "pages": [
             {"url": "https://meyergrain.com/", "parent": None, "title": "Meyer", "text": "Welcome. Cash Bids", "links": [
                 {"url": "https://meyergrain.com/cash-bids", "text": "Cash Bids"}], "scripts": [], "iframes": [], "responseHosts": {}},
             {"url": "https://meyergrain.com/cash-bids", "parent": "https://meyergrain.com/", "title": "Cash Bids",
              "text": "Elk Mound | Corn | Nov | -0.45\nMenomonie | Corn", "links": [], "scripts": ["https://www.dtnpf.com/x.js"],
              "iframes": [], "responseHosts": {"dtnpf.com": 3}, "fixture": "captures-2/meyergrain-com-cash-bids"}]}
    p = prompt(e)
    assert "Scripts: https://www.dtnpf.com/x.js" in p and "(linked from https://meyergrain.com/)" in p and "Elk Mound, WI" in p
    good = {"has_cash_bids": "yes", "bid_page_url": "https://meyergrain.com/cash-bids/", "platform": "dtn", "confidence": "high",
            "evidence_quote": "Elk Mound | Corn", "locations_seen": ["Elk Mound", "Menomonie", "Chippewa Falls"], "notes": ""}
    a = check(e, good)
    assert a["has_cash_bids"] == "yes" and a["bid_page_url"] and a["locations_seen"] == ["Elk Mound", "Menomonie"], a
    assert a["fixture"] == "captures-2/meyergrain-com-cash-bids"
    bad = dict(good, bid_page_url="https://meyergrain.com/invented", evidence_quote="Corn 4.12 at Elk Mound", platform="dtn/agricharts")
    b = check(e, bad)
    assert b["bid_page_url"] == "" and b["has_cash_bids"] == "unclear" and b["confidence"] == "low" and b["platform"] == "other", b
    assert check(e, None)["has_cash_bids"] == "unclear"
    res = {"batch_id": "x", "actual_cost_usd": 1.0, "items": {cid_of(e["company"]): {"result": "succeeded", "parsed": good}}}
    todo = collect({"elevsite": [e], "caps": "c"}, res)
    assert todo["platforms"][0]["platform"] == "dtn" and todo["platforms"][0]["action"].startswith("point existing reader")
    assert todo["counts"]["yes"] == 1 and "| dtn |" in markdown(todo)
    assert all(p in PLATFORMS for p in EXISTING_READER)
    # round two: a re-read answer replaces round one's, the rest stay, the ranking is the same
    v1 = collect({"elevsite": [e, dict(e, company="OTHER CO")], "caps": "c1"},
                 {"batch_id": "b1", "actual_cost_usd": 1.0, "items": {cid_of("OTHER CO"): {"result": "succeeded", "parsed": dict(good, has_cash_bids="unclear")}}})
    assert v1["counts"]["unclear"] == 2
    m = merge(v1, todo)
    assert m["counts"] == {"companies": 2, "yes": 1, "no": 0, "unclear": 1, "flagged": 2}, m["counts"]
    assert m["round2"] == {"reread": 1, "changed": {"unclear -> yes": 1}} and m["actual_cost_usd"] == 2.0
    assert "Round two re-read 1" in markdown(m)
    print("elevsites selftest ok")


if __name__ == "__main__":
    a = sys.argv[1:]
    if not a or a[0] == "selftest":
        selftest()
    elif a[0] == "bundle":
        b = build_bundle(newest_caps(a[1]))
        os.makedirs(os.path.dirname(a[2]) or ".", exist_ok=True)
        # the site owners' own keys out before the bundle goes to the API or to raw (push protection)
        from redact_secrets import redact
        text, n = redact(json.dumps(b))
        open(a[2], "w").write(text)
        print(f"redacted {n} secret-looking string(s) from the captures")
        print(f"::notice title=elevsites bundle::{len(b['elevsite'])} companies from {b['caps']}")
    elif a[0] == "merge":
        t = merge(json.load(open(a[1])), json.load(open(a[2])))
        os.makedirs(a[3], exist_ok=True)
        json.dump(t, open(os.path.join(a[3], "todo-v2.json"), "w"), indent=1)
        open(os.path.join(a[3], "todo-v2.md"), "w").write(markdown(t))
        print(f"::notice title=elevsites to-do v2::{t['counts']} {t['round2']}")
    elif a[0] == "collect":
        todo = collect(json.load(open(a[1])), json.load(open(a[2])))
        os.makedirs(a[3], exist_ok=True)
        json.dump(todo, open(os.path.join(a[3], "todo.json"), "w"), indent=1)
        open(os.path.join(a[3], "todo.md"), "w").write(markdown(todo))
        print(f"::notice title=elevsites to-do::{todo['counts']}")
    else:
        sys.exit("modes: selftest | bundle CAPS_CLONE OUT | collect BUNDLE RESULTS DIR | merge V1_TODO V2_TODO DIR")
