/* /cash-bids: the bid email box waits below the results until there are
 * results (2026-10-16 audit: before a ZIP was entered it took about half the
 * first phone screen). Once the best prices show, it moves back under them,
 * where the Oct 13 design put it.
 *
 * Needs Playwright and Chromium; skipped where they are missing.
 *
 *   node --test test/cash-bids-signup-place.test.mjs
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

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/cash-bids") p = "/cash-bids.html";
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

test("static markup still puts the box under the best prices (the slot it returns to)", () => {
  const cb = readFileSync(ROOT + "cash-bids.html", "utf8");
  assert.ok(cb.indexOf('id="best-bids-section"') < cb.indexOf("data-bid-alerts") && cb.indexOf("data-bid-alerts") < cb.indexOf('id="cb-results"'));
  assert.match(cb, /bid-alerts slot/);
});

test("before a ZIP the email box sits below the results area folded to one line; with results it is under the best prices, open", { skip, timeout: 240000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
    const pg = await ctx.newPage();
    const errors = [];
    pg.on("pageerror", (e) => errors.push(String(e)));
    await pg.route("**/*", (r) => r.request().url().startsWith(`http://127.0.0.1:${port}`) ? r.continue() : r.abort());
    await pg.goto(`http://127.0.0.1:${port}/cash-bids`, { waitUntil: "domcontentloaded" });
    await pg.waitForFunction(() => document.readyState === "complete", null, { timeout: 60000 });
    const where = await pg.evaluate(() => {
      const box = document.querySelector('[data-bid-alerts][data-source="page:cash-bids"]');
      const res = document.getElementById("cb-results"), btn = res.nextElementSibling;
      return { btn: btn && btn.className, btnText: btn && btn.textContent, after: btn && btn.nextElementSibling === box,
               boxH: box.getBoundingClientRect().height, btnH: btn.getBoundingClientRect().height };
    });
    assert.equal(where.btn, "cb-pre-open", "a one-line opener directly after the results area");
    assert.equal(where.btnText, "Get the bids near you by email");
    assert.ok(where.after, "the box sits right after it");
    assert.equal(where.boxH, 0, "the box is folded before a ZIP");
    assert.ok(where.btnH < 90, `the opener is one line (${where.btnH}px), not half a phone screen`);
    // tapping it opens the box
    await pg.click(".cb-pre-open");
    assert.ok(await pg.evaluate(() => document.querySelector('[data-bid-alerts][data-source="page:cash-bids"]').getBoundingClientRect().height > 200), "opens on tap");
    await pg.reload({ waitUntil: "load" });
    // results arrive: the best prices show, the box goes back under them
    await pg.evaluate(() => { document.getElementById("best-bids-section").style.display = "block"; });
    await pg.waitForFunction(() => {
      const box = document.querySelector('[data-bid-alerts][data-source="page:cash-bids"]');
      let n = document.getElementById("best-bids-section").nextSibling;
      while (n && n.nodeType !== 1) n = n.nextSibling === box ? box : n.nextSibling;
      return n === box;
    }, null, { timeout: 5000 });
    assert.ok(await pg.evaluate(() => {
      const box = document.querySelector('[data-bid-alerts][data-source="page:cash-bids"]');
      return !box.classList.contains("cb-pre") && document.querySelector(".cb-pre-open").hidden;
    }), "with results the box is open and the one-line opener is gone");
    await pg.evaluate(() => { document.getElementById("best-bids-section").style.display = "none"; });
    // results cleared again: back below them (the reader opened nothing on this load, so folded)
    await pg.waitForFunction(() => {
      const btn = document.getElementById("cb-results").nextElementSibling, box = document.querySelector('[data-bid-alerts][data-source="page:cash-bids"]');
      return btn && btn.className === "cb-pre-open" && !btn.hidden && btn.nextElementSibling === box && box.classList.contains("cb-pre");
    }, null, { timeout: 5000 });
    assert.deepEqual(errors.filter((e) => !/Failed to fetch|NetworkError|net::/.test(e)), []);
  } finally { await browser.close(); srv.close(); }
});
