"""Monthly restore test: rebuild one past day's cash-bid town cards from the raw daily snapshot.

  python3 scripts/restore_test.py [--month YYYY-MM] [--day YYYY-MM-DD] [--state iowa] [--ref origin/raw] [--min 0.99]
  python3 scripts/restore_test.py --selftest

Picks a past weekday and one state at random, seeded by the month (the same month always picks the
same pair, so a rerun repeats the test), reads that day's snapshot (bids-daily/YYYY/DAY.json.gz on the
private raw branch, scripts/bid_snapshots.py), and checks it against the town pages for that state as
they were baked at the page rebuild commit nearest the snapshot's network time (git history of main).

Every corn and soybean row on a baked town card (elevator ZIP, or its town when the card prints no ZIP;
crop; delivery month; cash to the cent)
must be found in the snapshot for that state. A card whose elevator posted again between the page
build and the snapshot (either way round: the snapshot holds a later post, or the page shows a post
made after the snapshot's network time) is left out of the count (its numbers moved; that is not a lost record) and
counted on its own line (more than 40% left out fails: too little was compared). Only live daily captures are tested (not days rebuilt later from board
history, not days marked partial). Passes when at least --min of the rows match; exit 1 otherwise, or when no
pair can be tested, or when no card row can be read at all (a page layout change says so here).

RAW_GIT: a clone holding the raw branch, as bid_snapshots.py reads it (default this checkout).
PAGES_GIT: the agsist clone whose history holds the baked pages (default this checkout).
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import argparse
import datetime as dt
import html
import os
import random
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import bid_snapshots  # noqa: E402

STATES = {
    "alabama": "AL", "arizona": "AZ", "arkansas": "AR", "california": "CA", "colorado": "CO", "connecticut": "CT",
    "delaware": "DE", "florida": "FL", "georgia": "GA", "idaho": "ID", "illinois": "IL", "indiana": "IN",
    "iowa": "IA", "kansas": "KS", "kentucky": "KY", "louisiana": "LA", "maine": "ME", "maryland": "MD",
    "massachusetts": "MA", "michigan": "MI", "minnesota": "MN", "mississippi": "MS", "missouri": "MO",
    "montana": "MT", "nebraska": "NE", "nevada": "NV", "new-hampshire": "NH", "new-jersey": "NJ",
    "new-mexico": "NM", "new-york": "NY", "north-carolina": "NC", "north-dakota": "ND", "ohio": "OH",
    "oklahoma": "OK", "oregon": "OR", "pennsylvania": "PA", "rhode-island": "RI", "south-carolina": "SC",
    "south-dakota": "SD", "tennessee": "TN", "texas": "TX", "utah": "UT", "vermont": "VT", "virginia": "VA",
    "washington": "WA", "west-virginia": "WV", "wisconsin": "WI", "wyoming": "WY",
}
MON = {m: i + 1 for i, m in enumerate("Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split())}
REBUILD_MSG = "pages: rebuild /cash-bids town pages"
MAX_GAP_H = 3          # the rebuild commit must be this close to the snapshot's network time
MIN_TOWNS = 10         # a state with fewer town pages is not picked
MIN_ROWS = 100         # nor one whose cards hold fewer corn and soybean rows
LOOKBACK_DAYS = 120
MAX_LEFT_OUT = 0.4     # more cards than this left out (posted again in between) and the test proves too little
NEWEST_DAYS = 3        # never today's or the last few days' snapshot

SECTION_RE = re.compile(r'<section class="cbt-el">(.*?)</section>', re.S)
ZIP_RE = re.compile(r'<div class="loc">[^<]*?(\d{5})</div>')
LOC_RE = re.compile(r'<div class="loc">([^<]*)</div>')
ASOF_RE = re.compile(r'<time class="asof"[^>]*datetime="([^"]+)"')
ROW_RE = re.compile(r'<tr><td>(Corn|Soybeans)</td><td>(.*?)</td><td class="n">\$([\d.,]+)</td>')
DELIV_RE = re.compile(r"([A-Z][a-z]{2})[a-z]*(?:\s*-\s*[A-Z][a-z]+)? '?(\d{4}|\d{2})$")


def cents(v):
    """Cash to the cent, half up, the way the town pages print it (build_cash_bid_pages.cash_c)."""
    n = abs(float(v)) * 100 + 1e-7
    return int(n + 0.5) * (-1 if v < 0 else 1)


def month_of(label):
    m = DELIV_RE.match(html.unescape(label).strip())
    if not m or m.group(1) not in MON:
        return None
    return "%s-%02d" % (("20" + m.group(2))[-4:], MON[m.group(1)])


ABBR = {"mt": "mount", "st": "saint", "ste": "sainte", "ft": "fort"}


def place(s):
    """A place name, lower case, letters and digits only; St, Mt, Ft written out."""
    w = re.split(r"[^a-z0-9]+", html.unescape(s or "").lower())
    return "".join(ABBR.get(x, x) for x in w if x)


def words(s):
    """Every word of a location's names, and each run of two or three words written together
    ("Stevens Point" also as stevenspoint), normalized like place()."""
    w = [place(x) for x in re.split(r"[^A-Za-z0-9]+", html.unescape(s or "")) if place(x)]
    return set(w) | {"".join(w[i:i + n]) for n in (2, 3) for i in range(len(w) - n + 1)}


def card_rows(page, town=""):
    """(zip or None, places, asof or '', [(crop, month or None, cents)]) for each elevator card on a town page.
    places: the comma parts of the card's address line, for a card that prints no ZIP; a card with no
    address line at all is the page's own town."""
    out = []
    for sec in SECTION_RE.findall(page):
        z = ZIP_RE.search(sec)
        a = ASOF_RE.search(sec)
        loc = LOC_RE.search(sec)
        places = tuple(p for p in (place(x) for x in (loc.group(1) if loc else town).split(",")) if p and not p.isdigit())
        rows = [("corn" if c == "Corn" else "soybeans", month_of(d), int(round(float(p.replace(",", "")) * 100)))
                for c, d, p in ROW_RE.findall(sec)]
        out.append((z.group(1) if z else None, places, a.group(1) if a else "", rows))
    return out


def snapshot_index(snap, abbr):
    """keys: (zip, crop, cents, month) and (zip, crop, cents, None); latest post per ZIP; and per location
    its name text (city, branch, town, board) with its own row keys, for cards that print no ZIP."""
    keys, latest, named = set(), {}, []
    for l in snap["locs"]:
        loc = dict(zip(snap["locCols"], l[:-1]))
        if loc.get("state") != abbr:
            continue
        z = (loc.get("zip") or "")[:5]
        mine, last = set(), ""
        for row in l[-1]:
            r = dict(zip(snap["rowCols"], row))
            p = r.get("posted") or ""
            if p > latest.get(z, ""):
                latest[z] = p
            last = max(last, p)
            if r.get("category") not in ("corn", "soybeans") or not isinstance(r.get("cash"), (int, float)):
                continue
            c, m = cents(r["cash"]), (r.get("start") or "")[:7] or None
            mine |= {(r["category"], c, m), (r["category"], c, None)}
        keys |= {(z,) + k for k in mine}
        named.append((words(" ".join(str(loc.get(k) or "") for k in ("city", "branch", "town", "board"))), mine, last))
    return keys, latest, named


def compare(pages, snap, abbr, when=None):
    """Match every baked corn and soybean card row against the snapshot. pages: {name: html}."""
    keys, latest, named = snapshot_index(snap, abbr)
    near = {}

    def candidates_of(places):
        if places not in near:
            got = [(k, t) for ws, k, t in named if any(p in ws for p in places)]
            near[places] = (set().union(*[k for k, _ in got]), max([t for _, t in got], default=""))
        return near[places]

    res = {"rows": 0, "matched": 0, "moved_cards": 0, "cards": 0, "missed": []}
    for name, page in sorted(pages.items()):
        for z, places, asof, rows in card_rows(page, name.rsplit(".", 1)[0]):
            if not rows:
                continue
            res["cards"] += 1
            last = latest.get(z, "") if z else candidates_of(places)[1]
            if asof and ((last and last[:16] != asof[:16]) or (when and asof[:16] > when[:16])):
                res["moved_cards"] += 1
                continue
            for crop, m, c in rows:
                res["rows"] += 1
                if z:
                    hit = (z, crop, c, m) in keys
                else:
                    hit = (crop, c, m) in candidates_of(places)[0]
                if hit:
                    res["matched"] += 1
                else:
                    res["missed"].append("%s %s %s %s %.2f" % (name, z or "-", crop, m or "?", c / 100))
    return res


# ---------------------------------------------------------------------- git
def pages_git(*args, text=True):
    return subprocess.run(["git", "-C", os.environ.get("PAGES_GIT") or ROOT, *args], capture_output=True, text=text)


def rebuild_commit(state, when, ref="HEAD"):
    """The page rebuild commit for this state nearest the snapshot's network time, within MAX_GAP_H."""
    t = dt.datetime.fromisoformat(when.replace("Z", "+00:00"))
    lo, hi = t - dt.timedelta(hours=MAX_GAP_H), t + dt.timedelta(hours=MAX_GAP_H)
    out = pages_git("log", "--format=%H %cI", "--since=" + lo.isoformat(), "--until=" + hi.isoformat(),
                    "--fixed-strings", "--grep=" + REBUILD_MSG, ref, "--", "cash-bids/%s/" % state if state else "cash-bids/").stdout.split("\n")
    best = None
    for line in filter(None, out):
        sha, iso = line.split(" ", 1)
        gap = abs((dt.datetime.fromisoformat(iso) - t).total_seconds())
        if best is None or gap < best[1]:
            best = (sha, gap)
    return best


def town_files(commit, state):
    out = pages_git("ls-tree", "--name-only", commit, "cash-bids/%s/" % state).stdout.split()
    return [f for f in out if f.endswith(".html") and not f.endswith("/index.html")]


def states_at(commit):
    out = pages_git("ls-tree", "--name-only", commit, "cash-bids/").stdout.split()
    return sorted(s.split("/")[-1] for s in out if s.split("/")[-1] in STATES)


def prefetch(commit, files):
    """In a blobless clone (the workflow's), fetch the pages in a few requests instead of one each."""
    if pages_git("config", "--get", "remote.origin.promisor").stdout.strip() != "true":
        return
    out = pages_git("ls-tree", commit, "--", *files).stdout.split("\n")
    oids = [l.split()[2] for l in out if l.split()[1:2] == ["blob"]]
    for i in range(0, len(oids), 200):
        pages_git("-c", "fetch.negotiationAlgorithm=noop", "fetch", "-q", "--no-tags", "--no-write-fetch-head",
                  "--filter=blob:none", "origin", *oids[i:i + 200])


def read_pages(commit, files):
    prefetch(commit, files)
    p = subprocess.run(["git", "-C", os.environ.get("PAGES_GIT") or ROOT, "cat-file", "--batch"],
                       input="".join("%s:%s\n" % (commit, f) for f in files).encode(), capture_output=True)
    data, pages, i = p.stdout, {}, 0
    for f in files:
        nl = data.index(b"\n", i)
        head = data[i:nl].split()
        if len(head) < 3 or head[1] != b"blob":
            i = nl + 1
            continue
        n = int(head[2])
        pages[f.split("/")[-1]] = data[nl + 1:nl + 1 + n].decode("utf-8", "replace")
        i = nl + 1 + n + 1
    return pages


# ---------------------------------------------------------------------- pick and run
def not_live(snap):
    """Why a snapshot is not a day's live capture (then it is not the test's subject), else None.
    Days before the daily capture began were rebuilt later from board history by another rule."""
    if snap.get("partial"):
        return "the snapshot is marked partial (%s)" % snap["partial"]
    if (snap.get("origin") or {}).get("backfill"):
        return "rebuilt later from board history, not the day's live capture"
    return None


def candidates(days, month, today):
    newest = (today - dt.timedelta(days=NEWEST_DAYS)).isoformat()
    oldest = (today - dt.timedelta(days=LOOKBACK_DAYS)).isoformat()
    pool = [d for d in days if oldest <= d <= newest and dt.date.fromisoformat(d).weekday() < 5]
    rng = random.Random("restore-test " + month)
    rng.shuffle(pool)
    return pool, rng


def run(month, ref, min_share, day=None, state=None, today=None, log=print):
    today = today or dt.datetime.now(dt.timezone.utc).date()
    days = [day] if day else bid_snapshots.list_days(ref=ref)
    pool, rng = candidates(days, month, today) if not day else (days, random.Random("restore-test " + month))
    tried = 0
    for d in pool:
        if tried >= 12:
            break
        snap = bid_snapshots.read_snapshot(d, ref=ref)
        why = not_live(snap)
        if why:
            log("skip %s: %s" % (d, why))
            continue
        tried += 1
        when = snap.get("network_generated") or snap.get("fetched")
        any_commit = rebuild_commit(None, when)
        if not any_commit:
            log("skip %s: no page rebuild commit within %d h of %s" % (d, MAX_GAP_H, when))
            continue
        order = [state] if state else states_at(any_commit[0])
        if not state:
            rng.shuffle(order)
        for st in order:
            found = rebuild_commit(st, when)
            if not found:
                continue
            files = town_files(found[0], st)
            if len(files) < MIN_TOWNS and not state:
                continue
            res = compare(read_pages(found[0], files), snap, STATES[st], when)
            if res["rows"] < MIN_ROWS and not state:
                continue
            return report(d, st, found, when, res, min_share, len(files), log)
    log("::error::restore test: no day and state could be tested (%d days tried)" % tried)
    return 1


def report(day, state, found, when, res, min_share, towns, log):
    share = res["matched"] / res["rows"] if res["rows"] else 0.0
    left_out = res["moved_cards"] / res["cards"] if res["cards"] else 0.0
    ok = res["rows"] > 0 and share >= min_share and left_out <= MAX_LEFT_OUT
    line = ("restore test %s %s: %d of %d corn and soybean card rows matched (%.2f%%) across %d town pages; "
            "%d of %d cards left out because the elevator posted again between the page build and the snapshot; "
            "pages at %s (%.0f min from the snapshot's network time %s)"
            % (day, state, res["matched"], res["rows"], 100 * share, towns, res["moved_cards"], res["cards"],
               found[0][:12], found[1] / 60, when))
    log(line)
    for m in res["missed"][:20]:
        log("  not in the snapshot: " + m)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as fh:
            fh.write(("PASS " if ok else "FAIL ") + line + "\n")
    if not res["rows"]:
        log("::error::restore test: no card row could be read from the baked pages; the page layout may have changed")
    elif left_out > MAX_LEFT_OUT:
        log("::error::restore test: %.0f%% of cards could not be compared (posted again in between); too few to judge" % (100 * left_out))
    elif not ok:
        log("::error::restore test: %.2f%% of rows matched, under %.0f%%" % (100 * share, 100 * min_share))
    return 0 if ok else 1


# ---------------------------------------------------------------------- selftest
def selftest():
    fails = []

    def check(cond, what):
        print(("ok   " if cond else "FAIL ") + what)
        if not cond:
            fails.append(what)

    check(cents(4.165) == 417 and cents(4.1225) == 412 and cents(13.4275) == 1343 and cents(4.0) == 400,
          "cash to the cent, half up like the pages")
    check(month_of("Oct 2026") == "2026-10" and month_of("Oct-Nov 26") == "2026-10" and month_of("Jan &#x27;27") == "2027-01"
          and month_of("By Oct 7") is None and month_of("Harvest") is None, "delivery labels to months")

    def card(z, asof, rows):
        loc = '<div class="loc">Main St, Ames, IA %s</div>' % z if z else '<div class="loc">Ames, IA</div>'
        tr = "".join('<tr><td>%s</td><td>%s</td><td class="n">$%s</td><td class="n">x</td></tr>' % r for r in rows)
        return ('<section class="cbt-el"><h2>Co</h2>%s<p class="cbt-posted"><time class="asof" data-asof="bids" '
                'datetime="%s">t</time></p><table class="cbt-t"><tbody>%s</tbody></table></section>' % (loc, asof, tr))

    snap = {"locCols": ["id", "facility", "branch", "city", "town", "state", "zip", "lat", "lon", "board"],
            "rowCols": bid_snapshots.ROW_COLS,
            "locs": [
                [None, "Co", "", "Ames", "", "IA", "50010", 0, 0, "b", [
                    ["Corn", "corn", "Nov26", "2026-11-01", "2026-11-30", 4.165, -0.25, None, None, "2026-11-06T19:30:31Z", "network"],
                    ["Soybeans", "soybeans", "Jan27", "2027-01-01", "2027-01-31", 11.2, -0.6, None, None, "2026-11-06T19:30:31Z", "network"]]],
                [None, "Moved", "", "Boone", "", "IA", "50036", 0, 0, "c", [
                    ["Corn", "corn", "Nov26", "2026-11-01", "2026-11-30", 4.50, -0.2, None, None, "2026-11-06T21:00:00Z", "network"]]],
                [None, "Other", "", "Ames", "", "IL", "61310", 0, 0, "d", [
                    ["Corn", "corn", "Dec26", "2026-12-01", "2026-12-31", 3.99, -0.2, None, None, "2026-11-06T19:00:00Z", "network"]]],
            ]}
    pages = {"ames.html": card("50010", "2026-11-06T19:30:31Z", [("Corn", "Nov 2026", "4.17"), ("Soybeans", "Jan 2027", "11.20")])
             + card("50036", "2026-11-06T19:00:00Z", [("Corn", "Nov 2026", "4.40")])
             + card(None, "2026-11-06T19:30:31Z", [("Corn", "Nov 2026", "4.17")])}
    r = compare(pages, snap, "IA")
    check(r["rows"] == 3 and r["matched"] == 3, "every row of an unmoved card is found (ZIP, crop, month, cash; no ZIP: the town)")
    check(r["moved_cards"] == 1 and r["cards"] == 3, "a card whose elevator posted again after the build is left out and counted")
    late = {"ames.html": card(None, "2026-11-06T20:30:00Z", [("Corn", "Nov 2026", "9.99")])}
    r = compare(late, snap, "IA", "2026-11-06T19:59:42Z")
    check(r["moved_cards"] == 1 and r["rows"] == 0, "a card posted after the snapshot's network time is left out too (no ZIP needed)")
    bad = {"ames.html": card("50010", "2026-11-06T19:30:31Z", [("Corn", "Nov 2026", "4.18"), ("Corn", "Dec 2026", "4.17")])}
    r = compare(bad, snap, "IA")
    check(r["rows"] == 2 and r["matched"] == 0 and len(r["missed"]) == 2, "a cent off or another month is a miss")
    r = compare({"ames.html": card("61310", "2026-11-06T19:00:00Z", [("Corn", "Dec 2026", "3.99")])}, snap, "IA")
    check(r["matched"] == 0, "another state's row never counts")
    logs = []
    check(report("2026-11-06", "iowa", ("a" * 40, 600), "t", {"rows": 100, "matched": 99, "moved_cards": 0, "cards": 9, "missed": []}, 0.99, 20, logs.append) == 0,
          "99 of 100 passes")
    check(report("2026-11-06", "iowa", ("a" * 40, 600), "t", {"rows": 100, "matched": 98, "moved_cards": 0, "cards": 9, "missed": []}, 0.99, 20, logs.append) == 1,
          "98 of 100 fails")
    check(report("2026-11-06", "iowa", ("a" * 40, 600), "t", {"rows": 100, "matched": 100, "moved_cards": 5, "cards": 9, "missed": []}, 0.99, 20, logs.append) == 1,
          "more than 40% of cards left out fails: too few compared")
    logs.clear()
    check(report("2026-11-06", "iowa", ("a" * 40, 600), "t", {"rows": 0, "matched": 0, "moved_cards": 0, "cards": 0, "missed": []}, 0.99, 20, logs.append) == 1
          and any("layout" in l for l in logs), "no row read at all fails and says why")
    check(not_live({}) is None and "partial" in not_live({"partial": "thin: 2 locations"})
          and "board history" in not_live({"origin": {"backfill": "x"}}), "only live captures are tested")
    days = ["2026-%02d-%02d" % (m, d) for m in (8, 9, 10, 11) for d in range(1, 29)]
    today = dt.date(2026, 11, 20)
    a, _ = candidates(days, "2026-11", today)
    b, _ = candidates(days, "2026-11", today)
    c, _ = candidates(days, "2026-12", today)
    check(a == b and a != c, "the pick is seeded by the month: a rerun repeats it, the next month differs")
    check(all(dt.date.fromisoformat(d).weekday() < 5 and d <= "2026-11-17" and d >= "2026-07-23" for d in a),
          "weekdays only, never the last %d days, within %d days" % (NEWEST_DAYS, LOOKBACK_DAYS))
    print("\n%d failed" % len(fails) if fails else "\nall restore_test checks passed")
    return 1 if fails else 0


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--month")
    ap.add_argument("--day")
    ap.add_argument("--state", choices=sorted(STATES))
    ap.add_argument("--ref", default=bid_snapshots.RAW_REF)
    ap.add_argument("--min", type=float, default=0.99)
    a = ap.parse_args(argv)
    if a.selftest:
        return selftest()
    month = a.month or dt.datetime.now(dt.timezone.utc).strftime("%Y-%m")
    if not re.match(r"^\d{4}-\d{2}$", month) or (a.day and not re.match(r"^\d{4}-\d{2}-\d{2}$", a.day)):
        print("::error::--month is YYYY-MM and --day is YYYY-MM-DD")
        return 2
    return run(month, a.ref, a.min, a.day, a.state)


if __name__ == "__main__":
    sys.exit(main())
