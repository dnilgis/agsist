#!/usr/bin/env python3
"""
"Email me this design" on /rain-print (Sig, 2026-10-20: "do all"). A reader
who drew a print and did not buy can ask for it by email: the link to their
own design now, and ONE reminder the next day if no paid order matches it.
Then nothing.

  Which asks    the subs worker's GET /rp-remind/list (worker v5.43, Bearer
                LIST_TOKEN): {key, email, code, ref, ts, sent, reminded, done,
                stop_t}, kept 7 days.
  The link      https://agsist.com/rain-print?d=<code>: the design code the
                page made, which opens with their print first, as they left it.
  Now           a row not yet sent gets "Your Rain Print design: <town>,
                <year>", marked sent (POST /rp-remind/mark) BEFORE the send,
                so a rerun can never send it twice.
  Next day      from REMIND_AFTER_H hours after the ask, one reminder, marked
                reminded first, unless a paid order matches the design, in
                which case the row is marked done and nothing goes. A paid
                order matches when its ref (GIFT- left off) is the design's
                code or its RPS ref, or it is for the same town and year and
                was pressed after the ask (less a day), or Stripe's buyer
                address for it (GET /rp-order/buyer) is the reader's. If the
                order records cannot be read, no reminder goes this run.
                Past GIVE_UP_H hours with no reminder sent, the row is marked
                done: a reminder a week late is not the next day.
  Words         plain, Sig's voice. The reminder carries the Christmas
                order-by dates from data/rain-print.json for a past year
                while they hold (October 1 to the cutoff), never a countdown,
                and Sig's guarantee. Every email has a stop link
                (/rp-remind/stop) and says it is the only reminder.
  Log           counts only: never an address, a town or a design.
  Sig only      DRY_RUN=1 sends each new ask's emails to Sig (SIG_TO) and
                marks nothing; it skips asks older than DRY_FRESH_H hours, so
                a dry run does not resend old asks every time.

NO SCHEDULE (Sig must OK one): it runs when the worker starts it on each new
ask (GH_DISPATCH_TOKEN), which also sends any reminder already due. For the
reminder to go out on time without a new ask, the workflow needs a schedule,
for example hourly.

    python3 scripts/rp_design_email.py              send what is due
    DRY_RUN=1 python3 scripts/rp_design_email.py    to Sig only, nothing marked
    python3 scripts/rp_design_email.py --selftest   fixtures, no network, no mail

Env: LIST_URL, LIST_TOKEN, SMTP_USER, SMTP_PASS. Optional: SMTP_HOST,
SMTP_PORT, FROM_ADDR, RP_FROM_NAME (default "Sig at AGSIST"), SIG_TO.
Run by .github/workflows/rp-design-email.yml.
"""
import base64
import datetime as dt
import html as H
import json
import os
import re
import smtplib
import ssl
import sys
import urllib.parse
import urllib.request
from email.message import EmailMessage
from email.utils import formataddr, make_msgid

try:
    from zoneinfo import ZoneInfo
    CHICAGO = ZoneInfo("America/Chicago")
except Exception:                                          # noqa: BLE001
    CHICAGO = dt.timezone(dt.timedelta(hours=-6))

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPLY_TO = "sig@farmers1st.com"
ADDRESS = "AGSIST, PO Box 243, Chetek, WI 54728"
FROM_NAME = "Sig at AGSIST"
SITE = "https://agsist.com/rain-print"
EMAIL_RE = re.compile(r"^[^\s@<>\"]+@[^\s@<>\"]+\.[^\s@<>\"]{2,}$")
CODE_RE = re.compile(r"^[A-Za-z0-9_-]{8,400}$")
REF_RE = re.compile(r"^RPS-[0-9A-HJKMNP-TV-Z]{5,8}$")
REMIND_AFTER_H = 20
GIVE_UP_H = 72
DRY_FRESH_H = 2
GUARANTEE = "If it\u2019s not right, I\u2019ll redo it or refund it."
STORY = "Made by a crop adviser in Chetek, Wisconsin, from NOAA\u2019s own records."
MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def env(name, default=None):
    v = os.environ.get(name)
    return v if v not in (None, "") else default


def one_line(v, cap):
    return " ".join(str(v or "").split())[:cap]


def design_of(code):
    """(place, year) from a design code (components/rain-print.js encodeCode: base64url of 2|place|station|year|...)."""
    try:
        b = code.replace("-", "+").replace("_", "/")
        f = base64.b64decode(b + "=" * (-len(b) % 4)).decode("utf-8").split("|")
        if f[0] not in ("1", "2") or len(f) < 6:
            return None
        y = int(f[3])
        place = one_line(f[1], 80)
        return (place, y) if place and 1850 <= y <= 2100 else None
    except Exception:                                      # noqa: BLE001
        return None


def link_of(code):
    return SITE + "?d=" + code


def short_date(iso):
    m = re.match(r"^\d{4}-(\d{2})-(\d{2})$", str(iso or ""))
    return "%s %d" % (MON[int(m.group(1)) - 1], int(m.group(2))) if m else ""


def xmas_line(prices, today, year):
    """The Christmas order-by dates for a past year, October 1 through each cutoff (the page's buyLine); else ''."""
    if not isinstance(prices, dict) or year >= int(today[:4]):
        return ""
    out = []
    for key, word in (("framed_christmas_cutoff", "framed"), ("print_christmas_cutoff", "as a print")):
        c = str(prices.get(key) or "")
        if re.match(r"^\d{4}-\d{2}-\d{2}$", c) and c[:4] + "-10-01" <= today <= c:
            out.append("%s by %s" % (word, short_date(c)))
    if not out:
        return ""
    return "Order it " + ", or ".join(out) + " for Christmas delivery."


# ───────────────────────────── sources ─────────────────────────────

class Sources:
    """Every outside call goes through here, so the selftest can hand in fixtures."""

    def __init__(self, list_url="", list_token=""):
        u = urllib.parse.urlsplit((list_url or "").strip())
        self.base = "%s://%s" % (u.scheme, u.netloc) if u.scheme and u.netloc else ""
        self.token = (list_token or "").strip()

    def worker(self, path, body=None, **q):
        if not (self.base and self.token):
            raise LookupError("no LIST_URL / LIST_TOKEN")
        url = "%s/%s%s" % (self.base, path, ("?" + urllib.parse.urlencode(q)) if q else "")
        data = json.dumps(body).encode() if body is not None else None
        h = {"User-Agent": "agsist-rp-design-email", "Authorization": "Bearer %s" % self.token}
        if data is not None:
            h["Content-Type"] = "application/json"
        with urllib.request.urlopen(urllib.request.Request(url, data=data, headers=h), timeout=30) as r:
            return json.loads(r.read().decode())

    def buyer(self, key):
        """Stripe's address for one paid order, read by the worker now; '' when it cannot be read."""
        try:
            d = self.worker("rp-order/buyer", key=key)
            return str(d.get("email") or "").strip().lower() if d.get("ok") else ""
        except Exception:                                  # noqa: BLE001
            return ""

    def prices(self):
        with open(os.path.join(ROOT, "data", "rain-print.json"), encoding="utf-8") as f:
            return json.load(f)


# ───────────────────────────── matching ─────────────────────────────

def paid_match(row, orders, buyer_of):
    """True when a paid order is for this design (see the top of this file)."""
    want = {row.get("code") or ""} | ({row["ref"]} if row.get("ref") else set())
    d = design_of(row.get("code") or "")
    for o in orders:
        if o.get("status") != "paid" and not o.get("paid"):
            continue
        ref = re.sub(r"^GIFT-", "", str(o.get("ref") or ""))
        if ref and ref in want:
            return True
        if d and one_line(o.get("place"), 80).lower() == d[0].lower() and o.get("year") == d[1] and (o.get("ts") or 0) >= (row.get("ts") or 0) - 864e5:
            return True
        if (o.get("ts") or 0) >= (row.get("ts") or 0) - 864e5 and o.get("key") and buyer_of(o["key"]) == str(row.get("email") or "").lower():
            return True
    return False


# ───────────────────────────── the emails ─────────────────────────────

def stop_url(base, row):
    return "%s/rp-remind/stop?k=%s&t=%s" % (base, urllib.parse.quote(row["key"], safe=""), urllib.parse.quote(str(row.get("stop_t") or ""), safe=""))


def words(row, stage, prices, today):
    """(subject, [paragraphs], link) for 'now' or 'reminder'."""
    place, year = design_of(row["code"]) or ("your town", 0)
    what = "%s, %d" % (place, year) if year else place
    link = link_of(row["code"])
    if stage == "now":
        return ("Your Rain Print design: %s" % what, [
            "Here\u2019s the Rain Print you made: %s. It opens with your print just as you left it. Change anything you like there, or order it when you\u2019re ready." % what,
            "I\u2019ll send one reminder tomorrow unless you order it. Then nothing more about it.",
        ], link)
    xm = xmas_line(prices, today, year) if year else ""
    if year and year >= int(today[:4]):
        xm = "A %d print ships in January %d, once the full year is in." % (year, year + 1)
    return ("Your Rain Print of %s is still here" % what, [p for p in [
        "You made a Rain Print of %s yesterday. Here it is again, as you left it." % what,
        xm,
        GUARANTEE,
        "This is the only reminder. I won\u2019t write about it again.",
    ] if p], link)


def build(row, stage, to, base, prices, today):
    subject, paras, link = words(row, stage, prices, today)
    stop = stop_url(base, row) if base and row.get("stop_t") else ""
    foot = [STORY, ADDRESS + ". You got this because you asked for it on agsist.com/rain-print."]
    m = EmailMessage()
    m["Subject"] = subject
    m["To"] = to
    m["From"] = formataddr((FROM_NAME, ""))
    m["Reply-To"] = REPLY_TO
    m["Message-ID"] = make_msgid(domain="agsist.com")
    if stop and stage == "now":
        m["List-Unsubscribe"] = "<%s>" % stop
    text = "\n\n".join(paras[:1] + [link] + paras[1:]
                       + (["Don\u2019t want the reminder? " + stop] if stop and stage == "now" else [])
                       + ["Sig"] + foot) + "\n"
    m.set_content(text)
    p = "".join('<p style="margin:0 0 14px">%s</p>' % H.escape(x) for x in paras[1:])
    btn = ('<p style="margin:18px 0"><a href="%s" style="display:inline-block;padding:12px 20px;background:#D9A441;color:#1a1a1a;'
           'font-weight:700;text-decoration:none;border-radius:6px">See your print</a></p>' % H.escape(link))
    stop_h = ('<p style="margin:0 0 14px;color:#555">Don\u2019t want the reminder? <a href="%s" style="color:#555">Stop it</a>.</p>' % H.escape(stop)
              if stop and stage == "now" else "")
    m.add_alternative(
        '<!doctype html><html><body style="margin:0;padding:16px;font-family:Georgia,serif;font-size:16px;line-height:1.5;color:#1a1a1a;max-width:560px">'
        '<p style="margin:0 0 14px">%s</p>%s%s%s<p style="margin:0 0 18px">Sig</p>'
        '<p style="margin:0;font-size:13px;color:#666">%s<br>%s</p></body></html>'
        % (H.escape(paras[0]), btn, p, stop_h, H.escape(foot[0]), H.escape(foot[1])), subtype="html")
    return m


# ───────────────────────────── run ─────────────────────────────

def run(src, dry, send, sig_to, now_ms=None, today=None):
    """-> (exit code, log lines). Counts only in the log."""
    now_ms = now_ms if now_ms is not None else int(dt.datetime.now(dt.timezone.utc).timestamp() * 1000)
    today = today or dt.datetime.now(CHICAGO).date().isoformat()
    try:
        d = src.worker("rp-remind/list")
    except Exception as e:                                 # noqa: BLE001
        return 0, ["Design asks could not be read (%s); nothing sent." % type(e).__name__]
    rows = [r for r in d.get("rows") or [] if isinstance(r, dict) and isinstance(r.get("key"), str)
            and CODE_RE.match(str(r.get("code") or "")) and EMAIL_RE.match(str(r.get("email") or ""))
            and (not r.get("ref") or REF_RE.match(str(r["ref"])))]
    try:
        prices = src.prices()
    except Exception:                                      # noqa: BLE001
        prices = {}
    orders = None
    try:
        od = src.worker("rp-order/list", days=10)
        orders = [o for o in od.get("orders") or [] if isinstance(o, dict)]
    except Exception:                                      # noqa: BLE001
        orders = None
    cache = {}

    def buyer_of(key):
        if key not in cache:
            cache[key] = src.buyer(key)
        return cache[key]

    c = {"link sent": 0, "reminder sent": 0, "to Sig": 0, "paid, no reminder": 0, "too late, closed": 0,
         "waiting": 0, "reminder waits on orders": 0, "marked, send failed": 0}
    for row in rows:
        if row.get("done"):
            continue
        age_h = (now_ms - (row.get("ts") or now_ms)) / 3600e3
        stage = None
        if not row.get("sent"):
            stage = "now"
        elif not row.get("reminded"):
            if age_h < REMIND_AFTER_H:
                c["waiting"] += 1
                continue
            if orders is None:
                c["reminder waits on orders"] += 1
                continue
            if paid_match(row, orders, buyer_of):
                if not dry:
                    src.worker("rp-remind/mark", body={"key": row["key"], "stage": "done", "why": "paid"})
                c["paid, no reminder"] += 1
                continue
            if age_h > GIVE_UP_H:
                if not dry:
                    src.worker("rp-remind/mark", body={"key": row["key"], "stage": "done", "why": "late"})
                c["too late, closed"] += 1
                continue
            stage = "reminder"
        else:
            continue
        if dry and age_h > DRY_FRESH_H:
            continue
        to = sig_to if dry else row["email"]
        m = build(row, stage, to, src.base, prices, today)
        if not dry:
            # marked first: never twice, even if the send or this job dies after it
            mk = src.worker("rp-remind/mark", body={"key": row["key"], "stage": "sent" if stage == "now" else "reminded"})
            if not mk.get("ok") or mk.get("already"):
                continue
        try:
            send(m)
        except Exception:                                  # noqa: BLE001
            c["marked, send failed"] += 1
            continue
        c["to Sig" if dry else ("link sent" if stage == "now" else "reminder sent")] += 1
    log = ["Design asks: %d." % len(rows), "; ".join("%s: %d" % (k, v) for k, v in c.items()) + "."]
    return (1 if c["marked, send failed"] else 0), log


def smtp_send(fa):
    def send(m):
        if not (env("SMTP_USER") and env("SMTP_PASS")):
            raise RuntimeError("no SMTP_USER / SMTP_PASS")
        del m["From"]
        m["From"] = formataddr((one_line(env("RP_FROM_NAME", FROM_NAME), 60) or FROM_NAME, fa))
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
    dry = env("DRY_RUN") == "1"
    src = Sources(env("LIST_URL", ""), env("LIST_TOKEN", ""))
    code, log = run(src, dry, smtp_send(env("FROM_ADDR") or env("SMTP_USER") or ""), env("SIG_TO", REPLY_TO))
    for line in log:
        print(line)
    return code


# ───────────────────────────── selftest ─────────────────────────────

def _code(place, year):
    raw = "|".join(["2", place, "471667 2", str(year), "sp0aa", "Gustum Farm"]).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


class Fake(Sources):
    def __init__(self, rows, orders, buyers=None, orders_fail=False):
        super().__init__("https://subs.example/x", "tok")
        self.rows, self.orders, self.buyers, self.orders_fail = rows, orders, buyers or {}, orders_fail
        self.marks, self.buyer_calls = [], 0

    def worker(self, path, body=None, **q):
        if path == "rp-remind/list":
            return {"ok": True, "rows": [dict(r) for r in self.rows]}
        if path == "rp-order/list":
            if self.orders_fail:
                raise OSError("down")
            return {"ok": True, "orders": self.orders}
        if path == "rp-remind/mark":
            self.marks.append((body["key"], body["stage"], body.get("why")))
            for r in self.rows:
                if r["key"] == body["key"]:
                    st = body["stage"]
                    if r.get(st) or (st == "reminded" and r.get("done")):
                        return {"ok": True, "already": True}
                    r[st] = {"at": "now"}
                    return {"ok": True, "already": False}
            return {"ok": False}
        raise AssertionError(path)

    def buyer(self, key):
        self.buyer_calls += 1
        return self.buyers.get(key, "")

    def prices(self):
        return {"framed_christmas_cutoff": "2026-12-09", "print_christmas_cutoff": "2026-12-10"}


def selftest():
    fails = []

    def ck(name, ok, detail=""):
        if not ok:
            fails.append(name + (": " + detail if detail else ""))

    NOW = 1761000000000
    H_ = 3600e3
    code = _code("Chetek, WI", 2025)
    ck("design_of", design_of(code) == ("Chetek, WI", 2025), str(design_of(code)))
    ck("design_of junk", design_of("AAAAAAAAAAAA") is None)

    def row(key, **kw):
        r = {"key": "rpr:%016x:%016x" % (key, key), "email": "reader%d@farm.com" % key, "code": code, "ref": "", "ts": NOW, "stop_t": "abcdef0123456789",
             "sent": None, "reminded": None, "done": None}
        r.update(kw)
        return r

    sent = []

    def send(m):
        sent.append(m)

    # 1. a new ask: the link now, once; marked before the send
    f = Fake([row(1)], [])
    code_, log = run(f, False, send, "sig@farmers1st.com", now_ms=NOW + 60e3, today="2026-10-20")
    ck("now: one email", len(sent) == 1 and sent[0]["To"] == "reader1@farm.com", str([m["To"] for m in sent]))
    ck("now: marked sent first", f.marks == [(row(1)["key"], "sent", None)], str(f.marks))
    body = sent[0].get_body(("plain",)).get_content()
    ck("now: the link carries the design", (SITE + "?d=" + code) in body, body)
    ck("now: subject", sent[0]["Subject"] == "Your Rain Print design: Chetek, WI, 2025", sent[0]["Subject"])
    ck("now: says one reminder, then nothing", "one reminder tomorrow unless you order it. Then nothing more about it." in body)
    ck("now: stop link", "https://subs.example/rp-remind/stop?k=rpr%3A" in body and sent[0]["List-Unsubscribe"])
    ck("now: the story line, no em dash", STORY in body and "\u2014" not in body)
    ck("log: no address", not any("@" in x for x in log), str(log))
    # a second run: nothing (sent, not yet a day)
    sent.clear()
    run(f, False, send, "sig@farmers1st.com", now_ms=NOW + 2 * H_, today="2026-10-20")
    ck("now: never twice", not sent)

    # 2. the next day, nothing paid: one reminder, marked first, then never again
    sent.clear()
    f = Fake([row(2, sent={"at": "x"})], [{"key": "rpo:1:aa", "status": "paid", "ref": "OTHER", "place": "Ames, IA", "year": 2012, "ts": NOW + H_}])
    run(f, False, send, "sig@farmers1st.com", now_ms=NOW + 21 * H_, today="2026-10-21")
    ck("reminder: one", len(sent) == 1 and f.marks == [(row(2)["key"], "reminded", None)], str(f.marks))
    rb = sent[0].get_body(("plain",)).get_content() if sent else ""
    ck("reminder: Christmas dates while they hold", "Order it framed by Dec 9, or as a print by Dec 10 for Christmas delivery." in rb, rb)
    ck("reminder: guarantee", GUARANTEE in rb)
    ck("reminder: only one", "This is the only reminder." in rb)
    sent.clear()
    run(f, False, send, "sig@farmers1st.com", now_ms=NOW + 30 * H_, today="2026-10-21")
    ck("reminder: never a second", not sent)

    # 3. a paid order matching the design: no reminder, marked done, never after
    for name, o, buyers in [
        ("same code", {"key": "rpo:2:aa", "status": "paid", "ref": code, "ts": NOW + H_}, {}),
        ("a gift of it", {"key": "rpo:3:aa", "status": "paid", "ref": "GIFT-" + code, "ts": NOW + H_}, {}),
        ("same town and year", {"key": "rpo:4:aa", "status": "paid", "ref": "ZZZ", "place": "Chetek, WI", "year": 2025, "ts": NOW + 5 * H_}, {}),
        ("same buyer", {"key": "rpo:5:aa", "status": "paid", "ref": "ZZZ", "place": "Ames, IA", "year": 2012, "ts": NOW + 5 * H_}, {"rpo:5:aa": "reader3@farm.com"}),
    ]:
        sent.clear()
        f = Fake([row(3, sent={"at": "x"})], [o], buyers)
        run(f, False, send, "sig@farmers1st.com", now_ms=NOW + 22 * H_, today="2026-10-21")
        ck("paid (%s): no reminder" % name, not sent and f.marks == [(row(3)["key"], "done", "paid")], str(f.marks))
    # an RPS ref
    sent.clear()
    f = Fake([row(4, sent={"at": "x"}, ref="RPS-K7Q2M")], [{"key": "rpo:6:aa", "status": "paid", "ref": "GIFT-RPS-K7Q2M", "ts": NOW + H_}])
    run(f, False, send, "sig@farmers1st.com", now_ms=NOW + 22 * H_, today="2026-10-21")
    ck("paid (RPS ref): no reminder", not sent)
    # an unpaid press of the same design does not count
    sent.clear()
    f = Fake([row(5, sent={"at": "x"})], [{"key": "rpo:7:aa", "status": "pay pressed", "ref": code, "ts": NOW + H_}])
    run(f, False, send, "sig@farmers1st.com", now_ms=NOW + 22 * H_, today="2026-10-21")
    ck("unpaid press: the reminder still goes", len(sent) == 1)
    # done (stopped or paid) rows: nothing, ever
    sent.clear()
    f = Fake([row(6, done={"why": "stopped"}), row(7, sent={"at": "x"}, done={"why": "paid"})], [])
    run(f, False, send, "sig@farmers1st.com", now_ms=NOW + 22 * H_, today="2026-10-21")
    ck("done: nothing", not sent and not f.marks)
    # order records down: the reminder waits
    sent.clear()
    f = Fake([row(8, sent={"at": "x"})], [], orders_fail=True)
    code_, log = run(f, False, send, "sig@farmers1st.com", now_ms=NOW + 22 * H_, today="2026-10-21")
    ck("orders down: no reminder", not sent and "reminder waits on orders: 1" in log[-1], str(log))
    # too late: closed, nothing sent
    sent.clear()
    f = Fake([row(9, sent={"at": "x"})], [])
    run(f, False, send, "sig@farmers1st.com", now_ms=NOW + 80 * H_, today="2026-10-24")
    ck("too late: closed quietly", not sent and f.marks == [(row(9)["key"], "done", "late")])
    # after the cutoff: no Christmas line; this year's print: January
    s, paras, _ = words(row(10), "reminder", Fake([], []).prices(), "2026-12-11")
    ck("after the cutoff: no Christmas line", not any("Christmas" in p for p in paras), str(paras))
    s, paras, _ = words(row(10), "reminder", Fake([], []).prices(), "2026-12-10")
    ck("between the cutoffs: the print only", "Order it as a print by Dec 10 for Christmas delivery." in paras, str(paras))
    s, paras, _ = words(row(11, code=_code("Chetek, WI", 2026)), "reminder", Fake([], []).prices(), "2026-10-21")
    ck("this year: January", "A 2026 print ships in January 2027, once the full year is in." in paras and not any("Christmas" in p for p in paras), str(paras))
    # dry run: to Sig, nothing marked, only fresh asks
    sent.clear()
    f = Fake([row(12), row(13, ts=NOW - 10 * H_)], [])
    run(f, True, send, "sig@farmers1st.com", now_ms=NOW + 60e3, today="2026-10-20")
    ck("dry run: to Sig only, nothing marked", [m["To"] for m in sent] == ["sig@farmers1st.com"] and not f.marks, str([m["To"] for m in sent]))
    # a send that fails after the mark is counted, not retried
    f = Fake([row(14)], [])
    code_, log = run(f, False, lambda m: (_ for _ in ()).throw(OSError("smtp")), "sig@farmers1st.com", now_ms=NOW + 60e3, today="2026-10-20")
    ck("send failed: counted, exit 1", code_ == 1 and "marked, send failed: 1" in log[-1], str(log))
    # words: no em dash anywhere
    for st in ("now", "reminder"):
        s, paras, _ = words(row(15), st, Fake([], []).prices(), "2026-10-21")
        ck("no em dash (%s)" % st, "\u2014" not in s + "".join(paras))
    if fails:
        for x in fails:
            print("FAIL", x)
        return 1
    print("rp_design_email: all checks pass")
    return 0


if __name__ == "__main__":
    sys.exit(main())
