#!/usr/bin/env python3
"""
test_wpi_verdicts.py — one print, one verdict, on the What's Priced In page.

The page renders two files written by two builders:
  data/whats-priced-in.json   (track record + report strip)  build_whats_priced_in.py
  data/analyst-scorecard.json ("Scored, by report")          build_analyst_scorecard.py
Both grade with report_bands.surprise. Until 2026-10-06 the scorecard passed it
the trade average without the survey's range, so September 2026 soybean yield
(trade 52.5, range 51.5-53.3, USDA 52.8) read IN LINE in one section and
BEARISH in the other.

On 2026-10-10 the rule changed (Sig approved it): the distance from the trade
average decides, against a band per kind of number (yield 0.5%, production
1%, stocks 2%), and the range is printed as context. October corn yield, 1.9%
over the average and inside the range, had read "in line".

This checks (1) the scorecard grader applies that rule on the real rows,
(2) the conflict detector catches a planted disagreement, and (3) the shipped
JSON files agree on every (report date, metric label) they share.
prerender_wpi_scorecard.py --check runs the same comparison in CI.

    python3 scripts/test_wpi_verdicts.py
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import build_analyst_scorecard as bas  # noqa: E402
from prerender_wpi_scorecard import verdict_conflicts  # noqa: E402

fails = []


def check(ok, label):
    print(("  ok    " if ok else "  FAIL  ") + label)
    if not ok:
        fails.append(label)


# 1. The scorecard grades on the distance from the average; the range is context.
data = {"reports": [{"report": "September WASDE", "date": "2026-09-11", "metrics": [
    {"label": "2026/27 soybean yield", "consensus": 52.5, "actual": 52.8,
     "consensus_range": [51.5, 53.3], "estimates": [{"id": "x", "value": 53.0}]},
    {"label": "2026/27 soybean ending stocks", "consensus": 290, "actual": 310,
     "estimates": []}]},
    {"report": "October WASDE", "date": "2026-10-09", "metrics": [
    {"label": "2026/27 corn yield", "consensus": 177.8, "actual": 181.2,
     "consensus_range": [173.2, 182.1], "estimates": []},
    {"label": "2026/27 soybean production", "consensus": 4541, "actual": 4562,
     "consensus_range": [4415, 4648], "estimates": []}]}]}
_c, reps = bas.score(data, {"x": {"analyst": "X", "firm": ""}}, "2026-10-10")
got = {(r["date"], m["label"]): (m["surprise"], m["context"]) for r in reps for m in r["metrics"]}
check(got[("2026-09-11", "2026/27 soybean yield")] == ("bearish", "inside the range, near the top"),
      "Sept soybean yield +0.57%% is bearish, inside the range near the top (got %r)"
      % (got[("2026-09-11", "2026/27 soybean yield")],))
check(got[("2026-09-11", "2026/27 soybean ending stocks")] == ("bearish", ""),
      "no range on file: the 2% band decides (310 vs 290 is bearish) and no context is printed")
check(got[("2026-10-09", "2026/27 corn yield")] == ("bearish", "inside the range, near the top"),
      "Oct corn yield +1.9%% inside its range is bearish, not in line (got %r)"
      % (got[("2026-10-09", "2026/27 corn yield")],))
check(got[("2026-10-09", "2026/27 soybean production")][0] == "in line",
      "Oct soybean production +0.46% is inside the 1% production band")

# 2. The detector sees a planted disagreement and ignores labels not shared.
wpi = {"history": [{"date": "2026-09-11", "metric": "A", "surprise": "in line"},
                   {"date": "2026-09-11", "metric": "B", "surprise": "bullish"}]}
asd = {"reports": [{"date": "2026-09-11", "metrics": [{"label": "A", "surprise": "bearish"},
                                                      {"label": "C", "surprise": "bullish"}]}]}
check(verdict_conflicts(wpi, asd) == [("2026-09-11", "A", "in line", "bearish")],
      "a planted disagreement is reported, an unshared label is not")

# 3. The shipped files agree.
with open(os.path.join(ROOT, "data/whats-priced-in.json")) as f:
    real_wpi = json.load(f)
with open(os.path.join(ROOT, "data/analyst-scorecard.json")) as f:
    real_asd = json.load(f)
conf = verdict_conflicts(real_wpi, real_asd)
for c in conf:
    print("        %s %s: whats-priced-in %r vs scorecard %r" % c)
shared = {(r["date"], m["label"]) for r in real_asd.get("reports", []) for m in r.get("metrics", [])} & \
         {(h["date"], h["metric"]) for h in real_wpi.get("history", [])}
check(not conf, "data/whats-priced-in.json and data/analyst-scorecard.json agree on all %d shared rows" % len(shared))
# A comparison over nothing passes. 21 rows are shared today (June to October).
check(len(shared) >= 21, "the comparison saw %d shared rows, at least 21" % len(shared))

print()
print("wpi verdicts: " + ("all passed" if not fails else "%d FAILED" % len(fails)))
sys.exit(1 if fails else 0)
