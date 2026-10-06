#!/usr/bin/env python3
"""THE PERSONAL LINE IN AGSIST DAILY, END TO END, WITH NOTHING SENT.

    python3 scripts/test_send_daily_local.py

Runs send_daily.main() in DRY_RUN against a fake subs worker on 127.0.0.1 and
a small bids mirror written to a temp dir, so it needs no network and no
secrets:

  * worker v5.4 (format=json): a reader with a ZIP gets "Near <town>, ST: top
    corn bid ..." as the first thing after the date; a ZIP with nothing
    within 50 mi says so; a ZIP with no centroid gets nothing local; a reader
    with no ZIP gets the "Add your ZIP" line; everyone gets "Forward to a
    neighbor" with https://agsist.com/?ref=email-forward.
  * an older worker that ignores format=json (plain 200): everyone gets the
    email as before -- no local line, no ZIP ask.
  * a worker that refuses format=json with a 4xx: same, from the plain list.
  * bids that cannot be read: no "no bid within 50 mi" claim for anyone.
  * each ZIP is computed once, however many readers share it.

The bid numbers in the mirror are made up for the test and say so in the
place names; the rule itself is checked against the homepage's JS by
scripts/daily-local-bid-checks.mjs.
"""
import contextlib
import io
import json
import os
import sys
import tempfile
import threading
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

fails, passes = [], 0


def check(cond, msg):
    global passes
    if cond:
        passes += 1
    else:
        fails.append(msg)


# ── a bids mirror: two boards near 54728, one near 67801, nothing near 54102 ──
NOW = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
YM = datetime.now(timezone.utc).strftime("%Y-%m")


def place(op, city, st, lat, lon, corn, soy, basis_c=-50):
    now = {}
    if corn is not None:
        now["corn"] = {"cash": corn, "basis": basis_c / 100, "basisCents": basis_c, "period": "spot", "commodity": "Corn"}
    if soy is not None:
        now["soybeans"] = {"cash": soy, "basis": -0.8, "basisCents": -80, "period": "spot", "commodity": "Soybeans"}
    return {"place": op + "||" + city + "|" + st, "operator": op, "branch": None, "city": city, "state": st,
            "lat": lat, "lon": lon, "currency": "USD", "pricedAt": NOW, "checkedAt": NOW, "now": now}


mirror = tempfile.mkdtemp(prefix="bids-mirror-")
os.makedirs(os.path.join(mirror, "data", "zips"))
os.makedirs(os.path.join(mirror, "geocodes"))
idx = {"generated": NOW, "places": [
    place("Test Board A", "Testville", "WI", 45.40, -91.70, 4.3775, 10.105),   # ~6 mi from 54728
    place("Test Board B", "Otherton", "WI", 45.10, -91.50, 4.41, None, -45),     # ~17 mi, higher corn
    place("Test Board C", "Plainsburg", "KS", 37.80, -100.00, 5.3175, 12.075),   # near 67801
]}
json.dump(idx, open(os.path.join(mirror, "data", "merged-index.json"), "w"))
json.dump({"54728": [45.317, -91.6542], "54102": [45.4, -88.1], "54999": [0, 0]},
          open(os.path.join(mirror, "data", "zips", "54.json"), "w"))
json.dump({"67801": [37.75, -100.02]}, open(os.path.join(mirror, "data", "zips", "67.json"), "w"))
json.dump({"zips": {"54728": ["Chetek", "WI"], "67801": ["Dodge City", "KS"], "54102": ["Amberg", "WI"]}},
          open(os.path.join(mirror, "geocodes", "zip-towns.json"), "w"))

LIST = [
    {"email": "a@farm.com", "zip": "54728", "src": "hero", "ts": 1, "reports": True},
    {"email": "b@farm.com", "zip": "54728", "src": "bid-row", "ts": 2, "reports": False},
    {"email": "c@farm.com", "zip": "67801", "src": "footer", "ts": 3, "reports": True},
    {"email": "d@farm.com", "zip": "54102", "src": "bar", "ts": 4, "reports": True},
    {"email": "e@farm.com", "zip": None, "src": "", "ts": 5, "reports": True},
    {"email": "f@farm.com", "zip": "54999", "src": "", "ts": 6, "reports": True},
]
MODE = {"m": "json"}


class Worker(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        if not self.path.startswith("/list?token=tok"):
            self.send_response(403); self.end_headers(); return
        if "format=json" in self.path and MODE["m"] == "json":
            body, ct = json.dumps(LIST), "application/json"
        elif "format=json" in self.path and MODE["m"] == "refuse":
            self.send_response(400); self.end_headers(); return
        else:
            body, ct = "\n".join(r["email"] for r in LIST), "text/plain;charset=utf-8"
        self.send_response(200)
        self.send_header("Content-Type", ct)
        self.end_headers()
        self.wfile.write(body.encode())


srv = HTTPServer(("127.0.0.1", 0), Worker)
threading.Thread(target=srv.serve_forever, daemon=True).start()

os.environ.update({"LIST_URL": "http://127.0.0.1:%d" % srv.server_port, "LIST_TOKEN": "tok",
                   "SMTP_USER": "sender@example.com", "DRY_RUN": "1", "BIDS_BASE": mirror,
                   "UNSUB_SECRET": "s"})
os.environ.pop("LOCAL_BIDS", None)
os.environ.pop("GITHUB_STEP_SUMMARY", None)

import send_daily  # noqa: E402
import local_bid   # noqa: E402

archive = sorted((ROOT / "data" / "daily-archive").glob("20*.json"))[-1]
day = archive.stem
send_daily.load_today = lambda: (day, json.load(open(archive)))
send_daily.load_elevator_lines = lambda: {}


def run():
    send_daily.LOCAL_LINES.clear()
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        rc = send_daily.main()
    return rc, buf.getvalue()


def text_for(addr):
    m = send_daily.build_email(day, json.load(open(archive)), addr, "AGSIST Daily", "sender@example.com", None)
    return m.get_body(("plain",)).get_content(), m.get_body(("html",)).get_content()


# 1. worker v5.4
calls = {"n": 0}
real_top = local_bid.top_for_zip


def counting(data, z, now=None):
    calls["n"] += 1
    return real_top(data, z, now)


local_bid.top_for_zip = counting
rc, out = run()
check(rc == 0, "dry run exits 0: " + out[-400:])
check(calls["n"] == 4, "each ZIP computed once (54728 x2, 67801, 54102, 54999): %d calls" % calls["n"])
check("recipient list fetched live from worker (json)" in out, "json list used")
check("preview per recipient: 3 with a local top bid, 1 told nothing posted within 50 mi, 1 asked to add a ZIP, 1 unchanged" in out,
      "per-recipient preview count: " + [l for l in out.splitlines() if l.startswith("preview")][0:1].__repr__())
ta, ha = text_for("a@farm.com")
first = ta.split("\n")
check(first[0].startswith("AGSIST DAILY") and first[2] == "", "masthead, date, blank")
check(first[3] == "Near Chetek, WI: top corn bid $4.41 (Test Board B, 17 mi), soybeans $10.10 1/2 (Test Board A, 6 mi).",
      "54728 opening line: %r" % first[3])
check(first[4] == "  Corn: %s delivery, −45¢ basis, Otherton, WI." % local_bid.month_short(YM), "54728 corn detail: %r" % first[4])
check("Straight-line miles" in first[6], "the note follows the detail")
check("Forward to a neighbor. Or send them the free sign-up link: https://agsist.com/?ref=email-forward" in ta, "forward line in text")
check("Add your ZIP" not in ta, "a reader with a ZIP is not asked for one")
check('href="https://agsist.com/?ref=email-forward"' in ha, "forward link in html")
check(ha.find("Near Chetek, WI") < ha.find("AGSIST DAILY &middot;") or ha.find("Near Chetek, WI") > 0, "local line in html")
check(ha.index("Near Chetek, WI") < ha.index("Charts, calls and the full issue"), "local line sits above the button")
tc, _ = text_for("c@farm.com")
check("Near Dodge City, KS: top corn bid $5.31 3/4 (Test Board C, " in tc, "67801 line")
td, _ = text_for("d@farm.com")
check("Near Amberg, WI: No posted corn bid within 50 mi, nor soybeans." in td, "54102: nothing within 50 mi, said plainly")
check("Straight-line" not in td, "no source note under a line with no bid")
te, he = text_for("e@farm.com")
check("Add your ZIP to get your local top bid at the top of this email: https://agsist.com/#signup-full" in te, "no-ZIP reader asked once")
check(te.count("Add your ZIP") == 1 and "Near " not in te.split("\n")[3], "ask is one line, not at the top")
check('href="https://agsist.com/#signup-full"' in he, "ask link in html")
tf, _ = text_for("f@farm.com")
check("Near " not in tf and "Add your ZIP" not in tf, "ZIP with no centroid (0,0): nothing local, no ask")
check("Forward to a neighbor" in tf, "but still the forward line")

# 2. an older worker: plain 200 to format=json
MODE["m"] = "plain"
rc, out = run()
check(rc == 0 and "(plain)" in out, "older worker read as the plain list")
t, _ = text_for("a@farm.com")
check("Near " not in t and "Add your ZIP" not in t and "Forward to a neighbor" in t, "older worker: no local line, no ask, forward stays")
check("6 unchanged (6 older list without zips" in out, "preview counts the plain list as unchanged")

# 3. a worker that refuses format=json
MODE["m"] = "refuse"
rc, out = run()
check(rc == 0 and "format=json refused (HTTP 400)" in out and "(plain)" in out, "4xx on format=json falls back to the plain list")

# 4. bids unreadable: never claims "nothing within 50 mi"
MODE["m"] = "json"
os.environ["BIDS_BASE"] = os.path.join(mirror, "missing")
local_bid.top_for_zip = real_top
rc, out = run()
t, _ = text_for("a@farm.com")
check(rc == 0 and "Near " not in t and "within 50 mi" not in t, "unreadable bids: no local claim at all")
t, _ = text_for("e@farm.com")
check("Add your ZIP" in t, "the ZIP ask does not depend on the bids")

# 5. LOCAL_BIDS=0 (the port check failed in daily.yml)
os.environ["BIDS_BASE"] = mirror
os.environ["LOCAL_BIDS"] = "0"
rc, out = run()
t, _ = text_for("a@farm.com")
check("Near " not in t and "LOCAL_BIDS=0" in out, "LOCAL_BIDS=0 turns the line off")
os.environ.pop("LOCAL_BIDS", None)

# 6. the Gmail projection runs on every send
check("gmail limit: projected" in out, "gmail projection printed")

srv.shutdown()
if fails:
    for f in fails:
        print("FAIL", f)
    print("%d passed, %d failed" % (passes, len(fails)))
    sys.exit(1)
print("send_daily local line: %d passed" % passes)
