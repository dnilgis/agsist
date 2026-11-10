/* /sponsor-rates: the sponsor rates on one page, a link to send instead of an attachment.
 *   - every reader figure comes from data/audience.json (and the elevator count from data/elevator-counts.json)
 *     at load time; none is typed into the page, and a missing figure withholds its card;
 *   - prices and terms typed into the page are the rate card's (data/rate-card.json), and the page refreshes
 *     them from the card;
 *   - ?ref=<slug> (lower case letters, digits, dashes, at most 40) carries to the form link and the email subject;
 *     anything else is ignored; the canonical never carries it;
 *   - one column at 390 px, no sideways scroll at 390 or 1280.
 * The browser part needs Playwright and Chromium (PLAYWRIGHT_PATH, CHROMIUM_PATH).
 *   node --test test/sponsor-rates.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PW = process.env.PLAYWRIGHT_PATH || "/opt/node-tools/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;
const read = (p) => readFileSync(ROOT + p, "utf8");
const HTML = read("sponsor-rates.html");
const CARD = JSON.parse(read("data/rate-card.json"));
const US = "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" ");

test("national figures only: no state bars, one line offers a state's numbers", () => {
  assert.doesNotMatch(HTML, /states-box|Readers by state/);
  assert.match(HTML, /<p class="note" id="states-line">Ask for your state&rsquo;s numbers\.<\/p>/);
  assert.doesNotMatch(HTML, /x\.users\]|\[x\.name/, "no state figure is drawn");
});

test("head: noindex,follow, canonical without a query, share card, GA guard", () => {
  assert.match(HTML, /<meta name="robots" content="noindex,follow">/);
  assert.match(HTML, /<link rel="canonical" href="https:\/\/agsist\.com\/sponsor-rates">/);
  assert.match(HTML, /<meta property="og:url" content="https:\/\/agsist\.com\/sponsor-rates">/);
  assert.match(HTML, /<meta property="og:image" content="https:\/\/agsist\.com\/img\/og\/sponsor\.jpg/);
  assert.match(HTML, /agsist-ga-guard/);
  assert.equal((HTML.match(/<title>/g) || []).length, 1);
  assert.doesNotMatch(read("sitemap.xml"), /sponsor-rates/, "noindex page stays out of the sitemap");
});

test("no em dash, no typed reader figure, real links", () => {
  assert.doesNotMatch(HTML, /—|&mdash;/);
  const cards = [...HTML.matchAll(/<div class="stat" data-card="[a-z]+" hidden>(.*?)<\/div>/g)].map((m) => m[1]);
  assert.equal(cards.length, 6, "six reader cards");
  for (const c of cards) {
    assert.match(c, /^<b><\/b>/, "the figure starts empty: " + c);
    assert.doesNotMatch(c.replace(/<span class="l">[^<]*<\/span>/, "").replace(/<[^>]+>/g, " "), /\d/, "a card typed a number: " + c);
  }
  assert.match(HTML, /href="\/sponsor-apply"/);
  assert.match(HTML, /href="mailto:sig@agsist\.com\?subject=AGSIST%20sponsorship"/);
  assert.match(HTML, /href="tel:\+17157972428">715-797-2428</);
  assert.match(HTML, /href="\/sponsor-kit">Print or save as PDF</);
  assert.match(read("sponsor.html"), /<a href="\/sponsor-rates">One-page summary<\/a>/);
});

test("typed prices and terms are the rate card's", () => {
  for (const t of CARD.tiers) {
    const m = HTML.match(new RegExp(`data-k="p-${t.id}">\\$(\\d+)<`));
    assert.ok(m, "price slot for " + t.id);
    assert.equal(+m[1], t.price_month, t.id + " price");
    assert.ok(HTML.includes(t.name), "names the " + t.name);
  }
  const st = CARD.tiers.find((t) => t.id === "state");
  const by = {};
  for (const [s, p] of Object.entries(st.price_by_state || {})) if (!(st.opens_soon || []).includes(s) && p !== st.price_month) (by[p] = by[p] || []).push(s);
  const note = Object.keys(by).map((p) => `$${p} in ${by[p].join(", ")}`).join("; ");
  assert.ok(HTML.includes(`data-k="state-note">${note}<`), "state note is the card's: " + note);
  assert.ok(HTML.includes(`data-k="f-n">${CARD.founding.sponsors}<`) && HTML.includes(`data-k="f-m">${CARD.founding.months}<`));
  assert.match(CARD.prepay, /12/); assert.match(HTML, /12 months for the price of 10/);
  assert.match(HTML, /First month free/);
  assert.match(HTML, /No reply means the ad comes down and nothing is owed/);
  assert.match(HTML, /Sponsors never change data, rankings or bid order/);
});

/* What the page should show for a given audience file, by the page's own rules. null = withheld. */
function expected(a, e) {
  const n = (x) => Number(x).toLocaleString("en-US");
  const ok = (x) => typeof x === "number" && isFinite(x) && x > 0;
  const t = a?.totals?.["28d"] || {}, y = a?.totals?.ytd || {};
  const wy = (a?.ranges || []).find((r) => r.id === "ytd");
  const org = (a?.channels?.["28d"] || []).find((c) => c.channel === "Organic Search");
  const dev = a?.devices?.["28d"];
  let phone = null;
  if (dev && ok(dev.mobile)) { const all = Object.values(dev).filter(ok).reduce((s, v) => s + v, 0); if (all) phone = Math.round(dev.mobile / all * 100) + "%"; }
  return {
    users: ok(t.users) ? n(t.users) : null,
    search: org && ok(org.sessions) && ok(t.sessions) && org.sessions <= t.sessions ? Math.round(org.sessions / t.sessions * 100) + "%" : null,
    ytd: ok(y.users) && wy ? n(y.users) : null,
    elev: ok(e?.bids?.elevators) ? n(e.bids.elevators) : null,
    subs: ok(a?.email?.subscribers) && a?.email?.asOf ? n(a.email.subscribers) : null,
    phone,
  };
}

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".woff2": "font/woff2", ".html": "text/html", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };
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

async function open(browser, port, { width = 390, query = "", stub = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: "block" });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  if (stub) await ctx.route(/\/data\/(audience|elevator-counts)\.json/, stub);
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${port}/sponsor-rates${query}`, { waitUntil: "networkidle" });
  return { ctx, page };
}

const state = (page) => page.evaluate(() => {
  const cards = {};
  document.querySelectorAll("[data-card]").forEach((c) => { cards[c.dataset.card] = c.hidden ? null : c.querySelector("b").textContent; });
  const cols = new Set([...document.querySelectorAll(".tier")].map((t) => Math.round(t.getBoundingClientRect().left)));
  return {
    cards,
    sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
    tiers: document.querySelectorAll(".tier").length, tierCols: cols.size,
    prices: [...document.querySelectorAll("[data-k^=p-]")].map((p) => p.textContent),
    stateLine: document.getElementById("states-line").textContent,
    text: document.body.innerText,
    pages: document.querySelectorAll("#pages .row").length, pagesShown: !document.getElementById("pages-box").hidden,
    none: !document.getElementById("reach-none").hidden,
    win: document.getElementById("win").hidden ? "" : document.getElementById("win").textContent,
    apply: document.getElementById("apply").getAttribute("href"),
    tierLinks: [...document.querySelectorAll("a[data-apply]")].map((a) => a.getAttribute("href")),
    mail: document.getElementById("mail").getAttribute("href"),
    tel: !!document.querySelector('a[href="tel:+17157972428"]'),
    canonical: document.querySelector("link[rel=canonical]").href,
  };
});

for (const width of [390, 1280]) {
  test(`at ${width} px with the live data files: every figure shown or honestly withheld, no sideways scroll`, { skip }, async () => {
    const srv = await serve(), port = srv.address().port;
    const browser = await chromium.launch({ executablePath: CHROME });
    try {
      const { page } = await open(browser, port, { width });
      const s = await state(page);
      let a = null, e = null;
      try { a = JSON.parse(read("data/audience.json")); } catch (x) { a = null; }
      try { e = JSON.parse(read("data/elevator-counts.json")); } catch (x) { e = null; }
      assert.deepEqual(s.cards, expected(a, e), "cards follow the data files");
      assert.equal(s.none, Object.values(s.cards).every((v) => v === null), "the withheld note shows only when no card does");
      assert.ok(s.sw <= s.cw, `no sideways scroll: ${s.sw} > ${s.cw}`);
      assert.equal(s.tiers, 4);
      assert.deepEqual(s.prices, CARD.tiers.map((t) => t.id).sort((x, y) => ["daily", "cashbids", "state", "elevator"].indexOf(x) - ["daily", "cashbids", "state", "elevator"].indexOf(y))
        .map((id) => "$" + CARD.tiers.find((t) => t.id === id).price_month + " /mo"));
      assert.equal(s.tierCols, width < 760 ? 1 : 4, "one column on a phone, four across at 1280");
      assert.ok(s.tel && s.mail.startsWith("mailto:sig@agsist.com"));
      assert.ok(s.pages <= 6);
      const k = (a?.states?.["28d"] || []).filter((x) => x && x.users > 0 && US.includes(x.code)).length;
      assert.equal(s.stateLine, s.win && k ? (k === 50 ? "Readers in all 50 states." : `Readers in ${k} state${k === 1 ? "" : "s"}.`) + " Ask for your state\u2019s numbers." : "Ask for your state\u2019s numbers.");
      for (const x of a?.states?.["28d"] || []) if (x && x.name) assert.ok(!s.text.includes(x.name), "a state is named on the page: " + x.name);
      if (s.win) assert.match(s.win, /^Last 28 days: [A-Z][a-z]{2} \d{1,2}(, \d{4})? to [A-Z][a-z]{2} \d{1,2}, \d{4}\./);
    } finally { await browser.close(); srv.close(); }
  });
}

test("no audience file, no counts file: every card withheld, the note says so, no bars, prices still shown", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { page } = await open(browser, port, { stub: (r) => r.fulfill({ status: 404, body: "" }) });
    const s = await state(page);
    assert.deepEqual(Object.values(s.cards), [null, null, null, null, null, null]);
    assert.ok(s.none && !s.pagesShown && s.win === "");
    assert.equal(s.stateLine, "Ask for your state\u2019s numbers.");
    assert.equal(s.prices.length, 4);
    assert.ok(s.sw <= s.cw);
  } finally { await browser.close(); srv.close(); }
});

test("a partial audience file shows only what it has", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  const aud = { totals: { "28d": { users: 1234, views: 5678 } }, ranges: [{ id: "28d", start: "2026-10-12", end: "2026-11-08" }],
    devices: { "28d": { desktop: 30, mobile: 70 } }, states: { "28d": [{ name: "Iowa", code: "IA", users: 9 }] } };
  try {
    const { page } = await open(browser, port, { stub: (r) => /audience/.test(r.request().url())
      ? r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(aud) }) : r.fulfill({ status: 404, body: "" }) });
    const s = await state(page);
    assert.deepEqual(s.cards, { users: "1,234", search: null, ytd: null, elev: null, subs: null, phone: "70%" });
    assert.ok(!s.none && !s.pagesShown);
    assert.equal(s.stateLine, "Readers in 1 state. Ask for your state\u2019s numbers.");
    assert.ok(!s.text.includes("Iowa") && !/(^|[^\d,])9([^\d,%]|$)/.test(s.text), "no state name or state figure on the page");
    assert.ok(s.win.startsWith("Last 28 days: ") && s.win.endsWith(". So far this year: not available."), s.win);
    assert.deepEqual(s.cards, expected(aud, null));
  } finally { await browser.close(); srv.close(); }
});

test("?ref: a valid slug reaches the form link and the email subject; anything else is ignored; canonical stays clean", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  const plain = { apply: "/sponsor-apply", mail: "mailto:sig@agsist.com?subject=AGSIST%20sponsorship",
    tierLinks: ["daily", "cashbids", "state", "elevator"].map((t) => "/sponsor-apply?tier=" + t) };
  try {
    let { page } = await open(browser, port, { query: "?ref=valley-coop-2" });
    let s = await state(page);
    assert.equal(s.apply, "/sponsor-apply?ref=valley-coop-2");
    assert.deepEqual(s.tierLinks, plain.tierLinks.map((h) => h + "&ref=valley-coop-2"));
    assert.equal(s.mail, "mailto:sig@agsist.com?subject=" + encodeURIComponent("AGSIST sponsor: valley-coop-2"));
    assert.equal(s.canonical, "https://agsist.com/sponsor-rates");
    for (const bad of ["Valley-Coop", "a_b", "x%3Cb%3E", "a".repeat(41), "", "ok%20no"]) {
      ({ page } = await open(browser, port, { query: "?ref=" + bad }));
      s = await state(page);
      assert.deepEqual({ apply: s.apply, mail: s.mail, tierLinks: s.tierLinks }, plain, "ref " + bad + " ignored");
      assert.equal(s.canonical, "https://agsist.com/sponsor-rates");
    }
    ({ page } = await open(browser, port));
    s = await state(page);
    assert.deepEqual({ apply: s.apply, mail: s.mail, tierLinks: s.tierLinks }, plain, "no ref");
    ({ page } = await open(browser, port, { query: "?ref=" + "b".repeat(40) }));
    s = await state(page);
    assert.equal(s.apply, "/sponsor-apply?ref=" + "b".repeat(40), "40 characters is allowed");
    const cookies = await page.context().cookies();
    assert.deepEqual(cookies, [], "no cookie set");
    const stored = await page.evaluate(() => { try { return Object.keys(localStorage).filter((k) => /ref/i.test(k)).concat(Object.keys(sessionStorage).filter((k) => /ref/i.test(k))); } catch (e) { return []; } });
    assert.deepEqual(stored, [], "ref not stored");
  } finally { await browser.close(); srv.close(); }
});
