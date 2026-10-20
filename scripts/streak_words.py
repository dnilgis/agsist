#!/usr/bin/env python3
"""
streak_words.py -- "third straight lower close" is counted by code, never by
the model.

WHY. The Oct 17 2026 Daily said Dec corn had "the third straight lower close".
The settles were 4.83 (Oct 12), 4.8275, 4.8075, 4.78, 4.7425 (Oct 16): Oct 16
was the fourth. A streak is a count, and a count is code's job.

WHAT IT DOES
  history(repo)        settles per crop for the front dated contract, from
                       data/harvest-prices.json (the October window's daily
                       settles) and data/prices.json (each quote's recent
                       settles), in dollars, by date.
  streaks(hist, upto)  per crop: direction ("lower"/"higher"), how many closes
                       in a row, the date it runs through. A streak that runs
                       back to the first settle on file is only "at least N",
                       so it is marked open and never printed as an ordinal.
  prompt_lines(st)     the streak lines the drafting model is handed.
  apply(briefing, st)  every "Nth straight lower close" (and "N straight
                       sessions lower", "in a row") in the prose is checked
                       against the count. Right: left alone. Wrong ordinal,
                       right direction, count known: the ordinal is corrected.
                       Anything else (count unknown, more than one crop in the
                       sentence, another contract month, the wrong direction):
                       the streak words come out ("a lower close").

    python3 scripts/streak_words.py --selftest
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)

# crop -> (prices.json front dated key prefix, harvest window ticker prefix, label)
CROPS = {
    "corn": ("corn-nearby", "ZC", "Dec corn"),
    "soybeans": ("beans-nearby", "ZS", "Nov soybeans"),
    "wheat": ("wheat-nearby", "ZW", "Dec wheat"),
}
MONTH_CODE = {"F": "Jan", "G": "Feb", "H": "Mar", "J": "Apr", "K": "May", "M": "Jun",
              "N": "Jul", "Q": "Aug", "U": "Sep", "V": "Oct", "X": "Nov", "Z": "Dec"}
CROP_WORD = {"corn": "corn", "soybeans": "soybeans", "wheat": "wheat"}

ORDS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth",
        "eleventh", "twelfth"]
NUMS = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"]
_ORD_RE = r"(?:%s|\d{1,2}(?:st|nd|rd|th))" % "|".join(ORDS)
_NUM_RE = r"(?:%s|\d{1,2})" % "|".join(NUMS)
DOWN = ("lower", "losing", "down", "negative")
UP = ("higher", "winning", "up", "positive", "gaining")
_DIR = r"(lower|higher|losing|winning|gaining|positive|negative|down|up)"
_SESS = r"(close|settle|session|day|finish)"
_SESSES = r"(closes|settles|sessions|days|finishes)"

# "the third straight lower close", "a fourth consecutive losing session"
P_ORD = re.compile(r"\b(the|a|an|its|their)\s+(%s)\s+(straight|consecutive)\s+%s\s+%s\b" % (_ORD_RE, _DIR, _SESS), re.I)
# "a second straight session lower"
P_ORD2 = re.compile(r"\b(the|a|an|its|their)\s+(%s)\s+(straight|consecutive)\s+%s\s+%s\b" % (_ORD_RE, _SESS, _DIR), re.I)
# "four straight lower closes", "three consecutive losing sessions"
P_NUM = re.compile(r"\b(%s)\s+(straight|consecutive)\s+%s\s+%s\b" % (_NUM_RE, _DIR, _SESSES), re.I)
# "lower for a third straight session", "down for the fourth day in a row"
P_FOR = re.compile(r"\b%s\s+for\s+(?:the|a)\s+(%s)\s+(?:(?:straight|consecutive)\s+%s|%s\s+in\s+a\s+row)\b"
                   % (_DIR, _ORD_RE, _SESS, _SESS), re.I)
# "down three sessions in a row", "lower four straight sessions"
P_ROW = re.compile(r"\b%s\s+(%s)\s+(?:%s\s+in\s+a\s+row|(?:straight|consecutive)\s+%s)\b"
                   % (_DIR, _NUM_RE, _SESSES, _SESSES), re.I)

CROP_RE = {
    "corn": re.compile(r"\bcorn\b", re.I),
    "soybeans": re.compile(r"\b(soybeans?|beans)\b(?!\s+(oil|meal))", re.I),
    "wheat": re.compile(r"\bwheat\b", re.I),
}
OTHER_MKT = re.compile(r"\b(soybean oil|soyoil|bean oil|meal|cattle|hogs|crude|oil|gold|silver|dollar|stocks|S&P|bitcoin|milk|oats)\b", re.I)
MONTH_WORD = re.compile(r"\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|"
                        r"Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\b\.?'?\s*(?:'?\d{2}\s+)?"
                        r"(corn|soybeans?|beans|wheat)\b", re.I)


def _n(word):
    w = word.lower()
    if w in ORDS:
        return ORDS.index(w) + 1
    if w in NUMS:
        return NUMS.index(w) + 1
    m = re.match(r"(\d{1,2})", w)
    return int(m.group(1)) if m else None


def _ord(n):
    if 1 <= n <= len(ORDS):
        return ORDS[n - 1]
    return "%d%s" % (n, "th" if 10 <= n % 100 <= 20 else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th"))


def _num(n):
    return NUMS[n - 1] if 1 <= n <= len(NUMS) else str(n)


def _load(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:  # noqa: BLE001
        return None


def history(repo=REPO, prices=None, harvest=None):
    """{crop: {"ticker", "month", "label", "settles": {date: dollars}}} for each
    crop's front dated contract. Missing data gives an empty settles map."""
    prices = prices if prices is not None else (_load(os.path.join(repo, "data", "prices.json")) or {})
    harvest = harvest if harvest is not None else (_load(os.path.join(repo, "data", "harvest-prices.json")) or {})
    quotes = prices.get("quotes") or {}
    out = {}
    for crop, (pkey, root, label) in CROPS.items():
        q = quotes.get(pkey) or {}
        ticker = str(q.get("ticker") or "")
        m = re.match(r"^(Z[CSW])([FGHJKMNQUVXZ])(\d{2})\.", ticker)
        settles = {}
        if m:
            for w in harvest.get("windows") or []:
                if str(w.get("ticker") or "") == ticker:
                    for p in w.get("series") or []:
                        if isinstance(p, dict) and isinstance(p.get("s"), (int, float)) and p.get("d"):
                            settles[p["d"]] = round(float(p["s"]), 4)
            for d, v in (q.get("settles") or {}).items():
                if isinstance(v, (int, float)):
                    settles.setdefault(d, round(float(v) / 100.0, 4))   # grains are quoted in cents
            mon = MONTH_CODE[m.group(2)]
            label = f"{mon} {CROP_WORD[crop]}"
        else:
            mon = None
        out[crop] = {"ticker": ticker, "month": mon, "label": label, "settles": settles}
    return out


def streak(settles, upto=None):
    """(direction, count, through, open) for the run of same-direction closes
    ending at the last settle on or before `upto`. open=True when the run
    reaches the first settle on file (the true count may be larger). None when
    fewer than two settles or the last change is zero."""
    days = sorted(d for d in settles if upto is None or d <= upto)
    if len(days) < 2:
        return None
    ch = [settles[days[i]] - settles[days[i - 1]] for i in range(1, len(days))]
    last = ch[-1]
    if abs(last) < 1e-9:
        return None
    sign = 1 if last > 0 else -1
    n = 0
    for c in reversed(ch):
        if (c > 1e-9 and sign > 0) or (c < -1e-9 and sign < 0):
            n += 1
        else:
            break
    return ("higher" if sign > 0 else "lower", n, days[-1], n == len(ch))


def streaks(hist, upto=None):
    out = {}
    for crop, h in (hist or {}).items():
        s = streak(h.get("settles") or {}, upto)
        if s:
            out[crop] = {"dir": s[0], "n": s[1], "through": s[2], "open": s[3],
                         "label": h.get("label"), "month": h.get("month")}
    return out


def prompt_lines(st):
    """Lines for the drafting model. Only closed counts are given as numbers."""
    rows = []
    for crop, s in sorted(st.items()):
        if s["open"]:
            rows.append(f"  {s['label']}: {s['dir']} close on {s['through']}; streak length not on file, "
                        f"do not write a streak count")
        elif s["n"] == 1:
            rows.append(f"  {s['label']}: {s['dir']} close on {s['through']}, the first {s['dir']} close after a "
                        f"move the other way (no streak)")
        else:
            rows.append(f"  {s['label']}: {s['n']} straight {s['dir']} closes through {s['through']} "
                        f"(the {_ord(s['n'])} straight {s['dir']} close)")
    if not rows:
        return ""
    return ("STREAKS, COUNTED BY CODE FROM THE SETTLES (write a streak count only from these; "
            "any other streak words are removed):\n" + "\n".join(rows))


def _same_dir(word, d):
    w = word.lower()
    return (w in DOWN and d == "lower") or (w in UP and d == "higher")


def _sentence_at(text, i):
    a = max(text.rfind(". ", 0, i), text.rfind("; ", 0, i), text.rfind("\n", 0, i))
    b_candidates = [x for x in (text.find(". ", i), text.find("; ", i), text.find("\n", i)) if x >= 0]
    b = min(b_candidates) if b_candidates else len(text)
    return text[a + 1 if a >= 0 else 0:b]


def _which(sentence, st):
    """The one crop the sentence is about, if it names exactly one grain and no
    other market, and any contract month it names is the front month."""
    hit = [c for c, rx in CROP_RE.items() if rx.search(sentence)]
    if len(hit) != 1 or OTHER_MKT.search(sentence):
        return None
    crop = hit[0]
    s = st.get(crop)
    if not s:
        return None
    for m in MONTH_WORD.finditer(sentence):
        if s.get("month") and m.group(1)[:3].lower() != s["month"][:3].lower():
            return None
    return crop


def fix_text(text, st):
    """text with its streak words checked. Returns (text, [log lines])."""
    if not isinstance(text, str) or not re.search(r"straight|consecutive|in a row", text, re.I):
        return text, []
    log = []

    def verdict(m, dirword, claimed):
        crop = _which(_sentence_at(text, m.start()), st)
        s = st.get(crop) if crop else None
        if not s or s["open"] or not _same_dir(dirword, s["dir"]) or s["n"] < 2:
            return None, crop
        return s["n"], crop

    def r_ord(m):
        art, ordw, how, dirw, noun = m.groups()
        n, crop = verdict(m, dirw, _n(ordw))
        if n is None:
            new = ("an " if dirw.lower()[0] in "aeiou" else "a ") + dirw + " " + noun
            if art[0].isupper():
                new = new[0].upper() + new[1:]
            log.append(f"streak words removed (not verified): {m.group(0)!r} -> {new!r}")
            return new
        if _n(ordw) == n:
            return m.group(0)
        new = f"{art} {_ord(n)} {how} {dirw} {noun}"
        log.append(f"streak corrected for {crop}: {m.group(0)!r} -> {new!r}")
        return new

    def r_ord2(m):
        art, ordw, how, noun, dirw = m.groups()
        n, crop = verdict(m, dirw, _n(ordw))
        if n is None:
            new = ("an " if dirw.lower()[0] in "aeiou" else "a ") + noun + " " + dirw
            if art[0].isupper():
                new = new[0].upper() + new[1:]
            log.append(f"streak words removed (not verified): {m.group(0)!r} -> {new!r}")
            return new
        if _n(ordw) == n:
            return m.group(0)
        new = f"{art} {_ord(n)} {how} {noun} {dirw}"
        log.append(f"streak corrected for {crop}: {m.group(0)!r} -> {new!r}")
        return new

    def r_num(m):
        numw, how, dirw, noun = m.groups()
        n, crop = verdict(m, dirw, _n(numw))
        if n is None:
            new = dirw + " " + noun
            log.append(f"streak words removed (not verified): {m.group(0)!r} -> {new!r}")
            return new
        if _n(numw) == n:
            return m.group(0)
        new = f"{_num(n)} {how} {dirw} {noun}"
        log.append(f"streak corrected for {crop}: {m.group(0)!r} -> {new!r}")
        return new

    def r_for(m):
        dirw, ordw = m.group(1), m.group(2)
        n, crop = verdict(m, dirw, _n(ordw))
        if n is None:
            log.append(f"streak words removed (not verified): {m.group(0)!r} -> {dirw!r}")
            return dirw
        if _n(ordw) == n:
            return m.group(0)
        new = m.group(0).replace(ordw, _ord(n), 1)
        log.append(f"streak corrected for {crop}: {m.group(0)!r} -> {new!r}")
        return new

    def r_row(m):
        dirw, numw = m.group(1), m.group(2)
        n, crop = verdict(m, dirw, _n(numw))
        if n is None:
            log.append(f"streak words removed (not verified): {m.group(0)!r} -> {dirw!r}")
            return dirw
        if _n(numw) == n:
            return m.group(0)
        new = m.group(0).replace(numw, _num(n), 1)
        log.append(f"streak corrected for {crop}: {m.group(0)!r} -> {new!r}")
        return new

    out = text
    for rx, fn in ((P_ORD, r_ord), (P_ORD2, r_ord2), (P_FOR, r_for), (P_NUM, r_num), (P_ROW, r_row)):
        text = out
        out = rx.sub(fn, out)
    return out, log


def apply(briefing, st):
    """Every prose string in the briefing, streak words checked. (briefing, log)."""
    log = []
    skip = {"locked_prices", "locked_changes", "chart_series", "edge", "board", "harvest_clock", "meta",
            "daily_quote", "cca_note"}

    def walk(v, path):
        if isinstance(v, str):
            new, lg = fix_text(v, st)
            log.extend(f"{path}: {x}" for x in lg)
            return new
        if isinstance(v, list):
            return [walk(x, f"{path}[{i}]") for i, x in enumerate(v)]
        if isinstance(v, dict):
            return {k: (x if k in skip else walk(x, f"{path}.{k}" if path else k)) for k, x in v.items()}
        return v
    return walk(briefing, ""), log


def from_files(repo=REPO, upto=None):
    return streaks(history(repo), upto)


# ── selftest ───────────────────────────────────────────────────────────────
def selftest():
    bad = []

    def ck(name, ok, got=""):
        print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  -- {got!r}"))
        if not ok:
            bad.append(name)
    hist = {"corn": {"ticker": "ZCZ26.CBT", "month": "Dec", "label": "Dec corn",
                     "settles": {"2026-10-09": 4.90, "2026-10-12": 4.83, "2026-10-13": 4.8275,
                                 "2026-10-14": 4.8075, "2026-10-15": 4.78, "2026-10-16": 4.7425}},
            "wheat": {"ticker": "ZWZ26.CBT", "month": "Dec", "label": "Dec wheat",
                      "settles": {"2026-10-14": 6.7325, "2026-10-15": 6.70, "2026-10-16": 6.605}}}
    st = streaks(hist, "2026-10-16")
    ck("corn: lower all the way back to the first settle on file is open (at least 5)",
       st["corn"]["n"] == 5 and st["corn"]["open"], st)
    hist["corn"]["settles"]["2026-10-09"] = 4.80
    st = streaks(hist, "2026-10-16")
    ck("corn: Oct 16 is the fourth straight lower close", st["corn"] == dict(st["corn"], dir="lower", n=4, through="2026-10-16", open=False), st["corn"])
    ck("wheat: run reaches the first settle on file, open", st["wheat"]["open"] and st["wheat"]["n"] == 2, st["wheat"])
    t, lg = fix_text("Dec corn settled at $4.74, the third straight lower close.", st)
    ck("third -> fourth", t == "Dec corn settled at $4.74, the fourth straight lower close." and lg, t)
    t, lg = fix_text("Corn posted its fourth straight lower close.", st)
    ck("right count left alone", t == "Corn posted its fourth straight lower close." and not lg, t)
    t2, _ = fix_text("Wheat posted the third straight lower close.", st)
    ck("open run: streak words come out", t2 == "Wheat posted a lower close.", t2)
    t, _ = fix_text("Corn and wheat both posted the third straight lower close.", st)
    ck("two crops in one sentence: streak words come out", t == "Corn and wheat both posted a lower close.", t)
    t, _ = fix_text("March corn posted the third straight lower close.", st)
    ck("another contract month: streak words come out", t == "March corn posted a lower close.", t)
    t, _ = fix_text("Corn posted the third straight higher close.", st)
    ck("wrong direction: streak words come out", t == "Corn posted a higher close.", t)
    t, _ = fix_text("Corn settled at $4.74, a second straight session lower.", st)
    ck("'a second straight session lower' corrected", t == "Corn settled at $4.74, a fourth straight session lower.", t)
    t, _ = fix_text("Crude at $98, its fourth straight positive session.", st)
    ck("crude has no count: 'positive session' kept, streak out", t == "Crude at $98, a positive session.", t)
    t, _ = fix_text("Corn fell three straight lower sessions.", st)
    ck("count form corrected", t == "Corn fell four straight lower sessions.", t)
    t, _ = fix_text("Corn is lower for a third straight session.", st)
    ck("'lower for a third straight session' corrected", t == "Corn is lower for a fourth straight session.", t)
    t, _ = fix_text("Corn is down three sessions in a row.", st)
    ck("'down three sessions in a row' corrected", t == "Corn is down four sessions in a row.", t)
    t, _ = fix_text("Cattle posted the third straight higher close.", st)
    ck("a market with no count: streak words come out", t == "Cattle posted a higher close.", t)
    t, _ = fix_text("Exports were the third straight weekly gain for corn.", st)
    ck("weekly words are not session streaks: left alone", t == "Exports were the third straight weekly gain for corn.", t)
    b, lg = apply({"lead": "Corn, the third straight lower close.", "locked_prices": {"corn": 4.74},
                   "sections": [{"body": "- Corn: the third straight lower close."}]}, st)
    ck("apply walks lead and sections", "fourth" in b["lead"] and "fourth" in b["sections"][0]["body"] and len(lg) == 2, b)
    pl = prompt_lines(st)
    ck("prompt line gives the count", "4 straight lower closes through 2026-10-16" in pl and "streak length not on file" in pl, pl)
    print("FAILS=%d" % len(bad))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(selftest() if "--selftest" in sys.argv else 0)
