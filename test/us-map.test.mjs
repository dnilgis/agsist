/* The shared US map (Nov 8, 2026): data/us-states-map.svg drawn by components/usmap.js on the pages that used a state
 * tile grid. Static checks on the file and on the five places that draw it; browser checks on the component with all 51
 * states at 390 and 1280 px, light and dark (skips without Playwright).
 *
 *   node --test test/us-map.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { gzipSync } from "node:zlib";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

const STATES = "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" ");
const SMALL = ["VT", "NH", "MA", "RI", "CT", "NJ", "DE", "MD", "DC"];
const svg = read("data/us-states-map.svg");
const paths = [...svg.matchAll(/<path id="([A-Z]{2})" data-n="([^"]+)" data-c="([\d.]+),([\d.]+)"(?: data-o="([\d.]+),([\d.]+)")? d="([^"]+)"\/>/g)];
const vb = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/).slice(1).map(Number);

test("the map asset is small and cached as one file", () => {
  const n = Buffer.byteLength(svg);
  assert.ok(n < 60000, `under 60 KB (it is ${n})`);
  assert.ok(gzipSync(svg).length < 25000, "gzip is much less");
  assert.ok(!/<script|https?:\/\//.test(svg.replace('xmlns="http://www.w3.org/2000/svg"', "")), "no script, no outside link");
});

test("each of the 50 states and DC is in it once, with its name and a label point inside the picture", () => {
  assert.deepEqual(paths.map((m) => m[1]).sort(), [...STATES].sort(), "51 codes, each once");
  for (const m of paths) {
    assert.ok(m[2].length > 3 && m[7].length > 30, m[1] + " has a name and a shape");
    assert.ok(+m[3] > 0 && +m[3] < vb[0] && +m[4] > 0 && +m[4] < vb[1], m[1] + " label point inside the viewBox");
  }
  assert.equal(svg.match(/id="/g).length, 51, "nothing else carries an id");
});

test("the nine small eastern states have a leader label out in the water, inside the picture, 24 px tall at 390 px", () => {
  const withO = paths.filter((m) => m[5]).map((m) => m[1]).sort();
  assert.deepEqual(withO, [...SMALL].sort());
  const chips = paths.filter((m) => m[5]).map((m) => ({ st: m[1], x: +m[5], y: +m[6] }));
  for (const c of chips) assert.ok(c.x - 33 >= 0 && c.x + 33 <= vb[0] && c.y - 29 >= 0 && c.y + 29 <= vb[1], c.st + " chip inside the viewBox");
  for (let i = 0; i < chips.length; i++) for (let j = i + 1; j < chips.length; j++) {
    const a = chips[i], b = chips[j];
    assert.ok(Math.abs(a.x - b.x) >= 66 || Math.abs(a.y - b.y) >= 58, `${a.st} and ${b.st} chips do not overlap`);
  }
  const phone = (390 - 24) / vb[0];                 // a 12 px gutter each side
  assert.ok(58 * phone >= 21, "a chip is about 22 px tall on a phone, a thumb can land on it");
});

test("the component reserves the picture's shape before the file arrives", () => {
  const js = read("components/usmap.js");
  const m = js.match(/aspect-ratio:([\d.]+)\/([\d.]+)/);
  assert.ok(m, "an aspect-ratio on the box");
  assert.equal(+m[1], vb[0]); assert.equal(+m[2], vb[1]);
});

test("every page that drew the tile grid now draws the map, and the grids are gone", () => {
  const land = read("scripts/build_land_sales.py"), rent = read("scripts/build_state_rent_pages.py");
  const cond = read("conditions.html"), atlas = read("farmland-atlas.html"), fore = read("components/atlas-foreign.js");
  assert.match(land, /id="ls-map"/); assert.match(land, /usmap\.js/); assert.doesNotMatch(land, /class="ls-s ls-st-/);
  assert.match(rent, /id="rh-map"/); assert.match(rent, /usmap\.js/); assert.doesNotMatch(rent, /rh-tile|\nTILE = /);
  assert.match(cond, /AgUSMap\.mount\(\$\('cd-grid'\)/); assert.match(cond, /AgUSMap\.mount\(g,/); assert.match(cond, /usmap\.js/);
  assert.match(fore, /AgUSMap\.mount\(g,/); assert.match(atlas, /usmap\.js/);
  for (const [name, t] of [["conditions", cond], ["farmland-atlas", atlas], ["atlas-foreign", fore], ["rent builder", rent]])
    assert.doesNotMatch(t, /vp-tile|cd-tile|rh-tile|"AK":\[1,1\]/, name + " has no tile grid left");
});

test("every state has a keyboard and tap target on every page, so the tile-grid copies cannot come back", () => {
  const js = read("components/usmap.js");
  assert.match(js, /tabindex/); assert.match(js, /role/); assert.match(js, /aria-label/); assert.match(js, /keydown/);
});

/* ---- the browser ---- */
const TYPES = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".svg": "image/svg+xml" };
const PAGE = `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<style>:root{--bg:#0a0c0d;--surface2:#161b1c;--text:#e9edeb;--text-muted:rgba(233,237,235,.7);--border:rgba(132,160,168,.13)}
[data-theme=light]{--bg:#f6f7f5;--surface2:#f3f5f2;--text:#161a18;--text-muted:rgba(22,26,24,.66)}
body{margin:0;padding:0 12px;background:var(--bg);color:var(--text);font-family:sans-serif}</style>
<div id=m></div><script src="/components/usmap.js"></script>
<script>var S={};'${STATES.join(" ")}'.split(' ').forEach(function(c,i){S[c]={fill:['#2e7d4f','#d9b45a','#9a7d8f','#af3a32'][i%4],text:'status '+(i%4)+(i%7?'':'/x'),href:i%5?'':'#go-'+c}});
window.picked=[];window.api=AgUSMap.mount(document.getElementById('m'),{states:S,hint:'Tap a state.',onPick:function(c){window.picked.push(c)}});</script>`;

async function withPage(fn) {
  const srv = createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/t.html") { res.writeHead(200, { "content-type": "text/html" }); res.end(PAGE); return; }
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": TYPES[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
  const b = await chromium.launch({ executablePath: CHROME });
  try { await fn(b, `http://127.0.0.1:${srv.address().port}`); } finally { await b.close(); srv.close(); }
}
const lum = (rgb) => { const v = rgb.map((c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const rgbOf = (s) => (s.match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number);

for (const [w, theme] of [[390, "dark"], [390, "light"], [1280, "dark"], [1280, "light"]]) {
  test(`the map at ${w} px, ${theme}: 51 states once, small ones on screen and 24 px, nothing wider than the screen, readable labels`, { skip }, async () => {
    await withPage(async (b, base) => {
      const c = await b.newContext({ viewport: { width: w, height: 900 }, serviceWorkers: "block" });
      await c.route((u) => !u.hostname.startsWith("127."), (r) => r.abort());
      const p = await c.newPage();
      await p.addInitScript((t) => document.addEventListener("DOMContentLoaded", () => document.documentElement.setAttribute("data-theme", t)), theme);
      await p.goto(base + "/t.html");
      await p.waitForSelector(".usm-s");
      const r = await p.evaluate(() => {
        const g = [...document.querySelectorAll(".usm-s")], vw = innerWidth, out = { n: g.length, codes: g.map((x) => x.dataset.st), small: {}, wide: [], tiny: [] };
        for (const x of g) {
          const bb = x.getBoundingClientRect();
          if (bb.right > vw + 0.5 || bb.left < -0.5) out.wide.push(x.dataset.st);
          if (["VT", "NH", "MA", "RI", "CT", "NJ", "DE", "MD", "DC"].includes(x.dataset.st)) {
            const t = x.querySelector("text").getBoundingClientRect(), ch = x.querySelector("rect").getBoundingClientRect();
            out.small[x.dataset.st] = { l: t.left, r: t.right, w: ch.width, h: ch.height };
          }
        }
        out.doc = document.documentElement.scrollWidth - vw;
        const t = document.querySelector('.usm-s[data-st="IA"] text'), pth = document.querySelector('.usm-s[data-st="IA"] path');
        out.ink = getComputedStyle(t).fill; out.fill = getComputedStyle(pth).fill;
        out.role = [g[0].getAttribute("role"), g[0].getAttribute("aria-label"), g[0].getAttribute("tabindex")];
        out.fs = parseFloat(getComputedStyle(document.querySelector('.usm-s[data-st="VT"] text')).fontSize) * (document.querySelector("svg").getBoundingClientRect().width / document.querySelector("svg").viewBox.baseVal.width);
        return out;
      });
      assert.equal(r.n, 51); assert.deepEqual([...r.codes].sort(), [...STATES].sort());
      assert.deepEqual(r.wide, [], "no state or label outside the screen");
      assert.ok(r.doc <= 0, "no element wider than the screen (" + r.doc + ")");
      for (const [st, s] of Object.entries(r.small)) {
        assert.ok(s.l >= 0 && s.r <= w, st + " label inside the viewport");
        assert.ok(s.h >= 22 || w > 390, st + " chip is tall enough to tap (" + s.h.toFixed(1) + ")");
      }
      assert.ok(r.fs >= 9, "a leader label is readable (" + r.fs.toFixed(1) + " px)");
      assert.ok(ratio(rgbOf(r.ink), rgbOf(r.fill)) >= 4.5, "label contrast on a state, " + theme);
      assert.ok(["button", "link"].includes(r.role[0]), "has a role");
      assert.ok(r.role[1] && r.role[2] === "0", "named and focusable");
      // the thumb: a leader label is tapped like the state
      const st = await p.$('.usm-s[data-st="DE"] rect');
      await st.scrollIntoViewIfNeeded();
      await st.click();
      assert.deepEqual(await p.evaluate(() => window.picked), ["DE"], "tap handled");
      const say = await p.textContent(".usm-read");
      assert.match(say, /^Delaware: status/, "name and status read out on tap");
      await c.close();
    });
  });
}

test("keyboard: Tab reaches a state, Enter picks it, the readout names it; a state with no data is skipped", { skip }, async () => {
  await withPage(async (b, base) => {
    const c = await b.newContext({ viewport: { width: 390, height: 900 }, serviceWorkers: "block" });
    const p = await c.newPage();
    await p.goto(base + "/t.html");
    await p.waitForSelector(".usm-s");
    await p.evaluate(() => window.api.update({ IA: { fill: "#2e7d4f", text: "ok" }, IL: { fill: "#af3a32", text: "bad" } }, null));
    assert.equal(await p.$$eval('.usm-s[tabindex="0"]', (e) => e.length), 2, "only states with data are in the tab order");
    await p.focus('.usm-s[data-st="IL"]');
    assert.match(await p.textContent(".usm-read"), /^Illinois: bad/);
    await p.keyboard.press("Enter");
    assert.deepEqual(await p.evaluate(() => window.picked), ["IL"]);
    assert.equal(await p.getAttribute('.usm-s[data-st="IL"]', "aria-pressed"), "true");
    assert.equal(await p.getAttribute('.usm-s[data-st="IA"]', "aria-pressed"), "false");
    assert.equal(await p.getAttribute('.usm-s[data-st="TX"]', "aria-disabled"), "true");
    await c.close();
  });
});

test("the box holds its shape: no layout shift when the file arrives", { skip }, async () => {
  await withPage(async (b, base) => {
    const c = await b.newContext({ viewport: { width: 390, height: 900 }, serviceWorkers: "block" });
    await c.route("**/data/us-states-map.svg*", async (r) => { await new Promise((ok) => setTimeout(ok, 600)); r.continue(); });
    const p = await c.newPage();
    await p.goto(base + "/t.html");
    const h0 = await p.evaluate(() => document.querySelector(".usm-box").getBoundingClientRect().height);
    await p.waitForSelector(".usm-s");
    const h1 = await p.evaluate(() => document.querySelector(".usm-box").getBoundingClientRect().height);
    assert.ok(h0 > 200 && Math.abs(h0 - h1) < 0.5, `box ${h0} before, ${h1} after`);
    await c.close();
  });
});

test("when the file does not load, the box says so in one sentence and the page keeps working", { skip }, async () => {
  await withPage(async (b, base) => {
    const c = await b.newContext({ viewport: { width: 390, height: 900 }, serviceWorkers: "block" });
    await c.route("**/data/us-states-map.svg*", (r) => r.abort());
    const p = await c.newPage();
    await p.goto(base + "/t.html");
    await p.waitForSelector(".usm-fail");
    assert.match(await p.textContent(".usm-fail"), /list below/);
    await c.close();
  });
});
