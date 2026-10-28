#!/usr/bin/env python3
"""One way to GET a USDA AMS report, used by every AMS reader.

Why: from about Oct 27 2026 22:30 UTC the GitHub runners stopped resolving
www.ams.usda.gov ("Temporary failure in name resolution") while the site
itself kept serving. The same files are served under other USDA host names
(MIRRORS below, measured from a runner: scripts/ams_host_check.sh, run in the
hay-ams probe). get() asks www.ams.usda.gov first, then each mirror, same path.

A mirror's answer is used only when it is the same report:
  * a .pdf path must come back as a PDF (%PDF- magic), never a web page;
  * the PDF's own text must carry the AMS Market News heading (or the caller's
    `expect` pattern, e.g. the report's title), checked here before return.
The callers keep their own title checks on top. Which host served a file is
printed ("[ams] <path> from <host>") and kept in LAST["host"].

    python3 scripts/ams_http.py --selftest
"""
import re
import sys
import time
import urllib.parse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fetch_dairy as FD  # noqa: E402

PRIMARY = "www.ams.usda.gov"
# Hosts that served /mnreports/AMS_2162.pdf as the real PDF from a runner (see the module note).
# Measured Oct 28 2026 13:27 UTC (hay-ams probe run 40696460355), GET /mnreports/AMS_2162.pdf:
#   www.ams.usda.gov        200, 247,647 bytes, %PDF   (resolving again by then)
#   ams-prod.azureedge.us   200, 247,647 bytes, %PDF   (the same file, USDA's Azure front door)
#   ams.prod.usda.gov       no DNS answer from the runner, 1.1.1.1 or 8.8.8.8
#   usda.azureedge.us       404, a web page (the USDA main site, not AMS)
#   mymarketnews / marsapi  no connection / 404 (no /mnreports there)
MIRRORS = ("ams-prod.azureedge.us",)
AMS_HOSTS = {PRIMARY, "ams.usda.gov"}
DEFAULT_EXPECT = re.compile(r"Market\s+News|Agricultural\s+Marketing\s+Service", re.I)
WEB_PAGE_RE = re.compile(rb"<html|<!doctype|captcha|access denied", re.I)
LAST = {"host": None, "tried": []}


def candidates(url, mirrors=MIRRORS):
    """[url, mirror urls...]. Only a www.ams.usda.gov URL gets mirrors; any other URL is itself only."""
    p = urllib.parse.urlsplit(url)
    if (p.hostname or "").lower() not in AMS_HOSTS:
        return [url]
    out = [url]
    for h in mirrors:
        out.append(urllib.parse.urlunsplit((p.scheme or "https", h, p.path, p.query, p.fragment)))
    return out


def same_report(url, raw, expect=None, to_text=None):
    """None when `raw` is the report `url` names, else the reason it is not."""
    if raw is None:
        return "empty"
    path = urllib.parse.urlsplit(url).path.lower()
    if path.endswith(".pdf"):
        if raw[:5] != b"%PDF-":
            return "not a PDF" + (" (a web page)" if WEB_PAGE_RE.search(raw[:2000]) else "")
        text, err = (to_text or FD.pdf_to_text)(raw)
        if not text:
            return "no text in the PDF (%s)" % err
    else:
        if WEB_PAGE_RE.search(raw[:2000]) and not (expect and re.search(expect, raw.decode("utf-8", "replace"))):
            return "a web page, not the report"
        text = raw.decode("utf-8", "replace")
    pat = expect if expect is not None else DEFAULT_EXPECT
    if not re.search(pat, text):
        return "not the same report (%s not in its text)" % getattr(pat, "pattern", pat)
    return None


def get(url, headers=None, tries=3, timeout=30, expect=None, mirrors=MIRRORS,
        http_get=None, to_text=None, log=print, sleep=time.sleep):
    """(bytes, None) or (None, error), like fetch_dairy.http_get, trying the mirrors when
    www.ams.usda.gov fails or answers with something that is not the report."""
    http_get = http_get or (lambda u: FD.http_get(u, headers=headers, tries=tries, timeout=timeout, sleep=sleep))
    LAST["host"], LAST["tried"] = None, []
    urls = candidates(url, mirrors)
    errs, primary_page = [], None
    for i, u in enumerate(urls):
        host = urllib.parse.urlsplit(u).hostname
        raw, err = http_get(u)
        LAST["tried"].append(host)
        if raw is None:
            errs.append("%s: %s" % (host, err))
            continue
        if i == 0:
            # the primary is used as it answers (the callers judge it, as before); only a web page
            # where a PDF should be sends us on to a mirror
            if len(urls) > 1 and u.lower().split("?")[0].endswith(".pdf") and raw[:5] != b"%PDF-":
                errs.append("%s: not a PDF" % host)
                primary_page = raw
                continue
            LAST["host"] = host
            return raw, None
        why = same_report(url, raw, expect, to_text)
        if why:
            errs.append("%s: %s" % (host, why))
            continue
        LAST["host"] = host
        log("[ams] %s from %s (%s)" % (urllib.parse.urlsplit(url).path, host, errs[0] if errs else "primary skipped"))
        return raw, None
    if primary_page is not None:
        # no mirror had the report: hand back what the primary said, so the caller reports it as before
        LAST["host"] = urllib.parse.urlsplit(url).hostname
        return primary_page, None
    return None, "; ".join(errs) or "no host tried"


# ---------------------------------------------------------------- selftest
FIX = Path(__file__).resolve().parent.parent / "test" / "fixtures" / "ams-http"


def selftest():
    fails = []

    def ck(name, ok, detail=""):
        print(("  ok   " if ok else "  FAIL ") + name + (f"  ({detail})" if not ok and detail else ""))
        if not ok:
            fails.append(name)

    pdf = (FIX / "ams_2162-head.pdf").read_bytes()
    report_text = (FIX / "ams_2162-text.txt").read_text()
    other_text = (FIX / "not-ams-text.txt").read_text()
    page = (FIX / "web-page.html").read_bytes()
    texts = {pdf: report_text}
    to_text = lambda raw: (texts.get(raw), None if raw in texts else "no text")  # noqa: E731
    url = "https://www.ams.usda.gov/mnreports/AMS_2162.pdf"
    # the order logic is checked with two mirrors: the real one, then a second stand-in
    M = MIRRORS + ("second-mirror.test",)

    def get_(u, **kw):
        return get(u, mirrors=M, **kw)

    def fake(answers):
        calls = []

        def hg(u):
            calls.append(urllib.parse.urlsplit(u).hostname)
            return answers.get(urllib.parse.urlsplit(u).hostname, (None, "Temporary failure in name resolution"))
        return hg, calls

    ck("candidates: www first, then each mirror in order, same path",
       candidates(url, M) == [url] + ["https://%s/mnreports/AMS_2162.pdf" % h for h in M], candidates(url, M))
    ck("the measured mirror is in the default list, www is not", candidates(url)[1:] == ["https://ams-prod.azureedge.us/mnreports/AMS_2162.pdf"])
    ck("lower-case ams_<n>.pdf paths keep their case", candidates(url.replace("AMS_", "ams_"))[1].endswith("/ams_2162.pdf"))
    ck("candidates: a non-AMS URL is not sent to the mirrors", candidates("https://www.nass.usda.gov/x.pdf") == ["https://www.nass.usda.gov/x.pdf"])
    ck("candidates: the query is kept", candidates("https://www.ams.usda.gov/a?b=1")[1].endswith("/a?b=1"))

    logs = []
    hg, calls = fake({PRIMARY: (pdf, None)})
    raw, err = get_(url, http_get=hg, to_text=to_text, log=logs.append)
    ck("primary answers: used, no mirror asked", raw == pdf and calls == [PRIMARY] and LAST["host"] == PRIMARY, calls)

    hg, calls = fake({M[0]: (pdf, None)})
    raw, err = get_(url, http_get=hg, to_text=to_text, log=logs.append)
    ck("primary down: the first mirror serves it", raw == pdf and calls == [PRIMARY, M[0]] and LAST["host"] == M[0], calls)
    ck("the serving host is logged", logs and M[0] in logs[-1] and "AMS_2162.pdf" in logs[-1], logs)

    hg, calls = fake({M[0]: (page, None), M[1]: (pdf, None)})
    raw, err = get_(url, http_get=hg, to_text=to_text, log=logs.append)
    ck("a mirror's web page is refused, the next mirror tried", raw == pdf and LAST["host"] == M[1], (calls, LAST))

    other_pdf = b"%PDF-1.7 other"
    texts[other_pdf] = other_text
    hg, calls = fake({M[0]: (other_pdf, None), M[1]: (other_pdf, None)})
    raw, err = get_(url, http_get=hg, to_text=to_text, log=logs.append)
    ck("a PDF that is not an AMS report is refused everywhere", raw is None and "not the same report" in (err or ""), err)
    ck("the error names every host", all(h in err for h in (PRIMARY,) + M), err)

    hg, calls = fake({M[0]: (pdf, None)})
    raw, err = get_(url, http_get=hg, to_text=to_text, expect=r"Valentine Livestock", log=logs.append)
    ck("the caller's own title check refuses another barn's report", raw is None, err)
    raw, err = get_(url, http_get=hg, to_text=to_text, expect=r"Bloomfield Livestock Feeder Cattle", log=logs.append)
    ck("the caller's own title check passes the right report", raw == pdf, err)

    hg, calls = fake({PRIMARY: (page, None), M[0]: (pdf, None)})
    raw, err = get_(url, http_get=hg, to_text=to_text, log=logs.append)
    ck("primary sends a web page for a PDF: a mirror's real PDF is used", raw == pdf and LAST["host"] == M[0], LAST)
    hg, calls = fake({PRIMARY: (page, None)})
    raw, err = get_(url, http_get=hg, to_text=to_text, log=logs.append)
    ck("primary web page and no mirror: the page is handed back for the caller to report", raw == page and err is None)

    hg, calls = fake({})
    raw, err = get_(url, http_get=hg, to_text=to_text, log=logs.append)
    ck("every host down: None and every host tried", raw is None and calls == [PRIMARY] + list(M), calls)

    hg, calls = fake({})
    raw, err = get_("https://www.nass.usda.gov/x.pdf", http_get=hg, to_text=to_text, log=logs.append)
    ck("a non-AMS URL is fetched once", calls == ["www.nass.usda.gov"], calls)

    ck("same_report: the real report passes", same_report(url, pdf, to_text=to_text) is None)
    ck("same_report: a web page fails", "web page" in (same_report(url, page, to_text=to_text) or ""))
    print("ams_http selftest: %s" % ("FAIL %d" % len(fails) if fails else "all ok"))
    return 1 if fails else 0


if __name__ == "__main__":
    if "--selftest" in sys.argv[1:]:
        sys.exit(selftest())
    print("usage: ams_http.py --selftest")
    sys.exit(2)
