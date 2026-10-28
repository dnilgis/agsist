#!/usr/bin/env python3
"""YOUR COUNTY THIS WEEK IN THE DAILY, WITH NOTHING SENT.

    python3 scripts/test_county_week.py

send_daily.load_county_week and daily_v2's block, on the real line code
(scripts/county_week.mjs run by node, on the frozen rows in
test/fixtures/changemap, the same ones test/changemap.test.mjs pins):

  * Thursdays only; only readers with cw true AND a saved ZIP; each ZIP once;
    node is handed opaque keys and points, never a ZIP or an address;
  * Shelby County, IL (drought D0 to D1) gets a block; Barron County, WI
    (everything held) gets none; a ZIP that cannot be placed gets none;
  * the block rides in "Only here", its one link tagged utm_content=countyweek,
    every row with its date and source, no withheld line, no reader ZIP;
  * a block with no changed row is never drawn; a failing node run leaves
    the briefing as it was.
Counts only are printed. Run by test/county-week.test.mjs.
"""
import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
os.environ.pop("COUNTY_WEEK", None)

import send_daily as SD   # noqa: E402
import daily_v2           # noqa: E402

FX = ROOT / "test" / "fixtures" / "changemap"
IDX = json.loads((FX / "index.json").read_text())
fails, passes = [], 0


def check(cond, msg):
    global passes
    if cond:
        passes += 1
    else:
        fails.append(msg)
        print("FAIL " + msg)


class FakeBids:
    """The three reads load_county_week makes (local_bid.BidsData's own names)."""
    ZIPS = {"62565": ((39.391, -88.806), "Shelbyville, IL"), "54728": ((45.31413, -91.651), "Chetek, WI"),
            "99999": (None, None)}

    def __init__(self):
        self.reads = 0

    def zip_coord(self, z):
        self.reads += 1
        return self.ZIPS.get(z, (None, None))[0]

    def zip_town(self, z):
        return self.ZIPS.get(z, (None, None))[1]

    def index(self):
        return IDX


SEEN = []


def runner(inp):
    """county_week.mjs on the frozen files (node, the same code the site runs)."""
    SEEN.append(json.loads(json.dumps(inp, default=str)))
    code = ("import {run} from %s; import fs from 'node:fs';"
            "const FX=%s, PREV=JSON.parse(fs.readFileSync(FX+'bids-prev.json','utf8'));"
            "const map={'data/drought/county-week.json':'drought.json','data/basis-states.json':'basis-states.json',"
            "'data/prices.json':'prices.json','data/land-sales/wi.json':'land-sales-wi.json','data/land-sales/il.json':'land-sales-il.json'};"
            "const read=(rel)=>{const m=/^data\\/bids-prev\\/([A-Z]{2})\\.json$/.exec(rel); if(m) return PREV[m[1]]||null;"
            " const f=map[rel]?FX+map[rel]:%s+rel; try{return JSON.parse(fs.readFileSync(f,'utf8'));}catch(e){return null;}};"
            "let raw='';process.stdin.on('data',d=>raw+=d);process.stdin.on('end',()=>{process.stdout.write(JSON.stringify(run(JSON.parse(raw),read).out));});"
            % (json.dumps(str(ROOT / "scripts" / "county_week.mjs")), json.dumps(str(FX) + "/"), json.dumps(str(ROOT) + "/")))
    r = subprocess.run(["node", "--input-type=module", "-e", code], input=json.dumps(inp), capture_output=True, text=True, timeout=120)
    if r.returncode:
        raise RuntimeError(r.stderr[-400:])
    return json.loads(r.stdout)


SUBS = [
    {"email": "shelby@example.com", "zip": "62565", "cw": True},
    {"email": "shelby2@example.com", "zip": "62565", "cw": True},
    {"email": "barron@example.com", "zip": "54728", "cw": True},
    {"email": "noplace@example.com", "zip": "99999", "cw": True},
    {"email": "nozip@example.com", "zip": None, "cw": True},
    {"email": "unticked@example.com", "zip": "62565"},
]
THU, WED = "2026-10-29", "2026-10-28"

# ── the day and the readers ──
out, c = SD.load_county_week(SUBS, "json", WED, FakeBids(), runner)
check(out == {} and not SEEN, "not on a Wednesday, and node is not even run")
out, c = SD.load_county_week(SUBS, "plain", THU, FakeBids(), runner)
check(out == {}, "an older list without ZIPs or ticks: nothing")
os.environ["COUNTY_WEEK"] = "0"
out, c = SD.load_county_week(SUBS, "json", THU, FakeBids(), runner)
check(out == {}, "COUNTY_WEEK=0 turns it off")
os.environ.pop("COUNTY_WEEK")
fb = FakeBids()
out, c = SD.load_county_week(SUBS, "json", THU, fb, runner)
check(sorted(out) == ["shelby2@example.com", "shelby@example.com"], "only the Shelby readers get a block: %s" % sorted(out))
check(c == {"ticked": 5, "ticked_no_zip": 1, "zips": 2, "block": 2, "no_change": 1, "not_placed": 1,
           "arm_hold": 1, "held_out": 0}, "counts: %s" % c)   # the holdout arm (scripts/test_cw_optin.py): one made-up reader, not a Shelby one
check(fb.reads == 3, "each ZIP read once (%d)" % fb.reads)
sent = SEEN[-1]
blob = json.dumps(sent["places"])
check(all(re.fullmatch(r"p\d+", p["k"]) for p in sent["places"]), "node gets opaque keys")
check(not re.search(r"62565|54728|example\.com", blob), "no ZIP and no address reaches node")
check(sent["today"] == THU, "the issue's day is the day measured")
blk = out["shelby@example.com"]
check(blk["county"] == "Shelby County" and blk["st"] == "IL" and blk["url"] == "/farmland-atlas/illinois/shelby-county", "the county and its home: %s" % {k: blk[k] for k in ("county", "st", "url")})
rows = blk["block"]["rows"]
check([r["kind"] for r in rows][:1] == ["changed"] and rows[0]["label"] == "Drought", "the drought change leads")
check(rows[0]["text"].startswith("Worse this week: D1 moderate drought, from D0 abnormally dry a week earlier."), rows[0]["text"])
check(sum(1 for r in rows if r["kind"] == "held") == 1, "unchanged lines collapse to one row")
held = [r for r in rows if r["kind"] == "held"][0]
check("within 30 mi" in held["text"] and "no new recorded farm sales this week (the state record was last read Oct 18)" in held["text"], held["text"])
basis = [r for r in rows if r["kind"] == "level"]
check(len(basis) == 1 and basis[0]["text"].startswith("Posted against Dec: Shelby County middle 30 under (8 locations, 4 companies), Illinois middle 25 under"), basis and basis[0]["text"])
check(all(r["date"] and r["src"] for r in rows), "every row dated and sourced")

# a node failure: the briefing goes as it was
def boom(inp):
    raise RuntimeError("down")
try:
    SD.load_county_week(SUBS, "json", THU, FakeBids(), boom)
    check(False, "a node failure raises to main(), which prints the type and sends without the block")
except RuntimeError:
    passes += 1

# ── the email ──
daily = json.loads((ROOT / "data" / "daily-archive" / sorted(p.name for p in (ROOT / "data" / "daily-archive").glob("2026-*.json"))[-1]).read_text())
built = daily_v2.build(daily, "https://agsist.com/daily/x.html", forward_url="https://agsist.com/?ref=email-forward", fact={"text": "x", "source": "y"}, county=blk)
h, t = built["html"], built["text"]
check(built["slots"]["county"] is True, "the slot is counted")
check("Your county this week: Shelby County, IL" in h and "Your county this week: Shelby County, IL" in t, "the title in both bodies")
check(h.index("Only here") < h.index("Your county this week"), "inside the Only here slot")
links = re.findall(r'href="([^"]+)"', h)
cw_links = [u for u in links if "utm_content=countyweek" in u]
check(len(cw_links) == 1 and cw_links[0].startswith("https://agsist.com/farmland-atlas/illinois/shelby-county?"), "one tagged link to the county home: %s" % cw_links)
check("utm_content=countyweek" in t, "the text body's link is tagged too")
check(not re.search(r"62565|54728|example\.com", (h + t).replace("PO Box 243, Chetek, WI 54728", "")), "no reader ZIP or address in the email (the PO Box is AGSIST's own)")
check(not re.search(r"[–—]|&mdash;|&ndash;", "".join(r["text"] for r in rows) + t), "no em or en dash in the block")
for n in {str(p.get("operator") or "").strip() for p in IDX["places"]}:
    if len(n) > 3:
        check(n not in h, "no company name: " + n)
check("Not shown" not in h and "withheld" not in h.lower(), "withheld lines stay out of the email")
# no changed row, a foreign link, no county: no block
nochg = dict(blk, block={"rows": [r for r in rows if r["kind"] != "changed"]})
check(daily_v2.county_block(nochg) is None, "no changed row, no block")
check(daily_v2.county_block(dict(blk, url="https://example.com/x")) is None, "only a path on agsist.com")
check(daily_v2.county_block(dict(blk, block={"rows": [dict(rows[0], date="")]})) is None, "an undated row is not drawn")
plain = daily_v2.build(daily, "https://agsist.com/daily/x.html", fact={"text": "x", "source": "y"})
check(plain["slots"]["county"] is False and "Your county this week" not in plain["html"], "no block for everyone else")

print("county week: %d passed, %d failed" % (passes, len(fails)))
sys.exit(1 if fails else 0)
