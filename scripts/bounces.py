#!/usr/bin/env python3
"""
bounces.py: hard bounces per address, and the addresses left out of every list after two
(Nov 10, 2026).

Nothing here holds an address. An address is kept as its key, the first 32 hex characters of
sha256 of the lowercased address, in the private repo (branch private-data):

  private/bounces/events/<day>-<sender>-<run>.jsonl
      one line per hard bounce a sender saw at send time (scripts/send_pace.py: a 5xx for the
      address itself), {"h", "code", "src": "smtp", "id", "day"}. Written at the end of the run.
  private/bounces/ledger.json
      {"v": 1, "updated", "addr": {key: {"ids": {id: {"day", "code", "src"}}, "undo": day?}},
       "suppressed": [key, ...]}
      Written by scripts/list_hygiene.py once a day: it folds in the event files and the
      delivery-failure notices it reads in the inbox (a 5.x.x status for the address).

An address with SUPPRESS_AFTER (2) distinct hard bounces after its "undo" day (none: every one
counts) is suppressed: list_source.py leaves it out of every list a sender reads, and the
sender's DELIVERY line says how many were left out (suppressed=N). It is a flag, never a delete:
the worker keeps the subscription, and an "undo" day (the LIST_UNSUPPRESS secret on a hand run of
list-hygiene.yml, or a hand edit of the ledger) puts the address back; only hard bounces after
that day count again. A soft bounce (4xx, a deferral) is never recorded here.

Counts only in any log.

    python3 scripts/bounces.py --selftest     (the tests are in scripts/test_send_pace.py)
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass

import atexit
import hashlib
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

SUPPRESS_AFTER = 2
DIR = "private/bounces"
LEDGER = DIR + "/ledger.json"
EVENTS = DIR + "/events"
KEY_RE = re.compile(r"^[0-9a-f]{32}$")

PENDING = []                  # this run's send-time hard bounces, saved at exit when armed
STATE = {"armed": False, "sender": "", "saved": False}


def key(addr):
    return hashlib.sha256(str(addr or "").strip().lower().encode("utf-8")).hexdigest()[:32]


def _today():
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _run_id():
    r = os.environ.get("GITHUB_RUN_ID") or ""
    a = os.environ.get("GITHUB_RUN_ATTEMPT") or "1"
    return re.sub(r"[^\w.-]", "_", ("%s.%s" % (r, a)) if r else "local%d" % os.getpid())


def record(addr, code="", sender=""):
    """One hard bounce seen at send time. Kept in memory; saved at exit when this run is armed."""
    if not addr:
        return None
    sender = re.sub(r"[^a-z0-9-]", "", (sender or STATE["sender"] or "send").lower())[:40] or "send"
    ev = {"h": key(addr), "code": re.sub(r"[^\w. ]", "", str(code or ""))[:20], "src": "smtp",
          "id": "smtp:%s:%s:%d" % (sender, _run_id(), len(PENDING)), "day": _today()}
    PENDING.append(ev)
    return ev


def arm(sender):
    """Save this run's send-time hard bounces to the private repo at exit (delivery_line.start)."""
    STATE["sender"] = sender or STATE["sender"]
    if not STATE["armed"]:
        STATE["armed"] = True
        atexit.register(save)


def save():
    """Write and push this run's events. True when there was nothing to save or it was saved."""
    if not PENDING or STATE["saved"]:
        return True
    STATE["saved"] = True
    try:
        import list_source
        name = "%s/%s-%s-%s.jsonl" % (EVENTS, _today(), STATE["sender"] or "send", _run_id())
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
    return {"v": 1, "updated": "", "addr": {}, "suppressed": []}


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


def counted(entry):
    """The hard bounces that count: those after the entry's undo day."""
    undo = entry.get("undo") or ""
    return [i for i, e in (entry.get("ids") or {}).items() if not undo or str(e.get("day") or "") > undo]


def fold(ledger, events, today=None, undo=()):
    """Add events [{"h", "id", "day", "code", "src"}] and undo keys to a ledger.
    -> (ledger, {"recorded": [key], "suppressed": [key], "undone": [key]}) (keys new this fold)."""
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
    sup = sorted(h for h, ent in led["addr"].items() if len(counted(ent)) >= SUPPRESS_AFTER)
    led["suppressed"] = sup
    led["updated"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return led, {"recorded": recorded, "suppressed": sorted(set(sup) - before), "undone": undone}


def suppressed_keys(ledger):
    """The suppressed keys of a ledger, worked out again from its entries (a hand edit of an undo day counts)."""
    return {h for h, ent in (ledger.get("addr") or {}).items()
            if KEY_RE.match(h) and len(counted(ent)) >= SUPPRESS_AFTER}


def read_ledger():
    """The ledger in the private repo (a local file when LIST_BACKUP_FILE is set).
    Raises list_source.Unavailable when the private repo cannot be read."""
    import list_source
    if os.environ.get("LIST_BACKUP_FILE"):
        p = list_source.FLAG_ROOT / LEDGER
        return parse(p.read_bytes() if p.exists() else None)
    return parse(list_source._show(LEDGER))


def read_events():
    """Every send-time event file in the private repo -> [event]. Raises list_source.Unavailable."""
    import list_source
    out = []
    if os.environ.get("LIST_BACKUP_FILE"):
        d = list_source.FLAG_ROOT / EVENTS
        files = [(p.name, p.read_bytes()) for p in sorted(d.glob("*.jsonl"))] if d.exists() else []
    else:
        if not list_source._fetch_private():
            raise list_source.Unavailable("the private repo could not be read (PRIVATE_REPO_TOKEN)")
        r = subprocess.run(["git", "ls-tree", "--name-only", "%s:%s" % (list_source.LOCAL_REF, EVENTS)],
                           cwd=str(list_source.ROOT), capture_output=True, timeout=120)
        names = [n for n in r.stdout.decode("utf-8", "replace").split() if n.endswith(".jsonl")] if r.returncode == 0 else []
        files = [(n, list_source._show(EVENTS + "/" + n) or b"") for n in names]
    for _n, raw in files:
        for ln in raw.decode("utf-8", "replace").splitlines():
            try:
                e = json.loads(ln)
            except ValueError:
                continue
            if isinstance(e, dict):
                out.append(e)
    return out


def write_ledger(ledger):
    """Write the ledger and push it. True when saved."""
    import list_source
    p = list_source.FLAG_ROOT / LEDGER
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(ledger, sort_keys=True, indent=1) + "\n")
    if os.environ.get("LIST_BACKUP_FILE"):
        return True
    return list_source._push([LEDGER], "bounce ledger")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        import test_send_pace
        sys.exit(test_send_pace.main())
    sys.exit(0)
