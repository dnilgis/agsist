/* /store-or-sell in a real browser, the head-to-head fixes of 2026-10-15.
 *
 *   1. The board answer counts storage and interest from today, not from
 *      December. On Oct 15 a farmer choosing between selling now and July
 *      holds 9 months: Dec '26 to Jul '27 corn at +27c carry, $4.78 3/4,
 *      3.5c a month and 7% is 27 - 31.5 - 25.13 = -29.6, shown -30c (it was
 *      -17c on 7 months).
 *   2. When none of the nearest boards posts a later month, the page looks
 *      out to 150 miles and names the nearest one that does, with its
 *      distance and its own line.
 *   3. A carry that nets above zero says how it can be locked today.
 *
 * Every outside request is answered from fixtures here; the clock is fixed
 * at 2026-10-15 10:00 in Chicago.
 *
 * Needs Playwright and Chromium; skipped where they are missing.
 *
 *   node --test test/store-or-sell-board.test.mjs
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

const PRICES = { quotes: {
  "corn-dec26": { ticker: "ZCZ26.CBT", close: 478.75, close_date: "2026-10-14" },
  "corn-mar27": { ticker: "ZCH27.CBT", close: 492.75, close_date: "2026-10-14" },
  "corn-may27": { ticker: "ZCK27.CBT", close: 499.75, close_date: "2026-10-14" },
  "corn-jul27": { ticker: "ZCN27.CBT", close: 505.75, close_date: "2026-10-14" },
} };
const HOME = [45.31, -91.65];       // the test ZIP 54728
/* Places north of the ZIP, 0.05 degrees (about 3.5 miles) apart. */
function place(i, dLat, laterCash, spotCash) {
  return {
    place: "p" + i, operator: "Test Elevator " + i, city: "Town" + i, state: "WI",
    lat: HOME[0] + dLat, lon: HOME[1], currency: "USD", shard: "merged/p" + i + ".json",
    now: { corn: { cash: spotCash, basis: -0.6, period: "2026-10" } },
    best: { corn: laterCash ? { cash: laterCash, period: "2027-07" } : { cash: spotCash, period: "2026-10" } },
    _later: laterCash,
  };
}
const SCENES = {
  /* seven near boards with only a spot bid; one 100 miles out, past the
     75-mile hauling radius, posting July */
  farther: [1, 2, 3, 4, 5, 6, 7].map((i) => place(i, 0.05 * i, null, 4.2)).concat([place(8, 1.45, 4.6, 4.2)]),
  /* the same near boards and nothing further out */
  none: [1, 2, 3, 4, 5, 6, 7].map((i) => place(i, 0.05 * i, null, 4.2)),
  /* the nearest board posts July at +80c over its October bid */
  lock: [place(1, 0.05, 5.0, 4.2)],
};
function bidsFixture(scene, path) {
  const ps = SCENES[scene];
  if (path.endsWith("data/zips/54.json")) return { "54728": HOME };
  if (path.endsWith("data/merged-index.json")) return { generated: "2026-10-15T04:00:00Z", places: ps.map(({ _later, ...p }) => p) };
  const m = /data\/merged\/(p\d+)\.json$/.exec(path);
  if (m) {
    const p = ps.find((x) => x.place === m[1]);
    if (!p) return null;
    const bids = [{ crop: "corn", commodity: "Corn", period: "2026-10", cash: p.now.corn.cash }];
    if (p._later) bids.push({ crop: "corn", commodity: "Corn", period: "2027-07", cash: p._later });
    return { pricedAt: "2026-10-15T13:00:00Z", bids };
  }
  return null;
}

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/store-or-sell") p = "/store-or-sell.html";
    if (p === "/data/prices.json") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(PRICES)); return; }
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}
async function open(browser, port, path, scene) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(() => {
    const T = Date.parse("2026-10-15T15:00:00Z"), R = Date;
    class F extends R { constructor(...a) { super(...(a.length ? a : [T])); } static now() { return T; } }
    window.Date = F;
  });
  const pg = await ctx.newPage();
  const errors = [];
  pg.on("pageerror", (e) => errors.push(String(e)));
  await pg.route("**/*", (r) => {
    const u = r.request().url();
    if (u.startsWith(`http://127.0.0.1:${port}`)) return r.continue();
    if (u.startsWith("https://dnilgis.github.io/bids/")) {
      const j = bidsFixture(scene, new URL(u).pathname);
      return j ? r.fulfill({ contentType: "application/json", body: JSON.stringify(j) }) : r.fulfill({ status: 404, body: "" });
    }
    return r.abort();
  });
  await pg.goto(`http://127.0.0.1:${port}${path}`);
  return { pg, errors, ctx };
}

test("board answer counts from today, and the nearest elevator posting a later bid is named with its distance", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg, errors } = await open(browser, port, "/store-or-sell?zip=54728&crop=corn", "farther");
    await pg.waitForFunction(() => /nearest elevator we found/.test(document.getElementById("sos-where").textContent), null, { timeout: 15000 });
    assert.equal((await pg.textContent("#sos-answer")).trim(), "Hold to Jul? +27¢ futures carry, net of storage and interest: −30¢ a bushel.");
    const where = await pg.textContent("#sos-where");
    assert.ok(where.includes("None of the 6 elevators nearest 54728 posts a later corn bid right now, so this is the board."), where);
    assert.ok(where.includes("Storage and interest from now: Oct '26 to Jul '27, 9 months."), where);
    assert.ok(where.includes("The nearest elevator we found that does is Test Elevator 8, Town8, 100 miles away: Hold to Jul? +40¢ posted carry, net of storage and interest: −14¢ a bushel."), where);
    const math = await pg.textContent("#sos-math");
    assert.match(math, /storage \$0\.0350 × 9 mo \(Oct '26 to Jul '27\)/);
    assert.match(math, /rounded to −30¢/);
    assert.doesNotMatch(await pg.textContent("#sos-note"), /lock/, "a losing carry gets no lock line");
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});

test("with no later bid anywhere it looked, the page says how many boards it read and how far out", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg, errors } = await open(browser, port, "/store-or-sell?zip=54728&crop=corn", "none");
    await pg.waitForFunction(() => /We read the boards/.test(document.getElementById("sos-where").textContent), null, { timeout: 15000 });
    const where = await pg.textContent("#sos-where");
    assert.ok(where.includes("No elevator we read near 54728 posts a later corn bid right now, so this is the board."), where);
    assert.ok(where.endsWith("We read the boards of the 7 nearest elevators, out to 24 miles."), where);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});

test("a carry that nets above zero at the elevator says it can be locked with a forward contract", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg, errors } = await open(browser, port, "/store-or-sell?zip=54728&crop=corn", "lock");
    await pg.waitForFunction(() => /posted carry/.test(document.getElementById("sos-answer").textContent), null, { timeout: 15000 });
    /* 80 - 31.5 - 4.20 x 7% x 9/12 (22.05) = 26.45 */
    assert.equal((await pg.textContent("#sos-answer")).trim(), "Hold to Jul? +80¢ posted carry, net of storage and interest: +26¢ a bushel.");
    assert.ok((await pg.textContent("#sos-note")).includes("You can lock this today with a forward contract for Jul '27 delivery at this elevator. That fixes both the futures and the basis; ask the elevator for its terms."));
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});
