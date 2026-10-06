#!/usr/bin/env python3
"""The stored USDA basis file holds no point outside the plausible band, and
every rejected point is listed with its reason. Fails on the -10.248 Atlantic
Coast soybean week that shipped before the guard (2026-10-06)."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fetch_transport as T  # noqa: E402

d = json.loads((Path(__file__).resolve().parent.parent / "data/transport/basis.json").read_text())
band = d.get("band", T.BASIS_BAND)
bad = []
for k, s in d["series"].items():
    for f in ("latest", "avg5"):
        if s.get(f) is not None and abs(s[f]) > band:
            bad.append((k, f, s[f]))
    bad += [(k, dt, v) for dt, v in s.get("hist", []) if abs(v) > band]
assert not bad, f"basis outside +/-{band} $/bu in data/transport/basis.json: {bad}"
for r in d.get("rejected", []):
    assert r.get("series") and r.get("date") and r.get("reason"), r
    assert abs(r["value"]) > band, f"listed as rejected but inside the band: {r}"
print(f"basis band ok: {len(d['series'])} series inside +/-{band} $/bu, {len(d.get('rejected', []))} rejected point(s) listed")
