#!/usr/bin/env python3
"""
bounces.py: hard bounces per address, and the addresses left out of every list after two
(Nov 10, 2026).

Nothing here holds an address. An address is kept as its key: an HMAC-SHA256 of the lowercased
address under UNSUB_SECRET (a secret every list job already holds), first 32 hex characters. Without
that secret nothing is recorded and nobody is left out. Files in the private repo (private-data):

  private/bounces/events/<day>-<sender>-<run>-<pid>-<n>.jsonl
      the hard bounces one sender run saw at send time (scripts/send_pace.py), one per line,
      {"h", "code", "src": "smtp", "id", "day"}. Written at the end of the run, one file per run.
  private/bounces/ledger.json
      {"v": 2, "updated", "addr": {key: {"ids": {id: {"day", "code", "src"}}, "undo": day?}},
       "suppressed": [key, ...], "held": {...}?}

What counts as hard is scripts/send_pace.py's rule (status 5.1.1, 5.1.2, 5.1.3, 5.1.6, 5.1.10 or
5.2.1 for the recipient, or a 550/551/553 that says the user does not exist). A soft bounce (4.x.x,
a delay, an expired try) is never recorded.

THE FOLD (python3 scripts/bounces.py --fold, a list-hygiene.yml step of its own that reads no mail):
the inbox step's events (BOUNCE_EVENTS_IN, keys only) and the senders' event files go into the
ledger; the event files folded are then deleted. An address is suppressed when it has hard bounces
on SUPPRESS_AFTER (2) different days after its undo day. Suppressed means list_source.py leaves it
out of every list a sender reads; the subscription is kept (a flag, never a delete).

  * Undo: the address in LIST_UNSUPPRESS on a hand run, or a hand-set undo day in the ledger. A
    fresh signup or confirmation after the last bounce is an undo too (a new opt-in).
  * Ceiling: when one fold would newly suppress more than CEILING_N (10) addresses or more than
    CEILING_PCT (5%) of the Daily list, it suppresses nobody new, mails the owner and opens a
    GitHub issue (counts only). A hand run with BOUNCE_ACCEPT=1 applies it.

Counts only in any log or issue; only the owner's private mail names addresses.

    python3 scripts/bounces.py --fold [--dry-run]
    python3 scripts/bounces.py --selftest      (the tests are in scripts/test_send_pace.py)
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass

import atexit
import hashlib
import hmac
import itertools
import json
import os
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

SUPPRESS_AFTER = 2
CEILING_N = 10
CEILING_PCT = 0.05
DIR = "private/bounces"
LEDGER = DIR + "/ledger.json"
EVENTS = DIR + "/events"
KEY_RE = re.compile(r"^[0-9a-f]{32}$")
ISSUE_TITLE = "Bounce suppression held"

PENDING = []                  # this run's send-time hard bounces, saved at exit when armed
STATE = {"armed": False, "sender": "", "saved": False}
_SEQ = itertools.count()


class NoKey(Exception):
    """UNSUB_SECRET is not set: no key can be made, so nothing is recorded or left out."""


def key(addr, secret=None):
    s = secret if secret is not None else (os.environ.get("UNSUB_SECRET") or "").strip()
    if not s:
        raise NoKey("UNSUB_SECRET is not set")
    msg = ("bounce:" + str(addr or "").strip().lower()).encode("utf-8")
    return hmac.new(s.encode("utf-8"), msg, hashlib.sha256).hexdigest()[:32]


def _today():
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _run_id():
    r = os.environ.get("GITHUB_RUN_ID") or "local"
    a = os.environ.get("GITHUB_RUN_ATTEMPT") or "1"
    return re.sub(r"[^\w.-]", "_", "%s.%s" % (r, a))


def record(addr, code="", sender=""):
    """One hard bounce seen at send time. Kept in memory; saved at exit when this run is armed."""
    if not addr:
        return None
    try:
        h = key(addr)
    except NoKey:
        return None
    sender = re.sub(r"[^a-z0-9-]", "", (sender or STATE["sender"] or "send").lower())[:40] or "send"
    ev = {"h": h, "code": re.sub(r"[^\w. ]", "", str(code or ""))[:20], "src": "smtp",
          "id": "smtp:%s:%s:%d:%d:%d" % (sender, _run_id(), os.getpid(), time.time_ns(), next(_SEQ)), "day": _today()}
    PENDING.append(ev)
    return ev


def arm(sender):
    """Save this run's send-time hard bounces to the private repo at exit (delivery_line.start)."""
    STATE["sender"] = sender or STATE["sender"]
    if not STATE["armed"]:
        STATE["armed"] = True
        atexit.register(save)


def event_name():
    """A file name no other run, process or call in this process can take."""
    return "%s/%s-%s-%s-%d-%d-%d.jsonl" % (EVENTS, _today(), re.sub(r"[^a-z0-9-]", "", STATE["sender"] or "send") or "send",
                                           _run_id(), os.getpid(), time.time_ns(), next(_SEQ))


def save():
    """Write and push this run's events. True when there was nothing to save or it was saved."""
    if not PENDING or STATE["saved"]:
        return True
    STATE["saved"] = True
    try:
        import list_source
        name = event_name()
        p = list_source.FLAG_ROOT / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text("".join(json.dumps(e, sort_keys=True) + "\n" for e in PENDING))
        print("hard bounces at send time: %d recorded" % len(PENDING))
        if os.environ.get("LIST_BACKUP_FILE"):
            return True                 # a local test run: the file is the record
        return list_source._push([name], "hard bounces")
    except Exception as ex:                                # noqa: BLE001  never break a sender's exit
        print("::warning::hard bounces at send time not saved (%s)" % type(ex).__name__)
        return False


# ---------------------------------------------------------------- the ledger
def empty():
    return {"v": 2, "updated": "", "addr": {}, "suppressed": []}


def parse(raw):
    """A ledger from bytes or text; an empty one when it is missing. Raises ValueError on a broken file."""
    if raw is None:
        return empty()
    doc = json.loads(raw.decode("utf-8") if isinstance(raw, bytes) else raw)
    if not isinstance(doc, dict) or not isinstance(doc.get("addr", {}), dict):
        raise ValueError("not a ledger")
    out = empty()
    out.update(doc)
    return out


def counted_days(entry):
    """The different days with a hard bounce after the entry's undo day, oldest first."""
    undo = entry.get("undo") or ""
    return sorted({str(e.get("day") or "")[:10] for e in (entry.get("ids") or {}).values()
                   if str(e.get("day") or "") and (not undo or str(e.get("day") or "") > undo)})


def last_day(entry):
    d = counted_days(entry)
    return d[-1] if d else ""


def due(entry):
    return len(counted_days(entry)) >= SUPPRESS_AFTER


def _day_of_ts(ts):
    """A record's signup time (epoch ms, epoch s or an ISO string) as YYYY-MM-DD, or ''."""
    if ts in (None, "", 0):
        return ""
    try:
        v = float(ts)
        if v > 1e11:
            v /= 1000.0
        return datetime.fromtimestamp(v, timezone.utc).strftime("%Y-%m-%d")
    except (TypeError, ValueError, OverflowError, OSError):
        s = str(ts)
        return s[:10] if re.match(r"^\d{4}-\d{2}-\d{2}", s) else ""


def opted_in_after(entry, ts):
    """True when a signup or confirmation at `ts` came after the address's last counted bounce day."""
    d, last = _day_of_ts(ts), last_day(entry)
    return bool(d and last and d > last)


def fold(ledger, events, today=None, undo=(), optins=None, list_size=0, accept=False):
    """Add events [{"h", "id", "day", "code", "src"}], undo keys and opt-ins {key: signup ts} to a ledger.
    -> (ledger, changes) with changes {"recorded", "suppressed", "undone", "held"} (keys; held: the
    keys a ceiling kept from being suppressed)."""
    today = today or _today()
    led = parse(json.dumps(ledger)) if ledger is not None else empty()
    before = set(led.get("suppressed") or [])
    recorded = []
    for e in events or []:
        h, i = str(e.get("h") or ""), str(e.get("id") or "")
        if not KEY_RE.match(h) or not i:
            continue
        ent = led["addr"].setdefault(h, {"ids": {}})
        ids = ent.setdefault("ids", {})
        if i in ids:
            continue
        ids[i] = {"day": str(e.get("day") or today)[:10], "code": str(e.get("code") or "")[:20],
                  "src": str(e.get("src") or "")[:8]}
        recorded.append(h)
    undone = []
    for h in undo or ():
        if KEY_RE.match(h or ""):
            led["addr"].setdefault(h, {"ids": {}})["undo"] = today
            undone.append(h)
    for h, ts in (optins or {}).items():
        ent = led["addr"].get(h)
        if ent and counted_days(ent) and opted_in_after(ent, ts):
            ent["undo"] = today
            undone.append(h)
    want = {h for h, ent in led["addr"].items() if KEY_RE.match(h) and due(ent)}
    new = sorted(want - before)
    # more than CEILING_N, or more than CEILING_PCT of the Daily list (when it was read), is held
    over = len(new) > CEILING_N or (list_size and len(new) > CEILING_PCT * list_size)
    limit = min(CEILING_N, int(CEILING_PCT * list_size)) if list_size else CEILING_N
    held = []
    if new and over and not accept:
        held = new
        want = want & before                    # suppress nobody new; undos still apply
        led["held"] = {"day": today, "count": len(new), "limit": limit}
    else:
        led.pop("held", None)
    led["suppressed"] = sorted(want)
    led["updated"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return led, {"recorded": recorded, "suppressed": sorted(set(want) - before), "undone": sorted(set(undone)),
                 "held": held}


def suppressed_keys(ledger):
    """{key: last counted bounce day} for the suppressed keys, worked out again from the entries (a hand
    edit of an undo day counts). Only keys the fold suppressed (a held ceiling suppresses nobody new)."""
    marked = set(ledger.get("suppressed") or [])
    return {h: last_day(ent) for h, ent in (ledger.get("addr") or {}).items()
            if h in marked and KEY_RE.match(h) and due(ent)}


def read_ledger():
    """The ledger in the private repo (a local file when LIST_BACKUP_FILE is set).
    Raises list_source.Unavailable when the private repo cannot be read."""
    import list_source
    if os.environ.get("LIST_BACKUP_FILE"):
        p = list_source.FLAG_ROOT / LEDGER
        return parse(p.read_bytes() if p.exists() else None)
    return parse(list_source._show(LEDGER))


def read_events():
    """Every send-time event file -> ([event], [file path]). Raises list_source.Unavailable."""
    import list_source
    out, names = [], []
    if os.environ.get("LIST_BACKUP_FILE"):
        d = list_source.FLAG_ROOT / EVENTS
        files = [(EVENTS + "/" + p.name, p.read_bytes()) for p in sorted(d.glob("*.jsonl"))] if d.exists() else []
    else:
        if not list_source._fetch_private():
            raise list_source.Unavailable("the private repo could not be read (PRIVATE_REPO_TOKEN)")
        r = subprocess.run(["git", "ls-tree", "--name-only", "%s:%s" % (list_source.LOCAL_REF, EVENTS)],
                           cwd=str(list_source.ROOT), capture_output=True, timeout=120)
        ls = [n for n in r.stdout.decode("utf-8", "replace").split() if n.endswith(".jsonl")] if r.returncode == 0 else []
        files = [(EVENTS + "/" + n, list_source._show(EVENTS + "/" + n) or b"") for n in ls]
    for name, raw in files:
        names.append(name)
        for ln in raw.decode("utf-8", "replace").splitlines():
            try:
                e = json.loads(ln)
            except ValueError:
                continue
            if isinstance(e, dict):
                out.append(e)
    return out, names


def write_ledger(ledger, delete=()):
    """Write the ledger and push it, deleting the folded event files in the same commit. True when saved."""
    import list_source
    p = list_source.FLAG_ROOT / LEDGER
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(ledger, sort_keys=True, indent=1) + "\n")
    if os.environ.get("LIST_BACKUP_FILE"):
        for n in delete:
            q = list_source.FLAG_ROOT / n
            if q.exists():
                q.unlink()
        return True
    old = os.environ.get("RAW_DELETE")
    os.environ["RAW_DELETE"] = " ".join(delete)
    try:
        return list_source._push([LEDGER], "bounce ledger")
    finally:
        if old is None:
            os.environ.pop("RAW_DELETE", None)
        else:
            os.environ["RAW_DELETE"] = old


# ---------------------------------------------------------------- the fold step
def _lists():
    """The Daily, hail and notice rows (worker, or the private copy), unfiltered."""
    import list_source
    base, tok = (os.environ.get("LIST_URL") or "").rstrip("/"), os.environ.get("LIST_TOKEN") or ""
    q = urllib.parse.quote(tok)
    out = {}
    for name, path in (("daily", "/list?format=json&token=" + q), ("hail", "/alert-list?token=" + q),
                       ("notices", "/notice-list?token=" + q)):
        try:
            rows = list_source.request("GET", base + path)
            out[name] = [r for r in rows if isinstance(r, dict) and r.get("email")] if isinstance(rows, list) else []
        except Exception as ex:                            # noqa: BLE001
            print("::warning::the %s list was not read (%s)" % (name, type(ex).__name__))
            out[name] = None
    return out


def _issue(count, limit):
    """Open (or leave open) one issue, counts only. True when it is there."""
    tok, repo = os.environ.get("GH_TOKEN") or "", os.environ.get("GITHUB_REPOSITORY") or ""
    if not (tok and repo):
        print("::warning::no GH_TOKEN or GITHUB_REPOSITORY: the held-suppression issue was not opened")
        return False
    h = {"Authorization": "Bearer " + tok, "Accept": "application/vnd.github+json", "User-Agent": "agsist-bounces"}

    def gh(method, path, body=None):
        req = urllib.request.Request("https://api.github.com" + path, method=method, headers=h,
                                     data=json.dumps(body).encode() if body is not None else None)
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode() or "null")
    try:
        for it in gh("GET", "/repos/%s/issues?state=open&per_page=100" % repo) or []:
            if it.get("title") == ISSUE_TITLE and "pull_request" not in it:
                return True
        gh("POST", "/repos/%s/issues" % repo, {"title": ISSUE_TITLE, "body": (
            "The daily bounce fold would have set aside %d addresses at once, over its limit of %d. "
            "Nobody new was set aside. The owner has the details by email. If they are right, run the "
            "list cleanup by hand with accept_suppression ticked." % (count, limit))})
        return True
    except Exception as ex:                                # noqa: BLE001
        print("::warning::the held-suppression issue was not opened (%s)" % type(ex).__name__)
        return False


def fold_main(dry=False):
    """The fold step. Reads no mail: the inbox step handed over keys only (BOUNCE_EVENTS_IN)."""
    import log_safe
    try:
        key("x")
    except NoKey:
        print("::warning::UNSUB_SECRET is not set: bounces not folded")
        return 0
    inbox = []
    fin = os.environ.get("BOUNCE_EVENTS_IN") or ""
    if fin and os.path.exists(fin):
        try:
            inbox = [e for e in json.load(open(fin)) if isinstance(e, dict)]
        except ValueError:
            print("::warning::the inbox step's bounce file did not parse; its notices are read again tomorrow")
    try:
        led0 = read_ledger()
        sent_ev, files = read_events()
    except Exception as ex:                                # noqa: BLE001
        print("::warning::the bounce ledger was not read (%s); nothing folded" % type(ex).__name__)
        return 0
    lists = _lists()
    names, optins = {}, {}
    for name in ("daily", "hail", "notices"):
        for r in lists.get(name) or []:
            k = key(r["email"])
            names.setdefault(k, r["email"])
            ts = r.get("ts") or r.get("confirmed") or r.get("confirmed_at")
            if ts and _day_of_ts(ts) > _day_of_ts(optins.get(k)):
                optins[k] = ts
    unsup = [x.strip().lower() for x in re.split(r"[,\s]+", os.environ.get("UNSUPPRESS") or "") if "@" in x]
    accept = (os.environ.get("BOUNCE_ACCEPT") or "").strip() in ("1", "true")
    size = len(lists.get("daily") or [])
    led, ch = fold(led0, inbox + sent_ev, undo=[key(u) for u in unsup], optins=optins, list_size=size, accept=accept)
    print("bounce fold: %d inbox and %d send-time events from %d file(s), %d new; suppressed %d in all, %d new, "
          "%d put back, %d held by the ceiling" % (len(inbox), len(sent_ev), len(files), len(ch["recorded"]),
                                                   len(led["suppressed"]), len(ch["suppressed"]), len(ch["undone"]),
                                                   len(ch["held"])))
    who = lambda h: names.get(h) or "an address on no list read (key %s)" % h[:8]
    notes = []
    for h in sorted(set(ch["recorded"]) - set(ch["suppressed"]) - set(ch["held"])):
        notes.append("Hard bounce on %d of %d days: %s" % (len(counted_days(led["addr"][h])), SUPPRESS_AFTER, who(h)))
    for h in ch["suppressed"]:
        notes.append("Suppressed after hard bounces on %d days, left out of every list (subscription kept): %s"
                     % (SUPPRESS_AFTER, who(h)))
    for h in ch["undone"]:
        notes.append("Back on the lists (undone, or signed up again): %s" % who(h))
    if ch["held"]:
        notes = ["HELD: %d addresses would have been suppressed at once (limit %d). Nobody new was. If this is "
                 "right, run the list cleanup by hand with accept_suppression ticked." % (len(ch["held"]), led["held"]["limit"])] \
            + ["Would have been suppressed: %s" % who(h) for h in ch["held"]] + [""] + notes
    if dry:
        print("dry run: the ledger is not saved")
        return 0
    if not write_ledger(led, delete=files):
        print("::warning::the bounce ledger was not saved; the inbox notices are read again tomorrow")
        return 0
    if notes:
        log_safe.owner_mail("AGSIST bounces: %d new, %d suppressed, %d held" % (len(ch["recorded"]), len(ch["suppressed"]),
                                                                              len(ch["held"])),
                            notes + ["", "Undo: run the list cleanup by hand with the address in the LIST_UNSUPPRESS secret."])
    if ch["held"]:
        print("::warning::bounce suppression held: %d at once, over the limit of %d" % (len(ch["held"]), led["held"]["limit"]))
        _issue(len(ch["held"]), led["held"]["limit"])
    return 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        import test_send_pace
        sys.exit(test_send_pace.main())
    if "--fold" in sys.argv:
        sys.exit(fold_main(dry="--dry-run" in sys.argv))
    sys.exit(0)
