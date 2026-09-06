#!/usr/bin/env python3
"""
cot_deep.py — the long memory behind /cot

WHY THIS EXISTS
---------------
`fetch_cot.py` reads one number per commodity — managed money net — and keeps
52 weeks of it. That is enough to draw a line. It is not enough to answer the
only question a hedger actually has, which is *"has this ever happened before,
and what happened next?"*

Answering that needs three things the old file does not carry:

  1. **Every trader group, not one.** Managed money is one side of a four-sided
     table. Producer/merchant (the elevators and processors hedging real
     bushels), swap dealers, other reportables and the non-reportable small
     trader all sit on the other side of every contract the funds hold. Net
     managed money can rise because funds bought or because commercials sold,
     and those are different markets.

  2. **Open interest.** 400k contracts net long means one thing in a 1.2m-lot
     market and another in a 1.8m-lot market. Every extreme on this page is
     scaled by open interest as well as stated raw, because the raw number has
     drifted upward for twenty years along with the size of the market.

  3. **Twenty years, not one.** A "52-week high" is a statement about one year.
     A percentile against 2006 is a statement about the contract.

WHAT IT WRITES
--------------
  data/cot-deep.json    columnar, one block per commodity:
      dates[]  oi[]  mm_long[] mm_short[] mm_spread[]
      pm_long[] pm_short[]  swap_long[] swap_short[] swap_spread[]
      or_long[] or_short[]  nr_long[] nr_short[]
      tr_mm_long[] tr_mm_short[] tr_total[]
      px_tue[]      Tuesday close  (the as-of date; what the position was held against)
      px_entry[]    THE FIRST CLOSE A HUMAN COULD HAVE TRADED ON THIS REPORT
                    -- cot_calendar.entry_date() decides which one, using the
                    week's REAL publication date. This single column is the
                    difference between a backtest and a fantasy.
      px_adj[]      the same roll-repaired index at the as-of Tuesday, which is
                    what price momentum is measured on
      px_entry_date[] the date px_entry actually resolved to

  The publication date is NOT stored: cot_calendar.release_date() derives it
  from the as-of date, and storing eleven identical string columns of it cost
  a quarter of a megabyte a week in a file that is rewritten whole.

  Columnar because it is roughly a third the bytes of a list of objects at this
  length, and the page lazy-loads it only when a reader opens a deep panel.

MODES
-----
  --rebuild        Full history from CFTC's annual archive zips. Slow (~20
                   files, a few hundred MB of download). Runs weekly, not on
                   the release hot path.
  --append         One new week from CFTC's Socrata API — two HTTP calls, a
                   couple of seconds. This is what runs the minute the report
                   drops, because re-reading twenty years to learn one week is
                   how you end up publishing at 4:15 instead of 3:31.
  --verify         Rebuild into memory and compare against the committed file.
                   CFTC *revises* prior weeks. An append-only file that is
                   never reconciled slowly stops being CFTC's data and starts
                   being ours. This is the reconciliation, and it is loud.

Requires: yfinance + pandas for prices (already installed by cot.yml).
"""

import argparse
import csv
import io
import json
import os
import re
import sys
import urllib.request
import zipfile
from datetime import datetime, timedelta, date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cot_calendar as CAL

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, ".."))
DATA = os.path.join(ROOT, "data")
DEEP_PATH = os.path.join(DATA, "cot-deep.json")

ARCHIVE_URL = "https://www.cftc.gov/files/dea/history/fut_disagg_txt_{year}.zip"
SOCRATA_URL = ("https://publicreporting.cftc.gov/resource/72hh-3qpy.json"
               "?$limit=400&$order=report_date_as_yyyy_mm_dd%20DESC")

# Disaggregated reporting begins 2006-06-13. Earlier weeks exist only in the
# legacy (commercial / non-commercial) format, which is a DIFFERENT definition
# of a fund and must not be silently concatenated onto this one.
FIRST_YEAR = 2006

COMMODITIES = [
    "corn", "beans", "wheat", "kcwheat", "mplswheat",
    "soymeal", "soyoil",
    "livecattle", "feedercattle", "leanhogs",
    "milk",
]

# COT key -> yfinance front-month continuous symbol. Same table as
# enrich_cot_prices.py; kept here rather than imported so a change to one
# cannot silently re-point the other.
SYMBOLS = {
    "corn": "ZC=F", "beans": "ZS=F", "wheat": "ZW=F", "kcwheat": "KE=F",
    "mplswheat": "MWE=F", "soymeal": "ZM=F", "soyoil": "ZL=F",
    "livecattle": "LE=F", "feedercattle": "GF=F", "leanhogs": "HE=F",
    "milk": "DC=F",
}

# ── column resolution ───────────────────────────────────────────────────────
# CFTC's header spellings are not stable. The same field is
# "Swap__Positions_Short_All" in the archive text files (two underscores, a
# typo they have never fixed) and "swap__positions_short_all" in Socrata, and
# older archive years drop or add an "_All" suffix here and there. Matching on
# a literal name is how a parser silently reads zeros for a whole trader group
# and nobody notices until a chart is flat.
#
# So: normalise every header (lowercase, non-alphanumerics collapsed to one
# underscore, edges stripped) and match against a candidate list. If NO
# candidate matches, that is a hard failure, not a zero.

def _norm(s: str) -> str:
    return re.sub(r"_+", "_", re.sub(r"[^a-z0-9]+", "_", (s or "").lower())).strip("_")

FIELDS = {
    "oi":          ["open_interest_all", "open_interest"],
    "mm_long":     ["m_money_positions_long_all"],
    "mm_short":    ["m_money_positions_short_all"],
    "mm_spread":   ["m_money_positions_spread_all", "m_money_positions_spread"],
    "pm_long":     ["prod_merc_positions_long_all", "prod_merc_positions_long"],
    "pm_short":    ["prod_merc_positions_short_all", "prod_merc_positions_short"],
    "swap_long":   ["swap_positions_long_all"],
    "swap_short":  ["swap_positions_short_all"],
    "swap_spread": ["swap_positions_spread_all"],
    "or_long":     ["other_rept_positions_long_all", "other_rept_positions_long"],
    "or_short":    ["other_rept_positions_short_all", "other_rept_positions_short"],
    "nr_long":     ["nonrept_positions_long_all"],
    "nr_short":    ["nonrept_positions_short_all"],
    "tr_mm_long":  ["traders_m_money_long_all"],
    "tr_mm_short": ["traders_m_money_short_all"],
    "tr_total":    ["traders_tot_all"],
}
DATE_FIELDS = ["report_date_as_yyyy_mm_dd", "as_of_date_in_form_yymmdd"]
NAME_FIELDS = ["market_and_exchange_names"]

# Fields the page can live without if an archive year predates them. Trader
# counts and swap spread are the only ones; a missing POSITION column is fatal.
OPTIONAL = {"tr_mm_long", "tr_mm_short", "tr_total", "swap_spread", "mm_spread"}


def build_colmap(headers) -> dict:
    have = {_norm(h): h for h in headers}
    out, missing = {}, []
    for key, cands in FIELDS.items():
        hit = next((have[c] for c in cands if c in have), None)
        if hit is not None:
            out[key] = hit
        elif key not in OPTIONAL:
            missing.append(key)
    if missing:
        raise SystemExit(
            "FATAL: CFTC changed a column name. Unmatched: " + ", ".join(sorted(missing))
            + "\nHeaders seen: " + ", ".join(sorted(have.keys()))[:2000]
        )
    out["_date"] = next((have[c] for c in DATE_FIELDS if c in have), None)
    out["_name"] = next((have[c] for c in NAME_FIELDS if c in have), None)
    if not out["_date"] or not out["_name"]:
        raise SystemExit("FATAL: no usable date or market-name column in CFTC file.")
    return out


def match_commodity(market: str):
    """Identical rules to fetch_cot.py. Two readers of the same file that
    disagree about what 'wheat' means is a bug waiting for a Friday."""
    m = (market or "").lower().strip()
    if m.startswith("corn - chicago"):
        return "corn"
    if m.startswith("soybeans - chicago"):
        return "beans"
    if "wheat-srw" in m or m.startswith("wheat - chicago"):
        return "wheat"
    if "wheat-hrw" in m:
        return "kcwheat"
    if "wheat-hrspring" in m or ("spring" in m and "wheat" in m):
        return "mplswheat"
    if m.startswith("soybean oil"):
        return "soyoil"
    if m.startswith("soybean meal"):
        return "soymeal"
    if m.startswith("live cattle"):
        return "livecattle"
    if m.startswith("feeder cattle"):
        return "feedercattle"
    if m.startswith("lean hogs"):
        return "leanhogs"
    if ("class iii" in m and "milk" in m) or m.startswith("milk, class iii"):
        return "milk"
    return None


def _int(v):
    if v is None:
        return 0
    s = str(v).strip().replace(",", "")
    if s in ("", ".", "-", "n/a", "NA"):
        return 0
    try:
        return int(float(s))
    except ValueError:
        return 0


def _date_of(row, colmap):
    raw = (row.get(colmap["_date"]) or "").strip()
    if not raw:
        return None
    raw = raw.split("T")[0]
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m-%d-%Y"):
        try:
            return datetime.strptime(raw, fmt).date()
        except ValueError:
            pass
    if len(raw) == 6 and raw.isdigit():          # YYMMDD
        return date(2000 + int(raw[:2]), int(raw[2:4]), int(raw[4:]))
    return None


def parse_rows(text: str) -> list:
    reader = csv.DictReader(io.StringIO(text))
    rows = list(reader)
    if not rows:
        return []
    colmap = build_colmap(rows[0].keys())
    out = []
    for r in rows:
        key = match_commodity(r.get(colmap["_name"], ""))
        if key is None:
            continue
        d = _date_of(r, colmap)
        if d is None:
            continue
        rec = {"commodity": key, "date": d}
        for f in FIELDS:
            rec[f] = _int(r.get(colmap[f])) if f in colmap else 0
        out.append(rec)
    return out


def fetch_archive(year: int):
    url = ARCHIVE_URL.format(year=year)
    print(f"  GET {url}", flush=True)
    req = urllib.request.Request(url, headers={"User-Agent": "AGSIST/1.0 (+https://agsist.com/cot)"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        raw = resp.read()
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        inner = next((n for n in z.namelist() if n.lower().endswith(".txt")), z.namelist()[0])
        return z.open(inner).read().decode("utf-8", errors="replace")


def fetch_socrata():
    req = urllib.request.Request(SOCRATA_URL, headers={"User-Agent": "AGSIST/1.0 (+https://agsist.com/cot)"})
    with urllib.request.urlopen(req, timeout=45) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    # Socrata hands back JSON objects; reuse the CSV path by writing them out.
    if not payload:
        return []
    buf = io.StringIO()
    keys = sorted({k for row in payload for k in row})
    w = csv.DictWriter(buf, fieldnames=keys, extrasaction="ignore")
    w.writeheader()
    for row in payload:
        w.writerow(row)
    return parse_rows(buf.getvalue())


# ── prices ──────────────────────────────────────────────────────────────────

def load_price_frames(start: date):
    """{key: {date: close}} from yfinance. Missing symbol -> empty dict, and
    every downstream consumer treats an absent price as 'no read', never as 0."""
    try:
        import yfinance as yf
    except ImportError:
        print("  yfinance not installed — prices will be omitted", flush=True)
        return {k: {} for k in COMMODITIES}
    out = {}
    for key, sym in SYMBOLS.items():
        try:
            df = yf.Ticker(sym).history(start=start.isoformat(), interval="1d", auto_adjust=False)
            closes = {}
            for idx, val in df["Close"].items():
                if val == val:                     # NaN check without importing math
                    closes[idx.date()] = round(float(val), 4)
            out[key] = closes
            print(f"  {key:12s} {sym:6s} {len(closes)} daily closes", flush=True)
        except Exception as e:
            out[key] = {}
            print(f"  {key:12s} {sym:6s} FAILED ({e}) — positioning still publishes, price overlay does not", flush=True)
    return out


def close_on_or_before(closes: dict, d: date, window: int = 4):
    """Nearest close at or before d, as (value, date_used) so a caller can tell
    the difference between Tuesday's close and the previous Wednesday's. Four
    days, not seven: a price a week away is not the price the label claims."""
    for i in range(window + 1):
        v = closes.get(d - timedelta(days=i))
        if v is not None:
            return v, d - timedelta(days=i)
    return None, None


def close_on_or_after(closes: dict, d: date, window: int = 4):
    for i in range(window + 1):
        v = closes.get(d + timedelta(days=i))
        if v is not None:
            return v, d + timedelta(days=i)
    return None, None


# ── assembly ────────────────────────────────────────────────────────────────

def assemble(records: list, prices: dict) -> dict:
    by_key = {k: {} for k in COMMODITIES}
    for r in records:
        by_key.setdefault(r["commodity"], {})[r["date"]] = r

    blocks = {}
    for key in COMMODITIES:
        dated = sorted(by_key.get(key, {}).items())
        if not dated:
            print(f"  WARNING: no rows at all for {key}", flush=True)
            continue

        raw = prices.get(key, {})
        # The roll-repaired index. Percentage change is read off THIS; the
        # quoted price the page prints is read off `raw`. See cot_calendar.
        adj = CAL.roll_adjust(raw, key) if raw else {}

        b = {f: [] for f in FIELDS}
        for extra in ("dates", "px_tue", "px_adj", "px_entry", "px_entry_date"):
            b[extra] = []

        for d, r in dated:
            b["dates"].append(d.isoformat())
            for f in FIELDS:
                b[f].append(r.get(f, 0))
            px, _ = close_on_or_before(raw, d)
            b["px_tue"].append(px)
            aj, _ = close_on_or_before(adj, d)
            b["px_adj"].append(round(aj, 3) if aj is not None else None)
            ev, ed = close_on_or_after(adj, CAL.entry_date(d))
            b["px_entry"].append(round(ev, 3) if ev is not None else None)
            b["px_entry_date"].append(ed.isoformat() if ed else None)

        # WEEKLY SPACING IS AN ASSUMPTION EVERY FORWARD RETURN RESTS ON.
        # A 13-week return is indexed thirteen ROWS ahead. One missing week
        # silently turns that into fourteen, under a label that still says
        # thirteen. Report gaps here rather than let them be found later as a
        # number nobody can reproduce.
        gaps = []
        for i in range(1, len(b["dates"])):
            n = (date.fromisoformat(b["dates"][i]) - date.fromisoformat(b["dates"][i - 1])).days
            if n != 7:
                gaps.append({"from": b["dates"][i - 1], "to": b["dates"][i], "days": n})
        if gaps:
            print(f"  {key:12s} NON-WEEKLY GAPS: {len(gaps)}  e.g. {gaps[:3]}", flush=True)
        b["gaps"] = gaps

        blocks[key] = b
        npx = sum(1 for v in b["px_entry"] if v is not None)
        print(f"  {key:12s} {len(b['dates']):5d} weeks  {b['dates'][0]} -> {b['dates'][-1]}  "
              f"{npx} tradable entries  {len(gaps)} gaps", flush=True)
    return blocks


def write_deep(blocks: dict, note: str):
    os.makedirs(DATA, exist_ok=True)
    payload = {
        "updated": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "CFTC Disaggregated Futures-Only, Commitments of Traders",
        "entry_convention": ("Forward returns are measured from px_entry: the first session close "
                             "after CFTC actually published, using that week's real publication date "
                             "(federal holidays delay it) rather than an assumed Friday. px_entry and "
                             "px_adj are a roll-repaired index, not a price; px_tue is the quoted "
                             "close on the as-of Tuesday."),
        "price_convention": ("Front-month continuous futures with the roll steps removed: daily "
                             "returns are chained and the return across each front-month change is "
                             "dropped. Roll dates come from scripts/contract_calendar.py."),
        "build": note,
        "commodities": blocks,
    }
    with open(DEEP_PATH, "w") as f:
        json.dump(payload, f, separators=(",", ":"))
    print(f"Written {DEEP_PATH}  ({os.path.getsize(DEEP_PATH)/1024:.0f} KB)")


def load_deep():
    if not os.path.exists(DEEP_PATH):
        return None
    with open(DEEP_PATH) as f:
        return json.load(f)


def cmd_rebuild(args):
    years = list(range(max(FIRST_YEAR, args.since), datetime.now().year + 1))
    print(f"Rebuilding {len(years)} archive years ({years[0]}–{years[-1]})", flush=True)
    records = []
    for y in years:
        try:
            records.extend(parse_rows(fetch_archive(y)))
        except SystemExit:
            raise
        except Exception as e:
            print(f"  {y}: FAILED ({e})", flush=True)
            if y >= datetime.now().year - 1:
                raise SystemExit(f"FATAL: could not read {y}, which is a year the current read depends on.")
    if not records:
        raise SystemExit("FATAL: no rows parsed from any archive year.")
    start = min(r["date"] for r in records) - timedelta(days=10)
    print(f"Fetching prices from {start}", flush=True)
    blocks = assemble(records, load_price_frames(start))
    write_deep(blocks, f"rebuild {years[0]}–{years[-1]}")


def cmd_append(args):
    deep = load_deep()
    if deep is None:
        raise SystemExit("No data/cot-deep.json yet — run --rebuild first.")
    fresh = fetch_socrata()
    if not fresh:
        print("Socrata returned nothing — leaving the file alone.")
        return 0
    latest = max(r["date"] for r in fresh)
    known = set(deep["commodities"].get("corn", {}).get("dates", []))
    if latest.isoformat() in known:
        print(f"Latest CFTC report ({latest}) is already in cot-deep.json — nothing to append.")
        return 0
    print(f"New report date: {latest}", flush=True)

    prices = load_price_frames(latest - timedelta(days=30))
    added = 0
    for key in COMMODITIES:
        b = deep["commodities"].get(key)
        rows = [r for r in fresh if r["commodity"] == key and r["date"] == latest]
        if not b or not rows:
            continue
        r = rows[0]
        if b["dates"] and b["dates"][-1] >= latest.isoformat():
            continue
        b["dates"].append(latest.isoformat())
        for f in FIELDS:
            b.setdefault(f, []).append(r.get(f, 0))
        raw = prices.get(key, {})
        adj = CAL.roll_adjust(raw, key) if raw else {}
        px, _ = close_on_or_before(raw, latest)
        aj, _ = close_on_or_before(adj, latest)
        b["px_tue"].append(px)
        b.setdefault("px_adj", []).append(aj)
        # The entry close is days in the future on release night. It goes in as
        # null and is filled by the next run rather than guessed. Nothing the
        # reader sees tonight depends on it: the board reads px_adj, which is
        # known as of the Tuesday.
        ev, ed = close_on_or_after(adj, CAL.entry_date(latest))
        b["px_entry"].append(ev)
        b.setdefault("px_entry_date", []).append(ed.isoformat() if ed else None)
        added += 1
    # Backfill any entry price that was null when its week was appended.
    filled = 0
    for key in COMMODITIES:
        b = deep["commodities"].get(key)
        if not b:
            continue
        raw = prices.get(key, {})
        if not raw:
            continue
        adj = CAL.roll_adjust(raw, key)
        for i in range(max(0, len(b["dates"]) - 8), len(b["dates"])):
            d = date.fromisoformat(b["dates"][i])
            if b["px_entry"][i] is None:
                v, ed = close_on_or_after(adj, CAL.entry_date(d))
                if v is not None:
                    b["px_entry"][i] = v
                    b["px_entry_date"][i] = ed.isoformat()
                    filled += 1
            if b["px_tue"][i] is None:
                v, _ = close_on_or_before(raw, d)
                if v is not None:
                    b["px_tue"][i] = v
            if b.get("px_adj") and b["px_adj"][i] is None:
                v, _ = close_on_or_before(adj, d)
                if v is not None:
                    b["px_adj"][i] = v
    print(f"Appended {added} commodities, backfilled {filled} entry prices.", flush=True)
    write_deep(deep["commodities"], f"append {latest}")
    return 0


def cmd_verify(args):
    """CFTC revises. Rebuild into memory, compare cell by cell, and be loud."""
    deep = load_deep()
    if deep is None:
        raise SystemExit("No data/cot-deep.json to verify.")
    years = list(range(max(FIRST_YEAR, args.since), datetime.now().year + 1))
    records = []
    for y in years:
        records.extend(parse_rows(fetch_archive(y)))
    fresh = assemble(records, {k: {} for k in COMMODITIES})
    drift = 0
    for key, b in fresh.items():
        old = deep["commodities"].get(key)
        if not old:
            print(f"  {key}: missing from committed file"); drift += 1; continue
        idx = {d: i for i, d in enumerate(old["dates"])}
        for i, d in enumerate(b["dates"]):
            j = idx.get(d)
            if j is None:
                print(f"  {key} {d}: week missing from committed file"); drift += 1; continue
            for f in ("oi", "mm_long", "mm_short", "pm_long", "pm_short"):
                if b[f][i] != old[f][j]:
                    print(f"  {key} {d} {f}: committed {old[f][j]} vs CFTC {b[f][i]}")
                    drift += 1
    print(f"\n{drift} cell(s) drifted from CFTC.")
    return 1 if drift else 0



# ── selftest ────────────────────────────────────────────────────────────────
# The only part of this file that cannot be exercised locally is the network.
# Everything else -- column matching against BOTH of CFTC's header spellings,
# market matching, date parsing, the weekly-spacing check, and the whole
# --append path -- runs here against fixtures built from the real field names.
#
# The archive zips and the Socrata API do not agree on capitalisation, on
# underscores, or on the "_All" suffix, and a parser that silently reads zero
# for a trader group is how a chart goes flat and nobody notices for a month.

SOCRATA_HEADERS = [
    "market_and_exchange_names", "report_date_as_yyyy_mm_dd", "open_interest_all",
    "prod_merc_positions_long", "prod_merc_positions_short",
    "swap_positions_long_all", "swap__positions_short_all", "swap__positions_spread_all",
    "m_money_positions_long_all", "m_money_positions_short_all", "m_money_positions_spread",
    "other_rept_positions_long", "other_rept_positions_short",
    "nonrept_positions_long_all", "nonrept_positions_short_all",
    "traders_tot_all", "traders_m_money_long_all", "traders_m_money_short_all",
]
ARCHIVE_HEADERS = [
    "Market_and_Exchange_Names", "As_of_Date_In_Form_YYMMDD", "Report_Date_as_YYYY-MM-DD",
    "Open_Interest_All", "Prod_Merc_Positions_Long_All", "Prod_Merc_Positions_Short_All",
    "Swap_Positions_Long_All", "Swap__Positions_Short_All", "Swap__Positions_Spread_All",
    "M_Money_Positions_Long_All", "M_Money_Positions_Short_All", "M_Money_Positions_Spread",
    "Other_Rept_Positions_Long_All", "Other_Rept_Positions_Short_All",
    "NonRept_Positions_Long_All", "NonRept_Positions_Short_All",
    "Traders_Tot_All", "Traders_M_Money_Long_All", "Traders_M_Money_Short_All",
]
# The market strings exactly as CFTC writes them.
MARKET_NAMES = {
    "corn": "CORN - CHICAGO BOARD OF TRADE",
    "beans": "SOYBEANS - CHICAGO BOARD OF TRADE",
    "wheat": "WHEAT-SRW - CHICAGO BOARD OF TRADE",
    "kcwheat": "WHEAT-HRW - CHICAGO BOARD OF TRADE",
    "mplswheat": "WHEAT-HRSPRING - MIAX FUTURES EXCHANGE",
    "soymeal": "SOYBEAN MEAL - CHICAGO BOARD OF TRADE",
    "soyoil": "SOYBEAN OIL - CHICAGO BOARD OF TRADE",
    "livecattle": "LIVE CATTLE - CHICAGO MERCANTILE EXCHANGE",
    "feedercattle": "FEEDER CATTLE - CHICAGO MERCANTILE EXCHANGE",
    "leanhogs": "LEAN HOGS - CHICAGO MERCANTILE EXCHANGE",
    "milk": "MILK, Class III - CHICAGO MERCANTILE EXCHANGE",
}


def _fixture_csv(headers, dates, socrata=False):
    import csv as _csv
    buf = io.StringIO()
    w = _csv.writer(buf)
    w.writerow(headers)
    for i, (key, name) in enumerate(sorted(MARKET_NAMES.items())):
        for j, d in enumerate(dates):
            row = []
            for h in headers:
                nh = _norm(h)
                if nh == "market_and_exchange_names":
                    row.append(name)
                elif nh in ("report_date_as_yyyy_mm_dd",):
                    row.append(d.isoformat() + ("T00:00:00.000" if socrata else ""))
                elif nh == "as_of_date_in_form_yymmdd":
                    row.append(d.strftime("%y%m%d"))
                elif nh == "open_interest_all":
                    row.append(100000 + i * 1000)
                elif nh.startswith("traders"):
                    row.append(50 + i)
                else:
                    row.append(1000 + i * 10 + j)
            w.writerow(row)
    return buf.getvalue()


def selftest():
    fails = []

    def ck(name, got, want):
        ok = got == want
        print(f"{'PASS' if ok else 'FAIL'}  {name:58s} {got!r}" + ("" if ok else f"  -- want {want!r}"))
        if not ok:
            fails.append(name)

    def ckt(name, cond, why=""):
        print(f"{'PASS' if cond else 'FAIL'}  {name:58s}{'' if cond else '  -- ' + why}")
        if not cond:
            fails.append(name)

    # ── column matching, both spellings ─────────────────────────────────────
    for label, hdrs in (("Socrata", SOCRATA_HEADERS), ("archive zip", ARCHIVE_HEADERS)):
        try:
            cm = build_colmap(hdrs)
            missing = [f for f in FIELDS if f not in cm]
            ckt(f"{label}: every field matched a real column", not missing, f"unmatched {missing}")
            ckt(f"{label}: found a date column", bool(cm.get("_date")))
            ckt(f"{label}: found a market-name column", bool(cm.get("_name")))
        except SystemExit as e:
            ckt(f"{label}: build_colmap accepted the real headers", False, str(e)[:140])

    # The double underscore in "Swap__Positions_Short_All" is a CFTC typo they
    # have never fixed. Normalising it away is the whole point.
    ckt("the Swap__ typo normalises", _norm("Swap__Positions_Short_All") == "swap_positions_short_all")
    ckt("a renamed column is a hard failure, not a zero",
        _is_systemexit(lambda: build_colmap([h for h in ARCHIVE_HEADERS
                                             if h != "M_Money_Positions_Long_All"])))
    # Trader counts are optional: the earliest archive years do not carry them.
    ckt("missing trader counts are tolerated",
        not _is_systemexit(lambda: build_colmap([h for h in ARCHIVE_HEADERS
                                                 if not h.startswith("Traders")])))

    # ── market matching, real CFTC strings ──────────────────────────────────
    for key, name in MARKET_NAMES.items():
        ck(f"matches '{name[:34]}'", match_commodity(name), key)
    ckt("mini contracts are excluded", match_commodity("MINI-SIZED CORN - CHICAGO BOARD OF TRADE") is None)
    ckt("an unrelated market is ignored", match_commodity("GOLD - COMMODITY EXCHANGE INC.") is None)

    # ── parsing both fixtures ───────────────────────────────────────────────
    d1, d2 = date(2026, 8, 25), date(2026, 9, 1)
    for label, hdrs, soc in (("archive", ARCHIVE_HEADERS, False), ("socrata", SOCRATA_HEADERS, True)):
        rows = parse_rows(_fixture_csv(hdrs, [d1, d2], socrata=soc))
        ck(f"{label}: parsed 11 markets x 2 weeks", len(rows), 22)
        ckt(f"{label}: dates parsed", {r["date"] for r in rows} == {d1, d2})
        ckt(f"{label}: no field read as zero", all(r["oi"] and r["mm_long"] for r in rows))

    # ── assembly, spacing and the gap detector ─────────────────────────────
    recs = parse_rows(_fixture_csv(ARCHIVE_HEADERS, [d1, d2]))
    blocks = assemble(recs, {k: {} for k in COMMODITIES})
    ck("assemble kept every market", len(blocks), 11)
    ckt("no gaps reported for weekly dates", all(not b["gaps"] for b in blocks.values()))
    ckt("no price means None, never zero",
        all(v is None for v in blocks["corn"]["px_entry"]))
    holed = parse_rows(_fixture_csv(ARCHIVE_HEADERS, [d1, d1 + timedelta(days=21)]))
    ckt("a three-week gap IS reported",
        assemble(holed, {k: {} for k in COMMODITIES})["corn"]["gaps"][0]["days"] == 21)

    # ── the whole --append path, offline ───────────────────────────────────
    import tempfile, shutil
    global DEEP_PATH
    tmp = tempfile.mkdtemp()
    keep_path, keep_fetch = DEEP_PATH, globals()["fetch_socrata"]
    try:
        DEEP_PATH = os.path.join(tmp, "cot-deep.json")
        write_deep(assemble(parse_rows(_fixture_csv(ARCHIVE_HEADERS, [d1])),
                            {k: {} for k in COMMODITIES}), "fixture")
        before = load_deep()
        ck("fixture file has one week", len(before["commodities"]["corn"]["dates"]), 1)
        globals()["fetch_socrata"] = lambda: parse_rows(_fixture_csv(SOCRATA_HEADERS, [d2], socrata=True))
        globals()["load_price_frames"] = lambda start: {k: {} for k in COMMODITIES}
        cmd_append(argparse.Namespace())
        after = load_deep()
        ck("append added the new week", len(after["commodities"]["corn"]["dates"]), 2)
        ck("and it is the right week", after["commodities"]["corn"]["dates"][-1], d2.isoformat())
        ckt("every column grew with it",
            all(len(after["commodities"]["corn"][f]) == 2 for f in FIELDS))
        ckt("px_entry was appended as null, not guessed",
            after["commodities"]["corn"]["px_entry"][-1] is None)
        # Running it twice must not duplicate the week.
        cmd_append(argparse.Namespace())
        ck("a second append is a no-op", len(load_deep()["commodities"]["corn"]["dates"]), 2)
    finally:
        DEEP_PATH = keep_path
        globals()["fetch_socrata"] = keep_fetch
        shutil.rmtree(tmp, ignore_errors=True)

    print()
    if fails:
        print(f"{len(fails)} check(s) failed: " + ", ".join(fails))
        return 1
    print("All checks passed.")
    return 0


def _is_systemexit(fn):
    try:
        fn()
        return False
    except SystemExit:
        return True


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--rebuild", action="store_true")
    p.add_argument("--append", action="store_true")
    p.add_argument("--verify", action="store_true")
    p.add_argument("--since", type=int, default=FIRST_YEAR)
    p.add_argument("--selftest", action="store_true")
    a = p.parse_args()
    if a.selftest:
        return selftest()
    if a.rebuild:
        return cmd_rebuild(a) or 0
    if a.append:
        return cmd_append(a) or 0
    if a.verify:
        return cmd_verify(a)
    p.print_help()
    return 2


if __name__ == "__main__":
    sys.exit(main())
