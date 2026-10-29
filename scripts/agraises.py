#!/usr/bin/env python3
"""agraises.py -- private ag raises (Regulation Crowdfunding, Form C) for /ag-stocks.

Sig approved Oct 29, 2026. The sandbox cannot reach sec.gov, so the reads run in
GitHub Actions (.github/workflows/sec-reg-cf.yml, by hand only):

  python3 scripts/agraises.py download --out history/sec-reg-cf/<date>
      the 42 quarterly SEC Crowdfunding Offerings zips (2016q2 to 2026q3), byte for byte,
      with SHA256SUMS and fetch.json; saved to the private raw branch.
  python3 scripts/agraises.py edgar --raw history/sec-reg-cf/<date>
      one data.sec.gov submissions read per issuer: SIC code and description (the EDGAR
      business description), plus the issuer's recent Form C filings (C-W, C-TR after the
      last quarterly file). Saved beside the zips as edgar.jsonl.gz.
  python3 scripts/agraises.py screen --raw history/sec-reg-cf/<date> [--publish]
      screens ag issuers, scores every past raise, writes <raw>/derived/ (every ag offering,
      every borderline case left out, the outcome counts) and, with --publish only,
      data/agstocks/raises.json for the page.
  python3 scripts/agraises.py --selftest

What is published (raises.json): issuer company name, city and state, the filed numbers
(target, maximum, deadline, security, price, revenue, employees) and the EDGAR link of the
filing. Never a portal link, a street address or a person's name (the signature tables are
never read).

Outcomes of a past raise (flags, each counted on its own; definitions in OUTCOME_NOTES):
  reached target   a Form C-U for that offering says the target was met
  annual report    at least one Form C-AR filed after the Form C
  terminated       a Form C-TR (termination of reporting) filed after the Form C
  raised again     a later new Form C (not an amendment) by the same issuer
  went silent      no Form C-TR, and no Form C-AR for 15 months after one was due
  withdrawn        a Form C-W for that offering
A past raise is one whose deadline is at least PAST_DAYS before the last filing date in the
quarterly files, so its first annual report and the 15 months after were due in the data.
"""
import csv
import gzip
import hashlib
import io
import json
import os
import re
import sys
import time
import urllib.request
import zipfile
from datetime import date, datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT_PUBLIC = os.path.join(ROOT, "data", "agstocks", "raises.json")
OVERRIDES = os.path.join(HERE, "agraises_overrides.json")
UA = "AGSIST ag stocks (+https://agsist.com; sig@agsist.com)"
BASE = "https://www.sec.gov/files/dera/data/crowdfunding-offerings-data-sets/"
DATASET_PAGE = "https://www.sec.gov/data-research/sec-markets-data/crowdfunding-offerings-data-sets"
SEC_GAP_S = 0.15            # SEC fair access: under 10 requests a second
PAST_DAYS = 365 + 120 + 456  # latest first C-AR due (deadline + 1 year + 120 days) + 15 months
GRACE_DAYS = 456             # "15 months after it was due"
SHARE_MIN = 20               # fewer past raises than this: counts only, no share
TABLES = ("FORM_C_SUBMISSION", "FORM_C_ISSUER_INFORMATION", "FORM_C_DISCLOSURE")


def quarters(first=(2016, 2), last=(2026, 3)):
    y, q = first
    out = []
    while (y, q) <= last:
        out.append(f"{y}q{q}")
        q += 1
        if q == 5:
            y, q = y + 1, 1
    return out


def urls():
    return [BASE + f"{q}_cf.zip" for q in quarters()]


# ---------------------------------------------------------------- parsing helpers
MON = {m: i + 1 for i, m in enumerate("JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC".split())}


def pdate(s):
    """SEC dates in the forms the data sets use; None when it cannot be read (never guessed)."""
    s = (s or "").strip()
    if not s:
        return None
    s = s.split(" ")[0].split("T")[0]
    try:
        if re.fullmatch(r"\d{8}", s):
            return date(int(s[:4]), int(s[4:6]), int(s[6:]))
        m = re.fullmatch(r"(\d{4})-(\d{1,2})-(\d{1,2})", s)
        if m:
            return date(int(m[1]), int(m[2]), int(m[3]))
        m = re.fullmatch(r"(\d{1,2})-([A-Za-z]{3})-(\d{4})", s)
        if m and m[2].upper() in MON:
            return date(int(m[3]), MON[m[2].upper()], int(m[1]))
        m = re.fullmatch(r"(\d{1,2})[-/](\d{1,2})[-/](\d{4})", s)   # Form C XML: MM-DD-YYYY
        if m:
            return date(int(m[3]), int(m[1]), int(m[2]))
    except ValueError:
        return None
    return None


def num(s):
    s = (s or "").strip().replace(",", "").replace("$", "")
    if not s:
        return None
    try:
        v = float(s)
    except ValueError:
        return None
    return v


def read_tsv(data):
    """One SEC TSV (UTF-8, tab separated, header row). A free-text field that holds a line
    break splits a row; the pieces are joined back until the row has every column. Returns
    (rows as dicts, rows that still did not fit)."""
    text = data.decode("utf-8", errors="replace").replace("\r\n", "\n").replace("\r", "\n")
    lines = text.split("\n")
    if not lines:
        return [], 0
    head = [h.strip().upper() for h in lines[0].split("\t")]
    rows, bad, buf = [], 0, None
    for ln in lines[1:]:
        if buf is None:
            if not ln.strip():
                continue
            buf = ln
        else:
            buf += "\n" + ln
        parts = buf.split("\t")
        if len(parts) < len(head):
            continue
        if len(parts) > len(head):
            bad += 1
            buf = None
            continue
        rows.append(dict(zip(head, (p.strip() for p in parts))))
        buf = None
    if buf is not None:
        bad += 1
    return rows, bad


def read_zip(path):
    """{table: [rows]} for the three tables we use, plus a count of rows that did not parse."""
    out = {t: [] for t in TABLES}
    bad = 0
    with zipfile.ZipFile(path) as z:
        for info in z.infolist():
            base = os.path.basename(info.filename).upper()
            if not base.endswith((".TSV", ".TXT")):
                continue
            stem = base.rsplit(".", 1)[0]
            if stem in out:
                rows, b = read_tsv(z.read(info))
                out[stem].extend(rows)
                bad += b
    return out, bad


# ---------------------------------------------------------------- download (Actions)
def http_get(url, timeout=120, tries=4):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001 - every failure is reported, then retried
            last = e
            if getattr(e, "code", None) == 404:
                break
            time.sleep(3 * (i + 1))
    raise RuntimeError(f"{url}: {str(last)[:160]}")


def download(out):
    os.makedirs(out, exist_ok=True)
    got, missing = [], []
    for u in urls():
        name = u.rsplit("/", 1)[1]
        dest = os.path.join(out, name)
        if not os.path.exists(dest):
            try:
                data = http_get(u)
                if not data.startswith(b"PK"):
                    raise RuntimeError(f"{u}: not a zip (first bytes {data[:20]!r})")
                with open(dest, "wb") as f:
                    f.write(data)
            except RuntimeError as e:
                print(f"::warning::{e}")
                missing.append(u)
                continue
            time.sleep(SEC_GAP_S)
        got.append(name)
    sums = []
    for name in sorted(got):
        with open(os.path.join(out, name), "rb") as f:
            sums.append(f"{hashlib.sha256(f.read()).hexdigest()}  {name}")
    with open(os.path.join(out, "SHA256SUMS"), "w") as f:
        f.write("\n".join(sums) + "\n")
    meta = {"source": DATASET_PAGE, "fetched_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "files": sorted(got), "missing": missing, "expected": len(urls())}
    with open(os.path.join(out, "fetch.json"), "w") as f:
        json.dump(meta, f, indent=1)
    print(f"sec-reg-cf: {len(got)} of {len(urls())} quarterly files, {len(missing)} missing")
    return 0 if got else 1


# ---------------------------------------------------------------- EDGAR submissions (Actions)
def load_edgar(raw):
    p = os.path.join(raw, "edgar.jsonl.gz")
    out = {}
    if os.path.exists(p):
        with gzip.open(p, "rt", encoding="utf-8") as f:
            for ln in f:
                try:
                    r = json.loads(ln)
                    out[r["cik"]] = r
                except (ValueError, KeyError):
                    continue
    return out


def edgar(raw, limit=None):
    """SIC and recent Form C filings for every issuer CIK in the quarterly files. Resumable:
    CIKs already in edgar.jsonl.gz are not read again."""
    have = load_edgar(raw)
    ciks = sorted({r["cik"] for r in load_filings(raw)[0].values()})
    todo = [c for c in ciks if c not in have][: limit or None]
    print(f"edgar: {len(ciks)} issuers, {len(have)} on file, reading {len(todo)}")
    fails = 0
    last = 0.0
    for i, c in enumerate(todo):
        wait = SEC_GAP_S - (time.time() - last)
        if wait > 0:
            time.sleep(wait)
        last = time.time()
        rec = {"cik": c}
        try:
            req = urllib.request.Request(f"https://data.sec.gov/submissions/CIK{int(c):010d}.json",
                                         headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=60) as r:
                j = json.load(r)
            rec["sic"] = str(j.get("sic") or "")
            rec["sicd"] = j.get("sicDescription") or ""
            rec["name"] = j.get("name") or ""
            rr = (j.get("filings") or {}).get("recent") or {}
            forms = rr.get("form") or []
            rec["f"] = [[forms[k], (rr.get("filingDate") or [""])[k] if k < len(rr.get("filingDate") or []) else "",
                         (rr.get("accessionNumber") or [""])[k] if k < len(rr.get("accessionNumber") or []) else "",
                         (rr.get("fileNumber") or [""])[k] if k < len(rr.get("fileNumber") or []) else ""]
                        for k in range(len(forms)) if str(forms[k]).startswith("C")]
        except Exception as e:  # noqa: BLE001
            fails += 1
            rec["err"] = str(e)[:80]
            if getattr(e, "code", None) == 429:
                time.sleep(30)
        have[c] = rec
        if (i + 1) % 500 == 0:
            print(f"edgar: {i + 1} read, {fails} failed")
            _save_edgar(raw, have)
    _save_edgar(raw, have)
    print(f"edgar: done, {fails} failed of {len(todo)}")
    return 0


def _save_edgar(raw, have):
    p = os.path.join(raw, "edgar.jsonl.gz")
    with gzip.open(p + ".tmp", "wt", encoding="utf-8") as f:
        for c in sorted(have):
            f.write(json.dumps(have[c], separators=(",", ":")) + "\n")
    os.replace(p + ".tmp", p)


# ---------------------------------------------------------------- filings -> offerings
def load_filings(raw):
    """Every Form C family filing in the quarterly zips, keyed by accession number."""
    fil = {}
    bad = 0
    zips = sorted(n for n in os.listdir(raw) if n.endswith("_cf.zip"))
    for z in zips:
        t, b = read_zip(os.path.join(raw, z))
        bad += b
        info = {}
        for r in t["FORM_C_ISSUER_INFORMATION"]:
            info.setdefault(r.get("ACCESSION_NUMBER", ""), r)
        disc = {}
        for r in t["FORM_C_DISCLOSURE"]:
            disc.setdefault(r.get("ACCESSION_NUMBER", ""), r)
        for s in t["FORM_C_SUBMISSION"]:
            acc = s.get("ACCESSION_NUMBER", "")
            cik = (s.get("CIK") or "").lstrip("0")
            if not acc or not cik:
                bad += 1
                continue
            i, d = info.get(acc, {}), disc.get(acc, {})
            fil[acc] = {
                "acc": acc, "cik": cik, "type": (s.get("SUBMISSION_TYPE") or "").upper().replace(" ", ""),
                "filed": pdate(s.get("FILING_DATE")), "fileno": (s.get("FILE_NUMBER") or "").strip(),
                "period": pdate(s.get("PERIOD")), "name": i.get("NAMEOFISSUER", ""),
                "city": i.get("CITY", ""), "st": i.get("STATEORCOUNTRY", ""),
                "progress": i.get("PROGRESSUPDATE", ""),
                "target": num(d.get("OFFERINGAMOUNT")), "max": num(d.get("MAXIMUMOFFERINGAMOUNT")),
                "deadline": pdate(d.get("DEADLINEDATE")), "sec": d.get("SECURITYOFFEREDTYPE", ""),
                "sec_other": d.get("SECURITYOFFEREDOTHERDESC", ""), "price": num(d.get("PRICE")),
                "rev": num(d.get("REVENUEMOSTRECENTFISCALYEAR")), "emp": num(d.get("CURRENTEMPLOYEES")),
                "zip": z,
            }
    return fil, {"files": zips, "bad_rows": bad}


REACHED = re.compile(
    r"(100(\.0+)?\s*%|\b(reached|met|achieved|exceeded|surpassed|hit)\b[^.]{0,40}\b(target|minimum|goal)\b|"
    r"\b(target|minimum|goal)\b[^.]{0,40}\b(was|has been|have been|is)\s+(reached|met|achieved|exceeded|surpassed)\b|"
    r"\bfully (funded|subscribed)\b|\boversubscribed\b)", re.I)
NEGATED = re.compile(r"\b(not|no|yet to|never|failed to|did not|has not|have not)\b[^.]{0,25}$", re.I)


def says_reached(text):
    """A Form C-U progress text that says the target was met. A match right after 'not',
    'yet to', 'failed to' and the like does not count."""
    for m in REACHED.finditer(text or ""):
        if not NEGATED.search((text or "")[max(0, m.start() - 40):m.start()]):
            return True
    return False


def offerings(fil):
    """One offering per initial Form C (type C). Amendments (C/A), progress updates (C-U) and
    withdrawals (C-W) attach by issuer and SEC file number, or, with no file number, to the
    issuer's latest Form C filed before them."""
    by_cik = {}
    for f in fil.values():
        if f["filed"]:
            by_cik.setdefault(f["cik"], []).append(f)
    offs = []
    for cik, lst in by_cik.items():
        lst.sort(key=lambda f: (f["filed"], f["acc"]))
        cs = [f for f in lst if f["type"] == "C"]
        idx = {}
        for c in cs:
            o = {"cik": cik, "first": c, "last": c, "cu": [], "cw": [], "fileno": c["fileno"]}
            offs.append(o)
            idx[id(c)] = o
        for f in lst:
            t = f["type"]
            if t not in ("C/A", "C-U", "C-U/A", "C-W"):
                continue
            match = None
            if f["fileno"]:
                cand = [idx[id(c)] for c in cs if c["fileno"] == f["fileno"] and c["filed"] <= f["filed"]]
                if cand:
                    match = cand[-1]
            if match is None:
                prior = [c for c in cs if c["filed"] <= f["filed"]]
                if prior:
                    match = idx[id(prior[-1])]
            if match is None:
                continue
            if t == "C/A":
                match["last"] = f
            elif t == "C-W":
                match["cw"].append(f)
            else:
                match["cu"].append(f)
        car = [f for f in lst if f["type"] in ("C-AR", "C-AR/A")]
        ctr = [f for f in lst if f["type"] in ("C-TR", "C-TR/A")]
        for c in cs:
            o = idx[id(c)]
            o["car"] = [f for f in car if f["filed"] >= c["filed"]]
            o["ctr"] = [f for f in ctr if f["filed"] >= c["filed"]]
            o["again"] = any(x["filed"] > c["filed"] and x["acc"] != c["acc"] and
                             (x["fileno"] != c["fileno"] or not x["fileno"]) for x in cs)
    return offs


def val(o, k):
    """The offering's number as last filed (the latest C/A that has it, else the Form C)."""
    v = o["last"].get(k)
    return v if v not in (None, "") else o["first"].get(k)


def score(o, asof):
    """Flags for one offering, from the filings dated on or before asof only."""
    dl = val(o, "deadline")
    reached = any(says_reached(f["progress"]) for f in o["cu"])
    car = sorted(o["car"], key=lambda f: f["filed"])
    ctr = bool(o["ctr"])
    withdrawn = bool(o["cw"])
    silent = None
    if not ctr and not withdrawn:
        if car:
            lc = car[-1]
            due = (lc["period"] + timedelta(days=365 + 120)) if lc["period"] else (lc["filed"] + timedelta(days=365))
            silent = asof > due + timedelta(days=GRACE_DAYS)
        elif reached and dl:
            silent = asof > dl + timedelta(days=365 + 120 + GRACE_DAYS)
    return {"reached": reached, "car": bool(car), "ctr": ctr, "again": o["again"],
            "silent": bool(silent), "withdrawn": withdrawn, "deadline": dl}


def is_past(o, asof):
    dl = val(o, "deadline")
    return bool(dl) and dl <= asof - timedelta(days=PAST_DAYS)


# ---------------------------------------------------------------- the ag screen
STRONG = re.compile(
    r"\b(farm|farms|farming|farmer|farmers|farmland|ranch|ranches|ranching|dairy|dairies|cattle|livestock|"
    r"poultry|swine|hogs?|agri\w*|agro\w*|ag[- ]?tech|crops?|grains?|orchards?|hydroponics?|hydroponic\w*|"
    r"aquaponics?|aquaculture|greenhouses?|fertili[sz]ers?|irrigation|tractors?|creamery|beekeep\w*|apiar\w*|"
    r"microgreens?|mushrooms?|vertical farm\w*)\b", re.I)
WEAK = re.compile(
    r"\b(harvest\w*|vineyards?|winery|wineries|hemp|cannabis|cbd|gardens?|meats?|beef|eggs?|honey|organics?|"
    r"soil|compost\w*|seeds?|pastures?|barns?|acres?|cows?|goats?|sheep|cotton|coffee|cocoa|foods?|ag|"
    r"cider\w*|growers?|plants?|produce)\b", re.I)
NONAG_WORDS = re.compile(
    r"\b(brew\w*|restaurants?|kitchens?|cafe|café|bar|tavern|pizza\w*|eatery|bistro|grill|bakery|"
    r"distill\w*|winery|wineries|spirits|taproom|pub|salon|apartments?|homes|realty|properties|resort|hotel|"
    r"inn|golf|wedding|events?|venue)\b", re.I)


def sic_class(sic):
    try:
        s = int(sic)
    except (TypeError, ValueError):
        return None
    if 100 <= s <= 299 or 700 <= s <= 799 or 2870 <= s <= 2879 or s == 3523 or 5150 <= s <= 5159 \
            or s == 5191 or s in (2041, 2044, 2046, 2048):
        return "core"
    if s in (5812, 5813, 7011) or 6500 <= s <= 6599 or 2082 <= s <= 2085:
        return "nonag"
    if 2000 <= s <= 2099 or 800 <= s <= 999 or 5140 <= s <= 5149 or 5400 <= s <= 5499:
        return "adjacent"
    return "other"


def screen_issuer(names, sic, sicd, ov):
    """('ag'|'borderline'|None, rule or reason). names: every issuer name the filings carry."""
    cik_rule = None
    nm = " / ".join(sorted(set(n for n in names if n)))
    sc = sic_class(sic)
    strong = STRONG.search(nm)
    weak = WEAK.search(nm)
    nonag = NONAG_WORDS.search(nm)
    sic_s = f"SIC {sic} {sicd}".strip() if sic else "no SIC on EDGAR"
    if sc == "core":
        if nonag:
            cik_rule = ("borderline", f"ag SIC ({sic_s}) but the name reads '{nonag.group(0)}'")
        else:
            cik_rule = ("ag", f"EDGAR SIC {sic} {sicd}".strip())
    elif strong:
        if sc == "nonag":
            cik_rule = ("borderline", f"name has '{strong.group(0)}' but {sic_s}")
        elif nonag:
            cik_rule = ("borderline", f"name has '{strong.group(0)}' and '{nonag.group(0)}'")
        elif sc in ("adjacent", "other"):
            cik_rule = ("borderline", f"name has '{strong.group(0)}' but {sic_s}")
        else:
            cik_rule = ("ag", f"name has '{strong.group(0)}', no SIC on EDGAR")
    elif sc == "adjacent":
        cik_rule = ("borderline", f"food or fishing SIC ({sic_s}), no farm word in the name")
    elif weak:
        cik_rule = ("borderline", f"name has '{weak.group(0)}' only ({sic_s})")
    return cik_rule


def load_overrides(path=OVERRIDES):
    try:
        with open(path, encoding="utf-8") as f:
            j = json.load(f)
        return {"include": j.get("include") or {}, "exclude": j.get("exclude") or {}}
    except (OSError, ValueError):
        return {"include": {}, "exclude": {}}


# ---------------------------------------------------------------- screen + score
def tally(offs, asof):
    keys = ("reached", "car", "ctr", "again", "silent", "withdrawn")
    t = {"n": 0, **{k: 0 for k in keys}}
    for o in offs:
        if not is_past(o, asof):
            continue
        s = score(o, asof)
        t["n"] += 1
        for k in keys:
            t[k] += 1 if s[k] else 0
    return t


def edgar_link(cik, acc):
    return f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{acc.replace('-', '')}/{acc}-index.htm"


def build(raw, today=None, ov=None):
    today = today or datetime.now(timezone.utc).date()
    fil, meta = load_filings(raw)
    if not fil:
        raise SystemExit("no filings read from " + raw)
    asof = max(f["filed"] for f in fil.values() if f["filed"])
    ed = load_edgar(raw)
    ov = ov if ov is not None else load_overrides()
    offs = offerings(fil)
    names = {}
    for f in fil.values():
        names.setdefault(f["cik"], set()).add(f["name"])
    ag, border = {}, []
    for cik, nm in names.items():
        e = ed.get(cik) or {}
        r = screen_issuer(nm, e.get("sic"), e.get("sicd", ""), ov)
        if cik in ov["exclude"]:
            if r and r[0] == "ag":
                border.append({"cik": cik, "names": sorted(nm), "reason": "left out by hand: " + ov["exclude"][cik]})
            continue
        if cik in ov["include"]:
            ag[cik] = "added by hand: " + ov["include"][cik]
            continue
        if not r:
            continue
        if r[0] == "ag":
            ag[cik] = r[1]
        else:
            border.append({"cik": cik, "names": sorted(nm), "reason": r[1]})
    ag_offs = [o for o in offs if o["cik"] in ag]
    # Open raises: deadline today or later, not withdrawn, no termination; EDGAR's own list of
    # the issuer's filings (read after the last quarterly file) can only close one, never open it.
    open_rows = []
    for o in ag_offs:
        dl = val(o, "deadline")
        if not dl or dl < today or o["cw"] or o["ctr"]:
            continue
        e = ed.get(o["cik"]) or {}
        later = [x for x in e.get("f") or [] if x[1] and pdate(x[1]) and pdate(x[1]) > o["first"]["filed"]
                 and x[0] in ("C-W", "C-TR") and (not x[3] or not o["fileno"] or x[3] == o["fileno"] or x[0] == "C-TR")]
        if later:
            continue
        last = o["last"]
        open_rows.append({
            "name": val(o, "name"), "city": val(o, "city"), "st": val(o, "st"),
            "filed": o["first"]["filed"].isoformat(), "last_filed": last["filed"].isoformat(),
            "last_form": last["type"], "deadline": dl.isoformat(),
            "target": val(o, "target"), "max": val(o, "max"),
            "security": (val(o, "sec_other") if (val(o, "sec") or "").lower() == "other" else val(o, "sec")) or None,
            "price": val(o, "price"), "revenue": val(o, "rev"), "employees": val(o, "emp"),
            "link": edgar_link(o["cik"], last["acc"]),
        })
    open_rows.sort(key=lambda r: (r["deadline"], r["name"]))
    pub = {
        "v": 1, "source": DATASET_PAGE, "read": today.isoformat(), "through": asof.isoformat(),
        "files": len(meta["files"]), "expected": len(urls()), "edgar_read": len(ed),
        "open": open_rows,
        "track": {"ag": tally(ag_offs, asof), "all": tally(offs, asof)},
        "past_days": PAST_DAYS, "share_min": SHARE_MIN,
        "screen": {"ag_issuers": len(ag), "ag_offerings": len(ag_offs), "borderline_left_out": len(border),
                   "all_issuers": len(names), "all_offerings": len(offs)},
    }
    private = {"ag": ag, "border": border, "ag_offs": ag_offs, "asof": asof, "meta": meta}
    return pub, private


def write_derived(raw, pub, private):
    d = os.path.join(raw, "derived")
    os.makedirs(d, exist_ok=True)
    asof = private["asof"]
    with open(os.path.join(d, "ag_offerings.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["cik", "issuer", "city", "state", "rule", "form_c_filed", "deadline", "target", "max",
                    "security", "past_raise", "reached_target", "annual_report", "terminated", "raised_again",
                    "went_silent", "withdrawn", "edgar_link"])
        for o in sorted(private["ag_offs"], key=lambda o: (o["first"]["filed"], o["cik"])):
            s = score(o, asof)
            w.writerow([o["cik"], val(o, "name"), val(o, "city"), val(o, "st"), private["ag"][o["cik"]],
                        o["first"]["filed"], s["deadline"] or "", val(o, "target"), val(o, "max"), val(o, "sec"),
                        is_past(o, asof), s["reached"], s["car"], s["ctr"], s["again"], s["silent"], s["withdrawn"],
                        edgar_link(o["cik"], o["first"]["acc"])])
    with open(os.path.join(d, "borderline_excluded.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["cik", "issuer_names", "reason_left_out"])
        for b in sorted(private["border"], key=lambda b: b["names"][0] if b["names"] else ""):
            w.writerow([b["cik"], " / ".join(b["names"]), b["reason"]])
    with open(os.path.join(d, "summary.json"), "w") as f:
        json.dump({**pub, "bad_rows": private["meta"]["bad_rows"]}, f, indent=1)
    print(f"derived: {len(private['ag_offs'])} ag offerings, {len(private['border'])} borderline left out -> {d}")


def screen(raw, publish):
    pub, private = build(raw)
    write_derived(raw, pub, private)
    t = pub["track"]
    print(f"screen: through {pub['through']}, {pub['files']} of {pub['expected']} files, "
          f"ag past raises {t['ag']['n']}, all past raises {t['all']['n']}, open ag raises {len(pub['open'])}")
    if publish:
        if pub["files"] < pub["expected"]:
            print(f"::error::only {pub['files']} of {pub['expected']} quarterly files; not publishing")
            return 1
        os.makedirs(os.path.dirname(OUT_PUBLIC), exist_ok=True)
        with open(OUT_PUBLIC, "w", encoding="utf-8") as f:
            json.dump(pub, f, indent=1, sort_keys=True)
            f.write("\n")
        print("published", os.path.relpath(OUT_PUBLIC, ROOT))
    return 0


# ---------------------------------------------------------------- selftest
def _fixture(tmp):
    """Two quarterly zips in the SEC layout: issuers, amendments, progress, annual reports,
    a termination, a withdrawal and a second raise."""
    sub_h = "ACCESSION_NUMBER\tSUBMISSION_TYPE\tFILING_DATE\tCIK\tFILE_NUMBER\tPERIOD"
    inf_h = "ACCESSION_NUMBER\tISAMENDMENT\tPROGRESSUPDATE\tNATUREOFAMENDMENT\tNAMEOFISSUER\tCITY\tSTATEORCOUNTRY\tCOMPANYNAME"
    dis_h = ("ACCESSION_NUMBER\tSECURITYOFFEREDTYPE\tSECURITYOFFEREDOTHERDESC\tPRICE\tOFFERINGAMOUNT\t"
             "MAXIMUMOFFERINGAMOUNT\tDEADLINEDATE\tCURRENTEMPLOYEES\tREVENUEMOSTRECENTFISCALYEAR")
    rows = [
        # Prairie Grain Farms LLC (cik 11): raise 2019, C-U says target met, two C-ARs, then silent
        ("0000011-19-000001", "C", "15-MAR-2019", "11", "020-00001", "", "Prairie Grain Farms LLC", "", "Equity", "", "1.00", "50000", "500000", "06-30-2019", "3", "12000"),
        ("0000011-19-000002", "C-U", "02-JUL-2019", "11", "020-00001", "", "Prairie Grain Farms LLC", "The issuer has reached its target offering amount.", "", "", "", "", "", "", "", ""),
        ("0000011-20-000001", "C-AR", "20200420", "11", "020-00001", "20191231", "Prairie Grain Farms LLC", "", "", "", "", "", "", "", "", ""),
        ("0000011-21-000001", "C-AR", "20210425", "11", "020-00001", "20201231", "Prairie Grain Farms LLC", "", "", "", "", "", "", "", "", ""),
        # Bluestem Cattle Co (cik 12): raise 2019, C-U NOT reached, C-AR, C-TR
        ("0000012-19-000001", "C", "01-APR-2019", "12", "020-00002", "", "Bluestem Cattle Co", "", "Debt", "", "", "100000", "200000", "08-01-2019", "5", "90000"),
        ("0000012-19-000002", "C-U", "01-JUN-2019", "12", "020-00002", "", "Bluestem Cattle Co", "The issuer has not yet reached 100% of its target.", "", "", "", "", "", "", "", ""),
        ("0000012-20-000001", "C-AR", "20200401", "12", "020-00002", "20191231", "Bluestem Cattle Co", "", "", "", "", "", "", "", "", ""),
        ("0000012-21-000001", "C-TR", "20210301", "12", "020-00002", "", "Bluestem Cattle Co", "", "", "", "", "", "", "", "", ""),
        # Farm Table Brewing (cik 13): borderline (farm + brewing)
        ("0000013-19-000001", "C", "01-MAY-2019", "13", "020-00003", "", "Farm Table Brewing LLC", "", "Equity", "", "", "50000", "100000", "09-01-2019", "8", ""),
        # Gizmo Inc (cik 14): not ag, raised again 2021, withdrew the second
        ("0000014-19-000001", "C", "01-JUN-2019", "14", "020-00004", "", "Gizmo Inc", "", "SAFE", "", "", "25000", "100000", "10-01-2019", "2", ""),
        ("0000014-21-000001", "C", "01-JUN-2021", "14", "020-00009", "", "Gizmo Inc", "", "SAFE", "", "", "25000", "100000", "10-01-2021", "2", ""),
        ("0000014-21-000002", "C-W", "01-JUL-2021", "14", "020-00009", "", "Gizmo Inc", "", "", "", "", "", "", "", "", ""),
        # Lakeside Orchards (cik 15): open raise, amended deadline; filed in the second zip
        ("0000015-26-000001", "C", "01-AUG-2026", "15", "020-00010", "", "Lakeside Orchards LLC", "", "Other", "Revenue share", "", "20000", "250000", "11-30-2026", "4", "30000"),
        ("0000015-26-000002", "C/A", "20-SEP-2026", "15", "020-00010", "", "Lakeside Orchards LLC", "", "Other", "Revenue share", "", "20000", "300000", "12-31-2026", "4", "30000"),
        # Sunny Hydroponics (cik 16): open raise but withdrawn in EDGAR after the last file
        ("0000016-26-000001", "C", "10-SEP-2026", "16", "020-00011", "", "Sunny Hydroponics Inc", "", "Equity", "", "2.00", "10000", "50000", "01-15-2027", "1", "0"),
    ]
    paths = []
    for zi, (lo, hi) in enumerate([(0, 12), (12, len(rows))]):
        sub, inf, dis = [sub_h], [inf_h], [dis_h]
        for r in rows[lo:hi]:
            sub.append("\t".join(r[:6]))
            inf.append("\t".join([r[0], "", r[7], "", r[6], "Town", "IA", "Some Portal LLC"]))
            if r[1] in ("C", "C/A"):
                dis.append("\t".join([r[0], r[8], r[9], r[10], r[11], r[12], r[13], r[14], r[15]]))
        p = os.path.join(tmp, ["2019q1_cf.zip", "2026q3_cf.zip"][zi])
        with zipfile.ZipFile(p, "w") as z:
            folder = ["2019Q1_cf/", "2026Q3_cf/"][zi]
            z.writestr(folder + "FORM_C_SUBMISSION.tsv", "\n".join(sub) + "\n")
            z.writestr(folder + "FORM_C_ISSUER_INFORMATION.tsv", "\n".join(inf) + "\n")
            z.writestr(folder + "FORM_C_DISCLOSURE.tsv", "\n".join(dis) + "\n")
            z.writestr(folder + "FORM_C_ISSUER_SIGNATURE.tsv", "ACCESSION_NUMBER\tSIGNATURE\nx\tA Person\n")
        paths.append(p)
    ed = {
        "11": {"cik": "11", "sic": "", "sicd": ""},
        "12": {"cik": "12", "sic": "0200", "sicd": "AGRICULTURAL PROD-LIVESTOCK & ANIMAL SPECIALTIES"},
        "13": {"cik": "13", "sic": "2082", "sicd": "MALT BEVERAGES"},
        "14": {"cik": "14", "sic": "", "sicd": ""},
        "15": {"cik": "15", "sic": "", "sicd": ""},
        "16": {"cik": "16", "sic": "", "sicd": "", "f": [["C-W", "2026-10-05", "0000016-26-000009", "020-00011"]]},
    }
    _save_edgar(tmp, ed)
    return paths


def selftest():
    import tempfile
    fails = []

    def check(c, m):
        if not c:
            fails.append(m)
    check(len(urls()) == 42 and urls()[0].endswith("2016q2_cf.zip") and urls()[-1].endswith("2026q3_cf.zip"), "42 quarters")
    check(pdate("15-MAR-2019") == date(2019, 3, 15) and pdate("20191231") == date(2019, 12, 31)
          and pdate("06-30-2019") == date(2019, 6, 30) and pdate("2019-06-30") == date(2019, 6, 30)
          and pdate("31/31/2019") is None and pdate("") is None, "dates")
    check(says_reached("The issuer has reached its target offering amount.") and says_reached("100% of target")
          and not says_reached("The issuer has not yet reached 100% of its target.")
          and not says_reached("50% of the target amount") and says_reached("The target amount was met."), "C-U words")
    rows, bad = read_tsv(b"A\tB\tC\n1\tline one\nline two\t3\n4\t5\t6\n7\t8\n")
    check(len(rows) == 2 and rows[0]["B"] == "line one\nline two" and bad == 1, "tsv joins split rows")
    check(screen_issuer({"Farm Table Brewing LLC"}, "", "", {})[0] == "borderline", "farm + brewing is borderline")
    check(screen_issuer({"Acme Holdings"}, "0100", "AGRICULTURAL PRODUCTION-CROPS", {})[0] == "ag", "SIC alone")
    check(screen_issuer({"Gizmo Inc"}, "", "", {}) is None, "not ag")
    check(screen_issuer({"Pharmacy Plus"}, "", "", {}) is None, "pharma is not farm")
    check(screen_issuer({"Happy Hemp Co"}, "", "", {})[0] == "borderline", "hemp borderline")
    with tempfile.TemporaryDirectory() as tmp:
        _fixture(tmp)
        pub, pr = build(tmp, today=date(2026, 10, 29), ov={"include": {}, "exclude": {}})
        ag = pr["ag"]
        check(set(ag) == {"11", "12", "15", "16"}, f"ag set {sorted(ag)}")
        check([b["cik"] for b in pr["border"]] == ["13"], "brewing listed as borderline")
        check(pub["through"] == "2026-09-20", "as of the last filing")
        t = pub["track"]["ag"]
        check(t == {"n": 2, "reached": 1, "car": 2, "ctr": 1, "again": 0, "silent": 1, "withdrawn": 0}, f"ag tally {t}")
        a = pub["track"]["all"]
        check(a["n"] == 5 and a["again"] == 1 and a["withdrawn"] == 1, f"all tally {a}")
        check([r["name"] for r in pub["open"]] == ["Lakeside Orchards LLC"], f"open {[r['name'] for r in pub['open']]}")
        r = pub["open"][0]
        check(r["deadline"] == "2026-12-31" and r["max"] == 300000 and r["last_form"] == "C/A"
              and r["security"] == "Revenue share", "open raise uses the amendment")
        check(r["link"] == "https://www.sec.gov/Archives/edgar/data/15/000001526000002/0000015-26-000002-index.htm", r["link"])
        s = json.dumps(pub)
        check("Some Portal" not in s and "A Person" not in s and "portal" not in s.lower(), "no portal, no person")
        pub2, _ = build(tmp, today=date(2026, 10, 29), ov={"include": {}, "exclude": {"15": "test"}})
        check(not pub2["open"], "hand exclusion")
        silent_off = score(next(o for o in pr["ag_offs"] if o["cik"] == "11"), date(2022, 6, 1))
        check(not silent_off["silent"], "not silent before the grace runs out")
    for f in fails:
        print("FAIL", f)
    if not fails:
        print("agraises selftest: ok")
    return 1 if fails else 0


def main(argv):
    if "--selftest" in argv:
        return selftest()
    if len(argv) < 2:
        print(__doc__)
        return 2
    cmd = argv[1]

    def opt(name):
        return argv[argv.index(name) + 1] if name in argv else None
    if cmd == "urls":
        print("\n".join(urls()))
        return 0
    if cmd == "download":
        return download(opt("--out"))
    if cmd == "edgar":
        lim = opt("--limit")
        return edgar(opt("--raw"), int(lim) if lim else None)
    if cmd == "screen":
        return screen(opt("--raw"), "--publish" in argv)
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
