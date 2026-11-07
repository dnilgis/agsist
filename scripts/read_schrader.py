#!/usr/bin/env python3
"""
AGSIST -- read Schrader Real Estate and Auction Co.'s result pages into auction records.

Step 2 of the auction results reader. Input is one capture folder written by
scripts/capture_schrader.py (index-sold.rss plus auctions/<NNNN>.html); output is
data/land/auctions/schrader.json.

One record per auction, one tract entry per row of Schrader's result table:
  {source: "schrader", auction_id, url, date, state, county, county_fips,
   headline_acres, total_sold, tracts: [{tracts: "1+2+4+5+7", sold: 1660000,
   per_acre: 9459 or null}], kind: "auction", credit}
Facts only. There is no buyer field, and nothing from the page outside the title,
the county and state, the auction date, the acres and the result table is read.

Per acre is Schrader's own printed figure. A row without one (often the house
tract) gets null; a per-acre figure is never worked out here.

Farmland only: an auction is kept when any row carries a per-acre figure or the
headline acres are 20 or more. The rest are counted (dropped_not_farmland), never
stored. headline_acres comes from the feed title when it gives one, else the page's
Acres fact, else the page title.

The output keeps history: records already in the file stay (the feed only ever
shows the newest five sales), a record seen again replaces the saved one only when
every saved value comes back unchanged and only new tract rows are added (any other
difference is refused, logged and counted), and a run that would leave fewer records than the file had
writes nothing and exits 1.

  python3 scripts/read_schrader.py --latest              # newest folder under land/schrader/capture
  python3 scripts/read_schrader.py --capture <folder>    # one folder
  python3 scripts/read_schrader.py --latest --out <file>  # write elsewhere (the capture job's facts-only file)
  python3 scripts/read_schrader.py --merge <file>        # check every record of that file, merge it in
  python3 scripts/read_schrader.py --selftest            # fixtures in test/fixtures/schrader

In Actions the capture job (read-only, no stored credentials) reads its fresh capture into a
facts-only file; the commit job checks every record of that file against the shape above and the
county join, merges it under the same guard and commits data/land/auctions/schrader.json. The raw
pages never leave the capture job except to the private raw branch.
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import html
import json
import os
import re
import sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from atlas_common import county_index, norm_name  # noqa: E402  the repo's one county name to FIPS join
from county_rain import STATES  # noqa: E402  {"IN": "Indiana", ...}

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CAPTURES = os.path.join(ROOT, "land", "schrader", "capture")
OUT = os.path.join(ROOT, "data", "land", "auctions", "schrader.json")
FIXTURES = os.path.join(ROOT, "test", "fixtures", "schrader")
BASE = "https://www.schraderauction.com"
CREDIT = "Sold/auction results reported by Schrader Real Estate and Auction Co."
CREDIT_URL = BASE + "/auctions/recent_auctions"
MIN_ACRES = 20
ABBR = {v.lower(): k for k, v in STATES.items()}
MONTHS = {m: i for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}

ACRES_RE = re.compile(r"(\d[\d,]*(?:\.\d+)?|\.\d+)\s*\+/-\s*ACRES?\b", re.I)
MONEY_RE = re.compile(r"^\$\s*(\d[\d,]*)$")
COUNTY_NAME = re.compile(r"[A-Za-z .'-]{2,30}")
PER_ACRE_RE = re.compile(r"^\$\s*(\d[\d,]*)\s*/\s*acre$", re.I)


def text(s):
    """Tags dropped, entities decoded, white space folded."""
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]*>", " ", s or ""))).strip()


def money(s):
    m = MONEY_RE.match(text(s))
    return int(m.group(1).replace(",", "")) if m else None


def acres_in(s):
    m = ACRES_RE.search(s or "")
    return float(m.group(1).replace(",", "")) if m else None


def day(s):
    """'Thu, Nov  5, 2026 ET' -> '2026-11-05'; None when it does not read."""
    m = re.search(r"\b([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),\s*(\d{4})\b", s or "")
    if not m or m.group(1).lower() not in MONTHS:
        return None
    try:
        return datetime(int(m.group(3)), MONTHS[m.group(1).lower()], int(m.group(2))).strftime("%Y-%m-%d")
    except ValueError:
        return None


def parse_feed(feed):
    """{auction_id: {"title", "date"}} from index-sold.rss (bytes or str)."""
    if isinstance(feed, bytes):
        feed = feed.decode("utf-8", "replace")
    out = {}
    for item in re.findall(r"<item\b.*?</item\s*>", feed, re.I | re.S):
        link = re.search(r"<link>\s*([^<\s]+)", item)
        m = re.search(r"/auctions/(\d{1,7})/?$", link.group(1)) if link else None
        if not m:
            continue
        title = re.search(r"<title>(.*?)</title>", item, re.S)
        pub = re.search(r"<pubDate>(.*?)</pubDate>", item, re.S)
        pd = None
        if pub:
            p = re.search(r"(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})", pub.group(1))
            if p and p.group(2).lower() in MONTHS:
                pd = "%s-%02d-%02d" % (p.group(3), MONTHS[p.group(2).lower()], int(p.group(1)))
        out[m.group(1)] = {"title": text(title.group(1)) if title else "", "date": pd}
    return out


def fact(page, label):
    m = re.search(r"<span[^>]*>\s*" + re.escape(label) + r"\s*</span>\s*<strong[^>]*>(.*?)</strong>", page, re.S | re.I)
    return text(m.group(1)) if m else ""


def place(page):
    """(county name, state abbreviation) from the where line ("<address> - <Name> County, <State>"),
    else the page title ("... IN <NAME> COUNTY, <STATE>"). A candidate that is not a plain county-name
    shape is no answer: the where line also holds the street address and the owner, and none of that
    may ever reach the output (parse_page also requires the FIPS join to match)."""
    m = re.search(r'<p class="where">(.*?)</p>', page, re.S)
    if m:
        w = text(m.group(1)).split(" \u00b7 ")[0]
        c = re.search(r"\s-\s([^-]+?)\s+County,\s*([A-Za-z][A-Za-z ]*?)\s*$", w)
        if c and c.group(2).lower() in ABBR and COUNTY_NAME.fullmatch(c.group(1).strip()):
            return c.group(1).strip(), ABBR[c.group(2).lower()]
    h = re.search(r"<h1>(.*?)</h1>", page, re.S)
    if h:
        c = re.search(r"\bIN\s+([A-Z][A-Z .'-]*?)\s+COUNTY,\s*([A-Z][A-Z ]*?)\s*$", text(h.group(1)))
        if c and c.group(2).lower() in ABBR and COUNTY_NAME.fullmatch(c.group(1).strip()):
            return c.group(1).title(), ABBR[c.group(2).lower()]
    return None, None


def parse_page(page, auction_id, feed_item=None, idx=None):
    """One record, or None when the page carries no result table."""
    if isinstance(page, bytes):
        page = page.decode("utf-8", "replace")
    box = re.search(r'<div class="sold-box">(.*?)</table>', page, re.S)
    if not box:
        return None
    tot = re.search(r"Total Sold:\s*(\$[\d,]+)", text(box.group(1)))
    body = re.search(r"<tbody>(.*?)</tbody>", box.group(1), re.S)
    rows = []
    for tr in re.findall(r"<tr>(.*?)</tr>", body.group(1) if body else "", re.S):
        tds = re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S)
        if len(tds) < 2:
            continue
        sold = money(tds[1])
        tracts = re.sub(r"\s+", "", text(tds[0]))
        if sold is None or not re.fullmatch(r"\d+[A-Za-z]?(?:\+\d+[A-Za-z]?)*", tracts):
            continue
        pa = PER_ACRE_RE.match(text(tds[2])) if len(tds) > 2 else None
        rows.append({"tracts": tracts, "sold": sold, "per_acre": int(pa.group(1).replace(",", "")) if pa else None})
    if not rows:
        return None
    h1 = re.search(r"<h1>(.*?)</h1>", page, re.S)
    title = text(h1.group(1)) if h1 else ""
    feed_item = feed_item or {}
    acres = acres_in(feed_item.get("title"))
    if acres is None:
        a = re.match(r"(\d[\d,]*(?:\.\d+)?)", fact(page, "Acres"))
        acres = float(a.group(1).replace(",", "")) if a else acres_in(title)
    county, st = place(page)
    fips = idx.get((st, norm_name(county))) if county and idx is not None else None
    if fips is None:
        # county text is shown only when it joined to a real county; the record is then dropped
        # (read_capture counts it). The text itself is never printed: job logs are public.
        county = st = None
        print(f"read_schrader: {auction_id}: no county matched; the record is dropped")
    return {
        "source": "schrader",
        "auction_id": str(auction_id),
        "url": f"{BASE}/auctions/{auction_id}",
        "date": day(fact(page, "Auction date")) or feed_item.get("date"),
        "state": st,
        "county": county,
        "county_fips": fips,
        "headline_acres": int(acres) if acres is not None and acres == int(acres) else acres,
        "total_sold": money(tot.group(1)) if tot else None,
        "tracts": rows,
        "kind": "auction",
        "credit": CREDIT,
    }


def is_farmland(rec):
    return any(r["per_acre"] is not None for r in rec["tracts"]) or (rec["headline_acres"] or 0) >= MIN_ACRES


def read_capture(folder, idx=None):
    """(kept records, counts) for one capture folder."""
    feed = {}
    fp = os.path.join(folder, "index-sold.rss")
    if os.path.exists(fp):
        with open(fp, "rb") as fh:
            feed = parse_feed(fh.read())
    captured = None
    mp = os.path.join(folder, "manifest.json")
    if os.path.exists(mp):
        with open(mp, encoding="utf-8") as fh:
            captured = (json.load(fh).get("captured_utc") or "")[:10] or None
    captured = captured or (os.path.basename(os.path.normpath(folder)) if re.fullmatch(r"\d{4}-\d{2}-\d{2}", os.path.basename(os.path.normpath(folder))) else None)
    kept, n = [], {"pages": 0, "kept": 0, "dropped_not_farmland": 0, "no_result": 0, "dropped_future_date": 0, "dropped_no_county": 0}
    adir = os.path.join(folder, "auctions")
    for f in sorted(os.listdir(adir)) if os.path.isdir(adir) else []:
        m = re.fullmatch(r"(\d{1,7})\.html", f)
        if not m:
            continue
        n["pages"] += 1
        with open(os.path.join(adir, f), "rb") as fh:
            rec = parse_page(fh.read(), m.group(1), feed.get(m.group(1)), idx)
        if rec is None:
            n["no_result"] += 1
        elif not is_farmland(rec):
            n["dropped_not_farmland"] += 1
        elif rec["county_fips"] is None:
            n["dropped_no_county"] += 1
        elif captured and rec["date"] and rec["date"] > captured:
            n["dropped_future_date"] += 1  # a result dated after the capture is not a result yet
        else:
            kept.append(rec)
    n["kept"] = len(kept)
    return kept, n, captured


def merge(old, new, stats=None):
    """Old records stay. A new auction_id is added. A record seen again replaces the saved one only when
    every other field is the same and the saved tract rows come back unchanged, in order, with new rows
    after them; any other difference is refused and counted, so a later parse never rewrites history."""
    by = {r["auction_id"]: r for r in old}
    refused = 0
    for r in new:
        prev = by.get(r["auction_id"])
        if prev is None:
            by[r["auction_id"]] = r
            continue
        if r == prev:
            continue
        same_rest = {k: v for k, v in r.items() if k != "tracts"} == {k: v for k, v in prev.items() if k != "tracts"}
        pt, nt = prev["tracts"], r["tracts"]
        if same_rest and len(nt) > len(pt) and nt[:len(pt)] == pt:
            by[r["auction_id"]] = r
        else:
            refused += 1
            print(f"read_schrader: {r['auction_id']}: the new parse differs from the saved record; kept the saved one")
    if refused:
        print(f"read_schrader: refused {refused} overwrite(s) of saved records")
    if stats is not None:
        stats["refused_overwrites"] = refused
    return sorted(by.values(), key=lambda r: (r["date"] or "", int(r["auction_id"])))


def build(folder, out=OUT, idx=None):
    """Read one capture folder and merge it into `out`. Returns an exit code."""
    idx = idx if idx is not None else county_index()
    new, counts, captured = read_capture(folder, idx)
    code = write_merged(out, new, dict(counts, captured=captured), captured)
    print(f"read_schrader: {counts['pages']} page(s), {counts['kept']} kept, {counts['dropped_not_farmland']} not farmland, "
          f"{counts['dropped_no_county']} with no county match, {counts['no_result']} with no result table")
    return code


def write_merged(out, new, last_run, checked):
    """Merge `new` records into the file at `out` under the guard. Returns an exit code."""
    old = {}
    if os.path.exists(out):
        with open(out, encoding="utf-8") as fh:
            old = json.load(fh)
    prev = old.get("records") or []
    recs = merge(prev, new)
    if len(recs) < len(prev):
        print(f"read_schrader: refusing to write {len(recs)} record(s) over {len(prev)}")
        return 1
    doc = {"source": "schrader", "credit": CREDIT, "credit_url": CREDIT_URL,
           "checked": max(filter(None, [checked, old.get("checked")]), default=None),
           "last_run": last_run, "records": recs}
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    tmp = out + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, indent=1, sort_keys=True)
        fh.write("\n")
    os.replace(tmp, out)
    print(f"read_schrader: {len(recs)} record(s) in {os.path.relpath(out, ROOT)}")
    return 0


KEYS = {"source", "auction_id", "url", "date", "state", "county", "county_fips", "headline_acres",
        "total_sold", "tracts", "kind", "credit"}
LAST_RUN_KEYS = {"pages", "kept", "dropped_not_farmland", "no_result", "dropped_future_date", "dropped_no_county", "captured"}


def valid(rec, idx):
    """True when a record has exactly the reader's shape: the commit job checks every record it
    takes from the capture job's file, so nothing but these facts can reach main."""
    try:
        num = lambda v: isinstance(v, (int, float)) and not isinstance(v, bool)
        ok = (isinstance(rec, dict) and set(rec) == KEYS and rec["source"] == "schrader" and rec["kind"] == "auction"
              and rec["credit"] == CREDIT and re.fullmatch(r"\d{1,7}", rec["auction_id"])
              and rec["url"] == f"{BASE}/auctions/{rec['auction_id']}"
              and re.fullmatch(r"\d{4}-\d{2}-\d{2}", rec["date"]) and rec["state"] in STATES
              and COUNTY_NAME.fullmatch(rec["county"]) and idx.get((rec["state"], norm_name(rec["county"]))) == rec["county_fips"]
              and (rec["headline_acres"] is None or num(rec["headline_acres"]))
              and (rec["total_sold"] is None or type(rec["total_sold"]) is int)
              and isinstance(rec["tracts"], list) and rec["tracts"]
              and all(isinstance(x, dict) and set(x) == {"tracts", "sold", "per_acre"}
                      and re.fullmatch(r"\d+[A-Za-z]?(?:\+\d+[A-Za-z]?)*", x["tracts"]) and type(x["sold"]) is int
                      and (x["per_acre"] is None or type(x["per_acre"]) is int) for x in rec["tracts"])
              and is_farmland(rec))
        return bool(ok)
    except (KeyError, TypeError, AttributeError):
        return False


def merge_file(src, out=OUT, idx=None):
    """--merge: take the records of a file the capture job wrote, check each, and merge them into `out`."""
    idx = idx if idx is not None else county_index()
    with open(src, encoding="utf-8") as fh:
        doc = json.load(fh)
    recs = doc.get("records") if isinstance(doc, dict) else None
    if not isinstance(recs, list):
        print("read_schrader: the file to merge has no records list")
        return 1
    good = [r for r in recs if valid(r, idx)]
    if len(good) != len(recs):
        print(f"read_schrader: {len(recs) - len(good)} record(s) in the file to merge are not in the reader's shape; nothing written")
        return 1
    lr = doc.get("last_run") if isinstance(doc.get("last_run"), dict) else {}
    lr = {k: v for k, v in lr.items() if k in LAST_RUN_KEYS and (isinstance(v, int) or (k == "captured" and isinstance(v, str)
          and re.fullmatch(r"\d{4}-\d{2}-\d{2}", v)))}
    return write_merged(out, good, lr, lr.get("captured"))


def latest(base=CAPTURES):
    days = sorted(d for d in os.listdir(base) if re.fullmatch(r"\d{4}-\d{2}-\d{2}", d)) if os.path.isdir(base) else []
    return os.path.join(base, days[-1]) if days else None


# ---------------------------------------------------------------- selftest

def selftest():
    import shutil
    import tempfile
    fails = []

    def check(ok, what):
        print(("ok   " if ok else "FAIL ") + what)
        if not ok:
            fails.append(what)

    idx = county_index()
    tmp = tempfile.mkdtemp(prefix="schrader-read-")
    try:
        cap = os.path.join(tmp, "2026-11-07")
        os.makedirs(os.path.join(cap, "auctions"))
        for f in os.listdir(FIXTURES):
            dst = os.path.join(cap, f) if f.endswith(".rss") else os.path.join(cap, "auctions", f)
            shutil.copy(os.path.join(FIXTURES, f), dst)
        recs, n, captured = read_capture(cap, idx)
        by = {r["auction_id"]: r for r in recs}
        check(captured == "2026-11-07", "the capture date comes from the folder name when there is no manifest")
        check(n["pages"] == 5 and sorted(by) == ["9580", "9630"] and n["dropped_not_farmland"] == 3 and n["no_result"] == 0,
              f"five fixture pages: 9580 and 9630 kept, three small parcels dropped ({n})")
        r = by.get("9630") or {}
        check(r.get("tracts") == [{"tracts": "1+2+4+5+7", "sold": 1660000, "per_acre": 9459},
                                  {"tracts": "3", "sold": 245000, "per_acre": None},
                                  {"tracts": "6+8", "sold": 1000000, "per_acre": 9709}], "9630: the three rows as printed")
        check(r.get("total_sold") == 2905000 and r.get("date") == "2026-11-05", "9630: total $2,905,000, sold Nov 5, 2026")
        check(r.get("state") == "IN" and r.get("county") == "Wayne" and r.get("county_fips") == "18177", "9630: Wayne County, IN, 18177")
        check(r.get("headline_acres") == 296.5 and r.get("kind") == "auction" and r.get("url") == BASE + "/auctions/9630",
              "9630: 296.5 headline acres, kind auction, its own link")
        r = by.get("9580") or {}
        check(r.get("county_fips") == "18083" and r.get("headline_acres") == 331 and r.get("total_sold") == 1820000
              and [x["per_acre"] for x in r.get("tracts", [])] == [7030, 3976], "9580: Knox County, 331 acres, both rows per acre")
        bad = {k for rec in recs for k in rec} & {"buyer", "buyers", "purchaser", "owner", "name", "bidder"}
        check(not bad, "no buyer, owner or name field in any record")

        page = open(os.path.join(FIXTURES, "9630.html"), encoding="utf-8").read()
        check(parse_page(page.replace('<div class="sold-box">', '<div class="x">'), "1", None, idx) is None,
              "a page with no result table gives no record")
        odd = page.replace("$9,709/acre", "see brochure")
        check(parse_page(odd, "1", None, idx)["tracts"][2]["per_acre"] is None, "a per-acre cell that is not a figure gives null")
        noacre = page.replace("$9,459/acre", "").replace("$9,709/acre", "")
        rec = parse_page(noacre, "1", {"title": "SOLD for $1: 12+/-ACRES IN X"}, idx)
        check(rec["headline_acres"] == 12 and not is_farmland(rec), "the feed title's acres win; under 20 with no per acre is dropped")
        rec = parse_page(noacre, "1", None, idx)
        check(rec["headline_acres"] == 296.5 and is_farmland(rec) and all(x["per_acre"] is None for x in rec["tracts"]),
              "no feed title: the Acres fact; 20 acres or more keeps it, and no per acre is filled in")
        stj = page.replace("Wayne County, Indiana &middot;", "St. Joseph County, Indiana &middot;")
        check(parse_page(stj, "1", None, idx)["county_fips"] == "18141", "St. Joseph County joins through the shared name rules")
        nowhere = re.sub(r'<p class="where">.*?</p>', "", page, flags=re.S)
        r2 = parse_page(nowhere, "1", None, idx)
        check(r2["county"] == "Wayne" and r2["state"] == "IN", "no where line: county and state from the title")
        check(acres_in("-.15+/-ACRE OFFERED") == 0.15 and acres_in("1,200+/-ACRES") == 1200.0, "acres read from titles")
        check(day("Thu, Nov  5, 2026 ET") == "2026-11-05" and day("nonsense") is None, "auction date read; junk gives none")
        feed = parse_feed(open(os.path.join(FIXTURES, "index-sold.rss"), "rb").read())
        check(len(feed) == 5 and feed["9629"]["date"] == "2026-10-29", "five feed items with their dates")
        future = page.replace("Thu, Nov  5, 2026", "Thu, Nov 12, 2026")
        with open(os.path.join(cap, "auctions", "9630.html"), "w", encoding="utf-8") as fh:
            fh.write(future)
        _, n2, _ = read_capture(cap, idx)
        check(n2["dropped_future_date"] == 1 and n2["kept"] == 1, "a result dated after the capture is not kept")
        shutil.copy(os.path.join(FIXTURES, "9630.html"), os.path.join(cap, "auctions", "9630.html"))

        out = os.path.join(tmp, "out", "schrader.json")
        check(build(cap, out, idx) == 0, "build writes the file")
        doc = json.load(open(out, encoding="utf-8"))
        check([r["auction_id"] for r in doc["records"]] == ["9580", "9630"] and doc["credit"] == CREDIT
              and all(r["credit"] == CREDIT for r in doc["records"]), "records sorted by date, credit on the file and every record")
        check(doc["last_run"]["dropped_not_farmland"] == 3 and "9629" not in open(out, encoding="utf-8").read(),
              "dropped auctions are counted, never stored")
        old = dict(doc["records"][0], auction_id="9000", date="2026-01-02", url=BASE + "/auctions/9000")
        doc["records"].insert(0, old)
        json.dump(doc, open(out, "w", encoding="utf-8"))
        check(build(cap, out, idx) == 0 and [r["auction_id"] for r in json.load(open(out))["records"]] == ["9000", "9580", "9630"],
              "a saved record the feed no longer shows is kept (history)")
        os.remove(os.path.join(cap, "auctions", "9580.html"))
        check(build(cap, out, idx) == 0 and len(json.load(open(out))["records"]) == 3, "a page missing from this capture loses nothing")
        short = page.replace("<tr><td>6+8</td><td>$1,000,000</td><td>$9,709/acre</td></tr>", "")
        with open(os.path.join(cap, "auctions", "9630.html"), "w", encoding="utf-8") as fh:
            fh.write(short)
        build(cap, out, idx)
        check(len(next(r for r in json.load(open(out))["records"] if r["auction_id"] == "9630")["tracts"]) == 3,
              "a later parse with fewer rows does not replace the saved record")
        doc = json.load(open(out))
        doc["records"] += [dict(old, auction_id=str(8000 + i)) for i in range(3)]
        json.dump(doc, open(out, "w", encoding="utf-8"))
        before = open(out, encoding="utf-8").read()
        real_merge = globals()["merge"]
        globals()["merge"] = lambda o, nw: o[:2]
        try:
            check(build(cap, out, idx) == 1 and open(out, encoding="utf-8").read() == before,
                  "a run that would shrink the file writes nothing and exits 1")
        finally:
            globals()["merge"] = real_merge
        check(merge([dict(old, auction_id="1")], [dict(old, auction_id="1"), dict(old, auction_id="2")]).__len__() == 2,
              "deduped by auction_id")
        # the where line also carries the street address and the owner: none of it may leak (checker, PR #412)
        raw_bits = ("1234", "Elm", "46000", "Jane", "Example", "Town")
        for where in ("1234 Elm Rd, Town, IN 46000 Wayne County, Indiana",
                      "Jane Example Farm, Wayne County, Indiana",
                      "Jane Example - 1234 Elm Rd Wayne County, Indiana",
                      "[street address] - Jane Example Farm County, Indiana"):
            mp = re.sub(r'<p class="where">.*?</p>', f'<p class="where">{where} &middot; Owner: [owner]</p>', page, flags=re.S)
            r3 = parse_page(mp, "1", None, idx)
            dump = json.dumps(r3)
            check(not any(b in dump for b in raw_bits) and r3["county"] in ("Wayne", None),
                  "no raw where-line text leaks: " + where.replace("Jane Example", "[name]"))
            r4 = parse_page(re.sub(r"<h1>.*?</h1>", "<h1>LAND AUCTION</h1>", mp, flags=re.S), "1", None, idx)
            check(r4["county"] is None and r4["county_fips"] is None and not any(b in json.dumps(r4) for b in raw_bits),
                  "no title to fall back on: county left out: " + where.replace("Jane Example", "[name]"))
        bad_cap = os.path.join(tmp, "bad", "2026-11-07")
        os.makedirs(os.path.join(bad_cap, "auctions"))
        with open(os.path.join(bad_cap, "auctions", "9630.html"), "w", encoding="utf-8") as fh:
            fh.write(re.sub(r"<h1>.*?</h1>", "<h1>LAND AUCTION</h1>", re.sub(
                r'<p class="where">.*?</p>', '<p class="where">Jane Example Farm, Wayne County, Indiana</p>', page, flags=re.S), flags=re.S))
        recs3, n3, _ = read_capture(bad_cap, idx)
        check(recs3 == [] and n3["dropped_no_county"] == 1, "a record with no county match is dropped and counted")

        # --merge: the commit job takes only records in the reader's exact shape
        side = os.path.join(tmp, "side.json")
        check(build(cap, side, idx) == 0, "--out writes a facts-only file")
        tgt = os.path.join(tmp, "tgt.json")
        check(merge_file(side, tgt, idx) == 0 and len(json.load(open(tgt))["records"]) == len(json.load(open(side))["records"]),
              "--merge takes a clean file")
        good_doc = json.load(open(side))
        for label, mutate in (("an extra field", lambda r: r.update(buyer="x")),
                              ("county text that is not a county", lambda r: r.update(county="1234 Elm Rd")),
                              ("a county that does not match its FIPS", lambda r: r.update(county="Knox")),
                              ("a link off Schrader", lambda r: r.update(url="https://example.com/")),
                              ("a tract row with text", lambda r: r["tracts"][0].update(tracts="sold to [name]")),
                              ("a sold price that is a bool", lambda r: r["tracts"][0].update(sold=True)),
                              ("a per acre that is a bool", lambda r: r["tracts"][0].update(per_acre=False)),
                              ("a total that is a bool", lambda r: r.update(total_sold=True))):
            d = json.loads(json.dumps(good_doc))
            mutate(d["records"][0])
            json.dump(d, open(side, "w"))
            before = open(tgt).read()
            check(merge_file(side, tgt, idx) == 1 and open(tgt).read() == before, "--merge refuses " + label)
        # --merge never rewrites a saved record's values (checker, PR #412)
        json.dump(good_doc, open(side, "w"))
        tgt2 = os.path.join(tmp, "tgt2.json")
        check(merge_file(side, tgt2, idx) == 0, "--merge seeds an empty target")
        saved = open(tgt2).read()
        rid = good_doc["records"][0]["auction_id"]
        for label, mutate in (("a changed sold price", lambda r: r["tracts"][0].update(sold=r["tracts"][0]["sold"] + 1)),
                              ("a changed per acre", lambda r: r["tracts"][0].update(per_acre=(r["tracts"][0]["per_acre"] or 0) + 1)),
                              ("rows that differ plus a new row", lambda r: r["tracts"].__setitem__(0, dict(r["tracts"][0], sold=1))
                               or r["tracts"].append({"tracts": "99", "sold": 5, "per_acre": None})),
                              ("fewer rows", lambda r: r["tracts"].pop()),
                              ("a changed total", lambda r: r.update(total_sold=(r["total_sold"] or 0) + 1))):
            d = json.loads(json.dumps(good_doc))
            mutate(d["records"][0])
            json.dump(d, open(side, "w"))
            check(valid(d["records"][0], idx), "the changed record is still well formed: " + label)
            check(merge_file(side, tgt2, idx) == 0 and json.load(open(tgt2))["records"] == json.loads(saved)["records"],
                  "--merge keeps the saved record over " + label)
        st = {}
        d = json.loads(json.dumps(good_doc))
        d["records"][0]["tracts"][0]["sold"] += 1
        merge(json.loads(saved)["records"], d["records"], st)
        check(st == {"refused_overwrites": 1}, "a refused overwrite is counted")
        d = json.loads(json.dumps(good_doc))
        d["records"][0]["tracts"].append({"tracts": "99", "sold": 5, "per_acre": None})
        d["records"].append(dict(d["records"][0], auction_id="8999", url=BASE + "/auctions/8999"))
        json.dump(d, open(side, "w"))
        check(merge_file(side, tgt2, idx) == 0, "--merge takes identical rows plus a new row and a new auction")
        got = {r["auction_id"]: r for r in json.load(open(tgt2))["records"]}
        check(got[rid]["tracts"][-1] == {"tracts": "99", "sold": 5, "per_acre": None} and "8999" in got,
              "identical rows plus a new row replace the saved record; a new auction_id is added")
        st = {}
        merge(list(got.values()), list(got.values()), st)
        check(st == {"refused_overwrites": 0}, "the same records again change nothing and refuse nothing")
        check(latest(tmp) == cap and latest(os.path.join(tmp, "none")) is None, "--latest picks the newest dated folder")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    print(f"read_schrader selftest: {len(fails)} failure(s)")
    return 1 if fails else 0


def main(argv):
    if "--selftest" in argv:
        return selftest()
    def arg(flag):
        i = argv.index(flag)
        return argv[i + 1] if i + 1 < len(argv) else None
    out = arg("--out") if "--out" in argv else OUT
    if "--merge" in argv:
        src = arg("--merge")
        if not src or not os.path.isfile(src):
            print(f"read_schrader: no file to merge ({src})")
            return 1
        return merge_file(src, out)
    if "--capture" in argv:
        folder = arg("--capture")
    elif "--latest" in argv:
        folder = latest()
    else:
        print("read_schrader: give --latest, --capture <folder>, --merge <file> or --selftest")
        return 2
    if not folder or not os.path.isdir(folder):
        print(f"read_schrader: no capture folder ({folder})")
        return 1
    return build(folder, out)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
