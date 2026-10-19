#!/usr/bin/env python3
"""Daily cash bid snapshots on the raw branch (Bet 7, Sig Oct 19).

data/bids.json on main holds only the latest pass, and the basis files keep
only basis changes, so a cash price is gone from main within days. This keeps
one full snapshot per trading day on the `raw` branch (never deployed):

    bids-daily/YYYY/YYYY-MM-DD.json.gz

One file per Central-time weekday (exchange holidays are kept like any weekday,
as scripts/build_bids_prev.py does). Inside, per elevator location, per
commodity, per delivery: cash, basis, futures contract and price, the time the
elevator posted it, and where the row came from. No phone numbers, no notes,
nothing about a person: business names, towns and coordinates only.

The step in .github/workflows/fetch_bids.yml runs `due` on every bids run. The
snapshot is due on the first run at or after 15:00 CT (CBOT grains close 13:20
CT; boards post their after-close bids by then) on a weekday whose file is not
on raw yet. So one snapshot a day, not one per poll; a failed push is retried
by the next run that day. `build --day D` over an existing day replaces it.

  python3 scripts/bid_snapshots.py due                 prints the CT day inside the window, else nothing
                                                       (the workflow then asks GitHub whether raw has it)
  python3 scripts/bid_snapshots.py build [--from bids-full.json] [--day D] [--out-dir .]
  python3 scripts/bid_snapshots.py list [--dir DIR | --ref origin/raw]
  python3 scripts/bid_snapshots.py load DAY [--dir DIR | --ref origin/raw] [--rows]
  python3 scripts/bid_snapshots.py backfill --from-git [--since D] [--until D] [--out-dir DIR] [--replace]
      OPT-IN, never run by a workflow. Rebuilds past days from the git history
      of data/bids.json (needs a full clone). Before 2026-06-09 the file was
      empty; 2026-06-09..08-18 it held every row (Barchart feed); from 08-19 it
      holds only the slim few hundred rows. Each file says which (`partial`).
      Then save with: bash scripts/push_raw.sh "bid snapshots backfill" bids-daily
  python3 scripts/bid_snapshots.py --selftest

In Python: from bid_snapshots import list_days, load_day.
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

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SCHEMA = "agsist-bids-daily/1"
DIR = "bids-daily"
AFTER_CT = (15, 0)          # first run at or after 15:00 Central takes the day
RAW_REF = "origin/raw"
IDS_LEDGER = os.path.join(ROOT, "data", "ids", "elevator-ids.json")
IDS_RECORDS = os.path.join(ROOT, "data", "ids", "elevators.json")
# In the file each location is LOC_COLS followed by its own list of rows (ROW_COLS). The key
# (facility|branch|city|state) is not stored: rows_of() rebuilds it. Nesting saves about 15%.
LOC_COLS = ["id", "facility", "branch", "city", "town", "state", "zip", "lat", "lon", "board"]
ROW_COLS = ["commodity", "category", "delivery", "start", "end", "cash", "basis",
            "futures", "futuresPrice", "posted", "src"]
FIRST_POPULATED = "2026-06-09"     # data/bids.json carried no rows before this (build_basis_history.py)
SLIM_FROM = "2026-08-19"           # from this day main held only the slim file


def clean(s):
    return " ".join(str(s or "").split())


def norm(s):
    return " ".join(str(s or "").strip().upper().split())


def place_str(fac, branch, city, st):
    """The bids.json place key, as scripts/build_ids.py writes it."""
    return "|".join(clean(x) for x in (fac, branch or "", city, st))


def path_for(day):
    return f"{DIR}/{day[:4]}/{day}.json.gz"


def ct_now(now=None):
    from zoneinfo import ZoneInfo
    now = now or dt.datetime.now(dt.timezone.utc)
    return now.astimezone(ZoneInfo("America/Chicago"))


def due_day(now=None):
    """The CT day a snapshot belongs to if `now` is inside the window, else None."""
    t = ct_now(now)
    if t.weekday() >= 5 or (t.hour, t.minute) < AFTER_CT:
        return None
    return t.date().isoformat()


# ------------------------------------------------------------------ ids
def load_ids(ledger_path=IDS_LEDGER, records_path=IDS_RECORDS):
    """(key -> id, board slug -> id). Empty maps if the files cannot be read."""
    keys, boards = {}, {}
    try:
        led = json.load(open(ledger_path, encoding="utf-8"))
        minted = led.get("minted") or {}

        def final(i):
            seen = set()
            while i in minted and minted[i].get("into") and i not in seen:
                seen.add(i)
                i = minted[i]["into"]
            return i
        keys = {k: final(v) for k, v in (led.get("keys") or {}).items() if isinstance(v, str)}
    except (OSError, ValueError, AttributeError):
        pass
    try:
        seen = {}
        for r in json.load(open(records_path, encoding="utf-8")).get("elevators") or []:
            for slug in (r.get("sources") or {}).get("bids_repo") or []:
                seen.setdefault(slug, set()).add(r.get("id"))
        boards = {s: next(iter(v)) for s, v in seen.items() if len(v) == 1 and None not in v}
    except (OSError, ValueError, AttributeError):
        pass
    return keys, boards


def num(v, nd=4):
    if isinstance(v, bool) or not isinstance(v, (int, float)) or v != v:
        return None
    return round(float(v), nd)


# ------------------------------------------------------------------ build
def build(doc, day, ids=None, partial=None, origin=None):
    """The snapshot dict for one day from a bids file (full or slim)."""
    keys, boards = ids if ids is not None else load_ids()
    bids = [b for b in (doc.get("bids") or []) if isinstance(b, dict)]
    # A board slug joins to an id only when it is one place in today's rows.
    places_of = {}
    for b in bids:
        if b.get("_board") and (num(b.get("cashPrice")) is not None or num(b.get("basis")) is not None):
            places_of.setdefault(b["_board"], set()).add(
                place_str(b.get("facility"), b.get("branch"), b.get("city"), norm(b.get("state"))))
    locs, loc_ix, rows, seen = [], {}, [], set()
    joined = dupes = 0
    for b in bids:
        cash, basis = num(b.get("cashPrice")), num(b.get("basis"))
        if cash is None and basis is None:
            continue
        st = norm(b.get("state"))
        k = place_str(b.get("facility"), b.get("branch"), b.get("city"), st)
        if k not in loc_ix:
            board = clean(b.get("_board"))
            eid = None
            if board and len(places_of.get(board, ())) == 1:
                eid = boards.get(board)
            eid = eid or keys.get("bids:" + k) or keys.get(f"basis:{st}|{norm(b.get('facility'))}|{norm(b.get('city'))}")
            joined += eid is not None
            loc_ix[k] = len(locs)
            locs.append([eid, k, clean(b.get("facility")), clean(b.get("branch")), clean(b.get("city")),
                         clean(b.get("town")), st, clean(b.get("zip"))[:5],
                         num(b.get("lat"), 5), num(b.get("lon"), 5), board or None])
        li = loc_ix[k]
        delivery = clean(b.get("deliveryMonth") or b.get("delivery"))
        sym = clean(b.get("symbol"))
        ident = (li, norm(b.get("commodity")), delivery, sym, b.get("deliveryStart"), b.get("deliveryEnd"))
        if ident in seen:          # first row wins on an exact repeat, as in build_basis_history.py
            dupes += 1
            continue
        seen.add(ident)
        src = b.get("source")
        src = "network" if src == "network" else (clean(src) or "barchart")
        rows.append([li, clean(b.get("commodity")), clean(b.get("category")), delivery,
                     b.get("deliveryStart") or None, b.get("deliveryEnd") or None, cash, basis,
                     sym or None, num(b.get("_fut")), b.get("_posted") or b.get("pricedAt") or b.get("timestamp") or None,
                     src])
    # Stable order: same input, same bytes, so a rerun on the same data is "no change" on raw.
    order = sorted(range(len(locs)), key=lambda i: (locs[i][6], locs[i][1]))
    remap = {old: new for new, old in enumerate(order)}
    locs = [locs[i] for i in order]
    for r in rows:
        r[0] = remap[r[0]]
    rows.sort(key=lambda r: (r[0], r[2], r[1], str(r[4]), r[3], str(r[8])))
    nested = [l[:1] + l[2:] + [[]] for l in locs]
    for r in rows:
        nested[r[0]][-1].append(r[1:])
    snap = {
        "schema": SCHEMA, "day": day,
        "fetched": doc.get("fetched"),
        "network_generated": (doc.get("barchart") or {}).get("network_generated"),
        "source": doc.get("source"),
        "partial": partial,
        "note": ("One AGSIST cash bid snapshot per Central-time weekday (scripts/bid_snapshots.py). "
                 "locs: one entry per elevator location, locCols then its rows (id = permanent elevator id "
                 "from data/ids when it joins, else null; join key = facility|branch|city|state). Each row "
                 "(rowCols) is one commodity and delivery at that location. cash and basis in dollars per bushel as posted; futuresPrice as the elevator "
                 "quoted it, null when not given (never derived). posted = when the elevator posted it."),
        "locCols": LOC_COLS, "rowCols": ROW_COLS,
        "counts": {"locs": len(locs), "rows": len(rows), "locsWithId": joined, "dupesDropped": dupes},
        "locs": nested,
    }
    if origin:
        snap["origin"] = origin
    return snap


def encode(snap):
    raw = json.dumps(snap, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    buf = io.BytesIO()
    with gzip.GzipFile(filename="", mode="wb", fileobj=buf, compresslevel=9, mtime=0) as g:
        g.write(raw)
    return buf.getvalue()


def write(snap, out_dir):
    p = os.path.join(out_dir, path_for(snap["day"]))
    os.makedirs(os.path.dirname(p), exist_ok=True)
    data = encode(snap)
    with open(p, "wb") as f:
        f.write(data)
    return p, len(data)


# ------------------------------------------------------------------ read
def _git(*args, text=True):
    return subprocess.run(["git", "-C", ROOT, *args], capture_output=True, text=text)


def list_days(dir=None, ref=RAW_REF):
    """Sorted days held, from a local folder (holding bids-daily/) or a git ref."""
    pat = re.compile(r"(\d{4}-\d{2}-\d{2})\.json\.gz$")
    if dir:
        out = []
        for base, _, files in os.walk(os.path.join(dir, DIR)):
            out += [m.group(1) for f in files for m in [pat.search(f)] if m]
        return sorted(out)
    r = _git("ls-tree", "-r", "--name-only", ref, "--", DIR)
    if r.returncode != 0:
        raise SystemExit(f"[bid-snapshots] cannot read {ref} (git fetch origin raw first): {r.stderr.strip()}")
    return sorted(m.group(1) for line in r.stdout.splitlines() for m in [pat.search(line)] if m)


def decode(data):
    snap = json.loads(gzip.decompress(data).decode("utf-8"))
    if snap.get("schema") != SCHEMA:
        raise ValueError(f"not a {SCHEMA} file: {snap.get('schema')}")
    return snap


def read_snapshot(day, dir=None, ref=RAW_REF):
    if dir:
        with open(os.path.join(dir, path_for(day)), "rb") as f:
            return decode(f.read())
    r = _git("show", f"{ref}:{path_for(day)}", text=False)
    if r.returncode != 0:
        raise SystemExit(f"[bid-snapshots] {path_for(day)} not on {ref}")
    return decode(r.stdout)


def rows_of(snap):
    """Every row as a flat dict, location fields included."""
    out = []
    for l in snap["locs"]:
        loc = {("locId" if k == "id" else k): v for k, v in zip(snap["locCols"], l[:-1])}
        loc["key"] = place_str(loc["facility"], loc["branch"], loc["city"], loc["state"])
        out += [{**loc, **dict(zip(snap["rowCols"], r))} for r in l[-1]]
    return out


def load_day(day, dir=None, ref=RAW_REF):
    """One day's rows as flat dicts."""
    return rows_of(read_snapshot(day, dir=dir, ref=ref))


# ------------------------------------------------------------------ due / backfill
def history_days(path="data/bids.json"):
    """{CT day: commit} for weekdays, the first commit at or after 15:00 CT, else the day's last."""
    from zoneinfo import ZoneInfo
    r = _git("log", "--format=%H %cI", "--", path)
    if r.returncode != 0:
        raise SystemExit(f"[bid-snapshots] git log failed: {r.stderr.strip()}")
    by = {}
    for line in r.stdout.splitlines():
        h, _, ts = line.partition(" ")
        t = dt.datetime.fromisoformat(ts).astimezone(ZoneInfo("America/Chicago"))
        if t.weekday() >= 5:
            continue
        by.setdefault(t.date().isoformat(), []).append((t, h))
    out = {}
    for day, cs in by.items():
        cs.sort()
        after = [c for c in cs if (c[0].hour, c[0].minute) >= AFTER_CT]
        out[day] = (after[0] if after else cs[-1])[1]
    return dict(sorted(out.items()))


def backfill(out_dir, since=None, until=None, replace=False):
    ids = load_ids()
    have = set(list_days(dir=out_dir))
    try:
        have |= set(list_days(ref=RAW_REF))
    except SystemExit:
        print("[bid-snapshots] raw not readable here; only skipping days already in --out-dir")
    n = total = 0
    for day, h in history_days().items():
        if day < max(FIRST_POPULATED, since or "") or (until and day > until):
            continue
        if day in have and not replace:
            continue
        r = _git("show", f"{h}:data/bids.json")
        try:
            doc = json.loads(r.stdout)
        except ValueError:
            continue
        if not doc.get("bids"):
            continue
        part = None if day < SLIM_FROM else "slim: main held only the bids the futures pages select"
        snap = build(doc, day, ids=ids, partial=part, origin={"backfill": "git history of data/bids.json", "commit": h})
        bad = privacy_problems(snap)
        if bad:
            print(f"{day} {h[:10]} skipped, possible personal data: {bad[:3]}")
            continue
        p, size = write(snap, out_dir)
        n += 1
        total += size
        print(f"{day} {h[:10]} {snap['counts']['rows']} rows {size} B -> {p}")
    print(f"[bid-snapshots] backfill wrote {n} day(s), {total / 1e6:.1f} MB. "
          f"Save with: bash scripts/push_raw.sh \"bid snapshots backfill\" {DIR}")


# ------------------------------------------------------------------ selftest
EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
PHONE = re.compile(r"\(?\b\d{3}\)?[-. ]\d{3}[-. ]\d{4}\b")


def privacy_problems(snap):
    s = json.dumps(snap)
    out = []
    if EMAIL.search(s):
        out.append("email: " + EMAIL.search(s).group(0))
    if PHONE.search(s):
        out.append("phone: " + PHONE.search(s).group(0))
    if set(snap["locCols"]) & {"phone", "notes"} or set(snap["rowCols"]) & {"phone", "notes"}:
        out.append("phone/notes column")
    return out


def selftest():
    import tempfile
    fails = []

    def ck(name, ok):
        print(("ok   " if ok else "FAIL ") + name)
        if not ok:
            fails.append(name)

    utc = dt.timezone.utc
    ck("Monday 14:59 CDT is not due", due_day(dt.datetime(2026, 10, 19, 19, 59, tzinfo=utc)) is None)
    ck("Monday 15:00 CDT is due for that day", due_day(dt.datetime(2026, 10, 19, 20, 0, tzinfo=utc)) == "2026-10-19")
    ck("Monday 23:30 CDT still that day", due_day(dt.datetime(2026, 10, 20, 4, 30, tzinfo=utc)) == "2026-10-19")
    ck("Tuesday 00:10 CDT is not due", due_day(dt.datetime(2026, 10, 20, 5, 10, tzinfo=utc)) is None)
    ck("Saturday is never due", due_day(dt.datetime(2026, 10, 24, 21, 0, tzinfo=utc)) is None)
    ck("15:00 CST in December is 21:00 UTC", due_day(dt.datetime(2026, 12, 7, 20, 30, tzinfo=utc)) is None
       and due_day(dt.datetime(2026, 12, 7, 21, 0, tzinfo=utc)) == "2026-12-07")

    row = {"facility": "Badger Grain Supply, LLC", "branch": "", "city": "Wheeler", "state": "wi", "zip": "54772-1",
           "commodity": "Corn", "category": "corn", "symbol": "ZCZ26", "cashPrice": 3.85, "basis": -0.45,
           "deliveryMonth": "Oct 2026", "deliveryStart": "2026-10-01", "deliveryEnd": "2026-10-31",
           "phone": "715-555-0100", "notes": "call Bob at bob@example.com", "lat": 45.0412345, "lon": -91.9,
           "source": "network", "_board": "badger-wheeler", "_posted": "2026-10-19T19:40:00Z", "_fut": 4.30}
    doc = {"fetched": "2026-10-19T20:07:00Z", "source": "AGSIST elevator network", "bids": [
        row,
        dict(row, cashPrice=3.99),                                   # same location/crop/delivery: dropped
        dict(row, deliveryMonth="Nov 2026", deliveryStart="2026-11-01", cashPrice=3.9, _fut=None),
        dict(row, facility="ADM", branch="Soy Processing", city="Decatur", state="IL", commodity="Soybeans",
             category="soybeans", _board="", source=None, phone="(217) 555-0101"),
        dict(row, facility="Nobody", city="X", state="IA", cashPrice=None, basis=None),   # no price: skipped
    ]}
    keys = {"bids:ADM|Soy Processing|Decatur|IL": "ezk9c693bk"}
    ids = (keys, {"badger-wheeler": "e000000001"})
    snap = build(doc, "2026-10-19", ids=ids)
    ck("two locations, three rows, one dupe dropped",
       snap["counts"] == {"locs": 2, "rows": 3, "locsWithId": 2, "dupesDropped": 1})
    rs = rows_of(decode(encode(snap)))
    adm = [r for r in rs if r["facility"] == "ADM"][0]
    bg = [r for r in rs if r["facility"].startswith("Badger")]
    ck("ADM joins by its bids key; Barchart-era row marked barchart",
       adm["locId"] == "ezk9c693bk" and adm["src"] == "barchart")
    ck("board slug joins the Badger board", all(r["locId"] == "e000000001" for r in bg))
    ck("round trip keeps cash, basis, futures, posted, first row wins",
       bg[0]["cash"] == 3.85 and bg[0]["basis"] == -0.45 and bg[0]["futures"] == "ZCZ26"
       and bg[0]["futuresPrice"] == 4.3 and bg[0]["posted"] == "2026-10-19T19:40:00Z")
    ck("futures price not given stays null (never derived)", bg[1]["futuresPrice"] is None)
    ck("no phone, no notes, no email anywhere", privacy_problems(snap) == []
       and "phone" not in rs[0] and "notes" not in rs[0])
    ck("same input gives the same bytes", encode(build(doc, "2026-10-19", ids=ids)) == encode(snap))
    two = build(dict(doc, bids=[row, dict(row, city="Boyceville")]), "2026-10-19", ids=ids)
    ck("a board with two places joins by slug for neither", [l[0] for l in two["locs"]] == [None, None])
    with tempfile.TemporaryDirectory() as d:
        p, _ = write(snap, d)
        write(dict(snap, fetched="later"), d)
        ck("path is bids-daily/YYYY/YYYY-MM-DD.json.gz", p.endswith("bids-daily/2026/2026-10-19.json.gz"))
        ck("list and load from a folder; rewrite replaces the day",
           list_days(dir=d) == ["2026-10-19"] and read_snapshot("2026-10-19", dir=d)["fetched"] == "later"
           and len(load_day("2026-10-19", dir=d)) == 3)
    print("selftest: %d failure(s)" % len(fails))
    return 1 if fails else 0


# ------------------------------------------------------------------ cli
def main(argv=None):
    if argv is None:
        argv = sys.argv[1:]
    if argv[:1] == ["--selftest"]:
        return selftest()
    ap = argparse.ArgumentParser(prog="bid_snapshots.py")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("due")
    s = sub.add_parser("build")
    s.add_argument("--from", dest="src", default="bids-full.json")
    s.add_argument("--day")
    s.add_argument("--out-dir", default=ROOT)
    s = sub.add_parser("list")
    s.add_argument("--dir")
    s.add_argument("--ref", default=RAW_REF)
    s = sub.add_parser("load")
    s.add_argument("day")
    s.add_argument("--dir")
    s.add_argument("--ref", default=RAW_REF)
    s.add_argument("--rows", action="store_true", help="print every row as a JSON line")
    s = sub.add_parser("backfill")
    s.add_argument("--from-git", action="store_true", required=True)
    s.add_argument("--since")
    s.add_argument("--until")
    s.add_argument("--out-dir", default=ROOT)
    s.add_argument("--replace", action="store_true")
    a = ap.parse_args(argv)

    if a.cmd == "due":
        day = due_day()
        if day:
            print(day)
        return 0
    if a.cmd == "build":
        with open(a.src, encoding="utf-8") as f:
            doc = json.load(f)
        day = a.day or ct_now().date().isoformat()
        snap = build(doc, day, partial=None if doc.get("full") else "slim: built from the browser file, not the full set")
        bad = privacy_problems(snap)
        if bad:
            print(f"::warning::bid snapshot: possible personal data, not written: {bad[:3]}")
            return 2
        p, size = write(snap, a.out_dir)
        c = snap["counts"]
        print(f"[bid-snapshots] {day}: {c['locs']} locations ({c['locsWithId']} with a permanent id), "
              f"{c['rows']} rows, {size / 1024:.1f} KB gzipped -> {os.path.relpath(p, a.out_dir)}")
        return 0
    if a.cmd == "list":
        for d in list_days(dir=a.dir, ref=a.ref):
            print(d)
        return 0
    if a.cmd == "load":
        snap = read_snapshot(a.day, dir=a.dir, ref=a.ref)
        if a.rows:
            for r in rows_of(snap):
                print(json.dumps(r))
        else:
            print(json.dumps({k: snap.get(k) for k in ("day", "fetched", "source", "partial", "counts", "origin")}))
        return 0
    if a.cmd == "backfill":
        backfill(a.out_dir, since=a.since, until=a.until, replace=a.replace)
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
