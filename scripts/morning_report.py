#!/usr/bin/env python3
"""
Sig's morning report (2026-10-14): ONE email at about 6:40 am Central he can
skim over coffee. Run by .github/workflows/morning-report.yml.

  Today              first, before anything else (2026-10-20, Sig): the bid
                     sites a person has to deal with by hand (a bot check or a
                     refusal, no good read for 6 h), biggest town count first,
                     each with its last good read and a Paste link when the
                     elevator desk has a paste reader for it; the boards with a
                     current price and the change since yesterday; and the other
                     items by name (listing requests by elevator and town,
                     sponsor applications by company). Links to
                     agsist.com/elev-today.html. Same sums as
                     components/today-core.js; the selftest reads the real
                     bids index of Oct 20 (test/fixtures).
  Needs you          anything red, first: a job still failing, a late
                     critical job, a stale feed, a stuck Pages deploy, the
                     site size warning, a request waiting on him.
  Site health        agsist: failed runs in the last 24 h (GitHub API,
                     collapsed by workflow), private/data/cron-health.json (private repo), the last
                     Pages deploy, the published size, prices / bids /
                     briefing freshness. bids (dnilgis/bids): failed runs and
                     its reader summary (data/index.json on its Pages site).
  Signups            list counts from the subs worker's /count, change vs
                     yesterday and vs 7 days ago (from the counts this job
                     kept on earlier mornings), joins from /list ts.
                     data/audience.json email.subscribers as the fallback.
  Orders, requests   last 24 h and month to date by kind (/form-list,
                     /notice-list?topic=rain-gauge, /sponsor-apps). Stripe
                     only with a STRIPE_READ_KEY secret (restricted, read-only),
                     and then each paid Rain Print of the last 48 h: product,
                     amount, the design reference (client_reference_id) and the
                     maker link agsist.com/rain-print?d=<ref>&maker=1. Never
                     the buyer's email, name or address.
  Traffic            data/audience.json: the latest day it has, the last 7
                     days, the top 3 pages, the 14-day return share of the
                     newest whole weekly cohort (with its n, or why it is
                     withheld) and the Rain Print funnel for 7 days, read
                     from GA4 here (GA4_PROPERTY_ID, GA4_SERVICE_ACCOUNT) and
                     never written to a file; left out of a dry run.
  To-dos             the unchecked lines of TODO-SIG.md.

COUNTS ONLY. No subscriber or customer address, name or message ever goes into
the log or the email body: rows from the worker are only counted, every line
is scrubbed for anything shaped like an address before it is used, and the
selftest fails if a fixture address reaches either. The From and To headers
are the only addresses in the email.

Every section fails soft: a source that cannot be read becomes one line that
says so, and the rest still sends. The run exits 1 only when the email itself
cannot be sent.

    python3 scripts/morning_report.py              build and send
    DRY_RUN=1 python3 scripts/morning_report.py    print the email (counts only), send nothing
    python3 scripts/morning_report.py --gate       go=1 only when the latest tick is 6:40 am Central
    python3 scripts/morning_report.py --selftest   fixtures for every section, no network, no mail

Env: GITHUB_TOKEN (actions: read, pages: read), GITHUB_REPOSITORY, LIST_URL,
LIST_TOKEN, SMTP_USER, SMTP_PASS. Optional: BIDS_READ_TOKEN, STRIPE_READ_KEY,
SMTP_HOST, SMTP_PORT, FROM_ADDR, FROM_NAME, REPORT_TO (else FORMS_TO, else
SPONSOR_TO, else sig@farmers1st.com), SNAPSHOT (the counts file the workflow
keeps in the Actions cache between mornings; counts only).
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
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from email.utils import formataddr, make_msgid
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import form_digest as FD  # noqa: E402

UTC = timezone.utc
CT = ZoneInfo("America/Chicago")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ADDRESS = "AGSIST, PO Box 243, Chetek, WI 54728"
REPO = "dnilgis/agsist"
BIDS_REPO = "dnilgis/bids"
BIDS_INDEX = "https://dnilgis.github.io/bids/data/index.json"
TODAY_URL = "https://agsist.com/elev-today.html"
PASTE_STATUS = "https://agsist-subs.dnilgis.workers.dev/elev/paste-status"
# Sites the elevator desk has a paste reader for (components/paste-bids.js SITES).
PASTE_READERS = {"newcoop.com": ("newcoop", "NEW Cooperative", "https://www.newcoop.com/cash-bids")}
# dnilgis/bids lib/freshness.mjs: WITHDRAW_H, PASTED_WITHDRAW_H, LATE_H.
LIVE_H, PASTED_H, STALE_H = 14, 168, 6
STATE_NAMES = {"IA": "Iowa", "IL": "Illinois", "IN": "Indiana", "KS": "Kansas", "MN": "Minnesota", "MO": "Missouri",
               "NE": "Nebraska", "ND": "North Dakota", "SD": "South Dakota", "WI": "Wisconsin", "OH": "Ohio",
               "MI": "Michigan", "KY": "Kentucky", "TN": "Tennessee", "OK": "Oklahoma", "TX": "Texas", "CO": "Colorado",
               "MT": "Montana", "AR": "Arkansas", "GA": "Georgia", "AL": "Alabama", "MS": "Mississippi",
               "LA": "Louisiana", "PA": "Pennsylvania", "NY": "New York", "ID": "Idaho", "WA": "Washington",
               "OR": "Oregon", "WY": "Wyoming", "ON": "Ontario", "MB": "Manitoba", "SK": "Saskatchewan", "AB": "Alberta"}
PRIVATE_KEY_WARN_DAYS = 14     # same as cron_health.KEY_WARN_DAYS: say it two weeks out
TODO_EDIT = "https://github.com/dnilgis/agsist/edit/main/TODO-SIG.md"
# The two clocks the workflow lists: 11:40 UTC is 6:40 am CDT, 12:40 UTC is 6:40 am CST.
CRONS = ("40 11 * * *", "40 12 * * *")
# Orders and requests: the digest's kinds plus sponsor applications (/sponsor-apps).
ORDER_KINDS = FD.TALLY + (("sponsor-apply", "sponsor application", "sponsor applications"),)
# Kinds that wait on Sig when one comes in (a reply, a call, a yes or no).
WAITING = ("rain-print-order", "gift-card", "rain-print-business", "elevator-listing", "prf-sponsor", "claim",
           "sponsor-feedback")
# Lists on the worker's /count, in the order they print.
LISTS = (("daily", "Daily briefing"), ("alerts", "Hail alerts"), ("ewatch", "Elevator watch and bid alerts"),
         ("pwatch", "Price targets"), ("watch", "County watch"), ("rain-gauge", "Rain gauge waitlist"))
EMAIL_RE = re.compile(r"[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+")
MAX_ERR = 160
SNAP_DAYS = 15



def clean_txt(v, cap=80):
    """One line of plain text from a form field: whitespace folded, cut to cap, no address-like strings."""
    t = " ".join(str(v or "").split())[:cap]
    return "" if "@" in t else t

def scrub(s):
    """No address-shaped text gets into the report, whatever a source returned."""
    return EMAIL_RE.sub("[address]", str(s)).replace("@", " at ")


def env(name, default=None):
    v = os.environ.get(name)
    return v if v not in (None, "") else default


def ct(d):
    return d.astimezone(CT)


def clock(d):
    """'5:12 am' (today) or 'Oct 12, 5:12 am' (another day), Central."""
    return d.strftime("%-I:%M ") + ("am" if d.hour < 12 else "pm")


def when(d, now):
    d, n = ct(d), ct(now)
    return clock(d) if d.date() == n.date() else "%s %d, %s" % (d.strftime("%b"), d.day, clock(d))


def ago(d, now):
    m = int((now - d).total_seconds() // 60)
    if m < 0:
        return "ahead of the clock"
    if m < 90:
        return "%d min ago" % m
    if m < 48 * 60:
        return "%d h ago" % round(m / 60)
    return "%d days ago" % round(m / 1440)


def parse_time(s):
    if isinstance(s, (int, float)) and not isinstance(s, bool):
        return datetime.fromtimestamp(s / 1000, UTC)
    s = str(s or "").strip()
    if not s:
        return None
    try:
        d = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None
    return d if d.tzinfo else d.replace(tzinfo=UTC)


def num(n):
    return "{:,}".format(n) if isinstance(n, int) else str(n)


def plural(n, one, many):
    return "%s %s" % (num(n), one if n == 1 else many)


def why(e):
    code = getattr(e, "code", None)
    return "HTTP %s" % code if isinstance(code, int) else type(e).__name__


class Report:
    def __init__(self):
        self.today = None        # {health, paste: [..], also: [..]}, shown before everything
        self.needs = []          # red lines, shown first
        self.sections = []       # (title, [lines])

    def add(self, title, lines):
        self.sections.append((title, [scrub(x) for x in lines if x]))

    def red(self, line):
        self.needs.append(scrub(line))


# ───────────────────────────── sources ─────────────────────────────

class Sources:
    """Every outside read goes through here, so the selftest can hand in fixtures."""

    def __init__(self, gh_token="", bids_token="", list_url="", list_token="", stripe_key="", root=ROOT,
                 ga4_prop="", ga4_cred="", dry=False, private_token=""):
        self.private_token = (private_token or "").strip()
        self.ga4_prop, self.ga4_cred, self.dry = (ga4_prop or "").strip(), (ga4_cred or "").strip(), dry
        self.gh_token, self.bids_token = gh_token, bids_token
        u = urllib.parse.urlsplit((list_url or "").strip())
        self.list_base = "%s://%s" % (u.scheme, u.netloc) if u.scheme and u.netloc else ""
        self.list_token, self.stripe_key, self.root = (list_token or "").strip(), stripe_key, root

    def _get(self, url, headers):
        req = urllib.request.Request(url, headers=dict({"User-Agent": "agsist-morning-report"}, **headers))
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode())

    def gh(self, path, repo_token=None):
        tok = self.gh_token if repo_token is None else repo_token
        h = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
        if tok:
            h["Authorization"] = "Bearer %s" % tok
        return self._get("https://api.github.com" + path, h)

    def worker(self, path, **q):
        if not (self.list_base and self.list_token):
            raise LookupError("no LIST_URL / LIST_TOKEN")
        url = "%s/%s%s" % (self.list_base, path, ("?" + urllib.parse.urlencode(q)) if q else "")
        return self._get(url, {"Authorization": "Bearer %s" % self.list_token})

    def url_json(self, url):
        return self._get(url, {})

    def stripe(self, path, params):
        if not self.stripe_key:
            return None
        return self._get("https://api.stripe.com/v1/%s?%s" % (path, urllib.parse.urlencode(params)),
                         {"Authorization": "Bearer %s" % self.stripe_key})

    def file(self, rel):
        with open(os.path.join(self.root, rel), encoding="utf-8") as f:
            return f.read()

    def private_key(self, now):
        """Does PRIVATE_REPO_TOKEN still work, and when does it expire (cron_health.private_key_check)."""
        import cron_health
        return cron_health.private_key_check(now, self.private_token)

    def rain_print_funnel(self, towns, now):
        """The Rain Print funnel straight from GA4, in this job only: it is
        never written to a file (data/audience.json is public). Same US and
        server-town filter as audience.json, the towns read from it."""
        if not (self.ga4_prop and self.ga4_cred):
            raise LookupError("GA4 not set up for this job")
        import build_audience as BA
        from google.analytics.data_v1beta import BetaAnalyticsDataClient
        from google.oauth2 import service_account
        c = service_account.Credentials.from_service_account_info(
            json.loads(self.ga4_cred), scopes=["https://www.googleapis.com/auth/analytics.readonly"])
        return BA.funnel_section(BA.GA4(self.ga4_prop, BetaAnalyticsDataClient(credentials=c)),
                                 BA.f_readers(towns), BA.ranges(now.date()))

    def promo_counts(self, towns, now):
        """Promo clicks by page, gauge signups and email sessions by source,
        build_audience.promo_section(), live from GA4 in this job only."""
        if not (self.ga4_prop and self.ga4_cred):
            raise LookupError("GA4 not set up for this job")
        import build_audience as BA
        from google.analytics.data_v1beta import BetaAnalyticsDataClient
        from google.oauth2 import service_account
        c = service_account.Credentials.from_service_account_info(
            json.loads(self.ga4_cred), scopes=["https://www.googleapis.com/auth/analytics.readonly"])
        return BA.promo_section(BA.GA4(self.ga4_prop, BetaAnalyticsDataClient(credentials=c)),
                                BA.f_readers(towns), BA.ranges(now.date()))


# ───────────────────────────── sections ─────────────────────────────

def failed_runs(src, repo, now, token=None, detail=8):
    """[(name, count, last_dt, still_failing, error_line)] for runs that failed in
    the last 24 h, most failures first. Raises when the run list cannot be read."""
    since = (now - timedelta(hours=24)).strftime("%Y-%m-%dT%H:%M:%SZ")
    runs = []
    for page in range(1, 6):
        d = src.gh("/repos/%s/actions/runs?status=failure&per_page=100&page=%d&created=%s"
                   % (repo, page, urllib.parse.quote(">=" + since)), token)
        got = d.get("workflow_runs") or [] if isinstance(d, dict) else []
        runs.extend(r for r in got if isinstance(r, dict))
        if len(got) < 100:
            break
    groups = {}
    for r in runs:
        g = groups.setdefault(r.get("name") or r.get("path") or "?", {"n": 0, "last": None, "wid": r.get("workflow_id")})
        g["n"] += 1
        t = parse_time(r.get("created_at"))
        if t and (g["last"] is None or t > g["last"][0]):
            g["last"], g["wid"] = (t, r.get("id")), r.get("workflow_id")
    out = []
    for i, (name, g) in enumerate(sorted(groups.items(), key=lambda kv: (-kv[1]["n"], kv[0]))):
        still, err = None, ""
        if i < detail:
            try:
                d = src.gh("/repos/%s/actions/workflows/%s/runs?status=completed&per_page=1" % (repo, g["wid"]), token)
                latest = (d.get("workflow_runs") or [{}])[0]
                still = latest.get("conclusion") == "failure"
            except Exception:                              # noqa: BLE001
                still = None
            if g["last"]:
                err = error_line(src, repo, g["last"][1], token)
        out.append((name, g["n"], g["last"][0] if g["last"] else None, still, err))
    return out


def error_line(src, repo, run_id, token=None):
    """The first real error message of a failed run, or the failed step's name. '' if it cannot be had."""
    try:
        jobs = src.gh("/repos/%s/actions/runs/%s/jobs?filter=latest" % (repo, run_id), token).get("jobs") or []
        job = next((j for j in jobs if j.get("conclusion") == "failure"), None)
        if not job:
            return ""
        step = next((s.get("name") for s in job.get("steps") or [] if s.get("conclusion") == "failure"), "")
        msg = ""
        try:
            for a in src.gh("/repos/%s/check-runs/%s/annotations" % (repo, job.get("id")), token) or []:
                m = " ".join(str(a.get("message") or "").split())
                if a.get("annotation_level") == "failure" and m and not m.startswith("Process completed with exit code"):
                    msg = m
                    break
        except Exception:                                  # noqa: BLE001
            pass
        line = msg or ("step failed: %s" % step if step else "")
        return line[:MAX_ERR - 1] + "\u2026" if len(line) > MAX_ERR else line
    except Exception:                                      # noqa: BLE001
        return ""


def run_lines(rows, now):
    lines = []
    for name, n, last, still, err in rows:
        s = "%s: failed %s" % (name, "once" if n == 1 else "%d times" % n)
        if last:
            s += ", last %s" % when(last, now)
        s += {True: "; still failing", False: "; passed since", None: ""}[still]
        if err:
            s += ". " + err
        lines.append(s)
    return lines


def sec_agsist(src, now, rep):
    lines = []
    try:
        rows = failed_runs(src, REPO, now)
        if rows:
            lines.append("Failed in the last 24 hours:")
            lines.extend("- " + x for x in run_lines(rows, now))
            for name, n, last, still, err in rows:
                if still:
                    rep.red("agsist job still failing: %s (%s in 24 h)" % (name, "once" if n == 1 else "%d times" % n))
        else:
            lines.append("No failed runs in the last 24 hours.")
    except Exception as e:                                 # noqa: BLE001
        lines.append("Failed runs: could not be read (%s)." % why(e))
    # cron-health.json: late jobs and the published size. In the private repo
    # since Oct 20 (branch private-data); the workflow unpacks it here.
    try:
        ch = json.loads(src.file("private/data/cron-health.json"))
        gen = parse_time(ch.get("generated_at"))
        crit = [str(x) for x in ch.get("late_critical") or []]
        late = [str(x) for x in ch.get("late") or [] if str(x) not in crit]
        if crit:
            lines.append("Late critical jobs: %s." % ", ".join(crit))
            rep.red("Late critical job%s: %s" % ("s" if len(crit) > 1 else "", ", ".join(crit)))
        lines.append("Late, not critical: %s." % (", ".join(late) if late else "none"))
        if gen and now - gen > timedelta(hours=12):
            lines.append("The job health file is %s old; the check itself may be stuck." % ago(gen, now).replace(" ago", ""))
        size = next((w for w in ch.get("workflows") or [] if w.get("workflow") == "published-size"), None)
        if size and isinstance(size.get("total_mb"), (int, float)):
            t, warn, fail = size["total_mb"], size.get("warn_mb"), size.get("fail_mb")
            lines.append("Published size: %s MB of the 1,024 MB Pages limit (warns at %s, red at %s)." % (round(t), warn, fail))
            if size.get("status") != "ok" or (isinstance(warn, (int, float)) and t >= warn):
                rep.red("Site size: %s MB published, past the %s MB warning. Pages stops deploying at 1,024 MB." % (round(t), warn))
        else:
            lines.append("Published size: not in the job health file.")
    except Exception as e:                                 # noqa: BLE001
        lines.append("Job health file: could not be read (%s)." % why(e))
    # The key the jobs use for the private repo (raw files, references, job
    # health). Checked here directly, so a dead key is said even when the job
    # health file could not be fetched because of it.
    try:
        pk = src.private_key(now)
        if pk.get("ok") is None:
            lines.append("Private repo key: not given to this job.")
        elif not pk["ok"]:
            lines.append("%s." % pk["why"])
            rep.red("%s: saves to the private repo (raw files, job health) are not landing." % pk["why"])
        elif pk.get("expires") and pk.get("days_left") is not None and pk["days_left"] < PRIVATE_KEY_WARN_DAYS:
            msg = "Private repo key expires %s" % pk["expires"].strftime("%b %-d, %Y")
            lines.append("%s." % msg)
            rep.red("%s. Make a new one (Contents read and write on dnilgis/agsistretired) and save it as PRIVATE_REPO_TOKEN." % msg)
        else:
            lines.append("Private repo key works%s." % (", expires %s" % pk["expires"].strftime("%b %-d, %Y") if pk.get("expires") else ""))
    except Exception as e:                                 # noqa: BLE001
        lines.append("Private repo key: could not be checked (%s)." % why(e))
    # The last GitHub Pages deploy.
    try:
        b = src.gh("/repos/%s/pages/builds/latest" % REPO)
        st = str(b.get("status") or "?")
        made = parse_time(b.get("updated_at") or b.get("created_at"))
        head = None
        try:
            head = parse_time(((src.gh("/repos/%s/commits/main" % REPO).get("commit") or {}).get("committer") or {}).get("date"))
        except Exception:                                  # noqa: BLE001
            pass
        lines.append("Last Pages deploy: %s%s." % (st, ", " + when(made, now) if made else ""))
        if st == "errored":
            rep.red("The last GitHub Pages deploy failed: readers see the last good build.")
        elif st == "building" and made and now - made > timedelta(minutes=45):
            rep.red("GitHub Pages deploy stuck: building since %s." % when(made, now))
        elif st == "built" and made and head and head - made > timedelta(hours=2):
            rep.red("GitHub Pages has not deployed since %s; main has newer commits." % when(made, now))
    except Exception as e:                                 # noqa: BLE001
        lines.append("Last Pages deploy: could not be read (%s)." % why(e))
    lines.extend(freshness(src, now, rep))
    rep.add("Site health, agsist", lines)


def grains_open(n):
    """CBOT grains, Central time, holidays not known: Sun 7 pm to Fri 1:20 pm,
    closed 7:45 to 8:30 am and 1:20 to 7 pm."""
    wd, m = n.weekday(), n.hour * 60 + n.minute
    if wd == 5 or (wd == 6 and m < 19 * 60) or (wd == 4 and m >= 13 * 60 + 20):
        return False
    return not (7 * 60 + 45 <= m < 8 * 60 + 30 or 13 * 60 + 20 <= m < 19 * 60)


def freshness(src, now, rep):
    """Prices, bids and the briefing, judged the way status.html judges them."""
    out = []
    checks = (("data/prices.json", "fetched", "Prices"), ("data/bids.json", "fetched", "Cash bids"),
              ("data/daily.json", "generated_at", "Daily briefing"))
    for path, key, label in checks:
        try:
            t = parse_time(json.loads(src.file(path)).get(key))
            if not t:
                raise ValueError("no time")
        except Exception as e:                             # noqa: BLE001
            out.append("%s: could not be read (%s)." % (label, why(e)))
            continue
        age = now - t
        if label == "Prices":
            if not grains_open(ct(now)):
                out.append("Prices: markets closed, last update %s." % when(t, now))
            elif age > timedelta(hours=4):
                out.append("Prices: stalled, last update %s." % ago(t, now))
                rep.red("Prices are stale: last update %s while the market is open." % ago(t, now))
            else:
                out.append("Prices: %s, updated %s." % ("delayed" if age > timedelta(minutes=75) else "live", ago(t, now)))
        elif label == "Cash bids":
            if age > timedelta(hours=2):
                out.append("Cash bids: stalled, last update %s." % ago(t, now))
                rep.red("Cash bids are stale: last update %s." % ago(t, now))
            else:
                out.append("Cash bids: %s, updated %s." % ("delayed" if age > timedelta(minutes=40) else "live", ago(t, now)))
        else:
            if ct(t).date() == ct(now).date():
                out.append("Daily briefing: today's is out, published %s." % when(t, now))
            else:
                out.append("Daily briefing: today's is not out yet; the last one was %s." % when(t, now))
                rep.red("Today's daily briefing is not out yet (last one %s)." % when(t, now))
    return out


def sec_bids(src, now, rep):
    lines = []
    tok = src.bids_token or src.gh_token
    try:
        rows = failed_runs(src, BIDS_REPO, now, tok, detail=5)
        if rows:
            lines.append("Failed in the last 24 hours:")
            lines.extend("- " + x for x in run_lines(rows, now))
            for name, n, last, still, err in rows:
                if still:
                    rep.red("bids job still failing: %s (%s in 24 h)" % (name, "once" if n == 1 else "%d times" % n))
        else:
            lines.append("No failed runs in the last 24 hours.")
    except urllib.error.HTTPError as e:
        if e.code in (401, 403, 404) and not src.bids_token:
            lines.append("bids: not checked (no token). Add a BIDS_READ_TOKEN secret (read-only, Actions on dnilgis/bids) to show it.")
        else:
            lines.append("Failed runs: could not be read (%s)." % why(e))
    except Exception as e:                                 # noqa: BLE001
        lines.append("Failed runs: could not be read (%s)." % why(e))
    try:
        d = src.url_json(BIDS_INDEX)
        c = d.get("counts") or {}
        total, live = c.get("total"), c.get("live")
        gen = parse_time(d.get("generated"))
        if not isinstance(total, int) or not isinstance(live, int):
            raise ValueError("no counts")
        extra = ", ".join("%s %s" % (num(c[k]), k) for k in ("refused", "broken") if isinstance(c.get(k), int) and c[k])
        lines.append("Elevator boards: %s of %s live%s%s." % (num(live), num(total), " (%s)" % extra if extra else "",
                                                          ", last poll %s" % when(gen, now) if gen else ""))
        if gen and now - gen > timedelta(hours=3):
            rep.red("bids has not polled since %s." % when(gen, now))
    except Exception as e:                                 # noqa: BLE001
        lines.append("Reader summary: could not be read (%s)." % why(e))
    rep.add("Site health, bids", lines)


def snapshot_counts(c):
    out = {}
    for k, _ in LISTS:
        v = (c.get("notices") or {}).get(k) if k == "rain-gauge" else c.get(k)
        if isinstance(v, int) and not isinstance(v, bool):
            out[k] = v
    return out


def sec_signups(src, now, rep, snap):
    """`snap` is {date: {list: n}} from earlier mornings; today's counts are added to it."""
    lines = []
    today = ct(now).date()
    cur = None
    try:
        c = src.worker("count")
        if not isinstance(c, dict) or not c.get("ok"):
            raise ValueError("not ok")
        cur = snapshot_counts(c)
        snap[today.isoformat()] = dict({k: v for k, v in (snap.get(today.isoformat()) or {}).items() if k == "bids_current"}, **cur)
    except Exception as e:                                 # noqa: BLE001
        lines.append("Worker counts: could not be read (%s)." % why(e))
    joins = None
    try:
        rows = src.worker("list", format="json")
        if isinstance(rows, list):
            ms = int(now.timestamp() * 1000)
            ts = [r.get("ts") for r in rows if isinstance(r, dict) and isinstance(r.get("ts"), (int, float))]
            joins = (sum(1 for t in ts if t >= ms - FD.DAY_MS), sum(1 for t in ts if t >= ms - 7 * FD.DAY_MS))
    except Exception:                                      # noqa: BLE001
        pass
    if cur is not None:
        y = snap.get((today - timedelta(days=1)).isoformat()) or {}
        w = snap.get((today - timedelta(days=7)).isoformat()) or {}
        for k, label in LISTS:
            if k not in cur:
                continue
            ch = []
            if k in y:
                ch.append("%+d since yesterday" % (cur[k] - y[k]))
            if k in w:
                ch.append("%+d vs 7 days ago" % (cur[k] - w[k]))
            s = "%s: %s" % (label, num(cur[k]))
            if ch:
                s += " (%s)" % ", ".join(ch)
            if k == "daily" and joins:
                s += ". Joined: %d in 24 h, %d in 7 days" % joins
            lines.append(s + ".")
        if not any(k in (snap.get((today - timedelta(days=1)).isoformat()) or {}) for k in cur):
            lines.append("Change vs yesterday starts once this report has run two mornings in a row.")
    else:
        try:
            a = json.loads(src.file("data/audience.json")).get("email") or {}
            if isinstance(a.get("subscribers"), int):
                lines.append("Daily briefing: %s (as of %s, from data/audience.json)." % (num(a["subscribers"]), a.get("asOf", "?")))
        except Exception as e:                             # noqa: BLE001
            lines.append("data/audience.json: could not be read (%s)." % why(e))
        if joins:
            lines.append("Joined the daily briefing: %d in 24 h, %d in 7 days." % joins)
    keep = sorted(snap)[-SNAP_DAYS:]
    for k in list(snap):
        if k not in keep:
            del snap[k]
    rep.add("Signups", lines)


def month_start_ms(now):
    n = ct(now)
    return int(n.replace(day=1, hour=0, minute=0, second=0, microsecond=0).timestamp() * 1000)


def sec_orders(src, now, rep):
    lines = []
    ms = int(now.timestamp() * 1000)
    m0 = month_start_ms(now)
    posts, notes, sapps, ok = [], [], [], True
    missing = []
    for path, q, name in (("form-list", {}, "forms"), ("notice-list", {"topic": "rain-gauge"}, "rain gauge list"),
                          ("sponsor-apps", {}, "sponsor applications")):
        try:
            d = src.worker(path, **q)
            if not isinstance(d, list):
                raise ValueError("not a list")
            if path == "form-list":
                posts = d
            elif path == "notice-list":
                notes = d
            else:
                sapps = d
        except Exception as e:                             # noqa: BLE001
            ok = False
            missing.append("%s (%s)" % (name, why(e)))
    if missing:
        lines.append("Could not read: %s. Those count as 0 below." % ", ".join(missing))
    sa = [{"kind": "sponsor-apply", "ts": r.get("ts")} for r in sapps if isinstance(r, dict)]
    day = FD.tally(posts + sa, notes, ms - FD.DAY_MS, ms, kinds=ORDER_KINDS)
    mtd = FD.tally(posts + sa, notes, m0, ms, kinds=ORDER_KINDS)
    if ok or posts or notes or sapps:
        lines.append("Last 24 hours: %s." % FD.tally_text(day, ORDER_KINDS))
        lines.append("Month to date: %s." % FD.tally_text(mtd, ORDER_KINDS))
    waiting = [(k, one, many) for k, one, many in ORDER_KINDS if k in WAITING and day.get(k)]
    if waiting:
        rep.red("Came in over the last 24 hours, waiting on you: %s." %
                ", ".join(plural(day[k], one, many) for k, one, many in waiting))
    pend = sum(1 for r in sapps if isinstance(r, dict) and r.get("status") == "pending")
    if pend:
        rep.red("%s waiting for your yes or no." % plural(pend, "sponsor application", "sponsor applications"))
    try:
        reqs = src.worker("elev/admin/requests")
        pend_reqs = [r for r in (reqs.get("requests") or []) if isinstance(r, dict) and r.get("status") == "pending"]
        n = len(pend_reqs)
        lines.append("Elevator listing requests still pending on elev-admin: %d." % n)
        # Sig, Oct 20: name them (elevator, town, state) so the email says who without opening elev-admin.
        # Business name and place only: never the contact person, phone or email.
        for r in pend_reqs[:10]:
            where = ", ".join(x for x in (clean_txt(r.get("town")), clean_txt(r.get("state"))) if x)
            lines.append("  - %s%s" % (clean_txt(r.get("elevator")) or "(no name given)", (", " + where) if where else ""))
        if n > 10:
            lines.append("  - and %d more on elev-admin" % (n - 10))
        if n:
            rep.red("%s still pending on elev-admin (call, then make the listing or dismiss it)." %
                    plural(n, "elevator listing request", "elevator listing requests"))
    except Exception as e:                                 # noqa: BLE001
        lines.append("Elevator listing requests: could not be read (%s)." % why(e))
    lines.append(stripe_line(src, now))
    lines.extend(rain_print_paid(src, now))
    rep.add("Orders and requests", lines)


def stripe_line(src, now):
    """Paid charges, counts and dollars only. Never a name or address."""
    if not src.stripe_key:
        return "Stripe totals: see the dashboard. Paid Rain Prints are under Orders below."
    m0 = month_start_ms(now) // 1000
    d0 = int(now.timestamp()) - 86400
    try:
        charges, after = [], None
        for _ in range(10):
            p = {"limit": 100, "created[gte]": m0}
            if after:
                p["starting_after"] = after
            d = src.stripe("charges", p) or {}
            got = [c for c in d.get("data") or [] if isinstance(c, dict)]
            charges.extend(got)
            if not d.get("has_more") or not got:
                break
            after = got[-1].get("id")
    except Exception as e:                                 # noqa: BLE001
        return "Stripe: could not be read (%s)." % why(e)
    paid = [c for c in charges if c.get("paid") and c.get("status") == "succeeded"]

    def money(rows):
        cents = sum(int(c.get("amount") or 0) - int(c.get("amount_refunded") or 0) for c in rows)
        return "$%s" % "{:,.2f}".format(cents / 100)
    day = [c for c in paid if int(c.get("created") or 0) >= d0]
    refunded = sum(1 for c in paid if c.get("refunded") or int(c.get("amount_refunded") or 0) > 0)
    s = "Stripe: last 24 hours %s, %s; month to date %s, %s" % (plural(len(day), "paid", "paid"), money(day),
                                                               plural(len(paid), "paid", "paid"), money(paid))
    return s + ("; %s refunded (net of refunds)." % refunded if refunded else ".")


RP_PRODUCT = {1900: "Digital file", 4500: "Print", 8900: "Framed"}
RP_REF_RE = re.compile(r"^[A-Za-z0-9_-]{1,200}$")


def rp_sessions(src, since):
    """Completed Checkout Sessions since `since` (seconds), up to 500. Raises when Stripe cannot be read."""
    rows, after = [], None
    for _ in range(5):
        p = {"limit": 100, "status": "complete", "created[gte]": since}
        if after:
            p["starting_after"] = after
        d = src.stripe("checkout/sessions", p) or {}
        got = [x for x in d.get("data") or [] if isinstance(x, dict)]
        rows.extend(got)
        if not d.get("has_more") or not got:
            break
        after = got[-1].get("id")
    return rows


def rain_print_paid(src, now):
    """Each paid Rain Print checkout of the last 48 hours, one line each:
    product, amount, the design reference and the maker link Sig opens to make
    it. Read from /v1/checkout/sessions?status=complete. Only those things,
    and the session id of a paid session with no design reference, are taken
    from a session; never an email, a name or an address."""
    if not src.stripe_key:
        return []
    try:
        rows = rp_sessions(src, int(now.timestamp()) - 2 * 86400)
    except Exception as e:                                 # noqa: BLE001
        return ["Rain Print orders: could not be read from Stripe (%s)." % why(e)]
    out = []
    money = lambda c: "{:,.2f}".format(c / 100)
    for x in sorted(rows, key=lambda r: int(r.get("created") or 0)):
        if x.get("payment_status") not in (None, "paid"):
            continue
        ref = str(x.get("client_reference_id") or "")
        # The product from the price before any code (2026-10-19: with the
        # letter's NEXTPRINT code a print paid $35 and read "Rain Print"); the
        # amount is what was paid.
        cents = int(x.get("amount_total") or 0)
        sub = int(x.get("amount_subtotal") or 0) or cents
        what = RP_PRODUCT.get(sub, RP_PRODUCT.get(cents, "Rain Print"))
        paid = "$%s" % money(cents) + (" ($%s less $%s off)" % (money(sub), money(sub - cents)) if sub > cents else "")
        if not RP_REF_RE.match(ref):
            # paid through a bare payment link (shared, or "buy again" from a
            # receipt): the money is real, so it is said, not skipped
            out.append("Rain Print paid: %s, %s, NO design reference: find the buyer in Stripe (session %s) and ask for the design"
                       % (what, paid, str(x.get("id") or "?")))
            continue
        out.append("Rain Print paid: %s, %s, ref %s, make it at https://agsist.com/rain-print?d=%s&maker=1"
                   % (what, paid, ref, urllib.parse.quote(ref, safe="-_")))
    if not out:
        return ["Rain Print orders, last 48 hours: none paid."]
    return [scrub(line) for line in out]


RP_STYLE = {"r1": "Staircase", "r2": "Roots"}
RP_PRINTS = ("print12x18", "framed12x18")



def rp_order_line(o, now):
    """One order: product, town year style, paid or pay pressed, and the link
    that opens it in Sig's maker view (with the serial for a print)."""
    what = {"digital": "Digital file", "print12x18": "Print", "framed12x18": "Framed"}.get(o.get("product"), "Rain Print")
    design = " ".join(x for x in (clean_txt(o.get("place"), 60), str(o.get("year") or ""),
                                  RP_STYLE.get(o.get("style"), "")) if x) or "design not named"
    if o.get("status") == "paid":
        amt = (o.get("paid") or {}).get("amount")
        state = "paid" + (" $%s" % "{:,.2f}".format(amt) if isinstance(amt, (int, float)) else "")
        # the proof email is the proof (Oct 20): nothing is made until the buyer approves it
        ap = parse_time((o.get("approved") or {}).get("at"))
        if ap:
            state += ", approved %s" % when(ap, now)
        elif o.get("approval_overdue"):
            state += ", no answer on the proof in 3 business days: follow up"
        else:
            state += ", waiting for approval"
    else:
        t = parse_time(o.get("at") or o.get("ts"))
        state = "pay pressed%s, payment not confirmed" % ((" " + when(t, now)) if t else "")
    serial = ""
    if o.get("product") in RP_PRINTS:
        if o.get("serial"):
            serial = ", serial %s" % o["serial"]
        elif o.get("serial_next"):
            serial = ", serial %s if it is the next one you make" % o["serial_next"]
    url = str(o.get("fulfill_url") or "")
    if not url.startswith("https://agsist.com/rain-print?"):
        url = ""
    return "%s, %s, %s%s%s" % (what, design, state, serial, (": open to fulfill " + url) if url else "")


def sec_rp_orders(src, now, rep):
    """Every press of Pay on /rain-print in the last 48 hours (the subs
    worker's /rp-order/list), one line each. Nothing about the buyer: the
    worker never has it."""
    try:
        d = src.worker("rp-order/list", days=2)
        if not isinstance(d, dict) or not isinstance(d.get("orders"), list):
            raise ValueError("not a list")
    except Exception as e:                                 # noqa: BLE001
        rep.add("Orders", ["Rain Print order records: could not be read (%s)." % why(e)])
        return
    orders = [o for o in d["orders"] if isinstance(o, dict)]
    lines = []
    if d.get("stripe") != "ok":
        # the read-only Stripe key lives on the worker alone (Oct 20): without it there, payments are not checked
        lines.append("Payments are not checked (Stripe on the worker: %s): match each one to Stripe by time and product."
                     % clean_txt(d.get("stripe") or "no key", 60))
    if not orders:
        lines.insert(0, "Rain Print, last 48 hours: no one pressed Pay.")
        rep.add("Orders", lines)
        return
    paid = sum(1 for o in orders if o.get("status") == "paid")
    lines.insert(0, "Rain Print, last 48 hours: %s, %s." % (plural(len(orders), "press of Pay", "presses of Pay"),
                                                              plural(paid, "paid", "paid")))
    for o in orders[:20]:
        lines.append("  - " + rp_order_line(o, now))
    if len(orders) > 20:
        lines.append("  - and %d more" % (len(orders) - 20))
    rep.add("Orders", lines)


def short_day(iso):
    t = datetime.strptime(iso, "%Y-%m-%d")
    return "%s %d" % (t.strftime("%b"), t.day)


def returns_lines(a, fn=None):
    """The newest whole cohort's 14-day return share with its n (or the reason
    it is withheld), from audience.json's returns section; and the Rain Print
    funnel for the last 7 days, `fn` as build_audience.funnel_section() returns
    it (read live, never from a file). Counts only; a stale returns section
    says how old it is."""
    out, src = [], a.get("sources") or {}

    def stale(key, sec):
        s = src.get(key) or {}
        return "" if s.get("ok", True) else " (last pulled through %s)" % sec.get("through", "?")
    ret = a.get("returns") or {}
    wk = ((ret.get("cohorts") or {}).get("weeks") or [])
    if wk:
        w = wk[-1]
        a_, b_ = short_day(w["week"]), short_day(w["end"])
        span = "%s-%s" % (a_, b_.split()[1] if a_.split()[0] == b_.split()[0] else b_)
        if isinstance(w.get("share"), (int, float)):
            out.append("Came back within 14 days: %s%% of %s new readers first seen %s (GA4, cookie-based estimate)%s."
                       % (("%.1f" % (100 * w["share"])).rstrip("0").rstrip("."), num(w["newReaders"]), span, stale("returns", ret)))
        else:
            out.append("Came back within 14 days, readers first seen %s: withheld, %s%s." % (span, w.get("withheld") or "no share", stale("returns", ret)))
    fn = fn or {}
    l7 = fn.get("last7") or {}
    c, p = l7.get("counts") or {}, l7.get("people") or {}
    if c:
        out.append("Rain Print, 7 days to %s: %s draws (%s people), %s email signups, %s paid back from Stripe, %s order forms sent (GA4 events)."
                   % (short_day(l7["end"]), num(c.get("rain_print_draw", 0)), num(p.get("rain_print_draw", 0)),
                      num(c.get("email_signup", 0)), num(c.get("purchase", 0)), num(c.get("rain_print_order", 0))))
    return out


def promo_lines(pc):
    """Two lines from build_audience.promo_section(): promo clicks by page and
    gauge signups, then email sessions by source with the Daily's links. 7 days,
    with 28 days beside each total. Counts only."""
    w7, w28 = ((pc or {}).get("windows") or {}).get("7d"), ((pc or {}).get("windows") or {}).get("28d") or {}
    if not w7:
        return []

    def promo(e, name):
        a_ = (w7.get("promos") or {}).get(e) or {}
        b_ = ((w28.get("promos") or {}).get(e) or {}).get("total")
        pg = ", ".join("%s %s" % (x["page"], num(x["count"])) for x in (a_.get("pages") or [])[:5])
        return "%s %s%s%s" % (name, num(a_.get("total", 0)), (" (%s)" % pg) if pg else "",
                              (" [28 days %s]" % num(b_)) if isinstance(b_, int) else "")
    out = ["Promo clicks, 7 days to %s: %s; %s. Gauge waitlist signups on /rain-gauge: %s%s (GA4 events)."
           % (short_day(w7["end"]), promo("rain_print_promo_click", "Rain Print"), promo("rain_gauge_promo_click", "rain gauge"),
              num(w7.get("gaugeSignups", 0)), (" [28 days %s]" % num(w28["gaugeSignups"])) if isinstance(w28.get("gaugeSignups"), int) else "")]
    em = w7.get("email") or {}
    bs = ", ".join("%s %s" % (x["source"], num(x["sessions"])) for x in em.get("bySource") or []) or "none"
    dl = ", ".join("%s %s" % (x["content"], num(x["sessions"])) for x in em.get("daily") or [])
    t28 = sum(x.get("sessions", 0) for x in ((w28.get("email") or {}).get("bySource") or []))
    out.append("Email sessions, 7 days to %s, by utm_source: %s%s [28 days %s] (GA4)."
               % (short_day(w7["end"]), bs, ("; the Daily by link: " + dl) if dl else "", num(t28)))
    return out


def sec_traffic(src, now, rep):
    lines = []
    try:
        a = json.loads(src.file("data/audience.json"))
        days = [d for d in ((a.get("series") or {}).get("days") or []) if isinstance(d, dict) and isinstance(d.get("users"), int)]
        if days:
            d = days[-1]
            t = datetime.strptime(d["d"], "%Y-%m-%d")
            lines.append("Latest day in the analytics, %s %s %d: %s users (views by day are not in the data)." % (
                t.strftime("%a"), t.strftime("%b"), t.day, num(d["users"])))
        w = (a.get("totals") or {}).get("7d") or {}
        r = next((x for x in a.get("ranges") or [] if x.get("id") == "7d"), {})
        if isinstance(w.get("users"), int):
            lines.append("7 days to %s: %s users, %s views." % (r.get("end", "?"), num(w["users"]), num(w.get("views", "?"))))
        for rid in ("7d", "28d"):
            pages = (a.get("pages") or {}).get(rid)
            if pages:
                top = ", ".join("%s %s" % (p.get("path"), num(p.get("views"))) for p in pages[:3])
                lines.append("Top pages, %s: %s." % ({"7d": "7 days", "28d": "28 days"}[rid], top))
                break
        fn, fn_line = None, None
        if src.dry:
            fn_line = "Rain Print funnel: left out of a dry run (the Actions log is public)."
        else:
            try:
                fn = src.rain_print_funnel(((a.get("servers") or {}).get("towns") or []), now)
            except Exception as e:                         # noqa: BLE001
                fn_line = "Rain Print funnel: %s." % (str(e) if isinstance(e, LookupError) else "could not be read (%s)" % why(e))
        lines.extend(returns_lines(a, fn))
        if fn_line:
            lines.append(fn_line)
        else:
            # Same GA4 and the same rule: never in a dry run, never in a file.
            try:
                lines.extend(promo_lines(src.promo_counts(((a.get("servers") or {}).get("towns") or []), now)))
            except Exception as e:                     # noqa: BLE001
                lines.append("Promo clicks and email sessions: %s." % (str(e) if isinstance(e, LookupError) else "could not be read (%s)" % why(e)))
        if not lines:
            lines.append("data/audience.json has no traffic numbers.")
    except Exception as e:                                 # noqa: BLE001
        lines.append("data/audience.json: could not be read (%s)." % why(e))
    rep.add("Traffic", lines)


TODO_RE = re.compile(r"^\s*[-*]\s+\[( |x|X)\]\s+(.+?)\s*$")


# ───────────────────────────── today ─────────────────────────────

def _host(s):
    u = s.get("website") or s.get("url") or ""
    try:
        return (urllib.parse.urlsplit(u).hostname or "").lower().removeprefix("www.")
    except ValueError:
        return ""


def bids_current(s, now):
    """A board with a price on the site now: last good read inside its line."""
    c = parse_time(s.get("checkedAt"))
    if c is None or not (isinstance(s.get("rows"), int) and s["rows"] > 0):
        return False
    return (now - c) / timedelta(hours=1) < (PASTED_H if s.get("pasted") is True else LIVE_H)


def hand_paste(index, now):
    """The bid sites a person has to deal with by hand, biggest town count first.
    components/today-core.js handPaste(), the same rule."""
    by = {}
    for s in (index or {}).get("sources") or []:
        if isinstance(s, dict) and _host(s):
            by.setdefault(_host(s), []).append(s)
    out = []
    bot = lambda s: bool(re.search(r"bot check|Cloudflare challenge", s.get("error") or "", re.I))   # noqa: E731
    ref = lambda s: s.get("health") == "refused" and not s.get("emptyBoard")                         # noqa: E731

    def stale(s):
        c = parse_time(s.get("checkedAt"))
        return c is None or (now - c) / timedelta(hours=1) >= STALE_H
    for h, rows in by.items():
        b = any(bot(s) for s in rows)
        hit = [s for s in rows if (b or ref(s)) and stale(s)]
        pasted = [s for s in rows if s.get("pasted") is True]
        if not hit and not (pasted and b):
            continue
        boards = hit or pasted
        towns = {(s.get("location") or "", s.get("usState") or "") for s in boards}
        states = sorted({s.get("usState") for s in boards if s.get("usState")})
        reads = [t for t in (parse_time(s.get("checkedAt")) for s in boards) if t]
        pastes = [t for t in (parse_time(s.get("pastedAt") or s.get("checkedAt")) for s in pasted) if t]
        ops = {}
        for s in rows:
            if s.get("operator"):
                ops[s["operator"]] = ops.get(s["operator"], 0) + 1
        op = sorted(ops, key=lambda k: (-ops[k], k))[0] if ops else h
        out.append({"host": h, "operator": op, "why": "bot check" if b else "refused", "boards": len(boards),
                    "towns": len(towns), "states": states, "last": max(reads) if reads else None,
                    "pasted": max(pastes) if pastes else None, "reader": PASTE_READERS.get(h)})
    out.sort(key=lambda p: (-p["towns"], -p["boards"], p["host"]))
    return out


def towns_text(p):
    n, w = p["towns"], "town" if p["towns"] == 1 else "towns"
    if len(p["states"]) == 1 and p["states"][0] in STATE_NAMES:
        return "%d %s %s" % (n, STATE_NAMES[p["states"][0]], w)
    if 1 < len(p["states"]) <= 3:
        return "%d %s in %s" % (n, w, ", ".join(STATE_NAMES.get(x, x) for x in p["states"]))
    return "%d %s" % (n, w)


def ct_stamp(t):
    c = ct(t)
    return "%s %d, %s CT" % (c.strftime("%b"), c.day, c.strftime("%I:%M %p").lstrip("0"))


def sec_today(src, now, rep, snap):
    """The Today block: hand-paste sites, boards with a current price, the rest by name."""
    t = {"health": "", "paste": [], "also": [], "more": 0}
    day = ct(now).date()
    try:
        idx = src.url_json(BIDS_INDEX)
        srcs = [s for s in (idx.get("sources") or []) if isinstance(s, dict)]
        cur = sum(1 for s in srcs if bids_current(s, now))
        if srcs and cur:
            y = (snap.get((day - timedelta(days=1)).isoformat()) or {}).get("bids_current")
            snap.setdefault(day.isoformat(), {})["bids_current"] = cur
            t["health"] = "Boards with a current price: %s of %s (%d%%)%s." % (
                num(cur), num(len(srcs)), round(100 * cur / len(srcs)),
                ", %+d since yesterday" % (cur - y) if isinstance(y, int) else "")
        try:
            st = (src.url_json(PASTE_STATUS) or {}).get("sites") or {}
        except Exception:                                  # noqa: BLE001
            st = {}
        ps = hand_paste(idx, now)
        big = [p for p in ps if p["boards"] > 2]
        t["more"] = len(ps) - len(big)
        for p in big[:8]:
            r = p["reader"]
            last_paste = (st.get(r[0]) or {}).get("pastedAt") if r else None
            lp = parse_time(last_paste) if last_paste else p["pasted"]
            why = ("Blocked by a bot check. " if p["why"] == "bot check" else "Our reader refused their page. ") + \
                "Feeds %s in %s. %s%s" % (plural(p["boards"], "board", "boards"), towns_text(p),
                                          "Last good read %s." % ct_stamp(p["last"]) if p["last"] else "No good read on file.",
                                          " Last paste %s." % ct_stamp(lp) if lp else "")
            t["paste"].append({"title": p["operator"], "why": why,
                               "link": ("https://agsist.com/elev-admin.html?paste=%s#paste" % r[0]) if r else "",
                               "label": "Paste" if r else "no paste reader yet"})
        t["more"] += max(0, len(big) - 8)
    except Exception as e:                                 # noqa: BLE001
        t["also"].append("Bid sites: could not be read (%s)." % why(e))
    try:
        rq = [r for r in (src.worker("elev/admin/requests").get("requests") or []) if r.get("status") == "pending"]
        if rq:
            t["also"].append("%s: %s." % (plural(len(rq), "listing request", "listing requests"),
                                          "; ".join(clean_txt("%s, %s %s" % (r.get("elevator") or "?", r.get("town") or "", r.get("state") or ""), 60).strip()
                                                    for r in rq[:5])))
    except Exception:                                      # noqa: BLE001
        pass
    try:
        ap = [a for a in (src.worker("sponsor-apps") or []) if isinstance(a, dict) and a.get("status") in ("confirmed", "approved")]
        if ap:
            t["also"].append("%s: %s." % (plural(len(ap), "sponsor application open", "sponsor applications open"),
                                          "; ".join(clean_txt(a.get("company") or "?", 40) for a in ap[:5])))
    except Exception:                                      # noqa: BLE001
        pass
    rep.today = t


def sec_todos(src, now, rep):
    try:
        items = [m.group(2) for m in map(TODO_RE.match, src.file("TODO-SIG.md").splitlines()) if m and m.group(1) == " "]
        lines = ["- " + x for x in items] or ["Nothing open."]
    except Exception as e:                                 # noqa: BLE001
        lines = ["TODO-SIG.md: could not be read (%s)." % why(e)]
    rep.add("To-dos", lines)


# ───────────────────────────── the email ─────────────────────────────

def make_report(src, now, snap):
    rep = Report()
    try:
        sec_today(src, now, rep, snap)
    except Exception as e:                                 # noqa: BLE001
        rep.today = {"health": "", "paste": [], "also": ["Today: could not be built (%s)." % why(e)], "more": 0}
    for f in (sec_agsist, sec_bids):
        try:
            f(src, now, rep)
        except Exception as e:                             # noqa: BLE001
            rep.add(f.__name__, ["Could not be built (%s)." % why(e)])
    for f, args in ((sec_signups, (snap,)), (sec_orders, ()), (sec_rp_orders, ()), (sec_traffic, ()), (sec_todos, ())):
        try:
            f(src, now, rep, *args)
        except Exception as e:                             # noqa: BLE001
            rep.add(f.__name__, ["Could not be built (%s)." % why(e)])
    return rep


def subject(rep, now):
    n = ct(now)
    day = "%s %s %d" % (n.strftime("%a"), n.strftime("%b"), n.day)
    if rep.needs:
        return "AGSIST morning, %s: %s" % (day, plural(len(rep.needs), "thing needs you", "things need you"))
    return "AGSIST morning, %s: all clear" % day


def today_lines(rep):
    t = rep.today or {}
    out = []
    if t.get("health"):
        out.append(t["health"])
    if t.get("paste"):
        out.append("Bid sites to paste or fix, biggest first:")
        for p in t["paste"]:
            out.append("- %s: %s %s" % (scrub(p["title"]), scrub(p["why"]), ("Paste: " + p["link"]) if p["link"] else "(no paste reader yet)"))
    if t.get("more"):
        out.append("%s with 1 or 2 boards on the Today page." % plural(t["more"], "more site", "more sites"))
    out.extend(scrub(x) for x in t.get("also") or [])
    return out


def text_body(rep, now):
    out = ["Today"] + today_lines(rep) + ["Today page: %s" % TODAY_URL, "", "Needs you"]
    out.extend(["- " + x for x in rep.needs] or ["Nothing red this morning."])
    for title, lines in rep.sections:
        out += ["", title]
        out.extend(lines)
    out += ["", "To check off a to-do, edit TODO-SIG.md on GitHub: %s" % TODO_EDIT,
            "Counts only: no reader or customer address is ever in this email.", "", "-- ", ADDRESS]
    return "\n".join(out) + "\n"


def html_body(rep, now):
    e = H.escape
    red = "#a3271c"

    def ul(lines, color=None):
        items, prose = [], []
        for x in lines:
            if x.startswith("- "):
                items.append(x[2:])
            else:
                if items:
                    prose.append(("ul", items))
                    items = []
                prose.append(("p", x))
        if items:
            prose.append(("ul", items))
        h = []
        for kind, v in prose:
            st = ' style="color:%s;font-weight:bold"' % color if color else ""
            if kind == "p":
                h.append('<p style="margin:4px 0;font-size:15px;line-height:1.45"%s>%s</p>' % (st, e(v)))
            else:
                h.append('<ul style="margin:4px 0 4px 18px;padding:0;font-size:15px;line-height:1.45">%s</ul>'
                         % "".join("<li%s>%s</li>" % (st, e(i)) for i in v))
        return "".join(h)
    h2 = '<h2 style="font-size:17px;margin:20px 0 6px;border-bottom:1px solid #ddd;padding-bottom:3px">%s</h2>'
    parts = [today_html(rep)] if rep.today else []
    parts.append(h2 % "Needs you")
    parts.append(ul(["- " + x for x in rep.needs], red) if rep.needs else ul(["Nothing red this morning."]))
    for title, lines in rep.sections:
        parts.append(h2 % e(title))
        parts.append(ul(lines))
    parts.append('<p style="font-size:13px;color:#6b6b6b;margin-top:22px;line-height:1.45">To check off a to-do, '
                 '<a href="%s">edit TODO-SIG.md on GitHub</a>.<br>Counts only: no reader or customer address is ever in '
                 'this email.<br>%s</p>' % (e(TODO_EDIT, quote=True), e(ADDRESS)))
    return ('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>'
            '<body style="margin:0;background:#fff"><div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;'
            'padding:16px;color:#1a1a1a;background:#fff">%s</div></body></html>' % "".join(parts))


def today_html(rep):
    """The Today block for Gmail on a phone: one table, inline styles, no script."""
    e = H.escape
    t = rep.today or {}
    n = len(t.get("paste") or []) + int(t.get("more") or 0) + len(t.get("also") or [])
    rows = []
    head = ('<tr><td style="padding:14px 14px 4px;font-family:Arial,Helvetica,sans-serif">'
            '<div style="font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#7a5b12;font-weight:bold">Today</div>'
            '<div style="font-size:19px;font-weight:bold;color:#1a1a1a;margin-top:2px">%s</div>%s</td></tr>'
            % (e(plural(n, "thing", "things") + " on the list") if n else "Nothing on the list",
               '<div style="font-size:14px;color:#444;margin-top:4px">%s</div>' % e(scrub(t["health"])) if t.get("health") else ""))
    rows.append(head)
    for i, p in enumerate(t.get("paste") or []):
        btn = ('<a href="%s" style="display:inline-block;background:#d4a23f;color:#14110a;font-weight:bold;text-decoration:none;'
               'padding:10px 16px;border-radius:6px;font-size:15px">Paste</a>' % e(p["link"], quote=True)) if p["link"] else \
              '<span style="font-size:13px;color:#6b6b6b">no paste reader yet</span>'
        rows.append('<tr><td style="padding:10px 14px;border-top:1px solid #e6e1d6;font-family:Arial,Helvetica,sans-serif">'
                    '<div style="font-size:16px;font-weight:bold;color:#1a1a1a">%s%s</div>'
                    '<div style="font-size:14px;line-height:1.45;color:#333;margin:3px 0 8px">%s</div>%s</td></tr>'
                    % (e(scrub(p["title"])), ' <span style="font-size:11px;color:#7a5b12;border:1px solid #d4a23f;border-radius:3px;padding:0 4px">FIRST</span>' if i == 0 else "",
                       e(scrub(p["why"])), btn))
    if t.get("more"):
        rows.append('<tr><td style="padding:8px 14px;border-top:1px solid #e6e1d6;font:14px Arial,Helvetica,sans-serif;color:#444">%s</td></tr>'
                    % e(plural(t["more"], "more site", "more sites") + " with 1 or 2 boards on the Today page."))
    for x in t.get("also") or []:
        rows.append('<tr><td style="padding:8px 14px;border-top:1px solid #e6e1d6;font:14px Arial,Helvetica,sans-serif;color:#333">%s</td></tr>'
                    % e(scrub(x)))
    rows.append('<tr><td style="padding:12px 14px 14px;border-top:1px solid #e6e1d6"><a href="%s" style="display:inline-block;'
                'border:1px solid #1a1a1a;color:#1a1a1a;font:bold 15px Arial,Helvetica,sans-serif;text-decoration:none;padding:10px 16px;'
                'border-radius:6px">Open the Today page</a></td></tr>' % e(TODAY_URL, quote=True))
    return ('<table role="presentation" width="100%%" cellpadding="0" cellspacing="0" border="0" '
            'style="border-collapse:collapse;background:#faf7f0;border:1px solid #e6e1d6;border-radius:8px;margin:4px 0 8px">%s</table>'
            % "".join(rows))


def build(rep, now, to, fn="AGSIST", fa=""):
    m = EmailMessage()
    m["Subject"] = subject(rep, now)
    m["From"] = formataddr((fn, fa))
    m["To"] = to
    m["Message-ID"] = make_msgid(domain=(fa.split("@", 1)[1] if "@" in fa else "agsist.com"))
    m.set_content(text_body(rep, now))
    m.add_alternative(html_body(rep, now), subtype="html")
    return m


def load_snap(path):
    try:
        with open(path, encoding="utf-8") as f:
            d = json.load(f)
        return {k: {kk: vv for kk, vv in v.items() if isinstance(vv, int)} for k, v in d.items()
                if re.fullmatch(r"\d{4}-\d{2}-\d{2}", k) and isinstance(v, dict)}
    except Exception:                                      # noqa: BLE001
        return {}


def save_snap(path, snap):
    try:
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(snap, f, sort_keys=True)
    except Exception as e:                                 # noqa: BLE001
        print("counts file not saved (%s)" % type(e).__name__)


def run(src, now, dry, send, to, snap):
    """(exit code, log lines). The log carries counts and the names of things only."""
    rep = make_report(src, now, snap)
    m = build(rep, now, to)
    log = ["needs you: %d; sections: %s" % (len(rep.needs), ", ".join("%s (%d lines)" % (t, len(ls)) for t, ls in rep.sections))]
    if dry:
        log.append("DRY RUN: nothing sent. The email:")
        log.append("Subject: " + m["Subject"])
        log.extend(m.get_body(("plain",)).get_content().splitlines())
        return 0, log
    try:
        send(m)
    except Exception as e:                                 # noqa: BLE001
        log.append("send failed (%s)" % type(e).__name__)
        return 1, log
    log.append("sent: %s" % m["Subject"])
    return 0, log


def chicago_tick_ok(now):
    """True when the latest tick of CRONS is 6:40 am in Chicago (one of the
    two is, every day: 11:40 UTC in CDT, 12:40 UTC in CST)."""
    from cron_gate import latest_tick
    t = latest_tick(list(CRONS), now)
    if t is None:
        return False
    c = ct(t)
    return (c.hour, c.minute) == (6, 40)


def gate():
    event = env("GITHUB_EVENT_NAME", "workflow_dispatch")
    now = datetime.now(UTC)
    if event == "workflow_dispatch":
        go, reason = 1, "manual run"
    elif chicago_tick_ok(now):
        go, reason = 1, "the latest tick is 6:40 am Central"
    else:
        go, reason = 0, "the latest tick is not 6:40 am Central (the other clock serves today)"
    text = "go=%d\nreason=%s\n" % (go, reason)
    out = env("GITHUB_OUTPUT")
    if out:
        with open(out, "a") as f:
            f.write(text)
    print(text, end="")
    return 0


def main():
    if "--selftest" in sys.argv:
        return selftest()
    if "--gate" in sys.argv:
        return gate()
    dry = env("DRY_RUN") == "1"
    src = Sources(gh_token=env("GITHUB_TOKEN", ""), bids_token=env("BIDS_READ_TOKEN", ""), list_url=env("LIST_URL", ""),
                  list_token=env("LIST_TOKEN", ""), stripe_key=env("STRIPE_READ_KEY", ""),
                  ga4_prop=env("GA4_PROPERTY_ID", ""), ga4_cred=env("GA4_SERVICE_ACCOUNT", ""), dry=dry,
                  private_token=env("PRIVATE_REPO_TOKEN", ""))
    to = env("REPORT_TO") or env("FORMS_TO") or env("SPONSOR_TO") or "sig@farmers1st.com"
    fn, fa = env("FROM_NAME", "AGSIST"), env("FROM_ADDR") or env("SMTP_USER") or ""
    snap_path = env("SNAPSHOT", os.path.join(ROOT, ".morning-report", "counts.json"))
    snap = load_snap(snap_path)

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

    code, log = run(src, datetime.now(UTC), dry, send, to, snap)
    for line in log:
        print(scrub(line))
    save_snap(snap_path, snap)
    return code


# ───────────────────────────── selftest ─────────────────────────────

class Fake(Sources):
    """Fixtures for every source. `broken` names sources that raise."""

    def __init__(self, gh=None, worker=None, urls=None, files=None, stripe=None, broken=(), bids_token="", stripe_key=""):
        super().__init__(gh_token="t", bids_token=bids_token, list_url="https://w.dev", list_token="k", stripe_key=stripe_key)
        self.ghd, self.wd, self.ud, self.fd, self.sd, self.broken = gh or {}, worker or {}, urls or {}, files or {}, stripe, set(broken)
        self.asked = []
        self.funnel = None
        self.promo = None
        self.pk = None

    def _pick(self, table, key, kind):
        self.asked.append((kind, key))
        if kind in self.broken or key in self.broken:
            raise urllib.error.HTTPError("https://x/?token=SECRET", 500, "x", {}, None)
        for k, v in table.items():
            if key.startswith(k):
                if isinstance(v, Exception):
                    raise v
                return v
        raise urllib.error.HTTPError("https://x/?token=SECRET", 404, "nf", {}, None)

    def gh(self, path, repo_token=None):
        return self._pick(self.ghd, path, "gh")

    def worker(self, path, **q):
        return self._pick(self.wd, path + ("?" + urllib.parse.urlencode(q) if q else ""), "worker")

    def url_json(self, url):
        return self._pick(self.ud, url, "url")

    def stripe(self, path, params):
        if not self.stripe_key:
            return None
        self.asked.append(("stripe", path))
        if "stripe" in self.broken:
            raise urllib.error.HTTPError("https://api.stripe.com/x", 401, "no", {}, None)
        return self.sd

    def rain_print_funnel(self, towns, now):
        self.asked.append(("ga4-funnel", tuple(t.get("city") for t in towns)))
        if "ga4" in self.broken:
            raise urllib.error.HTTPError("https://analyticsdata.googleapis.com/x", 403, "no", {}, None)
        if self.funnel is None:
            raise LookupError("GA4 not set up for this job")
        return self.funnel

    def promo_counts(self, towns, now):
        self.asked.append(("ga4-promo", tuple(t.get("city") for t in towns)))
        if "ga4-promo" in self.broken:
            raise urllib.error.HTTPError("https://analyticsdata.googleapis.com/x", 500, "no", {}, None)
        if self.promo is None:
            raise LookupError("GA4 not set up for this job")
        return self.promo

    def file(self, rel):
        self.asked.append(("file", rel))
        if rel in self.broken or rel not in self.fd:
            raise FileNotFoundError(rel)
        return self.fd[rel]

    def private_key(self, now):
        self.asked.append(("private", "key"))
        if "private" in self.broken:
            raise urllib.error.URLError("down")
        if self.pk is not None:
            return self.pk
        return {"ok": True, "why": "works", "expires": now + timedelta(days=200), "days_left": 200, "raw_at": now}


def fixtures(now):
    ms = int(now.timestamp() * 1000)
    iso = lambda d: d.strftime("%Y-%m-%dT%H:%M:%SZ")   # noqa: E731
    h = lambda n: now - timedelta(hours=n)              # noqa: E731
    runs = {"workflow_runs": [
        {"id": 11, "name": "Fetch Grain Bids", "workflow_id": 101, "created_at": iso(h(3))},
        {"id": 12, "name": "Fetch Grain Bids", "workflow_id": 101, "created_at": iso(h(1))},
        {"id": 13, "name": "Fetch Grain Bids", "workflow_id": 101, "created_at": iso(h(9))},
        {"id": 21, "name": "The wire", "workflow_id": 202, "created_at": iso(h(5))}]}
    gh = {
        "/repos/dnilgis/agsist/actions/runs?status=failure": runs,
        "/repos/dnilgis/agsist/actions/workflows/101/runs": {"workflow_runs": [{"conclusion": "failure"}]},
        "/repos/dnilgis/agsist/actions/workflows/202/runs": {"workflow_runs": [{"conclusion": "success"}]},
        "/repos/dnilgis/agsist/actions/runs/12/jobs": {"jobs": [{"id": 9012, "conclusion": "failure",
                                                                 "steps": [{"name": "Fetch", "conclusion": "failure"}]}]},
        "/repos/dnilgis/agsist/check-runs/9012/annotations": [
            {"annotation_level": "failure", "message": "Process completed with exit code 1."},
            {"annotation_level": "failure", "message": "barchart answered 429 for jane@farm.com's   ZIP"}],
        "/repos/dnilgis/agsist/actions/runs/21/jobs": {"jobs": [{"id": 9021, "conclusion": "failure",
                                                                 "steps": [{"name": "Build the wire", "conclusion": "failure"}]}]},
        "/repos/dnilgis/agsist/check-runs/9021/annotations": [],
        "/repos/dnilgis/agsist/pages/builds/latest": {"status": "built", "updated_at": iso(h(0.3))},
        "/repos/dnilgis/agsist/commits/main": {"commit": {"committer": {"date": iso(h(0.1))}}},
        "/repos/dnilgis/bids/actions/runs?status=failure": {"workflow_runs": []},
    }
    files = {
        "private/data/cron-health.json": json.dumps({"generated_at": iso(h(1)), "late": ["prf.yml", "county-rain.yml"], "late_critical": [],
                                             "workflows": [{"workflow": "published-size", "status": "ok", "total_mb": 736.2,
                                                            "warn_mb": 850, "fail_mb": 900}]}),
        "data/prices.json": json.dumps({"fetched": iso(h(0.2))}),
        "data/bids.json": json.dumps({"fetched": iso(h(0.25))}),
        "data/daily.json": json.dumps({"generated_at": iso(h(1))}),
        "data/audience.json": json.dumps({
            "ranges": [{"id": "7d", "end": "2026-10-11"}], "totals": {"7d": {"users": 1418, "views": 3259}},
            "pages": {"28d": [{"path": "/cash-bids", "views": 2237}, {"path": "/", "views": 1739}, {"path": "/markets", "views": 360},
                              {"path": "/hail-map", "views": 300}]},
            "series": {"days": [{"d": "2026-10-10", "users": 197}, {"d": "2026-10-11", "users": 181}, {"d": "2026-10-12", "users": None}]},
            "email": {"subscribers": 139, "asOf": "2026-10-13"}}),
        "TODO-SIG.md": "# To-dos\n\n- [ ] Test Stripe with a $19 purchase and refund it\n- [x] Done thing\n* [ ] Join Something Special from Wisconsin\nnot a task\n",
    }
    subs = [{"email": "a%d@farm.com" % i, "ts": ms - i * 3600 * 1000 * 20} for i in range(12)]
    worker = {
        "count": {"ok": True, "daily": 141, "alerts": 12, "ewatch": 7, "pwatch": 3, "watch": 4, "secret": True,
                  "by_source": {"hero": 100}, "notices": {"rain-gauge": 9, "rent:wi": 2}},
        "list?format=json": subs,
        "form-list": [
            {"kind": "rain-print-order", "ts": ms - 3600 * 1000, "name": "Jane Olson", "email": "jane@farm.com", "address": "12 Main St"},
            {"kind": "rain-print-order", "ts": ms - 2 * 3600 * 1000, "name": "Bo", "email": "bo@farm.com", "gift_card": "RP-1"},
            {"kind": "claim", "ts": ms - 40 * 3600 * 1000, "email": "al@chetek.coop", "elevator": "Chetek Co-op"},
            {"kind": "prf-sponsor", "ts": ms - 400 * 24 * 3600 * 1000, "email": "old@x.com"}],
        "notice-list?topic=rain-gauge": [{"email": "gauge1@y.org", "topic": "rain-gauge", "ts": ms - 600},
                                         {"email": "gauge2@y.org", "topic": "rain-gauge", "ts": ms - 600}],
        "sponsor-apps": [{"id": "s1", "ts": ms - 5000, "status": "pending", "email": "boss@seed.com", "company": "Apex Seed"}],
        "elev/admin/requests": {"ok": True, "requests": [{"status": "pending", "email": "pat@x.com", "name": "Pat Doe", "phone": "715-555-0100", "elevator": "Sand Creek Grain", "town": "Sand Creek", "state": "WI"}, {"status": "created", "elevator": "Done Co-op", "town": "Elsewhere", "state": "IA"}]},
    }
    urls = {BIDS_INDEX: {"generated": iso(h(0.4)), "counts": {"total": 2038, "live": 1900, "refused": 63, "broken": 30},
                         "sources": [{"email": "office@coop.com"}]}}
    return gh, worker, urls, files


def selftest():
    fails = []

    def ck(name, ok, detail=""):
        print(("  ok   " if ok else "  FAIL ") + name + ("" if ok else "  -- %s" % (detail,)))
        if not ok:
            fails.append(name)

    # Wed Oct 14 2026, 6:45 am CDT.
    now = datetime(2026, 10, 14, 11, 45, tzinfo=UTC)
    gh, worker, urls, files = fixtures(now)
    snap = {"2026-10-13": {"daily": 139, "alerts": 12}, "2026-10-07": {"daily": 130}, "2026-09-01": {"daily": 1}}
    src = Fake(gh, worker, urls, files)
    sent = []
    code, log = run(src, now, False, sent.append, "sig@x.com", snap)
    m = sent[0] if sent else None
    t = m.get_body(("plain",)).get_content() if m else ""
    h = m.get_body(("html",)).get_content() if m else ""
    print("the whole report from fixtures")
    ck("sends one email, exit 0", code == 0 and len(sent) == 1, log)
    ck("subject counts what needs Sig", m["Subject"] == "AGSIST morning, Wed Oct 14: 4 things need you", m["Subject"])
    ck("sections in order", [x for x in ("Needs you", "Site health, agsist", "Site health, bids", "Signups", "Orders and requests",
                                         "Traffic", "To-dos") if x in t] == ["Needs you", "Site health, agsist", "Site health, bids",
                                                                             "Signups", "Orders and requests", "Traffic", "To-dos"]
       and t.index("Needs you") < t.index("Site health, agsist") < t.index("To-dos"), t)

    print("\nneeds you")
    ck("a job still failing is red; one that passed since is not",
       "- agsist job still failing: Fetch Grain Bids (3 times in 24 h)" in t and "still failing: The wire" not in t, t)
    ck("orders waiting are red, by kind",
       "- Came in over the last 24 hours, waiting on you: 1 Rain Print order request, 1 gift card redemption." in t, t)
    ck("a pending sponsor application is red", "- 1 sponsor application waiting for your yes or no." in t, t)
    ck("a pending elevator listing request is red", "- 1 elevator listing request still pending on elev-admin" in t, t)
    ck("no red when nothing is wrong", "Nothing red" not in t)

    print("\nsite health, agsist")
    ck("failed runs collapsed, most first, with the error line",
       "- Fetch Grain Bids: failed 3 times, last 5:45 am; still failing. barchart answered 429 for [address]'s ZIP" in t, t)
    ck("the exit-code annotation is skipped; no message falls back to the step",
       "- The wire: failed once, last 1:45 am; passed since. step failed: Build the wire" in t, t)
    ck("late jobs and the published size", "Late, not critical: prf.yml, county-rain.yml." in t and
       "Published size: 736 MB of the 1,024 MB Pages limit (warns at 850, red at 900)." in t, t)
    ck("Pages deploy", "Last Pages deploy: built, 6:27 am." in t, t)
    ck("freshness", "Prices: live, updated 12 min ago." in t and "Cash bids: live, updated 15 min ago." in t
       and "Daily briefing: today's is out, published 5:45 am." in t, t)

    print("\nsite health, bids")
    ck("no failures, the reader summary", "No failed runs in the last 24 hours." in t.split("Site health, bids")[1] and
       "Elevator boards: 1,900 of 2,038 live (63 refused, 30 broken), last poll 6:21 am." in t, t)

    print("\nsignups")
    ck("change vs yesterday and 7 days, joins",
       "Daily briefing: 141 (+2 since yesterday, +11 vs 7 days ago). Joined: 2 in 24 h, 9 in 7 days." in t, t)
    ck("other lists, with change where there is a count to compare", "Hail alerts: 12 (+0 since yesterday)." in t and
       "Elevator watch and bid alerts: 7." in t and "Rain gauge waitlist: 9." in t, t)
    ck("today's counts are kept for tomorrow, old days dropped, counts only",
       snap.get("2026-10-14") == {"daily": 141, "alerts": 12, "ewatch": 7, "pwatch": 3, "watch": 4, "rain-gauge": 9}
       and "@" not in json.dumps(snap), snap)
    big = {("2026-09-%02d" % d): {"daily": d} for d in range(1, 30)}
    sec_signups(Fake(gh, worker, urls, files), now, Report(), big)
    ck("the counts file keeps %d days" % SNAP_DAYS, len(big) == SNAP_DAYS and "2026-10-14" in big, sorted(big))

    print("\norders and requests")
    ck("last 24 hours by kind", "Last 24 hours: 1 Rain Print order request, 1 gift card redemption, 0 business quote requests, "
       "2 rain gauge waitlist, 0 elevator listing, 0 PRF sponsor, 0 elevator claims, 0 sponsor requests, "
       "0 Parcel Report waitlist, 1 sponsor application." in t, t)
    ck("month to date counts this month only", "Month to date: 1 Rain Print order request, 1 gift card redemption, "
       "0 business quote requests, 2 rain gauge waitlist, 0 elevator listing, 0 PRF sponsor, 1 elevator claim," in t, t)
    ck("pending elevator requests", "Elevator listing requests still pending on elev-admin: 1." in t, t)
    ck("a pending request is named by elevator and town, never the contact", "  - Sand Creek Grain, Sand Creek, WI" in t
       and "Pat Doe" not in t and "715-555-0100" not in t and "Done Co-op" not in t, t)
    ck("no Stripe key: the dashboard line", "Stripe totals: see the dashboard. Paid Rain Prints are under Orders below." in t, t)

    print("\ntraffic and to-dos")
    ck("latest day, 7 days, top 3 pages", "Latest day in the analytics, Sun Oct 11: 181 users" in t and
       "7 days to 2026-10-11: 1,418 users, 3,259 views." in t and "Top pages, 28 days: /cash-bids 2,237, / 1,739, /markets 360." in t
       and "/hail-map" not in t, t)
    ck("only unchecked to-dos", "- Test Stripe with a $19 purchase and refund it" in t and "- Join Something Special from Wisconsin" in t
       and "Done thing" not in t and "not a task" not in t, t)
    ck("footer says how to check one off", TODO_EDIT in t and ('href="%s"' % TODO_EDIT) in h, t[-400:])

    print("\nno addresses")
    addrs = ["jane@farm.com", "bo@farm.com", "al@chetek.coop", "gauge1@y.org", "gauge2@y.org", "boss@seed.com", "pat@x.com", "office@coop.com", "a1@farm.com"]
    ck("no '@' in the plain body", "@" not in t, [ln for ln in t.splitlines() if "@" in ln])
    ck("no '@' in the html body", "@" not in h, re.findall(r".{30}@.{30}", h))
    ck("no '@' in the log", not any("@" in x for x in log), log)
    ck("no names or message text from the rows", all(x not in t + h for x in ("Jane", "Olson", "12 Main", "Apex", "Chetek Co-op")), t)
    ck("addresses only in From and To", m["To"] == "sig@x.com" and not any(a in m.as_string() for a in addrs))
    code, dlog = run(Fake(gh, worker, urls, files), now, True, sent.append, "sig@x.com", {})
    ck("dry run prints the email, sends nothing, no '@'", code == 0 and len(sent) == 1 and "DRY RUN: nothing sent. The email:" in dlog
       and any(x.startswith("Subject: AGSIST morning") for x in dlog) and not any("@" in x for x in dlog), dlog)
    ck("the scrubber", scrub("mail a.b+c@x.co now, or @handle") == "mail [address] now, or  at handle")

    print("\nfail soft")
    code, flog = run(Fake(broken={"gh", "worker", "url"}), now, False, sent.append, "s", {})
    ft = sent[-1].get_body(("plain",)).get_content()
    ck("every source down: still sends, exit 0", code == 0 and len(sent) == 2, flog)
    ck("each down source is one line", all(x in ft for x in (
        "Failed runs: could not be read (HTTP 500).", "Job health file: could not be read (FileNotFoundError).",
        "Last Pages deploy: could not be read (HTTP 500).", "Prices: could not be read (FileNotFoundError).",
        "Reader summary: could not be read (HTTP 500).", "Worker counts: could not be read (HTTP 500).",
        "data/audience.json: could not be read (FileNotFoundError).",
        "Could not read: forms (HTTP 500), rain gauge list (HTTP 500), sponsor applications (HTTP 500). Those count as 0 below.",
        "Elevator listing requests: could not be read (HTTP 500).", "TODO-SIG.md: could not be read (FileNotFoundError).")), ft)
    ck("no token in the email or log", "SECRET" not in ft and not any("SECRET" in x for x in flog))
    w2 = dict(worker)
    del w2["count"]
    s2 = {}
    sent.clear()
    run(Fake(gh, w2, urls, files), now, False, sent.append, "s", s2)
    t2 = sent[0].get_body(("plain",)).get_content()
    ck("no /count: audience.json fallback plus joins, nothing kept",
       "Daily briefing: 139 (as of 2026-10-13, from data/audience.json)." in t2 and "Joined the daily briefing: 2 in 24 h, 9 in 7 days." in t2
       and s2 == {}, t2)
    ck("first morning: says when the change starts", "Change vs yesterday starts once this report has run two mornings in a row." in
       (sent.clear() or run(Fake(gh, worker, urls, files), now, False, sent.append, "s", {}) and
        sent[0].get_body(("plain",)).get_content()), "")

    def boom(m):
        raise smtplib.SMTPException("x")
    code, blog = run(Fake(gh, worker, urls, files), now, False, boom, "s", {})
    ck("the send fails: exit 1", code == 1 and "send failed (SMTPException)" in blog, blog)

    print("\nbids token")
    g3 = dict(gh)
    g3["/repos/dnilgis/bids/actions/runs?status=failure"] = urllib.error.HTTPError("u", 403, "no", {}, None)
    rep = Report()
    sec_bids(Fake(g3, worker, urls, files), now, rep)
    ck("bids runs refused, no token: one line naming the secret",
       any("bids: not checked (no token). Add a BIDS_READ_TOKEN secret" in x for x in rep.sections[0][1]), rep.sections)
    rep = Report()
    sec_bids(Fake(g3, worker, urls, files, bids_token="b"), now, rep)
    ck("with a token, a refusal is an error line", "Failed runs: could not be read (HTTP 403)." in rep.sections[0][1], rep.sections)
    u3 = {BIDS_INDEX: {"generated": "2026-10-14T05:00:00Z", "counts": {"total": 10, "live": 9}}}
    rep = Report()
    sec_bids(Fake(gh, worker, u3, files), now, rep)
    ck("bids not polled for hours is red", rep.needs == ["bids has not polled since 12:00 am."], rep.needs)

    print("\nred lines")
    f4 = dict(files)
    f4["private/data/cron-health.json"] = json.dumps({"generated_at": "2026-10-13T20:00:00Z", "late": ["daily.yml"], "late_critical": ["daily.yml"],
                                              "workflows": [{"workflow": "published-size", "status": "warn", "total_mb": 870.4,
                                                             "warn_mb": 850, "fail_mb": 900}]})
    f4["data/prices.json"] = json.dumps({"fetched": "2026-10-14T05:00:00Z"})
    f4["data/bids.json"] = json.dumps({"fetched": "2026-10-14T08:00:00Z"})
    f4["data/daily.json"] = json.dumps({"generated_at": "2026-10-13T10:47:39+00:00"})
    g4 = dict(gh)
    g4["/repos/dnilgis/agsist/pages/builds/latest"] = {"status": "building", "updated_at": "2026-10-14T10:00:00Z"}
    rep = Report()
    sec_agsist(Fake(g4, worker, urls, f4), now, rep)
    want = ["Late critical job: daily.yml", "Site size: 870 MB published, past the 850 MB warning",
            "GitHub Pages deploy stuck: building since 5:00 am.", "Prices are stale: last update 7 h ago",
            "Cash bids are stale: last update 4 h ago.", "Today's daily briefing is not out yet (last one Oct 13, 5:47 am)."]
    ck("late critical, size, stuck deploy, stale feeds, missing briefing", all(any(w in x for x in rep.needs) for w in want), rep.needs)

    print("\nprivate repo key")
    fk = Fake(gh, worker, urls, files)
    rp = Report()
    sec_agsist(fk, now, rp)
    body = "\n".join(rp.sections[0][1])
    ck("a working key is one line, nothing red", "Private repo key works, expires May 2, 2027." in body
       and not any("Private repo" in x for x in rp.needs), body)
    ck("the job health file is read from the private copy", ("file", "private/data/cron-health.json") in fk.asked, fk.asked)
    fk = Fake(gh, worker, urls, files)
    fk.pk = {"ok": True, "why": "works", "expires": datetime(2026, 10, 27, 12, tzinfo=UTC), "days_left": 12.9}
    rp = Report()
    sec_agsist(fk, now, rp)
    ck("under 14 days: 'Private repo key expires <date>', red", any(x.startswith("Private repo key expires Oct 27, 2026.") for x in rp.needs)
       and "Private repo key expires Oct 27, 2026." in rp.sections[0][1], rp.needs)
    fk = Fake(gh, worker, urls, files)
    fk.pk = {"ok": True, "why": "works", "expires": datetime(2026, 11, 3, 12, tzinfo=UTC), "days_left": 20.0}
    rp = Report()
    sec_agsist(fk, now, rp)
    ck("20 days left is not red yet", not any("Private repo" in x for x in rp.needs), rp.needs)
    fk = Fake(gh, worker, urls, files)
    fk.pk = {"ok": False, "why": "Private repo key failing: HTTP 401 (expired or revoked)", "expires": None, "days_left": None}
    rp = Report()
    sec_agsist(fk, now, rp)
    ck("a failing key: 'Private repo key failing', red", any(x.startswith("Private repo key failing: HTTP 401") for x in rp.needs), rp.needs)
    rp = Report()
    sec_agsist(Fake(gh, worker, urls, files, broken=("private",)), now, rp)
    ck("a check that cannot run is one line, the section still builds",
       any(x.startswith("Private repo key: could not be checked") for x in rp.sections[0][1]), rp.sections[0][1])
    import cron_health as CH
    ck("no token in the job: 'not given', never red",
       CH.private_key_check(now, "")["ok"] is None and PRIVATE_KEY_WARN_DAYS == CH.KEY_WARN_DAYS)
    ck("late critical is not repeated as not critical", "Late, not critical: none." in rep.sections[0][1], rep.sections[0][1])
    ck("an old health file is said", any("The job health file is 16 h old" in x for x in rep.sections[0][1]), rep.sections[0][1])
    g5 = dict(gh)
    g5["/repos/dnilgis/agsist/pages/builds/latest"] = {"status": "errored", "updated_at": "2026-10-14T10:00:00Z"}
    rep = Report()
    sec_agsist(Fake(g5, worker, urls, files), now, rep)
    ck("a failed deploy is red", any("last GitHub Pages deploy failed" in x for x in rep.needs), rep.needs)
    g6 = dict(gh)
    g6["/repos/dnilgis/agsist/pages/builds/latest"] = {"status": "built", "updated_at": "2026-10-14T06:00:00Z"}
    rep = Report()
    sec_agsist(Fake(g6, worker, urls, files), now, rep)
    ck("no deploy for hours while main moves is red", any("has not deployed since 1:00 am" in x for x in rep.needs), rep.needs)
    sat = datetime(2026, 10, 17, 11, 45, tzinfo=UTC)
    out = freshness(Fake(files=f4), sat, Report())
    ck("prices on a Saturday morning: closed, not red", any(x.startswith("Prices: markets closed") for x in out), out)
    ck("grain hours", grains_open(datetime(2026, 10, 14, 6, 40, tzinfo=CT)) and not grains_open(datetime(2026, 10, 14, 8, 0, tzinfo=CT))
       and not grains_open(datetime(2026, 10, 18, 12, 0, tzinfo=CT)) and grains_open(datetime(2026, 10, 18, 19, 5, tzinfo=CT))
       and not grains_open(datetime(2026, 10, 16, 14, 0, tzinfo=CT)))

    print("\nStripe")
    ch = {"data": [{"id": "c1", "paid": True, "status": "succeeded", "amount": 1900, "amount_refunded": 0, "created": int(now.timestamp()) - 600,
                    "billing_details": {"email": "buyer@x.com", "name": "Buyer"}},
                   {"id": "c2", "paid": True, "status": "succeeded", "amount": 4900, "amount_refunded": 4900, "refunded": True,
                    "created": int(now.timestamp()) - 5 * 86400},
                   {"id": "c3", "paid": False, "status": "failed", "amount": 1900, "created": int(now.timestamp()) - 60}], "has_more": False}
    s = stripe_line(Fake(stripe=ch, stripe_key="rk"), now)
    ck("paid counts and dollars, net of refunds", s == "Stripe: last 24 hours 1 paid, $19.00; month to date 2 paid, $19.00; 1 refunded (net of refunds).", s)
    ck("no buyer details", "@" not in s and "Buyer" not in s)
    ck("a bad key is one line", stripe_line(Fake(stripe=ch, stripe_key="rk", broken={"stripe"}), now) == "Stripe: could not be read (HTTP 401).")

    print("\nRain Print orders from Stripe")
    t0 = int(now.timestamp())
    ses = {"data": [
        {"id": "cs_1", "created": t0 - 3600, "status": "complete", "payment_status": "paid", "amount_total": 8900,
         "client_reference_id": "MnxDaGV0ZWssIFdJfDQ3MTY2NyAyfDIwMjV8", "customer_details": {"email": "buyer@x.com", "name": "Ray Buyer",
         "address": {"line1": "123 Farm Rd", "city": "Chetek"}}, "shipping_details": {"name": "Ray Buyer", "address": {"line1": "123 Farm Rd"}}},
        {"id": "cs_2", "created": t0 - 7200, "status": "complete", "payment_status": "paid", "amount_total": 1900, "client_reference_id": "RPS-K7Q2M",
         "customer_details": {"email": "kate@x.com"}},
        {"id": "cs_3", "created": t0 - 600, "status": "complete", "payment_status": "unpaid", "amount_total": 4500, "client_reference_id": "RPS-ZZZZZ"},
        {"id": "cs_4", "created": t0 - 900, "status": "complete", "payment_status": "paid", "amount_total": 4500, "client_reference_id": None},
        {"id": "cs_5", "created": t0 - 300, "status": "complete", "payment_status": "paid", "amount_subtotal": 4500, "amount_total": 3500, "client_reference_id": "RPS-K7Q3M"},
        {"id": "cs_6", "created": t0 - 200, "status": "complete", "payment_status": "paid", "amount_subtotal": 8900, "amount_total": 7900, "client_reference_id": "RPS-K7Q4M"}],
        "has_more": False}
    f = Fake(stripe=ses, stripe_key="rk")
    got = rain_print_paid(f, now)
    # cs_4 (paid, no reference) was expected absent until 2026-10-19: a payment
    # link opened bare is still money paid, so it now gets its own line rather
    # than being skipped (Rain Print audit); NEXTPRINT orders ($35, $79) are
    # named from the subtotal
    ck("one line per paid Rain Print, oldest first", got == [
        "Rain Print paid: Digital file, $19.00, ref RPS-K7Q2M, make it at https://agsist.com/rain-print?d=RPS-K7Q2M&maker=1",
        "Rain Print paid: Framed, $89.00, ref MnxDaGV0ZWssIFdJfDQ3MTY2NyAyfDIwMjV8, make it at https://agsist.com/rain-print?d=MnxDaGV0ZWssIFdJfDQ3MTY2NyAyfDIwMjV8&maker=1",
        "Rain Print paid: Print, $45.00, NO design reference: find the buyer in Stripe (session cs_4) and ask for the design",
        "Rain Print paid: Print, $35.00 ($45.00 less $10.00 off), ref RPS-K7Q3M, make it at https://agsist.com/rain-print?d=RPS-K7Q3M&maker=1",
        "Rain Print paid: Framed, $79.00 ($89.00 less $10.00 off), ref RPS-K7Q4M, make it at https://agsist.com/rain-print?d=RPS-K7Q4M&maker=1"], got)
    ck("unpaid is never listed", not any("RPS-ZZZZZ" in x for x in got), got)
    ck("asked of checkout/sessions", ("stripe", "checkout/sessions") in f.asked, f.asked)
    ck("no buyer email, name or address", not any(("@" in x or "Buyer" in x or "Farm Rd" in x or "kate" in x) for x in got), got)
    ck("none paid is one line", rain_print_paid(Fake(stripe={"data": [], "has_more": False}, stripe_key="rk"), now) == ["Rain Print orders, last 48 hours: none paid."])
    ck("no key: nothing", rain_print_paid(Fake(stripe=ses), now) == [])
    ck("a bad key is one line", rain_print_paid(Fake(stripe=ses, stripe_key="rk", broken={"stripe"}), now) == ["Rain Print orders: could not be read from Stripe (HTTP 401)."])

    print("\nRain Print order records (the subs worker's /rp-order/list)")
    # The real case, Oct 20: Sig's $19 digital file, Stripe's payment page showed no design.
    # Sig's test design: Chetek WI, Staircase, "Gustum Farm", Apr 1 "Moved in" (the year is only for the test).
    sig_url = ("https://agsist.com/rain-print?place=Chetek%2C+WI&year=2025&station=471667+2&layout=staircase&palette=paper"
               "&size=12x18&style=r1&name=Gustum+Farm&m1=2025-04-01+Moved+in")
    sig_ref = "MnxDaGV0ZWssIFdJfDQ3MTY2NyAyfDIwMjV8c3AwYWF8R3VzdHVtIEZhcm18Mml8TW92ZWQgaW4"
    ms = int(now.timestamp() * 1000)

    def orec(ref, product, ts, **kw):
        o = {"key": "rpo:%d:00000000" % ts, "ts": ts, "at": datetime.fromtimestamp(ts / 1000, UTC).strftime("%Y-%m-%dT%H:%M:%S.000Z"),
             "ref": ref, "product": product, "price": {"digital": 19, "print12x18": 45, "framed12x18": 89}[product],
             "design_url": sig_url, "place": "Chetek, WI", "year": 2025, "style": "r1", "name": "Gustum Farm",
             "markers": "Apr 1 Moved in", "dedication": "", "gift": False, "status": "pay pressed", "paid": None,
             "serial": None, "serial_next": None, "fulfill_url": sig_url + "&maker=1"}
        o.update(kw)
        return o
    paid_list = {"ok": True, "days": 2, "stripe": "ok", "serial_last": 4, "orders": [
        orec("GIFT-RPS-K7Q2M", "print12x18", ms - 600000),
        orec("RPS-K7Q2M", "framed12x18", ms - 3600000, style="r2", status="paid", paid={"amount": 79, "subtotal": 89, "at": "x", "session": "cs_live_rps"},
             approved={"at": "2026-10-14T16:00:00.000Z"},
             serial=4, fulfill_url=sig_url + "&maker=1&serial=4"),
        orec(sig_ref, "digital", ms - 7200000, status="paid", paid={"amount": 19, "subtotal": 19, "at": "x", "session": "cs_live_sig19"})]}
    rep = Report()
    f = Fake(worker={"rp-order/list": paid_list})
    sec_rp_orders(f, now, rep)
    title, rl = rep.sections[-1]
    ck("the Orders section asks the worker for 48 hours", title == "Orders" and ("worker", "rp-order/list?days=2") in f.asked, f.asked)
    ck("a count line, then one line each, newest first", rl[0] == "Rain Print, last 48 hours: 3 presses of Pay, 2 paid." and len(rl) == 4, rl)
    ck("the $19 file: paid, the maker link, no serial",
       rl[3] == "  - Digital file, Chetek, WI 2025 Staircase, paid $19.00, waiting for approval: open to fulfill " + sig_url + "&maker=1", rl)
    ck("a paid framed print: its serial in the line and the link",
       rl[2] == "  - Framed, Chetek, WI 2025 Roots, paid $79.00, approved 11:00 am, serial 4: open to fulfill " + sig_url + "&maker=1&serial=4", rl)
    ck("a press with no payment says so", rl[1].startswith("  - Print, Chetek, WI 2025 Staircase, pay pressed ") and "payment not confirmed" in rl[1] and "serial" not in rl[1], rl)
    ck("nothing about the buyer", not any("@" in x for x in rl), rl)
    # without a key anywhere: pay pressed, and a print's suggested serial
    nokey = {"ok": True, "days": 2, "stripe": "no key", "serial_last": 0, "orders": [
        orec("RPS-K7Q2M", "print12x18", ms - 60000, serial_next=1, fulfill_url=sig_url + "&maker=1&serial=1"),
        orec(sig_ref, "digital", ms - 120000)]}
    rep = Report()
    sec_rp_orders(Fake(worker={"rp-order/list": nokey}), now, rep)
    rl = rep.sections[-1][1]
    ck("no key: says payments are not checked", any("not checked (Stripe on the worker: no key)" in x and "by time and product" in x for x in rl), rl)
    ck("no key: a print gets the next serial, marked as a suggestion",
       any(x.startswith("  - Print, ") and "pay pressed" in x and "serial 1 if it is the next one you make" in x and x.endswith("&maker=1&serial=1") for x in rl), rl)
    ck("no key: the file still has its maker link", any(x.startswith("  - Digital file, ") and x.endswith(sig_url + "&maker=1") for x in rl), rl)
    rep = Report()
    sec_rp_orders(Fake(worker={"rp-order/list": {"ok": True, "stripe": "ok", "orders": []}}), now, rep)
    ov = orec(sig_ref, "print12x18", ms, status="paid", paid={"amount": 45, "session": "cs_x"}, approval_overdue=True, serial=5)
    ck("no answer in 3 business days is said", "no answer on the proof in 3 business days: follow up" in rp_order_line(ov, now), rp_order_line(ov, now))
    ck("nobody pressed Pay: one line", rep.sections[-1][1] == ["Rain Print, last 48 hours: no one pressed Pay."], rep.sections)
    rep = Report()
    sec_rp_orders(Fake(worker={"rp-order/list": urllib.error.HTTPError("https://x/", 500, "x", {}, None)}), now, rep)
    ck("the worker down: one line", rep.sections[-1] == ("Orders", ["Rain Print order records: could not be read (HTTP 500)."]), rep.sections)
    bad = orec(sig_ref, "digital", ms, fulfill_url="https://evil.example/x")
    ck("a link that is not agsist.com/rain-print is left out", "evil" not in rp_order_line(bad, now) and "open to fulfill" not in rp_order_line(bad, now))

    print("\nthe 6:40 am gate")
    ck("CDT: 11:40 UTC is 6:40 am", chicago_tick_ok(datetime(2026, 10, 14, 11, 50, tzinfo=UTC)))
    ck("CDT: the 12:40 UTC tick (7:40 am) does not go", not chicago_tick_ok(datetime(2026, 10, 14, 12, 50, tzinfo=UTC)))
    ck("CST: 12:40 UTC is 6:40 am", chicago_tick_ok(datetime(2026, 12, 14, 12, 50, tzinfo=UTC)))
    ck("CST: the 11:40 UTC tick (5:40 am) does not go", not chicago_tick_ok(datetime(2026, 12, 14, 11, 50, tzinfo=UTC)))

    print("\ncounts file")
    import tempfile
    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, "x", "counts.json")
        save_snap(p, {"2026-10-14": {"daily": 141}})
        ck("saved and read back", load_snap(p) == {"2026-10-14": {"daily": 141}})
        with open(p, "w") as f:
            f.write('{"2026-10-14": {"daily": "jane@x.com", "alerts": 3}, "junk": 1}')
        ck("only dated integer counts are read", load_snap(p) == {"2026-10-14": {"alerts": 3}}, load_snap(p))
        ck("a missing file is empty", load_snap(os.path.join(d, "none.json")) == {})

    # returns (audience.json) and the Rain Print funnel (GA4, live, never a file), two lines at most
    aud = {"returns": {"through": "2026-10-17", "cohorts": {"weeks": [
               {"week": "2026-09-14", "end": "2026-09-20", "newReaders": 40, "returned": 6, "share": None, "withheld": "x"},
               {"week": "2026-09-28", "end": "2026-10-04", "newReaders": 1150, "returned": 207, "share": 0.18, "withheld": None}]}},
           "servers": {"towns": [{"region": "Virginia", "city": "Ashburn"}]},
           "sources": {"returns": {"ok": False}}}
    FN = {"through": "2026-10-17", "last7": {"start": "2026-10-11", "end": "2026-10-17",
          "counts": {"rain_print_draw": 1240, "email_signup": 3, "purchase": 1, "rain_print_order": 2},
          "people": {"rain_print_draw": 310}}}
    rl = returns_lines(aud, FN)
    ck("returns: the newest whole cohort, share with its n; a stale pull says so", rl[0] ==
       "Came back within 14 days: 18% of 1,150 new readers first seen Sep 28-Oct 4 (GA4, cookie-based estimate)"
       " (last pulled through 2026-10-17).", rl)
    ck("funnel: draws, signups, paid, order forms, 7 days", rl[1] ==
       "Rain Print, 7 days to Oct 17: 1,240 draws (310 people), 3 email signups, 1 paid back from Stripe, "
       "2 order forms sent (GA4 events).", rl)
    aud["sources"]["returns"]["ok"] = True
    aud["returns"]["cohorts"]["weeks"].reverse()
    aud["returns"]["cohorts"]["weeks"][-1]["withheld"] = "40 new readers that week, under the 100 needed to print a share"
    rl = returns_lines(aud)
    ck("a withheld cohort prints its reason and n, never a share; no funnel, no funnel line",
       rl == ["Came back within 14 days, readers first seen Sep 14-20: withheld, 40 new readers that week, "
              "under the 100 needed to print a share."], rl)
    ck("no returns section: no lines", returns_lines({}) == [])

    def traffic(f):
        r = Report()
        sec_traffic(f, now, r)
        return [ln for t_, ls in r.sections for ln in ls]
    f = Fake(files={"data/audience.json": json.dumps(aud)})
    f.funnel = FN
    tl = traffic(f)
    ck("the email asks GA4 for the funnel with audience.json's server towns",
       ("ga4-funnel", ("Ashburn",)) in f.asked and "1,240 draws (310 people)" in str(tl), (f.asked, tl))
    f = Fake(files={"data/audience.json": json.dumps(aud)})
    f.dry = True
    tl = traffic(f)
    ck("a dry run (public Actions log) never asks for or prints the funnel",
       not any(k == "ga4-funnel" for k, _ in f.asked) and "left out of a dry run" in str(tl) and "draws" not in str(tl), tl)
    tl = traffic(Fake(files={"data/audience.json": json.dumps(aud)}))
    ck("no GA4 secrets: one line says so", "Rain Print funnel: GA4 not set up for this job." in str(tl), tl)
    tl = traffic(Fake(files={"data/audience.json": json.dumps(aud)}, broken={"ga4"}))
    ck("GA4 refusing: one line, the rest still builds", "Rain Print funnel: could not be read (HTTP 403)." in str(tl)
       and "Came back within 14 days" in str(tl), tl)

    # Promo clicks by page, gauge signups, email sessions by source (2026-10-19): live, never a file.
    PC = {"through": "2026-10-17", "windows": {
        "7d": {"start": "2026-10-11", "end": "2026-10-17", "gaugeSignups": 2,
               "promos": {"rain_print_promo_click": {"total": 8, "pages": [{"page": "/", "count": 5}, {"page": "/cash-bids", "count": 3}]},
                          "rain_gauge_promo_click": {"total": 0, "pages": []}},
               "email": {"bySource": [{"source": "daily", "sessions": 6, "engaged": 5}, {"source": "report_email", "sessions": 3, "engaged": 1}],
                         "daily": [{"content": "button", "sessions": 4}, {"content": "rainprint", "sessions": 2}]}},
        "28d": {"start": "2026-09-20", "end": "2026-10-17", "gaugeSignups": 4,
                "promos": {"rain_print_promo_click": {"total": 20, "pages": []}, "rain_gauge_promo_click": {"total": 2, "pages": []}},
                "email": {"bySource": [{"source": "daily", "sessions": 9, "engaged": 6}], "daily": []}}}}
    pl = promo_lines(PC)
    ck("promo line: clicks by page, gauge signups, 7 days with 28 beside", pl[0] ==
       "Promo clicks, 7 days to Oct 17: Rain Print 8 (/ 5, /cash-bids 3) [28 days 20]; rain gauge 0 [28 days 2]. "
       "Gauge waitlist signups on /rain-gauge: 2 [28 days 4] (GA4 events).", pl)
    ck("email line: sessions by utm_source and the Daily by link", pl[1] ==
       "Email sessions, 7 days to Oct 17, by utm_source: daily 6, report_email 3; the Daily by link: button 4, rainprint 2 "
       "[28 days 9] (GA4).", pl)
    ck("no promo section: no lines", promo_lines(None) == [] and promo_lines({}) == [])
    f = Fake(files={"data/audience.json": json.dumps(aud)})
    f.funnel, f.promo = FN, PC
    tl = traffic(f)
    ck("the email asks GA4 for promo counts with the server towns and prints both lines",
       ("ga4-promo", ("Ashburn",)) in f.asked and pl[0] in tl and pl[1] in tl, (f.asked, tl))
    f = Fake(files={"data/audience.json": json.dumps(aud)})
    f.dry, f.promo = True, PC
    tl = traffic(f)
    ck("a dry run never asks for or prints promo counts",
       not any(k == "ga4-promo" for k, _ in f.asked) and "Promo clicks" not in str(tl) and "Email sessions" not in str(tl), tl)
    f = Fake(files={"data/audience.json": json.dumps(aud)}, broken={"ga4-promo"})
    f.funnel = FN
    tl = traffic(f)
    ck("promo counts failing: one line, the funnel still prints",
       "Promo clicks and email sessions: could not be read (HTTP 500)." in tl and "1,240 draws" in str(tl), tl)
    tl = traffic(Fake(files={"data/audience.json": json.dumps(aud)}))
    ck("no GA4: only the funnel's one line, not a second", "Promo clicks" not in str(tl), tl)

    print("\ntoday, from the real bids index of Oct 20 15:40 UTC (test/fixtures)")
    import gzip
    with gzip.open(os.path.join(ROOT, "test", "fixtures", "today-bids-index-2026-10-20.json.gz"), "rt", encoding="utf-8") as f:
        idx = json.load(f)
    tnow = parse_time(idx["generated"])
    w = dict(worker)
    w["sponsor-apps"] = [{"id": "s2", "status": "confirmed", "company": "Apex Seed", "email": "boss@seed.com", "phone": "715-555-0101"}]
    tsnap = {"2026-10-19": {"bids_current": 2030}}
    tf = Fake(gh, w, {BIDS_INDEX: idx, PASTE_STATUS: {"ok": True, "sites": {"newcoop": {"pastedAt": None}}}}, files)
    rp = Report()
    sec_today(tf, tnow, rp, tsnap)
    tl = today_lines(rp)
    ck("health: boards with a current price and the change since yesterday",
       tl[0] == "Boards with a current price: 2,046 of 2,281 (90%), +16 since yesterday." and tsnap["2026-10-20"] == {"bids_current": 2046}, tl)
    ck("NEW Cooperative first, its towns, its last good read, the Paste link",
       tl[2] == "- NEW Cooperative, Inc.: Blocked by a bot check. Feeds 66 boards in 66 Iowa towns. Last good read Oct 19, 10:30 AM CT. "
                "Paste: https://agsist.com/elev-admin.html?paste=newcoop#paste", tl)
    ck("then Frontier (refused, no paste reader) and Central United (bot check)",
       tl[3].startswith("- Frontier Cooperative") and "42 towns in Iowa, Nebraska" in tl[3] and tl[3].endswith("(no paste reader yet)")
       and tl[4].startswith("- Central United") and "16 Minnesota towns" in tl[4], tl[3:5])
    ck("small sites folded to one line", any(re.fullmatch(r"\d+ more sites with 1 or 2 boards on the Today page\.", x) for x in tl), tl)
    ck("others by name only", "1 listing request: Sand Creek Grain, Sand Creek WI." in tl and "1 sponsor application open: Apex Seed." in tl
       and not any(("@" in x or "555-01" in x or "Pat Doe" in x) for x in tl), tl)
    hh = today_html(rp)
    ck("the email block: a table, inline styles, no script, links to the Today page and the paste box",
       hh.startswith('<table role="presentation"') and "<script" not in hh and "<style" not in hh and TODAY_URL in hh
       and "elev-admin.html?paste=newcoop#paste" in hh and "FIRST" in hh and "@" not in hh, hh[:300])
    tsnap2 = {}
    sec_today(tf, tnow, Report(), tsnap2)
    sec_signups(Fake(gh, worker, urls, files), tnow, Report(), tsnap2)
    ck("the signup counts keep today's bids count beside them", tsnap2["2026-10-20"].get("bids_current") == 2046 and "daily" in tsnap2["2026-10-20"], tsnap2)
    sent = []
    run(Fake(gh, w, {BIDS_INDEX: idx}, files), tnow, False, sent.append, "s", {})
    tt = sent[0].get_body(("plain",)).get_content()
    ck("the email opens with Today, then Needs you", tt.index("Today") < tt.index("Needs you"), tt[:200])
    with open(os.path.join(os.environ.get("TODAY_EMAIL_OUT", os.devnull)), "w", encoding="utf-8") as f:
        f.write(sent[0].get_body(("html",)).get_content())

    print()
    if fails:
        print("%d FAILED: %s" % (len(fails), "; ".join(fails)))
        return 1
    print("morning_report: all checks pass")
    return 0


if __name__ == "__main__":
    sys.exit(main())
