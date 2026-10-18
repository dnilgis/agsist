#!/usr/bin/env python3
"""stories_bids.py: the dated lead paragraph on the town cash bid pages
(cash-bids/<state>/<town>.html) and the co-op company pages
(cash-bids/company/<slug>.html), both written by scripts/build_cash_bid_pages.py.

FACTS: the stable things the page states, never today's price.
  town     the elevators the page lists with a current bid (in town, and the
           ones within 10 miles, as the page names them), the crops they bid,
           how the headline corn and soybean basis sits against the state's
           middle for the same futures month (the page's own words: stronger,
           weaker or even with; no cents), and the day the basis log starts.
  company  how many locations the page lists, in which states (with counts),
           a few towns in each, and the crops its table carries.
Both: "As of <the snapshot day>". The facts are built inside build_town_page()
and build_company_pages.build_page() from the same values the page prints.

THE PAGE: rebuilt through the day. A kept story prints under the answer line only
when the facts the page states now (plus the stored day) hash to the story's
own, it passes check(), and it is at most 35 days old. A new elevator, a lost
crop, a basis that crossed the state middle: no story until the next batch.

BUNDLE: the facts come from a full build, so the bundle needs the live network:
  STORY_FACTS_OUT=/tmp/cb-facts.json python3 scripts/build_cash_bid_pages.py --out /tmp/cb --sitemap /tmp/cb.xml
  STORY_FACTS=/tmp/cb-facts.json python3 scripts/stories_core.py bundle town OUT.json   (or company)
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import stories_core as K  # noqa: E402

CROP_WORDS = {"corn": r"\bcorn\b", "soybeans": r"\bsoybeans?\b|\bbeans\b", "wheat": r"\bwheat\b",
              "sorghum": r"\bsorghum\b|\bmilo\b", "oats": r"\boats?\b"}
BANNED = ["price", "prices", "priced", "paying", "pays", "paid", "pay", "cents", "dollar", "dollars", "bid", "today", "now", "currently", "tonight", "tomorrow", "yesterday", "this", "week", "call", "haul",
          "you", "your", "should", "deal", "cheap", "competitive", "premium", "spring", "summer", "fall", "autumn",
          "winter", "harvest", "weather", "rain", "drought", "storm", "owner", "owners", "owned", "family", "manager",
          "biggest", "largest", "leading", "major", "popular", "busy", "affiliated", "partner", "members", "member", "owns",
          "founded", "history", "employees", "capacity", "storage"]
BANNED.remove("bid")      # 'bids corn' is the fact; a bid's amount is never in the facts
BANNED.remove("this")
VOL = ("as_of", "as_of_iso")


def _names(*xs):
    out = set()
    for x in xs:
        out |= set(re.findall(r"[A-Za-z][A-Za-z'’.&-]*", x or ""))
    out |= {w.rstrip(".") for w in list(out)}
    return out


# ---------------------------------------------------------------- facts, built inside the page builders
def town_facts(t, live_b, crops, picks, cmp_lines, hist_first, sname, near_mi, crop_order, crop_label, snap_ct, near_text, head_name):
    """What build_town_page() prints for an indexable town, as it prints it."""
    els = []
    for bd in live_b:
        name = bd["operator"] or bd["city"]
        loc = near_text(bd) or (bd["city"] if bd["city"] and bd["city"].lower() != name.lower() else "")
        els.append({"name": name, "where": loc or None, "near": bd["how"] == "near"})
    cmp_ = []
    for x in cmp_lines:
        if "line" not in x:
            continue
        m = re.search(r"\bis (even with|.*?\bstronger than|.*?\bweaker than) the ", x["line"])
        if not m:
            continue
        w = m.group(1)
        hn = picks[x["crop"]][1]
        bd = next((b for b in live_b if head_name(b) == hn), None)
        cmp_.append({"crop": x["crop"], "elevator": (bd["operator"] or bd["city"]) if bd else hn,
                     "vs_state_middle": "even with" if w == "even with" else ("stronger than" if "stronger" in w else "weaker than"),
                     "same_futures_month": True})
    day = snap_ct.date().isoformat()
    return {"town": t["name"], "state": sname, "state_code": t["state"],
            "elevators_in_town": sum(1 for e in els if not e["near"]),
            "elevators_within_miles": sum(1 for e in els if e["near"]), "near_miles": near_mi,
            "elevators": els, "crops": [crop_label[c].lower() for c in crop_order if c in crops],
            "basis_vs_state": cmp_, "basis_log_since": hist_first or None,
            "as_of": K.short_date(day), "as_of_iso": day}


def company_facts(co, states, by_st, crops, state_names, snap_ct):
    day = snap_ct.date().isoformat()
    sts = []
    for s in states:
        towns = sorted({t["name"] for t, _ in by_st[s]}, key=str.lower)
        sts.append({"state": state_names[s], "locations": len(by_st[s]), "some_towns": towns[:6]})
    return {"company": co["name"], "short": co["short"], "locations": len(co["locs"]), "states": sts,
            "crops_in_table": crops, "site": co.get("host") or None,
            "as_of": K.short_date(day), "as_of_iso": day}


def _story_p(S, store, pid, f):
    if not store:
        return ""
    s = K.story_for(S, K.lookup(store, S, pid), f, f["as_of_iso"])
    import html
    return f'<p class="cbt-sub cbt-story">{html.escape(s, quote=False)}</p>' if s else ""


# ---------------------------------------------------------------- the two sets
class _Set:
    VOLATILE = VOL
    MAX_AGE = 35

    def facts_all(self):
        p = os.environ.get("STORY_FACTS") or os.path.join(K.ROOT, "cash-bids-story-facts.json")
        try:
            d = json.load(open(p, encoding="utf-8"))
        except (OSError, ValueError):
            sys.exit(f"::error::{p} missing: run build_cash_bid_pages.py with STORY_FACTS_OUT first")
        return [(pid, f) for pid, f in sorted(d.get(self.NAME, {}).items())]


class Town(_Set):
    NAME, PREFIX = "town", "t"
    STORE = os.path.join("data", "cash-bids-stories", "towns")

    def path_of(self, pid):
        st, slug = pid.split("/", 1)
        return st, slug

    def spec(self, f):
        claims = [K.claim("int", f["elevators_in_town"], kw=r"elevators?"),
                  K.claim("int", f["elevators_within_miles"], kw=r"within|miles?|\bnear"),
                  K.claim("int", f["near_miles"], kw=r"miles?")]
        claims.append(K.claim("int", len(f["elevators"]), kw=r"in all|total|altogether|in and near|\band near\b"))
        masks = []
        for e in sorted(f["elevators"], key=lambda e: -len(e["name"])):
            masks.append((re.escape(e["name"]), "ELEV"))
        dirs = []
        for x in f["basis_vs_state"]:
            dirs.append({"kw": CROP_WORDS[x["crop"]],
                         "dir": {"stronger than": "up", "weaker than": "down", "even with": "same"}[x["vs_state_middle"]]})
        names = _names(f["town"], f["state"], *(e["name"] for e in f["elevators"]), *(e["where"] or "" for e in f["elevators"]))
        dates = {f["as_of"]} | ({f["basis_log_since"]} if f["basis_log_since"] else set())
        lit = [e["name"] for e in f["elevators"]] + [e["where"] for e in f["elevators"] if e["where"]] + [x["elevator"] for x in f["basis_vs_state"]]
        return {"lead": f["as_of"], "masks": masks, "claims": claims, "years": set(), "dates": dates, "names": names | {f["state_code"]}, "literal": lit,
                "classes": {}, "banned": BANNED, "supers": [], "dirs": dirs, "chars": (100, 550), "sents": (2, 3)}

    def extra(self, s, m, f):
        bad = []
        for c, rx in CROP_WORDS.items():
            if re.search(rx, s, re.I) and c not in f["crops"]:
                bad.append(f"{c} is not a crop the page lists")
        cmp_crops = {x["crop"] for x in f["basis_vs_state"]}
        for st, se in K.sentences(s):
            if re.search(r"\bbasis\b", se, re.I) and re.search(r"stronger|weaker|even with|above|below|middle|median", se, re.I):
                named = {c for c, rx in CROP_WORDS.items() if re.search(rx, se, re.I)}
                if not named or not named <= cmp_crops:
                    bad.append("a basis comparison the page does not make")
            if re.search(r"\bmedian\b|\baverage\b", se, re.I):
                bad.append("the page says the state's middle, not a median or average")
        if re.search(r"\$|\d+\s*(?:c|cents|¢)\b", s):
            bad.append("a price or a basis amount (the page's numbers move through the day)")
        return bad

    SYSTEM = """You write the opening paragraph for one town page on agsist.com, a free farm website run by Sig Lindquist, a Certified Crop Adviser. The page lists the cash grain bids posted by the elevators in and near one town, read from each elevator's own bid board, and is rebuilt through the day. Your paragraph sits under the page's answer line and says who buys grain in this town, in a few plain sentences. It must stay true all month, so it never gives a price.

You get the facts the page states, as JSON. Use only those facts.

Write:
- 2 or 3 sentences, 100 to 500 characters, one paragraph, plain text.
- In Sig's voice: plain farm words, short sentences, a little dry.
- Start with "As of {as_of}," naming the day exactly as the facts give it.
- Name the elevators exactly as the facts name them, say which crops they bid, and, when basis_vs_state is given, how that crop's basis at that elevator sat against the state's middle in the facts' own words (stronger than, weaker than or even with the state's middle for the same futures month). Name the crop in the same sentence as its comparison.
- Numbers only as the facts give them, in digits: how many elevators, the miles.

Do not:
- give any price, basis amount, cents or dollars, or say "today" or "now". No "best", "highest" or "top" bid.
- add anything the facts do not say: no owners, no history of the elevator, no size, no weather, no harvest talk, no advice, no "you".
- use number words, em dashes, dashes, semicolons, parentheses, slashes, exclamation marks, questions or quotes.
- sound like a machine: no "notably", "bustling", "hub", no wrap-up line.

Answer with one JSON object in a ```json fenced block and nothing after it:
{"story": "<the paragraph>"}"""

    def prompt(self, f):
        shown = {k: v for k, v in f.items() if k not in ("as_of_iso",)}
        return (f"Facts for the {f['town']}, {f['state_code']} cash bid page (as of {f['as_of']}):\n"
                + json.dumps(shown, ensure_ascii=False, separators=(", ", ": ")))

    def story_html(self, store, pid, f):
        return _story_p(self, store, pid, f)


class Company(_Set):
    NAME, PREFIX = "company", "o"
    STORE = os.path.join("data", "cash-bids-stories", "companies")

    def path_of(self, pid):
        return pid[:1].lower() if pid[:1].isalpha() else "0", pid

    def spec(self, f):
        claims = [K.claim("int", f["locations"], kw=r"locations?|elevators?|sites?|towns?")]
        claims.append(K.claim("int", len(f["states"]), kw=r"states?"))
        for s in f["states"]:
            claims.append(K.claim("int", s["locations"], near={"state": s["state"]}, kw=r"locations?|in"))
        names = _names(f["company"], f["short"], *(s["state"] for s in f["states"]), *(t for s in f["states"] for t in s["some_towns"]))
        masks = [(re.escape(f["company"]), "COMPANY"), (re.escape(f["short"]), "COMPANY")]
        st_rx = "|".join(re.escape(s["state"]) for s in sorted(f["states"], key=lambda s: -len(s["state"])))
        return {"lead": f["as_of"], "masks": masks, "claims": claims, "years": set(), "dates": {f["as_of"]}, "names": names,
                "literal": [f["company"], f["short"]], "classes": {"state": st_rx or "NOSTATE"}, "banned": BANNED, "supers": [], "dirs": [], "chars": (100, 550), "sents": (2, 3)}

    def extra(self, s, m, f):
        bad = []
        for c, rx in CROP_WORDS.items():
            if re.search(rx, s, re.I) and c not in f["crops_in_table"]:
                bad.append(f"{c} is not a crop the page's table carries")
        for st_name in re.findall(r"\b(" + "|".join(re.escape(x) for x in STATE_LIST) + r")\b", s):
            if st_name not in {x["state"] for x in f["states"]} and st_name not in f["company"]:
                bad.append(f"{st_name} is not a state the page lists")
        if re.search(r"\$|\d+\s*(?:c|cents|¢)\b|\bbasis\b", s):
            bad.append("a price or basis (the page's numbers move through the day)")
        return bad

    SYSTEM = """You write the opening paragraph for one elevator company page on agsist.com, a free farm website run by Sig Lindquist, a Certified Crop Adviser. The page lists the cash grain bids at every location of one company that the AGSIST network reads, state by state, and is rebuilt through the day. AGSIST is not affiliated with the company. Your paragraph sits under the page's answer line and says where this company buys grain, in a few plain sentences. It must stay true all month, so it never gives a price.

You get the facts the page states, as JSON. Use only those facts.

Write:
- 2 or 3 sentences, 100 to 500 characters, one paragraph, plain text.
- In Sig's voice: plain farm words, short sentences, a little dry.
- Start with "As of {as_of}," naming the day exactly as the facts give it.
- Say how many locations the page lists and in which states (with each state's count when it helps), name a few of the towns the facts give, and the crops the table carries.
- Numbers only as the facts give them, in digits.

Do not:
- give any price, basis, cents or dollars, or say "today" or "now". No "best", "biggest", "leading" or "major".
- add anything the facts do not say: no history of the company, no members, no owners, no size beyond the count of locations, no advice, no "you".
- use number words, em dashes, dashes, semicolons, parentheses, slashes, exclamation marks, questions or quotes.
- sound like a machine: no "notably", "boasts", "footprint", no wrap-up line.

Answer with one JSON object in a ```json fenced block and nothing after it:
{"story": "<the paragraph>"}"""

    def prompt(self, f):
        shown = {k: v for k, v in f.items() if k not in ("as_of_iso",)}
        return (f"Facts for the {f['short']} company page (as of {f['as_of']}):\n"
                + json.dumps(shown, ensure_ascii=False, separators=(", ", ": ")))

    def story_html(self, store, pid, f):
        return _story_p(self, store, pid, f)


STATE_LIST = ["Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut", "Delaware", "Florida",
              "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana", "Maine",
              "Maryland", "Massachusetts", "Michigan", "Minnesota", "Mississippi", "Missouri", "Montana", "Nebraska",
              "Nevada", "New Hampshire", "New Jersey", "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio",
              "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina", "South Dakota", "Tennessee", "Texas",
              "Utah", "Vermont", "Virginia", "Washington", "West Virginia", "Wisconsin", "Wyoming"]
TOWN, COMPANY = Town(), Company()
SET = {"town": TOWN, "company": COMPANY}


# ---------------------------------------------------------------- selftest
def check_pages(facts, pages_dir):
    """Every fact against the page built with it: [problems]."""
    import html as H
    miss = []
    for pid, f in facts.get("town", {}).items():
        st, slug = pid.split("/", 1)
        sub = next((d for d in os.listdir(pages_dir) if os.path.isfile(os.path.join(pages_dir, d, slug + ".html"))
                    and K.ROOT and d.replace("-", " ") == f["state"].lower()), None)
        if not sub:
            miss.append(f"{pid}: no page")
            continue
        h = H.unescape(open(os.path.join(pages_dir, sub, slug + ".html"), encoding="utf-8").read())
        want = [f"<h2>{e['name']}</h2>" for e in f["elevators"]] + [f"Cash grain bids in {f['town']}, {f['state_code']} today"]
        for x in f["basis_vs_state"]:
            want.append(f"{x['vs_state_middle']} the {f['state']} middle")
        if f["basis_log_since"]:
            want.append(f"Basis since {f['basis_log_since']}<")
        for c in f["crops"]:
            want.append(f"<td>{c.capitalize()}")
        for w in want:
            if w not in h:
                miss.append(f"{pid}: {w!r}")
                break
    for slug, f in facts.get("company", {}).items():
        p = os.path.join(pages_dir, "company", slug + ".html")
        if not os.path.exists(p):
            miss.append(f"{slug}: no page")
            continue
        h = H.unescape(open(p, encoding="utf-8").read())
        want = [f"posts bids at <b>{f['locations']}</b> location"] + \
               [f"{s['state']} <span class=\"cbt-mut\">{s['locations']} location" for s in f["states"]] + \
               [f">{t}</a>" for s in f["states"] for t in s["some_towns"]] + \
               [f"<th class=\"n\">{c.capitalize()}</th>" for c in f["crops_in_table"]]
        for w in want:
            if w not in h:
                miss.append(f"{slug}: {w!r}")
                break
    return miss


def selftest():
    import tempfile
    fails = []

    def ok(c, msg):
        if not c:
            fails.append(msg)
            print("FAIL", msg, flush=True)
    # facts against real pages: a full build from the network, when one was run with STORY_FACTS_OUT
    fp, pd = os.environ.get("STORY_FACTS"), os.environ.get("STORY_PAGES")
    if fp and pd and os.path.exists(fp):
        facts = json.load(open(fp, encoding="utf-8"))
        miss = check_pages(facts, pd)
        n = len(facts["town"]) + len(facts["company"])
        ok(not miss, f"facts on the real pages: {miss[:6]} ({len(miss)} of {n})")
        print(f"checked {n} town and company pages against their facts")
    f = {"town": "Hubbard", "state": "Iowa", "state_code": "IA", "elevators_in_town": 2, "elevators_within_miles": 1, "near_miles": 10,
         "elevators": [{"name": "Innovative Ag Services", "where": "Hubbard", "near": False},
                       {"name": "Heartland Co-op", "where": "Hubbard", "near": False},
                       {"name": "Landus Cooperative", "where": "Radcliffe, 6 mi from Hubbard", "near": True}],
         "crops": ["corn", "soybeans"],
         "basis_vs_state": [{"crop": "corn", "elevator": "Innovative Ag Services", "vs_state_middle": "even with", "same_futures_month": True},
                            {"crop": "soybeans", "elevator": "Innovative Ag Services", "vs_state_middle": "stronger than", "same_futures_month": True}],
         "basis_log_since": "Aug 27", "as_of": "Oct 17", "as_of_iso": "2026-10-17"}
    T = TOWN
    good = ("As of Oct 17, Innovative Ag Services and Heartland Co-op post corn and soybean bids in Hubbard, and Landus Cooperative bids within 10 miles. "
            "Soybean basis at Innovative Ag Services was stronger than the Iowa middle for the same futures month, and corn basis was even with it.")
    r = K.validate(T, good, f)
    ok(r == [], f"a true town story passes: {r}")
    planted = {
        "a price": good.replace("post corn", "post $4.05 corn"),
        "a basis amount": good.replace("stronger than", "12 cents stronger than"),
        "the wrong way": good.replace("stronger than the Iowa", "weaker than the Iowa"),
        "an elevator not on the page": good.replace("Heartland Co-op", "Smith Grain"),
        "a crop not bid": good.replace("corn and soybean bids", "corn, soybean and wheat bids"),
        "a wrong count": good.replace("Hubbard, and", "Hubbard, 4 elevators in all, and"),
        "today": good.replace("As of Oct 17, ", "As of Oct 17, today ").replace("Innovative Ag Services and", "Innovative Ag Services and"),
        "a best bid": good + " Heartland Co-op has the best bid.",
        "a median": good.replace("the Iowa middle", "the Iowa median"),
        "an owner": good.replace("Heartland Co-op post", "Heartland Co-op, owned by its members, post"),
        "no lead day": good.replace("As of Oct 17, ", ""),
        "a compare the page does not make": good.replace("and corn basis was even with it.", "and wheat basis was weaker.").replace("corn and soybean bids", "corn and soybean bids"),
    }
    for k, s in planted.items():
        ok(K.validate(T, s, f) != [], f"town validator catches {k}: {s}")
    pairs = [
        ("As of Oct 17, the page lists 2 elevators in Hubbard, Innovative Ag Services and Heartland Co-op, plus Landus Cooperative at Radcliffe. They bid corn and soybeans.",
         "As of Oct 17, the page lists 3 elevators in Hubbard, Innovative Ag Services and Heartland Co-op, plus Landus Cooperative at Radcliffe. They bid corn and soybeans."),
        ("As of Oct 17, corn basis at Innovative Ag Services in Hubbard was even with the Iowa middle, and soybean basis was stronger than it. The basis log for the town starts Aug 27.",
         "As of Oct 17, corn basis at Innovative Ag Services in Hubbard was stronger than the Iowa middle, and soybean basis was stronger than it. The basis log for the town starts Aug 27."),
    ]
    K.run_pairs(T, f, pairs, ok)
    c = {"company": "ADM", "short": "ADM", "locations": 107,
         "states": [{"state": "Illinois", "locations": 32, "some_towns": ["Altamont", "Decatur", "East Saint Louis"]},
                    {"state": "Indiana", "locations": 18, "some_towns": ["Attica", "Frankfort"]},
                    {"state": "North Dakota", "locations": 3, "some_towns": ["Center", "Hebron"]}],
         "crops_in_table": ["corn", "soybeans", "wheat"], "site": "adm.gradable.com", "as_of": "Oct 17", "as_of_iso": "2026-10-17"}
    C = COMPANY
    good_c = ("As of Oct 17, the page lists 107 ADM locations in 3 states, with 32 in Illinois and 18 in Indiana. "
              "Towns include Decatur, Attica and Hebron, and the table carries corn, soybeans and wheat.")
    r = K.validate(C, good_c, c)
    ok(r == [], f"a true company story passes: {r}")
    for k, s in {
        "a wrong count": good_c.replace("107", "110"),
        "a count on the wrong state": good_c.replace("32 in Illinois and 18 in Indiana", "18 in Illinois and 32 in Indiana"),
        "a state not listed": good_c.replace("18 in Indiana", "18 in Ohio"),
        "a town not listed": good_c.replace("Hebron", "Peoria"),
        "a crop not carried": good_c.replace("corn, soybeans and wheat", "corn, soybeans and sorghum"),
        "a price": good_c.replace("the table carries", "the table carries $4 corn,"),
        "a size claim": good_c.replace("the page lists", "the biggest buyer, the page lists"),
        "a members claim": good_c + " Its farmer members own it.",
    }.items():
        ok(K.validate(C, s, c) != [], f"company validator catches {k}: {s}")
    K.run_pairs(C, c, [
        ("As of Oct 17, ADM has 107 locations on the page, 32 of them in Illinois, from Altamont to East Saint Louis. North Dakota has 3, at Center and Hebron.",
         "As of Oct 17, ADM has 107 locations on the page, 32 of them in Indiana, from Altamont to East Saint Louis. North Dakota has 3, at Center and Hebron."),
    ], ok)
    # the page: only on a facts match, dropped after 35 days or when an elevator leaves
    with tempfile.TemporaryDirectory() as t:
        bd = {"story": [{"set": "town", "id": "ia/hubbard", "hash": K.facts_hash(f), "facts": f}]}
        res = {"items": {K.cid_of(T, "ia/hubbard"): {"result": "succeeded", "stop_reason": "end_turn", "parsed": {"story": good}}}}
        kept, rej = K.collect(T, bd, res, t)
        ok(kept == 1 and not rej, f"collect keeps the good one {rej}")
        store = K.load(T, t)
        ok(T.story_html(store, "ia/hubbard", f).startswith('<p class="cbt-sub cbt-story">As of Oct 17,'), "the story prints")
        g = dict(f, as_of="Nov 22", as_of_iso="2026-11-22")
        ok(T.story_html(store, "ia/hubbard", g) == "", "36 days on: no story")
        g = dict(f, as_of="Oct 25", as_of_iso="2026-10-25")
        ok(T.story_html(store, "ia/hubbard", g) != "", "a week on, same facts: the dated story still prints")
        g = dict(g, elevators=f["elevators"][:2], elevators_within_miles=0)
        ok(T.story_html(store, "ia/hubbard", g) == "", "an elevator left the page: no story")
        g = json.loads(json.dumps(f))
        g["basis_vs_state"][1]["vs_state_middle"] = "even with"
        ok(T.story_html(store, "ia/hubbard", g) == "", "the basis crossed the state middle: no story")
    for S in (T, C):
        ok("—" not in S.SYSTEM and "price" in S.SYSTEM, f"{S.NAME} prompt: no em dash, says no price")
    print("town and company stories selftest:", "ok" if not fails else f"{len(fails)} failure(s)")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(selftest())
