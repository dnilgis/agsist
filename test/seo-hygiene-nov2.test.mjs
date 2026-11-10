/* SEO hygiene from the Nov 2, 2026 audit (fx/seofix2).
 * 1. Redirect stubs are noindex,follow; their canonical never carries a #fragment. The component fragments are
 *    noindex when opened on their own, and that guard never reaches a page (a robots meta inside a page's body
 *    would drop the whole site from search).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;
const read = (f) => readFileSync(ROOT + f, "utf8");

const STUBS = ["cash-rent.html", "embed.html", "land-tenure.html", "storage-crunch.html", "whats-priced-in.html"];
const FRAGMENTS = ["header.html", "footer.html", "header-fallback.html", "footer-fallback.html"];
const GUARD_MARK = "noindex when this file is opened on its own";

test("redirect stubs: noindex,follow in the head and a canonical without a fragment", () => {
  for (const f of STUBS) {
    const h = read(f);
    const head = h.slice(0, h.indexOf("</head>"));
    assert.match(head, /<meta name="robots" content="noindex,follow">/, f);
    assert.match(head, /http-equiv="refresh"/, `${f} is still a stub`);
    const c = head.match(/<link rel="canonical" href="([^"]+)">/);
    assert.ok(c, `${f}: canonical`);
    assert.ok(!c[1].includes("#"), `${f}: canonical ${c[1]} carries a fragment`);
  }
  assert.match(read("land-tenure.html"), /<link rel="canonical" href="https:\/\/agsist\.com\/farmland-atlas">/);
  assert.match(read("land-tenure.html"), /location\.replace\('\/farmland-atlas'\+location\.search\+'#l=ten_rent'\)/, "readers still land on the tenure layer");
});

test("component fragments: noindex only when opened directly, never a bare robots meta", () => {
  for (const f of FRAGMENTS) {
    const h = read("components/" + f);
    assert.ok(h.includes(GUARD_MARK), f);
    assert.doesNotMatch(h, /<meta[^>]+name=["']robots/i, `${f}: a robots meta here would land in every page's body`);
    assert.match(h, /if\(location\.pathname\.indexOf\('\/components\/'\)<0\)return;/, f);
  }
  // analytics.html: loader.js copies only its <script> tags, so a plain meta never reaches a page
  assert.match(read("components/analytics.html"), /^<meta name="robots" content="noindex">\n/);
  assert.match(read("components/loader.js"), /tmp\.querySelectorAll\('script'\)\.forEach/);
  for (const f of ["page-template.html", "seo-template.html"]) assert.match(read("components/" + f), /noindex/);
  assert.ok(!/^Disallow: \/components\//m.test(read("robots.txt")), "Google must still fetch /components/ to render pages");
});

test("the static nav copy on pages never carries the guard", () => {
  const out = execFileSync("python3", ["scripts/inject_static_nav.py", "--check"], { cwd: ROOT, encoding: "utf8" });
  assert.match(out, /^OK: \d+ pages/);
  const pages = readdirSync(ROOT).filter((f) => f.endsWith(".html"));
  let withNav = 0;
  for (const f of pages) {
    const h = read(f);
    if (h.includes("<!-- static-nav:header -->")) withNav++;
    assert.ok(!h.includes(GUARD_MARK), `${f} carries the fragment guard`);
  }
  assert.ok(withNav > 50, `static nav pages: ${withNav}`);
});

function serve() {
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index.html";
    let f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    if (!existsSync(f) && existsSync(f + ".html")) f += ".html";
    try { const b = readFileSync(f); res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" }); res.end(b); }
    catch (e) { res.writeHead(404); res.end(); }
  });
  return new Promise((r) => srv.listen(0, "127.0.0.1", () => r(srv)));
}

test("in Chromium: a fragment opened alone is noindex; a page with the live header is not", { skip }, async () => {
  const srv = await serve();
  const port = srv.address().port;
  const b = await chromium.launch({ executablePath: CHROME });
  try {
    const pg = await b.newPage();
    await pg.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    const robots = () => pg.evaluate(() => [...document.querySelectorAll('meta[name="robots"]')].map((m) => m.parentNode.tagName + ":" + m.content));
    for (const f of [...FRAGMENTS, "analytics.html"]) {
      await pg.goto(`http://127.0.0.1:${port}/components/${f}`, { waitUntil: "load" });
      assert.deepEqual(await robots(), ["HEAD:noindex"], f);
    }
    for (const p of ["/basis.html", "/about.html"]) {
      await pg.goto(`http://127.0.0.1:${port}${p}`, { waitUntil: "load" });
      await pg.waitForSelector("#topnav", { timeout: 10000 });
      await pg.waitForFunction(() => !document.getElementById("site-footer"), null, { timeout: 10000 });
      const r = await robots();
      assert.ok(r.every((x) => x.startsWith("HEAD:") && !/noindex/.test(x)), `${p}: ${JSON.stringify(r)}`);
    }
  } finally { await b.close(); srv.close(); }
});

// 2. /hail-map: one h1 in the page source; the printed report keeps its own heading.
test("hail map: one h1, and the print window still opens with an h1", () => {
  const h = read("hail-map.html");
  assert.equal((h.match(/<h1\b/gi) || []).length, 1);
  assert.match(h, /<h1 class="hm-title">National Hail Map:/);
  const lit = h.match(/'<div class="hd"><div><h\\x31>Hail History Report<\/h\\x31>'/);
  assert.ok(lit, "print heading literal");
  assert.equal(eval(lit[0]), '<div class="hd"><div><h1>Hail History Report</h1>');
  for (const f of readdirSync(ROOT + "hail-map").filter((x) => x.endsWith(".html"))) {
    assert.equal((read("hail-map/" + f).match(/<h1\b/gi) || []).length, 1, f);
  }
});

// 3. Dataset records: every block parses, and each carries a license and a dateModified from the data's own date.
function* walkHtml(dir) {
  for (const e of readdirSync(ROOT + dir, { withFileTypes: true })) {
    const p = dir + "/" + e.name;
    if (e.isDirectory()) yield* walkHtml(p);
    else if (e.name.endsWith(".html")) yield p;
  }
}
function datasets(f) {
  const out = [];
  const walk = (o) => {
    if (Array.isArray(o)) o.forEach(walk);
    else if (o && typeof o === "object") { if (o["@type"] === "Dataset") out.push(o); Object.values(o).forEach(walk); }
  };
  for (const m of read(f).matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    let d;
    try { d = JSON.parse(m[1]); } catch (e) { assert.fail(`${f}: a JSON-LD block does not parse (${e.message})`); }
    walk(d);
  }
  return out;
}
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const TERMS = "https://agsist.com/terms";

test("Dataset records: license and dateModified on rain, ARC/PLC, hail, rent and custom rates pages", () => {
  const counts = {};
  const sets = { rain: "rain", "arc-plc": "arc-plc", hail: "hail-map", rent: "rent", custom: "custom-rates" };
  const hailAsOf = JSON.parse(read("data/hail/state-counties.json")).generated.slice(0, 10);
  for (const [k, dir] of Object.entries(sets)) {
    counts[k] = 0;
    for (const f of walkHtml(dir)) {
      for (const o of datasets(f)) {
        counts[k]++;
        assert.ok(typeof o.license === "string" && /^https:\/\//.test(o.license), `${f}: license`);
        assert.match(String(o.dateModified || ""), ISO, `${f}: dateModified`);
        if (k === "rain" || k === "hail") assert.equal(o.license, TERMS, f);
        if (k === "hail") assert.equal(o.dateModified, hailAsOf, `${f}: the county file's own date`);
        if (k === "rent") assert.match(read(f), new RegExp(`data refreshed ${o.dateModified}`), `${f}: the date the page shows`);
      }
    }
  }
  assert.ok(counts.rain >= 2500, `rain ${counts.rain}`);
  assert.ok(counts["arc-plc"] >= 2800, `arc-plc ${counts["arc-plc"]}`);
  assert.equal(counts.hail, 51);
  assert.equal(counts.rent, 48);
  assert.ok(counts.custom >= 9, `custom ${counts.custom}`);
  // ARC/PLC state and crop hubs: the site's terms (no license is stated on them)
  for (const f of ["arc-plc/iowa.html", "arc-plc/sunflower-seed.html"]) assert.equal(datasets(f)[0].license, TERMS, f);
  // custom rates: the Dataset date is the date the page itself carries
  for (const f of ["custom-rates.html", "custom-rates/indiana.html"]) {
    const page = read(f).match(/"dateModified": ?"(\d{4}-\d{2}-\d{2})"/)[1];
    for (const o of datasets(f)) assert.equal(o.dateModified, page, f);
  }
});

// 5. /spray: every FAQPage answer is the visible answer, word for word (the visible copy may carry links and bold).
test("spray: FAQPage questions and answers are the visible FAQ", () => {
  const h = read("spray.html");
  const unesc = (t) => t.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&rsquo;/g, "’").replace(/&ldquo;/g, "“")
    .replace(/&rdquo;/g, "”").replace(/&deg;/g, "°").replace(/&ndash;/g, "–").replace(/&times;/g, "×").replace(/&divide;/g, "÷")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
  const text = (t) => unesc(t.replace(/<[^>]+>/g, ""));
  const vis = new Map();
  for (const m of h.matchAll(/<div class="faq-item"><button class="faq-q"[^>]*>([\s\S]*?)<span class="faq-chevron"[\s\S]*?<div class="faq-a"[^>]*>([\s\S]*?)<\/div><\/div>/g)) {
    vis.set(text(m[1]).trim(), text(m[2]));
  }
  const faq = datasetsOf(h, "FAQPage");
  assert.equal(faq.length, 1);
  const qs = faq[0].mainEntity;
  assert.equal(qs.length, vis.size);
  for (const q of qs) {
    assert.ok(vis.has(q.name), `not on the page: ${q.name}`);
    assert.equal(q.acceptedAnswer.text, vis.get(q.name), q.name);
  }
  assert.ok(qs.length >= 16);
});
function datasetsOf(h, type) {
  const out = [];
  const walk = (o) => {
    if (Array.isArray(o)) o.forEach(walk);
    else if (o && typeof o === "object") { if (o["@type"] === type) out.push(o); Object.values(o).forEach(walk); }
  };
  for (const m of h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) walk(JSON.parse(m[1]));
  return out;
}

// Rain county title test (Nov 2): the title leads with the year's own inches and place; it is the page's total.
// Nov 10: the total is one gauge's, so the title names the gauge ("at the Gilbert Gauge," or "at Gilbert,"); a county
// whose only gauge is a mountain snow site leads with the county-wide estimate ("About 16.85 in of Rain in ...").
test("rain county pages: the title's inches are the total the page shows, og:title in step", () => {
  let n = 0, bare = 0, question = 0, gauge = 0, county = 0;
  for (const st of readdirSync(ROOT + "rain", { withFileTypes: true }).filter((d) => d.isDirectory())) {
    for (const f of readdirSync(ROOT + "rain/" + st.name).filter((x) => x.endsWith(".html"))) {
      const p = `rain/${st.name}/${f}`;
      const h = read(p);
      if (/http-equiv="refresh"/.test(h)) continue;   // a moved county's pointer
      const title = h.match(/<title>([^<]*)<\/title>/)[1];
      const shown = h.match(/<dt>(Rain (?:so far|in \d{4})|Across the county, estimate)<\/dt><dd>([\d,]+\.\d\d) <small>in<\/small><\/dd>/);
      if (!shown) { question++; assert.match(title, /^How Much Rain /, `${p}: no total shown, so the question title`); continue; }
      n++;
      const m = title.match(/^(About )?([\d,]+\.\d\d) in of Rain (in |at [^,]+, )(.+), ([A-Z]{2}), (\d{4})( \| AGSIST)?$/);
      assert.ok(m, `${p}: ${title}`);
      assert.equal(!!m[1], shown[1] === "Across the county, estimate", `${p}: "About" exactly when the county-wide estimate leads`);
      if (m[1]) { county++; assert.equal(m[3], "in ", p); } else if (m[3] !== "in ") gauge++;
      assert.equal(m[2], shown[2], `${p}: title inches = the page's lead figure`);
      assert.match(h, new RegExp(`class="rc-answer"><b>${m[2].replace(/\./, "\\.")} inches?</b>`), `${p}: the lead answer says the same`);
      assert.match(h, new RegExp(`<h1>How much rain (?:has|did) ${m[4]}, [A-Za-z .]+, (?:had|get) in ${m[6]}\\?`), `${p}: same place and year as the h1`);
      const base = title.replace(/ \| AGSIST$/, "");
      if (m[7]) assert.ok(title.length <= 60, `${p}: ${title.length} chars with the suffix`);
      else { bare++; assert.ok((base + " | AGSIST").length > 60, `${p}: suffix dropped only past 60`); }
      assert.ok(base.length <= 68, `${p}: ${base.length} chars`);
      assert.ok(!/thru|through/i.test(title), p);
      assert.ok(h.includes(`<meta property="og:title" content="${base}">`), `${p}: og:title`);
    }
  }
  assert.ok(n >= 2500, `inches-first titles: ${n}`);
  assert.ok(gauge >= n * 0.9, `titles naming the gauge: ${gauge} of ${n}`);
  assert.ok(county <= 30, `county-estimate titles (mountain snow sites only): ${county}`);
  // most gauge titles run past 60 and drop " | AGSIST" (checked page by page above); the count is no longer capped
  assert.match(read("rain/kentucky/marion-county.html"), /<title>\d+\.\d\d in of Rain (in|at [^,]+,) Marion County, KY, \d{4}( \| AGSIST)?<\/title>/);
});

// 4. ARC/PLC county pages: one plain sentence ahead of the cards, built only from what the cards print.
test("ARC/PLC county pages: the lede repeats the cards' own answers, benchmarks and the data date", () => {
  let n = 0, none = 0;
  const unq = (t) => t.replace(/&rsquo;/g, "’").replace(/&amp;/g, "&");
  for (const st of readdirSync(ROOT + "arc-plc", { withFileTypes: true }).filter((d) => d.isDirectory())) {
    for (const f of readdirSync(ROOT + "arc-plc/" + st.name).filter((x) => x.endsWith(".html"))) {
      const p = `arc-plc/${st.name}/${f}`;
      const h = read(p);
      if (!h.includes('<h2 id="crops">')) { none++; assert.ok(!h.includes("ap-sum"), `${p}: no cards, no lede`); continue; }
      const m = h.match(/<\/h1>\s*<p class="ap-byline"><time[^>]*datetime="(\d{4}-\d{2}-\d{2})"[^>]*>Data updated ([^<]+)<\/time><\/p>\s*<p class="page-lede ap-sum">([^<]+)<\/p>\s*<h2 id="crops">/);
      assert.ok(m, `${p}: the lede sits between the byline and the cards`);
      n++;
      const lede = unq(m[3]);
      assert.ok(lede.endsWith(`, data updated ${m[2]}.`), `${p}: the page's own data date`);
      const cards = h.slice(h.indexOf('<h2 id="crops">'), h.indexOf('<h2 id="your-plc-yield">') > 0 ? h.indexOf('<h2 id="your-plc-yield">') : undefined);
      const arts = [...cards.matchAll(/<article class="ap-crop"[\s\S]*?<\/article>/g)].map((x) => x[0]);
      for (const a of arts.slice(0, 3)) {
        const big = a.match(/<span class="ap-big">([^<]+)<\/span>/)[1];
        if (big === "PLC" || big === "ARC-CO") assert.ok(lede.includes(` ${big}`), `${p}: ${big}`);
        const bm = a.match(/90% of the ([^<]+?) benchmark/);
        if (bm) assert.ok(lede.includes(`(benchmark ${bm[1]})`), `${p}: benchmark ${bm[1]}`);
      }
      // every number in the lede is printed on the page outside the lede
      const rest = h.replace(m[3], "");
      for (const num of lede.replace(/, data updated [^.]+\.$/, "").match(/\d[\d,]*(?:\.\d+)?/g) || []) {
        assert.ok(rest.includes(num), `${p}: ${num} is not printed elsewhere on the page`);
      }
      if (arts.length > 3) assert.match(lede, new RegExp(`; ${arts.length - 3} more crops? below`), p);
    }
  }
  assert.ok(n >= 2600, `county ledes: ${n}`);
  assert.ok(none < 150, `county pages without cards: ${none}`);
});
