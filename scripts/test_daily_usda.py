#!/usr/bin/env python3
"""
test_daily_usda.py -- the USDA market lines handed to the Daily's writer
(scripts/daily_usda.py). Run by test/daily-usda.test.mjs. No network, no model,
nothing is sent.

The files are the real ones of the Nov 2 2026 reports (test/fixtures/daily-usda/,
see its README), so a data commit cannot move the numbers under the test. Cases:
  Tue Nov 3, 6 a.m. CT   cash hogs + cutout, slaughter, ethanol, Gulf on (Monday's
                         reports); diesel and fertilizer WITHHELD (Oct 30 report,
                         already the Saturday issue's)
  Mon Nov 2              everything dated Nov 2 withheld: not out at the send (look-ahead)
  Wed Nov 4              everything stale (a missed fetch is never today's)
  Sat Oct 31             diesel and fertilizer on (the issue after the Oct 30 reports)
  Sun Nov 1              diesel and fertilizer withheld: never a daily repeat
  missing files, unreadable files, stale flags, a cutout a day old beside fresh
  hogs, old kill dates, two futures months, a daily_line that disagrees with its file
  the prompt: each block its source, its rule, no link, no em dash; the generator
  puts it in the message the fact check reads (save_briefing_inputs); the 450-word
  ceiling and the repeat cutter still stand

    python3 scripts/test_daily_usda.py
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import json
import os
import re
import shutil
import sys
import tempfile
from datetime import date, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
sys.path.insert(0, HERE)
os.environ.pop("FACT_CHECK_JSON", None)
os.environ["RUNNER_TEMP"] = tempfile.mkdtemp()
import daily_usda as U  # noqa: E402

FIX = os.path.join(REPO, "test", "fixtures", "daily-usda")
FAILS = []


def ok(c, m):
    if not c:
        FAILS.append(m)
        print("FAIL", m)


def utc(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def run(day, now=None, repo=FIX):
    return U.build(date.fromisoformat(day), utc(now or day + "T11:00:00Z"), repo)


def joined(b):
    return "\n".join(b.get("lines") or [])


def fixture_copy(name=None, fn=None, remove=None, raw=None):
    d = tempfile.mkdtemp()
    shutil.copytree(FIX, d, dirs_exist_ok=True)
    if remove:
        os.remove(os.path.join(d, "data", remove))
    if name and raw is not None:
        open(os.path.join(d, "data", name), "w").write(raw)
    elif name:
        p = os.path.join(d, "data", name)
        x = json.load(open(p))
        fn(x)
        json.dump(x, open(p, "w"))
    return d


def load(name):
    return json.load(open(os.path.join(FIX, "data", name)))


def main():
    hog, sl, eth = load("hog-cash.json"), load("slaughter.json"), load("ethanol-bids.json")
    grain, pc = load("state-grain-ams.json"), load("production-costs.json")

    # ── Tuesday Nov 3, the morning send: Monday's reports
    b = run("2026-11-03")
    h = joined(b["hogs"])
    ok(h == hog["daily_line"].replace(" on Nov 2.", " on Nov 2, up $2.18 from the day before."),
       "Nov 3: the hog line is the file's own line plus the cutout change: %r" % h)
    ok("National negotiated cash hogs $64.49/cwt carcass base on 8,718 head (killed Oct 30-31)" in h,
       "Nov 3: CASH hogs, negotiated base, head and kill dates (LM_HG201 Nov 2): " + h)
    ok("pork cutout $72.28/cwt on Nov 2, up $2.18 from the day before" in h, "Nov 3: pork cutout (LM_PK602 Nov 2)")
    ok("futures" not in h.lower(), "Nov 3: the cash hog line never names futures")
    ok("LM_HG201" in b["hogs"]["source"] and "LM_PK602" in b["hogs"]["source"] and "Nov 2" in b["hogs"]["source"],
       "Nov 3: hog source names both USDA reports and the date: " + b["hogs"]["source"])
    ok(joined(b["slaughter"]) == sl["daily_line"], "Nov 3: slaughter is the file's daily_line")
    for n in ("104,000", "106,000", "110,771", "492,000", "484,000", "496,398"):
        ok(n in joined(b["slaughter"]), "Nov 3: slaughter carries %s" % n)
    ok(joined(b["ethanol"]) == eth["daily_line"] and "against December futures" in joined(b["ethanol"]),
       "Nov 3: ethanol range names the December contract: " + joined(b["ethanol"]))
    ok("$3.67 to $4.93" in joined(b["ethanol"]) and "-80 to +45 cents" in joined(b["ethanol"]), "Nov 3: ethanol bid and basis range")
    ok(joined(b["gulf"]) == grain["daily_line"] and "corn 92 to 94 over Dec; soybeans 109 to 116 over Nov" in joined(b["gulf"]),
       "Nov 3: Gulf export bids, the file's top daily_line: " + joined(b["gulf"]))
    ok("already" in b["costs"].get("withheld", "") or "issue after a new report" in b["costs"].get("withheld", ""),
       "Nov 3: diesel and fertilizer withheld (Oct 30 report is not new): %r" % b["costs"])

    # ── Monday Nov 2: the reports dated Nov 2 were not out at the morning send
    b = run("2026-11-02")
    for k in ("hogs", "slaughter", "ethanol", "gulf"):
        ok(not b[k].get("lines") and "not out when this issue was written" in b[k].get("withheld", ""),
           "Nov 2: %s dated the issue's own day is withheld (no look-ahead): %r" % (k, b[k]))

    # ── Wednesday Nov 4: Monday's reports are a day old, a missed fetch is never today's
    b = run("2026-11-04")
    ok(all(not v.get("lines") for v in b.values()), "Nov 4: every block stale, withheld: %r" % b)
    ok("not yesterday's" in b["gulf"].get("withheld", ""), "Nov 4: the reason is named")
    ok(U.prompt_block(b) == "", "Nov 4: nothing for the writer")

    # ── Saturday Oct 31: the issue after Friday's production cost reports
    pc_oct31 = fixture_copy()
    b = run("2026-10-31", repo=pc_oct31)
    c = joined(b["costs"])
    ok(b["costs"].get("lines") and b["costs"]["lines"][0] == pc["daily_line"]["text"], "Oct 31: diesel is the file's line: " + c)
    ok("Iowa $5.65 a gallon, Illinois $5.71" in c, "Oct 31: farm diesel by state")
    ok("Iowa fertilizer, dealer average: anhydrous ammonia $902.33 a ton (down $3.17 from the last report)" in c,
       "Oct 31: Iowa anhydrous from the Iowa report: " + c)
    ok("Illinois fertilizer, dealer average: anhydrous ammonia $981.11 a ton (up $33.61 from the last report), urea $770.00" in c,
       "Oct 31: Illinois anhydrous and urea")
    ok("(USDA AMS, Illinois Production Cost Report (Bi-weekly), Oct 30, 2026)" in c, "Oct 31: each region credits its report and date")
    ok("$540.00" not in c, "Oct 31: a thin price (Illinois 32% UAN, one dealer) is left out")
    ok(c.index("Iowa fertilizer") < c.index("Illinois fertilizer") < c.index("Oklahoma fertilizer"), "Oct 31: corn belt first")
    ok("Pacific Northwest fertilizer, dealer average: urea $1,094.25 a ton" in c, "Oct 31: thousands keep their comma")
    ok(not any(v.get("lines") for k, v in b.items() if k != "costs"), "Oct 31: the Nov 2 daily reports are look-ahead on Oct 31")
    for it in [i for r in pc["reports"].values() for i in r["items"] if i["unit"] == "$/ton" and not i["thin"]]:
        if it["key"] in dict(U.FERT):
            ok("{:,.2f}".format(it["avg"]) in c, "Oct 31: every fertilizer average from the file is carried exactly: %s %s" % (it["key"], it["avg"]))
    # Sunday, Monday: never a daily repeat
    for day in ("2026-11-01", "2026-11-02"):
        ok(not run(day)["costs"].get("lines"), "%s: diesel and fertilizer are not handed again" % day)
    ok(not run("2026-10-30", "2026-10-30T11:00:00Z")["costs"].get("lines"), "Fri Oct 30 morning: the report is not out yet")

    # ── missing and broken files: nothing filled in
    empty = tempfile.mkdtemp()
    b = U.build(date(2026, 11, 3), utc("2026-11-03T11:00:00Z"), empty)
    ok(all(not v.get("lines") and "missing" in v.get("withheld", "") for v in b.values()), "missing files: every block withheld: %r" % b)
    ok(U.prompt_block(b) == "", "missing files: nothing for the writer")
    for name in U.FILES.values():
        bb = run("2026-11-03", repo=fixture_copy(name, raw="{not json"))
        key = [k for k, v in U.FILES.items() if v == name][0]
        ok(not bb[key].get("lines") and "unreadable" in bb[key].get("withheld", ""), "%s unreadable: withheld" % name)
        others = [k for k in U.ORDER if k not in (key, "costs")]
        ok(all(bb[k].get("lines") for k in others), "%s unreadable: the other blocks stay (fail soft)" % name)

    # ── stale flags and dates inside the files
    b = run("2026-11-03", repo=fixture_copy("state-grain-ams.json", lambda x: x["export"]["gulf"].update(stale=True)))
    ok(not b["gulf"].get("lines") and "stale" in b["gulf"]["withheld"], "Gulf marked stale: withheld")
    b = run("2026-11-03", repo=fixture_copy("slaughter.json", lambda x: x.update(stale=True)))
    ok(not b["slaughter"].get("lines"), "slaughter marked stale: withheld")
    b = run("2026-11-03", repo=fixture_copy("slaughter.json", lambda x: x["hogs"].update(head=491000)))
    ok(not b["slaughter"].get("lines") and "does not carry" in b["slaughter"]["withheld"],
       "a slaughter daily_line that disagrees with its own numbers: withheld")

    # hogs: a cutout a day old beside a fresh hog report keeps only the fresh part
    b = run("2026-11-03", repo=fixture_copy("hog-cash.json", lambda x: x["cutout"].update(date="2026-10-30")))
    ok(joined(b["hogs"]) == "National negotiated cash hogs $64.49/cwt carcass base on 8,718 head (killed Oct 30-31). USDA AMS.",
       "a stale cutout is left out, the cash hogs stay: %r" % b["hogs"])
    ok("pork cutout" in b["hogs"].get("left_out", "") and "LM_PK602" not in b["hogs"]["source"], "the left-out part is logged, not credited")
    b = run("2026-11-03", repo=fixture_copy("hog-cash.json", lambda x: x["hogs"].update(report_date="2026-10-30")))
    ok(joined(b["hogs"]).startswith("pork cutout $72.28/cwt on Nov 2") and "cash hogs" not in joined(b["hogs"]),
       "a stale hog report is left out, the cutout stays: %r" % b["hogs"])
    b = run("2026-11-03", repo=fixture_copy("hog-cash.json", lambda x: x["hogs"].update(slaughter_dates=["2026-10-26"])))
    ok("cash hogs" not in joined(b["hogs"]) and "kill dates" in b["hogs"].get("left_out", ""),
       "kill dates a week before the report: the hog price is left out: %r" % b["hogs"])
    b = run("2026-11-03", repo=fixture_copy("hog-cash.json", lambda x: x["hogs"].pop("negotiated")))
    ok("National cash hogs, all purchase types, $66.91/cwt carcass base (killed Oct 30-31)" in joined(b["hogs"]),
       "USDA withheld the negotiated base: the all-types price, said as such")
    b = run("2026-11-03", repo=fixture_copy("hog-cash.json", lambda x: (x.pop("hogs"), x.pop("cutout"))))
    ok(not b["hogs"].get("lines"), "an empty hog file: withheld")

    # ethanol: two futures months in one range, or a line that does not name the month
    def two_months(x):
        x["corn"]["rows"][0]["futures"] = "March"
    b = run("2026-11-03", repo=fixture_copy("ethanol-bids.json", two_months))
    ok(not b["ethanol"].get("lines") and "more than one futures month" in b["ethanol"]["withheld"], "ethanol rows on two contracts: withheld")
    b = run("2026-11-03", repo=fixture_copy("ethanol-bids.json", lambda x: x.update(daily_line=x["daily_line"].replace(" against December futures", ""))))
    ok(not b["ethanol"].get("lines"), "an ethanol line without its futures month: withheld")
    b = run("2026-11-03", repo=fixture_copy("state-grain-ams.json", lambda x: x.update(daily_line=x["daily_line"] + " https://example.org")))
    ok(not b["gulf"].get("lines"), "a line carrying a link: withheld (sources are named, never linked)")

    # ── a Monday holiday: the Tuesday after has nothing new (Friday's went out Saturday)
    b = run("2026-11-03", repo=fixture_copy("slaughter.json", lambda x: x.update(report_date="2026-10-30")))
    ok(not b["slaughter"].get("lines"), "Friday's slaughter on a Tuesday (holiday Monday): withheld")

    # ── the writer's block
    pb = U.prompt_block(run("2026-11-03"))
    for t in ("CASH HOGS AND PORK CUTOUT (USDA AMS) (source:", "DAILY SLAUGHTER", "ETHANOL PLANT CORN BIDS", "GULF EXPORT BIDS",
              "never lean hog", "name the futures month"):
        ok(t in pb, "prompt block has %r" % t)
    ok(pb.count("RULE:") == 4 and pb.count("(source:") == 4, "each block carries its source and its rule")
    ok("FARM DIESEL" not in pb, "Nov 3: no costs block")
    pc_pb = U.prompt_block(run("2026-10-31", repo=pc_oct31))
    ok(pc_pb.count("RULE:") == 1 and "FARM DIESEL AND FERTILIZER" in pc_pb, "Oct 31: the costs block alone")
    for x in (pb, pc_pb):
        ok("—" not in x and "–" not in x, "no em or en dash in the block")
        ok("http" not in x, "no link in the block (Oct 29 rule)")
        ok(not re.search(r"[\U0001F300-\U0001FAFF]", x), "no emoji in the block")
    ok("one sentence each" in pb and "never push the issue past its length" in pb, "the block keeps to the length")

    # ── the generator hands it to the writer, in the message the fact check reads
    binding_check(run("2026-11-03"), pb)

    # ── the 450-word ceiling and the repeat cutter still stand
    import briefing_cut
    ok(briefing_cut.HARD_CEILING == 450, "the 450-word hard ceiling is unchanged")
    repeat_check(joined(run("2026-11-03")["hogs"]))

    print("test_daily_usda: %d failure(s)" % len(FAILS))
    return 1 if FAILS else 0


def binding_check(blocks, pb):
    """call_claude() with the day's block in the seasonal context: the saved
    inputs (what fact_check_briefing.py reads as the writer's message) carry
    every line, and so every number, of it. The API call is stubbed to fail."""
    src = open(os.path.join(HERE, "generate_daily.py"), encoding="utf-8").read()
    i, j = src.find("import daily_usda as _du"), src.find("briefing = call_claude(price_data")
    ok(0 < src.find("import daily_more as _dm") < i < j, "generate_daily builds the USDA block after daily_more, before the first call_claude")
    ok('seasonal_ctx = seasonal_ctx + "\\n\\n" + _ub' in src[i:j], "and appends it to the seasonal context every call carries")
    ok("except Exception as _e:" in src[i:j], "fail-open: a broken block never stops the briefing")
    import generate_daily as g

    class Boom(Exception):
        pass

    class Resp:
        status_code = 401

    class FakeRequests:
        class exceptions:
            HTTPError = Boom

        @staticmethod
        def post(*a, **k):
            e = Boom("stub: no network in tests")
            e.response = Resp()
            raise e
    inp = os.path.join(tempfile.mkdtemp(), "inputs.json")
    os.environ["BRIEFING_INPUTS_PATH"] = inp
    os.environ.setdefault("ANTHROPIC_API_KEY", "test-not-a-key")
    old = g.requests
    g.requests = FakeRequests
    try:
        ms = {"is_closed": False, "reason": "open", "day_name": "Tuesday", "note": ""}
        g.call_claude({"price_block": "Corn Dec $4.50", "fetched": ""}, [], "news", "Post-harvest.\n\n" + pb,
                      {"text": "q", "attribution": "a"}, "", [], ms)
    except Boom:
        pass
    except SystemExit:
        ok(False, "call_claude exited before saving its inputs")
    finally:
        g.requests = old
        os.environ.pop("BRIEFING_INPUTS_PATH", None)
    try:
        um = json.load(open(inp))["user_message"]
    except (OSError, ValueError, KeyError):
        um = ""
    n = 0
    for name, b in blocks.items():
        for ln in b.get("lines") or []:
            n += 1
            ok(ln in um, "fact check source carries the %s line: %s" % (name, ln))
        if b.get("lines"):
            ok(b["source"] in um, "fact check source carries the %s source and date" % name)
    ok(n == 4, "four USDA lines bound on Nov 3")


def repeat_check(line):
    """daily_fresh still cuts a USDA sentence the issue before already said."""
    import daily_fresh as F
    adir = tempfile.mkdtemp()
    sent = "National negotiated cash hogs were $64.49/cwt carcass base on 8,718 head killed Oct 30-31, USDA AMS says."
    old = {"headline": "Old news", "lead": "x", "date": "2026-11-03",
           "sections": [{"title": "Hogs", "body": "- " + sent}]}
    json.dump(old, open(os.path.join(adir, "2026-11-03.json"), "w"))
    rec = F.recent(date(2026, 11, 4), adir)
    new = {"headline": "New news", "lead": "y", "date": "2026-11-04",
           "sections": [{"title": "Hogs", "body": "- " + sent + "\n- Packers bought fewer hogs."}]}
    found = F.sentence_repeats(new, rec, adir)
    ok(any(sent.rstrip(".") in x[1] or x[1] in sent for x in found), "a USDA sentence said yesterday is still found as a repeat: %r" % found)
    ok("$64.49" in line, "the hog line carries the figure the repeat test uses")


if __name__ == "__main__":
    sys.exit(main())
