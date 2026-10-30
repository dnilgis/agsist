#!/usr/bin/env python3
"""YOUR COUNTY THIS WEEK FOR READERS ALREADY ON THE DAILY, AND ITS HOLDOUT.

    python3 scripts/test_cw_optin.py

Made-up readers only, nothing sent, counts only printed.

  * the footer link (send_daily.county_ask_url): an agsist.com/e?a=daily-cw
    link with the reader's link id and t = hmac16(id + "|cw"), never the
    address; none without the secret, the worker URL or a link id; every
    reader on a JSON list gets one, worded to turn it on, or to stop it when
    it is on; an older list gets none;
  * the holdout (send_daily.cw_holdout): a hash of the address, the same in
    every run and every process, case and spaces aside; about 1 in 5 of a
    large made-up list; held out only on the first 8 Thursdays (Oct 29 to
    Dec 17 2026); the arm tag runs to 14 days after the last one;
  * load_county_week withholds the block from the holdout arm on those
    Thursdays, counts them, and gives it to them from Dec 24;
  * daily_v2: the footer link, untagged; the arm tag on every agsist.com link
    and on no signed link; no tag without an arm; check_message passes.
Run by test/cw-optin.test.mjs.
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import json
import os
import re
import subprocess
import sys
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
os.environ.pop("COUNTY_WEEK", None)

import send_daily as SD   # noqa: E402
import daily_v2           # noqa: E402
import email_links        # noqa: E402

fails, passes = [], 0


def check(cond, msg):
    global passes
    if cond:
        passes += 1
    else:
        fails.append(msg)
        print("FAIL " + msg)


SEC, LID, LID2 = "sec", "abcdefghjkmnpqrs", "0123456789abcdef"
os.environ["LIST_URL"], os.environ["UNSUB_SECRET"] = "https://subs.example.test", SEC

# ── the signed link ──
SD.LINK_IDS.clear()
SD.LINK_IDS.update({"made-up-a@example.com": LID, "made-up-b@example.com": LID2})
u = SD.county_ask_url("Made-Up-A@example.com ")
check(u == "https://agsist.com/e?a=daily-cw&k=%s&t=%s" % (LID, email_links.token(SEC, LID + "|cw")), "the link: front door, link id, t over id + |cw: %s" % u)
check("@" not in u and "%40" not in u and "example" not in u, "no address in the link")
check(email_links.as_worker(u, os.environ["LIST_URL"]) == os.environ["LIST_URL"] + "/fd/daily-cw?k=%s&t=%s" % (LID, email_links.token(SEC, LID + "|cw")),
      "the page asks the worker's /fd/daily-cw with the same k and t")
check(email_links.token(SEC, LID + "|cw") != email_links.token(SEC, LID + "|de"), "not the daily-elev token")
check(SD.county_ask_url("made-up-nolid@example.com") is None, "no link id: no link")
os.environ["UNSUB_SECRET"] = ""
check(SD.county_ask_url("made-up-a@example.com") is None, "no secret: no link")
os.environ["UNSUB_SECRET"] = SEC
os.environ["LIST_URL"] = ""
check(SD.county_ask_url("made-up-a@example.com") is None, "no worker: no link")
os.environ["LIST_URL"] = "https://subs.example.test"

SUBS = [{"email": "made-up-a@example.com", "zip": "54728"}, {"email": "made-up-b@example.com", "zip": None, "cw": True},
        {"email": "made-up-nolid@example.com", "zip": "54728"}]
ask = SD.load_county_ask(SUBS, "json")
check(sorted(ask) == ["made-up-a@example.com", "made-up-b@example.com"], "every reader with a link id gets the link")
check(ask["made-up-a@example.com"]["on"] is False and ask["made-up-b@example.com"]["on"] is True, "on only for the reader who ticked it")
check(SD.load_county_ask(SUBS, "plain") == {}, "an older list (no ticks known): no link")

# ── the holdout: deterministic, stable, about 1 in 5 ──
MADE = ["made-up-%d@example.com" % i for i in range(20000)]
arms = [SD.cw_holdout(e) for e in MADE]
share = sum(arms) / len(arms)
check(0.19 <= share <= 0.21, "about 1 in 5 held out (%.3f of 20,000 made-up addresses)" % share)
check(arms == [SD.cw_holdout(e) for e in MADE], "the same answer every time")
check(all(SD.cw_holdout(e) == SD.cw_holdout("  " + e.upper() + " ") for e in MADE[:500]), "case and spaces do not move a reader")
# another process, another hash seed: the same arms (nothing is stored between runs)
code = ("import sys; sys.path.insert(0, %r); import send_daily as S; "
        "print(''.join('1' if S.cw_holdout('made-up-%%d@example.com' %% i) else '0' for i in range(2000)))" % str(ROOT / "scripts"))
other = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, timeout=60,
                       env=dict(os.environ, PYTHONHASHSEED="12345")).stdout.strip()
check(other == "".join("1" if a else "0" for a in arms[:2000]), "the same arms in a fresh process")
# pinned: the salt or the share cannot drift unnoticed (a moved arm would mix the two groups mid-test)
PIN = "".join("1" if a else "0" for a in arms[:40])
check(PIN == "0000100000000100010010000100000000100000", "the first 40 made-up arms are pinned: %s" % PIN)
check(SD.CW_HOLDOUT_PCT == 20 and SD.CW_HOLDOUT_THURSDAYS == 8 and SD.CW_HOLDOUT_FIRST == date(2026, 10, 29), "20%, 8 Thursdays from Oct 29")
src = (ROOT / "scripts" / "send_daily.py").read_text()
check(not re.search(r"print\([^\n]*cw_holdout\(", src), "no print of a reader's arm")

# the days
check(not SD.cw_holdout_on("2026-10-22") and SD.cw_holdout_on("2026-10-29") and SD.cw_holdout_on("2026-12-17"), "held out Oct 29 to Dec 17")
check(not SD.cw_holdout_on("2026-12-24") and not SD.cw_holdout_on("2027-01-07") and not SD.cw_holdout_on("x"), "not from Dec 24, nor on a bad day")
thu = [SD.CW_HOLDOUT_FIRST + timedelta(weeks=i) for i in range(12)]
check(sum(1 for d in thu if SD.cw_holdout_on(d.isoformat())) == 8, "exactly 8 Thursdays")
H = next(e for e in MADE if SD.cw_holdout(e))
B = next(e for e in MADE if not SD.cw_holdout(e))
check(SD.cw_group(H, "2026-10-29") == "cw-hold" and SD.cw_group(B, "2026-10-29") == "cw-block", "the arm tags")
check(SD.cw_group(H, "2026-12-31") == "cw-hold" and SD.cw_group(H, "2027-01-01") is None and SD.cw_group(H, "2026-10-28") is None,
      "tagged from Oct 29 to 14 days after Dec 17")


# ── load_county_week holds the block back from the holdout arm ──
class FakeBids:
    def zip_coord(self, z):
        return (45.31, -91.65) if z == "54728" else None

    def zip_town(self, z):
        return "Chetek, WI" if z == "54728" else None

    def index(self):
        return {}


BLOCK = {"rows": [{"kind": "changed", "label": "Drought", "text": "Worse this week.", "date": "Oct 27", "src": "U.S. Drought Monitor"}]}


def runner(inp):
    return {p["k"]: {"status": "ok", "county": "Barron County", "st": "WI", "url": "/farmland-atlas/wisconsin/barron-county", "block": BLOCK}
            for p in inp["places"]}


R = [{"email": H, "zip": "54728", "cw": True}, {"email": B, "zip": "54728", "cw": True}, {"email": "made-up-x@example.com", "zip": "54728"}]
out, c = SD.load_county_week(R, "json", "2026-10-29", FakeBids(), runner)
check(sorted(out) == [B], "Oct 29: the block arm gets it, the holdout does not")
check(c["block"] == 1 and c["held_out"] == 1 and c["arm_hold"] == 1 and c["ticked"] == 2, "counts: %s" % c)
line = SD.cw_arm_line(c, "2026-10-29")
check(line == "your county this week arms: 2 ticked, 1 in the block arm, 1 in the holdout arm (20%, holding out today); "
              "1 got a block, 1 held out who would have had one", line)
check("@" not in line and "54728" not in line, "the log line: counts only")
out, c = SD.load_county_week(R, "json", "2026-12-24", FakeBids(), runner)
check(sorted(out) == sorted([H, B]) and c["held_out"] == 0, "Dec 24: everyone who ticked it")
check("not holding out today" in SD.cw_arm_line(c, "2026-12-24"), "the log says so")
import morning_report as MR   # noqa: E402
check(MR.CW_ARM_RE.search(SD.cw_arm_line(c, "2026-12-24")) and MR.CW_ARM_RE.search(line), "the morning report reads the line send_daily prints")

# ── the email ──
daily = json.loads((ROOT / "data" / "daily-archive" / sorted(p.name for p in (ROOT / "data" / "daily-archive").glob("2026-*.json"))[-1]).read_text())
unsub = email_links.signed("x", "unsubscribe", LID, SEC)
kw = dict(forward_url="https://agsist.com/?ref=email-forward", fact={"text": "x", "source": "y"}, unsub_url=unsub)
plain = daily_v2.build(daily, "https://agsist.com/daily/x.html", **kw)
on = daily_v2.build(daily, "https://agsist.com/daily/x.html", county_ask=ask["made-up-a@example.com"], **kw)
off = daily_v2.build(daily, "https://agsist.com/daily/x.html", county_ask=ask["made-up-b@example.com"], **kw)
au = ask["made-up-a@example.com"]["url"]
check(au.replace("&", "&amp;") in on["html"] and "Add what changed in your county on Thursdays</a>" in on["html"], "the footer link, html")
check("Add what changed in your county on Thursdays: " + au in on["text"], "the footer link, text")
check("Stop the Thursday county lines</a>" in off["html"] and "Add what changed" not in off["html"], "a reader who has it on: the way to stop it")
check("daily-cw" not in plain["html"] and "daily-cw" not in plain["text"], "no link given: none drawn")
check(daily_v2.county_ask_link({"url": "https://evil.example/e?a=daily-cw&k=x"}) is None and daily_v2.county_ask_link({"url": ""}) is None,
      "only an agsist.com front-door daily-cw link is drawn")
check(not re.search(r"daily-cw[^\"\s]*utm_", on["html"] + on["text"]), "the signed link carries no utm")
hold = daily_v2.build(daily, "https://agsist.com/daily/x.html", county_ask=ask["made-up-b@example.com"], group="cw-hold", **kw)
hl = [x for x in email_links.hrefs(hold["html"]) if "agsist.com" in x]
tagged = [x for x in hl if "utm_medium=email" in x]
check(tagged and all("utm_term=cw-hold" in x for x in tagged), "every tagged agsist.com link carries the arm (%d links)" % len(tagged))
check(all("utm_term" not in x for x in hl if x.startswith(email_links.FRONT)), "no signed front-door link carries it")
check(hold["text"].count("utm_term=cw-hold") == hold["text"].count("utm_medium=email") > 0, "the text body too")
check("utm_term" not in on["html"] and "utm_term" not in on["text"], "no arm: no tag")
check(daily_v2.tag_group("utm_medium=email", "cw-x", False) == "utm_medium=email", "only the two arm names")
from email.message import EmailMessage   # noqa: E402
m = EmailMessage()
m["Subject"], m["To"] = "x", "made-up-b@example.com"
m.set_content(hold["text"])
m.add_alternative(hold["html"], subtype="html")
try:
    email_links.check_message(m)
    passes += 1
except email_links.LinkError as ex:
    check(False, "check_message refused the message: %s" % ex)

print("cw optin: %d passed, %d failed" % (passes, len(fails)))
sys.exit(1 if fails else 0)
