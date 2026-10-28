// The sponsor portal, simplified (Sig, Oct 28, 2026: "a bit busy").
// First screen: name, one status pill, four numbers for the last 7 days (each
// with its meaning and as-of date, a zero reads "0 so far"), then the ad.
// Everything else is one tap away in a collapsed section, never gone.
// Checked for every sponsor file in data/sponsors/, at 390 and 1280.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

const PAGE = read("sponsor-report.html");
const FILES = readdirSync(join(ROOT, "data/sponsors")).filter((f) => /^[a-z0-9-]+-[0-9a-f]{16}\.json$/.test(f));
const ORDER = ["where", "area", "trend", "ad", "billing", "audience", "how", "requests"];
// The page was 14,208 px tall at 390 before (Root Lot, Oct 28). The aim is under a third.
const BEFORE_390 = 14208;

test("the sections come in Sig's order, and the first screen is hero, numbers, ad", () => {
  const nav = PAGE.slice(PAGE.indexOf("function nav("), PAGE.indexOf("function fold("));
  let at = -1;
  for (const id of ORDER) {
    const i = nav.indexOf("'#" + id + "'");
    assert.ok(i > at, "#" + id + " is listed, after the one before it");
    at = i;
  }
  assert.match(PAGE, /root\.innerHTML = hero\(d, s\) \+ results\(d, s\) \+ adNow\(d, s\) \+ '<div class="cp-folds">'/);
});

test("there is a sponsor file to check", () => assert.ok(FILES.length >= 2, FILES.join(",")));

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".webp": "image/webp" };
  const srv = createServer((req, res) => {
    let f = normalize(join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname)));
    if (!existsSync(f) && existsSync(f + ".html")) f += ".html";
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

async function open(browser, port, r, w, hash = "") {
  const ctx = await browser.newContext({ viewport: { width: w, height: 844 }, serviceWorkers: "block" });
  const pg = await ctx.newPage();
  const errs = []; pg.on("pageerror", (e) => errs.push(String(e)));
  await pg.addInitScript(() => {
    window.__cls = 0;
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; })
      .observe({ type: "layout-shift", buffered: true });
  });
  await pg.route((u) => u.hostname !== "127.0.0.1", (x) => x.abort());
  await pg.goto(`http://127.0.0.1:${port}/sponsor-report.html?r=${r}${hash}`, { waitUntil: "load" });
  await pg.waitForSelector("#results .cp-kpi", { timeout: 8000 });
  await pg.waitForTimeout(400);
  return { ctx, pg, errs };
}

test("browser: every sponsor's first screen, every section reachable, short, still, no sideways scroll", { skip, timeout: 240000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const f of FILES) {
      const r = f.replace(/\.json$/, "");
      const d = JSON.parse(read("data/sponsors/" + f));
      for (const w of [390, 1280]) {
        const tag = r.split("-")[0] + " " + w + ": ";
        const { ctx, pg, errs } = await open(browser, port, r, w);

        // one status pill, in plain words
        const pill = await pg.textContent(".cp-hero .cp-pill");
        assert.match(pill, /^(Live since [A-Z][a-z]{2} \d+, \d{4}|Live|Not started|Ended [A-Z][a-z]{2} \d+, \d{4})$/, tag + pill);
        if (d.freeTest) assert.match(await pg.textContent(".cp-hero .cp-pillrow"), /Free test: no charge/, tag + "free test said");

        // four numbers, each with a meaning and an as-of date, never blank
        const k = await pg.$$eval("#results .cp-kpi", (els) => els.map((e) => ({
          n: (e.querySelector(".cp-kpi-n") || {}).textContent || "",
          u: (e.querySelector(".cp-kpi-u") || {}).textContent || "",
          k: (e.querySelector(".cp-kpi-k") || {}).textContent || "",
          m: (e.querySelector(".cp-kpi-m") || {}).textContent || "",
          a: (e.querySelector(".cp-kpi-a") || {}).textContent || "",
          bottom: e.getBoundingClientRect().bottom + scrollY })));
        assert.equal(k.length, 4, tag + "four numbers");
        assert.deepEqual(k.slice(0, 3).map((x) => x.k), ["Times seen", "Clicks", "Click rate"], tag + "in order");
        assert.match(k[3].k, /readers/i, tag + "the fourth is readers");
        for (const x of k) {
          assert.ok(x.n.trim(), tag + x.k + ": a value, not a blank");
          assert.ok(x.m.trim().length > 5, tag + x.k + ": a plain meaning");
          assert.ok(x.a.trim(), tag + x.k + ": an as-of date");
          if (x.n.trim() === "0") assert.equal(x.u.trim(), "so far", tag + x.k + ": a zero reads 0 so far");
          if (x.n.trim() === "-") assert.ok(x.m.trim(), tag + x.k + ": a dash says why");
        }
        assert.notEqual(k[2].n.trim(), "0.00%", tag + "no rate shown over zero views");
        if (w === 390) assert.ok(Math.max(...k.map((x) => x.bottom)) <= 844, tag + "the four numbers are on the first screen");

        // the ad itself, as it runs, right under the numbers
        if (d.creative) assert.ok(await pg.$(".cp-adnow .sa-ad"), tag + "the ad is drawn");

        // every section: closed, a one-line summary, opens on tap with something in it
        const ids = await pg.$$eval(".cp-folds details.cp-fold", (els) => els.map((e) => e.id));
        const want = ORDER.filter((id) => id !== "area" || (d.regions && d.regions.length));
        assert.deepEqual(ids, want, tag + "sections in order");
        if (w === 390) {
          const h = await pg.evaluate(() => document.documentElement.scrollHeight);
          assert.ok(h < BEFORE_390 / 3, tag + "page is under a third of its old height: " + h);
        }
        for (const id of ids) {
          assert.equal(await pg.$eval("#" + id, (e) => e.open), false, tag + id + " starts closed");
          assert.ok((await pg.textContent("#" + id + " .cp-fold-s")).trim(), tag + id + " has a summary line");
          await pg.click("#" + id + " > summary");
          assert.equal(await pg.$eval("#" + id, (e) => e.open), true, tag + id + " opens on tap");
          const body = await pg.$eval("#" + id + " .cp-fold-b", (e) => ({ t: e.innerText.trim().length, h: e.getBoundingClientRect().height }));
          assert.ok(body.t > 20 && body.h > 20, tag + id + " shows its content");
        }
        // with everything open, still no sideways scroll
        const side = await pg.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth);
        assert.ok(side <= 0, tag + "no sideways scroll with every section open: " + side);
        assert.ok((await pg.evaluate(() => window.__cls)) < 0.001, tag + "nothing shifts while it loads");
        assert.deepEqual(errs, [], tag + "no errors");
        await ctx.close();
      }
      // a link to a section opens it: from the address, and from "Request a change"
      const a = await open(browser, port, r, 390, "#billing");
      assert.equal(await a.pg.$eval("#billing", (e) => e.open), true, r + ": #billing in the address opens it");
      if (await a.pg.$("a[data-goto-request]")) {
        await a.pg.click("#ad > summary");
        await a.pg.click("a[data-goto-request]");
        assert.equal(await a.pg.$eval("#requests", (e) => e.open), true, r + ": Request a change opens the box");
      }
      await a.ctx.close();
    }
  } finally { await browser.close(); srv.close(); }
});
