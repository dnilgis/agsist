/* /custom-rates and /custom-rates/<state> (scripts/build_custom_rates.py,
 * components/custom-rates.js).
 *
 * Every number checked here was read off the survey saved on the references
 * branch (refs/<id>.txt): Iowa A3-10 2026 page 3, Kansas Custom Rates 2026
 * page 6, Purdue's 2025 Indiana rates page 3 (printed in cents), Nebraska
 * EC823 2026 State Summary. Browser checks need Playwright and skip without it.
 *
 *   node --test test/custom-rates.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { extname, join, normalize } from "node:path";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const page = read("custom-rates.html");
const js = read("components/custom-rates.js");
const css = read("components/custom-rates.css");
const idx = JSON.parse(read("data/custom-rates/index.json"));
const doc = (st) => JSON.parse(read(`data/custom-rates/${st}.json`));
const row = (d, o, u) => d.rows.find((r) => r.o === o && (!u || r.u === u));

test("build is current and its selftest passes", () => {
  execFileSync("python3", ["scripts/build_custom_rates.py", "--check"], { cwd: ROOT, stdio: "pipe" });
  const out = execFileSync("python3", ["scripts/build_custom_rates.py", "--selftest"], { cwd: ROOT }).toString();
  assert.match(out, /selftest: 0 failed/);
});

test("every row's numbers sit together on one line of the saved survey (when the references branch is here)", (t) => {
  const has = spawnSync("git", ["-C", ROOT, "cat-file", "-e", "origin/references:index.json"]).status === 0;
  if (!has) return t.skip("origin/references not fetched");
  const r = spawnSync("python3", ["scripts/build_custom_rates.py", "--verify-refs"], { cwd: ROOT });
  assert.equal(r.status, 0, r.stdout.toString().slice(-2000));
  assert.match(r.stdout.toString(), /MO: skipped, numbers-only source/, "the skip is said out loud");
});

test("hand-checked numbers from the surveys", () => {
  const ia = doc("ia");
  assert.equal(ia.survey_year, 2026);
  assert.deepEqual((({ a, lo, hi, n }) => ({ a, lo, hi, n }))(row(ia, "Corn combining")), { a: 46.05, lo: 25, hi: 80, n: 119 });
  assert.deepEqual((({ a, lo, hi, n }) => ({ a, lo, hi, n }))(row(ia, "Soybean combining")), { a: 43.05, lo: 24, hi: 70, n: 94 });
  assert.equal(ia.spread, "trimmed", "A3-10's range leaves out the lowest and highest answer");
  const ks = doc("ks");
  const kc = row(ks, "Corn, flat rate", "acre");
  assert.deepEqual([kc.a, kc.lo, kc.hi, kc.n], [41.87, 18, 58, 82]);
  // Purdue prints hauling in cents: 18.8 cents a bushel, band 12.6 to 25.1 -> dollars
  const ih = doc("in").rows.find((r) => r.k === "haul-grain-bu");
  assert.deepEqual([ih.a, ih.lo, ih.hi, ih.n, ih.p], [0.188, 0.126, 0.251, 47, "cents"]);
  assert.equal(doc("in").spread, "sd");
  // Nebraska's summary repeats the CRP mowing numbers on its dryland corn contract row; withheld, never copied
  const ne = doc("ne");
  assert.ok(!ne.rows.some((r) => r.s === "Custom contract farming" && /corn/i.test(r.o)), "suspect row left out");
  assert.match(ne.withheld, /left out/);
  // Oklahoma prints no range, so none is shown
  assert.ok(doc("ok").rows.every((r) => r.lo == null && r.hi == null));
});

test("Missouri is G302 revised March 2026: 2025 rates, average, median, range and count as printed", () => {
  const mo = doc("mo");
  assert.equal(mo.rate_year, 2025);
  assert.equal(mo.survey_year, 2026);
  assert.equal(mo.sources[0].url, "https://extension.missouri.edu/publications/g302");
  // MU does not allow reposting G302: numbers and a link only, no stored copy (Sig, Oct 19)
  assert.deepEqual(mo.sources, [{ url: "https://extension.missouri.edu/publications/g302", numbers_only: true, published: "2026-03" }]);
  assert.match(mo.collected, /^2025 rates \(survey fall 2025 to winter 2026, published March 2026\)/);
  const pick = (o, u) => { const r = row(mo, o, u); return [r.a, r.md, r.lo, r.hi, r.n]; };
  // read off the guide (Tables 3, 4, 5 and 7)
  assert.deepEqual(pick("Corn, combine without grain cart"), [47.56, 40, 35, 95, 9]);
  assert.deepEqual(pick("Corn, combine with grain cart"), [47.95, 50, 35, 60, 22]);
  assert.deepEqual(pick("Soybean, combine without grain cart"), [42.33, 40, 35, 60, 9]);
  assert.deepEqual(mo.rows.filter((r) => r.k === "plant-notill").map((r) => [r.s, r.a, r.md, r.lo, r.hi, r.n]), [["Planting, no-till", 26.65, 26, 15, 35, 23]]);
  assert.deepEqual(pick("Spray with row crop sprayer"), [9.42, 9.43, 4, 12, 20]);
  assert.deepEqual(pick("Round bale with net wrap, over 1,000 pound bales"), [18.87, 20, 10, 35, 15]);
  assert.deepEqual(pick("Cut, rake and bale small square bales", "percent of crop"), [58, 60, 20, 75, 9]);
  const keyed = Object.fromEntries(mo.rows.filter((r) => r.k).map((r) => [r.k, r.o]));
  assert.equal(keyed["combine-corn"], "Corn, combine without grain cart", "combine only, like the other states' combine-corn");
  assert.equal(keyed["spray-ground"], "Spray with row crop sprayer");
  assert.ok(!keyed["spray-tractor"] && !keyed["backhoe"] && !keyed["spray-aerial"], "jobs the 2026 guide does not price the same way stay out of the comparison");
  // Table 9: the guide's anecdotal medians, only a median and labeled as such
  const t9 = mo.rows.filter((r) => r.p === "median-only");
  assert.equal(t9.length, 12);
  assert.deepEqual(t9.map((r) => [r.o, r.md, r.u]).slice(0, 2), [["Applying chemicals with selective targeting (Greeneye)", 14, "acre"], ["Aerial spray application over cropland", 13, "acre"]]);
  assert.ok(t9.every((r) => r.s === "Anecdotal medians, few answers"));
  const h = read("custom-rates/missouri.html");
  assert.match(h, /<td class="av"><span class="na">no average printed<\/span><span class="mdn">median \$13\.00 per acre, few answers<\/span><\/td><td class="rg">not printed<\/td>/);
  assert.match(h, /\$47\.56 <small>per acre<\/small><span class="mdn">median \$40\.00<\/span>/);
  assert.match(h, /58% <small>of the crop<\/small>/);
  assert.match(h, /average, median and lowest to highest answer/);
  assert.doesNotMatch(h, /2022|\$43\.29/, "nothing left from the April 2023 guide");
});

test("every state file is sane and the index matches", () => {
  const files = readdirSync(join(ROOT, "data/custom-rates")).filter((f) => f !== "index.json");
  assert.deepEqual(files.map((f) => f.slice(0, 2).toUpperCase()).sort(), idx.states.map((s) => s.st).sort());
  for (const s of idx.states) {
    const d = doc(s.st.toLowerCase());
    assert.equal(d.survey_year, s.year);
    assert.ok(d.sources[0].url.startsWith("https://"), s.st);
    for (const r of d.rows) {
      if (r.p === "median-only") {
        // the survey printed only a median (Missouri G302 Table 9): nothing else is made up, and it never enters the comparison
        assert.ok(r.md > 0 && r.a == null && r.n == null && r.lo == null && r.hi == null && !r.k, `${s.st} ${r.o} median only`);
        continue;
      }
      assert.ok(r.a > 0 && Number.isInteger(r.n) && r.n > 0, `${s.st} ${r.o}`);
      if (r.lo != null) assert.ok(r.lo <= r.a && r.a <= r.hi, `${s.st} ${r.o} average inside its range`);
      if (r.md != null && r.lo != null) assert.ok(r.lo <= r.md && r.md <= r.hi, `${s.st} ${r.o} median inside its range`);
    }
    for (const nb of s.neighbors) assert.ok(idx.borders[s.st].includes(nb) && idx.states.some((x) => x.st === nb));
  }
  // the comparison only ever holds numbers that are in a state file
  for (const [k, by] of Object.entries(idx.common)) {
    for (const [st, v] of Object.entries(by)) {
      const r = doc(st.toLowerCase()).rows.find((x) => x.k === k);
      assert.deepEqual([r.a, r.u, r.n], [v[0], v[1], v[4]], `${k} ${st}`);
    }
  }
});

test("page structure, plain words, no em dashes", () => {
  assert.match(page, /<link rel="canonical"\s+href="https:\/\/agsist.com\/custom-rates">/);
  assert.match(page, /<h1>Custom farm rates by state/);
  assert.match(page, /Sigurd Lindquist, CCA/);
  assert.match(page, /Rates are survey averages; your local custom operator may charge more or less\./);
  const ld = JSON.parse(page.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  const faq = ld["@graph"].find((x) => x["@type"] === "FAQPage");
  assert.ok(faq.mainEntity.length >= 5);
  assert.ok(faq.mainEntity.some((q) => /Nobody sets them/.test(q.acceptedAnswer.text)), "never implies AGSIST set the rates");
  assert.equal(ld["@graph"].find((x) => x["@type"] === "WebApplication").author.jobTitle, "Certified Crop Adviser (CCA)");
  for (const [n, s] of [["page", page], ["js", js], ["css", css]]) assert.ok(!s.includes("—"), `${n}: em dash`);
  for (const s of idx.states) {
    const h = read(`custom-rates/${s.slug}.html`);
    assert.ok(!h.includes("—"), `${s.slug}: em dash`);
    assert.ok(Buffer.byteLength(h) < 60 * 1024, `${s.slug} under 60 KB`);
    assert.match(h, /may charge more or less/);
    assert.ok(h.includes(s.url.replace(/&/g, "&amp;")), `${s.slug} links its survey`);
    JSON.parse(h.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  }
  // in the menu, footer and the tools hub
  for (const f of ["components/header.html", "components/footer.html", "components/header-fallback.html", "components/footer-fallback.html", "tools.html"]) {
    assert.match(read(f), /href="\/custom-rates"/, f);
  }
});

test("honest empty and failure states", () => {
  assert.match(js, /did not load/);
  assert.match(js, /No ' \+ esc\(d\.name\) \+ ' job matches/);
  assert.match(js, /No bordering state has a survey on this page yet/);
  assert.match(js, /not in survey/);
});

test("search finds jobs by the words farmers use", () => {
  const ctx = { window: {}, document: { readyState: "loading", addEventListener() {} }, URLSearchParams, location: { search: "" } };
  vm.runInNewContext(js, ctx);
  const { matches, money } = ctx.window.AgCustomRates;
  assert.ok(matches("combine soybeans", "Harvesting Soybean combining acre combine soybeans"));
  assert.ok(matches("combine beans", "Harvesting Soybean combining acre"));
  assert.ok(matches("harvest corn", "Harvesting Corn combining acre"));
  assert.ok(matches("nh3", "Fertilizer Anhydrous, injecting, with tool bar acre"));
  assert.ok(matches("wheat", "Harvest Small grain combining acre"));
  assert.ok(!matches("combine soybeans", "Harvesting Corn combining acre"));
  assert.ok(matches("", "anything"));
  assert.equal(money(46.05, "acre"), "$46.05");
  assert.equal(money(0.135, "bushel"), "$0.135");
  assert.equal(money(0.2, "bushel"), "$0.20");
  assert.equal(money(58, "percent of crop"), "58%");
});

// the PR checks set PLAYWRIGHT_PATH and CHROMIUM_PATH (pr-checks.yml); the session paths otherwise
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
test("browser: saved location picks the state, only that state's file loads, no sideways scroll at 390 and 1280", async (t) => {
  if (!existsSync(PW) || !existsSync(CHROME)) return t.skip("no Playwright");
  const { chromium } = await import(PW);
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(req.url.split("?")[0]);
    if (p.endsWith("/")) p += "index.html";
    let f = normalize(join(ROOT, p));
    if ((!existsSync(f) || statSync(f).isDirectory()) && existsSync(f + ".html")) f += ".html";
    if (!f.startsWith(ROOT) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const b = await chromium.launch({ executablePath: CHROME });
  try {
    for (const w of [390, 1280]) {
      const ctx = await b.newContext({ viewport: { width: w, height: 900 } });
      await ctx.addInitScript(() => { try { localStorage.setItem("agsist-wx-loc", JSON.stringify({ state: "NE" })); } catch (e) {} });
      const p = await ctx.newPage();
      const got = [];
      p.on("request", (r) => { const m = r.url().match(/data\/custom-rates\/([a-z]+)\.json/); if (m) got.push(m[1]); });
      await p.goto(base + "/custom-rates", { waitUntil: "networkidle" });
      await p.waitForSelector("#cr-body tr");
      assert.equal(await p.inputValue("#cr-st"), "NE");
      assert.deepEqual(got.sort(), ["index", "ne"], "loads the index and the chosen state only");
      const [sw, cw] = await p.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
      assert.ok(sw <= cw, `no sideways scroll at ${w}: ${sw} > ${cw}`);
      await p.fill("#cr-q", "combine soybeans");
      await p.waitForTimeout(300);
      assert.match(await p.textContent("#cr-body"), /Combining soybeans, flat rate/);
      assert.match(await p.textContent("#cr-cmp"), /Iowa|Kansas|Missouri/);
      await p.fill("#cr-q", "zzzz");
      await p.waitForTimeout(300);
      assert.match(await p.textContent("#cr-body"), /No Nebraska job matches/);
      const sp = await ctx.newPage();
      await sp.goto(base + "/custom-rates/iowa", { waitUntil: "networkidle" });
      const [sw2, cw2] = await sp.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
      assert.ok(sw2 <= cw2, `state page no sideways scroll at ${w}`);
      // Missouri: medians and the median-only rows fit, in the app and on its page
      for (const u of ["/custom-rates?st=MO", "/custom-rates/missouri"]) {
        const mp = await ctx.newPage();
        await mp.goto(base + u, { waitUntil: "networkidle" });
        if (u.includes("?")) {
          await mp.waitForSelector("#cr-body tr");
          const body = await mp.textContent("#cr-body");
          assert.match(body, /no average printed/);
          assert.match(body, /median \$40\.00/);
          assert.match(await mp.textContent("#cr-cap"), /average, median and lowest to highest answer/);
        }
        const [sw3, cw3] = await mp.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
        assert.ok(sw3 <= cw3, `${u} no sideways scroll at ${w}: ${sw3} > ${cw3}`);
        await mp.close();
      }
      await ctx.close();
    }
  } finally {
    await b.close();
    srv.close();
  }
});
