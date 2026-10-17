/* /tariffs China purchase gauge (Oct 17 scorecard, change 3): USDA FAS weekly
 * export sales to China, read by scripts/fetch_export_sales.py from the same
 * week as the totals. The page prints the count only when that row is in
 * data/export-sales.json; otherwise it says when it loads. Banner: one sentence
 * on the first screen, the rest folded.
 *
 * Browser checks need Playwright and Chromium; skipped where they are missing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const html = readFileSync(join(ROOT, "tariffs.html"), "utf8");
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

test("gauge section ships an honest empty state and a USDA FAS source link", () => {
  const sec = html.slice(html.indexOf('id="china-gauge"'), html.indexOf("</section>", html.indexOf('id="china-gauge"')));
  assert.ok(sec.length > 50, "section present");
  assert.match(sec, /loads after the next weekly export sales read/);
  assert.doesNotMatch(sec, /\d+\.\d+ MMT/, "no number typed into the page");
  assert.match(html, /https:\/\/www\.fas\.usda\.gov\/programs\/export-sales-reporting-program/);
  assert.match(html, /fetch\('\/data\/export-sales\.json'\)/);
  const js = html.slice(html.indexOf("/* CHINA GAUGE."), html.lastIndexOf("</script>"));
  assert.ok(js.length > 500, "gauge script present");
  const EM = String.fromCharCode(0x2014);
  assert.ok(!sec.includes(EM) && !js.includes(EM), "no em dash in the gauge");
});

test("the fetch selftest covers China's row and passes", () => {
  const out = execFileSync("python3", [join(ROOT, "scripts/fetch_export_sales.py"), "--selftest"], { encoding: "utf8" });
  assert.match(out, /CHINA BY DESTINATION/);
  assert.match(out, /export sales: all passed/);
});

function serve(over) {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (over[p]) { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(over[p])); return; }
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

async function open(over, width) {
  const srv = await serve(over), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width, height: 900 } });
  const pg = await ctx.newPage();
  const errs = [];
  pg.on("pageerror", (e) => errs.push(e.message));
  await pg.route("**/*", (r) => (r.request().url().startsWith(`http://127.0.0.1:${port}`) ? r.continue() : r.abort()));
  await pg.goto(`http://127.0.0.1:${port}/tariffs.html`, { waitUntil: "load" });
  await pg.waitForTimeout(1200);
  return { pg, errs, done: async () => { await browser.close(); srv.close(); } };
}

const es = JSON.parse(readFileSync(join(ROOT, "data/export-sales.json"), "utf8"));

test("with China's row: 9,969,000 t = 9.97 MMT, 9.969 / 25 = 40%, shipped and outstanding drawn", { skip, timeout: 60000 }, async () => {
  const d = structuredClone(es);
  d.soybeans.withheld = undefined;
  d.soybeans.china = { commitments_mt: 9969000, shipped_mt: 1200500, outstanding_mt: 8768500, week_ending: "2026-10-08", marketing_year: "2026/27" };
  const { pg, errs, done } = await open({ "/data/export-sales.json": d }, 390);
  try {
    const t = await pg.textContent("#cn-body");
    assert.match(t, /9\.97 MMT/);
    assert.match(t, /40% of the 25 MMT a year pledge/);
    assert.match(t, /Shipped 1\.20 MMT/);
    assert.match(t, /not yet shipped 8\.77 MMT/);
    assert.match(t, /week ending Oct 8, 2026/);
    assert.match(await pg.textContent("#cn-week"), /Week ending Oct 8, 2026/);
    const sw = await pg.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(sw <= 0, "no horizontal scroll at 390");
    assert.deepEqual(errs, []);
  } finally { await done(); }
});

test("without China's row the empty state stays; a withheld week says why", { skip, timeout: 60000 }, async () => {
  const d = structuredClone(es); delete d.soybeans.china;
  let r = await open({ "/data/export-sales.json": d }, 1280);
  try { assert.match(await r.pg.textContent("#cn-body"), /loads after the next weekly export sales read/); assert.doesNotMatch(await r.pg.textContent("#cn-body"), /MMT/); }
  finally { await r.done(); }
  const w = structuredClone(es); w.soybeans.withheld = "too old to show as current pace";
  w.soybeans.china = { commitments_mt: 1, shipped_mt: 1, outstanding_mt: 0 };
  r = await open({ "/data/export-sales.json": w }, 1280);
  try { const t = await r.pg.textContent("#cn-body"); assert.match(t, /withheld this week: too old/); assert.doesNotMatch(t, /MMT/); }
  finally { await r.done(); }
});

test("banner shows one sentence, the rest folds under a toggle", { skip, timeout: 60000 }, async () => {
  const { pg, done } = await open({}, 390);
  try {
    const note = (await pg.textContent("#tsb-note")).trim();
    assert.ok(/[.!?]$/.test(note) && note.split(/[.!?]\s+[A-Z]/).length === 1, "one sentence: " + note);
    assert.equal(await pg.locator("details.tsb-more").count(), 1);
    const d = JSON.parse(readFileSync(join(ROOT, "data/tariffs.json"), "utf8"));
    const rest = (await pg.textContent("details.tsb-more p")).trim();
    assert.ok(d.headline.replace(/\s+/g, " ").includes(rest.slice(0, 60)), "nothing lost from the headline");
  } finally { await done(); }
});
