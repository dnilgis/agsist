#!/usr/bin/env python3
"""Writes the transport fixtures (synthetic, deterministic). NOT real data.

The shapes follow the AgTransport catalogue for each dataset as far as it
could be read from the sandbox (no live file reached it). Column names for
deqi-uken, 8uye-ieij and v85y-3hep are probe-verified (fetch_transport.py);
every other dataset's names here are a guess the fetcher must not depend on:
it matches columns by pattern from the dataset's own metadata. Replace these
with real samples from data/transport/moves/index.json ("sample",
"columns_used") once the first Actions run has written them.

    python3 test/fixtures/transport/make_fixtures.py OUT_DIR

Only this generator is committed (about 2.5 MB of rows would otherwise sit in
the public repo); scripts/fetch_grain_moves.py --selftest writes them to a
temporary folder and reads them from there.
"""
import json
import math
import os
import sys
from datetime import date, timedelta

D = sys.argv[1] if len(sys.argv) > 1 else None
if not D:
    raise SystemExit("usage: make_fixtures.py OUT_DIR")
os.makedirs(D, exist_ok=True)
START, END = date(2020, 10, 6), date(2026, 10, 20)


def weeks(weekday):
    d = START + timedelta(days=(weekday - START.weekday()) % 7)
    while d <= END:
        yield d
        d += timedelta(days=7)


def season(d, peak_doy=290, width=45):
    x = (d.timetuple().tm_yday - peak_doy + 183) % 366 - 183
    return math.exp(-(x / width) ** 2)


def wobble(i, k=1):
    return math.sin(i * 0.37 * k) * 0.5 + math.sin(i * 0.11 + k) * 0.5


def iso(d):
    return d.isoformat() + "T00:00:00.000"


def meta(ds, cols):
    return {"id": ds, "name": f"fixture {ds}", "rowsUpdatedAt": 0,
            "columns": [{"fieldName": ":id", "name": "id", "dataTypeName": "meta_data"}] +
                       [{"fieldName": f, "name": n, "dataTypeName": t} for f, n, t in cols]}


def put(ds, cols, rows):
    json.dump(meta(ds, cols), open(os.path.join(D, f"{ds}.meta.json"), "w"), separators=(",", ":"))
    json.dump(rows, open(os.path.join(D, f"{ds}.rows.json"), "w"), separators=(",", ":"))


# barge rates: Tuesdays, 7 locations
LOCS = {"Twin Cities": 1.05, "Mid-Mississippi": 1.0, "Lower Illinois": 1.0, "St. Louis": 0.85,
        "Cincinnati": 0.95, "Lower Ohio": 0.95, "Cairo-Memphis": 0.75}
barge = []
for i, d in enumerate(weeks(1)):
    yr = (d.year - 2020) * 0.07
    for loc, k in LOCS.items():
        if loc == "Twin Cities" and d.month in (12, 1, 2, 3):
            continue  # the upper river closes for winter
        v = (380 + 650 * season(d) + 90 * wobble(i)) * k * (1 + yr * (1 if i % 2 else 0.8))
        barge.append({"date": iso(d), "location": loc, "rate": str(round(v, 2))})
put("deqi-uken", [("date", "Date", "calendar_date"), ("location", "Location", "text"), ("rate", "Rate", "number")], barge)
spread_stl = {r["date"][:10]: float(r["rate"]) for r in barge if r["location"] == "St. Louis"}

# secondary railcar: Thursdays, BNSF/UP, shuttle and non-shuttle, three delivery months
rail = []
for i, d in enumerate(weeks(3)):
    for rr, base in (("BNSF", 1.0), ("UP", 0.8)):
        for sh in (True, False):
            for k in range(3):
                m = (d.month - 1 + k) % 12 + 1
                y = d.year + (1 if d.month - 1 + k >= 12 else 0)
                mag = 1.0 if sh else 0.12
                v = (-150 + 1600 * season(d, 285, 55) + 300 * wobble(i, 2) - 120 * k) * base * mag
                rail.append({"report_date": iso(d), "railroad": rr, "delivery_month": date(y, m, 1).strftime("%b %Y"),
                             "shuttle": "true" if sh else "false", "average_bid": str(round(v)),
                             "average_offer": str(round(v + 150))})
put("cvu8-kpyk", [("report_date", "Report Date", "calendar_date"), ("railroad", "Railroad", "text"),
                  ("delivery_month", "Delivery Month", "text"), ("shuttle", "Shuttle", "checkbox"),
                  ("average_bid", "Average Bid", "number"), ("average_offer", "Average Offer", "number")], rail)

# lock tons: Saturdays
locks = []
for i, d in enumerate(weeks(5)):
    for lock, k in (("Mississippi River Lock 27", 1.0), ("Illinois River LaGrange Lock", 0.45),
                    ("Ohio River Olmsted Locks and Dam", 0.6), ("Arkansas River Lock 1", 0.08)):
        tot = (420 + 700 * season(d, 300, 50) + 80 * wobble(i, 3)) * 1000 * k
        locks.append({"week_ending": iso(d), "lock": lock, "corn": str(round(tot * .55)),
                      "soybeans": str(round(tot * .38)), "wheat": str(round(tot * .07)), "total": str(round(tot))})
put("n4pw-9ygw", [("week_ending", "Week Ending", "calendar_date"), ("lock", "Lock", "text"), ("corn", "Corn", "number"),
                  ("soybeans", "Soybeans", "number"), ("wheat", "Wheat", "number"), ("total", "Total", "number")], locks)

# car orders past due: Fridays
co = []
for i, d in enumerate(weeks(4)):
    for rr, k in (("BNSF", 1.0), ("UP", 0.7), ("CSX", 0.2)):
        v = max(0, (200 + 1500 * season(d, 300, 40) + 250 * wobble(i, 4)) * k)
        co.append({"date": iso(d), "railroad": rr, "past_due_1_10_days": str(round(v * .7)),
                   "past_due_11_days": str(round(v * .3))})
put("57pa-stwn", [("date", "Date", "calendar_date"), ("railroad", "Railroad", "text"),
                  ("past_due_1_10_days", "Past Due 1-10 Days", "number"),
                  ("past_due_11_days", "Past Due 11+ Days", "number")], co)

# train speed
sp = []
for i, d in enumerate(weeks(4)):
    for rr in ("BNSF", "UP"):
        for tt, b in (("Grain Unit", 23.5), ("Intermodal", 31)):
            sp.append({"date": iso(d), "railroad": rr, "train_type": tt,
                       "speed_mph": str(round(b - 2.5 * season(d, 30, 40) + .8 * wobble(i, 5), 1))})
put("2wy9-nmz4", [("date", "Date", "calendar_date"), ("railroad", "Railroad", "text"),
                  ("train_type", "Train Type", "text"), ("speed_mph", "Speed (mph)", "number")], sp)

# carloads
cl = []
for i, d in enumerate(weeks(5)):
    for rr, k in (("BNSF", .4), ("UP", .3), ("CSX", .1)):
        cl.append({"week_ending": iso(d), "railroad": rr, "commodity": "Grain",
                   "carloads": str(round((19000 + 6000 * season(d, 300, 60) + 900 * wobble(i, 6)) * k))})
        cl.append({"week_ending": iso(d), "railroad": rr, "commodity": "Grain Mill Products",
                   "carloads": str(round(4000 * k))})
put("tb7q-kn5i", [("week_ending", "Week Ending", "calendar_date"), ("railroad", "Railroad", "text"),
                  ("commodity", "Commodity", "text"), ("carloads", "Carloads", "number")], cl)

# inspections: already grouped (the fetcher asks Socrata to sum by week and region)
ins = []
for i, d in enumerate(weeks(3)):
    for reg, k in (("Mississippi Gulf", .55), ("Texas Gulf", .07), ("Pacific Northwest", .3), ("Interior", .08)):
        ins.append({"wk": iso(d), "region": reg,
                    "t": str(round((1.4e6 + 9e5 * season(d, 320, 60) + 1.5e5 * wobble(i, 7)) * k))})
put("sruw-w49i", [("week_ending_date", "Week Ending Date", "calendar_date"), ("port_region", "Port Region", "text"),
                  ("grain", "Grain", "text"), ("metric_tons", "Metric Tons", "number")], ins)

# ocean: Thursdays
oc = []
for i, d in enumerate(weeks(3)):
    g = 48 + 10 * season(d, 300, 60) + 4 * wobble(i, 8)
    p = 27 + 4 * season(d, 300, 60) + 2 * wobble(i, 9)
    oc.append({"date": iso(d), "gulf_to_japan": str(round(g, 2)), "pnw_to_japan": str(round(p, 2)),
               "spread": str(round(g - p, 2))})
put("kscj-g8km", [("date", "Date", "calendar_date"), ("gulf_to_japan", "Gulf to Japan", "number"),
                  ("pnw_to_japan", "PNW to Japan", "number"), ("spread", "Spread", "number")], oc)

# vessels
ve = []
for i, d in enumerate(weeks(3)):
    for reg, k in (("Gulf", 1.0), ("Pacific Northwest", .55)):
        ve.append({"date": iso(d), "port_region": reg, "in_port": str(round((20 + 15 * season(d, 320)) * k)),
                   "loaded_last_7_days": str(round((22 + 18 * season(d, 320) + 3 * wobble(i, 10)) * k)),
                   "due_next_10_days": str(round((35 + 25 * season(d, 320)) * k))})
put("uiht-9xts", [("date", "Date", "calendar_date"), ("port_region", "Port Region", "text"),
                  ("in_port", "Vessels In Port", "number"), ("loaded_last_7_days", "Loaded Last 7 Days", "number"),
                  ("due_next_10_days", "Due Next 10 Days", "number")], ve)

# cost indicators (real column names)
ci = []
for i, d in enumerate(weeks(2)):
    ci.append({"date": iso(d), "week": str(d.isocalendar()[1]), "month": str(d.month), "year": str(d.year),
               "truck": str(round(220 + 15 * wobble(i, 11))), "shuttle_train": str(round(130 + 8 * wobble(i, 12))),
               "barge": str(round(180 + 160 * season(d), 2)), "gulf_vessel": str(round(190 + 20 * wobble(i, 13), 2)),
               "pacific_vessel": str(round(175 + 15 * wobble(i, 14), 2))})
put("8uye-ieij", [(k, k.replace("_", " ").title(), "calendar_date" if k == "date" else ("text" if k in ("week", "month", "year") else "number"))
                  for k in ("date", "week", "month", "year", "truck", "shuttle_train", "barge", "gulf_vessel", "pacific_vessel")], ci)

# USDA regional basis (real column names): basis responds to St. Louis barge for river states
gb = []
for i, d in enumerate(weeks(4)):
    stl = spread_stl.get((d - timedelta(days=3)).isoformat())
    for st, base, k in (("Illinois", -.30, -.00045), ("Indiana", -.32, -.0004), ("Ohio", -.38, -.0003),
                        ("Nebraska", -.25, -.0001), ("Kansas", -.20, -.00008), ("South Dakota", -.55, -.0001),
                        ("North Dakota", -.65, -.0001), ("Iowa", -.35, -.0003), ("Minnesota", -.50, -.0002)):
        for crop, off in (("Corn", 0), ("Soybeans", -.25)):
            v = base + off - .12 * season(d, 285, 40) + .05 * wobble(i, 15 + len(st))
            if stl is not None:
                v += k * (stl - 600)
            gb.append({"date": iso(d), "market_name": st, "market_type": "Elevator Bid", "commodity": crop,
                       "basis": str(round(v, 3))})
json.dump(gb, open(os.path.join(D, "v85y-3hep.rows.json"), "w"), separators=(",", ":"))

# USGS daily stage (legacy WaterServices JSON shape)
for site, b in (("07010000", 12.0), ("07032000", 8.0)):
    vals = []
    d = date(2023, 10, 20)
    i = 0
    while d <= END:
        v = b + 12 * season(d, 140, 50) - 9 * season(d, 290, 40) + 2.5 * wobble(i, 16)
        vals.append({"value": f"{v:.2f}", "qualifiers": ["A"], "dateTime": iso(d)})
        d += timedelta(days=1)
        i += 1
    json.dump({"value": {"timeSeries": [{"variable": {"noDataValue": -999999.0},
                                         "values": [{"value": vals}]}]}},
              open(os.path.join(D, f"usgs-{site}.json"), "w"), separators=(",", ":"))
print("fixtures written to", D)
