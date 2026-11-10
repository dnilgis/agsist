#!/usr/bin/env python3
"""
report_live.py -- the report-day job: the graded USDA result on the page and in
the email within a minute of the release.

The job starts five minutes before the release (scripts/usda_dates.py has the
days), checks USDA every 10 seconds for up to 20 minutes, reads the print with
the existing readers (read_wasde_pdf.py for the PDF, fetch_wasde.py for the
NASS yields and the files), grades it with build_whats_priced_in.py and sends
the result to the site's worker. /usda-calendar, the homepage card and the
report-day email read that result first and fall back to the committed files.
The same files are then committed to the repo by the workflow.
.github/workflows/wasde-watch.yml stays as the backup.

    python3 scripts/report_live.py gate [--now 2026-12-10T16:40:00Z] [--mode live|rehearse --day YYYY-MM-DD]
        prints mode=live|rehearse|none and release=YYYY-MM-DD (GITHUB_OUTPUT too)
    python3 scripts/report_live.py key
        prepares this run's key for the result route (to REPORT_KEY_FILE)
    python3 scripts/report_live.py poll --release 2026-12-10 [--dry-run]
    python3 scripts/report_live.py wait-live --release 2026-12-10 [--test]
    python3 scripts/report_live.py watchdog --release 2026-12-10
    python3 scripts/report_live.py rehearse [--release 2026-11-10] [--fast] [--no-email] [--no-nass]
                                            [--worker URL] [--notify --for 2026-12-10]
        the whole path against last month's file, into the test record, with a
        dry-run email; prints one JSON line with pass/fail and the timings
    python3 scripts/report_live.py --selftest

The worker is REPORT_LIVE_URL (default the site's worker). Nothing here prints
a key, a reader or an address.
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import contextlib
import hashlib
import hmac
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
import usda_dates  # noqa: E402

CT = ZoneInfo("America/Chicago")
ET = ZoneInfo("America/New_York")
WORKER = "https://agsist-api.dnilgis.workers.dev"
ROUTE = "/report-live"
UA = {"User-Agent": "AGSIST-automation/1.0 (+https://agsist.com)"}

LEAD_MIN = 5            # the job starts checking this many minutes before the release
POLL_S = 10             # one check every 10 seconds
WINDOW_MIN = 20         # for up to 20 minutes after the release
WATCH_MIN = (3, 10)     # notices at release + 3 and release + 10 minutes when nothing came
SERVE_TARGET_S = 30     # file appears -> live value served, on the fixture
REHEARSE_FROM_UTC = 18  # the rehearsal tick is 19:17 UTC; the start ticks are 15:38 to 16:48

# The release time of each graded report, Eastern. Every one of them is noon ET
# (11:00 a.m. CT) today; a report at another hour goes here, and the selftest
# and test/report-live.test.mjs check the workflow's start ticks still cover it.
REPORT_TIME_ET = {"WASDE": (12, 0), "Crop Production": (12, 0), "Grain Stocks": (12, 0),
                  "Prospective Plantings": (12, 0), "Acreage": (12, 0)}
# Reports the readers grade on their own. The others need their figures typed in.
AUTO_READ = ("WASDE", "Crop Production")

# The files a run writes and the workflow commits.
DATA_FILES = ("data/analyst-estimates.json", "data/wpi-history.json", "data/wasde.json",
              "data/whats-priced-in.json")
# What the grader reads besides those (copied for a rehearsal, never written back).
READ_FILES = ("data/cot.json", "data/harvest-prices.json", "data/wpi-estimates.json")


# -- the calendar ---------------------------------------------------------------
def report_days(years=None):
    """Every day with a graded report on file, sorted."""
    days = set(usda_dates.WASDE_DATES) | set(usda_dates.CROP_PRODUCTION_DATES) | set(usda_dates.GRAIN_STOCKS_2026)
    days |= set(usda_dates.PROSPECTIVE_PLANTINGS_2026) | set(usda_dates.ACREAGE_2026)
    return sorted(d for d in days if years is None or d.year in years)


def reports_on(day):
    return usda_dates.major_reports(day)


def release_at(day):
    """The release instant (aware UTC) of the earliest graded report on `day`, or None."""
    reps = reports_on(day)
    if not reps:
        return None
    h, m = min(REPORT_TIME_ET.get(r, (12, 0)) for r in reps)
    return datetime(day.year, day.month, day.day, h, m, tzinfo=ET).astimezone(timezone.utc)


def auto_read(day):
    return any(r in AUTO_READ for r in reports_on(day))


def gate(now):
    """(mode, release): 'live' from 25 minutes before a release to 15 minutes
    after it; 'rehearse' the day before a report day from 18:00 UTC (the 19:17
    tick; the start ticks that day are earlier and get 'none'); else 'none'."""
    today = now.astimezone(CT).date()
    rel = release_at(today)
    if rel is not None and rel - timedelta(minutes=25) <= now <= rel + timedelta(minutes=15):
        return "live", today
    tomorrow = today + timedelta(days=1)
    if release_at(tomorrow) is not None and now.astimezone(timezone.utc).hour >= REHEARSE_FROM_UTC:
        return "rehearse", tomorrow
    return "none", None


def rehearsal_source(report_day, root=ROOT):
    """Last month's file for the rehearsal before `report_day`: the WASDE before
    it, or the newest earlier one whose PDF is in the repo (up to a year back)."""
    d = usda_dates.prior_wasde(report_day)
    first = d
    for _ in range(12):
        if d is None:
            break
        if (Path(root) / "data/wasde-pdf" / ("wasde%s.pdf" % d.strftime("%m%y"))).exists():
            return d
        d = usda_dates.prior_wasde(d)
    return first


# -- the result the worker keeps ------------------------------------------------
SAFE = re.compile(r"[^A-Za-z0-9 .,/()%+:&'$-]")
KEY_RE = re.compile(r"^[a-z0-9_]{1,40}$")
SURPRISES = ("bullish", "bearish", "in line", "")
CROPS = ("corn", "soybeans", "wheat")
ROW_KEYS = ("key", "label", "unit", "actual", "expected", "low", "high", "usda_current", "surprise",
            "gap_pct", "context")
TOP_KEYS = ("v", "test", "complete", "release", "report", "generated", "counts", "big", "rows", "balance")
MAX_BYTES = 12000


def clean(s, n):
    return SAFE.sub("", str(s or ""))[:n].strip()


def _num(v):
    if isinstance(v, bool) or v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if f != f or f in (float("inf"), float("-inf")):
        return None
    return int(f) if f.is_integer() and abs(f) < 1e15 else round(f, 4)


def _load(p):
    try:
        return json.loads(Path(p).read_text())
    except (OSError, ValueError):
        return {}


def compose(release, root=ROOT, test=False, generated=None, complete=False):
    """The live result for `release` from the files a run just wrote, or None
    when nothing of it is graded or printed yet."""
    iso = release.isoformat()
    wpi = _load(Path(root) / "data/whats-priced-in.json")
    wasde = _load(Path(root) / "data/wasde.json")
    lr = wpi.get("latest_result") or {}
    rows, counts, big, report = [], None, None, ""
    if lr.get("date") == iso:
        report = lr.get("report") or ""
        for n in lr.get("numbers") or []:
            if _num(n.get("actual")) is None or not KEY_RE.match(str(n.get("key") or "")):
                continue
            rows.append({"key": n["key"], "label": clean(n.get("label"), 80), "unit": clean(n.get("unit"), 16),
                         "actual": _num(n.get("actual")), "expected": _num(n.get("expected")),
                         "low": _num(n.get("low")), "high": _num(n.get("high")),
                         "usda_current": _num(n.get("usda_current")),
                         "surprise": n.get("surprise") if n.get("surprise") in SURPRISES else "",
                         "gap_pct": _num(n.get("gap_pct")), "context": clean(n.get("context"), 80)})
        counts = {"metrics": int(lr.get("metric_count") or 0), "in_line": int(lr.get("in_line_count") or 0),
                  "ungraded": int(lr.get("ungraded_count") or 0)}
        b = (lr.get("biggest_surprise") or {}).get("metric")
        big = next((r["key"] for r in rows if b and r["label"] == clean(b, 80)), None)
    balance = []
    pdf = wasde.get("wasde_pdf") or {}
    if wasde.get("release") == iso and pdf.get("date") == iso:
        for crop in CROPS:
            t = (pdf.get("crops") or {}).get(crop) or {}
            st, pr = t.get("ending_stocks") or {}, t.get("price") or {}
            if _num(st.get("value")) is None and _num(pr.get("value")) is None:
                continue
            balance.append({"crop": crop, "my": clean(t.get("marketing_year"), 9),
                            "prev_month": clean(t.get("prev_month"), 3),
                            "stocks": _num(st.get("value")), "stocks_prev": _num(st.get("prev")),
                            "price": _num(pr.get("value")), "price_prev": _num(pr.get("prev"))})
        if not report:
            report = release.strftime("%B") + " WASDE"
    if not rows and not balance:
        return None
    rows = rows[:40]
    return {"v": 1, "test": bool(test), "complete": bool(complete), "release": iso, "report": clean(report, 60),
            "generated": generated or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "counts": counts or {"metrics": 0, "in_line": 0, "ungraded": 0}, "big": big,
            "rows": rows, "balance": balance}


def validate(p, now=None):
    """'' when the worker would take `p`, else why not. The worker holds the
    same rules (workers/subs-worker.js, rliveProblem); test/report-live.test.mjs
    runs both on the same cases."""
    if not isinstance(p, dict) or set(p) - set(TOP_KEYS):
        return "shape"
    if len(json.dumps(p, separators=(",", ":"))) > MAX_BYTES:
        return "too big"
    if p.get("v") != 1 or not isinstance(p.get("test"), bool) or not isinstance(p.get("complete"), bool):
        return "version"
    if not isinstance(p.get("release"), str) or not re.match(r"^\d{4}-\d{2}-\d{2}$", p["release"]):
        return "release"
    try:
        rel = date.fromisoformat(p["release"])
    except ValueError:
        return "release"
    today = (now or datetime.now(timezone.utc)).date()
    if p["test"]:
        if not (today - timedelta(days=400) <= rel <= today + timedelta(days=1)):
            return "release"
    elif abs((rel - today).days) > 1:
        return "release"
    if not isinstance(p.get("report"), str) or SAFE.search(p["report"]) or not 3 <= len(p["report"]) <= 60:
        return "report"
    if not re.match(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$", str(p.get("generated") or "")):
        return "generated"
    c = p.get("counts")
    if not isinstance(c, dict) or set(c) != {"metrics", "in_line", "ungraded"} or not all(
            isinstance(c[k], int) and not isinstance(c[k], bool) and 0 <= c[k] <= 60 for k in c):
        return "counts"
    rows, bal = p.get("rows"), p.get("balance")
    if not isinstance(rows, list) or not isinstance(bal, list) or len(rows) > 40 or len(bal) > 3 or not (rows or bal):
        return "rows"
    for r in rows:
        if not isinstance(r, dict) or set(r) != set(ROW_KEYS) or not isinstance(r.get("key"), str) or not KEY_RE.match(r["key"]):
            return "row"
        for k in ("label", "unit", "context"):
            if not isinstance(r[k], str) or SAFE.search(r[k]) or len(r[k]) > (16 if k == "unit" else 80):
                return "row text"
        if r["surprise"] not in SURPRISES:
            return "row grade"
        for k in ("actual", "expected", "low", "high", "usda_current", "gap_pct"):
            v = r[k]
            if v is not None and (isinstance(v, bool) or not isinstance(v, (int, float)) or v != v or abs(v) > 1e9):
                return "row number"
        if r["actual"] is None:
            return "row number"
    if p.get("big") is not None and p["big"] not in [r["key"] for r in rows]:
        return "big"
    for b in bal:
        if not isinstance(b, dict) or set(b) != {"crop", "my", "prev_month", "stocks", "stocks_prev", "price", "price_prev"}:
            return "balance"
        if b["crop"] not in CROPS or not re.match(r"^(\d{4}/\d{2})?$", str(b["my"])) or not re.match(r"^([A-Z][a-z]{2})?$", str(b["prev_month"])):
            return "balance"
        for k in ("stocks", "stocks_prev", "price", "price_prev"):
            v = b[k]
            if v is not None and (isinstance(v, bool) or not isinstance(v, (int, float)) or v != v or abs(v) > 1e9):
                return "balance"
    return ""


# -- the result route's key ---------------------------------------------------------
KEY_LABEL = "report-live|v1"


def derive_key(root_secret):
    """This route's own key."""
    return hmac.new(root_secret.encode(), KEY_LABEL.encode(), hashlib.sha256).hexdigest()


def sign(key, ts, body):
    return hmac.new(key.encode(), ("%d.%s" % (ts, body)).encode(), hashlib.sha256).hexdigest()


def read_key():
    """This run's key for the result route: REPORT_KEY_FILE (written by `key`),
    else made in this step. '' when there is none."""
    f = os.environ.get("REPORT_KEY_FILE", "")
    if f and Path(f).exists():
        return Path(f).read_text().strip()
    s = (os.environ.get("UNSUB_SECRET") or "").strip()
    return derive_key(s) if s else ""


def worker_url():
    return (os.environ.get("REPORT_LIVE_URL") or WORKER).rstrip("/")


def post_live(payload, key, worker=None, now_s=None, opener=None):
    """(ok, status, why). Never raises. The rehearsal's test record is written
    only from a dry run (DRY_RUN=1)."""
    if payload.get("test") and os.environ.get("DRY_RUN") != "1":
        return False, 0, "the test record is written only with DRY_RUN=1"
    body = json.dumps(payload, separators=(",", ":"))
    ts = int(now_s if now_s is not None else time.time())
    req = urllib.request.Request(
        (worker or worker_url()) + ROUTE, data=body.encode(), method="POST",
        headers=dict(UA, **{"Content-Type": "application/json", "X-Report-Ts": str(ts),
                            "X-Report-Sig": sign(key, ts, body)}))
    try:
        with (opener or urllib.request.urlopen)(req, timeout=10) as r:
            return True, r.status, ""
    except urllib.error.HTTPError as ex:
        return False, ex.code, (ex.read() or b"")[:200].decode("utf-8", "replace")
    except Exception as ex:
        return False, 0, type(ex).__name__


def get_live(test=False, worker=None, opener=None):
    """The record the worker serves, or None (nothing kept, or unreachable)."""
    url = (worker or worker_url()) + ROUTE + ("?test=1" if test else "")
    try:
        req = urllib.request.Request(url, headers=dict(UA, **{"Cache-Control": "no-cache"}))
        with (opener or urllib.request.urlopen)(req, timeout=10) as r:
            d = json.loads(r.read().decode())
        return d.get("live") if isinstance(d, dict) else None
    except Exception:
        return None


# -- one run: wait, check, read, grade, send -----------------------------------
def _quiet(fn, *a, **k):
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        rc = fn(*a, **k)
    return rc, buf.getvalue()


class Reader:
    """The existing readers, pointed at `root` (the checkout, or a rehearsal copy)."""

    def __init__(self, root, release, opener=None, nass=True, log=print):
        import read_wasde_pdf
        import fetch_wasde
        self.rp, self.fw = read_wasde_pdf, fetch_wasde
        self.root, self.release, self.opener, self.log = Path(root), release, opener, log
        self.nass = nass and bool(fetch_wasde.API_KEY)
        self.key = fetch_wasde.API_KEY
        self.asks = 0
        if not getattr(fetch_wasde.nass_rows, "short_wait", False):
            # one slow NASS answer must not hold up the PDF: 8 s per ask here (60 s in the module)
            orig = fetch_wasde.nass_rows

            def nass_rows(short_desc, year, period, key=None, opener=None):
                return orig(short_desc, year, period, key=key,
                            opener=opener or (lambda req, timeout=None: urllib.request.urlopen(req, timeout=8)))
            nass_rows.short_wait = True
            fetch_wasde.nass_rows = nass_rows
        self.pdf_dir = self.root / "data/wasde-pdf"
        self.parsed = None
        self.wasde_sig = None

    def _point(self):
        rp, fw = self.rp, self.fw
        rp.PDF_DIR = self.pdf_dir
        fw.PDF_DIR = self.pdf_dir
        fw.EST_PATH = self.root / "data/analyst-estimates.json"
        fw.HIST_PATH = self.root / "data/wpi-history.json"
        fw.OUT_PATH = self.root / "data/wasde.json"

    def pdf(self, now):
        """The PDF read for this release, or None. A file that does not read
        whole is removed so the next check downloads it again."""
        if self.parsed is not None or self.release not in usda_dates.WASDE_DATES:
            return self.parsed
        self._point()
        path, why = self.rp.fetch(self.release, now=now, opener=self.opener)
        if path is None:
            return None
        try:
            p = self.rp.parse_pdf(path)
            if p.get("date") != self.release.isoformat():
                raise self.rp.PdfRefused("dated %s" % p.get("date"))
            self.parsed = p
            self.log("  read     %s (%s)" % (path.name, why))
        except Exception as ex:
            self.log("  not yet  %s did not read whole (%s); asking again" % (path.name, type(ex).__name__))
            try:
                path.unlink()
            except OSError:
                pass
        return self.parsed

    def fill(self):
        """fetch_wasde.py on this release (the PDF and NASS on every check); True
        when wasde.json changed."""
        self._point()
        self.asks += 1
        self.fw.API_KEY = self.key if self.nass else ""
        rc, out = _quiet(self.fw.main, ["--date", self.release.isoformat()])
        for ln in out.splitlines():
            if ln.startswith("::error") or "REFUSED" in ln:
                self.log(ln)
        p = self.root / "data/wasde.json"
        sig = hashlib.sha256(p.read_bytes()).hexdigest() if p.exists() else None
        changed = sig != self.wasde_sig
        self.wasde_sig = sig
        return changed

    def grade(self):
        r = subprocess.run([sys.executable, str(HERE / "build_whats_priced_in.py")], cwd=str(self.root),
                           capture_output=True, text=True, timeout=60)
        if r.returncode != 0:
            self.log("::warning title=Report day::the grader stopped (%s)" % (r.stdout + r.stderr).strip()[-200:])
        return r.returncode == 0

    def waiting_on_nass(self):
        if not self.nass:
            return False
        try:
            est = json.loads((self.root / "data/analyst-estimates.json").read_text())
        except (OSError, ValueError):
            return False
        return bool(self.fw.plan(est, self.release)[0])


def poll(release, root=ROOT, worker=None, key="", test=False, dry_run=False, opener=None, nass=True,
         now=None, sleep=time.sleep, interval=POLL_S, start=None, deadline=None, log=print, on_post=None):
    """Check, read, grade and send until the result is whole or the window
    closes. Returns a dict: posted (count), complete, first_post (UTC ISO),
    last (the payload sent last)."""
    now = now or (lambda: datetime.now(timezone.utc))
    rel = release_at(release) or datetime(release.year, release.month, release.day, 17, tzinfo=timezone.utc)
    start = start or rel - timedelta(minutes=LEAD_MIN)
    deadline = deadline or rel + timedelta(minutes=WINDOW_MIN)
    while now() < start:
        sleep(max(1.0, min(30.0, (start - now()).total_seconds())))
    log("report day %s: checking every %ds until %s UTC" % (release, interval, deadline.strftime("%H:%M")))
    rd = Reader(root, release, opener=opener, nass=nass, log=log)
    out = {"posted": 0, "complete": False, "first_post": None, "last": None, "checks": 0}
    last_body, sent_whole = None, False
    while True:
        out["checks"] += 1
        t = now()
        rd.pdf(t)
        if rd.fill():
            rd.grade()
        payload = compose(release, root, test=test)
        whole = payload is not None and (
            (rd.parsed is not None and not rd.waiting_on_nass()) or release not in usda_dates.WASDE_DATES)
        if payload:
            payload["complete"] = bool(whole)
        body = json.dumps({k: v for k, v in (payload or {}).items() if k != "generated"}, sort_keys=True)
        if payload and body != last_body:
            why = validate(payload, now=t)
            if why:
                log("::warning title=Report day::result not sent (%s)" % why)
            elif dry_run:
                log("  dry run: would send %d graded figure(s), %d balance line(s), %s"
                    % (len(payload["rows"]), len(payload["balance"]), "complete" if whole else "partial"))
                last_body = body
            else:
                ok, status, err = post_live(payload, key, worker)
                log("  sent     %d graded figure(s), %s, to the worker: %s" % (len(payload["rows"]), "complete" if whole else "partial",
                                                                         "ok" if ok else "HTTP %s %s" % (status, err)))
                if ok:
                    last_body = body
                    out["posted"] += 1
                    out["first_post"] = out["first_post"] or t.strftime("%Y-%m-%dT%H:%M:%SZ")
                    out["last"] = payload
                    sent_whole = bool(whole)
                    if on_post:
                        on_post(payload)
        if whole and (dry_run or sent_whole):
            out["complete"] = True
            log("  whole    every figure this run can read is in")
            break
        if now() >= deadline:
            log("  window closed with the result %s" % ("partial" if payload else "not in"))
            break
        sleep(interval)
    return out


# -- the email waits for the live result -----------------------------------------
def wait_live(release, test=False, until=None, worker=None, sleep=time.sleep, get=None, now=None):
    """0 once the worker holds the complete result for `release`; 1 when the
    window closes first (the email never goes out on a partial result)."""
    get = get or (lambda: get_live(test, worker))
    now = now or (lambda: datetime.now(timezone.utc))
    rel = release_at(release)
    until = until or ((rel or now()) + timedelta(minutes=WINDOW_MIN))
    iso = release.isoformat()
    while True:
        rec = get()
        if rec and rec.get("release") == iso and bool(rec.get("test")) == bool(test) and rec.get("complete") is True:
            print("complete result for %s is on the worker (%d figure(s))" % (iso, len(rec.get("rows") or [])))
            return 0
        if now() >= until:
            print("no complete result for %s by %s UTC; this email path sends nothing" % (iso, until.strftime("%H:%M")))
            return 1
        sleep(5)


# -- the watchdog ---------------------------------------------------------------
def _gh(method, path, body=None):
    tok, repo = os.environ.get("GITHUB_TOKEN", ""), os.environ.get("GITHUB_REPOSITORY", "")
    if not (tok and repo):
        return None
    req = urllib.request.Request("https://api.github.com/repos/%s%s" % (repo, path), method=method,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers=dict(UA, **{"Authorization": "Bearer " + tok,
                                                     "Accept": "application/vnd.github+json"}))
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read().decode() or "null")
    except Exception as ex:
        print("GitHub %s %s: %s" % (method, path.split("?")[0], type(ex).__name__))
        return None


def issue(title, body, close=False, force=False):
    """Open an issue with this title, or comment on the open one that has it
    (the issue is the record: a second run never opens a second issue)."""
    if os.environ.get("DRY_RUN") == "1" and not force:
        print("dry run: no issue (%s)" % title)
        return None
    found = _gh("GET", "/issues?state=open&per_page=50") or []
    n = next((i["number"] for i in found if isinstance(i, dict) and i.get("title") == title
              and "pull_request" not in i), None)
    if n:
        _gh("POST", "/issues/%d/comments" % n, {"body": body})
    else:
        r = _gh("POST", "/issues", {"title": title, "body": body})
        n = (r or {}).get("number")
    if n and close:
        _gh("PATCH", "/issues/%d" % n, {"state": "closed", "state_reason": "completed"})
    return n


def notify(subject, lines, force=False):
    """The owner's notice (the existing alert email), honouring DRY_RUN."""
    if os.environ.get("DRY_RUN") == "1" and not force:
        print("dry run: no notice (%s)" % subject)
        return False
    import log_safe
    return log_safe.owner_mail(subject, lines)


def watchdog(release, test=False, worker=None, now=None, sleep=time.sleep, get=None, mail=notify, raise_issue=issue):
    now = now or (lambda: datetime.now(timezone.utc))
    get = get or (lambda: get_live(test, worker))
    rel = release_at(release)
    if rel is None:
        print("watchdog: no report on %s" % release)
        return 0
    iso, reps = release.isoformat(), " and ".join(reports_on(release))
    title = "Report day %s: no result after the release" % iso
    for k, mins in enumerate(WATCH_MIN, 1):
        due = rel + timedelta(minutes=mins)
        while now() < due:
            sleep(max(1.0, min(30.0, (due - now()).total_seconds())))
        rec = get()
        if rec and rec.get("release") == iso:
            print("watchdog: the %s result was live %d minutes after the release" % (iso, mins))
            return 0
        why = ("the readers found nothing yet" if auto_read(release) else
               "%s has no automatic reader: its figures are typed in by hand" % reps)
        lines = ["%s, released %s CT." % (reps, rel.astimezone(CT).strftime("%-I:%M %p")),
                 "No graded result on the site %d minutes after the release (%s)." % (mins, why),
                 "The backup check (WASDE watch) keeps running; the page shows the committed files until then."]
        print("::warning title=Report day::no result %d minutes after the release" % mins)
        mail("%s report day: no result at +%d min" % (iso, mins) if k == 1
             else "%s report day: still no result at +%d min" % (iso, mins), lines)
        raise_issue(title, "\n\n".join(lines))
    return 1


# -- the rehearsal --------------------------------------------------------------
class FakeUsda:
    """last month's PDF, missing for the first `misses` asks and then there."""

    def __init__(self, pdf_bytes, misses=2):
        self.body, self.misses, self.asks, self.appeared = pdf_bytes, misses, 0, None

    def __call__(self, req, timeout=None):
        self.asks += 1
        if self.asks <= self.misses:
            raise urllib.error.HTTPError(req.full_url, 404, "Not Found", {}, None)
        if self.appeared is None:
            self.appeared = time.monotonic()
        return _Resp(self.body)


class _Resp(io.BytesIO):
    status = 200

    def __enter__(self):
        return self

    def __exit__(self, *a):
        self.close()


def scrub(root, release):
    """A rehearsal copy that has not seen `release` yet: the actuals of that
    report and of any later one cleared, their track-record rows and wasde.json
    removed (the copy stands on the morning of `release`)."""
    iso = release.isoformat()
    ep = root / "data/analyst-estimates.json"
    est = json.loads(ep.read_text())
    for rep in est.get("reports", []):
        if str(rep.get("date") or "") >= iso:
            for m in rep.get("metrics", []):
                m["actual"] = None
    ep.write_text(json.dumps(est, indent=2) + "\n")
    hp = root / "data/wpi-history.json"
    if hp.exists():
        h = json.loads(hp.read_text())
        h["history"] = [r for r in h.get("history", []) if str(r.get("date") or "") < iso]
        hp.write_text(json.dumps(h, indent=2) + "\n")
    (root / "data/wasde.json").write_text("{}\n")


def rehearse(release=None, worker=None, key=None, fast=False, email=True, nass=False, misses=2, log=print,
             src_root=ROOT):
    """The whole path on last month's file, into the test record. Returns the
    summary dict (pass, steps, timings)."""
    today = datetime.now(CT).date()
    release = release or rehearsal_source(today + timedelta(days=1), src_root)
    res = {"pass": False, "release": release.isoformat() if release else None, "steps": {}, "timings": {}}
    if release is None:
        res["why"] = "no earlier WASDE on file"
        return res
    if os.environ.get("DRY_RUN") != "1":
        res["why"] = "a rehearsal runs only with DRY_RUN=1"
        return res
    key = key if key is not None else read_key()
    if not key:
        res["why"] = "no route key in this step"
        return res
    pdf_src = Path(src_root) / "data/wasde-pdf" / ("wasde%s.pdf" % release.strftime("%m%y"))
    if not pdf_src.exists():
        res["why"] = "last month's file %s is not in the repo" % pdf_src.name
        return res
    tmp = Path(tempfile.mkdtemp(prefix="report-rehearsal-"))
    try:
        (tmp / "data/wasde-pdf").mkdir(parents=True)
        for f in DATA_FILES + READ_FILES:
            s = Path(src_root) / f
            if s.exists():
                shutil.copy(s, tmp / f)
        scrub(tmp, release)
        res["steps"]["fixture"] = True
        usda = FakeUsda(pdf_src.read_bytes(), misses=misses)
        rel = release_at(release) or datetime(release.year, release.month, release.day, 17, tzinfo=timezone.utc)
        t0 = time.monotonic()
        clock = lambda: rel + timedelta(seconds=time.monotonic() - t0)   # noqa: E731  (the release-day clock)
        served = {}

        def check_served(payload):
            end = time.monotonic() + 60
            while time.monotonic() < end:
                rec = get_live(True, worker)
                if rec and rec.get("generated") == payload["generated"] and rec.get("release") == payload["release"]:
                    served.setdefault("at", time.monotonic())
                    served["rows"] = len(rec.get("rows") or [])
                    served["same"] = {k: v for k, v in rec.items() if k in TOP_KEYS} == payload
                    return
                time.sleep(0.5)

        out = poll(release, tmp, worker=worker, key=key, test=True, opener=usda, nass=nass, now=clock,
                   interval=1 if fast else POLL_S, start=rel, deadline=rel + timedelta(minutes=3 if fast else WINDOW_MIN),
                   log=log, on_post=lambda p: served or check_served(p))
        res["steps"]["read"] = out["posted"] > 0
        res["steps"]["served"] = bool(served.get("at")) and bool(served.get("same"))
        if usda.appeared and served.get("at"):
            res["timings"]["appear_to_served_s"] = round(served["at"] - usda.appeared, 2)
        res["timings"]["checks"] = out["checks"]
        res["figures"] = served.get("rows", 0)
        if email and res["steps"]["served"]:
            env = dict(os.environ, DRY_RUN="1", REPORT_LIVE_TEST="1", REPORT_LIVE_URL=worker or worker_url(),
                       RECIPIENTS="reader@example.com", FROM_ADDR=os.environ.get("FROM_ADDR") or "AGSIST <reports@agsist.com>",
                       LIST_URL="", LIST_TOKEN="", SMTP_USER="", SMTP_PASS="")
            r = subprocess.run([sys.executable, str(HERE / "send_report_day.py"), "--date", release.isoformat()],
                               env=env, capture_output=True, text=True, timeout=180, cwd=str(src_root))
            txt = r.stdout
            res["steps"]["email"] = (r.returncode == 0 and "rows from the live result" in txt
                                     and "dry run complete" in txt and "USDA " in txt)
            if not res["steps"]["email"]:
                log("  email dry run said: " + " | ".join(txt.strip().splitlines()[-4:]) + (r.stderr.strip()[-200:]))
        t = res["timings"].get("appear_to_served_s")
        res["timings"]["under_target"] = t is not None and t < SERVE_TARGET_S
        res["pass"] = all(res["steps"].values()) and res["timings"]["under_target"]
        if not res["pass"] and "why" not in res:
            bad = [k for k, v in res["steps"].items() if not v] or ["timing"]
            res["why"] = "failed at: " + ", ".join(bad)
        return res
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def rehearsal_lines(res, for_day=None):
    t = res.get("timings") or {}
    steps = res.get("steps") or {}
    lines = ["Rehearsal for the report on %s, run on the %s file into the test record." % (for_day or "the next report day", res.get("release")),
             "Result: %s." % ("pass" if res.get("pass") else "FAIL (%s)" % res.get("why", "")),
             "File appears to live value served: %s s (target under %d s)." % (t.get("appear_to_served_s", "n/a"), SERVE_TARGET_S),
             "Steps: " + ", ".join("%s %s" % (k, "ok" if v else "FAILED") for k, v in steps.items()) + ".",
             "Figures served: %s. The email ran as a dry run; nothing was sent and no live record was touched." % res.get("figures", 0)]
    return lines


def report_rehearsal(res, for_day=None):
    """The rehearsal's result as an issue (closed when it passed) and the owner's notice."""
    lines = rehearsal_lines(res, for_day)
    for ln in lines:
        print("  " + ln)
    word = "passed" if res.get("pass") else "FAILED"
    # the rehearsal always runs dry; its own report is what it is for
    issue("Report-day rehearsal for %s: %s" % (for_day or res.get("release"), word), "\n\n".join(lines),
          close=bool(res.get("pass")), force=True)
    notify("Report-day rehearsal %s (%s)" % (word, for_day or res.get("release")), lines, force=True)


def earlier_run(release):
    """Another scheduled run of this workflow already started for `release`'s
    window (the first start tick): its id, else None. None too when GitHub
    cannot be asked (the concurrency groups are the second guard)."""
    rel = release_at(release)
    me = os.environ.get("GITHUB_RUN_ID", "")
    if rel is None or not me:
        return None
    runs = _gh("GET", "/actions/workflows/report-day-live.yml/runs?event=schedule&per_page=30&created=%3E%3D"
               + (rel - timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ"))
    if not isinstance(runs, dict):
        return None
    mine = next((r for r in runs.get("workflow_runs", []) if str(r.get("id")) == me), None)
    for r in runs.get("workflow_runs", []):
        if str(r.get("id")) == me or r.get("conclusion") == "cancelled":
            continue
        if mine is None or str(r.get("created_at", "")) < str(mine.get("created_at", "")):
            return r.get("id")
    return None


# -- the command line -------------------------------------------------------------
def _arg(argv, name, default=None):
    return argv[argv.index(name) + 1] if name in argv and argv.index(name) + 1 < len(argv) else default


def _out(**kv):
    p = os.environ.get("GITHUB_OUTPUT")
    for k, v in kv.items():
        print("%s=%s" % (k, v))
        if p:
            with open(p, "a") as fh:
                fh.write("%s=%s\n" % (k, v))


def main(argv):
    if "--selftest" in argv:
        return selftest()
    if not argv:
        print(__doc__)
        return 2
    cmd = argv[0]
    rel = _arg(argv, "--release")
    rel = date.fromisoformat(rel) if rel else None
    if cmd == "gate":
        n = _arg(argv, "--now")
        now = datetime.fromisoformat(n.replace("Z", "+00:00")) if n else datetime.now(timezone.utc)
        mode, day = gate(now)
        want = _arg(argv, "--mode")
        if want in ("live", "rehearse"):          # a run by hand: its own mode and day
            d = _arg(argv, "--day") or ""
            today = now.astimezone(CT).date()
            if re.match(r"^\d{4}-\d{2}-\d{2}$", d):
                day = date.fromisoformat(d)
            elif want == "live":
                day = today
            else:
                day = next((x for x in report_days() if x > today), None)
            mode = want if day else "none"
        if mode == "live" and not want and "--one-run" in argv:
            other = earlier_run(day)
            if other:
                print("run %s already started for this report day; this tick does nothing" % other)
                mode, day = "none", None
        src = rehearsal_source(day) if mode == "rehearse" else None
        _out(mode=mode, release=day.isoformat() if day else "", source=src.isoformat() if src else "",
             auto=("1" if day and auto_read(day) else "0"))
        return 0
    if cmd == "key":
        s = (os.environ.get("UNSUB_SECRET") or "").strip()
        f = os.environ.get("REPORT_KEY_FILE", "")
        if not (s and f):
            print("::error title=Report day::no route key can be made in this step")
            return 1
        k = derive_key(s)
        print("::add-mask::" + k)
        Path(f).write_text(k)
        os.chmod(f, 0o600)
        print("route key ready")
        return 0
    if cmd == "poll":
        if rel is None:
            print("poll needs --release")
            return 2
        dry = "--dry-run" in argv or os.environ.get("DRY_RUN") == "1"
        key = read_key()
        if not key and not dry:
            print("::error title=Report day::no route key; nothing can be sent to the worker")
            return 1
        out = poll(rel, ROOT, key=key, dry_run=dry)
        _out(posted=out["posted"], complete=("1" if out["complete"] else "0"))
        return 0
    if cmd == "wait-live":
        if rel is None:
            print("wait-live needs --release")
            return 2
        return wait_live(rel, test="--test" in argv)
    if cmd == "watchdog":
        if rel is None:
            print("watchdog needs --release")
            return 2
        return watchdog(rel)
    if cmd == "rehearse":
        res = rehearse(rel, worker=_arg(argv, "--worker"), fast="--fast" in argv, email="--no-email" not in argv,
                       nass="--no-nass" not in argv)
        print("REHEARSAL " + json.dumps(res, sort_keys=True))
        _out(passed=("1" if res["pass"] else "0"))
        if "--notify" in argv:
            report_rehearsal(res, _arg(argv, "--for"))
        return 0 if res["pass"] else 1
    print("unknown command: %s" % cmd)
    return 2


# -- selftest ---------------------------------------------------------------------
def selftest():
    fails = []

    def ok(c, label):
        print(("ok   " if c else "FAIL ") + label)
        if not c:
            fails.append(label)

    U = timezone.utc
    d = date(2026, 12, 10)
    ok(release_at(d) == datetime(2026, 12, 10, 17, 0, tzinfo=U), "Dec 10 WASDE: 17:00 UTC (11:00 a.m. CST)")
    ok(release_at(date(2026, 8, 12)) == datetime(2026, 8, 12, 16, 0, tzinfo=U), "Aug 12: 16:00 UTC (11:00 a.m. CDT)")
    ok(release_at(date(2026, 12, 9)) is None, "no report on Dec 9")
    ok(gate(datetime(2026, 12, 10, 16, 38, tzinfo=U)) == ("live", d), "a 10:38 CT start tick on report day is live")
    ok(gate(datetime(2026, 12, 10, 15, 38, tzinfo=U))[0] == "none", "the other hour's tick (9:38 CT) does nothing")
    ok(gate(datetime(2026, 12, 10, 17, 20, tzinfo=U))[0] == "none", "past release + 15 min the gate is closed")
    ok(gate(datetime(2026, 12, 9, 19, 17, tzinfo=U)) == ("rehearse", d), "the day before is the rehearsal")
    ok(all(gate(datetime(2026, 12, 9, h, m, tzinfo=U))[0] == "none" for h in (15, 16) for m in (38, 48)),
       "the day before, the four start ticks do nothing: one rehearsal only")
    ok(gate(datetime(2026, 12, 10, 19, 17, tzinfo=U))[0] == "none", "no rehearsal tick on a day with no report after it")
    ok(all(gate(datetime(2026, 3, 30, h, m, tzinfo=U))[0] == "none" for h in (15, 16) for m in (38, 48))
       and gate(datetime(2026, 3, 30, 19, 17, tzinfo=U))[0] == "rehearse", "Mar 30: start ticks none, the 19:17 tick rehearses")
    ok(rehearsal_source(d, Path("/nonexistent")) == date(2026, 11, 10), "the rehearsal reads last month's file (Nov 10)")
    ok(usda_dates.prior_wasde(date(2026, 11, 10)) == date(2026, 10, 9), "and steps back a month when that file is missing")
    ok(gate(datetime(2026, 3, 30, 19, 17, tzinfo=U)) == ("rehearse", date(2026, 3, 31)), "Grain Stocks and Plantings get one too")
    for day in report_days():
        r = release_at(day)
        s = r - timedelta(minutes=LEAD_MIN)
        if not (s.hour in (15, 16) and day.day in (8, 9, 10, 11, 12, 30, 31)):
            ok(False, "%s starts at %s UTC, outside the workflow's start ticks" % (day, s.strftime("%H:%M")))
            break
    else:
        ok(True, "every report day on file starts inside the workflow's start ticks")
    # one live run per report day: the second start tick sees the first run and does nothing
    global _gh
    real_gh, old_id = _gh, os.environ.get("GITHUB_RUN_ID")
    runs = {"workflow_runs": [{"id": 1, "created_at": "2026-12-10T16:38:20Z", "conclusion": None},
                              {"id": 2, "created_at": "2026-12-10T16:48:15Z", "conclusion": None}]}
    try:
        _gh = lambda m, p, b=None: runs   # noqa: E731
        os.environ["GITHUB_RUN_ID"] = "2"
        ok(earlier_run(d) == 1, "the second start tick finds the first run")
        os.environ["GITHUB_RUN_ID"] = "1"
        ok(earlier_run(d) is None, "the first start tick runs")
        runs["workflow_runs"][0]["conclusion"] = "cancelled"
        os.environ["GITHUB_RUN_ID"] = "2"
        ok(earlier_run(d) is None, "a cancelled first run leaves the second tick to run")
        _gh = lambda m, p, b=None: None   # noqa: E731
        ok(earlier_run(d) is None, "GitHub not answering: the tick runs (the concurrency group is the second guard)")
    finally:
        _gh = real_gh
        if old_id is None:
            os.environ.pop("GITHUB_RUN_ID", None)
        else:
            os.environ["GITHUB_RUN_ID"] = old_id
    k = derive_key("s")
    ok(k == hmac.new(b"s", b"report-live|v1", hashlib.sha256).hexdigest() and k != "s", "the route key is its own")
    ok(sign(k, 5, "{}") == hmac.new(k.encode(), b"5.{}", hashlib.sha256).hexdigest(), "the route header over ts.body")
    good = {"v": 1, "test": False, "complete": True, "release": "2026-12-10", "report": "December WASDE", "generated": "2026-12-10T17:00:31Z",
            "counts": {"metrics": 1, "in_line": 1, "ungraded": 0}, "big": None,
            "rows": [{"key": "corn_2627", "label": "2026/27 corn ending stocks", "unit": "bil bu", "actual": 1.9,
                      "expected": 1.88, "low": 1.7, "high": 2.0, "usda_current": 1.84, "surprise": "in line",
                      "gap_pct": 1.1, "context": "inside the range"}], "balance": []}
    now = datetime(2026, 12, 10, 17, 1, tzinfo=U)
    ok(validate(good, now) == "", "a result the worker takes")
    bad = json.loads(json.dumps(good)); bad["rows"][0]["label"] = "<img src=x>"
    ok(validate(bad, now) == "row text", "markup in a label is refused")
    bad = json.loads(json.dumps(good)); bad["release"] = "2026-11-10"
    ok(validate(bad, now) == "release", "a live result for last month is refused")
    bad["test"] = True
    ok(validate(bad, now) == "", "the rehearsal may use last month's date")
    bad = json.loads(json.dumps(good)); bad["extra"] = 1
    ok(validate(bad, now) == "shape", "an unknown field is refused")
    bad = json.loads(json.dumps(good)); bad["rows"][0]["actual"] = None
    ok(validate(bad, now) == "row number", "a row without USDA's figure is refused")
    # compose from the October files on disk: the graded rows and the PDF block
    tmp = Path(tempfile.mkdtemp(prefix="report-live-st-"))
    try:
        (tmp / "data").mkdir()
        for f in DATA_FILES:
            if (ROOT / f).exists():
                shutil.copy(ROOT / f, tmp / f)
        w = _load(tmp / "data/wasde.json")
        lr = (_load(tmp / "data/whats-priced-in.json").get("latest_result") or {})
        if lr.get("date") and w.get("release") == lr.get("date"):
            p = compose(date.fromisoformat(lr["date"]), tmp, test=True, generated="2026-10-09T17:22:01Z")
            ok(p is not None and validate(p, datetime.fromisoformat(lr["date"] + "T17:30:00+00:00")) == "",
               "the committed %s result composes into a result the worker takes" % lr["date"])
            ok(p is not None and len(p["rows"]) == sum(1 for n in lr.get("numbers") or [] if n.get("actual") is not None),
               "one row per printed figure")
        else:
            print("note the committed files are between reports; compose checked on the rehearsal only")
        ok(compose(date(2030, 1, 1), tmp) is None, "nothing composed for a day with no print")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    print("OK: %d failure(s)" % len(fails) if not fails else "FAILED: %d failure(s)" % len(fails))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
