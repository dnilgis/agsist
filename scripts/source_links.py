#!/usr/bin/env python3
"""Direct links to data sources: which ones a page may not carry (Sig, Oct 29, 2026).

A page names its source in plain text with the date ("Source: USDA NASS, Oct 2026") and does not
link straight at the data: no API endpoints, CSV/ZIP/XLSX/PDF downloads, report or dataset pages,
query URLs or feeds. Links that are not data sources stay: a reader's action page (an FSA sign-up
or deadline page), articles, law, licence notices, our own pages. Two links are kept on purpose
(Sig, Oct 29): the K-State land values book on the Kansas county lines and the Farm Credit reserve
bank survey pages.

  python3 scripts/source_links.py --scan FILE...   list the data-source links in these files; exit 1 if any
  python3 scripts/source_links.py --selftest

Builders and the test import is_data_source() / unlink(); there is one definition.
"""
import html as _html
import re
import sys

DATA_SOURCE = re.compile(r'''pubfs-rma\.fpac|quickstats\.nass|nass\.usda\.gov/(Statistics|Publications|Quick|Charts|Data|Surveys|Research|AgCensus|Newsroom/Executive)|agtransport\.usda|cftc\.gov|apps\.fas\.usda|droughtmonitor|mesonet|ncei\.noaa|rcc-acis|prism\.oregonstate|mymarketnews|ams\.usda\.gov/(mnreports|market-news|sites/default/files|services/transportation-analysis)|api\.weather\.gov|weather\.gov/documentation|cpc\.ncep|finance\.yahoo|sec\.gov/(cgi-bin|Archives|edgar|files|data-research)|efts\.sec|usda\.library\.cornell|esmis|public-rma|rma\.usda\.gov/sites/default/files|webapp\.rma|ers\.usda\.gov/(data|sites/default/files)|data\.ers|usda\.gov/oce/commodity|usda\.gov/about-usda/.*wasde|usda\.gov/media/agency-reports|nrcs\.usda\.gov/resources/data|websoilsurvey|cocorahs\.org|tradingview|barchart|eia\.gov|fred\.stlouisfed|census\.gov|bls\.gov|\.csv\b|\.zip\b|\.xlsx?\b|\.pdf\b|/pdf/|nssl\.noaa|naturalearthdata|usgs\.gov/3d|waterdata\.usgs|data\.illinois|equitycoop\.com|centrallivestock|bloomingtonlivestock|kalonasalesbarn|premierlivestock|rockcreeklivestock|lanesborosales|pipestonelivestock|bartlettco-op|mccunecoop|mulvanecoop|tworiversks|fsa\.usda\.gov/(resources/programs/arc-plc/program-data|resources/programs/dairy-margin-coverage-program-dmc/prices|resources/economic-policy-analysis/afida|programs-and-services/price-support|tools/informational/rates|print/pdf|Assets|Internet)|sco\.wisc\.edu/parcels/data|govinfo\.gov/bulkdata|fmma30|fmmacentral|statcan\.gc\.ca|gov\.br/conab|polymarket\.com|dataspace\.copernicus|fws\.gov/program/national-wetlands|fema\.gov/flood-maps|weedscience\.org|nominatim|mda\.state\.mn\.us/protecting/soilprotection/soiltemp|wisconet|ksrevenue\.gov|psc\.nebraska\.gov|ndda\.nd\.gov|datcp\.wi\.gov|land\.nd\.gov|uscourts\.gov|shawneefeed|nass\.usda\.gov/Publications''', re.I)
KEEP = re.compile(r'''public-rma\.fpac\.usda\.gov/apps/PRF/?$|agmanager\.info/land-leasing/land-buying-valuing/.*land-values-book|kansascityfed|stlouisfed\.org/?$|minneapolisfed|chicagofed|dallasfed|richmondfed|creativecommons|openstreetmap\.org/copyright|usgs\.gov/faqs|cmegroup\.com/.*contractSpecs''', re.I)
ANCHOR = re.compile(r'''<a\b[^<>]*?href\s*=\s*(\\?["'])(https?://[^"'\\]+)\1[^<>]*>(.*?)</a\s*>''', re.I | re.S)


def is_data_source(url):
    """True for a link straight at a data source (dataset, report, download, API, feed, query)."""
    u = _html.unescape(url or "")
    if not re.match(r"https?://", u, re.I) or re.match(r"https?://([a-z0-9-]+\.)*agsist\.com", u, re.I):
        return False
    return bool(DATA_SOURCE.search(u)) and not KEEP.search(u)


def link(url, text_html, attrs=""):
    """An <a> for a link that may stay, else the text alone (text_html is already escaped)."""
    if is_data_source(url):
        return text_html
    return '<a href="%s"%s>%s</a>' % (_html.escape(url, quote=True), attrs, text_html)


def unlink(page):
    """Every data-source <a> in a page or fragment replaced by its text."""
    return ANCHOR.sub(lambda m: m.group(3) if is_data_source(m.group(2)) else m.group(0), page)


def scan(text):
    return [m.group(2) for m in ANCHOR.finditer(text) if is_data_source(m.group(2))]


def selftest():
    bad = ["https://quickstats.nass.usda.gov/results/?commodity_desc=CORN", "https://www.fsa.usda.gov/sites/default/files/2026-10/2026_ARC_CO.xlsx",
           "https://api.weather.gov", "https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm",
           "https://agtransport.usda.gov/d/deqi-uken", "https://www.rcc-acis.org/", "https://mymarketnews.ams.usda.gov/viewReport/3357",
           "https://www.eia.gov/petroleum/ethanolcapacity/", "https://www.usda.gov/oce/commodity/wasde/wasde1026.pdf"]
    good = ["https://agsist.com/rain", "/prf", "https://www.fsa.usda.gov/resources/programs/arc-plc",
            "https://www.agmanager.info/land-leasing/land-buying-valuing/2025-kansas-land-values-book",
            "https://www.kansascityfed.org/center-for-agriculture-and-the-economy/ag-credit-survey/",
            "https://creativecommons.org/licenses/by/4.0/", "https://farmdocdaily.illinois.edu/2026/09/illinois-crop-budgets-for-2027.html",
            "https://www.ecfr.gov/current/title-7/subtitle-B/chapter-XIV/subchapter-B/part-1416"]
    fails = [u for u in bad if not is_data_source(u)] + [u for u in good if is_data_source(u)]
    s = 'Source: <a href="https://www.cftc.gov/x.htm" target="_blank">CFTC</a>, Oct 24 and <a href="/cot">our page</a>'
    if unlink(s) != 'Source: CFTC, Oct 24 and <a href="/cot">our page</a>':
        fails.append("unlink: " + unlink(s))
    if link("https://api.weather.gov", "NWS") != "NWS" or 'href="https://agsist.com/x"' not in link("https://agsist.com/x", "x"):
        fails.append("link()")
    if scan(s) != ["https://www.cftc.gov/x.htm"]:
        fails.append("scan")
    print("source_links selftest:", "FAIL " + "; ".join(fails) if fails else "ok")
    return not fails


if __name__ == "__main__":
    a = sys.argv[1:]
    if a[:1] == ["--selftest"]:
        sys.exit(0 if selftest() else 1)
    if a[:1] == ["--scan"]:
        n = 0
        for f in a[1:]:
            for u in scan(open(f, encoding="utf-8", errors="replace").read()):
                print("%s: %s" % (f, u)); n += 1
        print("data-source links: %d in %d files" % (n, len(a) - 1))
        sys.exit(1 if n else 0)
    print(__doc__); sys.exit(2)
