#!/usr/bin/env python3
"""
daily_fact.py -- "I didn't know that" (was "I never knew that"; Sig, Oct 27) in the Daily (Sig, Oct 22 2026): one fact
a day that makes a reader stop. Never invented, never unsourced. Nov 1: "everything a farmer should know".

Two kinds, each with one of the CATEGORIES below:
  ours     computed every day from our own files, with the file named as the source, withheld when the data is
           thin or not yet read on that day:
             rain_day   the most rain any county station we read recorded in one day this year (lower 48), only
                        when another county in the same state recorded at least CORROBORATE of it the same day
                        (one gauge alone can be wrong), from data/rain/<st>.json
             dry_spell  the longest run of days without rain at a farm-state county station this year
             and the eleven in scripts/daily_fact_ours.py (hail, drought, WASDE history, land sales, cash rent,
             harvest pace, export sales, sale barn steers)
  pool     data/daily-facts.json: each entry has the fact, its category, the source's name, a link, the date it
           was read, and the source's own words. An entry missing any of them is never picked (valid_entry).
The old unsourced quote pool (data/quote-pool.json) stays off.

The schedule (Nov 1, 2026; replaces day-of-year modulo the pool size, where a fact came back every two weeks):
  - From EPOCH on, every day is worked out by walking the days from EPOCH, so a date always gives the same fact
    (the web page and the email agree) and no state is stored anywhere.
  - A cycle shows every fact once (pool and computed alike) before any comes back; a new cycle starts only when
    the last one is used up.
  - No category two days running. Each day takes the category with the largest share of its facts still unshown
    this cycle (forced to the biggest category when the rest could not keep it apart), then the category's fact
    that sorts first by a fixed hash of its id. Order never depends on where a fact sits in the file.
  - Adding facts never changes a day already passed: --import stamps each new entry with "added" (the day after
    the import), and an entry is not in the walk before that day. Entries with no "added" date are in from EPOCH.
    A new computed generator gets its own start date in OURS the same way.
  - A computed fact that is withheld on its day is replaced by a spare from the pool: the one shown longest ago
    whose category differs from the day before and the day after, so the category rule still holds.
  Days before EPOCH keep the old rotation (the issues already sent).

    python3 scripts/daily_fact.py --date 2026-11-02
    python3 scripts/daily_fact.py --days 60             the next 60 days: date, id, category, kind, and the checks
    python3 scripts/daily_fact.py --import answers.json merge sourced entries into the pool (drops and says why)
    python3 scripts/daily_fact.py --check               every pool entry has its source and category (exit 1 if not)
    python3 scripts/daily_fact.py --selftest
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import difflib
import glob
import hashlib
import json
import os
import re
import sys
from datetime import date, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import daily_fact_ours as OURS_MOD  # noqa: E402

POOL = os.path.join(REPO, "data", "daily-facts.json")
CATEGORIES = ("soil", "agronomy", "livestock", "weather and climate", "markets and prices", "land and rent",
              "machinery and safety", "farm history", "policy and programs", "global trade", "pests and disease",
              "food and the consumer")
EPOCH = date(2026, 11, 2)       # the first day on the schedule; never move it (it would reshuffle every day since)
SEED = "agsist-daily-fact-1"
MAX_WORDS = 45                  # an imported fact is one or two sentences
NEAR_SAME = 0.85
SPARE_GAP = 60                  # a stand-in is a fact not shown for at least this many days, when there is one                # imported text this close to an entry already in the pool is a duplicate
CORROBORATE = 0.4
MAX_MISSING = 10
LOWER48_SKIP = {"AK", "HI"}
FARM_STATES = {"IA", "IL", "IN", "OH", "MN", "NE", "SD", "ND", "WI", "MO", "KS", "MI", "KY"}
_URL = re.compile(r"^https://[a-z0-9.-]+\.[a-z]{2,}/")
_ISO = re.compile(r"^\d{4}-\d{2}-\d{2}$")
STATES = None


def _states():
    global STATES
    if STATES is None:
        import county_rain as R
        STATES = R.STATES
    return STATES


def _town(c):
    stn = c.get("station") or {}
    try:
        import county_rain as R
        if stn.get("raw"):
            return R.station_town(stn["raw"])
    except Exception:
        pass
    return stn.get("name") or "the county station"


def _md(iso):
    d = date.fromisoformat(iso)
    return d.strftime("%B ") + str(d.day)


def why_invalid(x):
    """None when a pool entry may be shown, else the reason in a few words. It needs all of: id, fact, category
    (one of CATEGORIES), source, an https link, the date it was read, and the source's own words."""
    if not isinstance(x, dict):
        return "not an object"
    for k in ("id", "fact", "category", "source", "url", "checked", "quote"):
        if not isinstance(x.get(k), str) or not x[k].strip():
            return "no " + k
    if x["category"] not in CATEGORIES:
        return "unknown category %r" % x["category"]
    if not _URL.match(x["url"]):
        return "link is not https"
    if not _ISO.match(x["checked"]):
        return "read date is not YYYY-MM-DD"
    if not re.search(r"\d|\bhalf\b", x["fact"]):
        return "no number in the fact"
    if "—" in x["fact"]:
        return "em dash in the fact"
    if "added" in x and not (isinstance(x["added"], str) and _ISO.match(x["added"])):
        return "added is not YYYY-MM-DD"
    return None


def valid_entry(x):
    """A pool entry may be shown only with all of: fact, category, source, an https link, the date it was read,
    and the source's own words."""
    return why_invalid(x) is None


def load_pool(path=POOL):
    try:
        with open(path, encoding="utf-8") as f:
            d = json.load(f)
    except (OSError, ValueError):
        return []
    return [x for x in (d.get("facts") or []) if valid_entry(x)]


def _counties(repo):
    for p in sorted(glob.glob(os.path.join(repo, "data", "rain", "??.json"))):
        try:
            with open(p, encoding="utf-8") as f:
                d = json.load(f)
        except (OSError, ValueError):
            continue
        st = str(d.get("state") or "").upper()
        for fips, c in (d.get("counties") or {}).items():
            if (c.get("missing") or 0) > MAX_MISSING or (c.get("acc") or 0) or (c.get("unsplit") or 0):
                continue
            yield st, fips, c, "data/rain/%s.json" % st.lower()


def rain_day(day, repo=REPO):
    rows = [(st, f, c, src) for st, f, c, src in _counties(repo)
            if st not in LOWER48_SKIP and isinstance(c.get("max_day"), list) and len(c["max_day"]) == 2
            and str(c.get("as_of") or "") <= day.isoformat()]
    by_day = {}
    for st, f, c, src in rows:
        by_day.setdefault((st, c["max_day"][0]), []).append(c["max_day"][1])
    rows.sort(key=lambda r: -float(r[2]["max_day"][1]))
    for st, f, c, src in rows[:20]:
        when, v = c["max_day"]
        others = sorted(by_day.get((st, when), []), reverse=True)[1:]
        if not others or others[0] < CORROBORATE * v:
            continue          # one gauge alone: could be a bad reading, so it is not said
        stn = _town(c)
        text = ("The most rain any county station we read got in one day this year: %.2f inches at %s, "
                "%s, %s, on %s." % (v, stn, c["name"], _states().get(st, st), _md(when)))
        return {"id": "ours-rain-day", "kind": "ours", "text": text,
                "source": "NOAA daily records via RCC-ACIS, %d county stations" % len(rows), "file": src,
                "url": None, "as_of": c.get("as_of")}
    return None


def dry_spell(day, repo=REPO):
    rows = [(st, f, c, src) for st, f, c, src in _counties(repo)
            if st in FARM_STATES and isinstance(c.get("dry"), list) and len(c["dry"]) == 3
            and str(c.get("as_of") or "") <= day.isoformat() and str(c["dry"][2]) <= day.isoformat()
            and not str(c["dry"][1]).endswith("-01-01")]   # a run from Jan 1 began last year: its length is not known
    if not rows:
        return None
    rows.sort(key=lambda r: (-int(r[2]["dry"][0]), r[1]))
    st, f, c, src = rows[0]
    n, a, b = c["dry"]
    stn = _town(c)
    text = ("The longest dry run at any farm-state county station we read this year: %d days without "
            "measurable rain or snow at %s, %s, %s, %s to %s." % (n, stn, c["name"], _states().get(st, st), _md(a), _md(b)))
    return {"id": "ours-dry-spell", "kind": "ours", "text": text,
            "source": "NOAA daily records via RCC-ACIS, %d farm-state county stations" % len(rows), "file": src,
            "url": None, "as_of": c.get("as_of")}


# ---------------------------------------------------------------- the schedule
# id, category, generator, first day on the schedule (a new generator gets the day it ships, never an older one),
# months it is scheduled in
ALL_YEAR = OURS_MOD.ALL_YEAR
OURS = (("ours-rain-day", "weather and climate", rain_day, EPOCH, tuple(range(2, 13))),
        ("ours-dry-spell", "weather and climate", dry_spell, EPOCH, tuple(range(3, 13)))) + tuple(
    (gid, cat, fn, EPOCH, months) for gid, cat, fn, months in OURS_MOD.GENERATORS)


def _h(s):
    return hashlib.sha256((SEED + "|" + s).encode("utf-8")).hexdigest()


def _key(x):
    """Order inside a category, as one hex string (so _neg still works on it):
      "0" + hash   a computed fact (ours): first in its category each cycle, as before the list came in;
      "1" + order  a pool entry with a send "order" (the Nov 2, 2026 list of 233, already in send order: feedbag
                   notes/chatgpt/2026-11-01-answers/README.md), in that order;
      "2" + hash   any other pool entry, by the fixed hash of its id.
    Adding the ordered list never changes a day before its "added" date: those days never saw it."""
    o = x.get("order")
    if isinstance(o, int) and not isinstance(o, bool) and o > 0:
        return "1" + "%063x" % o
    return "2" + _h(x["id"])


def _stopped(x):
    return isinstance(x.get("stop"), str) and bool(x["stop"].strip())


def _items(pool, gens=None):
    """[(id, category, kind, start, hash, months)] for the pool entries and the computed generators."""
    out = []
    for x in pool:
        start = date.fromisoformat(x["added"]) if x.get("added") else EPOCH
        # "stop" (a reason): the entry keeps its place on the schedule, so no other day moves, but it is never
        # printed again; its day takes a stand-in like a withheld computed fact (Nov 10, 2026: the 2025 US cash
        # rent after the 2026 figure came out)
        out.append((x["id"], x["category"], "stop" if _stopped(x) else "pool", max(start, EPOCH), _key(x), ALL_YEAR))
    for g in (OURS if gens is None else gens):
        out.append((g[0], g[1], "ours", max(g[3], EPOCH), "0" + _h(g[0]), tuple(g[4]) if len(g) > 4 else ALL_YEAR))
    seen, uniq = set(), []
    for it in out:
        if it[0] not in seen:
            seen.add(it[0])
            uniq.append(it)
    return uniq


_PLANS = {}


def _neg(hexs):
    return "".join("%x" % (15 - int(ch, 16)) for ch in hexs)


def plan(items, upto):
    """(days, spares): days[k] is the item for EPOCH + k, spares[k] the pool item that stands in when days[k] is a
    computed fact that is withheld that day (None for pool days). Walks every day from EPOCH to `upto`."""
    key = tuple(items)
    if key in _PLANS and _PLANS[key][0] >= upto:
        return _PLANS[key][1]
    upto = upto + timedelta(days=90)              # walk ahead once so the next days come from the same walk
    n = (upto - EPOCH).days + 1
    days, used, last, lastday = [], set(), None, {}
    for k in range(max(0, n)):
        d = EPOCH + timedelta(days=k)
        elig = [it for it in items if it[3] <= d and d.month in it[5]]
        if not elig:
            days.append(None)
            last = None
            continue
        rem = [it for it in elig if it[0] not in used]
        if not rem:
            used = set()                          # every fact shown once: the next cycle starts
            rem = elig
        left, tot = {}, {}
        for it in rem:
            left[it[1]] = left.get(it[1], 0) + 1
        for it in elig:
            tot[it[1]] = tot.get(it[1], 0) + 1
        cats = [c for c in left if c != last]
        pick = None
        if cats:
            big = max(cats, key=lambda c: (left[c], _h(c)))
            r = sum(left.values())
            if left[big] >= r - left[big] + 1 or (last in left and left.get(last, 0) >= r - left[last]):
                cat = big                         # the only order that can still keep categories apart
            else:
                cat = max(cats, key=lambda c: (left[c] / float(tot[c]), left[c], _h(c)))
            pick = min((it for it in rem if it[1] == cat), key=lambda it: it[4])
            used.add(pick[0])
        else:
            others = [it for it in elig if it[1] != last]
            if others:                            # only the last category is left this cycle: repeat the
                pick = min(others, key=lambda it: (lastday.get(it[0], -1), it[4]))   # longest-unseen other one
            else:
                pick = min(rem, key=lambda it: it[4])
                used.add(pick[0])
        lastday[pick[0]] = k
        last = pick[1]
        days.append(pick)
    # spares: a stand-in from the pool for each computed day, kept apart from both neighbours' categories. Only
    # what is known by that day decides it (so adding facts later never changes it): a fact last shown at least
    # SPARE_GAP days before, longest ago first; else one not shown yet, the one its category would show last;
    # else whatever was shown longest ago.
    spares, last_at = [], {}
    for k, it in enumerate(days):
        if it is None or it[2] not in ("ours", "stop"):
            spares.append(None)
        else:
            bar = set()
            for j in (k - 1, k + 1):
                if 0 <= j < len(days) and days[j]:
                    bar.add(days[j][1])
            if k > 0 and spares[k - 1]:
                bar.add(spares[k - 1][1])
            d = EPOCH + timedelta(days=k)
            pool = [x for x in items if x[2] == "pool" and x[3] <= d]

            def rank(x):
                at = last_at.get(x[0])
                if at is not None and k - at >= SPARE_GAP:
                    return (2, k - at, _neg(x[4]))
                if at is None:
                    return (1, 0, x[4])
                return (0, k - at, _neg(x[4]))
            pick = None
            for rule in (bar, {days[k - 1][1]} if k > 0 and days[k - 1] else set(), set()):
                cand = [x for x in pool if x[1] not in rule]
                if cand:
                    pick = max(cand, key=rank)
                    break
            spares.append(pick)
            if pick:
                last_at[pick[0]] = k
        if it is not None:
            last_at[it[0]] = k
    _PLANS.clear()
    _PLANS[key] = (upto, (days, spares))
    return days, spares


def _legacy(day, repo, pool):
    """The rotation used before EPOCH (day of year modulo the pool), kept so old issues read the same."""
    ours = (rain_day, dry_spell)
    n = len(pool) + len(ours)
    i = day.toordinal() % n
    if i < len(ours):
        try:
            got = ours[i](day, repo)
        except Exception as ex:
            print("daily fact: %s skipped (%s)" % (ours[i].__name__, type(ex).__name__))
            got = None
        if got:
            return dict(got, category="weather and climate")
        i = len(ours) + (day.toordinal() % max(1, len(pool)))
    if not pool:
        return None
    return _pool_fact(pool[(i - len(ours)) % len(pool)])


def _pool_fact(x):
    return {"id": x["id"], "kind": "pool", "category": x["category"], "text": x["fact"], "source": x["source"],
            "url": x["url"], "file": None, "checked": x["checked"], "refresh": bool(x.get("refresh"))}


def _run(gen, day, repo):
    try:
        return gen(day, repo)
    except Exception as ex:          # a file we cannot read: the day's spare stands in
        print("daily fact: %s skipped (%s)" % (getattr(gen, "__name__", "generator"), type(ex).__name__))
        return None


def for_day(day, repo=REPO, pool_path=None, gens=None):
    """The day's fact: {"text", "source", "url" or None, "file" or None, "id", "kind", "category"}, or None."""
    pool = load_pool(pool_path or os.path.join(repo, "data", "daily-facts.json"))
    gens = OURS if gens is None else gens
    if day < EPOCH:
        return _legacy(day, repo, pool) if pool else None
    items = _items(pool, gens)
    if not items:
        return None
    days, spares = plan(items, day + timedelta(days=1))
    k = (day - EPOCH).days
    it = days[k]
    if it is None:
        return None
    by_id = {x["id"]: x for x in pool}
    if it[2] in ("ours", "stop"):
        if it[2] == "ours":
            fn = {g[0]: g[2] for g in gens}[it[0]]
            got = _run(fn, day, repo)
            if got:
                return dict(got, id=it[0], kind="ours", category=it[1])
        it = spares[k]
        if it is None:
            return None
    return _pool_fact(by_id[it[0]])


# ---------------------------------------------------------------- import
def _norm(t):
    return " ".join(re.findall(r"[a-z0-9.]+", t.lower()))


def _near(a, b):
    a, b = _norm(a), _norm(b)
    if a == b:
        return True
    wa, wb = set(a.split()), set(b.split())
    if wa and wb and len(wa & wb) / float(len(wa | wb)) >= NEAR_SAME:
        return True
    return difflib.SequenceMatcher(None, a, b).ratio() >= NEAR_SAME + 0.07


def import_why(x, today):
    """The import rules on top of valid_entry: short, read on or before today, and every number in the fact is in
    the source's words unless a note says how it was worked out."""
    why = why_invalid(x)
    if why:
        return why
    if len(x["fact"].split()) > MAX_WORDS:
        return "fact longer than %d words" % MAX_WORDS
    if x["checked"] > today.isoformat():
        return "read date is in the future"
    if not (x.get("note") or "").strip():
        q = x["quote"].replace(",", "")
        for n in re.findall(r"\d[\d,]*(?:\.\d+)?", x["fact"]):
            n = n.replace(",", "").rstrip(".")
            if not re.search(r"(?<![\d.])" + re.escape(n) + r"(?![\d])", q):
                return "number %s is not in the source's words and no note says how it was worked out" % n
    return None


def read_entries(path):
    """A JSON array, or {"facts": [...]}, with any words after it (the answers carry a dropped-entries list)."""
    with open(path, encoding="utf-8") as f:
        text = f.read()
    i = min([j for j in (text.find("["), text.find("{")) if j >= 0] or [0])
    obj, _end = json.JSONDecoder().raw_decode(text[i:])
    return obj.get("facts") if isinstance(obj, dict) else obj


def import_entries(entries, pool_doc, today, added=None):
    """Merge `entries` into pool_doc["facts"] in place. -> (added entries, [(id, reason) dropped])."""
    added = added or (today + timedelta(days=1)).isoformat()
    facts = pool_doc.setdefault("facts", [])
    have_ids = {x.get("id") for x in facts}
    texts = [x.get("fact") or "" for x in facts]
    new, dropped = [], []
    for x in entries if isinstance(entries, list) else []:
        xid = x.get("id") if isinstance(x, dict) else None
        why = import_why(x, today)
        if not why and xid in have_ids:
            why = "id already in the pool"
        if not why:
            twin = next((t for t in texts if _near(t, x["fact"])), None)
            if twin is not None:
                why = "near the same words as a fact already in the pool"
        if why:
            dropped.append((str(xid), why))
            continue
        keep = {k: x[k].strip() for k in ("id", "category", "fact", "source", "url", "checked", "quote")}
        if (x.get("note") or "").strip():
            keep["note"] = x["note"].strip()
        if isinstance(x.get("order"), int) and not isinstance(x.get("order"), bool) and x["order"] > 0:
            keep["order"] = x["order"]        # send order inside its category (see _key)
        if x.get("refresh") is True:
            keep["refresh"] = True            # from a recurring report: re-check the page when a newer edition is out
        keep["added"] = added
        facts.append(keep)
        have_ids.add(xid)
        texts.append(keep["fact"])
        new.append(keep)
    return new, dropped


def do_import(path, today=None, pool_path=POOL):
    today = today or date.today()
    with open(pool_path, encoding="utf-8") as f:
        doc = json.load(f)
    try:
        entries = read_entries(path)
    except (OSError, ValueError) as ex:
        print("import: could not read %s (%s)" % (path, type(ex).__name__))
        return 1
    new, dropped = import_entries(entries, doc, today)
    with open(pool_path, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print("import: %d read, %d added (first day %s), %d dropped" % (
        len(entries or []), len(new), new[0]["added"] if new else "-", len(dropped)))
    for i, why in dropped:
        print("  dropped %s: %s" % (i, why))
    return 0


# ---------------------------------------------------------------- the next N days, and its checks
def run_days(start, n, repo=REPO, pool_path=None, gens=None, quiet=False):
    """The facts for n days from start, then the checks: no repeat, no category two days running."""
    rows = [(start + timedelta(days=k), for_day(start + timedelta(days=k), repo, pool_path, gens)) for k in range(n)]
    if not quiet:
        for d, f in rows:
            print("%s  %-26s %-22s %s" % (d, (f or {}).get("id"), (f or {}).get("category"), (f or {}).get("kind")))
    ids = [(f or {}).get("id") for _d, f in rows]
    cats = [(f or {}).get("category") for _d, f in rows]
    rep = len(ids) - len(set(ids))
    twice = sum(1 for a, b in zip(cats, cats[1:]) if a == b)
    first = next((k for k in range(len(ids)) if ids[k] in ids[:k]), None)
    if not quiet:
        print("%d days: %d repeats (first on day %s), %d times a category two days running, %d days with no fact"
              % (n, rep, first + 1 if first is not None else "-", twice, ids.count(None)))
    return rows, rep, twice, first


# ---------------------------------------------------------------- selftest
def _fake_pool(n, cats=CATEGORIES, prefix="f", added=None):
    out = []
    for i in range(n):
        x = {"id": "%s%03d" % (prefix, i), "category": cats[i % len(cats)], "fact": "Made-up fact number %d." % i,
             "source": "Test", "url": "https://example.org/%d" % i, "checked": "2026-11-01", "quote": "number %d" % i}
        if added:
            x["added"] = added
        out.append(x)
    return out


def _selftest():
    import tempfile
    bad = []

    def ok(c, m):
        if not c:
            bad.append(m)
            print("FAIL", m)
    pool = load_pool()
    with open(POOL, encoding="utf-8") as f:
        raw = json.load(f)["facts"]
    ok(len(pool) == len(raw) and len(pool) >= 10, "every pool entry is valid (%d of %d)" % (len(pool), len(raw)))
    ok(len({x["id"] for x in raw}) == len(raw), "pool ids unique")
    for k in ("source", "url", "checked", "quote", "category"):
        ok(not valid_entry(dict(raw[0], **{k: ""})), "an entry with no %s is never shown" % k)
    ok(not valid_entry(dict(raw[0], url="http://x.example/")), "https only")
    ok(not valid_entry(dict(raw[0], fact="Something nice about farming.")), "a fact carries a number")
    ok(not valid_entry(dict(raw[0], category="trivia")), "a category from the list only")
    ok(why_invalid(dict(raw[0], category="trivia")).startswith("unknown category"), "the reason is said")
    ok(all(x["category"] in CATEGORIES for x in raw), "every pool entry has a category")
    ok(len(CATEGORIES) == 12 and len({g[0] for g in OURS}) == len(OURS) >= 12, "12 categories, %d computed facts" % len(OURS))

    # the real pool and generators: deterministic, every day sourced, no category two days running
    start = EPOCH
    rows, rep, twice, first = run_days(start, 60, quiet=True)
    ok(all(f and f.get("text") and f.get("source") and (f.get("url") or f.get("file")) for _d, f in rows), "a sourced fact every day")
    ok(all("—" not in (f or {}).get("text", "") for _d, f in rows), "no em dash")
    ok(twice == 0, "no category two days running in 60 days (%d)" % twice)
    items = _items(pool)
    span = max(60, len(items) + 30)          # far enough to see one whole cycle (218 items since Nov 2, 2026)
    days, spares = plan(items, EPOCH + timedelta(days=span))
    sched = [it[0] if it else None for it in days[:span]]
    inseason = [it for it in items if EPOCH.month in it[5]]
    rep_at = next((k for k in range(span) if sched[k] is not None and sched[k] in sched[:k]), None)
    ok(rep_at is not None and rep_at >= len(inseason) - 1, "the schedule shows every fact once before any comes back (%s of %d)"
       % (rep_at, len(inseason)))
    ok(all(f["kind"] == "ours" or f["id"] == days[k][0] or (spares[k] and f["id"] == spares[k][0])
           for k, (_d, f) in enumerate(rows)), "each day is its scheduled fact or that day's stand-in")
    # the Nov 2, 2026 list: inside a category, ordered pool facts come out in their send order; refresh carries
    seen_o = {}
    for it in (x for x in days[:rep_at or span] if x and x[2] == "pool" and x[4].startswith("1")):   # first cycle
        seen_o.setdefault(it[1], []).append(int(it[4][1:], 16))
    ok(seen_o and all(v == sorted(v) for v in seen_o.values()), "ordered facts keep their send order inside each category")
    rf = next((x for x in pool if x.get("refresh")), None)
    ok(rf is None or _pool_fact(rf)["refresh"] is True, "a refresh fact says so to the sender")
    again = [for_day(d) for d, _f in rows[:10]]
    ok([f["id"] for f in again] == [f["id"] for _d, f in rows[:10]], "the same date gives the same fact")
    seen = {f["id"] for _d, f in rows}
    ok("ours-rain-day" in seen and "ours-dry-spell" in seen and len(seen) >= 20, "rotates through ours and the pool")
    latest = max((str(c.get("as_of") or "") for _st, _f, c, _src in _counties(REPO)), default="")
    r = rain_day(date.fromisoformat(latest)) if latest else None
    ok(r and re.search(r"\d+\.\d\d inches", r["text"]) and r["file"].startswith("data/rain/"), "our rain day names its file")

    # a full pool: 200 facts over 12 categories plus the computed ones, no generator data needed
    tmp = tempfile.mkdtemp(prefix="dfact-")
    big = _fake_pool(200)
    p = os.path.join(tmp, "pool.json")
    with open(p, "w", encoding="utf-8") as f:
        json.dump({"facts": big}, f)
    none = tuple((g[0], g[1], (lambda d, r: None), g[3], g[4]) for g in OURS)
    rows, rep, twice, first = run_days(EPOCH, 200, repo=tmp, pool_path=p, gens=none, quiet=True)
    ids = [f["id"] for _d, f in rows]
    gaps = [k - max(j for j in range(k) if ids[j] == i) for k, i in enumerate(ids) if i in ids[:k]]
    ok(twice == 0 and first is not None and first >= 90 and min(gaps) >= 30,
       "200 facts, every computed one withheld (the worst case): no category twice running, no repeat for 90 days,"
       " a stand-in at least 30 days from the same fact (%d, %s, %s)" % (twice, first, min(gaps or [0])))
    ok(all(f and f["kind"] == "pool" for _d, f in rows), "withheld computed facts are stood in for from the pool")
    days, _sp = plan(_items(big, none), EPOCH + timedelta(days=400))
    first_rep = next((k for k in range(len(days)) if days[k][0] in {x[0] for x in days[:k]}), None)
    seasonal = sum(1 for g in none if len(g[4]) < 12)
    ok(first_rep is not None and first_rep >= 200 + len(none) - seasonal - 1,
       "the schedule shows all %d (less %d out of season) before one comes back (%s)" % (200 + len(none), seasonal, first_rep))
    ok(all(days[k][1] != days[k + 1][1] for k in range(len(days) - 1)), "the schedule never puts a category twice running")
    # stable when facts are added: the days before "added" do not change
    ids_before = [f["id"] for _d, f in rows]
    more = big + _fake_pool(30, prefix="new", added=(EPOCH + timedelta(days=100)).isoformat())
    with open(p, "w", encoding="utf-8") as f:
        json.dump({"facts": more}, f)
    rows2, rep2, twice2, _ = run_days(EPOCH, 200, repo=tmp, pool_path=p, gens=none, quiet=True)
    ids_after = [f["id"] for _d, f in rows2]
    ok(ids_after[:100] == ids_before[:100], "adding facts never changes a day before they were added")
    ok(any(i.startswith("new") for i in ids_after[100:]) and not any(i.startswith("new") for i in ids_after[:100])
       and twice2 == 0, "new facts join from their day on")
    # order in the file does not matter
    with open(p, "w", encoding="utf-8") as f:
        json.dump({"facts": list(reversed(more))}, f)
    ok([f["id"] for _d, f in run_days(EPOCH, 150, repo=tmp, pool_path=p, gens=none, quiet=True)[0]] == ids_after[:150],
       "the file's order does not change the schedule")
    # a computed fact that is there is used; a withheld one gets a spare kept apart from its neighbours
    some = tuple((g[0], g[1], (lambda d, r, gid=g[0]: {"text": "Made-up %s on %s with 1 number." % (gid, d),
                                                         "source": "Test", "file": "data/x.json", "url": None})
                  if g[0].endswith(("rain-day", "drought")) else (lambda d, r: None), g[3], g[4])
                 for g in OURS)
    with open(p, "w", encoding="utf-8") as f:
        json.dump({"facts": _fake_pool(40)}, f)
    rows, rep, twice, _ = run_days(EPOCH, 120, repo=tmp, pool_path=p, gens=some, quiet=True)
    kinds = {f["id"] for _d, f in rows if f["kind"] == "ours"}
    ok(kinds == {"ours-rain-day", "ours-drought"} and twice == 0, "spares keep the category rule (%d, %s)" % (twice, sorted(kinds)))
    # a generator that raises is a spare, not a crash
    boom = tuple((g[0], g[1], (lambda d, r: 1 / 0), g[3], g[4]) for g in OURS)
    ok(all(f for _d, f in run_days(EPOCH, 30, repo=tmp, pool_path=p, gens=boom, quiet=True)[0]), "a generator error falls back")
    ok(for_day(EPOCH - timedelta(days=3)) is not None, "days before the schedule keep the old rotation")

    # import: bad entries dropped with the reason, ids and near-same text deduped, "added" stamped
    doc = {"facts": [dict(x) for x in raw]}
    today = date(2026, 11, 5)
    good = {"id": "soil-x", "category": "soil", "fact": "An inch of topsoil weighs about 150 tons an acre.",
            "source": "Test", "url": "https://example.org/soil", "checked": "2026-11-01",
            "quote": "one inch of soil over an acre weighs about 150 tons"}
    entries = [good,
               dict(good, id="soil-y"),                                        # same words
               dict(good, id=raw[0]["id"], fact="A new 7 inch fact.", quote="7 inch"),           # same id
               dict(good, id="no-src", source=""),
               dict(good, id="bad-cat", category="fun"),
               dict(good, id="no-num", fact="Soil is alive.", quote="soil is alive"),
               dict(good, id="not-in-quote", fact="An inch of topsoil weighs 300 tons an acre on clay."),
               dict(good, id="with-note", fact="Two inches of topsoil weigh about 300 tons an acre.", note="2 x 150"),
               dict(good, id="future", fact="A 9 inch thing.", quote="9 inch", checked="2026-12-01"),
               dict(good, id="long", fact="Word 1 " * 40)]
    new, dropped = import_entries(entries, doc, today)
    why = dict(dropped)
    ok([x["id"] for x in new] == ["soil-x", "with-note"], "import keeps the good ones (%s)" % [x["id"] for x in new])
    ok(all(x["added"] == "2026-11-06" for x in new), "import stamps the day after")
    ok(why.get("soil-y", "").startswith("near the same") and why.get(raw[0]["id"]) == "id already in the pool"
       and why.get("no-src") == "no source" and why.get("bad-cat", "").startswith("unknown category")
       and why.get("no-num") == "no number in the fact" and why.get("not-in-quote", "").startswith("number 300")
       and why.get("future") == "read date is in the future" and why.get("long", "").startswith("fact longer"),
       "import says why each one was dropped (%s)" % why)
    ok(all(valid_entry(x) for x in doc["facts"]), "the merged pool is all valid")
    ans = os.path.join(tmp, "answers.json")
    with open(ans, "w", encoding="utf-8") as f:
        f.write(json.dumps([good]) + "\n\nDropped: one page would not open.\n")
    ok(read_entries(ans) == [good], "the answers file can carry words after the array")
    # a stopped entry keeps its place (no other day moves) and is never printed; its day gets a stand-in
    sp = _fake_pool(24)
    p1, p2 = os.path.join(tmp, "p1.json"), os.path.join(tmp, "p2.json")
    with open(p1, "w", encoding="utf-8") as f:
        json.dump({"facts": sp}, f)
    with open(p2, "w", encoding="utf-8") as f:
        json.dump({"facts": [dict(x, stop="a newer edition is out") if x["id"] == "f005" else x for x in sp]}, f)
    d0 = EPOCH + timedelta(days=30)
    a = [(for_day(d0 + timedelta(days=k), pool_path=p1, gens=[]) or {}).get("id") for k in range(60)]
    b = [(for_day(d0 + timedelta(days=k), pool_path=p2, gens=[]) or {}).get("id") for k in range(60)]
    ok("f005" in a and "f005" not in b, "a stopped entry is never printed")
    ok(all(x == y for x, y in zip(a, b) if x != "f005") and all(y for x, y in zip(a, b) if x == "f005"),
       "a stopped entry moves no other day, and its day still has a fact")
    live = [x for x in raw if x.get("stop")]
    ok(all(isinstance(x["stop"], str) and x["stop"].strip() for x in live), "a stop says why")
    print("daily_fact selftest " + ("FAILED" if bad else "ok"))
    return 1 if bad else 0


def main(argv):
    if "--selftest" in argv:
        rc = OURS_MOD._selftest()
        return _selftest() or rc
    if "--check" in argv:
        with open(POOL, encoding="utf-8") as f:
            raw = json.load(f).get("facts") or []
        badones = [(str(x.get("id")), why_invalid(x)) for x in raw if not valid_entry(x)]
        ids = [x.get("id") for x in raw]
        dup = sorted({i for i in ids if ids.count(i) > 1})
        print("daily facts pool: %d entries, %d without a full source" % (len(raw), len(badones)))
        for b, why in badones:
            print("  %s: %s" % (b, why))
        for i in dup:
            print("  id twice: %s" % i)
        return 1 if badones or dup else 0
    if "--import" in argv:
        return do_import(argv[argv.index("--import") + 1])
    d = date.fromisoformat(argv[argv.index("--date") + 1]) if "--date" in argv else date.today()
    if "--days" in argv:
        _rows, rep, twice, _first = run_days(d, int(argv[argv.index("--days") + 1]))
        return 1 if twice else 0
    print(json.dumps(for_day(d), indent=1, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
