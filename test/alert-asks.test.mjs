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
import { execFileSync } from "node:child_process";
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
  // Sig, Oct 23 2026: the rain pages rebuild every day (was Mondays, "23 13 * * 1"); the Jan 2 run stays
  assert.deepEqual(crons, ["23 13 * * *", "41 14 2 1 *"], "every day at 13:23 UTC, and the Jan 2 finished-year run");
  assert.ok(y.includes("python scripts/send_rain_year.py --selftest"), "offline selftest first");
  const at = y.indexOf("python3 scripts/send_rain_year.py --send");
  assert.ok(at > y.indexOf("- name: Commit"), "the send runs after the finished year is committed");
  assert.match(y.slice(y.lastIndexOf("- name:", at), at), /date \+%m\)" != "01" \]; then .* exit 0; fi/, "January only");
  const s = read("scripts/send_rain_year.py");
  assert.ok(s.includes('TOPIC_RE = re.compile(r"rainyear:(\\d{4}):(\\d{5})")'), "reads the same topic the page posts");
  // a daily schedule must not mean more email: never on Jan 1, one email per address (marked after the send)
  assert.ok(s.includes("FIRST_DAY = 2") && /today\.day < FIRST_DAY/.test(s), "nothing on Jan 1, the first send is Jan 2");
  assert.match(s, /if not SN\.mark\(http, base, tok, e, t, sleep\):/, "every send is marked before the next");
  const st = execFileSync("python3", ["scripts/send_rain_year.py", "--selftest"], { cwd: ROOT, encoding: "utf8" });
  assert.match(st, /ok {3}daily runs through January: each address mailed exactly once/);
  assert.match(st, /ok {3}Jan 1: nothing read, nothing sent/);
  assert.match(st, /OK: 0 failure\(s\)/);
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

test("What's Priced In asks for the WASDE summary (Oct 21: its own list), which send_report_day.py sends", () => {
  const h = read("whats-priced-in.html");
  const asks = h.match(/<div data-signup-ask="[^"]*"[^>]*><\/div>/g) || [];
  assert.equal(asks.length, 1);
  assert.ok(asks[0].includes('data-signup-ask="Email me the WASDE summary when it drops"'), "Sig's words");
  assert.ok(asks[0].includes('data-topic="reports"') && asks[0].includes('data-source="report:wasde:whats-priced-in"'), "the report-day list alone, tagged");
  assert.ok(!asks[0].includes("Comes with AGSIST Daily") && !asks[0].includes("data-daily"), "no longer the Daily");
  assert.ok(!DASH.test(asks[0]));
  assert.match(read("scripts/send_report_day.py"), /TYPES = \("WASDE", "Crop Production", "Grain Stocks"\)/);
  assert.ok(read("scripts/send_report_day.py").includes('subscribers.fetch_topic(base, token, "reports")'), "the sender reads the list");
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
    if (u.startsWith("https://agsist-api.dnilgis.workers.dev/")) {
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
</main><script src="/components/cb-signup.js?v=2" defer></script></body></html>`;
  const srv = await serve({ "/company-test.html": page }), port = srv.address().port, posts = [];
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const pg = await open(browser, port, "/company-test.html", posts);
    await pg.locator(".cbs-zip").waitFor();
    assert.equal(await pg.locator(".cbs-d").isChecked(), true, "morning bids box ticked: the box's main offer (Sig, 2026-10-19)");
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

// ---------------------------------------------------------------- page-matched asks (Sig, Oct 23)
// The generic bar opened 0.5% of the time it showed (GA4, 28 days). On these page types the bar is gone and
// one ask that fits the page stands in its place. Each ask posts the topic its sender reads.
const asksIn = (h) => h.match(/<div [^>]*data-(?:signup|price)-ask[^>]*>/g) || [];
const attr = (tag, name) => (new RegExp(`\\s${name}="([^"]*)"`).exec(tag) || [])[1];

test("state rent pages: one ask, right under the median card, for that state's rent:<st> notice", () => {
  const files = fs.readdirSync(path.join(ROOT, "rent")).filter((f) => f.endsWith(".html") && f !== "index.html");
  assert.ok(files.length >= 45, "state pages: " + files.length);
  for (const f of files) {
    const h = read("rent/" + f), asks = asksIn(h).filter((t) => attr(t, "data-source") !== "footer");
    assert.equal(asks.length, 1, f + ": one ask a page");
    const name = /<h1>(.+?) Cash Rent by County, \d{4}<\/h1>/.exec(h)[1];
    const st = /^rent:([a-z]{2})$/.exec(attr(asks[0], "data-topic"));
    assert.ok(st, f + ": topic rent:<st>");
    assert.equal(attr(asks[0], "data-signup-ask"), `Email me when USDA updates ${name} cash rents.`, f);
    assert.ok(!attr(asks[0], "data-source"), f + ": the source is the page's own (page:rent/<state>)");
    assert.ok(!DASH.test(asks[0]), f + ": no dashes");
    const at = h.indexOf("data-signup-ask=");
    assert.ok(h.indexOf("The median " + name + " county paid") < at && at < h.indexOf('class="rs-hero"'), f + ": under the median card, above the tiles");
    assert.ok(at < h.indexOf('id="counties"'), f + ": above the county table");
  }
  assert.ok(!/data-signup-ask/.test(read("rent/index.html").replace(/<div[^>]*data-source="(footer|menu-[a-z]+)"[^>]*>/g, "")), "the /rent hub has no state to ask about");
  const g = read("scripts/build_state_rent_pages.py");
  assert.ok(g.includes('data-topic="rent:{st.lower()}"') && g.includes("Email me when USDA updates {name} cash rents."), "the generator writes it");
});

test("futures pages keep their one ask (Funds this week, topic cot); ARC/PLC pages keep the reminder", () => {
  for (const p of ["corn", "soybean", "wheat", "cattle"]) {
    const asks = asksIn(read(`${p}-futures-prices.html`)).filter((t) => !/data-source="(footer|menu-[a-z]+)"/.test(t));
    assert.equal(asks.length, 1, p + ": one ask");
    assert.equal(attr(asks[0], "data-topic"), "cot", p);
    assert.equal(attr(asks[0], "data-source"), `cot-weekly:${p}-futures-prices`, p);
  }
  const gen = read("scripts/build_arc_plc.py");
  assert.ok(gen.includes('<div data-signup-ask data-deadlines="{" ".join(left)}"></div>'), "the reminder ask takes the deadlines from YEAR_INFO");
  for (const p of ["arc-plc.html", "arc-plc/alabama.html", "arc-plc/alabama/autauga-county.html"]) {
    const asks = asksIn(read(p)).filter((t) => !/data-source="(footer|menu-[a-z]+)"/.test(t));
    assert.equal(asks.length, 1, p + ": one ask");
    assert.match(attr(asks[0], "data-deadlines"), /^\d{4}-\d{2}-\d{2}( \d{4}-\d{2}-\d{2})*$/, p + ": dates come from the builder");
    assert.ok(!attr(asks[0], "data-topic") && !attr(asks[0], "data-source"), p + ": the component writes the arcplc:<date> topic");
  }
  assert.match(read("scripts/send_notice.py"), /arcplc_deadlines/, "the sender reads the same deadlines");
});

test("break-even, grain bin and yield pages: the ask sits under the answer, once", () => {
  const be = read("breakeven.html");
  assert.equal((be.match(/data-price-ask/g) || []).length, 1, "one price watch slot");
  const daily = asksIn(be).filter((t) => /id="be-daily-ask"/.test(t));
  assert.equal(daily.length, 1);
  assert.equal(attr(daily[0], "data-source"), "page:breakeven");
  assert.equal((be.match(/data-signup-ask="Email me my top/g) || []).length, 1, "one Daily ask, the stand-in");
  assert.ok(be.indexOf('id="futNeeded"') < be.indexOf("data-price-ask") && be.indexOf("data-price-ask") < be.indexOf('id="yieldNeeded"'), "under the futures price it works out");
  // the watch follows only contracts the sender and the worker take
  const js = read("components/breakeven.js"), m = /WATCH_SYM = \{([^}]*)\}/.exec(js);
  assert.ok(m, "the crop to symbol map");
  const syms = [...m[1].matchAll(/:\s*'([a-z-]+)'/g)].map((x) => x[1]);
  assert.deepEqual(syms.sort(), ["beans-nov", "corn-dec", "wheat"]);
  const sender = read("scripts/send_price_watch.py"), worker = read("workers/subs-worker.js");
  for (const s of syms) {
    assert.ok(new RegExp(`"${s}":\\s+"`).test(sender.slice(sender.indexOf("ALLOWED_SYMBOLS"))), s + ": the sender follows it");
    assert.ok(new RegExp(`PWATCH_SYMBOLS = new Set\\([^)]*"${s}"`).test(worker), s + ": the worker takes it");
  }
  const gb = read("grain-bin-calculator.html"), ye = read("yield-estimator.html");
  const gba = asksIn(gb).filter((t) => !/data-source="(footer|menu-[a-z]+)"/.test(t));
  assert.equal(gba.length, 1);
  assert.equal(attr(gba[0], "data-source"), "page:grain-bin-calculator");
  assert.ok(gb.indexOf('id="rWeight"') < gb.indexOf("data-signup-ask") && gb.indexOf("data-signup-ask") < gb.indexOf("Show volume breakdown"), "right under the bushels and weight");
  const yea = asksIn(ye).filter((t) => !/data-source="(footer|menu-[a-z]+)"/.test(t));
  assert.equal(yea.length, 2, "one under each tab's answer (one tab shows at a time)");
  for (const t of yea) assert.equal(attr(t, "data-source"), "page:yield-estimator");
  assert.ok(ye.indexOf('id="c-plain"') < ye.indexOf("data-signup-ask") && ye.indexOf('id="b-plain"') < ye.lastIndexOf("data-signup-ask"));
  for (const h of [be, gb, ye]) assert.ok(!DASH.test(asksIn(h).join("")), "no dashes in the asks");
  const sa = read("components/signup-ask.js");
  assert.ok(sa.includes("'/price-watch-subscribe', priceBody(email, el.getAttribute('data-sa-pwsym'), 'above', dollars)"), "the homepage alert's route and body");
});

const STAYS_OFF = [
  ["/rent/iowa.html", "state rent page"], ["/corn-futures-prices.html", "futures page"], ["/cattle-futures-prices.html", "cattle futures page"],
  ["/arc-plc.html", "ARC/PLC"], ["/arc-plc/alabama/autauga-county.html", "ARC/PLC county page"],
  ["/breakeven.html", "break-even"], ["/grain-bin-calculator.html", "grain bin"], ["/yield-estimator.html", "yield estimator"],
];
async function openAs(browser, port, url, posts, o = {}) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: o.width || 390, height: 844 } });
  const pg = await ctx.newPage();
  await pg.route("**/*", (r) => {
    const u = r.request().url();
    if (u.startsWith(`http://127.0.0.1:${port}`)) return r.continue();
    if (u.startsWith("https://agsist-api.dnilgis.workers.dev/")) {
      posts.push({ path: new URL(u).pathname, body: JSON.parse(r.request().postData() || "{}") });
      return r.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ ok: true }) });
    }
    return r.abort();
  });
  await pg.clock.setFixedTime(new Date("2026-10-23T15:00:00Z"));
  // a returning reader: the bar opens at once on any page that allows it
  await pg.addInitScript((ls) => { try { for (const k in ls) localStorage.setItem(k, ls[k]); } catch (e) {} }, { agsist_visits: "5", ...(o.ls || {}) });
  await pg.goto(`http://127.0.0.1:${port}${url}`, { waitUntil: "load" });
  return pg;
}

test("the second-visit bar stays off the page-matched pages, even after the reader has used the ask", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    // control: the bar still opens where no page-matched ask exists, so the checks below can fail
    let pg = await openAs(browser, port, "/cash-lease.html", []);
    await pg.waitForSelector("#sa-bar", { state: "attached", timeout: 8000 });
    await pg.context().close();
    for (const [url, what] of STAYS_OFF) {
      // asked already (a notice ask hides itself once it is asked for in this browser): the bar must not take its place.
      // A Daily ask hides only for a reader who is on the Daily, who gets no bar anyway.
      const done = { agsist_notices: JSON.stringify({ "rent:ia:2027": Date.now(), "arcplc:2026-12-11": Date.now(), cot: Date.now() }) };
      for (const ls of [{}, done]) {
        pg = await openAs(browser, port, url, [], { ls });
        await pg.waitForTimeout(1500);
        assert.equal(await pg.locator("#sa-bar").count(), 0, `${what} ${url}: no bar${ls === done ? " (the notice already asked for)" : ""}`);
        assert.equal(await pg.evaluate(() => document.body.classList.contains("sa-bar-open")), false, url);
        await pg.context().close();
      }
    }
  } finally { await browser.close(); srv.close(); }
});

test("each page-matched ask posts the topic and source its sender reads", { skip, timeout: 180000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  const send = async (pg, ask, expectOk = ".sa-ok") => {
    await ask.locator(".sa-in").fill("reader@example.com");
    await ask.locator(".sa-b").click();
    await ask.locator(expectOk).waitFor();
  };
  try {
    for (const width of [390, 1280]) {
      let posts = [], pg = await openAs(browser, port, "/rent/iowa.html", posts, { width });
      let ask = pg.locator('[data-sa-topic="rent:ia"]');
      await ask.waitFor();
      assert.equal((await ask.locator(".sa-l").textContent()).trim(), "Email me when USDA updates Iowa cash rents.");
      assert.equal(await ask.locator(".sa-d input").isChecked(), false, "the Daily box starts empty");
      await send(pg, ask);
      assert.deepEqual(posts.filter((x) => x.path === "/notice").map((x) => x.body), [{ email: "reader@example.com", source: "page:rent/iowa", topic: "rent:ia", daily: false }], "rent " + width);
      assert.match(await ask.locator(".sa-ok").textContent(), /^Done\. One email when USDA puts out the 2027 Iowa county rents, usually in August\./);
      await pg.context().close();

      posts = []; pg = await openAs(browser, port, "/arc-plc.html", posts, { width });
      ask = pg.locator('[data-sa-topic="arcplc:2026-12-11"]');
      await ask.waitFor();
      assert.equal((await ask.locator(".sa-l").textContent()).trim(), "Remind me a week before the Dec 11 signup deadline.");
      await send(pg, ask);
      assert.deepEqual(posts.filter((x) => x.path === "/notice").map((x) => x.body), [{ email: "reader@example.com", source: "page:arc-plc", topic: "arcplc:2026-12-11", daily: false }], "arc " + width);
      await pg.context().close();

      posts = []; pg = await openAs(browser, port, "/corn-futures-prices.html", posts, { width });
      ask = pg.locator('[data-sa-topic="cot"]').first();
      await ask.waitFor();
      await send(pg, ask);
      assert.deepEqual(posts.filter((x) => x.path === "/notice").map((x) => x.body), [{ email: "reader@example.com", source: "cot-weekly:corn-futures-prices", topic: "cot", daily: false }], "futures " + width);
      await pg.context().close();

      for (const [url, src, sel] of [["/grain-bin-calculator.html", "page:grain-bin-calculator", ".gb-ask"], ["/yield-estimator.html", "page:yield-estimator", ".ye-panel.active .ye-ask"]]) {
        posts = []; pg = await openAs(browser, port, url, posts, { width });
        ask = pg.locator(sel + " [data-signup-ask]");
        await ask.waitFor();
        await ask.locator(".sa-in").waitFor();
        assert.equal(await ask.isVisible(), true, url + ": shown under the answer");
        await send(pg, ask);
        const sub = posts.filter((x) => x.path === "/subscribe");
        assert.equal(sub.length, 1, url);
        assert.equal(sub[0].body.source, src, url + " " + width);
        assert.equal(sub[0].body.email, "reader@example.com");
        await pg.context().close();
      }

      // break-even: the Daily stands in on a contract the watch cannot follow; on December corn it is the price watch
      posts = []; pg = await openAs(browser, port, "/breakeven.html", posts, { width });
      await pg.locator("#be-daily-ask .sa-in").waitFor();
      await pg.waitForTimeout(600);
      const yr = await pg.evaluate(() => (document.getElementById("be-year") || {}).value);
      if (yr === "1") {
        assert.equal(await pg.locator("#be-price-ask").isVisible(), false, "no watch on next year's contract");
        assert.equal(await pg.locator("#be-daily-ask").isVisible(), true, "the Daily stands in");
        await pg.selectOption("#be-year", "0");
      }
      ask = pg.locator("#be-price-ask");
      await ask.waitFor({ state: "visible" });
      assert.equal(await pg.locator("#be-daily-ask").isVisible(), false, "never both asks");
      const fut = (await pg.locator("#futNeeded").textContent()).replace(/[^0-9.]/g, "");
      assert.equal(await ask.locator(".sa-pw").inputValue(), (+fut).toFixed(2), "prefilled with the futures price the page worked out");
      assert.match(await ask.locator(".sa-l").textContent(), /^Email me when December corn futures reach my break-even$/);
      await send(pg, ask);
      const pw = posts.filter((x) => x.path === "/price-watch-subscribe");
      assert.equal(pw.length, 1);
      assert.deepEqual({ ...pw[0].body, pid: undefined }, { email: "reader@example.com", pid: undefined, symbol: "corn-dec", direction: "above", target_cents: Math.round(fut * 100), label: `Corn (new crop) above $${(+fut).toFixed(2)}` });
      assert.match(pw[0].body.pid, /^[a-f0-9]{8}$/);
      assert.match(await ask.locator(".sa-ok").textContent(), /^Check your email to confirm the alert/);
      await pg.context().close();
    }
  } finally { await browser.close(); srv.close(); }
});
