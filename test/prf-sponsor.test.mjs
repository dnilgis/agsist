/* PRF state sponsors: components/prf-sponsor.js, data/prf-sponsors.json and
 * the offer every PRF page ships (scripts/build_prf_states.py,
 * scripts/build_prf_counties.py, scripts/make_prf_html.py).
 *
 * WHY. A sale is one line of JSON that the browser reads, so the rules have to
 * hold in the script and in the shipped data: a sold state shows its sponsor,
 * labelled, on the state page, every county page and beside the result on
 * /prf; an unsold or lapsed state shows the offer; nothing a sponsor types can
 * run script or carry a javascript: link; no price and no "founding" anywhere;
 * Farmers First never in a slot. The mock sponsor below lives only in this file.
 *
 *   node --test test/prf-sponsor.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const SP = require(ROOT + "components/prf-sponsor.js");
const SRC = readFileSync(ROOT + "components/prf-sponsor.js", "utf8");
const meta = JSON.parse(readFileSync(ROOT + "data/prf/meta.json", "utf8"));
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// TEST FIXTURE ONLY. Never in data/prf-sponsors.json.
const EX = { name: "Example Ag Lending", url: "https://example.com/ag", line: "Operating loans and land loans for grazing operations.", logo: "/img/sponsors/example.webp", through: "2026-12-31" };
const FIX = { IA: EX, NE: { ...EX } };
const PRICE = /\$\s?\d|\d+\s?(dollars|\/mo|per month|a month|a year)/i;

test("unsold, sold, one business in several states", () => {
  assert.equal(SP.pick(FIX, "KS", "2026-10-13"), null);
  assert.equal(SP.pick({}, "IA", "2026-10-13"), null);
  assert.equal(SP.pick(null, "IA", "2026-10-13"), null);
  const ia = SP.pick(FIX, "IA", "2026-10-13"), ne = SP.pick(FIX, "NE", "2026-10-13");
  assert.equal(ia.name, "Example Ag Lending");
  assert.equal(ne.name, "Example Ag Lending");
  assert.equal(ne.st, "NE");
  const h = SP.render(ne, "Nebraska", "state");
  assert.match(h, /PRF in Nebraska is sponsored by Example Ag Lending\./);
  assert.ok(h.includes('data-sponsor-click="prf-state:NE"'));
  assert.equal(SP.pick({ _how: "x" }, "_how", "2026-10-13"), null, "the note key is not a state");
});

test("expiry: shown through the last day, offer again the day after", () => {
  assert.ok(SP.pick(FIX, "IA", "2026-12-31"));
  assert.equal(SP.pick(FIX, "IA", "2027-01-01"), null);
  assert.equal(SP.pick({ IA: { ...EX, through: "Dec 31" } }, "IA", "2026-10-13"), null);
  assert.equal(SP.pick({ IA: { ...EX, through: undefined } }, "IA", "2026-10-13"), null);
  // the day is Central time: 03:00 UTC on Jan 1 is still Dec 31 in Iowa
  assert.equal(SP.today(new Date("2027-01-01T03:00:00Z")), "2026-12-31");
  assert.ok(SP.pick(FIX, "IA", SP.today(new Date("2027-01-01T03:00:00Z"))));
  assert.equal(SP.pick(FIX, "IA", SP.today(new Date("2027-01-01T07:00:00Z"))), null);
});

test("escaping: nothing a sponsor types runs, and no javascript: links", () => {
  for (const url of ["javascript:alert(1)", "JAVASCRIPT:alert(1)", " javascript:alert(1)", "data:text/html,x", "//evil.example", "https://x.example/\"onmouseover=\"x", "https://x.example/ a", "ftp://x.example", "vbscript:x"]) {
    assert.equal(SP.pick({ IA: { ...EX, url } }, "IA", "2026-10-13"), null, url);
  }
  const bad = SP.pick({ IA: { ...EX, name: '<img src=x onerror=alert(1)>"', line: `Rates & "terms" <b>here</b>'` } }, "IA", "2026-10-13");
  for (const kind of ["state", "county", "tool"]) {
    const h = SP.render(bad, "Iowa", kind);
    assert.ok(!h.includes("<img src=x"), kind);
    assert.ok(!/<b>here/.test(h), kind);
    assert.ok(h.includes("&lt;img src=x onerror=alert(1)&gt;&quot;"), kind);
    assert.ok(h.includes("Rates &amp; &quot;terms&quot; &lt;b&gt;here&lt;/b&gt;&#39;"), kind);
  }
  assert.equal(SP.pick({ IA: { ...EX, logo: "https://evil.example/x.png" } }, "IA", "2026-10-13").logo, "");
  assert.equal(SP.pick({ IA: { ...EX, logo: "/img/sponsors/../../x.svg" } }, "IA", "2026-10-13").logo, "");
  assert.equal(SP.pick({ IA: { ...EX, phone: "<b>1</b>" } }, "IA", "2026-10-13").phone, "");
  assert.equal(SP.pick({ IA: { ...EX, line: "x".repeat(121) } }, "IA", "2026-10-13").line, "", "a line over 120 characters is left out");
  assert.equal(SP.pick({ IA: { ...EX, name: "x".repeat(61) } }, "IA", "2026-10-13"), null);
});

test("Farmers First never appears in a slot", () => {
  for (const sp of [{ ...EX, name: "Farmers First" }, { ...EX, name: "Farmers 1st Agency" }, { ...EX, url: "https://farmers1st.com" }, { ...EX, url: "https://www.farmersfirst.example" }]) {
    assert.equal(SP.pick({ IA: sp }, "IA", "2026-10-13"), null, JSON.stringify(sp));
  }
});

test("the sold block: labelled Sponsor, rel=sponsored, asks readers to support them, no price", () => {
  const ia = SP.pick({ IA: { ...EX, phone: "515-555-0100" } }, "IA", "2026-10-13");
  for (const kind of ["state", "county", "tool"]) {
    const h = SP.render(ia, "Iowa", kind);
    assert.ok(h.startsWith('<span class="ag-sponsor-tag">Sponsor</span>'), kind);
    assert.ok(h.includes("PRF in Iowa is sponsored by Example Ag Lending."), kind);
    assert.ok(h.includes("AGSIST is free because businesses like Example Ag Lending pay for it. If you do business with them, tell them you saw them here."), kind);
    assert.ok(h.includes('href="https://example.com/ag" rel="sponsored noopener"'), kind);
    assert.ok(h.includes("Visit Example Ag Lending &rarr;"), kind);
    assert.ok(h.includes(EX.line), kind);
    assert.ok(h.includes(">515-555-0100</span>."), kind);
    assert.ok(!PRICE.test(h) && !/price|founding/i.test(h), kind);
    assert.equal(h.includes('src="/img/sponsors/example.webp"'), kind !== "county", kind + " logo");
  }
  assert.ok(SP.render(ia, "Iowa", "tool").includes("A sponsor has no say over any figure here."));
});

/* The browser half, run against a small fake page. */
function fakePage(els, box, data) {
  const handlers = {};
  const doc = {
    querySelectorAll: (q) => (q === "[data-prf-spon]" ? els : []),
    getElementById: (id) => (id === "prf-spon" ? box : null),
    addEventListener: (t, f) => { handlers[t] = f; },
  };
  const ctx = { document: doc, fetch: () => Promise.resolve(data === null ? { ok: false } : { ok: true, json: () => Promise.resolve(data) }), Intl, Date, Promise, String };
  vm.runInNewContext(SRC, ctx);
  return { fire: (detail) => handlers["prf:grid"]({ detail }) };
}
function el(attrs) {
  return { attrs: { ...attrs }, innerHTML: "OFFER", className: "orig", hidden: attrs.hidden || false, getAttribute(k) { return this.attrs[k] ?? null; }, setAttribute(k, v) { this.attrs[k] = v; } };
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const LIVE = { IA: { ...EX, through: "2099-12-31" }, NE: { ...EX, through: "2099-12-31" }, OK: { ...EX, through: "2000-01-01" } };

test("state and county pages: sold swaps in the sponsor, unsold and lapsed keep the offer", async () => {
  const ia = el({ "data-prf-spon": "state", "data-prf-st": "IA", "data-prf-name": "Iowa" });
  const iaCo = el({ "data-prf-spon": "county", "data-prf-st": "IA", "data-prf-name": "Iowa" });
  const ks = el({ "data-prf-spon": "county", "data-prf-st": "KS", "data-prf-name": "Kansas" });
  const ok = el({ "data-prf-spon": "state", "data-prf-st": "OK", "data-prf-name": "Oklahoma" });
  fakePage([ia, iaCo, ks, ok], null, LIVE);
  await tick(); await tick();
  assert.match(ia.innerHTML, /PRF in Iowa is sponsored by Example Ag Lending/);
  assert.ok(ia.className.includes("ag-sponsor-ribbon--sold") && ia.className.includes("prf-spon-state"));
  assert.equal(ia.attrs["data-sponsor-slot"], "prf-state:IA");
  assert.match(iaCo.innerHTML, /PRF in Iowa is sponsored by/);
  assert.ok(iaCo.className.includes("prf-spon-county"));
  assert.equal(ks.innerHTML, "OFFER");
  assert.equal(ok.innerHTML, "OFFER", "a lapsed state shows its offer");
});

test("the file cannot be read: every offer stays", async () => {
  const ia = el({ "data-prf-spon": "state", "data-prf-st": "IA", "data-prf-name": "Iowa" });
  fakePage([ia], null, null);
  await tick(); await tick();
  assert.equal(ia.innerHTML, "OFFER");
});

test("/prf: the sponsor of the reader's state beside the result, gone for an unsold state", async () => {
  const box = el({}); box.hidden = true; box.innerHTML = ""; box.removeAttribute = function (k) { delete this.attrs[k]; };
  const p = fakePage([], box, LIVE);
  p.fire({ grid: 1, st: "IA", stName: "Iowa" }); await tick(); await tick();
  assert.equal(box.hidden, false);
  assert.match(box.innerHTML, /PRF in Iowa is sponsored by Example Ag Lending/);
  assert.equal(box.attrs["data-sponsor-slot"], "prf-tool:IA");
  p.fire({ grid: 2, st: "KS", stName: "Kansas" }); await tick(); await tick();
  assert.equal(box.hidden, true);
  assert.equal(box.innerHTML, "");
  assert.equal(box.className, "prf-spon", "an unsold state leaves no sold styling behind");
  p.fire({ grid: 3, st: "NE", stName: "Nebraska" }); await tick(); await tick();
  assert.match(box.innerHTML, /PRF in Nebraska is sponsored by Example Ag Lending/);
});

test("the shipped data file is valid and holds no test sponsor", () => {
  const raw = readFileSync(ROOT + "data/prf-sponsors.json", "utf8");
  const d = JSON.parse(raw);
  assert.ok(!/Example Ag Lending|example\.com/i.test(raw), "the test sponsor is in the shipped file");
  const codes = new Set(meta.states.map((s) => s.st));
  for (const [k, v] of Object.entries(d)) {
    if (k.startsWith("_")) continue;
    assert.ok(codes.has(k), k + " is not a PRF state code");
    for (const f of Object.keys(v)) assert.ok(["name", "url", "line", "logo", "phone", "through"].includes(f), `${k}: unknown field ${f}`);
    assert.match(v.through || "", /^\d{4}-\d{2}-\d{2}$/, k + ": through must be YYYY-MM-DD");
    const sp = SP.pick(d, k, v.through);
    assert.ok(sp, k + ": the entry is rejected (name, https url, or Farmers First)");
    assert.ok(typeof v.line === "string" && v.line.length > 0 && v.line.length <= 120, k + ": line must be one sentence of 120 characters at most");
    assert.ok(!PRICE.test(v.line) && !/founding/i.test(v.line), k + ": no price and no 'founding' in the line");
    if (v.logo) {
      assert.equal(sp.logo, v.logo, k + ": logo must be /img/sponsors/<name>.png|jpg|webp");
      assert.ok(existsSync(ROOT + v.logo.slice(1)), k + ": logo file missing");
      assert.ok(statSync(ROOT + v.logo.slice(1)).size <= 50 * 1024, k + ": logo over 50 KB");
    }
    if (v.phone) assert.equal(sp.phone, v.phone, k + ": phone");
  }
});

const STATE_PAGES = meta.states.map((s) => ({ st: s, rel: "prf/" + slug(s.name) + ".html" }));

test("every state page offers its slot: one state or several, price on request, no price", () => {
  for (const { st, rel } of STATE_PAGES) {
    const h = readFileSync(ROOT + rel, "utf8");
    const m = h.match(/<aside class="ag-sponsor-ribbon" id="sponsor"[^>]*>[\s\S]*?<\/aside>/);
    assert.ok(m, rel + " lacks the sponsor ribbon");
    const r = m[0];
    assert.ok(r.includes(`data-prf-spon="state" data-prf-st="${st.st}"`), rel);
    assert.ok(r.includes("Own one state or several."), rel);
    assert.ok(r.includes(`every ${st.name} county page`), rel);
    assert.ok(r.includes("Price on request"), rel);
    assert.ok(r.includes("mailto:sig@farmers1st.com?subject=PRF%20sponsor"), rel);
    assert.ok(!PRICE.test(r) && !/founding|sponsor-apply|states? left|slots? left/i.test(r), rel);
    assert.ok(h.includes('<script src="/components/prf-sponsor.js?v=1" defer></script>'), rel);
    assert.ok(!/founding/i.test(h), rel);
  }
});

test("every county page carries the one-line offer for its own state, and stays small", () => {
  let n = 0;
  for (const s of meta.states) {
    const dir = ROOT + "prf/" + slug(s.name);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".html")) continue;
      const rel = "prf/" + slug(s.name) + "/" + f;
      const h = readFileSync(ROOT + rel, "utf8");
      const line = `<p class="prf-spon-line" data-prf-spon="county" data-prf-st="${s.st}" data-prf-name="${s.name}">For businesses: <a href="/prf/${slug(s.name)}#sponsor">Sponsor PRF in ${s.name}</a></p>`;
      assert.ok(h.includes(line), rel + " lacks its state's offer line");
      assert.ok(h.includes('<script src="/components/prf-sponsor.js?v=1" defer></script>'), rel);
      assert.ok(!/founding|price on request/i.test(h), rel);
      assert.ok(statSync(ROOT + rel).size < 40 * 1024, rel + " is over 40 KB");
      n++;
    }
  }
  assert.equal(n, meta.counts.counties);
});

test("/prf: the offer box near the bottom, the sponsor box beside the result, the script before prf.js", () => {
  const h = readFileSync(ROOT + "prf.html", "utf8");
  const offer = h.match(/<aside class="ag-sponsor-ribbon prf-spon-offer"[\s\S]*?<\/aside>/);
  assert.ok(offer, "no offer box");
  assert.ok(offer[0].includes("Sponsor PRF in your states.") && offer[0].includes("One business per state, on the state page and every county page in it.") &&
    offer[0].includes("Own one state or as many as you like.") && offer[0].includes("Price on request"));
  assert.ok(offer[0].includes('href="mailto:sig@farmers1st.com?subject=PRF%20state%20sponsor"'));
  assert.ok(!PRICE.test(offer[0]) && !/founding|left/i.test(offer[0]));
  assert.ok(h.indexOf("prf-spon-offer") > h.indexOf('id="prf-optimize"'), "the offer box sits below the tool");
  assert.ok(h.indexOf("prf-spon-offer") > h.indexOf('id="states"'), "the offer box sits near the bottom");
  const box = h.indexOf('<aside class="prf-spon" id="prf-spon" hidden></aside>');
  assert.ok(box > h.indexOf('id="prf-answer"') && box < h.indexOf('id="prf-optimize"'), "the sponsor box sits beside the result, outside the panel");
  assert.ok(h.indexOf("prf-sponsor.js") < h.indexOf("/components/prf.js"), "prf-sponsor.js must listen before prf.js renders");
  assert.ok(!/founding/i.test(h));
  assert.ok(readFileSync(ROOT + "components/prf.js", "utf8").includes("st: S.st, stName:"), "prf.js names the state in prf:grid");
});

test("PRF slots stay out of the self-serve flow", () => {
  const slots = readFileSync(ROOT + "data/sponsor-slots.json", "utf8");
  assert.ok(!/"prf/i.test(slots), "a PRF slot is in data/sponsor-slots.json");
  assert.ok(!/prf-sponsor/.test(readFileSync(ROOT + "components/sponsor-apply.js", "utf8")));
});
