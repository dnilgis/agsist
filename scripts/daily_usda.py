#!/usr/bin/env python3
"""
daily_usda.py -- the USDA market lines handed to the Daily's writer as dated
source blocks (Nov 2 2026: build from USDA My Market News and the LM
reports, then wire them into the Daily; the pattern is scripts/daily_more.py).
Every number is read from a file already in the repo, written by the fetchers
below. Nothing is fetched here and nothing is forecast. A block whose file is
missing, unreadable, marked stale, out of date or dated the issue's own day is
WITHHELD, with the reason, never filled in or guessed.

FRESH MEANS NEW SINCE YESTERDAY'S ISSUE. A daily report is handed to the writer
only when it is dated the day before the issue (the Tuesday issue gets Monday's
report). So a Friday report reaches Saturday's issue once and is never rerun on
Sunday or Monday, a missed fetch is never shown as today's, and a report dated
the issue's own day (published after the morning send) is never used: no
look-ahead. The issue after a Monday holiday has nothing new, so nothing.

THE BLOCKS (prompt_block() joins the ones that are on, each with its source and date)
  hogs       data/hog-cash.json (scripts/fetch_hog_cash.py): the national
             negotiated CASH hog price, carcass base, head and kill dates
             (USDA AMS LM_HG201), and the pork cutout (LM_PK602). Each part on
             its own date; a part not dated yesterday is left out, the other
             stays. Kill dates more than HOG_KILL_DAYS before the report: out.
             The livestock line uses these cash hogs, never lean hog futures as
             cash (Nov 2 audit: the Oct 29 issue called a futures price cash).
  slaughter  data/slaughter.json (scripts/fetch_slaughter_mars.py): USDA's
             estimated federally inspected cattle and hog slaughter for the day,
             with USDA's own week-ago and year-ago figures; the file's daily_line.
  ethanol    data/ethanol-bids.json (scripts/fetch_ethanol_mars.py): the range of
             ethanol plant corn bids and basis across the states USDA covers,
             against the futures month named. Withheld when the rows do not all
             name that month (a range across two contracts means nothing).
  gulf       data/state-grain-ams.json (scripts/fetch_state_grain_mars.py): the
             file's top daily_line, Gulf export corn and soybean bids, barge CIF,
             as basis over the month named.
  costs      data/production-costs.json (scripts/fetch_prodcost_mars.py): farm
             diesel (the file's daily_line) and fertilizer dealer prices per
             state or region, only from reports published the day before the
             issue. The reports are biweekly, weekly or monthly and post on
             Friday, so this is the Saturday issue after a new report, never a
             daily repeat.

    python3 scripts/daily_usda.py                         print today's block
    python3 scripts/daily_usda.py --date 2026-11-03 --now 2026-11-03T11:00:00Z
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import json
import os
import sys
from datetime import date, datetime, time, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)

try:
    from zoneinfo import ZoneInfo
    CT = ZoneInfo("America/Chicago")
except Exception:  # pragma: no cover
    CT = timezone(timedelta(hours=-6))

FILES = {"hogs": "hog-cash.json", "slaughter": "slaughter.json", "ethanol": "ethanol-bids.json",
         "gulf": "state-grain-ams.json", "costs": "production-costs.json"}
ORDER = ("hogs", "slaughter", "ethanol", "gulf", "costs")
HOG_KILL_DAYS = 4          # LM_HG201 reports the prior slaughter day(s): Monday's covers Friday and Saturday
# fetch_prodcost_mars.REPORTS: Iowa, Illinois, Oklahoma, North Carolina, Inter-Mountain West, Pacific Northwest
REPORT_ORDER = ("2863", "3195", "3621", "3159", "3883", "3657")
# fertilizer products the costs block names, in this order, with the farm word for each
FERT = (("anhydrous", "anhydrous ammonia"), ("urea", "urea"), ("uan28", "28% UAN"), ("uan32", "32% UAN"),
        ("dap", "DAP"), ("map", "MAP"), ("potash", "potash"))


def _md(d):
    return "%s %d" % (d.strftime("%b"), d.day)


def _iso(v):
    try:
        return date.fromisoformat(str(v or "")[:10])
    except ValueError:
        return None


def _load(repo, key):
    try:
        with open(os.path.join(repo, "data", FILES[key]), encoding="utf-8") as f:
            d = json.load(f)
    except (OSError, ValueError):
        return None
    return d if isinstance(d, dict) else None


def _fresh(d, today):
    """None when the report date d is the day before the issue; else why not."""
    if d is None:
        return "no report date"
    if d >= today:
        return "the %s report was not out when this issue was written" % d.isoformat()
    if d != today - timedelta(days=1):
        return "the newest report (%s) is not yesterday's, so it is not new for this issue" % d.isoformat()
    return None


def _plain(line):
    """A line fit for the writer: text, no link, no em or en dash."""
    return isinstance(line, str) and line.strip() and "http" not in line and "—" not in line \
        and "–" not in line


def _num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _days(dates):
    """'Oct 30-31', 'Oct 30', 'Oct 31-Nov 1': the same words fetch_hog_cash.daily_line uses."""
    a, b = _md(dates[0]), _md(dates[-1])
    if a == b:
        return a
    return "%s-%s" % (a, b.split()[1]) if a.split()[0] == b.split()[0] else "%s-%s" % (a, b)


# ── cash hogs and the pork cutout ──────────────────────────────────────────
def hog_facts(today, doc):
    if doc is None:
        return {"withheld": "data/hog-cash.json missing or unreadable"}
    parts, why, dated = [], [], []
    h = doc.get("hogs") or {}
    rd = _iso(h.get("report_date"))
    kill = sorted(x for x in (_iso(s) for s in h.get("slaughter_dates") or []) if x)
    w = _fresh(rd, today)
    if w is None and not kill:
        w = "no kill dates"
    if w is None and (kill[-1] > rd or (rd - kill[0]).days > HOG_KILL_DAYS):
        w = "kill dates %s to %s do not belong to the %s report" % (kill[0], kill[-1], rd)
    n, t = h.get("negotiated") or {}, h.get("total") or {}
    if w is None:
        if _num(n.get("base")) and isinstance(n.get("head"), int) and n["head"] > 0:
            parts.append("National negotiated cash hogs $%.2f/cwt carcass base on %s head (killed %s)" % (
                n["base"], "{:,}".format(n["head"]), _days(kill)))
        elif _num(t.get("base")):
            parts.append("National cash hogs, all purchase types, $%.2f/cwt carcass base (killed %s)" % (
                t["base"], _days(kill)))
        else:
            w = "no carcass base price in the file"
    if w is None:
        dated.append("%s, %s" % (h.get("source") or "USDA AMS LM_HG201", _md(rd)))
    else:
        why.append("cash hogs: " + w)
    c = doc.get("cutout") or {}
    cd = _iso(c.get("date"))
    w = _fresh(cd, today)
    if w is None and not _num(c.get("carcass")):
        w = "no carcass cutout value"
    if w is None:
        s = "pork cutout $%.2f/cwt on %s" % (c["carcass"], _md(cd))
        if _num(c.get("change")) and c["change"]:
            s += ", %s $%.2f from the day before" % ("up" if c["change"] > 0 else "down", abs(c["change"]))
        parts.append(s)
        dated.append("%s, %s" % (c.get("source") or "USDA AMS LM_PK602", _md(cd)))
    else:
        why.append("pork cutout: " + w)
    if not parts:
        return {"withheld": "; ".join(why)}
    out = {"lines": ["; ".join(parts) + ". USDA AMS."], "source": "; ".join(dated) + "."}
    if why:
        out["left_out"] = "; ".join(why)
    return out


# ── daily slaughter ────────────────────────────────────────────────────────
def slaughter_facts(today, doc):
    if doc is None:
        return {"withheld": "data/slaughter.json missing or unreadable"}
    if doc.get("stale") is not False:
        return {"withheld": "the slaughter file is marked stale"}
    rd = _iso(doc.get("report_date"))
    w = _fresh(rd, today)
    if w:
        return {"withheld": w}
    line, src = doc.get("daily_line"), str(doc.get("source") or "")
    if not _plain(line) or not src or not line.rstrip().endswith(src + "."):
        return {"withheld": "no plain daily_line carrying its source and date"}
    for sp in ("cattle", "hogs"):
        b = doc.get(sp) or {}
        if _iso(b.get("date")) != rd:
            return {"withheld": "%s slaughter is not dated %s" % (sp, rd)}
        for k in ("head", "week_ago", "year_ago"):
            if _num(b.get(k)) and "{:,}".format(b[k]) not in line:
                return {"withheld": "the daily_line does not carry the file's %s %s" % (sp, k)}
    return {"lines": [line.strip()], "source": src + " (estimated, federally inspected)."}


# ── ethanol plant corn bids ────────────────────────────────────────────────
def ethanol_facts(today, doc):
    if doc is None:
        return {"withheld": "data/ethanol-bids.json missing or unreadable"}
    c = doc.get("corn") or {}
    rd = _iso(c.get("report_date"))
    w = _fresh(rd, today)
    if w:
        return {"withheld": w}
    fut, rows = c.get("futures"), c.get("rows") or []
    if not fut or not rows:
        return {"withheld": "no futures month or no rows"}
    if any(r.get("futures") != fut for r in rows):
        return {"withheld": "the rows name more than one futures month"}
    line = doc.get("daily_line")
    if not _plain(line) or ("against %s futures" % fut) not in line or _md(rd) not in line:
        return {"withheld": "the daily_line does not name the futures month and the report date"}
    return {"lines": [line.strip()],
            "source": "USDA AMS, %s, %s (%s)." % (c.get("report") or "National Daily Ethanol Report", _md(rd),
                                                  c.get("terms") or "corn delivered to the plant")}


# ── Gulf export bids ───────────────────────────────────────────────────────
def gulf_facts(today, doc):
    if doc is None:
        return {"withheld": "data/state-grain-ams.json missing or unreadable"}
    g = ((doc.get("export") or {}).get("gulf")) or {}
    if g.get("stale") is not False:
        return {"withheld": "the Gulf export report is missing or marked stale"}
    rd = _iso(g.get("report_date"))
    w = _fresh(rd, today)
    if w:
        return {"withheld": w}
    line, src = doc.get("daily_line"), str(g.get("source") or "")
    if not _plain(line) or not src or not line.rstrip().endswith(src + "."):
        return {"withheld": "the top daily_line is not the Gulf report's"}
    return {"lines": [line.strip()], "source": src + "."}


# ── farm diesel and fertilizer ─────────────────────────────────────────────
def cost_facts(today, doc):
    if doc is None:
        return {"withheld": "data/production-costs.json missing or unreadable"}
    want = today - timedelta(days=1)
    lines, credits = [], []
    dl = doc.get("daily_line")
    if isinstance(dl, dict) and dl.get("key") == "diesel" and _iso(dl.get("date")) == want and _plain(dl.get("text")):
        lines.append(dl["text"].strip())
    reps = sorted((r for r in (doc.get("reports") or {}).values()
                   if isinstance(r, dict) and _iso(r.get("published")) == want),
                  key=lambda r: (REPORT_ORDER.index(str(r.get("id"))) if str(r.get("id")) in REPORT_ORDER else 99,
                                 str(r.get("id"))))
    for r in reps:
        items = {i.get("key"): i for i in r.get("items") or [] if isinstance(i, dict) and not i.get("thin")
                 and i.get("unit") == "$/ton" and _num(i.get("avg")) and i["avg"] > 0}
        bits = []
        for key, word in FERT:
            i = items.get(key)
            if not i:
                continue
            s = "%s $%s%s" % (word, "{:,.2f}".format(i["avg"]), " a ton" if not bits else "")
            if str(i.get("freight") or "").lower().startswith("delivered"):
                s += " delivered"
            if _num(i.get("change")) and i["change"]:
                s += " (%s $%s from the last report)" % ("up" if i["change"] > 0 else "down",
                                                          "{:,.2f}".format(abs(i["change"])))
            bits.append(s)
        if len(bits) < 2 or not r.get("region") or not r.get("credit"):
            continue
        lines.append("%s fertilizer, dealer average: %s (%s)." % (r["region"], ", ".join(bits), r["credit"]))
        credits.append(r["credit"])
    if not lines:
        newest = max((str(r.get("published")) for r in (doc.get("reports") or {}).values() if isinstance(r, dict)),
                     default="none")
        return {"withheld": "no production cost report published %s (newest %s): the issue after a new report only"
                % (want.isoformat(), newest)}
    return {"lines": lines,
            "source": "USDA AMS production cost reports (dealer asking prices), published %s." % _md(want)}


# ── the writer's block ─────────────────────────────────────────────────────
RULES = {
    "hogs": ("These are CASH hogs: USDA's national negotiated carcass base price for the kill dates written, "
             "and the wholesale pork cutout. Any line about what hogs brought in cash uses this, never lean hog "
             "futures; futures stay called futures. Say 'carcass base' and the kill dates as written."),
    "slaughter": ("A supply line: how many cattle and hogs packers killed that day, USDA's estimate. Head counts "
                  "and the day exactly as written; never a percent, never a weekly total this block does not carry."),
    "ethanol": ("What ethanol plants bid for corn, the range across the states USDA covers. Always name the "
                "futures month written here with any basis. Never call it a local bid or the reader's elevator."),
    "gulf": ("Export demand: bids at Gulf export elevators, barge CIF, as basis over the futures month written. "
             "Never call it a farm price or a local bid."),
    "costs": ("Input costs: dealer asking prices from USDA's survey, each with its state or region and report "
              "date. New this issue; say which state. Never a national price, never per acre, never a forecast."),
}
TITLES = {"hogs": "CASH HOGS AND PORK CUTOUT (USDA AMS)", "slaughter": "DAILY SLAUGHTER (USDA AMS)",
          "ethanol": "ETHANOL PLANT CORN BIDS (USDA AMS)", "gulf": "GULF EXPORT BIDS (USDA AMS)",
          "costs": "FARM DIESEL AND FERTILIZER (USDA AMS)"}
FACTS = {"hogs": hog_facts, "slaughter": slaughter_facts, "ethanol": ethanol_facts, "gulf": gulf_facts,
         "costs": cost_facts}


def build(today=None, now=None, repo=REPO):
    """{"hogs": {...}, ...}; each {"lines", "source"} or {"withheld": why}. Fail-soft per block."""
    now = now or datetime.now(timezone.utc)
    today = today or now.astimezone(CT).date()
    out = {}
    for name in ORDER:
        try:
            out[name] = FACTS[name](today, _load(repo, name))
        except Exception as ex:
            out[name] = {"withheld": "could not be built (%s)" % type(ex).__name__}
    return out


def prompt_block(blocks):
    """The text handed to the writer, or "" when every block is withheld."""
    parts = []
    for name in ORDER:
        b = blocks.get(name) or {}
        if not b.get("lines"):
            continue
        parts.append("%s (source: %s)\n  - %s\n  RULE: %s" % (TITLES[name], b["source"], "\n  - ".join(b["lines"]),
                                                              RULES[name]))
    if not parts:
        return ""
    return ("USDA MARKET LINES (USDA AMS reports read into AGSIST's files; each is new since yesterday's issue; "
            "every number below is checked against them, so copy numbers, dates and futures months exactly, and "
            "name USDA AMS as the source in plain words). These cash, export and dealer prices are not futures: they come "
            "from here and the LOCKED PRICE TABLE rule does not cover them; a futures price never stands in for them. "
            "Use the ones that matter today, one sentence each, in "
            "a section body or the watch list; they do not lead unless one is the day's biggest news, and they "
            "never push the issue past its length.\n" + "\n".join(parts))


def log_lines(blocks):
    out = []
    for k, v in blocks.items():
        s = ("%d line(s)" % len(v["lines"])) if v.get("lines") else "withheld (%s)" % v.get("withheld")
        if v.get("left_out"):
            s += "; left out: " + v["left_out"]
        out.append("%s: %s" % (k, s))
    return out


def main(argv):
    today, now = None, None
    if "--date" in argv:
        today = date.fromisoformat(argv[argv.index("--date") + 1])
    if "--now" in argv:
        now = datetime.fromisoformat(argv[argv.index("--now") + 1].replace("Z", "+00:00"))
    if today and not now:
        now = datetime.combine(today, time(6, 0), tzinfo=CT)
    blocks = build(today, now)
    for ln in log_lines(blocks):
        print(ln)
    print()
    print(prompt_block(blocks) or "(nothing for the writer today)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
