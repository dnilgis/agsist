/* Advertise is easy to find (Sig, Oct 22 2026: "there is no place to easily find a place to inquire
 * about advertising or sponsoring a page, or at least I don't see it in the footer or header.
 * I still want to attract advertisers.").
 *   Header: a quiet Advertise link in the bar on wide screens; Advertise with AGSIST beside About in the phone panel.
 *   Footer: an Advertise with AGSIST line in the bottom row, which phones see without opening a folded column.
 *   Unsold page slot: one small "Sponsor this page" link to /sponsor-apply?tier=page&slot=<id>. No price, no box.
 *   Rain Print pages: none of it (no sponsor on Rain Print pages).
 *   Cash bid state and town pages: one slot per state (cash-bids-<state>).
 *
 *   node --test test/advertise-findable.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { extname, join, normalize } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

const header = read("components/header.html"), footer = read("components/footer.html");
const loader = read("components/loader.js");

test("header: Advertise in the bar (wide screens) and beside About in the phone panel, both marked for Rain Print pages", () => {
  const acts = header.slice(header.indexOf('<div class="nav-actions">'), header.indexOf("</nav>"));
  assert.match(acts, /<a href="\/sponsor" class="nav-adv" data-sponsor-link[^>]*>Advertise<\/a>/);
  assert.match(header, /@media \(min-width:1200px\)\{\.nav-adv\{display:inline-flex\}\}/, "shown only where the bar has room");
  const end = header.slice(header.indexOf('<div class="draw-sec draw-end">'));
  const at = (s) => { const i = end.indexOf(s); assert.ok(i > 0, s); return i; };
  assert.ok(at('href="/about"') < at('href="/sponsor"') && at('href="/sponsor"') < at('href="/contact"'), "About, Advertise, Contact");
  assert.match(end, /<a href="\/sponsor" class="draw-item" data-sponsor-link[^>]*>(?:<svg[\s\S]*?<\/svg>)Advertise with AGSIST<\/a>/);
  // the no-script copy carries it too
  assert.match(read("components/header-fallback.html"), /<a href="\/sponsor">Advertise with AGSIST<\/a>/);
  // loader.js hides the header's sponsor links wherever the page hides /sponsor
  assert.match(loader, /function headerSponsorHide\(hide\)/);
  assert.match(loader, /loadComponent\('site-header', '\/components\/header\.html', function \(\) \{ initNav\(\); headerSponsorHide\(noSponsor\); \}\)/);
});

test("footer: Advertise with AGSIST in the always-open bottom row, outside the folded columns, before the legal links", () => {
  const bottom = footer.slice(footer.indexOf('<div class="footer-bottom">'));
  const adv = bottom.indexOf('<p class="footer-adv"><a href="/sponsor" data-sponsor-link');
  assert.ok(adv > 0, "the bottom-row line");
  assert.ok(adv < bottom.indexOf('<div class="footer-legal">'), "before the legal links");
  assert.match(bottom, /<p class="footer-adv"><a href="\/sponsor" data-sponsor-link[^>]*>Advertise with AGSIST<\/a><\/p>/);
  assert.match(footer, /\.footer-adv a\{[^}]*min-height:44px/, "a 44 px tap target");
});

test("open slot: one plain Sponsor this page link with the slot picked, no price, only on a plain unsold ribbon", () => {
  const a = loader.indexOf("function openSlotLine"), b = loader.indexOf("function fillPageRibbons");
  assert.ok(a > 0 && b > a, "loader.js moved; update this test");
  const fn = loader.slice(a, b);
  assert.match(fn, /\/sponsor-apply\?tier=page&amp;slot=' \+ encodeURIComponent\(id\)/);
  assert.match(fn, />Sponsor this page<\/a>/);
  assert.match(fn, /rib\.className !== 'ag-sponsor-ribbon'/, "never the homepage card or a PRF slot");
  assert.doesNotMatch(fn, /\$\d|first month free|price/i, "no price");
  assert.match(loader, /if \(!noSponsor && \(!sp \|\| sp\.active === false\)\) openSlotLine\(rib, id\);/, "only when unsold and the page takes a sponsor");
});

test("cash bid pages: one sponsor slot per state, listed for the sign-up form", () => {
  const src = read("scripts/build_cash_bid_pages.py");
  assert.match(src, /return f'<aside class="ag-sponsor-ribbon" data-slot="cash-bids-\{ssl\}"><\/aside>'/);
  assert.equal((src.match(/\{sponsor_slot\(ssl\)\}/g) || []).length, 2, "the town page and the state page");
  const out = execFileSync("python3", ["-c", [
    "import sys, json; sys.path.insert(0, 'scripts'); import stamp_rates as S",
    "e = S.slot_entry('cash-bids/new-york/index.html', '<aside class=\"ag-sponsor-ribbon\" data-slot=\"cash-bids-new-york\"></aside>', {})",
    "print(json.dumps(e)); print(any(p.name == 'index.html' and p.parent.parent.name == 'cash-bids' for p in S.pages()))",
  ].join("\n")], { cwd: ROOT, encoding: "utf8" }).trim().split("\n");
  const e = JSON.parse(out[0]);
  assert.deepEqual(e, { id: "cash-bids-new-york", page: "/cash-bids/new-york", name: "New York cash bids",
    pitch: "Your name beside the cash bids on the New York page and every New York town page. One category-exclusive slot." });
  assert.equal(out[1], "True");
  // the form groups them, and the bids job keeps the list in step with the state pages
  assert.match(read("components/sponsor-apply.js"), /s\.page\.indexOf\('\/cash-bids\/'\) === 0 \? groups\.bids/);
  const wf = read(".github/workflows/cash-bid-pages.yml");
  assert.match(wf, /run: python scripts\/stamp_rates\.py\n/);
  assert.match(wf, /git add -A cash-bids data\/pointers data\/sponsor-slots\.json /);
  // never on Rain Print pages: their slot lists stay clean (test/rain-no-sponsor.test.mjs holds the pages)
  assert.doesNotMatch(read("data/sponsor-slots.json"), /rain-print|rain-gauge|rp-gift/);
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
async function context(browser, width, height, sold) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width, height } });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  if (sold) await ctx.route(/\/data\/page-sponsors\.json/, (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify(sold) }));
  return ctx;
}
const shown = (pg, sel) => pg.evaluate((s) => [...document.querySelectorAll(s)].map((a) => !!a.getClientRects().length && getComputedStyle(a).visibility !== "hidden"), sel);

test("in a browser: phones see Advertise in the footer and the menu, wide screens in the bar, Rain Print pages see none", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    let ctx = await context(browser, 390, 844);
    let pg = await ctx.newPage();
    await pg.goto(base + "/about");
    await pg.waitForSelector("footer.footer .footer-adv a", { state: "attached", timeout: 15000 });
    await pg.waitForTimeout(300);
    // the footer columns are folded on a phone; the bottom-row line is not
    assert.equal(await pg.evaluate(() => [...document.querySelectorAll("footer.footer details.footer-col")].every((d) => !d.open)), true, "columns folded");
    assert.deepEqual(await shown(pg, "footer.footer .footer-adv a"), [true]);
    const r = await pg.evaluate(() => document.querySelector("footer.footer .footer-adv a").getBoundingClientRect().height);
    assert.ok(r >= 44, `tap target ${r}px`);
    assert.deepEqual(await shown(pg, "#topnav .nav-adv"), [false], "no bar link on a phone (the panel has it)");
    await pg.click("#hamburger");
    await pg.waitForTimeout(400);
    assert.deepEqual(await shown(pg, '#drawer a[href="/sponsor"]'), [true]);
    await ctx.close();

    ctx = await context(browser, 1280, 900);
    pg = await ctx.newPage();
    await pg.goto(base + "/about");
    await pg.waitForSelector("#topnav .nav-adv", { state: "visible", timeout: 15000 });
    // the bar still fits: menu buttons and actions never overlap
    const gap = await pg.evaluate(() => document.querySelector(".nav-actions").getBoundingClientRect().left - [...document.querySelectorAll(".nav-btn")].pop().getBoundingClientRect().right);
    assert.ok(gap > 0, `menu and actions overlap by ${-gap}px`);
    // Rain Print: no Advertise anywhere, header or footer
    await pg.goto(base + "/rain-print");
    await pg.waitForSelector("footer.footer", { timeout: 15000 });
    await pg.waitForSelector("#topnav", { timeout: 15000 });
    await pg.waitForTimeout(400);
    const hdr = await shown(pg, '#topnav a[href^="/sponsor"], #drawer a[href^="/sponsor"]');
    assert.ok(hdr.length === 2 && hdr.every((v) => !v), `Rain Print header: ${hdr}`);
    const ft = await shown(pg, 'footer.footer a[href^="/sponsor"]');
    assert.ok(ft.length >= 2 && ft.every((v) => !v), `Rain Print footer: ${ft}`);
    await ctx.close();
  } finally { await browser.close(); srv.close(); }
});

test("in a browser: an unsold slot shows one Sponsor this page link; a sold one shows the sponsor", { skip, timeout: 90000 }, async () => {
  const srv = await serve(), base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    let ctx = await context(browser, 390, 844, { slots: {} });
    let pg = await ctx.newPage();
    await pg.goto(base + "/cash-bids");
    await pg.waitForSelector("aside.ag-sponsor-ribbon--open a.ag-open-slot", { state: "visible", timeout: 15000 });
    const o = await pg.evaluate(() => { const a = document.querySelector("aside.ag-sponsor-ribbon a"); return [a.getAttribute("href"), a.textContent, a.getBoundingClientRect().height, document.querySelector("aside.ag-sponsor-ribbon").textContent]; });
    assert.equal(o[0], "/sponsor-apply?tier=page&slot=cash-bids");
    assert.equal(o[1], "Sponsor this page");
    assert.ok(o[2] >= 44, `tap target ${o[2]}px`);
    assert.equal(o[3], "Sponsor this page", "nothing else in the slot: no price");
    await ctx.close();

    ctx = await context(browser, 1280, 900, { slots: { "cash-bids": { company: "Acme Seed", url: "https://acme.example", start: "2026-01-01", active: true } } });
    pg = await ctx.newPage();
    await pg.goto(base + "/cash-bids");
    await pg.waitForSelector("aside.ag-sponsor-ribbon--sold", { state: "visible", timeout: 15000 });
    assert.equal(await pg.locator("a.ag-open-slot").count(), 0);
    assert.match(await pg.textContent("aside.ag-sponsor-ribbon"), /Acme Seed/);
    await ctx.close();

    // a sold slot that starts later: taken, so nothing shows (no open line, no sponsor yet)
    ctx = await context(browser, 1280, 900, { slots: { "cash-bids": { company: "Acme Seed", url: "https://acme.example", start: "2099-01-01", active: true } } });
    pg = await ctx.newPage();
    await pg.goto(base + "/cash-bids");
    await pg.waitForTimeout(1200);
    assert.deepEqual(await shown(pg, "aside.ag-sponsor-ribbon"), [false]);
    await ctx.close();
  } finally { await browser.close(); srv.close(); }
});
