/* desk.html: Sig's desk (Oct 28, 2026: "a singular place for all things agsist, executive level, KISS").
 *
 *   - the page: noindex, no referrer, no analytics, no em dash, not in a sitemap, the search index,
 *     the feeds, llms.txt or the menu; the token only in the Authorization header; one list of cards.
 *   - the Daily signup groups are the morning report's (both run on the same sources).
 *   - the worker (subs worker v5.59): GET /desk and /desk/ledger refuse without the token, with a
 *     ?token= and with a wrong one; the bundle carries counts only (no address, no ZIP, no name, no
 *     town), notice topics by family; mark and unmark paid, and what they refuse.
 *   - in a browser at 390 and 1280 against a mocked worker, GitHub and bids: no sideways scroll, no
 *     layout shift, no worker call and closed private cards without the token, "can't read" for a
 *     failed source, mark paid from the page, no address pattern in the page text.
 *
 * The browser part needs Playwright and Chromium; without them it is skipped and says so.
 * DESK_SHOTS=<dir> also saves a screenshot per width.
 *   node --test test/desk.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs, { readFileSync, readdirSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

const A = read("desk.html");
const script = A.slice(A.indexOf("<script>"), A.lastIndexOf("</script>"));
const EMAIL = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+\.[A-Za-z0-9.-]+/;
const STREET = /\b\d{2,6}\s+[A-Z][a-z]+\s+(Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Highway|Hwy)\b/;

test("the page: noindex, no referrer, no analytics, no em dash, in no sitemap, search index, feed, llms.txt or menu", () => {
  assert.match(A, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(A, /<meta name="referrer" content="no-referrer">/);
  assert.doesNotMatch(A, /googletagmanager|G-6KXCTD5Z9H|gtag\(|components\/loader\.js/, "no analytics, no loader");
  assert.doesNotMatch(A, new RegExp("[\\u2014\\u2013]|&mdash;|&ndash;"), "no em dash");
  let maps = 0;
  for (const f of readdirSync(ROOT).filter((f) => /^sitemap.*\.xml$/.test(f))) { maps++; assert.doesNotMatch(read(f), /\/desk\b/, f); }
  assert.ok(maps >= 5, `only ${maps} sitemaps seen; they have moved`);
  const others = ["data/search-index.json", "feed.xml", "news.xml", "llms.txt", "components/header.html", "components/footer.html",
    "components/header-fallback.html", "components/footer-fallback.html"];
  let seen = 0;
  for (const f of others) if (existsSync(ROOT + f)) { seen++; assert.doesNotMatch(read(f), /agsist\.com\/desk\b|"\/desk"|href="\/desk/, `${f} does not list the desk`); }
  assert.ok(seen >= 6, `only ${seen} of the menu, search and feed files found`);
  assert.doesNotMatch(read("scripts/build_llms_txt.py"), /["']\/desk["']/, "not in llms.txt PAGES");
});

test("the token goes only in the Authorization header; one list of cards, each naming its sources", () => {
  assert.doesNotMatch(A, /[?&]token=/, "the token never goes in a URL");
  assert.doesNotMatch(script, /console\./, "nothing is logged");
  assert.match(script, /Authorization: 'Bearer ' \+ t/);
  assert.equal((script.match(/fetch\(/g) || []).length, 1, "one fetch, through get()");
  assert.match(script, /var TOK_KEY = 'agsist-elev-admin-token';/, "the same key the elevator desk keeps");
  assert.match(read("elev-admin.html"), /var TOK_KEY = 'agsist-elev-admin-token';/);
  const list = /var CARDS = \[([\s\S]*?)\n  \];/.exec(script);
  assert.ok(list, "one CARDS list");
  const ids = [...list[1].matchAll(/\{ id: '([a-z]+)'/g)].map((m) => m[1]);
  assert.deepEqual(ids, ["today", "ads", "signups", "boards", "money", "audience", "todo"]);
  const sources = /var SOURCES = \{([\s\S]*?)\n  \};/.exec(script)[1];
  for (const m of list[1].matchAll(/needs: \[([^\]]*)\]/g))
    for (const n of m[1].split(",").map((s) => s.trim().replace(/'/g, "")).filter(Boolean)) assert.match(sources, new RegExp("\\b" + n + ": function"), "source " + n);
  /* the worker route the page reads exists, Bearer only */
  const W = read("workers/subs-worker.js");
  assert.ok(W.includes('if (path === "/desk" || path === "/desk/ledger")'));
});

test("the Daily signup groups are the morning report's", () => {
  const block = /var SIGNUP_GROUPS = \[[\s\S]*?\n  \];\n  function signupGroup[^\n]*\n/.exec(script);
  assert.ok(block, "SIGNUP_GROUPS and signupGroup in the page");
  const js = new Function(block[0] + "return signupGroup;")();
  const SOURCES = ["bar", "bar-cash", "bar:rent", "daily-briefing-subscribe", "daily", "page:daily", "page:daily/2026", "town:wi/chetek", "hero",
    "homepage-email", "signup-band", "watch-optin", "menu", "menu-daily", "footer", "import", "manual", "onemore:hail", "email-forward", "(none)", "",
    "page:prf", "rent-wi", "cash-bids", "barn", "dailyx"];
  const py = "import json,sys; sys.path.insert(0, %s); import morning_report as M; print(json.dumps([M.signup_group(s) for s in json.loads(sys.argv[1])]))";
  const want = JSON.parse(execFileSync("python3", ["-c", py.replace("%s", JSON.stringify(ROOT + "scripts")), JSON.stringify(SOURCES)], { encoding: "utf8" }));
  assert.deepEqual(SOURCES.map(js), want);
  const names = [...block[0].matchAll(/\['([^']+)', function/g)].map((m) => m[1]);
  const pyNames = JSON.parse(execFileSync("python3", ["-c", "import json,sys; sys.path.insert(0, %s); import morning_report as M; print(json.dumps([n for n, _ in M.SIGNUP_GROUPS]))".replace("%s", JSON.stringify(ROOT + "scripts"))], { encoding: "utf8" }));
  assert.deepEqual(names, pyNames, "same groups in the same order");
});

/* ---------- the worker, against an in-memory KV ---------- */
const tmp = path.join(os.tmpdir(), "subs-worker-desk-" + process.pid + ".mjs");
fs.copyFileSync(ROOT + "workers/subs-worker.js", tmp);
const worker = (await import(pathToFileURL(tmp).href)).default;
fs.unlinkSync(tmp);
const store = new Map();
const env = { UNSUB_SECRET: "sec", LIST_TOKEN: "tok", SUBS: {
  async get(k) { return store.has(k) ? store.get(k) : null; }, async put(k, v) { store.set(k, v); },
  async delete(k) { store.delete(k); },
  async list({ prefix }) { return { keys: [...store.keys()].filter((k) => k.startsWith(prefix || "")).sort().map((name) => ({ name })), list_complete: true }; } } };
const WH = "https://agsist-api.dnilgis.workers.dev";
const call = (p, { tok = "tok", method = "GET", body } = {}) => worker.fetch(new Request(WH + p, { method, body: body ? JSON.stringify(body) : undefined,
  headers: Object.assign({ Origin: "https://agsist.com", "Content-Type": "application/json" }, tok ? { Authorization: "Bearer " + tok } : {}) }), env);
const NOW = Date.now();
function seed() {
  store.clear();
  store.set("sub:made-up-one@example.com", JSON.stringify({ ts: NOW - 2 * 864e5, src: "bar", zip: "54728", reports: true }));
  store.set("sub:made-up-two@example.com", JSON.stringify({ ts: NOW - 30 * 864e5, src: "town:wi/chetek", reports: true }));
  store.set("sub:made-up-three@example.com", JSON.stringify({ src: "import", reports: true }));
  store.set("note:made-up-one@example.com", JSON.stringify({ t: { "rain-gauge": { ts: NOW - 864e5, src: "rain-gauge", zip: "54728", note: "123 Main Street, Chetek" },
    "landsales:54728:25": { ts: NOW - 864e5, src: "atlas" }, "landsales:54729:50": { ts: NOW - 864e5, src: "atlas" }, "rent:wi": { ts: NOW - 40 * 864e5 } } }));
  store.set("note:made-up-four@example.com", JSON.stringify({ t: { "prf:12345": { ts: NOW - 2 * 864e5 }, "rain-gauge": { ts: NOW - 20 * 864e5, zip: "50010" } } }));
  store.set("alert:made-up-five@example.com", "{}");
  store.set("flag:briefed:" + new Date(NOW).toISOString().slice(0, 10), "1");
  store.set("rpo:1761000000000:0a1b2c3d", JSON.stringify({ ts: NOW - 3 * 864e5, product: "framed12x18", place: "Chetek, WI", name: "Made Up Name", dedication: "For Grandpa",
    paid: { amount: 89, at: new Date(NOW - 3 * 864e5).toISOString(), session: "cs_1" }, serial: 2 }));
  store.set("rpo:1761000000001:0a1b2c3e", JSON.stringify({ ts: NOW - 864e5, product: "digital", place: "Ames, IA" }));
  store.set("rpg:0123456789abcdef", JSON.stringify({ status: "redeemed", to: "Dad", giver: { email: "made-up-giver@example.com" } }));
  store.set("form:elevator-listing:1:abc", JSON.stringify({ ts: NOW, status: "pending", name: "Made Up Coop", email: "made-up-mgr@example.com", phone: "715-555-0100" }));
}

test("the worker: /desk and /desk/ledger refuse without the token, with ?token= and with a wrong one", async () => {
  seed();
  for (const p of ["/desk", "/desk/ledger"]) {
    assert.equal((await call(p, { tok: "" })).status, 403, p + " no token");
    assert.equal((await call(p, { tok: "nope" })).status, 403, p + " wrong token");
    assert.equal((await worker.fetch(new Request(WH + p + "?token=tok"), env)).status, 403, p + " ?token= refused");
    assert.equal((await worker.fetch(new Request(WH + p + "?token=tok", { headers: { Authorization: "Bearer tok" } }), env)).status, 403, p + " ?token= refused even with the header");
  }
  const before = JSON.stringify([...store.entries()]);
  const r = await call("/desk/ledger", { tok: "", method: "POST", body: { action: "mark", slug: "rootlot", period: "2026-10", amount: 29, paid_on: "2026-10-28" } });
  assert.equal(r.status, 403, "mark refused without the token");
  assert.equal((await call("/desk/ledger", { tok: "nope", method: "POST", body: { action: "unmark", slug: "rootlot", period: "2026-10" } })).status, 403);
  assert.equal(JSON.stringify([...store.entries()]), before, "nothing written");
});

test("the worker: /desk carries counts only, notice topics by family, and every part on its own", async () => {
  seed();
  const r = await call("/desk");
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), "https://agsist.com");
  assert.equal(r.headers.get("Cache-Control"), "no-store");
  const text = await r.text(), j = JSON.parse(text);
  assert.equal(j.ok, true);
  assert.doesNotMatch(text, EMAIL, "no address");
  for (const s of ["54728", "54729", "50010", "12345", "Chetek", "Ames", "Main Street", "Made Up", "Grandpa", "Dad", "715-555"]) assert.ok(!text.includes(s), "not in the answer: " + s);
  assert.equal(j.daily.n, 3); assert.equal(j.daily.new_7d, 1); assert.equal(j.daily.no_join_time, 1);
  assert.deepEqual(j.daily.by_source, { bar: 1, "town:wi/chetek": 1, import: 1 });
  assert.deepEqual(j.notices.by_family, { "rain-gauge": 2, landsales: 1, rent: 1, prf: 1 }, "one address counts once per family");
  assert.deepEqual(j.notices.new_7d_by_family, { "rain-gauge": 1, landsales: 1, prf: 1 });
  assert.equal(j.notices.addresses, 2);
  assert.equal(j.lists.alerts, 1);
  assert.equal(j.briefed[new Date(NOW).toISOString().slice(0, 10)], true);
  assert.equal(j.orders.pressed, 2); assert.equal(j.orders.paid, 1); assert.equal(j.orders.revenue, 89); assert.equal(j.orders.revenue_7d, 89);
  assert.equal(j.orders.stripe, "no key");
  assert.deepEqual(j.gifts, { issued: 0, redeemed: 1, void: 0, total: 1 });
  assert.deepEqual(j.requests, { pending: 1, created: 0, dismissed: 0 });
  assert.deepEqual(j.ledger, { rows: [] });
  /* a part that fails says so in its own place; the others still answer */
  const bad = Object.assign({}, env, { SUBS: Object.assign({}, env.SUBS, { async list(o) { if (o.prefix === "rpg:") throw new Error("kv down"); return env.SUBS.list(o); } }) });
  const j2 = await (await worker.fetch(new Request(WH + "/desk", { headers: { Authorization: "Bearer tok" } }), bad)).json();
  assert.deepEqual(j2.gifts, { error: "kv down" });
  assert.equal(j2.daily.n, 3);
  assert.equal((await call("/desk", { method: "POST", body: {} })).status, 405);
});

test("the worker: mark paid, mark again, unmark, and what the ledger refuses", async () => {
  seed();
  const mark = (b) => call("/desk/ledger", { method: "POST", body: Object.assign({ action: "mark", slug: "rootlot", period: "2026-11", amount: 29, paid_on: "2026-11-02" }, b) });
  let j = await (await mark({})).json();
  assert.equal(j.ok, true);
  assert.deepEqual(j.rows.map((x) => [x.slug, x.period, x.amount, x.paid_on]), [["rootlot", "2026-11", 29, "2026-11-02"]]);
  j = await (await mark({ amount: 29.5 })).json();
  assert.equal(j.rows.length, 1, "marking again replaces"); assert.equal(j.rows[0].amount, 29.5);
  await mark({ period: "2026-10", amount: 0 });
  j = await (await call("/desk/ledger")).json();
  assert.deepEqual(j.rows.map((x) => x.period), ["2026-11", "2026-10"], "newest month first");
  assert.equal(store.has("led:rootlot:2026-11"), true);
  for (const [b, why] of [[{ slug: "Root Lot" }, /slug/], [{ slug: "" }, /slug/], [{ period: "2026-13" }, /period/], [{ period: "2025-12" }, /period/], [{ amount: -1 }, /amount/],
    [{ amount: "x" }, /amount/], [{ amount: 200000 }, /amount/], [{ paid_on: "2026-02-30" }, /paid_on/], [{ paid_on: "" }, /paid_on/], [{ action: "pay" }, /action/]]) {
    const r = await mark(b);
    assert.equal(r.status, 400, JSON.stringify(b));
    assert.match((await r.json()).error, why);
  }
  j = await (await call("/desk/ledger", { method: "POST", body: { action: "unmark", slug: "rootlot", period: "2026-11" } })).json();
  assert.equal(j.ok, true); assert.deepEqual(j.rows.map((x) => x.period), ["2026-10"]);
  assert.equal(store.has("led:rootlot:2026-11"), false);
  const d = await (await call("/desk")).json();
  assert.deepEqual(d.ledger.rows.map((x) => x.period), ["2026-10"], "/desk carries the ledger");
});

/* ---------- in a browser ---------- */
function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".svg": "image/svg+xml", ".md": "text/markdown" };
  const srv = createServer((req, res) => {
    let p0 = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (!extname(p0) && p0 !== "/") p0 += ".html";
    const p = normalize(join(ROOT, p0));
    if (!p.startsWith(ROOT) || !existsSync(p)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(p)] || "application/octet-stream" });
    res.end(readFileSync(p));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}
const TODAY = new Date().toISOString().slice(0, 10);
const iso = (ms) => new Date(ms).toISOString();
const FIX = {
  ["/data/daily-sent/" + TODAY + ".json"]: { date: TODAY, sent_at: iso(Date.now() - 3 * 3600e3), format: "v2", subject: "Corn bounces after four lower closes", briefing: {} },
  "/data/sponsors.json": { sponsors: [
    { slug: "apex", name: "Apex Insurance Group", active: false, ended: "2026-10-08", start: null, token: "c1c1e09865171cd1", billing: { tier: "daily" }, placements: ["homepage", "daily_email"] },
    { slug: "rootlot", name: "Root Lot", active: true, start: null, count_from: "2026-10-28", token: "02f5fba2d37c172d", billing: { tier: "page", free_test: true }, placements: ["geo_pages"], geo: "rootlot", regions: ["CA", "NV", "TX"] },
    { slug: "barnco", name: "Barn Co", active: true, start: "2026-10-01", token: "0123456789abcdef", billing: { tier: "page" }, placements: ["cash-bids"] }] },
  "/data/geo-sponsors.json": { sponsors: [{ id: "rootlot", name: "Root Lot", states: ["CA", "NV", "TX"], active: true, start: null, end: null }] },
  "/data/page-sponsors.json": { slots: {} },
  "/data/prf-sponsors.json": { _how: "x" },
  "/data/sponsor.json": { active: false },
  "/data/sponsors/rootlot-02f5fba2d37c172d.json": { schema: "agsist-sponsor-report/1", through: null, pending: true, windows: [] },
  "/data/sponsors/apex-c1c1e09865171cd1.json": { schema: "agsist-sponsor-report/1", through: "2026-10-07", pending: true, windows: [] },
  "/data/sponsors/barnco-0123456789abcdef.json": { schema: "agsist-sponsor-report/1", through: "2026-10-26", windows: [{ days: 7, viewable: 1234, clicks: 17 }, { days: 30, viewable: 5000, clicks: 60 }] },
  "/data/audience.json": JSON.parse(read("test/fixtures/desk/audience.json")),
};
const DIR = { generated: iso(Date.now() - 1800e3), counts: { byStatus: { read: 2098, stale: 98, known: 5873, down: 133 } },
  elevators: [{ elevId: "eaaaaaaaaa", status: "read" }, { elevId: "ebbbbbbbbb", status: "known" }, { elevId: "eccccccccc", status: "read" }] };
const IDS = [{ id: "eaaaaaaaaa", since: "2026-10-18", via: "minted" }, { id: "ebbbbbbbbb", since: iso(Date.now() - 2 * 864e5).slice(0, 10), via: "minted" },
  { id: "eccccccccc", since: iso(Date.now() - 864e5).slice(0, 10), via: "minted" }].map((x) => JSON.stringify(x)).join("\n");
const RUN = (id, conclusion, file) => ({ id, status: "completed", conclusion, created_at: iso(Date.now() - 3600e3), updated_at: iso(Date.now() - 3000e3), html_url: "https://github.com/dnilgis/agsist/actions/runs/" + id, path: ".github/workflows/" + file });
function deskAnswer(ledger) {
  return { ok: true, at: iso(Date.now()),
    daily: { n: 182, new_7d: 14, new_24h: 2, no_join_time: 0, by_source: { bar: 90, "town:wi/chetek": 20, hero: 12, "page:prf": 40, import: 20 }, unsubs: { h24: 0, d7: 2, cleanup_h24: 0, cleanup_d7: 0 } },
    notices: { addresses: 40, by_family: { "rain-gauge": 21, landsales: 6, rent: 9, prf: 3, "milk-month": 1 }, new_7d_by_family: { "rain-gauge": 4, landsales: 2 } },
    lists: { alerts: 4, ewatch: 10, pwatch: 1, watch: 3 }, briefed: { [TODAY]: true },
    orders: { days: 120, stripe: "ok", pressed: 9, paid: 5, paid_7d: 2, gifts_paid: 1, revenue: 287, revenue_7d: 108, by_product: { framed12x18: 2, print12x18: 1, digital: 2 }, waiting_approval: 1, overdue: 0 },
    gifts: { issued: 1, redeemed: 2, void: 0, total: 3 }, requests: { pending: 2, created: 5, dismissed: 1 }, sponsor_apps: { by_status: {} },
    ledger: { rows: ledger }, forms: {} };
}

async function open(br, width, opts) {
  const ctx = await br.newContext({ viewport: { width, height: 900 }, serviceWorkers: "block" });
  const p = await ctx.newPage();
  const errors = [], urls = [], calls = [];
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("request", (r) => urls.push(r.url()));
  await p.addInitScript(() => {
    window.__cls = 0; window.__shifts = [];
    const name = (n) => !n ? "?" : n.id ? "#" + n.id : (n.nodeName || "?").toLowerCase() + (n.className && typeof n.className === "string" ? "." + n.className.split(" ").join(".") : "");
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) { window.__cls += e.value;
      window.__shifts.push(e.value.toFixed(4) + " " + (e.sources || []).map((x) => name(x.node) + " y" + Math.round(x.previousRect.y) + "->" + Math.round(x.currentRect.y)).join(", ")); } }).observe({ type: "layout-shift", buffered: true }); } catch (e) {}
  });
  if (opts.token) await p.addInitScript((t) => { try { localStorage.setItem("agsist-elev-admin-token", t); } catch (e) {} }, opts.token);
  await p.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  const ledger = [];
  await p.route("https://agsist-api.dnilgis.workers.dev/**", async (r) => {
    const u = new URL(r.request().url()), body = r.request().postData() ? JSON.parse(r.request().postData()) : null;
    calls.push([r.request().method(), u.pathname + u.search, body, r.request().headers().authorization]);
    const send = (j, s = 200) => r.fulfill({ status: s, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(j) });
    if (r.request().headers().authorization !== "Bearer tok") return send({ ok: false }, 403);
    if (u.pathname === "/desk") return send(deskAnswer(ledger));
    if (u.pathname === "/desk/ledger" && body && body.action === "mark") { ledger.unshift({ slug: body.slug, period: body.period, amount: body.amount, paid_on: body.paid_on, at: iso(Date.now()) }); return send({ ok: true, rows: ledger }); }
    if (u.pathname === "/desk/ledger" && body && body.action === "unmark") { ledger.splice(0, ledger.length); return send({ ok: true, rows: [] }); }
    return send({ ok: false }, 404);
  });
  await p.route("https://api.github.com/**", (r) => {
    const u = r.request().url();
    if (opts.github === "limit") return r.fulfill({ status: 403, contentType: "application/json", body: "{}" });
    if (opts.github === "some" && /hay-ams/.test(u)) return r.fulfill({ status: 403, contentType: "application/json", body: "{}" });
    const m = /workflows\/([a-z_-]+\.yml)\/runs/.exec(u);
    if (m) return r.fulfill({ contentType: "application/json", body: JSON.stringify({ workflow_runs: [RUN(m[1] === "daily.yml" ? 11 : 12, m[1] === "cattle-auction.yml" && !opts.noRed ? "failure" : "success", m[1])] }) });
    return r.fulfill({ status: 404, body: "" });
  });
  await p.route("https://dnilgis.github.io/bids/data/**", (r) => {
    const u = r.request().url();
    if (/directory\.json/.test(u)) return r.fulfill({ contentType: "application/json", body: JSON.stringify(DIR) });
    if (/elevator-ids\.jsonl/.test(u)) return r.fulfill({ contentType: "text/plain", body: IDS });
    return r.fulfill({ status: 404, body: "" });
  });
  for (const [k, v] of Object.entries(FIX)) await p.route(opts.origin + k, (r) => opts.audDown && /audience/.test(k) ? r.fulfill({ status: 500, body: "" }) : r.fulfill({ contentType: "application/json", body: JSON.stringify(v) }));
  await p.goto(opts.origin + "/desk");
  await p.waitForSelector(".tiles");
  return { p, ctx, errors, urls, calls };
}
async function noAddress(p) {
  const t = await p.evaluate(() => document.body.innerText);
  assert.doesNotMatch(t, EMAIL, "no email address in the page text");
  assert.doesNotMatch(t, STREET, "no street address in the page text");
  return t;
}

test("in a browser: without the token the private cards stay closed and the worker is never asked", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), origin = `http://127.0.0.1:${srv.address().port}`;
  const br = await chromium.launch({ executablePath: CHROME });
  try {
    const S = await open(br, 390, { origin });
    assert.equal(S.calls.length, 0, "no worker call without the token");
    assert.ok(!S.urls.some((u) => u.startsWith("https://agsist-api.")), "no request to the worker host");
    for (const id of ["signups", "money"]) assert.match(await S.p.textContent("#c-" + id), /Paste the token to see this\./, id);
    const tiles = await S.p.$$eval(".tile", (els) => els.map((e) => e.innerText));
    assert.ok(tiles.some((t) => /Daily readers\s*Token needed/.test(t)), "the readers tile asks for the token");
    assert.match(await S.p.textContent("#tok-state"), /No token in this browser/);
    assert.match(await S.p.textContent("#c-ads"), /Root Lot/, "public parts still draw");
    await noAddress(S.p);
    assert.deepEqual(S.errors, []);
    await S.ctx.close();
  } finally { await br.close(); srv.close(); }
});

test("in a browser at 360, 390 and 1280: every card, no sideways scroll, no layout shift, mark paid", { skip, timeout: 180000 }, async () => {
  const srv = await serve(), origin = `http://127.0.0.1:${srv.address().port}`;
  const br = await chromium.launch({ executablePath: CHROME });
  try {
    /* 360 too: the old page shifted there (a status line that rewrapped), as it did at 390 on CI's fonts */
    for (const width of [360, 390, 1280]) {
      const S = await open(br, width, { origin, token: "tok" });
      const { p } = S;
      await p.waitForFunction(() => /Token accepted/.test(document.getElementById("tok-state").textContent));
      const dims = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
      assert.ok(dims.sw <= dims.iw, `no sideways scroll at ${width} (${dims.sw} > ${dims.iw})`);
      const cls = await p.evaluate(() => [window.__cls, window.__shifts]);
      assert.ok(cls[0] < 0.01, `no layout shift at ${width}: ${cls[0].toFixed(4)} from ${cls[1].join("; ")}`);
      const t = await noAddress(p);
      /* headline tiles */
      const tiles = await p.$$eval(".tile", (els) => els.map((e) => e.innerText.replace(/\s+/g, " ").trim()));
      assert.equal(tiles.length, 8, tiles.join(" | "));
      assert.match(tiles[0], /^The Daily today Sent .* CT Corn bounces/);
      assert.match(tiles[1], /^Checks on main 1 red Cattle auctions/);
      assert.match(tiles[2], /^Ads live 2 Root Lot, Barn Co \(1 free test\)/);
      assert.match(tiles[3], /^Daily readers 182 \+14 joined, 2 left, 7 days/);
      assert.match(tiles[4], /^Boards read now 2,098 98 late, 133 withdrawn/);
      assert.match(tiles[5], /^Rain Print, 120 days \$287\.00 5 paid; \$108\.00 this week/);
      assert.match(tiles[6], /^Readers, 7 days /);
      assert.match(tiles[7], /^To-dos open \d+/);
      /* card text */
      const today = await p.textContent("#c-today");
      assert.match(today, /To how many: can’t read: the send count is only in the job log/);
      assert.match(today, /On the list now: 182/);
      assert.match(tiles[1], /1 red/);
      assert.match(today, /Day flag .*: set/);
      const ads = await p.textContent("#c-ads");
      assert.match(ads, /Root Lot.*free test.*counter not started/s);
      assert.match(ads, /Barn Co.*not marked paid for \d{4}-\d{2}.*1,234 views, 17 clicks/s);
      assert.match(ads, /Apex Insurance Group.*Ended Oct 8, 2026/s);
      const sig = await p.textContent("#c-signups");
      for (const s of ["Sitewide bar90", "Town pages20", "Homepage12", "Page asks40", "Imported or added by hand20", "All Daily readers182",
        "Rain gauge waiting list214", "Monthly land sales62", "County cash rent notice90", "Milk price day10", "Hail alerts4can\u2019t read", "those lists keep no join time"]) assert.ok(sig.includes(s), s);
      assert.doesNotMatch(sig, /landsales:|prf:|\d{5}/, "no topic with its place, no ZIP");
      const boards = await p.textContent("#c-boards");
      assert.match(boards, /New this week: 2 elevators added, 1 of them with a board we read/);
      assert.match(boards, /2 waiting/);
      const money_ = await p.textContent("#c-money");
      assert.match(money_, /5 paid for \$287\.00/);
      assert.match(money_, /3 cards: 1 open, 2 redeemed, 0 void/);
      const aud = await p.textContent("#c-audience");
      assert.match(aud, /Data-center traffic left out/);
      assert.match(aud, /Visits from AI assistants/);
      for (const c of ["today", "ads", "signups", "boards", "money", "audience", "todo"]) assert.match(await p.innerHTML("#c-" + c), /class="src"/, c + " names its source");
      assert.ok(t.length > 500);
      if (process.env.DESK_SHOTS) { fs.mkdirSync(process.env.DESK_SHOTS, { recursive: true }); await p.screenshot({ path: path.join(process.env.DESK_SHOTS, `desk-${width}.png`), fullPage: true }); }

      /* mark Barn Co paid */
      assert.deepEqual(await p.$$eval("#m-slug option", (o) => o.map((x) => x.value)), ["barnco", "apex", ""], "live paid sponsors first, free tests left out");
      await p.selectOption("#m-slug", "barnco");
      await p.fill("#m-amt", "29");
      await p.click('#mark button[type="submit"]');
      await p.waitForFunction(() => /Marked barnco paid/.test((document.getElementById("m-out") || {}).textContent || ""));
      const post = S.calls.filter((c) => c[0] === "POST");
      assert.equal(post.length, 1);
      assert.equal(post[0][1], "/desk/ledger");
      assert.equal(post[0][2].slug, "barnco"); assert.equal(post[0][2].amount, 29); assert.match(post[0][2].period, /^\d{4}-\d{2}$/);
      assert.match(await p.textContent("#c-ads"), /Barn Co.*paid \d{4}-\d{2}, \$29\.00/s);
      assert.match(await p.textContent("#c-money"), /Marked paid: \$29\.00/);
      p.once("dialog", (d) => d.accept());
      await p.click("[data-unmark]");
      await p.waitForFunction(() => /Nothing marked paid yet/.test(document.getElementById("c-ads").textContent));
      assert.ok(S.calls.every((c) => c[3] === "Bearer tok"), "the token in the header");
      assert.ok(!S.urls.some((u) => /tok/.test(new URL(u).search + new URL(u).hash)), "the token is in no address");
      assert.deepEqual(S.errors, []);
      await S.ctx.close();
    }
  } finally { await br.close(); srv.close(); }
});

test("in a browser: a failed source says can't read, never a blank; a refused token says so", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), origin = `http://127.0.0.1:${srv.address().port}`;
  const br = await chromium.launch({ executablePath: CHROME });
  try {
    let S = await open(br, 390, { origin, token: "tok", github: "limit", audDown: true });
    const today = await S.p.textContent("#c-today");
    assert.match(today, /can’t read: GitHub refused \(403\)/);
    assert.match(await S.p.textContent("#c-audience"), /can’t read: agsist\.com answered 500/);
    const tiles = await S.p.$$eval(".tile", (els) => els.map((e) => e.innerText.replace(/\s+/g, " ").trim()));
    assert.ok(tiles.some((t) => /^Checks on main Can’t read/.test(t)));
    assert.ok(tiles.some((t) => /^Readers, 7 days Can’t read/.test(t)));
    for (const v of await S.p.$$eval(".tile .v", (els) => els.map((e) => e.textContent.trim()))) assert.ok(v.length, "no blank tile");
    await S.ctx.close();
    /* some jobs read, one not: never "all green" */
    S = await open(br, 390, { origin, token: "tok", github: "some" });
    const t2 = await S.p.$$eval(".tile", (els) => els.map((e) => e.innerText.replace(/\s+/g, " ").trim()));
    assert.ok(t2.some((t) => /^Checks on main 1 red Cattle auctions/.test(t)), t2[1]);
    await S.ctx.close();
    S = await open(br, 390, { origin, token: "tok", github: "some", noRed: true });
    const t3 = await S.p.$$eval(".tile", (els) => els.map((e) => e.innerText.replace(/\s+/g, " ").trim()));
    assert.ok(t3.some((t) => /^Checks on main No red seen 1 of 5 can\u2019t read: GitHub refused/.test(t)), t3[1]);
    assert.match(await S.p.textContent("#c-today"), /Hay reportscan\u2019t read: GitHub refused/);
    await S.ctx.close();
    S = await open(br, 390, { origin, token: "wrong" });
    assert.match(await S.p.textContent("#tok-state"), /can’t read: the token was not accepted/);
    assert.match(await S.p.textContent("#c-signups"), /can’t read: the token was not accepted/);
    await noAddress(S.p);
    await S.ctx.close();
  } finally { await br.close(); srv.close(); }
});
