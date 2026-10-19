/* ARC/PLC state pages stay well under the 150 KB cap (CLAUDE.md).
 *
 * Oct 16, 2026: arc-plc/texas.html was 143 KB, 95% of the cap, almost all of
 * it the county table (about 1,500 county, crop and practice rows). Now a state
 * whose table would pass TABLE_INLINE_MAX (scripts/build_arc_plc.py) keeps
 * every county link in the page and loads the full table from
 * data/arc-plc/table/<ST>.json when the reader opens it. Smaller states keep
 * the table inline, so search engines still read it.
 *
 * Checks: every state page under 110 KB; each on-demand page links every
 * county in its data file and counts its rows right; the data file's revenue
 * is yield x the 2026 benchmark price (worked by hand below); and, where
 * Playwright is installed, the opened table in a real browser has the rows,
 * rowspans and links the inline table had.
 *
 *   node --test test/arc-plc-state-size.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (f) => readFileSync(ROOT + f, "utf8");
const STATES = readdirSync(ROOT + "arc-plc").filter((f) => f.endsWith(".html") && existsSync(ROOT + "arc-plc/" + f.replace(/\.html$/, "")));
const onDemand = STATES.filter((f) => read("arc-plc/" + f).includes('id="ap-tbl"'));
const MAIN = JSON.parse(read("data/arc-plc.json"));

test("every ARC/PLC state page is under 110 KB (cap 150 KB)", () => {
  assert.ok(STATES.length >= 40, `found ${STATES.length} state pages`);
  for (const f of STATES) {
    const n = Buffer.byteLength(read("arc-plc/" + f));
    assert.ok(n < 110 * 1024, `arc-plc/${f} is ${(n / 1024).toFixed(0)} KB`);
  }
});

test("the three biggest tables load on demand; small states keep theirs inline", () => {
  for (const s of ["texas.html", "georgia.html", "kansas.html"]) assert.ok(onDemand.includes(s), s);
  for (const s of ["iowa.html", "wisconsin.html"]) {
    const h = read("arc-plc/" + s);
    assert.ok(!h.includes('id="ap-tbl"'), `${s} keeps its table inline`);
    assert.match(h, /<table class="tbl ap-t ap-st">[\s\S]*?<tbody><tr>/);
  }
});

for (const f of ["texas.html", "georgia.html", "kansas.html"]) {
  test(`${f}: county links, row count and data file agree`, () => {
    const h = read("arc-plc/" + f);
    const src = h.match(/id="ap-tbl" data-src="([^"]+)"/)[1];
    const j = JSON.parse(read(src.slice(1)));
    assert.equal(src, `/data/arc-plc/table/${j.st}.json`);
    assert.equal("arc-plc/" + j.slug + ".html", "arc-plc/" + f);
    const n = j.rows.reduce((a, c) => a + c[2].length, 0);
    assert.match(h, new RegExp(`Show all ${n.toLocaleString("en-US")} county, crop and practice rows`));
    for (const [name, slug] of j.rows) {
      assert.ok(h.includes(`<a href="/arc-plc/${j.slug}/${slug}">`), `${name} linked`);
      assert.ok(existsSync(ROOT + `arc-plc/${j.slug}/${slug}.html`), `${slug} page exists`);
    }
    // the Dataset says where the full table is
    assert.ok(h.includes(`"contentUrl": "https://agsist.com${src}"`) || h.includes(`"contentUrl":"https://agsist.com${src}"`), "Dataset distribution");
    const visible = h.replace(/<script[\s\S]*?<\/script>/g, "");
    assert.doesNotMatch(visible, /—|&mdash;/, "no em dashes");
  });
}

/* Andrews County TX wheat: FSA benchmark 21.00 bu x the 2026 wheat benchmark
   price $6.98 = $146.58, shown as $147. Every bushel row in the file is checked
   the same way: yield x the crop's 2026 benchmark price, rounded to a dollar. */
test("table revenue is yield x the 2026 benchmark price", () => {
  const tx = JSON.parse(read("data/arc-plc/table/TX.json"));
  const andrews = tx.rows.find((c) => c[0] === "Andrews");
  assert.deepEqual(andrews[2][0], ["Wheat", "All", "21.0 bu", "$147"]);  // one benchmark rounding, the title's (Oct 19, 2026; was "21.00 bu")
  assert.equal(MAIN.years["2026"].crops.wheat.bp.value, 6.98);
  assert.equal(Math.round(21.0 * 6.98), 147);
  const bp = {};
  for (const c of Object.values(MAIN.years["2026"].crops)) bp[c.label] = c.bp.value;
  let checked = 0;
  for (const f of onDemand) {
    const j = JSON.parse(read(read("arc-plc/" + f).match(/data-src="\/([^"]+)"/)[1]));
    for (const c of j.rows) for (const [crop, , y, rev] of c[2]) {
      if (!y.endsWith(" bu") || bp[crop] === undefined) continue;
      const want = Math.round(parseFloat(y.replace(/,/g, "")) * bp[crop]);
      const got = Number(rev.replace(/[$,]/g, ""));
      assert.ok(Math.abs(want - got) <= 1, `${j.st} ${c[0]} ${crop}: ${y} x ${bp[crop]} = ${want}, file ${got}`);
      checked++;
    }
  }
  assert.ok(checked > 1000, `checked ${checked} rows`);
});

const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (!extname(p)) p += ".html";
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

test("Texas: opening the table draws every row with its county link and rowspan", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
    const pg = await ctx.newPage();
    const errors = [];
    pg.on("pageerror", (e) => errors.push(String(e)));
    await pg.route("**/*", (r) => (r.request().url().startsWith(`http://127.0.0.1:${port}`) ? r.continue() : r.abort()));
    await pg.goto(`http://127.0.0.1:${port}/arc-plc/texas`);
    const tx = JSON.parse(read("data/arc-plc/table/TX.json"));
    const n = tx.rows.reduce((a, c) => a + c[2].length, 0);
    assert.equal(await pg.$$eval("#ap-tbl tbody tr", (r) => r.length), 1, "nothing drawn until opened");
    await pg.click("#ap-tbl summary");
    await pg.waitForFunction((n) => document.querySelectorAll("#ap-tbl tbody tr").length === n, n);
    const first = await pg.$$eval("#ap-tbl tbody tr", (rs) => rs.slice(0, 3).map((r) => r.outerHTML));
    assert.equal(first[0], '<tr><th scope="row"><a href="/arc-plc/texas/anderson-county">Anderson</a></th><td>Seed cotton</td><td>All</td><td>1,351 lb</td><td>$583</td></tr>');  // a whole pound, as the title prints it (Oct 19, 2026; was 1,351.44 lb)
    assert.equal(first[1], '<tr><th scope="row" rowspan="6"><a href="/arc-plc/texas/andrews-county">Andrews</a></th><td>Wheat</td><td>All</td><td>21.0 bu</td><td>$147</td></tr>');
    assert.equal(first[2], "<tr><td>Sorghum</td><td>All</td><td>31.3 bu</td><td>$166</td></tr>");  // tenths, Oct 19, 2026 (were 21.00 and 31.29 bu)
    assert.equal(await pg.$$eval("#ap-tbl tbody th a", (a) => a.length), tx.rows.length);
    assert.equal(await pg.evaluate(() => document.documentElement.scrollWidth), 390, "no sideways scroll");
    assert.deepEqual(errors, []);
    await ctx.close();
  } finally {
    await browser.close();
    srv.close();
  }
});
