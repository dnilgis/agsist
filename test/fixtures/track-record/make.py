"""A synthetic public forecast record for test/track-record.test.mjs (Nov 6, 2026). Not real forecasts.

    python3 test/fixtures/track-record/make.py DIR     writes DIR/forecasts/forecast-record.jsonl and baselines.json
Three forecasts: a direction call with 14 graded (shown, Live), one with 5 graded (Building, withheld) and a level
forecast with a range and 13 graded (shown)."""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "scripts"))
import build_track_record as t  # noqa: E402

out = sys.argv[1]
base = {"declared_on": "2026-11-06", "note": "fixture", "forecasts": {
    "dirx": {"label": "Fixture direction call", "kind": "direction", "every": "weekly", "window": 12, "min_n": 12,
             "stale_days": 400, "majority": {"dir": "down", "text": "fixture"}, "flat": "fixture", "level": None},
    "diry": {"label": "Fixture thin call", "kind": "direction", "every": "weekly", "window": 12, "min_n": 40,
             "stale_days": 400, "majority": {"dir": "down", "text": "fixture"}, "flat": "fixture", "level": None},
    "lvl": {"label": "Fixture level forecast", "kind": "level", "every": "monthly", "window": 12, "min_n": 12,
            "stale_days": 400, "majority": None, "flat": None, "level": "fixture"}}}
rows = []


def add(r):
    r = dict(r)
    r["prev"] = rows[-1]["h"] if rows else t.GENESIS
    r["h"] = t.digest(r)
    rows.append(r)


for i in range(14):
    up = i % 3 == 0
    d = "2026-%02d-%02d" % (1 + i // 2, 1 + (i % 2) * 14)
    add({"id": "dirx:%d" % i, "fc": "dirx", "v": 1, "locked_at": d, "target": d, "est": None, "lo": None, "hi": None,
         "dir": "up" if up else "down", "baseline_est": 100.0})
    add({"id": "dirx:%d" % i, "fc": "dirx", "graded_at": d, "actual": 101.0 if up else 99.0, "miss": None,
         "base_miss": 1.0 if up else -1.0, "dir_right": True, "maj_right": not up, "flat_right": False, "in_range": None})
for i in range(5):
    d = "2026-09-%02d" % (1 + i)
    add({"id": "diry:%d" % i, "fc": "diry", "v": 1, "locked_at": d, "target": d, "est": None, "lo": None, "hi": None,
         "dir": "down", "baseline_est": 50.0})
    add({"id": "diry:%d" % i, "fc": "diry", "graded_at": d, "actual": 49.0, "miss": None, "base_miss": -1.0,
         "dir_right": True, "maj_right": True, "flat_right": False, "in_range": None})
for i in range(13):
    d = "2025-%02d-15" % (1 + i % 12) if i < 12 else "2026-01-15"
    add({"id": "lvl:%d" % i, "fc": "lvl", "v": 1, "locked_at": d, "target": d, "est": 20.0, "lo": 18.0, "hi": 22.0,
         "dir": None, "baseline_est": 21.0})
    act = 20.5 if i % 4 else 23.0
    add({"id": "lvl:%d" % i, "fc": "lvl", "graded_at": d, "actual": act, "miss": round(act - 20.0, 4),
         "base_miss": round(act - 21.0, 4), "dir_right": None, "maj_right": None, "flat_right": None,
         "in_range": 18.0 <= act <= 22.0})
os.makedirs(os.path.join(out, "forecasts"), exist_ok=True)
with open(os.path.join(out, "forecasts", "forecast-record.jsonl"), "w") as f:
    f.write("".join(json.dumps(r, sort_keys=True, separators=(",", ":")) + "\n" for r in rows))
with open(os.path.join(out, "forecasts", "baselines.json"), "w") as f:
    json.dump(base, f, indent=1)
print(len(rows))
