#!/usr/bin/env python3
"""Email signups by where they came from: data/signups.json, counts only.

Run by .github/workflows/sponsor-report.yml right after build_audience.py,
with the same LIST_URL + LIST_TOKEN. It reads the subs worker's token-gated
/list?format=json (one row per address: src, zip, ts) and /notice-list (one
row per address and one-time notice topic: rent:<st>, arcplc:<date>, rain-gauge) and
writes how many came from each page ask, how many gave a ZIP, the last 30
days by day, and the notice sign-ups by topic. /seo-report shows it.

The repository and its Actions logs are public, so NO ADDRESS is ever
written or printed: the file and the log carry counts only.

  python3 scripts/build_signups.py             fetch and write
  python3 scripts/build_signups.py --selftest  fixtures, no network
"""
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
OUT = ROOT / "data" / "signups.json"
CT = ZoneInfo("America/Chicago")
UA = {"User-Agent": "AGSIST-automation/1.0 (+https://agsist.com; sig@farmers1st.com)"}
SRC_RE = re.compile(r"[^a-z0-9:_./-]")
DAYS = 30


def day_of(ms):
    """The Central-time date of a millisecond timestamp, or None."""
    try:
        return datetime.fromtimestamp(float(ms) / 1000, timezone.utc).astimezone(CT).date()
    except (TypeError, ValueError, OverflowError, OSError):
        return None


def clean_src(s):
    s = SRC_RE.sub("", str(s or "").strip().lower())[:60]
    return s or "(none)"


def build(records, notices, today):
    """records: [{zip, src, ts, reports}] (subscribers.fetch). notices: the
    /notice-list rows [{topic, ts, sent}] or None when that route failed."""
    d7, d30 = today - timedelta(days=6), today - timedelta(days=DAYS - 1)
    by, daily = {}, {}
    with_zip = reports = 0
    for r in records:
        src = clean_src(r.get("src"))
        b = by.setdefault(src, {"src": src, "total": 0, "last7": 0, "last30": 0})
        b["total"] += 1
        if r.get("zip"):
            with_zip += 1
        if r.get("reports", True):
            reports += 1
        d = day_of(r.get("ts"))
        if d and d30 <= d <= today:
            b["last30"] += 1
            daily[d] = daily.get(d, 0) + 1
            if d >= d7:
                b["last7"] += 1
    out = {
        "schema": 1,
        "asOf": today.isoformat(),
        "built": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "note": "Counts only. Each address counts once, under the page it first signed up from.",
        "subscribers": len(records),
        "withZip": with_zip,
        "reportDays": reports,
        "bySource": sorted(by.values(), key=lambda x: (-x["last30"], -x["total"], x["src"])),
        "daily": [{"d": (d30 + timedelta(days=i)).isoformat(), "n": daily.get(d30 + timedelta(days=i), 0)}
                  for i in range(DAYS)],
    }
    if notices is not None:
        nt = {}
        for n in notices:
            topic = str(n.get("topic") or "")
            kind = topic.split(":", 1)[0] or "(none)"
            t = nt.setdefault(kind, {"topic": kind, "total": 0, "last7": 0, "sent": 0, "detail": {}})
            t["total"] += 1
            if n.get("sent"):
                t["sent"] += 1
            d = day_of(n.get("ts"))
            if d and d7 <= d <= today:
                t["last7"] += 1
            sub = topic.split(":", 1)[1] if ":" in topic else ""
            if sub:
                t["detail"][sub[:20]] = t["detail"].get(sub[:20], 0) + 1
        out["notices"] = sorted(nt.values(), key=lambda x: -x["total"])
    return out


def get_notices(base, token):
    u = base.rstrip("/") + "/notice-list?token=" + urllib.parse.quote(token)
    with urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=60) as r:
        arr = json.loads(r.read().decode())
    if not isinstance(arr, list):
        raise ValueError("notice-list did not answer with a list")
    return arr


def main():
    lu, lt = os.environ.get("LIST_URL", "").strip(), os.environ.get("LIST_TOKEN", "").strip()
    if not (lu and lt):
        print("LIST_URL / LIST_TOKEN not set: data/signups.json left as it was")
        return 0
    import subscribers
    try:
        records, how = subscribers.fetch(lu, lt)
    except Exception as e:  # noqa: BLE001  never print the URL, it carries the token
        print("::warning::signup list failed: %s %s" % (type(e).__name__, getattr(e, "code", "")))
        return 0
    try:
        notices = get_notices(lu, lt)
    except Exception as e:  # noqa: BLE001
        print("::warning::notice list failed: %s %s" % (type(e).__name__, getattr(e, "code", "")))
        notices = None
    out = build(records, notices, datetime.now(CT).date())
    OUT.write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8")
    print("signups: %d subscribers (%s list), %d sources, %d with ZIP, last 7 days %d"
          % (out["subscribers"], how, len(out["bySource"]), out["withZip"],
             sum(b["last7"] for b in out["bySource"])))
    # counts only, as annotations so they can be read without the log (page names and numbers, never an address)
    print("::notice title=signups by page::" + "; ".join("%s %d (7d %d)" % (b["src"], b["total"], b["last7"]) for b in out["bySource"][:25]))
    for t in out.get("notices") or []:
        print("::notice title=notice list %s::%d total, %d last 7 days, %d sent%s" % (
            t["topic"], t["total"], t["last7"], t["sent"],
            (", " + ", ".join("%s %d" % kv for kv in sorted(t["detail"].items(), key=lambda kv: -kv[1])[:10])) if t["detail"] else ""))
    return 0


def selftest():
    ok = True

    def t(c, m):
        nonlocal ok
        print(("ok   " if c else "FAIL ") + m)
        ok = ok and c

    today = date(2026, 10, 12)
    ms = lambda y, mo, d, h=15: datetime(y, mo, d, h, tzinfo=timezone.utc).timestamp() * 1000
    recs = [
        {"email": "a@x.com", "zip": "54728", "src": "page:cash-bids", "ts": ms(2026, 10, 12), "reports": True},
        {"email": "b@x.com", "zip": None, "src": "page:cash-bids", "ts": ms(2026, 10, 1), "reports": False},
        {"email": "c@x.com", "zip": None, "src": "Home-Hero", "ts": ms(2026, 8, 1), "reports": True},
        {"email": "d@x.com", "zip": "50010", "src": "", "ts": None, "reports": True},
        # 03:00 UTC Oct 13 is still Oct 12 in Chicago
        {"email": "e@x.com", "zip": None, "src": "page:rent", "ts": datetime(2026, 10, 13, 3, tzinfo=timezone.utc).timestamp() * 1000, "reports": True},
    ]
    notes = [{"email": "a@x.com", "topic": "rent:wi", "ts": ms(2026, 10, 11), "sent": None},
             {"email": "b@x.com", "topic": "rent:ia", "ts": ms(2026, 9, 1), "sent": 1},
             {"email": "c@x.com", "topic": "arcplc:2026-12-11", "ts": ms(2026, 10, 12), "sent": None},
             {"email": "d@x.com", "topic": "rain-gauge", "ts": ms(2026, 10, 13), "sent": None, "zip": "54728", "note": "n"}]
    o = build(recs, notes, today)
    s = {b["src"]: b for b in o["bySource"]}
    t(o["subscribers"] == 5 and o["withZip"] == 2 and o["reportDays"] == 4, "totals, ZIPs and report-day opt-ins")
    t(s["page:cash-bids"] == {"src": "page:cash-bids", "total": 2, "last7": 1, "last30": 2}, "per-page windows")
    t(s["home-hero"]["last30"] == 0 and s["home-hero"]["total"] == 1, "older signups count in total only")
    t(s["(none)"]["total"] == 1, "a missing source is counted, not dropped")
    t(s["page:rent"]["last7"] == 1, "days are Central time")
    t(len(o["daily"]) == 30 and o["daily"][-1] == {"d": "2026-10-12", "n": 2}, "30 days by day, today last")
    n = {x["topic"]: x for x in o["notices"]}
    t(n["rent"]["total"] == 2 and n["rent"]["sent"] == 1 and n["rent"]["detail"] == {"wi": 1, "ia": 1}, "rent notices by state")
    t(n["arcplc"]["last7"] == 1, "ARC/PLC notices")
    t(n["rain-gauge"]["total"] == 1 and n["rain-gauge"]["detail"] == {}, "rain gauge waiting list: a count only")
    t("54728" not in json.dumps(o) and "d@x.com" not in json.dumps(o), "no ZIP, note or address from the notice list in the output")
    t("notices" not in build(recs, None, today), "a failed notice list leaves the section out")
    t("@" not in json.dumps(o), "no address in the output")
    print("selftest " + ("passed" if ok else "FAILED"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(selftest() if "--selftest" in sys.argv else main())
