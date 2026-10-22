/* The front door on agsist.com (Sig, Oct 22 2026; BUILD-RULES 11).
 * Every link AGSIST emails goes to agsist.com/e?a=<route>&k=<lid>&t=<hmac>
 * (scripts/email_links.py); e.html asks the subs worker from the reader's
 * browser (GET /fd/<route>, subs worker v5.48) and its button POSTs.
 *   1. worker OK: the real worker (in-memory KV) answers; the question, then
 *      the button stops the Daily; no address on screen or in any URL
 *   2. worker blocked: Cloudflare's 403 HTML page with no CORS -> two plain
 *      lines and the mailto stop, no error dump, nothing changed
 *   3. worker down (connection refused), or a page instead of JSON -> the same
 *   4. a confirm link with the worker down: "try again later", no stop line
 *   5. a broken or unknown link: says so plainly
 *   6. the page by its source: noindex, not in the sitemap, the routes match
 *      the worker's FD_ROUTES and email_links.FRONT_ROUTES, no em dash
 * Screenshots at 390 and 1280 go to $FD_SHOTS when it is set.
 *
 *   node --test test/frontdoor-page.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => fs.readFileSync(ROOT + p, "utf8");
const PAGE = read("e.html");
const W = "https://agsist-api.dnilgis.workers.dev";
const SHOTS = process.env.FD_SHOTS || "";

test("the page by its source: noindex, no nav weight, routes match the worker and the link maker", () => {
  assert.match(PAGE, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(PAGE, /<meta name="referrer" content="no-referrer">/);
  assert.ok(!/—/.test(PAGE), "no em dash on the page");
  assert.ok(!read("sitemap.xml").includes("agsist.com/e<") && !read("sitemap.xml").includes("/e.html"), "not in the sitemap");
  assert.ok(Buffer.byteLength(PAGE) < 12000, "a tiny page");
  const pageRoutes = Object.keys(JSON.parse("{" + /var ROUTES = \{([\s\S]*?)\};/.exec(PAGE)[1].replace(/'/g, '"') + "}")).sort();
  const wsrc = read("workers/subs-worker.js");
  const fd = /const FD_ROUTES = new Set\(\[([\s\S]*?)\]\)/.exec(wsrc)[1].match(/"\/([^"]+)"/g).map((s) => s.slice(2, -1)).sort();
  assert.deepEqual(pageRoutes, fd, "the page knows exactly the worker's /fd/ routes");
  const py = /FRONT_ROUTES = \{([\s\S]*?)\}/.exec(read("scripts/email_links.py"))[1].match(/"([^"]+)"/g).map((s) => s.slice(1, -1)).filter((r) => r !== "logo").sort();
  assert.deepEqual(py, fd, "email_links links only to routes the page and the worker know");
  assert.ok(!/innerHTML/.test(PAGE), "the worker's words go in as text, never as HTML");
});

const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (fs.existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !fs.existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

// the real worker, against an in-memory KV
const tmp = path.join(os.tmpdir(), "subs-worker-fdpage-" + process.pid + ".mjs");
fs.copyFileSync(ROOT + "workers/subs-worker.js", tmp);
const worker = (await import(pathToFileURL(tmp).href)).default;
fs.unlinkSync(tmp);
const store = new Map();
const env = { UNSUB_SECRET: "sec", LIST_TOKEN: "tok", SUBS: {
  async get(k) { return store.has(k) ? store.get(k) : null; }, async put(k, v) { store.set(k, v); },
  async delete(k) { store.delete(k); }, async list({ prefix }) { return { keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }; } } };
const t16 = (s) => crypto.createHmac("sha256", "sec").update(s.toLowerCase()).digest("hex").slice(0, 16);
const E = "made-up-reader@example.com", L = "abcdefghjkmnpqrs";
const LINK = "https://agsist.com/e?a=unsubscribe&k=" + L + "&t=" + t16(L);

async function withPage(mode, fn) {
  const browser = await chromium.launch({ executablePath: CHROME });
  const seen = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 760 } });
    const page = await ctx.newPage();
    await page.route("https://agsist.com/**", (r) => {
      const u = new URL(r.request().url());
      seen.push(u.href);
      if (u.pathname === "/e") return r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: PAGE });
      return r.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>x</title>" });
    });
    await page.route(W + "/**", async (r) => {
      seen.push(r.request().url());
      if (mode === "down") return r.abort("connectionrefused");
      if (mode === "blocked") return r.fulfill({ status: 403, contentType: "text/html",
        body: "<!DOCTYPE html><html><head><title>Suspected phishing site | Cloudflare</title></head><body><h1>Warning</h1></body></html>" });
      if (mode === "html") return r.fulfill({ status: 200, contentType: "text/html", headers: { "Access-Control-Allow-Origin": "https://agsist.com" }, body: "<html>hi</html>" });
      const q = r.request();
      const res = await worker.fetch(new Request(q.url(), { method: q.method(), headers: q.headers() }), env);
      const headers = {};
      res.headers.forEach((v, k) => { headers[k] = v; });
      return r.fulfill({ status: res.status, headers, body: await res.text() });
    });
    await fn(page, seen);
  } finally { await browser.close(); }
}
const text = (page) => page.locator("main").innerText();
async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  for (const w of [390, 1280]) {
    await page.setViewportSize({ width: w, height: w === 390 ? 760 : 800 });
    await page.screenshot({ path: path.join(SHOTS, name + "-" + w + ".png"), fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 760 });
}

test("worker OK: asks, the button stops the Daily, no address anywhere", { skip }, async () => {
  store.clear();
  store.set("lid:" + L, E);
  store.set("sub:" + E, JSON.stringify({ ts: 1, src: "hero" }));
  await withPage("ok", async (page, seen) => {
    await page.goto(LINK);
    await page.getByRole("button", { name: "Yes, unsubscribe" }).waitFor();
    let t = await text(page);
    assert.match(t, /Unsubscribe from AGSIST Daily\?/);
    assert.match(t, /Nothing happens until you press the button/);
    assert.ok(store.has("sub:" + E), "opening the link changes nothing");
    await shot(page, "frontdoor-ask");
    await page.getByRole("button", { name: "Yes, unsubscribe" }).click();
    await page.getByText("You're unsubscribed").waitFor();
    assert.ok(!store.has("sub:" + E), "the button stopped it");
    t = await text(page);
    assert.ok(!t.includes("@example.com") && !(await page.content()).includes(E), "no address on the page");
    assert.ok(seen.every((u) => !u.includes("%40") && !u.includes("@")), "no address in any URL");
    assert.ok(seen.some((u) => u.startsWith(W + "/fd/unsubscribe?k=" + L)), "the page asked /fd/ with the same k and t");
    await shot(page, "frontdoor-done");
  });
});

test("worker OK: the Daily elevators link hands back the agsist.com link", { skip }, async () => {
  store.clear();
  store.set("lid:" + L, E);
  store.set("sub:" + E, JSON.stringify({ ts: 1, src: "hero" }));
  await withPage("ok", async (page) => {
    await page.goto("https://agsist.com/e?a=daily-elev&k=" + L + "&t=" + t16(L + "|de"));
    await page.getByRole("button", { name: "Yes, link this browser" }).click();
    const a = page.getByRole("link", { name: /Open your saved elevators/ });
    await a.waitFor();
    assert.match(await a.getAttribute("href"), /^https:\/\/agsist\.com\/cash-bids#dk=[0-9a-z]{24}$/);
  });
});

for (const mode of ["blocked", "down", "html"]) {
  test("worker " + mode + ": two plain lines and the mailto stop, no error dump", { skip }, async () => {
    await withPage(mode, async (page) => {
      await page.goto(LINK);
      await page.getByText("This is not working right now").waitFor();
      const t = await text(page);
      assert.match(t, /To stop these emails now, email news@agsist\.com with the word unsubscribe\./);
      assert.match(t, /Or try again later\./);
      assert.ok(!/error|exception|TypeError|403|cloudflare|phishing|fetch/i.test(t), "no error dump: " + t);
      assert.equal(await page.getByRole("link", { name: "news@agsist.com" }).getAttribute("href"), "mailto:news@agsist.com?subject=unsubscribe");
      assert.ok(await page.getByRole("button", { name: "Try again" }).isVisible());
      if (mode === "blocked") await shot(page, "frontdoor-blocked");
    });
  });
}

test("a confirm link with the worker down: try again later, no stop line", { skip }, async () => {
  await withPage("down", async (page) => {
    await page.goto("https://agsist.com/e?a=watch-confirm&k=" + L + "&f=19169&t=" + t16(L + "|c|19169"));
    await page.getByText("This is not working right now").waitFor();
    const t = await text(page);
    assert.match(t, /Try again later\. Nothing was changed\./);
    assert.ok(!/news@agsist\.com/.test(t));
  });
});

test("a broken or unknown link says so plainly and asks nothing", { skip }, async () => {
  for (const u of ["https://agsist.com/e", "https://agsist.com/e?a=list&k=" + L + "&t=x", "https://agsist.com/e?a=unsubscribe&k=" + L]) {
    await withPage("ok", async (page, seen) => {
      await page.goto(u);
      await page.getByText("This link is not complete").waitFor();
      assert.ok(!seen.some((s) => s.startsWith(W)), "no call to the worker for " + u);
    });
  }
});
