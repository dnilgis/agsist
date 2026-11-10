/* /usda-calendar opens on the released numbers (Nov 10, 2026). The page was 31 phone screens with the
 * first USDA number 16 screens down. Now: under the H1, one card per graded number (USDA big, the trade
 * average, USDA before, and a bar: dot = USDA, line = trade range, tick = trade average); before a release,
 * or with nothing graded, the same spot shows the next report. Then the next 5 reports, and every long
 * section in a closed fold with its words kept in the page.
 *   node --test test/usda-results-first.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize, extname } from "node:path";
import { PLACES_ROUTE } from "./fixtures/places-mock.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const page = read("usda-calendar.html");
const top = page.slice(page.indexOf("<!-- PRERENDER:cal-top -->"), page.indexOf("<!-- /PRERENDER:cal-top -->"));
const strip = (h) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

/* the grading method and pipeline words belong in the Sources and terms fold, never at the top */
const CURTAIN = /threshold|band\b|within 0\.|graded on|distance from|method|pipeline|formula|survey&rsquo;s low|\bper ?cent\b|%|weight|typed in|scheduled job|bullish|bearish|buy|sell|rally|price will|prices will/i;

function bake(wpi) {
  return execFileSync("python3", ["-c", `
import json, sys
sys.path.insert(0, "scripts")
import prerender_wpi_scorecard as m
w = json.load(sys.stdin)
sys.stdout.write(json.dumps({"mode": m.top_mode(w), "html": m.top_block(w)}))
`], { cwd: ROOT, input: JSON.stringify(wpi), encoding: "utf8" });
}
const iso = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
const row = (key, label, unit, expected, low, high, before, actual, surprise) =>
  ({ key, label, unit, expected, low, high, usda_current: before, actual, surprise, source: "https://www.example-survey.test/nov" });
const GRADED = [
  row("soy_2627", "2026/27 soybean ending stocks", "mil bu", 331, 280, 370, 315, 300, "bullish"),
  row("corn_yield_2627", "2026/27 corn yield", "bu/acre", 180.3, 173.2, 183.1, 181.2, 179.6, "in line"),
  row("corn_2627", "2026/27 corn ending stocks", "bil bu", 1.84, 1.698, 1.969, 1.849, 1.758, "bullish"),
  row("soy_prod_2627", "2026/27 soybean production", "mil bu", 4597, 4552, 4725, 4562, 4574, "in line"),
];
const UP = { report: "December WASDE", date: iso(30), time: "12:00 PM ET", numbers: [],
  withheld: { range: "No pre-report trade survey is on file for this report yet. The survey usually publishes one to two days ahead." },
  to_beat: { report: "November WASDE", date: iso(-1), wasde_no: "WASDE-677", source: "https://www.usda.gov/oce/commodity/wasde",
    rows: [{ key: "corn_yield_2627", label: "2026/27 corn yield", value: 179.6, unit: "bu/acre" }] } };

test("the top block sits right under the H1, before the next reports and every fold", () => {
  const h1 = page.indexOf("<h1"), at = page.indexOf('<section class="ct-wrap" id="latest"');
  assert.ok(h1 > 0 && at > h1, "top block after the H1");
  assert.ok(at < page.indexOf('id="next-reports"') && page.indexOf('id="next-reports"') < page.indexOf('id="all-dates"'));
  const between = page.slice(h1, at);
  assert.ok(!/<details|<table|cal-container/.test(between), "nothing long between the H1 and the numbers");
  assert.match(top, /data-mode="(results|next)"/);
  assert.match(top, /id="latest-h"/);
});

test("every long section is a closed fold and keeps its words in the page", () => {
  for (const id of ["all-dates", "about-reports", "analyst-fold", "bot-fold", "faq-fold"]) {
    const m = page.match(new RegExp(`<details class="fold" id="${id}"[^>]*>`));
    assert.ok(m, id);
    assert.ok(!/\sopen\b/.test(m[0]), id + " ships closed");
  }
  for (const id of ["priced-in", "scorecard"]) {
    const i = page.indexOf(`id="${id}"`), d = page.indexOf("<details", i);
    assert.ok(d > i && d - i < 200, id + ": its body is in a fold");
    assert.ok(!/\sopen\b/.test(page.slice(d, page.indexOf(">", d))), id + " ships closed");
  }
  // nothing deleted: the schedule, the reports guide, the record, the bot and the questions are all still here
  for (const s of ['id="cal-container"', "Prospective Plantings", 'id="wp-history"', 'id="as-board"', 'id="tr-h">Every AGSIST forecast, graded<',
    'id="pb-latest"', "<!--FAQ:START-->", "When is the next USDA crop report?", "<!--BAKE:next-wasde-->", "<!-- ai-answer:crop-report -->"])
    assert.ok(page.includes(s), s);
  assert.match(page, /"@type":\s*"FAQPage"/, "the FAQ structured data stays");
  // a link into a section whose body is folded opens it
  assert.match(page, /querySelector\(':scope>details\.fold'\)/);
});

test("curtain: the top block and the next reports carry numbers and plain lines, no method text", () => {
  assert.doesNotMatch(strip(top), CURTAIN);
  const n5 = page.slice(page.indexOf('id="next-reports"'), page.indexOf('id="all-dates"'));
  assert.doesNotMatch(strip(n5).replace(/data-[a-z-]+="[^"]*"/g, ""), /threshold|graded on|pipeline|formula/i);
  assert.doesNotMatch(top, /—|&mdash;/);
});

test("graded report: one card per number in the set order, the bar, the headline from the data", () => {
  const { mode, html } = JSON.parse(bake({ latest_result: { date: iso(-1), report: "November WASDE", numbers: GRADED }, upcoming: UP }));
  assert.equal(mode, "results");
  const names = [...html.matchAll(/<div class="ct-k">([^<]+)/g)].map((m) => m[1]);
  assert.deepEqual(names, ["Corn yield", "Corn ending stocks", "Soybean ending stocks", "Soybean production"]);
  assert.equal((html.match(/class="ct-dot"/g) || []).length, 4);
  assert.equal((html.match(/class="ct-tick"/g) || []).length, 4);
  assert.match(html, /Tighter than the trade expected: corn and soybean ending stocks came in under the trade average\./);
  assert.match(html, /<b class="ct-big">4,574<\/b>/);
  assert.match(html, /Trade <b>180\.3<\/b> &middot; USDA in October 181\.2/);
  assert.match(html, /11:00 a\.m\. CT/);
  assert.match(html, /Source: USDA WASDE-677/);
  assert.doesNotMatch(html, /href="https:\/\/www\.usda\.gov\/oce/, "no link straight at the USDA data");
  assert.doesNotMatch(strip(html), CURTAIN);
});

test("headline says tighter only when the data does", () => {
  const inl = GRADED.map((r) => ({ ...r, surprise: "in line" }));
  let h = JSON.parse(bake({ latest_result: { date: iso(-1), report: "November WASDE", numbers: inl }, upcoming: UP })).html;
  assert.match(h, /In line with the trade/);
  assert.doesNotMatch(h, /Tighter|Looser/);
  const over = GRADED.map((r) => (r.key === "corn_2627" ? { ...r, actual: 1.95, surprise: "bearish" } : { ...r, surprise: "in line" }));
  h = JSON.parse(bake({ latest_result: { date: iso(-1), report: "November WASDE", numbers: over }, upcoming: UP })).html;
  assert.match(h, /Looser than the trade expected: corn ending stocks came in over the trade average/);
  assert.doesNotMatch(h, /Tighter/);
});

test("no graded row: the spot shows the next report, its date and time, and USDA's numbers to beat", () => {
  const ungraded = GRADED.map((r) => ({ ...r, actual: null, surprise: null }));
  for (const lr of [{ date: iso(-1), report: "November WASDE", numbers: ungraded }, {}, { date: iso(-1), report: "November WASDE", numbers: [] }]) {
    const { mode, html } = JSON.parse(bake({ latest_result: lr, upcoming: UP }));
    assert.equal(mode, "next");
    assert.match(html, /<span class="ct-kick">Next report<\/span>/);
    assert.match(html, /December WASDE/);
    assert.match(html, /11:00 a\.m\. CT &middot; 30 days out/);
    assert.match(html, /No pre-report trade survey is on file/);
    assert.match(html, /<b class="ct-big">179\.6<\/b>/);
    assert.doesNotMatch(html, /class="ct-dot"/, "no USDA dot before USDA prints");
    assert.doesNotMatch(strip(html), CURTAIN);
  }
  // nothing on the board at all
  const none = JSON.parse(bake({ latest_result: {}, upcoming: null })).html;
  assert.match(none, /No USDA report is on the board right now/);
});

test("survey on file for the next report: the next report leads with what the trade expects", () => {
  const up = { ...UP, date: iso(1), numbers: GRADED.map((r) => ({ ...r, actual: null, surprise: null })) };
  const { mode, html } = JSON.parse(bake({ latest_result: { date: iso(-29), report: "November WASDE", numbers: GRADED }, upcoming: up }));
  assert.equal(mode, "next");
  assert.match(html, /tomorrow/);
  assert.match(html, /<b class="ct-big">180\.3<\/b>/);
  assert.match(html, /Trade average &middot; USDA now 181\.2/);
  assert.match(html, /class="ct-tick"/);
  assert.doesNotMatch(html, /class="ct-dot"/);
  assert.match(html, /Last report: November WASDE, .*2 of 4 numbers in line/);
});

/* ---------- browser: the numbers on the first screen, the page short with its folds closed ---------- */
const PW = process.env.PLAYWRIGHT_PATH || "/opt/node-tools/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

test("in Chromium at 390 and 1280 px: numbers within the first screen, under 6 screens with folds closed", { skip }, async () => {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (!extname(p)) p += ".html";
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f) || !statSync(f).isFile()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const width of [390, 1280]) {
      const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width, height: 844 } });
      await ctx.route(PLACES_ROUTE, (q) => q.abort());
      await ctx.route("**/*", (q) => (q.request().url().startsWith(base) ? q.continue() : q.abort()));
      const pg = await ctx.newPage();
      const errors = [];
      pg.on("pageerror", (e) => errors.push(String(e)));
      await pg.goto(`${base}/usda-calendar`, { waitUntil: "load" });
      await pg.waitForFunction(() => document.querySelectorAll("#cal-next5 li").length > 0);
      const m = await pg.evaluate(() => {
        const y = (el) => (el ? el.getBoundingClientRect().top + scrollY : null);
        return { head: y(document.getElementById("latest-h")), big: y(document.querySelector("#latest .ct-big")),
          mode: document.querySelector("#latest .ct")?.dataset.mode, H: document.documentElement.scrollHeight,
          vw: document.documentElement.clientWidth, sw: document.documentElement.scrollWidth,
          open: [...document.querySelectorAll("main details")].filter((d) => d.open).map((d) => d.className + "#" + d.id + ":" + (d.querySelector("summary") || {}).textContent).join(" | "), n5: document.querySelectorAll("#cal-next5 li").length };
      });
      assert.ok(m.mode === "results" || m.mode === "next", `${width}: a top block (${m.mode})`);
      assert.ok(m.head !== null && m.head < 900, `${width}: the headline starts on the first screen (${m.head})`);
      if (m.big !== null) assert.ok(m.big < 900, `${width}: the first number starts under 900 px (${m.big})`);
      else assert.equal(m.mode, "next", "only the next-report card may show no number");
      if (width === 390) assert.ok(m.H < 6 * 844, `390: page with folds closed is under 6 screens (${m.H})`);
      assert.ok(m.sw <= m.vw, `${width}: no sideways scroll (${m.sw} > ${m.vw})`);
      assert.equal(m.open, "", `${width}: every fold ships closed`);
      assert.ok(m.n5 >= 1 && m.n5 <= 5, `${width}: next reports listed (${m.n5})`);
      // a link to a folded section opens it
      await pg.evaluate(() => document.querySelector('.cal-jump a[href="#priced-in"]').click());
      assert.equal(await pg.evaluate(() => document.querySelector("#priced-in > details.fold").open), true, "the priced-in link opens its fold");
      assert.deepEqual(errors, []);
      await ctx.close();
    }
  } finally { await browser.close(); srv.close(); }
});
