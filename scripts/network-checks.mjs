#!/usr/bin/env node
/* THE BID NETWORK, CHECKED AGAINST THE PAGE ITSELF.
 *
 * Fourth in the family with basis-, delivery- and futures-checks, and built
 * the same way and for the same reason: it LIFTS the functions out of
 * cash-bids.html and runs those, rather than keeping a copy here. A checker
 * with its own copy of the logic passes forever after the page stops using it,
 * which is the failure this repository has hit more than once.
 *
 *     node scripts/network-checks.mjs
 *
 * Offline is fine. Every check below runs against fixtures written from the
 * real published bytes; the two live checks skip with a printed note when
 * dnilgis.github.io cannot be reached, and never fail for that reason.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PAGE = readFileSync(join(ROOT, "cash-bids.html"), "utf8");

let pass = 0;
const fails = [];
const ok = (cond, msg) => { if (cond) pass++; else fails.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── LIFT, DO NOT COPY ─────────────────────────────────────────────────────
 * Each function is cut from the page by its own source text. If it is renamed
 * or deleted, this file stops finding it and says so, instead of testing a
 * ghost. */
function lift(name) {
  const start = PAGE.indexOf(`function ${name}(`);
  if (start < 0) return null;
  let depth = 0, seen = false;
  for (let i = start; i < PAGE.length; i++) {
    const c = PAGE[i];
    if (c === "{") { depth++; seen = true; }
    else if (c === "}") { depth--; if (seen && depth === 0) return PAGE.slice(start, i + 1); }
  }
  return null;
}

const NAMES = ["classify", "netZipCoord", "netDistanceMi", "netPlacesWithin",
               "netRowsFrom", "netKey", "netMerge", "fetchNetwork",
               "_fetchNetworkInner", "netGet"];
const sources = {};
for (const n of NAMES) {
  sources[n] = lift(n);
  ok(sources[n] !== null, `cash-bids.html no longer defines ${n}() — the page and this checker have parted company`);
}
if (fails.length) { report(); process.exit(1); }

/* The constants the lifted functions close over. Read off the page too, so a
   changed base URL or cap is a changed test, not a stale one. */
const constOf = (name) => {
  const m = new RegExp(`var ${name}=([^;]+);`).exec(PAGE);
  return m ? m[1] : null;
};
ok(/dnilgis\.github\.io\/bids\//.test(constOf("NET_BASE") || ""),
   `NET_BASE is ${constOf("NET_BASE")} — the feed is published at dnilgis.github.io/bids/`);

let fetchLog = [];
let fetchImpl = async () => { throw new Error("no fetch configured"); };
const sandbox = {
  fetch: (...a) => { fetchLog.push(a[0]); return fetchImpl(...a); },
  setTimeout, clearTimeout, Promise, Math, Number, String, Array, JSON, isFinite, console,
};
const body = NAMES.map((n) => sources[n]).join("\n") +
  `\nvar NET_BASE=${constOf("NET_BASE")};` +
  `\nvar NET_MAX_PLACES=${constOf("NET_MAX_PLACES")};` +
  `\nvar NET_TIMEOUT_MS=${constOf("NET_TIMEOUT_MS")};` +
  /* The off switch and the overall deadline are read off the page too, so a
     changed value is a changed test rather than a stale one. */
  `\nvar NET_ON=${constOf("NET_ON")};` +
  `\nvar NET_DEADLINE_MS=${constOf("NET_DEADLINE_MS")};` +
  /* The list of fields ours inherits when it displaces a Barchart row. Read
     off the page so adding one is a changed test, not a stale one. */
  `\nvar NET_INHERIT=${constOf("NET_INHERIT")};` +
  `\nvar NET_DEBUG=false;function netLog(){}` +
  `\nreturn {${NAMES.join(",")}};`;
const F = new Function(...Object.keys(sandbox), body);
const N = F(...Object.values(sandbox));

/* ── distance ──────────────────────────────────────────────────────────── */
const CHETEK = [45.317, -91.6542];      // 54728, from data/zips/54.json
const BLOOMER = [45.1005, -91.4885];    // CDR Farms
const d = N.netDistanceMi(CHETEK, BLOOMER);
ok(d > 14 && d < 20, `Chetek to Bloomer measured ${d.toFixed(1)} mi; it is about 17`);
eq(Math.round(N.netDistanceMi(CHETEK, CHETEK)), 0, "a place is zero miles from itself");
/* MILES, NOT KILOMETRES. The radius control on this page says miles and the
   card says "mi away". A kilometre answer looks plausible and is 60% wrong. */
ok(N.netDistanceMi([0, 0], [0, 1]) < 70, "the earth radius is in miles, not kilometres");

/* ── which places come back ────────────────────────────────────────────── */
const INDEX = {
  counts: { places: 3 },
  places: [
    { shard: "merged/near.json",  lat: 45.1005, lon: -91.4885, mappable: true,  operator: "Near Co",  city: "Bloomer", state: "WI" },
    { shard: "merged/far.json",   lat: 39.0,    lon: -95.0,    mappable: true,  operator: "Far Co",   city: "Topeka",  state: "KS" },
    { shard: "merged/nocoord.json", lat: null,  lon: null,     mappable: false, operator: "Unplaced", city: "",        state: "" },
    { shard: "merged/null.json",  lat: 0,       lon: 0,        mappable: true,  operator: "Atlantic", city: "",        state: "" },
  ],
};
const near = N.netPlacesWithin(INDEX, CHETEK, 50, 60);
eq(near.length, 1, "only the elevator inside the radius came back");
eq(near[0].operator, "Near Co", "the wrong place came back");
ok(!N.netPlacesWithin(INDEX, CHETEK, 5000, 60).some((p) => p.operator === "Unplaced"),
   "a place with no coordinate was returned as if it had one");
/* 0,0 IS THE ATLANTIC, NOT A DEFAULT. A coordinate meaning "we did not know"
   must never travel as one meaning Ghana. */
ok(!N.netPlacesWithin(INDEX, [0, 0], 50, 60).some((p) => p.operator === "Atlantic"),
   "0,0 was treated as a real coordinate");
const many = { places: Array.from({ length: 200 }, (_, i) => ({
  shard: `merged/s${i}.json`, lat: 45.3 + i * 0.0001, lon: -91.65, mappable: true })) };
eq(N.netPlacesWithin(many, CHETEK, 500, 60).length, 60, "the shard cap is not being applied");
const sorted = N.netPlacesWithin(many, CHETEK, 500, 60);
ok(sorted.every((p, i) => i === 0 || p.distance >= sorted[i - 1].distance),
   "places came back out of distance order, so the cap keeps the wrong ones");

/* ── a shard becomes rows this page can draw ───────────────────────────── */
const SHARD = {
  operator: "CDR Farms LLC", city: "Bloomer", state: "WI",
  pricedAt: "2026-09-04T18:31:56.039Z",
  bids: [
    { operator: "CDR Farms LLC", city: "Bloomer", state: "WI", commodity: "Corn",     crop: "corn",     cash: 3.94, basis: -0.42, delivery: "Sep 2026", futuresMonth: "December 2026" },
    { operator: "CDR Farms LLC", city: "Bloomer", state: "WI", commodity: "Soybeans", crop: "soybeans", cash: 9.71, basis: 0,     delivery: "Oct 2026", futuresMonth: "November 2026" },
    { operator: "CDR Farms LLC", city: "Bloomer", state: "WI", commodity: "Soybean Meal", crop: "other", cash: null, basis: null, delivery: "Oct 2026" },
  ],
};
const rows = N.netRowsFrom(SHARD, 17.2);
eq(rows.length, 2, "a row with neither a cash price nor a basis was published");
eq(rows[0].via, "direct", "a scraped row is not marked as read from the board");
eq(rows[0].distance, 17.2, "the distance computed for the place did not reach its rows");
eq(rows[0].category, "corn", "the page's own classify() was not used on the commodity");
/* A FLAT BASIS IS ZERO AND ZERO IS FALSY. This exact bug already shipped on
   this page once, in flatten(): it published the strongest basis on a board as
   "unknown" and sorted it below minus eighty cents. */
eq(rows[1].basis, 0, "a flat basis of zero came through as something else");
ok(rows[1].basis !== null, "a flat basis was published as unknown — the flatten() bug, again");
eq(rows[1].category, "soybeans", "the soybean row was misfiled");
/* MEAL IS SOLD BY THE TON. classify() sends it to `other` so it cannot win
   "best soybean bid" against a per-bushel price. */
eq(N.netRowsFrom({ operator: "X", bids: [{ commodity: "Soybean Meal", cash: 300 }] }, 1)[0].category,
   "other", "soybean meal was classified as soybeans and would win on price");
eq(N.netRowsFrom(null, 1).length, 0, "a missing shard threw instead of returning nothing");
eq(N.netRowsFrom({ bids: null }, 1).length, 0, "a malformed shard threw instead of returning nothing");

/* ── the duplicate rule, which is the point ────────────────────────────── */
const mine = [{ facility: "CDR Farms LLC", city: "Bloomer", state: "WI", commodity: "Corn", cashPrice: 3.94, via: "direct" }];
const theirs = [
  { facility: "CDR FARMS, LLC.", city: "bloomer", state: "WI", commodity: "Corn", cashPrice: 3.91 },
  { facility: "Somebody Else",   city: "Menomonie", state: "WI", commodity: "Corn", cashPrice: 3.88 },
];
const merged = N.netMerge(theirs, mine);
eq(merged.duplicatesResolved, 1, "the duplicate was not resolved");
eq(merged.rows.length, 2, "the merge lost or duplicated a row");
ok(merged.rows.some((r) => r.via === "direct" && r.cashPrice === 3.94),
   "ours did not win the duplicate — Barchart's copy of the board beat the board");
ok(!merged.rows.some((r) => r.cashPrice === 3.91),
   "Barchart's copy of an elevator we read directly is still on the page");
ok(merged.rows.some((r) => r.facility === "Somebody Else"),
   "an elevator only Barchart has was dropped — the network must add, never subtract");
/* Punctuation and case are spelling, not identity. */
eq(N.netKey({ facility: "CDR Farms, LLC.", city: "Bloomer", state: "WI" }),
   N.netKey({ facility: "cdr farms llc", city: "bloomer", state: "wi" }),
   "two spellings of one elevator did not key the same");
ok(N.netKey({ facility: "A", city: "Bloomer", state: "WI" }) !==
   N.netKey({ facility: "A", city: "Menomonie", state: "WI" }),
   "two towns keyed the same, which would drop a real elevator");
/* ── WINNING A DUPLICATE MUST NOT COST THE FARMER THE PHONE ────────────
 *
 * Found by rendering the page, not by any check that came before it. The
 * merged feed carries no phone number at all, so when our row displaced
 * Barchart's the card lost its Call button — an elevator a farmer wants to
 * sell to, with no way to ring it. Every guard here passed while that was
 * true.
 *
 * Ours wins on PRICE. It does not follow that ours knows more about the
 * business. */
const withPhone = [
  { facility: "CDR FARMS, LLC.", city: "bloomer", state: "WI", commodity: "Corn", cashPrice: 3.91, phone: "7155551212" },
];
const merged2 = N.netMerge(withPhone, [
  { facility: "CDR Farms LLC", city: "Bloomer", state: "WI", commodity: "Corn", cashPrice: 3.94, phone: "", via: "direct" },
]);
eq(merged2.rows.length, 1, "the duplicate was not resolved");
eq(merged2.rows[0].phone, "7155551212",
   "our row won the duplicate and threw away Barchart's phone number — the card " +
   "loses its Call button and a farmer cannot ring the elevator");
eq(merged2.rows[0].cashPrice, 3.94,
   "inheriting the phone also took the price; ours must still win on price");
/* AND THE INHERIT LIST MUST HOLD NOTHING ABOUT THE BID ITSELF.
   `if(!ours[f]&&r[f])` only fills a gap, so adding "cashPrice" to the list
   looks harmless — until our row is a basis-only board with a null price, and
   then Barchart's price appears on a card badged "direct from the elevator".
   That is a lie about provenance, which is the one thing this feature cannot
   afford. These are facts about the BUSINESS, not about the bid. */
const bidFields = ["cashprice", "basis", "commodity", "deliverymonth", "deliverystart",
                   "symbol", "basismonth", "asof", "category", "via", "distance"];
const inherit = JSON.parse(String(constOf("NET_INHERIT")).replace(/'/g, '"'));
for (const f of inherit)
  ok(!bidFields.includes(String(f).toLowerCase()),
     `NET_INHERIT carries "${f}" — that is part of the bid, and a direct row ` +
     `must never show a number that came from Barchart`);
/* The gap case that makes it concrete. */
const nullPrice = N.netMerge(
  [{ facility: "X Co", city: "Bloomer", state: "WI", cashPrice: 3.91, basis: -0.45, phone: "7155551212" }],
  [{ facility: "X Co", city: "Bloomer", state: "WI", cashPrice: null, basis: -0.5, phone: "", via: "direct" }]);
eq(nullPrice.rows[0].cashPrice, null,
   "a direct row with no cash price inherited Barchart's — the card would show " +
   "a Barchart number under a badge saying it came from the elevator");
eq(nullPrice.rows[0].phone, "7155551212", "the phone was not inherited in the null-price case");
/* AND NEVER THE OTHER WAY. If our own source ever gives us a phone, it came
   from the elevator and Barchart's copy does not overwrite it. */
const merged3 = N.netMerge(withPhone, [
  { facility: "CDR Farms LLC", city: "Bloomer", state: "WI", commodity: "Corn", cashPrice: 3.94, phone: "7155559999", via: "direct" },
]);
eq(merged3.rows[0].phone, "7155559999",
   "Barchart's phone overwrote one we already had from the elevator itself");

/* ── AND THE COUNTER IS ACTUALLY ON THE PAGE ───────────────────────────── */
ok(/function renderNetStats\(\)/.test(PAGE),
   "cbNetStats is computed and rendered nowhere — it was dead from the day it " +
   "was written and no non-browser check could see that");
/* COMMENTS ARE NOT COVERAGE — the trap this repository keeps re-teaching.
   A first cut matched the string "renderNetStats();" and passed happily when
   the call was commented out to "/* renderNetStats(); *\/". Strip the
   comments and ask whether a line of CODE calls it. */
const _code = PAGE
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^[ \t]*\/\/.*$/gm, "")
  .replace(/function renderNetStats\(\)/g, "");
ok(/renderNetStats\(\);/.test(_code),
   "renderNetStats() is defined and never called from live code — the counter " +
   "would be dead again, exactly as it was before a browser looked at it");
ok(/id="cb-net-stats"/.test(PAGE), "the counter has no element to render into");

eq(N.netMerge(theirs, []).rows.length, 2, "with no network rows the page is not what it was");
eq(N.netMerge([], mine).rows.length, 1, "with no Barchart rows ours were dropped");

/* ── it must never break the page ──────────────────────────────────────── */
async function failsSoftly(label, impl) {
  fetchImpl = impl;
  fetchLog = [];
  let result, threw = null;
  try { result = await N.fetchNetwork("54728", 50); } catch (e) { threw = e; }
  ok(threw === null, `fetchNetwork rejected on ${label} — the page would show an error it did not have to`);
  ok(result && Array.isArray(result.rows) && result.rows.length === 0,
     `fetchNetwork did not resolve to an empty set on ${label}`);
}
await failsSoftly("a network error", async () => { throw new Error("offline"); });
await failsSoftly("a 404", async () => ({ ok: false, status: 404, json: async () => null }));
await failsSoftly("malformed JSON", async () => ({ ok: true, status: 200, json: async () => { throw new Error("bad json"); } }));
await failsSoftly("an empty body", async () => ({ ok: true, status: 200, json: async () => null }));

/* A ZIP that is not a ZIP never reaches the network at all. */
fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({}) });
fetchLog = [];
await N.fetchNetwork("not a zip", 50);
eq(fetchLog.length, 0, "a malformed ZIP still fired a request");

/* ── the page is actually wired to it ──────────────────────────────────── */
ok(/var net=fetchNetwork\(zip,radius\|\|50\);/.test(PAGE),
   "fetchBids() no longer asks the network — the block is present and unused");
ok(/netMerge\(bids,n\.rows\)/.test(PAGE),
   "the two feeds are no longer merged in fetchBids()");
ok(/if\(b\.via==='direct'\)map\[key\]\.via='direct';/.test(PAGE),
   "groupElevators() drops `via`, so no card can ever show the badge");
ok(/elev\.via==='direct'.*elev-direct/.test(PAGE),
   "the card no longer draws the direct badge");
ok(/\.elev-direct\{/.test(PAGE),
   "the direct badge has no style and would render as unstyled text");
/* THE BADGE IS A CLAIM ABOUT PROVENANCE. It must be conditional on the row
   actually having come from the elevator, never drawn for every card. */
ok(!/html\+='<div class="elev-direct"/.test(PAGE.replace(/if\(elev\.via==='direct'\)html\+='<div class="elev-direct"/g, "")),
   "the direct badge is drawn unconditionally — it would claim Barchart rows are direct reads");

/* ── against the real published bytes, when they are reachable ─────────── */
try {
  const res = await globalThis.fetch("https://dnilgis.github.io/bids/data/merged-index.json",
    { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const live = await res.json();
  ok(live.schema === "agsist-merged-index/1",
     `the published feed says schema "${live.schema}"; this page reads agsist-merged-index/1`);
  const live50 = N.netPlacesWithin(live, CHETEK, 50, 60);
  const live100 = N.netPlacesWithin(live, CHETEK, 100, 60);
  ok(live100.length >= live50.length,
     "a wider radius returned fewer elevators, which cannot be true");
  ok(live100.length > 0,
     "the live feed put no elevator within 100 miles of 54728 — it holds " +
     `${(live.counts && live.counts.places) || 0} places nationally`);
  console.log(`   live: ${live.counts.places} places nationally, ` +
              `${live50.length} within 50 mi of 54728, ${live100.length} within 100`);
} catch (e) {
  console.log(`   live feed not reachable (${String(e.message).slice(0, 60)}) — those checks skipped`);
}

function report() {
  if (fails.length) {
    for (const f of fails) console.log("FAIL: " + f);
    console.log(`\n${pass} passed, ${fails.length} failed`);
  } else {
    console.log(`network checks: ${pass} passed — the elevator's own board wins a duplicate, and nothing here can break the page`);
  }
}
report();
process.exit(fails.length ? 1 : 0);
