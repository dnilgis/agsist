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
                session comes in by Stripe's webhook (worker v5.35, which
                also starts this job at once) or by the worker's poll.
  Once only     the record is marked mailed (POST /rp-order/mailed) BEFORE the
                send, so a crash or a rerun can never send it twice; a send
                that fails after the mark is counted in the log for Sig.
  Sig only      DRY_RUN=1 sends every email to Sig (SIG_TO, default
                sig@farmers1st.com) and marks nothing. A test-mode session
                (livemode false) or a buyer address in SIG_TEST_EMAILS (and
                SIG_TO) goes to Sig only.

    python3 scripts/rp_buyer_email.py              send what is due
    DRY_RUN=1 python3 scripts/rp_buyer_email.py    every email to Sig, nothing marked
    python3 scripts/rp_buyer_email.py --selftest   fixtures, no network, no mail
    python3 scripts/rp_buyer_email.py --sample out.html   the email as a page (made-up order), for a look

Env: LIST_URL, LIST_TOKEN, SMTP_USER, SMTP_PASS. Optional:
SMTP_HOST, SMTP_PORT, FROM_ADDR, FROM_NAME, SIG_TO, SIG_TEST_EMAILS (comma
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

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPLY_TO = "sig@farmers1st.com"
ADDRESS = "AGSIST, PO Box 243, Chetek, WI 54728"
PRODUCT = {"digital": "digital file", "print12x18": "13 x 19 print", "framed12x18": "13 x 19 framed print"}
STYLE = {"r1": "Staircase", "r2": "Roots"}
EMAIL_RE = re.compile(r"^[^\s@<>\"]+@[^\s@<>\"]+\.[^\s@<>\"]{2,}$")
URL_RE = re.compile(r"^https://agsist\.com/rain-print\?[A-Za-z0-9%+._~=&-]+$")
DAYS = 7


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


# ───────────────────────────── the email ─────────────────────────────

def what_line(o):
    place = one_line(o.get("place"), 80)
    style = STYLE.get(o.get("style"), "")
    year = str(o.get("year") or "")
    return "%s of %s%s%s" % (PRODUCT.get(o.get("product"), "Rain Print"), place or "your place",
                             (", " + year) if year else "", (", " + style) if style else "")


def subject(o):
    place, year = one_line(o.get("place"), 80), str(o.get("year") or "")
    return "Your Rain Print of %s%s" % (place or "your place", (", " + year) if year else "")


def next_lines(words):
    """The thank-you page's lines, without its last one (the reply line below says it)."""
    w = [one_line(x, 400) for x in (words or []) if one_line(x, 400)]
    return w[:-1] if len(w) > 1 else w


def text_body(o, r, gift_to=""):
    out = ["Thank you for ordering a Rain Print.", "", "You ordered: a %s." % what_line(o)]
    if gift_to:
        out.append("For: %s" % gift_to)
    out += ["", "Your design is in the picture in this email, as you ordered it. The picture carries a preview mark; your %s will not."
            % ("file" if o.get("product") == "digital" else "print")]
    if r.get("letter"):
        out += ["", "The letter in the box: it goes on top of the print, %s, exactly as it will print. The picture of it is in this email."
                % ("with your note" if o.get("gift_note") else "so whoever opens it knows what it is")]
    out += [""] + next_lines(r.get("words")) + ["", "Something wrong? Reply to this email and I will fix it.", "", "Sig", "", ADDRESS]
    return "\n".join(out) + "\n"


def html_body(o, r, gift_to="", srcs=None):
    """Phone first, Gmail safe: one 600 px table, inline styles only, images by cid (or srcs for a sample)."""
    srcs = srcs or {"proof": "cid:proof", "letter": "cid:letter"}
    e = H.escape
    font = "font-family:Georgia,'Times New Roman',serif;"
    p = lambda t, extra="": ('<p style="margin:0 0 14px;%sfont-size:17px;line-height:1.5;color:#1E2125;%s">%s</p>' % (font, extra, t))  # noqa: E731
    rows = []
    rows.append('<tr><td style="padding:24px 20px 6px;"><p style="margin:0 0 6px;font-family:Arial,Helvetica,sans-serif;font-size:13px;'
                'letter-spacing:1px;text-transform:uppercase;color:#5E6475;">AGSIST Rain Print</p>'
                '<h1 style="margin:0 0 14px;%sfont-size:26px;line-height:1.25;font-weight:normal;color:#1E2125;">Here is your Rain Print</h1>' % font
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
    rows.append('<tr><td style="padding:0 20px 8px;"><h2 style="margin:0 0 10px;%sfont-size:20px;font-weight:normal;color:#1E2125;">'
                'What happens next</h2>' % font + "".join(p(e(x)) for x in next_lines(r.get("words"))) + "</td></tr>")
    rows.append('<tr><td style="padding:0 20px 24px;">' + p("<b>Something wrong?</b> Reply to this email and I will fix it.")
                + p("Sig", "margin-top:18px;") +
                '<p style="margin:18px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.4;color:#5E6475;">%s</p></td></tr>'
                % e(ADDRESS))
    return ('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            '<title>%s</title></head><body style="margin:0;padding:0;background:#F4F3EE;">'
            '<table role="presentation" width="100%%" cellpadding="0" cellspacing="0" border="0" style="background:#F4F3EE;"><tr><td align="center" style="padding:12px 8px;">'
            '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%%;max-width:600px;background:#FFFFFF;">'
            '%s</table></td></tr></table></body></html>') % (e(subject(o)), "".join(rows))


def build(o, r, to, gift_to="", fn="AGSIST", fa="", dry=False):
    m = EmailMessage()
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
           and (o.get("paid") or {}).get("session") and URL_RE.match(str(o.get("design_url") or "")) and o.get("product") in PRODUCT]
    log.append("Paid and not yet mailed: %d." % len(due))
    try:
        notes = gift_notes(src, {o["ref"] for o in due})
    except Exception as e:                                 # noqa: BLE001
        notes = None
        log.append("Gift notes could not be read (%s); every order waits for the next run." % type(e).__name__)
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
    return (1 if counts["marked, send failed"] or ac["alert failed"] else 0), log


def smtp_send(fn, fa):
    def send(m):
        if not (env("SMTP_USER") and env("SMTP_PASS")):
            raise RuntimeError("no SMTP_USER / SMTP_PASS")
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
    return send


def main():
    if "--selftest" in sys.argv:
        return selftest()
    if "--sample" in sys.argv:
        return sample(sys.argv[sys.argv.index("--sample") + 1])
    dry = env("DRY_RUN") == "1"
    sig_to = env("SIG_TO", REPLY_TO)
    tests = {x.strip().lower() for x in (env("SIG_TEST_EMAILS", "") or "").split(",") if x.strip()} | {sig_to.lower(), REPLY_TO}
    src = Sources(env("LIST_URL", ""), env("LIST_TOKEN", ""))
    fn, fa = env("FROM_NAME", "AGSIST"), env("FROM_ADDR") or env("SMTP_USER") or ""
    code, log = run(src, dry, smtp_send(fn, fa), sig_to, tests)
    for line in log:
        print(line)
    return code


# ───────────────────────────── selftest ─────────────────────────────

SIG_URL = ("https://agsist.com/rain-print?place=Chetek%2C+WI&year=2025&station=471667+2&layout=staircase&palette=paper"
           "&size=12x18&style=r1&name=Gustum+Farm&m1=2025-04-01+Moved+in")
SIG_REF = "MnxDaGV0ZWssIFdJfDQ3MTY2NyAyfDIwMjV8c3AwYWF8R3VzdHVtIEZhcm18Mml8TW92ZWQgaW4"
WORDS = ["Your 13 x 19 framed print of Chetek, WI, 2025 is ordered. I email you a proof from sig@farmers1st.com by Wed Oct 21. Reply OK, or tell me what to change.",
         "It ships within 3 business days after your OK, and ordered by Dec 9 it arrives by Christmas.",
         "Nothing by then? Check spam, or write to me at sig@farmers1st.com."]


def order(key, product="framed12x18", session="cs_live_1", **kw):
    o = {"key": "rpo:17610000000%s:0000000%s" % (key, key), "ts": 1761000000000, "ref": SIG_REF, "product": product,
         "design_url": SIG_URL, "place": "Chetek, WI", "year": 2025, "style": "r1", "name": "Gustum Farm", "gift": False,
         "status": "paid", "paid": {"amount": 89, "session": session}, "mailed": None, "alerted": {"at": "x", "session": session},
         "fulfill_url": SIG_URL + "&maker=1&serial=4", "serial": 4}
    o.update(kw)
    return o


class Fake(Sources):
    def __init__(self, listing, sessions, forms=None, render_fail=False, mark_fail=False):
        super().__init__("https://w.dev", "tok")
        self.listing, self.sessions, self.forms = listing, sessions, forms or []
        self.render_fail, self.mark_fail = render_fail, mark_fail
        self.calls, self.marked, self.alerted = [], set(), set()

    def worker(self, path, body=None, **q):
        self.calls.append(("worker", path))
        if path == "rp-order/list":
            return self.listing
        if path == "form-list":
            return self.forms
        if path == "rp-order/alerted":
            k = body["key"]
            already = k in self.alerted
            self.alerted.add(k)
            return {"ok": True, "already": already}
        if path == "rp-order/buyer":
            if self.listing.get("stripe") != "ok":   # the worker reads the address with its read key, or not at all
                raise urllib.error.HTTPError("https://w.dev/x", 503, "no key", {}, None)
            return {"ok": True, **self.session(q["key"])}
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
    ck("subject: the town and year", m["Subject"] == "Your Rain Print of Chetek, WI, 2025", m["Subject"])
    ck("what was bought", "13 x 19 framed print of Chetek, WI, 2025, Staircase" in txt and "13 x 19 framed print of Chetek, WI, 2025, Staircase" in htm, txt)
    ck("who it is for", "For: Dad Olson" in txt and "For: <b>Dad Olson</b>" in htm)
    ck("the next steps from the page, without its last line", WORDS[0] in txt and WORDS[1] in txt and WORDS[2] not in txt, txt)
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


if __name__ == "__main__":
    sys.exit(main())
