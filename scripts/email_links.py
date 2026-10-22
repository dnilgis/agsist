#!/usr/bin/env python3
"""
email_links.py -- every link AGSIST emails is an agsist.com link with no
address in it.

Oct 21, 2026: a Daily link of the form .../daily-elev?e=<address>&t=<hmac>
was scanned, reported as phishing, and the subs worker's host was blocked.
An address in a link is the phishing pattern, so since subs worker v5.46:

  * every list route the senders read (/list?format=json, /alert-list,
    /notice-list, /watch-list, /elevator-watch-list, /price-watch-list) gives
    each row a link id, lid: 16 letters that reveal nothing;
  * every signed route takes ?k=<lid>&t= in place of ?e=<address>&t=, with
    t = hmac16(lid + the same suffix as before), e.g. "|de", "|c|" + fips.

FRONT DOOR (Oct 22, 2026, Sig; subs worker v5.48; BUILD-RULES 11): no
emailed link points at the worker's shared host (*.workers.dev) any more.
Every link goes to one page on our own domain, FRONT = https://agsist.com/e,
with the worker route as a=<route> and the same signed params; that page
(e.html, GitHub Pages) asks the worker from the reader's browser
(GET/POST <worker>/fd/<route>, JSON, CORS for agsist.com) and, when the
worker cannot be reached, says so in two lines and offers the mailto stop.

    signed(base, path, lid, secret, tail="", mid="", end="")
        FRONT?a=<path>&k=<lid><mid>&t=<hmac16(lid + tail)><end>
        (base is the worker; it only has to be set, it is never in the link)
    front(route, [(name, value), ...])
        FRONT?a=<route>&name=value...  for the links with no lid
        (rp-remind/stop, sponsor-confirm, sponsor-decide, logo)
    lid_of(row)          the row's lid, or None (an older worker, or a row the
                         worker had no room to number this call: skip it)
    link_ids(rows)       {address: lid} for the rows that have one
    check_message(msg)   raises LinkError when any link in the body or a
                         header carries an address or names the worker host;
                         sets List-Unsubscribe to the mailto stop plus the
                         front-door page and drops List-Unsubscribe-Post
    check_hosts(msg)     the worker-host half alone (every mail we send)
    tidy_subject(msg)    an em dash in the Subject becomes a comma (every mail)
    plain_dashes(s), plain_labels(watchers)   the same for stored watch labels
    check_text(s)        the address check for one body
    hrefs(html)          every href in an HTML body (for the selftests)

GUARD ON EVERY SEND: importing this module wraps smtplib.SMTP.send_message,
so any script that imports it refuses a message that names the worker host
(*.workers.dev, BLOCKED_HOST, or the LIST_URL host when it is not ours), in
every mode. Every script that sends mail imports it (test/email-links.test.mjs).

The error names how many links, never the address. Old ?e= and worker links
already in inboxes keep working at the worker; nothing here makes a new one.

BACKUP MODE (Oct 22, 2026; scripts/list_source.py sets FALLBACK when the
subs worker is blocked and the list came from the private copy): links are
made the same way (the page says when the worker is down and offers the
mailto); check_message also puts STOP_LINE ("Reply STOP to stop these
emails.") in the footer of each body. The one mailto allowed in a body is
STOP_MAILTO itself: our own mailbox, never the reader's.

    python3 scripts/email_links.py --selftest
"""
import hashlib
import hmac
import html as _html
import os
import re
import smtplib
import sys
import urllib.parse

LID_RE = re.compile(r"^[0-9a-hjkmnp-tv-z]{16}$")
# A made-up id for previews and selftests (fits LID_RE; no reader has it).
SAMPLE_LID = "0123456789abcdef"
ADDRESS_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}")
HREF_RE = re.compile(r"""href\s*=\s*(?:"([^"]*)"|'([^']*)')""", re.I)
URL_RE = re.compile(r"""https?://[^\s<>"']+""", re.I)
SHARED_RE = re.compile(r"[a-z0-9.-]*\.workers\.dev\b", re.I)

FRONT = "https://agsist.com/e"
# The routes the front-door page knows (e.html ROUTES; the worker's /fd/ list).
FRONT_ROUTES = {"unsubscribe", "alert-unsubscribe", "notice-unsubscribe", "daily-elev",
                "watch-confirm", "watch-unsubscribe", "elevator-watch-confirm", "elevator-watch-unsubscribe",
                "price-watch-confirm", "price-watch-unsubscribe", "rp-remind/stop",
                "sponsor-confirm", "sponsor-decide", "logo"}


class LinkError(ValueError):
    pass


class Withheld(LinkError):
    """Kept for the senders that still catch it; nothing raises it since the front door."""


FALLBACK = False
BLOCKED_HOST = ""
STOP_MAILTO = "mailto:news@agsist.com?subject=unsubscribe"
STOP_LINE = "Reply STOP to stop these emails."
STOP_PATHS = {"unsubscribe", "alert-unsubscribe", "notice-unsubscribe", "watch-unsubscribe",
              "elevator-watch-unsubscribe", "price-watch-unsubscribe"}


def token(secret, s):
    """The worker's hmac16: HMAC-SHA256 of the lowercased string, first 16 hex."""
    return hmac.new(secret.encode(), str(s).lower().encode(), hashlib.sha256).hexdigest()[:16]


def lid_of(row):
    v = str((row or {}).get("lid") or "").strip().lower() if isinstance(row, dict) else ""
    return v if LID_RE.match(v) else None


def link_ids(rows):
    out = {}
    for r in rows or []:
        lid = lid_of(r)
        e = str((r or {}).get("email") or "").strip().lower() if isinstance(r, dict) else ""
        if lid and e:
            out[e] = lid
    return out


def _route(path):
    p = str(path or "").strip("/")
    if p not in FRONT_ROUTES:
        raise LinkError("the front-door page does not know this route: " + p)
    return p


def signed(base, path, lid, secret, tail="", mid="", end=""):
    lid = str(lid or "").strip().lower()
    if not LID_RE.match(lid):
        raise LinkError("no link id for this reader")
    u = "%s?a=%s&k=%s%s&t=%s%s" % (FRONT, _route(path), lid, mid, token(secret, lid + tail), end)
    check_text(u)
    return u


def front(route, params=()):
    """A front-door link for a worker page that is not keyed by a link id."""
    q = urllib.parse.urlencode([("a", _route(route))] + [(k, str(v)) for k, v in params], safe=":/")
    u = FRONT + "?" + q
    check_text(u)
    return u


def as_worker(u, base, fd=True):
    """The worker request e.html makes for a front-door link: base/fd/<a>?<the
    other params> (fd=False: the old worker link). For tests."""
    p = urllib.parse.urlsplit(u)
    if "%s://%s%s" % (p.scheme, p.netloc, p.path) != FRONT:
        raise LinkError("not a front-door link")
    q = urllib.parse.parse_qsl(p.query, keep_blank_values=True)
    a = _route(dict(q).get("a"))
    rest = urllib.parse.urlencode([(k, v) for k, v in q if k != "a"], safe=":")
    return "%s/%s%s?%s" % (str(base).rstrip("/"), "fd/" if fd else "", a, rest)


def unsub_web(msg):
    """The https link in a message's List-Unsubscribe header, or "" (for tests)."""
    web = [i for i in re.findall(r"<([^>]*)>", str(msg.get("List-Unsubscribe") or "")) if i.lower().startswith(("http://", "https://"))]
    return web[0] if web else ""


DASH_RE = re.compile(r"\s*(?:\u2014|&mdash;|\s\u2013\s)\s*")


def plain_dashes(s):
    """No em dash in a subject or headline (Sig's rule): " \u2014 " becomes ", "."""
    return DASH_RE.sub(", ", str(s or "")).strip(", ") if s else s


def plain_labels(watchers):
    """A copy of a watch list with every stored label free of em dashes
    (labels saved before Oct 22 read "<elevator> \u2014 corn"). _name keeps the
    part before the old dash, the elevator alone."""
    out = []
    for r in watchers or []:
        if not isinstance(r, dict):
            out.append(r)
            continue
        r = dict(r)
        for part in ("pend", "w"):
            if isinstance(r.get(part), dict):
                d = {}
                for k, st in r[part].items():
                    if isinstance(st, dict) and isinstance(st.get("label"), str):
                        st = dict(st, label=plain_dashes(st["label"]), _name=plain_dashes(st["label"].split(" \u2014 ")[0]))
                    d[k] = st
                r[part] = d
        out.append(r)
    return out


def hrefs(body):
    return [_html.unescape(a or b) for a, b in HREF_RE.findall(body or "")]


def _decoded(s):
    s = _html.unescape(str(s or ""))
    for _ in range(3):   # %2540 and the like
        s2 = urllib.parse.unquote(s)
        if s2 == s:
            break
        s = s2
    return s


def _bad(u):
    s = _decoded(u)
    if s == STOP_MAILTO:
        return False          # our own stop mailbox, never the reader's
    return bool(ADDRESS_RE.search(s)) or "@" in s and s.lower().startswith("mailto:")


def worker_hosts():
    """Hosts no email may name: the blocked one (backup mode) and the LIST_URL
    host (the subs worker) unless it is our own domain. *.workers.dev always."""
    out = set()
    for h in (BLOCKED_HOST, urllib.parse.urlsplit((os.environ.get("LIST_URL") or "").strip()).netloc):
        h = str(h or "").strip().lower()
        if h and not (h == "agsist.com" or h.endswith(".agsist.com")):
            out.add(h)
    return out


def worker_names(body):
    """Every mention of a worker host in one body or header: links, bare URLs
    and the bare host (mail apps turn a bare host into a link)."""
    s = _decoded(body).lower()
    out = SHARED_RE.findall(s)
    for h in worker_hosts():
        out += [h] * s.count(h)
    return out


def scrub_text(s):
    """For Sig's own run notes (log_safe): a worker URL or host becomes "the subs worker"."""
    s = re.sub(r"https?://[^\s<>\"']*\.workers\.dev[^\s<>\"']*", "the subs worker", str(s or ""), flags=re.I)
    s = SHARED_RE.sub("the subs worker", s)
    for h in worker_hosts():
        s = re.sub(r"(?:https?://)?" + re.escape(h) + r"[^\s<>\"']*", "the subs worker", s, flags=re.I)
    return s


def blocked_links(body):
    """Links (hrefs and bare URLs) that point at a worker host."""
    return [u for u in hrefs(body) + URL_RE.findall(_html.unescape(body or "")) if worker_names(u)]


def _with_stop_line(part):
    """STOP_LINE at the foot of one text part (once)."""
    body = part.get_content()
    if STOP_LINE in body:
        return
    if part.get_content_subtype() == "html":
        line = ('<p style="font-size:12px;color:#666;margin:12px 0 0">%s Or email '
                '<a href="%s">news@agsist.com</a> with the word unsubscribe.</p>' % (STOP_LINE, _html.escape(STOP_MAILTO)))
        i = body.lower().rfind("</body>")
        body = body[:i] + line + body[i:] if i >= 0 else body + line
        part.set_content(body, subtype="html")
    else:
        part.set_content(body.rstrip("\n") + "\n\n" + STOP_LINE + "\n")


def bad_links(body):
    """The links in one body (hrefs and bare http(s) URLs) that carry an address."""
    return [u for u in hrefs(body) + URL_RE.findall(_html.unescape(body or "")) if _bad(u)]


def check_text(body):
    n = len(bad_links(body))
    if n:
        raise LinkError("refusing to send: %d link(s) carry an email address" % n)


def _content(part):
    """A text part's words, for an EmailMessage or a legacy MIMEText alike."""
    try:
        return part.get_content()
    except AttributeError:
        raw = part.get_payload(decode=True)
        if isinstance(raw, bytes):
            return raw.decode(part.get_content_charset() or "utf-8", "replace")
        return str(part.get_payload() or "")


def _text_parts(msg):
    for part in msg.walk():
        if part.get_content_maintype() == "text":
            yield part


def check_hosts(msg):
    """Refuses a message that names a worker host in any text part or header (every mode)."""
    for k, v in msg.items():
        if worker_names(v):
            raise LinkError("refusing to send: the %s header names the subs worker host" % k)
    for part in _text_parts(msg):
        n = len(worker_names(_content(part)))
        if n:
            raise LinkError("refusing to send: %d link(s) or mention(s) of the subs worker host (links go to %s)" % (n, FRONT))
    return msg


def tidy_subject(msg):
    """The last net for Sig's no-em-dash rule: a Subject with one gets a comma instead."""
    s = msg.get("Subject")
    if s is not None and DASH_RE.search(str(s)):
        del msg["Subject"]
        msg["Subject"] = plain_dashes(str(s))
    return msg


def _list_unsubscribe(msg):
    """The mailto stop plus the front-door page (a GET page, so no
    List-Unsubscribe-Post: RFC 8058 one-click is a POST, which GitHub Pages
    cannot take, and the worker must not be in the header). We send about
    160 a day, far under Gmail's 5,000 a day bulk-sender line where one-click
    becomes a must; the mailto covers the rest."""
    have = str(msg.get("List-Unsubscribe") or "")
    if not have:
        return
    web = [i for i in re.findall(r"<([^>]*)>", have) if i.lower().startswith(("http://", "https://"))]
    for i in web:
        if _bad(i):
            raise LinkError("refusing to send: the List-Unsubscribe link carries an email address")
        if not i.startswith(FRONT + "?"):
            raise LinkError("refusing to send: the List-Unsubscribe link is not the agsist.com page")
    del msg["List-Unsubscribe-Post"]
    del msg["List-Unsubscribe"]
    msg["List-Unsubscribe"] = ", ".join(["<" + STOP_MAILTO + ">"] + ["<" + i + ">" for i in web[:1]])


def check_message(msg):
    if FALLBACK:
        for part in _text_parts(msg):
            if part.get_content_disposition() != "attachment":
                _with_stop_line(part)
    _list_unsubscribe(msg)
    tidy_subject(msg)
    check_hosts(msg)
    for part in _text_parts(msg):
        check_text(_content(part))
    return msg


def _guard_smtp():
    """Every send through smtplib from a script that imports this module runs check_hosts first."""
    if getattr(smtplib.SMTP.send_message, "_agsist_guard", False):
        return
    orig = smtplib.SMTP.send_message

    def send_message(self, msg, *a, **k):
        tidy_subject(msg)
        check_hosts(msg)
        return orig(self, msg, *a, **k)
    send_message._agsist_guard = True
    smtplib.SMTP.send_message = send_message


_guard_smtp()


def selftest():
    from email.message import EmailMessage
    bad = []

    def ck(name, cond):
        if not cond:
            bad.append(name)

    def refused(m):
        try:
            check_message(m)
            return False
        except LinkError as ex:
            ck("error names no address", "@" not in str(ex))
            return True

    W = "https://agsist-subs.example.workers.dev"
    u = signed(W, "unsubscribe", SAMPLE_LID, "sec")
    ck("signed shape: the front door", u == FRONT + "?a=unsubscribe&k=%s&t=%s" % (SAMPLE_LID, token("sec", SAMPLE_LID)))
    ck("the worker is never in the link", "workers.dev" not in u and "example" not in u)
    ck("token is the worker's hmac16", token("sec", "AB|c|1") == hmac.new(b"sec", b"ab|c|1", hashlib.sha256).hexdigest()[:16])
    u = signed(W, "watch-confirm", SAMPLE_LID, "sec", "|c|19169", "&f=19169")
    ck("mid before t", u.endswith("?a=watch-confirm&k=%s&f=19169&t=%s" % (SAMPLE_LID, token("sec", SAMPLE_LID + "|c|19169"))))
    u = signed(W, "/notice-unsubscribe", SAMPLE_LID, "sec", end="&topic=rent%3Awi")
    ck("end after t", u.endswith("&t=%s&topic=rent%%3Awi" % token("sec", SAMPLE_LID)))
    for x in ("", "a@b.com", "ABC", "0123456789abcdeI"):
        try:
            signed(W, "unsubscribe", x, "sec")
            bad.append("bad id taken: %r" % x)
        except LinkError:
            pass
    try:
        signed(W, "list", SAMPLE_LID, "sec")
        bad.append("a route the page does not know was linked")
    except LinkError:
        pass
    ck("front: rp-remind stop", front("rp-remind/stop", [("k", "rpr:0123456789abcdef:0123456789abcdef"), ("t", "ab")])
       == FRONT + "?a=rp-remind/stop&k=rpr:0123456789abcdef:0123456789abcdef&t=ab")
    ck("front: logo", front("logo", [("id", "k3j9m2p7q8rs")]) == FRONT + "?a=logo&id=k3j9m2p7q8rs")
    u = signed(W, "watch-confirm", SAMPLE_LID, "sec", "|c|19169", "&f=19169")
    ck("as_worker: the page's /fd/ request", as_worker(u, W) == W + "/fd/watch-confirm?k=%s&f=19169&t=%s" % (SAMPLE_LID, token("sec", SAMPLE_LID + "|c|19169")))
    ck("as_worker: the old link", as_worker(front("rp-remind/stop", [("k", "rpr:a:b"), ("t", "1")]), W, False) == W + "/rp-remind/stop?k=rpr:a:b&t=1")
    ck("lid_of", lid_of({"lid": SAMPLE_LID}) == SAMPLE_LID and lid_of({"lid": "x@y.com"}) is None and lid_of({}) is None and lid_of(None) is None)
    ck("link_ids", link_ids([{"email": "A@x.com", "lid": SAMPLE_LID}, {"email": "b@x.com"}]) == {"a@x.com": SAMPLE_LID})
    # the address guard: raw, encoded, double encoded, in text or html
    for body in ('<a href="https://agsist.com/e?a=unsubscribe&amp;e=a%40b.com&amp;t=1">x</a>',
                 '<a href="https://agsist.com/e?e=a@b.com&t=1">x</a>',
                 "Unsubscribe: https://agsist.com/e?e=a%2540b.com&t=1",
                 "<a href='https://agsist.com/e?a=daily-elev&e=farmer%40example.org&t=1'>x</a>",
                 '<a href="mailto:reader@example.com">x</a>'):
        try:
            check_text(body)
            bad.append("guard let through: " + body[:40])
        except LinkError as ex:
            ck("error names no address", "@" not in str(ex))
    for body in ('<a href="%s">x</a> Reply to sig@farmers1st.com' % signed(W, "unsubscribe", SAMPLE_LID, "sec").replace("&", "&amp;"),
                 "Map: https://www.google.com/maps/@44.9,-91.4,12z",
                 "plain text with no link"):
        try:
            check_text(body)
        except LinkError:
            bad.append("guard refused a clean body: " + body[:40])
    # the host guard, in every mode: any workers.dev link, bare URL, bare host or header
    for body in ('<a href="https://agsist-subs.dnilgis.workers.dev/unsubscribe?k=%s&amp;t=1">x</a>' % SAMPLE_LID,
                 "Stop: https://AGSIST-SUBS.dnilgis.Workers.Dev/unsubscribe?k=x",
                 "Logo: agsist-subs.dnilgis.workers.dev/rp-logo/k3j9m2p7q8rs",
                 '<a href="https://agsist-api.dnilgis.workers.dev/unsubscribe?k=%s&amp;t=1">x</a>' % SAMPLE_LID,
                 "Logo: agsist-api.dnilgis.workers.dev/rp-logo/k3j9m2p7q8rs",
                 '<a href="https%3A%2F%2Fx.workers.dev%2Fy">x</a>',
                 '<img src="https://other.someone.workers.dev/p.png">'):
        m = EmailMessage()
        m.set_content("hi")
        m.add_alternative(body, subtype="html")
        ck("host guard (html) let through: " + body[:50], refused(m))
        m = EmailMessage()
        m.set_content(body)
        ck("host guard (text) let through: " + body[:50], refused(m))
    m = EmailMessage()
    m["List-Unsubscribe"] = "<https://agsist-subs.dnilgis.workers.dev/unsubscribe?k=%s&t=1>" % SAMPLE_LID
    m.set_content("hi")
    ck("a worker List-Unsubscribe let through", refused(m))
    m = EmailMessage()
    m["X-Note"] = "see agsist-subs.dnilgis.workers.dev"
    m.set_content("hi")
    ck("a worker host in another header let through", refused(m))
    m = EmailMessage()
    m["List-Unsubscribe"] = "<https://agsist-api.dnilgis.workers.dev/unsubscribe?k=%s&t=1>" % SAMPLE_LID
    m.set_content("hi")
    ck("the new worker host (agsist-api) in List-Unsubscribe let through", refused(m))
    old = os.environ.get("LIST_URL")
    os.environ["LIST_URL"] = "https://subs.example.net"
    try:
        m = EmailMessage()
        m.set_content("go to https://subs.example.net/unsubscribe?k=%s&t=1" % SAMPLE_LID)
        ck("the LIST_URL host let through", refused(m))
        m = EmailMessage()
        m.set_content("go to " + signed("https://subs.example.net", "unsubscribe", SAMPLE_LID, "sec"))
        ck("a front-door body refused", not refused(m))
        os.environ["LIST_URL"] = "https://subs.agsist.com"
        ck("our own subdomain is not a worker host", not worker_hosts())
    finally:
        if old is None:
            os.environ.pop("LIST_URL", None)
        else:
            os.environ["LIST_URL"] = old
    # the smtplib guard: a script that imports this module cannot send a worker link
    class Fake(smtplib.SMTP):
        def __init__(self):
            self.sent = []

        def ehlo_or_helo_if_needed(self):
            pass

        def sendmail(self, *a, **k):
            self.sent.append(a)
            return {}
    f = Fake()
    m = EmailMessage()
    m["From"], m["To"] = "news@agsist.com", "made-up@example.com"
    m.set_content("https://agsist-subs.dnilgis.workers.dev/daily-elev?k=%s&t=1" % SAMPLE_LID)
    try:
        f.send_message(m)
        bad.append("smtplib sent a worker link")
    except LinkError:
        pass
    m = EmailMessage()
    m["From"], m["To"] = "news@agsist.com", "made-up@example.com"
    m["Subject"] = "AGSIST critic \u2014 issue #1"
    m.set_content("https://agsist.com/daily")
    try:
        f.send_message(m)
    except LinkError:
        bad.append("smtplib refused a clean message")
    from email.mime.text import MIMEText
    lm = MIMEText("see https://agsist-subs.dnilgis.workers.dev/x", "plain", "utf-8")
    try:
        check_hosts(lm)
        bad.append("a legacy MIMEText with a worker link let through")
    except LinkError:
        pass
    ck("a clean legacy MIMEText passes", check_hosts(MIMEText("hi https://agsist.com/", "plain", "utf-8")) is not None)
    ck("smtplib guard sends the clean one, subject without the em dash", len(f.sent) == 1 and m["Subject"] == "AGSIST critic, issue #1")
    # List-Unsubscribe: the mailto stop plus the front door, never Post
    m = EmailMessage()
    m["List-Unsubscribe"] = "<%s>, <mailto:sig@farmers1st.com?subject=unsubscribe>" % signed(W, "unsubscribe", SAMPLE_LID, "sec")
    m["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"
    m.set_content("hi")
    check_message(m)
    ck("unsub_web", unsub_web(m) == signed(W, "unsubscribe", SAMPLE_LID, "sec"))
    ck("List-Unsubscribe is the mailto plus the page", str(m["List-Unsubscribe"]) == "<%s>, <%s>" % (STOP_MAILTO, signed(W, "unsubscribe", SAMPLE_LID, "sec")))
    ck("no List-Unsubscribe-Post (the page is a GET page)", m["List-Unsubscribe-Post"] is None)
    m = EmailMessage()
    m["List-Unsubscribe"] = "<https://agsist.com/e?a=unsubscribe&e=a%40b.com&t=1>"
    m.set_content("hi")
    ck("List-Unsubscribe address let through", refused(m))
    m = EmailMessage()
    m["List-Unsubscribe"] = "<https://elsewhere.example/stop?k=1>"
    m.set_content("hi")
    ck("a List-Unsubscribe page that is not ours let through", refused(m))
    m = EmailMessage()
    m.set_content("hi")
    m.add_alternative('<a href="https://agsist.com/x?e=a%40b.com">x</a>', subtype="html")
    ck("html part address let through", refused(m))
    ck("plain_dashes", plain_dashes("Badger Grain Supply, LLC, Wheeler, WI \u2014 corn, NOVEMBER: basis moved to \u221266\u00a2")
       == "Badger Grain Supply, LLC, Wheeler, WI, corn, NOVEMBER: basis moved to \u221266\u00a2"
       and plain_dashes("Oct\u2013Nov") == "Oct\u2013Nov" and plain_dashes("a &mdash; b") == "a, b")
    pl = plain_labels([{"email": "x", "w": {"a": {"label": "Co-op, Town, WI \u2014 corn"}, "b": None}, "pend": {"c": {"label": "Plain"}}}])
    ck("plain_labels", pl[0]["w"]["a"]["label"] == "Co-op, Town, WI, corn" and pl[0]["w"]["a"]["_name"] == "Co-op, Town, WI"
       and pl[0]["w"]["b"] is None and pl[0]["pend"]["c"]["label"] == "Plain")
    m = EmailMessage()
    m["Subject"] = "Co-op, Town, WI \u2014 corn, NOVEMBER: basis moved to \u221266\u00a2"
    m.set_content("hi")
    check_message(m)
    ck("check_message: no em dash in the subject", m["Subject"] == "Co-op, Town, WI, corn, NOVEMBER: basis moved to \u221266\u00a2")
    ck("scrub_text", scrub_text("HTTP 403 at https://agsist-subs.dnilgis.workers.dev/list?format=json and agsist-subs.dnilgis.workers.dev")
       == "HTTP 403 at the subs worker and the subs worker")
    ck("hrefs unescapes", hrefs('<a href="a?x=1&amp;y=2">') == ["a?x=1&y=2"])
    # backup mode: the same links, the footer says STOP, the host stays refused
    global FALLBACK, BLOCKED_HOST
    FALLBACK, BLOCKED_HOST = True, "agsist-subs.dnilgis.workers.dev"
    try:
        u = signed(W, "unsubscribe", SAMPLE_LID, "sec")
        ck("backup: stop link is the front door", u.startswith(FRONT + "?a=unsubscribe&k="))
        ck("backup: daily-elev is made too (the page says when the worker is down)",
           signed(W, "daily-elev", SAMPLE_LID, "sec", "|de").startswith(FRONT + "?a=daily-elev&k="))
        m = EmailMessage()
        m["List-Unsubscribe"] = "<%s>" % u
        m["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"
        m.set_content("hi\nUnsubscribe: " + u)
        m.add_alternative('<html><body><a href="%s">Unsubscribe</a></body></html>' % _html.escape(u), subtype="html")
        check_message(m)
        h, t = m.get_body(("html",)).get_content(), m.get_body(("plain",)).get_content()
        ck("backup footer says STOP, both parts", STOP_LINE in h and STOP_LINE in t)
        ck("backup List-Unsubscribe", str(m["List-Unsubscribe"]) == "<%s>, <%s>" % (STOP_MAILTO, u) and m["List-Unsubscribe-Post"] is None)
        ck("backup: no worker host anywhere", not blocked_links(h) and not blocked_links(t) and "workers.dev" not in h + t)
        m = EmailMessage()
        m.set_content("see https://agsist-subs.dnilgis.workers.dev/daily-elev?k=%s&t=1" % SAMPLE_LID)
        ck("backup let a worker link through", refused(m))
        m = EmailMessage()
        m.set_content("x")
        m.add_alternative('<a href="mailto:reader@example.com">x</a>', subtype="html")
        ck("backup let a reader mailto through", refused(m))
    finally:
        FALLBACK, BLOCKED_HOST = False, ""
    if bad:
        print("email_links selftest FAILED: " + "; ".join(bad))
        return 1
    print("email_links selftest ok")
    return 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(selftest())
    print("usage: python3 scripts/email_links.py --selftest")
