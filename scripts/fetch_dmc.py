#!/usr/bin/env python3
"""
AGSIST -- data/dairy-dmc.json from FSA's own published Dairy Margin Coverage
monthly margins (all-milk price, feed cost, margin) and the 2027 premium rates.

--probe   save what FSA's DMC pages and files return to data/dairy-raw/dmc/
          (raw branch), so the parser is written against the real layout.
--selftest offline tests.
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import dairy_probe  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
RAW = "data/dairy-raw/dmc"
STARTS = [
    # FSA's monthly margins live here (linked "Program Updates and Prices" from the
    # DMC page, read from the archive copy on the Oct 28 probe)
    "https://www.fsa.usda.gov/resources/programs/dairy-margin-coverage-program-dmc/prices-updates",
    # the January 2026 fact sheet: 2026-2031 premium rates by tier, the multi-year discount wording
    "https://www.fsa.usda.gov/sites/default/files/2026-01/FSA_DMC_012026.pdf",
    # 2019's 50/50 alfalfa blend and the Dec 2021 revision to premium alfalfa from 2020
    "https://www.fsa.usda.gov/news-events/news/07-11-2019/usda-now-making-payments-new-dairy-margin-coverage-program",
    "https://www.fsa.usda.gov/Internet/FSA_Notice/dmc_53.pdf",
    "https://www.fsa.usda.gov/resources/programs/dairy-margin-coverage-program",
    "https://www.fsa.usda.gov/dairy",
    "https://www.fsa.usda.gov/news-events/news/09-30-2026/usda-announces-2027-dairy-margin-coverage-enrollment",
    # MPP-Dairy (2014-2018), DMC's forerunner: FSA's own monthly calculations table
    # (the Oct 28 probe found it only in the Internet Archive; live FSA timed out)
    "https://www.fsa.usda.gov/Assets/USDA-FSA-Public/usdafiles/MPP-Dairy/MPP-Dairy.pdf",
]


def _follow(u):
    return bool(re.search(r"dairy-margin|/dmc|dairy_margin", u, re.I)) and not re.search(r"\.(pdf|xlsx?|csv)(\?|$)", u, re.I)


def _keep(u):
    return bool(re.search(r"\.(pdf|xlsx?|csv)(\?|$)", u, re.I)) and bool(re.search(r"dmc|margin|dairy|premium", u, re.I))


WAYBACK = "https://web.archive.org/web/2026id_/"
AVAIL = "https://archive.org/wayback/available?url="


VIA = {}   # url -> {"via": "live"} or {"via": "archive", "archive_url", "snapshot"}: what answered, for the citation
LIVE = {"down": False}   # after one live timeout the rest of the run goes straight to the archive


def _snap_date(ts):
    """'20261015123456' -> '2026-10-15', else None."""
    return "%s-%s-%s" % (ts[:4], ts[4:6], ts[6:8]) if re.fullmatch(r"\d{14}", ts or "") else None


def get_fsa(u, direct=None, archive=None, avail=None):
    """FSA live first; the Oct 28 probes timed out on most fsa.usda.gov pages from
    the runner, so then the Internet Archive's newest copy of the same URL, by the
    timestamp its availability API gives (the original bytes, id_), so the page
    can cite the archive URL and its snapshot date beside FSA's. VIA[u] records
    which one answered."""
    from fetch_dairy import http_get
    import json as _j
    direct = direct or (lambda x: http_get(x, tries=1, timeout=40))
    archive = archive or (lambda x: http_get(x, tries=2, timeout=60))
    avail = avail or (lambda x: http_get(AVAIL + x, tries=2, timeout=40))
    body, err = (None, "FSA timed out earlier in this run") if LIVE["down"] else direct(u)
    if body is not None:
        VIA[u] = {"via": "live"}
        return body, None
    if "timed out" in (err or "").lower() or "timeout" in (err or "").lower():
        LIVE["down"] = True
    err2 = "no snapshot"
    try:
        a, e = avail(u)
        snap = (_j.loads(a or b"{}").get("archived_snapshots") or {}).get("closest") or {}
        ts = snap.get("timestamp") or ""
        if not _snap_date(ts):
            err2 = e or "no snapshot"
        else:
            au = "https://web.archive.org/web/%s/%s" % (ts, u)
            body, err2 = archive("https://web.archive.org/web/%sid_/%s" % (ts, u))
            if body is not None:
                VIA[u] = {"via": "archive", "archive_url": au, "snapshot": _snap_date(ts)}
                return body, None
    except Exception as ex:  # noqa: BLE001
        err2 = type(ex).__name__
    return None, "%s; archive: %s" % (err, err2)


# ---------------------------------------------------------------- parsing
MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
TAG = re.compile(r"<[^>]+>")


def _text(h):
    import html as _h
    return re.sub(r"\s+", " ", _h.unescape(TAG.sub(" ", h or ""))).strip()


def _num(t):
    t = (t or "").replace("$", "").replace(",", "").strip()
    m = re.fullmatch(r"\(?(-?\d+(?:\.\d+)?)\)?", t)
    if not m:
        return None
    v = float(m.group(1))
    return -abs(v) if t.startswith("(") else v


def _month(t):
    m = re.match(r"([A-Za-z]{3})[a-z]*\.?\b", (t or "").strip())
    return MONTHS.index(m.group(1).lower()) + 1 if m and m.group(1).lower() in MONTHS else None


def tables(page):
    """[(context_text_before, [[cell text]])] for each <table> in an html page."""
    t = re.sub(r"(?is)<(script|style)\b.*?</\1>", " ", page or "")
    out, last = [], 0
    for m in re.finditer(r"(?is)<table\b.*?</table>", t):
        ctx = _text(t[max(last, m.start() - 1500):m.start()])[-300:]
        cap = re.search(r"(?is)<caption\b[^>]*>(.*?)</caption>", m.group(0))
        if cap:
            ctx += " " + _text(cap.group(1))
        rows = []
        for r in re.finditer(r"(?is)<tr\b.*?</tr>", m.group(0)):
            rows.append([_text(c) for c in re.findall(r"(?is)<t[hd]\b[^>]*>(.*?)</t[hd]>", r.group(0))])
        out.append((ctx, [r for r in rows if any(r)]))
        last = m.end()
    return out


def _col(head, pat):
    for i, h in enumerate(head):
        if re.search(pat, h, re.I):
            return i
    return None


def parse_margins(page):
    """{month_key: {all_milk, feed, margin}} from FSA's margins tables, months as
    rows, a year in the heading or caption before each table, or the year in a
    'Month Year' first cell. Only cells that are plain numbers are taken."""
    out = {}
    for ctx, rows in tables(page):
        if not rows:
            continue
        head = rows[0]
        ia, ifd, im = _col(head, r"all.?milk"), _col(head, r"feed"), _col(head, r"margin")
        if None in (ia, ifd, im):
            continue
        ys = re.findall(r"\b(20[12]\d)\b", ctx + " " + " ".join(head))
        for r in rows[1:]:
            if len(r) <= max(ia, ifd, im):
                continue
            mo = _month(r[0])
            y = re.search(r"\b(20[12]\d)\b", r[0])
            yr = y.group(1) if y else (ys[-1] if ys else None)
            if not mo or not yr:
                continue
            am, fd, mg = _num(r[ia]), _num(r[ifd]), _num(r[im])
            if am is None or fd is None or mg is None:
                continue
            out["%s-%02d" % (yr, mo)] = {"all_milk": am, "feed": fd, "margin": mg}
    return dict(sorted(out.items()))


def parse_hay(page):
    """{year: FSA's own hay column heading} ('Blended Alfalfa Hay' in 2019,
    'Premium Alfalfa Hay' from 2020 on the Oct 28 read), so the page names the
    hay FSA priced in each year's feed cost from FSA's table, not from memory."""
    out = {}
    for ctx, rows in tables(page):
        if not rows or _col(rows[0], r"margin") is None:
            continue
        i = _col(rows[0], r"hay|alfalfa")
        ys = re.findall(r"\b(20[12]\d)\b", ctx)
        if i is not None and ys:
            out[ys[-1]] = re.sub(r"\s*\(.*$", "", rows[0][i]).strip()
    return dict(sorted(out.items()))


MARGINS_URL = STARTS[0]
FACTS_URL = STARTS[1]
NEWS_2019 = STARTS[2]
NOTICE_53 = STARTS[3]
MPP_URL = STARTS[7]
OUT = "data/dairy-dmc.json"
FIRST = "2019-01"          # DMC's first month; MPP (2014-2018) is a different program and is not shown


def _mk_shift(mk, n):
    i = int(mk[:4]) * 12 + int(mk[5:7]) - 1 + n
    return "%d-%02d" % (i // 12, i % 12 + 1)


def confirm(parsed, nass):
    """(rows, withheld) from FSA's parsed margins. A month is kept when FSA's own
    milk minus feed is FSA's own margin (to the cent FSA prints) and, for the
    month whose NASS all-milk price we hold, FSA's all-milk is that price.
    withheld = {count, months, why} for every DMC month from Jan 2019 to the
    newest FSA month that was not kept."""
    rows, out, why = {}, [], {}
    for k, r in parsed.items():
        if k < FIRST:
            continue
        if abs(r["all_milk"] - r["feed"] - r["margin"]) > 0.006:
            why[k] = "milk minus feed is not the margin"
            continue
        if nass and nass.get("month_key") == k and isinstance(nass.get("value"), (int, float)) \
                and abs(nass["value"] - r["all_milk"]) > 0.005:
            why[k] = "all-milk is not the NASS price held"
            continue
        rows[k] = r
    if rows or why:
        # up to the newest month FSA could have priced: its own newest, or the NASS month held
        nk = (nass or {}).get("month_key") or ""
        last = max(list(rows) + list(why) + ([nk] if re.fullmatch(r"20\d\d-\d\d", nk) else []))
        k = FIRST
        while k <= last:
            if k not in rows:
                out.append(k)
                why.setdefault(k, "not in the copy of FSA's page I read")
            k = _mk_shift(k, 1)
    reasons = sorted(set(why[k] for k in out))
    return rows, {"count": len(out), "months": out, "why": "; ".join(reasons)} if out else {"count": 0}


# ---------------------------------------------------------------- months read off a screen capture
# Oct 28, 2026: the runner reaches FSA only through the Internet Archive, whose
# newest copy (Jun 10) ends at April 2026. Sig captured FSA's live page that day
# ("2026 Rates" table, May to Aug posted); those four months were typed from the
# capture into "screenshot" with FSA's own corn, hay and soybean meal, and are
# kept only while each feed cost is FSA's formula on its own prices (to the cent
# FSA prints) and milk minus feed is the margin. A later read of FSA's page wins
# a month only when it is at least as new as the capture: an archive copy counts
# from its snapshot date, a live read from the day it ran. Older never overwrites
# newer.
NOTE = ("Written by scripts/fetch_dmc.py from FSA's own DMC prices and updates page (live, or the Internet Archive copy "
        "named by archive_url and snapshot) and FSA's DMC fact sheet. A month is kept only when FSA's milk minus feed is "
        "FSA's margin and its all-milk matches the NASS month held; the rest are in withheld. The months under screenshot "
        "were read off a screen capture of FSA's live page on the date it names (with FSA's corn, hay and soybean meal, "
        "each feed cost checked against FSA's formula) and stay until a read of FSA's page at least as new has them. mpp "
        "holds MPP-Dairy (2014-2018), a different program with a different feed cost, from FSA's MPP calculations table.")


def shot_ok(r):
    """True when a captured row's feed cost is FSA's formula on its own corn, hay
    and soybean meal (1.0728, 0.0137, 0.00735, to the cent FSA prints) and its
    all-milk minus feed is its margin."""
    try:
        c, h, s, am, fd, mg = (float(r[k]) for k in ("corn", "hay", "sbm", "all_milk", "feed", "margin"))
    except (KeyError, TypeError, ValueError):
        return False
    return (min(c, h, s, am, fd) > 0 and abs(1.0728 * c + 0.0137 * h + 0.00735 * s - fd) <= 0.005
            and abs(am - fd - mg) <= 0.006)


def merge_shot(parsed, shot, vintage):
    """(parsed with the captured months added, shot block to keep or None).
    parsed = this run's read of FSA's page; vintage = how new that read is
    (YYYY-MM-DD). A captured month fills a month the read lacks, and replaces a
    month the read has only when the read is older than the capture. Months the
    read has at least as new are dropped from the block; a block left empty is
    dropped."""
    shot = shot if isinstance(shot, dict) else {}
    ms = shot.get("months") if isinstance(shot.get("months"), dict) else {}
    rd = shot.get("read") or ""
    if not ms or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", rd):
        return dict(parsed), None
    out, keep = dict(parsed), {}
    for k, r in sorted(ms.items()):
        if not (re.fullmatch(r"20\d\d-\d\d", k) and shot_ok(r)):
            continue
        if k in parsed and (vintage or "") >= rd:
            continue      # FSA's page as read is at least as new: it wins
        out[k] = {"all_milk": float(r["all_milk"]), "feed": float(r["feed"]), "margin": float(r["margin"])}
        keep[k] = r
    return dict(sorted(out.items())), (dict(shot, months=keep) if keep else None)


# ---------------------------------------------------------------- MPP (2014-2018)
MPP_FIRST, MPP_LAST = "2014-01", "2018-12"     # MPP-Dairy's program years
MPP_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
              "November", "December"]
MPP_ROW = re.compile(r"^(" + "|".join(MPP_MONTHS) + r")\s+(?:\d\s+)?(\d+\.\d+)\s+(\d+\.\d+)\s+(\d+\.\d+)\s+(\d+\.\d+)\s+"
                     r"(\d+\.\d+)\s+(-?\d+\.\d+)\b")
MPP_YEAR = re.compile(r"^\s{20,}(20[01]\d)\b")
MPP_NOTE = re.compile(r"\*At a milk margin \(all.milk price minus feed cost\) of less than \$8\.00 per cwt, payments are possible "
                      r"depending on the level of coverage chosen by the dairy operation\.")


def parse_mpp(text):
    """(rows, note) from FSA's 'Margin Protection Program (MPP) calculations'
    table (-layout text): {month_key: {corn, hay, sbm, all_milk, feed, margin}}
    for every row under a year heading, the year from the heading above it. A
    row is kept only when FSA's own feed cost is the MPP formula on its own
    prices (1.0728 x corn + 0.0137 x alfalfa hay + 0.00735 x soybean meal, to a
    millionth) and its margin is all-milk minus that feed cost. note = FSA's own
    footnote on when MPP could pay, word for word, or ''."""
    rows, yr = {}, None
    t = (text or "").replace("\u2010", "-")
    for line in t.splitlines():
        y = MPP_YEAR.match(line)
        if y:
            yr = y.group(1)
            continue
        m = MPP_ROW.match(line)
        if not (m and yr):
            continue
        corn, hay, sbm, milk, feed, mg = (float(x) for x in m.groups()[1:])
        if abs(1.0728 * corn + 0.0137 * hay + 0.00735 * sbm - feed) > 1e-6 or abs(milk - feed - mg) > 1e-6:
            continue
        rows["%s-%02d" % (yr, MPP_MONTHS.index(m.group(1)) + 1)] = {
            "corn": corn, "hay": hay, "sbm": sbm, "all_milk": milk, "feed": feed, "margin": mg}
    n = MPP_NOTE.search(re.sub(r"\s+", " ", t))
    return dict(sorted(rows.items())), (n.group(0).lstrip("*") if n else "")


def mpp_block(text):
    """The file's mpp record from the read: MPP years only, the months FSA's
    table did not have (or that did not check out) counted with the reason."""
    rows, note = parse_mpp(text)
    keep = {k: v for k, v in rows.items() if MPP_FIRST <= k <= MPP_LAST}
    if not keep:
        return {}
    miss, k = [], MPP_FIRST
    while k <= MPP_LAST:
        if k not in keep:
            miss.append(k)
        k = _mk_shift(k, 1)
    last = max(keep)
    why = []
    if any(m > last for m in miss):
        why.append("FSA's MPP table as read ends at %s %s" % (MPP_MONTHS[int(last[5:]) - 1], last[:4]))
    if any(m < last for m in miss):
        why.append("not in FSA's table as read, or its feed cost or margin did not check out")
    flat = re.sub(r"\s+", " ", (text or "").replace("\u2010", "-"))
    out = {"months": keep, "note": note,
           # FSA's own column head for the hay in MPP's feed cost, and its two-month pay periods
           "hay": "Alfalfa Hay" if re.search(r"\bAlfalfa Hay\b", flat) and not re.search(r"(?i)premium alfalfa", flat) else "",
           "pay_periods": bool(re.search(r"Payment periods", flat) and re.search("01 [-\u2013] January/February", flat)),
           "withheld": {"count": len(miss), "months": miss, "why": "; ".join(why)} if miss else {"count": 0}}
    return out


LEVEL_ROW = re.compile(r"^\s*\$(\d\.\d{2})\s+(None|\$\d\.\d{2,4}|N/A)\s+(None|\$\d\.\d{2,4}|N/A)\s*$", re.M)


def _rate(t):
    return 0.0 if t == "None" else None if t == "N/A" else float(t[1:])


def parse_premiums(text):
    """(premiums, discount) from the fact sheet's -layout text. premiums =
    {tier1: {"4.00": rate}, tier2: {...}, tier1_lb, as_of}; 'None' is no premium
    (0.0), 'N/A' a level FSA does not offer in that tier (null). discount = FSA's
    own sentence that carries the 25 percent, word for word, with its condition.
    Both empty unless all twelve levels $4.00 to $9.50 are in the table."""
    rows = {m.group(1): (_rate(m.group(2)), _rate(m.group(3))) for m in LEVEL_ROW.finditer(text or "")}
    want = ["%.2f" % (4 + 0.5 * i) for i in range(12)]
    prem = {}
    if all(k in rows for k in want):
        prem = {"tier1": {k: rows[k][0] for k in want}, "tier2": {k: rows[k][1] for k in want}}
        m = re.search(r"production history of (\d+) mil lbs\. or less", text)
        if m:
            prem["tier1_lb"] = int(m.group(1)) * 1000000
        m = re.search(r"\b(JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER) (20\d\d)\b", text)
        if m:
            prem["as_of"] = "%s %s" % (m.group(1).title(), m.group(2))
    flat = re.sub(r"\s+", " ", text or "")
    m = re.search(r"(A dairy operation that makes a one-time election [^.]*? will receive a 25 percent discount on premium rates\.)", flat)
    disc = {"text": m.group(1)} if m else {}
    return prem, disc


def parse_hay_notes(news_html, notice_text):
    """{blend: {text}, revision: {text}} from FSA's Jul 11, 2019 release and
    Notice DMC-53, only when their own words say so; the page quotes these."""
    out = {}
    if re.search(r"\b50 percent hay blend\b", _text(news_html or "")):
        out["blend"] = {"text": "a 50 percent hay blend, in FSA's words"}
    n = re.sub(r"\s+", " ", notice_text or "")
    if (re.search(r"amended and published in the Federal Register on December 1, 2021, to use premium alfalfa hay rather than "
                  r"blended alfalfa hay", n) and re.search(r"effective starting in January 2020", n)):
        out["revision"] = {"text": "FSA changed the feed cost to premium alfalfa in December 2021, back to January 2020, "
                                   "and recalculated those margins"}
    return out


def run(root=ROOT, now=None, get=None, pdf_text=None):
    import datetime
    import json
    import os
    now = now or datetime.datetime.now(datetime.timezone.utc)
    get = get or get_fsa
    p = Path(root) / OUT
    try:
        old = json.loads(p.read_text())
    except (OSError, ValueError):
        old = {}
    try:
        nass = (json.loads((Path(root) / "data/dairy-data.json").read_text()) or {}).get("all_milk") or {}
    except (OSError, ValueError):
        nass = {}
    at = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    body, err = get(MARGINS_URL)
    parsed = parse_margins(body.decode("utf-8", "replace")) if body else {}
    shot = old.get("screenshot")
    if parsed:
        v = VIA.get(MARGINS_URL, {"via": "live"})
        vintage = v.get("snapshot") if v.get("via") == "archive" else now.strftime("%Y-%m-%d")
        parsed, shot = merge_shot(parsed, shot, vintage)
    rows, held = confirm(parsed, nass)
    if not rows:
        why = err or ("no margins table found on the page" if body else "not read")
        print("::warning::DMC margins not refreshed: %s" % why)
        old["status"] = {"ok": False, "why": why[:200], "at": at}
        rec = old
    else:
        via = VIA.get(MARGINS_URL, {"via": "live"})
        rec = dict(old)
        for k in ("archive_url", "snapshot"):
            rec.pop(k, None)
        rec.update(via)
        rec.update(source="USDA Farm Service Agency, Dairy Margin Coverage prices and updates", source_url=MARGINS_URL,
                   read=now.strftime("%Y-%m-%d"), margins=rows, withheld=held, status={"ok": True, "at": at},
                   hay=parse_hay(body.decode("utf-8", "replace")))
        rec.pop("premium_tier1", None)
        if shot:
            rec["screenshot"] = shot
        else:
            rec.pop("screenshot", None)
        print("[dmc] %d months kept (%s to %s), %d withheld%s" % (
            len(rows), min(rows), max(rows), held["count"], (": " + held["why"]) if held["count"] else ""))
    from fetch_dairy import pdf_to_text
    to_text = pdf_text or (lambda b: pdf_to_text(b)[0])
    # The fact sheet and the two hay notices do not change month to month: read
    # once, then again only when the held copy is over 30 days old.
    stale = (rec.get("premiums") or {}).get("read", "") < (now - datetime.timedelta(days=30)).strftime("%Y-%m-%d")
    if stale:
        fb, ferr = get(FACTS_URL)
        t = to_text(fb) if fb and fb[:5] == b"%PDF-" else None
        prem, disc = parse_premiums(t or "")
        src = dict(VIA.get(FACTS_URL, {"via": "live"}), source_url=FACTS_URL, read=now.strftime("%Y-%m-%d"))
        if prem:
            rec["premiums"] = dict(prem, **src)
        if disc:
            rec["discount"] = dict(disc, **src)
        if not prem:
            print("::warning::DMC fact sheet: no premium table (%s)" % (ferr or ("read" if t else "not a PDF")))
    if not (rec.get("hay_notes") or {}).get("revision") or not (rec.get("hay_notes") or {}).get("blend"):
        nb, _e1 = get(NEWS_2019)
        pb, _e2 = get(NOTICE_53)
        nt = to_text(pb) if pb and pb[:5] == b"%PDF-" else ""
        notes = parse_hay_notes(nb.decode("utf-8", "replace") if nb else "", nt or "")
        for k, u in (("blend", NEWS_2019), ("revision", NOTICE_53)):
            if k in notes:
                notes[k].update(VIA.get(u, {"via": "live"}), source_url=u)
        if notes:
            rec["hay_notes"] = dict(rec.get("hay_notes") or {}, **notes)
    # MPP-Dairy, 2014-2018: history that does not change, read once (and again
    # only when the held copy is missing). A different program from DMC: kept
    # apart under "mpp", never in "margins".
    if not (rec.get("mpp") or {}).get("months"):
        mb, merr = get(MPP_URL)
        mt = to_text(mb) if mb and mb[:5] == b"%PDF-" else None
        blk = mpp_block(mt or "")
        if blk:
            rec["mpp"] = dict(blk, **VIA.get(MPP_URL, {"via": "live"}), source_url=MPP_URL, read=now.strftime("%Y-%m-%d"),
                              source="USDA Farm Service Agency, Margin Protection Program (MPP) calculations")
            print("[dmc] MPP: %d months (%s to %s), %d withheld" % (len(blk["months"]), min(blk["months"]),
                                                                  max(blk["months"]), blk["withheld"]["count"]))
        else:
            print("::warning::MPP table not read (%s)" % (merr or ("read" if mt else "not a PDF")))
    rec["_note"] = NOTE
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(rec, indent=1, sort_keys=True) + "\n")
    os.replace(tmp, p)
    return rec


def probe(root):
    print("FSA DMC probe")
    ix = dairy_probe.crawl(Path(root) / RAW, STARTS, ["fsa.usda.gov"], _follow, _keep, depth=2, max_files=25, get=get_fsa)
    for r in ix:
        r.update(VIA.get(r["url"], {}))
    import json as _j
    (Path(root) / RAW / "index.json").write_text(_j.dumps(ix, indent=1) + "\n")
    print("  %d urls, %d saved" % (len(ix), sum(1 for r in ix if r.get("file"))))
    return 0


def selftest():
    fails = []

    def ck(name, ok, detail=""):
        print(("  ok   " if ok else "  FAIL ") + name + ("  (%s)" % (detail,) if not ok and detail != "" else ""))
        if not ok:
            fails.append(name)

    pg = ("<h3>2026 DMC Margins</h3><table><tr><th>Month</th><th>All-Milk Price</th><th>Corn</th><th>Feed Cost</th>"
          "<th>Margin</th></tr><tr><td>January</td><td>$20.10</td><td>4.40</td><td>$10.50</td><td>$9.60</td></tr>"
          "<tr><td>February</td><td></td><td></td><td></td><td></td></tr></table>"
          "<table><caption>2019</caption><tr><th>Month</th><th>All Milk ($/cwt)</th><th>Total Feed Cost</th><th>Margin</th></tr>"
          "<tr><td>Dec</td><td>20.70</td><td>8.75</td><td>11.95</td></tr></table>")
    ck("margins tables: year from the heading or caption, empty months skipped",
       parse_margins(pg) == {"2019-12": {"all_milk": 20.7, "feed": 8.75, "margin": 11.95},
                             "2026-01": {"all_milk": 20.1, "feed": 10.5, "margin": 9.6}}, parse_margins(pg))
    rows, held = confirm({"2018-12": {"all_milk": 15.0, "feed": 9.0, "margin": 6.0},
                          "2019-01": {"all_milk": 16.6, "feed": 8.89, "margin": 7.71},
                          "2019-02": {"all_milk": 16.8, "feed": 8.89, "margin": 7.81},
                          "2019-04": {"all_milk": 17.7, "feed": 8.88, "margin": 8.82}},
                         {"month_key": "2019-04", "value": 17.7})
    ck("confirm: MPP months dropped, a month that does not add up withheld, a gap counted",
       list(rows) == ["2019-01", "2019-04"] and held["count"] == 2 and held["months"] == ["2019-02", "2019-03"]
       and "milk minus feed" in held["why"] and "not in the copy of FSA" in held["why"], (rows, held))
    rows, held = confirm({"2019-04": {"all_milk": 17.8, "feed": 8.88, "margin": 8.92}}, {"month_key": "2019-04", "value": 17.7})
    ck("confirm: FSA all-milk not the NASS month held is withheld", rows == {} and "NASS" in held["why"], held)
    fx = (ROOT / "test" / "fixtures" / "milk" / "fsa-dmc-prices-2026-04.html").read_text()
    real = parse_margins(fx)
    ck("FSA's page as read Oct 28: 88 months, Jan 2019 to Apr 2026", len(real) == 88 and min(real) == "2019-01"
       and max(real) == "2026-04", (len(real), min(real), max(real)))
    ck("...Jan 2019 16.60 - 8.89 = 7.71; Apr 2026 20.80 - 10.26 = 10.54",
       real["2019-01"] == {"all_milk": 16.6, "feed": 8.89, "margin": 7.71}
       and real["2026-04"] == {"all_milk": 20.8, "feed": 10.26, "margin": 10.54}, (real.get("2019-01"), real.get("2026-04")))
    ck("...every month's milk minus feed is its margin", all(abs(r["all_milk"] - r["feed"] - r["margin"]) <= 0.006 for r in real.values()))
    rr, hh = confirm(real, {"month_key": "2026-08", "value": 19.8})
    ck("...nothing past April is filled in: May to Aug 2026 (NASS has Aug) are counted as withheld",
       len(rr) == 88 and hh["count"] == 4 and hh["months"] == ["2026-05", "2026-06", "2026-07", "2026-08"], hh)
    hay = parse_hay(fx)
    ck("...hay as FSA heads it: blended alfalfa in 2019, premium alfalfa 2020 to 2026",
       hay.get("2019") == "Blended Alfalfa Hay" and all(hay.get(str(y)) == "Premium Alfalfa Hay" for y in range(2020, 2027)), hay)
    fs = (ROOT / "test" / "fixtures" / "milk" / "fsa-dmc-factsheet-2026-01.txt").read_text()
    pr, dc = parse_premiums(fs)
    ck("fact sheet Jan 2026: Tier 1 $9.50 = 0.150, $4.50 = 0.0025, $4.00 none (0)",
       pr.get("tier1", {}).get("9.50") == 0.15 and pr["tier1"]["4.50"] == 0.0025 and pr["tier1"]["4.00"] == 0.0, pr)
    ck("...Tier 2 $8.00 = 1.813, $8.50 to $9.50 not offered (null)",
       pr.get("tier2", {}).get("8.00") == 1.813 and all(pr["tier2"][k] is None for k in ("8.50", "9.00", "9.50")), pr.get("tier2"))
    ck("...Tier 1 is 6 million lb; dated January 2026", pr.get("tier1_lb") == 6000000 and pr.get("as_of") == "January 2026", pr)
    ck("...the discount in FSA's own words, with its condition",
       dc.get("text") == ("A dairy operation that makes a one-time election of coverage level and coverage percentage that are "
                          "applicable to each of calendar years 2026 through 2031 will receive a 25 percent discount on premium rates."), dc)
    ck("...a table missing a level gives nothing", parse_premiums(fs.replace("$9.00", "$9.05")) == ({}, dc))
    hn = parse_hay_notes((ROOT / "test" / "fixtures" / "milk" / "fsa-dmc-2019-news-blend.html").read_text(),
                         (ROOT / "test" / "fixtures" / "milk" / "fsa-dmc-53-head.txt").read_text())
    mt = (ROOT / "test" / "fixtures" / "milk" / "fsa-mpp-calculations-2018-07.txt").read_text()
    mr, mn = parse_mpp(mt)
    ck("MPP table (FSA, archived Jun 14, 2024): Jan 2014 23.50 - 10.800895 = 12.699105, Jul 2018 15.40 - 8.681854",
       mr.get("2014-01", {}).get("margin") == 12.699105 and mr["2014-01"]["all_milk"] == 23.5
       and mr.get("2018-07", {}).get("feed") == 8.681854, (mr.get("2014-01"), mr.get("2018-07")))
    ck("...the year comes from the heading above: Dec 2016 margin 11.100779, Sep 2013 7.9712135",
       mr.get("2016-12", {}).get("margin") == 11.100779 and mr.get("2013-09", {}).get("margin") == 7.9712135, mr.get("2016-12"))
    ck("...every row's feed cost is FSA's formula on its own prices", len(mr) == 59, len(mr))
    ck("...a row whose feed cost is not the formula is dropped",
       "2014-01" not in parse_mpp(mt.replace("10.80089500", "10.80189500"))[0])
    ck("...FSA's own note on when MPP could pay", mn.startswith("At a milk margin (all") and "less than $8.00 per cwt" in mn, mn)
    mb = mpp_block(mt)
    ck("...MPP years only (2014 to 2018): 55 months, Aug to Dec 2018 withheld as past the table's end",
       len(mb["months"]) == 55 and min(mb["months"]) == "2014-01" and max(mb["months"]) == "2018-07"
       and mb["withheld"]["months"] == ["2018-08", "2018-09", "2018-10", "2018-11", "2018-12"]
       and "ends at July 2018" in mb["withheld"]["why"], mb["withheld"])
    ck("...FSA's hay column is plain alfalfa hay, and MPP paid on two-month periods",
       mb["hay"] == "Alfalfa Hay" and mb["pay_periods"] is True, (mb["hay"], mb["pay_periods"]))
    ck("...nothing read, nothing kept", mpp_block("") == {})
    ck("hay notes: the 2019 blend and the Dec 2021 revision back to Jan 2020, from FSA's own words",
       set(hn) == {"blend", "revision"} and "50 percent hay blend" in hn["blend"]["text"], hn)
    ck("...nothing read, no notes", parse_hay_notes("", "") == {})
    # the whole run on the real reads, as through the archive, into a temp repo
    import datetime
    import json
    import tempfile
    docs = {MARGINS_URL: fx.encode(), FACTS_URL: b"%PDF-fs", NOTICE_53: b"%PDF-53", MPP_URL: b"%PDF-mpp",
            NEWS_2019: (ROOT / "test" / "fixtures" / "milk" / "fsa-dmc-2019-news-blend.html").read_bytes()}
    texts = {b"%PDF-fs": fs, b"%PDF-53": (ROOT / "test" / "fixtures" / "milk" / "fsa-dmc-53-head.txt").read_text(),
             b"%PDF-mpp": mt}

    def fget(u):
        if u in docs:
            VIA[u] = {"via": "archive", "archive_url": "https://web.archive.org/web/20260610000000/" + u, "snapshot": "2026-06-10"}
            return docs[u], None
        return None, "404"
    with tempfile.TemporaryDirectory() as d:
        (Path(d) / "data").mkdir()
        (Path(d) / "data" / "dairy-data.json").write_text(json.dumps({"all_milk": {"month_key": "2026-08", "value": 19.8}}))
        rec = run(d, now=datetime.datetime(2026, 10, 28, tzinfo=datetime.timezone.utc), get=fget, pdf_text=texts.get)
        ck("run: 88 months, 4 withheld, cited to the archive copy of Jun 10, 2026",
           len(rec.get("margins", {})) == 88 and rec["withheld"]["count"] == 4 and rec["via"] == "archive"
           and rec["snapshot"] == "2026-06-10" and rec["status"]["ok"], {k: rec.get(k) for k in ("withheld", "via", "status")})
        ck("...premiums, the discount sentence and both hay notes, each with its own source",
           rec["premiums"]["source_url"] == FACTS_URL and rec["discount"]["source_url"] == FACTS_URL
           and rec["hay_notes"]["revision"]["source_url"] == NOTICE_53 and rec["hay"]["2019"] == "Blended Alfalfa Hay", rec.get("hay_notes"))
        ck("...MPP kept apart from the DMC margins, cited to its own FSA file",
           len(rec["mpp"]["months"]) == 55 and rec["mpp"]["source_url"] == MPP_URL and not any(k < "2019" for k in rec["margins"]),
           {k: rec.get("mpp", {}).get(k) for k in ("source_url", "via")})
        rec2 = run(d, now=datetime.datetime(2026, 10, 29, tzinfo=datetime.timezone.utc), get=lambda u: (None, "timeout"))
        ck("...a failed read keeps the last good file and says why",
           len(rec2["margins"]) == 88 and rec2["status"]["ok"] is False and "timeout" in rec2["status"]["why"], rec2.get("status"))
    # months read off Sig's Oct 28 screen capture of FSA's live page (2026 Rates table)
    cap = {"2026-05": (4.48, 247.00, 338.72, 21.30, 10.68, 10.62), "2026-06": (4.28, 239.00, 319.68, 21.10, 10.22, 10.88),
           "2026-07": (4.26, 242.00, 337.96, 20.30, 10.37, 9.93), "2026-08": (4.45, 243.00, 320.30, 19.80, 10.46, 9.34)}
    shot = {"read": "2026-10-28", "via": "screenshot", "source_url": MARGINS_URL,
            "months": {k: dict(zip(("corn", "hay", "sbm", "all_milk", "feed", "margin"), v)) for k, v in cap.items()}}
    ck("capture: each feed cost is FSA's formula on its own corn, hay and meal, milk minus feed the margin",
       all(shot_ok(r) for r in shot["months"].values()))
    ck("...a typo in the capture (corn 4.84 for 4.48) fails the formula",
       not shot_ok(dict(shot["months"]["2026-05"], corn=4.84)))
    ck("...a typo in the margin fails", not shot_ok(dict(shot["months"]["2026-08"], margin=9.43)))
    mp, ks = merge_shot(real, shot, "2026-06-10")
    ck("an Apr 2026 archive read plus the capture: 92 months to Aug 2026, nothing withheld",
       len(mp) == 92 and max(mp) == "2026-08" and confirm(mp, {"month_key": "2026-08", "value": 19.8})[1] == {"count": 0}
       and mp["2026-08"] == {"all_milk": 19.8, "feed": 10.46, "margin": 9.34} and sorted(ks["months"]) == sorted(cap), len(mp))
    old_may = dict(real, **{"2026-05": {"all_milk": 21.2, "feed": 10.68, "margin": 10.52}})
    mp, ks = merge_shot(old_may, shot, "2026-06-10")
    ck("...an older read (archive of Jun 10) never overwrites the newer capture",
       mp["2026-05"]["margin"] == 10.62 and "2026-05" in ks["months"], mp["2026-05"])
    mp, ks = merge_shot(old_may, shot, "2026-11-02")
    ck("...a read at least as new wins its month, and that month leaves the capture block",
       mp["2026-05"]["margin"] == 10.52 and "2026-05" not in ks["months"] and len(ks["months"]) == 3)
    every = dict(real, **{k: {"all_milk": v[3], "feed": v[4], "margin": v[5]} for k, v in cap.items()})
    ck("...a read as new with all four months drops the block",
       merge_shot(every, shot, "2026-10-28") == (dict(sorted(every.items())), None))
    ck("...no capture, nothing added", merge_shot(real, None, "2026-06-10") == (dict(real), None))
    bad = {"read": "2026-10-28", "months": {"2026-05": dict(shot["months"]["2026-05"], feed=10.86)}}
    ck("...a captured month that fails the check is not used", merge_shot(real, bad, "2026-06-10") == (dict(real), None))
    with tempfile.TemporaryDirectory() as d:
        (Path(d) / "data").mkdir()
        (Path(d) / "data" / "dairy-data.json").write_text(json.dumps({"all_milk": {"month_key": "2026-08", "value": 19.8}}))
        (Path(d) / "data" / "dairy-dmc.json").write_text(json.dumps({"screenshot": shot}))
        rec = run(d, now=datetime.datetime(2026, 10, 29, tzinfo=datetime.timezone.utc), get=fget, pdf_text=texts.get)
        ck("run: the archive copy of Jun 10 ends at April, the Oct 28 capture's four months stay, none withheld",
           len(rec["margins"]) == 92 and rec["withheld"] == {"count": 0} and rec["margins"]["2026-07"]["margin"] == 9.93
           and sorted(rec["screenshot"]["months"]) == sorted(cap) and rec["snapshot"] == "2026-06-10", rec.get("withheld"))
        rec2 = run(d, now=datetime.datetime(2026, 10, 30, tzinfo=datetime.timezone.utc), get=lambda u: (None, "timeout"))
        ck("...a failed read keeps them", len(rec2["margins"]) == 92 and rec2["screenshot"] == rec["screenshot"])
        e = '<td style="text-align:center;">&nbsp;</td>'
        newer = fx.replace("<tr><td>May</td>" + e * 6, "<tr><td>May</td>" + "".join(
            "<td>%s</td>" % x for x in ("4.48", "247.00", "338.72", "21.40", "10.68", "10.72")), 1)
        ck("...(the test page has May filled in the 2026 table)", parse_margins(newer).get("2026-05", {}).get("margin") == 10.72)

        def lget(u):
            if u == MARGINS_URL:
                VIA[u] = {"via": "live"}
                return newer.encode(), None
            return fget(u)
        rec3 = run(d, now=datetime.datetime(2026, 11, 2, tzinfo=datetime.timezone.utc), get=lget, pdf_text=texts.get)
        ck("...a live read on Nov 2 that has May wins May; June to Aug stay from the capture",
           rec3["margins"]["2026-05"]["margin"] == 10.72 and sorted(rec3["screenshot"]["months"]) == ["2026-06", "2026-07", "2026-08"]
           and len(rec3["margins"]) == 92, (rec3["margins"].get("2026-05"), sorted(rec3.get("screenshot", {}).get("months", {}))))
    VIA.clear()
    LIVE["down"] = False
    ck("probe keeps DMC files", _keep("https://www.fsa.usda.gov/x/DMC-Margin-2026.xlsx"))
    ck("probe skips unrelated files", not _keep("https://www.fsa.usda.gov/x/loan-rates.pdf"))
    ck("probe follows DMC pages only", _follow("https://www.fsa.usda.gov/resources/programs/dairy-margin-coverage-program/x")
       and not _follow("https://www.fsa.usda.gov/resources/programs/arc-plc"))
    seen = []
    u = "https://www.fsa.usda.gov/dairy"
    b, e = get_fsa(u, direct=lambda x: (None, "timeout"),
                   archive=lambda x: (seen.append(x) or b"<html>", None),
                   avail=lambda x: (b'{"archived_snapshots":{"closest":{"timestamp":"20261015083000","available":true}}}', None))
    ck("a timed-out FSA page is read from the archive copy of the same URL, at the snapshot the archive names",
       b == b"<html>" and seen == ["https://web.archive.org/web/20261015083000id_/" + u])
    ck("the archive copy is cited with its URL and snapshot date",
       VIA.get(u) == {"via": "archive", "archive_url": "https://web.archive.org/web/20261015083000/" + u, "snapshot": "2026-10-15"})
    b, e = get_fsa(u, direct=lambda x: (None, "timeout"), archive=lambda x: (b"x", None),
                   avail=lambda x: (b'{"archived_snapshots":{}}', None))
    ck("no snapshot means no page, not a guess", b is None and "archive" in e)
    tried = []
    b, e = get_fsa(u + "/x", direct=lambda x: (tried.append(x), (b"<html>", None))[1], archive=lambda x: (None, "404"),
                   avail=lambda x: (b"{}", None))
    ck("after a live timeout, the rest of the run skips the live site", tried == [] and LIVE["down"])
    LIVE["down"] = False
    print("fetch_dmc selftest: %s" % ("PASS" if not fails else "FAIL (%d)" % len(fails)))
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
