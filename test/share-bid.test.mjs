/* Share today's bids on the cash-bid town pages (Nov 3, 2026):
 * components/share-bid.js and the button scripts/build_cash_bid_pages.py writes.
 *
 * The page under test is built from the frozen Nevada, IA fixture
 * (test/fixtures/sharebid/nevada-ia.json) by the builder itself, and every
 * expectation is read from that page or that fixture; the browser clock is set
 * from the fixture, never from today (standing rule, Nov 3).
 *   - the share sheet gets the answer line's own row, with its posted day, and
 *     the town link tagged utm_source=share once (in url, not in the text); one share_bid event per step
 *   - once the bid's data-until has passed, the share carries no price
 *   - with no share sheet: Copy puts the text and the tagged link on the
 *     clipboard, and a phone gets an sms: link with the same body
 *   - the button is in the HTML: it does not move at 390 and 1280 while the page loads
 *
 * Needs Playwright and Chromium; skipped where they are missing.
 *   node --test test/share-bid.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync, mkdtempSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const FIX = join(ROOT, "test/fixtures/sharebid/nevada-ia.json");
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

const fx = JSON.parse(readFileSync(FIX, "utf8"));
const NOW = Date.parse(fx.now);

/* The fixture's town page, written by the builder into a temp folder. */
function buildPage() {
  const out = mkdtempSync(join(tmpdir(), "sharebid-"));
  const py = "import sys; sys.path.insert(0, sys.argv[1]); import build_cash_bid_pages as B; " +
    "B.BUY.load = lambda root='.': []; B.build_fixture_town(sys.argv[2], sys.argv[3] + '/cash-bids', root=sys.argv[3])";
  const r = spawnSync("python3", ["-c", py, join(ROOT, "scripts"), FIX, out], { cwd: ROOT, encoding: "utf8" });
  assert.equal(r.status, 0, `fixture build failed: ${(r.stderr || "").slice(-600)}`);
  return out;
}
const OUT = buildPage();
const PAGE = readFileSync(join(OUT, "cash-bids/iowa/nevada.html"), "utf8");
process.on("exit", () => { try { rmSync(OUT, { recursive: true, force: true }); } catch (e) {} });

const unesc = (s) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const attr = (name) => { const m = new RegExp(`data-share-bid[^>]*\\s${name}="([^"]*)"`).exec(PAGE); return m ? unesc(m[1]) : null; };

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (!extname(p)) p = p.endsWith("/") ? p + "index.html" : p + ".html";
    const base = p.startsWith("/cash-bids/") ? OUT : ROOT;
    const f = normalize(join(base, p));
    if (!f.startsWith(base) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

/* A page at width w, every off-site request refused, the clock at `now`, GA
   events recorded, and (o.share) a share sheet that records what it was given. */
async function open(browser, port, w, h, now, o = {}) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: w, height: h }, isMobile: w < 600,
    hasTouch: w < 600, timezoneId: "America/Chicago" });
  if (o.clip) await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: `http://127.0.0.1:${port}` });
  const pg = await ctx.newPage();
  await pg.clock.setFixedTime(new Date(now));
  await pg.route("**/*", (r) => r.request().url().startsWith(`http://127.0.0.1:${port}`) ? r.continue() : r.abort());
  await pg.addInitScript((share) => {
    window.__ga = []; window.__shared = null; window.__shifts = [];
    const rec = (n, p) => window.__ga.push([n, p]);
    Object.defineProperty(window, "gaEvent", { get: () => rec, set: () => {}, configurable: false });
    Object.defineProperty(Navigator.prototype, "share", { configurable: true,
      value: share ? function (d) { window.__shared = d; return Promise.resolve(); } : undefined });
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) if (!e.hadRecentInput) window.__shifts.push({ v: e.value,
        what: (e.sources || []).map((s) => (s.node ? s.node.nodeName + "." + (s.node.className || "") + " " +
          String(s.node.textContent || "").slice(0, 40) : "?") + " " + JSON.stringify([s.previousRect.y, s.currentRect.y, s.previousRect.height, s.currentRect.height])).join(", ") });
    }).observe({ type: "layout-shift", buffered: true });
  }, !!o.share);
  await pg.goto(`http://127.0.0.1:${port}/cash-bids/iowa/nevada`);
  await pg.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  await pg.waitForTimeout(1500);
  return { ctx, pg };
}

test("the builder's button carries the answer line's own bid, its posted day and the town link", () => {
  const ans = unesc(/<p class="cbt-answer">(.*?)<\/p>/.exec(PAGE)[1]);
  const text = attr("data-text");
  const [, price, rest] = /^Corn (\$\d+\.\d\d) at (.*)$/.exec(text) || [];
  assert.ok(price, text);
  assert.ok(ans.includes(`corn ${price} at `), `the share price is the answer's: ${ans} / ${text}`);
  const lab = /\(([^)]*)\), [A-Z][a-z]{2} \d{1,2}, \d{4}\. More bids near you: agsist\.com\/cash-bids\/iowa\/nevada$/.exec(rest);
  assert.ok(lab && ans.includes(`for ${lab[1]} delivery`), `the delivery is the answer's: ${rest}`);
  const row = fx.merged.bids.find((b) => b.delivery === lab[1] && b.crop === "corn");
  const d = new Date(row.pricedAt);
  const day = d.toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", year: "numeric" });
  assert.ok(text.includes(`, ${day}. `), `the posted day ${day}: ${text}`);
  assert.ok(PAGE.includes('<a class="cbt-share-btn" href="/cash-bids/iowa/nevada?utm_source=share" data-share-bid '));
  assert.ok(Date.parse(attr("data-until")) > Date.parse(row.pricedAt), "the bid counts for a while after it was posted");
  assert.ok(!attr("data-plain").includes("$"), "the no-price text has no price");
  assert.equal((PAGE.match(/\/components\/share-bid\.js\?v=\d+/g) || []).length, 1);
});

test("the share sheet gets the bid while it counts, and no price once it does not", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const until = Date.parse(attr("data-until"));
    for (const [now, priced] of [[NOW, true], [until + 60000, false]]) {
      const { ctx, pg } = await open(browser, port, 390, 844, now, { share: true });
      await pg.click("[data-share-bid]");
      await pg.waitForFunction(() => window.__shared, null, { timeout: 5000 });
      const r = await pg.evaluate(() => ({ shared: window.__shared, ga: window.__ga, url: location.href }));
      assert.equal(r.url, `http://127.0.0.1:${port}/cash-bids/iowa/nevada`, "the tap does not navigate");
      // the sheet's text is the page's text minus its trailing bare link; the tagged url carries the link once
      const full = priced ? attr("data-text") : attr("data-plain");
      assert.ok(full.endsWith(" agsist.com/cash-bids/iowa/nevada"), full);
      assert.equal(r.shared.text, full.slice(0, -" agsist.com/cash-bids/iowa/nevada".length));
      assert.ok(!r.shared.text.includes("agsist.com"), `the link shows once: ${r.shared.text}`);
      assert.equal(r.shared.title, "Nevada, IA cash bids");
      assert.equal(r.shared.url, `http://127.0.0.1:${port}/cash-bids/iowa/nevada?utm_source=share`);
      if (!priced) assert.ok(!/\$\d/.test(r.shared.text), "an old bid is never shared as today's");
      const acts = r.ga.filter(([n]) => n === "share_bid").map(([, p]) => p.action);
      assert.deepEqual(acts, ["open", "shared"], JSON.stringify(r.ga));
      assert.ok(r.ga.every(([, p]) => p.priced === (priced ? "yes" : "no") && p.town === "iowa/nevada"));
      await ctx.close();
    }
  } finally { await browser.close(); srv.close(); }
});

test("no share sheet: Copy and, on a phone, an sms link carry one tagged link", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const url = `http://127.0.0.1:${port}/cash-bids/iowa/nevada?utm_source=share`;
    const body = attr("data-text").replace("agsist.com/cash-bids/iowa/nevada", url);
    for (const [w, h, phone] of [[390, 844, true], [1280, 800, false]]) {
      const { ctx, pg } = await open(browser, port, w, h, NOW, { clip: true });
      await pg.click("[data-share-bid]");
      await pg.click(".cbt-share-more button");
      await pg.waitForFunction(() => /Copied/.test((document.querySelector(".cbt-share-msg") || {}).textContent || ""), null, { timeout: 5000 });
      assert.equal(await pg.evaluate(() => navigator.clipboard.readText()), body);
      const sms = await pg.evaluate(() => { const a = document.querySelector("[data-share-sms]"); return a && a.getAttribute("href"); });
      if (phone) assert.equal(sms, "sms:?&body=" + encodeURIComponent(body));
      else assert.equal(sms, null, "no text-message link on a desktop");
      const acts = (await pg.evaluate(() => window.__ga)).map(([, p]) => p.action);
      assert.deepEqual(acts, ["open", "copy"]);
      await ctx.close();
    }
  } finally { await browser.close(); srv.close(); }
});

test("the share line does not move while the page and its script load (390 and 1280)", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const [w, h] of [[390, 844], [1280, 800]]) {
      const { ctx, pg } = await open(browser, port, w, h, NOW);
      const r = await pg.evaluate(() => ({ shifts: window.__shifts,
        box: document.querySelector("[data-share-bid]").getBoundingClientRect().toJSON() }));
      const total = r.shifts.reduce((a, e) => a + e.v, 0);
      // the site's layout-shift bar (test/*cls*.test.mjs: under 0.001); the share line itself never moves.
      // Measured on the fixture: 0 at 390; 0.0007 at 1280, the first card's "Updated" stamp rewritten
      // by components/asof.js on every town page, not this button.
      assert.ok(total < 0.001, `${w}: layout shift ${total}: ${JSON.stringify(r.shifts)}`);
      assert.ok(!r.shifts.some((e) => /cbt-share|Share today/.test(e.what)), `${w}: the share line moved: ${JSON.stringify(r.shifts)}`);
      assert.ok(r.box.height >= 40 && r.box.top < h, `${w}: the button is a full tap target on the first screen`);
      await ctx.close();
    }
  } finally { await browser.close(); srv.close(); }
});
