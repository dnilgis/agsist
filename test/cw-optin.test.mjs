/* Your county this week for readers already on the Daily (Oct 27 2026, subs worker v5.57), and
 * the holdout behind the keep or cut rule (growth seat 9: keep it after 4 Thursdays if its tagged
 * clicks beat the Daily's other sections and holdout-vs-block 14-day return favors the block).
 *
 *   node --test test/cw-optin.test.mjs
 *
 *   - the worker route, signed link valid and not, only cw changes (scripts/test_daily_cw_worker.mjs)
 *   - the footer link, the holdout (deterministic, stable, 1 in 5, 8 Thursdays) and the arm tags
 *     (scripts/test_cw_optin.py)
 *   - the link Python signs is the link the worker takes
 *   - never pre-ticked: opening the link changes nothing; the page has no ticked box
 *   - in a browser: agsist.com/e?a=daily-cw asks, takes a ZIP, and the ZIP goes in the request
 *     body, never in a URL; the reader's record gains cw and the ZIP only
 * Made-up readers only. Screenshots at 390 and 1280 go to $FD_SHOTS when it is set. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => fs.readFileSync(ROOT + p, "utf8");
const PAGE = read("e.html");
const W = "https://agsist-api.dnilgis.workers.dev";
const SHOTS = process.env.FD_SHOTS || "";

test("the worker route (scripts/test_daily_cw_worker.mjs)", () => {
  const out = execFileSync(process.execPath, [ROOT + "scripts/test_daily_cw_worker.mjs"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  assert.match(out, /daily-cw worker checks: \d+ passed/);
});

test("the footer link, the holdout and the arm tags (scripts/test_cw_optin.py)", () => {
  const out = execFileSync("python3", [ROOT + "scripts/test_cw_optin.py"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  assert.match(out, /cw optin: \d+ passed, 0 failed/);
});

// the real worker, against an in-memory KV
const tmp = path.join(os.tmpdir(), "subs-worker-cwoptin-" + process.pid + ".mjs");
fs.copyFileSync(ROOT + "workers/subs-worker.js", tmp);
const worker = (await import(pathToFileURL(tmp).href)).default;
fs.unlinkSync(tmp);
const store = new Map();
const env = { UNSUB_SECRET: "sec", LIST_TOKEN: "tok", SUBS: {
  async get(k) { return store.has(k) ? store.get(k) : null; }, async put(k, v) { store.set(k, v); },
  async delete(k) { store.delete(k); }, async list({ prefix }) { return { keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }; } } };
const E = "made-up-cw-page@example.com", L = "abcdefghjkmnpqrs";
const REC = JSON.stringify({ ts: 1, src: "hero", reports: true });

test("the link Python signs is the one the worker takes, and opening it changes nothing", async () => {
  const py = "import os,sys; sys.path.insert(0, %s); os.environ['LIST_URL']='x'; os.environ['UNSUB_SECRET']='sec'; import send_daily as S; S.LINK_IDS['%s']='%s'; print(S.county_ask_url('%s'))";
  const link = execFileSync("python3", ["-c", py.replace("%s", JSON.stringify(ROOT + "scripts")).replace("%s", E).replace("%s", L).replace("%s", E)], { encoding: "utf8" }).trim();
  assert.match(link, /^https:\/\/agsist\.com\/e\?a=daily-cw&k=abcdefghjkmnpqrs&t=[0-9a-f]{16}$/);
  store.clear(); store.set("lid:" + L, E); store.set("sub:" + E, REC);
  const q = new URL(link).searchParams;
  const r = await worker.fetch(new Request(W + "/fd/daily-cw?k=" + q.get("k") + "&t=" + q.get("t")), env);
  const j = await r.json();
  assert.equal(j.ok, true); assert.equal(j.title, "Add what changed in your county on Thursdays?");
  assert.equal(store.get("sub:" + E), REC, "GET is not a yes");
  const bad = await (await worker.fetch(new Request(W + "/fd/daily-cw?k=" + L + "&t=" + "0".repeat(16)), env)).json();
  assert.equal(bad.ok, false, "a bad t is refused");
});

test("never pre-ticked: no ticked box on the worker's page or the front door", async () => {
  store.clear(); store.set("lid:" + L, E); store.set("sub:" + E, REC);
  const t = crypto.createHmac("sha256", "sec").update((L + "|cw").toLowerCase()).digest("hex").slice(0, 16);
  const h = await (await worker.fetch(new Request(W + "/daily-cw?k=" + L + "&t=" + t), env)).text();
  assert.doesNotMatch(h, /checked|type="checkbox"/i);
  assert.doesNotMatch(PAGE, /checked\s*=|\.checked\s*=\s*true/);
  assert.ok(!/—/.test(PAGE) && !/—/.test(read("scripts/test_cw_optin.py")), "no em dash");
  // the ZIP never goes in a link: the page keeps only these params in the URL it asks
  const keep = /var KEEP = \[([^\]]*)\]/.exec(PAGE)[1];
  assert.doesNotMatch(keep, /zip/);
});

const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (fs.existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !fs.existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

test("in a browser: the front door asks, takes a ZIP in the body only, and stores cw and the ZIP", { skip }, async () => {
  store.clear(); store.set("lid:" + L, E); store.set("sub:" + E, REC);
  const t = crypto.createHmac("sha256", "sec").update((L + "|cw").toLowerCase()).digest("hex").slice(0, 16);
  const browser = await chromium.launch({ executablePath: CHROME });
  const seen = [], bodies = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 760 } });
    const page = await ctx.newPage();
    await page.route("https://agsist.com/**", (r) => {
      seen.push(r.request().url());
      const u = new URL(r.request().url());
      if (u.pathname === "/e") return r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: PAGE });
      return r.fulfill({ status: 200, contentType: "application/javascript", body: "" });
    });
    await page.route(W + "/**", async (r) => {
      const q = r.request();
      seen.push(q.url());
      if (q.postData()) bodies.push(q.postData());
      const res = await worker.fetch(new Request(q.url(), { method: q.method(), headers: q.headers(), body: q.method() === "POST" ? (q.postData() || undefined) : undefined }), env);
      const headers = {};
      res.headers.forEach((v, k) => { headers[k] = v; });
      return r.fulfill({ status: res.status, headers, body: await res.text() });
    });
    await page.goto("https://agsist.com/e?a=daily-cw&k=" + L + "&t=" + t);
    const btn = page.getByRole("button", { name: "Yes, add it" });
    await btn.waitFor();
    const box = page.getByRole("textbox", { name: "Your ZIP" });
    assert.equal(await box.inputValue(), "", "the ZIP box starts empty");
    assert.equal(store.get("sub:" + E), REC, "opening the page changes nothing");
    let txt = await page.locator("main").innerText();
    assert.match(txt, /Your ZIP tells us your county/);
    assert.match(txt, /1 in 5 readers/);
    if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); for (const w of [390, 1280]) { await page.setViewportSize({ width: w, height: 760 }); await page.screenshot({ path: path.join(SHOTS, "cw-ask-" + w + ".png"), fullPage: true }); } await page.setViewportSize({ width: 390, height: 760 }); }
    const bb = await box.boundingBox();
    assert.ok(bb && bb.height >= 44, "the ZIP box is a 44 px tap");
    await box.fill("61611");
    await btn.click();
    await page.getByText("Your county this week is on.").waitFor();
    assert.equal(store.get("sub:" + E), JSON.stringify({ ts: 1, src: "hero", zip: "61611", reports: true, cw: true }), "cw and the ZIP, nothing else");
    assert.ok(bodies.some((b) => b === "cw=1&zip=61611"), "the ZIP went in the body: " + bodies);
    assert.ok(seen.every((u) => !u.includes("61611") && !u.includes("@") && !u.includes("%40")), "no ZIP and no address in any URL");
    txt = await page.locator("main").innerText();
    assert.ok(!txt.includes("@"), "no address on screen");
    assert.equal(await page.getByRole("textbox").count(), 0, "the box is gone once done");
    if (SHOTS) for (const w of [390, 1280]) { await page.setViewportSize({ width: w, height: 760 }); await page.screenshot({ path: path.join(SHOTS, "cw-done-" + w + ".png"), fullPage: true }); }
  } finally { await browser.close(); }
});
