#!/usr/bin/env python3
"""
brief_email.py — the AGSIST Daily as an email a grower can actually read.

WHY IT EXISTS
-------------
The subscriber email was a 130-word teaser: headline, lead, one takeaway, one
number, and a button to go and read the thing. A briefing that will not tell you
anything until you click is not a briefing, it is an advertisement for a website.

Sig, 2026-08-27: "i hate the actual format of the daily email i get and i wonder
if we can put some kind of more catchy or slightly longer daily briefing email
itself", alongside wanting the briefing CONTENT to be the most concise ag news
deal ever conceived. Those pull opposite ways only if you think length is the
variable. It is not: plain text has one level of emphasis, so any amount of it
arrives as one grey column and reads long. Structure is the variable. This gives
the reader eight distinct surfaces and more actual information, in fewer words
than the working copy, by spending the budget on hierarchy instead of prose.

THE ONE RULE THAT MATTERS
-------------------------
Every number in here comes from the issue's own locked board, and every change
is that board against the previous session's board. Nothing reads live
prices.json. That is not a style choice: the old table paired a price frozen at
11:34 with a percentage read at 22:08, and on 2026-08-26 all nineteen rows took
that path. Three of them printed the wrong SIGN, which made the writer look
wrong when the writer was right.

EMAIL, NOT WEB
--------------
Tables for layout, inline styles, no flexbox, no grid, no web fonts, no external
CSS, nothing that needs JavaScript. A <style> block carries only the dark-mode
media query, which the clients that support it read and the rest ignore.
"""
import glob
import html as _html
import json
import os
import re
from datetime import date, datetime

import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import market_board   # noqa: E402  ONE definition of "is this the same session's board"
import harvest_clock  # noqa: E402  the fall harvest price clock (RMA figures only)

# Resolved against the repo, not the cwd. send_daily.py is invoked from the
# workflow's checkout root today, but a sender that only finds the previous
# session's board when someone happens to launch it from the right folder is
# a sender that will one day mail a table with no change column at all.
_REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARCHIVE_DIR = os.path.join(_REPO, "data", "daily-archive")
if not os.path.isdir(ARCHIVE_DIR):
    ARCHIVE_DIR = os.path.join("data", "daily-archive")

# label, and whether the locked value is dollars-per-bushel
ROWS = [
    ("corn", "Corn", True), ("corn-dec", "Corn, Dec", True),
    ("beans", "Beans", True), ("beans-nov", "Beans, Nov", True),
    ("wheat", "Wheat", True), ("cattle", "Live cattle", False),
    ("feeders", "Feeders", False), ("hogs", "Lean hogs", False),
    ("crude", "Crude", False),
]

INK, MUTE, LINE = "#14100a", "#6b6b6b", "#e3ded4"
GOLD, UP, DOWN, PAPER = "#8a6b1f", "#1f6f2a", "#b3261e", "#ffffff"
SANS = ("-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,"
        "Helvetica,Arial,sans-serif")
MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace"


# ── text hygiene ───────────────────────────────────────────────────────────
def strip_md(s):
    """Markdown never renders in an email, so it must not survive into one.

    `December corn at **$5.29**` shipped with literal asterisks on the three
    numbers a phone reader scans for. Bold is applied by the template, from the
    template's own rules, or not at all.
    """
    s = str(s or "")
    s = re.sub(r"\*\*(.+?)\*\*", r"\1", s)
    s = re.sub(r"(?<!\w)\*(.+?)\*(?!\w)", r"\1", s)
    s = re.sub(r"`(.+?)`", r"\1", s)
    s = re.sub(r"<[^>]+>", "", s)
    # The em-dash ban was being satisfied by emitting a typewriter double
    # hyphen, which is the same artefact in a different coat.
    s = s.replace(" -- ", ", ").replace("--", ", ")
    # And the real thing. 47 of the 167 archived issues carry a literal em or en
    # dash in prose the writer inherited from an older template; stripping the
    # ASCII stand-in while letting the character itself through is not a ban,
    # it is a typo filter. Spaced first, so "corn — the leader" does not become
    # "corn , the leader".
    # A tight en dash between two figures is a RANGE, and turning "$5.20-5.40"
    # into "$5.20, 5.40" would print two prices where the writer meant one span.
    s = re.sub(r"(?<=\d)\u2013(?=[\d$])", " to ", s)
    s = re.sub(r"\s*[\u2014\u2013]\s*", ", ", s)
    s = re.sub(r",\s*,", ",", s)
    return re.sub(r"\s+", " ", s).strip()


def split_bullets(text):
    """A body written as "- one\n- two\n- three" is a list, and must arrive as
    one. strip_md() collapses runs of whitespace, so the newlines that made it a
    list were being eaten and three findings arrived as one grey paragraph with
    stray hyphens in the middle of it.
    """
    raw = str(text or "")
    parts = [p.strip() for p in re.split(r"(?:^|\n)\s*[-\u2022]\s+", raw) if p.strip()]
    if len(parts) >= 2 and re.search(r"(?:^|\n)\s*[-\u2022]\s+", raw):
        return [strip_md(p) for p in parts]
    # A one-item list ("- WTI's at ...") is one paragraph, without the marker.
    # strip_md() would keep the "- " and the email printed it as a stray hyphen.
    if len(parts) == 1 and re.match(r"\s*[-\u2022]\s+", raw):
        return [strip_md(parts[0])]
    v = strip_md(raw)
    return [v] if v else []


def e(s):
    return _html.escape(str(s if s is not None else ""), quote=True)


# ── the board ──────────────────────────────────────────────────────────────
def _href(u):
    """A bare "&" in an href is invalid HTML and email sanitisers are not
    something to gamble a send on. The signed unsubscribe link carries one
    ("...?e=...&t=..."), and it shipped raw. Idempotent, so a caller that
    already escaped its URL does not end up with "&amp;amp;".
    """
    return re.sub(r"&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)", "&amp;", str(u or ""))


def prior_board(daily, archive_dir=ARCHIVE_DIR):
    """The previous TRADING session's locked board.

    Not simply the previous file: the archive publishes at weekends and on
    holidays, and those issues carry the last close forward unchanged. Walking
    back one file lands on a non-session and every change comes out zero.

    v5.3: the rule moved to market_board, which compares the SESSION-TRADED
    board only. The copy that used to live here compared every shared key, and
    locked_prices carries bitcoin -- one round-the-clock instrument was enough
    to make a frozen ag board look like a fresh session. 9 archived issues
    emailed a price table where every row read unchanged.
    """
    lp, day, _err = market_board.prior_board(daily, archive_dir)
    return lp, day


def change(daily, prior, key):
    # v5.4: prefer the change LOCKED at generation — the source's own
    # close-over-close move, read at fetch time. The walk below compares two
    # archived snapshots taken at different times of day and mixes in overnight
    # drift; it stays as the fallback for the 185 issues archived before the
    # lock existed.
    locked = market_board.locked_change(daily, key)
    if locked is not None:
        return locked
    cur, prev = (daily.get("locked_prices") or {}).get(key), (prior or {}).get(key)
    if not isinstance(cur, (int, float)) or not isinstance(prev, (int, float)) or not prev:
        return None
    return 100.0 * (cur - prev) / prev


def fmt_price(v, grain):
    if not isinstance(v, (int, float)):
        return ""
    # "%,.0f" is not a thing in %-formatting: it raises ValueError, so any
    # four-figure contract would have crashed the whole send rather than
    # printing a comma. format() is where the comma lives.
    if grain or v < 1000:
        return "$%.2f" % v
    return "$" + format(v, ",.0f")


def fmt_pct(p):
    # A true minus, not a hyphen: it is the same width as the plus it
    # alternates with, so a column of them sits straight.
    if p is None:
        # An en dash, not an em dash. The house style bans the em dash in
        # prose and the render harness fails the build on one, so the table's
        # "no comparable prior close" marker must not smuggle it back in.
        return "&#8211;"
    return ("+" if p >= 0 else "−") + ("%.1f%%" % abs(p))


def pct_colour(p):
    if p is None:
        return MUTE
    return UP if p > 0.05 else (DOWN if p < -0.05 else MUTE)


def pct_class(p):
    """EVERY coloured element needs a class or dark mode cannot reach it.

    The first dark render was unreadable: the media query only overrode
    elements carrying .ink/.mute, and everything else kept its inline
    near-black on a dark card. Half the message vanished. Colour and class are
    now emitted together, always, from the same call.
    """
    if p is None:
        return "mute"
    return "up" if p > 0.05 else ("down" if p < -0.05 else "mute")


def biggest_mover(daily, prior):
    best, bp = None, 0.0
    for key, label, _g in ROWS:
        p = change(daily, prior, key)
        if p is not None and abs(p) > abs(bp):
            best, bp = label, p
    return (best, bp) if best else (None, None)


# ── pieces ─────────────────────────────────────────────────────────────────
def _rule(pad=18):
    return ('<tr><td style="padding:%dpx 0 0"><div class="rule" style="height:1px;'
            'background:%s;line-height:1px;font-size:0">&nbsp;</div></td></tr>' % (pad, LINE))


def _label(text):
    return ('<tr><td class="mute" style="padding:18px 0 6px;font-family:%s;font-size:11px;'
            'font-weight:700;letter-spacing:.12em;text-transform:uppercase;'
            'color:%s">%s</td></tr>' % (MONO, MUTE, e(text)))


def price_table(daily, prior, prior_day):
    rows = []
    for key, label, grain in ROWS:
        v = (daily.get("locked_prices") or {}).get(key)
        if not isinstance(v, (int, float)):
            continue
        p = change(daily, prior, key)
        # v5.3: no prior session on file means no change column at all. Seven
        # rows of "n/a" is not information, and a fabricated "+0.0%" is worse:
        # before this, a weekend issue printed every row unchanged in the same
        # email whose lead said wheat fell 3.4%.
        cell = fmt_pct(p) if (prior_day or daily.get("locked_changes")) else ""
        rows.append(
            '<tr>'
            '<td class="ink cell" style="padding:5px 0;font-family:%s;font-size:14px;color:%s;'
            'border-bottom:1px solid %s">%s</td>'
            '<td align="right" class="ink cell" style="padding:5px 0;font-family:%s;font-size:15px;'
            'font-weight:700;color:%s;border-bottom:1px solid %s;white-space:nowrap">%s</td>'
            '<td align="right" class="%s cell" style="padding:5px 0 5px 14px;font-family:%s;font-size:13px;'
            'color:%s;border-bottom:1px solid %s;white-space:nowrap">%s</td>'
            '</tr>'
            % (SANS, INK, LINE, e(label), MONO, INK, LINE, fmt_price(v, grain),
               pct_class(p), MONO, pct_colour(p), LINE, cell))
    if not rows:
        return ""
    # THE STAMP IS NOT DECORATION. It is the sentence that makes the column
    # honest: these are settlements, and the change is against the session
    # named, not against whatever a live feed said when the mail went out.
    # The stamp names the session the change is measured against. With the
    # change locked at generation that is recorded on the briefing; otherwise
    # it is the archived board the walk landed on.
    _board = (daily.get("board") or {})
    _against = _board.get("prev_close_session") if daily.get("locked_changes") else None
    _against = _against or prior_day
    stamp = ("close, against %s" % e(_against)) if _against else "close"
    return (_label("The board")
            + '<tr><td class="mute" style="padding:0 0 8px;font-family:%s;font-size:14px;color:%s">%s</td></tr>'
              % (SANS, MUTE, stamp)
            + '<tr><td><table role="presentation" width="100%%" cellpadding="0" cellspacing="0" '
              'border="0" style="width:100%%">%s</table></td></tr>' % "".join(rows))


def call_card(daily):
    """Today's call, which until now reached nobody.

    It sits in daily.json and in neither email, so the scorecard grades a bet
    the reader was never shown. A public record is the one thing here a reader
    cannot get free somewhere else, and half of it was being withheld.
    """
    c = daily.get("todays_call") or {}
    inst, dirn, lvl = c.get("instrument"), c.get("direction"), c.get("level")
    if not inst or not dirn or lvl is None:
        return ""
    arrow = "up toward" if str(dirn).lower() == "up" else "down toward"
    return (_label("Today's call")
            + '<tr><td style="padding:0"><table role="presentation" width="100%%" '
              'cellpadding="0" cellspacing="0" border="0"><tr>'
              '<td style="border-left:3px solid %s;padding:10px 0 10px 12px">'
              '<div class="ink" style="font-family:%s;font-size:16px;color:%s">'
              '<strong>%s</strong> %s <strong>%s</strong></div>'
              '<div class="mute" style="font-family:%s;font-size:14px;color:%s;padding-top:4px">'
              'Graded against tomorrow&rsquo;s close, win or lose, on the scorecard.</div>'
              '</td></tr></table></td></tr>'
              % (GOLD, MONO, INK, e(str(inst).title()), arrow,
                 e("$%s" % lvl), SANS, MUTE))


def yesterday_card(daily):
    y = daily.get("yesterdays_call") or {}
    # v5.1: call_line is written by the grader from the structured call and
    # the closes; summary is the pre-cut model prose, read for old issues only.
    summary = strip_md(y.get("call_line") or y.get("summary"))
    note = strip_md(y.get("note")) if y.get("call_line") else ""
    if not summary:
        return ""
    outcome = str((y.get("computed") or {}).get("outcome") or y.get("outcome") or "").lower()
    tag, col = ("Played out", UP) if outcome == "played_out" else (
        ("Missed", DOWN) if outcome else ("Pending", MUTE))
    return (_label("Yesterday's call")
            + '<tr><td style="padding:0 0 2px"><span style="font-family:%s;font-size:11px;'
              'font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:%s" class="%s">%s</span></td></tr>'
              % (MONO, col, ('up' if col==UP else ('down' if col==DOWN else 'mute')), tag)
            + '<tr><td class="ink" style="font-family:%s;font-size:15px;line-height:1.55;color:%s">%s</td></tr>'
              % (SANS, INK, e(summary))
            + (('<tr><td class="mute" style="padding:4px 0 0;font-family:%s;font-size:14px;line-height:1.5;color:%s">%s</td></tr>'
                % (SANS, MUTE, e(note))) if note else ""))


def sections_html(daily, limit=3):
    out, heat = [], (daily.get("meta") or {}).get("heat_section")
    for i, s in enumerate(daily.get("sections") or []):
        if len(out) >= limit:
            break
        title = strip_md(s.get("title"))
        if not title and not (s.get("body") or "").strip():
            continue
        # v5.1: so_what is the field; bottom_line/farmer_action are read for
        # issues archived before the cut.
        bottom, action = strip_md(s.get("so_what") or s.get("bottom_line")), strip_md(s.get("farmer_action"))
        conv = (s.get("conviction_level") or "").lower()
        badges = []
        if i == heat:
            badges.append("Top story")
        if conv in ("high", "medium", "low"):
            badges.append(conv.title() + " conviction")
        # Escape each badge, THEN join with the entity. Escaping the joined
        # string turned the separator into a literal "&MIDDOT;" in the header,
        # in capitals, because the row is text-transform:uppercase.
        badge = ('<span style="font-family:%s;font-size:10px;font-weight:700;'
                 'letter-spacing:.09em;text-transform:uppercase;color:%s" class="gold">%s</span>'
                 % (MONO, GOLD, " &middot; ".join(e(b) for b in badges))) if badges else ""
        block = ['<tr><td style="padding:20px 0 0">%s</td></tr>' % badge if badge else "",
                 '<tr><td class="ink" style="padding:%dpx 0 6px;font-family:%s;font-size:17px;'
                 'font-weight:700;line-height:1.3;color:%s">%s</td></tr>'
                 % (2 if badge else 20, SANS, INK, e(title))]
        bullets = split_bullets(s.get("body"))
        if len(bullets) > 1:
            for bl in bullets:
                block.append('<tr><td class="ink" style="padding:3px 0 0;font-family:%s;'
                             'font-size:15px;line-height:1.6;color:%s">'
                             '<span class="gold" style="color:%s">&bull;</span>&nbsp;&nbsp;%s</td></tr>'
                             % (SANS, INK, GOLD, e(bl)))
        elif bullets:
            block.append('<tr><td class="ink" style="font-family:%s;font-size:15px;'
                         'line-height:1.6;color:%s">%s</td></tr>' % (SANS, INK, e(bullets[0])))
        if bottom:
            # NOT a ">" prefix. In plain text a leading ">" is the quotation
            # convention, so Apple Mail was styling the writer's own conclusion
            # as somebody else's words, three times an issue.
            block.append('<tr><td style="padding:8px 0 0"><table role="presentation" '
                         'width="100%%" cellpadding="0" cellspacing="0" border="0"><tr>'
                         '<td class="ink" style="border-left:3px solid %s;padding:2px 0 2px 12px;'
                         'font-family:%s;font-size:15px;line-height:1.55;color:%s">%s</td>'
                         '</tr></table></td></tr>' % (LINE, SANS, INK, e(bottom)))
        if action:
            block.append('<tr><td class="ink" style="padding:10px 0 0;font-family:%s;font-size:14px;'
                         'line-height:1.55;color:%s"><strong style="font-family:%s;'
                         'font-size:11px;letter-spacing:.09em;text-transform:uppercase;'
                         'color:%s" class="gold">Action&nbsp;&nbsp;</strong>%s</td></tr>'
                         % (SANS, INK, MONO, GOLD, e(action)))
        out.append("".join(block))
    return _label("Today") + "".join(out) if out else ""


def watch_html(daily, limit=3):
    items = []
    for w in (daily.get("watch_list") or [])[:limit]:
        when, desc = strip_md(w.get("time")), strip_md(w.get("desc"))
        if not desc:
            continue
        # STACKED, NOT TWO COLUMNS. The time cell was white-space:nowrap and one
        # row read "Saturday, Aug 21 (result pending)", which pinned a 250px
        # column and pushed the whole message 7px past a 390px viewport. A
        # timestamp and its event read fine one above the other on a phone, and
        # no string length can break the layout again.
        items.append('<tr><td class="gold" style="padding:8px 0 0;font-family:%s;font-size:11px;'
                     'font-weight:700;letter-spacing:.07em;text-transform:uppercase;'
                     'color:%s">%s</td></tr>'
                     '<tr><td style="padding:2px 0 0;font-family:%s;font-size:14px;'
                     'line-height:1.5;color:%s" class="ink">%s</td></tr>'
                     % (MONO, GOLD, e(when), SANS, INK, e(desc)))
    if not items:
        return ""
    return (_label("What to watch")
            + '<tr><td><table role="presentation" width="100%%" cellpadding="0" '
              'cellspacing="0" border="0">%s</table></td></tr>' % "".join(items))


def elevators_html(lines):
    """WAVE2-G: the subscriber's own watched elevators, one line each, as
    send_elevator_watch.daily_lines() wrote them from the posted boards.
    Nothing here computes a figure. No lines, no block."""
    if not lines:
        return ""
    rows = "".join('<tr><td style="padding:6px 0 0;font-family:%s;font-size:14px;line-height:1.5;'
                   'color:%s" class="ink">%s</td></tr>' % (SANS, INK, e(x)) for x in lines)
    note = ('<tr><td class="mute" style="padding:6px 0 0;font-family:%s;font-size:14px;line-height:1.5;'
            'color:%s">The elevators\' own posted boards, read when this email was sent. Not a contract. '
            'Call to confirm before you haul.</td></tr>' % (SANS, MUTE))
    return (_label("Your elevators")
            + '<tr><td><table role="presentation" width="100%%" cellpadding="0" '
              'cellspacing="0" border="0">%s%s</table></td></tr>' % (rows, note))


# ── the whole thing ────────────────────────────────────────────────────────
DARK = """
:root{color-scheme:light dark;supported-color-schemes:light dark}
@media (prefers-color-scheme:dark){
  .bg{background:#12100c!important}
  .card{background:#191510!important}
  .ink{color:#ece6da!important}
  .mute{color:#9a9186!important}
  .rule{background:#332d24!important}
  .cell{border-bottom-color:#332d24!important}
  .gold{color:#d9ad4e!important}
  .up{color:#5fbf6a!important}
  .down{color:#e2705f!important}
  /* A near-black button on a near-black card is a shape nobody can see. */
  .btn{background:#d9ad4e!important;color:#191510!important}
}
"""


SUBJECT_MAX = 78


# ── the headline, without the shouting ────────────────────────────────────
# Every archived headline is written in capitals. In a subject line and as the
# email's own heading that reads as shouting, so a mostly-capitals headline is
# put in sentence case. Words a reader expects in capitals stay in capitals,
# and names keep their capital letter. Both lists come from the archived
# headlines (data/daily-archive) plus the usual ag acronyms; a word that is in
# neither list is lower-cased, which is the safe miss.
HEAD_ACRONYMS = {
    "USDA", "WASDE", "WTI", "CME", "CBOT", "EPA", "RFS", "US", "U.S.", "EU", "OPEC", "ETF",
    "COT", "NOPA", "ENSO", "FOMC", "GDP", "CPI", "KC", "MGEX", "ZIP", "CHS", "COF", "CT",
    "AM", "PM", "ET", "UK", "UN", "LNG", "SRW", "HRW", "HRS", "NASS", "FSA", "RMA", "DDGS",
    "OPEC+", "MMT", "API", "EIA", "FAS", "USMCA", "UAE",
}
HEAD_PROPER = {w.upper(): w for w in (
    "Brazil", "Brazilian", "China", "Chinese", "Hormuz", "Qatar", "Argentina", "Argentine", "Gulf",
    "Iran", "Iranian", "Israel", "Saudi", "Yanbu", "Russia", "Russian", "Ukraine", "Ukrainian",
    "Black", "Sea", "Mexico", "Canada", "India", "Australia", "Europe", "Brent", "Cargill",
    "Trump", "Xi", "Beijing", "Washington", "Mississippi", "Midwest", "Iowa", "Illinois",
    "Nebraska", "Kansas", "Minnesota", "Indiana", "Ohio", "Dakota", "Texas", "Panama",
    "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
    "January", "February", "March", "April", "May", "June", "July", "August", "September",
    "October", "November", "December", "Thanksgiving", "Christmas", "Labor", "Memorial",
)}
# Names of more than one word, where each word alone is ordinary ("PRO", "BELT").
HEAD_PHRASES = (("PRO FARMER", "Pro Farmer"), ("CORN BELT", "Corn Belt"), ("FARM BILL", "Farm Bill"),
                ("BLACK SEA", "Black Sea"), ("LABOR DAY", "Labor Day"), ("MEMORIAL DAY", "Memorial Day"),
                ("SOUTH AMERICA", "South America"), ("NORTH DAKOTA", "North Dakota"),
                ("SOUTH DAKOTA", "South Dakota"), ("CROP PROGRESS", "Crop Progress"))
_HEAD_WORD = re.compile(r"(?<![0-9A-Za-z])[A-Za-z][A-Za-z.+]*(?:['’][A-Za-z]+)?")


def soften_caps(head):
    """A headline in capitals -> sentence case; anything else unchanged."""
    head = str(head or "")
    letters = [c for c in head if c.isalpha()]
    if len(letters) < 4 or sum(c.isupper() for c in letters) < 0.8 * len(letters):
        return head

    def word(m):
        w = m.group(0)
        core, tail = w, ""
        mm = re.match(r"^(.*?)(['’][A-Za-z]+)$", w)
        if mm:
            core, tail = mm.group(1), mm.group(2).lower()
        dot = ""
        if core.upper() not in HEAD_ACRONYMS and core.endswith("."):
            core, dot = core[:-1], "."
        up = core.upper()
        if up in HEAD_ACRONYMS:
            return up + tail + dot
        if up in HEAD_PROPER:
            return HEAD_PROPER[up] + tail + dot
        return core.lower() + tail + dot

    out = _HEAD_WORD.sub(word, head)
    for a, b in HEAD_PHRASES:
        out = re.sub(r"(?<![A-Za-z])" + re.escape(a) + r"(?![A-Za-z])", b, out, flags=re.I)
    # "Trump-Xi": each half of a hyphenated word is looked up on its own above,
    # because the word pattern stops at the hyphen.
    m = re.search(r"[A-Za-z]", out)
    if m:
        out = out[:m.start()] + out[m.start()].upper() + out[m.start() + 1:]
    return out


def _clip(head, room):
    """Shorten a headline without leaving a half-word or a dangling comma."""
    if room < 20 or len(head) <= room:
        return head
    # Prefer a real clause break: "CATTLE BOUNCES BACK, GRAINS FIND FOOTING"
    # becomes "CATTLE BOUNCES BACK", which is a sentence, not a stub.
    for sep in ("; ", ", ", ": "):
        cut = head.rfind(sep, 0, room + len(sep))
        if cut >= 16:
            return head[:cut]
    cut = head.rfind(" ", 0, room)
    return (head[:cut] if cut >= 16 else head[:room]).rstrip(" ,;:") + "…"


def subject_line(daily, prior):
    """Derived, never hand-typed.

    Issue number, the day's largest move off the board, then the headline. The
    two facts a reader needs to decide whether to open are in the first forty
    characters, and neither can drift from the table underneath.
    """
    issue = daily.get("issue_number")
    head = soften_caps(strip_md(daily.get("headline"))) or "AGSIST Daily"
    mover, p = biggest_mover(daily, prior)
    bits = ["AGSIST" + (" #%s" % issue if issue else "")]
    if mover and p is not None and abs(p) >= 0.5:
        bits.append("%s %s%.1f%%" % (mover, "+" if p > 0 else "−", abs(p)))
    # Gmail's desktop list shows roughly 70 characters and its phone list far
    # fewer, so a 92-character subject (the longest in the archive) is a
    # headline that gets cut mid-word by the client instead of edited by us.
    # Cut it ourselves, at a clause boundary where the archive gives one.
    room = SUBJECT_MAX - len(" · ".join(bits)) - 3
    bits.append(_clip(head, room))
    return " · ".join(bits)


def _sponsor_cta(sp):
    """The sponsor's destination tagged for the EMAIL, not the page.

    One definition, scripts/sponsor_links.py. data/sponsor.json holds the bare
    url; if the parameters lived in the file the email would inherit the
    homepage's medium and report inbox clicks as page clicks -- against the one
    number a sponsor can check independently.
    """
    url = sp.get("cta_url") or ""
    if not url:
        return ""
    try:
        import sponsor_links
        return sponsor_links.tag(url, "daily_email", sp.get("slug") or "sponsor")
    except Exception:
        return url


AD_ORANGE, AD_INK = "#e8743a", "#0d1117"    # 4.66:1, bold 13px; the site's ad colour


def _sa_tel(p):
    d = "".join(ch for ch in str(p or "") if ch.isdigit())
    if len(d) == 11 and d[0] == "1":
        d = d[1:]
    return "tel:+1" + d if len(d) == 10 else ""


def sponsor_block(daily):
    """The paid sponsor's block as an email table row, or "" when there isn't one.

    2026-09-20: rebuilt to carry the same content as the page ad (label,
    advertiser, headline, body, the facts line, a button, a phone number,
    disclosure) in the only construction every client draws the same way:
    tables, inline styles, a bulletproof button (a coloured table cell, not a
    styled link, because Outlook's Word engine drops a link's background). No
    logo image: the logo is .webp, which Outlook and older Apple Mail do not
    show, and a broken image in the inbox is worse than the name set in type.

    Returns "" for the house ad (is_house_ad) and for an inactive sponsor, so
    the only thing that can put a name in front of the list is a real one.
    """
    sp = daily.get("sponsor")
    if not isinstance(sp, dict) or not sp.get("active") or sp.get("is_house_ad"):
        return ""
    label = e(sp.get("label") or "SPONSORED")
    who = e(sp.get("advertiser") or "")
    head = e(sp.get("headline") or "")
    text = e(sp.get("body") or "")
    cta_t = e(sp.get("cta_text") or "Learn more")
    cta_u = _href(_sponsor_cta(sp))
    disc = e(sp.get("disclosure") or "")
    facts = [e(f) for f in (sp.get("facts") or []) if f]
    phone = e(sp.get("phone") or "")
    tel = _sa_tel(sp.get("phone"))
    if not (head or text):
        return ""
    parts = ['<tr><td style="padding:18px 0 0"><table role="presentation" width="100%%" '
             'cellpadding="0" cellspacing="0" border="0"><tr><td style="border:1px solid %s;'
             'border-left:4px solid %s;border-radius:8px;padding:14px 16px 14px 14px">' % (LINE, AD_ORANGE)]
    parts.append('<div style="font-family:%s;font-size:10px;font-weight:700;letter-spacing:.14em;'
                 'text-transform:uppercase;color:%s">%s%s</div>'
                 % (MONO, "#a8380a", label, (' <span style="color:%s;font-weight:600;'
                    'letter-spacing:.04em">&middot; %s</span>' % (MUTE, who)) if who else ""))
    if head:
        parts.append('<div class="ink" style="font-family:%s;font-size:19px;line-height:1.25;'
                     'font-weight:800;color:%s;padding-top:6px">%s</div>' % (SANS, INK, head))
    if text:
        parts.append('<div class="ink" style="font-family:%s;font-size:14px;line-height:1.55;'
                     'color:%s;padding-top:6px">%s</div>' % (SANS, INK, text))
    if facts:
        parts.append('<div class="mute" style="font-family:%s;font-size:14px;line-height:1.6;'
                     'font-weight:700;color:%s;padding-top:8px">%s</div>'
                     % (MONO, MUTE, " &nbsp;&middot;&nbsp; ".join(facts)))
    if cta_u:
        parts.append('<table role="presentation" cellpadding="0" cellspacing="0" border="0" '
                     'style="margin-top:12px"><tr><td bgcolor="%s" style="background:%s;border-radius:6px">'
                     '<a href="%s" rel="sponsored noopener" style="display:inline-block;padding:11px 18px;'
                     'font-family:%s;font-size:13px;font-weight:800;letter-spacing:.05em;'
                     'text-transform:uppercase;color:%s;text-decoration:none">%s &rarr;</a></td>'
                     '%s</tr></table>'
                     % (AD_ORANGE, AD_ORANGE, cta_u, MONO, AD_INK, cta_t,
                        ('<td style="padding-left:14px;font-family:%s;font-size:14px;color:%s">'
                         'or call <a href="%s" style="color:%s;font-weight:700;text-decoration:none">%s</a></td>'
                         % (SANS, MUTE, tel, INK, phone)) if tel else ""))
    if disc:
        parts.append('<div class="mute" style="font-family:%s;font-size:14px;line-height:1.5;'
                     'color:%s;padding-top:10px">%s</div>' % (SANS, MUTE, disc))
    parts.append('</td></tr></table></td></tr>')
    return "".join(parts)


# ── 2026-10-06: the reader's own top bid, and the two asks ─────────────────
# `local` is built per reader by send_daily.py from scripts/local_bid.py, the
# port of the homepage hero's top-bid rule. Two shapes, or None:
#   {"head": "Near Chetek, WI: top corn bid ...", "detail": [...], "note": "..."}
#   {"ask_url": "https://agsist.com/#signup-full"}   the reader gave no ZIP
# Nothing here computes a figure. None (no centroid, bids unreadable) renders
# nothing, so that reader's email is the one everybody got before.
# `forward_url` is the plain sign-up link for a neighbour.
def local_html(local):
    if not local:
        return ""
    if local.get("ask_url"):
        return ('<tr><td class="mute" style="padding:12px 0 0;font-family:%s;font-size:14px;line-height:1.5;'
                'color:%s"><a href="%s" style="color:%s">Add your ZIP to get your local top bid</a> '
                'at the top of this email.</td></tr>' % (SANS, MUTE, _href(local["ask_url"]), GOLD))
    if not local.get("head"):
        return ""
    det = "".join('<br><span class="mute" style="font-size:14px;color:%s">%s</span>' % (MUTE, e(d))
                  for d in (local.get("detail") or []))
    note = ('<br><span class="mute" style="font-size:14px;color:%s">%s</span>' % (MUTE, e(local["note"]))
            if local.get("note") else "")
    return ('<tr><td style="padding:14px 0 0"><table role="presentation" width="100%%" cellpadding="0" '
            'cellspacing="0" border="0"><tr><td class="ink" style="border-left:3px solid %s;padding:4px 0 4px 12px;'
            'font-family:%s;font-size:15px;line-height:1.5;color:%s"><strong>%s</strong>%s%s</td></tr></table></td></tr>'
            % (GOLD, SANS, INK, e(local["head"]), det, note))


def local_text(local):
    if not local:
        return []
    if local.get("ask_url"):
        return ["", "Add your ZIP to get your local top bid at the top of this email: " + local["ask_url"]]
    if not local.get("head"):
        return []
    return ["", local["head"]] + ["  " + d for d in (local.get("detail") or [])] + (
        ["  " + local["note"]] if local.get("note") else [])


def action_label(daily, take):
    """The label in front of the action line: the bot's own ("BOT CALL" until
    its calls hold up, then "THE ACTION"), so the HTML and the text part say
    the same thing. Empty when the line already opens with it ("Bot call, Oct
    5 close, ..."), so it is not said twice."""
    lab = str((daily.get("bot_call") or {}).get("label") or "THE ACTION").strip()
    if take.lower().startswith(lab.lower()):
        return ""
    return lab[:1].upper() + lab[1:].lower()


def daily_action(daily):
    """The action line, if the Daily carries one. 2026-10-09, Sig: the
    prediction bot is out of the Daily for now (it lives on /scorecard), so
    an issue whose action is the bot's call (bot_call present) has none."""
    if daily.get("bot_call"):
        return ""
    return strip_md(daily.get("action"))


# ── 2026-10-09: the harvest price clock ────────────────────────────────────
# RMA's running harvest price against its projected price, from the issue's
# harvest_clock block (scripts/harvest_clock.py). Shown only while the window
# is open and the RMA file is under four days old on the day the email is
# built; otherwise nothing at all.
CLOCK_URL = "https://agsist.com/harvest-price-tracker"


def clock_html(daily, today=None):
    b = harvest_clock.visible(daily.get("harvest_clock"), today)
    if not b:
        return ""
    lines = "".join('<div style="padding-top:4px">%s</div>' % e(x) for x in b["lines"])
    return ('<tr><td style="padding:14px 0 0"><table role="presentation" width="100%%" '
            'cellpadding="0" cellspacing="0" border="0"><tr><td class="ink" style="border-left:3px solid %s;'
            'padding:4px 0 4px 12px;font-family:%s;font-size:15px;line-height:1.5;color:%s">'
            '<strong>Harvest price clock.</strong>%s'
            '<div class="mute" style="padding-top:6px;font-size:14px;color:%s">%s '
            '<a href="%s" style="color:%s">Harvest price tracker</a></div></td></tr></table></td></tr>'
            % (GOLD, SANS, INK, lines, MUTE, e(b.get("note") or ""), CLOCK_URL, GOLD))


def clock_text(daily, today=None):
    b = harvest_clock.visible(daily.get("harvest_clock"), today)
    if not b:
        return []
    return ["", "HARVEST PRICE CLOCK"] + list(b["lines"]) + [
        ((b.get("note") or "") + " Harvest price tracker: " + CLOCK_URL).strip()]


def render_html(daily, site_href, unsub_url=None, date_display=None, elevators=None,
                local=None, forward_url=None, today=None):
    prior, prior_day = prior_board(daily)
    head = soften_caps(strip_md(daily.get("headline")))
    lead = strip_md(daily.get("lead"))
    # v5.1: the action holds the slot the takeaway had. An issue from before
    # the cut has no action and keeps its takeaway.
    take = daily_action(daily)
    take_label = (action_label(daily, take) + ".") if take else "The takeaway."
    if take_label == ".":
        take_label = ""
    if not take:
        take = strip_md(daily.get("the_takeaway"))
    issue = daily.get("issue_number")
    # The issue's own "date" field is the long form a reader wants ("Wednesday,
    # August 26, 2026"); date_display is a caller override. Prefer the long
    # form, which is what render_text has always done: none of the 167 archived
    # issues carries a date_display at all, so the old teaser had been dating
    # every email "2026-08-26" for months.
    date_display = strip_md(daily.get("date")) or date_display or ""

    mast = "AGSIST DAILY" + (" &middot; No. %s" % e(issue) if issue else "")
    body = [
        # Preheader: what the inbox preview shows. Hidden in the body itself so
        # it is not said twice.
        '<div class="mute" style="display:none;max-height:0;overflow:hidden;'
        'opacity:0;color:transparent;font-size:1px;line-height:1px">%s</div>' % e(lead or take),
        '<tr><td style="font-family:%s;font-size:11px;font-weight:700;letter-spacing:.14em;'
        'text-transform:uppercase;color:%s" class="mute">%s</td></tr>' % (MONO, MUTE, mast),
        '<tr><td style="padding:2px 0 0;font-family:%s;font-size:14px;color:%s" class="mute">%s</td></tr>'
        % (SANS, MUTE, e(date_display)),
    ]
    _loc = local_html(local)
    if _loc and not local.get("ask_url"):
        body.append(_loc)              # the reader's own bid opens the email
    if head:
        body.append('<tr><td class="ink" style="padding:14px 0 0;font-family:%s;font-size:25px;'
                    'line-height:1.22;font-weight:700;color:%s">%s</td></tr>' % (SANS, INK, e(head)))
    if lead:
        body.append('<tr><td class="ink" style="padding:12px 0 0;font-family:%s;font-size:16px;'
                    'line-height:1.6;color:%s">%s</td></tr>' % (SANS, INK, e(lead)))
    if take:
        body.append('<tr><td style="padding:14px 0 0"><table role="presentation" width="100%%" '
                    'cellpadding="0" cellspacing="0" border="0"><tr><td style="border-left:3px solid %s;'
                    'padding:4px 0 4px 12px;font-family:%s;font-size:16px;line-height:1.55;color:%s" '
                    'class="ink"><strong>%s</strong> %s%s</td></tr></table></td></tr>'
                    % (GOLD, SANS, INK, e(take_label), e(take), ""))
    _clock = clock_html(daily, today)
    if _clock:
        body.append(_clock)

    # THE SPONSOR SLOT, WHICH /sponsor SELLS AND THE EMAIL DID NOT CARRY.
    # The pitch page says, in these words: "Above the fold on every briefing
    # and the homepage. Mobile + desktop. Web + email." This file's own
    # docstring said the opposite -- "sponsors buy pageviews on the site, not
    # opens in an inbox" -- and there was no sponsor block in the message at
    # all. Two honest positions, sold as one. The page is what a sponsor
    # signs against, so the email carries the slot.
    #
    # It renders ONLY for a real, active sponsor: the house ad is a billboard
    # for finding one and has no business in a subscriber's inbox. With
    # data/sponsor.json inactive this appends nothing and the email is
    # byte-identical to what it was.
    # v5.5 (2026-10-03): the sponsor no longer sits under The Action, which
    # is now the prediction bot's call. It follows the sections instead, so
    # no reader takes an ad for part of the call or the call for part of the
    # ad. Same block, same rule (real active sponsor only).
    sp = sponsor_block(daily)

    body.append(_rule())
    body.append(price_table(daily, prior, prior_day))
    for part in (call_card(daily), yesterday_card(daily)):
        if part:
            body.append(_rule())
            body.append(part)
    sec = sections_html(daily)
    if sec:
        body.append(_rule())
        body.append(sec)
    if sp:
        body.append(_rule())
        body.append(sp)
    watch = watch_html(daily)
    if watch:
        body.append(_rule())
        body.append(watch)
    mine = elevators_html(elevators)
    if mine:
        body.append(_rule())
        body.append(mine)

    # Outlook's Word engine throws away padding and background on an inline
    # <a>, so a styled anchor arrives there as a bare blue link. The button is
    # therefore a one-cell table with a bgcolor attribute, which every client
    # since 2003 draws. This is the only shape in the message a reader is asked
    # to click, and it must never be the one thing that fails to render.
    body.append('<tr><td style="padding:26px 0 0">'
                '<table role="presentation" cellpadding="0" cellspacing="0" border="0">'
                '<tr><td class="btn" bgcolor="%s" style="background:%s;border-radius:2px;'
                'padding:11px 20px"><a class="btn" href="%s" style="text-decoration:none;'
                'color:#f3ead6;font-family:%s;font-size:13px;font-weight:700;'
                'letter-spacing:.06em;display:inline-block">'
                'Charts, calls and the full issue &rarr;</a></td></tr></table></td></tr>'
                % (INK, INK, _href(site_href), MONO))
    if _loc and local.get("ask_url"):
        body.append(_loc)
    if forward_url:
        body.append('<tr><td class="mute" style="padding:12px 0 0;font-family:%s;font-size:14px;line-height:1.5;'
                    'color:%s">Forward to a neighbor. Or send them the free sign-up link: '
                    '<a href="%s" style="color:%s">%s</a></td></tr>'
                    % (SANS, MUTE, _href(forward_url), GOLD, e(forward_url.split("://", 1)[-1])))
    foot = ('AGSIST &middot; free US farm markets &middot; '
            '<a class="mute" href="https://agsist.com" style="color:%s">agsist.com</a>' % MUTE)
    if unsub_url:
        foot += ('<br><a class="mute" href="%s" style="color:%s">'
                 'Unsubscribe</a>') % (_href(unsub_url), MUTE)
    else:
        foot += "<br>To unsubscribe, reply with subject line: unsubscribe"
    foot += "<br>PO Box 243, Chetek, WI 54728"
    body.append(_rule(26))
    body.append('<tr><td class="mute" style="padding:12px 0 0;font-family:%s;font-size:14px;'
                'line-height:1.6;color:%s">%s</td></tr>' % (SANS, MUTE, foot))

    # THE PADDING GOES ON AN INNER CELL, NOT ON THE CARD TABLE. A table is
    # content-box, so width:100% plus 26px of side padding is 100%+52px, and at
    # 390px the message ran 15px past the viewport. Nesting one padded <td>
    # inside the card is the standard fix and costs one element.
    # Outlook ignores max-width, so without the conditional "ghost table" below
    # the card stretches the full width of a maximised window and the whole
    # layout falls apart on the one client a lot of grain merchandisers use.
    # The comment is invisible to every other client, which is the point.
    return ('<!doctype html><html xmlns:v="urn:schemas-microsoft-com:vml" '
            'xmlns:o="urn:schemas-microsoft-com:office:office"><head>'
            '<meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1">'
            '<meta name="x-apple-disable-message-reformatting">'
            '<!--[if mso]><style>table,td{border-collapse:collapse;'
            'mso-line-height-rule:exactly}</style><![endif]-->'
            '<style>%s</style></head>'
            '<body class="bg" style="margin:0;padding:0;background:#f6f3ec">'
            '<table role="presentation" width="100%%" cellpadding="0" cellspacing="0" border="0" '
            'style="background:#f6f3ec" class="bg"><tr><td align="center" style="padding:24px 10px">'
            '<!--[if mso]><table role="presentation" width="600" cellpadding="0" '
            'cellspacing="0" border="0"><tr><td><![endif]-->'
            '<table role="presentation" width="100%%" cellpadding="0" cellspacing="0" border="0" '
            'style="max-width:600px;background:%s" class="card">'
            '<tr><td style="padding:28px 24px">'
            '<table role="presentation" width="100%%" cellpadding="0" cellspacing="0" border="0">'
            '%s</table></td></tr></table>'
            '<!--[if mso]></td></tr></table><![endif]-->'
            '</td></tr></table></body></html>'
            % (DARK, PAPER, "".join(body)))



def render_text(daily, site, unsub_url=None, date_display=None, elevators=None,
                local=None, forward_url=None, today=None):
    """The plain-text alternative, and it is not an afterthought.

    Some clients show it, some readers prefer it, and a multipart message with a
    neglected text part is a message that looks broken to whoever gets that one.
    No markdown, no ">" prefixes, no aligned columns that a proportional font
    will pull apart.
    """
    prior, prior_day = prior_board(daily)
    L = []
    issue = daily.get("issue_number")
    L.append("AGSIST DAILY" + (" No. %s" % issue if issue else ""))
    L.append(strip_md(daily.get("date")) or (date_display or ""))
    if local and not local.get("ask_url"):
        L += local_text(local)
    for k in ("headline", "lead"):
        v = strip_md(daily.get(k))
        if k == "headline":
            v = soften_caps(v)
        if v:
            L += ["", v]
    take = daily_action(daily)
    if take:
        lab = action_label(daily, take).upper()
        L += ["", (lab + ": " if lab else "") + take]
    else:
        take = strip_md(daily.get("the_takeaway"))
        if take:
            L += ["", "THE TAKEAWAY: " + take]
    L += clock_text(daily, today)
    # Same slot as the HTML part, same rule: real active sponsor only, never
    # the house ad. A multipart message whose text half quietly drops the
    # sponsor is a message that shortchanges them for every reader whose
    # client shows text.
    # v5.5: collected here, printed after the sections (see render_html).
    _main, L = L, []
    _sp = daily.get("sponsor")
    if isinstance(_sp, dict) and _sp.get("active") and not _sp.get("is_house_ad"):
        _who = strip_md(_sp.get("advertiser")) or ""
        L += ["", (strip_md(_sp.get("label")) or "SPONSORED") + (" - " + _who if _who else "")]
        for _k in ("headline", "body"):
            _v = strip_md(_sp.get(_k))
            if _v:
                L.append(_v)
        _f = [strip_md(x) for x in (_sp.get("facts") or []) if x]
        if _f:
            L.append(" / ".join(_f))
        _u = _sponsor_cta(_sp)
        if _u:
            L.append((strip_md(_sp.get("cta_text")) or "Learn more") + ": " + _u)
        _ph = strip_md(_sp.get("phone"))
        if _ph:
            L.append("Or call " + _ph)
        _d = strip_md(_sp.get("disclosure"))
        if _d:
            L.append(_d)
    _sponsor_lines, L = L, _main

    _b = (daily.get("board") or {})
    _ag = (_b.get("prev_close_session") if daily.get("locked_changes") else None) or prior_day
    L += ["", "THE BOARD" + (" (close, against %s)" % _ag if _ag else "")]
    for key, label, grain in ROWS:
        v = (daily.get("locked_prices") or {}).get(key)
        if not isinstance(v, (int, float)):
            continue
        p = change(daily, prior, key)
        # "label price change" on one line with single spaces: a proportional
        # font cannot pull apart what was never a column. With no prior session
        # on file the change is omitted rather than printed as "n/a" seven times.
        if not prior_day and not daily.get("locked_changes"):
            L.append("  %s %s" % (label, fmt_price(v, grain)))
        else:
            L.append("  %s %s (%s)" % (label, fmt_price(v, grain),
                                       "n/a" if p is None else ("%+.1f%%" % p)))
    c = daily.get("todays_call") or {}
    if c.get("instrument") and c.get("direction") and c.get("level") is not None:
        L += ["", "TODAY'S CALL: %s %s toward $%s. Graded against tomorrow's close."
              % (str(c["instrument"]).title(), str(c["direction"]).lower(), c["level"])]
    _yc = daily.get("yesterdays_call") or {}
    y = strip_md(_yc.get("call_line") or _yc.get("summary"))
    if y:
        _oc = str((_yc.get("computed") or {}).get("outcome") or _yc.get("outcome") or "").lower()
        _tag = {"played_out": "Played out", "didnt": "Missed"}.get(_oc, "Pending")
        L += ["", "YESTERDAY'S CALL (%s): %s" % (_tag, y)]
        _note = strip_md(_yc.get("note")) if _yc.get("call_line") else ""
        if _note:
            L.append(_note)
    for s in (daily.get("sections") or [])[:3]:
        t = strip_md(s.get("title"))
        bl_list = split_bullets(s.get("body"))
        if not t and not bl_list:
            continue
        L += ["", t.upper() if t else ""]
        for one in bl_list:
            L.append(("- " + one) if len(bl_list) > 1 else one)
        bl, ac = strip_md(s.get("so_what") or s.get("bottom_line")), strip_md(s.get("farmer_action"))
        if bl:
            L.append("So what: " + bl)
        if ac:
            L.append("Action: " + ac)
    L += _sponsor_lines
    wl = [w for w in (daily.get("watch_list") or [])[:3] if strip_md(w.get("desc"))]
    if wl:
        L += ["", "WHAT TO WATCH"]
        for w in wl:
            L.append("  %s: %s" % (strip_md(w.get("time")), strip_md(w.get("desc"))))
    if elevators:
        L += ["", "YOUR ELEVATORS"] + ["  " + x for x in elevators]
        L.append("  The elevators' own posted boards, read when this email was sent. Not a contract. "
                 "Call to confirm before you haul.")
    L += ["", "Charts, calls and the full issue: " + site]
    if local and local.get("ask_url"):
        L += local_text(local)
    if forward_url:
        L += ["", "Forward to a neighbor. Or send them the free sign-up link: " + forward_url]
    L += ["", "AGSIST, free US farm markets, agsist.com"]
    L.append("Unsubscribe: " + unsub_url if unsub_url
             else "To unsubscribe, reply with subject line: unsubscribe")
    L.append("PO Box 243, Chetek, WI 54728")
    return "\n".join(L) + "\n"


def _selftest():
    """Real archived headlines, before and after."""
    cases = {
        "CRUDE RUNS 5% ON HORMUZ, SOY OIL BREAKS HARD": "Crude runs 5% on Hormuz, soy oil breaks hard",
        "WASDE PRINTS AT 11 CT: WHEAT LEADS, BEANS REACT": "WASDE prints at 11 CT: wheat leads, beans react",
        "PRO FARMER SAYS SMALLER; CORN CLOSES AT 52-WEEK HIGH": "Pro Farmer says smaller; corn closes at 52-week high",
        "MARKETS DARK; U.S. STRIKES IRANIAN TANKERS TUESDAY LOOMS": "Markets dark; U.S. strikes Iranian tankers Tuesday looms",
        "HOGS BREAK HARD; CATTLE HOLD; CHS DROPS $700M ON CRUSH": "Hogs break hard; cattle hold; CHS drops $700M on crush",
        "CRUDE RETREATS; TRUMP-XI SUMMIT HANGS OVER BEANS": "Crude retreats; Trump-Xi summit hangs over beans",
        "WHEAT FIRMS; EPA BIOFUEL EXEMPTIONS HIT THE BOARD": "Wheat firms; EPA biofuel exemptions hit the board",
        "GRAINS SIT STILL, CATTLE SLIP AGAIN BEFORE COF": "Grains sit still, cattle slip again before COF",
        "BEANS SANK FRIDAY; SUMMIT WEEK OPENS WITH CROSSED SIGNALS": "Beans sank Friday; summit week opens with crossed signals",
        "CRUDE PULLS BACK 2.1% AS YANBU REOPENS": "Crude pulls back 2.1% as Yanbu reopens",
        "CORN HOLDS 52-WEEK HIGH; CROP PROGRESS AT 3 PM": "Corn holds 52-week high; Crop Progress at 3 PM",
        "BEANS HOLD $12.99; CRUDE AT $100, WEEK AHEAD": "Beans hold $12.99; crude at $100, week ahead",
        "CORN RALLIES ON CHINA HOPES; CATTLE JUMP 2.4%": "Corn rallies on China hopes; cattle jump 2.4%",
        "FRIDAY'S SELLOFF HITS BRAZIL BEANS": "Friday's selloff hits Brazil beans",
        # Mixed case is somebody's deliberate choice: left alone.
        "Crude runs 5% on Hormuz": "Crude runs 5% on Hormuz",
        "USDA vs the trade": "USDA vs the trade",
        "": "",
    }
    bad = [(a, soften_caps(a), b) for a, b in cases.items() if soften_caps(a) != b]
    d = {"issue_number": 209, "headline": "CRUDE RUNS 5% ON HORMUZ, SOY OIL BREAKS HARD", "lead": "x"}
    subj = subject_line(d, None)
    if "Crude runs 5% on Hormuz" not in subj or "HORMUZ" in subj:
        bad.append(("subject", subj, "sentence case"))
    txt = render_text(d, "https://agsist.com/")
    if "Crude runs 5% on Hormuz, soy oil breaks hard" not in txt or "SOY OIL" in txt:
        bad.append(("text heading", "", ""))
    # 2026-10-09: the prediction bot is out of the email. An issue still
    # carrying its call (bot_call) prints no action and no bot line.
    bd = dict(d, action="Bot call, Oct 5 close, 4 weeks out: corn $4.97 down. Backtest: no edge.",
              bot_call={"label": "BOT CALL", "text": "x", "calls": [{}], "date": "2026-10-05"})
    for part, out in (("text", render_text(bd, "https://agsist.com/")),
                      ("html", render_html(bd, "https://agsist.com/"))):
        if "Bot call" in out or "prediction bot" in out or "BOT CALL" in out:
            bad.append(("bot in " + part, "", ""))
    # A model-written action on an issue with no bot_call still prints.
    if "THE ACTION: Sell the rally" not in render_text(dict(d, action="Sell the rally"), "https://agsist.com/"):
        bad.append(("plain action", "", ""))
    # The harvest price clock: in window and fresh, out of window, stale.
    line = "Corn harvest price so far: $5.01 vs $4.62 projected (+8.4%), 4 of 22 trading days in."
    hc = {"asof": "2026-10-07", "start": "2026-10-01", "end": "2026-10-31", "lines": [line],
          "note": "USDA RMA, as of Oct 7. Oct 1-31 window, most states.", "url": "/harvest-price-tracker"}
    cd = dict(d, harvest_clock=hc)
    for when, want in ((date(2026, 10, 9), True), (date(2026, 10, 10), True),
                       (date(2026, 10, 11), False), (date(2026, 11, 1), False), (date(2026, 9, 30), False)):
        t = render_text(cd, "https://agsist.com/", today=when)
        h = render_html(cd, "https://agsist.com/", today=when)
        got = (line in t, "HARVEST PRICE CLOCK" in t, e(line) in h, CLOCK_URL in h, CLOCK_URL in t)
        if got != (want,) * 5:
            bad.append(("clock " + when.isoformat(), got, want))
    if "HARVEST PRICE CLOCK" in render_text(d, "https://agsist.com/", today=date(2026, 10, 9)):
        bad.append(("clock with no block", "", ""))
    for b in bad:
        print("FAIL", b)
    print("brief_email selftest " + ("FAILED" if bad else "ok"))
    return 1 if bad else 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(_selftest())
