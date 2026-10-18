#!/usr/bin/env python3
"""stories_core.py: the shared part of the written stories on generated page sets.

The county rain stories (scripts/county_stories.py) were first. This is the same
idea made general, for the PRF county pages, the Farmland Atlas county pages,
the town cash bid pages and the co-op company pages. Each set is its own module
(scripts/stories_prf.py, stories_atlas.py, stories_bids.py) that gives:

  NAME, PREFIX      the set's name and its one-letter custom_id prefix
  SYSTEM, prompt(f) what the model is told, and the facts it gets
  facts_all()       [(id, facts)] for every page, built by the page's own code
  spec(f)           the validator's rules for one page's facts (see check())
  extra(s, m, f)    set-only checks on the story (s) and its masked text (m)
  STORE, path_of()  where the kept stories live (data/<set>/stories/<group>.json)
  VOLATILE          fact keys the page cannot rebuild at build time (the
                    snapshot day, a preliminary figure); stored with the story
  MAX_AGE           days a story may show after its own "As of" day (None: no limit)

HOW A STORY STAYS TRUE (the rain rules, kept)
  1. Facts: only what the page itself prints, formatted the way it prints it.
  2. check(): every number, date, month, year and direction word must be in the
     facts, each number next to the fact it belongs to. Banned words, number
     words, dashes and wrong lengths are rejected. A rejected page gets no
     story; there is never a fallback.
  3. The page: at build time the set rebuilds the page's facts NOW, adds the
     story's stored volatile facts, and the story prints only when that hash
     equals the hash it was written from and it still passes check(). A figure
     on the page moved: no story. Facts are not stored (they are rebuilt), so a
     story costs about 0.7 KB of data.
  4. Every story names its own day ("As of Oct 18,"), so it stays true while it shows.

  python3 scripts/stories_core.py selftest                     every set's selftest
  python3 scripts/stories_core.py bundle SET OUT.json [--only REJECTED.json]
  python3 scripts/stories_core.py collect SET BUNDLE RESULTS OUTDIR [REJECTED.json]
  python3 scripts/stories_core.py stale SET                    how many stored stories still show
SETS: prf, atlas, town, company.
"""
import datetime as dt
import hashlib
import importlib
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
SCHEMA = "agsist-stories/1"
SETS = {"prf": "stories_prf", "atlas": "stories_atlas", "town": "stories_bids", "company": "stories_bids"}

MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September",
               "October", "November", "December"]
MONTH_RE = r"(?:" + "|".join(MONTHS_LONG) + "|" + "|".join(MONTHS) + r")"
DATE_RE = re.compile(r"\b(" + MONTH_RE + r")\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?!,?\s*\d{3})|\b(" + MONTH_RE + r")\.?\s+(\d{1,2}),\s+(20\d\d)\b")

# ---------------------------------------------------------------- shared word lists (the rain set's, by kind)
FORECAST = ["forecast", "will", "expect", "expected", "likely", "probably", "should", "could", "might", "may be",
            "outlook", "going to", "next year", "coming"]
UNBACKED = ["record", "records", "historic", "unprecedented", "ever", "typical", "normally", "average", "averages",
            "rank", "ranked", "ranks", "ranking", "worst", "best", "top", "extreme", "drought", "flood", "flooding",
            "storm", "storms", "boom", "bust", "bubble", "crash", "soar", "soared", "soaring", "plunge", "plunged",
            "skyrocketed", "surged", "spiked", "million", "billion", "thousand", "thousands"]
TONE = ["notably", "notable", "remarkable", "remarkably", "delve", "tapestry", "testament", "journey", "landscape",
        "vibrant", "crucial", "robust", "seamless", "boasts", "nestled", "impressive", "incredible", "amazing",
        "stunning", "dramatic", "dramatically", "significant", "significantly", "massive", "huge", "whopping",
        "staggering", "roughly", "approximately", "around", "nearly", "almost", "about", "solid", "strong", "weak",
        "healthy", "hefty", "steep", "modest", "sharp", "sharply", "key", "vital", "bustling", "thriving", "hub"]
NUMBER_WORDS = ["two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
                "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty",
                "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety", "hundred", "dozen", "half",
                "twice", "double", "doubled", "triple", "tripled", "third", "quarter", "decade", "decades",
                "fortnight", "several", "dozens", "handful", "couple", "majority", "most", "few", "many"]
BAD_CHARS = {"—": "em dash", "–": "en dash", "!": "exclamation mark", "?": "question mark",
             ";": "semicolon", "&": "ampersand", "<": "angle bracket", ">": "angle bracket", "*": "asterisk",
             "#": "hash", '"': "double quote", "“": "curly quote", "”": "curly quote", "\n": "line break",
             "(": "parenthesis", ")": "parenthesis", "/": "slash", "~": "tilde"}
# words a capital letter may start anywhere (beyond the facts' own names and the months)
COMMON_CAPS = {"As", "Of", "USDA", "RMA", "NASS", "NOAA", "AGSIST", "PRF", "The", "A", "An", "In", "On", "At", "It",
               "That", "This", "Its", "Each", "Every", "Over", "Since", "From", "Across", "Between", "For", "With",
               "Both", "Their", "There", "Here", "Of", "And", "But", "Corn", "Soybeans", "Wheat", "Sorghum", "Oats",
               "Soybean", "Census", "Grid", "Grids", "Non", "County", "Parish", "Its"}
UP = r"rose|risen|climbed|increased|gained|grew|higher|more than|above|stronger than|up"
DOWN = r"fell|fallen|dropped|declined|decreased|lower|less than|below|weaker than|down|slipped"
SAME = r"even with|the same as|unchanged|level with"
DIR_RE = re.compile(r"\b(" + UP + "|" + DOWN + "|" + SAME + r")\b", re.I)


def dir_of(w):
    w = w.lower()
    if re.fullmatch(UP, w):
        return "up"
    if re.fullmatch(DOWN, w):
        return "down"
    return "same"


def facts_hash(f):
    return hashlib.sha1(json.dumps(f, sort_keys=True, separators=(",", ":")).encode()).hexdigest()[:16]


def short_date(iso):
    d = dt.date.fromisoformat(iso[:10])
    return f"{MONTHS[d.month - 1]} {d.day}"


def canon(x):
    return str(x).replace(",", "").replace("$", "").replace("%", "").replace("\u2212", "").lstrip("+").strip()


def forms(printed, kind):
    """The ways a story may print a figure the page prints as `printed`."""
    if printed is None:
        return set()
    c = canon(printed)
    out = {c}
    if "." in c and kind in ("pct", "inch", "bu"):
        v = float(c)
        out.add(f"{v:.1f}")
        if kind == "pct":
            out.add(str(int(abs(v) + 0.5) * (1 if v >= 0 else -1)))
    return out


def claim(kind, printed, near=None, kw=None, opt=None):
    """One figure: its kind (money, pct, inch, bu, cents, int), the page's print,
    near: {class: token} the nearest token of that class in its clause (else its
    sentence) must be; opt: the same, checked only when the class is there at all;
    kw: words, one of which must be in the sentence."""
    return {"kind": kind, "forms": forms(printed, kind), "near": near or {}, "opt": opt or {}, "kw": kw}


# ---------------------------------------------------------------- the checks
TOKEN_RE = re.compile(r"(?<![\w.$-])(\$)?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(?![\d,]*\.\d)"
                      r"(\s*(?:%|percent\b)|\s+(?:inches|inch)\b|\s+in\b(?=\s*[.,]|\s*$)|\s*(?:bu|bushels?)\b|\s*(?:cents?)\b)?")


def tokens(text):
    """[(start, end, kind, canon value)] for every number in text."""
    out = []
    for m in TOKEN_RE.finditer(text):
        dollar, ip, fp, unit = m.group(1), m.group(2), m.group(3) or "", (m.group(4) or "").strip().lower()
        v = ip.replace(",", "") + fp
        if dollar:
            k = "money"
        elif unit in ("%", "percent"):
            k = "pct"
        elif unit.startswith("in"):
            k = "year" if (not fp and "," not in ip and 1900 <= int(ip) <= 2100) else "inch"
        elif unit.startswith("bu"):
            k = "bu"
        elif unit.startswith("cent"):
            k = "cents"
        elif not fp and "," not in ip and len(ip) == 4 and 1900 <= int(ip) <= 2100:
            k = "year"
        else:
            k = "int"
        out.append((m.start(), m.start() + len(m.group(0).rstrip()), k, v))
    return out


def sentences(s):
    """[(start, text)] split at a period that ends a sentence."""
    out, start = [], 0
    for m in re.finditer(r"(?<=[a-zA-Z0-9%)])\.(?=\s|$)", s):
        out.append((start, s[start:m.end()]))
        start = m.end()
    if s[start:].strip():
        out.append((start, s[start:]))
    return out


def clauses(sent):
    """[(start, text)] inside one sentence: split at commas, colons, 'and', 'but', 'while'."""
    out, start = [], 0
    for m in re.finditer(r",(?=\s)|:(?=\s)|\s(?:and|but|while|with)\s", sent):
        out.append((start, sent[start:m.start()]))
        start = m.end()
    out.append((start, sent[start:]))
    return out


def nearest(rx, text, pos, end=None):
    """The match of rx in text nearest to the span pos..end (a match after it wins a tie)."""
    end = pos if end is None else end
    best = None
    for m in re.finditer(rx, text):
        d = (m.start() - end) if m.start() >= end else (pos - m.end())
        if best is None or d < best[0] or (d == best[0] and m.start() >= end):
            best = (d, m.group(0))
    return best and best[1]


def bound(rx, cl, se, pos, prev, end=None):
    """What a number at pos (in sentence se, clause cl=(start, text)) refers to, of
    one class (a pair of months, a year, a grid): the nearest in its own clause;
    else the last one before it in its sentence; else the last in the sentence
    before ('It came in under 90% in 21 of 75 years'); else the first after it."""
    cs, ct = cl
    if re.search(rx, ct):
        return nearest(rx, ct, pos - cs, (end or pos) - cs)
    before = list(re.finditer(rx, se[:pos]))
    if before:
        return before[-1].group(0)
    pv = list(re.finditer(rx, prev))
    if pv:
        return pv[-1].group(0)
    m = re.search(rx, se[pos:])
    return m and m.group(0)


def check(story, spec, extra=None, facts=None):
    """[] when every claim in the story is in its facts, else the reasons.

    spec: lead (the day the story speaks for, 'Oct 18'), masks [(regex, token)],
    claims [claim()], classes {class: regex over masked text}, years {int},
    dates {'Oct 18'}, names {capitalised words the facts give}, banned [words],
    allow [regex removed before the banned-word check], supers [(word regex,
    [regex that must be in the sentence])], dirs [{'kw': regex, 'dir': up|down|same}],
    chars (min, max), sents (min, max)."""
    bad = []
    if not isinstance(story, str):
        return ["not text"]
    s0 = story.strip()
    lo, hi = spec.get("chars", (120, 650))
    if not (lo <= len(s0) <= hi):
        bad.append(f"length {len(s0)} outside {lo}-{hi}")
    # names the facts give exactly ("Atkinson Grain & Fertilizer, Inc.") are read as one word
    s = s0
    for lit in sorted(set(spec.get("literal", [])), key=len, reverse=True):
        if lit and len(lit) > 2:
            s = re.sub(r"(?<![\w])" + re.escape(lit.rstrip(".")) + r"\.?(?=\.|\s|,|$)" if lit.endswith(".") else
                       r"(?<![\w])" + re.escape(lit) + r"(?![\w])", "LITERALNAME", s)
    if not s0.endswith("."):
        bad.append("does not end with a period")
    smin, smax = spec.get("sents", (2, 4))
    n = len(re.findall(r"(?<=[a-zA-Z0-9%)])\.(?:\s|$)", s))
    if not (smin <= n <= smax):
        bad.append(f"{n} sentences, not {smin}-{smax}")
    lead = spec["lead"]
    if not re.match(r"As of " + re.escape(lead) + r",\s", s):
        bad.append(f"does not start 'As of {lead},'")
    for ch, name in BAD_CHARS.items():
        if ch in s:
            bad.append(name)
    if "--" in s or re.search(r"\s-\s", s):
        bad.append("dash")
    m_ = s
    # the lead names the day; any other date must be in the facts
    m_ = re.sub(r"^As of " + re.escape(lead) + ",", "LEADDAY,", m_)
    for m in DATE_RE.finditer(m_):
        mo, d = (m.group(1), m.group(2)) if m.group(1) else (m.group(3), m.group(4))
        k = f"{mo[:3]} {int(d)}"
        if k not in spec.get("dates", set()):
            bad.append(f"date {m.group(0)!r} is not in the facts")
    m_ = DATE_RE.sub(lambda m: " DATE" + ((m.group(1) or m.group(3))[:3]) + str(int(m.group(2) or m.group(4))) + " ", m_)
    for rx, tok in spec.get("masks", []):
        m_ = re.sub(rx, tok, m_)
    # ---- words
    w_ = m_
    for rx in spec.get("allow", []):
        w_ = re.sub(rx, " ALLOWED ", w_, flags=re.I)
    ban = list(dict.fromkeys(FORECAST + UNBACKED + TONE + NUMBER_WORDS + spec.get("banned", [])))
    for w in spec.get("unban", []):
        if w in ban:
            ban.remove(w)
    for m in re.finditer(r"\b(" + "|".join(re.escape(w) for w in ban) + r")\b", w_, re.I):
        bad.append(f"banned word {m.group(0)!r}")
    for m in re.finditer(r"\b" + MONTH_RE + r"\b", w_):
        bad.append(f"month {m.group(0)!r} is not in the facts")
    # a capitalised word the facts do not give is a name the page does not print
    names = set(spec.get("names", set())) | COMMON_CAPS | {"LEADDAY", "ALLOWED", "LITERALNAME"}
    for st, se in sentences(w_):
        for i, m in enumerate(re.finditer(r"\b[A-Z][A-Za-z'’]*\b", se)):
            word = m.group(0)
            if word in names or re.fullmatch(r"[A-Z]{2,}\d*|DATE[A-Z][a-z]{2}\d+", word) or word.isupper():
                continue
            if i == 0 and re.match(r"\s*" + re.escape(word), se):
                continue   # a sentence may start with any word
            bad.append(f"name {word!r} is not in the facts")
    for rx, need in spec.get("supers", []):
        for st, se in sentences(m_):
            if re.search(rx, se, re.I) and not any(all(re.search(r, se) for r in alt) for alt in need):
                bad.append(f"{re.search(rx, se, re.I).group(0)!r} without the fact it belongs to")
    sup = r"\b(highest|lowest|biggest|largest|smallest|cheapest|priciest|costliest|wettest|driest|strongest|weakest|least|fewest)\b"
    known = [rx for rx, _ in spec.get("supers", [])]
    for st, se in sentences(m_):
        for m in re.finditer(sup, se, re.I):
            if not any(re.search(rx, m.group(0), re.I) for rx in known):
                bad.append(f"'{m.group(0)}' is not a fact the page gives")
    # ---- numbers
    claims_ = spec.get("claims", [])
    classes = spec.get("classes", {})
    years = spec.get("years", set())
    prev = ""
    for st, se in sentences(m_):
        cls = clauses(se)
        if st:
            prev = m_[:st]
            prev = sentences(prev)[-1][1] if sentences(prev) else ""
        for a, b, kind, v in tokens(se):
            if kind == "year":
                if int(v) not in years:
                    bad.append(f"year {v} is not in the facts")
                continue
            cands = [c for c in claims_ if c["kind"] == kind and v in c["forms"]]
            label = {"money": "$" + v, "pct": v + "%", "inch": v + " inches", "bu": v + " bu"}.get(kind, v)
            if not cands:
                bad.append(f"{label} is not in the facts")
                continue
            cl = next(((cs, ct) for cs, ct in cls if cs <= a < cs + len(ct) + 1), (0, se))
            okc = False
            for c in cands:
                fine = True
                for k, want in list(c["near"].items()) + list(c["opt"].items()):
                    if k in c["opt"] and not re.search(classes[k], se):
                        continue    # an optional tie is checked only when its sentence names one
                    got = bound(classes[k], cl, se, a, prev if k not in c["opt"] else "", b)
                    if got != want:
                        fine = False
                        break
                if fine and c.get("kw") and not (re.search(c["kw"], se, re.I) or re.search(c["kw"], prev, re.I)):
                    fine = False
                if fine:
                    okc = True
                    break
            if not okc:
                bad.append(f"{label} sits with the wrong fact")
    # ---- direction words: each needs a fact that gives that way
    for st, se in sentences(m_):
        cls = clauses(se)
        for m in DIR_RE.finditer(se):
            if m.group(1).lower() == "up" and not re.match(r"\s+\$?\d", se[m.end():]):
                continue    # 'up' only as 'up 26.1%'
            if m.group(1).lower() == "down" and not re.match(r"\s+\$?\d", se[m.end():]):
                continue
            want = dir_of(m.group(1))
            cl = next((ct for cs, ct in cls if cs <= m.start() < cs + len(ct) + 1), se)
            ds = [d for d in spec.get("dirs", []) if re.search(d["kw"], cl, re.I)] or \
                 [d for d in spec.get("dirs", []) if re.search(d["kw"], se, re.I)]
            if not ds:
                # 'fell to 60%', 'rose from $250 to $290': the numbers on either side give the way
                after = [t for t in tokens(cl) if t[0] >= m.end() - (se.find(cl) if cl in se else 0) and t[2] != "year"]
                before = [t for t in tokens(se[:m.start()]) if t[2] != "year"]
                pair = None
                fm = re.match(r"\s+(?:by\s+\S+\s+)?from\s+(\S+)\s+(?:in\s+\d{4}\s+)?to\s+(\S+)", se[m.end():])
                if fm:
                    a_ = tokens(fm.group(1)) + tokens(fm.group(2))
                    if len(a_) == 2 and a_[0][2] == a_[1][2]:
                        pair = (float(a_[0][3]), float(a_[1][3]))
                elif before and after and before[-1][2] == after[0][2] and before[-1][2] != "year":
                    pair = (float(before[-1][3]), float(after[0][3]))
                if pair is None:
                    bad.append(f"'{m.group(1)}' compares something the facts do not")
                elif (want == "up" and not pair[1] > pair[0]) or (want == "down" and not pair[1] < pair[0]) or (want == "same" and pair[0] != pair[1]):
                    bad.append(f"'{m.group(1)}' is the wrong way for {pair[0]:g} to {pair[1]:g}")
            elif not any(d["dir"] == want for d in ds):
                bad.append(f"'{m.group(1)}' is the wrong way (facts: {sorted({d['dir'] for d in ds})})")
    if extra:
        bad += extra(s0, m_, facts)
    return sorted(set(bad))


# ---------------------------------------------------------------- the set plumbing
def mod_of(name):
    return importlib.import_module(SETS[name])


def set_of(name):
    """The set object: the module, with NAME bound for the two-set module."""
    m = mod_of(name)
    return m.SET[name] if hasattr(m, "SET") else m


def validate(S, story, f):
    return check(story, S.spec(f), getattr(S, "extra", None), f)


def stable(S, f):
    return {k: v for k, v in f.items() if k not in S.VOLATILE}


def story_for(S, entry, now, page_day):
    """The story to print on a page whose facts, rebuilt now, are `now` (the
    volatile keys are ignored), with `page_day` the ISO day the page's data was
    read; or None. It prints only when: the stored volatile facts plus `now`
    hash to the story's own hash (every figure it was written from is still the
    page's), it still passes the validator, and it is at most MAX_AGE days old."""
    if not entry or not isinstance(entry, dict) or not isinstance(entry.get("story"), str):
        return None
    vol = entry.get("vol")
    if not isinstance(vol, dict) or set(vol) != set(S.VOLATILE):
        return None
    f = stable(S, now)
    f.update(vol)
    if entry.get("hash") != facts_hash(f):
        return None
    if S.MAX_AGE is not None:
        try:
            age = (dt.date.fromisoformat(str(page_day)[:10]) - dt.date.fromisoformat(str(vol["as_of_iso"])[:10])).days
        except (KeyError, TypeError, ValueError):
            return None
        if age > S.MAX_AGE or age < 0:
            return None
    s = entry["story"].strip()
    return s if not validate(S, s, f) else None


def bundle(S, ids=None):
    rows = []
    for pid, f in S.facts_all():
        if ids is not None and pid not in ids:
            continue
        rows.append({"set": S.NAME, "id": pid, "hash": facts_hash(f), "facts": f})
    return {"schema": SCHEMA, "set": S.NAME, "story": rows}


def cid_of(S, pid):
    return (S.PREFIX + "_" + re.sub(r"[^a-zA-Z0-9_-]", "_", pid))[:64]


def collect(S, bundle_d, results_d, out_dir, made=None):
    """Check each result against the facts it was asked about; write OUTDIR/<group>.json.
    -> (kept, {cid: reasons})."""
    items = results_d.get("items", {})
    kept, rej, files = 0, {}, {}
    for r in bundle_d.get("story", []):
        cid = cid_of(S, r["id"])
        it = items.get(cid)
        if not it or it.get("result") != "succeeded":
            rej[cid] = [f"no result ({(it or {}).get('result', 'missing')})"]
            continue
        if it.get("stop_reason") not in (None, "end_turn"):
            rej[cid] = [f"stop_reason {it.get('stop_reason')}"]
            continue
        story = ((it.get("parsed") or {}).get("story") or "").strip()
        if facts_hash(r["facts"]) != r["hash"]:
            rej[cid] = ["facts changed after the bundle was built"]
            continue
        why = validate(S, story, r["facts"])
        if why:
            rej[cid] = why
            continue
        g, key = S.path_of(r["id"])
        files.setdefault(g, {})[key] = {"story": story, "hash": r["hash"], "vol": {k: r["facts"][k] for k in S.VOLATILE}}
        kept += 1
    os.makedirs(out_dir, exist_ok=True)
    for g, cs in sorted(files.items()):
        json.dump({"schema": SCHEMA, "set": S.NAME, "group": g, "model": results_d.get("model"),
                   "batch_id": results_d.get("batch_id"), "made": made or results_d.get("collected_utc"), "pages": cs},
                  open(os.path.join(out_dir, g + ".json"), "w", encoding="utf-8"), ensure_ascii=False, sort_keys=True,
                  separators=(",", ":"))
    return kept, rej


def load(S, d=None):
    """{group: {key: entry}} from the set's store."""
    d = d or os.path.join(ROOT, S.STORE)
    out = {}
    if not os.path.isdir(d):
        return out
    for name in sorted(os.listdir(d)):
        if not name.endswith(".json"):
            continue
        try:
            j = json.load(open(os.path.join(d, name), encoding="utf-8"))
        except ValueError:
            continue
        if j.get("schema") == SCHEMA and j.get("set") == S.NAME and isinstance(j.get("pages"), dict):
            out[j.get("group")] = j["pages"]
    return out


def lookup(store, S, pid):
    g, key = S.path_of(pid)
    return (store.get(g) or {}).get(key)


def summary(rej):
    why = {}
    for v in rej.values():
        for x in v:
            k = re.sub(r"\$?[\d.,]+%?|'[^']*'|\[.*\]|\(.*\)", "#", x)
            why[k] = why.get(k, 0) + 1
    return sorted(why.items(), key=lambda kv: -kv[1])


def run_pairs(S, f, pairs, ok):
    """Each (true story, planted error): the true one passes, the planted one fails."""
    for i, (t, w) in enumerate(pairs):
        r = validate(S, t, f)
        ok(r == [], f"{S.NAME}: true story {i} passes: {r} | {t}")
        ok(validate(S, w, f) != [], f"{S.NAME}: planted error {i} caught: {w}")


def main(a):
    if not a or a[0] == "selftest":
        names = a[1:] or ["prf", "atlas", "town"]
        bad = 0
        for n in names:
            bad += mod_of(n).selftest()
        return 1 if bad else 0
    S = set_of(a[1])
    if a[0] == "bundle":
        ids = None
        if "--only" in a:
            keep = set(json.load(open(a[a.index("--only") + 1], encoding="utf-8")))
            ids = {r["id"] for r in bundle(S)["story"] if cid_of(S, r["id"]) in keep}
        b = bundle(S, ids)
        json.dump(b, open(a[2], "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
        print(f"{len(b['story'])} {S.NAME} story requests written to {a[2]}")
        return 0
    if a[0] == "collect":
        b, r, out = json.load(open(a[2], encoding="utf-8")), json.load(open(a[3], encoding="utf-8")), a[4]
        kept, rej = collect(S, b, r, out)
        if len(a) > 5:
            json.dump(rej, open(a[5], "w", encoding="utf-8"), indent=1)
        print(f"::notice title={S.NAME} stories::{kept} kept, {len(rej)} rejected of {len(b.get('story', []))}")
        for k, n in summary(rej)[:15]:
            print(f"  {n:5d}  {k}")
        return 0
    if a[0] == "stale":
        store = load(S)
        n = m = 0
        for pid, f in S.facts_all():
            e = lookup(store, S, pid)
            if e:
                n += 1
                m += story_for(S, e, f, f["as_of_iso"]) is not None
        print(f"{n} stored {S.NAME} stories, {m} still show")
        return 0
    sys.exit("modes: selftest [SET..] | bundle SET OUT [--only REJ] | collect SET BUNDLE RESULTS OUTDIR [REJ] | stale SET")


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
