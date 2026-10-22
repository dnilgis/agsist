#!/usr/bin/env python3
"""THE READER'S OWN ELEVATORS IN AGSIST DAILY, AND THE NEAR-YOU LINES.

    python3 scripts/test_daily_elevators.py

Made-up readers and made-up boards (every name says so), a bids mirror and
a data/bids-prev written to a temp dir, a fixed clock (Tue Oct 20 2026, 6:00
AM CT), no network:

  * per reader: saved elevators (worker v5.42 `el`) and watched ones, corn
    and soybeans, cash, basis, the change from the previous trading day, the
    posting time; a reader with none gets no block;
  * change math in quarter cents;
  * (a) a basis move of exactly BASIS_MOVE_C is a line, a quarter cent less
    is not; a move the cash did not follow (a roll) is not; one line per
    company; a move against anything but the day right before is not;
  * (b) pays PAYS_MORE_C over the reader's best own elevator: only the
    morning the gap opens, same delivery period only;
  * boards not read this morning (skipped and held, broken), a price older
    than the previous trading day, and a stale data/index.json never make a
    near-you line;
  * no ZIP, or a ZIP with no centroid: no near-you lines;
  * the block is at most 6 lines;
  * send_daily: the footer link is signed like the unsubscribe link, the
    email carries the block in both parts, and nothing it prints holds an
    address.
"""
import contextlib
import hashlib
import hmac
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
import local_bid as lb          # noqa: E402
import daily_elevators as de    # noqa: E402

fails, passes = [], 0


def check(cond, msg):
    global passes
    if cond:
        passes += 1
    else:
        fails.append(msg)


NOW = datetime(2026, 10, 20, 11, 0, tzinfo=timezone.utc)        # Tue 6:00 AM CT
POSTED = "2026-10-20T10:30:00.000Z"                              # 5:30 AM CT
OLD_POST = "2026-10-15T19:00:00.000Z"                            # last Thursday
HOME = (45.3150, -91.6510)                                       # ZIP 54728's made-up centroid


def place(op, city, st, lat, lon, corn=None, soy=None, cb=-40, sb=-60, priced=POSTED, src=None, period="2026-10"):
    now = {}
    if corn is not None:
        now["corn"] = {"cash": corn, "basisCents": cb, "basis": cb / 100, "period": period, "commodity": "Corn"}
    if soy is not None:
        now["soybeans"] = {"cash": soy, "basisCents": sb, "basis": sb / 100, "period": period, "commodity": "Soybeans"}
    key = op + "||" + city + "|" + st
    return {"place": key, "operator": op, "branch": None, "city": city, "town": None, "state": st,
            "lat": lat, "lon": lon, "currency": "USD", "now": now, "pricedAt": priced, "checkedAt": priced,
            "source": src or (op.lower().replace(" ", "") + "-" + city.lower().replace(" ", ""))}


def prev_rows(places, hist):
    """hist: place key -> {crop: [(date, cash, basis), ...]}"""
    rows = {}
    for p in places:
        for crop, n in p["now"].items():
            h = (hist.get(p["place"]) or {}).get(crop)
            if h:
                rows[de.fnv(p["place"] + "|" + crop + "|" + n["period"])] = [list(x) for x in h]
    return rows


def build(places, hist, status=None, index_generated="2026-10-20T10:45:00.000Z"):
    d = tempfile.mkdtemp(prefix="dailybids-")
    os.makedirs(d + "/data/zips")
    os.makedirs(d + "/geocodes")
    os.makedirs(d + "/prev")
    json.dump({"places": places}, open(d + "/data/merged-index.json", "w"))
    st = status or {}
    json.dump({"generated": index_generated,
               "sources": [{"id": p["source"], "status": st.get(p["source"], "ok")} for p in places]},
              open(d + "/data/index.json", "w"))
    json.dump({"54728": list(HOME)}, open(d + "/data/zips/54.json", "w"))
    json.dump({"zips": {"54728": ["Chetek", "WI"]}}, open(d + "/geocodes/zip-towns.json", "w"))
    by_state = {}
    for p in places:
        by_state.setdefault(p["state"], []).append(p)
    for s, ps in by_state.items():
        json.dump({"rows": prev_rows(ps, hist)}, open(d + "/prev/" + s + ".json", "w"))
    return de.Boards(lb.BidsData(d), now=NOW, prev_dir=d + "/prev"), d


# Twenty far-off boards (Kansas) so the day's typical futures move is known:
# corn futures +2c, soybeans -3c from Mon to Tue (cash change minus basis change).
FILL = [place("Test Filler Coop %d" % i, "Fillertown %d" % i, "KS", 38.0 + i * 0.01, -98.0, corn=4.00, soy=10.00) for i in range(20)]
FILL_H = {p["place"]: {"corn": [("2026-10-19", 3.98, -40)], "soybeans": [("2026-10-19", 10.03, -60)]} for p in FILL}

# Near Chetek. Corn futures +2, beans -3 from Mon.
MINE1 = place("Test Home Grain", "Chetek", "WI", 45.31, -91.65, corn=4.12, soy=9.80, cb=-38, sb=-62)
MINE2 = place("Test Second Elevator", "Cameron", "WI", 45.40, -91.74, corn=4.05, soy=9.70, cb=-45, sb=-72)
MOVER = place("Test Basis Mover Coop", "Rice Lake", "WI", 45.50, -91.73, corn=4.30, soy=9.90, cb=-30, sb=-60)        # corn basis +10 from Mon
MOVER_B = place("Test Basis Mover Coop", "Barron", "WI", 45.40, -91.85, corn=4.30, soy=9.90, cb=-30, sb=-60)         # same company, same move
NINE = place("Test Almost Coop", "Bloomer", "WI", 45.10, -91.49, corn=4.1975, soy=9.90, cb=-30.25, sb=-60)           # +9.75: not a line
ROLL = place("Test Roll Grain", "New Auburn", "WI", 45.20, -91.56, corn=4.10, soy=9.90, cb=-28, sb=-60)              # basis +12, cash flat: a roll
HELD = place("Test Held Board", "Turtle Lake", "WI", 45.39, -92.14, corn=4.40, soy=9.90, cb=-20, sb=-60)             # +20 but not read this pass
BROKEN = place("Test Broken Board", "Spooner", "WI", 45.82, -91.89, corn=4.40, soy=9.90, cb=-20, sb=-60)
OLDP = place("Test Old Posting", "Ladysmith", "WI", 45.46, -91.10, corn=4.40, soy=9.90, cb=-20, sb=-60, priced=OLD_POST)
GAPPY = place("Test Gap Days", "Colfax", "WI", 44.99, -91.73, corn=4.40, soy=9.90, cb=-20, sb=-60)                    # compared with last Thu
FAR = place("Test Far Away", "Madison", "WI", 43.07, -89.40, corn=4.60, soy=9.90, cb=-10, sb=-60)                     # 150 mi
PAYS = place("Test Pays More", "Chippewa Falls", "WI", 44.94, -91.39, soy=10.05, sb=-40)                              # beans 25 over MINE1, was 15
PAYS_OLD = place("Test Always More", "Eau Claire", "WI", 44.81, -91.50, corn=4.40, cb=-32)                             # corn 28 over, was 28: not new

H = dict(FILL_H)
H[MINE1["place"]] = {"corn": [("2026-10-16", 4.07, -40), ("2026-10-19", 4.09, -40)], "soybeans": [("2026-10-19", 9.85, -64)]}
H[MINE2["place"]] = {"corn": [("2026-10-19", 4.03, -45)], "soybeans": [("2026-10-19", 9.73, -72)]}
H[MOVER["place"]] = {"corn": [("2026-10-19", 4.18, -40)], "soybeans": [("2026-10-19", 9.93, -60)]}
H[MOVER_B["place"]] = {"corn": [("2026-10-19", 4.18, -40)]}
H[NINE["place"]] = {"corn": [("2026-10-19", 4.08, -40)]}
H[ROLL["place"]] = {"corn": [("2026-10-19", 4.10, -40)]}
H[HELD["place"]] = {"corn": [("2026-10-19", 4.18, -40)]}
H[BROKEN["place"]] = {"corn": [("2026-10-19", 4.18, -40)]}
H[OLDP["place"]] = {"corn": [("2026-10-14", 4.18, -40)]}
H[GAPPY["place"]] = {"corn": [("2026-10-15", 4.18, -40)]}
H[FAR["place"]] = {"corn": [("2026-10-19", 4.28, -40)]}
H[PAYS["place"]] = {"soybeans": [("2026-10-19", 10.00, -45)]}
H[PAYS_OLD["place"]] = {"corn": [("2026-10-19", 4.37, -32)]}

ALL = FILL + [MINE1, MINE2, MOVER, MOVER_B, NINE, ROLL, HELD, BROKEN, OLDP, GAPPY, FAR, PAYS, PAYS_OLD]
STATUS = {HELD["source"]: "skipped", BROKEN["source"]: "broken"}
B, MIRROR = build(ALL, H, STATUS)

# ── change math and the reader's own lines ────────────────────────────────
f = B.fact(MINE1, "corn")
check(f["chg"] == 3.0 and f["bchg"] == 2 and f["since"] == "2026-10-19", "corn change from Mon: +3c cash, +2c basis %r" % (f,))
line = de.own_line(B, MINE1)
check(line == "Test Home Grain, Chetek WI: corn $4.12 (up 3¢), basis −38¢ (up 2¢); soybeans $9.80 (down 5¢), basis −62¢ (up 2¢). "
              "Posted 5:30 AM CT, change from Mon.", "own line: " + line)
check(de.chg_txt(-4.5) == "down 4 1/2¢" and de.chg_txt(0.1) == "unch" and de.chg_txt(None) == "", "change words in quarter cents")

reader = {"email": "made-up-reader@example.com", "zip": "54728", "el": [de.place_id(MINE1["place"])]}
blk = de.block_for(B, reader)
check(blk and blk["mine"] == [line], "the saved elevator is the reader's own line")
near = blk["near"]
check(len(near) == 2, "two near-you lines, got %d: %r" % (len(near), near))
check(any(x.startswith("Basis up 10¢ at Test Basis Mover Coop, ") and "corn $4.30, basis −30¢ (was −40¢ Mon). Posted 5:30 AM CT." in x for x in near),
      "the 10c basis move is a line: %r" % near)
check(sum("Test Basis Mover Coop" in x for x in near) == 1, "one line per company (Rice Lake and Barron moved together)")
check(any(x.startswith("Test Pays More, Chippewa Falls WI, ") and "pays 25¢ over your best soybean bid (Test Home Grain): $10.05, basis −40¢." in x for x in near),
      "the gap that opened this morning is a line: %r" % near)
txt = "\n".join(near)
for name in ("Test Almost Coop", "Test Roll Grain", "Test Held Board", "Test Broken Board", "Test Old Posting",
             "Test Gap Days", "Test Far Away", "Test Always More", "Test Home Grain,"):
    check(name not in txt, name + " is not a near-you line")
check(not any(w in txt.lower() for w in ("sell", "should", "consider", "opportunit")), "no advice words")

# the cases one at a time, alone near the reader, so ranking cannot hide them
def near_alone(p, hist=None, status=None, gen="2026-10-20T10:45:00.000Z", own=None):
    hh = dict(FILL_H, **(hist or {p["place"]: H[p["place"]]}))
    for o in own or []:
        hh[o["place"]] = H[o["place"]]
    b, _ = build(FILL + [p] + (own or []), hh, status, gen)
    return de.near_lines(b, HOME, own or [])

check(near_alone(NINE) == [], "9.75c is under the 10c threshold")
check(len(near_alone(MOVER)) == 1, "the mover alone is a line")
check(near_alone(ROLL) == [], "basis +12 with cash flat (a roll) is not a line")
check(near_alone(HELD, status={HELD["source"]: "skipped"}) == [], "a held (skipped) board is not a line")
check(near_alone(BROKEN, status={BROKEN["source"]: "broken"}) == [], "a broken board is not a line")
check(len(near_alone(HELD)) == 1, "the same board read this pass is a line")
check(near_alone(OLDP) == [], "a price older than the previous trading day is not a line")
check(near_alone(GAPPY) == [], "a move against last Thursday is not a day's move")
check(near_alone(FAR) == [], "150 mi is outside 50 mi")
check(near_alone(MOVER, gen="2026-10-19T20:00:00.000Z") == [], "a read status file 15 h old: nothing counts as read this morning")
thin, _ = build([MOVER], {MOVER["place"]: H[MOVER["place"]]})
check(de.near_lines(thin, HOME, []) == [], "too few boards to know the day's futures move: no move lines")
old = de.BASIS_MOVE_C
de.BASIS_MOVE_C = 9.75
check(len(near_alone(NINE)) == 1, "the threshold is read from BASIS_MOVE_C")
de.BASIS_MOVE_C = old
check(near_alone(PAYS_OLD, own=[MINE1]) == [], "a gap that was already there yesterday is not a line")
check(len(near_alone(PAYS, own=[MINE1])) == 1, "a gap that opened today is a line")
pays_nc = place("Test Pays More", "Chippewa Falls", "WI", 44.94, -91.39, soy=10.05, sb=-40, period="2026-11")
check(near_alone(pays_nc, hist={pays_nc["place"]: H[PAYS["place"]]}, own=[MINE1]) == [], "a different delivery period is not compared")

# ── readers ────────────────────────────────────────────────────────────────
check(de.block_for(B, {"email": "no-zip@example.com", "zip": None, "el": []}) is None, "no ZIP, nothing saved: no block")
nz = de.block_for(B, {"email": "no-zip2@example.com", "zip": None, "el": [de.place_id(MINE1["place"])]})
check(nz and nz["near"] == [] and nz["mine"] == [line], "no ZIP: own lines, no near-you lines")
check(de.block_for(B, {"email": "x@example.com", "zip": "99999", "el": []}) is None, "a ZIP with no centroid: nothing")
plain = de.block_for(B, {"email": "near-only@example.com", "zip": "54728"})
check(plain and plain["mine"] == [] and len(plain["near"]) == 1 and plain["near"][0].startswith("Basis up 10¢ at Test Basis Mover"),
      "a reader with a ZIP and nothing saved gets the move, never a pays-more line: %r" % (plain,))
watch = {de.wid_for("WI", "Test Second Elevator", "Cameron", "corn"): {"kind": "move", "ewid": de.wid_for("WI", "Test Second Elevator", "Cameron", "corn"), "label": "x"},
         "deadbeef": {"label": "Test Gone Elevator \u2014 corn"},
         "ab54728050": {"kind": "cash", "ewid": "ab54728050"}}
wb = de.block_for(B, {"email": "w@example.com", "zip": None, "el": [de.place_id(MINE1["place"])]}, watch)
check(wb["mine"][0].startswith("Test Home Grain") and wb["mine"][1].startswith("Test Second Elevator, Cameron WI: corn $4.05 (up 2¢)")
      and wb["mine"][2] == "Test Gone Elevator: not on the board this morning." and len(wb["mine"]) == 3,
      "saved first, then watched, a watch the network lacks says so, a ZIP-wide alert is no line: %r" % (wb["mine"],))
held_mine = de.own_line(B, HELD)
check(held_mine.endswith("Board not read this morning."), "an own elevator not read this pass says so: " + held_mine)
six = [de.place_id(p["place"]) for p in (MINE1, MINE2, MOVER, NINE, ROLL, FAR)]
big = de.block_for(B, {"email": "six@example.com", "zip": "54728", "el": six})
check(len(de.lines_of(big)) <= de.MAX_LINES == 6, "at most 6 lines: %d" % len(de.lines_of(big)))
check(big["mine"][-1].startswith("And ") and big["mine"][-1].endswith("more on agsist.com/cash-bids."), "the rest are counted, not listed")
dup = de.block_for(B, {"email": "d@example.com", "zip": None, "el": [de.place_id(MINE1["place"])] * 2})
check(len(dup["mine"]) == 1, "an id twice is one line")
amb = dict(MINE1, place=MINE1["place"])
b2, _ = build(FILL + [MINE1, dict(amb)], H)
check(de.block_for(b2, {"email": "a@example.com", "zip": None, "el": [de.place_id(MINE1["place"])]}) is None,
      "two places with one id are never guessed between")

subs = [{"email": "Made-Up-Reader@Example.com", "zip": "54728", "el": [de.place_id(MINE1["place"])]},
        {"email": "nothing@example.com", "zip": None},
        {"email": "near-only@example.com", "zip": "54728"}]
out, counts = de.blocks(B, subs, [{"email": "nothing@example.com", "w": {}}])
check(set(out) == {"made-up-reader@example.com", "near-only@example.com"}, "blocks by lowercase address")
check(counts == {"readers": 3, "with_own": 1, "with_near": 2, "with_both": 1, "with_zip_no_near": 0}, "counts %r" % counts)
check("@" not in json.dumps(counts), "counts carry no address")
check("@" not in json.dumps(list(out.values())), "blocks carry no address")

# ── send_daily: the footer link, both parts, and a clean log ───────────────
import send_daily  # noqa: E402
import brief_email  # noqa: E402

watch_rows = [{"email": "made-up-reader@example.com", "w": {}}]


class W(BaseHTTPRequestHandler):
    def do_GET(self):
        body = json.dumps(watch_rows).encode() if self.path.startswith("/elevator-watch-list") else b"[]"
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


srv = HTTPServer(("127.0.0.1", 0), W)
threading.Thread(target=srv.serve_forever, daemon=True).start()
os.environ.update({"LIST_URL": "http://127.0.0.1:%d" % srv.server_port, "LIST_TOKEN": "tok", "UNSUB_SECRET": "sec"})
# subs worker v5.46: the link ids main() takes from the list (made up here)
LIDS = {"made-up-reader@example.com": "000000000000rdr1", "nothing@example.com": "000000000000nth1",
        "near-only@example.com": "000000000000nr01"}
send_daily.LINK_IDS.clear()
send_daily.LINK_IDS.update(LIDS)
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    import daily_elevators
    _orig = daily_elevators.Boards
    daily_elevators.Boards = lambda data, now=None, prev_dir=None: _orig(data, now=NOW, prev_dir=MIRROR + "/prev")
    try:
        lines = send_daily.load_elevator_lines(subs, "json", bids_data=lb.BidsData(MIRROR))
    finally:
        daily_elevators.Boards = _orig
log = buf.getvalue()
check("@" not in log and "example.com" not in log, "the log names no address: " + log)
check("1 reader(s) with their own elevators, 2 with a near-you line" in log, "the log counts: " + log)
want_t = hmac.new(b"sec", b"000000000000rdr1|de", hashlib.sha256).hexdigest()[:16]
r1 = lines["made-up-reader@example.com"]
check(r1["add_url"] == "https://agsist.com/e?a=daily-elev&k=000000000000rdr1&t=" + want_t,
      "the footer link carries the link id, signed like the unsubscribe link (v5.46): " + str(r1["add_url"]))
check("@" not in r1["add_url"] and "%40" not in r1["add_url"], "the footer link carries no address")
check(lines["nothing@example.com"] == {"mine": [], "near": [], "add_url": send_daily.elevator_add_url("nothing@example.com")},
      "a reader with nothing gets only the footer link")
send_daily.ELEVATOR_LINES.clear()
send_daily.ELEVATOR_LINES.update(lines)
day = "2026-10-20"
archive = sorted((ROOT / "data" / "daily-archive").glob("2026-*.json"))[-1]
issue = json.load(open(archive))
m = send_daily.build_email(day, issue, "made-up-reader@example.com", "AGSIST Daily", "daily@example.com", None)
htm, tx = m.get_body(("html",)).get_content(), m.get_body(("plain",)).get_content()
for x in r1["mine"]:
    hd, _, rest = x.partition(": ")
    check("<strong>%s</strong>: %s" % (brief_email.e(hd), brief_email.e(rest)) in htm and x in tx, "own line in both parts, name in bold: " + x[:40])
for x in r1["near"]:
    check(brief_email.e(x) in htm and x in tx, "near line in both parts: " + x[:40])
check("NEAR YOU THIS MORNING" not in tx and "Near you this morning:" in tx, "near-you label in text")
check(brief_email.ELEVATOR_ADD_WORDS in htm and r1["add_url"] in tx, "footer link in both parts")
import email_links  # noqa: E402
check(not [u for u in email_links.hrefs(htm) if "@" in u or "%40" in u.lower()] and not email_links.bad_links(tx),
      "v5.46: no address inside any link of the Daily")
m0 = send_daily.build_email(day, issue, "nothing@example.com", "AGSIST Daily", "daily@example.com", None)
h0 = m0.get_body(("html",)).get_content()
check("Your elevators" not in h0 and "Near you" not in h0, "a reader with nothing sees no block")
send_daily.ELEVATOR_LINES.clear()
m00 = send_daily.build_email(day, issue, "nothing@example.com", "AGSIST Daily", "daily@example.com", None)
h00 = m00.get_body(("html",)).get_content()
check(h0.count("<tr>") == h00.count("<tr>") and len(h0) - len(h00) < 400, "otherwise the same email")
if os.environ.get("DUMP_SAMPLE"):
    open(os.environ["DUMP_SAMPLE"], "w").write(htm)
srv.shutdown()

if fails:
    for x in fails:
        print("FAIL", x)
    print("daily elevators: %d passed, %d FAILED" % (passes, len(fails)))
    sys.exit(1)
print("daily elevators: %d passed" % passes)
