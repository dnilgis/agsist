/* Grain EMC (components/grain-emc.js) and the /grain-emc page.
 *
 * The shipped file runs in a bare context, so a green run checks the copy the
 * browser runs. Hand-worked answers are written out so a reader can redo them.
 *
 *   node --test test/grain-emc.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const ctx = {};
vm.runInNewContext(readFileSync(ROOT + "components/grain-emc.js", "utf8"), ctx);
const E = ctx.AgEMC;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (tol ${tol})`);
const page = readFileSync(ROOT + "grain-emc.html", "utf8");

test("constants are the verified ASABE sets", () => {
  const c = E.GRAINS.corn, w = E.GRAINS.wheat;
  assert.equal(c.model, "chung-pfost");
  assert.deepEqual([c.A, c.B, c.C], [374.34, 0.18662, 31.696]);
  assert.equal(w.model, "henderson");
  assert.deepEqual([w.K, w.N, w.C], [2.3007e-5, 2.2857, 55.815]);
  assert.deepEqual([...Object.keys(E.GRAINS)], ["corn", "wheat"], "no grain without verified constants");
  assert.equal(c.target, 15.5);
  assert.equal(w.target, 13.5);
});

test("corn at 50 F and 60%, worked by hand", () => {
  // T = 10 C. -ln(0.6) = 0.510826; x (10 + 31.696) / 374.34 = 0.056898;
  // -ln(0.056898) = 2.86650; / 0.18662 = 15.360 dry basis; 100 x 15.360 / 115.360 = 13.315 wet.
  const r = E.emc("corn", 50, 60);
  assert.equal(r.ok, true);
  near(E.emcDb(E.GRAINS.corn, 10, 0.6), 15.360, 0.002, "dry basis");
  near(r.wb, 13.315, 0.002, "wet basis");
});

test("wheat reproduces the University of Minnesota Extension table at 60 F", () => {
  // UMN wheat EMC at 60 F: 7.9, 11.0, 13.7, 16.9% at 20, 40, 60, 80% RH.
  for (const [rh, pub] of [[20, 7.9], [40, 11.0], [60, 13.7], [80, 16.9]]) {
    near(E.emc("wheat", 60, rh).wb, pub, 0.06, `wheat 60 F ${rh}%`);
  }
  // Hand check of one: T = 15.556 C; -ln(0.4) = 0.916291 / (2.3007e-5 x 71.371) = 558.01;
  // ^(1/2.2857) = 15.913 dry; 13.728 wet.
  near(E.emc("wheat", 60, 60).wb, 13.728, 0.003, "wheat by hand");
});

test("corn against published extension tables: always within the 1-point margin, and on the dry side", () => {
  // University of Minnesota Extension (natural-air drying and aeration pages)
  // and University of Kentucky (Equilibrium moisture content for grains).
  const pub = [
    ["UMN", 40, 50, 13.1], ["UMN", 40, 60, 14.5], ["UMN", 40, 70, 16.0],
    ["UMN", 50, 50, 12.5], ["UMN", 50, 60, 13.8], ["UMN", 50, 70, 15.4],
    ["UMN", 60, 50, 11.4], ["UMN", 60, 60, 12.9], ["UMN", 60, 70, 14.5],
    ["KY", 40, 50, 12.9], ["KY", 40, 60, 14.5], ["KY", 40, 70, 16.2],
    ["KY", 50, 50, 12.3], ["KY", 50, 60, 13.8], ["KY", 50, 70, 15.5],
    ["KY", 70, 50, 11.3], ["KY", 70, 60, 12.8], ["KY", 70, 70, 14.4],
  ];
  for (const [src, t, rh, v] of pub) {
    const ours = E.emc("corn", t, rh).wb;
    assert.ok(v - ours <= E.MARGIN, `${src} ${t} F ${rh}%: table ${v} is more than the margin over ours ${ours.toFixed(2)}`);
    assert.ok(ours - v <= 0.2, `${src} ${t} F ${rh}%: ours ${ours.toFixed(2)} is well over the table ${v}`);
  }
});

test("the spread table on the page prints what the equation gives", () => {
  assert.match(page, /<th scope="row">40 F, 70%<\/th><td>15\.3%<\/td>/);
  assert.equal(E.emc("corn", 40, 70).wb.toFixed(1), "15.3");
  assert.match(page, /<th scope="row">50 F, 60%<\/th><td>13\.3%<\/td>/);
  assert.equal(E.emc("corn", 50, 60).wb.toFixed(1), "13.3");
  assert.match(page, /<th scope="row">60 F, 70%<\/th><td>14\.2%<\/td>/);
  assert.equal(E.emc("corn", 60, 70).wb.toFixed(1), "14.2");
  assert.equal(E.emc("wheat", 60, 70).wb.toFixed(1), "15.2", "the SRW comparison in the FAQ");
});

test("the humidity limit inverts the equation", () => {
  for (const k of ["corn", "wheat"]) {
    for (const f of [25, 40, 55, 70, 95]) {
      const r = E.rhFor(k, f, 14);
      near(E.emc(k, f, r.rh).wb, 14, 1e-9, `${k} ${f} F`);
    }
  }
  // FAQ: corn, 15.5% target, dries to 14.5% under about 64/68/71% at 40/50/60 F,
  // holds 15.5% at about 71/74/77%.
  assert.deepEqual([40, 50, 60].map((f) => Math.floor(E.rhFor("corn", f, 14.5).rh)), [64, 68, 71]);
  assert.deepEqual([40, 50, 60].map((f) => Math.floor(E.rhFor("corn", f, 15.5).rh)), [71, 74, 77]);
  assert.match(page, /under about 64% at 40 F, 68% at 50 F and 71% at 60 F/);
  assert.match(page, /about 71% at 40 F, 74% at 50 F and 77% at 60 F/);
});

test("fan heat: same water, warmer air, lower RH (Magnus form)", () => {
  // es(10 C) = 6.1094 exp(17.625 x 10 / 253.04) = 12.2602 hPa
  near(E.satVp(10), 12.2602, 1e-3, "es at 10 C");
  // 50 F 80% warmed 5 F: es(12.778 C) = 14.7343; 80 x 12.2602 / 14.7343 = 66.57%
  const w = E.warm(50, 80, 5);
  assert.equal(w.tF, 55);
  near(w.rh, 66.567, 0.01, "rh after the fan");
  const w0 = E.warm(50, 80, 0);
  assert.deepEqual([w0.tF, w0.rh], [50, 80]);
  assert.match(page, /50 F at 80%, warmed 5 F, comes in at 55 F and 67%/);
  // and the fan changes the verdict the way it should
  assert.equal(E.assess("corn", 50, 80, 15.5, 0).verdict, "wet");
  assert.ok(E.assess("corn", 50, 80, 15.5, 8).emc.wb < E.assess("corn", 50, 80, 15.5, 0).emc.wb);
});

test("limits: no number past the temperature ends; bounds past the humidity ends", () => {
  assert.equal(E.emc("corn", 19, 60).ok, false);
  assert.equal(E.emc("corn", 101, 60).ok, false);
  assert.equal(E.verdict(E.emc("corn", 10, 60), 15.5), null);
  const hi = E.emc("corn", 50, 97);
  assert.equal(hi.bound, "over");
  near(hi.wb, E.emc("corn", 50, 90).wb, 1e-12, "over-bound is the 90% value");
  assert.equal(E.verdict(hi, 15.5), "wet");
  assert.equal(E.verdict(hi, 25), null, "a bound that cannot decide gives no answer");
  const lo = E.emc("wheat", 60, 10);
  assert.equal(lo.bound, "under");
  assert.equal(E.verdict(lo, 13.5), "dry");
  assert.equal(E.emc("corn", 50, 120).ok, false);
});

test("verdict bands: dry only a full point under target", () => {
  const r = (wb) => ({ ok: true, wb, bound: null });
  assert.equal(E.verdict(r(14.5), 15.5), "dry");
  assert.equal(E.verdict(r(14.51), 15.5), "close");
  assert.equal(E.verdict(r(15.5), 15.5), "close");
  assert.equal(E.verdict(r(15.51), 15.5), "wet");
});

test("hourly rows, counts, best window and cooling hours", () => {
  const hours = [
    [40, 95], [42, 60], [45, 55], [50, 50], [48, 72], [44, 58], [41, 57], [39, 90],
  ].map(([tF, rh], i) => ({ t: `2026-10-15T${String(10 + i).padStart(2, "0")}:00:00Z`, tF, rh }));
  const rows = E.hourly("corn", hours, 15.5, 0, 55);
  assert.deepEqual(rows.map((r) => r.verdict), ["wet", "dry", "dry", "dry", "close", "dry", "dry", "wet"]);
  assert.equal(E.count(rows, "dry"), 5);
  const b = E.bestWindow(rows, 2);
  assert.deepEqual([b.start, b.end, b.len], [1, 3, 3]);
  near(b.worst, Math.max(rows[1].emc.wb, rows[2].emc.wb, rows[3].emc.wb), 1e-12, "worst EMC in window");
  // cooling: 10 F under 55 F grain is 45 F or colder, and not wetting
  assert.deepEqual(rows.map((r) => r.cool), [false, true, true, false, false, true, true, false]);
  assert.equal(E.bestWindow(rows.slice(0, 1), 2), null);
  assert.equal(E.coolingHours(0.1), 150);
  assert.equal(E.coolingHours(0.2), 75);
  assert.equal(E.coolingHours(0), null);
});

test("page: title, byline, voice, structured data and the FAQ word for word", () => {
  assert.match(page, /<title>Grain EMC calculator: will running fans dry or wet your grain right now \| AGSIST<\/title>/);
  assert.match(page, /Sigurd Lindquist, Certified Crop Adviser \(CCA\)/);
  assert.ok(!/—|&mdash;/.test(page), "no em dashes");
  const ld = JSON.parse(page.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  const g = ld["@graph"];
  assert.ok(g.some((x) => x["@type"] === "WebApplication" && x.offers.price === "0"));
  const faq = g.find((x) => x["@type"] === "FAQPage").mainEntity;
  assert.ok(faq.length >= 6);
  const unesc = (s) => s.replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  const shown = [...page.matchAll(/<details><summary>([\s\S]*?)<\/summary><p>([\s\S]*?)<\/p><\/details>/g)].map((m) => [unesc(m[1]), unesc(m[2])]);
  assert.deepEqual(shown, faq.map((q) => [q.name, q.acceptedAnswer.text]));
  assert.ok(!/soybean[^s]*\btarget/i.test(page.match(/<div class="emc-ctl">[\s\S]*?<\/div>/)[0]), "no soybean button");
  assert.match(page, /src="\/components\/grain-emc\.js\?v=\d+"/);
  assert.match(page, /src="\/components\/grain-emc-ui\.js\?v=\d+"/);
  assert.ok(Buffer.byteLength(page) < 60000, "page stays small");
});

test("linked from the tools hub, grain bin calculator, store or sell, sitemap and llms.txt", () => {
  for (const f of ["tools.html", "grain-bin-calculator.html", "store-or-sell.html", "components/header.html", "components/footer.html"]) {
    assert.match(readFileSync(ROOT + f, "utf8"), /href="\/grain-emc"/, f);
  }
  assert.match(readFileSync(ROOT + "sitemap.xml", "utf8"), /<loc>https:\/\/agsist\.com\/grain-emc<\/loc>/);
  assert.match(readFileSync(ROOT + "llms.txt", "utf8"), /\(https:\/\/agsist\.com\/grain-emc\)/);
});

test("Zach A. is credited in three places, on the visible page only", () => {
  // Sig approved the name "Zach A." (Oct 15), and nothing else about him.
  const credit = page.match(/<p id="emc-credit"[^>]*>([\s\S]*?)<\/p>/);
  assert.ok(credit, "credit element");
  assert.equal((page.match(/id="emc-credit"/g) || []).length, 1);
  assert.equal(credit[1], 'This tool exists because Zach A. emailed and asked for it. Have an idea for a tool? <a href="/contact">Tell me.</a>');
  const stamp = page.match(/<p id="emc-idea"[^>]*>([\s\S]*?)<\/p>/);
  assert.equal(stamp[1], "Idea by Zach A., a farmer who emailed and asked for it. Thanks, Zach.");
  assert.ok(page.indexOf('id="emc-idea"') < page.indexOf('id="emc-answer"'), "stamp is on the first screen, above the answer");
  const ui = readFileSync(ROOT + "components/grain-emc-ui.js", "utf8");
  assert.match(ui, /Zach&rsquo;s window<\/button>: <b>/);
  assert.match(ui, /title="Named for Zach A\., who asked for this tool\."/);
  assert.match(ui, /class="emc-zwn" hidden>Named for Zach A\., who asked for this tool\.<\/span>/);
  const head = page.slice(0, page.indexOf("</head>"));
  assert.ok(!/Zach/.test(head), "not in the title, meta or JSON-LD");
  assert.ok(!/@/.test(credit[1] + stamp[1]), "no email address");
});
