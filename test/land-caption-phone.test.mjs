/* Land sale table captions on a phone (Nov 10, 2026: on a county page at 390 px the caption "Newest first, Barron County,
 * Wisconsin" stood one or two letters per line). Below 560 px every .ls-st table is display:block (one block per row);
 * a <caption> left as a table caption then sits in an anonymous shrink-to-fit table box and wraps to its narrowest word.
 * Built from the synthetic fixture site (test/fixtures/land-fl/make_site.py) into a temp folder, never the committed pages.
 *
 *   - every built land sale page carries the stacked-table style exactly once;
 *   - in Chromium at 390 px and at 1280 px, every visible .ls-st caption is at least 90% of its table's width.
 *
 *   node --test test/land-caption-phone.test.mjs      (the browser test needs PLAYWRIGHT_PATH and CHROMIUM_PATH, else it skips)
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PLACES_ROUTE } from "./fixtures/places-mock.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (fs.existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !fs.existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

let DIR = null;
function site() {
  if (DIR) return DIR;
  DIR = fs.mkdtempSync(path.join(os.tmpdir(), "lscap-"));
  const r = spawnSync("python3", [path.join(ROOT, "test/fixtures/land-fl/make_site.py"), DIR], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return DIR;
}
after(() => { if (DIR) fs.rmSync(DIR, { recursive: true, force: true }); });

function pages() {
  const out = [];
  const walk = (d) => {
    for (const n of fs.readdirSync(d)) {
      const f = path.join(d, n);
      if (fs.statSync(f).isDirectory()) walk(f);
      else if (n.endsWith(".html")) out.push(path.relative(site(), f).split(path.sep).join("/"));
    }
  };
  walk(path.join(site(), "land-sales"));
  return out.sort();
}

test("every land sale page carries the stacked-table style once", () => {
  const ps = pages();
  assert.ok(ps.some((p) => /^land-sales\/[a-z-]+\/[a-z0-9-]+-county\.html$/.test(p)), "a county page is built");
  assert.ok(ps.includes("land-sales/index.html"), "the hub is built");
  assert.ok(ps.some((p) => /^land-sales\/\d{4}-\d{2}\.html$/.test(p)), "a month page is built");
  for (const p of ps) {
    const h = fs.readFileSync(path.join(site(), p), "utf8");
    if (!h.includes("ls-st")) continue;
    assert.equal(h.split(".ls-st,.ls-st tbody{display:block}").length - 1, 1, `${p}: stacked-table style once`);
    assert.equal(h.split(".ls-st caption{display:block").length - 1, 1, `${p}: the caption rule once`);
  }
});

test("in Chromium at 390 and 1280 px: every .ls-st caption spans its table", { skip }, async () => {
  const tmp = site();
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index.html";
    if (!path.extname(p)) p += ".html";
    for (const dir of [tmp, ROOT]) {
      const f = path.normalize(path.join(dir, p));
      if (f.startsWith(dir) && fs.existsSync(f) && fs.statSync(f).isFile()) {
        res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" });
        res.end(fs.readFileSync(f));
        return;
      }
    }
    res.writeHead(404); res.end();
  });
  await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch({ executablePath: CHROME });
  let county = 0;
  try {
    for (const width of [390, 1280]) {
      const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width, height: 844 } });
      await ctx.route(PLACES_ROUTE, (q) => q.abort());
      await ctx.route("**/*", (q) => (q.request().url().startsWith(base) ? q.continue() : q.abort()));
      const pg = await ctx.newPage();
      for (const p of pages()) {
        if (!fs.readFileSync(path.join(tmp, p), "utf8").includes("<caption")) continue;
        await pg.goto(`${base}/${p}`, { waitUntil: "load" });
        // open every fold, so captions inside closed details are measured too
        const caps = await pg.evaluate(() => {
          document.querySelectorAll("details").forEach((d) => { d.open = true; });
          return [...document.querySelectorAll("table.ls-st > caption")].map((c) => {
            const t = c.closest("table").getBoundingClientRect().width;
            return { text: c.textContent.trim(), cap: c.getBoundingClientRect().width, table: t };
          });
        });
        for (const c of caps) {
          assert.ok(c.table > 0, `${p} at ${width}: "${c.text}" table is drawn`);
          assert.ok(c.cap >= 0.9 * c.table, `${p} at ${width}: caption "${c.text}" is ${c.cap.toFixed(0)} px in a ${c.table.toFixed(0)} px table`);
          if (/-county\.html$/.test(p) && /^Newest first/.test(c.text)) county++;
        }
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
    srv.close();
  }
  assert.ok(county >= 2, `the county page's "Newest first" caption was measured at both widths (${county})`);
});
