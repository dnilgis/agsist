#!/usr/bin/env python3
"""
daily_elevators.py -- a Daily reader's own elevators, and at most two lines
about elevators near them, for AGSIST Daily (Sig, 2026-10-20: "if a person has
a saved elevator, can we include those elevator bids in those persons daily
emails, and maybe if we see an elevator that is paying more ... highlight
those opportunities").

WHOSE ELEVATORS
  * the ones the reader saved on /cash-bids and put in the Daily (subs worker
    v5.42: the Daily record's `el`, ids = place_id(place key), the same FNV-1a
    components/cb-myelev.js placeId() makes), and
  * the ones the reader watches with the same address (elevator watch,
    /elevator-watch-list), matched to a network place by the watch's hash.
  Each gets one line: corn and soybeans, cash and basis for the nearest open
  delivery (the bids network's `now`, the row the cash card shows), the change
  since the previous trading day (data/bids-prev, the cash card's own rule:
  the last value seen on the latest day before the day the board last
  changed), and when the board posted it. A reader with none gets nothing.

NEAR YOU (at most MAX_NEAR lines, every one from a board read this morning)
  (a) BASIS MOVE. An elevator within RADIUS_MI of the reader's ZIP (the same
      50 mi / nearest 40 rule as the "Near Chetek" line, local_bid.snapshot)
      whose corn or soybean basis moved BASIS_MOVE_C cents or more since the
      previous trading day, for the same delivery period.
  (b) PAYS MORE. An elevator within RADIUS_MI that pays PAYS_MORE_C cents or
      more over the reader's own best elevator, same crop and the same
      delivery period, and paid less than that over it on the previous
      trading day (only the morning the gap opens, not every morning).
  Never a recommendation: each line says what the board posted, where and
  when, and nothing about what to do.

WHY 10 AND 20 CENTS (measured 2026-10-20, data/bids-prev, every network
  place's nearest open corn and soybean row, Oct 15 to Oct 20, 9,163 day
  pairs). Basis did not move at all on 87% of them. Of the moves, the median
  was 4 cents and the 90th percentile 10 cents; 10 cents or more happened on
  1.8% of corn and 1.9% of soybean day pairs (89 and 81 of 4,884 and 4,279).
  Across 400 network elevators read Oct 20, the best same-period bid within
  50 mi paid a median 15 cents (corn) and 20 cents (soybeans) over that
  elevator, so a standing gap of that size is ordinary; (b) therefore fires
  only on the morning a gap of PAYS_MORE_C first opens.

WITHHELD, NOT GUESSED
  * a board the bids repo did not read on its latest pass (data/index.json
    status other than "ok": skipped and held, refused, broken), or whose
    price is older than the previous trading day, never makes a NEAR line;
  * a move compared with anything but the trading day right before;
  * a basis move the cash did not follow: cash change minus basis change is
    the futures move, and it must sit within FUT_AGREE_C of that day's
    typical futures move for the crop (a contract roll or a misread shows as
    a jump in basis with cash flat); with fewer than MIN_DAY_ROWS rows to say
    what is typical, no move lines for that crop at all;
  * no ZIP, a ZIP with no centroid, or files that could not be read: no
    NEAR lines.
  The block is at most MAX_LINES lines.

Nothing here prints or logs an address. Counts only.

    python3 scripts/daily_elevators.py --selftest
"""
import json
import os
import re
import statistics
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import local_bid as lb            # noqa: E402

REPO = Path(__file__).resolve().parent.parent
PREV_DIR = REPO / "data" / "bids-prev"

# ── THE RULES, IN ONE PLACE ────────────────────────────────────────────────
BASIS_MOVE_C = 10        # (a) basis moved this many cents or more since the previous trading day
PAYS_MORE_C = 20         # (b) pays this many cents or more over the reader's best own elevator
FUT_AGREE_C = 3          # the cash must have moved with the basis, within this of the day's futures move
MIN_DAY_ROWS = 20        # rows needed to say what the day's futures move was
MAX_MOVE_C = 100         # a bigger one-day basis move is a misread, not news
MAX_NEAR = 2             # NEAR lines per reader
MAX_LINES = 6            # the whole block, own lines and NEAR lines together
RADIUS_MI = lb.RADIUS_MI  # 50 mi, the "Near <town>" line's own radius
INDEX_MAX_AGE_H = 6      # data/index.json older than this: nothing counts as read this morning
CROPS = ("corn", "soybeans")
CROP_WORD = {"corn": "corn", "soybeans": "soybeans"}
CROP_ADJ = {"corn": "corn", "soybeans": "soybean"}

WORDS = {
    "mine_head": "Your elevators",
    "near_head": "Near you this morning",
    "basis_move": "Basis {dir} {amt} at {who}: {crop} {cash}, basis {basis} (was {was} {day}). Posted {posted}.",
    "pays_more": "{who} pays {amt} over your best {cadj} bid ({mine}): {cash}, basis {basis}. Posted {posted}.",
    "not_read": "board not read this morning",
    "not_on_board": "not on the board this morning",
    "no_corn_soy": "no corn or soybean bid on the board this morning",
    "more": "And {n} more on agsist.com/cash-bids.",
    "note": ("The elevators' own posted boards, read when this email was sent. Changes are from the "
             "previous trading day. Straight-line miles. Not a contract. Call before you haul."),
    "add": "Put the elevators you saved on agsist.com in this email",
}
AMBIGUOUS = "ambiguous"


def fnv(s):
    """FNV-1a 32-bit over UTF-16 code units, 8 hex: build_bids_prev.fnv, bids-homepage.js fnv()."""
    h = 0x811C9DC5
    b = str(s).encode("utf-16-le")
    for i in range(0, len(b), 2):
        h ^= b[i] | (b[i + 1] << 8)
        h = (h * 0x01000193) & 0xFFFFFFFF
    return "%08x" % h


def place_id(place_key):
    """The id the Daily record keeps for a saved elevator (cb-myelev.js placeId)."""
    return fnv(place_key or "")


# ── formatting ─────────────────────────────────────────────────────────────
def cash_txt(dollars):
    return lb.q_cash_text(dollars)


def basis_txt(cents):
    return lb.q_cents(cents)


def amt_txt(cents):
    """A size in cents, quarter cents as the boards post them: 12¢, 4 1/2¢."""
    t = lb.q_cents(abs(cents))
    return t.lstrip("+−") if t != "even" else "0¢"


def chg_txt(cents):
    if cents is None:
        return ""
    if abs(cents) < 0.125:
        return "unch"
    return ("up " if cents > 0 else "down ") + amt_txt(cents)


def day_name(ds):
    from datetime import date
    try:
        return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][date.fromisoformat(ds).weekday()]
    except Exception:
        return ds


def posted_txt(iso, now=None):
    """'6:05 AM' today, 'Mon 2:10 PM' this week, 'Oct 14' before that. Central time."""
    d = lb.parse_iso(iso)
    if not d:
        return "at an unknown time"
    d = d.astimezone(lb.CT) if lb.CT else d
    ds, today = d.strftime("%Y-%m-%d"), lb.ct_today(now)
    clock = "%d:%02d %s" % (d.hour % 12 or 12, d.minute, "AM" if d.hour < 12 else "PM")
    if ds == today:
        return clock + " CT"
    if ds > lb._shift(today, -6):
        return day_name(ds) + " " + clock + " CT"
    return lb.MON[d.month - 1] + " " + str(d.day)


def where(p):
    town = p.get("town") or p.get("city") or ""
    st = p.get("state") or ""
    return (p.get("operator") or "") + (", " + town + (" " + st if st else "") if town else (", " + st if st else ""))


# ── the files ──────────────────────────────────────────────────────────────
class Boards:
    """The bids network's index, the per-board read status, and data/bids-prev."""

    def __init__(self, data, now=None, prev_dir=None):
        self.data = data
        self.now = now or datetime.now(timezone.utc)
        self.prev_dir = Path(prev_dir) if prev_dir else PREV_DIR
        self.idx = data.index()
        st = data._get("data/index.json")
        self.status = None
        if isinstance(st, dict) and isinstance(st.get("sources"), list):
            g = lb.parse_iso(st.get("generated"))
            if g and 0 <= (self.now - g).total_seconds() / 3600 <= INDEX_MAX_AGE_H:
                self.status = {s.get("id"): s.get("status") for s in st["sources"] if isinstance(s, dict)}
        self._prev = {}
        self.by_id, self.by_ewid = {}, {}
        self.places = []
        if isinstance(self.idx, dict):
            for p in self.idx.get("places") or []:
                if not isinstance(p, dict) or not p.get("place"):
                    continue
                if (p.get("currency") or "USD") != "USD":
                    continue
                self.places.append(p)
                pid = place_id(p["place"])
                self.by_id[pid] = AMBIGUOUS if pid in self.by_id else p
                for crop in (p.get("now") or {}):
                    w = wid_for(p.get("state"), p.get("operator"), p.get("city"), crop)
                    self.by_ewid[w] = AMBIGUOUS if (w in self.by_ewid and self.by_ewid[w] is not p) else p
        self._typical = {}

    def ok(self):
        return isinstance(self.idx, dict) and bool(self.places)

    def prev(self, state):
        st = str(state or "").strip().upper()
        if st not in self._prev:
            rows = None
            try:
                rows = json.loads((self.prev_dir / (st + ".json")).read_text()).get("rows")
            except Exception:
                rows = None
            self._prev[st] = rows if isinstance(rows, dict) else {}
        return self._prev[st]

    def read_today(self, p):
        """Read on the bids repo's latest pass, and posted no earlier than the previous trading day."""
        if self.status is None or self.status.get(p.get("source")) != "ok":
            return False
        if not lb.parse_iso(p.get("pricedAt")) or lb.stale_since(p.get("pricedAt"), self.now):
            return False
        return True

    def fact(self, p, crop):
        """One crop at one place: cash, basis and the change, or None."""
        n = (p.get("now") or {}).get(crop)
        if not isinstance(n, dict) or not lb.is_num(n.get("cash")):
            return None
        cash = lb.ppu(n["cash"])
        lo, hi = lb.PPU_BAND[crop]
        if not (lo <= cash <= hi):
            return None
        period = str(n.get("period") or "")
        end = period.split("/")[-1]
        if re.match(r"^\d{4}-\d{2}", end) and end[:7] < lb.this_month(self.now):
            return None
        bc = n.get("basisCents")
        basis = bc if lb.is_num(bc) and abs(bc) <= 300 else None
        on = lb.ct_date(p.get("pricedAt"))
        f = {"crop": crop, "cash": cash, "basis": basis, "period": period, "on": on,
             "chg": None, "bchg": None, "since": None, "was": None, "prev_cash": None}
        hist = self.prev(p.get("state")).get(fnv(p["place"] + "|" + crop + "|" + period))
        if isinstance(hist, list) and on:
            e = None
            for h in hist:
                if isinstance(h, list) and len(h) >= 2 and h[0] < on and lb.is_num(h[1]):
                    e = h
            if e:
                pc = lb.ppu(e[1])
                f["since"], f["prev_cash"] = e[0], pc
                f["chg"] = round((cash - pc) * 100, 2)
                if basis is not None and len(e) > 2 and lb.is_num(e[2]):
                    f["was"] = e[2]
                    f["bchg"] = round(basis - e[2], 2)
        return f

    def typical_futures_move(self, crop, on, since):
        """The day's futures move for a crop: the median of (cash change - basis change)
        over every board read this morning with the same two days. None when thin."""
        k = (crop, on, since)
        if k not in self._typical:
            vals = []
            for p in self.places:
                if not self.read_today(p):
                    continue
                f = self.fact(p, crop)
                if f and f["on"] == on and f["since"] == since and f["chg"] is not None and f["bchg"] is not None:
                    vals.append(f["chg"] - f["bchg"])
            self._typical[k] = statistics.median(vals) if len(vals) >= MIN_DAY_ROWS else None
        return self._typical[k]


def wid_for(state, facility, city, commodity):
    """send_elevator_watch.wid_for, here so this file has no mail imports."""
    s = "|".join(str(x or "").strip().upper() for x in (state, facility, city, commodity))
    return fnv(s)


# ── the reader's own elevators ─────────────────────────────────────────────
def basis_file_line(st, row):
    """A watch on an elevator the network does not carry (data/basis, the
    licensed feed's history): send_elevator_watch.daily_lines() words."""
    name = st.get("label") or "A watched elevator"
    b = row.get("basis")
    bt = "not published" if b is None else ("even" if b == 0 else ("+" if b > 0 else "\u2212") + "%d\u00a2" % abs(round(b)))
    return "%s, %s: basis %s, last changed %s." % (name, str(row.get("deliveryMonth") or "").strip() or "an unnamed delivery month",
                                                    bt, row.get("changedOn") or "on an unposted date")


def own_places(boards, el_ids, watches, basis_idx=None):
    """[(place or None, fallback line or None)] in order: saved first, then watched.
    One entry per place. A watch the network does not have keeps a plain line."""
    out, seen = [], set()
    for i in el_ids or []:
        p = boards.by_id.get(str(i).lower())
        if isinstance(p, dict) and p["place"] not in seen:
            seen.add(p["place"])
            out.append((p, None))
    for w, st in (watches or {}).items():
        st = st or {}
        if st.get("kind") == "cash" and re.match(r"^ab\d{8}$", str(st.get("ewid") or "")):
            continue                                        # a ZIP-wide alert names no one elevator
        ewid = st.get("ewid") if st.get("kind") in ("cash", "basis", "move") else w
        p = boards.by_ewid.get(ewid)
        if isinstance(p, dict):
            if p["place"] not in seen:
                seen.add(p["place"])
                out.append((p, None))
            continue
        label = (st.get("label") or "A watched elevator").split(" \u2014 ")[0]
        key = ("label", label)
        if key not in seen:
            seen.add(key)
            row = (basis_idx or {}).get(w) if st.get("kind") not in ("cash", "basis", "move") else None
            out.append((None, basis_file_line(st, row) if isinstance(row, dict) else label + ": " + WORDS["not_on_board"] + "."))
    return out


def own_line(boards, p):
    bits = []
    days = set()
    for crop in CROPS:
        f = boards.fact(p, crop)
        if not f:
            continue
        s = CROP_WORD[crop] + " " + cash_txt(f["cash"])
        if f["chg"] is not None:
            s += " (" + chg_txt(f["chg"]) + ")"
            days.add(f["since"])
        if f["basis"] is not None:
            s += ", basis " + basis_txt(f["basis"])
            if f["bchg"] is not None:
                s += " (" + chg_txt(f["bchg"]) + ")"
        bits.append(s)
    head = where(p)
    if not bits:
        return head + ": " + WORDS["no_corn_soy"] + "."
    line = head + ": " + "; ".join(bits) + ". Posted " + posted_txt(p.get("pricedAt"), boards.now)
    if len(days) == 1:
        line += ", change from " + day_name(days.pop())
    line += "."
    if boards.status is not None and boards.status.get(p.get("source")) != "ok":
        line += " " + WORDS["not_read"][0].upper() + WORDS["not_read"][1:] + "."
    return line


# ── near you ───────────────────────────────────────────────────────────────
def near_places(boards, coord):
    """local_bid.snapshot's rule: USD, a `now`, within RADIUS_MI, nearest MAX_PLACES."""
    near = []
    for p in boards.places:
        if not (lb.is_num(p.get("lat")) and lb.is_num(p.get("lon"))) or not p.get("now"):
            continue
        d = lb.miles(coord[0], coord[1], p["lat"], p["lon"])
        if d <= RADIUS_MI:
            near.append((p, d))
    near.sort(key=lambda x: x[1])
    return near[:lb.MAX_PLACES]


def latest_ok(boards, f):
    """Compared with the trading day right before the posting, and posted on the latest one."""
    return bool(f and f["since"] and f["on"] and f["since"] == lb.prev_weekday(f["on"])
                and f["on"] >= lb.prev_weekday(lb.ct_today(boards.now)))


def op_key(p):
    """One NEAR line per company: a co-op that moves basis at every branch is one line, not two."""
    return lb.norm_operator(p.get("operator")) or p["place"]


def near_lines(boards, coord, own):
    """At most MAX_NEAR lines for one reader. own: the reader's own places."""
    if coord is None or boards.status is None:
        return []
    own_keys = {p["place"] for p in own}
    cands = []
    near = near_places(boards, coord)
    for p, d in near:
        if p["place"] in own_keys or not boards.read_today(p):
            continue
        for crop in CROPS:
            f = boards.fact(p, crop)
            if not latest_ok(boards, f) or f["bchg"] is None or f["was"] is None:
                continue
            if not (BASIS_MOVE_C <= abs(f["bchg"]) <= MAX_MOVE_C):
                continue
            fut = boards.typical_futures_move(crop, f["on"], f["since"])
            if fut is None or abs((f["chg"] - f["bchg"]) - fut) > FUT_AGREE_C:
                continue
            cands.append((abs(f["bchg"]), d, op_key(p), WORDS["basis_move"].format(
                dir="up" if f["bchg"] > 0 else "down", amt=amt_txt(f["bchg"]),
                who=where(p) + ", %d mi" % lb.js_round(d), crop=CROP_WORD[crop], cash=cash_txt(f["cash"]),
                basis=basis_txt(f["basis"]), was=basis_txt(f["was"]), day=day_name(f["since"]),
                posted=posted_txt(p.get("pricedAt"), boards.now))))
    # (b) pays more than the reader's best own elevator, the morning the gap opens
    mine = [p for p in own if boards.read_today(p)]
    for crop in CROPS:
        best = {}
        for p in mine:
            f = boards.fact(p, crop)
            if latest_ok(boards, f) and (f["period"] not in best or f["cash"] > best[f["period"]][1]["cash"]):
                best[f["period"]] = (p, f)
        if not best:
            continue
        for p, d in near:
            if p["place"] in own_keys or not boards.read_today(p):
                continue
            f = boards.fact(p, crop)
            if not latest_ok(boards, f) or f["period"] not in best:
                continue
            bp, bf = best[f["period"]]
            gap = round((f["cash"] - bf["cash"]) * 100, 2)
            if bf["since"] != f["since"] or bf["prev_cash"] is None or f["prev_cash"] is None:
                continue
            gap_before = round((f["prev_cash"] - bf["prev_cash"]) * 100, 2)
            if gap >= PAYS_MORE_C and gap_before < PAYS_MORE_C:
                cands.append((gap, d, op_key(p), WORDS["pays_more"].format(
                    who=where(p) + ", %d mi," % lb.js_round(d), amt=amt_txt(gap), cadj=CROP_ADJ[crop],
                    mine=bp.get("operator") or "", cash=cash_txt(f["cash"]),
                    basis=basis_txt(f["basis"]) if f["basis"] is not None else "not posted",
                    posted=posted_txt(p.get("pricedAt"), boards.now))))
    cands.sort(key=lambda c: (-c[0], c[1], c[2]))
    out, used = [], set()
    for c in cands:
        if c[2] in used:
            continue
        used.add(c[2])
        out.append(c[3])
        if len(out) >= MAX_NEAR:
            break
    return out


# ── one block per reader ───────────────────────────────────────────────────
def block_for(boards, rec, watches=None, basis_idx=None):
    """The reader's block {"mine": [...], "near": [...], "note"} or None.
    rec: one Daily record {email, zip, el}; watches: that address's confirmed
    elevator watches ({wid: state}). Never reads or returns the address."""
    if boards is None or not boards.ok():
        return None
    own = own_places(boards, rec.get("el") or [], watches or {}, basis_idx)
    own_ps = [p for p, _ in own if p]
    mine = [own_line(boards, p) if p else fb for p, fb in own]
    coord = None
    z = str(rec.get("zip") or "").strip()
    if re.match(r"^\d{5}$", z):
        c = boards.data.zip_coord(z)
        coord = c if c else None
    near = near_lines(boards, coord, own_ps)
    room = MAX_LINES - len(near)
    if len(mine) > room:
        extra = len(mine) - (room - 1)
        mine = mine[:room - 1] + [WORDS["more"].format(n=extra)]
    if not mine and not near:
        return None
    return {"mine": mine, "near": near, "note": WORDS["note"],
            "mine_head": WORDS["mine_head"], "near_head": WORDS["near_head"]}


def blocks(boards, subs, watchers, basis_idx=None):
    """address -> block, and counts (no addresses). watchers: the
    /elevator-watch-list rows ({email, w})."""
    wmap = {}
    for r in watchers or []:
        e = str(r.get("email") or "").strip().lower()
        if e:
            wmap[e] = r.get("w") or {}
    out = {}
    counts = {"readers": len(subs), "with_own": 0, "with_near": 0, "with_both": 0, "with_zip_no_near": 0}
    for r in subs:
        e = str(r.get("email") or "").strip().lower()
        b = block_for(boards, r, wmap.get(e), basis_idx)
        if b:
            out[e] = b
            counts["with_own"] += bool(b["mine"])
            counts["with_near"] += bool(b["near"])
            counts["with_both"] += bool(b["mine"] and b["near"])
        if r.get("zip") and not (b and b["near"]):
            counts["with_zip_no_near"] += 1
    return out, counts


def lines_of(block):
    """The block as plain lines, for counting and for the text part."""
    if not block:
        return []
    return list(block.get("mine") or []) + list(block.get("near") or [])


def _selftest():
    fails = []

    def eq(a, b, m):
        if a != b:
            fails.append("%s: got %r wanted %r" % (m, a, b))
    eq(fnv("Abbyville Farmers Co-op Grain Co.||Abbyville|KS"), place_id("Abbyville Farmers Co-op Grain Co.||Abbyville|KS"), "place id is the fnv")
    eq(chg_txt(3), "up 3¢", "up")
    eq(chg_txt(-4.5), "down 4 1/2¢", "down a half")
    eq(chg_txt(0.1), "unch", "flat")
    eq(amt_txt(-12), "12¢", "size")
    eq(day_name("2026-10-19"), "Mon", "day")
    eq(lines_of(None), [], "none")
    if fails:
        for f in fails:
            print("FAIL", f)
        return 1
    print("daily_elevators selftest ok")
    return 0


if __name__ == "__main__":
    sys.exit(_selftest() if "--selftest" in sys.argv else 0)
