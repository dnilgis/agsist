/* THE ONE QUESTION THAT MATTERS BEFORE DEPLOYING:
   when the bid network goes wrong, does the page fail soft?

   Not argued — run. The functions are lifted out of cash-bids.html and driven
   against every way the network can fail. fetchNetwork must resolve (never
   reject) to an empty set, inside its deadline, and with the off switch set it
   must make no request at all. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
/* The page script moved out of cash-bids.html into components/cash-bids.js
   (2026-10-12). Read the page and the script it loads as one text, and
   insist the page still loads that script, so the functions checked here
   are the ones the browser runs. */
const PAGE = (() => {
  const html = readFileSync(fileURLToPath(new URL("../cash-bids.html", import.meta.url)), "utf8");
  const m = html.match(/<script src="\/components\/cash-bids\.js\?v=\d+"><\/script>/);
  if (!m) { console.error("cash-bids.html no longer loads /components/cash-bids.js"); process.exit(1); }
  return html + "\n" + readFileSync(join(dirname(fileURLToPath(new URL("../cash-bids.html", import.meta.url))), "components", "cash-bids.js"), "utf8");
})();

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
               "netRowsFrom", "netContract", "fetchNetwork",
               /* The helpers netRowsFrom calls. Missing, every row
                  threw a ReferenceError here that the page never throws (the
                  same gap as network-checks.mjs). */
               "usScope", "netRankPlaces",
               "readTimeOnly"];
/* Their tables, read off the page so a changed list is a changed test. */
const pageVar = (name) => { const m = new RegExp(`var ${name}=([^;]+);`).exec(PAGE);
  if (!m) throw new Error("missing var " + name); return `var ${name}=${m[1]};\n`; };
let fetchImpl, calls = 0;
const mk = (netOn) => new Function(
  "fetch", "setTimeout", "clearTimeout", "Promise", "Math", "Number", "String",
  "Array", "JSON", "isFinite", "location",
  `var NET_ON=${netOn};\nvar NET_BASE='https://dnilgis.github.io/bids/';\n` +
  `var NET_MAX_PLACES=60;var NET_TIMEOUT_MS=2500;var NET_DEADLINE_MS=3500;var NET_DEBUG=false;function netLog(){}\n` +
  pageVar("US_STATES_OK") + pageVar("NET_LATE_TIMEOUT_MS") + pageVar("NET_TOP_PER_CROP") +
  NAMES.map(lift).join("\n")+"\n"+lift("_fetchNetworkInner") + `\nreturn {fetchNetwork};`
)((...a) => { calls++; return fetchImpl(...a); },
  setTimeout, clearTimeout, Promise, Math, Number, String, Array, JSON, isFinite,
  { search: "" });

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
  const same = Array.isArray(n.rows) && n.rows.length === 0;
  const took = Date.now() - t0;
  if (!same) bad++;
  console.log("  " + (same ? "empty    " : "CHANGED  ") + "   " +
    String(took).padStart(5) + "ms  " + String(calls).padStart(2) + " req  " + label);
}

console.log("\nWITH THE OFF SWITCH SET TO false");
fetchImpl = async () => { throw new Error("should never be called"); };
calls = 0;
const off = mk(false);
const n2 = await off.fetchNetwork("54728", 50);
const sameOff = Array.isArray(n2.rows) && n2.rows.length === 0;
if (!sameOff || calls !== 0) bad++;
console.log("  " + (sameOff ? "empty    " : "CHANGED  ") + "   requests made: " + calls +
  "  (must be 0 — off means no request at all)");

console.log(bad ? "\n" + bad + " PROBLEM(S)" : "\nEVERY FAILURE MODE FAILS SOFT");
process.exit(bad ? 1 : 0);
