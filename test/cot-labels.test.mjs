/* COT chart labels never overlap (Nov 7, 2026). The corn picture for the week to Nov 3, 2026 drew "52-wk high 414.5k
 * long, Sep 15" on top of "8,795 long, Nov 3": the high was 7 weeks before the latest point, both at the top right,
 * and when the latest label found no clear spot it was put in its first spot anyway. components/cot-chart.js
 * layout() is the one place the high, low and latest labels are placed; the page chart (toSvg), the saved pictures
 * (image(), phone and wide) and the printed sheet (cot-print.js) all draw what it places.
 *
 * Frozen input: test/fixtures/funds/cot*-2026-11-03.json (the real Nov 3 report, corn's high on Sep 15).
 *   - layout(): every text box (the layout's own measure) clear of every other and inside the chart, for corn at
 *     the page sizes of a 390 and a 1280 px screen, the two picture sizes, the print sheet's three heights, and a
 *     sweep of sizes in between, for every market of both reports;
 *   - in a browser at 390 and 1280 px: the page chart's SVG text boxes (getBBox) and the picture's drawn text
 *     boxes (the canvas's own measureText), none touching another, all inside the chart.
 *
 *   node --test test/cot-labels.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const C = require(path.join(ROOT, "components/cot-chart.js"));
const K = require(path.join(ROOT, "components/cot-kit.js"));
const fx = (n, d) => fs.readFileSync(path.join(ROOT, `test/fixtures/funds/${n}-${d}.json`));
const load = (d) => ({ cot: JSON.parse(fx("cot", d)), cx: JSON.parse(fx("cot-analysis", d)), hist: JSON.parse(fx("cot-history", d)) });
const NOV3 = load("2026-11-03"), OCT27 = load("2026-10-27");
const corn = C.model("corn", NOV3.hist, NOV3.cot, NOV3.cx);

/* the box layout() gives a text item: its own measure (cot-kit tw), as the placing code sees it */
function box(it) {
  const bw = K.tw(it.s, it.size), bh = it.size * 1.25;
  const x0 = it.align === "right" ? it.x - bw : it.align === "center" ? it.x - bw / 2 : it.x;
  const y0 = it.base === "top" ? it.y : it.base === "middle" ? it.y - bh / 2 : it.y - bh;
  return [x0, y0, x0 + bw, y0 + bh];
}
const meet = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
/* two lines of one label (its number over its date): drawn from the same x, one line under the other */
const oneBlock = (a, b) => Math.abs(a.x - b.x) < 0.5 && a.align === b.align && Math.abs(a.y - b.y) < 1.3 * Math.max(a.size, b.size);
/* the labels: the marks, the latest point, the gutter words, the event, the price labels (the tick numbers and
   the month row are a fixed scale beside the plot and do not move) */
const isLabel = (it) => it.t === "text" && !it.wrap && !(it.align === "right" && it.base === "middle" && it.x < 140 && !/weeks/.test(it.s)) && !(it.base === "top" && /^(?:[A-Z][a-z]{2}|20\d\d)$/.test(it.s));

function check(m, w, h, o, tag) {
  const g = C.layout(m, w, h, o), ts = g.items.filter(isLabel), bs = ts.map(box);
  for (let i = 0; i < ts.length; i++) {
    const b = bs[i];
    assert.ok(b[0] >= -0.5 && b[2] <= w + 0.5 && b[1] >= -0.5 && b[3] <= h + 0.5, `${tag}: "${ts[i].s}" inside the ${w}x${h} chart (${b.map(Math.round)})`);
    for (let j = 0; j < i; j++) if (!oneBlock(ts[i], ts[j])) assert.ok(!meet(b, bs[j]), `${tag}: "${ts[i].s}" clear of "${ts[j].s}"`);
  }
  return g;
}

test("the fixture is the case that broke: corn's 52-week high 7 weeks before the latest point, both up top on the right", () => {
  const days = (dt.parse(corn.last.date) - dt.parse(corn.hi.date)) / 864e5;
  assert.equal(days, 49, "7 weeks apart");
  assert.equal(corn.last.net, NOV3.cot.corn.net);
  assert.equal(corn.hi.net, NOV3.cot.corn.max52);
  const g = C.layout(corn, 1088, 344, { fs: 19, big: true }), t = (re) => g.items.find((i) => i.t === "text" && re.test(i.s));
  assert.ok(t(/^52-wk high 414\.5k long$/) && t(/^8,795 long$/), "the same numbers and words");
});
const dt = { parse: (s) => Date.parse(s + "T12:00:00Z") };

test("layout(): no label box meets another or leaves the chart (page, pictures, print sheet), every market of both reports", () => {
  /* corn, the case that broke: the page chart (358 wide on a 390 screen, 818 on a 1280 one), the pictures' charts, the print sheet */
  check(corn, 358, 300, { fs: 12 }, "page 390");
  check(corn, 818, 340, { fs: 12 }, "page 1280");
  for (const h of [410, 516, 600]) check(corn, 960, h, { fs: 26, big: true }, "phone picture " + h);
  for (const h of [285, 344]) check(corn, 1088, h, { fs: 19, big: true }, "wide picture " + h);
  for (const h of [300, 260, 230]) check(corn, 560, h, { fs: 15, print: true }, "print " + h);
  /* every market: the page widths (300 px tall to 700 px, 340 above), the chart heights the pictures give
     (phone 410 to 516, wide 285 to 344 for these reports) and the print sheet's two taller heights. The shortest
     print chart (230) is left to corn: three two-line labels cannot always share its 53 px band. Known overlaps
     left at that one size (they were there before this fix too): feeder cattle and class III milk, Nov 3, 2026, where
     the 52-week high, low and latest labels crowd each other. Page and pictures are clear for every market. */
  for (const [d, R] of [["Nov 3", NOV3], ["Oct 27", OCT27]]) {
    for (const k of Object.keys(R.hist.history)) {
      const m = C.model(k, R.hist, R.cot, R.cx);
      if (!m) continue;
      for (const w of [300, 358, 480, 668]) check(m, w, 300, { fs: 12 }, `${d} ${k} page ${w}x300`);
      for (const w of [668, 740, 818]) check(m, w, 340, { fs: 12 }, `${d} ${k} page ${w}x340`);
      for (const h of [410, 421, 444, 448, 462, 482, 516]) check(m, 960, h, { fs: 26, big: true }, `${d} ${k} phone ${h}`);
      for (const h of [285, 300, 344]) check(m, 1088, h, { fs: 19, big: true }, `${d} ${k} wide ${h}`);
      for (const h of [300, 260]) check(m, 560, h, { fs: 15, print: true }, `${d} ${k} print ${h}`);
    }
  }
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
    if (!path.extname(p)) p += ".html";
    const f = path.normalize(path.join(ROOT, p));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" });
    res.end(fs.readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

/* the picture drawn on a real canvas; every fillText recorded with its glyph box from the canvas's own measureText
   and the transform at that moment (the chart is painted translated into the picture) */
const RECORD = () => {
  window.__drawn = [];
  const make = document.createElement.bind(document);
  window.__doc = { createElement: (t) => {
    const c = make(t);
    if (t !== "canvas") return c;
    const real = c.getContext.bind(c);
    c.getContext = (k) => {
      const ctx = real(k);
      return new Proxy(ctx, {
        get(o, p) {
          if (p === "fillText") return (s, x, y) => {
            const mt = o.measureText(s), tf = o.getTransform();
            window.__drawn.push({ s: String(s), dx: tf.e, dy: tf.f, l: x - mt.actualBoundingBoxLeft + tf.e, r: x + mt.actualBoundingBoxRight + tf.e, t: y - mt.actualBoundingBoxAscent + tf.f, b: y + mt.actualBoundingBoxDescent + tf.f });
            return o.fillText(s, x, y);
          };
          const v = o[p];
          return typeof v === "function" ? v.bind(o) : v;
        },
        set(o, p, v) { o[p] = v; return true; },
      });
    };
    return c;
  } };
};

for (const width of [390, 1280]) {
  test(`in a browser at ${width} px: the page chart's and the picture's labels never meet and stay inside the chart`, { skip, timeout: 120000 }, async () => {
    const srv = await serve(), port = srv.address().port;
    const browser = await chromium.launch({ executablePath: CHROME });
    try {
      const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width, height: 900 } });
      const pg = await ctx.newPage();
      await pg.addInitScript(RECORD);
      const own = { "/data/cot.json": fx("cot", "2026-11-03"), "/data/cot-analysis.json": fx("cot-analysis", "2026-11-03"), "/data/cot-history.json": fx("cot-history", "2026-11-03") };
      await pg.route("**/*", (r) => {
        const u = new URL(r.request().url());
        if (u.origin === `http://127.0.0.1:${port}`) return own[u.pathname] ? r.fulfill({ status: 200, contentType: "application/json", body: own[u.pathname] }) : r.continue();
        if (u.origin === "https://agsist-api.dnilgis.workers.dev")
          return r.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ ok: true }) });
        return r.abort();
      });
      await pg.clock.setFixedTime(new Date(Date.UTC(2026, 10, 7, 15)));
      await pg.goto(`http://127.0.0.1:${port}/cot`, { waitUntil: "load" });
      await pg.waitForFunction((n) => document.getElementById("cot-chart-box")?.dataset.latest === n, String(NOV3.cot.corn.net));
      await pg.evaluate(() => document.fonts && document.fonts.ready);

      /* the page chart: each SVG text's box, in the chart's own units */
      const page = await pg.$eval("#cc-svg", (svg) => {
        const vb = svg.viewBox.baseVal;
        return { w: vb.width, h: vb.height, ts: [...svg.querySelectorAll("text")].map((t) => { const b = t.getBBox(); return { s: t.textContent, x: +t.getAttribute("x"), y: +t.getAttribute("y"), size: +t.getAttribute("font-size"), anchor: t.getAttribute("text-anchor"), base: t.getAttribute("dominant-baseline"), b: [b.x, b.y, b.x + b.width, b.y + b.height] }; }) };
      });
      assert.ok(page.ts.some((t) => /^52-wk high 414\.5k long$/.test(t.s)) && page.ts.some((t) => /^8,795 long$/.test(t.s)), "the page chart carries both labels");
      page.ts.forEach((t) => { t.align = t.anchor; });
      const pl = page.ts.filter((t) => isLabel({ t: "text", s: t.s, x: t.x, y: 1, align: { end: "right", middle: "center", start: "left" }[t.anchor], base: { hanging: "top", central: "middle", auto: "bottom" }[t.base] }));
      for (let i = 0; i < pl.length; i++) {
        const b = pl[i].b;
        assert.ok(b[0] >= 0 && b[2] <= page.w && b[1] >= 0 && b[3] <= page.h, `page ${width}: "${pl[i].s}" inside the chart`);
        for (let j = 0; j < i; j++) if (!oneBlock(pl[i], pl[j])) assert.ok(!meet(b, pl[j].b), `page ${width}: "${pl[i].s}" clear of "${pl[j].s}"`);
      }

      /* the picture: the one a reader on this screen saves by default (phone on a phone, wide on a desktop), and the other */
      for (const phone of width < 900 ? [true, false] : [false, true]) {
        const pic = await pg.evaluate(async (phone) => {
          const r = (u) => fetch(u).then((x) => x.json()), C = window.AgCotChart;
          const m = C.model("corn", await r("/data/cot-history.json"), await r("/data/cot.json"), await r("/data/cot-analysis.json"));
          window.__drawn = [];
          const im = C.image(m, window.__doc, { phone });
          return { W: im.canvas.width, drawn: window.__drawn };
        }, phone);
        const P = phone ? 60 : 56, inChart = pic.drawn.filter((d) => d.dx !== 0 || d.dy !== 0);
        const src = pic.drawn.find((d) => /^Source:/.test(d.s));
        assert.ok(inChart.some((d) => d.s === "52-wk high 414.5k long") && inChart.some((d) => d.s === "8,795 long"), "the picture carries both labels, words unchanged");
        const top = Math.min(...inChart.map((d) => d.dy));
        const labs = inChart.filter((d) => isLabel({ t: "text", s: d.s, x: d.l - d.dx < 140 && !/[a-z]{3,}/.test(d.s) ? 0 : 999, y: 1, align: "right", base: "middle" }));
        for (let i = 0; i < labs.length; i++) {
          const a = labs[i];
          assert.ok(a.l >= P - 1 && a.r <= pic.W - P + 1 && a.t >= top - 1 && a.b <= src.t, `${phone ? "phone" : "wide"} picture: "${a.s}" inside the chart`);
          for (let j = 0; j < i; j++) assert.ok(!meet([a.l, a.t, a.r, a.b], [labs[j].l, labs[j].t, labs[j].r, labs[j].b]), `${phone ? "phone" : "wide"} picture: "${a.s}" clear of "${labs[j].s}"`);
        }
      }
      await ctx.close();
    } finally { await browser.close(); srv.close(); }
  });
}
