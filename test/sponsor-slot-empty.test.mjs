// Sig, 2026-10-19: an unsold sponsor slot carries no price text in the page.
// The real case: whats-priced-in.html shipped a hidden
// '<span class="ag-sponsor-price" data-rate="page">$29/mo &middot; first month free</span>'
// that only crawlers which skip CSS read. Each unsold ribbon is now an empty
// aside with only data-slot, and loader.js must still fill it when sold.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
const ROOT = new URL("../", import.meta.url).pathname;

test("the real pages: unsold ribbons are empty asides with only a slot id", () => {
  for (const [f, id] of [["whats-priced-in.html", "whats-priced-in"], ["fertilizer.html", "fertilizer"], ["rent/iowa.html", "rent-ia"], ["rent/index.html", "rent-hub"]]) {
    const h = readFileSync(ROOT + f, "utf8");
    const m = /<aside class="ag-sponsor-ribbon"([^>]*)>([\s\S]*?)<\/aside>/.exec(h);
    assert.ok(m, f + " lost its ribbon");
    assert.equal(m[2], "", f + " ribbon carries text");
    assert.match(m[1], new RegExp(`data-slot="${id}"`), f);
    assert.ok(!/first month free|data-rate=|\$29\/mo/.test(h), f + " still carries a slot price");
  }
  // the sponsor kit page keeps its prices
  assert.match(readFileSync(ROOT + "sponsor.html", "utf8"), /\$29/);
});

test("loader.js fills a sold slot from data-slot alone", async () => {
  const src = readFileSync(ROOT + "components/loader.js", "utf8");
  const a = src.indexOf("  function ribbonInner"), b = src.indexOf("  // ── Sponsor measurement");
  const esc = src.slice(src.indexOf("  function slotEsc"), src.indexOf("  function ribbonInner"));
  assert.ok(a > 0 && b > a && esc.length > 0, "loader.js moved; update this test");
  const rib = {
    attrs: { "data-slot": "whats-priced-in" }, classes: new Set(), innerHTML: "",
    getAttribute(k) { return this.attrs[k] ?? null; }, setAttribute(k, v) { this.attrs[k] = v; },
    querySelector() { return null; }, get classList() { const c = this.classes; return { add: (x) => c.add(x) }; },
  };
  let fetched = "";
  const ctx = {
    BASE: "", Intl, Date,
    document: { querySelector: (s) => (s === "aside.ag-sponsor-ribbon" ? rib : null) },
    fetch: (u) => { fetched = u; return Promise.resolve({ ok: true, json: () => Promise.resolve({ slots: { "whats-priced-in": {
      company: "Acme Seed", url: "https://acme.example", start: "2026-01-01", active: true } } }) }); },
    window: {},
  };
  vm.createContext(ctx);
  vm.runInContext(esc + src.slice(a, b) + "\nthis.fill = fillPageRibbons;", ctx);
  ctx.fill();
  await new Promise((r) => setTimeout(r, 10));
  assert.match(fetched, /page-sponsors\.json/);
  assert.ok(rib.classes.has("ag-sponsor-ribbon--sold"), "the sold slot was not filled");
  assert.equal(rib.attrs["data-sponsor-slot"], "page:whats-priced-in");
  assert.match(rib.innerHTML, /Acme Seed/);
});
