#!/usr/bin/env python3
"""
daily_v2.py -- the Daily email, rebuilt (Oct 22 2026). Decisions:
the private notes "The Daily email", "print of the day",
"proprietary slot"; the panel record the private notes.

ONE SWITCH. scripts/send_daily.py uses this when DAILY_FORMAT=v2 (the owner
approved it for the list from the Oct 22 2026 morning send). Rollback:
daily.yml's format input set to current, or the repo variable DAILY_FORMAT=current
for the scheduled run; scripts/brief_email.py then builds the old email.
test/daily-email-v2.test.mjs pins the switch.

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
  Oh, that’s interesting  scripts/daily_fact.py, sourced every time (FACT_LABEL;
 was "I didn’t know that", renamed by the owner Nov 1 2026).
  The board   one row per contract (Corn and Corn, Dec fold to one row when
              they are the same quote), stamped honestly: "Last trade 5:46
              a.m. CT, change from Tuesday's settle".
  Forward     "Forward to a neighbor" right under Today (Oct 23: the ask
 people see, not one under the footer).
  Top stories (2026-11-01) the issue's other news items (outside_the_pit, 3 to 5),
              each a linked title (the publisher's link from the news digest,
              attached by code, no tracking added), one line, its tag and
              source. Placed after Today, the forward ask and the reader's own
              bids: the forward ask stays right under Today (Oct 23) and
              the reader's bid is part of Today; the stories come before the
              AGSIST-only slots so the day's news reads as one block. At most
              one story also leads in Today (TODAY_STORIES), never twice.
  What to watch, the full-issue button, footer.
  Print of the day carries the Christmas order-by dates from
  data/rain-print.json (xmas_line), Oct 1 through the framed cutoff only.
Section bodies stay on the web page.

THE NUMBER CHECK THAT BLOCKS (check). A wrong number in the subject, the
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
import contract_calendar  # noqa: E402  first notice day: when Nov beans hand over to Jan
import source_links       # noqa: E402  one rule for "is this url a data file"
import daily_fresh        # noqa: E402  the one memory: a recurring line prints only when its fact changed
import usda_dates         # noqa: E402  report days and the WASDE dates

try:
    from zoneinfo import ZoneInfo
    CT = ZoneInfo("America/Chicago")
except Exception:  # pragma: no cover
    CT = timezone(timedelta(hours=-5))

SUBJECT_MAX = 45
SUBJECT_HARD = 62
TODAY_MIN, TODAY_MAX = 4, 6
MAX_NEWS = 3
FACT_LABEL = "Oh, that’s interesting"   # the fact slot (Nov 1 2026); the text email prints it in capitals
TODAY_STORIES = 1      # top stories that may also be a Today line (the rest go to Top stories)
EMAIL_STORIES = 3      # Top stories lines in the email; a 5th story stays on the web page (two phone screens)
TODAY_WITH_STORIES = 4  # Today lines when the Top stories block is there (it carries the news)
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
# A news subject must be a farm story (Oct 22): grains, oilseeds, livestock,
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


# Nov 9 2026 (subject ranking): a bare number with no verb never leads ("8,795 contracts,
# funds' net long in corn"). The day's number is a value and a noun phrase by design; it may lead
# only when its words carry a verb ("88% soybeans harvested").
VERB = re.compile(r"\b(\w{3,}ed|is|are|was|were|has|have|had|hits?|tops?|sets?|falls?|rises?|gains?|drops?|"
                  r"jumps?|climbs?|slips?|sinks?|surges?|cuts?|adds?|pays?|buys?|sells?|holds?|reaches|leads?|"
                  r"wins?|loses?|ends?|starts?|opens?|closes?)\b", re.I)


def has_verb(s):
    return bool(VERB.search(str(s or "")))


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
    [{text, field, kind: "news"}]. Events are left for What to watch. At most
    TODAY_STORIES of the top stories (a farm story first); the others are shown
    once, under Top stories. A story line carries its publisher link."""
    out, seen = [], set()
    cands = []
    for i, it in enumerate(daily.get("outside_the_pit") or []):
        if not isinstance(it, dict) or is_event(it):
            continue
        t = sentence(it.get("title"))
        if not t or not has_number(t):
            continue
        x = {"text": t, "field": "outside_the_pit[%d].title" % i, "kind": "news", "nums": _nums(t)}
        if story_link(it):
            x.update(url=story_link(it), link=(it.get("source") or "Source").strip(), external=True)
        cands.append(x)
    cands.sort(key=lambda x: 0 if farm_story(x) else 1)      # stable: the writer's order within each
    out += cands[:TODAY_STORIES]
    on = daily.get("one_number")
    if isinstance(on, dict) and on.get("value") and on.get("unit"):
        t = sentence("%s %s" % (BE.strip_md(on["value"]), BE.strip_md(on["unit"])))
        if has_number(t) and not MARKETISH.search(t) and not is_event({"title": t, "body": on.get("context")}):
            fact = daily_fresh.number_fact(on) or {"kind": "number", "key": BE.strip_md(on["unit"]).strip().lower(),
                                                     "value": daily_fresh.norm_value(on["value"]), "text": t}
            out.append({"text": t, "field": "one_number.value", "kind": "news", "nums": _nums(t), "fact": fact,
                        "bare": not has_verb(BE.strip_md(on["unit"]))})
    keep = []
    for x in out:
        big = {n for n in x["nums"] if re.search(r"billion|million|%|\$", n)}
        if big & seen:
            continue        # the same story twice ($8 billion in the news item and the day's number)
        seen |= big
        keep.append(x)
    return keep[:MAX_NEWS]


def story_link(it):
    """The story's publisher link when it is safe to put in front of a reader:
    https, no shared host (build rule 11), no user part."""
    u = str((it or {}).get("link") or "").strip()
    if not u.startswith("https://") or any(c.isspace() for c in u) or "@" in u.split("/")[2] or shared_host(u):
        return ""
    return u


def top_stories(daily, items):
    """The top stories not already a Today line, events left for What to watch.
    [{title, body, tag, link, source}]."""
    used = {x.get("field") for x in items}
    out = []
    for i, it in enumerate(daily.get("outside_the_pit") or []):
        if not isinstance(it, dict) or not it.get("title") or is_event(it):
            continue
        if "outside_the_pit[%d].title" % i in used:
            continue
        out.append({"title": sentence(it.get("title")), "body": sentence(it.get("body")),
                    "tag": BE.strip_md(it.get("tag") or "").strip().upper(), "link": story_link(it),
                    "source": BE.strip_md(it.get("source") or "").strip()})
    return out[:EMAIL_STORIES]


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
            "date": ch.get("date"), "prev_date": ch.get("prev_date"), "contract": ch.get("contract"),
            "pct": ch.get("pct") if isinstance(ch.get("pct"), (int, float)) else None}


HARVEST_KEYS = (("corn", "corn-dec"), ("beans", "beans-nov"))


def past_notice(daily, key):
    """True when the dated harvest key (corn-dec, beans-nov) is on or past its
    first notice day on the issue's date. From then the issue quotes the next
    month (the nearby key, which fetch_prices rolls at first notice): Nov 9
    2026 printed Friday's Nov bean settle as an overnight move."""
    try:
        day = date.fromisoformat(_iso_day(daily)[:10])
    except ValueError:
        return False
    return contract_calendar.past_first_notice(key, day)


def locked_settles(daily, key):
    """{session date: settle} the issue's own lock holds for this key: the prior
    settle, and the price itself when it is a settle. The exchange settle beats
    a harvest-file close (Oct 30: the file's Oct 29 close was 12.205, the settle
    12.1975, and the subject printed $12.20½)."""
    ch = (daily.get("locked_changes") or {}).get(key) or {}
    out = {}
    if isinstance(ch.get("prev"), (int, float)) and ch.get("prev_date"):
        out[str(ch["prev_date"])[:10]] = float(ch["prev"])
    v = (daily.get("locked_prices") or {}).get(key)
    if ch.get("kind") == "settle" and ch.get("date") and isinstance(v, (int, float)):
        out[str(ch["date"])[:10]] = float(v)
    return out


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
    """One row per contract. A row whose lock names its month carries it
    (Nov 1 2026: live cattle rolled from Oct to Dec over a weekend and both
    Fridays read "October"; Nov 9: Jan beans sat beside Nov beans unnamed)."""
    rows = []
    for a, b in BOARD:
        qa, qb = _q(daily, a), (_q(daily, b) if b else None)
        if qa and qb and abs(qa["last"] - qb["last"]) < 1e-9 and qa.get("prev") == qb.get("prev"):
            c = contract_of(daily, b)
            rows.append(dict(qb, label=LABEL[a] + (", " + c if c else ""), key=b))
            continue
        for q in (qa, qb):
            if q:
                lab = LABEL[q["key"]]
                if q.get("contract") and "," not in lab:
                    lab += ", " + q["contract"]
                rows.append(dict(q, label=lab))
    return rows


def kind_note(r, main):
    """The row's own clock when it differs from the board's stamp."""
    if main and r.get("kind") and r.get("kind") != main:
        if r["kind"] == "settle":
            return (_wday(r.get("date"))[:3] + " settle").strip() if r.get("date") else "settle"
        return "last trade"
    return ""


def board_stamp(daily, rows):
    kinds = [r.get("kind") for r in rows if r.get("kind")]
    if not kinds:
        return "", None
    # the most rows; a tie goes to the first row's clock (corn), never to set
    # order: Nov 9 2026 had four of each and the stamp could come out either way
    main = max(kinds, key=lambda k: (kinds.count(k), -kinds.index(k)))
    against = ((daily.get("board") or {}).get("prev_close_session") if main == "last" else "") \
        or next((r.get("prev_date") for r in rows if r.get("kind") == main and r.get("prev_date")), "")
    wd = _wday(against)
    if main == "last":
        at = next((r.get("at") for r in rows if r.get("kind") == "last" and r.get("at")), "")
        return "Last trade %s, change from %s's settle" % (_clock(at) or "this morning", wd or "the last"), main
    day = next((r.get("date") for r in rows if r.get("kind") == "settle" and r.get("date")), "")
    return "%s's settle, change from %s's settle" % (_wday(day) or "The last", wd or "the session before"), main


def settles(crop, before, path=None, locked=None):
    """[(date, settle)] for Dec corn or Nov beans from the harvest price file,
    dated strictly before `before` (what a reader could know that morning).
    `locked` {date: settle} from the issue's own lock replaces the file's value
    on those dates (locked_settles)."""
    try:
        with open(path or HARVEST_PRICES, encoding="utf-8") as f:
            d = json.load(f)
    except (OSError, ValueError):
        return []
    lk = locked or {}
    for c in d.get("commodities") or []:
        if str(c.get("label") or "").lower() == crop:
            ser = ((c.get("harvest") or {}).get("series") or [])
            return [(x["d"], lk.get(str(x["d"]), float(x["s"]))) for x in ser
                    if isinstance(x.get("s"), (int, float)) and str(x.get("d")) < before]
    return []


def streak(crop, before, path=None, locked=None):
    """(n, "lower"/"higher", last settle, its date) or None: the run of settles
    each below (above) the one before, ending at the last settle before `before`."""
    s = settles(crop, before, path, locked)
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


def harvest_streak(daily, crop, key):
    """streak() for the issue: the lock's settles win, and none that ends on a
    settle from the harvest month's delivery period (first notice on; the file
    holds only that month, and the issue quotes the next one by then)."""
    s = streak(crop, _iso_day(daily), locked=locked_settles(daily, key))
    if s and contract_calendar.past_first_notice(key, date.fromisoformat(str(s[3])[:10])):
        return None
    return s


def crop_row(daily, rows, base, dated):
    """The board row a crop's Today line quotes: the harvest month (Dec corn,
    Nov beans) until its first notice day, then the nearby month."""
    if dated in rows and not past_notice(daily, dated):
        return rows[dated]
    return rows.get(base) or rows.get(dated)


def _month_word(r):
    """"Jan " for a nearby row that stands in for a harvest month past first notice."""
    c = str(r.get("contract") or "")
    return (c.split(" ")[0] + " ") if r.get("key") in ("corn", "beans") and c else ""


def overnight_line(c, b):
    """One line for corn and beans, each with its own clock (Nov 9 2026: "beans
    $11.89 (+8¢) at 5:45 a.m. CT" was Friday's settle move)."""
    def bit(name, r):
        return "%s%s %s (%s)" % (_month_word(r), name, px(r["key"], r["last"]), mv(r["key"], r))
    if c.get("kind") == "last" and b.get("kind") == "last":
        return ("Overnight: %s, %s at %s vs %s's settle."
                % (bit("corn", c), bit("beans", b), _clock(c.get("at")) or "this morning",
                   _wday(c.get("prev_date")) or "the last"))
    if c.get("kind") == "settle" and b.get("kind") == "settle" and _wday(c.get("date")) and c.get("date") == b.get("date"):
        return "%s's settle: %s, %s." % (_wday(c.get("date")), bit("corn", c), bit("beans", b))
    if {c.get("kind"), b.get("kind")} == {"last", "settle"}:
        la, se = (c, b) if c.get("kind") == "last" else (b, c)
        ln, sn = ("corn", "beans") if la is c else ("beans", "corn")
        if _wday(se.get("date")):
            return ("Overnight: %s at %s vs %s's settle. %s's settle: %s."
                    % (bit(ln, la), _clock(la.get("at")) or "this morning", _wday(la.get("prev_date")) or "the last",
                       _wday(se.get("date")), bit(sn, se)))
    return "Board: %s, %s." % (bit("corn", c), bit("beans", b))


def market_items(daily):
    items = []
    st = {"corn": harvest_streak(daily, "corn", "corn-dec"), "soybeans": harvest_streak(daily, "soybeans", "beans-nov")}
    bits = []
    for crop, key, name in (("corn", "corn-dec", "Corn"), ("soybeans", "beans-nov", "beans")):
        s = st.get(crop)
        if s and s[0] >= 3:
            bits.append((name, s, key))
    if bits:
        name, s0, key = bits[0]
        txt = "%s %s settled %s %d days running, %s %s" % (name, "has" if name == "Corn" else "have", s0[1], s0[0],
                                                            px(key, s0[2]), _wday(s0[3]) or "")
        for name, s1, key in bits[1:]:
            txt = txt.strip() + "; %s %d%s, %s" % (name, s1[0], "" if s1[1] == s0[1] else " " + s1[1], px(key, s1[2]))
        txt = txt.strip()
        items.append({"text": txt[0].upper() + txt[1:] + ".", "kind": "market", "field": "harvest-prices",
                      "fact": {"kind": "streak", "key": "harvest", "value": [[b[0], b[1][0], b[1][1], str(b[1][3])] for b in bits]}})
    rows = {r["key"]: r for r in board_rows(daily)}
    c = crop_row(daily, rows, "corn", "corn-dec")
    b = crop_row(daily, rows, "beans", "beans-nov")
    if c and b and c.get("prev") is not None and b.get("prev") is not None:
        items.append({"text": overnight_line(c, b), "kind": "market", "field": "locked_changes", "overnight": True,
                      "moves_c": [abs(r["last"] - r["prev"]) * 100 for r in (c, b)],
                      "fact": {"kind": "overnight", "key": "corn-beans", "value": _iso_day(daily)}})
    return items, st


def big_move(daily):
    """The largest grain or livestock move of 2% or more, or crude 4%: (label, pct, q) or None."""
    best = None
    for key in ("corn-dec", "corn", "beans-nov", "beans", "wheat", "cattle", "feeders", "hogs", "crude"):
        q = _q(daily, key)
        if not q or q.get("pct") is None or past_notice(daily, key):
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
                        "kind": "rank", "pct": r["pct"], "name": name, "field": "price-stats",
                        "fact": {"kind": "percentile", "key": name.lower(), "value": int(r["pct"])}})
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
    if isinstance(left, int):
        left = max(0, left)   # the clock stops at 0 (Oct 31 2026 printed "0 trading days left")
        tail = (". Last trading day done." if left == 0 else ". 1 trading day left." if left == 1
                else ". %d trading days left." % left)
    else:
        tail = "."
    txt = "Harvest price so far: " + "; ".join(parts) + tail
    top = crops[0]
    return {"text": txt, "kind": "clock", "field": "harvest_clock", "url": BE.CLOCK_URL, "link": "Tracker",
            "fact": {"kind": "clock", "key": "harvest", "value": [[c["crop"], round(c["pct"], 1)] for c in crops] + [left]},
            "subject": "%s harvest price %.1f%% %s projected" % ("Bean" if top["crop"].lower().startswith("soy") else "Corn",
                                                                abs(top["pct"]), "over" if top["pct"] >= 0 else "under")}


# ── recurring lines, each with its own rule (Daily panel, Nov 9 2026) ──
RANK_FILL = 1
OVERNIGHT_MIN_C = 5.0      # the overnight line prints on a move of 5 cents or more, never on a weekend


def overnight_news(daily, x, today):
    """The overnight (or settle) line is news only on a weekday with a move of OVERNIGHT_MIN_C cents
    or more in corn or beans. Nov 7 and 8 2026 (a Saturday and Sunday) printed Friday's settle again;
    Nov 9's line was corn +1½¢ and beans +1¢."""
    if not isinstance(today, date) or today.weekday() >= 5:
        return False
    return max(x.get("moves_c") or [0]) >= OVERNIGHT_MIN_C - 1e-9


FUND_KEYS = (("corn", "corn"), ("beans", "soybeans"), ("wheat", "wheat"), ("livecattle", "live cattle"))


def _md_short(iso):
    d = date.fromisoformat(str(iso)[:10])
    return "%s %d" % (MON3[d.month - 1], d.day)


def fund_streak(hist_rows):
    """(weeks, total change, start date) of the run of weekly net changes of one sign that ends
    at the newest week, or None."""
    rows = [r for r in hist_rows or [] if isinstance(r.get("net"), (int, float)) and r.get("date")]
    if len(rows) < 2:
        return None
    d = [rows[i]["net"] - rows[i - 1]["net"] for i in range(1, len(rows))]
    if d[-1] == 0:
        return None
    sign = d[-1] > 0
    n = 0
    for x in reversed(d):
        if x != 0 and (x > 0) == sign:
            n += 1
        else:
            break
    return n, rows[-1]["net"] - rows[-1 - n]["net"], rows[-1 - n]["date"]


def funds_item(today, cot=None, hist=None, repo=REPO):
    """Saturday only, once per CFTC release (Nov 9 2026), told as the streak: the
    market with the longest run of weekly net changes of one sign, its weeks and the
    contracts since the turn (Nov 7 2026: seven weeks, 414,460 to 8,795). None on any
    other day, before the release, or when the files do not agree on the week."""
    if not isinstance(today, date) or today.weekday() != daily_fresh.FUNDS_WEEKDAY:
        return None
    try:
        import cot_calendar
        if cot is None:
            with open(os.path.join(repo, "data", "cot.json"), encoding="utf-8") as f:
                cot = json.load(f)
        if hist is None:
            with open(os.path.join(repo, "data", "cot-history.json"), encoding="utf-8") as f:
                hist = json.load(f)
        as_of = datetime.strptime(str((cot or {}).get("report_date") or ""), "%B %d, %Y").date()
        if cot_calendar.release_unknown(as_of):
            return None
        rel = cot_calendar.release_date(as_of)
    except Exception:
        return None
    if not 1 <= (today - rel).days <= 6:
        return None
    best = None
    for key, name in FUND_KEYS:
        rows = ((hist or {}).get("history") or {}).get(key) or []
        if not rows or str(rows[-1].get("date")) != as_of.isoformat():
            continue
        net_now = ((cot or {}).get(key) or {}).get("net")
        if net_now is not None and net_now != rows[-1]["net"]:
            continue        # the two files disagree on the week: say nothing
        st = fund_streak(rows)
        # corn first when it has a run of two weeks or more (the market most readers sell); else the longest run
        if st and (best is None or (best[0] != "corn" or best[1][0] < 2) and st[0] > best[1][0]):
            best = (name, st, rows[-1]["net"])
    if not best:
        return None
    name, (n, total, since), net = best
    side = "long" if net >= 0 else "short"
    verb = "bought" if total > 0 else "sold"
    if n == 1:
        txt = ("Funds turned and %s %s in the week to %s: net %s contracts %s, %s %s on the week (CFTC)."
               % (verb, name, _md_short(as_of), "{:,}".format(abs(net)), side, "up" if total > 0 else "down",
                  "{:,}".format(abs(total))))
    else:
        txt = ("Funds have %s %s %d weeks running: net %s contracts %s as of %s, %s %s since %s (CFTC)."
               % (verb, name, n, "{:,}".format(abs(net)), side, _md_short(as_of), "up" if total > 0 else "down",
                  "{:,}".format(abs(total)), _md_short(since)))
    key = _commodity_key(name)
    return {"text": txt, "kind": "funds", "field": "cot",
            "fact": {"kind": "funds", "key": key, "value": as_of.isoformat(), "text": txt}}


def _commodity_key(name):
    return {"soybeans": "soybeans", "live cattle": "cattle"}.get(name, name)


REPORT_TIME = "11 a.m. CT"
BEAT = (("corn_yield_2627", "Corn yield", "bu", "%.1f"), ("soy_yield_2627", "Soybean yield", "bu", "%.1f"),
        ("corn_2627", "Corn ending stocks", "billion bu", "%.3f"), ("soy_2627", "Soybean ending stocks", "million bu", "%d"))


def number_to_beat(today, est=None, wasde=None, repo=REPO):
    """"Corn yield trade range 173.2 to 182.1 bu (average 177.8); USDA said 181.2 in October." for a report
    dated today, from data/analyst-estimates.json (a range published before the report) and
    data/wasde.json (last release's figure). "" when no range is in hand: withheld, never guessed."""
    try:
        if est is None:
            with open(os.path.join(repo, "data", "analyst-estimates.json"), encoding="utf-8") as f:
                est = json.load(f)
        if wasde is None:
            with open(os.path.join(repo, "data", "wasde.json"), encoding="utf-8") as f:
                wasde = json.load(f)
    except (OSError, ValueError):
        return ""
    rep = next((r for r in (est or {}).get("reports") or [] if r.get("date") == today.isoformat()), None)
    if not rep:
        return ""
    ms = {m.get("key"): m for m in rep.get("metrics") or []}
    for key, label, unit, fmt in BEAT:
        m = ms.get(key)
        rng = (m or {}).get("consensus_range") or []
        if not m or len(rng) != 2 or not all(isinstance(x, (int, float)) for x in rng):
            continue
        src = str(m.get("consensus_source_date") or "")
        if not src or src >= today.isoformat():
            continue        # a survey from the report day itself may be later than this email
        txt = "%s trade range %s to %s %s" % (label, fmt % rng[0], fmt % rng[1], unit)
        if isinstance(m.get("consensus"), (int, float)):
            txt += " (average %s)" % (fmt % m["consensus"])
        prev = next((w for w in (wasde or {}).get("metrics") or [] if w.get("key") == key), None)
        rel = str((wasde or {}).get("release") or "")
        if prev and isinstance(prev.get("value"), (int, float)) and rel and rel < today.isoformat():
            txt += "; USDA said %s in %s" % (fmt % prev["value"], date.fromisoformat(rel).strftime("%B"))
        return txt + "."
    return ""


def report_item(today, repo=REPO, est=None, wasde=None, events=None):
    """The report day or deadline line (Nov 9 2026: it outranks the day's number). A USDA
    report that moves grain today (usda_dates.major_reports) with the number to beat when a trade
    range is in hand; else an FSA deadline today or tomorrow (usda-calendar.ics). None otherwise."""
    if not isinstance(today, date):
        return None
    reps = usda_dates.major_reports(today)
    if reps:
        names = reps[0] if len(reps) == 1 else ", ".join(reps[:-1]) + " and " + reps[-1]
        txt = "USDA %s today, %s." % (names, REPORT_TIME)
        beat = number_to_beat(today, est, wasde, repo)
        if beat:
            txt += " " + beat
        return {"text": txt, "kind": "report", "field": "report-day",
                "fact": {"kind": "report", "key": names, "value": today.isoformat(), "text": txt}}
    try:
        import daily_more
        evs = events if events is not None else daily_more.read_ics(os.path.join(repo, "usda-calendar.ics"))
    except Exception:
        return None
    for ev in sorted(evs or [], key=lambda e: e["date"]):
        n = (ev["date"] - today).days
        if ev["summary"].endswith("(FSA)") and "deadline" in ev["summary"].lower() and n in (0, 1):
            name = re.sub(r"\s*\(FSA\)$", "", ev["summary"])
            txt = "FSA: %s is %s, %s %s." % (name, "today" if n == 0 else "tomorrow", ev["date"].strftime("%a"),
                                             _md_short(ev["date"].isoformat()))
            return {"text": txt, "kind": "report", "field": "report-day",
                    "fact": {"kind": "report", "key": name, "value": ev["date"].isoformat(), "text": txt}}
    return None


def wasde_watch_ok(when, desc, today):
    """What to watch names the WASDE only the day before and the day of (Nov 3 to 9 2026: seven
    issues running, "1.849" three times)."""
    if not re.search(r"\bWASDE\b", "%s %s" % (when or "", desc or "")):
        return True
    if not isinstance(today, date):
        return True
    nw = usda_dates.next_wasde(today)
    return bool(nw) and (nw - today).days in (0, 1)


def wow_item(daily, state=None):
    """The state basis line for this reader (the generator decided it prints today and kept the
    rows on the issue as basis_wow), the reader's state first; None on a quiet week."""
    import only_here as OH
    bw = daily.get("basis_wow")
    if not isinstance(bw, dict) or not bw.get("print") or not bw.get("rows"):
        return None
    txt = OH.wow_text(bw["rows"], state)
    if not txt:
        return None
    return {"text": txt, "kind": "basis_wow", "field": "basis_wow", "url": SITE + "/basis", "link": "Basis by state",
            "only_here": True}


# ── the inbox row ─────────────────────────────────────────────────────────
CONNECTIVES = (" as ", " after ", " amid ", " while ", " ahead of ", " before ", " despite ", " but ")
DANGLING = {"the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "as", "at", "by", "from", "its"}


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
    # no clause mark: cut before a connective (Nov 9 2026: "Crude slips 2.9% to $88.18 as Trump signals no
    # new Iran strikes" cut at 62 read "... no new Iran"; before "as" it reads "Crude slips 2.9% to $88.18")
    best = max((s.rfind(w, 0, hard + 1) for w in CONNECTIVES), default=-1)
    if best >= 20:
        return s[:best].rstrip(" ,;:")
    cut = s.rfind(" ", 0, hard)
    out = (s[:cut] if cut >= 20 else s[:hard]).rstrip(" ,;:")
    # never end on a little word (Nov 8 2026 would have read "... crop report lead the")
    while True:
        head, _sp, last = out.rpartition(" ")
        if not head or len(head) < 20 or last.lower() not in DANGLING:
            return out
        out = head.rstrip(" ,;:")


def subject(daily, news=None, today=None, fresh=None, report=None):
    """(subject, where it came from, the field it rests on). Nov 9 2026: a report day or
    deadline outranks the day's number, and a bare number with no verb never leads. `fresh`
    (a line -> bool) is the memory: a line that may not print in Today does not lead either."""
    fresh = fresh or (lambda x: True)
    news = news_items(daily) if news is None else news
    if report is None:
        report = report_item(today)
    if report and fresh(report):
        return clip(report["text"]), "report", report["field"]
    for x in news:
        if x.get("bare") or not fresh(x):
            continue
        if not ELEVATOR.search(x["text"]) and farm_story(x, daily):
            return clip(x["text"]), "news", x["field"]
    iso = _iso_day(daily)
    mk = market_items(daily)[0]
    streak_ok = all(fresh(x) for x in mk if x.get("field") == "harvest-prices")
    for crop, key, name in (("corn", "corn-dec", "Corn"), ("soybeans", "beans-nov", "Beans")):
        s = harvest_streak(daily, crop, key)
        if s and s[0] >= 4 and streak_ok:
            return clip("%s%s %s %s close in a row: %s" % (name, "'s" if name == "Corn" else "'", ordinal(s[0]), s[1],
                                                           px(key, s[2]))), "market", "harvest-prices"
    bm = big_move(daily)
    if bm and (bm[2].get("kind") == "last" or (isinstance(today, date) and today.weekday() < 5)) \
            and fresh({"fact": {"kind": "move", "key": bm[2]["key"], "value": str(bm[2].get("date") or iso)}}):
        # a settle move never leads a weekend issue (Nov 7 and 8 2026 would have led with Friday's hogs)
        label, p, q = bm
        when = ("overnight" if q.get("kind") == "last" else (_wday(q.get("date")) or "")).strip()
        txt = "%s %s %.1f%% %s to %s" % (label, "up" if p > 0 else "down", abs(p), when, px(q["key"], q["last"]))
        return clip(txt.replace("  ", " ")), "market", "locked_changes"
    ranks = [r for r in rank_items(daily) if (r["pct"] <= 5 or r["pct"] >= 95) and fresh(r)]
    if ranks:
        return clip(ranks[0]["text"].split(" (")[0]), "rank", "price-stats"
    ck = clock_item(daily, today)
    if ck and fresh(ck):
        return clip(ck["subject"]), "clock", "harvest_clock"
    head = sentence(daily.get("headline"))
    if head and not ELEVATOR.search(head):
        return clip(head), "headline", "headline"
    return "The Daily for %s" % (_wday(iso) or "today"), "date", None


def today_items(daily, today=None, fresh=None, report=None, funds=None):
    """4 to 6 lines, each with its number, the subject's story first. Each recurring line passes
    its own rule (overnight_news) and the memory (`fresh`); a quiet day gives a shorter list,
    never a repeat."""
    fresh = fresh or (lambda x: True)
    if report is None:
        report = report_item(today)
    if funds is None:
        funds = funds_item(today)
    news = news_items(daily)
    if funds:       # one fund line per release: the streak, not also the writer's number off the same report
        news = [x for x in news if (x.get("fact") or {}).get("kind") != "funds"]
    mk, _st = market_items(daily)
    mk = [x for x in mk if not x.get("overnight") or overnight_news(daily, x, today)]
    ck = clock_item(daily, today)
    items = ([report] if report else []) + list(news) + ([funds] if funds else []) + mk + ([ck] if ck else [])
    items = [x for x in items if fresh(x)]
    if len(items) < TODAY_MIN:
        # at most RANK_FILL percentile lines fill a short list: a quiet Daily is fine, a list of
        # standing percentiles is not news (Nov 9 2026)
        fill = 0
        for r in sorted(rank_items(daily), key=lambda r: -abs(r["pct"] - 50)):
            if len(items) >= TODAY_MIN or fill >= RANK_FILL:
                break
            if fresh(r):
                items.append(r)
                fill += 1
    items = [x for x in items if has_number(x["text"]) and not ELEVATOR.search(x["text"]) and not COUNT_LINE.search(x["text"])]
    return items[:TODAY_MAX]


def quiet_preheader(daily, subj):
    """The preheader on a day with nothing else to say (a quiet Today, Nov 9 2026): the day's top
    news headline, else the top story's title, else the teaser; never the subject again when
    anything else is there, and never empty."""
    cands = [sentence(daily.get("headline"))]
    cands += [sentence(it.get("title")) for it in (daily.get("outside_the_pit") or []) if isinstance(it, dict)]
    cands += [sentence(daily.get("teaser"))]
    cands = [c.rstrip(".") for c in cands if c and not ELEVATOR.search(c)]
    other = [c for c in cands if c != subj.rstrip(".") and not c.startswith(subj.rstrip("."))]
    return (other or cands or ["The AGSIST Daily for %s" % (_wday(_iso_day(daily)) or "today")])[0]


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
# Not a raw count of elevators (Oct 22): a comparison against history,
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


def here_words(x, news):
    """The line with its record sentence (only_here rain_line "record") kept only when news(fact) says the
    county's rank entered or moved since the issue that last printed it."""
    r = x.get("record")
    if not isinstance(r, dict) or not r.get("text"):
        return x
    if isinstance(r.get("fact"), dict) and news(r["fact"]):
        return x
    return dict(x, text=x["text"].replace(r["text"], "").rstrip(), record=None)


_MEMO = {}


def _memory(today):
    """daily_fresh.memory(today), read once per send run (every reader's build asks for the same days)."""
    k = ("memory", today.isoformat(), id(daily_fresh.memory))
    if k not in _MEMO:
        _MEMO[k] = daily_fresh.memory(today)
    return _MEMO[k]


def zip_facts(iso):
    k = ("zip", iso)
    if k not in _MEMO:
        _MEMO[k] = _zip_facts(iso)
    return [dict(f) for f in _MEMO[k]]


def _zip_facts(iso):
    """The facts this issue carried to ZIP readers, whoever they are: each state's land month (daily_land_line),
    each county's record rank (only_here.record_facts) and each county station's rain line (only_here.rain_facts,
    Nov 10 2026). Saved with the no-ZIP reader's printed list
    (send_daily save_sent_copy), so the memory stays per issue and holds no reader's place."""
    out = []
    try:
        import daily_land_line
        out += daily_land_line.issue_facts(iso)
    except Exception as ex:
        print("land facts skipped (%s)" % type(ex).__name__)
    try:
        import only_here as OH
        out += OH.record_facts(iso)
    except Exception as ex:
        print("record facts skipped (%s)" % type(ex).__name__)
    try:
        import only_here as OH
        out += OH.rain_facts(iso)
    except Exception as ex:
        print("rain line facts skipped (%s)" % type(ex).__name__)
    return out


def reader_state(rain=None, loc=None):
    """The reader's two-letter state from the saved place (loc) or the ZIP's town, else None."""
    if isinstance(loc, (tuple, list)) and len(loc) > 2 and loc[2]:
        return loc[2]
    z = (rain or {}).get("zip") if isinstance(rain, dict) else None
    if not z:
        return None
    try:
        import only_here as OH
        w = OH.where(z)
        return w[2] if w else None
    except Exception:
        return None


def promote_wow(items, line, cap):
    """Items with the state basis line second (Nov 9 2026: it takes the Today slot the North
 Dakota basis line held, Nov 2 #258). No line on a quiet week: nothing takes the slot."""
    if not line or not has_number(line.get("text") or "") or COUNT_LINE.search(line["text"]):
        return items
    pos = 1 if items else 0
    return (items[:pos] + [line] + items[pos:])[:cap]


# ── links ────────────────────────────────────────────────────────────────
def shared_host(u):
    try:
        import urllib.parse
        h = (urllib.parse.urlsplit(str(u)).hostname or "").lower()
    except ValueError:
        return False
    return any(h == s or h.endswith("." + s) for s in SHARED_HOSTS)


MON3 = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


def xmas_line(today=None, cfg=None):
    """The Christmas order-by sentence for the Print of the day block, or "".

    From data/rain-print.json (the same two cutoffs /rain-print and
    /gifts-for-farmers print, never typed here): shown from Oct 1 of the
    cutoffs' year through framed_christmas_cutoff (Dec 9 in 2026), and gone the
    day after. A date that cannot be read means no line. Never a countdown."""
    if cfg is None:
        try:
            with open(BE.RAIN_PRINT_JSON, encoding="utf-8") as f:
                cfg = json.load(f)
        except Exception:
            return ""
    pc, fc = str((cfg or {}).get("print_christmas_cutoff") or ""), str((cfg or {}).get("framed_christmas_cutoff") or "")
    try:
        p, fr = date.fromisoformat(pc), date.fromisoformat(fc)
    except ValueError:
        return ""
    t = today if isinstance(today, date) else BE._chicago_today(today)
    if p.year != fr.year or t < date(fr.year, 10, 1) or t > fr:
        return ""
    md = lambda d: "%s %d" % (MON3[d.month - 1], d.day)
    if p >= fr:
        return "For Christmas delivery, order a framed print by %s, a print by %s." % (md(fr), md(p))
    return "For Christmas delivery, order a print by %s, a framed print by %s." % (md(p), md(fr))


def _a(url, text, camp=None, content=None, cls="link", color=GOLD):
    u = BE.utm(url, content, camp) if content else url
    return '<a class="%s" href="%s" style="color:%s">%s</a>' % (cls, BE._href(e(u) if "&amp;" not in u else u), color, e(text))


# ── the email ────────────────────────────────────────────────────────────
# 2026-11-07 (Nov 6: grow the Funds this week list): the issue the morning
# after a COT release (Saturday, or Tuesday after a Monday release in a holiday
# week) carries one line offering Funds this week, linked to the one signup box
# on /cot (#cot-signup). Release from scripts/cot_calendar.py; no report date,
# a shutdown report or any error means no line. No number in it.
FUNDS_URL = "https://agsist.com/cot#cot-signup"
FUNDS_LINE = ("Funds this week: where the big funds sit in corn, soybeans, wheat and cattle, "
              "one short free email after each COT report.")


def funds_offer(today, cot=None):
    """(line, url) on the day after the latest COT release, else None."""
    if not isinstance(today, date):
        return None
    try:
        import cot_calendar
        if cot is None:
            with open(os.path.join(os.path.dirname(HERE), "data", "cot.json"), encoding="utf-8") as f:
                cot = json.load(f)
        # data/cot.json writes "November 3, 2026" (as send_cot_weekly.as_of_date reads it)
        as_of = datetime.strptime(str((cot or {}).get("report_date") or ""), "%B %d, %Y").date()
        if cot_calendar.release_unknown(as_of):
            return None
        rel = cot_calendar.release_date(as_of)
    except Exception:
        return None
    return (FUNDS_LINE, FUNDS_URL) if (today - rel).days == 1 else None


def build(daily, site_href, unsub_url=None, elevators=None, local=None, forward_url=None, today=None,
          rain=None, pod=None, fact=None, loc=None, county=None, county_ask=None, group=None, cot=None, memory=None):
    """{"subject", "subject_from", "subject_field", "preheader", "html", "text", "slots"}."""
    camp = BE.campaign_of(daily)
    iso = _iso_day(daily)
    if today is None:
        try:
            today = date.fromisoformat(iso)
        except ValueError:
            today = None
    # the one memory (scripts/daily_fresh.py): what the last issues printed, by fact
    if memory is None:
        try:
            memory = _memory(today) if isinstance(today, date) else []
        except Exception as ex:
            print("memory skipped (%s); every line judged on its own rule" % type(ex).__name__)
            memory = []
    # still_news reads only the entries of the fact's own kind and key: grouped once, since an issue's ZIP facts
    # hold one rain line per county station (about 1,800) and every reader's build judges them
    by_key = {}
    for m in memory or []:
        if isinstance(m, dict):
            by_key.setdefault((m.get("kind"), m.get("key")), []).append(m)

    def is_news(f):
        mine = by_key.get((f.get("kind"), f.get("key")), [])
        if f.get("kind") == "rain_line":
            # an issue keeps its rain lines as one usual day plus the stations off it (daily_fresh.issue_facts):
            # the usual day is key "*", and a station named on the same day comes after it
            mine = sorted(mine + by_key.get(("rain_line", "*"), []), key=lambda m: (str(m.get("date")), m.get("key") != "*"))
        return not isinstance(today, date) or daily_fresh.still_news(f, mine, today)[0]

    def fresh(x):
        f, fs = x.get("fact"), [g for g in (x.get("facts") or []) if isinstance(g, dict)]
        return (not f or is_news(f)) and (not x.get("facts") or any(is_news(g) for g in fs))
    report = report_item(today)
    funds_l = funds_item(today)
    news = news_items(daily)
    subj, sfrom, sfield = subject(daily, news, today, fresh, report)
    items = today_items(daily, today, fresh, report, funds_l)
    # the subject's story leads the Today list
    lead = [x for x in items if x.get("field") == sfield or (sfrom == "market" and x.get("field") == sfield)]
    items = lead[:1] + [x for x in items if x not in lead[:1]]
    cap = TODAY_WITH_STORIES if top_stories(daily, items) else TODAY_MAX
    items = items[:cap]
    # 2026-11-10: a ZIP reader's land line and the record sentence on their rain line go through the same
    # memory, by the issue's own facts (per state and per county, never per reader): Nov 5 to 10 both reprinted
    # word for word. The record words are cut, the rain line stays; one line of a kind per issue.
    here = [here_words(x, is_news) for x in only_here(daily, rain, loc) if fresh(x)]
    here = [x for i, x in enumerate(here) if x.get("kind") not in {y.get("kind") for y in here[:i]}]
    # 2026-11-09: the state week-over-week basis line takes the Today slot the
    # North Dakota basis line held since Nov 2, the reader's state first; on a quiet week
    # nothing takes it. The generator decided whether it prints (basis_wow on the issue).
    items = promote_wow(items, wow_item(daily, reader_state(rain, loc)), cap)
    pre = preheader(local, items, subj, sfield) or quiet_preheader(daily, subj)
    if unsub_url and shared_host(unsub_url):
        unsub_url = None          # build rule 11: nothing a reader clicks on a shared host
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
    funds = funds_offer(today, cot)
    cw = county_block(county)
    if cw and any(r.get("label") == "Land sales" for r in cw["rows"]):
        here = [x for x in here if x.get("kind") != "land_sales"]     # the county block tells the month's sales
    stories = top_stories(daily, items)
    slots = {"today": len(items), "only_here": len(here), "print": bool(pod), "fact": bool(fact), "county": bool(cw),
             "top_stories": len(stories), "funds": bool(funds), "weekend": bool(weekend_block(daily)),
             "bid_week": bool(own_week(daily, local))}
    ask = county_ask_link(county_ask)
    html = _html_body(daily, camp, iso, subj, pre, items, here, pod, fact, offer, rain, local, elevators,
                      site_href, unsub_url, forward_url, today, county=cw, county_ask=ask, stories=stories, funds=funds)
    text = _text_body(daily, camp, iso, items, here, pod, fact, offer, rain, local, elevators,
                      site_href, unsub_url, forward_url, today, county=cw, county_ask=ask, stories=stories, funds=funds)
    html, text = tag_group(html, group, True), tag_group(text, group, False)
    printed = [dict(x["fact"], text=x["text"]) for x in items + here if x.get("fact")]
    # every station's rain line is kept each issue, news or not: the sent copy stores them as the usual day plus
    # the stations off it, so a full set costs a few KB (send_daily save_sent_copy)
    printed += [f for f in zip_facts(iso) if f.get("kind") == "rain_line" or is_news(f)]
    if sfrom == "market" and sfield == "locked_changes" and big_move(daily):
        q = big_move(daily)[2]
        printed.append({"kind": "move", "key": q["key"], "value": str(q.get("date") or iso), "text": subj})
    return {"subject": subj, "subject_from": sfrom, "subject_field": sfield, "preheader": pre,
            "html": html, "text": text, "slots": slots, "items": items, "printed": printed}


# ── Your county this week (Oct 27 2026: inside the existing slots, Thursdays) ──
# The block is made by components/change-lines.js through scripts/county_week.mjs (send_daily.py
# load_county_week): only readers who ticked it in the Daily ask and saved a place, only on
# Thursdays, and only when something changed. It rides in the "Only here" slot. Its one link is
# tagged utm_content=countyweek so its click share can be counted against the other sections.
CW_CONTENT = "countyweek"
CW_KINDS = ("changed", "level", "held")


def county_block(c):
    """The block as the email draws it, or None: a county, a site path and at least one changed row."""
    if not isinstance(c, dict) or not isinstance(c.get("block"), dict):
        return None
    rows = [r for r in (c["block"].get("rows") or []) if isinstance(r, dict) and r.get("kind") in CW_KINDS
            and str(r.get("text") or "").strip() and str(r.get("date") or "").strip() and str(r.get("src") or "").strip()]
    if not any(r["kind"] == "changed" for r in rows):
        return None
    url = str(c.get("url") or "")
    if not re.match(r"^/[a-z0-9/_?=.-]*$", url):
        return None
    name, st = str(c.get("county") or "").strip(), str(c.get("st") or "").strip()
    if not name or not re.match(r"^[A-Z]{2}$", st):
        return None
    return {"title": "Your county this week: %s, %s" % (name, st), "rows": rows, "url": SITE + url,
            "link": "%s home" % name}


# A reader already on the Daily turns it on from the footer (subs worker v5.57, /daily-cw): the
# reader's own signed front-door link (send_daily.county_ask_url), never pre-set. A reader who
# has it on gets the same link worded as the way to stop it.
CW_ASK_WORDS = "Add what changed in your county on Thursdays"
CW_STOP_WORDS = "Stop the Thursday county lines"


def county_ask_link(a):
    """{"url", "words"} for the footer, or None: an agsist.com/e?a=daily-cw link only."""
    if not isinstance(a, dict):
        return None
    url = str(a.get("url") or "")
    if not url.startswith("https://agsist.com/e?a=daily-cw&") or shared_host(url):
        return None
    return {"url": url, "words": CW_STOP_WORDS if a.get("on") is True else CW_ASK_WORDS}


# The holdout for the keep or cut rule (send_daily.cw_group): every agsist.com link in the issue of
# a reader who ticked the block carries utm_term=cw-block or cw-hold, the arm, never the reader. The
# signed front-door links carry no utm at all, so they are untouched.
GROUPS = ("cw-block", "cw-hold")


def tag_group(body, group, html):
    if group not in GROUPS or not body:
        return body
    return str(body).replace("utm_medium=email", "utm_medium=email" + ("&amp;" if html else "&") + "utm_term=" + group)


def _county_html(cw, camp):
    out = [_row('<strong>%s</strong>' % e(cw["title"]), pad="12px 0 0")]
    for r in cw["rows"]:
        out.append(_row('<strong>%s.</strong> %s' % (e(r["label"]), e(r["text"])), pad="4px 0 0", size=14))
        out.append('<tr><td class="mute" style="padding:1px 0 0;font-family:%s;font-size:12px;line-height:1.4;color:%s">%s &middot; %s</td></tr>'
                   % (SANS, MUTE, e(r["date"]), e(r["src"])))
    out.append(_row(_a(cw["url"], cw["link"] + " →", camp, CW_CONTENT), pad="6px 0 0", size=14))
    return out


def _county_text(cw, camp):
    out = ["", cw["title"]]
    for r in cw["rows"]:
        out.append("- %s. %s (%s; %s)" % (r["label"], r["text"], r["date"], r["src"]))
    out.append(cw["link"] + ": " + BE.utm(cw["url"], CW_CONTENT, camp))
    return out


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
        kn = kind_note(r, main)
        note = (' <span class="mute" style="color:%s;font-size:12px">%s</span>' % (MUTE, e(kn))) if kn else ""
        trs.append('<tr><td class="ink cell" style="padding:4px 0;font-family:%s;font-size:14px;color:%s;border-bottom:1px solid %s">%s%s</td>'
                   '<td align="right" class="ink cell" style="padding:4px 0;font-family:%s;font-size:14px;font-weight:700;color:%s;border-bottom:1px solid %s;white-space:nowrap">%s</td>'
                   '<td align="right" class="%s cell" style="padding:4px 0 4px 12px;font-family:%s;font-size:13px;color:%s;border-bottom:1px solid %s;white-space:nowrap">%s</td></tr>'
                   % (SANS, INK, LINE, e(r["label"]), note, MONO, INK, LINE, e(px(r["key"], r["last"])),
                      cls, MONO, col, LINE, e(ch)))
    return (_label("The board")
            + ('<tr><td class="mute" style="padding:0 0 6px;font-family:%s;font-size:13px;color:%s">%s</td></tr>' % (SANS, MUTE, e(stamp)) if stamp else "")
            + '<tr><td><table role="presentation" width="100%%" cellpadding="0" cellspacing="0" border="0">%s</table></td></tr>' % "".join(trs))


def _adds_html(daily):
    """Week/month/year price change and the USDA weather lines, under the board."""
    rows = []
    for w in (daily.get("price_windows") or []):
        its = ", ".join("%s %s" % (i["name"], i["text"]) for i in w.get("items") or [])
        if its:
            rows.append(_row('<b>%s:</b> %s' % (e(w["label"]), e(its)), pad="4px 0 0", size=13))
    aw = daily.get("ag_weather") or {}
    if aw.get("text"):
        rows.append(_row('<b>USDA weather:</b> %s <span class="mute" style="color:%s;font-size:12px">Source: %s.</span>'
                         % (e(aw["text"]), MUTE, e(aw.get("source") or "USDA")), pad="8px 0 0", size=13))
    return "".join(rows)


def _adds_text(daily):
    L = ["  " + t for t in __import__("daily_adds").windows_text(daily.get("price_windows"))]
    aw = daily.get("ag_weather") or {}
    if aw.get("text"):
        L.append("  USDA weather: %s Source: %s." % (aw["text"], aw.get("source") or "USDA"))
    return L


def _watch(daily):
    out = []
    today = None
    try:
        today = date.fromisoformat(_iso_day(daily)[:10])
    except ValueError:
        pass
    for w in [w for w in (daily.get("watch_list") or []) if wasde_watch_ok(w.get("time"), w.get("desc"), today)][:2]:
        when, desc = BE.strip_md(w.get("time")), BE.strip_md(w.get("desc"))
        if desc:
            out.append((when, desc))
    for ev in events(daily):
        if len(out) >= 3:
            break
        out.append(("Event", ev["desc"]))
    return out


def _stories_html(stories):
    """Top stories: a linked title, one line, tag and source. No tracking on a
    publisher's link."""
    if not stories:
        return []
    b = [_rule(), _label("Top stories", pad=14)]
    for st in stories:
        title = e(st["title"])
        if st.get("link"):
            title = '<a class="link" href="%s" style="color:%s;text-decoration:underline">%s</a>' % (
                BE._href(e(st["link"])), INK, title)
        src = e(st.get("source") or "")
        # one paragraph per story, about two lines on a phone: the linked title,
        # its line, the source in grey. The tag stays on the web page.
        b.append('<tr><td class="ink" style="padding:5px 0 0;font-family:%s;font-size:14px;line-height:1.35;color:%s">'
                 '<strong>%s.</strong>%s%s</td></tr>'
                 % (SANS, INK, title.rstrip("."),
                    (" " + e(st["body"])) if st.get("body") else "",
                    (' <span class="mute" style="font-size:12px;color:%s">(%s)</span>' % (MUTE, src)) if src else ""))
    return b


# 2026-11-07 (fx/weekend-daily): Saturday's "The week in review" (Friday vs last Friday) and Sunday's
# "The week ahead" (Reports this week) are built by code (scripts/daily_weekend.py) and stored on the
# issue; the email prints the stored lines as they are. A weekday issue carries neither field.
WEEKEND_FIELDS = ("week_review", "week_ahead")


def weekend_block(daily):
    for f in WEEKEND_FIELDS:
        blk = daily.get(f)
        if isinstance(blk, dict) and (blk.get("lines") or blk.get("notes")):
            return blk
    return None


def own_week(daily, local):
    """The reader's own Friday vs last Friday bid lines (daily_weekend.bid_week, carried on the
    local block by send_daily) when today's block is The week in review; else None."""
    blk, wk = weekend_block(daily), (local or {}).get("week") if isinstance(local, dict) else None
    if not blk or blk is not daily.get("week_review") or not isinstance(wk, dict) or not wk.get("lines"):
        return None
    return wk


def _weekend_html(blk, own=None):
    if not blk:
        return []
    b = [_rule(), _label(blk.get("title") or "", pad=14)]
    head = e(blk.get("head") or "") + ((" (%s)" % e(blk["stamp"])) if blk.get("stamp") else "")
    b.append('<tr><td class="mute" style="padding:0 0 4px;font-family:%s;font-size:13px;color:%s">%s</td></tr>' % (SANS, MUTE, head))
    for t in blk.get("lines") or []:
        b.append(_row(e(t), pad="3px 0 0", size=14))
    for t in blk.get("notes") or []:
        b.append(_row(e(t), pad="6px 0 0", size=14))
    if blk.get("source"):
        b.append('<tr><td class="mute" style="padding:4px 0 0;font-family:%s;font-size:12px;color:%s">Source: %s.</td></tr>'
                 % (SANS, MUTE, e(blk["source"])))
    if own:
        for t in own["lines"]:
            b.append(_row(e(t), pad="8px 0 0", size=14))
        if own.get("note"):
            b.append('<tr><td class="mute" style="padding:4px 0 0;font-family:%s;font-size:12px;color:%s">%s</td></tr>'
                     % (SANS, MUTE, e(own["note"])))
    return b


def _weekend_text(blk, own=None):
    if not blk:
        return []
    head = (blk.get("head") or "") + ((" (%s)" % blk["stamp"]) if blk.get("stamp") else "")
    L = ["", (blk.get("title") or "").upper(), head] + ["  " + t for t in blk.get("lines") or []]
    L += [t for t in blk.get("notes") or []]
    if blk.get("source"):
        L.append("Source: %s." % blk["source"])
    if own:
        L += ["  " + t for t in own["lines"]]
        if own.get("note"):
            L.append(own["note"])
    return L


def fact_link(fact):
    """The fact's url when the email may link it, else None. Nov 2 2026: a fact whose
    url is a data file (source_links.is_data_source: ERS data products, PDFs, esmis .txt)
    names its source and date in plain text, no link; the url stays in the data."""
    u = (fact or {}).get("url")
    return u if u and not source_links.is_data_source(u) else None


def fact_source_text(fact):
    """The plain source line: the source, then the date it was read (a pool fact) or the
    file it was worked from (one of ours)."""
    s = fact["source"]
    if fact.get("file"):
        return s + "; " + fact["file"]
    d = str(fact.get("checked") or "")[:10]
    if re.match(r"\d{4}-\d{2}-\d{2}$", d):
        dd = date.fromisoformat(d)
        s += ", read %s %d, %d" % (dd.strftime("%B"), dd.day, dd.year)
    return s


def _html_body(daily, camp, iso, subj, pre, items, here, pod, fact, offer, rain, local, elevators,
               site_href, unsub_url, forward_url, today, county=None, county_ask=None, stories=None, funds=None):
    date_display = BE.strip_md(daily.get("date")) or iso
    b = ['<div class="mute" style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;'
         'font-size:1px;line-height:1px">%s%s</div>' % (e(pre), PRE_PAD),
         '<tr><td class="mute" style="font-family:%s;font-size:11px;font-weight:700;letter-spacing:.14em;'
         'text-transform:uppercase;color:%s">AGSIST Daily &middot; %s</td></tr>' % (MONO, MUTE, e(date_display))]
    # Today
    if items:       # a quiet day prints no empty Today heading
        b.append(_label("Today", pad=14))
    for x in items:
        if x.get("external"):        # a publisher's link: no tracking added
            tail = " " + _a(x["url"], x.get("link") or "Source", None, None, cls="mute link", color=MUTE)
        else:
            tail = (" " + _a(x["url"], x.get("link") or "More", camp, "today-" + x["kind"])) if x.get("url") else ""
        tag = ('<span class="lab" style="color:%s;font-family:%s;font-size:11px;font-weight:700;letter-spacing:.08em;'
               'text-transform:uppercase">Only here</span>&nbsp; ' % (GREEN, MONO)) if x.get("only_here") else ""
        b.append(_row('<span class="gold" style="color:%s">&bull;</span>&nbsp;&nbsp;%s%s%s' % (GOLD, tag, e(x["text"]), tail),
                      pad="4px 0 0", size=16))
    if forward_url:
        b.append('<tr><td class="mute" style="padding:10px 0 0;font-family:%s;font-size:14px;line-height:1.5;color:%s">Forward to a neighbor. '
                 'Or send them the free sign-up link: %s</td></tr>' % (SANS, MUTE, _a(forward_url, forward_url.split("://", 1)[-1], camp, "forward")))
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
    b += _stories_html(stories)
    b += _weekend_html(weekend_block(daily), own_week(daily, local))
    # Only here
    if here or county:
        b.append(_rule())
        b.append(_label("Only here", cls="lab", color=GREEN, pad=14))
        for x in here:
            b.append(_row("%s %s" % (e(x["text"]), _a(SITE + x["url"], x["link"], camp, "onlyhere-" + x["kind"])), pad="3px 0 0"))
        if county:
            b += _county_html(county, camp)
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
        xl = xmas_line(today)
        if xl:
            b.append('<tr><td class="mute" style="padding:3px 0 0;font-family:%s;font-size:13px;line-height:1.45;color:%s">%s</td></tr>' % (SANS, MUTE, e(xl)))
    elif offer:
        b.append(_row(_a(offer[1], offer[0], camp, "rainprint", cls="link"), pad="14px 0 0", size=14))
    if funds:
        b.append(_row(_a(funds[1], funds[0], camp, "funds", cls="link"), pad="14px 0 0", size=14))
    # Oh, that’s interesting (FACT_LABEL)
    if fact:
        b.append(_rule())
        b.append(_label(FACT_LABEL, pad=14))
        b.append(_row(e(fact["text"]), pad="2px 0 0"))
        src = (_a(fact["url"], fact["source"], None, None, cls="mute link", color=MUTE) if fact_link(fact)
               else e(fact_source_text(fact)))
        b.append('<tr><td class="mute" style="padding:4px 0 0;font-family:%s;font-size:12px;line-height:1.4;color:%s">Source: %s</td></tr>'
                 % (SANS, MUTE, src))
    # the board
    bd = _board_html(daily)
    if bd:
        b.append(_rule())
        b.append(bd)
        b.append(_adds_html(daily))
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
    foot = 'AGSIST &middot; free US farm markets &middot; %s' % _a("https://agsist.com/", "agsist.com", camp, "footer", cls="mute link", color=MUTE)
    add = BE.elevators_add_url(elevators)
    if add:
        foot += '<br><a class="mute link" href="%s" style="color:%s">%s</a>' % (BE._href(add), MUTE, e(BE.ELEVATOR_ADD_WORDS))
    if county_ask:
        foot += '<br><a class="mute link" href="%s" style="color:%s">%s</a>' % (BE._href(county_ask["url"]), MUTE, e(county_ask["words"]))
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
               site_href, unsub_url, forward_url, today, county=None, county_ask=None, stories=None, funds=None):
    L = ["AGSIST DAILY, " + (BE.strip_md(daily.get("date")) or iso)] + (["", "TODAY"] if items else [])
    for x in items:
        if x.get("external"):
            L.append("- " + x["text"] + " " + x["url"])
            continue
        L.append("- " + ("Only here: " if x.get("only_here") else "") + x["text"]
                 + ((" " + BE.utm(x["url"], "today-" + x["kind"], camp)) if x.get("url") else ""))
    if forward_url:
        L += ["", "Forward to a neighbor. Or send them the free sign-up link: " + BE.utm(forward_url, "forward", camp)]
    if isinstance(local, dict) and local.get("head"):
        L += ["", local["head"]] + (["  " + local["note"]] if local.get("note") else [])
    if isinstance(elevators, dict):
        L += BE._elevator_block_text(elevators)
    if stories:
        L += ["", "TOP STORIES"]
        for st in stories:
            head = " / ".join(x for x in (st.get("tag"), st.get("source")) if x)
            L.append("- " + st["title"] + ((" (" + head + ")") if head else ""))
            if st.get("body"):
                L.append("  " + st["body"])
            if st.get("link"):
                L.append("  " + st["link"])
    L += _weekend_text(weekend_block(daily), own_week(daily, local))
    if here or county:
        L += ["", "ONLY HERE"] + ["- %s %s" % (x["text"], BE.utm(SITE + x["url"], "onlyhere-" + x["kind"], camp)) for x in here]
        if county:
            L += _county_text(county, camp)
    if pod:
        L += ["", "PRINT OF THE DAY", pod["why"], "Make yours: " + BE.utm(SITE + pod["make_url"], "print-make", camp)]
        if offer and isinstance(rain, dict) and rain.get("zip"):
            L.append("Yours near %s: %s" % (rain.get("town") or "you", BE.utm(offer[1], "rainprint", camp)))
        if xmas_line(today):
            L.append(xmas_line(today))
    elif offer:
        L += ["", offer[0] + " " + BE.utm(offer[1], "rainprint", camp)]
    if funds:
        L += ["", funds[0] + " " + BE.utm(funds[1], "funds", camp)]
    if fact:
        L += ["", FACT_LABEL.upper(), fact["text"],
              "Source: " + ((fact["source"] + " " + fact["url"]) if fact_link(fact) else fact_source_text(fact))]
    rows = board_rows(daily)
    if rows:
        stamp, _m = board_stamp(daily, rows)
        L += ["", "THE BOARD" + (" (" + stamp + ")" if stamp else "")]
        for r in rows:
            kn = kind_note(r, _m)
            L.append("  %s %s %s%s" % (r["label"], px(r["key"], r["last"]), mv(r["key"], r), (" (" + kn + ")") if kn else ""))
        L += _adds_text(daily)
    w = _watch(daily)
    if w:
        L += ["", "WHAT TO WATCH"] + ["  %s: %s" % (a, d) for a, d in w]
    n = daily.get("cca_note")
    if isinstance(n, dict) and str(n.get("text") or "").strip():
        L += ["", "FROM SIG: " + str(n["text"]).strip()]
    L += ["", "The full issue and charts: " + BE.utm(BE._unamp(site_href), "button", camp)]
    if isinstance(local, dict) and local.get("ask_url"):
        L += ["", "Add your ZIP to get your top bid at the top of this email: " + BE.utm(local["ask_url"], "zip", camp)]
    L += ["", "AGSIST, free US farm markets, agsist.com"]
    if BE.elevators_add_url(elevators):
        L.append(BE.ELEVATOR_ADD_WORDS + ": " + BE.elevators_add_url(elevators))
    if county_ask:
        L.append(county_ask["words"] + ": " + county_ask["url"])
    L.append("Unsubscribe: " + unsub_url if unsub_url else "To unsubscribe, reply with subject line: unsubscribe")
    L.append("PO Box 243, Chetek, WI 54728")
    return "\n".join(L) + "\n"


# ── the check that blocks ─────────────────────────────────────────────────
SETTLE_WORDS = re.compile(r"\b(clos(?:e|ed|es|ing)|settle(?:d|s|ment)?|straight (?:days|sessions|closes)|in a row|"
                          r"(?:lower|higher) close)\b", re.I)
# A count of past sessions written after the price ("after four lower closes") says nothing about which
# price this one is; it is taken out before the close/settle words are looked for (Oct 28: "Dec corn at $4.52½
# overnight after four lower closes" was true and blocked). A price named overnight or this morning is labeled
# as the last trade, unless the sentence also says closed or settled outright.
SESSION_COUNT = re.compile(r"\b(?:after|following|its|for|now)?\s*(?:a |an |the )?"
                           r"(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|\w+th|second|third)\s+"
                           r"(?:straight |consecutive |more )?(?:lower |higher |down |up )?(?:closes|close|sessions|days)"
                           r"(?:\s+in a row)?\b", re.I)
LAST_TRADE_LABEL = re.compile(r"\b(overnight|this morning|early trade|pre-?open|last trade)\b", re.I)
SAYS_SETTLED = re.compile(r"\b(closed|settled|close of|settle of|settlement)\b", re.I)
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
            # a count AFTER the price is history ("at $4.52½ overnight after four lower closes"); a count that leads
            # to the price labels it ("down 6 straight days to $4.59½", Oct 21, a real error) and stays
            pm = next((x for x in _PRICE.finditer(sent) if abs(float(x.group(1)) + _FR.get(x.group(2) or "", 0.0) - v) < 1e-9), None)
            label = sent[:pm.end()] + SESSION_COUNT.sub(" ", sent[pm.end():]) if pm else sent
            if not q or q.get("kind") != "last" or q.get("prev") is None or not SETTLE_WORDS.search(label):
                continue
            if LAST_TRADE_LABEL.search(label) and not SAYS_SETTLED.search(label):
                continue
            tol = 0.0026 if key in GRAIN else 0.03
            if abs(v - q["last"]) <= tol and abs(v - q["prev"]) > tol:
                bad.append({"field": fname, "quote": sent.strip(" ."),
                            "why": "says close or settle, but %s is the %s last trade; the settle was %s"
                                   % (px(q["key"], v), _clock(q.get("at")) or "morning", px(q["key"], q["prev"]))})
    return bad


def subject_settle_check(daily, subj, sfield):
    """A run-of-settles subject must print the locked settle (Oct 30 2026: the
    subject said $12.20½ from a provisional harvest-file close; the settle was
    $12.19¾)."""
    if sfield != "harvest-prices":
        return []
    bad = []
    for key, v, sent in price_claims(subj):
        if key not in ("corn-dec", "beans-nov"):
            continue
        lk = locked_settles(daily, key)
        if lk and not any(abs(v - x) < 1e-6 for x in lk.values()):
            bad.append({"field": "subject", "quote": sent.strip(" ."),
                        "why": "%s is not a locked settle; the lock holds %s"
                               % (px(key, v), ", ".join("%s %s" % (_wday(d)[:3], px(key, x)) for d, x in sorted(lk.items())))})
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
    bad = code_check(daily, fields) + subject_settle_check(daily, built["subject"], built.get("subject_field"))
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
    # REAL CASES, Oct 28 (last trade 4.525 / 4.515, settle 4.4875): both headlines were true and both were blocked
    d2 = {"headline": "x", "lead": "x", "locked_prices": {"corn-dec": 4.525, "corn": 4.525},
          "locked_changes": {"corn-dec": {"prev": 4.4875, "kind": "last", "at": "2026-10-28T12:01:00Z"}}}
    ok(not code_check(d2, {"headline": "Dec corn at $4.52½ overnight after four lower closes"}), "overnight price after a count of closes passes")
    d3 = dict(d2, locked_prices={"corn-dec": 4.515, "corn": 4.515})
    ok(not code_check(d3, {"headline": "Corn is at $4.51½ after four lower closes"}), "a count of closes is not a label")
    ok(code_check(d2, {"headline": "Corn closed at $4.52½ overnight"}), "closed at stays blocked even with overnight")
    ok(code_check(d2, {"headline": "Corn settled at $4.52½ after four lower closes"}), "settled at stays blocked")
    ok(code_check(d2, {"headline": "Corn's $4.52½ close was its fifth lower close"}), "a price called a close stays blocked")
    ok(code_check(d2, {"headline": "Corn down 4 straight days to $4.52½"}), "a count that leads to the price stays blocked (Oct 21 shape)")
    ok(clip("USDA to pay farmers $8 billion for harvest fuel aid; diesel at a record") == "USDA to pay farmers $8 billion for harvest fuel aid", "clip at a clause")
    ok(len(clip("A" * 80)) <= SUBJECT_HARD, "hard cap")
    ok(shared_host("https://agsist-subs.dnilgis.workers.dev/u?k=1") and shared_host("https://agsist-api.dnilgis.workers.dev/u?k=1") and not shared_host("https://agsist.com/e?k=1"), "shared hosts")
    cf = {"print_christmas_cutoff": "2026-12-10", "framed_christmas_cutoff": "2026-12-09"}
    ok(xmas_line(date(2026, 10, 23), cf) == "For Christmas delivery, order a framed print by Dec 9, a print by Dec 10.", "xmas line in the window")
    ok(xmas_line(date(2026, 12, 9), cf) and not xmas_line(date(2026, 12, 10), cf) and not xmas_line(date(2026, 9, 30), cf), "xmas line through Dec 9 only")
    ok(not xmas_line(date(2026, 10, 23), {"print_christmas_cutoff": "x", "framed_christmas_cutoff": "2026-12-09"}), "no line on a bad date")
    print("daily_v2 selftest " + ("FAILED" if fails else "ok"))
    return 1 if fails else 0


def render_issue(path, zip_local=None, pod=None, fact=None):
    """Preview helper: (built dict) for an archived issue file, as the owner's copy would read."""
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
