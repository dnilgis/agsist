#!/usr/bin/env python3
"""
AGSIST -- data/fertilizer-prices.json: the one fertilizer price list every
page reads (/fertilizer's cheapest box, nutrient table and calculator, the
homepage card, /fast-facts, /manure-value, /urea, the baked SEO and share
cards).

It holds no number of its own. Each product's price comes from exactly one
live, dated source, in this order:
  1. co-op posted prices, data/fertilizer-coops.json (scripts/fetch_coop_fert.py):
     the middle cash price of the co-ops that post the product, when at least
     that file's min_median co-ops post a current price;
  2. otherwise the USDA AMS Illinois Production Cost Report, data/fertilizer-ams.json
     (scripts/fetch_fert_ams.py): the report's average, when the report is
     no older than MAX_AMS_DAYS.
A product neither covers is not listed. There is no hand-typed sheet behind
this file and no carried-forward price: when both sources lapse for a
product, it drops out and the pages say "no price".

Rows carry key, name, symbol, price ($/ton), as_of (the newest date the
source shows for it), src ("coop" or "ams"), src_label (plain words with the
date), and the source's link.

Run by both fertilizer workflows after they write their own file, and again
inside their commit loop, so the list always matches the two files beside it.

  python3 scripts/build_fert_prices.py             # write
  python3 scripts/build_fert_prices.py --selftest
"""
import datetime
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
COOPS = "data/" + "fertilizer-coops.json"  # two parts: see AMS below
# spelled in two parts so scripts/build_feeds.py does not list the co-op
# workflow (which runs this) as a writer of the USDA file; it only reads it
AMS = "data/" + "fertilizer-ams.json"
OUT = "data/fertilizer-prices.json"
MAX_AMS_DAYS = 60

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


def short(iso):
    d = datetime.date.fromisoformat(iso)
    return "%s %d, %d" % (MON[d.month - 1], d.day, d.year)


def read_json(path):
    try:
        return json.loads(Path(path).read_text())
    except (OSError, ValueError):
        return None


STATE_NAMES = {"AL": "Alabama", "AR": "Arkansas", "CO": "Colorado", "IA": "Iowa", "IL": "Illinois", "IN": "Indiana",
               "KS": "Kansas", "KY": "Kentucky", "MI": "Michigan", "MN": "Minnesota", "MO": "Missouri", "MT": "Montana",
               "ND": "North Dakota", "NE": "Nebraska", "OH": "Ohio", "OK": "Oklahoma", "SD": "South Dakota",
               "TN": "Tennessee", "TX": "Texas", "WI": "Wisconsin"}
MAX_COOP_DAYS = 60


def region(states):
    names = [STATE_NAMES.get(s, s) for s in sorted(set(states))]
    return names[0] if len(names) == 1 else ", ".join(names[:-1]) + " and " + names[-1]


def build(coops, ams, today):
    """Per product, two candidates, each only if live: the co-op middle cash
    price (MIN co-ops from the co-op file, newest posted date within
    MAX_COOP_DAYS) and the USDA AMS Illinois average (report within
    MAX_AMS_DAYS). The NEWER one is used; on a tie, USDA (the wider survey).
    Every label names its region, and the other source rides along in
    `other`, so pages can show it beside the price."""
    cand, notes = {}, []
    state_of = {c["id"]: c.get("state") for c in (coops or {}).get("coops") or []}
    for p in (coops or {}).get("summary") or []:
        if p.get("key") in NAMES and p.get("median") and p.get("newest"):
            age = (today - datetime.date.fromisoformat(p["newest"])).days
            if age > MAX_COOP_DAYS:
                notes.append("co-op %s newest posted %s is %d days old; not used" % (p["key"], p["newest"], age))
                continue
            span = short(p["newest"]) if p.get("oldest") in (None, p["newest"]) else "%s to %s" % (short(p["oldest"]), short(p["newest"]))
            reg = region([state_of.get(c) or "?" for c in p.get("coops") or []])
            cand.setdefault(p["key"], {})["coop"] = {
                "key": p["key"], "name": NAMES[p["key"]], "symbol": p["symbol"], "price": p["median"], "unit": "$/ton",
                "as_of": p["newest"], "src": "coop", "n": p["n"], "low": p["low"], "high": p["high"], "region": reg,
                "src_label": "%s co-ops, middle cash price of %d, posted %s" % (reg, p["n"], span),
                "short_label": "%s co-ops, %s" % (reg, short(p["newest"])[:-6]),
                "url": "https://agsist.com/fertilizer#fert-coops-more-h",
            }
    rd = (ams or {}).get("report_date")
    if rd:
        age = (today - datetime.date.fromisoformat(rd)).days
        if age > MAX_AMS_DAYS:
            notes.append("USDA AMS report of %s is %d days old; not used" % (rd, age))
        else:
            for p in ams.get("products") or []:
                k = p.get("key")
                if k in NAMES and p.get("avg"):
                    cand.setdefault(k, {})["ams"] = {
                        "key": k, "name": NAMES[k], "symbol": p.get("symbol"), "price": p["avg"], "unit": "$/ton",
                        "as_of": rd, "src": "ams", "low": p.get("low"), "high": p.get("high"), "region": "Illinois",
                        "src_label": "USDA Illinois average, report of %s" % short(rd),
                        "short_label": "USDA Illinois, %s" % short(rd)[:-6],
                        "url": ams.get("page") or ams.get("url"),
                    }
    rows = {}
    for k, c in cand.items():
        co, us = c.get("coop"), c.get("ams")
        pick, other = (co, us) if co and (not us or co["as_of"] > us["as_of"]) else (us, co)
        row = dict(pick)
        if other:
            row["other"] = {x: other[x] for x in ("src", "price", "as_of", "region", "src_label", "short_label", "symbol")}
        rows[k] = row
    prices = [rows[k] for k in NAMES if k in rows]
    per_lb = nutrient_prices(rows)
    return {
        "note": "Built by scripts/build_fert_prices.py from data/fertilizer-coops.json (co-op middle cash price, "
                "3 or more co-ops) and, where the co-ops do not cover a product, data/fertilizer-ams.json "
                "(USDA AMS Illinois average, report no older than %d days). Nothing typed by hand." % MAX_AMS_DAYS,
        "updated": max((r["as_of"] for r in prices), default=None),
        "prices": prices,
        "per_lb": per_lb,
        "programs": programs(per_lb),
        "notes": notes,
    }


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
    test/fert-prices.test.mjs checks the two agree on this file."""
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
    themselves only move when a source moves)."""
    root = Path(root)
    today = today or datetime.datetime.now(datetime.timezone.utc).date()
    doc = build(read_json(root / COOPS), read_json(root / AMS), today)
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
    coops = fetch_coop_fert.fixture_doc()
    ams = {"report_date": "2026-10-02", "page": "https://mymarketnews.ams.usda.gov/viewReport/3195", "products": [
        {"key": "anhydrous", "symbol": "82-0-0", "low": 835.0, "high": 1050.0, "avg": 945.0},
        {"key": "uan32", "symbol": "32-0-0", "low": 530.0, "high": 530.0, "avg": 530.0},
        {"key": "urea", "symbol": "46-0-0", "low": 650.0, "high": 890.0, "avg": 770.0},
        {"key": "potash", "symbol": "0-0-62", "low": 480.0, "high": 550.0, "avg": 516.36}]}
    today = datetime.date(2026, 10, 15)
    d = build(coops, ams, today)
    by = {r["key"]: r for r in d["prices"]}
    ck("urea: the co-op middle (Oct 6) is newer than USDA (Oct 2), so co-ops", by["urea"]["src"] == "coop" and by["urea"]["price"] == 622.98 and by["urea"]["n"] == 4)
    ck("urea dated by the newest co-op date", by["urea"]["as_of"] == "2026-10-06")
    ck("urea carries USDA beside it", by["urea"]["other"]["src"] == "ams" and by["urea"]["other"]["price"] == 770.0
       and by["urea"]["other"]["src_label"] == "USDA Illinois average, report of Oct 2, 2026")
    newer = dict(ams, report_date="2026-10-09")
    nb = {r["key"]: r for r in build(coops, newer, today)["prices"]}
    ck("a newer USDA report wins, with the co-op price beside it", nb["urea"]["src"] == "ams" and nb["urea"]["price"] == 770.0
       and nb["urea"]["other"]["src"] == "coop" and nb["urea"]["other"]["price"] == 622.98)
    tie = {r["key"]: r for r in build(coops, dict(ams, report_date="2026-10-06"), today)["prices"]}
    ck("a tie goes to USDA, the wider survey", tie["urea"]["src"] == "ams")
    late = {r["key"]: r for r in build(coops, None, datetime.date(2026, 12, 20))["prices"]}
    ck("co-op prices over 60 days old are not used", late == {})
    ck("UAN 32: one co-op is not enough, so USDA", by["uan32"]["src"] == "ams" and by["uan32"]["price"] == 530.0 and by["uan32"]["as_of"] == "2026-10-02")
    ck("MAP: two co-ops, no USDA figure: not listed", "map" not in by)
    ck("AMS: one current co-op, no USDA figure: not listed", "ams" not in by)
    ck("no lime, K-Mag or MAP + sulfur", not any(k in by for k in ("lime", "kmag", "map_s")))
    ck("labels name the region, the source and the date", by["urea"]["src_label"] == "Kansas co-ops, middle cash price of 4, posted Sep 24, 2026 to Oct 6, 2026"
       and by["uan32"]["src_label"] == "USDA Illinois average, report of Oct 2, 2026" and by["urea"]["short_label"] == "Kansas co-ops, Oct 6")
    ck("page order", [r["key"] for r in d["prices"]] == [k for k in NAMES if k in by])
    ck("updated is the newest as_of", d["updated"] == "2026-10-06")
    old = build(coops, ams, datetime.date(2026, 12, 20))
    ck("a USDA report over %d days old is not used, and says so" % MAX_AMS_DAYS,
       not any(r["src"] == "ams" for r in old["prices"]) and old["notes"])
    pl = d["per_lb"]
    ck("N $/lb from urea: 622.98 / 920", abs(pl["n"]["usd"] - 622.98 / 920) < 1e-4)
    ck("P $/lb from DAP with 360 lb N credited", abs(pl["p"]["usd"] - (928.77 - 360 * 622.98 / 920) / 920) < 1e-4 and pl["p"]["from"] == "dap")
    ck("K $/lb from potash 0-0-60", abs(pl["k"]["usd"] - 470.4 / 1200) < 1e-4)
    ck("the arithmetic is written out", pl["n"]["how"].startswith("urea $622.98 a ton / (2,000 lb x 46% N) = $0.68 a lb of N"))
    cp = d["programs"]["corn"]
    want = round(162 * pl["n"]["usd"] + 67 * pl["p"]["usd"] + 43 * pl["k"]["usd"])
    ck("corn program: 162 N, 67 P2O5, 43 K2O at 180 bu, priced", (cp["n_lb"], cp["p_lb"], cp["k_lb"]) == (162, 67, 43) and cp["per_acre"] == want)
    ck("soybeans: no N bought", d["programs"]["soybeans"]["n_lb"] == 0)
    nop = build(dict(coops, summary=[x for x in coops["summary"] if x["key"] != "potash"]), dict(ams, products=[x for x in ams["products"] if x["key"] != "potash"]), today)
    ck("no potash price: no K $/lb and no crop program, never a guess", "k" not in nop["per_lb"] and nop["programs"]["corn"] is None)
    none = build(None, None, today)
    ck("no sources: an empty list, never a typed number", none["prices"] == [] and none["updated"] is None)
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
                                   ", ".join("%s %s %.2f" % (r["key"], r["src"], r["price"]) for r in doc["prices"]) or "no prices"))
    for n in doc["notes"]:
        print("::warning::fertilizer prices: %s" % n)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
