#!/usr/bin/env python3
"""
list_source.py -- the one place every sender gets its list and its day flags.

Oct 21, 2026: Cloudflare blocked the subs worker (a 403 phishing page with no
CORS). Every sender read its list from the worker, so nothing went out, and
every hourly job failed and mailed Sig a "Run failed". The worker and the
private copy of its storage (dnilgis/feedbag, branch private-data,
kv-backup/latest.json.gz, made by feedbag's kv-backup.yml) are now
interchangeable: a sender asks for the worker route it always asked for, and
gets the same rows from whichever place answers.

    request(method, url, body=None, headers=None)   drop-in for the senders'
        worker() / http_json(): the worker first; when it is blocked or does
        not answer, the same answer rebuilt from the copy.
    load(kind, **q)   the rows of one list: daily, notice, alert, watch,
        ewatch, pwatch (q: topic=, unsent=True for notice)
    flag_is_set(key), flag_set(key), claim(key)   day flags (briefed:<day>,
        alerted:<day> ...), kept in the worker AND in the private repo
        (private/send-flags/<key>.json on private-data); either place set
        means the day went out.
    guard(main, soft=True)   runs a job's main(): a list that cannot be had
        at all is one ::warning:: and exit 0 for an hourly job (soft), an
        ::error:: and exit 1 for the Daily and the notices (hard).
    mode()   "worker", "backup" or None (nothing asked yet)
    lid_for(email)   the worker's link id for an address (UNSUB_SECRET)

WHEN THE WORKER COUNTS AS BLOCKED (and only then is the copy used):
  * no answer: DNS, refused, reset, TLS, timeout
  * an HTTP error whose body is not JSON (the Cloudflare block page)
  * a 200 whose body is an HTML page
A JSON error from a working worker ({"ok":false} on a bad token, a 400) is
a real error and is raised as before: those must still fail the run.
LIST_SOURCE=backup forces the copy, LIST_SOURCE=worker forbids it.

WHAT THE COPY GIVES (the worker's own list routes, workers/subs-worker.js):
  /list?format=json   subRecord(): email, zip, src, ts, reports, el
  /notice-list        one row per address and topic, ?topic= and &unsent=1
  /alert-list, /watch-list, /elevator-watch-list, /price-watch-list
                      the stored record plus email
  /count              the counts, from the same keys
  every row with a valid address gets lid, made exactly as lidFor() does.
Never anyone the worker would not mail: keys past their expiry are gone, a
deleted key (an unsubscribe) is not in the copy, an address in
private/list-stops.txt (private-data; the reply-STOP and unsubscribe emails
that came in while the worker was down, one address a line, added by hand)
is left out of every list, and a pending (unconfirmed) watch is left out:
its confirm link lives on the worker, so in backup mode nothing confirms.

A copy older than MAX_AGE_DAYS (8) is refused, and the reason says how old.

MARKS (what a sender records after a mail: /watch-mark, /notice-mark ...)
go to the worker when it answers. In backup mode they go to a journal,
private/send-flags/marks-<route>.jsonl, saved at the end of the run; the
copy's rows are read with the journal applied, so an alert is not mailed
twice. When the worker answers again the journal is replayed into it, then
emptied.

LINKS: in backup mode scripts/email_links.py turns every stop link into the
mailto below and leaves every other worker link out (no link may point at the
blocked host), and the footer says "Reply STOP to stop these emails".

Counts only in the log; never an address, never a secret.

    python3 scripts/list_source.py --selftest
"""
import atexit
import base64
import gzip
import hashlib
import hmac
import http.client
import io
import json
import os
import re
import socket
import ssl
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MAX_AGE_DAYS = 8
STOP_ADDR = "news@agsist.com"
STOP_MAILTO = "mailto:" + STOP_ADDR + "?subject=unsubscribe"
STOP_LINE = "Reply STOP to stop these emails."
PRIVATE_BRANCH = "private-data"
BACKUP_PATH = "kv-backup/latest.json.gz"
STOPS_PATH = "private/list-stops.txt"
FLAG_DIR = "private/send-flags"
LOCAL_REF = "refs/list-source/private-data"
# Where flag and journal files are written before scripts/push_raw.sh saves
# them (it copies from the checkout). LIST_FLAGS_ROOT moves them (selftests).
FLAG_ROOT = Path(os.environ.get("LIST_FLAGS_ROOT") or ROOT)
UA = {"User-Agent": "AGSIST-automation/1.0 (+https://agsist.com; sig@farmers1st.com)"}
EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]{2,}$")    # the worker's EMAIL_RE
DK_B32 = "0123456789abcdefghjkmnpqrstvwxyz"
LIST_ROUTES = {"/list": "sub:", "/alert-list": "alert:", "/watch-list": "watch:",
               "/elevator-watch-list": "ewatch:", "/price-watch-list": "pwatch:", "/notice-list": "note:"}
KINDS = {"daily": "/list", "notice": "/notice-list", "alert": "/alert-list", "watch": "/watch-list",
         "ewatch": "/elevator-watch-list", "pwatch": "/price-watch-list"}
MARK_ROUTES = {"/watch-mark": "/watch-list", "/elevator-watch-mark": "/elevator-watch-list",
               "/price-watch-mark": "/price-watch-list", "/notice-mark": "/notice-list"}
EOPT_FIELDS = ["kind", "ewid", "crop", "period", "plabel", "direction", "target_cents", "move_cents"]


class Unavailable(Exception):
    """The answer cannot be had: the worker is blocked and the copy cannot
    stand in (a route only the worker has, a stale or missing copy)."""


class Blocked(Unavailable):
    """The worker is blocked or does not answer."""


class StaleBackup(Unavailable):
    pass


STATE = {"mode": None, "why": "", "kv": None, "taken": None, "stops": None, "fetched": False,
         "journal": [], "remote_journal": {}, "said": False, "replayed": set(), "flags": {}}


def reset():
    """Forget everything (the selftests run several 'jobs' in one process)."""
    STATE.update({"mode": None, "why": "", "kv": None, "taken": None, "stops": None, "fetched": False,
                  "journal": [], "remote_journal": {}, "said": False, "replayed": set(), "flags": {}})
    _set_links(False)


def mode():
    return STATE["mode"]


def forced():
    v = (os.environ.get("LIST_SOURCE") or "").strip().lower()
    return v if v in ("backup", "worker") else ""


def _env(n):
    return (os.environ.get(n) or "").strip()


def _set_links(on):
    try:
        import email_links
        email_links.FALLBACK = bool(on)
        email_links.BLOCKED_HOST = urllib.parse.urlsplit(_env("LIST_URL")).netloc.lower() if on else ""
    except ImportError:
        pass


# ---------------------------------------------------------------- the worker
def first_line(raw):
    """The page's title, or its first line: what a block page says (BUILD-RULES 20).
    Never an address (any word with @ is blanked), at most 100 characters."""
    s = raw or ""
    m = re.search(r"<title[^>]*>(.*?)</title>", s, re.I | re.S)
    s = m.group(1) if m else next((x for x in s.splitlines() if x.strip()), "")
    s = re.sub(r"\S*@\S*", "[address]", re.sub(r"\s+", " ", s)).strip()
    return s[:100] or "(empty body)"


def _is_json(raw):
    try:
        json.loads(raw)
        return True
    except ValueError:
        return False


def worker_text(method, url, body=None, headers=None, timeout=30):
    """(status, text) from the worker. Raises Blocked when it is blocked or
    silent; an HTTP error with a JSON body is raised as the HTTPError it is
    (its body can still be read)."""
    if forced() == "backup":
        raise Blocked("LIST_SOURCE=backup")
    data = json.dumps(body).encode() if body is not None else None
    h = dict(UA, **({"Content-Type": "application/json"} if data is not None else {}))
    h.update(headers or {})
    req = urllib.request.Request(url, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode("utf-8", "replace")
            st = getattr(r, "status", 200)
    except urllib.error.HTTPError as ex:
        try:
            raw = ex.read().decode("utf-8", "replace")
        except Exception:                                   # noqa: BLE001
            raw = ""
        if raw.strip() and _is_json(raw):
            raise urllib.error.HTTPError(ex.url, ex.code, ex.msg, ex.hdrs, io.BytesIO(raw.encode()))
        raise Blocked("HTTP %d, not JSON: %s" % (ex.code, first_line(raw)))
    except (urllib.error.URLError, socket.timeout, TimeoutError, ConnectionError,
            http.client.HTTPException, ssl.SSLError) as ex:
        raise Blocked("no answer (%s)" % type(ex).__name__)
    if raw.lstrip()[:1] == "<":
        raise Blocked("HTTP %s, an HTML page: %s" % (st, first_line(raw)))
    return st, raw


def _route(url):
    p = urllib.parse.urlsplit(url)
    q = {k: v[-1] for k, v in urllib.parse.parse_qs(p.query).items()}
    return "/" + p.path.strip("/"), q


def _switch(why):
    if STATE["mode"] != "backup":
        STATE["mode"], STATE["why"] = "backup", why
        _set_links(True)
        print("::warning::subs worker blocked (%s); using the private copy of its list" % why)


def request(method, url, body=None, headers=None, timeout=30):
    """Parsed JSON, from the worker or, when it is blocked, the copy."""
    route, q = _route(url)
    method = method.upper()
    if STATE["mode"] != "backup" and forced() != "backup":
        try:
            _st, raw = worker_text(method, url, body, headers, timeout)
        except Blocked as ex:
            if forced() == "worker":
                raise
            _switch(str(ex))
        else:
            STATE["mode"] = STATE["mode"] or "worker"
            data = json.loads(raw or "null")       # bad JSON from a working worker is a real error
            return _after_worker(method, url, route, q, body, headers, data)
    else:
        _switch(STATE["why"] or "LIST_SOURCE=backup")
    return emulate(method, route, q, body)


def _after_worker(method, url, route, q, body, headers, data):
    """Worker mode: a day flag is kept in both places; a journal written while
    the worker was down is replayed into it before its list is used."""
    if route == "/flag" and isinstance(data, dict):
        k = q.get("k", "")
        if method == "POST" and data.get("set"):
            if not _flag_save(k, {"by": "worker", "state": "sent"}):
                print("::warning::day flag %s set on the worker; the private copy of it was not saved" % k)
        elif method == "GET" and not data.get("set"):
            try:
                if _flag_in_repo(k):
                    data = dict(data, set=True)
            except Unavailable as ex:
                print("::warning::day flag %s: the private copy was not read (%s); the worker says not set" % (k, ex))
        return data
    if method == "GET" and route in MARK_ROUTES.values() and route not in STATE["replayed"]:
        STATE["replayed"].add(route)
        if _replay(url, route, headers):
            try:
                _st, raw = worker_text("GET", url, None, headers)
                data = json.loads(raw or "null")
            except Blocked as ex:
                _switch(str(ex))
                return emulate("GET", route, q, None)
    return data


# ---------------------------------------------------------------- the private repo
def _git(args, check=False, data=None):
    """git against the private repo, the way scripts/private_remote.sh sets it
    up (RAW_REMOTE, else PRIVATE_REPO_TOKEN, else origin). Output never printed
    (it could carry the token)."""
    sh = '. scripts/private_remote.sh || exit 3; git "$@"'
    env = dict(os.environ, GIT_TERMINAL_PROMPT="0")
    r = subprocess.run(["bash", "-c", sh, "git"] + args, cwd=str(ROOT), env=env,
                       capture_output=True, input=data, timeout=180)
    return r


def _fetch_private(force=False):
    if STATE["fetched"] and not force:
        return True
    STATE["fetched"] = False
    for i in range(3):
        r = subprocess.run(["bash", "-c", '. scripts/private_remote.sh || exit 3; '
                            'git fetch -q --depth 1 "$REMOTE" "+%s:%s"' % (PRIVATE_BRANCH, LOCAL_REF)],
                           cwd=str(ROOT), env=dict(os.environ, GIT_TERMINAL_PROMPT="0"),
                           capture_output=True, timeout=180)
        if r.returncode == 0:
            STATE["fetched"] = True
            return True
        if i < 2:
            time.sleep(float(os.environ.get("RAW_SLEEP", "5")) * (i + 1))
    return False


def _show(path):
    """A file on private-data as bytes, None when it is not there. Raises
    Unavailable when the private repo cannot be read at all."""
    if not _fetch_private():
        raise Unavailable("the private repo could not be read (PRIVATE_REPO_TOKEN)")
    r = subprocess.run(["git", "show", "%s:%s" % (LOCAL_REF, path)], cwd=str(ROOT), capture_output=True, timeout=120)
    return r.stdout if r.returncode == 0 else None


def _push(paths, msg):
    """Save files under private/ to private-data with scripts/push_raw.sh. True when saved."""
    env = dict(os.environ, RAW_BRANCH=PRIVATE_BRANCH)
    env.pop("RAW_SOFT", None)
    r = subprocess.run(["bash", "scripts/push_raw.sh", msg] + list(paths), cwd=str(ROOT), env=env,
                       capture_output=True, timeout=600)
    if r.returncode != 0:
        tail = [x for x in r.stdout.decode("utf-8", "replace").splitlines() if "::" in x][-1:]
        print("::warning::private save failed: %s" % (tail[0].split("::")[-1][:160] if tail else "push_raw.sh exit %d" % r.returncode))
    else:
        STATE["fetched"] = False      # the next read sees what was just saved
    return r.returncode == 0


# ---------------------------------------------------------------- the copy
def _decode(k):
    if "value" in k and k["value"] is not None:
        return k["value"]
    if k.get("value_b64"):
        try:
            return base64.b64decode(k["value_b64"]).decode("utf-8")
        except Exception:                                   # noqa: BLE001
            return None
    return None


def _parse_taken(s):
    try:
        return datetime.strptime(str(s), "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def backup(now=None):
    """{key name: {"value", "metadata", "expiration"}} from the copy, after the
    age check. Raises StaleBackup / Unavailable."""
    if STATE["kv"] is not None:
        return STATE["kv"]
    f = _env("LIST_BACKUP_FILE")
    raw = Path(f).read_bytes() if f else _show(BACKUP_PATH)
    if not raw:
        raise Unavailable("no copy of the list at %s on %s" % (BACKUP_PATH, PRIVATE_BRANCH))
    try:
        doc = json.loads(gzip.decompress(raw) if raw[:2] == b"\x1f\x8b" else raw)
    except (OSError, ValueError, EOFError):
        raise Unavailable("the copy of the list could not be read")
    taken = _parse_taken(doc.get("taken"))
    now = now or datetime.now(timezone.utc)
    if not taken:
        raise Unavailable("the copy of the list has no taken time; refusing it")
    age = (now - taken).total_seconds() / 86400
    if age > MAX_AGE_DAYS:
        raise StaleBackup("the copy of the list was taken %s, %.1f days ago (more than %d); refusing it. "
                          "Run feedbag's kv-backup.yml" % (doc.get("taken"), age, MAX_AGE_DAYS))
    nows = now.timestamp()
    kv = {}
    for k in doc.get("keys") or []:
        if not isinstance(k, dict) or not isinstance(k.get("name"), str):
            continue
        exp = k.get("expiration")
        if isinstance(exp, (int, float)) and exp <= nows:
            continue                                        # the worker no longer has it
        kv[k["name"]] = {"value": _decode(k), "metadata": k.get("metadata"), "expiration": exp}
    STATE["kv"], STATE["taken"] = kv, doc.get("taken")
    return kv


def stops():
    """Addresses that asked to stop while the worker was down (lowercased set)."""
    if STATE["stops"] is None:
        f = _env("LIST_STOPS_FILE")
        try:
            raw = Path(f).read_bytes() if f else (_show(STOPS_PATH) or b"")
        except Unavailable:
            raw = b""
        STATE["stops"] = {x.strip().lower() for x in raw.decode("utf-8", "replace").splitlines()
                          if "@" in x and not x.strip().startswith("#")}
    return STATE["stops"]


def lid_for(email, secret=None):
    """The worker's lidFor(): HMAC-SHA256(UNSUB_SECRET, "lid|" + address), 16 letters."""
    secret = secret if secret is not None else _env("UNSUB_SECRET")
    if not secret:
        return None
    d = hmac.new(secret.encode(), ("lid|" + str(email).lower()).encode(), hashlib.sha256).digest()
    return "".join(DK_B32[b & 31] for b in d[:16])


def _jv(v):
    if isinstance(v, (dict, list)):
        return v
    try:
        return json.loads(v) if v else None
    except (ValueError, TypeError):
        return None


def _sub_record(email, raw):
    r = raw if isinstance(raw, dict) else (_jv(raw) or {})
    if not isinstance(r, dict):
        r = {}
    z = str(r.get("zip") if r.get("zip") is not None else "").strip()
    out = {"email": email, "zip": z if re.fullmatch(r"\d{5}", z) else None, "src": str(r.get("src") or ""),
           "ts": r["ts"] if isinstance(r.get("ts"), (int, float)) and not isinstance(r.get("ts"), bool) else None,
           "reports": r.get("reports") is not False}
    el = []
    for x in r.get("el") if isinstance(r.get("el"), list) else []:
        i = str("" if x is None else x).strip().lower()
        if re.fullmatch(r"[0-9a-f]{8}", i) and i not in el:
            el.append(i)
    if el:
        out["el"] = el[:6]
    return out


def _journal_rows(route):
    """Journal entries (oldest first) for the list a mark route changes: the
    ones already saved in the private repo and the ones made this run."""
    marks = [m for m, lst in MARK_ROUTES.items() if lst == route]
    out = []
    for m in marks:
        if m not in STATE["remote_journal"]:
            try:
                raw = _show("%s/marks-%s.jsonl" % (FLAG_DIR, m.strip("/"))) if not _env("LIST_BACKUP_FILE") else _local_journal(m)
            except Unavailable:
                raw = None
            rows = []
            for line in (raw or b"").decode("utf-8", "replace").splitlines():
                try:
                    j = json.loads(line)
                except ValueError:
                    continue
                if isinstance(j, dict) and j.get("route") == m and isinstance(j.get("body"), dict):
                    rows.append(j)
            STATE["remote_journal"][m] = rows
        out += STATE["remote_journal"][m] + [j for j in STATE["journal"] if j["route"] == m]
    return out


def _local_journal(m):
    p = FLAG_ROOT / FLAG_DIR / ("marks-%s.jsonl" % m.strip("/"))
    return p.read_bytes() if p.exists() else None


def _apply_mark(recs, route, b, now_ms):
    """The worker's mark routes, on {email: record}."""
    e = str(b.get("email") or "").strip().lower()
    r = recs.get(e)
    if r is None:
        return
    if route == "/notice-mark":
        t = str(b.get("topic") or "").strip().lower()
        if not isinstance(r.get("t"), dict) or t not in r["t"]:
            return
        cur = r["t"][t]
        if t.startswith("prf:"):
            iv = str(b.get("interval") or "")
            if not cur.get("iv") or iv > str(cur.get("iv")):
                cur["iv"] = iv
            if b.get("quiet") is not True:
                cur["sent"] = now_ms
        else:
            cur["sent"] = now_ms
        return
    key = {"/watch-mark": "fips", "/elevator-watch-mark": "wid", "/price-watch-mark": "pid"}[route]
    i = str(b.get(key) or "").strip().lower()
    r.setdefault("pend", {})
    r.setdefault("w", {})
    if b.get("confirm_mailed"):
        if i in r["pend"]:
            r["pend"][i]["m"] = 1
    elif b.get("fired"):
        r["w"].pop(i, None)
    elif i in r["w"]:
        if route == "/watch-mark":
            r["w"][i] = {"k": str(b.get("k") or ""), "s": b.get("s") or {}}
        elif route == "/elevator-watch-mark":
            old = r["w"][i] if isinstance(r["w"][i], dict) else {}
            o = {f: old[f] for f in EOPT_FIELDS if f in old}
            o.update({"label": old.get("label") or str(b.get("label") or ""), "k": str(b.get("k") or ""), "s": b.get("s") or {}})
            r["w"][i] = o


def rows(route, q=None, now=None):
    """The worker's answer to one list route, rebuilt from the copy."""
    q = q or {}
    kv = backup(now)
    prefix = LIST_ROUTES[route]
    stop = stops()
    names = sorted(n for n in kv if n.startswith(prefix))
    if route == "/list":
        out = []
        for n in names:
            e = n[len(prefix):]
            if e.lower() in stop:
                continue
            m = kv[n]["metadata"]
            out.append(_sub_record(e, m if isinstance(m, dict) and isinstance(m.get("ts"), (int, float)) else kv[n]["value"]))
        return _lids(out)
    recs = {}
    for n in names:
        e = n[len(prefix):]
        v = _jv(kv[n]["value"])
        if isinstance(v, dict) and e.lower() not in stop:
            recs[e] = v
    now_ms = int(time.time() * 1000)
    for j in _journal_rows(route):
        _apply_mark(recs, j["route"], j["body"], j.get("ms") or now_ms)
    if route == "/notice-list":
        want = str(q.get("topic") or "").strip().lower()
        unsent = str(q.get("unsent") or "") == "1"
        out = []
        for e, r in recs.items():
            if not isinstance(r.get("t"), dict):
                continue
            for topic, v in r["t"].items():
                if want and not (topic.startswith(want) if want.endswith(":") else topic == want):
                    continue
                v = v if isinstance(v, dict) else {}
                if unsent and v.get("sent"):
                    continue
                row = {"email": e, "topic": topic, "ts": v.get("ts") or None, "src": v.get("src") or "", "sent": v.get("sent") or None}
                for f in ("zip", "note", "after", "iv"):
                    if v.get(f):
                        row[f] = v[f]
                out.append(row)
        return _lids(out)
    out = []
    for e, r in recs.items():
        r = dict(r)
        if "pend" in r:
            r["pend"] = {}           # backup mode: the confirm link is on the worker, so nothing confirms
        if route != "/alert-list" and not r.get("w") and "w" in r:
            continue
        r["email"] = e
        out.append(r)
    return _lids(out)


def _lids(out):
    for r in out:
        e = str(r.get("email") or "").strip().lower()
        if EMAIL_RE.match(e):
            lid = lid_for(e)
            if lid:
                r["lid"] = lid
    return out


def counts(now=None):
    """/count, from the copy (counts only)."""
    subs = rows("/list", now=now)
    kv = backup(now)
    by = {}
    for r in subs:
        s = r["src"] or "(none)"
        by[s] = by.get(s, 0) + 1
    notes = [_jv(kv[n]["value"]) for n in kv if n.startswith("note:")]
    nby, lists = {}, {t: {"n": 0, "by_source": {}, "unsubs": {"h24": 0, "d7": 0, "cleanup_h24": 0, "cleanup_d7": 0}} for t in ("reports", "cot")}
    for r in notes:
        for t, v in ((r or {}).get("t") or {}).items():
            nby[t] = nby.get(t, 0) + 1
            if t in lists:
                s = str((v or {}).get("src") or "") or "(none)"
                lists[t]["n"] += 1
                lists[t]["by_source"][s] = lists[t]["by_source"].get(s, 0) + 1
    n = lambda p: sum(1 for k in kv if k.startswith(p))
    forms = {}
    for k in kv:
        if k.startswith("form:"):
            kind = k.split(":")[1]
            forms[kind] = forms.get(kind, 0) + 1
    return {"ok": True, "daily": len(subs), "daily_with_zip": sum(1 for r in subs if r["zip"]),
            "daily_with_elevators": sum(1 for r in subs if r.get("el")), "alerts": n("alert:"), "ewatch": n("ewatch:"),
            "pwatch": n("pwatch:"), "watch": n("watch:"), "by_source": by, "secret": bool(_env("UNSUB_SECRET")),
            "forms": forms, "unsubs": {}, "notice": len(notes), "notices": nby, "lists": lists,
            "source": "backup", "taken": STATE["taken"]}


def emulate(method, route, q, body):
    if method == "GET" and route in LIST_ROUTES:
        if route == "/list" and q.get("format") != "json":
            return "\n".join(r["email"] for r in rows(route, q))
        out = rows(route, q)
        _say()
        return out
    if method == "GET" and route == "/count":
        return counts()
    if route == "/flag":
        k = q.get("k", "")
        if method == "GET":
            return {"ok": True, "set": flag_is_set(k, _worker=False)}
        if method == "POST":
            if not _flag_save(k, {"by": "backup", "state": "sent"}):
                raise Unavailable("the day flag %s could not be saved in the private repo" % k)
            return {"ok": True, "set": True}
    if method == "POST" and route in MARK_ROUTES and isinstance(body, dict):
        STATE["journal"].append({"route": route, "body": body, "ms": int(time.time() * 1000)})
        return {"ok": True}
    raise Blocked("subs worker blocked (%s); %s %s needs the worker" % (STATE["why"] or "forced", method, route))


def _say():
    if not STATE["said"] and STATE["kv"] is not None:
        STATE["said"] = True
        n = sum(1 for k in STATE["kv"] if k.startswith("sub:") and k[4:].lower() not in stops())
        print("list: backup copy taken %s, %d readers" % (STATE["taken"], n))


def load(kind, **q):
    """The rows of one list (KINDS), from whichever place answers."""
    base = _env("LIST_URL").rstrip("/")
    tok = _env("LIST_TOKEN")
    route = KINDS[kind]
    qs = dict(q)
    if kind == "daily":
        qs["format"] = "json"
    if kind == "notice" and qs.get("unsent") is True:
        qs["unsent"] = "1"
    qs = {k: v for k, v in qs.items() if v not in (None, False, "")}
    url = "%s%s?%s" % (base or "https://subs.invalid", route, urllib.parse.urlencode(dict(qs, token=tok)))
    if not (base and tok):
        if forced() != "backup":
            raise Unavailable("LIST_URL and LIST_TOKEN are not set")
    return request("GET", url)


# ---------------------------------------------------------------- day flags
def _flag_file(k):
    return "%s/%s.json" % (FLAG_DIR, re.sub(r"[^\w.-]", "_", k))


def _flag_in_repo(k):
    """True when the private repo (or the copy of the worker's storage, or this
    run) has the flag. Raises Unavailable when the repo cannot be read."""
    if k in STATE["flags"]:
        return True
    if (FLAG_ROOT / _flag_file(k)).exists() and _env("LIST_BACKUP_FILE"):
        return True
    if not _env("LIST_BACKUP_FILE"):
        _fetch_private(force=True)
        if _show(_flag_file(k)) is not None:
            return True
    try:
        kv = STATE["kv"] if STATE["kv"] is not None else backup()
        if ("flag:" + k) in kv:
            return True
    except StaleBackup:
        pass
    return False


def _flag_save(k, info):
    p = FLAG_ROOT / _flag_file(k)
    p.parent.mkdir(parents=True, exist_ok=True)
    doc = dict({"key": k, "at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}, **info)
    p.write_text(json.dumps(doc) + "\n")
    STATE["flags"][k] = doc
    if _env("LIST_BACKUP_FILE"):
        return True                     # a local test run: the file is the flag
    return _push([_flag_file(k)], "send flag")


def flag_is_set(k, _worker=True):
    """Either place set means the day went out. The worker is asked first when
    it answers; the private repo always. Raises Unavailable when neither can
    be read (the caller fails closed)."""
    base, tok = _env("LIST_URL").rstrip("/"), _env("LIST_TOKEN")
    if _worker and base and tok and STATE["mode"] != "backup":
        d = request("GET", "%s/flag?k=%s&token=%s" % (base, urllib.parse.quote(k), urllib.parse.quote(tok)))
        return bool(isinstance(d, dict) and d.get("set"))
    return _flag_in_repo(k)


def flag_set(k):
    """Set the flag in every place that takes it. True when at least one did."""
    base, tok = _env("LIST_URL").rstrip("/"), _env("LIST_TOKEN")
    if base and tok and STATE["mode"] != "backup":
        try:
            d = request("POST", "%s/flag?k=%s&token=%s" % (base, urllib.parse.quote(k), urllib.parse.quote(tok)))
            return bool(isinstance(d, dict) and d.get("set"))
        except Unavailable:
            pass
        except Exception as ex:                             # noqa: BLE001
            print("::warning::day flag %s not set on the worker (%s)" % (k, type(ex).__name__))
    return _flag_save(k, {"by": "backup" if STATE["mode"] == "backup" else "fallback", "state": "sent"})


def claim(k):
    """Before the first mail of a day in backup mode: the flag goes into the
    private repo FIRST, so a second run (or the worker coming back) can never
    mail the day again. True when the send may go ahead. In worker mode the
    worker's flag works as it always has (set after the loop), so this is a
    no-op."""
    if STATE["mode"] != "backup":
        return True
    ok = _flag_save(k, {"by": "backup", "state": "sending"})
    if not ok:
        print("::error::the day flag %s could not be saved in the private repo; nothing sent "
              "(a send without it could go out twice)" % k)
    return ok


# ---------------------------------------------------------------- the journal
def flush():
    """Save this run's marks to the private repo (backup mode)."""
    if not STATE["journal"]:
        return True
    by = {}
    for j in STATE["journal"]:
        by.setdefault(j["route"], []).append(j)
    paths = []
    for m, new in by.items():
        _journal_rows(MARK_ROUTES[m])          # the saved ones are loaded
        allr = STATE["remote_journal"].get(m, []) + new
        p = FLAG_ROOT / FLAG_DIR / ("marks-%s.jsonl" % m.strip("/"))
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text("".join(json.dumps(j, sort_keys=True) + "\n" for j in allr))
        STATE["remote_journal"][m] = allr
        paths.append("%s/%s" % (FLAG_DIR, p.name))
    STATE["journal"] = []
    if _env("LIST_BACKUP_FILE"):
        return True
    ok = _push(paths, "send marks")
    print("marks: %d saved to the private repo%s" % (sum(len(v) for v in by.values()), "" if ok else " FAILED"))
    return ok


def _replay(url, route, headers):
    """Worker mode: marks journaled while it was down go into the worker, then
    the journal is emptied. True when anything was replayed."""
    if _env("LIST_BACKUP_FILE") or not (_env("PRIVATE_REPO_TOKEN") or _env("RAW_REMOTE")):
        return False
    try:
        js = _journal_rows(route)
    except Unavailable:
        return False
    if not js:
        return False
    base = url.split(route)[0]
    tok = _route(url)[1].get("token", "")
    done = 0
    for j in js:
        try:
            worker_text("POST", "%s%s?token=%s" % (base, j["route"], urllib.parse.quote(tok)), j["body"], headers)
            done += 1
        except Exception:                                   # noqa: BLE001
            break
    if done:
        paths = []
        for m, lst in MARK_ROUTES.items():
            if lst != route:
                continue
            left = [j for j in js[done:] if j["route"] == m]
            p = FLAG_ROOT / FLAG_DIR / ("marks-%s.jsonl" % m.strip("/"))
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text("".join(json.dumps(j, sort_keys=True) + "\n" for j in left))
            STATE["remote_journal"][m] = left
            paths.append("%s/%s" % (FLAG_DIR, p.name))
        _push(paths, "send marks replayed")
        print("marks: %d written while the worker was down went back into it" % done)
    return bool(done)


atexit.register(lambda: STATE["journal"] and flush())


# ---------------------------------------------------------------- the job's main
def guard(main, soft=True):
    """Run main(). A list that cannot be had at all (worker blocked AND no
    usable copy, or a route only the worker has): soft -> one ::warning::
    "worker blocked, skipped" and 0; hard -> ::error:: and 1. Anything else
    (a bad token, our own bug) is raised as before."""
    try:
        rc = main()
    except Unavailable as ex:
        if soft:
            print("::warning::worker blocked, skipped (%s)" % ex)
            rc = 0
        else:
            print("::error::the list could not be read from the worker or the private copy: %s" % ex)
            rc = 1
    if not flush():
        print("::warning::the marks of this run were not saved; the next run may repeat a mail")
    return rc


# ---------------------------------------------------------------- selftest
def selftest():
    import tempfile
    bad = []

    def ck(name, cond):
        if not cond:
            bad.append(name)

    import email_links
    saved = {k: os.environ.get(k) for k in ("LIST_URL", "LIST_TOKEN", "UNSUB_SECRET", "LIST_SOURCE", "LIST_BACKUP_FILE", "LIST_STOPS_FILE")}
    real_open = urllib.request.urlopen
    tmp = tempfile.mkdtemp()
    global FLAG_ROOT
    old_root, FLAG_ROOT = FLAG_ROOT, Path(tmp)
    try:
        now = datetime.now(timezone.utc)
        exp_past = int(now.timestamp()) - 60

        def kvdoc(taken):
            keys = [{"name": "sub:a@farm.com", "value": json.dumps({"ts": 1, "src": "footer", "zip": "54728"})},
                    {"name": "sub:b@farm.com", "value": "{}", "metadata": {"ts": 2, "src": "x", "reports": False, "el": ["ABCDEF01"]}},
                    {"name": "sub:gone@farm.com", "value": json.dumps({"ts": 1}), "expiration": exp_past},
                    {"name": "sub:stop@farm.com", "value": json.dumps({"ts": 1})},
                    {"name": "note:a@farm.com", "value": json.dumps({"t": {"rent:ia": {"ts": 5, "src": "s"}, "cot": {"ts": 6, "sent": 9}}})},
                    {"name": "watch:a@farm.com", "value": json.dumps({"pend": {"17115": {"ts": 1}}, "w": {"19169": {"k": "", "s": {}}}})},
                    {"name": "watch:p@farm.com", "value": json.dumps({"pend": {"17115": {"ts": 1}}, "w": {}})},
                    {"name": "flag:briefed:2026-01-01", "value": "1"},
                    {"name": "alert:a@farm.com", "value_b64": base64.b64encode(json.dumps({"lat": 1.0, "lon": 2.0}).encode()).decode()}]
            return {"taken": taken.strftime("%Y-%m-%dT%H:%M:%SZ"), "count": len(keys), "keys": keys}

        bf = Path(tmp) / "latest.json.gz"
        bf.write_bytes(gzip.compress(json.dumps(kvdoc(now)).encode()))
        sf = Path(tmp) / "stops.txt"
        sf.write_text("# by hand\nSTOP@farm.com\n")
        os.environ.update({"LIST_URL": "https://w.dev", "LIST_TOKEN": "tok", "UNSUB_SECRET": "sec",
                           "LIST_BACKUP_FILE": str(bf), "LIST_STOPS_FILE": str(sf)})
        os.environ.pop("LIST_SOURCE", None)

        class Resp(io.BytesIO):
            status = 200

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

        def block_page(req, timeout=0):
            raise urllib.error.HTTPError(req.full_url, 403, "Forbidden", {}, io.BytesIO(
                b"<!DOCTYPE html>\n<html><head><title>Suspected phishing site | Cloudflare</title></head></html>"))

        urllib.request.urlopen = block_page
        reset()
        r = load("daily")
        ck("block page -> backup", mode() == "backup" and email_links.FALLBACK)
        ck("daily rows: expired and stopped left out", sorted(x["email"] for x in r) == ["a@farm.com", "b@farm.com"])
        a = [x for x in r if x["email"] == "a@farm.com"][0]
        b_ = [x for x in r if x["email"] == "b@farm.com"][0]
        ck("subRecord shape", set(a) == {"email", "zip", "src", "ts", "reports", "lid"} and a["zip"] == "54728" and a["reports"] is True)
        ck("metadata wins, el kept", b_["reports"] is False and b_["el"] == ["abcdef01"] and b_["ts"] == 2)
        d = hmac.new(b"sec", b"lid|a@farm.com", hashlib.sha256).digest()
        ck("lid is the worker's lidFor", a["lid"] == "".join(DK_B32[x & 31] for x in d[:16]) and email_links.LID_RE.match(a["lid"]))
        w = load("watch")
        ck("pending watches never mailed in backup mode", len(w) == 1 and w[0]["pend"] == {} and "19169" in w[0]["w"])
        n = load("notice", topic="rent:ia", unsent=True)
        ck("notice-list topic", len(n) == 1 and n[0]["topic"] == "rent:ia" and n[0]["src"] == "s")
        ck("notice unsent", load("notice", topic="cot", unsent=True) == [] and len(load("notice", topic="cot")) == 1)
        ck("alert b64 value", load("alert")[0]["lat"] == 1.0)
        ck("count from the copy", counts()["daily"] == 2)
        # marks journal: a mark in backup mode changes the next read
        request("POST", "https://w.dev/notice-mark?token=tok", {"email": "a@farm.com", "topic": "rent:ia"})
        ck("journaled mark applies", load("notice", topic="rent:ia", unsent=True) == [])
        flush()
        STATE["remote_journal"] = {}
        ck("journal saved and read back", load("notice", topic="rent:ia", unsent=True) == [])
        # flags: copy flag, repo flag, claim
        ck("flag in the copy", flag_is_set("briefed:2026-01-01"))
        ck("flag not set", not flag_is_set("briefed:2099-01-02"))
        ck("claim in backup mode", claim("briefed:2099-01-02") and flag_is_set("briefed:2099-01-02"))
        try:
            request("GET", "https://w.dev/form-list?token=tok")
            bad.append("a worker-only route answered from the copy")
        except Blocked:
            pass
        ck("guard soft", guard(lambda: request("GET", "https://w.dev/form-list?token=tok")) == 0)
        ck("guard hard", guard(lambda: request("GET", "https://w.dev/form-list?token=tok"), soft=False) == 1)
        # stale copy refused
        bf.write_bytes(gzip.compress(json.dumps(kvdoc(datetime.fromtimestamp(now.timestamp() - 9 * 86400, timezone.utc))).encode()))
        reset()
        try:
            load("daily")
            bad.append("stale copy used")
        except StaleBackup as ex:
            ck("stale names its age", "days ago" in str(ex) and "@" not in str(ex))
        bf.write_bytes(gzip.compress(json.dumps(kvdoc(now)).encode()))
        # no answer -> backup
        reset()

        def silent(req, timeout=0):
            raise urllib.error.URLError(socket.timeout("timed out"))
        urllib.request.urlopen = silent
        ck("timeout -> backup", len(load("daily")) == 2 and mode() == "backup")
        # a 200 HTML page -> backup
        reset()
        urllib.request.urlopen = lambda req, timeout=0: Resp(b"<html>blocked</html>")
        ck("200 html -> backup", len(load("daily")) == 2)
        # a real error stays an error: JSON 403 (bad token), bad JSON on a 200
        reset()

        def bad_token(req, timeout=0):
            raise urllib.error.HTTPError(req.full_url, 403, "Forbidden", {}, io.BytesIO(b'{"ok":false}'))
        urllib.request.urlopen = bad_token
        try:
            load("daily")
            bad.append("a bad token fell back to the copy")
        except urllib.error.HTTPError as ex:
            ck("bad token raised, body readable", ex.code == 403 and json.loads(ex.read()) == {"ok": False} and mode() is None)
        ck("guard does not hide a bad token", _raises(lambda: guard(lambda: load("daily"))))
        reset()
        urllib.request.urlopen = lambda req, timeout=0: Resp(b"not json")
        ck("bad JSON from a working worker raises", _raises(lambda: load("alert"), ValueError))
        # worker answers: worker rows, flag GET also reads the repo
        reset()
        seen = []

        def ok(req, timeout=0):
            seen.append(req.full_url)
            if "/flag" in req.full_url:
                return Resp(b'{"ok":true,"set":false}')
            return Resp(json.dumps([{"email": "w@farm.com", "lid": "0123456789abcdef"}]).encode())
        urllib.request.urlopen = ok
        ck("worker answer used", load("alert")[0]["email"] == "w@farm.com" and mode() == "worker" and not email_links.FALLBACK)
        STATE["flags"]["briefed:2099-01-03"] = {}
        ck("flag in the repo counts when the worker says not set", flag_is_set("briefed:2099-01-03"))
        ck("flag in neither", not flag_is_set("briefed:2099-01-04"))
        ck("claim is a no-op in worker mode", claim("briefed:2099-01-05") and "briefed:2099-01-05" not in STATE["flags"])
        # forced
        reset()
        os.environ["LIST_SOURCE"] = "backup"
        seen.clear()
        ck("LIST_SOURCE=backup never asks the worker", len(load("daily")) == 2 and not seen and mode() == "backup")
        reset()
        os.environ["LIST_SOURCE"] = "worker"
        urllib.request.urlopen = block_page
        ck("LIST_SOURCE=worker never uses the copy", _raises(lambda: load("daily"), Blocked))
        ck("first_line hides addresses", first_line("<title>x a@b.com y</title>") == "x [address] y")
    finally:
        urllib.request.urlopen = real_open
        for k, v in saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        reset()
        import shutil
        shutil.rmtree(tmp, ignore_errors=True)
        FLAG_ROOT = old_root
    if bad:
        print("list_source selftest FAILED: " + "; ".join(bad))
        return 1
    print("list_source selftest ok")
    return 0


def _raises(fn, kind=Exception):
    try:
        fn()
    except kind:
        return True
    except Exception:                                       # noqa: BLE001
        return False
    return False


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(selftest())
    print("usage: python3 scripts/list_source.py --selftest")
