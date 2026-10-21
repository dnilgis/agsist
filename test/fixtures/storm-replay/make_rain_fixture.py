#!/usr/bin/env python3
"""Writes test/fixtures/storm-replay/rain.bin and rain-index.json: a made-up
radar rain file for the storm replay tests, in the real RR01 format
(scripts/radar_rain.py write_bin). 1.20 in over the field near Chetek,
falling off around it; 24 hours ending 7 AM CDT Wed Jul 15, 2026.

    python3 test/fixtures/storm-replay/make_rain_fixture.py
"""
import json, os, sys
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "..", "scripts"))
import radar_rain as rr  # noqa: E402

LAT, LON = 45.36, -91.70
x0, y0, d, nx, ny = -93.0, 46.6, 0.04, 70, 60
lons = x0 + np.arange(nx) * d
lats = y0 - np.arange(ny) * d
LN, LT = np.meshgrid(lons, lats)
dist = np.hypot((LN - LON) * 0.7, LT - LAT)
along = (LN - LON) * 0.47 - (LT - LAT) * 0.88
q24 = np.round(120 * np.exp(-(dist / 0.32) ** 2) * (1 + 0.15 * np.sin(along * 30))).astype(np.int32)
c = int(round((LON - x0) / d)); r = int(round((y0 - LAT) / d))
q24[r, c] = 120
q24[r - 9:r - 7, c + 20:c + 22] = -1           # a small radar gap, drawn as no data
q3 = q24 + 35
hdr = {"schema": "agsist-radar-rain/1", "st": "WI", "source": "fixture", "data_end": "2026-07-15T12:00:00Z",
       "x0": x0, "y0": y0, "d": d, "nx": nx, "ny": ny, "unit": "0.01 in", "missing": -1, "gauge_day_end": "12:00Z", "gauges": []}
wins = [({"id": "24h", "start": "2026-07-14T12:00:00Z", "end": "2026-07-15T12:00:00Z", "hours": 24, "blanked": 0}, q24),
        ({"id": "3d", "start": "2026-07-12T12:00:00Z", "end": "2026-07-15T12:00:00Z", "hours": 72, "blanked": 0}, q3)]
rr.write_bin(os.path.join(HERE, "rain.bin"), hdr, wins)
idx = {"schema": "agsist-radar-rain/1", "data_end": "2026-07-15T12:00:00Z",
       "windows": {"24h": {"start": "2026-07-14T12:00:00Z", "end": "2026-07-15T12:00:00Z", "hours": 24}},
       "states": {"WI": [x0 - 0.02, y0 - ny * d, x0 + nx * d, y0 + 0.02]}}
json.dump(idx, open(os.path.join(HERE, "rain-index.json"), "w"), separators=(",", ":"))
h, g = rr.read_bin(os.path.join(HERE, "rain.bin"))
assert rr.lookup(h, g["24h"], LAT, LON) == 120, rr.lookup(h, g["24h"], LAT, LON)
print("wrote rain.bin", os.path.getsize(os.path.join(HERE, "rain.bin")), "bytes")
