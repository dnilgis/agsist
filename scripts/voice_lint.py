#!/usr/bin/env python3
"""
voice_lint.py -- deterministic voice check for the AGSIST Daily.

The briefing carries Sig's name. Two things in a draft can put words in his
mouth that a prompt alone does not stop:

  FABRICATED  a first-person experience he never had: "I talked to three
              elevators this morning", "my neighbor said", "we sold today",
              "around here the beans are wet". First person is allowed only
              to frame an opinion ("I'd", "I think", "my read"). Anything
              that claims he went, saw, heard, sold or was told something is
              a made-up fact under his byline.
  TELL        words and shapes that make a page read as machine-written or
              as hype: em dashes, "delve", "landscape", "navigate", "it's
              worth noting", "in today's ...", "game-changer",
              "unprecedented", "robust", "tapestry", "not just X but Y",
              a run of three adjectives, trader slang he does not use, and a
              Title Case or ALL CAPS headline.

One definition, used by three callers:
  generate_daily.py    regenerates once when a draft has any hit, then strips
                       any fabricated sentence that is still there
  critique_briefing.py shows the hits to the editor, forces a rewrite, and
                       refuses a rewrite that adds a fabricated sentence
  briefing_gate.py     FAIL on a fabricated sentence, WARN on a tell

The quote of the day and The Action (the prediction bot's line) are not
scanned: neither is written by the model in Sig's voice.

    python3 scripts/voice_lint.py --selftest
    python3 scripts/voice_lint.py data/daily.json
"""
import json
import re
import sys

# ── where the model's prose lives ──────────────────────────────────────────


def fields(b):
    """[(loc, text)] for every reader-facing field the model writes."""
    out = []

    def add(loc, v):
        if isinstance(v, str) and v.strip():
            out.append((loc, v))

    for k in ("headline", "subheadline", "lead", "teaser"):
        add(k, b.get(k))
    on = b.get("one_number")
    if isinstance(on, dict):
        add("one_number.unit", on.get("unit"))
        add("one_number.context", on.get("context"))
    for i, s in enumerate(b.get("sections") or []):
        if isinstance(s, dict):
            for k in ("title", "body", "so_what"):
                add(f"sections[{i}].{k}", s.get(k))
    for i, o in enumerate(b.get("outside_the_pit") or []):
        if isinstance(o, dict):
            for k in ("title", "body"):
                add(f"outside_the_pit[{i}].{k}", o.get(k))
    for i, w in enumerate(b.get("watch_list") or []):
        if isinstance(w, dict):
            add(f"watch_list[{i}].desc", w.get("desc"))
    return out


def _get(b, loc):
    m = re.match(r"^(\w+)\[(\d+)\]\.(\w+)$", loc)
    if m:
        arr = b.get(m.group(1)) or []
        i = int(m.group(2))
        return arr[i].get(m.group(3)) if i < len(arr) and isinstance(arr[i], dict) else None
    if "." in loc:
        a, k = loc.split(".", 1)
        return (b.get(a) or {}).get(k)
    return b.get(loc)


def _set(b, loc, v):
    m = re.match(r"^(\w+)\[(\d+)\]\.(\w+)$", loc)
    if m:
        b[m.group(1)][int(m.group(2))][m.group(3)] = v
    elif "." in loc:
        a, k = loc.split(".", 1)
        b[a][k] = v
    else:
        b[loc] = v


# ── FABRICATED: first-person experience ────────────────────────────────────
# First person is fine for an opinion: I'd, I think, I'm not sure, I wouldn't,
# my read, my guess, we'll see. It is not fine for a thing that happened.
_I_DID = (r"talked|spoke|called|heard|sold|bought|hedged|priced|booked|contracted|"
          r"delivered|hauled|checked|visited|drove|saw|met|asked|planted|harvested|"
          r"combined|shelled|walked|scouted|sprayed|picked|got|had|was at|was in|"
          r"was out|went|stopped|ran into|dug|fed|loaded|dumped|texted|emailed|"
          r"keep hearing|hear|see a lot|just got|just came")
_IVE_DONE = (r"talked|spoken|heard|sold|bought|seen|been told|been hearing|been talking|"
             r"been getting|been seeing|been out|been in|got|had|walked|scouted|picked|"
             r"driven|hauled|delivered|priced|booked|hedged|planted|harvested|combined|"
             r"called|visited|checked")
_IM_DOING = (r"hearing|seeing|getting calls|getting texts|told|talking to|out in|in the field|"
             r"in the cab|in the combine|on the combine|hauling|combining|harvesting|"
             r"planting|selling|pricing|booking|hedging|watching guys")
_WE_DID = (r"sold|bought|hauled|delivered|priced|booked|hedged|planted|harvested|combined|"
           r"shelled|picked|baled|talked|spoke|heard|called|visited|checked|saw|got \d|"
           r"got (?:an?|some|rain|snow|frost|hail)|had (?:an?|some|rain|snow|frost|hail)|"
           r"finished|started (?:combining|harvest|picking|planting)|are (?:combining|"
           r"harvesting|hauling|picking|done)|were (?:combining|harvesting|hauling|out)")
_MY_THING = (r"neighbou?rs?|elevator|farm|fields?|bins?|customers?|clients?|buyers?|banker|"
             r"agronomist|crop|corn|beans|soybeans|wheat|cattle|cows|herd|hogs|grain|"
             r"combine|trucks?|yard|operation|guys|dad|father|brother|wife|kids|family|"
             r"cousin|uncle|son|daughter|crew|place|area|county|town|coffee shop|co-?op|"
             r"local|phone|inbox|insureds|policyholders|growers|farmers")

FABRICATED = [
    ("i-did", re.compile(rf"\bI\s+(?:just\s+|also\s+|already\s+)?(?:{_I_DID})\b", re.I)),
    ("i-have-done", re.compile(rf"\bI(?:'|’)?ve\s+(?:just\s+|already\s+|also\s+)?(?:{_IVE_DONE})\b", re.I)),
    ("i-am-doing", re.compile(rf"\bI(?:'|’)m\s+(?:{_IM_DOING})\b|\bI am\s+(?:{_IM_DOING})\b", re.I)),
    ("we-did", re.compile(rf"\bwe(?:'ve)?\s+(?:just\s+|already\s+|finally\s+)?(?:{_WE_DID})\b", re.I)),
    ("my-thing", re.compile(rf"\b(?:my|our)\s+(?:own\s+)?(?:{_MY_THING})\b", re.I)),
    ("told-me", re.compile(r"\b(?:told|tells|asked|asks|called|calls|texted|texts|showed|"
                           r"emailed|messaged|reminded)\s+(?:me|us)\b", re.I)),
    ("people-i-talk-to", re.compile(r"\b(?:farmers?|guys|growers?|producers?|elevators?|buyers?|"
                                    r"merchandisers?|customers?|clients?|neighbou?rs?|"
                                    r"folks|people)\s+(?:I|we)\s+(?:talk|talked|spoke|speak|"
                                    r"work|worked|deal|dealt|hear|heard|know|called|insure)\b", re.I)),
    ("when-i", re.compile(r"\b(?:this morning|today|tonight|yesterday|last night|last week|"
                          r"this week|earlier),?\s+(?:I|we)\b(?!(?:'|’)(?:ll|d|re)\b|"
                          r"\s+(?:will|would|might|could|think|expect)\b)", re.I)),
    ("around-here", re.compile(r"\b(?:around here|in my area|in our area|"
                               r"my part of|our part of|my neck of|near me|near us|"
                               r"out my window|here in (?:Chetek|Wisconsin|northwest|"
                               r"Barron|the north))\b", re.I)),
]

# ── TELLS: machine-written or hype ─────────────────────────────────────────
TELLS = [
    ("dash", re.compile(r"[—–]|\s--\s")),
    ("delve", re.compile(r"\bdelv(?:e|es|ed|ing)\b", re.I)),
    ("landscape", re.compile(r"\blandscapes?\b", re.I)),
    ("navigate", re.compile(r"\bnavigat(?:e|es|ed|ing)\b", re.I)),
    ("worth-noting", re.compile(r"\b(?:it(?:'|’)s|it is)\s+worth\s+noting\b|\bworth noting\b", re.I)),
    ("in-todays", re.compile(r"\bin today(?:'|’)s\b", re.I)),
    ("game-changer", re.compile(r"\bgame[- ]?changers?\b|\bgame[- ]changing\b", re.I)),
    ("unprecedented", re.compile(r"\bunprecedented\b", re.I)),
    ("robust", re.compile(r"\brobust\b", re.I)),
    ("tapestry", re.compile(r"\btapestr(?:y|ies)\b", re.I)),
    ("ai-filler", re.compile(r"\b(?:crucially|notably|furthermore|moreover|underscor(?:e|es|ed|ing)|"
                             r"in conclusion|pivotal|seamless(?:ly)?|testament to|"
                             r"deep dive|a reminder that|at the end of the day)\b", re.I)),
    ("not-just-but", re.compile(r"\bnot\s+(?:just|only|merely|simply)\b[^.;:!?]{1,60}?\bbut\b|"
                                r"\b(?:isn(?:'|’)t|is not|wasn(?:'|’)t|aren(?:'|’)t)\s+"
                                r"(?:just|only|merely)\b[^.;!?]{1,50}[,;]\s*(?:it(?:'|’)s|it is|"
                                r"this is|that(?:'|’)s)\b", re.I)),
    ("hype", re.compile(r"\b(?:massive|stunning|staggering|jaw-dropping|blockbuster|mind-blowing|"
                        r"insane|monster move|eye-popping|whopping)\b", re.I)),
    ("slang", re.compile(r"\b(?:is yelling|basis is talking|carry(?:'|’)s (?:working|broken)|"
                         r"funds got lost|coiled spring|the tape|drag-day|"
                         r"\$\d+(?:\.\d+)? handle|chart(?:'|’)s bluffing|"
                         r"the chart says)\b", re.I)),
]

_ALWAYS_NAME = set("""Monday Tuesday Wednesday Thursday Friday Saturday Sunday January February
March April June July August September October November December I""".split())

# A run of three adjectives: "volatile, uncertain and fragile". Words are
# judged by a short list plus adjective endings, all three must pass.
_ADJ = set("""strong weak steady firm quiet solid tight loose thin heavy sharp clear bold fresh
key crucial critical vital dynamic resilient volatile uncertain fragile choppy nervous cautious
active slow fast broad deep wide narrow soft hard bullish bearish mixed calm wild rough smooth
healthy shaky messy murky grim bright dark tough cheap pricey rich lean big small""".split())
_ADJ_END = re.compile(r"(?:ive|ous|ful|ical|able|ible|less|ent|ant|ary|ish)$")
_TRIPLE = re.compile(r"\b([A-Za-z-]{3,}),\s+([A-Za-z-]{3,}),?\s+(?:and|or)\s+([A-Za-z-]{3,})\b")


def _is_adj(w):
    w = w.lower()
    return w in _ADJ or (len(w) >= 5 and bool(_ADJ_END.search(w)))


def _triple_adjectives(text):
    for m in _TRIPLE.finditer(text):
        if all(_is_adj(g) for g in m.groups()):
            yield m.group(0)


_SMALL = {"a", "an", "and", "as", "at", "but", "by", "for", "from", "in", "into", "of",
          "on", "or", "the", "to", "vs", "with", "off", "up", "out", "over"}


def _case_problem(text):
    """'caps' for an ALL CAPS title, 'title' for Title Case, else None.
    Day and month names do not count toward Title Case."""
    letters = [c for c in text if c.isalpha()]
    if len(letters) >= 8 and sum(c.isupper() for c in letters) / len(letters) >= 0.8:
        return "caps"
    words = [w.strip("'\u2019\"(),:;.!?$%") for w in text.split()[1:]]
    words = [w for w in words if len(w) >= 3 and w.isalpha() and not w.isupper()
             and w.lower() not in _SMALL and w not in _ALWAYS_NAME]
    capped = [w for w in words if w[0].isupper()]
    if len(capped) >= 2 and len(capped) / len(words) >= 0.75:
        return "title"
    return None


def _snip(text, m_start, m_end, pad=40):
    a = max(0, m_start - pad)
    b = min(len(text), m_end + pad)
    return ("..." if a else "") + text[a:b].replace("\n", " ") + ("..." if b < len(text) else "")


# ── the checks ─────────────────────────────────────────────────────────────


def fabricated_hits(b):
    """[(code, loc, snippet)] first-person experiences in model prose."""
    hits = []
    for loc, text in fields(b):
        for code, rx in FABRICATED:
            for m in rx.finditer(text):
                hits.append((code, loc, _snip(text, m.start(), m.end())))
    return hits


def tell_hits(b):
    """[(code, loc, snippet)] machine tells, hype, slang and headline case."""
    hits = []
    for loc, text in fields(b):
        for code, rx in TELLS:
            for m in rx.finditer(text):
                hits.append((code, loc, _snip(text, m.start(), m.end())))
        for t in _triple_adjectives(text):
            hits.append(("triple-adjective", loc, t))
        if loc == "headline" or loc.endswith(".title"):
            cp = _case_problem(text)
            if cp:
                hits.append((f"headline-{cp}" if loc == "headline" else f"title-{cp}", loc, text))
    return hits


def lint(b):
    """{'fabricated': [...], 'tells': [...]} for a briefing dict."""
    return {"fabricated": fabricated_hits(b), "tells": tell_hits(b)}


def correction(result):
    """The note sent back to the model when a draft is regenerated."""
    lines = ["CORRECTION: YOUR PREVIOUS DRAFT WAS REJECTED FOR VOICE. It carries Sig's name."]
    if result["fabricated"]:
        lines.append("It invented first-person experiences Sig never had. First person is ONLY for "
                     "opinion (\"I'd\", \"I think\"). Remove these entirely, do not reword them:")
        lines += [f"  - {loc}: \"{s}\"" for _, loc, s in result["fabricated"]]
    if result["tells"]:
        lines.append("It used words or shapes that read as machine-written, hype or trader slang. "
                     "Say these plainly, the way a Wisconsin farmer talks at the elevator:")
        lines += [f"  - {loc} [{code}]: \"{s}\"" for code, loc, s in result["tells"]]
    lines.append("Every other rule still applies. Same prices, same facts.")
    return "\n".join(lines)


# Tells a machine can fix without the model: the generator's dash sweep and
# its ALL CAPS -> sentence case pass. They never cost a regeneration. Title
# Case is fixed by fix_case() BEFORE the lint runs; a title it could not fix
# safely is still a tell.
FIXABLE = {"dash", "headline-caps", "title-caps"}


def needs_regen(result):
    """True when a draft has a fabricated sentence or a tell no sweep fixes."""
    return bool(result["fabricated"]) or any(c not in FIXABLE for c, _, _ in result["tells"])


# ── Title Case -> sentence case ────────────────────────────────────────────
# A word is kept capitalized when it is a name: all capitals (USDA), a known
# name below, or a word the same briefing capitalizes in the middle of a
# sentence ("off Qatar", "the Cargill lockout", "Grain Stocks report").
_MID = re.compile(r"(?<=[a-z0-9,;%)] )([A-Z][a-z][A-Za-z-]*)")
_LOW = re.compile(r"\b([a-z][a-z-]+)\b")
_WORD = re.compile(r"[A-Za-z][A-Za-z'\u2019]*")
# Ordinary words of a market headline: always safe to lowercase.
_COMMON = set("""a an and as at but by for from in into of on or the to vs with off up out over
under ahead after before again still both more back down higher lower firm soft flat quiet
steady corn beans soybeans soybean wheat oats cattle feeders feeder hogs hog crude oil diesel
meal soy grain grains basis harvest export exports demand supply price prices holds hold runs
run gains gain falls fall fell drift drifts grinds grind breaks break bounce bounces leads lead
takes take give gives ground jump jumps slip slips stays stay week day news report fear premium
round number heavy tight tighter big small cash bids bid rain storage stocks livestock dairy
energy inputs trade macro oilseeds complex products margin margins crush spread fed eases
ease firms slide slides pressure pressures another due come comes comes new old crop
fresh hit hits tanker sit sits wait waits turns turn slowly cycle cows cow cull same barrel
stalls stall put push pushes rising rise rises imports climb climbs reports report signs sign
tax relief order looms loom parked empty wires wire their hands hand traffic thin""".split())


def names_in(prose):
    """{word: (times capitalized mid-sentence, times lowercase)} from the prose."""
    counts = {}
    for m in _MID.finditer(prose or ""):
        w = m.group(1)
        c = counts.setdefault(w.lower(), [0, 0]); c[0] += 1
    for m in _LOW.finditer(prose or ""):
        c = counts.setdefault(m.group(1), [0, 0]); c[1] += 1
    return counts


def sentence_case_title(text, names=None):
    """'Crude Runs On Fresh Tanker Hit' -> 'Crude runs on fresh tanker hit'.
    Only a Title Case string is changed. A word is lowered only when it is an
    ordinary word: in _COMMON, or written lowercase in this same briefing
    more often than capitalized. Anything unknown keeps its capital, so a
    name the lists have never seen ('Santa Teresa') is never broken."""
    if _case_problem(text) != "title":
        return text
    names = names or {}
    first = [True]
    unknown = []

    def word(m):
        w = m.group(0)
        if first[0]:
            first[0] = False
            return w
        if w.isupper() or not w[0].isupper() or w in _ALWAYS_NAME:
            return w
        low = w.lower()
        core = re.split(r"['\u2019]", low)[0]
        caps, lows = names.get(core, (0, 0))
        if caps > lows:
            return w                                  # a name this briefing uses
        if core in _COMMON or lows:
            return w[0].lower() + w[1:]
        unknown.append(w)
        return w

    out = _WORD.sub(word, text)
    if unknown:
        return text          # half-cased is worse than Title Case; leave it for the model
    # a word right after a colon starts a new clause; leave its capital alone
    return re.sub(r"(:\s+)([a-z])", lambda m: m.group(1) + m.group(2).upper(), out)


def fix_case(b):
    """Sentence-case every Title Case headline and title in place. ALL CAPS
    is the generator's job (sentence_case_headline knows the acronyms).
    Returns (briefing, [log lines])."""
    prose = " ".join(t for loc, t in fields(b) if not (loc == "headline" or loc.endswith(".title")))
    names = names_in(prose)
    log = []
    for loc, text in fields(b):
        if loc == "headline" or loc.endswith(".title"):
            new = sentence_case_title(text, names)
            if new != text:
                _set(b, loc, new)
                log.append(f"{loc}: {text!r} -> {new!r}")
    return b, log


# ── the deterministic fix of last resort ───────────────────────────────────
_SENT = re.compile(r"[^.!?]+(?:[.!?]+|$)\s*")


def _drop_fab_sentences(text):
    """Remove every sentence that carries a fabricated phrase. Bullet lines
    keep their '- ' prefix; a bullet left empty is dropped."""
    out_lines, removed = [], []
    for line in text.split("\n"):
        prefix = ""
        body = line
        m = re.match(r"^(\s*-\s+)(.*)$", line)
        if m:
            prefix, body = m.group(1), m.group(2)
        kept = []
        for s in _SENT.findall(body):
            if any(rx.search(s) for _, rx in FABRICATED):
                removed.append(s.strip())
            else:
                kept.append(s)
        new = "".join(kept).strip()
        if new:
            out_lines.append(prefix + new)
        elif not prefix and not body.strip():
            out_lines.append(line)
    return "\n".join(out_lines).strip(), removed


def strip_fabricated(b):
    """Cut fabricated sentences out of every field that can lose one.
    The headline and titles are left alone (no sentence to cut) and the gate
    blocks them. Returns (briefing, [log lines])."""
    log = []
    for loc, text in fields(b):
        if loc == "headline" or loc.endswith(".title") or loc == "one_number.unit":
            continue
        if not any(rx.search(text) for _, rx in FABRICATED):
            continue
        new, removed = _drop_fab_sentences(text)
        if not new:
            continue            # nothing left would be worse; the gate decides
        _set(b, loc, new)
        for r in removed:
            log.append(f"{loc}: cut {r!r}")
    return b, log


# ── selftest ───────────────────────────────────────────────────────────────

_FAIL_FAB = [
    "I talked to three elevators this morning and basis is firm.",
    "My neighbor said his beans ran 60.",
    "I sold some corn at $5.00 today.",
    "We hauled the last of the beans Tuesday.",
    "A buyer told me the bids are wide.",
    "Around here the combines are parked.",
    "I've been hearing yields are better than expected.",
    "I'm hearing the river is low.",
    "This morning I checked the cash bids.",
    "The guys I talk to are holding beans.",
    "We got 2 inches of rain last night.",
    "Our elevator dropped basis a dime.",
]
_PASS_FAB = [
    "I'd keep an eye on $5.00 corn.",
    "I think the market already knew that corn was there.",
    "My read is the stocks number was already priced.",
    "I'm not sure the bounce lasts past Thursday.",
    "We'll see what export sales say Thursday.",
    "That tells you the buyer is still there.",
    "Corn held $5.00 even with heavy stocks.",
    "I wouldn't read much into one quiet day.",
]
_FAIL_TELL = [
    "Corn is navigating a tricky landscape.",
    "It's worth noting that beans firmed.",
    "In today's market, cattle led.",
    "A game-changer for feeders.",
    "An unprecedented move in soy oil.",
    "Demand stayed robust.",
    "Let's delve into the numbers.",
    "Corn held $5 — barely.",
    "This is not just a corn story but a basis story.",
    "The market was volatile, uncertain and fragile.",
    "A rich tapestry of factors.",
    "Basis is yelling.",
]
_PASS_TELL = [
    "Corn held $5.00 even with heavy stocks.",
    "Corn, beans and wheat all firmed.",
    "Soybean oil gained 2.7% and meal was up 0.8%.",
    "Cattle eased a quarter; nothing new in the boxed beef.",
]


def _selftest():
    fails = []
    for s in _FAIL_FAB:
        if not fabricated_hits({"lead": s}):
            fails.append(f"missed fabricated: {s!r}")
    for s in _PASS_FAB + _PASS_TELL:
        if fabricated_hits({"lead": s}):
            fails.append(f"false fabricated: {s!r}")
    for s in _FAIL_TELL:
        if not tell_hits({"lead": s}):
            fails.append(f"missed tell: {s!r}")
    for s in _PASS_TELL + _PASS_FAB:
        if tell_hits({"lead": s}):
            fails.append(f"false tell: {s!r} {tell_hits({'lead': s})}")
    for h, want in (("CORN HOLDS $5 AS GRAIN STOCKS COME IN HEAVY", "headline-caps"),
                    ("Corn Holds $5 As Grain Stocks Come In Heavy", "headline-title"),
                    ("Corn holds $5 even with heavy grain stocks", None),
                    ("Corn holds $5 ahead of Cattle on Feed Friday", None)):
        got = [c for c, _, _ in tell_hits({"headline": h})]
        if (want and want not in got) or (not want and got):
            fails.append(f"headline case {h!r}: got {got}, want {want}")
    b = {"lead": "Corn held $5.00. I talked to elevators today. Beans firmed.",
         "sections": [{"title": "Corn", "body": "- Corn held **$5.00**.\n- My neighbor said yields are good.",
                       "so_what": "Plain."}]}
    b, log = strip_fabricated(b)
    if fabricated_hits(b) or b["lead"] != "Corn held $5.00. Beans firmed." \
            or b["sections"][0]["body"] != "- Corn held **$5.00**." or len(log) != 2:
        fails.append(f"strip_fabricated: {b} {log}")
    c = {"headline": "Crude Runs 5% On Another Tanker Hit Off Qatar",
         "lead": "WTI is at $92.61 after a tanker was hit off Qatar.",
         "sections": [{"title": "Cattle On Feed Due Friday", "body": "- The Cattle on Feed report is Friday.",
                       "so_what": "x"},
                      {"title": "USDA: Grain Stocks Come In Heavy", "body": "- The Grain Stocks report was big.",
                       "so_what": "x"}]}
    c, _ = fix_case(c)
    want = ("Crude runs 5% on another tanker hit off Qatar", "Cattle on Feed due Friday",
            "USDA: Grain Stocks come in heavy")
    got = (c["headline"], c["sections"][0]["title"], c["sections"][1]["title"])
    if got != want:
        fails.append(f"fix_case: got {got}, want {want}")
    if needs_regen(lint({"headline": "CORN HOLDS $5", "lead": "Corn held — barely."})):
        fails.append("needs_regen fired on fixable tells only")
    if not needs_regen(lint({"lead": "Demand stayed robust."})):
        fails.append("needs_regen missed a real tell")
    for f in fails:
        print("  FAIL", f)
    print(f"voice_lint selftest: {len(fails)} failure(s)")
    return 1 if fails else 0


def main(argv):
    if "--selftest" in argv:
        return _selftest()
    path = argv[1] if len(argv) > 1 else "data/daily.json"
    b = json.load(open(path))
    r = lint(b)
    for code, loc, s in r["fabricated"]:
        print(f"  [FAIL] fabricated:{code} {loc}: {s}")
    for code, loc, s in r["tells"]:
        print(f"  [WARN] tell:{code} {loc}: {s}")
    print(f"voice_lint: {len(r['fabricated'])} fabricated, {len(r['tells'])} tell(s)")
    return 1 if r["fabricated"] else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
