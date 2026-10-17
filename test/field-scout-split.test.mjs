/* Field Scout loads in parts (Oct 16, 2026). Before: one 253 KB field-scout.js
 * (83 KB gzip) on the first screen. Now field-scout.js is the map, the field tools
 * and saved fields; field-scout-read.js (the read) comes on the first touch or when
 * a field is picked; field-scout-extras.js (print report, export, photos) on its buttons.
 *
 *   node --test test/field-scout-split.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { gzipSync } from "node:zlib";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const HTML = read("field-scout.html");
const CORE = read("field-scout.js");
// The stated budget for the first screen's own script. Raise it only on purpose.
const FIRST_LOAD_MAX = 80 * 1024, FIRST_LOAD_GZ_MAX = 26 * 1024;

test("the first screen's script stays under 80 KB (26 KB gzip)", () => {
  const n = Buffer.byteLength(CORE), gz = gzipSync(CORE).length;
  assert.ok(n <= FIRST_LOAD_MAX, `field-scout.js is ${n} bytes, over ${FIRST_LOAD_MAX}`);
  assert.ok(gz <= FIRST_LOAD_GZ_MAX, `field-scout.js is ${gz} bytes gzip, over ${FIRST_LOAD_GZ_MAX}`);
});

test("the page tags only the first-screen script; the parts load from it by version", () => {
  assert.match(HTML, /<script src="\/field-scout\.js\?v=\d+" defer><\/script>/);
  assert.doesNotMatch(HTML, /field-scout-(read|extras)\.js/);
  assert.match(CORE, /var FS_READ_SRC='\/field-scout-read\.js\?v=\d+', FS_EXTRAS_SRC='\/field-scout-extras\.js\?v=\d+';/);
  assert.match(read("field-scout-read.js"), /^window\.__fsRead = function \(FSX\) \{$/m);
  assert.match(read("field-scout-extras.js"), /^window\.__fsExtras = function \(FSX\) \{$/m);
  // a part that fails to load says so, and the next tap tries again
  assert.match(CORE, /The field read did not load\. Check the connection and tap the field again\./);
  assert.match(CORE, /function\(e\)\{ _rmP=null; throw e; \}/);
});

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/field-scout") p = "/field-scout.html";
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

test("in the browser at 390: the first screen fetches only field-scout.js; a tap fetches the read; a blocked read says so", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const blockRead of [false, true]) {
      const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      const pg = await ctx.newPage();
      const errors = [], asked = [];
      pg.on("pageerror", (e) => errors.push(String(e)));
      await pg.route("**/*", (r) => {
        const u = new URL(r.request().url());
        if (u.hostname !== "127.0.0.1") return r.abort();
        asked.push(u.pathname);
        if (blockRead && u.pathname === "/field-scout-read.js") return r.abort();
        return r.continue();
      });
      await pg.goto(`http://127.0.0.1:${port}/field-scout`);
      await pg.waitForFunction(() => document.querySelector("#fs-map.leaflet-container"), null, { timeout: 20000 });
      await pg.waitForTimeout(1200);
      const fs0 = asked.filter((p) => /^\/field-scout[^/]*\.js$/.test(p));
      assert.deepEqual(fs0, ["/field-scout.js"], "first screen fetched " + fs0.join(", "));
      await pg.tap("#fs-addr");
      await pg.waitForFunction(() => window.__fsRead || null, null, { timeout: blockRead ? 1500 : 10000 }).catch(() => {});
      assert.equal(asked.includes("/field-scout-read.js"), true, "the first touch fetches the read");
      assert.equal(asked.includes("/field-scout-extras.js"), false, "extras wait for their buttons");
      if (blockRead) {
        await pg.click("#fs-demo2").catch(() => pg.click("#fs-demo"));
        await pg.waitForFunction(() => /The field read did not load/.test((document.getElementById("fs-hint") || {}).textContent || ""), null, { timeout: 10000 });
      }
      assert.deepEqual(errors, []);
      await ctx.close();
    }
  } finally { await browser.close(); srv.close(); }
});
