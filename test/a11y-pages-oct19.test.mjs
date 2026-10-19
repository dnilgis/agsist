/* a11y audit 2026-10-19, items read from the real pages.
 *
 * 8. /cash-bid-index: the "Show all states" checkboxes (.cbi-mt) had a label
 *    that is display:none above 600px and after ticking, so on a desktop they
 *    were invisible, nameless Tab stops. The two sideways tables (.cbi-tw) and
 *    /spray's rain-free table (.rfp-table-wrap) could not be reached by
 *    keyboard. The checkbox now carries its own aria-label and is not drawn
 *    over 600px, where it does nothing; each scroller is tabindex=0,
 *    role=region with a name. The page is built by scripts/cash_bid_index.py.
 *
 * 9. A zero change was green "up": "(0.00%)" on /corn-futures-prices. Three
 *    percent chips in components/futures.js (corn new crop; beans new crop and
 *    the corn line on the soybean page) and their three seeds in
 *    scripts/seed_static.py now print "(unch)", class nc, when the move rounds
 *    to no quarter cent, as the hero does. Twins: pctChip / _pct_chip.
 *
 *   node --test test/a11y-pages-oct19.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { extname, join, normalize } from "node:path";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

/* ---------- 9: the twins agree, case by case ---------- */
const CASES = [
  [{ netChange: 0, pctChange: 0 }, ["(unch)", "nc"]],
  [{ netChange: 0.1, pctChange: 0.008 }, ["(unch)", "nc"]],          // under an eighth of a cent: no quarter
  [{ netChange: -0.1, pctChange: -0.008 }, ["(unch)", "nc"]],
  [{ netChange: 0.25, pctChange: 0.0493 }, ["(+0.05%)", "up"]],      // corn Dec '27, Oct 19
  [{ netChange: -0.75, pctChange: -0.1581 }, ["(−0.16%)", "dn"]],
  [{ pctChange: 0 }, ["(unch)", "nc"]],                               // no net change: the percent decides
  [{ pctChange: 0.004 }, ["(unch)", "nc"]],
  [{ pctChange: 0.12 }, ["(+0.12%)", "up"]],
  [{ pctChange: -0.3 }, ["(−0.30%)", "dn"]],
];
function jsChip() {
  const fut = read("components/futures.js");
  const i = fut.indexOf("function pctChip(q){");
  assert.ok(i > 0, "components/futures.js no longer defines pctChip");
  let d = 0, j = fut.indexOf("{", i);
  for (; j < fut.length; j++) { if (fut[j] === "{") d++; else if (fut[j] === "}" && --d === 0) break; }
  const win = {};
  const ctx = { window: win, document: { addEventListener() {}, readyState: "complete" }, console, Number, Math, String };
  vm.createContext(ctx);
  try { vm.runInContext(read("components/util.js"), ctx); } catch (e) { /* util.js may touch the DOM after defining AG */ }
  ctx.AG = win.AG || ctx.AG;
  assert.ok(ctx.AG && ctx.AG.px, "AG.px from components/util.js");
  vm.runInContext(fut.slice(i, j + 1), ctx);
  return (q) => { const r = ctx.pctChip(q); return [r.t, r.c]; };
}

test("pctChip (futures.js) and _pct_chip (seed_static.py) give the same chip, zero is unch", () => {
  const js = jsChip();
  const py = JSON.parse(execFileSync("python3", ["-c",
    "import sys,json; sys.path.insert(0,'scripts'); import seed_static as s; " +
    "print(json.dumps([list(s._pct_chip(q)) for q in json.loads(sys.argv[1])]))", JSON.stringify(CASES.map((c) => c[0]))],
    { cwd: ROOT, encoding: "utf8" }));
  CASES.forEach(([q, want], k) => {
    assert.deepEqual(js(q), want, `futures.js ${JSON.stringify(q)}`);
    assert.deepEqual(py[k], want, `seed_static.py ${JSON.stringify(q)}`);
  });
});

test("every percent chip writer goes through the helper, in both copies", () => {
  const fut = read("components/futures.js"), seed = read("scripts/seed_static.py");
  assert.equal((fut.match(/pctChip\((cornDec|ncQ|cq)\)/g) || []).length, 3, "the 3 chips in futures.js");
  assert.doesNotMatch(fut, /pctChange>=0\?'up':'dn'|\(np>=0\?'up':'dn'\)|\(netChange\|\|0\)>=0\?'up'/, "a >=0 'up' chip is back in futures.js");
  assert.equal((seed.match(/= _pct_chip\((cd|nq|cq)\)/g) || []).length, 3, "the 3 seeds in seed_static.py");
  assert.doesNotMatch(seed, /\("up" if (np_|cp|net) >= 0 else "dn"\)/, "a >= 0 'up' seed is back in seed_static.py");
});

/* ---------- browser ---------- */
function serve(prices) {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/data/prices.json" && prices) { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(prices)); return; }
    if (p === "/") p = "/index.html"; else if (!extname(p)) p += ".html";
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}
async function page(browser, port, path, width, theme = "dark") {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width, height: 900 } });
  await ctx.addInitScript((t) => { try { localStorage.setItem("agsist-theme", t); } catch (e) {} }, theme);
  await ctx.route("**/*", (r) => r.request().url().startsWith(`http://127.0.0.1:${port}`) ? r.continue() : r.abort());
  const pg = await ctx.newPage();
  await pg.goto(`http://127.0.0.1:${port}${path}`, { waitUntil: "load" });
  return { ctx, pg };
}

test("zero change on the real corn and soybean pages: (unch), not green", { skip, timeout: 120000 }, async () => {
  const prices = JSON.parse(read("data/prices.json"));
  /* the day's quotes, with the new-crop contracts and the corn nearby flat */
  const Q = prices.quotes;
  assert.ok(Q && Q["corn-dec27"] && Q["beans-nov27"] && Q["corn-nearby"], "data/prices.json quotes moved");
  for (const k of Object.keys(Q)) {
    if (/^corn-dec2[7-9]$|^corn(-nearby)?$|^corn-dec$|^corn-dec26$/.test(k)) Object.assign(Q[k], { netChange: 0, pctChange: 0 });
    if (/^beans-nov2[7-9]$/.test(k)) Object.assign(Q[k], { netChange: 0.1, pctChange: 0.008 });
  }
  const srv = await serve(prices), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const theme of ["dark", "light"]) {
      const c = await page(browser, port, "/corn-futures-prices", 390, theme);
      await c.pg.waitForFunction(() => { const e = document.getElementById("nc-glance"); return e && e.style.display === "block"; }, null, { timeout: 30000 });
      const nc = await c.pg.evaluate(() => { const e = document.getElementById("nc-chg"), g = document.getElementById("nc-glance");
        return { t: e.textContent, c: e.className, color: getComputedStyle(e).color, green: getComputedStyle(document.documentElement).getPropertyValue("--green").trim(), base: getComputedStyle(g).color }; });
      assert.equal(nc.t, "(unch)", `corn new-crop chip (${theme})`);
      assert.equal(nc.c, "nc");
      assert.equal(nc.color, nc.base, `a flat chip takes the line's own color, not green (${theme})`);
      await c.ctx.close();
      const s = await page(browser, port, "/soybean-futures-prices", 390, theme);
      await s.pg.waitForFunction(() => /unch|%/.test((document.getElementById("corn-line") || {}).textContent || "") && /new crop/.test((document.getElementById("nc-line") || {}).textContent || ""), null, { timeout: 30000 });
      const chips = await s.pg.evaluate(() => ["nc-line", "corn-line"].map((id) => { const sp = document.querySelector(`#${id} > span`); return [id, sp && sp.textContent, sp && sp.className]; }));
      for (const [id, t, cls] of chips) { assert.equal(t, "(unch)", `${id} (${theme})`); assert.equal(cls, "nc", id); }
      await s.ctx.close();
    }
  } finally { await browser.close(); srv.close(); }
});

test("cash-bid-index and spray: every checkbox is named, every sideways scroller takes focus", { skip, timeout: 180000 }, async () => {
  /* the page on disk is what the builder writes */
  execFileSync("python3", ["scripts/cash_bid_index.py", "--check"], { cwd: ROOT, stdio: "pipe" });
  const srv = await serve(null), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  const audit = () => {
    const name = (el) => (el.getAttribute("aria-label") || "").trim() ||
      [...(el.labels || [])].filter((l) => getComputedStyle(l).display !== "none").map((l) => l.textContent.trim()).join(" ");
    const boxes = [...document.querySelectorAll('input[type="checkbox"]')].filter((el) => getComputedStyle(el).display !== "none" && el.tabIndex >= 0)
      .map((el) => ({ id: el.id, name: name(el) }));
    const scrollers = [...document.querySelectorAll("main *, #main *")].filter((el) => {
      const cs = getComputedStyle(el);
      return /auto|scroll/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1 && el.clientHeight > 0 && el.tagName !== "PRE";
    }).map((el) => ({ cls: el.className, focusable: el.tabIndex >= 0 || !!el.querySelector("a[href],button,input,select,textarea,[tabindex]:not([tabindex='-1'])"),
      role: el.getAttribute("role"), label: el.getAttribute("aria-label") }));
    return { boxes, scrollers, cbiTw: document.querySelectorAll(".cbi-tw").length, cbiMt: document.querySelectorAll(".cbi-mt").length };
  };
  try {
    for (const w of [390, 640, 1280]) {
      const { ctx, pg } = await page(browser, port, "/cash-bid-index", w);
      await pg.waitForTimeout(400);
      const a = await pg.evaluate(audit);
      assert.ok(a.cbiTw >= 2 && a.cbiMt >= 2, `the page still has its tables and toggles (${a.cbiTw}, ${a.cbiMt})`);
      for (const b of a.boxes) assert.match(b.name, /^Show all states \(\d+ more\)$/, `${w}px: checkbox ${b.id} has no name`);
      if (w > 600) assert.equal(a.boxes.filter((b) => /^cbi-mt/.test(b.id)).length, 0, `${w}px: the toggle does nothing here and is not a Tab stop`);
      if (w <= 600) {
        assert.ok(a.boxes.length >= 2, "on a phone the toggles are there");
        await pg.focus(".cbi-mt");
        await pg.keyboard.press("Space");
        const after = await pg.evaluate(audit);
        for (const b of after.boxes) assert.ok(b.name, `ticked on a phone, checkbox ${b.id} is still named`);
      }
      for (const s of a.scrollers) {
        assert.ok(s.focusable, `${w}px: .${s.cls} scrolls sideways and the keyboard cannot reach it`);
        if (/cbi-tw/.test(s.cls)) { assert.equal(s.role, "region"); assert.ok(s.label, "named region"); }
      }
      if (w >= 640) assert.ok(a.scrollers.some((s) => /cbi-tw/.test(s.cls)), `${w}px: expected the state tables to scroll sideways here`);
      await ctx.close();
    }
    for (const w of [390, 1280]) {
      const { ctx, pg } = await page(browser, port, "/spray", w);
      await pg.waitForTimeout(800);
      const a = await pg.evaluate(audit);
      const rfp = await pg.evaluate(() => { const e = document.querySelector(".rfp-table-wrap"); return e && [e.tabIndex, e.getAttribute("role"), e.getAttribute("aria-label")]; });
      assert.deepEqual(rfp && rfp.slice(0, 2), [0, "region"], "the rain-free table takes focus");
      assert.ok(rfp[2], "and has a name");
      for (const s of a.scrollers) assert.ok(s.focusable, `/spray ${w}px: .${s.cls} scrolls sideways and the keyboard cannot reach it`);
      await ctx.close();
    }
  } finally { await browser.close(); srv.close(); }
});
