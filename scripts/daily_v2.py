#!/usr/bin/env python3
"""
daily_v2.py -- the Daily email, rebuilt (Sig, Oct 22 2026: "I just want to
actually be excited to open the email every day"). Decisions:
notes/STANDING-DECISIONS.md "The Daily email", "print of the day",
"proprietary slot"; the panel record notes/panels/daily-email-2026-10-22.md.

BEHIND A SWITCH. scripts/send_daily.py uses this only with DAILY_FORMAT=v2
AND either TEST_TO_SIG=1 (Sig's test copy, daily.yml test_to_sig) or
DRY_RUN=1 (a preview). The morning send to the list keeps scripts/brief_email.py
until Sig approves a test copy. test/daily-email-v2.test.mjs pins the switch.

WHAT IS IN IT, top to bottom, about two phone screens:
  subject     the day's most newsworthy specific fact: news (a news item or
              the day's number, when it carries a number) > a market move (a
              run of lower or higher settles, or a 2% move) > a rank against
              5 years > the harvest price. Never the elevator count, no
              "AGSIST ·" prefix, no % chip. SUBJECT_MAX characters when a
              clean cut allows.
  preheader   the reader's own top bid (ZIP readers), else the second Today line.
  Today       4 to 6 one-line items, each with its number, from what the issue
              already holds. Events and webinars go to What to watch.
  Only here   one or two findings from our own elevator boards, each with its
              sample (scripts/daily_edge.py computes them; held basis findings
              are not in that file and never reach here). No workings.
  Print of the day   scripts/print_of_day.py + render_print_of_day.mjs. No
              picture, no slot; the email never waits on it.
  I never knew that  scripts/daily_fact.py, sourced every time.
  The board   one row per contract (Corn and Corn, Dec fold to one row when
              they are the same quote), stamped honestly: "Last trade 5:46
              a.m. CT, change from Tuesday's settle".
  What to watch, the full-issue button, forward line, footer.
Section bodies stay on the web page.

THE NUMBER CHECK THAT BLOCKS (check()). A wrong number in the subject, the
headline or the lead stops the v2 send:
  - code: a sentence that says close/closed/settle/"in a row"/"straight days"
    next to a price that is this morning's last trade, not the settle
    (Oct 21: "Corn closed Tuesday at $4.59½"; the settle was $4.62);
  - the saved fact check (FACT_CHECK_JSON, else $RUNNER_TEMP/fact-check.json):
    a verified high finding, or a verified medium mismatch or settle-for-last
    finding, about a number in those fields (or the field the subject came from).
Everything else the fact check says stays report-only.
"""
import html as _html
import json
import os
import re
import sys
from datetime import date, datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import brief_email as BE   # noqa: E402  link tags, text hygiene, the shared blocks
import pricefmt            # noqa: E402  the site's grain price text

try:
    from zoneinfo import ZoneInfo
    CT = ZoneInfo("America/Chicago")
except Exception:  # pragma: no cover
    CT = timezone(timedelta(hours=-5))

SUBJECT_MAX = 45
SUBJECT_HARD = 62
TODAY_MIN, TODAY_MAX = 4, 6
MAX_NEWS = 3
PRE_PAD = "&#847;&zwnj;&nbsp;" * 70
SHARED_HOSTS = ("workers.dev", "github.io", "vercel.app", "pages.dev", "netlify.app", "herokuapp.com")
SITE = "https://agsist.com"
HARVEST_PRICES = os.path.join(REPO, "data", "harvest-prices.json")
PRICE_STATS = os.path.join(REPO, "data", "price-stats.json")

INK, MUTE, LINE, PAPER = "#14100a", "#5f5a52", "#e3ded4", "#ffffff"
GOLD, GREEN, DOWN, UP = "#7a5c14", "#1f6f2a", "#b3261e", "#1f6f2a"
SANS, MONO = BE.SANS, BE.MONO
# Dark mode: every coloured element carries a class, and every class has a
# dark colour of at least 4.5:1 on the dark card (test/daily-email-v2.test.mjs
# computes each pair). The two failures the panel measured were the green
# label (2.91:1) and the gold links (3.64:1).
DARK_CARD = "#191510"
DARK_COLORS = {"ink": "#ece6da", "mute": "#b3aa9e", "gold": "#e3b955", "lab": "#7fd28a",
               "up": "#7fd28a", "down": "#f08a7a", "link": "#e3b955"}
DARK = """
:root{color-scheme:light dark;supported-color-schemes:light dark}
@media (prefers-color-scheme:dark){
  .bg{background:#12100c!important}
  .card{background:%s!important}
  .ink{color:%s!important}
  .mute{color:%s!important}
  .gold{color:%s!important}
  .lab{color:%s!important}
  .up{color:%s!important}
  .down{color:%s!important}
  a.link{color:%s!important}
  a.mute.link{color:%s!important}
  .rule{background:#332d24!important}
  .cell{border-bottom-color:#332d24!important}
  .pic{border-color:#4a4236!important}
  .btn{background:#e3b955!important;color:#191510!important}
}
""" % (DARK_CARD, DARK_COLORS["ink"], DARK_COLORS["mute"], DARK_COLORS["gold"], DARK_COLORS["lab"],
       DARK_COLORS["up"], DARK_COLORS["down"], DARK_COLORS["link"], DARK_COLORS["mute"])

NUM_WORDS = r"\b(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|dozen|half|million|billion)\b"
EVENT_RE = re.compile(r"\b(webinar|workshop|register|registration|field day|conference|seminar|town hall|"
                      r"listening session|open house|livestream|live stream|live session|will host|hosts? a)\b", re.I)
MARKETISH = re.compile(r"52-week|\brange\b|last trade|settle|percentile|futures|\bclose\b", re.I)
ELEVATOR = re.compile(r"elevator", re.I)
# A news subject must be a farm story (Sig, Oct 22): grains, oilseeds, livestock,
# dairy, farm policy and payments, inputs, farm weather, farm exports, farmland.
# Crude or macro news qualifies only when the item itself names a farm input or
# farm price (diesel relief does; a country's crude import bill does not).
FARM = re.compile(r"\b(corn|soy\w*|beans?|wheat|grains?|oilseeds?|canola|sorghum|oats|barley|rice|cotton|"
                  r"cattle|beef|cows?|calf|calves|hogs?|pork|swine|dairy|milk|poultry|chickens?|eggs?|turkeys?|lamb|sheep|"
                  r"hpai|avian|livestock|farms?|farmers?|farming|ranch\w*|crops?|harvest|planting|acres?|farmland|"
                  r"usda|fsa|rma|nass|crp|arc|plc|ethanol|biofuels?|biodiesel|rins?|renewable fuel|"
                  r"fertili[sz]er|nitrogen|anhydrous|urea|potash|phosphate|diesel|herbicides?|pesticides?|"
                  r"seeds?|drought|frost|cash rents?|land values?|grain storage)\b", re.I)


ORD = {1: "1st", 2: "2nd", 3: "3rd"}


def farm_story(item, daily=None):
    """The item's own headline words (the news title, or the day's number and
    its unit) name something on the farm. The body is not read: a crude story
    whose last clause says freight "eventually hits diesel" is still a crude story."""
    return bool(FARM.search(item["text"]))


def e(s):
    return _html.escape(str(s if s is not None else ""), quote=True)


def ordinal(n):
    n = int(n)
    if 10 <= n % 100 <= 20 or n % 10 not in ORD:
        return "%dth" % n
    return "%d%s" % (n, ORD[n % 10][1:])


def has_number(s):
    """A real number: a digit that is not only a four-digit year, or a number word."""
    s = str(s or "")
    toks = re.findall(r"\$?\d[\d,.]*%?", s)
    if any(not re.fullmatch(r"(19|20)\d\d", t) for t in toks):
        return True
    return bool(re.search(NUM_WORDS, s, re.I))


def _iso_day(daily):
    return BE.campaign_of(daily) or str(daily.get("date") or "")[:10]


def _wday(iso):
    try:
        return date.fromisoformat(str(iso)[:10]).strftime("%A")
    except ValueError:
        return ""


def _clock(stamp):
    try:
        t = datetime.fromisoformat(str(stamp).replace("Z", "+00:00")).astimezone(CT)
    except ValueError:
        return ""
    h = t.hour % 12 or 12
    return "%d:%02d %s CT" % (h, t.minute, "a.m." if t.hour < 12 else "p.m.")


def sentence(s):
    s = BE.soften_caps(BE.strip_md(s)).strip()
    if s and s[0].islower():
        s = s[0].upper() + s[1:]
    return s


# ── the news ──────────────────────────────────────────────────────────────
def _nums(s):
    return set(re.findall(r"\$?\d[\d,.]*\s*(?:billion|million|%)?", str(s or "")))


def is_event(item):
    return bool(EVENT_RE.search("%s %s" % (item.get("title") or "", item.get("body") or "")))


def news_items(daily):
    """News for Today and the subject: up to MAX_NEWS, each a line with a number.
    [{text, field, kind: "news"}]. Events are left for What to watch."""
    out, seen = [], set()
    for i, it in enumerate(daily.get("outside_the_pit") or []):
        if not isinstance(it, dict) or is_event(it):
            continue
        t = sentence(it.get("title"))
        if not t or not has_number(t):
            continue
        out.append({"text": t, "field": "outside_the_pit[%d].title" % i, "kind": "news", "nums": _nums(t)})
    on = daily.get("one_number")
    if isinstance(on, dict) and on.get("value") and on.get("unit"):
        t = sentence("%s %s" % (BE.strip_md(on["value"]), BE.strip_md(on["unit"])))
        if has_number(t) and not MARKETISH.search(t) and not is_event({"title": t, "body": on.get("context")}):
            out.append({"text": t, "field": "one_number.value", "kind": "news", "nums": _nums(t)})
    keep = []
    for x in out:
        big = {n for n in x["nums"] if re.search(r"billion|million|%|\$", n)}
        if big & seen:
            continue        # the same story twice ($8 billion in the news item and the day's number)
        seen |= big
        keep.append(x)
    return keep[:MAX_NEWS]


def events(daily):
    return [{"time": "", "desc": sentence(it.get("title"))} for it in (daily.get("outside_the_pit") or [])
            if isinstance(it, dict) and is_event(it) and it.get("title")]


# ── the market ────────────────────────────────────────────────────────────
GRAIN = {"corn", "corn-dec", "beans", "beans-nov", "wheat"}
LABEL = {"corn": "Corn", "corn-dec": "Corn, Dec", "beans": "Beans", "beans-nov": "Beans, Nov", "wheat": "Wheat",
         "cattle": "Live cattle", "feeders": "Feeders", "hogs": "Lean hogs", "crude": "Crude"}
BOARD = (("corn", "corn-dec"), ("beans", "beans-nov"), ("wheat", None), ("cattle", None),
         ("feeders", None), ("hogs", None), ("crude", None))


def _q(daily, key):
    v = (daily.get("locked_prices") or {}).get(key)
    ch = (daily.get("locked_changes") or {}).get(key) or {}
    if not isinstance(v, (int, float)):
        return None
    prev = ch.get("prev") if isinstance(ch.get("prev"), (int, float)) else None
    return {"key": key, "last": float(v), "prev": prev, "kind": ch.get("kind"), "at": ch.get("at"),
            "date": ch.get("date"), "prev_date": ch.get("prev_date"),
            "pct": ch.get("pct") if isinstance(ch.get("pct"), (int, float)) else None}


def px(key, v):
    if v is None:
        return ""
    return pricefmt.price(v * 100) if key in GRAIN else BE.fmt_price(v, False)


def mv(key, q):
    """The change, signed: cents for grain, percent for the rest."""
    if q.get("prev") is None:
        return ""
    if key in GRAIN:
        return pricefmt.move((q["last"] - q["prev"]) * 100, sign=True)
    p = q.get("pct")
    if p is None and q["prev"]:
        p = 100.0 * (q["last"] - q["prev"]) / q["prev"]
    if p is None:
        return ""
    return "unch" if abs(p) < 0.05 else ("+" if p >= 0 else "−") + "%.1f%%" % abs(p)


def contract_of(daily, key):
    for q in ((daily.get("quote_strip") or {}).get("quotes") or []):
        if q.get("key") == key and q.get("contract") and q.get("contract") != "nearby":
            return q["contract"]
    return ""


def board_rows(daily):
    rows = []
    for a, b in BOARD:
        qa, qb = _q(daily, a), (_q(daily, b) if b else None)
        if qa and qb and abs(qa["last"] - qb["last"]) < 1e-9 and qa.get("prev") == qb.get("prev"):
            c = contract_of(daily, b)
            rows.append(dict(qb, label=LABEL[a] + (", " + c if c else ""), key=b))
            continue
        for q in (qa, qb):
            if q:
                rows.append(dict(q, label=LABEL[q["key"]]))
    return rows


def board_stamp(daily, rows):
    kinds = [r.get("kind") for r in rows if r.get("kind")]
    if not kinds:
        return "", None
    main = max(set(kinds), key=kinds.count)
    against = (daily.get("board") or {}).get("prev_close_session") or next((r.get("prev_date") for r in rows if r.get("prev_date")), "")
    wd = _wday(against)
    if main == "last":
        at = next((r.get("at") for r in rows if r.get("kind") == "last" and r.get("at")), "")
        return "Last trade %s, change from %s's settle" % (_clock(at) or "this morning", wd or "the last"), main
    day = next((r.get("date") for r in rows if r.get("kind") == "settle" and r.get("date")), "")
    return "%s's settle, change from %s's settle" % (_wday(day) or "The last", wd or "the session before"), main


def settles(crop, before, path=HARVEST_PRICES):
    """[(date, settle)] for Dec corn or Nov beans from the harvest price file,
    dated strictly before `before` (what a reader could know that morning)."""
    try:
        with open(path, encoding="utf-8") as f:
            d = json.load(f)
    except (OSError, ValueError):
        return []
    for c in d.get("commodities") or []:
        if str(c.get("label") or "").lower() == crop:
            ser = ((c.get("harvest") or {}).get("series") or [])
            return [(x["d"], float(x["s"])) for x in ser if isinstance(x.get("s"), (int, float)) and str(x.get("d")) < before]
    return []


def streak(crop, before, path=HARVEST_PRICES):
    """(n, "lower"/"higher", last settle, its date) or None: the run of settles
    each below (above) the one before, ending at the last settle before `before`."""
    s = settles(crop, before, path)
    if len(s) < 3:
        return None
    way = "lower" if s[-1][1] < s[-2][1] else ("higher" if s[-1][1] > s[-2][1] else None)
    if not way:
        return None
    n = 0
    for i in range(len(s) - 1, 0, -1):
        if (s[i][1] < s[i - 1][1]) if way == "lower" else (s[i][1] > s[i - 1][1]):
            n += 1
        else:
            break
    return n, way, s[-1][1], s[-1][0]


def market_items(daily):
    iso = _iso_day(daily)
    items = []
    st = {c: streak(c, iso) for c in ("corn", "soybeans")}
    bits = []
    for crop, key, name in (("corn", "corn-dec", "Corn"), ("soybeans", "beans-nov", "beans")):
        s = st.get(crop)
        if s and s[0] >= 3:
            bits.append((name, s, key))
    if bits:
        name, s0, key = bits[0]
        txt = "%s has settled %s %d days running, %s %s" % (name, s0[1], s0[0], px(key, s0[2]), _wday(s0[3]) or "")
        for name, s1, key in bits[1:]:
            txt = txt.strip() + "; %s %d%s, %s" % (name, s1[0], "" if s1[1] == s0[1] else " " + s1[1], px(key, s1[2]))
        txt = txt.strip()
        items.append({"text": txt[0].upper() + txt[1:] + ".", "kind": "market", "field": "harvest-prices"})
    rows = {r["key"]: r for r in board_rows(daily)}
    c = rows.get("corn-dec") or rows.get("corn")
    b = rows.get("beans-nov") or rows.get("beans")
    if c and b and c.get("prev") is not None and b.get("prev") is not None:
        if c.get("kind") == "last":
            txt = ("Overnight: corn %s (%s), beans %s (%s) at %s vs %s's settle."
                   % (px(c["key"], c["last"]), mv(c["key"], c), px(b["key"], b["last"]), mv(b["key"], b),
                      _clock(c.get("at")) or "this morning", _wday(c.get("prev_date")) or "the last"))
        elif c.get("kind") == "settle" and _wday(c.get("date")):
            txt = ("%s's settle: corn %s (%s), beans %s (%s)."
                   % (_wday(c.get("date")), px(c["key"], c["last"]), mv(c["key"], c),
                      px(b["key"], b["last"]), mv(b["key"], b)))
        else:
            txt = ("Board: corn %s (%s), beans %s (%s)."
                   % (px(c["key"], c["last"]), mv(c["key"], c), px(b["key"], b["last"]), mv(b["key"], b)))
        items.append({"text": txt, "kind": "market", "field": "locked_changes"})
    return items, st


def big_move(daily):
    """The largest grain or livestock move of 2% or more, or crude 4%: (label, pct, q) or None."""
    best = None
    for key in ("corn-dec", "corn", "beans-nov", "beans", "wheat", "cattle", "feeders", "hogs", "crude"):
        q = _q(daily, key)
        if not q or q.get("pct") is None:
            continue
        need = 4.0 if key == "crude" else 2.0
        if abs(q["pct"]) >= need and (best is None or abs(q["pct"]) > abs(best[1])):
            best = (LABEL[key].split(",")[0], q["pct"], q)
    return best


def rank_items(daily, path=PRICE_STATS):
    """Where each price sits in 5 years of weekly closes (data/price-stats.json),
    only when that file was written before this issue (no look-ahead)."""
    try:
        with open(path, encoding="utf-8") as f:
            d = json.load(f)
    except (OSError, ValueError):
        return []
    upd, gen = str(d.get("updated") or ""), str(daily.get("generated_at") or "")
    if not upd or not gen or upd.replace("Z", "+00:00") > gen:
        return []
    out = []
    for k, name in (("corn", "Corn"), ("soybean", "Soybeans"), ("wheat", "Wheat"), ("cattle", "Live cattle"), ("feeders", "Feeders")):
        r = d.get(k) or {}
        if isinstance(r.get("pct"), (int, float)) and r.get("n"):
            out.append({"text": "%s at the %s percentile of %s years of weekly closes (%d weeks)."
                        % (name, ordinal(r["pct"]), r.get("years") or 5, r["n"]),
                        "kind": "rank", "pct": r["pct"], "name": name, "field": "price-stats"})
    return out


def clock_item(daily, today=None):
    import harvest_clock
    b = harvest_clock.visible(daily.get("harvest_clock"), today)
    if not b:
        return None
    crops = [c for c in (b.get("crops") or []) if isinstance(c.get("pct"), (int, float))]
    if not crops:
        return None
    crops.sort(key=lambda c: -abs(c["pct"]))
    parts = ["%s %s, %s%.1f%% vs projected" % ("beans" if c["crop"].lower().startswith("soy") else c["crop"].lower(),
                                                  px("corn", c["harvest"]), "+" if c["pct"] >= 0 else "−", abs(c["pct"]))
             for c in crops]
    left = crops[0].get("days_left")
    txt = "Harvest price so far: " + "; ".join(parts) + ((". %d trading days left." % left) if isinstance(left, int) else ".")
    top = crops[0]
    return {"text": txt, "kind": "clock", "field": "harvest_clock", "url": BE.CLOCK_URL, "link": "Tracker",
            "subject": "%s harvest price %.1f%% %s projected" % ("Bean" if top["crop"].lower().startswith("soy") else "Corn",
                                                                abs(top["pct"]), "over" if top["pct"] >= 0 else "under")}


# ── the inbox row ─────────────────────────────────────────────────────────
def clip(s, room=SUBJECT_MAX, hard=SUBJECT_HARD):
    s = s.rstrip(" .")
    if len(s) <= room:
        return s
    for lim in (room, hard):
        for sep in ("; ", ": ", ", "):
            cut = s.rfind(sep, 0, lim + 1)
            if cut >= 20:
                return s[:cut]
        if len(s) <= lim:
            return s
    cut = s.rfind(" ", 0, hard)
    return (s[:cut] if cut >= 20 else s[:hard]).rstrip(" ,;:")


def subject(daily, news=None, today=None):
    """(subject, where it came from, the field it rests on)."""
    news = news_items(daily) if news is None else news
    for x in news:
        if not ELEVATOR.search(x["text"]) and farm_story(x, daily):
            return clip(x["text"]), "news", x["field"]
    iso = _iso_day(daily)
    for crop, key, name in (("corn", "corn-dec", "Corn"), ("soybeans", "beans-nov", "Beans")):
        s = streak(crop, iso)
        if s and s[0] >= 4:
            return clip("%s%s %s %s close in a row: %s" % (name, "'s" if name == "Corn" else "'", ordinal(s[0]), s[1],
                                                           px(key, s[2]))), "market", "harvest-prices"
    bm = big_move(daily)
    if bm:
        label, p, q = bm
        when = ("overnight" if q.get("kind") == "last" else (_wday(q.get("date")) or "")).strip()
        txt = "%s %s %.1f%% %s to %s" % (label, "up" if p > 0 else "down", abs(p), when, px(q["key"], q["last"]))
        return clip(txt.replace("  ", " ")), "market", "locked_changes"
    ranks = [r for r in rank_items(daily) if r["pct"] <= 5 or r["pct"] >= 95]
    if ranks:
        return clip(ranks[0]["text"].split(" (")[0]), "rank", "price-stats"
    ck = clock_item(daily, today)
    if ck:
        return clip(ck["subject"]), "clock", "harvest_clock"
    head = sentence(daily.get("headline"))
    if head and not ELEVATOR.search(head):
        return clip(head), "headline", "headline"
    return "The Daily for %s" % (_wday(iso) or "today"), "date", None


def today_items(daily, today=None):
    """4 to 6 lines, each with its number, the subject's story first."""
    news = news_items(daily)
    mk, _st = market_items(daily)
    ck = clock_item(daily, today)
    items = list(news) + mk + ([ck] if ck else [])
    if len(items) < TODAY_MIN:
        for r in sorted(rank_items(daily), key=lambda r: -abs(r["pct"] - 50)):
            if len(items) >= TODAY_MIN:
                break
            items.append(r)
    items = [x for x in items if has_number(x["text"]) and not ELEVATOR.search(x["text"]) and not COUNT_LINE.search(x["text"])]
    return items[:TODAY_MAX]


def preheader(local, items, subj, sfield=None):
    if isinstance(local, dict) and local.get("head"):
        return BE.strip_md(local["head"])
    rest = [x for x in items if x["text"].rstrip(".") != subj and not x["text"].startswith(subj)
            and not (sfield and x.get("field") == sfield)]
    for x in rest:      # a farm line first: a crude or macro item is not the hook
        if x.get("kind") != "news" or farm_story(x):
            return x["text"]
    return rest[0]["text"] if rest else ""


# ── only here ────────────────────────────────────────────────────────────
# Not a raw count of elevators (Sig, Oct 22): a comparison against history,
# from scripts/only_here.py (basis vs its own record, the reader's rain vs normal).
COUNT_LINE = re.compile(r"\b[\d,]+ of (?:the )?[\d,]+ elevators\b|\b[\d,]+ elevators\b", re.I)


def only_here(daily, rain=None, loc=None):
    import only_here as OH
    z = (rain or {}).get("zip") if isinstance(rain, dict) else None
    try:
        lines = OH.for_reader(_iso_day(daily), z, loc=loc)
    except Exception as ex:
        print("only here skipped (%s)" % type(ex).__name__)
        return []
    return [x for x in lines if not COUNT_LINE.search(x["text"])]


# ── links ────────────────────────────────────────────────────────────────
def shared_host(u):
    try:
        import urllib.parse
        h = (urllib.parse.urlsplit(str(u)).hostname or "").lower()
    except ValueError:
        return False
    return any(h == s or h.endswith("." + s) for s in SHARED_HOSTS)


def _a(url, text, camp=None, content=None, cls="link", color=GOLD):
    u = BE.utm(url, content, camp) if content else url
    return '<a class="%s" href="%s" style="color:%s">%s</a>' % (cls, BE._href(e(u) if "&amp;" not in u else u), color, e(text))


# ── the email ────────────────────────────────────────────────────────────
def build(daily, site_href, unsub_url=None, elevators=None, local=None, forward_url=None, today=None,
          rain=None, pod=None, fact=None, loc=None):
    """{"subject", "subject_from", "subject_field", "preheader", "html", "text", "slots"}."""
    camp = BE.campaign_of(daily)
    iso = _iso_day(daily)
    if today is None:
        try:
            today = date.fromisoformat(iso)
        except ValueError:
            today = None
    news = news_items(daily)
    subj, sfrom, sfield = subject(daily, news, today)
    items = today_items(daily, today)
    # the subject's story leads the Today list
    lead = [x for x in items if x.get("field") == sfield or (sfrom == "market" and x.get("field") == sfield)]
    items = lead[:1] + [x for x in items if x not in lead[:1]]
    pre = preheader(local, items, subj, sfield)
    here = only_here(daily, rain, loc)
    if unsub_url and shared_host(unsub_url):
        unsub_url = None          # BUILD-RULES 11: nothing a reader clicks on a shared host
    if isinstance(elevators, dict) and elevators.get("add_url") and shared_host(elevators["add_url"]):
        elevators = dict(elevators, add_url=None)
    if fact is None:
        try:
            import daily_fact
            fact = daily_fact.for_day(today or date.today())
        except Exception as ex:
            print("daily fact skipped (%s)" % type(ex).__name__)
            fact = None
    pod = pod if (isinstance(pod, dict) and pod.get("image_url") and pod.get("why") and pod.get("make_url")) else None
    offer = BE.rain_print_offer(rain, today)
    slots = {"today": len(items), "only_here": len(here), "print": bool(pod), "fact": bool(fact)}
    html = _html_body(daily, camp, iso, subj, pre, items, here, pod, fact, offer, rain, local, elevators,
                      site_href, unsub_url, forward_url, today)
    text = _text_body(daily, camp, iso, items, here, pod, fact, offer, rain, local, elevators,
                      site_href, unsub_url, forward_url, today)
    return {"subject": subj, "subject_from": sfrom, "subject_field": sfield, "preheader": pre,
            "html": html, "text": text, "slots": slots, "items": items}


def _label(text, cls="mute", color=MUTE, pad=20):
    return ('<tr><td class="%s" style="padding:%dpx 0 6px;font-family:%s;font-size:11px;font-weight:700;'
            'letter-spacing:.12em;text-transform:uppercase;color:%s">%s</td></tr>' % (cls, pad, MONO, color, e(text)))


def _rule(pad=16):
    return ('<tr><td style="padding:%dpx 0 0"><div class="rule" style="height:1px;background:%s;'
            'line-height:1px;font-size:0">&nbsp;</div></td></tr>' % (pad, LINE))


def _row(inner, pad="5px 0 0", size=15):
    return ('<tr><td class="ink" style="padding:%s;font-family:%s;font-size:%dpx;line-height:1.45;color:%s">%s</td></tr>'
            % (pad, SANS, size, INK, inner))


def _board_html(daily):
    rows = board_rows(daily)
    if not rows:
        return ""
    stamp, main = board_stamp(daily, rows)
    trs = []
    for r in rows:
        ch = mv(r["key"], r)
        up = (r["last"] - r["prev"]) if r.get("prev") is not None else 0
        cls, col = ("up", UP) if up > 1e-9 else (("down", DOWN) if up < -1e-9 else ("mute", MUTE))
        note = (' <span class="mute" style="color:%s;font-size:12px">%s</span>'
                % (MUTE, "settle" if r.get("kind") == "settle" else "last trade")) if (main and r.get("kind") and r.get("kind") != main) else ""
        trs.append('<tr><td class="ink cell" style="padding:4px 0;font-family:%s;font-size:14px;color:%s;border-bottom:1px solid %s">%s%s</td>'
                   '<td align="right" class="ink cell" style="padding:4px 0;font-family:%s;font-size:14px;font-weight:700;color:%s;border-bottom:1px solid %s;white-space:nowrap">%s</td>'
                   '<td align="right" class="%s cell" style="padding:4px 0 4px 12px;font-family:%s;font-size:13px;color:%s;border-bottom:1px solid %s;white-space:nowrap">%s</td></tr>'
                   % (SANS, INK, LINE, e(r["label"]), note, MONO, INK, LINE, e(px(r["key"], r["last"])),
                      cls, MONO, col, LINE, e(ch)))
    return (_label("The board")
            + ('<tr><td class="mute" style="padding:0 0 6px;font-family:%s;font-size:13px;color:%s">%s</td></tr>' % (SANS, MUTE, e(stamp)) if stamp else "")
            + '<tr><td><table role="presentation" width="100%%" cellpadding="0" cellspacing="0" border="0">%s</table></td></tr>' % "".join(trs))


def _watch(daily):
    out = []
    for w in (daily.get("watch_list") or [])[:2]:
        when, desc = BE.strip_md(w.get("time")), BE.strip_md(w.get("desc"))
        if desc:
            out.append((when, desc))
    for ev in events(daily):
        if len(out) >= 3:
            break
        out.append(("Event", ev["desc"]))
    return out


def _html_body(daily, camp, iso, subj, pre, items, here, pod, fact, offer, rain, local, elevators,
               site_href, unsub_url, forward_url, today):
    date_display = BE.strip_md(daily.get("date")) or iso
    b = ['<div class="mute" style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;'
         'font-size:1px;line-height:1px">%s%s</div>' % (e(pre), PRE_PAD),
         '<tr><td class="mute" style="font-family:%s;font-size:11px;font-weight:700;letter-spacing:.14em;'
         'text-transform:uppercase;color:%s">AGSIST Daily &middot; %s</td></tr>' % (MONO, MUTE, e(date_display))]
    # Today
    b.append(_label("Today", pad=14))
    for x in items:
        tail = (" " + _a(x["url"], x.get("link") or "More", camp, "today-" + x["kind"])) if x.get("url") else ""
        b.append(_row('<span class="gold" style="color:%s">&bull;</span>&nbsp;&nbsp;%s%s' % (GOLD, e(x["text"]), tail),
                      pad="4px 0 0", size=16))
    # the reader's own bids
    if isinstance(local, dict) and local.get("head"):
        det = ""   # the delivery and basis detail stays on the web page
        note = ('<br><span class="mute" style="font-size:13px;color:%s">%s</span>' % (MUTE, e(local["note"]))) if local.get("note") else ""
        b.append('<tr><td style="padding:14px 0 0"><table role="presentation" width="100%%" cellpadding="0" cellspacing="0" border="0"><tr>'
                 '<td class="ink" style="border-left:3px solid %s;padding:3px 0 3px 12px;font-family:%s;font-size:15px;line-height:1.5;color:%s">'
                 '<strong>%s</strong>%s%s</td></tr></table></td></tr>' % (GOLD, SANS, INK, e(local["head"]), det, note))
    mine = BE.elevators_html(elevators)
    if mine:
        b.append(mine)
    # Only here
    if here:
        b.append(_rule())
        b.append(_label("Only here", cls="lab", color=GREEN, pad=14))
        for x in here:
            b.append(_row("%s %s" % (e(x["text"]), _a(SITE + x["url"], x["link"], camp, "onlyhere-" + x["kind"])), pad="3px 0 0"))
    # Print of the day
    if pod:
        b.append(_rule())
        b.append(_label("Print of the day", pad=14))
        make = BE.utm(SITE + pod["make_url"], "print-make", camp)
        b.append('<tr><td style="padding:2px 0 0"><a href="%s"><img class="pic" src="%s" width="552" alt="%s" '
                 'style="display:block;width:100%%;max-width:552px;height:auto;border:1px solid %s"></a></td></tr>'
                 % (BE._href(e(make)), e(pod["image_url"]), e(pod.get("alt") or pod["why"]), LINE))
        b.append(_row(e(pod["why"]), pad="8px 0 0", size=14))
        own = ""
        if offer and isinstance(rain, dict) and rain.get("zip"):
            own = " &middot; " + _a(offer[1], "Yours near %s" % (rain.get("town") or "you"), camp, "rainprint")
        b.append(_row('<strong>%s</strong>%s' % (_a(make, "Make yours →", None), own), pad="6px 0 0", size=15))
    elif offer:
        b.append(_row(_a(offer[1], offer[0], camp, "rainprint", cls="link"), pad="14px 0 0", size=14))
    # I never knew that
    if fact:
        b.append(_rule())
        b.append(_label("I never knew that", pad=14))
        b.append(_row(e(fact["text"]), pad="2px 0 0"))
        src = (_a(fact["url"], fact["source"], None, None, cls="mute link", color=MUTE) if fact.get("url")
               else e(fact["source"] + ("; " + fact["file"] if fact.get("file") else "")))
        b.append('<tr><td class="mute" style="padding:4px 0 0;font-family:%s;font-size:12px;line-height:1.4;color:%s">Source: %s</td></tr>'
                 % (SANS, MUTE, src))
    # the board
    bd = _board_html(daily)
    if bd:
        b.append(_rule())
        b.append(bd)
    w = _watch(daily)
    if w:
        b.append(_rule())
        b.append(_label("What to watch", pad=14))
        for when, desc in w:
            b.append(_row('<span class="gold" style="color:%s;font-family:%s;font-size:12px;font-weight:700">%s</span> %s'
                          % (GOLD, MONO, e(when), e(desc)), pad="3px 0 0", size=14))
    n = daily.get("cca_note")
    if isinstance(n, dict) and str(n.get("text") or "").strip():
        b.append(_row("<strong>From Sig:</strong> " + e(str(n["text"]).strip()), pad="14px 0 0"))
    sp = BE.sponsor_block(daily)
    if sp:
        b.append(sp)
    b.append('<tr><td style="padding:22px 0 0"><table role="presentation" cellpadding="0" cellspacing="0" border="0">'
             '<tr><td class="btn" bgcolor="%s" style="background:%s;border-radius:2px;padding:11px 20px">'
             '<a class="btn" href="%s" style="text-decoration:none;color:#f3ead6;font-family:%s;font-size:13px;font-weight:700;'
             'letter-spacing:.06em;display:inline-block">The full issue and charts &rarr;</a></td></tr></table></td></tr>'
             % (INK, INK, BE._href(BE.utm(BE._unamp(site_href), "button", camp)), MONO))
    if isinstance(local, dict) and local.get("ask_url"):
        b.append('<tr><td class="mute" style="padding:12px 0 0;font-family:%s;font-size:14px;line-height:1.5;color:%s">%s to get your top bid at the top of this email.</td></tr>'
                 % (SANS, MUTE, _a(local["ask_url"], "Add your ZIP", camp, "zip")))
    if forward_url:
        b.append('<tr><td class="mute" style="padding:10px 0 0;font-family:%s;font-size:14px;line-height:1.5;color:%s">Forward to a neighbor. '
                 'Or send them the free sign-up link: %s</td></tr>' % (SANS, MUTE, _a(forward_url, forward_url.split("://", 1)[-1], camp, "forward")))
    foot = 'AGSIST &middot; free US farm markets &middot; %s' % _a("https://agsist.com/", "agsist.com", camp, "footer", cls="mute link", color=MUTE)
    add = BE.elevators_add_url(elevators)
    if add:
        foot += '<br><a class="mute link" href="%s" style="color:%s">%s</a>' % (BE._href(add), MUTE, e(BE.ELEVATOR_ADD_WORDS))
    if unsub_url:
        foot += '<br><a class="mute link" href="%s" style="color:%s">Unsubscribe</a>' % (BE._href(unsub_url), MUTE)
    else:
        foot += "<br>To unsubscribe, reply with subject line: unsubscribe"
    foot += "<br>PO Box 243, Chetek, WI 54728"
    b.append(_rule(22))
    b.append('<tr><td class="mute" style="padding:10px 0 0;font-family:%s;font-size:13px;line-height:1.6;color:%s">%s</td></tr>' % (SANS, MUTE, foot))
    return ('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            '<meta name="x-apple-disable-message-reformatting"><!--[if mso]><style>table,td{border-collapse:collapse;'
            'mso-line-height-rule:exactly}</style><![endif]--><style>%s</style></head>'
            '<body class="bg" style="margin:0;padding:0;background:#f6f3ec">'
            '<table role="presentation" width="100%%" cellpadding="0" cellspacing="0" border="0" style="background:#f6f3ec" class="bg">'
            '<tr><td align="center" style="padding:16px 8px"><!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->'
            '<table role="presentation" width="100%%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:%s" class="card">'
            '<tr><td style="padding:22px 20px">'
            '<table role="presentation" width="100%%" cellpadding="0" cellspacing="0" border="0">%s</table>'
            '</td></tr></table><!--[if mso]></td></tr></table><![endif]--></td></tr></table></body></html>'
            % (DARK, PAPER, "".join(b)))


def _text_body(daily, camp, iso, items, here, pod, fact, offer, rain, local, elevators,
               site_href, unsub_url, forward_url, today):
    L = ["AGSIST DAILY, " + (BE.strip_md(daily.get("date")) or iso), "", "TODAY"]
    for x in items:
        L.append("- " + x["text"] + ((" " + BE.utm(x["url"], "today-" + x["kind"], camp)) if x.get("url") else ""))
    if isinstance(local, dict) and local.get("head"):
        L += ["", local["head"]] + (["  " + local["note"]] if local.get("note") else [])
    if isinstance(elevators, dict):
        L += BE._elevator_block_text(elevators)
    if here:
        L += ["", "ONLY HERE"] + ["- %s %s" % (x["text"], BE.utm(SITE + x["url"], "onlyhere-" + x["kind"], camp)) for x in here]
    if pod:
        L += ["", "PRINT OF THE DAY", pod["why"], "Make yours: " + BE.utm(SITE + pod["make_url"], "print-make", camp)]
        if offer and isinstance(rain, dict) and rain.get("zip"):
            L.append("Yours near %s: %s" % (rain.get("town") or "you", BE.utm(offer[1], "rainprint", camp)))
    elif offer:
        L += ["", offer[0] + " " + BE.utm(offer[1], "rainprint", camp)]
    if fact:
        L += ["", "I NEVER KNEW THAT", fact["text"],
              "Source: " + fact["source"] + ((" " + fact["url"]) if fact.get("url") else ("; " + fact["file"] if fact.get("file") else ""))]
    rows = board_rows(daily)
    if rows:
        stamp, _m = board_stamp(daily, rows)
        L += ["", "THE BOARD" + (" (" + stamp + ")" if stamp else "")]
        for r in rows:
            L.append("  %s %s %s" % (r["label"], px(r["key"], r["last"]), mv(r["key"], r)))
    w = _watch(daily)
    if w:
        L += ["", "WHAT TO WATCH"] + ["  %s: %s" % (a, d) for a, d in w]
    n = daily.get("cca_note")
    if isinstance(n, dict) and str(n.get("text") or "").strip():
        L += ["", "FROM SIG: " + str(n["text"]).strip()]
    L += ["", "The full issue and charts: " + BE.utm(BE._unamp(site_href), "button", camp)]
    if isinstance(local, dict) and local.get("ask_url"):
        L += ["", "Add your ZIP to get your top bid at the top of this email: " + BE.utm(local["ask_url"], "zip", camp)]
    if forward_url:
        L += ["", "Forward to a neighbor. Or send them the free sign-up link: " + BE.utm(forward_url, "forward", camp)]
    L += ["", "AGSIST, free US farm markets, agsist.com"]
    if BE.elevators_add_url(elevators):
        L.append(BE.ELEVATOR_ADD_WORDS + ": " + BE.elevators_add_url(elevators))
    L.append("Unsubscribe: " + unsub_url if unsub_url else "To unsubscribe, reply with subject line: unsubscribe")
    L.append("PO Box 243, Chetek, WI 54728")
    return "\n".join(L) + "\n"


# ── the check that blocks ─────────────────────────────────────────────────
SETTLE_WORDS = re.compile(r"\b(clos(?:e|ed|es|ing)|settle(?:d|s|ment)?|straight (?:days|sessions|closes)|in a row|"
                          r"(?:lower|higher) close)\b", re.I)
COMMODITIES = (("corn-dec", r"corn"), ("beans-nov", r"soybeans?|beans?"), ("wheat", r"wheat"),
               ("cattle", r"cattle"), ("hogs", r"hogs"), ("crude", r"crude|wti"))
_PRICE = re.compile(r"\$(\d+(?:\.\d+)?)([¼½¾])?")
_FR = {"¼": 0.0025, "½": 0.005, "¾": 0.0075}
BLOCK_KINDS_HIGH = {"mismatch", "unsourced_number", "settle_for_last_trade", "wrong_date", "wrong_contract_month"}
BLOCK_KINDS_MEDIUM = {"mismatch", "settle_for_last_trade"}


def price_claims(text):
    """[(key, value, near)] for every $price with a commodity word before it in its
    sentence. `near` is the text from that word to the price plus the words after
    it up to the next comma: where a close or settle word would label this price."""
    out = []
    for sent in re.split(r"(?<=[.;!?])\s+|;\s*", str(text or "")):
        for m in _PRICE.finditer(sent):
            before = sent[:m.start()].lower()
            best, pos = None, -1
            for key, pat in COMMODITIES:
                for mm in re.finditer(r"\b(?:%s)\b" % pat, before):
                    if mm.start() > pos:
                        best, pos = key, mm.start()
            if best:
                after = re.split(r"[,;]| and ", sent[m.end():], maxsplit=1)[0]
                out.append((best, float(m.group(1)) + _FR.get(m.group(2) or "", 0.0), sent[pos:m.end()] + after))
    return out


def code_check(daily, fields):
    """Failures the code can prove: a close/settle word over this morning's last trade."""
    bad = []
    for fname, text in fields.items():
        for key, v, sent in price_claims(text):
            q = _q(daily, key) or _q(daily, key.split("-")[0])
            if not q or q.get("kind") != "last" or q.get("prev") is None or not SETTLE_WORDS.search(sent):
                continue
            tol = 0.0026 if key in GRAIN else 0.03
            if abs(v - q["last"]) <= tol and abs(v - q["prev"]) > tol:
                bad.append({"field": fname, "quote": sent.strip(" ."),
                            "why": "says close or settle, but %s is the %s last trade; the settle was %s"
                                   % (px(q["key"], v), _clock(q.get("at")) or "morning", px(q["key"], q["prev"]))})
    return bad


def saved_findings(path=None):
    path = path or os.environ.get("FACT_CHECK_JSON") or os.path.join(os.environ.get("RUNNER_TEMP") or "/nonexistent", "fact-check.json")
    try:
        with open(path, encoding="utf-8") as f:
            return (json.load(f) or {}).get("findings") or [], path
    except (OSError, ValueError):
        return None, path


def check(daily, built, fact_check_path=None):
    """(blocking failures, notes). Subject, headline and lead only."""
    fields = {"subject": built["subject"], "headline": BE.strip_md(daily.get("headline")), "lead": BE.strip_md(daily.get("lead"))}
    bad = code_check(daily, fields)
    watch = {"headline", "lead"}
    sf = built.get("subject_field") or ""
    if sf.startswith("outside_the_pit["):
        watch.add(sf)
    elif sf.startswith("one_number"):
        watch |= {"one_number.value", "one_number.unit"}
    elif sf == "headline":
        watch.add("headline")
    found, path = saved_findings(fact_check_path)
    notes = []
    if found is None:
        notes.append("no saved fact check at %s; the code check ran alone" % path)
    else:
        for f in found:
            fld, kind, sev = f.get("field"), f.get("kind"), f.get("severity")
            if fld not in watch or not f.get("verified"):
                continue
            if (sev == "high" and kind in BLOCK_KINDS_HIGH) or (sev == "medium" and kind in BLOCK_KINDS_MEDIUM):
                bad.append({"field": fld, "quote": f.get("quote"), "why": "fact check %s %s: %s" % (sev, kind, f.get("expected"))})
        notes.append("saved fact check read: %d finding(s)" % len(found))
    return bad, notes


# ── selftest (hand-worked cases; the real issues are in test/daily-email-v2.test.mjs) ──
def _selftest():
    fails = []

    def ok(c, m):
        if not c:
            fails.append(m)
            print("FAIL", m)
    ok(has_number("USDA to pay $8 billion") and has_number("HPAI in two herds") and not has_number("Rules for 2027"), "has_number")
    ok(is_event({"title": "Winter weather outlook webinar set for Oct 21"}) and not is_event({"title": "Trump-Xi summit ends"}), "events")
    ok(ordinal(6) == "6th" and ordinal(21) == "21st" and ordinal(12) == "12th" and ordinal(3) == "3rd", "ordinal")
    pc = price_claims("Corn closed Tuesday at $4.59½, its sixth lower close in a row, and soybeans at $12.45 made it seven.")
    ok([(k, round(v, 4)) for k, v, _ in pc] == [("corn-dec", 4.595), ("beans-nov", 12.45)], "price claims %r" % pc)
    d = {"headline": "x", "lead": "Corn closed Tuesday at $4.59½.", "locked_prices": {"corn-dec": 4.595, "corn": 4.595},
         "locked_changes": {"corn-dec": {"prev": 4.62, "kind": "last", "at": "2026-10-21T10:46:05Z"}}}
    bad = code_check(d, {"lead": d["lead"]})
    ok(len(bad) == 1 and "$4.62" in bad[0]["why"] and "5:46 a.m. CT" in bad[0]["why"], "settle word over a last trade blocks")
    ok(not code_check(d, {"lead": "Corn closed Tuesday at $4.62."}), "the real settle passes")
    ok(not code_check(d, {"lead": "Corn is at $4.59½ overnight."}), "a last trade called overnight passes")
    ok(clip("USDA to pay farmers $8 billion for harvest fuel aid; diesel at a record") == "USDA to pay farmers $8 billion for harvest fuel aid", "clip at a clause")
    ok(len(clip("A" * 80)) <= SUBJECT_HARD, "hard cap")
    ok(shared_host("https://agsist-subs.dnilgis.workers.dev/u?k=1") and not shared_host("https://agsist.com/e?k=1"), "shared hosts")
    print("daily_v2 selftest " + ("FAILED" if fails else "ok"))
    return 1 if fails else 0


def render_issue(path, zip_local=None, pod=None, fact=None):
    """Preview helper: (built dict) for an archived issue file, as Sig's copy would read."""
    with open(path, encoding="utf-8") as f:
        daily = json.load(f)
    iso = _iso_day(daily)
    return daily, build(daily, "https://agsist.com/daily/%s.html" % iso, forward_url="https://agsist.com/?ref=email-forward",
                        local=zip_local, pod=pod, fact=fact)


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(_selftest())
    if len(sys.argv) > 1 and sys.argv[1].endswith(".json"):
        daily, b = render_issue(sys.argv[1])
        bad, notes = check(daily, b)
        print("SUBJECT:", b["subject"], "(%s)" % b["subject_from"])
        print("PREHEADER:", b["preheader"])
        print("CHECK:", "BLOCKED " + json.dumps(bad) if bad else "passes", notes)
        print(b["text"])
