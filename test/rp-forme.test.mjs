/* "Rather not fiddle with it?" on /rain-print (components/rp-forme.js, Sig
 * Oct 30, 2026): Sig makes two or three versions for a reader who would
 * rather call or leave a number, free; they order the one they pick.
 *
 *   - near the top of the page, with the tel link the page already uses;
 *   - the form posts kind rain-print-help through components/form-post.js:
 *     the worker first, Formspree when the worker does not know the kind;
 *   - scripts/form_digest.py and the morning report know the kind;
 *   - at 390 and 1280 it fits with no sideways scroll.
 * Every name and number here is made up. RPF_SHOTS=<dir> saves screenshots.
 *
 *   node --test test/rp-forme.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");
const require = createRequire(import.meta.url);
const F = require(ROOT + "components/rp-forme.js");
const SHOTS = process.env.RPF_SHOTS || "";
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

test("phone or email: what counts", () => {
  assert.equal(F.contactKind("715-555-0101"), "phone");
  assert.equal(F.contactKind("(715) 555 0101"), "phone");
  assert.equal(F.contactKind("+1 715 555 0101"), "phone");
  assert.equal(F.contactKind("ann@farm.example"), "email");
  assert.equal(F.contactKind("555"), "");
  assert.equal(F.contactKind("call me"), "");
  assert.equal(F.contactKind("ann@farm"), "");
});

test("the form's checks and what is sent", () => {
  const ok = { name: "Ann", contact: "715-555-0101", place: "Chetek, WI", for_whom: "My dad", note: "" };
  assert.deepEqual(F.check(ok), {});
  assert.deepEqual(Object.keys(F.check({})).sort(), ["contact", "for_whom", "name", "place"]);
  assert.ok(F.check(Object.assign({}, ok, { contact: "soon" })).contact);
  const p = F.payload(Object.assign({}, ok, { name: "  Ann\u0007 ", note: "Line one\r\nLine two" }));
  assert.deepEqual(p, { name: "Ann", contact: "715-555-0101", place: "Chetek, WI", for_whom: "My dad", page: "rain-print", note: "Line one\nLine two" });
  assert.ok(!("note" in F.payload(ok)), "an empty note is left out");
  assert.equal(F.payload(Object.assign({}, ok, { name: "x".repeat(300) })).name.length, 80);
  assert.equal(F.KIND, "rain-print-help");
  assert.doesNotMatch(read("components/rp-forme.js"), /—/);
});

test("on /rain-print near the top, the page's own tel link, the words Sig asked for, scripts loaded once", () => {
  const s = read("rain-print.html");
  const fm = s.indexOf('id="rp-fm"'), top = s.indexOf('class="rp-top"'), flow = s.indexOf('class="rp-flow"');
  assert.ok(top > 0 && fm > top && fm < flow, "inside the page head, before the print and the steps");
  const block = s.slice(fm, s.indexOf('<div id="rp-fm-out"', fm));
  const text = block.replace(/<[^>]+>/g, "").replace(/&rsquo;/g, "’").replace(/\s+/g, " ");
  assert.match(text, /Rather not fiddle with it\? Call or text me at \(715\) 797-2428, or leave your number and the place\. I’ll make two or three versions and email them to you to pick one\. No charge for the design help; you only pay if you order\./);
  assert.match(block, /href="tel:\+17157972428"/);
  for (const id of ["rp-fm-name", "rp-fm-contact", "rp-fm-place", "rp-fm-for", "rp-fm-note", "rp-fm-hp"]) assert.ok(block.includes('id="' + id + '"'), id);
  assert.equal((s.match(/components\/rp-forme\.js\?v=1" defer/g) || []).length, 1);
  assert.ok(s.indexOf("<script src=\"/components/form-post.js") > 0 && s.indexOf("<script src=\"/components/form-post.js") < s.indexOf("<script src=\"/components/rp-forme.js"), "form-post.js comes first");
  assert.doesNotMatch(block, /—/);
});

test("the digest and the morning report know the kind", () => {
  const fd = read("scripts/form_digest.py"), mr = read("scripts/morning_report.py");
  assert.match(fd, /KINDS = \([^)]*"rain-print-help"\)/);
  assert.match(fd, /"rain-print-help": \[\("name", "Name"\), \("contact", "Phone or email"\)/);
  assert.match(fd, /\("rain-print-help", "Rain Print help request", "Rain Print help requests"\)/);
  assert.match(mr, /WAITING = \([^)]*"rain-print-help"/);
});

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (!extname(p)) p += ".html";
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

async function page(browser, port, width, worker, posts) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width, height: 900 }, isMobile: width < 600, hasTouch: width < 600, timezoneId: "America/Chicago" });
  const pg = await ctx.newPage();
  await pg.route("**/*", (r) => {
    const u = r.request().url();
    if (u.startsWith("https://agsist-api.dnilgis.workers.dev/form")) {
      posts.push({ to: "worker", body: r.request().postData() });
      return worker === "ok" ? r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' })
        : r.fulfill({ status: 400, contentType: "application/json", body: '{"error":"unknown form"}' });
    }
    if (u.startsWith("https://formspree.io/")) { posts.push({ to: "formspree", body: r.request().postData() || "" }); return r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }); }
    return u.startsWith(`http://127.0.0.1:${port}`) ? r.continue() : r.abort();
  });
  await pg.goto(`http://127.0.0.1:${port}/rain-print`, { waitUntil: "load" });
  return { ctx, pg };
}

test("browser: opens, checks, sends to the worker or Formspree, fits at 390 and 1280", { skip, timeout: 240000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  try {
    for (const [width, worker] of [[390, "unknown"], [1280, "ok"]]) {
      const at = `at ${width}, worker ${worker}`, posts = [];
      const { ctx, pg } = await page(browser, port, width, worker, posts);
      assert.equal(await pg.locator("#rp-fm-form").isVisible(), false, at + ": the form starts closed");
      if (SHOTS) { await pg.locator("#rp-fm").scrollIntoViewIfNeeded(); await pg.screenshot({ path: join(SHOTS, "rain-print-help-" + width + ".png") }); }
      await pg.click("#rp-fm-open");
      assert.equal(await pg.locator("#rp-fm-open").getAttribute("aria-expanded"), "true");
      assert.equal(await pg.evaluate(() => document.activeElement && document.activeElement.id), "rp-fm-name", at + ": focus goes to the first box");
      await pg.click("#rp-fm-submit");
      assert.match(await pg.locator("#rp-fm-out").innerText(), /Your name/, at + ": an empty form says what is missing");
      assert.equal(posts.length, 0, at + ": nothing sent");
      await pg.fill("#rp-fm-name", "Ann Test");
      assert.equal(await pg.locator("#rp-fm-out").innerText(), "", at + ": typing a fix takes the old line away");
      await pg.fill("#rp-fm-contact", "715-555-0101");
      await pg.fill("#rp-fm-place", "Chetek, WI");
      await pg.fill("#rp-fm-for", "My dad");
      await pg.fill("#rp-fm-note", "The 1988 drought year");
      const fit = await pg.evaluate(() => ({ sw: document.documentElement.scrollWidth, vw: document.documentElement.clientWidth }));
      assert.ok(fit.sw <= fit.vw, `${at}: no sideways scroll with the form open (${fit.sw} > ${fit.vw})`);
      if (SHOTS) { await pg.locator("#rp-fm").scrollIntoViewIfNeeded(); await pg.screenshot({ path: join(SHOTS, "rain-print-help-open-" + width + ".png") }); }
      await pg.click("#rp-fm-submit");
      await pg.waitForSelector("#rp-fm-out .rp-ok", { timeout: 20000 });
      const w = JSON.parse(posts[0].body);
      assert.deepEqual(w, { kind: "rain-print-help", name: "Ann Test", contact: "715-555-0101", place: "Chetek, WI", for_whom: "My dad", page: "rain-print", note: "The 1988 drought year" }, at);
      if (worker === "ok") assert.equal(posts.length, 1, at + ": the worker took it, Formspree not asked");
      else {
        assert.equal(posts.length, 2, at + ": an unknown kind goes on to Formspree");
        assert.equal(posts[1].to, "formspree");
        assert.match(posts[1].body, /name="_subject"\r\n\r\nRain Print: make it for me, Ann Test, Chetek, WI/);
        assert.match(posts[1].body, /name="form"\r\n\r\nrain-print-help/);
      }
      assert.match(await pg.locator("#rp-fm-out").innerText(), /Thanks, I have it\..*two or three versions/s);
      assert.equal(await pg.locator("#rp-fm-form").isVisible(), false, at + ": the form closes once sent");
      await ctx.close();
    }
  } finally { await browser.close(); srv.close(); }
});
