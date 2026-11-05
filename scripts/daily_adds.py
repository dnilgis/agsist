"""Two small additions to the Daily, both fail-soft (a missing piece prints nothing).

1. price_windows(): week so far / month to date / year to date for corn,
   soybeans and wheat, from the Daily's own stored issues.
2. ag_weather(): the opening sentences of the USDA weather summary, named in
   text, never linked.

Pure functions: the generator hands in what it has; tests hand in fixtures.
"""
import json
import re
import subprocess
from datetime import date, timedelta
from pathlib import Path

import pricefmt

ROOT = Path(__file__).resolve().parent.parent
ARCHIVE = ROOT / "data" / "daily-archive"

# wheat has no dated contract in the issue: before this date its stored prior
# close may belong to a different contract than today's, so it is not a baseline.
WHEAT_ONE_CONTRACT_FROM = "2026-11-04"

WINDOWS = (("week", "Week so far"), ("month", "Month to date"), ("year", "Year to date"))


def _d(s):
    try:
        return date.fromisoformat(str(s)[:10])
    except Exception:
        return None


def _starts(today):
    mon = today - timedelta(days=today.weekday())
    return {"week": mon, "month": today.replace(day=1), "year": today.replace(month=1, day=1)}


def _load(path):
    try:
        return json.loads(Path(path).read_text())
    except Exception:
        return None


def _baseline(rows, key, start):
    """The close just before `start`, taken from the first issue on or after it.
    rows: [(date, locked_changes)] oldest first. None unless that issue's own
    prior close is dated before `start` and within 6 days of it (no gap)."""
    for dt, lc in rows:
        if dt < start:
            continue
        ch = (lc or {}).get(key) or {}
        prev, pd = ch.get("prev"), _d(ch.get("prev_date"))
        if key == "wheat" and dt.isoformat() < WHEAT_ONE_CONTRACT_FROM:
            return None
        if not isinstance(prev, (int, float)) or prev <= 0 or pd is None:
            return None
        if pd >= start or (start - pd).days > 6:
            return None
        return prev
    return None


def price_windows(today_iso, quotes, today_changes, archive_dir=None):
    """quotes: the strip's quote dicts (key, name, contract, last). today_changes:
    today's locked_changes. Returns [{label, items:[{name, text}]}], possibly []."""
    today = _d(today_iso)
    if today is None:
        return []
    adir = Path(archive_dir) if archive_dir else ARCHIVE
    rows = []
    for p in sorted(adir.glob("20??-??-??.json")):
        dt = _d(p.stem)
        if dt is None or dt >= today:
            continue
        j = _load(p)
        if j and not j.get("market_closed"):
            rows.append((dt, j.get("locked_changes")))
    rows.append((today, today_changes))
    starts = _starts(today)
    out = []
    for wk, label in WINDOWS:
        items = []
        for q in quotes or []:
            key, last = q.get("key"), q.get("last")
            if not key or not isinstance(last, (int, float)):
                continue
            first = next((r for r in rows if r[0] >= starts[wk]), None)
            if first is None or first[0] == today and wk == "week":
                continue  # the first issue of the week: the day move already says it
            base = _baseline(rows, key, starts[wk])
            if base is None:
                continue
            cents = (last - base) * 100
            text = pricefmt.change(cents, cents / (base * 100) * 100, style="slash", arrow=False)[0]
            items.append({"name": q.get("name") or key, "text": text})
        if items:
            out.append({"label": label, "items": items})
    return out


def windows_text(pw):
    return [w["label"] + ": " + ", ".join("%s %s" % (i["name"], i["text"]) for i in w["items"]) for w in pw or []]


# ── USDA weather summary ────────────────────────────────────────────────
# Public-domain text from USDA's Office of the Chief Economist (WAOB). Tried in
# order; the first that returns readable text wins. None reachable: no line.
WEATHER_URLS = (
    "https://www.usda.gov/oce/weather/pubs/Daily/Ag_Weather_Highlights.txt",
    "https://www.usda.gov/oce/weather/pubs/Daily/Weather_Highlights.txt",
)
WEATHER_SOURCE = "USDA Office of the Chief Economist, agricultural weather highlights"


def _plain(raw):
    raw = re.sub(r"(?is)<(script|style).*?</\1>", " ", raw or "")
    raw = re.sub(r"(?s)<[^>]+>", " ", raw)
    return raw.replace("&nbsp;", " ").replace("&amp;", "&")


def first_sentences(raw, n=3, max_chars=520):
    """The first n sentences of the body: skips the title block and short or
    all-caps header lines. '' when nothing reads as prose."""
    text = _plain(raw)
    paras = [re.sub(r"\s+", " ", p).strip() for p in re.split(r"\n\s*\n", text)]
    for p in paras:
        if len(p) < 80 or p.upper() == p or p.count(". ") + p.count(".") < 1:
            continue
        sents = re.findall(r"[^.!?]+[.!?](?=\s|$)", p)
        sents = [s.strip() for s in sents if len(s.strip()) > 15]
        if len(sents) < 2:
            continue
        out = ""
        for s in sents[:n]:
            if len(out) + len(s) > max_chars:
                break
            out = (out + " " + s).strip()
        if out and not re.search(r"(?i)\b(cookie|javascript|subscribe|skip to)\b", out):
            return out
    return ""


def ag_weather(fetch, urls=WEATHER_URLS, today_iso=""):
    """fetch(url) -> text or None. {text, source, date} or None."""
    for u in urls:
        try:
            raw = fetch(u)
        except Exception:
            raw = None
        if not raw or raw.lstrip().startswith("%PDF"):
            continue
        # A guessed or moved URL can answer with an error or landing page written in prose. Print only text that is
        # plainly a weather summary: no error words, and at least two weather words in the chosen sentences.
        if re.search(r"(?i)\b(not found|404|error|page you requested|moved)\b", raw[:4000]):
            continue
        t = first_sentences(raw)
        wx = re.findall(r"(?i)\b(rain\w*|showers?|precipitation|temperatures?|snow\w*|frost|freez\w*|dry\w*|drought|warm\w*|cool\w*|storms?|fieldwork)\b", t)
        if t and len(wx) >= 2:
            return {"text": t, "source": WEATHER_SOURCE, "date": today_iso}
    return None
