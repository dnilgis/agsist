#!/usr/bin/env python3
"""
test_number_binding.py — the gate checks the prose against the number the
reader is actually shown.

WHY (2026-09-13)
  prices.json carries, per instrument, the source's own close-over-close move:
  `open` is the previous close and `pctChange` is the change against it, both
  read at fetch time. generate_daily computed those, printed them in the
  model's price block, and then threw them away, keeping only the price.

  So every consumer that wanted a change re-derived one by walking the archive
  and comparing two SNAPSHOTS taken at different times of day. That silently
  mixes in overnight drift. On the 2026-09-12 issue the walk produced:

      headline "BEANS GIVE BACK 24 CENTS"   flagged: "the board moved -18.2 cents"
      section  "WTI ... down 3.1%"          flagged: "the board says +0.94%"

  The prose was right both times. The board was wrong, and the gate was
  flagging correct sentences. Across the last 20 archived issues the walk
  produced 70 bind findings; against the locked change it produces 14, and the
  one issue with a BLOCKING bind finding has none.

  Fixing the board also turned two silent passes into failures on correct
  prose, which is why the two guards below exist. Both were findable only once
  the number was right.
"""
import datetime
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import briefing_gate as bg
import market_board as mb

PASS = FAIL = 0


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ok    {name}")
    else:
        FAIL += 1
        print(f"  FAIL  {name}" + (f"  [{detail}]" if detail else ""))


def issue(**kw):
    """A minimal briefing the binding check will actually walk."""
    b = {
        "date": "Friday, September 11, 2026",
        "generated_at": "2026-09-11T11:30:00+00:00",
        "locked_prices": {"corn": 5.09, "beans": 12.99, "wheat": 7.11,
                          "cattle": 219.62, "hogs": 81.62, "crude": 99.99},
        "market_closed": False,
        "sections": [],
    }
    b.update(kw)
    return b


def binds(b, archive):
    _passed, issues = bg.run(b, prices=None, today=datetime.date(2026, 9, 11),
                             archive_dir=archive)
    return [(s, c, m) for s, c, m in issues if c.startswith("bind")]


def main():
    # An archive holding ONE prior board, deliberately a stale snapshot: beans
    # at 13.17, so the walk computes -1.4% where the real session was -1.8%.
    with tempfile.TemporaryDirectory() as tmp:
        prior = {"date": "Thursday, September 10, 2026",
                 "generated_at": "2026-09-10T11:30:00+00:00",
                 "locked_prices": {"corn": 5.115, "beans": 13.17, "wheat": 7.13,
                                   "cattle": 217.8, "hogs": 83.2, "crude": 99.05}}
        (Path(tmp) / "2026-09-10.json").write_text(json.dumps(prior))

        print("the locked change wins over the archive walk")
        LOCKED = {"beans": {"prev": 13.23, "pct": -1.8141}}
        walk = issue(sections=[{"title": "Beans", "body": "- Soybeans gave back 24 cents to **$12.99** on the print."}])
        lock = issue(locked_changes=LOCKED,
                     sections=[{"title": "Beans", "body": "- Soybeans gave back 24 cents to **$12.99** on the print."}])
        w, l = binds(walk, tmp), binds(lock, tmp)
        check("the walk flags a correct '24 cents' sentence",
              any("cents" in c for _s, c, _m in w), str(w))
        check("...and the locked change does not",
              not any("cents" in c for _s, c, _m in l), str(l))
        # The PERCENT path, separately: the walk gives beans -1.4% off the
        # stale snapshot, the locked change gives the real -1.8%. Without this
        # the suite stayed green when the gate stopped reading the locked
        # percent at all, because the cents check above uses the locked `prev`
        # and passed either way.
        pw = issue(sections=[{"title": "Beans", "body": "- Soybeans fell 1.8% to **$12.99** on the print."}])
        pl = issue(locked_changes=LOCKED,
                   sections=[{"title": "Beans", "body": "- Soybeans fell 1.8% to **$12.99** on the print."}])
        check("the walk flags a correct '1.8%' sentence",
              any(c.startswith("bind:pct") for _s, c, _m in binds(pw, tmp)), str(binds(pw, tmp)))
        check("...and the locked percent does not",
              not any(c.startswith("bind:pct") for _s, c, _m in binds(pl, tmp)), str(binds(pl, tmp)))

        # WHICH SOURCE IS AUTHORITATIVE. The locked percent and a recomputation
        # from the locked previous close agree to four decimals today, so no
        # realistic fixture separates them. This one does, deliberately: the
        # locked percent says -5.0% while the locked prices imply -1.8%. The
        # gate must check the prose against the figure the email prints and the
        # model was shown, which is the locked percent.
        odd = issue(locked_changes={"beans": {"prev": 13.23, "pct": -5.0}},
                    sections=[{"title": "Beans", "body": "- Soybeans fell 5.0% to **$12.99** on the print."}])
        check("the LOCKED percent is authoritative, not a recomputation",
              not any(c.startswith("bind:pct") for _s, c, _m in binds(odd, tmp)), str(binds(odd, tmp)))

        check("mb.locked_change reads the locked percent",
              abs(mb.locked_change(lock, "beans") - (-1.8141)) < 1e-9)
        check("...and returns None for an issue archived before the lock",
              mb.locked_change(walk, "beans") is None)

        print("\na genuinely wrong sentence is still caught")
        wrong = issue(locked_changes={"beans": {"prev": 13.23, "pct": -1.8141}},
                      sections=[{"title": "Beans", "body": "- Soybeans climbed to **$12.99**, up on the session."}])
        check("prose claiming UP against a locked -1.8% still fails",
              any(c == "bind:dir" for _s, c, _m in binds(wrong, tmp)), str(binds(wrong, tmp)))
        wrongc = issue(locked_changes={"beans": {"prev": 13.23, "pct": -1.8141}},
                       sections=[{"title": "Beans", "body": "- Soybeans gave back 9 cents to **$12.99**."}])
        check("a wrong cents figure against the locked move still fails",
              any(c == "bind:cents" for _s, c, _m in binds(wrongc, tmp)), str(binds(wrongc, tmp)))

        print("\na capped move is not a claim that the market moved that way")
        capped = issue(locked_changes={"crude": {"prev": 103.22, "pct": -3.13}},
                       sections=[{"title": "Crude", "body":
                                  "- The Defense Production Act talk put a ceiling on the crude rally: "
                                  "**$99.99** became resistance, not a floor."}])
        check("'put a ceiling on the crude rally' does not fire",
              not any(c == "bind:dir" for _s, c, _m in binds(capped, tmp)), str(binds(capped, tmp)))
        genuine = issue(locked_changes={"crude": {"prev": 103.22, "pct": -3.13}},
                        sections=[{"title": "Crude", "body": "- Crude rallied to **$99.99** on the pipeline news."}])
        check("...but a real 'rallied' against a -3.1% board does",
              any(c == "bind:dir" for _s, c, _m in binds(genuine, tmp)), str(binds(genuine, tmp)))

        print("\nyesterday's call is retrospective prose, not a claim about today")
        yc = issue(locked_changes={"wheat": {"prev": 7.36, "pct": -3.41}},
                   yesterdays_call={"outcome": "didnt",
                                    "summary": "Called wheat higher from $7.11 Friday.",
                                    "note": "Miss; wheat never took the line."})
        check("'called wheat higher' is not bound to today's board",
              not any(c.startswith("bind") for _s, c, _m in binds(yc, tmp)), str(binds(yc, tmp)))

        print("\nthe sessions the two numbers belong to")
        check("a Tuesday pre-open fetch quotes Tuesday, against Monday's close",
              mb.quote_session("2026-09-08T11:30:00Z") == datetime.date(2026, 9, 8)
              and mb.prev_close_session("2026-09-08T11:30:00Z") == datetime.date(2026, 9, 4),
              f"{mb.quote_session('2026-09-08T11:30:00Z')} / {mb.prev_close_session('2026-09-08T11:30:00Z')}")
        check("...Labor Day is skipped on the way back",
              mb.prev_close_session("2026-09-08T11:30:00Z") == datetime.date(2026, 9, 4))
        check("a Friday post-close fetch quotes Friday, against Thursday",
              mb.quote_session("2026-09-04T22:04:00Z") == datetime.date(2026, 9, 4)
              and mb.prev_close_session("2026-09-04T22:04:00Z") == datetime.date(2026, 9, 3))
        check("a Sunday fetch quotes Friday, against Thursday",
              mb.quote_session("2026-09-13T13:30:00Z") == datetime.date(2026, 9, 11)
              and mb.prev_close_session("2026-09-13T13:30:00Z") == datetime.date(2026, 9, 10))
        check("an unparseable fetch time yields None rather than a guess",
              mb.quote_session("not a date") is None and mb.prev_close_session(None) is None)

    print()
    print(f"number-binding selftest: {PASS} passed, {FAIL} failed")
    return 1 if FAIL else 0


if __name__ == "__main__":
    raise SystemExit(main())
