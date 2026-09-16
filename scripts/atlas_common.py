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
  both sides (case, punctuation, "County", "St."/"Saint") and joins on
  (state, name). A name that does not match is returned in `unmatched` and
  logged; it is never guessed.
"""

import json
import os
import re
import sys
import time
import urllib.request

UA = "AGSIST-automation/1.0 (+https://agsist.com/farmland-atlas)"
GEO = "data/atlas/counties.geo.json"
PROXY_BASE = os.environ.get("RMA_PROXY_BASE", "").strip().rstrip("/")
PROXIED_HOSTS = {"pubfs-rma.fpac.usda.gov"}
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
                        + ("switching to the proxy" if PROXY_BASE else "no RMA_PROXY_BASE set"))
                    break
                time.sleep(10)
    raise RuntimeError(f"{url}: no route answered ({type(last).__name__}: {last})")


# ---------------------------------------------------------------- county names

_SAINT = re.compile(r"\b(st|ste)\.?\s", re.I)


def norm_name(name):
    """'St. Clair County' -> 'saint clair'; "O'Brien" -> 'obrien'; 'DeKalb' -> 'dekalb'."""
    s = (name or "").strip().lower()
    s = re.sub(r"\s+(county|parish|borough)$", "", s)
    s = _SAINT.sub(lambda m: "sainte " if m.group(1).lower() == "ste" else "saint ", s)
    s = re.sub(r"[^a-z0-9]+", "", s)
    return s


def load_geometry(path=GEO):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def county_index(geo=None):
    """{(ST, normalised name): fips} from the Atlas geometry.
    One collision exists in the Atlas: Missouri's St. Louis County (29189) and
    the independent St. Louis city (29510) share a name. The lower FIPS (the
    county) keeps the plain key; the other is registered as "<name> city", which
    is how federal files label an independent city. Any new collision is logged."""
    geo = geo or load_geometry()
    idx = {}
    for ft in sorted(geo["features"], key=lambda f: f["id"]):
        key = (ft["properties"]["st"], norm_name(ft["properties"]["name"]))
        if key in idx:
            alt = (key[0], key[1] + "city")
            log(f"  county_index: {key[0]} {ft['properties']['name']!r} is both {idx[key]} and {ft['id']}; {ft['id']} registered as {alt[1]!r}")
            idx[alt] = ft["id"]
            continue
        idx[key] = ft["id"]
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
    geo = {"features": [
        {"id": "19001", "properties": {"name": "Adair", "st": "IA"},
         "geometry": {"type": "Polygon", "coordinates": [[[-94.7, 41.1], [-94.2, 41.1], [-94.2, 41.5], [-94.7, 41.5], [-94.7, 41.1]]]}},
        {"id": "29186", "properties": {"name": "Ste. Genevieve", "st": "MO"},
         "geometry": {"type": "MultiPolygon", "coordinates": [[[[-90.5, 37.7], [-90.0, 37.7], [-90.0, 38.1], [-90.5, 38.1], [-90.5, 37.7]]]]}}]}
    geo["features"].append({"id": "29510", "properties": {"name": "St. Louis", "st": "MO"}, "geometry": {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 0]]]}})
    geo["features"].append({"id": "29189", "properties": {"name": "St. Louis", "st": "MO"}, "geometry": {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 0]]]}})
    idx = county_index(geo)
    assert idx[("MO", "saintlouis")] == "29189" and idx[("MO", "saintlouiscity")] == "29510", idx
    got_c, _ = names_to_fips([{"state": "MO", "county": "ST. LOUIS CITY"}, {"state": "MO", "county": "St. Louis (city)"}, {"state": "MO", "county": "St. Louis County"}], idx)
    assert set(got_c) == {"29510", "29189"} and len(got_c["29510"]) == 2, got_c
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
