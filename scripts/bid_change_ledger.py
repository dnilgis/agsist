#!/usr/bin/env python3
"""The bid change-time ledger (god's-eye panel, build 1; Sig, Oct 27 2026: "yes to all").

WHY. No file we keep says when an elevator changed a bid. The board's pricedAt in
dnilgis/bids and the snapshot `posted` field are batch times: on Oct 21, 1,220 of
2,231 places shared one millisecond (seats/10-skeptic.md A1). What does carry the
time is the git history of dnilgis/bids: every poll rewrites each board file it
read (data/<board>.json, with that read's checkedAt), so two consecutive versions
of one board file are two consecutive reads of that board. A bid that differs
between them changed after the first read and at or before the second.

WHAT IT WRITES, to the private-data branch of the private repo (never main, never
Pages; scripts/push_raw.sh with RAW_BRANCH=private-data):

  private/ledger/bid-changes/YYYY/YYYY-MM-DD.json.gz   one file per Central-time day
      cols: elevId, board, crop, commodity, delivery, futuresMonth, kind,
            basisFrom, basisTo, cashFrom, cashTo, seenAt, prevSeenAt
      kind  basis    the basis moved, and the cash with it: the elevator changed the bid
                     (cents per bushel, as the board posts it)
            futures  the basis moved under an unchanged cash price (a fixed cash bid with the
                     futures moving): kept so nothing is hidden, not an elevator change
            cash   a board that posts no basis moved its cash price
            new    a bid not on the board in the last 24 hours
            gone   a bid missing from every read for 24 hours (shorter is a partial read:
                   the bid stays, and its next window runs from the last read that showed it)
      Boards not priced in US dollars are left out, as the AGSIST merge leaves them out.
      "changed between prevSeenAt and seenAt" is the claim, at poll resolution.
      It is never the elevator's own minute. A cash move with the basis unchanged
      is the futures moving, not the elevator, and is not a row.
  private/ledger/bid-changes/state.json.gz   where the walk stopped and every
      board's last good read, so the nightly run picks up from there.

The day of a row is the Central-time day of the bids commit that carried the read.
A run only writes whole days: it stops at the last commit before midnight CT
today, so a day file is written once and never half full.

THE MISSING SNAPSHOTS. From Aug 20 to Oct 16 the daily bid snapshot on raw
(scripts/bid_snapshots.py) was built from the slim file: 40 to 340 locations a
day. While the walk passes those days it can rebuild each weekday's network rows
from the boards as they stood at the first bids commit at or after 15:00 CT (the
live snapshot's own rule), every board read within the last 6 hours (the live
merge's held-skip rule). The licensed-feed rows already in the slim file are
kept beside them, never dropped. Delivery dates are parsed only from an explicit
"01 Sep 2026 to 30 Nov 2026" range or a "Sep 2026" month; anything else stays
null, never guessed.

WHERE IT RUNS. GitHub Actions only (bids is several GB; this sandbox cannot
hold it). A blobless clone of dnilgis/bids, then only the board files' blobs,
fetched in batches; scripts/bid_change_ledger.sh does the clone and the saves.

  python3 scripts/bid_change_ledger.py run --repo DIR [--out .] [--state F]
        [--until-ct-midnight | --until ISO] [--max-minutes N] [--fetch-blobs]
        [--snapshots --snap-dir DIR [--snap-since D] [--snap-until D]]
  python3 scripts/bid_change_ledger.py compare --ledger DIR --basis data/basis --since D --until D
        agreement with the basis log's day of change (the panel's proof)
  python3 scripts/bid_change_ledger.py spread --ledger DIR --basis data/basis --day 2026-08-27 --since 2026-08-20
        where the basis log's catch-up day falls in the ledger
  python3 scripts/bid_change_ledger.py --selftest
"""
import argparse
import datetime as dt
import gzip
import io
import json
import os
import re
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

SCHEMA = "agsist-bid-changes/1"
STATE_SCHEMA = "agsist-bid-changes-state/1"
OUT_DIR = "private/ledger/bid-changes"
COLS = ["elevId", "board", "crop", "commodity", "delivery", "futuresMonth", "kind",
        "basisFrom", "basisTo", "cashFrom", "cashTo", "seenAt", "prevSeenAt"]
PATHSPEC = ":(glob)data/*.json"
# Files at the top of data/ that are not one board. Big ones change on every commit
# (directory.json is 6 MB, merged-all.json 8 MB), so they are never fetched.
NOT_BOARDS = {
    "index", "directory", "coverage", "platforms", "registries", "urlfinder", "merged-all",
    "merged-index", "known-elevators", "operator-aliases", "same-yard-decisions",
    "rounding-residuals", "registry-survey", "barchart-grid", "us-states", "elevator-ids",
}
NOT_BOARD_RE = re.compile(r"^(registry-|grid-|merged)")
HELD_HOURS = 6              # fetch_bids.py HELD_SKIP_HOURS: a board read this recently is current
SNAP_AFTER_CT = (15, 0)     # bid_snapshots.py AFTER_CT
SNAP_SINCE, SNAP_UNTIL = "2026-08-20", "2026-10-16"
FETCH_BATCH = 40000         # blob ids per fetch


def ct_zone():
    from zoneinfo import ZoneInfo
    return ZoneInfo("America/Chicago")


def iso(ts):
    """epoch seconds -> 2026-10-21T18:30:32Z"""
    return dt.datetime.fromtimestamp(int(ts), dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_ts(s):
    """ISO string -> epoch seconds, or None."""
    if not isinstance(s, str) or not s:
        return None
    try:
        t = dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None
    if t.tzinfo is None:
        t = t.replace(tzinfo=dt.timezone.utc)
    return int(t.timestamp())


def ct_day(ts):
    return dt.datetime.fromtimestamp(ts, ct_zone()).date().isoformat()


def ct_midnight_ts(now=None):
    """Epoch seconds of the last midnight in Chicago."""
    t = (now or dt.datetime.now(dt.timezone.utc)).astimezone(ct_zone())
    return int(t.replace(hour=0, minute=0, second=0, microsecond=0).timestamp())


def is_board_path(path):
    if not path.startswith("data/") or path.count("/") != 1 or not path.endswith(".json"):
        return False
    stem = path[5:-5]
    return stem not in NOT_BOARDS and not NOT_BOARD_RE.match(stem)


def classify(name):
    """The crop bucket, the same rule the basis log and the bids pages use."""
    try:
        from fetch_bids import classify_commodity
        return classify_commodity(name)
    except Exception:          # pragma: no cover - fetch_bids is always beside this file
        n = (name or "").lower()
        for k, c in (("corn", "corn"), ("soy", "soybeans"), ("bean", "soybeans"), ("wheat", "wheat"),
                     ("hrw", "wheat"), ("srw", "wheat"), ("hrs", "wheat"), ("oat", "oats"),
                     ("sorghum", "sorghum"), ("milo", "sorghum")):
            if k in n:
                return c
        return "other"


def num(v, nd=4):
    if isinstance(v, bool) or not isinstance(v, (int, float)) or v != v:
        return None
    r = round(float(v), nd)
    return int(r) if r == int(r) else r


def basis_cents(b):
    c = num(b.get("basisCents"), 2)
    if c is None:
        d = num(b.get("basisDollars"), 6)
        c = num(d * 100, 2) if d is not None else None
    return c


# ------------------------------------------------------------------ one board read
_PRICE_LIKE = re.compile(r"^\$?\d+(\.\d+)?[a-z]?$")


def read_board(doc):
    """A board file -> (ok, checkedAt ts, pricedAt, loc, {key: [cash, basis cents, futures cents]})
    or None if it is not a board. ok is False for a failed read, an empty read and a board not
    priced in US dollars (the AGSIST merge drops those too; Canadian boards float a cent with the
    exchange rate on every read)."""
    if not isinstance(doc, dict) or not isinstance(doc.get("bids"), list) or not isinstance(doc.get("source"), dict):
        return None
    src = doc["source"]
    loc = {"name": src.get("name"), "location": src.get("location"), "zip": src.get("zip"),
           "lat": num(src.get("lat"), 5), "lon": num(src.get("lon"), 5)}
    rows = {}
    for b in doc["bids"]:
        if not isinstance(b, dict):
            continue
        cash, basis = num(b.get("cash")), basis_cents(b)
        if cash is None and basis is None:
            continue
        com = " ".join(str(b.get("commodity") or "").split())
        dl = " ".join(str(b.get("delivery") or "").split())
        fm = " ".join(str(b.get("futuresMonth") or "").split())
        # Some boards put the futures PRICE in the month column ("6.5150s"); keyed on, every
        # futures tick would read as a bid gone and a new one posted.
        if _PRICE_LIKE.match(fm):
            fm = ""
        k = "\x1f".join((com, dl, fm))
        if k in rows:          # first row wins on an exact repeat, as every other reader does
            continue
        rows[k] = [cash, basis, num(b.get("futuresPriceCents"), 4)]
    ok = ((doc.get("status") or "ok") == "ok" and bool(rows)
          and (doc.get("currency") or "USD") == "USD")
    return ok, parse_ts(doc.get("checkedAt")), doc.get("pricedAt"), loc, rows


GONE_HOURS = 24   # a bid missing from reads this long is gone; shorter is a partial read


def diff_board(old, new_rows, now, prev_ok):
    """One good read against what the board last showed.

    old: {key: [cash, basis, futures, lastSeen ts]}. -> (changes, rows) where each change is
    (key, kind, basisFrom, basisTo, cashFrom, cashTo, prevSeen ts) and rows is the new state.
      basis    the basis moved and so did the cash: the elevator changed it
      futures  the basis moved but the cash did not: a fixed cash price with the futures moving
               under it, kept so nothing is hidden, but it is not the elevator changing a bid
      cash     a board that posts no basis moved its cash price
      new      a bid not shown in the last GONE_HOURS
      gone     a bid missing from every read for GONE_HOURS
    A cash move with the basis unchanged is the futures moving and is not a row. A bid missing
    from a read for less than GONE_HOURS is a partial read: it stays, and when it is back its
    window runs from the last read that showed it."""
    out, rows = [], {}
    for k, (cash, basis, fut) in new_rows.items():
        o = old.get(k)
        rows[k] = [cash, basis, fut, now]
        if o is None:
            out.append((k, "new", None, basis, None, cash, prev_ok))
            continue
        ocash, obasis, last = o[0], o[1], o[3]
        if obasis is not None or basis is not None:
            if obasis != basis:
                kind = "futures" if (cash is not None and cash == ocash) else "basis"
                out.append((k, kind, obasis, basis, ocash, cash, last))
        elif ocash != cash:
            out.append((k, "cash", None, None, ocash, cash, last))
    for k, o in old.items():
        if k in new_rows:
            continue
        if now - o[3] >= GONE_HOURS * 3600:
            out.append((k, "gone", o[1], None, o[0], None, o[3]))
        else:
            rows[k] = o
    return out, rows


# ------------------------------------------------------------------ git
class Git:
    def __init__(self, repo, fetch_remote=None):
        self.repo = repo
        self.fetch_remote = fetch_remote
        self._cat = None
        self.fetched = 0

    def run(self, *args, check=True):
        r = subprocess.run(["git", "-C", self.repo, *args], capture_output=True, text=True)
        if check and r.returncode != 0:
            raise RuntimeError(f"git {args[0]} failed: {r.stderr.strip()[:300]}")
        return r

    def commits(self, since=None, tip="HEAD"):
        """[(sha, commit ts, [(path, new oid or None)])] oldest first, first-parent, board files only."""
        rng = f"{since}..{tip}" if since else tip
        p = subprocess.Popen(["git", "-C", self.repo, "log", "--reverse", "--first-parent", "--root",
                              "--diff-merges=first-parent", "--raw", "--no-abbrev", "--no-renames",
                              "--format=%x01%H %ct", rng, "--", PATHSPEC],
                             stdout=subprocess.PIPE, text=True)
        out, cur = [], None
        for line in p.stdout:
            if line.startswith("\x01"):
                h, ts = line[1:].split()
                cur = (h, int(ts), [])
                out.append(cur)
            elif line.startswith(":") and cur is not None:
                meta, _, path = line.rstrip("\n").partition("\t")
                parts = meta.split()
                if not is_board_path(path):
                    continue
                new = parts[3]
                cur[2].append((path, None if parts[4].startswith("D") or set(new) == {"0"} else new))
        if p.wait() != 0:
            raise RuntimeError(f"git log {rng} failed")
        return out

    def ensure(self, oids):
        """Fetch the blobs a blobless clone does not have yet (one request per batch)."""
        if not self.fetch_remote or not oids:
            return
        oids = sorted(set(oids))
        for i in range(0, len(oids), FETCH_BATCH):
            chunk = "\n".join(oids[i:i + FETCH_BATCH]) + "\n"
            r = subprocess.run(["git", "-C", self.repo, "-c", "fetch.negotiationAlgorithm=noop", "fetch",
                                "-q", self.fetch_remote, "--no-tags", "--no-write-fetch-head",
                                "--recurse-submodules=no", "--filter=blob:none", "--stdin"],
                               input=chunk, capture_output=True, text=True)
            if r.returncode != 0:
                raise RuntimeError(f"blob fetch failed: {r.stderr.strip()[:300]}")
            self.fetched += min(FETCH_BATCH, len(oids) - i)

    def blob(self, oid):
        if self._cat is None:
            env = dict(os.environ, GIT_NO_LAZY_FETCH="0" if self.fetch_remote else "1")
            self._cat = subprocess.Popen(["git", "-C", self.repo, "cat-file", "--batch"],
                                         stdin=subprocess.PIPE, stdout=subprocess.PIPE, env=env)
        self._cat.stdin.write((oid + "\n").encode())
        self._cat.stdin.flush()
        head = self._cat.stdout.readline().decode().split()
        if len(head) < 3 or head[1] != "blob":
            return None
        n = int(head[2])
        data = self._cat.stdout.read(n)
        self._cat.stdout.read(1)
        return data

    def show(self, rev, path):
        r = subprocess.run(["git", "-C", self.repo, "show", f"{rev}:{path}"], capture_output=True)
        return r.stdout if r.returncode == 0 else None

    def close(self):
        if self._cat:
            self._cat.stdin.close()
            self._cat.wait()
            self._cat = None


# ------------------------------------------------------------------ ids
def load_ids():
    """board slug -> permanent elevator id (data/ids, folded ids followed to the survivor)."""
    out = {}
    try:
        led = json.load(open(os.path.join(ROOT, "data", "ids", "elevator-ids.json"), encoding="utf-8"))
        minted = led.get("minted") or {}
    except (OSError, ValueError):
        minted = {}
    def final(i):
        seen = set()
        while i in minted and (minted[i] or {}).get("into") and i not in seen:
            seen.add(i)
            i = minted[i]["into"]
        return i
    try:
        seen = {}
        for r in json.load(open(os.path.join(ROOT, "data", "ids", "elevators.json"), encoding="utf-8")).get("elevators") or []:
            for slug in (r.get("sources") or {}).get("bids_repo") or []:
                seen.setdefault(slug, set()).add(r.get("id"))
        out = {s: final(next(iter(v))) for s, v in seen.items() if len(v) == 1 and None not in v}
    except (OSError, ValueError, AttributeError):
        pass
    return out, final


def bids_side_ids(git, tip="HEAD"):
    """slug -> (elevId, place fields) from the bids feed at the tip: merged-all.json elevators and rows."""
    ids, places = {}, {}
    raw = git.show(tip, "data/merged-all.json")
    if raw:
        try:
            m = json.loads(raw)
            for slug, e in (m.get("elevators") or {}).items():
                if isinstance(e, dict) and e.get("elevId"):
                    ids[slug] = e["elevId"]
            for b in m.get("bids") or []:
                s = b.get("source")
                if s and s not in places:
                    places[s] = {"facility": b.get("operator"), "branch": b.get("branch") or "",
                                 "city": b.get("city"), "town": b.get("town"), "state": b.get("state"),
                                 "zip": b.get("zip")}
        except ValueError:
            pass
    return ids, places


# ------------------------------------------------------------------ state
def new_state():
    return {"schema": STATE_SCHEMA, "lastCommit": None, "lastCommitTs": None, "boards": {}, "snapDone": []}


def load_state(path):
    if not path or not os.path.exists(path):
        return new_state()
    with open(path, "rb") as f:
        s = json.loads(gzip.decompress(f.read()).decode("utf-8"))
    if s.get("schema") != STATE_SCHEMA:
        raise SystemExit(f"[change-ledger] {path} is not a {STATE_SCHEMA} file")
    return s


def gz(obj):
    raw = json.dumps(obj, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    buf = io.BytesIO()
    with gzip.GzipFile(filename="", mode="wb", fileobj=buf, compresslevel=9, mtime=0) as g:
        g.write(raw)
    return buf.getvalue()


def write_file(path, data):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "wb") as f:
        f.write(data)
    os.replace(tmp, path)


def day_path(out, day):
    return os.path.join(out, OUT_DIR, day[:4], f"{day}.json.gz")


def read_day(out, day):
    with open(day_path(out, day), "rb") as f:
        return json.loads(gzip.decompress(f.read()).decode("utf-8"))


def day_doc(day, rows, meta):
    rows.sort(key=lambda r: (r[11], r[1], r[3], r[4], r[5]))
    kinds = {}
    for r in rows:
        kinds[r[6]] = kinds.get(r[6], 0) + 1
    return {
        "schema": SCHEMA, "day": day,
        "note": ("Bid changes seen in dnilgis/bids git history (scripts/bid_change_ledger.py). Each row is one bid "
                 "that differs between two consecutive good reads of one board: it changed after prevSeenAt and at "
                 "or before seenAt (poll resolution, never the elevator's own minute). basis in cents per bushel, "
                 "cash in dollars, as the board posted them. kind: basis (the elevator moved it) | futures (basis moved under an "
                 "unchanged cash price) | cash (a board with no basis) | new | gone (missing 24 h). Boards not in US dollars are left out. "
                 "pricedAt and the snapshot posted field are batch times and are not used. day = Central-time day of "
                 "the bids commit."),
        "cols": COLS,
        "counts": dict(meta, rows=len(rows), byKind=kinds),
        "rows": rows,
    }


# ------------------------------------------------------------------ snapshots (Aug 20 to Oct 16)
_MON = {m: i for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}
_RANGE = re.compile(r"^(\d{1,2}) ([A-Za-z]{3})[a-z]* (\d{4}) to (\d{1,2}) ([A-Za-z]{3})[a-z]* (\d{4})$")
_MONTH = re.compile(r"^([A-Za-z]{3})[a-z]* (\d{4})$")


def delivery_dates(text):
    """Only an explicit range or a plain month; anything else is (None, None), never guessed."""
    s = " ".join(str(text or "").split())
    m = _RANGE.match(s)
    try:
        if m and m.group(2).lower() in _MON and m.group(5).lower() in _MON:
            a = dt.date(int(m.group(3)), _MON[m.group(2).lower()], int(m.group(1)))
            b = dt.date(int(m.group(6)), _MON[m.group(5).lower()], int(m.group(4)))
            return a.isoformat(), b.isoformat()
        m = _MONTH.match(s)
        if m and m.group(1).lower() in _MON:
            y, mo = int(m.group(2)), _MON[m.group(1).lower()]
            nxt = dt.date(y + (mo == 12), mo % 12 + 1, 1)
            return dt.date(y, mo, 1).isoformat(), (nxt - dt.timedelta(days=1)).isoformat()
    except ValueError:
        pass
    return None, None


def snapshot_doc(state, at_ts, places, states_at):
    """The boards as they stood at at_ts, as a bids-full-like doc for bid_snapshots.build()."""
    bids = []
    for slug, b in sorted(state["boards"].items()):
        if not b.get("okAt") or at_ts - b["okAt"] > HELD_HOURS * 3600:
            continue
        loc, pl = b.get("loc") or {}, places.get(slug) or {}
        st = pl.get("state") or states_at.get(slug) or ""
        for k, (cash, basis, fut, last) in b["rows"].items():
            if last != b["okAt"]:
                continue       # not on the board's latest read
            com, dl, fm = k.split("\x1f")
            s, e = delivery_dates(dl)
            bids.append({
                "facility": pl.get("facility") or loc.get("name") or "", "branch": pl.get("branch") or "",
                "city": pl.get("city") or loc.get("location") or "", "town": pl.get("town") or "",
                "state": st, "zip": pl.get("zip") or loc.get("zip") or "",
                "lat": loc.get("lat"), "lon": loc.get("lon"),
                "commodity": com, "category": classify(com), "deliveryMonth": dl,
                "deliveryStart": s, "deliveryEnd": e, "symbol": fm,
                "cashPrice": cash, "basis": (basis / 100.0) if basis is not None else None,
                "source": "network", "_board": slug, "_posted": b.get("pricedAt"),
                "_fut": (fut / 100.0) if fut is not None else None,
            })
    return {"fetched": iso(at_ts), "source": "AGSIST elevator network (dnilgis/bids), rebuilt from its git history",
            "bids": bids}


def merge_existing(snap, old):
    """Keep every row of the old (slim) file that is not a network row; rebuilt network rows replace the rest."""
    if not old:
        return snap, 0
    import bid_snapshots as bs
    kept = [r for r in bs.rows_of(old) if r.get("src") != "network"]
    if not kept:
        return snap, 0
    loc_ix = {}
    for i, l in enumerate(snap["locs"]):
        loc_ix[bs.place_str(l[1], l[2], l[3], l[5])] = i
    for r in kept:
        k = r["key"]
        if k not in loc_ix:
            snap["locs"].append([r.get("locId")] + [r.get(c) for c in snap["locCols"][1:]] + [[]])
            loc_ix[k] = len(snap["locs"]) - 1
        snap["locs"][loc_ix[k]][-1].append([r.get(c) for c in snap["rowCols"]])
    snap["counts"]["locs"] = len(snap["locs"])
    snap["counts"]["rows"] = sum(len(l[-1]) for l in snap["locs"])
    return snap, len(kept)


def write_snapshot(state, at_ts, day, commit, places, states_at, snap_dir, ids_pair):
    import bid_snapshots as bs
    doc = snapshot_doc(state, at_ts, places, states_at)
    snap = bs.build(doc, day, ids=ids_pair, partial=None,
                    origin={"backfill": "dnilgis/bids board history (scripts/bid_change_ledger.py)",
                            "commit": commit, "at": iso(at_ts),
                            "rule": "boards read within 6 h before the first bids commit at or after 15:00 CT"})
    old = None
    p = os.path.join(snap_dir, bs.path_for(day))
    if os.path.exists(p):
        with open(p, "rb") as f:
            old = bs.decode(f.read())
        if old.get("partial") is None and not (old.get("origin") or {}).get("backfill"):
            return None, "kept: the day already has a full live snapshot"
    snap, kept = merge_existing(snap, old)
    if kept:
        snap["origin"]["kept"] = f"{kept} licensed-feed rows from the slim file"
    if snap["counts"]["locs"] < bs.MIN_LOCS:
        snap["partial"] = f"thin: {snap['counts']['locs']} locations, under the floor of {bs.MIN_LOCS} (rebuilt)"
    bad = bs.privacy_problems(snap)
    if bad:
        return None, f"not written, possible personal data: {bad[:2]}"
    bs.write(snap, snap_dir)
    return snap, f"{snap['counts']['locs']} locations, {snap['counts']['rows']} rows"


# ------------------------------------------------------------------ the walk
def walk(git, state, out, until_ts=None, max_minutes=None, snaps=None, log=print):
    """Walk the commits after state['lastCommit'], write whole Central days. Returns a summary dict."""
    t0 = time.time()
    commits = git.commits(since=state.get("lastCommit"))
    if until_ts is not None:
        commits = [c for c in commits if c[1] < until_ts]
    ids, final = load_ids()
    side_ids, places = bids_side_ids(git)

    def elev(slug):
        i = ids.get(slug) or side_ids.get(slug)
        return final(i) if i else None

    by_day = {}
    for c in commits:
        by_day.setdefault(ct_day(c[1]), []).append(c)
    days = sorted(by_day)
    written, snap_notes = [], []
    boards = state["boards"]
    snap_done = set(state.get("snapDone") or [])
    states_cache = {}
    stopped = False
    for day in days:
        if max_minutes is not None and time.time() - t0 > max_minutes * 60:
            stopped = True
            break
        cs = by_day[day]
        # the whole day's blobs in a few requests
        git.ensure([o for c in cs for _, o in c[2] if o])
        prior = []
        p = day_path(out, day)
        if os.path.exists(p) and state.get("lastCommitTs") and ct_day(state["lastCommitTs"]) == day:
            prior = read_day(out, day)["rows"]
        rows, polls, nboards, skipped = list(prior), 0, set(), 0
        want_snap = (snaps is not None and snaps["since"] <= day <= snaps["until"] and day not in snap_done
                     and dt.date.fromisoformat(day).weekday() < 5)
        snap_taken = False
        for ci, (h, ts, changes) in enumerate(cs):
            for path, oid in changes:
                slug = path[5:-5]
                if oid is None:
                    continue
                data = git.blob(oid)
                if data is None:
                    raise RuntimeError(f"blob {oid} for {path} at {h[:10]} is missing")
                try:
                    rb = read_board(json.loads(data))
                except ValueError:
                    rb = None
                if rb is None:
                    skipped += 1
                    continue
                ok, checked, priced, loc, new_rows = rb
                if not ok:
                    continue
                seen = checked if checked and checked <= ts + 300 else ts
                polls += 1
                nboards.add(slug)
                b = boards.get(slug)
                if b is None:
                    state_rows = {k: v + [seen] for k, v in new_rows.items()}
                else:
                    if seen <= b["okAt"]:
                        continue       # an older read committed late: never step back in time
                    e = elev(slug)
                    changes, state_rows = diff_board(b["rows"], new_rows, seen, b["okAt"])
                    for k, kind, bf, bt, cf, ct, prev in changes:
                        com, dl, fm = k.split("\x1f")
                        rows.append([e, slug, classify(com), com, dl, fm, kind, bf, bt, cf, ct, iso(seen), iso(prev)])
                boards[slug] = {"okAt": seen, "pricedAt": priced, "loc": loc, "rows": state_rows}
            if want_snap and not snap_taken:
                tct = dt.datetime.fromtimestamp(ts, ct_zone())
                last = ci == len(cs) - 1
                if (tct.hour, tct.minute) >= SNAP_AFTER_CT or last:
                    if h not in states_cache:
                        states_cache.clear()
                        states_cache[h] = states_at_commit(git, h)
                    snap, note = write_snapshot(state, ts, day, h, places, states_cache[h], snaps["dir"],
                                                (snaps["keys"], {s: elev(s) for s in boards}))
                    snap_notes.append((day, note))
                    log(f"[change-ledger] snapshot {day}: {note}")
                    snap_done.add(day)
                    snap_taken = True
        meta = {"commits": len(cs), "firstCommit": cs[0][0][:12], "lastCommit": cs[-1][0][:12],
                "reads": polls, "boards": len(nboards), "notBoards": skipped}
        if prior:
            meta["note"] = "continued from an earlier run"
        doc = day_doc(day, rows, meta)
        write_file(p, gz(doc))
        written.append((day, len(rows)))
        state["lastCommit"], state["lastCommitTs"] = cs[-1][0], cs[-1][1]
        state["snapDone"] = sorted(snap_done)
        log(f"[change-ledger] {day}: {len(cs)} commits, {polls} reads of {len(nboards)} boards, "
            f"{len(rows)} changes {doc['counts']['byKind']}")
    return {"days": written, "stopped": stopped, "left": len(days) - len(written), "snapshots": snap_notes,
            "fetched": git.fetched}


def states_at_commit(git, h):
    """slug -> US state from data/index.json at that commit (the board files carry no state)."""
    raw = git.show(h, "data/index.json")
    out = {}
    if raw:
        try:
            for s in json.loads(raw).get("sources") or []:
                if s.get("id") and s.get("usState"):
                    out[s["id"]] = s["usState"]
        except ValueError:
            pass
    return out


# ------------------------------------------------------------------ the proof
def ledger_rows(ledger, since, until):
    out = []
    d = dt.date.fromisoformat(since)
    end = dt.date.fromisoformat(until)
    while d <= end:
        p = day_path(ledger, d.isoformat())
        if os.path.exists(p):
            doc = read_day(ledger, d.isoformat())
            out += [dict(zip(doc["cols"], r)) for r in doc["rows"]]
        d += dt.timedelta(days=1)
    return out


def basis_log(basis_dir, since, until):
    out = []
    d = dt.date.fromisoformat(since)
    end = dt.date.fromisoformat(until)
    while d <= end:
        p = os.path.join(basis_dir, f"changes-{d.isoformat()}.json")
        if os.path.exists(p):
            doc = json.load(open(p, encoding="utf-8"))
            cols = doc.get("columns") or []
            for r in doc.get("changes") or []:
                out.append(dict(zip(cols, r), changedOn=doc.get("date") or d.isoformat()))
        d += dt.timedelta(days=1)
    return out


def basis_key_ids():
    try:
        led = json.load(open(os.path.join(ROOT, "data", "ids", "elevator-ids.json"), encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    _, final = load_ids()
    return {k[6:]: final(v) for k, v in (led.get("keys") or {}).items() if k.startswith("basis:") and isinstance(v, str)}


def compare(ledger, basis_dir, since, until, key_ids=None):
    """For each basis-log change on day D (UTC day of the run that saw it), is there a ledger basis
    change at the same elevator and crop, same from and to, seen on D (UTC)? n, agree, rate."""
    key_ids = basis_key_ids() if key_ids is None else key_ids
    pad_since = (dt.date.fromisoformat(since) - dt.timedelta(days=3)).isoformat()
    pad_until = (dt.date.fromisoformat(until) + dt.timedelta(days=1)).isoformat()
    lr = [r for r in ledger_rows(ledger, pad_since, pad_until) if r["kind"] == "basis"]
    boards_seen = {r["elevId"] for r in ledger_rows(ledger, pad_since, pad_until) if r["elevId"]}
    idx = {}
    for r in lr:
        if r["elevId"] and r["basisFrom"] is not None and r["basisTo"] is not None:
            idx.setdefault((r["elevId"], r["crop"], round(r["basisFrom"]), round(r["basisTo"])), []).append(r["seenAt"][:10])
    res = {"n_log": 0, "no_id": 0, "not_on_a_board": 0, "n": 0, "agree": 0, "within_1d": 0, "other_day": 0, "unmatched": 0}
    by_day = {}
    for b in basis_log(basis_dir, since, until):
        res["n_log"] += 1
        e = key_ids.get(f"{b['state']}|{b['facility']}|{b['city']}")
        if not e:
            res["no_id"] += 1
            continue
        if e not in boards_seen:
            res["not_on_a_board"] += 1
            continue
        res["n"] += 1
        dd = by_day.setdefault(b["changedOn"], [0, 0])
        dd[0] += 1
        hits = idx.get((e, (b.get("commodity") or "").lower(), b.get("from"), b.get("to")))
        if not hits:
            res["unmatched"] += 1
            continue
        D = dt.date.fromisoformat(b["changedOn"])
        gaps = [abs((dt.date.fromisoformat(x) - D).days) for x in hits]
        if 0 in gaps:
            res["agree"] += 1
            dd[1] += 1
        elif min(gaps) <= 1:
            res["within_1d"] += 1
        else:
            res["other_day"] += 1
    res["rate"] = round(res["agree"] / res["n"], 3) if res["n"] else None
    res["rate_matched"] = round(res["agree"] / (res["n"] - res["unmatched"]), 3) if res["n"] - res["unmatched"] else None
    res["byDay"] = {k: {"n": v[0], "agree": v[1]} for k, v in sorted(by_day.items())}
    return res


def spread(ledger, basis_dir, day, since, key_ids=None):
    """The basis log's catch-up day: on which days did the ledger see those same moves happen?"""
    key_ids = basis_key_ids() if key_ids is None else key_ids
    lr = [r for r in ledger_rows(ledger, since, day) if r["kind"] == "basis" and r["elevId"]]
    boards_seen = {r["elevId"] for r in ledger_rows(ledger, since, day) if r["elevId"]}
    by = {}
    for r in lr:
        by.setdefault((r["elevId"], r["crop"], round(r["basisTo"]) if r["basisTo"] is not None else None), []).append(r)
    out = {"n_log": 0, "on_a_board": 0, "found": 0, "byDay": {}}
    ledger_per_day = {}
    for r in lr:
        ledger_per_day[r["seenAt"][:10]] = ledger_per_day.get(r["seenAt"][:10], 0) + 1
    for b in basis_log(basis_dir, day, day):
        out["n_log"] += 1
        e = key_ids.get(f"{b['state']}|{b['facility']}|{b['city']}")
        if not e or e not in boards_seen:
            continue
        out["on_a_board"] += 1
        hits = [r for r in by.get((e, (b.get("commodity") or "").lower(), b.get("to")), []) if r["seenAt"][:10] <= day]
        if not hits:
            continue
        out["found"] += 1
        last = max(h["seenAt"] for h in hits)[:10]
        out["byDay"][last] = out["byDay"].get(last, 0) + 1
    out["byDay"] = dict(sorted(out["byDay"].items()))
    out["ledgerBasisChangesPerDay"] = dict(sorted(ledger_per_day.items()))
    return out


# ------------------------------------------------------------------ selftest
def selftest():
    import tempfile
    import shutil
    fails = []

    def ck(name, ok):
        print(("ok   " if ok else "FAIL ") + name)
        if not ok:
            fails.append(name)

    def board(checked, rows, status="ok", priced="2026-10-19T18:30:32.843Z"):
        return {"schema": "graindesk/1", "source": {"name": "Badger Grain", "location": "Wheeler", "zip": "54772",
                "lat": 45.04, "lon": -91.9, "contact": {"phone": "715-555-0100", "email": "x@example.com"}},
                "checkedAt": checked, "pricedAt": priced, "status": status, "count": len(rows),
                "bids": [dict(zip(["commodity", "delivery", "futuresMonth", "cash", "basisDollars", "basisCents"], r))
                         for r in rows]}

    corn = ["Corn", "01 Oct 2026 to 31 Oct 2026", "December 2026"]
    ok, chk, _, loc, rws = read_board(board("2026-10-19T14:00:00Z", [corn + [4.10, -0.45, -45], corn + [9.9, -0.1, -10]]))
    ck("a board read: first row wins, cents kept, contact dropped",
       ok and len(rws) == 1 and list(rws.values())[0][:2] == [4.1, -45] and "contact" not in loc and "phone" not in json.dumps(loc))
    ck("a refused read is not a good read", read_board(board("2026-10-19T14:00:00Z", [corn + [4.1, -0.45, -45]], status="refused"))[0] is False)
    ck("a file that is not a board is None", read_board({"generated": "x", "sources": []}) is None)
    ck("not-board names are never fetched", not is_board_path("data/directory.json") and not is_board_path("data/merged-all.json")
       and not is_board_path("data/merged/x.json") and is_board_path("data/albertlea.json") and not is_board_path("data/registry-ia.json"))
    H = 3600
    d, st_rows = diff_board({"a\x1fb\x1fc": [4.0, -45, None, 0], "g\x1fg\x1fg": [1, 2, None, 0], "q\x1fq\x1fq": [5.0, None, None, 0],
                             "p\x1fp\x1fp": [6.0, -10, None, 20 * H], "f\x1ff\x1ff": [6.25, -3, 628.25, 0]},
                            {"a\x1fb\x1fc": [4.1, -40, None], "n\x1fn\x1fn": [3, -1, None], "q\x1fq\x1fq": [5.2, None, None],
                             "f\x1ff\x1ff": [6.25, -4, 629.25]}, 25 * H, 24 * H)
    kinds = {x[0][0]: x[1] for x in d}
    ck("diff: basis move, futures-only move, cash-only board, new, gone after 24 h",
       kinds == {"a": "basis", "f": "futures", "q": "cash", "n": "new", "g": "gone"}
       and [x for x in d if x[1] == "basis"][0][2:] == (-45, -40, 4.0, 4.1, 0))
    ck("a bid missing for under 24 h is a partial read: kept, no row", "p\x1fp\x1fp" in st_rows and "p" not in kinds
       and "g\x1fg\x1fg" not in st_rows)
    ck("a new bid's window starts at the board's last good read", [x for x in d if x[1] == "new"][0][6] == 24 * H)
    ck("a cash move with the basis unchanged is not a row (the futures moved)",
       diff_board({"k": [4.0, -45, None, 0]}, {"k": [4.2, -45, None]}, 1, 0)[0] == [])
    ck("a futures price in the month column is not part of the key",
       list(read_board(board("2026-10-19T14:00:00Z", [["Wheat - Hrs", "October", "6.5150s", 5.61, -0.9, -90]]))[4]) == ["Wheat - Hrs\x1fOctober\x1f"])
    ck("a board not in US dollars is not a good read",
       read_board(dict(board("2026-10-19T14:00:00Z", [corn + [4.1, -0.45, -45]]), currency="CAD"))[0] is False)
    ck("dates: explicit range and month only", delivery_dates("01 Sep 2026 to 30 Nov 2026") == ("2026-09-01", "2026-11-30")
       and delivery_dates("Dec 2026") == ("2026-12-01", "2026-12-31") and delivery_dates("FH Sep 26") == (None, None)
       and delivery_dates("NEARBY") == (None, None))
    ck("Central midnight in October is 05:00 UTC", ct_midnight_ts(dt.datetime(2026, 10, 21, 12, tzinfo=dt.timezone.utc))
       == int(dt.datetime(2026, 10, 21, 5, tzinfo=dt.timezone.utc).timestamp()))

    # a real git history: three polls of one board, one bad read, a non-board file, two days
    tmp = tempfile.mkdtemp(prefix="ledger-selftest-")
    try:
        repo = os.path.join(tmp, "bids")
        os.makedirs(os.path.join(repo, "data"))
        env = dict(os.environ, GIT_AUTHOR_NAME="t", GIT_AUTHOR_EMAIL="t@t", GIT_COMMITTER_NAME="t", GIT_COMMITTER_EMAIL="t@t")
        g = lambda *a, **k: subprocess.run(["git", "-C", repo, *a], check=True, capture_output=True, env=dict(env, **k))
        g("init", "-q", "-b", "main")

        def commit(when, files):
            for name, doc in files.items():
                with open(os.path.join(repo, "data", name), "w") as f:
                    json.dump(doc, f)
            g("add", "-A")
            g("commit", "-q", "-m", "bids", GIT_COMMITTER_DATE=when, GIT_AUTHOR_DATE=when)

        beans = ["Soybeans", "Oct 2026", "November 2026"]
        commit("2026-10-19T14:05:00Z", {"badger-wheeler.json": board("2026-10-19T14:00:00Z", [corn + [4.10, -0.45, -45], beans + [10.0, -0.8, -80]]),
                                        "index.json": {"sources": [{"id": "badger-wheeler", "usState": "WI"}]}})
        commit("2026-10-19T16:05:00Z", {"badger-wheeler.json": board("2026-10-19T16:00:00Z", [corn + [4.12, -0.45, -45], beans + [10.0, -0.8, -80]])})
        commit("2026-10-19T18:05:00Z", {"badger-wheeler.json": board("2026-10-19T18:00:00Z", [], status="broken"),
                                        "directory.json": {"elevators": []}})
        commit("2026-10-19T21:05:00Z", {"badger-wheeler.json": board("2026-10-19T21:00:00Z", [corn + [4.20, -0.40, -40], beans + [10.0, -0.8, -80]])})
        commit("2026-10-20T15:05:00Z", {"badger-wheeler.json": board("2026-10-20T15:00:00Z", [corn + [4.20, -0.40, -40]])})
        commit("2026-10-21T15:05:00Z", {"badger-wheeler.json": board("2026-10-21T15:00:00Z", [corn + [4.10, -0.50, -50]])})
        out = os.path.join(tmp, "out")
        st = new_state()
        git = Git(repo)
        logs = []
        until = ct_midnight_ts(dt.datetime(2026, 10, 21, 12, tzinfo=dt.timezone.utc))
        r = walk(git, st, out, until_ts=until, log=logs.append)
        ck("whole days only: Oct 19 and Oct 20 written, Oct 21 (today) not yet",
           [x[0] for x in r["days"]] == ["2026-10-19", "2026-10-20"] and not os.path.exists(day_path(out, "2026-10-21")))
        d19 = read_day(out, "2026-10-19")
        rows = [dict(zip(d19["cols"], x)) for x in d19["rows"]]
        ck("Oct 19: one basis change, dated between the last good read and the next",
           len(rows) == 1 and rows[0]["kind"] == "basis" and rows[0]["basisFrom"] == -45 and rows[0]["basisTo"] == -40
           and rows[0]["prevSeenAt"] == "2026-10-19T16:00:00Z" and rows[0]["seenAt"] == "2026-10-19T21:00:00Z"
           and rows[0]["cashFrom"] == 4.12 and rows[0]["cashTo"] == 4.2 and rows[0]["crop"] == "corn")
        ck("the broken read is not a read; the cash-only move at 16:00 is not a row; directory.json not read",
           d19["counts"]["reads"] == 3 and d19["counts"]["notBoards"] == 0)
        ck("Oct 20: the soybean bid missing for 18 h is not gone yet", read_day(out, "2026-10-20")["rows"] == [])
        sp = os.path.join(out, OUT_DIR, "state.json.gz")
        write_file(sp, gz(st))
        st2 = load_state(sp)
        r2 = walk(Git(repo), st2, out, until_ts=None, log=logs.append)
        d21 = [dict(zip(read_day(out, "2026-10-21")["cols"], x)) for x in read_day(out, "2026-10-21")["rows"]]
        b21 = [x for x in d21 if x["kind"] == "basis"]
        ck("the next run picks up where the state stopped: only Oct 21, its change from -40 to -50",
           [x[0] for x in r2["days"]] == ["2026-10-21"] and len(b21) == 1 and b21[0]["basisFrom"] == -40 and b21[0]["basisTo"] == -50
           and b21[0]["prevSeenAt"] == "2026-10-20T15:00:00Z")
        g21 = [x for x in d21 if x["kind"] == "gone"]
        ck("Oct 21: the soybean bid is gone, last seen Oct 19 21:00", len(g21) == 1 and g21[0]["crop"] == "soybeans"
           and g21[0]["prevSeenAt"] == "2026-10-19T21:00:00Z")
        r3 = walk(Git(repo), st2, out, log=logs.append)
        ck("a third run with nothing new writes nothing", r3["days"] == [])
        ck("no phone, no email in any ledger file", not any(re.search(r"@|555-0100", gzip.decompress(open(os.path.join(dp, f), "rb").read()).decode())
           for dp, _, fs in os.walk(os.path.join(out, OUT_DIR)) for f in fs))

        # snapshots: rebuilt from the boards at the first commit at or after 15:00 CT; slim file's licensed rows kept
        import bid_snapshots as bs
        snapdir = os.path.join(tmp, "snaps")
        slim = bs.build({"bids": [{"facility": "ADM", "city": "Decatur", "state": "IL", "commodity": "Corn", "category": "corn",
                                    "cashPrice": 4.0, "basis": -0.2, "deliveryMonth": "Oct 2026", "source": None},
                                   {"facility": "Badger Grain", "city": "Wheeler", "state": "WI", "commodity": "Corn",
                                    "category": "corn", "cashPrice": 3.0, "basis": -0.9, "source": "network", "_board": "badger-wheeler"}]},
                        "2026-10-19", ids=({}, {}), partial="slim: main held only the bids the futures pages select")
        bs.write(slim, snapdir)
        st3 = new_state()
        r4 = walk(Git(repo), st3, os.path.join(tmp, "out3"), until_ts=until, log=logs.append,
                  snaps={"since": "2026-10-19", "until": "2026-10-20", "dir": snapdir, "keys": {}})
        s19 = bs.read_snapshot("2026-10-19", dir=snapdir)
        rs = bs.rows_of(s19)
        bad = [r for r in rs if r["facility"] == "Badger Grain"]
        ck("snapshot Oct 19 taken at the first commit at or after 15:00 CT (21:05 UTC)",
           s19["origin"]["at"] == "2026-10-19T21:05:00Z")
        ck("rebuilt network rows replace the slim network rows; the licensed row is kept",
           sorted((r["facility"], r["src"]) for r in rs) == [("ADM", "barchart"), ("Badger Grain", "network"), ("Badger Grain", "network")]
           and sorted(r["basis"] for r in bad) == [-0.8, -0.4] and s19["origin"]["kept"].startswith("1 licensed"))
        ck("rebuilt rows carry state from index.json, parsed dates only where explicit",
           all(r["state"] == "WI" for r in bad) and sorted(str(r["start"]) for r in bad) == ["2026-10-01", "2026-10-01"])
        ck("a thin rebuilt day is marked thin, never passed off as full", s19["partial"].startswith("thin: 2 locations"))
        ck("Oct 20 snapshot written too, and no personal data", bs.privacy_problems(bs.read_snapshot("2026-10-20", dir=snapdir)) == []
           and st3["snapDone"] == ["2026-10-19", "2026-10-20"])
        full = dict(slim, partial=None, day="2026-10-20")
        bs.write(full, snapdir)
        st4 = new_state()
        walk(Git(repo), st4, os.path.join(tmp, "out4"), until_ts=until, log=logs.append,
             snaps={"since": "2026-10-20", "until": "2026-10-20", "dir": snapdir, "keys": {}})
        ck("a day with a full live snapshot is never overwritten", bs.read_snapshot("2026-10-20", dir=snapdir).get("origin") is None)

        # the proof functions on a tiny basis log
        bdir = os.path.join(tmp, "basis")
        os.makedirs(bdir)
        cols = ["state", "facility", "city", "commodity", "symbol", "deliveryMonth", "from", "to"]
        json.dump({"date": "2026-10-19", "columns": cols, "changes": [["WI", "BADGER GRAIN", "WHEELER", "corn", "December 2026", "x", -45, -40]]},
                  open(os.path.join(bdir, "changes-2026-10-19.json"), "w"))
        json.dump({"date": "2026-10-21", "columns": cols, "changes": [["WI", "BADGER GRAIN", "WHEELER", "corn", "December 2026", "x", -45, -50],
                                                                       ["IA", "NOBODY", "X", "corn", "", "", 1, 2]]},
                  open(os.path.join(bdir, "changes-2026-10-21.json"), "w"))
        # ledger elevIds are None here (no id for the test board); give it one
        for day in ("2026-10-19", "2026-10-20", "2026-10-21"):
            doc = read_day(out, day)
            for x in doc["rows"]:
                x[0] = "etest"
            write_file(day_path(out, day), gz(doc))
        c = compare(out, bdir, "2026-10-19", "2026-10-21", key_ids={"WI|BADGER GRAIN|WHEELER": "etest"})
        ck("compare: 3 log rows, 1 without an id, 1 agrees, 1 has no matching move",
           c["n_log"] == 3 and c["no_id"] == 1 and c["n"] == 2 and c["agree"] == 1 and c["unmatched"] == 1 and c["rate"] == 0.5)
        sp2 = spread(out, bdir, "2026-10-21", "2026-10-19", key_ids={"WI|BADGER GRAIN|WHEELER": "etest"})
        ck("spread: the catch-up row's move is found on the day the ledger saw it", sp2["byDay"] == {"2026-10-21": 1})
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    print("bid_change_ledger selftest: %d failure(s)" % len(fails))
    return 1 if fails else 0


# ------------------------------------------------------------------ cli
def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if argv[:1] == ["--selftest"]:
        return selftest()
    ap = argparse.ArgumentParser(prog="bid_change_ledger.py")
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("run")
    s.add_argument("--repo", required=True)
    s.add_argument("--out", default=ROOT)
    s.add_argument("--state")
    s.add_argument("--until")
    s.add_argument("--until-ct-midnight", action="store_true")
    s.add_argument("--max-minutes", type=float)
    s.add_argument("--fetch-blobs", action="store_true")
    s.add_argument("--snapshots", action="store_true")
    s.add_argument("--snap-dir", default=ROOT)
    s.add_argument("--snap-since", default=SNAP_SINCE)
    s.add_argument("--snap-until", default=SNAP_UNTIL)
    s.add_argument("--summary")
    for name in ("compare", "spread"):
        s = sub.add_parser(name)
        s.add_argument("--ledger", default=ROOT)
        s.add_argument("--basis", default=os.path.join(ROOT, "data", "basis"))
        s.add_argument("--since", required=True)
        s.add_argument("--until")
        s.add_argument("--day")
    a = ap.parse_args(argv)

    if a.cmd == "run":
        sp = a.state or os.path.join(a.out, OUT_DIR, "state.json.gz")
        state = load_state(sp)
        until = None
        if a.until_ct_midnight:
            until = ct_midnight_ts()
        elif a.until:
            until = parse_ts(a.until)
        git = Git(a.repo, fetch_remote="origin" if a.fetch_blobs else None)
        snaps = None
        if a.snapshots:
            import bid_snapshots as bs
            keys, _ = bs.load_ids()
            snaps = {"since": a.snap_since, "until": a.snap_until, "dir": a.snap_dir, "keys": keys}
        try:
            r = walk(git, state, a.out, until_ts=until, max_minutes=a.max_minutes, snaps=snaps)
        finally:
            git.close()
        write_file(sp, gz(state))
        rows = sum(n for _, n in r["days"])
        msg = (f"{len(r['days'])} day(s) written ({r['days'][0][0] if r['days'] else '-'} to "
               f"{r['days'][-1][0] if r['days'] else '-'}), {rows} changes, {len(r['snapshots'])} snapshot(s) rebuilt, "
               f"{r['fetched']} blobs fetched; " + (f"{r['left']} day(s) left: dispatch again" if r["stopped"] else "caught up"))
        print("[change-ledger] " + msg)
        if a.summary:
            with open(a.summary, "a") as f:
                f.write(f"### Bid change ledger\n\n{msg}\n\n")
                for d, n in r["snapshots"]:
                    f.write(f"- snapshot {d}: {n}\n")
        return 0
    if a.cmd == "compare":
        print(json.dumps(compare(a.ledger, a.basis, a.since, a.until or a.since), indent=1))
        return 0
    if a.cmd == "spread":
        print(json.dumps(spread(a.ledger, a.basis, a.day, a.since), indent=1))
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
