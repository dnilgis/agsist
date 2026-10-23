/* The rain gauge hook and the "auto" promo slot (Sig, Oct 23 2026: "make a good hook for people to sign up for
 * the rain gauge, first batch intro price ... make it sell itself somehow"). Honest only: no count, no deadline,
 * no countdown, no popup, never "founding", no accuracy claim.
 *   1. One hook, gauge_hook in data/rain-print.json: the promo lines, the line under /rain-print and the Next
 *      cards say it word for word. Oct 23, Sig: "something less dramatic or cringey": a plain, calm line.
 *   2. "auto": rain, weather, PRF, ARC/PLC and Fast Facts pages show Rain Print through Dec 24, nothing on
 *      Christmas Day, the gauge hook Dec 26 through May 31, then Rain Print again. Bids, markets and rent pages
 *      never take "auto"; their gift line ends Dec 9. One cross-promo a page.
 *   3. /rain-gauge: no sponsor links, the form above the fold on a phone, an honest confirmation and one unticked
 *      Daily offer after a signup. No new sender: the confirmation never says an email is on its way.
 *
 *   node --test test/gauge-hook.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const J = JSON.parse(read("data/rain-print.json"));
const pctx = {}; pctx.window = pctx;
vm.runInNewContext(read("components/rain-print-promo.js"), pctx);
const P = pctx.AgsistRainPromo;
const SEE = "See a year of rain at your place, drawn as a print for the wall.";
const HOOK = J.gauge_hook.line + " " + J.gauge_hook.link + ".";
const slots = (h) => (h.match(/data-rain-print-promo/g) || []).length;
const inMain = (h) => h.slice(h.indexOf("<main"), h.indexOf("</main>"));

test("the hook: one short line and a link label, plain and honest", () => {
  const h = P.gaugeHook(J);
  assert.ok(h && h.line === J.gauge_hook.line && h.link === J.gauge_hook.link);
  assert.ok(h.line.length <= 90 && h.link.length <= 60);
  for (const t of [h.line, h.link]) {
    assert.ok(!/[–—]|&mdash;/.test(t), "no dashes: " + t);
    assert.ok(!/founding|\bonly \d|\d+ (left|spots?|people|farmers)|spots? left|hurry|ends|deadline|limited|today only|last chance|!|\$\s?\d/i.test(t), "no fake scarcity or price: " + t);
    assert.ok(!/accura|precise|exact|within [\d.]+/i.test(t), "no accuracy claim before the side-by-side season: " + t);
  }
  assert.equal(P.gaugeHook({ gauge_hook: { line: "", link: "x" } }), null);
  assert.equal(P.gaugeHook({ gauge_hook: { line: "x".repeat(91), link: "x" } }), null);
  assert.equal(P.gaugeHook(null), null);
});

test("auto switches on the dates in gauge_window: Rain Print to Dec 24, nothing Dec 25, the gauge Dec 26 to May 31", () => {
  assert.deepEqual(J.gauge_window, { rain_print_until: "2026-12-24", from: "2026-12-26", until: "2027-05-31" });
  const cases = [
    ["2026-10-23", SEE], ["2026-12-09", SEE], ["2026-12-10", SEE], ["2026-12-24", SEE],
    ["2026-12-25", ""],
    ["2026-12-26", HOOK], ["2027-01-15", HOOK], ["2027-04-01", HOOK], ["2027-05-31", HOOK],
    ["2027-06-01", SEE], ["2027-10-01", SEE],
  ];
  for (const [d, want] of cases) assert.equal(P.lineFor(J, "auto", d), want, d);
  assert.equal(P.autoMode(J, "2026-12-25"), "");
  assert.equal(P.autoMode(J, "2026-12-26"), "gauge");
  assert.equal(P.autoMode(J, "2026-12-24"), "see");
  // fail soft: a bad or missing window keeps the Rain Print line; promote off hides it; no hook, no gauge line
  for (const w of [undefined, null, {}, { from: "2027-05-31", until: "2026-12-26" }, { from: "Dec 26", until: "2027-05-31" }])
    assert.equal(P.lineFor({ ...J, gauge_window: w }, "auto", "2027-01-15"), SEE, JSON.stringify(w));
  assert.equal(P.lineFor({ ...J, promote: false }, "auto", "2026-11-15"), "");
  assert.equal(P.lineFor({ ...J, promote: false }, "auto", "2027-01-15"), HOOK, "the gauge does not hang on the Rain Print switch");
  assert.equal(P.lineFor({ ...J, gauge_hook: null }, "auto", "2027-01-15"), "");
  assert.equal(P.lineFor(null, "auto", "2027-01-15"), "", "no data file, no line");
});

test("bids, markets and rent pages keep the gift line, which ends Dec 9", () => {
  assert.equal(J.promote_until, "2026-12-09");
  assert.equal(P.lineFor(J, "", "2026-12-09"), "A year of your farm's rain, as a gift. Order framed by Dec 9.");
  assert.equal(P.lineFor(J, "", "2026-12-10"), "");
  assert.equal(P.lineFor(J, "", "2027-01-15"), "", "never the gauge");
  for (const f of ["cash-bids.html", "markets.html", "corn-futures-prices.html", "soybean-futures-prices.html", "wheat-futures-prices.html", "cattle-futures-prices.html"]) {
    const h = read(f);
    assert.equal(slots(h), 1, f);
    assert.match(h, /<p class="rp-promo" data-rain-print-promo hidden><\/p>/, f);
  }
  for (const f of readdirSync(join(ROOT, "rent")).filter((x) => x.endsWith(".html"))) assert.ok(!/data-rain-print-promo="(auto|gauge)"/.test(read("rent/" + f)), "rent/" + f);
  const py = read("scripts/build_cash_bid_pages.py");
  assert.match(py, /return '<p class="rp-promo" data-rain-print-promo hidden><\/p>'/, "town pages: the gift line only");
  assert.ok(!/data-rain-print-promo="auto"/.test(py));
});

test("every rain, weather, PRF, ARC/PLC and Fast Facts page with the slot: one auto slot in the body, with its script", () => {
  // /rain and /hail-map keep their typed Rain Print line (test/rain-print-links-in.test.mjs): that is their one promo
  const pages = ["drought-monitor.html", "rain-radar.html", "arc-plc.html", "fast-facts.html"];
  for (const d of ["rain", "hail-map"]) for (const f of readdirSync(join(ROOT, d))) if (f.endsWith(".html")) pages.push(d + "/" + f);
  // the PRF state pages (a state folder beside each); explainers like /prf/how-prf-works carry no slot
  for (const f of readdirSync(join(ROOT, "prf"))) if (f.endsWith(".html") && existsSync(join(ROOT, "prf", f.slice(0, -5)))) pages.push("prf/" + f);
  for (const st of readdirSync(join(ROOT, "prf"))) {
    if (!statSync(join(ROOT, "prf", st)).isDirectory()) continue;
    for (const f of readdirSync(join(ROOT, "prf", st))) if (f.endsWith(".html")) pages.push("prf/" + st + "/" + f);
  }
  assert.ok(pages.length > 3200, "the PRF county pages are in: " + pages.length);
  for (const f of pages) {
    const h = read(f), m = inMain(h);
    assert.equal(slots(h), 1, f + ": one promo slot");
    assert.ok(m.includes('<p class="rp-promo" data-rain-print-promo="auto" hidden></p>'), f + ": the auto slot, inside main");
    assert.match(h, /<script src="\/components\/rain-print-promo\.js\?v=6" defer><\/script>/, f);
  }
  // the generators write it, so a rebuild keeps it
  for (const g of ["scripts/build_county_rain.py", "scripts/build_prf_states.py", "scripts/build_prf_counties.py", "scripts/build_arc_plc.py"])
    assert.match(read(g), /data-rain-print-promo="auto"/, g);
  assert.match(read("scripts/generate_hail_states.py"), /data-rain-print-promo=\\"auto\\"/);
});

test("one copy of the promo script: every page loads the same version", () => {
  const seen = new Map();
  const walk = (d) => {
    for (const f of readdirSync(join(ROOT, d))) {
      const p = d ? d + "/" + f : f;
      if (/^(\.git|node_modules|test|scripts|build|workers|\.github)$/.test(f)) continue;
      const st = statSync(join(ROOT, p));
      if (st.isDirectory()) walk(p);
      else if (f.endsWith(".html")) for (const m of read(p).matchAll(/rain-print-promo\.js\?v=(\d+)/g)) seen.set(m[1], (seen.get(m[1]) || 0) + 1);
    }
  };
  walk("");
  assert.deepEqual([...seen.keys()], ["6"], JSON.stringify([...seen]));
});

test("the hook is said the same everywhere the gauge is linked with words of its own", () => {
  // the /rain-gauge headline is its own plain line (Sig, Oct 23: "something less dramatic"); the hook says the same thing
  const g = read("rain-gauge.html");
  assert.ok(g.includes('<h1 id="rg-gauge-h">A rain gauge that keeps its own log</h1>'));
  assert.equal(J.gauge_hook.line, "I'm building a rain gauge that keeps a log for each field.");
  assert.equal(J.gauge_hook.link, "Join the waitlist");
  assert.ok(read("rain-print.html").includes(J.gauge_hook.line + ' <a href="/rain-gauge" style="color:var(--brand)">' + J.gauge_hook.link + "</a>."), "the line under /rain-print");
  const next = JSON.parse(read("data/next-links.json"));
  let n = 0;
  for (const v of Object.values(next.pages)) for (const l of (v && v.links) || []) if (l.href === "/rain-gauge") { assert.equal(l.why, J.gauge_hook.link); n++; }
  assert.ok(n >= 2, "the Next cards");
  // the old line is gone from every page and component
  for (const f of ["components/rain-print-promo.js", "rain-print.html", "urea.html", "rain-gauge.html"]) assert.ok(!/Want a better rain gauge|Sig is designing one/.test(read(f)), f);
});

test("/rain-gauge: honest numbers only, no count, no timer, no popup, no founding, sig@agsist.com", () => {
  const h = read("rain-gauge.html");
  assert.ok(!/farmers1st\.com/.test(h), "no farmers1st.com address (Oct 22)");
  assert.equal((h.match(/mailto:sig@agsist\.com/g) || []).length, 3, "the warranty card, the FAQ and the confirmation");
  assert.ok(!/founding/i.test(h));
  assert.ok(!/countdown|exit-?intent|mouseleave|beforeunload|showModal|<dialog\b|position:fixed/i.test(h), "no timer, popup or exit-intent");
  assert.ok(!/notice-list|notice-count|\b\d+ (people|farmers|others) (are |have )?(on|joined|signed)|spots? left|only \d+ left/i.test(h), "never a waitlist count");
  assert.ok(!/\b(days|hours) (left|to go)|ends (on|in)|offer ends|deadline/i.test(h), "no deadline");
  // the price promise, said plainly at the top
  const top = h.slice(h.indexOf('id="rg-form-1"'), h.indexOf("</form>", h.indexOf('id="rg-form-1"')));
  assert.match(top, /<h2 class="rg-form-h" id="rg-form-h-1">Get on the waitlist<\/h2>/);
  assert.match(top, /No price is set yet\. It will be barely over my cost, and it holds even if the first batch runs out before your turn\. Free to join\./);
  // what the waitlist gets you: the short list right after the hero, said plainly (no "why now" pitch)
  assert.match(h, /<h3 class="sec-h" id="rg-now-h">What the waitlist gets you<\/h3>/);
  assert.ok(!/why get on the list now|don.t miss|act now|reserve yours|be first in line/i.test(h), "no sales-pitch lines");
  const now = h.slice(h.indexOf('id="now"'), h.indexOf("</section>", h.indexOf('id="now"')));
  assert.equal((now.match(/<li>/g) || []).length, 4);
  for (const k of ["first-batch price", "No price is set yet", "hears before anyone else", "good-faith lifetime warranty", "Made in Chetek"]) assert.ok(now.toLowerCase().includes(k.toLowerCase()), k);
  // the Rain Print of your own field, said as not built yet
  assert.match(h, /a <a href="\/rain-print">Rain Print<\/a> of your own field, instead of the nearest weather station\. That part isn&rsquo;t built yet\./);
  // the confirmation never promises an email that no sender sends
  const js = h.slice(h.indexOf("function confirmIn"), h.indexOf("function offerDaily"));
  assert.ok(js.length > 100);
  assert.ok(!/check your (inbox|email)|confirmation email|we sent|sent you/i.test(js), "no email promised");
  assert.match(js, /Nothing comes to that address before then/);
  assert.match(h, /only: \['daily'\]/, "One more? offers the Daily alone");
  // no sponsor links on the page, like /rain-print
  assert.match(h, /#site-header a\[href\^="\/sponsor"\],#site-footer a\[href\^="\/sponsor"\],#site-footer a\[href\^="\/sponsor"\]\+\.footer-sep,#site-footer #footer-adspace\{display:none!important\}/);
});

test("signup-ask.js: oneMore takes only, the ids a page allows", () => {
  const sa = read("components/signup-ask.js");
  assert.match(sa, /return O\[k\] && \(!ctx\.only \|\| ctx\.only\.indexOf\(k\) >= 0\);/);
});

// ---------------------------------------------------------------- in a browser
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".webp": "image/webp", ".jpg": "image/jpeg" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index";
    if (!extname(p)) p += ".html";
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}
async function context(browser, width, height, posts) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width, height } });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
    const u = r.request().url();
    if (posts && /agsist-api\.dnilgis\.workers\.dev\/notice/.test(u)) { posts.push(JSON.parse(r.request().postData() || "{}")); return r.fulfill({ contentType: "application/json", body: '{"ok":true}' }); }
    return r.abort();
  });
  return ctx;
}

test("in a browser: on a phone the email box and button sit in the first screen; no Advertise anywhere", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const ctx = await context(browser, 390, 844);
    const pg = await ctx.newPage();
    await pg.goto(base + "/rain-gauge");
    await pg.waitForSelector("footer.footer", { timeout: 15000 });
    await pg.waitForSelector("#topnav", { timeout: 15000 });
    await pg.waitForTimeout(400);
    const r = await pg.evaluate(() => ["#rg-gauge-h", "#rg-email-1", "#rg-go-1"].map((s) => document.querySelector(s).getBoundingClientRect().bottom));
    for (const b of r) assert.ok(b > 0 && b <= 844, "in the first phone screen: " + r);
    assert.equal(await pg.locator("h1").count(), 1);
    const sp = await pg.evaluate(() => [...document.querySelectorAll('a[href^="/sponsor"]')].map((a) => !!a.getClientRects().length && getComputedStyle(a).visibility !== "hidden"));
    assert.ok(sp.length >= 3 && sp.every((v) => !v), "no sponsor link shows: " + sp);
    await ctx.close();
  } finally { await browser.close(); srv.close(); }
});

test("in a browser: a signup gets the honest confirmation and one unticked Daily offer, the same note as before", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const posts = [];
    const ctx = await context(browser, 390, 844, posts);
    const pg = await ctx.newPage();
    await pg.goto(base + "/rain-gauge");
    await pg.waitForFunction(() => !!window.AgsistSignup, null, { timeout: 15000 });
    await pg.fill("#rg-email-1", "reader@example.com");
    await pg.click("#rg-form-1 .rg-more > summary");
    await pg.fill("#rg-zip-1", "54728");
    await pg.check('input[name="count-1"][value="2-5"]', { force: true });
    await pg.click("#rg-go-1");
    await pg.waitForSelector(".rg-done", { state: "visible", timeout: 15000 });
    assert.equal(posts.length, 1);
    assert.deepEqual({ ...posts[0], _gotcha: undefined }, { email: "reader@example.com", topic: "rain-gauge", source: "rain-gauge", zip: "54728", note: "Gauges: 2-5", _gotcha: undefined });
    const done = await pg.textContent(".rg-done");
    assert.match(done, /^You’re on the waitlist\./);
    assert.match(done, /I’ll email you before anyone else, with the price\. That first-batch price is yours even if the batch runs out before your turn\./);
    assert.ok(!/check your inbox/i.test(done));
    assert.equal(await pg.isVisible("#rg-form-1"), false, "the form gives way to the confirmation");
    await pg.waitForSelector(".rg-done [data-sa-more]", { state: "visible", timeout: 10000 });
    const boxes = await pg.evaluate(() => [...document.querySelectorAll(".rg-done [data-sa-more] input[type=checkbox]")].map((c) => [c.value, c.checked]));
    assert.deepEqual(boxes, [["daily", false]], "the Daily alone, unticked");
    assert.equal(await pg.evaluate(() => !!document.querySelector("form .rg-done, form [data-sa-more]")), false, "no form inside a form");
    // the other form says so too
    assert.match(await pg.textContent("#rg-msg-2"), /You are on the waitlist\./);
    await ctx.close();
  } finally { await browser.close(); srv.close(); }
});

test("in a browser: a state rain page shows Rain Print now and the gauge hook on Dec 26", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const [day, want, href] of [["2026-11-15T18:00:00Z", SEE, "/rain-print"], ["2026-12-25T18:00:00Z", "", ""], ["2026-12-26T18:00:00Z", HOOK, "/rain-gauge"]]) {
      const ctx = await context(browser, 390, 844);
      const pg = await ctx.newPage();
      await pg.clock.setFixedTime(new Date(day));
      await pg.goto(base + "/rain/iowa");
      await pg.waitForTimeout(1200);
      const got = await pg.evaluate(() => { const p = document.querySelector("[data-rain-print-promo]"); const a = p.querySelector("a"); return [p.hidden, p.textContent.trim(), a ? a.getAttribute("href").replace(/\?.*$/, "") : ""]; });
      if (!want) assert.deepEqual(got, [true, "", ""], day);
      else assert.deepEqual(got, [false, want, href], day);
      await ctx.close();
    }
  } finally { await browser.close(); srv.close(); }
});
