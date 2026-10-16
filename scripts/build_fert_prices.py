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

A co-op that sends Sig its prices rather than posting them (Synergy
Cooperative, Wisconsin; Sig, 2026-10-16) is one more co-op in
scripts/coop_fert_sources.json (layout "sheet") and arrives here through
data/fertilizer-coops.json like the rest.

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
               "ND": "North Dakota", "NE": "Nebraska", "OK": "Oklahoma", "SD": "South Dakota", "TX": "Texas", "CO": "Colorado",
               "WI": "Wisconsin"}


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


def build(coops, today=None):
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
    return {
        "note": "Built by scripts/build_fert_prices.py from data/fertilizer-coops.json only: the middle cash price of "
                "the co-ops that post each product (two co-ops: their average; one: that co-op, named). "
                "Nothing typed by hand, no other source blended in.",
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
    doc = build(read_json(root / COOPS), today)
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
    # a co-op from the sheet layout counts like any co-op (Synergy, WI)
    syn = {"id": "synergy-wi", "name": "Synergy Cooperative", "state": "WI", "url": None, "layout": "sheet", "cash_from": "cash",
           "rows": [{"raw": "46-0-0", "cash": 610, "charge": 628, "date": "2026-10-01"}]}
    sp, _ = fetch_coop_fert.read_coop(syn, today, None)
    cfgs = [{"id": c["id"], "layout": c["layout"]} for c in coops["coops"]] + [syn]
    with5 = fetch_coop_fert.compose(cfgs, {"synergy-wi": (sp, None)}, coops,
                                    datetime.datetime(2026, 10, 15, 14, tzinfo=datetime.timezone.utc), carry=True)
    w5 = build(with5, today)
    u5 = {r["key"]: r for r in w5["prices"]}["urea"]
    ck("Synergy urea 610 enters the middle: 608, 610, 615.95, 630, 840 -> 615.95", u5["price"] == 615.95 and u5["n"] == 5)
    ck("two states named in the label", u5["src_label"] == "Kansas and Wisconsin co-ops, middle of 5, posted Oct 6, 2026")
    ck("N $/lb follows: 615.95 / 920", abs(w5["per_lb"]["n"]["usd"] - 615.95 / 920) < 1e-4)
    ck("no separate sheets list", "sheets" not in d and "sheets" not in w5)
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
