/* The monthly newsletter block (Nov 2, 2026; /newsletter-block,
 * scripts/build_newsletter_block.py, components/newsletter-block.js).
 *   - the builder's selftest, with the real Barbour County AL October 2026
 *     (21 of 31 days: inches, no percent);
 *   - every number in the block equals its source file (data/rain/<st>.json,
 *     data/basis-states.json), for Barbour AL and Story IA, built fresh;
 *   - no link to a data source, no em dash, the page is one shared noindex page;
 *   - in Chromium at 390 and 1280: the block, the copy buttons and the image.
 *
 *   node --test test/newsletter-block.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const py = (args) => execFileSync("python3", args, { cwd: ROOT, encoding: "utf8", timeout: 180000 });
const DASH = /[–—]|&mdash;|&ndash;/;
const MON = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

test("the builder's selftest: the real Barbour October, floors, basis words", () => {
  const out = py(["scripts/build_newsletter_block.py", "--selftest"]);
  assert.match(out, /OK: 0 failure\(s\)/);
  assert.ok(out.includes("ok   Barbour Oct 2026: the inches, the days, no percent"));
});

let built = null;
function build() {
  if (built) return built;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "newsblock-"));
  py(["scripts/build_newsletter_block.py", "--out", tmp]);
  built = (rel) => JSON.parse(fs.readFileSync(path.join(tmp, rel), "utf8"));
  return built;
}

const pct = (t, u) => Math.round((100 * t) / u);
const in2 = (x) => x.toFixed(2);

test("every number equals its source file: Barbour County AL and Story County IA", () => {
  const B = build();
  const bs = JSON.parse(read("data/basis-states.json"));
  // Live data (build rule 70): a county can drop out of the rain file on a day its stations miss the reporting rule
  // (Barbour AL did on Nov 5). Use the named county when it is published, else the state's first published county.
  const pick = (st, fips, slug) => {
    const rain = JSON.parse(read(`data/rain/${st}.json`));
    if (rain.counties[fips]) return [st, fips, slug];
    const f = Object.keys(rain.counties).sort()[0];
    const s2 = slug.split("/")[0] + "/" + rain.counties[f].name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return [st, f, s2];
  };
  for (const [st, fips, slug] of [pick("al", "01005", "alabama/barbour-county"), pick("ia", "19169", "iowa/story-county")]) {
    const rain = JSON.parse(read(`data/rain/${st}.json`));
    const s = B(`data/newsletter/${st}.json`);
    const c = rain.counties[fips], b = s.counties[fips];
    assert.ok(b, fips + " has a block");
    const m = s.month - 1;
    const [t, u, rep, days] = c.months[m];
    assert.ok(b.head.startsWith(`${MON[m]} rain, ${c.name}, ${st.toUpperCase()}: ${in2(t)} in`), b.head);
    if (rep < 0.9 * days) {
      assert.ok(!b.head.includes("%") && b.n.pct === null, fips + ": under 90% of days, no percent: " + b.head);
      assert.ok(b.head.includes(`(${rep} of ${days} days reported, too few for a percent of usual)`), b.head);
    } else if (u !== null && u >= 1) {
      assert.ok(b.head.includes(`, ${pct(t, u)}% of usual`), b.head);
    }
    const ytd = c.months.slice(0, m + 1);
    const yt = Math.round(ytd.reduce((a, r) => a + r[0], 0) * 100) / 100;
    const yu = Math.round(ytd.reduce((a, r) => a + r[1], 0) * 100) / 100;
    const yrep = ytd.reduce((a, r) => a + r[2], 0), ydays = ytd.reduce((a, r) => a + r[3], 0);
    assert.ok(b.ytd.startsWith(`Year to date, Jan 1 to ${MON[m].slice(0, 3)} `), b.ytd);
    assert.ok(b.ytd.includes(`: ${in2(yt)} in`), b.ytd + " vs " + yt);
    if (yrep >= 0.9 * ydays && yu >= 1) assert.ok(b.ytd.endsWith(`, ${pct(yt, yu)}% of usual`), b.ytd);
    else assert.ok(!b.ytd.includes("%"), b.ytd);
    assert.ok(b.stn.includes(c.station.net === "cocorahs" ? "volunteer rain gauge" : "weather station"), b.stn);
    assert.equal(b.url, `https://agsist.com/rain/${slug}`);
    assert.ok(fs.existsSync(path.join(ROOT, `rain/${slug}.html`)), "the credit link is a real page: " + slug);
    assert.ok(b.src.startsWith(`Source: AGSIST, agsist.com/rain/${slug}, data as of `), b.src);
    // basis: the state's middles, as the file has them
    const sb = (bs.states[st.toUpperCase()] || {}).crops || {};
    for (const [key, word] of [["corn", "corn"], ["soybeans", "soybean"]]) {
      const x = sb[key] || {};
      const line = s.basis.find((l) => l.includes(` ${word} bids, `));
      if (x.median === undefined || x.median === null) {
        assert.ok(!line, `${st} ${key}: no middle in the file, no line`);
        assert.ok(s.basis.some((l) => l.startsWith("Too few ") && l.includes(word)), `${st} ${key}: withheld, said so`);
        continue;
      }
      // the builder writes quarter cents as glyphs (72.5 -> "72½"), like the rest of the site
      const a = Math.round(Math.abs(x.median) * 100 * 100) / 100, q = a * 4;
      const cents = Number.isInteger(q) ? ((Math.floor(q / 4) || !(q % 4) ? String(Math.floor(q / 4)) : "") + ["", "¼", "½", "¾"][q % 4]) : String(a);
      assert.ok(line && line.includes(`middle basis ${cents} cent`) && line.includes(x.median > 0 ? " over " : " under ")
        && line.includes(`${x.label} futures, ${x.n} elevator bids, ${x.companies} compan`), `${st} ${key}: ${line}`);
    }
    assert.equal(s.basis_generated, bs.generated, "dated by the basis file");
  }
});

test("no data-source links, no em dashes, only our own pages linked", () => {
  const files = fs.readdirSync(path.join(ROOT, "data/newsletter")).filter((f) => f.endsWith(".json"));
  assert.ok(files.length >= 40 && files.includes("index.json"), "the committed files");
  const urls = new Set(["https://agsist.com/daily"]);
  for (const f of files) {
    const txt = read("data/newsletter/" + f);
    assert.ok(!DASH.test(txt), f + " has an em or en dash");
    for (const m of txt.matchAll(/"url":"([^"]+)"/g)) urls.add(m[1]);
  }
  for (const f of files.filter((f) => f !== "index.json")) {
    const d = JSON.parse(read("data/newsletter/" + f));
    assert.equal(d.utm, "utm_source=newsletter&utm_medium=paste", f + ": the paste tag (lead, Nov 2)");
    for (const line of [d.daily, ...d.basis, ...Object.values(d.counties).flatMap((b) => [b.head, b.ytd, b.stn, b.src, b.url])])
      assert.ok(!line.includes("utm_"), f + ": words and the clean url never carry the tag: " + line);
    for (const b of Object.values(d.counties)) urls.add(b.url + "?" + d.utm);
  }
  urls.add("https://agsist.com/daily?utm_source=newsletter&utm_medium=paste");
  const js = read("components/newsletter-block.js");
  assert.ok(!DASH.test(js.split("\n").filter((l) => !/^\s*(\/\/|\/?\*)/.test(l)).join("\n")), "no dash in the page script's copy");
  for (const m of js.matchAll(/https?:\/\/[^"'\s)]+/g)) urls.add(m[0]);
  const list = [...urls];
  for (const u of list) assert.match(u, /^https:\/\/agsist\.com\//, "only our own pages: " + u);
  const res = JSON.parse(execFileSync("python3", ["-c", "import sys,json;sys.path.insert(0,'scripts');import source_links as S;print(json.dumps([S.is_data_source(u) for u in json.load(sys.stdin)]))"],
    { cwd: ROOT, encoding: "utf8", input: JSON.stringify(list) }));
  assert.equal(res.length, list.length);
  assert.ok(res.every((x) => x === false), "source_links.is_data_source is False for every link");
});

test("one shared noindex page, not in a sitemap, script versioned", () => {
  const h = read("newsletter-block.html");
  assert.match(h, /<meta name="robots" content="noindex, follow">/);
  assert.match(h, /<link rel="canonical" href="https:\/\/agsist\.com\/newsletter-block">/);
  assert.match(h, /<script src="\/components\/newsletter-block\.js\?v=\d+" defer><\/script>/);
  assert.ok(!DASH.test(h), "no em dash on the page");
  for (const f of fs.readdirSync(ROOT).filter((f) => /^sitemap.*\.xml$/.test(f))) assert.ok(!read(f).includes("newsletter-block"), f);
  assert.ok(Buffer.byteLength(h) < 150 * 1024);
});

// ---------------------------------------------------------------- in a browser
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (fs.existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !fs.existsSync(CHROME) ? "Playwright or Chromium not found here" : false;
function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/newsletter-block") p += ".html";
    const f = path.normalize(path.join(ROOT, p));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" });
    res.end(fs.readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

test("in Chromium at 390 and 1280: the block from the link, copy buttons, the image, no sideways scroll", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const al = JSON.parse(read("data/newsletter/al.json")).counties["01005"];
    for (const width of [390, 1280]) {
      const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width, height: 900 } });
      await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: `http://127.0.0.1:${port}` });
      const pg = await ctx.newPage();
      const errs = [];
      pg.on("pageerror", (e) => errs.push(String(e)));
      await pg.route("**/*", (r) => (r.request().url().startsWith(`http://127.0.0.1:${port}`) ? r.continue() : r.abort()));
      await pg.goto(`http://127.0.0.1:${port}/newsletter-block?c=01005`, { waitUntil: "load" });
      await pg.waitForSelector("#nlb-out table", { timeout: 15000 });
      await pg.waitForFunction(() => !document.getElementById("nlb-img").hidden, null, { timeout: 15000 });
      const r = await pg.evaluate(() => ({
        st: document.getElementById("nlb-st").value, c: document.getElementById("nlb-c").value,
        text: document.getElementById("nlb-out").innerText, sw: document.documentElement.scrollWidth,
        dis: ["nlb-txt", "nlb-rich", "nlb-code"].map((i) => document.getElementById(i).disabled),
        png: document.getElementById("nlb-png").getAttribute("download"),
        img: [document.getElementById("nlb-img").naturalWidth, document.getElementById("nlb-img").naturalHeight],
        tall: ["nlb-txt", "nlb-rich", "nlb-code", "nlb-png"].map((i) => document.getElementById(i).getBoundingClientRect().height),
      }));
      assert.equal(r.st, "AL"); assert.equal(r.c, "01005");
      for (const line of [al.head, al.ytd, "Get this every morning: agsist.com/daily", al.src]) assert.ok(r.text.includes(line), width + ": " + line);
      assert.ok(r.sw <= width, `${width}: no sideways scroll (${r.sw})`);
      assert.deepEqual(r.dis, [false, false, false]);
      assert.equal(r.png, "agsist-al-barbour-county-2026-10.png".replace("2026-10", `${JSON.parse(read("data/newsletter/al.json")).year}-${String(JSON.parse(read("data/newsletter/al.json")).month).padStart(2, "0")}`));
      assert.deepEqual(r.img, [1200, 630]);
      assert.ok(r.tall.every((h) => h >= 40 && h < 60), width + ": one line per button " + r.tall);
      // links in the HTML carry the paste tag; the plain text and the shown words do not
      const hrefs = await pg.$$eval("#nlb-out a", (as) => as.map((a) => a.getAttribute("href")));
      assert.deepEqual(hrefs, ["https://agsist.com/daily?utm_source=newsletter&utm_medium=paste",
        "https://agsist.com/rain/alabama/barbour-county?utm_source=newsletter&utm_medium=paste"]);
      assert.ok(!r.text.includes("utm_"), "the shown words are clean");
      await pg.click("#nlb-txt");
      await pg.waitForFunction(() => /Copied/.test(document.getElementById("nlb-msg").textContent));
      const txt = await pg.evaluate(() => navigator.clipboard.readText());
      assert.ok(txt.includes("Get this every morning: agsist.com/daily\n") && txt.includes(al.src) && !txt.includes("utm_"), "plain text: clean short addresses");
      await pg.click("#nlb-code");
      await pg.waitForFunction(() => /HTML code copied/.test(document.getElementById("nlb-msg").textContent));
      const code = await pg.evaluate(() => navigator.clipboard.readText());
      assert.ok(code.startsWith("<table") && code.includes('href="https://agsist.com/daily?utm_source=newsletter&amp;utm_medium=paste"'), "HTML code: tagged links");
      assert.ok(code.includes(">agsist.com/daily</a>") && code.includes(">agsist.com/rain/alabama/barbour-county</a>"), "HTML code: the link text stays clean");
      assert.deepEqual(errs, []);
      await ctx.close();
    }
  } finally {
    await browser.close();
    srv.close();
  }
});
