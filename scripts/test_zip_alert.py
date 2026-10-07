#!/usr/bin/env python3
"""THE ZIP CASH ALERT, RUN END TO END WITHOUT SENDING ANYTHING.

    python3 scripts/test_zip_alert.py

send_zip_alert.py --selftest checks the pure parts. This runs main() itself,
in-process, against fixture files (a merged index, a ZIP table, the worker's
list), with the network, the worker and SMTP all replaced:
  1. DRY_RUN=1 from fixtures: prints what it would do; any SMTP connection,
     worker call or network fetch fails the test.
  2. A "send" run against a fake SMTP server and a fake worker that keeps the
     marks exactly as workers/subs-worker.js /elevator-watch-mark does, run
     several times as prices move: one email per crossing, none in between,
     and the elevator-watch sender never touches the same records.
No real email is ever sent and no real address is used.
"""
import contextlib
import io
import json
import os
import smtplib
import sys
import tempfile
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import send_elevator_watch as sew  # noqa: E402
import send_zip_alert as zal  # noqa: E402

NOW = datetime(2026, 10, 7, 21, 0, tzinfo=timezone.utc).timestamp() * 1000
T = "2026-10-07T18:41:05.604Z"
ok = 0


def A(c, m):
    global ok
    if not c:
        print("FAIL", m, file=sys.stderr)
        sys.exit(1)
    ok += 1


def index(prices):
    return {"places": [
        {"operator": op, "city": city, "state": "WI", "lat": lat, "lon": lon, "currency": "USD", "via": "scrape",
         "pricedAt": T, "now": {"corn": {"cash": cash, "basisCents": -60, "period": "2026-10", "delivery": "10/01/2026"}}}
        for op, city, lat, lon, cash in prices]}


def alert(target, **kw):
    st = {"kind": "cash", "ewid": "ab54728025", "crop": "corn", "period": "nearby", "plabel": "nearest delivery",
          "direction": "above", "target_cents": target, "label": "Any elevator within 25 mi of 54728"}
    st.update(kw)
    return st


class NoNet(Exception):
    pass


def refuse(*a, **k):
    raise NoNet("network used in a test")


tmp = Path(tempfile.mkdtemp(prefix="zip-alert-test-"))
(tmp / "zips").mkdir()
(tmp / "zips" / "54.json").write_text(json.dumps({"54728": [45.317, -91.6542]}))
os.environ.update({"ZIPS_DIR": str(tmp / "zips"), "NET_INDEX_FILE": str(tmp / "index.json"),
                   "WATCH_LIST_FILE": str(tmp / "list.json"), "NOW_MS": str(NOW)})
urllib.request.urlopen = refuse

# ---- 1. dry run from fixtures: nothing leaves the machine ----
(tmp / "index.json").write_text(json.dumps(index([("Near Coop", "Chetek", 45.32, -91.65, 4.55),
                                                  ("Mid Grain", "Rice Lake", 45.50, -91.73, 4.40)])))
(tmp / "list.json").write_text(json.dumps([{"email": "f@example.com",
    "pend": {"p1": dict(alert(450), ts=NOW - 1000, m=0)},
    "w": {"a1": dict(alert(450), k=None, s=None), "a2": dict(alert(500), k=None, s=None),
          "el": {"kind": "cash", "ewid": "1fa85c8e", "crop": "corn", "period": "2026-10", "plabel": "Oct 2026",
                 "direction": "above", "target_cents": 450, "label": "an elevator alert", "k": None, "s": None}}}]))
os.environ["DRY_RUN"] = "1"
for k in ("LIST_URL", "LIST_TOKEN", "UNSUB_SECRET"):
    os.environ.pop(k, None)
smtplib.SMTP = refuse
real_worker = sew.worker
sew.worker = refuse
out = io.StringIO()
with contextlib.redirect_stdout(out):
    rc = zal.main()
log = out.getvalue()
A(rc == 0, "dry run exits 0: " + log)
A("confirmations 1; alerts 1; re-armed 0" in log, log)
A("would confirm f@example.com p1 Any elevator within 25 mi of ZIP 54728, corn, nearest delivery: cash at or above $4.50" in log, log)
A("would alert f@example.com a1" in log and "top Near Coop $4.55 0 mi" in log, log)
A("a2" not in log and " el " not in log, "below the price, and an elevator alert, are not this job's: " + log)

# ---- 2. sends against fakes, run after run ----
os.environ.pop("DRY_RUN")
os.environ.update({"LIST_URL": "https://w.example", "LIST_TOKEN": "tok", "UNSUB_SECRET": "sec",
                   "SMTP_USER": "alerts@example.com", "SMTP_PASS": "x"})
zal.time.sleep = lambda s: None
outbox, marks = [], []


class FakeSMTP:
    def __init__(self, *a, **k):
        pass

    def starttls(self, **k):
        pass

    def login(self, *a):
        pass

    def send_message(self, m):
        A(m["To"].endswith("@example.com"), "only fixture addresses")
        outbox.append(m)

    def quit(self):
        pass


smtplib.SMTP = FakeSMTP
state = [{"email": "f@example.com", "pend": {}, "w": {"a1": dict(alert(450), k=None, s=None)}}]


def fake_worker(base, path, tok, body=None):
    """/elevator-watch-mark as the worker does it: a non-fired mark keeps the
    option fields and the label and replaces k and s; fired removes it."""
    A(path == "elevator-watch-mark" and tok == "tok", "only marks: " + path)
    marks.append(body)
    w = state[0]["w"]
    if body.get("fired"):
        w.pop(body["wid"], None)
    elif body.get("confirm_mailed"):
        state[0]["pend"][body["wid"]]["m"] = 1
    else:
        keep = {f: w[body["wid"]][f] for f in ("kind", "ewid", "crop", "period", "plabel", "direction", "target_cents")}
        w[body["wid"]] = dict(keep, label=w[body["wid"]]["label"], k=str(body.get("k") or ""), s=body.get("s") or {})
    return {"ok": True}


sew.worker = fake_worker


def run(price):
    (tmp / "index.json").write_text(json.dumps(index([("Near Coop", "Chetek", 45.32, -91.65, price)])))
    (tmp / "list.json").write_text(json.dumps(state))
    before = len(outbox)
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        rc_ = zal.main()
    A(rc_ == 0, "send run exits 0: " + buf.getvalue())
    return len(outbox) - before


sent = [run(p) for p in (4.55, 4.60, 4.52, 4.40, 4.45, 4.50, 4.80, 4.49, 4.51)]
A(sent == [1, 0, 0, 0, 0, 1, 0, 0, 1], f"one email per crossing: {sent}")
A(all("fired" not in m for m in marks), "never removed: it re-arms")
A(state[0]["w"]["a1"]["s"]["on"] is True and state[0]["w"]["a1"]["target_cents"] == 450, state)
body = outbox[0].get_body(("plain",)).get_content()
for part in ("Near Coop, Chetek, WI · 0 mi · Oct 2026 · $4.55 · posted Oct 7, 1:41 PM CT",
             "elevator-watch-unsubscribe?e=f%40example.com&w=a1&t="):
    A(part in body, part)
A(outbox[0]["List-Unsubscribe"].startswith("<https://w.example/elevator-watch-unsubscribe?"), "one-click unsubscribe header")

# The elevator-watch sender sees the same list and plans nothing for these records.
A(sew.plan_alerts(state, sew.load_net_index(json.loads((tmp / "index.json").read_text()), NOW), NOW) == ([], [], [], []),
  "send_elevator_watch.py leaves ZIP alerts alone")

# A send that fails is never marked.
class Broken(FakeSMTP):
    def send_message(self, m):
        raise smtplib.SMTPRecipientsRefused({})


smtplib.SMTP = Broken
state[0]["w"]["a1"] = dict(alert(450), k=None, s=None)
n_marks = len(marks)
(tmp / "index.json").write_text(json.dumps(index([("Near Coop", "Chetek", 45.32, -91.65, 4.60)])))
(tmp / "list.json").write_text(json.dumps(state))
with contextlib.redirect_stdout(io.StringIO()):
    A(zal.main() == 1, "all sends failed: exit 1")
A(len(marks) == n_marks, "a failed send writes no mark, so the next run tries again")
sew.worker = real_worker
print(f"zip alert end-to-end ok {ok} checks")
