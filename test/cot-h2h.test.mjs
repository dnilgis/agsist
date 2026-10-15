/* /cot, the 2026-10-15 head-to-head fixes:
 *  - The Read opens with corn and soybeans every week, newsworthy pick second
 *  - the page's code lives in components/, and the one-market panel
 *    (what followed, the past weeks like today) loads only when opened
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");
const HTML = read("cot.html");

function liftFn(src, name, file) {
  const i = src.indexOf("function " + name + "(");
  assert.ok(i >= 0, `${file} no longer defines ${name}()`);
  let d = 0, j = src.indexOf("{", i);
  for (; j < src.length; j++) {
    if (src[j] === "{") d++;
    else if (src[j] === "}" && --d === 0) break;
  }
  return src.slice(i, j + 1);
}

test("cot.html carries its words, not its code", () => {
  const bytes = Buffer.byteLength(HTML);
  assert.ok(bytes < 100_000, `cot.html is ${bytes} bytes; it was 181 KB with the code inline`);
  for (const m of HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
    assert.ok(m[1].length < 5000, "a large inline script is back in cot.html: " + m[1].slice(0, 80));
  }
  assert.match(HTML, /<script src="\/components\/cot-page\.js\?v=\d+"><\/script>/);
  assert.match(HTML, /<script src="\/components\/cot-analysis\.js\?v=\d+"><\/script>/);
  // What a search engine reads stays in the HTML.
  assert.match(HTML, /<!-- PRERENDER:cot-summary -->Managed-money positioning/);
  assert.match(HTML, /application\/ld\+json/);
});

test("the one-market panel is fetched only when a market is opened", () => {
  const A = read("components/cot-analysis.js");
  const M = read("components/cot-market.js");
  assert.doesNotMatch(HTML, /cot-market\.js/, "the panel must not load with the page");
  assert.match(A, /s\.src = '\/components\/cot-market\.js\?v=\d+'/);
  assert.match(A, /IntersectionObserver/);
  assert.match(A, /false, true\);/, "the default market opens quietly (when near), not on load");
  for (const t of ["The past weeks that look most like today", "Show the arithmetic behind this panel"]) {
    assert.ok(M.includes(t), `cot-market.js lost "${t}"`);
    assert.ok(!A.includes(t), `"${t}" is back in the eager script`);
  }
  assert.match(M, /window\.cotMarket = function \(api\)/);
});

function renderRead(analysis) {
  const JS = read("components/cot-page.js");
  const box = { style: { display: "none" } }, body = { innerHTML: "" };
  const ctx = {
    esc: (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]),
    document: { getElementById: (id) => (id === "cot-read" ? box : id === "cot-read-body" ? body : null) },
    CX_A: analysis,
    cxAligned: () => true,
  };
  vm.createContext(ctx);
  vm.runInContext(liftFn(JS, "renderTheRead", "components/cot-page.js") + "\nrenderTheRead();", ctx);
  return { box, body };
}

test("The Read: corn, then soybeans, then the week's newsworthy market", () => {
  const a = JSON.parse(read("data/cot-analysis.json"));
  assert.deepEqual(a.grain_lines.map((g) => g.key), ["corn", "beans"]);
  const { box, body } = renderRead(a);
  assert.equal(box.style.display, "block");
  const h = body.innerHTML;
  const iCorn = h.indexOf("<b>Corn</b>"), iBeans = h.indexOf("<b>Soybeans</b>"), iRead = h.indexOf("<b>" + a.read.label + "</b>");
  assert.ok(iCorn >= 0 && iCorn < iBeans && iBeans < iRead,
    "corn and soybeans must lead The Read, every week");
  assert.match(h, /Also this week/);
  // Oct 6 2026 report, checked by hand: 393,249 - 63,410 = 329,839; 381,220 - 329,839 = 51,381.
  assert.match(h, /funds are net long 329,839 contracts, 51,381 fewer than last week/);
});

test("The Read still works on an analysis file written before grain_lines", () => {
  const { box, body } = renderRead({ read: { label: "Lean Hogs", text: "a sentence." } });
  assert.equal(box.style.display, "block");
  assert.equal(body.innerHTML, '<p class="cot-read-line"><b>Lean Hogs</b>: a sentence.</p>');
  assert.equal(renderRead({}).box.style.display, "none");
});
