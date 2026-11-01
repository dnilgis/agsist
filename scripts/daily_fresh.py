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

WHAT. One definition, used by the generator (prompt block and the one send-back),
the gate (what still repeats is a warning, never a hold: Sig, Nov 1) and the replay:
  recent(today, archive_dir, n)   the last n issues before today, oldest first
  memory_block(recent)            "ALREADY SAID THIS WEEK" for the writer's prompt
  hits(briefing, recent, today)   [(kind, loc, why)] for every repeat found
  correction(found)               the send-back text, reasons quoted
  drop_stories(briefing, found)   cut the news items that still repeat

THE KINDS and what each one does:
  headline   a headline too close to one of the last 7 (HEADLINE_SIM). Sent back once, then a warning.
  weekend    a Saturday or Sunday headline built on the board (a price, a
             percent or a cents move that is on the locked board) or too close
             to the last weekday headline (WEEKEND_SIM). No new settle comes on a
             weekend, so it can only rerun Friday. Sent back once, then a warning.
  number     the day's number (one_number) has a value used in the last 7 days
             for the same kind of thing (its unit shares a word). Sent back once, then a warning.
  story      a news item whose title tells a story from the last 7 days
             (STORY_SIM) with nothing new in its title (no number or count that
             the old one lacked). The generator cuts it after the one rewrite.
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
HARD = ("headline", "weekend", "number")      # sent back once; the gate warns
CUT = ("story",)                              # cut by the generator, a warning if still there
SOFT = ("same-lead",)                         # sent back once, a warning after

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
        "the draft back once with the reason; a repeat still there after that is cut or holds the send.",
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


def stamp(found, tries):
    """What the generator records in briefing["freshness"] (the gate checks any
    issue that carries it)."""
    return {"window": WINDOW, "tries": tries, "hits": [{"kind": k, "loc": l, "why": w} for k, l, w in found]}


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
