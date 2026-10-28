#!/usr/bin/env python3
"""
AGSIST -- data/dairy-herds.json: licensed dairy herds, the US and each state by
year (USDA NASS, Quick Stats series "CATTLE, COWS, MILK, LICENSED HERD -
OPERATIONS WITH INVENTORY, AVG", the yearly table in NASS's February Milk
Production report), and Wisconsin by month (NASS Wisconsin field office, "Number
of monthly milk cow herds, Wisconsin", from the state's Dairy Producer License
list as of the start of each month).

/milk-prices loads the file only when the reader opens the chart (page budget).

A licence count is not a count of farms that quit: a herd that sells, merges or
changes hands can drop off and come back. The page says so; this file only
holds NASS's own numbers, as NASS has them now (Quick Stats carries revisions,
so a year can differ from the first printed report).

Keep-last-good: a failed read keeps the file and records why in status.
--selftest offline tests on the real reads (test/fixtures/milk/).
"""
import datetime
import json
import os
import re
import sys
import urllib.parse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

ROOT = Path(__file__).resolve().parent.parent
OUT = "data/dairy-herds.json"
SHORT = "CATTLE, COWS, MILK, LICENSED HERD - OPERATIONS WITH INVENTORY, AVG"
QS_API = "https://quickstats.nass.usda.gov/api/api_GET/"
QS_PAGE = "https://quickstats.nass.usda.gov/"
WI_SERIES = "https://www.nass.usda.gov/Statistics_by_State/Wisconsin/Publications/Dairy/Historical_Data_Series/herd_brt_2004.pdf"
WI_MONTH = "https://www.nass.usda.gov/Statistics_by_State/Wisconsin/Publications/Dairy/{y}/WI-DairyHerd-{m:02d}-{yy:02d}.pdf"
WI_INDEX = "https://www.nass.usda.gov/Statistics_by_State/Wisconsin/Publications/Dairy/"
MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
               "November", "December"]
FIRST_YEAR = 2002          # what the page asks for; NASS's series starts later and the gap is counted in withheld


def _int(t):
    t = (t or "").replace(",", "").strip()
    return int(t) if re.fullmatch(r"\d+", t) else None


def parse_qs(js, agg):
    """{year: n} (NATIONAL) or {ST: {year: n}} (STATE) from a Quick Stats answer,
    annual YEAR rows of the one series only; '(D)' and other non-numbers left
    out. Also the newest load_time seen, as 'YYYY-MM-DD'."""
    rows = (js or {}).get("data") if isinstance(js, dict) else None
    out, loaded = {}, ""
    for r in rows or []:
        if r.get("short_desc") != SHORT or r.get("freq_desc") != "ANNUAL" or r.get("reference_period_desc") != "YEAR":
            continue
        if r.get("agg_level_desc") != agg:
            continue
        v, y = _int(r.get("Value")), str(r.get("year") or "")
        if v is None or not re.fullmatch(r"\d{4}", y):
            continue
        lt = str(r.get("load_time") or "")[:10]
        if agg == "NATIONAL":
            out[y] = v
            loaded = max(loaded, lt)
        else:
            st = r.get("state_alpha") or ""
            if re.fullmatch(r"[A-Z]{2}", st) and st != "OT":    # 'Other States' is not a state
                out.setdefault(st, {})[y] = v
    if agg == "NATIONAL":
        return dict(sorted(out.items())), loaded
    return {k: dict(sorted(v.items())) for k, v in sorted(out.items())}, ""


ROW = re.compile(r"^\s*(20\d\d)\s+((?:(?:[\d,]+|n\.a\.)\s+){0,11}(?:[\d,]+|n\.a\.))\s*$", re.M)


def parse_wi_series(text):
    """{'YYYY-MM': herds} from NASS Wisconsin's monthly herd table ('2026  5,115
    5,116 ...', 'n.a.' kept as a gap). Months fill from January; a short row is
    the current year so far. Empty unless the table's own heading is there."""
    t = text or ""
    if not re.search(r"NUMBER OF MONTHLY MILK COW HERDS, WISCONSIN", t):
        return {}
    out = {}
    for m in ROW.finditer(t):
        y = m.group(1)
        for i, c in enumerate(m.group(2).split()):
            v = _int(c)
            if v is not None:
                out["%s-%02d" % (y, i + 1)] = v
    return dict(sorted(out.items()))


def parse_wi_month(text):
    """('YYYY-MM', state total) from a monthly 'Wisconsin milk cow herds by type'
    release: its date line ('October 1, 2026') and its 'State Total' row's last
    number. (None, None) unless both are there."""
    t = text or ""
    d = re.search(r"\b(" + "|".join(MONTH_NAMES) + r") 1, (20\d\d)\b", t)
    s = re.search(r"^\s*State Total\b.*?([\d,]+)\s*$", t, re.M)
    if not (d and s and re.search(r"WISCONSIN MILK COW HERDS", t)):
        return None, None
    return "%s-%02d" % (d.group(2), MONTH_NAMES.index(d.group(1)) + 1), _int(s.group(1))


def _mk_shift(mk, n):
    i = int(mk[:4]) * 12 + int(mk[5:7]) - 1 + n
    return "%d-%02d" % (i // 12, i % 12 + 1)


def build(us, us_loaded, states, wi_series, wi_last, now, old=None):
    """The file record from what was read. Checks: the US series has no gap
    from its first year to its last, and every state year is at most the US
    year. A failed check withholds that part with the reason."""
    rec = {}
    why = []
    ys = sorted(us)
    if ys:
        gaps = [str(y) for y in range(int(ys[0]), int(ys[-1]) + 1) if str(y) not in us]
        if gaps:
            why.append("US years missing in NASS's answer: " + ", ".join(gaps))
            us = {}
    if us:
        bad = sorted({st for st, r in states.items() for y, v in r.items() if y in us and v > us[y]})
        for st in bad:
            states.pop(st)
            why.append("%s: a year above the US total, left out" % st)
        early = [str(y) for y in range(FIRST_YEAR, int(min(us)))]
        rec["us"] = us
        rec["states"] = states
        rec["us_note"] = ("NASS's yearly series starts in %s; %s %s not in it" % (min(us), ", ".join(early),
                          "is" if len(early) == 1 else "are")) if early else ""
        rec["loaded"] = us_loaded
    wi = dict(wi_series or {})
    if wi_last and wi_last[0] and wi_last[1]:
        k, v = wi_last
        if k in wi and wi[k] != v:
            why.append("Wisconsin %s: the monthly release says %d, the series %d; the series kept" % (k, v, wi[k]))
        else:
            wi[k] = v
    if wi:
        ks = sorted(wi)
        gaps, k = [], ks[0]
        while k <= ks[-1]:
            if k not in wi:
                gaps.append(k)
            k = _mk_shift(k, 1)
        rec["wi_monthly"] = {"months": dict(sorted(wi.items())), "gaps": gaps}
    rec["withheld"] = why
    return rec


def http_get(u, timeout=120, tries=3):
    from fetch_dairy import http_get as hg
    return hg(u, tries=tries, timeout=timeout)


def run(root=ROOT, now=None, get=None, pdf_text=None, key=None):
    now = now or datetime.datetime.now(datetime.timezone.utc)
    get = get or http_get
    key = os.environ.get("NASS_API_KEY", "") if key is None else key
    p = Path(root) / OUT
    try:
        old = json.loads(p.read_text())
    except (OSError, ValueError):
        old = {}
    at = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    if pdf_text is None:
        from fetch_dairy import pdf_to_text
        pdf_text = lambda b: pdf_to_text(b)[0]   # noqa: E731

    def qs(agg):
        if not key:
            return None, "no NASS_API_KEY"
        u = QS_API + "?" + urllib.parse.urlencode({"key": key, "short_desc": SHORT, "agg_level_desc": agg,
                                                    "year__GE": str(FIRST_YEAR), "format": "JSON"})
        b, e = get(u)
        if b is None:
            return None, "NASS %s: %s" % (agg.lower(), (e or "no answer").replace(key, "***"))
        try:
            return json.loads(b.decode("utf-8", "replace")), None
        except ValueError:
            return None, "NASS %s: not JSON" % agg.lower()
    errs = []
    nj, e1 = qs("NATIONAL")
    sj, e2 = qs("STATE")
    errs += [e for e in (e1, e2) if e]
    us, loaded = parse_qs(nj, "NATIONAL") if nj else ({}, "")
    states, _ = parse_qs(sj, "STATE") if sj else ({}, "")
    b, e3 = get(WI_SERIES)
    wis = parse_wi_series(pdf_text(b) if b and b[:5] == b"%PDF-" else "")
    if not wis:
        errs.append("Wisconsin series: %s" % (e3 or "no table"))
    last = (None, None)
    for back in range(0, 3):          # this month's release, else the one or two before
        mk = _mk_shift(now.strftime("%Y-%m"), -back)
        y, m = int(mk[:4]), int(mk[5:])
        mb, _e = get(WI_MONTH.format(y=y, m=m, yy=y % 100))
        if mb and mb[:5] == b"%PDF-":
            last = parse_wi_month(pdf_text(mb))
            if last[0]:
                last = last + (WI_MONTH.format(y=y, m=m, yy=y % 100),)
                break
    rec = build(us, loaded, states, wis, last[:2], now, old)
    new = dict(old)
    if rec.get("us"):
        for k in ("us", "states", "us_note", "loaded"):
            new[k] = rec[k]
        new["read"] = now.strftime("%Y-%m-%d")
    if rec.get("wi_monthly"):
        wm = dict(rec["wi_monthly"], read=now.strftime("%Y-%m-%d"), source_url=WI_SERIES, index_url=WI_INDEX)
        if len(last) == 3:
            wm["last_release_url"] = last[2]
        new["wi_monthly"] = wm
    new["withheld"] = rec.get("withheld") or []
    ok = bool(rec.get("us")) and bool(rec.get("wi_monthly"))
    new["status"] = {"ok": ok, "at": at} if ok else {"ok": False, "at": at, "why": "; ".join(errs)[:300] or "nothing read"}
    new.update(source="USDA NASS, licensed dairy herds (Quick Stats; Milk Production)", source_url=QS_PAGE,
               series=SHORT,
               wi_source="USDA NASS Wisconsin field office, monthly milk cow herds, from the Wisconsin Dairy Producer "
                         "License list (DATCP) as of the first of each month",
               _note="Written by scripts/fetch_dairy_herds.py from NASS's own numbers. Never typed by hand. A drop "
                     "is net licences, not the exact number of farms that quit.")
    if not (new.get("us") or new.get("wi_monthly")):
        print("::warning::licensed herds: nothing read (%s)" % "; ".join(errs))
        return new
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(new, separators=(",", ":"), sort_keys=True) + "\n")
    os.replace(tmp, p)
    print("[herds] US %s, %d states, WI %d months%s" % (
        "%s-%s" % (min(new["us"]), max(new["us"])) if new.get("us") else "none", len(new.get("states") or {}),
        len((new.get("wi_monthly") or {}).get("months") or {}), (": " + "; ".join(errs)) if errs else ""))
    return new


def selftest():
    fails = []

    def ck(name, ok, detail=""):
        print(("  ok   " if ok else "  FAIL ") + name + ("  (%s)" % (detail,) if not ok and detail != "" else ""))
        if not ok:
            fails.append(name)
    fx = ROOT / "test" / "fixtures" / "milk"
    nat = json.loads((fx / "nass-licensed-herds-national.json").read_text())
    st = json.loads((fx / "nass-licensed-herds-state.json").read_text())
    us, loaded = parse_qs(nat, "NATIONAL")
    ck("NASS national: 2003 to 2025, 23 years", list(us)[0] == "2003" and list(us)[-1] == "2025" and len(us) == 23, list(us))
    ck("...2003 70,375; 2024 24,645; 2025 23,609 (Milk Production, Feb 20, 2026, page 18)",
       us["2003"] == 70375 and us["2024"] == 24645 and us["2025"] == 23609, (us.get("2003"), us.get("2024"), us.get("2025")))
    ck("...as NASS has it now, revised: 2019 is 34,207 (the Feb 2020 report printed 34,187)", us["2019"] == 34207, us.get("2019"))
    ck("...newest year loaded 2026-02-20", loaded == "2026-02-20", loaded)
    sts, _ = parse_qs(st, "STATE")
    ck("NASS by state: Wisconsin 2025 5,375, 2024 5,520; Pennsylvania 2025 4,360; Minnesota 2025 1,605",
       sts["WI"]["2025"] == 5375 and sts["WI"]["2024"] == 5520 and sts["PA"]["2025"] == 4360 and sts["MN"]["2025"] == 1605,
       (sts.get("WI", {}).get("2025"), sts.get("PA", {}).get("2025")))
    ck("...'Other States' is not a state", "OT" not in sts)
    ck("...state national rows are ignored", parse_qs(st, "NATIONAL")[0] == {})
    wtxt = (fx / "nass-wi-herds-series.txt").read_text()
    wi = parse_wi_series(wtxt)
    ck("Wisconsin monthly: Aug 2003 16,264 first, Sep 2026 4,977 last", min(wi) == "2003-08" and wi["2003-08"] == 16264
       and max(wi) == "2026-09" and wi["2026-09"] == 4977, (min(wi), max(wi)))
    ck("...Jan 2004 15,904; Dec 2025 5,128; Jan 2026 5,115", wi["2004-01"] == 15904 and wi["2025-12"] == 5128
       and wi["2026-01"] == 5115)
    ck("...n.a. months are not filled in", "2003-07" not in wi and "2003-01" not in wi)
    ck("...nothing without the table's heading", parse_wi_series(wtxt.replace("NUMBER OF MONTHLY", "X")) == {})
    mk, n = parse_wi_month((fx / "nass-wi-herds-2026-10.txt").read_text())
    ck("Wisconsin Oct 1, 2026 release: state total 4,944", mk == "2026-10" and n == 4944, (mk, n))
    ck("...a page without the date gives nothing", parse_wi_month("WISCONSIN MILK COW HERDS\nState Total 1 2 3") == (None, None))
    now = datetime.datetime(2026, 10, 28, tzinfo=datetime.timezone.utc)
    rec = build(dict(us), loaded, {k: dict(v) for k, v in sts.items()}, wi, (mk, n), now)
    ck("build: US from 2003, 2002 named as not in NASS's series", rec["us_note"].startswith("NASS's yearly series starts in 2003")
       and "2002 is not in it" in rec["us_note"], rec.get("us_note"))
    ck("...WI monthly runs Aug 2003 to Oct 2026 with no gap", min(rec["wi_monthly"]["months"]) == "2003-08"
       and max(rec["wi_monthly"]["months"]) == "2026-10" and rec["wi_monthly"]["gaps"] == [], rec["wi_monthly"]["gaps"][:3])
    bad = dict(us)
    bad.pop("2010")
    ck("...a US gap withholds the US series with the reason", "us" not in build(bad, loaded, {}, {}, (None, None), now)
       and "2010" in build(bad, loaded, {}, {}, (None, None), now)["withheld"][0])
    s2 = {k: dict(v) for k, v in sts.items()}
    s2["WI"]["2025"] = 99999
    r2 = build(dict(us), loaded, s2, {}, (None, None), now)
    ck("...a state above the US total is left out", "WI" not in r2["states"] and any("WI" in w for w in r2["withheld"]))
    r3 = build(dict(us), loaded, {}, wi, ("2026-09", 4900), now)
    ck("...a monthly release that disagrees with the series keeps the series and says so",
       r3["wi_monthly"]["months"]["2026-09"] == 4977 and "4900" in r3["withheld"][0], r3["withheld"])
    # the whole run against the real reads, into a temp repo
    import tempfile
    docs = {}
    with tempfile.TemporaryDirectory() as d:
        (Path(d) / "data").mkdir()

        def fget(u):
            if u.startswith(QS_API):
                assert "key=k" in u
                return (json.dumps(nat if "NATIONAL" in u else st).encode(), None)
            if u == WI_SERIES:
                return b"%PDF-series", None
            if u == WI_MONTH.format(y=2026, m=10, yy=26):
                return b"%PDF-month", None
            docs[u] = 1
            return None, "HTTP Error 404"
        texts = {b"%PDF-series": wtxt, b"%PDF-month": (fx / "nass-wi-herds-2026-10.txt").read_text()}
        out = run(d, now=now, get=fget, pdf_text=texts.get, key="k")
        ck("run: US, states and WI written, status ok", out["status"]["ok"] and out["us"]["2025"] == 23609
           and out["wi_monthly"]["months"]["2026-10"] == 4944 and out["wi_monthly"]["last_release_url"].endswith("WI-DairyHerd-10-26.pdf"),
           out.get("status"))
        ck("...the key never lands in the file", "key" not in (Path(d) / OUT).read_text().lower().replace("index_url", "").replace("_key", ""))
        out2 = run(d, now=now, get=lambda u: (None, "timeout"), pdf_text=texts.get, key="k")
        ck("...a failed read keeps the last good numbers and says why", out2["us"]["2025"] == 23609
           and out2["status"]["ok"] is False and "timeout" in out2["status"]["why"], out2.get("status"))
        out3 = run(d, now=now, get=lambda u: (None, "boom key=k"), pdf_text=texts.get, key="")
        ck("...no key: says so", "no NASS_API_KEY" in out3["status"]["why"])
    print("fetch_dairy_herds selftest: %s" % ("PASS" if not fails else "FAIL (%d)" % len(fails)))
    return 1 if fails else 0


def main(argv):
    if "--selftest" in argv:
        return selftest()
    run(ROOT)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
