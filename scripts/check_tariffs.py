"""Validate data/tariffs.json against exactly what tariffs.html will DO with it.

Not a schema check. Every rule here is something the page silently swallows:

  - the page renders the timeline in FILE ORDER and does not sort. A refresh that
    prepends new events as a block leaves them out of sequence and nothing warns.
    That happened on 2026-09-02: Jul 6 landed after Jul 21.
  - `impact` becomes a CSS class. Only .tl-dot.high/.medium/.low exist, so any
    other word renders an invisible dot.
  - `status` falls through to 'mixed' for anything unrecognised, so a typo shows a
    confident wrong badge rather than an error.
  - a missing key renders the string "undefined" into reader copy.
  - a future-dated entry on a timeline of what HAPPENED is a claim we cannot support.

It also prints which staleness banner a reader will see, because the page shows an
amber warning past 14 days and a red one past 45, and the person editing the file
is the one who should know which they just armed.

Run: python3 scripts/check_tariffs.py     (exit 1 on any failure)
"""
import json, sys, datetime, re
d = json.load(open("data/tariffs.json"))
fail = []
def bad(m): fail.append(m)

# 1. the page renders the timeline in FILE ORDER, newest at the top
dates = [t["date"] for t in d["timeline"]]
if dates != sorted(dates, reverse=True):
    bad(f"timeline is not newest-first in file order: {dates}")

# 2. impact becomes a CSS class; only three exist (.tl-dot.high/.medium/.low)
for t in d["timeline"]:
    if t.get("impact") not in {"high", "medium", "low"}:
        bad(f"{t['date']}: impact {t.get('impact')!r} has no CSS class")

# 3. status falls through to 'mixed' for anything unrecognised — say it on purpose
for r in d["rows"]:
    if r.get("status") not in {"elevated", "normal", "mixed"}:
        bad(f"{r['commodity']}/{r['destination']}: status {r.get('status')!r} renders as 'mixed' by accident")
if d.get("status") not in {"elevated", "normal", "mixed"}:
    bad(f"top-level status {d.get('status')!r} is not a rendered class")

# 4. every claim carries a source, and it is a real absolute url
for t in d["timeline"]:
    if not str(t.get("source_url","")).startswith("http"): bad(f"{t['date']}: no source_url")
for r in d["rows"]:
    if not str(r.get("source_url","")).startswith("http"): bad(f"{r['commodity']}/{r['destination']}: no source_url")

# 5. required keys, because a missing one renders as 'undefined'
for t in d["timeline"]:
    for k in ("date","event","impact","source_url"):
        if not t.get(k): bad(f"timeline {t.get('date')}: missing {k}")
for r in d["rows"]:
    for k in ("commodity","destination","rate","baseline","status","note","source_url","effective"):
        if not r.get(k): bad(f"row {r.get('commodity')}: missing {k}")

# 6. dates are real and not in the future
today = datetime.date.today()
for t in d["timeline"]:
    try: dt = datetime.date.fromisoformat(t["date"])
    except Exception: bad(f"unparseable date {t['date']}"); continue
    if dt > today: bad(f"{t['date']} is in the future — the timeline is what HAPPENED")
try:
    u = datetime.date.fromisoformat(d["updated"])
    if u > today: bad(f"updated {d['updated']} is in the future")
except Exception: bad("updated is not an ISO date")

# 7. the staleness banner: >45d red, >14d amber. Say which the reader will see.
age = (today - datetime.date.fromisoformat(d["updated"])).days
banner = "RED ALERT" if age > 45 else "amber warn" if age > 14 else "none"
print(f"updated {d['updated']} ({age} days old) -> staleness banner: {banner}")

# 8. no emoji in reader copy (house rule); row 'icon' is a separate field and is exempt
EMOJI = re.compile("[\U0001F300-\U0001FAFF☀-➿]")
for t in d["timeline"]:
    if EMOJI.search(t["event"]): bad(f"{t['date']}: emoji in event copy")
for r in d["rows"]:
    if EMOJI.search(r["note"]): bad(f"row {r['commodity']}: emoji in note copy")
for k in ("headline","status_note","status_label"):
    if EMOJI.search(d[k]): bad(f"{k}: emoji in reader copy")

print(f"{len(d['timeline'])} timeline entries, {len(d['rows'])} rows")
if fail:
    print("\nFAILED:"); [print("  -", f) for f in fail]; sys.exit(1)
print("OK — every check passed")
