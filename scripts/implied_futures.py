#!/usr/bin/env python3
"""implied_futures.py: SHADOW TEST of a futures price read back out of elevator boards.

Nothing here reaches a page. The ticks go to the private repo's raw branch
(data/implied-futures/<Central date>.jsonl) and the summary prints to the job
log. Sig, Oct 28 2026: "can we show a synthetic futures price built from cash
and basis? Yes for grains, IF it holds up." This is the test of "holds up".

THE IDEA. A board posts cash = futures + basis, so cash - basis gives back the
futures price that board was quoting when it priced. The median of that across
many boards, set beside the Yahoo quote the site already shows, says whether
the boards and our quote agree, and how closely, hour by hour.

WHICH BOARDS COUNT (the whole test turns on this). A board only counts when the
board itself published the cash AND the basis, so cash - basis is the board's
number and not ours. Measured on the dnilgis/bids manifests, Oct 28 2026:

  * identityAlternative declared (1,486 boards): the board prints no futures
    price, so the bids poller checks it against OUR quote pages instead.
      - agricharts-cashgrid (1,218 manifests): the board publishes a basis and
        the NAME of its contract; the bids reader computes cash = basis + our
        AgriCharts quote (lib/adapters/agricharts-cashgrid.mjs, "cash - basis =
        futures IS TRUE BY CONSTRUCTION"). cash - basis is our own quote back.
      - the agsist portal boards: basis typed by the elevator, cash computed
        from our quote the same way.
      - the rest (AgriCharts mobile, Stonehedge named, Heartland, Landus,
        QT Market, Five Star, Emmert): the board does print its own cash and
        basis, but a row is PUBLISHED ONLY WHEN cash - basis lands within a few
        cents of our quote. A test of "do the boards agree with our quote" run
        on rows kept for agreeing with our quote cannot fail. Excluded.
  * Everything else carries the board's own futures column, and the poller
    refuses a row unless cash = basis + that column (lib/board.mjs). Those are
    the boards this test reads.

ROW RULES. The row must name its contract (a contract inferred by fitting the
price to our quote would be our quote again), the commodity must belong to that
contract, the currency must be USD and the unit a bushel.

FRESH. A board counts in a tick when it was READ in the 30 minutes before the
tick (checkedAt) AND its own posted time (pricedAt) is in that window too: a
board read now that last priced at 9 a.m. measures 9 a.m. Never a time after
the tick (no look-ahead, which is what --replay relies on).

WITHHELD. Under 5 fresh boards on a contract, the tick is withheld for that
contract: the stats are kept for study, `shown` is false and the reason says
how many there were. Boards on one feed are not independent (one company's 40
locations share one quote), so each line also counts operators.

    python3 scripts/implied_futures.py --tick --bids <bids checkout> --prices data/prices.json --out data/implied-futures
    python3 scripts/implied_futures.py --summary data/implied-futures [--json]
    python3 scripts/implied_futures.py --replay 2026-10-28 --bids-git <bids clone> --prices-git <agsist clone> --out <dir>
    python3 scripts/implied_futures.py --selftest
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass

import json
import os
import re
import subprocess
import sys
import tarfile
import tempfile
import io
from datetime import datetime, timedelta, timezone
from statistics import median
from zoneinfo import ZoneInfo

UTC = timezone.utc
CT = ZoneInfo("America/Chicago")
HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURES = os.path.join(os.path.dirname(HERE), "test", "fixtures", "implied-futures")

MIN_BOARDS = 5           # under this many fresh boards a contract's tick is withheld
FRESH_MIN = 30           # read, and posted, within this many minutes before the tick
FAR_CENTS = 5.0          # a disagreement worth naming the boards behind it
SESSION_OPEN = (8, 30)   # CBOT grain day session, Central time
SESSION_CLOSE = (13, 20)
AFTER_CLOSE_UNTIL = (15, 0)  # the one after-close tick lands between the close and this

# root -> (crop name, the prices.json key prefix, the commodity words that belong to it)
ROOTS = {
    "ZC": ("corn", "corn", re.compile(r"\bcorn\b|\byc\b", re.I)),
    "ZS": ("soybeans", "beans", re.compile(r"soy|\bbeans?\b|\bysb\b", re.I)),
    "ZW": ("chicago-wheat", "wheat", re.compile(r"wheat|\bwht\b|\bsrw\b|\bsww\b|\bswh\b", re.I)),
    "KE": ("kc-wheat", "kcwheat", re.compile(r"wheat|\bwht\b|\bhrw\b|\bhrww\b|\bhww\b|hard red winter", re.I)),
    "MW": ("spring-wheat", "springwheat", re.compile(r"wheat|\bwht\b|\bhrs\b|\bdns\b|\bdnsw\b|northern spring", re.I)),
}
# Out whatever the contract: other units (the bids reader appends "(cwt)" or "(unit unstated)"), flat-priced
# and specialty grains, products, and grains that only borrow a contract.
NOT_THIS = re.compile(r"organic|\bcwt\b|\btons?\b|\blbs?\b|unit unstated|meal|\boil\b|durum|oats|milo|sorghum|mini", re.I)
MONTHS = "FGHJKMNQUVXZ"
MON3 = {"jan": "F", "feb": "G", "mar": "H", "apr": "J", "may": "K", "jun": "M",
        "jul": "N", "aug": "Q", "sep": "U", "oct": "V", "nov": "X", "dec": "Z"}
MON_NAME = {v: k for k, v in MON3.items()}
# Exchange roots as each platform writes them.
ALIAS = {"ZC": "ZC", "C": "ZC", "ZS": "ZS", "S": "ZS", "ZW": "ZW", "W": "ZW",
         "KE": "KE", "KW": "KE", "MW": "MW", "MWO": "MW", "MWE": "MW"}


def _year(y):
    y = int(y)
    return 2020 + y if y < 10 else 2000 + y


def contract_of(futures_month, commodity):
    """The contract a row names, as (root, month code, year), or (None, reason).

    Only what the row itself says. A row with no contract name is left out: a
    contract found by fitting the price to a quote would be the quote again."""
    fm = str(futures_month or "").strip()
    com = str(commodity or "")
    if not fm:
        return None, "row names no contract"
    m = re.fullmatch(r"@([A-Z]{1,3})(\d)([A-Z])", fm)                      # DTN, aghost: @C6Z, @KW7N
    if m:
        root, y, mo = ALIAS.get(m.group(1)), m.group(2), m.group(3)
    else:
        m = re.fullmatch(r"([A-Z]{1,3}?)([FGHJKMNQUVXZ])(\d{1,2})", fm)     # ZCZ26, ZCZ6, CZ26, MWOH27
        if m:
            root, mo, y = ALIAS.get(m.group(1)), m.group(2), m.group(3)
        else:
            m = re.fullmatch(r"([A-Za-z]{3})[a-z]*\s+'?(\d{2}|\d{4})(?:\s+(.*))?", fm)  # Mar 27 ..., March 2027
            if not m or m.group(1).lower() not in MON3:
                return None, "contract name not readable"
            mo = MON3[m.group(1).lower()]
            y = m.group(2)[-2:]
            rest = (m.group(3) or "").lower()
            if "mini" in rest or "oats" in rest:
                return None, "not a full-size grain contract"
            if "kcbt" in rest or "red wheat" in rest and "kc" in rest:
                root = "KE"
            elif "spring" in rest or "miax" in rest or "mgex" in rest:
                root = "MW"
            elif "soybean" in rest:
                root = "ZS"
            elif "wheat" in rest:
                root = "ZW"
            elif rest:
                return None, "contract name not readable"
            else:
                # A bare month: the commodity decides, and only where it cannot mean two exchanges.
                c = com.lower()
                if re.search(r"\bhrs\b|\bdns|spring", c):
                    root = "MW"
                elif re.search(r"\bhrw|\bhww|\bhrww|winter", c):
                    root = "KE"
                elif re.search(r"\bsrw\b|soft red", c):
                    root = "ZW"
                elif "wheat" in c or "wht" in c:
                    return None, "wheat class not named"
                elif ROOTS["ZC"][2].search(c):
                    root = "ZC"
                elif ROOTS["ZS"][2].search(c):
                    root = "ZS"
                else:
                    return None, "commodity names no contract"
    if not root:
        return None, "not a grain contract we test"
    if mo not in MONTHS:
        return None, "contract name not readable"
    if NOT_THIS.search(com) or not ROOTS[root][2].search(com):
        return None, "commodity does not belong to the contract"
    return (root, mo, _year(y)), None


def contract_key(c):
    root, mo, year = c
    return f"{root}{mo}{str(year)[2:]}"


def yahoo_key(c):
    """The data/prices.json key the site shows for this contract."""
    root, mo, year = c
    return f"{ROOTS[root][1]}-{MON_NAME[mo]}{str(year)[2:]}"


def board_exclusion(data, manifest):
    """Why a whole board is out of the test, or None when it counts."""
    if not isinstance(data, dict) or "bids" not in data or "source" not in data:
        return "not a board file"
    if data.get("status") != "ok":
        return "board not ok"
    if manifest is None:
        return "no manifest found"
    ia = manifest.get("identityAlternative")
    if ia:
        if str(ia).startswith("agricharts-cashgrid") or str(ia).startswith("agsist-portal"):
            return "cash computed by us from basis and our quote"
        return "no futures column; kept only when it agrees with our quote"
    if data.get("currency") != "USD":
        return "not priced in US dollars"
    return None


def _ts(s):
    if not s:
        return None
    try:
        t = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except ValueError:
        return None
    return t if t.tzinfo else None


def _q(xs, p):
    """Linear-interpolated quantile of a sorted list (the 'inclusive' rule)."""
    if not xs:
        return None
    if len(xs) == 1:
        return xs[0]
    k = (len(xs) - 1) * p
    lo = int(k)
    hi = min(lo + 1, len(xs) - 1)
    return xs[lo] + (xs[hi] - xs[lo]) * (k - lo)


def _r(x, n=4):
    return None if x is None else round(x, n)


def board_values(board_id, data, tick):
    """One implied value per contract for one eligible board, plus row exclusions.

    Returns ({contract: {...}}, {reason: rows}, freshness reason or None)."""
    excl = {}
    ca, pa = _ts(data.get("checkedAt")), _ts(data.get("pricedAt"))
    lo = tick - timedelta(minutes=FRESH_MIN)
    if ca is None or ca > tick or ca < lo:
        return {}, excl, "not read in the 30 minutes before the tick"
    if pa is None or pa > tick or pa < lo:
        return {}, excl, "read, but its own posted time is older than 30 minutes"
    per = {}
    for b in data.get("bids") or []:
        cash = b.get("cash")
        basis = b.get("basisDollars")
        if basis is None and b.get("basisCents") is not None:
            basis = b["basisCents"] / 100.0
        fut = b.get("futuresPriceCents")
        if not isinstance(cash, (int, float)) or not isinstance(basis, (int, float)):
            excl["no cash or no basis"] = excl.get("no cash or no basis", 0) + 1
            continue
        if not isinstance(fut, (int, float)):
            excl["no futures column on the row"] = excl.get("no futures column on the row", 0) + 1
            continue
        c, why = contract_of(b.get("futuresMonth"), b.get("commodity"))
        if c is None:
            excl[why] = excl.get(why, 0) + 1
            continue
        implied = round((cash - basis) * 100, 4)
        per.setdefault(c, []).append((implied, float(fut)))
    out = {}
    for c, vals in per.items():
        out[c] = {"implied": median(v[0] for v in vals), "own": median(v[1] for v in vals),
                  "rows": len(vals)}
    return out, excl, None


def tick_lines(boards, prices, tick):
    """The JSONL lines for one tick: one per contract, plus one 'tick' line.

    boards: iterable of (board_id, data, manifest). prices: data/prices.json."""
    by_contract = {}
    board_excl, row_excl, fresh_excl = {}, {}, {}
    eligible = 0
    for bid, data, man in boards:
        why = board_exclusion(data, man)
        if why:
            board_excl[why] = board_excl.get(why, 0) + 1
            continue
        eligible += 1
        vals, rx, fx = board_values(bid, data, tick)
        if fx:
            fresh_excl[fx] = fresh_excl.get(fx, 0) + 1
            continue
        for k, v in rx.items():
            row_excl[k] = row_excl.get(k, 0) + v
        src = data.get("source") or {}
        for c, v in vals.items():
            v.update(id=bid, op=str(src.get("name") or bid.split("-")[0]),
                     schema=data.get("schema"), checkedAt=data.get("checkedAt"),
                     pricedAt=data.get("pricedAt"))
            by_contract.setdefault(c, []).append(v)

    quotes = (prices or {}).get("quotes") or {}
    ptime = (prices or {}).get("fetched")
    tick_iso = tick.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    lines = []
    for c in sorted(by_contract, key=lambda c: (c[0], c[2], MONTHS.index(c[1]))):
        vs = by_contract[c]
        xs = sorted(v["implied"] for v in vs)
        med = median(xs)
        q = quotes.get(yahoo_key(c))
        yahoo = yahoo_at = None
        yahoo_why = None
        if not isinstance(q, dict):
            yahoo_why = "no quote on the site for this contract"
        elif q.get("stale"):
            yahoo_why = "the site's quote is marked stale"
        elif not isinstance(q.get("close"), (int, float)):
            yahoo_why = "no price in the site's quote"
        else:
            yahoo = float(q["close"])
            yahoo_at = q.get("close_time") or q.get("close_date")
        n = len(vs)
        ops = sorted({v["op"] for v in vs})
        ref = yahoo if yahoo is not None else med
        far = sorted(([v["id"], _r(v["implied"]), _r(v["own"]), v["checkedAt"], v["pricedAt"]]
                      for v in vs if abs(v["implied"] - ref) > FAR_CENTS), key=lambda r: r[0])
        diff = None if yahoo is None else med - yahoo
        line = {
            "kind": "contract", "tick": tick_iso, "contract": contract_key(c), "crop": ROOTS[c[0]][0],
            "boards": n, "operators": len(ops), "shown": n >= MIN_BOARDS,
            "withheld": None if n >= MIN_BOARDS else f"{n} fresh board{'s' if n != 1 else ''} ({MIN_BOARDS} needed)",
            "median": _r(med), "q1": _r(_q(xs, 0.25)), "q3": _r(_q(xs, 0.75)), "min": _r(xs[0]), "max": _r(xs[-1]),
            "own_futures_median": _r(median(v["own"] for v in vs)),
            "yahoo_key": yahoo_key(c), "yahoo": yahoo, "yahoo_at": yahoo_at, "yahoo_none": yahoo_why,
            "prices_fetched": ptime, "diff": _r(diff),
            "schemas": dict(sorted(_count(v["schema"] for v in vs).items())),
            "far": far,
        }
        if diff is not None and abs(diff) > FAR_CENTS:
            line["boards_behind"] = sorted([v["id"], _r(v["implied"]), v["pricedAt"]] for v in vs)
        lines.append(line)
    lines.append({"kind": "tick", "tick": tick_iso, "eligible_boards": eligible,
                  "excluded_boards": dict(sorted(board_excl.items())),
                  "not_fresh": dict(sorted(fresh_excl.items())),
                  "excluded_rows": dict(sorted(row_excl.items())),
                  "prices_fetched": ptime, "slot": slot_of(tick)})
    return lines


def _count(it):
    out = {}
    for x in it:
        out[x] = out.get(x, 0) + 1
    return out


def slot_of(tick):
    """'session', 'after_close' or None (no tick due), from the Central clock."""
    t = tick.astimezone(CT)
    if t.weekday() >= 5:
        return None
    hm = (t.hour, t.minute)
    if SESSION_OPEN <= hm < SESSION_CLOSE:
        return "session"
    if SESSION_CLOSE <= hm < AFTER_CLOSE_UNTIL:
        return "after_close"
    return None


def slot_id(tick):
    """Session ticks every 30 minutes (:00-:29, :30-:59), and one after the close."""
    s = slot_of(tick)
    t = tick.astimezone(CT)
    if s == "session":
        return f"{t:%Y-%m-%d} {t.hour:02d}:{'00' if t.minute < 30 else '30'}"
    if s == "after_close":
        return f"{t:%Y-%m-%d} after_close"
    return None


def due(tick, existing_lines):
    """Is a tick due now, given today's lines already saved? (slot id, or None)."""
    sid = slot_id(tick)
    if not sid:
        return None
    for ln in existing_lines:
        if ln.get("kind") == "tick" and ln.get("tick"):
            t = _ts(ln["tick"])
            if t and slot_id(t) == sid:
                return None
    return sid


# ------------------------------------------------------------------ reading boards

def read_boards(bids_dir):
    """(id, data, manifest) for every per-board file in a dnilgis/bids checkout."""
    ddir = os.path.join(bids_dir, "data")
    for name in sorted(os.listdir(ddir)):
        if not name.endswith(".json"):
            continue
        bid = name[:-5]
        try:
            with open(os.path.join(ddir, name)) as f:
                data = json.load(f)
        except (OSError, ValueError):
            continue
        if not isinstance(data, dict) or "bids" not in data or "source" not in data:
            continue
        man = None
        for p in (os.path.join(bids_dir, "sources", name), os.path.join(bids_dir, name)):
            if os.path.exists(p):
                try:
                    with open(p) as f:
                        man = json.load(f)
                except (OSError, ValueError):
                    man = None
                break
        yield bid, data, man


def read_jsonl(path):
    out = []
    if os.path.exists(path):
        with open(path) as f:
            for ln in f:
                ln = ln.strip()
                if ln:
                    try:
                        out.append(json.loads(ln))
                    except ValueError:
                        pass
    return out


def write_tick(out_dir, tick, lines):
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, f"{tick.astimezone(CT):%Y-%m-%d}.jsonl")
    with open(path, "a") as f:
        for ln in lines:
            f.write(json.dumps(ln, separators=(",", ":"), sort_keys=True) + "\n")
    return path


# ------------------------------------------------------------------ summary

def _pct(xs, p):
    return _q(sorted(xs), p)


def summarize(lines):
    """By contract and Central hour: how close the board median sat to the site's quote."""
    groups = {}
    far = []
    for ln in lines:
        if ln.get("kind") != "contract":
            continue
        t = _ts(ln["tick"])
        hour = t.astimezone(CT).strftime("%H") if t else "??"
        for key in ((ln["contract"], hour), (ln["contract"], "all")):
            g = groups.setdefault(key, {"ticks": 0, "shown": 0, "withheld": 0, "no_yahoo": 0,
                                        "abs": [], "boards": [], "ops": []})
            g["ticks"] += 1
            g["boards"].append(ln["boards"])
            g["ops"].append(ln["operators"])
            if not ln["shown"]:
                g["withheld"] += 1
                continue
            g["shown"] += 1
            if ln.get("diff") is None:
                g["no_yahoo"] += 1
                continue
            g["abs"].append(abs(ln["diff"]))
        if ln["shown"] and ln.get("diff") is not None and abs(ln["diff"]) > FAR_CENTS:
            far.append({"tick": ln["tick"], "contract": ln["contract"], "median": ln["median"],
                        "yahoo": ln["yahoo"], "diff": ln["diff"], "boards": ln["boards"],
                        "boards_behind": ln.get("boards_behind", [])})
    rows = []
    for (c, hour), g in sorted(groups.items(), key=lambda kv: (kv[0][0], kv[0][1] != "all", kv[0][1])):
        a = g["abs"]
        n = len(a)
        rows.append({
            "contract": c, "hour_ct": hour, "ticks": g["ticks"], "shown": g["shown"], "withheld": g["withheld"],
            "no_yahoo": g["no_yahoo"], "compared": n,
            "abs_median": _r(_pct(a, 0.5)) if n else None, "abs_p90": _r(_pct(a, 0.9)) if n else None,
            "abs_max": _r(max(a)) if n else None,
            "within_0_25": _r(sum(x <= 0.25 for x in a) / n, 3) if n else None,
            "within_1": _r(sum(x <= 1 for x in a) / n, 3) if n else None,
            "within_5": _r(sum(x <= 5 for x in a) / n, 3) if n else None,
            "boards_median": _r(median(g["boards"]), 1), "operators_median": _r(median(g["ops"]), 1),
        })
    return {"rows": rows, "far": far, "rule": {"min_boards": MIN_BOARDS, "fresh_minutes": FRESH_MIN,
                                               "far_cents": FAR_CENTS}}


def _f(x, pct=False):
    if x is None:
        return "-"
    return f"{x * 100:.0f}%" if pct else f"{x:.2f}"


def summary_text(s):
    out = ["Implied futures vs the site's quote (cents; median of cash - basis across fresh boards).",
           f"A tick is withheld under {s['rule']['min_boards']} fresh boards (read and posted in the last "
           f"{s['rule']['fresh_minutes']} min). 'compared' = shown ticks with a site quote to compare.",
           "",
           "contract hour  ticks shown withheld compared  |d| med  p90    max   <=.25c <=1c  <=5c  boards ops"]
    for r in s["rows"]:
        out.append(f"{r['contract']:<8} {r['hour_ct']:>4} {r['ticks']:>6} {r['shown']:>5} {r['withheld']:>8} "
                   f"{r['compared']:>8}  {_f(r['abs_median']):>6} {_f(r['abs_p90']):>6} {_f(r['abs_max']):>6} "
                   f"{_f(r['within_0_25'], True):>6} {_f(r['within_1'], True):>5} {_f(r['within_5'], True):>5} "
                   f"{_f(r['boards_median']):>6} {_f(r['operators_median']):>4}")
    out.append("")
    out.append(f"Shown ticks more than {s['rule']['far_cents']:.0f}c from the site's quote: {len(s['far'])}")
    for f in s["far"]:
        ids = ", ".join(f"{b[0]} {b[1]}" for b in f["boards_behind"][:12])
        more = len(f["boards_behind"]) - 12
        out.append(f"  {f['tick']} {f['contract']}: median {f['median']} vs {f['yahoo']} ({f['diff']:+.2f}c), "
                   f"{f['boards']} boards: {ids}{f' and {more} more' if more > 0 else ''}")
    return "\n".join(out)


# ------------------------------------------------------------------ replay from git history

def _git(repo, *args, text=True):
    return subprocess.run(["git", "-C", repo, *args], capture_output=True, text=text, check=True).stdout


def _commit_at(repo, ref, path, t):
    """The last commit at or before t that touched path (no look-ahead)."""
    out = _git(repo, "log", ref, "-1", "--format=%H", f"--until={t.astimezone(UTC).isoformat()}", "--", path).strip()
    return out or None


def _extract(repo, sha, paths, dest):
    raw = subprocess.run(["git", "-C", repo, "archive", sha, "--", *paths], capture_output=True, check=True).stdout
    with tarfile.open(fileobj=io.BytesIO(raw)) as tf:
        tf.extractall(dest, filter="data")


def replay(day, bids_git, prices_git, out_dir, prices_ref="origin/main", bids_ref="HEAD"):
    """Rebuild one Central day's ticks from git history, every tick from what was committed by then."""
    d = datetime.strptime(day, "%Y-%m-%d").replace(tzinfo=CT)
    ticks = []
    t = d.replace(hour=SESSION_OPEN[0], minute=SESSION_OPEN[1] + 7)
    while slot_of(t) == "session":
        ticks.append(t)
        t += timedelta(minutes=30)
    ticks.append(d.replace(hour=13, minute=37))
    written = 0
    now = datetime.now(UTC)
    for t in ticks:
        tu = t.astimezone(UTC)
        if tu > now:
            break
        bsha = _commit_at(bids_git, bids_ref, "data", tu)
        psha = _commit_at(prices_git, prices_ref, "data/prices.json", tu)
        if not bsha or not psha:
            print(f"replay {t:%H:%M} CT: no commit at or before the tick (bids {bsha}, prices {psha})")
            continue
        with tempfile.TemporaryDirectory() as tmp:
            top = [p for p in _git(bids_git, "ls-tree", "--name-only", bsha).split() if p.endswith(".json")]
            _extract(bids_git, bsha, ["data", "sources", *top], tmp)
            prices = json.loads(_git(prices_git, "show", f"{psha}:data/prices.json"))
            lines = tick_lines(read_boards(tmp), prices, tu)
        write_tick(out_dir, tu, lines)
        written += 1
    return written


# ------------------------------------------------------------------ selftest

def selftest():
    fails = []

    def check(cond, msg):
        if not cond:
            fails.append(msg)

    # contract names, as each platform writes them (all from captured rows in test/fixtures/implied-futures)
    cases = [
        ("ZCZ26", "Corn", ("ZC", "Z", 2026)), ("ZCZ6", "Corn", ("ZC", "Z", 2026)),
        ("KEZ6", "Wheat (Hard Red Winter)", ("KE", "Z", 2026)), ("@C7H", "Corn", ("ZC", "H", 2027)),
        ("@KW6Z", "KC Wheat", ("KE", "Z", 2026)), ("CZ26", "Corn", ("ZC", "Z", 2026)),
        ("SX26", "Soybean", ("ZS", "X", 2026)), ("WZ26", "Red Wheat", ("ZW", "Z", 2026)),
        ("MWOH27", "Wheat, HRS", ("MW", "H", 2027)), ("Mar 27", "Yellow Corn", ("ZC", "H", 2027)),
        ("Jan 27 Soybeans", "Soybeans", ("ZS", "F", 2027)),
        ("Dec 26 KCBT Red Wheat", "Hrww", ("KE", "Z", 2026)),
        ("Mar 27 MIAX Spring Wheat", "Spring Wheat", ("MW", "H", 2027)),
        ("March 2027", "Corn", ("ZC", "H", 2027)), ("July 2027", "Wheat, SRW", ("ZW", "N", 2027)), ("December 2026", "Wheat, HRS 14%", ("MW", "Z", 2026)),
    ]
    for fm, com, want in cases:
        got, why = contract_of(fm, com)
        check(got == want, f"contract_of({fm!r}, {com!r}) = {got} ({why}), want {want}")
    for fm, com in [(None, "Corn"), ("4.5250", "Corn"), ("Nov 26 Soybeans mini-siz", "Ysb"),
                    ("March 2027", "Wheat"), ("Dec 26 Oats", "Oats"), ("ZCZ26", "Soybeans"),
                    ("ZCZ26", "Corn (cwt)"), ("ZCZ26", "Milo"), ("ZSX26", "Soybean Meal")]:
        got, why = contract_of(fm, com)
        check(got is None, f"contract_of({fm!r}, {com!r}) should be left out, got {got}")
    check(yahoo_key(("ZS", "X", 2026)) == "beans-nov26", "beans key")
    check(yahoo_key(("KE", "H", 2027)) == "kcwheat-mar27", "kc key")

    # the eligibility rule, on real captured boards
    fx = load_fixtures()
    tick = _ts(fx["tick"])
    by = {b["id"]: b for b in fx["boards"]}
    want = fx["expect_exclusion"]
    for bid, why in want.items():
        b = by[bid]
        got = board_exclusion(b["data"], b["manifest"])
        check(got == why, f"{bid}: exclusion {got!r}, want {why!r}")
    # an our-own-futures board, even one that shows a perfect cash - basis, never reaches a median
    cg = by["agtegra-hecla"]
    check(board_exclusion(cg["data"], cg["manifest"]) is not None, "AgriCharts cashgrid must be excluded")
    check(any(r.get("futuresPriceCents") is not None for r in cg["data"]["bids"]),
          "the cashgrid fixture should carry a futures price (ours), which is why it looks eligible")

    lines = tick_lines([(b["id"], b["data"], b["manifest"]) for b in fx["boards"]], fx["prices"], tick)
    meta = [l for l in lines if l["kind"] == "tick"][0]
    ids_in = {f[0] for l in lines if l["kind"] == "contract" for f in l.get("boards_behind", [])}
    check(not ids_in & set(want), f"excluded boards reached a median: {ids_in & set(want)}")
    check(meta["excluded_boards"].get("cash computed by us from basis and our quote", 0) >= 1, "cashgrid counted")
    check(meta["excluded_boards"].get("no futures column; kept only when it agrees with our quote", 0) >= 1,
          "fit-to-our-quote boards counted")
    check(meta["excluded_boards"].get("not priced in US dollars", 0) >= 1, "CAD board counted")
    # freshness: a board read 31+ minutes before the tick, or one posted long before it is read, is out
    old = json.loads(json.dumps(by[fx["fresh_board"]]["data"]))
    old["checkedAt"] = (tick - timedelta(minutes=31)).strftime("%Y-%m-%dT%H:%M:%SZ")
    v, _, fxr = board_values("x", old, tick)
    check(fxr is not None and not v, "a board read 31 min before the tick must not count")
    old["checkedAt"] = (tick + timedelta(minutes=1)).strftime("%Y-%m-%dT%H:%M:%SZ")
    v, _, fxr = board_values("x", old, tick)
    check(fxr is not None and not v, "a board read after the tick must not count (look-ahead)")
    old["checkedAt"] = (tick - timedelta(minutes=2)).strftime("%Y-%m-%dT%H:%M:%SZ")
    old["pricedAt"] = (tick - timedelta(hours=5)).strftime("%Y-%m-%dT%H:%M:%SZ")
    v, _, fxr = board_values("x", old, tick)
    check(fxr is not None and not v, "a board posted 5 h ago and read now must not count")

    # the median and withhold rule, hand-worked
    def fake(i, cash, basis_c, op=None):
        return (f"b{i}", {"schema": "gradable/1", "status": "ok", "currency": "USD",
                          "checkedAt": "2026-10-28T15:00:00Z", "pricedAt": "2026-10-28T15:00:00Z",
                          "source": {"name": op or f"Op{i}"},
                          "bids": [{"commodity": "Corn", "futuresMonth": "ZCZ26", "cash": cash,
                                    "basisCents": basis_c, "futuresPriceCents": cash * 100 - basis_c}]}, {})
    t0 = _ts("2026-10-28T15:10:00Z")
    prices = {"fetched": "2026-10-28T15:05:00Z", "quotes": {"corn-dec26": {"close": 451.75,
                                                                           "close_time": "2026-10-28T15:04:00Z"}}}
    four = [fake(i, c, -40) for i, c in enumerate([4.1175, 4.12, 4.1125, 4.1225])]
    l4 = [l for l in tick_lines(four, prices, t0) if l["kind"] == "contract"][0]
    check(l4["boards"] == 4 and l4["shown"] is False and l4["withheld"] == "4 fresh boards (5 needed)",
          f"4 boards must be withheld: {l4}")
    five = four + [fake(9, 4.30, -40)]
    l5 = [l for l in tick_lines(five, prices, t0) if l["kind"] == "contract"][0]
    # implied = cash*100 + 40: 451.75, 452.0, 451.25, 452.25, 470.0 -> median 452.0, diff +0.25
    check(l5["shown"] is True and l5["median"] == 452.0 and l5["diff"] == 0.25, f"median rule: {l5}")
    check(l5["min"] == 451.25 and l5["max"] == 470.0 and l5["q1"] == 451.75 and l5["q3"] == 452.25, f"spread: {l5}")
    check([f[0] for f in l5["far"]] == ["b9"], f"the 470 board is named as far: {l5['far']}")
    check(l5["yahoo"] == 451.75 and l5["yahoo_key"] == "corn-dec26", "the site's quote beside it")
    same_op = [fake(i, 4.12, -40, op="One Co") for i in range(6)]
    l6 = [l for l in tick_lines(same_op, prices, t0) if l["kind"] == "contract"][0]
    check(l6["boards"] == 6 and l6["operators"] == 1, "operators counted apart from boards")
    # one board with two delivery rows on one contract counts once
    two = fake(1, 4.12, -40)
    two[1]["bids"].append(dict(two[1]["bids"][0], cash=4.02, basisCents=-50, futuresPriceCents=452.0))
    lt = [l for l in tick_lines([two], prices, t0) if l["kind"] == "contract"][0]
    check(lt["boards"] == 1, "a board is one vote per contract")

    # the clock
    check(slot_of(_ts("2026-10-28T13:37:00Z")) == "session", "8:37 CDT is in session")
    check(slot_of(_ts("2026-10-28T13:20:00Z")) is None, "8:20 CDT is before the open")
    check(slot_of(_ts("2026-10-28T18:37:00Z")) == "after_close", "13:37 CDT is after the close")
    check(slot_of(_ts("2026-11-02T14:37:00Z")) == "session", "8:37 CST (after the clock change)")
    check(slot_of(_ts("2026-10-31T15:00:00Z")) is None, "Saturday")
    a = _ts("2026-10-28T15:07:00Z")
    b = _ts("2026-10-28T15:22:00Z")
    c = _ts("2026-10-28T15:37:00Z")
    have = [{"kind": "tick", "tick": "2026-10-28T15:07:00Z"}]
    check(due(a, []) and due(b, have) is None and due(c, have), "one tick per half hour")
    ac = [{"kind": "tick", "tick": "2026-10-28T18:37:00Z"}]
    check(due(_ts("2026-10-28T19:07:00Z"), ac) is None, "one after-close tick a day")

    # summary, hand-worked
    ls = [
        {"kind": "contract", "tick": "2026-10-28T15:07:00Z", "contract": "ZCZ26", "boards": 8, "operators": 5,
         "shown": True, "diff": 0.25, "median": 452.0, "yahoo": 451.75},
        {"kind": "contract", "tick": "2026-10-28T15:37:00Z", "contract": "ZCZ26", "boards": 8, "operators": 5,
         "shown": True, "diff": -1.5, "median": 450.25, "yahoo": 451.75},
        {"kind": "contract", "tick": "2026-10-28T16:07:00Z", "contract": "ZCZ26", "boards": 9, "operators": 6,
         "shown": True, "diff": 6.0, "median": 457.75, "yahoo": 451.75, "boards_behind": [["x", 457.75, None]]},
        {"kind": "contract", "tick": "2026-10-28T16:37:00Z", "contract": "ZCZ26", "boards": 3, "operators": 2,
         "shown": False, "diff": 0.0, "median": 451.75, "yahoo": 451.75},
    ]
    s = summarize(ls)
    allr = [r for r in s["rows"] if r["hour_ct"] == "all"][0]
    check(allr["ticks"] == 4 and allr["shown"] == 3 and allr["withheld"] == 1 and allr["compared"] == 3, f"{allr}")
    check(allr["abs_median"] == 1.5 and allr["abs_max"] == 6.0, f"abs stats {allr}")
    check(allr["within_0_25"] == 0.333 and allr["within_1"] == 0.333 and allr["within_5"] == 0.667, f"shares {allr}")
    check(len(s["far"]) == 1 and s["far"][0]["diff"] == 6.0, "the 6c tick is listed with its boards")
    h10 = [r for r in s["rows"] if r["hour_ct"] == "10"][0]
    check(h10["ticks"] == 2 and h10["compared"] == 2, f"hour 10 CDT {h10}")
    summary_text(s)

    if fails:
        print("\n".join("FAIL " + f for f in fails))
        print(f"{len(fails)} failed")
        return 1
    print("implied_futures selftest: all passed")
    return 0


def load_fixtures():
    with open(os.path.join(FIXTURES, "boards.json")) as f:
        return json.load(f)


def main(argv):
    if "--selftest" in argv:
        return selftest()

    def arg(name, default=None):
        return argv[argv.index(name) + 1] if name in argv and argv.index(name) + 1 < len(argv) else default

    if "--summary" in argv:
        d = arg("--summary")
        files = [os.path.join(d, f) for f in sorted(os.listdir(d)) if f.endswith(".jsonl")] if os.path.isdir(d) else [d]
        lines = [ln for p in files for ln in read_jsonl(p)]
        s = summarize(lines)
        print(json.dumps(s, indent=1) if "--json" in argv else summary_text(s))
        return 0
    if "--replay" in argv:
        n = replay(arg("--replay"), arg("--bids-git"), arg("--prices-git"), arg("--out"),
                   prices_ref=arg("--prices-ref", "origin/main"), bids_ref=arg("--bids-ref", "HEAD"))
        print(f"replay: {n} tick(s) written")
        return 0
    if "--tick" in argv:
        bids, pricesp, out = arg("--bids"), arg("--prices"), arg("--out")
        tick = _ts(arg("--at")) if arg("--at") else datetime.now(UTC).replace(microsecond=0)
        path = os.path.join(out, f"{tick.astimezone(CT):%Y-%m-%d}.jsonl")
        sid = due(tick, read_jsonl(path))
        if not sid and "--force" not in argv:
            print(f"implied futures: no tick due at {tick.astimezone(CT):%a %H:%M} CT "
                  "(outside the day session and the one after-close tick, or this half hour is done)")
            return 0
        with open(pricesp) as f:
            prices = json.load(f)
        lines = tick_lines(read_boards(bids), prices, tick)
        write_tick(out, tick, lines)
        meta = lines[-1]
        shown = [l for l in lines if l["kind"] == "contract" and l["shown"]]
        print(f"implied futures: tick {sid or 'forced'}: {meta['eligible_boards']} eligible boards, "
              f"{len(shown)} contract(s) shown, {len(lines) - 1 - len(shown)} withheld")
        for l in shown:
            print(f"  {l['contract']}: median {l['median']} from {l['boards']} boards ({l['operators']} operators), "
                  f"site {l['yahoo']}, diff {l['diff']}")
        return 0
    print("usage: implied_futures.py --tick | --summary <dir> | --replay <date> | --selftest")
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
