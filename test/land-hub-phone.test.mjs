/* The farmland sales hub on a 390 px phone (Sig, Nov 8, 2026: "scroll scroll scroll and finally something ... the map and any
 * stand-out sales top and center"; and: the map shows only what a reader can use). Built from the synthetic fixture site
 * (test/fixtures/land-fl/make_site.py) into a temp folder, never the committed hub, which is carried until a land-data rebuild.
 *
 *   - top of the page: title, one sentence, the real map, the stand-out sales, then the state and county picker;
 *   - the full state and county lists, the Illinois index and Sources and terms are closed folds below;
 *   - every county link is in the fold exactly once; the picker and a map state reach their pages;
 *   - no internal research status on the hub or the month page, and its source file is not published.
 *
 *   node --test test/land-hub-phone.test.mjs      (the 390 px test needs PLAYWRIGHT_PATH and CHROMIUM_PATH, else it skips)
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PLACES_ROUTE } from "./fixtures/places-mock.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (fs.existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !fs.existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

let DIR = null;
function site() {
  if (DIR) return DIR;
  DIR = fs.mkdtempSync(path.join(os.tmpdir(), "lshub-"));
  const r = spawnSync("python3", [path.join(ROOT, "test/fixtures/land-fl/make_site.py"), DIR], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return DIR;
}
after(() => { if (DIR) fs.rmSync(DIR, { recursive: true, force: true }); });
const rd = (p) => fs.readFileSync(path.join(site(), p), "utf8");
const monthFile = () => "land-sales/" + fs.readdirSync(path.join(site(), "land-sales")).find((f) => /^\d{4}-\d{2}\.html$/.test(f));
const INTERNAL = /on request|for a fee|not built yet|not checked|not public record|No public source|Where each state stands|source table|goal is every state|nondisclosure|unchecked|no data/i;

test("the hub's order: title, map, stand-out sales, picker, months, then the closed folds", () => {
  const h = rd("land-sales/index.html");
  const at = ["<h1>", 'id="ls-map"', 'id="stand-out"', 'id="ls-pick"', 'id="months"', 'id="all-states"', 'id="how-counted"'].map((x) => h.indexOf(x));
  assert.ok(!at.includes(-1), "every part is there: " + at);
  assert.deepEqual(at, [...at].sort((a, b) => a - b));
  for (const id of ["all-states", "how-counted"]) {
    const m = new RegExp(`<details[^>]*id="${id}"[^>]*>`).exec(h);
    assert.ok(m && !/\bopen\b/.test(m[0]), `${id} is a closed fold`);
  }
  assert.doesNotMatch(h, /[–—]/, "no dash");
  assert.match(h, /<p class="ls-ans">\d+ farm sales in [A-Z][a-z]+ \d{4}\. Tap a state/, "one sentence with the month's count");
});

test("the stand-out cards: distinct sales, each with place, acres, price, $/acre, date and a link to the county row", () => {
  const h = rd("land-sales/index.html");
  const cards = [...h.matchAll(/<a class="ls-card" href="(\/land-sales\/[a-z-]+\/[a-z0-9-]+#s-[0-9a-f]{10})">([\s\S]*?)<\/a>/g)];
  assert.ok(cards.length >= 3 && cards.length <= 5, `${cards.length} cards`);
  assert.equal(new Set(cards.map((c) => c[1])).size, cards.length, "never one sale twice");
  for (const [, href, body] of cards) {
    assert.match(body, /[\d,.]+ acres in .+ County, [A-Z]{2}/);
    assert.match(body, /\$[\d,]+ &middot; \$[\d,]+ an acre/);
    assert.match(body, /[A-Z][a-z]{2} \d{1,2}, \d{4}|[A-Z][a-z]{2} \d{4}/, "a date");
    assert.ok(fs.existsSync(path.join(site(), href.split("#")[0].replace(/^\//, "") + ".html")), "the county page exists: " + href);
    assert.ok(rd(href.split("#")[0].replace(/^\//, "") + ".html").includes(`id="s-${href.split("#s-")[1]}"`), "the row is on the county page");
  }
  assert.match(h, /Largest by acres/);
  assert.match(h, /Newest sale/);
});

test("every county link is in the closed list fold exactly once, and each state has its anchor", () => {
  const h = rd("land-sales/index.html");
  const a = h.indexOf('id="all-states"'), z = h.indexOf("</details>", a);
  const links = [...h.matchAll(/<li><a href="(\/land-sales\/[a-z-]+\/[a-z0-9-]+)">/g)];
  assert.ok(links.length >= 3, "the fixture's counties");
  for (const l of links) {
    assert.ok(l.index > a && l.index < z, `${l[1]} is inside the fold`);
    assert.equal(h.split(`href="${l[1]}"`).length - 1, 1, `${l[1]} once`);
  }
  for (const s of ["wisconsin", "florida"]) assert.ok(h.includes(`<h3 id="${s}">`), s);
});

test("nothing internal: no research status, no source table, no unlisted state named, on the hub or the month page", () => {
  for (const p of ["land-sales/index.html", monthFile()]) {
    const h = rd(p).slice(rd(p).indexOf("<main"));
    assert.doesNotMatch(h.replace(/<script[\s\S]*?<\/script>/g, ""), INTERNAL, p);
    assert.doesNotMatch(h, /Public, county by county|ls-st-request|ls-st-nondisclosure|ls-st-unchecked/, p);
    const map = JSON.parse(/id="ls-map" data-map="([^"]*)"/.exec(h)[1].replace(/&quot;/g, '"'));
    assert.deepEqual(Object.keys(map).sort(), ["FL", "WI"], `${p}: only the states with sales are on the map`);
    for (const v of Object.values(map)) assert.equal(v[0], "live");
  }
});

test("the research status file is not published (data/land-sales/coverage.json)", () => {
  const r = spawnSync("python3", ["-c", "import sys;sys.path.insert(0,'scripts');import check_site_budget as b;print(b.publishes('data/land-sales/coverage.json'), b.publishes('data/land-sales/latest.json'))"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(r.stdout.trim(), "False True");
  for (const f of ["components", "land-sales"]) {
    for (const n of fs.readdirSync(path.join(ROOT, f))) if (/\.(js|html)$/.test(n)) assert.ok(!fs.readFileSync(path.join(ROOT, f, n), "utf8").includes("land-sales/coverage.json"), `${f}/${n} loads it`);
  }
});

test("in Chromium at 390 px: the map and the stand-out sales are inside 1.5 screens, nothing sideways; the picker and a map state work", { skip }, async () => {
  const tmp = site();
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index.html";
    if (!path.extname(p)) p += ".html";
    for (const dir of [tmp, ROOT]) {
      const f = path.normalize(path.join(dir, p));
      if (f.startsWith(dir) && fs.existsSync(f) && fs.statSync(f).isFile()) {
        res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" });
        res.end(fs.readFileSync(f));
        return;
      }
    }
    res.writeHead(404); res.end();
  });
  await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const scheme of ["light", "dark"]) {
      const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, colorScheme: scheme });
      await ctx.route(PLACES_ROUTE, (q) => q.abort());
      await ctx.route("**/*", (q) => (q.request().url().startsWith(base) ? q.continue() : q.abort()));
      const pg = await ctx.newPage();
      await pg.goto(`${base}/land-sales/`, { waitUntil: "load" });
      await pg.waitForSelector("#ls-map svg");
      const m = await pg.evaluate(() => {
        const top = (s) => { const e = document.querySelector(s); return e ? e.getBoundingClientRect().top + scrollY : null; };
        const last = [...document.querySelectorAll(".ls-card")].pop().getBoundingClientRect();
        return { vw: document.documentElement.clientWidth, doc: document.documentElement.scrollWidth, map: top("#ls-map svg"), cards: top(".ls-card"),
                 cardsEnd: last.bottom + scrollY, pick: top("#ls-pick") };
      });
      assert.equal(m.doc, m.vw, `${scheme}: no sideways scroll`);
      assert.ok(m.map < 300, `${scheme}: the map starts at ${Math.round(m.map)} px`);
      assert.ok(m.cards < 844 * 1.5, `${scheme}: the first stand-out sale at ${Math.round(m.cards)} px`);
      assert.ok(m.cardsEnd < 844 * 1.9, `${scheme}: the stand-out sales end at ${Math.round(m.cardsEnd)} px`);
      console.log(`  ${scheme}: map ${Math.round(m.map)} px, first card ${Math.round(m.cards)} px, cards end ${Math.round(m.cardsEnd)} px, picker ${Math.round(m.pick)} px`);
      if (scheme === "light") {
        const tx = await pg.evaluate(() => document.querySelector('.usm-s[data-st="TX"]').getAttribute("aria-label"));
        assert.equal(tx, "Texas", "a state with no sales says only its name");
        await pg.selectOption("select[name=st]", "wisconsin");
        assert.ok((await pg.locator("select[name=co] option").count()) >= 2, "the county list fills");
        await pg.selectOption("select[name=co]", { index: 1 });
        await Promise.all([pg.waitForURL(/\/land-sales\/wisconsin\/[a-z0-9-]+$/), pg.click("#ls-pick button")]);
        await pg.goto(`${base}/land-sales/`, { waitUntil: "load" });
        await pg.waitForSelector("#ls-map svg");
        await pg.locator('.usm-s[data-st="WI"]').click();
        await pg.waitForFunction(() => location.hash === "#wisconsin");
        assert.ok(await pg.evaluate(() => document.getElementById("all-states").open), "the map opens the county list fold");
        await pg.waitForTimeout(300);
        assert.ok(await pg.evaluate(() => { const r = document.getElementById("wisconsin").getBoundingClientRect(); return r.top >= 0 && r.top < 844; }), "and lands on the state");
      }
      await ctx.close();
    }
  } finally { await browser.close(); srv.close(); }
});
