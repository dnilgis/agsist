/* One headline futures contract (fx/soyroll2, Sig's screenshot Nov 4 2026, 8:46 AM CT,
 * home page at 1280 px).
 *
 * #307 rolled the headline soybean contract to Jan '27 at first notice (Oct 30), but the home
 * page still read "Nov '26 bean futures $11.94 1/4" in the Futures tile and "Soybeans Nov '26
 * $11.94 1/4" in the ticker, right above a Wisconsin line on Jan '27 futures. Cash was off by
 * the Nov/Jan spread. Now every headline corn and soybean price reads AgPxStamp.headline
 * (components/price-local.js; twin seed_static.py nearby_of), and every "new crop" slot reads
 * AgPxStamp.harvest (twin seed_static.py harvest_of): the Dec or Nov AFTER the headline month.
 *
 * Fixtures: test/fixtures/soyroll2/prices-2026-11-04.json is the real price file of Nov 4
 * 14:46 UTC. The Oct 28 file is that one moved back 7 days with its nearby aliases taken off and
 * picked again by scripts/fetch_prices.py add_nearby on Oct 28, so both days come from the
 * real first-notice rule, not a hand-written answer.
 *
 * Browser part (390 and 1280 px, every outside host aborted, service workers blocked:
 * BUILD-RULES 58) needs PLAYWRIGHT_PATH and CHROMIUM_PATH. SHOT_DIR=<dir> saves screenshots.
 *   node --test test/headline-contract.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { extname, join, normalize } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const P = require(join(ROOT, "components/price-local.js"));
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const FX = join(ROOT, "test/fixtures/soyroll2/prices-2026-11-04.json");

const py = (code) => JSON.parse(execFileSync("python3", ["-c", "import sys, json; sys.path.insert(0, 'scripts')\n" + code], { cwd: ROOT, encoding: "utf8" }));
/* the price file as fetch_prices would write it on `day`: dates moved back `back` days, the
   nearby aliases picked again by add_nearby at noon UTC of that day */
function fileOn(day, back) {
  return py(`
import re, types
from datetime import datetime, timedelta, timezone
# the CI test runner has no yfinance; add_nearby never calls it (pure function)
sys.modules.setdefault('yfinance', types.ModuleType('yfinance'))
import fetch_prices as F
raw = open(${JSON.stringify(FX)}).read()
def mv(m):
    d = datetime(int(m.group(1)), int(m.group(2)), int(m.group(3))) - timedelta(days=${back})
    return d.strftime('%Y-%m-%d') + (m.group(4) or '')
raw = re.sub(r'\\b(20\\d\\d)-(\\d\\d)-(\\d\\d)(T[\\d:.]+Z)?', mv, raw)
d = json.loads(raw)
q = d['quotes']
for k in [k for k in q if k.endswith('-nearby')]:
    del q[k]
now = datetime.strptime(${JSON.stringify(day)}, '%Y-%m-%d').replace(hour=12, tzinfo=timezone.utc)
import contextlib, io
with contextlib.redirect_stdout(io.StringIO()):
    d['nearby'] = F.add_nearby(q, list(q.keys()), now)
print(json.dumps(d))`);
}
const NOV4 = fileOn("2026-11-04", 0), OCT28 = fileOn("2026-10-28", 7);

test("the real first-notice rule picks the fixtures' headline: Jan '27 beans on Nov 4, Nov '26 on Oct 28", () => {
  assert.equal(NOV4.nearby.beans.key, "beans-jan27");
  assert.equal(OCT28.nearby.beans.key, "beans-nov26");
  assert.equal(NOV4.nearby.corn.key, "corn-dec26");
  // the frozen file agrees with the rule run again on it
  const raw = JSON.parse(readFileSync(FX, "utf8"));
  assert.equal(raw.nearby.beans.key, NOV4.nearby.beans.key);
  assert.equal(raw.quotes["beans-nearby"].close, NOV4.quotes["beans-nearby"].close);
});

test("AgPxStamp.headline and .harvest on Nov 4 and Oct 28, and Python's twins agree", () => {
  const h4 = P.headline(NOV4, "beans"), h28 = P.headline(OCT28, "beans");
  assert.equal(h4.label, "Jan '27"); assert.equal(h4.q.close, 1206.25);
  assert.equal(h28.label, "Nov '26");
  assert.equal(P.harvest(NOV4, "beans").label, "Nov '27", "Nov '26 is past first notice: the next harvest is Nov '27");
  assert.equal(P.harvest(OCT28, "beans").label, "Nov '27", "the headline IS Nov '26: the second card is next year's");
  assert.equal(P.headline(NOV4, "corn").label, "Dec '26");
  assert.equal(P.harvest(NOV4, "corn").label, "Dec '27");
  for (const [name, f] of [["Nov 4", NOV4], ["Oct 28", OCT28]]) {
    const out = py(`import seed_static as S
d = json.loads(${JSON.stringify(JSON.stringify(f))})
q = d['quotes']
r = {}
for c in ('corn', 'beans'):
    n = S.nearby_of(q, c); h = S.harvest_of(q, c)
    r[c] = [n[0]['close'], h[0] if h else None, h[2] if h else None]
print(json.dumps(r))`);
    for (const c of ["corn", "beans"]) {
      const h = P.harvest(f, c);
      assert.deepEqual(out[c], [P.headline(f, c).q.close, h ? h.key : null, h ? h.label : null], name + " " + c);
    }
  }
  // Nov 30 2026: Dec '26 corn is past first notice; the headline is Mar '27, the next harvest Dec '27
  const q30 = { "corn-dec26": { close: 441.5, ticker: "ZCZ26.CBT" }, "corn-mar27": { close: 455, ticker: "ZCH27.CBT" },
    "corn-dec27": { close: 470, ticker: "ZCZ27.CBT" }, "corn-dec": { close: 441.5, ticker: "ZCZ26.CBT" } };
  q30["corn-nearby"] = { ...q30["corn-mar27"], contract: "Mar '27" };
  assert.equal(P.headline(q30, "corn").label, "Mar '27");
  assert.equal(P.harvest(q30, "corn").key, "corn-dec27");
  // never the headline's own month or one past first notice when the next one is missing
  const q31 = { "beans-nearby": { close: 1, ticker: "ZSF27.CBT" }, "beans-nov": { close: 2, ticker: "ZSX26.CBT" } };
  assert.equal(P.harvest(q31, "beans"), null);
});

test("seeds: the home Futures tile and lead soybean card bake the headline contract", () => {
  const s = py(`import seed_static as S
d = json.loads(${JSON.stringify(JSON.stringify(NOV4))})
print(json.dumps(S.hero_futures_seeds(d['quotes'], d['fetched'])))`);
  assert.equal(s["hp:fs-k"], "Jan \u201927 bean futures");
  assert.match(s["hp:fs"], /\$12\.06<span class="hb-frac"> 1\/4<\/span>/);
  assert.equal(s["hp:fc-k"], "Dec ’26 corn futures");
  const o = py(`import seed_static as S
d = json.loads(${JSON.stringify(JSON.stringify(OCT28))})
print(json.dumps(S.hero_futures_seeds(d['quotes'], d['fetched'])))`);
  assert.equal(o["hp:fs-k"], "Nov ’26 bean futures");
});

/* A headline corn or soybean price must come from AgPxStamp.headline (or <crop>-nearby), never
   from the harvest aliases. Every remaining 'corn-dec' / 'beans-nov' literal is listed here with
   its reason and count; a new one fails until it is reviewed and added. */
const ALLOWED = {
  "components/breakeven.js": [6, "the 2026/2027 crop picker: the alias names the crop year; this crop's price is thisCropKey (headline past first notice); the price-watch sender follows only these symbols, so the price-watch ask hides for this-crop soybeans from Oct 30 and corn from Nov 30 (intended: no alert is armed on a contract other than the one shown)"],
  "components/fast-facts.js": [1, "newCropKey's fallback key for the labeled Dec new-crop row"],
  "components/futures.js": [5, "the futures pages' new-crop tiles, labeled, picked by newCropKey after the nearby"],
  "components/geo.js": [2, "PRICE_MAP wiring of the second-card element ids; home-yield.js swaps in AgPxStamp.harvest"],
  "components/home-yield.js": [16, "the second-card ids and FORWARD_YEAR aliases; the card shows AgPxStamp.harvest; ranges wiring"],
  "components/home.js": [10, "ticker and card element keys and the price-alert options, explicit contracts named by month"],
  "components/raise-picker.js": [4, "which ticker items to show for a crop (data-sym wiring)"],
  "components/rent-calc.js": [1, "fallback only when no corn-nearby is on file"],
  "components/signup-ask.js": [5, "the price-watch sender's symbols, named December corn / November soybeans"],
  "components/tar-spot.js": [1, "the tar spot break-even's default price: December futures for the next crop a reader would spray, an explicit contract named with its year on the page"],
  "components/storesell.js": [2, "comments about the keys it does not use"],
  "fertilizer.html": [2, "the labeled Dec new-crop corn price for the fertilizer-to-corn ratio"],
  "index.html": [8, "ticker and second-card data-sym wiring, the price-alert options (explicit contracts)"],
  "markets.html": [6, "second-card keys, filled from AgPxStamp.harvest and named on the chip"],
};
test("no headline reads the harvest aliases: every 'corn-dec' / 'beans-nov' literal is allow-listed", () => {
  const files = readdirSync(join(ROOT, "components")).filter((f) => f.endsWith(".js")).map((f) => "components/" + f)
    .concat(readdirSync(ROOT).filter((f) => f.endsWith(".html")));
  const seen = {};
  for (const f of files) {
    const n = (read(f).match(/['"](?:beans-nov|corn-dec)['"]/g) || []).length;
    if (n) seen[f] = n;
  }
  for (const [f, n] of Object.entries(seen)) {
    assert.ok(ALLOWED[f], `${f} names 'corn-dec' or 'beans-nov' ${n} times: a headline reads AgPxStamp.headline; an explicit contract goes on the allow-list with its reason`);
    // exact: a swap inside an allowed file (one use removed, a headline one added) is caught too
    assert.equal(n, ALLOWED[f][0], `${f}: ${n} alias literals, exactly ${ALLOWED[f][0]} allowed (${ALLOWED[f][1]}); review the change and update the count`);
  }
  for (const f of Object.keys(ALLOWED)) assert.ok(seen[f], `${f} is on the allow-list but names no alias any more: take it off`);
  // the home Futures tile and its seed read the headline, not an alias
  const home = read("index.html"), paint = home.slice(home.indexOf("function paintFut"), home.indexOf("function getPrices"));
  assert.match(paint, /AgPxStamp\.headline/);
  assert.doesNotMatch(paint, /['"](?:beans-nov|corn-dec)['"]/);
  const seed = read("scripts/seed_static.py"), hero = seed.slice(seed.indexOf("def hero_futures_seeds"), seed.indexOf("# --- /news"));
  assert.match(hero, /nearby_of\(q, crop\)/);
  assert.doesNotMatch(hero, /"beans-nov"|"corn-dec"/);
  // every page that calls the helper loads it first
  assert.ok(read("breakeven.html").indexOf("price-local.js?v=11") < read("breakeven.html").indexOf("breakeven.js?v="));
});

/* PR #320 checker: the merge of main put markets.html back on price-local.js?v=9 while the page
   calls AgPxStamp.harvest (v10 only); a cached v9 hid the second cards after they painted. One
   version everywhere the helper loads, every page, so a missed page cannot happen again. */
test("every page and script that loads price-local.js asks for the same version", () => {
  const files = readdirSync(ROOT).filter((f) => f.endsWith(".html"))
    .concat(readdirSync(join(ROOT, "components")).filter((f) => f.endsWith(".js")).map((f) => "components/" + f));
  const seen = {};
  for (const f of files) for (const m of read(f).matchAll(/components\/price-local\.js\?v=(\d+)/g)) (seen[m[1]] = seen[m[1]] || []).push(f);
  assert.deepEqual(Object.keys(seen), ["10"], "price-local.js versions: " + JSON.stringify(seen));
  for (const f of ["index.html", "markets.html", "breakeven.html", "fast-facts.html"]) assert.ok(seen["10"].includes(f), f + " loads price-local.js");
});

/* ---------------------------------------------------------------- browser */
function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    let f = normalize(join(ROOT, p));
    if (f.endsWith("/")) f += "index.html";
    if (!existsSync(f) && existsSync(f + ".html")) f += ".html";
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}
async function open(browser, port, path, width, file, clock) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width, height: 900 } });
  const pg = await ctx.newPage(), errs = [];
  pg.on("pageerror", (e) => errs.push(e.message));
  // BUILD-RULES 58: nothing leaves this machine
  await pg.route((u) => !u.href.startsWith(`http://127.0.0.1:${port}/`), (r) => r.abort());
  await pg.route((u) => u.pathname === "/data/prices.json", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(file) }));
  await pg.clock.setFixedTime(new Date(clock));
  await pg.goto(`http://127.0.0.1:${port}${path}`, { waitUntil: "domcontentloaded" });
  return { ctx, pg, errs };
}
const SHOTS = process.env.SHOT_DIR || "";
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const DAYS = [["2026-11-04T16:00:00Z", NOV4, "Jan", "Nov '27"], ["2026-10-28T16:00:00Z", OCT28, "Nov", "Nov '27"]];

test("home: the Futures tile and the ticker print the headline month (Jan '27 on Nov 4, Nov '26 on Oct 28)", { skip, timeout: 180000 }, async () => {
  const srv = await serve(), port = srv.address().port, browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const [clock, file, mon, next] of DAYS) for (const w of [390, 1280]) {
      const want = mon === "Jan" ? "27" : "26";
      const { ctx, pg, errs } = await open(browser, port, "/", w, file, clock);
      await pg.waitForFunction((m) => new RegExp("^" + m + " ’").test(document.getElementById("hb-fs-k").textContent) &&
        /\$/.test(document.getElementById("hb-fs-v").textContent), mon, { timeout: 20000 });
      const k = await pg.textContent("#hb-fs-k"), v = await pg.textContent("#hb-fs-v");
      assert.equal(k, `${mon} ’${want} bean futures`, w + " tile");
      assert.equal(v, mon === "Jan" ? "$12.06 1/4" : "$11.94 1/4", w + " tile price");
      // the ticker: the soybean front month names the headline; the second item the next harvest
      await pg.waitForFunction((m) => [...document.querySelectorAll('.prices-strip [data-sym="beans"] .t-label')].some((e) => e.textContent.indexOf(m) > 0), `${mon} '${want}`, { timeout: 20000 });
      await pg.waitForFunction((n) => [...document.querySelectorAll('.prices-strip [data-sym="beans-nov"] .t-label')].every((e) => e.textContent === "Soybeans " + n), next, { timeout: 20000 });
      const labels = await pg.$$eval(".prices-strip .t-label", (es) => es.map((e) => e.textContent));
      if (mon === "Jan") {
        // soybeans only: feeder cattle and milk really are Nov '26
        assert.ok(!labels.some((l) => /^Soybeans Nov '26/.test(l)), w + ": no soybean ticker item on Nov '26 past first notice: " + labels.join(" | "));
        // and the second soybean item carries the Nov '27 price, not Nov '26's
        const tp = await pg.$eval('.prices-strip [data-sym="beans-nov"] .t-price', (e) => e.textContent);
        assert.match(tp, /11\.87/, w + " Nov '27 price on the ticker: " + tp);
        const hero = await pg.textContent("#hero-band");
        assert.doesNotMatch(hero, /Nov ’26|Nov '26/, w + ": hero");
        // the soybean cards: the front names Jan '27, the second card Nov '27
        await pg.waitForFunction(() => /Nov '27/.test((document.querySelector("#pcp-bean-nov").closest(".pc").querySelector(".pc-contract") || {}).textContent || ""), null, { timeout: 20000 });
      }
      if (SHOTS) {
        await pg.locator("#hero-band").scrollIntoViewIfNeeded();
        await pg.screenshot({ path: join(SHOTS, `home-${clock.slice(0, 10)}-${w}.png`), fullPage: false });
      }
      assert.deepEqual(errs.filter((e) => !/Failed to fetch|NetworkError|aborted/i.test(e)), [], w + " page errors");
      await ctx.close();
    }
  } finally { await browser.close(); srv.close(); }
});

test("breakeven: this crop's soybean price is Jan '27 past first notice, Nov '26 before", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), port = srv.address().port, browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const [clock, file, mon] of DAYS) for (const w of [390, 1280]) {
      const want = mon === "Jan" ? "Jan '27 soybeans (2026 crop)" : "Nov '26 soybeans (2026 crop)";
      const { ctx, pg, errs } = await open(browser, port, "/breakeven.html", w, file, clock);
      await pg.selectOption("#crop", "soybeans");
      await pg.waitForFunction(() => document.querySelectorAll("#be-year option").length === 2, null, { timeout: 20000 });
      const opts = await pg.$$eval("#be-year option", (es) => es.map((e) => e.textContent));
      assert.equal(opts[0], want, w + " this crop");
      assert.equal(opts[1], "Nov '27 soybeans (2027 crop)", w + " next crop");
      await pg.selectOption("#be-year", "0");
      await pg.waitForFunction((t) => document.getElementById("live-crop-name").textContent === t, want, { timeout: 10000 });
      assert.equal(await pg.textContent("#live-price-val"), (mon === "Jan" ? "$12.06¼" : "$11.94¼") + "/bu");
      assert.deepEqual(errs, [], w + " page errors");
      await ctx.close();
    }
  } finally { await browser.close(); srv.close(); }
});

test("markets: the second soybean card is Nov '27 on Nov 4, and nothing names Nov '26", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), port = srv.address().port, browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const w of [390, 1280]) {
      const { ctx, pg, errs } = await open(browser, port, "/markets.html", w, NOV4, DAYS[0][0]);
      await pg.waitForFunction(() => /Jan '27/.test(document.getElementById("pct-beans").textContent), null, { timeout: 20000 });
      assert.equal(await pg.textContent("#pc-card-bean-nov .pc-contract"), "Nov '27");
      assert.equal(await pg.textContent("#pc-card-corn-dec .pc-contract"), "Dec '27");
      assert.ok(await pg.isVisible("#pc-card-corn-dec"));
      // the soybean cards (feeder cattle and milk really are Nov '26)
      const soy = await pg.$$eval(".pc", (es) => es.filter((e) => /soybeans|beans/i.test((e.querySelector(".pc-name") || {}).textContent || "")).map((e) => e.innerText).join(" | "));
      assert.match(soy, /Jan '27/); assert.doesNotMatch(soy, /Nov '26/, soy);
      assert.deepEqual(errs, [], w + " page errors");
      await ctx.close();
    }
  } finally { await browser.close(); srv.close(); }
});

/* BUILD-RULES 67 (PR #320): the price run reseeds markets.html and index.html every 15 minutes,
   so a PR that edits a line carrying a seed (or the line next to one) conflicts with main
   forever. This PR edits no such line: the second-card chips are written by the builder
   (seed_static.mk_card_chips) on the card's own line, and every seed value is main's. */
test("seeds: the builder writes the second-card chips; this branch carries main's seed lines", () => {
  const out = py(`import seed_static as S
t = open('markets.html').read()
t2 = S.mk_card_chips(t, {'pc-card-corn-dec': "Dec '27", 'pc-card-bean-nov': "Nov '27"})
import re
print(json.dumps([re.search(r'id="pc-card-corn-dec">.*?class="pc-contract">([^<]*)<', t2).group(1),
                  re.search(r'id="pc-card-bean-nov">.*?class="pc-contract">([^<]*)<', t2).group(1),
                  S.mk_card_chips(t2, {'pc-card-corn-dec': "Dec '27", 'pc-card-bean-nov': "Nov '27"}) == t2]))`);
  assert.deepEqual(out, ["Dec '27", "Nov '27", true], "chips written, and a second run changes nothing");
  // no line this page script block owns carries a seed marker
  const mk = read("markets.html"), blk = mk.slice(mk.indexOf("(fx/soyroll2): the second corn and soybean cards"), mk.indexOf("True front month (2026-07-30)"));
  assert.ok(blk.length > 100);
  assert.doesNotMatch(blk, /<!--SEED:/);
});
