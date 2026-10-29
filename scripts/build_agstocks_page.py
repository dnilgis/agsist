#!/usr/bin/env python3
"""build_agstocks_page.py -- ag-stocks.html (/ag-stocks) from data/agstocks/*.json.

Every number baked into the page comes from a stored file with its date:
  closes and day changes   latest.json (built from closes/<year>.json rows), "Yahoo Finance, delayed"
  index levels             index.json (rebuilt from the same rows by agstocks_index.build)
  last report, revenue     sec.json (SEC EDGAR submissions and XBRL companyfacts), "whole company"
  plants                   plants.json (operator-name matches in the Oct 28 plant lists)
Company detail (the five-line read and "plants near you") is filled on tap by
components/agstocks.js from sec.json, latest.json and plants.json; nothing bulky is in the HTML.

    python3 scripts/build_agstocks_page.py            # write ag-stocks.html
    python3 scripts/build_agstocks_page.py --check    # exit 1 if the page is stale
    python3 scripts/build_agstocks_page.py --selftest # formatting and the pending / held states
"""
import html
import json
import os
import re
import sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
DIR = os.path.join(ROOT, "data", "agstocks")
PAGE = os.path.join(ROOT, "ag-stocks.html")
URL = "https://agsist.com/ag-stocks"
JS_V = "1"
TITLE = "Ag stocks today: farm company share prices and the AGSIST Ag 20"
DESC = ("Closing share prices for U.S.-listed farm equipment, fertilizer, grain, livestock and food companies, "
        "their latest SEC reports and revenue against a year ago, and the AGSIST Ag 20 index. Not investment advice.")
YAHOO = '<a href="https://finance.yahoo.com/" rel="noopener">Yahoo Finance</a>, delayed'
SEC = '<a href="https://www.sec.gov/edgar/search/" rel="noopener">SEC EDGAR</a>'
MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
GROUP_IDS = {"Equipment": "equipment", "Crop inputs": "inputs", "Grain and processing": "grain",
             "Livestock and animal health": "livestock", "Food and produce": "food",
             "Farmland and lenders": "land", "Farm retail": "retail"}
KIND_WORD = {"ethanol": "ethanol", "crush": "soybean crush", "export": "export elevator", "rail": "rail shuttle elevator"}


def rd(name, default=None):
    try:
        with open(os.path.join(DIR, name), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def esc(s):
    return html.escape(str(s), quote=True)


def day(d, year=False):
    """'2026-10-29' -> 'Oct 29' (or 'Oct 29, 2026')."""
    if not d:
        return ""
    y, m, dd = int(d[:4]), int(d[5:7]), int(d[8:10])
    return f"{MON[m - 1]} {dd}" + (f", {y}" if year else "")


def money(v):
    return f"${v:,.2f}"


def pct(p, digits=1):
    if p is None:
        return ""
    s = f"{abs(p):.{digits}f}%"
    return ("+" if p > 0 else "−" if p < 0 else "") + s


def big(v):
    a = abs(v)
    sign = "−" if v < 0 else ""
    if a >= 1e9:
        return f"{sign}${a / 1e9:,.2f} billion"
    if a >= 1e6:
        return f"{sign}${a / 1e6:,.1f} million"
    return f"{sign}${a:,.0f}"


def et_time(iso_utc):
    """'2026-10-29T22:17:00Z' -> 'Oct 29, 6:17 p.m. ET'."""
    from zoneinfo import ZoneInfo
    dt = datetime.strptime(iso_utc, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).astimezone(ZoneInfo("America/New_York"))
    h = dt.hour % 12 or 12
    return f"{MON[dt.month - 1]} {dt.day}, {h}:{dt.minute:02d} {'a.m.' if dt.hour < 12 else 'p.m.'} ET"


def rev_change(rec):
    r = (rec or {}).get("rev") or {}
    cur, prior = r.get("cur"), r.get("prior")
    if not cur or not prior or not prior.get("val"):
        return None
    return (cur["val"] / prior["val"] - 1) * 100, cur, prior


def last_report(rec):
    """The newer of the latest periodic report and the latest earnings release (8-K 2.02)."""
    c = [x for x in ((rec or {}).get("periodic"), (rec or {}).get("earnings")) if x]
    return max(c, key=lambda x: x["filed"]) if c else None


def sparkline(levels, w=280, h=48):
    pts = [x["v"] for x in levels]
    if len(pts) < 2:
        return ""
    lo, hi = min(pts), max(pts)
    span = (hi - lo) or 1.0
    xy = " ".join(f"{i * (w - 4) / (len(pts) - 1) + 2:.1f},{h - 4 - (v - lo) / span * (h - 8):.1f}" for i, v in enumerate(pts))
    first, last = levels[0], levels[-1]
    return (f'<svg class="ags-spark" viewBox="0 0 {w} {h}" role="img" aria-label="AGSIST Ag 20 since {esc(day(first["d"]))}: '
            f'{first["v"]:,.2f} to {last["v"]:,.2f}"><polyline fill="none" stroke="currentColor" stroke-width="2" points="{xy}"/></svg>')


def index_block(ix, latest):
    """The first screen: the Ag 20 level and day change, or 'starts Nov 2'."""
    a = (ix or {}).get("ix", {}).get("ag20") or {}
    status = a.get("status") or "pending"
    if status == "pending" or not a.get("levels"):
        return ('<section class="ags-ix" aria-labelledby="h-ix"><h2 id="h-ix">AGSIST Ag 20</h2>'
                '<p class="ags-big">Starts Nov 2</p></section>')
    if status == "suppressed":
        return ('<section class="ags-ix" aria-labelledby="h-ix"><h2 id="h-ix">AGSIST Ag 20</h2>'
                f'<p class="ags-big ags-muted">Not published</p><p class="ags-note">{esc(a.get("why", ""))}</p></section>')
    last = a["levels"][-1]
    if last.get("held"):
        why = "; ".join(f"no close for {t} since {day(d)}" for t, d in last["why"])
        chg = f'<span class="ags-held">held: {esc(why)}</span>'
    elif last.get("chg") is None:
        chg = '<span class="ags-muted">base day</span>'
    else:
        cls = "up" if last["chg"] > 0 else "dn" if last["chg"] < 0 else ""
        chg = f'<span class="ags-chg {cls}">{pct(last["chg"], 2)}</span>'
        if last.get("since"):
            chg += f' <span class="ags-muted">since {esc(day(last["since"]))}</span>'
    stale = ""
    if last.get("stale"):
        stale = f'<p class="ags-note">Last close carried for {esc(", ".join(last["stale"]))} (no close posted {esc(day(last["d"]))}).</p>'
    sides = []
    for k in ("input", "demand"):
        s = (ix.get("ix") or {}).get(k) or {}
        if s.get("status") == "live" and s.get("levels"):
            sl = s["levels"][-1]
            c = "held" if sl.get("held") else pct(sl.get("chg"), 2) if sl.get("chg") is not None else "base day"
            sides.append(f'<li><b>{esc(s["name"])}</b> {sl["v"]:,.2f} <span class="ags-muted">{esc(c)}</span></li>')
        else:
            sides.append(f'<li><b>{esc(s.get("name") or k)}</b> <span class="ags-muted">'
                         f'{"starts Nov 2" if s.get("status") in (None, "pending") else "not published"}</span></li>')
    return ('<section class="ags-ix" aria-labelledby="h-ix"><h2 id="h-ix">AGSIST Ag 20</h2>'
            f'<p class="ags-big" data-ix="{last["v"]:.2f}" data-d="{esc(last["d"])}">{last["v"]:,.2f} {chg}</p>'
            f'<p class="ags-note">{esc(day(last["d"], True))} close, {last["n"]} companies, base 1,000.00 on {esc(day(a["base"], True))}. Price return.</p>'
            f'{stale}{sparkline(a["levels"])}'
            f'<ul class="ags-sides">{"".join(sides)}</ul>'
            '<p class="ags-note">Side baskets: share prices of suppliers / buyers, not fertilizer or grain prices.</p>'
            f'<p class="ags-src">Closes: {YAHOO}, as of {esc(day(last["d"], True))} close.</p></section>')


def table(u, latest, sec, plants):
    q = (latest or {}).get("q") or {}
    c = (sec or {}).get("c") or {}
    pl = (plants or {}).get("plants") or {}
    newest = (latest or {}).get("d")
    out = []
    for g in u["groups"]:
        ms = sorted([m for m in u["members"] if m["group"] == g], key=lambda m: m["company"].lower())
        if not ms:
            continue
        gid = GROUP_IDS.get(g, re.sub(r"\W+", "-", g.lower()))
        out.append(f'<tbody id="g-{gid}"><tr class="ags-g"><th colspan="4" scope="rowgroup">{esc(g)}</th></tr>')
        for m in ms:
            t = m["t"]
            x, rec = q.get(t), c.get(t)
            if x:
                close = f'<td class="n">{money(x["close"])}</td>'
                if x.get("pct") is None:
                    dcell = '<td class="n">&nbsp;</td>'
                else:
                    cls = "up" if x["pct"] > 0 else "dn" if x["pct"] < 0 else ""
                    old = f' <small>{esc(day(x["d"]))}</small>' if newest and x["d"] < newest else ""
                    dcell = f'<td class="n {cls}">{pct(x["pct"])}{old}</td>'
            else:
                close = '<td class="n ags-muted">no close</td>'
                dcell = '<td class="n">&nbsp;</td>'
            rc = rev_change(rec)
            if rc:
                p, cur, prior = rc
                tip = f"Quarter ended {day(cur['end'], True)}: {big(cur['val'])} vs {big(prior['val'])}, whole company"
                rcell = f'<td class="n" title="{esc(tip)}">{pct(p)}</td>'
            else:
                rcell = '<td class="n ags-muted">n/a</td>'
            lr = last_report(rec)
            sub = []
            if lr:
                sub.append(f'reported {esc(day(lr["filed"], lr["filed"][:4] != (newest or "")[:4]))}')
            if pl.get(t):
                n = len(pl[t])
                sub.append(f'{n} plant{"s" if n != 1 else ""} we list')
            subs = f'<small>{" · ".join(sub)}</small>' if sub else ""
            dattr = f' data-close="{x["close"]}" data-d="{esc(x["d"])}"' if x else ""
            out.append(f'<tr data-t="{esc(t)}"{dattr}><th scope="row"><button type="button" class="ags-co" aria-expanded="false" '
                       f'aria-controls="d-{esc(t)}"><b>{esc(t)}</b> {esc(m["company"])}</button>{subs}</th>{close}{dcell}{rcell}</tr>')
        out.append("</tbody>")
    cap = (f'Closes {esc(day(newest, True))} &middot; {YAHOO}' if newest else "No closes read yet")
    return (f'<div class="ags-tw"><table class="ags-t"><caption>{cap}</caption>'
            '<thead><tr><th scope="col">Company</th><th scope="col" class="n">Close</th><th scope="col" class="n">Day</th>'
            '<th scope="col" class="n rv">Revenue vs a year ago</th></tr></thead>' + "".join(out) + "</table></div>")


def member_list(u, key):
    spec = next((i for i in u.get("indexes") or [] if i["key"] == key), None)
    if not spec:
        return ""
    names = {m["t"]: m["company"] for m in u["members"]}
    s = ", ".join(f"{esc(names.get(t, t))} ({esc(t)})" for t in spec["tickers"])
    if spec.get("left_out"):
        s += f'. Left out, not on SEC&rsquo;s ticker list: {esc(", ".join(spec["left_out"]))}'
    return s


def method(u, ix, sec, plants):
    a = ((ix or {}).get("ix") or {}).get("ag20") or {}
    exc = a.get("excluded") or {}
    exc_s = ("; ".join(f"{esc(t)}: {esc(w)}" for t, w in sorted(exc.items()))) if exc else ""
    dropped = "; ".join(f'{esc(d["t"])} ({esc(d["why"])})' for d in u.get("dropped") or [])
    revs = (ix or {}).get("revisions") or []
    rev_s = ("".join(f'<li>{esc(r["ix"])} {esc(day(r["d"], True))}: {r["was"]:,.2f} became {r["now"]:,.2f} when a missing close arrived.</li>'
                     for r in revs[-5:])) if revs else ""
    checked = u.get("checked")
    sec_c = (sec or {}).get("checked")
    return f"""<details class="ags-method" id="method"><summary>How these numbers are made, and what they are not</summary>
<p><b>Not investment advice; not a fund you can buy.</b> No share price here is a forecast of grain, livestock, input or local cash prices.</p>
<h3>The AGSIST Ag 20</h3>
<ul>
<li>Equal weight, price return (dividends not added), base 1,000.00 at the first close on or after Nov 2, 2026 on which every member has a close.</li>
<li>Members: {member_list(u, "ag20")}.</li>
<li>A company counts only if, before the base day (and before each rebalance), it has 60 sessions of closes and a median daily trading value of $1 million or more over the last 60 sessions. Fewer than 13 qualifying: the index is not published.{(" Not qualifying at the base: " + exc_s + ".") if exc_s else ""}</li>
<li>Rebalanced to equal weight at the close of the first session of January, April, July and October; the level is the same just before and just after. Between rebalances the weights drift with the prices. A split changes the share count, not the level. A company that stops trading leaves at its last close and its value is spread over the others.</li>
<li>A missing close is never counted as a flat day. The last close is carried for one session and marked; after two missing sessions the level is held and the page says which company has no close. When a late close arrives, the day is rebuilt and marked revised.</li>
<li>No backtest is shown: picking today&rsquo;s members and running them back in time would use hindsight.</li>
</ul>
<h3>Side baskets</h3>
<ul>
<li><b>Input suppliers</b>: {member_list(u, "input")}.</li>
<li><b>Demand chain</b>: {member_list(u, "demand")}.</li>
<li>Same rules, five members at least. These are share prices of suppliers / buyers, not fertilizer or grain prices; a packer or processor earning more does not mean a farmer is paid more.</li>
</ul>
{('<h3>Revised days</h3><ul>' + rev_s + '</ul>') if rev_s else ''}
<h3>The table</h3>
<ul>
<li>Companies sell to farmers or buy from them; many also sell far outside farming, so a company&rsquo;s revenue is the whole company, never a farm share.</li>
<li>Close and day change: the daily close from Yahoo Finance (delayed, not an exchange feed), against the previous close on file. A day&rsquo;s date shows when a company&rsquo;s close is older than the rest.</li>
<li>Reported: the newer of the company&rsquo;s latest 10-Q, 10-K, 20-F or 40-F and its latest earnings release (8-K item 2.02), by SEC filing date. Revenue vs a year ago: the latest three-month revenue in the company&rsquo;s XBRL data against the same quarter a year before, both as last filed. Companies that report only twice a year, or not in U.S. dollars, show n/a.</li>
<li>&ldquo;Usually reports in&rdquo; counts 8-K earnings releases over the last three years; it is not a date the company has set.</li>
<li>Plants: only plants whose operator name is the company&rsquo;s own in the plant lists AGSIST keeps (ethanol plants from the Renewable Fuels Association list, soybean crush plants from NOPA, export elevators from port pages, rail shuttle elevators from the Kansas grain elevator guide), read Oct 28, 2026. Joint ventures are marked. Plants a company owns under another name are not counted.</li>
<li>Every listed company was checked against SEC&rsquo;s ticker list{(" on " + esc(day(checked[:10], True))) if checked else ""}. Not listed here: {dropped}.</li>
</ul>
<p class="ags-src">Closes: {YAHOO}. Filings and revenue: {SEC}{(", read " + esc(day(sec_c[:10], True))) if sec_c else ""}. Ticker check: <a href="https://www.sec.gov/files/company_tickers_exchange.json" rel="noopener">SEC company tickers</a>.</p>
</details>"""


def css():
    return """<style>
.ags{max-width:860px;margin:0 auto;padding:1rem 1rem 3rem}
.ags .breadcrumb{font-size:.8rem;margin:0 0 .5rem}
.ags h1{font-size:clamp(1.35rem,4.3vw,1.9rem);line-height:1.2;margin:0 0 .35rem;color:var(--text)}
.ags h2{font-size:1.1rem;margin:0 0 .2rem;color:var(--text)}
.ags h3{font-size:1rem;margin:1rem 0 .3rem;color:var(--text)}
.ags p,.ags li{font-size:.95rem;line-height:1.55;color:var(--text-dim)}
.ags a{color:var(--link,var(--brand));text-underline-offset:2px}
.ags-lede{color:var(--text)!important;margin:0 0 .8rem}
.ags-ix{border:1px solid var(--border);border-radius:10px;background:var(--surface);padding:.8rem .9rem;margin:0 0 1rem}
.ags-big{font-family:'JetBrains Mono',monospace;font-size:1.9rem!important;font-weight:700;color:var(--text)!important;margin:.1rem 0!important;line-height:1.2!important}
.ags-chg{font-size:1.1rem}.ags-held{font-size:.85rem;color:#c9853a}
.ags .up{color:#3d9a40}.ags .dn{color:#c2553a}
.ags-muted{color:var(--text-muted)!important;font-weight:400}
.ags-note{font-size:.82rem!important;color:var(--text-muted)!important;margin:.2rem 0!important}
.ags-src{font-size:.78rem!important;color:var(--text-muted)!important;margin:.4rem 0 0!important}
.ags-spark{display:block;width:100%;max-width:280px;height:48px;color:var(--green,#4aab4c);margin:.3rem 0}
.ags-sides{list-style:none;padding:0;margin:.4rem 0 0;font-family:'JetBrains Mono',monospace}
.ags-sides li{font-size:.85rem}
.ags-tw{margin:.5rem 0 .3rem}
.ags-t{border-collapse:collapse;width:100%;font-size:.86rem}
.ags-t caption{text-align:left;font-size:.78rem;color:var(--text-muted);padding:0 0 .4rem}
.ags-t th,.ags-t td{padding:.38rem .35rem;border-top:1px solid var(--border);vertical-align:top;color:var(--text-dim)}
.ags-t thead th{font-family:'JetBrains Mono',monospace;font-size:.68rem;letter-spacing:.03em;color:var(--text-muted);text-align:left}
.ags-t thead th.n{white-space:normal;text-align:right;line-height:1.25}
.ags-t th.rv{width:5.2rem}
.ags-t .n{text-align:right;white-space:nowrap;font-family:'JetBrains Mono',monospace;font-size:.82rem}
.ags-t th[scope=row]{text-align:left;font-weight:400}
.ags-t th[scope=row] small{display:block;font-size:.72rem;color:var(--text-muted);padding-left:.1rem}
.ags-t td small{display:block;font-size:.68rem;color:var(--text-muted)}
.ags-g th{text-align:left!important;font-size:.8rem;font-weight:700;color:var(--text);padding-top:.8rem;border-top:2px solid var(--border)}
.ags-co{background:none;border:0;padding:0;margin:0;font:inherit;color:var(--text);text-align:left;cursor:pointer;text-decoration:underline dotted;text-underline-offset:3px}
.ags-co b{font-family:'JetBrains Mono',monospace;font-size:.8rem;margin-right:.15rem}
.ags-d td{background:var(--surface);padding:.6rem .7rem}
.ags-d ol{margin:0;padding-left:1.2rem}.ags-d li{font-size:.88rem;margin:.15rem 0}
.ags-d form{display:flex;gap:.4rem;flex-wrap:wrap;margin:.4rem 0}
.ags-d input{width:6.5rem;padding:.35rem .5rem;font:inherit;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text)}
.ags-d button[type=submit]{padding:.35rem .7rem;border:1px solid var(--border);border-radius:6px;background:var(--surface-2,var(--surface));color:var(--text);font:inherit;cursor:pointer}
.ags-method{margin:1.4rem 0 0;border:1px solid var(--border);border-radius:8px;padding:.6rem .8rem}
.ags-method summary{cursor:pointer;font-weight:700;color:var(--text)}
.ags-method li{font-size:.88rem}
@media (max-width:480px){.ags-t{font-size:.82rem}.ags-t .n{font-size:.76rem}.ags-t th,.ags-t td{padding:.34rem .2rem}.ags-t thead th{font-size:.62rem}}
</style>"""


def chrome():
    """The theme and GA guard scripts from store-or-sell.html (one copy of each on the site)."""
    src = open(os.path.join(ROOT, "store-or-sell.html"), encoding="utf-8").read()
    return re.search(r"<script>/\* agsist-theme-early.*?</script><script>/\* agsist-ga-guard.*?</script>", src, re.S).group(0)


def render(u, latest, ix, sec, plants, early):
    ld = {"@context": "https://schema.org", "@graph": [
        {"@type": "WebPage", "@id": URL + "#page", "url": URL, "name": TITLE, "description": DESC,
         "author": {"@type": "Person", "name": "Sigurd Lindquist"}, "publisher": {"@type": "Organization", "name": "AGSIST", "url": "https://agsist.com"}},
        {"@type": "BreadcrumbList", "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Home", "item": "https://agsist.com/"},
            {"@type": "ListItem", "position": 2, "name": "All markets", "item": "https://agsist.com/markets"},
            {"@type": "ListItem", "position": 3, "name": "Ag stocks", "item": URL}]}]}
    if u:
        body = index_block(ix, latest) + table(u, latest, sec, plants)
        body += (f'<p class="ags-src">Closes: {YAHOO}. Reported dates and revenue: {SEC} filings, whole company. '
                 'Tap a company for its filing numbers and its plants near you.</p>')
        body += method(u, ix, sec, plants)
    else:
        body = (index_block(None, None) +
                '<p>Company closes appear here after the first read following the U.S. close.</p>')
    return f"""<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="theme-color" content="#111a0a">
  <title>{esc(TITLE)} | AGSIST</title>
  <meta name="description" content="{esc(DESC)}">
  <meta name="author" content="Sigurd Lindquist">
  <meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large">
  <link rel="canonical" href="{URL}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="AGSIST">
  <meta property="og:locale" content="en_US">
  <meta property="og:title" content="{esc(TITLE)}">
  <meta property="og:description" content="{esc(DESC)}">
  <meta property="og:url" content="{URL}">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="{esc(TITLE)}">
  <meta name="twitter:description" content="{esc(DESC)}">
  {early}
  <link rel="preload" href="/components/styles.css?v=27" as="style">
  <link rel="stylesheet" href="/components/styles.css?v=27">
  <link rel="icon" href="/img/favicon.ico" sizes="32x32">
  <link rel="icon" type="image/svg+xml" href="/img/icon.svg">
  {css()}
  <script type="application/ld+json">{json.dumps(ld, separators=(",", ":"))}</script>
</head>
<body>
  <a href="#main" class="skip">Skip to content</a>
  <div id="site-header"></div>
  <main id="main" tabindex="-1">
    <article class="ags">
      <nav class="breadcrumb" aria-label="Breadcrumb"><a href="/">Home</a> &rarr; <a href="/markets">All markets</a> &rarr; Ag stocks</nav>
      <h1>Ag stocks</h1>
      <p class="ags-lede">Share prices of the listed companies that sell to farmers or buy from them, what they last reported to the SEC, and the AGSIST Ag 20. Not investment advice; not a fund you can buy.</p>
      {body}
    </article>
    <p class="by-end" style="font-size:.78rem;color:var(--text-muted);margin:1.2rem 0 .4rem">Made by <a href="/about">Sigurd Lindquist, CCA</a>, Chetek, Wisconsin.</p>
  </main>
  <div id="site-footer"></div>
  <script src="/components/loader.js?v=19" defer></script>
  <script src="/components/agstocks.js?v={JS_V}" defer></script>
</body>
</html>
"""


def build():
    import inject_static_nav as nav
    page = render(rd("universe.json"), rd("latest.json"), rd("index.json"), rd("sec.json"), rd("plants.json"), chrome())
    return nav.render(page, "ag-stocks.html", nav.block("header"), nav.block("footer"))


def selftest():
    fails = []

    def check(c, m):
        if not c:
            fails.append(m)
    check(pct(1.234) == "+1.2%" and pct(-0.05, 2) == "−0.05%" and pct(0) == "0.0%", "pct")
    check(big(3.998e9) == "$4.00 billion" and big(-527e6) == "−$527.0 million", "big")
    check(day("2026-11-02", True) == "Nov 2, 2026", "day")
    check("Starts Nov 2" in index_block({"ix": {"ag20": {"status": "pending", "levels": []}}}, {}), "pending says starts Nov 2")
    pend = index_block({"ix": {"ag20": {"status": "pending", "levels": []}}}, {})
    check(not re.search(r"\d{3,}", pend), "pending shows no level")
    held = {"ix": {"ag20": {"status": "live", "base": "2026-11-02", "levels": [
        {"d": "2026-11-02", "v": 1000.0, "chg": None, "n": 20, "base": True},
        {"d": "2026-11-03", "v": 1000.0, "chg": None, "n": 20, "held": True, "why": [["TSN", "2026-10-30"]]}]},
        "input": {"status": "pending"}, "demand": {"status": "pending"}}}
    hb = index_block(held, {})
    check("held: no close for TSN since Oct 30" in hb and "0.00%" not in hb, "held level says why, never 0%")
    check("not fertilizer or grain prices" in hb, "side basket label")
    for f in fails:
        print("FAIL", f)
    if not fails:
        print("build_agstocks_page selftest: ok")
    return 1 if fails else 0


def main(argv):
    if "--selftest" in argv:
        return selftest()
    out = build()
    if "--check" in argv:
        try:
            have = open(PAGE, encoding="utf-8").read()
        except OSError:
            have = ""
        if have != out:
            print("ag-stocks.html is out of date: run python3 scripts/build_agstocks_page.py")
            return 1
        print("ag-stocks.html matches data/agstocks")
        return 0
    with open(PAGE, "w", encoding="utf-8") as f:
        f.write(out)
    print(f"ag-stocks.html: {len(out.encode('utf-8')):,} bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
