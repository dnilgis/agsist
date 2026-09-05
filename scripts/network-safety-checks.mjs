/* THE ONE QUESTION THAT MATTERS BEFORE DEPLOYING:
   when the bid network goes wrong, is the page exactly what it is today?

   Not argued — run. The functions are lifted out of cash-bids.html and driven
   with a Barchart response that never changes, against every way the network
   can fail. The answer must be byte-identical rows every time. */
import { readFileSync } from "node:fs";
const PAGE = readFileSync(new URL("../cash-bids.html", import.meta.url), "utf8");

function lift(name) {
  const s = PAGE.indexOf(`function ${name}(`);
  if (s < 0) throw new Error("missing " + name);
  let d = 0, seen = false;
  for (let i = s; i < PAGE.length; i++) {
    if (PAGE[i] === "{") { d++; seen = true; }
    else if (PAGE[i] === "}") { d--; if (seen && !d) return PAGE.slice(s, i + 1); }
  }
}
const NAMES = ["classify", "netGet", "netZipCoord", "netDistanceMi", "netPlacesWithin",
               "netRowsFrom", "netKey", "netMerge", "fetchNetwork"];
let fetchImpl, calls = 0;
const mk = (netOn) => new Function(
  "fetch", "setTimeout", "clearTimeout", "Promise", "Math", "Number", "String",
  "Array", "JSON", "isFinite", "location",
  `var NET_ON=${netOn};\nvar NET_BASE='https://dnilgis.github.io/bids/';\n` +
  `var NET_MAX_PLACES=60;var NET_TIMEOUT_MS=2500;var NET_DEADLINE_MS=3500;var NET_INHERIT=['phone'];var NET_DEBUG=false;function netLog(){}\n` +
  NAMES.map(lift).join("\n")+"\n"+lift("_fetchNetworkInner") + `\nreturn {fetchNetwork,netMerge};`
)((...a) => { calls++; return fetchImpl(...a); },
  setTimeout, clearTimeout, Promise, Math, Number, String, Array, JSON, isFinite,
  { search: "" });

/* A Barchart response, fixed, exactly as flatten() would leave it. */
const BARCHART = [
  { facility: "CDR Farms LLC", city: "Bloomer", state: "WI", commodity: "Corn", cashPrice: 3.91, basis: -0.45 },
  { facility: "Meyer Brothers Grain", city: "Elk Mound", state: "WI", commodity: "Soybeans", cashPrice: 9.7, basis: 0 },
  { facility: "Somebody Else Co", city: "Menomonie", state: "WI", commodity: "Corn", cashPrice: 3.88, basis: -0.48 },
];
const baseline = JSON.stringify(BARCHART);

const FAILURES = [
  ["the whole feed is offline", async () => { throw new Error("network down"); }],
  ["GitHub Pages returns 404", async () => ({ ok: false, status: 404, json: async () => null })],
  ["GitHub Pages returns 500", async () => ({ ok: false, status: 500, json: async () => null })],
  ["the JSON is malformed", async () => ({ ok: true, status: 200, json: async () => { throw new Error("bad json"); } })],
  ["the body is empty", async () => ({ ok: true, status: 200, json: async () => null })],
  ["the index has no places array", async () => ({ ok: true, status: 200, json: async () => ({ counts: {} }) })],
  ["a shard is a string, not an object", async () => ({ ok: true, status: 200, json: async () => "nope" })],
  ["every request hangs past the timeout", () => new Promise(() => {})],
];

let bad = 0;
console.log("WITH THE NETWORK ON, AND BROKEN IN EVERY WAY IT CAN BREAK\n");
for (const [label, impl] of FAILURES) {
  fetchImpl = impl; calls = 0;
  const M = mk(true);
  const t0 = Date.now();
  const n = await M.fetchNetwork("54728", 50);
  const merged = M.netMerge(BARCHART, n.rows);
  const same = JSON.stringify(merged.rows) === baseline;
  const took = Date.now() - t0;
  if (!same) bad++;
  console.log("  " + (same ? "identical" : "CHANGED  ") + "   " +
    String(took).padStart(5) + "ms  " + String(calls).padStart(2) + " req  " + label);
}

console.log("\nWITH THE OFF SWITCH SET TO false");
fetchImpl = async () => { throw new Error("should never be called"); };
calls = 0;
const off = mk(false);
const n2 = await off.fetchNetwork("54728", 50);
const merged2 = off.netMerge(BARCHART, n2.rows);
const sameOff = JSON.stringify(merged2.rows) === baseline;
if (!sameOff || calls !== 0) bad++;
console.log("  " + (sameOff ? "identical" : "CHANGED  ") + "   requests made: " + calls +
  "  (must be 0 — off means no request at all)");

console.log("\nAND WHEN IT WORKS, IT ONLY EVER ADDS OR REPLACES A DUPLICATE");
const ours = [{ facility: "CDR Farms LLC", city: "Bloomer", state: "WI", commodity: "Corn", cashPrice: 4.47, basis: -0.89, via: "direct" }];
const good = mk(true).netMerge(BARCHART, ours);
const kept = good.rows.filter((r) => !r.via).length;
const lost = BARCHART.filter((b) => !good.rows.some((r) => r.facility === b.facility && r.city === b.city && !r.via)).length;
console.log("  Barchart rows in:  " + BARCHART.length);
console.log("  Barchart rows out: " + kept + "  (1 replaced by the elevator's own board)");
console.log("  dropped for any reason other than being our duplicate: " +
  (lost - good.duplicatesResolved));
if (lost - good.duplicatesResolved !== 0) bad++;

console.log(bad ? "\n" + bad + " PROBLEM(S)" : "\nEVERY FAILURE MODE LEAVES THE PAGE EXACTLY AS IT IS TODAY");
process.exit(bad ? 1 : 0);
