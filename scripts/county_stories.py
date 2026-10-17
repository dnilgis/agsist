#!/usr/bin/env python3
"""county_stories.py: a short written story of the year on each county rain page.

WHY
  Every county rain page (rain/<state>/<county>.html) gives the same blocks with
  different numbers. Two to four plain sentences that tell that county's year
  (wettest month, biggest rain, longest dry stretch, how far from a usual year,
  last year) make each page read as its own, and say it the way a person would.

HOW IT STAYS TRUE
  1. facts()     For each county, the facts the page itself states, formatted the
                 way the page prints them (same data file, same functions in
                 scripts/build_county_rain.py, same "through" day, same rules for
                 when a fact is shown at all). Nothing else goes to the model.
  2. bundle      One Message Batches request per county (scripts/api_jobs.py, job
                 "story", .github/workflows/api-jobs.yml with build=county-stories).
  3. validate()  Every number, date, month, year, percent and direction word in a
                 story must match its facts (within the page's rounding), with
                 each number tied to the fact it belongs to. Em dashes, banned
                 words, number words, forecasts and wrong lengths are rejected.
                 A rejected county gets no story. There is never a fallback.
  4. collect     Writes data/rain/stories/<st>.json: the story, the facts it was
                 checked against (and their hash), the station and the through day.
  5. The page    Each story is a dated snapshot: its own text says "Through Oct 12".
                 build_county_rain.py shows it as the lead paragraph, above the
                 page's live numbers, when it passes validate() against its own
                 stored facts, it is the page's current station, county and year,
                 and its through day is at most MAX_AGE_DAYS (35) before the day the
                 page's data was read. A changed station or a new year: no story.
                 A monthly batch (about $15) keeps every county covered.

  python3 scripts/county_stories.py selftest
  python3 scripts/county_stories.py bundle OUT.json [--states IA,KS] [--only REJECTED.json]
                 the facts for the batch (--only: just the counties an earlier run rejected)
  python3 scripts/county_stories.py collect BUNDLE.json RESULTS.json OUTDIR [REJECTED.json]
                 validate the batch results and write OUTDIR/<st>.json (OUTDIR is
                 data/rain/stories for the site), print the reject count
  python3 scripts/county_stories.py stale [DATA_DIR]   how many stored stories still match the data
"""
import hashlib
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import county_rain as R  # noqa: E402

ROOT = R.ROOT
SCHEMA = "agsist-county-stories/1"
MIN_CHARS, MAX_CHARS = 120, 700
MIN_SENT, MAX_SENT = 2, 4


def _B():
    import build_county_rain as B   # lazy: build_county_rain imports this module
    return B


# ---------------------------------------------------------------- facts

def facts(c, d, st):
    """The facts the county page states, as it prints them. Mirrors county_page()
    in build_county_rain.py: a fact the page leaves off is left off here."""
    B = _B()
    year = d["year"]
    done = B.done_year(d)
    asof = c["as_of"]
    whole = done and asof[5:] == "12-31"
    stw = c["station"]
    f = {
        "county": c["name"],
        "state": R.STATES[st],
        "year": year,
        "through": B.short_date(asof),
        "through_iso": asof,
        "year_over": done,
        "whole_year": whole,
        "gauge": B.kind_word(c),
        "gauge_where": R.station_where(stw["raw"]),
        "gauge_from_middle": B.miles_from(stw["mi"]) + " the middle of the county",
        "total_in": B.inch(c["total"]),
        "days_in_year_so_far": c["days"],
        "days_reported": c["reported"],
        "days_missing": c["missing"],
        "usual_in": B.inch(c["usual"]) if c["usual"] is not None else None,
        "pct_of_usual": c["pct"],
        "vs_usual": None,
        "wettest_month": None,
        "biggest_day": None,
        "longest_dry_stretch": None,
        "last_year": None,
        "multi_day_reports": c["acc"] or 0,
    }
    if c["usual"] is not None and c["pct"] is not None:
        df = c["total"] - c["usual"]
        if abs(df) < 0.05:
            f["vs_usual"] = {"dir": "about the same", "diff_in": None}
        else:
            f["vs_usual"] = {"dir": "more" if df > 0 else "less", "diff_in": B.inch(abs(df))}
        p = c["pct"]
        f["vs_usual"]["word"] = "about usual" if abs(p - 100) < 3 else ("wetter than usual" if p > 100 else "drier than usual")
    if c.get("wet_month"):
        m, v = c["wet_month"]
        f["wettest_month"] = {"month": R.MONTHS_LONG[m], "in": B.inch(v)}
    if c.get("max_day"):
        dd, v = c["max_day"]
        f["biggest_day"] = {"date": B.short_date(dd), "in": B.inch(v),
                            "label": "biggest one-day reading" if c["acc"] else "biggest single day"}
    if c.get("dry") and c["dry"][0] >= 2:
        n, a, b = c["dry"]
        f["longest_dry_stretch"] = {"days": n, "from": B.short_date(a), "to": B.short_date(b),
                                    "still_going": bool(b == asof and not done),
                                    "means": "days in a row with nothing in the gauge, not even a trace"}
    if c.get("last"):
        L = c["last"]
        ly = {"year": year - 1, "through": B.short_date(L["through"]), "total_in": B.inch(L["total"]),
              "days_missed": L["days"] - L["reported"], "compare": None}
        if "both" in L:
            d2 = L["this_both"] - L["last_both"]
            ly["compare"] = {"days_both_reported": L["both"],
                             "every_day": L["both"] == L["days"] == c["days"],
                             "dir": "about the same" if abs(d2) < 0.05 else ("more" if d2 > 0 else "less"),
                             "diff_in": None if abs(d2) < 0.05 else B.inch(abs(d2)),
                             "means": f"{year} against {year - 1}, on the days both years reported"}
        f["last_year"] = ly
    return f


def facts_hash(f):
    return hashlib.sha1(json.dumps(f, sort_keys=True, separators=(",", ":")).encode()).hexdigest()[:16]


# ---------------------------------------------------------------- validate

M3 = R.MONTHS
ML = R.MONTHS_LONG
MONTH_RE = r"(?:" + "|".join(ML) + "|" + "|".join(M3) + r")"
DATE_RE = re.compile(r"\b(" + MONTH_RE + r")\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b")
BANNED = [
    # forecasts and guesses
    "forecast", "will", "expect", "expected", "likely", "probably", "should", "could", "might", "may be", "outlook",
    # claims the facts cannot back
    "record", "records", "historic", "history", "ever", "unprecedented", "drought", "flood", "flooding", "flooded",
    "driest", "normal", "normals", "average", "averages", "rank", "ranked", "worst", "best", "heavy", "extreme",
    "spring", "summer", "fall", "autumn", "winter", "planting", "harvest", "crop", "crops", "yield", "yields",
    "snow", "snowfall", "storm", "storms", "thunderstorm", "hurricane", "tornado",
    # tone
    "soaked", "soaking", "parched", "deluge", "drenched", "bone", "whopping", "staggering", "remarkable",
    "notably", "notable", "delve", "tapestry", "testament", "journey", "landscape", "vibrant", "crucial",
    "robust", "seamless", "boasts", "nestled", "impressive", "incredible", "amazing", "stunning", "dramatic",
    "dramatically", "significant", "significantly", "massive", "huge", "roughly", "approximately",
    # number words and spans the facts do not give
    "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen",
    "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty", "thirty", "forty", "fifty",
    "hundred", "dozen", "half", "twice", "double", "doubled", "triple", "third", "quarter", "week", "weeks",
    "fortnight", "decade",
]
BANNED_RE = re.compile(r"\b(" + "|".join(re.escape(w) for w in BANNED) + r")\b", re.I)
BAD_CHARS = {"\u2014": "em dash", "\u2013": "en dash", "!": "exclamation mark", "?": "question mark",
             ";": "semicolon", "&": "ampersand", "<": "angle bracket", ">": "angle bracket", "*": "asterisk",
             "#": "hash", '"': "double quote", "“": "curly quote", "”": "curly quote", "\n": "line break"}
UP = re.compile(r"\b(more|wetter|above|ahead|over|extra|surplus)\b", re.I)
DOWN = re.compile(r"\b(less|drier|below|behind|under|short|shy|deficit|fewer)\b", re.I)
SAME = re.compile(r"\b(same|even|level|close to|near|about usual)\b", re.I)


def _forms(x):
    """The ways a story may print an inch figure the page prints as x ('3.47'):
    as printed, or rounded to one place ('3.5')."""
    if x is None:
        return set()
    v = float(x)
    return {x, f"{v:.1f}"}


def _clauses(s):
    return [p for p in re.split(r"(?<=[a-z0-9%)])[.,:](?=\s|$)|\bbut\b|\bwhile\b|\band then\b", s) if p.strip()]


def validate(story, f):
    """[] when every claim in story is in its facts f, else the reasons."""
    bad = []
    if not isinstance(story, str):
        return ["not text"]
    s = story.strip()
    if not (MIN_CHARS <= len(s) <= MAX_CHARS):
        bad.append(f"length {len(s)} outside {MIN_CHARS}-{MAX_CHARS}")
    n_sent = len(re.findall(r"[.](?:\s|$)", s))
    if not s.endswith("."):
        bad.append("does not end with a period")
    if not (MIN_SENT <= n_sent <= MAX_SENT):
        bad.append(f"{n_sent} sentences, not {MIN_SENT}-{MAX_SENT}")
    # a dated snapshot: the text itself names the day it runs through, so it stays true after the page moves on
    if not re.search(r"\b[Tt]hrough " + re.escape(f["through"]) + r"\b", s):
        bad.append(f"does not say 'through {f['through']}'")
    for ch, name in BAD_CHARS.items():
        if ch in s:
            bad.append(name)
    if "--" in s or " - " in s:
        bad.append("dash")
    for m in BANNED_RE.finditer(s):
        bad.append(f"banned word {m.group(0)!r}")
    # ---- what the facts allow
    year, ly = f["year"], f.get("last_year")
    wm, bd, dry, vs = f.get("wettest_month"), f.get("biggest_day"), f.get("longest_dry_stretch"), f.get("vs_usual")
    dates = {}
    if bd:
        dates[bd["date"]] = "biggest"
    if dry:
        dates.setdefault(dry["from"], "dry")
        dates.setdefault(dry["to"], "dry")
    dates.setdefault(f["through"], "through")
    dates.setdefault("Jan 1", "start")    # every page counts from Jan 1
    if ly:
        dates.setdefault(ly["through"], "through")
    # a month named on its own (not in a date) can only be the wettest month: the page gives no other month's story
    months_ok = {wm["month"][:3]} if wm else set()
    inch = {"total": _forms(f["total_in"]), "usual": _forms(f.get("usual_in")),
            "diff": _forms(vs and vs.get("diff_in")), "wet": _forms(wm and wm["in"]), "big": _forms(bd and bd["in"]),
            "last": _forms(ly and ly["total_in"]), "lastdiff": _forms(ly and ly["compare"] and ly["compare"]["diff_in"])}
    all_inch = set().union(*inch.values())
    day_counts = {f["days_in_year_so_far"], f["days_reported"], f["days_missing"]} | ({dry["days"]} if dry else set()) \
        | ({ly["days_missed"]} if ly else set()) | ({ly["compare"]["days_both_reported"]} if ly and ly["compare"] else set()) \
        | ({f["multi_day_reports"]} if f["multi_day_reports"] else set())
    miles = {int(x) for x in re.findall(r"\b(\d+) miles?\b", f["gauge_from_middle"] + " " + f["gauge_where"])}
    years = {year} | ({year - 1} if ly else set())
    # ---- dates first, then take them out so their day numbers are not read as amounts
    for m in DATE_RE.finditer(s):
        key = f"{m.group(1)[:3]} {int(m.group(2))}"
        if key not in dates:
            bad.append(f"date {m.group(0)!r} is not in the facts")
    rest = DATE_RE.sub(lambda m: f" DATE{m.group(1)[:3]}{int(m.group(2))}", s)
    for m in re.finditer(r"\b" + MONTH_RE + r"\b", rest):
        if m.group(0) == "May" and m.start() == 0:
            continue
        if m.group(0)[:3] not in months_ok:
            bad.append(f"month {m.group(0)!r} is not in the facts")
    # ---- every number, with what follows it
    for m in re.finditer(r"(?<![\w.])(\d+(?:,\d{3})*(?:\.\d+)?)(\s*%|\s*percent\b|\s+(?:inch|inches|in)\b|\s+(?:day|days)\b|\s+(?:mile|miles)\b|\s+(?:report|reports)\b)?", rest):
        num, unit = m.group(1).replace(",", ""), (m.group(2) or "").strip().lower()
        if "." in num:
            if unit and not unit.startswith("in"):
                bad.append(f"{num} {unit}: a decimal that is not inches")
            elif num not in all_inch:
                bad.append(f"{num} inches is not in the facts")
            continue
        n = int(num)
        if unit in ("%", "percent"):
            if n != f.get("pct_of_usual"):
                bad.append(f"{n}% is not the page's percent")
        elif unit.startswith("in") and not (unit == "in" and n in years):
            bad.append(f"{n} inches without the page's decimals")
        elif unit.startswith("day"):
            if n not in day_counts:
                bad.append(f"{n} days is not in the facts")
        elif unit.startswith("mile"):
            if n not in miles:
                bad.append(f"{n} miles is not in the facts")
        elif unit.startswith("report"):
            if n != f["multi_day_reports"]:
                bad.append(f"{n} reports is not in the facts")
        elif unit == "in":
            pass
        elif n not in years:
            bad.append(f"number {n} is not in the facts")
    # ---- each claim tied to its own fact. A clause's topic comes from its own words
    # (wettest or the wettest month's name, biggest or its date, dry or its dates,
    # last year, usual or a percent, the total); a clause with none takes its
    # sentence's. Every inch figure must belong to one of its clause's topics.
    big_re = r"\b(biggest|largest|most in (?:one|a single) day|one-day|single day|single-day)\b"
    dry_re = r"\b(dry|without rain|no rain|nothing in the gauge)\b"
    last_re = (r"\b" + str(year - 1) + r"\b|\blast year\b|\ba year ago\b") if ly else r"\blast year\b|\ba year ago\b"
    allow = {"wet": inch["wet"], "big": inch["big"], "dry": set(), "last": inch["last"] | inch["lastdiff"] | inch["total"],
             "usual": inch["usual"] | inch["diff"] | inch["total"], "total": inch["total"]}

    def topics(cl):
        low, T = cl.lower(), set()
        cd = {f"{a} {b}" for a, b in re.findall(r"DATE([A-Z][a-z]{2})(\d+)", cl)}
        if "wettest" in low or (wm and re.search(r"\b(" + wm["month"] + "|" + wm["month"][:3] + r")\b(?!\d)", cl)):
            T.add("wet")
        if re.search(big_re, low) or (bd and bd["date"] in cd):
            T.add("big")
        if re.search(dry_re, low) or (dry and cd & {dry["from"], dry["to"]} - {f["through"]}):
            T.add("dry")
        if re.search(last_re, cl, re.I):
            T.add("last")
        if re.search(r"\b(usual|typical|typically)\b|%|\bpercent\b", low):
            T.add("usual")
        if re.search(r"\b(total|so far|in all|altogether|year to date|this year)\b", low) or f"DATE{f['through'].replace(' ', '')}" in cl:
            T.add("total")
        return T

    for sent in re.split(r"(?<=[a-z0-9%)])\.(?=\s|$)", rest):
        cls = _clauses(sent)
        tops = [topics(cl) for cl in cls]
        st_tops = set().union(*tops) if tops else set()
        slow = sent.lower()
        if "wettest" in slow:
            if not wm:
                bad.append("wettest month claimed, none in the facts")
            elif not re.search(r"\b(" + wm["month"] + "|" + wm["month"][:3] + r")\b", sent):
                bad.append("wettest month named wrong")
        if re.search(big_re, slow) and not bd:
            bad.append("biggest day claimed, none in the facts")
        if re.search(dry_re, slow) and not dry:
            bad.append("dry stretch claimed, none in the facts")
        if re.search(r"\blast year\b|\ba year ago\b", slow) and not ly:
            bad.append("last year claimed, none in the facts")
        if re.search(r"\b(wetter|drier)\b", slow) and not (st_tops & {"usual", "last"}):
            bad.append("wetter or drier than what")
        for cl, T in zip(cls, tops):
            T = T or st_tops
            low = cl.lower()
            nums = set(re.findall(r"(?<![\w.])(\d+\.\d+)", cl))
            cd = {f"{a} {b}" for a, b in re.findall(r"DATE([A-Z][a-z]{2})(\d+)", cl)}
            days = {int(x) for x in re.findall(r"\b(\d+)\s+days?\b", cl)}
            if T:
                ok_in = set().union(*(allow[k] for k in T))
                if nums - ok_in:
                    bad.append(f"amount {sorted(nums - ok_in)} does not belong to {sorted(T)}")
            if "big" in T and bd and cd - {bd["date"]} - ({f["through"]} if T - {"big"} else set()):
                bad.append(f"biggest day date wrong: {sorted(cd - {bd['date']})}")
            if "dry" in T and dry:
                if days - {dry["days"]}:
                    bad.append(f"dry stretch length wrong: {sorted(days - {dry['days']})}")
                if cd - {dry["from"], dry["to"], f["through"]}:
                    bad.append(f"dry stretch dates wrong: {sorted(cd - {dry['from'], dry['to'], f['through']})}")
            if re.search(r"\bstill\b", low) and not (dry and dry["still_going"]):
                bad.append("'still' with no stretch still going")
            up, down = UP.search(cl), DOWN.search(cl)
            same = SAME.search(cl) and not up and not down
            if "last" in T and (up or down or same or re.search(r"\b(wetter|drier)\b", low)):
                cmp_ = ly and ly["compare"]
                if not cmp_:
                    bad.append("this year against last, which the page does not compare")
                else:
                    want = cmp_["dir"]
                    # 'more/less than <last year>' is about this year; 'last year had more' would be the other way
                    flip = re.search(r"\b" + str(year - 1) + r"\s+(had|was|got|caught)\b", cl) or re.search(r"\blast year\s+(had|was|got|caught)\b", low)
                    say = "same" if same else ("more" if up else "less")
                    if flip and say != "same":
                        say = "less" if say == "more" else "more"
                    if (say == "same") != (want == "about the same") or (say != "same" and say != want):
                        bad.append(f"this year against last says the wrong way (facts: {want})")
                    if cmp_["diff_in"] and nums & inch["lastdiff"] and not cmp_["every_day"] and not re.search(r"\bboth\b", sent, re.I):
                        bad.append("the difference with last year without saying it is on the days both reported")
            elif "usual" in T:
                if not vs and (up or down or nums - inch["usual"]):
                    bad.append("a comparison with a usual year the page does not make")
                if vs:
                    if up and vs["dir"] != "more":
                        bad.append(f"says more than usual (facts: {vs['dir']})")
                    if down and vs["dir"] != "less":
                        bad.append(f"says less than usual (facts: {vs['dir']})")
                    if re.search(r"\b(wetter|drier)\b", low):
                        w = "wetter" if "wetter" in low else "drier"
                        if not vs["word"].startswith(w):
                            bad.append(f"{w} when the page says {vs['word']}")
                    if inch["diff"] and nums & inch["diff"] and not (up or down):
                        bad.append("a difference with no direction")
    if not f.get("year_over") and re.search(r"\b(the year ended|for the year|all year|whole year|full year)\b", s, re.I):
        bad.append("speaks of the whole year before it is over")
    return sorted(set(bad))


# ---------------------------------------------------------------- the prompt

SYSTEM = """You write the opening paragraph for one county page on agsist.com, a free farm website run by Sig Lindquist, a Certified Crop Adviser. The page answers "how much rain has this county had this year" from one NOAA weather station. Your paragraph sits right under that answer and tells the county's year so far in a few plain sentences.

You get the facts the page already shows, as JSON. Use only those facts. The page prints every number below, and a reader will check your words against it.

Write:
- 2 to 4 sentences, 120 to 600 characters, one paragraph, plain text.
- In Sig's voice: plain farm words, short sentences, a little dry. The way a neighbor would say it at the elevator, not a news story.
- The answer above your paragraph gives the latest total and how far it is from a usual year, and it updates every week. You may give the total or the comparison as of your through day, but lead with what that answer does not tell: pick the two or three facts that tell this county's year best (the wettest month, the biggest rain, the longest dry stretch, last year). Do not list them all.
- Numbers exactly as the facts print them: inches with two decimals as given (or rounded to one decimal), percents as given, days as given, dates as "Aug 5" (three-letter month, no period). Write every number in digits.
- Every amount sits next to what it measures: the wettest month's inches with that month, the biggest rain's inches with its date, the dry stretch's days with its dates.
- The difference from a usual year only with its direction (more or less), and only if vs_usual is given. This year against last year only if last_year.compare is given; if it is not on every day, say it is on the days both years reported.
- Start with "Through {through}," naming the through day exactly as the facts give it (for example "Through Oct 12, the station at ..."). The paragraph stays on the page for a few weeks while the numbers above it update, so it must say which day it speaks for.
- Call the place "the station" or "the gauge" as the facts name it, and the comparison "a usual year".

Do not:
- add anything the facts do not say: no causes, no weather words (storms, snow, drought, floods), no seasons, no crops or fieldwork, no rankings beyond "wettest month" and "biggest" rain, no records, no "ever", no forecast or what comes next, no advice.
- use adjectives the numbers do not back, number words (two, half, a week), em dashes, dashes, semicolons, exclamation marks, questions, quotes, or words like "normal" or "average" (the page says "usual").
- sound like a machine: no "notably", "remarkable", "it is worth noting", no wrap-up line.

Answer with one JSON object in a ```json fenced block and nothing after it:
{"story": "<the paragraph>"}"""

USER = """Facts for {county}, {state} ({year}{sofar}):
{facts}"""

EXAMPLE_FACTS = None


def prompt(f):
    shown = {k: v for k, v in f.items() if k not in ("through_iso",)}
    return USER.format(county=f["county"], state=f["state"], year=f["year"],
                       sofar=", the whole year" if f["whole_year"] else (", through " + f["through"]),
                       facts=json.dumps(shown, indent=1, ensure_ascii=False))


# ---------------------------------------------------------------- bundle and collect

def all_facts(data_dir, states=None):
    """[(st, fips, facts)] for every county that gets a page (the same test as build())."""
    B = _B()
    C = R.counties()
    out = []
    for st, d in sorted(B.load(data_dir).items()):
        if states and st not in states:
            continue
        for fips, c in sorted(d["counties"].items()):
            if fips in C:
                out.append((st, fips, facts(c, d, st)))
    return out


def bundle(data_dir, states=None):
    B = _B()
    sids = {(st, fips): c["station"]["sid"] for st, d in B.load(data_dir).items() for fips, c in d["counties"].items()}
    rows = []
    for st, fips, f in all_facts(data_dir, states):
        rows.append({"st": st, "fips": fips, "hash": facts_hash(f), "facts": f, "sid": sids[(st, fips)]})
    return {"schema": SCHEMA, "story": rows}


def collect(bundle_d, results_d, out_dir, made=None):
    """Validate each result against the facts it was asked about; write OUTDIR/<st>.json.
    Returns (kept, rejected {cid: reasons}, missing count)."""
    by = {f"c_{r['st']}_{r['fips']}": r for r in bundle_d.get("story", [])}
    items = results_d.get("items", {})
    kept, rej, files = 0, {}, {}
    for cid, r in sorted(by.items()):
        it = items.get(cid)
        if not it or it.get("result") != "succeeded":
            rej[cid] = [f"no result ({(it or {}).get('result', 'missing')})"]
            continue
        story = ((it.get("parsed") or {}).get("story") or "").strip()
        if it.get("stop_reason") not in (None, "end_turn"):
            rej[cid] = [f"stop_reason {it.get('stop_reason')}"]
            continue
        why = validate(story, r["facts"])
        if why:
            rej[cid] = why
            continue
        files.setdefault(r["st"], {})[r["fips"]] = {"story": story, "hash": r["hash"], "through": r["facts"]["through_iso"],
                                                     "sid": r.get("sid"), "facts": r["facts"]}
        kept += 1
    os.makedirs(out_dir, exist_ok=True)
    for st, cs in sorted(files.items()):
        json.dump({"schema": SCHEMA, "state": st, "model": results_d.get("model"), "batch_id": results_d.get("batch_id"),
                   "made": made or results_d.get("collected_utc"), "counties": cs},
                  open(os.path.join(out_dir, st.lower() + ".json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False, sort_keys=True)
    return kept, rej


def load_stories(data_dir):
    """{st: {fips: entry}} from data_dir/stories/<st>.json."""
    out = {}
    d = os.path.join(data_dir, "stories")
    if not os.path.isdir(d):
        return out
    for name in sorted(os.listdir(d)):
        if not name.endswith(".json"):
            continue
        try:
            j = json.load(open(os.path.join(d, name), encoding="utf-8"))
        except ValueError:
            continue
        if j.get("schema") == SCHEMA and j.get("state") in R.STATES:
            out[j["state"]] = j.get("counties") or {}
    return out


MAX_AGE_DAYS = 35   # a monthly batch keeps every county covered


def page_now(c, d):
    """What a stored story is checked against on the page as built now."""
    return {"sid": c["station"]["sid"], "county": c["name"], "year": d["year"], "as_of": c["as_of"], "read": d["fetched"][:10]}


def story_for(entry, now):
    """The dated story to print, or None. It shows only when it passes the validator
    against its own stored facts (it names their through day), those facts are the
    ones it was written from (hash), it is the same station, county and year as the
    page now, and its through day is at most MAX_AGE_DAYS before the page's data was
    read (the build's own date, so a rebuild of the same data gives the same page).
    Anything off: no story, never a guess."""
    import datetime as dt
    if not entry or not isinstance(entry, dict) or not isinstance(entry.get("facts"), dict):
        return None
    f, s = entry["facts"], entry.get("story")
    if not isinstance(s, str) or entry.get("hash") != facts_hash(f) or entry.get("through") != f.get("through_iso"):
        return None
    if entry.get("sid") != now["sid"] or f.get("county") != now["county"] or f.get("year") != now["year"]:
        return None
    try:
        through = dt.date.fromisoformat(f["through_iso"])
        age = (dt.date.fromisoformat(now["read"]) - through).days
    except (KeyError, TypeError, ValueError):
        return None
    if age > MAX_AGE_DAYS or through > dt.date.fromisoformat(now["as_of"]):
        return None
    return s.strip() if not validate(s, f) else None


# ---------------------------------------------------------------- selftest

def selftest():
    import subprocess
    import tempfile
    B = _B()
    fails = []

    def ok(c, m):
        if not c:
            fails.append(m)
            print("FAIL", m, flush=True)
    fx = os.path.join(ROOT, "test", "fixtures", "rain")
    with tempfile.TemporaryDirectory() as t:
        data = os.path.join(t, "data")
        for st, ed in (("IA", "2026-10-12"), ("KS", "2026-10-12"), ("DE", "2024-12-31")):
            r = subprocess.run([sys.executable, os.path.join(HERE, "fetch_county_rain.py"), "--fixtures", fx, "--out", data,
                                "--states", st, "--edate", ed], capture_output=True, text=True)
            ok(r.returncode == 0, f"fixture fetch {st}: {r.stderr[-300:]}")
        # the fetch stamps the clock time; pin the read day so the age rule tests the same on any date
        for pth in (os.path.join(data, "ia.json"), os.path.join(data, "daily", "ia.json")):
            if os.path.exists(pth):
                jj = json.load(open(pth))
                jj["fetched"] = "2026-10-14T03:00:00Z"
                json.dump(jj, open(pth, "w"))
        want = B.build(data)
        rows = all_facts(data)
        ok(len(rows) == sum(1 for k in want if k.count("/") == 2), "one facts row per county page")
        # facts against the page itself: every number the facts give is printed on that page
        C = R.counties()
        for st, fips, f in rows:
            page = want[f"rain/{R.slug(R.STATES[st])}/{C[fips]['slug']}.html"]
            txt = re.sub(r"<[^>]+>", " ", re.sub(r"<script.*?</script>", "", page, flags=re.S)).replace("&rsquo;", "'")
            for k in ("total_in", "usual_in"):
                if f[k]:
                    ok(f[k] in txt, f"{fips}: {k} {f[k]} on the page")
            if f["pct_of_usual"] is not None:
                ok(f"{f['pct_of_usual']}%" in txt, f"{fips}: pct on the page")
            if f["vs_usual"] and f["vs_usual"]["diff_in"]:
                ok(f"{f['vs_usual']['diff_in']} inch" in txt and f"{f['vs_usual']['dir']} than a usual year" in txt, f"{fips}: vs usual on the page")
            if f["wettest_month"]:
                ok(f"Wettest month: {f['wettest_month']['month']}, {f['wettest_month']['in']} inch" in re.sub(r"\s+", " ", txt), f"{fips}: wettest month on the page")
            else:
                ok("Wettest month:" not in txt, f"{fips}: no wettest month, none on the page")
            if f["biggest_day"]:
                bd = f["biggest_day"]
                ok(re.search(re.escape(bd["in"]) + r" inch(es)? on " + bd["date"], txt) is not None, f"{fips}: biggest day on the page")
            if f["longest_dry_stretch"]:
                dr = f["longest_dry_stretch"]
                ok(f"{dr['days']} days in a row" in txt and f"{dr['from']} to {dr['to']}" in txt, f"{fips}: dry stretch on the page")
            else:
                ok("Longest dry stretch" not in txt, f"{fips}: no dry stretch, none on the page")
            if f["last_year"]:
                ok(f["last_year"]["total_in"] in txt, f"{fips}: last year on the page")
            ok(f"through {f['through']}" in txt or f["whole_year"] or "Jan 1 to " + f["through"] in txt, f"{fips}: through day on the page")
        # the Story County fixture: hand-checked facts, a good story passes, planted errors fail
        sc = next(f for st, fips, f in rows if fips == "19169")
        d = json.load(open(os.path.join(data, "ia.json")))
        c = d["counties"]["19169"]
        ok(sc["total_in"] == f"{c['total']:.2f}" and sc["through"] == "Oct 12" and sc["year"] == 2026, "Story County basics")
        f = {"county": "Adams County", "state": "Iowa", "year": 2026, "through": "Oct 13", "through_iso": "2026-10-13",
             "year_over": False, "whole_year": False, "gauge": "weather station", "gauge_where": "in Corning",
             "gauge_from_middle": "4 miles from the middle of the county", "total_in": "44.58", "days_in_year_so_far": 286,
             "days_reported": 269, "days_missing": 17, "usual_in": "29.61", "pct_of_usual": 151,
             "vs_usual": {"dir": "more", "diff_in": "14.97", "word": "wetter than usual"},
             "wettest_month": {"month": "September", "in": "12.89"},
             "biggest_day": {"date": "Aug 5", "in": "4.56", "label": "biggest single day"},
             "longest_dry_stretch": {"days": 18, "from": "Jan 25", "to": "Feb 11", "still_going": False, "means": "x"},
             "last_year": None, "multi_day_reports": 0}
        good = ("Through Oct 13, September did most of the work here, with 12.89 inches at the Corning station. "
                "The biggest single day was 4.56 inches on Aug 5. "
                "That puts the year so far 14.97 inches more than a usual year to date, 151% of usual.")
        ok(validate(good, f) == [], f"a true story passes: {validate(good, f)}")
        ok(validate(good.replace("12.89", "12.9"), f) == [], "one-decimal rounding of a page number passes")
        planted = {
            "a wrong amount": good.replace("12.89", "12.98"),
            "an amount on the wrong fact": good.replace("4.56 inches on Aug 5", "12.89 inches on Aug 5"),
            "a wrong date": good.replace("Aug 5", "Aug 6"),
            "a wrong month for the wettest": good.replace("September did most", "August did most").replace("with 12.89", "the wettest, with 12.89"),
            "a month not in the facts": good + " July was quiet.",
            "a wrong percent": good.replace("151%", "150%"),
            "the wrong way from usual": good.replace("more than a usual", "less than a usual"),
            "a wrong dry stretch": good.replace("The biggest", "The longest dry stretch ran 19 days from Jan 25. The biggest"),
            "an em dash": good.replace(". The biggest", " \u2014 the biggest"),
            "an exclamation": good[:-1] + "!",
            "a banned word": good.replace("did most of the work", "was a record"),
            "a forecast": good + " More rain will come.",
            "a number word": good.replace("The biggest", "Two days later the biggest"),
            "too long": good + " " + good + " " + good,
            "one sentence": "Through Oct 13, September had 12.89 inches at the Corning station and the year so far is at 151% of usual on the page.",
            "a year not in the facts": good.replace("151% of usual", "151% of usual, like 1993"),
            "last year when the facts have none": good + " Last year was drier.",
            "drier with no comparison": good.replace("did most of the work here", "was drier"),
            "whole inches": good.replace("4.56 inches", "5 inches"),
            "no through day": good.replace("Through Oct 13, September", "September"),
            "the wrong through day": good.replace("Through Oct 13,", "Through Oct 6,"),
            "a month's name on another fact's amount": good.replace("The biggest single day was 4.56 inches on Aug 5.", "August brought 4.56 inches."),
            "the biggest day's amount on the wettest month": "Through Oct 13, September brought 4.56 inches, the wettest month. The year so far is 151% of usual at the Corning station.",
            "wettest month with the wrong name": good.replace("September did most of the work here, with", "the wettest month was August, with"),
            "a dry stretch with an amount": good.replace("The biggest", "The longest dry stretch was 18 days from Jan 25 to Feb 11 with 0.10 inches. The biggest"),
            "wetter when it was more": good.replace("more than a usual year to date", "less than a usual year to date"),
        }
        for name, s in planted.items():
            ok(validate(s, f) != [], f"validator catches {name}: {s}")
        # last year compare: direction and the both-days rule
        f2 = dict(f, last_year={"year": 2025, "through": "Oct 13", "total_in": "30.02", "days_missed": 0,
                                "compare": {"days_both_reported": 250, "every_day": False, "dir": "more", "diff_in": "13.10", "means": "x"}})
        ok(validate("Through Oct 13, the station had 30.02 inches by this date in 2025. On the days both years reported, 2026 had 13.10 inches more than 2025.", f2) == [], "last year, both days, passes")
        ok(validate("Through Oct 13, the station had 30.02 inches by this date in 2025. On the days both years reported, 2026 had 13.10 inches less than 2025.", f2) != [], "last year the wrong way")
        ok(validate("Through Oct 13, the station had 30.02 inches by this date in 2025. This year had 13.10 inches more than 2025 at this point.", f2) != [], "last year difference without the both-days words")
        # render only on a hash match, and the story comes off when the data moves on
        e = {"story": good, "hash": facts_hash(f), "through": "2026-10-13", "sid": "131833 2", "facts": f}
        now = {"sid": "131833 2", "county": "Adams County", "year": 2026, "as_of": "2026-10-13", "read": "2026-10-15"}
        ok(story_for(e, now) == good, "same station, fresh: the story shows")
        ok(story_for(e, dict(now, as_of="2026-11-09", read="2026-11-11")) == good, "the page moved on 4 weeks: the dated story still shows")
        ok(story_for(e, dict(now, as_of="2026-11-15", read="2026-11-17")) == good, "35 days old: still shows")
        ok(story_for(e, dict(now, as_of="2026-11-16", read="2026-11-18")) is None, "36 days old: stale by age, no story")
        ok(story_for(e, dict(now, sid="130203 2")) is None, "the station changed: no story")
        ok(story_for(e, dict(now, year=2027, as_of="2027-01-05", read="2027-01-06")) is None, "the year rolled over: no story")
        ok(story_for(e, dict(now, county="Adair County")) is None, "another county: no story")
        ok(story_for(e, dict(now, as_of="2026-10-06")) is None, "a story newer than the page's data: no story")
        ok(story_for(dict(e, facts=dict(f, total_in="44.70")), now) is None, "stored facts edited after the fact (hash): no story")
        ok(story_for(dict(e, through="2026-10-06"), now) is None, "through day not the facts' own: no story")
        bad_s = good.replace("12.89", "12.98")
        ok(story_for(dict(e, story=bad_s), now) is None, "a stored story that fails the validator never shows")
        ok(story_for(dict(e, story=good.replace("Through Oct 13, September", "September")), now) is None, "an undated story never shows")
        # the page: the story under the answer only when its hash matches
        st_dir = os.path.join(data, "stories")
        os.makedirs(st_dir)
        sgood = (f"Through {sc['through']}, the wettest month at the station was {sc['wettest_month']['month']}, with {sc['wettest_month']['in']} inches. "
                 + (f"The biggest single day at the gauge was {sc['biggest_day']['in']} inches on {sc['biggest_day']['date']}." if sc["biggest_day"] else "That is what the gauge caught this year so far."))
        ok(validate(sgood, sc) == [], f"fixture story valid: {validate(sgood, sc)}")
        sid = c["station"]["sid"]
        ent = {"story": sgood, "hash": facts_hash(sc), "through": sc["through_iso"], "sid": sid, "facts": sc}
        json.dump({"schema": SCHEMA, "state": "IA", "counties": {"19169": ent, "19015": dict(ent, sid="999999 2")}},
                  open(os.path.join(st_dir, "ia.json"), "w"))
        w2 = B.build(data)
        story = w2["rain/iowa/story-county.html"]
        ok(f'<p class="rc-story">{sgood}</p>' in story, "matching story printed")
        ok(0 < story.find('class="rc-answer"') < story.find('class="rc-story"') < story.find('class="rc-figs"'), "story sits under the answer")
        ok("\u2014" not in story and "&mdash;" not in story, "no em dash")
        others = [k for k, b in w2.items() if 'class="rc-story"' in b]
        ok(others == ["rain/iowa/story-county.html"], f"only the matching county has a story: {others}")
        ok(all(w2[k] == want[k] for k in want if k != "rain/iowa/story-county.html"), "every other page unchanged")
        ok(len(story.encode()) <= B.MAX_KB * 1024, "page stays under the builder's cap")
        # collect: validated results only
        bd_ = bundle(data, {"IA"})
        r0 = bd_["story"][0]
        cid0 = f"c_{r0['st']}_{r0['fips']}"
        s0 = (f"Through {r0['facts']['through']}, the station in this county had {r0['facts']['total_in']} inches from Jan 1 through {r0['facts']['through']}. "
              "That is everything the gauge caught so far this year.")
        res = {"model": "m", "batch_id": "b", "items": {
            cid0: {"result": "succeeded", "stop_reason": "end_turn", "parsed": {"story": s0}},
            f"c_{bd_['story'][1]['st']}_{bd_['story'][1]['fips']}": {"result": "succeeded", "stop_reason": "end_turn",
                                                                     "parsed": {"story": "It rained 99.99 inches. That is a lot."}}}}
        out = os.path.join(t, "out")
        kept, rej = collect(bd_, res, out, made="2026-10-17")
        ok(validate(s0, r0["facts"]) == [], f"collect test story valid: {validate(s0, r0['facts'])}")
        ok(kept == 1 and len(rej) == len(bd_["story"]) - 1, f"collect keeps the good one ({kept}, {len(rej)} rejected)")
        j = json.load(open(os.path.join(out, "ia.json")))
        ok(list(j["counties"]) == [r0["fips"]] and j["counties"][r0["fips"]]["hash"] == r0["hash"], "collect writes the story with its facts hash")
        je = j["counties"][r0["fips"]]
        ok(je["facts"] == r0["facts"] and je["sid"] == r0["sid"] and je["through"] == r0["facts"]["through_iso"], "collect stores the facts and station it was checked against")
        # the request: the API job builds one per county with the facts only
        import api_jobs as A
        reqs = A.requests_of({"story": bd_["story"][:2]})
        ok([q[0] for q in reqs] == ["story", "story"] and reqs[0][1] == cid0, "api_jobs builds story requests")
        p = reqs[0][3]
        ok(p["model"] == "claude-opus-5-5" and "Use only those facts" in p["system"] and r0["facts"]["total_in"] in p["messages"][0]["content"],
           "story request: Opus 5.5, the rules, the facts")
        ok("\u2014" not in SYSTEM and "\u2014" not in json.dumps(p), "no em dash in the prompt")
    print("county stories selftest:", "ok" if not fails else f"{len(fails)} failure(s)")
    return 0 if not fails else 1


def main(a):
    if not a or a[0] == "selftest":
        return selftest()
    if a[0] == "bundle":
        states = None
        if "--states" in a:
            states = set(a[a.index("--states") + 1].upper().split(","))
        data = os.path.join(ROOT, "data", "rain")
        b = bundle(data, states)
        if "--only" in a:     # retry just the counties a run rejected (its rejected.json)
            keep = set(json.load(open(a[a.index("--only") + 1], encoding="utf-8")))
            b["story"] = [r for r in b["story"] if f"c_{r['st']}_{r['fips']}" in keep]
        json.dump(b, open(a[1], "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
        print(f"{len(b['story'])} county story requests written to {a[1]}")
        return 0
    if a[0] == "collect":
        b, r, out = json.load(open(a[1], encoding="utf-8")), json.load(open(a[2], encoding="utf-8")), a[3]
        kept, rej = collect(b, r, out)
        if len(a) > 4:
            json.dump(rej, open(a[4], "w", encoding="utf-8"), indent=1)
        why = {}
        for v in rej.values():
            for x in v:
                k = re.sub(r"[\d.]+|'[^']*'|\[.*\]|\(.*\)", "#", x)
                why[k] = why.get(k, 0) + 1
        print(f"::notice title=County stories::{kept} kept, {len(rej)} rejected of {len(b.get('story', []))}")
        for k, n in sorted(why.items(), key=lambda kv: -kv[1])[:15]:
            print(f"  {n:5d}  {k}")
        return 0
    if a[0] == "stale":
        data = a[1] if len(a) > 1 else os.path.join(ROOT, "data", "rain")
        S = load_stories(data)
        n = m = 0
        for st, d in _B().load(data).items():
            for fips, c in d["counties"].items():
                e = S.get(st, {}).get(fips)
                if e:
                    n += 1
                    m += story_for(e, page_now(c, d)) is not None
        print(f"{n} stored stories, {m} still show (same station, under {MAX_AGE_DAYS} days old)")
        return 0
    sys.exit("modes: selftest | bundle OUT [--states IA,KS] | collect BUNDLE RESULTS OUTDIR [REJECTED] | stale [DATA_DIR]")


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
