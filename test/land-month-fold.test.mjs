/* Farm sale pages, Nov 8, 2026 (three phone screenshots of /land-sales/2026-09: text crossed out, a table cut off):
 * the method text stays in the page's HTML, short and plain, inside ONE closed "Sources and terms" fold at the bottom;
 * no deed-code number lists anywhere; the Unusual prices section is a heading, one short line and the table, with its
 * definition in the fold; the source credit stays where the sales show; and at 390 px no table is cut off and no element
 * is wider than the screen. Built from the synthetic fixture site (test/fixtures/land-fl/make_site.py) into a temp folder.
 *
 *   node --test test/land-month-fold.test.mjs      (the 390 px test needs PLAYWRIGHT_PATH and CHROMIUM_PATH, else it skips)
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PLACES_ROUTE } from "./fixtures/places-mock.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (fs.existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !fs.existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

const pyOut = (code) => {
  const r = spawnSync("python3", ["-c", code, path.join(ROOT, "scripts")], { encoding: "utf8", cwd: ROOT });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout.trim().split("\n").pop());
};
const T = pyOut(["import json,sys", "sys.path.insert(0,sys.argv[1])", "import build_land_sales as B",
  "print(json.dumps({'notes':{k:v for k,v in B.STATE_NOTES},'names':B.NAMES_NOTE}))"].join("\n"));

let DIR = null;
function site() {
  if (DIR) return DIR;
  DIR = fs.mkdtempSync(path.join(os.tmpdir(), "lsfold-"));
  const r = spawnSync("python3", [path.join(ROOT, "test/fixtures/land-fl/make_site.py"), DIR], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return DIR;
}
after(() => { if (DIR) fs.rmSync(DIR, { recursive: true, force: true }); });
const rd = (p) => fs.readFileSync(path.join(site(), p), "utf8");
const monthFile = () => "land-sales/" + fs.readdirSync(path.join(site(), "land-sales")).find((f) => /^\d{4}-\d{2}\.html$/.test(f));
const ent = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
const main = (h) => h.slice(h.indexOf("<main"));
const text = (h) => h.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ");
const fold = (h) => {
  const opens = [...h.matchAll(/<details\b[^>]*id="how-counted"[^>]*>/g)];
  assert.equal(opens.length, 1, "one Sources and terms fold");
  assert.doesNotMatch(opens[0][0], /\bopen\b/, "closed on load");
  const a = opens[0].index;
  return { a, body: h.slice(a, h.indexOf("</details>", a)) };
};

test("each state's note is plain: no code numbers, no lists of numbered deed types, two or three sentences", () => {
  for (const [st, note] of Object.entries(T.notes)) {
    assert.doesNotMatch(note, /\(\d+\)/, `${st}: no numbered code in brackets`);
    assert.doesNotMatch(note, /\b(codes?|forms?) ?\d|\b\d+ to \d+\b|\b\d{2}, \d{2}\b|\b3[AB]\b/, `${st}: no code numbers`);
    assert.ok(note.length < 700, `${st}: short (${note.length})`);
    assert.match(note, /Left out:/, `${st}: says what kinds of deeds are left out`);
    assert.match(note, /A farm sale is/, `${st}: says what counts as a farm sale`);
    assert.ok((note.match(/\. /g) || []).length <= 4, `${st}: a few sentences`);
  }
});

test("the monthly page: method, names, dates and the unusual definition sit inside the one closed fold at the bottom", () => {
  const p = monthFile(), h = main(rd(p)), { a, body } = fold(h);
  assert.ok(body.includes("<summary>Sources and terms</summary>"));
  assert.ok(a > h.indexOf('<h2 id="value">') && a > h.indexOf('<h2 id="coverage">'), "after the tables and the coverage");
  assert.ok(body.includes(ent(T.notes.FL)) && body.includes(ent(T.notes.WI)), "the Florida and Wisconsin notes are in the HTML, in the fold");
  assert.equal(h.split(ent(T.notes.FL)).length, 2, "Florida's note once");
  assert.ok(body.includes(ent(T.names.slice(0, 60))), "the names line is in the fold");
  assert.match(body, /Florida sales carry no buyer or seller names/, "the no-names line is folded");
  assert.doesNotMatch(h.slice(0, a), /Remove my name/, "no names text outside the fold");
  const top = h.slice(h.indexOf("<h1>"), h.indexOf('<h2 id="buyers">'));
  assert.doesNotMatch(top, /ls-fine/, "nothing but the answer between the title and the first table");
  assert.match(top, /class="ls-ans">\d+ farm sales of \d+ acres or more were recorded in /, "the lead line stays");
  assert.match(h.slice(0, a), /<p class="ls-fine">Source: [^<]*Department of Revenue/, "the credit stays where the sales show");
  assert.doesNotMatch(text(h), /\(\d{1,2}\)|\bcodes? \d/, "no code-number lists on the page");
  assert.doesNotMatch(h, /[–—]/, "no dash");
});

test("Unusual prices: the heading, one short line and the table; the definition is one plain sentence in the fold", () => {
  const h = main(rd(monthFile())), { a, body } = fold(h);
  const i = h.indexOf('<h2 id="unusual">');
  assert.ok(i > 0);
  const sec = h.slice(i, h.indexOf('<h2 id="value">'));
  if (/<table/.test(sec) || /<p>Sales of \d+ acres or more priced far/.test(sec)) {
    assert.match(sec, /^<h2 id="unusual">Unusual prices<\/h2>\s*<p>Sales of \d+ acres or more priced far from the county's usual\. \d+ of \d+ sales that could be compared this month\.<\/p>/);
    assert.ok(i < a);
    assert.doesNotMatch(sec, /middle-half|middle half|one and a half/, "no definition by the table");
    const m = /<h3 class="ls-dh">Unusual prices<\/h3><p class="ls-fine">([^<]*)<\/p>/.exec(body);
    assert.ok(m, "the definition is in the fold");
    assert.match(m[1], /^A sale of \d+ acres or more is marked unusual when its price per acre is far above or below the usual for its county, [^.]*\. /);
    assert.match(m[1], /Possible reasons above the usual: [^.]*\. Possible reasons below: [^.]*\./, "the reasons are folded too");
    assert.ok((m[1].match(/\. /g) || []).length <= 3, "a few plain sentences");
    assert.doesNotMatch(sec, /ls-why|Possible reasons/, "the reasons are not by the table");
  }
  const vi = h.indexOf('<h2 id="value">');
  const intro = /<h2 id="value">Best value per acre<\/h2>\s*<p>([^<]*)<\/p>/.exec(h.slice(vi));
  if (intro && /^Sales of \d+ acres or more/.test(intro[1])) {
    assert.ok(intro && intro[1].length < 160 && !/middle[- ]half/.test(intro[1]), "one short visible line, no definition: " + (intro && intro[1]));
    assert.match(body, /<h3 class="ls-dh">Best value per acre<\/h3><p class="ls-fine">Best value lists sales of \d+ acres or more[^<]*usual range/, "the definition is in the fold");
    assert.doesNotMatch(body.slice(body.indexOf("Best value per acre")), /middle[- ]half/);
  }
});

test("county pages and the hub: the same single closed fold, with the source credit visible above it", () => {
  for (const p of ["land-sales/florida/hardee-county.html", "land-sales/wisconsin/testc-county.html", "land-sales/index.html"]) {
    const h = main(rd(p)), { a, body } = fold(h);
    assert.ok(body.includes("Sources and terms"), p);
    assert.match(h.slice(0, a), /<p class="ls-fine">Source: /, `${p}: the credit stays visible`);
    assert.doesNotMatch(h.slice(0, a), /Left out:/, `${p}: no method text outside the fold`);
    assert.doesNotMatch(text(h), /\(\d{1,2}\)|\bcodes? \d/, `${p}: no code-number lists`);
  }
});

test("in Chromium at 390 px: no table is cut off, no element is wider than the screen, on the month, county and hub pages", { skip }, async () => {
  const tmp = site();
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index.html";
    if (!path.extname(p)) p += ".html";
    for (const dir of [tmp, ROOT]) {
      const f = path.normalize(path.join(dir, p));
      if (f.startsWith(dir) && fs.existsSync(f) && fs.statSync(f).isFile()) {
        res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" });
        res.end(fs.readFileSync(f));
        return;
      }
    }
    res.writeHead(404); res.end();
  });
  await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
    await ctx.route(PLACES_ROUTE, (q) => q.abort());
    await ctx.route("**/*", (q) => (q.request().url().startsWith(base) ? q.continue() : q.abort()));
    for (const p of [monthFile(), "land-sales/florida/hardee-county.html", "land-sales/wisconsin/testc-county.html", "land-sales/index.html"]) {
      const pg = await ctx.newPage();
      await pg.goto(`${base}/${p}`, { waitUntil: "load" });
      await pg.evaluate(() => document.querySelectorAll("details.ls-src").forEach((d) => { d.open = true; }));
      const r = await pg.evaluate(() => {
        const vw = document.documentElement.clientWidth, o = { vw, doc: document.documentElement.scrollWidth, wide: [], cut: [], tables: document.querySelectorAll(".ls-w table").length };
        for (const el of document.querySelectorAll(".ls-w *")) {
          const b = el.getBoundingClientRect();
          if (b.width && b.right > vw + 0.5 && !el.closest(".ls-map")) o.wide.push(el.tagName + "." + el.className);
        }
        document.querySelectorAll(".ls-tw").forEach((w) => { if (w.scrollWidth > w.clientWidth + 1) o.cut.push(w.textContent.slice(0, 30)); });
        return o;
      });
      if (!p.endsWith("land-sales/index.html")) assert.ok(r.tables > 0, `${p}: has tables`);   // the hub holds no table since Nov 8: map, cards, picker, link lists
      assert.equal(r.doc, r.vw, `${p}: the page does not scroll sideways`);
      assert.deepEqual(r.wide, [], `${p}: nothing wider than 390 px`);
      assert.deepEqual(r.cut, [], `${p}: no table scrolls inside its box`);
      await pg.close();
    }
  } finally { await browser.close(); srv.close(); }
});
