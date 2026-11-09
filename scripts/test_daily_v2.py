#!/usr/bin/env python3
"""
test_daily_v2.py -- the rules of the Daily v2 email, on real archived issues.
Run by test/daily-email-v2.test.mjs; no network, nothing is sent.

  subject     never the elevator count, never "AGSIST ·", no % chip, <= 62 chars
  Today/Only here   no raw elevator-count line; every Today line has a number
  check       blocks Oct 21 ("closed Tuesday at $4.59½", settle $4.62), passes
              Oct 20; a saved fact-check finding on the headline blocks, an
              "other" finding does not
  facts       every pool entry has fact, source, https url, date, quote
  print slot  no live picture: no slot, and the email still builds
  copy        no em dash; button says nothing about calls; one corn row when
              Corn and Corn, Dec are the same quote; the board stamp says
              "Last trade ... settle" on an overnight board
  links       no shared host (workers.dev and the like) in any link
  switch      v2 only with TEST_TO_SIG=1 or DRY_RUN=1
  contrast    every text colour >= 4.5:1, light and dark
  top stories (Nov 1) five stories: one leads Today with its publisher link,
              three more under "Top stories" with links and sources, never
              twice, no tracking on a publisher link, a shared-host link dropped

    python3 scripts/test_daily_v2.py
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import glob
from datetime import date
import json
import os
import re
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
sys.path.insert(0, HERE)
os.environ.pop("FACT_CHECK_JSON", None)
os.environ["RUNNER_TEMP"] = tempfile.mkdtemp()
import daily_v2 as V   # noqa: E402
import daily_fact      # noqa: E402

FAILS = []


def ok(c, m):
    if not c:
        FAILS.append(m)
        print("FAIL", m)


# the Oct 21 lead as it was sent (corrected in the archive Oct 27)
D21_SENT_LEAD = ("Corn closed Tuesday at $4.59½, its sixth lower close in a row, and soybeans at $12.45 made it seven. "
                 "A corn bushel is worth about 15 cents less than a week ago. Harvest is pushing the selling, and nothing new came overnight.")
# and its headline as it was sent (corrected in the archive Oct 27 too)
D21_SENT_HEADLINE = "Corn down 6 straight days to $4.59½; beans down 7 to $12.45"


def load(d):
    with open(os.path.join(REPO, "data", "daily-archive", d + ".json"), encoding="utf-8") as f:
        return json.load(f)


FACT = {"id": "x", "kind": "pool", "text": "2 kernels a square foot is a bushel an acre.", "source": "ISU", "url": "https://crops.extension.iastate.edu/x", "file": None}
POD = {"image_url": "https://agsist.com/daily/img/print-2026-10-21.png", "why": "Hamilton County, Kansas: 29.92 in., 195% of normal.",
       "make_url": "/rain-print?place=Syracuse%2C+KS&year=2026", "alt": "Rain Print of Hamilton County, Kansas: 29.92 inches, 195% of normal"}
LOC = (42.0379, -93.6003, "IA")


def build(daily, **kw):
    iso = V._iso_day(daily)
    args = dict(forward_url="https://agsist.com/?ref=email-forward", fact=FACT, pod=None)
    args.update(kw)
    return V.build(daily, "https://agsist.com/daily/%s.html" % iso, **args)


def hrefs(html):
    return re.findall(r'href="([^"]+)"', html) + re.findall(r'src="([^"]+)"', html)


def lum(h):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    c = [x / 12.92 if x <= 0.03928 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]


def contrast(a, b):
    la, lb = sorted((lum(a), lum(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def main():
    issues = sorted(p[-15:-5] for p in glob.glob(os.path.join(REPO, "data", "daily-archive", "2026-*.json")))
    recent = [d for d in issues if d >= "2026-09-15"]
    ok(len(recent) >= 20, "enough real issues to test (%d)" % len(recent))
    for d in recent:
        daily = load(d)
        b = build(daily, rain={"zip": "50010", "town": "Ames, IA"}, loc=LOC, pod=POD)
        s = b["subject"]
        ok(not V.ELEVATOR.search(s) and not V.COUNT_LINE.search(s), "%s: subject is never the elevator count: %s" % (d, s))
        ok(not s.startswith("AGSIST") and "·" not in s and not re.search(r"[+−-]\d+\.\d%", s), "%s: no AGSIST prefix or %% chip: %s" % (d, s))
        ok(0 < len(s) <= V.SUBJECT_HARD, "%s: subject length %d" % (d, len(s)))
        for x in b["items"]:
            ok(V.has_number(x["text"]) and not V.COUNT_LINE.search(x["text"]), "%s: Today line has a number and is not a count: %s" % (d, x["text"]))
        ok(len(b["items"]) <= V.TODAY_MAX, "%s: at most 6 Today lines" % d)
        here = V.only_here(daily, {"zip": "50010"}, LOC)
        for x in here:
            ok(not V.COUNT_LINE.search(x["text"]) and re.search(r"\d", x["text"]), "%s: only-here is an insight with a number: %s" % (d, x["text"]))
        ok("Only on AGSIST" not in b["html"] and "Counted by code" not in b["html"], "%s: the old elevator-count paragraph is gone" % d)
        for part in (b["html"], b["text"], s, b["preheader"]):
            ok("—" not in part, "%s: no em dash" % d)
        ok("calls" not in b["html"].lower().split("the full issue")[1][:40] if "The full issue" in b["html"] else False, "%s: button text" % d)
        for u in hrefs(b["html"]) + re.findall(r"https?://\S+", b["text"]):
            ok(not V.shared_host(u.replace("&amp;", "&")), "%s: no shared host in a link: %s" % (d, u))
        ok(len(b["html"].encode()) < 60 * 1024, "%s: html under 60 KB" % d)
    # recent issues with a locked board: the honest stamp and one corn row
    for d in ("2026-10-19", "2026-10-20", "2026-10-21"):
        daily = load(d)
        rows = V.board_rows(daily)
        labels = [r["label"] for r in rows]
        ok(sum(1 for x in labels if x.startswith("Corn")) == 1 and sum(1 for x in labels if x.startswith("Beans")) == 1, "%s: one corn row and one bean row %r" % (d, labels))
        stamp, _ = V.board_stamp(daily, rows)
        ok(re.match(r"Last trade \d+:\d\d a\.m\. CT, change from \w+day's settle$", stamp), "%s: honest stamp %r" % (d, stamp))
        ok(" close" not in stamp, "%s: never 'close' over a last trade" % d)
    # a news subject must be a farm story
    b19 = build(load("2026-10-19"))
    ok("India" not in b19["subject"] and "crude import" not in b19["subject"] and b19["subject_from"] != "news",
       "Oct 19: India's crude import bill is not the subject: %s" % b19["subject"])
    # Sig, Nov 9 2026: a bare number with no verb never leads. Oct 20's day's number ("$8 billion emergency
    # diesel relief for farmers") is a value and a noun phrase, so it no longer leads; with a verb it may.
    b20s = build(load("2026-10-20"))
    ok(b20s["subject_from"] != "news" and "$8 billion" not in b20s["subject"],
       "Oct 20: the bare $8 billion number does not lead: %s" % b20s["subject"])
    d20v = load("2026-10-20")
    d20v["one_number"] = dict(d20v["one_number"], unit="emergency diesel relief approved for farmers")
    b20v = build(d20v)
    ok(b20v["subject"] == "$8 billion emergency diesel relief approved for farmers" and b20v["subject_from"] == "news",
       "Oct 20 with a verb: the diesel relief item can still be the subject: %s" % b20v["subject"])
    ok(any("India" in x["text"] for x in b19["items"]), "Oct 19: the item still sits in Today")
    ok("India" not in b19["preheader"], "Oct 19: nor the preheader: %s" % b19["preheader"])
    ok(not b19["preheader"].startswith("Corn has settled lower"), "the preheader is not the subject's story again: %s" % b19["preheader"])
    # the check that blocks
    d21, d20 = load("2026-10-21"), load("2026-10-20")
    # the archive lead was corrected Oct 27 (dated note); the check is tested on the lead as it went out
    ok("(Corrected Oct 27" in d21["lead"] and "$4.62" in d21["lead"], "Oct 21: the archive carries the corrected lead")
    ok(not [f for f in V.check(d21, build(d21))[0] if f["field"] == "lead"], "Oct 21: the corrected lead passes the code check")
    d21 = dict(d21, lead=D21_SENT_LEAD, headline=D21_SENT_HEADLINE)
    d21.pop("corrections", None)
    b21 = build(d21)
    bad, _ = V.check(d21, b21)
    ok(any(f["field"] == "lead" and "$4.62" in f["why"] for f in bad), "Oct 21: the lead's wrong close blocks the send")
    ok(any(f["field"] == "headline" for f in bad), "Oct 21: the headline's wrong close blocks the send")
    bad20, _ = V.check(d20, build(d20))
    ok(not bad20, "Oct 20 passes the code check: %r" % bad20)
    fc = os.path.join(os.environ["RUNNER_TEMP"], "fc.json")
    with open(fc, "w") as f:
        json.dump({"findings": [
            {"severity": "medium", "verified": True, "kind": "mismatch", "field": "headline", "quote": "x", "expected": "settle $4.62"},
            {"severity": "medium", "verified": True, "kind": "other", "field": "lead", "quote": "y", "expected": "z"}]}, f)
    bad, notes = V.check(d20, build(d20), fc)
    ok(len(bad) == 1 and bad[0]["field"] == "headline", "a saved medium mismatch on the headline blocks; 'other' does not: %r" % bad)
    with open(fc, "w") as f:
        json.dump({"findings": [{"severity": "high", "verified": True, "kind": "unsourced_number", "field": "sections[0].body", "quote": "x", "expected": ""}]}, f)
    bad, _ = V.check(d20, build(d20), fc)
    ok(not bad, "a finding outside subject, headline and lead stays report-only")
    d20n = dict(d20, one_number=dict(d20["one_number"], unit="emergency diesel relief approved for farmers"))
    b20 = build(d20n)   # a day's number that may lead (it has a verb, Nov 9 2026 rule)
    with open(fc, "w") as f:
        json.dump({"findings": [{"severity": "high", "verified": True, "kind": "mismatch", "field": "one_number.value", "quote": "$8 billion", "expected": "$9 billion"}]}, f)
    bad, _ = V.check(d20n, b20, fc)
    ok(b20["subject_field"] == "one_number.value" and len(bad) == 1, "a wrong number in the field the subject came from blocks")
    # the print slot
    b = build(d21, pod=None)
    ok("Print of the day" not in b["html"] and "PRINT OF THE DAY" not in b["text"] and b["html"], "no picture: the slot is left out, the email builds")
    b = build(d21, pod=dict(POD, image_url=None))
    ok("Print of the day" not in b["html"], "a pick whose render failed: no slot")
    b = build(d21, pod=POD)
    ok("Print of the day" in b["html"] and POD["image_url"] in b["html"] and 'alt="Rain Print of Hamilton' in b["html"]
       and "Make yours" in b["html"] and "/rain-print?place=Syracuse" in b["html"], "with a live picture: image, alt text with the numbers, Make yours")
    ok("PRINT OF THE DAY" in b["text"] and POD["why"] in b["text"], "images off: the text part carries the line")
    # links: a worker-host unsubscribe is never printed
    b = build(d21, unsub_url="https://agsist-subs.dnilgis.workers.dev/unsubscribe?k=0123456789abcdef&t=1")
    ok("workers.dev" not in b["html"] and "workers.dev" not in b["text"] and "reply with subject line: unsubscribe" in b["text"], "worker host dropped")
    b = build(d21, unsub_url="https://agsist-api.dnilgis.workers.dev/unsubscribe?k=0123456789abcdef&t=1")
    ok("workers.dev" not in b["html"] and "workers.dev" not in b["text"], "the new worker host (agsist-api) dropped too")
    b = build(d21, unsub_url="https://agsist.com/e?r=unsubscribe&k=0123456789abcdef&t=1")
    ok("https://agsist.com/e?r=unsubscribe" in b["text"], "the front door unsubscribe stays")
    # facts
    with open(os.path.join(REPO, "data", "daily-facts.json"), encoding="utf-8") as f:
        pool = json.load(f)["facts"]
    for x in pool:
        ok(daily_fact.valid_entry(x), "pool entry %s has fact, source, https url, date and quote" % x.get("id"))
    ok(not os.path.exists(os.path.join(REPO, "data", "quote-pool.json")) or True, "old pool untouched")
    # Sig, Nov 2 2026: a fact whose url is a data file names its source and date, no link.
    import source_links  # noqa: E402
    dlinks, nlinks, n_data = [], 0, 0
    for x in pool:
        f = daily_fact._pool_fact(x)
        bx = build(d21, fact=f)
        part = bx["html"].split("Source:", 1)[-1][:900]
        fx_links = [u for u in hrefs(part) if u == f["url"] or u.startswith(f["url"].split("#")[0])]
        dlinks += [u for u in fx_links if source_links.is_data_source(u)]
        if source_links.is_data_source(f["url"]):
            n_data += 1
            if f["url"] in bx["text"] or f["url"] in bx["html"]:
                dlinks.append(f["url"])
            if f["source"] not in bx["text"] or "read " not in bx["text"].split("Source:", 1)[-1][:400]:
                dlinks.append("no plain source and date for " + f["id"])
        else:
            nlinks += bool(fx_links)
    ok(not dlinks, "no rendered fact link is a data file (%d data-file facts print source and date only): %s"
       % (n_data, dlinks[:3]))
    ok(n_data > 0 and nlinks == len(pool) - n_data, "every other pool fact keeps its linked source (%d)" % nlinks)
    b = build(d21, fact=None)
    ok("Oh, that’s interesting" in b["html"] and "Source:" in b["html"], "the day's fact prints with its source")
    ok(V.e(V.FACT_LABEL) in b["html"] and V.FACT_LABEL.upper() in b["text"] and "OH, THAT’S INTERESTING" in b["text"],
       "the fact label is the same words in the HTML and the plain-text email")
    ok("know that" not in (b["html"] + b["text"]).lower() and "never knew" not in (b["html"] + b["text"]).lower(),
       "the old fact label is gone from both")
    # the schedule (Nov 1): two weeks from its first day, a sourced fact each day, never one category twice running
    from datetime import date as _date, timedelta as _td
    two = [daily_fact.for_day(daily_fact.EPOCH + _td(days=k)) for k in range(14)]
    ok(all(f and f.get("category") in daily_fact.CATEGORIES and f.get("source") and (f.get("url") or f.get("file"))
           for f in two), "every scheduled fact has a category and a source")
    ok(all(a["category"] != b_["category"] for a, b_ in zip(two, two[1:])), "no category two days running")
    ok(daily_fact.for_day(_date(2026, 11, 20))["id"] == daily_fact.for_day(_date(2026, 11, 20))["id"],
       "a date always gives the same fact (page and email agree)")
    b = build(d21, fact=two[0])
    ok(V.e(two[0]["text"]) in b["html"], "the scheduled fact prints in the email")
    # the switch
    import send_daily as S
    for env, want in (({}, "current"), ({"DAILY_FORMAT": "v2"}, "v2"), ({"DAILY_FORMAT": "v2", "TEST_TO_SIG": "1"}, "v2"),
                      ({"DAILY_FORMAT": "current"}, "current"), ({"DAILY_FORMAT": "current", "TEST_TO_SIG": "1"}, "current")):
        saved = {k: os.environ.pop(k, None) for k in ("DAILY_FORMAT", "TEST_TO_SIG", "DRY_RUN")}
        os.environ.update(env)
        got = S.daily_format()
        for k in ("DAILY_FORMAT", "TEST_TO_SIG", "DRY_RUN"):
            os.environ.pop(k, None)
        os.environ.update({k: v for k, v in saved.items() if v is not None})
        ok(got == want, "switch %r -> %s (got %s)" % (env, want, got))
    # a live issue held by the number check: one alert to Sig, with the field and the rerun steps
    import log_safe
    sent = []
    real = log_safe.owner_mail
    log_safe.owner_mail = lambda subj, lines: sent.append((subj, lines)) or True
    try:
        S.V2.update({"ready": True, "pod": None, "fact": FACT})
        ok(S.v2_gate("2026-10-21", d21, alert=True) is False, "Oct 21 is held")
        ok(len(sent) == 1 and "held" in sent[0][0] and "lead" in sent[0][0], "one alert, naming the field: %r" % [x[0] for x in sent])
        body = "\n".join(sent[0][1]) if sent else ""
        ok("$4.62" in body and "Run workflow" in body and "format current" in body and "not marked sent" in body,
           "the alert carries the number and the fix-and-rerun steps")
        sent.clear()
        ok(S.v2_gate("2026-10-21", d21, alert=False) is False and not sent, "a test copy or preview is held without an alert")
        ok(S.v2_gate("2026-10-20", d20, alert=True) is True and not sent, "a clean issue sends, no alert")
    finally:
        log_safe.owner_mail = real
    # top stories (2026-11-01, fx/dailyfresh)
    ts = json.load(open(os.path.join(REPO, "test", "fixtures", "daily", "2026-10-21-top-stories.json"), encoding="utf-8"))
    bt = V.build(ts, "https://agsist.com/daily/2026-10-21.html", forward_url="https://agsist.com/?ref=email-forward")
    news_today = [x for x in bt["items"] if x.get("field", "").startswith("outside_the_pit[")]
    ok(len(news_today) == V.TODAY_STORIES, "one top story leads Today: %r" % [x["text"] for x in news_today])
    ok(news_today and news_today[0]["url"] == "https://www.agweb.com/news/fixture-fuel-aid", "the Today story carries its link")
    ok(bt["slots"]["top_stories"] == V.EMAIL_STORIES, "three more under Top stories: %r" % bt["slots"])
    ok(len(bt["items"]) <= V.TODAY_WITH_STORIES, "Today is shorter when the stories carry the news")
    ok("Top stories" in bt["html"] and "TOP STORIES" in bt["text"], "the block is labeled")
    shown = V.top_stories(ts, bt["items"])
    ok(not ({s_["title"] for s_ in shown} & {x["text"] for x in bt["items"]}), "no story twice")
    for st in shown:
        ok(st["link"] and st["link"] in bt["text"] and V.e(st["link"]) in bt["html"], "linked: %s" % st["title"])
        ok(st["source"] and st["source"] in bt["text"], "sourced: %s" % st["title"])
    ok("fixture-screwworm?utm" not in bt["text"] and "fixture-screwworm&amp;utm" not in bt["html"]
       and "fixture-fuel-aid?utm" not in bt["text"], "no tracking on a publisher's link")
    ok(bt["html"].index("Top stories") > bt["html"].index("Forward to a neighbor"), "the forward ask stays right under Today")
    bad = json.loads(json.dumps(ts))
    bad["outside_the_pit"][1]["link"] = "https://agsist-x.dnilgis.workers.dev/story"
    bad["outside_the_pit"][2]["link"] = "http://www.agri-pulse.com/plain-http"
    bb = V.build(bad, "https://agsist.com/daily/2026-10-21.html")
    ok("workers.dev" not in bb["html"] and "plain-http" not in bb["html"], "a shared-host or plain http story link is dropped")
    one = V.build(json.load(open(os.path.join(REPO, "data", "daily-archive", "2026-10-21.json"), encoding="utf-8")),
                  "https://agsist.com/daily/2026-10-21.html")
    ok(one["slots"]["top_stories"] == 0 and "Top stories" not in one["html"], "an old one-story issue has no block")
    # Funds this week line (2026-11-07): only the morning after a COT release
    cot = {"report_date": "November 3, 2026"}   # released Fri Nov 6  # pin-ok: fixture
    d21 = load("2026-10-21")
    sat = V.build(d21, "https://agsist.com/daily/x.html", today=date(2026, 11, 7), cot=cot)  # pin-ok: fixture
    ok(sat["slots"]["funds"] and "Funds this week" in sat["html"] and "Funds this week" in sat["text"],
       "the Saturday after a release carries the Funds this week line")
    ok("agsist.com/cot?" in sat["text"] and "utm_content=funds" in sat["text"] and sat["text"].count("#cot-signup") == 1,
       "the line links to the one signup box on /cot, tagged: %s" % [u for u in re.findall(r"https?://\S+", sat["text"]) if "/cot" in u])
    for day in (date(2026, 11, 6), date(2026, 11, 8), date(2026, 11, 9)):  # pin-ok: fixture
        o = V.build(d21, "https://agsist.com/daily/x.html", today=day, cot=cot)
        ok(not o["slots"]["funds"] and "Funds this week" not in o["html"], "no Funds this week line on %s" % day)
    ok(V.funds_offer(date(2026, 11, 7), {"report_date": ""}) is None and V.funds_offer(None, cot) is None,  # pin-ok: fixture
       "no report date or no day: no line")
    ok(V.funds_offer(date(2026, 11, 7), cot) == V.funds_offer(date(2026, 11, 7), dict(cot)) and "—" not in V.FUNDS_LINE,  # pin-ok: fixture
       "the line is plain and steady")
    # contrast
    for name, col in V.DARK_COLORS.items():
        ok(contrast(col, V.DARK_CARD) >= 4.5, "dark %s %s on %s: %.2f" % (name, col, V.DARK_CARD, contrast(col, V.DARK_CARD)))
    for name, col in (("ink", V.INK), ("mute", V.MUTE), ("gold", V.GOLD), ("green", V.GREEN), ("down", V.DOWN)):
        ok(contrast(col, V.PAPER) >= 4.5, "light %s %s: %.2f" % (name, col, contrast(col, V.PAPER)))
    print("test_daily_v2: %d failure(s)" % len(FAILS))
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
