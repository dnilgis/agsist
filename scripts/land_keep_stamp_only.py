"""Put back any data/land JSON file whose only change is a timestamp.

The monthly land run rewrites every file it builds with a new fetched_utc (transfers) or
checked_utc (parcel services). A file whose data did not change is restored to the committed
copy, so the run commits only when data changed.

  python3 scripts/land_keep_stamp_only.py [DIR]     (default data/land; run from the repo root)
  python3 scripts/land_keep_stamp_only.py --selftest
"""
import json
import subprocess
import sys

STAMPS = ("fetched_utc", "checked_utc")


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


def main(d):
    out = subprocess.run(["git", "diff", "--name-only", "--", d], capture_output=True, text=True, check=True).stdout.split()
    kept = 0
    for p in out:
        if not p.endswith(".json"):
            continue
        old = subprocess.run(["git", "show", "HEAD:" + p], capture_output=True, text=True)
        if old.returncode == 0 and stamp_only(old.stdout, open(p).read()):
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
                     ("a changed check result: kept", not stamp_only(a, d)), ("unreadable JSON: kept", not stamp_only(a, "{"))):
        print(("ok   " if ok else "FAIL ") + name)
        bad += 0 if ok else 1
    print("FAILS=%d" % bad)
    return 1 if bad else 0


if __name__ == "__main__":
    a = sys.argv[1:]
    sys.exit(selftest() if "--selftest" in a else main(a[0] if a else "data/land"))
