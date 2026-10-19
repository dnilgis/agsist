#!/usr/bin/env python3
"""One-off generator for the Oct 18 menu (fx/navfull). Writes components/header.html
(after the icon sprite), header-fallback.html, footer.html (band, link columns, bottom row) and
footer-fallback.html from one menu table, so the four never disagree.
Usage: python3 gen_nav.py <worktree>"""
import re
import sys
import pathlib

W = pathlib.Path(sys.argv[1])
C = W / "components"

# (href, label, icon[, "all"])
PRICES = [
    ("Near you", [("/cash-bids", "Cash bids near me", "i-banknote"),
                  ("/cash-bids/states", "Bids by state", "i-map"),
                  ("/basis", "Basis vs normal", "i-chart-column"),
                  ("/cash-bid-index", "Cash Bid Index", "i-chart-column"),
                  ("/fertilizer", "Fertilizer prices", "i-leaf")]),
    ("Futures", [("/corn-futures-prices", "Corn", "i-corn"),
                 ("/soybean-futures-prices", "Soybeans", "i-bean"),
                 ("/wheat-futures-prices", "Wheat", "i-wheat"),
                 ("/harvest-price-tracker", "Harvest price tracker", "i-trending-up"),
                 ("/markets", "All markets", "i-chart-candlestick", "all")]),
    ("Reports", [("/usda-calendar", "USDA calendar", "i-calendar"),
                 ("/whats-priced-in", "What&rsquo;s priced in", "i-dices"),
                 ("/conditions", "Crop progress", "i-sun"),
                 ("/conditions-yield", "Crop size", "i-target"),
                 ("/crop-tour", "Crop tour", "i-map"),
                 ("/cot", "Fund positions (COT)", "i-chart-column"),
                 ("/tariffs", "Tariffs and trade", "i-landmark")]),
]
LIVESTOCK = [
    (None, [("/cattle-auction-prices", "Sale barn prices", "i-beef"),
            ("/cattle-futures-prices", "Cattle futures", "i-chart-candlestick"),
            ("/milk-prices", "Milk", "i-milk"),
            ("/hay-prices", "Hay", "i-sprout"),
            ("/haymow", "The Haymow", "i-warehouse"),
            ("/lrp", "LRP", "i-shield-check"),
            ("/prf", "PRF", "i-shield-check"),
            ("/manure-value", "Manure value", "i-sprout"),
            ("/drought-monitor", "Drought monitor", "i-sun")]),
]
FIELD = [
    ("Weather", [("/rain-radar", "Rain on your field", "i-cloud-rain"),
                 ("/rain", "Rain by county", "i-map"),
                 ("/hail-map", "Hail map", "i-cloud-hail"),
                 ("/spray", "Spray advisory", "i-spray-can"),
                 ("/fall-nitrogen", "Soil temp (fall anhydrous)", "i-thermometer"),
                 ("/rain-print", "Rain Print", "i-cloud-rain"),
                 ("/rain-gauge", "Rain gauge waitlist", "i-test-tube")]),
    ("Crop", [("/gdu-calculator", "GDU", "i-thermometer"),
              ("/planting-date", "Planting date", "i-calendar-days"),
              ("/urea", "Urea loss", "i-flask-conical"),
              ("/nutrient-removal", "Nutrient removal", "i-sprout"),
              ("/field-scout", "Field Scout", "i-satellite"),
              ("/yield-estimator", "Yield estimator", "i-package"),
              ("/pod-counts", "Pod counts", "i-target")]),
    ("Harvest and bins", [("/harvest-or-wait", "Harvest now or wait", "i-tractor"),
                          ("/grain-emc", "Grain drying (EMC)", "i-thermometer"),
                          ("/grain-shrink", "Grain shrink", "i-warehouse"),
                          ("/grain-bin-calculator", "Bin calculator", "i-warehouse"),
                          ("/combine-loss", "Combine loss", "i-tractor"),
                          ("/tools", "All tools", "i-calculator", "all")]),
]
MONEY = [
    ("Land", [("/rent/", "Cash rent", "i-banknote"),
              ("/farmland-atlas", "Farmland Atlas", "i-map"),
              ("/custom-rates", "Custom rates", "i-banknote"),
              ("/cash-lease", "Lease form", "i-scroll-text")]),
    ("Programs", [("/arc-plc", "ARC or PLC", "i-calculator"),
                  ("/prf", "PRF", "i-shield-check"),
                  ("/lrp", "LRP", "i-beef"),
                  ("/farm-bill", "Farm bill", "i-scroll-text")]),
    ("Selling", [("/store-or-sell", "Sell or store", "i-warehouse"),
                 ("/breakeven", "Break-even", "i-scale"),
                 ("/commodity-loan", "CCC loan", "i-banknote")]),
]
SIGNUP = ("SIGNUP", "Get it by email", None)
# A short line under a link's name, in the menu and the phone panel only (not the footer
# or the no-script copies). 2026-10-18 (Sig: "add it to the menu"): The Haymow.
SUBLINE = {"/haymow": "Hay for sale and wanted"}


def name_html(it):
    sub = SUBLINE.get(it[0])
    if not sub:
        return it[1]
    return f'<span class="nav-two"><span>{it[1]}</span><span class="nav-sub">{sub}</span></span>'

DAILY = [
    (None, [("/daily", "Today&rsquo;s briefing", "i-sunrise"),
            SIGNUP,
            ("/news", "The Wire", "i-newspaper"),
            ("/archive", "Archive", "i-archive")]),
]
GROUPS = [("markets", "Prices", "i-chart-candlestick", PRICES),
          ("livestock", "Livestock", "i-beef", LIVESTOCK),
          ("field", "Field", "i-tractor", FIELD),
          ("money", "Money &amp; Land", "i-calculator", MONEY),
          ("daily", "Daily", "i-sunrise", DAILY)]

MOVED = ('<p class="nav-moved" data-nav-moved data-until="2026-11-01" hidden>'
         '<span>Harvest tools moved to Field</span>'
         '<button type="button" class="nav-moved-x" aria-label="Dismiss: harvest tools moved to Field">'
         '<svg class="lic" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-x"/></svg></button></p>')


def ic(i):
    return f'<svg class="lic" viewBox="0 0 24 24" aria-hidden="true"><use href="#{i}"/></svg>'


def signup_box(where):
    return (f'<div class="nav-ask" data-signup-hide><div data-signup-ask="Free, every weekday morning: the markets and your top local bid" '
            f'data-source="menu-{where}" data-reports="0"></div></div>')


CHEV = ('<svg class="chevron" width="10" height="6" viewBox="0 0 10 6" fill="none" aria-hidden="true">'
        '<path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>')


def desk_link(it):
    if it[0] == "SIGNUP":
        return f'            <div class="nav-q nav-q-ask">{it[1]}</div>\n            {signup_box("desk")}\n'
    cls = ' class="all"' if len(it) > 3 else ""
    arrow = " &rarr;" if len(it) > 3 else ""
    return f'            <a href="{it[0]}"{cls}>{ic(it[2])}{name_html(it)}{arrow}</a>\n'


def desktop():
    out = ['    <div class="nav-menu">\n']
    for gid, name, icon, subs in GROUPS:
        cols = len(subs)
        pcls = "nav-panel" + (f" nav-cols nav-cols-{cols}" if cols > 1 else "")
        out.append(f'      <div class="nav-dd" id="dd-{gid}">\n')
        out.append(f'        <button class="nav-btn" aria-haspopup="true" aria-expanded="false" aria-controls="dd-{gid}-panel">'
                   f'<svg class="nav-ic" viewBox="0 0 24 24" aria-hidden="true"><use href="#{icon}"/></svg>{name}{CHEV}</button>\n')
        out.append(f'        <div id="dd-{gid}-panel" class="{pcls}">\n')
        if gid == "money":
            out.append(f'          {MOVED}\n')
        for sub, items in subs:
            out.append('          <div class="nav-col">\n')
            if sub:
                out.append(f'            <div class="nav-q">{sub}</div>\n')
            for it in items:
                out.append(desk_link(it))
            out.append('          </div>\n')
        out.append('        </div>\n      </div>\n')
    out.append('    </div>\n')
    return "".join(out)


def drawer_group(gid, name, icon, subs):
    out = [f'  <section class="draw-sec draw-grp" aria-labelledby="dg-{gid}">\n'
           f'    <h2 class="draw-lbl" id="dg-{gid}"><svg class="draw-lbl-ic" viewBox="0 0 24 24" aria-hidden="true"><use href="#{icon}"/></svg>{name}</h2>\n']
    if gid == "money":
        out.append(f'    {MOVED}\n')
    for sub, items in subs:
        if sub:
            out.append(f'    <h3 class="draw-sub">{sub}</h3>\n')
        links, ask = [], ""
        for it in items:
            if it[0] == "SIGNUP":
                ask = f'    <h3 class="draw-sub" data-signup-hide>{it[1]}</h3>\n    {signup_box("phone")}\n'
                continue
            cls = "draw-item draw-all" if len(it) > 3 else "draw-item"
            arrow = " &rarr;" if len(it) > 3 else ""
            links.append(f'      <a href="{it[0]}" class="{cls}">{ic(it[2])}{name_html(it)}{arrow}</a>\n')
        out.append('    <div class="draw-links">\n' + "".join(links) + '    </div>\n')
        out.append(ask)
    out.append('  </section>\n')
    return "".join(out)


THEME_ICONS = None


def drawer(theme_btn_d):
    out = ['<!-- ══ PHONE MENU PANEL ══════════════════════════════════════════ -->\n'
           '<div class="drawer" id="drawer" aria-hidden="true" role="dialog" aria-modal="true" aria-label="Site navigation">\n'
           '  <div class="draw-head">\n'
           '    <img class="lg-d" src="/img/logo-agsist-ondark.svg" alt="AGSIST" width="317" height="148" style="height:30px;width:auto;object-fit:contain">\n'
           '    <img class="lg-l" src="/img/logo-agsist-onlight.svg" alt="AGSIST" width="317" height="148" style="height:30px;width:auto;object-fit:contain">\n'
           '    <button class="draw-close" id="draw-close" aria-label="Close menu">' + ic("i-x") + '</button>\n'
           '  </div>\n'
           '  <div class="draw-srch"><button type="button" class="draw-srch-btn" id="draw-srch" aria-haspopup="dialog">'
           '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>'
           '<span>Search prices, tools, towns or a ZIP</span></button></div>\n'
           '  <section class="draw-place" aria-labelledby="dp-h">\n'
           '    <h2 class="draw-place-h" id="dp-h">My place <span class="draw-place-z" id="dp-zip"></span></h2>\n'
           '    <div class="draw-place-row">\n'
           '      <a href="/cash-bids" class="draw-pl" id="dp-bids">' + ic("i-banknote") + 'Bids near me</a>\n'
           '      <a href="/rain-radar" class="draw-pl" id="dp-rain">' + ic("i-cloud-rain") + 'Rain at my field</a>\n'
           '      <a href="/rent/" class="draw-pl" id="dp-rent">' + ic("i-map") + 'Rent in my county</a>\n'
           '    </div>\n'
           '  </section>\n']
    for g in GROUPS:
        out.append(drawer_group(*g))
    out.append('  <a href="/rain-print" class="draw-rp"><span class="draw-rp-k">Rain Print</span>'
               '<span class="draw-rp-t">Your farm&rsquo;s year of rain, framed</span><span class="draw-rp-go" aria-hidden="true">&rarr;</span></a>\n')
    out.append('  <div class="draw-sec draw-end">\n'
               '    <a href="/about" class="draw-item">' + ic("i-book-open") + 'About</a>\n'
               '    <a href="/contact" class="draw-item">' + ic("i-mail") + 'Contact</a>\n'
               '    <div class="draw-theme">\n'
               '      <span id="theme-lbl-d">Display mode</span>\n'
               f'      {theme_btn_d}\n'
               '    </div>\n'
               '  </div>\n'
               '</div>\n'
               '<div class="draw-ov" id="draw-ov" aria-hidden="true"></div>\n')
    return "".join(out)


PIN = ('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/>'
       '<circle cx="12" cy="9.5" r="2.5"/></svg>')


def actions(theme_btn):
    return ('    <div class="nav-actions">\n'
            '      <div class="zip-wrap">\n'
            '        <button type="button" class="zip-chip" id="zip-chip" aria-haspopup="dialog" aria-expanded="false" aria-controls="zip-pop">'
            f'{PIN}<span class="zip-chip-t" id="zip-chip-t">Set your ZIP</span></button>\n'
            '        <div class="zip-pop" id="zip-pop" role="dialog" aria-label="Your ZIP" hidden>\n'
            '          <form class="zip-f" id="zip-f" novalidate>\n'
            '            <label for="zip-in">Your ZIP, for bids, rain and rent near you</label>\n'
            '            <div class="zip-row"><input id="zip-in" type="text" inputmode="numeric" autocomplete="postal-code" maxlength="5" pattern="[0-9]{5}" placeholder="54728">'
            '<button type="submit" class="zip-save">Save</button></div>\n'
            '            <p class="zip-m" id="zip-m" role="status" aria-live="polite"></p>\n'
            '            <p class="zip-links" id="zip-links" hidden><a href="/cash-bids" id="zip-go">See bids near you &rarr;</a>'
            '<button type="button" class="zip-clear" id="zip-clear">Clear</button></p>\n'
            '            <p class="zip-note">Kept in this browser only.</p>\n'
            '          </form>\n'
            '        </div>\n'
            '      </div>\n'
            '      <button type="button" class="srch-btn" id="srch-btn" aria-label="Search the site" aria-haspopup="dialog" aria-expanded="false" aria-keyshortcuts="/ Control+K Meta+K">'
            '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>'
            '<span class="srch-btn-t">Search</span><kbd aria-hidden="true">/</kbd></button>\n'
            '      <button type="button" class="nav-email" id="nav-email" aria-controls="dd-daily-panel" data-signup-hide>Free daily email</button>\n'
            f'      {theme_btn}\n'
            '      <button class="hamburger" id="hamburger" aria-label="Open menu" aria-expanded="false">\n'
            '        <span class="h-bar"></span><span class="h-bar"></span><span class="h-bar"></span>\n'
            '      </button>\n'
            '    </div>\n')


STYLE = r"""<style>
/* Theme-aware wordmark. Lives inline here (not styles.css) so a chrome deploy
   doesn't require a styles.css ?v bump; header.html is already cache-busted
   by loader CV + sw CACHE_VERSION. .lg-d = on-dark SVG, .lg-l = on-light. */
.lg-l{display:none}
[data-theme="light"] .lg-l{display:inline-block}
[data-theme="light"] .lg-d{display:none}
/* Site search button. Inline so its space is set when the header lands; the
   sheet itself (components/search.js + search.css) loads on first open. */
.srch-btn{display:flex;align-items:center;gap:.45rem;min-height:44px;min-width:44px;padding:0 .7rem;background:none;border:1px solid var(--border);border-radius:var(--r-sm);color:var(--text-dim);font:inherit;font-size:.82rem;font-weight:600;cursor:pointer}
.srch-btn:hover,.srch-btn:focus-visible{border-color:var(--brand);color:var(--brand)}
.srch-btn svg{width:18px;height:18px;flex:0 0 auto;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round}
.srch-btn kbd{font:inherit;font-size:.72rem;line-height:1;padding:.18rem .4rem;border:1px solid var(--border);border-radius:4px;color:var(--text-muted)}
@media (max-width:1440px){.srch-btn .srch-btn-t,.srch-btn kbd{display:none}.srch-btn{justify-content:center;padding:0}}
/* 2026-10-18 menu (Sig: "do all of it"): Prices | Livestock | Field | Money & Land | Daily.
   Short noun subheads; a panel with two or three subheads shows them side by side.
   loader.js keeps an open panel inside the window. */
.nav-panel.nav-cols{display:grid;grid-template-columns:repeat(var(--cols,2),minmax(190px,auto));column-gap:.25rem;width:max-content;max-width:calc(100vw - 32px)}
.nav-panel.nav-cols-3{--cols:3}
.nav-panel .nav-moved{grid-column:1/-1}
.nav-q{padding:.55rem 1.1rem .2rem;font-family:var(--font-mono);font-size:.72rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--text-muted);white-space:nowrap}
.nav-panel a{padding:.5rem 1.1rem}
/* A link with a short line under its name (The Haymow: "Hay for sale and wanted"). */
.nav-two{display:flex;flex-direction:column;gap:.1rem;line-height:1.2;min-width:0}
.nav-sub{font-size:.74rem;font-weight:400;color:var(--text-muted);white-space:normal}
.nav-panel .nav-sub{white-space:nowrap}
#dd-daily-panel{left:auto;right:0;min-width:300px}
.nav-ask{padding:.2rem 1.1rem .5rem;max-width:300px}
.nav-ask .sa-ask{margin:0}
.nav-ask .sa-ask--page{padding:0;background:none;border:0}
.nav-ask .sa-f{grid-template-columns:minmax(0,1fr) auto;gap:6px 8px}
.nav-ask .sa-l{grid-column:1/-1;font-size:.82rem;font-weight:500;color:var(--text-dim)}
.nav-ask .sa-in{grid-column:1}
.nav-ask .sa-b{grid-column:2}
.nav-ask[hidden],.nav-q-ask[hidden]{display:none}
.nav-moved{display:flex;align-items:center;justify-content:space-between;gap:.5rem;margin:.1rem .8rem .35rem;padding:.3rem .3rem .3rem .7rem;border:1px solid var(--border);border-left:3px solid var(--brand);border-radius:var(--r-sm);font-size:.8rem;color:var(--text-dim)}
.nav-moved[hidden]{display:none}
.nav-moved-x{flex:0 0 auto;display:flex;align-items:center;justify-content:center;width:32px;height:32px;background:none;border:0;border-radius:var(--r-sm);color:var(--text-muted);cursor:pointer}
.nav-moved-x:hover,.nav-moved-x:focus-visible{color:var(--brand)}
/* ZIP chip: the saved ZIP, "Bids near <town>"; a click opens the small ZIP box. */
.zip-wrap{position:relative}
.zip-chip{display:flex;align-items:center;gap:.35rem;min-height:44px;max-width:210px;padding:0 .7rem;background:none;border:1px solid var(--border);border-radius:999px;color:var(--text-dim);font:inherit;font-size:.8rem;font-weight:600;cursor:pointer}
.zip-chip:hover,.zip-chip:focus-visible,.zip-chip[aria-expanded="true"]{border-color:var(--brand);color:var(--brand)}
.zip-chip svg{width:16px;height:16px;flex:0 0 auto;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.zip-chip-t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.zip-pop{position:absolute;top:calc(100% + 8px);right:0;z-index:520;width:280px;padding:.8rem .9rem;background:var(--surface);border:2px solid var(--border-g,var(--border));border-radius:var(--r-md);box-shadow:0 8px 32px rgba(0,0,0,.35)}
.zip-pop[hidden]{display:none}
.zip-f label{display:block;font-size:.8rem;font-weight:600;color:var(--text);margin-bottom:.4rem}
.zip-row{display:flex;gap:.4rem}
.zip-row input{flex:1;min-width:0;min-height:44px;padding:0 .6rem;font:inherit;font-size:16px;color:var(--text);background:var(--bg,transparent);border:1px solid var(--border);border-radius:var(--r-sm)}
.zip-row input:focus-visible{outline:2px solid var(--brand);outline-offset:1px}
.zip-save{min-height:44px;padding:0 .9rem;font:inherit;font-size:.85rem;font-weight:700;color:#0a0c0d;background:#d4a23f;border:0;border-radius:var(--r-sm);cursor:pointer}
.zip-m{min-height:1em;margin:.4rem 0 0;font-size:.78rem;color:var(--text-dim)}
.zip-m:empty{display:none}
.zip-links{display:flex;align-items:center;justify-content:space-between;gap:.5rem;margin:.45rem 0 0;font-size:.82rem}
.zip-links[hidden]{display:none}
.zip-links a{color:var(--brand);font-weight:700;text-decoration:none}
.zip-clear{min-height:36px;background:none;border:0;color:var(--text-muted);font:inherit;font-size:.78rem;text-decoration:underline;cursor:pointer}
.zip-note{margin:.45rem 0 0;font-size:.72rem;color:var(--text-muted)}
/* Free daily email: opens the Daily panel at its signup box. Hidden for subscribers.
   Same gold and dark text as the signup button (signup-ask.js .sa-b), in both themes. */
.nav-email{min-height:44px;padding:0 .9rem;font:inherit;font-size:.82rem;font-weight:700;color:#0a0c0d;background:#d4a23f;border:0;border-radius:var(--r-sm);white-space:nowrap;cursor:pointer}
.nav-email:hover,.nav-email:focus-visible{filter:brightness(1.08)}
.nav-email[hidden]{display:none}
@media (max-width:1360px){.nav-btn .nav-ic{display:none}.nav-btn{padding:.45rem .6rem}}
@media (max-width:1100px){.nav-email{display:none}.zip-chip{max-width:150px}}
@media (max-width:1060px){.nav-btn{padding:.45rem .42rem;font-size:.8rem}.zip-chip{max-width:136px}.zip-chip svg{display:none}.nav-logo{margin-right:.75rem}}
@media (max-width:960px){.zip-chip{max-width:44vw}}
@media (max-width:420px){.nav-inner{padding-left:12px;padding-right:12px}.nav-logo{margin-right:8px}.nav-logo img{height:40px}.nav-actions{gap:.35rem}.zip-chip{max-width:40vw;padding:0 .55rem}
  .zip-pop{position:fixed;top:72px;left:12px;right:12px;width:auto}}
/* Phone menu panel: search, My place, the five groups open (subheads, no folds), a Rain Print card. */
@media (max-width:480px){.drawer{width:100vw;border-left:0}}
.drawer .draw-sec{padding:.35rem 0 .5rem}
.drawer .draw-lbl{display:flex;align-items:center;gap:.4rem;margin:0;padding:.55rem 1.1rem .15rem}
.draw-sub{margin:0;padding:.45rem 1.1rem .1rem;font-family:var(--font-mono);font-size:.7rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--text-muted)}
.draw-sub[hidden]{display:none}
.draw-links{display:grid;grid-template-columns:1fr 1fr;column-gap:.25rem}
.draw-links .draw-item{min-height:44px;padding:.45rem .5rem .45rem 1.1rem;font-size:.86rem;line-height:1.25;gap:.45rem}
.draw-links .draw-item .lic{flex:0 0 auto}
#drawer a.draw-all{color:var(--brand)!important;font-weight:700}
.draw-srch{padding:.7rem 1.1rem .3rem}
.draw-srch-btn{display:flex;align-items:center;gap:.55rem;width:100%;min-height:46px;padding:0 .8rem;background:var(--bg,transparent);border:1px solid var(--border);border-radius:var(--r-sm);color:var(--text-muted);font:inherit;font-size:.9rem;text-align:left;cursor:pointer}
.draw-srch-btn:hover,.draw-srch-btn:focus-visible{border-color:var(--brand);color:var(--text)}
.draw-srch-btn svg{width:18px;height:18px;flex:0 0 auto;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round}
.draw-place{padding:.4rem 1.1rem .7rem;border-bottom:1px solid var(--border)}
.draw-place-h{display:flex;align-items:baseline;gap:.5rem;margin:0 0 .4rem;font-family:var(--font-mono);font-size:.72rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--brand)}
.draw-place-z{font-family:var(--font-body);font-size:.78rem;font-weight:600;letter-spacing:0;text-transform:none;color:var(--text-muted)}
.draw-place-row{display:grid;grid-template-columns:repeat(3,1fr);gap:.4rem}
.draw-pl{display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:.25rem;min-height:56px;padding:.45rem .55rem;border:1px solid var(--border);border-radius:var(--r-sm);font-size:.8rem;font-weight:600;line-height:1.2;color:var(--text);text-decoration:none}
.draw-pl:hover,.draw-pl:focus-visible{border-color:var(--brand)}
.draw-pl .lic{opacity:.8}
.draw-rp{display:grid;grid-template-columns:1fr auto;gap:.1rem .5rem;margin:.8rem 1.1rem;padding:.8rem .9rem;border:1px solid var(--border);border-left:3px solid var(--brand);border-radius:var(--r-md);text-decoration:none}
.draw-rp-k{font-weight:800;color:var(--text)}
.draw-rp-t{grid-column:1;font-size:.84rem;color:var(--text-dim)}
.draw-rp-go{grid-column:2;grid-row:1/3;align-self:center;color:var(--brand);font-size:1.1rem}
.drawer .nav-ask{padding:.2rem 1.1rem .5rem;max-width:none}
.drawer .nav-moved{margin:.2rem 1.1rem .3rem}
.draw-end{border-bottom:none!important}
.draw-theme{display:flex;align-items:center;justify-content:space-between;padding:.6rem 1.1rem}
.draw-theme span{font-size:.82rem;color:var(--text-dim)}
/* The signup bar and the install hint are fixed to the bottom above the
   drawer's layer; hide them while the drawer is open (loader.js sets this). */
html.drawer-open .sa-bar,html.drawer-open .agsb,html.drawer-open .pwa-hint{display:none!important}
/* 2026-10-18 menu fixes: on phones the theme switch took 73 of 390 px of the
   header. It lives in the menu panel there ("Display mode"); wide screens keep it. */
@media (max-width:960px){#theme-btn{display:none}}
/* High contrast (forced colors, 2026-10-17 field audit): the menu bars and the theme switch are drawn
   with background colors, which forced colors removes, so the menu button showed as an empty box.
   Here they take the system's text colors. */
@media (forced-colors:active){
  .hamburger .h-bar{forced-color-adjust:none;background:ButtonText;opacity:1}
  .t-track{border:1px solid ButtonText}
  .t-thumb{forced-color-adjust:none;background:ButtonText}
}
</style>
"""


def build_header():
    old = (C / "header.html").read_text(encoding="utf-8")
    cut = old.index("</defs></svg>") + len("</defs></svg>\n")
    sprite = old[:cut].replace("<!-- Lucide icon sprite (defined once; used across nav, drawer, footer) -->\n" * 3,
                               "<!-- Lucide icon sprite (defined once; used across nav, drawer, footer) -->\n")
    if '<symbol id="i-pin"' not in sprite:
        pass
    m = re.search(r'<button class="theme-btn" id="theme-btn".*?</button>', old, re.S)
    md = re.search(r'<button class="theme-btn" id="theme-btn-d".*?</button>', old, re.S)
    theme_btn, theme_btn_d = m.group(0), md.group(0)
    nav = ('<nav class="nav" id="topnav" aria-label="AGSIST main menu">\n  <div class="nav-inner">\n'
           '    <a href="/" class="nav-logo" aria-label="AGSIST Home">\n'
           '      <img class="lg-d" src="/img/logo-agsist-ondark.svg" alt="AGSIST" width="317" height="148">\n'
           '      <img class="lg-l" src="/img/logo-agsist-onlight.svg" alt="AGSIST" width="317" height="148">\n'
           '    </a>\n' + desktop() + actions(theme_btn) + '  </div>\n</nav>\n')
    (C / "header.html").write_text(sprite + STYLE + nav + drawer(theme_btn_d), encoding="utf-8")


def plain(label):
    return label


def fb_header():
    rows, seen = [], set()
    for gid, name, icon, subs in GROUPS:
        parts = []
        for sub, items in subs:
            keep = [it for it in items if it[0] != "SIGNUP" and it[0] not in seen]
            seen.update(it[0] for it in keep)
            ls = " · ".join(f'<a href="{it[0]}">{it[1]}</a>' for it in keep)
            if ls:
                parts.append((f"{sub}: " if sub else "") + ls)
        rows.append(f"        <b>{name}:</b> " + " · ".join(parts))
    rows.append('        <b>More:</b> <a href="/about">About</a> · <a href="/contact">Contact</a>')
    body = "<br>\n".join(rows)
    return ('  <!-- Static header for crawlers and no-JS (loader.js swaps in the live nav). Edit here, then run scripts/inject_static_nav.py. -->\n'
            '  <header class="snav" style="border-bottom:1px solid var(--border);background:var(--surface)">\n'
            '    <style>.snav a{color:var(--text-muted);text-decoration:none}.snav b{color:var(--text-dim)}</style>\n'
            '    <div style="max-width:1100px;margin:0 auto;padding:.7rem 1rem;display:flex;flex-wrap:wrap;align-items:baseline;gap:.4rem 1.1rem">\n'
            '      <a href="/" aria-label="AGSIST Home" style="font-family:var(--font-display);font-weight:800;font-size:1.05rem;letter-spacing:.04em;color:var(--text)">AGSIST</a>\n'
            '      <nav aria-label="AGSIST main navigation" style="font-family:\'JetBrains Mono\',monospace;font-size:0.775rem;line-height:2;color:var(--text-muted)">\n'
            + body + '\n      </nav>\n    </div>\n  </header>\n')


# Footer columns: the menu's links plus the footer-only pages.
def flat(subs):
    return [it for _, items in subs for it in items if it[0] != "SIGNUP"]


def dedupe(items):
    seen, out = set(), []
    for it in items:
        if it[0] in seen:
            continue
        seen.add(it[0])
        out.append(it)
    return out


F_PRICES = dedupe([it[:3] for it in flat(PRICES)] + [("/usda-quick-stats", "USDA crop data by state", "i-database"),
                                                      ("/scorecard", "Prediction bot", "i-clipboard-check"),
                                                      ("/elevators", "For elevators", "i-warehouse")])
F_LIVE = [it[:3] for it in flat(LIVESTOCK)]
F_FIELD = dedupe([it[:3] for it in flat(FIELD)] + [("/fast-facts", "Fast Facts reference tables", "i-book-open")])
F_MONEY = dedupe([it[:3] for it in flat(MONEY)] + [("/foreign-land", "Foreign-owned land", "i-landmark")])
F_WORK = [("/sponsor", "Advertise", "i-chart-column"),
          ("/rain-print-business", "Rain Print for business", "i-cloud-rain"),
          ("/prf-sponsor", "PRF sponsor", "i-shield-check"),
          ("/rain-gauge", "Rain gauge waitlist", "i-test-tube"),
          ("/developer", "Embeds", "i-terminal")]
F_ABOUT = [("/about", "About", "i-book-open"),
           ("/editorial-standards", "Editorial standards", "i-book-open"),
           ("/data-sources", "Data sources", "i-link"),
           ("/contact", "Contact", "i-mail"),
           ("/status", "Status", "i-shield-check"),
           ("/changelog", "What&rsquo;s new", "i-scroll-text")]
FCOLS = [("Prices", F_PRICES), ("Livestock", F_LIVE), ("Field", F_FIELD), ("Money &amp; Land", F_MONEY),
         ("Work with us", F_WORK), ("About", F_ABOUT)]
F_DAILY = [("/daily", "Today&rsquo;s briefing"), ("/news", "The Wire"), ("/archive", "Archive")]


def flink(it):
    extra = ""
    if it[0] == "/prf-sponsor":
        extra = " data-sponsor-link"
    if it[0] == "/sponsor":
        extra = """ data-sponsor-link onclick="if(typeof gtag==='function')gtag('event','sponsor_cta_click',{cta_source:'footer_work'})\""""
    return f'        <a href="{it[0]}"{extra}>{ic(it[2])}{it[1]}</a>\n'


BRAND = """      <div class="footer-brand">
        <style>/* self-contained theme swap: footer can render without header.html (fallback path) */
        .ftlg-l{display:none}
        [data-theme="light"] .ftlg-l{display:inline-block}
        [data-theme="light"] .ftlg-d{display:none}</style>
        <span class="footer-logo"><img class="ftlg-d" src="/img/logo-agsist-ondark.svg" alt="AGSIST" width="317" height="148"><img class="ftlg-l" src="/img/logo-agsist-onlight.svg" alt="AGSIST" width="317" height="148"></span>
        <p class="footer-tagline">Free agricultural prices, tools &amp; news. Built in Chetek, Wisconsin.</p>
      </div>
"""

ADSPACE = """    <div class="footer-adspace" id="footer-adspace" hidden>
      <div class="adspace-head">
        <span class="adspace-lbl">Advertise on AGSIST</span>
      </div>
      <!-- loader.js fills this with active supporters and unhides the strip -->
      <div class="adspace-row" id="adspace-row"></div>
    </div>
"""

# Bottom row: one small line (data note + where the numbers come from), then the legal links.
# The legal links stay last: test/nav-full-oct18.test.mjs reads every link after footer-legal.
BOTTOM = """    <div class="footer-bottom">
      <p class="footer-small"><span class="status-dot" aria-hidden="true"></span>Updated as each source posts. For information, not financial advice. <a href="/data-sources">Where the numbers come from</a></p>
      <div class="footer-legal">
        <span>&copy; 2026 AGSIST</span><span class="footer-sep">&middot;</span>
        <a href="/privacy">Privacy</a><span class="footer-sep">&middot;</span>
        <a href="/accessibility">Accessibility</a><span class="footer-sep">&middot;</span>
        <a href="/terms">Terms</a>
      </div>
    </div>
"""


def footer_body():
    daily = '<span class="footer-sep">&middot;</span>'.join(f'<a href="{h}">{t}</a>' for h, t in F_DAILY)
    out = ['<footer class="footer">\n  <div class="footer-inner">\n',
           '    <div class="footer-band">\n', BRAND,
           '      <div class="footer-band-side">\n'
           '        <div class="footer-band-ask"><div data-signup-ask="AGSIST Daily: the markets and your top local bid, free, every weekday morning" data-source="footer"></div></div>\n'
           f'        <p class="footer-band-daily">{daily}</p>\n'
           '        <p class="footer-band-rp"><a href="/rain-print"><b>Rain Print:</b> your farm&rsquo;s year of rain, framed &rarr;</a></p>\n'
           '      </div>\n'
           '    </div>\n'
           '    <div class="footer-cols">\n']
    for name, items in FCOLS:
        out.append(f'      <details class="footer-col" open>\n        <summary><span class="footer-h">{name}</span></summary>\n')
        out.extend(flink(it) for it in items)
        out.append('      </details>\n')
    out.append('    </div>\n')
    out.append(ADSPACE)
    out.append(BOTTOM)
    out.append('  </div>\n</footer>\n')
    return "".join(out)


FOOT_CSS = """  /* 2026-10-18 footer v2 (Sig: "footer seems strained"): one grid, the header's max width and left edge.
     Band: logo + one-line tagline in columns 1-3; columns 4-6 hold the daily email box, then the daily
     links and the Rain Print line (alone and level with the logo when the box is hidden for a subscriber).
     Then Prices | Livestock | Field | Money & Land | Work with us | About on the same six columns.
     Last, one small line and the legal links. Spacing steps: .5 / 1 / 1.5 / 2 rem. */
  footer.footer{padding:2rem 0 0}
  footer.footer .footer-band,footer.footer .footer-cols{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));column-gap:1.5rem}
  footer.footer .footer-band{align-items:start;row-gap:1rem;padding:0 0 1.5rem;margin:0;border-bottom:1px solid var(--border)}
  footer.footer .footer-band:has([data-signup-ask][hidden]){align-items:center}
  .footer-brand{grid-column:1 / span 3;display:flex;align-items:center;gap:1rem;min-width:0}
  .footer-logo{display:inline-flex;flex:none;line-height:0}
  .footer-logo img{height:36px;width:auto;max-width:210px;object-fit:contain}
  footer.footer .footer-tagline{margin:0;font-size:.86rem;line-height:1.5;color:var(--text-dim)}
  .footer-band-side{grid-column:4 / span 3;min-width:0;display:flex;flex-direction:column;gap:.5rem}
  .footer-band-ask:has(> [data-signup-ask][hidden]){display:none}
  .footer-band-ask .sa-ask{margin:0}
  /* the box sits in half the grid: question on its own line, then email + button */
  .footer-band-ask .sa-f{grid-template-columns:minmax(0,1fr) auto}
  .footer-band-ask .sa-l{grid-column:1 / -1}
  .footer-band-ask .sa-in{grid-column:1}
  .footer-band-ask .sa-b{grid-column:2}
  .footer-band-side p{margin:0;font-size:.86rem;line-height:1.5}
  .footer-band-side a{color:var(--text-dim);text-decoration:none}
  .footer-band-side a:hover{color:var(--brand)}
  .footer-band-rp a{color:var(--text)}
  .footer-band-rp b{color:var(--brand)}
  .footer-band-daily .footer-sep{margin:0 .5rem;color:var(--text-muted)}
  footer.footer .footer-cols{row-gap:1.5rem;padding:1.5rem 0;margin:0;border-bottom:1px solid var(--border)}
  footer.footer .footer-adspace{margin-top:0;padding:1.5rem 0;border-top:0;border-bottom:1px solid var(--border)}
  footer.footer .footer-bottom{display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:.5rem 1.5rem;padding:1rem 0 1.5rem}
  .footer-small{margin:0;font-size:.78rem;line-height:1.6;color:var(--text-muted)}
  .footer-small .status-dot{display:inline-block;vertical-align:middle;margin:0 .5rem .15em 0}
  .footer-small a{margin-left:.25rem}
  .footer-small a{color:var(--text-dim);text-decoration:underline;text-underline-offset:2px}
  .footer-small a:hover{color:var(--brand)}
  footer.footer .footer-legal{gap:.5rem}
  @media (max-width:1100px){
    footer.footer .footer-cols{grid-template-columns:repeat(3,minmax(0,1fr))}
    footer.footer .footer-band{grid-template-columns:repeat(2,minmax(0,1fr))}
    .footer-brand{grid-column:1}.footer-band-side{grid-column:2}
    .footer-brand{flex-direction:column;align-items:flex-start;gap:.5rem}
  }
  @media (max-width:700px){
    footer.footer{padding-top:1.5rem}
    footer.footer .footer-band{grid-template-columns:1fr;padding-bottom:1rem}
    .footer-brand,.footer-band-side{grid-column:1}
    .footer-brand{flex-direction:row;align-items:center;gap:.75rem}
    .footer-logo img{height:30px}
    footer.footer .footer-cols{display:block!important;padding:0}
    footer.footer .footer-adspace{padding:1rem 0}
    footer.footer .footer-bottom{flex-direction:column;align-items:center;text-align:center;gap:.5rem;padding:1rem 0 1.25rem}
  }
"""


def build_footer():
    old = (C / "footer.html").read_text(encoding="utf-8")
    # markup: everything from <footer> on comes from the tables above
    new = old[:old.index('<footer class="footer">')] + footer_body()
    # styles: the footer block replaces whatever 2026-10-18 footer block is there
    a = new.index("  /* 2026-10-18 footer")
    b = new.index("</style>\n<footer")
    new = new[:a] + FOOT_CSS + new[b:]
    (C / "footer.html").write_text(new, encoding="utf-8")


def fb_footer():
    groups, seen = [], {"/daily", "/news", "/archive", "/rain-print"}
    for name, items in FCOLS:
        keep = [it for it in items if it[0] not in seen]
        seen.update(it[0] for it in keep)
        groups.append(f"<b>{name}:</b> " + " · ".join(f'<a href="{it[0]}">{it[1]}</a>' for it in keep))
    daily = "<b>Daily:</b> " + " · ".join(f'<a href="{h}">{t}</a>' for h, t in F_DAILY)
    rp = '<a href="/rain-print">Rain Print: your farm’s year of rain, framed</a>'
    legal = '<a href="/privacy">Privacy</a> · <a href="/accessibility">Accessibility</a> · <a href="/terms">Terms</a>'
    body = "<br>\n    ".join([daily + " · " + rp] + groups + [legal])
    return ('  <!-- Static footer for crawlers and no-JS (loader.js swaps in the live footer). Edit here, then run scripts/inject_static_nav.py. -->\n'
            '  <nav class="snav" aria-label="AGSIST site links" style="max-width:1100px;margin:0 auto;padding:1.4rem 1rem;font-family:\'JetBrains Mono\',monospace;font-size:0.78rem;line-height:2.1;color:var(--text-muted);text-align:center;border-top:1px solid var(--border)">\n'
            '    <style>.snav a{color:var(--text-muted);text-decoration:none}.snav b{color:var(--text-dim)}</style>\n'
            f'    {body}\n'
            '  </nav>\n')


def all_hrefs():
    hs = set()
    for _, _, _, subs in GROUPS:
        hs |= {it[0] for it in flat(subs)}
    for _, items in FCOLS:
        hs |= {it[0] for it in items}
    return hs | {"/about", "/contact", "/rain-print", "/daily", "/news", "/archive", "/privacy", "/accessibility", "/terms"}


def exists(h):
    p = h.strip("/")
    if h == "/":
        return True
    if h.endswith("/"):
        return (W / p / "index.html").exists()
    return (W / f"{p}.html").exists()


if __name__ == "__main__":
    missing = sorted(h for h in all_hrefs() if not exists(h) and h != "/cash-bids/states")
    if missing:
        raise SystemExit(f"links with no page: {missing}")
    build_header()
    build_footer()
    (C / "header-fallback.html").write_text(fb_header(), encoding="utf-8")
    (C / "footer-fallback.html").write_text(fb_footer(), encoding="utf-8")
    print("ok")
