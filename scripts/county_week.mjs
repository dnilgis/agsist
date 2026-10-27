#!/usr/bin/env node
/* "Your county this week" for the Thursday Daily (Sig, Oct 27 2026: inside the existing Daily
 * slots; no new list, sender or cron). scripts/send_daily.py runs this once per send with the
 * ZIP points of the readers who ticked it and saved a place, on stdin:
 *
 *   {"today": "YYYY-MM-DD", "index": <the bids network's merged index>,
 *    "places": [{"k": "<opaque key>", "lat": 45.3, "lng": -91.6, "st": "WI"}]}
 *
 * and reads back, on stdout, {"<k>": {"fips", "county", "st", "url", "block"}} with block null
 * when nothing changed (no block, by rule). The lines are components/change-lines.js, the same
 * code Fast Facts and the Atlas county home draw, at 30 mi. Every other file is the site's own,
 * read from this checkout. Nothing is written and nothing about a place is printed: stderr gets
 * counts only.
 *
 *   node scripts/county_week.mjs < places.json
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const L = require(path.join(ROOT, "components/change-lines.js"));
const P = require(path.join(ROOT, "components/place.js"));

const memo = new Map();
function file(rel) {
  if (!memo.has(rel)) {
    let j = null;
    try { j = JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8")); } catch (e) { j = null; }
    memo.set(rel, j);
  }
  return memo.get(rel);
}
const slug = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/* read: (repo-relative path) -> parsed JSON or null; tests hand in frozen files */
export function place(p, today, index, read = file) {
  const st = /^[A-Z]{2}$/.test(String(p.st || "")) ? p.st : null;
  if (!st || typeof p.lat !== "number" || typeof p.lng !== "number") return { status: "noplace" };
  const row = L.countyAt(read(`data/arc-plc/geo/${st}.json`), p.lat, p.lng);
  if (!row) return { status: "nocounty" };
  const fips = row[0], pct = read(`data/atlas/pct/${st}.json`), c = pct && pct.counties && pct.counties[fips];
  const stName = (pct && pct.name) || P.STATES[st] || st;
  const name = (c && c.n) || row[1];
  const prev = {};
  for (const r of L.nearCorn(index, p.lat, p.lng, L.WEEK_MI)) if (/^[A-Z]{2}$/.test(r.st) && !(r.st in prev)) prev[r.st] = read(`data/bids-prev/${r.st}.json`);
  const ss = L.SALES_STATES[st];
  const lines = L.weekLines({ fips, st, stName, name, lat: p.lat, lng: p.lng, today }, {
    drought: read("data/drought/county-week.json"), index, prev,
    states: read("data/basis-states.json"), prices: read("data/prices.json"),
    sales: ss ? read(`data/land-sales/${ss}.json`) : null,
  });
  const page = c && c.s ? `farmland-atlas/${slug(stName)}/${c.s}` : null;
  const url = page && fs.existsSync(path.join(ROOT, page + ".html")) ? "/" + page : "/fast-facts?fips=" + fips;
  return { status: "ok", fips, county: name, st, url, block: L.weekBlock(lines) };
}

export function run(input, read = file) {
  const out = {}, n = { places: 0, block: 0, nochange: 0, noplace: 0 };
  const today = String(input && input.today || "");
  const index = input && input.index && input.index.places ? input.index : null;
  for (const p of (input && input.places) || []) {
    if (!p || typeof p.k !== "string") continue;
    n.places++;
    let r;
    try { r = place(p, today, index, read); } catch (e) { r = { status: "failed" }; }
    if (r.status !== "ok") { n.noplace++; continue; }
    if (r.block) n.block++; else n.nochange++;
    out[p.k] = r;
  }
  return { out, n };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let raw = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (d) => { raw += d; });
  process.stdin.on("end", () => {
    let input = null;
    try { input = JSON.parse(raw); } catch (e) { process.stderr.write("county week: input is not JSON\n"); process.exit(2); }
    const { out, n } = run(input);
    process.stderr.write(`county week: ${n.places} place(s), ${n.block} with a change, ${n.nochange} with none, ${n.noplace} not placed\n`);
    process.stdout.write(JSON.stringify(out));
  });
}
