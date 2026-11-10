#!/usr/bin/env python3
"""Company ids for elevator facilities, on evidence only (god's-eye build 3; Sig's decision, Nov 9 2026).

Writes data/ids/companies.json (built by scripts/build_ids.py on every bids run, after board-parents.json; read by
builds only, never by a page). A company id ("c" plus five digits) joins facilities of data/ids/elevators.json that
evidence says one firm runs. Sig, Nov 9: company ids may link facilities ONLY on a shared phone, a shared website or
domain, the board's own parent page, or a dated ownership change; NEVER on a name alone.

EVIDENCE (each link in the file carries its type and value)
  phone       a phone posted on the facility's own board rows in the bids repo (data/directory.json and
              data/index.json). Value: "#" + the first 10 hex of sha256 of the 10 digits, so the file does not
              republish numbers; anyone can hash the bids repo's posted number to check it. A row whose location
              names another buyer ("{Bunge - Emporia}" in its location or row id, or a dest in board-parents.json) gives no phone: it often
              carries the buyer's number.
  website     the website host of those rows, without www, cut to its domain (grain.example.com -> example.com).
              On a host many firms share (basis_method.SHARED_HOSTS: agricharts.com, gradable.com, ...) the
              account is the firm's own subdomain or path (board_parents.account), so
              farmersco-operative.agricharts.com is one firm's page and agricharts.com alone is no evidence. The
              same for a system site with one path per member firm (PATH_ACCOUNT: fscooperatives.com/gatewayfs).
  board-page  board-parents.json rule board-page:<host>: the board is listed on another firm's own cash bid page.
              It links the board's facility with the facilities whose website is that host.
  change      a completed, dated ownership change of kind "parent" in data/ids/ownership-changes.json links the
              facilities it lists (effective on or before the build day; pending, lease and noop rows never link).

WHERE EVIDENCE IS NOT ENOUGH (unsure is blank, never a guess)
  hub         a phone or website shared by facilities of 3 or more different posted names (build_ids.op_key) is
              a buyer's number copied onto its suppliers' boards or a data error (AGP Aberdeen's 605 number sits on
              the AGP Aberdeen boards of AgWrx, Full Circle Ag, Country Pride and CHS Northern Plains). It links nothing and is listed under `held`.
  one phone   a phone shared by facilities of two different posted names links them only when the two names share
              2 or more distinct values, phones or websites (AG Choice and Beachner Grain: 7 phones). One shared
              phone across two names is listed under `held`: the bids repo has numbers copied between firms
              (Prinsburg Farmers Co-op's board placed in Raymond NE with the Dorchester co-op's Raymond number).
              A website is the firm's own page, so one shared website links two posted names ("JSI Site - Farmers
              Cooperative" boards on the Dorchester co-op's page). Same posted name plus one shared phone links.
              The name never links on its own; it only decides how much evidence a phone link needs.
  not used    the CHS brand rule (a board named "CHS <place>") is a name rule, so it links nothing here (it still
              counts companies in basis_method). The Oct 11 elevator directory (data/elevator-directory.json) is
              never read: its rows come from the Barchart feed, which stays private (Sig, Nov 9).
  A facility with no link to another facility has no company id. No company id means no evidence, not one firm.

IDS ARE NEVER REUSED (ledger in the same file, like data/ids/elevator-ids.json)
  A group of linked facilities keeps the id its members held. Two groups that become one keep the older id; the
  other is retired `into` it. A group that splits: the part holding most of the old members (tie: the lowest
  facility id) keeps the id, the rest get new ids. An id whose facilities lost all their links is retired with
  the reason. A retired id is never minted again (`next` only grows). More than RETIRE_MAX ids lost in one run is
  a broken read, not a change: the build stops and the last file stays.

  python3 scripts/company_ids.py --selftest
  python3 scripts/company_ids.py --check     (the committed file: size, ids, facilities)
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import collections
import hashlib
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import basis_method as BM  # noqa: E402
import board_parents  # noqa: E402

SCHEMA = "agsist-companies/1"
HUB_NAMES = 3       # a value on this many different posted names links nothing
PAIR_MIN = 2        # distinct shared values two different posted names need before a phone links them
RETIRE_MAX = 25     # more company ids lost in one run than this: a broken read, the last file stays
# system sites that host each member firm under its own path (fscooperatives.com/gatewayfs/ is Gateway FS's page,
# fscooperatives.com/aglandfs/ is AGLand FS's): the account is the first path part, the bare host is no evidence
PATH_ACCOUNT = {"fscooperatives.com": r"^/([^/?#]+)"}
TYPES = ("phone", "website", "board-page", "change")


def name_key(company):
    """The posted name, as the ids builder keys it (build_ids.op_key: legal words, co-op spellings and trade words
    out). Used only to decide how much evidence a link needs, never to link."""
    import build_ids
    from elevator_names import display_name
    c = display_name(company or "") or company or ""
    return build_ids.op_key(c) or re.sub(r"[^a-z0-9]", "", c.lower())


def phone_digits(p):
    d = re.sub(r"\D", "", str(p or ""))
    if len(d) == 11 and d[0] == "1":
        d = d[1:]
    return d if len(d) == 10 and d[0] not in "01" else ""


def phone_value(p):
    d = phone_digits(p)
    return "#" + hashlib.sha256(d.encode()).hexdigest()[:10] if d else ""


def site_value(url):
    """The firm's own website: a platform account (board_parents.account) or the host cut to its domain."""
    a = board_parents.account(url)
    if not a or "/" in a:
        return a
    parts = a.split(".")
    dom = ".".join(parts[-2:]) if len(parts) > 2 else a
    if dom in PATH_ACCOUNT:
        from urllib.parse import urlparse
        m = re.search(PATH_ACCOUNT[dom], urlparse(url).path or "")
        return f"{dom}/{m.group(1).lower()}" if m else ""
    if dom in BM.SHARED_HOSTS:
        return a          # a firm's subdomain on a shared platform: the account, not the platform
    return dom


def gather(directory, index, recs, parents, changes, today):
    """Evidence values -> facilities. Returns ({(type, value): set(fids)}, notes)."""
    fac = {r["id"]: r for r in recs}
    src = {s.get("id"): s for s in (index or {}).get("sources") or [] if s.get("id")}
    ev = collections.defaultdict(set)
    notes = collections.Counter()
    host_of = collections.defaultdict(set)
    for row in (directory or {}).get("elevators") or []:
        fid = row.get("elevId")
        if fid not in fac:
            continue
        s = src.get(row.get("id")) or {}
        # a row posted under another firm's name sits on this facility (a co-op bidding at a plant): not its evidence
        if name_key(row.get("operator") or s.get("operator")) != name_key(fac[fid].get("company")):
            notes["rows_other_name"] += 1
            continue
        for w in (row.get("website"), s.get("website")):
            v = site_value(w)
            if v:
                ev[("website", v)].add(fid)
                host_of[board_parents.account(w)].add(fid)
        dest = bool(re.search(r"[{}]", (row.get("location") or "") + (row.get("id") or ""))) or bool((parents.get(row.get("id")) or {}).get("dest"))
        for p in (row.get("phone"), s.get("phone")):
            v = phone_value(p)
            if v and dest:
                notes["dest_phones_skipped"] += 1
            elif v:
                ev[("phone", v)].add(fid)
    for bid, e in sorted(parents.items()):
        pv = e.get("pv") or ""
        if pv.startswith("board-page:") and e.get("elevId") in fac:
            host = pv.split(":", 1)[1]
            own = host_of.get(host) or set()
            if own:
                ev[("board-page", host)].update(own | {e["elevId"]})
        elif pv == "chs-brand":
            notes["chs_brand_boards"] += 1
    for e in (changes or {}).get("events") or []:
        if e.get("noop") or e.get("kind") != "parent" or not e.get("effective") or e["effective"] > today:
            continue
        fs = {f for f in e.get("facilities") or [] if f in fac}
        if len(fs) >= 2:
            ev[("change", e["id"])].update(fs)
    return ev, notes


def link(ev, recs):
    """Union the facilities the evidence links under the rules above. Returns (components, used, held)."""
    key = {r["id"]: name_key(r.get("company")) for r in recs}
    parent = {}

    def find(x):
        while parent.setdefault(x, x) != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[max(ra, rb)] = min(ra, rb)

    # how many distinct phone/website values each pair of posted names shares (hubs left out)
    pair = collections.Counter()
    hub = set()
    for (t, v), fs in ev.items():
        if t not in ("phone", "website"):
            continue
        names = sorted({key[f] for f in fs})
        if len(names) >= HUB_NAMES:
            hub.add((t, v))
            continue
        if len(names) == 2:
            pair[tuple(names)] += 1
    used, held = {}, []
    for (t, v), fs in sorted(ev.items()):
        if len(fs) < 2:
            continue
        if t in ("board-page", "change"):
            fl = sorted(fs)
            for f in fl[1:]:
                union(fl[0], f)
            used[(t, v)] = set(fs)
            continue
        if (t, v) in hub:
            held.append([t, v, sorted(fs), f"hub: {len({key[f] for f in fs})} posted names"])
            continue
        by = collections.defaultdict(list)
        for f in fs:
            by[key[f]].append(f)
        names = sorted(by)
        linked = set()
        for n in names:
            if len(by[n]) >= 2:
                for f in by[n][1:]:
                    union(by[n][0], f)
                linked.update(by[n])
        if len(names) == 2:
            if t == "website" or pair[tuple(names)] >= PAIR_MIN:
                union(by[names[0]][0], by[names[1]][0])
                linked.update(fs)
            else:
                held.append([t, v, sorted(fs), "one shared phone between two posted names"])
        if len(linked) >= 2:
            used[(t, v)] = linked
    comps = collections.defaultdict(set)
    for f in list(parent):
        comps[find(f)].add(f)
    return [c for c in comps.values() if len(c) >= 2], used, held


def assign(comps, prev, today):
    """Company ids for the groups, from the last file's ledger; never reused. Returns ({cid: set}, ledger, retired)."""
    led = (prev or {}).get("ledger") or {}
    ledger = {"next": int(led.get("next") or 1), "minted": dict(led.get("minted") or {}),
              "retired": dict(led.get("retired") or {}), "events": list(led.get("events") or [])}
    old = {cid: set(c.get("facilities") or []) for cid, c in ((prev or {}).get("companies") or {}).items()}
    held_by = {f: cid for cid, fs in old.items() for f in fs}
    comps = sorted((set(c) for c in comps), key=lambda c: min(c))
    # each old id goes to the group holding most of its members (tie: the group with the lowest facility id)
    claim = collections.defaultdict(list)
    for cid, fs in sorted(old.items()):
        best = None
        for i, c in enumerate(comps):
            n = len(fs & c)
            if n and (best is None or n > best[0]):
                best = (n, i)
        if best:
            claim[best[1]].append(cid)
    out, lost = {}, []
    for i, c in enumerate(comps):
        cids = sorted(claim.get(i) or [], key=lambda x: int(x[1:]))
        if cids:
            keep = cids[0]
            for gone in cids[1:]:
                ledger["retired"][gone] = {"date": today, "into": keep}
                ledger["events"].append({"date": today, "merge": gone, "into": keep})
        else:
            keep = f"c{ledger['next']:05d}"
            ledger["next"] += 1
            ledger["minted"][keep] = {"date": today, "first": min(c)}
            came = sorted({held_by[f] for f in c if f in held_by})
            if came:
                ledger["events"].append({"date": today, "split": came, "new": keep})
        out[keep] = c
    for cid in sorted(old):
        if cid not in out and cid not in ledger["retired"]:
            lost.append(cid)
            ledger["retired"][cid] = {"date": today, "why": "no evidence links its facilities any more"}
            ledger["events"].append({"date": today, "retired": cid})
    return out, ledger, lost


def build(directory, index, recs, parents_doc, changes, prev, today, resolve=None):
    """resolve (build_ids.id_resolver): the change log's facility ids follow id merges to the live record."""
    if resolve is not None:
        import build_ids
        changes = build_ids.follow_changes(changes, resolve)
    parents = (parents_doc or {}).get("boards") or {}
    ev, notes = gather(directory, index, recs, parents, changes, today)
    comps, used, held = link(ev, recs)
    groups, ledger, lost = assign(comps, prev, today)
    if prev and len(lost) > RETIRE_MAX:
        raise SystemExit(f"[companies] {len(lost)} company ids lost in one run (limit {RETIRE_MAX}): a broken read; "
                         "the last file stays")
    fac = {r["id"]: r for r in recs}
    of = {f: cid for cid, fs in groups.items() for f in fs}
    companies = {}
    for cid in sorted(groups, key=lambda x: int(x[1:])):
        fs = groups[cid]
        names = collections.Counter(fac[f].get("company") or "" for f in fs)
        top = max(names.values())
        companies[cid] = {"name": sorted(n for n, k in names.items() if k == top)[0], "n": len(fs),
                          "facilities": sorted(fs), "links": []}
    by_type = collections.Counter()
    for (t, v), fs in sorted(used.items()):
        # one value can link two separate groups (two posted names on one page, each linked within itself)
        part = collections.defaultdict(set)
        for f in fs:
            part[of[f]].add(f)
        for cid, sub in sorted(part.items()):
            if len(sub) < 2:
                continue
            # a link that covers the whole company leaves its facility list out (the company's own list)
            companies[cid]["links"].append([t, v] if sub == groups[cid] else [t, v, sorted(sub)])
            by_type[t] += 1
    counts = {"facilities": len(recs), "facilities_with_company": len(of), "companies": len(companies),
              "links_by_type": {t: by_type.get(t, 0) for t in TYPES},
              "held": len(held), "held_hub": sum(1 for h in held if h[3].startswith("hub")),
              "chs_brand_boards_not_linked_by_brand": notes.get("chs_brand_boards", 0),
              "dest_phones_skipped": notes.get("dest_phones_skipped", 0),
              "rows_other_name_skipped": notes.get("rows_other_name", 0),
              "ids_minted_ever": ledger["next"] - 1, "ids_retired_ever": len(ledger["retired"])}
    return {"schema": SCHEMA, "generated": today,
            "note": ("Company ids for elevator facilities (data/ids/elevators.json), on evidence only (Sig, Nov 9 2026): "
                     "a shared phone, a shared website or domain, the board's own parent page (board-parents.json "
                     "board-page) or a dated ownership change (ownership-changes.json), never a name alone. links: "
                     "[type, value, facilities], facilities left out when the link covers the whole company; a phone value is # plus the first 10 hex of sha256 of its 10 digits. "
                     "held: shared values that link nothing (a hub on 3+ posted names, or one phone between two "
                     "posted names). A facility with no company id has no evidence linking it, which does not mean "
                     "it is its own firm. Company names are the facilities' posted names. Ids are never reused: "
                     "ledger.retired lists every id gone (into = merged into that id). Rules: scripts/company_ids.py."),
            "counts": counts, "companies": companies, "held": held, "ledger": ledger}


def write(path, doc):
    """One company, one held value, per line: small, and a diff shows which company changed."""
    def line(v):
        return json.dumps(v, ensure_ascii=False, separators=(",", ":"))
    parts = []
    for k, v in doc.items():
        if k == "companies":
            parts.append('"companies": {\n' + ",\n".join(f"{line(c)}:{line(x)}" for c, x in v.items()) + "\n}")
        elif k == "held":
            parts.append('"held": [\n' + ",\n".join(line(x) for x in v) + "\n]")
        else:
            parts.append(f"{line(k)}: {line(v)}")
    with open(path, "w", encoding="utf-8") as f:
        f.write("{\n" + ",\n".join(parts) + "\n}\n")


def load(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


# ------------------------------------------------------------------ selftest
def selftest():
    fails = []

    def ck(name, ok):
        print(("ok   " if ok else "FAIL ") + name)
        if not ok:
            fails.append(name)

    # REAL ROWS, copied as posted: dnilgis/bids data/directory.json and data/index.json (clone 85675f1, Nov 6 2026),
    # agsist data/ids/elevators.json, board-parents.json and ownership-changes.json (main, Nov 9 2026). Phones are the
    # boards' posted business numbers. Each tuple: elevId, row id, operator, location, website, directory phone,
    # index phone. The facility's company is its posted operator (as in elevators.json).
    agp = "https://farmersco-operative.agricharts.com/markets/cashgrid.php"
    own = "https://www.farmersco-operative.com/"
    pce = "https://pce-coops.agricharts.com/markets/cashgrid.php?basis=1"
    alc = "https://alciviacoop.agricharts.com/"
    rows = [
        # Farmers Cooperative Dorchester (45 facilities posted under this spelling; 4 here)
        ("ejmjz841bd", "farmerscooperative-dorchester", "Farmers Cooperative Dorchester", "DORCHESTER", agp, "402-946-2211", "14029462211"),
        ("ea431amncr", "farmerscooperative-marietta", "Farmers Cooperative Dorchester", "MARIETTA", agp, "402-946-2211", "14029462211"),
        ("ezgsht4rp8", "farmerscooperative-raymond", "Farmers Cooperative Dorchester", "RAYMOND", agp, None, "14027832321"),
        ("ej6psryg26", "farmerscooperative-bungeemporia", "Farmers Cooperative Dorchester", "{BUNGE - EMPORIA}", agp, None, "18008352562"),
        # the same page posts 3 boards as "JSI Site - Farmers Cooperative"
        ("eq4ymamdng", "farmerscooperative-reynolds", "JSI Site - Farmers Cooperative", "REYNOLDS", agp, None, None),
        ("e6jj2wjrkv", "farmerscooperative-agphastings", "JSI Site - Farmers Cooperative", "{AGP - Hastings}", agp, None, "14029462211"),
        # "Farmers Coop of Dorchester" (5): two known rows, three down boards on the co-op's own domain
        ("ex2mg8pevs", "known:Farmers Coop of Dorchester|{BUNGE - EMPORIA}|EMPORIA|KS", "Farmers Coop of Dorchester", "EMPORIA", None, "800-835-2562", None),
        ("e2f4jaqmm3", "known:Farmers Coop of Dorchester|{AGP - DAVID CITY}|DAVID CITY|NE", "Farmers Coop of Dorchester", "DAVID CITY", None, "N/A", None),
        ("epcpx5fbbm", "farmerscooperative-diller", "Farmers Coop of Dorchester", "Diller", own, None, "14027935321"),
        ("eq9ky4q66b", "farmerscooperative-humboldt", "Farmers Coop of Dorchester", "Humboldt", own, None, "14028622932"),
        ("esjd8ranbh", "farmerscooperative-princeton", "Farmers Coop of Dorchester", "Princeton", own, None, "14027987340"),
        # Bunge's own Emporia board; Prinsburg's board listed in Raymond NE with the Dorchester Raymond number
        ("e162h10t8q", "bunge-emporia-ks", "Bunge", "Emporia", "https://www.bungeag.com/", None, "8008352562"),
        ("ee112y1sgb", "prccoop-raymond", "Prinsburg Farmers Co-op", "RAYMOND", "https://prccoop.com/", None, "14027832321"),
        # CHS-branded units, each firm on its own site
        ("eq3apvczgp", "chsherman-herman", "CHS Herman", "Herman", "https://www.chs-herman.com/grain/cash-bids/", None, None),
        ("eaz2es8agf", "chsherman-morris", "CHS Herman", "Morris", "https://www.chs-herman.com/grain/cash-bids/", None, None),
        ("e92b3gfqp1", "chsdakotaplainsag-edgeley", "CHS Dakota Plains Ag", "Edgeley", "https://www.chsdakotaplainsag.com/grain/cash-bids/", None, None),
        ("e4x5y1gaeh", "chsdakotaplainsag-galchutt", "CHS Dakota Plains Ag", "Galchutt", "https://www.chsdakotaplainsag.com/grain/cash-bids/", None, None),
        # AG Choice and Beachner Grain known rows in the same two towns, sharing both numbers
        ("ejcnemhr97", "known:AG Choice|Altamont|Altamont|KS", "AG Choice", "Altamont", None, "620-784-2366", None),
        ("eekbexq7wz", "known:AG Choice|Parsons|Parsons|KS", "AG Choice", "Parsons", None, "620-421-1170", None),
        ("etfre8es78", "known:Beachner Grain|Altamont|Altamont|KS", "Beachner Grain", "Altamont", None, "620-784-2366", None),
        ("ewb2v1k72s", "known:Beachner Grain|Parsons|Parsons|KS", "Beachner Grain", "Parsons", None, "620-421-1170", None),
        # Heartland Co-op and Landus, both in Mitchellville IA with one number
        ("en2k2ctf78", "heartlandcoop-mitchellville", "Heartland Co-op", "Mitchellville", "https://www.heartlandcoop.com/", None, "515.967.4288"),
        ("efx2gvsbyc", "landus-mitchellville", "Landus Cooperative", "Mitchellville", "https://www.landus.ag/", None, "(515) 967-4288"),
        # AGP Aberdeen's number on four firms' AGP Aberdeen boards
        ("e8zct696td", "agwrx-agpaberdeen", "AgWrx Coop", "Agp Aberdeen", "https://agwrx.agricharts.com/", None, "16056269005"),
        ("edtjc79v8v", "known:2382", "CHS - Northern Plains", "AGP Aberdeen", None, "(605) 626-9005", None),
        ("e9gkehvc9m", "known:Country Pride Coop|AGP Aberdeen|Aberdeen|SD", "Country Pride Coop", "Aberdeen", None, "16056269005", None),
        ("ebn7vhdmrb", "fullcircleag-agpaberdeen", "Full Circle Ag", "AGP-Aberdeen", "https://fullcircleag.com/", None, "605-626-9005"),
        # FS co-ops on one system site, each under its own path
        ("e1c1bxh08k", "gatewayfs-ferrin", "Gateway FS", "Carlyle", "https://fscooperatives.com/gatewayfs/", None, None),
        ("etyey09152", "gatewayfs-nashville", "Gateway FS", "Nashville", "https://fscooperatives.com/gatewayfs/", None, None),
        ("evbqagt6r5", "aglandfs-alto", "Ag-Land FS", "Alto", "https://fscooperatives.com/aglandfs/", None, None),
        ("ew1n3g1zrb", "insightfs-ixonia", "Insight FS", "Ixonia", "https://fscooperatives.com/insightfs/", None, None),
        # Pearl City Elevator boards (oc01: merged into Stephenson Service Co, Sep 1 2026) and two registry rows
        ("ef7wxjzrp7", "pcecoops-pearlcity", "iframe - Pearl City Elevator, Inc.", "Pearl City", pce, "815-809-2667", "18158092667"),
        ("e6m8m33m3v", "pcecoops-baileyville", "iframe - Pearl City Elevator, Inc.", "Baileyville", pce, None, "18153622667"),
        ("ejsyrhbe3m", "reg:IL|pearlcityelevatorinc|lena", "Pearl City Elevator, Inc.", "LENA", None, None, None),
        ("e3j64zn749", "reg:IL|pearlcityelevatorinc|pearlcity", "Pearl City Elevator, Inc.", "Pearl City", None, None, None),
        # Landmark's Burlington board, read from ALCIVIA's own page, and two ALCIVIA boards
        ("etykedhvfk", "alciviacoop-burlington", "Landmark Services Cooperative", "Burlington", "https://www.landmark.coop/", None, "12627672018"),
        ("ejgjkfcmzt", "alciviacoop-baldwin", "ALCIVIA", "BALDWIN", alc, None, "18005543213"),
        ("e69mfgeknx", "alciviacoop-belleville", "ALCIVIA", "BELLEVILLE", alc, None, "16084243651"),
    ]
    recs = [{"id": "a00341", "company": "Farmers Coop Of Dorchester"}]   # Barneston, basis history only
    seen = set()
    D = {"elevators": []}
    index = {"sources": []}
    for eid, rid, op, loc, web, dph, iph in rows:
        if eid not in seen:
            seen.add(eid)
            recs.append({"id": eid, "company": op.replace("iframe - ", "").replace("JSI Site - ", "")})
        D["elevators"].append({"id": rid, "elevId": eid, "operator": op, "location": loc, "website": web, "phone": dph})
        if not rid.startswith(("known:", "reg:")):
            index["sources"].append({"id": rid, "operator": op, "website": web, "phone": iph})
    parents = {"boards": {
        "alciviacoop-burlington": {"elevId": "etykedhvfk", "parent": "ALCIVIA", "pv": "board-page:alciviacoop.agricharts.com"},
        "chsherman-herman": {"elevId": "eq3apvczgp", "parent": "CHS Inc.", "pv": "chs-brand"},
        "chsherman-morris": {"elevId": "eaz2es8agf", "parent": "CHS Inc.", "pv": "chs-brand"},
        "chsdakotaplainsag-edgeley": {"elevId": "e92b3gfqp1", "parent": "CHS Inc.", "pv": "chs-brand"},
        "chsdakotaplainsag-galchutt": {"elevId": "e4x5y1gaeh", "parent": "CHS Inc.", "pv": "chs-brand"},
        "farmerscooperative-bungeemporia": {"elevId": "ej6psryg26", "dest": "Bunge", "dv": "location"}}}
    changes = {"events": [
        {"id": "oc01", "kind": "parent", "effective": "2026-09-01", "parent": "Stephenson Service Company",
         "facilities": ["e3j64zn749", "ef7wxjzrp7", "e6m8m33m3v", "ejsyrhbe3m", "es6rbep7jr", "ev9sdqr7qt"]},
        {"id": "oc06", "kind": "pending", "effective": "2026-04", "to": "MFA Inc", "facilities": ["en2k2ctf78", "efx2gvsbyc"]},
        {"id": "oc99", "kind": "parent", "effective": "2027-01-01", "parent": "Later", "facilities": ["ejcnemhr97", "e1c1bxh08k"]}]}

    ck("phone value is a hash of the 10 digits, not the number",
       phone_value("(402) 946-2211") == phone_value("14029462211") == "#" + hashlib.sha256(b"4029462211").hexdigest()[:10]
       and phone_value("N/A") == "" and phone_value("555-1212") == "")
    ck("website: agricharts subdomain and fscooperatives path are the firm's account; a plain host is cut to its domain",
       site_value(agp) == "farmersco-operative.agricharts.com" and site_value(own) == "farmersco-operative.com"
       and site_value("https://fscooperatives.com/gatewayfs/") == "fscooperatives.com/gatewayfs"
       and site_value("https://fscooperatives.com/") == "" and site_value("https://agricharts.com/") == ""
       and site_value("https://grain.example.com/x") == "example.com")

    doc = build(D, index, recs, parents, changes, None, "2026-11-09")
    co = doc["companies"]
    of = {f: cid for cid, c in co.items() for f in c["facilities"]}
    dor = of.get("ejmjz841bd")
    links = {(l[0], l[1]): l[2:] for l in co[dor]["links"]} if dor else {}
    ck("Dorchester: the 45-site spelling is one id, on the co-op's agricharts page and phone 402-946-2211",
       dor and all(of.get(f) == dor for f in ("ea431amncr", "ezgsht4rp8", "ej6psryg26"))
       and ("website", "farmersco-operative.agricharts.com") in links and ("phone", phone_value("402-946-2211")) in links)
    ck("the 'Farmers Cooperative' boards on the same page (one website, a second posted name) join it too",
       of.get("eq4ymamdng") == dor == of.get("e6jj2wjrkv") and doc["counts"]["dest_phones_skipped"] == 3)
    dil = of.get("epcpx5fbbm")
    ck("Dorchester 'of' spelling: Diller, Humboldt, Princeton share the co-op's own domain: one id, but a second "
       "one, since no phone or page links them to the agricharts boards",
       dil and of.get("eq9ky4q66b") == dil == of.get("esjd8ranbh") and dil != dor
       and [l[:2] for l in co[dil]["links"]] == [["website", "farmersco-operative.com"]])
    ck("the David City known row (phone N/A) and the basis-only Barneston spelling get no id: a name never links",
       "e2f4jaqmm3" not in of and "a00341" not in of)
    ck("Bunge's 800 number on the Dorchester delivery boards (location or row id in braces) is never read: "
       "no Dorchester row joins Bunge", "e162h10t8q" not in of and "ex2mg8pevs" not in of
       and doc["counts"]["dest_phones_skipped"] == 3)
    ck("Prinsburg's Raymond NE board carries the Dorchester Raymond number: one value between two names, held",
       "ee112y1sgb" not in of and any(h[2] == ["ee112y1sgb", "ezgsht4rp8"] for h in doc["held"]))
    ck("CHS: the brand rule links nothing; CHS Herman and CHS Dakota Plains Ag are one id each, by their own sites",
       of.get("eq3apvczgp") == of.get("eaz2es8agf") and of.get("e92b3gfqp1") == of.get("e4x5y1gaeh")
       and of.get("eq3apvczgp") and of.get("e92b3gfqp1") and of["eq3apvczgp"] != of["e92b3gfqp1"]
       and doc["counts"]["chs_brand_boards_not_linked_by_brand"] == 4)
    ck("AG Choice and Beachner Grain share 2 numbers: each town's pair joins; the two towns share nothing, so two ids",
       of.get("ejcnemhr97") and of["ejcnemhr97"] == of.get("etfre8es78") and of.get("eekbexq7wz") == of.get("ewb2v1k72s")
       and of["ejcnemhr97"] != of["eekbexq7wz"])
    ck("Heartland Co-op and Landus, similar trade, one shared Mitchellville number, no other evidence: two firms, held",
       "en2k2ctf78" not in of and "efx2gvsbyc" not in of
       and any(h[0] == "phone" and h[2] == ["efx2gvsbyc", "en2k2ctf78"] for h in doc["held"]))
    ck("AGP Aberdeen's number on 4 firms' boards is a hub: links nothing, listed as held",
       not ({"e8zct696td", "edtjc79v8v", "e9gkehvc9m", "ebn7vhdmrb"} & set(of))
       and any(h[0] == "phone" and h[3].startswith("hub: 4") for h in doc["held"]))
    ck("Gateway FS, AGLand FS and Insight FS on fscooperatives.com stay apart; Gateway's two sites join on its path",
       of.get("e1c1bxh08k") and of["e1c1bxh08k"] == of.get("etyey09152")
       and "evbqagt6r5" not in of and "ew1n3g1zrb" not in of)
    pc = of.get("ef7wxjzrp7")
    ck("oc01 (completed Sep 1 2026) joins the Pearl City boards and registry rows; the 'iframe - ' prefix is not a "
       "different name", pc and all(of.get(f) == pc for f in ("e6m8m33m3v", "ejsyrhbe3m", "e3j64zn749"))
       and any(l[:2] == ["change", "oc01"] for l in co[pc]["links"]))
    ck("a pending change and a change dated after the build day link nothing",
       "en2k2ctf78" not in of and of.get("ejcnemhr97") != of.get("e1c1bxh08k"))
    ck("board-page: Landmark's Burlington board on ALCIVIA's own page joins ALCIVIA's facilities",
       of.get("etykedhvfk") and of["etykedhvfk"] == of.get("ejgjkfcmzt") == of.get("e69mfgeknx")
       and any(l[:2] == ["board-page", "alciviacoop.agricharts.com"] for l in co[of["ejgjkfcmzt"]]["links"]))
    ck("counts", doc["counts"]["companies"] == len(co) == 9 and doc["counts"]["links_by_type"]["change"] == 1
       and doc["counts"]["links_by_type"]["board-page"] == 1 and doc["counts"]["facilities_with_company"] == len(of))
    ids1 = {cid: set(c["facilities"]) for cid, c in co.items()}

    # ids: a rebuild is stable; a merge keeps the older id; a group whose links went is retired, never reused
    doc2 = build(D, index, recs, parents, changes, doc, "2026-11-10")
    ck("same evidence, same ids, nothing minted", {c: set(v["facilities"]) for c, v in doc2["companies"].items()} == ids1
       and doc2["ledger"]["next"] == doc["ledger"]["next"])
    D2 = json.loads(json.dumps(D))
    for r in D2["elevators"]:
        if r["elevId"] == "epcpx5fbbm":
            r["phone"] = "402-946-2211"      # say Diller's board posts the Dorchester office number
    doc3 = build(D2, index, recs, parents, changes, doc2, "2026-11-11")
    old, new = sorted((dor, dil), key=lambda x: int(x[1:]))
    ck("two groups joined by new evidence keep the older id; the newer is retired into it, nothing minted",
       doc3["ledger"]["retired"].get(new, {}).get("into") == old and new not in doc3["companies"]
       and doc3["ledger"]["next"] == doc["ledger"]["next"])
    agc = of["ejcnemhr97"]
    D3 = json.loads(json.dumps(D))
    D3["elevators"] = [r for r in D3["elevators"] if r["elevId"] not in ("ejcnemhr97", "etfre8es78")]
    doc4 = build(D3, index, recs, parents, changes, doc3, "2026-11-12")
    ck("a group that lost its links is retired with the reason (Parsons too: one shared number is not enough "
       "for two names)", "why" in doc4["ledger"]["retired"].get(agc, {})
       and "why" in doc4["ledger"]["retired"].get(of["eekbexq7wz"], {}))
    ck("Diller loses the office number again: its group splits off under a new id, the retired one stays retired",
       doc4["ledger"]["events"][-3:] and any(e.get("split") == [old] for e in doc4["ledger"]["events"])
       and {f: c for c, v in doc4["companies"].items() for f in v["facilities"]}["epcpx5fbbm"] not in (dor, dil))
    doc5 = build(D, index, recs, parents, changes, doc4, "2026-11-13")
    of5 = {f: cid for cid, c in doc5["companies"].items() for f in c["facilities"]}
    ck("evidence back: a NEW id; the retired one is never reused",
       of5.get("ejcnemhr97") not in (None, agc) and int(of5["ejcnemhr97"][1:]) >= doc4["ledger"]["next"]
       and agc in doc5["ledger"]["retired"] and agc not in doc5["companies"])
    D4 = json.loads(json.dumps(D))
    for r in D4["elevators"]:
        if r["elevId"] == "ea431amncr":
            r["phone"], r["website"] = None, None
    idx4 = json.loads(json.dumps(index))
    for s in idx4["sources"]:
        if s["id"] == "farmerscooperative-marietta":
            s["phone"], s["website"] = None, None
    doc6 = build(D4, idx4, recs, parents, changes, doc2, "2026-11-14")
    of6 = {f: cid for cid, c in doc6["companies"].items() for f in c["facilities"]}
    ck("a facility whose only links went drops out; the rest keep the id", of6.get("ejmjz841bd") == dor and "ea431amncr" not in of6)
    big = {"companies": {f"c{i:05d}": {"facilities": [f"x{i}a", f"x{i}b"]} for i in range(1, RETIRE_MAX + 3)},
           "ledger": {"next": RETIRE_MAX + 3}}
    try:
        build(D, index, recs, parents, changes, big, "2026-11-15")
        stopped = False
    except SystemExit:
        stopped = True
    ck("more ids lost in one run than the limit stops the build", stopped)
    print(f"FAILS={len(fails)}")
    return 1 if fails else 0


MAX_BYTES = 100_000
ROOT = os.path.dirname(HERE)


def check(root=ROOT):
    """data/ids/companies.json as committed: under MAX_BYTES, every facility a live record of elevators.json and in
    one company only, no live id retired, every id minted and below `next`, every link one of the four types."""
    path = os.path.join(root, "data", "ids", "companies.json")
    errs = []
    size = os.path.getsize(path)
    if size > MAX_BYTES:
        errs.append(f"{size} bytes, over {MAX_BYTES}")
    doc = load(path) or {}
    fac = {r["id"] for r in (load(os.path.join(root, "data", "ids", "elevators.json")) or {}).get("elevators") or []}
    led = doc.get("ledger") or {}
    seen = collections.Counter()
    for cid, c in (doc.get("companies") or {}).items():
        if not re.fullmatch(r"c\d{5}", cid) or cid not in led.get("minted", {}) or int(cid[1:]) >= led.get("next", 0):
            errs.append(f"{cid}: not a minted id")
        if cid in led.get("retired", {}):
            errs.append(f"{cid}: live and retired")
        if len(c.get("facilities") or []) < 2 or c.get("n") != len(c["facilities"]):
            errs.append(f"{cid}: fewer than 2 facilities or n wrong")
        seen.update(c.get("facilities") or [])
        for ln in c.get("links") or []:
            if ln[0] not in TYPES or not ln[1] or (len(ln) > 2 and not set(ln[2]) <= set(c["facilities"])):
                errs.append(f"{cid}: bad link {ln[:2]}")
        if not c.get("links"):
            errs.append(f"{cid}: no evidence")
    errs += [f"{f}: in {n} companies" for f, n in seen.items() if n > 1]
    gone = sorted(set(seen) - fac)
    if gone:
        errs.append(f"{len(gone)} facilities not in elevators.json, e.g. {gone[:3]}")
    for e in errs[:20]:
        print("FAIL " + e)
    print(f"companies.json: {len(doc.get('companies') or {})} ids, {len(seen)} facilities, {size} bytes; {len(errs)} problems")
    return 1 if errs else 0


def main():
    if "--selftest" in sys.argv[1:]:
        return selftest()
    if "--check" in sys.argv[1:]:
        return check()
    print(__doc__)
    return 0


if __name__ == "__main__":
    sys.exit(main())
