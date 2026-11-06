/* The printed "Funds this week" sheet on /cot (Nov 6 2026, Sig: shareable by default, "nicely printed PDFs",
 * "I have always loved a really well done infographic").
 *   1. The print stylesheet shows the sheet alone: no nav, footer, sponsor slots or buttons on paper; hidden on screen.
 *   2. Kit v2 (Nov 6): one short line per market (the big net, what funds bought or sold, one context line), the
 *      managed money and rank explained once, the year prominent, no "this week" or "today", no "Crowded" badge.
 *   3. A Playwright PDF of it is exactly 1 page on US Letter (and on A4), every word 11 pt or more, figures 20 pt+.
 * Wording checks use the frozen Oct 27 fixtures.
 *
 *   node --test test/cot-print.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const json = (p) => JSON.parse(read(p));
const G = require(path.join(ROOT, "components/cot-glance.js"));
const P = require(path.join(ROOT, "components/cot-print.js"));
const HTML = read("cot.html");
const CSS = read("components/cot-print.css");
const JS = read("components/cot-print.js");
const FX = { cot: json("test/fixtures/funds/cot-2026-10-27.json"), cx: json("test/fixtures/funds/cot-analysis-2026-10-27.json"),
  hist: json("test/fixtures/funds/cot-history-2026-10-27.json") };
const NOW = G.etInstant(FX.cot.next_release, "15:30") - 134.5 * 60000;
const SIX = ["corn", "beans", "wheat", "livecattle", "feedercattle", "leanhogs"];
const DASH = /[–—]|&mdash;|&ndash;/;

// ------------------------------------------------------------------ 1. the stylesheet and the page
test("cot.html: the Print this week button beside Save image (a 44 px .cc-btn), the stylesheet and scripts at their versions", () => {
  assert.match(HTML, /<button type="button" class="cc-btn" id="cc-save">Save image<\/button>\s*<button type="button" class="cc-btn" id="cc-print">Print this week<\/button>/);
  assert.match(HTML, /\.cc-btn\{[^}]*min-height:44px/);
  assert.ok(HTML.includes('<link rel="stylesheet" href="/components/cot-print.css?v=3">'));
  const i = (s) => HTML.indexOf(`<script src="/components/${s}"></script>`);
  assert.ok(i("cot-kit.js?v=1") > 0 && i("cot-kit.js?v=1") < i("cot-chart.js?v=8") && i("cot-chart.js?v=8") < i("qr.js?v=11") && i("qr.js?v=11") < i("cot-print.js?v=3"), "kit, chart, QR encoder, then the sheet");
  assert.match(read("components/cot-chart.js"), /dispatchEvent\(new CustomEvent\('cot:chart-data'/, "the chart hands its files over");
  assert.doesNotMatch(JS, /fetch\(|XMLHttpRequest/, "the sheet fetches nothing");
});

test("print stylesheet: hidden on screen; with html.cotp-on, everything but the sheet (nav, footer, sponsor slots, buttons) is hidden", () => {
  const scr = CSS.replace(/@media print\{[\s\S]*?\n\}/, "");
  assert.match(scr, /^\.cotp\{display:none\}$/m, "hidden on screen");
  const pr = CSS.match(/@media print\{([\s\S]*?)\n\}/)[1];
  assert.match(pr, /html\.cotp-on body>\*:not\(#cotp\)\{display:none!important\}/);
  assert.match(pr, /html\.cotp-on #cotp\{display:block!important\}/);
  assert.match(CSS, /\.cotp-m\{break-inside:avoid;page-break-inside:avoid/, "no page break inside a market");
  // a true black-and-white palette: the screen gold (2.3:1 on white) never on paper; the dark gold (5.3:1) as the accent
  assert.doesNotMatch(CSS.replace(/\/\*[\s\S]*?\*\//g, ""), /#d4a23f/i, "no #d4a23f on white");
  assert.match(CSS, /\.cotp\{--chart-1:#8a6514;/, "the net line in dark gold on paper");
  // any browser print gives the one-page sheet: beforeprint and matchMedia('print') set what the button sets
  assert.match(JS, /addEventListener\('beforeprint', on\)/);
  assert.match(JS, /matchMedia\('print'\)/);
  assert.doesNotMatch(CSS + JS, DASH);
});

// ------------------------------------------------------------------ 2. the words are the page's words
test("the sheet: one short line per market, the context line measured, the shared note, the year, no 'this week'", () => {
  const s = P.sheet(FX.cot, FX.cx, FX.hist, NOW);
  assert.deepEqual(s.markets.map((m) => m.key), SIX);
  assert.equal(s.title, "Funds, week to Oct 27, 2026");
  assert.equal(s.asOf, "Week to Tue, Oct 27, 2026. Released Fri, Oct 30, 2026.");
  assert.equal(s.lead, "Funds sold corn, soybeans, Chicago wheat and lean hogs and bought live cattle and feeder cattle in the week to Tuesday, Oct 27, 2026.");
  assert.equal(s.next, "Next report: Friday Nov 6, 3:30 PM ET.", "a date on paper, never today");
  assert.equal(P.nextLine(FX.cot, FX.cx, G.etInstant(FX.cot.next_release, "15:30") + 3600000), "A newer report was due Friday Nov 6, 3:30 PM ET. This sheet shows the one before it.");
  const by = Object.fromEntries(s.markets.map((m) => [m.key, m]));
  assert.equal(by.corn.context, "Sold 6 weeks in a row: 333,347", "a run, from the history");
  assert.equal(by.livecattle.context, "Rank: higher than 42% of weeks", "else the rank, its period in the shared note");
  assert.equal(by.leanhogs.record, "Largest net short in contracts since 2010", "a measured record instead of a Crowded badge");
  assert.equal(by.leanhogs.context, "", "one context line: the record");
  assert.equal(by.corn.record, "");
  const h = P.html(s, "");
  assert.ok(h.includes('<p class="cotp-tag">Largest net short in contracts since 2010</p>'));
  assert.ok(h.includes('<p class="cotp-fig"><b>81,113</b> <span class="cotp-side">net long</span></p><p class="cotp-chg">\u25bc Sold 83,310</p>'));
  assert.ok(h.includes('<p class="cotp-chg">\u25b2 Bought 5,471</p>'));
  assert.ok(h.includes("Rank: the net as a share of open interest, against every week since 2010."), "the rank explained once");
  assert.equal((h.replace(/<svg[\s\S]*?<\/svg>/g, "").match(/managed money/gi) || []).length, 2, "managed money named in the note and the source only");
  assert.ok(h.includes("<b>Corn funds cut their net long by 83,310 contracts.</b> Still net long: 81,113."), "the chart under its headline");
  assert.doesNotMatch(h, /Crowded|crowded|moderate|heavy|\bthis week\b|\btoday\b/, "no badge words, no weight words, no 'this week'");
  assert.doesNotMatch(h, DASH);
  assert.doesNotMatch(h, /\b(should|buy now|sell now|consider|recommend|signal|z-score|percentile)\b/i, "no advice, no method words");
  assert.ok(s.chart.svg.includes('stroke-dasharray="4 3"'), "the price line dashed on paper");
});

test("the QR code lands on the Funds this week signup box, and the line under it asks plainly (Sig, Nov 6)", () => {
  assert.equal(P.URL_FULL, "https://agsist.com/cot#cot-signup");
  assert.match(JS, /AgQR\.svg\(URL_FULL,/, "the QR encodes URL_FULL");
  assert.match(HTML, /id="cot-signup"/, "the box it lands on");
  const h = P.html(P.sheet(FX.cot, FX.cx, FX.hist, NOW), "<svg></svg>");
  assert.ok(h.includes('<div class="cotp-qr"><svg></svg></div><p class="cotp-free">Every Friday by email: <span class="cotp-big">agsist.com/cot</span></p>'));
});

test("a run counts the weeks in a row from the history", () => {
  const s = P.sheet(FX.cot, FX.cx, FX.hist, NOW);
  for (const m of s.markets) {
    // the run, counted here the long way
    const rows = FX.hist.history[m.key];
    let n = 0, tot = 0, sg = 0;
    for (let i = rows.length - 1; i > 0; i--) {
      const d = rows[i].net - rows[i - 1].net, x = Math.sign(d);
      if (!x || (sg && x !== sg)) break;
      sg = x; n++; tot += d;
    }
    if (n >= 3) { assert.equal(m.run.weeks, n, m.key); assert.equal(m.run.total, tot, m.key); }
    else assert.equal(m.run, null, m.key);
  }
  assert.equal(P.run("corn", FX.hist, { ...FX.cot, corn: { ...FX.cot.corn, net: FX.cot.corn.net + 1 } }), null, "no run when the history is not the report on the page");
});

// ------------------------------------------------------------------ 3. in a browser: one page
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (fs.existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !fs.existsSync(CHROME) ? "Playwright or Chromium not found here" : false;
const OWN = { "/data/cot.json": read("test/fixtures/funds/cot-2026-10-27.json"), "/data/cot-analysis.json": read("test/fixtures/funds/cot-analysis-2026-10-27.json"),
  "/data/cot-history.json": read("test/fixtures/funds/cot-history-2026-10-27.json") };
function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".svg": "image/svg+xml" };
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
const pages = (buf) => (buf.toString("latin1").match(/\/Type\s*\/Page(?![a-z])/g) || []).length;

test("Print this week: the sheet alone on paper, the page's sentences, 11 pt or more, and exactly 1 page on Letter and A4", { skip, timeout: 180000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1200, height: 900 } });
    const pg = await ctx.newPage();
    await pg.route("**/*", (r) => {
      const u = new URL(r.request().url());
      if (u.origin !== `http://127.0.0.1:${port}`) return r.abort();
      if (OWN[u.pathname]) return r.fulfill({ status: 200, contentType: "application/json", body: OWN[u.pathname] });
      return r.continue();
    });
    await pg.clock.setFixedTime(new Date(NOW));
    await pg.goto(`http://127.0.0.1:${port}/cot`, { waitUntil: "load" });
    await pg.waitForFunction(() => document.querySelector("#cotp .cotp-chart svg path"));
    // on screen: hidden, takes no room; the button is a 44 px target
    assert.equal(await pg.$eval("#cotp", (e) => getComputedStyle(e).display), "none");
    assert.ok((await pg.$eval("#cc-print", (b) => b.getBoundingClientRect().height)) >= 44);
    await pg.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed++; }; });
    await pg.click("#cc-print");
    assert.equal(await pg.evaluate(() => window.__printed), 1);
    assert.ok(await pg.evaluate(() => document.documentElement.classList.contains("cotp-on")));
    await pg.emulateMedia({ media: "print" });
    const vis = await pg.evaluate(() => {
      const shown = (e) => { for (let n = e; n && n.nodeType === 1; n = n.parentElement) if (getComputedStyle(n).display === "none") return false; return true; };
      const q = (s) => [...document.querySelectorAll(s)];
      return {
        nav: q("nav, header:not(.cotp-top), #site-header, #topnav").filter(shown).length,
        footer: q("footer, #site-footer").filter(shown).length,
        sponsor: q('[data-sponsor-link], #footer-adspace, [class*="sponsor"], [id*="sponsor"], a[href^="/sponsor"], [class*="ad-slot"]').filter(shown).length,
        buttons: q("button, .cc-btn, input, select").filter(shown).length,
        sheet: shown(document.getElementById("cotp")),
        lines: q("#cotp .cotp-m").map((p) => p.textContent.trim()),
        tiny: q("#cotp *").filter((e) => shown(e) && e.namespaceURI !== "http://www.w3.org/2000/svg" && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()))
          .filter((e) => parseFloat(getComputedStyle(e).fontSize) < 14.6).map((e) => e.className + ": " + e.textContent.slice(0, 40)),
        figs: q("#cotp .cotp-fig b").map((e) => parseFloat(getComputedStyle(e).fontSize)),
        svgText: Math.min(...q("#cotp .cotp-chart svg text").map((t) => t.getBoundingClientRect().height)),
        zoom: document.getElementById("cotp").dataset.zoom || "",
        qr: !!document.querySelector("#cotp .cotp-qr svg"),
        ask: (document.querySelector("#cotp .cotp-qr + .cotp-free") || {}).textContent || "",
      };
    });
    assert.ok(vis.sheet, "the sheet shows in print");
    assert.equal(vis.nav, 0, "no nav on paper"); assert.equal(vis.footer, 0, "no footer"); assert.equal(vis.sponsor, 0, "no sponsor slot"); assert.equal(vis.buttons, 0, "no buttons");
    assert.equal(vis.lines.length, 6, "six markets on the scoreboard");
    assert.ok(vis.lines.every((t) => t.length < 90), "one short block per market: " + vis.lines.join(" / "));
    assert.deepEqual(vis.tiny, [], "every word on the sheet 11 pt or more");
    assert.ok(vis.figs.length === 6 && vis.figs.every((f) => f >= 42.6), "scoreboard figures 32 pt or more, readable from 6 feet: " + vis.figs);
    assert.ok(vis.svgText >= 14, "chart labels print at about 11 pt: " + vis.svgText);
    assert.equal(vis.zoom, "", "the fixture week fits without scaling");
    assert.ok(vis.qr, "QR code from components/qr.js");
    assert.equal(vis.ask, "Every Friday by email: agsist.com/cot", "the Funds this week ask, right under the QR code");
    await pg.emulateMedia({ media: null });   // page.pdf prints with print media unless screen is emulated
    for (const format of ["Letter", "A4"]) {
      await pg.evaluate(() => document.documentElement.classList.add("cotp-on"));
      const buf = await pg.pdf({ format });
      assert.equal(pages(buf), 1, format + ": exactly 1 page");
      if (process.env.COT_PRINT_OUT && format === "Letter") fs.writeFileSync(process.env.COT_PRINT_OUT, buf);
    }
    await ctx.close();
  } finally { await browser.close(); srv.close(); }
});

test("any browser print (Ctrl+P, the menu) gives the one-page sheet, also on release day with the newest price not yet repaired", { skip, timeout: 180000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  // release day: the newest week has its close but no roll-repaired index yet (px_adj null), as on Nov 6, 2026
  const hist = JSON.parse(OWN["/data/cot-history.json"]);
  for (const k of Object.keys(hist.history)) { const r = hist.history[k].at(-1); if (r) r.px_adj = null; }
  const own = { ...OWN, "/data/cot-history.json": JSON.stringify(hist) };
  try {
    const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1200, height: 900 } });
    const pg = await ctx.newPage();
    await pg.route("**/*", (r) => {
      const u = new URL(r.request().url());
      if (u.origin !== `http://127.0.0.1:${port}`) return r.abort();
      if (own[u.pathname]) return r.fulfill({ status: 200, contentType: "application/json", body: own[u.pathname] });
      return r.continue();
    });
    await pg.clock.setFixedTime(new Date(NOW));
    await pg.goto(`http://127.0.0.1:${port}/cot`, { waitUntil: "load" });
    await pg.waitForFunction(() => document.querySelector("#cotp .cotp-chart svg path"));
    assert.ok(!(await pg.evaluate(() => document.documentElement.classList.contains("cotp-on"))), "off until a print starts");
    // the browser's own print: beforeprint sets the sheet state, afterprint clears it
    await pg.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
    assert.ok(await pg.evaluate(() => document.documentElement.classList.contains("cotp-on")), "beforeprint switches to the sheet");
    const svg = await pg.$eval("#cotp .cotp-chart svg", (e) => e.textContent);
    assert.match(svg, /\$4\.\d\d[¼½¾]?\/bu on Oct 20/, "the price label sits at the last repaired week, dated: " + svg);
    assert.doesNotMatch(await pg.$eval("#cotp", (e) => e.textContent), /No price line|some weeks have no futures close/, "no apology on paper");
    for (const format of ["Letter", "A4"]) assert.equal(pages(await pg.pdf({ format })), 1, format + ": exactly 1 page on release day");
    await pg.evaluate(() => window.dispatchEvent(new Event("afterprint")));
    assert.ok(!(await pg.evaluate(() => document.documentElement.classList.contains("cotp-on"))), "afterprint puts the page back");
    // print media without the button or the event (matchMedia('print') changes): the sheet again
    await pg.emulateMedia({ media: "print" });
    await pg.waitForFunction(() => document.documentElement.classList.contains("cotp-on"), null, { timeout: 3000 }).catch(() => {});
    const on = await pg.evaluate(() => document.documentElement.classList.contains("cotp-on"));
    const shown = await pg.evaluate(() => getComputedStyle(document.getElementById("cotp")).display);
    assert.ok(on && shown === "block", "print media alone shows the sheet: " + on + " " + shown);
    await ctx.close();
  } finally { await browser.close(); srv.close(); }
});
