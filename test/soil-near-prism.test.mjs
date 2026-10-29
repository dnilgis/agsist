// components/soil-near.js (measured soil at the nearest station) and components/prism.js (PRISM daily history through
// RCC-ACIS), the two readers that replaced Open-Meteo's modeled soil and its ERA5 archive (2026-10-29).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const SN = require("../components/soil-near.js");
const PR = require("../components/prism.js");

const feed = (o = {}) => ({
  net_labels: { WCN: "Wisconet", USCRN: "NOAA Climate Reference Network" }, net_urls: { WCN: "https://wisconet.wisc.edu/" },
  stations: [
    { id: "WCN:A", net: "WCN", name: "Near", lat: 45.35, lon: -91.70, last: o.last || "2026-10-28", t: o.t || [52, 51, 50, 49, 49, 48, 47, 46, 45, 44] },
    { id: "USCRN:B", net: "USCRN", name: "Far", lat: 46.5, lon: -92.5, last: "2026-10-28", t: [40, 40, 40, 40, 40, 40, 40, 40, 40, 40] },
  ],
});

test("soil: the nearest station within 50 miles, its last 3 days and its trend", () => {
  const s = SN.near(feed(), 45.31, -91.65, "2026-10-29");
  assert.equal(s.st.name, "Near");
  assert.ok(s.mi > 2 && s.mi < 5, String(s.mi));
  assert.equal(s.net, "Wisconet");
  assert.equal(s.url, "https://wisconet.wisc.edu/");
  assert.deepEqual(s.last3, [46, 45, 44]);
  assert.equal(s.now, 44);
  assert.equal(s.mean, 45);
  assert.equal(s.trend, "cooling");
});

test("soil: no current reading is no number, with the reason (old, far, a missing day, no file)", () => {
  const old = SN.near(feed({ last: "2026-10-20" }), 45.31, -91.65, "2026-10-29");
  assert.equal(old.mean, undefined);
  assert.match(old.why, /last reported 2026-10-20\. Its readings are gathered September to December/);
  assert.match(SN.near(feed(), 40.0, -100.0, "2026-10-29").why, /No soil station reports within 50 miles/);
  const hole = SN.near(feed({ t: [52, 51, 50, 49, 49, 48, 47, 46, null, 44] }), 45.31, -91.65, "2026-10-29");
  assert.equal(hole.mean, undefined);
  assert.match(hole.why, /missing a day of its last 3/);
  assert.match(SN.near(null, 45, -91, "2026-10-29").why, /did not load/);
});

test("PRISM: one GridData ask on grid 21 at the point, the page's field names back, a missing day null not 0", async () => {
  let asked = "";
  const get = async (u) => { asked = u; return { ok: true, json: async () => ({ data: [["2026-10-01", "61", "40", "0.12"], ["2026-10-02", "M", "M", "M"], ["2026-10-03", 58, 39, 0]] }) }; };
  const d = await PR.daily(42.0309, -93.6319, "2026-10-01", "2026-10-03", { get });
  const u = new URL(asked);
  assert.equal(u.origin + u.pathname, "https://data.rcc-acis.org/GridData");
  assert.deepEqual(JSON.parse(u.searchParams.get("params")), { loc: "-93.632,42.031", grid: "21", sdate: "2026-10-01", edate: "2026-10-03", elems: "maxt,mint,pcpn" });
  assert.deepEqual(d.daily.time, ["2026-10-01", "2026-10-02", "2026-10-03"]);
  assert.deepEqual(d.daily.temperature_2m_max, [61, null, 58]);
  assert.deepEqual(d.daily.temperature_2m_min, [40, null, 39]);
  assert.deepEqual(d.daily.precipitation_sum, [0.12, null, 0]);
  await assert.rejects(PR.daily(42, -93, "2026-10-01", "2026-10-03", { get: async () => ({ ok: true, json: async () => ({ error: "bad loc" }) }) }), /PRISM: bad loc/);
  await assert.rejects(PR.daily(42, -93, "2026-10-01", "2026-10-03", { get: async () => ({ ok: false, status: 503 }) }), /ACIS 503/);
});

test("every page loads one version of nws.js, soil-near.js and prism.js (count the copies)", () => {
  const files = ["index.html", "spray.html", "urea.html", "grain-emc.html", "harvest-or-wait.html", "planting-date.html", "components/geo.js", "components/spray-wind.js"];
  const v = { nws: new Set(), "soil-near": new Set(), prism: new Set() };
  for (const f of files) {
    const t = readFileSync(ROOT + f, "utf8");
    for (const k of Object.keys(v)) for (const m of t.matchAll(new RegExp("components/" + k + "\\.js\\?v=(\\d+)", "g"))) v[k].add(m[1]);
    const lazy = /nws\.js\?v=' \+ V\.nws/.test(t) ? t.match(/nws: (\d+)/) : null;
    if (lazy) v.nws.add(lazy[1]);
  }
  for (const k of Object.keys(v)) assert.equal(v[k].size, 1, k + ": " + [...v[k]].join(", "));
});
