/* Fast Facts panel, second half (Oct 22, 2026): the skeptic pass over the seven seat files and the
 * fixes that survived, each pinned on the real case.
 *
 *   node --test test/fast-facts-panel-oct22.test.mjs
 *
 * - The Daily row never prints a price from before the open (Oct 22 teaser: "crude climbs 2.2% to $99.24").
 * - The State stats tab no longer repeats USDA NASS crop figures that /yield/<state> and /usda-quick-stats
 *   already carry: it points there, and every state it can point at exists on disk.
 * - The drought weeks figure is a share of weeks wherever it prints short ("6.6% of weeks", not "6.6%").
 * - Retired pages stay forwarded, out of the sitemap, and nothing on the site links to them. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");
const P = createRequire(import.meta.url)(ROOT + "components/place.js");

test("the Daily row: a teaser with a dollar figure is not printed; one without is", () => {
  const oct22 = { teaser: "Grains stop sliding but barely bounce, while crude climbs 2.2% to $99.24 on fresh Gulf attacks.", headline: "Corn $4.64 and beans $12.47 hold; crude up 2.2% to $99.24", generated_at: "2026-10-22T11:03:20.916084+00:00" };
  const r = P.factDaily(oct22);
  assert.equal(r.value, "Out this morning");
  assert.doesNotMatch(r.value + " " + r.ctx, /\$\d/);
  assert.match(r.ctx, /before the open/);
  assert.equal(r.date, "2026-10-22");
  assert.deepEqual(r.src, ["Read the Daily", "/daily"]);
  const plain = P.factDaily({ teaser: "Harvest runs ahead of average in Wisconsin.", generated_at: "2026-10-23T11:00:00Z" });
  assert.equal(plain.value, "Harvest runs ahead of average in Wisconsin.");
  assert.equal(plain.ctx, "");
  // the headline is the fallback only when there is no teaser, and it is held to the same rule
  assert.equal(P.factDaily({ headline: "Corn $4.64 holds", generated_at: "2026-10-22T11:00:00Z" }).value, "Out this morning");
});

test("State stats points to the one home of the state crop figures, for every state", () => {
  const page = read("fast-facts.html");
  const tab = page.slice(page.indexOf('id="tab-statestats"'), page.indexOf('<nav class="ff-toc"'));
  assert.ok(tab.length > 200, "the tab is still there (#statestats links keep working)");
  for (const id of ["ff-state-select", "state-content"]) assert.ok(tab.includes(' id="' + id + '"'), id);
  // no NASS crop figure of its own: the national cards and the per-state cards are gone
  assert.doesNotMatch(tab, /U\.S\. Corn: 20\d\d|B bu|M ac|bu\/ac/);
  assert.match(tab, /href="\/usda-quick-stats"/);
  const js = read("components/fast-facts.js");
  assert.doesNotMatch(js, /fetch\(['"]\/data\/state-stats\.json/, "the tab no longer fetches the NASS file");
  // run the tab's code against a stub page and follow every option
  const opts = [...tab.matchAll(/<option value="([A-Z]{2})"[^>]*>([^<]+)<\/option>/g)].map((m) => [m[1], m[2]]);
  assert.equal(opts.length, 50);
  const el = { content: { innerHTML: "" }, sel: { value: "IA", querySelector: () => null, addEventListener(t, f) { this.f = f; } } };
  const doc = { getElementById: (id) => (id === "state-content" ? el.content : id === "ff-state-select" ? el.sel : null), addEventListener() {}, querySelectorAll: () => [], querySelector: () => null, readyState: "complete", documentElement: { getAttribute: () => null } };
  const fnSrc = js.slice(js.indexOf("var NO_YIELD_PAGE"), js.indexOf("var STATE_NAMES")) + js.slice(js.indexOf("var STATE_NAMES"), js.indexOf("\n", js.indexOf("var STATE_NAMES"))) + "\n" + js.slice(js.indexOf("function initStateStats(){"), js.indexOf("\n}\n", js.indexOf("function initStateStats(){")) + 3);
  const ctx = { document: doc, stateInited: false, savedState: () => null };
  vm.createContext(ctx);
  vm.runInContext("var stateInited=false;" + fnSrc + ";initStateStats();", ctx);
  for (const [code] of opts) {
    el.sel.value = code; el.sel.f();
    const href = /href="([^"]+)"/.exec(el.content.innerHTML)[1];
    assert.ok(existsSync(ROOT + href.slice(1) + ".html"), code + " -> " + href);
    if (P.NO_PAGE.yield.split(" ").includes(code)) assert.equal(href, "/usda-quick-stats", code);
    else assert.match(href, /^\/yield\/[a-z-]+$/, code);
  }
});

test("the drought weeks figure says weeks wherever it prints short", () => {
  assert.equal(P.fmtShort(6.6, { unit: "% of weeks", dp: 1 }), "6.6% of weeks");
  assert.equal(P.fmtShort(7.8, { unit: "% of acres", dp: 1 }), "7.8%");
  assert.equal(P.fmt(6.6, { unit: "% of weeks", dp: 1 }), "6.6% of weeks");
});

test("retired pages forward, stay out of the sitemap, and nothing links to them", () => {
  const map = read("sitemap.xml");
  for (const [p, to] of [["here.html", "/fast-facts"], ["fastfacts.html", "/fast-facts"], ["status.html", "/"]]) {
    const h = read(p);
    assert.match(h, /<meta name="robots" content="noindex, ?follow">/, p);
    assert.match(h, new RegExp('<link rel="canonical" href="https://agsist\\.com' + to.replace("/", "\\/") + '">'), p);
    assert.ok(h.length < 1200, p + " is a small forward");
    assert.doesNotMatch(map, new RegExp("agsist\\.com/" + p.replace(".html", "") + "<"), p + " in the sitemap");
  }
  assert.match(map, /agsist\.com\/fast-facts</);
  // no page, menu, footer or changelog entry links to a retired address
  const files = ["index.html", "changelog.html", "fast-facts.html", "components/header.html", "components/footer.html", "components/header-fallback.html", "components/footer-fallback.html", "components/search.js", "components/loader.js"];
  for (const f of files) assert.doesNotMatch(read(f), /href="\/(here|status|fastfacts)["?#]|'\/here\?/, f);
  for (const e of JSON.parse(read("data/changelog.json")).entries || []) assert.ok(!/^\/(here|status|fastfacts)\b/.test(e.page || ""), e.title);
});
