/* The PRF grid index email (2026-10-17, Sig approved): "Email me when grid
 * N's index posts" on /prf and the PRF county pages, topic prf:<grid> (subs
 * worker v5.29), mailed by scripts/send_prf_notice.py from prf.yml.
 * PRF rule: plain index information, no lead capture beyond the address, no
 * agent, no sales words. The browser parts need Playwright and Chromium and
 * skip where they are missing. Screenshots go to PRF_NOTICE_SHOTS when set.
 *
 *   node --test test/prf-notice.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createServer } from "node:http";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const DASH = /[–—]|&mdash;|&ndash;/;
const SALES = /\b(buy|quote|premium|coverage|best|talk to|call an?|agents? near|enroll|sign up today)\b/i;

const SRC = read("components/prf-notice.js");
const sandbox = {};
vm.runInNewContext(SRC, sandbox);
const N = sandbox.AgPrfNotice;

test("the component: no dashes, no sales words, the topic the sender reads", () => {
  assert.ok(N && N.newestFinal && N.gridOk && N.askHtml);
  assert.doesNotMatch(SRC, /—|–/, "no em or en dashes");
  const h = N.askHtml("30452", "2026-06");
  assert.match(h, /^<div data-signup-ask="Email me when grid 30452’s index posts" data-topic="prf:30452" data-after="2026-06" data-source="[^"]+" data-ok="[^"]+" data-note="[^"]+"><\/div>$/);
  assert.doesNotMatch(h, SALES, "plain index information only");
  assert.doesNotMatch(h, /data-daily/, "the Daily box starts empty (Sig, 2026-10-19)");
  assert.ok(h.includes("Your address goes to no agent."), "says where the address goes");
  assert.doesNotMatch(N.askHtml("30452", ""), /data-after/, "no after when meta.json did not load");
  assert.ok(read("scripts/send_prf_notice.py").includes('TOPIC_RE = re.compile(r"prf:([1-9]\\d{3,4})")'), "the sender reads the same topic");
});

test("newestFinal: the newest interval RMA has published, from meta.json", () => {
  const meta = JSON.parse(read("data/prf/meta.json"));
  const want = (() => {        // worked by hand from the file: the last year with a count, its last nonzero slot
    const o = meta.years.open || {}, ys = Object.keys(o).filter((y) => o[y].some((c) => c > 0)).sort();
    if (!ys.length) return meta.years.last_complete + "-11";
    const y = ys[ys.length - 1], i = o[y].map((c) => c > 0).lastIndexOf(true);
    return y + "-" + String(i + 1).padStart(2, "0");
  })();
  assert.equal(N.newestFinal(meta), want);
  assert.equal(N.newestFinal({ years: { last_complete: 2025, open: { 2026: [5, 5, 5, 5, 5, 5, 0, 0, 0, 0, 0] } } }), "2026-06");
  assert.equal(N.newestFinal({ years: { last_complete: 2025, open: { 2026: [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 0] } } }), "2026-10");
  assert.equal(N.newestFinal({ years: { last_complete: 2025, open: {} } }), "2025-11", "a crop year with nothing open yet");
  assert.equal(N.newestFinal(null), "");
});

test("every real grid passes the id check the worker uses; neighbours outside do not", () => {
  const grids = new Set();
  for (const f of fs.readdirSync(path.join(ROOT, "data/prf/s"))) {
    for (const c of Object.values(JSON.parse(read("data/prf/s/" + f)).counties)) c.g.forEach((g) => grids.add(g));
  }
  assert.ok(grids.size > 13000, "grids: " + grids.size);
  for (const g of grids) assert.ok(N.gridOk(g), "grid " + g);
  for (const g of ["6195", "34942", "030452", "6020", "30300", "H0420", "", "30452.5"]) assert.ok(!N.gridOk(g), "refused " + g);
  const w = read("workers/subs-worker.js");
  assert.ok(w.includes("const PRF_MIN = 6196, PRF_MAX = 34941;") && w.includes("row >= 20 && row <= 116 && col >= 21 && col <= 251"), "the worker's range is the same");
  assert.ok(w.includes(" * v5.29 (2026-10-17): PRF GRID INDEX NOTICE."), "the worker header names the change");
});

test("/prf: one ask holder in the grid card, the component loaded, the byline says what the box sends", () => {
  const h = read("prf.html");
  assert.equal((h.match(/data-prf-notice/g) || []).length, 1);
  const card = h.slice(h.indexOf('aria-labelledby="prf-where-h"'), h.indexOf('id="prf-setup"'));
  assert.ok(card.includes('<div class="prf-notice" data-prf-notice hidden></div>'), "inside the Your grid card");
  assert.match(h, /<script src="\/components\/prf-notice\.js\?v=\d+" defer><\/script>/);
  assert.ok(!h.includes("asks for no contact details"), "the old byline claim is gone now that there is a box");
  assert.ok(h.includes("This page sells nothing and refers no one; a labeled sponsor box may be an insurance agency, which has no say over any figure. Its one email box sends your grid&rsquo;s final index when USDA posts it."));
  assert.ok(read("scripts/make_prf_html.py").includes("data-prf-notice"), "from the generator, not a hand edit");
});

test("every PRF county page: one ask holder, on the grid its interval card opens on", () => {
  let n = 0;
  for (const st of fs.readdirSync(path.join(ROOT, "prf"))) {
    const dir = path.join(ROOT, "prf", st);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".html")) continue;
      const h = fs.readFileSync(path.join(dir, f), "utf8");
      const now = /data-grids="([\d,]+)" data-grid="(\d+)"/.exec(h);
      const ask = [...h.matchAll(/<div class="prf-notice" data-prf-notice data-grid="(\d+)" hidden><\/div><script src="\/components\/prf-notice\.js\?v=\d+" defer><\/script>/g)];
      assert.equal(ask.length, 1, f);
      assert.equal(ask[0][1], now[2], st + "/" + f + ": the same grid as the card");
      assert.ok(now[1].split(",").includes(ask[0][1]), f);
      assert.ok(h.indexOf("</section>", h.indexOf('id="prf-now"')) < h.indexOf("data-prf-notice"), f + ": under the interval card, outside it");
      assert.ok(!h.includes("asks for no contact details"), f + ": byline updated");
      n++;
    }
  }
  assert.ok(n > 3000, "county pages: " + n);
});

test("the sender rides prf.yml after the checked commit, with no new schedule", () => {
  const y = read(".github/workflows/prf.yml");
  assert.deepEqual([...y.matchAll(/- cron: "([^"]+)"/g)].map((m) => m[1]), ["23 10 * * 3"]);
  assert.ok(y.includes("python scripts/send_prf_notice.py --selftest"), "offline selftest in the gate");
  const at = y.indexOf("python3 scripts/send_prf_notice.py --send");
  assert.ok(at > y.indexOf("- name: Commit") && at > y.indexOf("node scripts/check_prf_rma.mjs"), "after RMA's check and the commit");
  assert.match(y.slice(y.lastIndexOf("- name:", at), at), /if: github\.event\.inputs\.limit == ''/, "not on a trial run");
  const s = read("scripts/send_prf_notice.py");
  assert.ok(!/print\([^)]*\be\b[,)]/.test(s), "never prints an address");
  assert.doesNotMatch(s, /—|–/);
});

test("the sender's own selftest passes (fake HTTP, fake SMTP, example.com)", () => {
  const r = spawnSync("python3", [path.join(ROOT, "scripts/send_prf_notice.py"), "--selftest"], { encoding: "utf8", env: { ...process.env, LIST_URL: "", SMTP_HOST: "" } });
  assert.equal(r.status, 0, r.stdout.slice(-1500) + r.stderr.slice(-800));
  assert.match(r.stdout, /OK: 0 failure\(s\)/);
});

// ---------------------------------------------------------------- in a browser
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (fs.existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !fs.existsSync(CHROME) ? "Playwright or Chromium not found here" : false;
const SHOTS = process.env.PRF_NOTICE_SHOTS || "";

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (!path.extname(p)) p += ".html";
    const f = path.normalize(path.join(ROOT, p));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" });
    res.end(fs.readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}
async function open(browser, port, url, posts, width) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width, height: 900 } });
  const pg = await ctx.newPage();
  await pg.route("**/*", (r) => {
    const u = r.request().url();
    if (u.startsWith(`http://127.0.0.1:${port}`)) return r.continue();
    if (u.startsWith("https://agsist-subs.dnilgis.workers.dev/")) {
      posts.push({ path: new URL(u).pathname, body: JSON.parse(r.request().postData() || "{}") });
      return r.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ ok: true }) });
    }
    return r.abort();
  });
  await pg.goto(`http://127.0.0.1:${port}${url}`, { waitUntil: "load" });
  return pg;
}
const AFTER = N.newestFinal(JSON.parse(read("data/prf/meta.json")));

test("county page: the ask follows the card's grid and posts prf:<grid> with after; the briefing box starts empty (Sig, 2026-10-19)", { skip, timeout: 90000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const width of [390, 1280]) {
      const posts = [];
      const pg = await open(browser, port, "/prf/wisconsin/barron-county", posts, width);
      const ask = pg.locator('[data-sa-topic="prf:30452"]');
      await ask.waitFor();
      assert.equal(await ask.locator(".sa-l").textContent(), "Email me when grid 30452’s index posts");
      assert.equal(await ask.locator(".sa-d input").isChecked(), false, "briefing box starts empty");
      const wide = await pg.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      assert.equal(wide, false, width + ": no sideways scroll");
      const sel = pg.locator("#prf-now-grid");
      if (await sel.count()) {
        await sel.selectOption("30753");
        await pg.locator('[data-sa-topic="prf:30753"]').waitFor();
      }
      const a2 = pg.locator('[data-sa-topic="prf:30753"]');
      if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await a2.scrollIntoViewIfNeeded(); await pg.screenshot({ path: path.join(SHOTS, `county-${width}.png`) }); }
      await a2.locator(".sa-in").fill("reader@example.com");
      await a2.locator(".sa-b").click();
      await a2.locator(".sa-ok").waitFor();
      const n = posts.filter((x) => x.path === "/notice");
      assert.equal(n.length, 1);
      assert.equal(n[0].body.topic, "prf:30753");
      assert.equal(n[0].body.after, AFTER);
      assert.equal(n[0].body.source, "page:prf/wisconsin/barron-county");
      assert.equal(n[0].body.daily, false, "no Daily unless the reader ticks it");
      if (SHOTS) await pg.screenshot({ path: path.join(SHOTS, `county-${width}-done.png`) });
      await pg.context().close();
    }
  } finally { await browser.close(); srv.close(); }
});

test("/prf: the ask appears for the grid the reader opened", { skip, timeout: 90000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const width of [390, 1280]) {
      const posts = [];
      const pg = await open(browser, port, "/prf?g=30452&c=55005", posts, width);
      const ask = pg.locator('[data-sa-topic="prf:30452"]');
      await ask.waitFor({ timeout: 30000 });
      assert.equal(await ask.locator(".sa-l").textContent(), "Email me when grid 30452’s index posts");
      const wide = await pg.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      assert.equal(wide, false, width + ": no sideways scroll");
      if (SHOTS) { await ask.scrollIntoViewIfNeeded(); await pg.screenshot({ path: path.join(SHOTS, `prf-${width}.png`) }); }
      await ask.locator(".sa-in").fill("reader@example.com");
      await ask.locator(".sa-b").click();
      await ask.locator(".sa-ok").waitFor();
      const n = posts.filter((x) => x.path === "/notice");
      assert.equal(n.length, 1);
      assert.deepEqual({ topic: n[0].body.topic, after: n[0].body.after, source: n[0].body.source }, { topic: "prf:30452", after: AFTER, source: "page:prf" });
      await pg.context().close();
    }
  } finally { await browser.close(); srv.close(); }
});
