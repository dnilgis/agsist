/* County Print (Sig, Nov 7, 2026: "County print, yes"): the one-page county sheet, the phone picture and the share
 * link on every Farmland Atlas county page (components/county-print.js, components/county-print.css; the figures
 * from scripts/build_atlas_pages.py county_print_data, the daily rows from components/county-home.js).
 *
 *   node --test test/county-print.test.mjs
 *
 * What it holds the pages to:
 *   - every county page carries the County Print group (Print, Save picture, Copy link; Print falls back to the
 *     shared sheet before the script runs), its figures (a few hundred bytes) and the script, at its own hash;
 *   - every yearly figure on the sheet is one the page prints (Story County and a spread of counties), the chart
 *     is the page's own yields with the page's yearly trend, and the daily rows are the rows county-home.js drew;
 *   - a figure the page does not have is left out, never "n/a"; the reader's own field name never prints;
 *   - the QR code reads back to the county page with the print tags (jsQR, as the PR checks install it);
 *   - in a browser: one page on Letter and on A4 for a full county (Story, IA) and a sparse one (New York
 *     County, NY), the title with the date and year, the 8.5 pt source line, "Not advice", no buyer name; Ctrl+P
 *     (beforeprint) prints the sheet; the picture is 1080 x 1350; nothing on the page moves when the sheet is
 *     built. Every outside host is blocked and service workers are off (BUILD-RULES 58). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const J = (p) => JSON.parse(read(p));
const require = createRequire(import.meta.url);
const CP = require(join(ROOT, "components/county-print.js"));
const JS = read("components/county-print.js"), CSS = read("components/county-print.css");
const B = read("scripts/build_atlas_pages.py");
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;
function jsqr() { for (const p of [process.env.JSQR_PATH, "jsqr"].filter(Boolean)) { try { return require(p); } catch (e) { /* next */ } } return null; }
const qctx = { window: {} };
vm.createContext(qctx);
vm.runInContext(read("components/qr.js"), qctx);
const Q = qctx.window.AgQR;

const INDEX = J("farmland-atlas/data/counties-index.json");   // [fips, "Story County, IA", url]
const row = (fips) => INDEX.find((x) => x[0] === fips);
const page = (fips) => read(row(fips)[2].slice(1) + ".html");
const cpData = (h) => { const m = h.match(/<script type="application\/json" id="cp-data">([^<]*)<\/script>/); return m && JSON.parse(m[1]); };
const canon = (h) => h.match(/<link rel="canonical" href="([^"]+)">/)[1];
const ctxOf = (h, fips) => {
  const t = h.match(/<h1>([^<]*)<\/h1>/)[1].replace(/&amp;/g, "&").split(", ");
  return { name: t.slice(0, -1).join(", "), state: t[t.length - 1], url: canon(h), fips, now: Date.UTC(2026, 10, 7, 18) };
};
/* what a reader sees: the page without its scripts, styles and tags */
const visible = (h) => h.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ")
  .replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&middot;/g, "·").replace(/\s+/g, " ");
const nums = (s) => (String(s).match(/\$?\d[\d,]*(?:\.\d+)?/g) || []).map((x) => x.replace(/^\$/, ""));
const sheetText = (s) => [s.title, ...s.blocks.flatMap((b) => b.rows.map((r) => (r.big || "") + (r.unit || "") + " " + r.text)), s.src, s.notice].join(" ");

test("every Atlas county page carries the County Print group, its figures and the script at its own hash", () => {
  const v = createHash("sha1").update(readFileSync(join(ROOT, "components/county-print.js"))).digest("hex").slice(0, 8);
  assert.match(B, /^CP_JS = "components\/county-print\.js"$/m, "the builder names the script");
  let n = 0, maxCp = 0;
  for (const [fips, , url] of INDEX) {
    const h = read(url.slice(1) + ".html");
    assert.ok(h.includes(`<div class="cpr" role="group" aria-label="County Print"><a class="pri" id="cpr-print" href="/farmland-atlas/sheet#${fips}">Print County Print</a>`
      + '<button type="button" id="cpr-pic">Save picture</button><button type="button" id="cpr-link">Copy link</button>'), fips + ": Print (the shared sheet until the script runs), Save picture, Copy link");
    assert.ok(h.includes(`<script defer src="/components/county-print.js?v=${v}"></script>`), fips + ": the script, at its hash");
    const m = h.match(/<script type="application\/json" id="cp-data">([^<]*)<\/script>/);
    assert.ok(m, fips + ": the figures");
    JSON.parse(m[1]);
    maxCp = Math.max(maxCp, Buffer.byteLength(m[1]));
    assert.equal((h.match(/>Copy link</g) || []).length, 1, fips + ": one Copy link on the page");
    assert.doesNotMatch(m[1], /n\/a|null/, fips + ": a missing figure is left out, never n/a");
    n++;
  }
  assert.ok(n >= 3000, n + " county pages");
  // the locator: one small file a state, with every county of it, ours among them
  for (const st of [...new Set(INDEX.map((r) => r[1].slice(-2)))]) {
    const p = `farmland-atlas/loc/${st.toLowerCase()}.json`;
    assert.ok(existsSync(join(ROOT, p)), p);
    const L = J(p), sz = statSync(join(ROOT, p)).size;
    assert.match(L.vb, /^0 0 \d+ \d+$/);
    assert.ok(sz < 60000, `${p}: ${sz} bytes`);
    for (const r of INDEX.filter((x) => x[1].slice(-2) === st).slice(0, 3)) assert.ok(L.p[r[0]], `${p} has ${r[0]}`);
  }
  assert.ok(maxCp <= 700, `the figures stay a few hundred bytes a page (largest ${maxCp})`);
});

test("every yearly figure on the sheet is one the page prints; the chart is the page's yields and yearly trend", () => {
  const picks = ["19169", "36061", "55005", "17019"].concat(INDEX.filter((_, i) => i % 97 === 0).map((r) => r[0]));
  let rows = 0;
  for (const fips of picks) {
    if (!row(fips)) continue;
    const h = page(fips), cp = cpData(h), s = CP.sheet(cp, {}, ctxOf(h, fips)), vis = visible(h), have = new Set(nums(vis));
    for (const b of s.blocks) for (const r of b.rows) {
      rows++;
      for (const x of nums((r.big || "") + " " + r.text)) assert.ok(have.has(x), `${fips} ${b.key}: ${x} ("${r.text}") is not a figure the page prints`);
    }
    assert.doesNotMatch(sheetText(s), /n\/a|undefined|NaN|null/, fips + ": nothing missing is printed");
    const Y = (J(`data/atlas/counties/${fips}.json`).yield) || {};
    if (cp.y) {
      const hist = Object.fromEntries(Object.entries(Y.hist || {}).filter(([, v]) => v != null));
      const m = CP.chartModel(cp);
      assert.deepEqual(m.pts.map((p) => [String(p.yr), p.s]), Object.keys(hist).sort().map((k) => [k, (Math.round(hist[k] * 10 + 1e-9) / 10).toFixed(1)]), fips + ": the page's own yields");
      if (cp.ys) {
        assert.ok(vis.includes(`Trend, ${cp.ys[2]} ${cp.ys[1]} bu/ac a year`), fips + ": the trend the page states");
        // the line is the least-squares line of the plotted years (its slope through their middle)
        const xs = m.pts.map((p) => p.yr), ys = m.pts.map((p) => p.v), mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length;
        const sl = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / xs.reduce((a, x) => a + (x - mx) ** 2, 0);
        assert.ok(Math.abs(sl - m.trend.slope) < 0.002, `${fips}: slope ${m.trend.slope} is the fit of the bars (${sl.toFixed(4)})`);
      }
    }
  }
  assert.ok(rows > 40, rows + " rows checked");
  // Story County: the six blocks in order, the land, rent and crops figures as the tiles print them
  const h = page("19169"), s = CP.sheet(cpData(h), {}, ctxOf(h, "19169"));
  const keys = s.blocks.map((b) => b.key), Q = { rent: "What does land rent for?", sold: "What has sold?", earn: "What can farming here earn?", risk: "What could disrupt that income?" };
  assert.deepEqual(keys, ["rent", "sold", "earn", "risk"].filter((k) => keys.includes(k)), "the four questions, in order");
  for (const b of s.blocks) assert.equal(b.h, Q[b.key]);
  assert.ok(keys.includes("rent") && keys.includes("sold") && keys.includes("earn"), "a farm county answers rent, sales and earnings");
  assert.ok(!s.blocks.find((b) => b.key === "earn").rows.some((r) => r.live), "no daily rows given: no bid row, not n/a");
  const sold = s.blocks.find((b) => b.key === "sold").rows;
  assert.ok(sold.some((r) => r.head === "Value estimates, not sales"), "estimates sit apart from transfers, labelled");
  assert.match(sold[0].text, /recorded transfer/, "the first answer to what has sold is the recorded transfers (or that there are none)");
  for (const b of s.blocks) for (const r of b.rows) if (!r.head && r.big) assert.ok(r.src && /\d{4}/.test(r.src), `${b.key}: "${r.text}" carries its source and period`);
  assert.equal(s.title, "Story County, Iowa: County Print, November 7, 2026");
  assert.equal(s.qr, canon(h) + "?asof=2026-11-07&utm_source=print&utm_medium=qr&utm_campaign=county-19169", "the QR code dates the sheet");
  assert.match(s.made, /^Made November 7, 2026 from data as of /);
});

test("the daily rows are the rows county-home.js drew; a short-list bid and a missing row are left out; no field name", () => {
  const h = page("19169"), c = ctxOf(h, "19169");
  const live = {
    "corn-bid": { label: "Corn bid", value: "$4.12", date: "2026-11-06", ctx: "8 mi from your field “Home 80”, December delivery. Best of 23 within 50 mi. Nearest: $4.05 at 2 mi.", paper: "Posted elevator bids" },
    "soy-bid": { label: "Soybean bid", value: "$10.80", date: "2026-11-06", ctx: "3 mi from the county middle. From the short list.", partial: true, paper: "Posted elevator bids, short list" },
    "corn-basis": { value: "38¢ under Dec '26", date: "2026-11-07", ctx: "Iowa bids: median of 362 elevators. USDA Iowa region: 16¢ weaker than its 5-year normal for the week of Oct 30.", paper: "Posted elevator bids; USDA AgTransport" },
    rain: { value: "37.90 in", date: "2026-11-05", ctx: "128% of the 1991–2020 normal (29.60 in) for the same days. November so far: 0.20 in.", paper: "NOAA daily station record" },
    drought: { value: null, why: "no row" },
  };
  const s = CP.sheet(cpData(h), live, c), g = s.blocks.find((b) => b.key === "earn"), w = s.blocks.find((b) => b.key === "risk");
  const lr = g.rows.filter((r) => r.live);
  assert.deepEqual(lr.map((r) => r.big), ["$4.12", "38¢ under Dec '26"], "the page's own values; the short-list soybean bid is left out");
  assert.equal(lr[0].text, "Best corn bid within 50 mi. 8 mi from your saved field, December delivery. Best of 23 within 50 mi.");
  assert.equal(lr[0].src, "Posted elevator bids, Nov 6, 2026");
  const yt = cpData(h).yt, gross = g.rows.find((r) => /^Rough gross/.test(r.text || ""));
  if (yt) assert.equal(gross.text, `Rough gross: ${yt[0]} bu trend × $4.12 best bid = about $${(Math.round(+yt[0] * 4.12 / 5) * 5).toLocaleString("en-US")} an acre, before any cost. Not an appraisal.`);
  assert.equal(w.rows[0].text, "Rain since Jan 1. 128% of the 1991–2020 normal (29.60 in) for the same days.", "a decimal never splits a sentence");
  assert.ok(!w.rows.some((r) => /Drought/.test(r.text)), "a row that did not load is left out");
  assert.doesNotMatch(sheetText(s), /Home 80|your field “/, "the reader's field name never prints");
  assert.match(s.src, /Posted elevator bids; USDA AgTransport; NOAA daily station record/);
  assert.match(s.src, /This product uses the NASS API but is not endorsed or certified by NASS\./, "the NASS notice where NASS figures show");
  assert.deepEqual(s.big4.map((b) => b.key), ["rent", "sold", "earn", "bid"], "the summary row: rent, a land value, corn, today's corn bid");
  assert.equal(CP.sheet(cpData(h), {}, c).big4.length, 4, "no bid today: the loss ratio stands in");
  // county-home.js keeps each row as drawn and announces it; the sheet reads only that
  const H = read("components/county-home.js");
  assert.match(H, /var FACTS = window\.AgCountyFacts = window\.AgCountyFacts \|\| \{\};\s*function fill\(k, f\) \{\s*FACTS\[k\] = f;/);
  assert.match(H, /new CustomEvent\('county:fact'/);
  assert.match(JS, /root\.AgCountyFacts \|\| \{\}/);
});

test("the QR code reads back to the county page with the print tags", (t) => {
  const jsQR = jsqr();
  if (!jsQR) return t.skip("jsqr is not installed (npm i jsqr@1.4.0, or set JSQR_PATH)");
  for (const fips of ["19169", "36061", "19155"]) {   // Story; New York County; Pottawattamie, a long name
    if (!row(fips)) continue;
    const h = page(fips), s = CP.sheet(cpData(h), {}, ctxOf(h, fips));
    for (const u of [s.qr, s.pic]) {
      const m = Q.matrix(u, null, null, 10), k = 6, n = (m.length + 8) * k, px = new Uint8ClampedArray(n * n * 4).fill(255);
      m.forEach((r, y) => r.forEach((v, x) => {
        if (!v) return;
        for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) { const o = (((y + 4) * k + dy) * n + (x + 4) * k + dx) * 4; px[o] = px[o + 1] = px[o + 2] = 0; }
      }));
      const r = jsQR(px, n, n);
      assert.equal(r && r.data, u, fips + " reads back");
      assert.ok((m.length - 17) / 4 <= 8, `${fips}: version ${(m.length - 17) / 4}, small enough to scan at 1.25 in`);
    }
    assert.equal(s.qr, canon(h) + `?asof=2026-11-07&utm_source=print&utm_medium=qr&utm_campaign=county-${fips}`);
    assert.equal(s.pic, canon(h) + `?asof=2026-11-07&utm_source=share&utm_medium=picture&utm_campaign=county-${fips}`);
  }
});

test("copy rules: no em dash, the source line 8.5 pt, black and white with the dark gold", () => {
  assert.doesNotMatch(JS + CSS, /—/, "no em dash");
  assert.match(CSS, /\.cprs-src\{font-size:8\.5pt/);
  assert.match(CSS, /#8a6514/);
  assert.doesNotMatch(CSS, /#d4a23f/, "never the screen gold on paper");
  assert.match(JS, /var QR_CAP = 'Scan for this county\u2019s live page'/);
});

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/") p = "/index.html"; else if (!extname(p)) p += ".html";
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}
const pdfPages = (buf) => (buf.toString("latin1").match(/\/Type\s*\/Page(?!s)/g) || []).length;

test("in a browser: one page on Letter and A4, full and sparse; Ctrl+P prints it; the picture; nothing moves", { skip, timeout: 240000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  const names = [...new Set((J("data/bids.json").bids || []).map((b) => String(b.facility || "").trim()).filter((x) => x.length >= 6))];
  try {
    for (const [fips, full] of [["19169", true], ["36061", false]]) {
      const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 900 }, timezoneId: "America/Chicago" });
      await ctx.route("**/*", (r) => (new URL(r.request().url()).host === `127.0.0.1:${port}` ? r.continue() : r.abort()));
      const pg = await ctx.newPage();
      await pg.goto(`http://127.0.0.1:${port}${row(fips)[2]}`);
      await pg.waitForFunction(() => [...document.querySelectorAll(".lv .r")].every((r) => r.textContent.trim()), null, { timeout: 60000 });
      await pg.waitForFunction(() => window.AgQR && window.AgCountyPrint && document.querySelector("#cprs .cprs-map svg path[fill='#000']"), null, { timeout: 20000 });
      // nothing on the page moves when the sheet is built (it sits hidden at the end of the body)
      const before = await pg.evaluate(() => [document.querySelector("main").getBoundingClientRect().height, document.documentElement.scrollHeight]);
      const info = await pg.evaluate(() => {
        const el = window.AgCountyPrint.build(), s = window.AgCountyPrint.last, F = window.AgCountyFacts || {};
        return { fit: el.dataset.fit, zoom: el.dataset.zoom || null, shown: getComputedStyle(el).display, text: el.innerText, title: s.title,
          qr: !!el.querySelector(".cprs-qr svg"), map: !!el.querySelector(".cprs-map svg"), src: getComputedStyle(el.querySelector(".cprs-src")).fontSize,
          live: Object.keys(F).filter((k) => F[k] && F[k].value != null && !F[k].partial && ["corn-bid", "soy-bid", "corn-basis", "soy-basis", "rain", "drought", "hail"].includes(k)).map((k) => F[k].value) };
      });
      const after = await pg.evaluate(() => [document.querySelector("main").getBoundingClientRect().height, document.documentElement.scrollHeight]);
      assert.deepEqual(after, before, fips + ": no layout shift");
      assert.equal(info.shown, "none", fips + ": hidden on screen");
      assert.equal(info.fit, "1", fips + ": fits without scaling");
      assert.match(info.title, /^.+, .+: County Print, (January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, 20\d\d$/);
      assert.ok(info.qr, fips + ": QR code");
      assert.match(info.text, /Scan for this county’s live page/);
      assert.match(info.text, /Not advice/);
      assert.equal(info.src, (8.5 * 96 / 72).toFixed(4).replace(/0+$/, "") + "px", "8.5 pt source line");
      for (const v of info.live) assert.ok(info.text.includes(v), `${fips}: the page's live value ${v} is on the sheet`);
      for (const nm of names) assert.ok(!info.text.includes(nm), `${fips}: no buyer name (${nm})`);
      assert.doesNotMatch(info.text, /\bn\/a\b|undefined|NaN/);
      if (full) for (const w of ["What does land rent for?", "What has sold?", "What can farming here earn?", "What could disrupt that income?", "High ", "Low "]) assert.ok(info.text.includes(w), fips + " shows " + w);
      assert.ok(info.map, fips + ": the state with the county marked");
      // one page on Letter and on A4, printed through any browser print (beforeprint)
      await pg.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
      assert.ok(await pg.evaluate(() => document.documentElement.classList.contains("cprs-on")), "Ctrl+P switches print to the sheet");
      await pg.emulateMedia({ media: "print" });
      for (const format of ["Letter", "A4"]) assert.equal(pdfPages(await pg.pdf({ format, printBackground: true })), 1, `${fips}: one ${format} page`);
      await pg.emulateMedia({ media: "screen" });
      await pg.evaluate(() => window.dispatchEvent(new Event("afterprint")));
      assert.ok(!(await pg.evaluate(() => document.documentElement.classList.contains("cprs-on"))));
      // the picture: 1080 x 1350, every word 20 px or more, the QR code to the county page
      const im = await pg.evaluate(async () => {
        await document.fonts.ready;
        const P = window.AgCountyPrint, s = P.current(), r = P.image(s, document, { qr: window.AgQR.matrix(s.pic, null, null, 10) });
        return { w: r.canvas.width, h: r.canvas.height, min: Math.min(...r.sizes), texts: r.texts };
      });
      assert.deepEqual([im.w, im.h], [1080, 1350]);
      assert.ok(im.min >= 20, "smallest word " + im.min + " px");
      assert.ok(im.texts.includes("agsist.com") && im.texts.includes("Scan for this county’s live page"));
      // Copy link: the county page with the share tags
      await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
      await pg.click("#cpr-link");
      assert.equal(await pg.evaluate(() => navigator.clipboard.readText()), await pg.evaluate((f) => document.querySelector('link[rel="canonical"]').href + `?asof=${window.AgCountyPrint.isoDay()}&utm_source=share&utm_medium=link&utm_campaign=county-${f}`, fips));
      await ctx.close();
    }
  } finally { await browser.close(); srv.close(); }
});
