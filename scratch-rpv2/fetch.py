# Mockup data fetch for the Rain Print v2 mockups (fx/rpv2 only, never main).
import json, urllib.request, urllib.parse, time, os
OUT = "scratch-rpv2/out"; os.makedirs(OUT, exist_ok=True)
def get(url, name):
    for k in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "agsist-mockup"}), timeout=120) as r:
                b = r.read()
            open(f"{OUT}/{name}.json", "wb").write(b); print("ok", name, len(b)); return json.loads(b)
        except Exception as e:
            print("retry", name, e); time.sleep(5 * (k + 1))
    print("FAILED", name); return None
A = "https://data.rcc-acis.org/"
meta = get(A + "StnMeta?" + urllib.parse.urlencode({"bbox": "-94.220,41.435,-93.020,42.635", "elems": "pcpn,snow,maxt,mint", "meta": "name,sids,ll,valid_daterange,state,elev"}), "meta")
sids = ["USC00130200", "USW00094989", "USC00135769", "USC00134735"]  # Ames 8 WSW, Ames Muni AP, plus spares picked below
if meta:
    import math
    near = []
    for m in meta["meta"]:
        lon, lat = m.get("ll", [0, 0])
        d = math.hypot((lon + 93.637) * 74, (lat - 42.060) * 69)
        vr = m.get("valid_daterange", [])
        start = min([r[0] for r in vr if r]) if vr and any(vr) else "9999"
        near.append((d, start, m["name"], m["sids"][0].split()[0], m["sids"]))
    near.sort()
    open(f"{OUT}/near.txt", "w").write("\n".join(f"{d:.1f} mi {s} {n} {sid} {x}" for d, s, n, sid, x in near))
    long_ = [x for x in near if x[0] < 25 and x[1] < "1960"]
    for x in long_[:4]:
        if x[3] not in sids: sids.append(x[3])
for sid in sids[:6]:
    get(A + "StnData?" + urllib.parse.urlencode({"sid": sid, "sdate": "por", "edate": "2025-12-31", "elems": "pcpn,snow,maxt,mint", "meta": "name,sids,ll,valid_daterange"}), "por_" + sid)
    p = {"sid": sid, "sdate": "2012-01-01", "edate": "2012-12-31", "elems": [{"name": "pcpn", "normal": "91"}, {"name": "maxt", "normal": "91"}, {"name": "mint", "normal": "91"}], "meta": "name,ll"}
    get(A + "StnData?params=" + urllib.parse.quote(json.dumps(p)), "normal_" + sid)
for sid in ["US1IASR0005"]:
    p = {"sid": sid, "sdate": "2012-01-01", "edate": "2012-12-31", "elems": [{"name": "maxt", "normal": "91"}, {"name": "mint", "normal": "91"}], "meta": "name,ll"}
    get(A + "StnData?params=" + urllib.parse.quote(json.dumps(p)), "normal_" + sid)
# the GDU calculator's own normal source: Open-Meteo ERA5 archive, 1991-2020, at the print's gauge
get("https://archive-api.open-meteo.com/v1/archive?" + urllib.parse.urlencode({"latitude": 42.06036, "longitude": -93.63715, "start_date": "1991-01-01", "end_date": "2020-12-31", "daily": "temperature_2m_max,temperature_2m_min", "temperature_unit": "fahrenheit", "timezone": "America/Chicago"}), "openmeteo_1991_2020")
get("https://archive-api.open-meteo.com/v1/archive?" + urllib.parse.urlencode({"latitude": 42.06036, "longitude": -93.63715, "start_date": "2012-01-01", "end_date": "2012-12-31", "daily": "temperature_2m_max,temperature_2m_min", "temperature_unit": "fahrenheit", "timezone": "America/Chicago"}), "openmeteo_2012")
