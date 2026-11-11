#!/usr/bin/env python3
"""build_prf_counties.py: the county view of each PRF state page, and a forward at every old county address.

WHY
  Until Nov 2026 every county had its own page, prf/<state>/<county>.html: 3,070
  pages, about 61 MB, that took few visits. The county now lives on its state
  page (prf/<state>.html, scripts/build_prf_states.py): a county picker opens
  the same answer the county page gave, the grids that touch the county (by
  number), USDA's county base values for grazing and hay, what each pair of
  months costs there at 90% coverage, how often each pair came in under 90% of
  normal since 1951, what the last five years and this year so far did, and the
  labeled 100-acre example. Every grid opens the calculator on itself.

WHAT THIS WRITES, for every county with PRF
  prf/<state>/<county>.json   the county view as data (view() below), rounded here
                              the way the county page printed it and laid out by
                              components/prf-county.js when a reader picks the
                              county. About 3 KB.
  prf/<state>/<county>.html   a forward (under 1.5 KB): noindex, canonical to the
                              state page, an instant refresh and a script to
                              /prf/<state>?county=<county>#county, which opens the
                              state page on that county. Old links and bookmarks keep
                              working. Forwards stay out of every sitemap.
  sitemap-prf.xml             the PRF state pages and the explainer, lastmod the date
                              of the USDA files they were built from.

WHERE THE NUMBERS COME FROM
  data/prf/meta.json and data/prf/s/<ST>.json (USDA's county values and
  limits, copied unchanged), and scripts/prf_county_facts.mjs, which works out
  every count and middle from data/prf/g and data/prf/y with
  components/prf-math.js and prints them. Nothing is computed here; this
  formats.

  URLs follow the Farmland Atlas (farmland-atlas/data/counties-index.json, by
  county code) so /prf/texas/anderson-county sits beside
  /farmland-atlas/texas/anderson-county and /arc-plc/texas/anderson-county.

SIZE (CLAUDE.md): the build refuses a county view over MAX_KB and a forward over
  the pointer cap, and prints the total. Run scripts/check_site_budget.py after.

  python3 scripts/build_prf_counties.py           write prf/<state>/<county>.json and .html, and sitemap-prf.xml
  python3 scripts/build_prf_counties.py --check   exit 1 if any file or the sitemap differs from what this would write
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import build_prf_states as S  # noqa: E402  shared helpers: long_date, money2, slug, boot, text_of
import inject_static_nav as nav  # noqa: E402,F401  the menu files stay this set's code (scripts/generated_sets.py)
import pointer_pages as PP  # noqa: E402  dropped pages leave a pointer, not a 404

D = os.path.join(ROOT, "data", "prf")
OUT = os.path.join(ROOT, "prf")
SITEMAP = os.path.join(ROOT, "sitemap-prf.xml")
MAX_KB = 12          # one county view (JSON); most are 2 to 4 KB
e = S.e


def county_facts():
    r = subprocess.run(["node", os.path.join(ROOT, "scripts", "prf_county_facts.mjs")], capture_output=True, text=True, check=False)
    if r.returncode != 0:
        raise SystemExit("prf_county_facts.mjs failed:\n" + r.stderr)
    return json.loads(r.stdout)


def atlas_index():
    """fips -> (display name without the state, page slug). Empty if the Atlas index is missing."""
    p = os.path.join(ROOT, "farmland-atlas", "data", "counties-index.json")
    if not os.path.exists(p):
        return {}
    out = {}
    for fips, label, href in json.load(open(p, encoding="utf-8")):
        out[fips] = (re.sub(r",\s*[A-Z]{2}$", "", label), href.rstrip("/").rsplit("/", 1)[-1])
    return out


def place(st_code, fips, adm_name, ATL):
    """(display name, slug) for a county."""
    if fips in ATL:
        return ATL[fips]
    if st_code == "CT":
        n = f"{adm_name} Planning Region" if "Planning Region" not in adm_name else adm_name
    elif st_code == "LA":
        n = f"{adm_name} Parish"
    else:
        n = f"{adm_name} County"
    return n, S.slug(n)


def county_urls(meta, ATL=None):
    """fips -> (name, href, slug, state) for every county with PRF, and the loaded state files.
    build_prf_states.py uses it to link each county row to its page."""
    if ATL is None:
        ATL = atlas_index()
    where, loaded = {}, {}
    for st in sorted(meta["states"], key=lambda s: s["name"]):
        sd = json.load(open(os.path.join(D, "s", st["st"] + ".json")))
        loaded[st["st"]] = sd
        used = set()
        for code, c in sorted(sd["counties"].items()):
            fips = sd["fips"] + code
            n, sl = place(st["st"], fips, c["n"], ATL)
            if sl in used:
                sl = f"{sl}-{code}"
            used.add(sl)
            where[fips] = (n, f"/prf/{S.slug(st['name'])}/{sl}", sl, st)
    return where, loaded


def r0(x):
    """A whole-dollar figure as the county page printed it (Python rounding, f"{x:,.0f}")."""
    return None if x is None else int(f"{x:.0f}")


def r2(x):
    return None if x is None else float(f"{x:.2f}")


def r1(x):
    return None if x is None else float(f"{x:.1f}")


def view(ctx):
    """One county's view as data: the figures the county page printed, rounded here the way it printed
    them (so the browser formats and never rounds), for components/prf-county.js to lay out. The
    deadlines, the FAQ and the page furniture stay on the state page around it."""
    meta, cf, st, sd, code, c, fx, name, links = (ctx[k] for k in ("meta", "cf", "st", "sd", "code", "c", "fx", "name", "links"))
    fips = sd["fips"] + code
    grids = fx["grids"]
    b = c["b"]
    lim = c.get("lim") or next(iter((c.get("limc") or {}).values()), None)
    ex = fx.get("example")
    ex_g = (ex or {}).get("grid")
    rng = lambda r, f: [f(r["low"]), f(r["mid"]), f(r["high"])] if r else None
    return {
        "v": 1, "fips": fips, "name": name, "state": st["name"], "st": st["st"],
        "cy": meta["crop_year"], "y0": cf["years"]["first"], "y1": cf["years"]["last"], "ny": cf["years"]["n"],
        "open": cf["open_year"], "read": S.long_date(meta["built"][:10]),
        "sub": {k: int(round(meta["subsidy"][k] * 100)) for k in sorted(meta["subsidy"], key=int)},
        "gz": r2(b[0]), "hy": r2(b[4]), "hi": r2(b[1]), "prot": r2(round(b[0] * 0.9, 2)),
        "jf": (str(lim[0][1]) + "%") if lim and lim[0] else "not offered",
        "grids": grids,
        # the grid the "This interval so far" card opens on: the example's grid, else the middle one
        "now": ex_g if ex_g in grids else grids[len(grids) // 2],
        "ex": ({"grid": ex["grid"], "of": ex["of"], "you": r0(ex["you"]), "you_acre": r2(ex["you_acre"]), "usda": r0(ex["usda"]),
                "premium": r0(ex["premium"]), "paid": ex["paid_years"], "years": ex["years"], "avg": r0(ex["avg"]),
                "avg_acre": r2(ex["avg_acre"])} if ex else None),
        "iv": [{"rate": rng(r["rate"], r2), "below": rng(r["below"], int), "in": r2(r["normal_in"]), "n": r.get("n") or 0}
               for r in fx["intervals"]],
        "rec": [{"y": x["year"], "open": bool(x.get("open")), "iv": [v["mid"] if v else None for v in x["iv"]]} for x in fx["recent"]],
        "gr": [[g["g"], r1(g["normal_in"]), g["dry_year"], g["dry_pct"], g["last_pct"], g["years_under_90"]] for g in fx["grid_rows"]],
        "links": [[t, h] for t, h in links],
        "story": ctx.get("story", "").strip(),
    }


def forward_to(st_slug, sl):
    """Where an old county address sends the reader: the state page, opened on the county."""
    return f"/prf/{st_slug}?county={sl}#county"


def forward(st_slug, sl, name, stn):
    """The page left at an old county address (Nov 2026 fold). Noindex, canonical to the state page,
    an instant refresh and a script (the script keeps nothing the refresh would not), and one line with
    a link for readers without either. No pointer marker: it is a forward, not a dropped county, so
    the Atlas and ARC/PLC county links that point here keep landing on the county."""
    to = forward_to(st_slug, sl)
    canon = f"https://agsist.com/prf/{st_slug}"
    t = e(to)
    return ("<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n"
            "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n"
            f"<title>PRF in {e(name)}, {e(stn)}: moved | AGSIST</title>\n"
            "<meta name=\"robots\" content=\"noindex, follow\">\n"
            f"<link rel=\"canonical\" href=\"{canon}\">\n"
            f"<meta http-equiv=\"refresh\" content=\"0; url={t}\">\n"
            f"<script>location.replace({json.dumps(to)})</script>\n"
            "</head>\n<body style=\"margin:0;background:#fff;color:#111\">\n"
            "<main style=\"max-width:600px;margin:0 auto;padding:3rem 1rem;font-family:system-ui,sans-serif\">\n"
            f"<p>PRF in {e(name)} is now on the <a href=\"{t}\">{e(stn)} PRF page</a>, county by county.</p>\n"
            "</main>\n</body>\n</html>\n")


def state_urls(meta):
    """The PRF pages sitemap-prf.xml lists: every state page and the explainer."""
    return ([f"https://agsist.com/prf/{S.slug(st['name'])}" for st in sorted(meta["states"], key=lambda s: s["name"])]
            + [f"https://agsist.com/prf/{S.GUIDE_SLUG}"])


def sitemap(urls, day):
    body = "".join(f"  <url><loc>{u}</loc><lastmod>{day}</lastmod></url>\n" for u in urls)
    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<!-- PRF state pages and the explainer. Written by scripts/build_prf_counties.py; lastmod is the date of the USDA files the pages were built from. '
            'County addresses forward to their state page and stay out of every sitemap. -->\n'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + body + "</urlset>\n")


def main():
    meta = json.load(open(os.path.join(D, "meta.json")))
    cf = county_facts()
    if cf.get("built_from") != meta["built"] or cf.get("crop_year") != meta["crop_year"]:
        raise SystemExit("county facts and meta.json are from different builds of data/prf")
    ATL = atlas_index()
    states = sorted(meta["states"], key=lambda s: s["name"])
    # the dated lead paragraph (scripts/stories_prf.py): only where a kept story's facts are this view's now
    import stories_core as SK
    import stories_prf as SP
    STORIES = SK.load(SP)
    where, loaded = county_urls(meta, ATL)
    want = {}
    total_view = total_fwd = 0
    big = 0
    for st in states:
        sd = loaded[st["st"]]
        st_slug = S.slug(st["name"])
        for code, c in sorted(sd["counties"].items()):
            fips = sd["fips"] + code
            n, href, sl, _ = where[fips]
            links = []
            for label, top in (("Farmland Atlas", "farmland-atlas"), ("ARC or PLC", "arc-plc")):
                if os.path.exists(os.path.join(ROOT, top, st_slug, sl + ".html")):
                    links.append((f"{e(n)} in the {label}" if label == "Farmland Atlas" else f"{label} in {e(n)}", f"/{top}/{st_slug}/{sl}"))
            links.append(("PRF calculator", "/prf"))
            story = ""
            if STORIES:
                story = SP.story_html(STORIES, st["st"], fips, SP.county_facts(meta, cf, st, sd, code, c, cf["counties"][fips], n), meta["built"][:10])
            v = view({"meta": meta, "cf": cf, "st": st, "sd": sd, "code": code, "c": c, "fx": cf["counties"][fips], "name": n,
                      "links": links, "story": story})
            body = json.dumps(v, ensure_ascii=False, separators=(",", ":")) + "\n"
            size = len(body.encode())
            if size > MAX_KB * 1024:
                raise SystemExit(f"prf/{st_slug}/{sl}.json would be {size // 1024} KB, over {MAX_KB} KB")
            fwd = forward(st_slug, sl, n, st["name"])
            if len(fwd.encode()) > PP.MAX_BYTES:
                raise SystemExit(f"prf/{st_slug}/{sl}.html forward would be {len(fwd.encode())} bytes, over {PP.MAX_BYTES}")
            total_view += size
            total_fwd += len(fwd.encode())
            big = max(big, size)
            want[os.path.join(st_slug, sl + ".json")] = body
            want[os.path.join(st_slug, sl + ".html")] = fwd
    sm = sitemap(state_urls(meta), meta["built"][:10])
    check = "--check" in sys.argv
    bad = []
    for rel, body in want.items():
        p = os.path.join(OUT, rel)
        have = open(p, encoding="utf-8").read() if os.path.exists(p) else None
        if have != body:
            if check:
                bad.append(rel)
            else:
                os.makedirs(os.path.dirname(p), exist_ok=True)
                open(p, "w", encoding="utf-8").write(body)
    # files this build no longer writes (a county dropped from USDA's files)
    stale, stale_json = [], []
    for st in states:
        dd = os.path.join(OUT, S.slug(st["name"]))
        if os.path.isdir(dd):
            for fn in os.listdir(dd):
                rel = os.path.join(S.slug(st["name"]), fn)
                if rel in want:
                    continue
                if fn.endswith(".html"):
                    stale.append(rel)
                elif fn.endswith(".json"):
                    stale_json.append(rel)
    # a county that left USDA's files stays as a pointer to its state page (scripts/pointer_pages.py)
    def prf_parent(rel):
        st_slug = rel.split("/")[1]
        return [(f"/prf/{st_slug}", PP.label(st_slug)), ("/prf", "PRF")]
    changed, orphans = PP.settle(ROOT, "prf", ["prf/" + r.replace(os.sep, "/") for r in stale], prf_parent, check=check)
    stale = [r for r in stale if "prf/" + r.replace(os.sep, "/") in orphans]
    have_sm = open(SITEMAP, encoding="utf-8").read() if os.path.exists(SITEMAP) else None
    if check:
        if have_sm != sm:
            bad.append("sitemap-prf.xml")
        bad += stale + stale_json + changed
        if bad:
            print("PRF county files out of date:", ", ".join(bad[:5]), "... run python3 scripts/build_prf_counties.py")
            return 1
        print(f"{len(want) // 2} county views and forwards and sitemap-prf.xml match data/prf")
        return 0
    for rel in stale + stale_json:
        os.remove(os.path.join(OUT, rel))
    if have_sm != sm:
        open(SITEMAP, "w", encoding="utf-8").write(sm)
    print(f"{len(want) // 2} county views ({total_view / 1048576:.1f} MB, largest {big // 1024} KB) and forwards ({total_fwd / 1048576:.1f} MB) "
          f"written to prf/<state>/; {len(stale) + len(stale_json)} stale removed, {len(changed)} pointers written; "
          f"sitemap-prf.xml {len(state_urls(meta))} URLs")
    return 0


if __name__ == "__main__":
    sys.exit(main())
