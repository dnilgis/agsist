/* "Email me when X" asks (2026-10-17, Sig: more signups wherever a reader has a
 * reason to come back). Each ask must post the topic its sender reads, and say
 * only what that sender sends.
 *   - county rain pages (/rain/<st>/<county>): rainyear:<year>:<fips>, one email
 *     in January (scripts/send_rain_year.py, run by county-rain.yml);
 *   - co-op company pages (/cash-bids/company/<slug>): the town pages' bid email
 *     box with its own ZIP field (AGSIST Daily by ZIP, send_zip_alert.py);
 *   - What's Priced In: AGSIST Daily with report-day mail (send_report_day.py).
 * The browser parts need Playwright and Chromium and skip where they are missing.
 *
 *   node --test test/alert-asks.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const DASH = /[–—]|&mdash;|&ndash;/;

const rainFiles = fs.readdirSync(path.join(ROOT, "data/rain")).filter((f) => /^[a-z]{2}\.json$/.test(f));
const RAIN = {};
for (const f of rainFiles) {
  const d = JSON.parse(read("data/rain/" + f));
  for (const [fips, c] of Object.entries(d.counties || {})) RAIN[fips] = { name: c.name, year: d.year, done: String(d.edate || "").endsWith("-12-31") };
}
function countyPages() {
  const out = [];
  for (const st of fs.readdirSync(path.join(ROOT, "rain"))) {
    const dir = path.join(ROOT, "rain", st);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir)) if (f.endsWith(".html")) out.push(`rain/${st}/${f}`);
  }
  return out;
}

test("every county rain page asks once, for its own county and year, and says what comes", () => {
  const pages = countyPages();
  assert.ok(pages.length > 2000, "county rain pages found: " + pages.length);
  let asked = 0;
  for (const p of pages) {
    const h = read(p);
    const asks = [...h.matchAll(/<div data-signup-ask="([^"]*)" data-topic="rainyear:(\d{4}):(\d{5})" data-ok="([^"]*)" data-note="([^"]*)"><\/div>/g)];
    const any = (h.match(/data-signup-ask/g) || []).length;
    const m = asks[0];
    if (!m) { assert.equal(any, 0, p + ": a signup ask that is not the rainyear ask"); continue; }
    assert.equal(any, 1, p + ": one ask a page");
    const [, copy, year, fips, ok, note] = m;
    const c = RAIN[fips];
    assert.ok(c, p + ": the ask's FIPS " + fips + " is a county in data/rain");
    assert.ok(!c.done, p + ": no ask once the year is finished");
    assert.equal(+year, c.year, p + ": the ask's year is the data's year");
    const name = c.name.replace(/&/g, "&amp;");
    assert.equal(copy, `Email me ${name}&rsquo;s full ${year} rain total in January.`, p + ": the ask names the county and the year");
    assert.equal(ok, `Done. One email in January, once NOAA has all of ${year} for ${name}.`, p);
    assert.match(note, /^One email: /, p);
    assert.ok(!DASH.test(copy + ok + note), p + ": no dashes");
    assert.ok(h.indexOf("<h2>Month by month</h2>") < h.indexOf("data-signup-ask"), p + ": under the month table");
    asked++;
  }
  assert.ok(asked > 2000, "pages with the ask: " + asked);
});

test("the rain year sender rides county-rain.yml, in January only, with no new schedule", () => {
  const y = read(".github/workflows/county-rain.yml");
  const crons = [...y.matchAll(/- cron: "([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(crons, ["23 13 * * 1", "41 14 2 1 *"], "the two schedules it already had");
  assert.ok(y.includes("python scripts/send_rain_year.py --selftest"), "offline selftest first");
  const at = y.indexOf("python3 scripts/send_rain_year.py --send");
  assert.ok(at > y.indexOf("- name: Commit"), "the send runs after the finished year is committed");
  assert.match(y.slice(y.lastIndexOf("- name:", at), at), /date \+%m\)" != "01" \]; then .* exit 0; fi/, "January only");
  const s = read("scripts/send_rain_year.py");
  assert.ok(s.includes('TOPIC_RE = re.compile(r"rainyear:(\\d{4}):(\\d{5})")'), "reads the same topic the page posts");
  assert.ok(!/print\([^)]*\be\b[,)]/.test(s), "never prints an address");
});

test("the worker takes rainyear for this year only and refuses a made-up county", async () => {
  const tmp = path.join(os.tmpdir(), "subs-worker-alert-asks-" + process.pid + ".mjs");
  fs.copyFileSync(path.join(ROOT, "workers/subs-worker.js"), tmp);
  const w = (await import(pathToFileURL(tmp).href)).default;
  fs.unlinkSync(tmp);
  const store = new Map();
  const env = { UNSUB_SECRET: "sec", LIST_TOKEN: "tok", SUBS: {
    async get(k) { return store.has(k) ? store.get(k) : null; }, async put(k, v) { store.set(k, v); }, async delete(k) { store.delete(k); },
    async list({ prefix }) { return { keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }; } } };
  const post = (b) => w.fetch(new Request("https://x.dev/notice", { method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://agsist.com" }, body: JSON.stringify(b) }), env);
  const cy = new Date().getUTCFullYear();
  let r = await post({ email: "a@example.com", topic: `rainyear:${cy}:19169`, source: "page:rain/iowa/story-county" });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).topic, `rainyear:${cy}:19169`);
  for (const t of [`rainyear:${cy + 1}:19169`, `rainyear:${cy}:72001`, `rainyear:${cy}:19000`, `rainyear:${cy}:19169x`]) {
    r = await post({ email: "b@example.com", topic: t });
    assert.equal(r.status, 400, t);
  }
  assert.ok(read("workers/subs-worker.js").includes(" * v5.28 (2026-10-17): RAIN YEAR NOTICE."), "the worker header names the change");
});

test("company pages carry the town pages' bid email box with their own ZIP field", () => {
  const b = read("scripts/build_company_pages.py");
  assert.ok(b.includes(`<input type="hidden" id="co-zip" value=""><div id="bid-email" data-bid-alerts data-zip-input="co-zip" `));
  assert.ok(b.includes(`data-source="company:{co["slug"][:50]}"`));
  assert.ok(b.includes("CB.page_end(ftr, signup=bool(box))") && b.includes("CB.SIGNUP_CSS"), "loads cb-signup.js and its CSS once");
  const cbs = read("components/cb-signup.js");
  assert.ok(cbs.includes("if (!fixedZip && !zipIn) return;"), "no ZIP source, no box");
  assert.ok(cbs.includes("'<input type=\"tel\" class=\"cbs-zip\""), "with data-zip-input the box shows its own ZIP field");
});

test("What's Priced In asks for the report-day email, which send_report_day.py sends", () => {
  const h = read("whats-priced-in.html");
  const asks = h.match(/<div data-signup-ask="[^"]*"[^>]*><\/div>/g) || [];
  assert.equal(asks.length, 1);
  assert.ok(asks[0].includes('data-signup-ask="Email me the afternoon of each WASDE and Grain Stocks report: what the trade expected and how USDA graded."'));
  assert.ok(asks[0].includes('data-note="Comes with AGSIST Daily, the free morning markets email."'), "says it is the Daily");
  assert.ok(!asks[0].includes("data-reports=\"0\"") && !asks[0].includes("data-topic"), "a Daily signup with report-day mail on");
  assert.ok(!DASH.test(asks[0]));
  assert.match(read("scripts/send_report_day.py"), /TYPES = \("WASDE", "Crop Production", "Grain Stocks"\)/);
});

test("signup-ask.js: the morning briefing box never starts ticked (Sig, 2026-10-19)", () => {
  const s = read("components/signup-ask.js");
  assert.ok(s.includes(`<input type="checkbox" id="' + did + '"> Also send the morning briefing</label>`));
  assert.ok(!/dailyOn|getAttribute\('data-daily'\)/.test(s), "no attribute turns the box on");
});

// ---------------------------------------------------------------- in a browser
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (fs.existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !fs.existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

function serve(extra = {}) {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (extra[p]) { res.writeHead(200, { "content-type": "text/html" }); res.end(extra[p]); return; }
    const f = path.normalize(path.join(ROOT, p));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" });
    res.end(fs.readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}
async function open(browser, port, url, posts) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
  const pg = await ctx.newPage();
  await pg.route("**/*", (r) => {
    const u = r.request().url();
    if (u.startsWith(`http://127.0.0.1:${port}`)) return r.continue();
    if (u.startsWith("https://agsist-subs.dnilgis.workers.dev/")) {
      posts.push({ path: new URL(u).pathname, body: JSON.parse(r.request().postData() || "{}") });
      return r.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ ok: true }) });
    }
    return r.abort();
  });
  await pg.goto(`http://127.0.0.1:${port}${url}`, { waitUntil: "load" });
  return pg;
}

test("county rain page: the ask posts rainyear for that county; the Daily box starts empty and is ticked by the reader", { skip, timeout: 60000 }, async () => {
  const p = "rain/iowa/story-county.html", h = read(p);
  const m = /data-topic="(rainyear:\d{4}:\d{5})"/.exec(h);
  assert.ok(m, "the Story County page has the ask");
  const srv = await serve(), port = srv.address().port, posts = [];
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const pg = await open(browser, port, "/" + p, posts);
    const ask = pg.locator(`[data-sa-topic="${m[1]}"]`);
    await ask.waitFor();
    assert.equal(await ask.locator(".sa-d input").isChecked(), false, "morning briefing box starts empty");
    assert.equal(await ask.locator(".sa-z").isVisible(), false, "its ZIP box closed until the box is ticked");
    await ask.locator(".sa-d input").check();
    assert.equal(await ask.locator(".sa-z").isVisible(), true, "ticking opens the ZIP box");
    await ask.locator(".sa-in").fill("reader@example.com");
    await ask.locator(".sa-zin").fill("50010");
    await ask.locator(".sa-b").click();
    await ask.locator(".sa-ok").waitFor();
    const n = posts.filter((x) => x.path === "/notice");
    assert.equal(n.length, 1);
    assert.deepEqual({ ...n[0].body }, { email: "reader@example.com", source: "page:rain/iowa/story-county", topic: m[1], daily: true, reports: true, zip: "50010" });
    assert.match(await ask.locator(".sa-ok").textContent(), /^Done\. One email in January, once NOAA has all of \d{4} for Story County\. The morning briefing starts tomorrow\.$/);
  } finally { await browser.close(); srv.close(); }
});

test("company page box: its own ZIP field, the Daily by ZIP and the 25 mi price alert", { skip, timeout: 60000 }, async () => {
  const page = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/components/styles.css"><link rel="stylesheet" href="/components/cb-signup.css?v=2"></head><body><main>
<input type="hidden" id="co-zip" value=""><div id="bid-email" data-bid-alerts data-zip-input="co-zip" data-source="company:acme-co-op" data-crops="corn soybeans wheat"></div>
</main><script src="/components/cb-signup.js?v=3" defer></script></body></html>`;
  const srv = await serve({ "/company-test.html": page }), port = srv.address().port, posts = [];
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const pg = await open(browser, port, "/company-test.html", posts);
    await pg.locator(".cbs-zip").waitFor();
    assert.equal(await pg.locator(".cbs-d").isChecked(), false, "morning bids box starts empty (Sig, 2026-10-19)");
    await pg.locator(".cbs-d").check();
    await pg.locator(".cbs-zip").fill("50830");
    await pg.locator(".cbs-price").fill("4.50");
    await pg.locator(".cbs-em").fill("reader@example.com");
    await pg.locator(".cbs-go").click();
    await pg.locator(".cbs-done").waitFor();
    const sub = posts.find((x) => x.path === "/subscribe"), al = posts.find((x) => x.path === "/elevator-watch-subscribe");
    assert.ok(sub && sub.body.zip === "50830" && sub.body.source === "company:acme-co-op", JSON.stringify(sub));
    assert.ok(al && al.body.ewid === "ab50830025" && al.body.target_cents === 450 && al.body.crop === "corn", JSON.stringify(al));
  } finally { await browser.close(); srv.close(); }
});

test("rent release emails ride cash-rent.yml with no new schedule, after the commit", () => {
  const y = read(".github/workflows/cash-rent.yml");
  assert.deepEqual([...y.matchAll(/- cron: "([^"]+)"/g)].map((m) => m[1]), ["20 14 * * 3"]);
  assert.ok(y.includes("python scripts/send_rent_notice.py --selftest"), "offline selftest in the gate");
  const at = y.indexOf("python3 scripts/send_rent_notice.py --send");
  assert.ok(at > y.indexOf("- name: Commit"), "after the new rents are committed");
  const s = read("scripts/send_rent_notice.py");
  assert.ok(s.includes('TOPIC_RE = re.compile(r"rent:([a-z]{2})")'), "reads the topic the rent pages post");
  assert.ok(read("scripts/build_state_rent_pages.py").includes('data-topic="rent:{st.lower()}"'));
  assert.ok(read("scripts/send_notice.py").includes("import send_rent_notice"), "send_notice.py hands rent topics over");
});
