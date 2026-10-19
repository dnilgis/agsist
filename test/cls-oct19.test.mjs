/* Layout shift on /fertilizer and the homepage, Oct 19, 2026 phone audit.
 *
 *   /fertilizer, fresh visit: CLS about 0.57 at 390 x 844 and 0.40 at 1280 x 800.
 *     The co-op cards (#fert-coops) and the lede's "Right now: ... posted ..."
 *     line were drawn after first paint and pushed the page down. Both are
 *     now baked into the HTML from the same files and the same code
 *     (scripts/bake_fert_page.mjs); the live draw lands on the same boxes.
 *   Homepage with a saved ZIP: CLS about 0.19 at 390 and 0.12 at 1280.
 *     At 390 the static header (69px) gave way to the live nav (62px) and the
 *     saved state's middle-bid line (.pl-line, up to 170px) arrived, in one
 *     frame. At 1280 the ticker status grew from "..." to two lines and slid
 *     the ticker 30px, and the "Also today" line grew the briefing strip
 *     after paint (that one also hit a fresh visit: 0.0986).
 *
 * The pages are served as committed, with the committed data: nothing is
 * mocked. The dnilgis/bids clone stands in for dnilgis.github.io/bids when
 * it is here (BIDS_DIR, default ../bids); anything else off-site is refused.
 * The CPU runs at a quarter speed (a phone), as in the audit, so the late
 * draws land after first paint; on /fertilizer the /data files also arrive
 * after 1.5 s (a phone network: the cards came after the first paint).
 *
 *   node --test test/cls-oct19.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");
const BIDS = process.env.BIDS_DIR || join(ROOT, "../bids/");
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;
const SAVED = { zip: "50010", lat: 42.03, lon: -93.62, label: "Ames, IA" };

test("fertilizer.html: the cards and the lede line are baked current from the shared files", () => {
  execFileSync("node", [ROOT + "scripts/bake_fert_page.mjs", "--check"], { cwd: ROOT, stdio: "pipe" });
  const F = read("fertilizer.html");
  const ctx = { window: {} };
  vm.runInNewContext(read("components/fert-coops.js"), ctx);
  const top = ctx.window.FertCoops.top(JSON.parse(read("data/fertilizer-coops.json")));
  assert.ok(top.length > 0, "the committed co-op file has cards to show");
  assert.ok(F.includes('<!--BAKE:fert-cards--><section id="fert-coops" aria-labelledby="fert-coops-h">' + top + "</section><!--/BAKE-->"),
    "the section opens shown, with fert-coops.js top() of the committed file");
  // the cards carry the baked body line's numbers (bake_seo.py fert-bar, Sig Oct 19)
  const bar = /<!--BAKE:fert-bar-->([\s\S]*?)<!--\/BAKE-->/.exec(F)[1];
  let named = 0;
  for (const m of bar.matchAll(/\b(urea|anhydrous|DAP|potash) \$(\d{1,3}(?:,\d{3})*)/g)) {
    assert.ok(top.includes('<div class="fpc-price">$' + m[2] + "</div>"), `a card shows ${m[1]} $${m[2]} as the line does`);
    named++;
  }
  assert.ok(named >= 3, "the line names its prices (" + named + ")");
});

test("price-local placeholder: same words as the line, for the saved state only", () => {
  const PL = (() => { const m = { exports: {} }; vm.runInNewContext(read("components/price-local.js"), { module: m, Intl, Date }); return m.exports; })();
  const h = PL.placeholder("IA", ["corn", "soybeans"]);
  assert.match(h, /^<b>Iowa corn:<\/b> median basis <b>00¢ under<\/b> Dec '00 futures, about <b>\$0\.00<\/b> cash on the Oct 00 settle\. <span class="pl-s">000 elevators, Oct 00\.<\/span><br><b>Iowa soybeans:<\/b> /);
  assert.match(h, /Nov '00 futures/);
  assert.match(h, / <a href="\/cash-bids" tabindex="-1">Bids near you &rarr;<\/a>$/);
  assert.equal(PL.placeholder("", ["corn"]), "");
  assert.equal(PL.placeholder("IA", []), "");
});

function serve(hold) {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".xml": "application/xml" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/") p = "/index.html";
    if (!extname(p)) p += ".html";
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    const send = () => { res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" }); res.end(readFileSync(f)); };
    if (hold && p.startsWith("/data/")) setTimeout(send, hold); else send();
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

async function measure(browser, port, path, width, height, saved) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width, height }, isMobile: width < 600, hasTouch: width < 600, timezoneId: "America/Chicago" });
  const pg = await ctx.newPage();
  const cdp = await ctx.newCDPSession(pg);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await pg.route("**/*", (r) => {
    const u = r.request().url();
    if (u.startsWith(`http://127.0.0.1:${port}`)) return r.continue();
    if (u.startsWith("https://dnilgis.github.io/bids/")) {
      const f = join(BIDS, new URL(u).pathname.replace(/^\/bids\//, ""));
      if (existsSync(f) && statSync(f).isFile()) return r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: readFileSync(f) });
      return r.fulfill({ status: 404, body: "" });
    }
    return r.abort();
  });
  if (saved) await pg.addInitScript((s) => { try { localStorage.setItem("agsist-wx-loc", JSON.stringify(Object.assign({ ts: Date.now() }, s))); } catch (e) {} }, saved);
  await pg.addInitScript(() => {
    window.__cls = 0; window.__src = [];
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        if (e.hadRecentInput) continue;
        window.__cls += e.value;
        window.__src.push(e.value.toFixed(4) + " " + (e.sources || []).map((s) => (s.node ? s.node.nodeName + "#" + (s.node.id || "") + "." + (typeof s.node.className === "string" ? s.node.className : "") : "?") +
          " y" + Math.round(s.previousRect.y) + ">" + Math.round(s.currentRect.y)).join(", "));
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
  await pg.goto(`http://127.0.0.1:${port}${path}`);
  await pg.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  await pg.waitForTimeout(2500);
  const r = await pg.evaluate(() => {
    const pl = document.querySelector("#hero-band .pl-line"), fc = document.getElementById("fert-coops");
    return {
      cls: window.__cls, src: window.__src,
      pl: pl ? { hidden: pl.hidden, wait: pl.classList.contains("pl-wait"), text: pl.textContent } : null,
      cards: fc && !fc.hidden ? fc.querySelectorAll(".fert-coop-card").length : 0,
      lede: (document.getElementById("fert-lede-when") || {}).textContent || "",
    };
  });
  await ctx.close();
  return r;
}

const SIZES = [[390, 844], [1280, 800]];

test("browser: /fertilizer on a fresh visit shifts under 0.1, at 390 and 1280", { skip, timeout: 180000 }, async () => {
  const srv = await serve(1500), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const [w, h] of SIZES) {
      const r = await measure(browser, port, "/fertilizer", w, h, null);
      assert.ok(r.cls < 0.1, `/fertilizer ${w}: CLS ${r.cls.toFixed(4)} ${JSON.stringify(r.src)}`);
      assert.ok(r.cards >= 4, `${w}: the co-op cards are on the page (${r.cards})`);
      assert.match(r.lede, /^ Right now: .+ co-ops only, posted .+\.$/);
    }
  } finally { await browser.close(); srv.close(); }
});

test("browser: the homepage with a saved ZIP shifts under 0.1, at 390 and 1280", { skip, timeout: 180000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const [w, h] of SIZES) {
      const r = await measure(browser, port, "/", w, h, SAVED);
      assert.ok(r.cls < 0.1, `/ saved ZIP ${w}: CLS ${r.cls.toFixed(4)} ${JSON.stringify(r.src)}`);
      // the reserved state line ends as the real one (or goes away): never left as the blank shape
      assert.ok(r.pl && !r.pl.wait, `${w}: the state line left its placeholder (${JSON.stringify(r.pl)})`);
      if (!r.pl.hidden) assert.match(r.pl.text, /^Iowa corn: median basis /);
      assert.doesNotMatch(r.pl.text, /00¢|\$0\.00/);
    }
  } finally { await browser.close(); srv.close(); }
});

test("browser: the homepage on a fresh visit stays under 0.1, at 390 and 1280", { skip, timeout: 180000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const [w, h] of SIZES) {
      const r = await measure(browser, port, "/", w, h, null);
      assert.ok(r.cls < 0.1, `/ fresh ${w}: CLS ${r.cls.toFixed(4)} ${JSON.stringify(r.src)}`);
      assert.ok(r.pl && r.pl.hidden && !r.pl.wait, "no saved place: no state line, no reserved space");
    }
  } finally { await browser.close(); srv.close(); }
});
