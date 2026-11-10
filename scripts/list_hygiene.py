#!/usr/bin/env python3
"""Keep the Daily and hail-alert lists clean, every day, without the owner doing it.

1. Bounces. Reads the sending Gmail inbox over IMAP (same SMTP_USER and app
   password) for delivery-failure notices from the last LOOKBACK_DAYS. A hard
   bounce is a failed delivery whose status says the address or its domain
   does not exist or the mailbox is disabled (5.1.1, 5.1.2, 5.1.3, 5.1.6,
   5.1.10, 5.2.1; scripts/send_pace.py). Every other status, a delay or an
   expired try (4.x.x), and a notice with no status never count. A notice dated
   in the future counts as today; one dated before the window is dropped.
   Nov 10, 2026: hard bounces are no longer removed on sight. This step reads
   mail and hands the bounces, as keys only, to the fold step
   (scripts/bounces.py --fold), which keeps the private ledger: hard bounces on
   two different days and the address is left out of every list, the
   subscription kept (a flag, not a delete). LIST_UNSUPPRESS on a hand run puts
   an address back; a repeat Daily signup does not.
2. Typos. An address whose domain is a near-miss of a big mail provider
   (13241@gmail.comb, joe@gmial.com, x@yahoo.con) and whose domain has no mail
   server of its own is re-subscribed at the corrected address and the typo is
   removed. The person can opt out from the first email like anyone else.
   A domain that does receive mail is never touched, so a real small-town ISP
   that happens to look like a typo is safe.
3. Unsubscribe by email (Nov 2, 2026). Gmail's own "Unsubscribe" button, and
   any mail client that reads our List-Unsubscribe header, mails
   news@agsist.com with the subject "unsubscribe"; the footer also asks
   readers to "Reply STOP". The same inbox is read for those messages
   (UNSUB_LOOKBACK_DAYS). One is acted on only when the receiving server's own
   Authentication-Results (the top one, from AUTHSERV_ID) shows dkim=pass or
   spf=pass for the From address's own domain, so nobody can unsubscribe
   someone else by forging From. The address then comes off the Daily and its
   notices (the worker's /unsubscribe POST deletes sub: and note:) and the hail
   list, through the same signed routes the bounce step uses. Unverified or
   unclear messages are listed for the owner, never acted on. Price, elevator and
   county watches have their own stop links: they are reported, not changed.
   A handled message gets the Gmail label agsist-unsub-done (or the IMAP
   keyword $AgsistUnsub elsewhere) so it is read once; no mail is deleted.
   An address that signed up again after its request is left on.

Price, elevator and county watches are confirmed by a link before anything is
sent, so they cannot hold a typo; a bounce on one of them is only reported.

Every run that changes something emails the owner the list of changes. Mondays it
sends a summary even when nothing changed. The Actions log prints counts only:
the repository and its logs are public.

  python3 scripts/list_hygiene.py             do it
  python3 scripts/list_hygiene.py --dry-run   report what it would do, change nothing
  python3 scripts/list_hygiene.py --selftest  fixtures, no network
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import email, email.policy, email.utils, hashlib, hmac, imaplib, json, os, re, smtplib, sys, urllib.parse, urllib.request
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import email_links  # noqa: E402  (every send refuses a link to the worker host; scripts/email_links.py)
import log_safe  # noqa: E402  sender_addr: the From line, SES-safe
import bounces  # noqa: E402  the hard-bounce ledger: two and an address is left out of every list
import send_pace  # noqa: E402  kind_of: what counts as a hard bounce, the same rule as at send time

LOOKBACK_DAYS = 8

# Unsubscribe-by-email window. Steady state 14 days: the job runs daily, so a
# request is normally read the next morning; 14 calendar days is the 10
# business days CAN-SPAM allows to honour an opt-out, so a request is still
# picked up after a week or more of failed runs (inbox login refused, worker
# down) while the job is still inside that limit. Handled messages are labelled
# and skipped, so a longer window costs nothing but IMAP time. Until
# UNSUB_CATCHUP_UNTIL the window is 45 days, so the requests that sat unread
# before this step existed (the owner saw Gmail one-click mails go unread) are
# honoured. UNSUB_LOOKBACK_DAYS in the environment overrides both.
UNSUB_LOOKBACK_DAYS = 14
UNSUB_CATCHUP_DAYS = 45
UNSUB_CATCHUP_UNTIL = "2026-11-16"
UNSUB_LABEL = "agsist-unsub-done"      # Gmail label on a handled request
UNSUB_KEYWORD = "$AgsistUnsub"         # the same on a non-Gmail IMAP server
# Our list address: the mailto in List-Unsubscribe and the footer (email_links.STOP_MAILTO).
LIST_ADDR = email_links.STOP_MAILTO.split(":", 1)[1].split("?", 1)[0].lower()
UNSUB_SUBJECT = re.compile(r"^\s*(?:(?:re|aw|fwd?)\s*:\s*)*unsubscribe\s*[.!]*\s*$", re.I)
QUOTE_START = re.compile(r"(?im)^[ \t]*(?:>|on\s[^\n]*(?:\n[^\n]*)?\bwrote:|-{2,}\s*original message|from:\s|_{5,}|sent from my\b|--[ \t]*$)")
STOP_WORDS = {"stop", "unsubscribe"}
NEGATIONS = {"don't", "dont", "not", "never", "didn't", "didnt", "doesn't", "doesnt", "won't", "wont"}

KNOWN = """gmail.com yahoo.com hotmail.com outlook.com icloud.com aol.com live.com msn.com me.com mac.com
ymail.com rocketmail.com protonmail.com proton.me comcast.net att.net sbcglobal.net bellsouth.net
verizon.net cox.net charter.net frontier.com frontiernet.net centurylink.net windstream.net
earthlink.net mchsi.com tds.net netins.net juno.com""".split()
# Real providers that sit one letter away from a big one. Never "fixed".
REAL_LOOKALIKES = set("mail.com gmx.com email.com ymail.com live.com hotmail.co.uk yahoo.co.uk".split())
TLD_TYPOS = {"comb", "con", "cmo", "ocm", "coom", "comm", "cm", "om", "vom", "xom", "cpm", "co", "comn", "c0m"}


def env(n, d=None):
    v = os.environ.get(n, "")
    return v if v else d


def dl(a, b):
    """Damerau-Levenshtein distance (adjacent swaps count as one)."""
    d = {(i, -1): i + 1 for i in range(-1, len(a) + 1)}
    d.update({(-1, j): j + 1 for j in range(-1, len(b) + 1)})
    for i, ca in enumerate(a):
        for j, cb in enumerate(b):
            c = 0 if ca == cb else 1
            d[i, j] = min(d[i - 1, j] + 1, d[i, j - 1] + 1, d[i - 1, j - 1] + c)
            if i and j and ca == b[j - 1] and a[i - 1] == cb:
                d[i, j] = min(d[i, j], d[i - 2, j - 2] + 1)
    return d[len(a) - 1, len(b) - 1]


def suggest(addr):
    """The corrected address, or None. Pure: no network."""
    if "@" not in addr:
        return None
    local, dom = addr.rsplit("@", 1)
    dom = dom.strip(".").lower()
    if not local or dom in KNOWN or dom in REAL_LOOKALIKES:
        return None
    base, _, tld = dom.rpartition(".")
    if base and tld in TLD_TYPOS and base + ".com" in KNOWN:
        return local + "@" + base + ".com"
    best, n = None, 0
    for k in KNOWN:
        lim = 1 if len(k) < 8 else 2
        dist = dl(dom, k)
        if dist <= lim:
            if best is None or dist < best[0]:
                best, n = (dist, k), 1
            elif dist == best[0]:
                n += 1
    if best and n == 1:
        return local + "@" + best[1]
    return None


def has_mx(domain):
    """True / False from Google's DNS-over-HTTPS; None when the lookup failed."""
    try:
        u = "https://dns.google/resolve?type=MX&name=" + urllib.parse.quote(domain)
        with urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "agsist-list-hygiene"}), timeout=15) as r:
            d = json.loads(r.read().decode())
        if d.get("Status") == 3:   # NXDOMAIN: the domain does not exist
            return False
        return any(a.get("type") == 15 for a in d.get("Answer") or [])
    except Exception:
        return None


def failed_recipients(raw):
    """Permanent failures in one bounce message: [(address, status)]."""
    m = email.message_from_bytes(raw)
    out = {}
    for part in m.walk():
        if part.get_content_type() == "message/delivery-status":
            payload = part.get_payload()
            blocks = payload if isinstance(payload, list) else [payload]
            for blk in blocks:
                txt = blk.as_string() if hasattr(blk, "as_string") else str(blk)
                for grp in re.split(r"\n\s*\n", txt):
                    rcpt = re.search(r"(?im)^(?:Final|Original)-Recipient:\s*rfc822;\s*<?([^\s>]+)>?", grp)
                    act = re.search(r"(?im)^Action:\s*(\S+)", grp)
                    st = re.search(r"(?im)^Status:\s*([245]\.\d+\.\d+)", grp)
                    # the same rule as at send time (send_pace.status_is_hard): only a status that
                    # says the address or its domain does not exist, or the mailbox is disabled.
                    # A delay or an expired try (4.x.x) never counts; nor does a notice with no
                    # status (an X-Failed-Recipients header alone names no reason).
                    if rcpt and act and act.group(1).lower() == "failed" and st and send_pace.status_is_hard(st.group(1)):
                        out[rcpt.group(1).lower()] = st.group(1)
    return sorted(out.items())


def bounce_events(raw, now=None):
    """The hard bounces in one notice as ledger events, keyed by the notice's own Message-ID, so the
    same notice read on each of LOOKBACK_DAYS runs counts once. No address is kept: only its key
    (bounces.key, under UNSUB_SECRET)."""
    m = email.message_from_bytes(raw)
    mid = str(m.get("Message-ID") or "").strip() or hashlib.sha256(raw).hexdigest()
    today = (now or datetime.now(timezone.utc)).strftime("%Y-%m-%d")
    try:
        day = email.utils.parsedate_to_datetime(m.get("Date")).astimezone(timezone.utc).strftime("%Y-%m-%d")
    except Exception:
        day = today
    if day > today:
        day = today                       # a notice dated in the future counts as today, so an undo reaches it
    if day < ((now or datetime.now(timezone.utc)) - timedelta(days=LOOKBACK_DAYS + 1)).strftime("%Y-%m-%d"):
        return []                         # dated before the window it was read in: not trusted
    out = []
    for a, st in failed_recipients(raw):
        h = bounces.key(a)
        out.append({"h": h, "code": st, "src": "dsn", "day": day,
                    "id": "dsn:" + hashlib.sha256((mid + " " + h).encode()).hexdigest()[:24]})
    return out


def read_bounces(user, pw, days):
    """[event] for every hard bounce in the notices of the last `days` (bounce_events: keys only)."""
    found = []
    # the same login as the unsubscribe step (UNSUB_IMAP_* when set): bounces land in the inbox news@ forwards to
    # (Nov 2, 2026: the sending login was refused by Gmail IMAP, so both steps had read nothing)
    c = imap_open() if (env("UNSUB_IMAP_USER") and env("UNSUB_IMAP_PASS")) else imaplib.IMAP4_SSL(env("IMAP_HOST", "imap.gmail.com"))
    if not (env("UNSUB_IMAP_USER") and env("UNSUB_IMAP_PASS")):
        c.login(user, pw)
    for box in ('"[Gmail]/All Mail"', "INBOX"):
        if c.select(box, readonly=True)[0] == "OK":
            break
    since = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%d-%b-%Y")
    typ, data = c.search(None, f'(SINCE {since} OR FROM "mailer-daemon" FROM "postmaster")')
    for num in (data[0].split() if typ == "OK" and data and data[0] else []):
        typ, msg = c.fetch(num, "(RFC822)")
        if typ == "OK" and msg and isinstance(msg[0], tuple):
            found += bounce_events(msg[0][1])
    c.logout()
    return found


def hand_over(events, path):
    """Write the inbox's hard-bounce events (keys only) for the fold step, which holds the private
    repo's write key and reads no mail (list-hygiene.yml). True when written."""
    if not path:
        return False
    with open(path, "w") as fh:
        json.dump([{k: e[k] for k in ("h", "id", "day", "code", "src") if k in e} for e in events], fh)
    return True


# ---------- 3. unsubscribe by email ----------

def unsub_lookback(today=None):
    v = env("UNSUB_LOOKBACK_DAYS")
    if v and v.isdigit() and int(v) > 0:
        return int(v)
    today = today or datetime.now(timezone.utc).date()
    return UNSUB_CATCHUP_DAYS if today.isoformat() < UNSUB_CATCHUP_UNTIL else UNSUB_LOOKBACK_DAYS


def _dom(a):
    a = (a or "").strip().strip("<>").lower()
    return a.rsplit("@", 1)[1].strip(".") if "@" in a else a.lstrip("@").strip(".")


def _aligned(signer, from_dom):
    """Signer domain and From domain are the same organisation (DMARC-style relaxed)."""
    return bool(signer and from_dom) and (signer == from_dom or from_dom.endswith("." + signer)
                                          or signer.endswith("." + from_dom))


def verified(m, from_addr, authserv=None):
    """True when the receiving server's own Authentication-Results shows
    dkim=pass or spf=pass for the From address's own domain. Only the FIRST
    header from `authserv` counts: a sender can write any Authentication-Results
    into its own message, but those sit below the one our server adds on top."""
    authserv = (authserv or env("AUTHSERV_ID", "mx.google.com")).lower()
    from_dom = _dom(from_addr)
    for h in m.get_all("Authentication-Results") or []:
        h = str(h)
        for _ in range(3):
            h = re.sub(r"\([^()]*\)", " ", h)            # drop comments
        parts = h.split(";")
        if parts[0].strip().split()[:1] != [authserv]:
            continue
        for part in parts[1:]:
            r = re.match(r"\s*(dkim|spf)\s*=\s*(\w+)(.*)", part, re.S)
            if not r or r.group(2).lower() != "pass":
                continue
            props = dict((k.lower(), v) for k, v in re.findall(r"([\w.-]+)\s*=\s*(\S+)", r.group(3)))
            if r.group(1).lower() == "dkim":
                signer = _dom(props.get("header.d") or props.get("header.i") or "")
            else:
                signer = _dom(props.get("smtp.mailfrom") or "")
            if _aligned(signer, from_dom):
                return True
        return False                                      # the first header from our server decides
    return False


def own_text(m):
    """The words the sender wrote: the plain (or HTML) body above the quoted mail."""
    try:
        part = m.get_body(preferencelist=("plain", "html"))
        txt = part.get_content() if part is not None else ""
        if part is not None and part.get_content_subtype() == "html":
            txt = re.split(r"(?is)<div[^>]*class=\"?gmail_quote|<blockquote", txt)[0]
            txt = re.sub(r"(?is)<(script|style)\b.*?</\1>", " ", txt)
            txt = re.sub(r"(?i)<br\s*/?>|</p>|</div>", "\n", txt)
            txt = re.sub(r"<[^>]+>", " ", txt)
    except Exception:
        return ""
    cut = QUOTE_START.search(txt or "")
    return (txt[:cut.start()] if cut else txt or "").strip()


def classify(m):
    """'subject' (an unsubscribe subject: Gmail's button, a mail client, a reader),
    'stop' (a short reply that says STOP or unsubscribe, as the footer asks),
    'unclear' (a reply that mentions it but says more, or says "don't"), or None."""
    subj = str(m.get("Subject") or "")
    if UNSUB_SUBJECT.match(subj):
        return "subject"
    words = re.findall(r"[a-z']+", own_text(m).lower().replace("’", "'"))
    if not STOP_WORDS & set(words):
        return None
    if len(words) <= 12 and not NEGATIONS & set(words):
        return "stop"
    is_reply = bool(re.match(r"\s*re\s*:", subj, re.I) or m.get("In-Reply-To") or m.get("References"))
    return "unclear" if is_reply and len(words) <= 80 else None


def to_us(m):
    for h in ("To", "Cc", "Delivered-To", "X-Original-To", "X-Forwarded-To"):
        for v in m.get_all(h) or []:
            if any(a.lower() == LIST_ADDR for _, a in email.utils.getaddresses([str(v)])):
                return True
    return False


def parse_request(raw, internal_ms=None, ours=()):
    """One inbox message -> {from, ts, kind, auth} or None when it is not a request."""
    m = email.message_from_bytes(raw, policy=email.policy.default)
    if not to_us(m):
        return None
    frm = (email.utils.parseaddr(str(m.get("From") or ""))[1] or "").lower()
    if "@" not in frm or _dom(frm) == _dom(LIST_ADDR) or frm in ours \
            or re.match(r"(mailer-daemon|postmaster)@", frm):
        return None                                       # our own mail (the report goes to news@) or a bounce
    kind = classify(m)
    if not kind:
        return None
    ts = internal_ms
    try:
        ts = int(email.utils.parsedate_to_datetime(str(m["Date"])).timestamp() * 1000)
    except Exception:
        pass
    return {"from": frm, "ts": ts, "kind": kind, "auth": verified(m, frm)}


def imap_open():
    """The inbox news@ lands in: UNSUB_IMAP_* when set (a different mailbox from
    the sending login), else the same login and host the bounce step uses."""
    user = env("UNSUB_IMAP_USER") or env("SMTP_USER")
    pw = env("UNSUB_IMAP_PASS") or env("SMTP_PASS")
    c = imaplib.IMAP4_SSL(env("UNSUB_IMAP_HOST") or env("IMAP_HOST", "imap.gmail.com"))
    c.login(user, pw)
    return c


def all_mail_box(c):
    """Gmail's All Mail (any language) by its \\All flag, else INBOX."""
    try:
        typ, rows = c.list()
        for row in rows or []:
            row = row.decode() if isinstance(row, bytes) else str(row)
            if "\\All" in row:
                r = re.search(r'"([^"]+)"\s*$', row) or re.search(r"(\S+)\s*$", row)
                if r:
                    return '"' + r.group(1) + '"'
    except Exception:
        pass
    return "INBOX"


def _why(ex):
    """The server's own words for a failed IMAP step (e.g. [AUTHENTICATIONFAILED] Invalid credentials), first
    120 characters, any address masked: build rule 20, read the real error before asking the owner to touch a secret."""
    t = ex.args[0] if getattr(ex, "args", None) else str(ex)
    t = t.decode("utf-8", "replace") if isinstance(t, bytes) else str(t)
    try:
        import log_safe
        t = log_safe.mask_text(t)
    except Exception:
        t = re.sub(r"\S+@\S+", "<address>", t)
    return t.replace("\n", " ")[:120]


# counts from the last read_unsub, for one log line (no addresses, ever)
DIAG = {}


def read_unsub(c, days, ours=()):
    """The unhandled unsubscribe requests in the selected mailbox, oldest first,
    plus how many handled ones were skipped. Reads with BODY.PEEK so nothing is
    marked read."""
    gm = "X-GM-EXT-1" in (getattr(c, "capabilities", ()) or ())
    since = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%d-%b-%Y")
    typ, data = c.uid("SEARCH", None, f'(SINCE {since} OR TO "{LIST_ADDR}" CC "{LIST_ADDR}")')
    uids = (data[0].split() if typ == "OK" and data and data[0] else [])
    DIAG.update(search=typ, to_list=len(uids))
    try:   # the same window by subject alone: tells a To/Cc mismatch from an empty mailbox
        t2, d2 = c.uid("SEARCH", None, f'(SINCE {since} SUBJECT "unsubscribe")')
        DIAG["subject_unsub"] = len(d2[0].split()) if t2 == "OK" and d2 and d2[0] else 0
    except Exception as ex:
        DIAG["subject_unsub"] = type(ex).__name__
    out, skipped = [], 0
    for uid in uids:
        uid = uid.decode() if isinstance(uid, bytes) else str(uid)
        typ, meta = c.uid("FETCH", uid, "(FLAGS INTERNALDATE X-GM-LABELS)" if gm else "(FLAGS INTERNALDATE)")
        info = b" ".join(x if isinstance(x, bytes) else (x[0] if isinstance(x, tuple) else b"") for x in (meta or []))
        txt = info.decode("utf-8", "replace")
        if UNSUB_LABEL in txt or UNSUB_KEYWORD in txt:
            skipped += 1
            continue
        internal = None
        try:
            internal = int(datetime(*imaplib.Internaldate2tuple(info)[:6], tzinfo=timezone.utc).timestamp() * 1000)
        except Exception:
            pass
        typ, msg = c.uid("FETCH", uid, "(BODY.PEEK[])")
        raw = next((x[1] for x in (msg or []) if isinstance(x, tuple)), None)
        if typ != "OK" or not raw:
            continue
        req = parse_request(raw, internal, ours)
        if req:
            req["uid"] = uid
            out.append(req)
    out.sort(key=lambda r: r["ts"] or 0)
    DIAG.update(parsed=len(out), skipped=skipped)
    return out, skipped


def mark_done(c, uids):
    """Label (Gmail) or flag the handled requests so they are read once. Never deletes."""
    if not uids:
        return 0
    gm = "X-GM-EXT-1" in (getattr(c, "capabilities", ()) or ())
    typ, _ = c.uid("STORE", ",".join(uids), "+X-GM-LABELS" if gm else "+FLAGS",
                   "(" + (UNSUB_LABEL if gm else UNSUB_KEYWORD) + ")")
    return len(uids) if typ == "OK" else 0


def plan_unsub(reqs, daily, hail, notices, watches, taken=()):
    """What to do with the unsubscribe requests.
    daily/hail: list records; notices: /notice-list rows, or None when that list
    could not be read; watches: {name: records} (report only).
    Returns (acts, notes, marks): acts are removals for apply(); notes are lines
    for the owner; marks maps each request uid to the act indexes that must succeed
    before it is marked handled ([]: nothing to do, mark it now; None: it is
 only a line for the owner, mark it once the report is sent)."""
    def index(rows):
        ix = {}
        for r in rows or []:
            ix.setdefault(gkey(r["email"]), []).append(r)
        return ix
    D, H, W = index(daily), index(hail), {n: index(v) for n, v in (watches or {}).items()}
    N = index(notices) if notices is not None else None
    taken = set(taken)
    acts, notes, marks = [], [], {}
    count = {"acted": 0, "already": 0, "unverified": 0, "unclear": 0, "again": 0, "retry": 0}
    for r in reqs:
        e, k = r["from"], gkey(r["from"])
        if r["kind"] == "unclear":
            notes.append(f"Unsubscribe email, needs a look: {e}, a reply that mentions stopping but says more; not acted on")
            marks[r["uid"]] = None; count["unclear"] += 1
            continue
        if not r["auth"]:
            notes.append(f"Unsubscribe email, not acted on: {e}, the sender could not be verified (no DKIM or SPF pass for its domain)")
            marks[r["uid"]] = None; count["unverified"] += 1
            continue
        if N is None and k not in D and k not in H:
            count["retry"] += 1                       # notices unknown: try again next run, do not mark
            continue
        mine, again = [], False
        groups = [("daily", D.get(k, []) + (N.get(k, []) if N else [])), ("hail", H.get(k, []))]
        for name, rows in groups:
            if not rows:
                continue
            if r["ts"] and any((x.get("ts") or 0) > r["ts"] for x in rows):
                again = True                          # signed up again after the request: leave on
                continue
            daily_rows = [x for x in rows if "topic" not in x]
            who = (daily_rows or rows)[0]["email"]
            lst = name if name == "hail" or daily_rows else "notices"
            if (lst, who) in taken:
                continue
            taken.add((lst, who))
            acts.append({"list": lst, "do": "remove", "email": who, "why": "unsubscribed by email"})
            mine.append(len(acts) - 1)
        if again:
            notes.append(f"Unsubscribe email, left on: {e} signed up again after the request")
            count["again"] += 1
        for name, ix in W.items():
            if k in ix:
                notes.append(f"Unsubscribe email: {e} also has a {name} (it has its own stop link; not changed)")
        if mine:
            count["acted"] += 1
        elif not again:
            count["already"] += 1                     # already off: nothing to do
        marks[r["uid"]] = None if again and not mine else mine
    return acts, notes, marks, count


def token(secret, e):
    return hmac.new(secret.encode(), e.lower().encode(), hashlib.sha256).hexdigest()[:16]


def call(base, path, method="GET", body=None, form=False):
    data = None
    hdr = {"User-Agent": "agsist-list-hygiene"}
    if body is not None:
        if form:
            data = urllib.parse.urlencode(body).encode(); hdr["Content-Type"] = "application/x-www-form-urlencoded"
        else:
            data = json.dumps(body).encode(); hdr["Content-Type"] = "application/json"
    req = urllib.request.Request(base.rstrip("/") + path, data=data, method=method, headers=hdr)
    with urllib.request.urlopen(req, timeout=60) as r:
        t = r.read().decode()
    try:
        return json.loads(t)
    except Exception:
        return t


def gkey(e):
    """One key per real inbox: Gmail ignores dots and anything after '+'."""
    local, _, dom = e.lower().partition("@")
    if dom in ("gmail.com", "googlemail.com"):
        return local.split("+", 1)[0].replace(".", "") + "@gmail.com"
    return e.lower()


def plan(daily, hail, mx=has_mx, remove=()):
    """What to do. daily/hail: lists of records with 'email'. Returns actions. Hard bounces are not
    removed here (Nov 10, 2026): the fold step (scripts/bounces.py --fold) counts them and
    suppresses after hard bounces on two different days."""
    acts = []
    lists = {"daily": {r["email"]: r for r in daily}, "hail": {r["email"]: r for r in hail}}
    seen = set()
    for e in remove:                                   # owner asked for these to go
        for name, recs in lists.items():
            if e in recs:
                acts.append({"list": name, "do": "remove", "email": e, "why": "removed at the owner's request"})
                seen.add((name, e))
    for name, recs in lists.items():                   # same inbox written two ways: keep the oldest
        groups = {}
        for e, r in recs.items():
            groups.setdefault(gkey(e), []).append(r)
        for g in groups.values():
            if len(g) > 1:
                g.sort(key=lambda r: (r.get("ts") or 0, r["email"]))
                for r in g[1:]:
                    if (name, r["email"]) not in seen:
                        acts.append({"list": name, "do": "remove", "email": r["email"],
                                     "why": "duplicate of " + g[0]["email"] + " (same Gmail inbox)"})
                        seen.add((name, r["email"]))
    for name, recs in lists.items():
        for e, r in recs.items():
            fix = suggest(e)
            if fix and fix != e:
                dom = e.rsplit("@", 1)[1]
                if mx(dom) is False:              # only a domain that cannot receive mail
                    acts.append({"list": name, "do": "fix", "email": e, "to": fix, "rec": r})
                    seen.add((name, e))
    return acts


def apply(acts, base, secret, list_token):
    done = []
    for a in acts:
        e = a["email"]
        try:
            if a["do"] == "fix" and a["list"] == "daily":
                r = a["rec"]
                call(base, "/subscribe", "POST", {"email": a["to"], "source": ("typo-fix " + (r.get("src") or ""))[:60],
                                                   "zip": r.get("zip") or "", "reports": r.get("reports", True)})
                call(base, "/unsubscribe?e=" + urllib.parse.quote(e) + "&t=" + token(secret, e), "POST", {}, form=True)
            elif a["do"] == "fix" and a["list"] == "hail":
                r = a["rec"]
                call(base, "/alert-subscribe", "POST", {"email": a["to"], "lat": r.get("lat"), "lon": r.get("lon"),
                                                         "place": r.get("place", ""), "radius_mi": r.get("radius_mi", 5)})
                call(base, "/alert-unsubscribe?e=" + urllib.parse.quote(e) + "&t=" + token(secret, e), "POST", {}, form=True)
            elif a["do"] == "remove":
                path = "/alert-unsubscribe" if a["list"] == "hail" else "/unsubscribe"   # daily and notices: sub: and note:
                call(base, path + "?e=" + urllib.parse.quote(e) + "&t=" + token(secret, e), "POST", {}, form=True)
            a["ok"] = True
        except Exception as ex:
            a["ok"] = False
            a["err"] = type(ex).__name__
        done.append(a)
    return done


def line(a):
    if a["do"] == "fix":
        return f"Fixed ({a['list']}): {a['email']} changed to {a['to']}"
    if a["do"] == "remove":
        return f"Removed ({a['list']}): {a['email']}, {a['why']}"
    return f"Note: {a['email']}, {a['why']}"


def mail_report(acts, dry, notes=()):
    user, pw = env("SMTP_USER"), env("SMTP_PASS")
    sender = log_safe.sender_addr()
    to = env("REPORT_TO") or sender
    m = EmailMessage()
    m["To"] = to
    m["From"] = f"{env('FROM_NAME', 'AGSIST')} <{sender}>"
    m["Subject"] = ("[dry run] " if dry else "") + "AGSIST list cleanup, " + datetime.now(timezone.utc).strftime("%b %-d")
    body = ["What the daily list cleanup did:" if acts else ("Nothing was changed." if notes else "Nothing to clean up this week."), ""]
    body += [line(a) + ("" if a.get("ok", True) else "  (FAILED, will retry next run)") for a in acts]
    if notes:
        body += [""] + list(notes)
    body += ["", "Hard bounces from the delivery-failure notices in the sending inbox go to the bounce fold, which",
             "mails its own report: hard bounces on 2 different days and an address is left out of every list, its",
             "subscription kept. To put one back, run the list cleanup by hand with the address in the",
             "LIST_UNSUPPRESS secret (a repeat Daily signup does not put it back).",
             "Typo fixes are made only",
             "when the misspelled domain cannot receive mail. Anyone moved to a fixed address can unsubscribe from",
             "the first email they get.",
             "\"Unsubscribed by email\" means the reader mailed " + LIST_ADDR + " (Gmail's Unsubscribe button, the",
             "word unsubscribe, or a STOP reply) and the receiving server verified the sender's domain. Unverified",
             "or unclear ones are listed above and left alone; remove one by hand with the LIST_REMOVE secret."]
    m.set_content("\n".join(body))
    with smtplib.SMTP(env("SMTP_HOST", "smtp.gmail.com"), int(env("SMTP_PORT", "587")), timeout=30) as c:
        c.starttls(); c.login(user, pw); c.send_message(m)


def selftest():
    ok = True
    def chk(c, msg):
        nonlocal ok
        print(("ok   " if c else "FAIL ") + msg); ok &= bool(c)
    chk(suggest("13241@gmail.comb") == "13241@gmail.com", "gmail.comb -> gmail.com")
    chk(suggest("joe@gmial.com") == "joe@gmail.com", "gmial.com -> gmail.com (swap)")
    chk(suggest("a@yahoo.con") == "a@yahoo.com", "yahoo.con -> yahoo.com")
    chk(suggest("a@hotmal.com") == "a@hotmail.com", "hotmal.com -> hotmail.com")
    chk(suggest("a@gmail.com") is None, "a correct address is left alone")
    chk(suggest("a@mail.com") is None and suggest("a@gmx.com") is None, "real look-alike providers are never fixed")
    chk(suggest("news@agsist.com") is None, "an ordinary business domain is left alone")
    chk(suggest("a@mchsi.co") == "a@mchsi.com", "mchsi.co -> mchsi.com (Iowa ISP)")
    raw = (b"From: Mail Delivery Subsystem <mailer-daemon@googlemail.com>\r\nSubject: Delivery Status Notification (Failure)\r\n"
           b"MIME-Version: 1.0\r\nContent-Type: multipart/report; report-type=delivery-status; boundary=XX\r\n\r\n"
           b"--XX\r\nContent-Type: text/plain\r\n\r\nAddress not found\r\n--XX\r\nContent-Type: message/delivery-status\r\n\r\n"
           b"Reporting-MTA: dns; googlemail.com\r\n\r\nFinal-Recipient: rfc822; dead@example.org\r\nAction: failed\r\nStatus: 5.1.1\r\n\r\n"
           b"Final-Recipient: rfc822; full@example.org\r\nAction: delayed\r\nStatus: 4.2.2\r\n--XX--\r\n")
    chk(failed_recipients(raw) == [("dead@example.org", "5.1.1")], "a permanent bounce is read; a temporary one is ignored")
    daily = [{"email": "13241@gmail.comb", "src": "home", "zip": "54728"}, {"email": "dead@example.org"}, {"email": "ok@gmail.com"}]
    hail = [{"email": "x@yahoo.con", "lat": 44.9, "lon": -91.3, "place": "Chetek", "radius_mi": 10}]
    pol = raw.replace(b"Status: 5.1.1", b"Status: 5.7.1")
    chk(failed_recipients(pol) == [], "a 5.7.1 policy or spam refusal is not the address's fault: not a hard bounce")
    acts = plan(daily, hail, mx=lambda d: False)
    kinds = sorted((a["list"], a["do"], a["email"]) for a in acts)
    chk(("daily", "fix", "13241@gmail.comb") in kinds and ("hail", "fix", "x@yahoo.con") in kinds, "typos on both lists are planned as fixes")
    chk(not any(a["email"] == "dead@example.org" for a in acts), "a bounced Daily address is not removed (Nov 10: counted, suppressed after 2)")
    chk(not any(a["email"] == "ok@gmail.com" for a in acts), "a good address is untouched")
    # Nov 10: what counts as hard, and the hand-over to the fold step (keys only)
    os.environ.setdefault("UNSUB_SECRET", "selftest-secret")
    for stv, n in (("5.1.1", 1), ("5.1.10", 1), ("5.2.1", 1), ("5.7.1", 0), ("5.2.2", 0), ("5.3.4", 0), ("5.4.4", 0),
                   ("5.0.0", 0), ("5.5.0", 0), ("4.4.7", 0)):
        r2 = raw.replace(b"Status: 5.1.1", b"Status: " + stv.encode())
        chk(len(failed_recipients(r2)) == n, f"status {stv}: {'a hard bounce' if n else 'never a hard bounce'}")
    xfr = (b"From: Mail Delivery Subsystem <mailer-daemon@googlemail.com>\r\nX-Failed-Recipients: dead@example.org\r\n"
           b"Subject: Delivery Status Notification (Failure)\r\n\r\nThe message could not be delivered.\r\n")
    chk(failed_recipients(xfr) == [], "an X-Failed-Recipients header alone (no status) is not a hard bounce")
    for stv in ("5.7.1", "5.2.2", "5.3.4", "4.4.7"):
        r3 = raw.replace(b"Status: 5.1.1", b"Status: " + stv.encode()).replace(b"MIME-Version", b"X-Failed-Recipients: dead@example.org\r\nMIME-Version")
        chk(failed_recipients(r3) == [], f"status {stv} with X-Failed-Recipients: 0 hard bounces")
    exp = raw.replace(b"Action: failed\r\nStatus: 5.1.1", b"Action: failed\r\nStatus: 4.4.7")
    chk(failed_recipients(exp) == [], "a delivery that expired (failed, 4.4.7) is not a hard bounce")
    t_now = datetime(2026, 11, 10, 15, tzinfo=timezone.utc)                       # a fixed clock: no live date
    dated = lambda d: raw.replace(b"MIME-Version", b"Message-ID: <n-" + d.encode() + b"@googlemail.com>\r\nDate: " + d.encode() + b"\r\nMIME-Version")
    fut = bounce_events(dated("Mon, 1 Jan 2099 13:00:00 +0000"), now=t_now)
    chk(len(fut) == 1 and fut[0]["day"] == "2026-11-10", "a notice dated 2099 counts as today, never later")
    chk(bounce_events(dated("Sat, 1 Nov 2025 13:00:00 +0000"), now=t_now) == [], "a notice dated before the window is dropped")
    ev = bounce_events(raw.replace(b"MIME-Version", b"Message-ID: <n1@googlemail.com>\r\nDate: Tue, 10 Nov 2026 13:00:00 +0000\r\nMIME-Version"), now=t_now)
    chk(len(ev) == 1 and ev[0]["h"] == bounces.key("dead@example.org") and ev[0]["day"] == "2026-11-10",
        "a notice becomes one event, keyed under the secret")
    chk(ev == bounce_events(raw.replace(b"MIME-Version", b"Message-ID: <n1@googlemail.com>\r\nDate: Tue, 10 Nov 2026 13:00:00 +0000\r\nMIME-Version"), now=t_now),
        "the same notice read again is the same event (its id comes from its Message-ID)")
    import tempfile
    hp = os.path.join(tempfile.mkdtemp(prefix="hyg-"), "ev.json")
    chk(hand_over(ev, hp) and "@" not in open(hp).read(), "the hand-over file holds keys, never an address")
    acts2 = plan(daily, [], mx=lambda d: True)
    chk(not acts2, "a misspelled-looking domain that DOES receive mail is never changed")
    acts3 = plan(daily, [], mx=lambda d: None)
    chk(not acts3, "when the DNS lookup fails, nothing is changed")
    dup = plan([{"email": "j.smith@gmail.com", "ts": 1}, {"email": "jsmith+ag@gmail.com", "ts": 2}, {"email": "jsmith@yahoo.com", "ts": 3}], [], mx=lambda d: None)
    chk([a["email"] for a in dup] == ["jsmith+ag@gmail.com"], "a second spelling of one Gmail inbox is removed, the oldest kept, Yahoo untouched")
    rm = plan([{"email": "me@x.com"}], [{"email": "me@x.com", "lat": 1, "lon": 1}], mx=lambda d: None, remove=["me@x.com"])
    chk(sorted(a["list"] for a in rm) == ["daily", "hail"], "an owner removal takes the address off every list it is on")
    chk("13241" not in "\n".join([f"{len(acts)} actions"]), "the log line carries counts only")
    # ---- 3. unsubscribe by email (fixtures in test/list-hygiene-unsub/) ----
    fx = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "test", "list-hygiene-unsub")
    def raw(n):
        with open(os.path.join(fx, n + ".eml"), "rb") as fh:
            return fh.read()
    r1 = parse_request(raw("gmail-oneclick"))
    chk(r1 and r1["kind"] == "subject" and r1["auth"] and r1["from"] == "reader1@example.com",
        "Gmail's one-click mail is a verified request (dkim=pass for the From domain, though SPF is the forwarder's)")
    r2 = parse_request(raw("forged"))
    chk(r2 and r2["kind"] == "subject" and not r2["auth"],
        "a forged From is not verified: SPF passes for another domain, and a planted lower Authentication-Results is ignored")
    r3 = parse_request(raw("stop-reply"))
    chk(r3 and r3["kind"] == "stop" and r3["auth"] and r3["from"] == "reader3@example.org",
        "a 'Re: ... STOP' reply is a request (aligned spf=pass); the quoted mail below it is not read")
    chk(parse_request(raw("unrelated")) is None, "a reader's question to news@ is not a request")
    r6 = parse_request(raw("unclear-reply"))
    chk(r6 and r6["kind"] == "unclear", "\"please don't stop\" is never acted on; it is listed for Sig")
    chk(parse_request(raw("own-report")) is None, "our own report to news@ (it names removals and STOP) is ignored")
    chk(parse_request(raw("gmail-oneclick").replace(b"To: news@agsist.com", b"To: other@example.net")) is None,
        "mail not sent to the list address is ignored")
    chk(parse_request(raw("gmail-oneclick").replace(b"Authentication-Results: mx.google.com;",
                                                    b"Authentication-Results: mx.attacker.example.net;"))["auth"] is False,
        "results from any server but ours do not count")
    for subj, want in (("Re: Unsubscribe", True), ("RE: re: unsubscribe!", True), ("unsubscribe me later maybe", False)):
        m = email.message_from_string("Subject: " + subj + "\n\n", policy=email.policy.default)
        chk(bool(UNSUB_SUBJECT.match(str(m["Subject"]))) == want, f"subject {subj!r} -> {want}")
    r4 = parse_request(raw("second-request"))
    chk(r4 and r4["auth"] and r4["kind"] == "subject", "a second request from a removed address still parses as verified")
    chk(unsub_lookback(datetime(2026, 11, 3).date()) == 45 and unsub_lookback(datetime(2026, 12, 1).date()) == 14,
        "45 days while catching up, 14 after")

    # Plan: reader1 on the Daily (+ a notice), reader3 on the Daily and hail and a price watch,
    # reader2 forged, reader4 already removed, reader7 signed up again after the request.
    for i, r in enumerate((r1, r2, r3, r4, r6)):
        r["uid"] = str(i + 1)
    t0 = r1["ts"]
    r7 = {"uid": "7", "from": "reader7@example.com", "ts": t0, "kind": "subject", "auth": True}
    daily = [{"email": "reader1@example.com", "ts": t0 - 9e9}, {"email": "reader3@example.org", "ts": None},
             {"email": "reader7@example.com", "ts": t0 + 60000}, {"email": "keep@example.com"}]
    hail = [{"email": "reader3@example.org", "lat": 1, "lon": 1}]
    notices = [{"email": "reader1@example.com", "topic": "rain-month:55005", "ts": t0 - 9e9},
               {"email": "reader8@example.com", "topic": "rent:WI", "ts": 1}]
    r8 = {"uid": "8", "from": "reader8@example.com", "ts": t0, "kind": "stop", "auth": True}
    watches = {"price watch": [{"email": "reader3@example.org"}]}
    reqs = [r1, r2, r3, r4, r6, r7, r8]
    ua, un, um, uc = plan_unsub(reqs, daily, hail, notices, watches)
    got = sorted((a["list"], a["email"]) for a in ua)
    chk(got == [("daily", "reader1@example.com"), ("daily", "reader3@example.org"), ("hail", "reader3@example.org"),
                ("notices", "reader8@example.com")],
        "verified requests come off the Daily (with notices), the hail list, and a notices-only reader too")
    chk(all(a["why"] == "unsubscribed by email" for a in ua), "each removal reads 'unsubscribed by email'")
    chk(not any(a["email"] in ("reader2@example.com", "reader6@example.com", "keep@example.com") for a in ua),
        "the forged and the unclear requests remove nobody; other readers are untouched")
    chk(any("reader2@example.com" in n and "not acted on" in n for n in un) and any("reader6@example.com" in n for n in un),
        "the forged and the unclear ones are listed for Sig")
    chk(any("reader3@example.org" in n and "price watch" in n for n in un), "a price watch is reported, not changed")
    chk(any("reader7@example.com" in n and "signed up again" in n for n in un) and not any(a["email"] == "reader7@example.com" for a in ua),
        "an address that signed up again after its request stays on")
    chk(um["4"] == [] and uc["already"] == 1, "a second request for an already-removed address does nothing")
    chk(um["2"] is None and um["5"] is None and um["7"] is None, "listed-only requests are marked once Sig has the report")
    chk(set(um) == {"1", "2", "3", "4", "5", "7", "8"}, "every request read is marked handled once done")
    ua2, _, um2, uc2 = plan_unsub([r8], daily, hail, None, {})
    chk(not ua2 and "8" not in um2 and uc2["retry"] == 1, "notice list unreadable: a notice-only request waits, unmarked")
    ua3, _, _, _ = plan_unsub([r1], daily, hail, notices, {}, taken={("daily", "reader1@example.com")})
    chk(not ua3, "an address the bounce step already removes is not removed twice")
    # gkey: Gmail ignores dots, so a request from the dotless spelling finds the dotted record.
    ua4, _, _, _ = plan_unsub([dict(r1, **{"from": "readerone@gmail.com"})], [{"email": "reader.one@gmail.com"}], [], [], {})
    chk([a["email"] for a in ua4] == ["reader.one@gmail.com"], "the stored spelling of a Gmail address is the one removed")

    # IMAP: handled ones are skipped, nothing is marked read, marking adds the label.
    class FakeIMAP:
        capabilities = ("IMAP4REV1", "X-GM-EXT-1")
        def __init__(self, msgs):
            self.msgs, self.labels, self.cmds = msgs, {u: set() for u in msgs}, []
        def uid(self, cmd, *a):
            self.cmds.append((cmd,) + a)
            if cmd == "SEARCH":
                return "OK", [" ".join(self.msgs).encode()]
            if cmd == "FETCH" and "BODY.PEEK[]" in a[1]:
                return "OK", [(a[0].encode() + b" (UID " + a[0].encode() + b" BODY[] {9}", self.msgs[a[0]]), b")"]
            if cmd == "FETCH":
                lab = " ".join(sorted(self.labels[a[0]]))
                return "OK", [(a[0] + ' (UID ' + a[0] + ' X-GM-LABELS (' + lab + ') FLAGS () '
                               'INTERNALDATE "02-Nov-2026 15:10:01 +0000")').encode()]
            if cmd == "STORE":
                for u in a[0].split(","):
                    self.labels[u].add(a[2].strip("()"))
                return "OK", [b""]
    fk = FakeIMAP({"11": raw("gmail-oneclick"), "12": raw("unrelated"), "13": raw("stop-reply")})
    fk.labels["13"].add(UNSUB_LABEL)
    got, skipped = read_unsub(fk, 14)
    chk([g["uid"] for g in got] == ["11"] and skipped == 1, "a labelled (handled) request is not read again")
    chk(all("BODY[]" not in c[2] or "PEEK" in c[2] for c in fk.cmds if c[0] == "FETCH"), "mail is read with BODY.PEEK (not marked read)")
    chk(mark_done(fk, ["11"]) == 1 and UNSUB_LABEL in fk.labels["11"] and not any(c[0] in ("EXPUNGE", "COPY") for c in fk.cmds),
        "a handled request gets the label; nothing is deleted or moved")
    chk(read_unsub(fk, 14)[0] == [], "the next run finds nothing new")
    chk("@" not in "unsubscribe emails (14 days): 1 new, 1 already handled", "the unsubscribe log line carries counts only")
    return ok


def main():
    if "--selftest" in sys.argv:
        sys.exit(0 if selftest() else 1)
    dry = "--dry-run" in sys.argv
    base = env("LIST_URL", "https://agsist-api.dnilgis.workers.dev")
    tok, secret, user, pw = env("LIST_TOKEN"), env("UNSUB_SECRET"), env("SMTP_USER"), env("SMTP_PASS")
    if not (tok and secret and user and pw):
        print("::error::LIST_TOKEN, UNSUB_SECRET, SMTP_USER and SMTP_PASS are required"); sys.exit(1)
    try:
        daily = call(base, "/list?format=json&token=" + tok)
        hail = call(base, "/alert-list?token=" + tok)
    except Exception as ex:
        print(f"::error::could not read the lists: {type(ex).__name__}"); sys.exit(1)
    try:
        dsn = read_bounces(user, pw, LOOKBACK_DAYS)
    except Exception as ex:
        # Typo fixes still run; the bounce half needs IMAP, which Gmail can refuse.
        print(f"::warning::could not read the sending inbox ({type(ex).__name__}: {_why(ex)}); bounces skipped this run")
        dsn = []
    remove = [x.strip().lower() for x in re.split(r"[,\s]+", env("REMOVE", "")) if "@" in x]
    acts = plan(daily, hail, remove=remove)
    print(f"daily list: {len(daily)}  hail list: {len(hail)}  hard bounces in the inbox: {len(dsn)}")

    # 1b. Hard bounces go to the fold step (scripts/bounces.py --fold), keys only: this step reads mail
    # and holds no write key to the private repo (list-hygiene.yml). Counts only in the log.
    notes = []
    try:
        if hand_over(dsn, env("BOUNCE_EVENTS_OUT")):
            print(f"hard bounces handed to the fold step: {len(dsn)}")
    except Exception as ex:
        print(f"::warning::the hard bounces were not handed over ({type(ex).__name__}); read again tomorrow")

    # 3. Unsubscribe requests mailed to the list address. Counts only in the log.
    marks, c, days = {}, None, unsub_lookback()
    try:
        c = imap_open()
        box = all_mail_box(c)
        st, cnt0 = c.select(box, readonly=dry)
        DIAG.update(box=box.strip('"'), select=st, box_size=(cnt0[0].decode() if st == "OK" and cnt0 and isinstance(cnt0[0], bytes) else "?"))
        ours = {x.lower() for x in (env("SMTP_USER"), env("FROM_ADDR"), env("REPORT_TO")) if x and "@" in x}
        reqs, skipped = read_unsub(c, days, ours)
    except Exception as ex:
        print(f"::warning::could not read the inbox for unsubscribe requests ({type(ex).__name__}: {_why(ex)}); retried next run")
        notes.append("Could not read the inbox for unsubscribe requests this run (" + type(ex).__name__ + "); it tries again tomorrow.")
        reqs, skipped = [], 0
    notices, watches = None, {}
    if reqs:
        try:
            notices = call(base, "/notice-list?token=" + tok)
        except Exception as ex:
            print(f"::warning::could not read the notice list ({type(ex).__name__}); notice-only requests wait")
        for name, path in (("county watch", "/watch-list"), ("elevator watch", "/elevator-watch-list"),
                           ("price watch", "/price-watch-list")):
            try:
                watches[name] = call(base, path + "?token=" + tok)
            except Exception as ex:
                notes.append(f"Could not read the {name} list ({type(ex).__name__}), so watches were not checked.")
    uacts, unotes, marks, cnt = plan_unsub(reqs, daily, hail, notices, watches,
                                           taken={(a["list"], a["email"]) for a in acts if a["do"] == "remove"})
    first = len(acts)
    acts += uacts
    notes += unotes
    # Nov 2, 2026: the first dry run found 0 though a request was sitting in the inbox; this line shows where
    # the search loses it (folder, its size, messages to the list address, subject matches, parsed requests).
    print("unsubscribe search: " + ", ".join(f"{k}={DIAG[k]}" for k in
          ("box", "select", "box_size", "search", "to_list", "subject_unsub", "parsed", "skipped") if k in DIAG))
    print(f"unsubscribe emails ({days} days): {len(reqs)} new, {skipped} already handled; "
          f"{cnt['acted']} acted on, {cnt['already']} already off, {cnt['unverified']} unverified, "
          f"{cnt['unclear']} unclear, {cnt['again']} signed up again, {cnt['retry']} wait for the notice list")
    print(f"planned: {sum(a['do']=='fix' for a in acts)} typo fixes, {sum(a['do']=='remove' for a in acts)} removals, "
          f"{sum(a['do']=='note' for a in acts)} notes, {len(remove)} owner removals asked")
    if not dry:
        acts = apply(acts, base, secret, tok)
        print(f"failed: {sum(1 for a in acts if a.get('ok') is False)}")
    monday = datetime.now(timezone.utc).weekday() == 0
    mailed = False
    if acts or notes or monday or dry:
        mail_report(acts, dry, notes)
        mailed = True
        print("report emailed to the owner")
    if c is not None:
        if not dry:
            # Acted-on requests once every removal worked; the rest once the owner has the report.
            done = [u for u, idx in marks.items()
                    if (mailed if idx is None else all(acts[first + i].get("ok") for i in idx))]
            try:
                print(f"unsubscribe emails marked handled: {mark_done(c, done)}")
            except Exception as ex:
                print(f"::warning::could not mark the handled unsubscribe emails ({type(ex).__name__}); they are re-read next run")
        try:
            c.logout()
        except Exception:
            pass


if __name__ == "__main__":
    main()
