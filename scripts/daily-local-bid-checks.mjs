#!/usr/bin/env node
/* THE EMAIL'S LOCAL BID MUST BE THE HOMEPAGE HERO'S LOCAL BID.
 *
 *     BIDS_BASE=/path/to/bids-mirror node scripts/daily-local-bid-checks.mjs [zip ...]
 *
 * scripts/local_bid.py ports the hero's top-bid rule to Python for
 * scripts/send_daily.py. This runs BOTH on the same files at the same minute
 * and requires the same answer, field by field:
 *
 *   JS      the real components/bids-network.js and components/bids-homepage.js,
 *           evaluated whole in a stub window. A hook is appended INSIDE the
 *           homepage IIFE that runs the card's own path: loadAllBids(zip) ->
 *           groupByElevator -> mergeOnePin -> the card's own distance sort
 *           (lifted by its text from loadHomepageBids) -> topEntry, which is
 *           exactly what publishTop() hands the hero. The licensed Barchart
 *           feed is answered with a failure, as the location harness does;
 *           the email never reads that feed.
 *   Python  python3 scripts/local_bid.py --zip Z --json
 *
 * BIDS_BASE is a directory laid out like https://dnilgis.github.io/bids/
 * (data/merged-index.json, data/zips/NN.json). Unset, the files are fetched
 * from that site. Default ZIPs: 54728 (Chetek WI), 67801 (Dodge City KS),
 * 54102 (Amberg WI, nothing within 50 mi).
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE_URL = "https://dnilgis.github.io/bids/";
const LOCAL = (process.env.BIDS_BASE || "").trim();
let LOCAL_NOW = LOCAL;
const ZIPS = process.argv.slice(2).length ? process.argv.slice(2) : ["54728", "67801", "54102"];

const realFetch = globalThis.fetch;
function resp(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => JSON.parse(body), text: async () => body };
}
globalThis.fetch = async (u) => {
  u = String(u);
  if (u.startsWith(BASE_URL)) {
    const rel = u.slice(BASE_URL.length).split("?")[0];
    if (LOCAL_NOW && !/^https?:/.test(LOCAL_NOW)) {
      const p = path.join(LOCAL_NOW, rel);
      return fs.existsSync(p) ? resp(200, fs.readFileSync(p, "utf8")) : resp(404, "");
    }
    return realFetch((LOCAL_NOW || BASE_URL).replace(/\/?$/, "/") + rel);
  }
  // the licensed feed, prices.json, harvest prices: unavailable, like the harness
  throw new Error("blocked in test: " + u);
};

/* a window just big enough for both files to load and for their top-level code to run */
const noop = () => {};
const el = () => ({ style: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
  setAttribute: noop, getAttribute: () => null, appendChild: noop, insertBefore: noop, addEventListener: noop,
  querySelector: () => null, querySelectorAll: () => [] });
globalThis.window = globalThis;
globalThis.document = { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
  createElement: el, head: el(), body: el(), documentElement: el(), addEventListener: noop, readyState: "complete" };
Object.defineProperty(globalThis, "localStorage", { value: { getItem: () => null, setItem: noop, removeItem: noop }, configurable: true });
Object.defineProperty(globalThis, "location", { value: { search: "", hash: "", pathname: "/", href: "http://127.0.0.1/" }, configurable: true });
globalThis.addEventListener = noop;
globalThis.dispatchEvent = noop;
globalThis.gtag = undefined;
const warn = console.warn;
console.warn = (...a) => { if (!String(a[0]).includes("licensed bid feed")) warn(...a); };

const NET = fs.readFileSync(path.join(ROOT, "components", "bids-network.js"), "utf8");
let HOME = fs.readFileSync(path.join(ROOT, "components", "bids-homepage.js"), "utf8");

const SORT = "elevators.sort(function(a,b){ return (a.distance == null ? 999 : a.distance) - (b.distance == null ? 999 : b.distance); });";
let fails = [], pass = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
ok(HOME.includes("var elevators = mergeOnePin(groupByElevator(bids));\n        /*") && HOME.includes(SORT),
   "loadHomepageBids no longer builds elevators as mergeOnePin(groupByElevator(bids)) + this sort -- re-read it and update both this hook and scripts/local_bid.py");
const end = HOME.lastIndexOf("})();");
ok(end > 0, "bids-homepage.js IIFE end not found");
HOME = HOME.slice(0, end) +
  "\n  window.__emailTop = function(zip){ return loadAllBids(zip).then(function(bids){ var elevators = mergeOnePin(groupByElevator(bids)); " +
  SORT + " return { n: bids.length, corn: topEntry(elevators, 'corn'), soybeans: topEntry(elevators, 'soybeans'), wheat: topEntry(elevators, 'wheat') }; }); };\n" +
  HOME.slice(end);

/* Both files are evaluated afresh for each run: bids-network.js caches every
   file it reads for the page view, as a browser tab would. */
function loadScripts() {
  window.AGSIST_BIDS_NET = undefined; window.__emailTop = undefined;
  (0, eval)(NET);
  (0, eval)(HOME);
  ok(typeof window.AGSIST_BIDS_NET === "object", "bids-network.js did not load");
  ok(typeof window.__emailTop === "function", "hook not installed");
}

/* A SECOND PASS WITH MIXED FRESHNESS. A mirror's boards may all be from one
   old day, which never exercises the fresh pool, `higherOlder` or the stale
   fallback. With MIX=1 (default when BIDS_BASE is a directory) every other
   place is re-stamped as posted now, in a copy under the OS temp dir, and the
   same comparison runs again on it. */
const runs = [{ label: "as published", base: LOCAL }];
if (LOCAL && !/^https?:/.test(LOCAL) && process.env.MIX !== "0") {
  const os = await import("node:os");
  const mix = fs.mkdtempSync(path.join(os.tmpdir(), "bids-mix-"));
  fs.mkdirSync(path.join(mix, "data"), { recursive: true });
  fs.cpSync(path.join(LOCAL, "data", "zips"), path.join(mix, "data", "zips"), { recursive: true, dereference: true });
  if (fs.existsSync(path.join(LOCAL, "geocodes"))) fs.cpSync(path.join(LOCAL, "geocodes"), path.join(mix, "geocodes"), { recursive: true, dereference: true });
  const nowIso = new Date().toISOString();
  for (const parity of [0, 1]) {
    const dir = path.join(mix, "p" + parity);
    fs.mkdirSync(path.join(dir, "data"), { recursive: true });
    fs.cpSync(path.join(mix, "data", "zips"), path.join(dir, "data", "zips"), { recursive: true });
    if (fs.existsSync(path.join(mix, "geocodes"))) fs.cpSync(path.join(mix, "geocodes"), path.join(dir, "geocodes"), { recursive: true });
    const idx = JSON.parse(fs.readFileSync(path.join(LOCAL, "data", "merged-index.json"), "utf8"));
    idx.places.forEach((p, i) => { if (i % 2 === parity) { p.pricedAt = nowIso; p.checkedAt = nowIso; } });
    fs.writeFileSync(path.join(dir, "data", "merged-index.json"), JSON.stringify(idx));
    runs.push({ label: (parity ? "odd" : "even") + " boards re-stamped as posted now", base: dir });
  }
}
let sawHigherOlder = false, sawFresh = false;
const FIELDS = ["cash", "basis", "name", "town", "mi", "posted", "stale", "month", "higherOlder", "ageUnknown"];
for (const run of runs) {
LOCAL_NOW = run.base;
loadScripts();
console.log("-- " + run.label);
const env = Object.assign({}, process.env, LOCAL_NOW ? { BIDS_BASE: LOCAL_NOW } : {});
for (const zip of ZIPS) {
  let js;
  try { js = await window.__emailTop(zip); }
  catch (e) { js = { error: String(e && e.message || e) }; }
  const py = JSON.parse(execFileSync("python3", [path.join(ROOT, "scripts", "local_bid.py"), "--zip", zip, "--json"], { env, encoding: "utf8" }));
  if (js.error) { fails.push(zip + ": the homepage path threw " + js.error); continue; }
  if (!js.n) { ok(py.status === "none", zip + ": JS found no bids; Python status " + py.status); console.log(zip + "  none within 50 mi (both)"); continue; }
  ok(py.status === "ok", zip + ": JS found bids; Python status " + py.status);
  for (const crop of ["corn", "soybeans", "wheat"]) {
    const a = js[crop], b = py[crop];
    if (!a || !b) { ok(!a && !b, `${zip} ${crop}: one side has no entry (js ${!!a}, py ${!!b})`); continue; }
    for (const f of FIELDS) {
      const x = JSON.stringify(a[f] === undefined ? null : a[f]), y = JSON.stringify(b[f] === undefined ? null : b[f]);
      ok(x === y, `${zip} ${crop}.${f}: hero ${x} vs email ${y}`);
    }
  }
  const fmt = window.agsistBidFmt;
  const show = (x) => x ? `${fmt.cashText(x.cash)} ${x.name} (${x.town}, ${Math.round(x.mi)} mi${x.month ? ", " + x.month : ""}${x.stale ? ", posted " + fmt.day(x.posted) : ""})` : "none";
  console.log(`${zip}  corn ${show(js.corn)} | soybeans ${show(js.soybeans)}`);
  for (const c of ["corn", "soybeans", "wheat"]) { if (js[c] && js[c].higherOlder) sawHigherOlder = true; if (js[c] && !js[c].stale) sawFresh = true; }
}
// a fresh window per run: the network script caches files per page view
}
console.log("higherOlder seen in this data: " + (sawHigherOlder ? "yes" : "no"));
if (runs.length > 1) ok(sawFresh, "the mixed pass never produced a fresh top bid -- it tested nothing new");
// the email's quarter-cent text must be the hero's, on the numbers just compared and on edges
const fmt = window.agsistBidFmt;
const pyFmt = JSON.parse(execFileSync("python3", ["-c",
  "import json,sys;sys.path.insert(0,'scripts');import local_bid as L;v=[4.3775,4.38,4.0025,4.99875,12.1,5.3175,3.12125,4.12625];c=[-62.5,-0.5,0.1,15,-110,35.25,-0.125];" +
  "print(json.dumps({'cash':[L.q_cash_text(x) for x in v],'cents':[L.q_cents(x) for x in c]}))"], { cwd: ROOT, encoding: "utf8" }));
[4.3775, 4.38, 4.0025, 4.99875, 12.1, 5.3175, 3.12125, 4.12625].forEach((v, i) => ok(fmt.cashText(v) === pyFmt.cash[i], `cash text ${v}: hero ${fmt.cashText(v)} vs email ${pyFmt.cash[i]}`));
[-62.5, -0.5, 0.1, 15, -110, 35.25, -0.125].forEach((v, i) => ok(fmt.basis(v) === pyFmt.cents[i], `basis text ${v}: hero ${fmt.basis(v)} vs email ${pyFmt.cents[i]}`));

if (fails.length) { for (const f of fails) console.log("FAIL", f); console.log(pass + " passed, " + fails.length + " failed"); process.exit(1); }
console.log("daily-local-bid-checks: " + pass + " passed");
process.exit(0);
