/* "Show the math" and the counter sheet, built in the browser (components/arc-plc-math.js,
 * components/arc-plc-sheet.js, components/qr.js) from data/arc-plc/math/<ST>.json.
 *
 * Until 2026-10-10 the build (scripts/build_arc_plc.py) wrote the math into every county page
 * and a counter sheet page per county. test/fixtures/arc-plc-math.json.gz holds, for 70 counties
 * across every state (bushel and pound crops, irrigated and not, mismatch, pending, withheld,
 * no 2027 price, state-average yields):
 *   pages:  the server-rendered "Show the math" block, cut from the committed county pages
 *   sheets: the <main> of each committed <county>-sheet.html
 *   data:   the same counties' math records as the new build writes them from the same inputs
 * The first tests render the shipped JS on that data and require the old output exactly.
 * The rest check the live tree: every county page's math file renders, agrees with the page's
 * own cards and FAQ, and the old sheet URLs forward.
 *
 *   node --test test/arc-plc-math.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import zlib from "node:zlib";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const ctx = { window: {} };
for (const f of ["components/arc-plc.js", "components/arc-plc-math.js", "components/qr.js"]) vm.runInNewContext(readFileSync(ROOT + f, "utf8"), ctx);
const M = ctx.window.AgArcMath, Q = ctx.window.AgQR;
const FX = JSON.parse(zlib.gunzipSync(readFileSync(ROOT + "test/fixtures/arc-plc-math.json.gz")));
const NAV = JSON.parse(readFileSync(ROOT + "data/arc-plc/nav.json", "utf8"));
const SLUG = Object.fromEntries(Object.entries(NAV.s).map(([k, v]) => [v.slug, k]));
const nums = (s) => (s.match(/\d[\d,]*(?:\.\d+)?/g) || []);
const ENT = { rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", times: "×", middot: "·", amp: "&", quot: '"', lt: "<", gt: ">", nbsp: " " };
const unesc = (s) => s.replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCharCode(parseInt(h, 16))).replace(/&#(\d+);/g, (_m, d) => String.fromCharCode(+d)).replace(/&([a-z]+);/g, (m, n) => ENT[n] ?? m);
const text = (h) => unesc(h.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
const oldBody = (html) => html.slice(html.indexOf("</summary>") + 10, html.indexOf('<p class="ap-small">Break-even prices')).trim();
const fipsOf = (path) => { const [s, c] = path.split("/"); const st = SLUG[s]; return [st, NAV.s[st].c.find((r) => r[2] === c)[0]]; };
const SHEET_CFG = JSON.parse(/<script type="application\/json" id="sh-data">(.*?)<\/script>/s.exec(readFileSync(ROOT + "arc-plc/sheet.html", "utf8"))[1].replace(/<\\\//g, "</"));
const sheetTbody = (doc, f) => M.sheetRows(doc, f).map((r) => {
  const cell = (x) => '<td class="a">' + (x ? SHEET_CFG.icons[x.shape] + x.word : SHEET_CFG.icons.ask + "No answer yet") + "</td>";
  return '<tr><td class="c">' + r.lab + "</td>" + cell(r.ly) + cell(r.oy) + "<td>" + r.why + "</td></tr>";
}).join("");

test("the fixtures cover what they must: 50+ counties, 20+ states, every kind of answer", () => {
  const pages = Object.entries(FX.pages);
  assert.ok(pages.length >= 50, `${pages.length} counties`);
  assert.ok(new Set(pages.map(([p]) => p.split("/")[0])).size >= 20, "states");
  const has = (re) => pages.filter(([, h]) => re.test(h)).length;
  assert.ok(has(/\d lb\b/) >= 10, "pound crops");
  assert.ok(has(/<h3>Irrigated: official/) >= 10, "irrigated");
  assert.ok(has(/does not describe a typical farm/) >= 5, "mismatch");
  assert.ok(has(/Waiting on USDA/) >= 5, "pending 2027");
  assert.ok(has(/Not enough history to say/) >= 1, "withheld");
  assert.ok(has(/No 2027 price yet:/) >= 5, "no 2027 price");
  assert.ok(has(/average for this crop and practice/) >= 3, "state-average county yields");
  assert.ok(has(/no enrolled base for/) >= 3, "benchmark with no enrolled base");
  assert.ok(has(/Nothing from FSA here for/) >= 3, "missing main crops");
  for (const name of ["wisconsin/chippewa-county", "north-dakota/mclean-county", "georgia/mitchell-county"]) assert.ok(FX.pages[name], name);
});

test("Show the math: the browser's build equals what the server used to render, for every fixture county", () => {
  let n = 0;
  for (const [path, html] of Object.entries(FX.pages)) {
    const [st, f] = fipsOf(path);
    const got = M.render(FX.data[st], f);
    assert.ok(got, `${path}: no record for ${f} in the fixture data`);
    const a = oldBody(html), b = got.trim();
    assert.deepEqual(nums(b), nums(a), `${path}: the numbers differ`);
    assert.equal(text(b), text(a), `${path}: the words differ`);
    assert.equal(b, a, `${path}: the markup differs`);
    n++;
  }
  assert.ok(n >= 50, `only ${n} compared`);
});

test("the counter sheet's rows equal the old per-county sheets, for every fixture county", () => {
  let n = 0;
  for (const [path, old] of Object.entries(FX.sheets)) {
    const [st, f] = fipsOf(path);
    const tb = /<tbody>(.*?)<\/tbody>/s.exec(old.main)[1];
    assert.equal(sheetTbody(FX.data[st], f), tb, `${path}: sheet rows`);
    const rows = (tb.match(/<tr>/g) || []).length;
    assert.equal(old.cls, "ap-sheet" + (rows > 13 ? " sh-dense sh-xdense" : rows > 9 ? " sh-dense" : ""), `${path}: density class`);
    n++;
  }
  assert.ok(n >= 50, `only ${n} sheets compared`);
});

test("formatting matches the build's rounding (half up after rounding to 9 places)", () => {
  assert.equal(M.rndStr(2.675, 2), "2.68");      // 2.67499.. in binary; the build prints 2.68
  assert.equal(M.rndStr(0.905, 2), "0.91");
  assert.equal(M.rndStr(1060.4246, 2), "1060.42");
  assert.equal(M.rndStr(9.995, 2), "10.00");
  assert.equal(M.rndStr(0.31499999, 4), "0.3150");
  assert.equal(M.usd(1234567.891), "$1,234,567.89");
  assert.equal(M.pf({ u: "lb" }, 0.315), "$0.3150");
  assert.equal(M.pf({ u: "bu", dp: 4 }, 13.3), "$13.30");
  assert.equal(M.pf({ u: "bu", dp: 4 }, 6.216), "$6.216");
  assert.equal(M.yf({ u: "lb" }, 2037, 2), "2,037.00 lb");
});

/* ------------------------------------------------------------------ the live tree */
const states = {};
const mathDoc = (st) => states[st] || (states[st] = JSON.parse(readFileSync(ROOT + `data/arc-plc/math/${st}.json`, "utf8")));
function countyPages() {
  const out = [];
  for (const sd of readdirSync(ROOT + "arc-plc", { withFileTypes: true }).filter((x) => x.isDirectory())) {
    for (const f of readdirSync(ROOT + "arc-plc/" + sd.name)) {
      if (f.endsWith(".html") && !f.endsWith("-sheet.html")) out.push([sd.name, f]);
    }
  }
  return out;
}

test("every county page: its math file renders, and the page's FAQ and cards say what the math says", () => {
  let pages = 0, faqs = 0, cards = 0;
  for (const [sd, f] of countyPages()) {
    const html = readFileSync(ROOT + `arc-plc/${sd}/${f}`, "utf8");
    const m = /<details class="ap-det ap-mathd" id="math" data-math="\/data\/arc-plc\/math\/([A-Z]{2})\.json" data-f="(\d{5})">/.exec(html);
    assert.ok(m, `${sd}/${f}: Show the math points at its math file`);
    assert.ok(!html.includes('class="ap-kv"'), `${sd}/${f}: the math is no longer in the page`);
    const doc = mathDoc(m[1]), rec = doc.c[m[2]];
    assert.ok(rec && rec.s === f.replace(/\.html$/, ""), `${sd}/${f}: the math file has this county under its own slug`);
    // every tenth county renders in full; the rest skip the break-even scan (about 30 ms a county, and the
    // fixture test above already holds the full render to the old pages), which the FAQ and card checks do not read
    const A = ctx.window.AgArcPlc, scan = A.ranges;
    if (pages % 10) A.ranges = () => [{ w: "none", lo: 0, hi: 0 }];
    let out;
    try { out = M.render(doc, m[2]); } finally { A.ranges = scan; }
    assert.ok(out && out.includes("<b>Sources.</b>"), `${sd}/${f}: renders`);
    // FAQ (built by the build's own verdict_line and why_text) holds the same sentences the math lays out
    const ld = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((x) => JSON.parse(x[1].replace(/<\\\//g, "</")));
    const qa = (ld.find((j) => j["@type"] === "FAQPage") || { mainEntity: [] }).mainEntity;
    for (const q of qa) {
      const mm = /^Should I pick ARC or PLC for (.+) in .+ for (\d{4})\?$/.exec(q.name);
      if (!mm) continue;
      const k = rec.o.find((x) => doc.g.c[x].lc === mm[1]);
      const sec = out.split(/<h2 id="/).find((s) => s.startsWith(k + '"'));
      const v = /<div class="ap-verdict [^"]+"><p><b>[^<]*?, \d{4}: (.*?)<\/b><\/p><p>(.*?)<\/p>/.exec(sec);
      assert.ok(v, `${f} ${k}: the math has a verdict block`);
      const ans = q.acceptedAnswer.text;
      assert.ok(ans.includes(text(v[1])) && ans.includes(text(v[2])), `${f} ${k}: FAQ and math disagree\nFAQ:  ${ans}\nMATH: ${text(v[1])} ${text(v[2])}`);
      faqs++;
    }
    // the card's About-the-same answer for each crop (its data-t, both years) equals the math file's verdict for that practice
    for (const c of html.matchAll(/<div class="ap-lv" data-k="([a-z_]+)" data-e="([a-z]+)(?::[^"]*)?" data-py="[\d.]+" data-t="([^"]+)" data-lv="same">/g)) {
      const [, k, d, t] = c;
      const i = rec.ci[k];
      assert.equal(rec.e[k][i].d, d, `${f} ${k}: card practice`);
      for (const part of t.split("|")) {
        const [y, w, pc, ac] = part.split(":");
        const p = rec.v[k][i][y];
        assert.equal(p[0], w, `${f} ${k} ${y}: card ${w}, math ${p[0]}`);
        if (p.length > 2) {
          // the card carries cents() of the payment, the math the cents usd() prints; they differ only on a half cent
          assert.ok(Math.abs(p[1] - +pc) <= 1 && Math.abs(p[2] - +ac) <= 1, `${f} ${k} ${y}: card ${pc}/${ac}, math ${p[1]}/${p[2]}`);
        }
        cards++;
      }
    }
    pages++;
  }
  assert.ok(pages >= 2700, `only ${pages} county pages`);
  assert.ok(faqs >= 2500, `only ${faqs} FAQ answers checked`);
  assert.ok(cards >= 10000, `only ${cards} card answers checked`);
});

test("county pages carry key numbers and the shared sheet link; old sheet URLs are tiny forwards; no sheet in a sitemap", () => {
  let n = 0;
  for (const [sd, f] of countyPages()) {
    const html = readFileSync(ROOT + `arc-plc/${sd}/${f}`, "utf8");
    const slug = f.replace(/\.html$/, "");
    assert.ok(html.includes(`href="/arc-plc/sheet?c=${sd}/${slug}"`), `${f}: sheet link`);
    assert.ok(!html.includes(`${slug}-sheet"`), `${f}: no link to the old sheet URL`);
    assert.ok(html.includes('<h2 id="key-numbers">Key numbers</h2>'), `${f}: key numbers`);
    const stub = ROOT + `arc-plc/${sd}/${slug}-sheet.html`;
    assert.ok(existsSync(stub), `${slug}-sheet.html kept for links made before 2026-10-10`);
    const s = readFileSync(stub, "utf8");
    assert.ok(Buffer.byteLength(s) < 1024, `${slug}-sheet.html is ${Buffer.byteLength(s)} bytes`);
    assert.ok(s.includes(`url=/arc-plc/sheet?c=${sd}/${slug}"`) && s.includes(`location.replace("/arc-plc/sheet?c=${sd}/${slug}"`)
      && s.includes(`rel="canonical" href="https://agsist.com/arc-plc/${sd}/${slug}"`), `${slug}-sheet.html forwards`);
    n++;
  }
  assert.ok(n >= 2700, `only ${n} counties`);
  for (const sm of readdirSync(ROOT).filter((x) => /^sitemap.*\.xml$/.test(x))) assert.ok(!/-sheet|arc-plc\/sheet/.test(readFileSync(ROOT + sm, "utf8")), `${sm} lists a sheet`);
  const sheet = readFileSync(ROOT + "arc-plc/sheet.html", "utf8");
  assert.ok(sheet.includes('content="noindex,follow"'), "the shared sheet is noindex");
  const withPages = readdirSync(ROOT + "arc-plc", { withFileTypes: true }).filter((x) => x.isDirectory()).map((x) => x.name);
  assert.ok(withPages.length >= 45, `${withPages.length} state folders`);
  for (const s of withPages) assert.ok(SHEET_CFG.states[s] && existsSync(ROOT + `data/arc-plc/math/${SHEET_CFG.states[s]}.json`), `the sheet knows ${s} and its math file`);
});

test("the math files stay small enough to load on a phone", () => {
  let n = 0;
  for (const f of readdirSync(ROOT + "data/arc-plc/math")) {
    const b = readFileSync(ROOT + "data/arc-plc/math/" + f).length;
    assert.ok(b < 1024 * 1024, `${f} is ${b} bytes`);
    n++;
  }
  assert.ok(n >= 45, `only ${n} math files`);
});

/* ------------------------------------------------------------------ QR */
const urls = countyPages().filter((_x, i) => i % 55 === 0).slice(0, 50).map(([sd, f]) => `https://agsist.com/arc-plc/${sd}/${f.replace(/\.html$/, "")}`);
const bits = (m) => m.map((r) => r.map((v) => (v ? "1" : "0")).join("")).join("");

test("QR: the browser's encoder gives the symbol the build's selftest pins, and the same as scripts/qr_svg.py for 50 county URLs", (t) => {
  assert.ok(urls.length >= 50, `${urls.length} URLs`);
  const chip = Q.matrix("https://agsist.com/arc-plc/wisconsin/chippewa-county");
  assert.equal(chip.length, 33);
  // the sha256 build_arc_plc.py --selftest pins for the symbol jsQR 1.4.0 decoded on 2026-10-09
  const { createHash } = createRequire(import.meta.url)("node:crypto");
  assert.equal(createHash("sha256").update(bits(chip)).digest("hex"), "53f0997e75ec4eea2bde0ddde10308671f6c95b883fec9e80342241a9de69f15");
  let py;
  try {
    py = JSON.parse(execFileSync("python3", ["-c", "import json,sys; sys.path.insert(0, 'scripts'); import qr_svg; " +
      "print(json.dumps([''.join(''.join('1' if v else '0' for v in r) for r in qr_svg.qr_matrix(u)) for u in json.load(sys.stdin)]))"],
      { cwd: ROOT, input: JSON.stringify(urls) }).toString());
  } catch (e) { return t.skip("python3 not available: " + e.message); }
  urls.forEach((u, i) => assert.equal(bits(Q.matrix(u)), py[i], u));
});

test("QR: jsQR reads every one of the 50 symbols back to its URL", (t) => {
  let jsQR = null;
  for (const p of [process.env.JSQR_PATH, "jsqr"].filter(Boolean)) { try { jsQR = createRequire(import.meta.url)(p); break; } catch (e) { /* next */ } }
  if (!jsQR) return t.skip("jsqr is not installed (npm i jsqr@1.4.0, or set JSQR_PATH)");
  for (const u of urls) {
    const m = Q.matrix(u), s = 6, n = (m.length + 8) * s, px = new Uint8ClampedArray(n * n * 4).fill(255);
    m.forEach((row, y) => row.forEach((v, x) => {
      if (!v) return;
      for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) { const o = (((y + 4) * s + dy) * n + (x + 4) * s + dx) * 4; px[o] = px[o + 1] = px[o + 2] = 0; }
    }));
    const r = jsQR(px, n, n);
    assert.ok(r && r.data === u, `${u}: read ${r && r.data}`);
  }
});
