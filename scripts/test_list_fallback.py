#!/usr/bin/env python3
"""THE WORKER AND THE PRIVATE COPY ARE INTERCHANGEABLE: each sender in backup mode.

Oct 21, 2026: Cloudflare answered every subs worker call with its phishing
page. This runs the real senders against that answer (a 403 HTML page, no
JSON) and a made-up copy of the worker's storage, with a fake mail server:

  * the block page -> the copy is used, the log says "list: backup copy
    taken <time>, N readers" and nothing else about the list
  * a copy older than 8 days -> refused, nothing sent
  * the Daily's day flag in either place (worker or private repo) -> skipped,
    including when the worker comes back mid-day saying "not set"
  * no link to the worker host in any body or header; the stop link is the
    mailto and the footer says "Reply STOP to stop these emails."; no
    reader's address in any href
  * an alert mailed in backup mode is not mailed again next run (the journal)
  * a blocked worker is a warning and exit 0 for the hourly jobs and the
    forms digest, an error for the Daily when there is no usable copy
  * test_to_sig: only Sig's address, no day flag

No network, no real mail. Counts only.

    python3 scripts/test_list_fallback.py
"""
import contextlib
import gzip
import io
import json
import os
import shutil
import smtplib
import sys
import tempfile
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import list_source  # noqa: E402
import email_links  # noqa: E402

fails, passes = [], [0]


def check(cond, msg):
    if cond:
        passes[0] += 1
    else:
        fails.append(msg)


TMP = tempfile.mkdtemp(prefix="list-fallback-")
BACKUP = Path(TMP) / "latest.json.gz"
HOST = "agsist-subs.example.workers.dev"
SENT = []


def kv_copy(taken, extra=()):
    keys = [
        {"name": "sub:a@farm.com", "value": json.dumps({"ts": 1, "src": "footer", "zip": "54728", "reports": True})},
        {"name": "sub:b@farm.com", "value": json.dumps({"ts": 2, "src": "hero", "reports": False})},
        {"name": "sub:c@farm.com", "value": json.dumps({"ts": 3, "src": "bar"})},
        {"name": "sub:old@farm.com", "value": json.dumps({"ts": 3}), "expiration": 1000},
        {"name": "note:r@farm.com", "value": json.dumps({"t": {"reports": {"ts": 4, "src": "wasde"}}})},
    ] + list(extra)
    return {"taken": taken.strftime("%Y-%m-%dT%H:%M:%SZ"), "count": len(keys), "keys": keys}


def write_copy(days_old=0.2, extra=()):
    t = datetime.fromtimestamp(time.time() - days_old * 86400, timezone.utc)
    BACKUP.write_bytes(gzip.compress(json.dumps(kv_copy(t, extra)).encode()))


def block_page(req, timeout=0):
    raise urllib.error.HTTPError(req.full_url, 403, "Forbidden", {}, io.BytesIO(
        b"<!DOCTYPE html>\n<html><head><title>Suspected phishing site | Cloudflare</title></head><body>x</body></html>"))


class FakeSMTP:
    def __init__(self, *a, **k):
        pass

    def starttls(self, **k):
        pass

    def login(self, *a):
        pass

    def quit(self):
        pass

    def send_message(self, m):
        SENT.append(m)


def bodies(m):
    out = []
    for part in m.walk():
        if part.get_content_maintype() == "text":
            out.append(part.get_content())
    return out


def links_ok(m, what, reader):
    hs = bodies(m)
    every = "\n".join(hs)
    hrefs = [u for h in hs for u in email_links.hrefs(h)]
    check(HOST not in every and HOST not in str(m["List-Unsubscribe"]), what + ": a link to the blocked worker host")
    check(str(m["List-Unsubscribe"]) == "<" + email_links.STOP_MAILTO + ">" and m["List-Unsubscribe-Post"] is None,
          what + ": List-Unsubscribe is not the mailto alone: " + str(m["List-Unsubscribe"]))
    check(all(email_links.STOP_LINE in h for h in hs), what + ": the footer does not say Reply STOP in every part")
    check(any(email_links.STOP_MAILTO in u for u in hrefs) or any(email_links.STOP_MAILTO in h for h in hs),
          what + ": no mailto stop link in the body")
    check(not [u for u in hrefs if reader in u.lower() or ("@" in u and u != email_links.STOP_MAILTO)],
          what + ": an address in an href")


def env_set(**kw):
    for k, v in kw.items():
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v


def fresh():
    list_source.reset()
    SENT.clear()


def quiet(fn):
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        rc = fn()
    return rc, buf.getvalue()


saved_env = dict(os.environ)
real_open, real_smtp, real_sleep = urllib.request.urlopen, smtplib.SMTP, time.sleep
old_root = list_source.FLAG_ROOT
try:
    list_source.FLAG_ROOT = Path(TMP)
    env_set(LIST_URL="https://" + HOST, LIST_TOKEN="tok", UNSUB_SECRET="sec", LIST_BACKUP_FILE=str(BACKUP),
            LIST_STOPS_FILE=str(Path(TMP) / "stops.txt"), SMTP_USER="sender@example.com", SMTP_PASS="p",
            FROM_ADDR="news@agsist.com", REPLY_TO=None, DRY_RUN=None, LIST_SOURCE=None, TEST_TO_SIG=None,
            LOCAL_BIDS="0", BIDS_BASE=TMP, PRIVATE_REPO_TOKEN=None, RAW_REMOTE=None, GITHUB_STEP_SUMMARY=None)
    (Path(TMP) / "stops.txt").write_text("C@farm.com\n")
    urllib.request.urlopen = block_page
    smtplib.SMTP = FakeSMTP
    time.sleep = lambda s: None

    # ------------------------------------------------------------ the Daily
    import send_daily
    archive = sorted((ROOT / "data" / "daily-archive").glob("20*.json"))[-1]
    DAY = "2099-01-01"
    send_daily.load_today = lambda: (DAY, json.load(open(archive)))
    import gmail_limit
    gmail_limit.check = lambda *a, **k: None

    write_copy()
    fresh()
    rc, out = quiet(lambda: list_source.guard(send_daily.main, soft=False))
    check(rc == 0, "daily: backup send exits 0: " + out[-300:])
    check("list: backup copy taken " in out and ", 2 readers" in out, "daily: the backup line (counts only): " + out[-500:])
    check(len(SENT) == 2, "daily: 2 readers mailed from the copy (expired and stopped left out): %d" % len(SENT))
    check("@farm.com" not in out, "daily: an address in the log")
    for m in SENT:
        links_ok(m, "daily", str(m["To"]).lower())
    fl = json.loads((Path(TMP) / list_source._flag_file("briefed:" + DAY)).read_text())
    check(fl.get("state") == "sent", "daily: the day flag is in the private repo after the send: %s" % fl)

    # flag in the private repo -> skip (a rerun with the worker still blocked)
    fresh()
    rc, out = quiet(lambda: list_source.guard(send_daily.main, soft=False))
    check(rc == 0 and not SENT and "already sent" in out, "daily: a second run with the repo flag set mailed: %d" % len(SENT))

    # the worker comes back mid-day saying "not set": the repo flag still wins
    class Resp(io.BytesIO):
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    def worker_back(req, timeout=0):
        if "/flag" in req.full_url:
            return Resp(b'{"ok":true,"set":false}')
        return Resp(json.dumps([{"email": "a@farm.com", "zip": None, "src": "", "ts": 1, "reports": True,
                                 "lid": "0123456789abcdef"}]).encode())
    urllib.request.urlopen = worker_back
    fresh()
    rc, out = quiet(lambda: list_source.guard(send_daily.main, soft=False))
    check(rc == 0 and not SENT, "daily: worker back mid-day, repo flag set, still mailed %d" % len(SENT))

    # flag on the worker only -> skip
    def worker_flag_set(req, timeout=0):
        if "/flag" in req.full_url:
            return Resp(b'{"ok":true,"set":true}')
        return worker_back(req, timeout)
    urllib.request.urlopen = worker_flag_set
    send_daily.load_today = lambda: ("2099-01-02", json.load(open(archive)))
    fresh()
    rc, out = quiet(lambda: list_source.guard(send_daily.main, soft=False))
    check(rc == 0 and not SENT, "daily: worker flag set, still mailed %d" % len(SENT))

    # the flag only in the copy of the worker's storage -> skip
    urllib.request.urlopen = block_page
    write_copy(extra=[{"name": "flag:briefed:2099-01-03", "value": "1"}])
    send_daily.load_today = lambda: ("2099-01-03", json.load(open(archive)))
    fresh()
    rc, out = quiet(lambda: list_source.guard(send_daily.main, soft=False))
    check(rc == 0 and not SENT, "daily: flag in the KV copy, still mailed %d" % len(SENT))

    # a stale copy -> refused, nothing sent, the Daily fails loudly
    write_copy(days_old=9)
    send_daily.load_today = lambda: ("2099-01-04", json.load(open(archive)))
    fresh()
    rc, out = quiet(lambda: list_source.guard(send_daily.main, soft=False))
    check(rc == 1 and not SENT and "days ago" in out, "daily: a 9-day-old copy was used: rc %s, %d sent" % (rc, len(SENT)))
    check(not (Path(TMP) / list_source._flag_file("briefed:2099-01-04")).exists(), "daily: a refused send set the flag")

    # test_to_sig: only Sig, no flag
    write_copy()
    env_set(TEST_TO_SIG="1", SIG_TEST_EMAILS="sig@example.com", LIST_SOURCE="backup")
    send_daily.load_today = lambda: ("2099-01-05", json.load(open(archive)))
    fresh()
    rc, out = quiet(lambda: list_source.guard(send_daily.main, soft=False))
    check(rc == 0 and len(SENT) == 1 and str(SENT[0]["To"]) == "sig@example.com", "test_to_sig: not Sig alone: %d" % len(SENT))
    check(SENT and str(SENT[0]["Subject"]).startswith("[test copy]"), "test_to_sig: subject not marked")
    check(not (Path(TMP) / list_source._flag_file("briefed:2099-01-05")).exists(), "test_to_sig set the day flag")
    check("list: backup copy taken" in out, "test_to_sig did not read the copy")
    if SENT:
        links_ok(SENT[0], "test_to_sig", "sig@example.com")
    send_daily.flag = send_daily.__dict__.get("flag")
    env_set(TEST_TO_SIG=None, SIG_TEST_EMAILS=None, LIST_SOURCE=None)
    import importlib
    importlib.reload(send_daily)
    send_daily.load_today = lambda: ("2099-01-06", json.load(open(archive)))

    # the claim cannot be saved -> nothing sent
    real_save = list_source._flag_save
    list_source._flag_save = lambda k, info: False
    fresh()
    rc, out = quiet(lambda: list_source.guard(send_daily.main, soft=False))
    check(rc == 1 and not SENT, "daily: sent without a saved day flag: %d" % len(SENT))
    list_source._flag_save = real_save

    # ------------------------------------------------------------ report day + Funds this week (stop links)
    import send_report_day as srd
    fresh()
    list_source.request("GET", "https://%s/list?format=json&token=tok" % HOST)
    srd.LINK_IDS["a@farm.com"] = list_source.lid_for("a@farm.com")
    try:
        u = srd.unsub_url("a@farm.com")
        check(u == email_links.STOP_MAILTO, "report day: stop link is not the mailto: %s" % u)
    except Exception as ex:                                # noqa: BLE001
        fails.append("report day stop link raised %s" % type(ex).__name__)
    rows = list_source.load("notice", topic="reports")
    check(len(rows) == 1 and rows[0]["lid"], "notice-list from the copy: %d" % len(rows))

    # ------------------------------------------------------------ hail alerts
    import check_alerts
    fresh()
    write_copy(extra=[{"name": "alert:h@farm.com", "value": json.dumps({"lat": 45.3, "lon": -91.6, "radius_mi": 5, "ts": 1})}])
    ws = check_alerts.fetch_watchers()
    check(len(ws) == 1 and email_links.lid_of(ws[0]) and list_source.mode() == "backup", "hail: the copy's alert list")
    check(check_alerts.stop_url(ws[0]) == email_links.STOP_MAILTO, "hail: stop link is not the mailto")

    # ------------------------------------------------------------ county watch: mailed once, then the journal holds it
    import send_watch
    cards = json.loads(send_watch.CARDS.read_text())["counties"]
    fips = sorted(cards)[0]
    write_copy(extra=[{"name": "watch:w@farm.com", "value": json.dumps({"pend": {"99999": {"ts": int(time.time() * 1000)}},
                                                                        "w": {fips: {"k": "old-key", "s": {}}}})},
                      {"name": "watch:p@farm.com", "value": json.dumps({"pend": {fips: {"ts": int(time.time() * 1000)}}, "w": {}})}])
    fresh()
    rc, out = quiet(lambda: list_source.guard(send_watch.main, soft=True))
    first = len(SENT)
    if os.environ.get("LF_DEBUG"):
        sys.__stdout__.write("county watch first run: %d sent; %s\n" % (first, out.strip().splitlines()[-3:]))
    check(rc == 0 and first == 1, "county watch: backup run exit %s, %d sent: %s" % (rc, first, out[-300:]))
    check(all(str(m["To"]) != "p@farm.com" for m in SENT), "county watch: a pending (unconfirmed) watch was mailed")
    for m in SENT:
        links_ok(m, "county watch", str(m["To"]).lower())
    check((Path(TMP) / list_source.FLAG_DIR / "marks-watch-mark.jsonl").exists(), "county watch: no journal saved")
    fresh()
    rc, out = quiet(lambda: list_source.guard(send_watch.main, soft=True))
    check(rc == 0 and not SENT, "county watch: the next run mailed again (%d, first run %d)" % (len(SENT), first))
    check("watchers 1;" in out and "changes 0" in out and "baselines 0" in out, "county watch: the journal was not applied: " + out[-300:])

    # ------------------------------------------------------------ hourly jobs: no usable copy -> warning, exit 0
    write_copy(days_old=9)
    import send_price_watch
    import send_elevator_watch
    for name, fn in (("county watch", send_watch.main), ("price watch", send_price_watch.main),
                     ("elevator watch", send_elevator_watch.main)):
        fresh()
        if name == "price watch":
            send_price_watch.load_quotes = lambda: {}
        if name == "elevator watch":
            send_elevator_watch.load_basis_index = lambda *a, **k: {}
            send_elevator_watch.fetch_net_index = lambda: {}
            send_elevator_watch.load_net_index = lambda *a, **k: {}
        rc, out = quiet(lambda: list_source.guard(fn, soft=True))
        check(rc == 0 and "::warning::worker blocked, skipped" in out and not SENT,
              "%s: a blocked worker with a stale copy did not skip quietly: rc %s %s" % (name, rc, out[-200:]))

    # a real error still fails: a JSON refusal (bad token) from a working worker
    def bad_token(req, timeout=0):
        raise urllib.error.HTTPError(req.full_url, 403, "Forbidden", {}, io.BytesIO(b'{"ok":false}'))
    urllib.request.urlopen = bad_token
    fresh()
    try:
        quiet(lambda: list_source.guard(send_watch.main, soft=True))
        fails.append("county watch: a bad token was skipped as if blocked")
    except urllib.error.HTTPError:
        passes[0] += 1
    urllib.request.urlopen = block_page

    # ------------------------------------------------------------ forms digest: only on the worker -> skipped, exit 0
    import form_digest
    fresh()
    code, log = form_digest.run("https://" + HOST, "tok", "sig@example.com", False, lambda m: SENT.append(m))
    check(code == 0 and any("worker blocked, skipped" in x for x in log) and not SENT, "forms digest: blocked was not a skip: %s" % log)
    code, log = form_digest.hay_run("https://" + HOST, "tok", "sig@example.com", False, lambda m: SENT.append(m))
    check(code == 0 and any("worker blocked, skipped" in x for x in log), "hay digest: blocked was not a skip: %s" % log)
    urllib.request.urlopen = bad_token
    fresh()
    code, log = form_digest.run("https://" + HOST, "tok", "sig@example.com", False, lambda m: SENT.append(m))
    check(code == 1, "forms digest: a bad token did not fail")
    urllib.request.urlopen = block_page

    # ------------------------------------------------------------ notices: the mark goes to the journal
    import send_notice
    write_copy(extra=[{"name": "note:n@farm.com", "value": json.dumps({"t": {"rent:ia": {"ts": 5, "src": "s"}}})}])
    fresh()
    r = send_notice.http_json("GET", "https://%s/notice-list?token=tok&topic=rent%%3Aia&unsent=1" % HOST)
    check(len(r) == 1, "notice: copy rows %d" % len(r))
    send_notice.http_json("POST", "https://%s/notice-mark?token=tok" % HOST, {"email": "n@farm.com", "topic": "rent:ia"})
    r = send_notice.http_json("GET", "https://%s/notice-list?token=tok&topic=rent%%3Aia&unsent=1" % HOST)
    check(r == [], "notice: marked row still unsent")
    list_source.flush()
finally:
    urllib.request.urlopen, smtplib.SMTP, time.sleep = real_open, real_smtp, real_sleep
    list_source.FLAG_ROOT = old_root
    os.environ.clear()
    os.environ.update(saved_env)
    list_source.reset()
    shutil.rmtree(TMP, ignore_errors=True)

if fails:
    print("list fallback: %d FAILED" % len(fails))
    for f in fails:
        print("  - " + f)
    sys.exit(1)
print("list fallback: %d passed (block page -> copy, stale copy refused, day flag in either place, "
      "mailto stop links, no worker host, journal, quiet skips)" % passes[0])
