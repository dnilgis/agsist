#!/usr/bin/env python3
"""Ownership change log (data/ids/ownership-changes.json) applied to the elevator records and board parents.

Real rows: the Pearl City Elevator boards of dnilgis/bids data/index.json and the CHS Kasson, Ostrander, Wykoff
records of data/ids/elevators.json, read 2026-10-29.
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import copy
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import basis_method as BM  # noqa: E402
import board_parents as BP  # noqa: E402
import build_ids as BI  # noqa: E402

fails, passes = [], 0


def check(cond, msg):
    global passes
    if cond:
        passes += 1
    else:
        fails.append(msg)


def load(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        return json.load(f)


log = load("data/ids/ownership-changes.json")
doc = load("data/ids/elevators.json")
recs = {r["id"]: r for r in doc["elevators"]}
ledger = load("data/ids/elevator-ids.json")
ev = {e["id"]: e for e in log["events"]}

# ids are never reused: every id in the log is a live record and none was retired
for e in log["events"]:
    for fid in e["facilities"]:
        check(fid in recs, f"{e['id']}: {fid} is not a record of elevators.json")
        check(fid not in (ledger.get("retired") or {}), f"{e['id']}: {fid} is a retired id")
check(len({e["id"] for e in log["events"]}) == len(log["events"]), "event ids repeat")
check(all(e.get("source") for e in log["events"]), "an event without a source")
check("—" not in open(os.path.join(ROOT, "data/ids/ownership-changes.json"), encoding="utf-8").read(), "em dash in the log")

# the shipped records equal the log applied to themselves (the file is what the builder gives), and it is idempotent
again = copy.deepcopy(doc["elevators"])
n = BI.apply_changes(again, log, doc["generated"])
check(again == doc["elevators"], "elevators.json is not the change log applied")
check(n == doc["counts"]["with_ownership_change"] == 18, f"marked count {n}")
check(BI.apply_changes(again, log, doc["generated"]) == n and again == doc["elevators"], "apply_changes is not idempotent")

# the board's own posted name wins: names and companies are untouched
for fid in ev["oc01"]["facilities"]:
    check(recs[fid]["company"] == "Pearl City Elevator, Inc." and recs[fid]["parent"]["name"] == "Stephenson Service Company",
          f"{fid}: name or parent")
check(recs["etzgyj9bd6"]["company"] == "West Central Ag Services" and recs["etzgyj9bd6"]["parent"]["name"] == "CHS Inc.",
      "West Central Ag Services Ulen")
# closing after harvest (CHS Kasson, Ostrander, Wykoff), pending and lease are marked, never applied as a parent
for city in ("Kasson", "Ostrander", "Wykoff"):
    got = [r for r in recs.values() if r["city"] == city and r["st"] == "MN" and "CHS" in r["company"]]
    check(got and all(r.get("status", {}).get("kind") == "closing" and r["status"]["after"] == "2026 harvest" for r in got),
          f"{city}: closing after the 2026 harvest")
# ADM Montgomery City by the log's own event (oc06), resolved through the id ledger: no pinned id (Nov 10 2026 the
# AGSIST id a00298 merged into the bids-repo row and the status must follow the merge)
resolve = BI.id_resolver(ledger, recs)
adm = [resolve(f) for f in ev["oc06"]["facilities"]]
check(adm and all(f in recs for f in adm), "ADM Montgomery City: the oc06 facility resolves to a live record")
check(all(recs[f]["city"] == "Montgomery City" and recs[f]["st"] == "MO" and recs[f].get("status", {}).get("kind") == "pending"
          and recs[f]["status"]["event"] == "oc06" and "parent" not in recs[f] for f in adm if f in recs),
      "ADM Montgomery City: pending, no parent")
check(resolve("a00298") in adm, "the merged id a00298 still resolves to the ADM Montgomery City record")
check(recs["a00403"]["status"]["to"] == "Kalmbach Feeds" and "parent" not in recs["a00403"], "Mennel Upper Sandusky: pending")
check(all(recs[f]["status"]["kind"] == "lease" and recs[f]["company"] == "Scott Coop" and "parent" not in recs[f]
          for f in ev["oc08"]["facilities"]), "Scoular leases to Scott Coop: operator only")
check("status" not in recs["esvgverxq9"] and "parent" not in recs["esvgverxq9"], "a record already under the new name is left alone")

# a log naming a merged id still marks the survivor; a chain of two merges; a retired id with no survivor is skipped.
# Fixture: the ADM Montgomery City record of elevators.json (Nov 10 2026) and made-up ids around it.
fx = [{"id": "esf055a2zt", "company": "Archer-Daniels-Midland Company", "city": "Montgomery City", "st": "MO"},
      {"id": "ezzzzzzzz1", "company": "Chain End", "city": "X", "st": "MO"}]
fled = {"minted": {"a00298": {"into": "esf055a2zt"}}, "retired": {"eold000001": {"into": "a09001"}},
        "events": [{"on": "2026-11-10", "merge": "a00298", "into": "esf055a2zt"},
                   {"on": "2026-11-01", "merge": "a09001", "into": "ezzzzzzzz2"},
                   {"on": "2026-11-02", "retire": "ezzzzzzzz2", "into": "ezzzzzzzz1"},
                   {"on": "2026-11-03", "merge": "a09002", "into": "a09003"},
                   {"on": "2026-11-03", "merge": "a09003", "into": "a09002"},
                   {"on": "2026-11-03", "retire": "egone00001", "into": "egone00002"}]}
flog = {"events": [{"id": "t1", "kind": "pending", "to": "MFA Inc", "facilities": ["a00298"]},
                   {"id": "t2", "kind": "closing", "after": "2026 harvest", "facilities": ["a09001"]},
                   {"id": "t3", "kind": "closed", "facilities": ["egone00001", "a09002", "anever0001"]}]}
fres = BI.id_resolver(fled, [r["id"] for r in fx])
frecs = copy.deepcopy(fx)
nn = BI.apply_changes(frecs, flog, "2026-11-10", fres)
fby = {r["id"]: r for r in frecs}
check(fby["esf055a2zt"].get("status", {}).get("event") == "t1", "a log naming a merged id marks the survivor")
check(fby["ezzzzzzzz1"].get("status", {}).get("event") == "t2" and fres("a09001") == "ezzzzzzzz1",
      "a chain of two merges (merge, then a retirement) gives the last survivor")
check(fres("eold000001") == "ezzzzzzzz1", "a chain through the ledger's retired list")
check(fres("egone00001") is None and fres("a09002") is None and fres("anever0001") is None and nn == 2
      and not any(r.get("status", {}).get("event") == "t3" for r in frecs) and len(frecs) == 2,
      "a retired id with no survivor, a merge cycle and an unknown id are skipped, never minted")
check(BI.apply_changes(copy.deepcopy(fx), flog, "2026-11-10") == 0, "without the resolver a merged id marks nothing")
check(fres("esf055a2zt") == "esf055a2zt", "a live id resolves to itself")
bk = BI.id_resolver({"events": [{"merge": "a1", "into": "e1"}, {"retire": "e1", "into": "a2"}, {"back": "e1", "from": "a2"}]}, ["e1"])
check(bk("a1") == "e1" and bk("a2") == "e1", "a returned id is live again and its stand-in follows it back")
# board parents and company ids read the change log through the same resolver
fdir = {"elevators": [{"id": "b-mc", "elevId": "esf055a2zt", "operator": "ADM Grain"}]}
fidx = {"sources": [{"id": "b-mc", "operator": "ADM Grain", "location": "Montgomery City", "website": "", "url": "", "health": "live"}]}
plog = {"events": [{"id": "t4", "kind": "parent", "parent": "MFA Inc", "effective": "2026-11-01", "facilities": ["a00298"]}]}
check(BP.build(fdir, fidx, "2026-11-10", plog, fres)["boards"].get("b-mc", {}).get("pv") == "change:t4",
      "board parents: a change naming a merged id reaches the survivor's board")
check("b-mc" not in BP.build(fdir, fidx, "2026-11-10", plog)["boards"], "board parents without the resolver: nothing")
import company_ids as CI  # noqa: E402
clog = {"events": [{"id": "t5", "kind": "parent", "parent": "P", "effective": "2026-11-01", "facilities": ["a00298", "a09001"]}]}
cdoc = CI.build({"elevators": []}, {"sources": []}, fx, {"boards": {}}, clog, None, "2026-11-10", fres)
check(any(set(c["facilities"]) == {"esf055a2zt", "ezzzzzzzz1"} for c in cdoc["companies"].values()),
      "company ids: a change naming merged ids links the survivors")
check(not CI.build({"elevators": []}, {"sources": []}, fx, {"boards": {}}, clog, None, "2026-11-10")["companies"],
      "company ids without the resolver: nothing linked")
fol = BI.follow_changes(plog, fres)
check(fol["events"][0]["facilities"] == ["esf055a2zt"] and plog["events"][0]["facilities"] == ["a00298"],
      "follow_changes gives live ids and leaves the log as given")

# board parents from REAL boards of the bids index (2026-10-29)
directory = {"elevators": [
    {"id": "pcecoops-pearlcity", "elevId": "ef7wxjzrp7", "operator": "iframe - Pearl City Elevator, Inc."},
    {"id": "pcecoops-baileyville", "elevId": "e6m8m33m3v", "operator": "iframe - Pearl City Elevator, Inc."},
    {"id": "chsag-kasson", "elevId": "e8t3a0vh09", "operator": "CHS River Terminals & Processing Plants"},
    {"id": "chsagservices-ulen", "elevId": "eq6zz1bk9m", "operator": "CHS Ag Services"},
    {"id": "stephenson-lena", "elevId": "a00158", "operator": "Stephenson Service Company"}]}
index = {"sources": [dict(id=d["id"], operator=d["operator"], location=d["id"], website="", url="", health="live")
                     for d in directory["elevators"]]}
bp = BP.build(directory, index, "2026-10-29", log)["boards"]
check(bp["pcecoops-pearlcity"]["parent"] == "Stephenson Service Company" and bp["pcecoops-pearlcity"]["pv"] == "change:oc01",
      "Pearl City board: parent Stephenson by change")
check(bp["pcecoops-baileyville"]["parent"] == "Stephenson Service Company", "Baileyville board")
check(bp["chsag-kasson"]["pv"] == "chs-brand" if "chsag-kasson" in bp else False, "a CHS board keeps the chs-brand rule")
check("stephenson-lena" not in bp, "the parent's own board gets no parent")
check("parent" not in BP.build(directory, index, "2026-08-31", log)["boards"].get("pcecoops-pearlcity", {}),
      "before the effective date there is no parent")
nolog = BP.build(directory, index, "2026-10-29")["boards"]
check("pcecoops-pearlcity" not in nolog, "without the log nothing changes")
# and the company count: the merged firm's boards fold with the parent's own board, and with no such board nothing moves
pc = [{"operator": "Pearl City Elevator, Inc.", "site": "", "parent": "Stephenson Service Company"},
      {"operator": "Stephenson Service Company", "site": ""}]
check(BM.companies_behind(pc) == 1, "Pearl City and Stephenson boards count as one company")
check(BM.companies_behind([dict(pc[0]), dict(pc[0])]) == BM.companies_behind([{k: v for k, v in pc[0].items() if k != "parent"}] * 2) == 1,
      "a parent with no board of its own changes no count")
check(BM.companies_behind([{k: v for k, v in r.items() if k != "parent"} for r in pc]) == 2, "without the parent: two")

for f in fails:
    print("FAIL: " + f)
print(f"test_ownership_changes: {passes} passed, {len(fails)} failed")
sys.exit(1 if fails else 0)
