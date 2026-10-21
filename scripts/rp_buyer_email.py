#!/usr/bin/env python3
"""
The Rain Print buyer's "here's your print, get ready for it" email (Sig,
2026-10-20). One email per paid Checkout Session, phone first, from the same
Gmail sending path the site's other jobs use (SMTP_USER / SMTP_PASS), with
Reply-To sig@farmers1st.com.

  Which orders  the subs worker's GET /rp-order/list (Bearer LIST_TOKEN): the
                presses of Pay on /rain-print the worker has matched to a
                paid Checkout Session with its STRIPE_READ_KEY, not yet
                mailed. Without that match nothing is sent.
  The address   the worker reads that one Checkout Session from Stripe at
                send time (GET /rp-order/buyer; the read-only key lives on the
                worker alone) and hands back customer_details.email. Never
                stored, never printed: the log says counts only.
  What it says  what was bought (product, town, year, style); the proof, a
                picture of the exact design the page itself makes (the
                watermarked preview, attached inline, so nothing is hosted);
                for a print or framed print the letter that goes in the box,
                with the gift note from the order form when there is one,
                as it will print; what happens next and when, in the thank-you
                page's own words (RainPrint.paidText, from the business days
                in data/rain-print.json); "Something wrong? Reply to this
                email."
  Sig's alert   first, every paid record not yet alerted: one plain email to
                Sig (product, town year style, gift, amount, serial, the
                "Open to fulfill" maker link, the buyer's address as Stripe
                sent it), marked alerted first, dry run or not. A paid
                session comes in by Stripe's webhook (worker v5.36, which
                also starts this job at once) or by the worker's poll.
  Once only     the record is marked mailed (POST /rp-order/mailed) BEFORE the
                send, so a crash or a rerun can never send it twice; a send
                that fails after the mark is counted in the log for Sig.
  Sig only      DRY_RUN=1 sends every email to Sig (SIG_TO, default
                sig@farmers1st.com) and marks nothing. A test-mode session
                (livemode false) or a buyer address in SIG_TEST_EMAILS (and
                SIG_TO) goes to Sig only.
  The files     (Sig, 2026-10-20) a paid DIGITAL file the buyer has approved
                (the Approve this print button starts this job, worker
                v5.37) gets a second email at once: "Your Rain Print files:
                <town>, <year>", with the files attached (the PDF of the art at
                12 x 18 in, the PNG and the JPG at 5400 x 3600 px, 300 dpi, no
                watermark, made by the maker view: rp_buyer_render.mjs
                renderFiles), the one-page "How to read your Rain Print" PDF
                (with the gift note when there is one) and short printing
                tips. Attached, not linked: the four come to about 2 to 4 MB,
                far under Gmail's 25 MB, and nothing about an order is hosted
                anywhere. Over ATTACH_MAX the JPG, then the PNG, are left off;
                if even the PDF and guide are over, no buyer email goes, the
                record is marked delivered by hand and Sig is told to send them.
                Marked delivered (POST /rp-order/delivered, worker v5.38)
                BEFORE the send, like mailed: once per order. Sig gets a
                one-line note that the files went (no buyer details). Prints
                and framed prints keep their flow. Dry run: to Sig, nothing
                marked, same as the proof.
  The gift card (Sig, 2026-10-20: "the gift card option should provide
                explanation as to what the receiver is getting and how to
                redeem easily"; no more card links sent by hand) a paid
                this-year gift (ref GIFT-..., the print made in January) gets
                its card at once: issued through the worker's POST
                /rp-gift/issue {order_key} (Bearer LIST_TOKEN, worker v5.40:
                once per order, the code kept on the order, a second call
                answers the same card; locked to the design, set at issue, as
                the address was given at Stripe checkout), then "Your Rain
                Print gift card for <to>" to the buyer, the ONE email a
                this-year gift gets (the lead, 2026-10-20: the proof email's
                "year so far" picture is folded in under the card, and the
                order is marked mailed too, so the proof loop never sends it
                a second email): the card link
                (/rp-gift?c=...&k=...) as a big Print the gift card button,
                the card at a glance, what the receiver gets, how they use it
                (scan the square or agsist.com/rain-print?gift=CODE; nothing
                to fill in; never expires), when it comes (January, a proof
                first) and tips for printing the card. Marked gift-mailed
                (POST /rp-order/gift-mailed) BEFORE the send: once per order.
                Sig gets a one-line note (card number, no buyer details). Dry
                run: nothing issued or marked, the email to Sig with a
                stand-in code. The words for the card ("for", the message)
                come from the order form post, like the gift note.

    python3 scripts/rp_buyer_email.py              send what is due
    DRY_RUN=1 python3 scripts/rp_buyer_email.py    every email to Sig, nothing marked
    python3 scripts/rp_buyer_email.py --selftest   fixtures, no network, no mail
    python3 scripts/rp_buyer_email.py --sample out.html   the email as a page (made-up order), for a look
    python3 scripts/rp_buyer_email.py --sample-files out.html   the files email as a page, for a look
    python3 scripts/rp_buyer_email.py --sample-gift out.html   the gift card email as a page, for a look

Env: LIST_URL, LIST_TOKEN, SMTP_USER, SMTP_PASS. Optional:
SMTP_HOST, SMTP_PORT, FROM_ADDR, FROM_NAME (Sig's own alerts only), RP_FROM_NAME
(the buyer emails' sender name, default "Sig at AGSIST"; Sig 2026-10-20. The shared
FROM_NAME secret serves a dozen other jobs and never decides it), SIG_TO, SIG_TEST_EMAILS (comma
separated), RENDER_BASE (default https://agsist.com), PLAYWRIGHT_PATH,
CHROMIUM_PATH. Run by .github/workflows/rp-buyer-email.yml.
"""
import base64
import html as H
import json
import os
import re
import smtplib
import ssl
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from email.message import EmailMessage
from email.utils import formataddr, make_msgid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import log_safe  # noqa: E402  sender_addr: the From line, SES-safe

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPLY_TO = "sig@farmers1st.com"
ADDRESS = "AGSIST, PO Box 243, Chetek, WI 54728"
PRODUCT = {"digital": "digital file", "print12x18": "13 x 19 print", "framed12x18": "13 x 19 framed print"}
STYLE = {"r1": "Staircase", "r2": "Roots"}
EMAIL_RE = re.compile(r"^[^\s@<>\"]+@[^\s@<>\"]+\.[^\s@<>\"]{2,}$")
URL_RE = re.compile(r"^https://agsist\.com/rain-print\?[A-Za-z0-9%+._~=&-]+$")
DAYS = 7
# the most the files email attaches, in bytes before encoding (base64 adds about a third: 15 MB is about
# 20.5 MB sent, under Gmail's 25 MB with room to spare). A real order's four files come to about 2 to 4 MB.
ATTACH_MAX = 15 * 1024 * 1024
BUYER_FROM_NAME = "Sig at AGSIST"


def buyer_from_name():
    """The sender name on every buyer email (the proof, the files): RP_FROM_NAME, else "Sig at AGSIST". Never FROM_NAME."""
    return one_line(env("RP_FROM_NAME", BUYER_FROM_NAME), 60) or BUYER_FROM_NAME
FILE_MIME = {"pdf": ("application", "pdf"), "guide": ("application", "pdf"), "png": ("image", "png"), "jpg": ("image", "jpeg")}


def env(name, default=None):
    v = os.environ.get(name)
    return v if v not in (None, "") else default


def one_line(v, cap):
    return " ".join(str(v or "").split())[:cap]


# ───────────────────────────── sources ─────────────────────────────

class Sources:
    """Every outside call goes through here, so the selftest can hand in fixtures."""

    def __init__(self, list_url="", list_token=""):
        u = urllib.parse.urlsplit((list_url or "").strip())
        self.base = "%s://%s" % (u.scheme, u.netloc) if u.scheme and u.netloc else ""
        self.token = (list_token or "").strip()

    def _req(self, url, headers, body=None):
        data = json.dumps(body).encode() if body is not None else None
        h = dict({"User-Agent": "agsist-rp-buyer-email"}, **headers)
        if data is not None:
            h["Content-Type"] = "application/json"
        with urllib.request.urlopen(urllib.request.Request(url, data=data, headers=h), timeout=30) as r:
            return json.loads(r.read().decode())

    def worker(self, path, body=None, **q):
        if not (self.base and self.token):
            raise LookupError("no LIST_URL / LIST_TOKEN")
        url = "%s/%s%s" % (self.base, path, ("?" + urllib.parse.urlencode(q)) if q else "")
        return self._req(url, {"Authorization": "Bearer %s" % self.token}, body)

    def session(self, key):
        """The paid record's Checkout Session, read by the worker from Stripe now (GET /rp-order/buyer):
        only livemode and the buyer's address. The read-only Stripe key lives on the worker alone."""
        d = self.worker("rp-order/buyer", key=key)
        if not d.get("ok"):
            raise LookupError("not readable")
        return {"livemode": d.get("livemode") is not False, "email": str(d.get("email") or "").strip()}

    def render(self, order, out_dir):
        """scripts/rp_buyer_render.mjs: proof.jpg, letter.jpg (or none) and the next-steps words."""
        inp = os.path.join(out_dir, "in.json")
        with open(inp, "w", encoding="utf-8") as f:
            json.dump({"design_url": order["design_url"], "product": order["product"], "gift": bool(order.get("gift")),
                       "gift_note": order.get("gift_note") or "", "base": env("RENDER_BASE", "https://agsist.com")}, f)
        p = subprocess.run(["node", os.path.join(ROOT, "scripts", "rp_buyer_render.mjs"), inp, out_dir],
                           capture_output=True, text=True, timeout=240)
        last = (p.stdout.strip().splitlines() or ["{}"])[-1]
        r = json.loads(last)
        if not r.get("ok"):
            raise RuntimeError("render: %s" % r.get("error", "failed"))
        return r

    def render_files(self, order, out_dir):
        """rp_buyer_render.mjs renderFiles: the digital file's PDF, PNG, JPG and the reading guide, checked there.
        -> [{kind, path, name, bytes}]"""
        inp = os.path.join(out_dir, "in.json")
        with open(inp, "w", encoding="utf-8") as f:
            json.dump({"design_url": order["design_url"], "product": order["product"], "files": True,
                       "gift_note": order.get("gift_note") or "", "base": env("RENDER_BASE", "https://agsist.com")}, f)
        p = subprocess.run(["node", os.path.join(ROOT, "scripts", "rp_buyer_render.mjs"), inp, out_dir],
                           capture_output=True, text=True, timeout=420)
        last = (p.stdout.strip().splitlines() or ["{}"])[-1]
        r = json.loads(last)
        if not r.get("ok") or [x.get("kind") for x in r.get("files") or []] != ["pdf", "png", "jpg", "guide"]:
            raise RuntimeError("render files: %s" % r.get("error", "failed"))
        return r["files"]


# ───────────────────────────── the email ─────────────────────────────

def what_line(o):
    place = one_line(o.get("place"), 80)
    style = STYLE.get(o.get("style"), "")
    year = str(o.get("year") or "")
    return "%s of %s%s%s" % (PRODUCT.get(o.get("product"), "Rain Print"), place or "your place",
                             (", " + year) if year else "", (", " + style) if style else "")


def subject(o):
    place, year = one_line(o.get("place"), 80), str(o.get("year") or "")
    return "Your Rain Print proof: %s%s" % (place or "your place", (", " + year) if year else "")


def next_lines(words):
    """The thank-you page's lines, without its last one (the reply line below says it)."""
    w = [one_line(x, 400) for x in (words or []) if one_line(x, 400)]
    return w[:-1] if len(w) > 1 else w


APPROVE_BASE = "https://agsist.com/rain-print-approve"


def can_approve(o, r):
    """A proof to approve: the full year is in (not a preview) and the worker gave the record its token."""
    return bool(o.get("approve_t")) and not r.get("preview")


def approve_url(o):
    return "%s?k=%s&t=%s" % (APPROVE_BASE, urllib.parse.quote(o["key"], safe=""), urllib.parse.quote(o["approve_t"], safe=""))


def change_url(o):
    return "mailto:%s?subject=%s" % (REPLY_TO, urllib.parse.quote("Change to my Rain Print (ref %s)" % one_line(o.get("ref"), 200)))


def proof_lines(o, r):
    """What the buyer does with this proof, and what happens after. The email is the proof (Sig, 2026-10-20)."""
    digital = o.get("product") == "digital"
    if not can_approve(o, r):
        # a year not finished (this year's gift, or last year before NOAA has December): the proof comes later
        return ["This picture shows the year so far. Your proof comes by email once the full year is in, and you approve it then."] + \
            [x for x in next_lines(r.get("words")) if "proof" not in x.lower()]
    out = ["This email is your proof. Check the name, the town, the year and the dates in the picture.",
           "If it is right, tap Approve this print. If not, tap Ask for a change and tell me what to fix. Nothing is made until you approve it."]
    if digital:
        out.append("After you approve it, your files come by email within minutes: a PDF, a PNG and a JPG at 12 x 18 in, 300 dpi, no preview mark, "
                   "with a page on how to read it.")
    else:
        ship = [x for x in (r.get("words") or []) if str(x).startswith("It ships within")]
        out.append(one_line(ship[0], 300) if ship else "It ships within 3 business days after you approve it.")
    return out


def text_body(o, r, gift_to=""):
    out = ["Thank you for ordering a Rain Print.", "", "You ordered: a %s." % what_line(o)]
    if gift_to:
        out.append("For: %s" % gift_to)
    out += ["", "Your design is in the picture in this email, as you ordered it. The picture carries a preview mark; your %s will not."
            % ("file" if o.get("product") == "digital" else "print")]
    if r.get("letter"):
        out += ["", "The letter in the box: it goes on top of the print, %s, exactly as it will print. The picture of it is in this email."
                % ("with your note" if o.get("gift_note") else "so whoever opens it knows what it is")]
    out += [""] + proof_lines(o, r)
    if can_approve(o, r):
        out += ["", "Approve this print: %s" % approve_url(o), "Ask for a change: reply to this email, or write to %s" % REPLY_TO]
    out += ["", "Something wrong? Reply to this email and I will fix it.", "", "Sig", "", ADDRESS]
    return "\n".join(out) + "\n"


def button(href, label, bg, fg, border):
    """A button that holds in Gmail and Outlook: a table cell with the color, the link filling it."""
    return ('<table role="presentation" width="100%%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 12px;"><tr>'
            '<td align="center" bgcolor="%s" style="background:%s;border:2px solid %s;border-radius:8px;">'
            '<a href="%s" style="display:block;padding:16px 12px;font-family:Arial,Helvetica,sans-serif;font-size:18px;font-weight:bold;'
            'line-height:1.2;color:%s;text-decoration:none;border-radius:8px;">%s</a></td></tr></table>') % (bg, bg, border, H.escape(href), fg, H.escape(label))


def html_body(o, r, gift_to="", srcs=None):
    """Phone first, Gmail safe: one 600 px table, inline styles only, images by cid (or srcs for a sample)."""
    srcs = srcs or {"proof": "cid:proof", "letter": "cid:letter"}
    e = H.escape
    font = "font-family:Georgia,'Times New Roman',serif;"
    p = lambda t, extra="": ('<p style="margin:0 0 14px;%sfont-size:17px;line-height:1.5;color:#1E2125;%s">%s</p>' % (font, extra, t))  # noqa: E731
    ok = can_approve(o, r)
    rows = []
    rows.append('<tr><td style="padding:24px 20px 6px;"><p style="margin:0 0 6px;font-family:Arial,Helvetica,sans-serif;font-size:13px;'
                'letter-spacing:1px;text-transform:uppercase;color:#5E6475;">AGSIST Rain Print%s</p>' % (" &middot; your proof" if ok else "")
                + '<h1 style="margin:0 0 14px;%sfont-size:26px;line-height:1.25;font-weight:normal;color:#1E2125;">%s</h1>'
                % (font, "Your proof: check it and approve it" if ok else "Here is your Rain Print")
                + p("Thank you for ordering. You ordered a <b>%s</b>." % e(what_line(o)))
                + (p("For: <b>%s</b>" % e(gift_to)) if gift_to else "") + "</td></tr>")
    note = "The picture carries a preview mark; your %s will not." % ("file" if o.get("product") == "digital" else "print")
    rows.append('<tr><td style="padding:4px 20px 18px;"><img src="%s" width="560" alt="Your Rain Print design: %s" '
                'style="display:block;width:100%%;max-width:560px;height:auto;border:1px solid #D6D9D2;">'
                '<p style="margin:8px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.45;color:#5E6475;">'
                'Your design, as you ordered it. %s</p></td></tr>' % (e(srcs["proof"]), e(what_line(o)), e(note)))
    if r.get("letter"):
        lead = ("The letter in the box goes on top of the print, with your note, exactly as it will print."
                if o.get("gift_note") else "The letter in the box goes on top of the print, so whoever opens it knows what it is. This is it, as it will print.")
        rows.append('<tr><td style="padding:0 20px 18px;">' + p(e(lead)) +
                    '<img src="%s" width="420" alt="The letter that goes in the box" style="display:block;width:100%%;max-width:420px;'
                    'height:auto;margin:0 auto;border:1px solid #D6D9D2;"></td></tr>' % e(srcs["letter"]))
    lines = proof_lines(o, r)
    rows.append('<tr><td style="padding:0 20px 8px;"><h2 style="margin:0 0 10px;%sfont-size:20px;font-weight:normal;color:#1E2125;">%s</h2>'
                % (font, "Your sign-off" if ok else "What happens next") + "".join(p(e(x)) for x in lines[:2 if ok else len(lines)]) + "</td></tr>")
    if ok:
        rows.append('<tr><td style="padding:0 20px 10px;">' + button(approve_url(o), "Approve this print", "#1F6B3A", "#FFFFFF", "#1F6B3A")
                    + button(change_url(o), "Ask for a change", "#FFFFFF", "#1E2125", "#1E2125") + "</td></tr>")
        rows.append('<tr><td style="padding:0 20px 8px;">' + "".join(p(e(x)) for x in lines[2:]) + "</td></tr>")
    rows.append('<tr><td style="padding:0 20px 24px;">' + p("<b>Something wrong?</b> Reply to this email and I will fix it.")
                + p("Sig", "margin-top:18px;") +
                '<p style="margin:18px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.4;color:#5E6475;">%s</p></td></tr>'
                % e(ADDRESS))
    return ('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            '<title>%s</title></head><body style="margin:0;padding:0;background:#F4F3EE;">'
            '<table role="presentation" width="100%%" cellpadding="0" cellspacing="0" border="0" style="background:#F4F3EE;"><tr><td align="center" style="padding:12px 8px;">'
            '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%%;max-width:600px;background:#FFFFFF;">'
            '%s</table></td></tr></table></body></html>') % (e(subject(o)), "".join(rows))


def build(o, r, to, gift_to="", fn=None, fa="", dry=False):
    fn = fn or buyer_from_name()
    m = EmailMessage()
    m.rp_buyer = True   # smtp_send keeps this name (Sig's alerts take FROM_NAME)
    m["Subject"] = ("[dry run, would go to the buyer] " if dry else "") + subject(o)
    m["From"] = formataddr((fn, fa))
    m["To"] = to
    m["Reply-To"] = REPLY_TO
    m["Message-ID"] = make_msgid(domain=(fa.split("@", 1)[1] if "@" in fa else "agsist.com"))
    m.set_content(text_body(o, r, gift_to))
    m.add_alternative(html_body(o, r, gift_to), subtype="html")
    rel = m.get_payload()[1]
    for cid, path in (("proof", r.get("proof")), ("letter", r.get("letter"))):
        if path:
            with open(path, "rb") as f:
                rel.add_related(f.read(), maintype="image", subtype="jpeg", cid="<%s>" % cid,
                                filename="%s.jpg" % ("rain-print-design" if cid == "proof" else "rain-print-letter"), disposition="inline")
    return m


# ───────────────────────────── the files email (a digital file, on approval) ─────────────────────────────

def files_subject(o):
    place, year = one_line(o.get("place"), 80), str(o.get("year") or "")
    return "Your Rain Print files: %s%s" % (place or "your place", (", " + year) if year else "")


FILE_WORDS = {
    "pdf": "the print file: 12 x 18 in at 300 dpi. Send this one to a print shop.",
    "png": "the same picture, 5400 x 3600 px at 300 dpi. Good for an online photo or poster service.",
    "jpg": "the same again as a JPG, for a service that takes only JPG.",
    "guide": "one page on how to read your print. Print it on letter paper and give it with the print, or tuck it in the back of the frame.",
}

# short and plain; every size here is the file's own (5400 x 3600 px is 300 dpi at 18 x 12 in, 225 dpi at 24 x 16)
PRINT_TIPS = [
    "It is made for 12 x 18 in. A print shop or an online print service can print that size, and a standard 12 x 18 frame fits it.",
    "Print the PDF at 100% (Actual size). Turn off Fit to page and Scale to fit, or the size comes out wrong.",
    "Pick a heavy matte paper. Glossy shows glare, and more behind glass. I print mine on heavy textured cotton paper.",
    "Another size? Keep the 3:2 shape so nothing is cut off: 8 x 12 or 16 x 24 in. Both stay sharp.",
    "At home: letter paper is too small for 12 x 18. Print the PNG at 10.5 x 7 in for a small one, or use a printer that takes 13 x 19 paper and print the PDF at 100%.",
    "Want a mat? An 18 x 24 frame with a mat cut for a 12 x 18 print is a common size.",
]


def files_lead(o, files):
    left = [k for k in ("png", "jpg") if k not in {f["kind"] for f in files}]
    out = ["Thank you for approving your proof. Your Rain Print files are attached: the %s, ready to print, with no preview mark." % what_line(o)]
    if left:
        out.append("The %s %s too big to attach with the rest. Reply to this email and I will send %s." % (
            " and the ".join(x.upper() for x in left), "was" if len(left) == 1 else "were", "it" if len(left) == 1 else "them"))
    return out


def files_text(o, files, gift_to=""):
    out = files_lead(o, files)[:1]
    if gift_to:
        out.append("For: %s" % gift_to)
    out += files_lead(o, files)[1:] + ["", "What is attached:"]
    out += ["  %s: %s" % (f["name"], FILE_WORDS[f["kind"]]) for f in files]
    out += ["", "Printing it:"] + ["  - " + t for t in PRINT_TIPS]
    out += ["", "Something wrong, or want a change? Reply to this email and I will fix it.", "", "Sig", "", ADDRESS]
    return "\n".join(out) + "\n"


def files_html(o, files, gift_to=""):
    """Phone first, Gmail safe, like the proof email: one 600 px table, inline styles only, no images."""
    e = H.escape
    font = "font-family:Georgia,'Times New Roman',serif;"
    sans = "font-family:Arial,Helvetica,sans-serif;"
    p = lambda t, extra="": ('<p style="margin:0 0 14px;%sfont-size:17px;line-height:1.5;color:#1E2125;%s">%s</p>' % (font, extra, t))  # noqa: E731
    lead = files_lead(o, files)
    rows = ['<tr><td style="padding:24px 20px 6px;"><p style="margin:0 0 6px;%sfont-size:13px;letter-spacing:1px;text-transform:uppercase;color:#5E6475;">'
            'AGSIST Rain Print &middot; your files</p>' % sans
            + '<h1 style="margin:0 0 14px;%sfont-size:26px;line-height:1.25;font-weight:normal;color:#1E2125;">Your Rain Print files</h1>' % font
            + p(e(lead[0]).replace(e(what_line(o)), "<b>%s</b>" % e(what_line(o))))
            + (p("For: <b>%s</b>" % e(gift_to)) if gift_to else "") + "".join(p(e(x)) for x in lead[1:]) + "</td></tr>"]
    items = "".join('<tr><td style="padding:0 0 12px;%sfont-size:15px;line-height:1.45;color:#1E2125;"><b style="word-break:break-all;">%s</b><br>%s</td></tr>'
                    % (sans, e(f["name"]), e(FILE_WORDS[f["kind"]][0].upper() + FILE_WORDS[f["kind"]][1:])) for f in files)
    rows.append('<tr><td style="padding:0 20px 12px;"><h2 style="margin:0 0 10px;%sfont-size:20px;font-weight:normal;color:#1E2125;">What is attached</h2>'
                '<table role="presentation" width="100%%" cellpadding="0" cellspacing="0" border="0">%s</table></td></tr>' % (font, items))
    tips = "".join('<li style="margin:0 0 10px;">%s</li>' % e(t) for t in PRINT_TIPS)
    rows.append('<tr><td style="padding:0 20px 8px;"><h2 style="margin:0 0 10px;%sfont-size:20px;font-weight:normal;color:#1E2125;">Printing it</h2>'
                '<ul style="margin:0 0 14px;padding:0 0 0 20px;%sfont-size:16px;line-height:1.5;color:#1E2125;">%s</ul></td></tr>' % (font, font, tips))
    rows.append('<tr><td style="padding:0 20px 24px;">' + p("<b>Something wrong, or want a change?</b> Reply to this email and I will fix it.")
                + p("Sig", "margin-top:18px;") +
                '<p style="margin:18px 0 0;%sfont-size:12px;line-height:1.4;color:#5E6475;">%s</p></td></tr>' % (sans, e(ADDRESS)))
    return ('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            '<title>%s</title></head><body style="margin:0;padding:0;background:#F4F3EE;">'
            '<table role="presentation" width="100%%" cellpadding="0" cellspacing="0" border="0" style="background:#F4F3EE;"><tr><td align="center" style="padding:12px 8px;">'
            '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%%;max-width:600px;background:#FFFFFF;">'
            '%s</table></td></tr></table></body></html>') % (e(files_subject(o)), "".join(rows))


def fit_files(files):
    """The files that go, under ATTACH_MAX: all four; else without the JPG; else without the PNG too; else none."""
    for drop in ((), ("jpg",), ("jpg", "png")):
        keep = [f for f in files if f["kind"] not in drop]
        if sum(int(f.get("bytes") or 0) for f in keep) <= ATTACH_MAX:
            return keep
    return []


def build_files(o, files, to, gift_to="", fn=None, fa="", dry=False):
    fn = fn or buyer_from_name()
    m = EmailMessage()
    m.rp_buyer = True
    m["Subject"] = ("[dry run, would go to the buyer] " if dry else "") + files_subject(o)
    m["From"] = formataddr((fn, fa))
    m["To"] = to
    m["Reply-To"] = REPLY_TO
    m["Message-ID"] = make_msgid(domain=(fa.split("@", 1)[1] if "@" in fa else "agsist.com"))
    m.set_content(files_text(o, files, gift_to))
    m.add_alternative(files_html(o, files, gift_to), subtype="html")
    for f in files:
        mt, st = FILE_MIME[f["kind"]]
        with open(f["path"], "rb") as fh:
            m.add_attachment(fh.read(), maintype=mt, subtype=st, filename=f["name"])
    return m


def sig_note(o, sig_to, text, fn="AGSIST", fa=""):
    """Sig's one-line note about the files: product, town and year only, never the buyer."""
    m = EmailMessage()
    m["Subject"] = "Rain Print files sent: %s%s" % (one_line(o.get("place"), 60) or "a digital file", (" " + str(o["year"])) if o.get("year") else "")
    m["From"] = formataddr((fn, fa))
    m["To"] = sig_to
    m["Message-ID"] = make_msgid(domain=(fa.split("@", 1)[1] if "@" in fa else "agsist.com"))
    m.set_content(text + "\n")
    return m


def files_due(orders):
    """Paid digital files the buyer approved, not yet delivered, with a design link to make them from."""
    return [o for o in orders if o.get("status") == "paid" and o.get("product") == "digital" and o.get("approved")
            and not o.get("delivered") and (o.get("paid") or {}).get("session") and URL_RE.match(str(o.get("design_url") or ""))]


def deliver(src, due, notes, dry, send, sig_to, test_emails):
    """The files email for each approved digital file, once (marked delivered before the send). -> counts."""
    c = {"files sent": 0, "files to Sig": 0, "files waiting": 0, "files no address": 0, "files render failed": 0,
         "files by hand": 0, "files marked, send failed": 0}
    for o in due:
        if notes is None:
            c["files waiting"] += 1
            continue
        gift_to, note = notes.get(o["ref"], ("", ""))
        o = dict(o, gift_note=note)
        try:
            s = src.session(o["key"])
        except Exception:                                  # noqa: BLE001
            c["files no address"] += 1
            continue
        buyer = s["email"] if EMAIL_RE.match(s["email"]) else ""
        sig_only = dry or not s["livemode"] or buyer.lower() in test_emails
        if not buyer and not sig_only:
            c["files no address"] += 1
            continue
        with tempfile.TemporaryDirectory() as tmp:
            try:
                files = src.render_files(o, tmp)
            except Exception:                              # noqa: BLE001
                c["files render failed"] += 1              # nothing marked: the next run tries again
                continue
            keep = fit_files(files)
            if not keep:
                # too big to attach even as the PDF and the guide: Sig sends them, told once
                if not dry:
                    mk = src.worker("rp-order/delivered", body={"key": o["key"], "how": "hand"})
                    if not mk.get("ok") or mk.get("already"):
                        continue
                c["files by hand"] += 1
                try:
                    send(sig_note(o, sig_to, "The files for this approved digital file are too big to attach. Make them on the maker page and send them by hand: %s"
                                  % (o.get("fulfill_url") or "no design link")))
                except Exception:                          # noqa: BLE001
                    c["files marked, send failed"] += 1
                continue
            m = build_files(o, keep, sig_to if sig_only else buyer, gift_to, dry=dry)
            if not dry:
                mk = src.worker("rp-order/delivered", body={"key": o["key"], "how": "email"})
                if not mk.get("ok") or mk.get("already"):
                    continue
            try:
                send(m)
            except Exception:                              # noqa: BLE001
                c["files marked, send failed" if not dry else "files render failed"] += 1
                continue
            if sig_only:
                c["files to Sig"] += 1
                continue
            c["files sent"] += 1
            mb = sum(int(f.get("bytes") or 0) for f in keep) / 1048576.0
            try:
                send(sig_note(o, sig_to, "The files went to the buyer by email (%s; %.1f MB attached)." % (", ".join(
                    {"pdf": "PDF", "png": "PNG", "jpg": "JPG", "guide": "reading guide"}[f["kind"]] for f in keep), mb)))
            except Exception:                              # noqa: BLE001
                pass                                       # the buyer has the files; the note is a courtesy
    return c


# ───────────────────────────── the gift card email (a this-year gift, at once) ─────────────────────────────

CARD_BASE = "https://agsist.com/rp-gift"
REDEEM_BASE = "agsist.com/rain-print?gift="
DRY_CODE = "RP-XXXX-XXXX-XXXX"
# what the receiver gets, in plain words (the card's own words, rp-gift.html COMING)
GIFT_WHAT = {
    "framed12x18": "A framed Rain Print: the whole year printed on 13 x 19 heavy, textured cotton paper, in a black frame with a white mat and glass, ready to hang. Shipping is included.",
    "print12x18": "A Rain Print: the whole year printed on 13 x 19 heavy, textured cotton fine-art paper, shipped flat and ready to frame. Shipping is included.",
    "digital": "The Rain Print digital file: the whole year as a PDF, a PNG and a JPG at 12 x 18 in, 300 dpi, to print anywhere, with a page on how to read it.",
}
CARD_TIPS = [
    "Tap Print the gift card. The card opens in your browser; pick a size, then tap Print the card.",
    "Sizes: an 8 x 10 card (the one with the picture), 8 x 10 on letter paper with light cut marks, a 5 x 7 card, half letter two up (cut or fold on the middle), or a full letter page.",
    "Print at 100% (Actual size). Turn off Fit to page and Scale to fit, or the card comes out the wrong size.",
    "Card stock looks best; plain paper works. The 5 x 7 card fits an A7 envelope.",
    "Need it again? The same button works any time, so keep this email.",
]


def ship_days():
    """data/rain-print.json ship_business_days (the page's own promise), 3 if it can't be read."""
    try:
        with open(os.path.join(ROOT, "data", "rain-print.json"), encoding="utf-8") as f:
            n = json.load(f).get("ship_business_days")
        return n if isinstance(n, int) and 0 < n < 30 else 3
    except Exception:                                      # noqa: BLE001
        return 3


def is_gift_card_order(o):
    """A this-year gift (ref GIFT-...): its one email is the gift card email, with the print so far in it."""
    return bool(o.get("gift")) and str(o.get("ref") or "").startswith("GIFT-")


def gift_due(orders):
    """Paid this-year gifts whose card email has not gone yet."""
    return [o for o in orders if o.get("status") == "paid" and is_gift_card_order(o)
            and not o.get("gift_mailed") and (o.get("paid") or {}).get("session") and o.get("product") in PRODUCT]


def gift_subject(o, to=""):
    to = one_line(to, 60)
    return "Your Rain Print gift card for %s" % to if to else "Your Rain Print gift card, ready to print"


def gift_redeem(card):
    """agsist.com/rain-print?gift=CODE, as the card prints it."""
    return REDEEM_BASE + card["code"]


def gift_parts(o, card, to=""):
    """The email's words, shared by the text and the HTML: (lead, what, how, when). Never a price."""
    place = one_line(o.get("place"), 80) or "your place"
    year = int(o.get("year") or 0) or None
    who = one_line(to, 60)
    digital = o.get("product") == "digital"
    lead = ("Thank you. Here is the gift card for %s: a Rain Print of %s%s. Print it and put it under the tree; the %s follows in January."
            % (who or "your gift", place, (", %d" % year) if year else "", "file" if digital else "print"))
    what = [GIFT_WHAT.get(o.get("product"), "One Rain Print of the whole year."),
            "It shows every rain and snow of %s at the NOAA weather station nearest %s, day by day, from the design you made." % (year or "the year", place.split(",")[0])]
    if card.get("prepaid", True):
        how = ["There is nothing for %s to fill in or pay. It is paid for, and %s to %s."
               % (who or "them", "the files come by email" if digital else "it ships", "you" if digital else "the address you gave at checkout"),
               "To see the print so far, scan the square on the card with a phone camera, or go to %s. The code never expires." % gift_redeem(card)]
    else:
        how = ["Scan the square on the card with a phone camera, or go to %s." % gift_redeem(card),
               ("The design is already picked; add where it goes and press Use my gift." if card.get("locked", True)
                else "Pick the farm and the year, then press Use my gift."),
               "The code never expires. It can be used once."]
    nxt = (year + 1) if year else None
    when = ["The %s%s is made once the full year is in, in January%s. NOAA needs December's numbers first." % (
        ("%d " % year) if year else "", "file" if digital else "print", (" %d" % nxt) if nxt else "")]
    if digital:
        when.append("I email you a proof then. Approve it, and the files come by email within minutes.")
    else:
        when.append("I email you a proof then, and nothing is made until you approve it. It ships within %d business days after you approve it." % ship_days())
    return lead, what, how, when


SO_FAR = ["The print so far, from your design: every rain from January 1 to the last day NOAA has, the months to come left pale.",
          "The picture carries a preview mark; the print will not. Check the name, the town and the dates; if anything is wrong, reply and I will fix it."]


def gift_text(o, card, to="", note="", pic=False):
    lead, what, how, when = gift_parts(o, card, to)
    out = [lead, "", "Print the gift card: %s" % card["card_url"], "", "On the card: " + card_desc(o, card, to, note), ""]
    if pic:
        out += ["The print so far (the picture in this email):"] + ["  " + x for x in SO_FAR] + [""]
    out += ["What they get:"] + ["  " + x for x in what] + ["", "How they use it:"] + ["  " + x for x in how]
    out += ["", "When it comes:"] + ["  " + x for x in when] + ["", "Printing the card:"] + ["  - " + t for t in CARD_TIPS]
    out += ["", "Something wrong, or a name to fix on the card? Reply to this email and I will fix it.", "", "Sig", "", ADDRESS]
    return "\n".join(out) + "\n"


def card_desc(o, card, to="", note=""):
    """The card in one sentence: what is on it."""
    bits = ["For %s" % one_line(to, 60)] if to else []
    bits.append("the print so far (every rain from January 1 to the last day NOAA has)")
    if note:
        bits.append("your message")
    bits.append("a square to scan and the code %s" % card["code"])
    return ", ".join(bits[:-1]) + ", and " + bits[-1] + "."


def gift_html(o, card, to="", note="", pic=""):
    """Phone first, Gmail safe, like the proof email: one 600 px table, inline styles only, no images."""
    e = H.escape
    font = "font-family:Georgia,'Times New Roman',serif;"
    sans = "font-family:Arial,Helvetica,sans-serif;"
    p = lambda t, extra="": ('<p style="margin:0 0 14px;%sfont-size:17px;line-height:1.5;color:#1E2125;%s">%s</p>' % (font, extra, t))  # noqa: E731
    h2 = lambda t: '<h2 style="margin:0 0 10px;%sfont-size:20px;font-weight:normal;color:#1E2125;">%s</h2>' % (font, e(t))  # noqa: E731
    lead, what, how, when = gift_parts(o, card, to)
    place = one_line(o.get("place"), 80)
    year = str(o.get("year") or "")
    rows = ['<tr><td style="padding:24px 20px 6px;"><p style="margin:0 0 6px;%sfont-size:13px;letter-spacing:1px;text-transform:uppercase;color:#5E6475;">'
            'AGSIST Rain Print &middot; your gift card</p>' % sans
            + '<h1 style="margin:0 0 14px;%sfont-size:26px;line-height:1.25;font-weight:normal;color:#1E2125;">Your gift card is ready to print</h1>' % font
            + p(e(lead)) + "</td></tr>"]
    rows.append('<tr><td style="padding:0 20px 6px;">' + button(card["card_url"], "Print the gift card", "#1F6B3A", "#FFFFFF", "#1F6B3A")
                + '<p style="margin:0 0 16px;%sfont-size:14px;line-height:1.45;color:#5E6475;">The button opens the card; pick a size and print it. Tips are below.</p></td></tr>' % sans)
    # the card at a glance: what is on it, drawn plainly (no image to load)
    face = ('<p style="margin:0 0 4px;%sfont-size:11px;letter-spacing:1px;text-transform:uppercase;color:#5E6475;">A Rain Print from AGSIST</p>' % sans
            + ('<p style="margin:0 0 6px;%sfont-size:22px;font-style:italic;color:#1E2125;">For %s</p>' % (font, e(one_line(to, 60))) if to else "")
            + '<p style="margin:0 0 8px;%sfont-size:15px;color:#1E2125;">%s%s</p>' % (sans, e(place or "Your place"), (" &middot; " + e(year)) if year else "")
            + '<p style="margin:0 0 8px;%sfont-size:14px;line-height:1.45;color:#5E6475;">The print so far, every rain from January 1 to the last day NOAA has; the months to come are pale.</p>' % sans
            + ('<p style="margin:0 0 8px;%sfont-size:15px;line-height:1.45;color:#1E2125;">&ldquo;%s&rdquo;</p>' % (font, e(one_line(note, 240))) if note else "")
            + '<p style="margin:0;%sfont-size:14px;color:#1E2125;">Card No. %s &middot; <span style="font-family:\'Courier New\',monospace;white-space:nowrap;">%s</span></p>'
            % (sans, e(str(card.get("no") or 0).zfill(4)), e(card["code"])))
    rows.append('<tr><td style="padding:0 20px 18px;">' + h2("On the card")
                + '<table role="presentation" width="100%%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:16px;border:1px solid #D6D9D2;border-top:4px solid #2B5C8A;background:#FBFAF7;">%s</td></tr></table></td></tr>' % face)
    if pic:
        # the year so far, folded in from the proof email (one email per this-year gift)
        rows.append('<tr><td style="padding:0 20px 18px;">' + h2("The print so far") +
                    '<img src="%s" width="560" alt="The Rain Print so far: %s" style="display:block;width:100%%;max-width:560px;height:auto;border:1px solid #D6D9D2;">'
                    % (e(pic), e(what_line(o))) + "".join('<p style="margin:8px 0 0;%sfont-size:14px;line-height:1.45;color:#5E6475;">%s</p>' % (sans, e(x)) for x in SO_FAR)
                    + "</td></tr>")
    rows.append('<tr><td style="padding:0 20px 6px;">' + h2("What they get") + "".join(p(e(x)) for x in what) + "</td></tr>")
    rows.append('<tr><td style="padding:0 20px 6px;">' + h2("How they use it") + "".join(p(e(x).replace(e(gift_redeem(card)), '<b style="word-break:break-all;">%s</b>' % e(gift_redeem(card)))) for x in how) + "</td></tr>")
    rows.append('<tr><td style="padding:0 20px 6px;">' + h2("When it comes") + "".join(p(e(x)) for x in when) + "</td></tr>")
    tips = "".join('<li style="margin:0 0 10px;">%s</li>' % e(t) for t in CARD_TIPS)
    rows.append('<tr><td style="padding:0 20px 8px;">' + h2("Printing the card") +
                '<ul style="margin:0 0 14px;padding:0 0 0 20px;%sfont-size:16px;line-height:1.5;color:#1E2125;">%s</ul></td></tr>' % (font, tips))
    rows.append('<tr><td style="padding:0 20px 24px;">' + p("<b>Something wrong, or a name to fix on the card?</b> Reply to this email and I will fix it.")
                + p("Sig", "margin-top:18px;") +
                '<p style="margin:18px 0 0;%sfont-size:12px;line-height:1.4;color:#5E6475;">%s</p></td></tr>' % (sans, e(ADDRESS)))
    return ('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            '<title>%s</title></head><body style="margin:0;padding:0;background:#F4F3EE;">'
            '<table role="presentation" width="100%%" cellpadding="0" cellspacing="0" border="0" style="background:#F4F3EE;"><tr><td align="center" style="padding:12px 8px;">'
            '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%%;max-width:600px;background:#FFFFFF;">'
            '%s</table></td></tr></table></body></html>') % (e(gift_subject(o, to)), "".join(rows))


def build_gift(o, card, to_addr, to="", note="", fn=None, fa="", dry=False, proof=None):
    fn = fn or buyer_from_name()
    m = EmailMessage()
    m.rp_buyer = True
    m["Subject"] = ("[dry run, would go to the buyer] " if dry else "") + gift_subject(o, to)
    m["From"] = formataddr((fn, fa))
    m["To"] = to_addr
    m["Reply-To"] = REPLY_TO
    m["Message-ID"] = make_msgid(domain=(fa.split("@", 1)[1] if "@" in fa else "agsist.com"))
    m.set_content(gift_text(o, card, to, note, bool(proof)))
    m.add_alternative(gift_html(o, card, to, note, "cid:proof" if proof else ""), subtype="html")
    if proof:
        with open(proof, "rb") as f:
            m.get_payload()[1].add_related(f.read(), maintype="image", subtype="jpeg", cid="<proof>",
                                           filename="rain-print-so-far.jpg", disposition="inline")
    return m


def card_ok(c):
    return bool(c and c.get("ok") and re.match(r"^RP-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$", str(c.get("code") or ""))
                and str(c.get("card_url") or "").startswith(CARD_BASE + "?c=" + str(c.get("code")) + "&k="))


def send_gift_cards(src, due, notes, dry, send, sig_to, test_emails):
    """Each paid this-year gift gets ONE email (the lead, 2026-10-20): the card (issued by the worker v5.40, once
    per order, the code kept on the order) and, under it, the print so far (the proof email's preview picture,
    folded in). Marked gift-mailed, then mailed (the preview was its proof email), both before the send; the
    proof loop never sends a this-year gift a second email. Dry run: nothing issued or marked, the email to Sig
    with a stand-in code. -> counts."""
    c = {"cards sent": 0, "cards to Sig": 0, "cards waiting": 0, "cards no address": 0, "card not issued": 0,
         "cards render failed": 0, "cards marked, send failed": 0}
    for o in due:
        if notes is None:
            c["cards waiting"] += 1
            continue
        to, note = notes.get(o["ref"], ("", ""))
        try:
            s = src.session(o["key"])
        except Exception:                                  # noqa: BLE001
            c["cards no address"] += 1
            continue
        buyer = s["email"] if EMAIL_RE.match(s["email"]) else ""
        sig_only = dry or not s["livemode"] or buyer.lower() in test_emails
        if not buyer and not sig_only:
            c["cards no address"] += 1
            continue
        with tempfile.TemporaryDirectory() as tmp:
            try:
                r = src.render(dict(o, gift_note=note), tmp) if URL_RE.match(str(o.get("design_url") or "")) else {}
            except Exception:                              # noqa: BLE001
                c["cards render failed"] += 1              # nothing issued or marked: the next run tries again
                continue
            if dry:
                card = {"ok": True, "code": DRY_CODE, "no": 0, "prepaid": True, "card_url": CARD_BASE + "?c=" + DRY_CODE + "&k=dry-run"}
            else:
                try:
                    card = src.worker("rp-gift/issue", body={"order_key": o["key"], "to": to, "message": note})
                except Exception:                          # noqa: BLE001
                    card = None
                if not card_ok(card):
                    c["card not issued"] += 1              # nothing marked: the next run tries again (the worker gives the same card)
                    continue
            m = build_gift(o, card, sig_to if sig_only else buyer, to, note, dry=dry, proof=r.get("proof"))
            if not dry:
                mk = src.worker("rp-order/gift-mailed", body={"key": o["key"]})
                if not mk.get("ok") or mk.get("already"):
                    continue
                if not o.get("mailed"):
                    src.worker("rp-order/mailed", body={"key": o["key"]})   # the preview went in this email: its proof email, once
            try:
                send(m)
            except Exception:                              # noqa: BLE001
                c["cards marked, send failed" if not dry else "card not issued"] += 1
                continue
        if sig_only:
            c["cards to Sig"] += 1
            continue
        c["cards sent"] += 1
        try:
            n = sig_note(o, sig_to, "The gift card went to the buyer by email (card No. %s, ends %s), with the print so far. Nothing to do until January." % (
                str(card.get("no") or 0).zfill(4), card["code"][-4:]))
            n.replace_header("Subject", "Rain Print gift card sent: %s%s" % (one_line(o.get("place"), 60) or "a gift", (" " + str(o["year"])) if o.get("year") else ""))
            send(n)
        except Exception:                                  # noqa: BLE001
            pass                                           # the buyer has the card; the note is a courtesy
    return c


# ───────────────────────────── Sig's order alert ─────────────────────────────

def alert_text(o, buyer):
    """Sig's alert: one order, plain text. The buyer's address only as Stripe sent it, never kept."""
    paid = o.get("paid") or {}
    amt = paid.get("amount")
    lines = ["New Rain Print order.", ""]
    lines.append("What: %s" % (what_line(o) if not o.get("no_press") else "%s (no design on record: the press post never came)"
                                % PRODUCT.get(o.get("product"), "unknown product")))
    lines.append("Gift: %s" % ("yes, this year's print, made in January" if o.get("gift") else "see the order form posts" if o.get("gift_to") else "no"))
    if o.get("gift_to"):
        lines[-1] = "Gift: yes, for %s" % o["gift_to"]
    if isinstance(amt, (int, float)):
        sub = paid.get("subtotal")
        lines.append("Paid: $%s%s" % ("{:,.2f}".format(amt), (" ($%s less a code)" % "{:,.2f}".format(sub)) if isinstance(sub, (int, float)) and sub > amt else ""))
    if o.get("serial"):
        lines.append("Serial: %s" % o["serial"])
    url = str(o.get("fulfill_url") or "")
    lines.append("Open to fulfill: %s" % url if url.startswith("https://agsist.com/rain-print?") else
                 "Open to fulfill: no design link. Find the session in Stripe (%s) and ask the buyer." % paid.get("session", "?"))
    lines.append("Approval: %s" % ("approved %s" % o["approved"].get("at", "") if o.get("approved") else
                                   "waiting for approval (the proof email has the buttons; nothing is made before)"))
    lines.append("Buyer (as Stripe sent it): %s" % (buyer or "not given"))
    lines.append("Stripe session: %s" % paid.get("session", "?"))
    lines += ["", "Sent once per paid session. Nothing about the buyer is kept by AGSIST."]
    return "\n".join(lines) + "\n"


def alert_subject(o):
    what = {"digital": "Digital file", "print12x18": "Print", "framed12x18": "Framed"}.get(o.get("product"), "Rain Print")
    place = one_line(o.get("place"), 60)
    amt = (o.get("paid") or {}).get("amount")
    return "Rain Print order: %s%s%s%s" % (what, (", " + place) if place else "", (" " + str(o["year"])) if o.get("year") else "",
                                           (" ($%s)" % "{:,.2f}".format(amt)) if isinstance(amt, (int, float)) else "")


def send_alerts(src, orders, send, sig_to, fn="AGSIST", fa=""):
    """Every paid record not yet alerted: marked first (once only), then one email to Sig. Dry run or not:
    the alert always goes to Sig. -> counts."""
    c = {"alerts": 0, "alert failed": 0}
    for o in orders:
        if o.get("status") != "paid" or o.get("alerted") or not (o.get("paid") or {}).get("session"):
            continue
        mk = src.worker("rp-order/alerted", body={"key": o["key"]})
        if not mk.get("ok") or mk.get("already"):
            continue
        buyer = ""
        try:
            b = src.session(o["key"])
            buyer = b["email"] if EMAIL_RE.match(b["email"]) else ""
        except Exception:                                  # noqa: BLE001
            buyer = ""
        m = EmailMessage()
        m["Subject"] = alert_subject(o)
        m["From"] = formataddr((fn, fa))
        m["To"] = sig_to
        m["Message-ID"] = make_msgid(domain=(fa.split("@", 1)[1] if "@" in fa else "agsist.com"))
        m.set_content(alert_text(o, buyer))
        try:
            send(m)
            c["alerts"] += 1
        except Exception:                                  # noqa: BLE001
            c["alert failed"] += 1
    # the buyer approved the proof: make it (prints) or send the full file (digital)
    for o in orders:
        if o.get("status") != "paid" or not o.get("approved") or o.get("approved_alerted"):
            continue
        mk = src.worker("rp-order/approved-alerted", body={"key": o["key"]})
        if not mk.get("ok") or mk.get("already"):
            continue
        m = EmailMessage()
        what = {"digital": "Digital file", "print12x18": "Print", "framed12x18": "Framed"}.get(o.get("product"), "Rain Print")
        m["Subject"] = "Rain Print approved: %s%s%s" % (what, (", " + one_line(o.get("place"), 60)) if o.get("place") else "",
                                                         (" " + str(o["year"])) if o.get("year") else "")
        m["From"] = formataddr((fn, fa))
        m["To"] = sig_to
        m["Message-ID"] = make_msgid(domain=(fa.split("@", 1)[1] if "@" in fa else "agsist.com"))
        url = str(o.get("fulfill_url") or "")
        todo = ("Nothing to do: the files go to the buyer by email now (this job), and a note follows when they have." if o.get("product") == "digital"
                else "Make it: it ships within 3 business days of the approval (the page promises it).")
        m.set_content("The buyer approved the proof.\n\nWhat: %s\nApproved: %s\nSerial: %s\n%s\nOpen to fulfill: %s\n" % (
            what_line(o), o["approved"].get("at", ""), o.get("serial") or "none (a digital file)", todo, url or "no design link"))
        try:
            send(m)
            c["alerts"] += 1
        except Exception:                                  # noqa: BLE001
            c["alert failed"] += 1
    return c


# ───────────────────────────── the run ─────────────────────────────

def gift_notes(src, refs):
    """{ref: (gift_to, gift_message)} from the order form posts of gifts (form:rain-print-order, design_code = the ref).
    Only those two fields are taken; the rest of a post (the buyer's name, email, address) is never read."""
    out = {}
    if not refs:
        return out
    d = src.worker("form-list", kind="rain-print-order")
    for p in d if isinstance(d, list) else []:
        if isinstance(p, dict) and p.get("design_code") in refs and (p.get("gift") == "yes" or p.get("gift_january") == "yes"):
            out[p["design_code"]] = (one_line(p.get("gift_to"), 80), str(p.get("gift_message") or "").strip()[:240])
    return out


def run(src, dry, send, sig_to, test_emails):
    """-> (exit code, log lines). Counts only in the log: never an address, a name or a design."""
    log = []
    try:
        d = src.worker("rp-order/list", days=DAYS)
    except Exception as e:                                 # noqa: BLE001
        return 0, ["Order records could not be read (%s); nothing sent." % type(e).__name__]
    orders = [o for o in d.get("orders") or [] if isinstance(o, dict)]
    ac = send_alerts(src, orders, send, sig_to)
    log.append("Order alerts to Sig: %d sent, %d failed." % (ac["alerts"], ac["alert failed"]))
    if d.get("stripe") != "ok" and not any((o.get("paid") or {}).get("via") == "webhook" for o in orders):
        return (1 if ac["alert failed"] else 0), log + ["The worker could not confirm payments (Stripe: %s); no buyer email sent." % one_line(d.get("stripe"), 60)]
    due = [o for o in d.get("orders") or [] if isinstance(o, dict) and o.get("status") == "paid" and not o.get("mailed")
           and (o.get("paid") or {}).get("session") and URL_RE.match(str(o.get("design_url") or "")) and o.get("product") in PRODUCT
           and not is_gift_card_order(o)]   # a this-year gift's preview goes in its gift card email (one email)
    fdue = files_due(orders)
    gdue = gift_due(orders)
    log.append("Paid and not yet mailed: %d." % len(due))
    log.append("Approved digital files not yet sent: %d." % len(fdue))
    log.append("Paid gifts whose card has not gone yet: %d." % len(gdue))
    try:
        notes = gift_notes(src, {o["ref"] for o in due} | {o["ref"] for o in fdue} | {o["ref"] for o in gdue})
    except Exception as e:                                 # noqa: BLE001
        notes = None
        log.append("Gift notes could not be read (%s); every order waits for the next run." % type(e).__name__)
    # the gift card first (Sig, 2026-10-20: the buyer gets it at once, no hand-sent links); its counts on their own line
    gc = send_gift_cards(src, gdue, notes, dry, send, sig_to, test_emails)
    log.append("; ".join("%s: %d" % (k, v) for k, v in gc.items()) + ".")
    # the files for each approved digital file first (the buyer is waiting on them); their counts on their own line
    fc = deliver(src, fdue, notes, dry, send, sig_to, test_emails)
    log.append("; ".join("%s: %d" % (k, v) for k, v in fc.items()) + ".")
    counts = {"sent": 0, "to Sig": 0, "no address": 0, "render failed": 0, "marked, send failed": 0, "waiting": 0}
    for o in due:
        if notes is None:   # a gift's note could be missed: every order waits for the next run
            counts["waiting"] += 1
            continue
        gift_to, note = (notes or {}).get(o["ref"], ("", ""))
        o = dict(o, gift_note=note)
        try:
            s = src.session(o["key"])
        except Exception:                                  # noqa: BLE001
            counts["no address"] += 1
            continue
        buyer = s["email"] if EMAIL_RE.match(s["email"]) else ""
        sig_only = dry or not s["livemode"] or buyer.lower() in test_emails
        if not buyer and not sig_only:
            counts["no address"] += 1
            continue
        with tempfile.TemporaryDirectory() as tmp:
            try:
                r = src.render(o, tmp)
            except Exception:                              # noqa: BLE001
                counts["render failed"] += 1
                continue
            to = sig_to if sig_only else buyer
            m = build(o, r, to, gift_to, dry=dry)
            if not dry:
                # marked first: never twice, even if the send or this job dies after it
                mk = src.worker("rp-order/mailed", body={"key": o["key"]})
                if not mk.get("ok") or mk.get("already"):
                    continue
            try:
                send(m)
            except Exception:                              # noqa: BLE001
                counts["marked, send failed" if not dry else "render failed"] += 1
                continue
            counts["to Sig" if sig_only else "sent"] += 1
    log.append("; ".join("%s: %d" % (k, v) for k, v in counts.items()) + ".")
    return (1 if counts["marked, send failed"] or fc["files marked, send failed"] or gc["cards marked, send failed"] or ac["alert failed"] else 0), log


def smtp_send(fn, fa):
    def send(m):
        if not (env("SMTP_USER") and env("SMTP_PASS")):
            raise RuntimeError("no SMTP_USER / SMTP_PASS")
        del m["From"]
        # a buyer email goes out as Sig at AGSIST (RP_FROM_NAME); Sig's own alerts and notes keep FROM_NAME
        m["From"] = formataddr((buyer_from_name() if getattr(m, "rp_buyer", False) else fn, fa))
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
    return send


def main():
    if "--selftest" in sys.argv:
        return selftest()
    if "--sample" in sys.argv:
        return sample(sys.argv[sys.argv.index("--sample") + 1])
    if "--sample-gift" in sys.argv:
        return sample_gift(sys.argv[sys.argv.index("--sample-gift") + 1])
    if "--sample-files" in sys.argv:
        return sample_files(sys.argv[sys.argv.index("--sample-files") + 1])
    dry = env("DRY_RUN") == "1"
    sig_to = env("SIG_TO", REPLY_TO)
    tests = {x.strip().lower() for x in (env("SIG_TEST_EMAILS", "") or "").split(",") if x.strip()} | {sig_to.lower(), REPLY_TO}
    src = Sources(env("LIST_URL", ""), env("LIST_TOKEN", ""))
    fn, fa = env("FROM_NAME", "AGSIST"), log_safe.sender_addr()
    code, log = run(src, dry, smtp_send(fn, fa), sig_to, tests)
    for line in log:
        print(line)
    return code


# ───────────────────────────── selftest ─────────────────────────────

SIG_URL = ("https://agsist.com/rain-print?place=Chetek%2C+WI&year=2025&station=471667+2&layout=staircase&palette=paper"
           "&size=12x18&style=r1&name=Gustum+Farm&m1=2025-04-01+Moved+in")
SIG_REF = "MnxDaGV0ZWssIFdJfDQ3MTY2NyAyfDIwMjV8c3AwYWF8R3VzdHVtIEZhcm18Mml8TW92ZWQgaW4"
WORDS = ["Your framed print of Chetek, WI, 2025 is ordered. Your proof comes by email by Wednesday, Oct 21. Approve it there, or ask for a change. Nothing prints until you approve it.",
         "It ships within 3 business days after you approve it, and ordered by Dec 9 it arrives by Christmas.",
         "Nothing by then? Check spam, or write to me at sig@farmers1st.com."]


def order(key, product="framed12x18", session="cs_live_1", **kw):
    o = {"key": "rpo:17610000000%s:0000000%s" % (key, key), "ts": 1761000000000, "ref": SIG_REF, "product": product,
         "design_url": SIG_URL, "place": "Chetek, WI", "year": 2025, "style": "r1", "name": "Gustum Farm", "gift": False,
         "status": "paid", "paid": {"amount": 89, "session": session}, "mailed": None, "alerted": {"at": "x", "session": session},
         "fulfill_url": SIG_URL + "&maker=1&serial=4", "serial": 4, "approve_t": "0123456789abcdef", "approved": None,
         "approved_alerted": None}
    o.update(kw)
    return o


class Fake(Sources):
    def __init__(self, listing, sessions, forms=None, render_fail=False, mark_fail=False, file_bytes=None):
        super().__init__("https://w.dev", "tok")
        self.listing, self.sessions, self.forms = listing, sessions, forms or []
        self.render_fail, self.mark_fail = render_fail, mark_fail
        self.calls, self.marked, self.alerted = [], set(), set()
        self.delivered = {}
        self.issues, self.cards, self.gift_mailed, self.issue_fail = [], {}, set(), False
        # made-up file sizes (bytes); the real ones come to about 2 to 4 MB in all
        self.file_bytes = file_bytes or {"pdf": 800000, "png": 600000, "jpg": 400000, "guide": 1200000}

    def worker(self, path, body=None, **q):
        self.calls.append(("worker", path))
        if path == "rp-order/list":
            return self.listing
        if path == "form-list":
            return self.forms
        if path == "rp-order/approved-alerted":
            k = body["key"]
            already = ("ap", k) in self.alerted
            self.alerted.add(("ap", k))
            return {"ok": True, "already": already}
        if path == "rp-order/alerted":
            k = body["key"]
            already = k in self.alerted
            self.alerted.add(k)
            return {"ok": True, "already": already}
        if path == "rp-order/buyer":
            if self.listing.get("stripe") != "ok":   # the worker reads the address with its read key, or not at all
                raise urllib.error.HTTPError("https://w.dev/x", 503, "no key", {}, None)
            return {"ok": True, **self.session(q["key"])}
        if path == "rp-gift/issue":
            # the worker (v5.40): one card per order, the same card on a second call
            self.issues.append(dict(body))
            if self.issue_fail:
                raise urllib.error.HTTPError("https://w.dev/x", 500, "x", {}, None)
            k = body["order_key"]
            if k not in self.cards:
                n = len(self.cards) + 7
                code = "RP-7K3M-Q9TW-H%d%dF" % (n // 10, n % 10)
                self.cards[k] = {"ok": True, "already": False, "code": code, "no": n, "last4": code[-4:], "prepaid": True, "status": "redeemed",
                                 "ships": "january", "card_url": "https://agsist.com/rp-gift?c=%s&k=0123456789abcdef" % code}
                return self.cards[k]
            return dict(self.cards[k], already=True)
        if path == "rp-order/gift-mailed":
            if self.mark_fail:
                raise urllib.error.HTTPError("https://w.dev/x", 500, "x", {}, None)
            if body["key"] not in self.cards:
                return {"ok": False, "error": "no gift card yet"}
            already = body["key"] in self.gift_mailed
            self.gift_mailed.add(body["key"])
            self.calls.append(("gift-mailed",))
            return {"ok": True, "already": already}
        if path == "rp-order/delivered":
            if self.mark_fail:
                raise urllib.error.HTTPError("https://w.dev/x", 500, "x", {}, None)
            k = body["key"]
            already = k in self.delivered
            self.delivered.setdefault(k, body.get("how"))
            return {"ok": True, "already": already}
        if path == "rp-order/mailed":
            if self.mark_fail:
                raise urllib.error.HTTPError("https://w.dev/x", 500, "x", {}, None)
            k = body["key"]
            already = k in self.marked
            self.marked.add(k)
            return {"ok": True, "already": already}
        raise urllib.error.HTTPError("https://w.dev/x", 404, "x", {}, None)

    def session(self, key, direct=False):
        if self.listing.get("stripe") != "ok":
            raise urllib.error.HTTPError("https://w.dev/x", 503, "no key", {}, None)
        sid = next((o["paid"]["session"] for o in self.listing.get("orders", []) if o["key"] == key), "")
        self.calls.append(("session", sid))
        if sid not in self.sessions:
            raise urllib.error.HTTPError("https://api.stripe.com/x", 404, "x", {}, None)
        return self.sessions[sid]

    def render(self, o, out_dir):
        self.calls.append(("render", o["product"], o.get("gift_note", "")))
        if self.render_fail:
            raise RuntimeError("render")
        pr = os.path.join(out_dir, "proof.jpg")
        with open(pr, "wb") as f:
            f.write(b"\xff\xd8\xff\xe0proof")
        lt = None
        if o["product"] != "digital":
            lt = os.path.join(out_dir, "letter.jpg")
            with open(lt, "wb") as f:
                f.write(b"\xff\xd8\xff\xe0letter")
        return {"ok": True, "proof": pr, "letter": lt, "words": WORDS}

    def render_files(self, o, out_dir):
        self.calls.append(("render files", o["product"], o.get("gift_note", "")))
        if self.render_fail:
            raise RuntimeError("render files")
        out = []
        for kind, name in (("pdf", "rain-print-chetek-wi-2025-r1-12x18-300dpi.pdf"), ("png", "rain-print-chetek-wi-2025-r1-12x18-300dpi.png"),
                           ("jpg", "rain-print-chetek-wi-2025-r1-12x18-300dpi.jpg"), ("guide", "rain-print-chetek-wi-2025-r1-how-to-read.pdf")):
            path = os.path.join(out_dir, name)
            with open(path, "wb") as f:
                f.write(kind.encode() * 8)
            out.append({"kind": kind, "path": path, "name": name, "bytes": self.file_bytes[kind]})
        return out


def selftest():
    fails = []

    def ck(name, ok, detail=""):
        print(("  ok   " if ok else "  FAIL ") + name + ("" if ok else "  -- %s" % (detail,)))
        if not ok:
            fails.append(name)

    sent = []
    send = lambda m: sent.append(m)                        # noqa: E731
    tests = {"sig@farmers1st.com", "dnilgis+test@example.com"}
    live = {"livemode": True, "email": "buyer@example.com"}

    print("who gets it")
    f = Fake({"stripe": "ok", "orders": [order("1")]}, {"cs_live_1": live})
    code, log = run(f, False, lambda m: (f.calls.append(("send",)), sent.append(m)), "sig@farmers1st.com", tests)
    ck("a paid order: one email to the buyer", code == 0 and len(sent) == 1 and sent[0]["To"] == "buyer@example.com", [m["To"] for m in sent])
    ck("marked before the send", ("send",) in f.calls and f.calls.index(("worker", "rp-order/mailed")) < f.calls.index(("send",)), f.calls)
    ck("Reply-To is Sig", sent[0]["Reply-To"] == "sig@farmers1st.com")
    ck("the log has counts only", all("@" not in x and "Chetek" not in x and "Gustum" not in x and SIG_REF not in x for x in log), log)
    ck("the counts line", log[-1].startswith("sent: 1; to Sig: 0;"), log)
    # run again on the same listing: the mark says already, nothing goes
    sent.clear()
    run(f, False, send, "sig@farmers1st.com", tests)
    ck("idempotent: a second run sends nothing", sent == [], [m["To"] for m in sent])
    sent.clear()
    f = Fake({"stripe": "ok", "orders": [order("1", mailed={"at": "x", "session": "cs_live_1"})]}, {"cs_live_1": live})
    run(f, False, send, "sig@farmers1st.com", tests)
    ck("a record already mailed is skipped without asking Stripe", sent == [] and not any(c[0] == "session" for c in f.calls), f.calls)
    sent.clear()
    f = Fake({"stripe": "ok", "orders": [order("1")]}, {"cs_live_1": live})
    run(f, True, send, "sig@farmers1st.com", tests)
    ck("dry run: to Sig only, marked nothing", len(sent) == 1 and sent[0]["To"] == "sig@farmers1st.com" and not f.marked
       and sent[0]["Subject"].startswith("[dry run"), [m["To"] for m in sent])
    sent.clear()
    f = Fake({"stripe": "ok", "orders": [order("1"), order("2", session="cs_test_2"), order("3", session="cs_live_3")]},
             {"cs_live_1": {"livemode": True, "email": "Sig@Farmers1st.com"}, "cs_test_2": {"livemode": False, "email": "buyer@example.com"},
              "cs_live_3": {"livemode": True, "email": "dnilgis+test@example.com"}})
    run(f, False, send, "sig@farmers1st.com", tests)
    ck("Sig's own orders and test-mode sessions go to Sig only", [m["To"] for m in sent] == ["sig@farmers1st.com"] * 3, [m["To"] for m in sent])
    sent.clear()
    f = Fake({"stripe": "no key", "orders": [order("1")]}, {"cs_live_1": live})
    code, log = run(f, False, send, "sig@farmers1st.com", tests)
    ck("no confirmed payments: nothing sent", sent == [] and "no buyer email sent" in log[-1], log)
    f = Fake({"stripe": "ok", "orders": [order("1", status="pay pressed", paid=None)]}, {"cs_live_1": live})
    run(f, False, send, "sig@farmers1st.com", tests)
    ck("pay pressed only: nothing sent", sent == [])
    f = Fake({"stripe": "ok", "orders": [order("1")]}, {"cs_live_1": {"livemode": True, "email": ""}})
    code, log = run(f, False, send, "sig@farmers1st.com", tests)
    ck("no address on the session: nothing, counted", sent == [] and "no address: 1" in log[-1] and not f.marked, log)
    f = Fake({"stripe": "ok", "orders": [order("1")]}, {"cs_live_1": live}, render_fail=True)
    code, log = run(f, False, send, "sig@farmers1st.com", tests)
    ck("the pictures fail: nothing sent, nothing marked (the next run tries again)", sent == [] and not f.marked and "render failed: 1" in log[-1], log)
    f = Fake({"stripe": "ok", "orders": [order("1")]}, {"cs_live_1": live})
    code, log = run(f, False, lambda m: (_ for _ in ()).throw(OSError("smtp")), "sig@farmers1st.com", tests)
    ck("a send that fails after the mark: exit 1, counted", code == 1 and "marked, send failed: 1" in log[-1], log)
    f = Fake({"stripe": "ok", "orders": [order("1")]}, {"cs_live_1": live}, mark_fail=True)
    try:
        run(f, False, send, "sig@farmers1st.com", tests)
        ck("the mark fails: the run stops before sending", False)
    except urllib.error.HTTPError:
        ck("the mark fails: the run stops before sending", sent == [])

    f = Fake({"stripe": "ok", "orders": [order("1")]}, {"cs_live_1": live})
    f.worker = (lambda orig: (lambda path, body=None, **q: (_ for _ in ()).throw(OSError("x")) if path == "form-list" else orig(path, body, **q)))(f.worker)
    sent.clear()
    code, log = run(f, False, send, "sig@farmers1st.com", tests)
    ck("gift notes unreadable: every order waits", sent == [] and not f.marked and "waiting: 1" in log[-1], log)

    print("\nSig's order alert")
    sent.clear()
    f = Fake({"stripe": "ok", "orders": [order("1", alerted=None, paid={"amount": 79, "subtotal": 89, "session": "cs_live_1", "via": "webhook"}),
                                         order("2", status="pay pressed", paid=None, alerted=None),
                                         order("3", alerted=None, session="cs_live_3", no_press=True, design_url="", fulfill_url="", place="", year=None,
                                               product="print12x18", serial=5, mailed={"at": "x"})]},
             {"cs_live_1": live, "cs_live_3": {"livemode": True, "email": ""}})
    code, log = run(f, True, send, "sig@farmers1st.com", tests)
    alerts = [m for m in sent if m["Subject"].startswith("Rain Print order:")]
    ck("one alert per paid record, to Sig, even on a dry run", len(alerts) == 2 and all(m["To"] == "sig@farmers1st.com" for m in alerts), [m["Subject"] for m in sent])
    a = alerts[0].get_content()
    ck("alert subject", alerts[0]["Subject"] == "Rain Print order: Framed, Chetek, WI 2025 ($79.00)", alerts[0]["Subject"])
    ck("alert: what, paid, serial, the maker link", "What: 13 x 19 framed print of Chetek, WI, 2025, Staircase" in a and "Paid: $79.00 ($89.00 less a code)" in a
       and "Serial: 4" in a and "Open to fulfill: " + SIG_URL + "&maker=1&serial=4" in a, a)
    ck("alert: the buyer only as Stripe sent it", "Buyer (as Stripe sent it): buyer@example.com" in a, a)
    b = alerts[1].get_content()
    ck("alert with no press: says so, no link", "no design on record" in b and "no design link" in b and "Buyer (as Stripe sent it): not given" in b, b)
    ck("alerts marked once", f.alerted == {order("1")["key"], order("3")["key"]})
    ck("the log: counts only", "Order alerts to Sig: 2 sent, 0 failed." in log and all("@" not in x for x in log), log)
    sent.clear()
    run(f, True, send, "sig@farmers1st.com", tests)
    ck("a second run sends no alert again", not any(m["Subject"].startswith("Rain Print order:") for m in sent), [m["Subject"] for m in sent])
    sent.clear()
    f = Fake({"stripe": "no key", "orders": [order("1", alerted=None, mailed=None, paid={"amount": 19, "session": "cs_live_1", "via": "webhook"}, product="digital")]},
             {"cs_live_1": live})
    code, log = run(f, False, send, "sig@farmers1st.com", tests)
    ck("webhook-paid with no read key: Sig's alert goes (buyer not given); no buyer email, counted",
       [m["To"] for m in sent] == ["sig@farmers1st.com"] and "Buyer (as Stripe sent it): not given" in sent[0].get_content()
       and "no address: 1" in log[-1], (log, [m["To"] for m in sent]))
    ck("no em dashes in the alert", not any("\u2014" in m.get_content() for m in alerts))

    sent.clear()
    f = Fake({"stripe": "ok", "orders": [order("1", approved={"at": "2026-10-21T14:00:00.000Z"}, mailed={"at": "x"}),
                                         order("2", product="digital", approved={"at": "2026-10-21T15:00:00.000Z"}, mailed={"at": "x"}, serial=None)]},
             {"cs_live_1": live})
    run(f, False, send, "sig@farmers1st.com", tests)
    ap = [m for m in sent if m["Subject"].startswith("Rain Print approved:")]
    ck("an approval: one email to Sig each, with the maker link and what to do",
       len(ap) == 2 and all(m["To"] == "sig@farmers1st.com" for m in ap) and "Make it: it ships within 3 business days" in ap[0].get_content()
       and "Open to fulfill: " + SIG_URL + "&maker=1&serial=4" in ap[0].get_content() and "Nothing to do: the files go to the buyer by email now" in ap[1].get_content(),
       [m.get_content() for m in ap])
    sent.clear()
    run(f, False, send, "sig@farmers1st.com", tests)
    ck("an approval alert goes once", not any(m["Subject"].startswith("Rain Print approved:") for m in sent))
    ck("the order alert says waiting for approval", "Approval: waiting for approval" in alert_text(order("1"), ""))

    print("\nthe email")
    sent.clear()
    forms = [{"kind": "rain-print-order", "design_code": SIG_REF, "gift": "yes", "gift_to": "Dad Olson", "gift_message": "For every inch\nyou farmed",
              "email": "buyer@example.com", "name": "Jane Buyer", "address": "12 Main St"}]
    f = Fake({"stripe": "ok", "orders": [order("1")]}, {"cs_live_1": live}, forms=forms)
    run(f, False, send, "sig@farmers1st.com", tests)
    m = sent[0]
    ck("the gift note goes to the letter", ("render", "framed12x18", "For every inch\nyou farmed") in f.calls, f.calls)
    txt = m.get_body(("plain",)).get_content()
    htm = m.get_body(("html",)).get_content()
    ck("subject: the proof, the town and year", m["Subject"] == "Your Rain Print proof: Chetek, WI, 2025", m["Subject"])
    ck("what was bought", "13 x 19 framed print of Chetek, WI, 2025, Staircase" in txt and "13 x 19 framed print of Chetek, WI, 2025, Staircase" in htm, txt)
    ck("who it is for", "For: Dad Olson" in txt and "For: <b>Dad Olson</b>" in htm)
    ck("the email is the proof: check it, approve it, nothing made before", "This email is your proof." in txt and "Nothing is made until you approve it." in txt
       and "Your proof comes by email" not in txt and "Your proof comes by email" not in htm, txt)
    ck("the shipping line from the page", WORDS[1] in txt and WORDS[1] in htm and WORDS[2] not in txt, txt)
    k = urllib.parse.quote(order("1")["key"], safe="")
    ck("Approve this print: a big button to the approve page with the key and token, nothing about the buyer",
       ('href="https://agsist.com/rain-print-approve?k=%s&amp;t=0123456789abcdef"' % k) in htm and ">Approve this print</a>" in htm
       and "buyer@example.com" not in htm.split("Approve this print")[0][-400:], htm[-1500:])
    ck("Ask for a change: a mailto to Sig with the ref in the subject",
       ('href="mailto:sig@farmers1st.com?subject=Change%%20to%%20my%%20Rain%%20Print%%20%%28ref%%20%s%%29"' % SIG_REF) in htm and ">Ask for a change</a>" in htm, htm[-1500:])
    ck("the text part has the approve link too", "Approve this print: https://agsist.com/rain-print-approve?k=%s&t=0123456789abcdef" % k in txt, txt)
    ck("Something wrong? Reply", "Something wrong? Reply to this email" in txt and "Something wrong?</b> Reply to this email" in htm)
    ck("the proof and the letter inline by cid", 'src="cid:proof"' in htm and 'src="cid:letter"' in htm and
       sorted(p["Content-ID"] for p in m.walk() if p["Content-ID"]) == ["<letter>", "<proof>"], htm[:200])
    ck("nothing from the order form but the gift lines", "Jane" not in txt + htm and "Main St" not in txt + htm, txt)
    ck("no em dashes", "\u2014" not in txt + htm and "\u2014" not in m["Subject"])
    ck("phone first: tables and inline styles, no style block or script", "<style" not in htm and "<script" not in htm
       and 'role="presentation"' in htm and "max-width:600px" in htm)
    ck("no sponsor", "sponsor" not in (txt + htm).lower())
    sent.clear()
    f = Fake({"stripe": "ok", "orders": [order("1", product="digital")]}, {"cs_live_1": live})
    run(f, False, send, "sig@farmers1st.com", tests)
    htm = sent[0].get_body(("html",)).get_content()
    ck("a digital file: no letter, the file wording", "cid:letter" not in htm and "your file will not" in htm, htm[-400:])
    ck("a digital file: the files right after the OK", "After you approve it, your files come by email within minutes: a PDF, a PNG and a JPG at 12 x 18 in, 300 dpi, no preview mark, "
       "with a page on how to read it." in htm, htm[-900:])
    # a year not finished, or no token: no buttons, the proof comes later
    o2 = order("1")
    r2 = {"proof": "x", "letter": None, "preview": True, "words": ["Your 13 x 19 print of Chetek, WI, 2026 is ordered. Your gift card to print comes by email by Wednesday, Oct 21. The print follows in January, with a proof to you first.", "Questions?"]}
    h2 = html_body(o2, r2)
    ck("this year's print: no approve button, the proof comes when the year is in", "Approve this print" not in h2 and "once the full year is in" in h2 and "gift card" not in h2, h2[-1200:])
    ck("no token: no approve button", "Approve this print" not in html_body(dict(o2, approve_t=None), dict(r2, preview=False)))

    print("\nthe sender name")
    ENVS = ("RP_FROM_NAME", "FROM_NAME", "SMTP_USER", "SMTP_PASS")
    keep = {k: os.environ.pop(k) for k in ENVS if k in os.environ}
    real_smtp = smtplib.SMTP
    try:
        os.environ["FROM_NAME"] = "AGSIST Daily"
        got = []

        class _SMTP:   # a stand-in server: smtp_send runs as it does for real, nothing leaves
            def __init__(self, *a, **k): pass
            def starttls(self, **k): pass
            def login(self, *a): pass
            def send_message(self, m): got.append(m["From"])
            def quit(self): pass
        smtplib.SMTP = _SMTP
        os.environ.update({"SMTP_USER": "x@example.com", "SMTP_PASS": "x"})
        send_real = smtp_send(env("FROM_NAME", "AGSIST"), "x@example.com")

        def from_after_send(m):
            send_real(m)
            return got[-1]
        pm = build(order("1"), {"proof": None, "letter": None, "words": WORDS}, "buyer@example.com")
        fmm = build_files(dict(order("1"), product="digital"), [], "buyer@example.com")
        ck("buyer emails: Sig at AGSIST with no RP_FROM_NAME, whatever FROM_NAME says",
           "Sig at AGSIST" in pm["From"] and "Sig at AGSIST" in fmm["From"] and "Sig at AGSIST" in from_after_send(pm) and "Sig at AGSIST" in from_after_send(fmm),
           (pm["From"], fmm["From"]))
        ck("Sig's own note keeps FROM_NAME", "AGSIST Daily" in from_after_send(sig_note(order("1"), "sig@farmers1st.com", "x")))
        os.environ["RP_FROM_NAME"] = "Sig Lindquist"
        ck("RP_FROM_NAME changes only the buyer emails", "Sig Lindquist" in build(order("1"), {"proof": None, "letter": None, "words": WORDS}, "b@example.com")["From"])
    finally:
        smtplib.SMTP = real_smtp
        for k in ENVS:
            os.environ.pop(k, None)
        os.environ.update(keep)

    print("\nthe files (a digital file, the moment the buyer approves)")
    ap_at = {"at": "2026-10-21T15:00:00.000Z"}
    dig = lambda key="5", **kw: order(key, product="digital", serial=None, paid={"amount": 19, "session": kw.pop("session", "cs_live_5")},  # noqa: E731
                                      mailed={"at": "x"}, approved=kw.pop("approved", ap_at), approved_alerted={"at": "x"}, fulfill_url=SIG_URL + "&maker=1", **kw)
    sent.clear()
    f = Fake({"stripe": "ok", "orders": [dig()]}, {"cs_live_5": live})
    code, log = run(f, False, lambda m: (f.calls.append(("send",)), sent.append(m)), "sig@farmers1st.com", tests)
    fm = [m for m in sent if m["Subject"].startswith("Your Rain Print files:")]
    ck("approved: one files email, to the buyer", code == 0 and len(fm) == 1 and fm[0]["To"] == "buyer@example.com", [(m["To"], m["Subject"]) for m in sent])
    ck("subject: the files, the town and year", fm and fm[0]["Subject"] == "Your Rain Print files: Chetek, WI, 2025", fm and fm[0]["Subject"])
    ck("marked delivered before the send, by email", f.delivered == {dig()["key"]: "email"} and f.calls.index(("worker", "rp-order/delivered")) < f.calls.index(("send",)), f.calls)
    att = [(p.get_filename(), p.get_content_type()) for p in fm[0].iter_attachments()] if fm else []
    ck("attached: the PDF, the PNG, the JPG and the reading guide", att == [
        ("rain-print-chetek-wi-2025-r1-12x18-300dpi.pdf", "application/pdf"), ("rain-print-chetek-wi-2025-r1-12x18-300dpi.png", "image/png"),
        ("rain-print-chetek-wi-2025-r1-12x18-300dpi.jpg", "image/jpeg"), ("rain-print-chetek-wi-2025-r1-how-to-read.pdf", "application/pdf")], att)
    ftxt = fm[0].get_body(("plain",)).get_content() if fm else ""
    fhtm = fm[0].get_body(("html",)).get_content() if fm else ""
    ck("the printing tips: 100%, no fit to page, matte, the 3:2 sizes, a shop or a service", all(x in ftxt and H.escape(x) in fhtm for x in (
        "Print the PDF at 100% (Actual size). Turn off Fit to page and Scale to fit", "heavy matte paper", "8 x 12 or 16 x 24 in",
        "A print shop or an online print service")), ftxt)
    ck("each file said in plain words, the guide too", "one page on how to read your print" in ftxt and "12 x 18 in at 300 dpi" in ftxt and "5400 x 3600 px" in ftxt, ftxt)
    ck("Reply-To Sig, reply line, no em dashes, no sponsor", fm and fm[0]["Reply-To"] == "sig@farmers1st.com" and "Reply to this email" in ftxt
       and "\u2014" not in ftxt + fhtm and "sponsor" not in (ftxt + fhtm).lower())
    notes_ = [m for m in sent if m["Subject"].startswith("Rain Print files sent:")]
    ck("Sig's one-line note: the files went, no buyer details", len(notes_) == 1 and notes_[0]["To"] == "sig@farmers1st.com"
       and notes_[0].get_content().strip().count("\n") == 0 and "@" not in notes_[0].get_content() and "buyer@example.com" not in str(notes_[0]),
       [m.get_content() for m in notes_])
    ck("the log: counts only, no address, no place", any(x.startswith("files sent: 1;") for x in log)
       and all("@" not in x and "Chetek" not in x and "Gustum" not in x and SIG_REF not in x for x in log), log)
    sent.clear()
    run(f, False, send, "sig@farmers1st.com", tests)
    ck("once: a second run sends no files", not any(m["Subject"].startswith(("Your Rain Print files:", "Rain Print files sent:")) for m in sent), [m["Subject"] for m in sent])
    sent.clear()
    f = Fake({"stripe": "ok", "orders": [dig(delivered={"at": "x", "how": "email"})]}, {"cs_live_5": live})
    run(f, False, send, "sig@farmers1st.com", tests)
    ck("a record already delivered: skipped without asking Stripe", sent == [] and not any(c[0] in ("session", "render files") for c in f.calls), f.calls)
    f = Fake({"stripe": "ok", "orders": [dig()]}, {"cs_live_5": live})
    run(f, True, send, "sig@farmers1st.com", tests)
    ck("dry run: the files email to Sig only, nothing marked, no note", [m["To"] for m in sent] == ["sig@farmers1st.com"]
       and sent[0]["Subject"] == "[dry run, would go to the buyer] Your Rain Print files: Chetek, WI, 2025" and not f.delivered, [m["Subject"] for m in sent])
    sent.clear()
    f = Fake({"stripe": "ok", "orders": [dig(session="cs_test_6")]}, {"cs_test_6": {"livemode": False, "email": "buyer@example.com"}})
    run(f, False, send, "sig@farmers1st.com", tests)
    ck("a test-mode session: the files to Sig only", [m["To"] for m in sent] == ["sig@farmers1st.com"], [m["To"] for m in sent])
    sent.clear()
    f = Fake({"stripe": "ok", "orders": [dig(approved=None), order("7", approved=ap_at, mailed={"at": "x"}, approved_alerted={"at": "x"})]}, {"cs_live_5": live, "cs_live_1": live})
    run(f, False, send, "sig@farmers1st.com", tests)
    ck("not approved, or a print: no files", sent == [] and not any(c[0] == "render files" for c in f.calls), [m["Subject"] for m in sent])
    f = Fake({"stripe": "ok", "orders": [dig()]}, {"cs_live_5": live}, render_fail=True)
    code, log = run(f, False, send, "sig@farmers1st.com", tests)
    ck("the files fail to render: nothing sent, nothing marked (the next run tries again)", sent == [] and not f.delivered and any("files render failed: 1" in x for x in log), log)
    f = Fake({"stripe": "ok", "orders": [dig()]}, {"cs_live_5": live})
    code, log = run(f, False, lambda m: (_ for _ in ()).throw(OSError("smtp")), "sig@farmers1st.com", tests)
    ck("a send that fails after the mark: exit 1, counted", code == 1 and any("files marked, send failed: 1" in x for x in log), log)
    f = Fake({"stripe": "ok", "orders": [dig()]}, {"cs_live_5": {"livemode": True, "email": ""}})
    code, log = run(f, False, send, "sig@farmers1st.com", tests)
    ck("no address: nothing, counted", sent == [] and not f.delivered and any("files no address: 1" in x for x in log), log)
    forms = [{"kind": "rain-print-order", "design_code": SIG_REF, "gift": "yes", "gift_to": "Dad Olson", "gift_message": "For every inch you farmed",
              "email": "buyer@example.com", "name": "Jane Buyer"}]
    f = Fake({"stripe": "ok", "orders": [dig(gift=True)]}, {"cs_live_5": live}, forms=forms)
    sent.clear()
    run(f, False, send, "sig@farmers1st.com", tests)
    gtxt = sent[0].get_body(("plain",)).get_content() if sent else ""
    ck("a gift: the note goes on the reading guide, For: in the email, nothing else from the form", ("render files", "digital", "For every inch you farmed") in f.calls
       and "For: Dad Olson" in gtxt and "Jane" not in gtxt, (f.calls, gtxt[:300]))
    sent.clear()
    big = Fake({"stripe": "ok", "orders": [dig()]}, {"cs_live_5": live}, file_bytes={"pdf": 6 << 20, "png": 7 << 20, "jpg": 5 << 20, "guide": 1 << 20})
    run(big, False, send, "sig@farmers1st.com", tests)
    bm = [m for m in sent if m["Subject"].startswith("Your Rain Print files:")]
    ck("too big with the JPG: the JPG is left off and the email says so", bm and [p.get_filename().rsplit(".", 1)[1] for p in bm[0].iter_attachments()] == ["pdf", "png", "pdf"]
       and "The JPG was too big to attach with the rest. Reply to this email and I will send it." in bm[0].get_body(("plain",)).get_content(), [m["Subject"] for m in sent])
    sent.clear()
    huge = Fake({"stripe": "ok", "orders": [dig()]}, {"cs_live_5": live}, file_bytes={"pdf": 14 << 20, "png": 20 << 20, "jpg": 9 << 20, "guide": 2 << 20})
    code, log = run(huge, False, send, "sig@farmers1st.com", tests)
    ck("too big even as the PDF and guide: no buyer email, marked by hand once, Sig told with the maker link",
       [m["To"] for m in sent] == ["sig@farmers1st.com"] and "too big to attach" in sent[0].get_content() and SIG_URL + "&maker=1" in sent[0].get_content()
       and huge.delivered == {dig()["key"]: "hand"} and any("files by hand: 1" in x for x in log), ([m.get_content() for m in sent], log))
    ck("fit_files: under the cap all four go", [f_["kind"] for f_ in fit_files([{"kind": k, "bytes": 1} for k in ("pdf", "png", "jpg", "guide")])] == ["pdf", "png", "jpg", "guide"])
    f = Fake({"stripe": "ok", "orders": [dig()]}, {"cs_live_5": live})
    f.worker = (lambda orig: (lambda path, body=None, **q: (_ for _ in ()).throw(OSError("x")) if path == "form-list" else orig(path, body, **q)))(f.worker)
    sent.clear()
    code, log = run(f, False, send, "sig@farmers1st.com", tests)
    ck("gift notes unreadable: the files wait too", sent == [] and not f.delivered and any("files waiting: 1" in x for x in log), log)

    print("\nthe gift card (a this-year gift, at once; Sig 2026-10-20)")
    GIFT_URL = SIG_URL.replace("year=2025", "year=2026") + "&gift=1"
    # made-up giver on the order form post: their name and email must never reach the card email, the log or Sig's note
    gform = [{"design_code": "GIFT-" + SIG_REF, "gift_january": "yes", "gift_to": "Dad", "gift_message": "Every inch of the year you farmed.",
              "name": "Pat Example", "email": "pat@example.com", "address": "The shipping address given at Stripe checkout"}]

    def gorder(key="7", product="framed12x18", **kw):
        return order(key, product=product, session="cs_live_" + key, ref="GIFT-" + SIG_REF, gift=True, year=2026, design_url=GIFT_URL,
                     fulfill_url=GIFT_URL + "&maker=1", approve_t=None, **kw)
    gsent = []
    f = Fake({"stripe": "ok", "orders": [gorder()]}, {"cs_live_7": live}, forms=gform)
    code, log = run(f, False, lambda m: (f.calls.append(("send", m["Subject"])), gsent.append(m)), "sig@farmers1st.com", tests)
    cards = [m for m in gsent if m["Subject"].startswith("Your Rain Print gift card")]
    ck("a paid gift: one card email to the buyer", code == 0 and len(cards) == 1 and cards[0]["To"] == "buyer@example.com", [(m["To"], m["Subject"]) for m in gsent])
    ck("the subject names who it is for", cards[0]["Subject"] == "Your Rain Print gift card for Dad", cards[0]["Subject"])
    ck("the card issued once, for that order, with their words", f.issues == [{"order_key": gorder()["key"], "to": "Dad", "message": "Every inch of the year you farmed."}], f.issues)
    ck("marked gift-mailed before the send", f.calls.index(("gift-mailed",)) < f.calls.index(("send", cards[0]["Subject"])), f.calls)
    ck("sent as Sig at AGSIST, Reply-To Sig", getattr(cards[0], "rp_buyer", False) and cards[0]["From"].startswith("Sig at AGSIST") and cards[0]["Reply-To"] == "sig@farmers1st.com", cards[0]["From"])
    gh = cards[0].get_body(("html",)).get_content()
    gt = cards[0].get_body(("plain",)).get_content()
    link = "https://agsist.com/rp-gift?c=RP-7K3M-Q9TW-H07F&k=0123456789abcdef"
    ck("the card link as the big button", ('href="%s"' % H.escape(link)) in gh and ">Print the gift card</a>" in gh and "Print the gift card: " + link in gt, gh[:1500])
    ck("what they get: the framed print, shipping included, in plain words",
       "A framed Rain Print: the whole year printed on 13 x 19 heavy, textured cotton paper, in a black frame with a white mat and glass, ready to hang. Shipping is included." in gt
       and "every rain and snow of 2026 at the NOAA weather station nearest Chetek" in gt, gt)
    ck("how they use it: nothing to fill in, the square or the address, never expires",
       "There is nothing for Dad to fill in or pay. It is paid for, and it ships to the address you gave at checkout." in gt
       and "scan the square on the card with a phone camera, or go to agsist.com/rain-print?gift=RP-7K3M-Q9TW-H07F. The code never expires." in gt, gt)
    ck("when it comes: January, the proof first", "The 2026 print is made once the full year is in, in January 2027." in gt
       and "nothing is made until you approve it" in gt, gt)
    ck("print tips: the sizes and 100%", "8 x 10 card" in gt and "5 x 7 card" in gt and "half letter two up" in gt and "Print at 100% (Actual size)" in gt, gt)
    ck("the card at a glance: their name, the place, the message, the number and code",
       "For Dad" in gh and "Chetek, WI &middot; 2026" in gh and "Every inch of the year you farmed." in gh and "Card No. 0007" in gh and "RP-7K3M-Q9TW-H07F" in gh, gh)
    ck("no price and no giver details in the card email", "$" not in gh + gt and "89.00" not in gt and " 89" not in gt and "Pat" not in gh + gt and "pat@example.com" not in gh + gt, gt)
    notes_ = [m for m in gsent if m["Subject"].startswith("Rain Print gift card sent")]
    ck("Sig gets one line, no buyer details", len(notes_) == 1 and notes_[0]["To"] == "sig@farmers1st.com" and notes_[0]["Subject"] == "Rain Print gift card sent: Chetek, WI 2026"
       and "@" not in notes_[0].get_content() and "Pat" not in notes_[0].get_content() and "card No. 0007, ends H07F" in notes_[0].get_content(), [m["Subject"] for m in gsent])
    ck("the log: counts only (no address, name, place or code)", all("@" not in x and "Dad" not in x and "Pat" not in x and "Chetek" not in x and "RP-7K3M" not in x for x in log)
       and "cards sent: 1; cards to Sig: 0; cards waiting: 0; cards no address: 0; card not issued: 0; cards render failed: 0; cards marked, send failed: 0." in log, log)
    buyer_mail = [m for m in gsent if m["To"] == "buyer@example.com"]
    ck("ONE email to a this-year gift buyer: the card with the print so far, no separate preview email",
       len(buyer_mail) == 1 and buyer_mail[0] is cards[0] and not any(m["Subject"].startswith("Your Rain Print proof") for m in gsent), [m["Subject"] for m in gsent])
    rel = [p_ for p_ in cards[0].walk() if p_.get_content_type() == "image/jpeg"]
    ck("the print so far is in it, inline, under the card", len(rel) == 1 and rel[0]["Content-ID"] == "<proof>" and 'src="cid:proof"' in gh
       and gh.index("On the card") < gh.index("The print so far") < gh.index("What they get") and "The picture carries a preview mark; the print will not." in gh, gh[:400])
    ck("the preview was its proof email: marked mailed too, before the send", gorder()["key"] in f.marked
       and f.calls.index(("worker", "rp-order/mailed")) < f.calls.index(("send", cards[0]["Subject"])), f.calls)
    ck("rendered once, with the card's words as the gift note", [x for x in f.calls if x[0] == "render"] == [("render", "framed12x18", "Every inch of the year you farmed.")], f.calls)
    gsent.clear()
    run(f, False, lambda m: gsent.append(m), "sig@farmers1st.com", tests)
    ck("exactly once: a second run sends no card and makes no second card", not any(m["Subject"].startswith("Your Rain Print gift card") for m in gsent)
       and len({c_["code"] for c_ in f.cards.values()}) == 1, [m["Subject"] for m in gsent])
    gsent.clear()
    f = Fake({"stripe": "ok", "orders": [gorder(gift_mailed={"at": "x"})]}, {"cs_live_7": live}, forms=gform)
    run(f, False, lambda m: gsent.append(m), "sig@farmers1st.com", tests)
    ck("a record already gift-mailed: no card asked for, none sent", f.issues == [] and not any(m["Subject"].startswith("Your Rain Print gift card") for m in gsent))
    gsent.clear()
    f = Fake({"stripe": "ok", "orders": [gorder()]}, {"cs_live_7": live}, forms=gform)
    code, log = run(f, True, lambda m: gsent.append(m), "sig@farmers1st.com", tests)
    cards = [m for m in gsent if "Your Rain Print gift card" in m["Subject"]]
    ck("dry run: to Sig only, nothing issued or marked, a stand-in code", len(cards) == 1 and cards[0]["To"] == "sig@farmers1st.com"
       and cards[0]["Subject"] == "[dry run, would go to the buyer] Your Rain Print gift card for Dad" and f.issues == [] and not f.gift_mailed
       and "RP-XXXX-XXXX-XXXX" in cards[0].get_body(("plain",)).get_content() and not any(m["Subject"].startswith("Rain Print gift card sent") for m in gsent), [m["Subject"] for m in gsent])
    gsent.clear()
    f = Fake({"stripe": "ok", "orders": [gorder("8")]}, {"cs_live_8": {"livemode": False, "email": "buyer@example.com"}}, forms=gform)
    run(f, False, lambda m: gsent.append(m), "sig@farmers1st.com", tests)
    ck("a test-mode session: the card email to Sig only", [m["To"] for m in gsent if m["Subject"].startswith("Your Rain Print gift card")] == ["sig@farmers1st.com"], [m["To"] for m in gsent])
    gsent.clear()
    f = Fake({"stripe": "ok", "orders": [gorder()]}, {"cs_live_7": live}, forms=gform)
    f.issue_fail = True
    code, log = run(f, False, lambda m: gsent.append(m), "sig@farmers1st.com", tests)
    ck("the card can't be issued: nothing sent, nothing marked, counted", not any("gift card" in m["Subject"] for m in gsent) and not f.gift_mailed
       and any("card not issued: 1" in x for x in log), log)
    f = Fake({"stripe": "ok", "orders": [gorder()]}, {"cs_live_7": live}, forms=gform)
    code, log = run(f, False, lambda m: (_ for _ in ()).throw(OSError("smtp")) if "gift card" in m["Subject"] else None, "sig@farmers1st.com", tests)
    ck("a card send that fails after the mark: exit 1, counted", code == 1 and any("cards marked, send failed: 1" in x for x in log), log)
    gsent.clear()
    f = Fake({"stripe": "ok", "orders": [gorder("9", product="digital")]}, {"cs_live_9": live}, forms=[])
    run(f, False, lambda m: gsent.append(m), "sig@farmers1st.com", tests)
    cards = [m for m in gsent if m["Subject"].startswith("Your Rain Print gift card")]
    dt = cards[0].get_body(("plain",)).get_content() if cards else ""
    ck("a digital gift with no order form post: the file in plain words, a plain subject",
       cards and cards[0]["Subject"] == "Your Rain Print gift card, ready to print" and "the whole year as a PDF, a PNG and a JPG at 12 x 18 in, 300 dpi" in dt
       and "The 2026 file is made once the full year is in" in dt and "the files come by email to you" in dt and f.issues[0]["to"] == "", dt)
    gsent.clear()
    f = Fake({"stripe": "ok", "orders": [gorder()]}, {"cs_live_7": live}, forms=gform)
    f.worker = (lambda orig: (lambda path, body=None, **q: (_ for _ in ()).throw(OSError("x")) if path == "form-list" else orig(path, body, **q)))(f.worker)
    code, log = run(f, False, lambda m: gsent.append(m), "sig@farmers1st.com", tests)
    ck("gift notes unreadable: the card waits (its words could be missed)", f.issues == [] and any("cards waiting: 1" in x for x in log), log)
    f = Fake({"stripe": "ok", "orders": [order("1")]}, {"cs_live_1": live})
    run(f, False, lambda m: None, "sig@farmers1st.com", tests)
    ck("an order that is not a gift gets no card", f.issues == [])
    gsent.clear()
    f = Fake({"stripe": "ok", "orders": [gorder(gift_mailed={"at": "x"})]}, {"cs_live_7": live}, forms=gform)
    run(f, False, lambda m: gsent.append(m), "sig@farmers1st.com", tests)
    ck("a gift whose card email went (even if its mailed mark was lost): no second email of any kind", gsent == [] and not f.marked, [m["Subject"] for m in gsent])
    gsent.clear()
    f = Fake({"stripe": "ok", "orders": [gorder(mailed={"at": "x", "session": "cs_live_7"})]}, {"cs_live_7": live}, forms=gform)
    run(f, False, lambda m: gsent.append(m), "sig@farmers1st.com", tests)
    ck("a gift whose preview went before this change: the card email still goes, once, and mailed is not asked again",
       [m["Subject"] for m in gsent if m["To"] == "buyer@example.com"] == ["Your Rain Print gift card for Dad"] and ("worker", "rp-order/mailed") not in f.calls, f.calls)
    gsent.clear()
    f = Fake({"stripe": "ok", "orders": [gorder()]}, {"cs_live_7": live}, forms=gform, render_fail=True)
    code, log = run(f, False, lambda m: gsent.append(m), "sig@farmers1st.com", tests)
    ck("the picture fails: nothing sent, issued or marked; the next run tries again", not any(m["To"] == "buyer@example.com" for m in gsent)
       and f.issues == [] and not f.marked and not f.gift_mailed and any("cards render failed: 1" in x for x in log), log)
    gsent.clear()
    f = Fake({"stripe": "ok", "orders": [gorder(), order("1")]}, {"cs_live_7": live, "cs_live_1": live}, forms=gform)
    run(f, True, lambda m: gsent.append(m), "sig@farmers1st.com", tests)
    ck("dry run, a gift and a plain order: one email each, both to Sig", sorted(m["Subject"] for m in gsent) ==
       ["[dry run, would go to the buyer] Your Rain Print gift card for Dad", "[dry run, would go to the buyer] Your Rain Print proof: Chetek, WI, 2025"]
       and all(m["To"] == "sig@farmers1st.com" for m in gsent), [m["Subject"] for m in gsent])
    ck("card_ok: the worker's answer is checked", card_ok({"ok": True, "code": "RP-7K3M-Q9TW-H07F", "card_url": link})
       and not card_ok({"ok": True, "code": "RP-7K3M-Q9TW-H07F", "card_url": "https://evil.example/x"}) and not card_ok({"ok": False}) and not card_ok(None))

    print()
    if fails:
        print("%d FAILED: %s" % (len(fails), "; ".join(fails)))
        return 1
    print("rp_buyer_email: all checks pass")
    return 0


def sample(out):
    """The email as a page, from a made-up gift order, with the pictures RENDER_DIR holds (proof.jpg, letter.jpg)."""
    d = env("RENDER_DIR", "")
    srcs = {}
    for k in ("proof", "letter"):
        p = os.path.join(d, k + ".jpg")
        srcs[k] = ("data:image/jpeg;base64," + base64.b64encode(open(p, "rb").read()).decode()) if d and os.path.exists(p) else ""
    words = json.loads(env("RENDER_WORDS", "null") or "null") or WORDS
    o = order("1", gift_note="For every inch you farmed")
    with open(out, "w", encoding="utf-8") as f:
        f.write(html_body(o, {"letter": srcs["letter"], "words": words}, "Dad Olson", srcs))
    return 0


def sample_gift(out):
    """The gift card email as a page, from a made-up this-year gift (the card link is a stand-in)."""
    o = order("7", ref="GIFT-" + SIG_REF, gift=True, year=2026, approve_t=None)
    card = {"ok": True, "code": "RP-7K3M-Q9TW-H2F4", "no": 7, "prepaid": True, "card_url": CARD_BASE + "?c=RP-7K3M-Q9TW-H2F4&k=0123456789abcdef"}
    with open(out, "w", encoding="utf-8") as f:
        p = os.path.join(env("RENDER_DIR", ""), "proof.jpg")
        pic = ("data:image/jpeg;base64," + base64.b64encode(open(p, "rb").read()).decode()) if env("RENDER_DIR") and os.path.exists(p) else ""
        f.write(gift_html(o, card, "Dad", "Every inch of the year you farmed. Love, Kate", pic))
    return 0


def sample_files(out):
    """The files email as a page, from a made-up gift order (FILES_DIR: the real files, for their names)."""
    d = env("FILES_DIR", "")
    kinds = {".pdf": "pdf", ".png": "png", ".jpg": "jpg"}
    files = []
    for n in sorted(os.listdir(d)) if d and os.path.isdir(d) else []:
        k = "guide" if n.endswith("-how-to-read.pdf") else kinds.get(os.path.splitext(n)[1])
        if k:
            files.append({"kind": k, "name": n, "path": os.path.join(d, n), "bytes": os.path.getsize(os.path.join(d, n))})
    files.sort(key=lambda f: ["pdf", "png", "jpg", "guide"].index(f["kind"]))
    if not files:
        files = [{"kind": k, "name": "rain-print-chetek-wi-2025-r1-" + n, "path": "", "bytes": 1} for k, n in
                 (("pdf", "12x18-300dpi.pdf"), ("png", "12x18-300dpi.png"), ("jpg", "12x18-300dpi.jpg"), ("guide", "how-to-read.pdf"))]
    o = order("1", product="digital", gift=True)
    with open(out, "w", encoding="utf-8") as f:
        f.write(files_html(o, files, "Dad Olson"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
