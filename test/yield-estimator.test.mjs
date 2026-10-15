/* /yield-estimator: the math in components/yield-est.js (loaded by the page),
 * the several-site average, the kernels-per-bushel default, and what the
 * structured data claims.
 *
 *   node --test test/yield-estimator.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (f) => readFileSync(ROOT + f, "utf8");
const ctx = { window: {} };
vm.runInNewContext(read("components/yield-est.js"), ctx);
const Y = ctx.window.AgYield;
const html = read("yield-estimator.html");
const near = (a, b, msg, tol = 0.05) => assert.ok(Math.abs(a - b) < tol, `${msg}: ${a} vs ${b}`);

test("corn by hand, 85,000 kernels per bushel by default", () => {
  assert.equal(Y.KPB_DEFAULT, 85000);
  near(Y.cornYield(34, 16, 32), 34000 * 512 / 85000, "34 x 16 x 32 / 85 = 204.8");
  near(Y.cornYield(34, 16, 32, 90000), 193.4, "the original 90,000 rule");
  near(Y.cornYield(34, 16, 32, 80000), 217.6, "80,000");
  assert.equal(Y.cornYield(null, 16, 32), null, "a blank box gives no yield, not a default");
});

test("soybeans by hand", () => {
  near(Y.beanYield(125, 25, 2.5, 3000), 43.4, "125k x 25 x 2.5 / (3,000 x 60)");
  assert.equal(Y.beanYield(125, 25, 2.5, null), null, "blank seeds per pound gives nothing");
});

test("several sites: plain mean, spread, incomplete sites left out and counted", () => {
  const a = Y.average([204.8, 180.7, null]);
  near(a.mean, (204.8 + 180.7) / 2, "mean of the complete sites");
  assert.equal(a.n, 2); assert.equal(a.skipped, 1);
  near(a.lo, 180.7, "low site"); near(a.hi, 204.8, "high site");
  assert.equal(Y.average([null, null]), null, "no complete site, no number");
  assert.equal(Y.MAX_SITES, 5);
});

test("the page loads the shared math and offers up to 5 sites", () => {
  assert.match(html, /<script src="\/components\/yield-est\.js\?v=\d+"><\/script>/);
  assert.ok(!/kernels\/90000|\/90000\b/.test(html), "no hard-coded 90,000 divisor left in the page script");
  assert.ok(html.includes('id="c-sites"') && html.includes('id="b-sites"'), "a site bar on each tab");
  assert.match(html, /<option value="85000" selected>85,000<\/option>/, "85,000 is the default pick");
  assert.ok(html.includes('<option value="90000">90,000</option>'), "90,000 still offered as the original rule");
});

test("the yield sits above the count boxes, so it is on the first screen", () => {
  for (const [res, step] of [['id="c-result"', "Step 1: count ears"], ['id="b-result"', "Step 1: count plants"]])
    assert.ok(html.indexOf(res) < html.indexOf(step), `${res} before ${step}`);
});

test("structured data claims only what the page does", () => {
  const ld = [...html.matchAll(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/g)].map((m) => JSON.parse(m[1]));
  const app = ld.find((x) => x["@type"] === "WebApplication");
  const feats = app.featureList.join(" | ");
  assert.ok(!/break-even|profit|cash price/i.test(feats), `no break-even or cash price feature: ${feats}`);
  assert.ok(/5 sample sites/.test(feats), "the site average is listed");
  const faq = ld.find((x) => x["@type"] === "FAQPage");
  const corn = faq.mainEntity.find((q) => /corn yield before harvest/.test(q.name)).acceptedAnswer.text;
  assert.ok(corn.includes("/ 85") && corn.includes("80,000 to 85,000") && corn.includes("90,000 was the method's original figure"));
  assert.ok(html.includes(corn.replace(/'/g, "'")) || html.replace(/&#x27;|&#39;/g, "'").includes(corn), "the FAQ answer is visible word for word");
});

test("soybean examples are current and the tab links the pod-count check", () => {
  assert.ok(!/~43 bu|~54 bu/.test(html), "the dated ~43 / ~54 buttons are gone");
  const tags = [...html.matchAll(/id="qf-bean-(high|avg|low)"[^>]*>(?:<svg[\s\S]*?<\/svg>)\s*([^<]+)</g)].map((m) => m[2].trim());
  assert.deepEqual(tags, ["Strong stand ~65 bu", "Good stand ~55 bu", "Stressed ~40 bu"]);
  near(Y.beanYield(130, 36, 2.5, 3000), 65.0, "strong");
  near(Y.beanYield(132, 30, 2.5, 3000), 55.0, "good");
  near(Y.beanYield(120, 25, 2.4, 3000), 40.0, "stressed");
  for (const [id, args] of [["high", "130,36,2.5,3000"], ["avg", "132,30,2.5,3000"], ["low", "120,25,2.4,3000"]])
    assert.ok(html.includes(`getElementById('qf-bean-${id}').addEventListener('click',function(){beanFill(${args});})`), `button ${id} fills ${args}`);
  const bean = html.slice(html.indexOf('id="ye-bean"'), html.indexOf("<!--FAQ:START-->"));
  assert.ok(bean.includes('href="/pod-counts"'), "the soybean tab links /pod-counts");
});

test("corn examples still land on their labels at 85,000", () => {
  near(Y.cornYield(34, 16, 34), 217.6, "~220");
  near(Y.cornYield(30, 16, 32), 180.7, "~180");
  near(Y.cornYield(28, 14, 28), 129.1, "~130");
  for (const [id, args] of [["high", "34,16,34"], ["avg", "30,16,32"], ["low", "28,14,28"]])
    assert.ok(html.includes(`getElementById('qf-corn-${id}').addEventListener('click',function(){cornFill(${args});})`));
});
