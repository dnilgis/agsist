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

THE NUMBERS come from scripts/land_alert.py (the shared market-sale rule, sales placed at their
township or town, the middle price only past its gates). No buyer or seller name, parcel number,
legal description or document number is in any email: land_alert.row() is the only shape a sale
reaches this file in, and the selftest feeds named rows and checks the output.

MODES (the same three as send_rain_month.py):
  dry      the default. Counts the list and renders samples (a made-up address and link id)
           into the log. Sends nothing.
  preview  Sig's test inbox only (SIG_TEST_EMAILS, else SIG_TO), one email per sample
           (--sample, default Chetek 54728 at 25 mi and Charleston, IL 61920 at 25 mi), with
           "[Preview]" in the subject. BUILD-RULES 13: this is the copy that goes through the spam
           and link checkers before the list gets anything. The list is never read for addresses.
  send     the list. Refused unless LANDSALES_MONTHLY_LIVE=1 (Sig turns it on; the workflow
           passes the repo variable) and the month is the one just ended.

THE SENDING ROUTE: the same SMTP_* and FROM_ADDR secrets as the Daily. BUILD-RULES 12 (no site
email through Sig's own Google account) is the target; until Plan A sending is migrated, Sig's
Oct 23 decision is that new list emails go the way the Daily does now. Plan A is a swap of those
secrets; nothing in this file changes then.

    python3 scripts/send_land_alert.py                                  # dry run
    PREVIEW=1 python3 scripts/send_land_alert.py                        # Sig's test inbox only
    SEND=1 LANDSALES_MONTHLY_LIVE=1 python3 scripts/send_land_alert.py
    python3 scripts/send_land_alert.py --month 2026-09 --out <dir>       # sample renders, send nothing
    python3 scripts/send_land_alert.py --selftest                       # fake HTTP and SMTP; no network

Env: LIST_URL, LIST_TOKEN, UNSUB_SECRET, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, FROM_ADDR,
LANDSALES_MONTHLY_LIVE, SIG_TEST_EMAILS / SIG_TO (preview), BIDS_BASE (the ZIP table; default the
bids site), MAX_PER_RUN (default 300).

The log carries counts only: no address and no reader's ZIP is ever printed, error lines included.
Reply-To is news@agsist.com. The stop link carries no ZIP (BUILD-RULES 10): topic=landsales stops
every land sale email of that address and nothing else.
"""
import argparse
import html as H
import os
import re
import smtplib
import sys
import time
import urllib.parse
from datetime import date, datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
sys.path.insert(0, str(HERE))
import email_links                 # noqa: E402  link ids, the front door, check_message
import log_safe                    # noqa: E402  sender_addr
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


def sale_line(r, mark=True):
    """One sale in words: date, acres, $/acre, price, where, how far. Nothing else.
    mark: say "(deed date)" on a row listed by its deed date (an email that mixes the two)."""
    when = LA.short_day(r["when"]) + (" (deed date)" if mark and r["basis"] == "sale date" else "")
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


def compose(zip5, radius, year, m0, land, zips, today, repo, need_fresh=True):
    """(subject, preheader, blocks) for one ZIP and radius, or (None, why).
    why: bad-zip, zip-table (the ZIP table could not be read), outside, wait-data, empty."""
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
    blocks = [("h1", "Farm sales recorded in %s %d within %d miles of %s" % (mon, year, radius, here)),
              ("p", "Here are the farm sales recorded in %s within %d miles of your ZIP, nearest first, from the state transfer records. "
                    "I show the acres, the price and where each one is. I never show who bought or sold." % (mon, radius))]
    by_sale = sorted({r["st"] for r in rep["rows"] if r["basis"] == "sale date"})
    if by_sale:
        blocks.append(("p", "%s sales are listed by the date on the deed for now: my copy of the state's file does not carry the recording date yet."
                       % " and ".join(LA.STATE_NAMES[s] for s in by_sale)))
    blocks.append(("sales", rep["rows"]))
    extra = []
    if rep["more"]:
        extra.append("%d more %s within %d miles" % (rep["more"], "sale" if rep["more"] == 1 else "sales", radius))
    if rep["small"]:
        extra.append("%d under %d acres" % (rep["small"], LA.LIST_MIN_ACRES))
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
            head = "Recorded" if all(r["basis"] == "recorded" for r in v) else ("Date" if mixed else "Deed date")
            TD = '<td style="padding:6px 8px 6px 0;border-top:1px solid #e6dfd0;vertical-align:top;font-size:14px%s">%s</td>'
            TH = '<th scope="col" style="text-align:%s;padding:0 8px 4px 0;font-size:12px;color:#6b6b6b;font-weight:normal">%s</th>'
            h = ['<table role="presentation" style="border-collapse:collapse;width:100%;margin:0 0 14px"><thead><tr>'
                 + "".join(TH % (al, x) for al, x in (("left", head), ("right", "Acres"), ("right", "$/acre"), ("right", "Price"),
                                                      ("left", "Where"), ("right", "Miles"))) + "</tr></thead><tbody>"]
            for r in v:
                when = LA.short_day(r["when"]) + (" (deed date)" if mixed and r["basis"] == "sale date" else "")
                where = (r["place"] + ", " if r.get("place") else "") + "%s Co., %s" % (r["county"], r["st"]) + (", with buildings" if r.get("bldg") else "")
                NW = ";white-space:nowrap"
                h.append("<tr>" + TD % (NW, e(when)) + TD % (NW + ";text-align:right", e(LA.acres_text(r["acres"])))
                         + TD % (NW + ";text-align:right", e(LA.money(r["ppa"]) if r.get("ppa") is not None else "n/a"))
                         + TD % (NW + ";text-align:right", e(LA.money(r["price"]))) + TD % ("", e(where))
                         + TD % (";text-align:right", "%d" % LA.BLS.js_round(r["mi"])) + "</tr>")
            htm.append("".join(h) + "</tbody></table>")
            txt.append("\n".join(sale_line(r, mixed) for r in v))
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


# ---------------------------------------------------------------- the run
def last_month(today):
    """(year, 0-based month) of the month just ended."""
    return (today.year - 1, 11) if today.month == 1 else (today.year, today.month - 2)


def mode_of(argv):
    """dry (default), preview or send. DRY_RUN=1 wins; the list only on SEND=1 / --send."""
    if SN.env("DRY_RUN", "") == "1" or "--dry-run" in argv:
        return "dry"
    if SN.env("PREVIEW", "") == "1" or "--preview" in argv:
        return "preview"
    if SN.env("SEND", "") == "1" or "--send" in argv:
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
    for a in ("--send", "--preview", "--dry-run"):
        p.add_argument(a, action="store_true")
    p.add_argument("--month", default="")
    p.add_argument("--sample", default="")
    p.add_argument("--out", default="")
    p.add_argument("--max", type=int, default=int(SN.env("MAX_PER_RUN", "300")))
    a = p.parse_args(argv)
    mode = mode_of(argv)
    if a.out:
        mode = "dry"           # writing sample files never sends
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
        for z, mi in samples_of(a.sample) or list(SAMPLES):
            # a past month is drawn from the files on hand; the freshness wait is for the list
            parts, why = compose(z, mi, year, m0, land, zips, tiso, repo, need_fresh=False)
            if not parts:
                out("sample %d: no email (%s)" % (len(made) + 1, why))
                continue
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
    try:
        rows = http("GET", "%s/notice-list?token=%s&topic=%s" % (base, urllib.parse.quote(tok), urllib.parse.quote(TOPIC_PRE)))
    except Exception as ex:
        out("landsales: could not read the list (%s)" % type(ex).__name__)
        return 1
    if not isinstance(rows, list):
        out("landsales: the list did not come back as a list")
        return 1
    todo, seen, skipped, done, wait, cache = [], set(), 0, 0, {}, {}
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
        if str(r.get("mo") or "") >= month:
            done += 1
            continue
        k = (mt.group(1), int(mt.group(2)))
        if k not in cache:
            cache[k] = compose(k[0], k[1], year, m0, land, zips, tiso, repo)
        parts, why = cache[k]
        if not parts:
            wait[why] = wait.get(why, 0) + 1
            continue
        todo.append((e, t, k, lid))
    later = max(0, len(todo) - a.max)
    todo = todo[:a.max]
    out("%s%s: %d to mail, %d already mailed for it, %d not mailed (%s), %d skipped, %d left for the next run"
        % (TOPIC_PRE, month, len(todo), done, sum(wait.values()), ", ".join("%s %d" % kv for kv in sorted(wait.items())) or "none",
           skipped, later))
    if not todo:
        return 0
    conn, sent, failed, broken, reconnects = None, 0, 0, False, 0
    try:
        conn = connect()
        for i, (e, t, k, lid) in enumerate(todo):
            try:
                conn.send_message(render(e, base, secret, lid, cache[k][0], from_addr))
            except Exception as ex:
                failed += 1
                out("  send failed (%s)" % type(ex).__name__)
                dead = isinstance(ex, (smtplib.SMTPServerDisconnected, smtplib.SMTPConnectError)) or \
                    (isinstance(ex, OSError) and not isinstance(ex, smtplib.SMTPException))
                if dead and reconnects < 3 and i < len(todo) - 1:
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
            if not mark(http, base, tok, e, t, month, sleep):
                out("::error::%s: a sent email could not be marked; stopping so nobody gets two" % TOPIC_PRE)
                broken = True
                break
            if i < len(todo) - 1:
                sleep(1.2)
    except Exception as ex:
        out("  could not connect to SMTP (%s)" % type(ex).__name__)
    finally:
        try:
            if conn:
                conn.quit()
        except Exception:
            pass
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

    def sale(i, d, rec, price, acres, muni, conv="Warranty Deed; land only"):
        R.append(["DOC%04d" % i, d, price, acres, None, 1, "4", conv, "PIN-%04d" % i, muni, "LEGALTEXT %d SW1/4" % i, 0,
                  "SELLER JOHNSON%d" % i, "BUYER OLSON%d" % i, None, rec])
    sale(1, "2026-09-02", "2026-09-10", 400000, 80, "0")
    sale(2, "2026-08-28", "2026-09-03", 300000, 40, "1", "Warranty Deed; with buildings")
    sale(3, "2026-09-05", "2026-09-12", 900000, 150, "2")      # 26 mi
    sale(4, "2026-07-02", "2026-07-10", 200000, 40, "0")      # July
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
       "Sep 10: 80 acres at $5,000 an acre ($400,000), Near town, Testing County, WI, 7 miles\nSep 3: 40 acres at $7,500 an acre ($300,000, with buildings), Mid town, Testing County, WI, 14 miles" in txt, txt[:900])
    ck("the 26-mile sale and July's are not in it", "150 acres" not in txt and "Jul" not in txt.split("Sig\n")[0])
    ck("the HTML table has the same two rows and its headings", htm.count("<tr>") == 3 and "Recorded</th>" in htm and "Miles</th>" in htm)
    ck("no names, parcel numbers, legal descriptions or document numbers, anywhere",
       not [x for x in names if x.lower() in (txt + htm + str(m)).lower()] and not re.search(r"SELLER|BUYER|JOHNSON|OLSON|LEGALTEXT|PIN-|DOC0", txt + htm + str(m), re.I))
    ck("the middle price withheld with the reason and count (2 sales)", "No middle price for the area this month: only 3 sales of 20 acres or more in the last 12 months; I want 10" in txt, txt)
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
    # the route is the Daily's (Sig, Oct 23: until Plan A); a preview goes to Sig's test inbox on it
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

    # preview: Sig's test inbox only
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
    print("\n%s: %d failure(s)" % ("FAIL" if fails else "OK", len(fails)))
    return 1 if fails else 0


if __name__ == "__main__":
    if "--selftest" in sys.argv[1:]:
        sys.exit(selftest())
    sys.exit(run(sys.argv[1:]))
