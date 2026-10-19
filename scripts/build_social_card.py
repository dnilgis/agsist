#!/usr/bin/env python3
"""build_social_card.py: the day's briefing as a share image.

Reads  : data/daily.json  (headline, one_number, date, locked_prices/changes)
         data/predictions.json (the prediction bot's live record)
Writes : data/social/card-YYYY-MM-DD.jpg   (dated, permanent: the daily page
                                            and the homepage point at it)
         data/social/card-latest.jpg

Runs AFTER GATE 2 in daily.yml, so a card is only ever rendered from a
briefing that passed every gate. If the briefing was blocked, no card.

Design (2026-10-15, Sig): the "picture from the data" share card drawn by
scripts/share_cards.py, 1200 x 630 JPG under 120 KB. The top shows the
briefing's number and the grain quotes the briefing was written on; the green
band carries the headline. It replaced the dark 2400 x 1350 PNG card.

A share card must never be the reason the briefing fails to publish: main()
traps everything and exits 0 with a loud message; daily.yml also runs it with
continue-on-error.

Failure honesty: if the bot's record can't be read, or is below its own
minimum sample, the card prints no record rather than inventing one.

  python3 scripts/build_social_card.py                    # today's card + homepage tags
  python3 scripts/build_social_card.py --date 2026-09-15  # one archive day's card
  python3 scripts/build_social_card.py --backfill         # redraw every dated card that exists
"""
import json
import os
import re
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "data", "social")
SITE = "https://agsist.com"
QUOTES = (("corn-dec", "corn", "Dec corn"), ("beans-nov", "beans", "Nov beans"), ("wheat", None, "Wheat"))


def _quarters(v):
    c = round(v * 400) / 4
    whole = int(c)
    frac = {0.25: " 1/4", 0.5: " 1/2", 0.75: " 3/4"}.get(round(c - whole, 2), "")
    return f"${whole / 100:.2f}{frac}"


def record_line(predictions_path):
    """The prediction bot's LIVE record, only once it clears its own minimum
    sample (gate_ok). The backtest is never printed here."""
    try:
        pr = json.load(open(predictions_path, encoding="utf-8"))
        live = pr["live"]["records"]["all"]
        if live.get("gate_ok") and int(live["graded"]) > 0:
            return "Prediction bot, live: %d of %d calls right" % (int(live["hits"]), int(live["graded"]))
    except Exception:
        pass
    return None


def card_bytes(daily, record=None):
    import share_cards as SC
    headline = (daily.get("headline") or "").strip() or "AGSIST Daily briefing"
    one = daily.get("one_number") or {}
    num_val = str(one.get("value", "")).strip()
    num_unit = str(one.get("unit", "")).strip()
    date_str = (daily.get("date") or "").strip()
    rows = []
    lp, lc = daily.get("locked_prices") or {}, daily.get("locked_changes") or {}
    for key, alt, name in QUOTES:
        k = key if key in lp else alt
        if not k or lp.get(k) is None:
            continue
        pct = (lc.get(k) or {}).get("pct")
        chg = None if pct is None else ("%+.1f%%" % pct)
        up = None if pct is None or abs(pct) < 0.05 else pct > 0
        rows.append((name, _quarters(float(lp[k])), chg, up))
    if num_val:
        pic = ("number", {"big": num_val, "unit": num_unit, "table": rows, "table_title": "Futures in the briefing"})
        caption = "AGSIST Daily  ·  " + date_str + "  ·  the number"
    else:
        pic = ("number", {"big": rows[0][1] if rows else "AGSIST", "unit": "Dec corn" if rows else "",
                          "table": rows[1:], "table_title": "Futures in the briefing"})
        caption = "AGSIST Daily  ·  " + date_str
    meta = record or "Grain markets before the open, free every morning"
    meta += "  ·  agsist.com/daily"
    head = [(headline.rstrip("."), False)]
    alt = f"AGSIST Daily, {date_str}: {headline}."
    if num_val:
        alt += f" The number: {num_val} {num_unit}."
    return SC.card_c(head, meta, caption, pic), alt.replace('"', "'")


def build(daily_path="data/daily.json", predictions_path="data/predictions.json", stamp=None):
    daily = json.load(open(os.path.join(ROOT, daily_path), encoding="utf-8"))
    data, alt = card_bytes(daily, record_line(os.path.join(ROOT, predictions_path)))
    os.makedirs(OUT_DIR, exist_ok=True)
    stamp = stamp or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    dated = os.path.join(OUT_DIR, "card-%s.jpg" % stamp)
    for p in (dated, os.path.join(OUT_DIR, "card-latest.jpg")):
        with open(p, "wb") as f:
            f.write(data)
    print("[social-card] wrote %s and card-latest.jpg (%d KB)" % (os.path.relpath(dated, ROOT), len(data) // 1024))
    return dated, alt


def update_page_og(page_path, dated_url, alt):
    """Point a page's share image at the dated card.

    Dated URL on purpose: Messages, Facebook and X cache share images BY URL,
    so a stable card-latest would show yesterday's card for days. Uses the
    same tag writer as every other page (build_share_images.patch_meta)."""
    import build_share_images as B
    src = open(page_path, encoding="utf-8").read()
    out = B.patch_meta(src, dated_url, alt)
    if out != src:
        open(page_path, "w", encoding="utf-8").write(out)
    print("[social-card] %s og:image -> %s" % (os.path.relpath(page_path, ROOT), dated_url))


def backfill():
    """Redraw every dated card that already exists, from its archived
    briefing. A day with no archive file keeps no card."""
    n = 0
    for f in sorted(os.listdir(OUT_DIR)):
        m = re.match(r"card-(\d{4}-\d\d-\d\d)\.(png|jpg)$", f)
        if not m:
            continue
        day = m.group(1)
        arch = os.path.join(ROOT, "data", "daily-archive", day + ".json")
        if not os.path.exists(arch):
            print("[social-card] %s: no archived briefing, card left as is" % day, file=sys.stderr)
            continue
        daily = json.load(open(arch, encoding="utf-8"))
        data, _ = card_bytes(daily)  # no live record on an old card: it would be today's
        with open(os.path.join(OUT_DIR, "card-%s.jpg" % day), "wb") as fh:
            fh.write(data)
        if m.group(2) == "png":
            os.remove(os.path.join(OUT_DIR, f))
        n += 1
    for old in ("card-latest.png",):
        p = os.path.join(OUT_DIR, old)
        if os.path.exists(p):
            os.remove(p)
    print("[social-card] backfilled %d cards" % n)


def main(argv):
    if "--backfill" in argv:
        backfill()
        return 0
    try:
        if "--date" in argv:
            day = argv[argv.index("--date") + 1]
            build("data/daily-archive/%s.json" % day, stamp=day)
            return 0
        dated, alt = build()
        url = SITE + "/" + os.path.relpath(dated, ROOT).replace(os.sep, "/")
        update_page_og(os.path.join(ROOT, "index.html"), url, alt)
        return 0
    except Exception as e:  # never block the briefing over a share image
        print("[social-card] SKIPPED: %s: %s" % (type(e).__name__, e), file=sys.stderr)
        return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
