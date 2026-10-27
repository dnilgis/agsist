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
  - a facility with two or more basis keys joins the one key its own live bid rows (sources.bids) write
    today, when exactly one is that (Oct 27: retiring folded ids put two spellings on one id); else it is
    listed under "multi" with its count and left out: which history is its own is not ours to guess
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


def _norm(x):
    return " ".join(str(x or "").strip().upper().split())


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
        if len(keys) > 1:
            # THE BOARD'S OWN CURRENT KEY (Oct 27). Two keys on one id are usually one facility under two
            # spellings over time (a fold, a renamed board). The key its own live rows write today
            # (sources.bids, upper-cased as build_basis_history.key_of does) is its history; if exactly
            # one key is that, it is the join. Otherwise unsure: multi, left out, as before.
            cur = {f"{st}|{_norm(p.split('|')[0])}|{_norm(p.split('|')[2])}" for p in (src.get("bids") or []) if p.count("|") == 3}
            own = [x for x in keys if x in cur]
            if len(own) == 1:
                keys = own
        if len(keys) == 1:
            k.setdefault(st, {})[e["id"]] = keys[0]
        else:
            multi.setdefault(st, {})[e["id"]] = len(keys)
    src = "data/ids/elevators.json generated " + str(elevators.get("generated") or "")
    rule = ("elevId -> its one basis-history key (ST|FACILITY|CITY in data/basis/<ST>.json); an id with two or more keys "
            "joins the one its own live bid rows write today, else it is in multi and left out. scripts/build_basis_join.py")
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
        # real (Oct 27): CoMark's Halstead West board holds the folded registry spelling too
        {"id": "egz19x9jv6", "sources": {"bids_repo": ["ceagrain-halsteadwest"], "bids": ["CoMark Equity Alliance LLC||HALSTEAD WEST|KS"],
                                         "basis": ["KS|COMARK EQUITY ALLIANCE LLC|HALSTEAD", "KS|COMARK EQUITY ALLIANCE LLC|HALSTEAD WEST",
                                                   "KS|FARMERS COOPERATIVE ELEVATOR COMPANY|HALSTEAD"]}},
        # two keys, neither written by its own rows today: unsure
        {"id": "e5", "sources": {"bids_repo": ["v"], "bids": ["Nexus Cooperative||Elsewhere|IA"],
                                 "basis": ["IA|NEXUS COOPERATIVE|HARLAN", "IA|NEXUS COOPERATIVE|HARLAN, IA"]}},
    ]}
    facs = {"WI": {"COOP X|CHETEK", "OLD MILL|BARRON", "OLD MILL INC|BARRON", "COOP Y|CAMERON"},
            "KS": {"COMARK EQUITY ALLIANCE LLC|HALSTEAD", "COMARK EQUITY ALLIANCE LLC|HALSTEAD WEST",
                   "FARMERS COOPERATIVE ELEVATOR COMPANY|HALSTEAD"}}
    d0 = build(el, facs)
    assert d0["KS.json"]["k"] == {"egz19x9jv6": "KS|COMARK EQUITY ALLIANCE LLC|HALSTEAD WEST"}, d0["KS.json"]
    assert build(el, None)["IA.json"]["multi"] == {"e5": 2}
    el["elevators"] = el["elevators"][:5]
    facs.pop("KS")
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
