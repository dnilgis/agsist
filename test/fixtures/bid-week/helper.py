"""Fixture runs for test/bid-week.test.mjs: the Saturday Daily's "Your bid at" line, end to end.

Every number here is made up for the test (the place names say so). The bids-prev shards are built by
scripts/build_bids_prev.py fold() and write_shards() from fake index sightings, one run a weekday from
Thu Oct 29 to Fri Nov 6 2026, then read back by scripts/daily_weekend.py bid_week(). A fixed clock is
handed in everywhere; nothing reads today's date or the network, and no real reader is used.

    python3 -I helper.py <case>     prints one JSON answer
"""
import json
import os
import shutil
import sys
import tempfile
from datetime import date, datetime, timezone

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import build_bids_prev as B  # noqa: E402
import daily_weekend as W  # noqa: E402

SAT = date(2026, 11, 7)
NOW = datetime(2026, 11, 7, 13, 0, tzinfo=timezone.utc)      # the Saturday send, 7 AM CT
PLACE = "Fixture Test Co-op||Plainsburg|KS"
DAYS = ("2026-10-29", "2026-10-30", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06")
CORN = (4.05, 4.10, 4.12, 4.15, 4.1525, 4.18, 4.1525)         # last value each day; Fri Oct 30 4.10, Fri Nov 6 4.1525
SOY = (10.20, 10.25, 10.30, 10.28, 10.22, 10.21, 10.18)


def index(corn, soy, corn_period="2026-11", soy_period="2026-11"):
    now = {}
    if corn is not None:
        now["corn"] = {"cash": corn, "basis": -0.45, "basisCents": -45, "period": corn_period, "commodity": "Corn"}
    if soy is not None:
        now["soybeans"] = {"cash": soy, "basis": -0.8, "basisCents": -80, "period": soy_period, "commodity": "Soybeans"}
    return {"places": [{"place": PLACE, "operator": "Fixture Test Co-op", "branch": None, "city": "Plainsburg", "state": "KS",
                        "lat": 37.80, "lon": -100.00, "currency": "USD", "now": now}]}


def build(out_dir, skip=(), corn_period_from=None):
    """One fold per weekday into out_dir. skip: days with no sighting; corn_period_from: (day, period)
    from which the corn board's delivery period is the new one."""
    rows, fri = {}, {}
    for i, d in enumerate(DAYS):
        if d in skip:
            continue
        per = corn_period_from[1] if corn_period_from and d >= corn_period_from[0] else "2026-11"
        rows, fri = B.fold(rows, fri, B.sightings(index(CORN[i], SOY[i], per)), d)
    B.OUT_DIR = out_dir
    B.write_shards(rows, "2026-11-06T23:45:00Z", fri)
    return rows, fri


def top(corn_cash=4.1525, soy_cash=10.18, posted="2026-11-06T19:15:00Z", corn_period="2026-11"):
    """What local_bid.top_for_zip answers at the Saturday send, cut to what bid_week reads."""
    def entry(cash, crop, period, month):
        return {"cash": cash, "name": "Fixture Test Co-op", "town": "Plainsburg, KS", "mi": 4.0, "posted": posted,
                "stale": False, "month": month, "ageUnknown": False,
                "board": {"place": PLACE, "crop": crop, "period": period, "state": "KS"}}
    return {"status": "ok", "zip": "67801", "place": "Dodge City, KS", "radiusMi": 50,
            "corn": entry(corn_cash, "corn", corn_period, "Nov '26"), "soybeans": entry(soy_cash, "soybeans", "2026-11", "Nov '26"),
            "wheat": None}


def size_case(tmp):
    """Bytes of one state's shard with and without the fri slot, for 300 boards over the 7 weekdays."""
    places = [{"place": "Fixture Board %d||Town %d|KS" % (n, n), "state": "KS", "currency": "USD",
               "now": {"corn": {"cash": 4 + n / 1000, "basisCents": -40, "period": "2026-11"},
                       "soybeans": {"cash": 10 + n / 1000, "basisCents": -80, "period": "2026-11"}}} for n in range(300)]
    rows, fri = {}, {}
    for d in DAYS:
        rows, fri = B.fold(rows, fri, B.sightings({"places": places}), d)
    B.OUT_DIR = os.path.join(tmp, "with")
    B.write_shards(rows, "x", fri)
    B.OUT_DIR = os.path.join(tmp, "without")
    B.write_shards(rows, "x", {})
    sz = lambda d: os.path.getsize(os.path.join(tmp, d, "KS.json"))
    per_key = max(len(v) + (1 if k in fri["KS"] else 0) for k, v in rows["KS"].items())
    return {"with": sz("with"), "without": sz("without"), "keys": len(rows["KS"]), "slots": len(fri["KS"]),
            "max_entries_per_key": per_key, "keep_days": B.KEEP_DAYS}


def main(case):
    tmp = tempfile.mkdtemp(prefix="bidweek-")
    shard_dir = os.path.join(tmp, "bids-prev")
    if case == "size":
        return size_case(tmp)
    if case == "both":
        build(shard_dir)
        doc = json.load(open(os.path.join(shard_dir, "KS.json")))
        return {"week": W.bid_week(SAT, top(), shard_dir), "fri_dates": sorted({v[0] for v in doc["fri"].values()}),
                "rows_dates": sorted({e[0] for v in doc["rows"].values() for e in v}),
                "not_saturday": W.bid_week(date(2026, 11, 6), top(), shard_dir),
                "sunday": W.bid_week(date(2026, 11, 8), top(), shard_dir)}
    if case == "missing-last-friday":
        build(shard_dir, skip=("2026-10-30",))
        return W.bid_week(SAT, top(), shard_dir)
    if case == "missing-this-friday":
        build(shard_dir, skip=("2026-11-06",))
        return W.bid_week(SAT, top(posted="2026-11-05T19:15:00Z"), shard_dir)
    if case == "period-change":
        # the corn board rolls from Nov to Dec delivery on Mon Nov 2: last Friday is the Nov board, this Friday the Dec one
        build(shard_dir, corn_period_from=("2026-11-02", "2026-12"))
        return W.bid_week(SAT, top(corn_period="2026-12"), shard_dir)
    if case == "moved-after-friday":
        build(shard_dir)
        return {"moved": W.bid_week(SAT, top(corn_cash=4.20, soy_cash=10.30), shard_dir),
                "posted_saturday": W.bid_week(SAT, top(posted="2026-11-07T14:00:00Z"), shard_dir),
                "no_posted": W.bid_week(SAT, top(posted=None), shard_dir)}
    if case == "send":
        # send_daily.load_local_lines on the Saturday issue with fake readers and a fake bids mirror
        build(shard_dir)
        mirror = os.path.join(tmp, "mirror")
        os.makedirs(os.path.join(mirror, "data", "zips"))
        os.makedirs(os.path.join(mirror, "geocodes"))
        idx = index(4.1525, 10.18)
        idx["places"][0].update(pricedAt="2026-11-06T19:15:00.000Z", checkedAt="2026-11-07T12:45:00.000Z")
        json.dump(idx, open(os.path.join(mirror, "data", "merged-index.json"), "w"))
        json.dump({"67801": [37.75, -100.02]}, open(os.path.join(mirror, "data", "zips", "67.json"), "w"))
        json.dump({"zips": {"67801": ["Dodge City", "KS"]}}, open(os.path.join(mirror, "geocodes", "zip-towns.json"), "w"))
        import local_bid
        import send_daily
        real = local_bid.top_for_zip
        local_bid.top_for_zip = lambda data, z, now=None: real(data, z, NOW)
        W.BIDS_PREV = shard_dir
        subs = [{"email": "reader1@example.com", "zip": "67801"}, {"email": "reader2@example.com", "zip": None}]
        import contextlib
        import io
        with contextlib.redirect_stdout(io.StringIO()) as log:
            sat, _ = send_daily.load_local_lines(subs, "json", local_bid.BidsData(mirror), day="2026-11-07")
            fri, _ = send_daily.load_local_lines(subs, "json", local_bid.BidsData(mirror), day="2026-11-06")
        a = sat.get("reader1@example.com") or {}
        return {"week": a.get("week"), "no_zip_week": (sat.get("reader2@example.com") or {}).get("week"),
                "friday_week": (fri.get("reader1@example.com") or {}).get("week"),
                "log_has_no_address": "@" not in log.getvalue(),
                "log_count": [l for l in log.getvalue().splitlines() if l.startswith("weekly bid line")]}
    raise SystemExit("unknown case " + case)


if __name__ == "__main__":
    _tmp0 = set(os.listdir(tempfile.gettempdir()))
    try:
        print(json.dumps(main(sys.argv[1])))
    finally:
        for n in set(os.listdir(tempfile.gettempdir())) - _tmp0:
            if n.startswith("bidweek-"):
                shutil.rmtree(os.path.join(tempfile.gettempdir(), n), ignore_errors=True)
