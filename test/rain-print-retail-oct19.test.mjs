/* Rain Print retail fixes (2026-10-19, monetization board, Sig: "yeah fix please"):
 *   1. "Last year, by Christmas" beside "This year, in January": on the county
 *      rain pages (one promo block) and on the first screen of /rain-print,
 *      while a Christmas cutoff in data/rain-print.json is ahead;
 *   2. the gift box on the review sheet does not ask for the address Stripe takes;
 *   3. a second gift: "For someone else" keeps the town, year and style and clears the words;
 *   4. the wall picture keeps its honest "Mockup" label;
 *   5. the county month table fits a 390 px phone, "Vs usual" in view.
 * Browser cases need Playwright and Chromium; skipped where they are missing.
 *
 *   node --test test/rain-print-retail-oct19.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function yearDays(y) { const a = []; for (let t = Date.UTC(y, 0, 1); new Date(t).getUTCFullYear() === y; t += 864e5) a.push(new Date(t).toISOString().slice(0, 10)); return a; }
function series(y, upto) {
  const r = rng(7 + y);
  return yearDays(y).map((d, i) => {
    if (d > upto) return [d, "M", "M", "M", "M", "M"];
    const u = r(), p = u < 0.12 ? (r() * r() * 2).toFixed(2) : u < 0.16 ? "T" : "0.00";
    const t = Math.round(44 + 32 * Math.sin((i - 105) / 365 * 2 * Math.PI));
    return [d, p, String(t), "0.0", String(t + 9), String(t - 9)];
  });
}

/* Ames: the town at 42.0308,-93.6319, the station AMES 2 NNW about 2 mi off.
   geo: a function returning the status for the next town lookup (200 = found). */
async function mocks(ctx, st) {
  const h = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" };
  const upto = "2026-10-09";
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (r) => {
    const req = r.request(), u = new URL(req.url());
    if (u.host === "agsist-api.dnilgis.workers.dev") {
      if (req.method() === "OPTIONS") return r.fulfill({ status: 204, headers: h });
      return r.fulfill({ status: 503, headers: h, body: "x" });
    }
    if (u.host === "geocoding-api.open-meteo.com") {
      st.geoAsks++;
      if (st.geoFail > 0) { st.geoFail--; return r.fulfill({ status: 504, body: "gateway" }); }
      return r.fulfill({ json: { results: [{ name: "Ames", latitude: 42.0308, longitude: -93.6319, admin1: "Iowa", country_code: "US" }] } });
    }
    if (u.host === "data.rcc-acis.org") {
      if (u.pathname === "/StnMeta") return r.fulfill({ json: { meta: [{ name: "AMES 2 NNW", sids: ["130200 2"], ll: [-93.6431, 42.0597], valid_daterange: [["1950-01-01", upto]], state: "IA" }] } });
      let sdate = u.searchParams.get("sdate"), normal = false;
      if (u.searchParams.get("params")) { sdate = JSON.parse(u.searchParams.get("params")).sdate; normal = true; }
      if (normal) return r.fulfill({ json: { data: yearDays(+String(sdate).slice(0, 4)).map((d) => [d, "0.08"]) } });
      if (sdate === "por") { let data = []; for (let y = 1995; y <= 2025; y++) data = data.concat(series(y, upto).map((x) => x.slice(0, 3))); return r.fulfill({ json: { data } }); }
      return r.fulfill({ json: { meta: { name: "AMES 2 NNW", state: "IA", ll: [-93.6431, 42.0597] }, data: series(+String(sdate).slice(0, 4), upto) } });
    }
    return r.abort();
  });
}
function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".woff2": "font/woff2", ".html": "text/html", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };
  const srv = createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    let p = normalize(join(ROOT, decodeURIComponent(u.pathname)));
    if (!extname(p) && existsSync(p + ".html")) p += ".html";
    if (!p.startsWith(ROOT) || !existsSync(p)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(p)] || "application/octet-stream" });
    res.end(readFileSync(p));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

async function withPage(fn, opts = {}) {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const ctx = await browser.newContext({ viewport: { width: opts.width || 1280, height: opts.height || 900 }, serviceWorkers: "block", hasTouch: !!opts.phone, isMobile: !!opts.phone });
    await ctx.clock.setFixedTime(new Date(opts.time || "2026-10-17T17:00:00Z"));
    const st = { geoAsks: 0, geoFail: opts.geoFail || 0 };
    await mocks(ctx, st);
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await fn(page, `http://127.0.0.1:${port}`, errors, st);
  } finally { await browser.close(); srv.close(); }
}
const drawn = (page) => page.waitForFunction(() => document.querySelector("#rp-art svg") && !document.getElementById("rp-go").disabled && !document.getElementById("rp-art").getAttribute("aria-busy"), null, { timeout: 30000 });
const idle = (page) => page.waitForFunction(() => !document.getElementById("rp-go").disabled && !document.getElementById("rp-art").getAttribute("aria-busy"), null, { timeout: 30000 });


// ---------------------------------------------------------------- 5. the month table at 390 px

test("5: the county month table fits a 390 px phone (Boone County, IA: 'Vs usual' was cut off)", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, serviceWorkers: "block" });
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    const page = await ctx.newPage();
    for (const p of ["rain/iowa/boone-county", "rain/texas/bowie-county", "rain/wisconsin/barron-county"]) {
      await page.goto(`http://127.0.0.1:${port}/${p}`);
      const m = await page.$eval(".rc-scroll", (s) => {
        const th = [...s.querySelectorAll("thead th")].pop().getBoundingClientRect(), box = s.getBoundingClientRect();
        return { cw: s.clientWidth, sw: s.scrollWidth, lastRight: th.right, boxRight: box.right, head: s.querySelector("thead").textContent };
      });
      assert.ok(m.sw <= m.cw, `${p}: the month table scrolls sideways (${m.sw} > ${m.cw})`);
      assert.ok(m.lastRight <= m.boxRight + 0.5, `${p}: the last column is in view`);
      assert.match(m.head, /Vs usual$/, p);
    }
  } finally { await browser.close(); srv.close(); }
});

// ---------------------------------------------------------------- 1. last year, by Christmas

test("1: county pages offer last year by Christmas beside this year in January, in their one promo block", () => {
  const h = readFileSync(ROOT + "rain/iowa/boone-county.html", "utf8");
  const sell = h.split('class="rc-sell"')[1].split("</div>")[0];
  const J = JSON.parse(readFileSync(ROOT + "data/rain-print.json", "utf8"));
  const asOf = /As of (\w+ \d+, \d{4}), the latest day/.exec(h);
  // the shipped page carries the offer only while its as-of day is before the later cutoff
  if (asOf && new Date(asOf[1] + " 12:00 UTC").toISOString().slice(0, 10) <= [J.framed_christmas_cutoff, J.print_christmas_cutoff].sort()[1]) {
    assert.match(sell, /<a class="btn btn-primary" href="\/rain-print\?place=Boone%2C\+IA&amp;year=2025&amp;ll=[^"]+">Last year, by Christmas<\/a> <a class="btn btn-secondary" href="\/rain-print\?place=Boone%2C\+IA&amp;year=2026&amp;station=[^"]+">This year, in January<\/a>/);
    assert.ok(!/year=2025[^"]*station=/.test(sell), "last year's link names no station: Rain Print picks a good 2025 record");
    assert.ok(!/style=/.test(sell), "hand links: they open with the normals and the remarkable days on");
    assert.match(sell, /comes by Christmas if you order it framed by Dec 9, or as a print by Dec 10\. This year&rsquo;s \(2026\) is a gift card/);
  }
  assert.equal((h.match(/href="\/rain-print\?/g) || []).length, (sell.match(/href="\/rain-print\?/g) || []).length, "every Rain Print link is inside the one block");
  assert.equal((h.match(/class="rc-sell"/g) || []).length, 1, "one promo block");
});

test("1: last year's county link (no station, ll=) draws even when the town lookup fails", { skip }, async () => {
  await withPage(async (page, base, errors, st) => {
    await page.goto(base + "/rain-print.html?place=Ames%2C+IA&year=2025&ll=42.0597%2C-93.6431");
    await drawn(page);
    assert.ok(st.geoAsks > 0, "the town was looked up");
    assert.equal(await page.inputValue("#rp-year"), "2025");
    assert.equal(await page.$eval("#rp-normals", (b) => b.checked), true, "a hand link: normals on");
    assert.equal(await page.$eval("#rp-records", (b) => b.checked), true, "a hand link: remarkable days on");
    assert.deepEqual(errors, []);
  }, { geoFail: 99 });
});

test("1: /rain-print's first screen names both while the cutoffs are ahead; a drawn 2026 gets one tap to 2025", { skip }, async () => {
  await withPage(async (page, base, errors) => {
    await page.goto(base + "/rain-print.html?place=Ames%2C+IA&year=2026&station=130200+2&ll=42.0597%2C-93.6431");
    await drawn(page);
    await page.waitForFunction(() => !document.getElementById("rp-xmas-top").hidden, null, { timeout: 10000 });
    assert.equal(await page.textContent("#rp-xmas-top"), "For Christmas: this year (2026) is a gift card now, the print in January. Last year (2025) comes by Christmas if you order it framed by Dec 9, or as a print by Dec 10.");
    assert.equal(await page.isVisible("#rp-xmas-last"), true);
    assert.equal(await page.textContent("#rp-xmas-last"), "Make it 2025, by Christmas");
    const top = await page.$eval("#rp-xmas-last", (b) => b.getBoundingClientRect().top + scrollY);
    assert.ok(top < 900, "on the first screen: " + top);
    await page.click("#rp-xmas-last");
    await page.waitForFunction(() => document.getElementById("rp-year").value === "2025", null, { timeout: 10000 });
    await drawn(page);
    await page.waitForFunction(() => /^For Christmas: last year \(2025\), or any past year, comes by Christmas/.test(document.getElementById("rp-xmas-top").textContent), null, { timeout: 15000 });
    assert.equal(await page.isHidden("#rp-xmas-alt"), true, "no button once it is last year");
    assert.match(await page.textContent("#rp-sub-framed12x18"), /Order by Dec 9 for Christmas/);
    assert.deepEqual(errors, []);
  }, { time: "2026-10-19T17:00:00Z" });
  // after both cutoffs: the words as before, no button
  await withPage(async (page, base, errors) => {
    await page.goto(base + "/rain-print.html?place=Ames%2C+IA&year=2026&station=130200+2");
    await drawn(page);
    await page.waitForFunction(() => !document.getElementById("rp-xmas-top").hidden, null, { timeout: 10000 });
    assert.equal(await page.textContent("#rp-xmas-top"), "For Christmas: a gift card now, the print in January.");
    assert.equal(await page.isHidden("#rp-xmas-alt"), true);
    assert.deepEqual(errors, []);
  }, { time: "2026-12-11T17:00:00Z" });
});

// ---------------------------------------------------------------- 4. the wall picture stays labeled

test("4: the framed-on-the-wall picture is a mockup and says so, three ways, and nothing claims a photo of it", () => {
  const H = readFileSync(ROOT + "rain-print.html", "utf8");
  const fig = H.match(/<figure class="rp-onwall" id="rp-onwall">[\s\S]*?<\/figure>/)[0];
  assert.match(fig, /alt="Mockup: a framed Rain Print/, "the alt text");
  assert.match(fig, /<span class="rp-ex-tag" aria-hidden="true">Mockup<\/span>/, "the tag on the picture");
  assert.match(fig, /<figcaption>Mockup of a framed print\./, "the caption");
  assert.ok(!/photo of a customer|customer photo|real photo/i.test(fig), "no claim of a real photo");
});
