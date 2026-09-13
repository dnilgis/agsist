#!/usr/bin/env python3
"""
briefing_cut.py — the one definition of how long AGSIST Daily is allowed to be.

Sig, 2026-09-11: "i will go with all the way as long as it becomes the most
impactful daily ag briefing available, period." He also said he barely reads
it because it is too long. Before this file the budget was a number inside a
prompt (750, then 750-900), a second number inside the critic's Rule 8, and a
third inside validate_briefing() — and "Word budget" sat in NON_BLOCKING, so
no run could ever fail for length. It drifted for two days while five other
rounds shipped over it.

This module is imported by generate_daily.py (enforce + validate),
critique_briefing.py (score + trim), and daily_schema.py (the workflow's hard
stop). Nobody else carries a copy of these numbers.

What it does:
  word_count(briefing)      -> int, every reader-facing prose field
  field_counts(briefing)    -> {field: words} for the critic's review payload
  enforce_budget(briefing)  -> (briefing, log) deterministic truncation to the
                               caps below, then to the ceiling
  lede_defers(lead)         -> the last sentence if it points forward, else ""
  over_ceiling(briefing)    -> (total, is_over)

Run `python scripts/briefing_cut.py --selftest`.
"""
import re
import sys

# ── the budget ──────────────────────────────────────────────────────────────
TARGET_WORDS = 400          # what a good day reads like
HARD_CEILING = 450          # enforce_budget cuts to this; anything above fails the run

CAP_LEAD = 55
CAP_SECTION_BODY = 55
CAP_SO_WHAT = 15
CAP_ONE_NUMBER_CONTEXT = 30
CAP_ACTION = 25
CAP_YC_NOTE = 25
CAP_OTP_BODY = 30
CAP_WATCH_DESC = 20

MIN_SECTIONS = 2
MAX_SECTIONS = 3
MAX_OTP = 1
MAX_WATCH = 3

# Reader-facing fields the model no longer emits. If one shows up in a new
# briefing it is a prompt regression; the archive still carries them and the
# renderers still draw them for old pages.
RETIRED_FIELDS = ("subheadline", "the_takeaway", "the_more_you_know", "weekly_thread")
RETIRED_SECTION_FIELDS = ("catalyst", "vs_yesterday", "bottom_line")

_CONVICTION_RANK = {"high": 3, "medium": 2, "low": 1}
_WORD = re.compile(r"[A-Za-z0-9]")
_SENT_SPLIT = re.compile(r"(?<=[.!?])\s+")


def wc(s):
    """Words = whitespace tokens that carry a letter or digit. A bullet's
    leading '-' is not a word; '$4.85¼' is one."""
    if not s:
        return 0
    return sum(1 for t in str(s).split() if _WORD.search(t))


def _sections(b):
    s = b.get("sections")
    return [x for x in s if isinstance(x, dict)] if isinstance(s, list) else []


def field_counts(b):
    """Every reader-facing prose field and its word count. Legacy fields are
    counted when present so an old archive entry measures honestly too."""
    out = {}
    for k in ("headline", "lead", "action", "subheadline", "the_takeaway"):
        if b.get(k):
            out[k] = wc(b.get(k))
    on = b.get("one_number") or {}
    if isinstance(on, dict) and on.get("context"):
        out["one_number.context"] = wc(on.get("context"))
    yc = b.get("yesterdays_call") or {}
    if isinstance(yc, dict):
        if yc.get("note"):
            out["yesterdays_call.note"] = wc(yc.get("note"))
        if yc.get("summary"):
            out["yesterdays_call.summary"] = wc(yc.get("summary"))
    for i, s in enumerate(_sections(b)):
        for k in ("title", "body", "so_what", "bottom_line", "farmer_action", "catalyst", "vs_yesterday"):
            if s.get(k):
                out[f"sections[{i}].{k}"] = wc(s.get(k))
    for i, it in enumerate(b.get("outside_the_pit") or []):
        if isinstance(it, dict):
            for k in ("title", "body"):
                if it.get(k):
                    out[f"outside_the_pit[{i}].{k}"] = wc(it.get(k))
    for i, w in enumerate(b.get("watch_list") or []):
        if isinstance(w, dict) and w.get("desc"):
            out[f"watch_list[{i}].desc"] = wc(w.get("desc"))
    t = b.get("the_more_you_know") or {}
    if isinstance(t, dict) and t.get("body"):
        out["the_more_you_know.body"] = wc(t.get("body"))
    wt = b.get("weekly_thread") or {}
    if isinstance(wt, dict) and wt.get("status_text"):
        out["weekly_thread.status_text"] = wc(wt.get("status_text"))
    return out


def word_count(b):
    return sum(field_counts(b).values())


def over_ceiling(b):
    n = word_count(b)
    return n, n > HARD_CEILING


# ── clamps ──────────────────────────────────────────────────────────────────
def _end(s):
    s = s.rstrip().rstrip(",;:")
    return s if s.endswith((".", "!", "?")) else s + "."


def clamp_words(s, cap):
    """Hard word cut for one-line fields (so_what, watch desc, action)."""
    if wc(s) <= cap:
        return s
    toks = str(s).split()
    keep, n = [], 0
    for t in toks:
        if _WORD.search(t):
            n += 1
        if n > cap:
            break
        keep.append(t)
    return _end(" ".join(keep))


def clamp_sentences(s, cap):
    """Keep whole sentences while they fit. If the first alone is over the
    cap, cut it on a word boundary rather than ship a fragment of a fragment."""
    if wc(s) <= cap:
        return s
    sents = [x for x in _SENT_SPLIT.split(str(s).strip()) if x.strip()]
    keep, n = [], 0
    for x in sents:
        if n + wc(x) > cap:
            break
        keep.append(x)
        n += wc(x)
    if not keep:
        return clamp_words(sents[0] if sents else s, cap)
    return " ".join(keep)


def clamp_bullets(body, cap):
    """Section bodies are '- ' lines. Keep whole bullets while they fit;
    a lone oversized bullet is clamped by sentence."""
    if wc(body) <= cap:
        return body
    lines = [ln.rstrip() for ln in str(body).split("\n") if ln.strip()]
    bullets = [ln for ln in lines if ln.lstrip().startswith("- ")]
    if not bullets:
        return clamp_sentences(body, cap)
    keep, n = [], 0
    for ln in lines:
        w = wc(ln)
        if n + w > cap:
            break
        keep.append(ln)
        n += w
    if not keep:
        first = lines[0]
        text = first.lstrip()[2:] if first.lstrip().startswith("- ") else first
        return "- " + clamp_sentences(text, cap)
    return "\n".join(keep)


def _drop_weakest_section(secs):
    """Remove the lowest-conviction section; ties drop the LAST one so the
    order the model chose (strongest first) is respected."""
    if len(secs) <= MIN_SECTIONS:
        return secs, None
    ranked = sorted(range(len(secs)),
                    key=lambda i: (_CONVICTION_RANK.get((secs[i].get("conviction_level") or "").lower(), 2), -i))
    idx = ranked[0]
    title = secs[idx].get("title", "")
    return [s for i, s in enumerate(secs) if i != idx], (idx, title)


def enforce_budget(b):
    """Deterministic. Same input, same output. Returns (briefing, log)."""
    log = []
    secs = _sections(b)
    while len(secs) > MAX_SECTIONS:
        secs, dropped = _drop_weakest_section(secs)
        if not dropped:
            break
        log.append(f"dropped section {dropped[0]} {dropped[1]!r} (max {MAX_SECTIONS})")
    b["sections"] = secs

    otp = [x for x in (b.get("outside_the_pit") or []) if isinstance(x, dict)]
    if len(otp) > MAX_OTP:
        log.append(f"outside_the_pit {len(otp)} -> {MAX_OTP}")
        otp = otp[:MAX_OTP]
    b["outside_the_pit"] = otp

    wl = [x for x in (b.get("watch_list") or []) if isinstance(x, dict)]
    if len(wl) > MAX_WATCH:
        log.append(f"watch_list {len(wl)} -> {MAX_WATCH}")
        wl = wl[:MAX_WATCH]
    b["watch_list"] = wl

    def clamp(obj, key, cap, fn, label):
        v = obj.get(key)
        if isinstance(v, str) and wc(v) > cap:
            new = fn(v, cap)
            log.append(f"{label} {wc(v)}w -> {wc(new)}w (cap {cap})")
            obj[key] = new

    clamp(b, "lead", CAP_LEAD, clamp_sentences, "lead")
    clamp(b, "action", CAP_ACTION, clamp_words, "action")
    on = b.get("one_number")
    if isinstance(on, dict):
        clamp(on, "context", CAP_ONE_NUMBER_CONTEXT, clamp_sentences, "one_number.context")
    yc = b.get("yesterdays_call")
    if isinstance(yc, dict):
        clamp(yc, "note", CAP_YC_NOTE, clamp_sentences, "yesterdays_call.note")
    for i, s in enumerate(secs):
        clamp(s, "body", CAP_SECTION_BODY, clamp_bullets, f"sections[{i}].body")
        clamp(s, "so_what", CAP_SO_WHAT, clamp_words, f"sections[{i}].so_what")
    for i, it in enumerate(otp):
        clamp(it, "body", CAP_OTP_BODY, clamp_sentences, f"outside_the_pit[{i}].body")
    for i, w in enumerate(wl):
        clamp(w, "desc", CAP_WATCH_DESC, clamp_words, f"watch_list[{i}].desc")

    # The ladder. Each rung is the least valuable thing left.
    total = word_count(b)
    if total > HARD_CEILING and len(wl) > 2:
        b["watch_list"] = wl = wl[:2]
        log.append(f"over ceiling at {total}w: watch_list -> 2")
        total = word_count(b)
    if total > HARD_CEILING and isinstance(on, dict) and wc(on.get("context")) > 20:
        on["context"] = clamp_sentences(on.get("context"), 20)
        log.append(f"over ceiling at {total}w: one_number.context -> 20w")
        total = word_count(b)
    if total > HARD_CEILING and len(secs) > MIN_SECTIONS:
        secs, dropped = _drop_weakest_section(secs)
        b["sections"] = secs
        if dropped:
            log.append(f"over ceiling at {total}w: dropped section {dropped[0]} {dropped[1]!r}")
        total = word_count(b)
    if total > HARD_CEILING:
        log.append(f"STILL OVER CEILING: {total}w > {HARD_CEILING}")
    return b, log


# ── the lede rule ───────────────────────────────────────────────────────────
_FUTURE = re.compile(r"\b(will|won't|we'll|going to|is about to|are about to)\b", re.I)
_POINTS_FORWARD = re.compile(
    r"\b(tomorrow|next week|this week|the week ahead|by friday|monday'?s|tuesday'?s|wednesday'?s|"
    r"thursday'?s|friday'?s|the next (close|session|print|report|test)|ahead)\b", re.I)
_RESOLVES = re.compile(
    r"\b(decide[sd]?|determine[sd]?|settle[sd]?|answer[sd]?|tell[s]? (you|us)|test[s]?|"
    r"resolve[sd]?|show[s]?|reveal[s]?|confirm[s]?|holds the answer|is the tell|says which)\b", re.I)
_QUESTION = re.compile(r"\bthe question (is|now is|becomes)\b|\bwhether\b", re.I)


def lede_defers(lead):
    """Return the offending last sentence when the lede ends by pointing
    forward instead of stating a consequence already true. '' when clean.
    Heuristic: prose, so it WARNS; the critic (Rule 3) enforces."""
    if not lead:
        return ""
    sents = [x.strip() for x in _SENT_SPLIT.split(str(lead).strip()) if x.strip()]
    if not sents:
        return ""
    last = sents[-1]
    if _FUTURE.search(last):
        return last
    if _POINTS_FORWARD.search(last) and _RESOLVES.search(last):
        return last
    if _QUESTION.search(last):
        return last
    return ""


# ── selftest ────────────────────────────────────────────────────────────────
def _selftest():
    fails = []

    def check(name, ok, detail=""):
        print(("  ok   " if ok else "  FAIL ") + name + (f"  {detail}" if detail and not ok else ""))
        if not ok:
            fails.append(name)

    check("wc ignores bullet dashes", wc("- one two\n- three") == 3)
    check("wc counts prices as words", wc("$4.85¼ off 3%") == 3)
    check("clamp_words cuts and closes", clamp_words("a b c d e f", 3) == "a b c.")
    check("clamp_words no-op under cap", clamp_words("a b c", 5) == "a b c")
    s = "First one. Second sentence here. Third."
    check("clamp_sentences keeps whole sentences", clamp_sentences(s, 5) == "First one. Second sentence here.")
    check("clamp_sentences oversized first sentence cuts on words",
          clamp_sentences("one two three four five six", 3) == "one two three.")
    body = "- alpha beta gamma\n- delta epsilon\n- zeta"
    check("clamp_bullets keeps whole bullets", clamp_bullets(body, 5) == "- alpha beta gamma\n- delta epsilon")

    def big(nsec=5, nwatch=5, notp=3):
        return {
            "headline": "SIX WORD HEADLINE FOR TEST RUN",
            "lead": " ".join(["lead"] * 80) + ".",
            "action": " ".join(["act"] * 40),
            "one_number": {"value": "1", "unit": "u", "context": " ".join(["ctx"] * 50) + "."},
            "yesterdays_call": {"outcome": "didnt", "note": " ".join(["note"] * 40) + "."},
            "sections": [{"title": f"S{i}", "conviction_level": ["high", "low", "medium", "low", "medium"][i],
                          "body": "- " + " ".join(["w"] * 70), "so_what": " ".join(["so"] * 30)} for i in range(nsec)],
            "outside_the_pit": [{"title": "t", "body": " ".join(["o"] * 60) + "."} for _ in range(notp)],
            "watch_list": [{"time": "T", "desc": " ".join(["d"] * 40)} for _ in range(nwatch)],
        }

    b, log = enforce_budget(big())
    check("max 3 sections", len(b["sections"]) == 3, str(len(b["sections"])))
    check("drops lowest conviction first", [s["title"] for s in b["sections"]] == ["S0", "S2", "S4"],
          str([s["title"] for s in b["sections"]]))
    check("1 outside_the_pit", len(b["outside_the_pit"]) == 1)
    check("watch_list <= 3", len(b["watch_list"]) <= 3)
    check("lead clamped", wc(b["lead"]) <= CAP_LEAD, str(wc(b["lead"])))
    check("bodies clamped", all(wc(s["body"]) <= CAP_SECTION_BODY for s in b["sections"]))
    check("so_what clamped", all(wc(s["so_what"]) <= CAP_SO_WHAT for s in b["sections"]))
    n, over = over_ceiling(b)
    check(f"under hard ceiling after enforce ({n}w)", not over, str(n))
    b2, log2 = enforce_budget(dict(b))
    check("enforce_budget is idempotent", b2 == b and log2 == [], str(log2))

    small = {"headline": "H", "lead": "Corn closed $4.62. That is a fact.", "sections": [
        {"title": "A", "body": "- x", "so_what": "y", "conviction_level": "low"},
        {"title": "B", "body": "- x", "so_what": "y", "conviction_level": "low"}]}
    b3, log3 = enforce_budget(dict(small))
    check("small briefing untouched", log3 == [] and len(b3["sections"]) == 2, str(log3))
    check("never below MIN_SECTIONS", len(enforce_budget({"sections": [{"title": "only", "body": "- " + " ".join(["w"] * 500)}]})[0]["sections"]) == 1)

    check("deferral: 'will decide'", bool(lede_defers("Corn is stuck. Tuesday's print will decide it.")))
    check("deferral: 'the question is whether'", bool(lede_defers("Beans sat on the line. The question is whether it holds.")))
    check("deferral: 'Tuesday's print decides'", bool(lede_defers("Corn coiled. Tuesday's planting print decides which one's right.")))
    check("no deferral: consequence stated", lede_defers("Beans closed $12.99, off 24 cents. Every unpriced bushel is worth 24 cents less than Thursday.") == "")
    check("no deferral: quiet day", lede_defers("Most days don't move markets. Today is one of them. Wait.") == "")

    fc = field_counts(big(3, 3, 1))
    check("field_counts names every prose field", "sections[2].so_what" in fc and "watch_list[2].desc" in fc)
    print(f"briefing_cut selftest: {len(fails)} failure(s)")
    return 1 if fails else 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(_selftest())
    import json
    p = sys.argv[1] if len(sys.argv) > 1 else "data/daily.json"
    d = json.load(open(p))
    n, over = over_ceiling(d)
    for k, v in field_counts(d).items():
        print(f"  {k:<34} {v}")
    print(f"total {n} words (target {TARGET_WORDS}, ceiling {HARD_CEILING}){' OVER' if over else ''}")
    dl = lede_defers(d.get("lead"))
    if dl:
        print(f"lede defers: {dl!r}")
    sys.exit(1 if over else 0)
