#!/usr/bin/env python3
"""
arc_plc_crops.py -- every covered commodity beyond corn, soybeans and wheat,
for scripts/build_arc_plc.py (which imports this file; it writes nothing itself).

WHERE EVERY NUMBER COMES FROM (verified 2026-10-09)
  FSA's national tables in data/fsa/, dated Sept 11, 2026 [FSAT]:
    2026_MYA.xlsx     Table 1: final MYA prices 2020/21 to 2024/25, 2025/26
                      (final F or projected P), projected 2026/27, unit, marketing year
    2026_ERP.xlsx     Table 2: statutory reference price, 115% cap, 88% of the
                      Olympic average, 2026 effective reference price
    2026_PLC.xlsx     Table 3: 2026 national loan rate, projected 2026 PLC rate
    2026_ARC_CO.xlsx  Table 4: 2026 ARC-CO benchmark price
  Units are FSA's: bushel for sorghum, barley, oats and flaxseed; pound for
  everything else, rice included (FSA prices rice in $/lb, not $/cwt).
  Statutory prices and loan rates are read from those tables, never typed in
  here. The build recomputes every 2026 ERP and benchmark price from FSA's own
  MYA column and refuses to publish if one differs from FSA's table or from a
  county row in FSA's ARC-CO county file (two answers in front of a reader).
  Precision: FSA rounds sorghum, barley and oats to the cent and every other
  commodity (flaxseed too) to four decimals; DP below reproduces each table.

  2027: the window is 2021/22 to 2025/26. Where FSA's table still shows the
  2025/26 price as projected, the 2027 ERP and benchmark price are printed
  only if they come out the same at any 2025/26 price (both are Olympic
  averages, so it is enough to try a price of zero and a very high one).
  Otherwise the 2027 figures are withheld until the final price is out.

  Seed cotton: FSA's seed cotton price is its own weighted average of the
  upland cotton lint price and the cottonseed price (Table 1 note 2/). The
  weights are not in any file here, and WASDE prints lint only, so this file
  never builds a seed cotton price: it uses FSA's seed cotton series as
  published. The $0.42/lb reference price and FSA's 2026 ERP ($0.42) and
  benchmark price ($0.4311) reproduce from that series.

  Price scenarios: WASDE (October 9, 2026) prints a projected 2026/27 price
  for sorghum, barley and oats ($/bu) and long grain rice ($/cwt, divided by
  100 to FSA's $/lb). Every other crop is centered on FSA's projected 2026/27
  price in Table 1, labeled as such. FSA's table starts in 2020/21, which gives
  at most five past years of price change, under the eight a call needs
  (MIN_SCEN in build_arc_plc.py). So for 2026 these crops borrow corn's
  October spread (build_arc_plc.price_scen), the crop is harvested so the
  county yield is a normal crop, and every call is capped at Leans. For 2027
  there is no 2027 price for these crops we can check against past years, so
  there is no 2027 call. No price history from outside FSA's files is used.
"""
import glob
import math
import os
import re
import datetime as dt
from decimal import Decimal, ROUND_HALF_UP

FSA_DIR = "data/fsa"
TABLE_URLS = {
    "FSAT_MYA": ("FSA, 2026 MYA prices (Table 1, Sept 11, 2026)", "https://www.fsa.usda.gov/sites/default/files/2026-09/2026_MYA_0.xlsx"),
    "FSAT_ERP": ("FSA, 2026 effective reference prices (Table 2, Sept 11, 2026)", "https://www.fsa.usda.gov/sites/default/files/2026-09/2026_ERP_0.xlsx"),
    "FSAT_PLC": ("FSA, projected 2026 PLC payment rates (Table 3, Sept 11, 2026)", "https://www.fsa.usda.gov/sites/default/files/2026-09/2026_PLC.xlsx"),
    "FSAT_ARC": ("FSA, 2026 ARC-CO benchmark prices (Table 4, Sept 11, 2026)", "https://www.fsa.usda.gov/sites/default/files/2026-09/2026_ARC_CO_0.xlsx"),
}

# key: label, lowercase phrase, hub slug, FSA county-file crop name, FSA PLC-yield
# file crop name, FSA national table commodity, unit, decimals FSA rounds to,
# and the WASDE line that projects its 2026/27 price, if any
XCROPS = {
    "sorghum": dict(label="Sorghum", lc="sorghum", slug="sorghum", fsa="Grain Sorghum", plc="GRAIN SORGHUM", table="Grain Sorghum", unit="bu", dp=2, wasde="sorghum"),
    "barley": dict(label="Barley", lc="barley", slug="barley", fsa="Barley", plc="BARLEY", table="Barley", unit="bu", dp=2, wasde="barley"),
    "oats": dict(label="Oats", lc="oats", slug="oats", fsa="Oats", plc="OATS", table="Oats", unit="bu", dp=2, wasde="oats"),
    "peanuts": dict(label="Peanuts", lc="peanuts", slug="peanuts", fsa="Peanuts", plc="PEANUTS", table="Peanuts", unit="lb", dp=4),
    "rice_long": dict(label="Long grain rice", lc="long grain rice", slug="long-grain-rice", fsa="Rice_Long Grain", plc="RICE-LONG GRAIN",
                      table="Rice (long grain)", unit="lb", dp=4, wasde="rice_long"),
    "rice_medium": dict(label="Medium and short grain rice", lc="medium and short grain rice", short="Med/short grain rice", slug="medium-short-grain-rice",
                        fsa="Rice_Med/Short Grain", plc="RICE-MED GRAIN", table="Rice (med/short grain)", unit="lb", dp=4,
                        note="FSA&rsquo;s medium and short grain rice leaves out temperate japonica, which has its own reference price."),
    "rice_japonica": dict(label="Temperate japonica rice", lc="temperate japonica rice", short="Japonica rice", slug="temperate-japonica-rice",
                          fsa="Rice_Temperate Japonica", plc="RICE-TEMP JAPONICA", table="Rice (temperate japonica)", unit="lb", dp=4),
    "seed_cotton": dict(label="Seed cotton", lc="seed cotton", slug="seed-cotton", fsa="Seed Cotton", plc="SEED COTTON", table="Seed Cotton", unit="lb", dp=4,
                        note=("FSA&rsquo;s seed cotton price is its own weighted average of the upland cotton lint price and the cottonseed price. "
                              "We use FSA&rsquo;s seed cotton series as published and never build it from the lint price.")),
    "dry_peas": dict(label="Dry peas", lc="dry peas", slug="dry-peas", fsa="Dry Peas", plc="DRY PEAS", table="Dry Peas", unit="lb", dp=4),
    "lentils": dict(label="Lentils", lc="lentils", slug="lentils", fsa="Lentils", plc="LENTILS", table="Lentils", unit="lb", dp=4),
    "chickpeas_small": dict(label="Small chickpeas", lc="small chickpeas", slug="small-chickpeas", fsa="Chickpeas_Small", plc="BEANS-SMALL CHICKPEAS",
                            table="Small Chickpeas", unit="lb", dp=4),
    "chickpeas_large": dict(label="Large chickpeas", lc="large chickpeas", slug="large-chickpeas", fsa="Chickpeas_Large", plc="BEANS-LARGE CHICKPEAS",
                            table="Large Chickpeas", unit="lb", dp=4),
    "canola": dict(label="Canola", lc="canola", slug="canola", fsa="Canola", plc="CANOLA", table="Canola", unit="lb", dp=4),
    "flaxseed": dict(label="Flaxseed", lc="flaxseed", slug="flaxseed", fsa="Flaxseed", plc="FLAXSEED", table="Flaxseed", unit="bu", dp=4),
    "sunflower": dict(label="Sunflower seed", lc="sunflower seed", slug="sunflower-seed", fsa="Sunflower Seed", plc="SUNFLOWER SEED", table="Sunflower Seed", unit="lb", dp=4),
    "mustard": dict(label="Mustard seed", lc="mustard seed", slug="mustard-seed", fsa="Mustard Seed", plc="MUSTARD SEED", table="Mustard Seed", unit="lb", dp=4),
    "rapeseed": dict(label="Rapeseed", lc="rapeseed", slug="rapeseed", fsa="Rapeseed", plc="RAPESEED", table="Rapeseed", unit="lb", dp=4),
    "safflower": dict(label="Safflower", lc="safflower", slug="safflower", fsa="Safflower", plc="SAFFLOWER", table="Safflower", unit="lb", dp=4),
    "crambe": dict(label="Crambe", lc="crambe", slug="crambe", fsa="Crambe", plc="CRAMBE", table="Crambe", unit="lb", dp=4),
    "sesame": dict(label="Sesame seed", lc="sesame seed", slug="sesame-seed", fsa="Sesame Seed", plc="SESAME SEED", table="Sesame Seed", unit="lb", dp=4),
}
PLC_NAMES = {v["plc"]: k for k, v in XCROPS.items()}
UNIT = {"bu": {"short": "bu", "word": "bushel", "per": "/bu"}, "lb": {"short": "lb", "word": "pound", "per": "/lb"}}
MON3 = {"Jan": 1, "Feb": 2, "Mar": 3, "Apr": 4, "May": 5, "Jun": 6, "Jul": 7, "Aug": 8, "Sep": 9, "Oct": 10, "Nov": 11, "Dec": 12}
MONN = ["Jan", "Feb", "Mar", "Apr", "May", "June", "July", "Aug", "Sept", "Oct", "Nov", "Dec"]


# ---------------------------------------------------------------- math
def rnd(v, k=2):
    d = Decimal(repr(round(float(v), 9))).quantize(Decimal(1).scaleb(-k), rounding=ROUND_HALF_UP)
    return float(d)


def olympic(vals):
    if len(vals) != 5:
        raise ValueError("an Olympic average needs exactly 5 values")
    s = sorted(vals)
    return (s[1] + s[2] + s[3]) / 3.0, s[0], s[4]


def erp_x(myas, statutory, dp, pct=0.88, cap_pct=1.15):
    """build_arc_plc.erp_calc at FSA's precision for the crop (dp decimals)."""
    avg, lo, hi = olympic(myas)
    pv = rnd(avg * pct, dp)
    cap = rnd(statutory * cap_pct, dp)
    erp = min(cap, max(statutory, pv))
    binding = "cap" if erp == cap and pv > cap else ("formula" if pv > statutory else "statutory")
    return {"olympic_avg": rnd(avg, 6), "dropped_low": lo, "dropped_high": hi, "pct": pct,
            "pct_value": pv, "statutory": statutory, "cap_pct": cap_pct, "cap": cap, "erp": rnd(erp, dp), "binding": binding}


def bp_x(myas, erp, dp):
    used = [max(m, erp) for m in myas]
    avg, lo, hi = olympic(used)
    return rnd(avg, dp), used, lo, hi


def scale(cd):
    """Ticks per dollar for the price scan: cents for bushel crops, hundredths of a cent for pound crops."""
    return 10000 if cd.get("unit") == "lb" else 100


def nice_step(x):
    e = 10 ** math.floor(math.log10(x))
    for m in (1, 2, 2.5, 5, 10):
        if x <= m * e + 1e-12:
            return rnd(m * e, 6)
    return rnd(10 * e, 6)


def auto_grid(loan, erp, bp):
    top = max(erp, bp) * 1.15
    st = nice_step((top - loan) / 10)
    return (loan, rnd(math.ceil(top / st - 1e-9) * st, 6), st)


# ---------------------------------------------------------------- formatting
def pf(cd, v):
    """A price the way FSA prints it: $0.3150 for pound crops, $4.67 for sorghum,
    barley and oats, flaxseed to as many as four decimals ($13.30, $6.216)."""
    if v is None:
        return ""
    if cd.get("unit") == "lb":
        return f"${rnd(v, 4):.4f}"
    if cd.get("dp", 2) > 2:
        s = f"{rnd(v, 4):,.4f}".rstrip("0")
        if len(s.split(".")[1]) < 2:
            s = f"{rnd(v, 2):,.2f}"
        return "$" + s
    return f"${rnd(v, 2):,.2f}"


def yf(cd, v, k=2):
    """A yield with its unit: 52.30 bu, 4,012.50 lb."""
    u = UNIT[cd.get("unit", "bu")]["short"]
    return f"{rnd(v, k):,.{k}f} {u}"


def per(cd):
    return UNIT[cd.get("unit", "bu")]["per"]


def say_price(cd, v):
    """A price in plain words for a sentence: 23.75 cents a pound, $4.67 a bushel."""
    if cd.get("unit") == "lb":
        c = f"{rnd(v * 100, 2):.2f}".rstrip("0").rstrip(".")
        return f"{c} cents a pound"
    return f"{pf(cd, v)} a {word(cd)}"


def word(cd):
    return UNIT[cd.get("unit", "bu")]["word"]


def nice(iso, year=True):
    d = dt.date.fromisoformat(iso)
    m = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.month - 1]
    return f"{m} {d.day}" + (f", {d.year}" if year else "")


def marketing_year(fsa_my, py):
    """FSA's 'Jun. 1-May 31' for program year 2026 -> 'June 2026 to May 2027'."""
    m = re.findall(r"([A-Z][a-z]{2})", fsa_my or "")
    if len(m) < 2 or m[0] not in MON3:
        return fsa_my or ""
    a, b = MON3[m[0]], MON3[m[1]]
    return f"{MONN[a - 1]} {py} to {MONN[b - 1]} {py + (1 if b < a else 0)}"


# ---------------------------------------------------------------- FSA national tables
def _num(v):
    try:
        return None if v is None or v == "" else float(v)
    except (TypeError, ValueError):
        return None


def _name(s):
    """'Seed Cotton 2/' -> 'Seed Cotton'; 'Rice (med/short grain) 3/' -> 'Rice (med/short grain)'."""
    return re.sub(r"\s+\d/\s*$", "", str(s or "").strip()).strip()


def load_tables(load_xlsx, root="."):
    """FSA's four national tables -> {date, rows: {commodity: {...}}} or None.

    rows[c]: my (FSA's marketing year), unit, mya {year: (price, 'F' or 'P')},
    statutory, cap, erp_pv, erp (Table 2), loan, plc_p (Table 3), bp (Table 4)."""
    out = {"date": None, "rows": {}, "files": {}}

    def rows_of(stem):
        ps = sorted(glob.glob(os.path.join(root, FSA_DIR, stem + "*.xls*")))
        if not ps:
            return None
        out["files"][stem] = os.path.relpath(ps[-1], root)
        return [r for r in load_xlsx(ps[-1]).worksheets[0].iter_rows(values_only=True)]

    def hdr_row(rows):
        return next(i for i, r in enumerate(rows) if r and str(r[0] or "").strip() == "Commodity")

    def date_of(rows):
        for r in rows[:4]:
            for v in r or ():
                m = re.match(r"([A-Z][a-z]+) (\d{1,2}), (20\d\d)", str(v or ""))
                if m:
                    return dt.datetime.strptime(m.group(0), "%B %d, %Y").date().isoformat()
        return None

    rs = rows_of("2026_MYA")
    if not rs:
        return None
    out["date"] = date_of(rs)
    h = hdr_row(rs)
    hdr = [str(x or "") for x in rs[h]]
    ycols = []
    for i, x in enumerate(hdr):
        m = re.search(r"(\d{4})/\d\d MYA", x)
        if m:
            ycols.append((int(m.group(1)), i, "Projected (P) or Final (F)" in x))
    iu, im = hdr.index("Unit"), hdr.index("Marketing Year")
    for r in rs[h + 1:]:
        if not r or not r[0] or _num(r[iu + 1]) is None:
            continue
        c = _name(r[0])
        mya = {}
        for y, i, flagged in ycols:
            v = _num(r[i])
            if v is not None:
                mya[y] = (v, str(r[i + 1] or "").strip() if flagged else "F")
        out["rows"][c] = {"my": str(r[im] or "").strip(), "unit": str(r[iu] or "").strip(), "mya": mya}
    for stem, cols in (("2026_ERP", {"statutory": "Reference Price", "cap": "115% of", "erp_pv": "88% of", "erp": "Effective Reference Price"}),
                       ("2026_PLC", {"loan": "National Loan Rate", "plc_p": "PLC Payment Rate", "plc_max": "Maximum"}),
                       ("2026_ARC_CO", {"bp": "Benchmark Price"})):
        rs = rows_of(stem)
        if not rs:
            return None
        h = hdr_row(rs)
        heads = [" ".join(str(x or "") for x in col) for col in zip(*rs[max(0, h - 2):h + 2])]
        idx = {}
        for key, pat in cols.items():
            cand = [i for i, x in enumerate(heads) if pat in x]
            if key == "statutory":
                cand = [i for i in cand if "115%" not in heads[i] and "Effective" not in heads[i]]
            if key == "plc_p":
                cand = [i for i in cand if "Maximum" not in heads[i]]
            if key == "bp":
                cand = [i for i in cand if "ARC-CO Benchmark Price" in heads[i]]
            if not cand:
                raise SystemExit(f"{stem}: no column for {pat!r}; FSA changed the table layout")
            idx[key] = cand[0]
        for r in rs[h + 1:]:
            c = _name((r or [None])[0])
            if c in out["rows"]:
                for key, i in idx.items():
                    out["rows"][c][key] = _num(r[i])
    return out


# ---------------------------------------------------------------- WASDE
def parse_wasde_x(text):
    """Projected 2026/27 season-average price, this month, for the crops WASDE
    prints that FSA covers: sorghum, barley, oats ($/bu) and long grain rice
    ($/cwt). -> {key: (price in FSA's unit, WASDE unit, WASDE number)}. A line
    must carry exactly four prices (two past years, last month, this month)."""
    out = {}
    a = re.search(r"U\.S\. Sorghum, Barley,? (?:and|&) Oats Supply (?:and|&) Use", text)
    if a:
        for k, sub in (("sorghum", "SORGHUM"), ("barley", "BARLEY"), ("oats", "OATS")):
            b = re.compile(r"\n\s*" + sub + r"\s*\n").search(text, a.end())
            if not b:
                continue
            line = re.compile(r"Avg\. Farm Price \(\$/bu\)[^\n]*").search(text, b.end())
            nums = re.findall(r"\d+\.\d+", line.group(0)) if line else []
            if len(nums) == 4:
                out[k] = (float(nums[-1]), "$/bu", float(nums[-1]))
    r = re.search(r"\n\s*LONG-GRAIN RICE\s*\n", text)
    if r:
        line = re.compile(r"Avg\. Farm Price \(\$/cwt\)[^\n]*").search(text, r.end())
        nums = re.findall(r"\d+\.\d+", line.group(0)) if line else []
        if len(nums) == 4:
            out["rice_long"] = (rnd(float(nums[-1]) / 100, 4), "$/cwt", float(nums[-1]))
    return out


def load_wasde_x(wasde_text, root, w):
    """The same WASDE file build_arc_plc.py read for corn, soybeans and wheat, so the two never differ in vintage."""
    if not w or not w.get("file"):
        return None
    p = os.path.join(root, w["file"])
    if not os.path.exists(p):
        return None
    return {"date": w.get("date"), "number": w.get("number"), "prices": parse_wasde_x(wasde_text(p))}


# ---------------------------------------------------------------- program years
def _solve(win_vals, statutory, dp):
    e = erp_x(win_vals, statutory, dp)
    bp, used, lo, hi = bp_x(win_vals, e["erp"], dp)
    return e, bp, used, lo, hi


def year_params_x(tabs, py):
    """-> (crops {key: crop dict shaped like build_arc_plc.year_params'}, pending {key: why withheld})."""
    crops, pending = {}, {}
    if not tabs:
        return crops, pending
    win = list(range(py - 6, py - 1))
    for k, x in XCROPS.items():
        t = tabs["rows"].get(x["table"])
        if not t or t.get("statutory") is None or t.get("loan") is None:
            pending[k] = "FSA&rsquo;s tables on file do not list this crop."
            continue
        dp = x["dp"]
        miss = [y for y in win if y not in t["mya"]]
        if miss:
            pending[k] = f"FSA&rsquo;s table has no {miss[0]}/{str(miss[0] + 1)[2:]} price."
            continue
        proj = [y for y in win if t["mya"][y][1] != "F"]
        note = ""
        if not proj:
            vals = [t["mya"][y][0] for y in win]
            e, bp, used, lo, hi = _solve(vals, t["statutory"], dp)
            mya = {str(y): v for y, v in zip(win, vals)}
        elif len(proj) == 1:
            # an Olympic average moves one way with each input: if a zero and a very
            # high price give the same answer, every price between does too
            y0 = proj[0]
            lo_v = [0.0 if y == y0 else t["mya"][y][0] for y in win]
            hi_v = [1e6 if y == y0 else t["mya"][y][0] for y in win]
            a, b = _solve(lo_v, t["statutory"], dp), _solve(hi_v, t["statutory"], dp)
            if a[0]["erp"] != b[0]["erp"] or a[1] != b[1]:
                pending[k] = (f"These figures wait on USDA&rsquo;s closing {y0}/{str(y0 + 1)[2:]} season-average price; FSA&rsquo;s table of "
                              f"{nice(tabs['date'])} still shows it as projected ({pf(x, t['mya'][y0][0])}{per(x)}), and the answer depends on it.")
                continue
            e, bp, used, lo, hi = a
            e = dict(e, olympic_avg=None, pct_value=None, dropped_low=None, dropped_high=None)
            mya = {str(y): t["mya"][y][0] for y in win if y != y0}
            note = (f"The {y0}/{str(y0 + 1)[2:]} price is not final yet (FSA&rsquo;s table of {nice(tabs['date'])}), but these figures "
                    f"come out the same at any {y0}/{str(y0 + 1)[2:]} price.")
            used = [m if y != y0 else None for y, m in zip(win, used)]
        else:
            pending[k] = f"FSA&rsquo;s table still shows {len(proj)} of the {py} window prices as projected."
            continue
        cd = {"label": x["label"], "statutory": t["statutory"], "loan": t["loan"], "prior_statutory": None,
              "mya": mya, "erp": e,
              "bp": {"value": bp, "used": {str(y): v for y, v in zip(win, used) if v is not None}, "dropped_low": lo if not proj else None,
                     "dropped_high": hi if not proj else None},
              "futures": None, "my": marketing_year(t["my"], py), "unit": x["unit"], "dp": dp, "tick": 1.0 / (10000 if x["unit"] == "lb" else 100),
              "fsa_unit": t["unit"], "src": "fsa"}
        g = auto_grid(t["loan"], e["erp"], bp)
        cd["grid"] = {"lo": g[0], "hi": g[1], "step": g[2]}
        if note:
            cd["note"] = note
        if py == 2026:
            cd["fsa_check"] = {"erp": t.get("erp"), "bp": t.get("bp"), "cap": t.get("cap"), "erp_pv": t.get("erp_pv")}
            cd["fsa_proj"] = t["mya"].get(2026, (None, ""))[0]
            cd["fsa_plc_p"] = t.get("plc_p")
        crops[k] = cd
    return crops, pending


def check_against_fsa(crops26, fsa_primary):
    """Two answers never go out: our 2026 ERP and benchmark price must equal
    FSA's national tables and every county row of FSA's 2026 county file."""
    for k, cd in crops26.items():
        f = cd.get("fsa_check") or {}
        tol = 0.5 * 10 ** -cd["dp"] + 1e-9
        if f.get("erp") is None or abs(f["erp"] - cd["erp"]["erp"]) > tol:
            raise SystemExit(f"FSA's 2026 ERP for {k} is {f.get('erp')}, ours {cd['erp']['erp']}: refusing two answers")
        if f.get("bp") is None or abs(f["bp"] - cd["bp"]["value"]) > tol:
            raise SystemExit(f"FSA's 2026 ARC-CO benchmark price for {k} is {f.get('bp')}, ours {cd['bp']['value']}: refusing two answers")
        if f.get("erp_pv") is not None and abs(f["erp_pv"] - cd["erp"]["pct_value"]) > tol:
            raise SystemExit(f"FSA's 88% figure for {k} is {f['erp_pv']}, ours {cd['erp']['pct_value']}: refusing two answers")
    if not fsa_primary:
        return
    by = {XCROPS[k]["fsa"]: k for k in crops26}
    for (fips, sub, crop, d), rec in fsa_primary["rows"].items():
        k = by.get(crop)
        if k and rec["bp"] is not None and abs(rec["bp"] - crops26[k]["bp"]["value"]) > 0.5 * 10 ** -crops26[k]["dp"] + 1e-9:
            raise SystemExit(f"FSA's 2026 county file prices {crop} at {rec['bp']} in {fips}, ours {crops26[k]['bp']['value']}: refusing two answers")


def price_scen_x(k, cd, tabs, wasde_x, scen_years, min_scen):
    """Scenario prices for one of these crops: the center and each past year's
    change in FSA's final MYA price. See the module docstring."""
    t = tabs["rows"][XCROPS[k]["table"]]
    fin = {y: v for y, (v, f) in t["mya"].items() if f == "F"}
    yoy = {y: rnd(fin[y] / fin[y - 1], 4) for y in scen_years if y in fin and (y - 1) in fin}
    wp = ((wasde_x or {}).get("prices") or {}).get(k)
    if wp and wasde_x.get("date"):
        center = wp[0]
        conv = f" (${wp[2]:.2f}/cwt)" if wp[1] == "$/cwt" else ""
        label = f"USDA&rsquo;s projected 2026/27 season-average price (WASDE, {nice(wasde_x['date'])}){conv}"
        src = f"USDA WASDE, {nice(wasde_x['date'])}"
    elif t["mya"].get(2026) and t["mya"][2026][0]:
        center = t["mya"][2026][0]
        label = f"FSA&rsquo;s projected 2026/27 season-average price (FSA table of {nice(tabs['date'])})"
        src = f"FSA table of {nice(tabs['date'])}"
    else:
        return None
    first = min(fin) if fin else None
    why = (f"FSA&rsquo;s price table on file starts with {first}/{str(first + 1)[2:]}, so it holds only {len(yoy)} years of price change "
           f"to pair with county yields.") if len(yoy) < min_scen and first else ""
    return {"kind": "yoy", "center": center, "ratios": yoy, "center_label": label, "usda": center, "usda_src": src, "why": why}


def proj_rate(cd, price):
    """PLC rate at a projected price: ERP minus the higher of price or loan rate."""
    return max(0.0, cd["erp"]["erp"] - max(price, cd["loan"]))


# ---------------------------------------------------------------- pages
def hub_path(k):
    return f"/arc-plc/{XCROPS[k]['slug']}"


def crop_title(cd, k):
    x = XCROPS[k]
    for t in (f"{x['label']} ARC or PLC 2026 and 2027 | AGSIST", f"{x['label']} ARC or PLC 2026 and 2027",
              f"{x.get('short', x['label'])} ARC or PLC 2026 and 2027", f"{x['label']} ARC or PLC 2026"):
        if len(t) <= 60:
            return t
    return f"{x['label']} ARC or PLC"


def erp_math_x(cd, py):
    e = cd["erp"]
    if e.get("olympic_avg") is None:
        return (f'<p class="ap-math"><b>{py}.</b> {cd.get("note", "")} Statutory price {pf(cd, e["statutory"])}, so the effective reference '
                f'price is <b>{pf(cd, e["erp"])}</b>; benchmark price <b>{pf(cd, cd["bp"]["value"])}</b>.</p>')
    lo_done = hi_done = False
    parts = []
    for y, v in cd["mya"].items():
        if not lo_done and v == e["dropped_low"]:
            parts.append(f"<s>{y}: {pf(cd, v)}</s>"); lo_done = True
        elif not hi_done and v == e["dropped_high"]:
            parts.append(f"<s>{y}: {pf(cd, v)}</s>"); hi_done = True
        else:
            parts.append(f"{y}: {pf(cd, v)}")
    if e["binding"] == "statutory":
        v = f'88% of that is {pf(cd, e["pct_value"])}, below the {pf(cd, e["statutory"])} statutory price, so the statutory price holds: <b>{pf(cd, e["erp"])}</b>.'
    elif e["binding"] == "cap":
        v = f'88% of that is {pf(cd, e["pct_value"])}, above the {pf(cd, e["cap"])} cap (115%), so the cap holds: <b>{pf(cd, e["erp"])}</b>.'
    else:
        v = f'88% of that is <b>{pf(cd, e["erp"])}</b>, above the {pf(cd, e["statutory"])} statutory price and under the {pf(cd, e["cap"])} cap (115%).'
    used = " &middot; ".join(f"{y}: {pf(cd, u)}" + (f" (raised from {pf(cd, cd['mya'][y])})" if u != cd["mya"][y] else "") for y, u in cd["bp"]["used"].items())
    return (f'<p class="ap-math"><b>{py} effective reference price.</b> Season-average prices {" &middot; ".join(parts)} (struck: the high and low year). '
            f'Average of the middle three: {pf(cd, e["olympic_avg"]) if cd["unit"] == "lb" else "$" + format(e["olympic_avg"], ".4f")}. {v}</p>'
            f'<p class="ap-math"><b>{py} ARC-CO benchmark price.</b> {used}. Drop the high ({pf(cd, cd["bp"]["dropped_high"])}) and low '
            f'({pf(cd, cd["bp"]["dropped_low"])}); the middle three average <b>{pf(cd, cd["bp"]["value"])}</b>.</p>')


def crop_counties(D, k):
    """[(state code, S, [(county, entries)])] for counties where FSA has a 2026 benchmark for crop k."""
    out = []
    for st, S in sorted(D["states"].items(), key=lambda kv: kv[1]["n"]):
        cs = [(c, [e for e in c["k"].get(k, []) if e["by"]]) for c in S["c"]]
        cs = [(c, es) for c, es in cs if es]
        if cs:
            out.append((st, S, cs))
    return out


def tally(D, k):
    t = {}
    for S in D["states"].values():
        for c in S["c"]:
            for (kk, i, y), v in c["verdicts"].items():
                if kk == k:
                    t.setdefault(y, {}).setdefault(v["verdict"], 0)
                    t[y][v["verdict"]] += 1
    return t


def hub_faq(D, k):
    x = XCROPS[k]
    c6 = D["years"]["2026"]["crops"][k]
    c7 = D["years"]["2027"]["crops"].get(k)
    pend7 = (D["years"]["2027"].get("pending") or {}).get(k, "")
    sc = c6.get("scen") or {}
    u = per(c6)
    q = []
    q.append((f"What is the 2026 effective reference price for {x['lc']}?",
              f"{pf(c6, c6['erp']['erp'])} per {word(c6)}, from FSA's 2026 table. The statutory reference price is {pf(c6, c6['statutory'])}; "
              f"88% of the 2020 to 2024 Olympic average season-average price is {pf(c6, c6['erp']['pct_value'])}, and the cap is {pf(c6, c6['erp']['cap'])}. "
              f"The 2026 ARC-CO benchmark price is {pf(c6, c6['bp']['value'])} and the loan rate is {pf(c6, c6['loan'])}."))
    if c7:
        q.append((f"What is the 2027 effective reference price for {x['lc']}?",
                  f"{pf(c7, c7['erp']['erp'])} per {word(c7)} by our math from FSA's final prices (est.); the 2027 ARC-CO benchmark price is "
                  f"{pf(c7, c7['bp']['value'])}. FSA publishes the official 2027 figures. " + strip(c7.get("note", ""))))
    else:
        q.append((f"What is the 2027 effective reference price for {x['lc']}?", "Not yet. " + strip(pend7)))
    if sc:
        r = proj_rate(c6, sc["center"])
        q.append((f"Will PLC pay on {x['lc']} for 2026?",
                  f"At {strip(sc['usda_src'])}'s projected 2026/27 price of {pf(c6, sc['center'])}{u}, PLC would pay " + ("nothing for 2026" if r == 0 else f"a 2026 rate of {pf(c6, r)}{u}")
                  + f". FSA's own table of {nice(D['_xtab_date'])} shows " + ("no payment" if not c6['fsa_plc_p'] else f"{pf(c6, c6['fsa_plc_p'])}{u}") + f" at {pf(c6, c6['fsa_proj'])}. "
                  f"The real rate is set by the final season-average price, published after the marketing year ({c6['my']}) ends."))
    q.append((f"Should I pick ARC or PLC for {x['lc']}?",
              f"We do not give a pick for {x['lc']} yet. " + strip(sc.get("why", "")) + " The county pages show FSA's official benchmark, where each "
              f"program pays more by price, and the calculator runs your own PLC yield and price."))
    q.append((f"Where do I find my county's {x['lc']} ARC-CO benchmark yield?",
              f"FSA's 2026 county file lists {x['lc']} benchmarks for {sum(len(cs) for _st, _S, cs in crop_counties(D, k)):,} counties; each one has a "
              f"page here. A county FSA does not list has no {x['lc']} benchmark; ask the county FSA office."))
    return q


def strip(s):
    import html as _h
    return re.sub(r"<[^>]+>", "", _h.unescape(s or "")).strip()


def hub_page(B, D, k, ch):
    """/arc-plc/<crop>: the crop's prices, FSA's projection, why there is no pick, and every county with a benchmark."""
    import json as _j
    hdr, ftr, fonts = ch
    x = XCROPS[k]
    c6 = D["years"]["2026"]["crops"][k]
    c7 = D["years"]["2027"]["crops"].get(k)
    pend7 = (D["years"]["2027"].get("pending") or {}).get(k, "")
    sc = c6.get("scen") or {}
    u = per(c6)
    path = hub_path(k)
    esc = B.esc
    cc = crop_counties(D, k)
    n_c = sum(len(cs) for _st, _S, cs in cc)
    title = crop_title(c6, k)
    desc = (f"{x['label']} 2026 effective reference price {pf(c6, c6['erp']['erp'])}{u}, ARC-CO benchmark {pf(c6, c6['bp']['value'])}. "
            f"FSA county benchmarks for {n_c:,} counties. Signup ends Dec 11.")
    if len(desc) > 155:
        desc = f"{x['label']} 2026 ERP {pf(c6, c6['erp']['erp'])}{u}, ARC-CO price {pf(c6, c6['bp']['value'])}. FSA benchmarks for {n_c:,} counties."
    faq = hub_faq(D, k)
    upd = D["updated"][:10]
    jsonld = [
        {"@context": "https://schema.org", "@type": "FAQPage",
         "mainEntity": [{"@type": "Question", "name": qq, "acceptedAnswer": {"@type": "Answer", "text": a}} for qq, a in faq]},
        {"@context": "https://schema.org", "@type": "Dataset", "@id": f"{B.SITE}{path}#dataset",
         "name": f"{x['label']} PLC and ARC-CO prices 2026 and 2027, with FSA county benchmark yields",
         "description": (f"{x['label']} effective reference price, ARC-CO benchmark price and loan rate from FSA's 2026 national tables, "
                         f"and FSA's official 2026 ARC-CO benchmark yields for {n_c} counties."),
         "url": f"{B.SITE}{path}", "isAccessibleForFree": True, "creator": {"@type": "Organization", "name": "AGSIST", "url": B.SITE},
         "isBasedOn": [B.FSA_DATA], "dateModified": upd,
         "variableMeasured": [f"Effective reference price ($/{c6['unit']})", f"ARC-CO benchmark yield ({c6['unit']}/acre)"]},
        {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Home", "item": f"{B.SITE}/"},
            {"@type": "ListItem", "position": 2, "name": "ARC or PLC", "item": f"{B.SITE}/arc-plc"},
            {"@type": "ListItem", "position": 3, "name": x["label"], "item": f"{B.SITE}{path}"}]},
        {"@context": "https://schema.org", "@type": "WebPage", "@id": f"{B.SITE}{path}", "name": title, "url": f"{B.SITE}{path}", "description": desc,
         "author": B.AUTHOR, "dateModified": upd, "inLanguage": "en-US"},
    ]
    # quick answer
    proj = ""
    if sc:
        r = proj_rate(c6, sc["center"])
        proj = (f"<p>At {sc['center_label']}, {pf(c6, sc['center'])}{u}, PLC would pay " + ("<b>nothing</b> for 2026" if r == 0 else f"a 2026 rate of <b>{pf(c6, r)}{u}</b>")
                + ". The real rate comes from the final price after the marketing year ends "
                f"({esc(c6['my'])}).</p>")
    y7 = (f"2027 (est.): ERP <b>{pf(c7, c7['erp']['erp'])}</b>, benchmark price {pf(c7, c7['bp']['value'])}. {c7.get('note', '')}" if c7
          else f"2027: {pend7}")
    t = tally(D, k)
    t6 = t.get("2026", {})
    n6 = sum(t6.values())
    mism = t6.get("mismatch", 0)
    verdict_p = (f"<p><b>No ARC or PLC pick for {esc(x['lc'])} yet.</b> {sc.get('why', '')} "
                 f"Across {n6:,} county and practice combinations, every typical-farm verdict is withheld"
                 + (f" ({mism:,} have no typical farm because FSA&rsquo;s county average PLC yield is above the benchmark)" if mism else "")
                 + ". The county pages still give the benchmark and where each program pays more by price.</p>") if t6 and not any(
        t6.get(w) for w in ("plc", "arc", "close", "lean_plc", "lean_arc", "none")) else ""
    if not verdict_p and t6:
        verdict_p = ("<p><b>Typical-farm verdicts, 2026:</b> " + ", ".join(f"{B.VWORD[w]} {t6.get(w, 0):,}" for w in ("plc", "lean_plc", "close", "lean_arc", "arc", "none", "withheld") if t6.get(w))
                     + ".</p>")
    quick = f"""<div class="ap-quick" id="quick-answer">
    <p><b>Quick answer.</b> The 2026 PLC effective reference price for {esc(x['lc'])} is <b>{pf(c6, c6['erp']['erp'])}{u}</b> (FSA). PLC pays when the national
    season-average price ends below that; the loan rate, {pf(c6, c6['loan'])}{u}, is as low as the price counts. ARC-CO pays when county revenue falls below 90% of
    benchmark revenue, figured at the 2026 benchmark price of <b>{pf(c6, c6['bp']['value'])}{u}</b>.</p>
    {proj}
    <p>{y7}</p>
    {verdict_p}
    <p class="ap-small">Prices in dollars per {word(c6)}, FSA&rsquo;s unit for {esc(x['lc'])}. {x.get('note', '')} {B.asof(D['_xtab_date'], 'FSA tables as of')}</p>
  </div>"""
    # states and counties
    st_html = []
    for st, S, cs in cc:
        links = " &middot; ".join(f'<a href="/arc-plc/{S["slug"]}/{c["s"]}#{k}">{esc(re.sub(r" (County|Parish|Borough)$", "", c["n"]))}</a>' for c, _es in cs)
        st_html.append(f'<details class="ap-det"><summary>{esc(S["n"])} ({len(cs):,} {"county" if len(cs) == 1 else "counties"})</summary>'
                       f'<p class="ap-states">{links}</p><p class="ap-small"><a href="/arc-plc/{S["slug"]}">{esc(S["n"])}: every crop by county</a></p></details>')
    faq_html = "".join(f"<details><summary>{esc(qq)}</summary><p>{esc(a)}</p></details>" for qq, a in faq)
    others = " &middot; ".join(f'<a href="{hub_path(j)}">{esc(XCROPS[j]["label"])}</a>' for j in D.get("_hubs", []) if j != k)
    srcs = "".join(f'<li><a href="{esc(v[1])}" rel="noopener">{esc(v[0])}</a></li>' for v in TABLE_URLS.values())
    srcs += f'<li><a href="{esc(B.FSA_DATA)}" rel="noopener">{esc(B.SRC["FSADATA"][0])}</a></li><li>{B.src_link("FR26")}</li><li>{B.src_link("CFR")}</li>'
    if sc and sc.get("usda_src", "").startswith("USDA WASDE"):
        srcs += f"<li>{B.src_link('WASDE')}</li>"
    math7 = erp_math_x(c7, 2027) if c7 else f'<p class="ap-math"><b>2027.</b> {pend7}</p>'
    body = f"""
<body>
{hdr}
<main class="ap-wrap" id="main">
  {B.bc_html([("Home", "/"), ("ARC or PLC", "/arc-plc"), (x["label"], None)])}
  <p class="page-kicker">Farm program &middot; {esc(x['lc'])}</p>
  <h1>{esc(x['label'])}: ARC or PLC for 2026 and 2027</h1>
  {B.byline_html(D)}
  <h2 class="ap-find-h">Find your county&rsquo;s short answer</h2>
  {B.picker_html(D)}
  {B.deadlines_html()}
  {quick}
  <p><a class="btn btn-secondary" href="/arc-plc?crop={k}#calculator">Run {esc(x['lc'])} in the calculator</a></p>
  <h2 id="erp">How the {esc(x['lc'])} prices are figured</h2>
  <p>The effective reference price is the lesser of 115% of the statutory price, or the greater of the statutory price and 88% of the Olympic average
  season-average price for the five most recent crop years (2020 to 2024 for 2026; 2021 to 2025 for 2027). The ARC-CO benchmark price uses the same
  five years, each raised to at least the effective reference price.</p>
  {erp_math_x(c6, 2026)}
  {math7}
  <p class="ap-small">2026 figures are FSA&rsquo;s and match our math from FSA&rsquo;s own price column. 2027 is our math (est.); FSA publishes the official figures.</p>
  <h2 id="counties">{esc(x['label'])} ARC-CO benchmarks by county</h2>
  <p>FSA&rsquo;s official 2026 county file has a {esc(x['lc'])} benchmark yield for {n_c:,} counties in {len(cc)} {"state" if len(cc) == 1 else "states"}.
  Each county page shows the benchmark, the five yields behind it, the yield where ARC-CO starts to pay and the PLC vs ARC-CO break-even.</p>
  {''.join(st_html)}
  <h2 id="faq">Questions about {esc(x['lc'])}</h2>
  <div class="ap-faq">{faq_html}</div>
  <p class="ap-disc"><b>This is an estimate, not a USDA determination.</b> <a href="{B.FSA_PAGE}" rel="noopener">FSA ARC/PLC</a> &middot;
  <a href="{B.FSA_DATA}" rel="noopener">FSA program data</a> &middot; <a href="{B.OFFICE}" rel="noopener">Find your county office</a>. Dollars are before the 5.7% sequestration cut.</p>
  <details class="ap-det"><summary>Sources</summary><ul class="ap-src">{srcs}</ul></details>
  <h2>Other crops</h2>
  <p class="ap-states"><a href="/arc-plc">Corn, soybeans and wheat</a> &middot; {others}</p>
</main>
"""
    page = B.head(title, desc, path, jsonld, True, fonts) + body + B.tail(ftr)
    return page, {"path": path, "indexable": True, "title": title, "desc": desc, "n": n_c}


def other_crops_table(D):
    """Main page: every other covered crop, from FSA's tables, with the 2027 estimate where it can be made."""
    rows = []
    for k in XCROPS:
        c6 = D["years"]["2026"]["crops"].get(k)
        if not c6:
            continue
        c7 = D["years"]["2027"]["crops"].get(k)
        sc = c6.get("scen") or {}
        rows.append(f'<tr><th scope="row"><a href="{hub_path(k)}">{XCROPS[k]["label"]}</a></th><td>{c6["unit"]}</td>'
                    f'<td class="num">{pf(c6, c6["erp"]["erp"])}</td><td class="num">{pf(c7, c7["erp"]["erp"]) + " est." if c7 else "waits on 2025/26 price"}</td>'
                    f'<td class="num">{pf(c6, c6["bp"]["value"])}</td><td class="num">{pf(c6, c6["statutory"])}</td><td class="num">{pf(c6, c6["loan"])}</td>'
                    f'<td class="num">{pf(c6, sc["center"]) if sc else ""}</td></tr>')
    if not rows:
        return ""
    return (f'<h2 id="other-crops">Every other covered crop</h2>'
            f'<p>FSA&rsquo;s 2026 tables, in FSA&rsquo;s own units (dollars per bushel or per pound). Each crop has a page with its county benchmarks.</p>'
            f'<div class="ap-scroll"><table class="tbl ap-t"><thead><tr><th>Crop</th><th>Unit</th><th class="num">2026 ERP</th><th class="num">2027 ERP</th>'
            f'<th class="num">2026 ARC price</th><th class="num">Statutory</th><th class="num">Loan rate</th><th class="num">USDA proj. 2026/27</th></tr></thead>'
            f'<tbody>{"".join(rows)}</tbody></table></div>'
            f'<p class="ap-small">ERP = PLC effective reference price. ARC price = ARC-CO benchmark price. 2026 figures are FSA&rsquo;s (table of '
            f'{nice(D["_xtab_date"])}) and match our math from FSA&rsquo;s price column. 2027 est. is our math from FSA&rsquo;s final prices; where FSA still shows '
            f'the 2025/26 price as projected and the answer depends on it, the 2027 figure waits. USDA proj.: WASDE for sorghum, barley, oats and long grain rice; '
            f'FSA&rsquo;s table for the rest. No pick is given for these crops yet: FSA&rsquo;s price table starts with 2020/21, too few years for the scenarios.</p>')


def state_crops_line(D, S):
    """State page: links to the hub of every other crop FSA lists in the state."""
    ks = [k for k in XCROPS if k in D.get("_hubs", []) and any(any(e["by"] for e in c["k"].get(k, [])) for c in S["c"])]
    if not ks:
        return ""
    return ('<p class="ap-small">Other crops with FSA benchmarks here: '
            + " &middot; ".join(f'<a href="{hub_path(k)}">{XCROPS[k]["label"]}</a>' for k in ks) + ".</p>")


LLMS_PREFIX3 = "- [ARC or PLC by crop](https://agsist.com/arc-plc/sorghum):"


def llms_line(D):
    hubs = D.get("_hubs", [])
    if not hubs:
        return None
    y6 = D["years"]["2026"]["crops"]
    eg = ", ".join(f"{XCROPS[k]['lc']} {pf(y6[k], y6[k]['erp']['erp'])}{per(y6[k])}" for k in ("sorghum", "peanuts", "rice_long") if k in hubs)
    return (f"{LLMS_PREFIX3} pages for {len(hubs)} more covered commodities ({', '.join(XCROPS[k]['lc'] for k in hubs)}) at /arc-plc/<crop>, "
            f"with FSA's 2026 effective reference prices and benchmark prices in FSA's units (e.g. {eg}), the 2027 estimate where FSA's final prices allow it, "
            f"and links to every county where FSA has a benchmark for that crop")


def llms_merge(text, D, prefixes):
    """Put the by-crop line right after build_arc_plc's own ARC/PLC lines."""
    if text is None:
        return None
    ln3 = llms_line(D)
    lines = [ln for ln in text.split("\n") if not ln.startswith(LLMS_PREFIX3)]
    if not ln3:
        return "\n".join(lines)
    at = max((i for i, ln in enumerate(lines) if ln.startswith(prefixes)), default=None)
    if at is None:
        return "\n".join(lines)
    return "\n".join(lines[:at + 1] + [ln3] + lines[at + 1:])
