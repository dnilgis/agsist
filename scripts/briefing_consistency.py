#!/usr/bin/env python3
"""
briefing_consistency.py -- does the briefing agree with itself?

Run inside the critic pass (scripts/critique_briefing.py), after the editor's
rewrites. It reads the issue as a reader does, lead and sections first, then
the watch list and the homepage teaser, and checks three things a reader
catches and the model keeps missing:

  1. FUND FLOW. The lead or a section says funds are selling, and the watch
     list or teaser talks about a short-covering bounce or fund buying (or
     the other way round). Oct 16, 2026: lead "Fund selling has picked up",
     watch list "...beating the fund short-covering bounce". There was no
     bounce in that issue.
  2. TRIGGER ALREADY THERE. A watch item names a price level that the market
     already sits on (within 0.15% of the locked price) or has already
     crossed when the item is about crossing it. Oct 16: "Corn back under
     $4.75" with corn at $4.75 1/2, half a cent away.
  3. TEASER DIRECTION. The homepage teaser or the headline has a grain going
     the other way from its locked change ("corn rallies" on a down night).

What it does about it, deterministically, after the editor has had its turn:
  - a watch item caught by 1 or 2 is dropped (the list is optional; a wrong
    item is worse than one fewer);
  - a teaser caught by 1 or 3 is replaced by the headline, when the headline
    itself passes;
  - anything else (the lead against a section) is reported, never guessed at.

    python3 scripts/briefing_consistency.py --selftest
    python3 scripts/briefing_consistency.py data/daily-archive/2026-10-16.json
"""
import copy
import json
import re
import sys

NEAR = 0.0015          # 0.15% of the price: corn at $4.75 1/2 vs a $4.75 trigger is 0.105%

SELL = re.compile(r"\b(fund selling|funds? (?:are |were |kept |keep )?(?:selling|sold|sell)|"
                  r"long liquidation|funds? (?:are |were )?(?:liquidating|exiting))\b", re.I)
BUY = re.compile(r"\b(short[- ]covering|fund buying|funds? (?:are |were |kept |keep )?(?:buying|bought|buy)|"
                 r"funds? (?:are |were )?(?:covering))\b", re.I)

COMMOD = [
    ("kcwheat", r"kc wheat|kansas city wheat"),
    ("corn", r"corn"),
    ("beans", r"soybeans|beans"),
    ("wheat", r"wheat"),
    ("feeders", r"feeders?|feeder cattle"),
    ("cattle", r"live cattle|cattle"),
    ("hogs", r"hogs?|lean hogs"),
    ("crude", r"crude|wti|oil"),
    ("milk", r"milk|class iii"),
]
_COM_RE = re.compile(r"\b(" + "|".join(p for _, p in COMMOD) + r")\b", re.I)

DOWN = (r"gives? back|gave back|pulls? back|pulled back|fades?|faded|slips?|slipped|eases?|eased|easing|falls?|fell|drops?|dropped|lower|declines?|declined|"
        r"sags?|sagged|retreats?|retreated|weaker|softens?|softened|softer|dips?|dipped|slides?|slid|sinks?|sank")
UP = (r"rises?|rose|gains?|gained|firms?|firmed|firmer|higher|rall(?:y|ies|ied)|climbs?|climbed|"
      r"bounces?|bounced|rebounds?|rebounded|jumps?|jumped|stronger|advances?|advanced|lifts?|lifted")
# Holding, steady, flat: the clause says no move, so nothing after it is read.
FLAT = r"holds?|holding|held|steady|steadies|steadied|flat|unchanged|quiet"
_DIR_RE = re.compile(r"\b(" + DOWN + r")\b|\b(" + UP + r")\b|\b(" + FLAT + r")\b", re.I)

# "<commodity> ... <crossing or holding words> $<price>"
_TRIG_RE = re.compile(
    r"\b(" + "|".join(p for _, p in COMMOD) + r")\b[^$.;]{0,40}?"
    r"\b(back under|back below|back above|back over|(?:falls?|drops?|slips?|breaks?|gets?|goes|moves?|climbs?|"
    r"rises?|pushes?|trades?|closes?|settles?|holds?|holding|stays?|staying)?\s*(?:under|below|above|over|through|past))\s+"
    r"\$([0-9]+(?:\.[0-9]+)?)", re.I)
_CROSS = re.compile(r"^(back |falls?|drops?|slips?|breaks?|gets?|goes|moves?|climbs?|rises?|pushes?|closes?|settles?)", re.I)


def _key(word):
    w = word.lower()
    for k, p in COMMOD:
        if re.fullmatch(p, w):
            return k
    return None


def _price(briefing, key):
    lp = briefing.get("locked_prices") or {}
    v = lp.get(key)
    try:
        v = float(v)
    except (TypeError, ValueError):
        return None
    return v if v > 0 else None


def _pct(briefing, key):
    ch = (briefing.get("locked_changes") or {}).get(key) or {}
    try:
        return float(ch.get("pct"))
    except (TypeError, ValueError):
        return None


def _flow(text):
    """'sell', 'buy', 'both' or None for one field's text."""
    s, b = bool(SELL.search(text or "")), bool(BUY.search(text or ""))
    return "both" if s and b else ("sell" if s else ("buy" if b else None))


def _body_flow(briefing):
    parts = [briefing.get("lead") or ""]
    for sec in briefing.get("sections") or []:
        parts += [sec.get("body") or "", sec.get("so_what") or sec.get("bottom_line") or ""]
    fl = {_flow(p) for p in parts} - {None}
    if "both" in fl or fl == {"sell", "buy"}:
        return "both"
    return fl.pop() if fl else None


def trigger_findings(desc, briefing):
    out = []
    for m in _TRIG_RE.finditer(desc or ""):
        key = _key(m.group(1))
        px = _price(briefing, key) if key else None
        if px is None:
            continue
        verb, lvl = m.group(2).strip().lower(), float(m.group(3))
        side = "down" if re.search(r"under|below", verb) else ("up" if re.search(r"above|over", verb) else None)
        crossing = bool(_CROSS.match(verb))
        if crossing and side == "down" and px < lvl:
            out.append(f"{m.group(1)} is already under ${lvl:g} (at {px:g})")
        elif crossing and side == "up" and px > lvl:
            out.append(f"{m.group(1)} is already above ${lvl:g} (at {px:g})")
        elif abs(px - lvl) / px <= NEAR:
            out.append(f"{m.group(1)} at {px:g} is within 0.15% of the ${lvl:g} trigger")
    return out


def direction_findings(text, briefing):
    """A grain named before a direction word, going the other way from its
    locked change. Only the clause up to the first direction word counts, so
    'Corn slips as cattle firm' reads corn: down, and stops there."""
    out = []
    for clause in re.split(r"[.;:,]| as | while | but ", text or "", flags=re.I):
        d = _DIR_RE.search(clause)
        if not d or d.group(3):
            continue
        way = "down" if d.group(1) else "up"
        for c in _COM_RE.finditer(clause[:d.start()]):
            key = _key(c.group(1))
            pct = _pct(briefing, key) if key else None
            if pct is None or abs(pct) < 0.1:
                continue
            if (way == "down") != (pct < 0):
                out.append(f"{c.group(1)} {d.group(0)} but {key} is {pct:+.1f}%")
    return out


def check(briefing):
    """[{field, index, kind, text}] -- empty when the issue agrees with itself."""
    found = []
    body = _body_flow(briefing)
    if body == "both":
        found.append({"field": "lead/sections", "index": None, "kind": "fund_flow",
                      "text": "the lead and sections say both fund selling and fund buying"})
    opp = {"sell": "buy", "buy": "sell"}.get(body)
    for i, w in enumerate(briefing.get("watch_list") or []):
        desc = (w or {}).get("desc") or ""
        if opp and _flow(desc) in (opp, "both"):
            found.append({"field": "watch_list", "index": i, "kind": "fund_flow",
                          "text": f"lead/sections say fund {body}ing; watch item says otherwise: {desc}"})
        for t in trigger_findings(desc, briefing):
            found.append({"field": "watch_list", "index": i, "kind": "trigger", "text": f"{t}: {desc}"})
    teaser = briefing.get("teaser") or ""
    if opp and _flow(teaser) in (opp, "both"):
        found.append({"field": "teaser", "index": None, "kind": "fund_flow",
                      "text": f"lead/sections say fund {body}ing; teaser says otherwise: {teaser}"})
    for f in ("teaser", "headline"):
        for t in direction_findings(briefing.get(f) or "", briefing):
            found.append({"field": f, "index": None, "kind": "direction", "text": t})
    return found


def fix(briefing):
    """(briefing, log). Drops flagged watch items, swaps a flagged teaser for
    a clean headline, and reports what it could not fix."""
    b = copy.deepcopy(briefing)
    found = check(b)
    log = []
    drop = sorted({f["index"] for f in found if f["field"] == "watch_list"}, reverse=True)
    for i in drop:
        gone = b["watch_list"].pop(i)
        log.append(f"dropped watch item {i}: {gone.get('desc', '')}")
    if any(f["field"] == "teaser" for f in found):
        head = (b.get("headline") or "").strip()
        if head and not any(f["field"] == "headline" for f in found):
            old = b.get("teaser")
            b["teaser"] = head if head.endswith((".", "?", "!")) else head + "."
            log.append(f"teaser replaced by the headline (was: {old})")
        else:
            log.append("teaser flagged and the headline is flagged too: left for a person")
    for f in found:
        if f["field"] in ("lead/sections", "headline"):
            log.append(f"not fixed, {f['field']}: {f['text']}")
    return b, log


def _selftest():
    bad = []

    def ck(name, got, want):
        if got != want:
            bad.append(name)
            print("FAIL", name, repr(got), "want", repr(want))

    # The Oct 16, 2026 issue, as published.
    oct16 = {
        "headline": "Corn and beans ease back as harvest pressure builds",
        "lead": "Corn is at $4.75½ overnight, down 2¾ cents from Thursday's $4.78¼ settle, and beans are off "
                "6 cents at $12.58¼. Fund selling has picked up as combines roll and bushels keep piling into the bins.",
        "teaser": "Corn and beans slip again as fund selling meets a big harvest.",
        "sections": [{"body": "- AgWeb reports more fund selling hit corn and beans.",
                      "so_what": "Funds are selling into the harvest, not waiting for the yield debate to settle."}],
        "watch_list": [
            {"time": "Ongoing", "desc": "Corn back under $4.75 would say harvest supply is beating the fund short-covering bounce."},
            {"time": "Ongoing", "desc": "Crude holding above $95 through the weekend would confirm the Hormuz premium is sticking, not fading."},
            {"time": "Monday 3:00 p.m. CT", "desc": "Crop Progress report; a faster-than-expected harvest pace could add more pressure."}],
        "locked_prices": {"corn": 4.755, "beans": 12.5825, "crude": 95.73, "cattle": 225.95},
        "locked_changes": {"corn": {"pct": -0.575}, "beans": {"pct": -0.4746}, "crude": {"pct": -2.2864},
                           "cattle": {"pct": 0.9156}},
    }
    f = check(oct16)
    ck("Oct 16: two findings, both on watch item 0",
       sorted((x["field"], x["index"], x["kind"]) for x in f),
       [("watch_list", 0, "fund_flow"), ("watch_list", 0, "trigger")])
    # 4.755 vs 4.75: 0.005 / 4.755 = 0.105% <= 0.15%
    ck("the trigger finding names the half cent",
       [x["text"].split(":")[0] for x in f if x["kind"] == "trigger"], ["Corn at 4.755 is within 0.15% of the $4.75 trigger"])
    fixed, log = fix(oct16)
    ck("fix drops only the bad item", [w["desc"][:5] for w in fixed["watch_list"]], ["Crude", "Crop "])
    ck("teaser kept (it agrees)", fixed["teaser"], oct16["teaser"])
    ck("crude holding above $95 at 95.73 is not flagged (0.76% away, holding is not crossing)",
       trigger_findings("Crude holding above $95 through the weekend", oct16), [])
    ck("crossing a level already crossed",
       trigger_findings("Corn back under $4.80 would say supply wins.", oct16), ["Corn is already under $4.8 (at 4.755)"])
    ck("a level far away is fine", trigger_findings("Corn back under $4.60 would say supply wins.", oct16), [])
    # Teaser going the wrong way, headline clean: swapped.
    t2 = dict(oct16, teaser="Corn rallies as cattle firm.")
    ck("teaser direction caught", [x["kind"] for x in check(t2) if x["field"] == "teaser"], ["direction"])
    ck("cattle firm is right (cattle up)", direction_findings("Cattle firm overnight", oct16), [])
    f2, log2 = fix(t2)
    ck("teaser replaced by the headline", f2["teaser"], "Corn and beans ease back as harvest pressure builds.")
    # Teaser with the opposite fund flow.
    t3 = dict(oct16, teaser="Corn lifts as short covering returns.", watch_list=[])
    ck("teaser fund flow caught", [x["kind"] for x in check(t3)], ["fund_flow", "direction"])
    # Lead says both: reported, not fixed.
    t4 = dict(oct16, lead="Fund selling hit corn, then short covering lifted it.", watch_list=[], teaser="")
    f4, log4 = fix(t4)
    ck("both flows in the body: reported only", log4, ["not fixed, lead/sections: the lead and sections say both fund selling and fund buying"])
    ck("a clean issue has nothing", check(dict(oct16, watch_list=oct16["watch_list"][1:])), [])
    print("briefing_consistency selftest " + ("FAILED" if bad else "ok"))
    return 1 if bad else 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(_selftest())
    if len(sys.argv) > 1:
        with open(sys.argv[1], encoding="utf-8") as fh:
            print(json.dumps(check(json.load(fh)), indent=1, ensure_ascii=False))
