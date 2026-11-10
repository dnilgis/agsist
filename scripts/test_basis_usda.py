#!/usr/bin/env python3
"""USDA'S STATE AVERAGE BESIDE OUR MEDIAN, FROM THE REAL NOV 2, 2026 REPORTS.

    python3 scripts/test_basis_usda.py

Nov 3 2026. The state basis middle stays the median
of every elevator we read, labelled "median of N elevators", and USDA AMS's
own state daily average shows under it with its report name and date, no
link, only on the same futures month and only when fresh.

The real case (probe Nov 3): Kansas corn, ours 35 under Dec (210 elevators,
AgMark and CoMark boards carry it), USDA's Kansas average 5 under Dec, a
regional average. No data bug: both print, side by side, nothing hidden.
Iowa corn, ours 40 under, USDA 41 under: within a cent. Southern Minnesota is
USDA's area, not the state, and the line says so by name.

Fixture: test/fixtures/state-grain-ams/2026-11-02.json, cut from
data/state-grain-ams.json as it stood on Nov 3, 2026.
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import datetime as dt
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import build_cash_bid_pages as CB  # noqa: E402

fails, passes = [], 0


def check(cond, msg):
    global passes
    if cond:
        passes += 1
    else:
        fails.append(msg)


with open(os.path.join(ROOT, "test", "fixtures", "state-grain-ams", "2026-11-02.json"), encoding="utf-8") as f:
    USDA = json.load(f)
NOV2 = dt.date(2026, 11, 2)
DEC26, JAN27, MAR27, DEC27 = ("ZC", 11, 2026), ("ZS", 0, 2027), ("ZC", 2, 2027), ("ZC", 11, 2027)


def head(con, med, n, co=None, lo=-0.9, hi=0.2):
    h = {"contract": con, "median": med, "n": n, "lo": lo, "hi": hi, "strong": [], "weak": []}
    if co is not None:
        h["companies"] = co
    return h


# ── the line, from the real reports ─────────────────────────────────────────
ia = CB.usda_beside("IA", "corn", head(DEC26, -0.40, 350, 52), USDA, NOV2)
check(ia and ia["basis"] == -41, f"Iowa corn: USDA 41 under Dec: {ia}")
check(ia and ia["line"] == "USDA's Iowa average that day: 41 under Dec (USDA AMS, Iowa Daily Cash Grain Bids, "
      "Nov 2, 2026).", f"Iowa corn line: {ia and ia['line']}")
check(ia and abs(round(-0.40 * 100) - ia["basis"]) <= 1, "Iowa corn: ours and USDA's within a cent")
ias = CB.usda_beside("IA", "soybeans", head(JAN27, -0.78, 288, 32), USDA, NOV2)
check(ias and ias["basis"] == -82 and "82 under Jan" in ias["line"],
      f"Iowa soybeans: USDA's Jan average, not its Nov one (-70): {ias}")
ks = CB.usda_beside("KS", "corn", head(DEC26, -0.35, 210, 25), USDA, NOV2)
check(ks and ks["line"] == "USDA's Kansas average that day: 5 under Dec (USDA AMS, Kansas Daily Grain Bids, "
      "Nov 2, 2026).", f"Kansas corn line: {ks and ks['line']}")
mn = CB.usda_beside("MN", "corn", head(DEC26, -0.75, 141, 43), USDA, NOV2)
check(mn and mn["line"].startswith("USDA's Southern Minnesota average that day: 52 under Dec (USDA AMS, Southern "
                                   "Minnesota Daily Grain Bids,") and mn["partial"],
      f"Minnesota: USDA's area named as its own: {mn}")
check(not CB.usda_beside("KS", "corn", head(DEC26, -0.35, 210, 25), USDA, NOV2)["partial"], "Kansas is the whole state")

# ── when it is withheld ─────────────────────────────────────────────────────
check(CB.usda_beside("MN", "corn", head(MAR27, -0.5, 40), USDA, NOV2) is None, "different futures month: no line")
check(CB.usda_beside("IA", "corn", head(DEC27, -0.5, 40), USDA, NOV2) is None,
      "Dec '27 is not USDA's Dec in Nov 2026: no line")
check(CB.usda_beside("TX", "corn", head(DEC26, 0.55, 17), USDA, NOV2) is None, "a state USDA does not report: no line")
stale = json.loads(json.dumps(USDA))
stale["states"]["IA"]["stale"] = True
check(CB.usda_beside("IA", "corn", head(DEC26, -0.40, 350), stale, NOV2) is None, "stale report: no line")
del stale["states"]["IA"]["stale"]
check(CB.usda_beside("IA", "corn", head(DEC26, -0.40, 350), stale, NOV2) is None, "no stale flag: no line")
check(CB.usda_beside("IA", "corn", head(DEC26, -0.40, 350), USDA, dt.date(2026, 11, 6)) is None,
      "report 4 days older than our snapshot: no line")
check(CB.usda_beside("IA", "corn", head(DEC26, -0.40, 350), USDA, dt.date(2026, 11, 1)) is None,
      "report dated after our snapshot: no line (no look-ahead)")
nov3 = CB.usda_beside("IA", "corn", head(DEC26, -0.40, 350), USDA, dt.date(2026, 11, 3))
check(nov3 and nov3["line"].startswith("USDA's Iowa average on Nov 2: 41 under Dec"),
      f"a day apart: the line names USDA's day, not 'that day': {nov3 and nov3['line']}")
nob = json.loads(json.dumps(USDA))
nob["states"]["IA"]["crops"]["corn"]["current"]["avg_basis"] = {}
check(CB.usda_beside("IA", "corn", head(DEC26, -0.40, 350), nob, NOV2) is None, "USDA withheld its average: no line")
check(CB.usda_beside("IA", "corn", head(DEC26, -0.40, 350), None, NOV2) is None, "no USDA file: no line")
check(CB.usda_beside("IA", "wheat_hrw", head(DEC26, -0.40, 350), USDA, NOV2) is None, "corn and soybeans only")
check(CB.load_usda(os.path.join(ROOT, "no-such-dir")) is None, "missing file reads as None, not a crash")

# ── the pages print it ──────────────────────────────────────────────────────
summ = {"corn": {"contracts": [head(DEC26, -0.35, 210, 25)], "rows": [1], "no_contract": [], "suspect": []},
        "soybeans": {"contracts": [head(JAN27, -1.00, 150, 16)], "rows": [1], "no_contract": [], "suspect": []}}
check(CB.attach_usda({"KS": summ}, USDA, NOV2) == 2, "Kansas: corn and soybeans both get USDA's line")
stat = CB.basis_stat("corn", summ["corn"]["contracts"][0], None)
check("Median of <b>210</b> elevators, <b>25</b> companies" in stat, f"headline label: {stat}")
check("<div class=\"s\">USDA&#x27;s Kansas average that day: 5 under Dec (USDA AMS, Kansas Daily Grain Bids, "
      "Nov 2, 2026).</div>" in stat,
      f"USDA line under the Kansas corn median: {stat}")
check(f'<div class="v">{CB.money_basis(-0.35)}</div>' in stat, "our Kansas number still prints as it is")
sec = CB.basis_section("KS", summ, None)
check("<a " not in re.sub(r'<ul class="cbt-list">.*', "", sec.split("cbt-hero", 1)[1], flags=re.S),
      "no link in the basis headline or USDA line (Oct 29 rule)")
check("surveys by region" in sec, "the section says USDA's average is USDA's own")
check("\u2014" not in sec, "no em dash")
bare = {"corn": {"contracts": [head(DEC26, 0.55, 17, 3)], "rows": [1], "no_contract": [], "suspect": []}}
CB.attach_usda({"TX": bare}, USDA, NOV2)
sec_tx = CB.basis_section("TX", bare, None)
check("USDA" not in sec_tx and "Median of <b>17</b> elevators, <b>3</b> companies" in sec_tx,
      "a state without USDA's line: no USDA words, the label still prints")
# a fresh build drops an old line
summ2 = {"corn": {"contracts": [dict(head(DEC26, -0.35, 210, 25), usda={"line": "old"})]}}
ks_stale = json.loads(json.dumps(USDA))
ks_stale["states"]["KS"]["stale"] = True
CB.attach_usda({"KS": summ2}, ks_stale, NOV2)
check("usda" not in summ2["corn"]["contracts"][0], "a line from an earlier pass is dropped when USDA no longer qualifies")

# ── basis-states.json and /basis carry the same line ────────────────────────
ctx = {"snap_iso": "2026-11-03T02:05:56Z", "prev_generated": None}
doc = CB.basis_states_doc({"KS": summ}, ctx, {"KS": 210})
kc = doc["states"]["KS"]["crops"]["corn"]
check(kc.get("usda", {}).get("basis") == -5 and kc["median"] == -0.35, f"basis-states.json carries both: {kc}")
pick = CB.hub_pick_html(doc, "KS")
check('<span class="mut">median of 210 elevators, 25 companies</span><span class="bs-usda">USDA' in pick,
      f"/basis state pick: label and USDA line baked: {pick}")
cell = CB._cell(kc)
check("median of</span>" in cell and ">210 elevators,</span>" in cell and ">25 companies</span>" in cell,
      f"/basis table cell: label kept in whole pieces at phone width: {cell}")
hub = open(os.path.join(ROOT, "basis.html"), encoding="utf-8").read()
check("c.usda&&c.usda.line" in hub and "esc(c.usda.line)" in hub and ".bs-pick-l .bs-usda{" in hub,
      "basis.html: the picker prints the same USDA line as the seed, escaped and styled")
# town pages compare against the labelled median
check(CB.med_of({"n": 210, "companies": 25}) == "median of 210 elevators, 25 companies", "med_of words")

for f in fails:
    print("FAIL: " + f)
print(f"test_basis_usda: {passes} passed, {len(fails)} failed")
sys.exit(1 if fails else 0)
