/* /conditions, Oct 16 benchmark fixes.
 *
 *   1. "Since 2000" when the data starts in 2001: every state's record at this
 *      week starts in 2001 (or 2014), and the page's own note said no state has a
 *      2000 rating. The static copy no longer claims 2000, the seeded lede names
 *      the first year the data has, and the meta builder drops the year.
 *   2. The ranking table fits a 390 px phone: state, G+E now, own average and
 *      rank on one line, the bar under it, nothing off screen.
 *
 *   node --test test/conditions-phone.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, extname, normalize } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (f) => readFileSync(ROOT + f, "utf8");
const HTML = read("conditions.html");

test("no claim of a 2000 comparison the data does not have", () => {
  assert.doesNotMatch(HTML, /since 2000/);
  assert.doesNotMatch(HTML, /go back to 2000/);
  assert.doesNotMatch(HTML, /ranked against 2000/);
  assert.doesNotMatch(read("scripts/bake_seo.py"), /same week since 2000/);
  // The shipped data really does start after 2000 at this week.
  const d = JSON.parse(read("data/conditions/conditions.json"));
  let first = 9999;
  for (const c of Object.values(d.crops)) for (const s of Object.values(c.states)) first = Math.min(first, s.hist[0][0]);
  assert.ok(first > 2000, "first year in the data: " + first);
  const lede = HTML.match(/<!--SEED:condlede-->([\s\S]*?)<!--\/SEED-->/)[1];
  assert.match(lede, new RegExp("since " + first));
});

test("builder: the lede names the first year in the data, and 'on record' with no data", () => {
  const dir = mkdtempSync(join(tmpdir(), "cond-fy-"));
  mkdirSync(join(dir, "data/conditions"), { recursive: true });
  copyFileSync(ROOT + "conditions.html", join(dir, "conditions.html"));
  const hist = []; for (let y = 2003; y < 2026; y++) hist.push([y, 60]);
  const st = { ge: 61, rank_from_worst: 2, of: hist.length + 1, pctile: 10, best: 90, worst: 30, avg: 60, hist };
  const rd = "2026-10-18";
  const cp = { report_date: rd, in_season: true, corn: { good_excellent: 61, report_date: rd }, soybeans: { good_excellent: 58, report_date: rd },
    progress: { corn_harvested: { date: rd, pct: 45, avg5: 50 }, soybeans_harvested: { date: rd, pct: 60, avg5: 64 } }, states: {} };
  writeFileSync(join(dir, "data/crop-progress.json"), JSON.stringify(cp));
  writeFileSync(join(dir, "data/conditions/conditions.json"), JSON.stringify({ generated: "2026-10-20T01:00:00Z", crops: { corn: { week_ending: rd, states: { IA: st } } } }));
  const run = () => execFileSync("python3", ["-c",
    "import os,sys; sys.path.insert(0, sys.argv[1]); os.chdir(sys.argv[2]); import seed_static; seed_static.seed_conditions('2026-10-20')",
    ROOT + "scripts", dir], { stdio: "pipe" });
  run();
  const lede = (h) => h.match(/<!--SEED:condlede-->([\s\S]*?)<!--\/SEED-->/)[1];
  assert.match(lede(readFileSync(join(dir, "conditions.html"), "utf8")), /since 2003/);
  writeFileSync(join(dir, "data/conditions/conditions.json"), JSON.stringify({ generated: "2026-10-20T01:00:00Z", crops: {} }));
  run();
  const l2 = lede(readFileSync(join(dir, "conditions.html"), "utf8"));
  assert.doesNotMatch(l2, /since \d{4}/);
  assert.match(l2, /on record/);
});

const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/conditions") p = "/conditions.html";
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

test("at 390 px every ranking row shows rank and bar on screen", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
    const pg = await ctx.newPage();
    const errors = [];
    pg.on("pageerror", (e) => errors.push(String(e)));
    await pg.route("**/*", (r) => (r.request().url().startsWith(`http://127.0.0.1:${port}`) ? r.continue() : r.abort()));
    await pg.goto(`http://127.0.0.1:${port}/conditions`);
    await pg.waitForSelector("#cd-table svg.cd-strip", { timeout: 20000 });
    const rows = await pg.$$eval("#cd-table tr", (trs) => trs.filter((tr) => tr.querySelector("svg")).map((tr) => {
      const c = [...tr.cells].map((td) => { const r = td.getBoundingClientRect(); return { l: r.left, r: r.right, w: r.width, t: td.textContent.trim() }; });
      return c;
    }));
    assert.ok(rows.length >= 10, "states rendered: " + rows.length);
    for (const c of rows) {
      assert.match(c[3].t, /^\d+ of \d+$/, "rank text");
      for (const x of c) assert.ok(x.w > 0 && x.l >= 0 && x.r <= 390, "cell on screen: " + JSON.stringify(x));
    }
    const sw = await pg.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(sw <= 390, "no sideways page scroll: " + sw);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});
