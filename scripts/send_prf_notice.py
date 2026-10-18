#!/usr/bin/env python3
"""
send_prf_notice.py: the PRF grid index email (subs worker v5.29).

A reader on /prf or a PRF county page looks up a grid and asks "Email me when
grid 30452's index posts." The worker stores topic prf:30452 under
note:<email>, with after = the newest final interval the page showed then
("2026-06" = June to July 2026). This script is the other half. It runs as a
step of prf.yml (Wednesdays), right after that run fetched RMA's index,
checked it against RMA's own tool and committed it, so the email and the
pages carry the same numbers.

WHAT IT SENDS. For each sign-up, the final intervals on that grid newer than
both after and iv (the last one mailed): one email naming the newest, its
final index (percent of normal), the grid's normal rain for those months, and
a link to the county page it was asked on (or /prf?g=<grid>). Then
POST /notice-mark {email, topic, interval} records it, so the same interval
is never mailed twice. The topic recurs: the next interval RMA posts is the
next email. Plain index information only: nothing about buying, coverage or
agents.

A sign-up with neither after nor iv (an older page, a lost field) is not
mailed for what is already out: it gets a quiet mark at the newest interval
and its first email is the next one RMA posts.

WITHHELD, never guessed: a grid that is not in data/prf, an interval with no
value or a value outside 0 to 2000% of normal, or a normal that is missing.
The interval is left unmarked and the log counts it.

    python3 scripts/send_prf_notice.py                 # dry run: counts and a preview, sends nothing
    python3 scripts/send_prf_notice.py --send          # the real thing (prf.yml passes this)
    python3 scripts/send_prf_notice.py --selftest      # fake HTTP and fake SMTP; no network

Env: the same as send_notice.py (LIST_URL, LIST_TOKEN, UNSUB_SECRET, SMTP_*,
FROM_ADDR, REPLY_TO, MAX_PER_RUN default 300).

The log carries counts only. No address is ever printed, including in error
lines. The unsubscribe link stops this one grid (send_notice.unsub_link).
"""
import argparse
import base64
import json
import os
import re
import smtplib
import struct
import sys
import time
import urllib.parse
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
sys.path.insert(0, str(HERE))
import send_notice as SN          # noqa: E402  transport, render, unsubscribe link

SITE = SN.SITE
UTM = "utm_source=prf_index&utm_medium=email"
TOPIC_RE = re.compile(r"prf:([1-9]\d{3,4})")
IV_RE = re.compile(r"(\d{4})-(0[1-9]|1[01])")
SRC_RE = re.compile(r"page:(prf/[a-z-]+/[a-z0-9-]+)")
COLS, BLOCK, MISSING = 300, 20, 65535
MAX_INDEX = 20000      # x1000: 2000% of normal. The record's highest is about 1149%.
MAX_LIST = 3           # an email names at most this many new intervals
LONG = ["January to February", "February to March", "March to April", "April to May", "May to June",
        "June to July", "July to August", "August to September", "September to October",
        "October to November", "November to December"]
SHORT = ["Jan-Feb", "Feb-Mar", "Mar-Apr", "Apr-May", "May-Jun", "Jun-Jul", "Jul-Aug", "Aug-Sep",
         "Sep-Oct", "Oct-Nov", "Nov-Dec"]


# ---------------------------------------------------------------- data
def shard_key(grid):
    return "%d_%d" % ((grid - 1) // COLS, ((grid - 1) % COLS) // BLOCK)


class PrfData:
    """Reads data/prf/g and data/prf/y shards as fetch_prf.py writes them."""

    def __init__(self, prf_dir):
        self.dir = prf_dir
        self._g, self._y = {}, {}

    def _load(self, kind, key, cache):
        if key not in cache:
            p = os.path.join(self.dir, kind, key + ".json")
            try:
                cache[key] = json.load(open(p, encoding="utf-8"))
            except (OSError, ValueError):
                cache[key] = None
        return cache[key]

    def grid(self, grid):
        """(g record, g shard, y record) or None when the grid is not in the data."""
        key = shard_key(grid)
        g = self._load("g", key, self._g)
        rec = ((g or {}).get("g") or {}).get(str(grid))
        if not rec:
            return None
        y = self._load("y", key, self._y)
        return rec, g, ((y or {}).get("g") or {}).get(str(grid)) or {}

    def finals(self, grid):
        """[(interval "YYYY-II", value x1000 or None)] for every interval RMA has
        published on this grid, oldest first. None = published slot unreadable."""
        got = self.grid(grid)
        if not got:
            return None
        rec, g, yrec = got
        out = {}
        y0, y1 = g.get("y0"), g.get("y1")
        try:
            b = base64.b64decode(rec.get("h") or "")
            vals = struct.unpack("<%dH" % (len(b) // 2), b)
        except Exception:
            vals = ()
        if isinstance(y0, int) and isinstance(y1, int) and len(vals) == (y1 - y0 + 1) * 11:
            for k, v in enumerate(vals):
                if v != MISSING:
                    out["%d-%02d" % (y0 + k // 11, k % 11 + 1)] = v
        for ys, row in yrec.items():
            if not (re.fullmatch(r"\d{4}", ys) and isinstance(row, list) and len(row) == 11):
                continue
            for i, v in enumerate(row):
                if v is not None:
                    out["%s-%02d" % (ys, i + 1)] = v if isinstance(v, int) else None
        return sorted(out.items())

    def normal_in(self, grid, i):
        """RMA's average rain for interval i (0-10) on the grid, inches, or None."""
        got = self.grid(grid)
        a = (got[0].get("a") if got else None) or []
        v = a[i] if i < len(a) else None
        return v / 10 / 25.4 if isinstance(v, int) and v > 0 else None


def valid(v):
    return isinstance(v, int) and not isinstance(v, bool) and 0 <= v <= MAX_INDEX


def label(iv):
    y, i = iv.split("-")
    return "%s %s" % (LONG[int(i) - 1], y)


def pct(v):
    return "%.1f" % (v / 10)


def page_url(src, grid, repo):
    """The county page the ask was on when it is a real page here, else /prf?g=<grid>."""
    m = SRC_RE.fullmatch(str(src or ""))
    if m and (Path(repo) / (m.group(1) + ".html")).is_file():
        return "%s/%s?%s" % (SITE, m.group(1), UTM)
    return "%s/prf?g=%d&%s" % (SITE, grid, UTM)


def plan(data, row):
    """What to do for one /notice-list row:
    ('send', grid, [(iv, v), ...newest last]) / ('quiet', grid, iv) / ('none',) /
    ('withheld', n) / ('nogrid',)."""
    m = TOPIC_RE.fullmatch(str(row.get("topic") or ""))
    grid = int(m.group(1))
    fin = data.finals(grid)
    if not fin:
        return ("nogrid",)
    marks = [x for x in (row.get("iv"), row.get("after")) if isinstance(x, str) and IV_RE.fullmatch(x)]
    if not marks:
        good = [iv for iv, v in fin if valid(v)]
        return ("quiet", grid, good[-1]) if good else ("withheld", 1)
    base = max(marks)
    new = [(iv, v) for iv, v in fin if iv > base]
    if not new:
        return ("none",)
    ok = [(iv, v) for iv, v in new if valid(v) and data.normal_in(grid, int(iv[5:]) - 1)]
    if not ok:
        return ("withheld", len(new))
    return ("send", grid, ok[-MAX_LIST:], len(new) - len(ok))


# ---------------------------------------------------------------- the email
def cpc_line(year, repo):
    """RMA's record now follows NOAA NCEI (its 2027 record); a 2026 policy is still paid on RMA's
    2026 index, built from NOAA CPC. The gap is the backtest's own median (card.cpc_median_abs in
    test/fixtures/prf-season/backtest.json, the file components/prf-now.js prints from), never typed.
    Empty for a 2027 or later interval, or when the backtest is not there."""
    if year > 2026:
        return ""
    try:
        med = json.load(open(Path(repo) / "test" / "fixtures" / "prf-season" / "backtest.json"))["card"]["cpc_median_abs"]
    except (OSError, ValueError, KeyError, TypeError):
        return ""
    if med is None:
        return ""
    return (" This is RMA's 2027 rainfall record (NOAA NCEI). A 2026 policy is paid on RMA's 2026 index, "
            "built from NOAA CPC data, which ran a median %.1f points from it on the grids checked." % float(med))


def make_parts(data, ctx, repo):
    def parts(topic, src, today, _repo=None):
        grid, items = ctx["grid"], ctx["items"]
        iv, v = items[-1]
        i = int(iv[5:]) - 1
        normal = data.normal_in(grid, i)
        subject = "PRF grid %d: %s %s final index %s" % (grid, SHORT[i], iv[:4], pct(v))
        paras = [[("USDA RMA posted the final rainfall index for PRF grid %d for %s: %s. "
                   "Rain on the grid for those two months came in at %s%% of normal (100 is normal)."
                   % (grid, label(iv), pct(v), pct(v)), None)],
                 [("Normal for %s on this grid is %.2f inches, RMA's average for those months."
                   % (LONG[i], normal), None)]]
        if len(items) > 1:
            paras.append([("Also posted since the last email: " + "; ".join(
                "%s, %s" % (label(a), pct(b)) for a, b in items[:-1]) + ".", None)])
        page = page_url(src, grid, repo)
        paras.append([("The grid's record and this year so far: ", None), (page, page)])
        paras.append([("You asked for these on agsist.com: one email each time RMA posts a final index "
                       "for grid %d, about once a month. The figures are RMA's own, read from its PRF index service." % grid
                       + cpc_line(int(iv[:4]), repo), None)])
        return subject, paras
    return parts


def mark(http, base, tok, email, topic, interval, quiet, sleep):
    for k in range(3):
        try:
            body = {"email": email, "topic": topic, "interval": interval}
            if quiet:
                body["quiet"] = True
            r = http("POST", "%s/notice-mark?token=%s" % (base, urllib.parse.quote(tok)), body)
            if isinstance(r, dict) and r.get("ok"):
                return True
        except Exception:
            pass
        sleep(2 * (k + 1))
    return False


# ---------------------------------------------------------------- the run
def run(argv, http=SN.http_json, connect=SN.smtp_connect, now=None, sleep=time.sleep, out=print, repo=REPO):
    p = argparse.ArgumentParser(add_help=False)
    p.add_argument("--send", action="store_true")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--max", type=int, default=int(SN.env("MAX_PER_RUN", "300")))
    a = p.parse_args(argv)
    send = a.send and not a.dry_run
    today = (now or datetime.now(SN.TZ)).astimezone(SN.TZ).date()
    prf_dir = os.path.join(repo, "data", "prf")
    if not os.path.isfile(os.path.join(prf_dir, "meta.json")):
        out("prf: no data/prf/meta.json. Nothing sent.")
        return 0
    data = PrfData(prf_dir)

    base, tok, secret = SN.env("LIST_URL"), SN.env("LIST_TOKEN"), SN.env("UNSUB_SECRET")
    if not (base and tok and secret):
        out("LIST_URL, LIST_TOKEN and UNSUB_SECRET are required")
        return 1
    base = base.rstrip("/")
    from_addr = SN.env("FROM_ADDR") or SN.env("SMTP_USER") or "news@agsist.com"
    reply_to = SN.env("REPLY_TO")
    ctx = {}
    SN.TEMPLATES["prf"] = make_parts(data, ctx, repo)
    out("date %s (America/Chicago), mode %s" % (today.isoformat(), "SEND" if send else "dry run"))

    try:
        rows = http("GET", "%s/notice-list?token=%s&topic=%s" % (base, urllib.parse.quote(tok), urllib.parse.quote("prf:")))
    except Exception as ex:
        out("prf: could not read the list (%s)" % type(ex).__name__)
        return 1
    if not isinstance(rows, list):
        out("prf: the list did not come back as a list")
        return 1
    todo, quiet, seen, n = [], [], set(), {"none": 0, "withheld": 0, "nogrid": 0, "skipped": 0, "part": 0}
    for r in rows:
        r = r or {}
        e = str(r.get("email") or "").strip().lower()
        t = str(r.get("topic") or "")
        if not TOPIC_RE.fullmatch(t) or not SN.EMAIL_RE.match(e) or (e, t) in seen:
            n["skipped"] += 1
            continue
        seen.add((e, t))
        pl = plan(data, r)
        if pl[0] == "send":
            todo.append((e, t, str(r.get("src") or ""), pl[1], pl[2]))
            n["part"] += pl[3]
        elif pl[0] == "quiet":
            quiet.append((e, t, pl[2]))
        elif pl[0] == "withheld":
            n["withheld"] += pl[1]
        else:
            n[pl[0]] += 1
    later = max(0, len(todo) - a.max)
    todo = todo[:a.max]
    out("prf: %d to mail, %d first seen (marked at the newest, nothing mailed), %d nothing new, "
        "%d intervals withheld (no valid value or normal), %d grids not in the data, %d skipped, %d left for the next run"
        % (len(todo), len(quiet), n["none"], n["withheld"] + n["part"], n["nogrid"], n["skipped"], later))

    if not send:
        fin = data.finals(30452) or []
        good = [(iv, v) for iv, v in fin if valid(v)]
        if good:
            ctx.update(grid=30452, items=good[-1:])
            m = SN.render("prf:30452", "page:prf/wisconsin/barron-county", "reader@example.com", base, "preview",
                          today, from_addr, reply_to, repo)
            out("preview (a made-up address and unsubscribe token):")
            out("Subject: " + str(m["Subject"]))
            out(m.get_body(("plain",)).get_content().rstrip())
        out("dry run: nothing sent, nothing marked. Pass --send to mail.")
        return 0

    broken = False
    for e, t, iv in quiet:
        if not mark(http, base, tok, e, t, iv, True, sleep):
            out("::warning::prf: a first-seen sign-up could not be marked; it is tried again next run")
    if not todo:
        return 0

    conn, sent, failed, reconnects = None, 0, 0, 0
    try:
        conn = connect()
        for k, (e, t, src, grid, items) in enumerate(todo):
            ctx.update(grid=grid, items=items)
            try:
                conn.send_message(SN.render(t, src, e, base, secret, today, from_addr, reply_to, repo))
            except Exception as ex:
                failed += 1
                out("  send failed (%s)" % type(ex).__name__)
                dead = isinstance(ex, (smtplib.SMTPServerDisconnected, smtplib.SMTPConnectError)) or \
                    (isinstance(ex, OSError) and not isinstance(ex, smtplib.SMTPException))
                if dead and reconnects < 3 and k < len(todo) - 1:
                    reconnects += 1
                    try:
                        conn.quit()
                    except Exception:
                        pass
                    try:
                        conn = connect()
                    except Exception as ex2:
                        out("  could not reconnect (%s)" % type(ex2).__name__)
                        break
                continue
            sent += 1
            if not mark(http, base, tok, e, t, items[-1][0], False, sleep):
                out("::error::prf: a sent email could not be marked; stopping so nobody gets two")
                broken = True
                break
            if k < len(todo) - 1:
                sleep(1.2)
    except Exception as ex:
        out("  could not connect to SMTP (%s)" % type(ex).__name__)
    finally:
        try:
            if conn:
                conn.quit()
        except Exception:
            pass
    out("prf: sent %d, failed %d" % (sent, failed))
    if broken:
        return 1
    if todo and not sent:
        out("::error::nothing was sent (%d failed)" % failed)
        return 1
    if failed:
        out("::warning::%d failed; they stay unmarked and the next run tries them again" % failed)
    return 0


# ---------------------------------------------------------------- selftest
def selftest():
    import tempfile
    from zoneinfo import ZoneInfo
    fails = []

    def ck(name, cond, detail=""):
        print(("ok   " if cond else "FAIL ") + name + (("  " + str(detail)) if detail and not cond else ""))
        if not cond:
            fails.append(name)

    TZ = ZoneInfo("America/Chicago")
    C = lambda s: datetime.fromisoformat(s).replace(tzinfo=TZ)
    tmp = tempfile.mkdtemp()
    for d in ("data/prf/g", "data/prf/y", "prf/wisconsin"):
        os.makedirs(os.path.join(tmp, d))
    open(os.path.join(tmp, "prf", "wisconsin", "barron-county.html"), "w").write("x")
    json.dump({"v": 1, "crop_year": 2027}, open(os.path.join(tmp, "data", "prf", "meta.json"), "w"))
    # grid 30452 (shard 101_7): history 2024-2025, the open year 2026 through Jun-Jul
    hist = [MISSING] * 22
    hist[10] = 870          # Nov-Dec 2024
    hist[21] = 1234         # Nov-Dec 2025
    h = base64.b64encode(struct.pack("<22H", *hist)).decode()
    avg = [447, 671, 1162, 1669, 2128, 2217, 2188, 2074, 1575, 1069, 742]
    g = {"v": 1, "cy": 2027, "y0": 2024, "y1": 2025, "g": {
        "30452": {"a": avg, "c": ["55005"], "h": h},
        "30453": {"a": avg, "c": ["55005"], "h": h}}}
    y = {"v": 1, "g": {"30452": {"2026": [912, 932, 1524, 1015, 807, 980, None, None, None, None, None]},
                       "30453": {"2026": [912, 932, 1524, 1015, 807, 99999, None, None, None, None, None]}}}
    ck("shard key matches fetch_prf.py", shard_key(30152) == "100_7" and shard_key(30452) == "101_7")
    json.dump(g, open(os.path.join(tmp, "data/prf/g/101_7.json"), "w"))
    json.dump(y, open(os.path.join(tmp, "data/prf/y/101_7.json"), "w"))
    data = PrfData(os.path.join(tmp, "data", "prf"))

    fin = data.finals(30452)
    ck("finals: the history and the open year, oldest first",
       fin[0] == ("2024-11", 870) and fin[1] == ("2025-11", 1234) and fin[-1] == ("2026-06", 980) and len(fin) == 8, fin)
    ck("normal in inches from RMA's average (Jun-Jul 221.7 mm)", abs(data.normal_in(30452, 5) - 8.728) < 0.001)
    ck("a grid not in the data", data.finals(30999) is None)
    P = lambda **kw: plan(data, dict({"topic": "prf:30452"}, **kw))
    ck("after = the newest: nothing new", P(after="2026-06") == ("none",))
    ck("after one back: the new interval", P(after="2026-05") == ("send", 30452, [("2026-06", 980)], 0), P(after="2026-05"))
    ck("iv beats an older after", P(after="2026-03", iv="2026-05")[2] == [("2026-06", 980)])
    ck("several new: the newest three, newest last", [x[0] for x in P(after="2025-11")[2]] == ["2026-04", "2026-05", "2026-06"])
    ck("no after and no iv: a quiet mark at the newest, nothing mailed", P() == ("quiet", 30452, "2026-06"), P())
    ck("a junk after counts as none", P(after="2026-6") == ("quiet", 30452, "2026-06"))
    ck("an out-of-range value is withheld, never sent", plan(data, {"topic": "prf:30453", "after": "2026-05"}) == ("withheld", 1))
    ck("a grid not in the data is not mailed", plan(data, {"topic": "prf:30999", "after": "2026-05"}) == ("nogrid",))

    # the email
    os.environ.update({"LIST_URL": "https://w.dev", "LIST_TOKEN": "tok", "UNSUB_SECRET": "sec",
                       "SMTP_USER": "news@agsist.com", "MAX_PER_RUN": "300"})
    ctx = {"grid": 30452, "items": [("2026-06", 980)]}
    SN.TEMPLATES["prf"] = make_parts(data, ctx, tmp)
    T = "prf:30452"
    m = SN.render(T, "page:prf/wisconsin/barron-county", "a@example.com", "https://w.dev", "sec", C("2026-10-21 05:00").date(),
                  "news@agsist.com", None, tmp)
    txt = m.get_body(("plain",)).get_content()
    htm = m.get_body(("html",)).get_content()
    ck("subject: grid, interval, final index", m["Subject"] == "PRF grid 30452: Jun-Jul 2026 final index 98.0", m["Subject"])
    ck("the index as percent of normal, hand-checked: 980 / 10 = 98.0",
       "final rainfall index for PRF grid 30452 for June to July 2026: 98.0." in txt and "98.0% of normal" in txt, txt[:400])
    ck("the normal, hand-checked: 2217 / 10 / 25.4 = 8.73 in", "Normal for June to July on this grid is 8.73 inches" in txt, txt[:500])
    ck("links the county page it was asked on", SITE + "/prf/wisconsin/barron-county?" + UTM in txt)
    ck("unsubscribe stops this grid", "topic=prf%3A30452" in txt and m["List-Unsubscribe-Post"] == "List-Unsubscribe=One-Click")
    low = (txt + htm).lower()
    ck("no em or en dash, no hype, no sales or agent words",
       not any(x in txt + htm for x in ("\u2014", "\u2013", "&mdash;", "&ndash;")) and "!" not in txt and
       not any(x in low for x in ("agent", "insurance", "coverage", "premium", "buy", "quote", "don't miss", "act now",
                                  "farmers first", "farmers1st", "best")), low[:300])
    ctx.update(items=[("2026-05", 807), ("2026-06", 980)])
    m2 = SN.render(T, "page:prf/../etc", "a@example.com", "https://w.dev", "sec", C("2026-10-21 05:00").date(),
                   "news@agsist.com", None, tmp)
    t2 = m2.get_body(("plain",)).get_content()
    ck("no backtest file, no CPC sentence", "NOAA CPC" not in txt and cpc_line(2026, tmp) == "", txt[-400:])
    real = json.load(open(REPO / "test" / "fixtures" / "prf-season" / "backtest.json"))["card"]["cpc_median_abs"]
    os.makedirs(os.path.join(tmp, "test", "fixtures", "prf-season"))
    json.dump({"card": {"cpc_median_abs": real}}, open(os.path.join(tmp, "test", "fixtures", "prf-season", "backtest.json"), "w"))
    m3 = SN.render(T, "page:prf/wisconsin/barron-county", "a@example.com", "https://w.dev", "sec", C("2026-10-21 05:00").date(),
                   "news@agsist.com", None, tmp)
    t3 = m3.get_body(("plain",)).get_content()
    want = ("read from its PRF index service. This is RMA's 2027 rainfall record (NOAA NCEI). A 2026 policy is paid on RMA's "
            "2026 index, built from NOAA CPC data, which ran a median %.1f points from it on the grids checked." % real)
    ck("a 2026 interval: appended, the gap read from the backtest card", want in " ".join(t3.split()), t3[-600:])
    ck("a 2027 interval: no CPC sentence", cpc_line(2027, REPO) == "")
    ck("two new: both named", "Also posted since the last email: May to June 2026, 80.7." in t2, t2[:600])
    ck("a source that is not a real page links /prf?g=", SITE + "/prf?g=30452&" + UTM in t2)

    # the run, against a fake worker and a fake SMTP
    addrs = {"one@example.com": ("prf:30452", {"after": "2026-05"}),
             "two@example.com": ("prf:30452", {"after": "2026-05"}),
             "done@example.com": ("prf:30452", {"after": "2026-03", "iv": "2026-06"}),
             "new@example.com": ("prf:30452", {}),
             "bad@example.com": ("prf:30453", {"after": "2026-05"}),
             "gone@example.com": ("prf:30999", {"after": "2026-05"})}

    class Worker:
        def __init__(self):
            self.t = {e: dict(v[1], topic=v[0]) for e, v in addrs.items()}
            self.log, self.marks = [], []

        def __call__(self, method, url, body=None):
            u = urllib.parse.urlsplit(url)
            qs = urllib.parse.parse_qs(u.query)
            assert qs.get("token") == ["tok"]
            if method == "GET" and u.path == "/notice-list":
                self.log.append(("list", qs.get("topic", [""])[0], qs.get("unsent")))
                return [dict({"email": e, "ts": 1, "src": "page:prf/wisconsin/barron-county", "sent": None}, **v)
                        for e, v in self.t.items()]
            if method == "POST" and u.path == "/notice-mark":
                self.marks.append((body["email"], body["interval"], bool(body.get("quiet"))))
                cur = self.t[body["email"]]
                if not cur.get("iv") or body["interval"] > cur["iv"]:
                    cur["iv"] = body["interval"]
                return {"ok": True}
            raise AssertionError(method + " " + u.path)

    class SMTP:
        def __init__(self, refuse=()):
            self.sent, self.refuse = [], set(refuse)

        def __call__(self):
            return self

        def send_message(self, msg):
            if msg["To"] in self.refuse:
                raise smtplib.SMTPRecipientsRefused({msg["To"]: (550, b"no")})
            self.sent.append(msg["To"])

        def quit(self):
            pass

    def go(argv, w, s, when="2026-10-21 05:30"):
        lines = []
        rc = run(argv, http=w, connect=s, now=C(when), sleep=lambda x: None, out=lines.append, repo=tmp)
        return rc, "\n".join(lines)

    w, s = Worker(), SMTP()
    rc, log = go([], w, s)
    ck("dry run: reads the list, sends nothing, marks nothing, previews a made-up address",
       rc == 0 and not s.sent and not w.marks and "reader%40example.com" in log and not any(e in log for e in addrs), log)
    rc, log = go(["--send"], w, s)
    ck("reads every prf: row, not only unsent (the topic recurs)", w.log[-1] == ("list", "prf:", None), w.log)
    ck("mails the two with a new interval", sorted(s.sent) == ["one@example.com", "two@example.com"], s.sent)
    ck("marks each with the interval after the send",
       sorted(x for x in w.marks if not x[2]) == [("one@example.com", "2026-06", False), ("two@example.com", "2026-06", False)], w.marks)
    ck("first seen: a quiet mark, no email", ("new@example.com", "2026-06", True) in w.marks and "new@example.com" not in s.sent)
    ck("withheld value, unknown grid, already mailed: no email, no mark",
       not any(x[0] in ("bad@example.com", "gone@example.com", "done@example.com") for x in w.marks), w.marks)
    ck("counts in the log, no address", "2 to mail, 1 first seen" in log and "1 intervals withheld" in log
       and "1 grids not in the data" in log and not any(e in log for e in addrs), log)
    s2 = SMTP()
    rc, log = go(["--send"], w, s2)
    ck("next week, nothing new: nobody mailed twice", rc == 0 and not s2.sent, s2.sent)
    y["g"]["30452"]["2026"][6] = 655
    json.dump(y, open(os.path.join(tmp, "data/prf/y/101_7.json"), "w"))
    data2 = PrfData(os.path.join(tmp, "data", "prf"))
    ck("RMA posts Jul-Aug: the next interval is due", plan(data2, {"topic": "prf:30452", "iv": "2026-06"})[2] == [("2026-07", 655)])
    s3 = SMTP()
    rc, log = go(["--send"], w, s3)
    ck("Jul-Aug posted: one more email each, the first-seen one included",
       sorted(s3.sent) == ["done@example.com", "new@example.com", "one@example.com", "two@example.com"], s3.sent)
    y["g"]["30452"]["2026"][6] = None
    json.dump(y, open(os.path.join(tmp, "data/prf/y/101_7.json"), "w"))
    w, s = Worker(), SMTP(refuse={"one@example.com", "two@example.com"})
    rc, log = go(["--send"], w, s)
    ck("all refused: exit 1, nothing marked as sent", rc == 1 and not any(not q for _, _, q in w.marks), (rc, w.marks))

    print("\n%s: %d failure(s)" % ("FAIL" if fails else "OK", len(fails)))
    return 1 if fails else 0


if __name__ == "__main__":
    if "--selftest" in sys.argv[1:]:
        sys.exit(selftest())
    sys.exit(run(sys.argv[1:]))
