/* /breakeven, the Oct 17, 2026 re-score fixes:
 *   1. The county fills from the location the site already saved
 *      (agsist-wx-loc, written by geo.js); a returning reader's own numbers
 *      stand; a bare ZIP with no county picks nothing.
 *   2. One sentence of sensitivity under the answer, computed live:
 *      "Each 50 cents on futures moves this field $X an acre".
 *   3. Every cost line says where it came from and when: farmdoc's 2027
 *      budget lines (Table 1, Sep 1, 2026), fertilizer at posted prices,
 *      NASS county rent and trend, or "Your number". Wheat says it is an example.
 *   4. A county ARC/PLC estimate prefilled into other revenue, labeled.
 *   5. The crop year carries to the county trend (2027 = 2026 + slope).
 *   6. No sideways scroll at 390 px, the what-if grid included; 390 and 1280,
 *      light and dark, no console errors.
 *   7. The price box says "settle" only for a recorded settle, else "last trade".
 *   8. County detail is one small file per state (data/breakeven/<ST>.json).
 *
 *   node --test test/breakeven-best.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;
const HTML = readFileSync(ROOT + "breakeven.html", "utf8");
const JS = readFileSync(ROOT + "components/breakeven.js", "utf8");
const obj = (name) => { const m = new RegExp("var " + name + "=(\\{[\\s\\S]*?\\});\\n").exec(HTML) || new RegExp("var " + name + "=(\\{[^;]*\\});").exec(HTML); return Function("return " + m[1])(); };
const CD = obj("CROP_DEFAULTS"), BUD = obj("BUDGETS"), FERT = obj("FERT");
const fertAt = (crop, y) => { const lb = FERT.r[crop].map((x) => Math.round(y * x)); return Math.round(lb[0] * FERT.n + lb[1] * FERT.p + lb[2] * FERT.k); };
const IA = JSON.parse(readFileSync(ROOT + "data/breakeven/IA.json", "utf8"));
const STORY = IA.c.find((c) => c.n === "Story");

test("farmdoc 2027 Table 1 lines add up to the published totals, and the corn and soybean defaults are the northern Illinois budget", () => {
  /* Table 1 (farmdoc daily (16):157): total non-land costs less fertilizers, by region.
     N corn 881-249, N beans 508-71, CH corn 885-263, CH beans 534-77,
     CL corn 873-260, CL beans 515-74, S corn 876-264, S beans 532-77. */
  const want = { n: [632, 437], ch: [622, 457], cl: [613, 441], s: [612, 455] };
  const land = { n: 293, ch: 321, cl: 279, s: 186 };
  for (const [k, [c, b]] of Object.entries(want)) {
    const sum = (o) => ["seed", "chemicals", "insurance", "machinery", "labor", "overhead"].reduce((a, x) => a + o[x], 0);
    assert.equal(sum(BUD.r[k].corn), c, k + " corn");
    assert.equal(sum(BUD.r[k].soybeans), b, k + " soybeans");
    assert.equal(BUD.r[k].corn.land, land[k]);
  }
  for (const crop of ["corn", "soybeans"]) for (const x of ["yield", "seed", "chemicals", "insurance", "machinery", "labor", "overhead", "land"]) assert.equal(CD[crop][x], BUD.r.n[crop][x], crop + " " + x);
  assert.equal(CD.corn.fertilizer, fertAt("corn", 237));
  assert.match(BUD.url, /^https:\/\/farmdocdaily\.illinois\.edu\/2026\/09\/illinois-crop-budgets-for-2027\.html$/);
  assert.match(BUD.src, /Table 1 \(Aug 2026 release, published Sep 1, 2026\)/);
  assert.doesNotMatch(HTML + JS, /—/, "no em dashes");
  assert.doesNotMatch(HTML, /representative Upper Midwest/, "the unsourced default story is gone");
});

test("county files are small, current with their sources, and carry the build's own ARC/PLC numbers", () => {
  execFileSync("python3", ["scripts/build_breakeven_data.py", "--check"], { cwd: ROOT, encoding: "utf8" });
  execFileSync("python3", ["scripts/build_breakeven_data.py", "--selftest"], { cwd: ROOT, encoding: "utf8" });
  assert.ok(statSync(ROOT + "data/breakeven/IA.json").size < statSync(ROOT + "data/cash-rent/IA.json").size / 4);
  const math = JSON.parse(readFileSync(ROOT + "data/arc-plc/math/IA.json", "utf8")).c[STORY.f];
  assert.deepEqual(STORY.a.corn["2026"], math.v.corn[0]["2026"].slice(0, 3));
  assert.deepEqual(STORY.r, [290, 2026, "nonirr"]);
  /* the page's own words for Story corn 2026 match the county ARC/PLC page */
  const page = readFileSync(ROOT + "arc-plc/iowa/story-county.html", "utf8");
  assert.ok(page.includes(`$${(STORY.a.corn["2026"][1] / 100).toFixed(2)} PLC vs $${(STORY.a.corn["2026"][2] / 100).toFixed(2)} ARC-CO per base acre`));
  assert.ok(statSync(ROOT + "breakeven.html").size < 75000, "the page itself stays lean; the calculator is components/breakeven.js");
  assert.match(HTML, /<script src="\/components\/breakeven\.js\?v=\d+" defer><\/script>/);
});

/* ------------------------------------------------------------ browser */
function prices(settled) {
  const q = (ticker, close) => settled
    ? { ticker, close, close_date: "2026-10-16", prev_date: "2026-10-15", settles: { "2026-10-15": close + 4, "2026-10-16": close }, pctChange: -0.8 }
    : { ticker, close, pctChange: 0.1, close_date: "2026-10-16" };
  return JSON.stringify({ fetched: new Date().toISOString(), quotes: {
    "corn-dec": q("ZCZ26.CBT", 474.25), "corn-dec27": q("ZCZ27.CBT", 505.25),
    "beans-nov": q("ZSX26.CBT", 1272.25), "beans-nov27": q("ZSX27.CBT", 1249.75), wheat: q("ZW=F", 520) } });
}
function serve(settled = true) {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
  const hits = [];
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname); hits.push(p);
    if (p === "/breakeven") p = "/breakeven.html";
    if (p === "/data/prices.json") { res.writeHead(200, { "content-type": "application/json" }); res.end(prices(srv.settled)); return; }
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" }); res.end(readFileSync(f));
  });
  srv.hits = hits; srv.settled = settled;
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}
async function open(browser, port, { width = 390, theme = "dark", ls = {} } = {}) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width, height: 844 }, colorScheme: theme });
  const pg = await ctx.newPage();
  const errors = [];
  pg.on("pageerror", (e) => errors.push(String(e)));
  pg.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await pg.route("**/*", (r) => (r.request().url().startsWith(`http://127.0.0.1:${port}`) ? r.continue() : r.abort()));
  await pg.addInitScript(([theme, ls]) => { localStorage.setItem("agsist-theme", theme); for (const k in ls) localStorage.setItem(k, ls[k]); }, [theme, ls]);
  await pg.goto(`http://127.0.0.1:${port}/breakeven`);
  await pg.waitForFunction(() => document.getElementById("price").value !== "");
  return { pg, errors, ctx };
}
const txt = (pg, sel) => pg.$eval(sel, (e) => e.textContent.trim());
async function type(pg, sel, v) { await pg.fill(sel, String(v)); await pg.dispatchEvent(sel, "input"); }
const LOC = JSON.stringify({ state: "IA", county: "Story County", zip: "50010", lat: 42.03, lon: -93.62 });

test("the saved location fills the county, rent, trend yield and an ARC/PLC estimate on the first screen", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg, errors } = await open(browser, port, { ls: { "agsist-wx-loc": LOC } });
    await pg.waitForFunction(() => document.getElementById("co-co").value !== "");
    assert.equal(await pg.inputValue("#co-st"), "IA");
    assert.equal(await pg.inputValue("#co-co"), STORY.f);
    const yld = Math.round(STORY.y.corn.v);
    assert.equal(await pg.inputValue("#land"), "290");
    assert.equal(await pg.inputValue("#yield"), String(yld));
    assert.equal(await pg.inputValue("#other"), "6.44", "ARC-CO $6.44 per base acre, the build's lean-ARC pick");
    const note = await txt(pg, "#co-note");
    assert.match(note, /Story County, IA, from the location you saved on AGSIST/);
    assert.match(note, /Other revenue \$6\.44\/ac: AGSIST.s ARC-CO estimate for corn base acres in Story County, 2026 program year \(PLC \$1\.13\)\. Per base acre at FSA.s 85% payment acres, before sequestration, paid after Oct 1, 2027\. It counts one base acre for each planted acre; change it if yours differ\. An estimate, not a sure payment\./);
    assert.equal(await pg.$eval("#co-note a", (a) => a.getAttribute("href")), "/arc-plc/iowa/story-county");
    assert.equal(await txt(pg, "#src-other"), "Estimate: ARC-CO, Story County, 2026 program year.");
    assert.equal(await txt(pg, "#src-land"), "USDA NASS 2026 cash rent, Story County.");
    /* hand math: 632 budget lines + fertilizer at 217 bu + 290 rent, less 6.44 */
    const total = 632 + fertAt("corn", yld) + 290, be = (total - 6.44) / yld;
    assert.equal(await txt(pg, "#ans-be"), "$" + be.toFixed(2));
    assert.match(await txt(pg, "#ans-from"), /^Rent and trend yield from Story County, IA \(your saved location\); an ARC\/PLC estimate in other revenue; other costs from farmdoc.s 2027 northern Illinois budget; fertilizer at co-op prices posted through /);
    assert.deepEqual(srv.hits.filter((h) => h.startsWith("/data/breakeven/")), ["/data/breakeven/IA.json"]);

    /* the 2027 crop: the trend moves one slope, the 2027 estimate replaces 2026 */
    await pg.selectOption("#be-year", "1");
    const y27 = Math.round(STORY.y.corn.v + STORY.y.corn.s);
    assert.equal(await pg.inputValue("#yield"), String(y27));
    assert.match(await txt(pg, "#co-note"), new RegExp("trend projected to 2027"));
    const a27 = STORY.a.corn["2027"];   /* "close": the larger of the two */
    const v27 = Math.max(a27[1], a27[2]) / 100;
    assert.equal(await pg.inputValue("#other"), v27 % 1 ? v27.toFixed(2) : String(v27));
    assert.match(await txt(pg, "#co-note"), /2027 program year/);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});

test("a returning reader keeps his numbers; a bare ZIP picks no county; his own other revenue is never overwritten", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const saved = JSON.stringify({ crop: "corn", perCrop: { corn: { yield: "190", land: "250", other: "" } } });
    let { pg, errors, ctx } = await open(browser, port, { ls: { "agsist-wx-loc": LOC, "agsist-breakeven": saved } });
    await pg.waitForFunction(() => document.getElementById("co-co").value !== "");
    assert.equal(await pg.inputValue("#yield"), "190", "his saved yield stands");
    assert.equal(await pg.inputValue("#land"), "250", "his saved rent stands");
    assert.equal(await txt(pg, "#src-yield"), "Your number.");
    assert.deepEqual(errors, []);
    await ctx.close();

    const before = srv.hits.length;
    ({ pg, errors, ctx } = await open(browser, port, { ls: { agsist_zip: "50010" } }));
    await pg.waitForTimeout(300);
    assert.equal(srv.hits.slice(before).some((h) => h.startsWith("/data/breakeven/")), false, "a ZIP with no county saved loads nothing");
    assert.equal(await pg.inputValue("#co-st"), "");
    await ctx.close();

    ({ pg, errors, ctx } = await open(browser, port));
    await type(pg, "#other", "12");
    await pg.selectOption("#co-st", "IA");
    await pg.waitForSelector("#co-co:not([disabled])");
    await pg.selectOption("#co-co", STORY.f);
    assert.equal(await pg.inputValue("#other"), "12", "his other revenue stays");
    assert.match(await txt(pg, "#co-note"), /Other revenue \(yours kept; our estimate is \$6\.44\/ac\)/);
    /* a county with no typical-farm estimate fills no number and says why */
    await type(pg, "#other", "");
    await pg.selectOption("#co-st", "CO");
    await pg.waitForSelector("#co-co:not([disabled])");
    await pg.selectOption("#co-co", "08039");
    assert.equal(await pg.inputValue("#other"), "");
    assert.match(await txt(pg, "#co-note"), /No ARC\/PLC estimate in other revenue: FSA.s county PLC yield is above the benchmark/);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});

test("one sentence of sensitivity under the answer, computed live, and the grid says it too", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg, errors } = await open(browser, port);
    const total = ["seed", "fertilizer", "chemicals", "insurance", "machinery", "labor", "land", "overhead"].reduce((a, k) => a + CD.corn[k], 0);
    const up = Math.round((total / 227 - total / 237) * 100);
    const want = `Each 50 cents on futures moves this field $118.50 an acre ($59,250 on 500 acres); 10 bushels less yield raises the break-even ${up} cents.`;
    assert.equal(await txt(pg, "#ans-sens"), want, "0.50 x 237 bu; 500 ac x 118.50");
    assert.equal(await txt(pg, "#sens-say"), want);
    /* the grid agrees: one 20-cent column is 0.20 x 237 = $47.40 an acre */
    const row = await pg.$$eval("#sens-table tr", (r) => r.map((x) => [...x.children].map((c) => c.textContent)));
    const mine = row.find((r) => r[0].startsWith("237"));
    const n = (s) => Number(s.replace(/[^\d-]/g, "").replace(/^(-?)/, "$1"));
    assert.ok(Math.abs((n(mine[5]) - n(mine[4])) - 47.4) <= 1, mine.join(" "));
    await type(pg, "#yield", "200");
    await type(pg, "#acres", "1000");
    assert.match(await txt(pg, "#ans-sens"), /^Each 50 cents on futures moves this field \$100 an acre \(\$100,000 on 1,000 acres\);/);
    assert.match(await txt(pg, "#ans-fut"), /^Futures needed at your basis: \$\d+\.\d\d\. At \$4\.74¼ futures you lose \$\d+ an acre\.$/);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});

test("every cost line says where it came from; a budget region swaps the budget lines and keeps his", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg, errors } = await open(browser, port);
    for (const id of ["seed", "chemicals", "insurance", "machinery", "labor", "overhead"]) assert.equal(await txt(pg, "#src-" + id), "From farmdoc\u2019s 2027 budget, northern Illinois (Aug 2026).", id);
    assert.equal(await txt(pg, "#src-land"), "farmdoc\u2019s 2027 budget: northern Illinois average cash rent.");
    assert.match(await txt(pg, "#src-fertilizer"), /^213 lb N, 88 lb P₂O₅, 57 lb K₂O for 237 bu at co-op prices posted through [A-Z][a-z]{2} \d+, 2026\. Follows your yield\.$/);
    assert.match(await txt(pg, "#be-region-note"), /farmdoc daily, Illinois Crop Budgets for 2027, Table 1 \(Aug 2026 release, published Sep 1, 2026\)/);
    await type(pg, "#seed", "120");
    assert.equal(await txt(pg, "#src-seed"), "Your number.");
    await pg.selectOption("#be-region", "ch");
    assert.equal(await pg.inputValue("#seed"), "120", "his seed stays");
    assert.equal(await pg.inputValue("#chemicals"), "119");
    assert.equal(await pg.inputValue("#yield"), "245");
    assert.equal(await pg.inputValue("#land"), "321");
    assert.equal(await pg.inputValue("#fertilizer"), String(fertAt("corn", 245)), "fertilizer follows the yield");
    assert.equal(await txt(pg, "#src-chemicals"), "From farmdoc\u2019s 2027 budget, central Illinois, high-productivity (Aug 2026).");
    await type(pg, "#fertilizer", "200");
    await type(pg, "#yield", "180");
    assert.equal(await pg.inputValue("#fertilizer"), "200", "a typed fertilizer is his and stops following");
    await pg.selectOption("#crop", "wheat");
    assert.equal(await txt(pg, "#src-seed"), "This page’s own example, not a published budget.");
    assert.equal(await pg.isDisabled("#be-region"), true);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});

test("the price box says settle only for a recorded settle, else last trade", { skip }, async () => {
  const srv = await serve(true), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    let { pg, errors, ctx } = await open(browser, port);
    const t = await txt(pg, "#live-chg-val");
    assert.match(t, /^▼ −4¢ \(−0\.84%\) · Oct 16 settle, change from Oct 15$/, t);
    await ctx.close();
    srv.settled = false;
    ({ pg, errors, ctx } = await open(browser, port));
    const t2 = await txt(pg, "#live-chg-val");
    assert.match(t2, /^last trade as of /, t2);
    assert.doesNotMatch(t2, /close|%/, "no settle claim and no change with no settles to measure it from");
    assert.doesNotMatch(JS, /last close/);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});

test("no sideways scroll at 390 or 1280, light and dark, the what-if grid included", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  const shots = process.env.BE_SHOTS;
  try {
    for (const width of [390, 1280]) for (const theme of ["light", "dark"]) {
      const { pg, errors, ctx } = await open(browser, port, { width, theme, ls: { "agsist-wx-loc": LOC } });
      await pg.waitForFunction(() => document.getElementById("co-co").value !== "");
      const [sw, gw, gc] = await pg.evaluate(() => { const g = document.querySelector(".sens-wrap"); return [document.documentElement.scrollWidth, g.scrollWidth, g.clientWidth]; });
      assert.ok(sw <= width, `${width} ${theme}: page scrollWidth ${sw}`);
      assert.ok(gw <= gc, `${width} ${theme}: grid ${gw} > ${gc}`);
      if (shots) await pg.screenshot({ path: `${shots}/test-${width}-${theme}.png`, fullPage: true });
      assert.deepEqual(errors, [], `${width} ${theme}`);
      await ctx.close();
    }
  } finally { await browser.close(); srv.close(); }
});

test("the ? tips and the county code load on demand, not with the page", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg, errors } = await open(browser, port);
    await pg.waitForTimeout(200);
    assert.equal(srv.hits.some((h) => h.startsWith("/components/breakeven-more.js")), false, "not loaded for a new visitor who has not touched it");
    assert.equal(await pg.$$eval(".hint-popup", (x) => x.length), 0);
    await pg.click('label[for="seed"] .hint-icon');
    await pg.waitForSelector(".hint-popup.hint-open");
    assert.match(await txt(pg, ".hint-popup.hint-open"), /Technology \/ trait fees/);
    assert.equal(await pg.$eval('label[for="seed"] .hint-icon', (b) => b.getAttribute("aria-expanded")), "true");
    await pg.click("h1");
    assert.equal(await pg.$$eval(".hint-popup.hint-open", (x) => x.length), 0, "a tap elsewhere closes it");
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});
