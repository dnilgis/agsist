/* PRF state sponsors: components/prf-sponsor.js, data/prf-sponsors.json and
 * the offer every PRF page ships (scripts/build_prf_states.py,
 * scripts/build_prf_counties.py, scripts/make_prf_html.py).
 *
 * WHY. A sale is one line of JSON that the browser reads, so the rules have to
 * hold in the script and in the shipped data: a sold state shows its sponsor,
 * labelled, on the state page, every county page and beside the result on
 * /prf; an unsold or lapsed state shows the offer, one per page, in the upper
 * part of the page (Sig, 2026-10-14), never at the foot; nothing a sponsor types can
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
let offerLink = null;
function fakePage(els, box, data, pbox = null) {
  const handlers = {};
  const doc = {
    querySelectorAll: (q) => (q === "[data-prf-spon]" ? els : []),
    getElementById: (id) => (id === "prf-spon" ? box : id === "prf-spon-p" ? pbox : null),
    querySelector: (q) => (q === "a[data-prf-offer]" ? offerLink : null),
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

/* The /prf print sheet (Sig, Oct 18): a sold state prints its sponsor box; unsold prints nothing. */
const toolBox = () => { const b = el({}); b.hidden = true; b.innerHTML = ""; b.removeAttribute = function (k) { delete this.attrs[k]; }; return b; };
const PRINT_FIX = { KS: { name: "Prairie Range Test Agency", url: "https://www.example.org/prf/", line: "Range and hay coverage for Kansas ranches.", phone: "620-555-0142", through: "2099-12-31" } };
test("print sheet: a sold state prints its sponsor, labelled, with name, phone, website, line and the disclosure", () => {
  const h = SP.renderPrint(SP.pick(PRINT_FIX, "KS", "2026-10-18"));
  assert.ok(h.startsWith('<span class="psp-tag">Sponsor</span>'), "labelled Sponsor first");
  for (const t of ["Prairie Range Test Agency", "620-555-0142", "example.org/prf", "Range and hay coverage for Kansas ranches.", "A sponsor has no say over any figure here."]) assert.ok(h.includes(t), t);
  assert.doesNotMatch(h, /<a |<img |https?:/, "paper: no link, no logo, no scheme");
  assert.ok(!PRICE.test(h) && !/price|founding/i.test(h));
  const bad = SP.renderPrint({ name: "<b>x</b>", url: "https://example.org", line: "<script>1</script>", phone: "" });
  assert.ok(!bad.includes("<b>x") && !bad.includes("<script>"), "escaped");
});

test("print sheet on /prf: the box fills for a sold state and empties, hidden, for an unsold one", async () => {
  const box = el({}); box.hidden = true; box.innerHTML = ""; box.removeAttribute = function (k) { delete this.attrs[k]; };
  const pbox = el({}); pbox.hidden = true; pbox.innerHTML = "";
  const p = fakePage([], box, PRINT_FIX, pbox);
  p.fire({ grid: 1, st: "KS", stName: "Kansas" }); await tick(); await tick();
  assert.equal(pbox.hidden, false);
  assert.match(pbox.innerHTML, /^<span class="psp-tag">Sponsor<\/span>.*Prairie Range Test Agency.*620-555-0142.*example\.org\/prf.*A sponsor has no say over any figure here\./s);
  p.fire({ grid: 2, st: "NE", stName: "Nebraska" }); await tick(); await tick();
  assert.equal(pbox.hidden, true, "unsold prints nothing");
  assert.equal(pbox.innerHTML, "");
  const lapsed = el({}); lapsed.hidden = true; lapsed.innerHTML = "";
  const q = fakePage([], toolBox(), { KS: { ...PRINT_FIX.KS, through: "2000-01-01" } }, lapsed);
  q.fire({ grid: 3, st: "KS", stName: "Kansas" }); await tick(); await tick();
  assert.equal(lapsed.hidden, true, "a lapsed sale prints nothing");
  assert.equal(lapsed.innerHTML, "");
  const ff = el({}); ff.hidden = true; ff.innerHTML = "";
  const r = fakePage([], toolBox(), { KS: { ...PRINT_FIX.KS, name: "Farmers First Agency" } }, ff);
  r.fire({ grid: 4, st: "KS", stName: "Kansas" }); await tick(); await tick();
  assert.equal(ff.hidden, true, "never Farmers First");
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

const JS_TAG = '<script src="/components/prf-sponsor.js?v=4" defer></script>';
const BAND_BAD = /founding|sponsor-apply|states? left|slots? left|only \d+|\d+ (states?|slots?) (open|left)/i;

test("every state page offers its slot near the top, once, with no price", () => {
  for (const { st, rel } of STATE_PAGES) {
    const h = readFileSync(ROOT + rel, "utf8");
    const all = h.match(/data-prf-spon=/g) || [];
    assert.equal(all.length, 1, rel + ": one offer per page, not two");
    const m = h.match(/<aside class="prf-spon-band" id="sponsor"[^>]*>[\s\S]*?<\/aside>/);
    assert.ok(m, rel + " lacks the sponsor band");
    const r = m[0];
    assert.ok(r.includes(`data-prf-spon="state" data-prf-st="${st.st}" data-prf-name="${st.name}"`), rel);
    assert.ok(r.includes('<span class="prf-spon-tag">For businesses</span>'), rel + ": labelled For businesses");
    assert.ok(r.includes(`Sponsor PRF in ${st.name}.`), rel);
    assert.ok(r.includes(`Your business here, on this page and every ${st.name} county page.`), rel);
    assert.ok(r.includes(`<a href="/prf-sponsor?state=${st.st}" data-out="prf-sponsor">See your block and ask &rarr;</a>`), rel + ": the link goes to /prf-sponsor with the state ticked");
    assert.ok(!PRICE.test(r) && !BAND_BAD.test(r), rel);
    // the upper part: under the h1 and the opening answer, before the first table
    const at = h.indexOf(r);
    assert.ok(at > h.indexOf("<h1>") && at > h.indexOf('class="prf-lede"'), rel + ": under the h1 and the opening answer");
    assert.ok(at < h.indexOf("<table"), rel + ": before the tables");
    assert.ok(h.includes(JS_TAG), rel);
    assert.ok(!/founding/i.test(h), rel);
  }
});

test("every county page carries the one-line offer for its own state near the top, and stays small", () => {
  let n = 0;
  for (const s of meta.states) {
    const dir = ROOT + "prf/" + slug(s.name);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".html")) continue;
      const rel = "prf/" + slug(s.name) + "/" + f;
      const h = readFileSync(ROOT + rel, "utf8");
      const line = `<p class="prf-spon-band prf-spon-line" data-prf-spon="county" data-prf-st="${s.st}" data-prf-name="${s.name}"><span class="prf-spon-tag">For businesses</span> <a href="/prf-sponsor?state=${s.st}">Sponsor PRF in ${s.name} &rarr;</a></p>`;
      const at = h.indexOf(line);
      assert.ok(at > 0, rel + " lacks its state's offer line");
      assert.equal((h.match(/data-prf-spon=/g) || []).length, 1, rel + ": one offer per page, not two");
      assert.ok(at > h.indexOf('class="prf-lede"') && at < h.indexOf("<table"), rel + ": under the opening answer, before the tables");
      assert.ok(h.includes(JS_TAG), rel);
      assert.ok(!/founding|price on request/i.test(h), rel);
      assert.ok(statSync(ROOT + rel).size < 40 * 1024, rel + " is over 40 KB");
      n++;
    }
  }
  assert.equal(n, meta.counts.counties);
});

test("/prf: the offer band under the step 3 answer, the sponsor box beside the result, the script before prf.js", () => {
  const h = readFileSync(ROOT + "prf.html", "utf8");
  const offers = h.match(/prf-spon-offer/g) || [];
  assert.equal(offers.length, 1, "one offer on /prf, not two");
  const offer = h.match(/<aside class="prf-spon-band prf-spon-offer"[\s\S]*?<\/aside>/);
  assert.ok(offer, "no offer band");
  const o = offer[0];
  assert.ok(o.includes('<span class="prf-spon-tag">For businesses</span>'));
  assert.ok(o.includes("Sponsor PRF in your states.") && o.includes("One business per state, on the state page and every county page in it.") && o.includes("Price on request."));
  assert.ok(o.includes('<a href="/prf-sponsor" data-prf-offer data-out="prf-sponsor">See your block and ask &rarr;</a>'), "the offer goes to /prf-sponsor");
  assert.ok(!PRICE.test(o) && !BAND_BAD.test(o) && !/left/i.test(o));
  const at = h.indexOf(o);
  /* Sig, Oct 20: the sponsor ask moves below the step 3 answer */
  assert.ok(at > h.indexOf('id="prf-answer"') && at > h.indexOf('id="prf-spon"'), "the band sits under the answer");
  assert.ok(at < h.indexOf('id="prf-det-h"') && at < h.indexOf('id="prf-optimize"'), "the band sits above step 4");
  assert.ok(h.indexOf('id="prf-app"') < at, "not above the tool any more");
  assert.ok(!/ag-sponsor-ribbon prf-spon-offer/.test(h), "the old bottom offer is gone");
  const box = h.indexOf('<aside class="prf-spon" id="prf-spon" hidden></aside>');
  assert.ok(box > h.indexOf('id="prf-answer"') && box < h.indexOf('id="prf-optimize"'), "the sponsor box sits beside the result, outside the panel");
  assert.ok(h.indexOf("prf-sponsor.js") < h.indexOf("/components/prf.js"), "prf-sponsor.js must listen before prf.js renders");
  assert.ok(h.includes('<script src="/components/prf-sponsor.js?v=4" defer></script>'));
  assert.ok(!/founding/i.test(h));
  assert.ok(readFileSync(ROOT + "components/prf.js", "utf8").includes("st: S.st, stName:"), "prf.js names the state in prf:grid");
});

test("PRF slots stay out of the self-serve flow", () => {
  const slots = readFileSync(ROOT + "data/sponsor-slots.json", "utf8");
  assert.ok(!/"prf/i.test(slots), "a PRF slot is in data/sponsor-slots.json");
  assert.ok(!/prf-sponsor/.test(readFileSync(ROOT + "components/sponsor-apply.js", "utf8")));
});

test("/prf: the offer links to /prf-sponsor with the reader's state ticked", async () => {
  const box = el({}); box.hidden = true; box.innerHTML = ""; box.removeAttribute = function (k) { delete this.attrs[k]; };
  offerLink = el({ href: "/prf-sponsor" });
  const p = fakePage([], box, LIVE);
  p.fire({ grid: 1, st: "KS", stName: "Kansas" }); await tick(); await tick();
  assert.equal(offerLink.attrs.href, "/prf-sponsor?state=KS");
  p.fire({ grid: 2, st: "IA", stName: "Iowa" }); await tick(); await tick();
  assert.equal(offerLink.attrs.href, "/prf-sponsor?state=IA", "a sold state still links its offer (the band under the intro stays)");
  p.fire({ grid: 3, st: "x\"><script>", stName: "?" }); await tick(); await tick();
  assert.equal(offerLink.attrs.href, "/prf-sponsor", "anything but a state code is not put in the link");
  offerLink = null;
});

test("the sponsor sheet points at /prf-sponsor", () => {
  const h = readFileSync(ROOT + "prf-sponsor-kit.html", "utf8");
  assert.ok(h.includes("AgQR.svg('https://agsist.com/prf-sponsor'"), "the QR opens /prf-sponsor");
  assert.ok(h.includes('href="/prf-sponsor"') && h.includes("agsist.com/prf-sponsor</b>"));
  assert.ok(h.includes("sig@farmers1st.com"), "the email stays");
  assert.ok(!PRICE.test(h.replace(/<style>[\s\S]*?<\/style>/, "")) && !/founding/i.test(h));
});
