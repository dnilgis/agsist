#!/usr/bin/env python3
"""
daily_fresh.py -- the Daily never says the same thing two days running (Sig,
Nov 1 2026: "the best morning email that people actually look forward to
reading every day"; never the same headline, number, story or fact twice).

WHY. The 14 issues Oct 19 to Nov 1 2026 (data/daily-archive):
  - Sunday reran Saturday word for word: Oct 31 and Nov 1 both led "Corn ends
    the week at $4.47¾; crude up 2.1% to $104.12"; Oct 24 and 25 nearly so.
  - The same number three times: 2.48 (Nov '27 beans to Dec '27 corn) on Oct 27,
    Oct 31 and Nov 1; "$2.4 billion" extra diesel cost on Oct 28 and 29.
  - The same story: the Senate farm bill score on Oct 31 and Nov 1; the Texas
    elk screwworm case on Oct 23 and again Oct 25.
  - 11 of the 14 headlines start "Corn ...".
The writer was shown three past headlines and nothing else, so it could not know.

WHAT. One definition, used by the generator (prompt block, the one send-back and
the cut), the gate (what is left is a warning, never a hold: Sig, Nov 1) and the replay.
Sig, Nov 2: "cut the repeat": what still repeats after the one rewrite does not ship
(cut_repeats); the email still always goes out.
  recent(today, archive_dir, n)   the last n issues before today, oldest first
  memory_block(recent)            "ALREADY SAID THIS WEEK" for the writer's prompt
  hits(briefing, recent, today)   [(kind, loc, why)] for every repeat found
  correction(found)               the send-back text, reasons quoted
  drop_stories(briefing, found)   cut the news items that still repeat
  cut_repeats(briefing, found, rec, today)  cut every repeat that can be cut (see the kinds)

THE KINDS and what each one does:
  headline   a headline too close to one of the last 7 (HEADLINE_SIM). Sent back once, then replaced by
             the top story's title (never the board); with no story left, a warning.
  weekend    a Saturday or Sunday headline built on the board (a price, a
             percent or a cents move that is on the locked board) or too close
             to the last weekday headline (WEEKEND_SIM). No new settle comes on a
             weekend, so it can only rerun Friday. Sent back once, then a warning.
  number     the day's number (one_number) has a value used in the last 7 days
             for the same kind of thing (its unit shares a word). Sent back once, then cut.
  story      a news item whose title tells a story from the last 7 days
             (STORY_SIM) with nothing new in its title (no number or count that
             the old one lacked). Since Nov 2 also: its title and body tell an item
             of the last 7 days (STORY_TEXT_SIM) with no new development
             (new_development), or its title was already said in a sentence
             (SAID_SIM). The generator cuts it after the one rewrite.
  sentence   a sentence of the lead, a section or a news body that says again
             what one sentence of the last 7 issues said (SAID_SIM, no number the
             old one lacked). Cut after the one rewrite, unless it is the field's
             only sentence.
  same-lead  the headline leads with the same market as each of the last 3
             issues. Sent back once, never held (a warning at the gate).

THE THRESHOLDS, measured on the whole archive (Mar 4 to Nov 1 2026, 234 issues):
  HEADLINE_SIM 0.5: share of words two headlines have in common (numbers count,
    little words do not). Of 1,555 headline pairs within 7 days, 7 reach 0.5:
    1.00 Nov 1/Oct 31, 0.78 Oct 25/Oct 24, 0.78 Jul 26/25, 0.75 Sep 6/4,
    0.67 Apr 14/10 ("Grains drift/steady as planting window opens"), 0.57 Apr 10/6,
    0.50 Jul 6/3 ("Corn breaks 4% again; oats ..."), every one a rerun. The next
    pairs (0.45) are the same weekly template with new numbers.
  WEEKEND_SIM 0.3: a weekend headline vs the weekday issue before it. Oct 24 vs
    Oct 23 is 0.33 and is Friday's corn $4.56 and crude 3.8% again.
  STORY_SIM 0.5: rare words count more (weights from every news title in the
    archive). 389 titles, 6,608 pairs within 7 days: the pairs at 0.5 and up are
    the same story retold (Texas elk 0.50, farm bill 1.00, NRCS cuts 0.79 to 1.00);
    below 0.45 they are new turns (Arizona's first case 0.45, Senate Ag vote vs
    meeting notice 0.46).

  SAID_SIM 0.8: share of a new sentence's weighted words found in one sentence of
    the last 7 issues, numbers no newer (Sep 1 to Nov 2 2026). At 0.8 and up the
    pairs are retellings (the Cargill lockout line, "Natural gas fell 5.6% to $2.64"
    twice, Saturday's corn settle on Sunday, AgWeb's "healthy correction"); from
    0.7 to 0.8 they are mostly watch-list boilerplate, which is not cut.
  STORY_TEXT_SIM 0.5: title and body against title and body. Above it: the
    Arizona screwworm case retold Nov 2 (0.58), FTC fertilizer probe, rail merger,
    Theileria; a new state or a new count not retold in the body is a development.

    python3 scripts/daily_fresh.py --selftest      (the real archive pairs above)
    python3 scripts/daily_fresh.py --replay        (Oct 19 to Nov 1: what would go back)
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import datetime as dt
import glob
import json
import math
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
ARCHIVE = os.path.join(REPO, "data", "daily-archive")

WINDOW = 7
HEADLINE_SIM = 0.5
WEEKEND_SIM = 0.3
STORY_SIM = 0.5
NEW_TURN_MAX = 0.8          # above this a title is a retelling even with a new number
SAME_LEAD_RUN = 3
SAID_SIM = 0.8              # share of a sentence's (weighted) words already said in one sentence this week
STORY_TEXT_SIM = 0.5        # title + body against an older item's title + body: the same story
HARD = ("headline", "weekend", "number")      # sent back once; then cut_repeats (Sig, Nov 2: "cut the repeat")
CUT = ("story", "sentence")                   # sent back once, then cut by the generator
SOFT = ("same-lead",)                         # sent back once, a warning after
# where a repeated sentence may be cut (the headline and titles never are; a field is never emptied)
SENTENCE_LOCS = re.compile(r"^(lead|sections\[\d+\]\.(body|so_what)|outside_the_pit\[\d+\]\.body)$")
US_STATES = set("alabama alaska arizona arkansas california colorado connecticut delaware florida georgia hawaii "
                "idaho illinois indiana iowa kansas kentucky louisiana maine maryland massachusetts michigan "
                "minnesota mississippi missouri montana nebraska nevada ohio oklahoma oregon pennsylvania "
                "tennessee texas utah vermont virginia washington wisconsin wyoming".split())

STOP = set("a an the to of in on at as and for with after its it is by from into over than this that be are "
           "was were new s".split())
GENERIC_UNIT = set("price prices per bushel bushels year years us u.s week weeks day days month total cost "
                   "costs rate".split())
NUMWORD = set("first second third fourth fifth sixth seventh eighth ninth tenth two three four five six seven "
              "eight nine ten eleven twelve dozen hundred thousand million billion".split())
WEEKDAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
_TOK = re.compile(r"[a-z0-9$][a-z0-9$.,'%¼½¾¢/-]*")
_PRICE = re.compile(r"\$\s?(\d[\d,]*(?:\.\d+)?)\s?([¼½¾])?(?!\s?(?:billion|million|trillion|[bmk]\b))", re.I)
_PCT = re.compile(r"(\d+(?:\.\d+)?)\s?%")
_CENTS = re.compile(r"(\d+(?:\.\d+)?)?\s?([¼½¾])?\s?(?:¢|cents?\b)", re.I)
_FRAC = {"¼": .25, "½": .5, "¾": .75}
# a board word and the locked keys it may stand for
BOARD = (
    (r"corn", ("corn", "corn-dec")), (r"soy\w*|beans?", ("beans", "beans-nov")), (r"wheat", ("wheat",)),
    (r"oats", ("oats",)), (r"live cattle|cattle", ("cattle",)), (r"feeders?", ("feeders",)),
    (r"hogs?", ("hogs",)), (r"milk", ("milk",)), (r"meal", ("meal",)), (r"soy(?:bean)? oil|soyoil", ("soyoil",)),
    (r"crude|wti|oil", ("crude",)), (r"natural gas|nat gas|gas", ("natgas",)), (r"gold", ("gold",)),
    (r"silver", ("silver",)), (r"dollar", ("dollar",)), (r"s&p|stocks", ("sp500",)), (r"bitcoin", ("bitcoin",)),
)
GRAINS = {"corn", "corn-dec", "beans", "beans-nov", "wheat", "oats"}
LEAD_WORD = re.compile(r"^\W*(corn|soybeans?|beans|wheat|oats|grains?|cattle|live cattle|feeders?|hogs?|"
                       r"crude|oil|milk|dairy|gold|natural gas)\b", re.I)


# ── words ───────────────────────────────────────────────────────────────────
def toks(s):
    """Lower-case words of a title or headline, little words dropped, numbers
    kept as written ("4.47¾", "2.1%"), a leading $ dropped."""
    s = str(s or "").lower().replace("’", "'").replace("‘", "'")
    out = set()
    for t in _TOK.findall(s):
        t = t.strip(".,'/-").lstrip("$")
        if t.endswith("'s"):
            t = t[:-2]
        if t and t not in STOP:
            out.add(t)
    return out


def jaccard(a, b):
    A, B = toks(a), toks(b)
    return len(A & B) / len(A | B) if (A | B) else 0.0


def _is_count(t):
    return bool(re.search(r"\d", t)) or t in NUMWORD


_IDF = {}


def idf_table(archive_dir=ARCHIVE):
    """Word weights from every news title in the archive: a word in few titles
    (screwworm, lame-duck) weighs more than one in many (usda, farm)."""
    key = os.path.abspath(archive_dir)
    if key in _IDF:
        return _IDF[key]
    df, n = {}, 0
    for f in glob.glob(os.path.join(archive_dir, "????-??-??.json")):
        try:
            with open(f, encoding="utf-8") as fh:
                d = json.load(fh)
        except Exception:
            continue
        for it in d.get("outside_the_pit") or []:
            if isinstance(it, dict) and it.get("title"):
                n += 1
                for w in toks(it["title"]):
                    df[w] = df.get(w, 0) + 1
    _IDF[key] = (df, n)
    return df, n


def story_sim(a, b, archive_dir=ARCHIVE):
    """Weighted share of the shorter title's words that the other title has."""
    df, n = idf_table(archive_dir)
    w = lambda t: math.log((n + 1) / (df.get(t, 0) + 1)) + 1
    A, B = toks(a), toks(b)
    if not A or not B:
        return 0.0
    return sum(w(t) for t in A & B) / min(sum(w(t) for t in A), sum(w(t) for t in B))


def new_turn(title, old):
    """The title carries a number or a count the old title does not (a second
    case, a vote count, a new dollar figure): something new happened."""
    return any(_is_count(t) for t in toks(title) - toks(old))


def said(s, o, archive_dir=ARCHIVE):
    """Weighted share of sentence s's words that sentence o already has (rare words weigh more)."""
    df, n = idf_table(archive_dir)
    w = lambda t: math.log((n + 1) / (df.get(t, 0) + 1)) + 1
    A, B = toks(s), toks(o)
    if not A:
        return 0.0
    return sum(w(t) for t in A & B) / sum(w(t) for t in A)


_FIG = re.compile(r"\d+(?:[.,]\d+)?[¼½¾]?")


def figures(s):
    """The numbers a sentence carries, as written ("4.47¾", "105", "2.48")."""
    return set(_FIG.findall(str(s or "").replace(",", "")))


def _sentences(b):
    """[(loc, sentence)] for every reader-facing sentence of an issue (daily_claims.fields)."""
    import daily_claims
    out = []
    for loc, text in daily_claims.fields(b):
        for line in str(text).split("\n"):
            for x in daily_claims.sentences(re.sub(r"^\s*-\s+", "", line)):
                out.append((loc, x.replace("**", "")))
    for it in _stories(b):
        out.append(("title", it["title"]))
    return out


def new_development(it, old):
    """A news item tells something new about an older one: a count or number in its title the old item's
    text lacks, without its own body retelling the old event (Nov 2 2026: "Screwworm found in Arizona,
    third state affected" said in its body "USDA confirmed the first Arizona case", the Oct 29 story), or a
    state the old item never named."""
    old_text = "%s %s" % (old.get("title") or "", old.get("body") or "")
    new_t, old_t = toks(it.get("title")), toks(old_text)
    if (new_t - old_t) & US_STATES:
        return True
    fresh = [t for t in new_t - old_t if _is_count(t)]
    if not fresh:
        return False
    old_counts = {t for t in toks(old.get("title")) if _is_count(t)}
    return not (old_counts & toks(it.get("body")))


def sentence_repeats(briefing, rec, archive_dir=ARCHIVE):
    """[(loc, sentence, day, old)] for each sentence that says again what one sentence of the last issues
    said: SAID_SIM of its words, and no number the old one lacked (Nov 2 2026: "AgWeb asked whether the drop
    is more than a healthy correction" ran Oct 31, Nov 1 and Nov 2). Short lines and notes in brackets are not
    judged."""
    olds = [(b, x) for b in rec for _l, x in _sentences(b)]
    out = []
    for loc, x in _sentences(briefing):
        if not SENTENCE_LOCS.match(loc) or len(toks(x)) < 6 or x.lstrip().startswith("("):
            continue
        fx = figures(x)
        best = None
        for b, o in olds:
            if fx - figures(o):
                continue
            v = said(x, o, archive_dir)
            if v >= SAID_SIM and (best is None or v > best[0]):
                best = (v, b, o)
        if best:
            out.append((loc, x, _day(best[1]), best[2]))
    return out


def norm_value(v):
    s = str(v or "").lower().replace(",", "").replace("$", "").strip()
    s = re.sub(r"\s+", " ", s)
    return s.rstrip(".")


def _unit_words(u):
    return {t for t in toks(u) if not _is_count(t) and t not in GENERIC_UNIT and len(t) > 2}


# ── the archive ─────────────────────────────────────────────────────────────
def issue_date(briefing, today=None):
    """The issue's own date: its 'date' line ('Sunday, November 1, 2026'),
    else today."""
    raw = str((briefing or {}).get("date") or "").strip()
    for fmt in ("%A, %B %d, %Y", "%B %d, %Y", "%Y-%m-%d"):
        try:
            return dt.datetime.strptime(raw if fmt != "%Y-%m-%d" else raw[:10], fmt).date()
        except ValueError:
            continue
    return today or dt.date.today()


def recent(today, archive_dir=ARCHIVE, n=WINDOW):
    """The last n archived issues dated before today (oldest first), each with
    its "_date". Issues older than n + 2 days are not "this week"."""
    out = []
    for f in sorted(glob.glob(os.path.join(archive_dir, "????-??-??.json"))):
        try:
            d = dt.date.fromisoformat(os.path.basename(f)[:10])
        except ValueError:
            continue
        if not (today - dt.timedelta(days=n + 2) <= d < today):
            continue
        try:
            with open(f, encoding="utf-8") as fh:
                b = json.load(fh)
        except Exception:
            continue
        if isinstance(b, dict):
            b = dict(b, _date=d.isoformat())
            out.append(b)
    return out[-n:]


def _day(b):
    try:
        d = dt.date.fromisoformat(b["_date"])
    except (KeyError, ValueError):
        return str(b.get("_date") or "")
    return "%s %s %d" % (WEEKDAYS[d.weekday()], d.strftime("%b"), d.day)


def _stories(b):
    return [it for it in (b.get("outside_the_pit") or []) if isinstance(it, dict) and it.get("title")]


def _num(b):
    on = b.get("one_number")
    if isinstance(on, dict) and on.get("value"):
        return str(on.get("value")).strip(), str(on.get("unit") or "").strip()
    return None


# ── the prompt block ────────────────────────────────────────────────────────
def memory_block(rec):
    """What the reader already read this week, for the writer."""
    if not rec:
        return ""
    lines = ["ALREADY SAID THIS WEEK (the last %d issues; the same readers read every one):" % len(rec)]
    for b in reversed(rec):
        lines.append("  %s" % _day(b))
        if b.get("headline"):
            lines.append("    headline: %s" % b["headline"])
        n = _num(b)
        if n:
            lines.append("    number: %s (%s)" % n)
        st = _stories(b)
        if st:
            lines.append("    news: " + " | ".join(it["title"] for it in st))
        secs = [s.get("title") for s in (b.get("sections") or []) if isinstance(s, dict) and s.get("title")]
        if secs:
            lines.append("    sections: " + "; ".join(secs))
    lines += [
        "RULE: none of the above is said again. Not the same headline, not the same number, not the same news story, "
        "not the same section angle, unless something new happened since; then the NEW part leads (a new number, a "
        "new state, a vote, a date) and the old part is at most a clause. A machine compares your draft with this "
        "list: a headline too close to one of them, a number already used this week, or a story already told sends "
        "the draft back once with the reason; a repeat still there after that is cut before the send.",
        "Do not lead with the same market as the last three issues did. On a quiet day lead with the most useful news "
        "story or the biggest mover, not corn by habit.",
    ]
    return "\n".join(lines)


# ── the check ───────────────────────────────────────────────────────────────
def _price_val(m):
    v = float(m.group(1).replace(",", ""))
    if m.group(2):
        v += _FRAC[m.group(2)] / 100.0
    return v


def board_figures(text, locked_prices, locked_changes):
    """The board figures a headline carries: [(key, what)] for each $ price,
    percent or cents move in it that matches a locked price or change of a
    board word it names. A $4.4 billion score or a 5% placement estimate is
    not on the board and is not returned."""
    t = str(text or "")
    tl = t.lower()
    keys = []
    for rx, ks in BOARD:
        if re.search(r"\b(?:" + rx + r")\b", tl):
            keys += [k for k in ks if k in (locked_prices or {})]
    out = []
    for k in keys:
        lp = (locked_prices or {}).get(k)
        ch = (locked_changes or {}).get(k) or {}
        try:
            lp = float(lp)
        except (TypeError, ValueError):
            continue
        for m in _PRICE.finditer(t):
            v = _price_val(m)
            if abs(v - lp) <= max(0.01, abs(lp) * 0.0075) or (ch.get("prev") and abs(v - float(ch["prev"])) <= abs(lp) * 0.0075):
                out.append((k, m.group(0).strip()))
        pct = ch.get("pct")
        for m in _PCT.finditer(t):
            if pct is not None and abs(float(m.group(1)) - abs(float(pct))) <= 0.15:
                out.append((k, m.group(0)))
        if k in GRAINS and ch.get("prev") is not None:
            moved = abs(lp - float(ch["prev"])) * 100
            for m in _CENTS.finditer(t):
                if not (m.group(1) or m.group(2)):
                    continue
                c = float(m.group(1) or 0) + _FRAC.get(m.group(2) or "", 0)
                if abs(c - moved) <= 0.3:
                    out.append((k, m.group(0).strip()))
    seen, uniq = set(), []
    for x in out:
        if x not in seen:
            seen.add(x)
            uniq.append(x)
    return uniq


def lead_market(headline):
    m = LEAD_WORD.match(str(headline or ""))
    if not m:
        return ""
    w = m.group(1).lower()
    return {"soybean": "beans", "soybeans": "beans", "grain": "grains", "live cattle": "cattle",
            "feeder": "feeders", "hog": "hogs", "oil": "crude"}.get(w, w)


def hits(briefing, rec, today=None, archive_dir=ARCHIVE, locked_prices=None, locked_changes=None):
    """[(kind, loc, why)] for every repeat of the last issues in this draft."""
    today = today or issue_date(briefing)
    lp = locked_prices if locked_prices is not None else (briefing.get("locked_prices") or {})
    lc = locked_changes if locked_changes is not None else (briefing.get("locked_changes") or {})
    found = []
    head = str(briefing.get("headline") or "").strip()
    if head:
        best = max(((jaccard(head, b.get("headline")), b) for b in rec if b.get("headline")),
                   key=lambda x: x[0], default=(0, None))
        if best[1] is not None and best[0] >= HEADLINE_SIM:
            found.append(("headline", "headline", "too close to %s's headline %r (%d%% the same words)"
                          % (_day(best[1]), best[1]["headline"], round(best[0] * 100))))
        if today.weekday() >= 5:
            figs = board_figures(head, lp, lc)
            if figs:
                found.append(("weekend", "headline", "a %s headline built on the board (%s); no new settle comes on a "
                              "weekend, so it can only rerun Friday's market. Lead with the top news story, the week "
                              "ahead or a feature" % (today.strftime("%A"), ", ".join(dict.fromkeys(w for _, w in figs)))))
            else:
                wk = [b for b in rec if dt.date.fromisoformat(b["_date"]).weekday() < 5]
                if wk and wk[-1].get("headline"):
                    s = jaccard(head, wk[-1]["headline"])
                    if s >= WEEKEND_SIM and not (found and found[0][0] == "headline"):
                        found.append(("weekend", "headline", "reruns %s's headline %r (%d%% the same words)"
                                      % (_day(wk[-1]), wk[-1]["headline"], round(s * 100))))
        lm = lead_market(head)
        if lm and len(rec) >= SAME_LEAD_RUN and all(lead_market(b.get("headline")) == lm for b in rec[-SAME_LEAD_RUN:]):
            found.append(("same-lead", "headline", "leads with %s for the %s issue running; lead with the day's "
                          "top story or its biggest mover" % (lm, "fourth" if SAME_LEAD_RUN == 3 else "next")))
    n = _num(briefing)
    if n and norm_value(n[0]):
        for b in reversed(rec):
            p = _num(b)
            if p and norm_value(p[0]) == norm_value(n[0]) and (_unit_words(n[1]) & _unit_words(p[1])
                                                                or not _unit_words(n[1]) or not _unit_words(p[1])):
                found.append(("number", "one_number.value", "%s (%s) was the number on %s already; pick a fresh one"
                              % (n[0], n[1], _day(b))))
                break
        else:
            # the same FACT with a new value (Nov 9 2026: -72,318 then 8,795 off one CFTC release)
            nf = number_fact(briefing.get("one_number"))
            if nf:
                go, why = still_news(nf, memory_from(rec), today)
                if not go:
                    found.append(("number", "one_number.value", "%s (%s): %s; pick another number" % (n[0], n[1], why)))
    for i, it in enumerate(_stories(briefing)):
        best = None
        for b in rec:
            for old in _stories(b):
                s = story_sim(it["title"], old["title"], archive_dir)
                if s >= STORY_SIM and (best is None or s > best[0]):
                    best = (s, b, old)
        if best and not (best[0] < NEW_TURN_MAX and new_turn(it["title"], best[2]["title"])):
            found.append(("story", "outside_the_pit[%d]" % i, "%r retells %s's %r with nothing new in the title"
                          % (it["title"], _day(best[1]), best[2]["title"])))
            continue
        # Sig, Nov 2: a story already reported in the last 7 days is a repeat unless its title has a new
        # development, whether it ran as a news item or inside a section.
        text = "%s %s" % (it["title"], it.get("body") or "")
        best = None
        for b in rec:
            for old in _stories(b):
                s = story_sim(text, "%s %s" % (old["title"], old.get("body") or ""), archive_dir)
                if s >= STORY_TEXT_SIM and not new_development(it, old) and (best is None or s > best[0]):
                    best = (s, b, old["title"])
            for _l, o in _sentences(b):
                if not (figures(it["title"]) - figures(o)) and said(it["title"], o, archive_dir) >= SAID_SIM:
                    best = best or (1.0, b, o)
        if best:
            found.append(("story", "outside_the_pit[%d]" % i, "%r was already reported %s: %r"
                          % (it["title"], _day(best[1]), best[2][:120])))
    for loc, x, day, o in sentence_repeats(briefing, rec, archive_dir):
        found.append(("sentence", loc, "%r says again what %s said: %r" % (x[:120], day, o[:120])))
    return found


def correction(found):
    if not found:
        return ""
    lines = ["CORRECTION: YOUR DRAFT REPEATS WHAT THIS WEEK'S ISSUES ALREADY SAID. The same readers read those. "
             "These are the repeats:"]
    lines += ["  - %s: %s" % (loc, why) for _k, loc, why in found]
    lines.append("Rewrite those parts with something that is new today (see ALREADY SAID THIS WEEK). Keep "
                 "every other rule. A news item stays only if its title says what is new since it last ran.")
    return "\n".join(lines)


def drop_stories(briefing, found):
    """Cut the news items still flagged as a story repeat. Returns the log."""
    idx = {int(re.search(r"\[(\d+)\]", loc).group(1)) for k, loc, _ in found if k == "story"}
    if not idx:
        return []
    items = briefing.get("outside_the_pit") or []
    log = ["cut repeat story %r" % items[i].get("title") for i in sorted(idx) if i < len(items)]
    briefing["outside_the_pit"] = [it for i, it in enumerate(items) if i not in idx]
    return log


def headline_from_story(briefing):
    """A headline that is not the board: the top story's title, or None when no story is left."""
    for it in _stories(briefing):
        t = str(it["title"]).strip().rstrip(".")
        if t:
            return t
    return None


def story_line(briefing):
    """The top story's one line, for the teaser when the headline became that story; None when it has none."""
    for it in _stories(briefing):
        t = str(it.get("title") or "").strip()
        if t:
            ln = str(it.get("body") or it.get("line") or "").strip()
            return ln or None
    return None


def cut_repeats(briefing, found, rec, today=None, archive_dir=ARCHIVE, locked_prices=None, locked_changes=None):
    """Sig, Nov 2 2026: "cut the repeat". After the one rewrite, a repeat that is still there does not ship,
    and the email still goes out:
      story     the news item is cut (drop_stories)
      sentence  the sentence is cut, unless it is the field's only sentence
      number    the day's number (one_number) is cut
      headline, weekend  the headline becomes the top story's title (not the board); with no story left it
                stays, and the gate warns
    Returns (found still there, log)."""
    import daily_claims
    log = drop_stories(briefing, found)
    if any(k == "number" for k, _, _ in found) and briefing.get("one_number"):
        log.append("cut repeat number %r" % (briefing["one_number"] or {}).get("value"))
        briefing.pop("one_number", None)
    if any(k == "sentence" for k, _, _ in found):
        by_loc = {}
        for loc, x, _d, _o in sentence_repeats(briefing, rec, archive_dir):
            by_loc.setdefault(loc, set()).add(x)
        for loc, bad in by_loc.items():
            text = daily_claims._get(briefing, loc)
            if not isinstance(text, str):
                continue
            cut = daily_claims._cut(text, {r for r in _raw_sentences(text) if r.replace("**", "") in bad})
            if cut.strip():
                daily_claims._set(briefing, loc, cut)
                log += ["cut repeat sentence in %s: %r" % (loc, b[:100]) for b in sorted(bad)]
            else:
                log.append("kept the only sentence of %s (a repeat, a warning)" % loc)
    if any(k in ("headline", "weekend") for k, _, _ in found):
        h = headline_from_story(briefing)
        if h:
            log.append("headline %r repeats; replaced by the top story %r" % (briefing.get("headline"), h))
            briefing["headline"] = h
            # the teaser was written for the old headline; it follows the new one (the story's own line)
            line = story_line(briefing)
            if line:
                log.append("teaser %r follows the new headline: %r" % (briefing.get("teaser"), line))
                briefing["teaser"] = line
    left = hits(briefing, rec, today or issue_date(briefing), archive_dir, locked_prices, locked_changes)
    return left, log


def _raw_sentences(text):
    import daily_claims
    out = []
    for line in str(text).split("\n"):
        out += daily_claims.sentences(re.sub(r"^\s*-\s+", "", line))
    return out


def stamp(found, tries):
    """What the generator records in briefing["freshness"] (the gate checks any
    issue that carries it)."""
    return {"window": WINDOW, "tries": tries, "hits": [{"kind": k, "loc": l, "why": w} for k, l, w in found]}


# ── one memory for the lines the code writes (Daily panel, Nov 9 2026) ───────
# The checks above read the writer's prose and compare VALUES, so the same fact
# with a new value passed: funds' corn position -72,318 (Sat Nov 7) then 8,795
# (Mon Nov 9) off one CFTC release; the new-crop ratio 2.48 (Oct 31, Nov 1) then
# 2.43 (Nov 8); feeders at the 74th percentile Nov 7, 8 and 9; and the builder's
# own lines (the Today list, Only here, the web page's Only on AGSIST) never met
# a check at all. Now every recurring line is a FACT, {kind, key, value, text},
# and prints only when that fact changed since the issue that last printed it:
#   funds        once per CFTC release, Saturday only: none printed in the 6 days before
#   ratio        a band cross (RATIO_BANDS) or a move of RATIO_MOVE or more
#   percentile   a band cross (PCT_BANDS) or a move of PCT_MOVE points or more; never printed, only
#                from the bottom or top tenth (the middle band is a standing fact)
#   basis_wow    a state enters, leaves or moves WOW_MOVE cents (wow_should_print)
#   land_sales   a ZIP reader's farm sales line, by month and state (daily_land_line.state_fact): a new month,
#                or the state's count for the month above the last printed (a re-read that drops a
#                duplicate is no news: Indiana 193 then 191, Nov 5 and 9 2026)
#   rain_rank    the record sentence on a ZIP reader's rain line, by county (only_here._record_rank):
#                a new value, the county entering the top three or changing place (anything else, below)
#   rain_line    a ZIP reader's rain line, by the station's county (only_here.rain_fact): a new value, so a
#                station that has not reported since gives no line (anything else, below)
#   rain_records the no-ZIP rain records line: the two counts or the oldest record changed (Nov 9 and 10
#                2026 went out word for word: the lines are computed at send time and were never remembered)
#   anything else  a new value (the same key with the same value is a repeat)
# The memory is what went out: data/daily-sent/<day>.json (its "printed" list,
# written by send_daily from the email as built; before Nov 10 2026, the
# briefing's own day's number) and the published page's data/daily-archive/<day>.json
# (the day's number, the state basis line). A line with no fact (a news title,
# the reader's own rain) is judged by the prose checks above, or not at all.
MEMORY_DAYS = 21
SENT_DIR = os.path.join(REPO, "data", "daily-sent")
RATIO_MOVE = 0.05
RATIO_BANDS = (2.2, 2.5)        # the usual corn-or-beans rule of thumb: under 2.2 favors corn, over 2.5 beans
PCT_MOVE = 5
PCT_BANDS = (10, 90)            # the bottom and top tenth of five years
WOW_MOVE = 5.0
FUNDS_WEEKDAY = 5               # Saturday
_COMMOD = re.compile(r"\b(corn|soybeans?|beans|wheat|live cattle|feeder cattle|feeders|cattle|lean hogs|hogs|crude)\b", re.I)


def _commodity(s):
    m = _COMMOD.search(str(s or ""))
    if not m:
        return ""
    w = m.group(1).lower()
    return {"soybean": "soybeans", "beans": "soybeans", "feeder cattle": "feeders", "lean hogs": "hogs",
            "live cattle": "cattle"}.get(w, w)


def number_fact(on):
    """The day's number (one_number) as a fact, or None when it is no recurring kind:
    a fund position, a price ratio or a percentile."""
    if not isinstance(on, dict) or not on.get("value"):
        return None
    v, u = str(on.get("value")).strip(), str(on.get("unit") or "").strip()
    lu = u.lower()
    text = ("%s %s" % (v, u)).strip()
    if re.search(r"\bcontracts?\b", lu) and re.search(r"\bfunds?\b|managed money|speculat", lu):
        return {"kind": "funds", "key": _commodity(lu) or "funds", "value": norm_value(v), "text": text}
    if re.search(r"\bratio\b", lu):
        try:
            return {"kind": "ratio", "key": re.sub(r"\s+", " ", lu).strip(), "value": float(norm_value(v)), "text": text}
        except ValueError:
            return None
    if re.search(r"percentile", lu + " " + v.lower()):
        m = re.search(r"\d+", v)
        if m:
            return {"kind": "percentile", "key": _commodity(lu) or lu, "value": int(m.group(0)), "text": text}
    return None


def _band(v, bands):
    return sum(1 for b in bands if v >= b)


def still_news(fact, mem, today):
    """(True, why) when the fact may print today; (False, why) when it says what the
    issue that last printed it already said. mem: memory() entries, oldest first."""
    kind, key = fact.get("kind"), fact.get("key")
    past = [m for m in mem or [] if isinstance(m, dict) and m.get("kind") == kind and m.get("key") == key
            and m.get("date") and str(m["date"]) < today.isoformat()]
    last = past[-1] if past else None
    if kind == "funds":
        if today.weekday() != FUNDS_WEEKDAY:
            return False, "fund positions print once per CFTC release, on Saturday"
        if any((today - dt.date.fromisoformat(str(m["date"]))).days <= 6 for m in past):
            return False, "this release's fund position already printed %s" % last["date"]
        return True, "the Saturday after the release"
    if last is None:
        if kind == "percentile" and _band(float(fact.get("value") or 0), PCT_BANDS) == 1:
            # never printed and in the middle band: a standing fact, not news (Nov 8 2026 rule); measured from
            # the middle, a first print is a band cross only from the bottom or top tenth
            return False, "%s at the %s percentile sits in the middle band and was not printed before" % (key, fact.get("value"))
        return True, "not printed in the last %d days" % MEMORY_DAYS
    try:
        v, lv = fact.get("value"), last.get("value")
        if kind == "ratio":
            if _band(float(v), RATIO_BANDS) != _band(float(lv), RATIO_BANDS):
                return True, "crossed a band since %s" % last["date"]
            if round(abs(float(v) - float(lv)) * 100) >= round(RATIO_MOVE * 100):
                return True, "moved %.2f since %s" % (abs(float(v) - float(lv)), last["date"])
            return False, "%s was %s on %s; moved under %.2f" % (key, lv, last["date"], RATIO_MOVE)
        if kind == "land_sales":
            if int(v) > int(lv):
                return True, "%d more sales than the %s print" % (int(v) - int(lv), last["date"])
            return False, "%s: %s sales, %s printed %s" % (key, v, lv, last["date"])
        if kind == "rain_records":
            # [wet, dry, oldest record]; a list saved before Nov 11 2026 holds the two counts only
            same = list(v[:2]) == list(lv[:2]) and (len(v) < 3 or len(lv) < 3 or v[2] == lv[2])
            if same:
                return False, "the same record counts and oldest record printed %s" % last["date"]
            return True, "the record counts or the oldest record changed since %s" % last["date"]
        if kind == "percentile":
            if _band(float(v), PCT_BANDS) != _band(float(lv), PCT_BANDS):
                return True, "crossed a band since %s" % last["date"]
            if abs(float(v) - float(lv)) >= PCT_MOVE:
                return True, "moved %d points since %s" % (abs(float(v) - float(lv)), last["date"])
            return False, "%s was at the %s percentile on %s; moved under %d points" % (key, lv, last["date"], PCT_MOVE)
    except (TypeError, ValueError):
        return True, "unreadable earlier value"
    if json.dumps(fact.get("value"), sort_keys=True) == json.dumps(last.get("value"), sort_keys=True):
        return False, "the same %s (%s) printed %s" % (kind, key, last["date"])
    return True, "changed since %s" % last["date"]


def wow_should_print(rows, last):
    """The state basis line: (print, why). rows/last: {key: wow cents}. Prints when a
    state enters, leaves or moves WOW_MOVE cents since the issue that last printed it."""
    if not rows:
        return False, "no state passed the gates (a quiet week)"
    if not last:
        return True, "first print"
    enters = sorted(set(rows) - set(last))
    leaves = sorted(set(last) - set(rows))
    moved = sorted(k for k in set(rows) & set(last) if abs(float(rows[k]) - float(last[k])) >= WOW_MOVE)
    if enters or leaves or moved:
        return True, "; ".join(x for x in ("entered " + ", ".join(enters) if enters else "",
                                            "left " + ", ".join(leaves) if leaves else "",
                                            "moved " + ", ".join(moved) if moved else "") if x)
    return False, "the same states within %d cents of the last print" % WOW_MOVE


def issue_facts(issue):
    """[fact] an archived or sent issue printed: the sent email's own list when it carries
    one, plus the day's number, the state basis line and every settle on its board from the
    issue itself. Anything that is not an issue gives nothing."""
    if not isinstance(issue, dict):
        return []
    pr = issue.get("printed")
    out = [f for f in pr if isinstance(f, dict)] if isinstance(pr, list) else []
    # the ZIP readers' rain lines, kept compact as {"<ST>:<fips>": value} (send_daily save_sent_copy)
    rl = issue.get("rain_lines")
    if isinstance(rl, dict):
        out += [{"kind": "rain_line", "key": k, "value": v, "text": ""} for k, v in sorted(rl.items()) if isinstance(v, str)]
    b = issue.get("briefing") if isinstance(issue.get("briefing"), dict) else issue
    if not isinstance(b, dict):
        return out
    f = number_fact(b.get("one_number"))
    if f:
        out.append(f)
    bw = b.get("basis_wow")
    if isinstance(bw, dict) and bw.get("print"):
        for r in bw.get("rows") or []:
            if isinstance(r, dict) and r.get("st") and r.get("crop"):
                out.append({"kind": "basis_wow", "key": "%s:%s" % (r["st"], r["crop"]), "value": r.get("wow"),
                            "text": ""})
    # a settle on the issue's board was told that day (Nov 9 2026: Friday's hog drop, on Saturday's board and in
    # its headline "hogs sank", came back as Monday's subject)
    lc = b.get("locked_changes")
    if isinstance(lc, dict):
        for k, ch in lc.items():
            if isinstance(ch, dict) and ch.get("kind") == "settle" and ch.get("date"):
                out.append({"kind": "move", "key": k, "value": str(ch["date"])[:10], "text": ""})
    return out


def memory(today, sent_dir=SENT_DIR, archive_dir=ARCHIVE, days=MEMORY_DAYS):
    """Every fact printed in the `days` before today, oldest first, each with its "date"."""
    out = []
    for i in range(days, 0, -1):
        d = (today - dt.timedelta(days=i)).isoformat()
        seen = set()
        for path in (os.path.join(sent_dir, d + ".json"), os.path.join(archive_dir, d + ".json")):
            try:
                with open(path, encoding="utf-8") as fh:
                    issue = json.load(fh)
            except (OSError, ValueError):
                continue
            if not isinstance(issue, dict):
                continue        # a list or null in one file skips that file, never the whole memory
            for f in issue_facts(issue):
                if not isinstance(f, dict) or not f.get("kind"):
                    continue
                sig = (f.get("kind"), f.get("key"), json.dumps(f.get("value"), sort_keys=True))
                if sig in seen:
                    continue
                seen.add(sig)
                out.append(dict(f, date=d))
    return out


def memory_from(rec):
    """memory() built from issues already loaded (recent()'s list, each with its _date)."""
    out = []
    for b in rec or []:
        if not isinstance(b, dict):
            continue
        for f in issue_facts(b):
            out.append(dict(f, date=b.get("_date")))
    return out


def last_set(mem, kind, today):
    """{key: value} of the newest day before today that printed any fact of this kind."""
    mine = [m for m in mem or [] if isinstance(m, dict) and m.get("kind") == kind and m.get("key")
            and m.get("date") and str(m["date"]) < today.isoformat()]
    days = sorted({str(m["date"]) for m in mine})
    if not days:
        return {}
    return {m["key"]: m.get("value") for m in mine if str(m["date"]) == days[-1]}


# ── replay and selftest ─────────────────────────────────────────────────────
def replay(first="2026-10-19", last="2026-11-01", archive_dir=ARCHIVE, out=print):
    d0, d1 = dt.date.fromisoformat(first), dt.date.fromisoformat(last)
    total = 0
    while d0 <= d1:
        p = os.path.join(archive_dir, d0.isoformat() + ".json")
        if os.path.exists(p):
            with open(p, encoding="utf-8") as fh:
                b = json.load(fh)
            f = hits(b, recent(d0, archive_dir), d0, archive_dir)
            hard = [x for x in f if x[0] not in SOFT]
            total += bool(hard)
            out("%s %s  %s" % (d0.isoformat(), WEEKDAYS[d0.weekday()],
                               "sent back" if f else "passes") + ("" if f else ""))
            out("    headline: %s" % b.get("headline"))
            for k, loc, why in f:
                out("    [%s] %s: %s" % (k, loc, why))
        d0 += dt.timedelta(days=1)
    return total


def _selftest():
    fails = []

    def ok(c, m):
        print(("  ok   " if c else "  FAIL ") + m)
        if not c:
            fails.append(m)

    A = ARCHIVE
    load = lambda iso: json.load(open(os.path.join(A, iso + ".json"), encoding="utf-8"))
    have = all(os.path.exists(os.path.join(A, d + ".json")) for d in ("2026-10-23", "2026-10-25", "2026-11-01"))
    ok(have, "the real archive is here (data/daily-archive)")
    if have:
        # the brief's pairs, from the real archive
        ok(jaccard(load("2026-11-01")["headline"], load("2026-10-31")["headline"]) >= HEADLINE_SIM, "Nov 1 reruns Oct 31")
        ok(jaccard(load("2026-10-25")["headline"], load("2026-10-24")["headline"]) >= HEADLINE_SIM, "Oct 25 reruns Oct 24")
        ok(jaccard(load("2026-10-28")["headline"], load("2026-10-27")["headline"]) < HEADLINE_SIM,
           "Oct 28 vs Oct 27 (new move, new numbers) is not a rerun")
        ok(jaccard(load("2026-10-24")["headline"], load("2026-10-23")["headline"]) >= WEEKEND_SIM,
           "Saturday Oct 24 reruns Friday Oct 23 at the weekend line")
        f = hits(load("2026-11-01"), recent(dt.date(2026, 11, 1)), dt.date(2026, 11, 1))
        kinds = {k for k, _, _ in f}
        ok({"headline", "weekend", "number", "story"} <= kinds, "Nov 1: headline, weekend, number and story repeats %s" % sorted(kinds))
        f = hits(load("2026-10-29"), recent(dt.date(2026, 10, 29)), dt.date(2026, 10, 29))
        ok(any(k == "number" and "$2.4 billion" in w for k, _, w in f), "Oct 29: $2.4 billion again")
        ok(not any(k == "story" for k, _, _ in f), "Oct 29: Arizona's first case is a new turn, not a rerun")
        f = hits(load("2026-10-25"), recent(dt.date(2026, 10, 25)), dt.date(2026, 10, 25))
        ok(any(k == "story" and "elk" in w for k, _, w in f), "Oct 25: the Texas elk case retold")
        f = hits(load("2026-10-27"), recent(dt.date(2026, 10, 27)), dt.date(2026, 10, 27))
        ok(not any(k in HARD for k, _, _ in f), "Oct 27 (first 2.48, a new headline) is not held")
        ok(story_sim("Arizona confirms its first New World screwworm case",
                     "USDA confirms first screwworm detection in US wildlife") < STORY_SIM, "Arizona below the story line")
    ok(new_turn("USDA confirms second New World screwworm case in Texas", "USDA Confirms First New World Screwworm Case"),
       "a second case is a new turn")
    ok(not new_turn("Senate farm bill scores $4.4 billion; lame-duck passage uncertain",
                    "Senate farm bill scores $4.4 billion, lame-duck passage uncertain"), "the same score is not")
    lp = {"corn": 4.4775, "crude": 104.12, "cattle": 220.95}
    lc = {"corn": {"prev": 4.5125, "pct": -0.7756}, "crude": {"prev": 102.0, "pct": 2.0784}}
    ok(board_figures("Corn ends the week at $4.47¾; crude up 2.1% to $104.12", lp, lc), "a board headline is found")
    ok(board_figures("Corn loses 3½ cents on the week", lp, lc), "a cents move on the board is found")
    ok(not board_figures("Senate farm bill scores $4.4 billion; lame-duck passage uncertain", lp, lc),
       "a news headline with a dollar figure is not the board")
    ok(not board_figures("Cattle on Feed Friday: placements seen 5% lower", lp, lc), "a report estimate is not the board")
    sat = dt.date(2026, 10, 31)
    f = hits({"headline": "Corn ends the week at $4.47¾", "locked_prices": lp, "locked_changes": lc}, [], sat)
    ok([k for k, _, _ in f] == ["weekend"], "a Saturday board headline goes back")
    f = hits({"headline": "Senate farm bill scores $4.4 billion before the lame-duck session",
              "locked_prices": lp, "locked_changes": lc}, [], sat)
    ok(f == [], "a Saturday news headline passes")
    rec = [{"_date": "2026-10-2%d" % i, "headline": "Corn x %d" % i} for i in range(6, 9)]
    ok(any(k == "same-lead" for k, _, _ in hits({"headline": "Corn y"}, rec, dt.date(2026, 10, 29))), "fourth corn lead in a row")
    ok(not any(k == "same-lead" for k, _, _ in hits({"headline": "Hogs y"}, rec, dt.date(2026, 10, 29))), "a hog lead is fine")
    b = {"outside_the_pit": [{"title": "a"}, {"title": "b"}, {"title": "c"}]}
    log = drop_stories(b, [("story", "outside_the_pit[1]", "x")])
    ok([x["title"] for x in b["outside_the_pit"]] == ["a", "c"] and len(log) == 1, "drop_stories cuts only the repeat")
    ok(norm_value("$2.4 billion") == norm_value("2.4 Billion") and norm_value("2.48") != norm_value("2.49"), "values compare as written")
    ok(issue_date({"date": "Sunday, November 1, 2026"}) == dt.date(2026, 11, 1), "issue date from the date line")
    ok("ALREADY SAID THIS WEEK" in memory_block([{"_date": "2026-10-31", "headline": "h"}]), "memory block")
    print("daily_fresh selftest: %s" % ("ok" if not fails else "%d failure(s)" % len(fails)))
    return 1 if fails else 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(_selftest())
    if "--replay" in sys.argv:
        n = replay()
        print("%d of the issues would have been sent back for a hard repeat" % n)
        sys.exit(0)
    print(__doc__)
