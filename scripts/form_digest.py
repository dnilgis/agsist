#!/usr/bin/env python3
"""
Site forms digest (2026-10-11): emails Sig what came in through the site's
own forms (the first three used to go to Formspree).

  elevators.html      claim your board               kind claim
  sponsor-report.html approval and requests box      kind sponsor-feedback
  farmland-atlas.html Parcel Report waitlist         kind atlas-feedback
  rain-print.html     Rain Print order request       kind rain-print-order (worker v5.9;
                                                     gift orders, v5.10)
  rain-print.html     For businesses quote request   kind rain-print-business (worker v5.12)
  list-your-elevator  an elevator asks to post bids  kind elevator-listing (worker v5.21)
  prf-sponsor         a business asks about PRF      kind prf-sponsor (worker v5.22)
                      state sponsor slots

A gift order (this year's print, ordered before the year is over) says so in
the subject, "Rain print order (2026 gift, January): ...", and its body tells
Sig to make it after January 1, once the full year is in. An
ordinary order given as a gift (gift:true, worker v5.12) says "(gift)" instead,
and both list who it is for, where it goes and the note for the card. A
business quote shipped to each customer lists its note for every print.

A digital file order (2026-10-14, Sig) gets a Next line: there is no proof
step for the file. Sig emails the finished file within 1 business day after
payment (a January gift: in January), and redoes it free if they ask.

The pages post to the subs worker (POST /form, workers/subs-worker.js v5.8),
which stores each post in KV under form:<kind>:<ms>:<rand>. This job reads the
ones not yet mailed (GET /form-list?new=1), sends Sig ONE email listing them,
then marks them mailed (POST /form-mark). Mark after send: a failed send leaves
them unmarked and the next run tries again. Nothing is written to the repo.

Every digest opens with one counts line (2026-10-14, Sig): what came in over
the last 24 hours by kind, mailed or not, e.g. "Last 24 hours: 2 Rain Print
order requests, 0 gift card redemptions, ... 5 rain gauge waitlist, ...". It
reads the whole stored list (GET /form-list, no new=1) and the rain gauge
waiting list (GET /notice-list?topic=rain-gauge) and counts rows by their ts.
If either read fails the line says the counts could not be read and the
digest still goes. scripts/morning_report.py uses the same counter.

The hay board (worker v5.30, agsist.com/haymow) rides the same run: new
posts, and posts held by the screen or hidden by three reports, go to Sig in
one more email (public text only, never the poster's phone or email), then
POST /hay/admin/mark. The hay admin routes take the token as a Bearer header.

The Actions log gets counts only, never a name, address or phone.

    python3 scripts/form_digest.py              (needs LIST_URL, LIST_TOKEN, SMTP_USER, SMTP_PASS)
    python3 scripts/form_digest.py --selftest   offline checks, no network, no mail
    DRY_RUN=1 ...                                print the counts, send and mark nothing

Optional: SMTP_HOST, SMTP_PORT, FROM_ADDR, FROM_NAME, FORMS_TO (else
SPONSOR_TO, else sig@farmers1st.com).
"""
import html as H
import json
import os
import re
import smtplib
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from email.message import EmailMessage
from email.utils import formataddr, make_msgid

try:
    from zoneinfo import ZoneInfo
    CT = ZoneInfo("America/Chicago")
except Exception:                                          # noqa: BLE001
    CT = None

ADDRESS = "AGSIST, PO Box 243, Chetek, WI 54728"
KINDS = ("claim", "sponsor-feedback", "atlas-feedback", "rain-print-order", "rain-print-business", "elevator-listing",
         "prf-sponsor")
KIND_NAME = {"claim": "Elevator claim", "sponsor-feedback": "Sponsor request", "atlas-feedback": "Parcel Report waitlist",
             "rain-print-order": "Rain print order", "rain-print-business": "Rain Print business quote",
             "elevator-listing": "Elevator listing request", "prf-sponsor": "PRF sponsor inquiry"}
# How an elevator asking to post its bids would like to do it (worker v5.21).
EL_HOW = {"email": "Add bids@agsist.com to the morning bid email or text", "phone": "A private phone link",
          "not-sure": "Not sure yet"}
EL_NEXT = ("Call the elevator at its own number (not only the one typed here) and ask for this person. "
           "Then make the listing at agsist.com/elev-admin under Requests, or Dismiss it there.")
# What Sig does with a PRF state sponsor inquiry (worker v5.22). The price is never on the site.
PRF_NEXT = ("Reply with your price for these states (Reply goes to them). Terms: one business per state, prepaid, "
            "placement through Dec 31, first say on renewing. Once paid, add one entry per state to data/prf-sponsors.json "
            "(name, url, line, phone, logo in img/sponsors/ under 50 KB, through YYYY-12-31) and commit. It shows on the state "
            "page, every county page and the /prf result for that state on that commit. Farmers First never goes in a slot.")
# What a rain print order's choice means, in the subject and the body.
RP_CHOICE = {"digital": "Digital file", "print12x18": "13 x 19 print", "framed12x18": "13 x 19 framed print"}
DESIGN_RE = re.compile(r"https://agsist\.com/rain-print\?[A-Za-z0-9%+._~=&-]+")
YEAR_RE = re.compile(r"[?&]year=(\d{4})(?:&|$)")
# A Rain Print logo (worker v5.23): its id, printed as a link to the PNG the buyer uploaded.
LOGO_URL = "https://agsist-subs.dnilgis.workers.dev/rp-logo/"
LOGO_ID_RE = re.compile(r"[0-9a-hjkmnp-tv-z]{12}")
RP_DELIVER = {"buyer": "The buyer", "recipient": "The person it is for"}
# A business quote's product and shipping choice, spelled out.
RPB_PRODUCT = {"print": "13 x 19 print", "framed": "13 x 19 framed print", "digital": "Digital file", "not-sure": "Not sure yet"}
RPB_SHIP = {"one": "All to one address", "each": "One to each customer", "not-sure": "Not sure yet"}
GIFT_NOTE = "Yes: make it after January 1, once the full year is in"
# A digital file has no proof step (2026-10-14, Sig): the finished file goes out after payment.
RP_FILE_NEXT = ("No proof for the file. Email them the finished file within 1 business day after they pay. "
                "If they ask for any change, fix it or redo it by hand and send it again, no charge.")
RP_FILE_NEXT_JAN = ("No proof for the file. Email them the finished file in January, once the full year is in. "
                    "If they ask for any change, fix it or redo it by hand and send it again, no charge.")
PLAIN_GIFT_NOTE = "Yes: the note printed at the top of the letter in the box, no prices"
CARD_TWICE_NOTE = "THIS GIFT CARD WAS USED MORE THAN ONCE. Honour the first order only."
CARD_UPGRADE_NOTE = "Yes: they chose more than the card paid for. Email a link for the difference."
# Values printed as a mailto link.
MAIL_LABELS = ("Work email", "Email", "Reply to", "Their email")
# The order and labels each kind prints in. Anything else stored is ignored.
FIELDS = {
    "claim": [("elevator", "Elevator or co-op"), ("town", "Town"), ("state", "State"), ("contact_name", "Contact"),
              ("role", "Role"), ("email", "Work email"), ("phone", "Phone"), ("bid_page_url", "Bid page"),
              ("hosted_board", "Tell me about a hosted bid board")],
    "sponsor-feedback": [("request", "Request"), ("sponsor", "Sponsor"), ("proof", "Proof code"), ("email", "Reply to"),
                         ("message", "Message")],
    "atlas-feedback": [("email", "Email"), ("source", "Source")],
    "rain-print-order": [("choice", "Choice"), ("gift_january", "Gift"), ("gift", "Gift"), ("name", "Name"), ("email", "Email"),
                         ("gift_to", "Gift for"), ("gift_deliver", "Deliver to"), ("gift_email", "Their email"),
                         ("gift_message", "Card message"), ("address", "Ship to"),
                         ("notes", "Notes"), ("design_code", "Design code"), ("design_url", "Design"), ("logo", "Logo"),
                         # worker v5.16: an order placed with a gift card (POST /rp-gift/redeem)
                         ("gift_card_twice", "Warning"), ("gift_card", "Gift card"), ("gift_card_paid", "Card paid for"),
                         ("gift_card_upgrade", "Upgrade"), ("gift_card_order", "Card order"), ("gift_card_from", "Card from")],
    "rain-print-business": [("business", "Business"), ("name", "Contact"), ("email", "Email"), ("phone", "Phone"),
                            ("quantity", "How many"), ("product", "Product"), ("ship", "Ship to"),
                            ("note_all", "Note for every print"), ("towns", "Towns and years"), ("notes", "Notes"),
                            ("logo", "Logo")],
    "elevator-listing": [("elevator", "Elevator"), ("town", "Town"), ("state", "State"), ("zip", "ZIP"), ("name", "Contact"),
                         ("role", "Role"), ("phone", "Phone"), ("email", "Email"), ("crops", "Crops"), ("how", "How to post"),
                         ("note", "Note"), ("dir_id", "Directory id")],
    "prf-sponsor": [("business", "Business"), ("states", "States"), ("name", "Contact"), ("email", "Email"), ("phone", "Phone"),
                    ("website", "Website"), ("line", "Their line"), ("message", "Message")],
}


# The counts line (2026-10-14). (key, one, many), in the order Sig reads them.
# "gift-card" is a rain-print-order placed with a gift card (it has a
# gift_card field); "rain-gauge" is the /notice waiting list, not a form.
TALLY = (("rain-print-order", "Rain Print order request", "Rain Print order requests"),
         ("gift-card", "gift card redemption", "gift card redemptions"),
         ("rain-print-business", "business quote request", "business quote requests"),
         ("rain-gauge", "rain gauge waitlist", "rain gauge waitlist"),
         ("elevator-listing", "elevator listing", "elevator listing"),
         ("prf-sponsor", "PRF sponsor", "PRF sponsor"),
         ("claim", "elevator claim", "elevator claims"),
         ("sponsor-feedback", "sponsor request", "sponsor requests"),
         ("atlas-feedback", "Parcel Report waitlist", "Parcel Report waitlist"))
DAY_MS = 24 * 3600 * 1000


def _ms(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) and v > 0 else None


def tally(posts, notes=(), since_ms=0, until_ms=None, kinds=TALLY):
    """Counts by kind of the posts and rain gauge sign-ups whose ts falls in
    [since_ms, until_ms]. Counts only: nothing else is read from a row."""
    c = {k[0]: 0 for k in kinds}

    def inside(ts):
        ts = _ms(ts)
        return ts is not None and ts >= since_ms and (until_ms is None or ts <= until_ms)
    for p in posts if isinstance(posts, list) else ():
        if not isinstance(p, dict) or not inside(p.get("ts")):
            continue
        k = p.get("kind")
        if k == "rain-print-order" and p.get("gift_card"):
            k = "gift-card"
        if k in c:
            c[k] += 1
    for r in notes if isinstance(notes, list) else ():
        if isinstance(r, dict) and r.get("topic") == "rain-gauge" and "rain-gauge" in c and inside(r.get("ts")):
            c["rain-gauge"] += 1
    return c


def tally_text(c, kinds=TALLY):
    return ", ".join("%d %s" % (c.get(k, 0), one if c.get(k, 0) == 1 else many) for k, one, many in kinds)


def last24(base, tok, fetch, now_ms=None):
    """The counts line for the top of a digest. Never raises."""
    now_ms = now_ms if now_ms is not None else int(datetime.now(timezone.utc).timestamp() * 1000)
    try:
        posts = fetch(base, "form-list", tok)
        notes = fetch(base, "notice-list", tok, topic="rain-gauge")
        if not isinstance(posts, list) or not isinstance(notes, list):
            raise ValueError("not a list")
    except Exception:                                      # noqa: BLE001
        return "Last 24 hours: the counts could not be read this time."
    return "Last 24 hours: %s." % tally_text(tally(posts, notes, now_ms - DAY_MS, now_ms))


def env(name, default=None):
    v = os.environ.get(name)
    return v if v not in (None, "") else default


def when(ts):
    try:
        d = datetime.fromtimestamp(ts / 1000, timezone.utc)
    except Exception:                                      # noqa: BLE001
        return ""
    d = d.astimezone(CT) if CT else d
    return d.strftime("%b ") + str(d.day) + d.strftime(", %-I:%M %p ") + ("CT" if CT else "UTC")


def counts(posts):
    c = {k: 0 for k in KINDS}
    for p in posts:
        if p.get("kind") in c:
            c[p["kind"]] += 1
    return c


def count_line(c):
    return ", ".join("%s %d" % (k, c[k]) for k in KINDS)


def usable(posts):
    return [p for p in posts if isinstance(p, dict) and p.get("kind") in FIELDS and isinstance(p.get("key"), str)]


def subject(posts):
    c = counts(posts)
    def many(k):
        n = KIND_NAME[k].lower()
        if c[k] == 1 or k == "atlas-feedback":
            return n
        return n[:-1] + "ies" if n.endswith("y") else n + "s"
    parts = ["%d %s" % (c[k], many(k)) for k in KINDS if c[k]]
    if len(posts) == 1:
        p = posts[0]
        if p["kind"] == "claim":
            return "Claim your board: %s, %s %s" % (p.get("elevator", ""), p.get("town", ""), p.get("state", ""))
        if p["kind"] == "sponsor-feedback":
            return p.get("subject") or "AGSIST portal: %s (%s)" % (p.get("request", ""), p.get("sponsor", ""))
        if p["kind"] == "rain-print-order":
            return "Rain print order%s: %s for %s" % (gift_tag(p), RP_CHOICE.get(p.get("choice"), p.get("choice", "")), p.get("name", ""))
        if p["kind"] == "rain-print-business":
            q = str(p.get("quantity", ""))
            return "Rain Print business quote: %s, %s print%s, %s" % (p.get("business", ""), q, "" if q == "1" else "s",
                                                                   RPB_PRODUCT.get(p.get("product"), p.get("product", "")).lower())
        if p["kind"] == "prf-sponsor":
            return "PRF sponsor inquiry: %s (%s)" % (p.get("business", ""), p.get("states", ""))
        if p["kind"] == "elevator-listing":
            return "Elevator wants to post bids: %s, %s %s" % (p.get("elevator", ""), p.get("town", ""), p.get("state", ""))
        return "Parcel Report interest"
    return "AGSIST forms: %s" % ", ".join(parts)


def is_january(p):
    return p.get("kind") == "rain-print-order" and p.get("gift_january") == "yes"


def is_gift(p):
    """A January gift or an ordinary order given as a gift: either keeps the gift_ fields."""
    return is_january(p) or (p.get("kind") == "rain-print-order" and p.get("gift") == "yes")


def gift_tag(p):
    """' (2026 gift, January)' for a January gift, the year read from its design link;
    ' (gift)' for an ordinary order given as a gift; ' (gift card)' for an order
    placed with a gift card (with the January tag when it is one); '' otherwise."""
    if p.get("kind") == "rain-print-order" and p.get("gift_card"):
        m = YEAR_RE.search(str(p.get("design_url") or ""))
        jan = (" %s," % m.group(1) if m else "") + " January" if is_january(p) else ""
        return " (gift card%s)" % ("," + jan if jan else "")
    if not is_gift(p):
        return ""
    if not is_january(p):
        return " (gift)"
    m = YEAR_RE.search(str(p.get("design_url") or ""))
    return " (%s gift, January)" % m.group(1) if m else " (gift, January)"


# The 2026-10-17 Rain Print options, read from the design link the order carries (components/rain-print.js toParams),
# so Sig sees what the print must show without opening it: crop and its days, plant drawings, a usual year,
# every year behind, frost marks, hottest and coldest day, the temperature band.
RP_CROP = {"corn": "Corn", "soy": "Soybeans"}
MON3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def _md(iso):
    m = re.fullmatch(r"\d{4}-(\d\d)-(\d\d)", iso or "")
    return "%s %d" % (MON3[int(m.group(1)) - 1], int(m.group(2))) if m and 1 <= int(m.group(1)) <= 12 else ""


def rp_options(url):
    """The options in a Rain Print design link, in plain words, or '' when it has none."""
    if not DESIGN_RE.fullmatch(str(url or "")):
        return ""
    q = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)
    on = lambda k: q.get(k, [""])[0] == "1"
    out = []
    crop = q.get("crop", [""])[0]
    if crop in RP_CROP:
        out.append("%s, planted %s, harvested %s%s%s" % (RP_CROP[crop], _md(q.get("plant", [""])[0]), _md(q.get("harvest", [""])[0]),
                                                         ", plant drawings" if on("plants") else ", stages labeled",
                                                         ", against a usual year" if on("ghost") else ""))
    if on("hist"):
        out.append("every year behind (Staircase)")
    for k, words in (("frost", "frost marks"), ("heat", "hottest and coldest day"), ("ribbon", "daily temperature band")):
        if on(k):
            out.append(words)
    return "; ".join(out)


def value(p, f):
    v = p[f]
    if f == "choice":
        return RP_CHOICE.get(v, str(v))
    if p.get("kind") == "rain-print-business" and f == "product":
        return RPB_PRODUCT.get(v, str(v))
    if p.get("kind") == "rain-print-business" and f == "ship":
        return RPB_SHIP.get(v, str(v))
    if p.get("kind") == "elevator-listing" and f == "how":
        return EL_HOW.get(v, str(v))
    if f == "gift_january":
        return GIFT_NOTE
    if f == "gift" and p.get("kind") == "rain-print-order":
        return PLAIN_GIFT_NOTE
    if f == "gift_deliver":
        return RP_DELIVER.get(v, str(v))
    if f == "gift_card_paid":
        return RP_CHOICE.get(v, str(v))
    if f == "gift_card_twice":
        return CARD_TWICE_NOTE
    if f == "gift_card_upgrade":
        return CARD_UPGRADE_NOTE
    if f == "logo":
        return LOGO_URL + str(v) if LOGO_ID_RE.fullmatch(str(v)) else "(a logo id that does not look right: %s)" % (v,)
    return str(v)


def blocks(posts):
    """-> [(heading, [(label, value)])] in arrival order."""
    out = []
    # The same gift card on two orders in one batch is flagged too (the worker
    # flags it across batches when it can see the first redeem).
    cards = {}
    for p in posts:
        if p.get("gift_card"):
            cards[p["gift_card"]] = cards.get(p["gift_card"], 0) + 1
    for p in sorted(posts, key=lambda x: x.get("ts") or 0):
        if cards.get(p.get("gift_card"), 0) > 1:
            p = dict(p, gift_card_twice="yes")
        gift = is_gift(p)
        rows = [(lab, value(p, f)) for f, lab in FIELDS[p["kind"]]
                if p.get(f) not in (None, "") and (gift or not f.startswith("gift_") or f.startswith("gift_card"))
                and (f != "gift" or (gift and not is_january(p)))]
        if p["kind"] == "elevator-listing":
            rows.append(("Next", EL_NEXT))
        if p["kind"] == "prf-sponsor":
            rows.append(("Next", PRF_NEXT))
        if p["kind"] == "rain-print-order" and rp_options(p.get("design_url")):
            rows.append(("Options", rp_options(p.get("design_url"))))
        if p["kind"] == "rain-print-order" and p.get("choice") == "digital":
            rows.append(("Next", RP_FILE_NEXT_JAN if is_january(p) else RP_FILE_NEXT))
        out.append(("%s%s, %s" % (KIND_NAME[p["kind"]], gift_tag(p), when(p.get("ts") or 0)), rows))
    return out


def build(posts, to, fn="AGSIST", fa="", top=""):
    m = EmailMessage()
    m["Subject"] = subject(posts)
    m["From"] = formataddr((fn, fa))
    m["To"] = to
    m["Message-ID"] = make_msgid(domain=(fa.split("@", 1)[1] if "@" in fa else "agsist.com"))
    # One post with an address: Reply goes straight to that person, the way
    # Formspree's emails did. With several, Sig picks from the links.
    if len(posts) == 1 and re.fullmatch(r"[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", str(posts[0].get("email") or "")):
        m["Reply-To"] = posts[0]["email"]
    bl = blocks(posts)
    text = [top, ""] if top else []
    for head, rows in bl:
        text.append(head)
        text.extend("%s: %s" % (lab, val) for lab, val in rows)
        text.append("")
    text.append("Sent from the forms on agsist.com. Nothing on the site changes until you act on it.")
    m.set_content("\n".join(text) + "\n\n-- \n" + ADDRESS + "\n")
    e = H.escape
    hb = ['<p style="font-size:14px;line-height:1.5;margin:0 0 12px;color:#1a1a1a">%s</p>' % e(top)] if top else []
    for head, rows in bl:
        hb.append('<h3 style="font-size:15px;margin:18px 0 6px">%s</h3>' % e(head))
        hb.append('<table style="font-size:14px;line-height:1.5;border-collapse:collapse">')
        for lab, val in rows:
            v = e(val).replace("\n", "<br>")
            if lab in MAIL_LABELS:
                v = '<a href="mailto:%s">%s</a>' % (e(val, quote=True), e(val))
            elif lab == "Logo" and val.startswith(LOGO_URL) and LOGO_ID_RE.fullmatch(val[len(LOGO_URL):]):
                v = '<a href="%s">Open the logo they uploaded</a>' % e(val, quote=True)
            elif lab == "Design" and DESIGN_RE.fullmatch(val):
                # Only the page's own design links are made clickable.
                v = '<a href="%s">Open this design on agsist.com</a><br><span style="font-size:12px;color:#6b6b6b;word-break:break-all">%s</span>' % (
                    e(val, quote=True), e(val))
            hb.append('<tr><td style="color:#6b6b6b;padding:2px 12px 2px 0;vertical-align:top">%s</td><td>%s</td></tr>' % (e(lab), v))
        hb.append("</table>")
    m.add_alternative('<div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;padding:20px 16px;color:#1a1a1a;background:#fff">'
                      '%s<p style="font-size:13px;color:#6b6b6b;margin-top:20px">Sent from the forms on agsist.com. '
                      'Nothing on the site changes until you act on it.<br>%s</p></div>' % ("".join(hb), e(ADDRESS)), subtype="html")
    return m


def worker(base, path, tok, body=None, **q):
    url = "%s/%s?%s" % (base, path, urllib.parse.urlencode(dict(q, token=tok)))
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method="POST" if data else "GET",
                                 headers={"Content-Type": "application/json", "User-Agent": "agsist-form-digest"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


def run(base, tok, to, dry, send, fetch=worker, top=None):
    """Returns (exit code, log lines). Log lines carry counts only. `top`,
    when given, returns the counts line for the top of the email (main passes
    the last-24-hours reader); it is only asked when there is something new."""
    log = []
    try:
        posts = fetch(base, "form-list", tok, new="1")
    except urllib.error.HTTPError as e:
        if e.code == 404:
            log.append("worker has no /form-list yet (deploy workers/subs-worker.js v5.8); nothing to do")
            return 0, log
        log.append("form-list failed: HTTP %d" % e.code)
        return 1, log
    except Exception as e:                                 # noqa: BLE001
        log.append("form-list failed: %s" % type(e).__name__)
        return 1, log
    if not isinstance(posts, list):
        log.append("form-list answered something other than a list")
        return 1, log
    posts = usable(posts)
    log.append("new form posts: %s" % count_line(counts(posts)))
    if not posts:
        return 0, log
    line = top() if top else ""
    if line:
        log.append(line)
    if dry:
        return 0, log
    try:
        send(build(posts, to, top=line))
    except Exception as e:                                 # noqa: BLE001
        log.append("send failed (%s); left unmarked for the next run" % type(e).__name__)
        return 1, log
    try:
        r = fetch(base, "form-mark", tok, {"keys": [p["key"] for p in posts]})
        log.append("mailed %d; marked %s" % (len(posts), r.get("marked") if isinstance(r, dict) else "?"))
    except Exception as e:                                 # noqa: BLE001
        log.append("mailed %d; mark failed (%s), the next run may repeat them" % (len(posts), type(e).__name__))
        return 1, log
    return 0, log


# ───────────────────────────── hay board (worker v5.30) ─────────────────────────────
# New hay board posts, and posts newly held by the screen or hidden by three
# reports, ride the same run: one more email when there is something, then
# POST /hay/admin/mark. Public text only: never the poster's phone or email.
HAY_PRODUCT = {"alfalfa": "Alfalfa", "grass": "Grass hay", "mixed": "Mixed hay", "straw": "Straw", "corn-stalks": "Corn stalks",
               "baleage": "Baleage or haylage", "other": "Other"}
HAY_BALE = {"small-square": "small squares", "large-square": "large squares", "round": "rounds", "wrapped": "wrapped bales", "bulk": "bulk"}
HAY_WHY = {"held": "held by the screen", "reports": "hidden by reports", "sig": "hidden by you"}
HAY_ID_RE = re.compile(r"[0-9a-hjkmnp-tv-z]{10}")


def hay_worker(base, path, tok, body=None, **q):
    """The hay admin routes take the token as a Bearer header only."""
    url = "%s/%s%s" % (base, path, ("?" + urllib.parse.urlencode(q)) if q else "")
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method="POST" if data else "GET",
                                 headers={"Content-Type": "application/json", "User-Agent": "agsist-form-digest",
                                          "Authorization": "Bearer " + tok})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


def hay_line(p):
    """One post in plain words, public fields only."""
    kind = "For sale" if p.get("kind") == "sale" else "Wanted"
    bits = [HAY_PRODUCT.get(p.get("product"), str(p.get("product") or ""))]
    if p.get("cutting"):
        bits.append({"1": "1st", "2": "2nd", "3": "3rd"}.get(str(p["cutting"]), str(p["cutting"]) + "th") + " cutting")
    if p.get("count") is not None:
        bits.append("%s %s" % (p["count"], HAY_BALE.get(p.get("bale"), "bales")))
    elif p.get("bale"):
        bits.append(HAY_BALE.get(p["bale"], p["bale"]))
    if p.get("price") is not None:
        bits.append("$%s a %s" % (("%.2f" % p["price"]).rstrip("0").rstrip("."), p.get("unit") or "bale"))
    if p.get("weight"):
        bits.append("%s lb bales" % p["weight"])
    return "%s: %s" % (kind, ", ".join(b for b in bits if b))


def hay_rows(p):
    rows = [("Post", hay_line(p)), ("Where", ("%s (%s)" % (p.get("place"), p.get("zip"))) if p.get("place") else "ZIP %s" % p.get("zip", ""))]
    test = ", ".join("%s %s" % (k.upper(), p[k]) for k in ("rfv", "rfq", "cp") if p.get(k) is not None)
    if test:
        rows.append(("Test", test))
    d = p.get("delivery")
    rows.append(("Delivery", "Yes" if d == "yes" else ("No" if d in (None, "", "no") else "Up to %s miles" % d)))
    if p.get("note"):
        rows.append(("Note", p["note"]))
    if p.get("name"):
        rows.append(("Name", p["name"]))
    st = p.get("status")
    if st != "live":
        why = HAY_WHY.get(p.get("why_hidden"), HAY_WHY["held"] if st == "held" else "hidden")
        if p.get("why_hidden") in ("repeated text", "all caps"):
            why = "held by the screen (%s)" % p["why_hidden"]
        rows.append(("Status", "Not shown: " + why))
    reps = [r.get("why", "other") for r in p.get("reports") or [] if isinstance(r, dict)]
    if reps:
        rows.append(("Reports", "%d (%s)" % (len(reps), ", ".join(reps))))
    if HAY_ID_RE.fullmatch(str(p.get("id") or "")):
        rows.append(("Id", p["id"]))
        act = "clear" if st != "live" else "hide"
        rows.append(("To %s" % act, "curl -X POST -H \"Authorization: Bearer $LIST_TOKEN\" -H \"Content-Type: application/json\" "
                     "-d '{\"id\":\"%s\"}' $LIST_URL/hay/admin/%s" % (p["id"], act)))
    return rows


def hay_build(posts, to, fn="AGSIST", fa=""):
    new = [p for p in posts if not p.get("n")]
    flagged = [p for p in posts if p.get("status") != "live"]
    parts = []
    if new:
        parts.append("%d new post%s" % (len(new), "" if len(new) == 1 else "s"))
    if flagged:
        parts.append("%d not shown" % len(flagged))
    m = EmailMessage()
    m["Subject"] = "The Haymow: " + ", ".join(parts)
    m["From"] = formataddr((fn, fa))
    m["To"] = to
    m["Message-ID"] = make_msgid(domain=(fa.split("@", 1)[1] if "@" in fa else "agsist.com"))
    text, hb, e = [], [], H.escape
    for p in sorted(posts, key=lambda x: x.get("ts") or 0):
        head = "%s, %s" % ("New Haymow post" if not p.get("n") else "Haymow post not shown", when(p.get("ts") or 0))
        rows = hay_rows(p)
        text.append(head)
        text.extend("%s: %s" % r for r in rows)
        text.append("")
        hb.append('<h3 style="font-size:15px;margin:18px 0 6px">%s</h3><table style="font-size:14px;line-height:1.5;border-collapse:collapse">' % e(head))
        hb.extend('<tr><td style="color:#6b6b6b;padding:2px 12px 2px 0;vertical-align:top">%s</td><td>%s</td></tr>' % (e(a), e(b)) for a, b in rows)
        hb.append("</table>")
    foot = ("Live posts are on agsist.com/haymow already. Phones and emails are not in this email; "
            "GET /hay/admin/list with the list token shows them.")
    text.append(foot)
    m.set_content("\n".join(text) + "\n\n-- \n" + ADDRESS + "\n")
    m.add_alternative('<div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;padding:20px 16px;color:#1a1a1a;background:#fff">'
                      '%s<p style="font-size:13px;color:#6b6b6b;margin-top:20px">%s<br>%s</p></div>' % ("".join(hb), e(foot), e(ADDRESS)), subtype="html")
    return m


def hay_run(base, tok, to, dry, send, fetch=hay_worker):
    """Returns (exit code, log lines). Counts only in the log."""
    log = []
    try:
        r = fetch(base, "hay/admin/list", tok, new="1")
    except urllib.error.HTTPError as ex:
        if ex.code == 404:
            log.append("worker has no /hay/admin/list yet (deploy workers/subs-worker.js v5.30); hay board skipped")
            return 0, log
        log.append("hay list failed: HTTP %d" % ex.code)
        return 1, log
    except Exception as ex:                                # noqa: BLE001
        log.append("hay list failed: %s" % type(ex).__name__)
        return 1, log
    posts = r.get("posts") if isinstance(r, dict) else None
    if not isinstance(posts, list):
        log.append("hay list answered something unexpected")
        return 1, log
    posts = [p for p in posts if isinstance(p, dict) and HAY_ID_RE.fullmatch(str(p.get("id") or ""))]
    log.append("hay board: %d new, %d not shown" % (sum(1 for p in posts if not p.get("n")), sum(1 for p in posts if p.get("status") != "live")))
    if not posts or dry:
        return 0, log
    try:
        send(hay_build(posts, to))
    except Exception as ex:                                # noqa: BLE001
        log.append("hay send failed (%s); left unmarked for the next run" % type(ex).__name__)
        return 1, log
    try:
        r = fetch(base, "hay/admin/mark", tok, {"ids": [p["id"] for p in posts]})
        log.append("hay mailed %d; marked %s" % (len(posts), r.get("marked") if isinstance(r, dict) else "?"))
    except Exception as ex:                                # noqa: BLE001
        log.append("hay mailed %d; mark failed (%s), the next run may repeat them" % (len(posts), type(ex).__name__))
        return 1, log
    return 0, log


def main():
    if "--selftest" in sys.argv:
        return selftest()
    base = (env("LIST_URL") or "").strip()
    u = urllib.parse.urlsplit(base)
    base = "%s://%s" % (u.scheme, u.netloc) if u.scheme and u.netloc else ""
    tok = (env("LIST_TOKEN") or "").strip()
    if not (base and tok):
        print("LIST_URL and LIST_TOKEN are required")
        return 1
    dry = env("DRY_RUN") == "1"
    to = env("FORMS_TO") or env("SPONSOR_TO") or "sig@farmers1st.com"
    fn, fa = env("FROM_NAME", "AGSIST"), env("FROM_ADDR") or env("SMTP_USER") or ""

    def send(m):
        del m["From"]
        m["From"] = formataddr((fn, fa))
        conn = smtplib.SMTP(env("SMTP_HOST", "smtp.gmail.com"), int(env("SMTP_PORT", "587")), timeout=30)
        try:
            conn.starttls(context=ssl.create_default_context())
            conn.login(env("SMTP_USER"), env("SMTP_PASS"))
            conn.send_message(m)
        finally:
            try:
                conn.quit()
            except Exception:                              # noqa: BLE001
                pass

    code, log = run(base, tok, to, dry, send, top=lambda: last24(base, tok, worker))
    for line in log:
        print(line)
    hcode, hlog = hay_run(base, tok, to, dry, send)
    for line in hlog:
        print(line)
    return code or hcode


# ───────────────────────────── selftest ─────────────────────────────

def selftest():
    fails = []

    def ck(name, ok, detail=""):
        print(("  ok   " if ok else "  FAIL ") + name + ("" if ok else "  -- %s" % (detail,)))
        if not ok:
            fails.append(name)

    ts = int(datetime(2026, 10, 11, 15, 5, tzinfo=timezone.utc).timestamp() * 1000)
    claim = {"key": "form:claim:%d:0a1b2c3d" % ts, "kind": "claim", "ts": ts, "n": 0, "elevator": "Chetek Co-op",
             "town": "Chetek", "state": "WI", "contact_name": "Al Smith", "role": "Manager", "email": "al@chetek.coop",
             "phone": "715-555-0100", "bid_page_url": "https://chetek.coop/bids", "hosted_board": "yes"}
    fb = {"key": "form:sponsor-feedback:%d:0a1b2c3e" % (ts + 1), "kind": "sponsor-feedback", "ts": ts + 1, "n": 0,
          "request": "Approval", "sponsor": "Apex <b>Ag</b>", "proof": "AB12", "subject": "Approved: Apex ad, proof AB12",
          "message": "I approve.\nHeadline: Seed"}
    atlas = {"key": "form:atlas-feedback:%d:0a1b2c3f" % (ts + 2), "kind": "atlas-feedback", "ts": ts + 2, "n": 0,
             "email": "farmer@x.com", "source": "farmland-atlas"}

    rp = {"key": "form:rain-print-order:%d:0a1b2c40" % (ts + 3), "kind": "rain-print-order", "ts": ts + 3, "n": 0,
          "choice": "framed12x18", "name": "Jane Olson", "email": "jane@farm.com", "address": "12 Main St\nChetek WI 54728",
          "notes": "Gift <for> Dad", "design_code": "MXxDaGV0ZWs",
          "design_url": "https://agsist.com/rain-print?place=Chetek%2C+WI&year=2025&layout=staircase&name=The+Olson+Farm"}

    print("subjects")
    ck("one claim: the subject the claim form always had", subject([claim]) == "Claim your board: Chetek Co-op, Chetek WI", subject([claim]))
    ck("one approval: the page's own subject", subject([fb]) == "Approved: Apex ad, proof AB12")
    ck("one waitlist: the old Formspree subject", subject([atlas]) == "Parcel Report interest")
    ck("several: counted by kind", subject([claim, fb, atlas]) ==
       "AGSIST forms: 1 elevator claim, 1 sponsor request, 1 parcel report waitlist", subject([claim, fb, atlas]))
    ck("plural", "2 elevator claims" in subject([claim, dict(claim, key="form:claim:1:00000000")]))
    ck("one rain print order: choice and buyer", subject([rp]) == "Rain print order: 13 x 19 framed print for Jane Olson", subject([rp]))
    ck("rain print orders counted", "2 rain print orders" in subject([rp, dict(rp, key="form:rain-print-order:1:00000000")]))
    gift = dict(rp, gift_january="yes", gift_to="Dad Olson", gift_deliver="recipient", gift_message="For every inch\nyou <b>farmed</b>",
                design_code="GIFT-MXxDaGV0ZWs",
                design_url="https://agsist.com/rain-print?place=Chetek%2C+WI&year=2026&layout=staircase&gift=1")
    ck("one gift order: year, gift and January in the subject", subject([gift]) == "Rain print order (2026 gift, January): 13 x 19 framed print for Jane Olson", subject([gift]))
    ck("a gift order with no year in its link still says gift", subject([dict(gift, design_url="https://agsist.com/rain-print?place=X")]) ==
       "Rain print order (gift, January): 13 x 19 framed print for Jane Olson")
    ck("gift fields without the flag do not make a gift", subject([dict(rp, gift_to="Dad")]) == "Rain print order: 13 x 19 framed print for Jane Olson")

    card = dict(rp, gift_card="RP-\u2026-X2F4 (No. 7)", gift_card_paid="digital", gift_card_order="RP-1042",
                gift_card_from="Kate", gift_card_upgrade="yes")
    ck("a gift card order says so in the subject", subject([card]) == "Rain print order (gift card): 13 x 19 framed print for Jane Olson", subject([card]))
    t = build([card], "s").get_body(("plain",)).get_content()
    ck("a gift card order shows the card lines", all(x in t for x in (
        "Gift card: RP-\u2026-X2F4 (No. 7)", "Card paid for: Digital file", "Card order: RP-1042", "Card from: Kate",
        "Upgrade: Yes: they chose more than the card paid for")) and "Warning" not in t, t)
    t = build([card, dict(card, key="form:rain-print-order:9:00000009", ts=ts + 9)], "s").get_body(("plain",)).get_content()
    ck("the same card twice in one batch is flagged on both", t.count("THIS GIFT CARD WAS USED MORE THAN ONCE") == 2, t)
    t = build([dict(card, gift_card_twice="yes")], "s").get_body(("plain",)).get_content()
    ck("the worker's twice flag is shown", "Warning: THIS GIFT CARD WAS USED MORE THAN ONCE" in t, t)

    print("\nthe email")
    m = build([claim], "sig@x.com", fa="me@agsist.com")
    t = m.get_body(("plain",)).get_content()
    ck("every claim field, hosted board included", all(s in t for s in (
        "Elevator or co-op: Chetek Co-op", "Work email: al@chetek.coop", "Phone: 715-555-0100",
        "Bid page: https://chetek.coop/bids", "Tell me about a hosted bid board: yes")), t)
    ck("one post: Reply-To is the sender", m["Reply-To"] == "al@chetek.coop")
    ck("goes to Sig", m["To"] == "sig@x.com")
    ck("an odd address is not put in a header", build([dict(atlas, email="a,b@x.com")], "s")["Reply-To"] is None)
    m = build([claim, fb, atlas], "sig@x.com")
    ck("several: no Reply-To", m["Reply-To"] is None)
    h = m.get_body(("html",)).get_content()
    ck("html escapes what people typed", "<b>Ag</b>" not in h and "&lt;b&gt;Ag&lt;/b&gt;" in h)
    ck("message line breaks kept", "I approve.<br>Headline: Seed" in h)
    t = m.get_body(("plain",)).get_content()
    ck("arrival order", t.index("Elevator claim") < t.index("Sponsor request") < t.index("Parcel Report waitlist"))
    ck("internal fields not printed", "form:claim" not in t and "n: 0" not in t)

    m = build([rp], "sig@x.com")
    ck("rain print order: Reply-To is the buyer", m["Reply-To"] == "jane@farm.com", m["Reply-To"])
    t = m.get_body(("plain",)).get_content()
    ck("rain print order: every field, choice spelled out", all(s in t for s in (
        "Choice: 13 x 19 framed print", "Name: Jane Olson", "Ship to: 12 Main St", "Design code: MXxDaGV0ZWs",
        "Design: https://agsist.com/rain-print?place=Chetek%2C+WI&year=2025")), t)
    h = m.get_body(("html",)).get_content()
    ck("rain print order: design link is clickable", '<a href="https://agsist.com/rain-print?place=Chetek%2C+WI&amp;year=2025&amp;layout=staircase&amp;name=The+Olson+Farm">' in h, h)
    ck("rain print order: notes escaped, address lines kept", "Gift &lt;for&gt; Dad" in h and "12 Main St<br>Chetek" in h)
    t = build([rp], "s").get_body(("plain",)).get_content()
    ck("an ordinary order shows no gift lines", "Gift" not in t.replace("Gift <for> Dad", ""), t)
    m = build([gift], "sig@x.com")
    t = m.get_body(("plain",)).get_content()
    ck("gift order: the January note and every gift field", all(s in t for s in (
        "Rain print order (2026 gift, January), ", "Gift: Yes: make it after January 1, once the full year is in",
        "Gift for: Dad Olson", "Deliver to: The person it is for", "Card message: For every inch\nyou <b>farmed</b>",
        "Ship to: 12 Main St", "Design code: GIFT-MXxDaGV0ZWs")), t)
    ck("gift order: Reply-To is still the buyer", m["Reply-To"] == "jane@farm.com")
    h = m.get_body(("html",)).get_content()
    ck("gift order: card message escaped, lines kept", "For every inch<br>you &lt;b&gt;farmed&lt;/b&gt;" in h, h)
    t = build([dict(gift, choice="digital", gift_email="dad@farm.com", address="")], "s").get_body(("plain",)).get_content()
    ck("gift file: the recipient's email is shown", "Their email: dad@farm.com" in t and "Ship to" not in t, t)
    ck("gift file: no proof, the file in January, a free redo", "Next: " + RP_FILE_NEXT_JAN in t and "in January" in RP_FILE_NEXT_JAN, t)
    t = build([dict(rp, choice="digital", address="")], "s").get_body(("plain",)).get_content()
    ck("file order: no proof, the file within 1 business day of paying, a free redo",
       "Next: No proof for the file. Email them the finished file within 1 business day after they pay." in t and "no charge" in t, t)
    t = build([rp], "s").get_body(("plain",)).get_content()
    ck("a print order has no file line", "Next:" not in t and "No proof" not in t, t)
    ck("the January note waits for the full year", GIFT_NOTE == "Yes: make it after January 1, once the full year is in" and "December" not in GIFT_NOTE)
    h = build([dict(gift, choice="digital", gift_email="dad@farm.com")], "s").get_body(("html",)).get_content()
    ck("gift file: the recipient's email is a mailto link", '<a href="mailto:dad@farm.com">' in h)
    t = build([dict(rp, gift_to="Dad", gift_message="x")], "s").get_body(("plain",)).get_content()
    ck("gift fields without the flag are not printed", "Gift for" not in t and "Card message" not in t, t)
    h = build([dict(rp, design_url="https://evil.example/rain-print?x=1")], "s").get_body(("html",)).get_content()
    ck("a design link off agsist.com is printed, not linked", '<a href="https://evil.example' not in h and "https://evil.example/rain-print?x=1" in h)

    print("\ngift orders that are not January gifts")
    pg = dict(rp, gift="yes", gift_to="Dad Olson", gift_deliver="recipient", gift_message="Thanks for\nevery year")
    ck("plain gift: (gift) in the subject, apart from a January gift",
       subject([pg]) == "Rain print order (gift): 13 x 19 framed print for Jane Olson" and "January" not in subject([pg]), subject([pg]))
    t = build([pg], "s").get_body(("plain",)).get_content()
    ck("plain gift: note line, recipient, where it goes and the note", all(x in t for x in (
        "Rain print order (gift), ", "Gift: Yes: the note printed at the top of the letter in the box, no prices", "Gift for: Dad Olson",
        "Deliver to: The person it is for", "Card message: Thanks for\nevery year")) and "January" not in t, t)
    t = build([dict(gift, gift="yes")], "s").get_body(("plain",)).get_content()
    ck("both flags: one Gift line, the January one", t.count("Gift: ") == 1 and GIFT_NOTE in t, t)
    t = build([dict(rp, gift="no", gift_to="Dad")], "s").get_body(("plain",)).get_content()
    ck("no gift flag: no gift lines", "Gift" not in t.replace("Gift <for> Dad", ""), t)

    print("\nrain print business quotes")
    rb = {"key": "form:rain-print-business:%d:0a1b2c41" % (ts + 4), "kind": "rain-print-business", "ts": ts + 4, "n": 0,
          "business": "Chetek <Co-op>", "name": "Al Smith", "email": "al@chetek.coop", "phone": "715-555-0100", "quantity": "12",
          "product": "framed", "ship": "each", "towns": "Chetek, WI 2025\nRice Lake, WI 2012", "notes": "Card in each box", "page": "/rain-print#rp-biz"}
    ck("one business quote: business, count and product in the subject",
       subject([rb]) == "Rain Print business quote: Chetek <Co-op>, 12 prints, 13 x 19 framed print", subject([rb]))
    ck("one print is singular", subject([dict(rb, quantity="1", product="not-sure")]) == "Rain Print business quote: Chetek <Co-op>, 1 print, not sure yet",
       subject([dict(rb, quantity="1", product="not-sure")]))
    ck("business quotes counted", "2 rain print business quotes" in subject([rb, dict(rb, key="form:rain-print-business:1:00000000")]),
       subject([rb, dict(rb, key="form:rain-print-business:1:00000000")]))
    m = build([rb], "sig@x.com")
    ck("business quote: Reply-To is the contact", m["Reply-To"] == "al@chetek.coop")
    t = m.get_body(("plain",)).get_content()
    ck("business quote: every field, named and spelled out", all(s in t for s in (
        "Rain Print business quote, Oct 11", "Business: Chetek <Co-op>", "Contact: Al Smith", "Email: al@chetek.coop",
        "Phone: 715-555-0100", "How many: 12", "Product: 13 x 19 framed print", "Ship to: One to each customer",
        "Towns and years: Chetek, WI 2025\nRice Lake, WI 2012", "Notes: Card in each box")), t)
    ck("business quote: page and internal fields not printed", "rp-biz" not in t and "form:rain" not in t, t)
    h = m.get_body(("html",)).get_content()
    ck("business quote: html escaped, town lines kept, email linked",
       "Chetek &lt;Co-op&gt;" in h and "Chetek, WI 2025<br>Rice Lake" in h and '<a href="mailto:al@chetek.coop">' in h, h)
    t = build([dict(rb, note_all="Thanks for another year.\nFrom all of us at the co-op.")], "s").get_body(("plain",)).get_content()
    ck("business quote: the note for every print", "Note for every print: Thanks for another year.\nFrom all of us" in t, t)
    t = build([dict(rb, product="not-sure", ship="one", phone="")], "s").get_body(("plain",)).get_content()
    ck("business quote: not sure, one address, no phone line", "Product: Not sure yet" in t and "Ship to: All to one address" in t and "Phone" not in t, t)
    t = build([claim, rb, rp], "s").get_body(("plain",)).get_content()
    ck("business quote sits with the other kinds, in arrival order", t.index("Elevator claim") < t.index("Rain print order") < t.index("Rain Print business quote"), t)
    calls0 = []

    def f0(base, path, tok, body=None, **q):
        calls0.append(path)
        return [rb] if path == "form-list" else {"ok": True, "marked": len(body["keys"])}
    sent0 = []
    code, log = run("https://w.dev", "t", "s", False, sent0.append, f0)
    ck("business quote: mailed, marked, counted in the log without names",
       code == 0 and len(sent0) == 1 and calls0 == ["form-list", "form-mark"] and "rain-print-business 1" in log[0] and "Chetek" not in " ".join(log), log)

    el = {"key": "form:elevator-listing:%d:0a1b2c51" % (ts + 5), "kind": "elevator-listing", "ts": ts + 5, "n": 0,
          "elevator": "Lingle <Elevator>", "town": "Lingle", "state": "WY", "zip": "82223", "name": "Pat Doe", "role": "Manager",
          "phone": "307-555-0100", "email": "pat@example.com", "crops": "corn, wheat", "how": "phone",
          "note": "Call after 3.\nAsk for Pat.", "dir_id": "reg:WY|westplainsllc|lingle", "page": "/list-your-elevator"}
    ck("elevator listing: subject", subject([el]) == "Elevator wants to post bids: Lingle <Elevator>, Lingle WY", subject([el]))
    m = build([el], "s")
    t = m.get_body(("plain",)).get_content()
    ck("elevator listing: every field, spelled out, and the next step", all(x in t for x in (
        "Elevator listing request, Oct 11", "Elevator: Lingle <Elevator>", "ZIP: 82223", "Contact: Pat Doe", "Role: Manager",
        "Phone: 307-555-0100", "Email: pat@example.com", "Crops: corn, wheat", "How to post: A private phone link",
        "Note: Call after 3.\nAsk for Pat.", "Directory id: reg:WY|westplainsllc|lingle", "Next: Call the elevator at its own number")), t)
    ck("elevator listing: page and internal fields not printed", "/list-your-elevator" not in t and "form:elevator" not in t, t)
    h = m.get_body(("html",)).get_content()
    ck("elevator listing: html escaped, email linked", "Lingle &lt;Elevator&gt;" in h and '<a href="mailto:pat@example.com">' in h, h)
    t = build([dict(el, how="email")], "s").get_body(("plain",)).get_content()
    ck("elevator listing: the email way", "How to post: Add bids@agsist.com to the morning bid email or text" in t, t)
    ck("elevator listing counted", "1 elevator listing request" in subject([el, rb]) and "2 elevator listing requests" in subject([el, dict(el, key="x")]),
       subject([el, rb]))

    print("\nPRF sponsor inquiries")
    ps = {"key": "form:prf-sponsor:%d:0a1b2c61" % (ts + 6), "kind": "prf-sponsor", "ts": ts + 6, "n": 0,
          "business": "Plains <Crop> Insurance", "states": "KS, NE", "name": "Dana Roe", "email": "dana@plains.example",
          "phone": "785-555-0100", "website": "https://plains.example/prf", "line": "PRF for western Kansas.",
          "message": "Call after 4.\nAsk for Dana.", "page": "/prf-sponsor"}
    ck("prf sponsor: the subject names the business and states",
       subject([ps]) == "PRF sponsor inquiry: Plains <Crop> Insurance (KS, NE)", subject([ps]))
    m = build([ps], "s")
    ck("prf sponsor: Reply-To is the business", m["Reply-To"] == "dana@plains.example", m["Reply-To"])
    t = m.get_body(("plain",)).get_content()
    ck("prf sponsor: every field and the next step", all(x in t for x in (
        "PRF sponsor inquiry, Oct 11", "Business: Plains <Crop> Insurance", "States: KS, NE", "Contact: Dana Roe",
        "Email: dana@plains.example", "Phone: 785-555-0100", "Website: https://plains.example/prf",
        "Their line: PRF for western Kansas.", "Message: Call after 4.\nAsk for Dana.",
        "Next: Reply with your price for these states", "data/prf-sponsors.json")), t)
    ck("prf sponsor: no price and no page field printed", not re.search(r"(^|\s)/prf-sponsor(\s|$)", t) and not re.search(r"\$\s?\d", t), t)
    h = m.get_body(("html",)).get_content()
    ck("prf sponsor: html escaped, email linked", "Plains &lt;Crop&gt; Insurance" in h and '<a href="mailto:dana@plains.example">' in h, h)
    t = build([dict(ps, phone="", website="", line="", message="")], "s").get_body(("plain",)).get_content()
    ck("prf sponsor: optional fields left out when empty", all(x not in t for x in ("Phone:", "Website:", "Their line:", "Message:")), t)
    ck("prf sponsor counted", "1 prf sponsor inquiry" in subject([ps, rb]) and "2 prf sponsor inquiries" in subject([ps, dict(ps, key="x")]),
       subject([ps, dict(ps, key="x")]))

    print("\nthe run (fake worker, fake mail)")
    calls, sent = [], []

    def fake(posts, mark_ok=True):
        def f(base, path, tok, body=None, **q):
            calls.append((path, body, q))
            if path == "form-list":
                return posts
            if not mark_ok:
                raise OSError("down")
            return {"ok": True, "marked": len(body["keys"])}
        return f
    code, log = run("https://w.dev", "t", "sig@x.com", False, sent.append, fake([claim, fb, atlas, {"kind": "x"}]))
    ck("sends one digest", code == 0 and len(sent) == 1, log)
    ck("asks only for new posts", calls[0][0] == "form-list" and calls[0][2] == {"new": "1"})
    ck("marks exactly what it sent", calls[-1][0] == "form-mark" and calls[-1][1]["keys"] == [claim["key"], fb["key"], atlas["key"]])
    ck("log has counts only, no addresses or names",
       not any("@" in x or "Chetek" in x or "Apex" in x or "715" in x for x in log) and
       "new form posts: claim 1, sponsor-feedback 1, atlas-feedback 1, rain-print-order 0, rain-print-business 0, elevator-listing 0, prf-sponsor 0" in log, log)
    calls.clear(); sent.clear()
    code, log = run("https://w.dev", "t", "s", False, sent.append, fake([]))
    ck("nothing new: no mail, no mark", code == 0 and not sent and [c[0] for c in calls] == ["form-list"])
    calls.clear()
    code, log = run("https://w.dev", "t", "s", True, sent.append, fake([claim]))
    ck("dry run: no mail, no mark", code == 0 and not sent and [c[0] for c in calls] == ["form-list"])
    calls.clear()

    def boom(m):
        raise smtplib.SMTPException("x")
    code, log = run("https://w.dev", "t", "s", False, boom, fake([claim]))
    ck("send fails: nothing marked, exit 1", code == 1 and [c[0] for c in calls] == ["form-list"])

    def nf(base, path, tok, body=None, **q):
        raise urllib.error.HTTPError("u", 404, "nf", {}, None)
    code, log = run("https://w.dev", "t", "s", False, sent.append, nf)
    ck("worker not deployed yet: quiet success", code == 0 and "v5.8" in log[0])

    def bad(base, path, tok, body=None, **q):
        raise urllib.error.HTTPError("https://w.dev/form-list?token=SECRET", 403, "no", {}, None)
    code, log = run("https://w.dev", "t", "s", False, sent.append, bad)
    ck("bad token: exit 1, the token URL is not printed", code == 1 and "SECRET" not in " ".join(log), log)

    seen = []

    class FakeResp:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def read(self): return b'[]'
    real = urllib.request.urlopen
    urllib.request.urlopen = lambda req, timeout=0: (seen.append(req.full_url), FakeResp())[1]
    try:
        worker("https://w.dev", "form-list", "t k", new="1")
    finally:
        urllib.request.urlopen = real
    ck("query string is built, not glued", seen == ["https://w.dev/form-list?new=1&token=t+k"], seen)

    print("\nthe last 24 hours line")
    now = ts + 3600 * 1000
    old = now - 25 * 3600 * 1000
    stored = [dict(rp, ts=now - 1000, n=1), dict(rp, key="form:rain-print-order:2:00000002", ts=now - 2000),
              dict(card, ts=now - 3000), dict(rb, ts=now - 4000), dict(claim, ts=old), dict(claim, ts=now - 5000),
              dict(el, ts=old), {"kind": "x", "ts": now}, "junk", dict(ps, ts="soon")]
    gauge = [{"email": "g1@x.com", "topic": "rain-gauge", "ts": now - 10}, {"email": "g2@x.com", "topic": "rain-gauge", "ts": now - 20},
             {"email": "g3@x.com", "topic": "rain-gauge", "ts": old}, {"email": "g4@x.com", "topic": "rent:wi", "ts": now - 5}]
    c = tally(stored, gauge, now - DAY_MS, now)
    ck("counted by kind inside the window, mailed or not",
       c == {"rain-print-order": 2, "gift-card": 1, "rain-print-business": 1, "rain-gauge": 2, "elevator-listing": 0,
             "prf-sponsor": 0, "claim": 1, "sponsor-feedback": 0, "atlas-feedback": 0}, c)
    asked = []

    def lf(base, path, tok, body=None, **q):
        asked.append((path, q))
        return stored if path == "form-list" else gauge
    line = last24("https://w.dev", "t", lf, now)
    ck("the line reads like Sig's example",
       line == "Last 24 hours: 2 Rain Print order requests, 1 gift card redemption, 1 business quote request, 2 rain gauge "
               "waitlist, 0 elevator listing, 0 PRF sponsor, 1 elevator claim, 0 sponsor requests, 0 Parcel Report waitlist.", line)
    ck("reads every stored post and the rain gauge list", asked == [("form-list", {}), ("notice-list", {"topic": "rain-gauge"})], asked)
    ck("the line carries no address or name", "@" not in line and "Olson" not in line and "Chetek" not in line, line)

    def lbad(base, path, tok, body=None, **q):
        if path == "notice-list":
            raise urllib.error.HTTPError("https://w.dev/notice-list?token=SECRET", 500, "x", {}, None)
        return stored
    ck("a failed read says so in one line", last24("https://w.dev", "t", lbad, now) == "Last 24 hours: the counts could not be read this time.")
    m = build([claim], "s", top=line)
    t = m.get_body(("plain",)).get_content()
    h = m.get_body(("html",)).get_content()
    ck("the line is the first thing in both parts", t.startswith(line + "\n\nElevator claim, ") and h.index("Last 24 hours") < h.index("Elevator claim"), t[:200])
    ck("no line, no blank top", build([claim], "s").get_body(("plain",)).get_content().startswith("Elevator claim, "))
    calls.clear(); sent.clear()
    code, log = run("https://w.dev", "t", "s", False, sent.append, fake([claim]), top=lambda: line)
    t = sent[0].get_body(("plain",)).get_content() if sent else ""
    ck("the run puts the line on top and in the log", code == 0 and t.startswith("Last 24 hours: 2 Rain Print") and line in log, log)
    calls.clear(); sent.clear()
    code, log = run("https://w.dev", "t", "s", True, sent.append, fake([claim]), top=lambda: line)
    ck("dry run: the line is logged, nothing sent or marked", code == 0 and not sent and line in log and [c[0] for c in calls] == ["form-list"], log)
    asked_top = []
    calls.clear()
    run("https://w.dev", "t", "s", False, sent.append, fake([]), top=lambda: asked_top.append(1) or line)
    ck("nothing new: the counts are not even read", not asked_top)

    print()
    # worker v5.23: a logo prints as a link to the PNG; a malformed id is never made a link
    lp = dict(rp, logo="k3j9m2p7q8rs")
    t = build([lp], "s")
    ck("a logo is a Logo: line with its link", ("Logo: " + LOGO_URL + "k3j9m2p7q8rs") in t.get_body(("plain",)).get_content())
    ck("a logo is a link in the html", ('href="' + LOGO_URL + 'k3j9m2p7q8rs"') in t.get_body(("html",)).get_content())
    bad = build([dict(rp, logo="<b>x</b>")], "s").get_body(("html",)).get_content()
    ck("a bad logo id is no link", "<b>x</b>" not in bad and "rp-logo/&lt;" not in bad and "does not look right" in bad)
    ck("no logo, no Logo: line", "Logo:" not in build([rp], "s").get_body(("plain",)).get_content())


    print("\nhay board (worker v5.30)")
    hp = {"id": "a1b2c3d4e5", "kind": "sale", "zip": "54728", "place": "Chetek, WI", "product": "alfalfa", "cutting": "2",
          "bale": "large-square", "count": 120, "price": 85.0, "unit": "bale", "weight": 1200, "rfv": 165, "cp": 19.5,
          "delivery": 50, "note": "Barn <kept>.", "name": "Lindquist Farm", "phone": "715-555-0100", "email": "seller@example.com",
          "ts": ts, "status": "live", "reports": [], "n": 0}
    hh = dict(hp, id="f6g7h8j9k0", kind="wanted", status="hidden", why_hidden="reports", n=1,
              reports=[{"why": "spam", "ts": ts}, {"why": "scam", "ts": ts}, {"why": "spam", "ts": ts}])
    ck("hay: plain line", hay_line(hp) == "For sale: Alfalfa, 2nd cutting, 120 large squares, $85 a bale, 1200 lb bales", hay_line(hp))
    m = hay_build([hp, hh], "sig@x.com")
    t = m.get_body(("plain",)).get_content()
    h = m.get_body(("html",)).get_content()
    ck("hay: subject counts", m["Subject"] == "The Haymow: 1 new post, 1 not shown", m["Subject"])
    ck("hay: no phone or email in the mail", "715-555-0100" not in t + h and "seller@example.com" not in t + h and m["Reply-To"] is None, t)
    ck("hay: public text, status and reports", all(x in t for x in ("Where: Chetek, WI (54728)", "Test: RFV 165, CP 19.5",
       "Delivery: Up to 50 miles", "Note: Barn <kept>.", "Status: Not shown: hidden by reports", "Reports: 3 (spam, scam, spam)",
       "hay/admin/clear", "hay/admin/hide")), t)
    ck("hay: html escaped", "Barn &lt;kept&gt;." in h and "<kept>" not in h, h)
    ck("hay: the token is never written out", "tok123" not in t and "$LIST_TOKEN" in t)
    hcalls, hsent = [], []

    def hf(base, path, tok, body=None, **q):
        hcalls.append((path, body, q))
        if path == "hay/admin/list":
            return {"ok": True, "posts": [hp, hh, {"id": "<bad>"}]}
        return {"ok": True, "marked": len(body["ids"])}
    code, log = hay_run("https://w.dev", "tok123", "s", False, hsent.append, hf)
    ck("hay: one mail, marks what it sent", code == 0 and len(hsent) == 1 and hcalls[0][2] == {"new": "1"} and
       hcalls[-1][0] == "hay/admin/mark" and hcalls[-1][1] == {"ids": ["a1b2c3d4e5", "f6g7h8j9k0"]}, hcalls)
    ck("hay: log counts only", log[0] == "hay board: 1 new, 1 not shown" and not any("@" in x or "715" in x or "Lindquist" in x for x in log), log)
    hcalls.clear(); hsent.clear()
    code, log = hay_run("https://w.dev", "t", "s", True, hsent.append, hf)
    ck("hay: dry run sends and marks nothing", code == 0 and not hsent and [c[0] for c in hcalls] == ["hay/admin/list"])

    def h404(base, path, tok, body=None, **q):
        raise urllib.error.HTTPError("https://w.dev/hay/admin/list", 404, "x", {}, None)
    code, log = hay_run("https://w.dev", "t", "s", False, hsent.append, h404)
    ck("hay: an older worker is skipped cleanly", code == 0 and "v5.30" in log[0] and not hsent, log)

    def hnone(base, path, tok, body=None, **q):
        return {"ok": True, "posts": []}
    code, log = hay_run("https://w.dev", "t", "s", False, hsent.append, hnone)
    ck("hay: nothing new, no mail", code == 0 and not hsent)

    def hboom(m):
        raise smtplib.SMTPException("x")
    hcalls.clear()
    code, log = hay_run("https://w.dev", "t", "s", False, hboom, hf)
    ck("hay: send fails, nothing marked", code == 1 and [c[0] for c in hcalls] == ["hay/admin/list"])

    if fails:
        print("%d FAILED: %s" % (len(fails), "; ".join(fails)))
        return 1
    # 2026-10-17: the Rain Print options come out of the design link in plain words
    opt_url = ("https://agsist.com/rain-print?place=Ames%2C+IA&year=2012&style=r1&crop=corn&plant=2012-05-01&harvest=2012-10-20"
               "&plants=1&ghost=1&frost=1&heat=1&ribbon=1&hist=1")
    ck("rain print options in words", rp_options(opt_url) == "Corn, planted May 1, harvested Oct 20, plant drawings, against a usual year; "
       "every year behind (Staircase); frost marks; hottest and coldest day; daily temperature band", rp_options(opt_url))
    ck("no options, no line", rp_options("https://agsist.com/rain-print?place=X&year=2012") == "")
    t = build([dict(rp, design_url=opt_url)], "s").get_body(("plain",)).get_content()
    ck("the order mail lists the options", "Options: Corn, planted May 1" in t, t)
    print("form_digest: all checks pass")
    return 0


if __name__ == "__main__":
    sys.exit(main())
