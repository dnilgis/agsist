#!/usr/bin/env python3
"""Split data/next-links.json (the one map people edit) into one small file
per page, data/next/<path>.json ("/" is data/next/index.json), so a page
reads only its own 2 or 3 links instead of the whole map
(components/next-links.js). Each file carries the ask text it needs.

  python3 scripts/build_next_links.py          write the files
  python3 scripts/build_next_links.py --check  fail if any file is stale
"""
import json
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(REPO, "data", "next-links.json")
OUT = os.path.join(REPO, "data", "next")


def out_path(key):
    k = key.strip("/")
    return os.path.join(OUT, (k or "index") + ".json")


def build():
    m = json.load(open(SRC, encoding="utf-8"))
    files = {}
    for key, e in m["pages"].items():
        d = dict(e)
        if d.get("signup") is not False:
            d.setdefault("ask", m["ask"])
        files[out_path(key)] = json.dumps(d, ensure_ascii=False, separators=(",", ":")) + "\n"
    return files


def main():
    files = build()
    have = set()
    for dp, _, fs in os.walk(OUT):
        for f in fs:
            if f.endswith(".json"):
                have.add(os.path.join(dp, f))
    if "--check" in sys.argv:
        bad = [p for p, t in files.items() if not os.path.exists(p) or open(p, encoding="utf-8").read() != t]
        bad += sorted(have - set(files))
        if bad:
            print("stale data/next files (run scripts/build_next_links.py):")
            for p in bad:
                print("  " + os.path.relpath(p, REPO))
            sys.exit(1)
        print("data/next matches data/next-links.json (%d pages)" % len(files))
        return
    for p in sorted(have - set(files)):
        os.remove(p)
    for p, t in files.items():
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w", encoding="utf-8") as fh:
            fh.write(t)
    print("wrote %d files under data/next" % len(files))


if __name__ == "__main__":
    main()
