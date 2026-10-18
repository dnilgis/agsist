#!/usr/bin/env python3
"""stories_atlas.py: the dated lead paragraph on each Farmland Atlas county page
(farmland-atlas/<state>/<county>.html, scripts/build_atlas_pages.py).

FACTS (only what the page prints, as build_atlas_pages.county_page() prints it)
  cash rent (non-irrigated, irrigated, pasture) with its survey year, the
  ten-year rent change, the state median and rank the key tile prints, the
  census value of land and buildings by census year and its change (never on a
  county whose value the page flags "read with care"), the corn yield trend the
  page uses, the last county yield, the five-year average and the median, and
  the share of farmland rented. Nothing about the insurance record, and NO
  buyer, seller or owner name ever: the facts carry none, and the validator
  rejects any capitalised word the facts do not give.

THE PAGE: a kept story prints under the page's first lines only when the county's
facts rebuilt now (plus the stored "as of" day, the page's "Figures as of") hash
to the story's own and it passes check(). It replaces the older written read on
that page (one written paragraph a page). Atlas figures are annual, so a story
has no age limit; any figure that moves takes it off.

  python3 scripts/stories_core.py selftest atlas
  python3 scripts/stories_core.py bundle atlas OUT.json
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import stories_core as K  # noqa: E402

NAME, PREFIX = "atlas", "f"
STORE = os.path.join("data", "atlas-stories")
VOLATILE = ("as_of", "as_of_iso")
MAX_AGE = None


def _A():
    import build_atlas_pages as A
    return A


def _stat(s, fm):
    """The key tile's state line, as key() prints it: '<ST> median $X · 3rd highest of 99'."""
    if not s or s.get("none"):
        return None
    return {"median": fm(s["med"]), "rank": s["words"] or None,
            "median_of_year": s["yr"] if s.get("yr") and s["yr"] != s.get("latest") else None, "counties": s["n"]}


def county_facts(W, f, d):
    A = _A()
    CY = A.CY
    c = W.C[f]
    st = c["state"]
    stn = A.STATE_NAMES.get(st, st)
    R, V, Y = d.get("rent") or {}, d.get("value") or {}, d.get("yield") or {}
    RL = W.rent_latest
    ok, get, money, f1, sgn, pct = A.ok, A.get, A.money, A.f1, A.sgn, A.pct
    rv = R.get("nonirr") if ok(R) else None
    ri = R.get("irr")
    out = {"county": W.label[f], "state": stn, "state_code": st, "rent": None, "rent_change": None, "irrigated_rent": None,
           "pasture_rent": None, "land_value": None, "land_value_note": None, "corn": None, "rented_share_2022": None}

    def stat(key, fm):
        s = W.stat(key, st, f)
        if s and not s.get("none"):
            s["latest"] = RL
        return _stat(s, fm)
    if rv:
        out["rent"] = {"per_acre": money(rv["value"]), "year": rv["year"], "state": stat("rent", money)}
        x = R.get("nonirr_change10")
        if x and x.get("pct") is not None:
            t = sgn(x["pct"], 1)
            out["rent_change"] = {"pct": t.lstrip("+−") + "%", "dir": "up" if t.startswith("+") else ("down" if t.startswith("−") else "same"),
                                  "from_year": x["from_year"], "to_year": x["to_year"],
                                  "from": money(x["from"]) if x.get("from") is not None else None,
                                  "to": money(x["to"]) if x.get("to") is not None else None}
    if ri:
        out["irrigated_rent"] = {"per_acre": money(ri["value"]), "year": ri["year"], "state": stat("irr", money)}
    p = R.get("pasture") if ok(R) else None
    if p and (not RL or p["year"] >= RL - 3):
        out["pasture_rent"] = {"per_acre": money(p["value"]), "year": p["year"]}
    if ok(V) and V.get("latest") is not None:
        if V.get("flag"):
            out["land_value_note"] = "the census land value here is flagged on the page to read with care; it is not given"
        else:
            vs = {int(k): v for k, v in (V.get("values") or {}).items() if v and v.get("per_acre") is not None}
            lv = {"per_acre": money(V["latest"]), "census_year": V["latest_year"],
                  "earlier_census": {str(y): money(vs[y]["per_acre"]) for y in sorted(vs) if y != V["latest_year"]},
                  "change": None, "state": stat("value", money),
                  "means": "operators' own estimate of land and buildings in the Census of Agriculture, not a sale price"}
            x = V.get("change")
            if x and x.get("pct") is not None:
                t, ty = sgn(x["pct"], 1), sgn(x["cagr_pct"], 1)
                lv["change"] = {"pct": t.lstrip("+−") + "%", "dir": "up" if t.startswith("+") else ("down" if t.startswith("−") else "same"),
                                "from_year": x["from_year"], "to_year": x["to_year"], "per_year": ty.lstrip("+−") + "% a year"}
            out["land_value"] = lv
    yt = W.ytrend.get(f) or {}
    ytv = yt.get("v")
    corn = {}
    if ytv is not None:
        corn["trend"] = {"bu_ac": f1(ytv), "label": CY.label_trend(yt["ty"]), "practice": CY.PRACTICE_WORDS.get(yt.get("b"), ""),
                         "state": stat("trend", f1)}
    if ok(Y):
        if Y.get("hist") and not CY.ends_early(Y.get("last_year"), RL):
            ly = (Y.get("hist") or {}).get(str(Y["last_year"]), (Y.get("hist") or {}).get(Y["last_year"]))
            if ly is not None:
                corn["last_year"] = {"year": int(Y["last_year"]), "bu_ac": f1(ly)}
        ry5 = A.recent_yield(Y, RL)
        if ry5:
            corn["recent_average"] = {"label": CY.label_avg(ry5["from"], ry5["to"]), "bu_ac": f1(ry5["avg"]), "from": ry5["from"], "to": ry5["to"]}
        if Y.get("median") is not None:
            corn["median"] = {"from": Y["first_year"], "to": Y["last_year"], "bu_ac": f1(Y["median"]), "years": Y["n"]}
    out["corn"] = corn or None
    rs = W.ten_share(f, "2022")
    if rs is not None:
        out["rented_share_2022"] = pct(rs, 0)
    return out


def _world():
    A = _A()
    return A, A.World(K.ROOT)


def facts_all():
    A, W = _world()
    try:
        stamps = json.load(open(os.path.join(K.ROOT, A.OUT, "data", "page-stamps.json"), encoding="utf-8"))
    except (OSError, ValueError):
        stamps = {}
    out = []
    for f in sorted(W.C):
        p = os.path.join(K.ROOT, A.DATA, "counties", f + ".json")
        try:
            d = json.load(open(p, encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if d.get("generated") != W.generated:
            continue
        fx = county_facts(W, f, d)
        if not (fx["rent"] or fx["land_value"] or fx["corn"]):
            continue      # a thin page (noindex): nothing to tell
        day = (stamps.get(f) or [None, W.built])[1]
        fx.update(as_of=K.short_date(day), as_of_iso=day)
        out.append((f"{W.C[f]['state']}:{f}", fx))
    return out


def path_of(pid):
    st, f = pid.split(":")
    return st.lower(), f


YEAR_RX = r"\b(?:19|20)\d\d\b"


def spec(f):
    masks, claims, dirs, years = [], [], [], {2022}
    names = set()
    for x in (f["county"], f["state"]):
        names |= set(re.findall(r"[A-Za-z'’]+", x))
    names |= {f["state_code"], "Census", "Agriculture", "Farmland", "Atlas"}
    Y = lambda y: {"year": str(y)}  # noqa: E731

    def state_line(s, tag, kw, mine, fm_kind):
        if not s:
            return
        claims.append(K.claim(fm_kind, s["median"], kw=r"median|middle|state|" + re.escape(f["state"])))
        claims.append(K.claim("int", s["counties"], kw=r"counties|count"))
        if s.get("median_of_year"):
            years.add(s["median_of_year"])
        if s.get("rank"):
            masks.append((r"(?i)\b(?:the\s+)?" + re.escape(s["rank"]).replace(r"\ ", r"\s+") + r"(?:\s+counties)?\b", f"RANK{tag}"))
        try:
            a, b = float(K.canon(mine)), float(K.canon(s["median"]))
            dirs.append({"kw": r"median|middle|state|RANK" + tag, "dir": "up" if a > b else ("down" if a < b else "same"), "about": kw})
        except ValueError:
            pass
    r = f.get("rent")
    if r:
        claims.append(K.claim("money", r["per_acre"], kw=r"\brent", opt=Y(r["year"])))
        years.add(r["year"])
        state_line(r.get("state"), "RENT", "rent", r["per_acre"], "money")
    rc = f.get("rent_change")
    if rc:
        claims.append(K.claim("pct", rc["pct"], kw=r"\brent|\bup\b|\bdown\b|rose|fell|climbed|dropped|change"))
        for k, y in (("from", rc["from_year"]), ("to", rc["to_year"])):
            if rc.get(k):
                claims.append(K.claim("money", rc[k], kw=r"\brent", opt=Y(y)))
        years |= {rc["from_year"], rc["to_year"]}
        dirs.append({"kw": r"\brent", "dir": rc["dir"]})
    ir = f.get("irrigated_rent")
    if ir:
        claims.append(K.claim("money", ir["per_acre"], kw=r"irrigated", opt=Y(ir["year"])))
        years.add(ir["year"])
        state_line(ir.get("state"), "IRR", "irrigated", ir["per_acre"], "money")
    pr = f.get("pasture_rent")
    if pr:
        claims.append(K.claim("money", pr["per_acre"], kw=r"pasture", opt=Y(pr["year"])))
        years.add(pr["year"])
    lv = f.get("land_value")
    if lv:
        LK = r"land|census|buildings|value"
        claims.append(K.claim("money", lv["per_acre"], kw=LK, opt=Y(lv["census_year"])))
        years.add(lv["census_year"])
        for y, v in lv["earlier_census"].items():
            claims.append(K.claim("money", v, kw=LK, opt=Y(y)))
            years.add(int(y))
        ch = lv.get("change")
        if ch:
            claims.append(K.claim("pct", ch["pct"], kw=LK + r"|\bup\b|\bdown\b|rose|fell"))
            claims.append(K.claim("pct", ch["per_year"].split("%")[0], kw=r"a year|per year|each year|yearly"))
            years |= {ch["from_year"], ch["to_year"]}
            dirs.append({"kw": LK, "dir": ch["dir"]})
        state_line(lv.get("state"), "VALUE", "land", lv["per_acre"], "money")
    co = f.get("corn") or {}
    CK = r"corn|yield|bushel|\bbu\b"
    if co.get("trend"):
        t = co["trend"]
        claims.append(K.claim("bu", t["bu_ac"], kw=CK + r"|trend"))
        claims.append(K.claim("int", t["bu_ac"], kw=r"trend"))
        m = re.match(r"(\d+)-yr trend \(projected (\d{4})\)", t["label"])
        if m:
            claims.append(K.claim("int", m.group(1), kw=r"trend"))
            years.add(int(m.group(2)))
            masks.append((r"\b" + m.group(1) + r"-(?:yr|year)\b", "NYEAR"))
        if t.get("state"):
            s = t["state"]
            claims.append(K.claim("bu", s["median"], kw=r"median|middle|state"))
            claims.append(K.claim("int", s["median"], kw=r"median|middle|state"))
            claims.append(K.claim("int", s["counties"], kw=r"counties"))
            if s.get("rank"):
                masks.append((r"(?i)\b(?:the\s+)?" + re.escape(s["rank"]).replace(r"\ ", r"\s+") + r"(?:\s+counties)?\b", "RANKCORN"))
            try:
                a, b = float(t["bu_ac"]), float(s["median"])
                dirs.append({"kw": r"median|middle|state|RANKCORN", "dir": "up" if a > b else ("down" if a < b else "same")})
            except ValueError:
                pass
    if co.get("last_year"):
        claims.append(K.claim("bu", co["last_year"]["bu_ac"], kw=CK, opt=Y(co["last_year"]["year"])))
        claims.append(K.claim("int", co["last_year"]["bu_ac"], kw=CK, opt=Y(co["last_year"]["year"])))
        years.add(co["last_year"]["year"])
    if co.get("recent_average"):
        ra = co["recent_average"]
        claims.append(K.claim("bu", ra["bu_ac"], kw=r"average"))
        claims.append(K.claim("int", ra["bu_ac"], kw=r"average"))
        years |= {ra["from"], ra["to"]}
        masks.append((r"\b" + str(ra["from"]) + r"-" + str(ra["to"])[-2:] + r"\b", str(ra["from"]) + " to " + str(ra["to"])))
    if co.get("median"):
        md = co["median"]
        claims.append(K.claim("bu", md["bu_ac"], kw=r"median"))
        claims.append(K.claim("int", md["bu_ac"], kw=r"median"))
        claims.append(K.claim("int", md["years"], kw=r"years"))
        years |= {md["from"], md["to"]}
    if f.get("rented_share_2022"):
        claims.append(K.claim("pct", f["rented_share_2022"], kw=r"rented|rent", opt=Y(2022)))
    return {"lead": f["as_of"], "masks": masks, "claims": claims, "years": years, "dates": {f["as_of"]}, "names": names,
            "classes": {"year": YEAR_RX}, "banned": BANNED, "unban": ["average"], "supers": [], "dirs": dirs, "chars": (120, 650)}


BANNED = ["buyer", "buyers", "seller", "sellers", "sold", "sale", "sales", "selling", "buy", "buying", "bought", "auction",
          "auctions", "investor", "investors", "investment", "appraisal", "appraised", "owner", "owners", "owned", "family",
          "families", "price", "prices", "priced", "market", "markets", "hot", "cheap", "expensive", "affordable",
          "bargain", "profit", "return", "returns", "appreciation", "boom", "you", "your", "should", "worth", "estate",
          "spring", "summer", "fall", "autumn", "winter", "weather", "storm", "storms", "drought"]


def extra(s, m, f):
    bad = []
    if f.get("land_value_note") and re.search(r"land value|census value|land and buildings", s, re.I):
        bad.append("speaks of a land value the page flags to read with care")
    if not f.get("land_value") and re.search(r"land and buildings|census value|land value", s, re.I):
        bad.append("a land value the facts do not give")
    # a rent with no year beside it in its sentence reads as this year's: it must be the rent's own year then
    return bad


SYSTEM = """You write the opening paragraph for one county page in the Farmland Atlas on agsist.com, a free farm website run by Sig Lindquist, a Certified Crop Adviser. The page is the county's public farmland record: USDA NASS cash rent, the Census of Agriculture value of land and buildings, county corn yields and how much farmland is rented. Your paragraph sits under the page's opening lines and tells what this county's record shows, in a few plain sentences.

You get the facts the page already shows, as JSON. Use only those facts. The page prints every number below, and a reader will check your words against it.

Write:
- 2 to 4 sentences, 120 to 600 characters, one paragraph, plain text.
- In Sig's voice: plain farm words, short sentences, a little dry. The way a neighbor would say it, not a real estate ad.
- Start with "As of {as_of}," naming the day exactly as the facts give it.
- Pick the two or three facts that tell this county best: the rent and how it moved over ten years, the census value and how it moved, the corn yield trend, how the county sits against the state median. Do not list them all.
- Give every rent and value with its year. A state rank only in the exact words the facts give (for example "3rd highest of 99"), next to what it ranks.
- Numbers exactly as the facts print them, in digits: dollars with a $ and no cents unless given, percents with a %, yields in bu.
- The census value is what operators estimated their land and buildings were worth, not a sale price; call it the census value of land and buildings.

Do not:
- name any person, farm, buyer, seller, owner, company or sale. There are none in the facts and there must be none in the paragraph.
- talk about land prices, the market, buying, selling, investing or what land will do. No advice, no "you".
- add anything the facts do not say: no causes, no weather, no rankings beyond the ones given, no forecast.
- use number words (two, half, most), em dashes, dashes, semicolons, parentheses, slashes, exclamation marks, questions or quotes.
- sound like a machine: no "notably", "remarkable", "boasts", no wrap-up line.

Answer with one JSON object in a ```json fenced block and nothing after it:
{"story": "<the paragraph>"}"""

USER = """Facts for {county}, {state} (Farmland Atlas, figures as of {as_of}):
{facts}"""


def prompt(f):
    shown = {k: v for k, v in f.items() if k not in ("as_of_iso",) and v is not None}
    return USER.format(county=f["county"], state=f["state"], as_of=f["as_of"],
                       facts=json.dumps(shown, ensure_ascii=False, separators=(", ", ": ")))


def story_html(store, W, f, d):
    """The <p> for county_page(), or ''."""
    S = sys.modules[__name__]
    e = K.lookup(store, S, f"{W.C[f]['state']}:{f}")
    if not e:
        return ""
    s = K.story_for(S, e, county_facts(W, f, d), W.built)
    import html
    return f'<p class="sub ap-story">{html.escape(s, quote=False)}</p>\n' if s else ""


def selftest():
    import tempfile
    fails = []

    def ok(c, msg):
        if not c:
            fails.append(msg)
            print("FAIL", msg, flush=True)
    S = sys.modules[__name__]
    A, W = _world()
    rows = dict(facts_all())
    ok(len(rows) > 2500, f"facts for the county pages ({len(rows)})")
    # facts against the real pages: every figure is printed on that county's page
    miss = []
    for pid, f in rows.items():
        st, fips = pid.split(":")
        p = os.path.join(K.ROOT, W.path(fips))
        if not os.path.exists(p):
            miss.append(f"{pid}: no page")
            continue
        h = open(p, encoding="utf-8").read().replace("&#x27;", "'")
        want = []
        if f["rent"]:
            want.append(f"Non-irrigated, {f['rent']['year']}</span><span class=\"r\">{f['rent']['per_acre']}/ac")
            s_ = f["rent"]["state"]
            if s_:
                want.append(f"{f['state_code']} median" + (f" of {s_['median_of_year']} surveys" if s_["median_of_year"] else "") + f" {s_['median']}"
                            + (f" · {s_['rank']}" if s_["rank"] else ""))
        if f["rent_change"]:
            rc = f["rent_change"]
            want.append(f"Change {rc['from_year']} to {rc['to_year']}")
        if f["land_value"]:
            lv = f["land_value"]
            want.append(f"Land and buildings, {lv['census_year']}</span><span class=\"r\">{lv['per_acre']}/ac")
            for y, v in lv["earlier_census"].items():
                want.append(f"Census {y}</span><span class=\"r\">{v}/ac")
            if lv["change"]:
                want.append(f"{lv['change']['per_year']}, nominal")
        co = f["corn"] or {}
        if co.get("trend"):
            want.append(f"{co['trend']['bu_ac']}<small> bu/ac</small>")
        if co.get("median"):
            want.append(f"Median, {co['median']['from']}–{co['median']['to']}</span><span class=\"r\">{co['median']['bu_ac']} bu/ac")
        if co.get("recent_average"):
            want.append(f"{co['recent_average']['label'].capitalize()}</span><span class=\"r\">{co['recent_average']['bu_ac']} bu/ac")
        if f["rented_share_2022"]:
            want.append(f"{f['rented_share_2022']}</div>")
        want.append(f"Figures as of {f['as_of_iso']}")
        for w in want:
            if w not in h:
                miss.append(f"{pid}: {w!r}")
                break
    ok(len(miss) <= len(rows) // 200, f"facts on the real pages: {miss[:6]} ({len(miss)} of {len(rows)})")
    sc = rows["IA:19169"]
    ok(sc["rent"]["per_acre"] == "$290" and sc["rent"]["year"] == 2026 and sc["rent_change"]["pct"] == "26.1%" and sc["rent_change"]["dir"] == "up"
       and sc["land_value"]["per_acre"] == "$10,914" and sc["land_value"]["census_year"] == 2022, f"Story County, Iowa, as the page prints it: {sc['rent']} {sc['land_value']}")
    f = json.loads(json.dumps(sc))
    f.update(as_of="Oct 16", as_of_iso="2026-10-16")
    lv, rs = f["land_value"], f["rent"]["state"]
    good = (f"As of Oct 16, non-irrigated cash rent in Story County was $290 an acre in 2026, up 26.1% from $230 in 2016. "
            f"The census value of land and buildings was $10,914 an acre in 2022, up 15.3% from $9,467 in 2017.")
    r = K.validate(S, good, f)
    ok(r == [], f"a true Atlas story passes: {r}")
    planted = {
        "a wrong rent": good.replace("$290", "$295"),
        "the wrong way": good.replace("up 26.1%", "down 26.1%"),
        "a rent on the wrong year": good.replace("$290 an acre in 2026", "$290 an acre in 2016").replace("from $230 in 2016", "from $230 in 2026"),
        "a land value on the rent": good.replace("rent in Story County was $290", "rent in Story County was $10,914"),
        "a buyer name": good + " Smith Farms bought land nearby.",
        "a sale": good.replace("The census value", "A sale put the census value"),
        "a price word": good.replace("The census value of land and buildings", "The land price"),
        "a forecast": good + " Values will keep climbing.",
        "a rank not given": good.replace("in 2016.", "in 2016, the highest in Iowa."),
        "a year not in the facts": good.replace("in 2017", "in 2012").replace("$9,467", "$9,999"),
        "advice": good + " You should rent now.",
        "an em dash": good.replace(". The census", " — the census"),
        "no lead day": good.replace("As of Oct 16, n", "N"),
    }
    for k, s in planted.items():
        ok(K.validate(S, s, f) != [], f"Atlas validator catches {k}: {s}")
    pairs = []
    if rs and rs.get("rank"):
        pairs.append((f"As of Oct 16, Story County rent was $290 an acre in 2026, against an Iowa median of {rs['median']}. That is {rs['rank']} counties in the state.",
                      f"As of Oct 16, Story County rent was $290 an acre in 2026, against an Iowa median of {rs['median']}. That is the highest of {rs['counties']} counties in the state."))
    co = f["corn"]
    if co and co.get("trend"):
        t = co["trend"]
        pairs.append((f"As of Oct 16, the corn yield trend the page uses in Story County is {t['bu_ac']} bu an acre, the 14-year trend projected to 2026. "
                      f"Rent ran $290 an acre in 2026.",
                      f"As of Oct 16, the corn yield trend the page uses in Story County is {t['bu_ac']} bu an acre, the 14-year trend projected to 2026. "
                      f"Rent ran $290 an acre in 2025."))
    pairs.append(("As of Oct 16, rent in Story County rose from $230 in 2016 to $290 in 2026. Land and buildings came to $10,914 an acre in the 2022 census.",
                  "As of Oct 16, rent in Story County fell from $230 in 2016 to $290 in 2026. Land and buildings came to $10,914 an acre in the 2022 census."))
    pairs.append(("As of Oct 16, the 2022 census put land and buildings in Story County at $10,914 an acre, 2.9% a year since 2017. In 2026, cash rent was $290.",
                  "As of Oct 16, the 2022 census put land and buildings in Story County at $10,914 an acre, 3.9% a year since 2017. In 2026, cash rent was $290."))
    if f.get("rented_share_2022"):
        pairs.append((f"As of Oct 16, {f['rented_share_2022']} of farmland in Story County was rented from others in the 2022 census. Cash rent was $290 an acre in 2026.",
                      f"As of Oct 16, {f['rented_share_2022']} of farmland in Story County was rented from others in the 2017 census. Cash rent was $290 an acre in 2026."))
    K.run_pairs(S, f, pairs, ok)
    # flagged land value: never spoken of
    g = json.loads(json.dumps(f))
    g["land_value"], g["land_value_note"] = None, "x"
    ok(K.validate(S, "As of Oct 16, cash rent in Story County was $290 an acre in 2026. The land value is a figure to read with care here.", g) != [],
       "a flagged land value is not spoken of")
    # the page: a story prints only on a facts match
    with tempfile.TemporaryDirectory() as t:
        bd = {"story": [{"set": NAME, "id": "IA:19169", "hash": K.facts_hash(f), "facts": f}]}
        res = {"items": {K.cid_of(S, "IA:19169"): {"result": "succeeded", "stop_reason": "end_turn", "parsed": {"story": good}}}}
        kept, rej = K.collect(S, bd, res, t, made="2026-10-16")
        ok(kept == 1 and not rej, f"collect keeps the good one {rej}")
        store = K.load(S, t)
        d = json.load(open(os.path.join(K.ROOT, A.DATA, "counties", "19169.json"), encoding="utf-8"))
        h = story_html(store, W, "19169", d)
        ok(h == f'<p class="sub ap-story">{good}</p>\n', f"the story prints on the page: {h[:80]}")
        W.stories = store
        page = A.county_page(W, "19169", d, "2026-10-16")
        ok(page.count('class="sub ap-story"') == 1 and page.index('class="sub"') < page.index("ap-story") < page.index('class="keys"'),
           "county_page puts it under the first lines")
        ok('<div class="read">' not in page, "the old written read steps aside when a story prints")
        W.stories = {}
        d2 = json.loads(json.dumps(d))
        d2["rent"]["nonirr"]["value"] = 291.0
        W.stories = store
        ok("ap-story" not in A.county_page(W, "19169", d2, "2026-10-16"), "a figure moved: no story")
        W.stories = {}
    p = prompt(f)
    ok("as_of_iso" not in p and "$290" in p and "—" not in SYSTEM, "prompt: the facts, no em dash")
    print("atlas stories selftest:", "ok" if not fails else f"{len(fails)} failure(s)")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(selftest())
