/* The sponsor rates, Nov 11, 2026. The one-page rates sheet at /sponsor-rates folded into the booking
 * page /sponsor (two spots: the sitewide line and the state card). The rules the sheet carried hold on
 * /sponsor now, and the old address keeps working:
 *   - /sponsor-rates sends readers to /sponsor with their query and hash, stays noindex and out of the
 *     sitemap, and still shows a link card; it types no figure, no price and no offer of its own;
 *   - every reader figure on /sponsor is in a <span data-a> span written from data/audience.json
 *     (scripts/bake_audience.py --check), or drawn at load time from data/sponsor-spots.json; none is typed;
 *   - prices and terms typed into /sponsor are the rate card's (data/rate-card.json); no free month;
 *   - real links: a phone number, an email, and the booking form on the page;
 *   - ?ref=<slug> (lower case letters, digits, dashes, at most 40) rides on every email subject and the form's note;
 *     anything else is ignored; nothing is stored;
 *   - in a browser at 390 and 1280: the old address lands on /sponsor with its query, a state's numbers and
 *     price come from the data files (the home state's numbers are withheld), no sideways scroll; with the
 *     data files missing, the typed prices stay and no number is made up.
 * The browser part needs Playwright and Chromium (PLAYWRIGHT_PATH, CHROMIUM_PATH).
 *   node --test test/sponsor-rates.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
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
const OLD = read("sponsor-rates.html");
const SP = read("sponsor.html");
const CARD = JSON.parse(read("data/rate-card.json"));
const NAMES = { IL: "Illinois", MN: "Minnesota", WI: "Wisconsin", TX: "Texas", CA: "California", NV: "Nevada", IA: "Iowa" };
const n = (x) => Number(x).toLocaleString("en-US");
const meta = (h, attr, name) => {
  const m = h.match(new RegExp(`<meta\\s+${attr}="${name.replace(/[:.]/g, "\\$&")}"\\s+content="([^"]*)"`));
  return m ? m[1] : null;
};
const main = (h) => h.slice(h.indexOf("<main"), h.indexOf("</main>"));
const words = (h) => h.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ")
  .replace(/&rsquo;/g, "’").replace(/&middot;/g, "·").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const list = (a) => (a.length < 2 ? a.join("") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1]);

test("the old rates address: a redirect to /sponsor that keeps its query and hash, noindex, a link card, out of the sitemap", () => {
  assert.match(OLD, /<meta name="robots" content="noindex, follow">/);
  assert.match(OLD, /<link rel="canonical" href="https:\/\/agsist\.com\/sponsor">/);
  assert.match(OLD, /<meta http-equiv="refresh" content="0; url=https:\/\/agsist\.com\/sponsor">/);
  assert.match(OLD, /window\.location\.replace\("\/sponsor" \+ location\.search \+ \(location\.hash \|\| ""\)\);/);
  assert.equal((OLD.match(/<title>/g) || []).length, 1);
  for (const t of ["og:title", "og:description", "og:image", "og:image:alt"]) assert.ok(meta(OLD, "property", t), t);
  assert.equal(meta(OLD, "property", "og:url"), "https://agsist.com/sponsor");
  assert.equal(meta(OLD, "name", "twitter:image"), meta(OLD, "property", "og:image"));
  assert.doesNotMatch(read("sitemap.xml"), /sponsor-rates/, "noindex page stays out of the sitemap");
});

test("no em dash, no typed reader figure, real links", () => {
  for (const [f, h] of [["sponsor-rates.html", OLD], ["sponsor.html", SP]]) assert.doesNotMatch(h, /—|&mdash;/, f);
  // the old address types nothing a reader could read as a figure, a price or an offer
  const body = words(OLD.slice(OLD.indexOf("<body")));
  assert.doesNotMatch(body, /\d/, "the redirect page typed a number: " + body);
  assert.doesNotMatch(OLD, /\$|free month|founding|per month|a month/i);
  // /sponsor: every reader figure sits in a baked span the audience check owns, so none is typed by hand
  const r = spawnSync("python3", ["scripts/bake_audience.py", "--check"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(r.status, 0, "sponsor.html figures are data/audience.json's: " + r.stdout + r.stderr);
  const spans = [...SP.matchAll(/<span data-a="([a-z]+)">([^<]*)<\/span>/g)];
  assert.ok(spans.some((m) => m[1] === "engaged") && spans.some((m) => m[1] === "views") && spans.some((m) => m[1] === "win"), "the figures are in data-a spans");
  // outside those spans, the prices and the phone number, the page's text has only the fixed terms' numbers
  const rest = words(main(SP).replace(/<span data-a="[a-z]+">[^<]*<\/span>/g, " ").replace(/<a href="tel:[^"]*">[^<]*<\/a>/g, " "))
    .replace(/\$[\d,]+/g, " ").replace(/\bW-9\b/g, " ");
  const nums = [...rest.matchAll(/\d[\d,.]*/g)].map((m) => m[0]);
  const allowed = new Set(["28", "30", String(CARD.year_months), "90", "10"]);
  for (const x of nums) assert.ok(allowed.has(x), "a number typed into sponsor.html outside the data spans: " + x);
  assert.match(SP, /href="tel:\+17157972428">715-797-2428</);
  assert.match(SP, /href="mailto:sig@agsist\.com\?subject=AGSIST%20sponsor%20spot"/);
  assert.match(SP, /<form class="sp-form" id="spa-form"/);
  assert.match(SP, /href="#book" data-invoice="sitewide">Mail me a yearly invoice</);
});

test("typed prices and terms are the rate card's", () => {
  assert.deepEqual(CARD.tiers.map((t) => t.id), ["sitewide", "state"]);
  const sec = (id) => { const i = SP.indexOf(`data-spot="${id}"`); assert.ok(i > 0, id + " section"); return SP.slice(i, SP.indexOf("</section>", i)); };
  const sw = CARD.tiers[0], st = CARD.tiers[1];
  const swh = sec("sitewide"), sth = sec("state");
  assert.ok(swh.includes(sw.name) && sth.includes(st.name), "the spots are named as the card names them");
  assert.ok(swh.includes(`<p class="sp-price"><b>$${n(sw.price_month)} a month</b> or <b>$${n(sw.price_month * CARD.year_months)} a year</b></p>`), "sitewide price");
  const big = {};
  for (const [s, p] of Object.entries(st.price_by_state || {})) if (p !== st.price_month) (big[p] = big[p] || []).push(NAMES[s] || s);
  const bigTxt = Object.keys(big).map((p) => `<b>$${n(p)} a month</b> in ${list(big[p])}`).join(", ");
  assert.ok(sth.includes(`<p class="sp-price"><b>$${n(st.price_month)} a month</b> in most states, ${bigTxt}. A year costs the same as ${CARD.year_months} months.</p>`), "state price: " + bigTxt);
  assert.ok(sth.includes(`<p class="sp-fine">${list(st.opens_soon.map((s) => NAMES[s] || s))} open soon.</p>`), "the held states are the card's");
  assert.ok(swh.includes(`<p class="sp-what">${sw.placement}</p>`) && sth.includes(`<p class="sp-what">${st.placement.replace(/that state/g, "your state")}</p>`),
    "placements are the card's (the booking page says \"your state\" where the card says \"that state\")");
  const txt = words(main(SP));
  assert.ok(txt.includes(CARD.refund), "refund term: " + CARD.refund);
  assert.ok(txt.includes(CARD.prepay), "prepay term: " + CARD.prepay);
  assert.ok(txt.includes(CARD.paperwork), "paperwork: " + CARD.paperwork);
  assert.ok(txt.includes("Pay by card when you book, or ask for a yearly invoice by mail (net 30)."), "pay term");
  assert.ok(txt.includes("It goes live within one business day."), "review term");
  assert.match(CARD.prepay, new RegExp(`\\b${CARD.year_months} months\\b`));
  assert.doesNotMatch(SP, /first month free|free month|founding|No reply means the ad comes down/i);
  assert.match(txt, /Sponsors never change data, rankings or bid order/);
});

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

async function open(browser, port, { width = 390, path = "/sponsor", stub = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: "block" });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  if (stub) await ctx.route(/\/data\/(rate-card|sponsor-spots)\.json/, stub);
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${port}${path}`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelectorAll("#sp-state option").length > 1);
  return { ctx, page };
}

const look = (page) => page.evaluate(() => {
  const cols = new Set([...document.querySelectorAll(".sp-spot")].map((t) => Math.round(t.getBoundingClientRect().left)));
  return {
    url: location.pathname + location.search + location.hash,
    sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
    spots: document.querySelectorAll(".sp-spot").length, cols: cols.size,
    line: document.getElementById("sp-state-live").textContent,
    prices: [...document.querySelectorAll(".sp-price")].map((p) => p.textContent),
  };
});

for (const width of [390, 1280]) {
  test(`at ${width} px: the old address lands on /sponsor with its query; a state's numbers and price are the data files'; no sideways scroll`, { skip }, async () => {
    const srv = await serve(), port = srv.address().port;
    const browser = await chromium.launch({ executablePath: CHROME });
    const spots = JSON.parse(read("data/sponsor-spots.json"));
    try {
      let { page } = await open(browser, port, { width, path: "/sponsor-rates?state=IA#state" });
      let s = await look(page);
      assert.equal(s.url, "/sponsor?state=IA#state");
      assert.ok(s.sw <= s.cw, `no sideways scroll: ${s.sw} > ${s.cw}`);
      assert.equal(s.spots, 2);
      assert.equal(s.cols, 1, "the two spots stack");
      const ia = spots.states.IA || {}, p = CARD.tiers[1].price_month;
      const nums = ia.engaged > 0 && ia.views > 0 ? `${n(ia.engaged)} engaged visits from Iowa and ${n(ia.views)} views of Iowa pages in the last 28 days. `
        : ia.engaged > 0 ? `${n(ia.engaged)} engaged visits from Iowa in the last 28 days. `
        : ia.views > 0 ? `${n(ia.views)} views of Iowa pages in the last 28 days. ` : "";
      assert.equal(s.line, `Iowa: ${nums}$${n(p)} a month or $${n(p * CARD.year_months)} a year.`);
      ({ page } = await open(browser, port, { width, path: "/sponsor?state=WI" }));
      s = await look(page);
      const wp = CARD.tiers[1].price_by_state.WI;
      assert.ok(spots.states.WI.withheld, "the home state's numbers are withheld in the data file");
      assert.equal(s.line, `Wisconsin: $${n(wp)} a month or $${n(wp * CARD.year_months)} a year.`, "no number for the home state");
      assert.ok(s.sw <= s.cw);
    } finally { await browser.close(); srv.close(); }
  });
}

test("no rate card file, no spots file: the typed prices stay, the state line makes up no number", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { page } = await open(browser, port, { path: "/sponsor?state=IA", stub: (r) => r.fulfill({ status: 404, body: "" }) });
    const s = await look(page);
    assert.equal(s.prices.length, 2);
    assert.ok(s.prices[0].includes("$" + n(CARD.tiers[0].price_month) + " a month"), s.prices[0]);
    assert.ok(s.prices[1].includes("$" + n(CARD.tiers[1].price_month) + " a month"), s.prices[1]);
    assert.ok(s.line.startsWith("Iowa:"), s.line);
    assert.doesNotMatch(s.line, /\d/, "a number without its data file: " + s.line);
    assert.ok(s.sw <= s.cw);
  } finally { await browser.close(); srv.close(); }
});

test("?ref: a valid slug reaches every email subject and the form's note; anything else is ignored; nothing is stored", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  const SUBJ = "mailto:sig@agsist.com?subject=AGSIST%20sponsor%20spot";
  const faq = (page) => page.evaluate(() => document.querySelector('.sp-faq a[href^="mailto:"]').getAttribute("href"));
  try {
    let { ctx, page } = await open(browser, port, { path: "/sponsor-rates?ref=valley-coop-2" });
    assert.equal(await page.evaluate(() => location.pathname + location.search), "/sponsor?ref=valley-coop-2");
    assert.equal(await faq(page), SUBJ + encodeURIComponent(": valley-coop-2"));
    // the form's note carries it to the worker
    let posted = null;
    await ctx.route(/^https:\/\/agsist-api\.dnilgis\.workers\.dev\/sponsor-apply$/, (r) => { posted = JSON.parse(r.request().postData()); r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: '{"ok":true}' }); });
    await page.evaluate(() => {
      document.querySelector('input[name=tier][value="state"]').checked = true;
      const sel = document.getElementById("spa-state"); sel.value = "IA";
      for (const [id, v] of [["spa-company", "Valley Coop"], ["spa-contact", "Pat"], ["spa-email", "pat@example.com"], ["spa-headline", "Fair bids every day"], ["spa-url", "https://example.com"]]) document.getElementById(id).value = v;
      document.getElementById("spa-terms").checked = true;
    });
    await page.click("#spa-go");
    await page.waitForFunction(() => !document.getElementById("spa-done").hidden || /reach/.test(document.getElementById("spa-msg").textContent), null, { timeout: 10000 });
    assert.ok(posted, "the form posted");
    assert.equal(posted.body, "How I pay: yearly invoice by mail. Ref: valley-coop-2");
    assert.deepEqual(await ctx.cookies(), [], "no cookie set");
    const stored = await page.evaluate(() => { try { return Object.keys(localStorage).concat(Object.keys(sessionStorage)).filter((k) => /ref/i.test(k)); } catch (e) { return []; } });
    assert.deepEqual(stored, [], "ref not stored");
    await ctx.close();
    for (const bad of ["Valley-Coop", "a_b", "x%3Cb%3E", "a".repeat(41), "", "ok%20no"]) {
      ({ ctx, page } = await open(browser, port, { path: "/sponsor?ref=" + bad }));
      assert.equal(await faq(page), SUBJ, "ref " + bad + " ignored");
      await ctx.close();
    }
    ({ ctx, page } = await open(browser, port, { path: "/sponsor?ref=" + "b".repeat(40) }));
    assert.equal(await faq(page), SUBJ + encodeURIComponent(": " + "b".repeat(40)), "40 characters is allowed");
    await ctx.close();
  } finally { await browser.close(); srv.close(); }
});
