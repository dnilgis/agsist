/* The Daily's top stories on the web (Nov 2): since PR #237 each story in
 * outside_the_pit carries the publisher's link and the source name, and the email
 * shows them. /daily (daily.html) and the home page Daily card (components/home.js)
 * now draw each title as a link (rel="noopener nofollow") with the source in small
 * type, the same as the archive pages (generate_daily.render_outside_the_pit_html).
 * The link test in both pages is held equal to generate_daily.safe_story_link.
 * The browser cases read test/fixtures/daily/2026-10-21-top-stories.json plus one
 * hostile story, at 390 and 1280 (need Playwright and Chromium; skipped without).
 *   node --test test/daily-story-links.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const FIX = JSON.parse(read("test/fixtures/daily/2026-10-21-top-stories.json"));

const URLS = [
  "https://www.dtnpf.com/x", "http://www.dtnpf.com/x", "https://agsist-api.dnilgis.workers.dev/x",
  "https://user@evil.com/x", "https://x.com/a b", "javascript:alert(1)", "https://dnilgis.github.io/a",
  "https://news.google.com/rss/articles/CBMiabc?oc=5", "HTTPS://WWW.AGWEB.COM/A", "https://pages.dev/x",
  "https://notpages.dev/x", "", " https://www.agweb.com/a ", "https://www.agweb.com/a?x=1&y=2\"><b>",
  "https://" + "a".repeat(800), "data:text/html,hi", "//www.agweb.com/x",
];

/* the storyLink function out of a page's source, run on its own */
function storyLinkFrom(src) {
  const i = src.indexOf("function storyLink(u){");
  assert.ok(i >= 0, "storyLink is defined");
  let depth = 0, j = src.indexOf("{", i);
  for (; j < src.length; j++) { if (src[j] === "{") depth++; else if (src[j] === "}" && --depth === 0) break; }
  const ctx = { URL };
  vm.runInNewContext(src.slice(i, j + 1) + ";this.f=storyLink;", ctx);
  return ctx.f;
}

test("the page link test matches generate_daily.safe_story_link on every case", () => {
  const want = JSON.parse(execFileSync("python3", ["-c", `
import sys,json;sys.path.insert(0,'scripts')
import generate_daily as g
print(json.dumps([g.safe_story_link(u) for u in json.load(sys.stdin)]))`], { cwd: ROOT, encoding: "utf8", input: JSON.stringify(URLS) }));
  for (const f of ["daily.html", "components/home.js"]) {
    const fn = storyLinkFrom(read(f));
    URLS.forEach((u, k) => assert.equal(fn(u), want[k], `${f}: storyLink(${JSON.stringify(u)})`));
  }
});

test("both pages say why these links are allowed (news, not data sources) and bump home.js", () => {
  for (const f of ["daily.html", "components/home.js"]) {
    assert.match(read(f), /not links\s+to\s+a\s+data\s+source/, `${f} carries the Oct 29 rule note`);
    assert.match(read(f), /rel="noopener nofollow"/);
  }
  const idx = read("index.html");
  assert.match(idx, /<script src="\/components\/home\.js\?v=\d+"><\/script>/); // test/one-more.test.mjs owns the exact version
  // v29 carried these styles; a later bump (fx/homejobs took v31) still serves them
  const css = /<link rel="stylesheet" href="\/css\/home\.css\?v=(\d+)">/.exec(idx);
  assert.ok(css && +css[1] >= 29, `home.css is v29 or later (${css && css[1]})`);
  assert.match(read("css/home.css"), /\.daily-otp-src\{/);
  assert.match(read("daily.html"), /\.dv3-otp-src\{/);
});

/* the fixture's five stories, plus one with a bad link and markup everywhere */
const HOSTILE = { title: "Bad <img src=x onerror=alert(1)> story", body: "Body <script>x</script>", tag: "POLICY",
  link: "javascript:alert(1)", source: "Evil <b>Co</b>" };
const DATA = { ...FIX, outside_the_pit: [...FIX.outside_the_pit, HOSTILE] };

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    let f = normalize(join(ROOT, p));
    if (f.endsWith("/")) f += "index.html";
    if ((!existsSync(f) || statSync(f).isDirectory()) && existsSync(f + ".html")) f += ".html";
    if (!f.startsWith(ROOT) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

async function check(path, sel) {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const width of [390, 1280]) {
      const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width, height: 900 } });
      const pg = await ctx.newPage();
      let alerted = false;
      pg.on("dialog", (d) => { alerted = true; d.dismiss(); });
      await pg.route((u) => !u.href.startsWith(`http://127.0.0.1:${port}`), (r) => r.abort());
      await pg.route((u) => u.pathname === "/data/daily.json", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(DATA) }));
      await pg.clock.setFixedTime(new Date("2026-10-21T14:00:00Z"));
      await pg.goto(`http://127.0.0.1:${port}${path}`, { waitUntil: "load" });
      await pg.waitForFunction((s) => document.querySelectorAll(s + "-item").length >= 6, sel, { timeout: 20000 });
      /* the home card opens folded; its stories show after "Read today's full briefing" */
      await pg.evaluate(() => { const b = document.querySelector("[data-daily-more]"); if (b) b.click(); });
      const items = await pg.$$eval(sel + "-item", (els, s) => els.map((e) => {
        const a = e.querySelector(s + "-title a"), src = e.querySelector(s + "-src");
        return { title: e.querySelector(s + "-title")?.textContent, href: a ? a.getAttribute("href") : null, rel: a ? a.getAttribute("rel") : null,
          src: src ? src.textContent : null, srcSize: src ? parseFloat(getComputedStyle(src).fontSize) : 0,
          bodySize: parseFloat(getComputedStyle(e.querySelector(s + "-body")).fontSize),
          imgs: e.querySelectorAll("img,script,b").length, visible: e.getBoundingClientRect().height > 0 };
      }), sel);
      assert.equal(items.length, 6, `${path} @${width}: six stories`);
      FIX.outside_the_pit.forEach((st, k) => {
        const it = items[k];
        assert.equal(it.title, st.title, `${path} @${width}: story ${k} title`);
        assert.equal(it.href, st.link, `${path} @${width}: story ${k} links to its publisher`);
        assert.equal(it.rel, "noopener nofollow", `${path} @${width}: story ${k} rel`);
        assert.equal(it.src, "Source: " + st.source, `${path} @${width}: story ${k} names its source`);
        assert.ok(it.srcSize > 0 && it.srcSize < it.bodySize, `${path} @${width}: the source is in small type (${it.srcSize} < ${it.bodySize})`);
        assert.ok(it.visible, `${path} @${width}: story ${k} shows`);
      });
      const bad = items[5];
      assert.equal(bad.href, null, `${path} @${width}: a javascript: link is never drawn`);
      assert.equal(bad.title, HOSTILE.title, `${path} @${width}: the hostile title shows as text`);
      assert.equal(bad.src, "Source: Evil <b>Co</b>", `${path} @${width}: the source is escaped`);
      assert.equal(bad.imgs, 0, `${path} @${width}: no markup from the data`);
      assert.equal(alerted, false, `${path} @${width}: nothing ran`);
      const hs = await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(hs <= 0, `${path} @${width}: no sideways scroll (${hs}px)`);
      await ctx.close();
    }
  } finally { await browser.close(); srv.close(); }
}

test("/daily: every top story title links to its publisher, with the source in small type", { skip, timeout: 120000 }, () => check("/daily", ".dv3-otp"));
test("home page Daily card: the same links and sources", { skip, timeout: 120000 }, () => check("/", ".daily-otp"));
