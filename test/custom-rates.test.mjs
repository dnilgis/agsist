/* /custom-rates and /custom-rates/<state> (scripts/build_custom_rates.py,
 * components/custom-rates.js).
 *
 * Rows read by hand off the surveys are frozen in test/fixtures/custom-rates/hand-checked.json,
 * each under the survey edition it was read from; every other expectation (the middle, a
 * state's place against it, the counts) is computed from the built files, never typed
 * (Nov 3: no test leans on a live value). Browser checks need Playwright and skip without it.
 *
 *   node --test test/custom-rates.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { extname, join, normalize } from "node:path";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const page = read("custom-rates.html");
const js = read("components/custom-rates.js");
const css = read("components/custom-rates.css");
const idx = JSON.parse(read("data/custom-rates/index.json"));
const blend = JSON.parse(read("data/custom-rates/blend.json"));
const doc = (st) => JSON.parse(read(`data/custom-rates/${st}.json`));
const row = (d, o, u) => d.rows.find((r) => r.o === o && (!u || r.u === u));
const HAND = JSON.parse(read("test/fixtures/custom-rates/hand-checked.json"));
/* a number as the page prints it: half up, 3 places for a small per-bushel or per-bale number */
const SMALLU = new Set(["bushel", "point per bushel", "gross bushel", "bushel / month", "bushel / year", "bushel / round trip", "horsepower / hour", "bale / loaded mile", "bale"]);
const placesOf = (v, u) => (u === "percent of crop" ? 2 : v < 1 && SMALLU.has(u) ? 3 : v >= 1000 ? 0 : 2);
const hu = (v, p) => { const s = (Math.abs(v)).toFixed(p + 4); const [i, f = ""] = s.split("."); const keep = i + f.slice(0, p); const up = +f[p] >= 5; let n = BigInt(keep) + (up ? 1n : 0n); const str = n.toString().padStart(p + 1, "0"); return Number(p ? str.slice(0, -p) + "." + str.slice(-p) : str); };
const shownV = (v, u) => hu(v, placesOf(v, u));
const usd = (v, u) => { const r = shownV(v, u), p = placesOf(v, u); if (p === 3) { let t = r.toFixed(3).replace(/0+$/, ""); if (t.split(".")[1].length < 2) t = r.toFixed(2); return "$" + t; } return p === 0 ? "$" + r.toLocaleString("en-US") : "$" + r.toFixed(2); };
const med = (v) => { const s = [...v].sort((a, b) => a - b), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const reEsc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

test("build is current and its selftest passes", () => {
  execFileSync("python3", ["scripts/build_custom_rates.py", "--check"], { cwd: ROOT, stdio: "pipe" });
  const out = execFileSync("python3", ["scripts/build_custom_rates.py", "--selftest"], { cwd: ROOT }).toString();
  assert.match(out, /selftest: 0 failed/);
});

test("every row's numbers sit together on one line of the saved survey (when the references branch is here)", (t) => {
  const has = spawnSync("git", ["-C", ROOT, "cat-file", "-e", "origin/references:index.json"]).status === 0;
  if (!has) return t.skip("origin/references not fetched");
  const r = spawnSync("python3", ["scripts/build_custom_rates.py", "--verify-refs"], { cwd: ROOT });
  assert.equal(r.status, 0, r.stdout.toString().slice(-2000));
  assert.match(r.stdout.toString(), /MO: skipped, numbers-only source/, "the skip is said out loud");
});

test("hand-checked numbers from the surveys (frozen per edition)", () => {
  let compared = 0;
  for (const e of HAND.editions) {
    const d = doc(e.st.toLowerCase());
    // a newer edition replaced the one these rows were read from: its rows need reading again (a new fixture entry)
    assert.equal(d.survey, e.survey, `${e.st}: the survey edition changed; read its rows by hand and add them to the fixture`);
    for (const want of e.rows) {
      const r = row(d, want.o, want.u);
      assert.ok(r, `${e.st} ${want.o}`);
      assert.deepEqual(Object.fromEntries(Object.keys(want).map((k) => [k, r[k]])), want, `${e.st} ${want.o}`);
      compared++;
    }
  }
  assert.ok(compared >= 10, String(compared));
  assert.equal(doc("ia").spread, "trimmed", "A3-10's range leaves out the lowest and highest answer");
  // Purdue prints hauling in cents (dollars here, marked) and a one standard deviation band
  assert.equal(doc("in").rows.find((r) => r.k === "haul-grain-bu").p, "cents");
  assert.equal(doc("in").spread, "sd");
  // Nebraska's summary repeats the CRP mowing numbers on its dryland corn contract row; withheld, never copied
  const ne = doc("ne");
  assert.ok(!ne.rows.some((r) => r.s === "Custom contract farming" && /corn/i.test(r.o)), "suspect row left out");
  assert.match(ne.withheld, /left out/);
  // Oklahoma prints no range, so none is shown
  assert.ok(doc("ok").rows.every((r) => r.lo == null && r.hi == null));
});

test("Missouri is G302 revised March 2026: 2025 rates, average, median, range and count as printed", () => {
  const mo = doc("mo");
  assert.equal(mo.rate_year, 2025);
  assert.equal(mo.survey_year, 2026);
  assert.equal(mo.sources[0].url, "https://extension.missouri.edu/publications/g302");
  // MU does not allow reposting G302: numbers and a link only, no stored copy (Oct 19)
  assert.deepEqual(mo.sources, [{ url: "https://extension.missouri.edu/publications/g302", numbers_only: true, published: "2026-03" }]);
  assert.match(mo.collected, /^2025 rates \(survey fall 2025 to winter 2026, published March 2026\)/);
  // the rows read off the guide (Tables 3, 4, 5 and 7) are in the frozen fixture; here, the shape
  assert.deepEqual(mo.rows.filter((r) => r.k === "plant-notill").map((r) => r.s), ["Planting, no-till"]);
  const keyed = Object.fromEntries(mo.rows.filter((r) => r.k).map((r) => [r.k, r.o]));
  assert.equal(keyed["combine-corn"], "Corn, combine without grain cart", "combine only, like the other states' combine-corn");
  assert.equal(keyed["spray-ground"], "Spray with row crop sprayer");
  assert.ok(!keyed["spray-tractor"] && !keyed["backhoe"] && !keyed["spray-aerial"], "jobs the 2026 guide does not price the same way stay out of the comparison");
  // Table 9: the guide's anecdotal medians, only a median and labeled as such
  const t9 = mo.rows.filter((r) => r.p === "median-only");
  assert.equal(t9.length, 12);
  assert.ok(t9.every((r) => r.s === "Anecdotal medians, few answers"));
  const h = read("custom-rates/missouri.html");
  const aer = row(mo, "Aerial spray application over cropland"), cc = mo.rows.find((r) => r.k === "combine-corn"), pc = row(mo, "Cut, rake and bale small square bales", "percent of crop");
  assert.match(h, new RegExp('<td class="av"><span class="na">no average printed</span><span class="mdn">median ' + reEsc(usd(aer.md, aer.u)) + ' per acre, few answers</span></td><td class="rg">not printed</td>'));
  assert.match(h, new RegExp(reEsc(usd(cc.a, "acre")) + ' <small>per acre</small><span class="mdn">median ' + reEsc(usd(cc.md, "acre")) + "</span>"));
  assert.match(h, new RegExp(pc.a + "% <small>of the crop</small>"));
  assert.match(h, /average, median and lowest to highest answer/);
  assert.doesNotMatch(h, /2022|\$43\.29/, "nothing left from the April 2023 guide");
});

test("every state file is sane and the index matches", () => {
  const files = readdirSync(join(ROOT, "data/custom-rates")).filter((f) => f !== "index.json" && f !== "blend.json");
  assert.deepEqual(files.map((f) => f.slice(0, 2).toUpperCase()).sort(), idx.states.map((s) => s.st).sort());
  for (const s of idx.states) {
    const d = doc(s.st.toLowerCase());
    assert.equal(d.survey_year, s.year);
    assert.ok(d.sources[0].url.startsWith("https://"), s.st);
    for (const r of d.rows) {
      if (r.p === "median-only") {
        // the survey printed only a median (Missouri G302 Table 9): nothing else is made up, and it never enters the comparison
        assert.ok(r.md > 0 && r.a == null && r.n == null && r.lo == null && r.hi == null && !r.k, `${s.st} ${r.o} median only`);
        continue;
      }
      // a survey that prints no count per job (Pennsylvania 2022, Maryland and Delaware) has none, never a made-up one
      if (d.counts === false) assert.ok(r.a > 0 && r.n === undefined, `${s.st} ${r.o} no count`);
      else assert.ok(r.a > 0 && Number.isInteger(r.n) && r.n > 0, `${s.st} ${r.o}`);
      if (r.lo != null) assert.ok(r.lo <= r.a && r.a <= r.hi, `${s.st} ${r.o} average inside its range`);
      if (r.md != null && r.lo != null) assert.ok(r.lo <= r.md && r.md <= r.hi, `${s.st} ${r.o} median inside its range`);
    }
    for (const nb of s.neighbors) assert.ok(idx.borders[s.st].includes(nb) && idx.states.some((x) => x.st === nb));
  }
  // the comparison only ever holds numbers that are in a state file
  for (const [k, by] of Object.entries(idx.common)) {
    for (const [st, v] of Object.entries(by)) {
      const r = doc(st.toLowerCase()).rows.find((x) => x.k === k);
      assert.deepEqual([r.a, r.u, r.n ?? null], [v[0], v[1], v[4]], `${k} ${st}`);
    }
  }
});

test("page structure, plain words, no em dashes", () => {
  assert.match(page, /<link rel="canonical"\s+href="https:\/\/agsist.com\/custom-rates">/);
  assert.match(page, /<h1>Custom farm rates by state/);
  assert.match(page, /Sigurd Lindquist, CCA/);
  assert.match(page, /Rates are survey averages; your local custom operator may charge more or less\./);
  const ld = JSON.parse(page.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  const faq = ld["@graph"].find((x) => x["@type"] === "FAQPage");
  assert.ok(faq.mainEntity.length >= 5);
  assert.ok(faq.mainEntity.some((q) => /Nobody sets them/.test(q.acceptedAnswer.text)), "never implies AGSIST set the rates");
  assert.equal(ld["@graph"].find((x) => x["@type"] === "WebApplication").author.jobTitle, "Certified Crop Adviser (CCA)");
  for (const [n, s] of [["page", page], ["js", js], ["css", css]]) assert.ok(!s.includes("—"), `${n}: em dash`);
  for (const s of idx.states) {
    if (s.page === false) { assert.ok(!existsSync(join(ROOT, `custom-rates/${s.slug}.html`)), `${s.slug}: no page of its own (no new pages)`); continue; }
    const h = read(`custom-rates/${s.slug}.html`);
    assert.ok(!h.includes("—"), `${s.slug}: em dash`);
    assert.ok(Buffer.byteLength(h) < 60 * 1024, `${s.slug} under 60 KB`);
    assert.match(h, /may charge more or less/);
    // the survey is named with its year, never linked (no direct links to data sources; Oct 29 and Nov 3)
    const d = doc(s.st.toLowerCase());
    assert.ok(h.includes(d.survey.replace(/&/g, "&amp;").replace(/'/g, "&#x27;")), `${s.slug} names its survey`);
    for (const src of d.sources) assert.ok(!h.includes('href="' + src.url.replace(/&/g, "&amp;")), `${s.slug} does not link ${src.url}`);
    const sld = JSON.parse(h.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
    assert.ok(!JSON.stringify(sld).includes(d.sources[0].url), `${s.slug}: no survey file URL in its structured data`);
    assert.match(h, /names it\./, `${s.slug}: the FAQ says the survey is named, not linked`);
    // the state's own number first (Nov 3)
    assert.match(h, /<section class="crh crh-st"/, `${s.slug}: the state's own number first`);
    // the one year rule: the title of the year is the survey, the rate year follows when it differs
    const yr = d.rate_year ? `${d.survey_year} survey of ${d.rate_year} rates` : `${d.survey_year} survey`;
    assert.match(h, new RegExp(`<h1>[^<]*custom rates, ${yr}</h1>`), s.slug);
    const ds = sld["@graph"].find((x) => x["@type"] === "Dataset");
    assert.equal(ds.temporalCoverage, String(d.rate_year || d.survey_year), s.slug);
    assert.ok(ds.name.endsWith(yr), s.slug);
  }
  // the hub links no survey either, and its structured data names the surveys without their files
  for (const s of idx.states) assert.ok(!page.includes('href="' + s.url.replace(/&/g, "&amp;")), `hub does not link ${s.url}`);
  const hubld = JSON.parse(page.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  const hubds = hubld["@graph"].find((x) => x["@type"] === "Dataset");
  assert.ok(hubds.isBasedOn.every((x) => x.name && !x.url));
  assert.doesNotMatch(page, /links the survey|their links/);
  // counts on the share card and in llms.txt come from the files (11 surveys, 12 states with Delaware)
  const nStates = idx.states.reduce((a, s) => a + (s.states ? s.states.length : 1), 0);
  assert.match(page, new RegExp(`og:image:alt" content="[^"]*${idx.states.length} state surveys, ${nStates} states`));
  const llms = read("llms.txt").split("\n").find((l) => /Custom Farm Rates by State/.test(l));
  assert.ok(llms.includes(`${idx.states.length} surveys covering ${nStates} states`) && !/\blink\b/.test(llms), llms);
  // in the menu, footer and the tools hub
  for (const f of ["components/header.html", "components/footer.html", "components/header-fallback.html", "components/footer-fallback.html", "tools.html"]) {
    assert.match(read(f), /href="\/custom-rates"/, f);
  }
});

test("honest empty and failure states", () => {
  assert.match(js, /did not load/);
  assert.match(js, /No ' \+ esc\(d\.name\) \+ ' job matches/);
  assert.match(js, /No bordering state has a survey on this page yet/);
  assert.match(page, /not in survey/);
  assert.match(js, /not printed/);
  assert.match(js, /Too old for the middle/);
  assert.match(js, /too few for a middle/);
  assert.match(js, /not a rate anyone charged/);
});

test("search finds jobs by the words farmers use", () => {
  const ctx = { window: {}, document: { readyState: "loading", addEventListener() {} }, URLSearchParams, location: { search: "" } };
  vm.runInNewContext(js, ctx);
  const { matches, money } = ctx.window.AgCustomRates;
  assert.ok(matches("combine soybeans", "Harvesting Soybean combining acre combine soybeans"));
  assert.ok(matches("combine beans", "Harvesting Soybean combining acre"));
  assert.ok(matches("harvest corn", "Harvesting Corn combining acre"));
  assert.ok(matches("nh3", "Fertilizer Anhydrous, injecting, with tool bar acre"));
  assert.ok(matches("wheat", "Harvest Small grain combining acre"));
  assert.ok(!matches("combine soybeans", "Harvesting Corn combining acre"));
  assert.ok(matches("", "anything"));
  assert.equal(money(46.05, "acre"), "$46.05");
  assert.equal(money(0.135, "bushel"), "$0.135");
  assert.equal(money(0.2, "bushel"), "$0.20");
  assert.equal(money(58, "percent of crop"), "58%");
});

test("the going rate is the middle of the state averages, each state once, nothing inflated", () => {
  // combine corn, worked from the state files themselves: every survey new enough, each once
  const cc = blend.ops["combine-corn"];
  const ry = (d) => d.rate_year || d.survey_year;
  const cur = idx.states.map((s) => [s.st, doc(s.st.toLowerCase())]).filter(([, d]) => ry(d) >= blend.rule.oldest_in_middle)
    .map(([st, d]) => [st, d.rows.find((r) => r.k === "combine-corn" && r.u === cc.u), d]).filter(([st, r, d]) => r && !(d.apart && d.apart["combine-corn"]));
  const vals = cur.map(([, r]) => r.a);
  assert.equal(cc.n, vals.length);
  assert.equal(cc.md, hu(med(vals), 4));
  assert.deepEqual([cc.lo, cc.hi], [Math.min(...vals), Math.max(...vals)]);
  assert.deepEqual(cc.y, [Math.min(...cur.map(([, , d]) => ry(d))), Math.max(...cur.map(([, , d]) => ry(d)))]);
  assert.ok(blend.rule.oldest_in_middle === blend.rule.newest - blend.rule.age_max);
  for (const s of idx.states) {
    const d = doc(s.st.toLowerCase());
    if (ry(d) < blend.rule.oldest_in_middle && d.rows.some((r) => r.k === "combine-corn")) assert.ok(cc.old[s.st] && !cc.by[s.st], `${s.st} is shown with its year but kept out of the middle`);
  }
  for (const [k, op] of Object.entries(blend.ops)) {
    const vals = Object.values(op.by).map((v) => v[0]);
    for (const [st, v] of Object.entries(op.by)) {
      const r = doc(st.toLowerCase()).rows.find((x) => x.k === k);
      assert.equal(v[0], r.a, `${k} ${st}: the survey's own average, unchanged`);
      assert.equal(r.u, op.u, `${k} ${st}: one unit in the middle`);
      const s = blend.states[st];
      assert.ok(s.ry >= blend.rule.oldest_in_middle, `${k} ${st}: ${s.ry} is new enough`);
    }
    // the middle rounds half up (a half cent never goes down by float luck)
    if (vals.length >= blend.rule.min_surveys) assert.equal(op.md, hu(med(vals), 4), k);
    else assert.equal(op.md, undefined, `${k}: too few surveys for a middle`);
    for (const st of Object.keys(op.old || {})) assert.ok(blend.states[st].ry < blend.rule.oldest_in_middle, `${k} ${st} old`);
    for (const st of Object.keys(op.other || {})) assert.notEqual(op.other[st][5], op.u, `${k} ${st} other unit`);
    // a line its survey prices too differently (Wisconsin lime, material not stated) is shown with its note, never in the middle
    for (const [st, v] of Object.entries(op.apart || {})) {
      assert.ok(!op.by[st] && v[5] && doc(st.toLowerCase()).apart[k] === v[5], `${k} ${st} apart`);
    }
  }
  const lime = blend.ops["lime-ton"];
  assert.ok(lime.apart && lime.apart.WI && !lime.by.WI && /material not stated/.test(lime.apart.WI[5]), "Wisconsin lime stays out of the middle");
  // the one year rule: Wisconsin's 2026 survey of 2025 rates reads like Missouri's
  assert.deepEqual([doc("wi").survey_year, doc("wi").rate_year], [2026, 2025]);
  // grain hauling: every state says how far its rate carries the grain
  const haul = blend.ops["haul-grain-bu"];
  for (const st of [...Object.keys(haul.by), ...Object.keys(haul.old || {})]) assert.ok(haul.basis[st], `hauling basis ${st}`);
  // Delaware reads the Maryland and Delaware survey, which counts once
  assert.deepEqual(blend.states.DE, { same_as: "MD", name: "Delaware" });
  assert.equal(blend.states.MD.name, "Maryland and Delaware");
  assert.ok(!Object.values(blend.ops).some((op) => op.by.DE), "Delaware never counts twice");
  // a line whose low, high, median and average are one number may be one answer: never lined up
  for (const r of doc("md").rows) if (r.lo === r.hi && r.lo != null) assert.ok(!r.k, `${r.o} is not in the comparison`);
  // machinery cost estimates are costs, shown beside the rate, never in the middle
  const il = blend.diy.find((d) => /Illinois/.test(d.name));
  assert.deepEqual(il.ops["combine-corn"], [54.4, "acre", "Corn"]);
  assert.ok(!Object.keys(blend.states).includes("MI") && !Object.keys(blend.states).includes("IL"), "no cost estimate is treated as a survey");
  for (const [k, v] of Object.entries(il.ops)) assert.equal(v[1], blend.ops[k].u, `${k}: same unit as the going rate`);
});

test("custom rates panel, Nov 3: plain words for each range, hauling miles, baling, Ohio, loading", () => {
  // each survey's range named for what it is: Purdue's band is where most answers fell, not the lowest and highest
  assert.match(read("custom-rates/indiana.html"), /most answers fell between \$/);
  assert.match(read("custom-rates/iowa.html"), /trimmed range \(lowest and highest answer left out\)/);
  assert.match(js, /most answers fell between/);
  assert.match(js, /Range: the lowest and highest answer/);
  assert.doesNotMatch(js, /Answers ran: the lowest and highest answer it printed/);
  // Ohio's new survey: when it came out, in plain words, no first person
  assert.match(blend.not_covered.OH, /late summer 2026/);
  assert.doesNotMatch(blend.not_covered.OH, /\bI\b/);
  // the hub's hauling answer gives every state's miles; a baling answer from the round bale rows
  const haul = blend.ops["haul-grain-bu"], bale = blend.ops["bale-round"];
  const faq = JSON.parse(page.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])["@graph"].find((x) => x["@type"] === "FAQPage").mainEntity;
  const hq = faq.find((q) => /grain hauling/.test(q.name)).acceptedAnswer.text;
  for (const [st, t] of Object.entries(haul.basis)) assert.ok(hq.includes(t), `hauling FAQ: ${st} ${t}`);
  const bq = faq.find((q) => /round baling/.test(q.name)).acceptedAnswer.text;
  for (const [st, v] of Object.entries(bale.by)) assert.ok(bq.includes(`${blend.states[st].name}`) && bq.includes(usd(v[0], "bale")), `baling FAQ: ${st}`);
  assert.match(page, /Haul grain by truck: states measure different distances: /);
  // half a cent rounds up, the same in the page script as in the builder, and over/under comes from the shown numbers
  const ctx = { window: {}, document: { readyState: "loading", addEventListener() {} }, URLSearchParams, location: { search: "" } };
  vm.runInNewContext(js, ctx);
  const { money } = ctx.window.AgCustomRates;
  assert.equal(money(41.865, "acre"), "$41.87");
  assert.equal(money(12.125, "acre"), "$12.13");
  assert.equal(money(0.1945, "bushel"), "$0.195");
  // the pickers start disabled and the script says it is loading; a failed load says so in place
  for (const sel of ['id="cr-q" disabled', 'id="cr-st" disabled', 'id="cr-print" disabled']) assert.ok(page.includes(sel), sel);
  assert.match(js, /Loading the rates\.\.\./);
  assert.match(js, /'Not loaded\.'/);
  // long state tables keep their column names in view; the hub summary keeps the state in view sideways
  assert.match(css, /\.cr-tw-v \.cr-t thead th\{position:sticky/);
  assert.match(css, /\.cr-sum th\[scope="row"\][^{]*\{position:sticky;left:0/);
  for (const s of idx.states.filter((x) => x.page !== false)) assert.match(read(`custom-rates/${s.slug}.html`), /class="cr-tw cr-tw-v"/, s.slug);
  // Maryland and Delaware have their own page now; Pennsylvania stays on the hub until a newer survey
  assert.ok(existsSync(join(ROOT, "custom-rates/maryland-and-delaware.html")));
  assert.match(read("sitemap.xml"), /custom-rates\/maryland-and-delaware</);
  assert.equal(idx.states.find((s) => s.st === "PA").page, false);
});

test("diesel: only a fuel price the survey printed, beside USDA farm diesel, never adjusting a rate", () => {
  const files = { IA: "scripts/custom_rates/ia.tsv", OH: "scripts/custom_rates/oh.tsv", IL: "scripts/custom_rates/diy/il-2025.tsv" };
  assert.deepEqual(Object.keys(blend.diesel).sort(), Object.keys(files).sort());
  for (const [st, f] of Object.entries(files)) {
    const meta = read(f).split("\n").filter((l) => /^# (includes|basis):/.test(l)).join(" ");
    for (const n of blend.diesel[st].price.match(/\d+\.\d\d/g)) assert.ok(meta.includes(n), `${st} diesel ${n} is in the survey's own words`);
  }
  assert.match(js, /never adjusted for fuel/);
  assert.match(js, /No USDA farm diesel report covers /);
});

test("calculators read the one blend file and fill only on a tap", () => {
  const hint = read("components/rate-hint.js");
  assert.match(hint, /\/data\/custom-rates\/blend\.json/);
  assert.equal((hint.match(/inp\.value = /g) || []).length, 1, "the input is written in one place only: the tap");
  for (const [f, k] of [["breakeven.html", "custom-farm-corn"], ["harvest-or-wait.html", "dry-corn-pt"], ["grain-shrink.html", "dry-corn-pt"], ["grain-bin-calculator.html", "dry-corn-pt"]]) {
    const h = read(f);
    assert.match(h, new RegExp('class="rate-hint"[^>]*data-cr-job="[^"]*' + k), f);
    assert.match(h, /<script src="\/components\/rate-hint\.js\?v=\d+" defer><\/script>/, f);
  }
});

// the PR checks set PLAYWRIGHT_PATH and CHROMIUM_PATH (pr-checks.yml); the session paths otherwise
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
function serve() {
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
  return createServer((req, res) => {
    let p = decodeURIComponent(req.url.split("?")[0]);
    if (p.endsWith("/")) p += "index.html";
    let f = normalize(join(ROOT, p));
    if ((!existsSync(f) || statSync(f).isDirectory()) && existsSync(f + ".html")) f += ".html";
    if (!f.startsWith(ROOT) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
}
test("browser: the reader's state first, the middle under it, only the needed files, search, no sideways scroll at 390 and 1280", async (t) => {
  if (!existsSync(PW) || !existsSync(CHROME)) return t.skip("no Playwright");
  const { chromium } = await import(PW);
  const srv = serve();
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const b = await chromium.launch({ executablePath: CHROME });
  // every expectation from the built files (Nov 3: no live literals)
  const cc = blend.ops["combine-corn"], ne = cc.by.NE, ns = blend.states.NE, ny = ns.ry === ns.year ? `${ns.year} survey` : `${ns.year} survey of ${ns.ry} rates`;
  const dd = Math.round((shownV(ne[0], "acre") - shownV(cc.md, "acre")) * 1e6) / 1e6;
  const vctx = { window: {}, document: { readyState: "loading", addEventListener() {} }, URLSearchParams, location: { search: "" } };
  vm.runInNewContext(js, vctx);
  const { matches } = vctx.window.AgCustomRates;
  const neDoc = doc("ne");
  try {
    for (const w of [390, 1280]) {
      const ctx = await b.newContext({ viewport: { width: w, height: 900 } });
      await ctx.addInitScript(() => { try { localStorage.setItem("agsist-wx-loc", JSON.stringify({ state: "NE" })); } catch (e) {} });
      const p = await ctx.newPage();
      const got = [];
      p.on("request", (r) => { const m = r.url().match(/data\/custom-rates\/([a-z]+)\.json/); if (m) got.push(m[1]); });
      await p.goto(base + "/custom-rates", { waitUntil: "networkidle" });
      await p.waitForFunction(() => /Nebraska/.test(document.getElementById("cr-as").textContent));
      assert.equal(await p.inputValue("#cr-st"), "NE");
      assert.equal(await p.isDisabled("#cr-q"), false, "the pickers come alive once the rates load");
      assert.equal((await p.textContent("#cr-status")).trim(), "");
      assert.deepEqual(got.sort(), ["blend"], "the first screen reads the blend file only");
      // Nebraska's own number big, with its wording, answers and range; the middle on the line under it
      assert.equal(await p.textContent("#cr-av"), usd(ne[0], "acre"), "the reader's state is the big number");
      assert.equal(await p.textContent("#cr-as"), `Nebraska's ${ny}, “${ne[4]}”: ${ne[3]} answers. Answers ran ${usd(ne[1], "acre")} to ${usd(ne[2], "acre")}.`);
      assert.match(await p.textContent("#cr-me"), new RegExp("^" + reEsc(`Middle of ${cc.n} state surveys: ${usd(cc.md, "acre")} an acre`) + ".*" + reEsc(dd === 0 ? "Nebraska is right at it" : `Nebraska is ${usd(Math.abs(dd), "acre")} ${dd > 0 ? "over" : "under"} it`)));
      const il = blend.diy.find((d) => d.ops["combine-corn"]);
      assert.match(await p.textContent("#cr-diy"), new RegExp("^Doing it yourself: " + reEsc(usd(il.ops["combine-corn"][0], "acre")) + " an acre"));
      // every tap target at least 44 px tall (the site glossary's inline words are words in a sentence), the side gutter 12 px on a phone
      const small = await p.evaluate(() => [...document.querySelectorAll(".cr button:not(.gl-term), .cr select, .cr input, .crn a, .cr-faq summary, .cr .rel a")].filter((e) => e.offsetParent && e.getBoundingClientRect().height < 44).map((e) => e.outerHTML.slice(0, 60)));
      assert.deepEqual(small, [], `taps under 44 px at ${w}`);
      if (w === 390) assert.equal(await p.evaluate(() => Math.round(document.querySelector(".crh").getBoundingClientRect().left)), 12);
      const [sw, cw] = await p.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
      assert.ok(sw <= cw, `no sideways scroll at ${w}: ${sw} > ${cw}`);
      // a job's own row opens every state's number, Nebraska first
      if (w === 390) await p.click("#harvest .crc-t");
      await p.click("#combine-soy .cro-b");
      const d = await p.textContent("#combine-soy .cro-d");
      assert.match(d, /^Each state survey's average/);
      assert.ok(d.indexOf("Nebraska") < d.indexOf("Iowa"), "the reader's state first");
      // search: the jobs across states, and Nebraska's own lines, which load its file only now
      const soy = neDoc.rows.find((r) => r.k === "combine-soy").o;
      await p.fill("#cr-q", "combine soybeans");
      await p.waitForFunction((o) => document.querySelector("#harvest .crc-st").textContent.includes(o), soy);
      assert.ok(got.includes("ne") && got.length === 2, "Nebraska's file loads when its lines are asked for: " + got);
      await p.waitForFunction(() => /own line/.test(document.getElementById("cr-count").textContent));
      assert.match(await p.textContent("#cr-count"), /match "combine soybeans"/);
      // a word no job across states uses but Nebraska's own lines do: those lines show, and the count says where
      const irr = neDoc.rows.filter((r) => matches("irrigated", r.s + " " + r.o + " " + r.u));
      assert.ok(irr.length > 0);
      await p.fill("#cr-q", "irrigated");
      await p.waitForFunction(() => /own line/.test(document.getElementById("cr-count").textContent) && /irrigated/.test(document.getElementById("cr-count").textContent));
      const cnt = await p.textContent("#cr-count");
      assert.ok(cnt.includes(`${irr.length} of Nebraska's own line${irr.length === 1 ? "" : "s"} match`), cnt);
      for (const r of irr) {
        const sec = "#" + r.c;
        assert.equal(await p.isVisible(sec), true, `${sec} shows for ${r.o}`);
        await p.waitForFunction(([s, o]) => document.querySelector(s + " .crc-st").textContent.includes(o), [sec, r.o]);
      }
      // every category the count names is on the screen
      const named = cnt.replace(/.*under /, "").replace(/\.$/, "").split(", ");
      for (const c of blend.cats.filter((c) => named.includes(c[1]))) assert.equal(await p.isVisible("#" + c[0]), true, c[1]);
      await p.fill("#cr-q", "zzzz");
      await p.waitForFunction(() => /No job across states matches "zzzz". None of Nebraska's own lines match either/.test(document.getElementById("cr-count").textContent));
      await ctx.close();
    }
    // Delaware reads the shared survey; Missouri's medians and median-only lines; a state page; Pennsylvania old
    const ctx = await b.newContext({ viewport: { width: 390, height: 900 } });
    const p = await ctx.newPage();
    await p.goto(base + "/custom-rates?st=DE", { waitUntil: "networkidle" });
    await p.waitForFunction(() => /^The Maryland and Delaware \d{4} survey( of \d{4} rates)?, which Delaware shares/.test(document.getElementById("cr-as").textContent));
    assert.equal(await p.textContent("#cr-av"), usd(cc.by.MD[0], "acre"));
    const aer = row(doc("mo"), "Aerial spray application over cropland");
    await p.goto(base + "/custom-rates?st=MO&q=aerial", { waitUntil: "networkidle" });
    await p.waitForFunction(() => /no average printed/.test(document.getElementById("cr-cats").textContent));
    assert.match(await p.textContent("#cr-cats"), new RegExp("median " + reEsc(usd(aer.md, "acre")) + " per acre, few answers"));
    const pa = blend.ops["combine-soy"].old.PA;
    await p.goto(base + "/custom-rates?st=PA&k=combine-soy", { waitUntil: "networkidle" });
    await p.waitForFunction(() => /Too old for the middle/.test(document.getElementById("cr-as").textContent));
    assert.equal(await p.textContent("#cr-av"), usd(pa[0], "acre"));
    for (const u of ["/custom-rates/iowa", "/custom-rates/missouri", "/custom-rates/maryland-and-delaware"]) {
      await p.goto(base + u, { waitUntil: "networkidle" });
      const [sw, cw] = await p.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
      assert.ok(sw <= cw, `${u} no sideways scroll`);
      // the column names stay in view under the site header down a long table
      // the site scrolls smoothly (styles.css): jump there at once and wait until the page is there, then measure
      const want = await p.evaluate(() => {
        const y = Math.round(document.querySelector(".cr-full tbody tr:nth-child(30)").getBoundingClientRect().top + scrollY);
        window.scrollTo({ top: y, behavior: "instant" });
        return Math.min(y, document.documentElement.scrollHeight - innerHeight);
      });
      await p.waitForFunction((y) => Math.abs(scrollY - y) <= 2, want);
      await p.waitForTimeout(50);
      assert.ok(await p.evaluate(() => document.querySelector(".cr-full").getBoundingClientRect().top < 0), `${u}: the table's top is above the screen`);
      const [thTop, navBottom] = await p.evaluate(() => [document.querySelector(".cr-full thead th").getBoundingClientRect().top, document.querySelector(".nav") ? document.querySelector(".nav").getBoundingClientRect().bottom : 0]);
      assert.ok(Math.abs(thTop - navBottom) <= 2, `${u}: header row sticks under the site header (${thTop} vs ${navBottom})`);
      const small = await p.evaluate(() => [...document.querySelectorAll(".cr-faq summary, .cr-other a, .cr-btn")].filter((e) => e.offsetParent && e.getBoundingClientRect().height < 44).map((e) => e.outerHTML.slice(0, 60)));
      assert.deepEqual(small, [], `${u}: taps under 44 px`);
    }
    // quote my job, the diesel line and the state's rate sheet, every number from the files
    const pc = JSON.parse(read("data/production-costs.json"));
    const iaCC = blend.ops["combine-corn"].by.IA;
    await p.goto(base + "/custom-rates?st=IA&qj=combine-corn~640", { waitUntil: "networkidle" });
    await p.waitForFunction(() => /at the survey averages/.test(document.getElementById("cr-quote").textContent));
    const qt = await p.textContent("#cr-quote");
    const tot = "$" + Math.round(shownV(iaCC[0], "acre") * 640).toLocaleString("en-US");
    assert.ok(qt.includes(tot + " at the survey averages"), qt);
    assert.match(qt, /Survey average x your numbers/);
    // the quote in a link keeps decimals (12.5 acres, 0.25 of a job's unit), in the new form and in links shared before it
    for (const q of ["combine-corn~12.5_haul-grain-bu~0.25", "combine-corn~12.5.haul-grain-bu~0.25"]) {
      await p.goto(base + "/custom-rates?st=IA&qj=" + q, { waitUntil: "networkidle" });
      await p.waitForFunction(() => /at the survey averages/.test(document.getElementById("cr-quote").textContent));
      assert.deepEqual(await p.evaluate(() => window.AgCustomRates.quoteList()), [{ k: "combine-corn", q: 12.5 }, { k: "haul-grain-bu", q: 0.25 }], q);
      assert.deepEqual(await p.$$eval("#cr-quote input[data-qi]", (els) => els.map((e) => e.value)), ["12.5", "0.25"], q);
      assert.match(new URL(p.url()).searchParams.get("qj") || "", /^combine-corn~12\.5_haul-grain-bu~0\.25$/, "written back with '_' between jobs");
      // hauling: the survey's miles beside its per-bushel rate, on the page and the print
      const ql = await p.textContent("#cr-quote");
      assert.ok(ql.includes(`(${blend.ops["haul-grain-bu"].basis.IA})`), ql);
      const spec = await p.evaluate(() => window.AgCustomRates.quote());
      assert.ok(spec.sections[0].table.rows[1][2].includes(`(${blend.ops["haul-grain-bu"].basis.IA})`), spec.sections[0].table.rows[1][2]);
    }
    // a line on an old survey or one kept out of the middle says so, with its year or note
    await p.goto(base + "/custom-rates?st=OK&qj=combine-soy~100", { waitUntil: "networkidle" });
    await p.waitForFunction(() => /at the survey averages/.test(document.getElementById("cr-quote").textContent));
    assert.match(await p.textContent("#cr-quote"), new RegExp(`Oklahoma's ${blend.states.OK.year} survey average \\(too old for the middle\\)`));
    await p.goto(base + "/custom-rates?st=WI&qj=lime-ton~40", { waitUntil: "networkidle" });
    await p.waitForFunction(() => /at the survey averages/.test(document.getElementById("cr-quote").textContent));
    assert.ok((await p.textContent("#cr-quote")).includes("(not in the middle: " + blend.ops["lime-ton"].apart.WI[5] + ")"));
    await p.goto(base + "/custom-rates?st=IA&qj=combine-corn~640", { waitUntil: "networkidle" });
    await p.waitForFunction(() => /^Diesel: /.test(document.getElementById("cr-diesel").textContent));
    const dz = await p.textContent("#cr-diesel");
    assert.ok(dz.startsWith(`Diesel: ${blend.diesel.IA.who} figured ${blend.diesel.IA.price} (${blend.diesel.IA.when}).`), dz);
    const rep = Object.values(pc.reports).find((r) => r.states.includes("IA") && r.items.some((i) => i.key === "diesel"));
    if (rep) assert.ok(dz.includes("$" + rep.items.find((i) => i.key === "diesel").avg.toFixed(2) + " a gallon"), dz);
    else assert.match(dz, /No USDA farm diesel report covers Iowa/);
    const sheet = await p.evaluate(() => window.AgCustomRates.sheet());
    assert.equal(sheet.title, "Iowa custom rate sheet");
    const head = sheet.sections[0].table.head;
    assert.equal(head[head.length - 1], "My price");
    assert.ok(sheet.sections.every((sec) => sec.table.rows.every((r) => r[r.length - 1] === "")), "the my-price column is blank");
    assert.deepEqual(sheet.sources.map((x) => x.date).slice(0, 1), [`${blend.states.IA.year} survey`]);
    await p.goto(base + "/custom-rates?st=OH", { waitUntil: "networkidle" });
    await p.waitForFunction(() => /^Diesel: /.test(document.getElementById("cr-diesel").textContent));
    if (!Object.values(pc.reports).some((r) => r.states.includes("OH"))) assert.match(await p.textContent("#cr-diesel"), /No USDA farm diesel report covers Ohio/);
    assert.match(await p.textContent("#cr-notice"), /Email me when Ohio's next custom rate survey is out/);
    // an old link to the tool's parts lands on the answer
    await p.goto(base + "/custom-rates#cr-cmp", { waitUntil: "networkidle" });
    await ctx.close();
    // the rates load slowly, then not at all: the pickers wait and say so, and the empty panels say not loaded
    const c2 = await b.newContext({ viewport: { width: 390, height: 900 } });
    const p2 = await c2.newPage();
    let release;
    const gate = new Promise((r) => { release = r; });
    await p2.route("**/data/custom-rates/blend.json", async (route) => { await gate; await route.fulfill({ status: 404, body: "" }); });
    await p2.goto(base + "/custom-rates", { waitUntil: "domcontentloaded" });
    await p2.waitForFunction(() => /Loading the rates/.test(document.getElementById("cr-status").textContent));
    assert.equal(await p2.isDisabled("#cr-q"), true);
    assert.equal(await p2.isDisabled("#cr-st"), true);
    release();
    await p2.waitForFunction(() => /did not load/.test(document.getElementById("cr-status").textContent));
    assert.equal(await p2.isDisabled("#cr-st"), true, "a dead picker never looks live");
    assert.equal(await p2.textContent("#cr-me"), "Not loaded.");
    await c2.close();
  } finally {
    await b.close();
    srv.close();
  }
});

test("browser: a calculator's hint fills only on a tap, and one more tap puts the reader's number back", async (t) => {
  if (!existsSync(PW) || !existsSync(CHROME)) return t.skip("no Playwright");
  const { chromium } = await import(PW);
  const srv = serve();
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const b = await chromium.launch({ executablePath: CHROME });
  try {
    const p = await b.newPage({ viewport: { width: 390, height: 900 } });
    await p.goto(base + "/harvest-or-wait", { waitUntil: "networkidle" });
    await p.waitForSelector('.rate-hint button[data-rh="use"]');
    assert.equal(await p.inputValue("#hw-cpp"), "", "nothing is filled on load");
    assert.match(await p.textContent(".rate-hint"), /middle 5\.5\u00a2 a bushel a point \(5\u00a2 to 6\u00a2, 3 surveys/);
    await p.fill("#hw-cpp", "4.2");
    await p.click('.rate-hint button[data-rh="use"]');
    assert.equal(await p.inputValue("#hw-cpp"), "5.5");
    assert.ok(await p.isChecked('input[name="hw-cost"][value="point"]'));
    await p.click('.rate-hint button[data-rh="back"]');
    assert.equal(await p.inputValue("#hw-cpp"), "4.2", "the reader's own number comes back");
    await p.goto(base + "/breakeven", { waitUntil: "networkidle" });
    await p.waitForSelector('.rate-hint button[data-rh="use"]');
    assert.equal(await p.inputValue("#machinery"), "210");
    await p.selectOption("#crop", "wheat");
    await p.waitForFunction(() => document.querySelector(".rate-hint").textContent === "");
  } finally {
    await b.close();
    srv.close();
  }
});
