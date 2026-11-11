#!/usr/bin/env python3
"""page_tabs.py: the tab bar for a page that holds what used to be several pages (Nov 11, 2026).

/rain holds the radar lookup, rain by county and the drought monitor; /spray holds the spray advisory,
urea loss and fall anhydrous. The old addresses forward to a tab (scripts/moved_pages.py: /rain-radar ->
/rain#radar). This module writes the parts both pages share, so the two never drift:

  open_html(ids, default, label, tabs)  the box, the tab bar and the early pick (inline, before the panels:
                                        it reads the #hash and marks the open tab before the first paint,
                                        so nothing jumps when components/page-tabs.js arrives)
  css(ids)                              the tab bar's style and the rule that shows only the open panel
  SCRIPT                                the script tag for components/page-tabs.js (behaviour, lazy panel code)

Without JavaScript the box never gets data-on, so every panel shows and the tab links jump to them.

  python3 scripts/page_tabs.py --selftest
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import sys

V = 1
SCRIPT = f'<script src="/components/page-tabs.js?v={V}" defer></script>'

PICK = ("(function(s){var c=s.parentNode,i=c.getAttribute('data-ptabs').split(' '),"
        "h=decodeURIComponent((location.hash||'').slice(1)).replace(/^p-/,''),"
        "o=i.indexOf(h)>=0?h:c.getAttribute('data-default');c.setAttribute('data-on',o);"
        "[].forEach.call(c.querySelectorAll('[role=tab]'),function(t){var y=t.getAttribute('data-tab')===o;"
        "t.setAttribute('aria-selected',y?'true':'false');t.setAttribute('tabindex',y?'0':'-1');});})(document.currentScript);")


def css(ids):
    shown = ",".join(f'.ptabs[data-on="{i}"]>#p-{i}' for i in ids)
    return (".ptab-bar{display:flex;gap:.35rem;overflow-x:auto;scrollbar-width:none;max-width:1100px;margin:.6rem auto .2rem;"
            "padding:0 1rem;border-bottom:1px solid var(--border)}"
            ".ptab-bar::-webkit-scrollbar{display:none}"
            ".ptab-bar a{flex:0 0 auto;display:flex;align-items:center;gap:.35rem;min-height:44px;padding:.35rem .85rem;"
            "border:1px solid transparent;border-bottom:0;border-radius:8px 8px 0 0;color:var(--text-dim);font-weight:700;"
            "font-size:.92rem;text-decoration:none;white-space:nowrap;margin-bottom:-1px}"
            ".ptab-bar a:hover{color:var(--text)}.ptab-bar a[role=tab]{scroll-margin-top:5rem}"
            ".ptab-bar a[aria-selected=\"true\"]{color:var(--text);background:var(--surface);border-color:var(--border);"
            "box-shadow:inset 0 3px 0 var(--gold)}"
            ".ptab-bar a:focus-visible{outline:2px solid var(--gold);outline-offset:-2px}"
            ".ptab-bar svg{width:1em;height:1em;stroke:currentColor;fill:none;stroke-width:2}"
            # phones: the site's 12px gutter sits on <main> (components/styles.css); a panel's own .main wrapper
            # (a whole page until Nov 11, 2026) adds none on top, as when it was the <main> itself
            "@media(max-width:480px){.ptab-bar{gap:.15rem;padding:0 .5rem}.ptab-bar a{padding:.3rem .55rem;font-size:.86rem}"
            ".ptabs>.ptab>.main{padding-left:0!important;padding-right:0!important}"
            # and the column wrappers styles.css pads as main's own children (main > .pg, ...) keep that gutter here
            ".ptabs>.ptab>.main>:is(.ls-w,.prf,.rc,.rg,.sos,.pg,.le,.hb,.wrap,article),"
            ".ptabs>.ptab>:is(.rc,article,.dm-page),.ptabs>.ptab>.fn-wrap>article{"
            "padding-left:max(0px,calc(var(--gutter,12px) - (100vw - 100%) / 2))!important;"
            "padding-right:max(0px,calc(var(--gutter,12px) - (100vw - 100%) / 2))!important}}"
            ".ptab{scroll-margin-top:4rem}main.ptab-main{padding:0;margin:0;max-width:none}.ptab-bar a:target{outline:0}"
            ".ptabs[data-on]>.ptab{display:none}"
            f"{shown}{{display:block}}"
            ".ptabs[data-on]>.ptab[data-css]:not([data-ready])>*{visibility:hidden}"
            ".ptab-note{max-width:780px;margin:1rem auto;padding:0 1rem;color:var(--red)}")


def open_html(ids, default, label, tabs, indent="  "):
    """tabs: [(id, words)] in order. Returns the box's opening tag, the bar and the early pick;
    the caller writes the panels (<section class="ptab" id="p-<id>" role="tabpanel"
    aria-labelledby="<id>">) and closes the box with </div>. Each tab link carries the tab's own name as its id,
    so /rain#drought (the old page's forward) lands on the tab bar with that tab open."""
    assert [t[0] for t in tabs] == list(ids) and default in ids
    sel = ' aria-selected="true"'
    links = "".join(f'<a role="tab" id="{i}" href="#p-{i}" data-tab="{i}" aria-controls="p-{i}"'
                    f'{sel if i == default else ""}>{w}</a>' for i, w in tabs)
    return (f'{indent}<div class="ptabs" data-ptabs="{" ".join(ids)}" data-default="{default}">\n'
            f'{indent}  <div class="ptab-bar" role="tablist" aria-label="{label}">{links}</div>\n'
            f'{indent}  <script>{PICK}</script>\n')


def panel_open(i, extra="", indent="  "):
    return f'{indent}<section class="ptab" id="p-{i}" role="tabpanel" aria-labelledby="{i}"{extra}>\n'


def selftest():
    ok = 0
    h = open_html(["a", "b"], "a", "Rain", [("a", "Radar"), ("b", "County")])
    assert 'data-ptabs="a b"' in h and 'href="#p-b"' in h and h.count('role="tab"') == 2
    assert "document.currentScript" in h and "—" not in h
    ok += 1
    c = css(["a", "b"])
    assert '.ptabs[data-on="a"]>#p-a,.ptabs[data-on="b"]>#p-b{display:block}' in c
    ok += 1
    # the early pick: a tab name or a panel id in the hash opens it, anything else opens the default
    import subprocess, json, shutil
    if shutil.which("node"):
        js = ("var at={};var tabs=[{a:{}},{a:{}}];tabs[0].getAttribute=function(){return 'a'};tabs[1].getAttribute=function(){return 'b'};"
              "tabs.forEach(function(t){t.setAttribute=function(k,v){t.a[k]=v}});"
              "var c={getAttribute:function(k){return k==='data-ptabs'?'a b':'a'},setAttribute:function(k,v){at[k]=v},"
              "querySelectorAll:function(){return tabs}};var document={currentScript:{parentNode:c}};var out=[];"
              "[\"\",\"#b\",\"#p-b\",\"#zz\"].forEach(function(h){var location={hash:h};" + PICK + "out.push(at['data-on']+tabs[1].a['aria-selected']);});"
              "console.log(JSON.stringify(out));")
        r = json.loads(subprocess.run(["node", "-e", js], capture_output=True, text=True, check=True).stdout)
        assert r == ["afalse", "btrue", "btrue", "afalse"], r
        ok += 1
    print(f"page_tabs selftest: {ok} passed")


if __name__ == "__main__":
    if "--selftest" in sys.argv[1:]:
        selftest()
    else:
        print(__doc__)
