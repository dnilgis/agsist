/* /sponsor-apply next to the site-wide email ask (2026-10-20).
 * components/signup-ask.js loads on every page and injects rules for its own
 * short class names (.sa-f is a grid, .sa-l, .sa-b, .sa-in ...). The sponsor
 * form used the same "sa-" prefix (form class="sa-f"), so from Oct 19 the
 * application rendered as a 2-3 column grid: headings one letter per line,
 * the terms one character wide on phones, and a 48 px "Start my free month"
 * button on desktop. The page now uses "spa-". This loads the real page with
 * the real loader and signup-ask.js and checks the form lays out as a form:
 *   - the form is not a grid;
 *   - the submit button is at least 200 px wide at 1280, and nearly the
 *     form's width at 390 (at least 90% of it);
 *   - the terms text is wider than 200 px;
 *   - no class or id in the page or its script starts with "sa-" except the
 *     sponsor ad's own markup.
 * Needs Playwright and Chromium; skipped where they are missing.
 *   node --test test/sponsor-apply-layout.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const ROOT = process.env.SPA_ROOT || fileURLToPath(new URL("../", import.meta.url));
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
const SHOTS = process.env.SPA_SHOTS || "";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;
const read = (p) => readFileSync(ROOT + p, "utf8");

test("the sponsor form's own classes and ids do not use signup-ask's sa- prefix", () => {
  const html = read("sponsor-apply.html"), js = read("components/sponsor-apply.js");
  const toks = (s) => [...s.matchAll(/(?:class|id|for|data-for|aria-describedby)="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/))
    .concat([...s.matchAll(/\$\('([^']+)'\)|getElementById\('([^']+)'\)/g)].map((m) => m[1] || m[2]))
    .concat([...s.matchAll(/(?<![\w-])\.(sa-[\w-]+)/g)].map((m) => m[1]));
  const bad = [...new Set(toks(html).concat(toks(js)).filter((t) => /^sa-/.test(t)))];
  assert.deepEqual(bad, [], "sa- names on /sponsor-apply: " + bad.join(" "));
});

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".woff2": "font/woff2", ".html": "text/html", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };
  const srv = createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    let p = normalize(join(ROOT, decodeURIComponent(u.pathname)));
    if (!extname(p) && existsSync(p + ".html")) p += ".html";
    if (!p.startsWith(ROOT) || !existsSync(p)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(p)] || "application/octet-stream" });
    res.end(readFileSync(p));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

for (const width of [390, 1280]) {
  test(`at ${width} px with signup-ask.js on the page, the form is a form`, { skip }, async () => {
    const srv = await serve(), port = srv.address().port;
    const browser = await chromium.launch({ executablePath: CHROME });
    try {
      const ctx = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: "block" });
      await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 503, headers: { "Access-Control-Allow-Origin": "*" }, body: "" }));
      const page = await ctx.newPage();
      await page.goto(`http://127.0.0.1:${port}/sponsor-apply.html`, { waitUntil: "load" });
      await page.waitForFunction(() => !!window.AgsistSignup && !!document.getElementById("sa-css"), null, { timeout: 15000 });
      const m = await page.evaluate(() => {
        const form = document.querySelector("main form");
        const btn = form.querySelector("button[type=submit]");
        const terms = form.querySelector('input[type=checkbox][required]').closest("label").querySelector("span");
        const step = form.querySelector("div");
        return {
          display: getComputedStyle(form).display,
          formW: form.getBoundingClientRect().width,
          btnW: btn.getBoundingClientRect().width,
          termsW: terms.getBoundingClientRect().width,
          stepH: step.getBoundingClientRect().height,
        };
      });
      if (SHOTS) {
        mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({ path: join(SHOTS, `sponsor-apply-${width}.png`), fullPage: true });
      }
      assert.notEqual(m.display, "grid", "the form is a grid: " + JSON.stringify(m));
      assert.ok(m.termsW > 200, "terms text " + m.termsW + " px wide");
      assert.ok(m.stepH < 60, "step heading " + m.stepH + " px tall (one letter per line?)");
      if (width >= 900) assert.ok(m.btnW >= 200, "submit button " + m.btnW + " px wide");
      else assert.ok(m.btnW >= 200 && m.btnW >= m.formW * 0.9, "submit button " + m.btnW + " px of a " + m.formW + " px form");
    } finally { await browser.close(); srv.close(); }
  });
}
