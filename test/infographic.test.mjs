/* Infographic of the Week (Nov 7, 2026): the spec builder, the page builder and the three shapes.
 *   1. scripts/build_infographic.py reproduces every number from its source file (the frozen fixtures in
 *      test/fixtures/infographic/data, the Crop Progress week ending Nov 1, 2026 and the COT week to Nov 3, 2026);
 *      the numbers are recomputed here from those files, never typed. It refuses look-ahead and two files that
 *      disagree.
 *   2. scripts/build_infographic_pages.py: the hook is the title and the H1, ImageObject and Dataset JSON-LD,
 *      og:image is the link preview card, links to the related page and the last 4, the archive newest first,
 *      no em dash, under the 150 KB page budget. The pages are a generated set (built on main).
 *   3. In a browser: the phone picture 1080 x 1350 and the link picture 1200 x 630 from the spec, the print sheet
 *      exactly 1 page on Letter and A4, and without share-kit.js the page is whole and the buttons stay hidden.
 *
 *   node --test test/infographic.test.mjs     (INFOG_OUT=<dir> also saves the pictures and the sheet PDF)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const FX = "test/fixtures/infographic";
const fx = (f) => JSON.parse(read(`${FX}/data/${f}`));
const DASH = /[\u2013\u2014]|&mdash;|&ndash;/;
const py = (...a) => spawnSync("python3", a, { cwd: ROOT, encoding: "utf8" });
const spec = (kind, date) => {
  const r = py("scripts/build_infographic.py", kind, date, "--root", FX, "--print");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return JSON.parse(r.stdout);
};
const num = (n) => Math.abs(n).toLocaleString("en-US");
const NAMES = { IA: "Iowa", SD: "South Dakota", MI: "Michigan", NE: "Nebraska", OH: "Ohio" };

// ------------------------------------------------------------------ 1. the spec builder
test("harvest-gap: every number recomputed from the Crop Progress file (week ending Nov 1, 2026)", () => {
  const cp = fx("crop-progress.json"), s = spec("harvest-gap", "2026-11-06");
  const nat = cp.progress.corn_harvested, soy = cp.progress.soybeans_harvested;
  assert.equal(nat.date, "2026-11-01");
  assert.deepEqual([nat.pct, nat.avg5, soy.pct, soy.avg5], [74, 77, 88, 84], "the example: corn 74% vs 77%, soybeans 88% vs 84%");
  // the states with a NASS-printed average, furthest behind first
  for (const [i, crop] of ["corn_harvested", "soybeans_harvested"].entries()) {
    const want = Object.entries(cp.states).filter(([, v]) => v[crop] && v[crop].avg5_by === "NASS" && v[crop].date === "2026-11-01")
      .map(([k, v]) => ({ k, gap: v[crop].pct - v[crop].avg5, values: [v[crop].pct, v[crop].avg5] }));
    const got = s.chart.panels[i].rows;
    assert.equal(got.length, want.length, crop + ": every state with a NASS average, no other");
    for (const r of got) assert.deepEqual(r.values, want.find((w) => w.k === r.key).values, crop + " " + r.key);
    const gaps = got.map((r) => r.values[0] - r.values[1]);
    assert.deepEqual(gaps, [...gaps].sort((a, b) => a - b), "furthest behind first");
  }
  const ia = cp.states.IA.corn_harvested;
  assert.deepEqual([ia.pct, ia.avg5], [66, 79], "the example: Iowa 66% vs 79%");
  const corn = s.chart.panels[0].rows, far = corn.reduce((a, r) => Math.abs(r.values[0] - r.values[1]) > Math.abs(a.values[0] - a.values[1]) ? r : a);
  assert.equal(far.key, "IA");
  assert.equal(s.title, `Iowa corn harvest ${ia.avg5 - ia.pct} points behind its 5-year average`);
  assert.ok(s.title.length <= 60);
  assert.deepEqual(s.big, { value: ia.pct, unit: "%", label: `Iowa corn harvested by Nov 1 (5-year average ${ia.avg5}%)` });
  assert.deepEqual(s.chart.highlight, ["IA"]);
  assert.equal(s.facts[0].text, `U.S. corn harvest: ${nat.pct}% done, ${nat.avg5 - nat.pct} points behind the 5-year average of ${nat.avg5}%.`);
  assert.equal(s.facts[1].text, `U.S. soybean harvest: ${soy.pct}% done, ${soy.pct - soy.avg5} points ahead of the 5-year average of ${soy.avg5}%.`);
  const behind = corn.filter((r) => r.values[0] < r.values[1]).length;
  assert.equal(s.facts[2].text, `${behind} of the ${corn.length} corn states NASS prints an average for are behind it.`);
  for (const f of s.facts) { assert.equal(f.date, "2026-11-01"); assert.equal(f.source, "USDA NASS Crop Progress, week ending Nov 1, 2026"); }
  assert.deepEqual(s.sources.map((x) => x.period), ["Week ending Nov 1, 2026"]);
  assert.equal(s.related_page, "/conditions");
  assert.doesNotMatch(JSON.stringify(s), DASH);
});

test("funds-corn: the net, its run and the long/short split recomputed from the COT files (positions Nov 3, 2026)", () => {
  const h = fx("cot-history.json").history.corn, an = fx("cot-analysis.json"), s = spec("funds-corn", "2026-11-06");
  const last = h[h.length - 1], prev = h[h.length - 2];
  assert.equal(last.date, an.report_date);
  // the run of consecutive weekly cuts ending this week
  let n = 0;
  for (let i = h.length - 1; i > 0 && h[i].net < h[i - 1].net && (Date.parse(h[i].date) - Date.parse(h[i - 1].date)) === 7 * 864e5; i--) n++;
  assert.equal(n, an.commodities.corn.card.streak, "the run agrees with the analysis file's streak");
  const path_ = h.slice(-1 - n);
  assert.deepEqual(s.chart.points.map((p) => [p.x, p.y]), path_.map((r) => [r.date, r.net]));
  const total = last.net - path_[0].net;
  assert.equal(s.title, `Funds' corn net down ${num(total)} contracts in ${n} weeks`);
  assert.ok(s.title.length <= 60);
  assert.deepEqual(s.big, { value: last.net, unit: "contracts net long", label: "Managed money in corn futures, positions Nov 3, 2026" });
  const dl = last.long - prev.long, ds = last.short - prev.short;
  assert.deepEqual([dl, ds], [an.commodities.corn.card.how.long_change, an.commodities.corn.card.how.short_change], "the split agrees with the history rows");
  assert.equal(s.facts[0].text, `This week: net down ${num(last.net - prev.net)} contracts to ${num(last.net)} long.`);
  assert.equal(s.facts[1].text, `Longs \u2212${num(dl)}, shorts +${num(ds)}: ${an.commodities.corn.card.how.label}.`);
  assert.equal(s.facts[2].text, `${n} straight weekly cuts: ${num(path_[0].net)} net long on Sep 15, ${num(last.net)} long on Nov 3.`);
  for (const f of s.facts) { assert.equal(f.date, last.date); assert.match(f.source, /^CFTC Commitments of Traders, Disaggregated Futures-Only, positions Nov 3, 2026, released Nov 6, 2026$/); }
  assert.deepEqual(s.chart.split, { long_change: dl, short_change: ds, label: an.commodities.corn.card.how.label });
  assert.equal(s.related_page, "/cot");
});

test("the spec builder refuses look-ahead, old news and two files that disagree", () => {
  for (const [kind, date, why] of [["harvest-gap", "2026-11-01", /published 2026-11-02, after/], ["funds-corn", "2026-11-05", /published 2026-11-06, after/],
    ["harvest-gap", "2026-11-30", /more than 14 days/]]) {
    const r = py("scripts/build_infographic.py", kind, date, "--root", FX, "--print");
    assert.equal(r.status, 1, kind + " " + date);
    assert.match(r.stdout, why);
  }
  const d = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "igfx-"));
  fs.mkdirSync(path.join(d, "data"));
  for (const f of ["cot-history.json", "cot-analysis.json"]) fs.copyFileSync(path.join(ROOT, FX, "data", f), path.join(d, "data", f));
  const an = fx("cot-analysis.json"); an.commodities.corn.card.how.short_change += 1;
  fs.writeFileSync(path.join(d, "data", "cot-analysis.json"), JSON.stringify(an));
  const r = py("scripts/build_infographic.py", "funds-corn", "2026-11-06", "--root", d, "--print");
  assert.equal(r.status, 1); assert.match(r.stdout, /disagrees with cot-history/);
  fs.rmSync(d, { recursive: true, force: true });
  assert.equal(py("scripts/build_infographic.py", "--selftest").status, 0);
  assert.equal(py("scripts/build_infographic_pages.py", "--selftest").status, 0);
});

// ------------------------------------------------------------------ 2. the pages
const TMP = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "infog-"));
process.on("exit", () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {} });
fs.mkdirSync(path.join(TMP, "data/infographics"), { recursive: true });
fs.copyFileSync(path.join(ROOT, "cot.html"), path.join(TMP, "cot.html"));
const DATES = { "2026-11-06": "harvest-gap", "2026-10-30": "funds-corn" };
execFileSync("python3", ["scripts/build_infographic.py", "harvest-gap", "2026-11-06", "--root", FX, "--out", path.join(TMP, "data/infographics")], { cwd: ROOT });
// an older funds spec for the "last 4" links: the same week's files cannot make a Nov 6 funds spec dated Oct 30, so
// it is the Nov 6 spec saved under Oct 30's name with its date changed (a layout fixture, not a number check)
const older = spec("funds-corn", "2026-11-06");
older.date = older.slug = "2026-10-30";
older.facts = older.facts.map((f) => ({ ...f, date: "2026-10-27" }));
fs.writeFileSync(path.join(TMP, "data/infographics/2026-10-30.json"), JSON.stringify(older));
execFileSync("python3", ["scripts/build_infographic_pages.py", "--root", TMP, "--out", path.join(TMP, "infographic")], { cwd: ROOT });
const page = (d) => fs.readFileSync(path.join(TMP, "infographic", d + ".html"), "utf8");

test("the infographic page: hook as title and H1, JSON-LD, og:image the card, the facts with sources, related and recent links", () => {
  const s = JSON.parse(fs.readFileSync(path.join(TMP, "data/infographics/2026-11-06.json"), "utf8"));
  const h = page("2026-11-06");
  assert.ok(h.includes(`<title>${s.title} | AGSIST</title>`));
  assert.equal((h.match(/<h1[ >]/g) || []).length, 1);
  assert.ok(h.includes(`<h1>${s.title}</h1>`));
  assert.match(h, /<link rel="canonical" href="https:\/\/agsist\.com\/infographic\/2026-11-06">/);
  const og = h.match(/<meta property="og:image" content="([^"]+)">/)[1];
  assert.match(og, /^https:\/\/agsist\.com\/infographic\/og\/2026-11-06\.jpg\?v=[0-9a-f]{8}$/);
  assert.ok(fs.statSync(path.join(TMP, "infographic/og/2026-11-06.jpg")).size < 120 * 1024, "the card under 120 KB");
  const lds = [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const types = lds.map((j) => j["@type"]);
  assert.deepEqual(types, ["ImageObject", "Dataset", "BreadcrumbList"]);
  assert.equal(lds[0].contentUrl, og.split("?")[0]);
  assert.equal(lds[1].distribution[0].contentUrl, "https://agsist.com/data/infographics/2026-11-06.json");
  for (const f of s.facts) assert.ok(h.includes(f.text.replace(/'/g, "&#x27;")), f.text);
  assert.ok(h.includes("USDA NASS Crop Progress, week ending Nov 1, 2026, Nov 1, 2026."), "each fact's source and date");
  assert.match(h, /<details><summary>Sources<\/summary>/, "sources collapsed by default");
  assert.ok(!/<a [^>]*href="https?:\/\/(www\.)?(nass|cftc)/.test(h), "sources in plain text, no link to a data source");
  assert.ok(h.includes('href="/conditions"'), "the related page");
  assert.ok(h.includes('href="/infographic/2026-10-30"') && h.includes('href="/infographic/"'), "the recent ones and the archive");
  const inl = JSON.parse(h.match(/<script type="application\/json" id="ig-spec">([\s\S]*?)<\/script>/)[1]);
  assert.deepEqual(inl, s, "the page carries the spec as it is");
  assert.match(h, /<script src="\/components\/share-kit\.js\?v=\d+" defer><\/script>\s*<script src="\/components\/qr\.js\?v=\d+" defer><\/script>\s*<script src="\/components\/infographic\.js\?v=1" defer><\/script>/);
  assert.match(h, /<div class="ig-tools" id="ig-tools" hidden>/, "the buttons hidden until the kit is there");
  const v = (n) => (read("cot.html").match(new RegExp(`/components/${n.replace(".", "\\.")}\\?v=(\\w+)`)) || [])[1];
  for (const n of ["styles.css", "share-kit.js", "qr.js", "loader.js"]) assert.ok(h.includes(`/components/${n}?v=${v(n)}`), n + " at the version cot.html loads");
  for (const d of Object.keys(DATES)) {
    const p = page(d);
    assert.doesNotMatch(p, DASH, d);
    assert.ok(Buffer.byteLength(p) < 150 * 1024, d + " under the 150 KB page budget");
    assert.doesNotMatch(p.match(/<main[\s\S]*?<\/main>/)[0], /\b(should|recommend|forecast|will rise|will fall)\b/i, "no advice or forecast");
  }
});

test("the archive: newest first, indexable once there is one; empty, it says so and is noindex", () => {
  const a = fs.readFileSync(path.join(TMP, "infographic/index.html"), "utf8");
  const order = [...a.matchAll(/<li><a href="\/infographic\/(\d{4}-\d{2}-\d{2})">/g)].map((m) => m[1]);
  assert.deepEqual(order, ["2026-11-06", "2026-10-30"]);
  assert.match(a, /<meta name="robots" content="index,follow">/);
  assert.equal(fs.readFileSync(path.join(TMP, "infographic/_indexable.txt"), "utf8"), "/infographic/2026-11-06\n/infographic/2026-10-30\n/infographic/\n");
  const e = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "infog0-"));
  execFileSync("python3", ["scripts/build_infographic_pages.py", "--root", e, "--out", path.join(e, "infographic"), "--no-images"], { cwd: ROOT });
  const z = fs.readFileSync(path.join(e, "infographic/index.html"), "utf8");
  assert.match(z, /No infographic is posted yet\./);
  assert.match(z, /<meta name="robots" content="noindex,follow">/);
  fs.rmSync(e, { recursive: true, force: true });
});

test("a generated set: built on main by infographic-pages.yml, the stylesheet written by hand, no Daily or homepage wiring yet", () => {
  const r = py("-c", "import sys; sys.path.insert(0, 'scripts'); import generated_sets as G, json; print(json.dumps([G.owner(p) for p in "
    + "['infographic/2026-11-06.html', 'infographic/index.html', 'infographic/og/2026-11-06.jpg', 'infographic/infographic.css', 'data/infographics/2026-11-06.json']]))");
  assert.deepEqual(JSON.parse(r.stdout), ["infographic", "infographic", "infographic", null, null]);
  const wf = read(".github/workflows/infographic-pages.yml");
  assert.doesNotMatch(wf, /\n  schedule:/, "no schedule");
  assert.match(wf, /data\/infographics\/\*\*/, "a new spec on main rebuilds the pages");
  assert.ok(!fs.existsSync(path.join(ROOT, "data/infographics/latest.json")), "the weekend Daily slot reads latest.json: not written yet");
  assert.doesNotMatch(read("scripts/build_infographic.py") + read("scripts/build_infographic_pages.py"), /latest\.json/);
  assert.doesNotMatch(read("index.html"), /\/infographic\//, "not on the homepage yet");
  for (const f of ["components/infographic.js", "infographic/infographic.css", "scripts/build_infographic.py", "scripts/build_infographic_pages.py"]) assert.doesNotMatch(read(f), DASH, f);
});

// ------------------------------------------------------------------ 3. in a browser
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (fs.existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !fs.existsSync(CHROME) ? "Playwright or Chromium not found here" : false;
function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".woff2": "font/woff2" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (!path.extname(p)) p += ".html";
    const own = /^\/infographic\/(\d{4}-\d{2}-\d{2}\.html|og\/.*|index\.html)$/.test(p) ? TMP : ROOT;
    const f = path.normalize(path.join(own, p));
    if (!f.startsWith(own) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" });
    res.end(fs.readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}
const pages = (buf) => (buf.toString("latin1").match(/\/Type\s*\/Page(?![a-z])/g) || []).length;
async function open(browser, port, url, block) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1200, height: 900 } });
  const pg = await ctx.newPage();
  const errors = [];
  pg.on("pageerror", (e) => errors.push(String(e)));
  await pg.route("**/*", (r) => {
    const u = new URL(r.request().url());
    if (u.origin !== `http://127.0.0.1:${port}`) return r.abort();
    if (block && block.test(u.pathname)) return r.abort();
    return r.continue();
  });
  await pg.goto(`http://127.0.0.1:${port}${url}`, { waitUntil: "load" });
  return { ctx, pg, errors };
}

test("in a browser: the phone and link pictures from the spec, the print sheet on 1 page (Letter and A4)", { skip, timeout: 180000 }, async () => {
  const srv = await serve(), port = srv.address().port, OUTD = process.env.INFOG_OUT;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const d of Object.keys(DATES)) {
      const { ctx, pg, errors } = await open(browser, port, "/infographic/" + d);
      await pg.waitForFunction(() => window.AgInfographic && !document.getElementById("ig-tools").hidden);
      const s = JSON.parse(fs.readFileSync(path.join(TMP, "data/infographics", d + ".json"), "utf8"));
      for (const shape of ["phone", "link"]) {
        const r = await pg.evaluate(async (shape) => {
          await document.fonts.ready;
          const spec = JSON.parse(document.getElementById("ig-spec").textContent);
          const m = shape === "phone" ? window.AgQR.matrix(window.AgInfographic.tagged(spec, "share", "qr"), null, null, 10) : null;
          const im = window.AgInfographic.picture(spec, document, shape, { qr: m });
          return { w: im.canvas.width, h: im.canvas.height, texts: im.texts, sizes: im.sizes, png: im.canvas.toDataURL("image/png") };
        }, shape);
        assert.deepEqual([r.w, r.h], shape === "phone" ? [1080, 1350] : [1200, 630], d + " " + shape);
        const all = r.texts.join(" ");
        assert.ok(all.includes(s.title.split(" ").slice(0, 3).join(" ")), d + " " + shape + ": the hook");
        assert.ok(r.texts.includes(s.big.value.toLocaleString("en-US")), d + " " + shape + ": the big number " + r.texts.join(" | "));
        assert.ok(all.includes(s.sources[0].name), "the source on the picture");
        assert.ok(Math.min(...r.sizes) >= 16, "no word under 16 px");
        if (shape === "phone") for (const f of s.facts) assert.ok(all.includes(f.text.split(" ").slice(0, 3).join(" ")), "fact on the phone picture: " + f.text);
        assert.doesNotMatch(all, DASH);
        if (OUTD) fs.writeFileSync(path.join(OUTD, `${d}-${shape}.png`), Buffer.from(r.png.split(",")[1], "base64"));
      }
      await pg.evaluate(() => { window.print = () => {}; });
      await pg.click("#ig-print");
      assert.ok(await pg.evaluate(() => document.documentElement.classList.contains("igs-on")), "Print sets the sheet on");
      const sh = await pg.evaluate(() => ({ fit: document.getElementById("igs").dataset.fit, qr: !!document.querySelector("#igs .igs-qr svg"),
        text: document.getElementById("igs").textContent }));
      assert.equal(sh.fit, "1", d + ": the sheet fits without scaling");
      assert.ok(sh.qr, "a QR code on the sheet");
      for (const f of s.facts) assert.ok(sh.text.includes(f.text), "fact on the sheet");
      assert.doesNotMatch(sh.text, DASH);
      for (const format of ["Letter", "A4"]) {
        await pg.evaluate(() => document.documentElement.classList.add("igs-on", "sk-on"));
        const buf = await pg.pdf({ format });
        assert.equal(pages(buf), 1, d + " " + format + ": exactly 1 page");
        if (OUTD && format === "Letter") fs.writeFileSync(path.join(OUTD, d + "-sheet.pdf"), buf);
      }
      assert.deepEqual(errors, []);
      await ctx.close();
    }
    // fails soft: no share kit, the page is whole and the buttons stay hidden
    const { ctx, pg, errors } = await open(browser, port, "/infographic/2026-11-06", /share-kit\.js$/);
    await pg.waitForTimeout(300);
    assert.equal(await pg.$eval("#ig-tools", (e) => e.hidden), true);
    assert.ok((await pg.$eval("main", (e) => e.textContent)).includes("Iowa corn harvest 13 points behind"));
    assert.deepEqual(errors, []);
    await ctx.close();
  } finally { await browser.close(); srv.close(); }
});
