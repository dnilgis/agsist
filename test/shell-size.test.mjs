/* The page shell stays small (shell diet, Oct 27, 2026; Sig said yes Oct 26).
 *
 * Every page loads the same shell: components/loader.js, which brings header.html,
 * footer.html, states.css, states.js and sponsor-metrics.js, plus components/styles.css.
 * Gzipped at level 9 it was 78,037 bytes at first load on Oct 27 (main 4cf7a06), plus
 * 22,756 for signup-ask.js, which loader.js also pulled in at once: 100,793 in all.
 * Taking the comments out of the shipped files (the CV history moved to
 * scripts/dev/loader-cv-history.md) brought the first-load shell to 49,330 bytes, and
 * signup-ask.js now waits for the first scroll, tap or key or for an idle page, except where
 * the page shows its own ask.
 *
 * This fails when the shell grows past those numbers plus 5%. Raising a limit is a
 * decision: change it here in the same commit and say why.
 *
 *   node --test test/shell-size.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");
const gz = (p) => gzipSync(readFileSync(ROOT + p), { level: 9 }).length;

const FIRST = ["components/loader.js", "components/header.html", "components/footer.html", "components/styles.css",
  "components/states.css", "components/states.js", "components/sponsor-metrics.js"];
const LATER = ["components/signup-ask.js"];
const FIRST_MEASURED = 49330, ALL_MEASURED = 72086;
const FIRST_LIMIT = Math.ceil(FIRST_MEASURED * 1.05), ALL_LIMIT = Math.ceil(ALL_MEASURED * 1.05);

test("the first-load shell stays under 49,330 gzipped bytes plus 5%", () => {
  const rows = FIRST.map((f) => [f, gz(f)]);
  const total = rows.reduce((a, r) => a + r[1], 0);
  assert.ok(total <= FIRST_LIMIT, `first-load shell is ${total} bytes gzipped, over ${FIRST_LIMIT}: ` + rows.map((r) => r.join(" ")).join(", "));
});

test("the shell with signup-ask.js stays under 72,086 gzipped bytes plus 5%", () => {
  const total = [...FIRST, ...LATER].reduce((a, f) => a + gz(f), 0);
  assert.ok(total <= ALL_LIMIT, `shell with signup-ask.js is ${total} bytes gzipped, over ${ALL_LIMIT}`);
});

test("loader.js keeps its version line short; the history lives in scripts/dev", () => {
  const L = read("components/loader.js");
  assert.match(L, /^ {2}var CV = '\d+';$/m);
  assert.ok(existsSync(ROOT + "scripts/dev/loader-cv-history.md"));
  const cv = /var CV = '(\d+)'/.exec(L)[1];
  assert.match(read("scripts/dev/loader-cv-history.md"), new RegExp("^- v" + cv + " 20\\d\\d-\\d\\d-\\d\\d:", "m"), "the current CV has a line in the history");
});

test("every shipped shell file is free of long comment blocks", () => {
  for (const f of FIRST) {
    const t = read(f);
    const blocks = [...t.matchAll(/\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->/g)].filter((m) => m[0].length > 200);
    assert.deepEqual(blocks.map((m) => m[0].slice(0, 60)), [], f + " carries long comments again");
  }
});

/* ── in the browser: signup-ask.js off the first paint, still there when it is needed ── */
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/") p = "/index.html";
    if (!extname(p)) p += ".html";
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

async function open(browser, port, path, { noIdle }) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 900 } });
  const pg = await ctx.newPage();
  await pg.route("**/*", (r) => (r.request().url().startsWith(`http://127.0.0.1:${port}`) ? r.continue() : r.abort()));
  if (noIdle) await pg.addInitScript(() => { window.requestIdleCallback = () => 0; });
  const asked = [];
  pg.on("request", (r) => { if (r.url().includes("/components/signup-ask.js")) asked.push(Date.now()); });
  await pg.goto(`http://127.0.0.1:${port}${path}`, { waitUntil: "load" });
  return { ctx, pg, asked };
}

test("browser: signup-ask.js waits for the reader on a page without its own ask, and loads at once where the page asks", { skip, timeout: 90000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    // /about has no ask of its own: nothing until a key, then the asks work
    let { ctx, pg, asked } = await open(browser, port, "/about", { noIdle: true });
    await pg.waitForSelector("#topnav");
    await pg.waitForTimeout(1500);
    assert.equal(asked.length, 0, "signup-ask.js loaded before the reader did anything");
    await pg.keyboard.press("Shift");
    await pg.waitForFunction(() => window.AgsistSignup && typeof window.AgsistSignup.subscribe === "function", null, { timeout: 15000 });
    await pg.waitForFunction(() => document.querySelector('#topnav [data-signup-ask][data-sa-ready]'), null, { timeout: 15000 });
    await ctx.close();

    // the same page with no input at all: the idle load brings it
    ({ ctx, pg, asked } = await open(browser, port, "/about", { noIdle: false }));
    await pg.waitForFunction(() => !!window.AgsistSignup, null, { timeout: 15000 });
    await ctx.close();

    // a county rain page shows its own monthly ask: loaded with the page, as before
    ({ ctx, pg, asked } = await open(browser, port, "/rain/iowa/story-county", { noIdle: true }));
    await pg.waitForFunction(() => !!window.AgsistSignup, null, { timeout: 15000 });
    assert.ok(asked.length >= 1);
    assert.ok(await pg.evaluate(() => !!document.querySelector('main [data-signup-ask][data-sa-ready]')), "the monthly rain ask is drawn");
    await ctx.close();
  } finally {
    await browser.close();
    srv.close();
  }
});
