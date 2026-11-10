/* Atlas county pages (Nov 4, 2026, site panel): the date the figures last changed, chart text a phone can
 * read, and a hub map whose low colors stand off the map.
 *
 * The real cases:
 *  - every county page said "Figures as of 2026-10-19" and every sitemap-atlas.xml lastmod was Oct 19
 *    (scripts/build_atlas_pages.py stamped the summary file's own date even when a figure changed later);
 *  - the charts were drawn 640 units wide with 10-unit text, so Story County, Iowa printed 6 px labels at
 *    390 (viz seat; 58 of 58 labels);
 *  - the hub map's lowest gold step (#403a27) was 1.64:1 on the #101415 map.
 * The page is built from the builder into a temp folder (never the committed set). Browser runs block every
 * outside host and service workers (build rule 58).
 *
 *   node --test test/atlas-chart-text.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync, mkdtempSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;
const SHOTS = process.env.WAVE1B_SHOTS || "";
const py = (code, ...args) => execFileSync("python3", ["-c", "import sys;sys.path.insert(0,'scripts');import build_atlas_pages as B;" + code, ...args], { cwd: ROOT, encoding: "utf8" }).trim();

test("the Figures as of day: kept while the figures hold, the build day when one changes, never the summary file's day after", () => {
  const r = JSON.parse(py("import json;print(json.dumps([B.page_day(['a','2026-10-19'],'a','2026-11-04','2026-10-19'),"
    + "B.page_day(['a','2026-10-19'],'b','2026-11-04','2026-10-19'),B.page_day(None,'b','2026-11-04','2026-10-19'),"
    + "B.page_day(['a','2026-10-25'],'b','2026-10-01','2026-10-19'),B.human_day('2026-10-19'),B.build_day('2031-05-06')]))"));
  assert.deepEqual(r, ["2026-10-19", "2026-11-04", "2026-10-19", "2026-10-19", "Oct 19, 2026", "2031-05-06"]);
  const src = readFileSync(join(ROOT, "scripts/build_atlas_pages.py"), "utf8");
  assert.match(src, /date = page_day\(prev\.get\(f\), h, day, W\.built\)/);
  assert.match(src, /by_url = \{W\.url\(f\): stamps\[f\]\[1\] for f in stamps\}/, "the sitemap lastmod is the page's own day");
  assert.match(src, /Figures as of \{esc\(stamp_h\)\}/);
});

/* WCAG relative luminance */
function lum(h) {
  const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
test("every class of every hub map ramp is 3:1 or more on the #101415 map, and lightness still climbs", () => {
  const h = readFileSync(join(ROOT, "farmland-atlas.html"), "utf8");
  const m = /var RAMPS=\{([\s\S]*?)\};/.exec(h);
  assert.ok(m);
  const ramps = [...m[1].matchAll(/(\w+):\[([^\]]+)\]/g)].map((x) => [x[1], x[2].match(/#[0-9a-f]{6}/gi)]);
  assert.equal(ramps.length, 5);
  const bg = lum("#101415");
  for (const [k, cs] of ramps) {
    assert.equal(cs.length, 7, k);
    const cr = cs.map((c) => (lum(c) + 0.05) / (bg + 0.05));
    assert.ok(cr.every((x) => x >= 3), k + " " + cr.map((x) => x.toFixed(2)).join(" "));
    for (let i = 1; i < cr.length; i++) assert.ok(cr[i] > cr[i - 1], k + " climbs");
  }
});

function serve(extra) {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/") p = "/index.html";
    else if (!extname(p)) p += ".html";
    let f = normalize(join(extra, p));
    if (!existsSync(f) || statSync(f).isDirectory()) f = normalize(join(ROOT, p));
    if (!existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

test("Story County, Iowa at 390: every chart label renders at 10 px or more, inside its chart; the date reads like a date", { skip }, async () => {
  const out = mkdtempSync(join(process.env.TMPDIR || tmpdir(), "atlas-"));
  execFileSync("python3", ["scripts/build_atlas_pages.py", "--only", "19169", "--out", out], { cwd: ROOT, stdio: "pipe" });
  const html = readFileSync(join(out, "farmland-atlas/iowa/story-county.html"), "utf8");
  assert.match(html, /Figures as of [A-Z][a-z]{2} \d{1,2}, \d{4}/);
  assert.doesNotMatch(html, /Figures as of \d{4}-/);
  const srv = await serve(out);
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const width of [390, 1280]) {
      const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width, height: 900 } });
      await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
      const pg = await ctx.newPage();
      await pg.goto(`http://127.0.0.1:${srv.address().port}/farmland-atlas/iowa/story-county`, { waitUntil: "load" });
      const charts = await pg.$$eval("svg.ch", (svgs) => svgs.map((s) => {
        const vb = s.viewBox.baseVal, box = s.getBoundingClientRect(), k = box.width / vb.width;
        return [...s.querySelectorAll("text")].map((t) => {
          const r = t.getBoundingClientRect();
          return { px: parseFloat(getComputedStyle(t).fontSize) * k, t: t.textContent, in: r.left >= box.left - 0.5 && r.right <= box.right + 0.5 };
        });
      }));
      assert.ok(charts.length >= 4, "charts drawn: " + charts.length);
      const all = charts.flat();
      assert.ok(all.length >= 20);
      const small = all.filter((x) => x.px < 10);
      assert.deepEqual(small, [], `${width}: text under 10 px`);
      assert.deepEqual(all.filter((x) => !x.in).map((x) => x.t), [], `${width}: labels cut at the chart's edge`);
      if (width === 390) assert.ok(Math.min(...all.map((x) => x.px)) < 13, "phone text stays chart-sized");
      if (width === 390 && SHOTS) { const c = await pg.$$("svg.ch"); await c[c.length - 1].scrollIntoViewIfNeeded(); await pg.screenshot({ path: join(SHOTS, "atlas-charts-390.png") }); }
      await ctx.close();
    }
  } finally { await browser.close(); srv.close(); rmSync(out, { recursive: true, force: true }); }
});
