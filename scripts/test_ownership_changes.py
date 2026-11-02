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
check(recs["a00298"]["status"]["kind"] == "pending" and "parent" not in recs["a00298"], "ADM Montgomery City: pending, no parent")
check(recs["a00403"]["status"]["to"] == "Kalmbach Feeds" and "parent" not in recs["a00403"], "Mennel Upper Sandusky: pending")
check(all(recs[f]["status"]["kind"] == "lease" and recs[f]["company"] == "Scott Coop" and "parent" not in recs[f]
          for f in ev["oc08"]["facilities"]), "Scoular leases to Scott Coop: operator only")
check("status" not in recs["esvgverxq9"] and "parent" not in recs["esvgverxq9"], "a record already under the new name is left alone")

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
