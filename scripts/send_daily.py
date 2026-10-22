#!/usr/bin/env python3
"""
AGSIST daily briefing sender — no paid ESP required.

Reads today's briefing from data/daily-archive/YYYY-MM-DD.json (already in
the checkout when this runs in Actions) and emails a teaser to every address
on the list, linking to the homepage briefing for the full read. Keeping
the email short and the site the destination is deliberate: sponsors buy
pageviews on the site, not opens in an inbox.

All transport is env-driven, so the free Gmail path today becomes Amazon SES
tomorrow by changing three repo secrets — the script never changes:

    SMTP_HOST   default smtp.gmail.com
    SMTP_PORT   default 587 (STARTTLS)
    SMTP_USER   the account (Gmail address, or SES SMTP username)
    SMTP_PASS   Gmail APP PASSWORD (not the account password), or SES key
    FROM_ADDR   defaults to SMTP_USER; required with SES, whose username is
                not an address (log_safe.sender_addr stops the send without it)
    FROM_NAME   default "AGSIST Daily"
    REPLY_TO    optional
    RECIPIENTS  the list — comma or newline separated (fallback)
    LIST_URL    subscriptions worker base URL (e.g.
                https://agsist-subs.dnilgis.workers.dev) — when set with
                LIST_TOKEN, the list is fetched live from KV and
                RECIPIENTS is ignored
    LIST_TOKEN  auth token for the worker's /list endpoint
    UNSUB_SECRET when set with LIST_URL, every email gets a signed
                one-click unsubscribe link
    DRY_RUN     "1" = render and report, send nothing
    TEST_TO_SIG "1" = send the newest issue to SIG_TEST_EMAILS (or SIG_TO)
                only: the list is still read (counts only), no day flag is
                read or set (daily.yml input test_to_sig; daily.yml also sets
                LIST_SOURCE=backup there, so it is the backup-mode Daily)
    LIST_SOURCE "backup" forces the private copy of the list, "worker"
                forbids it (scripts/list_source.py). Unset: the worker, and
                the copy when the worker is blocked.

THE WORKER AND THE COPY ARE INTERCHANGEABLE (2026-10-22). The list, the
elevator watches and the day flag go through scripts/list_source.py. When the
worker is blocked the same records come from the private copy of its storage
(8 days old at most), the day flag is claimed in the private repo BEFORE the
first mail and checked in both places. Every link that goes through the
worker points at the agsist.com front door, in every mode; that page says when
the worker is down and offers the mailto stop (scripts/email_links.py).
    BIDS_BASE   where the elevator bids are read for the local line
                (default https://dnilgis.github.io/bids/; a local mirror
                directory works for tests)
    LOCAL_BIDS  "0" = leave the local line out for everyone (daily.yml sets
                it when the port check against the homepage fails)

YOUR LOCAL TOP BID (2026-10-06). The list is fetched as JSON (worker v5.4,
scripts/subscribers.py). A reader with a ZIP gets the homepage hero's own
answer for that ZIP at the top of the email -- "Near Chetek, WI: top corn bid
$4.35 (Badger Grain Supply, LLC, 22 mi), soybeans ..." -- from
scripts/local_bid.py, a port of the hero's rule that
scripts/daily-local-bid-checks.mjs runs against the real JS. Each ZIP is
computed once. A ZIP with no centroid, or bids that could not be read, gets
nothing local (never "no bid within 50 mi" when the truth is "could not
read"). A reader with no ZIP gets a one-line "Add your ZIP" link. An older
worker that answers only the plain list: everyone gets the email as before.
Every email carries a "Forward to a neighbor" sign-up link.

Safety rails: refuses to send if the newest archived briefing is not dated
today (weekend, holiday, or gate-blocked morning = silent skip, exit 0).
Sends individually (one To: per message — no exposed CC lists, better
deliverability), throttled, with a List-Unsubscribe header. Individual
failures are reported and tolerated; total failure exits nonzero.
"""
import json
import os
import smtplib
import ssl
import urllib.request
import urllib.parse
import sys
import time
from datetime import date
from email.message import EmailMessage
from email.utils import formataddr, make_msgid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import brief_email        # noqa: E402  (needs the path line above)
import subscribers        # noqa: E402
import gmail_limit        # noqa: E402
import log_safe           # noqa: E402  (no address in the public log)
import email_links        # noqa: E402  (k=<link id> links; never an address in one)
import list_source        # noqa: E402  (the worker, or the private copy when it is blocked)

REPO = Path(__file__).resolve().parent.parent
ARCHIVE = REPO / "data" / "daily-archive"
# The teaser lands on the HOMEPAGE briefing, not /daily. ?d=1 tells the page the
# reader came from the email and explicitly asked for the briefing, so a "hide
# until tomorrow" dismissal from earlier today must not collapse it on arrival.
# utm_* is plain GA4 attribution: email->site clicks is the one number a sponsor
# actually asks for, and it costs nothing to measure. Since 2026-10-19 every
# agsist.com link is tagged in one place, brief_email.utm (utm_source=daily,
# utm_campaign=<issue date>, utm_content=<which link>), so these stay plain.
SITE = "https://agsist.com/?d=1"
# Same URL, ampersands escaped, for use inside an href="" attribute. A bare "&"
# in an href is tolerated by most clients but is not valid HTML, and email
# sanitisers are not something to gamble a send on.
SITE_HREF = SITE.replace("&", "&amp;")
# The site reads ?ref= and tags a signup from it as source "email-forward".
FORWARD_URL = "https://agsist.com/?ref=email-forward"
# The homepage's own sign-up box (index.html id="signup-full"). If the site
# grows a #signup anchor, point this at it.
ZIP_ASK_URL = "https://agsist.com/#signup-full"
LOCAL_NOTE = ("The elevators' own posted boards, read when this email was sent. "
              "Straight-line miles. Not a contract. Call before you haul.")


def issue_url(daily):
    """The permanent page for THIS issue, not whatever the homepage shows now.

    The button used to send every reader to agsist.com, which hydrates the
    NEWEST briefing. Open Tuesday's email on Thursday and you land on
    Thursday's issue reading Tuesday's subject line -- the one link in the
    message goes somewhere other than the message. /daily/<date>.html is the
    page that issue was archived to and it never changes under the reader.

    Falls back to the homepage when the date cannot be read, because a button
    that works is worth more than one that is precise; a missing date is the
    only case and it has never happened on a real issue.
    """
    iso = None
    try:
        import grade_calls
        iso = grade_calls.iso_date(daily)
    except Exception:
        iso = None
    if not iso:
        return SITE
    return "https://agsist.com/daily/%s.html" % iso


def env(name, default=None, required=False):
    v = os.environ.get(name, default)
    if isinstance(v, str):
        v = v.strip()          # secrets pasted with trailing newlines must never break auth
    if required and not v:
        print("FATAL: missing env " + name)
        sys.exit(1)
    return v


def load_today():
    today = date.today().isoformat()
    path = ARCHIVE / (today + ".json")
    if not path.exists() and env("TEST_TO_SIG", "") == "1":
        # Sig's test copy: the newest issue there is (the morning run has not made today's yet)
        olds = sorted(p for p in ARCHIVE.glob("????-??-??.json"))
        if olds:
            path, today = olds[-1], olds[-1].stem
            print("test copy: newest issue is " + today)
    if not path.exists():
        print("no briefing dated " + today + " — nothing to send (weekend/holiday/gated). exit 0")
        sys.exit(0)
    with open(path) as f:
        return today, json.load(f)


# Address -> the reader's link id (subs worker v5.46), filled once by main()
# from the list. Every signed link carries k=<id>, never the address. A reader
# with no id gets no signed link, and main() does not mail them.
LINK_IDS = {}


def unsub_url(email):
    base, secret = (os.environ.get("LIST_URL") or "").strip() or None, (os.environ.get("UNSUB_SECRET") or "").strip() or None
    lid = LINK_IDS.get(str(email).strip().lower())
    if not (base and secret and lid):
        return None
    return email_links.signed(base, "unsubscribe", lid, secret)


def flag(day, set_it=False):
    """Day-marker via the worker; makes sending idempotent no matter how many
    times generation completes (manual + scheduled runs, re-runs). Returns
    True if already sent. No worker configured -> no dedup (old behavior)."""
    base, token = (os.environ.get("LIST_URL") or "").strip() or None, (os.environ.get("LIST_TOKEN") or "").strip() or None
    if not (base and token) and list_source.forced() != "backup":
        return False
    # 2026-10-22: the flag is kept in the worker AND the private repo
    # (scripts/list_source.py); either one set means the day went out. With the
    # worker blocked the private repo answers alone; neither readable fails closed.
    try:
        if set_it:
            return list_source.flag_set("briefed:" + day)
        return list_source.flag_is_set("briefed:" + day)
    except Exception as ex:
        # FAIL CLOSED. This used to return False ("not sent yet") when the
        # worker was unreachable, which meant a flaky network sent the entire
        # list a SECOND copy of the briefing. A missed send is recoverable by
        # rerunning; a duplicate blast to every subscriber is not. Report the
        # day as already flagged so the run stops, and say so loudly.
        print("FATAL: cannot reach the duplicate-send flag (" + type(ex).__name__
              + ": " + str(ex)[:120] + ") — refusing to send rather than risk "
              "emailing the list twice. Rerun once the worker is reachable.")
        return True


def test_recipients(subs, how):
    """TEST_TO_SIG: the SIG_TEST_EMAILS addresses (or SIG_TO) only, each with
    its own record when it is on the list (so the local lines show), else a
    bare one. Counts only in the log."""
    want = [x.strip() for x in (env("SIG_TEST_EMAILS", "") or env("SIG_TO", "") or "").split(",") if "@" in x]
    if not want:
        print("FATAL: TEST_TO_SIG needs SIG_TEST_EMAILS (or SIG_TO)")
        sys.exit(1)
    have = {str(r["email"]).strip().lower(): r for r in subs}
    out = []
    for w in want:
        r = dict(have.get(w.lower()) or {"email": w, "zip": None, "src": "", "ts": None, "reports": True})
        r["email"] = w
        lid = r.get("lid") or list_source.lid_for(w) or email_links.SAMPLE_LID
        r["lid"] = lid
        out.append(r)
    print("test copy to Sig only: %d address(es), %d of them on the list; the list itself has %d"
          % (len(out), sum(1 for w in want if w.lower() in have), len(subs)))
    return out, "json" if how == "json" else how


def fetch_subscribers():
    """[{email, zip, reports, ...}], and whether zips are known ("json") or not
    ("plain": an older worker, or the RECIPIENTS secret)."""
    base, token = (os.environ.get("LIST_URL") or "").strip() or None, (os.environ.get("LIST_TOKEN") or "").strip() or None
    if base and token:
        recs, how = subscribers.fetch(base, token)
        print("recipient list fetched live from worker (" + how + ")")
        return recs, how
    return subscribers.parse_plain(env("RECIPIENTS", required=True)), "plain"


# Address -> the local block brief_email renders at the top (or the "add your
# ZIP" line). Filled once by main(), read by build_email(), so the send loop
# below (lifted by its own text in test_send_loops.py) is not touched.
LOCAL_LINES = {}


def load_local_lines(subs, how, bids_data=None):
    """Group by ZIP, compute each ZIP once, and return (address -> block, counts)."""
    import local_bid
    counts = {"local": 0, "none_within": 0, "ask_zip": 0, "plain": 0, "no_centroid": 0, "unreadable": 0}
    out = {}
    if how != "json":
        counts["plain"] = len(subs)
        return out, counts
    if (os.environ.get("LOCAL_BIDS") or "").strip() == "0":
        print("local bid line OFF for this send (LOCAL_BIDS=0: the port check against the homepage did not pass)")
        counts["plain"] = len(subs)
        return out, counts
    data = bids_data or local_bid.BidsData()
    by_zip = {}
    for r in subs:
        by_zip.setdefault(r.get("zip") or "", []).append(r["email"].strip().lower())
    for z, emails in by_zip.items():
        if not z:
            for em in emails:
                out[em] = {"ask_url": ZIP_ASK_URL}
            counts["ask_zip"] += len(emails)
            continue
        try:
            top = local_bid.top_for_zip(data, z)
        except Exception as ex:
            print("local bid for ZIP %s failed (%s); those readers get no local line" % (z, type(ex).__name__))
            top = {"status": "failed"}
        lines = local_bid.email_lines(top)
        if not lines:
            counts["no_centroid" if top.get("status") == "nozip" else "unreadable"] += len(emails)
            continue
        block = {"head": lines["head"], "detail": lines["detail"], "note": LOCAL_NOTE if lines["status"] == "ok" else ""}
        for em in emails:
            out[em] = block
        counts["local" if lines["status"] == "ok" else "none_within"] += len(emails)
    print("local bid: %d zip(s) computed once each; %s" % (len([z for z in by_zip if z]),
          ", ".join("%s %d" % (k, v) for k, v in counts.items() if v)))
    return out, counts


# WAVE2-G: "Your elevators" -- address -> lines, filled once by main() from
# the elevator-watch list and the posted boards (send_elevator_watch.py).
# 2026-10-20: address -> block (scripts/daily_elevators.py): the reader's
# saved and watched elevators and at most two near-you lines. A
# module-level map, so the send loop below (which test_send_loops.py lifts by
# its own text) is not touched. Any failure leaves it empty: the briefing
# goes out exactly as before, without the block.
ELEVATOR_LINES = {}


def elevator_add_url(email):
    """The reader's signed link to put their saved elevators in this email
    (subs worker v5.42 /daily-elev): t = HMAC of the address + "|de", the way
    the unsubscribe link is signed. None without LIST_URL and UNSUB_SECRET.
    v5.46: ?k=<the reader's link id>, t = HMAC of the id + "|de"; no id, no link."""
    base, secret = (os.environ.get("LIST_URL") or "").strip(), (os.environ.get("UNSUB_SECRET") or "").strip()
    lid = LINK_IDS.get(str(email).strip().lower())
    if not (base and secret and lid):
        return None
    try:
        return email_links.signed(base, "daily-elev", lid, secret, "|de")
    except email_links.Withheld:
        return None      # (nothing raises it since the front door, Oct 22: the agsist.com page says when the worker is down)


def load_elevator_lines(subs=None, how="plain", bids_data=None):
    """Address -> the reader's elevator block (scripts/daily_elevators.py):
    their saved and watched elevators, and at most two near-you lines. With
    an older list (addresses only) the v5.x watch lines, as before. Anything
    failing leaves the block out; the briefing still goes. Counts only."""
    base, token = (os.environ.get("LIST_URL") or "").strip(), (os.environ.get("LIST_TOKEN") or "").strip()
    watchers, sew = [], None
    if base and token:
        try:
            import send_elevator_watch as sew
            watchers = sew.worker(base.rstrip("/"), "elevator-watch-list", token)
        except Exception as ex:
            print("elevator watches not read (" + type(ex).__name__ + "); saved elevators only")
            watchers = []
    out = {}
    if how == "json" and subs:
        try:
            import daily_elevators as de
            import local_bid
            if sew is None:
                import send_elevator_watch as sew
            boards = de.Boards(bids_data or local_bid.BidsData())
            out, c = de.blocks(boards, subs, watchers, sew.load_basis_index())
            print("your-elevators block: %d reader(s) with their own elevators, %d with a near-you line, "
                  "%d with both, %d with a ZIP and no near-you line (rules: basis move %d c, pays %d c more, "
                  "%d mi)" % (c["with_own"], c["with_near"], c["with_both"], c["with_zip_no_near"],
                              de.BASIS_MOVE_C, de.PAYS_MORE_C, de.RADIUS_MI))
        except Exception as ex:
            print("your-elevators block skipped (" + type(ex).__name__ + ")")
            out = {}
    elif watchers and sew is not None:
        try:
            now_ms = time.time() * 1000
            out = sew.daily_lines(watchers, sew.load_net_index(sew.fetch_net_index(), now_ms), sew.load_basis_index())
            print("your-elevators block for " + str(len(out)) + " address(es)")
        except Exception as ex:
            print("your-elevators block skipped (" + type(ex).__name__ + ")")
            out = {}
    # Every reader on the list gets the signed footer link to add saved elevators.
    if subs and (os.environ.get("LIST_URL") or "").strip() and (os.environ.get("UNSUB_SECRET") or "").strip():
        for r in subs:
            em = str(r["email"]).strip().lower()
            if not elevator_add_url(em):
                continue
            b = out.get(em)
            if isinstance(b, dict):
                b["add_url"] = elevator_add_url(em)
            elif not b:
                out[em] = {"mine": [], "near": [], "add_url": elevator_add_url(em)}
    return out


# Address -> {"zip", "town"} for the reader's own Rain Print line
# (brief_email.rain_print_offer). Filled once by main(), like LOCAL_LINES.
# A reader missing here gets the shipped generic line. Never printed.
RAIN_LINES = {}


def load_rain_lines(subs, how, bids_data=None):
    """Address -> {"zip", "town"} for every reader with a five-digit ZIP.
    The town comes from the same ZIP table the local bid line names
    ("Chetek, WI"); with no row there the line still links the ZIP, it just
    does not name the town. Independent of LOCAL_BIDS: no bid is read."""
    import re
    out = {}
    if how != "json":
        return out
    data = None
    towns = {}
    for r in subs:
        z = str(r.get("zip") or "").strip()[:5]
        if not re.match(r"^\d{5}$", z):
            continue
        if z not in towns:
            try:
                if data is None:
                    import local_bid
                    data = bids_data or local_bid.BidsData()
                towns[z] = data.zip_town(z)
            except Exception:
                towns[z] = None
        out[str(r["email"]).strip().lower()] = {"zip": z, "town": towns[z]}
    print("rain print line: %d reader(s) get their own town's, %d distinct ZIP(s), %d named"
          % (len(out), len(towns), sum(1 for t in towns.values() if t)))
    return out


# ── the Daily, v2 (Sig, Oct 22 2026: live from the Oct 22 morning send) ─────
# DAILY_FORMAT=v2 builds the email with scripts/daily_v2.py; anything else
# (DAILY_FORMAT=current, or unset) builds the old format with brief_email. That
# is the rollback: daily.yml's format input, or the repo variable DAILY_FORMAT
# for the scheduled run.
V2 = {"pod": None, "fact": None, "ready": False}


def daily_format():
    return "v2" if (os.environ.get("DAILY_FORMAT") or "").strip().lower() == "v2" else "current"


def v2_setup(b):
    """The day's print (PRINT_OF_DAY: scripts/print_of_day.py's pick with an
    image_url once the PNG is live on agsist.com) and the day's fact, once.
    Any failure leaves that slot out; the email still goes."""
    if V2["ready"]:
        return
    V2["ready"] = True
    p = (os.environ.get("PRINT_OF_DAY") or "").strip()
    if p:
        try:
            with open(p, encoding="utf-8") as fh:
                pod = json.load(fh)
            if isinstance(pod, dict) and pod.get("image_url") and str(pod["image_url"]).startswith("https://agsist.com/"):
                V2["pod"] = pod
            else:
                print("print of the day: no live picture; the slot is left out")
        except Exception as ex:
            print("print of the day skipped (" + type(ex).__name__ + ")")
    else:
        print("print of the day: none for this send; the slot is left out")
    try:
        import daily_fact
        V2["fact"] = daily_fact.for_day(date.today())
    except Exception as ex:
        print("daily fact skipped (" + type(ex).__name__ + ")")


def v2_parts(b, to_addr, uurl, mine, loc, rain):
    import daily_v2
    v2_setup(b)
    return daily_v2.build(b, issue_url(b), unsub_url=uurl, elevators=mine, local=loc, forward_url=FORWARD_URL,
                          rain=rain, pod=V2["pod"], fact=V2["fact"], today=date.today())


def v2_hold_alert(day, built, bad):
    """One email to Sig (OWNER_TO, the SIG_TO secret in daily.yml) the moment
    the number check holds a live issue: what failed and how to fix and rerun.
    The day is not flagged, so a rerun sends. Returns True if it went out."""
    fields = sorted({f["field"] for f in bad})
    lines = ["The AGSIST Daily for %s did not go to the list: the number check found a wrong number in the %s."
             % (day, " and ".join(fields)), ""]
    for f in bad:
        lines += ["%s: \"%s\"" % (f["field"], str(f.get("quote") or "")[:300]), "  " + f["why"], ""]
    lines += ["Subject it would have had: " + str(built.get("subject")), "",
              "Nothing was sent and the day is not marked sent. To fix and rerun:",
              "1. GitHub, dnilgis/agsist, Actions, Generate Daily Briefing, Run workflow on main: tick send_email, "
              "format v2. It writes today's issue again and checks it again; if it passes it goes to the list.",
              "2. To send today's issue as it is, in the old format (which does not run this check): the same, "
              "with format current.",
              "3. To skip today: do nothing. Tomorrow's run is not affected."]
    return log_safe.owner_mail("AGSIST Daily %s held: wrong number in the %s" % (day, " and ".join(fields)), lines)


def v2_gate(day, b, alert=False):
    """The number check that blocks the v2 send (daily_v2.check): a wrong number
    in the subject, headline or lead. True = clear to send. alert=True (a live
    send) mails Sig at once when it holds the issue."""
    import daily_v2
    built = v2_parts(b, "reader@example.com", None, None, None, None)
    bad, notes = daily_v2.check(b, built)
    for n in notes:
        print("v2 number check: " + n)
    if bad:
        print("::error title=Daily held, wrong number::the %s Daily did not go to the list: %s"
              % (day, "; ".join("%s says \"%s\" (%s)" % (f["field"], str(f.get("quote"))[:120], f["why"]) for f in bad))[:900])
        if alert:
            print("alert to Sig: " + ("sent" if v2_hold_alert(day, built, bad) else "NOT sent (see above)"))
        for f in bad:
            print("::error title=Daily number check::%s: \"%s\" %s" % (f["field"], str(f.get("quote"))[:200], f["why"]))
        print("v2 number check: %d wrong number(s) in the subject, headline or lead; the Daily does not send" % len(bad))
        return False
    print("v2 number check: passed (subject: %s)" % built["subject"])
    return True


def build_email(day, b, to_addr, from_name, from_addr, reply_to):
    """One issue, two bodies, one message.

    Until 2026-08-27 this built a 130-word teaser by hand: headline, lead,
    takeaway, one number, button. That is an advertisement for a website, not a
    briefing, and Sig said so plainly. The body now comes from brief_email,
    which renders the SAME issue as a full HTML letter and as a real plain-text
    alternative. This function is reduced to what it should always have been:
    addressing, unsubscribe headers, and transport.

    Nothing in here reads live prices. Every number in the letter is the
    issue's own locked board measured against the previous session's locked
    board — see brief_email's module docstring for why that rule exists.
    """
    date_display = b.get("date_display") or b.get("date") or day
    uurl = unsub_url(to_addr)

    v2 = None
    if daily_format() == "v2":
        k = str(to_addr).strip().lower()
        v2 = v2_parts(b, to_addr, uurl, ELEVATOR_LINES.get(k) or None, LOCAL_LINES.get(k) or None, RAIN_LINES.get(k) or None)
        subject = v2["subject"]
    else:
        prior, _prior_day = brief_email.prior_board(b)
        subject = brief_email.subject_line(b, prior)
    if env("TEST_TO_SIG", "") == "1":
        subject = "[test copy] " + subject

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = formataddr((from_name, from_addr))
    msg["To"] = to_addr
    msg["Message-ID"] = make_msgid(domain=from_addr.split("@", 1)[1])
    if reply_to:
        msg["Reply-To"] = reply_to
    unsub = reply_to or from_addr
    if uurl:
        msg["List-Unsubscribe"] = "<" + uurl + ">, <mailto:" + unsub + "?subject=unsubscribe>"
        msg["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"
    else:
        msg["List-Unsubscribe"] = "<mailto:" + unsub + "?subject=unsubscribe>"

    mine = ELEVATOR_LINES.get(str(to_addr).strip().lower()) or None
    loc = LOCAL_LINES.get(str(to_addr).strip().lower()) or None
    rain = RAIN_LINES.get(str(to_addr).strip().lower()) or None
    if v2:
        text, hbody = v2["text"], v2["html"]
    else:
        text = brief_email.render_text(b, issue_url(b), unsub_url=uurl, date_display=date_display, elevators=mine,
                                       local=loc, forward_url=FORWARD_URL, rain=rain)
        _issue = issue_url(b)
        hbody = brief_email.render_html(b, _issue.replace("&", "&amp;"),
                                        unsub_url=uurl, date_display=date_display, elevators=mine,
                                        local=loc, forward_url=FORWARD_URL, rain=rain)

    # set_content first, add_alternative second: that ordering is what makes it
    # multipart/alternative with the HTML preferred and the text a real
    # fallback, not an attachment.
    msg.set_content(text)
    msg.add_alternative(hbody, subtype="html")
    # v5.46: refuses (raises) if any link carries an address; the send loop counts it failed
    return email_links.check_message(msg)


def main():
    day, b = load_today()
    from_addr = log_safe.sender_addr() or env("SMTP_USER", required=True)
    from_name = env("FROM_NAME", "AGSIST Daily")
    reply_to = env("REPLY_TO")
    dry = env("DRY_RUN", "") == "1"
    test = env("TEST_TO_SIG", "") == "1"

    if not dry and not test and flag(day):
        print("already sent for " + day + " (day-flag set) — skipping. exit 0")
        return 0
    if daily_format() == "v2":
        print("format: v2 (scripts/daily_v2.py)")
        if not v2_gate(day, b, alert=not (dry or test)):
            if not dry:
                return 1
            print("dry run: the preview below is what WOULD have been blocked")
    subs, how = fetch_subscribers()
    if test:
        subs, how = test_recipients(subs, how)
    if how == "json":
        # v5.46: only readers the worker gave a link id; their links carry k=, never the address
        LINK_IDS.clear()
        LINK_IDS.update(email_links.link_ids(subs))
        no_id = sum(1 for r in subs if str(r["email"]).strip().lower() not in LINK_IDS)
        if subs and no_id == len(subs):
            print("::error::the subs worker gave no link ids (older than v5.46, or UNSUB_SECRET unset); "
                  "nothing sent, the day is not flagged")
            return 1
        if no_id:
            print("::warning::%d reader(s) had no link id this run and are not mailed" % no_id)
            subs = [r for r in subs if str(r["email"]).strip().lower() in LINK_IDS]
    recipients = [r["email"] for r in subs]
    if not recipients:
        print("FATAL: RECIPIENTS parsed to zero addresses")
        return 1
    print("briefing " + day + " · recipients " + str(len(recipients)) + " · dry_run " + str(dry))
    ELEVATOR_LINES.update(load_elevator_lines(subs, how))
    try:
        _ll, _counts = load_local_lines(subs, how)
    except Exception as ex:
        # The local line is an extra. Anything wrong with it sends the
        # briefing exactly as it went before, never no briefing.
        print("local bid line skipped (" + type(ex).__name__ + ": " + str(ex)[:120] + ")")
        _ll, _counts = {}, {"plain": len(subs)}
    LOCAL_LINES.update(_ll)
    try:
        RAIN_LINES.update(load_rain_lines(subs, how))
    except Exception as ex:
        # An extra, like the local line: anything wrong sends the generic line.
        print("own rain print line skipped (" + type(ex).__name__ + ")")
    gmail_limit.check(len(recipients), sum(1 for r in subs if r.get("reports") is not False),
                      date.fromisoformat(day), dry=dry)

    if dry:
        print("preview per recipient: %d with a local top bid, %d told nothing posted within 50 mi, "
              "%d asked to add a ZIP, %d unchanged (%d older list without zips, %d ZIP with no centroid, "
              "%d bids unreadable)" % (_counts.get("local", 0), _counts.get("none_within", 0),
                                       _counts.get("ask_zip", 0),
                                       _counts.get("plain", 0) + _counts.get("no_centroid", 0) + _counts.get("unreadable", 0),
                                       _counts.get("plain", 0), _counts.get("no_centroid", 0), _counts.get("unreadable", 0)))
        # COUNTS ONLY. Manual runs of daily.yml are dry runs and the Actions
        # log is public, so no reader's address or ZIP is printed here. The
        # sample below is built for a made-up address.
        print("preview: %d distinct ZIP(s) on the list, %d reader(s) with none"
              % (len({r.get("zip") for r in subs if r.get("zip")}), sum(1 for r in subs if not r.get("zip"))))
        LINK_IDS["reader@example.com"] = email_links.SAMPLE_LID
        m = build_email(day, b, "reader@example.com", from_name, from_addr, reply_to)
        _prior, _pday = brief_email.prior_board(b)
        print("SUBJECT: " + str(m["Subject"]))
        print("board: this issue's locked close, against " + str(_pday or "(no prior board found)"))
        htm = m.get_body(("html",))
        txt = m.get_body(("plain",))
        print("parts: html " + str(len(htm.get_content())) + " bytes, text "
              + str(len(txt.get_content().split())) + " words")
        print("-" * 60)
        print(txt.get_content()[:1200])
        if os.environ.get("DUMP_HTML"):
            with open(os.environ["DUMP_HTML"], "w", encoding="utf-8") as fh:
                fh.write(htm.get_content())
            print("html written to " + os.environ["DUMP_HTML"])
        print("dry run complete — nothing sent")
        return 0

    host = env("SMTP_HOST") or "smtp.gmail.com"   # an unset secret arrives as ""
    port = int(env("SMTP_PORT") or "587")
    user = env("SMTP_USER", required=True)
    pw = env("SMTP_PASS", required=True)
    if test:
        # Sig's copy: no day flag read or set, so the morning run still goes to everyone
        globals()["flag"] = lambda *a, **k: False
    elif not list_source.claim("briefed:" + day):
        # backup mode: the day flag goes into the private repo before the first mail
        return 1

    sent, failed = 0, []
    ctx = ssl.create_default_context()

    def connect():
        """A fresh, logged-in connection. Called again if one dies mid-list."""
        c = smtplib.SMTP(host, port, timeout=30)
        c.starttls(context=ctx)
        c.login(user, pw)
        return c

    # ONE CONNECTION SERVED THE WHOLE LIST, AND THAT WAS THE QUIET HALF.
    #
    # The wide `except Exception` below was added after issue #177 went out
    # seven times: a socket timeout, an SSLError or a reset connection is not
    # an SMTPException, so it aborted the loop with the day flag never set and
    # the rerun re-sent to everyone who already had it.
    #
    # But catching it per recipient is not enough on its own. A dead socket
    # fails EVERY remaining send, so a drop at recipient N meant everyone after
    # N silently got nothing while `sent > 0` still flagged the day delivered
    # and a rerun refused. One reconnect per fatal failure, three at most, so a
    # bad socket costs one email rather than the tail of the list.
    conn = connect()
    reconnects, MAX_RECONNECTS = 0, 3
    try:
        for i, r in enumerate(recipients):
            try:
                conn.send_message(build_email(day, b, r, from_name, from_addr, reply_to))
                sent += 1
            except Exception as ex:
                failed.append(r + " (" + type(ex).__name__ + ")")
                # smtplib.SMTPException INHERITS FROM OSError in Python 3, so a
                # bare isinstance(ex, OSError) is true for every SMTP error
                # there is — including one refused address, which would then
                # open a whole new connection. A raw OSError that is NOT an
                # SMTPException is the one that means the pipe is dead.
                fatal = (isinstance(ex, (smtplib.SMTPServerDisconnected,
                                         smtplib.SMTPConnectError))
                         or (isinstance(ex, OSError)
                             and not isinstance(ex, smtplib.SMTPException)))
                if fatal and reconnects < MAX_RECONNECTS and i < len(recipients) - 1:
                    reconnects += 1
                    print("  connection lost after %d sent; reconnecting (%d/%d)"
                          % (sent, reconnects, MAX_RECONNECTS))
                    try:
                        conn.quit()
                    except Exception:
                        pass
                    try:
                        conn = connect()
                    except Exception as ex2:
                        print("::error::could not reconnect (%s) — %d of %d briefings sent"
                              % (type(ex2).__name__, sent, len(recipients)))
                        break
            if i < len(recipients) - 1:
                time.sleep(1.2)  # gentle throttle keeps Gmail happy
    finally:
        try:
            conn.quit()
        except Exception:
            pass
    print("sent " + str(sent) + "/" + str(len(recipients)))
    # Set the day flag whenever ANY mail went out. Anyone who received a copy
    # must never get a second one, so the flag is about the day, not about
    # success. Failures are reported for a targeted resend, not a full rerun.
    if sent > 0:
        flag(day, set_it=True)
    if failed:
        # Full addresses go to Sig by private mail; the public annotation gets
        # the count and masked addresses only.
        mailed = log_safe.owner_mail("AGSIST Daily %s: %d of %d did not send" % (day, len(failed), len(recipients)),
                                     ["Resend to these addresses individually (the day is flagged):", ""] + failed)
        print("::error::failed (" + str(len(failed)) + " of " + str(len(recipients))
              + ") — the day is flagged, so a plain rerun will NOT resend to "
              "anyone. Resend to these addresses individually ("
              + ("full list mailed to Sig" if mailed else "full list NOT mailed")
              + "): " + ", ".join(log_safe.mask_text(f) for f in failed))
    return 0 if sent > 0 else 1


if __name__ == "__main__":
    sys.exit(list_source.guard(main, soft=False))
