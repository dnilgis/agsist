#!/usr/bin/env python3
"""
daily_edge.py -- "Only on AGSIST": the numbers in the Daily that nobody else
can print, because they come from the elevator boards AGSIST reads itself.

    Cash corn bids at 1,180 elevators AGSIST reads fell a median 4¢ on
    Thursday, Oct 15; 64 of them changed their basis, 41 weaker and 23 stronger.

EVERY NUMBER HERE IS COMPUTED BY THIS FILE, NEVER BY THE DRAFTING MODEL. The
model never sees these facts and never writes them. The page, the email and the
archive print the sentences this file writes, from data/daily-edge.json, which
the daily workflow builds right before the briefing is drafted.

WHERE THE NUMBERS COME FROM
  data/bids-prev/<ST>.json   the last cash and basis each network board showed
                             on each recent trading day (scripts/build_bids_prev.py,
                             every 15 minutes). Keys are FNV-1a of place|crop|period.
  merged-index.json          the elevator network's live index (dnilgis/bids),
                             read from BIDS_BASE like scripts/local_bid.py. It
                             says which key is corn and which is soybeans, and
                             carries each board's basis now.
  data/basis-states.json     state median basis, scripts/basis_method.py (the
                             one method /basis and /cash-bids use).

THE FACTS (in the order the block shows them; the block shows at most 3)
  cash_change_<crop>   yesterday's change in cash corn / soybean bids: the
                       median of matched pairs (same board, crop and delivery
                       period on both of the last two trading days), how many
                       moved, and how many boards changed basis.
  basis_spread_<crop>  strongest and weakest state median basis against the
                       contract most states price against.
  over_futures_corn    how many boards with a fresh corn bid pay over futures.

WHEN A FACT IS WITHHELD (it goes in `withheld` with the reason, never printed)
  stale    the source file is more than STALE_H (36) hours old, or is dated
           after `now` (no look-ahead), or the last trading day is missing
  sample   fewer than MIN_PAIRS matched boards (cash change), fewer than
           MIN_STATES states with MIN_STATE_N boards each (basis spread), fewer
           than MIN_FRESH fresh boards (over futures)
  outlier  more than MAX_DROP_SHARE of the pairs sit outside the outlier
           filter (OUTLIER_K robust standard deviations, never less than the
           crop's floor), or the median move is beyond what futures can do in
           a day (MEDIAN_CAP)

NO "FIRST" AND NO "RECORD". Nothing here compares against a long history; the
store keeps four trading days. A claim like "widest since" needs a dated
history this repo does not keep yet, so none is made.

    python3 scripts/daily_edge.py                    write data/daily-edge.json
    python3 scripts/daily_edge.py --bids-base DIR    read merged-index.json from a local mirror
    python3 scripts/daily_edge.py --now 2026-10-16T10:40:00Z --print
    python3 scripts/daily_edge.py --selftest         hand-worked cases, no network
"""
import glob
import json
import math
import os
import re
import statistics
import sys
from datetime import date, datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import contract_calendar as cc  # noqa: E402  THE trading-day definition

try:
    from zoneinfo import ZoneInfo
    CT = ZoneInfo("America/Chicago")
except Exception:  # pragma: no cover
    CT = timezone(timedelta(hours=-5))

REPO = os.path.dirname(HERE)
OUT_PATH = os.path.join(REPO, "data", "daily-edge.json")
SCHEMA = "agsist-daily-edge/1"

STALE_H = 36
MIN_PAIRS = 100
MIN_STATE_N = 15
MIN_STATES = 5
MIN_FRESH = 200
MAX_DROP_SHARE = 0.05
OUTLIER_K = 5.0
OUTLIER_FLOOR = {"corn": 25.0, "soybeans": 50.0}     # cents
MEDIAN_CAP = {"corn": 35.0, "soybeans": 85.0}        # cents; past a day's futures limit
PPU_BAND = {"corn": (2.0, 12.0), "soybeans": (6.0, 32.0)}
MAX_BASIS_CENTS = 300
MAX_SHOWN = 3
CROP_WORD = {"corn": "corn", "soybeans": "soybean"}
CROP_NAME = {"corn": "Corn", "soybeans": "Soybean"}
SPECIAL_GRADE = re.compile(r"non[- ]?gmo|organic|\bwhite\b|\bfeed\b|durum|\bsww\b|spring|\bhrs\b|\bdns\b|dark northern|mgex", re.I)
US_STATES = {
    "AL": "Alabama", "AR": "Arkansas", "AZ": "Arizona", "CA": "California", "CO": "Colorado",
    "CT": "Connecticut", "DE": "Delaware", "FL": "Florida", "GA": "Georgia", "IA": "Iowa", "ID": "Idaho",
    "IL": "Illinois", "IN": "Indiana", "KS": "Kansas", "KY": "Kentucky", "LA": "Louisiana",
    "MA": "Massachusetts", "MD": "Maryland", "ME": "Maine", "MI": "Michigan", "MN": "Minnesota",
    "MO": "Missouri", "MS": "Mississippi", "MT": "Montana", "NC": "North Carolina", "ND": "North Dakota",
    "NE": "Nebraska", "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico", "NV": "Nevada",
    "NY": "New York", "OH": "Ohio", "OK": "Oklahoma", "OR": "Oregon", "PA": "Pennsylvania",
    "RI": "Rhode Island", "SC": "South Carolina", "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas",
    "UT": "Utah", "VA": "Virginia", "VT": "Vermont", "WA": "Washington", "WI": "Wisconsin",
    "WV": "West Virginia", "WY": "Wyoming", "AK": "Alaska", "HI": "Hawaii",
}
MONTH_CODE = {"F": "January", "G": "February", "H": "March", "J": "April", "K": "May", "M": "June",
              "N": "July", "Q": "August", "U": "September", "V": "October", "X": "November", "Z": "December"}
MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
DOW = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
FR = {0: "", 25: "¼", 50: "½", 75: "¾"}


# ── small helpers ──────────────────────────────────────────────────────────
def fnv(s):
    """FNV-1a 32-bit over UTF-16 code units: the key build_bids_prev.py and
    components/bids-homepage.js use for data/bids-prev."""
    h = 0x811C9DC5
    b = s.encode("utf-16-le")
    for i in range(0, len(b), 2):
        h ^= b[i] | (b[i + 1] << 8)
        h = (h * 0x01000193) & 0xFFFFFFFF
    return "%08x" % h


def parse_iso(s):
    try:
        d = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return d if d.tzinfo else None


def hours_old(stamp, now):
    """Hours from `stamp` to `now`; None when unparseable. Negative = from the future."""
    d = parse_iso(stamp)
    return None if d is None else (now - d).total_seconds() / 3600.0


def fresh(stamp, now):
    h = hours_old(stamp, now)
    return h is not None and 0 <= h <= STALE_H


def ct_date(dt_):
    return dt_.astimezone(CT).date()


def short(d):
    return f"{MON[d.month - 1]} {d.day}"


def day_words(d):
    """'Thursday, Oct 15'"""
    return f"{DOW[d.weekday()]}, {short(d)}"


def qc(cents):
    """|cents| to the nearest quarter, as a grain board writes it: 4.5 -> '4½'."""
    q = round(abs(cents) * 4) / 4
    w = int(math.floor(q))
    f = int(round((q - w) * 100))
    return (str(w) if (w or not f) else "") + FR[f]


def num(n):
    return f"{n:,}"


def prior_trading_day(d):
    d = d - timedelta(days=1)
    while not cc.is_trading_day(d):
        d -= timedelta(days=1)
    return d


def robust_keep(values, floor):
    """(kept, dropped): values within OUTLIER_K robust SDs of the median, the
    band never narrower than `floor` either side."""
    if not values:
        return [], []
    med = statistics.median(values)
    mad = statistics.median([abs(v - med) for v in values])
    band = max(OUTLIER_K * 1.4826 * mad, floor)
    kept = [v for v in values if abs(v - med) <= band]
    dropped = [v for v in values if abs(v - med) > band]
    return kept, dropped


def usable_now(place, crop):
    """The place's `now` row for crop if it is a plain US per-bushel bid in band."""
    st = str(place.get("state") or "").upper()
    if st not in US_STATES or (place.get("currency") or "USD") != "USD":
        return None
    n = (place.get("now") or {}).get(crop)
    if not isinstance(n, dict) or not place.get("place") or not n.get("period"):
        return None
    cash = n.get("cash")
    if not isinstance(cash, (int, float)) or isinstance(cash, bool) or not math.isfinite(cash):
        return None
    lo, hi = PPU_BAND[crop]
    if not lo <= cash <= hi or SPECIAL_GRADE.search(str(n.get("commodity") or "")):
        return None
    return n


def join_names(names):
    return names[0] if len(names) == 1 else ", ".join(names[:-1]) + " and " + names[-1]


# ── fact: yesterday's cash change ──────────────────────────────────────────
def cash_change(crop, index, prev, prev_generated, now):
    fid = f"cash_change_{crop}"
    if not fresh(prev_generated, now):
        return None, {"id": fid, "why": "stale", "detail": f"bids-prev generated {prev_generated}"}
    if not index or not index.get("places"):
        return None, {"id": fid, "why": "stale", "detail": "elevator network index unreadable"}
    if not fresh(index.get("generated"), now):
        return None, {"id": fid, "why": "stale", "detail": f"index generated {index.get('generated')}"}
    today = ct_date(now)
    last = prior_trading_day(today)
    before = prior_trading_day(last)
    L, P = last.isoformat(), before.isoformat()
    pairs, by_state = [], {}
    for p in index["places"]:
        n = usable_now(p, crop)
        if not n:
            continue
        st = p["state"].upper()
        hist = (prev.get(st) or {}).get(fnv(p["place"] + "|" + crop + "|" + n["period"]))
        if not isinstance(hist, list):
            continue
        on = {e[0]: e for e in hist if isinstance(e, list) and len(e) >= 3}
        a, b = on.get(P), on.get(L)
        if not a or not b or not isinstance(a[1], (int, float)) or not isinstance(b[1], (int, float)):
            continue
        c = round((b[1] - a[1]) * 100, 4)
        bc = None
        if isinstance(a[2], (int, float)) and isinstance(b[2], (int, float)):
            bc = round(b[2] - a[2], 4)
        pairs.append((st, c, bc))
    if len(pairs) < MIN_PAIRS:
        return None, {"id": fid, "why": "sample", "detail": f"{len(pairs)} matched boards for {P} to {L}, need {MIN_PAIRS}"}
    kept, dropped = robust_keep([c for _, c, _ in pairs], OUTLIER_FLOOR[crop])
    if len(dropped) > MAX_DROP_SHARE * len(pairs):
        return None, {"id": fid, "why": "outlier", "detail": f"{len(dropped)} of {len(pairs)} pairs outside the filter"}
    med_all = statistics.median([c for _, c, _ in pairs])
    band = max(OUTLIER_K * 1.4826 * statistics.median([abs(c - med_all) for _, c, _ in pairs]), OUTLIER_FLOOR[crop])
    good = [x for x in pairs if abs(x[1] - med_all) <= band]
    med = statistics.median([c for _, c, _ in good])
    if abs(med) > MEDIAN_CAP[crop]:
        return None, {"id": fid, "why": "outlier", "detail": f"median move {med}c is beyond a day's limit"}
    down = sum(1 for _, c, _ in good if c <= -0.125)
    up = sum(1 for _, c, _ in good if c >= 0.125)
    unch = len(good) - down - up
    bmoves = [bc for _, _, bc in good if bc is not None]
    weaker = sum(1 for bc in bmoves if bc <= -0.125)
    stronger = sum(1 for bc in bmoves if bc >= 0.125)
    for st, c, _ in good:
        by_state.setdefault(st, []).append(c)
    states = []
    for st, cs in by_state.items():
        if len(cs) >= MIN_STATE_N:
            states.append({"state": st, "name": US_STATES[st], "n": len(cs), "median_cents": round(statistics.median(cs), 4)})
    states.sort(key=lambda s: (-abs(s["median_cents"]), -s["n"], s["state"]))
    qm = round(med * 4) / 4
    lday, pday = day_words(last), DOW[before.weekday()]
    cw = CROP_WORD[crop]
    if down == 0 and up == 0:
        lead = f"On {lday}, none of the {num(len(good))} elevators AGSIST reads changed its cash {cw} bid from {pday}"
    else:
        (k1, w1), (k2, w2) = sorted([(down, "lower"), (up, "higher")], key=lambda x: -x[0])
        who = f"all {num(k1)}" if k1 == len(good) else f"{num(k1)} of the {num(len(good))}"
        lead = f"On {lday}, {who} elevators AGSIST reads posted a {w1} cash {cw} bid than {pday}"
        if k2:
            lead += f", {num(k2)} a {w2} one"
    changed = weaker + stronger
    if changed == 0:
        btail = "none changed its basis"
    else:
        parts = []
        if weaker:
            parts.append(f"{num(weaker)} weaker")
        if stronger:
            parts.append(f"{num(stronger)} stronger")
        btail = f"{num(changed)} changed their basis, " + " and ".join(parts)
    sentence = f"{lead}; {btail}."
    key = (f"none of the {num(len(good))} elevators" if (down == 0 and up == 0)
           else (f"all {num(len(good))} elevators" if max(down, up) == len(good)
                 else f"{num(max(down, up))} of the {num(len(good))} elevators"))
    mw = "0\u00a2" if qm == 0 else f"{qc(qm)}\u00a2 {'lower' if qm < 0 else 'higher'}"
    detail = f"{num(unch)} unchanged; median change {mw}."
    big = states[0] if states and abs(states[0]["median_cents"]) >= 0.125 else None
    if big:
        q = round(big["median_cents"] * 4) / 4
        detail += (f" Biggest state move: {big['name']}, {qc(q)}¢ "
                   f"{'lower' if q < 0 else 'higher'} ({num(big['n'])} elevators).")
    if dropped:
        detail += f" {len(dropped)} outlier{'s' if len(dropped) != 1 else ''} left out."
    return {
        "id": fid, "crop": crop, "kind": "cash_change",
        "sentence": sentence, "key": key, "detail": detail,
        "value": qm, "unit": "cents per bushel, median change in cash bid",
        "comparison": f"last posted bid on {L} vs {P}, same board, crop and delivery period",
        "n": len(good), "down": down, "up": up, "unchanged": unch,
        "basis_changed": changed, "basis_weaker": weaker, "basis_stronger": stronger,
        "outliers": len(dropped), "states": states[:6],
        "as_of": L, "from": P,
        "source": "AGSIST elevator network, last posted bid per trading day (data/bids-prev)",
        "url": "/cash-bids", "link_text": "Cash bids near you",
    }, None


# ── fact: state basis spread ───────────────────────────────────────────────
def contract_words(sym, label=""):
    m = re.match(r"^Z[CSW]([FGHJKMNQUVXZ])\d{2}$", str(sym or ""))
    if m:
        return f"{MONTH_CODE[m.group(1)]} futures"
    return f"{label} futures".strip() if label else "futures"


def basis_words(dollars):
    c = round(dollars * 100 * 4) / 4
    if abs(c) < 0.125:
        return "even with"
    return f"{qc(c)}¢ {'over' if c > 0 else 'under'}"


def basis_spread(crop, bs, now):
    fid = f"basis_spread_{crop}"
    if not isinstance(bs, dict) or not fresh(bs.get("generated"), now):
        return None, {"id": fid, "why": "stale", "detail": f"basis-states generated {(bs or {}).get('generated')}"}
    rows = []
    for st, v in (bs.get("states") or {}).items():
        x = ((v or {}).get("crops") or {}).get(crop)
        if st not in US_STATES or not isinstance(x, dict):
            continue
        m = x.get("median")
        if not isinstance(m, (int, float)) or isinstance(m, bool) or not math.isfinite(m) or abs(m) > 2:
            continue
        if (x.get("n") or 0) < MIN_STATE_N:
            continue
        rows.append({"state": st, "name": US_STATES[st], "n": int(x["n"]), "median": float(m),
                     "contract": x.get("contract"), "label": x.get("label") or "",
                     "path": v.get("path") or ""})
    if not rows:
        return None, {"id": fid, "why": "sample", "detail": "no state qualifies"}
    counts = {}
    for r in rows:
        counts[r["contract"]] = counts.get(r["contract"], 0) + 1
    main = sorted(counts.items(), key=lambda kv: (-kv[1], str(kv[0])))[0][0]
    rows = [r for r in rows if r["contract"] == main]
    if len(rows) < MIN_STATES:
        return None, {"id": fid, "why": "sample", "detail": f"{len(rows)} states with {MIN_STATE_N}+ elevators on {main}, need {MIN_STATES}"}
    hi = max(r["median"] for r in rows)
    lo = min(r["median"] for r in rows)
    if hi == lo:
        return None, {"id": fid, "why": "sample", "detail": "every state has the same median"}
    top = sorted([r for r in rows if r["median"] == hi], key=lambda r: r["name"])
    bot = sorted([r for r in rows if r["median"] == lo], key=lambda r: r["name"])
    asof = ct_date(parse_iso(bs["generated"]))
    cw = contract_words(main, top[0]["label"])
    hiw, low = basis_words(hi), basis_words(lo)
    sentence = (f"{CROP_NAME[crop]} basis on {short(asof)} ran from {hiw} {cw} in {join_names([r['name'] for r in top])} "
                f"to {low} in {join_names([r['name'] for r in bot])}, state medians of the elevators AGSIST reads.")
    detail = ("Elevators behind each median: " +
              ", ".join(f"{r['name']} {num(r['n'])}" for r in top + bot) +
              f". {len(rows)} states with {MIN_STATE_N} or more.")
    return {
        "id": fid, "crop": crop, "kind": "basis_spread",
        "sentence": sentence, "key": f"{hiw} {cw}", "detail": detail,
        "value": round((hi - lo) * 100, 2), "unit": "cents per bushel between the strongest and weakest state median",
        "comparison": f"state median basis against {main}, states with {MIN_STATE_N}+ elevators",
        "n": sum(r["n"] for r in rows), "states_n": len(rows),
        "high": [{"state": r["state"], "name": r["name"], "median": r["median"], "n": r["n"]} for r in top],
        "low": [{"state": r["state"], "name": r["name"], "median": r["median"], "n": r["n"]} for r in bot],
        "contract": main, "as_of": asof.isoformat(),
        "source": "AGSIST elevator network, state median basis (scripts/basis_method.py)",
        "url": "/basis", "link_text": "Basis by state",
    }, None


# ── fact: boards paying over futures ───────────────────────────────────────
def over_futures(crop, index, now):
    fid = f"over_futures_{crop}"
    if not index or not index.get("places") or not fresh(index.get("generated"), now):
        return None, {"id": fid, "why": "stale", "detail": f"index generated {(index or {}).get('generated')}"}
    over, under, even, by_state = 0, 0, 0, {}
    for p in index["places"]:
        n = usable_now(p, crop)
        if not n or not fresh(p.get("pricedAt"), now):
            continue
        b = n.get("basisCents")
        if not isinstance(b, (int, float)) or isinstance(b, bool) or abs(b) > MAX_BASIS_CENTS:
            continue
        if b >= 0.125:
            over += 1
            by_state[p["state"].upper()] = by_state.get(p["state"].upper(), 0) + 1
        elif b <= -0.125:
            under += 1
        else:
            even += 1
    total = over + under + even
    if total < MIN_FRESH:
        return None, {"id": fid, "why": "sample", "detail": f"{total} fresh boards, need {MIN_FRESH}"}
    asof = ct_date(now)
    gen = parse_iso(index["generated"])
    if gen:
        asof = ct_date(gen)
    lead = sorted(by_state.items(), key=lambda kv: (-kv[1], kv[0]))
    if over == 0:
        sentence = (f"None of the {num(total)} elevators AGSIST reads with a fresh {CROP_WORD[crop]} bid on {short(asof)} "
                    f"was paying over futures.")
    else:
        where = ""
        if lead and lead[0][1] >= 2:
            where = f", most of them in {US_STATES[lead[0][0]]} ({lead[0][1]})"
        sentence = (f"Of {num(total)} elevators AGSIST reads with a fresh {CROP_WORD[crop]} bid on {short(asof)}, "
                    f"{num(over)} {'was' if over == 1 else 'were'} paying over futures{where}.")
    detail = f"{num(under)} under futures, {num(even)} even. Each board against the futures month it names."
    return {
        "id": fid, "crop": crop, "kind": "over_futures",
        "sentence": sentence, "key": (f"None of the {num(total)} elevators" if over == 0 else
                                      f"{num(over)} {'was' if over == 1 else 'were'} paying over futures"),
        "detail": detail,
        "value": over, "unit": "elevators bidding over futures",
        "comparison": "basis now on each board's nearest open delivery, boards posted within 36 hours",
        "n": total, "over": over, "under": under, "even": even,
        "states": [{"state": s, "name": US_STATES[s], "n": k} for s, k in lead[:5]],
        "as_of": asof.isoformat(),
        "source": "AGSIST elevator network, live board basis (merged-index.json)",
        "url": "/cash-bids", "link_text": "Cash bids near you",
    }, None


# ── the whole block ────────────────────────────────────────────────────────
ORDER = ("cash_change_corn", "cash_change_soybeans", "basis_spread_corn", "over_futures_corn", "basis_spread_soybeans")


def build(index, prev, prev_generated, basis_states, now):
    """Pure. All facts that pass, in ORDER, and every refusal with its reason."""
    facts, withheld = [], []
    for fn in (lambda: cash_change("corn", index, prev, prev_generated, now),
               lambda: cash_change("soybeans", index, prev, prev_generated, now),
               lambda: basis_spread("corn", basis_states, now),
               lambda: over_futures("corn", index, now),
               lambda: basis_spread("soybeans", basis_states, now)):
        try:
            f, w = fn()
        except Exception as ex:  # noqa: BLE001 -- a broken input withholds one fact, never the issue
            f, w = None, {"id": "?", "why": "error", "detail": f"{type(ex).__name__}: {ex}"}
        if f:
            facts.append(f)
        if w:
            withheld.append(w)
    facts.sort(key=lambda f: ORDER.index(f["id"]))
    return {
        "schema": SCHEMA,
        "generated": now.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "label": "Only on AGSIST",
        "note": "Computed by code from the elevator boards AGSIST reads. Not written by the drafting model.",
        "facts": facts,
        "withheld": withheld,
    }


def shown(block, limit=MAX_SHOWN):
    """The facts a reader sees: at most `limit`, in ORDER. [] for anything malformed."""
    if not isinstance(block, dict) or not isinstance(block.get("facts"), list):
        return []
    out = [f for f in block["facts"] if isinstance(f, dict) and f.get("sentence") and f.get("url")]
    return out[:limit]


def for_issue(block, now=None):
    """The block to attach to an issue: only when it was built within STALE_H
    hours before `now` and carries at least one fact; else None."""
    now = now or datetime.now(timezone.utc)
    if not isinstance(block, dict) or block.get("schema") != SCHEMA or not fresh(block.get("generated"), now):
        return None
    facts = shown(block)
    if not facts:
        return None
    keep = ("id", "kind", "crop", "sentence", "key", "detail", "value", "unit", "n", "as_of", "source", "url", "link_text")
    return {"label": block.get("label") or "Only on AGSIST", "generated": block["generated"],
            "facts": [{k: f.get(k) for k in keep} for f in facts]}


def jsonld_tail(edge):
    """The first fact's sentence, for the NewsArticle description; '' without one."""
    f = shown(edge, 1)
    return f[0]["sentence"] if f else ""


# ── Sig's own note ─────────────────────────────────────────────────────────
CCA_NOTE_PATH = os.path.join(REPO, "data", "cca-note.json")
CCA_NOTE_MAX = 600


def cca_note(issue_date, path=CCA_NOTE_PATH):
    """Sig's note for this issue, or None. data/cca-note.json is
    {"date": "YYYY-MM-DD", "text": "..."}, filled by Sig by hand. It shows only
    on the issue whose date matches, so a note never repeats on the next day.
    Nothing here writes, rewords or shortens it; a note that is too long or not
    plain text is not shown at all (the workflow log says why)."""
    j = load_json(path)
    if not isinstance(j, dict):
        return None
    text = str(j.get("text") or "").strip()
    if not text or str(j.get("date") or "") != str(issue_date):
        return None
    if len(text) > CCA_NOTE_MAX or "<" in text or ">" in text:
        print(f"  [cca-note] not shown: {len(text)} chars (max {CCA_NOTE_MAX}) or contains < or >")
        return None
    return {"date": str(issue_date), "text": text}


# ── HTML (the archive page; components/daily-edge.js draws the same on /daily) ──
def _esc(x):
    import html
    return html.escape(str(x if x is not None else ""), quote=True)


def _linked(f):
    """The sentence, escaped, with its key span linked to the page that shows it."""
    s, k, u = str(f.get("sentence") or ""), str(f.get("key") or ""), str(f.get("url") or "")
    if not u.startswith("/"):
        u = ""
    if k and u and k in s:
        i = s.index(k)
        return _esc(s[:i]) + f'<a href="{_esc(u)}">' + _esc(k) + "</a>" + _esc(s[i + len(k):])
    return _esc(s)


def render_html(edge, date_iso=""):
    """The "Only on AGSIST" block, or '' when there is nothing to show."""
    facts = shown(edge)
    if not facts:
        return ""
    items = "".join(
        f'<li class="dv3-edge-fact" id="edge-{_esc(f.get("id"))}">'
        f'<p class="dv3-edge-s">{_linked(f)}</p>'
        + (f'<p class="dv3-edge-d">{_esc(f.get("detail"))}</p>' if f.get("detail") else "")
        + "</li>" for f in facts)
    cite = (f' Quote it with the date and a link to agsist.com/daily/{_esc(date_iso)}.'
            if re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(date_iso or "")) else "")
    return ('<section class="dv3-edge" aria-labelledby="dv3-edge-h">'
            f'<h2 class="dv3-edge-label" id="dv3-edge-h">{_esc(edge.get("label") or "Only on AGSIST")}</h2>'
            f'<ol class="dv3-edge-list">{items}</ol>'
            '<p class="dv3-edge-note">Counted by code from the elevator boards AGSIST reads itself, '
            'not by the writer of this briefing. A day\'s change is each board\'s last posted bid against '
            f'its own on the trading day before, same delivery period.{cite} <a href="/editorial-standards#how-the-daily-is-made">How this briefing is made</a>'
            ' &middot; <a href="/cash-bid-index">Monthly: AGSIST Cash Bid Index</a></p>'
            '</section>')


def render_note_html(note):
    """Sig's own note, or '' when he did not write one for this issue."""
    if not isinstance(note, dict) or not str(note.get("text") or "").strip():
        return ""
    return ('<aside class="dv3-cca" aria-label="A note from Sig">'
            '<p class="dv3-cca-label">From Sig</p>'
            f'<p class="dv3-cca-text">{_esc(note["text"].strip())}</p>'
            '<p class="dv3-cca-by">Sigurd Lindquist, CCA</p></aside>')


CSS = (".dv3-edge{margin:1.1rem 0 0;padding:.85rem 1.05rem;background:var(--surface);border:1px solid var(--border);"
       "border-left:4px solid var(--green);border-radius:8px}"
       ".dv3-edge-label{font-family:'JetBrains Mono',monospace;font-size:.72rem;font-weight:700;letter-spacing:.14em;"
       "text-transform:uppercase;color:var(--green);margin:0 0 .45rem}"
       ".dv3-edge-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:.6rem}"
       ".dv3-edge-fact{margin:0;padding:0}"
       ".dv3-edge-s{margin:0;font-size:.97rem;line-height:1.5;color:var(--text);font-weight:600}"
       ".dv3-edge-s a{color:inherit;text-decoration:underline;text-decoration-color:var(--green);"
       "text-decoration-thickness:2px;text-underline-offset:3px}"
       ".dv3-edge-d{margin:.1rem 0 0;font-size:.8rem;line-height:1.45;color:var(--text-muted)}"
       ".dv3-edge-note{margin:.6rem 0 0;font-size:.76rem;line-height:1.5;color:var(--text-muted)}"
       ".dv3-edge-note a{color:var(--text-muted);text-decoration:underline;display:inline-block;padding:.35rem 0;margin:-.35rem 0}"
       ".dv3-cca{margin:1rem 0 0;padding:.8rem 1.05rem;background:var(--surface2);border:1px solid var(--border);"
       "border-left:4px solid var(--gold);border-radius:8px}"
       ".dv3-cca-label{font-family:'JetBrains Mono',monospace;font-size:.72rem;font-weight:700;letter-spacing:.14em;"
       "text-transform:uppercase;color:var(--gold);margin:0 0 .3rem}"
       ".dv3-cca-text{margin:0;font-size:.98rem;line-height:1.6;color:var(--text)}"
       ".dv3-cca-by{margin:.35rem 0 0;font-size:.8rem;color:var(--text-muted)}")


# ── files ──────────────────────────────────────────────────────────────────
def load_prev(repo=REPO):
    shards, newest = {}, None
    for fp in sorted(glob.glob(os.path.join(repo, "data", "bids-prev", "*.json"))):
        try:
            with open(fp, encoding="utf-8") as f:
                j = json.load(f)
        except Exception:  # noqa: BLE001
            continue
        shards[os.path.basename(fp)[:-5]] = j.get("rows") or {}
        g = j.get("generated")
        if g and (newest is None or str(g) > newest):
            newest = str(g)
    return shards, newest


def load_json(fp):
    try:
        with open(fp, encoding="utf-8") as f:
            return json.load(f)
    except Exception:  # noqa: BLE001
        return None


def build_from_files(repo=REPO, bids_base=None, now=None):
    import local_bid
    now = now or datetime.now(timezone.utc)
    index = local_bid.BidsData(bids_base).index()
    prev, prev_gen = load_prev(repo)
    bs = load_json(os.path.join(repo, "data", "basis-states.json"))
    return build(index, prev, prev_gen, bs, now)


# ── selftest ───────────────────────────────────────────────────────────────
def _fixture(n_pairs=120, move=-4.0, now_iso="2026-10-16T10:40:00Z"):
    """n_pairs Iowa corn boards: cash fell `move` cents from Oct 14 to Oct 15;
    the first 10 also weakened basis 2c, the next 3 strengthened 1c."""
    places, prev = [], {"IA": {}}
    for i in range(n_pairs):
        place = f"Coop {i}||Town{i}|IA"
        places.append({"place": place, "state": "IA", "currency": "USD", "pricedAt": "2026-10-15T18:00:00Z",
                       "now": {"corn": {"cash": 4.00, "basisCents": -40, "period": "2026-10", "commodity": "Corn"}}})
        bb = -40 - (2 if i < 10 else (-1 if i < 13 else 0))
        prev["IA"][fnv(place + "|corn|2026-10")] = [["2026-10-13", 4.10, -40], ["2026-10-14", 4.08, -40],
                                                    ["2026-10-15", round(4.08 + move / 100, 4), bb]]
    idx = {"generated": "2026-10-16T09:00:00Z", "places": places}
    return idx, prev, datetime.fromisoformat(now_iso.replace("Z", "+00:00"))


def _selftest():
    bad = []

    def ok(cond, what):
        if not cond:
            bad.append(what)

    # hand-worked: 120 boards, each 4c lower Thu Oct 15 vs Wed Oct 14; 10 weaker, 3 stronger
    idx, prev, now = _fixture()
    f, w = cash_change("corn", idx, prev, "2026-10-16T09:30:00Z", now)
    ok(w is None and f, f"cash change refused: {w}")
    if f:
        ok(f["n"] == 120 and f["value"] == -4.0 and f["down"] == 120 and f["up"] == 0, f"counts {f}")
        ok(f["basis_changed"] == 13 and f["basis_weaker"] == 10 and f["basis_stronger"] == 3, "basis counts")
        want = ("On Thursday, Oct 15, all 120 elevators AGSIST reads posted a lower cash corn bid than "
                "Wednesday; 13 changed their basis, 10 weaker and 3 stronger.")
        ok(f["sentence"] == want, f"sentence {f['sentence']!r}")
        ok(f["as_of"] == "2026-10-15" and f["from"] == "2026-10-14", "dates")
        ok("Biggest state move: Iowa, 4¢ lower (120 elevators)." in f["detail"], f["detail"])
    # Monday's issue compares Friday with Thursday (weekend skipped)
    idx2, prev2, _ = _fixture()
    for k in prev2["IA"]:
        prev2["IA"][k] = [["2026-10-15", 4.08, -40], ["2026-10-16", 4.10, -40]]
    idx2["generated"] = "2026-10-19T09:00:00Z"
    f, w = cash_change("corn", idx2, prev2, "2026-10-19T09:30:00Z", datetime(2026, 10, 19, 10, 40, tzinfo=timezone.utc))
    ok(f and f["value"] == 2.0 and f["sentence"].startswith("On Friday, Oct 16, all 120 elevators AGSIST reads posted a higher cash corn bid than Thursday;"), f"monday {w} {f and f['sentence']}")
    # 99 boards: refused, sample
    idx, prev, now = _fixture(n_pairs=99)
    f, w = cash_change("corn", idx, prev, "2026-10-16T09:30:00Z", now)
    ok(f is None and w["why"] == "sample", f"small sample {w}")
    # stale: bids-prev 37 hours old
    idx, prev, now = _fixture()
    f, w = cash_change("corn", idx, prev, "2026-10-14T21:39:00Z", now)
    ok(f is None and w["why"] == "stale", f"stale {w}")
    # look-ahead: index from after `now`
    idx, prev, now = _fixture()
    idx["generated"] = "2026-10-16T12:00:00Z"
    f, w = cash_change("corn", idx, prev, "2026-10-16T09:30:00Z", now)
    ok(f is None and w["why"] == "stale", f"future index {w}")
    # outliers: 7 of 120 boards (5.8%) read $1 lower -> refused; 5 of 120 -> kept out, fact stands
    for k_bad, want_fact in ((7, False), (5, True)):
        idx, prev, now = _fixture()
        for key in list(prev["IA"])[:k_bad]:
            prev["IA"][key][-1][1] = round(prev["IA"][key][-1][1] - 1.0, 4)
        f, w = cash_change("corn", idx, prev, "2026-10-16T09:30:00Z", now)
        ok(bool(f) == want_fact, f"outliers {k_bad}: {w}")
        if f:
            ok(f["n"] == 115 and f["outliers"] == 5 and f["value"] == -4.0, f"outlier counts {f['n']} {f['outliers']}")
    # a median move past a day's limit is refused
    idx, prev, now = _fixture(move=-40.0)
    f, w = cash_change("corn", idx, prev, "2026-10-16T09:30:00Z", now)
    ok(f is None and w["why"] == "outlier", f"limit {w}")
    # unchanged day, no basis changes
    idx, prev, now = _fixture(move=0.0)
    for k in prev["IA"]:
        prev["IA"][k][-1][2] = -40
    f, w = cash_change("corn", idx, prev, "2026-10-16T09:30:00Z", now)
    ok(f and f["sentence"] == "On Thursday, Oct 15, none of the 120 elevators AGSIST reads changed its cash corn bid from Wednesday; none changed its basis.", f and f["sentence"])
    ok(f and f["detail"].startswith("120 unchanged; median change 0¢."), f and f["detail"])
    # mixed day: 70 lower 4c, 30 higher 1c, 20 unchanged -> lower first, median of all 120
    idx, prev, now = _fixture()
    keys = list(prev["IA"])
    for i, key in enumerate(keys):
        prev["IA"][key][-1][1] = round(4.08 + (-0.04 if i < 70 else (0.01 if i < 100 else 0.0)), 4)
    f, w = cash_change("corn", idx, prev, "2026-10-16T09:30:00Z", now)
    ok(f and f["sentence"].startswith("On Thursday, Oct 15, 70 of the 120 elevators AGSIST reads posted a lower cash corn bid than Wednesday, 30 a higher one;"), f and f["sentence"])
    ok(f and f["value"] == -4.0 and f["unchanged"] == 20, f and (f["value"], f["unchanged"]))
    # a board whose period rolled (no matching key) is not a pair
    idx, prev, now = _fixture()
    idx["places"][0]["now"]["corn"]["period"] = "2026-11"
    f, _ = cash_change("corn", idx, prev, "2026-10-16T09:30:00Z", now)
    ok(f and f["n"] == 119, "rolled period")
    # special grades and CAD boards are left out
    idx, prev, now = _fixture()
    idx["places"][1]["now"]["corn"]["commodity"] = "Non-GMO Corn"
    idx["places"][2]["currency"] = "CAD"
    f, _ = cash_change("corn", idx, prev, "2026-10-16T09:30:00Z", now)
    ok(f and f["n"] == 118, "special grade / CAD")

    # basis spread, hand-worked: CO +0.11 (26), ND and SD -0.80 (37, 89), MI too small
    bs = {"generated": "2026-10-16T00:37:10Z", "states": {
        "CO": {"crops": {"corn": {"contract": "ZCZ26", "label": "Dec '26", "n": 26, "median": 0.11}}},
        "IA": {"crops": {"corn": {"contract": "ZCZ26", "label": "Dec '26", "n": 277, "median": -0.40}}},
        "IL": {"crops": {"corn": {"contract": "ZCZ26", "label": "Dec '26", "n": 185, "median": -0.31}}},
        "ND": {"crops": {"corn": {"contract": "ZCZ26", "label": "Dec '26", "n": 37, "median": -0.80}}},
        "SD": {"crops": {"corn": {"contract": "ZCZ26", "label": "Dec '26", "n": 89, "median": -0.80}}},
        "MI": {"crops": {"corn": {"contract": "ZCZ26", "label": "Dec '26", "n": 14, "median": 0.90}}},
        "TX": {"crops": {"corn": {"contract": "ZCH27", "label": "Mar '27", "n": 17, "median": 0.55}}},
    }}
    now = datetime(2026, 10, 16, 10, 40, tzinfo=timezone.utc)
    f, w = basis_spread("corn", bs, now)
    ok(f is not None, f"spread refused {w}")
    if f:
        want = ("Corn basis on Oct 15 ran from 11¢ over December futures in Colorado to 80¢ under in "
                "North Dakota and South Dakota, state medians of the elevators AGSIST reads.")
        ok(f["sentence"] == want, f"spread sentence {f['sentence']!r}")
        ok(f["value"] == 91.0 and f["states_n"] == 5, f"spread value {f['value']} {f['states_n']}")
    bs4 = json.loads(json.dumps(bs))
    del bs4["states"]["IL"]
    f, w = basis_spread("corn", bs4, now)
    ok(f is None and w["why"] == "sample", f"4 states {w}")
    f, w = basis_spread("corn", dict(bs, generated="2026-10-14T20:00:00Z"), now)
    ok(f is None and w["why"] == "stale", f"stale spread {w}")

    # over futures, hand-worked: 210 fresh boards, 3 over in CO, 2 over in TX, 1 even
    places = []
    for i in range(210):
        st, b = ("CO", 10) if i < 3 else (("TX", 5) if i < 5 else ("IA", 0 if i == 5 else -40))
        places.append({"place": f"P{i}||T|{st}", "state": st, "currency": "USD", "pricedAt": "2026-10-16T08:00:00Z",
                       "now": {"corn": {"cash": 4.2, "basisCents": b, "period": "2026-10", "commodity": "Corn"}}})
    places.append({"place": "Old||T|IA", "state": "IA", "pricedAt": "2026-10-13T08:00:00Z",
                   "now": {"corn": {"cash": 4.2, "basisCents": 50, "period": "2026-10"}}})
    idx = {"generated": "2026-10-16T09:00:00Z", "places": places}
    f, w = over_futures("corn", idx, now)
    ok(f and f["n"] == 210 and f["over"] == 5 and f["even"] == 1 and f["under"] == 204, f"over counts {w} {f}")
    if f:
        ok(f["sentence"] == "Of 210 elevators AGSIST reads with a fresh corn bid on Oct 16, 5 were paying over futures, most of them in Colorado (3).", f["sentence"])
    f, w = over_futures("corn", {"generated": idx["generated"], "places": places[:150]}, now)
    ok(f is None and w["why"] == "sample", f"over sample {w}")

    # the block: order, the 3-fact cap, and for_issue's freshness
    idx, prev, now = _fixture()
    blk = build(idx, prev, "2026-10-16T09:30:00Z", bs, now)
    ids = [f["id"] for f in blk["facts"]]
    ok(ids == ["cash_change_corn", "basis_spread_corn"], f"ids {ids}")
    ok({w["id"] for w in blk["withheld"]} == {"cash_change_soybeans", "over_futures_corn", "basis_spread_soybeans"}, blk["withheld"])
    e = for_issue(blk, now)
    ok(e and len(e["facts"]) == 2 and e["label"] == "Only on AGSIST", "for_issue")
    ok(for_issue(blk, now + timedelta(hours=37)) is None, "for_issue stale")
    ok(for_issue({"schema": SCHEMA, "generated": blk["generated"], "facts": []}, now) is None, "for_issue empty")
    for f in blk["facts"]:
        ok(f["key"] in f["sentence"], f"key not in sentence: {f['key']!r}")
    many = dict(blk, facts=blk["facts"] * 3)
    ok(len(shown(many)) == 3, "cap 3")
    ok(jsonld_tail(e).startswith("On Thursday, Oct 15, all 120 elevators"), "jsonld tail")
    for f in blk["facts"]:
        for k in ("sentence", "detail"):
            ok("\u2014" not in f[k] and "first" not in f[k].lower() and "record" not in f[k].lower(), f"words in {k}")
    ok(fnv("Abbyville Farmers Co-op Grain Co.||Abbyville|KS|corn|2026-08/2026-11") == "0dd84803", "fnv matches build_bids_prev")
    ok(qc(-4.25) == "4¼" and qc(0.5) == "½" and qc(12) == "12", "qc")

    import tempfile
    with tempfile.TemporaryDirectory() as td:
        fp = os.path.join(td, "n.json")
        for body, day, want in (({"date": "2026-10-16", "text": "Basis is the story this week."}, "2026-10-16", True),
                                ({"date": "2026-10-15", "text": "Old note."}, "2026-10-16", False),
                                ({"date": "2026-10-16", "text": "   "}, "2026-10-16", False),
                                ({"date": "2026-10-16", "text": "x" * 601}, "2026-10-16", False),
                                ({"date": "2026-10-16", "text": "<b>hi</b>"}, "2026-10-16", False)):
            with open(fp, "w") as f:
                json.dump(body, f)
            got = cca_note(day, fp)
            ok(bool(got) == want, f"cca note {body} -> {got}")
        ok(cca_note("2026-10-16", os.path.join(td, "missing.json")) is None, "cca note missing file")
    shipped = load_json(CCA_NOTE_PATH)
    ok(isinstance(shipped, dict) and not str(shipped.get("text") or "").strip(), "data/cca-note.json ships empty")

    for b in bad:
        print("FAIL", b)
    print("daily_edge selftest " + ("FAILED" if bad else "ok"))
    return 1 if bad else 0


def main(argv):
    if "--selftest" in argv:
        return _selftest()
    now = None
    base = None
    if "--now" in argv:
        now = parse_iso(argv[argv.index("--now") + 1])
    if "--bids-base" in argv:
        base = argv[argv.index("--bids-base") + 1]
    blk = build_from_files(REPO, base, now)
    for f in blk["facts"]:
        print("  [edge] " + f["sentence"])
    for w in blk["withheld"]:
        print(f"  [edge] withheld {w['id']}: {w['why']} ({w.get('detail', '')})")
    if "--print" in argv:
        print(json.dumps(blk, indent=1, ensure_ascii=False))
        return 0
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(blk, f, indent=1, ensure_ascii=False)
        f.write("\n")
    print(f"  wrote {OUT_PATH}: {len(blk['facts'])} fact(s), {len(blk['withheld'])} withheld")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
