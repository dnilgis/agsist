// A demo sponsor portal (Oct 29, 2026: Tractor Supply). A prospect opens the
// portal they would get, on a private link: AGSIST's real readers in the
// states picked for the demo, the ad's own counts at the not-started 0, the
// real rate card greyed, and nothing that could put an ad in front of a reader.
// After its last day (expires) the builder drops the data and the page says
// "This demo has ended. Contact Sig."
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { extname, join, normalize } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

const CONF = JSON.parse(read("data/sponsors.json"));
const DEMOS = (CONF.sponsors || []).filter((s) => s.demo === true);
const AUD = JSON.parse(read("data/audience.json"));

// Every file that decides whether an ad is drawn somewhere on the site.
const SERVING = ["data/geo-sponsors.json", "data/page-sponsors.json", "data/sponsor.json", "data/supporters.json",
  "data/prf-sponsors.json", "data/sponsor-slots.json", "data/daily.json"].filter((f) => existsSync(join(ROOT, f)));

test("there is a demo to check, and it is Tractor Supply's", () => {
  assert.ok(DEMOS.length >= 1);
  const t = DEMOS.find((s) => s.slug === "tscdemo");
  assert.ok(t, "tscdemo is on file");
  assert.equal(t.name, "Tractor Supply (demo)");
});

test("a demo carries what it needs and nothing that runs or bills", () => {
  for (const s of DEMOS) {
    assert.match(s.token || "", /^[0-9a-f]{16}$/, s.slug + ": the same token scheme as every portal");
    assert.match(s.expires || "", /^\d{4}-\d{2}-\d{2}$/, s.slug + ": a demo has a last day");
    assert.equal(s.geo, undefined, s.slug + ": no geo id, so no state-targeted ad exists for it");
    assert.equal(s.start, null, s.slug + ": no start date");
    assert.ok(!(s.billing && s.billing.tier), s.slug + ": no billing tier, so no slot reads as held");
    assert.ok(!(s.billing && s.billing.free_test), s.slug + ": not a free test either");
    assert.ok(Array.isArray(s.regions) && s.regions.length, s.slug + ": its states are typed");
    const blob = JSON.stringify(s).toLowerCase();
    assert.ok(!blob.includes("tractorsupply.com") && !/https?:/.test(blob), s.slug + ": no outside link");
    assert.ok(!/logo|\.png|\.svg|\.webp|\.jpg/.test(JSON.stringify(s.demo_ad || {})), s.slug + ": no logo or artwork");
  }
  assert.equal(DEMOS.find((s) => s.slug === "tscdemo").expires, "2026-11-28");
});

test("the demo never appears in any data that serves an ad", () => {
  assert.ok(SERVING.includes("data/geo-sponsors.json") && SERVING.includes("data/page-sponsors.json"));
  for (const f of SERVING) {
    const t = read(f).toLowerCase();
    for (const s of DEMOS) {
      assert.ok(!t.includes(s.slug.toLowerCase()), f + " names " + s.slug);
      assert.ok(!t.includes(s.token), f + " carries " + s.slug + "'s token");
      assert.ok(!t.includes(String(s.demo_for || s.name).toLowerCase()), f + " names " + (s.demo_for || s.name));
    }
  }
  // and the page sponsors' slots never point at a demo portal
  const ps = JSON.parse(read("data/page-sponsors.json"));
  assert.ok(!JSON.stringify(ps).includes("demo"), "no demo entry in page-sponsors.json");
});

test("the builder keeps demos out of GA4 and out of the one-sponsor count", () => {
  const B = read("scripts/build_sponsor_report.py");
  assert.match(B, /sponsors = \[s for s in conf\.get\("sponsors", \[\]\) if s\.get\("active", True\) and not is_demo\(s\)\]/);
  const CHK = read("scripts/sponsor-checks.mjs");
  assert.match(CHK, /s\.active !== false && s\.demo !== true/);
});

function py(code) {
  return JSON.parse(execFileSync("python3", ["-c", "import sys,json\nsys.path.insert(0,'scripts')\nimport build_sponsor_report as b\nfrom datetime import date\n" + code], { cwd: ROOT, encoding: "utf8" }).trim().split("\n").pop());
}

test("the builder: full page up to the last day, the ended stub after it, no data kept", () => {
  const s = JSON.stringify(DEMOS.find((x) => x.slug === "tscdemo"));
  const on = py(`s=json.loads(${JSON.stringify(s)})\nprint(json.dumps(b.demo_payload(s, date(2026,11,28))))`);
  assert.equal(on.demo, true);
  assert.equal(on.pending, true);
  assert.deepEqual(on.totals, { viewable: 0, clicks: 0, ctr: null, legacyImpressions: 0 }, "the ad counts are the not-started 0");
  assert.equal(on.creative.live, false, "the demo ad is never live");
  assert.equal(on.creative.fields.headline, "Your ad here");
  assert.equal(on.creative.fields.body, "Shown only to readers in the states you pick, on the pages they use every week.");
  assert.equal(on.creative.fields.cta_text, "Learn more");
  assert.equal(on.creative.fields.logo, null);
  assert.equal(on.creative.slot, null, "no measurement slot");
  assert.deepEqual(on.creative.links, {});
  assert.ok(!JSON.stringify(on).toLowerCase().includes("tractorsupply.com"));
  assert.equal(on.geo, null);
  assert.equal(on.billing, null);
  assert.ok(on.regionAds.pending && on.regionAds.rows.every((r) => r.viewable === 0 && r.clicks === 0));
  const off = py(`s=json.loads(${JSON.stringify(s)})\nprint(json.dumps(b.demo_payload(s, date(2026,11,29))))`);
  assert.deepEqual(Object.keys(off).sort(), ["demo", "demoEnded", "expires", "schema", "slug"], "after the last day only the stub is left");
  assert.equal(off.demoEnded, true);
  const bad = py(`s=json.loads(${JSON.stringify(s)})\ns['expires']='soon'\nprint(json.dumps(b.demo_payload(s, date(2026,10,29))))`);
  assert.equal(bad.demoEnded, true, "a demo with no valid last day is treated as ended");
  const offFlag = py(`s=json.loads(${JSON.stringify(s)})\ns['active']=False\nprint(json.dumps(b.demo_payload(s, date(2026,10,29))))`);
  assert.equal(offFlag.demoEnded, true, "switched off by hand: ended");
});

test("the shipped demo file matches its entry, and is not listed anywhere", () => {
  for (const s of DEMOS) {
    const f = "data/sponsors/" + s.slug + "-" + s.token + ".json";
    assert.ok(existsSync(join(ROOT, f)), f + " is built");
    const d = JSON.parse(read(f));
    assert.equal(d.demo, true);
    if (!d.demoEnded) {
      assert.equal(d.totals.viewable, 0); assert.equal(d.totals.clicks, 0);
      assert.equal(d.creative.live, false);
      assert.deepEqual(d.regions, [...s.regions].sort());
    }
  }
  assert.match(read("sponsor-report.html"), /name="robots"[^>]*noindex/i);
  const maps = readdirSync(ROOT).filter((f) => /^sitemap.*\.xml$/.test(f));
  for (const m of maps) assert.ok(!read(m).includes("sponsor-report"), m + " lists the portal");
  for (const s of DEMOS) {
    for (const f of ["index.html", "sponsor.html", "about.html", "components/header-fallback.html", "components/footer-fallback.html", "llms.txt"].filter((x) => existsSync(join(ROOT, x))))
      assert.ok(!read(f).includes(s.token), f + " links the demo");
  }
});

function serve(over) {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
  const srv = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (over && over[path]) { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(over[path])); return; }
    let f = normalize(join(ROOT, path));
    if (!existsSync(f) && existsSync(f + ".html")) f += ".html";
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

test("browser: the demo says what it is, shows real readers and zero ad counts, greys the rate card, and ends on the day", { skip, timeout: 180000 }, async () => {
  const s = DEMOS.find((x) => x.slug === "tscdemo");
  const r = s.slug + "-" + s.token;
  const file = JSON.parse(read("data/sponsors/" + r + ".json"));
  const base = "/data/sponsors/" + r + ".json";
  // the page ends on the day by itself too: shown against a file that is still full
  const live = { ...file, expires: "2099-12-31" };
  const srv = await serve({ [base]: live, "/data/sponsors/tscdemo-0000000000000000.json": { ...file, expires: "2026-01-01" },
    "/data/sponsors/tscdemo-1111111111111111.json": { schema: "agsist-sponsor-report/1", slug: "tscdemo", demo: true, demoEnded: true, expires: "2026-11-28" } });
  const port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  const rows = (AUD.states || {})["7d"] || [];
  const want = rows.filter((x) => s.regions.includes(x.code)).reduce((a, x) => a + (x.users || 0), 0);
  try {
    for (const w of [390, 1280]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: 844 }, serviceWorkers: "block" });
      const pg = await ctx.newPage();
      const errs = []; pg.on("pageerror", (e) => errs.push(String(e)));
      const outside = []; await pg.route((u) => u.hostname !== "127.0.0.1", (x) => { outside.push(x.request().url()); x.abort(); });
      await pg.goto(`http://127.0.0.1:${port}/sponsor-report.html?r=${r}`, { waitUntil: "load" });
      await pg.waitForSelector("#results .cp-kpi", { timeout: 8000 });
      const top = (await pg.textContent(".cp-demo")).replace(/\s+/g, " ").trim();
      assert.equal(top, "Demo for Tractor Supply. No ad has run; the audience numbers are AGSIST’s real readers.", w + ": the line at the top");
      assert.equal((await pg.textContent(".cp-hero h1")).trim(), "Tractor Supply (demo)");
      assert.match(await pg.textContent(".cp-hero .cp-pillrow"), /Demo/);
      const k = await pg.$$eval("#results .cp-kpi", (els) => els.map((e) => ({ n: e.querySelector(".cp-kpi-n").textContent.trim(), m: (e.querySelector(".cp-kpi-m") || {}).textContent || "" })));
      assert.deepEqual(k.slice(0, 2).map((x) => x.n), ["0", "0"], w + ": no invented ad counts");
      assert.match(k[0].m, /Starts the day your ad runs/);
      assert.equal(k[3].n, want.toLocaleString("en-US"), w + ": readers in the demo's states are the real 7-day count");
      // the ad: plain text, no logo, no outside link
      const ad = await pg.$eval(".cp-adnow .sa-ad", (e) => ({ t: e.innerText, imgs: e.querySelectorAll("img").length, hrefs: [...e.querySelectorAll("a")].map((a) => a.getAttribute("href")) }));
      assert.match(ad.t, /Your ad here/); assert.match(ad.t, /Shown only to readers in the states you pick, on the pages they use every week\./); assert.match(ad.t, /Learn more/i);
      assert.equal(ad.imgs, 0, "no logo or artwork");
      assert.ok(ad.hrefs.every((h) => !/^https?:/i.test(h)), "no outside link: " + ad.hrefs);
      assert.ok(!(await pg.content()).toLowerCase().includes("tractorsupply.com"));
      assert.equal(await pg.$("[data-sponsor-slot]"), null, "nothing on the page is measured as an ad");
      assert.equal(await pg.$("button.cp-btn[data-mail]"), null, "nothing to approve");
      // billing: the real rate card, every option greyed, labeled not active
      await pg.click("#billing > summary");
      const rc = JSON.parse(read("data/rate-card.json"));
      const bill = await pg.textContent("#billing");
      assert.match(bill, /Not active/i);
      for (const t of rc.tiers) assert.ok(bill.includes("$" + t.price_month), "rate card: " + t.name);
      // Oct 29, 2026: every tier by name, the State Sponsor's state prices, and nothing retired
      for (const t of rc.tiers) assert.ok(bill.includes(t.name), "rate card names: " + t.name);
      for (const [st, p] of Object.entries(rc.tiers.find((t) => t.id === "state").price_by_state)) assert.ok(bill.includes("$" + p) && bill.includes(st), "state price: " + st);
      assert.doesNotMatch(bill, /Own a page|Supporter|[Rr]ate locked/);
      assert.ok(await pg.$("#billing .cp-rc.cp-muted"), "greyed");
      // states table names every demo state
      await pg.click("#area > summary");
      const area = await pg.textContent("#area");
      for (const c of s.regions) assert.ok(area.includes(rows.find((x) => x.code === c)?.name || c), "state shown: " + c);
      assert.equal(await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth) <= 0, true, w + ": no sideways scroll");
      assert.deepEqual(errs, []);
      await ctx.close();
    }
    for (const rr of ["tscdemo-0000000000000000", "tscdemo-1111111111111111"]) {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
      const pg = await ctx.newPage();
      await pg.route((u) => u.hostname !== "127.0.0.1", (x) => x.abort());
      await pg.goto(`http://127.0.0.1:${port}/sponsor-report.html?r=${rr}`, { waitUntil: "load" });
      await pg.waitForSelector(".cp-err", { timeout: 8000 });
      assert.match(await pg.textContent(".cp-err-msg"), /^This demo has ended\. Contact Sig\.$/, rr);
      assert.equal(await pg.$(".cp-kpi"), null, rr + ": no numbers after the end");
      await ctx.close();
    }
  } finally { await browser.close(); srv.close(); }
});
