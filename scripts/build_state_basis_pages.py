#!/usr/bin/env python3
"""build_state_basis_pages.py -- per-state cash basis pages, /basis/<state>,
built from the AGSIST elevator network (dnilgis/bids) ONLY.

SOURCE, AND WHY ONLY THIS ONE
-----------------------------
dnilgis/bids reads elevator boards directly and publishes two files this script
reads, the same way scripts/fetch_bids.py reads them (same base URL, same
reader, `_net_get_json` imported from there so there is one copy):

  data/merged-all.json  every merged bid row, flat (schema agsist-merged-all/1)
  data/index.json       one record per board: status, health, provenance,
                        pricedAt, checkedAt

The licensed Barchart cash-bid feed is NEVER read here. fetch_bids.py merges the
two feeds downstream into data/bids.json; this script does not open that file,
does not import the Barchart fetcher, and rejects any row whose `source` is not
a board id listed in the network's own index.json (a Barchart row has no such
id). Every row kept must also carry via == "scrape". The build fails if a row
slips through either gate.

WHAT COUNTS AS A FRESH NETWORK BID (all must hold)
  - row: sourceStatus "ok", stale false, currency USD, a US state
  - board in index.json with status "ok" and health "live"
  - row pricedAt within FRESH_HOURS (72 h) of the snapshot's `generated` time.
    72 h, not 24: a board that did not move over a weekend is still Friday's
    posted price on Monday morning, and Friday 14:00 -> Monday 13:00 is 71 h.
  - basis in $/bu (basisUnit "per-bushel"); "unknown" units are dropped
  - delivery period parsed and not already past; harvest-season rows
    ("newcrop-YYYY") are undated and are not used to pick a nearby bid
  - plain commodity: white / organic / non-GMO / high-oleic / IP rows are
    specialty premiums and would distort a commodity basis

BASIS = cash - futures, $/bu, against the contract the row names. Each
elevator contributes ONE bid per crop: its nearest open delivery period. A
statistic is computed per (crop, contract) -- never across contract months.
The headline for a crop is the contract most of the state's elevators price
their nearby bid against; other contracts are listed separately.

WEEK-OVER-WEEK: matched pairs only (same board, crop, commodity label, delivery
period and contract, fresh in both snapshots), against the bids repo's own
committed merged-all.json closest to 7 days earlier (within PREV_WINDOW_H). No
earlier snapshot in reach -> the column and stat are omitted, not guessed.

THIN PAGES: a state is indexable only when its headline corn or soybean
statistic rests on >= MIN_INDEX (5) elevators. Below that, one board moves the
"median" by itself and the page is a directory listing, so it is written
noindex,follow and left out of basis/_indexable.txt.

Pages are MACHINE-OWNED: edit this script, never basis/*.html.

Usage:
  python3 scripts/build_state_basis_pages.py                     # fetch live (CI)
  python3 scripts/build_state_basis_pages.py --bids-dir ../bids  # local clone
  python3 scripts/build_state_basis_pages.py --selftest
"""
import argparse
import datetime as dt
import html
import json
import os
import re
import statistics
import subprocess
import sys
import urllib.request

try:
    from zoneinfo import ZoneInfo
    CT = ZoneInfo("America/Chicago")
except Exception:  # pragma: no cover
    CT = dt.timezone(dt.timedelta(hours=-5))

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch_bids import _net_get_json, BIDS_NETWORK_BASE  # noqa: E402  (network reader only)

SITE = "https://agsist.com"
OUT_DIR = "basis"
FRESH_HOURS = 72
MIN_STAT = 3          # elevators needed to print a median/range at all
MIN_INDEX = 5         # elevators behind a corn or soy headline to be indexable
PREV_TARGET_H = 7 * 24
PREV_WINDOW_H = 30    # accept a prior snapshot 7 d +/- 30 h back
MAX_SNAPSHOT_AGE_H = 24
SANITY = {"corn": 2.5, "soybeans": 2.5, "wheat": 3.0}   # |basis| $/bu beyond this = suspect parse
BIDS_REPO_API = "https://api.github.com/repos/dnilgis/bids"
BIDS_RAW = "https://raw.githubusercontent.com/dnilgis/bids"

STATE_NAMES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California",
    "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware", "FL": "Florida", "GA": "Georgia",
    "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois", "IN": "Indiana", "IA": "Iowa",
    "KS": "Kansas", "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland",
    "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi",
    "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada", "NH": "New Hampshire",
    "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York", "NC": "North Carolina",
    "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma", "OR": "Oregon", "PA": "Pennsylvania",
    "RI": "Rhode Island", "SC": "South Carolina", "SD": "South Dakota", "TN": "Tennessee",
    "TX": "Texas", "UT": "Utah", "VT": "Vermont", "VA": "Virginia", "WA": "Washington",
    "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming",
}
MONTH_CODES = "FGHJKMNQUVXZ"
MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
ROOTS = {"ZC": "corn", "ZS": "soybeans", "KE": "wheat_hrw", "ZW": "wheat_srw",
         "MW": "wheat_hrs", "MWO": "wheat_hrs"}
CROP_LABEL = {"corn": "Corn", "soybeans": "Soybeans", "wheat_hrw": "Hard red winter wheat",
              "wheat_srw": "Soft red winter wheat", "wheat_hrs": "Hard red spring wheat"}
CROP_ORDER = ["corn", "soybeans", "wheat_hrw", "wheat_srw", "wheat_hrs"]
EXCHANGE = {"ZC": "CBOT corn", "ZS": "CBOT soybeans", "KE": "KC HRW wheat",
            "ZW": "CBOT SRW wheat", "MW": "MIAX spring wheat", "MWO": "MIAX spring wheat (MWO)"}
SPECIALTY = re.compile(r"white|organic|non[\s-]?gmo|nongmo|high oleic|\bip\b|food|waxy|popcorn|feed wheat|"
                       r"\bsww\b|soft white|hard white|durum", re.I)


# ---------------------------------------------------------------- helpers
def esc(s):
    return html.escape(str(s), quote=True)


def slug(name):
    return name.lower().replace(" ", "-")


def parse_ts(s):
    if not s:
        return None
    try:
        return dt.datetime.fromisoformat(str(s).replace("Z", "+00:00")).astimezone(dt.timezone.utc)
    except ValueError:
        return None


def fmt_ct(t, with_date=True):
    c = t.astimezone(CT)
    hm = c.strftime("%I:%M %p").lstrip("0")
    tz = c.tzname() or "CT"
    return f"{MONTH_ABBR[c.month-1]} {c.day}, {c.year} {hm} {tz}" if with_date else f"{hm} {tz}"


def fmt_date(t):
    c = t.astimezone(CT)
    return f"{MONTH_ABBR[c.month-1]} {c.day}, {c.year}"


def _cents2(v):
    """|v| to two places, half away from zero (a median of -0.625 prints -0.63,
    not banker's -0.62)."""
    from decimal import Decimal, ROUND_HALF_UP
    return str(Decimal(repr(abs(v))).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def money_basis(v):
    """Basis in $/bu with an explicit sign: -$0.42, +$0.05, or "even".

    A zero basis is a real bid at futures (ADM Mound City corn posts -20c,
    0c, +18c for neighbouring months), so it is printed the way the trade
    says it, "even" -- never a bare $0.00, which reads as a missing value."""
    if v is None:
        return "&mdash;"
    a = _cents2(v)
    if a == "0.00":
        return "even"
    return f"<span style=\"white-space:nowrap\">{'+' if v > 0 else '&minus;'}${a}</span>"


def plain_basis(v):
    a = _cents2(v)
    if a == "0.00":
        return "even"
    return f"{'+' if v > 0 else '-'}${a}"


def cents_delta(v):
    if v is None:
        return "&mdash;"
    if v == 0:
        return "0&cent;"
    return f"{'+' if v > 0 else '&minus;'}{abs(v):g}&cent;"


def parse_contract(fm, crop, snap_year):
    """Futures month string as the board wrote it -> (root, month_index, year) or None.

    'ZCZ26', 'ZCZ6', 'KEN27', 'MWOZ26', 'Dec 26', 'December 2026',
    'Nov 26 Soybeans', 'Dec 26 KCBT Red Wheat', 'Mar 27 MIAX Spring Wheat'.
    A bare month for wheat ('Dec 26 Wheat') does not say which class's contract
    it is, so it returns None rather than guessing."""
    if not fm or not isinstance(fm, str):
        return None
    s = fm.strip()
    m = re.fullmatch(r"(ZC|ZS|KE|ZW|MWO|MW)([FGHJKMNQUVXZ])(\d{1,2})", s)
    if m:
        root, code, yy = m.groups()
        y = int(yy)
        y = (snap_year // 10) * 10 + y if len(yy) == 1 else 2000 + y
        if len(yy) == 1 and y < snap_year - 1:
            y += 10
        return root, MONTH_CODES.index(code), y
    m = re.match(r"^([A-Za-z]{3})[a-z]*\.?\s+(\d{2}|\d{4})\b(.*)$", s)
    if not m:
        return None
    mon = m.group(1).title()
    if mon not in MONTH_ABBR:
        return None
    y = int(m.group(2))
    y = y + 2000 if y < 100 else y
    rest = m.group(3).lower()
    if "kcbt" in rest or "kansas" in rest:
        root = "KE"
    elif "spring" in rest or "miax" in rest or "mgex" in rest:
        root = "MW"
    elif "wheat" in rest:
        return None
    elif "oat" in rest:
        return None
    elif "soy" in rest:
        root = "ZS"
    elif crop == "corn":
        root = "ZC"
    elif crop == "soybeans":
        root = "ZS"
    else:
        return None
    return root, MONTH_ABBR.index(mon), y


def contract_code(c):
    return f"{c[0]}{MONTH_CODES[c[1]]}{c[2] % 100:02d}"


def contract_label(c):
    return f"{MONTH_ABBR[c[1]]} &rsquo;{c[2] % 100:02d}"


def contract_plain(c):
    return f"{MONTH_ABBR[c[1]]} '{c[2] % 100:02d}"


def period_start(period, snap):
    """'YYYY-MM' the delivery window opens, or None if undated/closed.
    spot = this month. newcrop/oldcrop are crop years, not windows -> None."""
    if not period:
        return None
    p = str(period)
    snap_ym = f"{snap.astimezone(CT).year:04d}-{snap.astimezone(CT).month:02d}"
    if p == "spot":
        return snap_ym
    parts = p.split("/")
    a = re.match(r"^(\d{4})-(\d{2})", parts[0])
    b = re.match(r"^(\d{4})-(\d{2})", parts[-1])
    if not a:
        return None
    start = f"{a.group(1)}-{a.group(2)}"
    end = f"{b.group(1)}-{b.group(2)}" if b else start
    if end < snap_ym:
        return None
    return max(start, snap_ym)


def median(vals):
    return statistics.median(vals) if vals else None


# ---------------------------------------------------------------- loading
def load_network(bids_dir=None, base=None):
    """(merged-all doc, index doc). Local clone if bids_dir, else the same
    published URLs fetch_bids.py reads."""
    if bids_dir:
        with open(os.path.join(bids_dir, "data/merged-all.json")) as f:
            merged = json.load(f)
        with open(os.path.join(bids_dir, "data/index.json")) as f:
            index = json.load(f)
        return merged, index
    base = base or BIDS_NETWORK_BASE
    return _net_get_json(base, "data/merged-all.json"), _net_get_json(base, "data/index.json")


def _http_json(url, timeout=120):
    headers = {"User-Agent": "agsist-state-basis (+agsist.com)"}
    tok = os.environ.get("GITHUB_TOKEN")
    if tok and url.startswith("https://api.github.com/"):
        headers["Authorization"] = f"Bearer {tok}"
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def load_previous(generated, bids_dir=None, prev_file=None, allow_remote=True):
    """The bids repo's committed merged-all.json closest to 7 days before
    `generated`, or None. Never fabricated: if git history cannot reach that
    far back, week-over-week is simply omitted."""
    if prev_file:
        with open(prev_file) as f:
            return json.load(f)
    target = generated - dt.timedelta(hours=PREV_TARGET_H)
    cands = []
    if bids_dir and os.path.isdir(os.path.join(bids_dir, ".git")):
        def g(*args):
            return subprocess.run(["git", "-C", bids_dir, *args], capture_output=True,
                                  text=True, check=False).stdout.strip()
        before = g("log", "-1", "--format=%H", f"--before={target.isoformat()}", "--", "data/merged-all.json")
        after = g("log", "--reverse", "--format=%H", f"--after={target.isoformat()}", "--", "data/merged-all.json")
        for sha in [before] + after.splitlines()[:1]:
            if sha:
                cands.append(("git", sha))
        for kind, sha in cands:
            raw = subprocess.run(["git", "-C", bids_dir, "show", f"{sha}:data/merged-all.json"],
                                 capture_output=True, check=False).stdout
            try:
                doc = json.loads(raw)
            except ValueError:
                continue
            pg = parse_ts(doc.get("generated"))
            if pg and abs((pg - target).total_seconds()) <= PREV_WINDOW_H * 3600:
                return doc
        return None
    if not allow_remote:
        return None
    try:
        until = target.strftime("%Y-%m-%dT%H:%M:%SZ")
        commits = _http_json(f"{BIDS_REPO_API}/commits?path=data/merged-all.json&until={until}&per_page=1")
        if not commits:
            return None
        sha = commits[0]["sha"]
        doc = _http_json(f"{BIDS_RAW}/{sha}/data/merged-all.json")
        pg = parse_ts(doc.get("generated"))
        if pg and abs((pg - target).total_seconds()) <= PREV_WINDOW_H * 3600:
            return doc
        print(f"[state-basis] previous snapshot {pg} too far from {target}; week-over-week omitted",
              file=sys.stderr)
    except Exception as e:  # noqa: BLE001
        print(f"[state-basis] previous snapshot unavailable ({type(e).__name__}: {e}); "
              f"week-over-week omitted", file=sys.stderr)
    return None


# ---------------------------------------------------------------- selection
def fresh_rows(merged, index, stats=None):
    """Rows that pass every gate, normalised. `stats` (dict) collects drop counts."""
    stats = stats if stats is not None else {}
    gen = parse_ts(merged.get("generated"))
    srcs = {s["id"]: s for s in (index.get("sources") or []) if s.get("id")}
    out = []

    def drop(k):
        stats[k] = stats.get(k, 0) + 1

    for b in merged.get("bids") or []:
        if not isinstance(b, dict):
            continue
        sid = b.get("source")
        src = srcs.get(sid)
        if src is None:
            drop("not_a_network_board")
            continue
        if b.get("via") != "scrape":
            drop("not_scraped")
            continue
        if b.get("stale") is not False or b.get("sourceStatus") != "ok":
            drop("stale_or_unconfirmed")
            continue
        if src.get("status") != "ok" or src.get("health") != "live":
            drop("board_not_live")
            continue
        if (b.get("currency") or "") != "USD":
            drop("not_usd")
            continue
        st = (b.get("state") or "").upper()
        if st not in STATE_NAMES:
            drop("no_us_state")
            continue
        pt = parse_ts(b.get("pricedAt"))
        if pt is None or gen is None or (gen - pt).total_seconds() > FRESH_HOURS * 3600:
            drop("price_older_than_cutoff")
            continue
        crop = b.get("crop")
        if crop not in ("corn", "soybeans", "wheat"):
            drop("other_crop")
            continue
        if SPECIALTY.search(b.get("commodity") or ""):
            drop("specialty_commodity")
            continue
        basis, cash = b.get("basis"), b.get("cash")
        if not isinstance(basis, (int, float)) or b.get("basisUnit") != "per-bushel":
            drop("no_basis_in_dollars")
            continue
        if not isinstance(cash, (int, float)):
            drop("no_cash")
            continue
        start = period_start(b.get("period"), gen)
        if start is None or b.get("periodPast"):
            drop("undated_or_past_period")
            continue
        con = parse_contract(b.get("futuresMonth"), crop, gen.year)
        if con is None:
            # A wheat row with no class contract cannot be grouped at all.
            if crop == "wheat":
                drop("wheat_contract_unknown")
                continue
            group = crop
        else:
            group = ROOTS[con[0]]
            if (crop == "wheat") != group.startswith("wheat") or (crop != "wheat" and group != crop):
                drop("contract_crop_mismatch")
                continue
        out.append({
            "source": sid, "state": st, "group": group, "crop": crop,
            "operator": b.get("operator") or src.get("operator") or "Unknown",
            "city": b.get("city") or src.get("location") or "",
            "zip": b.get("zip") or src.get("zip") or "",
            "commodity": b.get("commodity") or "", "delivery": b.get("delivery") or "",
            "period": b.get("period"), "start": start, "contract": con,
            "fm_raw": b.get("futuresMonth"),
            "basis": round(float(basis), 4), "cash": round(float(cash), 4),
            "priced": pt, "via": b.get("via"),
        })
    return out


def nearby(rows):
    """One row per (board, crop group): nearest open delivery window.
    Ties: a named contract beats none, then the nearer contract, then the
    shorter (plainer) commodity label."""
    best = {}
    for r in rows:
        k = (r["source"], r["group"])
        key = (r["start"], r["contract"] is None,
               (r["contract"][2], r["contract"][1]) if r["contract"] else (9999, 99),
               len(r["commodity"]), r["commodity"], r["period"] or "")
        if k not in best or key < best[k][0]:
            best[k] = (key, r)
    return [v[1] for v in best.values()]


def flag_futures_disagreement(rows, tol=0.03):
    """cash - basis is the futures price the board used. Every board quoting
    the same contract at the same snapshot should land on about the same
    number; one that is more than 3% off the network-wide median for that
    contract has a misread cash, basis or month, and is kept out of the
    statistics (still listed, marked)."""
    by = {}
    for r in rows:
        if r["contract"] is not None:
            by.setdefault(r["contract"], []).append(r["cash"] - r["basis"])
    med = {c: statistics.median(v) for c, v in by.items() if len(v) >= 5}
    for r in rows:
        m = med.get(r["contract"])
        r["fut_off"] = bool(m) and abs((r["cash"] - r["basis"]) / m - 1) > tol


def match_key(r):
    return (r["source"], r["group"], r["commodity"], r["period"], r["contract"])


def summarise_state(rows, prev_map):
    """Per crop group: headline contract stats + secondary contracts."""
    by_group = {}
    for r in rows:
        by_group.setdefault(r["group"], []).append(r)
    out = {}
    for g in CROP_ORDER:
        rs = by_group.get(g, [])
        if not rs:
            continue
        for r in rs:
            r["suspect"] = abs(r["basis"]) > SANITY[r["crop"]] or r.get("fut_off", False)
            p = prev_map.get(match_key(r)) if prev_map is not None else None
            r["wow"] = round((r["basis"] - p) * 100, 2) if p is not None else None
        by_con = {}
        for r in rs:
            if r["contract"] is not None and not r["suspect"]:
                by_con.setdefault(r["contract"], []).append(r)
        groups = []
        for con, crs in sorted(by_con.items(), key=lambda kv: (-len(kv[1]), kv[0][2], kv[0][1])):
            vals = [r["basis"] for r in crs]
            st = {"contract": con, "n": len(crs), "rows": crs}
            if len(crs) >= MIN_STAT:
                st["median"] = round(median(vals), 4)
                st["lo"], st["hi"] = min(vals), max(vals)
                st["asof_latest"] = max(r["priced"] for r in crs)
                st["asof_oldest"] = min(r["priced"] for r in crs)
                srt = sorted(crs, key=lambda r: (-r["basis"], r["city"]))
                k = 3 if len(crs) >= 6 else 1
                st["strong"], st["weak"] = srt[:k], list(reversed(srt[-k:]))
                if prev_map is not None:
                    ds = [r["wow"] for r in crs if r["wow"] is not None]
                    if len(ds) >= MIN_STAT:
                        st["wow_median"] = round(median(ds), 2)
                        st["wow_n"] = len(ds)
                        st["wow_up"] = sum(1 for d in ds if d > 0)
                        st["wow_dn"] = sum(1 for d in ds if d < 0)
            groups.append(st)
        out[g] = {"rows": rs, "contracts": groups,
                  "no_contract": [r for r in rs if r["contract"] is None],
                  "suspect": [r for r in rs if r["suspect"]]}
    return out


def build_prev_map(prev_doc):
    """match_key -> basis for every fresh row in the earlier snapshot."""
    if not prev_doc:
        return None
    rows = fresh_rows(prev_doc, _index_for_prev(prev_doc))
    return {match_key(r): r["basis"] for r in rows}


def _index_for_prev(prev_doc):
    """The earlier snapshot is gated on its own row flags (sourceStatus,
    stale, pricedAt vs ITS generated time). Today's index.json describes
    today's board health, not last week's, so a synthetic index of the boards
    named in that snapshot is used -- the row-level gates still apply."""
    ids = {b.get("source") for b in prev_doc.get("bids") or [] if isinstance(b, dict)}
    return {"sources": [{"id": i, "status": "ok", "health": "live"} for i in ids if i]}


# ---------------------------------------------------------------- page parts
def static_chrome(root="."):
    """The crawlable static header/footer index.html carries (loader.js swaps
    them for the live nav). Empty placeholders if index.html can't be read."""
    try:
        with open(os.path.join(root, "index.html"), encoding="utf-8") as f:
            src = f.read()
        hm = re.search(r'<div id="site-header">.*?</header>\s*</div>', src, re.S)
        fm = re.search(r'<div id="site-footer">.*?</nav>\s*</div>', src, re.S)
        return (hm.group(0) if hm else '<div id="site-header"></div>',
                fm.group(0) if fm else '<div id="site-footer"></div>')
    except OSError:
        return '<div id="site-header"></div>', '<div id="site-footer"></div>'


CSS = """
    .bs-wrap{max-width:1060px;margin:0 auto;padding:0 16px}
    .bs-sub{color:var(--text-muted);font-size:.9rem;line-height:1.6}
    .bs-sub a,.bs-note a,.bs-links a{color:var(--gold)}
    h1{font-size:1.55rem;margin:14px 0 4px} h2{font-size:1.12rem;margin:26px 0 6px} h3{font-size:.98rem;margin:16px 0 4px;color:var(--text)}
    .bs-hero{display:flex;flex-wrap:wrap;gap:14px;margin:14px 0}
    .bs-stat{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 16px;min-width:200px;flex:1}
    .bs-stat .v{font-family:'JetBrains Mono',monospace;font-size:1.45rem;color:var(--text)}
    .bs-stat .l{font-size:.72rem;color:var(--text-muted);letter-spacing:.05em;text-transform:uppercase;margin-top:2px}
    .bs-stat .s{font-size:.75rem;color:var(--text-muted);margin-top:4px;line-height:1.5}
    .bs-note{background:var(--surface);border:1px solid var(--border);border-left:3px solid var(--gold);border-radius:8px;padding:12px 15px;font-size:.85rem;line-height:1.65;color:var(--text-muted);margin:14px 0}
    .bs-note b{color:var(--text)}
    .bs-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}
    table.bs-t{width:100%;border-collapse:collapse;font-size:.82rem;margin:10px 0}
    .bs-t th{text-align:left;color:var(--text-muted);font-size:.66rem;letter-spacing:.07em;text-transform:uppercase;padding:7px 8px;border-bottom:1px solid var(--border);white-space:nowrap}
    .bs-t td{padding:6px 8px;border-bottom:1px solid var(--border);color:var(--text);white-space:nowrap}
    .bs-t td.n{font-family:'JetBrains Mono',monospace;text-align:right}
    .bs-t th.n{text-align:right}
    .bs-t a{color:var(--text);text-decoration:none;border-bottom:1px dotted var(--border)}
    .bs-t a:hover{color:var(--gold)}
    .bs-t .mut{color:var(--text-dim)}
    .bs-list{margin:6px 0 0 18px;padding:0;color:var(--text);font-size:.86rem;line-height:1.7}
    .bs-cloud{font-size:.78rem;line-height:2;color:var(--text-muted)}
    .bs-cloud a{color:var(--text-muted);text-decoration:none;border-bottom:1px dotted var(--border)}
    .bs-cloud a:hover{color:var(--gold)}
"""


def head(title, desc, path, jsonld, indexable):
    robots = "index,follow" if indexable else "noindex,follow"
    return f"""<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="theme-color" content="#0a0c0d">
  <script>/* agsist-ga-guard 2026-10-01: Google Analytics loads only when the browser sends no Global Privacy Control or Do Not Track signal and the off switch on /privacy is not set. dataLayer and gtag always exist, so page code that calls them never throws. */(function(w,d,n){{var off=false,v,i,s;w.dataLayer=w.dataLayer||[];if(typeof w.gtag!=='function'){{w.gtag=function(){{w.dataLayer.push(arguments);}};}}try{{off=w.localStorage.getItem('agsist-ga-off')==='1';}}catch(e){{}}if(n.globalPrivacyControl===true){{off=true;}}v=[n.doNotTrack,w.doNotTrack,n.msDoNotTrack];for(i=0;i<v.length;i++){{if(v[i]==='1'||v[i]==='yes'){{off=true;}}}}w.agsistGaOff=off;w.gtag('set','allow_google_signals',false);w.gtag('set','allow_ad_personalization_signals',false);if(off){{return;}}s=d.createElement('script');s.async=true;s.src='https://www.googletagmanager.com/gtag/js?id=G-6KXCTD5Z9H';(d.head||d.documentElement).appendChild(s);}})(window,document,navigator);</script>
  <script>window.dataLayer=window.dataLayer||[];function gtag(){{dataLayer.push(arguments);}}gtag('js',new Date());gtag('config','G-6KXCTD5Z9H');function gaEvent(n,p){{try{{gtag('event',n,p||{{}});}}catch(e){{}}}}</script>
  <link rel="preload" href="/components/styles.css?v=17" as="style">
  <link rel="stylesheet" href="/components/styles.css?v=17">
  <link rel="icon" type="image/x-icon" href="/img/favicon.ico">
  <link rel="icon" type="image/png" sizes="32x32" href="/img/favicon-32.png">
  <link rel="icon" type="image/png" sizes="16x16" href="/img/favicon-16.png">
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
  <meta property="og:image" content="{SITE}/img/og/agsist.jpg">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:site" content="@agsist">
  <meta name="twitter:title" content="{esc(title)}">
  <meta name="twitter:description" content="{esc(desc)}">
  <meta name="twitter:image" content="{SITE}/img/og/agsist.jpg">
  <script type="application/ld+json">
{json.dumps(jsonld, indent=1, ensure_ascii=False).replace("</", "<\\/")}
  </script>
  <style>{CSS}  </style>
</head>"""


def make_title(name, crops_label, n):
    if n == 0:
        return f"{name} Grain Basis: No Fresh Network Bids | AGSIST"[:60]
    el = f"{n} Elevator{'s' if n != 1 else ''}"
    for t in (f"{name} {crops_label} Basis Today: {el} | AGSIST",
              f"{name} {crops_label} Basis: {el} | AGSIST",
              f"{name} Grain Basis Today: {el} | AGSIST",
              f"{name} Grain Basis: {el} | AGSIST",
              f"{name} Basis: {el} | AGSIST"):
        if len(t) <= 60:
            return t
    return f"{name} Basis | AGSIST"


def elevator_link(r):
    z = re.sub(r"\D", "", str(r.get("zip") or ""))[:5]
    href = f"/cash-bids?zip={z}" if len(z) == 5 else "/cash-bids"
    return f'<a href="{esc(href)}">{esc(r["operator"])}</a>'


def stat_block(group, st, prev_gen):
    has_prev = prev_gen is not None
    lab = CROP_LABEL[group]
    con = st["contract"]
    root = EXCHANGE.get(con[0], con[0])
    if "median" not in st:
        return (f'<div class="bs-stat"><div class="v mut">&mdash;</div><div class="l">{lab} vs '
                f'{contract_label(con)}</div><div class="s">Only {st["n"]} network elevator'
                f'{"s" if st["n"] != 1 else ""} price against this contract; a median needs at least '
                f'{MIN_STAT}.</div></div>')
    wow = ""
    if has_prev:
        if "wow_median" in st:
            wow = (f'<br>Change since the {fmt_ct(prev_gen)} snapshot (about a week): <b style="color:var(--text)">{cents_delta(st["wow_median"])}</b> median change '
                   f'across {st["wow_n"]} matched bids ({st["wow_up"]} up, {st["wow_dn"]} down).')
        else:
            wow = (f"<br>Change since the {fmt_ct(prev_gen)} snapshot: &mdash; "
                   f"(fewer than {MIN_STAT} matched bids in both snapshots).")
    return (f'<div class="bs-stat"><div class="v">{money_basis(st["median"])}</div>'
            f'<div class="l">{lab} median basis vs {contract_label(con)} {esc(root)}</div>'
            f'<div class="s">Range {money_basis(st["lo"])} to {money_basis(st["hi"])} &middot; '
            f'n = {st["n"]} elevators &middot; prices posted {fmt_ct(st["asof_oldest"])} to '
            f'{fmt_ct(st["asof_latest"])}{wow}</div></div>')


def loc_li(r):
    return (f'<li>{esc(r["operator"])}, {esc(r["city"])} &mdash; basis <b>{money_basis(r["basis"])}</b>, '
            f'cash ${r["cash"]:.2f} ({esc(r["delivery"] or r["period"])}), as of {fmt_ct(r["priced"])}</li>')


EXPLAINER = """<h2>What basis is, in one paragraph</h2>
  <p class="bs-sub">Basis is the local cash price minus the futures price it is quoted against:
  <b>cash &minus; futures</b>, in dollars per bushel. It carries everything futures leave out &mdash; freight to the
  river, rail or processor that ultimately buys the grain, local supply and demand, storage space and the
  elevator&rsquo;s margin. Inland elevators usually post a <b>negative</b> basis because grain has to be shipped
  toward an export port or a plant before it is worth the futures price, and that freight comes out of the bid.
  Basis tends to be <b>weakest around harvest</b>, when every bin fills at once, and to firm through winter and
  spring as supplies are drawn down; a processor or ethanol plant short of grain can flip that locally at any time.
  For the long-run picture by region, see the <a href="/basis">national basis vs normal</a> view built from USDA
  reports.</p>"""


def build_state_page(st, rows_all, summ, ctx):
    name = STATE_NAMES[st]
    sl = slug(name)
    gen = ctx["generated"]
    has_prev = ctx["prev_generated"] is not None
    elevators = {r["source"] for r in rows_all}
    cs_elev = {r["source"] for r in rows_all if r["group"] in ("corn", "soybeans")}
    groups_present = [g for g in CROP_ORDER if g in summ]
    head_n = {g: (summ[g]["contracts"][0]["n"] if summ.get(g) and summ[g]["contracts"]
                  and "median" in summ[g]["contracts"][0] else 0) for g in CROP_ORDER}
    indexable = max(head_n["corn"], head_n["soybeans"]) >= MIN_INDEX
    has_cs = any(g in summ for g in ("corn", "soybeans"))
    if "corn" in summ and "soybeans" in summ:
        crops_label = "Corn & Soybean"
    elif "corn" in summ:
        crops_label = "Corn"
    elif "soybeans" in summ:
        crops_label = "Soybean"
    elif summ:
        crops_label = "Wheat"
    else:
        crops_label = "Grain"
    n_title = len(cs_elev) if has_cs else len(elevators)
    title = make_title(name, crops_label, n_title)

    bits = []
    for g in ("corn", "soybeans"):
        c = summ.get(g, {}).get("contracts") or []
        if c and "median" in c[0]:
            bits.append(f"{CROP_LABEL[g].lower()} {plain_basis(c[0]['median'])} vs "
                        f"{contract_plain(c[0]['contract'])} (n={c[0]['n']})")
    if not bits:
        for g in CROP_ORDER[2:]:
            c = summ.get(g, {}).get("contracts") or []
            if c and "median" in c[0]:
                bits.append(f"{CROP_LABEL[g].lower()} {plain_basis(c[0]['median'])} vs "
                            f"{contract_plain(c[0]['contract'])} (n={c[0]['n']})")
                break
    if bits:
        desc = (f"{name} cash basis at {n_title} AGSIST network elevator{'s' if n_title != 1 else ''}, {fmt_date(gen)}: median "
                + "; ".join(bits) + ". Strongest and weakest bids, every elevator listed.")
        if len(desc) > 160:
            desc = (f"{name} basis, {fmt_date(gen)}, AGSIST network elevators: median " + "; ".join(bits) + ".")
    else:
        desc = (f"{name} cash grain basis from AGSIST network elevators, {fmt_date(gen)}: "
                f"{len(elevators)} elevator{'s' if len(elevators) != 1 else ''} with a fresh bid, too few for a median.")
    desc = desc[:160]

    path = f"/basis/{sl}"
    jsonld = {"@context": "https://schema.org", "@graph": [
        {"@type": "Dataset", "@id": f"{SITE}{path}#dataset",
         "name": f"{name} cash grain basis, AGSIST elevator network",
         "description": (f"Cash bids and basis (cash minus the named futures contract, $/bu) posted by "
                         f"{len(elevators)} elevators in {name} that the AGSIST elevator network read directly "
                         f"from their own bid boards, priced within {FRESH_HOURS} hours of the "
                         f"{fmt_ct(gen)} snapshot. A sample of elevators, not every elevator in the state."),
         "url": f"{SITE}{path}", "isAccessibleForFree": True,
         "creator": {"@type": "Organization", "name": "AGSIST", "url": SITE},
         "dateModified": gen.strftime("%Y-%m-%dT%H:%M:%SZ"),
         "temporalCoverage": gen.strftime("%Y-%m-%d"),
         "spatialCoverage": {"@type": "Place", "name": f"{name}, United States"},
         "variableMeasured": ["cash bid ($/bu)", "basis ($/bu, cash minus futures)"]},
        {"@type": "BreadcrumbList", "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "AGSIST", "item": f"{SITE}/"},
            {"@type": "ListItem", "position": 2, "name": "Basis", "item": f"{SITE}/basis"},
            {"@type": "ListItem", "position": 3, "name": f"{name} basis today", "item": f"{SITE}{path}"}]},
    ]}

    # ---- headline stats
    sections = []
    for g in groups_present:
        s = summ[g]
        cons = s["contracts"]
        if g.startswith("wheat") and not any("median" in c for c in cons):
            continue   # wheat only when there is enough of it
        blocks = "".join(stat_block(g, c, ctx["prev_generated"]) for c in cons[:1])
        others = [c for c in cons[1:]]
        other_html = ""
        if others:
            items = []
            for c in others:
                if "median" in c:
                    items.append(f"vs {contract_label(c['contract'])}: median {money_basis(c['median'])}, "
                                 f"range {money_basis(c['lo'])} to {money_basis(c['hi'])}, n = {c['n']}")
                else:
                    items.append(f"vs {contract_label(c['contract'])}: {c['n']} elevator"
                                 f"{'s' if c['n'] != 1 else ''} &mdash; too few for a median")
            other_html = ('<p class="bs-sub">Elevators whose nearest bid is priced against a different contract '
                          'are kept out of the headline, because a basis against one month is not comparable '
                          'with a basis against another:</p><ul class="bs-list">'
                          + "".join(f"<li>{i}</li>" for i in items) + "</ul>")
        extra = []
        if s["no_contract"]:
            extra.append(f"{len(s['no_contract'])} elevator{'s' if len(s['no_contract']) != 1 else ''} "
                         f"did not name a futures contract and {'are' if len(s['no_contract']) != 1 else 'is'} "
                         f"listed below but left out of every statistic")
        if s["suspect"]:
            extra.append(f"{len(s['suspect'])} bid{'s' if len(s['suspect']) != 1 else ''} with a basis beyond "
                         f"&plusmn;${SANITY[s['rows'][0]['crop']]:.2f} "
                         f"or an implied futures price more than 3% off the network&rsquo;s for that contract "
                         f"{'were' if len(s['suspect']) != 1 else 'was'} treated as a likely misread board and left out")
        extra_html = f'<p class="bs-sub">{"; ".join(extra)}.</p>' if extra else ""
        sw = ""
        head0 = cons[0] if cons else None
        if head0 and "median" in head0:
            sw = (f'<h3>Strongest basis ({contract_label(head0["contract"])})</h3><ul class="bs-list">'
                  + "".join(loc_li(r) for r in head0["strong"]) + "</ul>"
                  + f'<h3>Weakest basis ({contract_label(head0["contract"])})</h3><ul class="bs-list">'
                  + "".join(loc_li(r) for r in head0["weak"]) + "</ul>")
        if not cons:
            blocks = ('<div class="bs-stat"><div class="v mut">&mdash;</div><div class="l">'
                      f'{CROP_LABEL[g]}</div><div class="s">No elevator here named a futures contract, so no '
                      'basis statistic can be stated.</div></div>')
        sections.append(f'<h2 id="{g}">{CROP_LABEL[g]}</h2>\n  <div class="bs-hero">{blocks}</div>'
                        f'{other_html}{extra_html}{sw}')
    if not sections:
        sections.append('<div class="bs-note"><b>No statistic today.</b> No elevator in this state had a fresh '
                        'corn, soybean or wheat bid in the AGSIST network at this snapshot &mdash; '
                        'the page is kept so its link does not break, and fills in when boards report.</div>')

    # ---- table
    trs = []
    for r in sorted(rows_all, key=lambda r: (CROP_ORDER.index(r["group"]), r["city"], r["operator"])):
        con = (f'{contract_label(r["contract"])} <span class="mut">{contract_code(r["contract"])}</span>'
               if r["contract"] else '<span class="mut" title="the board does not name a futures month">'
                                     '&mdash; not named</span>')
        bas = money_basis(r["basis"]) + (' <span class="mut" title="beyond the sanity band; not in statistics">'
                                         '?</span>' if r.get("suspect") else "")
        wow = (f'<td class="n">{cents_delta(r["wow"])}</td>' if r.get("wow") is not None
               else '<td class="n mut" title="no matching bid in the earlier snapshot">&mdash;</td>') if has_prev else ""
        trs.append(f'<tr><td>{elevator_link(r)}</td><td>{esc(r["city"])}</td><td>{esc(CROP_LABEL[r["group"]])}'
                   f' <span class="mut">{esc(r["commodity"])}</span></td><td>{esc(r["delivery"] or r["period"])}</td>'
                   f'<td>{con}</td><td class="n">{bas}</td><td class="n">${r["cash"]:.2f}</td>{wow}'
                   f'<td>{fmt_ct(r["priced"])}</td></tr>')
    wow_th = '<th class="n">Basis chg (wk)</th>' if has_prev else ""
    table = (f'<div class="bs-scroll"><table class="bs-t"><thead><tr><th>Elevator</th><th>Town</th><th>Commodity</th>'
             f'<th>Delivery</th><th>Contract</th><th class="n">Basis</th><th class="n">Cash</th>{wow_th}'
             f'<th>Price as of</th></tr></thead><tbody>' + "".join(trs) + "</tbody></table></div>") if trs else \
        '<p class="bs-sub">&mdash; no fresh network bids in this state at this snapshot.</p>'

    wow_note = (f"Week-over-week compares each bid with the same elevator&rsquo;s same delivery period and contract "
                f"in the network snapshot of {fmt_ct(ctx['prev_generated'])}; bids with no match show &mdash;."
                if has_prev else
                "No week-over-week change is shown: an earlier network snapshot about seven days back "
                "was not available to this build, and a change is never estimated.")
    links = [f'<a href="/basis">national basis vs normal (USDA)</a>', '<a href="/cash-bids">cash bids near you</a>']
    if os.path.exists(os.path.join(ctx["root"], "rent", f"{sl}.html")):
        links.append(f'<a href="/rent/{sl}">{name} cash rent by county</a>')
    if os.path.exists(os.path.join(ctx["root"], "farmland-atlas", sl, "index.html")):
        links.append(f'<a href="/farmland-atlas/{sl}/">{name} Farmland Atlas</a>')
    cloud = " &middot; ".join(f'<a href="/basis/{slug(STATE_NAMES[o])}">{STATE_NAMES[o]}</a>'
                              for o in sorted(ctx["all_states"], key=lambda s: STATE_NAMES[s]) if o != st)
    hdr, ftr = ctx["chrome"]
    body = f"""
<body>
{hdr}
<main class="bs-wrap" id="main">
  <p class="bs-sub" style="margin-top:14px"><a href="/basis" style="color:var(--text-muted)">Basis</a> &rsaquo; <b style="color:var(--text)">{name}</b></p>
  <h1>{name} cash basis today &mdash; AGSIST network elevators</h1>
  <p class="bs-sub">Basis (cash &minus; futures, $/bu) at the <b>{len(elevators)}</b> {name} elevator{'s' if len(elevators) != 1 else ''}
  in the AGSIST elevator network with a fresh bid, read directly from each elevator&rsquo;s own bid board.
  This is a sample of {name} elevators, not all of them. Snapshot of <b>{fmt_ct(gen)}</b>; page built {fmt_ct(ctx['built'])}.
  Each elevator counts once per crop, at its nearest open delivery period.</p>
  {''.join(sections)}
  <h2 id="elevators">Every fresh network elevator in {name}</h2>
  <p class="bs-sub">One row per elevator and crop (its nearest open delivery). The elevator name opens
  <a href="/cash-bids">/cash-bids</a> at that ZIP for every delivery month. {wow_note}</p>
  {table}
  <div class="bs-note"><b>How these numbers are made.</b> Source: the AGSIST elevator network (dnilgis/bids),
  boards read directly; no third-party bid feed is used on this page. A bid counts only if its board was confirmed
  live on the latest read and its price was posted within {FRESH_HOURS} hours of the snapshot &mdash; long enough
  that a board unchanged over a weekend still counts on Monday. Specialty bids (white, organic, non-GMO, high-oleic,
  identity-preserved) are excluded. Medians and ranges are printed only with at least {MIN_STAT} elevators on the
  same futures contract. Prices are a snapshot as of {fmt_ct(gen)} and will have moved since; call the elevator
  before you haul.</div>
  {EXPLAINER}
  <p class="bs-links bs-sub">Related: {' &middot; '.join(links)}.</p>
  <h2>Basis in other states</h2>
  <p class="bs-cloud">{cloud}</p>
</main>
{ftr}
<script src="/components/loader.js?v=16" defer></script>
</body>
</html>
"""
    return head(title, desc, path, jsonld, indexable) + body, {
        "state": st, "slug": sl, "title": title, "desc": desc, "indexable": indexable,
        "elevators": len(elevators), "head_n": head_n,
        "medians": {g: summ[g]["contracts"][0].get("median") for g in summ if summ[g]["contracts"]},
    }


# ---------------------------------------------------------------- build
def build_all(merged, index, prev_doc=None, out_dir=OUT_DIR, root=".", now=None, check_age=True):
    now = now or dt.datetime.now(dt.timezone.utc)
    gen = parse_ts(merged.get("generated"))
    if gen is None:
        raise SystemExit("[state-basis] merged-all.json has no generated time; refusing to build")
    age_h = (now - gen).total_seconds() / 3600
    if check_age and age_h > MAX_SNAPSHOT_AGE_H:
        raise SystemExit(f"[state-basis] network snapshot is {age_h:.1f} h old (> {MAX_SNAPSHOT_AGE_H}); "
                         f"refusing to publish it as today's basis")
    drops = {}
    rows = fresh_rows(merged, index, drops)
    # HARD GATE: nothing but network boards.
    ids = {s["id"] for s in index.get("sources") or []}
    bad = [r for r in rows if r["source"] not in ids or r["via"] != "scrape"]
    if bad:
        raise SystemExit(f"[state-basis] {len(bad)} non-network rows reached the build; refusing")
    flag_futures_disagreement(rows)
    near = nearby(rows)
    prev_map = build_prev_map(prev_doc) if prev_doc else None
    prev_gen = parse_ts(prev_doc.get("generated")) if prev_doc else None

    # States: every state with any network board at all, so a page never
    # vanishes on a quiet day (it goes noindex instead).
    states = {(s.get("usState") or "").upper() for s in index.get("sources") or []}
    states |= {r["state"] for r in near}
    states = sorted(s for s in states if s in STATE_NAMES)
    os.makedirs(out_dir, exist_ok=True)
    ctx = {"generated": gen, "built": now, "prev_generated": prev_gen, "root": root,
           "chrome": static_chrome(root), "all_states": states}
    metas = []
    for st in states:
        srows = [r for r in near if r["state"] == st]
        summ = summarise_state(srows, prev_map)
        page, meta = build_state_page(st, srows, summ, ctx)
        with open(os.path.join(out_dir, f"{meta['slug']}.html"), "w", encoding="utf-8") as f:
            f.write(page)
        metas.append(meta)
    idx = [f"{SITE}/basis/{m['slug']}" for m in metas if m["indexable"]]
    with open(os.path.join(out_dir, "_indexable.txt"), "w") as f:
        f.write("".join(u + "\n" for u in idx))
    print(f"[state-basis] snapshot {merged.get('generated')} ({age_h:.1f} h old); "
          f"{len(rows)} fresh rows -> {len(near)} elevator-crop bids; drops {drops}")
    print(f"[state-basis] week-over-week: "
          + (f"vs snapshot {prev_doc.get('generated')}" if prev_doc else "omitted (no earlier snapshot)"))
    print(f"[state-basis] {len(metas)} pages, {len(idx)} indexable -> {out_dir}/")
    return metas, drops


# ---------------------------------------------------------------- selftest
def _fixture():
    gen = "2026-10-06T13:00:00Z"
    fresh = "2026-10-06T12:00:00Z"
    old = "2026-10-01T12:00:00Z"
    srcs, bids = [], []

    def add(i, st, crop, basis, fm="ZCZ26", period="2026-10", status="ok", stale=False, priced=fresh,
            commodity=None, currency="USD", src_status="ok", via="scrape", in_index=True, unit="per-bushel"):
        sid = f"t-{i}"
        if in_index:
            srcs.append({"id": sid, "operator": f"Op {i}", "location": f"Town{i}", "usState": st,
                         "zip": "50010", "status": src_status, "health": "live" if src_status == "ok" else src_status,
                         "provenance": "scraped", "pricedAt": priced, "checkedAt": priced})
        fut = 4.20 if crop == "corn" else 10.20
        bids.append({"place": f"Op {i}||Town{i}|{st}", "operator": f"Op {i}", "city": f"Town{i}", "state": st,
                     "zip": "50010", "currency": currency, "commodity": commodity or crop.title(), "crop": crop,
                     "delivery": "Oct 2026", "period": period, "periodPast": False, "cash": round(fut + basis, 4),
                     "basis": basis, "basisCents": round(basis * 100, 2), "basisUnit": unit, "futuresMonth": fm,
                     "via": via, "source": sid, "sourceStatus": status, "stale": stale, "pricedAt": priced,
                     "checkedAt": priced})
    # Iowa: 6 corn on Dec, 1 corn on Mar (must not mix), 5 beans on Nov
    for i, b in enumerate([-0.30, -0.40, -0.35, -0.50, -0.25, -0.45]):
        add(f"ia{i}", "IA", "corn", b)
    add("iamar", "IA", "corn", +0.10, fm="ZCH27")
    for i, b in enumerate([-0.60, -0.70, -0.65, -0.55, -0.80]):
        add(f"ias{i}", "IA", "soybeans", b, fm="Nov 26 Soybeans")
    # Every one of these must be excluded:
    add("stale", "IA", "corn", -5.0, stale=True)
    add("broken", "IA", "corn", -5.0, status="broken")
    add("oldprice", "IA", "corn", -5.0, priced=old)
    add("cad", "IA", "corn", -5.0, currency="CAD")
    add("white", "IA", "corn", -5.0, commodity="WHITE CORN")
    add("barchart", "IA", "corn", -5.0, in_index=False)
    add("notscrape", "IA", "corn", -5.0, via="barchart")
    add("unit", "IA", "corn", -5.0, unit="unknown")
    add("refused", "IA", "corn", -5.0, src_status="refused")
    # Listed but kept out of statistics: implied futures 5.80 vs the network's 4.20.
    add("badfut", "IA", "corn", -0.90)
    bids[-1]["cash"] = 4.90
    # Thin state: 2 corn elevators
    add("mo0", "MO", "corn", -0.20)
    add("mo1", "MO", "corn", -0.30)
    merged = {"schema": "agsist-merged-all/1", "generated": gen, "bids": bids}
    index = {"generated": gen, "sources": srcs}
    prev = json.loads(json.dumps(merged))
    prev["generated"] = "2026-09-29T13:00:00Z"
    for b in prev["bids"]:
        b["pricedAt"] = b["checkedAt"] = "2026-09-29T12:00:00Z"
        b["basis"] = round(b["basis"] - 0.05, 4)
    return merged, index, prev


def selftest():
    import tempfile as _tf
    assert parse_contract("ZCZ26", "corn", 2026) == ("ZC", 11, 2026)
    assert parse_contract("ZCH7", "corn", 2026) == ("ZC", 2, 2027)
    assert parse_contract("December 2026", "corn", 2026) == ("ZC", 11, 2026)
    assert parse_contract("Nov 26 Soybeans", "soybeans", 2026) == ("ZS", 10, 2026)
    assert parse_contract("Dec 26 KCBT Red Wheat", "wheat", 2026) == ("KE", 11, 2026)
    assert parse_contract("Dec 26 Wheat", "wheat", 2026) is None
    assert parse_contract("12.5975s", "soybeans", 2026) is None
    assert parse_contract("MWOZ26", "wheat", 2026)[0] == "MWO"
    snap = parse_ts("2026-10-06T13:00:00Z")
    assert period_start("2026-09", snap) is None
    assert period_start("2026-09/2026-11", snap) == "2026-10"
    assert period_start("spot", snap) == "2026-10"
    assert period_start("newcrop-2026", snap) is None
    assert plain_basis(-0.625) == "-$0.63" and money_basis(0.0) == "even" and plain_basis(0.0) == "even"
    merged, index, prev = _fixture()
    with _tf.TemporaryDirectory() as td:
        metas, drops = build_all(merged, index, prev, out_dir=td, root=".",
                                 now=parse_ts("2026-10-06T14:00:00Z"))
        m = {x["state"]: x for x in metas}
        ia = m["IA"]
        assert ia["indexable"] and not m["MO"]["indexable"], m
        # Dec-only median of the six Dec bids; the Mar bid and every excluded row stay out.
        assert abs(ia["medians"]["corn"] - statistics.median([-0.30, -0.40, -0.35, -0.50, -0.25, -0.45])) < 1e-9
        assert abs(ia["medians"]["soybeans"] - (-0.65)) < 1e-9
        assert ia["head_n"]["corn"] == 6 and ia["head_n"]["soybeans"] == 5
        for k in ("stale_or_unconfirmed", "price_older_than_cutoff", "not_usd", "specialty_commodity",
                  "not_a_network_board", "not_scraped", "no_basis_in_dollars", "board_not_live"):
            assert drops.get(k), (k, drops)
        page = open(os.path.join(td, "iowa.html")).read()
        assert "-5.00" not in page and "&minus;$5.00" not in page, "an excluded row leaked"
        assert 'content="index,follow"' in page
        assert '<link rel="canonical" href="https://agsist.com/basis/iowa">' in page
        assert "FAQPage" not in page
        assert len(ia["title"]) <= 60 and len(ia["desc"]) <= 160, (ia["title"], ia["desc"])
        assert "Iowa Corn &amp; Soybean Basis" in page
        assert "implied futures price more than 3%" in page and "Op badfut" in page
        assert "+5&cent;" in page, "week-over-week matched-pair change missing"
        for blk in re.findall(r'<script type="application/ld\+json">(.*?)</script>', page, re.S):
            doc = json.loads(blk)
            types = {g["@type"] for g in doc["@graph"]}
            assert types == {"Dataset", "BreadcrumbList"}, types
        mo = open(os.path.join(td, "missouri.html")).read()
        assert 'content="noindex,follow"' in mo and "a median needs at least" in mo
        lst = open(os.path.join(td, "_indexable.txt")).read().split()
        assert lst == ["https://agsist.com/basis/iowa"], lst
        # Without a previous snapshot the WoW column disappears rather than inventing one.
        build_all(merged, index, None, out_dir=td, root=".", now=parse_ts("2026-10-06T14:00:00Z"))
        page2 = open(os.path.join(td, "iowa.html")).read()
        assert "Basis chg (wk)" not in page2 and "No week-over-week change is shown" in page2
        # A stale snapshot refuses to build.
        try:
            build_all(merged, index, None, out_dir=td, now=parse_ts("2026-10-09T14:00:00Z"))
            raise AssertionError("stale snapshot built")
        except SystemExit:
            pass
    print("selftest OK")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--bids-dir", help="local dnilgis/bids clone instead of the published URLs")
    ap.add_argument("--base", help="network base URL (default: fetch_bids.BIDS_NETWORK_BASE)")
    ap.add_argument("--prev-file", help="explicit earlier merged-all.json for week-over-week")
    ap.add_argument("--no-wow", action="store_true", help="skip week-over-week")
    ap.add_argument("--out", default=OUT_DIR)
    ap.add_argument("--root", default=".")
    ap.add_argument("--ignore-age", action="store_true", help="build even from an old snapshot (testing)")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        selftest()
        return
    merged, index = load_network(a.bids_dir, a.base)
    gen = parse_ts(merged.get("generated"))
    prev = None
    if not a.no_wow and gen:
        prev = load_previous(gen, bids_dir=a.bids_dir, prev_file=a.prev_file, allow_remote=not a.bids_dir)
    build_all(merged, index, prev, out_dir=a.out, root=a.root, check_age=not a.ignore_age)


if __name__ == "__main__":
    main()
