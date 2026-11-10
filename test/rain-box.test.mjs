/* The county rain box (Nov 3, 2026): /embed/rain for other sites, and a closed fold on every county rain
 * page ("Put this on your site or in your newsletter") with the iframe code, the one plain sentence and the
 * monthly newsletter block.
 *
 * Every number in the box is the county page's number: the line is written twice (box_line in
 * scripts/build_county_rain.py for the page, line() in components/rain-box.js for the embed) and this holds the
 * two equal on the saved fixtures (test/fixtures/rain, built the way the builder's selftest builds them), then
 * holds both to the page's own figures. No date of today and no live number is pinned anywhere here.
 *
 *   node --test test/rain-box.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync, mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { extname, join, normalize } from "node:path";
import { tmpdir } from "node:os";
import vm from "node:vm";
import { scan } from "../scripts/source_links.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const B = createRequire(import.meta.url)("../components/rain-box.js");
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

// ---- the fixture site: data from the saved ACIS answers, pages from the builder (as its selftest does)
const TMP = mkdtempSync(join(tmpdir(), "rainbox-"));
process.on("exit", () => { try { rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* temp */ } });
const PY = `
import json, os, subprocess, sys
sys.path.insert(0, "scripts")
import build_county_rain as BR
t = sys.argv[1]
data, site = os.path.join(t, "data"), os.path.join(t, "site")
for st, ed in (("IA", "2026-10-12"), ("KS", "2026-10-12"), ("DE", "2024-12-31")):
    subprocess.run([sys.executable, "scripts/fetch_county_rain.py", "--fixtures", "test/fixtures/rain", "--out", data,
                    "--states", st, "--edate", ed], check=True, capture_output=True)
want = BR.build(data)
BR.write_or_check(want, site, False)
C = BR.R.counties()
out = {}
for p in sorted(os.listdir(data)):
    if not p.endswith(".json"):
        continue
    d = json.load(open(os.path.join(data, p)))
    if d.get("state") not in BR.R.STATES:
        continue
    for f, c in d["counties"].items():
        if f in C:
            rel = "rain/%s/%s.html" % (BR.R.slug(BR.R.STATES[d["state"]]), C[f]["slug"])
            out[f] = {"st": d["state"], "rel": rel, "line": BR.box_line(c, d["state"], d["year"], BR.done_year(d)),
                      "page_src": BR.box_source(c), "slug": C[f]["slug"]}
print(json.dumps(out))
`;
const FX = JSON.parse(execFileSync("python3", ["-c", PY, TMP], { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 24 }));
const fdata = (st) => JSON.parse(readFileSync(join(TMP, "data", st.toLowerCase() + ".json"), "utf8"));
const fpage = (rel) => readFileSync(join(TMP, "site", rel), "utf8");
const unent = (s) => s.replace(/&rsquo;/g, "’").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

test("fixtures cover a percent, a withheld percent, a CoCoRaHS gauge and a finished year", () => {
  const all = Object.entries(FX).map(([f, x]) => [f, x, fdata(x.st).counties[f]]);
  assert.ok(all.length >= 10, "enough fixture counties");
  assert.ok(all.some(([, , c]) => c.pct !== null), "a county with a percent");
  assert.ok(all.some(([, , c]) => c.pct === null), "a county with no percent");
  assert.ok(all.some(([, , c]) => c.station.net === "cocorahs"), "a volunteer gauge");
  assert.ok(all.some(([, x]) => /-12-31$/.test(fdata(x.st).edate)), "a finished year");
});

test("the embed's line is the page's line, word for word, for every fixture county", () => {
  for (const [f, x] of Object.entries(FX)) {
    const d = fdata(x.st), c = d.counties[f];
    assert.equal(B.line(c, x.st, d), x.line, f);
    assert.equal(B.path(c, x.st), "/" + x.rel.replace(/\.html$/, ""), f + " county page path");
  }
});

test("every number in the box is the county page's number; no percent where the page has none", () => {
  for (const [f, x] of Object.entries(FX)) {
    const d = fdata(x.st), c = d.counties[f], page = fpage(x.rel);
    const line = B.line(c, x.st, d);
    const fig = (re) => (page.match(re) || [])[1];
    const tot = fig(/<dt>Rain [^<]*<\/dt><dd>([\d.]+) <small>in<\/small><\/dd>/);
    assert.ok(tot && line.includes(": " + tot + " in of rain"), f + " total " + tot);
    const pct = fig(/<dt>Percent of usual<\/dt><dd>(\d+)%<\/dd>/);
    if (pct) assert.ok(line.includes(", " + pct + "% of usual,"), f + " percent");
    else assert.doesNotMatch(line, /%/, f + ": the page withholds the percent, so does the box");
    // the through day is the page's as-of day
    const m = line.match(/through ([A-Z][a-z]{2} \d{1,2})/);
    assert.ok(m && page.includes(m[1]), f + " through day on the page");
    // the fold on the page carries the same line, the source in words and the page's own address
    const s = unent((page.match(/<p class="rc-fine rc-emb-s">([^<]*)<\/p>/) || [])[1] || "");
    assert.equal(s, `${line} (${x.page_src}, via AGSIST: agsist.com/${x.rel.replace(/\.html$/, "")})`, f + " page sentence");
  }
});

test("the fold: closed, one per county page, newsletter block link, the shared script, no source link", () => {
  for (const [f, x] of Object.entries(FX)) {
    const page = fpage(x.rel);
    const i = page.indexOf('<details class="rc-emb"'), j = page.indexOf("</details>", i);
    assert.ok(i > 0 && j > i, f + " fold");
    const fold = page.slice(i, j);
    assert.equal(page.split('<details class="rc-emb"').length, 2, f + " one fold");
    assert.match(fold, new RegExp(`^<details class="rc-emb" data-st="${x.st}" data-c="${f}" data-n="[^"]+"><summary>Put this on your site or in your newsletter</summary>`), f);
    assert.ok(fold.includes(`<a href="/newsletter-block?c=${f}">`), f + " newsletter block");
    assert.deepEqual(scan(fold), [], f + " no data-source link");
    assert.doesNotMatch(fold, /CoCoRaHS/, "the page prose never names CoCoRaHS (only its byline credits it)");
    assert.equal((page.match(/\/components\/rain-box\.js\?v=\d+/g) || []).length, 1, f + " one script tag");
    assert.ok(i > page.indexOf("<h2>Questions</h2>") && i < page.indexOf('class="rc-byline"'), f + " above the byline");
  }
});

test("the JS slug matches the builder's for every county in the atlas (accents, apostrophes)", () => {
  const out = JSON.parse(execFileSync("python3", ["-c",
    "import json,sys;sys.path.insert(0,'scripts');import county_rain as R;print(json.dumps({f:[c['name'],c['slug'],c['st']] for f,c in R.counties().items()}))"],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 24 }));
  const bad = [];
  for (const [f, [name, sl, st]] of Object.entries(out)) {
    // a name used twice in one state gets the FIPS on its slug; the box would point at the first, so none may exist
    if (B.slug(name) !== sl) bad.push(f + " " + name + " " + sl);
    if (!B.STATES[st]) bad.push(f + " no state " + st);
  }
  assert.deepEqual(bad.slice(0, 5), []);
});

test("iframe code: our address with st and c only, the county named in the title", () => {
  const k = B.code("IA", "19169", 'O"Brien & Co <x>');
  assert.equal(k, '<iframe src="https://agsist.com/embed/rain?st=ia&c=19169" title="O&quot;Brien &amp; Co &lt;x> rain, AGSIST" width="100%" height="110" style="border:0;max-width:480px" loading="lazy"></iframe>');
});

test("embed.js mounts the rain box with checked st and c, nothing else passed", () => {
  const src = read("embed.js");
  const nodes = [];
  const mk = (attrs) => {
    const n = { attrs: { ...attrs }, kids: [], style: {}, getAttribute: (k) => (k in n.attrs ? n.attrs[k] : null),
      setAttribute: (k, v) => { n.attrs[k] = String(v); }, appendChild: (c) => n.kids.push(c) };
    return n;
  };
  nodes.push(mk({ "data-agsist-widget": "rain", "data-st": "IA", "data-c": "19169" }));
  nodes.push(mk({ "data-agsist-widget": "rain", "data-st": "iowa", "data-c": "19169&x=1" }));
  nodes.push(mk({ "data-agsist-widget": "gdu", "data-st": "ia", "data-c": "19169" }));
  const doc = { readyState: "complete", querySelectorAll: (s) => (s === "[data-agsist-widget]" ? nodes : []),
    createElement: (t) => mk({ tag: t }), addEventListener() {} };
  vm.runInNewContext(src, { document: doc, window: { addEventListener() {} } });
  const ifr = nodes.map((n) => n.kids.find((k) => k.attrs.tag === "iframe"));
  assert.equal(ifr[0].src, "https://agsist.com/embed/rain?utm_source=embed&utm_medium=script&st=ia&c=19169");
  assert.equal(ifr[1].src, "https://agsist.com/embed/rain?utm_source=embed&utm_medium=script", "bad values dropped");
  assert.equal(ifr[2].src, "https://agsist.com/embed/gdu?utm_source=embed&utm_medium=script", "the GDU widget takes no place");
  assert.equal(ifr[0].attrs["data-agsist-key"], "rain");
});

test("embed/rain.html: noindex, canonical set to the county page, posts its height, no source link, rain-box.js loaded", () => {
  const h = read("embed/rain.html");
  assert.match(h, /<meta name="robots" content="noindex">/);
  assert.match(h, /<link rel="canonical" href="https:\/\/agsist\.com\/rain" id="canon">/);
  assert.match(h, /getElementById\('canon'\)\.href=href/);
  assert.match(h, /parent\.postMessage\(\{agsist:'rain',height:document\.body\.scrollHeight\},'\*'\)/);
  assert.deepEqual(scan(h), []);
  const v = (h.match(/\/components\/rain-box\.js\?v=(\d+)/) || [])[1];
  assert.ok(v, "versioned script");
  assert.match(read("scripts/build_county_rain.py"), new RegExp(`/components/rain-box\\.js\\?v=${v}"`), "the same version on the county pages");
  assert.doesNotMatch(h + read("components/rain-box.js"), /—/, "no em dash");
});

test("developer page lists the rain box with both snippets", () => {
  const h = read("developer.html");
  assert.match(h, /<div class="widget-card" id="rain">/);
  assert.ok(h.includes("https://agsist.com/embed/rain?st=ia&amp;c=19169"));
  assert.ok(h.includes('&lt;div data-agsist-widget="rain" data-st="ia" data-c="19169"&gt;&lt;/div&gt;'));
  assert.match(h, /Three are live: the GDU calculator, the ARC or PLC calculator and the county rain box\./);
});

// ---- in a browser: the embed and the fold, on the fixture site
function serve() {
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };
  const roots = [join(TMP, "site"), ROOT];
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index";
    if (!extname(p)) p += ".html";
    // the rain data is the fixture data, never the live files
    const cands = p.startsWith("/data/rain/") ? [normalize(join(TMP, "data", p.slice(11)))] : roots.map((r) => normalize(join(r, p)));
    const f = cands.find((c) => existsSync(c) && !statSync(c).isDirectory() && (c.startsWith(TMP) || c.startsWith(ROOT)));
    if (!f) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}
const SHOTS = process.env.RAINBOX_SHOTS || "";

test("browser: the embed shows the page's line and links the county page; the fold fills on open", { skip }, async () => {
  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const story = Object.entries(FX).find(([, x]) => x.rel === "rain/iowa/story-county.html");
    const nopct = Object.entries(FX).find(([f, x]) => fdata(x.st).counties[f].pct === null);
    const done = Object.entries(FX).find(([, x]) => /-12-31$/.test(fdata(x.st).edate));
    for (const width of [390, 1280]) {
      const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width, height: 800 }, permissions: ["clipboard-read", "clipboard-write"] });
      const page = await ctx.newPage();
      const errs = [];
      page.on("pageerror", (e) => errs.push(String(e)));
      for (const [f, x] of [story, nopct, done]) {
        await page.goto(`${base}/embed/rain?st=${x.st.toLowerCase()}&c=${f}`);
        await page.waitForFunction(() => document.getElementById("ln").textContent.includes(" in of rain"));
        const got = await page.evaluate(() => ({ t: document.getElementById("ln").textContent, src: document.getElementById("src").textContent,
          a: document.querySelector("#ln a").getAttribute("href"), canon: document.getElementById("canon").href,
          over: document.documentElement.scrollWidth > document.documentElement.clientWidth }));
        assert.equal(got.t, x.line + " AGSIST", f);
        assert.equal(got.a, `https://agsist.com/${x.rel.replace(/\.html$/, "")}?utm_source=embed`);
        assert.equal(got.canon, `https://agsist.com/${x.rel.replace(/\.html$/, "")}`);
        assert.equal(got.src, fdata(x.st).counties[f].station.net === "cocorahs" ? "NOAA daily records, CoCoRaHS volunteer gauge" : "NOAA daily records");
        assert.ok(!got.over, "no sideways scroll");
        if (SHOTS && f === story[0]) await page.locator("#w").screenshot({ path: join(SHOTS, `embed-${width}.png`) });
      }
      // a county with no page, or a bad address: a plain link to the rain pages, no number
      for (const q of ["st=ia&c=99999", "st=zz&c=19169", "st=ia&c=1916"]) {
        await page.goto(`${base}/embed/rain?${q}`);
        await page.waitForTimeout(150);
        const t = await page.locator("#ln").textContent();
        assert.equal(t.trim(), "Rain by county from AGSIST", q);
      }
      // the county page fold
      await page.goto(`${base}/${story[1].rel.replace(/\.html$/, "")}`);
      const fold = page.locator("details.rc-emb");
      assert.equal(await fold.getAttribute("open"), null, "closed");
      await fold.locator("summary").click();
      await page.waitForSelector("details.rc-emb code");
      const code = await fold.locator("code").textContent();
      assert.equal(code, B.code("IA", story[0], "Story County"));
      assert.equal(await fold.locator("button").count(), 2, "two copy buttons");
      // the copy buttons copy exactly the code and the page's sentence (the label in front of it is not copied)
      const sent = unent(fpage(story[1].rel).match(/<p class="rc-fine rc-emb-s">([^<]*)<\/p>/)[1]);
      await fold.locator("button").nth(1).click();
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), sent);
      await fold.locator("button").nth(0).click();
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), code);
      assert.match(await fold.locator(".rc-emb-s").textContent(), /^In words, for a newsletter, paper or radio: /);
      const box = await fold.boundingBox();
      assert.ok(box.width <= width, "fits the screen");
      const over = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      assert.ok(!over, "no sideways scroll at " + width);
      if (SHOTS) { await fold.scrollIntoViewIfNeeded(); await fold.screenshot({ path: join(SHOTS, `fold-${width}.png`) }); }
      assert.deepEqual(errs, []);
      await ctx.close();
    }
  } finally {
    await browser.close();
    srv.close();
  }
});

if (SHOTS) { try { mkdirSync(SHOTS, { recursive: true }); writeFileSync(join(SHOTS, ".keep"), ""); } catch (e) { /* shots are optional */ } }
