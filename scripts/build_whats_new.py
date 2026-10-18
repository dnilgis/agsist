#!/usr/bin/env python3
"""What's new: data/whats-new.json drives two places.

  index.html     the small card near the top: the newest CARD_N entries,
                 baked into the page (no fetch, so no layout shift), each one
                 hideable by the reader (localStorage agsist-wn-hide).
  changelog.html every entry, as day sections above the older hand-written
                 log, which is kept as it is; the stamp line is recounted.

  python3 scripts/build_whats_new.py          write both pages
  python3 scripts/build_whats_new.py --check  fail if either page is stale
"""
import datetime as dt
import html
import json
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(REPO, "data", "whats-new.json")
INDEX = os.path.join(REPO, "index.html")
CHANGELOG = os.path.join(REPO, "changelog.html")
CARD_N = 4
MONTHS = ["January", "February", "March", "April", "May", "June", "July",
          "August", "September", "October", "November", "December"]


def esc(s):
    return html.escape(s, quote=True)


def load():
    d = json.load(open(DATA, encoding="utf-8"))
    items = d["items"]
    for it in items:
        dt.date.fromisoformat(it["date"])
        for k in ("id", "title", "line", "link"):
            if not it.get(k):
                raise SystemExit("whats-new item missing %s: %r" % (k, it))
        if "—" in it["title"] + it["line"]:
            raise SystemExit("em dash in whats-new item " + it["id"])
    dates = [it["date"] for it in items]
    if dates != sorted(dates, reverse=True):
        raise SystemExit("data/whats-new.json must be newest first")
    if len({it["id"] for it in items}) != len(items):
        raise SystemExit("data/whats-new.json ids must be unique")
    return items


def short_date(iso):
    d = dt.date.fromisoformat(iso)
    return "%s %d" % (MONTHS[d.month - 1][:3], d.day)


def long_date(iso):
    d = dt.date.fromisoformat(iso)
    return "%s %d, %d" % (MONTHS[d.month - 1], d.day, d.year)


CARD_CSS = (
    ".wn-card{margin:0 0 16px;padding:0;box-sizing:border-box;font-family:var(--font-body,Inter,system-ui,sans-serif)}"
    ".wn-in{border:1px solid var(--border-2,rgba(132,160,168,.24));border-radius:8px;background:var(--surface2,transparent);padding:10px 12px 4px}"
    ".wn-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin:0 0 4px}"
    ".wn-head h2{margin:0;font-size:.78rem;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted);font-weight:700}"
    ".wn-head a{font-size:.82rem;color:var(--gold,#d4a23f);text-decoration:none;font-weight:600;padding:6px 0}"
    ".wn-list{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:1fr;gap:0}"
    ".wn-list li{display:flex;align-items:flex-start;gap:8px;padding:6px 0;border-top:1px solid var(--hair,rgba(132,160,168,.12));min-width:0}"
    ".wn-list li:first-child{border-top:0}"
    ".wn-list li[hidden]{display:none}"
    ".wn-list a{flex:1;min-width:0;color:var(--text);text-decoration:none!important;font-size:.9rem;line-height:1.4;padding:3px 0}"
    ".wn-list a b{color:var(--gold,#d4a23f);font-weight:600}"
    ".wn-list a:hover b{text-decoration:underline}"
    ".wn-list a span{color:var(--text-dim,var(--text-muted))}"
    ".wn-list time{flex:none;font-size:.78rem;color:var(--text-muted);padding-top:.15rem;white-space:nowrap}"
    ".wn-x{flex:none;width:32px;height:32px;margin:-5px -6px -5px 0;border:0;background:none;color:var(--text-muted);font-size:1.1rem;line-height:1;cursor:pointer;border-radius:6px}"
    ".wn-x:hover{color:var(--text)}.wn-x:focus-visible{outline:2px solid var(--gold,#d4a23f)}"
    "@media(max-width:640px){.wn-list a span{display:none}}"
    "@media(min-width:900px){.wn-list{grid-template-columns:1fr 1fr;column-gap:24px}.wn-list li:nth-child(2){border-top:0}}"
)

CARD_JS = (
    "(function(){var c=document.getElementById('wn-card');if(!c)return;var K='agsist-wn-hide',h=[];"
    "try{h=JSON.parse(localStorage.getItem(K)||'[]')||[];}catch(e){}"
    "var lis=c.querySelectorAll('li[data-wn]');"
    "function left(){var n=0;for(var i=0;i<lis.length;i++)if(!lis[i].hidden)n++;if(!n)c.hidden=true;return n;}"
    "for(var i=0;i<lis.length;i++)if(h.indexOf(lis[i].getAttribute('data-wn'))>=0)lis[i].hidden=true;left();"
    "c.addEventListener('click',function(e){var b=e.target.closest&&e.target.closest('.wn-x');if(!b)return;"
    "var li=b.closest('li'),id=li.getAttribute('data-wn');li.hidden=true;"
    "if(h.indexOf(id)<0)h.push(id);try{localStorage.setItem(K,JSON.stringify(h.slice(-60)));}catch(e){}"
    "if(left()){var nx=c.querySelector('li[data-wn]:not([hidden]) .wn-x');if(nx)nx.focus();}});})();"
)


def card_html(items):
    lis = []
    for it in items[:CARD_N]:
        lis.append(
            '<li data-wn="%s"><a href="%s"><b>%s</b> <span>%s</span></a>'
            '<time datetime="%s">%s</time>'
            '<button type="button" class="wn-x" aria-label="Hide %s">&times;</button></li>'
            % (esc(it["id"]), esc(it["link"]), esc(it["title"]), esc(it["line"]),
               it["date"], short_date(it["date"]), esc(it["title"])))
    return (
        "<!-- WHATSNEW:card (scripts/build_whats_new.py from data/whats-new.json; do not edit by hand) -->\n"
        "<style>" + CARD_CSS + "</style>\n"
        '<aside class="wn-card" id="wn-card" aria-labelledby="wn-h"><div class="wn-in">'
        '<div class="wn-head"><h2 id="wn-h">What&rsquo;s new</h2><a href="/changelog">All changes</a></div>'
        '<ul class="wn-list">' + "".join(lis) + "</ul></div></aside>\n"
        "<script>" + CARD_JS + "</script>\n"
        "<!-- /WHATSNEW:card -->"
    )


def changelog_html(items):
    days, order = {}, []
    for it in items:
        if it["date"] not in days:
            days[it["date"]] = []
            order.append(it["date"])
        days[it["date"]].append(it)
    out = []
    for d in order:
        cells = "".join(
            '<div class="cl-item" id="%s"><div class="cl-top"><span class="cl-tag cl-tag--new">New</span>'
            '<a class="cl-page" href="%s">%s</a></div><p class="cl-text">%s</p></div>'
            % (esc(it["id"]), esc(it["link"]), esc(it["title"]), esc(it["line"])) for it in days[d])
        out.append('<section class="cl-day"><h2 class="cl-date">%s</h2><div class="cl-items">%s</div></section>'
                   % (long_date(d), cells))
    return "<!-- WHATSNEW:entries -->" + "".join(out) + "<!-- /WHATSNEW:entries -->"


def replace_block(src, start, end, new, fallback_before=None):
    i, j = src.find(start), src.find(end)
    if i >= 0 and j > i:
        return src[:i] + new + src[j + len(end):]
    if fallback_before is None or fallback_before not in src:
        raise SystemExit("marker not found: " + start)
    k = src.index(fallback_before)
    return src[:k] + new + "\n" + src[k:]


def build_index(src, items):
    return replace_block(src, "<!-- WHATSNEW:card", "<!-- /WHATSNEW:card -->", card_html(items),
                         fallback_before="<svg width=\"0\" height=\"0\" style=\"position:absolute\"")


def build_changelog(src, items):
    src = replace_block(src, "<!-- WHATSNEW:entries -->", "<!-- /WHATSNEW:entries -->", changelog_html(items),
                        fallback_before="<!-- CHANGELOG:entries -->")
    src = src.replace(changelog_html(items) + "\n<!-- CHANGELOG:entries -->", changelog_html(items) + "<!-- CHANGELOG:entries -->")
    lst = src[src.index("<!-- WHATSNEW:entries -->"):src.index("<!-- /CHANGELOG:entries -->")]
    n_items = lst.count('class="cl-item"')
    n_days = len(set(re.findall(r'<h[23] class="cl-date">(.*?)</h[23]>', lst, flags=re.S)))
    stamp = "Log updated %s &middot; %d changes across %d days" % (long_date(items[0]["date"]), n_items, n_days)
    return re.sub(r"(<!-- CHANGELOG:stamp -->).*?(<!-- /CHANGELOG:stamp -->)", lambda m: m.group(1) + stamp + m.group(2), src, flags=re.S)


def main():
    items = load()
    jobs = [(INDEX, build_index), (CHANGELOG, build_changelog)]
    stale = []
    for path, fn in jobs:
        src = open(path, encoding="utf-8").read()
        new = fn(src, items)
        if new != src:
            if "--check" in sys.argv:
                stale.append(os.path.relpath(path, REPO))
            else:
                with open(path, "w", encoding="utf-8") as fh:
                    fh.write(new)
                print("wrote " + os.path.relpath(path, REPO))
    if stale:
        print("stale (run scripts/build_whats_new.py): " + ", ".join(stale))
        sys.exit(1)
    if "--check" in sys.argv:
        print("index.html and changelog.html match data/whats-new.json")


if __name__ == "__main__":
    main()
