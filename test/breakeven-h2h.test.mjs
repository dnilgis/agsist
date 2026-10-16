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
/* The corn defaults the calculator opens with. Since 2026-10-15 the
 * fertilizer line is baked each weekday from live posted prices
 * (scripts/bake_fert_defaults.py from data/fertilizer-prices.json), so the
 * opening total moves with fertilizer prices: the hand math below is written
 * against TOTAL (it was $905 with the old typed $175 fertilizer default). An
 * empty fertilizer default (no live price) counts as 0, as the page does. */
const CORN = Object.fromEntries([...HTML.slice(HTML.indexOf("CROP_DEFAULTS")).match(/\bcorn:\{([^}]*)\}/)[1].matchAll(/(\w+):'?([\d.]*)'?/g)].map((m) => [m[1], m[2] === "" ? 0 : Number(m[2])]));
const TOTAL = ["seed", "fertilizer", "chemicals", "insurance", "machinery", "labor", "land", "overhead"].reduce((a, k) => a + CORN[k], 0);
const usd = (v) => (v >= 0 ? "+$" : "-$") + Math.abs(Math.round(v)).toLocaleString("en-US");

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
    assert.equal(CORN.yield, 180);
    assert.equal(await txt(pg, "#breakeven"), `$${(TOTAL / 180).toFixed(2)}/bu, above your price`);
    assert.equal(await txt(pg, "#profit"), usd(180 * 4.7875 - TOTAL) + "/ac", "180 x 4.7875 - total");
    const opts = await pg.$$eval("#be-year option", (o) => o.map((x) => x.textContent));
    assert.deepEqual(opts, ["Dec '26 corn (2026 crop)", "Dec '27 corn (2027 crop)"]);
    assert.equal(await pg.isVisible("#be-year"), true);
    assert.equal(await pg.isVisible("#yr-note"), false);
    assert.doesNotMatch(HTML, /new crop\)'/, "the old 'Dec corn (new crop)' label is gone");

    await pg.selectOption("#be-year", "1");
    assert.equal(await pg.inputValue("#price"), "5.0975", "the board price follows the contract");
    assert.equal(await txt(pg, "#profit"), usd(180 * 5.0975 - TOTAL) + "/ac", "180 x 5.0975 - total");
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
    const be = (TOTAL - 30) / 180, prof = 180 * 4.4875 + 30 - TOTAL;
    assert.ok(prof < 0, "the hand case below is a loss at these defaults");
    assert.equal(await txt(pg, "#costPerBu"), `$${(TOTAL / 180).toFixed(2)}/bu`, "cost per bushel is still the full total");
    assert.equal(await txt(pg, "#breakeven"), `$${be.toFixed(2)}/bu, above your price`, "(total - 30) / 180");
    assert.equal(await txt(pg, "#be-sub"), `After $30/ac other revenue. Before it: $${(TOTAL / 180).toFixed(2)}/bu.`);
    assert.equal(await txt(pg, "#futNeeded"), `$${(be + 0.30).toFixed(2)}/bu`, "break-even + 0.30 basis");
    assert.equal(await txt(pg, "#profit"), usd(prof) + "/ac", "180 x 4.4875 + 30 - total");
    assert.equal(await txt(pg, "#yieldNeeded"), `${Math.ceil((TOTAL - 30) / 4.4875 - 1e-9)} bu/ac`, "(total - 30) / 4.4875, rounded up");
    assert.equal(await txt(pg, "#farmTotal"), usd(500 * prof), "500 acres x the acre profit");
    assert.equal(await txt(pg, "#mb-be"), `$${be.toFixed(2)}/bu`, "the phone bar shows the same break-even");
    assert.equal(await txt(pg, "#sens-table .sens-current"), usd(prof), "the outlined cell is the headline profit");
    await type(pg, "#other", "");
    assert.equal(await txt(pg, "#breakeven"), `$${(TOTAL / 180).toFixed(2)}/bu, above your price`, "blank is 0, not an error");
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
    const total = TOTAL - 250 + rent;
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

/* Source sweep, Oct 15, 2026: the 2027 university line uses farmdoc's own
 * numbers ("Illinois Crop Budgets for 2027", farmdoc daily (16):157, Sep 1,
 * 2026): corn total-cost break-even just below $5 north/central, $5.39 south;
 * soybeans $11.10 to $11.28 north/central, nearly $12 south. Purdue's 2027
 * guide page prints no break-even, so it is not quoted. */
test("2027 university break-even line is farmdoc's own figures, cited and dated", async () => {
  const { readFileSync } = await import("node:fs");
  const html = readFileSync(new URL("../breakeven.html", import.meta.url), "utf8");
  const line = html.match(/<span id="be-univ">([\s\S]*?)<\/span>/)[1];
  assert.match(line, /University budgets put 2027 corn break-even at about \$5 a bushel/);
  assert.match(line, /just under \$5 in northern and central Illinois and \$5\.39 in southern Illinois/);
  assert.match(line, /\$11\.10 to \$11\.28 in the north and center and nearly \$12 in the south/);
  assert.match(line, /href="https:\/\/farmdocdaily\.illinois\.edu\/2026\/09\/illinois-crop-budgets-for-2027\.html"/);
  assert.match(line, /\(Sep 1, 2026\)/);
  assert.doesNotMatch(line, /Purdue/, "no Purdue number until its guide is read");
});
