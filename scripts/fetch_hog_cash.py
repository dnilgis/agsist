#!/usr/bin/env python3
"""
AGSIST -- cash hogs and the pork cutout from USDA Livestock Mandatory Reporting.

Reports wanted (USDA AMS, LMR):
  * LM_HG201  National Daily Direct Hog Prior Day Report - Slaughtered Swine
  * LM_HG203  National Daily Direct Hog Afternoon Report
  * LM_PK602  National Daily Pork Report FOB Plant - Negotiated Sales (cutout)

The LM reports are outside the MARS catalog map of Nov 2, 2026, so the probe asks
every route we know, from an Actions runner (the sandbox reaches none of them):
  1. the LMR DataMart API (mpr.datamart.ams.usda.gov/services/v1.1/reports),
     its report list first, so the slug ids come from USDA, not from us;
  2. the MARS API (marsapi.ams.usda.gov/services/v1.2/reports/<id>), with the
     MARS_API_KEY secret as HTTP basic user (never printed, never in a URL);
  3. the public report files on www.ams.usda.gov/mnreports (TXT by slug name,
     PDF by id), through scripts/ams_http.py and its mirror.

Modes:
  --probe     ask every route, save each answer and a summary (probe.json) to
              data/hog-cash-raw/ (saved on the raw branch by the workflow,
              never on main), print what each route gave. Writes no feed.
  --selftest  offline tests, non-zero exit on any failure.

WHAT THIS FILE WILL NOT DO
  * Print or save the MARS key, or put it in a URL.
  * Write a public data file from the probe.

Stdlib only, plus pdftotext or pypdf through fetch_dairy.pdf_to_text.
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import base64
import datetime
import json
import os
import re
import sys
import urllib.parse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fetch_dairy as FD  # noqa: E402
import ams_http as AMS  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = "data/hog-cash-raw"
DATAMART = "https://mpr.datamart.ams.usda.gov/services/v1.1/reports"
MARS = "https://marsapi.ams.usda.gov/services/v1.2/reports"
MNREPORTS = "https://www.ams.usda.gov/mnreports/"
WANT = ("LM_HG201", "LM_HG203", "LM_PK602")
# Used only when the DataMart list does not answer. Unconfirmed guesses: the probe
# records each file's own title so a wrong guess shows as a wrong title.
GUESS_IDS = {"LM_HG201": "2511", "LM_HG203": "2510", "LM_PK602": "2498"}
# One week a few years apart, to see how far back each route goes.
HISTORY_WEEKS = ("2002-10-07", "2008-10-06", "2014-10-06", "2020-10-05", "2025-10-06")
RECENT_DAYS = 45   # the recent window: release times (published_date) and day count


def mdy(d):
    return "%02d/%02d/%04d" % (d.month, d.day, d.year)


def mars_headers():
    key = os.environ.get("MARS_API_KEY", "").strip()
    if not key:
        return None
    return {"Authorization": "Basic " + base64.b64encode((key + ":").encode()).decode(),
            "Accept": "application/json"}


def range_q(a, b):
    return "q=report_date=%s:%s" % (mdy(a), mdy(b))


def rows_of(body):
    """The result rows of a DataMart/MARS JSON answer, or []."""
    if isinstance(body, list):
        return [r for r in body if isinstance(r, dict)]
    if isinstance(body, dict):
        for k in ("results", "data", "rows"):
            if isinstance(body.get(k), list):
                return [r for r in body[k] if isinstance(r, dict)]
    return []


def describe(raw):
    """A short summary of one JSON answer: row count, fields, dates, sections."""
    try:
        body = json.loads(raw.decode("utf-8", "replace"))
    except ValueError:
        t = raw[:300].decode("utf-8", "replace")
        return {"json": False, "head": re.sub(r"\s+", " ", t)[:200]}
    rows = rows_of(body)
    out = {"json": True, "rows": len(rows)}
    if isinstance(body, dict):
        out["top_keys"] = sorted(body)[:20]
        for k in ("reportSection", "reportSections", "stats"):
            if k in body:
                out[k] = body[k]
    if rows:
        out["fields"] = sorted(rows[0])[:60]
        out["first"] = {k: rows[0][k] for k in sorted(rows[0])[:60]}
        for k in ("report_date", "report_end_date", "published_date"):
            vals = sorted({str(r.get(k)) for r in rows if r.get(k)})
            if vals:
                out[k] = {"n": len(vals), "min": vals[0], "max": vals[-1]}
        pub = [str(r.get("published_date")) for r in rows if r.get("published_date")]
        times = {}
        for p in pub:
            m = re.search(r"(\d{1,2}):(\d{2})", p)
            if m:
                k = "%02d:%sx" % (int(m.group(1)), m.group(2)[0])
                times[k] = times.get(k, 0) + 1
        if times:
            out["publish_times"] = dict(sorted(times.items()))
    return out


def find_ids(list_raw):
    """{slug_name: {"id", "title"}} for the wanted reports in the DataMart list."""
    try:
        body = json.loads(list_raw.decode("utf-8", "replace"))
    except (ValueError, AttributeError):
        return {}
    rows = body if isinstance(body, list) else rows_of(body)
    out = {}
    for r in rows:
        name = str(r.get("slug_name") or r.get("slugName") or "").upper()
        if name in WANT:
            out[name] = {"id": str(r.get("slug_id") or r.get("slugId") or ""),
                         "title": r.get("report_title") or r.get("reportTitle") or ""}
    return out


def safe_name(s):
    return re.sub(r"[^A-Za-z0-9._-]+", "_", s).strip("_")[:90]


def probe(root=ROOT, get=None, ams_get=None, to_text=None, today=None, log=print):
    """Ask every route; save answers and probe.json under root/RAW_DIR. Returns the summary."""
    get = get or (lambda u, h=None: FD.http_get(u, headers=h, tries=2, timeout=45))
    ams_get = ams_get or (lambda u: AMS.get(u, tries=2, timeout=45))
    to_text = to_text or FD.pdf_to_text
    today = today or datetime.date.today()
    rd = Path(root) / RAW_DIR
    rd.mkdir(parents=True, exist_ok=True)
    summary = {"probed": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
               "calls": []}

    def ask(route, label, url, headers=None, fetch=None):
        raw, err = (fetch or get)(url) if fetch else get(url, headers)
        rec = {"route": route, "label": label, "url": url, "ok": raw is not None}
        if raw is None:
            rec["error"] = str(err)[:300]
        else:
            rec["bytes"] = len(raw)
            ext = ".pdf" if raw[:5] == b"%PDF-" else (".json" if raw[:1] in (b"{", b"[") else ".txt")
            fn = safe_name("%s-%s" % (route, label)) + ext
            (rd / fn).write_bytes(raw)
            rec["file"] = fn
            if ext == ".json":
                rec["summary"] = describe(raw)
            elif ext == ".pdf":
                text, e = to_text(raw)
                if text:
                    (rd / (fn[:-4] + ".pdf.txt")).write_text(text)
                rec["head"] = [ln.strip() for ln in (text or "").splitlines() if ln.strip()][:15] or [str(e)]
            else:
                t = raw.decode("utf-8", "replace")
                rec["head"] = [ln.strip() for ln in t.splitlines() if ln.strip()][:15]
        summary["calls"].append(rec)
        log("%-9s %-28s %s" % (route, label, ("%d bytes" % rec["bytes"]) if rec["ok"] else "FAILED " + rec["error"][:120]))
        return raw

    # 1. DataMart: the list, then each wanted report, its sections, history windows
    lst = ask("datamart", "list", DATAMART)
    ids = find_ids(lst) if lst else {}
    summary["ids_from_list"] = ids
    use = {n: (ids.get(n) or {}).get("id") or GUESS_IDS[n] for n in WANT}
    summary["ids_used"] = use
    recent = (today - datetime.timedelta(days=RECENT_DAYS), today)
    for name, sid in use.items():
        base = "%s/%s" % (DATAMART, sid)
        raw = ask("datamart", name + "-latest", base)
        secs = []
        if raw:
            d = describe(raw)
            secs = d.get("reportSections") or []
        for s in [x for x in secs if isinstance(x, str)][:8]:
            ask("datamart", "%s-sec-%s" % (name, s), "%s/%s" % (base, urllib.parse.quote(s, safe="")))
        ask("datamart", name + "-recent", "%s?%s" % (base, range_q(*recent)))
        for w in HISTORY_WEEKS:
            a = datetime.date.fromisoformat(w)
            ask("datamart", "%s-hist-%s" % (name, w[:4]), "%s?%s" % (base, range_q(a, a + datetime.timedelta(days=6))))

    # 2. MARS with the key (header only)
    h = mars_headers()
    if h is None:
        summary["mars"] = "no MARS_API_KEY: not asked"
        log("mars      skipped: no MARS_API_KEY")
    else:
        for name, sid in use.items():
            base = "%s/%s" % (MARS, sid)
            ask("mars", name + "-recent", "%s?%s" % (base, range_q(*recent)), h)
            a = datetime.date.fromisoformat(HISTORY_WEEKS[3])
            ask("mars", name + "-hist-2020", "%s?%s" % (base, range_q(a, a + datetime.timedelta(days=6))), h)

    # 3. The public files on www.ams.usda.gov/mnreports (mirror through ams_http)
    for name, sid in use.items():
        ask("mnreports", name + "-txt", MNREPORTS + name.lower() + ".txt", fetch=ams_get)
        ask("mnreports", name + "-pdf", MNREPORTS + "ams_%s.pdf" % sid, fetch=ams_get)

    ok = sum(1 for c in summary["calls"] if c["ok"])
    summary["answered"] = "%d of %d" % (ok, len(summary["calls"]))
    (rd / "probe.json").write_text(json.dumps(summary, indent=1, sort_keys=True) + "\n")
    log("answered %s; summary in %s/probe.json" % (summary["answered"], RAW_DIR))
    for c in summary["calls"]:
        if c.get("summary", {}).get("rows"):
            s = c["summary"]
            log("  %s %s: %d rows, report_date %s, published %s, times %s" % (
                c["route"], c["label"], s["rows"], s.get("report_date"), s.get("published_date"),
                s.get("publish_times")))
    return summary


# ---------------------------------------------------------------- selftest
def selftest():
    import tempfile
    fails = []

    def ck(name, ok, detail=""):
        print(("  ok   " if ok else "  FAIL ") + name + (f"  ({detail})" if not ok and detail else ""))
        if not ok:
            fails.append(name)

    lst = json.dumps([{"slug_id": "9001", "slug_name": "LM_HG201", "report_title": "A"},
                      {"slug_id": "9002", "slug_name": "LM_PK602", "report_title": "B"},
                      {"slug_id": "9003", "slug_name": "LM_CT150", "report_title": "C"}]).encode()
    ck("the list gives the wanted ids and skips others",
       find_ids(lst) == {"LM_HG201": {"id": "9001", "title": "A"}, "LM_PK602": {"id": "9002", "title": "B"}})
    ck("a broken list gives no ids", find_ids(b"<html>") == {})
    body = json.dumps({"reportSections": ["Barrows/Gilts", "Summary"], "results": [
        {"report_date": "10/30/2026", "published_date": "10/30/2026 13:05:11", "head_count": "5,000"},
        {"report_date": "10/29/2026", "published_date": "10/29/2026 13:21:40", "head_count": "4,000"}]}).encode()
    d = describe(body)
    ck("describe: rows, sections, date span, release times",
       d["rows"] == 2 and d["reportSections"] == ["Barrows/Gilts", "Summary"]
       and d["report_date"] == {"n": 2, "min": "10/29/2026", "max": "10/30/2026"}
       and d["publish_times"] == {"13:0x": 1, "13:2x": 1}, d)
    ck("describe: a web page is not JSON", describe(b"<html>blocked</html>")["json"] is False)

    os.environ["MARS_API_KEY"] = "sekret-key"
    calls = []

    def fake_get(u, h=None):
        calls.append((u, h))
        if u == DATAMART:
            return lst, None
        if u.endswith("/9001"):
            return body, None
        return None, "HTTPError: HTTP Error 404: Not Found"

    with tempfile.TemporaryDirectory() as t:
        s = probe(root=t, get=fake_get, ams_get=lambda u: (None, "no DNS"), to_text=lambda r: (None, "x"),
                  today=datetime.date(2026, 11, 3), log=lambda *a: None)
        saved = "".join(p.read_text(errors="replace") for p in (Path(t) / RAW_DIR).iterdir())
        ck("probe uses the list's ids and the guess only for the missing one",
           s["ids_used"] == {"LM_HG201": "9001", "LM_HG203": GUESS_IDS["LM_HG203"], "LM_PK602": "9002"}, s["ids_used"])
        ck("probe asks each section of a report that lists them",
           any(u.endswith("/9001/Barrows%2FGilts") for u, _ in calls))
        ck("probe asks MARS only with the key in a header",
           any(u.startswith(MARS) and h and h["Authorization"].startswith("Basic ") for u, h in calls))
        ck("the key is in no URL and no saved file",
           not any("sekret" in u for u, _ in calls) and "sekret" not in saved
           and base64.b64encode(b"sekret-key:").decode() not in saved)
        ck("probe.json counts every call", s["answered"].endswith("of %d" % len(s["calls"])))
    os.environ.pop("MARS_API_KEY", None)
    with tempfile.TemporaryDirectory() as t:
        s = probe(root=t, get=lambda u, h=None: (None, "down"), ams_get=lambda u: (None, "down"),
                  to_text=lambda r: (None, "x"), today=datetime.date(2026, 11, 3), log=lambda *a: None)
        ck("no key: MARS not asked; no list: the guessed ids", s["mars"].startswith("no MARS_API_KEY")
           and s["ids_used"] == GUESS_IDS and not any(c["url"].startswith(MARS) for c in s["calls"]))

    print()
    if fails:
        print("%d FAILED" % len(fails))
        return 1
    print("all hog cash checks pass")
    return 0


def main(argv):
    if "--selftest" in argv:
        return selftest()
    if "--probe" in argv:
        s = probe(ROOT)
        return 0 if any(c["ok"] for c in s["calls"]) else 1
    print("fetch_hog_cash.py: only --probe and --selftest for now")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
