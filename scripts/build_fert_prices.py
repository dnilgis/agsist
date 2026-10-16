#!/usr/bin/env python3
"""
AGSIST -- data/fertilizer-prices.json: the one fertilizer price list every
page reads (/fertilizer's cheapest box, nutrient table and calculator,
/fast-facts, /manure-value, /urea, the break-even defaults, the baked titles
and share cards).

ONE SOURCE (Sig, 2026-10-15: "just use the pricing data that i provided"):
the co-op price pages Sig sent, read by scripts/fetch_coop_fert.py into
data/fertilizer-coops.json. Nothing else feeds a price here. The USDA AMS
Illinois report stays on /fertilizer as a separate, labeled reference and is
never blended in.

Per product: the middle cash price of the co-ops that post a current price
(rows over 60 days old are already left out by the reader). With two co-ops
the middle is their average; with one, that co-op's price, named. A product
none of them posts is not listed. Nothing typed by hand, nothing carried
forward: when the co-ops stop posting a product, it drops out and the pages
say "no price".

Rows carry key, name, symbol, price ($/ton), as_of (the newest date the
co-ops show for it), src "coop", n, region, src_label ("Kansas co-ops,
middle of 4, posted Oct 6, 2026"), short_label and the link. Also per_lb
(the $/lb of N, P2O5 and K2O, with the arithmetic in words) and programs
(fertilizer $/acre for the break-even defaults, rates stated).

PRICE SHEETS BY EMAIL (Sig, 2026-10-16): a co-op price sheet Sig receives by
email (Synergy Cooperative's spring 2027 dry fertilizer list) is entered from
the sheet into data/fert-sheets/<id>.json and copied here into a separate
"sheets" list. A sheet is a booking/prepay price for a coming season, not
today's price, so it NEVER feeds prices, per_lb or programs: those stay the
co-op posted middle. A sheet drops off after its season ends or 120 days
after its sheet date, whichever comes first. A row the sheet prints as n/a
stays null (not priced), never 0. A sheet whose numbers fail a check is left
out with a note, never patched.

Run by .github/workflows/fertilizer-coops.yml after the reader, and again
inside its commit loop (scripts/fert_after_prices.sh).

  python3 scripts/build_fert_prices.py             # write
  python3 scripts/build_fert_prices.py --selftest
"""
import datetime
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
COOPS = "data/fertilizer-coops.json"
OUT = "data/fertilizer-prices.json"
SHEETS = "data/fert-sheets"
SHEET_MAX_DAYS = 120
# A sanity range per ton for any priced sheet row; outside it the sheet is
# refused (a typo like 61 or 6100), not shown.
SHEET_RANGE = (150, 2500)

# key -> page name; the order pages list them in
NAMES = {
    "urea": "Urea", "anhydrous": "Anhydrous ammonia", "uan28": "UAN 28%", "uan32": "UAN 32%",
    "dap": "DAP", "map": "MAP", "potash": "Potash", "ams": "AMS", "10-34-0": "10-34-0", "thiosul": "Thio-Sul",
}
# Removal-based rates per bushel used for the crop programs below, the same
# ones as the fertility-bill calculator on fertilizer.html (CROPS there):
# corn 0.90 lb N, 0.37 lb P2O5, 0.24 lb K2O a bushel; soybeans 0 N (they fix
# their own), 0.80 P2O5, 1.30 K2O; wheat 1.20 N, 0.50 P2O5, 0.30 K2O. The
# yields are breakeven.html's defaults. A stated assumption, not advice: soil
# tests and your own rates beat it.
PROGRAMS = {
    "corn": {"yield": 180, "per_bu": (0.90, 0.37, 0.24)},
    "soybeans": {"yield": 55, "per_bu": (0.0, 0.80, 1.30)},
    "wheat": {"yield": 70, "per_bu": (1.20, 0.50, 0.30)},
}
MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
STATE_NAMES = {"IA": "Iowa", "IL": "Illinois", "IN": "Indiana", "KS": "Kansas", "MN": "Minnesota", "MO": "Missouri",
               "ND": "North Dakota", "NE": "Nebraska", "OK": "Oklahoma", "SD": "South Dakota", "TX": "Texas", "CO": "Colorado"}


def short(iso):
    d = datetime.date.fromisoformat(iso)
    return "%s %d, %d" % (MON[d.month - 1], d.day, d.year)


def read_json(path):
    try:
        return json.loads(Path(path).read_text())
    except (OSError, ValueError):
        return None


def region(states):
    names = [STATE_NAMES.get(s, s) for s in sorted(set(states))]
    return names[0] if len(names) == 1 else ", ".join(names[:-1]) + " and " + names[-1]


def build(coops, today, sheets=None):
    coops = coops or {}
    by_id = {c["id"]: c for c in coops.get("coops") or []}
    rows, notes = {}, []
    for p in coops.get("summary") or []:
        k = p.get("key")
        if k not in NAMES or not p.get("newest") or not p.get("n"):
            if k in NAMES:
                notes.append("%s: no co-op shows a date for it; not used" % k)
            continue
        n = p["n"]
        if n >= 2:
            price = p["median"] if p.get("median") is not None else round((p["low"] + p["high"]) / 2, 2)
        else:
            price = p["low"]
        reg = region([(by_id.get(c) or {}).get("state") or "?" for c in p.get("coops") or []])
        when = short(p["newest"])
        if n == 1:
            c = by_id.get(p["coops"][0]) or {}
            label = "%s, %s, posted %s" % (c.get("name", "one co-op"), reg, when)
            sl = "%s, %s" % (c.get("name", "one co-op"), when[:-6])
        else:
            label = "%s co-ops, %s of %d, posted %s" % (reg, "average" if n == 2 else "middle", n, when)
            sl = "%s co-ops, %s" % (reg, when[:-6])
        rows[k] = {"key": k, "name": NAMES[k], "symbol": p["symbol"], "price": price, "unit": "$/ton",
                   "as_of": p["newest"], "src": "coop", "n": n, "low": p["low"], "high": p["high"], "region": reg,
                   "coops": p.get("coops") or [], "src_label": label, "short_label": sl,
                   "url": "https://agsist.com/fertilizer#fert-coops-more-h"}
    prices = [rows[k] for k in NAMES if k in rows]
    per_lb = nutrient_prices(rows)
    sheet_list, sheet_notes = build_sheets(sheets or [], rows, today)
    notes += sheet_notes
    return {
        "note": "Built by scripts/build_fert_prices.py from data/fertilizer-coops.json only: the middle cash price of "
                "the co-ops that post each product (two co-ops: their average; one: that co-op, named). "
                "Nothing typed by hand, no other source blended in.",
        "updated": max((r["as_of"] for r in prices), default=None),
        "prices": prices,
        "per_lb": per_lb,
        "programs": programs(per_lb),
        "sheets": sheet_list,
        "notes": notes,
    }


def check_sheet(sh):
    """The reasons a sheet cannot be shown ([] when it can)."""
    bad = []
    for f in ("id", "coop", "region", "how_received", "sheet_date", "season", "season_end"):
        if not isinstance(sh.get(f), str) or not sh.get(f):
            bad.append("no %s" % f)
    for f in ("sheet_date", "season_end"):
        try:
            datetime.date.fromisoformat(sh.get(f) or "")
        except (TypeError, ValueError):
            bad.append("%s is not a date" % f)
    rws = sh.get("rows")
    if not isinstance(rws, list) or not rws:
        return bad + ["no rows"]
    priced = 0
    for r in rws:
        lab = str(r.get("raw") or "?")
        if not r.get("raw"):
            bad.append("a row with no label")
        for b in ("cash", "charge"):
            v = r.get(b)
            if v is None:
                continue
            if isinstance(v, bool) or not isinstance(v, (int, float)) or not (SHEET_RANGE[0] <= v <= SHEET_RANGE[1]):
                bad.append("%s %s %r is outside $%d to $%d a ton" % (lab, b, v, SHEET_RANGE[0], SHEET_RANGE[1]))
        if isinstance(r.get("cash"), (int, float)) and isinstance(r.get("charge"), (int, float)) and r["charge"] < r["cash"]:
            bad.append("%s charge is below cash" % lab)
        if r.get("cash") is not None or r.get("charge") is not None:
            priced += 1
    if not priced:
        bad.append("no priced row")
    return bad


def build_sheets(sheets, rows, today):
    """The "sheets" list: each current sheet as entered, plus $/lb of N for a
    priced straight-N row and today's co-op middle for the same product, side
    by side and never blended. Newest sheet first."""
    out, notes = [], []
    for sh in sheets:
        sid = sh.get("id") or "?"
        bad = check_sheet(sh)
        if bad:
            notes.append("price sheet %s left out: %s" % (sid, "; ".join(bad)))
            continue
        d = datetime.date.fromisoformat(sh["sheet_date"])
        end = datetime.date.fromisoformat(sh["season_end"])
        until = min(end, d + datetime.timedelta(days=SHEET_MAX_DAYS))
        if today > until:
            notes.append("price sheet %s dropped off: past %s" % (sid, until.isoformat()))
            continue
        if d > today:
            notes.append("price sheet %s left out: dated after today" % sid)
            continue
        srows = []
        for r in sh["rows"]:
            x = {"key": r.get("key"), "raw": r["raw"], "symbol": r.get("symbol"),
                 "cash": r.get("cash"), "charge": r.get("charge"), "changed": bool(r.get("changed"))}
            x["priced"] = x["cash"] is not None or x["charge"] is not None
            g = grade(x["symbol"])
            if x["priced"] and g and g[0] > 0 and g[1] == 0 and g[2] == 0:
                lb = 2000 * g[0] / 100
                x["per_lb_n"] = {b: round(x[b] / lb, 4) for b in ("cash", "charge") if x[b] is not None}
                x["per_lb_n"]["lb_n_per_ton"] = round(lb, 1)
            today_row = rows.get(x["key"]) if x["key"] else None
            if x["priced"] and today_row:
                x["today"] = {"name": today_row["name"], "price": today_row["price"], "as_of": today_row["as_of"],
                              "src_label": today_row["src_label"], "short_label": today_row["short_label"],
                              "region": today_row["region"]}
            srows.append(x)
        label = "%s, %s, %s price sheet dated %s (%s)" % (sh["coop"], sh["region"], sh["season"], short(sh["sheet_date"]), sh["how_received"])
        out.append({"id": sid, "coop": sh["coop"], "region": sh["region"], "state": sh.get("state"),
                    "how_received": sh["how_received"], "title": sh.get("title"), "sheet_date": sh["sheet_date"],
                    "season": sh["season"], "season_end": sh["season_end"], "show_until": until.isoformat(),
                    "applies": sh.get("applies"), "unit": "$/ton", "rows": srows,
                    "star_note": sh.get("star_note"), "notes": list(sh.get("notes") or []),
                    "label": label, "src": "price-sheet"})
    out.sort(key=lambda x: x["sheet_date"], reverse=True)
    return out, notes


def read_sheets(root):
    out = []
    for f in sorted((Path(root) / SHEETS).glob("*.json")):
        d = read_json(f)
        out.append(d if isinstance(d, dict) else {"id": f.stem, "rows": None})
    return out


def grade(sym):
    a = str(sym or "").split("-")
    try:
        return float(a[0]), float(a[1]), float(a[2])
    except (IndexError, ValueError):
        return None


def nutrient_prices(rows):
    """$/lb of N (urea), P2O5 (MAP, else DAP, with its N credited at the urea
    price) and K2O (potash), each with the words that show the arithmetic.
    The same math as components/manure-value.js nutrientPrices();
    test/manure-value.test.mjs checks the two agree on this file."""
    out = {}
    u = rows.get("urea")
    gu = grade(u["symbol"]) if u else None
    if u and gu and gu[0] > 0:
        v = u["price"] / (2000 * gu[0] / 100)
        out["n"] = {"usd": round(v, 4), "from": "urea", "as_of": u["as_of"],
                    "how": "urea $%.2f a ton / (2,000 lb x %g%% N) = $%.2f a lb of N (%s)" % (u["price"], gu[0], v, u["src_label"])}
    ph = rows.get("map") or rows.get("dap")
    gp = grade(ph["symbol"]) if ph else None
    if ph and gp and gp[1] > 0 and "n" in out:
        nlb = 2000 * gp[0] / 100
        credit = nlb * out["n"]["usd"]
        v = (ph["price"] - credit) / (2000 * gp[1] / 100)
        out["p"] = {"usd": round(v, 4), "from": ph["key"], "as_of": ph["as_of"],
                    "how": "%s $%.2f a ton, less %d lb of N at the urea price ($%.0f), / %d lb of P2O5 = $%.2f a lb of P2O5 (%s)"
                           % (ph["name"], ph["price"], nlb, credit, 2000 * gp[1] / 100, v, ph["src_label"])}
    k = rows.get("potash")
    gk = grade(k["symbol"]) if k else None
    if k and gk and gk[2] > 0:
        v = k["price"] / (2000 * gk[2] / 100)
        out["k"] = {"usd": round(v, 4), "from": "potash", "as_of": k["as_of"],
                    "how": "potash $%.2f a ton / (2,000 lb x %g%% K2O) = $%.2f a lb of K2O (%s)" % (k["price"], gk[2], v, k["src_label"])}
    return out


def programs(per_lb):
    """Fertilizer $/acre for each crop's default yield at the stated rates.
    None for a crop when a nutrient it needs has no price: never a guess."""
    out = {}
    for crop, p in PROGRAMS.items():
        lbs = [round(p["yield"] * r) for r in p["per_bu"]]
        need = [x for x, lb in zip("npk", lbs) if lb > 0]
        if any(x not in per_lb for x in need):
            out[crop] = None
            continue
        usd = sum(lb * per_lb[x]["usd"] for x, lb in zip("npk", lbs) if lb > 0)
        out[crop] = {"yield": p["yield"], "n_lb": lbs[0], "p_lb": lbs[1], "k_lb": lbs[2],
                     "per_acre": round(usd), "as_of": max(per_lb[x]["as_of"] for x in need)}
    return out


def write(root=ROOT, today=None):
    """Writes every run, with a fresh `generated`, so the status page can tell
    a list that was checked today from one nobody rebuilt (the prices
    themselves only move when a co-op moves)."""
    root = Path(root)
    today = today or datetime.datetime.now(datetime.timezone.utc).date()
    doc = build(read_json(root / COOPS), today, read_sheets(root))
    old = read_json(root / OUT)
    changed = not old or {k: v for k, v in old.items() if k != "generated"} != doc
    doc = dict(doc, generated=datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))
    tmp = root / (OUT + ".tmp")
    tmp.write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n")
    os.replace(tmp, root / OUT)
    return doc, changed


def selftest():
    fails = []

    def ck(name, cond):
        print(("  ok   " if cond else "::error::fert-prices selftest FAIL ") + name)
        if not cond:
            fails.append(name)

    sys.path.insert(0, str(ROOT / "scripts"))
    import fetch_coop_fert
    coops = fetch_coop_fert.fixture_doc()       # 3 co-op pages + the price sheet as a 4th, all Kansas
    today = datetime.date(2026, 10, 15)
    d = build(coops, today)
    by = {r["key"]: r for r in d["prices"]}
    ck("every row is a co-op price", all(r["src"] == "coop" for r in d["prices"]))
    ck("urea: the middle of 4 co-ops (608, 615.95, 630, 840 -> 622.98)", by["urea"]["price"] == 622.98 and by["urea"]["n"] == 4)
    ck("urea dated by the newest co-op date", by["urea"]["as_of"] == "2026-10-06")
    ck("label names the region, the count and the date",
       by["urea"]["src_label"] == "Kansas co-ops, middle of 4, posted Oct 6, 2026" and by["urea"]["short_label"] == "Kansas co-ops, Oct 6")
    ck("MAP: two co-ops, their average, said so", by["map"]["price"] == 980.0 and by["map"]["src_label"] == "Kansas co-ops, average of 2, posted Oct 12, 2026")
    ck("Thio-Sul: two co-ops 390 and 450, average 420", by["thiosul"]["price"] == 420.0)
    ck("UAN 32: one co-op, its price, named", by["uan32"]["price"] == 451.05 and by["uan32"]["n"] == 1
       and by["uan32"]["src_label"] == "Test sheet co-op, Kansas, posted Sep 24, 2026")
    ck("AMS: the stale Two Rivers row is out, the sheet's is in", by["ams"]["n"] == 1 and by["ams"]["price"] == 509.25)
    ck("no lime, K-Mag or MAP + sulfur", not any(k in by for k in ("lime", "kmag", "map_s")))
    ck("page order", [r["key"] for r in d["prices"]] == [k for k in NAMES if k in by])
    ck("updated is the newest as_of", d["updated"] == "2026-10-12")
    pl = d["per_lb"]
    ck("N $/lb from urea: 622.98 / 920", abs(pl["n"]["usd"] - 622.98 / 920) < 1e-4)
    ck("P $/lb from MAP (it has a price) with 220 lb N credited", abs(pl["p"]["usd"] - (980 - 220 * 622.98 / 920) / 1040) < 1e-4 and pl["p"]["from"] == "map")
    ck("K $/lb from potash 0-0-60", abs(pl["k"]["usd"] - 470.4 / 1200) < 1e-4)
    ck("the arithmetic is written out with its label",
       pl["n"]["how"] == "urea $622.98 a ton / (2,000 lb x 46% N) = $0.68 a lb of N (Kansas co-ops, middle of 4, posted Oct 6, 2026)")
    cp = d["programs"]["corn"]
    want = round(162 * pl["n"]["usd"] + 67 * pl["p"]["usd"] + 43 * pl["k"]["usd"])
    ck("corn program: 162 N, 67 P2O5, 43 K2O at 180 bu, priced", (cp["n_lb"], cp["p_lb"], cp["k_lb"]) == (162, 67, 43) and cp["per_acre"] == want)
    ck("soybeans: no N bought", d["programs"]["soybeans"]["n_lb"] == 0)
    nop = build(dict(coops, summary=[x for x in coops["summary"] if x["key"] != "potash"]), today)
    ck("no potash price: no K $/lb and no crop program, never a guess", "k" not in nop["per_lb"] and nop["programs"]["corn"] is None)
    none = build(None, today)
    ck("no co-op file: an empty list, never a typed number", none["prices"] == [] and none["updated"] is None)
    # price sheets by email: shown apart, never in prices / per_lb / programs
    sh = json.loads((ROOT / SHEETS / "synergy-2026-10-01.json").read_text())
    ws = build(coops, today, [sh])
    ck("a sheet never changes today's prices, per_lb or programs",
       all(ws[k] == d[k] for k in ("prices", "per_lb", "programs", "updated")))
    ck("no sheet: an empty sheets list", d["sheets"] == [])
    s0 = ws["sheets"][0] if ws["sheets"] else {}
    sr = {r["raw"]: r for r in s0.get("rows", [])}
    ck("Synergy sheet shown with its date, season and how it came",
       s0.get("label") == "Synergy Cooperative, Northwest Wisconsin, Spring 2027 booking price sheet dated Oct 1, 2026 (received by email)")
    ck("urea 46-0-0: cash 610, charge 628, marked changed",
       (sr["46-0-0"]["cash"], sr["46-0-0"]["charge"], sr["46-0-0"]["changed"]) == (610, 628, True))
    ck("urea $/lb N: 610 / 920 and 628 / 920",
       sr["46-0-0"]["per_lb_n"]["cash"] == round(610 / 920, 4) and sr["46-0-0"]["per_lb_n"]["charge"] == round(628 / 920, 4))
    ck("ESN-type 44-0-0 $/lb N: 800 / 880 and 824 / 880",
       sr["N-EDGE EZ (~ESN 44-0-0)"]["per_lb_n"]["cash"] == round(800 / 880, 4) and sr["N-EDGE EZ (~ESN 44-0-0)"]["per_lb_n"]["lb_n_per_ton"] == 880)
    ck("n/a rows stay null and not priced, never 0",
       all(r["cash"] is None and r["charge"] is None and not r["priced"] for k, r in sr.items() if k not in ("46-0-0", "N-EDGE EZ (~ESN 44-0-0)")))
    ck("urea set beside today's co-op middle, not blended",
       sr["46-0-0"]["today"]["price"] == 622.98 and sr["46-0-0"]["cash"] == 610)
    ck("no today line for an unpriced row or a product the co-ops do not post",
       "today" not in sr["0-0-60"] and "today" not in sr["N-EDGE EZ (~ESN 44-0-0)"])
    ck("drops off 120 days after the sheet date (before the season end)", s0.get("show_until") == "2027-01-29")
    ck("still shown on its last day", len(build(coops, datetime.date(2027, 1, 29), [sh])["sheets"]) == 1)
    late = build(coops, datetime.date(2027, 1, 30), [sh])
    ck("gone the day after, with a note", late["sheets"] == [] and any("dropped off" in n for n in late["notes"]))
    ck("gone after a season end that comes first",
       build(coops, datetime.date(2026, 11, 2), [dict(sh, season_end="2026-11-01")])["sheets"] == [])
    typo = json.loads(json.dumps(sh))
    typo["rows"][2]["cash"] = 61
    tb = build(coops, today, [typo])
    ck("a typo price is refused, the sheet left out with a note", tb["sheets"] == [] and any("outside" in n for n in tb["notes"]))
    zero = json.loads(json.dumps(sh))
    zero["rows"][0]["cash"] = 0
    ck("an n/a typed as 0 is refused", build(coops, today, [zero])["sheets"] == [])
    flip = json.loads(json.dumps(sh))
    flip["rows"][2]["charge"] = 600
    ck("charge below cash is refused", build(coops, today, [flip])["sheets"] == [])
    ck("a sheet dated after today is left out", build(coops, datetime.date(2026, 9, 30), [sh])["sheets"] == [])
    src = (ROOT / "scripts/build_fert_prices.py").read_text()
    ck("no other source is read", "fertilizer-" + "ams" not in src)
    if fails:
        print("selftest FAILED: %d" % len(fails))
        return 1
    print("selftest ok")
    return 0


def main(argv):
    if "--selftest" in argv:
        return selftest()
    doc, changed = write()
    print("[fert-prices] %s: %s" % ("wrote" if changed else "unchanged",
                                   ", ".join("%s %.2f (%s)" % (r["key"], r["price"], r["src_label"]) for r in doc["prices"]) or "no prices"))
    for n in doc["notes"]:
        print("::warning::fertilizer prices: %s" % n)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
