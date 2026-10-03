#!/usr/bin/env python3
"""
build_bids_prev.py -- the elevator network's last price on each recent
trading day, so the homepage cash card can print a day's change.

WHY THIS EXISTS (WAVE1-A, 2026-10-03)

The homepage reads the network's live index (dnilgis/bids
data/merged-index.json) in the browser. That file is "now" only: one cash per
place, crop and nearest open delivery period, and nothing about yesterday. A
change since yesterday needs yesterday's number, and a browser cannot read git
history. So the bids workflow, which runs every fifteen minutes round the
clock, keeps a short rolling record here.

WHAT IT KEEPS

data/bids-prev/<ST>.json:
    rows: { key: [[date, cash, basisCents], ...] }
    key  = FNV-1a 32-bit over "place|crop|period", exactly the strings
           merged-index.json writes, hashed the way components/bids-homepage.js
           hashes them (UTF-16 code units, Math.imul), as 8 hex characters.
    date = the Central-time trading day the value was seen on. Each run
           overwrites today's entry, so an entry is the LAST value seen that
           day. Saturdays and Sundays are not recorded: a board does not trade
           then, and a weekend entry would make Monday's change read "since
           Sunday". Exchange holidays are not known here and are recorded like
           any weekday; the page names the date it compared against.

The page compares a row's cash now with the latest entry dated BEFORE the
day its board last changed (its pricedAt). Nothing is computed here beyond
picking the value; a key with no earlier entry prints an em dash.

A key changes when a place's nearest open period rolls (Oct to Nov), so a new
period starts with no history. That is correct: October's price is not
November's.

Usage:
    python3 scripts/build_bids_prev.py                  # fetch the live index, update
    python3 scripts/build_bids_prev.py --index FILE     # read a local index
    python3 scripts/build_bids_prev.py --index FILE --date 2026-10-01   # seed one day
    python3 scripts/build_bids_prev.py --selftest
"""
import argparse
import datetime as dt
import glob
import json
import os
import sys
import urllib.request

REPO = os.environ.get("AGSIST_REPO", ".")
OUT_DIR = os.path.join(REPO, "data/bids-prev")
INDEX_URL = "https://dnilgis.github.io/bids/data/merged-index.json"
KEEP_DAYS = 4      # entries kept per key: enough to step back over a weekend and a holiday
DROP_AFTER = 10    # calendar days without a sighting before a key is dropped
SCHEMA = "agsist-bids-prev/1"


def fnv(s):
    """FNV-1a 32-bit over UTF-16 code units, the same as fnv() in bids-homepage.js."""
    h = 0x811C9DC5
    b = s.encode("utf-16-le")
    for i in range(0, len(b), 2):
        h ^= b[i] | (b[i + 1] << 8)
        h = (h * 0x01000193) & 0xFFFFFFFF
    return "%08x" % h


def ct_today():
    from zoneinfo import ZoneInfo
    return dt.datetime.now(ZoneInfo("America/Chicago")).date().isoformat()


def is_weekend(day):
    return dt.date.fromisoformat(day).weekday() >= 5


def sightings(index):
    """index -> {state: {key: (cash, basisCents)}} for every priced `now` row."""
    out = {}
    for p in index.get("places") or []:
        st = str(p.get("state") or "").strip().upper()
        if len(st) != 2 or not st.isalpha():
            continue
        if (p.get("currency") or "USD") != "USD":
            continue
        place = p.get("place")
        for crop, n in (p.get("now") or {}).items():
            if not n or n.get("cash") is None or not place or not n.get("period"):
                continue
            k = fnv(place + "|" + crop + "|" + n["period"])
            out.setdefault(st, {})[k] = (round(float(n["cash"]), 4),
                                         None if n.get("basisCents") is None else round(float(n["basisCents"]), 2))
    return out


def update(shards, seen, day):
    """Fold one run's sightings into the shards for `day`. Pure; returns new shards."""
    out = {st: {k: [list(e) for e in v] for k, v in rows.items()} for st, rows in shards.items()}
    for st, rows in seen.items():
        tgt = out.setdefault(st, {})
        for k, (cash, basis) in rows.items():
            hist = [e for e in tgt.get(k, []) if e[0] != day]
            hist.append([day, cash, basis])
            hist.sort(key=lambda e: e[0])
            tgt[k] = hist[-KEEP_DAYS:]
    cutoff = (dt.date.fromisoformat(day) - dt.timedelta(days=DROP_AFTER)).isoformat()
    for st in list(out):
        for k in list(out[st]):
            if not out[st][k] or out[st][k][-1][0] < cutoff:
                del out[st][k]
        if not out[st]:
            del out[st]
    return out


def load_shards():
    shards = {}
    for fp in glob.glob(os.path.join(OUT_DIR, "*.json")):
        st = os.path.basename(fp)[:-5]
        try:
            with open(fp) as f:
                shards[st] = json.load(f).get("rows") or {}
        except Exception as e:  # noqa: BLE001 -- a broken shard starts over, loudly
            print(f"::warning title=bids-prev::{fp} unreadable ({e}); starting that state over")
    return shards


def write_shards(shards, stamp):
    os.makedirs(OUT_DIR, exist_ok=True)
    wrote = 0
    for st, rows in sorted(shards.items()):
        doc = {"schema": SCHEMA, "generated": stamp, "tz": "America/Chicago",
               "note": "Per elevator-network place, crop and delivery period: the last cash and basis "
                       "(cents) seen on each recent trading day, Central time. Key = FNV-1a of "
                       "place|crop|period. Weekends are not recorded.",
               "rows": {k: rows[k] for k in sorted(rows)}}
        fp = os.path.join(OUT_DIR, st + ".json")
        body = json.dumps(doc, separators=(",", ":"), ensure_ascii=False)
        old = None
        if os.path.exists(fp):
            with open(fp) as f:
                old = json.load(f)
        if old and old.get("rows") == doc["rows"]:
            continue
        with open(fp, "w") as f:
            f.write(body)
        wrote += 1
    for fp in glob.glob(os.path.join(OUT_DIR, "*.json")):
        if os.path.basename(fp)[:-5] not in shards:
            os.remove(fp)
    return wrote


def selftest():
    # Cross-checked against fnv() in components/bids-homepage.js, run in node.
    assert fnv("Abbyville Farmers Co-op Grain Co.||Abbyville|KS|corn|2026-08/2026-11") == SELFTEST_HASH, \
        fnv("Abbyville Farmers Co-op Grain Co.||Abbyville|KS|corn|2026-08/2026-11")
    idx = {"places": [
        {"place": "A||Town|KS", "state": "KS", "currency": "USD",
         "now": {"corn": {"cash": 4.715, "basisCents": -25, "period": "2026-08/2026-11"},
                 "wheat": {"cash": None, "period": "2026-09/2026-11"}}},
        {"place": "B||Elsewhere|ON", "state": "ON", "currency": "CAD",
         "now": {"corn": {"cash": 6.0, "basisCents": 10, "period": "2026-10"}}},
        {"place": "C||Nowhere|", "state": None, "now": {"corn": {"cash": 4.0, "period": "2026-10"}}},
    ]}
    seen = sightings(idx)
    assert list(seen) == ["KS"], seen                     # CAD and stateless rows left out
    k = fnv("A||Town|KS|corn|2026-08/2026-11")
    assert seen["KS"] == {k: (4.715, -25.0)}, seen         # a null cash is not a row
    s = update({}, seen, "2026-09-29")
    s = update(s, {"KS": {k: (4.70, -26)}}, "2026-09-30")
    s = update(s, {"KS": {k: (4.72, -24)}}, "2026-09-30")  # later run the same day overwrites
    assert s["KS"][k] == [["2026-09-29", 4.715, -25.0], ["2026-09-30", 4.72, -24]], s
    for d in ("2026-10-01", "2026-10-02", "2026-10-05"):
        s = update(s, {"KS": {k: (4.8, -20)}}, d)
    assert [e[0] for e in s["KS"][k]] == ["2026-09-30", "2026-10-01", "2026-10-02", "2026-10-05"], s  # last 4 kept
    s = update(s, {}, "2026-10-16")                         # not seen for 11 days: dropped
    assert s == {}, s
    assert is_weekend("2026-10-03") and is_weekend("2026-10-04") and not is_weekend("2026-10-05")
    print("build_bids_prev selftest: ok")


SELFTEST_HASH = "0dd84803"  # from node, fnv() as written in bids-homepage.js


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--index")
    ap.add_argument("--date")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        selftest()
        return
    day = a.date or ct_today()
    if is_weekend(day):
        print(f"[bids-prev] {day} is a weekend day in Central time: nothing recorded")
        return
    if a.index:
        with open(a.index) as f:
            index = json.load(f)
    else:
        req = urllib.request.Request(INDEX_URL, headers={"User-Agent": "agsist-bids-prev"})
        with urllib.request.urlopen(req, timeout=60) as r:
            index = json.loads(r.read().decode("utf-8"))
    seen = sightings(index)
    n = sum(len(v) for v in seen.values())
    if n < 100:
        # A thin or empty index is an outage upstream, not 2,000 elevators
        # going quiet. Recording it would cost nothing (old keys stay), but
        # say so.
        print(f"::warning title=bids-prev::only {n} priced rows in the index; recorded anyway")
    shards = update(load_shards(), seen, day)
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    wrote = write_shards(shards, stamp)
    print(f"[bids-prev] {day}: {n} rows seen in {len(seen)} states; {wrote} shard(s) changed")


if __name__ == "__main__":
    main()
