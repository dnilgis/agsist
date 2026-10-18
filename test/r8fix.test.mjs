/* Re-score 8 fixes (Oct 18, 2026).
 *   1. The Next block never adds an email ask when the footer band (or any signup) is on the page.
 *   2. Weight: each page reads only its own Next entry (data/next/<path>.json); glossary.js and
 *      data/glossary.json load after idle and only when the main text has a candidate term.
 *   3. A glossary mark never lets touching punctuation wrap onto its own line (/tariffs at 390).
 *   4. Page fixes: one homepage email ask, USDA calendar "What I grow or raise", scorecard state
 *      cash line, milk 2025 changes folded, the Oct 17 Daily grammar slip.
 *   5. What's new: data/whats-new.json drives the homepage card and the top of /changelog.
 *   node --test test/r8fix.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { extname, join, normalize } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const G = require(ROOT + "components/glossary.js");
const GL = JSON.parse(read("data/glossary.json"));
const NX = JSON.parse(read("data/next-links.json"));
const WN = JSON.parse(read("data/whats-new.json"));
const NEXT_JS = read("components/next-links.js");

function fileFor(href) {
  const p = href.split("#")[0].replace(/^\//, "");
  if (p === "") return "index.html";
  for (const f of [p, p + ".html", p.replace(/\/$/, "") + "/index.html"]) if (existsSync(join(ROOT, f)) && statSync(join(ROOT, f)).isFile()) return f;
  return null;
}
function htmlFiles(dir = "", out = []) {
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    if (e.name.startsWith(".") || e.name === "node_modules") continue;
    const rel = dir ? dir + "/" + e.name : e.name;
    if (e.isDirectory()) { if (!/^(data|img|fonts|vendor|test|scripts)$/.test(rel)) htmlFiles(rel, out); }
    else if (e.name.endsWith(".html")) out.push(rel);
  }
  return out;
}

/* ---------- 1. one email ask ---------- */
test("the Next ask is added only with no signup anywhere and no site footer coming", () => {
  assert.match(NEXT_JS, /function wantAsk\(\) \{\s*return !doc\.querySelector\(SIGNUP\) && !doc\.getElementById\('site-footer'\);/);
  assert.match(NEXT_JS, /var ask = e\.signup !== false && wantAsk\(\);/);
  assert.doesNotMatch(NEXT_JS, /hasSignup\(main\)/, "no longer looks only inside <main>");
  assert.match(read("components/footer.html"), /data-signup-ask=/, "the footer band is the ask");
});

/* ---------- 2. weight ---------- */
const PRE = (() => { const m = NEXT_JS.match(/var PRE = (\/.*\/i);/); assert.ok(m, "PRE in next-links.js"); return eval(m[1]); })();

test("the glossary pre-scan catches every term in data/glossary.json", () => {
  // each term's name, and what its own patterns mark in a plain sentence
  const extra = { "ending-stocks": ["carryout"], "the-trade": ["trade estimates", "trade guess", "the trade expects"], settle: ["settlement price"], carry: ["a full carry"], nowcast: ["nowcasts"] };
  for (const t of GL.terms) {
    assert.ok(PRE.test(t.term), t.id + ": pre-scan misses its name " + t.term);
    for (const s of extra[t.id] || []) assert.ok(PRE.test(s), t.id + ": pre-scan misses " + s);
  }
  const C = G.compile(GL.terms);
  for (const s of ["Corn basis is 40 under.", "The trade expects a cut.", "Ending stocks and carryout rose.", "Cash bids fell; CBOT closed.", "Prices in $/cwt.", "Net 30 terms."]) {
    if (G.pickMarks([s], C).length) assert.ok(PRE.test(s), "a sentence the glossary would mark passes the pre-scan: " + s);
  }
  assert.ok(!PRE.test("The weather was dry and the roads were open."), "plain text does not load the glossary");
});

test("glossary.js loads after idle, only through next-links.js, and only on a hit", () => {
  assert.match(NEXT_JS, /function idle\(fn\)/);
  assert.match(NEXT_JS, /requestIdleCallback\(fn/);
  assert.match(NEXT_JS, /idle\(glossary\)/);
  assert.match(NEXT_JS, /!PRE\.test\(top\.textContent \|\| ''\)\) return;/);
  assert.match(NEXT_JS, /\/components\/glossary\.js\?v=2/);
  const direct = htmlFiles().filter((f) => /<script src="\/components\/glossary\.js/.test(read(f)));
  assert.deepEqual(direct, [], "no page loads glossary.js itself");
  for (const s of ["build_arc_plc.py", "build_county_rain.py", "build_state_rent_pages.py", "generate_hail_events.py", "make_prf_html.py"])
    assert.doesNotMatch(read("scripts/" + s), /components\/glossary\.js/, s + " no longer writes the glossary tag");
});

test("each page reads only its own Next file, and the files match the map", () => {
  assert.doesNotMatch(NEXT_JS, /fetch\('\/data\/next-links\.json'\)/, "the whole map is not fetched");
  assert.match(NEXT_JS, /'\/data\/next' \+ \(k === '\/' \? '\/index' : k\) \+ '\.json'/);
  execFileSync("python3", [join(ROOT, "scripts/build_next_links.py"), "--check"], { cwd: ROOT });
  for (const [k, e] of Object.entries(NX.pages)) {
    const f = "data/next" + (k === "/" ? "/index" : k.replace(/\/$/, "")) + ".json";
    const d = JSON.parse(read(f));
    assert.deepEqual(d.links, e.links, k);
    if (e.signup !== false) assert.ok(d.ask && d.ask.length > 20, k + " carries its ask text");
    assert.ok(Buffer.byteLength(read(f)) < 1500, f + " stays small");
  }
  const tags = htmlFiles().filter((f) => /next-links\.js\?v=/.test(read(f)));
  for (const f of tags) assert.match(read(f), /next-links\.js\?v=2"/, f + " loads the new next-links.js");
});

/* ---------- 3. punctuation ---------- */
test("marks keep touching punctuation on their line", () => {
  const js = read("components/glossary.js");
  assert.match(js, /\.gl-w\{white-space:nowrap\}/);
  assert.ok(G.PUNCT_AFTER.test(", export demand") && G.PUNCT_AFTER.test(".") && G.PUNCT_AFTER.test(")"));
  assert.ok(!G.PUNCT_AFTER.test(" and"));
  assert.ok(G.PUNCT_BEFORE.test("the (") && !G.PUNCT_BEFORE.test("the "));
});

/* ---------- 4. page fixes ---------- */
test("homepage: one email ask; the compact bar and big band no longer open by themselves", () => {
  const js = read("components/home.js");
  assert.doesNotMatch(js, /isDismissed\('agsist_signup_compact_dismissed'\)\)\{var el2=document\.getElementById\('signup-compact'\);if\(el2\)el2\.style\.display='flex'/);
  assert.doesNotMatch(js, /visits<=24/);
  assert.match(js, /if\(toSignup\)\{var el=document\.getElementById\('signup-full'\)/);
  assert.match(read("index.html"), /\/components\/home\.js\?v=9"/);
});

test("USDA calendar: What I grow or raise, saved on this device", () => {
  const h = read("usda-calendar.html");
  assert.match(h, /What I grow or raise/);
  for (const v of ["all", "grain", "stock"]) assert.match(h, new RegExp('data-grow="' + v + '"'));
  assert.match(h, /localStorage\.setItem\('agsist-cal-grow',v\)/);
  assert.match(h, /\.filter\(growOk\)/);
});

test("scorecard: the reader's state cash line sits under the calls; milk 2025 changes fold", () => {
  const s = read("scorecard.html");
  const i = s.indexOf('id="pb-latest"'), j = s.indexOf('data-state-bid="corn soybeans wheat"'), k = s.indexOf("<h2>By crop</h2>");
  assert.ok(i > 0 && j > i && k > j, "state line between the latest calls and By crop");
  assert.match(s, /components\/price-local\.js\?v=\d+" defer/);
  assert.match(read("milk-prices.html"), /<details class="dp-states" id="dp-reform-list"><summary>The five changes, with dates<\/summary>/);
});

test("Oct 17 Daily: grammar slip fixed in the issue and its archive", () => {
  for (const f of ["daily/2026-10-17.html", "data/daily-archive/2026-10-17.json"]) {
    assert.doesNotMatch(read(f), /has broke down/);
    assert.match(read(f), /output has fallen 85% since 2020/);
  }
});

/* ---------- 5. what's new ---------- */
test("whats-new.json: real pages, newest first, plain words, baked into home and changelog", () => {
  const items = WN.items;
  assert.ok(items.length >= 4);
  const dates = items.map((i) => i.date);
  assert.deepEqual(dates, [...dates].sort().reverse(), "newest first");
  for (const it of items) {
    assert.ok(fileFor(it.link), it.id + " links a real page " + it.link);
    assert.doesNotMatch(it.title + it.line, /—/, it.id + " no em dash");
    assert.doesNotMatch(it.title + it.line, /\b(revolutionary|seamless|game.chang|unlock|supercharg|exciting)/i, it.id + " no hype");
    assert.ok(it.line.length <= 170, it.id + " one line");
  }
  assert.deepEqual(items.filter((i) => /saledetail|tap-a-sale|land sales/i.test(i.id + i.title)), [], "nothing from branches not on main");
  execFileSync("python3", [join(ROOT, "scripts/build_whats_new.py"), "--check"], { cwd: ROOT });
  const h = read("index.html");
  const card = h.slice(h.indexOf("<!-- WHATSNEW:card"), h.indexOf("<!-- /WHATSNEW:card -->"));
  assert.equal((card.match(/<li data-wn=/g) || []).length, 4, "the card shows the newest 4");
  for (const it of items.slice(0, 4)) assert.ok(card.includes('data-wn="' + it.id + '"'), it.id);
  assert.match(card, /aria-label="Hide /);
  assert.match(card, /localStorage\.setItem\(K/);
  assert.ok(h.indexOf("<!-- WHATSNEW:card") < h.indexOf('id="f1"') || h.indexOf('id="f1"') < 0, "near the top");
  const c = read("changelog.html");
  const i = c.indexOf("<!-- WHATSNEW:entries -->"), j = c.indexOf("<!-- CHANGELOG:entries -->");
  assert.ok(i > 0 && j > i, "new entries sit above the old log");
  for (const it of items) assert.ok(c.slice(i, j).includes('id="' + it.id + '"'), it.id + " on /changelog");
  assert.match(c, /October 14, 2026/, "old history kept");
});

/* ---------- browser ---------- */
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    let f = normalize(join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname)));
    if (f.endsWith("/")) f += "index.html";
    if (!existsSync(f) && existsSync(f + ".html")) f += ".html";
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((r) => srv.listen(0, "127.0.0.1", () => r(srv)));
}

test("in a browser: one ask at the end, small Next fetch, comma stays with its mark, card hides per item", { skip, timeout: 120000 }, async () => {
  const srv = await serve();
  const base = "http://127.0.0.1:" + srv.address().port;
  const b = await chromium.launch({ executablePath: CHROME });
  try {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
    const p = await ctx.newPage();
    await p.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    const got = [];
    p.on("request", (r) => got.push(new URL(r.url()).pathname));

    await p.goto(base + "/tariffs", { waitUntil: "load" });
    await p.waitForSelector(".next-links", { timeout: 15000 });
    await p.waitForSelector(".gl-term", { timeout: 15000 });
    await p.waitForSelector("footer [data-signup-ask]", { timeout: 15000 }).catch(() => {});
    const r = await p.evaluate(() => {
      const bad = [];
      for (const w of document.querySelectorAll(".gl-w")) {
        const btn = w.querySelector(".gl-term"), last = w.lastChild;
        if (!btn || last === btn) continue;
        const rg = document.createRange(); rg.selectNodeContents(last);
        const a = btn.getBoundingClientRect(), c = rg.getBoundingClientRect();
        const mid = (c.top + c.bottom) / 2; if (!(mid > a.top && mid < a.bottom)) bad.push(w.textContent + ' ' + JSON.stringify([a.top, a.bottom, c.top, c.bottom]));
      }
      return {
        wrapped: [...document.querySelectorAll(".gl-w")].map((w) => w.textContent),
        bad,
        nextAsk: document.querySelectorAll(".next-links [data-signup-ask]").length,
      };
    });
    assert.ok(r.wrapped.some((t) => /^basis,$/.test(t)), "the 'basis,' mark carries its comma: " + JSON.stringify(r.wrapped));
    assert.deepEqual(r.bad, [], "punctuation on the mark's line");
    assert.equal(r.nextAsk, 0, "no Next ask on a page with the footer band");
    assert.ok(got.includes("/data/next/tariffs.json"), "its own Next file");
    assert.ok(!got.includes("/data/next-links.json"), "not the whole map");

    // a page whose main text has no candidate term never loads the glossary
    await p.goto(base + "/data/whats-new.json");
    got.length = 0;
    await p.setContent("<html><body><main><p>The weather was dry and the roads were open all week long.</p></main></body></html>");
    await p.addScriptTag({ url: base + "/components/next-links.js?v=2" }).catch(() => {});
    await p.waitForTimeout(2500);
    assert.equal(await p.evaluate(() => window.AgsistNext && window.AgsistNext._v), 2, "next-links.js ran on the plain page");
    assert.ok(!got.some((u) => /glossary/.test(u)), "no glossary fetch without a term: " + got.join(","));

    // the homepage card: baked in, hides per item, remembers it
    await p.goto(base + "/", { waitUntil: "domcontentloaded" });
    const before = await p.evaluate(() => { const c = document.getElementById("wn-card"); return c && { n: c.querySelectorAll("li:not([hidden])").length, h: c.getBoundingClientRect().height }; });
    assert.ok(before && before.n === 4 && before.h > 80, "card drawn with 4 items before scripts finish");
    const id = await p.locator("#wn-card li").first().getAttribute("data-wn");
    await p.locator("#wn-card .wn-x").first().click();
    assert.equal(await p.locator("#wn-card li:not([hidden])").count(), 3);
    await p.reload({ waitUntil: "domcontentloaded" });
    assert.equal(await p.locator('#wn-card li[data-wn="' + id + '"]').isHidden(), true, "stays hidden after reload");
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, "no sideways scroll at 390");
    await ctx.close();
  } finally { await b.close(); srv.close(); }
});
