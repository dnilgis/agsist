/* Phones use the width (Nov 8, 2026).
 *
 * Sig, with a 390px screenshot of the home weather card and red bars over the empty side margins: "We need to not
 * use so much padding in containers, use the space we have, phone screens are already small and we are making them
 * smaller." His standing rule from Oct 22 already said about 12px of gutter, and the site drifted anyway: measured at
 * 390px before this fix, the home weather card's text column was 304px (16px page gutter, a 14px band, a 12px card
 * body inside it), the Daily's cards inside its top card 262px, /prf, /land-sales and the county rain pages had a
 * 15px page gutter plus a 16px wrapper (31px before any card), most cards 297 to 327px.
 *
 * The rule now, at 480px and under: a 12px page gutter; a card's text 12px inside its edge (its line included); a
 * card inside a card adds no side padding. So a main card's text column is at least 342px of a 390px screen (88%).
 * components/styles.css carries one phone block of shared tokens (--gutter, --card-in) for every page; css/home.css
 * carries the home page's. This test holds the column on several pages, so one page drifting fails it.
 *
 *   node --test test/phone-padding.test.mjs
 * Browser runs serve this checkout, block every outside host and service workers (BUILD-RULES 58); the home card
 * fills from the frozen fixtures test/wxcard.test.mjs uses. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { nwsAnswer } from "./fixtures/nws-mock.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

test("styles.css: one phone block of shared tokens, phones only; home.css: the home page's block", () => {
  const css = read("components/styles.css");
  const i = css.indexOf("@media (max-width: 480px) {\n  :root { --gutter: 12px; --card-in: 12px; --card-pad-x: 11px }");
  assert.ok(i > 0, "the phone block opens with the tokens");
  assert.ok(!/^\s*:root\s*\{[^}]*--gutter\s*:/m.test(css.slice(0, i)), "no gutter token outside the phone block: wide screens unchanged");
  assert.match(css.slice(i), /calc\(var\(--gutter\) - \(100vw - 100%\) \/ 2\)/, "a column tops its gutter up to 12px, never doubles it");
  assert.match(css.slice(i), /calc\(var\(--gutter\) \+ var\(--card-in\) - var\(--card-bl, 1px\) - \(100vw - 100%\) \/ 2\)/, "a card's text 12px inside its edge");
  const home = read("css/home.css"), h = home.lastIndexOf("@media (max-width:480px){");
  assert.ok(h > 0, "home.css has its phone block");
  assert.match(home.slice(h), /#main\.main\{padding-left:max\(var\(--gutter,12px\)/);
  assert.match(home.slice(h), /\.wx-card\.wx-tight \.card-body\{padding-left:0!important;padding-right:0!important\}/, "the weather card inside its band adds no side padding");
  // the home page loads both, home.css last
  const idx = read("index.html");
  assert.ok(idx.indexOf("/components/styles.css?v=") < idx.indexOf("/css/home.css?v="));
});

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
  const fix = { "/data/rain/ia.json": "test/fixtures/wxcard/rain-ia.json", "/data/rain/wx/ia.json": "test/fixtures/wxcard/wx-ia.json" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index.html"; else if (!extname(p)) p += ".html";
    const f = normalize(join(ROOT, fix[p] || p));
    if (!f.startsWith(ROOT) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

async function open(browser, port, path, width) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width, height: 844 } });
  await ctx.addInitScript(() => { try { localStorage.setItem("agsist-wx-loc", JSON.stringify({ zip: "50010", lat: 42.03, lon: -93.62, label: "Ames, IA", city: "Ames, IA", state: "IA" })); } catch (e) {} });
  const pg = await ctx.newPage();
  await pg.route("**/*", (r) => {
    const u = r.request().url();
    if (u.startsWith(`http://127.0.0.1:${port}`)) return r.continue();
    if (/^https:\/\/api\.weather\.gov\//.test(u)) { const a = nwsAnswer(u, {}); return r.fulfill({ status: a.status, contentType: "application/geo+json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(a.body) }); }
    return r.abort();
  });
  await pg.goto(`http://127.0.0.1:${port}${path}`, { waitUntil: "load" });
  return { ctx, pg };
}

// the text box of an element: its edge, and its content box (inside line and padding) against the screen
const box = (pg, sel) => pg.evaluate((sel) => {
  const e = [...document.querySelectorAll(sel)].find((x) => x.getBoundingClientRect().width > 0);
  if (!e) return null;
  const b = e.getBoundingClientRect(), cs = getComputedStyle(e), vw = document.documentElement.clientWidth;
  const L = b.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft), R = vw - b.right + parseFloat(cs.borderRightWidth) + parseFloat(cs.paddingRight);
  return { edge: b.left, L, R, col: vw - L - R, vw, scroll: document.documentElement.scrollWidth };
}, sel);

test("home at 390 and 360: the weather card's text column is 342px (360: 312px) or more, 12px page gutter", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const [width, min] of [[390, 342], [360, 312]]) {
      const { ctx, pg } = await open(browser, port, "/", width);
      await pg.waitForFunction(() => document.querySelector("#wx-season .wxs-t .wxs-v"), null, { timeout: 20000 });
      await pg.waitForFunction(() => { const t = document.getElementById("wx-temp"); return t && /\d/.test(t.textContent); }, null, { timeout: 20000 });
      const band = await box(pg, "#f2"), season = await box(pg, "#wx-season"), grid = await box(pg, ".wx-card .wx-grid");
      assert.ok(Math.abs(band.edge - 12) <= 0.5, `${width}: the weather band starts ${band.edge}px from the edge, 12 wanted`);
      for (const [k, b] of [["Season so far", season], ["the figures", grid]]) {
        assert.ok(b.col >= min, `${width}: ${k} text column ${b.col.toFixed(1)}px, ${min} or more wanted (before: 304 at 390)`);
        assert.ok(b.L >= 20 && b.R >= 20, `${width}: ${k} text ${b.L.toFixed(1)} / ${b.R.toFixed(1)}px from the edges, never against them`);
      }
      assert.ok(band.scroll <= width, `${width}: no sideways scroll`);
      await ctx.close();
    }
  } finally { await browser.close(); srv.close(); }
});

// [page, its main card(s)]: a page of each kind, generated sets included (their CSS is the shared block)
const PAGES = [
  ["/daily", ["a.nw-item", ".dv3-sec"]],
  ["/cash-bids", ["#internal-links-block"]],
  ["/cot", ["#cot-chart-box", "li.cu"]],
  ["/land-sales/", [".la-ask"]],
  ["/land-sales/wisconsin/barron-county", [".la-ask"]],
  ["/custom-rates", ["#answer"]],
  ["/rain/iowa/story-county", ["aside.rpx"]],
  ["/prf", ["section.prf-card"]],
  ["/about", [".info-card"]],
  ["/planting-date", ["section.pd-card"]],
];

test("several pages at 390: 12px page gutter, each main card's text column 342px or more, no sideways scroll", { skip, timeout: 300000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  const bad = [];
  try {
    for (const [path, cards] of PAGES) {
      const { ctx, pg } = await open(browser, port, path, 390);
      for (const sel of cards) {
        try { await pg.waitForSelector(sel, { state: "visible", timeout: 15000 }); } catch (e) { bad.push(`${path}: ${sel} not on the page`); continue; }
        const b = await box(pg, sel);
        if (Math.abs(b.edge - 12) > 0.5) bad.push(`${path}: ${sel} starts ${b.edge.toFixed(1)}px from the edge, 12 wanted`);
        if (b.col < 342) bad.push(`${path}: ${sel} text column ${b.col.toFixed(1)}px, 342 or more wanted`);
        if (b.L < 20 || b.R < 20) bad.push(`${path}: ${sel} text ${b.L.toFixed(1)} / ${b.R.toFixed(1)}px from the edges`);
        if (b.scroll > b.vw) bad.push(`${path}: sideways scroll ${b.scroll}px`);
      }
      await ctx.close();
    }
  } finally { await browser.close(); srv.close(); }
  assert.deepEqual(bad, []);
});

// Narrow cards (Nov 9): pages whose own card sat inside a padded card had the inner box 291 to 328px wide at 390 (the page
// gutter was fine, the card inside a card added 17px or more each side). Phones now give the parent 8 to 12px, so the inner
// box is [page, selector, least width]; "before" is the width on main on Nov 9.
const NESTED = [
  ["/combine-loss", "#cl-answer .cl-kv", 332], ["/grain-shrink", "#gs-answer div", 332], ["/commodity-loan", "#lo-answer > div", 332], ["/harvest-or-wait", "#hw-answer > div", 332],
  ["/corn-futures-prices", ".sc-f", 318], ["/soybean-futures-prices", ".sc-f", 318], ["/wheat-futures-prices", ".sc-f", 318],
  ["/cattle-futures-prices", ".ctcot-box", 316], ["/conditions", "#cyn-corn", 334], ["/spray", ".edu-card-tip", 312], ["/spray", ".inv-layer", 310],
  ["/urea", ".soil-air-card", 336], ["/milk-prices", ".dp-ppd-class", 312], ["/cash-lease", ".np-box", 318], ["/cattle-auction-prices", "#vog-out", 332],
  ["/developer", "pre#ifr-gdu", 336], ["/field-scout", "#fs-saved", 336],
];

test("the Sources fold on /fast-facts sits in a 12px card on phones (the fold is hidden until data loads, so this reads the CSS)", () => {
  assert.match(read("fast-facts.html"), /@media\(max-width:480px\)\{[^}]*\.ff-sources\{padding-left:12px;padding-right:12px\}/);
});

test("nested cards at 390: the box inside a card keeps its width (no extra side padding), no sideways scroll", { skip, timeout: 300000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  const bad = [];
  try {
    for (const [path, sel, min] of NESTED) {
      const { ctx, pg } = await open(browser, port, path, 390);
      try { await pg.waitForSelector(sel, { state: "attached", timeout: 15000 }); } catch (e) { bad.push(`${path}: ${sel} not on the page`); await ctx.close(); continue; }
      await pg.evaluate((sel) => { for (const e of document.querySelectorAll(sel)) for (let n = e.parentElement; n; n = n.parentElement) if (n.tagName === "DETAILS") n.open = true; }, sel);
      await pg.waitForTimeout(300);
      const w = await pg.evaluate((sel) => { const e = [...document.querySelectorAll(sel)].find((x) => x.getBoundingClientRect().width > 0) || document.querySelector(sel); return { w: e.getBoundingClientRect().width, scroll: document.documentElement.scrollWidth }; }, sel);
      if (w.w < min) bad.push(`${path}: ${sel} is ${w.w.toFixed(1)}px wide, ${min} or more wanted`);
      if (w.scroll > 390) bad.push(`${path}: sideways scroll ${w.scroll}px`);
      await ctx.close();
    }
  } finally { await browser.close(); srv.close(); }
  assert.deepEqual(bad, []);
});

test("wide screens unchanged: at 1280 no phone token is set and the cards keep their own padding", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const [path, sel, pad] of [["/prf", "section.prf-card", 17], ["/custom-rates", "#answer", null], ["/", "#f2", 18]]) {
      const { ctx, pg } = await open(browser, port, path, 1280);
      await pg.waitForSelector(sel, { timeout: 15000 });
      const got = await pg.evaluate((sel) => ({ g: getComputedStyle(document.documentElement).getPropertyValue("--gutter").trim(), p: parseFloat(getComputedStyle(document.querySelector(sel)).paddingLeft) }), sel);
      assert.equal(got.g, "", `${path} at 1280: --gutter unset`);
      if (pad != null) assert.ok(Math.abs(got.p - pad) < 0.5, `${path} at 1280: ${sel} padding ${got.p}px, ${pad} before`);
      await ctx.close();
    }
  } finally { await browser.close(); srv.close(); }
});
