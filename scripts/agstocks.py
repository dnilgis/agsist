#!/usr/bin/env python3
"""agstocks.py -- ag stock closes, SEC filings and the AGSIST Ag 20, for /ag-stocks.

Approved by Sig Oct 29, 2026 (STANDING-DECISIONS: "use it until told no"). Run by
.github/workflows/agstocks.yml after the U.S. close on weekdays.

  python3 scripts/agstocks.py universe   # check every candidate against SEC's ticker list
  python3 scripts/agstocks.py prices     # Yahoo daily closes into data/agstocks/closes/<year>.json
  python3 scripts/agstocks.py sec        # latest filings + whole-company revenue / net income
  python3 scripts/agstocks.py index      # rebuild the Ag 20 and side baskets from stored closes
  python3 scripts/agstocks.py all        # the four in order, each failing soft
  python3 scripts/agstocks.py --selftest # offline: universe check, filing picks, facts, closes

WHAT IT WRITES (data/agstocks/)
  universe.json   members (ticker, company, group, SEC CIK and exchange, status), the dropped
                  rows and why, the index member lists
  closes/<y>.json {"rows": {date: {ticker: [close, volume]}}}: the stored source rows every
                  price, change and index level on the page is computed from
  splits.json     {ticker: {date: ratio}} from Yahoo's split events
  latest.json     per ticker: close, previous close, both dates, day change, 52-week closing
                  range, from the stored rows (not from a live quote)
  sec.json        per ticker: latest periodic report, latest earnings release (8-K item 2.02),
                  usual reporting months, quarter revenue and net income (whole company)
  index.json      the Ag 20 and the two side baskets (agstocks_index.build), plus revisions

SOURCES
  Closes: Yahoo Finance through yfinance, the same client and pinned version as
  fetch_prices.py (prices.yml), daily bars with auto_adjust off as fetch_prices reads them. Delayed, not an exchange feed; the page says so with the read time.
  Filings: data.sec.gov submissions and companyfacts, with a User-Agent naming the site,
  under 10 requests a second, companyfacts read again only when a new report is filed.
  Ticker check: www.sec.gov/files/company_tickers_exchange.json.
"""
import json
import math
import os
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
DIR = os.path.join(ROOT, "data", "agstocks")
UA = "AGSIST ag stocks (+https://agsist.com; sig@agsist.com)"
SEC_TICKERS = "https://www.sec.gov/files/company_tickers_exchange.json"
SEC_SUBS = "https://data.sec.gov/submissions/CIK{cik}.json"
SEC_FACTS = "https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json"
SEC_GAP_S = 0.15          # under 10 requests a second
US_EXCHANGES = {"NYSE", "Nasdaq", "NYSE American", "NYSE MKT", "NYSE Arca", "CBOE"}

GROUPS = ["Equipment", "Crop inputs", "Grain and processing", "Livestock and animal health",
          "Food and produce", "Farmland and lenders", "Farm retail"]

# The candidates, from the research list (feedbag notes/chatgpt/2026-10-29-answers/agstocks/
# universe.csv, 73 rows). Leads, not facts: each is checked against SEC's ticker list every run.
# (ticker, company, group, CIK from the research note or None)
SEED = [
    ("DE", "Deere & Company", "Equipment", "0000315189"),
    ("CNH", "CNH Industrial", "Equipment", None),
    ("AGCO", "AGCO", "Equipment", "0000880266"),
    ("LNN", "Lindsay", "Equipment", None),
    ("VMI", "Valmont Industries", "Equipment", None),
    ("TITN", "Titan Machinery", "Equipment", "0001409171"),
    ("TTC", "Toro", "Equipment", None),
    ("ALG", "Alamo Group", "Equipment", None),
    ("TWI", "Titan International", "Equipment", None),
    ("ASTE", "Astec Industries", "Equipment", None),
    ("TRMB", "Trimble", "Equipment", None),
    ("UAVS", "AgEagle Aerial Systems", "Equipment", "0000008504"),
    ("PFAI", "Pinnacle Food Group", "Equipment", "0002032755"),
    ("NTR", "Nutrien", "Crop inputs", None),
    ("CF", "CF Industries", "Crop inputs", None),
    ("MOS", "Mosaic", "Crop inputs", None),
    ("CTVA", "Corteva", "Crop inputs", "0001755672"),
    ("VYLR", "Vylor", "Crop inputs", "0002128626"),
    ("FMC", "FMC", "Crop inputs", None),
    ("ICL", "ICL Group", "Crop inputs", None),
    ("IPI", "Intrepid Potash", "Crop inputs", None),
    ("AVD", "American Vanguard", "Crop inputs", "0000005981"),
    ("BIOX", "Bioceres Crop Solutions", "Crop inputs", "0001769484"),
    ("UAN", "CVR Partners", "Crop inputs", None),
    ("SMG", "Scotts Miracle-Gro", "Crop inputs", None),
    ("SQM", "SQM", "Crop inputs", None),
    ("FSI", "Flexible Solutions International", "Crop inputs", None),
    ("SEED", "Origin Agritech", "Crop inputs", "0001321851"),
    ("ADM", "Archer-Daniels-Midland", "Grain and processing", "0000007084"),
    ("BG", "Bunge Global", "Grain and processing", None),
    ("ANDE", "The Andersons", "Grain and processing", "0000821026"),
    ("INGR", "Ingredion", "Grain and processing", None),
    ("DAR", "Darling Ingredients", "Grain and processing", None),
    ("GPRE", "Green Plains", "Grain and processing", None),
    ("REX", "REX American Resources", "Grain and processing", None),
    ("ALTO", "Alto Ingredients", "Grain and processing", None),
    ("AMTX", "Aemetis", "Grain and processing", None),
    ("CLMT", "Calumet", "Grain and processing", None),
    ("JBSS", "John B. Sanfilippo & Son", "Grain and processing", "0000880117"),
    ("TSN", "Tyson Foods", "Livestock and animal health", None),
    ("HRL", "Hormel Foods", "Livestock and animal health", None),
    ("PPC", "Pilgrim's Pride", "Livestock and animal health", None),
    ("CALM", "Cal-Maine Foods", "Livestock and animal health", "0000016160"),
    ("VITL", "Vital Farms", "Livestock and animal health", None),
    ("JBS", "JBS", "Livestock and animal health", None),
    ("SFD", "Smithfield Foods", "Livestock and animal health", "0000091388"),
    ("ZTS", "Zoetis", "Livestock and animal health", None),
    ("ELAN", "Elanco Animal Health", "Livestock and animal health", None),
    ("PAHC", "Phibro Animal Health", "Livestock and animal health", None),
    ("NEOG", "Neogen", "Livestock and animal health", None),
    ("IDXX", "IDEXX Laboratories", "Livestock and animal health", None),
    ("LWAY", "Lifeway Foods", "Livestock and animal health", "0000814586"),
    ("DOLE", "Dole", "Food and produce", "0001857475"),
    ("FDP", "Fresh Del Monte Produce", "Food and produce", None),
    ("AVO", "Mission Produce", "Food and produce", "0001802974"),
    ("LMNR", "Limoneira", "Food and produce", None),
    ("ALCO", "Alico", "Food and produce", None),
    ("VFF", "Village Farms International", "Food and produce", None),
    ("SENEA", "Seneca Foods", "Food and produce", "0000088948"),
    ("EDBL", "Edible Garden", "Food and produce", "0001809750"),
    ("AGRZ", "Agroz", "Food and produce", "0002009233"),
    ("AGRO", "Adecoagro", "Farmland and lenders", "0001499505"),
    ("LND", "BrasilAgro", "Farmland and lenders", None),
    ("CRESY", "Cresud", "Farmland and lenders", "0001034957"),
    ("LAND", "Gladstone Land", "Farmland and lenders", "0001495240"),
    ("FPI", "Farmland Partners", "Farmland and lenders", None),
    ("AGM", "Farmer Mac", "Farmland and lenders", None),
    ("AFG", "American Financial Group", "Farmland and lenders", None),
    ("TSCO", "Tractor Supply", "Farm retail", None),
]
# Rows the research note itself marks historical or unresolved: never quoted.
SEED_DROPPED = [
    ("PEIX", "Pacific Ethanol", "historical ticker, renamed Alto Ingredients (ALTO)"),
    ("CVGW", "Calavo Growers", "historical: acquired by Mission Produce (AVO), May 2026"),
    ("LOCL", "Local Bounti", "current listing not verified"),
    ("ORIS", "Oriental Rise Holdings", "Nasdaq listing not verified"),
]
# Design A (equal weight 20) and design C (two side baskets), from index_designs.md.
INDEXES = [
    {"key": "ag20", "name": "AGSIST Ag 20", "min_members": 13,
     "tickers": ["DE", "CNH", "AGCO", "TITN", "LNN", "NTR", "CF", "MOS", "CTVA", "FMC",
                 "ADM", "BG", "ANDE", "GPRE", "INGR", "TSN", "HRL", "PPC", "ZTS", "ELAN"]},
    {"key": "input", "name": "Input suppliers", "min_members": 5,
     "tickers": ["DE", "AGCO", "CNH", "NTR", "CF", "MOS", "FMC", "CTVA"]},
    {"key": "demand", "name": "Demand chain", "min_members": 5,
     "tickers": ["ADM", "BG", "ANDE", "GPRE", "TSN", "PPC", "CALM", "VITL"]},
]


def now_utc():
    return datetime.now(timezone.utc)


def iso(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def rd(name, default=None):
    try:
        with open(os.path.join(DIR, name), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def wr(name, obj, compact=False):
    p = os.path.join(DIR, name)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    tmp = p + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        if compact:
            json.dump(obj, f, separators=(",", ":"), sort_keys=True)
        else:
            json.dump(obj, f, indent=1, sort_keys=True)
        f.write("\n")
    os.replace(tmp, p)


_last_sec = [0.0]


def get_json(url, timeout=60):
    """One SEC read: descriptive User-Agent, never faster than SEC_GAP_S apart."""
    if "sec.gov" in url:
        wait = SEC_GAP_S - (time.time() - _last_sec[0])
        if wait > 0:
            time.sleep(wait)
        _last_sec[0] = time.time()
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        body = r.read()
    try:
        return json.loads(body)
    except ValueError:
        line = body[:120].decode("utf-8", "replace").splitlines()[0] if body else ""
        raise ValueError(f"not JSON from {url.split('?')[0]}: {line}")


def _num(v):
    """None for None / NaN / inf / non-numbers (fetch_prices._num, without importing yfinance
    so the selftest runs where yfinance is not installed)."""
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(f) or math.isinf(f) else f


# ── 1. universe ──────────────────────────────────────────────────────────────
def check_universe(sec_rows, checked):
    """sec_rows: SEC company_tickers_exchange.json. -> universe dict (pure)."""
    fields = sec_rows.get("fields") or ["cik", "name", "ticker", "exchange"]
    by_t = {}
    for row in sec_rows.get("data") or []:
        r = dict(zip(fields, row))
        t = str(r.get("ticker") or "").upper()
        if t and t not in by_t:
            by_t[t] = r
    members, dropped, notes = [], [], []
    for t, company, group, cik_note in SEED:
        r = by_t.get(t)
        if not r:
            dropped.append({"t": t, "company": company, "why": "ticker not in SEC's company ticker list"})
            continue
        exch = str(r.get("exchange") or "")
        if exch not in US_EXCHANGES:
            dropped.append({"t": t, "company": company, "why": f"SEC lists it on {exch or 'no exchange'}, not a U.S. exchange"})
            continue
        cik = f"{int(r['cik']):010d}"
        if cik_note and cik_note != cik:
            notes.append(f"{t}: research note CIK {cik_note}, SEC says {cik}; SEC's used")
        members.append({"t": t, "company": company, "group": group, "cik": cik, "exchange": exch,
                        "sec_name": r.get("name"), "status": "listed"})
    for t, company, why in SEED_DROPPED:
        dropped.append({"t": t, "company": company, "why": why})
    listed = {m["t"] for m in members}
    idx = [dict(spec, tickers=[t for t in spec["tickers"] if t in listed],
                left_out=[t for t in spec["tickers"] if t not in listed]) for spec in INDEXES]
    return {"v": 1, "checked": checked, "source": SEC_TICKERS, "groups": GROUPS,
            "members": members, "dropped": dropped, "notes": notes, "indexes": idx}


def cmd_universe():
    try:
        sec = get_json(SEC_TICKERS)
    except Exception as e:  # fail soft: keep the last checked universe
        print(f"universe: SEC ticker list not answering ({type(e).__name__}: {str(e)[:120]}); kept the last one")
        return 1
    u = check_universe(sec, iso(now_utc()))
    if len(u["members"]) < 40:
        print(f"universe: only {len(u['members'])} listed, refusing to replace the last list")
        return 1
    wr("universe.json", u)
    print(f"universe: {len(u['members'])} listed, {len(u['dropped'])} dropped")
    for d in u["dropped"]:
        print(f"  dropped {d['t']}: {d['why']}")
    for n in u["notes"]:
        print(f"  note {n}")
    return 0


# ── 2. prices ────────────────────────────────────────────────────────────────
def load_closes():
    """{date: {ticker: [close, volume]}} over every year file."""
    rows = {}
    cdir = os.path.join(DIR, "closes")
    if os.path.isdir(cdir):
        for f in sorted(os.listdir(cdir)):
            if f.endswith(".json"):
                d = rd(os.path.join("closes", f), {}) or {}
                rows.update(d.get("rows") or {})
    return rows


def save_closes(rows, fetched):
    by_year = {}
    for d, v in rows.items():
        by_year.setdefault(d[:4], {})[d] = v
    for y, r in by_year.items():
        wr(os.path.join("closes", f"{y}.json"),
           {"v": 1, "source": "Yahoo Finance, delayed", "fetched": fetched, "rows": r}, compact=True)


def merge_bars(rows, splits, t, bars, split_events, today_et, et_hm):
    """Fold one ticker's daily bars into the stored rows (pure; selftested).
    bars: [(date, close, volume)]. split_events: [(date, ratio)].
    A bar dated today (New York) before 4:15 p.m. is an intraday trade, not a close: skipped.
    A stored close dated before a split Yahoo now reports is kept as stored (Yahoo restates
    old bars for splits; the index applies the split to its shares instead)."""
    last_split = None
    for d, r in split_events:
        if r and r > 0 and r != 1:
            splits.setdefault(t, {})[d] = float(r)
            last_split = max(last_split or d, d)
    n = 0
    for d, c, v in bars:
        c = _num(c)
        if c is None or c <= 0:
            continue
        if d == today_et and et_hm < 1615:
            continue
        have = rows.get(d, {}).get(t)
        if have and last_split and d < last_split:
            continue
        vol = _num(v)
        rows.setdefault(d, {})[t] = [round(c, 4), int(vol) if vol is not None else None]
        n += 1
    return n


def cmd_prices():
    import yfinance as yf
    from zoneinfo import ZoneInfo
    u = rd("universe.json")
    if not u:
        print("prices: no universe.json yet")
        return 1
    rows = load_closes()
    splits = rd("splits.json", {}) or {}
    now = now_utc()
    et = now.astimezone(ZoneInfo("America/New_York"))
    today_et, et_hm = et.strftime("%Y-%m-%d"), et.hour * 100 + et.minute
    ok, bad = 0, []
    for m in u["members"]:
        t = m["t"]
        have = sum(1 for d in rows if t in rows[d])
        period = "1y" if have < 200 else "1mo"
        try:
            hist = yf.Ticker(t).history(period=period, interval="1d", auto_adjust=False, actions=True)
            if hist is None or len(hist) == 0:
                bad.append(t)
                continue
            bars = [(idx.strftime("%Y-%m-%d"), r.get("Close"), r.get("Volume")) for idx, r in hist.iterrows()]
            sp = []
            if "Stock Splits" in hist:
                sp = [(idx.strftime("%Y-%m-%d"), float(v)) for idx, v in hist["Stock Splits"].items() if v and float(v) > 0]
            if merge_bars(rows, splits, t, bars, sp, today_et, et_hm):
                ok += 1
            else:
                bad.append(t)
        except Exception as e:
            print(f"  ERR {t}: {type(e).__name__}: {str(e)[:120]}")
            bad.append(t)
    fetched = iso(now)
    save_closes(rows, fetched)
    wr("splits.json", splits)
    latest = build_latest(rows, [m["t"] for m in u["members"]], fetched)
    wr("latest.json", latest)
    print(f"prices: {ok} tickers read, {len(bad)} without bars{(': ' + ' '.join(bad)) if bad else ''}")
    return 0 if ok else 1


def build_latest(rows, tickers, fetched):
    """Per ticker, from the stored rows only: close, previous close, change, 52-week closing range."""
    dates = sorted(rows)
    out = {"v": 1, "fetched": fetched, "source": "Yahoo Finance, delayed", "q": {}}
    for t in tickers:
        hist = [(d, rows[d][t][0]) for d in dates if t in rows[d] and rows[d][t] and rows[d][t][0]]
        if not hist:
            continue
        d1, c1 = hist[-1]
        q = {"close": c1, "d": d1}
        if len(hist) > 1:
            d0, c0 = hist[-2]
            q.update(prev=c0, prev_d=d0, pct=round((c1 / c0 - 1) * 100, 2))
        yr = (datetime.fromisoformat(d1) - timedelta(days=365)).strftime("%Y-%m-%d")
        win = [c for d, c in hist if d > yr]
        first = next(d for d, c in hist)
        # A full year on file (a week of slack for Yahoo's 1y window starting on a holiday or
        # weekend), or the range is not shown.
        if first <= (datetime.fromisoformat(d1) - timedelta(days=358)).strftime("%Y-%m-%d"):
            q.update(hi52=max(win), lo52=min(win))
        out["q"][t] = q
    newest = max((q["d"] for q in out["q"].values()), default=None)
    out["d"] = newest
    return out


# ── 3. SEC filings ───────────────────────────────────────────────────────────
PERIODIC = ("10-Q", "10-K", "20-F", "40-F", "10-K/A", "10-Q/A", "20-F/A")
REV = [("us-gaap", "Revenues"), ("us-gaap", "RevenueFromContractWithCustomerExcludingAssessedTax"),
       ("us-gaap", "SalesRevenueNet"), ("us-gaap", "RevenueFromContractWithCustomerIncludingAssessedTax"),
       ("us-gaap", "SalesRevenueGoodsNet"), ("ifrs-full", "Revenue")]
NI = [("us-gaap", "NetIncomeLoss"), ("us-gaap", "ProfitLoss"), ("ifrs-full", "ProfitLossAttributableToOwnersOfParent"),
      ("ifrs-full", "ProfitLoss")]


def doc_url(cik, accn, doc):
    return f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{accn.replace('-', '')}/{doc}"


def pick_filings(subs, cik, today):
    """From a submissions JSON: latest periodic report, latest 6-K, latest earnings release
    (8-K item 2.02) and the months 2.02 releases usually come in (pure; selftested)."""
    rec = ((subs or {}).get("filings") or {}).get("recent") or {}
    forms = rec.get("form") or []
    rows = []
    for i, f in enumerate(forms):
        def g(k):
            v = rec.get(k) or []
            return v[i] if i < len(v) else ""
        rows.append({"form": f, "filed": g("filingDate"), "accn": g("accessionNumber"), "doc": g("primaryDocument"),
                     "items": g("items"), "period": g("reportDate"), "accepted": g("acceptanceDateTime")})
    rows.sort(key=lambda r: (r["filed"], r["accepted"]), reverse=True)

    def slim(r):
        o = {"form": r["form"], "filed": r["filed"], "url": doc_url(cik, r["accn"], r["doc"]) if r["doc"] else
             f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{r['accn'].replace('-', '')}/", "accn": r["accn"]}
        if r["period"]:
            o["period"] = r["period"]
        return o
    out = {}
    per = next((r for r in rows if r["form"] in PERIODIC), None)
    if per:
        out["periodic"] = slim(per)
    six = next((r for r in rows if r["form"] == "6-K"), None)
    if six:
        out["sixk"] = slim(six)
    earn = [r for r in rows if r["form"] in ("8-K", "8-K/A") and "2.02" in str(r["items"]).split(",")]
    if earn:
        out["earnings"] = slim(earn[0])
    cutoff = (datetime.fromisoformat(today) - timedelta(days=3 * 365)).strftime("%Y-%m-%d")
    recent = [r for r in earn if r["filed"] >= cutoff and r["form"] == "8-K"]
    years_by_month = {}
    for r in recent:
        years_by_month.setdefault(int(r["filed"][5:7]), set()).add(r["filed"][:4])
    months = sorted(m for m, ys in years_by_month.items() if len(ys) >= 2)
    if len(recent) >= 4 and months:
        out["usual_months"] = months
        out["usual_from"] = [min(r["filed"] for r in recent), max(r["filed"] for r in recent)]
    return out


def _days(a, b):
    return (datetime.fromisoformat(b) - datetime.fromisoformat(a)).days


def quarter_pair(facts, concepts):
    """Latest three-month value in USD and the same quarter a year before, one concept for both.
    Each value from the latest filing that reported that exact period (pure; selftested)."""
    best = None
    for rank, (tax, name) in enumerate(concepts):
        units = (((facts or {}).get("facts") or {}).get(tax) or {}).get(name, {}).get("units") or {}
        vals = [v for v in units.get("USD") or [] if v.get("start") and v.get("end") and 80 <= _days(v["start"], v["end"]) <= 100]
        if not vals:
            continue
        by_period = {}
        for v in vals:
            k = (v["start"], v["end"])
            if k not in by_period or (v.get("filed") or "") > (by_period[k].get("filed") or ""):
                by_period[k] = v
        cur = max(by_period.values(), key=lambda v: v["end"])
        prior = [v for v in by_period.values() if abs(_days(v["end"], cur["end"]) - 365) <= 12]
        prior = max(prior, key=lambda v: v.get("filed") or "") if prior else None
        key = (cur["end"], -rank)
        if best is None or key > best[0]:
            best = (key, name, cur, prior)
    if not best:
        return None

    def slim(v):
        return {"start": v["start"], "end": v["end"], "val": v["val"], "accn": v.get("accn"),
                "filed": v.get("filed"), "form": v.get("form")} if v else None
    return {"concept": best[1], "cur": slim(best[2]), "prior": slim(best[3])}


def cmd_sec():
    u = rd("universe.json")
    if not u:
        print("sec: no universe.json yet")
        return 1
    old = rd("sec.json", {}) or {}
    oldc = old.get("c") or {}
    today = now_utc().strftime("%Y-%m-%d")
    out = {"v": 1, "checked": iso(now_utc()), "source": "SEC EDGAR (data.sec.gov)", "c": {}}
    fails = []
    for m in u["members"]:
        t, cik = m["t"], m["cik"]
        prev = oldc.get(t) or {}
        try:
            subs = get_json(SEC_SUBS.format(cik=cik))
            fl = pick_filings(subs, cik, today)
        except Exception as e:
            fails.append(f"{t} submissions ({type(e).__name__})")
            if prev:
                out["c"][t] = dict(prev, stale_since=prev.get("stale_since") or prev.get("read"))
            continue
        rec = {"cik": cik, "read": today, **fl}
        new_report = (fl.get("periodic") or {}).get("accn") != ((prev.get("periodic") or {}).get("accn"))
        if new_report or "rev" not in prev and "ni" not in prev and not prev.get("facts_read"):
            try:
                facts = get_json(SEC_FACTS.format(cik=cik), timeout=120)
                rec["rev"] = quarter_pair(facts, REV)
                rec["ni"] = quarter_pair(facts, NI)
                rec["facts_read"] = today
            except Exception as e:
                fails.append(f"{t} companyfacts ({type(e).__name__})")
                for k in ("rev", "ni", "facts_read"):
                    if k in prev:
                        rec[k] = prev[k]
        else:
            for k in ("rev", "ni", "facts_read"):
                if k in prev:
                    rec[k] = prev[k]
        out["c"][t] = rec
    if not out["c"]:
        print("sec: nothing read, kept the last file")
        return 1
    wr("sec.json", out)
    print(f"sec: {len(out['c'])} companies, {len(fails)} reads failed{(': ' + '; '.join(fails[:12])) if fails else ''}")
    return 0


# ── 4. index ─────────────────────────────────────────────────────────────────
def sessions_of(rows, tickers):
    """Dates on which at least half the universe has a close (a lone stray bar is not a session)."""
    need = max(1, len(tickers) // 2)
    return sorted(d for d, v in rows.items() if sum(1 for t in tickers if t in v) >= need)


def cmd_index():
    from agstocks_index import build
    u = rd("universe.json")
    if not u:
        print("index: no universe.json yet")
        return 1
    rows = load_closes()
    tickers = [m["t"] for m in u["members"]]
    sessions = sessions_of(rows, tickers)
    closes, vols = {}, {}
    for d, v in rows.items():
        for t, cv in v.items():
            if cv and cv[0]:
                closes.setdefault(t, {})[d] = cv[0]
                if cv[1] is not None:
                    vols.setdefault(t, {})[d] = cv[1]
    splits = rd("splits.json", {}) or {}
    old = rd("index.json", {}) or {}
    removals = {r["t"]: r["d"] for r in (u.get("removals") or [])}
    out = {"v": 1, "built": iso(now_utc()), "source": "Yahoo Finance closes, delayed", "ix": {},
           "revisions": old.get("revisions") or []}
    for spec in u["indexes"]:
        r = build(spec, sessions, closes, vols, splits=splits, removals=removals)
        r["left_out"] = spec.get("left_out") or []
        before = {x["d"]: x["v"] for x in ((old.get("ix") or {}).get(spec["key"]) or {}).get("levels") or []}
        for x in r["levels"]:
            if x["d"] in before and abs(before[x["d"]] - x["v"]) >= 0.005:
                out["revisions"].append({"ix": spec["key"], "d": x["d"], "was": before[x["d"]], "now": x["v"],
                                         "at": out["built"]})
                x["revised"] = True
        out["ix"][spec["key"]] = r
        last = r["levels"][-1] if r["levels"] else None
        print(f"index {spec['key']}: {r['status']}" + (f", {last['d']} {last['v']}" if last else ""))
    out["revisions"] = out["revisions"][-50:]
    wr("index.json", out)
    return 0


# ── selftest ─────────────────────────────────────────────────────────────────
def selftest():
    fails = []

    def check(c, msg):
        if not c:
            fails.append(msg)

    sec = {"fields": ["cik", "name", "ticker", "exchange"],
           "data": [[315189, "DEERE & CO", "DE", "NYSE"], [880266, "AGCO CORP", "AGCO", "NYSE"],
                    [123, "SOME OTC", "VFF", "OTC"], [7084, "ARCHER-DANIELS-MIDLAND CO", "ADM", "NYSE"],
                    [999, "WRONG CIK CO", "TITN", "Nasdaq"]]}
    u = check_universe(sec, "2026-10-29T22:00:00Z")
    ts = [m["t"] for m in u["members"]]
    check(ts == ["DE", "AGCO", "TITN", "ADM"], f"listed members {ts}")
    dr = {d["t"]: d["why"] for d in u["dropped"]}
    check("not in SEC" in dr.get("CNH", ""), "missing ticker dropped")
    check("OTC" in dr.get("VFF", ""), "OTC dropped")
    check("historical" in dr.get("CVGW", "") and "not verified" in dr.get("LOCL", ""), "research-note drops kept")
    check(any("TITN" in n and "0000000999" in n for n in u["notes"]), "CIK mismatch noted, SEC used")
    ag20 = next(i for i in u["indexes"] if i["key"] == "ag20")
    check(ag20["tickers"] == ["DE", "AGCO", "TITN", "ADM"] and "CNH" in ag20["left_out"], "index lists follow the check")

    rows, splits = {}, {}
    merge_bars(rows, splits, "DE", [("2026-10-27", 400.0, 1e6), ("2026-10-28", 402.5, 2e6), ("2026-10-29", 405.0, 5e5)],
               [], "2026-10-29", 1500)
    check(sorted(rows) == ["2026-10-27", "2026-10-28"], "intraday bar for today skipped before 4:15 p.m.")
    merge_bars(rows, splits, "DE", [("2026-10-27", 200.0, 1e6), ("2026-10-28", 201.25, 2e6), ("2026-10-29", 203.0, 1e6)],
               [("2026-10-28", 2.0)], "2026-10-29", 1700)
    check(rows["2026-10-27"]["DE"][0] == 400.0, "stored close before a split kept as stored")
    check(rows["2026-10-28"]["DE"][0] == 201.25 and splits["DE"]["2026-10-28"] == 2.0, "split recorded, split-day close taken")
    lt = build_latest(rows, ["DE"], "x")
    check(lt["q"]["DE"]["close"] == 203.0 and lt["q"]["DE"]["prev"] == 201.25 and "hi52" not in lt["q"]["DE"],
          "latest from stored rows; no 52-week range without a year on file")

    subs = {"filings": {"recent": {
        "form": ["8-K", "10-Q", "8-K", "8-K", "8-K", "8-K", "10-K", "6-K"],
        "filingDate": ["2026-08-14", "2026-08-27", "2026-05-15", "2025-08-14", "2025-05-15", "2024-08-15", "2025-12-15", "2026-01-01"],
        "accessionNumber": ["a1", "0001104659-26-102213", "a3", "a4", "a5", "a6", "a7", "a8"],
        "primaryDocument": ["e.htm", "de-20260802x10q.htm", "e.htm", "e.htm", "e.htm", "e.htm", "k.htm", "s.htm"],
        "items": ["2.02,9.01", "", "2.02", "2.02,9.01", "2.02", "2.02", "", ""],
        "reportDate": ["", "2026-08-02", "", "", "", "", "2025-11-02", ""],
        "acceptanceDateTime": [""] * 8}}}
    fl = pick_filings(subs, "0000315189", "2026-10-29")
    check(fl["periodic"]["form"] == "10-Q" and fl["periodic"]["url"].endswith("/315189/000110465926102213/de-20260802x10q.htm"),
          "latest periodic report and its link")
    check(fl["earnings"]["filed"] == "2026-08-14", "latest 2.02 release")
    check(fl["usual_months"] == [5, 8], f"usual months from 2+ years: {fl.get('usual_months')}")

    facts = {"facts": {"us-gaap": {
        "Revenues": {"units": {"USD": [
            {"start": "2026-05-04", "end": "2026-08-02", "val": 100, "accn": "q", "filed": "2026-08-27", "form": "10-Q"},
            {"start": "2025-05-05", "end": "2025-08-03", "val": 90, "accn": "old", "filed": "2025-08-28", "form": "10-Q"},
            {"start": "2025-05-05", "end": "2025-08-03", "val": 91, "accn": "q", "filed": "2026-08-27", "form": "10-Q"},
            {"start": "2025-11-03", "end": "2026-08-02", "val": 280, "accn": "q", "filed": "2026-08-27", "form": "10-Q"}]}},
        "SalesRevenueNet": {"units": {"USD": [
            {"start": "2019-01-01", "end": "2019-03-31", "val": 5, "accn": "z", "filed": "2019-05-01", "form": "10-Q"}]}}}}}
    qp = quarter_pair(facts, REV)
    check(qp["concept"] == "Revenues" and qp["cur"]["val"] == 100 and qp["prior"]["val"] == 91,
          f"quarter pair, nine-month value ignored, year-ago as last filed: {qp}")
    check(quarter_pair({"facts": {}}, REV) is None, "no facts: None")

    if fails:
        for f in fails:
            print("FAIL", f)
        return 1
    print("agstocks selftest: ok (universe check, closes merge, splits, latest, filings, usual months, quarter facts)")
    return 0


def main(argv):
    if "--selftest" in argv:
        return selftest()
    cmd = argv[1] if len(argv) > 1 else ""
    steps = {"universe": cmd_universe, "prices": cmd_prices, "sec": cmd_sec, "index": cmd_index}
    if cmd in steps:
        return steps[cmd]()
    if cmd == "all":
        rc = 0
        for name in ("universe", "prices", "sec", "index"):
            try:
                rc |= steps[name]()
            except Exception as e:  # each step fails soft; the others still run
                print(f"{name}: {type(e).__name__}: {str(e)[:200]}")
                rc = 1
        return rc
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
