#!/usr/bin/env python3
"""
send_land_alert.py: the monthly land sale email (subs worker v5.55).

A reader beside the recorded sales (Field Scout, the comp report, Fast Facts, the Atlas county
pages) asks "Email me new farm sales within 25 miles of my ZIP, once a month." The worker stores
topic landsales:<ZIP>:<miles> under note:<email>. This script is the other half: on the 3rd of
each month (.github/workflows/land-alert.yml, after land-data.yml has fetched the month), it reads
the landsales: sign-ups from GET /notice-list, mails each address once per topic with the farm
sales recorded the month before within that radius, and marks it with POST /notice-mark {month}
only after the send went through. A row already marked for that month (mo) is never mailed again,
so any number of runs is safe. A month with no sales to list sends nothing and marks nothing.

WHICH MONTH EACH READER GETS (Nov 3, 2026, option 1). The month just ended, when every state
within the reader's radius has published it (land_alert.ready()). When one has not (Wisconsin posts its
transfer returns about a month behind), the month before, if it is ready and the reader has not had it,
said plainly in the subject and the first line ("September is the newest month Wisconsin has published;
October follows when the state posts it."). Never a month older than that, never a month twice (the
worker keeps mo, the newest data month mailed, and a reader is only mailed a month after it), never an
empty month. When the later month lands, the next run mails it: the run on the 3rd, or --catch-up, which
land-alert.yml runs after a land data run that committed data/land.

--catch-up: a send, for the readers who signed up before this month's send on the 3rd (15:47 UTC, the
schedule); a reader who signed up later is told the first email comes the next 3rd and gets it then.
Before this month's send time it does nothing (the monthly run has not gone yet).

THE NUMBERS come from scripts/land_alert.py (the shared market-sale rule, sales placed at their
township or town, the middle price only past its gates). No buyer or seller name, parcel number,
legal description or document number is in any email: land_alert.row() is the only shape a sale
reaches this file in, and the selftest feeds named rows and checks the output.

MODES (the same three as send_rain_month.py):
  dry      the default. Counts the list (and, without --month, what it would get now: counts by data
           month and by the state not posted yet) and renders samples (a made-up address and link id)
           into the log. Without --month a sample is what a reader there gets now. Sends nothing.
  preview  the owner's test inbox only (SIG_TEST_EMAILS, else SIG_TO), one email per sample
           (--sample, default Chetek 54728 at 25 mi and Charleston, IL 61920 at 25 mi), with
           "[Preview]" in the subject. build rule 13: this is the copy that goes through the spam
           and link checkers before the list gets anything. The list is never read for addresses.
  send     the list. Refused unless LANDSALES_MONTHLY_LIVE=1 (the owner turns it on; the workflow
 passes the repo variable) and the month is the one just ended.

THE SENDING ROUTE: the same SMTP_* and FROM_ADDR secrets as the Daily. build rule 12 (no site
email through the owner's own Google account) is the target; until Plan A sending is migrated, the owner's
Oct 23 decision is that new list emails go the way the Daily does now. Plan A is a swap of those
secrets; nothing in this file changes then.

    python3 scripts/send_land_alert.py                                  # dry run
    PREVIEW=1 python3 scripts/send_land_alert.py                        # the owner's test inbox only
    SEND=1 LANDSALES_MONTHLY_LIVE=1 python3 scripts/send_land_alert.py
    python3 scripts/send_land_alert.py --month 2026-09 --out <dir>       # sample renders, send nothing
    python3 scripts/send_land_alert.py --selftest                       # fake HTTP and SMTP; no network

Env: LIST_URL, LIST_TOKEN, UNSUB_SECRET, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, FROM_ADDR,
LANDSALES_MONTHLY_LIVE, SIG_TEST_EMAILS / SIG_TO (preview), BIDS_BASE (the ZIP table; default the
bids site), MAX_PER_RUN (default 300).

The log carries counts only: no address and no reader's ZIP is ever printed, error lines included.
Reply-To is news@agsist.com. The stop link carries no ZIP (build rule 10): topic=landsales stops
every land sale email of that address and nothing else.
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import argparse
import html as H
import json
import os
import re
import smtplib
import sys
import time
import urllib.parse
from datetime import date, datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
sys.path.insert(0, str(HERE))
import email_links                 # noqa: E402  link ids, the front door, check_message
import log_safe                    # noqa: E402  sender_addr
import delivery_line             # noqa: E402  (the DELIVERY count line cron_health reads)
import send_pace  # noqa: E402  batches, one try more for a deferral, hard bounces (scripts/send_pace.py)
TALLY = None  # set in __main__ only (never by a selftest): delivery_line's per-run counts
import send_notice as SN           # noqa: E402  unsub_link, footer, transport, EMAIL_RE, TZ
from send_watch import base_msg    # noqa: E402  headers, List-Unsubscribe
import land_alert as LA            # noqa: E402  the numbers

SITE = SN.SITE
TOPIC_PRE = "landsales:"
STOP_TOPIC = "landsales"
TOPIC_RE = re.compile(r"landsales:(\d{5}):(10|25|50)")
UTM = "utm_source=land_month&utm_medium=email"
REPLY_TO = "news@agsist.com"
FROM_NAME = "Sig at AGSIST"
SAMPLES = (("54728", 25), ("61920", 25))     # Chetek, Wisconsin; Charleston, Illinois


# ---------------------------------------------------------------- where the reader is
class Zips:
    """ZIP -> (lat, lon) and "Town, ST" from the bids repo's ZIP table (the one the cash bid ZIP
    search reads). coord(): (lat, lon), None (no such ZIP) or False (the table could not be read)."""

    def __init__(self, base=None, data=None):
        self.data = data
        self.b = None
        if data is None:
            import local_bid
            self.b = local_bid.BidsData(base or os.environ.get("BIDS_BASE") or None)

    def coord(self, z):
        if self.data is not None:
            v = self.data.get(z)
            return tuple(v[:2]) if v else None
        return self.b.zip_coord(z)

    def town(self, z):
        if self.data is not None:
            v = self.data.get(z)
            return v[2] if v and len(v) > 2 else None
        return self.b.zip_town(z)


# ---------------------------------------------------------------- the email
def tag(u):
    return u + ("&" if "?" in u else "?") + UTM


def atlas_url(st, county, repo):
    """The county's Farmland Atlas page when it is in this checkout, else the Atlas."""
    s = LA.STATE_SLUGS.get(st)
    slug = re.sub(r"[^a-z0-9]+", "-", str(county or "").lower()).strip("-")
    p = "farmland-atlas/%s/%s-county" % (s, slug)
    if s and slug and (Path(repo) / (p + ".html")).is_file():
        return SITE + "/" + p
    return SITE + "/farmland-atlas"


def scout_url(r):
    """Field Scout opened on the nearest sale's township point (a public gazetteer point, never the
    reader's ZIP), with its county's record in the side panel."""
    lat, lon = r["pt"]
    return "%s/field-scout?at=%.3f,%.3f&fips=%s" % (SITE, lat, lon, r["fips"])


def update_states(repo):
    """The states the update page covers (data/land-sales/latest.json), in words."""
    try:
        sts = json.load(open(Path(repo) / "data" / "land-sales" / "latest.json", encoding="utf-8")).get("states") or []
    except (OSError, ValueError):
        sts = []
    n = [LA.STATE_NAMES.get(s, s) for s in sts] or ["Illinois", "Wisconsin"]
    return n[0] if len(n) == 1 else ", ".join(n[:-1]) + " and " + n[-1]


def update_url(year, m0, repo):
    """The month's land sales update page (scripts/build_land_sales.py) when it is in this checkout, else None."""
    p = "land-sales/%04d-%02d" % (year, m0 + 1)
    return SITE + "/" + p if (Path(repo) / (p + ".html")).is_file() else None


def sale_url(r, repo):
    """The sale's own row on its county sale page (Nov 3, 2026): SITE/land-sales/<state>/<county>?utm...#s-<sale id>.
    The id is land_alert.sale_id (a hash, never a name); build_land_sales gives the row that id. A county page
    not in this checkout: the farm sales hub instead, so every sale line still has its one link."""
    p = "land-sales/%s/%s" % (LA.STATE_SLUGS.get(r["st"], ""), LA.county_slug(r["county"]))
    if LA.STATE_SLUGS.get(r["st"]) and r.get("sid") and (Path(repo) / (p + ".html")).is_file():
        return tag(SITE + "/" + p) + "#s-" + r["sid"]
    return tag(SITE + "/land-sales/")


def sale_line(r, mark=True):
    """One sale in words: date, acres, $/acre, price, where, how far. Nothing else.
    mark: say "(deed date)" on a row listed by its deed date (an email that mixes the two)."""
    when = LA.when_short(r) + (" (deed date)" if mark and r["basis"] == "sale date" else "")
    per = "%s an acre" % LA.money(r["ppa"]) if r.get("ppa") is not None else "price per acre not figured"
    where = (r["place"] + ", " if r.get("place") else "") + "%s County, %s" % (r["county"], r["st"])
    mi = int(LA.BLS.js_round(r["mi"]))
    far = "under a mile" if mi < 1 else ("1 mile" if mi == 1 else "%d miles" % mi)
    bl = ", with buildings" if r.get("bldg") else ""
    return "%s: %s acres at %s (%s%s), %s, %s" % (when, LA.acres_text(r["acres"]), per, LA.money(r["price"]), bl, where, far)


def median_words(med, radius):
    """The one short line on the middle price, or its reason in words."""
    if not med.get("cur"):
        return "No middle price for the area this month: %s." % med["why"]
    s = med["cur"]
    t = ("The middle price for farm sales of %d acres or more within %d miles over the last 12 months: %s an acre, from %d sales."
         % (LA.MED_MIN_ACRES, radius, LA.money(s["med"]), s["n"]))
    if med.get("prev"):
        p, c = med["prev"], med["chg"]
        move = "about the same" if abs(c) < 0.5 else ("up %s%%" % format(abs(c), "g") if c > 0 else "down %s%%" % format(abs(c), "g"))
        t += " The 12 months before: %s from %d sales, so %s." % (LA.money(p["med"]), p["n"], move)
    else:
        t += " I am not putting it against the year before this month: %s." % med["why_cmp"]
    return t


def names_of(sts):
    n = [LA.STATE_NAMES.get(s, s) for s in sts]
    return n[0] if len(n) == 1 else ", ".join(n[:-1]) + " and " + n[-1]


def lag_line(m0, late):
    """The first line when a reader gets the month before: which state has not posted the newer month."""
    nxt = LA.MONTHS[(m0 + 1) % 12]
    one = len(late) == 1
    return ("%s is the newest month %s %s published; %s follows when the %s %s it."
            % (LA.MONTHS[m0], names_of(late), "has" if one else "have", nxt, "state" if one else "states", "posts" if one else "post"))


def compose(zip5, radius, year, m0, land, zips, today, repo, need_fresh="posted", late=None):
    """(subject, preheader, blocks) for one ZIP and radius, or (None, why).
    why: bad-zip, zip-table (the ZIP table could not be read), outside, wait-data, empty.
    late: the states that have not published the month after this one (the reader gets this month
    because of them); the first line says so."""
    ll = zips.coord(zip5)
    if ll is False:
        return None, "zip-table"
    if not ll:
        return None, "bad-zip"
    rep = LA.month_report(land, ll, radius, year, m0, today, need_fresh=need_fresh)
    if "skip" in rep:
        return None, rep["skip"]
    if not rep["rows"]:
        return None, "empty"                  # a month with no sales sends nothing
    town = zips.town(zip5)
    here = "%s (%s)" % (zip5, town) if town else zip5
    mon = LA.MONTHS[m0]
    n = rep["n"]
    subject = "Farm sales within %d miles of %s, %s: %d recorded" % (radius, zip5, mon, n)
    near = rep["rows"][0]
    pre = "Nearest: " + sale_line(near, False).split(": ", 1)[1]
    blocks = [("h1", "Farm sales recorded in %s %d within %d miles of %s" % (mon, year, radius, here))]
    if late:
        blocks.append(("p", lag_line(m0, late)))
    blocks += [("p", "Here are the farm sales recorded in %s within %d miles of your ZIP, nearest first, from the state transfer records. "
                    "I show the acres, the price and where each one is. I never show who bought or sold." % (mon, radius))]
    by_sale = sorted({r["st"] for r in rep["rows"] if r["basis"] == "sale date" and r["st"] != "IN"})
    if any(r["st"] == "IN" for r in rep["rows"]):
        blocks.append(("p", LA.IN_NOTE))
    if by_sale:
        blocks.append(("p", "%s sales are listed by the date on the deed for now: my copy of the state's file does not carry the recording date yet."
                       % " and ".join(LA.STATE_NAMES[s] for s in by_sale)))
    by_month = sorted({r["st"] for r in rep["rows"] if r["basis"] == "sale month"})
    if by_month:
        blocks.append(("p", "%s sales are listed by the month of the sale: the state's file gives the month, not the day."
                       % " and ".join(LA.STATE_NAMES[s] for s in by_month)))
    blocks.append(("sales", [dict(r, url=sale_url(r, repo)) for r in rep["rows"]]))
    extra = []
    if rep["more"]:
        extra.append("%d more %s within %d miles" % (rep["more"], "sale" if rep["more"] == 1 else "sales", radius))
    if rep["no_acres"]:
        extra.append("%d with the acres left off the return" % rep["no_acres"])
    if extra:
        blocks.append(("p", "Also recorded, not listed here: " + ", ".join(extra) + "."))
    blocks.append(("p", median_words(rep["median"], radius)))
    # the county with the most listed sales, nearest first on a tie
    cn = {}
    for r in rep["rows"]:
        cn[(r["st"], r["county"])] = cn.get((r["st"], r["county"]), 0) + 1
    top = max(cn, key=lambda k: (cn[k], -min(x["mi"] for x in rep["rows"] if (x["st"], x["county"]) == k)))
    up = update_url(year, m0, repo)
    if up:
        blocks.append(("link", ("The whole month across %s: the biggest buyers, the biggest sales, unusual prices and the best value per acre: " % update_states(repo), tag(up))))
    blocks.append(("link", ("Every recorded sale around a field, on a map, with a free comparable sales report: ", tag(scout_url(near)))))
    blocks.append(("link", ("%s County's sale prices and land record in the Farmland Atlas: " % top[1], tag(atlas_url(top[0], top[1], repo)))))
    reads = "; ".join("%s, read %s" % (LA.SOURCES[s], LA.long_day(rep["read"][s])) for s in sorted(rep["read"]) if s in LA.SOURCES)
    blocks.append(("fine", "Sales: %s. A sale is listed when it carries a price and acres and a whole interest changed hands in a normal sale: "
                           "gifts, family and related-party sales, quit claims, foreclosures and the like are left out, the same rule as Field Scout "
                           "and the Atlas. Distances run from the middle of your ZIP to the middle of the township or town the sale is in, so "
                           "they are close, not exact. The middle price counts sales by their deed date. None of this is an appraisal." % reads))
    blocks += [("p", "Sig"),
               ("fine", SN.SIGNATURE + ". You asked for this on agsist.com: one email a month with the farm sales recorded within %d miles of %s. "
                                       "A month with none sends nothing." % (radius, zip5))]
    return (subject, pre, blocks), "send"


def render(email, base, secret, lid, parts, from_addr, preview=False):
    subject, pre, blocks = parts
    if preview:
        subject = "[Preview] " + subject
    stop = SN.unsub_link(base, secret, lid, STOP_TOPIC)
    e = H.escape
    txt, htm = [], []
    P = '<p style="font-size:15px;line-height:1.6;margin:0 0 14px">%s</p>'
    for k, v in blocks:
        if k == "h1":
            htm.append('<h1 style="font-size:20px;line-height:1.3;margin:0 0 14px">%s</h1>' % e(v))
            txt.append(v)
        elif k == "p":
            htm.append(P % e(v))
            txt.append(v)
        elif k == "fine":
            htm.append('<p style="font-size:12px;line-height:1.5;color:#6b6b6b;margin:0 0 14px">%s</p>' % e(v))
            txt.append(v)
        elif k == "link":
            t, u = v
            htm.append(P % (e(t) + '<a href="%s" style="color:#8a5a00">%s</a>' % (e(u), e(u.split("?")[0].replace("https://", "")))))
            txt.append(t + u)
        elif k == "sales":
            mixed = len({r["basis"] for r in v}) > 1
            head = "Recorded" if all(r["basis"] == "recorded" for r in v) else "Sale month" if all(r["basis"] == "sale month" for r in v) else ("Date" if mixed else "Deed date")
            TD = '<td style="padding:6px 8px 6px 0;border-top:1px solid #e6dfd0;vertical-align:top;font-size:14px%s">%s</td>'
            TH = '<th scope="col" style="text-align:%s;padding:0 8px 4px 0;font-size:12px;color:#6b6b6b;font-weight:normal">%s</th>'
            h = ['<table role="presentation" style="border-collapse:collapse;width:100%;margin:0 0 14px"><thead><tr>'
                 + "".join(TH % (al, x) for al, x in (("left", head), ("right", "Acres"), ("right", "$/acre"), ("right", "Price"),
                                                      ("left", "Where"), ("right", "Miles"))) + "</tr></thead><tbody>"]
            for r in v:
                when = LA.when_short(r) + (" (deed date)" if mixed and r["basis"] == "sale date" else "")
                where = (r["place"] + ", " if r.get("place") else "") + "%s Co., %s" % (r["county"], r["st"]) + (", with buildings" if r.get("bldg") else "")
                NW = ";white-space:nowrap"
                h.append("<tr>" + TD % (NW, '<a href="%s" style="color:#8a5a00">%s</a>' % (e(r["url"]), e(when))) + TD % (NW + ";text-align:right", e(LA.acres_text(r["acres"])))
                         + TD % (NW + ";text-align:right", e(LA.money(r["ppa"]) if r.get("ppa") is not None else "n/a"))
                         + TD % (NW + ";text-align:right", e(LA.money(r["price"]))) + TD % ("", e(where))
                         + TD % (";text-align:right", "%d" % LA.BLS.js_round(r["mi"])) + "</tr>")
            htm.append("".join(h) + "</tbody></table>")
            txt.append("\n".join(sale_line(r, mixed) + "\n" + r["url"] for r in v))
    text = "\n\n".join(txt) + "\n\n-- \n" + SN.FOOT_LINE + "\nUnsubscribe: " + stop + "\n" + SN.POSTAL + "\n"
    foot = '%s<br><a href="%s" style="color:#6b6b6b">Unsubscribe</a><br>%s' % (e(SN.FOOT_LINE), e(stop), e(SN.POSTAL))
    doc = ('<!doctype html><html><head><meta charset="utf-8">'
           '<meta name="viewport" content="width=device-width,initial-scale=1"><title>%s</title></head>'
           '<body style="margin:0;padding:0;background:#f6f3ec">'
           '<div style="display:none;max-height:0;overflow:hidden">%s</div>'
           '<div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;padding:24px 16px;color:#1a1a1a;background:#fffdf8">'
           '%s<p style="font-size:13px;color:#6b6b6b;line-height:1.6;margin:22px 0 0;border-top:1px solid #ddd5c4;padding-top:12px">%s</p>'
           '</div></body></html>') % (e(subject), e(pre), "".join(htm), foot)
    msg = base_msg(email, subject, FROM_NAME, from_addr, REPLY_TO, stop)
    del msg["List-Unsubscribe-Post"]          # the stop link asks first; no one-click POST (as send_notice)
    msg.set_content(text)
    msg.add_alternative(doc, subtype="html")
    return email_links.check_message(msg)


def due(zip5, radius, mo, ly, lm, land, zips, today, repo, cache=None):
    """What one reader gets now: (parts, why, (year, m0)). mo: the newest month the reader was mailed
    ("YYYY-MM" or ""). The month just ended when it is ready for every state near; else the month before,
    when it is ready and newer than mo, with the line that says why (Nov 3, 2026). Never older.
    why: send, done (mailed for the month just ended), wait-data (the newer month not posted and nothing
    else due), empty, outside, bad-zip, zip-table."""
    cache = {} if cache is None else cache
    py, pm = (ly - 1, 11) if lm == 0 else (ly, lm - 1)

    def comp(y, m, late=None):
        k = (zip5, radius, y, m, tuple(late or ()))
        if k not in cache:
            cache[k] = compose(zip5, radius, y, m, land, zips, today, repo, late=late)
        return cache[k]
    if mo and mo >= "%d-%02d" % (ly, lm + 1):
        return None, "done", (ly, lm)
    ll = zips.coord(zip5)
    if ll is False:
        return None, "zip-table", (ly, lm)
    if not ll:
        return None, "bad-zip", (ly, lm)
    rep = LA.month_report(land, ll, radius, ly, lm, today, need_fresh="posted")
    if rep.get("skip") != "wait-data":
        parts, why = comp(ly, lm)
        return parts, why, (ly, lm)
    late = rep.get("states") or [rep.get("state")]
    if mo and mo >= "%d-%02d" % (py, pm + 1):
        return None, "wait-data", (ly, lm)
    parts, why = comp(py, pm, late)
    if why in ("wait-data", "empty"):
        return None, "wait-data", (ly, lm)       # the month before is not posted either, or had nothing: waiting for the newer one
    return parts, why, (py, pm)


def choice_words(zip5, radius, parts, why, ym, ly, lm, land, zips, today):
    """Why due() chose what it chose, in words for the log (states and months, never a reader)."""
    mo = lambda y, m: LA.MON[m] + " " + str(y)
    py, pm = (ly - 1, 11) if lm == 0 else (ly, lm - 1)
    def n(p):
        k = int(re.search(r": (\d+) recorded$", p[0]).group(1))
        return "%d sale%s" % (k, "" if k == 1 else "s")
    if parts and ym == (ly, lm):
        return "%s posted, %s" % (mo(ly, lm), n(parts))
    late = "+".join(wait_states(zip5, radius, ly, lm, land, zips, today))
    if parts:
        return "%s not posted %s; %s posted, %s" % (late, mo(ly, lm), mo(py, pm), n(parts))
    if why == "wait-data":
        prev = compose(zip5, radius, py, pm, land, zips, today, str(land.repo))[1]
        return "no email: %s not posted %s; %s %s" % (late, mo(ly, lm), mo(py, pm), "has no sales" if prev == "empty" else "not posted either")
    return "no email (%s) for %s" % (why, mo(ly, lm))


def wait_states(zip5, radius, ly, lm, land, zips, today):
    """The states that have not posted the month just ended near this reader (for the log, as counts)."""
    ll = zips.coord(zip5)
    if not ll:
        return []
    rep = LA.month_report(land, ll, radius, ly, lm, today, need_fresh="posted")
    return rep.get("states") or ([rep["state"]] if rep.get("state") else [])


def sort_list(rows, ly, lm, land, zips, tiso, repo, out, month, cap, cutoff=None, label=""):
    """Each sign-up: what it gets now (due()), counted. Returns [(email, topic, parts, lid, data month)], at most cap.
    The log lines carry counts only: never an address, never a ZIP (states and months are counts' labels)."""
    todo, seen, skipped, done, wait, cache, later_signup, wst, per_month = [], set(), 0, 0, {}, {}, 0, {}, {}
    for r in rows:
        r = r or {}
        e = str(r.get("email") or "").strip().lower()
        t = str(r.get("topic") or "")
        mt = TOPIC_RE.fullmatch(t)
        lid = email_links.lid_of(r)
        if not mt or not SN.EMAIL_RE.match(e) or (e, t) in seen or not lid:
            skipped += 1
            continue
        seen.add((e, t))
        if cutoff is not None and isinstance(r.get("ts"), (int, float)) and r["ts"] > cutoff:
            later_signup += 1          # signed up after this month's send: the next 3rd
            continue
        k = (mt.group(1), int(mt.group(2)))
        parts, why, ym = due(k[0], k[1], str(r.get("mo") or ""), ly, lm, land, zips, tiso, repo, cache)
        if why == "done":
            done += 1
            continue
        if not parts:
            wait[why] = wait.get(why, 0) + 1
            if why == "wait-data":
                for st in wait_states(k[0], k[1], ly, lm, land, zips, tiso):
                    wst[st] = wst.get(st, 0) + 1
            continue
        mo_ = "%d-%02d" % (ym[0], ym[1] + 1)
        why_ = "" if ym == (ly, lm) else " (%s not posted)" % "+".join(wait_states(k[0], k[1], ly, lm, land, zips, tiso))
        per_month[mo_ + why_] = per_month.get(mo_ + why_, 0) + 1
        todo.append((e, t, parts, lid, mo_))
    later = max(0, len(todo) - cap)
    todo = todo[:cap]
    out(label + "%s%s: %d to mail, %d already mailed for it, %d not mailed (%s), %d skipped, %d left for the next run"
        % (TOPIC_PRE, month, len(todo), done, sum(wait.values()), ", ".join("%s %d" % kv for kv in sorted(wait.items())) or "none",
           skipped, later))
    # counts only: the data month each reader due gets, and the states not posted yet (a reader may count under two)
    if per_month:
        out(label + "%s%s: by data month: %s" % (TOPIC_PRE, month, ", ".join("%s %d" % kv for kv in sorted(per_month.items(), reverse=True))))
    if wst:
        out(label + "%s%s: waiting on the state to post %s: %s" % (TOPIC_PRE, month, month, ", ".join("%s %d" % kv for kv in sorted(wst.items()))))
    if cutoff is not None:
        out(label + "%s%s: catch-up; %d signed up after this month's send and get the next 3rd's" % (TOPIC_PRE, month, later_signup))
    return todo


# ---------------------------------------------------------------- the run
def last_month(today):
    """(year, 0-based month) of the month just ended."""
    return (today.year - 1, 11) if today.month == 1 else (today.year, today.month - 2)


SEND_AT = (3, 15, 47)          # the 3rd, 15:47 UTC: land-alert.yml's schedule (cron "47 15 3 * *")


def send_time(now_utc):
    """This month's send time (UTC) of the schedule."""
    d, h, mi = SEND_AT
    return now_utc.replace(day=d, hour=h, minute=mi, second=0, microsecond=0)


def mode_of(argv):
    """dry (default), preview or send. DRY_RUN=1 wins; the list only on SEND=1 / --send."""
    if SN.env("DRY_RUN", "") == "1" or "--dry-run" in argv:
        return "dry"
    if SN.env("PREVIEW", "") == "1" or "--preview" in argv:
        return "preview"
    if SN.env("SEND", "") == "1" or "--send" in argv or "--catch-up" in argv:
        return "send"
    return "dry"


def preview_to():
    """SIG_TEST_EMAILS (comma list), else SIG_TO. Never printed."""
    return [x.strip().lower() for x in (SN.env("SIG_TEST_EMAILS", "") or SN.env("SIG_TO", "") or "").split(",") if "@" in x]


def mark(http, base, tok, email, topic, month, sleep):
    for i in range(3):
        try:
            r = http("POST", "%s/notice-mark?token=%s" % (base, urllib.parse.quote(tok)), {"email": email, "topic": topic, "month": month})
            if isinstance(r, dict) and r.get("ok"):
                return True
        except Exception:
            pass
        sleep(2 * (i + 1))
    return False


def samples_of(s):
    out = []
    for x in [x for x in re.split(r"[,\s]+", s or "") if x]:
        m = re.fullmatch(r"(\d{5})(?::(10|25|50))?", x)
        if m:
            out.append((m.group(1), int(m.group(2) or LA.DEFAULT_MILES)))
    return out


def run(argv, http=SN.http_json, connect=SN.smtp_connect, now=None, sleep=time.sleep, out=print, repo=REPO, zips=None):
    p = argparse.ArgumentParser(add_help=False)
    for a in ("--send", "--preview", "--dry-run", "--catch-up"):
        p.add_argument(a, action="store_true")
    p.add_argument("--month", default="")
    p.add_argument("--sample", default="")
    p.add_argument("--out", default="")
    p.add_argument("--max", type=int, default=int(SN.env("MAX_PER_RUN", "300")))
    a = p.parse_args(argv)
    mode = mode_of(argv)
    if a.out:
        mode = "dry"           # writing sample files never sends
    if TALLY:
        TALLY.dry = mode != "send"
    today = (now or datetime.now(SN.TZ)).astimezone(SN.TZ).date()
    tiso = today.isoformat()
    ly, lm = last_month(today)
    if a.month:
        mm = re.fullmatch(r"(\d{4})-(0[1-9]|1[0-2])", a.month)
        if not mm:
            out("--month is YYYY-MM")
            return 1
        year, m0 = int(mm.group(1)), int(mm.group(2)) - 1
    else:
        year, m0 = ly, lm
    month = "%d-%02d" % (year, m0 + 1)
    out("date %s (America/Chicago), month %s, mode %s" % (tiso, month, mode))
    if mode == "send":
        if SN.env("LANDSALES_MONTHLY_LIVE", "") != "1":
            if TALLY:
                TALLY.dry = True
            out("refused: LANDSALES_MONTHLY_LIVE is not 1, so the land sale list gets nothing (Sig turns it on). Nothing sent.")
            return 1
        if (year, m0) != (ly, lm):
            out("refused: a send is for the month just ended (%d-%02d), not %s. Nothing sent." % (ly, lm + 1, month))
            return 1

    land = LA.Land(repo)
    zips = zips or Zips()
    base, tok, secret = SN.env("LIST_URL"), SN.env("LIST_TOKEN"), SN.env("UNSUB_SECRET")
    try:
        from_addr = log_safe.sender_addr("news@agsist.com" if mode == "dry" else "")
    except RuntimeError as ex:
        out("FATAL: " + str(ex))
        return 1

    # dry and preview: the samples
    if mode in ("dry", "preview"):
        made = []
        for i, (z, mi) in enumerate(samples_of(a.sample) or list(SAMPLES), 1):
            if a.month:
                # a month asked for: that month, drawn from the files on hand (the freshness wait is for the list)
                parts, why = compose(z, mi, year, m0, land, zips, tiso, repo, need_fresh=False)
                out("sample %d: %s (asked for)%s" % (i, month, "" if parts else "; no email (%s)" % why))
            else:
                # no month asked: the month a send would choose for a reader there who has had nothing yet
                parts, why, ym = due(z, mi, "", ly, lm, land, zips, tiso, repo)
                out("sample %d: %s" % (i, choice_words(z, mi, parts, why, ym, ly, lm, land, zips, tiso)))
            if parts:
                made.append((z, mi, parts))
        if mode == "dry":
            n_list = None
            if base and tok:
                try:
                    rows = http("GET", "%s/notice-list?token=%s&topic=%s" % (base.rstrip("/"), urllib.parse.quote(tok), urllib.parse.quote(TOPIC_PRE)))
                    n_list = len([r for r in rows or [] if TOPIC_RE.fullmatch(str((r or {}).get("topic") or ""))]) if isinstance(rows, list) else None
                except Exception as ex:
                    out("could not read the list (%s)" % type(ex).__name__)
            if n_list is not None:
                out("list: %d land sale sign-up(s)" % n_list)
                if not a.month:
                    # what the list would get now, counts only (a dry run mails and marks nothing)
                    sort_list(rows, ly, lm, land, zips, tiso, repo, out, month, a.max, label="dry: ")
            for z, mi, parts in made:
                msg = render("reader@example.com", base or "https://w.dev", "preview", email_links.SAMPLE_LID, parts, from_addr)
                out("sample (a made-up address and link id):")
                out("Subject: " + str(msg["Subject"]))
                out(msg.get_body(("plain",)).get_content().rstrip())
                if a.out:
                    os.makedirs(a.out, exist_ok=True)
                    stem = os.path.join(a.out, "land-sales-%s-%dmi-%s" % (z, mi, month))
                    open(stem + ".html", "w", encoding="utf-8").write(msg.get_body(("html",)).get_content())
                    open(stem + ".txt", "w", encoding="utf-8").write("Subject: %s\nFrom: %s\nReply-To: %s\nList-Unsubscribe: %s\n\n%s" % (
                        msg["Subject"], msg["From"], msg["Reply-To"], msg["List-Unsubscribe"], msg.get_body(("plain",)).get_content()))
                    out("wrote " + stem + ".html")
            out("dry run: nothing sent, nothing marked.")
            return 0
        to = preview_to()
        if not to:
            out("FATAL: a preview needs SIG_TEST_EMAILS or SIG_TO; nothing sent")
            return 1
        if not (base and secret):
            out("FATAL: a preview needs LIST_URL and UNSUB_SECRET for its stop link; nothing sent")
            return 1
        if not made:
            out("nothing to preview")
            return 1
        import list_source
        sent = 0
        try:
            conn = connect()
        except Exception as ex:
            out("could not connect to SMTP (%s)" % type(ex).__name__)
            return 1
        try:
            for addr in to:
                lid = list_source.lid_for(addr) or email_links.SAMPLE_LID
                for z, mi, parts in made:
                    try:
                        conn.send_message(render(addr, base.rstrip("/"), secret, lid, parts, from_addr, preview=True))
                        sent += 1
                    except Exception as ex:
                        out("  preview send failed (%s)" % type(ex).__name__)
                    sleep(1.2)
        finally:
            try:
                conn.quit()
            except Exception:
                pass
        out("preview: %d email(s) to %d address(es), Sig's own; the list gets nothing, nothing marked" % (sent, len(to)))
        return 0 if sent else 1

    # send: the list
    if not (base and tok and secret):
        out("LIST_URL, LIST_TOKEN and UNSUB_SECRET are required")
        return 1
    base = base.rstrip("/")
    cutoff = None
    if a.catch_up:
        now_utc = (now or datetime.now(SN.TZ)).astimezone(timezone.utc)
        if now_utc < send_time(now_utc):
            out("catch-up: this month's send on the 3rd has not run yet; nothing to catch up. Nothing sent.")
            return 0
        cutoff = send_time(now_utc).timestamp() * 1000     # the worker's ts is milliseconds
    try:
        rows = http("GET", "%s/notice-list?token=%s&topic=%s" % (base, urllib.parse.quote(tok), urllib.parse.quote(TOPIC_PRE)))
    except Exception as ex:
        out("landsales: could not read the list (%s)" % type(ex).__name__)
        return 1
    if not isinstance(rows, list):
        out("landsales: the list did not come back as a list")
        return 1
    todo = sort_list(rows, ly, lm, land, zips, tiso, repo, out, month, a.max, cutoff)
    if TALLY:
        TALLY.waiting += len(todo)      # one per reader and topic due now, each with its own data month (capped by --max)
    if not todo:
        return 0
    conn, sent, failed, broken, reconnects = None, 0, 0, False, 0
    pace = send_pace.Pacer(todo, sleep=sleep)   # batches and a pause between (scripts/send_pace.py)
    try:
        conn = connect()
        for i, (e, t, parts, lid, mo_) in enumerate(pace):
            try:
                conn.send_message(render(e, base, secret, lid, parts, from_addr))
            except Exception as ex:
                if not pace.defer(ex):       # a deferral (4xx) is tried once more at the end of the list
                    failed += 1
                    out("  send failed (%s)" % type(ex).__name__)
                dead = isinstance(ex, (smtplib.SMTPServerDisconnected, smtplib.SMTPConnectError)) or \
                    (isinstance(ex, OSError) and not isinstance(ex, smtplib.SMTPException))
                if dead and reconnects < 3 and pace.more():
                    reconnects += 1
                    try:
                        conn.quit()
                    except Exception:
                        pass
                    try:
                        conn = connect()
                    except Exception as ex2:
                        out("  could not reconnect (%s)" % type(ex2).__name__)
                        break
                continue
            sent += 1
            if not mark(http, base, tok, e, t, mo_, sleep):     # the data month mailed, not the send month
                out("::error::%s: a sent email could not be marked; stopping so nobody gets two" % TOPIC_PRE)
                broken = True
                break
            pace.after()   # the short gap, or the pause between batches
    except Exception as ex:
        out("  could not connect to SMTP (%s)" % type(ex).__name__)
    finally:
        try:
            if conn:
                conn.quit()
        except Exception:
            pass
    if TALLY:
        TALLY.sent += sent
    out("%s%s: sent %d; failed %d" % (TOPIC_PRE, month, sent, failed))   # the line morning_report.py reads
    if broken:
        return 1
    if todo and not sent:
        out("::error::nothing was sent (%d failed)" % failed)
        return 1
    if failed:
        out("::warning::%d failed; they stay unmarked and the next run tries them again" % failed)
    return 0


# ---------------------------------------------------------------- selftest
def _fixture(tmp):
    """A small Wisconsin county and a far Illinois one, rows carrying names that must never show."""
    import json
    os.makedirs(os.path.join(tmp, "data", "land", "wi"))
    os.makedirs(os.path.join(tmp, "data", "land", "il"))
    os.makedirs(os.path.join(tmp, "farmland-atlas", "wisconsin"))
    open(os.path.join(tmp, "farmland-atlas", "wisconsin", "testing-county.html"), "w").write("x")
    cols = ["doc", "date", "price", "acres", "tac", "np", "cls", "conv", "pid", "muni", "legal", "exempt", "grantor", "grantee", "ac1", "rec"]
    munis = {"0": ["Near town", 45.1013, -91.0], "1": ["Mid town", 45.2026, -91.0], "2": ["Out town", 45.3763, -91.0]}
    R = []

    def sale(i, d, rec, price, acres, muni, conv="Warranty Deed; land only", cls="4"):
        R.append(["DOC%04d" % i, d, price, acres, None, 1, cls, conv, "PIN-%04d" % i, muni, "LEGALTEXT %d SW1/4" % i, 0,
                  "SELLER JOHNSON%d" % i, "BUYER OLSON%d" % i, None, rec])
    sale(1, "2026-09-02", "2026-09-10", 400000, 80, "0")
    sale(2, "2026-08-28", "2026-09-03", 300000, 40, "1", "Warranty Deed", cls="4 1")   # buildings by class 1 (a house)
    sale(3, "2026-09-05", "2026-09-12", 900000, 150, "2")      # 26 mi
    sale(4, "2026-07-02", "2026-07-10", 200000, 40, "0")      # July
    sale(5, "2026-09-25", "2026-09-29", 210000, 35, "2")      # 26 mi, deed Sep 25, recorded Sep 29: the records reach September's last week (posted)
    f = {"state": "WI", "county": "Testing", "fips": "55999", "fetched_utc": "2026-10-03T11:00:00Z",
         "coverage": {"from": "2000-01-01", "filed_from": "2021-01-01"}, "acres_rule": 2, "cols": cols, "munis": munis, "rows": R}
    json.dump(f, open(os.path.join(tmp, "data", "land", "wi", "55999.json"), "w"))
    json.dump({"counties": [{"fips": "55999", "name": "Testing", "lat": 45.2, "lng": -91.0}]}, open(os.path.join(tmp, "data", "land", "wi", "index.json"), "w"))
    json.dump({"counties": []}, open(os.path.join(tmp, "data", "land", "il", "index.json"), "w"))
    names = [x for r in R for x in (r[0], r[8], r[10], r[12], r[13])]
    return Zips(data={"54001": (45.0, -91.0, "Testville, WI"), "54002": (45.0, -91.0), "75001": (33.0, -97.0, "Far, TX")}), names


def selftest():
    import hashlib
    import hmac
    import shutil
    import subprocess
    import tempfile
    from zoneinfo import ZoneInfo
    fails = []

    def ck(name, cond, detail=""):
        print(("ok   " if cond else "FAIL ") + name + (("  " + str(detail)[:600]) if detail and not cond else ""))
        if not cond:
            fails.append(name)

    TZ = ZoneInfo("America/Chicago")
    C = lambda s: datetime.fromisoformat(s).replace(tzinfo=TZ)
    tmp = tempfile.mkdtemp()
    zips, names = _fixture(tmp)
    ROUTE = {"FROM_ADDR": "news@agsist.com"}
    os.environ.update({"LIST_URL": "https://w.dev", "LIST_TOKEN": "tok", "UNSUB_SECRET": "sec", "MAX_PER_RUN": "300"})
    for k in ("SEND", "PREVIEW", "DRY_RUN", "LANDSALES_MONTHLY_LIVE", "SIG_TO", "SIG_TEST_EMAILS", "FROM_ADDR", "SMTP_HOST", "SMTP_USER"):
        os.environ.pop(k, None)
    land = LA.Land(tmp)
    today = "2026-10-03"
    parts, why = compose("54001", 25, 2026, 8, land, zips, today, tmp)
    m = render("a@example.com", "https://w.dev", "sec", email_links.SAMPLE_LID, parts, "news@agsist.com")
    txt, htm = m.get_body(("plain",)).get_content(), m.get_body(("html",)).get_content()
    ck("subject: radius, ZIP, month and the count", m["Subject"] == "Farm sales within 25 miles of 54001, September: 2 recorded", m["Subject"])
    ck("the sales, nearest first: date, acres, $/acre, price, where, miles",
       "Sep 10: 80 acres at $5,000 an acre ($400,000), Near town, Testing County, WI, 7 miles\n" + SITE + "/land-sales/?" + UTM
       + "\nSep 3: 40 acres at $7,500 an acre ($300,000, with buildings), Mid town, Testing County, WI, 14 miles\n" + SITE + "/land-sales/?" + UTM in txt, txt[:900])
    ck("no monthly update page in the checkout: no link to one", "land-sales/2026-09" not in txt)
    os.makedirs(os.path.join(tmp, "land-sales"), exist_ok=True)
    open(os.path.join(tmp, "land-sales", "2026-09.html"), "w").write("x")
    t2 = render("a@example.com", "https://w.dev", "sec", email_links.SAMPLE_LID, compose("54001", 25, 2026, 8, land, zips, today, tmp)[0],
                "news@agsist.com").get_body(("plain",)).get_content()
    ck("the month's update page linked once it is built", "the biggest buyers, the biggest sales, unusual prices and the best value per acre: https://agsist.com/land-sales/2026-09?" in t2, t2[-1400:])
    os.remove(os.path.join(tmp, "land-sales", "2026-09.html"))
    # Indiana (Oct 27): an Indiana ZIP gets its sales, the email says what Indiana's records carry, no names
    import json
    os.makedirs(os.path.join(tmp, "data", "land", "in"), exist_ok=True)
    icols = ["doc", "date", "price", "acres", "tac", "np", "cls", "conv", "pid", "muni", "legal", "exempt", "grantor", "grantee", "ac1"]
    json.dump({"state": "IN", "county": "Hoosier", "fips": "18999", "fetched_utc": "2026-10-03T11:00:00Z", "acres_rule": 2, "cols": icols,
               "coverage": {"from": "2021-01-01"}, "munis": {"0": ["Testtown", 40.05, -85.5]},
               "rows": [["IN-DOC-1", "2026-09-15", 1200000, 80, None, 1, "4", "Sale; land only", "PIN-IN-1", "0", "LEGALIN 1", 0,
                         "SELLER HOOSIERONE", "BUYER HOOSIERTWO", None]]},
              open(os.path.join(tmp, "data", "land", "in", "18999.json"), "w"))
    # "to": the state's newest sale on file reaches September's last week, so September is posted (land_alert.ready)
    json.dump({"counties": [{"fips": "18999", "name": "Hoosier", "lat": 40.05, "lng": -85.5, "to": "2026-09-28"}]}, open(os.path.join(tmp, "data", "land", "in", "index.json"), "w"))
    zin = Zips(data={"46001": (40.0, -85.5, "Testtown, IN")})
    pin, why_in = compose("46001", 25, 2026, 8, LA.Land(tmp), zin, today, tmp)
    tin = render("a@example.com", "https://w.dev", "sec", email_links.SAMPLE_LID, pin, "news@agsist.com").get_body(("plain",)).get_content() if pin else ""
    ck("an Indiana ZIP gets its Indiana sale", why_in == "send" and "Sep 15: 80 acres at $15,000 an acre ($1,200,000), Testtown, Hoosier County, IN" in tin, tin[:900])
    ck("the email says what Indiana's records carry", LA.IN_NOTE in tin)
    ck("no Indiana name, parcel, legal or document", not re.search(r"HOOSIERONE|HOOSIERTWO|PIN-IN|LEGALIN|IN-DOC", tin))
    ck("the Indiana source with its read date", "Indiana Department of Local Government Finance, sales disclosure forms (from STATS Indiana), farm parcels, read Oct 3, 2026" in tin)
    ck("the 26-mile sale and July's are not in it", "150 acres" not in txt and "Jul" not in txt.split("Sig\n")[0])
    ck("the HTML table has the same two rows and its headings", htm.count("<tr>") == 3 and "Recorded</th>" in htm and "Miles</th>" in htm)
    ck("no names, parcel numbers, legal descriptions or document numbers, anywhere",
       not [x for x in names if x.lower() in (txt + htm + str(m)).lower()] and not re.search(r"SELLER|BUYER|JOHNSON|OLSON|LEGALTEXT|PIN-|DOC0", txt + htm + str(m), re.I))
    ck("the middle price withheld with the reason and count (bare land only: the sale with a house is listed, not counted)", "No middle price for the area this month: only 2 sales of 20 acres or more in the last 12 months; I want 10" in txt, txt)
    ck("first person, signed Sig, plain words", "I show the acres, the price and where each one is. I never show who bought or sold." in txt and "\n\nSig\n\n" in txt)
    ck("links: Field Scout on the nearest sale's township and the county's Atlas page, tagged",
       SITE + "/field-scout?at=45.101,-91.000&fips=55999&" + UTM in txt and SITE + "/farmland-atlas/wisconsin/testing-county?" + UTM in txt, txt)
    ck("sources with the read date", "Wisconsin Department of Revenue, electronic real estate transfer returns, farm and forest classes, read Oct 3, 2026" in txt)
    ck("reply-to news@agsist.com, from Sig at AGSIST", m["Reply-To"] == "news@agsist.com" and m["From"].startswith("Sig at AGSIST"))
    stop = SN.unsub_link("https://w.dev", "sec", email_links.SAMPLE_LID, STOP_TOPIC)
    ck("standard footer: postal address, unsubscribe, List-Unsubscribe", SN.POSTAL in txt and "Unsubscribe: " + stop in txt
       and m["List-Unsubscribe"] == "<%s>, <%s>" % (email_links.STOP_MAILTO, stop), m["List-Unsubscribe"])
    low = (txt + htm).lower()
    ck("no em or en dash, no hype, no AI words", not re.search("[–—]|&mdash;|&ndash;", txt + htm) and "!" not in txt
       and not any(x in low for x in ("don't miss", "act now", "hurry", "powered by", "under the hood", "hot market", "farmers first")))
    links = email_links.hrefs(htm) + re.findall(r"https?://[^\s<>\"]+", txt)
    ck("no address in any link, no reader ZIP in any link", not [x for x in links if "@" in x or "%40" in x.lower()] and not email_links.bad_links(txt)
       and not [x for x in links if "54001" in x], [x for x in links if "54001" in x])
    q = urllib.parse.parse_qs(urllib.parse.urlsplit(stop).query)
    ck("unsubscribe link: front door, link id, topic=landsales, no ZIP, no address",
       stop.startswith(email_links.FRONT + "?a=notice-unsubscribe&k=" + email_links.SAMPLE_LID + "&") and q["topic"] == ["landsales"] and "@" not in stop)
    ck("its token is HMAC-SHA256 of the link id, first 16 hex (the UNSUB_SECRET flow)",
       q["t"] == [hmac.new(b"sec", email_links.SAMPLE_LID.encode(), hashlib.sha256).hexdigest()[:16]])
    node = shutil.which("node")
    if node:
        js = ("import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {pathToFileURL} from 'node:url';"
              "const t=path.join(os.tmpdir(),'sla-'+process.pid+'.mjs');fs.copyFileSync(process.argv[1],t);"
              "const w=(await import(pathToFileURL(t).href)).default;fs.unlinkSync(t);"
              "const store=new Map([['lid:" + email_links.SAMPLE_LID + "','a@farm.com'],['note:a@farm.com',JSON.stringify({ts:1,t:{'landsales:54728:25':{ts:1,src:'x'},'landsales:61920:50':{ts:1,src:'x'},'rent:wi':{ts:1,src:'x'}}})]]);"
              "const env={UNSUB_SECRET:'sec',SUBS:{async get(k){return store.has(k)?store.get(k):null},async put(k,v){store.set(k,v)},async delete(k){store.delete(k)},"
              "async list(){return {keys:[],list_complete:true}}}};"
              "const [ok,bad]=process.argv.slice(2);"
              "let r=await w.fetch(new Request(ok),env);const j=await r.json();console.log(j.title==='Stop the monthly land sale email for this address?'?'asks':'noask:'+j.title);"
              "r=await w.fetch(new Request(ok,{method:'POST'}),env);const k=await r.json();"
              "const n=JSON.parse(store.get('note:a@farm.com'));console.log(k.title==='Stopped. No more monthly land sale emails.'&&JSON.stringify(Object.keys(n.t))==='[\"rent:wi\"]'?'stopped-land':'wrong:'+JSON.stringify(n));"
              "r=await w.fetch(new Request(bad),env);console.log((await r.json()).ok===false?'refused':'accepted');")
        good = email_links.as_worker(stop, "https://w.dev")
        forged = email_links.as_worker(stop.replace("&t=" + q["t"][0], "&t=0000000000000000"), "https://w.dev")
        try:
            r = subprocess.run([node, "--input-type=module", "-e", js, str(REPO / "workers" / "subs-worker.js"), good, forged],
                               capture_output=True, text=True, timeout=60)
            ck("the worker asks, stops every land sale topic and nothing else, and refuses a forged token", r.stdout.split() == ["asks", "stopped-land", "refused"],
               (r.stdout + r.stderr)[-400:])
        except Exception as ex:
            ck("the worker check ran", False, ex)
    else:
        print("skip the worker check: node is not installed")

    # the reasons a reader gets nothing
    ck("an empty month sends nothing", compose("54001", 25, 2026, 7, land, zips, today, tmp)[1] == "empty")
    ck("a ZIP far from Illinois and Wisconsin: outside", compose("75001", 50, 2026, 8, land, zips, today, tmp)[1] == "outside")
    class NoTable:
        def coord(self, z):
            return False

        def town(self, z):
            return None
    ck("an unknown ZIP: bad-zip; the ZIP table not read: zip-table (the next run tries again)",
       compose("99999", 25, 2026, 8, land, zips, today, tmp)[1] == "bad-zip" and compose("54001", 25, 2026, 8, land, NoTable(), today, tmp)[1] == "zip-table")
    ck("files not fetched since the month ended: wait-data", compose("54001", 25, 2026, 9, land, zips, "2026-11-03", tmp)[1] == "wait-data")
    ck("no town for the ZIP: the ZIP alone", "within 25 miles of 54002\n" in render("a@example.com", "https://w.dev", "sec", email_links.SAMPLE_LID,
       compose("54002", 25, 2026, 8, land, zips, today, tmp)[0], "news@agsist.com").get_body(("plain",)).get_content())
    ck("the month just ended", last_month(date(2026, 10, 3)) == (2026, 8) and last_month(date(2027, 1, 3)) == (2026, 11))

    # the run, against a fake worker and a fake SMTP
    addrs = {"one@example.com": "landsales:54001:25", "two@example.com": "landsales:54001:25", "ten@example.com": "landsales:54001:10",
             "done@example.com": "landsales:54001:25", "far@example.com": "landsales:75001:50", "nolid@example.com": "landsales:54001:25",
             "bad@example.com": "landsales:54001:30"}

    class Worker:
        def __init__(self):
            self.t = {e: {"topic": tp, "mo": "2026-09" if e == "done@example.com" else None} for e, tp in addrs.items()}
            self.log, self.marks = [], []

        def __call__(self, method, url, body=None):
            u = urllib.parse.urlsplit(url)
            qs = urllib.parse.parse_qs(u.query)
            assert qs.get("token") == ["tok"]
            if method == "GET" and u.path == "/notice-list":
                self.log.append(("list", qs.get("topic", [""])[0]))
                return [dict({"email": e, "topic": v["topic"], "ts": 1, "src": "page:field-scout", "sent": None},
                             **({"mo": v["mo"]} if v["mo"] else {}), **({} if e == "nolid@example.com" else {"lid": "00000000000000%02x" % i}))
                        for i, (e, v) in enumerate(self.t.items())]
            if method == "POST" and u.path == "/notice-mark":
                self.marks.append((body["email"], body["topic"], body["month"]))
                self.t[body["email"]]["mo"] = body["month"]
                return {"ok": True}
            raise AssertionError(method + " " + u.path)

    class SMTP:
        def __init__(self, refuse=()):
            self.sent, self.refuse, self.msgs, self.opened = [], set(refuse), [], 0

        def __call__(self):
            self.opened += 1
            return self

        def send_message(self, msg):
            if msg["To"] in self.refuse:
                raise smtplib.SMTPRecipientsRefused({msg["To"]: (550, b"no")})
            self.sent.append(msg["To"])
            self.msgs.append(msg)

        def quit(self):
            pass

    def go(argv, w, s, when, env=None, r_env=True):
        lines = []
        envx = dict(ROUTE if r_env else {}, **(env or {}))
        old = {k: os.environ.get(k) for k in envx}
        os.environ.update(envx)
        try:
            rc = run(argv, http=w, connect=s, now=C(when), sleep=lambda x: None, out=lines.append, repo=tmp, zips=zips)
        finally:
            for k, v in old.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v
        return rc, "\n".join(lines)

    # THE GATE: nothing reaches the list without LANDSALES_MONTHLY_LIVE=1
    w, s = Worker(), SMTP()
    rc, log = go(["--send"], w, s, "2026-10-03 10:00")
    ck("gate: --send without LANDSALES_MONTHLY_LIVE sends nothing, reads nothing, exits 1", rc == 1 and not s.sent and not s.opened and not w.log and not w.marks
       and "LANDSALES_MONTHLY_LIVE is not 1" in log, log)
    for v in ("0", "", "true", "yes", " 1x", "2"):
        w, s = Worker(), SMTP()
        rc, log = go([], w, s, "2026-10-03 10:00", {"SEND": "1", "LANDSALES_MONTHLY_LIVE": v})
        ck("gate: SEND=1 with LANDSALES_MONTHLY_LIVE=%r sends nothing" % v, rc == 1 and not s.sent and not w.log and not w.marks, log)
    w, s = Worker(), SMTP()
    rc, log = go([], w, s, "2026-10-03 10:00", {"LANDSALES_MONTHLY_LIVE": "1"})
    ck("gate: the variable alone is not a send (dry by default)", rc == 0 and not s.sent and not w.marks and "dry run" in log, log)
    rc, log = go(["--send", "--dry-run"], w, s, "2026-10-03 10:00", {"LANDSALES_MONTHLY_LIVE": "1"})
    ck("--dry-run wins over --send", rc == 0 and not s.sent and not w.marks)
    w, s = Worker(), SMTP()
    rc, log = go(["--send", "--month", "2026-08"], w, s, "2026-10-03 10:00", {"LANDSALES_MONTHLY_LIVE": "1"})
    ck("a send is only for the month just ended", rc == 1 and not s.sent and not w.log, log)
    # the route is the Daily's (Oct 23: until Plan A); a preview goes to the owner's test inbox on it
    w, s = Worker(), SMTP()
    rc, log = go(["--sample", "54001"], w, s, "2026-10-03 10:00", {"PREVIEW": "1", "SIG_TO": "sig@example.org", "SMTP_HOST": "smtp.example.net"})
    ck("preview to Sig's test inbox on the current route (the list is not touched)", rc == 0 and s.sent == ["sig@example.org"] and not w.log, log)
    ck("dry run: counts, samples with a made-up address", "list: 6 land sale sign-up(s)" in go([], Worker(), SMTP(), "2026-10-03 10:00", r_env=False)[1]
       and "k=" + email_links.SAMPLE_LID in go(["--sample", "54001"], Worker(), SMTP(), "2026-10-03 10:00", r_env=False)[1])

    # live: the list
    w, s = Worker(), SMTP()
    rc, log = go(["--send"], w, s, "2026-10-03 10:00", {"LANDSALES_MONTHLY_LIVE": "1"})
    ck("live: each reader once; marked, outside, no link id and a bad radius skipped",
       rc == 0 and sorted(s.sent) == ["one@example.com", "ten@example.com", "two@example.com"], (rc, s.sent, log))
    ck("each reader gets their own radius", all(("within 10 miles" in x["Subject"]) == (x["To"] == "ten@example.com") for x in s.msgs)
       and "Mid town" not in [x for x in s.msgs if x["To"] == "ten@example.com"][0].get_body(("plain",)).get_content())
    ck("each email carries its own link id and the landsales stop link",
       all("k=00000000000000" in x.get_body(("plain",)).get_content() and "topic=landsales\n" in x.get_body(("plain",)).get_content() for x in s.msgs))
    ck("marked after the send, with the month", sorted(w.marks) == [("one@example.com", "landsales:54001:25", "2026-09"), ("ten@example.com", "landsales:54001:10", "2026-09"),
                                                                     ("two@example.com", "landsales:54001:25", "2026-09")], w.marks)
    ck("the log: counts and reasons, no address and no ZIP", not any(e in log for e in addrs) and "54001" not in log and "75001" not in log and "outside 1" in log, log)
    ck("no names in any sent email", not any(re.search(r"SELLER|BUYER|JOHNSON|OLSON|LEGALTEXT|PIN-|DOC0", str(x), re.I) for x in s.msgs))
    s2 = SMTP()
    rc, log = go(["--send"], w, s2, "2026-10-04 10:00", {"LANDSALES_MONTHLY_LIVE": "1"})
    ck("a second run that month mails nobody", rc == 0 and not s2.sent, s2.sent)
    # an empty month: nobody mailed, nobody marked
    w, s = Worker(), SMTP()
    rc, log = go(["--send"], w, s, "2026-09-03 10:00", {"LANDSALES_MONTHLY_LIVE": "1"})
    ck("an empty month (nothing recorded in August) mails nobody and marks nobody",
       rc == 0 and not s.sent and not s.opened and not w.marks and "empty 3" in log, log)
    w, s = Worker(), SMTP(refuse={"one@example.com"})
    rc, log = go(["--send"], w, s, "2026-10-03 10:00", {"LANDSALES_MONTHLY_LIVE": "1"})
    ck("a refused address stays unmarked and the others go", rc == 0 and ("one@example.com", "landsales:54001:25", "2026-09") not in w.marks and len(w.marks) == 2, w.marks)
    w, s = Worker(), SMTP(refuse=set(addrs))
    rc, log = go(["--send"], w, s, "2026-10-03 10:00", {"LANDSALES_MONTHLY_LIVE": "1"})
    ck("all refused: exit 1, nothing marked", rc == 1 and not w.marks, log)
    w, s = Worker(), SMTP()
    rc, log = go(["--send", "--max", "1"], w, s, "2026-10-03 10:00", {"LANDSALES_MONTHLY_LIVE": "1"})
    ck("--max caps a run", rc == 0 and len(s.sent) == 1 and "2 left for the next run" in log, log)

    # preview: the owner's test inbox only
    w, s = Worker(), SMTP()
    rc, log = go(["--sample", "54001:25,54001:10"], w, s, "2026-10-03 10:00", {"PREVIEW": "1", "SIG_TO": "sig@example.org"})
    ck("preview: Sig only, each sample, [Preview] subject, list untouched", rc == 0 and s.sent == ["sig@example.org", "sig@example.org"]
       and all(x["Subject"].startswith("[Preview] ") for x in s.msgs) and not w.log and not w.marks and "sig@example.org" not in log, (rc, s.sent, w.log, log))
    w, s = Worker(), SMTP()
    rc, log = go(["--sample", "54001"], w, s, "2026-10-03 10:00", {"PREVIEW": "1", "SIG_TEST_EMAILS": "a@example.org, b@example.org", "SIG_TO": "sig@example.org"})
    ck("preview: SIG_TEST_EMAILS before SIG_TO", sorted(set(s.sent)) == ["a@example.org", "b@example.org"])
    w, s = Worker(), SMTP()
    rc, log = go(["--sample", "54001"], w, s, "2026-10-03 10:00", {"PREVIEW": "1"})
    ck("preview with nobody to send to: refused, the list never stands in", rc == 1 and not s.sent and not w.log, log)
    outd = os.path.join(tmp, "out")
    rc, log = go(["--out", outd, "--month", "2026-09", "--sample", "54001:25"], Worker(), SMTP(), "2026-10-23 09:00", {"SEND": "1", "LANDSALES_MONTHLY_LIVE": "1"})
    ck("--out writes the samples and never sends", rc == 0 and os.path.isfile(os.path.join(outd, "land-sales-54001-25mi-2026-09.html")), log)
    # a state file without the recorded date (Illinois before the Oct 23 fetch change): listed by deed date, and said once
    import json
    fp = os.path.join(tmp, "data", "land", "wi", "55999.json")
    f = json.load(open(fp))
    f["cols"], f["rows"] = f["cols"][:-1], [x[:-1] for x in f["rows"]]
    json.dump(f, open(fp, "w"))
    pd, _ = compose("54001", 25, 2026, 8, LA.Land(tmp), zips, today, tmp)
    md = render("a@example.com", "https://w.dev", "sec", email_links.SAMPLE_LID, pd, "news@agsist.com")
    td, hd = md.get_body(("plain",)).get_content(), md.get_body(("html",)).get_content()
    ck("no recorded date in the file: listed by deed date, said once, the table headed Deed date",
       "Wisconsin sales are listed by the date on the deed for now" in td and "Sep 2: 80 acres" in td and "(deed date)" not in td
       and "Deed date</th>" in hd and "Recorded</th>" not in hd, td[:700])
    shutil.rmtree(tmp, ignore_errors=True)
    lag_selftest(ck, C)
    print("\n%s: %d failure(s)" % ("FAIL" if fails else "OK", len(fails)))
    return 1 if fails else 0


def lag_selftest(ck, C):
    """The Nov 3, 2026 case (the owner's option 1), from fixture files and made-up readers: Wisconsin had posted
    its transfer returns through September (fetched Oct 18, read again Nov 3 with nothing newer),
    Illinois had October. No date here comes from the clock."""
    import json
    import shutil
    import tempfile
    tmp = tempfile.mkdtemp()
    cols = ["doc", "date", "price", "acres", "tac", "np", "cls", "conv", "pid", "muni", "legal", "exempt", "grantor", "grantee", "ac1", "rec"]

    def county(st, fips, name, ll, rows, fetched, extra_ix=None, north=None):
        d = os.path.join(tmp, "data", "land", st.lower())
        os.makedirs(d, exist_ok=True)
        R = [["%s-DOC-%d" % (st, i), dt, pr, ac, None, 1, "4", "Warranty Deed; land only", "%s-PIN-%d" % (st, i), "0", "LEGAL %s %d" % (st, i), 0,
              "SELLER %sNAME%d" % (st, i), "BUYER %sNAME%d" % (st, i), None, rec] for i, (dt, rec, pr, ac, *mu) in enumerate(rows)]
        for r, row_ in zip(R, rows):
            r[9] = row_[4] if len(row_) > 4 else "0"
        munis = {"0": [name + " town", ll[0], ll[1]]}
        if north:
            munis["1"] = ["North town", north[0], north[1]]
        json.dump({"state": st, "county": name, "fips": fips, "fetched_utc": fetched, "coverage": {"from": "2021-01-01", "filed_from": "2021-01-01"},
                   "acres_rule": 2, "cols": cols, "munis": munis, "rows": R}, open(os.path.join(d, fips + ".json"), "w"))
        ix = dict({"state": st, "fetched_utc": fetched, "counties": [{"fips": fips, "name": name, "lat": ll[0], "lng": ll[1],
                                                                     "to": max(r[0] for r in rows)}]}, **(extra_ix or {}))
        json.dump(ix, open(os.path.join(d, "index.json"), "w"))
    wi_months = ["2026%02d" % m for m in range(1, 10)]
    wi_rows = [("2026-09-02", "2026-09-10", 400000, 80), ("2026-08-20", "2026-09-22", 240000, 40), ("2026-08-03", "2026-08-12", 300000, 60),
               ("2026-07-03", "2026-08-14", 320000, 60, "1")]      # North town: August only
    county("WI", "55119", "Taylor", (45.15, -90.35), wi_rows, "2026-10-18T22:50:52Z", {"months": wi_months}, north=(45.60, -90.30))
    county("IL", "17029", "Coles", (39.50, -88.20), [("2026-10-01", "2026-10-14", 1500000, 100), ("2026-09-10", "2026-09-20", 700000, 50)],
           "2026-11-03T20:08:48Z")
    json.dump({"IL": {"checked_utc": "2026-11-03T20:08:48Z", "newest": "2026-10-30"}, "WI": {"checked_utc": "2026-11-03T20:30:00Z", "newest": "2026-09-30"}},
              open(os.path.join(tmp, "data", "land", "checked.json"), "w"))
    zips = Zips(data={"54451": (45.14, -90.34, "Medford, WI"), "61920": (39.49, -88.18, "Charleston, IL"), "54999": (45.60, -90.34, "Nowhere, WI")})
    land = LA.Land(tmp)

    # ready(): Wisconsin by its monthly reports on file, the others by a read after the month and records that reach it
    wf, lf = land.file("WI", "55119"), land.file("IL", "17029")
    ck("ready: Wisconsin September is posted, October is not (its reports run through September)",
       LA.ready(land, "WI", wf, 2026, 8) and not LA.ready(land, "WI", wf, 2026, 9))
    ck("ready: Illinois October, read Nov 3 with records into October", LA.ready(land, "IL", lf, 2026, 9))
    ck("fetched is not checked: the stamp says the state was read Nov 3", land.seen("WI", wf) == "2026-11-03" and land.seen("IL", lf) == "2026-11-03")

    # the samples the owner previews: what a reader gets now
    p1, why1, ym1 = due("54451", 10, "", 2026, 9, land, zips, "2026-11-03", tmp)
    m1 = render("a@example.com", "https://w.dev", "sec", email_links.SAMPLE_LID, p1, "news@agsist.com") if p1 else None
    t1 = m1.get_body(("plain",)).get_content() if m1 else ""
    ck("Wisconsin reader on Nov 3: September, said plainly in the subject", ym1 == (2026, 8) and m1 and m1["Subject"] == "Farm sales within 10 miles of 54451, September: 2 recorded",
       (why1, ym1, m1 and m1["Subject"]))
    ck("the first line says why: September is the newest month Wisconsin has posted, October follows",
       t1.split("\n\n")[1:2] == ["September is the newest month Wisconsin has published; October follows when the state posts it."], t1[:400])
    ck("the September email lists September's recordings only", "Sep 10: 80 acres" in t1 and "Sep 22: 40 acres" in t1 and "Aug 12" not in t1.split("Sig\n")[0], t1[:900])
    ck("no names, parcels, legals or documents in it", not re.search(r"NAME\d|PIN-|LEGAL WI|DOC-", t1 + str(m1)))
    ck("no em dash in the line", not re.search("[\u2013\u2014]", t1))
    ck("Illinois reader on Nov 3: October, no line", due("61920", 25, "", 2026, 9, land, zips, "2026-11-03", tmp)[2] == (2026, 9)
       and "newest month" not in render("a@example.com", "https://w.dev", "sec", email_links.SAMPLE_LID,
                                         due("61920", 25, "", 2026, 9, land, zips, "2026-11-03", tmp)[0], "news@agsist.com").get_body(("plain",)).get_content())
    ck("a reader already mailed September waits for October", due("54451", 10, "2026-09", 2026, 9, land, zips, "2026-11-03", tmp)[1] == "wait-data")
    ck("a Wisconsin reader with no sale in September near: nothing (an empty month sends nothing)",
       due("54999", 10, "", 2026, 9, land, zips, "2026-11-03", tmp)[:2] == (None, "wait-data"))
    ck("never older than the month before: on Dec 3, with Wisconsin still at September, nothing",
       due("54451", 10, "", 2026, 10, land, zips, "2026-12-03", tmp)[:2] == (None, "wait-data"))
    ck("the lag line for two states", lag_line(8, ["WI", "IN"]) == "September is the newest month Wisconsin and Indiana have published; October follows when the states post it.")

    # the runs: a fake worker and a fake SMTP; made-up readers
    class Worker:
        def __init__(self, rows):
            self.t, self.marks = rows, []

        def __call__(self, method, url, body=None):
            u = urllib.parse.urlsplit(url)
            if method == "GET" and u.path == "/notice-list":
                return [dict({"email": e, "topic": v["topic"], "ts": v["ts"], "src": "x", "lid": "00000000000000%02x" % i}, **({"mo": v["mo"]} if v.get("mo") else {}))
                        for i, (e, v) in enumerate(self.t.items())]
            if method == "POST" and u.path == "/notice-mark":
                self.marks.append((body["email"], body["month"]))
                cur = self.t[body["email"]]
                cur["mo"] = max(cur.get("mo") or "", body["month"])
                return {"ok": True}
            raise AssertionError(method + " " + u.path)

    class SMTP:
        def __init__(self):
            self.msgs = []

        def __call__(self):
            return self

        def send_message(self, msg):
            self.msgs.append(msg)

        def quit(self):
            pass
    oct20 = C("2026-10-20 12:00").timestamp() * 1000
    w = Worker({"wi@example.com": {"topic": "landsales:54451:10", "ts": oct20}, "il@example.com": {"topic": "landsales:61920:25", "ts": oct20},
                "none@example.com": {"topic": "landsales:54999:10", "ts": oct20}})
    env = {"LIST_URL": "https://w.dev", "LIST_TOKEN": "tok", "UNSUB_SECRET": "sec", "FROM_ADDR": "news@agsist.com", "LANDSALES_MONTHLY_LIVE": "1"}

    def go(argv, when, smtp, worker=None):
        lines, old = [], {k: os.environ.get(k) for k in env}
        os.environ.update(env)
        try:
            rc = run(argv, http=worker or w, connect=smtp, now=C(when), sleep=lambda x: None, out=lines.append, repo=tmp, zips=zips)
        finally:
            for k, v in old.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v
        return rc, "\n".join(lines)
    s1 = SMTP()
    rc, log = go(["--send"], "2026-11-03 10:47", s1)
    sent = sorted((x["To"], x["Subject"]) for x in s1.msgs)
    ck("Nov 3 send: Wisconsin reader September, Illinois reader October, the empty one nothing",
       rc == 0 and sent == [("il@example.com", "Farm sales within 25 miles of 61920, October: 1 recorded"),
                            ("wi@example.com", "Farm sales within 10 miles of 54451, September: 2 recorded")], (rc, sent, log))
    ck("marked with the data month mailed, not the send month", sorted(w.marks) == [("il@example.com", "2026-10"), ("wi@example.com", "2026-09")], w.marks)
    ck("the log: counts by data month and by state waiting, no address, no ZIP",
       "by data month: 2026-10 1, 2026-09 (WI not posted) 1" in log and "waiting on the state to post 2026-10: WI 1" in log
       and not re.search(r"@|54451|61920|54999", log), log)
    wd = Worker({k: dict(v, mo=None) for k, v in w.t.items()})
    sd = SMTP()
    env_live = env.pop("LANDSALES_MONTHLY_LIVE")
    rc, log = go([], "2026-11-03 10:47", sd, wd)
    env["LANDSALES_MONTHLY_LIVE"] = env_live
    ck("a dry run counts what the list would get now, by data month and state, and mails and marks nothing",
       rc == 0 and not sd.msgs and not wd.marks and "dry: landsales:2026-10: 2 to mail" in log and "dry: landsales:2026-10: by data month: 2026-10 1, 2026-09 (WI not posted) 1" in log
       and not re.search(r"@|54451|61920|54999", "\n".join(x for x in log.split("\n") if x.startswith("dry: "))), log[-600:])   # the samples print their own ZIP
    # preview (no month asked) chooses the month a send chooses, and says why
    sp = SMTP()
    env_live = env.pop("LANDSALES_MONTHLY_LIVE")
    env.update(PREVIEW="1", SIG_TO="sig@example.org")
    rc, log = go(["--sample", "54451:10,61920:25,54999:10"], "2026-11-03 10:47", sp, Worker({}))
    for k in ("PREVIEW", "SIG_TO"):
        env.pop(k)
    env["LANDSALES_MONTHLY_LIVE"] = env_live
    ck("preview with no month picks each sample's month exactly as the send did, and says why",
       rc == 0 and [x["Subject"][len("[Preview] "):] for x in sp.msgs] == [m["Subject"] for m in sorted(s1.msgs, key=lambda x: x["To"], reverse=True)]
       and "sample 1: WI not posted Oct 2026; Sep 2026 posted, 2 sales" in log and "sample 2: Oct 2026 posted, 1 sale" in log
       and "sample 3: no email: WI not posted Oct 2026; Sep 2026 has no sales" in log, (log, [x["Subject"] for x in sp.msgs]))
    sq = SMTP()
    env_live = env.pop("LANDSALES_MONTHLY_LIVE")
    env.update(PREVIEW="1", SIG_TO="sig@example.org")
    rc, log = go(["--sample", "54451:10", "--month", "2026-10"], "2026-11-03 10:47", sq, Worker({}))
    for k in ("PREVIEW", "SIG_TO"):
        env.pop(k)
    env["LANDSALES_MONTHLY_LIVE"] = env_live
    ck("preview with a month asked still forces that month", "sample 1: 2026-10 (asked for); no email (empty)" in log and not sq.msgs, log)
    s2 = SMTP()
    rc, log = go(["--send"], "2026-11-04 10:47", s2)
    ck("a second run mails nobody", rc == 0 and not s2.msgs and "0 to mail, 1 already mailed for it" in log, log)
    s3 = SMTP()
    rc, log = go(["--catch-up"], "2026-11-03 09:00", s3)
    ck("catch-up before this month's send time does nothing", rc == 0 and not s3.msgs and "has not run yet" in log, log)

    # Wisconsin posts October (a land run on the 19th commits it); the run after it mails October once
    wi_rows2 = wi_rows + [("2026-10-01", "2026-10-09", 500000, 100)]
    county("WI", "55119", "Taylor", (45.15, -90.35), wi_rows2, "2026-11-19T18:00:00Z", {"months": wi_months + ["202610"]}, north=(45.60, -90.30))
    json.dump({"IL": {"checked_utc": "2026-11-03T20:08:48Z", "newest": "2026-10-30"}, "WI": {"checked_utc": "2026-11-19T18:00:00Z", "newest": "2026-10-31"}},
              open(os.path.join(tmp, "data", "land", "checked.json"), "w"))
    w.t["late@example.com"] = {"topic": "landsales:54451:10", "ts": C("2026-11-10 12:00").timestamp() * 1000}
    s4 = SMTP()
    rc, log = go(["--catch-up"], "2026-11-19 13:30", s4)
    got = [(x["To"], x["Subject"]) for x in s4.msgs]
    t4 = s4.msgs[0].get_body(("plain",)).get_content() if s4.msgs else ""
    ck("after Wisconsin's October lands: the same reader gets October, once, without the line",
       rc == 0 and got == [("wi@example.com", "Farm sales within 10 miles of 54451, October: 1 recorded")] and "newest month" not in t4, (got, log))
    ck("catch-up leaves a reader who signed up after the 3rd for the next 3rd", "1 signed up after this month's send" in log, log)
    ck("marked October", w.marks[-1] == ("wi@example.com", "2026-10") and w.t["wi@example.com"]["mo"] == "2026-10", w.marks)
    s5 = SMTP()
    rc, log = go(["--catch-up"], "2026-11-19 13:45", s5)
    ck("and the next catch-up mails nobody", rc == 0 and not s5.msgs, log)

    # every sale links to its own row on the county sale page (Nov 3): build the pages from these files
    # the way land-data does, then check each sale line's one link against the built page
    import build_land_sales as BS
    from pathlib import Path as _P
    os.makedirs(os.path.join(tmp, "data", "land-sales"), exist_ok=True)
    open(os.path.join(tmp, "grain-emc.html"), "w").write("<script>/* agsist-theme-early */</script><script>/* agsist-ga-guard */</script>")
    json.dump({"labels": {"live": "Sales on this site"}, "note": "", "states": [{"st": "IL", "name": "Illinois", "status": "live"},
                                                                                 {"st": "WI", "name": "Wisconsin", "status": "live"}]},
              open(os.path.join(tmp, "data", "land-sales", "coverage.json"), "w"))
    texts = BS.build(_P(tmp))
    for pth, t in texts.items():
        os.makedirs(os.path.dirname(os.path.join(tmp, pth)), exist_ok=True)
        open(os.path.join(tmp, pth), "w", encoding="utf-8").write(t)
    land2 = LA.Land(tmp)
    ok_lines, ok_anchor, ok_names, n_rows = True, True, True, 0
    for z, mi, ym in (("54451", 10, (2026, 9)), ("61920", 25, (2026, 9))):
        pz, _ = compose(z, mi, ym[0], ym[1], land2, zips, "2026-11-19", tmp)
        mz = render("a@example.com", "https://w.dev", "sec", email_links.SAMPLE_LID, pz, "news@agsist.com")
        hz, tz = mz.get_body(("html",)).get_content(), mz.get_body(("plain",)).get_content()
        rows_h = re.findall(r"<tbody>(.*)</tbody>", hz, re.S)[0].split("</tr>")[:-1]
        n_rows += len(rows_h)
        for rh in rows_h:
            links = email_links.hrefs(rh)
            ok_lines &= len(links) == 1
            m = re.fullmatch(re.escape(SITE) + r"/land-sales/([a-z-]+)/([a-z0-9-]+)\?" + re.escape(UTM) + r"#(s-[0-9a-f]{10})", links[0]) if links else None
            ok_anchor &= bool(m) and ('<tr id="%s"' % m.group(3)) in texts.get("land-sales/%s/%s.html" % (m.group(1), m.group(2)), "")
            ok_names &= not re.search(r"NAME|PIN|LEGAL|DOC", links[0] if links else "")
        tl = tz.split("\n")
        ok_lines &= all(tl[i + 1].startswith(SITE + "/land-sales/") and "#s-" in tl[i + 1] for i, x in enumerate(tl) if re.match(r"[A-Z][a-z]{2} \d+: ", x))
        email_links.check_message(mz)
    ck("every sale in the email has exactly one link, in the HTML row and under the line in the text", n_rows >= 2 and ok_lines)
    ck("each link opens its sale's own row on the built county page (#s-<id>)", ok_anchor)
    ck("no name, parcel, legal or document in any sale link", ok_names)
    shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    if "--selftest" in sys.argv[1:]:
        sys.exit(selftest())
    TALLY = delivery_line.start("land-alert")
    sys.exit(run(sys.argv[1:]))
