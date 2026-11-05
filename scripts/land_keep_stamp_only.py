"""Put back any data/land JSON file whose only change is a timestamp.

The monthly land run rewrites every file it builds with a new fetched_utc (transfers) or
checked_utc (parcel services). A file whose data did not change is restored to the committed
copy, so the run commits only when data changed.

  python3 scripts/land_keep_stamp_only.py [DIR]     (default data/land; run from the repo root)
  python3 scripts/land_keep_stamp_only.py --selftest
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import json
import re
import subprocess
import sys

STAMPS = ("fetched_utc", "checked_utc")
# data/land/checked.json IS the stamp (fetch_land_sales.mark_checked, Nov 3, 2026): the day each state
# was last read, so the land sale email can tell "read, nothing newer" from "not read". Never restored.
KEEP = ("data/land/checked.json",)


def unstamped(v):
    if isinstance(v, dict):
        return {k: unstamped(x) for k, x in v.items() if k not in STAMPS}
    if isinstance(v, list):
        return [unstamped(x) for x in v]
    return v


def stamp_only(old_text, new_text):
    """True when the two JSON texts differ in timestamps only (or not at all)."""
    try:
        return unstamped(json.loads(old_text)) == unstamped(json.loads(new_text))
    except ValueError:
        return False


def partner(p):
    """A county transfer file and its names file (data/land/<st>/<fips>.json, data/land/<st>/names/<fips>.json, Nov 4, 2026)
    carry the same read stamp, which the names tap checks: one is restored only with the other."""
    m = re.match(r"^(.*/land/[a-z]{2}/)(names/)?(\d{5}\.json)$", p)
    if not m:
        return None
    return m.group(1) + m.group(3) if m.group(2) else m.group(1) + "names/" + m.group(3)


def restorable(changed, stamp):
    """The paths to put back: stamp-only changes whose partner, if it changed too, changed in its stamp only."""
    ch = set(changed)
    return [p for p in changed if p in stamp and (partner(p) not in ch or partner(p) in stamp)]


def main(d):
    out = subprocess.run(["git", "diff", "--name-only", "--", d], capture_output=True, text=True, check=True).stdout.split()
    stamp = set()
    for p in out:
        if not p.endswith(".json") or p in KEEP:
            continue
        old = subprocess.run(["git", "show", "HEAD:" + p], capture_output=True, text=True)
        if old.returncode == 0 and stamp_only(old.stdout, open(p).read()):
            stamp.add(p)
    kept = 0
    for p in restorable(out, stamp):
        subprocess.run(["git", "checkout", "--", p], check=True)
        kept += 1
    print("%d of %d changed files differed only in a timestamp; restored" % (kept, len(out)))
    return 0


def selftest():
    a = json.dumps({"state": "WI", "fetched_utc": "2026-10-03T09:30:00Z", "rows": [[1, 2]], "e": [{"checked_utc": "x", "ok": True}]})
    b = json.dumps({"state": "WI", "fetched_utc": "2026-11-03T09:30:00Z", "rows": [[1, 2]], "e": [{"checked_utc": "y", "ok": True}]})
    c = json.dumps({"state": "WI", "fetched_utc": "2026-11-03T09:30:00Z", "rows": [[1, 2], [3, 4]], "e": [{"checked_utc": "y", "ok": True}]})
    d = json.dumps({"state": "WI", "fetched_utc": "2026-11-03T09:30:00Z", "rows": [[1, 2]], "e": [{"checked_utc": "y", "ok": False}]})
    bad = 0
    for name, ok in (("timestamps only: restored", stamp_only(a, b)), ("a new row: kept", not stamp_only(a, c)),
                     ("a changed check result: kept", not stamp_only(a, d)), ("unreadable JSON: kept", not stamp_only(a, "{")),
                     ("the checked stamp file is never restored", KEEP == ("data/land/checked.json",)),
                     ("a county file and its names file pair up", partner("data/land/wi/55005.json") == "data/land/wi/names/55005.json"
                      and partner("data/land/wi/names/55005.json") == "data/land/wi/55005.json" and partner("data/land/wi/index.json") is None),
                     ("a names file whose county file changed for real keeps its new stamp",
                      restorable(["data/land/wi/55005.json", "data/land/wi/names/55005.json"], {"data/land/wi/names/55005.json"}) == []),
                     ("both stamp-only: both restored; a lone stamp-only file: restored",
                      restorable(["data/land/wi/55005.json", "data/land/wi/names/55005.json", "data/land/il/17001.json"],
                                 {"data/land/wi/55005.json", "data/land/wi/names/55005.json", "data/land/il/17001.json"})
                      == ["data/land/wi/55005.json", "data/land/wi/names/55005.json", "data/land/il/17001.json"])):
        print(("ok   " if ok else "FAIL ") + name)
        bad += 0 if ok else 1
    print("FAILS=%d" % bad)
    return 1 if bad else 0


if __name__ == "__main__":
    a = sys.argv[1:]
    sys.exit(selftest() if "--selftest" in a else main(a[0] if a else "data/land"))
