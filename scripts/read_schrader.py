#!/usr/bin/env python3
"""
AGSIST -- read Schrader Real Estate and Auction Co.'s result pages into auction records.

Step 2 of the auction results reader. Input is one capture folder written by
scripts/capture_schrader.py (index-sold.rss plus auctions/<NNNN>.html, and for the archive
backfill auctions/<slug>.html); output is
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

Archive pages (the slug-named backfill, 2012 on) come in older layouts: the where line is free text
("Allegan County, Michigan", "Cecil, Ohio - Paulding County, Crane Township"), tract rows may be
ranges ("1-3+9"), and the auction date can follow "Real estate". A county is taken only when exactly
one is named and one state; several counties, no county (a town is never turned into one), two states,
or a slug that names another county are withheld and counted by reason. A printed per-acre figure
above $1,000,000 is a typo on the page and is left out. Numbered weekly pages keep the strict reading.

The output keeps history: records already in the file stay (the feed only ever
shows the newest five sales), a record seen again replaces the saved one only when
every saved value comes back unchanged and only new tract rows are added (any other
difference is refused, logged and counted), and a run that would leave fewer records than the file had
writes nothing and exits 1.

  python3 scripts/read_schrader.py --capture land/schrader/backfill --out <file>  # the saved archive pages
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
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from atlas_common import county_index, norm_name  # noqa: E402  the repo's one county name to FIPS join
from county_rain import STATES  # noqa: E402  {"IN": "Indiana", ...}

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CAPTURES = os.path.join(ROOT, "land", "schrader", "capture")
OUT = os.path.join(ROOT, "data", "land", "auctions", "schrader.json")
FIXTURES = os.path.join(ROOT, "test", "fixtures", "schrader")
FIXTURES_BACKFILL = os.path.join(ROOT, "test", "fixtures", "schrader-backfill")  # scrubbed archive pages, named by slug
BASE = "https://www.schraderauction.com"
# An auction id is Schrader's number or, for an archive page that has none, its slug (the page's
# canonical link, "williams-county-ohio-land-auction-63-acres-march-2026"). Numeric ids and urls are
# unchanged for every saved record.
SLUG = r"(?=[^/]*\d)[a-z0-9]+(?:-[a-z0-9]+)+"
ID_RE = r"(?:\d{1,7}|" + SLUG + r")"
CANONICAL = re.compile(r"""<link\b[^>]*\brel\s*=\s*["']canonical["'][^>]*>""", re.I)
CANON_SLUG = re.compile(r"""\bhref\s*=\s*["']https?://[^"'/]*schraderauction\.com/auctions/(""" + SLUG + r""")/?["']""", re.I)


def canonical_slug(page):
    m = CANONICAL.search(page if isinstance(page, str) else page.decode("latin-1"))
    g = CANON_SLUG.search(m.group(0)) if m else None
    return g.group(1).lower() if g else ""


def id_key(i):
    return (0, int(i), "") if i.isdigit() else (1, 0, i)
CREDIT = "Sold/auction results reported by Schrader Real Estate and Auction Co."
CREDIT_URL = BASE + "/auctions/recent_auctions"
MIN_ACRES = 20
MAX_PER_ACRE = 1000000  # a printed figure above this is a typo on the page (one read $10,800,000): withheld, the row kept
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


# ---- the older archive layouts (2012 to 2025). The where line is free text there: "Allegan County,
# Michigan", "Cecil, Ohio - Paulding County, Crane Township", "Dowagiac, MI - Cass County", with
# or without a street address, several counties, or no county at all. A county is taken only when
# exactly one is named and exactly one state is named; the page's own slug (Schrader's canonical
# address, "payne-county-oklahoma-land-auction-...") may add it and must never disagree. Anything
# else is withheld and counted with its reason; a county is never worked out from a town.
STATE_NAMES = sorted(ABBR, key=len, reverse=True)  # "west virginia" before "virginia"
STATE_WORD = re.compile(r"\b(" + "|".join(re.escape(s) for s in STATE_NAMES) + r")\b(?!\s+(?:count|co\b|court|twp|township))", re.I)
STATE_ABBR = re.compile(r",\s*(" + "|".join(STATES) + r")\b(?!\.?\w)")
COUNTY_WORD = re.compile(r"((?:[A-Za-z][A-Za-z.'\u2019]*\s+){0,2}[A-Za-z][A-Za-z.'\u2019]*)\s+(?:County|Co)\b", re.I)
PLURAL = re.compile(r"\bcounties\b", re.I)
SLUG_COUNTY = re.compile(r"^((?:[a-z]+-){1,2}?)county-((?:new-|north-|south-|west-)?[a-z]+)-")
SLUG_STATES = {s.replace(" ", "-"): a for s, a in ABBR.items()}
LEAD_WORDS = {"east", "west", "north", "south", "near", "in", "of", "and", "the", "at", "near"}


def county_mentions(s):
    """({normalized name: shown name}, plural) for the counties named in one piece of where-line text."""
    found, plural = {}, bool(PLURAL.search(s))
    for m in COUNTY_WORD.finditer(s):
        words = m.group(1).split()
        if len(words) > 1 and words[0].lower() in LEAD_WORDS:
            words = words[1:]
        name = " ".join(words)
        if re.search(r"(?:&|\band)\s*$", s[:m.start(1)], re.I) or "and" in [x.lower() for x in words]:
            plural = True  # "Cass & Van Buren Co."
        if COUNTY_NAME.fullmatch(name):
            found[norm_name(name)] = name.title()
    return found, plural


def states_in(s):
    out = {ABBR[m.group(1).lower()] for m in STATE_WORD.finditer(s)}
    return out | {m.group(1) for m in STATE_ABBR.finditer(s)}


def place_archive(page, slug=""):
    """(county, state, reason) for the older layouts. reason is None when a county and state were read."""
    m = re.search(r'<p class="where">(.*?)</p>', page, re.S)
    w = text(m.group(1)).split(" \u00b7 ")[0] if m else ""
    found, plural = county_mentions(w)
    keys = set(found)
    sts = states_in(w)
    sc = SLUG_COUNTY.match(slug or "")
    s_county = s_state = None
    if sc:
        s_county = sc.group(1).rstrip("-").replace("-", " ")
        s_state = SLUG_STATES.get(sc.group(2))
        if re.search(r"-county-[a-z-]*?-county-", slug):
            plural = True
    if re.match(r"(?:[a-z]+-){1,3}counties-", slug or "") or (slug or "").startswith("multi-county-"):
        plural = True
    slug_states = {SLUG_STATES[k] for k in SLUG_STATES if re.search(r"(?:^|-)" + re.escape(k) + r"(?:-|$)", slug or "")}
    if plural or len(keys) > 1:
        return None, None, "multi_county"
    if not keys:
        if s_county and s_state and s_state in slug_states and len(slug_states) == 1 and not w_has_county_word(w):
            return s_county.title(), s_state, None
        return None, None, "no_county_named"
    sts = sts or ({s_state} if s_state else set()) or slug_states
    if len(sts) != 1:
        return None, None, "state_unclear"
    st = next(iter(sts))
    if s_county and not any(norm_name(s_county).endswith(k) for k in keys):
        return None, None, "conflict"  # the slug may carry a lead word ("excellent-noble-county")
    if s_state and s_state != st:
        return None, None, "conflict"
    return found[next(iter(keys))], st, None


def w_has_county_word(w):
    return bool(re.search(r"\bcount(?:y|ies)\b|\bco\b", w, re.I))


def parse_page(page, auction_id, feed_item=None, idx=None, why=None):
    """One record, or None when the page carries no result table. why, when a dict, gets "reason" set when
    the county could not be read (the record then has no county and the caller drops it)."""
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
        if sold is None or not re.fullmatch(r"\d+[A-Za-z]?(?:[+-]\d+[A-Za-z]?)*", tracts):
            continue
        pa = PER_ACRE_RE.match(text(tds[2])) if len(tds) > 2 else None
        per = int(pa.group(1).replace(",", "")) if pa else None
        rows.append({"tracts": tracts, "sold": sold, "per_acre": per if per is None or per <= MAX_PER_ACRE else None})
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
    reason = None
    fips = idx.get((st, norm_name(county))) if county and idx is not None else None
    if fips is None and not str(auction_id).isdigit():
        # archive pages (slug ids) only: the older layouts, or a county text that does not join (a typo in
        # the title). A numbered weekly page keeps the strict reading above (checker, PR #412).
        c2, s2, reason = place_archive(page, str(auction_id))
        f2 = idx.get((s2, norm_name(c2))) if c2 and idx is not None else None
        if f2 is not None:
            county, st, fips = c2, s2, f2
        elif county is None:
            county, st = c2, s2
    if fips is None:
        if reason is None and county:
            reason = "not_a_county_there"
        if why is not None:
            why["reason"] = reason or "no_county_named"
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


def read_capture(folder, idx=None, skipped=None):
    """(kept records, counts) for one capture folder. skipped, when a dict, collects {reason: [auction ids]}
    for the farmland pages that were withheld because no single county could be read."""
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
    captured = captured or datetime.now(timezone.utc).strftime("%Y-%m-%d")  # the backfill folder has no date of its own
    kept, n = [], {"pages": 0, "kept": 0, "dropped_not_farmland": 0, "no_result": 0, "dropped_future_date": 0, "dropped_no_county": 0}
    adir = os.path.join(folder, "auctions")
    for f in sorted(os.listdir(adir)) if os.path.isdir(adir) else []:
        if not re.fullmatch(ID_RE + r"\.html", f):
            continue
        n["pages"] += 1
        aid = f[:-5]
        with open(os.path.join(adir, f), "rb") as fh:
            raw = fh.read()
        if not aid.isdigit():
            aid = canonical_slug(raw) or aid  # no number on the page: the canonical slug is the id
        why = {}
        rec = parse_page(raw, aid, feed.get(aid), idx, why)
        if rec is None:
            n["no_result"] += 1
        elif not is_farmland(rec):
            n["dropped_not_farmland"] += 1
        elif rec["county_fips"] is None:
            n["dropped_no_county"] += 1
            if skipped is not None:
                skipped.setdefault(why.get("reason") or "no_county_named", []).append(aid)
        elif captured and rec["date"] and rec["date"] > captured:
            n["dropped_future_date"] += 1  # a result dated after the capture is not a result yet
        else:
            kept.append(rec)
    n["kept"] = len(kept)
    return kept, n, captured


def _same_sale(r):
    return json.dumps([r.get("county_fips"), r.get("date"), r.get("total_sold"), r.get("tracts")], sort_keys=True)


def merge(old, new, stats=None):
    """Old records stay. A new auction_id is added. A record seen again replaces the saved one only when
    every other field is the same and the saved tract rows come back unchanged, in order, with new rows
    after them; any other difference is refused and counted, so a later parse never rewrites history."""
    by = {r["auction_id"]: r for r in old}
    refused = 0
    seen = {_same_sale(r): r["auction_id"] for r in old}
    for r in new:
        prev = by.get(r["auction_id"])
        if prev is None:
            twin = seen.get(_same_sale(r))
            if twin is not None and twin.isdigit() != r["auction_id"].isdigit():
                continue  # the same sale under its number and its slug: one record, the one saved first
            by[r["auction_id"]] = r
            seen[_same_sale(r)] = r["auction_id"]
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
    return sorted(by.values(), key=lambda r: (r["date"] or "", id_key(r["auction_id"])))


def build(folder, out=OUT, idx=None):
    """Read one capture folder and merge it into `out`. Returns an exit code."""
    idx = idx if idx is not None else county_index()
    skipped = {}
    new, counts, captured = read_capture(folder, idx, skipped)
    code = write_merged(out, new, dict(counts, captured=captured), captured)
    if skipped:
        print("read_schrader: farmland pages with no single county, withheld: "
              + ", ".join(f"{k} {len(v)}" for k, v in sorted(skipped.items())))
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
              and rec["credit"] == CREDIT and re.fullmatch(ID_RE, rec["auction_id"])
              and rec["url"] == f"{BASE}/auctions/{rec['auction_id']}"
              and re.fullmatch(r"\d{4}-\d{2}-\d{2}", rec["date"]) and rec["state"] in STATES
              and COUNTY_NAME.fullmatch(rec["county"]) and idx.get((rec["state"], norm_name(rec["county"]))) == rec["county_fips"]
              and (rec["headline_acres"] is None or num(rec["headline_acres"]))
              and (rec["total_sold"] is None or type(rec["total_sold"]) is int)
              and isinstance(rec["tracts"], list) and rec["tracts"]
              and all(isinstance(x, dict) and set(x) == {"tracts", "sold", "per_acre"}
                      and re.fullmatch(r"\d+[A-Za-z]?(?:[+-]\d+[A-Za-z]?)*", x["tracts"]) and type(x["sold"]) is int
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

        slug = "knox-county-indiana-land-auction-331-acres-october-2026"
        shutil.copy(os.path.join(FIXTURES, "9580.html"), os.path.join(cap, "auctions", slug + ".html"))
        s_recs, s_n, _ = read_capture(cap, idx)
        check(s_n["pages"] == sum(f.endswith(".html") for f in os.listdir(FIXTURES)) + 1 and s_n["kept"] == len(recs) + 1, "a slug-named page is read beside the numeric ones")
        sr = next(r for r in s_recs if r["auction_id"] == slug)
        check(sr["url"] == f"{BASE}/auctions/{slug}" and valid(sr, idx) and sr["total_sold"] == 1820000,
              "slug page: auction_id and url from the canonical slug, a valid record")
        num = next(r for r in recs if r["auction_id"] == "9580")
        check(num["url"] == f"{BASE}/auctions/9580" and set(num) == set(sr), "numeric record: id, url and keys unchanged")
        check([r["auction_id"] for r in merge([num], [sr])] == ["9580"] and [r["auction_id"] for r in merge([sr], [num])] == [slug],
              "the same sale under its number and its slug is one record")
        check([r["auction_id"] for r in merge([dict(num, auction_id="9", date="2020-01-01", url=BASE + "/auctions/9")], [sr])] == ["9", slug],
              "a different sale with a slug is added, numbers sort before slugs")
        os.remove(os.path.join(cap, "auctions", slug + ".html"))

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

        # the older archive layouts (2012 to 2025): scrubbed real pages, named by slug
        bcap = os.path.join(tmp, "backfill-cap")
        os.makedirs(os.path.join(bcap, "auctions"))
        for f in os.listdir(FIXTURES_BACKFILL):
            shutil.copy(os.path.join(FIXTURES_BACKFILL, f), os.path.join(bcap, "auctions", f))
        sk = {}
        b_recs, b_n, _ = read_capture(bcap, idx, sk)
        bb = {r["auction_id"]: r for r in b_recs}
        check(b_n["pages"] == 4 and b_n["kept"] == 3 and b_n["no_result"] == 0 and b_n["dropped_no_county"] == 1
              and {k: len(v) for k, v in sk.items()} == {"multi_county": 1},
              f"backfill fixtures: three read, the two-county page withheld and counted ({b_n}, {sk})")
        r = bb.get("ohio-land-auction-180-acres-offered-in-6-tracts-2013") or {}
        check(r.get("county_fips") == "39129" and r.get("state") == "OH" and r.get("date") == "2013-08-28"
              and [x["tracts"] for x in r.get("tracts", [])] == ["1-3", "4", "5+6"] and r.get("total_sold") == 1270000
              and valid(r, idx), "2013 page: Pickaway County, OH from 'Circleville, Ohio - Pickaway County'; tract range '1-3' kept")
        r = bb.get("payne-county-oklahoma-land-auction-80-acres-september-2020") or {}
        check(r.get("county_fips") == "40119" and r.get("headline_acres") == 80 and r.get("total_sold") == 254800
              and r.get("url") == BASE + "/auctions/payne-county-oklahoma-land-auction-80-acres-september-2020",
              "2020 page: where line 'Payne County, Oklahoma' with no dash")
        r = bb.get("10-acres-offered-in-2-tracts-real-estate-and-personal-2012") or {}
        check(r.get("county_fips") == "26027" and r.get("date") == "2012-08-25" and r.get("state") == "MI",
              "2012 page: 'Dowagiac, MI - Cass County', the date after 'Real estate' read")
        bad = {k for rec in b_recs for k in rec} & {"buyer", "buyers", "purchaser", "owner", "name", "bidder"}
        check(not bad and all(valid(x, idx) for x in b_recs), "backfill records: no buyer field, every one in the reader's shape")

        def pa(where, slug=""):
            return place_archive('<p class="where">' + where + '</p>', slug)
        check(pa("Marcellus, Michigan, Cass County")[:2] == ("Cass", "MI"), "where: 'Town, State, X County'")
        check(pa("Washington Court House - Fayette County - Union Township", "fayette-county-ohio-land-auction-154-acres-june-2022")[:2] == ("Fayette", "OH"),
              "where: no state in the line, the slug's state; 'Washington' before Court House is not the state")
        check(pa("Guymon, Oklahoma - Texas County")[:2] == ("Texas", "OK"), "where: 'Texas County, Oklahoma' is not Texas the state")
        check(pa("Cass & Van Buren Co. Michigan")[2] == "multi_county" and pa("Lea County New Mexico & Cochran County, Texas")[2] == "multi_county"
              and pa("Cameron, Willacy, & Hidalgo Counties, TX")[2] == "multi_county", "two or more counties: withheld")
        check(pa("Stillwater, OK")[2] == "no_county_named" and pa("Allegan, Michigan")[2] == "no_county_named",
              "a town is never turned into a county")
        check(pa("Stillwater, OK", "payne-county-oklahoma-land-auction-8-acres-december-2025")[:2] == ("Payne", "OK"),
              "no county in the line: the page's own slug names it")
        check(pa("Van Buren County, Antwerp Township, Southwestern Michigan", "kalamazoo-county-michigan-land-auction-58-acres-april-2014")[2] == "conflict",
              "the line and the slug name different counties: withheld")
        check(pa("Southwestern Michigan, Cass County, 1 Mile North of Indiana Line")[2] == "state_unclear", "two states named: withheld")
        check(pa("Noble County, OK", "excellent-noble-county-ok-farmland-auction-235-acres-2025")[:2] == ("Noble", "OK"),
              "a lead word in the slug is not a conflict")
        check(pa("UNION TWP, AUGLAIZE CO - 5 MILES EAST OF WAPAKONETA, OH")[:2] == ("Auglaize", "OH"), "where: all caps, 'CO' for County")
        rec = parse_page(open(os.path.join(FIXTURES, "9630.html"), encoding="utf-8").read().replace("$9,709/acre", "$10,800,000/acre"), "1", None, idx)
        check(rec["tracts"][2]["per_acre"] is None and rec["tracts"][2]["sold"] == 1000000, "a per-acre figure above $1,000,000 is a typo on the page: withheld")
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
