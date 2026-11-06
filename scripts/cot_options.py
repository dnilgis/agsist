#!/usr/bin/env python3
"""
cot_options.py: options positions and unusual readings for /cot.

Built only from CFTC Commitments of Traders data (public domain):
  Disaggregated Futures-and-Options Combined, Disaggregated Futures-Only,
  Legacy Futures-and-Options Combined (concentration ratios).

Each group's options position is its combined net minus its futures-only net.
CFTC states options in the combined report on a futures-equivalent (delta-
adjusted) basis, so these are futures-equivalent contracts, not option counts.

Writes data/cot-options.json. Every figure is computed here; the page only
renders it (components/cot-options.js).

Usage:
  python3 scripts/cot_options.py                 fetch from CFTC and write the file
  python3 scripts/cot_options.py --from DIR      build from saved CFTC rows (fo.json,
                                                 comb.json, legacy.json in DIR)
  python3 scripts/cot_options.py --out PATH      write somewhere else
  python3 scripts/cot_options.py --save DIR      also keep the fetched rows in DIR
  python3 scripts/cot_options.py --selftest      hand-worked checks, no network
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass

import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cot_calendar as CAL  # noqa: E402

OUT_FILE = "data/cot-options.json"
API = "https://publicreporting.cftc.gov/resource/{ds}.json"
DATASETS = {"fo": "72hh-3qpy", "comb": "kh3c-gbw2", "legacy": "jun7-fc8e"}

# CFTC contract market codes; stable through exchange renames (MGEX to MIAX kept 001626).
CODES = {
    "002602": "corn", "005602": "beans", "001602": "wheat", "001612": "kcwheat",
    "001626": "mplswheat", "026603": "soymeal", "007601": "soyoil",
    "057642": "livecattle", "061641": "feedercattle", "054642": "leanhogs", "052641": "milk",
}
ORDER = ["corn", "beans", "wheat", "kcwheat", "mplswheat", "soymeal", "soyoil",
         "livecattle", "feedercattle", "leanhogs", "milk"]

GROUPS = {  # key: (long field, short field)
    "mm":   ("m_money_positions_long_all", "m_money_positions_short_all"),
    "pm":   ("prod_merc_positions_long", "prod_merc_positions_short"),
    "swap": ("swap_positions_long_all", "swap__positions_short_all"),
    "or":   ("other_rept_positions_long", "other_rept_positions_short"),
}
GROUP_ORDER = ["mm", "pm", "swap", "or"]
CONC = {  # key: legacy field (percent of open interest)
    "g4l": "conc_gross_le_4_tdr_long", "g4s": "conc_gross_le_4_tdr_short",
    "g8l": "conc_gross_le_8_tdr_long", "g8s": "conc_gross_le_8_tdr_short",
    "n4l": "conc_net_le_4_tdr_long_all", "n4s": "conc_net_le_4_tdr_short_all",
    "n8l": "conc_net_le_8_tdr_long_all", "n8s": "conc_net_le_8_tdr_short_all",
}
CONC_SCANNED = ["g4l", "g4s", "g8l", "g8s"]

DISAGG_FIELDS = ["cftc_contract_market_code", "market_and_exchange_names",
                 "report_date_as_yyyy_mm_dd", "open_interest_all"] + \
                [f for g in GROUP_ORDER for f in GROUPS[g]]
LEGACY_FIELDS = ["cftc_contract_market_code", "market_and_exchange_names",
                 "report_date_as_yyyy_mm_dd", "open_interest_all"] + [CONC[k] for k in CONC]

WINDOW_DAYS = 3 * 365 + 1     # "last 3 years": reports dated within this many days, this week included
MIN_WEEKS = 130               # fewer weeks than this in the window: withhold the ranking
MIN_OPT_SHARE = 5.0           # options under this share of all open interest: positions not ranked
EDGE = 5                      # printed percentile at or under EDGE, or at or over 100 - EDGE
TYPICAL_WEEKS = 52            # how many earlier report weeks the "typical week" count looks at
FETCH_DAYS = WINDOW_DAYS + 7 * (TYPICAL_WEEKS + 6)
SOURCE = ("CFTC Commitments of Traders: Disaggregated Futures-and-Options Combined, "
          "Disaggregated Futures-Only, Legacy Futures-and-Options Combined")


# ── fetch ────────────────────────────────────────────────────────────────────
def fetch(ds, fields, since):
    codes = ",".join("'%s'" % c for c in CODES)
    rows, offset = [], 0
    while True:
        q = {"$select": ",".join(fields),
             "$where": "cftc_contract_market_code in(%s) AND report_date_as_yyyy_mm_dd>='%s'" % (codes, since),
             "$order": "report_date_as_yyyy_mm_dd,cftc_contract_market_code",
             "$limit": "50000", "$offset": str(offset)}
        url = API.format(ds=ds) + "?" + urllib.parse.urlencode(q)
        req = urllib.request.Request(url, headers={"User-Agent": "AGSIST/1.0 (+https://agsist.com/cot)"})
        with urllib.request.urlopen(req, timeout=60) as r:
            page = json.loads(r.read().decode())
        rows.extend(page)
        if len(page) < 50000:
            return rows
        offset += len(page)


# ── build ────────────────────────────────────────────────────────────────────
def _d(s):
    return date.fromisoformat(str(s)[:10])


def _index(rows, numeric_float=False):
    """{market: {date: row}} keyed by contract code; unknown codes are dropped."""
    out = {}
    for r in rows:
        k = CODES.get(str(r.get("cftc_contract_market_code", "")).strip())
        if not k:
            continue
        try:
            out.setdefault(k, {})[_d(r["report_date_as_yyyy_mm_dd"])] = r
        except (KeyError, ValueError):
            continue
    return out


def _int(r, f):
    v = r.get(f)
    if v in (None, ""):
        raise ValueError(f)
    return int(float(v))


def _float(r, f):
    v = r.get(f)
    if v in (None, ""):
        return None
    return float(v)


def series(fo_rows, comb_rows, legacy_rows):
    """Per market: dates where all three reports have a row, oldest first, with the
    options position of each group, options open interest and concentration."""
    fo, cb, lg = _index(fo_rows), _index(comb_rows), _index(legacy_rows)
    out = {}
    for k in ORDER:
        dates = sorted(set(fo.get(k, {})) & set(cb.get(k, {})) & set(lg.get(k, {})))
        s = {"dates": [], "oi_all": [], "oi_fut": [], "opt_oi": [],
             "net": {g: [] for g in GROUP_ORDER}, "conc": {c: [] for c in CONC}}
        for d in dates:
            f, c, l = fo[k][d], cb[k][d], lg[k][d]
            try:
                oi_all, oi_fut = _int(c, "open_interest_all"), _int(f, "open_interest_all")
                nets = {}
                for g in GROUP_ORDER:
                    lf, sf = GROUPS[g]
                    nets[g] = (_int(c, lf) - _int(c, sf)) - (_int(f, lf) - _int(f, sf))
            except ValueError:
                continue
            s["dates"].append(d)
            s["oi_all"].append(oi_all)
            s["oi_fut"].append(oi_fut)
            s["opt_oi"].append(oi_all - oi_fut)
            for g in GROUP_ORDER:
                s["net"][g].append(nets[g])
            for ck, fld in CONC.items():
                s["conc"][ck].append(_float(l, fld))
        if s["dates"]:
            out[k] = s
    return out


def rank(values, x):
    """Percentile of x among the OTHER values: the share below it, ties counted half.
    0 = lower than every other week, 100 = higher than every other week."""
    if not values:
        return None
    below = sum(1 for v in values if v < x)
    tie = sum(1 for v in values if v == x)
    return 100.0 * (below + 0.5 * tie) / len(values)


def shown(p):
    """The percentile as printed (whole number, halves up); flags read this, so the
    printed number and the list never disagree."""
    return None if p is None else int(p + 0.5)


def _chg(s, g, i):
    if i < 1:
        return None
    gap = (s["dates"][i] - s["dates"][i - 1]).days
    if not 4 <= gap <= 10:
        return None
    return s["net"][g][i] - s["net"][g][i - 1]


def read_at(s, i):
    """Everything the page says about one market at report index i, using only
    reports dated on or before that week (no look-ahead)."""
    d = s["dates"][i]
    lo = d - timedelta(days=WINDOW_DAYS - 1)
    win = [j for j in range(i + 1) if s["dates"][j] >= lo]
    others = [j for j in win if j != i]
    weeks = len(win)
    oi_all, opt = s["oi_all"][i], s["opt_oi"][i]
    share = 100.0 * opt / oi_all if oi_all else None
    m = {"date": d.isoformat(), "oi_all": oi_all, "oi_fut": s["oi_fut"][i], "opt_oi": opt,
         "opt_share": None if share is None else round(share, 1), "weeks": weeks,
         "withheld": None, "groups": {}, "conc": {}, "checks": []}
    enough = len(others) >= MIN_WEEKS - 1
    if not enough:
        m["withheld"] = "history"
    elif share is None or share < MIN_OPT_SHARE:
        m["withheld"] = "small"
    for g in GROUP_ORDER:
        net = s["net"][g][i]
        chg = _chg(s, g, i)
        row = {"net": net, "chg": chg, "pct": None, "chg_pct": None}
        if m["withheld"] is None:
            row["pct"] = shown(rank([s["net"][g][j] for j in others], net))
            m["checks"].append(("level", g, row["pct"] <= EDGE or row["pct"] >= 100 - EDGE))
            past = [abs(c) for c in (_chg(s, g, j) for j in others) if c is not None]
            if chg is not None and len(past) >= MIN_WEEKS - 1:
                row["chg_pct"] = shown(rank(past, abs(chg)))
                m["checks"].append(("change", g, row["chg_pct"] >= 100 - EDGE))
        m["groups"][g] = row
    for ck in CONC:
        v = s["conc"][ck][i]
        m["conc"][ck] = v
        if ck in CONC_SCANNED and enough and v is not None:
            past = [s["conc"][ck][j] for j in others if s["conc"][ck][j] is not None]
            if len(past) >= MIN_WEEKS - 1:
                hi, low = v >= max(past), v <= min(past)
                m["checks"].append(("conc_hi" if hi else "conc_lo" if low else "conc", ck, hi or low))
    return m


def unusual_lines(k, m):
    out = []
    for kind, what, hit in m["checks"]:
        if not hit:
            continue
        line = {"m": k, "kind": kind, "date": m["date"], "weeks": m["weeks"]}
        if kind in ("level", "change"):
            g = m["groups"][what]
            line.update({"g": what, "net": g["net"], "chg": g["chg"],
                         "pct": g["pct"] if kind == "level" else g["chg_pct"]})
        else:
            line.update({"c": what, "value": m["conc"][what]})
        out.append(line)
    return out


def build(fo_rows, comb_rows, legacy_rows, built=None):
    S = series(fo_rows, comb_rows, legacy_rows)
    if not S:
        raise SystemExit("no CFTC rows for any market")
    latest = max(s["dates"][-1] for s in S.values())
    markets, unusual, scanned = {}, [], 0
    for k in ORDER:
        s = S.get(k)
        if not s or s["dates"][-1] != latest:
            continue          # a market missing this week is left out, never carried forward
        m = read_at(s, len(s["dates"]) - 1)
        scanned += len(m["checks"])
        unusual.extend(unusual_lines(k, m))
        m.pop("checks")
        markets[k] = m
    # The whole search, counted: how many lines an ordinary earlier week produced,
    # each week read with only the reports it had at the time.
    all_dates = sorted({d for s in S.values() for d in s["dates"] if d < latest})[-TYPICAL_WEEKS:]
    counts = []
    for d in all_dates:
        n_hit = n_chk = 0
        for k in ORDER:
            s = S.get(k)
            if not s or d not in s["dates"]:
                continue
            m = read_at(s, s["dates"].index(d))
            n_chk += len(m["checks"])
            n_hit += sum(1 for c in m["checks"] if c[2])
        if n_chk:
            counts.append(n_hit)
    typical = None
    if len(counts) >= 26:
        cs = sorted(counts)
        mid = len(cs) // 2
        med = cs[mid] if len(cs) % 2 else (cs[mid - 1] + cs[mid]) / 2.0
        typical = {"weeks": len(cs), "median": med, "min": cs[0], "max": cs[-1]}
    return {
        "built": built or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "report_date": latest.isoformat(),
        "released": CAL.release_date(latest).isoformat(),
        "source": SOURCE,
        "window_days": WINDOW_DAYS,
        "edge": EDGE,
        "min_opt_share": MIN_OPT_SHARE,
        "scanned": scanned,
        "flagged": len(unusual),
        "typical": typical,
        "unusual": unusual,
        "markets": markets,
    }


# ── selftest ─────────────────────────────────────────────────────────────────
def _fake(code, d, oi_c, oi_f, mm_c, mm_f, g4l=10.0):
    base = {"cftc_contract_market_code": code, "market_and_exchange_names": "X",
            "report_date_as_yyyy_mm_dd": d.isoformat() + "T00:00:00.000"}
    zero = {f: "0" for g in GROUP_ORDER for f in GROUPS[g]}
    f = dict(base, **zero)
    f.update(open_interest_all=str(oi_f), m_money_positions_long_all=str(mm_f[0]),
             m_money_positions_short_all=str(mm_f[1]))
    c = dict(base, **zero)
    c.update(open_interest_all=str(oi_c), m_money_positions_long_all=str(mm_c[0]),
             m_money_positions_short_all=str(mm_c[1]))
    l = dict(base, open_interest_all=str(oi_c), **{v: "5.0" for v in CONC.values()})
    l[CONC["g4l"]] = str(g4l)
    return f, c, l


def selftest():
    ok = True

    def check(name, got, want):
        nonlocal ok
        good = got == want
        ok &= good
        print(("ok   " if good else "FAIL ") + name + ("" if good else f": got {got!r}, want {want!r}"))

    check("rank lowest", rank([1, 2, 3], 0), 0.0)
    check("rank highest", rank([1, 2, 3], 9), 100.0)
    check("rank ties half", rank([1, 2, 2, 3], 2), 50.0)
    check("shown rounds halves up", (shown(4.5), shown(94.49), shown(None)), (5, 94, None))

    # 160 weekly reports. Futures-only mm net is always 100; the combined mm net
    # steps 0..159, so the options position is (i - 100) and the last week is the
    # highest of its window. Week 160's change is +1, like every other week, so the
    # change is mid-pack. Concentration g4l sits at 10 except the last week (12).
    t0 = date(2023, 1, 3)
    fo, cb, lg = [], [], []
    for i in range(160):
        d = t0 + timedelta(weeks=i)
        f, c, l = _fake("002602", d, 1000 + 100, 1000, (100 + i, 100), (100, 0), 12.0 if i == 159 else 10.0)
        fo.append(f); cb.append(c); lg.append(l)
    out = build(fo, cb, lg, built="x")
    m = out["markets"]["corn"]
    last = t0 + timedelta(weeks=159)
    check("report date", out["report_date"], last.isoformat())
    check("options OI = combined minus futures", m["opt_oi"], 100)
    check("options share", m["opt_share"], 9.1)
    check("mm options net", m["groups"]["mm"]["net"], 59)
    check("mm week change", m["groups"]["mm"]["chg"], 1)
    win = sum(1 for i in range(160) if t0 + timedelta(weeks=i) > last - timedelta(days=WINDOW_DAYS))
    check("weeks in the window", m["weeks"], win)
    check("highest week ranks 100", m["groups"]["mm"]["pct"], 100)
    check("flat groups rank 50", m["groups"]["pm"]["pct"], 50)
    kinds = sorted((u["kind"], u.get("g") or u.get("c")) for u in out["unusual"])
    # mm level is an extreme; every flat group's change and level are mid; flat
    # concentration series tie their own max and min, so each is "at" a 3-year high.
    want = sorted([("level", "mm"), ("conc_hi", "g4l"), ("conc_hi", "g4s"), ("conc_hi", "g8l"), ("conc_hi", "g8s")])
    check("unusual lines", kinds, want)
    check("scanned = 4 levels + 4 changes + 4 concentration", out["scanned"], 12)

    # A thin options market is not ranked at all.
    fo2, cb2, lg2 = [], [], []
    for i in range(160):
        d = t0 + timedelta(weeks=i)
        f, c, l = _fake("001626", d, 1010, 1000, (100 + i, 100), (100, 0))
        fo2.append(f); cb2.append(c); lg2.append(l)
    m2 = build(fo2, cb2, lg2, built="x")["markets"]["mplswheat"]
    check("thin options withheld", (m2["withheld"], m2["groups"]["mm"]["pct"]), ("small", None))

    # Short history withholds.
    m3 = build(fo[:60], cb[:60], lg[:60], built="x")["markets"]["corn"]
    check("short history withheld", (m3["withheld"], m3["groups"]["mm"]["pct"]), ("history", None))

    # A market missing the latest week is left out, not carried forward.
    out4 = build(fo + fo2[:-1], cb + cb2[:-1], lg + lg2[:-1], built="x")
    check("missing week dropped", "mplswheat" in out4["markets"], False)
    return ok


def main(argv):
    if "--selftest" in argv:
        sys.exit(0 if selftest() else 1)
    out_path = argv[argv.index("--out") + 1] if "--out" in argv else OUT_FILE
    if "--from" in argv:
        src = argv[argv.index("--from") + 1]
        rows = {n: json.load(open(os.path.join(src, n + ".json"))) for n in ("fo", "comb", "legacy")}
    else:
        since = (date.today() - timedelta(days=FETCH_DAYS)).isoformat()
        rows = {"fo": fetch(DATASETS["fo"], DISAGG_FIELDS, since),
                "comb": fetch(DATASETS["comb"], DISAGG_FIELDS, since),
                "legacy": fetch(DATASETS["legacy"], LEGACY_FIELDS, since)}
        print("fetched rows: " + ", ".join(f"{n} {len(v)}" for n, v in rows.items()))
        if "--save" in argv:
            d = argv[argv.index("--save") + 1]
            os.makedirs(d, exist_ok=True)
            for n, v in rows.items():
                json.dump(v, open(os.path.join(d, n + ".json"), "w"))
    out = build(rows["fo"], rows["comb"], rows["legacy"])
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    with open(out_path, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"wrote {out_path}: report {out['report_date']}, {len(out['markets'])} markets")


if __name__ == "__main__":
    main(sys.argv[1:])
