#!/usr/bin/env python3
"""
check_number_consistency.py: the same number, the same everywhere.

The 2026-10-17 cross-page audit (findings N1 to N13) found one quantity
printed two ways on different pages: Friday's provisional close on the harvest
tracker under a settle everywhere else, "not CME settlements" over settles,
two crop-removal tables, a three-month-old mailbox price in an FAQ, Wisconsin
on Kansas-only fertilizer prices. Each rule below reads only committed data
files and the baked HTML (titles, meta, static text), no browser, and names
what disagrees.

REPORT MODE (the default) prints GitHub annotations (::warning) and a summary
and always exits 0. freshness.yml runs it after the bakes this way until it has
run clean for a few days; --strict exits 1 on any finding.

Rules (id: what must agree):
  settle-words     no page says "not (official) CME settlement(s)" while the
                   grain quotes in data/prices.json are settles
  futures-heads    corn, soybean, wheat and cattle futures titles and meta
                   descriptions: each contract price == prices.json (settle when
                   close_kind is settle), and "settled ... on <date>" only for a
                   settle, dated close_date
  harvest-tracker  the newest harvest-prices.json day == the prices.json settle
                   for that contract and date, with no provisional flag; the
                   running average == the mean of the series; the page H1
                   carries the running averages
  arc-prices       arc-plc-prices.json harvest price within 3 cents of the
                   tracker's running average (else the county pages are behind)
  daily-basis      each state median and elevator count the Daily's basis fact
                   names == data/basis-states.json, when both are the same
                   snapshot (the fact carries it)
  basis-log        no point left in data/basis-sparklines/<ST>.json that the
                   basis_method outlier screen would drop
  removal-rates    one crop-removal table: scripts/crop_removal.py (A2809) ==
                   fertilizer.html CROPS and its printed line == breakeven.html
                   FERT.r == the pounds in fertilizer-prices.json programs
  fert-head        fertilizer.html description AND the baked body line
                   (<!--BAKE:fert-bar-->, Sig Oct 19): each named price == the
                   shared price file, each state named belongs to that price,
                   its date range sits inside the oldest-to-newest range of the
                   file, and the body names the same prices and dates as the
                   description, written the same way
  milk-mailbox     every "mailbox average was $X" on milk-prices.html (FAQ and
                   JSON-LD included) is the newest month in dairy-mailbox.json
  staleness        each file's own date against a maximum age
  counts           /cash-bids share text elevator and town counts ==
                   data/elevator-counts.json

    python3 scripts/check_number_consistency.py            # report
    python3 scripts/check_number_consistency.py --strict   # exit 1 on a finding
    python3 scripts/check_number_consistency.py --selftest
"""
import datetime as dt
import html as H
import json
import os
import re
import statistics
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
MONL = ["January", "February", "March", "April", "May", "June", "July", "August", "September",
        "October", "November", "December"]
FRAC = {"": 0.0, "\u00bc": 0.25, "\u00bd": 0.5, "\u00be": 0.75}


class Ctx:
    def __init__(self, root, now):
        self.root = Path(root)
        self.now = now
        self.findings = []   # (rule, file, message)
        self.checked = {}    # rule -> number of comparisons made
        self.notes = []      # (rule, message): not compared, and why

    def load(self, rel):
        try:
            return json.loads((self.root / rel).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None

    def text(self, rel):
        try:
            return (self.root / rel).read_text(encoding="utf-8")
        except OSError:
            return None

    def ok(self, rule, cond, file, msg):
        self.checked[rule] = self.checked.get(rule, 0) + 1
        if not cond:
            self.findings.append((rule, file, msg))
        return cond

    def note(self, rule, msg):
        self.notes.append((rule, msg))


def md(iso):
    d = dt.date.fromisoformat(str(iso)[:10])
    return f"{MON[d.month - 1]} {d.day}"


def grain_cents(s):
    """'$4.74¼' -> 474.25 cents; None when not a price."""
    m = re.fullmatch(r"\$(\d[\d,]*)\.(\d{2})([\u00bc\u00bd\u00be]?)", s)
    if not m:
        return None
    return int(m.group(1).replace(",", "")) * 100 + int(m.group(2)) + FRAC[m.group(3)]


def head_of(page):
    t = re.search(r"<title>([^<]*)</title>", page)
    d = re.search(r'<meta name="description" content="([^"]*)"', page)
    return H.unescape(t.group(1)) if t else "", H.unescape(d.group(1)) if d else ""


def quote_for(prices, root_key):
    near = ((prices or {}).get("nearby") or {}).get(root_key) or {}
    q = ((prices or {}).get("quotes") or {}).get(near.get("key") or "")
    return near.get("label"), q


def shown_value(q):
    """What a page should print for a quote: the settle when it is one."""
    if q.get("close_kind") == "settle" and isinstance(q.get("settle"), (int, float)):
        return q["settle"]
    return q.get("close")


def settles_by_label(q):
    """{"Oct 16": 474.25} for every settle a v3.7 quote names: its settles
    map, its newest settle, and its close when that is a settle."""
    out = {}
    for d, px in (q.get("settles") or {}).items():
        if isinstance(px, (int, float)):
            out[md(d)] = px
    if q.get("settle_date") and isinstance(q.get("settle"), (int, float)):
        out[md(q["settle_date"])] = q["settle"]
    if q.get("close_kind") == "settle" and q.get("close_date") and isinstance(q.get("close"), (int, float)):
        out.setdefault(md(q["close_date"]), q["close"])
    return out


# ── rules ────────────────────────────────────────────────────────────────────

SETTLE_DENIAL = re.compile(r"not (?:official )?CME settlements?\b", re.I)


def rule_settle_words(c):
    p = c.load("data/prices.json")
    if not p:
        return c.note("settle-words", "data/prices.json missing")
    kinds = [(quote_for(p, k)[1] or {}).get("close_kind") for k in ("corn", "beans", "wheat")]
    if not all(k == "settle" for k in kinds):
        return c.note("settle-words", "grain quotes are not all settles: not checked")
    pages = sorted(x.name for x in c.root.glob("*.html"))
    daily = sorted(x.name for x in (c.root / "daily").glob("20*.html"))
    files = pages + (["daily/" + daily[-1]] if daily else [])
    for f in files:
        t = c.text(f) or ""
        # page script may carry the old words as a branch for files without a kind;
        # only text a reader sees counts: strip scripts
        vis = re.sub(r"<script\b.*?</script>", " ", t, flags=re.S)
        m = SETTLE_DENIAL.search(vis)
        c.ok("settle-words", m is None, f, f"says '{m.group(0) if m else ''}' while prices.json holds settles")


FUT_PAGES = (("corn-futures-prices.html", "corn"), ("soybean-futures-prices.html", "beans"),
             ("wheat-futures-prices.html", "wheat"))


def rule_futures_heads(c):
    p = c.load("data/prices.json")
    if not p:
        return c.note("futures-heads", "data/prices.json missing")
    for f, k in FUT_PAGES:
        page = c.text(f)
        label, q = quote_for(p, k)
        if not page or not q or not label:
            c.note("futures-heads", f"{f}: page or {k} quote missing")
            continue
        want = shown_value(q)
        on_file = settles_by_label(q)
        for where, s in zip(("title", "description"), head_of(page)):
            # "Dec '26 $4.74¼ (Oct 16)": a dated number is checked against that
            # date's settle, so a weekday-evening title holding the session
            # before is right, not a disagreement (2026-10-20, issue #2 noise).
            sm = re.search(r"\bsettled (\$[\d,]+\.\d{2}[\u00bc\u00bd\u00be]?).*? on ([A-Z][a-z]{2} \d{1,2})\b", s)
            for m in re.finditer(re.escape(label) + r"( settled)? (\$[\d,]+\.\d{2}[\u00bc\u00bd\u00be]?)"
                                 r"(?: \(([A-Z][a-z]{2} \d{1,2})\))?", s):
                got = grain_cents(m.group(2))
                if m.group(1) and sm:
                    continue        # "settled $X on <date>": checked against that date below
                if m.group(3):
                    ref = on_file.get(m.group(3))
                    c.ok("futures-heads", got is not None and ref is not None and abs(got - ref) < 0.01, f,
                         f"{where} prints {label} {m.group(2)} ({m.group(3)}), prices.json settle that day is {ref}")
                    continue
                c.ok("futures-heads", got is not None and abs(got - want) < 0.01, f,
                     f"{where} prints {label} {m.group(2)}, prices.json {q.get('close_kind')} is {want}")
            if sm:
                got, ref = grain_cents(sm.group(1)), on_file.get(sm.group(2))
                c.ok("futures-heads", got is not None and ref is not None and abs(got - ref) < 0.01, f,
                     f"{where} says settled {sm.group(1)} on {sm.group(2)}; prices.json settle that day is {ref}")
    page = c.text("cattle-futures-prices.html")
    if page:
        t, d = head_of(page)
        dm = re.search(r"\(([A-Z][a-z]{2} \d{1,2})\)", t)
        for key, pat in (("feeders", r"Feeder Cattle Futures \$([\d.]+)"), ("cattle", r"Live Cattle \$([\d.]+)")):
            m = re.search(pat, t)
            q = ((p.get("quotes") or {}).get(key)) or {}
            if m and q:
                ref = settles_by_label(q).get(dm.group(1)) if dm else shown_value(q)
                c.ok("futures-heads", ref is not None and abs(float(m.group(1)) - ref) < 1e-6, "cattle-futures-prices.html",
                     f"title prints {key} ${m.group(1)}{' (' + dm.group(1) + ')' if dm else ''}, prices.json {ref}")


def _cents(x):
    """Halves up, as RMA rounds (fetch_harvest_prices.cents)."""
    from decimal import Decimal, ROUND_HALF_UP
    return float(Decimal(repr(x)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def rule_harvest_tracker(c):
    h, p = c.load("data/harvest-prices.json"), c.load("data/prices.json")
    if not h or not p:
        return c.note("harvest-tracker", "harvest-prices.json or prices.json missing")
    roots, mcode = {"Corn": "ZC", "Soybeans": "ZS"}, {"Dec": "Z", "Nov": "X"}
    page = c.text("harvest-price-tracker.html") or ""
    h1 = re.search(r"<!--SEED:hph1-->(.*?)<!--/SEED:hph1-->", page)
    for cm in h.get("commodities") or []:
        leg = cm.get("harvest") or {}
        ser = leg.get("series") or []
        if leg.get("status") != "running" or not ser:
            continue
        mon, yy = cm["contract"].split()[0], cm["contract"].split("'")[1]
        ticker = roots.get(cm["label"], "") + mcode.get(mon, "") + yy + ".CBT"
        last = ser[-1]
        settle = None
        for q in (p.get("quotes") or {}).values():
            if isinstance(q, dict) and q.get("ticker") == ticker and q.get("settles_v") == 2:
                settle = (q.get("settles") or {}).get(last["d"])
                break
        if settle is not None:
            c.ok("harvest-tracker", abs(last["s"] * 100 - settle) < 0.01 and not last.get("p"),
                 "data/harvest-prices.json",
                 f"{cm['label']} {last['d']}: tracker {last['s']}{' (provisional)' if last.get('p') else ''}, "
                 f"CBOT settle in prices.json {settle / 100}")
        avg = _cents(sum(x["s"] for x in ser) / len(ser))
        c.ok("harvest-tracker", abs(avg - (leg.get("running_avg") or 0)) < 0.011, "data/harvest-prices.json",
             f"{cm['label']} running average {leg.get('running_avg')}, mean of the series {avg}")
        if h1:
            c.ok("harvest-tracker", f"{cm['label'].lower()} ${leg.get('running_avg'):.2f}" in h1.group(1),
                 "harvest-price-tracker.html", f"H1 '{h1.group(1)}' does not carry {cm['label']} ${leg.get('running_avg'):.2f}")


def rule_arc_prices(c):
    a, h = c.load("data/arc-plc-prices.json"), c.load("data/harvest-prices.json")
    if not a or not h:
        return c.note("arc-prices", "arc-plc-prices.json or harvest-prices.json missing")
    for cm in h.get("commodities") or []:
        crop = cm["label"].lower()
        leg = cm.get("harvest") or {}
        mine = leg.get("running_avg") if leg.get("status") == "running" else leg.get("price")
        theirs = (((a.get("harvest") or {}).get(crop)) or {})
        if mine is None or theirs.get("price") is None:
            continue
        c.ok("arc-prices", abs(theirs["price"] - mine) <= 0.03 + 1e-9, "data/arc-plc-prices.json",
             f"{crop}: ARC pages use {theirs['price']} ({theirs.get('days')} days, {theirs.get('updated')}); "
             f"the tracker is at {mine} ({leg.get('days_counted')} days)")


def rule_daily_basis(c):
    d, b = c.load("data/daily.json"), c.load("data/basis-states.json")
    if not d or not b:
        return c.note("daily-basis", "daily.json or basis-states.json missing")
    facts = [f for f in ((d.get("edge") or {}).get("facts") or []) if f.get("kind") == "basis_spread"]
    for f in facts:
        snap = f.get("snapshot")
        if snap != b.get("generated"):
            c.note("daily-basis", f"{f.get('id')}: the Daily read the {snap or 'unnamed'} snapshot, "
                                  f"basis-states.json is {b.get('generated')}: not compared")
            continue
        for r in (f.get("high") or []) + (f.get("low") or []):
            s = (((b.get("states") or {}).get(r["state"]) or {}).get("crops") or {}).get(f.get("crop")) or {}
            c.ok("daily-basis", s.get("median") is not None and round(s["median"] * 100) == round(r["median"] * 100)
                 and s.get("n") == r["n"], "data/daily.json",
                 f"{f.get('id')} {r['state']}: Daily {r['median']} n={r['n']}, basis-states {s.get('median')} n={s.get('n')}")


def rule_basis_log(c):
    sys.path.insert(0, str(ROOT / "scripts"))
    import build_basis_sparklines as BS  # noqa: E402
    files = sorted((c.root / "data" / "basis-sparklines").glob("*.json"))
    if not files:
        return c.note("basis-log", "no data/basis-sparklines files")
    for fp in files:
        d = c.load(str(fp.relative_to(c.root)))
        if not d:
            continue
        _, dropped = BS.screen(d.get("series") or {})
        ex = "; ".join(f"{k.split('|')[1]} {k.split('|')[3]} {p['date']} {p['cents']}c" for k, p, _ in dropped[:3])
        c.ok("basis-log", not dropped, str(fp.relative_to(c.root)),
             f"{len(dropped)} logged points the outlier screen drops (e.g. {ex})")


def rule_removal_rates(c):
    sys.path.insert(0, str(ROOT / "scripts"))
    import crop_removal  # noqa: E402
    js = c.text("components/nutrient-removal.js")
    if not js:
        return c.note("removal-rates", "components/nutrient-removal.js missing")
    t = crop_removal.per_bu(js)
    fe = c.text("fertilizer.html") or ""
    m = re.search(r"var CROPS=\{corn:\{[^}]*p2o5:([\d.]+),k2o:([\d.]+)[^}]*\},soybean:\{[^}]*p2o5:([\d.]+),k2o:([\d.]+)"
                  r"[^}]*\},wheat:\{[^}]*p2o5:([\d.]+),k2o:([\d.]+)", fe)
    want = [t["corn"][1], t["corn"][2], t["soybeans"][1], t["soybeans"][2], t["wheat"][1], t["wheat"][2]]
    if m:
        c.ok("removal-rates", [float(x) for x in m.groups()] == want, "fertilizer.html",
             f"CROPS rates {m.groups()} vs A2809 {want}")
    line = re.search(r"Corn P&#x2082;O&#x2085; ([\d.]+), K&#x2082;O ([\d.]+) &middot; Soybeans ([\d.]+) / ([\d.]+) "
                     r"&middot; Wheat ([\d.]+) / ([\d.]+)", fe)
    if line:
        c.ok("removal-rates", [float(x) for x in line.groups()] == want, "fertilizer.html",
             f"printed removal line {line.groups()} vs A2809 {want}")
    be = c.text("breakeven.html") or ""
    m = re.search(r"r:\{corn:\[([\d.,]+)\],soybeans:\[([\d.,]+)\],wheat:\[([\d.,]+)\]\}", be)
    if m:
        got = [[float(x) for x in g.split(",")] for g in m.groups()]
        # 2026-10-19 money audit 1: /breakeven's corn N is a flat A2809 MRTN rate
        # (FERT.nf.corn), not per bushel, so its per-bushel corn N is 0 and the
        # flat rate must be there; P, K and the other crops are the one table.
        flat = re.search(r"nf:\{corn:\[(\d+),", be)
        want_be = [[0.0] + list(t["corn"][1:]), list(t["soybeans"]), list(t["wheat"])]
        c.ok("removal-rates", got == want_be and bool(flat), "breakeven.html",
             f"FERT.r {got} vs {want_be} (corn N flat, nf {'set' if flat else 'missing'})")
    progs = ((c.load("data/fertilizer-prices.json") or {}).get("programs")) or {}
    for crop, pr in progs.items():
        if pr and crop in t:
            lbs = [round(pr["yield"] * r) for r in t[crop]]
            c.ok("removal-rates", lbs == [pr["n_lb"], pr["p_lb"], pr["k_lb"]], "data/fertilizer-prices.json",
                 f"{crop} program {pr['n_lb']}/{pr['p_lb']}/{pr['k_lb']} lb, A2809 at {pr['yield']} bu gives {lbs}")


FERT_NAMES = {"urea": "urea", "anhydrous": "anhydrous", "DAP": "dap", "potash": "potash", "MAP": "map"}


def _regions(r):
    return set(x for x in re.split(r", (?:and )?| and ", r.get("region") or "") if x)


_FERT_PX = re.compile(r"\b(urea|anhydrous|DAP|MAP|potash) \$([\d,]+)(?:/ton)?(?: \(([^)]*)\))?")
_FERT_RNG = re.compile(r"posted ([A-Z][a-z]{2} \d{1,2})(?:, (\d{4}))?(?: to ([A-Z][a-z]{2} \d{1,2}), (\d{4}))?")


def _fert_text(c, rows, text, where):
    """The fert-head checks on one piece of reader text (the description, or
    the body line baked from it)."""
    lead = re.match(r"(.*?) co-op cash prices posted ", text)
    base = set(re.split(r", (?:and )?| and ", lead.group(1))) if lead else set()
    for m in _FERT_PX.finditer(text):
        r = rows.get(FERT_NAMES[m.group(1)])
        if not r:
            c.ok("fert-head", False, "fertilizer.html", f"{where} names {m.group(1)}, the price file has none")
            continue
        c.ok("fert-head", int(m.group(2).replace(",", "")) == round(r["price"]), "fertilizer.html",
             f"{where} {m.group(1)} ${m.group(2)}, price file {r['price']}")
        named = set(re.split(r", (?:and )?| and ", m.group(3))) if m.group(3) else base
        c.ok("fert-head", not named or named == _regions(r), "fertilizer.html",
             f"{where} puts {m.group(1)} in {sorted(named)}; its co-ops are in {sorted(_regions(r))}")
    rng = _FERT_RNG.search(text)
    ds = [x for r in rows.values() for x in (r.get("as_of"), r.get("oldest")) if x]
    if rng and ds:
        yr = rng.group(4) or rng.group(2)
        def iso(s):
            mo, dd = s.split()
            return f"{yr}-{MON.index(mo) + 1:02d}-{int(dd):02d}"
        lo, hi = iso(rng.group(1)), iso(rng.group(3) or rng.group(1))
        c.ok("fert-head", min(ds) <= lo <= hi <= max(r["as_of"] for r in rows.values() if r.get("as_of")),
             "fertilizer.html", f"{where} range {lo} to {hi} is outside the file's {min(ds)} to "
                                f"{max(r['as_of'] for r in rows.values() if r.get('as_of'))}")


def rule_fert_head(c):
    d, page = c.load("data/fertilizer-prices.json"), c.text("fertilizer.html")
    if not d or not page:
        return c.note("fert-head", "fertilizer-prices.json or fertilizer.html missing")
    rows = {r["key"]: r for r in d.get("prices") or [] if r.get("key")}
    _, desc = head_of(page)
    _fert_text(c, rows, desc, "description")
    # Sig Oct 19: the body is baked with the same prices (bake_seo.py
    # body_fertilizer). It is checked against the file on its own, and
    # against the description: one price shown one way on the page.
    bm = re.search(r"<!--BAKE:fert-bar-->(.*?)<!--/BAKE-->", page, re.S)
    if not bm:
        return c.note("fert-head", "fertilizer.html has no fert-bar body line")
    body = H.unescape(re.sub(r"<[^>]+>", "", bm.group(1))).strip()
    _fert_text(c, rows, body, "body line")
    px_d = [m.group(0) for m in _FERT_PX.finditer(desc)]
    px_b = [m.group(0) for m in _FERT_PX.finditer(body)]
    rg_d, rg_b = _FERT_RNG.search(desc), _FERT_RNG.search(body)
    c.ok("fert-head", px_b == px_d and (rg_b and rg_b.group(0)) == (rg_d and rg_d.group(0)), "fertilizer.html",
         f"body line {px_b} {rg_b and rg_b.group(0)} differs from the description {px_d} {rg_d and rg_d.group(0)}")


def rule_milk_mailbox(c):
    mb, page = c.load("data/dairy-mailbox.json"), c.text("milk-prices.html")
    if not mb or not page or not mb.get("month_key"):
        return c.note("milk-mailbox", "dairy-mailbox.json or milk-prices.html missing")
    y, m = (int(x) for x in mb["month_key"].split("-"))
    want = f"{MONL[m - 1]} {y} the federal-order mailbox average was ${mb['value']:.2f}"
    found = re.findall(r"[A-Z][a-z]+ \d{4} the federal-order mailbox average was \$\d+\.\d\d", page)
    c.ok("milk-mailbox", bool(found), "milk-prices.html", "no dated mailbox figure on the page")
    for s in found:
        c.ok("milk-mailbox", s == want, "milk-prices.html", f"'{s}' vs the newest month in the file: '{want}'")


def _age_h(c, stamp):
    try:
        t = dt.datetime.fromisoformat(str(stamp).replace("Z", "+00:00"))
    except ValueError:
        try:
            t = dt.datetime.strptime(str(stamp), "%B %d, %Y").replace(tzinfo=dt.timezone.utc)
        except ValueError:
            return None
    if t.tzinfo is None:
        t = t.replace(tzinfo=dt.timezone.utc)
    return (c.now - t).total_seconds() / 3600


def rule_staleness(c):
    wk = c.now.weekday()
    price_max = 74 if wk in (5, 6) or (wk == 0 and c.now.hour < 18) else 26
    checks = [("data/prices.json", lambda d: d.get("fetched"), price_max),
              ("data/basis-states.json", lambda d: d.get("generated"), 4),
              ("data/cot.json", lambda d: d.get("updated"), 8 * 24 + 12)]
    if 4 <= c.now.month <= 11:
        checks.append(("data/crop-progress.json", lambda d: d.get("updated"), 8 * 24 + 12))
    for rel, get, mx in checks:
        d = c.load(rel)
        if not d:
            c.note("staleness", f"{rel} missing")
            continue
        age = _age_h(c, get(d))
        c.ok("staleness", age is not None and age <= mx, rel, f"{age if age is None else round(age, 1)} h old (max {mx} h)")
    f = c.load("data/fertilizer-prices.json")
    ds = [r.get("as_of") for r in (f or {}).get("prices") or [] if r.get("as_of")]
    if ds:
        age = (c.now.date() - dt.date.fromisoformat(max(ds))).days
        c.ok("staleness", age <= 21, "data/fertilizer-prices.json", f"newest co-op price is {age} days old (max 21)")
    mb = c.load("data/dairy-mailbox.json")
    if mb and mb.get("month_key"):
        y, m = (int(x) for x in mb["month_key"].split("-"))
        end = dt.date(y + (m == 12), m % 12 + 1, 1)
        age = (c.now.date() - end).days
        c.ok("staleness", age <= 120, "data/dairy-mailbox.json", f"newest mailbox month ended {age} days ago (max 120)")


def rule_counts(c):
    page, n = c.text("cash-bids.html"), c.load("data/elevator-counts.json")
    if not page or not n:
        return c.note("counts", "cash-bids.html or elevator-counts.json missing")
    m = re.search(r'og:description" content="[^"]*current bids from ([\d,]+) elevators? across ([\d,]+) towns?', page)
    if not m:
        return c.note("counts", "cash-bids.html share text has no live count")
    b = n.get("bids") or {}
    c.ok("counts", int(m.group(1).replace(",", "")) == b.get("elevators") and int(m.group(2).replace(",", "")) == b.get("towns"),
         "cash-bids.html", f"share text {m.group(1)} elevators / {m.group(2)} towns, elevator-counts.json "
                           f"{b.get('elevators')} / {b.get('towns')}")


RULES = [("settle-words", rule_settle_words), ("futures-heads", rule_futures_heads),
         ("harvest-tracker", rule_harvest_tracker), ("arc-prices", rule_arc_prices),
         ("daily-basis", rule_daily_basis), ("basis-log", rule_basis_log),
         ("removal-rates", rule_removal_rates), ("fert-head", rule_fert_head),
         ("milk-mailbox", rule_milk_mailbox), ("staleness", rule_staleness), ("counts", rule_counts)]


def run(root=ROOT, now=None, only=None):
    c = Ctx(root, now or dt.datetime.now(dt.timezone.utc))
    for rid, fn in RULES:
        if only and rid not in only:
            continue
        try:
            fn(c)
        except Exception as e:  # noqa: BLE001  one broken rule never hides the others
            c.findings.append((rid, "scripts/check_number_consistency.py", f"rule crashed: {type(e).__name__}: {e}"))
    return c


def report(c):
    for rid, f, msg in c.findings:
        print(f"::warning file={f},title=number check {rid}::{msg}")
    for rid, _ in RULES:
        n = c.checked.get(rid, 0)
        bad = sum(1 for x in c.findings if x[0] == rid)
        print(f"  {rid:16s} {n:4d} compared, {bad} disagree")
    for rid, msg in c.notes:
        print(f"  note {rid}: {msg}")
    print(f"number check: {len(c.findings)} finding(s)")


# ── selftest: a clean fixture, then one planted mismatch per rule ───────────

def _fixture(td):
    r = Path(td)
    for sub in ("data/basis-sparklines", "daily", "components"):
        (r / sub).mkdir(parents=True, exist_ok=True)

    def w(rel, obj):
        (r / rel).write_text(obj if isinstance(obj, str) else json.dumps(obj), encoding="utf-8")
    q = lambda t, s, d="2026-10-16": {"ticker": t, "close": s, "settle": s, "close_kind": "settle", "close_date": d,  # noqa: E731
                                     "settles_v": 2, "settles": {d: s}}
    w("data/prices.json", {"fetched": "2026-10-17T06:46:21Z",
                           "nearby": {"corn": {"key": "corn-dec26", "label": "Dec '26"},
                                      "beans": {"key": "beans-nov26", "label": "Nov '26"},
                                      "wheat": {"key": "wheat-dec26", "label": "Dec '26"}},
                           "quotes": {"corn-dec26": q("ZCZ26.CBT", 474.25), "beans-nov26": q("ZSX26.CBT", 1261.25),
                                      "wheat-dec26": q("ZWZ26.CBT", 660.5), "cattle": q("LEV26.CME", 227.55),
                                      "feeders": q("GFV26.CME", 343.625)}})
    head = lambda t, d: f"<html><head><title>{t}</title><meta name=\"description\" content=\"{d}\"></head><body>x</body></html>"  # noqa: E731
    w("corn-futures-prices.html", head("CBOT Corn Futures Price: Dec &#x27;26 $4.74\u00bc | AGSIST",
                                       "Corn Dec &#x27;26 settled $4.74\u00bc (\u22123\u00be\u00a2) on Oct 16."))
    w("soybean-futures-prices.html", head("CBOT Soybean Futures Price: Nov '26 $12.61\u00bc | AGSIST",
                                          "Soybeans Nov '26 settled $12.61\u00bc on Oct 16."))
    w("wheat-futures-prices.html", head("CBOT Wheat Futures Price: Dec '26 $6.60\u00bd | AGSIST", "Wheat Dec '26 settled $6.60\u00bd on Oct 16."))
    w("cattle-futures-prices.html", head("CME Feeder Cattle Futures $343.625 &amp; Live Cattle $227.55 | AGSIST", "x"))
    w("daily/2026-10-17.html", '<div class="dv3-quote-asof">Exchange settles, Fri Oct 16 · Yahoo Finance, delayed</div>'
                                "<script>var x='Yahoo Finance, delayed, not CME settlements';</script>")
    ser = [{"d": "2026-10-15", "s": 4.78}, {"d": "2026-10-16", "s": 4.7425}]
    w("data/harvest-prices.json", {"commodities": [
        {"label": "Corn", "contract": "Dec '26", "harvest": {"status": "running", "running_avg": 4.76, "days_counted": 2,
                                                            "series": ser}}]})
    w("harvest-price-tracker.html", "<h1><!--SEED:hph1-->2026 harvest price so far: corn $4.76<!--/SEED:hph1--></h1>")
    w("data/arc-plc-prices.json", {"harvest": {"corn": {"price": 4.78, "days": 1, "updated": "2026-10-15"}}})
    w("data/basis-states.json", {"generated": "2026-10-17T04:37:12Z", "states": {
        "ND": {"crops": {"corn": {"median": -0.80, "n": 37}}}, "TX": {"crops": {"corn": {"median": 0.55, "n": 17}}}}})
    w("data/daily.json", {"edge": {"facts": [{"id": "basis_spread_corn", "kind": "basis_spread", "crop": "corn",
                                              "snapshot": "2026-10-17T04:37:12Z",
                                              "high": [{"state": "TX", "median": 0.55, "n": 17}],
                                              "low": [{"state": "ND", "median": -0.80, "n": 37}]}]}})
    w("data/basis-sparklines/IL.json", {"series": {f"IL|E{i}|T|corn|ZCZ26|DEC26": [{"date": "2026-09-01", "cents": c}]
                                                   for i, c in enumerate((-10, -15, -20, -12, -18))}})
    w("components/nutrient-removal.js", "{ id: 'corn_grain', p: 0.38, k: 0.29 },{ id: 'soy_grain', p: 0.8, k: 1.4 },"
                                        "{ id: 'wheat_grain', p: 0.5, k: 0.35 }")
    w("fertilizer.html", head("Kansas and Wisconsin Co-op Fertilizer per Ton: Urea $616 | AGSIST",
                              "Kansas co-op cash prices posted Sep 24 to Oct 6, 2026: urea $616/ton (Kansas and Wisconsin), "
                              "anhydrous $832. Cost per lb.")
      + '<div id="fert-coop-bar"><!--BAKE:fert-bar-->Kansas co-op cash prices posted Sep 24 to Oct 6, 2026: '
        "urea $616/ton (Kansas and Wisconsin), anhydrous $832.<!--/BAKE--></div>"
      + "var CROPS={corn:{label:'Corn',nRate:0.90,p2o5:0.38,k2o:0.29},soybean:{nRate:0,p2o5:0.80,k2o:1.40},wheat:{nRate:1.2,p2o5:0.50,k2o:0.35}};"
        "<code>Corn P&#x2082;O&#x2085; 0.38, K&#x2082;O 0.29 &middot; Soybeans 0.80 / 1.40 &middot; Wheat 0.50 / 0.35</code>")
    w("breakeven.html", "var FERT={n:0.67,r:{corn:[0,0.38,0.29],soybeans:[0,0.8,1.4],wheat:[1.2,0.5,0.35]},nf:{corn:[120,0.5074,'anhydrous']}};")
    w("data/fertilizer-prices.json", {"prices": [
        {"key": "urea", "price": 615.95, "as_of": "2026-10-06", "oldest": "2026-09-24", "region": "Kansas and Wisconsin"},
        {"key": "anhydrous", "price": 832.1, "as_of": "2026-10-06", "oldest": "2026-09-24", "region": "Kansas"},
        {"key": "map", "price": 980.0, "as_of": "2026-10-12", "oldest": "2026-10-06", "region": "Kansas"}],
        "programs": {"corn": {"yield": 180, "n_lb": 162, "p_lb": 68, "k_lb": 52}}})
    w("data/dairy-mailbox.json", {"month_key": "2026-06", "value": 20.18})
    w("milk-prices.html", "In June 2026 the federal-order mailbox average was $20.18/cwt. "
                          '<!--SEED:milkmbfaq-->In June 2026 the federal-order mailbox average was $20.18 per hundredweight.<!--/SEED-->')
    w("data/cot.json", {"updated": "2026-10-16"})
    w("data/crop-progress.json", {"updated": "2026-10-15"})
    w("data/elevator-counts.json", {"bids": {"elevators": 1724, "towns": 1361}})
    w("cash-bids.html", '<meta property="og:description" content="Grain prices at local elevators near you: '
                        'current bids from 1,724 elevators across 1,361 towns, by ZIP, free. Updated Oct 17, 9:27 am CT.">')
    return r


def selftest():
    now = dt.datetime(2026, 10, 17, 6, 50, tzinfo=dt.timezone.utc)
    fails = []

    def ck(name, cond, detail=""):
        print(("  ok   " if cond else "  FAIL ") + name + ("" if cond else f": {detail}"))
        if not cond:
            fails.append(name)

    assert grain_cents("$4.74\u00bc") == 474.25 and grain_cents("$12.61\u00bd") == 1261.5 and grain_cents("$7.04") == 704
    assert grain_cents("$x") is None and md("2026-10-06") == "Oct 6"

    def plant(rule, edit):
        with tempfile.TemporaryDirectory() as td:
            r = _fixture(td)
            edit(r)
            c = run(r, now, only={rule})
            return c

    with tempfile.TemporaryDirectory() as td:
        c = run(_fixture(td), now)
        ck("clean fixture: no finding", not c.findings, c.findings)
        ck("clean fixture: every rule compared something", all(c.checked.get(rid) for rid, _ in RULES),
           {rid: c.checked.get(rid) for rid, _ in RULES})

    def sub(rel, a, b):
        def f(r):
            p = r / rel
            t = p.read_text(encoding="utf-8")
            assert a in t, (rel, a)
            p.write_text(t.replace(a, b), encoding="utf-8")
        return f

    def js(rel, fn):
        def f(r):
            p = r / rel
            d = json.loads(p.read_text())
            fn(d)
            p.write_text(json.dumps(d))
        return f

    cases = [
        ("settle-words", "a visible 'not CME settlements' over settles (N2)",
         sub("daily/2026-10-17.html", "Yahoo Finance, delayed</div>", "Yahoo Finance, delayed, not CME settlements</div>")),
        ("futures-heads", "a title a tick off the settle",
         sub("soybean-futures-prices.html", "Nov '26 $12.61\u00bc |", "Nov '26 $12.60\u00bd |")),
        ("futures-heads", "'settled' on a day with no settle on file",
         js("data/prices.json", lambda d: d["quotes"]["wheat-dec26"].update(close_kind="last", settle=None, settles={}))),
        ("futures-heads", "a dated title whose number is not that day's settle",
         sub("corn-futures-prices.html", "Dec &#x27;26 $4.74\u00bc |", "Dec &#x27;26 $4.66\u00be (Oct 16) |")),
        ("futures-heads", "a dated cattle title on a day with no settle on file",
         sub("cattle-futures-prices.html", "Live Cattle $227.55 |", "Live Cattle $227.55 (Oct 19) |")),
        ("futures-heads", "a cattle title off the file",
         sub("cattle-futures-prices.html", "Live Cattle $227.55", "Live Cattle $227.50")),
        ("harvest-tracker", "Friday's provisional close kept under a posted settle (N1)",
         js("data/harvest-prices.json", lambda d: d["commodities"][0]["harvest"]["series"][-1].update(s=4.74, p=True))),
        ("harvest-tracker", "an H1 that does not carry the running average",
         sub("harvest-price-tracker.html", "corn $4.76", "corn $4.80")),
        ("arc-prices", "ARC prices more than 3 cents off the tracker (N8)",
         js("data/arc-plc-prices.json", lambda d: d["harvest"]["corn"].update(price=4.80))),
        ("daily-basis", "a Daily median off the same snapshot (N4)",
         js("data/daily.json", lambda d: d["edge"]["facts"][0]["low"][0].update(n=36))),
        ("basis-log", "a -200c misread left in the log (N5)",
         js("data/basis-sparklines/IL.json", lambda d: d["series"].update(
             {"IL|PRIMIENT|DECATUR|corn|ZCZ6|JAN27": [{"date": "2026-09-02", "cents": -200}]}))),
        ("removal-rates", "breakeven on the old 0.37 / 0.24 corn rates (N3)",
         sub("breakeven.html", "corn:[0,0.38,0.29]", "corn:[0,0.37,0.24]")),
        ("removal-rates", "breakeven back on 0.90 lb N a bushel for corn (money audit 1)",
         sub("breakeven.html", "corn:[0,0.38,0.29]", "corn:[0.9,0.38,0.29]")),
        ("removal-rates", "breakeven corn N with no flat MRTN rate",
         sub("breakeven.html", ",nf:{corn:[120,0.5074,'anhydrous']}", "")),
        ("removal-rates", "program pounds priced at other rates",
         js("data/fertilizer-prices.json", lambda d: d["programs"]["corn"].update(k_lb=43))),
        ("fert-head", "Wisconsin on a Kansas-only price (N7)",
         sub("fertilizer.html", "Kansas co-op cash prices posted", "Kansas and Wisconsin co-op cash prices posted")),
        ("fert-head", "a description price off the file",
         sub("fertilizer.html", "anhydrous $832.", "anhydrous $840.")),
        ("fert-head", "a date range outside the file",
         sub("fertilizer.html", "Sep 24 to Oct 6, 2026", "Sep 2 to Oct 6, 2026")),
        ("fert-head", "a body price off the file (Sig Oct 19)",
         sub("fertilizer.html", "anhydrous $832.<!--/BAKE-->", "anhydrous $840.<!--/BAKE-->")),
        ("fert-head", "a body price written a second way",
         sub("fertilizer.html", "urea $616/ton (Kansas and Wisconsin), anhydrous $832.<!--/BAKE-->",
             "urea $615.95/ton (Kansas and Wisconsin), anhydrous $832.<!--/BAKE-->")),
        ("fert-head", "a body date range outside the file",
         sub("fertilizer.html", "fert-bar-->Kansas co-op cash prices posted Sep 24", "fert-bar-->Kansas co-op cash prices posted Sep 2")),
        ("milk-mailbox", "a stale FAQ mailbox month (N6)",
         sub("milk-prices.html", "<!--SEED:milkmbfaq-->In June 2026 the federal-order mailbox average was $20.18",
             "<!--SEED:milkmbfaq-->In March 2026 the federal-order mailbox average was $18.84")),
        ("staleness", "a price file two days old on a weekday",
         js("data/prices.json", lambda d: d.update(fetched="2026-10-13T06:00:00Z"))),
        ("counts", "a share count off the counts file (N11)",
         sub("cash-bids.html", "1,724 elevators", "1,720 elevators")),
    ]
    for rule, what, edit in cases:
        c = plant(rule, edit)
        ck(f"{rule}: catches {what}", any(x[0] == rule for x in c.findings), c.findings or c.notes)

    # Weekday evening (real file, 03:31 UTC Oct 20): close is Monday's last
    # trade, the newest settle Friday's; titles dated Oct 16 are right.
    with tempfile.TemporaryDirectory() as td:
        r = _fixture(td)
        js("data/prices.json", lambda d: [d["quotes"][k].update(close=v, close_kind="last", close_date="2026-10-19",
                                                               settle_date="2026-10-16")
                                          for k, v in (("corn-dec26", 466.75), ("beans-nov26", 1253.0),
                                                       ("wheat-dec26", 656.0), ("cattle", 228.0), ("feeders", 344.0))])(r)
        sub("corn-futures-prices.html", "Dec &#x27;26 $4.74\u00bc |", "Dec &#x27;26 $4.74\u00bc (Oct 16) |")(r)
        sub("soybean-futures-prices.html", "Nov '26 $12.61\u00bc |", "Nov '26 $12.61\u00bc (Oct 16) |")(r)
        sub("wheat-futures-prices.html", "Dec '26 $6.60\u00bd |", "Dec '26 $6.60\u00bd (Oct 16) |")(r)
        sub("cattle-futures-prices.html", "Live Cattle $227.55 |", "Live Cattle $227.55 (Oct 16) |")(r)
        c = run(r, now, only={"futures-heads"})
        ck("futures-heads: an evening title dated by its settle is no finding", not c.findings, c.findings)
    # a page script that keeps old words for old files is not reader text
    with tempfile.TemporaryDirectory() as td:
        c = run(_fixture(td), now, only={"settle-words"})
        ck("settle-words: script text is ignored", not c.findings, c.findings)
    # the Daily on another snapshot is noted, not counted as a disagreement
    c = plant("daily-basis", js("data/daily.json", lambda d: d["edge"]["facts"][0].update(snapshot="2026-10-17T02:37:16Z")))
    ck("daily-basis: another snapshot is a note, not a finding", not c.findings and c.notes, (c.findings, c.notes))
    # weekend: Friday's prices may be 74 hours old
    with tempfile.TemporaryDirectory() as td:
        r = _fixture(td)
        js("data/prices.json", lambda d: d.update(fetched="2026-10-16T22:00:00Z"))(r)
        c = run(r, dt.datetime(2026, 10, 19, 6, 0, tzinfo=dt.timezone.utc), only={"staleness"})
        ck("staleness: a Friday file is fine on Monday morning",
           not [x for x in c.findings if x[1] == "data/prices.json"], c.findings)
    # report mode exits 0 with findings; --strict would not
    c = plant("counts", sub("cash-bids.html", "1,724 elevators", "1,720 elevators"))
    ck("strict exit code follows findings", exit_code(c, strict=True) == 1 and exit_code(c, strict=False) == 0)
    if fails:
        print(f"selftest FAILED: {len(fails)}")
        return 1
    print("selftest ok")
    return 0


def exit_code(c, strict):
    return 1 if strict and c.findings else 0


def main(argv):
    if "--selftest" in argv:
        return selftest()
    c = run()
    report(c)
    return exit_code(c, "--strict" in argv)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
