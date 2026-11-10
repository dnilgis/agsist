// /rain-radar compares radar with the county gauges read in the morning:
// NOAA co-op (ACIS sid type 2) and CoCoRaHS. Story County IA heads its page
// with the Gilbert CoCoRaHS gauge; a co-op-only rule dropped it, so the radar
// page compared against the farther Boone gauge. Airports (type 1, days
// ending at midnight) and SNOTEL mountain sites (net "noaa", sid type 6)
// stay out.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function py(code) {
  return execFileSync("python3", ["-c", code], { cwd: ROOT, encoding: "utf8" });
}

test("the real station records: Gilbert and Boone kept, an airport and a SNOTEL site left out", () => {
  const out = py(`
import sys, json; sys.path.insert(0, "scripts")
from radar_rain import morning_gauge
rows = [
  {"ll": [-93.6511, 42.1079], "name": "Gilbert, 0.2 mi W", "net": "cocorahs", "sid": "US1IASR0019 6"},
  {"ll": [-93.8909, 42.0417], "name": "Boone", "net": "noaa", "sid": "130807 2"},
  {"ll": [-92.4013, 42.5544], "name": "Waterloo Municipal Airport", "net": "noaa", "sid": "94910 1"},
  {"ll": [-113.33, 48.3], "name": "Pike Creek", "net": "noaa", "sid": "USS0013A26S 6"},
  {"ll": [-111.6, 42.05], "name": "Franklin Basin", "net": "noaa", "sid": "USS0011G32S 6"},
]
print(json.dumps([morning_gauge(r) for r in rows]))`);
  assert.deepEqual(JSON.parse(out), [true, true, false, false, false]);
});

test("Iowa's live gauge list: every CoCoRaHS county station is in, no airport is", () => {
  // Live data: accept whatever station each county heads with today, and
  // check the list follows the rule for it.
  const out = py(`
import sys, json, datetime as dt; sys.path.insert(0, "scripts")
import radar_rain as RR
d = json.load(open("data/rain/ia.json"))
dd = json.load(open("data/rain/daily/ia.json"))
end = dt.date.fromisoformat(dd.get("edate") or d.get("edate"))
g, _ = RR.gauge_days("IA", end)
bad, coco, story = [], 0, None
for f, c in d["counties"].items():
    s = c.get("station") or {}
    sid = str(s.get("sid", ""))
    kept = f in g
    if s.get("net") == "cocorahs" and s.get("ll") and f in dd["counties"]:
        coco += 1
        if not kept: bad.append(("dropped", c["name"], sid))
    if sid.endswith(" 1") and kept: bad.append(("airport kept", c["name"], sid))
    if c.get("name") == "Story County": story = [s.get("name"), s.get("net"), kept]
print(json.dumps({"bad": bad, "coco": coco, "story": story}))`);
  const r = JSON.parse(out);
  assert.deepEqual(r.bad, []);
  if (r.story && r.story[1] === "cocorahs") assert.equal(r.story[2], true, "Story County's CoCoRaHS gauge is on the radar page");
});
