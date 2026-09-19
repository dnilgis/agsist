#!/usr/bin/env python3
"""
atlas_common.py — the three things every Atlas fetcher needs and none should
write twice: an HTTP get with the site's User-Agent and a proxy fallback, a
county-name-to-FIPS index built from the Atlas's own geometry, and a
point-in-county test for sources that publish a latitude and longitude and no
FIPS.

THE PROXY
  pubfs-rma.fpac.usda.gov refused a GitHub runner's TCP connect on 2026-09-13
  while NCEI, NASS and USGS answered the same job. RMA_PROXY_BASE names a
  Cloudflare Worker (workers/atlas-rma-proxy.js) that fetches from a Cloudflare
  address. get() tries the direct URL first with a short connect timeout; if a
  host fails once, every later call to that host goes straight to the proxy.
  Hosts the Worker does not know are never proxied.

NAMES
  FSA, EIA and LBNL publish county NAMES, not codes. names_to_fips() normalises
  both sides (case, punctuation, the unit word, "St."/"Saint", accents) and
  joins on (state, name). A name that does not match is returned in
  `unmatched` and logged; it is never guessed. The one word norm_name does NOT
  throw away is "city": an independent city is a different place from the
  county of the same name, and six pairs of them share a name.
"""

import json
import os
import re
import sys
import time
import unicodedata
import urllib.request

UA = "AGSIST-automation/1.0 (+https://agsist.com/farmland-atlas)"
GEO = "data/atlas/counties.geo.json"
PROXY_BASE = os.environ.get("RMA_PROXY_BASE", "").strip().rstrip("/")
# HOSTS THAT DO NOT ANSWER A GITHUB RUNNER IN A REASONABLE TIME.
#
# Membership buys two things and they are separable: the direct attempt is
# capped at CONNECT_TIMEOUT instead of the full `timeout` and is tried ONCE
# instead of twice, and a proxy route is added IF RMA_PROXY_BASE is set and the
# caller passed a proxy_path. A host can be in here purely for the first half.
#
#   pubfs-rma.fpac.usda.gov  TCP connect timeout from a runner, measured
#                            2026-09-13. It has answered directly since --
#                            every colsom zip on 2026-09-16 logged "direct in
#                            1s" -- so the proxy has never actually been needed.
#   www.fsa.usda.gov         measured 2026-09-17: the CRP request accepted the
#                            connection and sat on it until the remote end
#                            closed without a response, twice, for 629 seconds
#                            in total. Here for the TIMEOUT, not for a proxy;
#                            fetch_atlas_crp.py passes no proxy_path.
PROXIED_HOSTS = {"pubfs-rma.fpac.usda.gov", "www.fsa.usda.gov"}
CONNECT_TIMEOUT = 40
_dead_hosts = set()


def log(*a):
    print(*a, flush=True)


def _host(url):
    return url.split("://", 1)[-1].split("/", 1)[0].lower()


def _raw_get(url, timeout):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def get(url, timeout=600, retries=2, proxy_path=None):
    """Bytes, or None on 404. Raises when no route answers.
    proxy_path: the path the Worker serves for this URL (e.g. "/colsom_2024.zip")."""
    host = _host(url)
    routes = []
    if host not in _dead_hosts:
        routes.append(("direct", url, CONNECT_TIMEOUT if host in PROXIED_HOSTS else timeout))
    if PROXY_BASE and host in PROXIED_HOSTS and proxy_path:
        routes.append(("proxy", PROXY_BASE + proxy_path, timeout))
    last = None
    for label, u, t in routes:
        for attempt in range(retries):
            try:
                t0 = time.time()
                data = _raw_get(u, t)
                if label == "proxy" or host in PROXIED_HOSTS:
                    log(f"  {u.rsplit('/', 1)[-1]}: {label} in {time.time() - t0:.0f}s")
                return data
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    return None
                last = e
                time.sleep(10)
            except Exception as e:
                last = e
                if label == "direct" and host in PROXIED_HOSTS:
                    _dead_hosts.add(host)
                    log(f"  {host}: direct route failed ({type(e).__name__}); "
                        + ("switching to the proxy" if (PROXY_BASE and proxy_path)
                           else "no proxy route for this url" if not proxy_path
                           else "no RMA_PROXY_BASE set"))
                    break
                time.sleep(10)
    raise RuntimeError(f"{url}: no route answered ({type(last).__name__}: {last})")


# ---------------------------------------------------------------- county names

_SAINT = re.compile(r"\b(st|ste)\.?\s", re.I)

# THE UNIT WORD FEDERAL FILES HANG OFF A COUNTY NAME.
#
# Longest phrase first, because the alternation is tried in order: stripping a
# bare "Borough" off "Juneau City and Borough" would leave "Juneau City and".
# Alaska alone needs four of these spellings; Louisiana needs Parish.
#
# "City" IS DELIBERATELY NOT IN THIS LIST. Keeping it is what lets an
# independent city stay a different key from the county it sits next to --
# "Fairfax city" -> "fairfaxcity", "Fairfax County" -> "fairfax" -- which is
# exactly the spelling county_index registers the city under. Strip it and the
# two would collapse onto one key and every Virginia city row would be filed
# against the wrong FIPS.
_UNIT = re.compile(r"\s+(city and borough|census area|municipality|county|parish|borough)$")


def _deaccent(s):
    """'Doña Ana' -> 'Dona Ana'. Decompose and drop the combining marks, so an
    accented letter becomes its plain letter instead of disappearing: deleting
    the tilde's carrier would give 'doaana', which matches nothing NASS or FSA
    writes. Doña Ana NM is the only non-ASCII county name in the 50 states."""
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))


def norm_name(name):
    """'St. Clair County' -> 'saintclair'; "O'Brien" -> 'obrien'; 'DeKalb' -> 'dekalb';
    'Juneau City and Borough' -> 'juneau'; 'Bethel Census Area' -> 'bethel';
    'Doña Ana' -> 'donaana'. 'Alexandria city' KEEPS the city: 'alexandriacity'."""
    s = _deaccent((name or "").strip()).lower()
    s = _UNIT.sub("", s).strip()
    s = _SAINT.sub(lambda m: "sainte " if m.group(1).lower() == "ste" else "saint ", s)
    s = re.sub(r"[^a-z0-9]+", "", s)
    return s


def load_geometry(path=GEO):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def county_index(geo=None):
    """{(ST, normalised name): fips} from the Atlas geometry.

    SIX collisions exist across the 50 states, every one an independent city
    that shares its name with a county. Counted by running this function over
    data/atlas/counties.geo.json (3,141 features) on 2026-09-18:
      MD Baltimore   county 24005 / city 24510
      MO St. Louis   county 29189 / city 29510
      VA Fairfax     county 51059 / city 51600
      VA Franklin    county 51067 / city 51620
      VA Richmond    county 51159 / city 51760
      VA Roanoke     county 51161 / city 51770
    Bedford VA is NOT a seventh: Bedford city gave up its charter in 2013 and
    the census county list dropped 51515, so only Bedford County (51019) is in
    the geometry. The features are walked in FIPS order, so the county (always
    the lower code) keeps the plain key and the city is registered as
    "<name>city", which is how federal files label an independent city. Any
    new collision is logged.

    The other independent cities do not collide, and they still need their
    federal spelling: an FSA workbook writes "Alexandria city", norm_name
    keeps the city, and the feature is named plain "Alexandria". So a feature
    whose properties.u is "City" also gets the "<name>city" key. properties.u
    is the unit word the geometry builder writes when the unit is not
    "County"; it is absent on older geometry files, and then this does
    nothing."""
    geo = geo or load_geometry()
    idx = {}
    for ft in sorted(geo["features"], key=lambda f: f["id"]):
        st, base = ft["properties"]["st"], norm_name(ft["properties"]["name"])
        key = (st, base)
        if key in idx:
            alt = (st, base + "city")
            log(f"  county_index: {st} {ft['properties']['name']!r} is both {idx[key]} and {ft['id']}; {ft['id']} registered as {alt[1]!r}")
            idx[alt] = ft["id"]
            continue
        idx[key] = ft["id"]
        if (ft["properties"].get("u") or "") == "City":
            idx.setdefault((st, base + "city"), ft["id"])
    return idx


def names_to_fips(rows, idx, state_key="state", name_key="county"):
    """rows: iterable of dicts with a state abbreviation and a county name.
    Returns ({fips: [rows]}, unmatched: [(state, name)])."""
    out = {}
    unmatched = []
    for r in rows:
        st = (r.get(state_key) or "").strip().upper()
        key = (st, norm_name(r.get(name_key)))
        f = idx.get(key)
        if f is None:
            unmatched.append((st, r.get(name_key)))
            continue
        out.setdefault(f, []).append(r)
    return out, unmatched


# ---------------------------------------------------------------- point in county

def _in_ring(x, y, ring):
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi + 1e-300) + xi:
            inside = not inside
        j = i
    return inside


def _in_geometry(x, y, g):
    polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
    for poly in polys:
        if _in_ring(x, y, poly[0]) and not any(_in_ring(x, y, hole) for hole in poly[1:]):
            return True
    return False


class CountyLocator:
    """Bounding-box prefilter then ray casting. Fine for a few hundred thousand points."""

    def __init__(self, geo=None):
        geo = geo or load_geometry()
        self.items = []
        for ft in geo["features"]:
            g = ft["geometry"]
            xs, ys = [], []

            def walk(c):
                if isinstance(c[0], (int, float)):
                    xs.append(c[0])
                    ys.append(c[1])
                else:
                    for cc in c:
                        walk(cc)
            walk(g["coordinates"])
            self.items.append((min(xs), min(ys), max(xs), max(ys), ft["id"], g))

    def locate(self, lon, lat):
        for x0, y0, x1, y1, fips, g in self.items:
            if x0 <= lon <= x1 and y0 <= lat <= y1 and _in_geometry(lon, lat, g):
                return fips
        return None


def selftest():
    assert norm_name("St. Clair County") == "saintclair" and norm_name("Ste. Genevieve") == "saintegenevieve"
    assert norm_name("O'Brien") == "obrien" and norm_name("DeKalb") == "dekalb" and norm_name("De Kalb") == "dekalb"
    assert norm_name("LaSalle County") == "lasalle" and norm_name("La Salle") == "lasalle"
    # the unit words the 50 states add to the 48 that were here before
    assert norm_name("Acadia Parish") == "acadia" and norm_name("East Baton Rouge Parish") == "eastbatonrouge"
    assert norm_name("Juneau City and Borough") == "juneau" and norm_name("Juneau") == "juneau"
    assert norm_name("Aleutians East Borough") == "aleutianseast"
    assert norm_name("Bethel Census Area") == "bethel"
    assert norm_name("Prince of Wales-Hyder Census Area") == "princeofwaleshyder"
    assert norm_name("Anchorage Municipality") == "anchorage" and norm_name("Skagway Municipality") == "skagway"
    # The accent is transliterated, not deleted: NASS writes this county
    # without the tilde. Both Unicode spellings of it are pinned -- a single
    # n-with-tilde and an n followed by a combining tilde -- because which one
    # arrives depends on who exported the file.
    assert norm_name("Do\u00f1a Ana") == "donaana" == norm_name("Dona Ana") == norm_name("Do\u00f1a Ana County")
    assert norm_name("Don\u0303a Ana") == "donaana"
    # "city" is kept, so an independent city never lands on its county's key
    assert norm_name("Alexandria city") == "alexandriacity" == norm_name("Alexandria City")
    assert norm_name("Fairfax County") == "fairfax" and norm_name("Fairfax city") == "fairfaxcity"
    assert norm_name("Carson City") == "carsoncity" and norm_name("Charles City County") == "charlescity"
    geo = {"features": [
        {"id": "19001", "properties": {"name": "Adair", "st": "IA"},
         "geometry": {"type": "Polygon", "coordinates": [[[-94.7, 41.1], [-94.2, 41.1], [-94.2, 41.5], [-94.7, 41.5], [-94.7, 41.1]]]}},
        {"id": "29186", "properties": {"name": "Ste. Genevieve", "st": "MO"},
         "geometry": {"type": "MultiPolygon", "coordinates": [[[[-90.5, 37.7], [-90.0, 37.7], [-90.0, 38.1], [-90.5, 38.1], [-90.5, 37.7]]]]}}]}
    geo["features"].append({"id": "29510", "properties": {"name": "St. Louis", "st": "MO"}, "geometry": {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 0]]]}})
    geo["features"].append({"id": "29189", "properties": {"name": "St. Louis", "st": "MO"}, "geometry": {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 0]]]}})
    # an independent city with no county of the same name: the plain feature
    # name and the federal "<name> city" spelling must both find it
    geo["features"].append({"id": "51510", "properties": {"name": "Alexandria", "st": "VA", "u": "City"}, "geometry": {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 0]]]}})
    geo["features"].append({"id": "02110", "properties": {"name": "Juneau", "st": "AK", "u": "City and Borough"}, "geometry": {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 0]]]}})
    idx = county_index(geo)
    assert idx[("MO", "saintlouis")] == "29189" and idx[("MO", "saintlouiscity")] == "29510", idx
    assert idx[("VA", "alexandria")] == "51510" and idx[("VA", "alexandriacity")] == "51510", idx
    assert idx[("AK", "juneau")] == "02110" and ("AK", "juneaucity") not in idx, idx
    got_c, _ = names_to_fips([{"state": "MO", "county": "ST. LOUIS CITY"}, {"state": "MO", "county": "St. Louis (city)"}, {"state": "MO", "county": "St. Louis County"}], idx)
    assert set(got_c) == {"29510", "29189"} and len(got_c["29510"]) == 2, got_c
    got_v, un_v = names_to_fips([{"state": "VA", "county": "Alexandria city"}, {"state": "VA", "county": "Alexandria"},
                                 {"state": "AK", "county": "Juneau City and Borough"}], idx)
    assert got_v == {"51510": [{"state": "VA", "county": "Alexandria city"}, {"state": "VA", "county": "Alexandria"}],
                     "02110": [{"state": "AK", "county": "Juneau City and Borough"}]} and un_v == [], (got_v, un_v)
    got, un = names_to_fips([{"state": "IA", "county": "ADAIR COUNTY"}, {"state": "MO", "county": "Ste Genevieve"},
                             {"state": "IA", "county": "Nowhere"}], idx)
    assert set(got) == {"19001", "29186"} and un == [("IA", "Nowhere")], (got, un)
    loc = CountyLocator(geo)
    assert loc.locate(-94.5, 41.3) == "19001" and loc.locate(-90.2, 37.9) == "29186" and loc.locate(-100, 40) is None
    assert _host("https://pubfs-rma.fpac.usda.gov/pub/x.zip") == "pubfs-rma.fpac.usda.gov"
    print("selftest ok")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        selftest()
