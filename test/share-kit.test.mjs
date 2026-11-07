/* The share kit core (Nov 7, 2026, share kit wave 1 step 1): one shared module, components/share-kit.js and
 * components/share-kit.css (the picture frame and date block, the canvas pen, the QR code on a picture, the print
 * sheet shell and the beforeprint hook, Web Share with the download fallback, the link tags and the GA names),
 * with the COT kit, Bin Print and County Print moved onto it WITHOUT changing what they make.
 *
 *   node --test test/share-kit.test.mjs
 *
 * How "unchanged" is proved:
 *   - THE PICTURES: every picture is drawn on a recording canvas (each draw call with its arguments and the whole
 *     drawing state at that moment: fill, stroke, font, alignment, line width). The same calls in the same order
 *     with the same state paint the same pixels, so the hash of that record is held to the value the code made
 *     before the move (GOLD, recorded from main at beba326 before any edit). COT: the phone and the wide picture,
 *     a market with a price strip, one without, and the compare picture. County Print: a full and a sparse county
 *     with the QR code. Bin Print: the full and the crew picture of a small and a 40-thing yard.
 *   - THE PRINT SHEETS: the sheet data and the HTML each kit writes (COT sheet at its three chart heights and the
 *     wall edition, County Print at three chart heights with the locator, the Bin Print and crew sheets), hashed
 *     and held to GOLD the same way.
 *   - In a browser: the kits' own browser tests (test/cot-print, test/county-print, test/bin-yard) print each sheet
 *     through the shared shell (one page on Letter and A4, beforeprint builds it, nothing moves on screen).
 *   - The shared module itself: the tags and GA names, the dates, the pen, the frame and QR code, the share
 *     fallback, the print hook, one copy of the shell, and every page loading the core before its kit.
 * Frozen inputs: test/fixtures/funds (the Oct 27 COT report), test/fixtures/share-kit/county.json (two built
 * county pages' figures) and loc-ia.json, test/fixtures/county-print-live.json, and the Bin Print sample yard. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const json = (p) => JSON.parse(read(p));
const require = createRequire(import.meta.url);
const sha = (s) => createHash("sha256").update(typeof s === "string" ? s : JSON.stringify(s)).digest("hex").slice(0, 16);

const qctx = { window: {} };
vm.createContext(qctx);
vm.runInContext(read("components/qr.js"), qctx);
const Q = qctx.window.AgQR;

/* A canvas that records instead of painting: each call with its arguments and the drawing state at that moment.
 * measureText is the one read: a fixed width per character at the font's size, so wrapping is the same anywhere. */
function recorder() {
  const log = [], st = {};
  const canvas = { width: 0, height: 0 };
  const px = () => { const m = /(\d+(?:\.\d+)?)px/.exec(st.font || ""); return m ? +m[1] : 10; };
  const wt = () => { const m = /^(\d{3})\b/.exec(st.font || ""); return m ? +m[1] : 400; };
  const ctx = new Proxy({}, {
    get(_, k) {
      if (k === "canvas") return canvas;
      if (k === "measureText") return (s) => ({ width: String(s).length * px() * (0.5 + wt() / 10000) });
      if (Object.prototype.hasOwnProperty.call(st, k)) return st[k];
      return (...a) => { log.push([k, a, Object.keys(st).sort().map((x) => x + "=" + st[x]).join(";")]); };
    },
    set(_, k, v) { st[k] = v; return true; },
  });
  canvas.getContext = () => ctx;
  canvas.toDataURL = () => "";
  return { doc: { createElement: () => canvas }, log, canvas };
}
const picture = (fn) => { const r = recorder(), im = fn(r.doc); return { hash: sha([r.canvas.width, r.canvas.height, r.log]), texts: im.texts, w: r.canvas.width, h: r.canvas.height }; };

/* ---------------------------------------------------------------- the fingerprints */
const G = require(path.join(ROOT, "components/cot-glance.js"));
const C = require(path.join(ROOT, "components/cot-chart.js"));
const P = require(path.join(ROOT, "components/cot-print.js"));
const CP = require(path.join(ROOT, "components/county-print.js"));
const BY = require(path.join(ROOT, "components/bin-yard.js"));
const FX = { cot: json("test/fixtures/funds/cot-2026-10-27.json"), cx: json("test/fixtures/funds/cot-analysis-2026-10-27.json"),
  hist: json("test/fixtures/funds/cot-history-2026-10-27.json") };
const COUNTY = json("test/fixtures/share-kit/county.json"), LIVE = json("test/fixtures/county-print-live.json").live;
const LOC = json("test/fixtures/share-kit/loc-ia.json");
const NOW = Date.UTC(2026, 10, 7, 18);

function bigYard() {
  const items = [];
  for (let i = 0; i < 40; i++) {
    const t = ["round", "round", "hopper", "flat", "dryer", "leg", "drive", "unload", "entry"][i % 9];
    items.push(BY.normalize({ t, x: 12 + (i % 8) * 24, y: 14 + Math.floor(i / 8) * 26, name: "Bin " + (i + 1) + " north row", note: i % 3 ? "Check the auger before filling" : "",
      st: ["filling", "full", "empty", "dnu", ""][i % 5], crop: ["corn", "soybeans", "wheat"][i % 3], fm: "height", fv: 6 + (i % 10), diam: 24 + (i % 5) * 6 }));
  }
  return { name: "Home place west yard", crew: "Unload at the north pit only.\nCall before dumping beans.", crewBu: true, items };
}

function fingerprints() {
  const out = {};
  /* COT: the pictures */
  for (const [k, keys, cmp] of [["corn", ["corn"], false], ["leanhogs", ["leanhogs"], false], ["cmp", ["corn", "beans", "wheat"], true]]) {
    const m = cmp ? C.cmpModel(keys, FX.hist, FX.cot, FX.cx) : C.model(keys[0], FX.hist, FX.cot, FX.cx);
    for (const phone of [true, false]) out[`cot.image.${k}.${phone ? "phone" : "wide"}`] = picture((doc) => C.image(m, doc, { phone })).hash;
  }
  /* COT: the print sheet and the wall edition */
  for (const key of ["corn", "beans"]) {
    const s = P.sheet(FX.cot, FX.cx, FX.hist, NOW, key), qr = Q.svg(s.qr, "QR code to the Funds this week signup at agsist.com/cot");
    out[`cot.sheet.${key}.data`] = sha(Object.assign({}, s, { chart: s.chart && { price: s.chart.price, aligned: s.chart.aligned, head: s.chart.head, svg: s.chart.svg } }));
    for (const h of [300, 260, 230]) out[`cot.sheet.${key}.html${h}`] = sha(P.html(s, qr, h));
    out[`cot.sheet.${key}.wall`] = sha(P.wall(s, qr));
  }
  /* County Print: the sheet and the picture */
  for (const fips of ["19169", "55005"]) {
    const c = COUNTY[fips];
    for (const [lk, live] of [["live", LIVE], ["none", {}]]) {
      const s = CP.sheet(c.cp, live, { name: c.name, state: c.state, url: c.url, fips, now: NOW, asOf: "Nov 6, 2026" });
      out[`county.${fips}.${lk}.data`] = sha(s);
      const code = Q.svg(s.qr, CP.QR_CAP + ": " + s.shown, 10);
      for (const h of [300, 200, 115]) out[`county.${fips}.${lk}.html${h}`] = sha(CP.html(s, code, h, fips === "19169" ? LOC : null));
      const m = Q.matrix(s.pic, null, null, 10);
      out[`county.${fips}.${lk}.image`] = picture((doc) => CP.image(s, doc, { qr: m })).hash;
      out[`county.${fips}.${lk}.image-noqr`] = picture((doc) => CP.image(s, doc, {})).hash;
    }
  }
  /* Bin Print: the sheets and the pictures */
  const now = new Date(NOW);
  for (const [yk, y] of [["sample", { name: "Sample yard", crew: "Unload at the east pit.", crewBu: false, items: BY.sample() }], ["big", bigYard()]]) {
    const plan = BY.qrPlan(y, Q);
    out[`bin.${yk}.plan`] = sha([plan.url, plan.caption, plan.level, plan.code || "", plan.matrix.length]);
    for (const h of [3.4, 1.7]) out[`bin.${yk}.sheet${h}`] = sha(BY.sheetHtml(y, { plan, mapH: h, now }));
    for (const h of [5.4, 2.8]) out[`bin.${yk}.crew${h}`] = sha(BY.crewHtml(y, { plan, mapH: h, now }));
    out[`bin.${yk}.title`] = BY.sheetTitle(y, now);
    out[`bin.${yk}.image`] = picture((doc) => BY.image(y, doc, { plan, now })).hash;
    out[`bin.${yk}.image-crew`] = picture((doc) => BY.image(y, doc, { plan, now, crew: true })).hash;
    out[`bin.${yk}.image-noplan`] = picture((doc) => BY.image(y, doc, { plan: null, now, crew: true })).hash;
  }
  return out;
}

const GOLD = {
  "cot.image.corn.phone": "4a7f66e3a5b334b2",
  "cot.image.corn.wide": "bdc646f748a7714e",
  "cot.image.leanhogs.phone": "9855d275b008cd11",
  "cot.image.leanhogs.wide": "345ffff5d97a5c16",
  "cot.image.cmp.phone": "a3f1c3d88dfa49b3",
  "cot.image.cmp.wide": "7c370a1e958b1415",
  "cot.sheet.corn.data": "28025c03e8b1d020",
  "cot.sheet.corn.html300": "2603ea7ef0d3f77d",
  "cot.sheet.corn.html260": "2dfb251ed880db82",
  "cot.sheet.corn.html230": "ee200d088ab60551",
  "cot.sheet.corn.wall": "0630a55da75c9caa",
  "cot.sheet.beans.data": "3166d534bdf1fe75",
  "cot.sheet.beans.html300": "243e0abc9a4cd400",
  "cot.sheet.beans.html260": "b66957cfb624a197",
  "cot.sheet.beans.html230": "e58cce92fba2232e",
  "cot.sheet.beans.wall": "68a1dc4e4dd25532",
  "county.19169.live.data": "fc7cc5dd6dbddc8e",
  "county.19169.live.html300": "f62e0f9e4dbe3400",
  "county.19169.live.html200": "7f00a5db97af7d29",
  "county.19169.live.html115": "11675c1a8f2d4d5e",
  "county.19169.live.image": "3f4cf8984c0eade2",
  "county.19169.live.image-noqr": "691a3a99f80002e0",
  "county.19169.none.data": "4bd33e99f0823bde",
  "county.19169.none.html300": "422584bd82c063ea",
  "county.19169.none.html200": "ebfb3becdf125ef6",
  "county.19169.none.html115": "dfa549dc2d83b954",
  "county.19169.none.image": "0bb481be4b0534ad",
  "county.19169.none.image-noqr": "834d81aeb451030e",
  "county.55005.live.data": "0ce657f08e5670f4",
  "county.55005.live.html300": "6d3712a5950cce2d",
  "county.55005.live.html200": "f529247e85291a2f",
  "county.55005.live.html115": "fc54192f5e9bafb8",
  "county.55005.live.image": "9a1afe26a005fde7",
  "county.55005.live.image-noqr": "05297f47a307094a",
  "county.55005.none.data": "ecccce9bec7d7e4b",
  "county.55005.none.html300": "3264141a48096d29",
  "county.55005.none.html200": "88af9f6831819f5d",
  "county.55005.none.html115": "d3c3b88bbf6d5307",
  "county.55005.none.image": "03f310832ac82d02",
  "county.55005.none.image-noqr": "cc85533760410be9",
  "bin.sample.plan": "a9b6e34fe7798ce5",
  "bin.sample.sheet3.4": "72554a28968237f9",
  "bin.sample.sheet1.7": "0e3246a2966a8072",
  "bin.sample.crew5.4": "9f01fba2cf90f53e",
  "bin.sample.crew2.8": "eae9c7bfc5400d3b",
  "bin.sample.title": "Bin Print: Sample yard, Nov 7, 2026",
  "bin.sample.image": "0fa4b75aa75f1227",
  "bin.sample.image-crew": "e4bcbc18d5a6b4d7",
  "bin.sample.image-noplan": "c6ded7c86ca81565",
  "bin.big.plan": "86e38a9d0e549d0e",
  "bin.big.sheet3.4": "40a288a2f79b7203",
  "bin.big.sheet1.7": "72cc409ef8c2d082",
  "bin.big.crew5.4": "c0b4e62e6de78adf",
  "bin.big.crew2.8": "be6190572198474e",
  "bin.big.title": "Bin Print: Home place west yard, Nov 7, 2026",
  "bin.big.image": "d5ea8708a8284e13",
  "bin.big.image-crew": "1972cf9b1736584d",
  "bin.big.image-noplan": "e679f02ce6564fff",
};

const FP = fingerprints();
if (process.env.SHARE_KIT_PRINT_GOLD) console.log(JSON.stringify(FP, null, 1));

test("every picture and every print sheet is the same as before the move (recorded canvas calls and sheet HTML)", () => {
  assert.ok(Object.keys(GOLD).length >= 50, "the gold record is in place");
  assert.deepEqual(Object.keys(FP).sort(), Object.keys(GOLD).sort(), "the same set of outputs");
  for (const k of Object.keys(GOLD)) assert.equal(FP[k], GOLD[k], k + " unchanged");
});

/* ---------------------------------------------------------------- the shared module itself */
const SK = require(path.join(ROOT, "components/share-kit.js"));

test("one link convention and one set of GA names, the ones the brief lists", () => {
  assert.equal(SK.tags("print", "qr", "cot-2026-11-03"), "utm_source=print&utm_medium=qr&utm_campaign=cot-2026-11-03");
  assert.deepEqual(Object.keys(SK.SRC), ["share", "print", "email"]);
  assert.deepEqual(Object.keys(SK.MED), ["picture", "sheet", "qr", "link"]);
  assert.deepEqual(Object.values(SK.EV), ["share_open", "share_done", "picture_download", "sheet_print", "qr_visit"]);
  // the kits build their links with it: COT (cot-kit.js link) and County Print (county-print.js link)
  const K = require(path.join(ROOT, "components/cot-kit.js"));
  assert.equal(K.link(["beans"], "2026-11-03", "share", "picture"), "https://agsist.com/cot?m=soybeans&w=2026-11-03&utm_source=share&utm_medium=picture&utm_campaign=cot-2026-11-03#soybeans");
  assert.equal(CP.link("https://agsist.com/farmland-atlas/iowa/story-county", "print", "qr", "19169", "2026-11-07"),
    "https://agsist.com/farmland-atlas/iowa/story-county?asof=2026-11-07&utm_source=print&utm_medium=qr&utm_campaign=county-19169");
  for (const f of ["cot-kit.js", "county-print.js"]) assert.doesNotMatch(read("components/" + f).replace(/\/\*[\s\S]*?\*\//g, ""), /'utm_source='/, f + ": no second copy of the tags");
});

test("dates carry the year: Central time for the printed day, the device's own clock for Bin Print", () => {
  assert.equal(SK.mdy("2026-11-07"), "Nov 7, 2026");
  assert.equal(SK.mdy("nope"), "");
  assert.equal(SK.dateLine(Date.UTC(2026, 10, 8, 3)), "November 7, 2026", "9 PM Central on Nov 7 is still Nov 7");
  assert.equal(SK.isoDay(Date.UTC(2026, 10, 8, 3)), "2026-11-07");
  assert.equal(SK.mdyLocal(new Date(2026, 0, 2, 12)), "Jan 2, 2026");
  assert.equal(SK.esc(null), "");
  assert.equal(SK.esc("<a href=\"x\">'&'</a>"), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
});

test("the pen wraps, shrinks to fit and records every word; the frame and the QR code paint as before", () => {
  const r = recorder(), c = r.doc.createElement("canvas"), ctx = c.getContext("2d"), p = SK.pen(ctx, { paras: true });
  p.font(20, 400);
  assert.deepEqual(p.wrap("one two\nthree four five", 200), ["one two", "three four five"], "a newline starts a line when paras is set");
  assert.deepEqual(SK.pen(ctx).wrap("one two\nthree", 2000), ["one two\nthree"], "and is a plain character when it is not");
  const sz = p.fit("a long headline that will not fit", 60, 36, 800, 400);
  assert.ok(sz >= 36 && sz < 60 && sz % 2 === 0, "shrinks in steps of 2, never under the floor: " + sz);
  const y = p.lines("alpha beta gamma delta epsilon zeta", 10, 100, 30, 600, "#fff", 40, 2, 200);
  assert.equal(p.texts.length, 2, "at most the lines asked for");
  assert.equal(y, 180);
  assert.deepEqual(p.sizes, [30, 30]); assert.deepEqual(p.ys, [100, 140]);
  const r2 = recorder(), c2 = r2.doc.createElement("canvas"), x2 = c2.getContext("2d");
  SK.frame(x2, 100, 50, 8);
  assert.deepEqual(r2.log.map((l) => [l[0], l[1].join(",")]), [["fillRect", "0,0,100,50"], ["fillRect", "0,0,100,8"]]);
  assert.match(r2.log[0][2], /fillStyle=#0a0c0d/); assert.match(r2.log[1][2], /fillStyle=#d4a23f/);
  assert.equal(SK.qr(x2, [[true, false], [false, true]], 0, 0, 3), 30, "4 modules of quiet zone each side");
});

test("sharing: the share sheet inside the tap, a download when it refuses, nothing when the reader cancels", async () => {
  const calls = [];
  const win = (rej) => ({ navigator: { share: () => (rej ? Promise.reject(rej) : Promise.resolve()), canShare: () => true }, matchMedia: (q) => ({ matches: q === "(pointer: coarse)" }) });
  await SK.share(win(null), {}, () => calls.push("done"), () => calls.push("fail"));
  await SK.share(win({ name: "NotAllowedError" }), {}, () => calls.push("done"), () => calls.push("fail"));
  await SK.share(win({ name: "AbortError" }), {}, () => calls.push("done"), () => calls.push("fail"));
  await SK.share(win({ name: "NotAllowedError" }), {}, null, null);
  assert.deepEqual(calls, ["done", "fail"], "resolved: done; refused: the fallback; the reader's cancel: nothing");
  assert.equal(SK.canShareFile(win(null), {}), true);
  assert.equal(SK.canShareFile(win(null), null), false, "no file, no share sheet");
  assert.equal(SK.canShareFile({ navigator: {}, matchMedia: () => ({ matches: true }) }, {}), false, "a browser without canShare downloads");
  const got = [];
  SK.copy({ navigator: {} }, "u", () => got.push("ok"), () => got.push("fail"));
  await SK.copy({ navigator: { clipboard: { writeText: () => Promise.resolve() } } }, "u", () => got.push("ok"), () => got.push("fail"));
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(got, ["fail", "ok"]);
});

test("the print hook: any print gives the sheet; Bin Print keeps to beforeprint and afterprint", () => {
  const mk = () => { const ev = {}, mq = []; return { ev, mq, addEventListener: (n, f) => { ev[n] = f; }, matchMedia: () => ({ addEventListener: (n, f) => mq.push(f) }) }; };
  const a = mk(), b = mk();
  SK.printHook(a, () => {}, () => {});
  SK.printHook(b, () => {}, () => {}, { mq: false });
  assert.ok(a.ev.beforeprint && a.ev.afterprint && a.mq.length === 1);
  assert.ok(b.ev.beforeprint && b.ev.afterprint && b.mq.length === 0);
  const off = []; SK.printNow({ print: () => { throw new Error("no"); } }, () => off.push(1));
  assert.deepEqual(off, [1], "a print that cannot start puts the page back");
  // one copy of the shell: the three kits' stylesheets no longer carry their own
  for (const f of ["cot-print.css", "county-print.css", "bin-yard.css"]) {
    const css = read("components/" + f);
    assert.doesNotMatch(css, /body>\*:not\(#/, f + ": the print isolation is the share kit's");
    assert.doesNotMatch(css, /-measure\{display:block/, f + ": the off-screen measure is the share kit's");
  }
  for (const f of ["cot-print.js", "county-print.js", "bin-yard.js"]) {
    const js = read("components/" + f);
    assert.match(js, /\.printHook\(root, /, f + ": the share kit's print hook");
    assert.match(js, /\.sheet\(doc, '(cotp|cprs|byp)', '\1'\)/, f + ": the share kit's sheet");
    assert.doesNotMatch(js, /addEventListener\('beforeprint'/, f + ": no second print hook");
  }
});

test("every page that runs a kit loads the share kit core first; versions bumped; cot-chart.js under its budget", () => {
  const cot = read("cot.html"), bin = read("grain-bin-calculator.html");
  assert.ok(cot.indexOf('/components/share-kit.js?v=1"') > 0 && cot.indexOf('/components/share-kit.js?v=1"') < cot.indexOf('/components/cot-kit.js?v=3"'));
  assert.ok(cot.includes('<link rel="stylesheet" href="/components/share-kit.css?v=1">'));
  assert.ok(bin.indexOf('/components/share-kit.js?v=1"') > 0 && bin.indexOf('/components/share-kit.js?v=1"') < bin.indexOf('/components/bin-yard.js?v=2"'));
  assert.ok(bin.includes('<link rel="stylesheet" href="/components/share-kit.css?v=1">'));
  // County pages are a generated set: county-print.js (at its own hash) loads the core and its stylesheet itself
  const cpj = read("components/county-print.js");
  assert.match(cpj, /SK_CSS = '\/components\/share-kit\.css\?v=1', SK_JS = '\/components\/share-kit\.js\?v=1'/);
  assert.match(cpj, /CSS = '\/components\/county-print\.css\?v=2'/);
  assert.match(cpj, /if \(root\.AgShareKit\) start\(\); else load\('script', \{ src: SK_JS, async: true \}\)\.onload = start;/);
  assert.ok(fs.statSync(path.join(ROOT, "components/cot-chart.js")).size < 50000, "cot-chart.js under 50,000 bytes");
  assert.doesNotMatch(read("components/share-kit.js") + read("components/share-kit.css"), /—/, "no em dash");
});
