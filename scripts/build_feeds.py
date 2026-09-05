#!/usr/bin/env python3
"""
THE FEED MANIFEST — what every published number is, who writes it, how often,
and when it is allowed to sit still.

WHY THIS EXISTS
---------------
On 2026-09-01 a freshness sweep found data/harvest-prices.json eighty-five days
old, written by a workflow called "Harvest price tracker" that runs every
weekday. That looks exactly like a dead job. It is not: the file says
`harvest.status: "pending"`, `window: "October"`, `days_counted: 0`. RMA harvest
price discovery for corn and soybeans happens in October. The tracker runs daily
and correctly writes nothing until then.

A FEED THAT IS CORRECTLY IDLE AND A FEED THAT IS BROKEN LOOK IDENTICAL FROM THE
OUTSIDE. That is the gap this manifest closes, and closing it is worth more than
another page: the site already tells a reader how old a number is, and this lets
it tell them whether that is expected.

status.html was already the right idea and already carries an "Idle / off-hours"
state -- it just knew about eight feeds. Measured the same morning: forty-five
distinct data files are fetched by a page, and thirty-seven of them were not on
the status page at all, including the three stalest.

WHAT IS DERIVED AND WHAT IS DECLARED
------------------------------------
DERIVED, by reading the repository -- never typed, so it cannot drift:
  * which pages fetch a feed        (grep every .html)
  * which workflow writes it        (the workflow names it, or runs a script
                                     that names it)
  * how often that workflow fires   (its cron, translated to Central)

DECLARED, in QUIET below, and ONLY where the repository itself states the
reason: a window named in the feed's own JSON, or a cron that only covers part
of the week. Anything whose cadence cannot be established comes out as
"unknown" and the status page says so. A made-up cadence would turn this page
into the thing it exists to prevent -- a reassuring number nobody checked.
"""
import glob
import json
import os
import re
import subprocess
import sys
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "feeds.json")

# ── feeds that are allowed to sit still, and the reason, from the data itself ──
# key: feed path.  value: (state, sentence shown to a reader).
# EVERY ONE OF THESE POINTS AT SOMETHING IN THE REPOSITORY. If you cannot
# finish the sentence with a fact, the feed does not belong here.
QUIET = {
    "data/harvest-prices.json": (
        "seasonal",
        "Harvest price discovery is October; the file's own harvest.status is "
        "\"pending\" until then. The projected price was final in February."),
    "data/rma-prices.json": (
        "seasonal",
        "RMA price discovery runs in defined windows; outside them there is "
        "nothing to publish."),
    "data/export-sales.json": (
        "weekly",
        "USDA FAS publishes export sales on Thursday mornings. Its workflow "
        "only fires Thursday and Friday."),
    "data/cot.json": (
        "weekly",
        "The CFTC Commitments of Traders report lands Friday afternoon."),
    "data/cot-history.json": (
        "weekly",
        "Rebuilt from cot.json, so it moves when the COT report does."),
    "data/crop-progress.json": (
        "weekly",
        "USDA Crop Progress is a Monday afternoon release, in season only."),
}

# ── feeds nobody schedules, because a person maintains them ──────────────────
# Not a guess: HANDOFF-MASTER lists the curated set explicitly — "CURATED data
# (ours to ship)". A curated feed with no cron is correct, and calling it
# "unknown" would put a permanent false warning on the status page.
CURATED = {
    "data/tariffs.json", "data/dairy-data.json", "data/poll.json",
    "data/afida/county.json", "data/rma-discovery.json",
    "data/rma-planting-dates.json",
}

# ── feeds another repository publishes, and this one only reads ─────────────
# cash-bids.html merges two sources: Barchart, and the elevator boards that
# dnilgis/bids reads itself. The second is published by that repository's own
# workflows to GitHub Pages, with CORS open, and NOTHING in this repository
# writes it — which is exactly right, and which the manifest would otherwise
# have to call "unknown" forever.
#
# It is not CURATED: no person edits it by hand. It is not PLANNED: it is live
# and current. It is external, and the cadence belongs to the other side.
EXTERNAL = {
    "data/merged-index.json": (
        "published by dnilgis/bids, refreshed with the boards",
        "The elevator bid network. dnilgis/bids reads ~650 boards and publishes "
        "this index and its shards to dnilgis.github.io/bids on its own "
        "schedule. cash-bids.html fetches it and falls back to Barchart alone "
        "if it is unreachable, so a stale or missing feed costs coverage and "
        "never breaks the page."),
}

# ── feeds a page is ready for but nothing publishes yet ──────────────────────
# Declared, not guessed: milk-prices.html says so in its own source — "Loads
# /data/dairy-data.json when the pipeline ships it. Every field falls back" —
# and it fetches with `r.ok ? r.json() : null`. The page degrades on purpose.
# Painting that red on the status page would be crying wolf about the one thing
# built not to break.
PLANNED = {
    "data/dairy-data.json": ("planned",
        "The dairy pipeline is not built yet. milk-prices.html expects this and "
        "falls back field by field when it is missing, on purpose."),
}

CENTRAL_OFFSET_H = -5   # CDT. Enough to name an hour in a sentence; the status
                        # page compares timestamps, not this.


def read(p):
    with open(p, errors="ignore") as fh:
        return fh.read()


def cron_sentence(crons):
    """A cron list -> a sentence a person can read. Nothing invented: every
    part of it comes off the expression."""
    if not crons:
        return None
    hours, dows = set(), set()
    for c in crons:
        f = c.split()
        if len(f) != 5:
            continue
        try:
            hours.add((int(f[1].split(",")[0].split("/")[0].lstrip("*") or 0) + CENTRAL_OFFSET_H) % 24)
        except ValueError:
            hours.add(None)
        dows.add(f[4])
    n = len(crons)
    when = ("weekdays" if all(d in ("1-5", "1,2,3,4,5") for d in dows)
            else "Mondays" if dows == {"1"}
            else "Fridays" if dows == {"5"}
            else "Thursdays" if dows == {"4"}
            else "every day" if dows == {"*"} else "on a fixed schedule")
    times = sorted(h for h in hours if h is not None)
    t = ", ".join("%d%s" % (h % 12 or 12, "am" if h < 12 else "pm") for h in times[:4])
    return "%d launch%s %s%s Central" % (n, "" if n == 1 else "es", when,
                                         " at about " + t if t else "")


def _field_hits(f, lo, hi):
    """Which values in [lo,hi] a single cron field matches. No library: the
    five forms GitHub accepts are *, a, a-b, a-b/n, */n, and comma lists."""
    out = set()
    for part in f.split(","):
        step = 1
        if "/" in part:
            part, st = part.split("/", 1)
            step = int(st)
        if part in ("*", ""):
            a, b = lo, hi
        elif "-" in part:
            a, b = (int(x) for x in part.split("-", 1))
        else:
            a = b = int(part)
        out |= set(range(a, b + 1, step))
    return {v for v in out if lo <= v <= hi}


def max_gap_hours(crons):
    """The longest a feed can legitimately go without a fire, in hours,
    measured by expanding its crons over one week.

    This is what lets the status page say "late" without anybody typing a
    threshold. A typed threshold is a number nobody re-checks when the schedule
    moves; this one moves with it."""
    if not crons:
        return None
    fires = set()
    for c in crons:
        f = c.split()
        if len(f) != 5:
            return None
        mins, hrs = _field_hits(f[0], 0, 59), _field_hits(f[1], 0, 23)
        dows = _field_hits(f[4], 0, 7)
        dows = {0 if d == 7 else d for d in dows}
        doms = f[2]
        if doms not in ("*", "?"):        # day-of-month schedules are monthly;
            return None                   # a week is the wrong ruler for them.
        for d in dows:
            for h in hrs:
                for m in mins:
                    fires.add(d * 1440 + h * 60 + m)
    if not fires:
        return None
    t = sorted(fires)
    gaps = [t[i + 1] - t[i] for i in range(len(t) - 1)] + [t[0] + 10080 - t[-1]]
    return round(max(gaps) / 60.0, 1)


def main():
    os.chdir(ROOT)

    # ── which pages fetch which feed ─────────────────────────────────────────
    readers = defaultdict(set)
    for p in sorted(glob.glob("*.html")) + sorted(glob.glob("components/*.html")):
        for m in set(re.findall(r"data/[\w/.-]+\.json", read(p))):
            # THE MANIFEST IS NOT ONE OF THE FEEDS IT DESCRIBES. status.html
            # reads it, so a plain grep enrolled it in its own list — with no
            # writer, which failed the "every feed has a cadence" check on the
            # file that exists to answer that question. Whether it is current
            # is scripts/test_feeds.py's job, not the status page's.
            if m.endswith("data/feeds.json"):
                continue
            readers[m].add(p)

    # ── which script WRITES which feed ───────────────────────────────────────
    # Reading a file and writing it are not the same relationship, and the first
    # pass conflated them: data/daily.json came out "written by Morning brief —
    # email Sigurd", which only reads it, while the workflow that actually
    # generates it was filtered away. A manifest that names the wrong owner is
    # worse than one that admits it does not know.
    #
    # So a script writes a path when the path appears on a line that also opens
    # for writing, dumps, or writes. Where that cannot be established the
    # workflow is still recorded, but under "touched_by" rather than claimed as
    # the writer.
    WRITEY = re.compile(r"""["']w["']|\bwrite_text\b|\bwriteFileSync\b|"""
                        r"""\bjson\.dump\b|\bwriteFile\b|\bto_csv\b""")
    writes, touches = defaultdict(set), defaultdict(set)
    for sc in sorted(glob.glob("scripts/*.py")) + sorted(glob.glob("scripts/*.mjs")):
        body = read(sc)
        for line in body.split("\n"):
            for m in set(re.findall(r"[\"']((?:data/)[\w/.-]+\.json)[\"']", line)):
                touches[m].add(sc)
                if WRITEY.search(line):
                    writes[m].add(sc)
        # `OUT = "data/x.json"` then `open(OUT, "w")` — follow one hop.
        for var, path in re.findall(r"^\s*([A-Z_][A-Z_0-9]*)\s*=\s*[\"']((?:data/)[\w/.-]+\.json)[\"']",
                                    body, re.M):
            if re.search(r"open\(\s*%s\s*,\s*[\"']w|%s\s*\)?\s*,\s*[\"']w|write_text|writeFileSync\(\s*%s"
                         % (var, var, var), body):
                writes[path].add(sc)

    # ── which workflow writes it, and on what cron ───────────────────────────
    wf_name, wf_cron = {}, {}
    wf_writes, wf_touch = defaultdict(set), defaultdict(set)
    for w in sorted(glob.glob(".github/workflows/*.yml")):
        s = read(w)
        m = re.search(r"^name:\s*(.+)$", s, re.M)
        wf_name[w] = (m.group(1).strip().strip('"') if m else os.path.basename(w))
        wf_cron[w] = re.findall(r"-\s*cron:\s*'([^']+)'", s)
        for f in set(re.findall(r"data/[\w/.-]+\.json", s)):
            wf_writes[f].add(w)
        # A WORKFLOW THAT OWNS A DIRECTORY OWNS THE FILES IN IT. nass-series.yml
        # writes `data/nass/*.json` and fetch_outlooks.yml writes `data/outlooks/`;
        # neither names a single file, so a filename-only scan reported twelve
        # NASS series and the outlook manifest as having no writer at all. A
        # manifest that cries "unknown" over a feed with a perfectly good owner
        # is the false alarm this whole thing exists to prevent.
        for d in set(re.findall(r"data/[\w-]+/(?=[\s*'\"]|\.json|$)", s)):
            for f in list(readers):
                if f.startswith(d):
                    wf_writes[f].add(w)
        for sc in set(re.findall(r"scripts/[\w.-]+\.(?:py|mjs)", s)):
            for f, owners in writes.items():
                if sc in owners:
                    wf_writes[f].add(w)
            for f, owners in touches.items():
                if sc in owners:
                    wf_touch[f].add(w)

    feeds = []
    for f in sorted(readers):
        ws = sorted(wf_writes.get(f, []))
        touched = sorted(set(wf_touch.get(f, [])) | set(wf_writes.get(f, [])))
        crons = [c for w in ws for c in wf_cron[w]]
        state, why = QUIET.get(f, PLANNED.get(f, (None, None)))
        ext = EXTERNAL.get(f)
        feeds.append({
            "path": f,
            "pages": sorted(readers[f]),
            "written_by": [wf_name[w] for w in ws],
            "touched_by": [wf_name[w] for w in touched],
            "cadence": (cron_sentence(crons)
                        or (ext[0] if ext
                            else "maintained by hand, not on a schedule" if f in CURATED
                            else "on demand" if ws else "unknown")),
            "curated": f in CURATED,
            "planned": f in PLANNED,
            "external": bool(ext),
            "crons": crons,
            # The longest legitimate silence, straight off the crons — so the
            # status page never carries a hand-typed threshold that goes stale
            # the day a schedule moves.
            "max_gap_hours": max_gap_hours(crons),
            "quiet": state,
            "why_quiet": why if why else (ext[1] if ext else None),
        })

    known = sum(1 for x in feeds if x["cadence"] != "unknown")
    payload = {
        "schema": "agsist-feeds/1",
        "generated_by": "scripts/build_feeds.py",
        "note": ("Derived from the repository, never typed. Pages come from a grep of "
                 "every .html; the writer and its cadence come from the workflow that "
                 "names the file or runs the script that names it."),
        "count": len(feeds),
        "with_known_cadence": known,
        "feeds": feeds,
    }
    text = json.dumps(payload, indent=1) + "\n"
    before = read(OUT) if os.path.exists(OUT) else None
    if text != before:
        with open(OUT, "w") as fh:
            fh.write(text)
        print("wrote " + OUT)
    else:
        print("unchanged")
    print("  %d feeds, %d with a cadence read off a cron, %d quiet by declaration"
          % (len(feeds), known, sum(1 for x in feeds if x["quiet"])))
    unknown = [x["path"] for x in feeds if x["cadence"] == "unknown"]
    print("  %d curated by hand" % sum(1 for x in feeds if x["curated"]))
    if unknown:
        print("  NO WRITER AND NOT DECLARED CURATED OR EXTERNAL — decide which: "
              + ", ".join(unknown))
    return 1 if unknown else 0


if __name__ == "__main__":
    sys.exit(main())
