/* The full new menu (Oct 18, 2026; Sig: "do all of it").
 *   Desktop: Prices | Livestock | Field | Money & Land | Daily, then the ZIP chip, Search, Free daily email.
 *   Phone: logo, ZIP chip, search, menu. The panel: search, My place, the five groups open, a Rain Print card,
 *   About, Contact, Display mode.
 *   Footer: daily email band and one Rain Print line; Prices | Livestock | Field | Money & Land | Work with us | About.
 *
 *   node --test test/nav-full-oct18.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

const header = read("components/header.html"), footer = read("components/footer.html");
const text = (s) => s.replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&rsquo;/g, "’").replace(/&rarr;/g, "→").replace(/\s+/g, " ").trim();
// A link's name without its short line underneath (The Haymow: "Hay for sale and wanted"); the line is checked on its own.
const SUB_RE = /<span class="nav-sub">[^<]*<\/span>/;
const linkName = (s) => text(s.replace(SUB_RE, ""));
const SUBLINES = { "/haymow": "Hay for sale and wanted" };

// The approved outline, labels exact. Oct 22-23, 2026: the merged pages left it (scripts/moved_pages.py).
const MENU = {
  markets: ["Prices", {
    "Near you": [["/cash-bids", "Cash bids near me"], ["/basis", "Bids and basis by state"], ["/grain-transport", "Grain on the move"], ["/cash-bid-index", "Cash Bid Index"], ["/fertilizer", "Fertilizer prices"]],
    Futures: [["/corn-futures-prices", "Corn"], ["/soybean-futures-prices", "Soybeans"], ["/wheat-futures-prices", "Wheat"], ["/harvest-price-tracker", "Harvest price tracker"], ["/markets", "All markets →"]],
    Reports: [["/usda-calendar", "USDA calendar and what’s priced in"], ["/conditions", "Crop progress and size"], ["/usda-quick-stats", "Yield by state"], ["/crop-tour", "Crop tour"], ["/cot", "Fund positions (COT)"], ["/tariffs", "Tariffs and trade"]],
  }],
  livestock: ["Livestock", {
    "": [["/cattle-auction-prices", "Sale barn prices"], ["/cattle-futures-prices", "Cattle futures"], ["/milk-prices", "Milk"], ["/hay-prices", "Hay"], ["/haymow", "The Haymow"], ["/lrp", "LRP"], ["/prf", "PRF"], ["/manure-value", "Manure value"], ["/drought-monitor", "Drought monitor"]],
  }],
  field: ["Field", {
    Weather: [["/rain-radar", "Rain on your field"], ["/rain", "Rain by county"], ["/hail-map", "Hail map"], ["/spray", "Spray advisory"], ["/fall-nitrogen", "Soil temp (fall anhydrous)"], ["/rain-print", "Rain Print"], ["/rain-gauge", "Rain gauge waitlist"]],
    Crop: [["/gdu-calculator", "GDU"], ["/planting-date", "Planting date"], ["/urea", "Urea loss"], ["/nutrient-removal", "Nutrient removal"], ["/field-scout", "Field Scout"], ["/yield-estimator", "Yield estimator"]],
    "Harvest and bins": [["/harvest-or-wait", "Harvest now or wait"], ["/grain-emc", "Grain drying (EMC)"], ["/grain-shrink", "Grain shrink"], ["/grain-bin-calculator", "Bin calculator"], ["/combine-loss", "Combine loss"], ["/tools", "All tools →"]],
  }],
  money: ["Money & Land", {
    Land: [["/rent/", "Cash rent"], ["/farmland-atlas", "Farmland Atlas"], ["/farmland-index", "Farmland sale index"], ["/custom-rates", "Custom rates"], ["/cash-lease", "Lease form"]],
    Programs: [["/arc-plc", "ARC or PLC"], ["/prf", "PRF"], ["/lrp", "LRP"], ["/farm-bill", "Farm bill"]],
    Selling: [["/store-or-sell", "Sell or store"], ["/breakeven", "Break-even"], ["/commodity-loan", "CCC loan"]],
  }],
  daily: ["Daily", { "": [["/daily", "Today’s briefing"], ["/daily#past", "Past briefings"]] }],
};

function deskPanel(id) {
  const a = header.indexOf(`<div class="nav-dd" id="dd-${id}">`);
  assert.ok(a > 0, `dd-${id}`);
  const b = header.indexOf('<div class="nav-dd"', a + 10);
  return header.slice(a, b > 0 ? b : header.indexOf('<div class="nav-actions">'));
}
const drawer = header.slice(header.indexOf('<div class="drawer" id="drawer"'));

test("desktop menu: five groups in order, short noun subheads, every label exact", () => {
  const order = [...header.matchAll(/<div class="nav-dd" id="dd-([a-z]+)">/g)].map((m) => m[1]);
  assert.deepEqual(order, Object.keys(MENU));
  for (const [id, [name, subs]] of Object.entries(MENU)) {
    const p = deskPanel(id);
    assert.equal(text(p.match(/<button class="nav-btn"[\s\S]*?<\/button>/)[0]), name);
    const heads = [...p.matchAll(/<div class="nav-q">([^<]*)<\/div>/g)].map((m) => m[1]);
    assert.deepEqual(heads, Object.keys(subs).filter(Boolean), `${name} subheads`);
    assert.ok(!heads.some((h) => /\?/.test(h)), "no question headings");
    const all = [...p.matchAll(/<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
    const links = all.map((m) => [m[1], linkName(m[2])]);
    assert.deepEqual(links, Object.values(subs).flat(), `${name} links`);
    for (const m of all) assert.equal((m[2].match(/<span class="nav-sub">([^<]*)<\/span>/) || [])[1], SUBLINES[m[1]], `${m[1]} short line`);
  }
  // Daily's inline signup box, and the right-hand actions in order
  assert.match(deskPanel("daily"), /<div class="nav-q nav-q-ask">Get it by email<\/div>\s*<div class="nav-ask" data-signup-hide><div data-signup-ask="[^"]+" data-source="menu-desk"/);
  const acts = header.slice(header.indexOf('<div class="nav-actions">'), header.indexOf("</nav>"));
  const at = (s) => acts.indexOf(s);
  assert.ok(at('id="zip-chip"') > 0 && at('id="zip-chip"') < at('id="srch-btn"') && at('id="srch-btn"') < at('id="nav-email"'), "ZIP chip, Search, Free daily email");
  assert.match(acts, /<button type="button" class="nav-email" id="nav-email"[^>]*>Free daily email<\/button>/);
  assert.match(acts, /<span class="zip-chip-t" id="zip-chip-t">Set your ZIP<\/span>/);
});

test("phone panel: search, My place, the five groups open with subheads, a Rain Print card, About, Contact, Display mode", () => {
  assert.doesNotMatch(drawer, /<details/, "no folds inside the panel");
  const at = (s) => { const i = drawer.indexOf(s); assert.ok(i > 0, s); return i; };
  const seq = ['id="draw-srch"', 'id="dp-here"', 'id="dp-bids"', 'id="dg-markets"', 'id="dg-livestock"', 'id="dg-field"', 'id="dg-money"', 'id="dg-daily"', 'class="draw-rp"', 'href="/about"', 'href="/contact"', 'id="theme-btn-d"'];
  for (let i = 1; i < seq.length; i++) assert.ok(at(seq[i - 1]) < at(seq[i]), `${seq[i - 1]} before ${seq[i]}`);
  // Sig, Oct 20: the place page (/fast-facts since Oct 21) is the first My place tile
  assert.match(drawer, /<div class="draw-place-row">\s*<a href="\/fast-facts" class="draw-pl" id="dp-here">[\s\S]*?Everything near me<\/a>/);
  assert.match(drawer, /<a href="\/cash-bids" class="draw-pl" id="dp-bids">[\s\S]*?Bids near me<\/a>/);
  assert.match(drawer, /<a href="\/rain-radar" class="draw-pl" id="dp-rain">[\s\S]*?Rain at my field<\/a>/);
  assert.match(drawer, /<a href="\/rent\/" class="draw-pl" id="dp-rent">[\s\S]*?Rent in my county<\/a>/);
  for (const [id, [name, subs]] of Object.entries(MENU)) {
    const a = drawer.indexOf(`id="dg-${id}"`), sec = drawer.slice(a, drawer.indexOf("</section>", a));
    assert.equal(text(sec.slice(sec.indexOf(">") + 1, sec.indexOf("</h2>"))), name);
    const all = [...sec.matchAll(/<a href="([^"]+)" class="draw-item[^"]*">([\s\S]*?)<\/a>/g)];
    const links = all.map((m) => [m[1], linkName(m[2])]);
    assert.deepEqual(links, Object.values(subs).flat(), `${name} in the phone panel`);
    for (const m of all) assert.equal((m[2].match(/<span class="nav-sub">([^<]*)<\/span>/) || [])[1], SUBLINES[m[1]], `${m[1]} short line in the phone panel`);
  }
  assert.match(drawer, /<a href="\/rain-print" class="draw-rp"><span class="draw-rp-k">Rain Print<\/span><span class="draw-rp-t">Your farm&rsquo;s year of rain, framed<\/span>/);
});

test("moved note: Harvest tools moved to Field, in Money & Land, dismissible, gated to two weeks", () => {
  for (const part of [deskPanel("money"), drawer.slice(drawer.indexOf('id="dg-money"'))]) {
    assert.match(part, /<p class="nav-moved" data-nav-moved data-until="2026-11-01" hidden><span>Harvest tools moved to Field<\/span><button type="button" class="nav-moved-x" aria-label="Dismiss: harvest tools moved to Field">/);
  }
});

test("footer: email band with an optional ZIP and one Rain Print line, six columns, legal row", () => {
  const band = footer.slice(footer.indexOf('<div class="footer-band">'), footer.indexOf('<div class="footer-cols">'));
  assert.match(band, /<div data-signup-ask="[^"]+" data-source="footer"><\/div>/, "the signup box (signup-ask.js adds the optional ZIP)");
  assert.match(band, /<a href="\/rain-print"><b>Rain Print:<\/b> your farm&rsquo;s year of rain, framed &rarr;<\/a>/);
  const cols = [...footer.matchAll(/<summary><span class="footer-h">([^<]+)<\/span><\/summary>/g)].map((m) => m[1].replace("&amp;", "&"));
  assert.deepEqual(cols, ["Prices", "Livestock", "Field", "Money & Land", "Work with us", "About"]);
  const col = (n) => { const a = footer.indexOf(`<span class="footer-h">${n}</span>`); return footer.slice(a, footer.indexOf("</details>", a)); };
  const labels = (n) => [...col(n).matchAll(/<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => [m[1], text(m[2])]);
  // 2026-10-20: "List your elevator, free" in Work with us (Sig, business walk-through fixes).
  assert.deepEqual(labels("Work with us"), [["/sponsor", "Advertise"], ["/rain-print-business", "Rain Print for business"], ["/prf-sponsor", "PRF sponsor"], ["/list-your-elevator", "List your elevator, free"], ["/rain-gauge", "Rain gauge waitlist"], ["/developer", "Embeds"]]);
  assert.deepEqual(labels("About"), [["/about", "About"], ["/editorial-standards", "Editorial standards"], ["/contact", "Contact"], ["/changelog", "What’s new"]]);
  const legal = footer.slice(footer.indexOf('<div class="footer-legal">'));
  assert.deepEqual([...legal.matchAll(/<a href="([^"]+)"/g)].map((m) => m[1]), ["/privacy", "/accessibility", "/terms"]);
  assert.doesNotMatch(footer, /\/cash-bids\/[a-z-]+\/"|\/rent\/[a-z]/, "no state-link columns yet (Sig: later)");
});

test("every link in the menu, the footer and both no-script copies opens a page in the repo", () => {
  const miss = [];
  for (const f of ["components/header.html", "components/footer.html", "components/header-fallback.html", "components/footer-fallback.html"]) {
    for (const m of read(f).replace(/<!--[\s\S]*?-->/g, "").matchAll(/href="(\/[^"?#]*)/g)) {
      const h = m[1];
      const file = h === "/" ? "index.html" : h.endsWith("/") ? h.slice(1) + "index.html" : h.slice(1) + ".html";
      if (!existsSync(join(ROOT, file))) miss.push(`${f}: ${h}`);
    }
  }
  assert.deepEqual(miss, []);
  // /cash-bids/states is the forward page to /basis#states (Oct 22, 2026), never cash-bids/index.html (it would capture /cash-bids)
  assert.ok(!existsSync(join(ROOT, "cash-bids/index.html")));
  assert.match(read("cash-bids/states.html"), /<link rel="canonical" href="https:\/\/agsist.com\/basis">/);
  const sh = read("basis.html");
  assert.match(sh, /<h3 class="bs-sub" id="states">Cash bids by state<\/h3>/);
  assert.match(sh, /<a href="\/cash-bids\/iowa\/">Iowa<\/a> <span class="mut">\d+ elevators? in \d+ towns?<\/span>/);
  assert.match(read("scripts/build_cash_bid_pages.py"), /stamp_basis_hub\(hub, doc, states_html\)/, "rebuilt on every cash-bid run");
});

test("no em dashes in what a reader sees in the menu, the footer, the fallbacks and the states list", () => {
  for (const f of ["components/header.html", "components/footer.html", "components/header-fallback.html", "components/footer-fallback.html", "basis.html"]) {
    const seen = read(f).replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.doesNotMatch(seen, /—|&mdash;/, f);
  }
});

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
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
const GEO = { results: [{ name: "Chetek", latitude: 45.3141, longitude: -91.651, admin1: "Wisconsin" }] };
async function context(browser, width, height, { geo = GEO, init } = {}) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width, height } });
  const calls = [];
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
    const u = r.request().url();
    if (u.includes("geocoding-api.open-meteo.com")) {
      calls.push(u);
      return geo ? r.fulfill({ contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(geo) }) : r.abort();
    }
    return r.abort();
  });
  if (init) await ctx.addInitScript(init);
  return { ctx, calls };
}

test("ZIP chip: reads the saved place, sets all three keys, a failed lookup saves nothing", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    // nothing saved
    let { ctx } = await context(browser, 1280, 900);
    let pg = await ctx.newPage();
    await pg.goto(base + "/about");
    await pg.waitForSelector("#zip-chip", { state: "visible", timeout: 15000 });
    assert.equal(await pg.textContent("#zip-chip-t"), "Set your ZIP");
    // keyboard: the box opens, takes focus, Escape closes it and hands focus back
    await pg.focus("#zip-chip");
    await pg.keyboard.press("Enter");
    assert.equal(await pg.getAttribute("#zip-chip", "aria-expanded"), "true");
    await pg.waitForFunction(() => document.activeElement && document.activeElement.id === "zip-in");
    await pg.keyboard.type("54728");
    await pg.keyboard.press("Enter");
    await pg.waitForFunction(() => document.getElementById("zip-chip-t").textContent === "Bids near Chetek");
    const keys = await pg.evaluate(() => ({ loc: JSON.parse(localStorage.getItem("agsist-wx-loc")), z: localStorage.getItem("agsist_zip"), u: localStorage.getItem("agsist_user_zip") }));
    assert.equal(keys.z, "54728"); assert.equal(keys.u, "54728");
    assert.equal(keys.loc.zip, "54728"); assert.equal(keys.loc.state, "WI"); assert.equal(keys.loc.label, "Chetek, WI"); assert.equal(keys.loc.zipTyped, true);
    // Sig, Oct 20: once a ZIP is saved the box sends the reader to the place page for that ZIP (Fast Facts since Oct 21)
    assert.equal(await pg.getAttribute("#zip-go", "href"), "/fast-facts?zip=54728");
    assert.equal(await pg.textContent("#zip-go"), "Everything near Chetek →");
    await pg.keyboard.press("Escape");
    assert.equal(await pg.isVisible("#zip-pop"), false);
    assert.equal(await pg.evaluate(() => document.activeElement.id), "zip-chip");
    // a page the reader opens next reads the same keys (the bids page takes the ZIP)
    await pg.goto(base + "/cash-bids");
    await pg.waitForSelector("#zip-chip-t");
    assert.equal(await pg.textContent("#zip-chip-t"), "Bids near Chetek");
    await ctx.close();

    // only the cash-bids key: the ZIP itself, no invented town
    ({ ctx } = await context(browser, 390, 844, { init: () => { try { localStorage.setItem("agsist_zip", "50010"); } catch (e) {} } }));
    pg = await ctx.newPage();
    await pg.goto(base + "/about");
    await pg.waitForSelector("#zip-chip", { state: "visible", timeout: 15000 });
    assert.equal(await pg.textContent("#zip-chip-t"), "Bids near 50010");
    // the phone panel's My place row follows the saved ZIP
    await pg.click("#hamburger");
    await pg.waitForFunction(() => document.getElementById("drawer").classList.contains("open"));
    assert.equal(await pg.getAttribute("#dp-bids", "href"), "/cash-bids?zip=50010");
    assert.equal(await pg.getAttribute("#dp-here", "href"), "/fast-facts?zip=50010");
    await ctx.close();

    // a saved Iowa place: rent opens on Iowa's county picker
    ({ ctx } = await context(browser, 390, 844, { init: () => { try { localStorage.setItem("agsist-wx-loc", JSON.stringify({ lat: 42.03, lon: -93.62, label: "Ames, IA", zip: "50010", state: "IA", county: "" })); } catch (e) {} } }));
    pg = await ctx.newPage();
    await pg.goto(base + "/about");
    await pg.waitForSelector("#zip-chip", { state: "visible", timeout: 15000 });
    assert.equal(await pg.textContent("#zip-chip-t"), "Bids near Ames");
    assert.equal(await pg.getAttribute("#dp-rent", "href"), "/rent/iowa#your-ground");
    assert.ok(existsSync(join(ROOT, "rent/iowa.html")) && read("rent/iowa.html").includes('id="your-ground"'));
    await ctx.close();

    // the lookup fails: nothing is saved and the box says so
    const c3 = await context(browser, 1280, 900, { geo: null });
    pg = await c3.ctx.newPage();
    await pg.goto(base + "/about");
    await pg.waitForSelector("#zip-chip", { state: "visible", timeout: 15000 });
    await pg.click("#zip-chip");
    await pg.fill("#zip-in", "54728");
    await pg.click(".zip-save");
    await pg.waitForFunction(() => /Nothing was saved/.test(document.getElementById("zip-m").textContent));
    assert.equal(await pg.evaluate(() => localStorage.getItem("agsist_zip") || localStorage.getItem("agsist_user_zip") || localStorage.getItem("agsist-wx-loc")), null);
    assert.equal(await pg.textContent("#zip-chip-t"), "Set your ZIP");
    // a bad ZIP is refused before any lookup
    await pg.fill("#zip-in", "123");
    await pg.click(".zip-save");
    assert.equal(await pg.textContent("#zip-m"), "Type a 5-digit ZIP.");
    await c3.ctx.close();
  } finally { await browser.close(); srv.close(); }
});

test("phone: one tap on the menu shows every group's links; desktop panels stay inside the window", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    let { ctx } = await context(browser, 390, 844, { init: () => { Date.now = () => Date.parse("2026-10-20T12:00:00Z"); } });
    let pg = await ctx.newPage();
    await pg.goto(base + "/about");
    await pg.waitForSelector("#hamburger", { state: "visible", timeout: 15000 });
    // phone header: logo, ZIP chip, search, menu; nothing sideways
    for (const s of [".nav-logo", "#zip-chip", "#srch-btn", "#hamburger"]) assert.ok(await pg.isVisible(s), s);
    assert.equal(await pg.isVisible("#nav-email"), false);
    assert.ok(await pg.evaluate(() => document.documentElement.scrollWidth <= 390));
    await pg.click("#hamburger");
    await pg.waitForFunction(() => document.getElementById("drawer").classList.contains("open"));
    const hidden = await pg.evaluate(() => [...document.querySelectorAll("#drawer .draw-grp a.draw-item")].filter((a) => !a.getClientRects().length).map((a) => a.getAttribute("href")));
    assert.deepEqual(hidden, [], "every group link is shown without another tap");
    const n = await pg.evaluate(() => document.querySelectorAll("#drawer .draw-grp a.draw-item").length);
    assert.equal(n, 5 + 5 + 6 + 9 + 7 + 6 + 6 + 5 + 4 + 3 + 2,
      "Near you 5 and Reports 6 since the merges (Oct 22, 2026: Bids by state, What's priced in and Crop size joined the pages beside them), Crop 6 (Pod counts on the crop tour), Daily 2 (The Wire and the archive on the Daily page); Livestock has 9 since The Haymow (2026-10-18); Land 5 with Farmland sale index (2026-10-20)");
    assert.ok(await pg.evaluate(() => document.getElementById("drawer").scrollWidth <= 390), "no sideways scroll in the panel");
    // the moved note shows before Nov 1 and stays closed once dismissed
    assert.ok(await pg.isVisible("#drawer .nav-moved"));
    await pg.click("#drawer .nav-moved-x");
    assert.equal(await pg.isVisible("#drawer .nav-moved"), false);
    assert.ok(await pg.evaluate(() => document.getElementById("drawer").contains(document.activeElement)), "focus stays in the panel");
    await pg.reload();
    await pg.waitForSelector("#hamburger", { state: "visible" });
    assert.equal(await pg.evaluate(() => document.querySelector("#drawer .nav-moved").hidden), true);
    // the panel's search box closes the panel and opens the search sheet
    await pg.click("#hamburger");
    await pg.waitForFunction(() => document.getElementById("drawer").classList.contains("open"));
    await pg.click("#draw-srch");
    await pg.waitForSelector("#srch-in", { state: "visible", timeout: 10000 });
    assert.equal(await pg.evaluate(() => document.getElementById("drawer").classList.contains("open")), false);
    await ctx.close();

    // after the two weeks the note is gone
    ({ ctx } = await context(browser, 1280, 900, { init: () => { Date.now = () => Date.parse("2026-11-02T12:00:00Z"); } }));
    pg = await ctx.newPage();
    await pg.goto(base + "/about");
    await pg.waitForSelector("#dd-money .nav-btn", { state: "visible", timeout: 15000 });
    await pg.click("#dd-money .nav-btn");
    assert.equal(await pg.isVisible("#dd-money-panel .nav-moved"), false);
    await ctx.close();

    for (const w of [1024, 1280]) {
      ({ ctx } = await context(browser, w, 800));
      pg = await ctx.newPage();
      await pg.goto(base + "/about");
      await pg.waitForSelector("#dd-markets .nav-btn", { state: "visible", timeout: 15000 });
      // the menu buttons and the right-hand actions never overlap
      const gap = await pg.evaluate(() => document.querySelector(".nav-actions").getBoundingClientRect().left - [...document.querySelectorAll(".nav-btn")].pop().getBoundingClientRect().right);
      assert.ok(gap > 0, `${w}: menu and actions overlap by ${-gap}px`);
      for (const id of ["markets", "livestock", "field", "money", "daily"]) {
        await pg.click(`#dd-${id} .nav-btn`);
        await pg.waitForTimeout(200);
        const r = await pg.evaluate((i) => { const b = document.getElementById(`dd-${i}-panel`).getBoundingClientRect(); return [b.left, b.right]; }, id);
        assert.ok(r[0] >= 0 && r[1] <= w, `${w}: ${id} panel at ${r}`);
        // keyboard: the panel's links are reachable, Escape closes it
        assert.equal(await pg.getAttribute(`#dd-${id} .nav-btn`, "aria-expanded"), "true");
        await pg.keyboard.press("Escape");
        assert.equal(await pg.getAttribute(`#dd-${id} .nav-btn`, "aria-expanded"), "false");
      }
      if (w === 1280) {
        // Free daily email opens Daily at its signup box
        await pg.click("#nav-email");
        await pg.waitForFunction(() => document.activeElement && document.activeElement.matches("#dd-daily-panel .nav-ask input[type=email]"), null, { timeout: 10000 });
        // typing in the box does not close the panel
        await pg.keyboard.type("a");
        assert.equal(await pg.getAttribute("#dd-daily .nav-btn", "aria-expanded"), "true");
      }
      await ctx.close();
    }
    // a subscriber sees no email button and no menu signup box
    ({ ctx } = await context(browser, 1280, 800, { init: () => { try { localStorage.setItem("agsist_subscribed", "1"); } catch (e) {} } }));
    pg = await ctx.newPage();
    await pg.goto(base + "/about");
    await pg.waitForSelector("#dd-daily .nav-btn", { state: "visible", timeout: 15000 });
    assert.equal(await pg.isVisible("#nav-email"), false);
    await pg.click("#dd-daily .nav-btn");
    assert.equal(await pg.isVisible("#dd-daily-panel .nav-ask"), false);
    await ctx.close();
  } finally { await browser.close(); srv.close(); }
});

test("Rain Print pages: the footer shows no sponsor link (Advertise or PRF sponsor)", { skip, timeout: 90000 }, async () => {
  const srv = await serve(), base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { ctx } = await context(browser, 1280, 900);
    const pg = await ctx.newPage();
    for (const [path, shown] of [["/rain-print", false], ["/about", true]]) {
      await pg.goto(base + path);
      await pg.waitForSelector("footer.footer", { timeout: 15000 });
      await pg.waitForTimeout(300);
      const vis = await pg.evaluate(() => [...document.querySelectorAll('footer.footer a[href^="/sponsor"], footer.footer a[href="/prf-sponsor"]')].map((a) => !!a.getClientRects().length));
      // Advertise and PRF sponsor under Work with us, and (Oct 22) Advertise with AGSIST in the bottom row
      assert.equal(vis.length, 3, path);
      assert.ok(vis.every((v) => v === shown), `${path}: ${vis}`);
    }
    await ctx.close();
  } finally { await browser.close(); srv.close(); }
});

/* 2026-10-22: the Daily panel fades in and is hidden until its fade starts at a frame. On a busy machine the one
   focus try at 60 ms came first, so Free daily email opened the panel with nothing in focus (CI, about 1 in 8 under
   load). Here the fade starts late on purpose (as a slow phone does): the box still gets the focus once it shows. */
test("Free daily email lands in the signup box even when the panel's fade starts late", { skip, timeout: 60000 }, async () => {
  const srv = await serve(), base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { ctx } = await context(browser, 1280, 800);
    const pg = await ctx.newPage();
    await pg.goto(base + "/about");
    await pg.waitForSelector("#nav-email", { state: "visible", timeout: 15000 });
    await pg.waitForSelector("#dd-daily-panel .nav-ask input[type=email]", { state: "attached", timeout: 15000 });
    await pg.addStyleTag({ content: "#dd-daily-panel{transition-delay:.2s!important}" });
    await pg.click("#nav-email");
    await pg.waitForFunction(() => document.activeElement && document.activeElement.matches("#dd-daily-panel .nav-ask input[type=email]"), null, { timeout: 5000 });
    assert.equal(await pg.getAttribute("#dd-daily .nav-btn", "aria-expanded"), "true");
    await ctx.close();
  } finally { await browser.close(); srv.close(); }
});
