#!/usr/bin/env python3
"""data/ids/basis-join/<ST>.json: which basis-history key each permanent elevator id holds (Oct 19, 2026).

/here compares an elevator's basis with its own recent history (data/basis/<ST>.json, the rows
behind the /cash-bids "from -42c" line). The live bid comes from the bids network, whose places
carry the permanent elevId; the history is keyed "FACILITY|CITY" per state. data/ids/elevators.json
already records every key each facility is known by, so the join is read from there, on the id,
never on a name.

Rules:
  - only facilities that are a bids-repo row (sources.bids_repo) and hold exactly ONE basis key
    (not filtered by today's history files, so the join changes only when the ids do; a key with
    no history today simply finds nothing)
  - a facility with two or more basis keys is listed under "multi" with its count and left out:
    which history is its own is not ours to guess
  - nothing else is read; the output is a pure function of elevators.json

Output: one small file per state (a phone reads only its own), data/ids/basis-join/<ST>.json =
  {"schema", "from", "rule", "k": {elevId: "ST|FACILITY|CITY"}, "multi": {elevId: n}}, and index.json with the counts.

Usage: python3 scripts/build_basis_join.py            write data/ids/basis-join/
       python3 scripts/build_basis_join.py --check    exit 1 when the committed file is not what this builds
       python3 scripts/build_basis_join.py --selftest
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "ids", "basis-join")


def build(elevators, facs):
    k, multi = {}, {}
    n_repo = n_basis = 0
    for e in elevators.get("elevators") or []:
        src = e.get("sources") or {}
        if not src.get("bids_repo"):
            continue
        n_repo += 1
        keys = [x for x in (src.get("basis") or []) if x.count("|") >= 2 and (facs is None or x.split("|", 1)[1] in facs.get(x.split("|", 1)[0], ()))]
        if not keys:
            continue
        n_basis += 1
        st = keys[0].split("|", 1)[0]
        if len(keys) == 1:
            k.setdefault(st, {})[e["id"]] = keys[0]
        else:
            multi.setdefault(st, {})[e["id"]] = len(keys)
    src = "data/ids/elevators.json generated " + str(elevators.get("generated") or "")
    rule = ("elevId -> its one basis-history key (ST|FACILITY|CITY in data/basis/<ST>.json); ids with two or more keys "
            "are in multi and left out. scripts/build_basis_join.py")
    files = {}
    for st in sorted(set(k) | set(multi)):
        files[st + ".json"] = {"schema": "agsist-basis-join/1", "state": st, "from": src, "rule": rule,
                               "k": dict(sorted(k.get(st, {}).items())), "multi": dict(sorted(multi.get(st, {}).items()))}
    files["index.json"] = {"schema": "agsist-basis-join-index/1", "from": src, "rule": rule,
                           "counts": {"bids_repo_ids": n_repo, "with_history": n_basis,
                                      "joined": sum(len(v) for v in k.values()), "multi": sum(len(v) for v in multi.values())},
                           "states": sorted(set(k) | set(multi))}
    return files


def text(doc):
    return json.dumps(doc, ensure_ascii=False, separators=(",", ":"), sort_keys=False) + "\n"


def selftest():
    el = {"generated": "2026-10-18", "elevators": [
        {"id": "e1", "sources": {"bids_repo": ["x"], "basis": ["WI|COOP X|CHETEK"]}},
        {"id": "e2", "sources": {"bids_repo": ["y"], "basis": ["WI|OLD MILL|BARRON", "WI|OLD MILL INC|BARRON"]}},
        {"id": "e3", "sources": {"bids_repo": ["z"], "basis": ["WI|GONE|RICE LAKE"]}},
        {"id": "a00001", "sources": {"basis": ["WI|COOP Y|CAMERON"]}},
        {"id": "e4", "sources": {"bids_repo": ["w"]}},
    ]}
    facs = {"WI": {"COOP X|CHETEK", "OLD MILL|BARRON", "OLD MILL INC|BARRON", "COOP Y|CAMERON"}}
    d = build(el, facs)
    assert sorted(d) == ["WI.json", "index.json"], sorted(d)
    assert d["WI.json"]["k"] == {"e1": "WI|COOP X|CHETEK"}, d
    assert d["WI.json"]["multi"] == {"e2": 2}, d
    assert d["index.json"]["counts"] == {"bids_repo_ids": 4, "with_history": 2, "joined": 1, "multi": 1}, d
    print("build_basis_join selftest: ok")


def main(argv):
    if "--selftest" in argv:
        return selftest()
    el = json.load(open(os.path.join(ROOT, "data", "ids", "elevators.json"), encoding="utf-8"))
    files = {name: text(doc) for name, doc in build(el, None).items()}
    have = set(os.listdir(OUT)) if os.path.isdir(OUT) else set()
    if "--check" in argv:
        bad = sorted(n for n in set(files) | have if n not in files or n not in have or open(os.path.join(OUT, n), encoding="utf-8").read() != files[n])
        if bad:
            print("data/ids/basis-join/ is not what scripts/build_basis_join.py builds (" + ", ".join(bad[:6]) + "); run it and commit", file=sys.stderr)
            return 1
        print("basis-join: up to date,", len(files), "files")
        return 0
    os.makedirs(OUT, exist_ok=True)
    for n in have - set(files):
        os.remove(os.path.join(OUT, n))
    for n, t in files.items():
        open(os.path.join(OUT, n), "w", encoding="utf-8").write(t)
    print("wrote", len(files), "files in", os.path.relpath(OUT, ROOT), json.loads(files["index.json"])["counts"])
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]) or 0)
