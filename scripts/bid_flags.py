#!/usr/bin/env python3
"""Flags for bad rows in the daily bid snapshots (rule set bidflags-v1, 2026-10-29).

WHY
---
The bid snapshots on the raw branch (scripts/bid_snapshots.py) are never
rewritten. The Oct 29 data check (feedbag notes/audits/bids-dq-2026-10-29.md)
found that every bad row in them came from the old Barchart feed, Jun 9 to
Oct 9: fetch_bids.py divided a basis by 100 only when it was 5 or more, so a
1 to 4.75 cent basis was stored as $1 to $4.75 (2,678 rows); soybean meal was
filed as soybeans; a cash price of 0 meant "no price"; one board put its price
in the basis column. The live network rows are clean: every one that quotes
its own futures price has cash - basis equal to that price within a cent.

So the raw files stay as they are and a flags file beside each day says which
rows are not to be used:

    bids-daily-flags/YYYY/YYYY-MM-DD.csv     one per snapshot day, header only
                                             when nothing is flagged (checked,
                                             clean) as against no file (not
                                             checked yet)

Readers skip a flagged row (scripts/basis_ledger.py from rule set v2, the
in-house stock tests). Nothing is rescaled or repaired: a flagged row is out.

THE RULES (each row against that day's snapshot only; the first that fits wins)
------------------------------------------------------------------------------
Only the bushel crops (corn, soybeans, wheat, sorghum, oats) are checked.
Reference futures for a row: its own quoted futures price when it has one
(and passed the identity check); else, for its crop and contract (as the row
writes it) on the day, the middle of the futures prices boards quoted (3 or more rows), else the
middle of cash - basis over rows with a basis of $1.50 or less either way
(5 or more rows). No reference: the checks that need one are not made.
  identity          the row quotes its own futures price and cash - basis is
                    more than a cent away from it (the network check).
  meal_as_soybeans  a soybean row whose contract is meal or oil (ZM, ZL, @SM,
                    @BO) or whose name says meal, oil or hulls.
  cash_out_of_range a cash price under $1 (0 is "no price") or over $30.
  basis_in_cents    a basis of 1 or more that is cents read as dollars: cash
                    minus basis/100 is within 15 cents of the reference and
                    cash minus basis is more than 50 cents off it.
  price_in_basis    a basis over 3 that is a price: within $2 of the
                    reference, or with no reference under cash / 1.7.
  implied_off       cash - basis more than $1 from the reference, or a basis
                    over $3 either way more than 20 cents from it.
  wide_unchecked    a basis over $3 either way on a day with no reference.
A wide basis that does agree with the reference (Ontario boards in Canadian
dollars) is not flagged.

USAGE
-----
  python3 scripts/bid_flags.py build [--day D ...] [--dir DIR | --ref origin/raw] [--out-dir .]
      writes the flags file of every snapshot day (or the days named) whose
      file is missing or differs. Same snapshot, same bytes: a rerun is "no change".
  python3 scripts/bid_flags.py --selftest
In Python: flag_rows(rows), flagged_keys(rows), row_key(row), read_flags(bytes).
"""
import argparse
import csv
import io
import os
import re
import statistics
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import bid_snapshots as BS       # noqa: E402  the snapshot reader (one copy)

RULES = {
    "version": "bidflags-v1",
    "registered": "2026-10-29",
    "crops": ["corn", "soybeans", "wheat", "sorghum", "oats"],
    "identity_dollars": 0.01,
    "ref_quoted_min": 3,
    "ref_implied_min": 5,
    "ref_implied_max_basis": 1.5,
    "cash_min": 1.0,
    "cash_max": 30.0,
    "cents_match": 0.15,
    "cents_miss": 0.50,
    "wide_basis": 3.0,
    "wide_agree": 0.20,
    "implied_off": 1.0,
    "price_ref_within": 2.0,
    "price_cash_ratio": 1.7,
}
CODES = ("identity", "meal_as_soybeans", "cash_out_of_range", "basis_in_cents", "price_in_basis",
         "implied_off", "wide_unchecked")
DIR = "bids-daily-flags"
COLS = ["place", "commodity", "delivery", "start", "end", "futures", "locId", "cash", "basis", "ref", "reason", "rules"]
EPS = 1e-9
MEAL_SYM = re.compile(r"^(ZM|ZL|@SM|@BO)", re.I)
MEAL_NAME = re.compile(r"\b(meal|oil|hulls?)\b", re.I)


def path_for(day):
    return f"{DIR}/{day[:4]}/{day}.csv"


def _s(v):
    return "" if v is None else str(v)


def _num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and v == v


def row_key(r):
    """One row of one snapshot: (place, commodity, delivery, start, end, futures). place is the
    snapshot's facility|branch|city|state key, which is one location (a permanent id can
    cover two places, so it is written beside the key, never instead of it)."""
    return (r["key"], _s(r.get("commodity")), _s(r.get("delivery")), _s(r.get("start")), _s(r.get("end")),
            _s(r.get("futures")))


def _fut(r):
    return " ".join(str(r.get("futures") or "").upper().split())


def references(rows):
    """{(crop, contract): (price, 'quoted' | 'implied')} for the day."""
    q, imp = {}, {}
    for r in rows:
        fu = _fut(r)
        if not fu:
            continue
        k = (r.get("category"), fu)
        if _num(r.get("futuresPrice")):
            q.setdefault(k, []).append(r["futuresPrice"])
        c, b = r.get("cash"), r.get("basis")
        if _num(c) and _num(b) and abs(b) <= RULES["ref_implied_max_basis"]:
            imp.setdefault(k, []).append(c - b)
    out = {}
    for k in set(q) | set(imp):
        if len(q.get(k, ())) >= RULES["ref_quoted_min"]:
            out[k] = (statistics.median(q[k]), "quoted")
        elif len(imp.get(k, ())) >= RULES["ref_implied_min"]:
            out[k] = (statistics.median(imp[k]), "implied")
    return out


def reason(r, ref):
    """The flag code for one row, or None. ref: (price, kind) or None."""
    if r.get("category") not in RULES["crops"]:
        return None
    c, b, f = r.get("cash"), r.get("basis"), r.get("futuresPrice")
    if _num(c) and _num(b) and _num(f) and abs(c - b - f) > RULES["identity_dollars"] + EPS:
        return "identity"
    if r.get("category") == "soybeans" and (MEAL_SYM.match(_fut(r)) or MEAL_NAME.search(str(r.get("commodity") or ""))):
        return "meal_as_soybeans"
    if _num(c) and (c < RULES["cash_min"] or c > RULES["cash_max"]):
        return "cash_out_of_range"
    if not (_num(c) and _num(b)):
        return None
    rf = ref[0] if ref else None
    if _num(f):
        rf = f                    # passed the identity check above: the row's own futures is its reference
    wide = abs(b) > RULES["wide_basis"]
    if rf is not None and abs(b) >= 1 and abs(c - b / 100 - rf) <= RULES["cents_match"] + EPS \
            and abs(c - b - rf) > RULES["cents_miss"]:
        return "basis_in_cents"
    if b > RULES["wide_basis"] and ((rf is not None and abs(b - rf) < RULES["price_ref_within"])
                                    or (rf is None and c > RULES["price_cash_ratio"] * b)):
        return "price_in_basis"
    if rf is not None:
        off = abs(c - b - rf)
        if off > RULES["implied_off"] or (wide and off > RULES["wide_agree"] + EPS):
            return "implied_off"
        return None
    if wide:
        return "wide_unchecked"
    return None


def flag_rows(rows):
    """[(row, code, ref price or None)] for every flagged row of one day's rows (flat dicts)."""
    refs = references(rows)
    out = []
    for r in rows:
        ref = refs.get((r.get("category"), _fut(r)))
        code = reason(r, ref)
        if code:
            out.append((r, code, ref[0] if ref else None))
    return out


def flagged_keys(rows):
    """{row_key: code} for one day's rows."""
    return {row_key(r): code for r, code, _ in flag_rows(rows)}


def flags_csv(rows):
    """The flags file for one day's rows, as bytes. Stable order: same rows, same bytes."""
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(COLS)
    lines = []
    for r, code, ref in flag_rows(rows):
        lines.append(list(row_key(r)) + [_s(r.get("locId")), _s(r.get("cash")), _s(r.get("basis")),
                                         "" if ref is None else f"{ref:.4f}", code, RULES["version"]])
    for line in sorted(lines):
        w.writerow(line)
    return buf.getvalue().encode("utf-8")


def read_flags(data):
    """{row_key: code} from a flags file's bytes."""
    out = {}
    for rec in csv.DictReader(io.StringIO(data.decode("utf-8"))):
        out[tuple(rec[c] for c in COLS[:6])] = rec["reason"]
    return out


def build(days, dir=None, ref=BS.RAW_REF, out_dir=ROOT, log=print):
    """Write the flags file of each day whose file is missing or differs. -> (written, counts by code)."""
    n, by = 0, {}
    for d in days:
        rows = BS.load_day(d, dir=dir, ref=ref)
        data = flags_csv(rows)
        for code in read_flags(data).values():
            by[code] = by.get(code, 0) + 1
        p = os.path.join(out_dir, path_for(d))
        old = None
        if os.path.exists(p):
            with open(p, "rb") as f:
                old = f.read()
        elif dir and os.path.exists(os.path.join(dir, path_for(d))):
            with open(os.path.join(dir, path_for(d)), "rb") as f:
                old = f.read()
        elif not dir:
            r = BS._git("show", f"{ref}:{path_for(d)}", text=False)
            old = r.stdout if r.returncode == 0 else None
        if old == data:
            continue
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "wb") as f:
            f.write(data)
        n += 1
    log(f"[bid-flags] {len(days)} day(s) checked, {n} file(s) written; flagged rows by reason: "
        + (", ".join(f"{k} {v}" for k, v in sorted(by.items())) or "none"))
    return n, by


# ------------------------------------------------------------------ selftest
def _row(day_ix, **kw):
    r = {"locId": None, "key": "X|||IA", "commodity": "Corn", "category": "corn", "delivery": "Sep26",
         "start": None, "end": None, "cash": 4.0, "basis": -0.3, "futures": "ZCU26", "futuresPrice": None,
         "src": "barchart"}
    r.update(kw)
    return r


def selftest():
    fails = []

    def ck(name, ok):
        print(("ok   " if ok else "FAIL ") + name)
        if not ok:
            fails.append(name)

    # REAL ROWS from the Oct 29 check (flagged2.csv, raw bids-daily/2026), each with the day's
    # reference beside it. Five clean rows give the day an implied reference.
    corn = [_row(0, locId=f"e{i}", cash=4.28 - b, basis=-b) for i, b in enumerate((0.20, 0.25, 0.30, 0.35, 0.40))]
    beans = [_row(0, locId=f"s{i}", commodity="Soybeans", category="soybeans", futures="ZSX26",
                  cash=11.32 - b, basis=-b) for i, b in enumerate((0.40, 0.50, 0.60, 0.70, 0.80))]
    sw = [_row(0, locId=f"w{i}", commodity="Spring Wheat", category="wheat", futures="MWN26",
               cash=6.18 - b, basis=-b) for i, b in enumerate((0.30, 0.40, 0.50, 0.60, 0.70))]
    hrw = [_row(0, locId=f"h{i}", commodity="Wheat", category="wheat", futures="N26",
                cash=6.18 - b, basis=-b) for i, b in enumerate((0.40, 0.50, 0.60, 0.70, 0.80))]
    # 2026-06-09 Consolidated Grain & Barge, Sherrill AR: corn Sep26 cash 4.29 basis 1.0 (1 cent), ref 4.28
    cgb = _row(0, locId="eprh140n9t", cash=4.29, basis=1.0)
    # same day, beans Nov26 cash 11.33 basis 1.0 against ZSX26 11.32
    cgb_b = _row(0, locId="eprh140n9t", commodity="Beans", category="soybeans", delivery="Nov26", futures="ZSX26",
                 cash=11.33, basis=1.0)
    # 2026-06-09 ADM Grain, Frankfort IN: Soybean Meal Jun26 cash 3.411 basis 40.0 on ZMN26
    meal = _row(0, locId="et0sjz6e3a", commodity="Soybean Meal", category="soybeans", delivery="Jun26",
                futures="ZMN26", cash=3.411, basis=40.0)
    # 2026-06-09 Five Star Cooperative, Lime Springs IA: soybeans cash 0.0 basis -11.32
    zero = _row(0, locId="ez1k62rqbb", commodity="Soybeans", category="soybeans", delivery="Nov26",
                futures="ZSX26", cash=0.0, basis=-11.32)
    # 2026-06-09 Ritzville Warehouse Co, WA: spring wheat Jun26 cash 12.28 basis 6.1 (MWN26 ref 6.18)
    ritz = _row(0, locId="emgwjnydqf", commodity="Spring Wheat", category="wheat", delivery="Jun26",
                futures="MWN26", cash=12.28, basis=6.1)
    # 2026-06-09 Frontier Cooperative, Elmwood NE: Wheat - HRW Jul26 cash 10.28 basis -0.86 on N26 (ref 6.18)
    fron = _row(0, locId="e69y7nywnv", commodity="Wheat - HRW", category="wheat", delivery="Jul26",
                futures="N26", cash=10.28, basis=-0.86)
    # a network row that quotes its own futures: clean to the cent, and one a cent and a half off
    net = _row(0, locId="enet", src="network", cash=3.85, basis=-0.45, futures="ZCZ26", futuresPrice=4.30)
    netbad = dict(net, locId="enet2", cash=3.865)
    # a real wide basis (-$1.00 wheat) that agrees with the reference is not a unit error
    wide_ok = _row(0, locId="ewide", commodity="Wheat", category="wheat", futures="N26", cash=5.18, basis=-1.0)
    # Pomeroy Grain, WA (2026-07-30): wheat -4.0 on U26, cash 7.08, ref 6.73
    pom = [_row(0, locId=f"u{i}", commodity="Wheat", category="wheat", futures="U26", cash=6.73 - b, basis=-b)
           for i, b in enumerate((0.3, 0.4, 0.5, 0.6, 0.7))]
    pomeroy = _row(0, locId="e2fegmr7pm", commodity="Wheat 10.5%", category="wheat", futures="U26",
                   cash=7.08, basis=-4.0)
    # Ontario soybeans in Canadian dollars: wide and consistent, not flagged
    ont = _row(0, locId="eon", commodity="Soybeans", category="soybeans", futures="ZSX26", cash=15.0, basis=3.68)
    canola = _row(0, locId="ecan", commodity="Canola", category="other", futures="RSX26", cash=20.0, basis=9.0)
    rows = corn + beans + sw + hrw + pom + [cgb, cgb_b, meal, zero, ritz, fron, net, netbad, wide_ok, pomeroy, ont, canola]
    got = {r["locId"]: code for r, code, _ in flag_rows(rows)}
    ck("CGB Sherrill corn: 1 cent read as $1.00 -> basis_in_cents", got.get("eprh140n9t") == "basis_in_cents")
    ck("CGB Sherrill beans too", [c for r, c, _ in flag_rows(rows) if r is cgb_b] == ["basis_in_cents"])
    ck("ADM Frankfort soybean meal -> meal_as_soybeans", got.get("et0sjz6e3a") == "meal_as_soybeans")
    ck("Five Star cash 0 -> cash_out_of_range", got.get("ez1k62rqbb") == "cash_out_of_range")
    ck("Ritzville price in the basis column -> price_in_basis", got.get("emgwjnydqf") == "price_in_basis")
    ck("Frontier Elmwood $10.28 wheat on a $6.18 contract -> implied_off", got.get("e69y7nywnv") == "implied_off")
    ck("Pomeroy -4.0 wheat -> implied_off", got.get("e2fegmr7pm") == "implied_off")
    ck("a network row equal to its own futures is clean", "enet" not in got)
    ck("a network row 1.5 cents off its own futures -> identity", got.get("enet2") == "identity")
    ck("a real -$1.00 wheat basis is not flagged", "ewide" not in got)
    ck("Ontario wide but consistent basis is not flagged", "eon" not in got)
    ck("non-bushel crops are not checked", "ecan" not in got)
    ck("the reference rows themselves are clean", not any(k in got for k in ("e0", "s0", "w0", "h0", "u0")))
    ck("every code is a known one", set(got.values()) <= set(CODES))
    ref = references(rows)
    ck("implied reference: middle of cash - basis", abs(ref[("corn", "ZCU26")][0] - 4.28) < 1e-9
       and ref[("corn", "ZCU26")][1] == "implied")
    q = [_row(0, locId=f"q{i}", futures="ZCZ26", futuresPrice=4.30, cash=4.0, basis=-0.30, src="network") for i in range(3)]
    ck("three quoted prices make a quoted reference", references(q)[("corn", "ZCZ26")] == (4.30, "quoted"))
    ck("no reference: a 1.0 basis is left alone (unsure, not flagged)",
       flag_rows([_row(0, locId="lone", cash=4.29, basis=1.0)]) == [])
    ck("no reference: a basis over $3 is wide_unchecked",
       [c for _, c, _ in flag_rows([_row(0, locId="lone", cash=4.29, basis=-3.5)])] == ["wide_unchecked"])
    data = flags_csv(rows)
    ck("same rows, same bytes", flags_csv(list(reversed(rows))) == data)
    back = read_flags(data)
    ck("the file reads back to the same keys and codes", back == flagged_keys(rows))
    ck("a clean day is a header-only file", flags_csv(corn) == (",".join(COLS) + "\n").encode())
    ck("a row is keyed by its place, not its id (one id can cover two places)",
       row_key(_row(0, locId="e1", key="ADM|Soy|Decatur|IL"))[0] == "ADM|Soy|Decatur|IL")
    two = [dict(cgb, key="CGB|A|Sherrill|AR"), dict(cgb, key="CGB|B|Sherrill|AR")]
    ck("two places under one id stay two flagged rows in the file",
       len(read_flags(flags_csv(corn + two))) == 2)
    # Wanstead Farmers Cooperative, ON (network, 2026-08-31): soybeans @S7Q cash 17.05 basis +4.05, its own
    # futures 12.995. Alone on its contract that day (no day reference), it agrees with itself: not flagged.
    wan = _row(0, locId="ewan", commodity="Soybeans", category="soybeans", futures="@S7Q", cash=17.05, basis=4.05,
               futuresPrice=12.995, src="network")
    ck("a wide basis that matches its own quoted futures is not flagged", flag_rows([wan]) == [])
    print("selftest: %d failure(s)" % len(fails))
    return 1 if fails else 0


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if argv[:1] == ["--selftest"]:
        return selftest()
    ap = argparse.ArgumentParser(prog="bid_flags.py")
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("build")
    s.add_argument("--day", action="append", default=[])
    s.add_argument("--dir")
    s.add_argument("--ref", default=BS.RAW_REF)
    s.add_argument("--out-dir", default=ROOT)
    a = ap.parse_args(argv)
    days = a.day or BS.list_days(dir=a.dir, ref=a.ref)
    build(days, dir=a.dir, ref=a.ref, out_dir=a.out_dir)
    return 0


if __name__ == "__main__":
    sys.exit(main())
