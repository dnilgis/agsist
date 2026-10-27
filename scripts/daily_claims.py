#!/usr/bin/env python3
"""
daily_claims.py -- claims a futures quote cannot carry, found by code.

WHY. An outside review of the Daily archive (Oct 25 2026) picked out the worst
lines, and each was a claim the numbers in the issue could not support:

  Oct 16  "Hogs sat flat at $75.55"            the October contract, dead since Oct 14
  Oct 11  "Every bushel ... in the bin is worth about 19 cents less"
                                                a futures move read as a cash value
  Oct 18  "Friday's (Oct 23) $227.55 close"    a date after the issue, as if past
  Oct 22  "$4.64 overnight ... the first higher close"
                                                a last trade called a close
  Oct 25  "Diesel and fertilizer costs follow crude"
                                                a cause with no source
  Oct 25  "That favors beans when acres are planned for next spring"
                                                planting advice from this year's contracts

Each rule below is one of those, written so the real line fails and the
corrected line passes (see the selftest). One definition, used three times:
the generator's prompt (PROMPT_RULES), the generator and the critic after a
rewrite (strip: the sentence is cut, never reworded), and briefing_gate (any
left blocks the send).

  context(prices, issue_date, quote_strip)  what the rules need to know
  lint(briefing, ctx)   -> [(rule, loc, sentence)]
  strip(briefing, ctx)  -> (briefing, [log lines])
  from_files(briefing, repo, today)  context from data/prices.json

    python3 scripts/daily_claims.py --selftest
"""
import json
import os
import re
import sys
from datetime import date, datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import contract_calendar  # noqa: E402  ONE definition of "is this contract dead yet"

PROMPT_RULES = """CLAIM LIMITS (a machine checks every sentence after you finish; a sentence that breaks one is cut):
- Quote only live contracts. A contract past its last trading day is not a price. When a month expires, name the new front month ("December hogs").
- "Close", "closed", "settle" and "settled" belong only to a settlement. An overnight or morning price is a trade: "Dec corn is at $4.64 overnight, 3/4 cent above Wednesday's settle", never "a higher close".
- A date after today's issue is in the future. Never attach a close, a settle or a result to it.
- A futures move is not a cash price. Never say what a bushel in the bin, a farmer's corn or a cash bid is worth, gained or lost from futures alone; that needs a posted bid.
- No planting or acreage advice from this year's contracts or the nearby ratio. "Favors beans" needs next year's contracts (Nov and Dec of next year) and costs, or it is left out.
- No cause sentence ("because", "follows", "driven by", "due to") unless the same sentence says who reported it ("USDA said", "Reuters reported"). Otherwise give the two facts side by side and let the reader judge."""

# commodity words -> family (the prefix of the dated keys in prices.json), grain?
FAMILY = [
    (r"live cattle|fed cattle", "cattle", False),
    (r"feeder cattle|feeders?", "feeders", False),
    (r"lean hogs?|hogs?", "hogs", False),
    (r"soybean meal|meal", "meal", False),
    (r"soybean oil|soyoil|bean oil", "soyoil", False),
    (r"soybeans?|beans", "beans", True),
    (r"corn", "corn", True),
    (r"wheat", "wheat", True),
    (r"oats", "oats", True),
    (r"cattle", "cattle", False),
    (r"class iii milk|milk", "milk", False),
]
_FAM_RE = re.compile(r"\b(" + "|".join(p for p, _, _ in FAMILY) + r")\b", re.I)
_FRAC = {"¼": 0.25, "½": 0.5, "¾": 0.75}
PRICE = re.compile(r"\$\s?(\d{1,6}(?:,\d{3})*(?:\.\d{1,4})?)\s?([¼½¾])?")
MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august",
          "september", "october", "november", "december"]
_MON_RE = r"(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sept?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)"
DATE_RE = re.compile(r"\b" + _MON_RE + r"\.?\s+(\d{1,2})\b(?!,?\s*\d{4})")


def family_of(word):
    w = word.lower()
    for pat, fam, grain in FAMILY:
        if re.fullmatch(pat, w):
            return fam, grain
    return None, False


def _num(m):
    v = float(m.group(1).replace(",", ""))
    if m.group(2):
        v += _FRAC[m.group(2)] / 100.0    # a quarter cent on a dollar price
    return v


def _near(a, b, grain):
    tol = 0.0026 if grain else max(0.006, abs(b) * 0.0004)
    return abs(a - b) <= tol


# ── where the prose lives, and how it is cut ───────────────────────────────

def fields(b):
    """[(loc, text)] for every reader-facing field the model writes."""
    out = []

    def add(loc, v):
        if isinstance(v, str) and v.strip():
            out.append((loc, v))

    for k in ("headline", "subheadline", "lead", "teaser", "the_takeaway"):
        add(k, b.get(k))
    on = b.get("one_number")
    if isinstance(on, dict):
        add("one_number.context", on.get("context"))
    for i, s in enumerate(b.get("sections") or []):
        if isinstance(s, dict):
            for k in ("title", "body", "so_what"):
                add(f"sections[{i}].{k}", s.get(k))
    for i, o in enumerate(b.get("outside_the_pit") or []):
        if isinstance(o, dict):
            add(f"outside_the_pit[{i}].body", o.get("body"))
    for i, w in enumerate(b.get("watch_list") or []):
        if isinstance(w, dict):
            add(f"watch_list[{i}].desc", w.get("desc"))
    return out


CUTTABLE = lambda loc: not (loc == "headline" or loc.endswith(".title"))  # noqa: E731

_ABBR = re.compile(r"\b(a\.m|p\.m|U\.S|e\.g|i\.e|vs|No|St|Mt|Jr|Sr|Inc|Co)\.$")


def sentences(text):
    """Sentences of one line of prose. A period inside a price ($4.64) or an
    abbreviation (a.m., U.S.) does not end one."""
    out, start = [], 0
    for m in re.finditer(r"[.!?]+(?:[\"')\]]*)(?=\s+|$)", text):
        end = m.end()
        if _ABBR.search(text[start:m.start() + 1]):
            continue
        out.append(text[start:end].strip())
        start = end
    tail = text[start:].strip()
    if tail:
        out.append(tail)
    return [s for s in out if s]


def _get(b, loc):
    m = re.match(r"^(\w+)\[(\d+)\]\.(\w+)$", loc)
    if m:
        return b[m.group(1)][int(m.group(2))].get(m.group(3))
    if "." in loc:
        a, k = loc.split(".", 1)
        return (b.get(a) or {}).get(k)
    return b.get(loc)


def _set(b, loc, v):
    m = re.match(r"^(\w+)\[(\d+)\]\.(\w+)$", loc)
    if m:
        b[m.group(1)][int(m.group(2))][m.group(3)] = v
    elif "." in loc:
        a, k = loc.split(".", 1)
        b[a][k] = v
    else:
        b[loc] = v


# ── context ────────────────────────────────────────────────────────────────

def issue_date(briefing, today=None):
    """The issue's own date: its 'date' field ("Thursday, October 22, 2026"),
    else today."""
    raw = str((briefing or {}).get("date") or "")
    for fmt in ("%A, %B %d, %Y", "%B %d, %Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(raw.strip(), fmt).date()
        except ValueError:
            pass
    if isinstance(today, datetime):
        return today.date()
    return today or date.today()


def context(prices, day, quote_strip=None):
    """What the rules read. prices: data/prices.json as loaded. day: the
    issue's date. quote_strip: the issue's own strip, when it has one."""
    quotes = (prices or {}).get("quotes") or {}
    ctx = {"day": day, "dated": {}, "trades": {}, "settles": {}}
    now = datetime(day.year, day.month, day.day, 12, tzinfo=timezone.utc)
    for key, q in quotes.items():
        if not isinstance(q, dict):
            continue
        fam = key.split("-")[0]
        grain = fam in ("corn", "beans", "wheat", "oats")
        div = 100.0 if grain else 1.0
        if contract_calendar._parse(key) and q.get("close") is not None:
            ctx["dated"].setdefault(fam, []).append(
                (key, float(q["close"]) / div, contract_calendar.is_expired(key, now=now)))
        st = ctx["settles"].setdefault(fam, set())
        for v in (q.get("settles") or {}).values():
            if v is not None:
                st.add(float(v) / div)
        if q.get("settle") is not None:
            st.add(float(q["settle"]) / div)
        if q.get("close_kind") == "settle" and q.get("close") is not None:
            st.add(float(q["close"]) / div)
        tr = ctx["trades"].setdefault(fam, set())
        if q.get("close_kind") == "last" or q.get("settled") is False:
            for k in ("last", "close"):
                if q.get(k) is not None:
                    tr.add(float(q[k]) / div)
    for row in ((quote_strip or {}).get("quotes") or []):
        fam = str(row.get("key") or "").split("-")[0]
        if row.get("last") is None:
            continue
        if row.get("kind") == "settle":
            ctx["settles"].setdefault(fam, set()).add(float(row["last"]))
        else:
            ctx["trades"].setdefault(fam, set()).add(float(row["last"]))
        if row.get("prev") is not None:
            ctx["settles"].setdefault(fam, set()).add(float(row["prev"]))
    return ctx


def from_files(briefing, repo=REPO, today=None):
    try:
        with open(os.path.join(repo, "data", "prices.json")) as f:
            prices = json.load(f)
    except (OSError, ValueError):
        prices = {}
    return context(prices, issue_date(briefing, today), (briefing or {}).get("quote_strip"))


def _prices_with_family(sent):
    """[(price, family, grain, price_start)] tying each $ to the nearest
    commodity word before it (or after it, when none is before)."""
    words = [(m.start(), *family_of(m.group(1))) for m in _FAM_RE.finditer(sent)]
    out = []
    for m in PRICE.finditer(sent):
        before = [w for w in words if w[0] < m.start()]
        pick = before[-1] if before else (words[0] if words else None)
        if pick and pick[1]:
            out.append((_num(m), pick[1], pick[2], m.start()))
    return out


# ── the rules ──────────────────────────────────────────────────────────────

_EXPIRY_TALK = re.compile(r"\b(expir\w*|rolled|roll(?:s|ing)? (?:to|into)|stopped trading|went off the board|last trading day)\b", re.I)


def r_expired(sent, ctx):
    """A price that only an expired contract printed."""
    if _EXPIRY_TALK.search(sent):
        return False
    for px, fam, grain, _ in _prices_with_family(sent):
        dated = ctx["dated"].get(fam) or []
        dead = [k for k, v, exp in dated if exp and _near(px, v, grain)]
        live = [k for k, v, exp in dated if not exp and _near(px, v, grain)]
        if dead and not live:
            return True
    return False


CLOSE_WORD = re.compile(r"\b(clos(?:e|es|ed|ing)|settle(?:s|d|ment)?|finish(?:ed|es)?)\b(?!\s+(?:to|by|enough|call|watch|look)\b)", re.I)
_NOW_WORDS = re.compile(r"\b(overnight|this morning|so far|early trade|trading at|is at|are at|sits at|as of)\b", re.I)
_NOW_CLOSE = re.compile(r"\b(higher|lower|up|down|firmer|weaker)\s+close\b|\bclos(?:e|ed|ing)\s+(higher|lower|up|down)\b", re.I)


_PAST_DAY = re.compile(r"\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|yesterday|last week|the week|prior|previous)('s)?\b", re.I)


def _names_past_session(sent, w):
    """'Wednesday's settle', 'the prior close', 'a higher close Wednesday'."""
    before, after = sent[max(0, w.start() - 22):w.start()], sent[w.end():w.end() + 14]
    return bool(_PAST_DAY.search(before) or _PAST_DAY.match(after.strip()))


def r_close_before_settle(sent, ctx):
    """'Close' or 'settle' tied to a price that is a trade, not a settlement."""
    words = [w for w in CLOSE_WORD.finditer(sent)]
    if not words:
        return False
    prices = _prices_with_family(sent)
    for w in words:
        past = _names_past_session(sent, w)
        if prices:
            px, fam, grain, pos = min(prices, key=lambda p: abs(p[3] - w.start()))
            if past and abs(pos - w.start()) > 25:
                continue      # "close to Wednesday's settle": the settle has no price here
            trades, settles = ctx["trades"].get(fam) or set(), ctx["settles"].get(fam) or set()
            if any(_near(px, t, grain) for t in trades) and not any(_near(px, v, grain) for v in settles):
                return True
        elif not past and _NOW_WORDS.search(sent) and _NOW_CLOSE.search(sent):
            return True
    return False


RULES = [
    ("expired-contract", r_expired),
    ("close-before-settle", r_close_before_settle),
]


def lint(briefing, ctx):
    """[(rule, loc, sentence)] for every sentence that breaks a rule."""
    hits = []
    for loc, text in fields(briefing):
        for line in text.split("\n"):
            body = re.sub(r"^\s*-\s+", "", line)
            for s in sentences(body):
                plain = s.replace("**", "")
                for name, fn in RULES:
                    if fn(plain, ctx):
                        hits.append((name, loc, s))
    return hits


def _cut(text, bad):
    out = []
    for line in text.split("\n"):
        m = re.match(r"^(\s*-\s+)(.*)$", line)
        prefix, body = (m.group(1), m.group(2)) if m else ("", line)
        kept = [s for s in sentences(body) if s not in bad]
        new = " ".join(kept).strip()
        if new:
            out.append(prefix + new)
        elif not prefix and not body.strip():
            out.append(line)
    return "\n".join(out).strip()


def strip(briefing, ctx):
    """Cut every sentence lint finds, in the fields that can lose one. A field
    that would be left empty keeps its text (the gate decides). Returns
    (briefing, [log lines])."""
    log = []
    by_loc = {}
    for name, loc, s in lint(briefing, ctx):
        by_loc.setdefault(loc, []).append((name, s))
    for loc, items in by_loc.items():
        if not CUTTABLE(loc):
            continue
        text = _get(briefing, loc)
        new = _cut(text, {s for _, s in items})
        if not new:
            continue
        _set(briefing, loc, new)
        for name, s in items:
            log.append(f"{loc}: cut [{name}] {s!r}")
    return briefing, log


def gate_hits(briefing, ctx):
    """What briefing_gate blocks on: hits in fields strip can cut. A hit in a
    headline or title is left to the gate's WARN (there is no sentence to cut)."""
    return [h for h in lint(briefing, ctx) if CUTTABLE(h[1])]


# ── selftest: the real lines ───────────────────────────────────────────────

def _oct16_ctx():
    # data/prices.json as the Oct 16 issue read it (git 961b1109b68, 10:4x UTC)
    prices = {"quotes": {
        "hogs": {"ticker": "HE=F", "close": 75.55, "close_date": "2026-10-15"},
        "hogs-oct26": {"ticker": "HEV26.CME", "close": 75.55, "close_date": "2026-10-15"},
        "hogs-dec26": {"ticker": "HEZ26.CME", "close": 66.575, "close_date": "2026-10-15"},
        "hogs-feb27": {"ticker": "HEG27.CME", "close": 68.45, "close_date": "2026-10-15"},
    }}
    return context(prices, date(2026, 10, 16))


def _selftest():
    fails = []

    def expect(rule, sent, ctx, want):
        got = any(n == rule for n, _, _ in lint({"lead": sent}, ctx))
        if got != want:
            fails.append(f"{rule}: {'missed' if want else 'false hit'}: {sent!r}")

    c16 = _oct16_ctx()
    expect("expired-contract", "Hogs sat flat at $75.55, no fresh news to move them either way.", c16, True)
    expect("expired-contract", "December hogs, the front month since the October contract expired Oct 14, "
           "settled at $66.925 on Oct 16, up 35 cents.", c16, False)
    expect("expired-contract", "Lean hogs are at $66.575, with December now the front month.", c16, False)
    expect("expired-contract", "Live cattle gained 0.7% to $227.52 on cash hopes.", c16, False)

    # Oct 22: the strip read 6:00 AM CT, last trades; Wednesday's settle $4.63¼
    c22 = context({"quotes": {"corn-dec": {"close": 464.0, "close_kind": "last", "last": 464.0, "settled": False,
                                           "settles": {"2026-10-19": 467.0, "2026-10-20": 462.0, "2026-10-21": 463.25}}}},
                  date(2026, 10, 22),
                  {"quotes": [{"key": "corn-dec", "last": 4.64, "prev": 4.6325, "kind": "last"}]})
    expect("close-before-settle", "Dec corn is at **$4.64** overnight, up ¾ cent, the first higher close after a streak of lower ones.", c22, True)
    expect("close-before-settle", "Dec corn traded at **$4.64** overnight, ¾ cent above Wednesday's $4.63¼ settle.", c22, False)
    expect("close-before-settle", "Corn closed at $4.64 overnight.", c22, True)
    expect("close-before-settle", "Corn is up overnight after a higher close Wednesday.", c22, False)
    expect("close-before-settle", "Corn is up overnight, the first higher close in a week.", c22, True)
    expect("close-before-settle", "Corn settled Wednesday at $4.63¼, up 1¼ cents.", c22, False)
    expect("close-before-settle", "A close above $4.70 would turn the chart.", c22, False)
    expect("close-before-settle", "Corn is at $4.64, close to Wednesday's settle.", c22, False)

    # strip cuts the sentence and keeps the bullets
    b = {"sections": [{"title": "Cattle firm", "body": "- Live cattle gained 0.7% to **$227.52**.\n"
                       "- Hogs sat flat at $75.55, no fresh news to move them either way."}]}
    b, log = strip(b, c16)
    if b["sections"][0]["body"] != "- Live cattle gained 0.7% to **$227.52**." or len(log) != 1:
        fails.append(f"strip: {b['sections'][0]['body']!r} {log}")
    if sentences("Export sales at 7:30 a.m. CT. Corn is at $4.64.") != ["Export sales at 7:30 a.m. CT.", "Corn is at $4.64."]:
        fails.append("sentences: " + repr(sentences("Export sales at 7:30 a.m. CT. Corn is at $4.64.")))
    if "CLAIM LIMITS" not in PROMPT_RULES:
        fails.append("prompt rules missing")
    for f in fails:
        print("FAIL", f)
    print(f"daily_claims selftest: {'ok' if not fails else str(len(fails)) + ' failed'}")
    return 0 if not fails else 1


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(_selftest())
    b = json.load(open(sys.argv[1] if len(sys.argv) > 1 else os.path.join(REPO, "data", "daily.json")))
    for h in lint(b, from_files(b)):
        print("  [%s] %s: %r" % h)
