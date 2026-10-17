/* Soybeans on /grain-emc (components/grain-emc.js, grain-emc-ui.js, grain-emc.html).
 *
 * Check values are typed from the documents themselves (references branch,
 * read Oct 16, 2026), not from search snippets:
 *   Kentucky, Equilibrium moisture content for grains, Table 2 soybeans
 *     ("ASAE Data D245.5 / modified-Halsey equation"), 10-90% RH, 35-90 F.
 *   Arkansas FSA1074, Table B soybean EMC, 25-90% RH, 35-100 F; Table 1 safe MC.
 *   Minnesota Extension, Managing stored grain with aeration, Table 2 (storage
 *     moisture) and Table 4 (60 F soybean row).
 *   NDSU (Hellevang): 10.2% EMC at 70 F/60% (slides hosted by Cornell, 2015);
 *     16% beans at 42 F/70% dry to about 13.5% (news release, Jan 2020).
 *   NDSU 2011 soybean EMC table (refs/bench-grain-emc-3, Oct 16 copy), 32-80 F,
 *     50-90% RH. It follows neither fit; the page must say so, and the dry
 *     calls must stay safe against it.
 * The browser check needs Playwright and Chromium and is skipped without them.
 *
 *   node --test test/grain-emc-soybeans.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { extname, join, normalize } from "node:path";
import vm from "node:vm";
import { bake } from "../scripts/build_grain_emc.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const ctx = {};
vm.runInNewContext(readFileSync(ROOT + "components/grain-emc.js", "utf8"), ctx);
const E = ctx.AgEMC;
const page = readFileSync(ROOT + "grain-emc.html", "utf8");
const ui = readFileSync(ROOT + "components/grain-emc-ui.js", "utf8");
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (tol ${tol})`);
const S = "soybeans";

/* ---------- the printed tables ---------- */

const KY_RH = [10, 20, 30, 40, 50, 60, 65, 70, 80, 90];
const KY = {
  35: [4.2, 5.3, 6.5, 7.8, 9.4, 11.5, 12.8, 14.4, 19.1, 28.9],
  40: [4.1, 5.3, 6.4, 7.7, 9.3, 11.3, 12.6, 14.2, 18.9, 28.7],
  50: [4.0, 5.2, 6.3, 7.6, 9.1, 11.1, 12.4, 14.0, 18.6, 28.2],
  60: [4.0, 5.1, 6.2, 7.4, 8.9, 10.9, 12.2, 13.7, 18.3, 27.8],
  70: [3.9, 5.0, 6.1, 7.3, 8.8, 10.7, 11.9, 13.5, 17.9, 27.3],
  77: [3.8, 4.9, 6.0, 7.2, 8.6, 10.6, 11.8, 13.3, 17.7, 27.0],
  90: [3.7, 4.8, 5.8, 7.0, 8.4, 10.3, 11.5, 13.0, 17.3, 26.5],
};
const AR_RH = [25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90];
const AR = {
  35: [5.9, 6.5, 7.1, 7.8, 8.6, 9.4, 10.3, 11.5, 12.8, 14.4, 16.4, 19.1, 22.9, 28.9],
  40: [5.8, 6.4, 7.1, 7.7, 8.5, 9.3, 10.2, 11.3, 12.6, 14.2, 16.2, 18.9, 22.7, 28.7],
  45: [5.8, 6.4, 7.0, 7.7, 8.4, 9.2, 10.1, 11.2, 12.5, 14.1, 16.1, 18.7, 22.5, 28.4],
  50: [5.7, 6.3, 6.9, 7.6, 8.3, 9.1, 10.0, 11.1, 12.4, 14.0, 16.0, 18.6, 22.3, 28.2],
  55: [5.7, 6.2, 6.8, 7.5, 8.2, 9.0, 10.0, 11.0, 12.3, 13.8, 15.8, 18.4, 22.1, 28.0],
  60: [5.6, 6.2, 6.8, 7.4, 8.1, 8.9, 9.9, 10.9, 12.2, 13.7, 15.7, 18.3, 21.9, 27.8],
  65: [5.6, 6.1, 6.7, 7.4, 8.1, 8.9, 9.8, 10.8, 12.1, 13.6, 15.5, 18.1, 21.7, 27.6],
  70: [5.5, 6.1, 6.6, 7.3, 8.0, 8.8, 9.7, 10.7, 11.9, 13.5, 15.4, 17.9, 21.6, 27.3],
  75: [5.4, 6.0, 6.6, 7.2, 7.9, 8.7, 9.6, 10.6, 11.8, 13.3, 15.2, 17.8, 21.4, 27.1],
  80: [5.4, 5.9, 6.5, 7.1, 7.8, 8.6, 9.5, 10.5, 11.7, 13.2, 15.1, 17.6, 21.2, 26.9],
  85: [5.3, 5.9, 6.4, 7.1, 7.7, 8.5, 9.4, 10.4, 11.6, 13.1, 15.0, 17.5, 21.0, 26.7],
  90: [5.3, 5.8, 6.4, 7.0, 7.7, 8.4, 9.3, 10.3, 11.5, 13.0, 14.8, 17.3, 20.8, 26.5],
  95: [5.2, 5.7, 6.3, 6.9, 7.6, 8.3, 9.2, 10.2, 11.4, 12.8, 14.7, 17.1, 20.7, 26.3],
  100: [5.2, 5.7, 6.2, 6.9, 7.5, 8.3, 9.1, 10.1, 11.3, 12.7, 14.5, 17.0, 20.5, 26.1],
};
const CELLS = [
  ...Object.entries(KY).flatMap(([t, row]) => row.map((v, i) => ["KY", +t, KY_RH[i], v])),
  ...Object.entries(AR).flatMap(([t, row]) => row.map((v, i) => ["AR", +t, AR_RH[i], v])),
];
const UMN = [[50, 8.6], [60, 10.5], [70, 12.8], [80, 15.7]]; // 60 F
const NDSU = [[70, 60, 10.2, 0.05], [42, 70, 13.5, 0.05]];    // Hellevang slide and release; the 42 F figure is "about 13.5"
const ND11_RH = [50, 60, 70, 80, 90];
const ND11 = {
  32: [10.0, 11.8, 13.7, 16.2, 19.8],
  40: [9.8, 11.5, 13.5, 16.0, 19.6],
  50: [9.5, 11.2, 13.2, 15.7, 19.4],
  60: [9.2, 11.0, 13.0, 15.4, 19.1],
  70: [8.9, 10.7, 12.7, 15.2, 18.9],
  80: [8.6, 10.4, 12.5, 15.0, 18.7],
};
const ND11_CELLS = Object.entries(ND11).flatMap(([t, row]) => row.map((v, i) => ["NDSU2011", +t, ND11_RH[i], v]));

/* High (Halsey) fit at any RH, including Kentucky's 10% column that the page clamps at 20%. */
const halseyWb = (tF, rh) => E.dbToWb(E.fitDb(E.GRAINS[S].fits[1], E.fToC(tF), rh / 100));
const hendersonWb = (tF, rh) => E.dbToWb(E.fitDb(E.GRAINS[S].fits[0], E.fToC(tF), rh / 100));

test("soybean constants are the checked sets", () => {
  const [he, ha] = E.GRAINS[S].fits;
  assert.deepEqual([he.model, he.K, he.N, he.C], ["henderson", 30.5327e-5, 1.2164, 134.136]);
  assert.deepEqual([ha.model, ha.A, ha.B, ha.C], ["halsey", 2.87, -0.0054, 1.38]);
  assert.equal(E.GRAINS[S].name, "Soybeans");
  assert.equal(E.GRAINS[S].target, 13, "Minnesota Extension Table 2: aerated soybeans until June");
});

test("soybeans at 60 F and 70%, worked by hand on both fits", () => {
  // T = 15.5556 C.
  // Henderson: -ln(1 - 0.7) = 1.203973; K (T + C) = 30.5327e-5 x 149.6916 = 0.0457049;
  //   1.203973 / 0.0457049 = 26.3423; ^(1/1.2164) = 14.7203 dry; 100 x 14.7203 / 114.7203 = 12.831 wet.
  // Halsey: exp(2.87 - 0.0054 x 15.5556) = 16.2160; / -ln 0.7 (0.356675) = 45.4644;
  //   ^(1/1.38) = 15.8932 dry; 13.714 wet.
  const e = E.emc(S, 60, 70);
  near(e.wb, 12.831, 0.001, "Henderson (low, main)");
  near(e.wet, 13.714, 0.001, "Halsey (high)");
  assert.equal(e.wb.toFixed(1), "12.8", "Minnesota Table 4 prints 12.8");
  assert.equal(e.wet.toFixed(1), "13.7", "Kentucky and Arkansas print 13.7");
});

test("the high fit reproduces all 266 printed Kentucky and Arkansas soybean cells to the tenth", () => {
  assert.equal(CELLS.length, 70 + 196);
  const off = CELLS.filter(([, t, rh, v]) => halseyWb(t, rh).toFixed(1) !== v.toFixed(1));
  assert.deepEqual(off, [], "every cell, rounded the way the tables print");
  // and inside the page's range the page's own high number is that same value
  for (const [src, t, rh, v] of CELLS) {
    if (rh < E.LIMITS.rhMin) continue;
    assert.equal(E.emc(S, t, rh).wet.toFixed(1), v.toFixed(1), `${src} ${t} F ${rh}%`);
  }
});

test("the low fit reproduces Minnesota's 60 F soybean row and Hellevang's two soybean numbers", () => {
  for (const [rh, v] of UMN) assert.equal(E.emc(S, 60, rh).wb.toFixed(1), v.toFixed(1), `UMN 60 F ${rh}%`);
  for (const [t, rh, v, tol] of NDSU) near(E.emc(S, t, rh).wb, v, tol, `NDSU ${t} F ${rh}%`);
});

test("the high fit is the wetter one wherever a table has a number, so wet calls follow the tables", () => {
  for (let t = 25; t <= 100; t += 1) for (let rh = 20; rh <= 90; rh += 1) {
    assert.ok(halseyWb(t, rh) >= hendersonWb(t, rh), `${t} F ${rh}%`);
  }
  // at 20 to 25 F (below every table) the two meet; the page still shows low to high
  for (let rh = 20; rh <= 90; rh += 1) near(Math.min(0, halseyWb(20, rh) - hendersonWb(20, rh)), 0, 0.07, `20 F ${rh}%`);
});

test("soybean 'dries to target' is safe against every published soybean value, for every target the box allows", () => {
  const all = [
    ...CELLS.filter(([, , rh]) => rh >= E.LIMITS.rhMin),
    ...UMN.map(([rh, v]) => ["UMN", 60, rh, v]),
    ...NDSU.map(([t, rh, v]) => ["NDSU", t, rh, v]),
    ...ND11_CELLS,
  ];
  assert.equal(ND11_CELLS.length, 30);
  let dryCalls = 0;
  for (const [src, t, rh, v] of all) {
    const e = E.emc(S, t, rh);
    for (let T = E.LIMITS.targetMin; T <= E.LIMITS.targetMax; T += 0.5) {
      const call = E.holdCall(S, e, T);
      if (call === "dry") { dryCalls++; assert.ok(v < T + 0.05, `${src} ${t} F ${rh}% T ${T}: dry call but table ${v}`); }
      if (v > T + 0.05 && src !== "UMN" && src !== "NDSU" && src !== "NDSU2011") assert.equal(call, "wet", `${src} ${t} F ${rh}% T ${T}: table over target must read wet`);
      // NDSU 2011 runs wetter than the high fit in dry air: there the call may be "close", never "dry",
      // and the table may sit at most 0.3 point over a target the page does not call wet
      if (src === "NDSU2011" && v > T + 0.05 && call !== "wet") {
        assert.equal(call, "close", `NDSU 2011 ${t} F ${rh}% T ${T}`);
        assert.ok(v - T <= 0.35, `NDSU 2011 ${t} F ${rh}% T ${T}: ${v}`);
      }
    }
  }
  assert.ok(dryCalls > 100, "the check covers real dry calls");
});

test("soybean calls by hand", () => {
  // 60 F, 60%: low 10.5, high 10.9; target 13: 10.5 <= 12 and 10.9 <= 13 -> dries
  assert.equal(E.holdCall(S, E.emc(S, 60, 60), 13), "dry");
  // 60 F, 70%: high 13.7 over 13 -> wets
  assert.equal(E.holdCall(S, E.emc(S, 60, 70), 13), "wet");
  // 50 F, 70%: low 13.2, high 14.0; target 14: high not over, low not a full point under -> close
  assert.equal(E.holdCall(S, E.emc(S, 50, 70), 14), "close");
  // target 14.5: low 13.2 is a full point under, high 14.0 under -> dries
  assert.equal(E.holdCall(S, E.emc(S, 50, 70), 14.5), "dry");
  // drying 16% beans at 42 F, 70% (NDSU's April example): low 13.5, high 14.2, both under 16 -> dries, not to a 13% target
  assert.equal(E.dryCall(S, E.emc(S, 42, 70), 16, 13), "part");
  // same air for 14% beans: high 14.2 >= 14 -> wets
  assert.equal(E.dryCall(S, E.emc(S, 42, 70), 14, 13), "wet");
  // humidity line inverts back to the target on each fit
  for (const fit of [0, 1]) for (const t of [30, 55, 85]) {
    const r = E.rhFor(S, t, 13, fit).rh;
    near(E.dbToWb(E.fitDb(E.GRAINS[S].fits[fit], E.fToC(t), r / 100)), 13, 1e-9, `inverse fit ${fit} ${t} F`);
  }
});

/* ---------- the page ---------- */

const unesc = (s) => s.replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

test("soybeans are a crop choice and the old notice is gone", () => {
  assert.match(page, /<button type="button" data-grain="soybeans" aria-pressed="false">Soybeans<\/button>/);
  assert.ok(!/Soybeans: not yet|Corn numbers do not fit beans|not on the calculator|Soybeans go on when/.test(page + ui));
  assert.match(page, /src="\/components\/grain-emc\.js\?v=([4-9]|\d\d+)"/);
  assert.match(page, /src="\/components\/grain-emc-ui\.js\?v=([4-9]|\d\d+)"/);
  assert.ok(!/—|&mdash;/.test(page + ui), "no em dashes");
  assert.match(ui, /grainKey\(q\.get\('grain'\)\)/, "?grain=soy opens soybeans");
  assert.ok(Buffer.byteLength(page) < 90000);
});

test("title, description and JSON-LD say soybeans", () => {
  assert.match(page, /<title>[^<]*soybeans[^<]*<\/title>/i);
  assert.match(page, /<meta name="description" content="[^"]*corn, soybeans and wheat[^"]*soybean[^"]*EMC charts/);
  const ld = JSON.parse(page.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  const app = ld["@graph"].find((x) => x["@type"] === "WebApplication");
  assert.match(app.description, /soybeans/);
  const faq = ld["@graph"].find((x) => x["@type"] === "FAQPage").mainEntity;
  const names = faq.map((q) => q.name);
  assert.ok(names.includes("What humidity is too high to run fans on soybeans?"));
  assert.ok(names.includes("What moisture should soybeans be stored at?"));
  assert.ok(!names.some((n) => /not on the calculator/.test(n)));
});

test("soybean FAQ numbers are what the equations give", () => {
  const r = (t, fit) => Math.round(E.rhFor(S, t, 13, fit).rh);
  assert.deepEqual([40, 50, 60].map((t) => [r(t), r(t, 0)]), [[66, 68], [67, 69], [68, 71]]);
  assert.match(page, /about 66 to 68% humidity at 40 F, 67 to 69% at 50 F and 68 to 71% at 60 F/);
  assert.deepEqual([40, 50, 60].map((t) => Math.floor(E.rhDries(S, t, 13).rh)), [63, 65, 66]);
  assert.match(page, /under about 63% at 40 F, 65% at 50 F and 66% at 60 F/);
  const e80 = E.emc(S, 60, 80);
  assert.equal(`${e80.wb.toFixed(1)} to ${e80.wet.toFixed(1)}%`, "15.7 to 18.3%");
  assert.match(page, /at 60 F and 80% humidity beans head for 15\.7 to 18\.3%/);
  const e50 = E.emc(S, 50, 60);
  assert.equal(`${e50.wb.toFixed(1)} to ${e50.wet.toFixed(1)}`, "10.8 to 11.1");
  assert.match(page, /soybeans to about 10\.8 to 11\.1%/);
  assert.match(page, /For soybeans in the same air the page gives 12\.8 to 13\.7%: Kentucky and Arkansas list 13\.7% and Minnesota lists 12\.8%/);
});

test("storage moisture copy matches the documents", () => {
  // Minnesota Table 2: soybeans short-term (until June) 13, one year 12, long term 11
  assert.match(page, /Minnesota Extension says aerated soybeans keep until June at 13%, for a year at 12% and longer at 11%/);
  // Arkansas Table 1: soybean 11% long term (one year), 11% warm and 14% cool short term (30 to 60 days)
  assert.match(page, /Arkansas Extension says 11% for a year, 11% for 30 to 60 days in warm weather and 14% for 30 to 60 days in cool weather/);
  // Nebraska CropWatch, Sep 5 2018 (Hellevang, NDSU): 13% "fine for storing soybeans during cool
  // conditions"; 11% for beans stored into spring and summer (2026-10-17 fact check F3: the old line
  // quoted a 2009 item, undated)
  assert.match(page, /Nebraska CropWatch \(Sep 2018, by NDSU grain specialist Ken Hellevang\) says 13% is fine in cool weather and advises 11% for beans kept into spring and summer/);
  assert.match(page, /href="https:\/\/cropwatch\.unl\.edu\/2018\/enhancing-soybean-storage-starts-harvest-moisture\/"/);
  assert.doesNotMatch(page, /Nebraska Extension calls 13% safe for long-term storage/);
  assert.match(ui, /Minnesota Extension stores aerated soybeans at 13% until June, 12% for a year and 11% for longer; Arkansas FSA1074 says 11% for a year\./);
  // NDSU Jan 2020: 1 cfm/bu up to 16%, ~50 days; 1.5 cfm/bu for 18%, which keeps about 40 days at 50 F
  assert.match(ui, /at least 1 cfm per bushel for beans up to 16% \(about 50 days of drying\) and at least 1\.5 cfm per bushel for 18% beans, which keep only about 40 days at 50 F/);
});

test("the soybean spread table prints what the equations give", () => {
  const show = (t, rh) => { const e = E.emc(S, t, rh); return `${e.wb.toFixed(1)} to ${e.wet.toFixed(1)}%`; };
  const nd = (t, rh) => ND11[t][ND11_RH.indexOf(rh)].toFixed(1) + "%";
  const rows = [[40, 70, "not listed", nd(40, 70), "14.2%", "14.2%"], [50, 50, "not listed", nd(50, 50), "9.1%", "9.1%"], [60, 70, "12.8%", nd(60, 70), "13.7%", "13.7%"],
    [70, 60, "not listed", nd(70, 60), "10.7%", "10.7%"], [50, 90, "not listed", nd(50, 90), "28.2%", "28.2%"]];
  for (const [t, rh, umn, ndsu, ky, ar] of rows) {
    const html = `<tr><th scope="row">${t} F, ${rh}%</th><td>${show(t, rh)}</td><td>${umn}</td><td>${ndsu}</td><td>${ky}</td><td>${ar}</td></tr>`;
    assert.ok(page.includes(html), html);
  }
  // the printed values in that table are the documents' own cells
  assert.equal(KY[40][KY_RH.indexOf(70)], 14.2); assert.equal(AR[40][AR_RH.indexOf(70)], 14.2);
  assert.equal(KY[70][KY_RH.indexOf(60)], 10.7); assert.equal(AR[70][AR_RH.indexOf(60)], 10.7);
  assert.equal(KY[50][KY_RH.indexOf(50)], 9.1); assert.equal(AR[50][AR_RH.indexOf(50)], 9.1);
  assert.equal(KY[50][KY_RH.indexOf(90)], 28.2); assert.equal(AR[50][AR_RH.indexOf(90)], 28.2);
});

test("method note states the honest provenance of the Halsey constants", () => {
  const t = unesc(page);
  assert.match(t, /I could not read the standard itself, so I worked the constants back from the printed tables/);
  assert.match(t, /266 of 266/);
  assert.match(t, /A = 2\.87 {3}B = -0\.0054 {3}C = 1\.38/);
  assert.match(t, /K = 0\.000305327 {3}N = 1\.2164 {3}C = 134\.136/);
  assert.match(t, /\(Table 1 corn, Table 2 soybeans, Table 3 soft red winter wheat\)/);
});

test("baked soybean chart matches the module and prints like the others", () => {
  assert.equal(bake(page), page, "run node scripts/build_grain_emc.mjs");
  const sec = page.match(/<section class="emc-chart" id="soybeans-emc-chart"[\s\S]*?<\/section>/);
  assert.ok(sec, "soybean chart baked");
  assert.match(sec[0], /<h2 id="soybeans-chart">Soybean EMC chart<\/h2>/);
  for (const t of [30, 40, 50, 60, 70, 80, 90]) assert.ok(sec[0].includes(`<th scope="row">${t} F</th>`), `row ${t}`);
  const e = E.emc(S, 60, 70);
  assert.ok(sec[0].includes(`<span>${e.wb.toFixed(1)}</span><span class="hi">${e.wet.toFixed(1)}</span>`));
  assert.match(sec[0], /data-print-chart="soybeans"/);
  assert.match(page, /html\.print-soybeans #soybeans-emc-chart/);
  assert.match(page, /'print-soybeans'/);
  const at = (id) => page.indexOf(`id="${id}-emc-chart"`);
  assert.ok(at("corn") < at("soybeans") && at("soybeans") < at("wheat"));
});

/* ---------- in the browser ---------- */

const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (!extname(p)) p += ".html";
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

test("browser: ?grain=soy opens soybeans at 13%, the typed reading shows the range, the hint shows", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const c = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
    const pg = await c.newPage();
    const errors = [];
    pg.on("pageerror", (e) => errors.push(String(e)));
    await pg.route("**/*", (r) => (r.request().url().startsWith(`http://127.0.0.1:${port}`) ? r.continue() : r.abort()));
    await pg.goto(`http://127.0.0.1:${port}/grain-emc?grain=soy&t=60&rh=70`);
    await pg.waitForFunction(() => document.querySelector('[data-grain="soybeans"]').getAttribute("aria-pressed") === "true");
    assert.equal(await pg.inputValue("#emc-target"), "13.0");
    assert.equal(await pg.isVisible("#emc-ghint"), true);
    assert.match(await pg.textContent("#emc-ghint"), /13% until June, 12% for a year and 11% for longer/);
    const out = await pg.textContent("#emc-mout");
    assert.match(out, /Soybeans in that air head for 12\.8 to 13\.7%/);
    assert.match(out, /Fans wet it/);
    await pg.click('[data-grain="corn"]');
    assert.equal(await pg.isVisible("#emc-ghint"), false, "hint only for soybeans");
    assert.equal(await pg.inputValue("#emc-target"), "15.5");
    assert.deepEqual(errors, []);
    await c.close();
  } finally { await browser.close(); srv.close(); }
});

test("NDSU's 2011 soybean table: the page says it follows neither fit, and the counts are right", () => {
  const out = ND11_CELLS.filter(([, t, rh, v]) => { const e = E.emc(S, t, rh); return v < +e.wb.toFixed(1) || v > +e.wet.toFixed(1); });
  assert.equal(out.length, 22, "cells outside the printed range");
  let overHi = 0, overLo = 0;
  for (const [, t, rh, v] of ND11_CELLS) {
    const e = E.emc(S, t, rh);
    if (rh <= 60) { overHi = Math.max(overHi, v - +e.wet.toFixed(1)); overLo = Math.max(overLo, v - +e.wb.toFixed(1)); }
    if (rh >= 80) assert.ok(v <= +e.wb.toFixed(1), `${t} F ${rh}%: at or under the low fit`);
  }
  // drying calls too: "dries to target" never lands over target by NDSU 2011, for any bean moisture
  let dries = 0;
  for (const [, t, rh, v] of ND11_CELLS) for (let T = E.LIMITS.targetMin; T <= E.LIMITS.targetMax; T += 0.5) for (const M of [14, 16, 18, 20, 22]) {
    if (E.dryCall(S, E.emc(S, t, rh), M, T, null) === "dry") { dries++; assert.ok(v < T + 0.05, `${t} F ${rh}% M ${M} T ${T}: NDSU ${v}`); }
  }
  assert.ok(dries > 50);
  assert.equal(overHi.toFixed(1), "0.5");
  assert.equal(overLo.toFixed(1), "0.7");
  const t = unesc(page);
  assert.ok(!/low fit lands on Minnesota and NDSU/.test(t), "the old match claim is gone");
  assert.ok(!/Low matches Minnesota Extension \(60 F\) and NDSU/.test(t));
  assert.match(t, /The low fit lands on Minnesota, the high fit on Kentucky and Arkansas\. NDSU's 2011 table is a third set that follows neither: from 50 to 60% humidity it runs up to 0\.7 point wetter than the low fit and up to 0\.5 over the high one, and at 80 to 90% it runs as dry as the low fit or drier\. 22 of its 30 values fall outside this page's range/);
  assert.match(t, /It does not match NDSU's own 2011 soybean table/);
  assert.match(t, /checked against all 30 of its values, no hour this page calls "dries to target" would leave beans over that target by NDSU's numbers/);
  assert.match(t, /NDSU's 2011 table lists 13\.0%/);
  for (const [tt, rh] of [[40, 70], [50, 50], [60, 70], [70, 60], [50, 90]]) {
    const v = ND11[tt][ND11_RH.indexOf(rh)];
    assert.ok(page.includes(`<th scope="row">${tt} F, ${rh}%</th>`) && new RegExp(`<th scope="row">${tt} F, ${rh}%</th><td>[^<]*</td><td>[^<]*</td><td>${v.toFixed(1)}%</td>`).test(page), `${tt} F ${rh}% NDSU ${v}`);
  }
});
