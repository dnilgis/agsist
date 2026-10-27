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
rewrite (strip: the sentence is cut, never reworded), and briefing_gate (a
data rule left blocks the send, a wording rule left is a warning).

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
    pr = (prices or {}).get("planting_ratio") or {}
    ctx = {"day": day, "dated": {}, "trades": {}, "settles": {},
           "crop_year": int(pr.get("crop_year") or (day.year + 1 if day.month >= 8 else day.year)),
           "planting_ratio": pr.get("value")}
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


_SERIES = re.compile(r"\b(straight|consecutive|in a row)\b", re.I)
_PAST_DAY = re.compile(r"\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|yesterday|last week|the week|prior|previous)('s)?\b", re.I)


def _names_past_session(sent, w):
    """'Wednesday's settle', 'the prior close', 'a higher close Wednesday'."""
    before, after = sent[max(0, w.start() - 22):w.start()], sent[w.end():w.end() + 14]
    return bool(_PAST_DAY.search(before) or _PAST_DAY.match(after.strip()))


# "down 6 straight days to $4.59½", "beans down 7 to $12.45": a run of lower
# (or higher) sessions ending at a price. Only read when the sentence counts a
# run (straight, in a row, streak), so "up 2 to $4.64" alone is not one.
_STREAK_TO = re.compile(r"\b(?:down|up|lower|higher)\s+(?:\d{1,2}|two|three|four|five|six|seven|eight|nine|ten|\w+th)\s+"
                        r"(?:(?:straight|consecutive)\s+)?(?:(?:days?|sessions?|closes?|settles?)\s+)?(?:in a row\s+)?"
                        r"(?:to|at)\s+(?=\$)", re.I)
_RUN = re.compile(r"\b(straight|consecutive|in a row|streak)\b", re.I)


def _streak_at_trade(sent, ctx):
    """A run of sessions counted to a price that is a trade (Oct 21 headline:
    the run was of settles, the price was the 5:46 a.m. trade)."""
    if not _RUN.search(sent):
        return False
    prices = _prices_with_family(sent)
    for m in _STREAK_TO.finditer(sent):
        hit = [p for p in prices if p[3] == m.end()]
        if not hit:
            continue
        px, fam, grain, _ = hit[0]
        trades, settles = ctx["trades"].get(fam) or set(), ctx["settles"].get(fam) or set()
        if any(_near(px, t, grain) for t in trades) and not any(_near(px, v, grain) for v in settles):
            return True
    return False


def r_close_before_settle(sent, ctx):
    """'Close' or 'settle' tied to a price that is a trade, not a settlement."""
    if _streak_at_trade(sent, ctx):
        return True
    words = [w for w in CLOSE_WORD.finditer(sent)]
    if not words:
        return False
    prices = _prices_with_family(sent)
    for w in words:
        if w.group(1).lower() in ("closes", "settles", "finishes") or _SERIES.search(sent[max(0, w.start() - 14):w.end() + 12]):
            continue          # "eight straight lower closes", "the eighth lower close in a row": past sessions
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


_MON_IDX = {m[:3]: i + 1 for i, m in enumerate(MONTHS)}
_KNOWN_CLOSE = re.compile(r"^\)?,?\s*(?:\$\s?[\d.,]+[¼½¾]?\*{0,2}\s+(?:close|settle|settlement|finish)"
                          r"|(?:close|settle|settlement|finish)\s+(?:of|at|was)\s+\$)", re.I)
_PAST_VERB = re.compile(r"\b(closed|settled|finished|came in|showed|rose|fell|gained|lost|was|were)\b", re.I)
_IFFY = re.compile(r"\b(if|would|could|should|may|might|will|watch|whether|expected|due)\b", re.I)


def _date_of(mon, dd, day):
    m = _MON_IDX.get(mon.lower()[:3])
    try:
        d = date(day.year, m, int(dd))
    except (TypeError, ValueError):
        return None
    if (d - day).days > 183:
        d = d.replace(year=d.year - 1)
    elif (day - d).days > 183:
        d = d.replace(year=d.year + 1)
    return d


def r_future_as_past(sent, ctx):
    """A date after the issue with a known close or a result attached."""
    for m in DATE_RE.finditer(sent):
        d = _date_of(m.group(1), m.group(2), ctx["day"])
        if d is None or d <= ctx["day"]:
            continue
        before, after = sent[max(0, m.start() - 4):m.start()], sent[m.end():m.end() + 40]
        possessive = bool(re.search(r"'s\s*\(?\s*$", before)) or after.startswith("'s")
        if possessive and _KNOWN_CLOSE.search(after.lstrip("'s")):
            return True
        pv = _PAST_VERB.search(after[:30])
        if pv and not _IFFY.search(sent[:m.end() + pv.start()]):
            return True
    return False


_HELD = re.compile(r"\b(every|each|your|a) bushels?\b|\b(?:every|each|your|a) (?:corn|soybean|bean|wheat) bushels?\b|\bbushels? (?:of [\w-]+ (?:corn|beans|soybeans|wheat) )?(?:sitting |stored )?in (?:the|your) bins?\b"
                   r"|\bin (?:the|your) bins?\b|\bstored (?:corn|beans|soybeans|wheat|grain)\b"
                   r"|\byour (?:corn|beans|soybeans|wheat|grain|crop)\b"
                   r"|\bcash (?:corn|beans|soybeans|wheat|grain|prices?|bids?|values?)\b", re.I)
_VALUE = re.compile(r"\b(worth|value[sd]?|lost|gained|cost(?:s|ing)? you|made you|added|richer|poorer|"
                    r"(?:up|down|higher|lower|more|less) (?:by )?(?:about |nearly |roughly )?\d+[¼½¾]? cents?|"
                    r"\d+[¼½¾]? cents? (?:more|less|higher|lower|a bushel|per bushel))\b", re.I)
_CASH_DATA = re.compile(r"\b(elevators?|posted|co-?ops?|locations|our (?:bid )?panel|bids? (?:at|from|posted))\b", re.I)
_HEDGED = re.compile(r"\b(depends|check (?:your|the)|local bid|your bid|basis decides)\b", re.I)


def r_cash_from_futures(sent, ctx):
    """A cash or per-bushel value for a farmer's grain, with no posted bid in sight."""
    return bool(_HELD.search(sent) and _VALUE.search(sent)
                and not _CASH_DATA.search(sent) and not _HEDGED.search(sent))


_PLANT = re.compile(r"\b(plant(?:ed|ing|s)?|acres?|acreage|next (?:spring|year|season)|next year's|rotation|"
                    r"seed(?:ing)? (?:decisions?|orders?)|switch(?:ing)? (?:to|acres))\b", re.I)
_FAVOR = re.compile(r"\b(favou?r(?:s|ed|ing)?|tilts?|pulls? acres|argues? for|pays? (?:more|better)|"
                    r"pencils? (?:out|better)|makes? (?:more )?sense|leans? toward|better bet|should plant|plant more)\b", re.I)
_FAVOR_CROP = re.compile(r"\bfavou?r(?:s|ed|ing)? (?:beans|soybeans|corn|wheat)\b", re.I)
_RATIO = re.compile(r"\b(\d\.\d{1,2})\b")


def _names_next_crop(sent, ctx):
    y = ctx["crop_year"]
    yy = r"(?:'|’)?%02d|%d" % (y % 100, y)
    if re.search(r"\b(?:Nov(?:ember)?|Dec(?:ember)?)\.?\s+(?:%s)\b" % yy, sent, re.I):
        return True
    if re.search(r"\b%d (?:crop|contracts?)\b|\bnew-crop %d\b" % (y, y), sent, re.I):
        return True
    pr = ctx.get("planting_ratio")
    return bool(pr and any(abs(float(m.group(1)) - float(pr)) <= 0.02 for m in _RATIO.finditer(sent)))


def r_planting_from_nearby(sent, ctx):
    """A planting or acreage call with no next-year contracts behind it."""
    call = _FAVOR_CROP.search(sent) or (_PLANT.search(sent) and _FAVOR.search(sent))
    return bool(call) and not _names_next_crop(sent, ctx)


_CAUSE = re.compile(r"\b(because|due to|driven by|thanks to|follows?|tends? to follow)\b(?![-\u2011])", re.I)
_CITED = re.compile(r"\b(says?|said|reports?|reported|according to|told|wrote|noted|estimated?s?|"
                    r"cited|per (?:the )?[A-Z][\w&.-]+)\b|\]\(https?://", re.I)


def r_cause_without_source(sent, ctx):
    """'Because', 'follows', 'driven by' with nobody named as saying so."""
    m = _CAUSE.search(sent)
    if not m:
        return False
    if m.group(1).lower().startswith("follow") and re.match(r"\s+(?:through|up|along)\b", sent[m.end():]):
        return False
    return not _CITED.search(sent)


RULES = [
    ("expired-contract", r_expired),
    ("close-before-settle", r_close_before_settle),
    ("future-as-past", r_future_as_past),
    ("cash-from-futures", r_cash_from_futures),
    ("planting-from-nearby", r_planting_from_nearby),
    ("cause-without-source", r_cause_without_source),
]


# read against the data, so briefing_gate blocks on them; the rest WARN there
BLOCKING = ("expired-contract", "close-before-settle", "future-as-past")


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
    expect("close-before-settle", "Soybeans are at $12.47, up 1¾ cents, after eight straight lower closes.", c22, False)
    expect("close-before-settle", "Corn is at $4.64, close to Wednesday's settle.", c22, False)

    # Oct 21 headline: the strip read 5:46 a.m. CT trades (corn $4.59½, beans $12.45);
    # Oct 20 settles $4.62 and $12.48¼ (data/daily-archive/2026-10-21.json quote_strip)
    c21 = context({}, date(2026, 10, 21),
                  {"quotes": [{"key": "corn-dec", "last": 4.595, "prev": 4.62, "kind": "last"},
                              {"key": "beans-nov", "last": 12.45, "prev": 12.4825, "kind": "last"}]})
    expect("close-before-settle", "Corn down 6 straight days to $4.59½; beans down 7 to $12.45", c21, True)
    expect("close-before-settle", "Beans down 7 straight sessions to $12.45 as harvest rolls on.", c21, True)
    expect("close-before-settle", "Corn settled lower 6 days straight, $4.62 on Oct 20; beans 7 days, $12.48¼", c21, False)
    expect("close-before-settle", "Corn down 6 straight days to $4.62; beans down 7 to $12.48¼", c21, False)
    expect("close-before-settle", "Corn is down 2½ cents to $4.59½ overnight.", c21, False)
    expect("close-before-settle", "Corn is up 2 to $4.59½ overnight after a six-day slide.", c21, False)

    # Oct 18 (a Sunday): Friday was Oct 16; Oct 23 was five days out
    c18 = context({}, date(2026, 10, 18))
    expect("future-as-past", "Cash cattle firm above Friday's (Oct 23) $227.55 close supports the rally; steady or lower fades it.", c18, True)
    expect("future-as-past", "October live cattle futures settled at $227.55 on Friday, Oct 16. A firmer cash cattle trade "
           "this week supports the rally; steady or lower cash fades it.", c18, False)
    expect("future-as-past", "Watch Friday's (Oct 23) close for a break of $230.", c18, False)
    expect("future-as-past", "Cattle on Feed, Friday, Oct 23, 2 p.m. CT.", c18, False)
    expect("future-as-past", "A close above $230 on Friday, Oct 23 would extend the rally.", c18, False)
    expect("future-as-past", "Placements on Oct 23 came in 4% below a year ago.", c18, True)
    expect("future-as-past", "Corn settled Oct 16 at $4.74¼.", c18, False)
    expect("future-as-past", "Dec 31 is the deadline.", context({}, date(2026, 1, 5)), False)

    # Oct 11: a 20½ cent December futures drop read as the value of stored corn
    c11 = context({}, date(2026, 10, 11))
    expect("cash-from-futures", "Every bushel of old-crop corn sitting in the bin is worth about 19 cents less than it was Thursday.", c11, True)
    expect("cash-from-futures", "December corn futures settled 20½ cents below Thursday. What that means for corn in the bin "
           "depends on your local bid and basis.", c11, False)
    expect("cash-from-futures", "That cost you 20 cents a bushel on unpriced corn in the bin.", c11, True)
    expect("cash-from-futures", "Cash corn is 15 cents lower this morning.", c11, True)
    expect("cash-from-futures", "Cash corn bids at 212 elevators averaged $4.12, down 6 cents.", c11, False)
    expect("cash-from-futures", "December corn futures fell 20½ cents.", c11, False)
    # Oct 21: the same claim with the crop named first
    expect("cash-from-futures", "A corn bushel is worth about 15 cents less than a week ago.", c11, True)
    expect("cash-from-futures", "Every bushel coming out of the field is being sold into a market that already has plenty.", c11, False)

    # Oct 25: a 2.8 ratio from Nov '26 beans and Dec '26 corn read as next spring's planting call
    c25 = context({"planting_ratio": {"crop_year": 2027, "value": 2.4697}}, date(2026, 10, 25))
    expect("planting-from-nearby", "That favors beans when acres are planned for next spring.", c25, True)
    expect("planting-from-nearby", "Those are this year's crop contracts; for next spring, compare next-crop bids and your costs.", c25, False)
    expect("planting-from-nearby", "A 2.8 ratio favors soybeans.", c25, True)
    expect("planting-from-nearby", "Nov '27 beans over Dec '27 corn is 2.47, which leans toward corn acres next spring.", c25, False)
    expect("planting-from-nearby", "The 2.47 planting ratio favors corn.", c25, False)
    expect("planting-from-nearby", "Farmers planted 95 million acres of corn this year.", c25, False)

    # Oct 25: crude up 3.8%, natural gas down 5.6%, and a cost claim nobody backed
    expect("cause-without-source", "Diesel and fertilizer costs follow crude, so higher oil matters for next season's input bills.", c25, True)
    expect("cause-without-source", "This issue did not check diesel or fertilizer prices, and crude's move alone does not show "
           "where input bills go.", c25, False)
    expect("cause-without-source", "Both markets are flat because USDA's record crop numbers are already priced in.", c25, True)
    expect("cause-without-source", "Goldman Sachs says freight rates gained to $20 a barrel because of the Hormuz shipping crisis.", c25, False)
    expect("cause-without-source", "Corn fell 4 cents driven by harvest pressure, Reuters reported.", c25, False)
    expect("cause-without-source", "Watch feeder cash trade for follow-through above $340.50.", c25, False)
    expect("cause-without-source", "WTI crude gained 3.8% to $103.27.", c25, False)

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
