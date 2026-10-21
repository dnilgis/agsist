#!/usr/bin/env node
/* scripts/fetch_rain_print_examples.mjs, side-branch version: a one-time data
 * run for four St. Croix Falls, WI designs (2024 and 2025, Roots and Staircase,
 * every layer on). It opens rain-print.html itself (scripts/rp_record_page.mjs)
 * and saves every NOAA RCC-ACIS and Open-Meteo geocoding answer the page asks
 * for, to data/rain-print-examples/st-croix-falls-wi.json. Nothing is made up:
 * a request that fails is saved as failed and the run says so.
 * If the town lookup fails, the next spelling of the town is tried.
 *   --check  nothing to check offline here; exits 0
 */
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, renameSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

if (process.argv.includes("--check")) process.exit(0);
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const OUT = ROOT + "data/rain-print-examples/st-croix-falls-wi.json";
const PW_DIR = "/tmp/rp-pw";
const out = (s) => process.stdout.write(s + "\n");
const esc = (s) => String(s).replace(/%/g, "%25").replace(/\r/g, "").replace(/\n/g, "%0A");

mkdirSync(PW_DIR, { recursive: true });
execFileSync("npm", ["init", "-y"], { cwd: PW_DIR, stdio: "ignore" });
execFileSync("npm", ["install", "--no-audit", "--no-fund", "playwright-core@1.56.1"], { cwd: PW_DIR, stdio: "inherit" });
const env = Object.assign({}, process.env, { PLAYWRIGHT_PATH: PW_DIR + "/node_modules/playwright-core/index.mjs", CHROMIUM_PATH: "/usr/bin/google-chrome" });

const MARKS = {
  2025: [["2025-03-17", "1065 & 1120-S"], ["2025-04-15", "Tax Day"], ["2025-06-16", "Q2 estimates"], ["2025-09-15", "Q3 + extended"], ["2025-10-15", "Extended 1040"]],
  2024: [["2024-03-15", "1065 & 1120-S"], ["2024-04-15", "Tax Day"], ["2024-06-17", "Q2 estimates"], ["2024-09-16", "Q3 + extended"], ["2024-10-15", "Extended 1040"]],
};
function query(place, year, style) {
  const q = new URLSearchParams();
  q.set("place", place); q.set("year", String(year)); q.set("layout", "staircase"); q.set("palette", "paper"); q.set("size", "12x18");
  q.set("cmp", "normal"); q.set("style", style); q.set("normals", "1"); q.set("records", "1");
  if (style === "r1") q.set("hist", "1");
  q.set("frost", "1"); q.set("heat", "1"); q.set("ribbon", "1");
  MARKS[year].forEach(([d, l], i) => q.set("m" + (i + 1), d + " " + l));
  return q.toString();
}
const PRINTS = [[2025, "r2"], [2025, "r1"], [2024, "r2"], [2024, "r1"]];
const PLACES = ["St. Croix Falls, WI", "Saint Croix Falls, WI", "54024"];

const summary = [];
let kept = false;
for (const place of PLACES) {
  const tmp = ROOT + "data/rain-print-examples/.try.json";
  const r = spawnSync("node", [ROOT + "scripts/rp_record_page.mjs", tmp, ...PRINTS.map(([y, s]) => query(place, y, s))], { env, stdio: "inherit", timeout: 600000 });
  if (!existsSync(tmp)) { summary.push(place + ": no file (exit " + r.status + ")"); continue; }
  const got = JSON.parse(readFileSync(tmp, "utf8"));
  const pages = got.pages || [];
  pages.forEach((p) => summary.push(place + " | " + (p.query || "").replace(/&m\d=.*$/, "").slice(0, 120) + " | station " + p.station + " | " + (p.status || "").slice(0, 160) + " | " + (p.source || "").slice(0, 200) + (p.why && p.why.length ? " | why: " + p.why.join(" / ") : "") + (p.errors && p.errors.length ? " | ERR " + p.errors.join(" / ").slice(0, 200) : "")));
  const ok = pages.length === PRINTS.length && pages.every((p) => p.station && /^Drawn from the records/.test(p.status || "") && !(p.errors || []).length);
  const found = pages.some((p) => p.station);
  if (ok || found) { renameSync(tmp, OUT); kept = true; summary.push("kept: " + place + (ok ? " (all 4 drawn)" : " (some pages failed)")); break; }
  summary.push("town lookup or drawing failed for " + place + ", trying the next spelling");
}
out("::warning title=cpa data run summary::" + esc(summary.join("\n")));
summary.forEach((s) => out("SUMMARY " + s));
if (!kept) { out("::error title=cpa data run::no usable answers saved"); process.exit(1); }
