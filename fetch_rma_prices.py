#!/usr/bin/env python3
"""
AGSIST — RMA price discovery feed.

Pulls USDA RMA's own Price Discovery data service, which is the authoritative
record of crop insurance price discovery: for every commodity / type / practice
/ state it carries the projected and harvest discovery windows, the exchange and
contract behind each, the released prices, and — while a window is open — the
running average to date with status "In Discovery".

Why this and not our own futures math: RMA computes these averages itself under
the Commodity Exchange Price Provisions, including the multiplicative and
additive factors that make (say) organic wheat or high-amylose corn differ from
the board. Recomputing that from settlements would be a re-implementation of
someone else's rulebook. Reading their number is both simpler and correct.

Source (OData/Atom):
  .../PriceDiscovery/Services/RevenuePriceDataService.svc/RevenuePrices
  ?discoveryPeriodDate=M/D/YYYY[&$filter=...][&$skip=N]

The service pages at 16 records. $skip and $filter work; $inlinecount does not
(500s). So we page until a page comes back empty.

Honesty rails
  - Nothing is written unless the pull succeeded and returned records.
  - Prices inside an open window are carried with their RMA status verbatim
    ("In Discovery"), never relabelled as final.
  - If the server ignores $skip and hands back a page we have already seen, the
    run FAILS rather than silently publishing a truncated file.
  - --probe pulls, reports what it found, and writes nothing.

Writes
  data/rma-prices.json        every row for the crop year
  data/rma-discovery-now.json small: what is open today and what opens next
"""
import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
OUT_ALL = REPO / "data" / "rma-prices.json"
OUT_NOW = REPO / "data" / "rma-discovery-now.json"

BASE = ("https://public-rma.fpac.usda.gov/apps/PriceDiscovery/Services/"
        "RevenuePriceDataService.svc/RevenuePrices")
DS = "{http://schemas.microsoft.com/ado/2007/08/dataservices}"
ATOM = "{http://www.w3.org/2005/Atom}"

PAGE = 16
MAX_PAGES = 2000          # backstop; a crop year is a few thousand rows
UPCOMING_DAYS = 75        # how far ahead "opens next" looks

# Short keys keep the published file small; the page reads these names.
FIELDS = [
    ("key", "CompositeKey"),
    ("year", "CommodityYear"),
    ("crop", "CommodityName"),
    ("type", "TypeName"),
    ("practice", "PracticeName"),
    ("state", "StateName"),
    ("st", "StateCode"),
    ("scd", "SalesClosingDateDisplay"),
    ("p_exch", "ProjectedPriceExchangeCode"),
    ("p_sym", "ProjectedSymbolName"),
    ("p_mon", "ProjectedMonthName"),
    ("p_yr", "ProjectedYear"),
    ("p_start", "ProjectedPriceBeginDate"),
    ("p_end", "ProjectedPriceEndDate"),
    ("p_price", "ProjectedPrice"),
    ("p_status", "ProjectedPriceStatus"),
    ("h_exch", "HarvestPriceExchangeCode"),
    ("h_sym", "HarvestSymbolCode"),
    ("h_mon", "HarvestMonthName"),
    ("h_yr", "HarvestYear"),
    ("h_start", "HarvestPriceBeginDate"),
    ("h_end", "HarvestPriceEndDate"),
    ("h_price", "HarvestPrice"),
    ("h_status", "HarvestPriceStatus"),
    ("vol", "ApprovedPriceVolatilityPercent"),
]


# ---------------------------------------------------------------- fetching

def _get(url, timeout=60, tries=4):
    last = None
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": "agsist.com price-discovery mirror (contact via agsist.com/contact)",
                "Accept": "application/atom+xml,application/xml;q=0.9",
            })
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as exc:                      # noqa: BLE001
            last = exc
            if attempt < tries - 1:
                time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"GET failed after {tries} tries: {url}\n  {last}")


def page_url(disc_date, skip, filt=None):
    q = {"discoveryPeriodDate": disc_date}
    if filt:
        q["$filter"] = filt
    if skip:
        q["$skip"] = str(skip)
    return BASE + "?" + urllib.parse.urlencode(q, quote_via=urllib.parse.quote)


def parse_entries(xml_bytes):
    """Every <entry>'s <m:properties> as a plain dict of the d: children."""
    root = ET.fromstring(xml_bytes)
    out = []
    for entry in root.iter(ATOM + "entry"):
        rec = {}
        for prop in entry.iter():
            if prop.tag.startswith(DS):
                name = prop.tag[len(DS):]
                if name == "properties":
                    continue
                rec[name] = (prop.text or "").strip()
        if rec:
            out.append(rec)
    return out


def pull(disc_date, filt=None, verbose=True):
    """Page through the whole result set. Fails loudly on a repeated page."""
    seen_keys = set()
    rows = []
    prev_sig = None
    for i in range(MAX_PAGES):
        url = page_url(disc_date, i * PAGE, filt)
        entries = parse_entries(_get(url))
        if not entries:
            break
        sig = tuple(e.get("CompositeKey", "") for e in entries)
        if sig == prev_sig:
            raise RuntimeError(
                "the service returned the same page twice at $skip=%d — it is "
                "ignoring $skip, so any file written now would be a truncated "
                "slice of the real feed. Refusing to write.\n  %s"
                % (i * PAGE, url))
        prev_sig = sig
        fresh = 0
        for e in entries:
            k = e.get("CompositeKey")
            if k and k in seen_keys:
                continue
            if k:
                seen_keys.add(k)
            rows.append(e)
            fresh += 1
        if verbose and i % 10 == 0:
            print(f"  page {i:4d}  skip={i * PAGE:6d}  +{fresh}  total={len(rows)}",
                  flush=True)
        if len(entries) < PAGE:
            break
        time.sleep(0.15)
    else:
        raise RuntimeError(f"hit MAX_PAGES={MAX_PAGES} without the feed ending")
    return rows


# ---------------------------------------------------------------- shaping

def _num(v):
    if v in (None, ""):
        return None
    try:
        f = float(v)
    except ValueError:
        return None
    return round(f, 4)


def _day(v):
    """RMA hands back 2026-08-01T00:00:00; we only ever want the date."""
    if not v:
        return None
    m = re.match(r"(\d{4}-\d{2}-\d{2})", v)
    return m.group(1) if m else None


NUMERIC = {"p_price", "h_price", "vol"}
DATES = {"p_start", "p_end", "h_start", "h_end"}


def shape(raw):
    out = []
    for r in raw:
        rec = {}
        for short, long in FIELDS:
            v = r.get(long, "")
            if short in DATES:
                v = _day(v)
            elif short in NUMERIC:
                v = _num(v)
            elif short in ("year", "p_yr", "h_yr"):
                v = int(v) if str(v).strip().isdigit() else None
            rec[short] = v if v != "" else None
        out.append(rec)
    out.sort(key=lambda r: (r.get("crop") or "", r.get("state") or "",
                            r.get("type") or "", r.get("practice") or ""))
    return out


def windows(rows, today):
    """Every discovery window as its own record, tagged open / next / closed."""
    horizon = today + timedelta(days=UPCOMING_DAYS)
    open_w, next_w = [], []
    for r in rows:
        for leg, s, e, price, status, exch, mon in (
            ("projected", "p_start", "p_end", "p_price", "p_status", "p_exch", "p_mon"),
            ("harvest", "h_start", "h_end", "h_price", "h_status", "h_exch", "h_mon"),
        ):
            a, b = r.get(s), r.get(e)
            if not a or not b:
                continue
            sd = date.fromisoformat(a)
            ed = date.fromisoformat(b)
            item = {
                "leg": leg, "crop": r["crop"], "type": r["type"],
                "practice": r["practice"], "state": r["state"], "st": r["st"],
                "scd": r["scd"], "start": a, "end": b,
                "price": r.get(price), "status": r.get(status),
                "exch": r.get(exch), "contract": r.get(mon),
            }
            if sd <= today <= ed:
                item["day"] = (today - sd).days + 1
                item["span"] = (ed - sd).days + 1
                open_w.append(item)
            elif today < sd <= horizon:
                item["in_days"] = (sd - today).days
                next_w.append(item)
    open_w.sort(key=lambda x: (x["crop"], x["state"], x["leg"]))
    next_w.sort(key=lambda x: (x["start"], x["crop"], x["state"]))
    return open_w, next_w


def summarize(items, key=("crop", "type", "leg", "start", "end")):
    """Collapse per-state rows into one line per crop/type/leg/window for the banner.

    Type is part of the key on purpose: winter and spring wheat can share a
    harvest window but never share a price, and averaging them would invent a
    number that is nobody's.
    """
    groups = {}
    for it in items:
        k = tuple(it[f] for f in key)
        g = groups.setdefault(k, {
            "crop": it["crop"], "type": it["type"], "leg": it["leg"],
            "start": it["start"], "end": it["end"],
            "states": set(), "prices": [], "exch": set(), "contract": set(),
            "day": it.get("day"), "span": it.get("span"),
            "in_days": it.get("in_days"),
        })
        g["states"].add(it["state"])
        if it["practice"] == "Conventional" and it.get("price"):
            g["prices"].append(it["price"])
        if it.get("exch"):
            g["exch"].add(it["exch"])
        if it.get("contract"):
            g["contract"].add(it["contract"])
    out = []
    for g in groups.values():
        pr = sorted(g["prices"])
        out.append({
            "crop": g["crop"], "type": g["type"], "leg": g["leg"],
            "start": g["start"], "end": g["end"],
            "states": sorted(g["states"]), "n_states": len(g["states"]),
            "lo": pr[0] if pr else None, "hi": pr[-1] if pr else None,
            "exch": sorted(g["exch"]), "contract": sorted(g["contract"]),
            "day": g["day"], "span": g["span"], "in_days": g["in_days"],
        })
    out.sort(key=lambda x: (x["start"], x["crop"], x["leg"]))
    return out


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--probe", action="store_true",
                    help="pull and report, write nothing")
    ap.add_argument("--year", type=int, default=None,
                    help="crop year to keep (default: current calendar year)")
    ap.add_argument("--today", default=None, help="YYYY-MM-DD, for tests")
    ap.add_argument("--no-filter", action="store_true",
                    help="do not send $filter; keep everything and filter here")
    args = ap.parse_args()

    today = date.fromisoformat(args.today) if args.today else date.today()
    year = args.year or today.year
    disc = f"{today.month}/{today.day}/{today.year}"

    filt = None if args.no_filter else f"CommodityYear eq {year}"
    print(f"RMA price discovery — crop year {year}, discoveryPeriodDate={disc}")
    try:
        raw = pull(disc, filt)
    except Exception as exc:                              # noqa: BLE001
        if filt is None:
            raise
        print(f"  filtered pull failed ({exc}); retrying unfiltered", flush=True)
        raw = pull(disc, None)

    rows = shape(raw)
    rows = [r for r in rows if r.get("year") == year] or rows
    if not rows:
        raise SystemExit("RMA returned zero rows — refusing to write an empty file")

    crops = sorted({r["crop"] for r in rows if r["crop"]})
    states = sorted({r["state"] for r in rows if r["state"]})
    open_w, next_w = windows(rows, today)

    print(f"  rows {len(rows)} · crops {len(crops)} · states {len(states)}")
    print(f"  crops: {', '.join(crops)}")
    print(f"  open windows {len(open_w)} · opening within {UPCOMING_DAYS}d {len(next_w)}")
    for g in summarize(open_w):
        rng = f"${g['lo']:.2f}" if g["lo"] is not None else "—"
        if g["hi"] is not None and g["hi"] != g["lo"]:
            rng += f"–${g['hi']:.2f}"
        print(f"    OPEN  {g['crop']:<14} {g['leg']:<9} {g['start']}..{g['end']} "
              f"{g['n_states']:>2} states  {rng}")
    for g in summarize(next_w)[:12]:
        print(f"    next  {g['crop']:<14} {g['leg']:<9} opens {g['start']} "
              f"(in {g['in_days']}d)  {g['n_states']:>2} states")

    if args.probe:
        print("\n--probe: nothing written.")
        return

    stamp = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    OUT_ALL.write_text(json.dumps({
        "_note": "USDA RMA Price Discovery, mirrored verbatim. Prices whose "
                 "status is 'In Discovery' are RMA's running average to date, "
                 "not a final price. Official prices are RMA's alone.",
        "updated": stamp, "crop_year": year, "source": BASE,
        "app": "https://public-rma.fpac.usda.gov/apps/PriceDiscovery",
        "count": len(rows), "crops": crops, "rows": rows,
    }, separators=(",", ":")) + "\n", encoding="utf-8")

    OUT_NOW.write_text(json.dumps({
        "_note": "Derived from data/rma-prices.json. 'open' = a discovery "
                 "window containing today; 'next' = one opening within "
                 f"{UPCOMING_DAYS} days. Price range is Conventional practice.",
        "updated": stamp, "as_of": today.isoformat(), "crop_year": year,
        "open": summarize(open_w), "next": summarize(next_w),
    }, indent=1) + "\n", encoding="utf-8")

    print(f"\nwrote {OUT_ALL.relative_to(REPO)} ({OUT_ALL.stat().st_size:,} B)")
    print(f"wrote {OUT_NOW.relative_to(REPO)} ({OUT_NOW.stat().st_size:,} B)")


if __name__ == "__main__":
    sys.exit(main())
