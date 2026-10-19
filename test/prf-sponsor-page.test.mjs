/* /prf-sponsor: prf-sponsor.html and components/prf-sponsor-page.js.
 *
 * WHY. PRF state slots sell passively (Sig, 2026-10-13): a stranger lands on
 * this page from a PRF offer, sees their own block and asks, with no call
 * from Sig. So the page must: offer only the states that have PRF pages, tick
 * the one the link names, draw the preview with the PRF pages' own code, send
 * what the worker (kind prf-sponsor, v5.22) accepts, and never print a price
 * or "founding". The example business below lives only in this file.
 *
 *   node --test test/prf-sponsor-page.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const PG = require(ROOT + "components/prf-sponsor-page.js");
const SP = require(ROOT + "components/prf-sponsor.js");
const HTML = readFileSync(ROOT + "prf-sponsor.html", "utf8");
const meta = JSON.parse(readFileSync(ROOT + "data/prf/meta.json", "utf8"));
const PRICE = /\$\s?\d|\d+\s?(dollars|\/mo|per month|a month|a year)/i;
const KNOWN = Object.fromEntries(meta.states.map((s) => [s.st, { name: s.name, n: s.counties }]));
const OK = { business: "Plains Crop Insurance", line: "PRF and livestock coverage for western Kansas.", phone: "785-555-0100",
  website: "plains.example/prf", states: ["NE", "KS"], name: "Dana Roe", email: "dana@plains.example", message: "" };

test("the state boxes are exactly the PRF states, with their county counts", () => {
  const boxes = [...HTML.matchAll(/<input type="checkbox" name="states" value="([A-Z]{2})" data-name="([^"]+)" data-counties="(\d+)">/g)];
  assert.equal(boxes.length, meta.states.length);
  for (const [, st, name, n] of boxes) {
    assert.ok(KNOWN[st], st);
    assert.equal(name, KNOWN[st].name, st);
    assert.equal(+n, KNOWN[st].n, st + " county count");
  }
  assert.ok(!/value="HI"/.test(HTML), "no Hawaii: it has no PRF pages");
  assert.ok(HTML.includes(`${meta.counts.counties.toLocaleString("en-US")} county pages across ${meta.states.length} states`));
});

test("?state= ticks only the page's own states", () => {
  assert.deepEqual(PG.prefill("?state=IA", KNOWN), ["IA"]);
  assert.deepEqual(PG.prefill("?state=ia,ne,IA", KNOWN), ["IA", "NE"]);
  assert.deepEqual(PG.prefill("?state=HI", KNOWN), []);
  assert.deepEqual(PG.prefill("?state=%22%3E%3Cscript%3E", KNOWN), []);
  assert.deepEqual(PG.prefill("?state=__proto__", KNOWN), []);
  assert.deepEqual(PG.prefill("", KNOWN), []);
});

test("the form's rules match the worker's", () => {
  assert.deepEqual(PG.check(OK), {});
  assert.deepEqual(PG.check({ ...OK, phone: "", website: "", line: "", message: "" }), {}, "phone, website, line and message are optional");
  for (const [patch, k] of [[{ business: "" }, "business"], [{ business: "b".repeat(121) }, "business"], [{ business: "Farmers First Agri" }, "business"],
      [{ name: "" }, "name"], [{ email: "" }, "email"], [{ email: "nope@x" }, "email"], [{ states: [] }, "states"],
      [{ phone: "555-0100" }, "phone"], [{ phone: "call me" }, "phone"], [{ website: "javascript:alert(1)" }, "website"],
      [{ website: "not a site" }, "website"], [{ line: "x".repeat(121) }, "line"], [{ message: "m".repeat(1001) }, "message"]]) {
    assert.ok(PG.check({ ...OK, ...patch })[k], JSON.stringify(patch));
  }
});

test("what is sent: states A to Z, website with https, empty fields left out, no price", () => {
  const p = PG.payload(OK);
  assert.deepEqual(p, { business: OK.business, name: OK.name, email: OK.email, states: "KS, NE", page: "/prf-sponsor",
    phone: OK.phone, line: OK.line, website: "https://plains.example/prf" });
  assert.deepEqual(Object.keys(PG.payload({ ...OK, phone: "", line: "", website: "", message: "" })).sort(), ["business", "email", "name", "page", "states"]);
  assert.equal(PG.subject(p), "PRF sponsor inquiry: Plains Crop Insurance (KS, NE)", "the same subject the digest uses");
  const b = PG.bodyText(p);
  assert.ok(b.includes("States: KS, NE") && b.includes("Email: dana@plains.example") && !PRICE.test(b));
});

test("the preview is the PRF pages' own block, escaped, with sample words when empty", () => {
  const sp = PG.previewSp(OK, "KS");
  const h = SP.render(sp, "Kansas", "state");
  assert.ok(h.startsWith('<span class="ag-sponsor-tag">Sponsor</span>'));
  assert.ok(h.includes("PRF in Kansas is sponsored by Plains Crop Insurance."));
  assert.ok(h.includes(OK.line) && h.includes(">785-555-0100</span>."));
  assert.ok(h.includes("AGSIST is free because businesses like Plains Crop Insurance pay for it."));
  assert.ok(h.includes('href="https://plains.example/prf"'));
  const bad = SP.render(PG.previewSp({ business: '<img src=x onerror=alert(1)>', line: "<b>x</b>", website: "javascript:alert(1)" }, "KS"), "Kansas", "county");
  assert.ok(!bad.includes("<img src=x") && !bad.includes("<b>x") && !bad.includes("javascript:"));
  const empty = PG.previewSp({}, "");
  assert.equal(empty.name, PG.SAMPLE.name);
  assert.equal(empty.line, PG.SAMPLE.line);
  assert.equal(PG.previewSp({ ...OK, phone: "12" }, "KS").phone, "", "a half-typed phone is not drawn");
});

test("the page: indexable, FAQ in JSON-LD, the terms, no price, no founding, no counters", () => {
  assert.match(HTML, /<link rel="canonical"\s+href="https:\/\/agsist\.com\/prf-sponsor">/);
  assert.match(HTML, /<meta name="robots" content="index, follow/);
  const ld = JSON.parse(HTML.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  const faq = ld["@graph"].find((x) => x["@type"] === "FAQPage");
  assert.ok(faq && faq.mainEntity.length >= 5);
  for (const q of faq.mainEntity) assert.ok(HTML.includes(q.name.replace(/'/g, "&#x27;")) || HTML.includes(q.name), "FAQ shown on the page: " + q.name);
  for (const t of ["One business per state.", "Price on request.", "Prepaid.", "through Dec 31", "first say on renewing",
      "A sponsor has no say over any figure.", "USDA RMA", "Farmers First never takes a sponsor slot"]) assert.ok(HTML.includes(t), t);
  for (const who of ["Crop insurance agencies", "Ag lenders", "Ranch supply", "Cattle buyers", "Seed dealers", "Fencing dealers"]) assert.ok(HTML.includes(who), who);
  const text = HTML.replace(/<style>[\s\S]*?<\/style>/, "").replace(/<!--[\s\S]*?-->/g, "");
  assert.ok(!PRICE.test(text), "no price on the page");
  assert.ok(!/founding/i.test(text));
  assert.ok(!/(states?|slots?) (left|open|available)/i.test(text), "no open-slot counters");
  assert.ok(!/sponsor-apply/.test(text), "PRF slots stay out of /sponsor-apply");
  assert.ok(text.includes('href="mailto:sig@farmers1st.com?subject=PRF%20state%20sponsor"'), "email Sig is there as the second way");
  assert.ok(!/[—]|&mdash;/.test(text), "no em dashes");
  assert.ok(HTML.indexOf("/components/prf-sponsor.js?v=4") < HTML.indexOf("/components/prf-sponsor-page.js"), "the renderer loads before the page script");
  assert.ok(!/data-prf-spon=/.test(HTML), "nothing on this page is swapped for a real sponsor");
});

test("listed in the sitemap and linked from the advertise page", () => {
  assert.ok(readFileSync(ROOT + "sitemap.xml", "utf8").includes("<loc>https://agsist.com/prf-sponsor</loc>"));
  assert.ok(readFileSync(ROOT + "sponsor.html", "utf8").includes('href="/prf-sponsor"'));
});
