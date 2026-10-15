/* /basis, the 2026-10-15 head-to-head fixes:
 *  - USDA's same-week 5-year normal beside the state number, with the gap
 *  - the Gulf box says which USDA week it uses and why it is trusted
 *  - a basis map drawn only when opened, and /basis-map points at it
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");
const HTML = read("basis.html");
const require = createRequire(import.meta.url);

function liftFn(name) {
  const i = HTML.indexOf("function " + name + "(");
  assert.ok(i >= 0, `basis.html no longer defines ${name}()`);
  let d = 0, j = HTML.indexOf("{", i);
  for (; j < HTML.length; j++) {
    if (HTML[j] === "{") d++;
    else if (HTML[j] === "}" && --d === 0) break;
  }
  return HTML.slice(i, j + 1);
}
const basisFmt = (c) => (c === 0 ? "even" : (c > 0 ? "+" : "−") + Math.abs(c) + "¢");
function ctx() {
  const c = {
    AG: { px: { basis: basisFmt } },
    esc: (s) => String(s),
    day: (iso) => { const d = new Date(iso); return ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getUTCMonth()] + " " + d.getUTCDate() + ", " + d.getUTCFullYear(); },
    shortDate: (iso) => { const m = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"], p = String(iso).split("-"); return m[+p[1] - 1] + " " + (+p[2]); },
  };
  vm.createContext(c);
  vm.runInContext(liftFn("usdaNormal") + "\n" + liftFn("walkWeek"), c);
  return c;
}

// The Oct 2026 files, checked by hand: Iowa network corn -40c; USDA Iowa corn
// week of Sep 25 -43.2c against a 5-year same-week mean of -30.8c.
const BASIS = {
  weeks: { "Corn|Elevator Bid": { week: "2026-09-25", newest: "2026-10-02",
    held: ["Corn|Kansas|Elevator Bid", "Corn|Nebraska|Elevator Bid", "Corn|North Carolina|Elevator Bid", "Corn|North Dakota|Elevator Bid"],
    waiting: ["Corn|Illinois|Elevator Bid"] } },
  series: { "Corn|Iowa|Elevator Bid": { latest: -0.432, date: "2026-09-25", avg5: -0.308, avg5_n: 5 },
            "Corn|Kansas|Elevator Bid": { latest: -0.35, date: "2026-09-11", avg5: 0.07, avg5_n: 5 } },
};

test("the state number sits beside USDA's same-week normal, with the gap", () => {
  const t = ctx().usdaNormal("Iowa", "corn", { median: -0.40 }, BASIS);
  assert.match(t, /USDA normal for Iowa, week of Sep 25, 2026: <b>−31¢<\/b> \(5-year average, n = 5 yrs\)/);
  assert.match(t, /Ours today is <b>9¢ weaker than that<\/b>/, "-40 minus -31 is 9 cents weaker");
  assert.match(t, /USDA’s own Iowa bid that week was −43¢, 12¢ weaker than its normal/);
});

test("no normal line when USDA does not track the state or did not post the table's week", () => {
  const c = ctx();
  assert.equal(c.usdaNormal("Texas", "corn", { median: 0.55 }, BASIS), "");
  assert.equal(c.usdaNormal("Kansas", "corn", { median: -0.40 }, BASIS), "", "a row older than the table's week is not 'this week'");
  assert.equal(c.usdaNormal("Iowa", "corn", { median: null }, BASIS), "");
  assert.equal(c.usdaNormal("Iowa", "corn", { median: -0.40 }, null), "");
});

test("the Gulf box names its USDA week and why it is trusted", () => {
  const c = ctx();
  const s = { date: "2026-10-02" }, p = ["Corn", "Illinois", "Gulf - Louisiana"];
  const t = c.walkWeek(s, p, BASIS);
  assert.match(t, /^These are USDA bids for the week of Oct 2, 2026\./);
  assert.match(t, /holds it back because 4 regions jumped\. USDA’s Illinois corn basis was not one of them; it passed the jump check/);
  const held = JSON.parse(JSON.stringify(BASIS));
  held.weeks["Corn|Elevator Bid"].held.push("Corn|Illinois|Elevator Bid");
  assert.match(c.walkWeek(s, p, held), /was one of the jumps it held, so read this box with care/);
  const same = JSON.parse(JSON.stringify(BASIS));
  same.weeks["Corn|Elevator Bid"] = { week: "2026-10-02", newest: "2026-10-02", held: [], waiting: [] };
  assert.match(c.walkWeek(s, p, same), /The same week as the regional table above\./);
  assert.match(HTML, /\$\('bs-walk-week'\)\.textContent=walkWeek\(s,p,basis\)/);
});

test("the map loads only when opened, and /basis-map lands on it", () => {
  assert.doesNotMatch(HTML, /<script src="\/components\/basis-map\.js/, "the map must not load with the page");
  assert.match(HTML, /s\.src='\/components\/basis-map\.js\?v=\d+'/);
  assert.match(HTML, /<details class="bs-panel bs-why" id="map">/);
  const stub = read("basis-map.html");
  assert.match(stub, /url=\/basis#map"/);
  assert.match(stub, /location\.replace\("\/basis"\+location\.search\+"#map"\)/);
  assert.match(stub, /noindex/);
});

test("map bands: gray within 10 cents, two hues either side", () => {
  const M = require(ROOT + "components/basis-map.js");
  const side = (c) => M.BANDS[M.band(c)].side;
  assert.equal(side(-80), "neg"); assert.equal(side(-60), "neg"); assert.equal(side(-10), "neg");
  assert.equal(side(-9), "mid"); assert.equal(side(0), "mid"); assert.equal(side(9), "mid");
  assert.equal(side(10), "pos"); assert.equal(side(55), "pos");
  assert.equal(M.BANDS[M.band(-60)].label, "60¢ or more under");
  assert.equal(M.BANDS[M.band(-40)].label, "30 to 60¢ under");
});

test("map projection: lower 48 only, Iowa east of Nebraska, every state drawn", () => {
  const M = require(ROOT + "components/basis-map.js");
  const geo = JSON.parse(read("data/us-states.geo.json"));
  const m = M.project(geo, 960);
  const sts = m.paths.map((p) => p.st);
  assert.equal(sts.length, 49, "48 states and DC");
  assert.ok(!sts.includes("AK") && !sts.includes("HI") && !sts.includes("ON"));
  const at = (s) => m.paths.find((p) => p.st === s);
  assert.ok(at("IA").cx > at("NE").cx && at("MN").cy < at("IA").cy);
  assert.ok(m.h > 400 && m.h < 700, "aspect of the lower 48: " + m.h);
});
