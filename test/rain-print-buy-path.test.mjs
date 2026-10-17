/* /rain-print in a real browser: the buying-path fixes before real orders
 * (2026-10-15), with NOAA, the town lookup and the subs worker answered here
 * from made-up data.
 *
 *   - a phone that draws and swipes on past step 1 is never pulled back up to
 *     the town box (the pinned copy's focus nudge trapped it at step 1);
 *   - a design that names its station but carries no ?ll= (Sig's
 *     ?d=...&maker=1 view of a county-link order) draws the same town line the
 *     buyer saw, when the town lookup finds another town of that name or none;
 *   - the product picked survives leaving and coming back, and a reload: the
 *     price says $45 everywhere for Print.
 *
 * Needs Playwright and Chromium; skipped where they are missing.
 *   node --test test/rain-print-buy-path.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import vm from "node:vm";

const ROOT = process.env.RP_ROOT || fileURLToPath(new URL("../", import.meta.url));
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

const ctxVm = { TextEncoder, TextDecoder, URLSearchParams, btoa, atob };
ctxVm.window = ctxVm;
vm.runInNewContext(readFileSync(ROOT + "components/rain-print.js", "utf8"), ctxVm);
const RP = ctxVm.RainPrint;

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function yearDays(y) { const a = []; for (let t = Date.UTC(y, 0, 1); new Date(t).getUTCFullYear() === y; t += 864e5) a.push(new Date(t).toISOString().slice(0, 10)); return a; }
function series(y) {
  const r = rng(7 + y);
  return yearDays(y).map((d, i) => {
    if (d > "2026-10-09") return [d, "M", "M", "M", "M", "M"];
    const u = r(), p = u < 0.12 ? (r() * r() * 2).toFixed(2) : u < 0.16 ? "T" : "0.00";
    const t = Math.round(44 + 32 * Math.sin((i - 105) / 365 * 2 * Math.PI));
    return [d, p, String(t), "0.0", String(t + 9), String(t - 9)];
  });
}
const CHETEK = { name: "CHETEK", sids: ["471667 2"], ll: [-91.65, 45.32], valid_daterange: [["1950-01-01", "2026-10-09"]], state: "WI" };
const RATHBUN = { name: "RATHBUN DAM", sids: ["136910 2"], ll: [-92.90, 40.82], valid_daterange: [["1950-01-01", "2026-10-09"]], state: "IA" };
const GEO = {
  chetek: [{ name: "Chetek", latitude: 45.3141, longitude: -91.651, admin1: "Wisconsin", country_code: "US" }],
  // another Rathbun, 300 km off (the lookup's first answer), and no Rathbun at all
  "rathbun-far": [{ name: "Rathbun", latitude: 43.0, longitude: -95.5, admin1: "Iowa", country_code: "US" }],
  "rathbun-none": [],
};

async function mocks(ctx, opts) {
  const h = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" };
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
    const u = new URL(r.request().url());
    if (opts.log) opts.log.push(u.host + u.pathname + "?" + u.search.slice(0, 160));
    if (u.host === "agsist-subs.dnilgis.workers.dev") {
      if (r.request().method() === "OPTIONS") return r.fulfill({ status: 204, headers: h });
      if (u.pathname === "/rp-short") return opts.shortFail ? r.fulfill({ status: 503, headers: h, body: "x" }) : r.fulfill({ status: 200, headers: h, json: { ok: true, id: "K7Q2M" } });
      if (u.pathname === "/form") return r.fulfill({ status: 200, headers: h, json: { ok: true } });
      return r.fulfill({ status: 503, headers: h, body: "x" });
    }
    if (u.host === "buy.stripe.com") return r.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><p>stripe</p>" });
    if (u.host === "geocoding-api.open-meteo.com") {
      const name = (u.searchParams.get("name") || "").toLowerCase();
      return r.fulfill({ json: { results: name === "rathbun" ? GEO[opts.rathbun || "rathbun-far"] : GEO.chetek } });
    }
    if (u.host === "data.rcc-acis.org") {
      const stn = opts.stn || CHETEK;
      if (u.pathname === "/StnMeta") return r.fulfill({ json: { meta: [stn] } });
      let sdate = u.searchParams.get("sdate"), normal = false;
      if (u.searchParams.get("params")) { sdate = JSON.parse(u.searchParams.get("params")).sdate; normal = true; }
      if (opts.failYear && String(sdate).startsWith(String(opts.failYear))) return r.fulfill({ status: 503, body: "<html>503</html>" });
      if (normal) return r.fulfill({ json: { data: yearDays(+String(sdate).slice(0, 4)).map((d) => [d, "0.08"]) } });
      if (sdate === "por") { let data = []; for (let y = 1995; y <= 2025; y++) data = data.concat(series(y).map((x) => x.slice(0, 3))); return r.fulfill({ json: { data } }); }
      return r.fulfill({ json: { meta: { name: stn.name, state: stn.state, ll: stn.ll }, data: series(+String(sdate).slice(0, 4)) } });
    }
    return r.abort();
  });
}
function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".woff2": "font/woff2", ".html": "text/html", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };
  const srv = createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    const p = normalize(join(ROOT, decodeURIComponent(u.pathname)));
    if (!p.startsWith(ROOT) || !existsSync(p)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(p)] || "application/octet-stream" });
    res.end(readFileSync(p));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}
async function withPage(fn, { width = 390, height = 844, ...opts } = {}) {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const ctx = await browser.newContext({ viewport: { width, height }, serviceWorkers: "block", hasTouch: width < 900, isMobile: false });
    await ctx.clock.setFixedTime(new Date("2026-10-15T17:00:00Z"));
    await mocks(ctx, opts);
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await fn(page, `http://127.0.0.1:${port}`, errors, ctx);
  } finally { await browser.close(); srv.close(); }
}
const idle = (page) => page.waitForFunction(() => document.querySelector("#rp-art svg") && !document.getElementById("rp-go").disabled && !document.getElementById("rp-art").getAttribute("aria-busy"), null, { timeout: 30000 });
const gauge = (page) => page.evaluate(() => { const t = document.querySelector("#rp-art svg")?.textContent || ""; const m = /Weather station:[^]*?(mi from [A-Za-z ]+|near [A-Za-z ]+)/.exec(t); return m ? m[0].trim() : "NO ART: " + document.getElementById("rp-status").textContent; });

test("a phone that draws its town and swipes on past step 1 stays where it scrolled", { skip }, async () => {
  await withPage(async (page, base, errors) => {
    await page.goto(base + "/rain-print.html");
    await idle(page);
    await page.fill("#rp-place", "Chetek, WI");
    await page.selectOption("#rp-year", "2025");
    await page.press("#rp-place", "Enter");
    await page.waitForTimeout(300);
    await idle(page);
    await page.waitForTimeout(400);
    // the keyboard is gone once the print is drawn (checked last, after the swipe)
    const held = await page.evaluate(() => document.activeElement && document.activeElement.id);
    // the worst case too: the town box still holds focus while the reader swipes on
    await page.evaluate(() => document.getElementById("rp-place").focus({ preventScroll: true }));
    for (const target of ["#rp-name", "#rp-m1mo", "#rp-pay"]) {
      const want = await page.$eval(target, (el) => Math.round(el.getBoundingClientRect().top + scrollY - innerHeight / 2));
      // a swipe: small steps from where the page is, so the pinned copy shows while the town box passes under it
      const from = await page.evaluate(() => scrollY);
      await page.mouse.move(195, 600);
      for (let y = from; y < want; y += 60) { await page.mouse.wheel(0, Math.min(60, want - y)); await page.waitForTimeout(30); }
      await page.waitForTimeout(700);
      const y = await page.evaluate(() => scrollY);
      assert.ok(Math.abs(y - want) < 40, `swiped to ${target} (${want}) and stayed, not pulled back up: scrollY ${y}`);
      assert.equal(await page.isVisible("#rp-strip"), true, "the pinned copy shows past the print");
    }
    assert.notEqual(held, "rp-place", "the town box let go of the keyboard after the draw");
    assert.deepEqual(errors, []);
  });
});

test("a county-link design with no ll= draws the town line the buyer saw, when the lookup finds another town of that name or none", { skip }, async () => {
  const code = RP.encodeCode({ place: "Rathbun, IA", station: "136910 2", year: 2025, style: "r1", cmp: "normal", name: "Test" });
  for (const rathbun of ["rathbun-far", "rathbun-none"]) await withPage(async (page, base, errors) => {
    await page.goto(base + "/rain-print.html?d=" + code + "&maker=1");
    await idle(page);
    await page.waitForTimeout(500);
    const line = await gauge(page);
    assert.equal(line, "Weather station: Rathbun Dam, IA, near Rathbun", rathbun + ": " + line);
    // the gift card's preview reads the same way
    const pv = await page.evaluate((c) => window.RainPrint.previewArt(c, { idPrefix: "tt" }).then((r) => { const d = document.createElement("div"); d.innerHTML = r.svg; return d.textContent; }, (e) => "ERR " + e.message), code);
    assert.match(pv, /Weather station: Rathbun Dam, IA, near Rathbun/, rathbun + " preview");
    assert.ok(!/\d+ mi from Rathbun/.test(pv), rathbun + " preview has no distance from the other Rathbun");
    assert.deepEqual(errors, []);
  }, { width: 1280, height: 900, stn: RATHBUN, rathbun });
  // the lookup finding the right Rathbun still gives the distance
  GEO["rathbun-near"] = [{ name: "Rathbun", latitude: 40.80, longitude: -92.88, admin1: "Iowa", country_code: "US" }];
  await withPage(async (page, base) => {
    await page.goto(base + "/rain-print.html?d=" + code + "&maker=1");
    await idle(page);
    assert.equal(await gauge(page), "Weather station: Rathbun Dam, IA, 1.7 mi from Rathbun");
  }, { width: 1280, height: 900, stn: RATHBUN, rathbun: "rathbun-near" });
});

test("Print picked, then away and back (and a reload): $45 everywhere, Print still picked", { skip }, async () => {
  await withPage(async (page, base, errors) => {
    await page.goto(base + "/rain-print.html");
    await idle(page);
    await page.fill("#rp-place", "Chetek, WI");
    await page.selectOption("#rp-year", "2025");
    await page.press("#rp-place", "Enter");
    await page.waitForTimeout(300);
    await idle(page);
    await page.locator('.rp-prod[data-choice="print12x18"]').click();
    await page.waitForTimeout(200);
    const check = async (when) => {
      await idle(page);
      await page.waitForTimeout(400);
      assert.equal(await page.$eval('input[name="rp-product"]:checked', (r) => r.value), "print12x18", when + ": Print picked");
      assert.match(await page.textContent("#rp-pay"), /\$45$/, when + ": the pay button");
      assert.match(await page.textContent("#rp-bar-what"), /\$45/, when + ": the phone bar");
      assert.ok(!/\$89/.test(await page.textContent("#rp-pay") + await page.textContent("#rp-bar-what")), when + ": no $89");
      assert.equal(await page.$eval("#rp-wall", (w) => w.getAttribute("data-view")), "print", when + ": the print at the top is the print alone");
    };
    await check("picked");
    await page.goto(base + "/about.html");
    await page.goBack();
    await check("back");
    await page.reload();
    await check("reload");
    // to the review sheet and Stripe, then Back
    await page.click("#rp-pay");
    await page.waitForTimeout(300);
    if (await page.isVisible("#rp-noname")) { await page.click("#rp-noname-go"); await page.waitForTimeout(300); }
    assert.equal(await page.$eval('input[name="rp-pproduct"]:checked', (r) => r.value), "print12x18", "the review sheet");
    await page.check("#rp-proof-ok");
    await Promise.all([page.waitForURL(/buy\.stripe\.com/), page.click("#rp-proof-order")]);
    await page.goBack();
    await check("back from Stripe");
    assert.deepEqual(errors, []);
  });
});

test("a redraw NOAA can't answer keeps the print that was up and says so; the same inputs ask nothing again", { skip }, async () => {
  const log = [];
  await withPage(async (page, base, errors) => {
    await page.goto(base + "/rain-print.html");
    await idle(page);
    await page.fill("#rp-place", "Chetek, WI");
    await page.selectOption("#rp-year", "2012");
    await page.press("#rp-place", "Enter");
    await page.waitForTimeout(300);
    await idle(page);
    await page.fill("#rp-name", "The Olson Place");
    await page.waitForTimeout(600);
    const before = await page.innerHTML("#rp-art");
    assert.match(before, /The Olson Place/);
    // 2011: NOAA answers 503
    await page.selectOption("#rp-year", "2011");
    await page.waitForTimeout(300);
    await idle(page);
    await page.waitForTimeout(300);
    assert.equal(await page.textContent("#rp-status"), "Couldn\u2019t draw 2011 just now (NOAA error 503). Your 2012 print is still here.");
    assert.equal(await page.isVisible("#rp-retry-row"), true, "Try again is there");
    const art = await page.innerHTML("#rp-art");
    assert.match(art, /The Olson Place/, "the print is still up");
    assert.match(art, /2012/);
    assert.equal(await page.$eval("#rp-pay", (b) => b.disabled), false);
    // back to 2012: the town and the station list come from memory, no new asks for them
    const n0 = log.length;
    await page.selectOption("#rp-year", "2012");
    await page.waitForTimeout(300);
    await idle(page);
    const asked = log.slice(n0);
    assert.ok(!asked.some((x) => /open-meteo|StnMeta/.test(x)), "no town lookup and no station list asked again: " + asked.join(" | "));
    // Draw again with nothing changed: nothing is asked at all
    const n1 = log.length;
    await page.click("#rp-go");
    await page.waitForTimeout(600);
    assert.deepEqual(log.slice(n1).filter((x) => !/workers\.dev/.test(x)), [], "nothing asked for the same print");
    assert.deepEqual(errors, []);
  }, { failYear: 2011, log });
});

test("typing a name redraws a few times, not once a letter, and the address bar is written after the typing stops", { skip }, async () => {
  await withPage(async (page, base, errors) => {
    await page.goto(base + "/rain-print.html?place=Chetek%2C+WI&year=2025&station=471667+2");
    await idle(page);
    await page.waitForTimeout(800);
    await page.evaluate(() => {
      window.__rs = 0; window.__draws = 0; window.__keys = [];
      const rs = history.replaceState.bind(history); history.replaceState = (...a) => { window.__rs++; return rs(...a); };
      new MutationObserver(() => window.__draws++).observe(document.getElementById("rp-art"), { childList: true });
      document.getElementById("rp-name").addEventListener("input", () => window.__keys.push(performance.now()), true);
    });
    await page.click("#rp-name");
    await page.keyboard.type("The Olson Family Farm", { delay: 40 });
    // wait for the page to settle instead of a fixed pause: a busy machine can take longer than 900 ms
    await page.waitForFunction(() => /name=The\+Olson\+Family\+Farm/.test(location.search) && /The Olson Family Farm/.test(document.getElementById("rp-art").innerHTML), null, { timeout: 15000 });
    await page.waitForTimeout(700);
    const [rs, draws, keys] = await page.evaluate(() => [window.__rs, window.__draws, window.__keys]);
    // A pause between letters longer than the debounce earns one redraw (150 ms) or one address write (400 ms).
    // On an idle machine there are none, so the bounds are the old ones: one draw, one write.
    // Under load a keystroke can stall; count the stalls that actually happened instead of assuming none.
    const gaps = (ms) => keys.slice(1).filter((t, i) => t - keys[i] > ms).length;
    assert.equal(keys.length, 21, "every letter typed");
    assert.ok(draws <= 2 + gaps(150), "21 letters, " + draws + " redraws, " + gaps(150) + " pauses over 150 ms");
    assert.ok(rs >= 1 && rs <= 1 + gaps(400), "the address written once the typing stopped: " + rs + " writes, " + gaps(400) + " pauses over 400 ms");
    assert.match(page.url(), /name=The\+Olson\+Family\+Farm/);
    assert.match(await page.innerHTML("#rp-art"), /The Olson Family Farm/);
    // straight to checkout after typing: the review sheet shows every letter
    await page.fill("#rp-name", "The Olson Family Farms");
    await page.click("#rp-pay");
    await page.waitForSelector("#rp-proof[open]");
    assert.match(await page.innerHTML("#rp-proof-art"), /The Olson Family Farms/);
    assert.deepEqual(errors, []);
  });
});

const CHETEK_OFF = { ...CHETEK, name: "CHETEK 2.6 NNW" };
async function drawChetek(page, base, place = "Chetek, WI") {
  await page.goto(base + "/rain-print.html");
  await idle(page);
  await page.fill("#rp-place", place);
  await page.selectOption("#rp-year", "2025");
  await page.press("#rp-place", "Enter");
  await page.waitForTimeout(300);
  await idle(page);
  await page.waitForTimeout(300);
}
async function openSheet(page) {
  await page.click("#rp-pay");
  await page.waitForTimeout(300);
  if (await page.isVisible("#rp-noname")) { await page.click("#rp-noname-go"); await page.waitForTimeout(300); }
  await page.waitForSelector("#rp-proof[open]");
  await page.waitForTimeout(200);
}

test("the review sheet keeps the tick and Pay on the bottom edge, on a phone and a laptop", { skip }, async () => {
  for (const [width, height] of [[390, 844], [1280, 720]]) await withPage(async (page, base, errors) => {
    await drawChetek(page, base);
    await page.fill("#rp-name", "The Olson Farm");
    await openSheet(page);
    for (const where of ["top", "bottom"]) {
      await page.evaluate((w) => { const d = document.getElementById("rp-proof"), p = document.querySelector(".rp-proof-panel"); for (const el of [d, p]) el.scrollTop = w === "top" ? 0 : el.scrollHeight; }, where);
      await page.waitForTimeout(200);
      const r = await page.evaluate(() => { const b = document.getElementById("rp-proof-order").getBoundingClientRect(), t = document.getElementById("rp-proof-ok").getBoundingClientRect(); return { b: [b.top, b.bottom], t: [t.top, t.bottom], h: innerHeight }; });
      assert.ok(r.b[0] >= 0 && r.b[1] <= r.h && r.t[0] >= 0 && r.t[1] <= r.h, `${width}, scrolled to the ${where}: tick and Pay on screen ${JSON.stringify(r)}`);
      assert.ok(r.b[1] > r.h - 140, `${width}: Pay sits at the bottom edge ${JSON.stringify(r)}`);
    }
    assert.deepEqual(errors, []);
  }, { width, height });
});

test("a station named for the buyer's own town: one distance, on the print, the source line and the review sheet", { skip }, async () => {
  await withPage(async (page, base, errors) => {
    await drawChetek(page, base);
    const art = await page.evaluate(() => document.querySelector("#rp-art svg").textContent);
    assert.match(art, /Weather station: Chetek, WI, [\d.]+ mi from Chetek/);
    assert.ok(!/NNW of Chetek/.test(art), "no second distance on the print");
    assert.match(await page.textContent("#rp-source"), /^Weather station: Chetek, WI, [\d.]+ mi from Chetek \(/);
    await openSheet(page);
    assert.match(await page.textContent("#rp-proof-sum"), /Weather stationChetek, WI, [\d.]+ mi from Chetek/);
    assert.ok(!/NNW of/.test(await page.textContent("#rp-proof-sum")));
    assert.deepEqual(errors, []);
  }, { stn: CHETEK_OFF });
});

test("a town and state typed with no comma draws, and the box says it the usual way", { skip }, async () => {
  await withPage(async (page, base, errors) => {
    await drawChetek(page, base, "Chetek WI");
    assert.equal(await page.inputValue("#rp-place"), "Chetek, WI");
    assert.match(await page.evaluate(() => document.querySelector("#rp-art svg").textContent), /Chetek, Wisconsin/);
    assert.deepEqual(errors, []);
  });
});

test("a name pasted past 24 letters is said in red, by the box and in the review sheet", { skip }, async () => {
  await withPage(async (page, base, errors) => {
    await drawChetek(page, base);
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.evaluate(() => navigator.clipboard.writeText("The Olson Family Farm and Ranch"));
    await page.focus("#rp-name");
    await page.keyboard.press("ControlOrMeta+V");
    await page.waitForTimeout(500);
    assert.equal(await page.inputValue("#rp-name"), "The Olson Family Farm an");
    assert.equal(await page.textContent("#rp-name-n"), "Only 24 letters fit, so what you pasted is cut to “The Olson Family Farm an”.");
    await openSheet(page);
    assert.match(await page.textContent("#rp-proof-sum"), /NameThe Olson Family Farm an \(cut off: only 24 letters fit, you typed “The Olson Family Farm and Ranch”\)/);
    assert.equal(await page.$$eval("#rp-proof-sum .rp-pcut", (e) => e.length), 1);
    assert.deepEqual(errors, []);
  });
});

test("the thank-you names the print only when it knows which one was paid for", { skip }, async () => {
  const code = RP.encodeCode({ place: "Chetek, WI", station: "471667 2", year: 2025, style: "r1", cmp: "normal", name: "Olson" });
  const press = (choice, t, place = "Chetek, WI") => ({ code, choice, place, year: 2025, gift: false, settle: false, t });
  const cases = [
    ["this tab's own press", { session: press("print12x18", 0) }, "print12x18", true],
    ["the one recent press in this browser", { presses: [press("print12x18", 0)] }, "print12x18", true],
    ["two recent presses, no tab press", { presses: [press("print12x18", 0), press("print12x18", 0, "Rice Lake, WI")] }, "print12x18", false],
    ["the saved product isn't the one paid", { session: press("framed12x18", 0) }, "print12x18", false],
  ];
  for (const [name, saved, paid, named] of cases) await withPage(async (page, base, errors) => {
    await page.goto(base + "/about.html");
    await page.evaluate((s) => {
      const now = Date.now(), fix = (x) => ({ ...x, t: now - 60000 });
      if (s.session) sessionStorage.setItem("agsist-rp-checkout", JSON.stringify(fix(s.session)));
      if (s.presses) localStorage.setItem("agsist-rp-presses", JSON.stringify(s.presses.map(fix)));
    }, saved);
    await page.goto(base + "/rain-print.html?paid=" + paid + "&s=cs_test_a1b2c3d4e5f6");
    await page.waitForSelector("#rp-paid:not([hidden])");
    await page.waitForTimeout(800);
    const txt = await page.textContent("#rp-paid");
    if (named) assert.match(txt, /Your 13 x 19 print of Chetek, WI, 2025 is ordered\./, name);
    else assert.ok(!/Your .* is ordered/.test(txt) && !/Rice Lake/.test(txt), name + ": " + txt);
    if (!named) assert.equal(await page.inputValue("#rp-place"), "", name + ": no design drawn under it");
    assert.deepEqual(errors, []);
  });
  // no way back from Stripe, the same design again within the hour: a word about the receipt
  await withPage(async (page, base, errors) => {
    await page.goto(base + "/about.html");
    await page.evaluate((c) => localStorage.setItem("agsist-rp-presses", JSON.stringify([{ code: c, choice: "print12x18", place: "Chetek, WI", year: 2025, t: Date.now() - 600000 }])), code);
    await page.goto(base + "/rain-print.html?d=" + code);
    await idle(page);
    await page.waitForTimeout(500);
    assert.equal(await page.textContent("#rp-paid-hint"), "Already paid? Check your email for the Stripe receipt.");
    assert.equal(await page.isVisible("#rp-paid-hint"), true);
    await page.fill("#rp-name", "Someone else");
    await page.waitForTimeout(500);
    assert.equal(await page.isVisible("#rp-paid-hint"), false, "another design: no word");
    assert.deepEqual(errors, []);
  });
});

test("an order request that went: \"Sent.\" stays, even when the form is opened again for the same design", { skip }, async () => {
  const LONG = { place: "Chetek, WI", station: "471667 2", year: 2025, style: "r1", cmp: "normal", name: "The Olson Family Farm",
    dedication: "For Grandpa Erling, sixty harvests on the home place. Love, all of us",
    markers: [{ date: "2025-05-08", label: "Planted beans" }, { date: "2025-07-04", label: "Hay all in" }, { date: "2025-10-24", label: "Harvest done" }] };
  await withPage(async (page, base, errors) => {
    await page.goto(base + "/rain-print.html?d=" + RP.encodeCode(LONG));
    await idle(page);
    await openSheet(page);
    await page.check("#rp-proof-ok");
    await page.click("#rp-proof-order");
    await page.waitForFunction(() => !document.getElementById("rp-order").hidden, null, { timeout: 15000 });
    await page.fill("#ro-name", "Ray"); await page.fill("#ro-email", "ray@example.com"); await page.fill("#ro-address", "123 Farm Rd, Chetek WI 54728");
    await page.click("#ro-submit");
    await page.waitForFunction(() => /^Sent\./.test(document.getElementById("ro-out").textContent), null, { timeout: 15000 });
    // Check it and pay again, the same design: the checkout can't open, the form comes back, and "Sent." is still there
    await page.click("#rp-pay");
    await page.waitForSelector("#rp-proof[open]");
    await page.check("#rp-proof-ok");
    await page.click("#rp-proof-order");
    await page.waitForFunction(() => !document.getElementById("rp-order").hidden, null, { timeout: 15000 });
    await page.waitForTimeout(300);
    assert.match(await page.textContent("#ro-out"), /^Sent\. I’ll email ray@example\.com/);
    assert.equal(await page.isVisible("#ro-out"), true);
    assert.deepEqual(errors, []);
  }, { shortFail: true });
});

test("Digital file picked: no shipping or Christmas-proof lines, the file's types and who it comes from", { skip }, async () => {
  await withPage(async (page, base, errors) => {
    await drawChetek(page, base);
    assert.equal(await page.isVisible("#rp-ships"), true, "a print says how it ships");
    assert.equal(await page.textContent("#rp-sub-digital"), "A PNG and a PDF by email within 1 business day of paying.", "the file's line says its types once prices are in");
    await page.locator('.rp-prod[data-choice="digital"]').click();
    await page.waitForTimeout(300);
    assert.equal(await page.isVisible("#rp-ships"), false);
    assert.equal(await page.isVisible("#rp-xmas-why"), false);
    assert.equal(await page.textContent("#rp-madeby"), "Made by Sig Lindquist in Chetek, Wisconsin. Your file comes from sig@farmers1st.com, your receipt from Stripe.");
    await page.fill("#rp-name", "Olson");
    await openSheet(page);
    const when = await page.textContent("#rp-proof-sum");
    assert.match(when, /WhenA PNG and a PDF by email within 1 business day of paying\. Made by Sig Lindquist in Chetek, Wisconsin\./);
    assert.ok(!/ship/i.test(when.slice(when.indexOf("When"))), "no shipping words for the file");
    assert.deepEqual(errors, []);
  }, { width: 1280, height: 900 });
});

test("this year's gift: a marked day past the preview says it is on the January print", { skip }, async () => {
  await withPage(async (page, base, errors) => {
    await page.goto(base + "/rain-print.html?" + new URLSearchParams({ place: "Chetek, WI", year: "2026", station: "471667 2", name: "Olson", m1: "2026-12-01 First snow", m2: "2026-05-08 Planted" }));
    await idle(page);
    await page.waitForTimeout(500);
    assert.match(await page.textContent("#rp-m1on"), /^On the January print: First snow, Dec 1\. The preview stops at Oct \d+\.$/);
    assert.equal(await page.textContent("#rp-m2on"), "On the print: Planted, May 8");
    assert.deepEqual(errors, []);
  }, { width: 1280, height: 900 });
});

test("small things: 24 px sample links, a vh height before every dvh one, the favicon comes with the page", { skip }, async () => {
  const H = readFileSync(ROOT + "rain-print.html", "utf8");
  for (const m of H.matchAll(/height:([^;{}]*)dvh([^;{}]*)/g)) {
    const before = H.slice(Math.max(0, m.index - 60), m.index);
    assert.match(before, /height:[^;{}]*\dvh[^;{}]*;$/, "a vh fallback right before " + m[0]);
  }
  assert.ok(!/<link rel="icon" type="image\/png"[^>]*href="\/img\//.test(H), "the PNG icons are in the page, so a replaceState never fetches one again");
  assert.match(H, /<link rel="icon" type="image\/png" sizes="32x32" href="data:image\/png;base64,/);
  await withPage(async (page, base) => {
    await page.goto(base + "/rain-print.html");
    await page.waitForTimeout(800);
    const hs = await page.$$eval(".rp-story", (a) => a.map((e) => e.getBoundingClientRect().height));
    assert.ok(hs.length >= 2 && hs.every((h) => h >= 24), "sample links at least 24 px tall: " + hs);
  });
});
