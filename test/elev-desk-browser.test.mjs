/* The elevator desk (elev-admin.html) and Sig's Today list (elev-today.html)
 * in Chromium, at 390 and 1280, the way Sig uses them. The pages are served
 * as https://agsist.com from this checkout, so the browser's own CORS checks
 * run against the real worker: workers/subs-worker.js answers in-process on an
 * in-memory KV (as scripts/test_elev_worker.mjs does). Nothing leaves the
 * machine. Paste input is test/fixtures/paste-bids (NEW Cooperative's board),
 * grown to 51 boards for the long preview Sig saw on Oct 20.
 * Needs Playwright and Chromium; skipped where they are missing.
 * SHOTS=<dir> saves a screenshot of each case there.
 *   node --test test/elev-desk-browser.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, copyFileSync, unlinkSync, mkdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join, normalize, extname } from "node:path";
import os from "node:os";
import { createRequire } from "node:module";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
const BIDS = process.env.BIDS_PATH || "/home/user/bids/";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;
const SHOTS = process.env.SHOTS || "";
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const WIDTHS = [390, 1280];
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const SUBS = "https://agsist-subs.dnilgis.workers.dev";
const TOK = "test-token-not-real";

/* ---- the worker, in-process ---- */
const tmp = join(os.tmpdir(), "subs-worker-desk-" + process.pid + ".mjs");
copyFileSync(join(ROOT, "workers/subs-worker.js"), tmp);
const W = (await import(pathToFileURL(tmp).href)).default;
unlinkSync(tmp);
function kv() {
  const store = new Map(), meta = new Map();
  return { store, SUBS: {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v, o) { store.set(k, v); if (o && o.metadata !== undefined) meta.set(k, o.metadata); else meta.delete(k); },
    async delete(k) { store.delete(k); meta.delete(k); },
    async list({ prefix, limit }) {
      const all = [...store.keys()].filter((k) => k.startsWith(prefix)).sort(), lim = limit || 1000;
      return { keys: all.slice(0, lim).map((name) => (meta.has(name) ? { name, metadata: meta.get(name) } : { name })), list_complete: all.length <= lim };
    } } };
}

/* ---- paste input: the real board, grown to 51 boards plus the three it prints that bids has no board for ---- */
const P = createRequire(import.meta.url)(join(ROOT, "components/paste-bids.js"));
const SRC = read("test/fixtures/paste-bids/newcoop-page-source.html");
function longPaste() {
  const a = SRC.indexOf('<h1 class="text-4xl'), b = SRC.indexOf('<h1 class="text-4xl', a + 10);
  const afton = SRC.slice(a, b);
  const have = new Set(["Afton", "Creston 1", "Creston 2", "LuVerne"]);
  const more = P.NEWCOOP_BOARDS.map((x) => x[1]).filter((n) => !have.has(n)).slice(0, 47).concat(["Cainsville", "Morton Mills"]);
  return SRC.slice(0, b) + more.map((n) => afton.replace(/>Afton\s*</, ">" + n + "<")).join("") + SRC.slice(b);
}
const LONG = longPaste();

/* The local bids index as Sig's Oct 20 morning had it: NEW Cooperative behind
   its bot check, last good read the day before. */
function blocked(ix) {
  for (const x of ix.sources || []) if (/^newcoop-/.test(x.id || "")) Object.assign(x, { health: "refused", error: "bot check: Cloudflare challenge page", checkedAt: "2026-10-19T15:30:29.149Z" });
  return ix;
}

/* ---- the browser ---- */
const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
/* o: {width, token, worker: 'ok'|'down'|'500'|'slow', seed: async (env) => {}} */
async function open(browser, path, o = {}) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: o.width || 1280, height: o.height || 800 } });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "https://agsist.com" }).catch(() => {});
  const { store, SUBS: kvs } = kv();
  const env = { UNSUB_SECRET: "sec", LIST_TOKEN: TOK, SUBS: kvs };
  if (o.seed) await o.seed(env, store);
  const S = { ctx, store, env, errs: [], logs: [], missing: [], calls: [], hold: null, worker: o.worker || "ok", outside: [] };
  /* how each page's cross-page view transition ended: Chrome's console line for a
     skipped one ("View Transition opt-in disabled") does not show in headless */
  await ctx.addInitScript(() => addEventListener("pagereveal", (e) => {
    const vt = e.viewTransition;
    window.__vt = vt ? "started" : "none";
    if (vt) vt.finished.then(() => { window.__vt = "finished"; }, (x) => { window.__vt = "skipped: " + x; });
  }));
  if (o.token) await ctx.addInitScript((t) => { try { localStorage.setItem("agsist-elev-admin-token", t); } catch (e) {} }, o.token);
  await ctx.route("**/*", async (route) => {
    const req = route.request(), u = new URL(req.url());
    if (u.origin === "https://agsist.com") {
      let f = normalize(join(ROOT, decodeURIComponent(u.pathname)));
      if (f.endsWith("/")) f += "index.html";
      if (!f.startsWith(ROOT) || !existsSync(f)) { S.missing.push(u.pathname); return route.fulfill({ status: 404, body: "" }); }
      return route.fulfill({ status: 200, contentType: types[extname(f)] || "application/octet-stream", body: readFileSync(f) });
    }
    if (u.origin === SUBS) {
      S.calls.push(req.method() + " " + u.pathname);
      if (S.worker === "down") return route.abort("connectionrefused");
      if (S.worker === "500" && req.method() !== "OPTIONS") return route.fulfill({ status: 502, contentType: "text/html", headers: { "access-control-allow-origin": "https://agsist.com" }, body: "<html>Bad gateway</html>" });
      if (S.worker === "slow" && req.method() === "POST") await new Promise((ok) => { S.hold = ok; });
      const h = await req.allHeaders();
      const r = await W.fetch(new Request(req.url(), { method: req.method(), headers: h, body: ["GET", "HEAD"].includes(req.method()) ? undefined : req.postData() }), env);
      return route.fulfill({ status: r.status, headers: Object.fromEntries(r.headers), body: Buffer.from(await r.arrayBuffer()) });
    }
    if (u.origin === "https://dnilgis.github.io" && u.pathname.startsWith("/bids/data/")) {
      const f = BIDS + u.pathname.slice(6);
      if (o.noBids || !existsSync(f)) return route.fulfill({ status: 404, body: "" });
      let body = readFileSync(f);
      if (u.pathname.endsWith("/index.json")) body = JSON.stringify(blocked(JSON.parse(body)));
      return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body });
    }
    if (u.origin === "https://api.github.com") return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: '{"workflow_runs":[]}' });
    if (u.origin === "https://www.newcoop.com" && o.newcoop) return route.fulfill({ status: 200, contentType: "text/html", body: o.newcoop });
    S.outside.push(u.origin);
    return route.abort();
  });
  const pg = await ctx.newPage();
  pg.on("pageerror", (e) => S.errs.push(e.message));
  pg.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") S.logs.push(m.text()); });
  pg.on("dialog", (d) => d.accept());
  S.pg = pg;
  await pg.goto("https://agsist.com" + path, { waitUntil: "load" });
  return S;
}
async function shot(pg, name) { if (SHOTS) await pg.screenshot({ path: join(SHOTS, name + ".png"), fullPage: false }); }
async function inView(pg, sel) {
  return pg.evaluate((s) => {
    const e = document.querySelector(s); if (!e || !e.offsetParent) return false;
    const r = e.getBoundingClientRect();
    return r.height > 0 && r.top >= 0 && r.bottom <= innerHeight;
  }, sel);
}
async function noSideScroll(pg) { return pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); }
/* a 500 KB paste: set at once, as a paste does, not typed */
async function setPaste(pg, v) { await pg.evaluate((x) => { const t = document.getElementById("p-in"); t.value = x; t.dispatchEvent(new Event("input")); }, v); }
async function readLong(pg) {
  await setPaste(pg, LONG);
  await pg.click("#p-read");
  await pg.waitForSelector("#p-save:not([hidden])");
}
async function clickSave(pg) {
  await pg.locator("#p-save").scrollIntoViewIfNeeded();
  await pg.click("#p-save");
}
const resultText = (pg) => pg.locator("#p-res").innerText();
async function done(pg) { await pg.waitForFunction(() => { const b = document.getElementById("p-save"); return b && !b.disabled && !/Saving/.test(b.textContent); }); }

let browser = null;
async function br() { if (!browser) browser = await chromium.launch({ executablePath: CHROME + (existsSync(CHROME + "/chrome") ? "/chrome" : "") }); return browser; }
test.after(async () => { if (browser) await browser.close(); });

/* Oct 20: Sig saved a 51-board preview and saw nothing. The answer went into
   #p-out, above the preview, a screen or more away from the button. */
for (const width of WIDTHS) test(`${width}px: after Save on a long preview, the answer is in view next to the button`, { skip }, async () => {
  const S = await open(await br(), "/elev-admin.html?paste=newcoop#paste", { width, token: TOK });
  const pg = S.pg;
  await readLong(pg);
  const pv = await pg.locator("#p-prev").innerText();
  assert.match(pv, /51 of 66 boards found, \d+ rows/);
  assert.match(pv, /Afton: 12 rows Corn \$4\.26, basis -35, futures 461-4/);
  assert.match(pv, /Not on our list, not saved: Mt\. Ayr \(12 rows\), Cainsville \(12 rows\), Morton Mills \(12 rows\)|Not on our list, not saved: .*Cainsville.*Morton Mills.*Mt\. Ayr|Not on our list, not saved: .*Mt\. Ayr/);
  await clickSave(pg);
  await pg.waitForFunction(() => /Saved/.test((document.getElementById("p-res") || {}).textContent || ""));
  await shot(pg, `after-save-${width}`);
  assert.ok(await inView(pg, "#p-res"), "the result is on screen");
  assert.equal(await pg.getAttribute("#p-res", "role"), "status");
  assert.match(await resultText(pg), /^Saved Oct \d+, \d+:\d\d [AP]M CT: \d+ rows at 51 locations\./);
  const saved = JSON.parse(S.store.get("paste:newcoop"));
  assert.equal(saved.locations.length, 51);
  assert.ok(!saved.locations.some((l) => /Cainsville|Morton Mills|Mt\. Ayr/.test(l.name)), "boards bids does not have are not sent");
  assert.deepEqual(saved.locations[0].rows[0], { commodity: "Corn", delivery: "10/1/2026 - 10/31/2026", cash: "$4.26", basis: "-35", future: "461-4", change: "-5-4" });
  assert.equal(await pg.inputValue("#p-in"), "", "a saved paste clears the box");
  await pg.waitForFunction(() => /Last saved/.test(document.getElementById("p-last").textContent));
  assert.match(await pg.locator("#p-last").innerText(), /Last saved .*: \d+ rows, 51 locations\./);
  assert.ok(await noSideScroll(pg) <= 0, "no side scroll");
  assert.deepEqual(S.errs, []);
  assert.deepEqual([...new Set(S.outside)], [], "nothing outside the mocks, and nothing to newcoop.com");
  await S.ctx.close();
});

for (const width of WIDTHS) test(`${width}px: the button says Saving... and is disabled while it works`, { skip }, async () => {
  const S = await open(await br(), "/elev-admin.html?paste=newcoop#paste", { width, token: TOK, worker: "slow" });
  const pg = S.pg;
  await readLong(pg);
  await clickSave(pg);
  await pg.waitForFunction(() => document.getElementById("p-save").disabled);
  assert.equal((await pg.locator("#p-save").innerText()).trim(), "Saving...");
  assert.match(await resultText(pg), /Saving/);
  await shot(pg, `saving-${width}`);
  await pg.click("#p-save", { force: true, timeout: 1000 }).catch(() => {});
  while (!S.hold) await new Promise((ok) => setTimeout(ok, 20));
  S.hold();
  await done(pg);
  assert.equal(S.calls.filter((c) => c === "POST /elev/admin/paste").length, 1, "one save, not two");
  assert.match(await resultText(pg), /^Saved /);
  await S.ctx.close();
});

/* Every way a save fails: the reason is next to the button, the paste stays, and a retry works. */
for (const width of WIDTHS) test(`${width}px: a failed save says why, keeps the paste, and a retry saves`, { skip }, async () => {
  const S = await open(await br(), "/elev-admin.html?paste=newcoop#paste", { width });
  const pg = S.pg;
  await readLong(pg);
  const cases = [
    ["no token", async () => { await pg.fill("#tok", ""); }, /token box at the top of this page is empty/],
    ["wrong token", async () => { await pg.fill("#tok", "wrong"); }, /The token was not accepted/],
    ["worker down", async () => { await pg.fill("#tok", TOK); S.worker = "down"; }, /Could not reach the worker/],
    ["worker error page", async () => { S.worker = "500"; }, /answered 502/],
  ];
  for (const [why, set, re] of cases) {
    await set();
    await clickSave(pg);
    await done(pg);
    await pg.waitForFunction(() => /Not saved/.test(document.getElementById("p-res").textContent));
    const t = await resultText(pg);
    assert.match(t, /^Not saved/, why);
    assert.match(t, re, why + ": " + t);
    assert.ok(await inView(pg, "#p-res"), why + ": the reason is on screen");
    assert.match(await pg.getAttribute("#p-res", "class"), /bad/, why);
    assert.equal(await pg.inputValue("#p-in"), LONG, why + ": the paste is kept");
    assert.ok(await pg.isVisible("#p-save"), why + ": Save is still there");
    assert.equal((await pg.locator("#p-save").innerText()).trim(), "Save these bids", why);
    assert.ok(!S.store.has("paste:newcoop"), why + ": nothing stored");
    await shot(pg, `fail-${why.replace(/ /g, "-")}-${width}`);
  }
  S.worker = "ok";
  await clickSave(pg);
  await done(pg);
  assert.match(await resultText(pg), /^Saved /);
  assert.ok(S.store.has("paste:newcoop"));
  await S.ctx.close();
});

test("a paste that reads nothing, a bot check page, and another site's page are refused before any save", { skip }, async () => {
  const S = await open(await br(), "/elev-admin.html?paste=newcoop#paste", { width: 390, token: TOK });
  const pg = S.pg;
  for (const [txt, re] of [["   ", /Nothing was pasted/], ["<html><title>Just a moment...</title><script>window._cf_chl_opt={}</script></html>", /bot check page/],
    ["<html><body><h1>Cargill Cash Bids</h1><table><tr><td>Corn</td><td>Nov</td><td>4.10</td></tr></table></body></html>", /No bid rows were found/],
    ["Select all text with no board in it\nhello", /No bid rows were found/]]) {
    await setPaste(pg, txt);
    await pg.click("#p-read");
    assert.match(await pg.locator("#p-out").innerText(), re);
    assert.ok(await pg.isHidden("#p-save"));
    assert.ok(await inView(pg, "#p-out"), "the reason shows by the Read button");
  }
  assert.ok(!S.calls.some((c) => c.includes("/elev/admin/paste")));
  await S.ctx.close();
});

test("the bookmark from another site: no reader for it, said plainly; the site list still works", { skip }, async () => {
  const S = await open(await br(), "/elev-admin.html?paste=www.cargill.com#paste", { width: 390, token: TOK });
  const pg = S.pg;
  assert.match(await pg.locator("#p-out").innerText(), /There is no paste reader for www\.cargill\.com yet/);
  assert.equal(await pg.inputValue("#p-site"), "newcoop");
  assert.equal(await pg.getAttribute("#p-open", "href"), "https://www.newcoop.com/cash-bids");
  assert.equal(await pg.getAttribute("#p-open", "target"), "_blank");
  await shot(pg, "other-site-390");
  /* the site switch clears a preview */
  await readLong(pg);
  await pg.dispatchEvent("#p-site", "change");
  assert.ok(await pg.isHidden("#p-save"));
  assert.equal(await pg.locator("#p-prev").innerText(), "");
  await S.ctx.close();
});

test("token: entered once is kept, Forget clears it, and every call sends it in the header only", { skip }, async () => {
  const S = await open(await br(), "/elev-admin.html", { width: 1280 });
  const pg = S.pg;
  await pg.fill("#tok", TOK);
  await pg.dispatchEvent("#tok", "change");
  assert.equal(await pg.evaluate(() => localStorage.getItem("agsist-elev-admin-token")), TOK);
  await pg.click("#load");
  await pg.waitForFunction(() => /elevator/.test(document.getElementById("l-out").textContent));
  assert.match(await pg.locator("#l-out").innerText(), /^0 elevators\./);
  await pg.click("#tok-forget");
  assert.equal(await pg.inputValue("#tok"), "");
  assert.equal(await pg.evaluate(() => localStorage.getItem("agsist-elev-admin-token")), null);
  await pg.click("#load");
  await pg.waitForFunction(() => /token/.test(document.getElementById("l-out").textContent));
  assert.match(await pg.locator("#l-out").innerText(), /token/);
  assert.ok(!S.calls.some((c) => c.includes(TOK)), "never in an address");
  await S.ctx.close();
});

const REQ_KEY = "form:elevator-listing:1760900000000:abcdef12";
async function seed(env, store) {
  store.set(REQ_KEY, JSON.stringify({ kind: "elevator-listing", ts: 1760900000000, status: "pending", n: 0, elevator: "Farmers Elevator Co", town: "Lingle", state: "WY", zip: "82223",
    name: "Pat Doe", role: "Manager", phone: "(307) 555-0100", email: "pat@example.com", crops: "wheat, corn", how: "phone", note: "Call after 3." }));
  store.set("form:elevator-listing:1760800000000:abcdef13", JSON.stringify({ kind: "elevator-listing", ts: 1760800000000, status: "pending", n: 0, elevator: "Test Grain", town: "Ladoga", state: "IN", zip: "47954",
    name: "Lee Roe", role: "Owner", phone: "765-555-0101", email: "lee@example.com", crops: "corn", how: "not-sure", note: "" }));
}
for (const width of WIDTHS) test(`${width}px: requests load, make a listing from one, dismiss one; the list loads, New link and Turn off work`, { skip }, async () => {
  const S = await open(await br(), "/elev-admin.html#requests", { width, token: TOK, seed });
  const pg = S.pg;
  await pg.waitForFunction(() => /2 waiting/.test(document.getElementById("r-out").textContent));
  await pg.waitForSelector(".req .match");
  await shot(pg, `requests-${width}`);
  /* dismiss the second */
  await pg.locator('.req[data-key$="abcdef13"] [data-dismiss]').click();
  await pg.waitForFunction(() => /1 waiting, 1 made or dismissed/.test(document.getElementById("r-out").textContent));
  assert.equal(JSON.parse(S.store.get("form:elevator-listing:1760800000000:abcdef13")).status, "dismissed");
  await pg.check("#r-done");
  await pg.waitForSelector('.req [data-reopen]');
  await pg.uncheck("#r-done");
  /* make the first */
  await pg.locator(`.req[data-key="${REQ_KEY}"] [data-make]`).click();
  assert.equal(await pg.inputValue("#c-name"), "Farmers Elevator Co");
  assert.equal(await pg.inputValue("#c-id"), "farmers-elevator-co-lingle-wy");
  if (!(await pg.inputValue("#c-ll"))) await pg.fill("#c-ll", "41.95, -104.34");
  await pg.click('#create button[type="submit"]');
  await pg.waitForFunction(() => /Link for/.test(document.getElementById("c-out").textContent));
  assert.match(await pg.locator("#c-out").innerText(), /agsist\.com\/post\?k=/);
  await pg.waitForFunction(() => /^1 elevator\./.test(document.getElementById("l-out").textContent));
  await pg.waitForFunction(() => /0 waiting/.test(document.getElementById("r-out").textContent));
  assert.equal(JSON.parse(S.store.get(REQ_KEY)).status, "created");
  /* New link, Turn off */
  await pg.click("[data-rekey]");
  await pg.waitForFunction(() => /Link for/.test(document.querySelector("#list .out").textContent));
  await pg.click("[data-active]");
  await pg.waitForFunction(() => /Turn on/.test(document.querySelector("[data-active]").textContent));
  assert.equal(JSON.parse(S.store.get("elev:farmers-elevator-co-lingle-wy")).active, false);
  assert.ok(await noSideScroll(pg) <= 0);
  assert.deepEqual(S.errs, []);
  await S.ctx.close();
});

test("wrong token and a worker that is down: every section says so", { skip }, async () => {
  let S = await open(await br(), "/elev-admin.html", { width: 390, token: "wrong" });
  await S.pg.waitForFunction(() => /not accepted/.test(document.getElementById("l-out").textContent) && /not accepted/.test(document.getElementById("r-out").textContent));
  await S.ctx.close();
  S = await open(await br(), "/elev-admin.html", { width: 390, token: TOK, worker: "down" });
  await S.pg.waitForFunction(() => /Could not reach/.test(document.getElementById("l-out").textContent) && /Could not reach/.test(document.getElementById("r-out").textContent));
  await S.ctx.close();
});

test("the desk names its own icon (no /favicon.ico 404) and opts into the view transition Today starts", () => {
  const h = read("elev-admin.html");
  const icon = h.match(/<link rel="icon"[^>]*href="([^"]+)"/);
  assert.ok(icon && existsSync(join(ROOT, icon[1].replace(/^\//, ""))), "an icon link to a file that exists");
  assert.match(h, /@view-transition\{navigation:auto\}/);
  assert.match(read("components/styles.css"), /@view-transition \{ navigation: auto; \}/, "Today's side, the reason the desk must opt in");
});

for (const width of WIDTHS) test(`${width}px: an empty token box is said at the top, at Read, and by Save, before any save is tried`, { skip }, async () => {
  const S = await open(await br(), "/elev-admin.html?paste=newcoop#paste", { width });
  const pg = S.pg;
  assert.ok(await pg.isVisible("#tok-miss"), "the top says the token is missing");
  assert.match(await pg.locator("#tok-miss").innerText(), /No token in this browser yet/);
  await readLong(pg);
  assert.match(await resultText(pg), /token box at the top of this page is empty/);
  assert.ok(await pg.locator("#p-save").evaluate((b) => { const r = document.getElementById("p-res").getBoundingClientRect(), q = b.getBoundingClientRect(); return r.top >= q.bottom - 1 && r.top - q.bottom < 40; }), "the line sits right under Save");
  await clickSave(pg);
  await done(pg);
  assert.match(await resultText(pg), /^Not saved: the token box/);
  assert.ok(await inView(pg, "#p-res"));
  await shot(pg, `no-token-save-${width}`);
  assert.ok(!S.calls.some((c) => c.includes("/elev/admin/paste")), "nothing sent without a token");
  await pg.click('#p-res a[href="#tok"]');
  // html { scroll-behavior: smooth } (styles.css): the click returns while the page is still scrolling, so wait for it to land
  await pg.waitForFunction(() => { const r = document.getElementById("tok").getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }, null, { timeout: 5000 }).catch(() => {});
  assert.ok(await inView(pg, "#tok"));
  await pg.fill("#tok", TOK);
  assert.ok(await pg.isHidden("#tok-miss"), "the warning goes once a token is in");
  assert.equal(await resultText(pg), "", "and so does the line by Save");
  await clickSave(pg);
  await done(pg);
  assert.match(await resultText(pg), /^Saved /);
  assert.equal(JSON.parse(S.store.get("paste:newcoop")).locations.length, 51);
  await S.ctx.close();
});

test("the desk logs no errors and fetches nothing that is not there", { skip }, async () => {
  const S = await open(await br(), "/elev-admin.html?paste=newcoop#paste", { width: 1280, token: TOK });
  await S.pg.waitForTimeout(300);
  assert.deepEqual(S.missing, []);
  assert.deepEqual(S.errs, []);
  assert.deepEqual(S.logs, []);
  await S.ctx.close();
});

/* Today -> Paste -> the desk: the cross-page view transition styles.css opts
   into needs both pages to opt in, or Chrome logs "View Transition opt-in
   disabled" on the way (Sig's console, Oct 20). */
for (const width of WIDTHS) test(`${width}px: Today lists NEW Cooperative; its Paste button opens the paste box with no console error`, { skip }, async () => {
  const S = await open(await br(), "/elev-today.html", { width, token: TOK });
  const pg = S.pg;
  const paste = pg.locator('a.td-btn[href="/elev-admin.html?paste=newcoop#paste"]');
  await paste.first().waitFor({ timeout: 15000 });
  await shot(pg, `today-${width}`);
  assert.ok(await noSideScroll(pg) <= 0);
  await paste.first().click();
  await pg.waitForURL(/elev-admin\.html\?paste=newcoop#paste/);
  await pg.waitForTimeout(500);
  assert.ok(await inView(pg, "#paste h2"), "the paste box is on screen");
  assert.equal(await pg.evaluate(() => window.__vt), "finished", "the transition Today starts is not skipped (before the fix: none, logged as opt-in disabled)");
  assert.match(await pg.locator("#p-out").innerText(), /Paste from clipboard/);
  assert.deepEqual(S.logs.filter((l) => /View Transition|favicon|404/i.test(l)), []);
  assert.deepEqual(S.errs, []);
  await S.ctx.close();
});

test("Today with a wrong token, and with the worker down, still lists the bid sites and says what did not load", { skip }, async () => {
  let S = await open(await br(), "/elev-today.html", { width: 390, token: "wrong" });
  await S.pg.waitForSelector(".td-err", { timeout: 15000 });
  assert.match(await S.pg.locator(".td-err").innerText(), /Listing requests did not load \(token\?\)/);
  assert.ok(await S.pg.locator('a.td-btn[href*="paste=newcoop"]').count() >= 1);
  await S.ctx.close();
  S = await open(await br(), "/elev-today.html", { width: 390, token: TOK, worker: "down" });
  await S.pg.waitForSelector(".td-err", { timeout: 15000 });
  assert.ok(await S.pg.locator('a.td-btn[href*="paste=newcoop"]').count() >= 1);
  assert.deepEqual(S.errs, []);
  await S.ctx.close();
});

test("the Copy for AGSIST bookmark on NEW Cooperative's page: copy, open the desk, Paste from clipboard, Read, Save", { skip }, async () => {
  const S = await open(await br(), "/elev-today.html", { width: 1280, token: TOK, newcoop: LONG });
  const bm = await S.pg.locator("#bmcode").innerText();
  assert.match(bm, /^javascript:/);
  await S.ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "https://www.newcoop.com" }).catch(() => {});
  const site = await S.ctx.newPage();
  await site.goto("https://www.newcoop.com/cash-bids");
  const [desk] = await Promise.all([S.ctx.waitForEvent("page"), site.evaluate((code) => { (0, eval)(decodeURIComponent(code.replace(/^javascript:/, ""))); }, bm)]);
  await desk.waitForLoadState("load");
  assert.equal(new URL(desk.url()).searchParams.get("paste"), "www.newcoop.com");
  assert.equal(await desk.inputValue("#p-site"), "newcoop");
  await desk.click("#p-clip");
  await desk.waitForSelector("#p-save:not([hidden])");
  assert.match(await desk.locator("#p-prev").innerText(), /51 of 66 boards found/);
  await desk.locator("#p-save").scrollIntoViewIfNeeded();
  await desk.click("#p-save");
  await desk.waitForFunction(() => /^Saved/.test(document.getElementById("p-res").textContent));
  assert.ok(await inView(desk, "#p-res"));
  await S.ctx.close();
});
