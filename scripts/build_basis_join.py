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
  - STITCHED (Oct 27, fx/basisstitch): when the ledger (data/ids/elevator-ids.json retired.<id>.keys) says
    every key but one was the key of a bids-repo id the bids repo folded into this one, the one left is the
    survivor's own name: it is the join (k), and "s" lists [survivor key, retired key...] so the page reads
    the old name's rows as the same elevator's earlier history (stitch() below, components/place.js
    basisStitch). Never on name likeness: a key from an AGSIST id merged in by build_ids, or two of the
    survivor's own names, stays in multi.
  - nothing else is read; the output is a pure function of elevators.json and the ids ledger

Output: one small file per state (a phone reads only its own), data/ids/basis-join/<ST>.json =
  {"schema", "from", "rule", "k": {elevId: "ST|FACILITY|CITY"}, "s": {elevId: [survivor key, retired key...]},
   "multi": {elevId: n}}, and index.json with the counts.

How a stitched contract reads (one crop, contract symbol and delivery; the shard keeps cur, prev, since, first,
last per name, not a day series). The survivor's row is matched on the exact delivery; a retired name's row on
the same crop and symbol and the same delivery month (FEB27, 02/01/2027 and "01 FEB 2027 TO 28 FEB 2027" are
one month; a two-month or mid-month delivery matches only itself; two candidates match nothing):
  - one name only: that row
  - no common day (one ended before the other began): the two replayed in date order, as one name would have
    been (build_basis_history.apply_day): first from the older, cur and last from the newer, the change
    across the gap dated the newer's first day
  - common days, the retired name older and unchanged over them and the survivor showing the same number on
    them: first from the retired name, the rest the survivor's (a change carried only by the older name keeps
    its date)
  - any other common days: the survivor's row as it is (counted: conflicts, and how many disagree)
Usage also: python3 scripts/build_basis_join.py --stitch-stats   counts per outcome on today's data/basis

Usage: python3 scripts/build_basis_join.py            write data/ids/basis-join/
       python3 scripts/build_basis_join.py --check    exit 1 when the committed file is not what this builds
       python3 scripts/build_basis_join.py --selftest
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "ids", "basis-join")


def _norm(x):
    return " ".join(str(x or "").strip().upper().split())


def retired_keys(ledger):
    """{survivor elevId: {basis key: retired elevId}} from the ledger's retirements (chains followed)."""
    ret = (ledger or {}).get("retired") or {}

    def live(e):
        seen = set()
        while e in ret and e not in seen:
            seen.add(e)
            e = ret[e].get("into")
        return e
    out = {}
    for rid, r in ret.items():
        for key in r.get("keys") or []:
            if key.startswith("basis:"):
                out.setdefault(live(rid), {})[key[6:]] = rid
    return out


def stitch_keys(keys, rmap):
    """[own key, retired key...] when every key but one is a retired board's own key, each retired board
    gives one, and all are in one state; else None."""
    own = [x for x in keys if x not in rmap]
    old = [x for x in keys if x in rmap]
    if len(own) != 1 or not old or len({x.split("|", 1)[0] for x in keys}) != 1:
        return None
    by = {}
    for x in old:
        by.setdefault(rmap[x], []).append(x)
    if any(len(v) != 1 for v in by.values()):
        return None
    return own + sorted(old)


def build(elevators, facs, ledger=None):
    k, multi, stitched = {}, {}, {}
    n_repo = n_basis = 0
    rk = retired_keys(ledger)
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
        sk = stitch_keys(keys, rk.get(e["id"]) or {}) if len(keys) > 1 else None
        if len(keys) > 1:
            # THE BOARD'S OWN CURRENT KEY (Oct 27). Two keys on one id are usually one facility under two
            # spellings over time (a fold, a renamed board). The key its own live rows write today
            # (sources.bids, upper-cased as build_basis_history.key_of does) is its history; if exactly
            # one key is that, it is the join. Otherwise unsure: multi, left out, as before.
            cur = {f"{st}|{_norm(p.split('|')[0])}|{_norm(p.split('|')[2])}" for p in (src.get("bids") or []) if p.count("|") == 3}
            own = [x for x in keys if x in cur]
            if len(own) == 1:
                keys = own
            elif sk:
                keys = sk[:1]
        if len(keys) == 1:
            k.setdefault(st, {})[e["id"]] = keys[0]
            if sk and sk[0] == keys[0]:
                stitched.setdefault(st, {})[e["id"]] = sk
        else:
            multi.setdefault(st, {})[e["id"]] = len(keys)
    src = "data/ids/elevators.json generated " + str(elevators.get("generated") or "")
    src += "; data/ids/elevator-ids.json retired keys"
    rule = ("elevId -> its one basis-history key (ST|FACILITY|CITY in data/basis/<ST>.json); an id with two or more keys "
            "joins the one its own live bid rows write today, or, when the ids ledger says every other key was a folded "
            "board's, its own key with those stitched on as its earlier history (s: [own key, folded keys]); else it is "
            "in multi and left out. scripts/build_basis_join.py")
    files = {}
    for st in sorted(set(k) | set(multi)):
        files[st + ".json"] = {"schema": "agsist-basis-join/1", "state": st, "from": src, "rule": rule,
                               "k": dict(sorted(k.get(st, {}).items())), "s": dict(sorted(stitched.get(st, {}).items())),
                               "multi": dict(sorted(multi.get(st, {}).items()))}
    files["index.json"] = {"schema": "agsist-basis-join-index/1", "from": src, "rule": rule,
                           "counts": {"bids_repo_ids": n_repo, "with_history": n_basis,
                                      "joined": sum(len(v) for v in k.values()), "stitched": sum(len(v) for v in stitched.values()),
                                      "multi": sum(len(v) for v in multi.values())},
                           "states": sorted(set(k) | set(multi))}
    return files


# ------------------------------------------------------------- the stitch ---
_MON = {m: i + 1 for i, m in enumerate("JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC".split())}
_MONTH = dict(_MON, SEPT=9, **{m: i + 1 for i, m in enumerate(
    "JANUARY FEBRUARY MARCH APRIL MAY JUNE JULY AUGUST SEPTEMBER OCTOBER NOVEMBER DECEMBER".split())})


def month_of(delivery):
    """'YYYY-MM' when a delivery names exactly one whole month (FEB27, FEB-27, JULY 2027, 02/01/2027,
    01 FEB 2027 TO 28 FEB 2027), else None. Mirrors components/place.js basisMonth."""
    d = " ".join(str(delivery or "").upper().split())
    m = re.match(r"^([A-Z]{3,9})[ -]?(\d{2}|\d{4})$", d)
    if m and m.group(1) in _MONTH:
        y = m.group(2) if len(m.group(2)) == 4 else "20" + m.group(2)
        return "%s-%02d" % (y, _MONTH[m.group(1)])
    m = re.match(r"^(\d{2})/01/(\d{4})$", d)
    if m and 1 <= int(m.group(1)) <= 12:
        return m.group(2) + "-" + m.group(1)
    m = re.match(r"^01 ([A-Z]{3}) (\d{4}) TO \d{2} ([A-Z]{3}) (\d{4})$", d)
    if m and m.group(1) in _MON and m.group(1) == m.group(3) and m.group(2) == m.group(4):
        return "%s-%02d" % (m.group(2), _MON[m.group(1)])
    return None


def stitch(s, r):
    """(row, how): survivor row s and a retired name's row r for one contract (dicts cur, prev, since, first,
    last; ISO days). how: one, retired_only, joined, overlap_agree, overlap_disagree, overlap_unknown,
    survivor_first. Mirrors components/place.js basisStitch."""
    if not r:
        return s, "one"
    if not s:
        return r, "retired_only"
    if not (s.get("first") and s.get("last") and r.get("first") and r.get("last")):
        return s, "overlap_unknown"
    a, b = (r, s) if r["first"] < s["first"] else (s, r)
    if a["last"] < b["first"]:
        # replay a then b, as one name: build_basis_history.apply_day
        if b.get("prev") is not None:
            row = dict(cur=b["cur"], prev=b["prev"], since=b["since"])
        elif b["cur"] != a["cur"]:
            row = dict(cur=b["cur"], prev=a["cur"], since=b["first"])
        else:
            row = dict(cur=b["cur"], prev=a.get("prev"), since=a.get("since"))
        row.update(first=a["first"], last=b["last"])
        return row, "joined"
    if b is r or r["first"] == s["first"]:
        return s, "survivor_first"
    # common days, the retired name older. Its number over them is known only when it last changed before
    # them; the survivor's only when it did not change before the retired name stops.
    if not (r.get("since") and r["since"] < s["first"]):
        return s, "overlap_unknown"
    if s.get("prev") is None:
        same = s["cur"] == r["cur"]
    else:
        same = s["since"] > r["last"] and s["prev"] == r["cur"]
    if not same:
        return s, "overlap_disagree"
    row = dict(s)
    if s.get("prev") is None:
        row.update(prev=r.get("prev"), since=r["since"])
    row["first"] = r["first"]
    return row, "overlap_agree"


def _n(v):
    return " ".join(str(v if v is not None else "").strip().upper().split())


def shard_rows(shard):
    """{'FACILITY|CITY': {(crop, SYMBOL, DELIVERY): row}} from a data/basis/<ST>.json shard, one row per
    contract as components/place.js basisHistMap keeps them (normalized, the last row wins)."""
    out = {}
    d, f = shard.get("d") or [], shard.get("f") or []
    c = shard.get("c") or ["corn", "soybeans", "wheat", "other"]
    when = lambda i: None if i is None or i >= len(d) else d[i]
    for r in shard.get("r") or []:
        fc = str(f[r[0]]).split("|", 1)
        out.setdefault(_n(fc[0]) + "|" + _n(fc[1] if len(fc) > 1 else ""), {})[(_n(c[r[1]]), _n(r[2]), _n(r[3]))] = dict(
            cur=r[4], prev=r[5], since=when(r[6]), first=when(r[7]), last=when(r[8]))
    return out


def series(rows, keys, crop, sym, delivery):
    """(row, [how...]) for one contract of a stitched id: rows from shard_rows, keys [survivor, retired...]
    (ST|FACILITY|CITY). Mirrors components/place.js basisHistory with an array key."""
    fk = lambda key: "|".join(_n(x) for x in key.split("|", 2)[1:])
    crop, sym, dl = _n(crop), _n(sym), _n(delivery)
    mo = month_of(dl)
    acc = (rows.get(fk(keys[0])) or {}).get((crop, sym, dl))
    hows = []
    for key in keys[1:]:
        old = rows.get(fk(key)) or {}
        cand = [v for (c2, s2, d2), v in old.items() if c2 == crop and s2 == sym and (d2 == dl or (mo and month_of(d2) == mo))]
        if len(cand) != 1:
            hows.append("no_match" if not cand else "two_match")
            continue
        acc, how = stitch(acc, cand[0])
        hows.append(how)
    return acc, hows


def stitch_stats(root=ROOT):
    """Counts per outcome over every stitched id's own contracts on today's data/basis."""
    from collections import Counter
    c, ids, with_old = Counter(), 0, 0
    for name in sorted(os.listdir(OUT)) if os.path.isdir(OUT) else []:
        if name == "index.json":
            continue
        doc = json.load(open(os.path.join(OUT, name), encoding="utf-8"))
        if not doc.get("s"):
            continue
        p = os.path.join(root, "data", "basis", doc["state"] + ".json")
        rows = shard_rows(json.load(open(p, encoding="utf-8"))) if os.path.exists(p) else {}
        for eid, keys in doc["s"].items():
            ids += 1
            got = False
            for (crop, sym, dl) in rows.get("|".join(_n(x) for x in keys[0].split("|", 2)[1:])) or {}:
                _row, hows = series(rows, keys, crop, sym, dl)
                for h in hows:
                    c[h] += 1
                got = got or any(h in ("joined", "overlap_agree") for h in hows)
            with_old += got
    return {"ids": ids, "ids_with_older_rows": with_old, "contracts": dict(sorted(c.items())),
            "conflicts": c["overlap_agree"] + c["overlap_disagree"] + c["overlap_unknown"] + c["survivor_first"]}


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
    assert d["index.json"]["counts"] == {"bids_repo_ids": 4, "with_history": 2, "joined": 1, "stitched": 0, "multi": 1}, d

    # STITCHED, real ids (Oct 27 ledger). NuGen Marion: the bids repo folded eetwt0affq into e011hgtdgf by phone;
    # no live row today writes either spelling, so it was in multi. Mid-Iowa Klostermann: its live row picks its
    # own key, and the folded Earlville board's key is stitched on. Mercer Landmark Coldwater: its second key came
    # with AGSIST id a00392 (a build_ids merge, not a fold), so it stays out.
    el = {"generated": "2026-10-27", "elevators": [
        {"id": "e011hgtdgf", "sources": {"bids_repo": ["nugenmarion-nugenmarion"],
                                         "basis": ["SD|NUGEN ENERGY, LLC|MARION", "SD|NUGEN ENERGY, LLC|NUGEN MARION"]}},
        {"id": "e2b33gqv4q", "sources": {"bids_repo": ["midiowa-klostermann"], "bids": ["Mid-Iowa Cooperative||KLOSTERMANN|IA"],
                                         "basis": ["IA|MID-IOWA COOPERATIVE|EARLVILLE", "IA|MID-IOWA COOPERATIVE|KLOSTERMANN"]}},
        {"id": "e0ykb4h2tx", "sources": {"bids_repo": ["mercerlandmark-coldwatergrainnorth"],
                                         "basis": ["OH|MERCER LANDMARK|COLDWATER GRAIN NORTH", "OH|MERCER LANDMARK|ROCKFORD"]}},
    ]}
    led = {"minted": {"a00392": {"into": "e0ykb4h2tx"}}, "retired": {
        "eetwt0affq": {"into": "e011hgtdgf", "rule": "phone", "keys": ["basis:SD|NUGEN ENERGY, LLC|MARION"]},
        "ek7ttxkphd": {"into": "e2b33gqv4q", "rule": "phone", "keys": ["basis:IA|MID-IOWA COOPERATIVE|EARLVILLE"]}}}
    d = build(el, None, led)
    assert d["SD.json"]["k"] == {"e011hgtdgf": "SD|NUGEN ENERGY, LLC|NUGEN MARION"}, d["SD.json"]
    assert d["SD.json"]["s"] == {"e011hgtdgf": ["SD|NUGEN ENERGY, LLC|NUGEN MARION", "SD|NUGEN ENERGY, LLC|MARION"]}
    assert d["IA.json"]["k"] == {"e2b33gqv4q": "IA|MID-IOWA COOPERATIVE|KLOSTERMANN"}
    assert d["IA.json"]["s"] == {"e2b33gqv4q": ["IA|MID-IOWA COOPERATIVE|KLOSTERMANN", "IA|MID-IOWA COOPERATIVE|EARLVILLE"]}
    assert d["OH.json"]["multi"] == {"e0ykb4h2tx": 2} and d["OH.json"]["k"] == {} and d["OH.json"]["s"] == {}
    assert d["index.json"]["counts"] == {"bids_repo_ids": 3, "with_history": 3, "joined": 2, "stitched": 2, "multi": 1}
    assert build(el, None)["SD.json"]["multi"] == {"e011hgtdgf": 2}      # without the ledger: left out, as before
    # a folded board that held two keys, or keys in two states: not stitched
    assert stitch_keys(["IA|A|B", "IA|A|C", "IA|A|D"], {"IA|A|C": "r1", "IA|A|D": "r1"}) is None
    assert stitch_keys(["IA|A|B", "MN|A|C"], {"MN|A|C": "r1"}) is None

    # one delivery month, three spellings
    assert month_of("FEB27") == month_of("02/01/2027") == month_of("01 FEB 2027 TO 28 FEB 2027") == month_of("FEB-27") == "2027-02"
    assert month_of("JULY-27") == month_of("JUL 2027") == "2027-07"
    assert month_of("OCT/NOV-26") is None and month_of("10/16/2026") is None and month_of("01 OCT 2026 TO 15 NOV 2026") is None

    # the outcomes, on real row pairs from data/basis on Oct 27 (survivor row first)
    R = lambda cur, prev, since, first, last: dict(cur=cur, prev=prev, since=since, first=first, last=last)
    # Tremont Co-operative: Delavan (folded) seen Oct 9 to 11 as OCT26, Toboggan from Oct 18 as "OCT 2026": no common day
    assert stitch(R(-35, -37, "2026-10-23", "2026-10-18", "2026-10-27"), R(-37, None, "2026-10-09", "2026-10-09", "2026-10-11")) == (
        R(-35, -37, "2026-10-23", "2026-10-09", "2026-10-27"), "joined")
    # Mid-Iowa: Earlville JAN27 since Jun 9, last changed Sep 16; Klostermann 01/01/2027 from Sep 22, the same -38
    assert stitch(R(-38, None, "2026-09-22", "2026-09-22", "2026-10-27"), R(-38, 38, "2026-09-16", "2026-06-09", "2026-10-11")) == (
        R(-38, 38, "2026-09-16", "2026-06-09", "2026-10-27"), "overlap_agree")
    # Farmers Win: Waverly NOV26 at -53 to Oct 11, Bremer 11/01/2026 at -60 on the same days: the survivor's row
    s = R(-65, -60, "2026-10-27", "2026-09-22", "2026-10-27")
    assert stitch(s, R(-53, -52, "2026-09-10", "2026-06-09", "2026-10-11")) == (s, "overlap_disagree")
    # Dunkerton: the folded name changed inside the common days; the survivor's row
    s = R(-1, 0, "2026-09-28", "2026-09-22", "2026-10-01")
    assert stitch(s, R(-100, 0, "2026-09-28", "2026-09-09", "2026-09-30")) == (s, "overlap_unknown")
    s = R(-25, -23, "2026-10-22", "2026-10-02", "2026-10-27")
    assert stitch(s, R(-26, None, "2026-10-02", "2026-10-02", "2026-10-11")) == (s, "survivor_first")
    assert stitch(s, None) == (s, "one") and stitch(None, s) == (s, "retired_only")
    # the series lookup: the survivor on its exact delivery, the folded name on the same month
    sh = {"state": "IL", "c": ["corn", "soybeans", "wheat", "other"], "f": ["TREMONT CO-OPERATIVE GRAIN CO.|TOBOGGAN", "TREMONT CO-OPERATIVE GRAIN CO.|DELAVAN"],
          "d": ["2026-10-09", "2026-10-11", "2026-10-18", "2026-10-23", "2026-10-27"],
          "r": [[0, 0, "ZCZ26", "OCT 2026", -35, -37, 3, 2, 4], [1, 0, "ZCZ26", "OCT26", -37, None, 0, 0, 1], [1, 0, "ZCZ26", "NOV26", -40, None, 0, 0, 1]]}
    keys = ["IL|TREMONT CO-OPERATIVE GRAIN CO.|TOBOGGAN", "IL|TREMONT CO-OPERATIVE GRAIN CO.|DELAVAN"]
    assert series(shard_rows(sh), keys, "corn", "ZCZ26", "OCT 2026") == (R(-35, -37, "2026-10-23", "2026-10-09", "2026-10-27"), ["joined"])
    assert series(shard_rows(sh), keys, "corn", "ZCZ26", "DEC 2026") == (None, ["no_match"])
    print("build_basis_join selftest: ok")


def main(argv):
    if "--selftest" in argv:
        return selftest()
    if "--stitch-stats" in argv:
        print(json.dumps(stitch_stats()))
        return 0
    el = json.load(open(os.path.join(ROOT, "data", "ids", "elevators.json"), encoding="utf-8"))
    led = json.load(open(os.path.join(ROOT, "data", "ids", "elevator-ids.json"), encoding="utf-8"))
    files = {name: text(doc) for name, doc in build(el, None, led).items()}
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
