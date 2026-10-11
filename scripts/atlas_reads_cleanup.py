#!/usr/bin/env python3
"""
atlas_reads_cleanup.py -- plain-words pass over the Farmland Atlas county reads.

WHY
  The reads in data/atlas/reads.json are model-written (atlas_reads.py). The
  2026-09 run came back with the same habits in thousands of counties: 1,929
  opened "Non-irrigated cash rent in X County runs $N", 695 said "stands at",
  443 "sits at", 415 "stood at", 91 "carries a census value", 216 "has moved
  from" with a chain of four periods, and 122 repeated the page's own note
  that the census land value is "the operators' own estimate, not a sale
  price" -- printed right next to the read already.

WHAT IT DOES
  clean_text(text, key) makes rewrites that cannot change a number, a county,
  a year or a meaning:
    stands at / sits at -> is, stood at / sat at -> was, runs $N -> is $N
    carries a census value of -> has a census value of, Land value carries at -> is
    em and en dashes -> commas
    "has moved from 9 percent in 1989-1999 to 12 percent in ... to ..." ->
      "was 9 percent in 1989-1999, 12 percent in ... and ..."
    drops the "operators' own estimate / not a sale price" aside (never a
      phrase with a digit in it)
    the "Non-irrigated cash rent in X County runs $N" opener is rotated over
      four phrasings by a stable hash of the county code, so the same county
      always gets the same one and a second pass changes nothing
  voice_hits(text) lists what is still machine-shaped: voice_lint.py's TELLS
  and FABRICATED, plus the Atlas habits above. atlas_reads.py runs both on
  every new read: clean_text first, then a read with voice hits goes round
  again once with the hits named, and is flagged if it still has them.

THE NUMBER CHECK
  Every entry's multiset of number tokens is compared before and after. One
  difference and nothing is written.

    python3 scripts/atlas_reads_cleanup.py --selftest
    python3 scripts/atlas_reads_cleanup.py --check     # counts only, writes nothing
    python3 scripts/atlas_reads_cleanup.py             # rewrites data/atlas/reads.json
"""
import hashlib
import json
import os
import re
import sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import voice_lint  # noqa: E402

OUT = os.path.join(HERE, "..", "data", "atlas", "reads.json")

NUM_RE = re.compile(r"\d[\d,]*(?:\.\d+)?")


def numbers(text):
    """Multiset of number tokens, commas dropped: '$1,357' and '1357' agree."""
    return Counter(m.replace(",", "") for m in NUM_RE.findall(text))


# ── the Atlas habits ───────────────────────────────────────────────────────
# (code, regex, what to write instead). The hint goes back to the model on a
# retry, so it is written as an instruction.
ATLAS_TELLS = [
    ("opener", re.compile(r"^(?:Non-irrigated|Dryland) cash rent in [^,$]{2,60}? "
                          r"(?:runs|stands at|sits at|averages|comes in at|carries)\b"),
     "do not open with 'Non-irrigated cash rent in X runs'; lead with what is notable about this county"),
    ("filler-verb", re.compile(r"\b(?:stands?|sits?|stood|sat|standing|sitting) (?:at|as)\b|"
                               r"\bsits (?:above|below|near|close|well)\b|\bcomes? in at\b|\bcame in at\b"),
     "write 'is' or 'was', not 'stands at', 'sits at', 'stood at' or 'comes in at'"),
    ("runs-number", re.compile(r"\bruns (?:at )?(?=\$?\d)"), "write 'is', not 'runs $N'"),
    ("carries", re.compile(r"\bcarr(?:y|ies|ied) (?:a |an |the )?(?:census |land |operators?'? ?(?:own )?)?"
                           r"(?:value|estimate|figure)\b|\bcarr(?:y|ies) at\b|\bLand value carries\b"),
     "write 'has a census value of' or 'is', not 'carries a census value' or 'carries at'"),
    ("chain", re.compile(r"\bfrom [^.;:]{1,40}? in \d{4}(?:-\d{4})?,? to [^.;:]{1,40}? in "
                         r"\d{4}(?:-\d{4})?,? (?:and )?to\b"),
     "give one trend in plain words with two numbers, not a chain 'from A to B to C to D'"),
    ("moved-from", re.compile(r"\b(?:has|have) moved from\b|\bhas moved (?:the same direction|unevenly)\b"),
     "say which way it went in plain words ('rose', 'fell', 'was ... and ...'), not 'has moved from'"),
    ("no-clear-direction", re.compile(r"\bno clear direction\b|\bdirection (?:rising|falling)\b|"
                                      r"\bdirection of the multiple\b"),
     "if a trend has no clear direction, leave the trend out; do not write 'no clear direction'"),
    ("published-years", re.compile(r"\bon published years\b"),
     "write 'over 2008-2024', not 'per acre a year on published years 2008-2024'"),
    ("template-note", re.compile(r"operators?(?:'s?|s'|s)? ?(?:own )?estimate|\b(?:rather than|not) a sale price\b",
                                 re.I),
     "do not repeat that the census value is the operators' estimate and not a sale price; the page says it"),
    ("odd-phrase", re.compile(r"\bran hot\b|\bDrought pressure has been present\b|"
                              r"\bthe weather carries\b|\bcarries the (?:load|weight|operation)\b"),
     "say it plainly with the number: 'the loss ratio was 1.15', 'the county had 203 weeks of severe drought'"),
]


def voice_hits(text):
    """[(code, snippet, hint)] for every machine-shaped habit still in a read."""
    hits = []
    for code, rx in voice_lint.FABRICATED:
        for m in rx.finditer(text):
            hits.append(("fabricated-" + code, m.group(0), "no first-person experience; the read is from the numbers"))
    for code, rx in voice_lint.TELLS:
        for m in rx.finditer(text):
            hits.append((code, m.group(0), "plain words; no dashes or stock phrases"))
    for t in voice_lint._triple_adjectives(text):
        hits.append(("triple-adjective", t, "one adjective, not three"))
    for code, rx, hint in ATLAS_TELLS:
        for m in rx.finditer(text):
            hits.append((code, m.group(0), hint))
    return hits


def hits_feedback(hits):
    """One line for the model's retry: each habit once, with what to do instead."""
    seen, parts = set(), []
    for code, snip, hint in hits:
        if code in seen:
            continue
        seen.add(code)
        parts.append(f'"{snip.strip()}" ({hint})')
    return "; ".join(parts)


# ── the rewrites ───────────────────────────────────────────────────────────

_EST = (r"(?:the |an? )?(?:census |Census )?operators?(?:'s?|s'|s)? ?(?:own )?estimates?"
        r"(?: rather than a sale price|,? (?:and )?not a sale price)?")
_VERB = r"(?:is|was|are|were|stands?|sits?|stood|sat|runs?|ran|reached|rose|climbed|came|carries|carry|has|had)\b"
_ASIDE_LEAD = r"(?:by|per|under|based on|as)"


def _nodigit(fn):
    """A removal never takes a digit with it."""
    def sub(m):
        out = fn(m)
        if re.search(r"\d", m.group(0)) and numbers(m.group(0)) != numbers(out):
            return m.group(0)
        return out
    return sub


def _drop_estimate(t):
    # "Land value, by the operators' own estimate, stands at" -> "Land value stands at"
    t = re.sub(rf", {_ASIDE_LEAD} {_EST}, (?={_VERB})", _nodigit(lambda m: " "), t)
    # "Land value under the census operators' own estimate stands at" -> "Land value stands at"
    t = re.sub(rf" (?:{_ASIDE_LEAD}) {_EST}(?= {_VERB})", _nodigit(lambda m: ""), t)
    # "$6,763 per acre, the operators' own estimate, up 25.9 percent" -> "$6,763 per acre, up ..."
    t = re.sub(rf", (?:{_ASIDE_LEAD} )?{_EST}(?=[,.;])", _nodigit(lambda m: ""), t)
    # "reaching $1,091 per acre by the operators' own estimate." -> "reaching $1,091 per acre."
    t = re.sub(rf" (?:by|under|per|based on) {_EST}(?=[.;])", _nodigit(lambda m: ""), t)
    t = re.sub(r", as operators estimate it(?=[,.])", "", t)
    # "by the 2022 census operator estimate" -> "in the 2022 census"; the year stays
    t = re.sub(r"\b(?:by|per|under|in|from) the (\d{4}) [Cc]ensus operators?(?:'s?|s'|s)? ?(?:own )?estimate\b",
               r"in the \1 census", t)
    t = re.sub(r"\bby the operators(?:'s?|s'|s)? ?(?:own )?(\d{4}) estimate\b", r"in the \1 census", t)
    # "Land and buildings carry an operator estimate of $6,660" -> "... have a census value of"
    t = re.sub(r"\b(carries|carry|carried) an? (?:census )?operators?(?:'s?|s'|s)? ?(?:own )?estimate of\b",
               lambda m: {"carries": "has", "carry": "have", "carried": "had"}[m.group(1)] + " a census value of", t)
    t = re.sub(rf"\bcarries the {_EST} of (?=\$)", "is ", t)
    return t


def _verbs(t):
    t = re.sub(r"\b(stands|sits) at (?=\$?\d|the |a |an |just |only |roughly )", "is ", t)
    t = re.sub(r"\b(stands|sits) (as|above|below|near|close|well|just|right|level)\b", r"is \2", t)
    t = re.sub(r"\b(stand|sit) at (?=\$?\d)", "are ", t)
    t = re.sub(r"\b(stand) as\b", "are", t)
    t = re.sub(r"\b(stood|sat) at (?=\$?\d|the |a |an |just |only )", "was ", t)
    t = re.sub(r"\bstood as\b", "was", t)
    t = re.sub(r", (?:sitting|standing) at (?=\$?\d)", ", at ", t)
    t = re.sub(r"\b(?:comes|came) in at (?=\$?\d)", lambda m: "is " if m.group(0).startswith("comes") else "was ", t)
    t = re.sub(r"\bruns (?:at )?(?=\$?\d)", "is ", t)
    # carries
    t = re.sub(r"\bLand value carries (?:at )?(?=\$\d)", "Land value is ", t)
    t = re.sub(r"\bcarries at (?=\$?\d)", "is ", t)
    t = re.sub(r"\b(carries|carry|carried) (a|an) (?=(?:census|Census|value|land|fitted|trend|rising|falling|median|"
               r"loss|crop|higher|lower|market|non-irrigated|\d{4})\b)",
               lambda m: {"carries": "has", "carry": "have", "carried": "had"}[m.group(1)] + " " + m.group(2) + " ", t)
    t = re.sub(r"\b(cropland|acres)( here)? (carries|carry|carried) irrigation\b",
               lambda m: m.group(1) + (m.group(2) or "") + " "
               + {"carries": "is", "carry": "are", "carried": "was"}[m.group(3)] + " irrigated", t)
    return t


_ITEM = r"(\$?\d[\d,]*(?:\.\d+)?(?: percent| F| times)?) in ((?:\d{4}-\d{4})|\d{4})"
_SEP = r"(?:,? to |, and |,? and |, )"
_CHAIN = re.compile(rf"\b(has|have)? ?moved from {_ITEM}((?:{_SEP}{_ITEM})+)")


def _chain(t):
    """'has moved from 7 percent in 1989-1999, to 12 percent in 2000-2009, to 52 percent
    in 2010-2019' -> 'was 7 percent in 1989-1999, 12 percent in 2000-2009 and 52 percent
    in 2010-2019'. Same numbers, same periods, no 'moved'."""
    def sub(m):
        items = [(m.group(2), m.group(3))] + re.findall(_ITEM, m.group(4))
        if len(items) < 2:
            return m.group(0)
        verb = "were" if m.group(1) == "have" else "was"
        parts = [f"{v} in {p}" for v, p in items]
        body = parts[0] if len(parts) == 1 else ", ".join(parts[:-1]) + " and " + parts[-1]
        return f"{verb} {body}"
    return _CHAIN.sub(sub, t)


_MOVED_F = re.compile(r"\bhas moved from (a |an )?(\d+(?:\.\d+)?) F\b([^.;]*?) to (\d+(?:\.\d+)?) F\b")


def _moved_f(t):
    """'has moved from a 48.7 F normal to 49.6 F' -> 'has risen from ...': the two
    numbers say which way, so the word can too. Equal numbers are left alone."""
    def sub(m):
        a, b = float(m.group(2)), float(m.group(4))
        if a == b:
            return m.group(0)
        return ("has risen from " if b > a else "has fallen from ") + m.group(0)[len("has moved from "):]
    return _MOVED_F.sub(sub, t)


_CHAIN_TO = re.compile(rf"\bfrom {_ITEM}((?: to {_ITEM}){{2,}}(?:(?:, and |,? and |, ){_ITEM})*)")


def _chain_to(t):
    """'fell from 53 percent in 1989-1999 to 36 percent in 2000-2009 to 31 percent in
    2010-2019' -> 'fell from 53 percent in 1989-1999 to 36 percent in 2000-2009 and 31
    percent in 2010-2019'. The verb before 'from' is kept; only the 'to ... to' goes."""
    def sub(m):
        rest = re.findall(_ITEM, m.group(3))
        parts = [f"{v} in {p}" for v, p in rest]
        tail = parts[0] if len(parts) == 1 else ", ".join(parts[:-1]) + " and " + parts[-1]
        return f"from {m.group(1)} in {m.group(2)} to {tail}"
    return _CHAIN_TO.sub(sub, t)


_OPENER = re.compile(r"^Non-irrigated cash rent in ((?:[A-Z][\w.'-]*\s)+?(?:County|Parish|Borough|Census Area|"
                     r"City and Borough|Municipality|city|City|Area|District|Region|Island)) "
                     r"(?:runs|stands at|sits at|averages|is) (?=\$\d)")


def _variant(key):
    return int(hashlib.sha256(("atlas-opener|" + str(key)).encode()).hexdigest()[:8], 16) % 4


def _opener(t, key):
    m = _OPENER.match(t)
    if not m:
        return t
    place = m.group(1)
    v = _variant(key)
    if v == 1 and place.endswith("s"):
        v = 2
    head = ["Non-irrigated cash rent in {p} is ",
            "{p}'s non-irrigated cash rent is ",
            "In {p}, non-irrigated cash rent is ",
            "Non-irrigated ground in {p} rents for "][v].format(p=place)
    return head + t[m.end():]


def clean_text(text, key="", opener=True):
    """Safe rewrites only. Never changes a number token (checked by the caller
    and by the selftest). Idempotent: clean_text(clean_text(x)) == clean_text(x)."""
    t = text
    t = re.sub(r"(?<=\d)[–—](?=\d)", "-", t)
    t = re.sub(r"\s*[—–]\s*", ", ", t)
    t = re.sub(r"\s+--\s+", ", ", t)
    t = _drop_estimate(t)
    if opener:
        t = _opener(t, key)
    t = _verbs(t)
    t = _chain(t)
    # same word count as what it replaces: a read sits near the 130-word gate
    t = re.sub(r"\bon published years (?=\d{4}-\d{4})", "over published years ", t)
    t = re.sub(r"\bthe direction of (that|the) multiple shows no clear direction\b", r"\1 multiple has had no clear trend", t)
    t = re.sub(r"\bshows no clear direction\b", "has had no clear trend", t)
    t = re.sub(r"\bshow no clear direction\b", "have had no clear trend", t)
    t = re.sub(r"\bsevere severe\b", "severe", t)
    t = re.sub(r", direction (rising|falling)\b", r", a \1 trend", t)
    t = re.sub(r"\bDrought pressure has been present but limited:", "Drought has shown up here, but not often:", t)
    t = re.sub(r"\bDrought pressure has been present(?: here)?:", "Drought has shown up here:", t)
    t = re.sub(r"\bCrop insurance losses ran hot relative to premium over the closed years (\d{4}-\d{4}), "
               r"with a loss ratio of (\d+(?:\.\d+)?),", r"Over the closed years \1, the crop insurance loss ratio was \2,", t)
    # tidy what a removal can leave behind
    t = re.sub(r"\bweeks ([^.;]{0,40}?)sat at severe drought", r"weeks \1were in severe drought", t)
    t = re.sub(r"\bLand value carries the census figure of (?=\$\d)", "Land value is ", t)
    t = re.sub(r"\bLand value carries (?:the same direction|a larger story|a different story|a similar climb): "
               r"the census figure ", "The census land value ", t)
    t = re.sub(r"\bLand value carries a different story: (?=\$\d)", "Land value was ", t)
    t = re.sub(r"\bLand value carries the same climb, ", "Land value climbed as well, ", t)
    t = _moved_f(t)
    t = _chain_to(t)
    t = re.sub(r",\s*,", ",", t)
    t = re.sub(r",\s*\.", ".", t)
    t = re.sub(r"  +", " ", t).strip()
    return t


# ── counting and the file pass ─────────────────────────────────────────────

COUNT = [
    ("opener 'Non-irrigated cash rent in X runs/stands at/sits at/averages'",
     r"^Non-irrigated cash rent in [^,$]{2,60}? (?:runs|stands at|sits at|averages) \$"),
    ("opener 'Non-irrigated cash rent in X' (any verb)", r"^Non-irrigated cash rent in "),
    ("stands at", r"\bstands at\b"),
    ("sits at", r"\bsits at\b"),
    ("stood at / sat at", r"\b(?:stood|sat) at\b"),
    ("runs $N / runs N", r"\bruns (?:at )?\$?\d"),
    ("carries a census value / carry a census value", r"\bcarr(?:y|ies|ied) a census value\b"),
    ("Land value carries (at)", r"\bLand value carries\b"),
    ("carries/carry a ... (any)", r"\bcarr(?:y|ies|ied) (?:a|an)\b"),
    ("chain 'from A in P1 to B in P2 to ...'", r"\bfrom [^.;:]{1,40}? in \d{4}(?:-\d{4})?,? to [^.;:]{1,40}? in \d{4}(?:-\d{4})?,? (?:and )?to\b"),
    ("has moved from", r"\bhas moved from\b"),
    ("moved from (any)", r"\bmoved from\b"),
    ("no clear direction", r"\bno clear direction\b"),
    ("show(s) no clear direction", r"\bshows? no clear direction\b"),
    ("per acre a year on published years", r"\bper acre a year on published years\b"),
    ("operators' estimate / not a sale price", r"operators?(?:'s?|s'|s)? ?(?:own )?estimate|(?:rather than|not) a sale price"),
    ("Drought pressure has been present", r"\bDrought pressure has been present\b"),
    ("ran hot", r"\bran hot\b"),
    ("em/en dash", r"[—–]"),
]


def count(texts):
    return {label: sum(1 for x in texts if re.search(rx, x)) for label, rx in COUNT}


def opener_spread(texts):
    c = Counter()
    for x in texts:
        c[" ".join(re.sub(r"\$\d.*", "$N", x.split(",")[0]).split()[:3]) if x else ""] += 1
    return c


def run(write):
    with open(OUT, encoding="utf-8") as f:
        reads = json.load(f)
    # A cleaned read must still pass the writer's own gate wherever the old one
    # did: the build's --salvage step re-gates every read, and one that fails
    # (130 words, a number) would be dropped from the page. Same for the page
    # builder's read_ok(): it drops a read whose first loss-ratio period after
    # the words "loss ratio" is not the last ten years.
    os.chdir(os.path.join(HERE, ".."))
    import atlas_reads
    import build_atlas_pages as pages

    def shown(text, det):
        v = det.get("value")
        return pages.read_ok(text, det, v.get("flag") if pages.ok(v) else None)
    with open(atlas_reads.ATLAS, encoding="utf-8") as f:
        atlas = json.load(f)["counties"]
    before, after, changed, bad = [], [], [], []
    fallback = 0
    for fips, e in reads["counties"].items():
        t = e.get("text")
        if not t:
            continue
        n = clean_text(t, fips)
        det = atlas_reads.load_detail(fips, atlas[fips]) if fips in atlas else None
        if det is not None:
            block = atlas_reads.inputs_block(fips, det)
            def fine(x):
                return (atlas_reads.gate(x, block) is None or atlas_reads.gate(t, block) is not None) and \
                    (shown(x, det) or not shown(t, det))
            if not fine(n):
                fallback += 1
                n = clean_text(t, fips, opener=False)
                if not fine(n):
                    n = t
        before.append(t)
        after.append(n)
        if numbers(t) != numbers(n):
            bad.append((fips, t, n))
        if n != t:
            changed.append((fips, t, n))
            e["text"] = n
        if n != t and clean_text(n, fips) != n and clean_text(n, fips, opener=False) != n:
            bad.append((fips, n, clean_text(n, fips)))
    cb, ca = count(before), count(after)
    print(f"{len(before)} reads, {len(changed)} changed; {fallback} fell back so the read still passes the writer's gate and the page's read_ok()\n")
    print(f"{'pattern':66s}{'before':>8s}{'after':>8s}")
    for label, _ in COUNT:
        print(f"{label:66s}{cb[label]:8d}{ca[label]:8d}")
    vb = sum(1 for x in before if voice_hits(x))
    va = sum(1 for x in after if voice_hits(x))
    print(f"{'reads with any voice_hits()':66s}{vb:8d}{va:8d}")
    if bad:
        print(f"\nNUMBER OR IDEMPOTENCE CHECK FAILED on {len(bad)} entries; nothing written")
        for fips, a, b in bad[:5]:
            print(" ", fips, "\n   ", a, "\n   ", b)
        return 1
    print(f"\nnumber check: every one of {len(before)} entries has the same multiset of number tokens before and after")
    if write and changed:
        with open(OUT, "w", encoding="utf-8") as f:
            json.dump(reads, f, separators=(",", ":"), ensure_ascii=False)
        print(f"wrote {os.path.relpath(OUT)}")
    return 0


# ── selftest ───────────────────────────────────────────────────────────────

def selftest():
    cases = [
        ("Non-irrigated cash rent in Sanborn County stands at $138 per acre in 2026, up 20 percent from 2016.", None),
        ("The loss ratio for closed crop years 1989-2025 stands at 0.65, narrowing to 0.49 over 2016-2025.",
         "The loss ratio for closed crop years 1989-2025 is 0.65, narrowing to 0.49 over 2016-2025."),
        ("Irrigated rent sits at $229 per acre.", "Irrigated rent is $229 per acre."),
        ("Land value stood at $4,985 per acre in 2022.", "Land value was $4,985 per acre in 2022."),
        ("Solar and wind stand at 0 MW.", "Solar and wind are 0 MW."),
        ("Land carries a census value of $2,354 per acre, up 6.6 percent from 2017 to 2022.",
         "Land has a census value of $2,354 per acre, up 6.6 percent from 2017 to 2022."),
        ("Land and buildings carry a census value of $2,354 per acre.", "Land and buildings have a census value of $2,354 per acre."),
        ("Land value carries at $6,202 per acre, the operators' own estimate, up 6.5 percent from 2017 to 2022.",
         "Land value is $6,202 per acre, up 6.5 percent from 2017 to 2022."),
        ("Land value, by the operators' own estimate, sits at $6,763 per acre, up 25.9 percent from 2017 to 2022.",
         "Land value is $6,763 per acre, up 25.9 percent from 2017 to 2022."),
        ("Land value under the census operators' own estimate stands at $3,020 per acre.", "Land value is $3,020 per acre."),
        ("Land value rose 41.4 percent from 2017 to 2022, reaching $4,253 per acre by the operators' own estimate.",
         "Land value rose 41.4 percent from 2017 to 2022, reaching $4,253 per acre."),
        ("Land value sits at $2,864 per acre in the 2022 census, an operator estimate rather than a sale price, up 42.1 percent.",
         "Land value is $2,864 per acre in the 2022 census, up 42.1 percent."),
        ("Land value in DeKalb County was $99,639 per acre in the 2022 census, the operators' own estimate, not a sale price.",
         "Land value in DeKalb County was $99,639 per acre in the 2022 census."),
        # a year inside the aside stays: only the "operator estimate" words go
        ("Land value, per the 2022 census operator estimate, stands at $3,498 per acre.",
         "Land value, in the 2022 census, is $3,498 per acre."),
        ("Heat and drought's share of crop insurance indemnities has moved from 7 percent in 1989-1999, to 12 percent in 2000-2009, "
         "to 52 percent in 2010-2019, to 72 percent in 2020-2025.",
         "Heat and drought's share of crop insurance indemnities was 7 percent in 1989-1999, 12 percent in 2000-2009, "
         "52 percent in 2010-2019 and 72 percent in 2020-2025."),
        ("That share has moved from 46 percent in 1989-1999 to 49 percent in 2000-2009, 49 percent in 2010-2019, and 52 percent in 2020-2025.",
         "That share was 46 percent in 1989-1999, 49 percent in 2000-2009, 49 percent in 2010-2019 and 52 percent in 2020-2025."),
        ("The irrigated multiple has moved from 1.09 in 2010 to 1.79 in 2025, direction rising.",
         "The irrigated multiple was 1.09 in 2010 and 1.79 in 2025, a rising trend."),
        ("Corn yield trend runs 3.8 bushels per acre a year on published years 2008-2025.",
         "Corn yield trend is 3.8 bushels per acre a year over published years 2008-2025."),
        ("July nightly lows show no clear direction since 1976.", "July nightly lows have had no clear trend since 1976."),
        ("Its share has climbed from 15 percent in 1989-1999 to 64 percent in 2000-2009 to 77 percent in 2010-2019 and 77 percent in 2020-2025.",
         "Its share has climbed from 15 percent in 1989-1999 to 64 percent in 2000-2009, 77 percent in 2010-2019 and 77 percent in 2020-2025."),
        ("Rent is $221 per acre — a rent-to-value ratio of 2.4 percent.", "Rent is $221 per acre, a rent-to-value ratio of 2.4 percent."),
        ("Drought pressure has been present: 323 of 1357 weeks.", "Drought has shown up here: 323 of 1357 weeks."),
        ("Crop insurance losses ran hot relative to premium over the closed years 1989-2025, with a loss ratio of 0.99, and over 2016-2025 the ratio rose to 1.15.",
         "Over the closed years 1989-2025, the crop insurance loss ratio was 0.99, and over 2016-2025 the ratio rose to 1.15."),
        ("Only 10 percent of harvested cropland carries irrigation, and rent is $90.", "Only 10 percent of harvested cropland is irrigated, and rent is $90."),
        ("98 percent of harvested cropland here carries irrigation.", "98 percent of harvested cropland here is irrigated."),
        ("Rent is $194, versus 2.06 in 2009; the direction of that multiple shows no clear direction.",
         "Rent is $194, versus 2.06 in 2009; that multiple has had no clear trend."),
        ("The July nightly low has moved from a 48.7 F normal to 49.6 F over 2017-2026.",
         "The July nightly low has risen from a 48.7 F normal to 49.6 F over 2017-2026."),
        ("The share fell from 53 percent in 1989-1999 to 36 percent in 2000-2009 to 31 percent in 2010-2019, then rose to 37 percent in 2020-2025.",
         "The share fell from 53 percent in 1989-1999 to 36 percent in 2000-2009 and 31 percent in 2010-2019, then rose to 37 percent in 2020-2025."),
        ("Land value is $3,879 per acre by the 2022 census operator estimate, up 42 percent.",
         "Land value is $3,879 per acre in the 2022 census, up 42 percent."),
        ("Of 1357 weeks, 465 since 2000 sat at severe drought or worse.", None),
        ("465 of 1357 weeks since 2000 sat at severe drought or worse.", "465 of 1357 weeks since 2000 were in severe drought or worse."),
        # left alone: direction words carry information, "ran" can be plural
        ("Heat and drought's share rose from 9 percent in 1989-1999 to 33 percent in 2020-2025.", None),
        ("Severe drought weeks ran 77 in 2021-2025.", None),
    ]
    for src, want in cases:
        got = clean_text(src, "19169")
        if want is not None:
            assert got == want, f"\n  in:   {src}\n  got:  {got}\n  want: {want}"
        assert numbers(got) == numbers(src), (src, got)
        assert clean_text(got, "19169") == got, ("not idempotent", got)

    # the opener: four phrasings, stable per county, numbers untouched
    src = "Non-irrigated cash rent in Perry County runs $46 per acre in 2025, up 40 percent from 2014."
    outs = {clean_text(src, k) for k in ("01105", "01001", "19169", "31001", "17083", "08005", "37155", "19145", "55005")}
    assert len(outs) >= 3, outs
    for o in outs:
        assert numbers(o) == numbers(src) and "Perry County" in o and "$46 per acre in 2025" in o, o
        assert len(o.split()) <= len(src.split()), ("an opener may not add words", o)
        assert clean_text(o, "x") == o or _OPENER.match(o), o
    assert clean_text(src, "01105") == clean_text(src, "01105")
    assert all(not voice_hits(o) for o in outs), [voice_hits(o) for o in outs]
    # a name ending in s never gets an awkward possessive
    for k in range(40):
        o = clean_text("Non-irrigated cash rent in St. Francis Parish runs $50 per acre.", str(k))
        assert "Parish's" in o or "'s" not in o, o

    # voice_hits: catches each habit, passes a plain read
    plain = ("Adams County is irrigated country: 61 percent of harvested cropland is watered, most of it from "
             "groundwater. Irrigated rent is $289 an acre against $138 for dry ground in 2025. Heat and drought "
             "went from 9 percent of insurance claims in 1989-1999 to 33 percent in 2020-2025.")
    assert not voice_hits(plain), voice_hits(plain)
    for bad, code in [("Non-irrigated cash rent in Adams County runs $138 per acre.", "opener"),
                      ("Land value stands at $5,000.", "filler-verb"),
                      ("Land value sits at $5,000.", "filler-verb"),
                      ("Land carries a census value of $5,000.", "carries"),
                      ("Land value carries at $5,000.", "carries"),
                      ("The share went from 9 percent in 1989-1999 to 12 percent in 2000-2009 to 33 percent in 2020-2025.", "chain"),
                      ("The share has moved from 9 percent in 1989-1999 to 33 percent in 2020-2025.", "moved-from"),
                      ("July lows show no clear direction.", "no-clear-direction"),
                      ("Corn trend is 2.5 bushels per acre a year on published years 2008-2024.", "published-years"),
                      ("Land is $5,000, the operators' own estimate.", "template-note"),
                      ("Land is $5,000, an operator estimate rather than a sale price.", "template-note"),
                      ("Losses ran hot relative to premium.", "odd-phrase"),
                      ("Drought pressure has been present.", "odd-phrase"),
                      ("Rent is $90 — high for the area.", "dash"),
                      ("I talked to the elevator about rent.", "fabricated-i-did")]:
        codes = [h[0] for h in voice_hits(bad)]
        assert code in codes, (bad, codes)
    fb = hits_feedback(voice_hits("Land value stands at $5,000 and sits at $6,000."))
    assert fb.startswith('"stands at" (') and fb.count('" (') == 1 and "write 'is'" in fb, fb
    print("selftest ok")


def main(argv):
    if "--selftest" in argv:
        selftest()
        return 0
    return run(write="--check" not in argv)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
