/* SEO hygiene from the Nov 2, 2026 audit (fx/seofix2).
 * 1. Redirect stubs are noindex,follow; their canonical never carries a #fragment. The component fragments are
 *    noindex when opened on their own, and that guard never reaches a page (a robots meta inside a page's body
 *    would drop the whole site from search).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;
const read = (f) => readFileSync(ROOT + f, "utf8");

const STUBS = ["cash-rent.html", "embed.html", "land-tenure.html", "storage-crunch.html", "whats-priced-in.html"];
const FRAGMENTS = ["header.html", "footer.html", "header-fallback.html", "footer-fallback.html"];
const GUARD_MARK = "noindex when this file is opened on its own";

test("redirect stubs: noindex,follow in the head and a canonical without a fragment", () => {
  for (const f of STUBS) {
    const h = read(f);
    const head = h.slice(0, h.indexOf("</head>"));
    assert.match(head, /<meta name="robots" content="noindex,follow">/, f);
    assert.match(head, /http-equiv="refresh"/, `${f} is still a stub`);
    const c = head.match(/<link rel="canonical" href="([^"]+)">/);
    assert.ok(c, `${f}: canonical`);
    assert.ok(!c[1].includes("#"), `${f}: canonical ${c[1]} carries a fragment`);
  }
  assert.match(read("land-tenure.html"), /<link rel="canonical" href="https:\/\/agsist\.com\/farmland-atlas">/);
  assert.match(read("land-tenure.html"), /location\.replace\('\/farmland-atlas'\+location\.search\+'#l=ten_rent'\)/, "readers still land on the tenure layer");
});

test("component fragments: noindex only when opened directly, never a bare robots meta", () => {
  for (const f of FRAGMENTS) {
    const h = read("components/" + f);
    assert.ok(h.includes(GUARD_MARK), f);
    assert.doesNotMatch(h, /<meta[^>]+name=["']robots/i, `${f}: a robots meta here would land in every page's body`);
    assert.match(h, /if\(location\.pathname\.indexOf\('\/components\/'\)<0\)return;/, f);
  }
  // analytics.html: loader.js copies only its <script> tags, so a plain meta never reaches a page
  assert.match(read("components/analytics.html"), /^<meta name="robots" content="noindex">\n/);
  assert.match(read("components/loader.js"), /tmp\.querySelectorAll\('script'\)\.forEach/);
  for (const f of ["page-template.html", "seo-template.html"]) assert.match(read("components/" + f), /noindex/);
  assert.ok(!/^Disallow: \/components\//m.test(read("robots.txt")), "Google must still fetch /components/ to render pages");
});

test("the static nav copy on pages never carries the guard", () => {
  const out = execFileSync("python3", ["scripts/inject_static_nav.py", "--check"], { cwd: ROOT, encoding: "utf8" });
  assert.match(out, /^OK: \d+ pages/);
  const pages = readdirSync(ROOT).filter((f) => f.endsWith(".html"));
  let withNav = 0;
  for (const f of pages) {
    const h = read(f);
    if (h.includes("<!-- static-nav:header -->")) withNav++;
    assert.ok(!h.includes(GUARD_MARK), `${f} carries the fragment guard`);
  }
  assert.ok(withNav > 50, `static nav pages: ${withNav}`);
});

function serve() {
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index.html";
    let f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    if (!existsSync(f) && existsSync(f + ".html")) f += ".html";
    try { const b = readFileSync(f); res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" }); res.end(b); }
    catch (e) { res.writeHead(404); res.end(); }
  });
  return new Promise((r) => srv.listen(0, "127.0.0.1", () => r(srv)));
}

test("in Chromium: a fragment opened alone is noindex; a page with the live header is not", { skip }, async () => {
  const srv = await serve();
  const port = srv.address().port;
  const b = await chromium.launch({ executablePath: CHROME });
  try {
    const pg = await b.newPage();
    await pg.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    const robots = () => pg.evaluate(() => [...document.querySelectorAll('meta[name="robots"]')].map((m) => m.parentNode.tagName + ":" + m.content));
    for (const f of [...FRAGMENTS, "analytics.html"]) {
      await pg.goto(`http://127.0.0.1:${port}/components/${f}`, { waitUntil: "load" });
      assert.deepEqual(await robots(), ["HEAD:noindex"], f);
    }
    for (const p of ["/basis.html", "/about.html"]) {
      await pg.goto(`http://127.0.0.1:${port}${p}`, { waitUntil: "load" });
      await pg.waitForSelector("#topnav", { timeout: 10000 });
      await pg.waitForFunction(() => !document.getElementById("site-footer"), null, { timeout: 10000 });
      const r = await robots();
      assert.ok(r.every((x) => x.startsWith("HEAD:") && !/noindex/.test(x)), `${p}: ${JSON.stringify(r)}`);
    }
  } finally { await b.close(); srv.close(); }
});

// 2. /hail-map: one h1 in the page source; the printed report keeps its own heading.
test("hail map: one h1, and the print window still opens with an h1", () => {
  const h = read("hail-map.html");
  assert.equal((h.match(/<h1\b/gi) || []).length, 1);
  assert.match(h, /<h1 class="hm-title">National Hail Map:/);
  const lit = h.match(/'<div class="hd"><div><h\\x31>Hail History Report<\/h\\x31>'/);
  assert.ok(lit, "print heading literal");
  assert.equal(eval(lit[0]), '<div class="hd"><div><h1>Hail History Report</h1>');
  for (const f of readdirSync(ROOT + "hail-map").filter((x) => x.endsWith(".html"))) {
    assert.equal((read("hail-map/" + f).match(/<h1\b/gi) || []).length, 1, f);
  }
});
