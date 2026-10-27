#!/usr/bin/env python3
"""
headline_fix.py -- a Daily headline that fails its check is fixed before the
send, and checked again until it passes (Sig, Oct 27 2026: "trigger a fix on
the spot until it passes its test"; never send a failing headline).

WHY. A sentence in the body that breaks a claim rule is cut (daily_claims.strip).
A headline cannot be cut, so until now briefing_gate only warned on it, and the
Oct 21 headline went out as "Corn down 6 straight days to $4.59½; beans down 7
to $12.45": the run was of settles and the price was the 5:46 a.m. trade.

WHAT. Runs after the critic and the fact check, right before GATE 2, on
data/daily.json:
  1. The full gate (briefing_gate.run) on the issue. No FAIL on the headline:
     nothing to do.
  2. Else the headline is written again by the writer model (the generator's
     model, BRIEFING_MODEL or claude_models.WRITER, the same API and the same
     one fallback), told the rule it broke and handed the facts it must use:
     each settle with its date and each trade with its time, from the issue's
     own quote strip. The full gate runs again. Up to MAX_TRIES tries.
  3. Still failing: a plain headline built by code from the strip's settles
     only ("Corn settled at $4.62 on Oct 20; beans at $12.48¼"), which must
     itself pass the gate.
  4. Even that fails (or the strip has no settle): the send is held. Exit 1
     stops the job before the commit and the send, as a GATE 2 block does, and
     Sig gets one email saying what failed (log_safe.owner_mail, the v2 hold's
     route).
A teaser, subheadline or subject_line that was a copy of the old headline takes
the new one. Every try is logged (try number, rule hit); no key, no address.

    python3 scripts/headline_fix.py data/daily.json --prices data/prices.json
    python3 scripts/headline_fix.py --selftest      (stubbed model; no API call)
"""
import argparse
import copy
import datetime as dt
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import briefing_gate  # noqa: E402  the full check, one definition
import daily_claims   # noqa: E402  the claim rules and their prompt wording
import pricefmt       # noqa: E402  $12.48¼

MAX_TRIES = 3
HEAD = "headline"
FOLLOW = ("teaser", "subheadline", "subject_line")   # fields that may copy the headline
MAX_LEN = 110
_LOC = re.compile(r"^(headline|teaser|subheadline|subject_line)\b")

# the prompt's own line for each claim rule (PROMPT_RULES lists them in RULES order)
RULE_TEXT = dict(zip([n for n, _ in daily_claims.RULES],
                     [ln[2:] for ln in daily_claims.PROMPT_RULES.splitlines() if ln.startswith("- ")]))
RULE_TEXT["close-before-settle"] += (" A run of lower or higher sessions is a run of settles, so it ends at a settle"
                                     " price with its date, never at an overnight or morning trade.")

SYSTEM = ("You write the one-line headline of the AGSIST Daily, a plain morning grain and livestock note for farmers. "
          "Plain farm words, sentence case, no em dashes, no hype, no first person, under 100 characters. "
          "Use only the numbers and dates you are given. Reply with the headline text only, nothing else.")

NAMES = (("corn", "Corn"), ("beans", "beans"), ("wheat", "wheat"))


# ── what the gate says about the headline ──────────────────────────────────

def _watched(briefing, original):
    """The locs that count as the headline: the headline, and any follow field
    that is a copy of it."""
    locs = {HEAD}
    for k in FOLLOW:
        v = briefing.get(k)
        if isinstance(v, str) and original and v.strip() == original.strip():
            locs.add(k)
    return locs


def failures(briefing, prices, today, archive_dir=None, locs=(HEAD,)):
    """[(code, message)] for every FAIL the full gate finds in the headline (or
    a field that copies it)."""
    _ok, issues = briefing_gate.run(copy.deepcopy(briefing), prices, today=today, archive_dir=archive_dir)
    out = []
    for sev, code, msg in issues:
        m = _LOC.match(str(msg))
        if sev == "FAIL" and m and m.group(1) in locs:
            out.append((code, msg))
    return out


def claim_hits(text, briefing, prices, today):
    """Every claim rule (warning ones too) a candidate headline breaks."""
    ctx = daily_claims.context(prices or {}, daily_claims.issue_date(briefing, today), briefing.get("quote_strip"))
    return [r for r, _, _ in daily_claims.lint({HEAD: text}, ctx)]


def _rules(fails):
    return sorted({c.split(":", 1)[1] if c.startswith("claim:") else c for c, _ in fails})


# ── the facts the rewrite must use ─────────────────────────────────────────

def _day(iso):
    try:
        d = dt.date.fromisoformat(str(iso)[:10])
    except ValueError:
        return None
    return d


def _short(d):
    return "%s %d" % (d.strftime("%b"), d.day) if d else ""


def _ct(at):
    """'5:46 a.m. CT Oct 21' from an ISO UTC stamp."""
    try:
        from zoneinfo import ZoneInfo
        t = dt.datetime.fromisoformat(str(at).replace("Z", "+00:00")).astimezone(ZoneInfo("America/Chicago"))
    except Exception:
        return ""
    h = t.hour % 12 or 12
    return "%d:%02d %s CT %s" % (h, t.minute, "a.m." if t.hour < 12 else "p.m.", _short(t.date()))


def _grain_px(v):
    return pricefmt.price(round(float(v) * 100, 4))


def _rows(briefing):
    qs = briefing.get("quote_strip") or {}
    out = {}
    for row in qs.get("quotes") or []:
        fam = str(row.get("key") or "").split("-")[0]
        if fam in dict(NAMES) and fam not in out and row.get("last") is not None:
            out[fam] = row
    return qs, out


def settles(briefing):
    """[(family, name, settle, date)] from the issue's own strip: the session's
    settle when the strip is settles, else the prior session's (the 'prev')."""
    qs, rows = _rows(briefing)
    out = []
    for fam, name in NAMES:
        row = rows.get(fam)
        if not row:
            continue
        if row.get("kind") == "settle":
            v, d = row.get("last"), _day(row.get("date") or qs.get("session") or "")
        else:
            v, d = row.get("prev"), _day(qs.get("vs_session") or "")
        if v is not None and d is not None:
            out.append((fam, name, float(v), d))
    return out


def facts(briefing):
    """Plain lines for the model: each settle with its date, each trade with its time."""
    qs, rows = _rows(briefing)
    lines = []
    for fam, name in NAMES:
        row = rows.get(fam)
        if not row:
            continue
        label = "%s (%s)" % (name.capitalize(), row.get("contract") or "front month")
        if row.get("kind") == "settle":
            d = _day(row.get("date") or qs.get("session") or "")
            lines.append("%s: settled %s on %s (a settle)." % (label, _grain_px(row["last"]), _short(d)))
        else:
            lines.append("%s: trading at %s at %s (a trade, NOT a settle or close)." % (
                label, _grain_px(row["last"]), _ct(row.get("at") or qs.get("asof"))))
        if row.get("kind") != "settle" and row.get("prev") is not None:
            lines.append("%s: settled %s on %s (a settle)." % (label, _grain_px(row["prev"]),
                                                              _short(_day(qs.get("vs_session") or ""))))
    return lines


def prompt(briefing, fails, tried):
    rules = _rules(fails)
    why = [RULE_TEXT.get(r, "") for r in rules]
    msgs = [m[:240] for _, m in fails]
    p = ["The headline below failed the fact check and cannot go out.",
         "", "Headline: " + str(briefing.get(HEAD) or ""),
         "", "What the check found:"] + ["- " + m for m in msgs]
    p += ["", "The rule:"] + ["- " + w for w in why if w]
    p += ["", "Facts you may use (from this issue's quote board):"] + ["- " + f for f in facts(briefing)]
    if tried:
        p += ["", "These rewrites also failed; do not repeat them:"] + ["- " + t for t in tried]
    lead = str(briefing.get("lead") or "")[:600]
    if lead:
        p += ["", "The issue's lead, for the story (do not copy numbers from it that are not in the facts above):", lead]
    p += ["", "Write one new headline for this issue that tells the same story and breaks no rule."]
    return "\n".join(p)


# ── the model call (the generator's model, API and fallback) ───────────────

def call_model(user_message):
    """One short call on the writer model. Returns the text."""
    import claude_models
    import critique_briefing as cb     # http_post_json: retries 429/5xx; _refused_model: a 404 model
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        raise RuntimeError("ANTHROPIC_API_KEY not set")
    model = os.environ.get("BRIEFING_MODEL", "").strip() or claude_models.WRITER
    payload = {"model": model, "max_tokens": 400, "thinking": claude_models.no_thinking(model),
               "system": SYSTEM, "messages": [{"role": "user", "content": user_message}]}
    headers = {"Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01"}
    try:
        res = cb.http_post_json(cb.ANTHROPIC_API, payload, headers, timeout=90)
    except Exception as e:
        if not (cb._refused_model(e) and model != claude_models.WRITER_FALLBACK):
            raise
        res = None
    if res is None or (res.get("stop_reason") == "refusal" and model != claude_models.WRITER_FALLBACK):
        print("::warning title=Headline fix model fallback::'%s' refused; using %s" % (model, claude_models.WRITER_FALLBACK))
        payload = claude_models.with_model(payload, claude_models.WRITER_FALLBACK)
        res = cb.http_post_json(cb.ANTHROPIC_API, payload, headers, timeout=90)
    if res.get("usage"):
        print("  " + claude_models.usage_line(payload["model"], res["usage"]))
    return "".join(b.get("text", "") for b in res.get("content") or [] if b.get("type") == "text")


def clean(text):
    """The model's reply as a headline: first line, no quotes or markdown, no
    em dashes, sentence case."""
    t = next((ln.strip() for ln in str(text or "").splitlines() if ln.strip()), "")
    t = re.sub(r"^(?:headline\s*:\s*)", "", t, flags=re.I)
    t = t.replace("**", "").strip().strip('"“”\'` ').strip()
    t = re.sub("\\s*[\u2014\u2013]\\s*", ", ", t)
    try:
        import generate_daily
        t = generate_daily.fix_headline_case({HEAD: t})[HEAD]
    except Exception:
        pass
    return t


# ── the code fallback ──────────────────────────────────────────────────────

def plain_headline(briefing):
    """'Corn settled at $4.62 on Oct 20; beans at $12.48¼' from the strip's
    settles only. None when the strip has none."""
    st = settles(briefing)[:2]
    if not st:
        return None
    parts = []
    for i, (_fam, name, v, d) in enumerate(st):
        if i == 0:
            parts.append("%s settled at %s on %s" % (name.capitalize(), _grain_px(v), _short(d)))
        elif d == st[0][3]:
            parts.append("%s at %s" % (name, _grain_px(v)))
        else:
            parts.append("%s at %s on %s" % (name, _grain_px(v), _short(d)))
    return "; ".join(parts)


# ── the loop ───────────────────────────────────────────────────────────────

def _put(briefing, new, locs):
    for k in locs:
        briefing[k] = new


def fix(briefing, prices=None, today=None, archive_dir=None, model=call_model, tries=MAX_TRIES, log=print):
    """(briefing, record). record['result'] is 'clean', 'rewritten', 'fallback'
    or 'held'. On 'held' the briefing's headline is left as it came."""
    original = str(briefing.get(HEAD) or "")
    locs = _watched(briefing, original)
    fails = failures(briefing, prices, today, archive_dir, locs)
    if not fails:
        return briefing, {"result": "clean"}
    rec = {"result": "held", "original": original, "tries": []}
    log("[headline-fix] headline fails: %s; rewriting (up to %d tries)" % (", ".join(_rules(fails)), tries))
    tried, last = [], fails
    for n in range(1, tries + 1):
        try:
            cand = clean(model(prompt(briefing, last, tried)))
        except Exception as e:
            log("[headline-fix] try %d/%d: the model call failed (%s)" % (n, tries, type(e).__name__))
            rec["tries"].append({"try": n, "error": type(e).__name__})
            continue
        if not cand or len(cand) > MAX_LEN:
            log("[headline-fix] try %d/%d: unusable reply (%d chars)" % (n, tries, len(cand)))
            rec["tries"].append({"try": n, "rules": ["unusable"]})
            tried.append(cand[:MAX_LEN] or "(empty)")
            continue
        b2 = copy.deepcopy(briefing)
        _put(b2, cand, locs)
        f2 = failures(b2, prices, today, archive_dir, locs)
        hits = claim_hits(cand, briefing, prices, today)
        bad = _rules(f2) or sorted(set(hits))
        rec["tries"].append({"try": n, "headline": cand, "rules": bad})
        if not bad:
            log("[headline-fix] try %d/%d passes: %r" % (n, tries, cand))
            rec.update(result="rewritten", headline=cand)
            return b2, rec
        log("[headline-fix] try %d/%d still fails: %s: %r" % (n, tries, ", ".join(bad), cand))
        tried.append(cand)
        last = f2 or [("claim:" + h, "headline: %r" % cand) for h in hits]
    plain = plain_headline(briefing)
    if plain:
        b2 = copy.deepcopy(briefing)
        _put(b2, plain, locs)
        f2 = failures(b2, prices, today, archive_dir, locs)
        bad = _rules(f2) or sorted(set(claim_hits(plain, briefing, prices, today)))
        if not bad:
            log("[headline-fix] code fallback passes: %r" % plain)
            rec.update(result="fallback", headline=plain)
            return b2, rec
        log("[headline-fix] code fallback fails too: %s: %r" % (", ".join(bad), plain))
        rec["fallback"] = {"headline": plain, "rules": bad}
    else:
        log("[headline-fix] no settle on the quote strip; no code fallback")
    rec["rules"] = _rules(fails)
    return briefing, rec


def hold_alert(day, rec):
    """One email to Sig: the headline failed, every rewrite and the fallback
    failed, nothing was sent."""
    import log_safe
    lines = ["The AGSIST Daily for %s did not go out: its headline failed the fact check and no fix passed." % day, "",
             "Headline: \"%s\"" % rec.get("original", ""), "Rule: %s" % ", ".join(rec.get("rules") or []), ""]
    for t in rec.get("tries") or []:
        lines.append("Try %d: \"%s\" %s" % (t["try"], t.get("headline", ""), ", ".join(t.get("rules") or [t.get("error", "")])))
    fb = rec.get("fallback")
    lines.append("Code fallback: " + ("\"%s\" %s" % (fb["headline"], ", ".join(fb["rules"])) if fb else "none (no settle on the board)"))
    lines += ["", "Nothing was sent and nothing was published. To fix and rerun: GitHub, dnilgis/agsist, Actions, "
              "Generate Daily Briefing, Run workflow on main with send_email ticked. To skip today, do nothing."]
    return log_safe.owner_mail("AGSIST Daily %s held: headline failed its check" % day, lines)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("daily", nargs="?", default=os.path.join(REPO, "data", "daily.json"))
    ap.add_argument("--prices", default=os.path.join(REPO, "data", "prices.json"))
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args(argv)
    if a.selftest:
        return selftest()
    with open(a.daily) as f:
        b = json.load(f)
    try:
        with open(a.prices) as f:
            prices = json.load(f)
    except (OSError, ValueError):
        prices = None
    today = dt.date.today()
    b2, rec = fix(b, prices, today, archive_dir=os.path.join(REPO, "data", "daily-archive"))
    if rec["result"] == "clean":
        print("[headline-fix] headline passes; nothing to do")
        return 0
    if rec["result"] == "held":
        print("::error title=Daily held, headline::the headline failed its check and no rewrite or fallback passed; not sending")
        print("alert to Sig: " + ("sent" if hold_alert(today.isoformat(), rec) else "NOT sent (see above)"))
        return 1
    b2["headline_fix"] = {k: rec[k] for k in ("result", "original", "headline", "tries")}
    print("::notice title=Daily headline fixed::%s after %d try(s)" % (rec["result"], len(rec["tries"])))
    with open(a.daily, "w") as f:
        json.dump(b2, f, indent=2, ensure_ascii=False)
    if os.path.abspath(a.daily) == os.path.join(REPO, "data", "daily.json"):
        try:
            import critique_briefing
            critique_briefing.re_archive(b2)
        except Exception as e:
            print("[headline-fix] [warn] archive not re-rendered (%s)" % type(e).__name__)
    return 0


# ── selftest: the Oct 21 headline, stubbed model ───────────────────────────

OCT21_STRIP = {"asof": "2026-10-21T10:46:26Z", "session": "2026-10-21", "vs_session": "2026-10-20",
               "quotes": [{"key": "corn-dec", "name": "Corn", "contract": "Dec '26", "last": 4.595, "prev": 4.62,
                           "kind": "last", "at": "2026-10-21T10:46:05Z"},
                          {"key": "beans-nov", "name": "Soybeans", "contract": "Nov '26", "last": 12.45,
                           "prev": 12.4825, "kind": "last", "at": "2026-10-21T10:46:05Z"}]}
OCT21_BAD = "Corn down 6 straight days to $4.59½; beans down 7 to $12.45"
OCT21_GOOD = "Corn settled lower 6 days straight, $4.62 on Oct 20; beans 7 days, $12.48¼"


def oct21():
    return {"date": "Wednesday, October 21, 2026", "headline": OCT21_BAD, "teaser": OCT21_BAD,
            "lead": "Corn and beans keep sliding on harvest selling.", "quote_strip": copy.deepcopy(OCT21_STRIP)}


def stub(replies):
    calls = []

    def m(p):
        calls.append(p)
        return replies[min(len(calls), len(replies)) - 1]
    m.calls = calls
    return m


def selftest():
    fails = []
    day = dt.date(2026, 10, 27)
    quiet = lambda *_: None  # noqa: E731

    def chk(name, cond, extra=""):
        if not cond:
            fails.append("%s %s" % (name, extra))

    # the gate now FAILS the Oct 21 headline (it only warned before)
    f = failures(oct21(), None, day)
    chk("gate fails Oct 21 headline", [c for c, _ in f] == ["claim:close-before-settle"], f)

    # first retry still bad, second good
    m = stub(["**Corn down 6 straight days to $4.59½; beans down 7 to $12.45**", OCT21_GOOD])
    b, rec = fix(oct21(), None, day, model=m, log=quiet)
    chk("retry: result", rec["result"] == "rewritten", rec)
    chk("retry: two calls", len(m.calls) == 2, len(m.calls))
    chk("retry: headline", b["headline"] == OCT21_GOOD, b["headline"])
    chk("retry: teaser follows", b["teaser"] == OCT21_GOOD, b.get("teaser"))
    chk("retry: try 1 logged with rule", rec["tries"][0]["rules"] == ["close-before-settle"], rec["tries"])
    p = m.calls[0]
    chk("prompt names the settles with dates", "settled $4.62 on Oct 20" in p and "settled $12.48¼ on Oct 20" in p, p)
    chk("prompt names the trade with its time", "$4.59½ at 5:46 a.m. CT Oct 21" in p, p)
    chk("prompt states the rule", "never at an overnight or morning trade" in p, p)
    chk("second prompt lists the failed rewrite", "do not repeat" in m.calls[1], m.calls[1])
    chk("passes the gate after", not failures(b, None, day, locs=("headline", "teaser")))

    # all bad -> code fallback
    m = stub([OCT21_BAD])
    b, rec = fix(oct21(), None, day, model=m, log=quiet)
    chk("fallback: three tries", len(m.calls) == MAX_TRIES, len(m.calls))
    chk("fallback: result", rec["result"] == "fallback", rec)
    chk("fallback: headline", b["headline"] == "Corn settled at $4.62 on Oct 20; beans at $12.48¼", b["headline"])
    chk("fallback: passes", not failures(b, None, day))

    # a model that is down counts as a failed try, then the fallback
    def down(_p):
        raise RuntimeError("no key")
    b, rec = fix(oct21(), None, day, model=down, log=quiet)
    chk("model down: fallback", rec["result"] == "fallback", rec)

    # no settle on the board and every rewrite bad -> held, headline untouched
    y = oct21()
    y["quote_strip"]["vs_session"] = None
    b, rec = fix(y, None, day, model=stub([OCT21_BAD]), log=quiet)
    chk("held: result", rec["result"] == "held", rec)
    chk("held: headline untouched", b["headline"] == OCT21_BAD)

    # a clean headline makes no call
    m = stub(["x"])
    g = oct21()
    g["headline"] = OCT21_GOOD
    b, rec = fix(g, None, day, model=m, log=quiet)
    chk("clean: no call", rec["result"] == "clean" and not m.calls, rec)

    chk("clean(): em dash and markdown", clean('**Corn falls \u2014 beans too**') == "Corn falls, beans too", clean('**Corn falls \u2014 beans too**'))

    for x in fails:
        print("FAIL", x)
    print("headline_fix selftest: %s" % ("ok" if not fails else "%d failed" % len(fails)))
    return 0 if not fails else 1


if __name__ == "__main__":
    sys.exit(main())
