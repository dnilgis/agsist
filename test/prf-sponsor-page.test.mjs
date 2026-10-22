/* /prf-sponsor: prf-sponsor.html and components/prf-sponsor-page.js.
 *
 * WHY. PRF state slots sell passively (Sig, 2026-10-13): a stranger lands on
 * this page from a PRF offer, sees their own block and asks, with no call
 * from Sig. So the page must: offer only the states that have PRF pages, tick
 * the one the link names, draw the preview with the PRF pages' own code, send
 * what the worker (kind prf-sponsor, v5.22) accepts, and never print a price
 * or "founding". The example business below lives only in this file.
 *
 *   node --test test/prf-sponsor-page.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const PG = require(ROOT + "components/prf-sponsor-page.js");
const SP = require(ROOT + "components/prf-sponsor.js");
const HTML = readFileSync(ROOT + "prf-sponsor.html", "utf8");
const meta = JSON.parse(readFileSync(ROOT + "data/prf/meta.json", "utf8"));
const PRICE = /\$\s?\d|\d+\s?(dollars|\/mo|per month|a month|a year)/i;
const KNOWN = Object.fromEntries(meta.states.map((s) => [s.st, { name: s.name, n: s.counties }]));
const OK = { business: "Plains Crop Insurance", line: "PRF and livestock coverage for western Kansas.", phone: "785-555-0100",
  website: "plains.example/prf", states: ["NE", "KS"], name: "Dana Roe", email: "dana@plains.example", message: "" };

test("the state boxes are exactly the PRF states, with their county counts", () => {
  const boxes = [...HTML.matchAll(/<input type="checkbox" name="states" value="([A-Z]{2})" data-name="([^"]+)" data-counties="(\d+)">/g)];
  assert.equal(boxes.length, meta.states.length);
  for (const [, st, name, n] of boxes) {
    assert.ok(KNOWN[st], st);
    assert.equal(name, KNOWN[st].name, st);
    assert.equal(+n, KNOWN[st].n, st + " county count");
  }
  assert.ok(!/value="HI"/.test(HTML), "no Hawaii: it has no PRF pages");
  assert.ok(HTML.includes(`${meta.counts.counties.toLocaleString("en-US")} county pages across ${meta.states.length} states`));
});

test("?state= ticks only the page's own states", () => {
  assert.deepEqual(PG.prefill("?state=IA", KNOWN), ["IA"]);
  assert.deepEqual(PG.prefill("?state=ia,ne,IA", KNOWN), ["IA", "NE"]);
  assert.deepEqual(PG.prefill("?state=HI", KNOWN), []);
  assert.deepEqual(PG.prefill("?state=%22%3E%3Cscript%3E", KNOWN), []);
  assert.deepEqual(PG.prefill("?state=__proto__", KNOWN), []);
  assert.deepEqual(PG.prefill("", KNOWN), []);
});

test("the form's rules match the worker's", () => {
  assert.deepEqual(PG.check(OK), {});
  assert.deepEqual(PG.check({ ...OK, phone: "", website: "", line: "", message: "" }), {}, "phone, website, line and message are optional");
  for (const [patch, k] of [[{ business: "" }, "business"], [{ business: "b".repeat(121) }, "business"], [{ business: "Farmers First Agri" }, "business"],
      [{ name: "" }, "name"], [{ email: "" }, "email"], [{ email: "nope@x" }, "email"], [{ states: [] }, "states"],
      [{ phone: "555-0100" }, "phone"], [{ phone: "call me" }, "phone"], [{ website: "javascript:alert(1)" }, "website"],
      [{ website: "not a site" }, "website"], [{ line: "x".repeat(121) }, "line"], [{ message: "m".repeat(1001) }, "message"]]) {
    assert.ok(PG.check({ ...OK, ...patch })[k], JSON.stringify(patch));
  }
});

test("what is sent: states A to Z, website with https, empty fields left out, no price", () => {
  const p = PG.payload(OK);
  assert.deepEqual(p, { business: OK.business, name: OK.name, email: OK.email, states: "KS, NE", page: "/prf-sponsor",
    phone: OK.phone, line: OK.line, website: "https://plains.example/prf" });
  assert.deepEqual(Object.keys(PG.payload({ ...OK, phone: "", line: "", website: "", message: "" })).sort(), ["business", "email", "name", "page", "states"]);
  assert.equal(PG.subject(p), "PRF sponsor inquiry: Plains Crop Insurance (KS, NE)", "the same subject the digest uses");
  const b = PG.bodyText(p);
  assert.ok(b.includes("States: KS, NE") && b.includes("Email: dana@plains.example") && !PRICE.test(b));
});

test("the preview is the PRF pages' own block, escaped, with sample words when empty", () => {
  const sp = PG.previewSp(OK, "KS");
  const h = SP.render(sp, "Kansas", "state");
  assert.ok(h.startsWith('<span class="ag-sponsor-tag">Sponsor</span>'));
  assert.ok(h.includes("PRF in Kansas is sponsored by Plains Crop Insurance."));
  assert.ok(h.includes(OK.line) && h.includes(">785-555-0100</span>."));
  assert.ok(h.includes("AGSIST is free because businesses like Plains Crop Insurance pay for it."));
  assert.ok(h.includes('href="https://plains.example/prf"'));
  const bad = SP.render(PG.previewSp({ business: '<img src=x onerror=alert(1)>', line: "<b>x</b>", website: "javascript:alert(1)" }, "KS"), "Kansas", "county");
  assert.ok(!bad.includes("<img src=x") && !bad.includes("<b>x") && !bad.includes("javascript:"));
  const empty = PG.previewSp({}, "");
  assert.equal(empty.name, PG.SAMPLE.name);
  assert.equal(empty.line, PG.SAMPLE.line);
  assert.equal(PG.previewSp({ ...OK, phone: "12" }, "KS").phone, "", "a half-typed phone is not drawn");
});

test("the page: indexable, FAQ in JSON-LD, the terms, no price, no founding, no counters", () => {
  assert.match(HTML, /<link rel="canonical"\s+href="https:\/\/agsist\.com\/prf-sponsor">/);
  assert.match(HTML, /<meta name="robots" content="index, follow/);
  const ld = JSON.parse(HTML.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  const faq = ld["@graph"].find((x) => x["@type"] === "FAQPage");
  assert.ok(faq && faq.mainEntity.length >= 5);
  for (const q of faq.mainEntity) assert.ok(HTML.includes(q.name.replace(/'/g, "&#x27;")) || HTML.includes(q.name), "FAQ shown on the page: " + q.name);
  for (const t of ["One business per state.", "Price on request.", "Prepaid.", "through Dec 31", "first say on renewing",
      "A sponsor has no say over any figure.", "USDA RMA", "Farmers First never takes a sponsor slot"]) assert.ok(HTML.includes(t), t);
  for (const who of ["Crop insurance agencies", "Ag lenders", "Ranch supply", "Cattle buyers", "Seed dealers", "Fencing dealers"]) assert.ok(HTML.includes(who), who);
  const text = HTML.replace(/<style>[\s\S]*?<\/style>/, "").replace(/<!--[\s\S]*?-->/g, "");
  assert.ok(!PRICE.test(text), "no price on the page");
  assert.ok(!/founding/i.test(text));
  assert.ok(!/(states?|slots?) (left|open|available)/i.test(text), "no open-slot counters");
  assert.ok(!/sponsor-apply/.test(text), "PRF slots stay out of /sponsor-apply");
  assert.ok(text.includes('href="mailto:sig@agsist.com?subject=PRF%20state%20sponsor"'), "email Sig is there as the second way");
  assert.ok(!/[—]|&mdash;/.test(text), "no em dashes");
  assert.ok(HTML.indexOf("/components/prf-sponsor.js?v=5") < HTML.indexOf("/components/prf-sponsor-page.js"), "the renderer loads before the page script");
  assert.ok(!/data-prf-spon=/.test(HTML), "nothing on this page is swapped for a real sponsor");
});

test("listed in the sitemap and linked from the advertise page", () => {
  assert.ok(readFileSync(ROOT + "sitemap.xml", "utf8").includes("<loc>https://agsist.com/prf-sponsor</loc>"));
  assert.ok(readFileSync(ROOT + "sponsor.html", "utf8").includes('href="/prf-sponsor"'));
});

// 2026-10-20 (business walk-through, /prf-sponsor?state=IA on a phone: Send sat under all 48 state boxes).
// With a state from the link the boxes fold behind "Add more states"; without one the list stays open.
import { existsSync as _exists } from "node:fs";
import { createServer as _createServer } from "node:http";
import { extname as _extname, join as _join, normalize as _normalize } from "node:path";
const _PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const _CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let _chromium = null;
try { if (_exists(_PW)) ({ chromium: _chromium } = await import(_PW)); } catch (e) { _chromium = null; }
const _skip = !_chromium || !_exists(_CHROME) ? "Playwright or Chromium not found here" : false;

test("the folded list's line names what is ticked", () => {
  assert.equal(PG.pickedLine(["Iowa"]), "Ticked: Iowa.");
  assert.equal(PG.pickedLine(["Iowa", "Kansas"]), "Ticked: Iowa and Kansas.");
  assert.equal(PG.pickedLine(["Iowa", "Kansas", "Nebraska"]), "Ticked: Iowa, Kansas and Nebraska.");
  assert.equal(PG.pickedLine([]), "No state ticked yet.");
  assert.match(HTML, /<button type="button" class="cl-btn2 ps-more" id="ps-more" aria-expanded="false" aria-controls="ps-states-list" hidden>Add more states<\/button>/);
  assert.match(HTML, /<div class="ps-states" id="ps-states-list">/, "open in the HTML: folded only by the script, only with ?state=");
  assert.match(HTML, /\.ps-states\[hidden\]\{display:none\}/, "the grid rule cannot override hidden");
});

test("browser: ?state=IA folds the 48 boxes so Send is near the top on a phone; no ?state= keeps them open", { skip: _skip, timeout: 120000 }, async () => {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };
  const srv = _createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (!_extname(p) && p !== "/") p += ".html";
    const f = _normalize(_join(ROOT, p));
    if (!f.startsWith(ROOT) || !_exists(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[_extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
  const base = "http://127.0.0.1:" + srv.address().port;
  const browser = await _chromium.launch({ executablePath: _CHROME });
  try {
    for (const width of [390, 1280]) {
      const ctx = await browser.newContext({ viewport: { width, height: 844 }, serviceWorkers: "block" });
      const p = await ctx.newPage();
      const errors = [];
      p.on("pageerror", (e) => errors.push(e.message));
      await p.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
      const sendY = () => p.evaluate(() => document.getElementById("ps-send").getBoundingClientRect().top - document.getElementById("ps-form").getBoundingClientRect().top);

      await p.goto(base + "/prf-sponsor");
      assert.equal(await p.locator("#ps-states-list").isVisible(), true, "open without ?state=");
      assert.equal(await p.locator("#ps-more").isHidden(), true);
      const openY = await sendY();

      await p.goto(base + "/prf-sponsor?state=IA");
      assert.equal(await p.locator("#ps-states-list").isHidden(), true, "folded with ?state=");
      assert.equal(await p.locator("#ps-more").isVisible(), true);
      assert.equal(await p.textContent("#ps-picked"), "Ticked: Iowa.");
      assert.equal(await p.locator('input[name=states][value=IA]').isChecked(), true);
      const foldY = await sendY();
      if (width === 390) assert.ok(openY - foldY > 600, "Send moves up a long way on a phone: " + openY + " -> " + foldY);
      assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "no sideways scroll at " + width);
      // the preview's state picker ticks another state; the line follows it
      await p.selectOption("#ps-pick", "KS");
      assert.equal(await p.textContent("#ps-picked"), "Ticked: Iowa and Kansas.");
      // Add more states opens the list for good, focus on the first box
      await p.click("#ps-more");
      assert.equal(await p.locator("#ps-states-list").isVisible(), true);
      assert.equal(await p.locator("#ps-more").isHidden(), true);
      assert.equal(await p.getAttribute("#ps-more", "aria-expanded"), "true");
      assert.equal(await p.evaluate(() => document.activeElement && document.activeElement.name), "states");
      // no price, no counter came with the fold
      const txt = await p.textContent("#ask");
      assert.ok(!PRICE.test(txt) && !/(states?|slots?) (left|open|available)/i.test(txt));
      assert.deepEqual(errors, []);
      await ctx.close();
    }
  } finally { await browser.close(); srv.close(); }
});
