#!/usr/bin/env python3
"""Swap the new static header/footer into every generated page that already carries the
static-nav markers (the same block the builders write via inject_static_nav.block), and
(--states) bake the "Bids by state" list on /basis#states from the current state pages
(it was cash-bids/states.html until Oct 22, 2026). Usage: refresh_baked.py <worktree> [--states]"""
import datetime as dt
import json
import os
import re
import sys

W = os.path.abspath(sys.argv[1])
os.chdir(W)
sys.path.insert(0, os.path.join(W, "scripts"))
import inject_static_nav as NAV  # noqa: E402

BLK = {k: NAV.block(k) for k in ("header", "footer")}
RE = re.compile(r"\n<!-- static-nav:(header|footer) \(.*?<!-- /static-nav:\1 -->\n", re.S)
n = 0
dirs = {}
for root, ds, fs in os.walk(W):
    ds[:] = [d for d in ds if d not in (".git", "node_modules")]
    if root == W:
        continue
    for f in fs:
        if not f.endswith(".html"):
            continue
        p = os.path.join(root, f)
        t = open(p, encoding="utf-8").read()
        if "<!-- static-nav:" not in t:
            continue
        new = RE.sub(lambda m: BLK[m.group(1)], t)
        if new != t:
            open(p, "w", encoding="utf-8").write(new)
            n += 1
            top = os.path.relpath(p, W).split(os.sep)[0]
            dirs[top] = dirs.get(top, 0) + 1
print("refreshed", n, dirs)

if "--states" in sys.argv:
    import build_cash_bid_pages as CB
    counts = json.load(open("data/elevator-counts.json"))
    smetas = []
    code = {v: k for k, v in CB.STATE_NAMES.items()}
    for d in sorted(os.listdir("cash-bids")):
        ip = os.path.join("cash-bids", d, "index.html")
        if not os.path.isfile(ip):
            continue
        h = open(ip, encoding="utf-8").read()
        mm = re.search(r"<h1>(.*?) cash grain bids and basis today</h1>", h)
        if not mm:
            continue
        name = mm.group(1).replace("&amp;", "&")
        st = code[name]
        m = re.search(r'<h2 id="towns">(\d+) towns?', h)
        idx = 'content="noindex' not in h
        towns_sec = h.split('<h2 id="towns">', 1)[1].split("</ul>", 1)[0] if m else ""
        times = [CB.parse_ts(x) for x in re.findall(r'datetime="([^"]+)"', towns_sec)]
        smetas.append({"state": st, "path": f"/cash-bids/{d}/", "indexable": idx,
                       "towns": int(m.group(1)) if m else 0,
                       "elevators": (counts["states"].get(st) or {}).get("elevators", 0),
                       "latest": max(times) if times else None})
    html = CB.states_list_html([m for m in smetas if m["indexable"]], [m for m in smetas if not m["indexable"]])
    CB.stamp_states_list("basis.html", html)
    print("states list on /basis:", len(smetas), "states,", sum(1 for m in smetas if m["indexable"]), "with a bid")
