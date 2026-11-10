/* /rain opens on the reader's saved place (scripts/build_county_rain.py SAVED_JS).
 *
 *   node --test test/rain-hub-saved-place.test.mjs
 *
 *   - with Ames, Iowa saved, the line names the whole county ("Story County, Iowa", not "Story, Iowa":
 *     the saved record keeps the county without its "County"), links the Story County page found on the
 *     Iowa page, and the state picker is set to Iowa;
 *   - with nothing saved, the line stays hidden and the picker stays empty;
 *   - the page reads only its own host (outside hosts and service workers blocked). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
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
    if (p === "/") p = "/index.html"; else if (!extname(p)) p += ".html";
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

test("the built /rain carries the saved-place line, hidden until a place is read", () => {
  const h = readFileSync(join(ROOT, "rain.html"), "utf8");
  assert.match(h, /<p class="rc-fine" id="rc-mine" data-st="[^"]*" hidden><\/p>/);
  assert.match(h, /<script src="\/components\/saved-place\.js\?v=\d+"><\/script>/);
});

test("/rain in a browser: Ames saved names Story County, Iowa; nothing saved shows nothing", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    async function open(ls) {
      const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
      await ctx.route("**/*", (r) => (new URL(r.request().url()).host === `127.0.0.1:${port}` ? r.continue() : r.abort()));
      if (ls) await ctx.addInitScript((o) => { for (const k in o) localStorage.setItem(k, o[k]); }, ls);
      const pg = await ctx.newPage();
      await pg.goto(`http://127.0.0.1:${port}/rain`);
      return { ctx, pg };
    }
    const ames = JSON.stringify({ zip: "50010", state: "IA", county: "Story County", label: "Ames, IA", lat: 42.03, lon: -93.62, ts: 1 });
    {
      const { ctx, pg } = await open({ "agsist-wx-loc": ames });
      await pg.waitForFunction(() => { const b = document.getElementById("rc-mine"); return b && !b.hidden; }, null, { timeout: 30000 });
      const o = await pg.evaluate(() => {
        const b = document.getElementById("rc-mine"), a = b.querySelector("a");
        return { text: b.textContent, href: a && a.getAttribute("href"), pick: document.getElementById("rc-pick-st").value };
      });
      assert.match(o.text, /^Your saved place is in Story County, Iowa: /, o.text);
      assert.doesNotMatch(o.text, /Story, Iowa/, o.text);
      assert.equal(o.href, "/rain/iowa/story-county", o.text);
      assert.match(o.text, /rain this year in your county\.$/, o.text);
      assert.equal(o.pick, "/rain/iowa");
      await ctx.close();
    }
    {
      const { ctx, pg } = await open(null);
      await pg.waitForLoadState("networkidle");
      const o = await pg.evaluate(() => {
        const b = document.getElementById("rc-mine");
        return { hidden: b.hidden, text: b.textContent, pick: document.getElementById("rc-pick-st").value };
      });
      assert.equal(o.hidden, true, "nothing saved: the line stays hidden");
      assert.equal(o.text, "");
      assert.equal(o.pick, "", "nothing saved: the picker stays on Choose your state");
      await ctx.close();
    }
  } finally { await browser.close(); srv.close(); }
});
