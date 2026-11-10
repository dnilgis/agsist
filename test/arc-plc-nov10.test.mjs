/* ARC or PLC fixes, Nov 10, 2026. Each case is the real page that showed the problem.
 *
 *   1. Story Co., IA wheat (Close) said "no dollar figure is printed" above the printed example-price line, gave the
 *      wrong reason ("too little price history": wheat has no October futures spread of its own and borrows corn's)
 *      and "stops at Leans" on a Close card. Now: why the expected payments are not printed, per crop; "held at Leans"
 *      only where the borrowed swings lowered a clear pick; the example-price line labelled as an example.
 *   2. The main page said "No pick is given for these crops yet" while the crop pages (oats hub) give one.
 *   3. Source clauses and FSA file dates sat in the reading path; the 2025-payments block sat mid-page.
 *   5. Sumner Co., KS soybeans led with the irrigated answer in a dryland county; an irrigated entry figured with the
 *      all-practice PLC yield (irrigated corn: 86.5 bu on a 200.64 bu benchmark) got a typical-farm answer. Now the card
 *      leads with the main practice, and a PLC yield under 60% of the benchmark has no typical-farm answer.
 *   7. The main page's top repeated corn with a tier count.
 *   9. Formulas, the worked example and the benchmark-yield method move into the closed fold.
 *   c. The tiers step down evenly: Pick from $3, Leans from $2; no gap can be Pick or Close but never Leans.
 *   f. The track-record line says it counts how often ARC-CO paid more.
 *   4, 6. The calculator adds the farm total once base acres are typed, and the 2027 assumption line describes the
 *      2027 run (browser, below).
 *
 * Reads the built pages (the PR checks rebuild the set before the tests). Needs Playwright and Chromium for the last test.
 *   node --test test/arc-plc-nov10.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (f) => readFileSync(ROOT + f, "utf8");
const text = (h) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ")
  .replace(/&rsquo;/g, "’").replace(/&middot;/g, "·").replace(/&amp;/g, "&").replace(/\s+/g, " ");
// one plain reason for every withheld crop, wheat and the small crops alike, with no word of whose price swings
const WHY = "Expected payments are not printed for this crop: it does not have enough of its own price history.";
const WHY_FEW = WHY;
const CAP = "Too little price history for a clear pick: shown as Leans.";
const card = (h, k) => { const m = new RegExp(`<article class="ap-crop" id="crop-${k}"[\\s\\S]*?</article>`).exec(h); return m ? m[0] : null; };
// the new-base source line as the build writes it (NEWBASE_SRC), read from the builder, not typed here
const NEWBASE = /^NEWBASE_SRC = "([^"]+)"/m.exec(read("scripts/build_arc_plc.py"))[1];
const foldAt = (h) => h.indexOf('<details class="ap-det" id="terms">');

test("1: Story Co., IA wheat: the real reason, no Leans on a Close card, the example price labelled", () => {
  const h = read("arc-plc/iowa/story-county.html"), c = card(h, "wheat");
  assert.ok(c, "wheat card");
  const gap = text(/<div class="ap-lv"[\s\S]*?<\/div><p>([\s\S]*?)<\/p>/.exec(c)[1]).trim();
  const w = /data-p="([a-z_]+),/.exec(c)[1], f = +/data-p="[a-z_]+,\d+,(\d+),/.exec(c)[1];
  assert.ok(gap.includes(WHY), gap);
  assert.ok(!/no dollar figure|too little price history/.test(text(h)), "old words gone");
  if (w === "close" || w === "none") assert.ok(!/Leans/.test(gap), "a Close card says nothing about Leans: " + gap);
  assert.equal(gap.includes(CAP), !!(f & 512), "held at Leans exactly when the pack says the cap lowered a pick");
  const at = /<p class="ap-at50">([\s\S]*?)<\/p>/.exec(c);
  if (at) assert.match(text(at[1]), /^At \$[\d.]+, one example price, not a forecast \(/, "the fixed-price line is labelled");
});

test("1: every borrowed card on every county page: the reason for its crop, Leans only when capped", () => {
  const nav = JSON.parse(read("data/arc-plc/nav.json"));
  let n = 0;
  for (const [st, S] of Object.entries(nav.s)) {
    for (const row of S.c) {
      if (!row[2]) continue;
      const p = `arc-plc/${S.slug}/${row[2]}.html`;
      if (!existsSync(ROOT + p)) continue;
      const h = read(p);
      if (h.includes('name="agsist-pointer"')) continue;
      for (const m of h.matchAll(/<article class="ap-crop" id="crop-([a-z_]+)"[\s\S]*?data-p="([a-z_]+),(\d+),(\d+),[^"]*">[\s\S]*?<\/div><p>([\s\S]*?)<\/p>/g)) {
        const [, k, w, , fs, g] = m, f = +fs;
        if (!(f & 64)) continue;
        const t = text(g);
        assert.ok(t.includes(f & 128 ? WHY_FEW : WHY), `${p} ${k}: ${t}`);
        if (w === "close") assert.ok(!/Leans/.test(t), `${p} ${k}: Leans on a Close card`);
        assert.equal(t.includes(CAP), !!(f & 512), `${p} ${k}: cap line only when capped`);
        n++;
      }
    }
    void st;
  }
  assert.ok(n >= 1000, `only ${n} borrowed cards read`);
});

test("2: the main page says what the crop pages do for the smaller crops (oats hub)", () => {
  const m = text(read("arc-plc.html")), o = read("arc-plc/oats.html");
  assert.doesNotMatch(m, /No pick is given for these crops/);
  assert.match(m, /For 2026 each county page gives these crops a call for a typical farm\. .*the call goes no higher than Leans and expected payments are not printed\. There is no 2027 call for them yet\./);
  const v = /<b>Typical-farm verdicts, 2026:<\/b> ([^<]*)<\/p>/.exec(o);
  assert.ok(v, "the oats hub gives verdicts");
  assert.ok(!/(PLC|ARC-CO) expected to pay more \d/.test(v[1]), "no clear pick for a borrowed crop: " + v[1]);
  assert.ok(text(v[1]).includes(WHY_FEW), "the hub says why there are no expected dollars");
  assert.ok(o.indexOf("FSA tables as of") > foldAt(o), "the FSA table date sits in the fold");
});

test("3: no source clause or FSA file date in the reading path; the 2025-payments block after the questions", () => {
  for (const p of ["arc-plc.html", "arc-plc/iowa.html", "arc-plc/iowa/story-county.html", "arc-plc/kansas/sumner-county.html", "arc-plc/oats.html"]) {
    const h = read(p), at = foldAt(h);
    assert.ok(at > 0, `${p}: fold`);
    const before = h.slice(0, at);
    assert.doesNotMatch(before, /Source: USDA FSA ARC\/PLC page|FSA file as of|FSA tables as of/, `${p}: a source clause before the fold`);
    assert.ok(h.slice(at).includes(NEWBASE), `${p}: the new-base source in the fold`);
  }
  const m = read("arc-plc.html");
  assert.match(m.slice(foldAt(m)), /FSA county file as of [A-Z][a-z]{2} \d+, 20\d\d\./);
  assert.match(m, /FSA&rsquo;s official ARC-CO benchmark yields for program year 2026 cover [\d,]+ counties\./, "the fact sentence stays");
  const pay = m.indexOf('id="answer-usda-payments"');
  assert.ok(pay > m.indexOf('<h2 id="faq">') && pay < foldAt(m), "the 2025-payments block sits after the questions, before the fold");
});

test("5: Sumner Co., KS: soybeans lead with the dryland answer; irrigated soybeans and corn have no typical-farm answer", () => {
  const h = read("arc-plc/kansas/sumner-county.html"), soy = card(h, "soybeans");
  assert.match(soy, /<h3>Soybeans &middot; non-irrigated<\/h3>/);
  assert.match(soy, /data-e="non"/);
  const KS = JSON.parse(read("data/arc-plc/math/KS.json")), r = KS.c["20191"];
  for (const k of ["soybeans", "corn"]) {
    const i = r.e[k].findIndex((e) => e.d === "irr");
    assert.ok(i >= 0 && r.py[k] < 0.6 * r.e[k][i].by, `${k}: PLC yield ${r.py[k]} under 60% of the irrigated ${r.e[k][i].by}`);
    for (const y of ["2026", "2027"]) {
      const p = r.v[k][i][y];
      assert.equal(p[0], "mismatch", `${k} irrigated ${y}: no typical-farm answer`);
      assert.equal(p[3], 1, `${k} irrigated ${y}: marked under 60% of the benchmark`);
    }
    assert.equal(r.e[k][r.ci[k]].d, "non", `${k}: the card and the counter sheet lead with non-irrigated`);
  }
  assert.match(text(card(h, "corn")), /Irrigated ground: (?!leans|ARC-CO\.|PLC\.)/, "the irrigated line gives the range answer, not a call");
});

test("5: every county: a PLC yield under 60% of an entry's benchmark gets no typical-farm answer, and says why", () => {
  const nav = JSON.parse(read("data/arc-plc/nav.json"));
  let low = 0;
  for (const st of Object.keys(nav.s)) {
    const f = `data/arc-plc/math/${st}.json`;
    if (!existsSync(ROOT + f)) continue;
    for (const [fips, r] of Object.entries(JSON.parse(read(f)).c)) {
      for (const [k, es] of Object.entries(r.e)) {
        const py = r.py[k];
        if (!py) continue;
        es.forEach((e, i) => {
          const row = (r.v[k] || [])[i];
          if (!e.by || !row || !row["2026"]) return;
          if (Math.round(py * 10) / 10 < 0.6 * e.by) {
            assert.equal(row["2026"][0], "mismatch", `${st} ${fips} ${k} ${e.d}: ${py} on ${e.by}`);
            assert.equal(row["2026"][3], 1, `${st} ${fips} ${k} ${e.d}: under-60% mark`);
            low++;
          }
        });
      }
    }
  }
  assert.ok(low >= 500, `only ${low} entries under 60%`);
  const ctx = { window: {} };
  for (const f of ["components/arc-plc.js", "components/arc-plc-math.js"]) vm.runInNewContext(read(f), ctx);
  const M = ctx.window.AgArcMath;
  assert.match(M.verdictLine(M.unpack(["mismatch", "none", "neither pays", 1]), { min_scen: 8 }), /is under 60% of this benchmark yield/);
  assert.match(M.verdictLine(M.unpack(["mismatch", "none", "neither pays"]), { min_scen: 8 }), /is above this benchmark yield/);
  const sctx = { window: {} };
  vm.runInNewContext(read("components/arc-plc-simple.js"), sctx);
  const C = sctx.window.AgArcCard;
  const cardCfg = { lc: "corn", cen: "$4.70", pu: "$4.42 a bushel", oth: "", irr: true, ly: "2026", oy: "2027", rng: { ly: ["ARC-CO", "lean_arc", "ARC-CO at any PLC yield.", "200.6 bu"] } };
  assert.match(C.level(cardCfg, "mismatch,0,256,0,mismatch,", "lean_arc"), /A PLC yield that low is under 60% of the 200\.6 bu benchmark\. ARC-CO at any PLC yield\./);
  assert.match(C.level(cardCfg, "mismatch,0,256,0,mismatch,", "mismatch"), /ARC-CO at any PLC yield\. The county average PLC yield is under 60% of this 200\.6 bu benchmark/);
  assert.match(C.level(cardCfg, "mismatch,0,0,0,mismatch,", "lean_arc"), /A PLC yield that high is above the 200\.6 bu benchmark\./);
});

test("7, 9, c, f: the main page's top, the fold, the tiers and the track-record line", () => {
  const m = read("arc-plc.html"), at = foldAt(m), top = m.slice(0, m.indexOf('class="ap-dead"'));
  assert.equal((text(top).match(/Corn:/g) || []).length, 1, "corn named once at the top");
  assert.doesNotMatch(top, /pick ARC-CO \d|across [\d,]+ county and practice combinations:/, "no tier count at the top");
  const how = /<h2 id="how">[^<]*<\/h2>\s*<p>([\s\S]*?)<\/p>/.exec(m);
  assert.ok(how && !/<ul|&minus;|&times;/.test(how[1]) && /Sources and terms/.test(how[1]), "one plain line under How do they pay");
  for (const s of ["<b>PLC rate</b> =", "A worked example (made-up corn farm", "Olympic average of the county&rsquo;s five most recent yields"]) {
    assert.ok(m.indexOf(s) > at, `${s} sits in the closed fold`);
    assert.equal(m.split(s).length, 2, `${s} once`);
  }
  assert.ok(!/<details class="ap-det" id="terms"[^>]*\bopen\b/.test(m), "the fold is closed");
  const fold = text(m.slice(at));
  // the tiers in plain words only: no dollar or year cutoffs (test/arc-plc-method-plain.test.mjs reads the fold for them)
  assert.match(fold, /Each answer is one of three: a clear pick, a lean toward one program, or too close to call\./);
  assert.doesNotMatch(fold, /\$\d+ or more|ahead in at least/);
  assert.match(fold, /How often ARC-CO paid more, not how often a verdict was right: nationally, over \d+ crop-year results \([a-z, ]+, \d{4} to \d{4}\), ARC-CO paid more than PLC in \d+ and PLC paid more in \d+/);
  assert.match(m, /id="ap-y-hint">County average, not your farm\. Left at the benchmark yield, it is a normal crop\.</, "the county yield hint agrees with normal crop = benchmark");
  assert.doesNotMatch(m + read("components/arc-plc-form.js"), /a bit above this/);
});

test("c: the calculator's call steps down evenly, the same as the build's", () => {
  const ctx = { window: {} };
  vm.runInNewContext(read("components/arc-plc.js"), ctx);
  const A = ctx.window.AgArcPlc;
  assert.equal(A.call(2.5, 0, 2.5, 0.5, 6, 0, 11), "lean_plc", "$2.50, tight swing: Leans");
  assert.equal(A.call(2.5, 0, 2.5, 2.4, 6, 0, 11), "lean_plc", "$2.50, wider swing: still Leans");
  assert.equal(A.call(1.99, 0, 1.99, 0.1, 6, 0, 11), "close");
  assert.equal(A.call(3, 0, 3, 0.5, 6, 0, 11), "plc");
  for (let g = 0; g <= 60; g++) for (let s = 0; s <= 40; s++) {
    const v = A.call(g / 4, 0, g / 4, s / 4, 6, 0, 11);
    if (v === "plc") assert.equal(A.call(g / 4, 0, g / 4, g / 4, 6, 0, 11), "lean_plc", `a Pick gap ${g / 4} with its swing as wide as the gap is Leans, not Close`);
  }
  const b = read("scripts/build_arc_plc.py");
  assert.match(b, /^MIN_GAP = 3\.00 /m);
  assert.match(b, /^LEAN_GAP = 2\.00 /m);
  assert.match(read("components/arc-plc.js"), /var MIN_SCEN = 8, MIN_GAP = 3, LEAN_GAP = 2, MIN_WINS = 3;/);
});

/* the calculator in a browser: Story Co., IA corn on 200 base acres */
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;
function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const f = normalize(join(ROOT, p === "/" ? "/index.html" : p));
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

test("4, 6: base acres give the farm total beside each call; the 2027 assumption line describes the 2027 run", { skip, timeout: 90000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
    const pg = await ctx.newPage();
    await pg.route("**/*", (r) => (r.request().url().startsWith(`http://127.0.0.1:${port}`) ? r.continue() : r.abort()));
    await pg.goto(`http://127.0.0.1:${port}/arc-plc.html?crop=corn&st=IA&fips=19169&py=150&base=200&year=2026`, { waitUntil: "load" });
    await pg.waitForFunction(() => document.querySelectorAll(".ap-decide .ap-verdict").length >= 2, null, { timeout: 30000 });
    const blocks = await pg.$$eval(".ap-decide .ap-verdict", (els) => els.map((e) => e.textContent.replace(/\s+/g, " ").trim()));
    const calls = blocks.filter((t) => /^(2026|2027): (PLC|ARC-CO|Leans|close|neither)/i.test(t));
    assert.ok(calls.length >= 1, blocks.join(" | "));
    for (const t of calls) assert.match(t, /On 200 base acres: PLC \$[\d,]+ vs ARC-CO \$[\d,]+ expected, before the 5\.7% sequestration cut\./, t);
    const b7 = blocks.find((t) => t.startsWith("2027:"));
    if (b7 && /On these assumptions/.test(b7)) {
      assert.match(b7, /each year from \d{4} to \d{4} with that year’s price change and (this county’s yield|the state’s county yield)/, b7);
      assert.doesNotMatch(b7, /listed under Scenarios/);
    }
    // wheat: expected dollars withheld, so no farm total
    await pg.goto(`http://127.0.0.1:${port}/arc-plc.html?crop=wheat&st=IA&fips=19169&py=50&base=200&year=2026`, { waitUntil: "load" });
    await pg.waitForFunction(() => document.querySelectorAll(".ap-decide .ap-verdict").length >= 1, null, { timeout: 30000 });
    const w = await pg.$eval(".ap-decide .ap-verdict", (e) => e.textContent.replace(/\s+/g, " ").trim());
    assert.doesNotMatch(w, /On 200 base acres/, w);
    assert.ok(w.includes(WHY), w);
    assert.doesNotMatch(w, /borrow|corn’s (price swings|October)/i, w);
  } finally { await browser.close(); srv.close(); }
});
