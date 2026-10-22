#!/usr/bin/env python3
"""
email_links.py -- no link AGSIST emails carries the reader's address.

Oct 21, 2026: a Daily link of the form .../daily-elev?e=<address>&t=<hmac>
was scanned, reported as phishing, and the subs worker's host was blocked.
An address in a link is the phishing pattern, so since subs worker v5.46:

  * every list route the senders read (/list?format=json, /alert-list,
    /notice-list, /watch-list, /elevator-watch-list, /price-watch-list) gives
    each row a link id, lid: 16 letters that reveal nothing;
  * every signed route takes ?k=<lid>&t= in place of ?e=<address>&t=, with
    t = hmac16(lid + the same suffix as before), e.g. "|de", "|c|" + fips.

    signed(base, path, lid, secret, tail="", mid="", end="")
        base/path?k=<lid><mid>&t=<hmac16(lid + tail)><end>
    lid_of(row)          the row's lid, or None (an older worker, or a row the
                         worker had no room to number this call: skip it)
    link_ids(rows)       {address: lid} for the rows that have one
    check_message(msg)   raises LinkError when any link in the body or the
                         List-Unsubscribe header carries an address
    check_text(s)        the same for one body
    hrefs(html)          every href in an HTML body (for the selftests)

The error names how many links, never the address. Old ?e= links already in
inboxes keep working at the worker; nothing here makes a new one.

BACKUP MODE (Oct 22, 2026; scripts/list_source.py sets FALLBACK when the
subs worker is blocked and the list came from the private copy):

  * signed() for a stop link (unsubscribe, alert-unsubscribe,
    notice-unsubscribe, watch/elevator-watch/price-watch-unsubscribe) gives
    STOP_MAILTO (mailto:news@agsist.com?subject=unsubscribe); every other
    worker link (daily-elev, the confirm links) raises Withheld, so it is
    left out: no link may point at the blocked host.
  * check_message() puts STOP_LINE ("Reply STOP to stop these emails.") in
    the footer of each body, makes List-Unsubscribe the mailto alone (no
    List-Unsubscribe-Post: one-click needs https), and refuses any link to
    the blocked host (BLOCKED_HOST, the LIST_URL host).
  * the one mailto allowed in a body is STOP_MAILTO itself: our own
    mailbox, never the reader's.

    python3 scripts/email_links.py --selftest
"""
import hashlib
import hmac
import html as _html
import re
import sys
import urllib.parse

LID_RE = re.compile(r"^[0-9a-hjkmnp-tv-z]{16}$")
# A made-up id for previews and selftests (fits LID_RE; no reader has it).
SAMPLE_LID = "0123456789abcdef"
ADDRESS_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}")
HREF_RE = re.compile(r"""href\s*=\s*(?:"([^"]*)"|'([^']*)')""", re.I)
URL_RE = re.compile(r"""https?://[^\s<>"']+""", re.I)


class LinkError(ValueError):
    pass


class Withheld(LinkError):
    """Backup mode: this link goes through the blocked worker, so it is left out."""


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


def signed(base, path, lid, secret, tail="", mid="", end=""):
    lid = str(lid or "").strip().lower()
    if not LID_RE.match(lid):
        raise LinkError("no link id for this reader")
    if FALLBACK:
        if path.strip("/") in STOP_PATHS:
            return STOP_MAILTO
        raise Withheld("left out while the subs worker is blocked: " + path.strip("/"))
    u = "%s/%s?k=%s%s&t=%s%s" % (str(base).rstrip("/"), path.lstrip("/"), lid, mid, token(secret, lid + tail), end)
    check_text(u)
    return u


def hrefs(body):
    return [_html.unescape(a or b) for a, b in HREF_RE.findall(body or "")]


def _bad(u):
    s = _html.unescape(str(u))
    for _ in range(3):   # %2540 and the like
        s2 = urllib.parse.unquote(s)
        if s2 == s:
            break
        s = s2
    if s == STOP_MAILTO:
        return False          # our own stop mailbox, never the reader's (backup mode)
    return bool(ADDRESS_RE.search(s)) or "@" in s and s.lower().startswith("mailto:")


def blocked_links(body):
    """Backup mode: links (hrefs and bare URLs) that point at the blocked worker host."""
    if not BLOCKED_HOST:
        return []
    out = []
    for u in hrefs(body) + URL_RE.findall(_html.unescape(body or "")):
        try:
            h = urllib.parse.urlsplit(_html.unescape(u)).netloc.lower()
        except ValueError:
            h = ""
        if h == BLOCKED_HOST or BLOCKED_HOST in _html.unescape(u).lower():
            out.append(u)
    return out


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


def check_message(msg):
    if FALLBACK:
        for part in msg.walk():
            if part.get_content_maintype() == "text" and part.get_content_disposition() != "attachment":
                _with_stop_line(part)
        del msg["List-Unsubscribe-Post"]
        del msg["List-Unsubscribe"]
        msg["List-Unsubscribe"] = "<" + STOP_MAILTO + ">"
        for part in msg.walk():
            if part.get_content_maintype() == "text" and blocked_links(part.get_content()):
                raise LinkError("refusing to send: %d link(s) point at the blocked subs worker"
                                % len(blocked_links(part.get_content())))
    for part in msg.walk():
        if part.get_content_maintype() == "text":
            check_text(part.get_content())
    for item in re.findall(r"<([^>]*)>", str(msg.get("List-Unsubscribe") or "")):
        if item.lower().startswith(("http://", "https://")) and _bad(item):
            raise LinkError("refusing to send: the List-Unsubscribe link carries an email address")
    return msg


def selftest():
    from email.message import EmailMessage
    bad = []

    def ck(name, cond):
        if not cond:
            bad.append(name)

    u = signed("https://w.dev/", "unsubscribe", SAMPLE_LID, "sec")
    ck("signed shape", u == "https://w.dev/unsubscribe?k=%s&t=%s" % (SAMPLE_LID, token("sec", SAMPLE_LID)))
    ck("token is the worker's hmac16", token("sec", "AB|c|1") == hmac.new(b"sec", b"ab|c|1", hashlib.sha256).hexdigest()[:16])
    u = signed("https://w.dev", "watch-confirm", SAMPLE_LID, "sec", "|c|19169", "&f=19169")
    ck("mid before t", u.endswith("?k=%s&f=19169&t=%s" % (SAMPLE_LID, token("sec", SAMPLE_LID + "|c|19169"))))
    u = signed("https://w.dev", "notice-unsubscribe", SAMPLE_LID, "sec", end="&topic=rent%3Awi")
    ck("end after t", u.endswith("&t=%s&topic=rent%%3Awi" % token("sec", SAMPLE_LID)))
    for x in ("", "a@b.com", "ABC", "0123456789abcdeI"):
        try:
            signed("https://w.dev", "unsubscribe", x, "sec")
            bad.append("bad id taken: %r" % x)
        except LinkError:
            pass
    ck("lid_of", lid_of({"lid": SAMPLE_LID}) == SAMPLE_LID and lid_of({"lid": "x@y.com"}) is None and lid_of({}) is None and lid_of(None) is None)
    ck("link_ids", link_ids([{"email": "A@x.com", "lid": SAMPLE_LID}, {"email": "b@x.com"}]) == {"a@x.com": SAMPLE_LID})
    # the guard: addresses in links, raw, encoded, double encoded, in text or html
    for body in ('<a href="https://w.dev/unsubscribe?e=a%40b.com&amp;t=1">x</a>',
                 '<a href="https://w.dev/unsubscribe?e=a@b.com&t=1">x</a>',
                 "Unsubscribe: https://w.dev/unsubscribe?e=a%2540b.com&t=1",
                 "<a href='https://w.dev/daily-elev?e=farmer%40example.org&t=1'>x</a>",
                 '<a href="mailto:reader@example.com">x</a>'):
        try:
            check_text(body)
            bad.append("guard let through: " + body[:40])
        except LinkError as ex:
            ck("error names no address", "@" not in str(ex))
    for body in ('<a href="https://w.dev/unsubscribe?k=%s&amp;t=1">x</a> Reply to sig@farmers1st.com' % SAMPLE_LID,
                 "Map: https://www.google.com/maps/@44.9,-91.4,12z",
                 "plain text with no link"):
        try:
            check_text(body)
        except LinkError:
            bad.append("guard refused a clean body: " + body[:40])
    m = EmailMessage()
    m["List-Unsubscribe"] = "<https://w.dev/unsubscribe?e=a%40b.com&t=1>, <mailto:sig@farmers1st.com?subject=unsubscribe>"
    m.set_content("hi")
    try:
        check_message(m)
        bad.append("List-Unsubscribe address let through")
    except LinkError:
        pass
    m = EmailMessage()
    m["List-Unsubscribe"] = "<https://w.dev/unsubscribe?k=%s&t=1>, <mailto:sig@farmers1st.com?subject=unsubscribe>" % SAMPLE_LID
    m.set_content("hi")
    m.add_alternative('<a href="https://w.dev/x?e=a%40b.com">x</a>', subtype="html")
    try:
        check_message(m)
        bad.append("html part address let through")
    except LinkError:
        pass
    m = EmailMessage()
    m["List-Unsubscribe"] = "<https://w.dev/unsubscribe?k=%s&t=1>, <mailto:sig@farmers1st.com?subject=unsubscribe>" % SAMPLE_LID
    m.set_content("hi https://w.dev/unsubscribe?k=%s&t=1" % SAMPLE_LID)
    m.add_alternative('<a href="https://w.dev/unsubscribe?k=%s&amp;t=1">x</a>' % SAMPLE_LID, subtype="html")
    try:
        check_message(m)
    except LinkError:
        bad.append("clean message refused (the mailto in List-Unsubscribe is the sender's own)")
    ck("hrefs unescapes", hrefs('<a href="a?x=1&amp;y=2">') == ["a?x=1&y=2"])
    # backup mode: stop links are the mailto, other worker links are left out, the footer says STOP
    global FALLBACK, BLOCKED_HOST
    FALLBACK, BLOCKED_HOST = True, "w.dev"
    try:
        ck("fallback stop link is the mailto", signed("https://w.dev", "unsubscribe", SAMPLE_LID, "sec") == STOP_MAILTO
           and signed("https://w.dev", "watch-unsubscribe", SAMPLE_LID, "sec", "|w|1", "&f=1") == STOP_MAILTO)
        try:
            signed("https://w.dev", "daily-elev", SAMPLE_LID, "sec", "|de")
            bad.append("fallback made a daily-elev link")
        except Withheld:
            pass
        m = EmailMessage()
        m["List-Unsubscribe"] = "<https://w.dev/unsubscribe?k=%s&t=1>" % SAMPLE_LID
        m["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"
        m.set_content("hi\nUnsubscribe: " + STOP_MAILTO)
        m.add_alternative('<html><body><a href="%s">Unsubscribe</a></body></html>' % STOP_MAILTO, subtype="html")
        check_message(m)
        h, t = m.get_body(("html",)).get_content(), m.get_body(("plain",)).get_content()
        ck("fallback footer says STOP, both parts", STOP_LINE in h and STOP_LINE in t)
        ck("fallback List-Unsubscribe is the mailto alone", str(m["List-Unsubscribe"]) == "<" + STOP_MAILTO + ">" and m["List-Unsubscribe-Post"] is None)
        ck("fallback: no worker host anywhere", not blocked_links(h) and not blocked_links(t) and "w.dev" not in h + t)
        m = EmailMessage()
        m.set_content("see https://w.dev/daily-elev?k=%s&t=1" % SAMPLE_LID)
        try:
            check_message(m)
            bad.append("fallback let a worker link through")
        except LinkError:
            pass
        m = EmailMessage()
        m.set_content("x")
        m.add_alternative('<a href="mailto:reader@example.com">x</a>', subtype="html")
        try:
            check_message(m)
            bad.append("fallback let a reader mailto through")
        except LinkError:
            pass
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
