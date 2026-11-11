/* Weather, 7 pages to 3 (Nov 11, 2026). Radar rain (/rain-radar) and the drought monitor (/drought-monitor)
 * are tabs of /rain; urea loss (/urea) and fall anhydrous (/fall-nitrogen) are tabs of /spray. /hail-map
 * stays. The tab bar is scripts/page_tabs.py (markup) and components/page-tabs.js (behaviour); the /rain
 * tabs are written by scripts/build_county_rain.py from the panel files in components/fold/.
 *
 *   node --test test/weather-fold-nov11.test.mjs
 *
 * Every old address forwards to a tab that exists; nothing links to an old address; the menu has four
 * lines fewer; each tab keeps its old page's working tool and answer; a closed tab loads none of its
 * code or maps until it opens. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const MOVED = JSON.parse(execFileSync("python3", ["-c",
  "import sys,json;sys.path.insert(0,'scripts');import moved_pages as m;print(json.dumps({k:list(v) for k,v in m.MOVED.items()}))"],
  { cwd: ROOT, encoding: "utf8" }));
const FOLDS = { "/rain-radar": ["/rain", "radar"], "/drought-monitor": ["/rain", "drought"],
  "/urea": ["/spray", "urea"], "/fall-nitrogen": ["/spray", "fall-nitrogen"] };
const TABS = { "/rain": ["radar", "county", "drought"], "/spray": ["spray", "urea", "fall-nitrogen"] };
const fileOf = (u) => u.slice(1) + ".html";

test("every old weather address forwards to a tab its destination has", () => {
  for (const [old, [to, tab]] of Object.entries(FOLDS)) {
    assert.deepEqual(MOVED[old].slice(0, 2), [to, tab], old);
    const stub = read(MOVED[old][2]);
    assert.match(stub, /<meta name="robots" content="noindex,follow">/, old);
    assert.ok(stub.includes(`<link rel="canonical" href="https://agsist.com${to}">`), old + " canonical");
    assert.ok(stub.includes(`<meta http-equiv="refresh" content="0; url=${to}#${tab}">`), old + " no-script forward");
    const js = stub.match(/<script>([\s\S]*?)<\/script>/)[1];
    const go = (search, hash) => { const c = { location: { search, hash, replace(u) { c.to = u; } } }; vm.runInNewContext(js, c); return c.to; };
    assert.equal(go("", ""), `${to}#${tab}`, old);
    // a radar link from Field Scout or a county page keeps its spot
    assert.equal(go("?lat=41.9&lon=-93.6&label=Ames", ""), `${to}?lat=41.9&lon=-93.6&label=Ames#${tab}`, old + " keeps the query");
    const page = read(fileOf(to));
    const box = page.match(/<div class="ptabs" data-ptabs="([^"]+)" data-default="([^"]+)">/);
    assert.ok(box, to + " has the tab box");
    assert.deepEqual(box[1].split(" "), TABS[to], to + " tabs in order");
    assert.ok(page.includes(`<a role="tab" id="${tab}" href="#p-${tab}" data-tab="${tab}" aria-controls="p-${tab}"`), `${to} tab #${tab}`);
    assert.ok(page.includes(`<section class="ptab" id="p-${tab}" role="tabpanel" aria-labelledby="${tab}"`), `${to} panel p-${tab}`);
  }
  assert.match(read("rain.html"), /data-default="radar"/, "the radar opens first on /rain: it had the most readers");
  assert.match(read("spray.html"), /data-default="spray"/);
});

test("the old pages are out of the sitemaps, llms.txt and the menu table", () => {
  const olds = Object.keys(FOLDS);
  for (const f of readdirSync(ROOT).filter((x) => /^sitemap.*\.xml$/.test(x)))
    for (const o of olds) assert.ok(!read(f).includes(`https://agsist.com${o}<`), `${f}: ${o}`);
  for (const o of olds) {
    assert.ok(!read("llms.txt").includes(`(https://agsist.com${o})`), "llms.txt " + o);
    assert.ok(!read("scripts/dev/nav/gen_nav.py").includes(`("${o}", `), "menu table " + o);
  }
  assert.match(read("scripts/inject_static_nav.py"), /"\/rain-radar", "\/drought-monitor", "\/urea", "\/fall-nitrogen"\)/);
});

test("nothing the site serves links to a folded weather page", () => {
  const LINK = /(?:href="|agsist\.com|"href": ?"|'href', ?'|\[['"][^'"]+['"], ?')\/(?:rain-radar|drought-monitor|urea|fall-nitrogen)(?:\.html)?\/?(?=["'?#<\s])/;
  const stubs = new Set(Object.keys(FOLDS).map((o) => MOVED[o][2]));
  const bad = [];
  (function walk(d) {
    for (const n of readdirSync(join(ROOT, d))) {
      if (n.startsWith(".") || ["node_modules", "test", "scripts", "build", "references", "workers"].includes(n)) continue;
      const p = d ? d + "/" + n : n;
      if (statSync(join(ROOT, p)).isDirectory()) {
        if (p === "cash-bids" || p === "data") continue;   // town pages: their own job rebuilds them with the new menu
        walk(p); continue;
      }
      if (stubs.has(p) || p === "changelog.html") continue;   // the changelog is built on main and follows forwards
      if (!/\.(html|js)$/.test(n)) continue;
      if (LINK.test(read(p))) bad.push(p);
    }
  })("");
  assert.deepEqual(bad.slice(0, 10), [], bad.length + " files link a folded page");
  for (const f of ["data/next-links.json", "data/search-index.json"]) assert.doesNotMatch(read(f), LINK, f);
  // the builders that write those links into generated pages and emails
  for (const f of ["scripts/build_county_rain.py", "scripts/build_state_rent_pages.py", "scripts/make_prf_html.py", "scripts/build_search_index.py"])
    assert.doesNotMatch(read(f).replace(/#[^\n]*|"""[\s\S]*?"""/g, ""), /["'(]\/(rain-radar|drought-monitor|urea|fall-nitrogen)["'?#)]/, f);
});

test("the menu: four lines fewer, /rain and /spray named by what they hold", () => {
  const header = read("components/header.html");
  const desk = header.slice(header.indexOf('<div class="nav-menu">'), header.indexOf('<div class="nav-actions">'));
  const drawer = header.slice(header.indexOf('<div class="drawer" id="drawer"'));
  // 59 phone panel lines before (test/menutrim-oct29.test.mjs history), 55 after
  assert.equal((drawer.match(/class="draw-item[^"]*"|class="draw-rp"/g) || []).length, 55);
  for (const [name, s] of [["desktop", desk], ["phone", drawer], ["footer", read("components/footer.html")],
    ["header-fallback", read("components/header-fallback.html")], ["footer-fallback", read("components/footer-fallback.html")]]) {
    for (const o of Object.keys(FOLDS)) assert.ok(!s.includes(`href="${o}"`), `${name}: no ${o}`);
    assert.match(s, /href="\/rain"[^>]*>(?:<svg[^>]*><use href="#i-cloud-rain"\/><\/svg>)?Rain and drought<\/a>/, name + " rain line");
    assert.match(s, /href="\/spray"[^>]*>(?:<svg[^>]*><use href="#i-spray-can"\/><\/svg>)?Spray, urea and soil temp<\/a>/, name + " spray line");
    assert.ok(s.includes('href="/hail-map"'), name + " hail map stays");
  }
});

test("each tab keeps its old page's tool and answer", () => {
  const rain = read("rain.html"), spray = read("spray.html");
  const one = (h, i) => { const a = h.indexOf(`id="p-${i}"`), b = h.indexOf('<section class="ptab"', a); return h.slice(a, b < 0 ? undefined : b); };
  // radar: the spot lookup, the tiles, the map and the gauge check, labelled an estimate
  const radar = one(rain, "radar");
  for (const id of ["rr-answer", "rr-zip", "rr-geo", "rr-tiles", "rr-map", "rr-gauge", "rr-replay"]) assert.ok(radar.includes(`id="${id}"`), "radar #" + id);
  assert.match(radar, /NOAA radar and gauge estimate \(MRMS\), not a rain gauge reading/);
  // county: the state picker, the records and every state
  const county = rain.slice(rain.indexOf('id="p-county"'), rain.indexOf('id="p-drought"'));
  for (const id of ["rc-pick", "all-states"]) assert.ok(county.includes(`id="${id}"`), "county #" + id);
  // drought: the headline, the county box, the map views and the questions
  const drought = rain.slice(rain.indexOf('id="p-drought"'));
  for (const id of ["dm-answer", "dm-county-q", "dm-view-tabs", "dm-map-img", "dm-state-grid"]) assert.ok(drought.includes(`id="${id}"`), "drought #" + id);
  assert.match(drought, /Map and data courtesy of NDMC/);
  assert.match(drought, /How many weeks does my county have to be in D2 before LFP kicks in\?/);
  // urea: the risk gauge, the location box, the factors, the 5-day strip
  const urea = one(spray, "urea");
  for (const id of ["gauge-num", "risk-verdict", "u-btn-geo", "urea-zip", "u-factor-section", "fc-strip", "in-ph"]) assert.ok(urea.includes(`id="${id}"`), "urea #" + id);
  assert.match(urea, /Urea <span>volatilization<\/span><br>risk monitor/);
  // fall anhydrous: the picker, the stamped state table, the extension rules
  const fall = one(spray, "fall-nitrogen");
  for (const id of ["fn-zip", "fn-st", "fn-live", "rules", "rule-IA"]) assert.ok(fall.includes(`id="${id}"`), "fall #" + id);
  assert.match(fall, /<!--FALLN:STATIC-->[\s\S]*<!--\/FALLN:STATIC-->/, "the soil table is stamped in the tab");
  assert.match(read("scripts/fetch_fall_nitrogen.py"), /^PAGE = "spray\.html"/m, "the fall nitrogen job stamps spray.html");
  // one h1 a page; the tabs' old headings are h2
  assert.equal((rain.match(/<h1\b/g) || []).length, 1);
  assert.equal((spray.match(/<h1\b/g) || []).length, 1);
  // ids stay unique once three pages share one
  for (const [n, h] of [["rain", rain], ["spray", spray]]) {
    const seen = {}, dup = [];
    for (const m of h.matchAll(/\sid="([^"]+)"/g)) { if (seen[m[1]]) dup.push(m[1]); seen[m[1]] = 1; }
    assert.deepEqual(dup, [], n + " duplicate ids");
  }
  // one FAQPage a page, holding every tab's visible questions
  for (const [h, qs] of [[rain, ["Where does this rain number come from?", "When is the US Drought Monitor updated?"]],
    [spray, ["What is a thermal inversion and how do I know if one is present?"]]]) {
    const faqs = [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]))
      .flatMap((d) => d["@graph"] || [d]).filter((x) => x["@type"] === "FAQPage");
    assert.equal(faqs.length, 1);
    for (const q of qs) assert.ok(faqs[0].mainEntity.some((e) => e.name === q), q);
  }
});

test("a closed tab costs nothing: its maps and code load when it opens", () => {
  const rain = read("rain.html"), spray = read("spray.html");
  const loaded = (h) => [...h.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]);
  for (const s of ["/components/fold/drought.js", "/components/drought-county.js", "/components/fold/radar.js", "/components/radar-rain-page.js", "/vendor/leaflet-1.9.4/leaflet.js"])
    assert.ok(!loaded(rain).some((u) => u.startsWith(s)), "rain.html does not load " + s + " up front");
  for (const s of ["/components/fold/urea.js", "/components/fold/fall-nitrogen.js", "/components/fert-pick.js"])
    assert.ok(!loaded(spray).some((u) => u.startsWith(s)), "spray.html does not load " + s + " up front");
  assert.match(rain, /id="p-drought"[^>]*data-css="\/components\/fold\/drought\.css\?v=1" data-js="[^"]*\/components\/fold\/drought\.js\?v=1/);
  assert.match(rain, /id="p-radar"[^>]*data-js="\/vendor\/leaflet-1\.9\.4\/leaflet\.js [^"]*\/components\/radar-rain-page\.js\?v=10"/);
  assert.match(spray, /id="p-urea"[^>]*data-css="\/components\/fold\/urea\.css\?v=1" data-js="[^"]*\/components\/fold\/urea\.js\?v=1"/);
  assert.ok(rain.includes('id="dm-map-img"') && /id="dm-map-img"[^>]*loading="lazy"|loading="lazy"[^>]*id="dm-map-img"/.test(rain.replace(/\n\s*/g, " ")), "the drought map image waits for its tab");
  for (const h of [rain, spray]) assert.ok(h.includes('<script src="/components/page-tabs.js?v=1" defer></script>'));
  // the scoped style of a tab never reaches the rest of the page
  for (const [f, id] of [["urea.css", "p-urea"], ["fall-nitrogen.css", "p-fall-nitrogen"], ["drought.css", "p-drought"], ["radar.css", "p-radar"]]) {
    const css = read("components/fold/" + f).replace(/\/\*[\s\S]*?\*\//g, "");
    const sels = [...css.matchAll(/(?:^|})\s*([^{}@][^{}]*?)\s*\{/g)].flatMap((m) => m[1].split(",")).map((s) => s.trim()).filter((s) => s && !s.startsWith("@"));
    const loose = sels.filter((s) => !s.includes("#" + id) && !/^(from|to|\d+%)$/.test(s));
    assert.deepEqual(loose, [], f + " selectors outside #" + id);
  }
  assert.match(execFileSync("python3", ["scripts/page_tabs.py", "--selftest"], { cwd: ROOT, encoding: "utf8" }), /passed/);
});

test("the rain builder writes the tabs from the panel files, and rebuilds when one changes", () => {
  const g = JSON.parse(execFileSync("python3", ["scripts/generated_sets.py", "json"], { cwd: ROOT, encoding: "utf8" }));
  const sets = Array.isArray(g) ? g : g.sets;
  const rain = sets.find((s) => s.id === "rain");
  for (const f of ["components/fold/radar.html", "components/fold/radar.css", "components/fold/drought.html"])
    assert.ok(JSON.stringify(rain).includes(f), "rain set code lists " + f);
  const b = read("scripts/build_county_rain.py");
  assert.match(b, /fold_part\("radar\.html"\)/);
  assert.match(b, /fold_part\("drought\.html"\)/);
  assert.match(b, /<a href="\/rain\?\{e\(q\)\}#radar">/, "a county page's radar line opens the radar tab at its gauge");
});

const PW = process.env.PLAYWRIGHT_PATH || "/opt/node-tools/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index";
    if (!extname(p)) p += ".html";
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

test("in a browser: an old address opens its tab, a tab click loads its code once, the address follows", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    const pg = await ctx.newPage();
    const errors = [];
    pg.on("pageerror", (e) => errors.push(e.message));
    const scripts = [];
    pg.on("request", (r) => { if (r.resourceType() === "script") scripts.push(new URL(r.url()).pathname); });

    await pg.goto(`http://127.0.0.1:${port}/urea`);
    await pg.waitForURL(/\/spray#urea$/);
    await pg.waitForFunction(() => document.querySelector("#p-urea[data-ready]"));
    assert.equal(await pg.getAttribute(".ptabs", "data-on"), "urea");
    assert.ok(await pg.isVisible("#p-urea .hero-title"), "the urea heading shows");
    assert.ok(!(await pg.isVisible("#p-spray")), "the spray panel is closed");
    assert.equal(await pg.getAttribute("#urea", "aria-selected"), "true");
    assert.ok(scripts.includes("/components/fold/urea.js"), "urea code loaded");
    assert.ok(!scripts.includes("/components/fold/fall-nitrogen.js"), "the fall tab's code waits");

    await pg.click("#fall-nitrogen");
    await pg.waitForFunction(() => document.querySelector(".ptabs").getAttribute("data-on") === "fall-nitrogen");
    assert.match(pg.url(), /\/spray#fall-nitrogen$/, "the address names the open tab");
    await pg.waitForFunction(() => document.querySelector("#p-fall-nitrogen[data-ready]"));
    assert.ok(await pg.isVisible("#p-fall-nitrogen table.fn-t"), "the soil table shows");
    await pg.click("#urea");
    await pg.click("#fall-nitrogen");
    assert.equal(scripts.filter((s) => s === "/components/fold/fall-nitrogen.js").length, 1, "a tab's code loads once");

    scripts.length = 0;
    await pg.goto(`http://127.0.0.1:${port}/rain-radar?lat=41.9&lon=-93.6&label=Ames`);
    await pg.waitForURL(/\/rain\?lat=41\.9&lon=-93\.6&label=Ames#radar$/);
    assert.equal(await pg.getAttribute(".ptabs", "data-on"), "radar");
    assert.ok(!scripts.includes("/components/fold/drought.js"), "drought code waits for its tab");
    await pg.goto(`http://127.0.0.1:${port}/drought-monitor`);
    await pg.waitForURL(/\/rain#drought$/);
    await pg.waitForFunction(() => document.querySelector("#p-drought[data-ready]"));
    assert.ok(await pg.isVisible("#dm-county-q"), "the county box shows");
    assert.ok(!(await pg.isVisible("#rr-answer")), "the radar panel is closed");
    // an old section link inside a tab opens that tab
    await pg.goto(`http://127.0.0.1:${port}/rain#all-states`);
    await pg.waitForFunction(() => document.querySelector(".ptabs").getAttribute("data-on") === "county");
    // no JavaScript: every panel shows, one after the other
    const nojs = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: "block" });
    await nojs.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    const p2 = await nojs.newPage();
    await p2.goto(`http://127.0.0.1:${port}/spray`);
    for (const id of ["p-spray", "p-urea", "p-fall-nitrogen"]) assert.ok(await p2.isVisible("#" + id), "no script: " + id + " shows");
    await nojs.close();
    assert.deepEqual(errors, [], "no page errors");
  } finally {
    await browser.close();
    srv.close();
  }
});
