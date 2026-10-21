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
    return bool(ADDRESS_RE.search(s)) or "@" in s and s.lower().startswith("mailto:")


def bad_links(body):
    """The links in one body (hrefs and bare http(s) URLs) that carry an address."""
    return [u for u in hrefs(body) + URL_RE.findall(_html.unescape(body or "")) if _bad(u)]


def check_text(body):
    n = len(bad_links(body))
    if n:
        raise LinkError("refusing to send: %d link(s) carry an email address" % n)


def check_message(msg):
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
    if bad:
        print("email_links selftest FAILED: " + "; ".join(bad))
        return 1
    print("email_links selftest ok")
    return 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(selftest())
    print("usage: python3 scripts/email_links.py --selftest")
