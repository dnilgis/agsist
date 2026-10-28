#!/usr/bin/env python3
"""
AGSIST -- data/dairy-order30.json: Upper Midwest Federal Order 30, from the
Order 30 market administrator's own monthly releases (www.fmma30.com):

  PPD/<YYYY>/PPD<MM><YY>.pdf                "Computation of Producer Price
        Differential" (by the 13th of the next month): the producer price
        differential at the base zone, the statistical uniform price, the
        somatic cell adjustment rate, the release date.
  ClassPrice/<YYYY>/ClassPrice--<MM>-<YY>.pdf   "Announcement of Class Prices"
        (by the 5th): Class I at the base zone (differential, skim, butterfat,
        3.5%), the Class I skim mover and the advanced Class III and IV skim
        prices it is the higher of, Class III and IV at 3.5%.
  ClassPrice/<YYYY>/AdvancePrice--<MM>-<YY>.pdf "Advanced announcement" (by the
        23rd of the month before): the coming month's Class I.

Layouts CONFIRMED from the first probe on Oct 28, 2026 (dairy workflow, probe
run; the September 2026 PPD and class releases and the November 2026 and
January 2025 advance releases are test/fixtures/milk/o30-*.txt, pdftotext
-layout). The probe found the runner had no pdftotext and pypdf scrambles the
column order (test/fixtures/milk/o30-ppd-2026-09-pypdf.txt): the parser reads
only the -layout text and refuses the scrambled one, so the workflow installs
poppler-utils.

Every month is checked before it is written:
  * the release says "FOR <MONTH> <YEAR>" and it is the month asked for;
  * Class I 3.5% = 0.965 x Class I skim + 3.5 x Class I butterfat, to a cent;
  * Class I skim = mover + base zone differential, to a cent;
  * statistical uniform price = Class III price + PPD, to a cent (7 CFR
    1030.61), the Class III price from the same month's class release.
The mover is labeled "the higher of" only when it equals the larger of the two
advanced skim prices (true since June 2025; before that it was the average plus
74 cents, January 2025 fixture).

Keep-last-good: a fetch or check that fails leaves the file alone and only
writes why. A month never replaces a newer one.

  python3 scripts/fetch_order30.py             fetch, check, write
  python3 scripts/fetch_order30.py --probe     raw captures to data/dairy-raw/order30/
  python3 scripts/fetch_order30.py --selftest  offline tests on the real releases
"""
import datetime
import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import dairy_probe  # noqa: E402
from fetch_dairy import http_get, pdf_to_text  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = "data/dairy-order30.json"
RAW = "data/dairy-raw/order30"
SITE = "https://www.fmma30.com/"
PPD_URL = SITE + "PPD/{y}/PPD{m:02d}{yy:02d}.pdf"
CLASS_URL = SITE + "ClassPrice/{y}/ClassPrice--{m:02d}-{yy:02d}.pdf"
ADV_URL = SITE + "ClassPrice/{y}/AdvancePrice--{m:02d}-{yy:02d}.pdf"
PPD_INDEX = SITE + "PPD.html"
MONTHS = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST",
          "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"]
NUM = r"(\(?\$?\s*\(?-?\s*\d{1,3}\.\d{2,5}\)?)"   # $0.58, $(0.42), ($0.47) (Oct 2024), -0.42
CENTRAL_SUM = "https://www.fmmacentral.com/PDFdata/sum{y}.pdf"   # every order's monthly prices, one year a file
STARTS = ([CENTRAL_SUM.format(y=y) for y in (2024, 2025, 2026)]
          + [PPD_URL.format(y=y, m=m, yy=y % 100) for y, m in ((2024, 10), (2025, 3))]
          + [CLASS_URL.format(y=y, m=m, yy=y % 100) for y, m in ((2024, 10), (2025, 3))]
          + [SITE, "https://www.fmmacentral.com/PDFdata/cp2610.pdf"])
FILE = re.compile(r"\.(pdf|xlsx?|csv|txt)(\?|$)", re.I)
WORDS = re.compile(r"price|pool|announce|uniform|ppd|differential|statistic|class|advance|component|somatic|market.?admin|dairy", re.I)


# ---------------------------------------------------------------- parsing
def num(s):
    """'$ 0.58' -> 0.58, '(0.42)' -> -0.42, '-0.42' -> -0.42."""
    t = re.sub(r"[\s$]", "", s or "")
    neg = t.startswith("(") and t.endswith(")") or t.startswith("-")
    t = t.strip("()-")
    try:
        v = float(t)
    except ValueError:
        return None
    return -v if neg else v


def first_page(text):
    """The release's own page: up to '-- OVER --' (the class release prints the
    next month's advance prices on its back)."""
    return re.split(r"--\s*OVER\s*--|\f", text or "", maxsplit=1)[0]


def month_of(text):
    m = re.search(r"\bFOR\s+(%s)\s+(\d{4})\b" % "|".join(MONTHS), text or "")
    return "%s-%02d" % (m.group(2), MONTHS.index(m.group(1)) + 1) if m else None


def released(text):
    m = re.search(r"^\s*((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4})\s{2,}\S.*Market Administrator",
                  text or "", re.M)
    if not m:
        return None
    try:
        return datetime.datetime.strptime(m.group(1).replace("  ", " "), "%B %d, %Y").date().isoformat()
    except ValueError:
        return None


def laid_out(text):
    """True for pdftotext -layout text: the Class I column heads sit on one line,
    spaced apart. pypdf prints them single-spaced or one a line (the first real
    run on Oct 28 read pypdf text on the runner and refused it, as it should)."""
    return bool(re.search(r"Skim Milk\s{2,}Butterfat\s{2,}3\.5% BF", text or ""))


def line_val(text, label, unit=r"\(Per [^)]*\)"):
    """The number at the end of a 'Label ... (Per x) ... $ v' line."""
    m = re.search(r"^[^\n]*%s[^\n]*?%s\s+%s\s*$" % (label, unit, NUM), text or "", re.M)
    return num(m.group(1)) if m else None


def class1_row(text):
    m = re.search(r"^\s*Base Zone\s+%s\s+%s\s+%s\s+%s\s*$" % (NUM, NUM, NUM, NUM), text or "", re.M)
    if not m:
        return None
    d, sk, bf, c1 = (num(g) for g in m.groups())
    return {"class1_diff": d, "class1_skim": sk, "class1_bf": bf, "class1": c1}


def class_block(text, name):
    """{'3.5': v, 'skim': v} for 'Class III Prices' / 'Class IV Prices'."""
    m = re.search(r"^\s*%s Prices\b(.*?)(?=^\s*Class I[VI]* Prices\b|^\s*Somatic Cell|\Z)" % name, text or "", re.M | re.S)
    if not m:
        return {}
    b = m.group(1)
    out = {}
    v = re.search(r"3\.50%% BF\s+\(Per cwt\.\)\s+%s" % NUM, b)
    if v:
        out["price"] = num(v.group(1))
    v = re.search(r"Skim Milk\s+\(Per cwt\.\)\s+%s" % NUM, b)
    if v:
        out["skim"] = num(v.group(1))
    return out


def parse_class(text):
    """The class release for its month, or (None, why)."""
    t = first_page(text)
    if not laid_out(t):
        return None, "not -layout text"
    mk = month_of(t)
    c1 = class1_row(t)
    if not mk or not c1:
        return None, "no month or no Class I row"
    r = dict(c1, month_key=mk)
    c3, c4 = class_block(t, "Class III"), class_block(t, "Class IV")
    r["class3"], r["class4"] = c3.get("price"), c4.get("price")
    r["adv_class3_skim"] = line_val(t, r"Advanced Class III Skim Milk Price")
    r["adv_class4_skim"] = line_val(t, r"Advanced Class IV Skim Milk Price")
    r["mover"] = line_val(t, r"Class I Skim Milk Price Mover")
    r["adv_butterfat"] = line_val(t, r"Advanced Butterfat Price")
    r["scc"] = line_val(t, r"Somatic Cell Adjustment Rate")
    return r, ""


def parse_adv(text):
    t = first_page(text)
    if not laid_out(t):
        return None, "not -layout text"
    mk = month_of(t)
    c1 = class1_row(t)
    if not mk or not c1:
        return None, "no month or no Class I row"
    r = dict(c1, month_key=mk, released=released(text))
    r["adv_class3_skim"] = line_val(t, r"Advanced Class III Skim Milk Price")
    r["adv_class4_skim"] = line_val(t, r"Advanced Class IV Skim Milk Price")
    r["mover"] = line_val(t, r"Class I Skim Milk Price Mover")
    r["adv_butterfat"] = line_val(t, r"Advanced Butterfat Price")
    return r, ""


def parse_ppd(text):
    # -layout keeps the header row on one line; pypdf breaks it into one word a line
    if not re.search(r"^\s*Utilization\s{2,}Product\s{2,}Component", text or "", re.M):
        return None, "not -layout text"
    mk = month_of(text)
    if not mk:
        return None, "no month"
    m = re.search(r"Producer Price Differential \(Dollars Per Cwt\.--Base Zone\)\s+%s" % NUM, text)
    r = {"month_key": mk, "ppd": num(m.group(1)) if m else None,
         "uniform": line_val(text, r"Statistical Uniform Price"),
         "scc": line_val(text, r"Somatic Cell Adjustment Rate"),
         "released_ppd": released(text)}
    z = re.search(r"Base Zone \(([^)]+)\)", text)
    if z:
        r["base_zone"] = z.group(1).strip()
    if r["ppd"] is None or r["uniform"] is None:
        return None, "no PPD or statistical uniform price"
    return r, ""


CENTRAL_HEAD = ("January", "February", "March", "April", "May", "June", "July", "August", "September",
                "October", "November", "December", "Average*")


def parse_central(text):
    """{month_key: {"ppd", "uniform"}} for Upper Midwest (#30) from the Central
    Order's yearly all-order summary (fmmacentral.com sum<year>.pdf, -layout
    text). Each value is put in the column whose heading it sits under, so a part
    year's weighted average is never read as a month."""
    t = text or ""
    y = re.search(r"\b(20\d\d) Federal Milk (?:Marketing )?Order Statistics", t)   # 2024 drops "Marketing"
    hl = next((ln for ln in t.splitlines() if re.search(r"\bJanuary\s+February\s+March\b", ln)), None)
    blk = re.search(r"^\s*Upper Midwest \(#30\)\s*$(.*?)(?=^[^\n]*\(#\d+\)\s*$|^\s*FMO Totals|\Z)", t, re.M | re.S)
    if not (y and hl and blk):
        return {}
    cols = []
    for h in CENTRAL_HEAD:
        i = hl.find(h)
        if i < 0:
            return {}
        cols.append((i + len(h) / 2.0, h))

    def row(label):
        ln = next((x for x in blk.group(1).splitlines() if x.strip().startswith(label)), None)
        out = {}
        if ln is None:
            return out
        for m in re.finditer(r"\(?-?\$\s*\d+\.\d{2}\)?", ln):     # ($0.56) in 2025, -$0.24 in 2024
            c = (m.start() + m.end()) / 2.0
            h = min(cols, key=lambda x: abs(x[0] - c))[1]
            if h != "Average*":
                out[CENTRAL_HEAD.index(h) + 1] = num(m.group(0))
        return out
    u, p = row("Statistical Uniform Price"), row("Producer Price Differential")
    return {"%s-%02d" % (y.group(1), m): {"uniform": u[m], "ppd": p[m]} for m in sorted(p) if m in u}


def check_class1(r):
    """'' when the Class I row adds up, else why."""
    if not all(isinstance(r.get(k), float) for k in ("class1", "class1_skim", "class1_bf", "class1_diff", "mover")):
        return "Class I row incomplete"
    if abs(round(0.965 * r["class1_skim"] + 3.5 * r["class1_bf"], 2) - r["class1"]) > 0.011:
        return "Class I 3.5%% %.2f is not 0.965 x skim + 3.5 x butterfat" % r["class1"]
    if abs(r["mover"] + r["class1_diff"] - r["class1_skim"]) > 0.006:
        return "Class I skim is not the mover plus the differential"
    return ""


def higher_of(r):
    a, b, m = r.get("adv_class3_skim"), r.get("adv_class4_skim"), r.get("mover")
    return isinstance(a, float) and isinstance(b, float) and isinstance(m, float) and abs(max(a, b) - m) < 0.006


def month_record(mk, cls_text, ppd_text):
    """One checked month from its class and PPD release texts, or (None, why)."""
    c, why = parse_class(cls_text) if cls_text else (None, "no class release")
    if not c:
        return None, "class release: " + why
    if c["month_key"] != mk:
        return None, "class release is for %s, not %s" % (c["month_key"], mk)
    w = check_class1(c)
    if w:
        return None, w
    p, why = parse_ppd(ppd_text) if ppd_text else (None, "no PPD release")
    if not p:
        return None, "PPD release: " + why
    if p["month_key"] != mk:
        return None, "PPD release is for %s, not %s" % (p["month_key"], mk)
    if not isinstance(c.get("class3"), float) or abs(c["class3"] + p["ppd"] - p["uniform"]) > 0.006:
        return None, "statistical uniform price %.2f is not Class III plus the PPD" % p["uniform"]
    r = dict(c)
    r.update(p)
    if isinstance(c.get("scc"), float) and isinstance(p.get("scc"), float) and abs(c["scc"] - p["scc"]) > 1e-9:
        return None, "the two releases give different SCC rates"
    r["mover_higher_of"] = higher_of(c)
    return {k: v for k, v in r.items() if v is not None}, ""


# ---------------------------------------------------------------- fetching
def _ym(mk):
    return int(mk[:4]), int(mk[5:7])


def _shift(mk, n):
    y, m = _ym(mk)
    i = y * 12 + m - 1 + n
    return "%d-%02d" % (i // 12, i % 12 + 1)


def _url(tmpl, mk):
    y, m = _ym(mk)
    return tmpl.format(y=y, m=m, yy=y % 100)


def newest_ppd(index_html):
    """The newest PPD month the market administrator's index links."""
    ks = ["20%s-%s" % (yy, mm) for mm, yy in re.findall(r"PPD/\d{4}/PPD(\d{2})(\d{2})\.pdf", index_html or "")]
    ks = [k for k in ks if 1 <= int(k[5:]) <= 12]
    return max(ks) if ks else None


def get_text(url, get=http_get):
    raw, err = get(url)
    if raw is None:
        return None, err
    if raw[:5] != b"%PDF-":
        return None, "not a PDF"
    t, err = pdf_to_text(raw)
    return t, err


def build(get_page, get_pdf, now, old_hist=None):
    """(record, why). get_page(url) -> (bytes, err); get_pdf(url) -> (text, err)."""
    body, err = get_page(PPD_INDEX)
    mk = newest_ppd(body.decode("utf-8", "replace") if body else "")
    if not mk:
        return None, "PPD index unreadable (%s)" % (err or "no PPD links")
    out = {}
    for key, k in (("latest", mk), ("year_ago", _shift(mk, -12))):
        ct, e1 = get_pdf(_url(CLASS_URL, k))
        pt, e2 = get_pdf(_url(PPD_URL, k))
        r, why = month_record(k, ct, pt)
        if not r:
            if key == "latest":
                return None, "%s: %s" % (k, why or e1 or e2)
            out["year_ago_why"] = "%s: %s" % (k, why or e1 or e2)
            continue
        out[key] = r
    # the coming months' Class I, from the advance releases already out
    nxt = []
    for n in (1, 2, 3):
        k = _shift(mk, n)
        t, _e = get_pdf(_url(ADV_URL, k))
        a, _w = parse_adv(t) if t else (None, "")
        if a and a["month_key"] == k and not check_class1(a):
            a["mover_higher_of"] = higher_of(a)
            nxt.append({x: v for x, v in a.items() if v is not None})
    if nxt:
        out["next_class1"] = nxt
    hist, hwhy = ppd_history(mk, old_hist, get_pdf)
    central = {}
    for y in sorted({r["month_key"][:4] for r in hist}):
        t, _e = get_pdf(CENTRAL_SUM.format(y=y))
        central.update(parse_central(t) if t else {})
    out["ppd_history"] = mark_central(hist, central)
    if hwhy:
        out["ppd_history_why"] = hwhy
    out["read"] = now.strftime("%Y-%m-%d")
    return out, ""


HIST_MONTHS = 24       # the PPD history on the page: the 24 months up to the latest
HIST_KEYS = ("month_key", "ppd", "uniform", "class3", "released_ppd", "central")


def ppd_history(latest_mk, old_rows, get_pdf, n=HIST_MONTHS):
    """(rows, why_by_month): the n months up to latest_mk, each from that month's
    own class and PPD releases and passing month_record's checks (uniform = Class
    III + PPD among them). A month already held is kept as it was and not fetched
    again (a release does not change once out); a month that fails is left out
    with its reason, never filled."""
    held = {r["month_key"]: r for r in (old_rows or []) if isinstance(r, dict) and r.get("month_key")}
    rows, why = [], {}
    for i in range(n - 1, -1, -1):
        k = _shift(latest_mk, -i)
        if k in held and isinstance(held[k].get("ppd"), float):
            rows.append(held[k])
            continue
        ct, e1 = get_pdf(_url(CLASS_URL, k))
        pt, e2 = get_pdf(_url(PPD_URL, k))
        r, w = month_record(k, ct, pt)
        if not r:
            why[k] = (w or e1 or e2 or "not read")[:160]
            continue
        rows.append({x: r[x] for x in HIST_KEYS if r.get(x) is not None})
    return rows, why


def mark_central(rows, central):
    """Each history month gets central = agree (the Central Order's yearly summary
    prints the same PPD and statistical uniform price) or differ; a month the
    summary does not hold keeps what it had."""
    for r in rows:
        c = central.get(r["month_key"])
        if c:
            r["central"] = "agree" if abs(c["ppd"] - r["ppd"]) < 0.005 and abs(c["uniform"] - r["uniform"]) < 0.005 else "differ"
    return rows


def run(root=ROOT, now=None, get_page=None, get_pdf=None):
    now = now or datetime.datetime.now(datetime.timezone.utc)
    get_page = get_page or http_get
    get_pdf = get_pdf or (lambda u: get_text(u))
    p = Path(root) / OUT
    try:
        old = json.loads(p.read_text())
    except (OSError, ValueError):
        old = {}
    new, why = build(get_page, get_pdf, now, old.get("ppd_history"))
    if new and old.get("latest", {}).get("month_key", "") > new["latest"]["month_key"]:
        new, why = None, "the newest month read is older than the one held"
    if not new:
        print("::warning::Order 30 not refreshed: %s" % why)
        old["status"] = {"ok": False, "why": why, "at": now.strftime("%Y-%m-%dT%H:%M:%SZ")}
        if not old.get("latest"):
            old["why"] = why
        rec = old
    else:
        rec = dict(new, source="Upper Midwest Market Administrator (Federal Order 30)", source_url=SITE,
                   status={"ok": True, "at": now.strftime("%Y-%m-%dT%H:%M:%SZ")},
                   _note="Written by scripts/fetch_order30.py from the market administrator's own PPD and class "
                         "releases; every month checked (Class I identity, skim = mover + differential, uniform = "
                         "Class III + PPD). Never typed by hand.")
        print("[order30] %s: PPD %+.2f, uniform %.2f; year ago %s" % (
            new["latest"]["month_key"], new["latest"]["ppd"], new["latest"]["uniform"],
            new.get("year_ago", {}).get("month_key") or new.get("year_ago_why")))
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(rec, indent=1, sort_keys=True) + "\n")
    os.replace(tmp, p)
    return rec


def _follow(u):
    return not FILE.search(u) and bool(WORDS.search(u) or re.search(r"fmma30\.com/?$", u, re.I))


def _keep(u):
    return bool(FILE.search(u)) and bool(WORDS.search(u) or "fmma30" in u.lower())


def probe(root):
    print("Order 30 probe")
    ix = dairy_probe.crawl(Path(root) / RAW, STARTS, ["fmma30.com", "fmmacentral.com"], _follow, _keep, depth=2, max_files=60)
    print("  %d urls, %d saved" % (len(ix), sum(1 for r in ix if r.get("file"))))
    return 0


# ---------------------------------------------------------------- selftest
def selftest():
    fails = []

    def ck(name, ok, detail=""):
        print(("  ok   " if ok else "  FAIL ") + name + (f"  ({detail})" if not ok and detail else ""))
        if not ok:
            fails.append(name)

    fx = Path(__file__).resolve().parent.parent / "test" / "fixtures" / "milk"
    cls = (fx / "o30-class-2026-09.txt").read_text()
    ppd = (fx / "o30-ppd-2026-09.txt").read_text()
    adv = (fx / "o30-adv-2026-11.txt").read_text()
    adv25 = (fx / "o30-adv-2025-01.txt").read_text()
    pyp = (fx / "o30-ppd-2026-09-pypdf.txt").read_text()

    c, why = parse_class(cls)
    ck("Sep 2026 class release: month, Class I base zone", c and c["month_key"] == "2026-09" and c["class1"] == 20.24
       and c["class1_diff"] == 3.20 and c["class1_skim"] == 15.36 and c["class1_bf"] == 1.5484, c or why)
    ck("Sep 2026: Class III 16.04, Class IV 18.94 (the front page, not the October advance on the back)",
       c and c["class3"] == 16.04 and c["class4"] == 18.94, c)
    ck("Sep 2026: advanced skim 11.76 / 12.16, mover 12.16, adv butterfat 1.5164, SCC 0.00078",
       c and (c["adv_class3_skim"], c["adv_class4_skim"], c["mover"], c["adv_butterfat"], c["scc"]) == (11.76, 12.16, 12.16, 1.5164, 0.00078), c)
    ck("Sep 2026 Class I adds up", c and check_class1(c) == "", check_class1(c or {}))
    ck("Sep 2026 mover is the higher of", c and higher_of(c))
    p, why = parse_ppd(ppd)
    ck("Sep 2026 PPD release: PPD +0.58, uniform 16.62, base zone Cook County, released Oct 12",
       p and p["ppd"] == 0.58 and p["uniform"] == 16.62 and p["base_zone"] == "Cook County, IL"
       and p["released_ppd"] == "2026-10-12" and p["scc"] == 0.00078, p or why)
    r, why = month_record("2026-09", cls, ppd)
    ck("Sep 2026 month record passes every check", r and r["ppd"] == 0.58 and r["mover_higher_of"] is True, why)
    ck("uniform = Class III + PPD is enforced", month_record("2026-09", cls, ppd.replace("16.62", "16.72"))[0] is None)
    ck("a release for another month is refused", month_record("2026-08", cls, ppd)[0] is None)
    ck("a broken Class I row is refused", month_record("2026-09", cls.replace("$20.24", "$20.34", 1), ppd)[0] is None)
    ck("the scrambled pypdf text is refused, never guessed", parse_ppd(pyp)[0] is None and parse_ppd(pyp)[1] == "not -layout text")
    flat = re.sub(r"[ \t]{2,}", " ", cls)          # the class release as pypdf would space it
    ck("a class release without its columns is refused", parse_class(flat) == (None, "not -layout text"), parse_class(flat))
    a, why = parse_adv(adv)
    ck("Nov 2026 advance: Class I 23.47, mover 16.03 = Class IV skim, released Oct 21",
       a and a["month_key"] == "2026-11" and a["class1"] == 23.47 and a["mover"] == 16.03 and higher_of(a)
       and a["released"] == "2026-10-21" and check_class1(a) == "", a or why)
    a25, _ = parse_adv(adv25)
    ck("Jan 2025 advance: the old mover (average plus 74 cents) is not labeled the higher of",
       a25 and a25["mover"] == 10.49 and not higher_of(a25) and check_class1(a25) == "", a25)
    ck("negative PPD in parentheses or with a minus", num("$(0.42)") == -0.42 and num("-0.42") == -0.42 and num("$ 0.58") == 0.58)
    neg = ppd.replace("$0.58     $", "$(0.42)     $").replace("16.62", "15.62")
    rn, why = month_record("2026-09", cls, neg)
    ck("a negative PPD reads and still checks against the uniform price", rn and rn["ppd"] == -0.42, why)
    ck("newest PPD month from the index", newest_ppd('<a href="PPD/2026/PPD0826.pdf"><a href="PPD/2026/PPD0926.pdf"><a href="PPD/2025/PPD1225.pdf">') == "2026-09")
    ck("urls", _url(PPD_URL, "2026-09") == "https://www.fmma30.com/PPD/2026/PPD0926.pdf"
       and _url(CLASS_URL, "2025-09") == "https://www.fmma30.com/ClassPrice/2025/ClassPrice--09-25.pdf")

    asked = []

    def fake(u):
        asked.append(u)
        return ({_url(CLASS_URL, "2026-09"): cls, _url(PPD_URL, "2026-09"): ppd}.get(u), "404")
    held = [{"month_key": "2026-07", "ppd": 0.41, "uniform": 17.0, "class3": 16.59}]
    hr, hw = ppd_history("2026-09", held, fake, n=3)
    ck("PPD history: a checked month from its own releases, a held month kept, a missing month left out with why",
       [r["month_key"] for r in hr] == ["2026-07", "2026-09"] and hr[1]["ppd"] == 0.58 and hr[1]["class3"] == 16.04
       and list(hw) == ["2026-08"], (hr, hw))
    ck("...the held month is not fetched again", not any("07-26" in u or "0726" in u for u in asked), asked)
    hr2, hw2 = ppd_history("2026-09", [], lambda u: ({_url(CLASS_URL, "2026-09"): cls,
                                                      _url(PPD_URL, "2026-09"): ppd.replace("16.62", "16.72")}.get(u), "404"), n=1)
    ck("...a month whose uniform is not Class III plus PPD is left out", hr2 == [] and "2026-09" in hw2, hw2)

    fxr = lambda n: (fx / n).read_text()
    r24, w24 = month_record("2024-10", fxr("o30-class-2024-10.txt"), fxr("o30-ppd-2024-10.txt"))
    ck("Oct 2024 releases: PPD ($0.47) negative, uniform 22.38 = Class III 22.85 - 0.47",
       r24 and r24["ppd"] == -0.47 and r24["uniform"] == 22.38 and r24["class3"] == 22.85, w24)
    c24, c25, c26 = (parse_central(fxr("central-sum%d-o30.txt" % y)) for y in (2024, 2025, 2026))
    ck("Central Order yearly summaries: 12, 12 and 9 months for Order 30", (len(c24), len(c25), len(c26)) == (12, 12, 9),
       (len(c24), len(c25), len(c26)))
    ck("...Oct 2024 -$0.47 (2024 prints a minus), Nov 2025 ($0.56) (2025 prints parentheses), Sep 2026 $0.58",
       c24["2024-10"] == {"uniform": 22.38, "ppd": -0.47} and c25["2025-11"] == {"uniform": 16.62, "ppd": -0.56}
       and c26["2026-09"] == {"uniform": 16.62, "ppd": 0.58}, (c24.get("2024-10"), c25.get("2025-11"), c26.get("2026-09")))
    ck("...a part year's weighted average is not read as October", "2026-10" not in c26)
    mk_ = mark_central([dict(r24), dict(month_record("2026-09", cls, ppd)[0])], dict(c24, **c26))
    ck("the market administrator's own releases agree with the summary, month by month",
       [r["central"] for r in mk_] == ["agree", "agree"], mk_)
    ck("...a summary that differs is marked so", mark_central([dict(r24, ppd=-0.37)], c24)[0]["central"] == "differ")

    # the whole build with fake fetches; the year-ago month missing is said, not filled
    import tempfile
    pages = {PPD_INDEX: b'<a href="PPD/2026/PPD0926.pdf">'}
    pdfs = {_url(CLASS_URL, "2026-09"): cls, _url(PPD_URL, "2026-09"): ppd, _url(ADV_URL, "2026-11"): adv}
    with tempfile.TemporaryDirectory() as d:
        (Path(d) / "data").mkdir()
        rec = run(d, now=datetime.datetime(2026, 10, 28, tzinfo=datetime.timezone.utc),
                  get_page=lambda u: (pages.get(u), None if u in pages else "404"),
                  get_pdf=lambda u: (pdfs.get(u), None if u in pdfs else "404"))
        ck("build writes the latest month", rec.get("latest", {}).get("month_key") == "2026-09" and rec["status"]["ok"], rec.get("status"))
        ck("no year-ago row invented; the reason is kept", "year_ago" not in rec and "2025-09" in rec.get("year_ago_why", ""), rec.get("year_ago_why"))
        ck("next Class I: November only (October's advance not fetched in this fake)",
           [x["month_key"] for x in rec.get("next_class1", [])] == ["2026-11"], rec.get("next_class1"))
        rec2 = run(d, now=datetime.datetime(2026, 10, 29, tzinfo=datetime.timezone.utc),
                   get_page=lambda u: (None, "timeout"), get_pdf=lambda u: (None, "timeout"))
        ck("a failed fetch keeps the last good month and says why",
           rec2["latest"]["month_key"] == "2026-09" and rec2["status"]["ok"] is False and "timeout" in rec2["status"]["why"], rec2.get("status"))
    print("fetch_order30 selftest: %s" % ("PASS" if not fails else "FAIL (%d)" % len(fails)))
    return 1 if fails else 0


def main(argv):
    if "--selftest" in argv:
        return selftest()
    if "--probe" in argv:
        return probe(ROOT)
    run(ROOT)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
