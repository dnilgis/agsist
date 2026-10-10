/* The one grain-price formatter (components/util.js, window.AG.px).
 *
 * The shipped file runs in a bare context, so a green run checks the copy the
 * browser loads. The second half walks every page and component that prints a
 * grain price and fails, by filename, if one of them carries its own
 * quarter-cent formatter again.
 *
 *   node --test test/pricefmt.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const ctx = { window: {} };
vm.runInNewContext(readFileSync(ROOT + "components/util.js", "utf8"), ctx);
const P = ctx.window.AG.px;

test("a close prints to the quarter cent, never to the whole cent", () => {
  assert.equal(P.price(480.5), "$4.80½");
  assert.equal(P.price(480.5, { style: "slash" }), "$4.80 1/2");
  assert.equal(P.price(480), "$4.80");
  assert.equal(P.price(1292.25), "$12.92¼");
  assert.equal(P.price(670.75), "$6.70¾");
  assert.equal(P.price(5), "$0.05");
  assert.equal(P.priceDollars(4.805), "$4.80½");
  assert.equal(P.priceDollars(4.3125, { style: "slash", fracClass: "f" }), '$4.31<span class="f"> 1/4</span>');
});

test("float noise does not move a quarter", () => {
  assert.equal(P.price(480.49999999), "$4.80½");
  assert.equal(P.price(4.805 * 100), "$4.80½");
  assert.equal(P.price(0.1 * 3 * 100), "$0.30");
});

test("range ends are never rounded inward", () => {
  // exact quarters print exactly
  assert.deepEqual({ ...P.range(410.25, 512.75) }, { lo: "$4.10¼", hi: "$5.12¾" });
  // an off-quarter low goes down, an off-quarter high goes up
  assert.deepEqual({ ...P.range(410.3, 512.6) }, { lo: "$4.10¼", hi: "$5.12¾" });
  assert.deepEqual({ ...P.range(410.26, 512.51) }, { lo: "$4.10¼", hi: "$5.12¾" });
});

test("moves and changes", () => {
  assert.equal(P.move(19.75), "19¾¢");
  assert.equal(P.move(-19.75, { sign: true }), "−19¾¢");
  assert.equal(P.move(0.25, { sign: true }), "+¼¢");
  assert.equal(P.move(20.75, { style: "slash" }), "20 3/4¢");
  assert.equal(P.move(0.5, { style: "slash" }), "1/2¢");
  assert.equal(P.move(0), "0¢");
  assert.equal(P.pct(-3.951), "−3.95%");
  assert.equal(P.pct(0.001), "0.00%");
  assert.equal(P.pct(0.37, { dp: 1 }), "+0.4%");
  assert.deepEqual({ ...P.change(-19.75, -3.95) }, { t: "▼ −19¾¢ (−3.95%)", c: "dn" });
  assert.deepEqual({ ...P.change(0, 0) }, { t: "unch", c: "nc" });
  assert.deepEqual({ ...P.change(null, 1) }, { t: "", c: "nc" });
});

test("a missing value prints nothing, a zero prints zero", () => {
  assert.equal(P.price(null), "");
  assert.equal(P.price(undefined), "");
  assert.equal(P.price("x"), "");
  assert.equal(P.price(0), "$0.00");
});

/* ── No second copy ───────────────────────────────────────────────────── */
const SURFACES = [
  "index.html", "markets.html", "corn-futures-prices.html", "soybean-futures-prices.html",
  "wheat-futures-prices.html", "fast-facts.html", "components/bids-homepage.js",
  "components/cb-myelev.js", "components/cb-rank.js", "components/geo.js",
  "components/homepage-extras.js", "components/storesell.js", "components/cb-glance.js",
  "components/futures.js",
];
/* The tell-tale of a home-made quarter formatter: a fraction lookup table. */
const COPY = /\[\s*''\s*,\s*'(?:1\/4|\\u00bc|¼)'|f===1\?'(?:1\/4|¼|\\u00bc)'|f===0\.25\?/;

test("no page or component carries its own quarter-cent formatter", () => {
  let seen = 0;
  for (const f of SURFACES) {
    let src;
    try { src = readFileSync(ROOT + f, "utf8"); } catch { continue; }
    seen++;
    const m = COPY.exec(src);
    assert.ok(!m, `${f} has its own quarter-cent formatter near: ${m && src.slice(m.index - 60, m.index + 40)}`);
  }
  assert.ok(seen >= 12, `only ${seen} surfaces read; files have moved`);
});

test("every page that prints grain prices loads util.js before its own code", () => {
  for (const f of ["index.html", "markets.html", "corn-futures-prices.html", "soybean-futures-prices.html",
    "wheat-futures-prices.html", "fast-facts.html", "cash-bids.html", "spray.html", "fertilizer.html",
    "cattle-futures-prices.html"]) {
    const src = readFileSync(ROOT + f, "utf8");
    const u = src.indexOf("/components/util.js");
    assert.ok(u > 0, `${f} does not load components/util.js`);
    const firstUse = src.search(/AG\.px\.|components\/geo\.js|components\/futures\.js/);
    if (firstUse > 0) assert.ok(u < firstUse, `${f} uses AG.px before util.js loads`);
  }
});

/* The build's twin (scripts/pricefmt.py) must print the same characters, or a
   baked seed changes the moment the page script runs. */
import { execFileSync } from "node:child_process";
test("scripts/pricefmt.py prints exactly what util.js prints", () => {
  const vals = [480.5, 480.49999999, 480, 1292.25, 670.75, 5, 0, -3.1, 410.3, 512.6, 1335.25, 0.125 * 100, 19.75, -19.75, 0.25, 0.5];
  const cases = [], js = [];
  for (const v of vals) {
    for (const style of ["glyph", "slash"]) {
      cases.push({ fn: "price", args: [v], kw: { style } }); js.push(P.price(v, { style }));
      cases.push({ fn: "move", args: [v], kw: { style, sign: true } }); js.push(P.move(v, { style, sign: true }));
    }
    cases.push({ fn: "pct", args: [v / 100] }); js.push(P.pct(v / 100));
    const ch = P.change(v, v / 100); cases.push({ fn: "change", args: [v, v / 100] }); js.push([ch.t, ch.c]);
    const r = P.range(v, v + 100.1); cases.push({ fn: "range", args: [v, v + 100.1] }); js.push([r.lo, r.hi]);
  }
  const py = JSON.parse(execFileSync("python3", [ROOT + "scripts/pricefmt.py", "--json"], { input: JSON.stringify(cases) }).toString());
  assert.equal(py.length, js.length);
  for (let i = 0; i < js.length; i++) assert.deepEqual(py[i], js[i], `case ${JSON.stringify(cases[i])}`);
});

/* index.html once declared `var AG = /corn|.../` at the top level of a page
   script, which replaced window.AG (and AG.px with it) for every script after
   it. No page may declare a variable named AG. */
test("no page script declares its own AG", () => {
  let seen = 0;
  for (const f of SURFACES.concat(["cash-bids.html", "spray.html", "fertilizer.html", "cattle-futures-prices.html", "store-or-sell.html"])) {
    let src; try { src = readFileSync(ROOT + f, "utf8"); } catch { continue; }
    seen++;
    assert.ok(!/(?:^|[;{\s])(?:var|let|const)\s+AG\s*=/.test(src), `${f} declares a variable named AG`);
  }
  assert.ok(seen >= 14, `only ${seen} files read`);
});
