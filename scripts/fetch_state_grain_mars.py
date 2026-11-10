#!/usr/bin/env python3
"""fetch_state_grain_mars.py -- data/state-grain-ams.json: USDA's own state daily
cash grain reports, read through USDA My Market News (the MARS API), as a
cross-check beside the AGSIST elevator median on the state basis sections.

Approved by Nov 2 2026 (state cash grain + slaughter). Data only: no page
reads this file yet. The state basis sections are all built by
scripts/build_cash_bid_pages.py, so the line that shows USDA beside our median
is added there later (see "FOR THE PAGE BUILDER" below).

REPORTS (USDA AMS slug ids, all daily, Mon-Fri, posted early afternoon Central)
  states (country elevator bids, by USDA's own regions)
    IA 2850 Iowa Daily Cash Grain Bids        IL 3192 Illinois Grain Bids
    NE 3225 Nebraska Daily Elevator Grain Bids KS 2886 Kansas Daily Grain Bids
    MN 3049 Southern Minnesota Daily Grain Bids SD 3186 South Dakota Daily Grain Bids
    ND 3878 North Dakota Daily Grain Bids     IN 3463 Indiana Grain Bids
    OH 2851 Ohio Daily Grain Bids             MO 2932 Missouri Daily Grain Bids
  terminals
    3046 Minneapolis Daily Grain Report       3223 Kansas City Board of Trade Daily Wheat Bids
    3043 Iowa-Southern Minnesota Barge Terminal Grain Bids
  export (kept apart from the states)
    3147 Louisiana and Texas Export Bids (Gulf)  3148 Portland Daily Grain Bids (PNW)

WHAT IS READ, PER STATE AND CROP (corn, soybeans, wheat by class)
  Only "Country Elevators" rows, plain bids: conventional, sale type Bid, yellow
  corn (white corn is a premium market), wheat split by class and protein.
  current   rows USDA marks current = Yes (spot / nearby)
  new_crop  rows for delivery in the next marketing year (corn and soybeans from
            Sep 1, wheat from Jun 1), kept apart and never mixed into current
  Other forward months are counted and left out.
  For each: the regions, the price range (lowest price low, highest price high),
  USDA's reported basis range per futures month, and avg_price = the simple
  average of USDA's regional average prices (USDA does not post a state average
  price row; where its narrative states one, as Iowa's does, it is kept as
  stated in usda_state_avg).

AVERAGE BASIS (avg_basis), AND WHY IT IS DERIVED
  USDA posts each region's basis low and high and its average PRICE, not an
  average basis. Every row carries a price and a basis against a named futures
  month, so price - basis is the futures price USDA used. Where all of a
  report's rows on one month agree on that futures price within a cent, the
  state average basis vs that month is avg_price minus it, in cents. If they do
  not agree, that month's average basis is withheld. A region whose low and high
  name different months still counts in the price average.

WITHHELD (never written as a number)
  A row with a missing, zero or negative price, a basis beyond 300 cents, or a
  low above its high. A state average from fewer than 2 regions, unless the
  report covers a single area (Southern Minnesota). A report older than
  STALE_DAYS keeps its entry but is marked stale. A report that does not answer
  keeps its last good entry from the previous file, with its own date.

FOR THE PAGE BUILDER (after agsist #261 merges)
  On /cash-bids/<state>/#basis, under the corn and soybean median, one quiet
  line, only when states[ST].crops[crop].current.avg_basis has the month our
  headline contract names and the report is not stale:
    "USDA's <State> average that day: 42 under Dec (USDA AMS, Iowa Daily Cash
     Grain Bids, Nov 2, 2026)."
  No link (Oct 29 rule). scripts/check_state_grain_ams.py makes the comparison.

DAILY
  daily_line (top level: the Gulf export bids) and states[ST].daily_line (that
  state's average corn and soybean price) are short plain lines the Daily can
  use later. Not wired in yet.

Usage:
  python3 scripts/fetch_state_grain_mars.py              # fetch (needs MARS_API_KEY), write
  python3 scripts/fetch_state_grain_mars.py --fixtures DIR [--out PATH] [--today YYYY-MM-DD]
        read saved MARS answers (DIR/<id>.json) instead of the API
  python3 scripts/fetch_state_grain_mars.py --selftest

MARS_API_KEY is an Actions secret (HTTP basic, key as user, empty password).
It is never printed or saved. With no key the run says so and writes nothing.
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import base64
import datetime
import json
import os
import statistics
import sys
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join("data", "state-grain-ams.json")
BASE = "https://marsapi.ams.usda.gov/services/v1.2/reports"
DAYS_BACK = 10          # query window; the newest report date in it is used
STALE_DAYS = 5          # calendar days; covers a long weekend
MIN_REGIONS = 2
MAX_BASIS_C = 300
FUT_AGREE = 0.0101      # $/bu: rows on one month must agree on the futures price within a cent

STATES = [
    ("IA", "Iowa", "2850"), ("IL", "Illinois", "3192"), ("NE", "Nebraska", "3225"),
    ("KS", "Kansas", "2886"), ("MN", "Southern Minnesota", "3049"), ("SD", "South Dakota", "3186"),
    ("ND", "North Dakota", "3878"), ("IN", "Indiana", "3463"), ("OH", "Ohio", "2851"),
    ("MO", "Missouri", "2932"),
]
TERMINALS = [("minneapolis", "Minneapolis", "3046"), ("kansas_city_wheat", "Kansas City wheat", "3223"),
             ("iowa_mn_barge", "Iowa-Southern Minnesota barge terminals", "3043")]
EXPORTS = [("gulf", "Louisiana and Texas Gulf", "3147"), ("pnw", "Portland (Pacific Northwest)", "3148")]
ALL_IDS = [x[2] for x in STATES + TERMINALS + EXPORTS]

MONTHS = {"F": "Jan", "G": "Feb", "H": "Mar", "J": "Apr", "K": "May", "M": "Jun",
          "N": "Jul", "Q": "Aug", "U": "Sep", "V": "Oct", "X": "Nov", "Z": "Dec"}
MON_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
WHEAT = {"hard red winter": "wheat_hrw", "soft red winter": "wheat_srw", "hard red spring": "wheat_hrs",
         "northern spring": "wheat_hrs", "ns/dns": "wheat_hrs", "dark northern spring": "wheat_hrs",
         "soft white": "wheat_sw", "club white": "wheat_cw", "hard white": "wheat_hw"}
CROP_LABEL = {"corn": "corn", "soybeans": "soybeans", "wheat_hrw": "hard red winter wheat",
              "wheat_srw": "soft red winter wheat", "wheat_hrs": "spring wheat", "wheat_sw": "soft white wheat",
              "wheat_cw": "club white wheat", "wheat_hw": "hard white wheat"}
METHOD = ("USDA AMS state daily grain reports through My Market News. Country elevator bids only. Basis is USDA's reported figure, withheld where USDA's rows disagree or too few regions report.")


# ---------- MARS ----------

def auth_header():
    key = os.environ.get("MARS_API_KEY", "").strip()
    if not key:
        return None
    return "Basic " + base64.b64encode((key + ":").encode()).decode()


def mars_get(slug, days=DAYS_BACK, today=None, opener=None, tries=3):
    """One report's last `days` days, all sections. Returns the parsed JSON body.
    Raises RuntimeError with a short reason (never the key)."""
    today = today or datetime.date.today()
    a = today - datetime.timedelta(days=days)
    url = "%s/%s?q=report_begin_date=%s:%s&allSections=true" % (
        BASE, slug, a.strftime("%m/%d/%Y"), today.strftime("%m/%d/%Y"))
    if opener:
        return opener(url)
    hdr = auth_header()
    if not hdr:
        raise RuntimeError("no MARS_API_KEY")
    last = ""
    for i in range(tries):
        req = urllib.request.Request(url, headers={"Authorization": hdr, "Accept": "application/json",
                                                   "User-Agent": "agsist.com data reader"})
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            last = "HTTP %s" % e.code
            if e.code in (401, 403, 404):
                break
        except Exception as e:  # network, timeout, bad JSON
            last = type(e).__name__
        time.sleep(3 * (i + 1))
    raise RuntimeError("MARS %s: %s" % (slug, last))


def sections(body):
    """A MARS answer -> {section name: rows}. allSections gives a list of
    section objects; a single section gives {"results": [...]} or a bare list."""
    out = {}
    if isinstance(body, dict):
        body = [body]
    if not isinstance(body, list):
        return out
    if body and isinstance(body[0], dict) and "reportSection" not in body[0] and "results" not in body[0]:
        return {"Report Detail": body}
    for s in body:
        if not isinstance(s, dict):
            continue
        name = s.get("reportSection") or "Report Detail"
        rows = s.get("results") or []
        if isinstance(rows, list):
            out.setdefault(name, []).extend(r for r in rows if isinstance(r, dict))
    return out


# ---------- parsing ----------

def iso(mdy):
    """'11/02/2026' or '11/02/2026 15:47:44' -> '2026-11-02'; '2026-11-02' passes."""
    s = str(mdy or "").strip()
    if len(s) >= 10 and s[4] == "-":
        return s[:10]
    try:
        return datetime.datetime.strptime(s[:10], "%m/%d/%Y").date().isoformat()
    except ValueError:
        return None


def num(v):
    if v is None or v == "":
        return None
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return x if x == x else None


def month_letter(s):
    """'December (Z)' -> 'Z'."""
    s = str(s or "")
    if "(" in s and s.rstrip().endswith(")"):
        c = s.rstrip()[-2]
        return c if c in MONTHS else None
    return None


def crop_key(row):
    com = str(row.get("commodity") or "").strip().lower()
    cls = str(row.get("class") or "").strip().lower()
    if com == "corn":
        return "corn" if cls in ("", "yellow") else None
    if com == "soybeans":
        return "soybeans" if cls in ("", "yellow") else None
    if com == "wheat":
        return WHEAT.get(cls)
    return None


def protein(row):
    p = str(row.get("protein") or "").strip()
    return None if p.lower() in ("", "ordinary", "none", "n/a") else p


def plain(row):
    """A plain bid USDA prices as the market (not a premium or specialty row)."""
    if str(row.get("conventional") or "Conventional").strip().lower() != "conventional":
        return False
    if str(row.get("sale Type") or "Bid").strip().lower() != "bid":
        return False
    for k in ("desc", "application"):
        if row.get(k):
            return False
    return True


def period(row, report_day, crop):
    """'current' | 'new_crop' | 'forward'."""
    if str(row.get("current") or "").strip().lower() == "yes":
        return "current"
    ds = iso(row.get("delivery_start"))
    if not ds:
        return "forward"
    d = datetime.date.fromisoformat(ds)
    start_m = 6 if crop.startswith("wheat") else 9
    y = report_day.year if report_day.month >= start_m else report_day.year - 1
    next_my = datetime.date(y + 1, start_m, 1)
    return "new_crop" if d >= next_my else "forward"


def clean(row):
    """The numbers of one row, or None when it must be withheld."""
    plo, phi, avg = num(row.get("price Min")), num(row.get("price Max")), num(row.get("avg_price"))
    blo, bhi = num(row.get("basis Min")), num(row.get("basis Max"))
    if plo is None or phi is None or plo <= 0 or phi <= 0 or plo > phi + 1e-9:
        return None
    if avg is not None and (avg <= 0 or avg < plo - 1e-6 or avg > phi + 1e-6):
        avg = None
    mlo, mhi = month_letter(row.get("basis Min Futures Month")), month_letter(row.get("basis Max Futures Month"))
    basis_ok = (blo is not None and bhi is not None and mlo and mhi
                and abs(blo) <= MAX_BASIS_C and abs(bhi) <= MAX_BASIS_C)
    if basis_ok and mlo == mhi and blo > bhi:
        basis_ok = False
    return {"plo": plo, "phi": phi, "avg": avg,
            "blo": blo if basis_ok else None, "bhi": bhi if basis_ok else None,
            "mlo": mlo if basis_ok else None, "mhi": mhi if basis_ok else None}


def family(ck):
    """The futures a crop's basis is quoted against: hard white wheat trades off
    the Kansas City (hard red winter) contract."""
    return "wheat_hrw" if ck == "wheat_hw" else ck


def implied_futures(rows):
    """{(futures family, month letter): futures $/bu} from every row's price -
    basis, kept only where all rows naming that contract agree within FUT_AGREE.
    Corn, soybean and each wheat class's December are different contracts."""
    seen = {}
    for r in rows:
        c, ck = clean(r), crop_key(r)
        if not c or c["mlo"] is None or not ck:
            continue
        f = family(ck)
        seen.setdefault((f, c["mlo"]), []).append(c["plo"] - c["blo"] / 100.0)
        seen.setdefault((f, c["mhi"]), []).append(c["phi"] - c["bhi"] / 100.0)
    out = {}
    for m, xs in seen.items():
        if max(xs) - min(xs) <= FUT_AGREE:
            out[m] = statistics.median(xs)
    return out


def r4(x):
    return None if x is None else round(x + 0.0, 4)


def aggregate(rows, fut, single_area):
    """Rows of one state, crop, protein and period -> the summary record.
    fut: {month letter: futures} for this crop's contract (implied_futures)."""
    regions, prices, avgs, by_m, named = [], [], [], {}, {}
    for r in rows:
        c = clean(r)
        if not c:
            continue
        name = r.get("trade_loc") or r.get("delivery_point") or "state"
        regions.append(name)
        prices += [c["plo"], c["phi"]]
        if c["avg"] is not None:
            avgs.append(c["avg"])
        if c["mlo"] is not None:
            by_m.setdefault(c["mlo"], []).append(c["blo"])
            by_m.setdefault(c["mhi"], []).append(c["bhi"])
            for m in {c["mlo"], c["mhi"]}:
                named[m] = named.get(m, 0) + 1
    if not regions:
        return None
    rec = {"regions": len(regions), "price_lo": r4(min(prices)), "price_hi": r4(max(prices))}
    enough = len(avgs) >= MIN_REGIONS or (single_area and len(avgs) >= 1)
    avg_price = statistics.mean(avgs) if avgs and enough else None
    rec["avg_price"] = r4(avg_price)
    rec["avg_n"] = len(avgs)
    order = lambda k: "FGHJKMNQUVXZ".index(k)  # noqa: E731
    basis = {m: {"label": MONTHS[m], "lo": int(round(min(by_m[m]))), "hi": int(round(max(by_m[m]))),
                 "regions": named[m]} for m in sorted(by_m, key=order)}
    if basis:
        rec["basis"] = basis
        # the month most regions name (ties: the earlier contract in the calendar)
        rec["month"] = sorted(basis, key=lambda m: (-named[m], order(m)))[0]
    avg_basis = {m: int(round((avg_price - fut[m]) * 100)) for m in sorted(basis, key=order)
                 if avg_price is not None and m in fut}
    if avg_basis:
        rec["avg_basis"] = avg_basis
    return rec


def delivery_label(rows):
    ds = sorted({iso(r.get("delivery_start")) for r in rows if iso(r.get("delivery_start"))})
    de = sorted({iso(r.get("delivery_end")) for r in rows if iso(r.get("delivery_end"))})
    if not ds:
        return None
    a = datetime.date.fromisoformat(ds[0])
    b = datetime.date.fromisoformat((de or ds)[-1])
    la = "%s %d" % (MON_ABBR[a.month - 1], a.year)
    lb = "%s %d" % (MON_ABBR[b.month - 1], b.year)
    return la if la == lb else "%s %d to %s" % (MON_ABBR[a.month - 1], a.year, lb) if a.year != b.year \
        else "%s to %s" % (MON_ABBR[a.month - 1], lb)


def latest(secs):
    """(report day iso, detail rows of that day, header row or {})."""
    det = secs.get("Report Detail") or []
    days = sorted({iso(r.get("report_date")) for r in det if iso(r.get("report_date"))})
    if not days:
        return None, [], {}
    d = days[-1]
    rows = [r for r in det if iso(r.get("report_date")) == d]
    hdr = next((h for h in secs.get("Report Header") or [] if iso(h.get("report_date")) == d), {})
    return d, rows, hdr


def state_avg_from_narrative(text):
    """Iowa's narrative: 'State Average Price: Corn -- $4.06 (-.42Z) Up 1 cent | Soybeans -- $11.36 (-.81X) ...'
    -> {'corn': {'price': 4.06, 'basis': -42, 'month': 'Z'}, ...}. Anything else -> {}."""
    import re
    out = {}
    s = str(text or "")
    if "state average price" not in s.lower():
        return out
    seg = s[s.lower().index("state average price"):].split("\n")[0]
    for m in re.finditer(r"(Corn|Soybeans)\s*--\s*\$(\d+\.\d+)\s*\(\s*([+-]?\d*\.\d+)\s*([FGHJKMNQUVXZ])\s*\)", seg):
        out[m.group(1).lower()] = {"price": float(m.group(2)), "basis": int(round(float(m.group(3)) * 100)),
                                   "month": m.group(4)}
    return out


def human_day(isod):
    d = datetime.date.fromisoformat(isod)
    return "%s %d, %d" % (MON_ABBR[d.month - 1], d.day, d.year)


def source_line(title, day):
    return "USDA AMS, %s, %s" % (title, human_day(day))


def cents_words(c, month_label):
    if c == 0:
        return "even with %s" % month_label
    return "%d %s %s" % (abs(c), "under" if c < 0 else "over", month_label)


def parse_state(secs, code, name, today):
    day, rows, hdr = latest(secs)
    if not day:
        return None, "no report rows in the window"
    title = (rows[0].get("report_title") if rows else None) or hdr.get("report_title") or name
    rday = datetime.date.fromisoformat(day)
    fut = implied_futures(rows)
    locs = {r.get("trade_loc") for r in rows if str(r.get("delivery_point")) == "Country Elevators"}
    single = len(locs) <= 1
    groups, skipped = {}, {"forward": 0, "not_plain": 0, "other_points": 0}
    for r in rows:
        if str(r.get("delivery_point") or "").strip() != "Country Elevators":
            skipped["other_points"] += 1
            continue
        ck = crop_key(r)
        if not ck or not plain(r):
            skipped["not_plain"] += 1
            continue
        p = period(r, rday, ck)
        if p == "forward":
            skipped["forward"] += 1
            continue
        groups.setdefault((ck, protein(r), p), []).append(r)
    crops = {}
    for (ck, prot, p), rs in sorted(groups.items(), key=lambda kv: (kv[0][0], kv[0][1] or "", kv[0][2])):
        rec = aggregate(rs, {m: v for (f, m), v in fut.items() if f == family(ck)}, single)
        if not rec:
            continue
        if p == "new_crop":
            rec["delivery"] = delivery_label(rs)
        key = ck if not prot else "%s_%s" % (ck, prot.replace("%", "").replace(".0", ""))
        c = crops.setdefault(key, {"crop": ck})
        if prot:
            c["protein"] = prot
        c[p] = rec
    if not crops:
        return None, "no plain country elevator rows"
    stated = state_avg_from_narrative(hdr.get("report_narrative"))
    ent = {"name": name, "report_id": int(secs_slug(rows) or 0) or None, "report": title,
           "report_date": day, "published": str(hdr.get("published_date") or rows[0].get("published_date") or "")[:19] or None,
           "source": source_line(title, day), "single_area": single,
           "stale": (today - rday).days > STALE_DAYS, "crops": crops, "left_out": skipped}
    if stated:
        ent["usda_state_avg"] = stated
    ent["daily_line"] = state_daily_line(ent)
    return ent, None


def secs_slug(rows):
    for r in rows:
        if r.get("slug_id"):
            return r.get("slug_id")
    return None


def state_daily_line(ent):
    parts = []
    for ck in ("corn", "soybeans"):
        cur = (ent["crops"].get(ck) or {}).get("current") or {}
        if cur.get("avg_price") is None:
            continue
        bits = "%s $%.2f" % (ck, cur["avg_price"])
        m = cur.get("month")
        if m and m in (cur.get("avg_basis") or {}):
            bits += " (%s)" % cents_words(cur["avg_basis"][m], MONTHS[m])
        parts.append(bits)
    if not parts or ent.get("stale"):
        return None
    return "USDA's %s average cash bids: %s. %s." % (ent["name"], ", ".join(parts), ent["source"])


def parse_points(secs, name, today, keep_forward=3):
    """Terminal and export reports: per crop and delivery point, the current
    rows and the nearest `keep_forward` forward periods, as USDA reports them."""
    day, rows, hdr = latest(secs)
    if not day:
        return None, "no report rows in the window"
    title = (rows[0].get("report_title") if rows else None) or name
    groups = {}
    for r in rows:
        ck = crop_key(r)
        if not ck or not plain(r):
            continue
        c = clean(r)
        if not c:
            continue
        cur = str(r.get("current") or "").strip().lower() == "yes"
        ds = iso(r.get("delivery_start"))
        half = str(r.get("delivery Start Half") or "").strip()
        per = "current" if cur else ((ds[:7] if ds else "later") + ((" " + half.lower()) if half else ""))
        key = (ck, protein(r) or "", str(r.get("delivery_point") or ""), str(r.get("trade_loc") or ""),
               str(r.get("trans_mode") or ""), str(r.get("freight") or ""))
        groups.setdefault(key, {}).setdefault(per, []).append(c)
    bids = []
    for key in sorted(groups):
        ck, prot, point, loc, mode, frt = key
        pers = groups[key]
        order = sorted((p for p in pers if p != "current"), key=lambda p: (p[:7], "last" in p))
        chosen = (["current"] if "current" in pers else []) + order[:keep_forward]
        for p in chosen:
            cs = pers[p]
            b = {"crop": ck, "point": point, "period": p}
            if loc:
                b["location"] = loc
            if prot:
                b["protein"] = prot
            if mode:
                b["mode"] = mode
            if frt:
                b["freight"] = frt
            b["price_lo"] = r4(min(x["plo"] for x in cs))
            b["price_hi"] = r4(max(x["phi"] for x in cs))
            ms = {x["mlo"] for x in cs if x["mlo"]} | {x["mhi"] for x in cs if x["mhi"]}
            if len(ms) == 1:
                m = ms.pop()
                b["basis_month"] = MONTHS[m]
                b["basis_lo"] = int(round(min(x["blo"] for x in cs if x["blo"] is not None)))
                b["basis_hi"] = int(round(max(x["bhi"] for x in cs if x["bhi"] is not None)))
            bids.append(b)
    if not bids:
        return None, "no plain rows"
    rday = datetime.date.fromisoformat(day)
    return {"name": name, "report_id": int(secs_slug(rows) or 0) or None, "report": title, "report_date": day,
            "source": source_line(title, day), "stale": (today - rday).days > STALE_DAYS, "bids": bids}, None


def cents_range(lo, hi, month_label):
    """-5, 10, 'Dec' -> '5 under to 10 over Dec'; 92, 97 -> '92 to 97 over Dec'."""
    if lo == hi:
        return cents_words(lo, month_label)
    if lo > 0 and hi > 0:
        return "%d to %d over %s" % (lo, hi, month_label)
    if lo < 0 and hi < 0:
        return "%d to %d under %s" % (abs(hi), abs(lo), month_label)
    return "%s to %s" % (cents_words(lo, month_label).rsplit(" ", 1)[0], cents_words(hi, month_label))


def gulf_line(ent):
    """The spot Gulf bid per crop (USDA's current row; else its nearest month)."""
    if not ent or ent.get("stale"):
        return None
    parts = []
    for ck in ("corn", "soybeans"):
        bs = [b for b in ent["bids"] if b["crop"] == ck and "basis_lo" in b]
        bs.sort(key=lambda b: (b["period"] != "current", b["period"]))
        if not bs:
            continue
        b = bs[0]
        when = ""
        if b["period"] != "current":
            m = int(b["period"][5:7])
            when = " for %s%s" % ("first half of " if "first" in b["period"] else "last half of " if "last" in b["period"] else "",
                                  MON_ABBR[m - 1])
        parts.append("%s %s%s" % (ck, cents_range(b["basis_lo"], b["basis_hi"], b["basis_month"]), when))
    if not parts:
        return None
    return "Gulf export bids, barge CIF: %s. %s." % ("; ".join(parts), ent["source"])


# ---------- build ----------

def build(get, prev=None, today=None, log=print):
    """get(slug) -> MARS body (raises on failure). prev: the previous file or None."""
    today = today or datetime.date.today()
    prev = prev or {}
    doc = {"schema": "agsist-state-grain-ams/1", "generated": datetime.datetime.now(datetime.timezone.utc)
           .strftime("%Y-%m-%dT%H:%M:%SZ"), "method": METHOD, "states": {}, "terminals": {}, "export": {},
           "status": {}}
    ok = 0
    for kind, table, parse in (("states", STATES, None), ("terminals", TERMINALS, 1), ("export", EXPORTS, 1)):
        for key, name, slug in table:
            try:
                secs = sections(get(slug))
                ent, why = (parse_state(secs, key, name, today) if parse is None else parse_points(secs, name, today))
            except Exception as e:  # one report failing never stops the others
                ent, why = None, str(e)[:120]
            old = (prev.get(kind) or {}).get(key)
            if ent and old and old.get("report_date", "") > ent["report_date"]:
                ent, why = None, "older than the kept entry"
            if ent:
                doc[kind][key] = ent
                doc["status"][slug] = "ok " + ent["report_date"]
                ok += 1
            else:
                if old:
                    old = dict(old)
                    old["stale"] = (today - datetime.date.fromisoformat(old["report_date"])).days > STALE_DAYS
                    if old["stale"] and kind == "states":
                        old["daily_line"] = None
                    doc[kind][key] = old
                doc["status"][slug] = "kept last good (%s)" % why if old else "none (%s)" % why
            log("  %-5s %-28s %s" % (slug, name[:28], doc["status"][slug]))
    doc["daily_line"] = gulf_line(doc["export"].get("gulf"))
    return doc, ok


def write(doc, out):
    path = out if os.path.isabs(out) else os.path.join(ROOT, out)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=1, sort_keys=False)
        f.write("\n")
    os.replace(tmp, path)


def load(path):
    p = path if os.path.isabs(path) else os.path.join(ROOT, path)
    try:
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def fixture_getter(d):
    def get(slug):
        with open(os.path.join(d, "%s.json" % slug), encoding="utf-8") as f:
            return json.load(f)
    return get


# ---------- selftest ----------

def selftest():
    fails, n = [], [0]

    def ck(name, cond, detail=""):
        n[0] += 1
        print("  %s %s%s" % ("ok  " if cond else "FAIL", name, "" if cond else "  " + str(detail)[:300]))
        if not cond:
            fails.append(name)

    ck("month letter", month_letter("December (Z)") == "Z" and month_letter("x") is None)
    ck("iso dates", iso("11/02/2026 15:47:44") == "2026-11-02" and iso("2026-11-02") == "2026-11-02" and iso("") is None)
    ck("crop keys", crop_key({"commodity": "Corn", "class": "Yellow"}) == "corn"
       and crop_key({"commodity": "Corn", "class": "White"}) is None
       and crop_key({"commodity": "Wheat", "class": "NS/DNS"}) == "wheat_hrs"
       and crop_key({"commodity": "Sorghum"}) is None)
    base = {"commodity": "Corn", "class": "Yellow", "delivery_point": "Country Elevators", "conventional": "Conventional",
            "sale Type": "Bid", "current": "Yes", "report_date": "11/02/2026", "report_title": "Test Grain Bids",
            "basis Min Futures Month": "December (Z)", "basis Max Futures Month": "December (Z)"}

    def row(loc, blo, bhi, plo, phi, avg, **kw):
        r = dict(base, trade_loc=loc, **{"basis Min": blo, "basis Max": bhi, "price Min": plo, "price Max": phi,
                                         "avg_price": avg})
        r.update(kw)
        return r

    rows = [row("North", -48, -40, 4.0025, 4.0825, 4.0615), row("South", -40, -30, 4.0825, 4.1825, 4.1054)]
    fut = {m: v for (f, m), v in implied_futures(rows).items() if f == "corn"}
    ck("implied futures from price minus basis", abs(fut["Z"] - 4.4825) < 1e-9, fut)
    a = aggregate(rows, fut, False)
    ck("state avg basis = mean avg price - futures", a["avg_basis"]["Z"] == round(((4.0615 + 4.1054) / 2 - 4.4825) * 100), a)
    wz = implied_futures(rows + [dict(row("North", -80, -60, 5.66, 5.86, 5.76), commodity="Wheat", **{"class": "Hard Red Winter"})])
    ck("corn December and wheat December are different contracts", ("corn", "Z") in wz and ("wheat_hrw", "Z") in wz, wz)
    ck("price range across regions", a["price_lo"] == 4.0025 and a["price_hi"] == 4.1825, a)
    one = aggregate(rows[:1], fut, False)
    ck("one region of many: average withheld", one["avg_price"] is None and "avg_basis" not in one, one)
    ck("single-area report keeps its one average", aggregate(rows[:1], fut, True)["avg_price"] == 4.0615)
    bad = rows + [row("East", -45, -35, 4.10, 4.20, 4.15)]   # implies 4.55: disagrees by 7 cents
    ck("futures that disagree withhold the average basis", ("corn", "Z") not in implied_futures(bad))
    ck("zero price withheld", clean(row("x", -40, -30, 0, 4.1, 4.0)) is None)
    ck("low above high withheld", clean(row("x", -40, -30, 4.2, 4.1, 4.15)) is None)
    ck("basis beyond 300c dropped, price kept", clean(row("x", -400, -30, 4.0, 4.1, 4.05))["blo"] is None)
    d = datetime.date(2026, 11, 2)
    ck("periods", period(dict(base), d, "corn") == "current"
       and period(dict(base, current="No", delivery_start="2027-05-01"), d, "corn") == "forward"
       and period(dict(base, current="No", delivery_start="2027-10-01"), d, "corn") == "new_crop"
       and period(dict(base, current="No", delivery_start="2027-06-01"), d, "wheat_srw") == "new_crop")
    st = state_avg_from_narrative("State Average Price: Corn -- $4.06 (-.42Z) Up 1 cent | Soybeans -- $11.36 (-.81X) Down 15 cents\nTerminal")
    ck("Iowa narrative state average read as stated", st == {"corn": {"price": 4.06, "basis": -42, "month": "Z"},
                                                             "soybeans": {"price": 11.36, "basis": -81, "month": "X"}}, st)
    ck("no narrative, no stated average", state_avg_from_narrative("Daily Trends: Corn unchanged") == {})
    secs = sections([{"reportSection": "Report Header", "results": [{"report_date": "11/02/2026", "report_narrative": None}]},
                     {"reportSection": "Report Detail", "results": rows + [row("North", -50, -42, 4.0, 4.08, 4.05, report_date="10/30/2026")]}])
    ent, why = parse_state(secs, "XX", "Test", d)
    ck("newest report day only", ent and ent["report_date"] == "2026-11-02" and ent["crops"]["corn"]["current"]["regions"] == 2, ent or why)
    ck("daily line names source and date, no em dash", ent["daily_line"].endswith("USDA AMS, Test Grain Bids, Nov 2, 2026.")
       and "—" not in ent["daily_line"], ent["daily_line"])
    ent2, _ = parse_state(secs, "XX", "Test", datetime.date(2026, 11, 20))
    ck("old report is stale, no daily line", ent2["stale"] and ent2["daily_line"] is None)

    # a failing report keeps its last good entry; an older answer never replaces a newer one
    def get_fail(slug):
        raise RuntimeError("HTTP 500")
    prev = {"states": {"IA": {"report_date": "2026-11-02", "name": "Iowa", "crops": {}, "daily_line": "x"}}}
    doc, okn = build(get_fail, prev, today=d, log=lambda *a: None)
    ck("failure keeps last good", okn == 0 and doc["states"]["IA"]["report_date"] == "2026-11-02"
       and doc["status"]["2850"].startswith("kept last good"), doc["status"].get("2850"))
    ck("failure with nothing kept writes nothing for it", "IL" not in doc["states"])

    # real case: the saved MARS answers of Nov 2, 2026
    fx = os.path.join(ROOT, "test", "fixtures", "mars-grain")
    if os.path.isdir(fx):
        doc, okn = build(fixture_getter(fx), None, today=d, log=lambda *a: None)
        ck("real case: all 15 reports read", okn == 15, doc["status"])
        ia = doc["states"]["IA"]["crops"]["corn"]["current"]
        ck("real case: Iowa corn 6 regions, $3.8325 to $4.3225", ia["regions"] == 6 and ia["price_lo"] == 3.8325
           and ia["price_hi"] == 4.3225, ia)
        ck("real case: Iowa corn avg basis -41 Dec (USDA's narrative says -42)", ia["avg_basis"] == {"Z": -41}, ia)
        so = doc["states"]["IA"]["crops"]["soybeans"]["current"]
        ck("real case: Iowa soybeans vs Jan -82 (USDA's narrative $11.36 is 81 under the Jan its rows imply)",
           so["avg_basis"]["F"] == -82 and so["avg_basis"]["X"] == -70, so)
        il = doc["states"]["IL"]["crops"]["corn"]["current"]
        ck("real case: Illinois corn avg basis vs Dec (wheat Dec not mixed in)", il["avg_basis"].get("Z") == -18, il)
        ck("real case: Iowa stated state average kept", doc["states"]["IA"]["usda_state_avg"]["corn"]["basis"] == -42)
        ck("real case: Ohio SRW new crop kept apart", "new_crop" in doc["states"]["OH"]["crops"].get("wheat_srw", {})
           and doc["states"]["OH"]["crops"]["wheat_srw"]["new_crop"]["delivery"] == "Jun to Jul 2027",
           doc["states"]["OH"]["crops"].get("wheat_srw"))
        ck("real case: white corn left out of Indiana", all(k != "corn_white" for k in doc["states"]["IN"]["crops"]))
        ck("real case: Gulf has corn and soybean bids", {b["crop"] for b in doc["export"]["gulf"]["bids"]} >= {"corn", "soybeans"})
        ck("cents ranges", cents_range(92, 97, "Dec") == "92 to 97 over Dec" and cents_range(-65, -16, "Dec") == "16 to 65 under Dec"
           and cents_range(-5, 10, "Dec") == "5 under to 10 over Dec" and cents_range(0, 0, "Dec") == "even with Dec")
        ck("real case: top daily line is the Gulf spot bid", (doc["daily_line"] or "").startswith(
            "Gulf export bids, barge CIF: corn 92 to 94 over Dec; soybeans 109 to 116 over Nov.")
           and "Louisiana and Texas Export Bids, Nov 2, 2026" in doc["daily_line"], doc["daily_line"])
        s = json.dumps(doc)
        ck("real case: no em dash, no link, no key", "—" not in s and "http" not in s and "MARS_API_KEY" not in s)
        ck("real case: file is small (< 60 KB)", len(s) < 60000, len(s))
    else:
        ck("real-case fixtures present", False, fx)
    print("fetch_state_grain_mars selftest: %s (%d checks)" % ("all ok" if not fails else "%d FAILED" % len(fails), n[0]))
    return 0 if not fails else 1


def main(argv):
    if "--selftest" in argv:
        return selftest()
    out = OUT
    if "--out" in argv:
        out = argv[argv.index("--out") + 1]
    today = None
    if "--today" in argv:
        today = datetime.date.fromisoformat(argv[argv.index("--today") + 1])
    if "--fixtures" in argv:
        get = fixture_getter(argv[argv.index("--fixtures") + 1])
    else:
        if not auth_header():
            print("state grain: no MARS_API_KEY; nothing fetched, the file is left as it is")
            return 0
        get = lambda slug: mars_get(slug, today=today)  # noqa: E731
    prev = load(out)
    doc, ok = build(get, prev, today=today)
    if ok == 0 and prev:
        print("state grain: no report answered; the file is left as it is")
        return 0
    if not (doc["states"] or doc["terminals"] or doc["export"]):
        print("state grain: nothing to write")
        return 0
    write(doc, out)
    print("state grain: %d of %d reports read, wrote %s" % (ok, len(ALL_IDS), out))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
