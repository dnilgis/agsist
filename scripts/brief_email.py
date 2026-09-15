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
            + '<tr><td class="mute" style="padding:0 0 8px;font-family:%s;font-size:12px;color:%s">%s</td></tr>'
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
              '<div class="mute" style="font-family:%s;font-size:12px;color:%s;padding-top:4px">'
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
    head = strip_md(daily.get("headline")) or "AGSIST Daily"
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


def sponsor_block(daily):
    """The paid sponsor's block as an email table row, or "" when there isn't one.

    Deliberately plainer than the page version: no gradient, no coloured
    border, no button. Outlook's Word engine drops most of that anyway, and a
    sponsor who bought a line in a briefing that looks like a briefing does not
    want theirs to be the one element that looks like an ad network.

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
    if not (head or text):
        return ""
    parts = ['<tr><td style="padding:16px 0 0"><table role="presentation" width="100%%" '
             'cellpadding="0" cellspacing="0" border="0"><tr><td style="border-left:3px solid %s;'
             'padding:2px 0 2px 12px">' % LINE]
    parts.append('<div style="font-family:%s;font-size:10px;letter-spacing:.08em;'
                 'text-transform:uppercase;color:%s">%s%s</div>'
                 % (MONO, MUTE, label, (" &middot; " + who) if who else ""))
    if head:
        parts.append('<div class="ink" style="font-family:%s;font-size:15px;line-height:1.45;'
                     'font-weight:700;color:%s;padding-top:4px">%s</div>' % (SANS, INK, head))
    if text:
        parts.append('<div class="ink" style="font-family:%s;font-size:14px;line-height:1.55;'
                     'color:%s;padding-top:5px">%s</div>' % (SANS, INK, text))
    if cta_u:
        parts.append('<div style="padding-top:7px"><a href="%s" rel="sponsored noopener" '
                     'style="font-family:%s;font-size:12px;font-weight:700;letter-spacing:.05em;'
                     'text-transform:uppercase;color:%s;text-decoration:underline">%s &rarr;</a></div>'
                     % (cta_u, MONO, GOLD, cta_t))
    if disc:
        parts.append('<div class="mute" style="font-family:%s;font-size:11px;line-height:1.5;'
                     'color:%s;padding-top:6px">%s</div>' % (SANS, MUTE, disc))
    parts.append('</td></tr></table></td></tr>')
    return "".join(parts)


def render_html(daily, site_href, unsub_url=None, date_display=None):
    prior, prior_day = prior_board(daily)
    head = strip_md(daily.get("headline"))
    lead = strip_md(daily.get("lead"))
    # v5.1: the action holds the slot the takeaway had. An issue from before
    # the cut has no action and keeps its takeaway.
    take = strip_md(daily.get("action"))
    take_label = "The action." if take else "The takeaway."
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
        'opacity:0;color:transparent;font-size:1px;line-height:1px">%s</div>' % e(take or lead),
        '<tr><td style="font-family:%s;font-size:11px;font-weight:700;letter-spacing:.14em;'
        'text-transform:uppercase;color:%s" class="mute">%s</td></tr>' % (MONO, MUTE, mast),
        '<tr><td style="padding:2px 0 0;font-family:%s;font-size:12px;color:%s" class="mute">%s</td></tr>'
        % (SANS, MUTE, e(date_display)),
    ]
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
                    'class="ink"><strong>%s</strong> %s</td></tr></table></td></tr>'
                    % (GOLD, SANS, INK, e(take_label), e(take)))

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
    sp = sponsor_block(daily)
    if sp:
        body.append(_rule())
        body.append(sp)

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
    watch = watch_html(daily)
    if watch:
        body.append(_rule())
        body.append(watch)

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
    foot = ('AGSIST &middot; free US ag market intelligence &middot; '
            '<a class="mute" href="https://agsist.com" style="color:%s">agsist.com</a>' % MUTE)
    if unsub_url:
        foot += ('<br><a class="mute" href="%s" style="color:%s">'
                 'Unsubscribe</a>') % (_href(unsub_url), MUTE)
    else:
        foot += "<br>To unsubscribe, reply with subject line: unsubscribe"
    body.append(_rule(26))
    body.append('<tr><td class="mute" style="padding:12px 0 0;font-family:%s;font-size:12px;'
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



def render_text(daily, site, unsub_url=None, date_display=None):
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
    for k in ("headline", "lead"):
        v = strip_md(daily.get(k))
        if v:
            L += ["", v]
    take = strip_md(daily.get("action"))
    if take:
        L += ["", "THE ACTION: " + take]
    else:
        take = strip_md(daily.get("the_takeaway"))
        if take:
            L += ["", "THE TAKEAWAY: " + take]
    # Same slot as the HTML part, same rule: real active sponsor only, never
    # the house ad. A multipart message whose text half quietly drops the
    # sponsor is a message that shortchanges them for every reader whose
    # client shows text.
    _sp = daily.get("sponsor")
    if isinstance(_sp, dict) and _sp.get("active") and not _sp.get("is_house_ad"):
        _who = strip_md(_sp.get("advertiser")) or ""
        L += ["", (strip_md(_sp.get("label")) or "SPONSORED") + (" - " + _who if _who else "")]
        for _k in ("headline", "body"):
            _v = strip_md(_sp.get(_k))
            if _v:
                L.append(_v)
        _u = _sponsor_cta(_sp)
        if _u:
            L.append((strip_md(_sp.get("cta_text")) or "Learn more") + ": " + _u)
        _d = strip_md(_sp.get("disclosure"))
        if _d:
            L.append(_d)

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
    wl = [w for w in (daily.get("watch_list") or [])[:3] if strip_md(w.get("desc"))]
    if wl:
        L += ["", "WHAT TO WATCH"]
        for w in wl:
            L.append("  %s: %s" % (strip_md(w.get("time")), strip_md(w.get("desc"))))
    L += ["", "Charts, calls and the full issue: " + site, "",
          "AGSIST, free US ag market intelligence, agsist.com"]
    L.append("Unsubscribe: " + unsub_url if unsub_url
             else "To unsubscribe, reply with subject line: unsubscribe")
    return "\n".join(L) + "\n"
