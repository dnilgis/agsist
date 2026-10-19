/* The QR on every printed report (Oct 19, 2026): /comp-report, /field-report and the
 * /hail-map Hail History Report each print a code that opens the same report.
 *
 *   node --test test/print-qr.test.mjs
 *
 * The code is checked by reading what was handed to the QR encoder (the generator input),
 * not by an image decoder: in Chromium window.AgQR is wrapped before qr.js loads and every
 * text it is asked to draw is kept. jsQR, where installed, also reads long symbols back. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs, { readFileSync } from "node:fs";
import path, { join } from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const require = createRequire(import.meta.url);

function load() {
  const ctx = {}; ctx.window = ctx;
  vm.runInNewContext(read("components/qr.js"), ctx);
  ctx.AgReportLink = require(join(ROOT, "components/report-link.js"));
  vm.runInNewContext(read("components/print-qr.js"), ctx);
  return ctx;
}
const W = load(), Q = W.AgQR, PQ = W.AgPrintQR, RL = W.AgReportLink;
const FIELD = "45.29750,-91.70250~45.29750,-91.69750~45.30250,-91.69750~45.30250,-91.70250";
const longField = (n) => Array.from({ length: n }, (_, i) => (45.3 + i * 0.00013).toFixed(5) + "," + (-91.7 - (i % 7) * 0.00021).toFixed(5)).join("~");

// ---------------------------------------------------------------- the encoder
test("qr.js: without maxVer it still stops at version 10 and throws past it (callers that count on that are unchanged)", () => {
  assert.equal(Q.matrix("https://agsist.com/arc-plc/iowa/story").length, 29, "a county URL is still version 3");
  assert.throws(() => Q.matrix("x".repeat(300)), /version 10/);
  assert.throws(() => Q.svg("x".repeat(300)), /version 10/);
  assert.equal(Q.matrix("x".repeat(300), null, null, 40).length, 4 * 13 + 17, "300 letters fit version 13 at level M (331 at most)");
  assert.throws(() => Q.matrix("x".repeat(2400), null, null, 40), /version 40/);
});

test("qr.js: versions 11 to 40 read back with jsQR (where installed)", (t) => {
  let jsQR = null;
  for (const p of [process.env.JSQR_PATH, "jsqr"].filter(Boolean)) { try { jsQR = createRequire(import.meta.url)(p); break; } catch (e) { /* next */ } }
  if (!jsQR) return t.skip("jsqr is not installed (npm i jsqr@1.4.0, or set JSQR_PATH)");
  for (const n of [11, 20, 40, 60, 80]) {
    const u = "https://agsist.com/comp-report?f=" + encodeURIComponent(longField(n)) + "&fips=55005&r=25&from=2023-10-18&to=2026-10-18&amin=10&n=15&sort=mi";
    const m = Q.matrix(u, null, null, 40), s = 3, N = (m.length + 8) * s, px = new Uint8ClampedArray(N * N * 4).fill(255);
    m.forEach((row, y) => row.forEach((v, x) => {
      if (!v) return;
      for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) { const o = (((y + 4) * s + dy) * N + (x + 4) * s + dx) * 4; px[o] = px[o + 1] = px[o + 2] = 0; }
    }));
    const r = jsQR(px, N, N);
    assert.ok(r && r.data === u, `${n} points, version ${(m.length - 17) / 4}: read ${r && r.data && r.data.slice(0, 60)}`);
  }
});

// ---------------------------------------------------------------- the printed block
test("print-qr.js: 0.85 in up to version 15, grows to keep 0.01 in squares up to version 25, none past it", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(PQ.plan("https://agsist.com/hail-map?lat=42.0300&lon=-93.6200&mi=10"))), { ver: 4, inches: 0.85 });
  assert.equal(PQ.plan("x".repeat(412)).ver, 15);
  assert.equal(PQ.plan("x".repeat(412)).inches, 0.85);
  assert.equal(PQ.plan("x".repeat(413)).ver, 16);
  assert.equal(PQ.plan("x".repeat(413)).inches, 0.89);
  assert.equal(PQ.plan("x".repeat(997)).ver, 25);
  assert.equal(PQ.plan("x".repeat(997)).inches, 1.25);
  assert.equal(PQ.plan("x".repeat(998)), null);
  const h = PQ.html("https://agsist.com/comp-report?f=1&n=2", "agsist.com/comp-report");
  assert.match(h, /^<div class="agpq" data-qr="https:\/\/agsist\.com\/comp-report\?f=1&amp;n=2" data-url="https:\/\/agsist\.com\/comp-report\?f=1&amp;n=2" data-ver="\d+">/, "a link the short form cannot write keeps the full link");
  assert.match(h, /<svg style="width:0\.85in;height:0\.85in" class="qr"/);
  assert.match(h, /<p>Scan to open this report on agsist\.com<\/p><p class="agpq-u">agsist\.com\/comp-report<\/p>/);
  assert.doesNotMatch(PQ.html("x".repeat(998), "agsist.com/x"), /<svg/, "too long: no code, the address in words");
  assert.match(PQ.CSS, /^\.agpq\{display:none;/, "hidden on screen");
  assert.match(PQ.CSS, /@media print\{\.agpq\{display:block\}\}/, "shown in print");
  assert.doesNotMatch(read("components/print-qr.js") + read("components/qr.js") + read("components/report-link.js") + read("404.html").split("<!-- Short links")[1].split("</script>\n")[1], /—/, "no em dashes");
});

test("one QR encoder: the three report pages load components/qr.js (v=11) before print-qr.js and their own script", () => {
  for (const [page, own] of [["comp-report.html", "/components/comp-report.js?v="], ["field-report.html", "/components/field-report.js?v="], ["hail-map.html", "<script>"]]) {
    const h = read(page), a = h.indexOf('<script src="/components/qr.js?v=11" defer></script>'), r = h.indexOf('<script src="/components/report-link.js?v=2" defer></script>'), b = h.indexOf('<script src="/components/print-qr.js?v=1" defer></script>');
    assert.ok(a > 0 && r > a && b > r, page + " loads qr.js, report-link.js, then print-qr.js");
    if (own !== "<script>") assert.ok(h.indexOf(own) > b, page + " loads its own script after");
    assert.doesNotMatch(h, /qrcode-generator|farmland-atlas\/qr\.js|api\.qrserver|chart\.googleapis/, page + ": no second QR library or outside service");
  }
});

// ---------------------------------------------------------------- the short links (Sig, Oct 19: fewest squares)
const EX = {
  comp: "https://agsist.com/comp-report?f=" + encodeURIComponent(FIELD) + "&fips=55005&r=25&from=2023-10-19&to=2026-10-19&amin=10&n=15&sort=mi",
  compParcel: "https://agsist.com/comp-report?pid=036-0400-11-000&fips=55005&r=25&from=2023-10-19&to=2026-10-19&amin=10&n=15&sort=mi",
  land: "https://agsist.com/field-report?f=" + encodeURIComponent(FIELD),
  hailDay: "https://agsist.com/hail-map?lat=42.0300&lon=-93.6200&mi=10&day=2025-03-14",
  hail5y: "https://agsist.com/hail-map?lat=42.0300&lon=-93.6200&mi=25",
  here: "https://agsist.com/here?f=55005&z=54728",
};
const pathOf = (t) => t.slice("HTTPS://AGSIST.COM".length);
test("short links: exact text and the module count pinned for a real example of each report (full link in byte mode in brackets)", () => {
  const want = {
    comp: ["HTTPS://AGSIST.COM/C/P4529750-9170250+0+500+500+0+0-500K55005T26292", 33, 57],
    compParcel: ["HTTPS://AGSIST.COM/C/I036-0400-11-000*K55005T26292", 29, 45],
    land: ["HTTPS://AGSIST.COM/F/P4529750-9170250+0+500+500+0+0-500", 29, 45],
    hailDay: ["HTTPS://AGSIST.COM/S/42.03-93.62D25073", 25, 37],
    hail5y: ["HTTPS://AGSIST.COM/S/42.03-93.62R25", 25, 33],
    here: ["HTTPS://AGSIST.COM/H/55005/54728", 25, 29],
  };
  for (const k of Object.keys(EX)) {
    const t = PQ.text(EX[k]);
    assert.equal(t, want[k][0], k);
    assert.equal(Q.matrix(t, null, "mixed", 40).length, want[k][1], k + ": modules");
    assert.equal(Q.matrix(t, null, "alnum", 40).length, want[k][1], k + ": all of it alphanumeric");
    assert.equal(Q.matrix(EX[k], null, null, 40).length, want[k][2], k + ": the full link would be");
    assert.equal(RL.full(pathOf(t)), EX[k], k + ": 404.html opens the exact report");
  }
});

test("short links: every setting goes and comes back; anything the short form cannot write keeps the full link", () => {
  const CR = require(join(ROOT, "components/comp-report.js"));
  assert.deepEqual([RL.DEF.r, RL.DEF.amin, RL.DEF.n, RL.DEF.years].map(String), [CR.DEF.r, CR.DEF.amin, CR.DEF.n, CR.DEF.years].map(String), "defaults agree with the comp report");
  const many = "https://agsist.com/comp-report?lat=40.12000&lon=-88.20000&at=town&pid=17-24-09-376-015&fips=17019&r=40&from=any&to=2026-10-18&amin=any&amax=80&cls=4,5M&all=1&n=30&sort=date";
  for (const u of [many, "https://agsist.com/comp-report?lat=40.12000&lon=-88.20000&r=12.5&from=2021-02-28&to=2024-02-29&amin=0&n=15&sort=mi",
    "https://agsist.com/field-report?f=" + encodeURIComponent(longField(30)) + "&cf=" + encodeURIComponent("mi:25,ac:10,s:2023-10-19,c:4.5M,a:1"),
    "https://agsist.com/hail-map?lat=-12.5000&lon=130.1234&mi=5"]) {
    const t = RL.short(u);
    assert.ok(t && /^HTTPS:\/\/AGSIST\.COM\/[CFSH]\/[0-9A-Z+\-.*:\/]+$/.test(t), u + " -> " + t);
    assert.equal(RL.full(pathOf(t)), u, "back: " + t);
    assert.equal(RL.full(pathOf(t).toLowerCase() + "?fbclid=abc"), u, "lower case and an app's extra parameter still open it");
    assert.equal(RL.full("https://agsist.com" + pathOf(t)), u, "the whole address reads the same");
  }
  // every comp setting, through the page's own reader
  const P = CR.parseParams(many.slice(many.indexOf("?")), "2026-10-18"), t = RL.short(CR.reportUrl(P));
  assert.equal(CR.toQuery(CR.parseParams(RL.full(pathOf(t)).split("?")[1], "2027-05-01")), CR.toQuery(P));
  for (const d of ["2024-01-01", "2024-02-29", "2024-12-31", "2025-03-14", "2099-12-31"]) {
    const h = "https://agsist.com/hail-map?lat=42.0300&lon=-93.6200&mi=10&day=" + d;
    assert.equal(RL.full(pathOf(RL.short(h))), h, "day of the year both ways: " + d);
  }
  for (const u of ["https://agsist.com/comp-report?pid=abc 1&fips=55005&r=25&from=2023-10-19&to=2026-10-19&amin=10&n=15&sort=mi",
    "https://agsist.com/comp-report?lat=40.12&lon=-88.2&r=25&from=2023-10-19&to=2026-10-19&amin=10&n=15&sort=mi",
    "https://agsist.com/comp-report?lat=40.12000&lon=-88.20000&r=25&from=1999-10-19&to=2026-10-19&amin=10&n=15&sort=mi",
    "https://agsist.com/field-report?f=" + encodeURIComponent(FIELD) + "&cf=" + encodeURIComponent("c:4.5m"),
    "https://agsist.com/rain-print?d=x"]) assert.equal(RL.short(u), null, u);
  for (const bad of ["/C/junk", "/S/42.03", "/S/42.03-93.62D25400", "/H/5500/54728", "/X/1", "/c", "/cash-bids/iowa", "/r", ""]) assert.equal(RL.full(bad), null, bad);
  // 404.html: the route runs first in <head>, before the theme script and analytics, and stops the page
  const h = read("404.html"), r = h.indexOf('<script src="/components/report-link.js?v=2"></script>');
  assert.ok(r > 0 && r < h.indexOf("agsist-theme-early") && r < h.indexOf("gtag"), "route before anything else runs");
  assert.match(h, /if\(u&&u\.indexOf\('https:\/\/agsist\.com\/'\)===0\)\{if\(window\.stop\)window\.stop\(\);location\.replace\(u\.slice\(18\)\);\}/, "opens on this site only, the 404 page stopped");
  for (const k of "CFSH") assert.ok(!fs.existsSync(join(ROOT, k)) && !fs.existsSync(join(ROOT, k + ".html")) && !fs.existsSync(join(ROOT, k.toLowerCase())), k + "/ is not a real page or folder, so it reaches 404.html");
});

// ---------------------------------------------------------------- the links
test("comp report: the QR address is the site's own link for this report and reads back to the same settings", () => {
  const CR = require(join(ROOT, "components/comp-report.js"));
  const TODAY = "2026-10-18";
  for (const q of ["?f=" + encodeURIComponent(FIELD) + "&fips=55005", "?lat=40.12&lon=-88.2&at=town&r=40&from=any&amin=any&cls=4,5M&all=1&n=30&sort=date", "?pid=036-0400-11-000&fips=55005&from=2024-01-31&to=2025-06-01&amax=80"]) {
    const P = CR.parseParams(q, TODAY), u = CR.reportUrl(P);
    assert.ok(u.startsWith("https://agsist.com/comp-report?"), u);
    const P2 = CR.parseParams(u.slice(u.indexOf("?")), "2027-05-01");
    for (const k of ["r", "from", "to", "amin", "amax", "cls", "all", "n", "sort", "pid", "fips"]) assert.deepEqual(P2[k], P[k], q + " " + k);
    assert.deepEqual(P2.subject.kind, P.subject.kind);
    assert.equal(CR.reportUrl(P2), u, "the link is a fixed point: reading it and writing it again gives the same address");
    assert.doesNotMatch(u, /owner|name=/i, "no names in the link");
  }
  const js = read("components/comp-report.js");
  assert.match(js, /set\('cr-pq', G\.AgPrintQR\.html\(CR\.reportUrl\(P\), 'agsist\.com\/comp-report'\)\)/);
  assert.match(read("comp-report.html"), /<div class="cr-top"><div><h1 id="cr-h">[\s\S]*?<\/div><div id="cr-pq"><\/div><\/div>/, "top right of page 1");
});

test("field report: the QR address is this page's link with the outline and the Field Scout filters", () => {
  const { reportUrl } = require(join(ROOT, "components/field-report.js"));
  const f = encodeURIComponent(FIELD);
  assert.equal(reportUrl("?f=" + f, ""), "https://agsist.com/field-report?f=" + f);
  assert.equal(reportUrl("?f=" + f + "&cf=r25.a10", ""), "https://agsist.com/field-report?f=" + f + "&cf=r25.a10");
  assert.equal(reportUrl("?utm_source=x&f=" + f, ""), "https://agsist.com/field-report?f=" + f, "only what makes the report");
  assert.equal(reportUrl("", "#f=" + FIELD), "https://agsist.com/field-report?f=" + FIELD, "a #f= link reads the same");
  assert.equal(reportUrl("", ""), null);
  assert.match(read("components/field-report.js"), /set\('frp-pq', window\.AgPrintQR\.html\(reportUrl\(location\.search, location\.hash\), 'agsist\.com\/field-report'\)\)/);
  assert.match(read("field-report.html"), /<div class="frp-top"><div><h1 id="frp-h">[\s\S]*?<\/div><div id="frp-pq"><\/div><\/div>/);
});

test("hail map: the report link carries the spot, the radius and the date of loss, and the page reads them back", () => {
  const h = read("hail-map.html");
  const fn = /function reportLink\(L,origin\)\{[\s\S]*?\n    \}/.exec(h);
  assert.ok(fn, "reportLink");
  const mk = (mi) => vm.runInNewContext("var lookupMi=" + mi + ";" + fn[0] + ";reportLink");
  assert.equal(mk(25)({ lat: 42.03, lon: -93.62, day: "2026-06-14" }), "https://agsist.com/hail-map?lat=42.0300&lon=-93.6200&mi=25&day=2026-06-14");
  assert.equal(mk(10)({ lat: 42.03, lon: -93.62, day: "" }), "https://agsist.com/hail-map?lat=42.0300&lon=-93.6200&mi=10");
  assert.match(h, /var qmi=\+qp\.get\('mi'\); if\(\[5,10,25\]\.indexOf\(qmi\)>=0\) lookupMi=qmi;/);
  assert.match(h, /lookupDay=qday;/);
  assert.match(h, /var u=reportLink\(lastLookup,location\.origin\);/, "Copy link gives the same report link");
  assert.match(h, /var qrUrl=reportLink\(L\), qr='';/);
  for (const v of [5, 10, 25]) assert.match(h, new RegExp('data-lr="' + v + '"'), "radius chip " + v);
});

// ---------------------------------------------------------------- in a browser
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (fs.existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !fs.existsSync(CHROME) ? "Playwright or Chromium not found here" : false;
function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (!path.extname(p) && fs.existsSync(path.join(ROOT, p + ".html"))) p += ".html";   // GitHub Pages serves /comp-report as comp-report.html
    const f = path.normalize(path.join(ROOT, p));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404, { "content-type": "text/html" }); res.end(fs.readFileSync(join(ROOT, "404.html"))); return; }
    res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" });
    res.end(fs.readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}
/* every text handed to the QR encoder, kept on window.__qrIn (the generator input), with its mode */
const TAP = `(() => { let v; window.__qrIn = []; Object.defineProperty(window, "AgQR", { configurable: true, get: () => v, set: (q) => {
  v = { matrix: q.matrix, svg: function (t, l, mv, mode) { window.__qrIn.push(String(t) + " " + mode); return q.svg.apply(null, arguments); } }; } }); })();`;
async function open(browser, port, url) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(TAP);
  const pg = await ctx.newPage();
  const errs = [];
  pg.on("pageerror", (e) => errs.push(String(e)));
  await ctx.route("**/*", (r) => (r.request().url().startsWith(`http://127.0.0.1:${port}`) ? r.continue() : r.abort()));
  await pg.goto(`http://127.0.0.1:${port}${url}`, { waitUntil: "load" });
  return { pg, ctx, errs };
}
/* the encoder was handed the short link (in mixed mode); 404.html turns it back into the page's own address */
async function checkBlock(pg, want) {
  const got = await pg.evaluate(() => ({ inn: window.__qrIn, data: [...document.querySelectorAll(".agpq")].map((e) => [e.getAttribute("data-qr"), e.getAttribute("data-url")]), svg: !!document.querySelector(".agpq svg") }));
  const t = RL.short(want);
  assert.ok(t, "a short link for " + want);
  assert.deepEqual(got.inn, [t + " mixed"], "what the encoder drew");
  assert.deepEqual(got.data, [[t, want]]);
  assert.equal(RL.full(pathOf(t)), want, "the short link reads back to this page's address");
  assert.ok(got.svg);
  assert.match(await pg.textContent(".agpq"), /Scan to open this report on agsist\.com/);
  return t;
}
/* open the short link the way a phone does and see where it lands */
async function viaQ(browser, port, t, landPath) {
  const ctx = await browser.newContext({ serviceWorkers: "block" });
  const seen = [];
  await ctx.route("**/*", (r) => { seen.push(r.request().url()); return r.request().url().startsWith(`http://127.0.0.1:${port}`) ? r.continue() : r.abort(); });
  const pg = await ctx.newPage();
  const first = await pg.goto(`http://127.0.0.1:${port}` + pathOf(t));
  assert.equal(first.status(), 404, "served by 404.html, as GitHub Pages does");
  await pg.waitForURL((u) => u.pathname === landPath, { timeout: 10000 });
  const at = await pg.evaluate(() => "https://agsist.com" + location.pathname + location.search);
  const before = seen.slice(0, seen.findIndex((u) => new URL(u).pathname === landPath));
  assert.deepEqual(before.filter((u) => !u.startsWith(`http://127.0.0.1:${port}`)), [], "nothing leaves the site before the report opens (no analytics of the path)");
  assert.equal(new URL(before[0]).pathname, pathOf(t).split("?")[0]);
  assert.equal(new URL(before[1]).pathname, "/components/report-link.js", "the route script is the first thing the 404 page loads");
  await ctx.close();
  return at;
}

test("in Chromium: the comp report and land report print the QR of their own address, hidden on screen", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const cq = "?f=" + encodeURIComponent(FIELD) + "&fips=55005&r=25&from=2023-10-18&to=2026-10-18&amin=10&n=15&sort=mi";
    const fq = "?f=" + encodeURIComponent(FIELD) + "&cf=" + encodeURIComponent("mi:25,ac:10");
    for (const [p, q, want] of [["/comp-report", cq, "https://agsist.com/comp-report" + cq], ["/field-report", fq, "https://agsist.com/field-report" + fq]]) {
      const { pg, ctx, errs } = await open(browser, port, p + q);
      await pg.waitForSelector(".agpq", { state: "attached", timeout: 20000 });
      assert.equal(await pg.evaluate(() => "https://agsist.com" + location.pathname + location.search), want, "the page's own address");
      const t = await checkBlock(pg, want);
      assert.equal(await pg.isVisible(".agpq"), false, p + ": hidden on screen");
      await pg.emulateMedia({ media: "print" });
      assert.equal(await pg.isVisible(".agpq"), true, p + ": shown in print");
      const box = await pg.$eval(".agpq svg", (e) => { const r = e.getBoundingClientRect(); return { w: r.width, right: r.right, top: r.top }; });
      const h1 = await pg.$eval("h1", (e) => e.getBoundingClientRect().top);
      assert.ok(Math.abs(box.w - 0.85 * 96) < 1, p + " 0.85 in: " + box.w);
      assert.ok(box.top < h1 + 40, p + ": top of page 1, beside the title");
      assert.ok(box.right > 1280 * 0.6, p + ": on the right");
      assert.deepEqual(errs, []);
      await ctx.close();
      assert.equal(await viaQ(browser, port, t, p), want, p + ": the code opens this same report");
    }
  } finally { await browser.close(); srv.close(); }
});

test("in Chromium: the Hail History Report printout carries the QR of the spot, radius and date of loss, and that link reopens the same report", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const q = "?lat=42.0300&lon=-93.6200&mi=25&day=2025-06-14";
    const { pg, ctx, errs } = await open(browser, port, "/hail-map" + q);
    await pg.waitForFunction(() => document.querySelector("#hm-point") && !document.querySelector("#hm-point").hidden && /reports/.test(document.querySelector("#hm-point-stats").textContent) && !/checking/.test(document.querySelector("#hm-point-stats").textContent), null, { timeout: 40000 });
    assert.equal(await pg.$eval("#hm-lq-date", (e) => e.value), "2025-06-14", "the date of loss from the link");
    assert.equal(await pg.$eval('[data-lr="25"]', (e) => e.getAttribute("aria-pressed")), "true", "the radius from the link");
    await pg.evaluate(() => { window.print = () => {}; });
    const [pop] = await Promise.all([ctx.waitForEvent("page"), pg.click("#hm-point-print")]);
    await pop.evaluate(() => { window.print = () => {}; }).catch(() => {});
    await pop.waitForSelector(".agpq svg", { timeout: 10000 });
    const want = "https://agsist.com/hail-map" + q, t = RL.short(want);
    assert.equal(t, "HTTPS://AGSIST.COM/S/42.03-93.62R25D25165");
    assert.deepEqual(await pg.evaluate(() => window.__qrIn), [t + " mixed"], "what the encoder drew");
    assert.equal(await pop.$eval(".agpq", (e) => e.getAttribute("data-qr")), t);
    assert.equal(await pop.$eval(".agpq svg", (e) => e.getAttribute("viewBox")), "0 0 37 37", "29 x 29 modules and the margin (radius and a date: 41 letters, version 3)");
    assert.match(await pop.textContent(".agpq"), /Scan to open this report on agsist\.com\s*agsist\.com\/hail-map$/);
    assert.match(await pop.textContent("body"), /Radius: 25 miles/);
    assert.deepEqual(errs, []);
    await ctx.close();
    assert.equal(await viaQ(browser, port, t, "/hail-map"), want, "the code opens this same report");
  } finally { await browser.close(); srv.close(); }
});
