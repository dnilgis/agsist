#!/usr/bin/env python3
"""
harvest_clock.py -- the harvest price clock for the Daily, the homepage and
the email, during the fall harvest price discovery window only.

    Corn harvest price so far: $5.01 vs $4.62 projected (+8.4%), 4 of 22 trading days in.

WHERE THE NUMBERS COME FROM. data/rma-prices.json, which scripts/
fetch_rma_prices.py mirrors verbatim from USDA RMA Price Discovery. The
harvest figure is RMA's own running average (h_status "In Discovery"), the
projected figure is RMA's released projected price, and the window dates are
RMA's (h_start, h_end). Nothing here averages a settle. The only figure this
computes is the percent change between RMA's two prices, and the count of
trading days in RMA's window (CME closures from contract_calendar).

WHICH ROWS. Conventional practice, this crop year. Corn type "All (Non-High
Amylose)", soybeans "All". RMA keys windows by state and sales closing date,
so one crop can have several; the clock uses the window shared by the most
states (Oct 1-31 for corn and soybeans in 2026), and says so.

DAYS IN. When data/harvest-prices.json (the site's own running average of the
same contract's settles) has exactly one day whose running average equals
RMA's posted figure, that day's count is how many settles RMA's figure holds.
Otherwise it is the window's trading days settled by the time the RMA file
was fetched.

WHEN IT IS LEFT OUT. Outside the window, RMA file older than STALE_DAYS,
file missing or unreadable, harvest price not "In Discovery", projected price
not released. None, never a guess.

    python3 scripts/harvest_clock.py             print today's block
    python3 scripts/harvest_clock.py --selftest  hand-worked cases, no network
"""
import json
import os
import sys
from datetime import date, datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import contract_calendar as cc   # noqa: E402  CME closures, computed

try:
    from zoneinfo import ZoneInfo
    CT = ZoneInfo("America/Chicago")
except Exception:                 # pragma: no cover
    CT = timezone(timedelta(hours=-5))

STALE_DAYS = 3
URL = "/harvest-price-tracker"
SOURCE = "USDA RMA Price Discovery"
CROPS = (("Corn", "All (Non-High Amylose)"), ("Soybeans", "All"))
GRAIN_SETTLE_CT = (13, 20)        # CBOT corn and soybeans settle at 1:20 PM CT
MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def _d(s):
    try:
        return datetime.strptime(str(s)[:10], "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return None


def _price(v):
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return x if x > 0 else None


def md(d):
    return f"{MON[d.month - 1]} {d.day}"


def window_label(a, b):
    if a.month == b.month:
        return f"{MON[a.month - 1]} {a.day}-{b.day}"
    return f"{md(a)}-{md(b)}"


def trading_days(a, b):
    n, d = 0, a
    while d <= b:
        if cc.is_trading_day(d):
            n += 1
        d += timedelta(days=1)
    return n


def asof_ct(rma):
    """RMA file fetch time in Central, or None."""
    u = str(rma.get("updated") or "")
    try:
        t = datetime.fromisoformat(u.replace("Z", "+00:00"))
    except ValueError:
        return None
    if t.tzinfo is None:
        t = t.replace(tzinfo=timezone.utc)
    return t.astimezone(CT)


def last_settled(t_ct):
    """The last session settled at Central time t_ct."""
    d = t_ct.date()
    if cc.is_trading_day(d) and (t_ct.hour, t_ct.minute) >= GRAIN_SETTLE_CT:
        return d
    return cc.prior_trading_day(d)


def _hp_days(hp, crop, start, end, h):
    """Settles RMA's figure holds: the single day in our own running average
    of this window that equals RMA's posted price. None if not exactly one."""
    if not hp:
        return None
    for w in hp.get("windows") or []:
        if w.get("crop") == crop and w.get("start") == start and w.get("end") == end:
            hits = [i + 1 for i, s in enumerate(w.get("series") or [])
                    if s.get("a") is not None and round(float(s["a"]) * 100) == round(h * 100)]
            return hits[0] if len(hits) == 1 else None
    return None


def _contract(row):
    m, y = str(row.get("h_mon") or ""), row.get("h_yr")
    return f"{m[:3]} '{str(y)[-2:]}" if m and y else ""


def build(rma, hp=None, today=None):
    """The clock as a dict, or None. today is the reader's date (Central)."""
    if not isinstance(rma, dict) or not rma.get("rows"):
        return None
    t = asof_ct(rma)
    if not t:
        return None
    today = today or datetime.now(CT).date()
    asof = t.date()
    if (today - asof).days > STALE_DAYS or asof > today + timedelta(days=1):
        return None
    year = rma.get("crop_year")
    settled = last_settled(t)
    crops, lines = [], []
    for crop, typ in CROPS:
        rows = [r for r in rma["rows"]
                if r.get("crop") == crop and r.get("type") == typ
                and r.get("practice") == "Conventional" and r.get("year") == year]
        # The window most states share, chosen over every row, so a small
        # late window (four states in November) never stands in for it.
        by_win = {}
        for r in rows:
            k = (r.get("h_start"), r.get("h_end"))
            by_win.setdefault(k, set()).add(r.get("state"))
        if not by_win:
            continue
        (hs, he), states = max(by_win.items(), key=lambda kv: (len(kv[1]), str(kv[0])))
        a, b = _d(hs), _d(he)
        if not a or not b or not (a <= today <= b) or not (a <= asof):
            continue
        live = [r for r in rows if (r.get("h_start"), r.get("h_end")) == (hs, he)
                and r.get("h_status") == "In Discovery" and r.get("p_status") == "Released"
                and _price(r.get("h_price")) and _price(r.get("p_price"))]
        if not live:
            continue
        # One price pair across the window's states, or the one most of them carry.
        by_px = {}
        for r in live:
            by_px.setdefault((_price(r["h_price"]), _price(r["p_price"])), []).append(r)
        (h, p), grp = max(by_px.items(), key=lambda kv: len(kv[1]))
        total = trading_days(a, b)
        done = _hp_days(hp, crop, hs, he, h)
        if done is None:
            done = trading_days(a, min(b, settled)) if settled >= a else 0
        if not total or done < 1 or done > total:
            continue
        pct = round((h - p) / p * 100, 1)
        crops.append({"crop": crop, "contract": _contract(grp[0]), "harvest": h, "projected": p,
                      "pct": pct, "days_done": done, "days_total": total, "days_left": total - done,
                      "start": hs, "end": he, "n_states": len({r.get("state") for r in grp}),
                      "all_states": len(by_px) == 1})
        lines.append(f"{crop} harvest price so far: ${h:.2f} vs ${p:.2f} projected "
                     f"({pct:+.1f}%), {done} of {total} trading days in.")
    if not crops:
        return None
    wins = {(c["start"], c["end"]) for c in crops}
    note = f"USDA RMA, as of {md(asof)}."
    if len(wins) == 1:
        s, e = next(iter(wins))
        note += f" {window_label(_d(s), _d(e))} window, most states."
    return {"asof": asof.isoformat(), "updated": rma.get("updated"), "source": SOURCE,
            "url": URL, "start": min(c["start"] for c in crops), "end": max(c["end"] for c in crops),
            "crops": crops, "lines": lines, "note": note}


def build_from_files(repo_root, today=None):
    root = str(repo_root)
    try:
        with open(os.path.join(root, "data", "rma-prices.json"), encoding="utf-8") as f:
            rma = json.load(f)
    except (OSError, ValueError):
        return None
    try:
        with open(os.path.join(root, "data", "harvest-prices.json"), encoding="utf-8") as f:
            hp = json.load(f)
    except (OSError, ValueError):
        hp = None
    return build(rma, hp, today)


def visible(block, today=None):
    """The block if a reader should see it on `today` (Central), else None.
    A renderer calls this, not the generator's say-so: an email or page read
    days later must not show a clock that has gone stale or closed."""
    if not isinstance(block, dict) or not block.get("lines"):
        return None
    today = today or datetime.now(CT).date()
    a, e, s = _d(block.get("asof")), _d(block.get("end")), _d(block.get("start"))
    if not a or not e or not s:
        return None
    if (today - a).days > STALE_DAYS or today > e or today < s:
        return None
    return block


# ── selftest ────────────────────────────────────────────────────────────────
def _row(crop, typ, state, hs="2026-10-01", he="2026-10-31", h=5.01, p=4.62,
         hst="In Discovery", pst="Released", practice="Conventional"):
    return {"year": 2026, "crop": crop, "type": typ, "practice": practice, "state": state,
            "h_mon": "December" if crop == "Corn" else "November", "h_yr": 2026,
            "h_start": hs, "h_end": he, "h_price": h, "h_status": hst,
            "p_price": p, "p_status": pst}


def _selftest():
    bad = []

    def ck(name, ok, got=""):
        if not ok:
            bad.append(name)
            print("FAIL", name, got)

    rows = ([_row("Corn", "All (Non-High Amylose)", s) for s in ("Iowa", "Illinois", "Wisconsin")]
            + [_row("Corn", "All (Non-High Amylose)", "Texas", "2026-08-01", "2026-08-31", 4.4)]
            + [_row("Corn", "All (Non-High Amylose)", s, "2026-11-01", "2026-11-30", None, 4.62, "Yet To Start")
               for s in ("Georgia",)]
            + [_row("Corn", "All (Non-High Amylose)", "Iowa", practice="Organic", h=7.92, p=7.3)]
            + [_row("Corn", "High Amylose", "Iowa", h=7.01, p=6.47)]
            + [_row("Soybeans", "All", s, h=12.87, p=11.09) for s in ("Iowa", "Illinois")])
    rma = {"updated": "2026-10-08T02:06:12Z", "crop_year": 2026, "rows": rows}
    hp = {"windows": [{"crop": "Corn", "start": "2026-10-01", "end": "2026-10-31",
                       "series": [{"a": 5.02}, {"a": 5.00}, {"a": 4.99}, {"a": 5.01}]}]}
    b = build(rma, hp, date(2026, 10, 9))
    ck("in window and fresh: a block", b is not None)
    if b:
        ck("corn line", b["lines"][0] == "Corn harvest price so far: $5.01 vs $4.62 projected (+8.4%), 4 of 22 trading days in.",
           b["lines"][0])
        # No hp match for soybeans: settled sessions at fetch (Oct 7 9:06 PM CT) = Oct 1,2,5,6,7.
        ck("soy line, calendar count", b["lines"][1] == "Soybeans harvest price so far: $12.87 vs $11.09 projected (+16.1%), 5 of 22 trading days in.",
           b["lines"][1])
        ck("organic and high amylose ignored", b["crops"][0]["harvest"] == 5.01)
        ck("window is the most states' one", b["crops"][0]["start"] == "2026-10-01")
        ck("note", b["note"] == "USDA RMA, as of Oct 7. Oct 1-31 window, most states.", b["note"])
        ck("days left", b["crops"][0]["days_left"] == 18)
        ck("visible on Oct 9", visible(b, date(2026, 10, 9)) is b)
        ck("hidden 4 days after as-of", visible(b, date(2026, 10, 11)) is None)
        ck("hidden after the window", visible(b, date(2026, 11, 1)) is None)
        ck("hidden with no lines", visible({**b, "lines": []}, date(2026, 10, 9)) is None)
    ck("stale file: none", build(rma, hp, date(2026, 10, 12)) is None)
    ck("out of window (Nov 2): none", build({**rma, "updated": "2026-11-02T02:00:00Z"}, hp, date(2026, 11, 2)) is None)
    ck("before window (Sep 29): none", build({**rma, "updated": "2026-09-29T02:00:00Z"}, hp, date(2026, 9, 29)) is None)
    ck("missing file: none", build(None) is None and build({}) is None)
    ck("bad timestamp: none", build({**rma, "updated": "soon"}, hp, date(2026, 10, 9)) is None)
    yts = {**rma, "rows": [dict(r, h_status="Yet To Start", h_price=0) for r in rows]}
    ck("harvest price not posted: none", build(yts, hp, date(2026, 10, 9)) is None)
    neg = {**rma, "rows": [dict(r, h_price=4.12) if r["crop"] == "Corn" else r for r in rows]}
    nb = build(neg, None, date(2026, 10, 9))
    ck("a fall reads with a minus", nb and nb["lines"][0].startswith("Corn harvest price so far: $4.12 vs $4.62 projected (-10.8%)"),
       nb and nb["lines"][0])
    ck("22 trading days in Oct 2026", trading_days(date(2026, 10, 1), date(2026, 10, 31)) == 22)
    print("harvest_clock selftest " + ("FAILED" if bad else "ok"))
    return 1 if bad else 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(_selftest())
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    print(json.dumps(build_from_files(here), indent=1))
