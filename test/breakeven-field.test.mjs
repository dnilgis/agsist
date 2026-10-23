/* /breakeven, field audit fixes (2026-10-17).
 *   - each "?" is itself a 40 x 40 button (a ::before hit area did not count as
 *     a tap target) and stops short of the input under its label;
 *   - the crop-year switch sits beside the answer in the first screen, Dec '27
 *     still the default, and flipping it moves the contract select with it.
 *
 *   node --test test/breakeven-field.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const HTML = readFileSync(ROOT + "breakeven.html", "utf8");
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

test("the switch is in the answer box and the ? is a real 40px button", () => {
  const ans = HTML.match(/<section class="be-ans"[\s\S]*?<\/section>/)[0];
  assert.match(ans, /id="be-yr2" role="radiogroup" aria-label="Crop year"/);
  assert.match(HTML, /\.hint-icon\{display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;/);
  assert.doesNotMatch(HTML, /\.hint-icon::before\{content:"";position:absolute;inset:-12px;\}/);
  assert.match(HTML, /breakeven\.js\?v=6/); // v6 2026-10-23: the page ask under the answer (fx/pageasks); v5 2026-10-19: flat A2809 corn N (money audit 1)
});

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (!extname(p)) p += ".html";
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

test("at 390: 40px tap targets clear of the inputs, and the crop year flips from the first screen", { skip, timeout: 60000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    const pg = await ctx.newPage();
    await pg.goto(`http://127.0.0.1:${port}/breakeven`);
    await pg.waitForFunction(() => !document.getElementById("be-yr2").hidden, null, { timeout: 20000 });
    const hints = await pg.evaluate(() => [...document.querySelectorAll(".hint-icon")].filter((b) => b.offsetParent).map((b) => {
      const r = b.getBoundingClientRect(), i = b.closest(".input-wrap").querySelector("input").getBoundingClientRect();
      return { w: r.width, h: r.height, gap: i.top - r.bottom };
    }));
    assert.ok(hints.length >= 10, "the ? buttons are on the page");
    for (const h of hints) { assert.ok(h.w >= 40 && h.h >= 40, JSON.stringify(h)); assert.ok(h.gap >= 0, "the tap target stops above the input: " + JSON.stringify(h)); }
    const y2 = await pg.evaluate(() => { const r = document.getElementById("be-yr2").getBoundingClientRect(); return { top: r.bottom, vh: innerHeight, txt: document.getElementById("be-yr2").innerText, on: document.querySelector('#be-yr2 input:checked').value }; });
    assert.ok(y2.top < y2.vh, "in the first screen: " + JSON.stringify(y2));
    assert.match(y2.txt, /2026 crop, Dec '26/); assert.match(y2.txt, /2027 crop, Dec '27/);
    assert.equal(y2.on, "1", "Dec '27 stays the default");
    await pg.click('#be-yr2 input[value="0"]', { force: true });
    assert.equal(await pg.$eval("#be-year", (s) => s.value), "0", "the contract select follows");
    await ctx.close();
  } finally { await browser.close(); srv.close(); }
});
