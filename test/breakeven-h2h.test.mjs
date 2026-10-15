/* /breakeven in a real browser, the 2026-10-15 head-to-head fixes:
 *   1. "Your county" fills LAND RENT from the NASS county cash rent survey and
 *      EXPECTED YIELD from the county trend (same pairing rule as /rent), and
 *      says where each number came from. A withheld trend says why and leaves
 *      the yield alone. The state file loads only when a state is picked.
 *   2. A crop-year pick in the price bar: Dec '26 (2026 crop) or Dec '27
 *      (2027 crop), read off the board file. A board price follows the pick;
 *      a price the reader typed stays his.
 *   3. An optional "other revenue" line ($/ac) lowers the break-even and adds
 *      to profit. Cost/Bushel stays the full cost.
 *   4. A visible byline under the H1, and the author in the JSON-LD.
 *
 * Needs Playwright and Chromium; skipped where they are missing.
 *
 *   node --test test/breakeven-h2h.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
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

/* The board, fixed, so the arithmetic below is exact. fetched is "now" so
   the page does not call the file stale. */
function prices() {
  const q = (ticker, close) => ({ ticker, close, pctChange: 0.1, close_date: "2026-10-14" });
  return JSON.stringify({
    fetched: new Date().toISOString(),
    quotes: {
      "corn-dec": q("ZCZ26.CBT", 478.75), "corn-dec27": q("ZCZ27.CBT", 509.75),
      "beans-nov": q("ZSX26.CBT", 1272.25), "beans-nov27": q("ZSX27.CBT", 1249.75),
      wheat: q("ZW=F", 520),
    },
  });
}

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
  const hits = [];
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    hits.push(p);
    if (p === "/breakeven") p = "/breakeven.html";
    if (p === "/data/prices.json") { res.writeHead(200, { "content-type": "application/json" }); res.end(prices()); return; }
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  srv.hits = hits;
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}
async function open(browser, port, width = 390) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width, height: 844 } });
  const pg = await ctx.newPage();
  const errors = [];
  pg.on("pageerror", (e) => errors.push(String(e)));
  await pg.route("**/*", (r) => (r.request().url().startsWith(`http://127.0.0.1:${port}`) ? r.continue() : r.abort()));
  await pg.goto(`http://127.0.0.1:${port}/breakeven`);
  await pg.waitForFunction(() => document.getElementById("price").value !== "");
  return { pg, errors, ctx };
}
const txt = (pg, sel) => pg.$eval(sel, (e) => e.textContent.trim());
async function type(pg, sel, v) { await pg.fill(sel, String(v)); await pg.dispatchEvent(sel, "input"); }

test("the crop-year pick switches the board price to next year's contract and labels both", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg, errors } = await open(browser, port);
    assert.equal(await pg.inputValue("#price"), "4.7875");
    assert.equal(await txt(pg, "#breakeven"), "$5.03/bu, above your price");
    assert.equal(await txt(pg, "#profit"), "-$43/ac", "180 x 4.7875 - 905 = -43.25");
    const opts = await pg.$$eval("#be-year option", (o) => o.map((x) => x.textContent));
    assert.deepEqual(opts, ["Dec '26 corn (2026 crop)", "Dec '27 corn (2027 crop)"]);
    assert.equal(await pg.isVisible("#be-year"), true);
    assert.equal(await pg.isVisible("#yr-note"), false);
    assert.doesNotMatch(HTML, /new crop\)'/, "the old 'Dec corn (new crop)' label is gone");

    await pg.selectOption("#be-year", "1");
    assert.equal(await pg.inputValue("#price"), "5.0975", "the board price follows the contract");
    assert.equal(await txt(pg, "#profit"), "+$13/ac", "180 x 5.0975 - 905 = +12.55");
    assert.match(await txt(pg, "#yr-note"), /Planning the 2027 crop: the cost lines below are still this page.s example\. Put in your 2027 costs\./);

    await pg.selectOption("#crop", "soybeans");
    assert.deepEqual(await pg.$$eval("#be-year option", (o) => o.map((x) => x.textContent)),
      ["Nov '26 soybeans (2026 crop)", "Nov '27 soybeans (2027 crop)"]);
    assert.equal(await pg.inputValue("#price"), "12.4975", "the year pick carries over to beans");

    await pg.selectOption("#crop", "corn");
    await type(pg, "#price", "4.5");
    await pg.selectOption("#be-year", "0");
    assert.equal(await pg.inputValue("#price"), "4.5", "a price he typed is his, whatever the contract");

    await pg.selectOption("#crop", "wheat");
    assert.equal(await pg.isVisible("#be-year"), false, "wheat stays on the SRW nearby, no year pick");

    await pg.selectOption("#crop", "corn");
    await pg.reload();
    await pg.waitForFunction(() => document.getElementById("price").value !== "");
    assert.equal(await pg.inputValue("#be-year"), "0", "the pick is remembered");
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});

test("other revenue lowers the break-even, adds to profit, and the grid agrees", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg, errors } = await open(browser, port);
    assert.doesNotMatch(await txt(pg, "#be-sub"), /other revenue/);
    await type(pg, "#basis", "-0.30");
    await type(pg, "#other", "30");
    assert.equal(await txt(pg, "#costPerBu"), "$5.03/bu", "cost per bushel is still the full $905");
    assert.equal(await txt(pg, "#breakeven"), "$4.86/bu, above your price", "(905 - 30) / 180 = 4.861");
    assert.equal(await txt(pg, "#be-sub"), "After $30/ac other revenue. Before it: $5.03/bu.");
    assert.equal(await txt(pg, "#futNeeded"), "$5.16/bu", "4.861 + 0.30");
    assert.equal(await txt(pg, "#profit"), "-$67/ac", "180 x 4.4875 + 30 - 905 = -67.25");
    assert.equal(await txt(pg, "#yieldNeeded"), "195 bu/ac", "875 / 4.4875 = 194.98");
    assert.equal(await txt(pg, "#farmTotal"), "-$33,625", "500 x -67.25");
    assert.equal(await txt(pg, "#mb-be"), "$4.86/bu", "the phone bar shows the same break-even");
    assert.equal(await txt(pg, "#sens-table .sens-current"), "-$67", "the outlined cell is the headline profit");
    await type(pg, "#other", "");
    assert.equal(await txt(pg, "#breakeven"), "$5.03/bu, above your price", "blank is 0, not an error");
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});

test("your county fills rent and the paired trend yield, says where they came from, and loads one state file", { skip }, async () => {
  const IA = JSON.parse(readFileSync(ROOT + "data/cash-rent/IA.json", "utf8"));
  const c = IA.counties.find((x) => x.pair && x.pair.rent === "nonirr" && x.pair.corn && x.pair.corn.t && x.pair.corn.t.v != null);
  assert.ok(c, "an Iowa county with a paired corn trend");
  const r = c.rent.nonirr, ry = Math.max(...Object.keys(r).map(Number)), rent = r[ry];
  const yld = Math.round(c.pair.corn.t.v), ty = IA.generated.slice(0, 4);
  const NE = JSON.parse(readFileSync(ROOT + "data/cash-rent/NE.json", "utf8"));
  const w = NE.counties.find((x) => x.pair && x.pair.corn && x.pair.corn.t && x.pair.corn.t.w);
  assert.ok(w, "a Nebraska county whose corn trend is withheld");

  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg, errors } = await open(browser, port);
    assert.equal(srv.hits.some((h) => h.startsWith("/data/cash-rent/")), false, "no county file until a state is picked");
    await pg.selectOption("#co-st", "IA");
    await pg.waitForSelector("#co-co:not([disabled])");
    await pg.selectOption("#co-co", c.fips);
    assert.equal(await pg.inputValue("#land"), String(rent));
    assert.equal(await pg.inputValue("#yield"), String(yld));
    const note = await txt(pg, "#co-note");
    const money = rent % 1 ? rent.toFixed(2) : String(Math.round(rent));
    assert.ok(note.includes(`Land rent $${money}/ac: USDA NASS ${ry} county average cash rent, non-irrigated cropland, ${c.name} County.`), note);
    assert.ok(note.includes(`Yield ${yld} bu/ac: the county’s 15-year trend projected to ${ty}, a straight line through NASS`), note);
    assert.ok(note.includes("A fit, not a forecast"), note);
    assert.equal(await pg.$eval("#co-note a", (a) => a.getAttribute("href")), "/arc-plc/iowa");
    const total = 905 - 250 + rent;
    assert.equal(await txt(pg, "#costPerBu"), `$${(total / yld).toFixed(2)}/bu`);
    assert.deepEqual(srv.hits.filter((h) => h.startsWith("/data/cash-rent/")), ["/data/cash-rent/IA.json"]);

    await pg.selectOption("#crop", "wheat");
    assert.ok((await txt(pg, "#co-note")).includes("County yield fills for corn and soybeans only."));
    await pg.selectOption("#crop", "corn");

    await type(pg, "#yield", "150");
    await pg.selectOption("#co-st", "NE");
    await pg.waitForSelector("#co-co:not([disabled])");
    await pg.selectOption("#co-co", w.fips);
    assert.equal(await pg.inputValue("#yield"), "150", "a withheld trend leaves his yield alone");
    const wn = await txt(pg, "#co-note");
    assert.ok(wn.includes("No county trend yield: " + w.pair.corn.t.w + ". Yield is left as it was."), wn);

    await pg.reload();
    await pg.waitForFunction(() => document.getElementById("co-co").value !== "");
    assert.equal(await pg.inputValue("#co-st"), "NE", "the county pick is remembered");
    assert.equal(await pg.inputValue("#yield"), "150", "a reload does not refill over his numbers");
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});

test("a byline under the H1, the author in the JSON-LD, and no sideways scroll on a phone", { skip }, async () => {
  assert.match(HTML, /<h1>Break-even price calculator<\/h1><p class="be-by">Sigurd Lindquist, Certified Crop Adviser \(CCA\)/);
  const ld = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(HTML)[1]);
  const app = ld["@graph"].find((g) => g["@type"] === "WebApplication");
  assert.equal(app.author.name, "Sigurd Lindquist");
  assert.equal(app.author.jobTitle, "Certified Crop Adviser (CCA)");
  assert.doesNotMatch(HTML, /in a similar range/, "the uncited university comparison is gone");
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg, errors } = await open(browser, port, 390);
    assert.equal(await pg.isVisible(".be-by"), true);
    const sw = await pg.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(sw <= 390, "scrollWidth " + sw);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});
