#!/usr/bin/env python3
"""build_company_pages.py -- one page per elevator company, /cash-bids/company/<slug>,
built inside scripts/build_cash_bid_pages.py from the same boards and rows as
the town pages. Never run on its own except for the selftest.

WHY (2026-10-17)
----------------
Bing's keyword report for the last three months had searches by company name
that agsist ranked for and got no click on, because no page was about the
company: "new coop cash bids" 1,565 impressions at position 7.8, "agtegra cash
bids" 1,016 at 9.2, "new coop grain bids" 923 at 6.4, "adm cash bids" 421,
"alcivia cash bids" 401, "farmward grain bids" 250, "cooperative producers
grain bids" 172. Search Console: "frontier coop cash bids", "nexus cash bids",
"mercer landmark cash bids".

WHAT A COMPANY IS
-----------------
The elevator's clean display name (scripts/elevator_names.py,
data/elevator-names.json), exactly as the town pages print it. Boards are
grouped by that name; a company gets a page when COMPANY_MIN or more of its
boards are placed in a town (each location then links to a town page that
exists). Nothing is merged by guess: "CHS Herman" and "CHS Brandon" post their
own boards under their own names and stay apart.

WHAT A PAGE SHOWS
-----------------
Per location, state by state: for corn, soybeans and wheat, the board's
nearest-delivery bid in the commodity it posts most (CB.board_glance's rule:
a non-GMO premium is never the headline, an unusual basis never headlines),
with its basis and delivery month, the board's "Updated" stamp (asof.js greys
it once it is not from today, as on the town pages), and a link to the town
page with the full table. A location with no current bid prints no price, only
the reason and the day it was last read, the same words as the town pages.
The rules for what may print are the town pages' rules: these rows are the
rows select() kept, nothing else.

The answer line at the top, the meta description and the FAQ are built from
the same cells the table prints. The page says plainly that AGSIST is not
affiliated with the company and that the bids are read from its public board,
and links the board's own site when the network's index has one.

Size: ~0.3 KB a location on top of the shared head and chrome. The biggest
company (about 130 locations on 2026-10-17) is well under the 150 KB cap; the
build fails if any company page passes MAX_PAGE_KB.

  python3 scripts/build_company_pages.py --selftest
"""
import json
import os
import re
import sys
from collections import Counter
from urllib.parse import urlparse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_cash_bid_pages as CB  # noqa: E402
from build_state_basis_pages import CT, MONTH_ABBR, SITE, STATE_NAMES, esc, money_basis  # noqa: E402

COMPANY_MIN = 3           # boards placed in a town before a company gets a page
SUBDIR = "company"
MAX_PAGE_KB = 120         # under the site's 150 KB cap for a generated page, with room
SHOW_CROPS = ("corn", "soybeans", "wheat")
NAME_TAIL = re.compile(r"[\s,]*\b(inc|incorporated|llc|l\.l\.c|ltd|lp)\b\.?\s*$", re.I)

CSS_EXTRA = (".cbc-t td{white-space:nowrap}.cbc-t td.l{white-space:normal;min-width:7.5em}"
             ".cbc-t td.l a{color:var(--text);font-weight:600}.cbc-t .asof{display:block}"
             ".cbc-t td.q{white-space:normal;color:var(--text-muted);font-size:.82rem}"
             "@media (max-width:640px){.cbc-t td,.cbc-t th{padding:6px 3px}.cbc-t{font-size:.82rem}"
             ".cbc-t td.n .mut{font-size:.66rem}.cbc-t td.l{min-width:0}"
             ".cbc-t .asof,.cbc-t .asof-t,.cbc-t .asof-note{white-space:normal;font-size:.7rem}}")


def short_name(name):
    """'NEW Cooperative, Inc.' -> 'NEW Cooperative'; 'AgMark LLC.' -> 'AgMark'."""
    s = (name or "").strip().rstrip(",").strip()
    for _ in range(2):
        t = NAME_TAIL.sub("", s).strip().rstrip(",").strip()
        if not t:
            break
        s = t
    return s


def site_of(boards, srcs):
    """(url, host) of the board site the network's index names most often for
    this company's boards, or (None, None). http(s) only."""
    c = Counter()
    for bd in boards:
        w = ((srcs.get(bd["source"]) or {}).get("website") or "").strip()
        if re.match(r"^https?://[^\s\"<>]+$", w):
            c[w] += 1
    if not c:
        return None, None
    url = c.most_common(1)[0][0]
    host = urlparse(url).netloc.lower()
    host = host[4:] if host.startswith("www.") else host
    return url, host


def group(towns, srcs, minimum=COMPANY_MIN):
    """{slug: company} for every display name with `minimum` or more boards in
    towns. Each company: name, short, slug, path, boards [(town, board)], site."""
    by = {}
    for tk in sorted(towns):
        t = towns[tk]
        for bd in t["boards"].values():
            name = (bd.get("operator") or "").strip()
            if not name:
                continue
            by.setdefault(name, []).append((t, bd))
    out, used = {}, set()
    for name in sorted(by, key=str.lower):
        locs = by[name]
        if len(locs) < minimum:
            continue
        short = short_name(name)
        slug = CB.url_slug(short)
        n = 2
        while slug in used:
            slug = f"{CB.url_slug(short)}-{n}"
            n += 1
        used.add(slug)
        url, host = site_of([bd for _, bd in locs], srcs)
        out[slug] = {"name": name, "short": short, "slug": slug, "path": f"/cash-bids/{SUBDIR}/{slug}",
                     "locs": locs, "site": url, "host": host}
    return out


def glance(bd):
    """{crop: row}: per crop, the commodity the board posts most, its nearest
    delivery month, the highest cash there (CB.board_glance's rule), odd rows
    left out."""
    out = {}
    for c in SHOW_CROPS:
        rs = [r for r in bd["rows"] if r["crop"] == c and not r.get("odd")]
        if not rs:
            continue
        com = Counter(r["commodity"].lower() for r in rs).most_common(1)[0][0]
        rs = [r for r in rs if r["commodity"].lower() == com]
        m = min(r["dm"] for r in rs)
        out[c] = max((r for r in rs if r["dm"] == m), key=lambda r: (r["cash"], r["priced"]))
    return out


def loc_label(t, bd):
    """'Fremont' or 'Fremont, Ingredion' or 'Fremont, Pana Facility, 8 mi away'."""
    def n(x):
        return re.sub(r"[^a-z0-9]", "", (x or "").lower())
    city = re.sub(r"(,\s*[A-Z]{2})+$", "", (bd.get("city") or "").strip()).strip()
    extra = city if city and n(city) != n(t["name"]) and n(city) not in n(bd.get("operator")) else ""
    if bd.get("how") == "near" and bd.get("near_mi") is not None:
        mi = bd["near_mi"]
        extra = (extra + ", " if extra else "") + ("under 1 mi away" if mi < 1 else f"{mi:.0f} mi away")
    return extra


def _cell(r, snap_ct):
    if r is None:
        return '<td class="n"><span class="mut">&ndash;</span></td>'
    sub = CB._mon(r["dm"], snap_ct)
    if r["basis"] is not None:
        sub += " " + money_basis(r["basis"])
    return f'<td class="n">{CB.cash_c(r["cash"])}<br><span class="mut">{sub}</span></td>'


def _days(ts):
    ds = sorted({(t.astimezone(CT).month, t.astimezone(CT).day) for t in ts})
    a = f"{MONTH_ABBR[ds[0][0] - 1]} {ds[0][1]}"
    if len(ds) == 1:
        return a, True
    b = ds[-1]
    return f"{a} to {MONTH_ABBR[b[0] - 1] + ' ' if b[0] != ds[0][0] else ''}{b[1]}", False


def _range(vals):
    lo, hi = min(vals), max(vals)
    return CB.cash_c(lo) if CB.cash_c(lo) == CB.cash_c(hi) else f"{CB.cash_c(lo)} to {CB.cash_c(hi)}"


def answer(co, cells):
    """("<Short> cash bids today: corn $3.80 to $4.05 at 12 locations, soybeans
    ... , as of Oct 17.", posted times used). Every number is a cell below."""
    parts, used = [], []
    for c in SHOW_CROPS:
        rs = [g[c] for g in cells if c in g]
        if not rs:
            continue
        parts.append(f"{CB.CROP_LABEL[c].lower()} {_range([r['cash'] for r in rs])} at {len(rs)} "
                     f"location{'s' if len(rs) != 1 else ''}")
        used += [r["priced"] for r in rs]
        if len(parts) == 2:
            break
    if not parts:
        return "", []
    d, one = _days(used)
    return f"{co['short']} cash bids today: {', '.join(parts)}, {'as of' if one else 'posted'} {d}.", used


def faq(co, cells, n_loc, n_live, states):
    qs = []
    short = co["short"]
    for c in ("corn", "soybeans"):
        rows = [(g[c], t) for g, t in cells if c in g]
        if not rows:
            continue
        # on a tie, the location first by name, both ends
        lo = min(rows, key=lambda x: (x[0]["cash"], x[1]))
        hi = min(rows, key=lambda x: (-x[0]["cash"], x[1]))
        d, _ = _days([r["priced"] for r, _ in rows])
        crop = CB.ADJ[c]
        if len(rows) == 1 or CB.cash_c(lo[0]["cash"]) == CB.cash_c(hi[0]["cash"]):
            a = (f"The {short} {crop} bid we read is {CB.cash_c(hi[0]['cash'])} a bushel at "
                 f"{len(rows)} location{'s' if len(rows) != 1 else ''}, for the nearest delivery each posts, "
                 f"posted {d}.")
        else:
            a = (f"The {short} {crop} bids we read run from {CB.cash_c(lo[0]['cash'])} a bushel at {lo[1]} to "
                 f"{CB.cash_c(hi[0]['cash'])} at {hi[1]}, across {len(rows)} locations, for the nearest delivery "
                 f"each posts, posted {d}.")
        qs.append((f"What is {short} paying for {CB.CROP_LABEL[c].lower()} today?", a + " Call the location to confirm before you haul."))
    st_txt = ", ".join(STATE_NAMES[s] for s in states[:-1]) + (" and " if len(states) > 1 else "") + STATE_NAMES[states[-1]]
    qs.append((f"How many {short} locations does AGSIST read?",
               f"{n_loc} {short} locations in {st_txt}. " + (
                   "Every one has a current bid on this page." if n_live == n_loc else
                   f"{n_live} of them have a current bid on this page; the rest show when their board was last read.")))
    src = f" ({co['host']})" if co.get("host") else ""
    qs.append((f"Is AGSIST part of {short}?",
               f"No. AGSIST is not affiliated with {short}. These bids are read from {short}'s public bid "
               f"board{src}. For a contract, a price later in the day or anything else, call the location."))
    return qs


def build_page(co, ctx):
    snap_ct = ctx["snap_ct"]
    short, path = co["short"], co["path"]
    by_st = {}
    for t, bd in co["locs"]:
        by_st.setdefault(t["state"], []).append((t, bd))
    states = sorted(by_st, key=lambda s: (-len(by_st[s]), STATE_NAMES[s]))
    cells, named, n_live = [], [], 0
    wheat = any("wheat" in glance(bd) for _, bd in co["locs"])
    crops = [c for c in SHOW_CROPS if c != "wheat" or wheat]
    secs = []
    for st in states:
        sname = STATE_NAMES[st]
        ssl = CB.url_slug(sname)
        locs = sorted(by_st[st], key=lambda x: (x[0]["name"].lower(), loc_label(*x).lower()))
        trs = []
        for t, bd in locs:
            tp = f"/cash-bids/{ssl}/{t['slug']}"
            extra = loc_label(t, bd)
            lab = f'<a href="{tp}">{esc(t["name"])}</a>' + (f' <span class="mut">{esc(extra)}</span>' if extra else "")
            g = glance(bd) if bd["rows"] else {}
            if g:
                n_live += 1
                cells.append(g)
                named.append((g, t["name"] + (f" ({extra})" if extra else "")))
                stamp = CB.asof_time(min(r["priced"] for r in g.values()))
                trs.append(f'<tr><td class="l">{lab}{stamp}</td>' + "".join(_cell(g.get(c), snap_ct) for c in crops)
                           + "</tr>")
            elif bd["rows"]:
                n_live += 1
                trs.append(f'<tr><td class="l">{lab}</td><td class="q" colspan="{len(crops)}">Bids posted with an '
                           f'unusual basis; see the town page.</td></tr>')
            else:
                why = next((CB.WHY[k] for k, _ in bd["why"].most_common() if k in CB.WHY), "no current bid")
                seen = f", last read {CB.fmt_day(bd['checked'])}" if bd.get("checked") else ""
                trs.append(f'<tr><td class="l">{lab}</td><td class="q" colspan="{len(crops)}">No current bid: '
                           f'{esc(why)}{seen}.</td></tr>')
        ths = "".join(f'<th class="n">{CB.CROP_LABEL[c]}</th>' for c in crops)
        secs.append(f'<h2 id="{ssl}">{esc(sname)} <span class="cbt-mut">{len(locs)} '
                    f'location{"s" if len(locs) != 1 else ""}</span></h2>'
                    f'<div class="cbt-scroll"><table class="cbt-t cbc-t"><thead><tr><th>Location</th>{ths}</tr>'
                    f'</thead><tbody>{"".join(trs)}</tbody></table></div>')
    n_loc = len(co["locs"])
    indexable = bool(cells)
    ans, used = answer(co, cells)
    title = f"{short} Cash Bids Today | AGSIST"
    if len(title) > 60:
        title = f"{short} Cash Bids Today"
    if len(title) > 60:
        title = f"{short} Cash Bids"
    if ans:
        desc = f"{ans} Read from {short}'s public bid board. Call to confirm."
        if len(desc) > CB.DESC_MAX:
            desc = ans
        if len(desc) > CB.DESC_MAX:
            d, _ = _days(used)
            desc = f"{short} cash bids at {n_loc} locations: cash and basis by town, posted {d}. Call to confirm."
    else:
        desc = (f"{short} cash bids: no current bid from the {n_loc} {short} locations the AGSIST network reads. "
                f"Each shows when its board was last read.")
    desc = desc[:CB.DESC_MAX]
    st_txt = ", ".join(STATE_NAMES[s] for s in states[:-1]) + (" and " if len(states) > 1 else "") + STATE_NAMES[states[-1]]
    site = (f' (<a href="{esc(co["site"])}" rel="noopener">{esc(co["host"])}</a>)' if co.get("site") else "")
    intro = (f'<p class="cbt-sub">{esc(co["name"])} posts bids at <b>{n_loc}</b> location{"s" if n_loc != 1 else ""} '
             f'in {esc(st_txt)} that the AGSIST elevator network reads. The bids are read from {esc(short)}&rsquo;s '
             f'public bid board{site}. AGSIST is not affiliated with {esc(short)}. Cash is $/bu; under each price is '
             f'its delivery month and basis. Call the location before you haul.</p>')
    if not indexable:
        intro += (f'<div class="cbt-note"><b>No current bid.</b> No {esc(short)} board has a bid we could confirm '
                  f'right now. Each location below says when it was last read.</div>')
    qs = faq(co, named, n_loc, n_live, states) if indexable else []
    jsonld = {"@context": "https://schema.org", "@graph": [
        CB.breadcrumb([("AGSIST", f"{SITE}/"), ("Cash bids", f"{SITE}/cash-bids"),
                       ("By company", f"{SITE}/cash-bids/{SUBDIR}/"), (short, f"{SITE}{path}")]),
        {"@type": "WebPage", "@id": f"{SITE}{path}", "url": f"{SITE}{path}", "name": title,
         "about": {"@type": "Organization", "name": co["name"], **({"url": co["site"]} if co.get("site") else {})},
         "publisher": {"@type": "Organization", "name": "AGSIST", "url": f"{SITE}/"}}]}
    if qs:
        jsonld["@graph"].append(CB.faq_jsonld(qs))
    hdr, ftr = ctx["chrome"]
    # The bid email box (components/cb-signup.js, the same one the town pages
    # carry): AGSIST Daily with the reader's ZIP, and the 25-mile ZIP price
    # alert (send_zip_alert.py). A company page has no one ZIP, so the box
    # shows its own ZIP field (data-zip-input names a hidden input it syncs from).
    box = ""
    if indexable:
        cs = " ".join(c for c in crops if c in ("corn", "soybeans", "wheat"))
        box = (f'<input type="hidden" id="co-zip" value=""><div id="bid-email" data-bid-alerts data-zip-input="co-zip" '
               f'data-source="company:{co["slug"][:50]}" data-crops="{cs}"></div>')
    links = " &middot; ".join([f'<a href="/cash-bids/{SUBDIR}/">Every company</a>']
                              + [f'<a href="/cash-bids/{CB.url_slug(STATE_NAMES[s])}/">{esc(STATE_NAMES[s])} bids and basis</a>'
                                 for s in states[:4]])
    jump = ""
    if len(states) > 1:
        jump = ('<p class="cbt-sub">' + " &middot; ".join(
            f'<a href="#{CB.url_slug(STATE_NAMES[s])}">{esc(STATE_NAMES[s])} ({len(by_st[s])})</a>' for s in states)
            + "</p>")
    body = f"""
<body>
{hdr}
<main class="cbt-wrap" id="main">
  <p class="cbt-sub" style="margin-top:14px"><a href="/cash-bids" style="color:var(--text-muted)">Cash bids</a> &rsaquo; <a href="/cash-bids/{SUBDIR}/" style="color:var(--text-muted)">By company</a> &rsaquo; <b style="color:var(--text)">{esc(short)}</b></p>
  <h1>{esc(short)} cash grain bids today</h1>
  {f'<p class="cbt-answer">{esc(ans)}</p>' if ans else ''}
  {intro}
  {jump}
  {''.join(secs)}
  {box}
  {CB.faq_html(qs, short)}
  <div class="cbt-note"><b>Where these come from.</b> The AGSIST elevator network reads each {esc(short)} location&rsquo;s
  posted bid board directly; no third-party bid feed is used. A bid shows only if the board was confirmed on the latest
  read, the price was posted in the last {CB.FRESH_HOURS} hours, and its delivery period has not ended. Each price is the
  location&rsquo;s nearest delivery month for the grade it posts most; the town page has every month and the futures
  contract each basis is quoted against. A basis far off the elevators around it is left out here and flagged on the town
  page. This page is a snapshot rebuilt through the day.</div>
  <p class="cbt-sub">{links}</p>
"""
    h = CB.head(title, desc, path, jsonld, indexable)
    h = h.replace("  </style>", CSS_EXTRA + "\n  </style>", 1)
    if box:
        sheet = '  <link rel="stylesheet" href="/components/asof.css?v=1">\n'
        assert sheet in h, "CB.head() changed shape; update build_page()"
        h = h.replace(sheet, sheet + CB.SIGNUP_CSS, 1)
    page = h + body + CB.page_end(ftr, signup=bool(box))
    meta = {"slug": co["slug"], "name": co["name"], "short": short, "path": path, "indexable": indexable,
            "locations": n_loc, "live": n_live, "states": states, "title": title,
            "latest": max((r["priced"] for g in cells for r in g.values()), default=None)}
    return page, meta


def build_index(metas, ctx):
    path = f"/cash-bids/{SUBDIR}/"
    title = "Cash Grain Bids by Elevator Company | AGSIST"
    n = len(metas)
    desc = (f"Today's cash grain bids for {n} elevator companies, every location on one page: corn, soybean and "
            f"wheat cash and basis, read from each company's public board.")[:CB.DESC_MAX]
    rows = []
    for m in sorted(metas, key=lambda m: m["short"].lower()):
        sts = ", ".join(m["states"][:4]) + (f" +{len(m['states']) - 4}" if len(m["states"]) > 4 else "")
        rows.append(f'<tr><td class="l"><a href="{m["path"]}">{esc(m["short"])}</a></td><td class="n">{m["locations"]}</td>'
                    f'<td class="n">{m["live"]}</td><td class="l">{esc(sts)}</td></tr>')
    jsonld = {"@context": "https://schema.org", "@graph": [
        CB.breadcrumb([("AGSIST", f"{SITE}/"), ("Cash bids", f"{SITE}/cash-bids"), ("By company", f"{SITE}{path}")]),
        {"@type": "ItemList", "name": "Cash bids by elevator company", "numberOfItems": n,
         "itemListElement": [{"@type": "ListItem", "position": i + 1, "name": m["short"], "url": f"{SITE}{m['path']}"}
                             for i, m in enumerate(sorted(metas, key=lambda m: m["short"].lower()))]}]}
    hdr, ftr = ctx["chrome"]
    body = f"""
<body>
{hdr}
<main class="cbt-wrap" id="main">
  <p class="cbt-sub" style="margin-top:14px"><a href="/cash-bids" style="color:var(--text-muted)">Cash bids</a> &rsaquo; <b style="color:var(--text)">By company</b></p>
  <h1>Cash grain bids by elevator company</h1>
  <p class="cbt-sub">Every company with {COMPANY_MIN} or more locations in the AGSIST elevator network, each with today&rsquo;s
  bids at all its locations on one page. Bids are read from each company&rsquo;s public bid board; AGSIST is not
  affiliated with any of them. &ldquo;Current&rdquo; counts the locations with a bid posted in the last {CB.FRESH_HOURS}
  hours.</p>
  <div class="cbt-scroll"><table class="cbt-t cbc-t"><thead><tr><th>Company</th><th class="n">Locations</th>
  <th class="n">Current</th><th>States</th></tr></thead><tbody>{''.join(rows)}</tbody></table></div>
  <p class="cbt-sub"><a href="/cash-bids">Bids near your ZIP</a> &middot; <a href="/basis">Basis by state</a></p>
"""
    h = CB.head(title, desc, path, jsonld, bool(metas))
    h = h.replace("  </style>", CSS_EXTRA + "\n  </style>", 1)
    return h + body + CB.page_end(ftr), {"path": path, "indexable": bool(metas),
                                         "latest": max((m["latest"] for m in metas if m["latest"]), default=None)}


def write_all(companies, ctx, out_dir):
    """Write out_dir/company/<slug>.html and index.html; -> (metas, index meta).
    No company: nothing is written (no empty index)."""
    if not companies:
        return [], {"path": f"/cash-bids/{SUBDIR}/", "indexable": False, "latest": None}
    d = os.path.join(out_dir, SUBDIR)
    os.makedirs(d, exist_ok=True)
    metas = []
    for slug in sorted(companies):
        page, m = build_page(companies[slug], ctx)
        kb = len(page.encode("utf-8")) / 1024
        if kb > MAX_PAGE_KB:
            raise SystemExit(f"[cash-bid-pages] company page {slug} is {kb:.0f} KB (> {MAX_PAGE_KB}); refusing")
        m["kb"] = kb
        with open(os.path.join(d, f"{slug}.html"), "w", encoding="utf-8") as f:
            f.write(page)
        metas.append(m)
    page, im = build_index(metas, ctx)
    with open(os.path.join(d, "index.html"), "w", encoding="utf-8") as f:
        f.write(page)
    return metas, im


# ---------------------------------------------------------------- selftest
def _fixture():
    """Acme Co-op, Inc.: three Nebraska boards and one Iowa, one stale; a
    two-board company that gets no page; and a board in a third town."""
    gen, fresh = "2026-10-07T18:00:00Z", "2026-10-07T17:00:00Z"
    srcs, bids = [], []

    def add(sid, op, st, city, zp, crop, cash, basis, fm="ZCZ26", period="2026-10", delivery="Oct 2026",
            stale=False, priced=fresh, commodity=None, website="https://www.acmecoop.example/bids"):
        if sid not in {s["id"] for s in srcs}:
            srcs.append({"id": sid, "operator": op, "location": city, "usState": st, "zip": zp, "phone": "",
                         "status": "ok", "health": "live" if not stale else "broken", "pricedAt": priced,
                         "checkedAt": "2026-10-06T17:30:00Z", "website": website})
        bids.append({"place": f"{op}||{city}|{st}", "operator": op, "city": city, "town": None, "state": st,
                     "zip": zp, "currency": "USD", "commodity": commodity or crop.title(), "crop": crop,
                     "delivery": delivery, "period": period, "periodVia": "month-year", "periodPast": False,
                     "cash": cash, "basis": basis, "basisUnit": "per-bushel", "futuresMonth": fm,
                     "futuresCents": 777.77, "via": "scrape", "source": sid, "sourceStatus": "ok" if not stale else "broken",
                     "stale": stale, "pricedAt": priced})
    A = "Acme Co-op, Inc."
    add("acme-fremont", A, "NE", "Fremont", "68025", "corn", 3.90, -0.30)
    add("acme-fremont", A, "NE", "Fremont", "68025", "soybeans", 9.85, -0.35, fm="ZSX26")
    add("acme-fremont", A, "NE", "Fremont", "68025", "corn", 3.93, -0.27, period="2026-11", delivery="Nov 2026")
    add("acme-fremont", A, "NE", "Fremont", "68025", "corn", 4.40, 0.20, commodity="Non-GMO Corn")
    add("acme-hooper", A, "NE", "Hooper", "68031", "corn", 3.80, -0.40)
    add("acme-hooper", A, "NE", "Hooper", "68031", "corn", 3.95, -0.25, period="2026-11", delivery="Nov 2026")
    add("acme-hooper", A, "NE", "Hooper", "68031", "wheat", 4.60, -0.80, fm="KEZ26", commodity="HRW Wheat")
    add("acme-scrib", A, "NE", "Scribner", "68057", "corn", 1.11, -0.3, stale=True)
    add("acme-ack", A, "IA", "Ackworth", "50001", "corn", 3.85, -0.35)
    add("acme-ack", A, "IA", "Ackworth", "50001", "soybeans", 9.75, -0.45, fm="ZSX26",
        priced="2026-10-06T15:00:00Z")
    for k in range(3):                    # spare boards so the misread median has five
        add(f"oth-{k}", f"Other {k}", "NE", "Fremont", "68025", "corn", round(3.89 - k * 0.01, 4), -0.31 - k * 0.01,
            website="")
    add("two-a", "Two Spot Grain", "NE", "Fremont", "68025", "soybeans", 9.80, -0.40, fm="ZSX26", website="")
    add("two-b", "Two Spot Grain", "NE", "Hooper", "68031", "soybeans", 9.81, -0.39, fm="ZSX26", website="")
    merged = {"schema": "agsist-merged-all/1", "generated": gen, "bids": bids}
    return merged, {"generated": gen, "sources": srcs}


def selftest():
    import tempfile
    assert short_name("NEW Cooperative, Inc.") == "NEW Cooperative"
    assert short_name("AgMark LLC.") == "AgMark" and short_name("United Equity,Inc.") == "United Equity"
    assert short_name("Kokomo Grain Co.") == "Kokomo Grain Co." and short_name("Inc") == "Inc"
    assert short_name("Linn Coop Oil Company") == "Linn Coop Oil Company"
    merged, index = _fixture()
    ZT = {"zips": {"68025": ["Fremont", "NE"], "68031": ["Hooper", "NE"], "68057": ["Scribner", "NE"],
                   "50001": ["Ackworth", "IA"]}}
    with tempfile.TemporaryDirectory() as td:
        out, sm = os.path.join(td, "cash-bids"), os.path.join(td, "sm.xml")
        CB.build_all(merged, index, ZT, out_dir=out, root=".", sitemap=sm, min_towns=0,
                     now=CB.parse_ts("2026-10-07T19:00:00Z"))
        d = os.path.join(out, SUBDIR)
        assert sorted(os.listdir(d)) == ["acme-co-op.html", "index.html"], os.listdir(d)
        p = open(os.path.join(d, "acme-co-op.html"), encoding="utf-8").read()
        # the answer: corn over three current locations, nearest month, #2 corn not the non-GMO bid
        assert ('<p class="cbt-answer">Acme Co-op cash bids today: corn $3.80 to $3.90 at 3 locations, '
                'soybeans $9.75 to $9.85 at 2 locations, posted Oct 6 to 7.</p>') in p, \
            re.findall(r'cbt-answer">.*?<', p)
        assert "$4.40" not in p and "$3.95" not in p, "non-GMO or a later month headlined"
        assert "$1.11" not in p, "a stale board printed a price"
        assert ("No current bid: board not confirmed on the latest read, last read Oct 6, 2026.") in p
        assert '<a href="/cash-bids/nebraska/hooper">Hooper</a>' in p and '<a href="/cash-bids/iowa/ackworth">' in p
        assert p.index('id="nebraska"') < p.index('id="iowa"'), "the state with more locations first"
        assert '<th class="n">Wheat</th>' in p and "$4.60" in p, "wheat shows where a location bids it"
        assert 'data-asof="bids"' in p, "each location carries the town pages' Updated stamp"
        assert "AGSIST is not affiliated with Acme Co-op" in p and "public bid board" in p
        assert '<a href="https://www.acmecoop.example/bids" rel="noopener">acmecoop.example</a>' in p
        assert '<link rel="canonical" href="https://agsist.com/cash-bids/company/acme-co-op">' in p
        assert 'content="index,follow"' in p and "<title>Acme Co-op Cash Bids Today | AGSIST</title>" in p
        assert "ga-guard" in p and 'id="site-header"' in p, "same head and static chrome as the town pages"
        assert "\u2014" not in p, "no em dashes"
        # the bid email box: its own ZIP field, the company as the source, loaded once
        assert ('<input type="hidden" id="co-zip" value=""><div id="bid-email" data-bid-alerts data-zip-input="co-zip" '
                'data-source="company:acme-co-op" data-crops="corn soybeans wheat"></div>') in p
        assert p.count("/components/cb-signup.js?v=") == 1 and p.count("/components/cb-signup.css?v=") == 1
        assert p.index('id="bid-email"') > p.index('id="iowa"'), "the box comes after the bids"
        ld = [json.loads(x) for x in re.findall(r'<script type="application/ld\+json">\n(.*?)\n  </script>', p, re.S)]
        types = [g["@type"] for g in ld[0]["@graph"]]
        assert types == ["BreadcrumbList", "WebPage", "FAQPage"], types
        faqs = {q["name"]: q["acceptedAnswer"]["text"] for q in ld[0]["@graph"][2]["mainEntity"]}
        assert faqs["What is Acme Co-op paying for corn today?"].startswith(
            "The Acme Co-op corn bids we read run from $3.80 a bushel at Hooper to $3.90 at Fremont, across 3 locations")
        assert faqs["How many Acme Co-op locations does AGSIST read?"].startswith(
            "4 Acme Co-op locations in Nebraska and Iowa. 3 of them have a current bid")
        assert faqs["Is AGSIST part of Acme Co-op?"].startswith("No. AGSIST is not affiliated with Acme Co-op.")
        # the town page links its company; a two-board company has no page and no link
        fr = open(os.path.join(out, "nebraska", "fremont.html"), encoding="utf-8").read()
        assert '<a href="/cash-bids/company/acme-co-op">Every Acme Co-op location</a>' in fr
        assert "/cash-bids/company/two-spot" not in fr
        ix = open(os.path.join(d, "index.html"), encoding="utf-8").read()
        assert '<a href="/cash-bids/company/acme-co-op">Acme Co-op</a></td><td class="n">4</td><td class="n">3</td>' in ix
        assert '<link rel="canonical" href="https://agsist.com/cash-bids/company/">' in ix
        sx = open(sm, encoding="utf-8").read()
        assert "https://agsist.com/cash-bids/company/acme-co-op</loc>" in sx
        assert "https://agsist.com/cash-bids/company/</loc>" in sx
        assert not os.path.exists(os.path.join(out, "index.html"))
    # a company with no current bid anywhere: noindex, no price, no FAQ
    merged, index = _fixture()
    for b in merged["bids"]:
        if b["operator"].startswith("Acme"):
            b["stale"], b["sourceStatus"] = True, "broken"
    with tempfile.TemporaryDirectory() as td:
        out, sm = os.path.join(td, "cash-bids"), os.path.join(td, "sm.xml")
        CB.build_all(merged, index, ZT, out_dir=out, root=".", sitemap=sm, min_towns=0,
                     now=CB.parse_ts("2026-10-07T19:00:00Z"))
        p = open(os.path.join(out, SUBDIR, "acme-co-op.html"), encoding="utf-8").read()
        assert 'content="noindex,follow"' in p and '<p class="cbt-answer">' not in p and "FAQPage" not in p
        assert "<b>No current bid.</b>" in p
        assert "acme-co-op</loc>" not in open(sm, encoding="utf-8").read()
    print("build_company_pages selftest ok")


if __name__ == "__main__":
    if sys.argv[1:] == ["--selftest"]:
        selftest()
    else:
        raise SystemExit("company pages are built by scripts/build_cash_bid_pages.py; "
                         "this file runs on its own only with --selftest")
