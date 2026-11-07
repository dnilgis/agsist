/* Infographic of the Week (Nov 7, 2026): the spec builder, the page builder and the three shapes.
 *   1. scripts/build_infographic.py reproduces every number from its source file (the frozen fixtures in
 *      test/fixtures/infographic/data, the Crop Progress week ending Nov 1, 2026 and the COT week to Nov 3, 2026);
 *      the numbers are recomputed here from those files, never typed. It refuses look-ahead and two files that
 *      disagree.
 *   2. scripts/build_infographic_pages.py: the hook is the title and the H1, ImageObject and Dataset JSON-LD,
 *      og:image is the link preview card, links to the related page and the last 4, the archive newest first,
 *      no em dash, under the 150 KB page budget. The pages are a generated set (built on main).
 *   3. In a browser: the phone picture 1080 x 1350 and the link picture 1200 x 630 from the spec, the print sheet
 *      exactly 1 page on Letter and A4, and without share-kit.js the page is whole and the buttons stay hidden.
 *
 *   4. The Friday Chart poster (Sig Nov 7): every panel number recomputed from the fixtures, a tie at the last
 *      place of a list shown and not broken, each panel with a source and a date; in a browser the dark phone
 *      poster (1080 x 2400) and the paper print poster fit (no text outside its panel, no two texts on top of each
 *      other, nothing past the bottom, as the approved draft's render.mjs checked), the paper poster prints as one
 *      11 x 17 page (and one Letter page), and without share-kit.js the poster buttons stay hidden.
 *
 *   node --test test/infographic.test.mjs     (INFOG_OUT=<dir> also saves the pictures, the posters and the PDFs)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const FX = "test/fixtures/infographic";
const fx = (f) => JSON.parse(read(`${FX}/data/${f}`));
const DASH = /[\u2013\u2014]|&mdash;|&ndash;/;
const py = (...a) => spawnSync("python3", a, { cwd: ROOT, encoding: "utf8" });
const spec = (kind, date) => {
  const r = py("scripts/build_infographic.py", kind, date, "--root", FX, "--print");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return JSON.parse(r.stdout);
};
const num = (n) => Math.abs(n).toLocaleString("en-US");
const NAMES = { IA: "Iowa", SD: "South Dakota", MI: "Michigan", NE: "Nebraska", OH: "Ohio" };

// ------------------------------------------------------------------ 1. the spec builder
test("harvest-gap: every number recomputed from the Crop Progress file (week ending Nov 1, 2026)", () => {
  const cp = fx("crop-progress.json"), s = spec("harvest-gap", "2026-11-06");
  const nat = cp.progress.corn_harvested, soy = cp.progress.soybeans_harvested;
  assert.equal(nat.date, "2026-11-01");  // pin-ok: the frozen fixtures in test/fixtures/infographic, not live data
  assert.deepEqual([nat.pct, nat.avg5, soy.pct, soy.avg5], [74, 77, 88, 84], "the example: corn 74% vs 77%, soybeans 88% vs 84%");
  // the states with a NASS-printed average, furthest behind first
  for (const [i, crop] of ["corn_harvested", "soybeans_harvested"].entries()) {
    const want = Object.entries(cp.states).filter(([, v]) => v[crop] && v[crop].avg5_by === "NASS" && v[crop].date === "2026-11-01")
      .map(([k, v]) => ({ k, gap: v[crop].pct - v[crop].avg5, values: [v[crop].pct, v[crop].avg5] }));
    const got = s.chart.panels[i].rows;
    assert.equal(got.length, want.length, crop + ": every state with a NASS average, no other");
    for (const r of got) assert.deepEqual(r.values, want.find((w) => w.k === r.key).values, crop + " " + r.key);
    const gaps = got.map((r) => r.values[0] - r.values[1]);
    assert.deepEqual(gaps, [...gaps].sort((a, b) => a - b), "furthest behind first");
  }
  const ia = cp.states.IA.corn_harvested;
  assert.deepEqual([ia.pct, ia.avg5], [66, 79], "the example: Iowa 66% vs 79%");
  const corn = s.chart.panels[0].rows, far = corn.reduce((a, r) => Math.abs(r.values[0] - r.values[1]) > Math.abs(a.values[0] - a.values[1]) ? r : a);
  assert.equal(far.key, "IA");
  assert.equal(s.title, `Iowa corn harvest ${ia.avg5 - ia.pct} points behind its 5-year average`);
  assert.ok(s.title.length <= 60);
  assert.deepEqual(s.big, { value: ia.pct, unit: "%", label: `Iowa corn harvested by Nov 1 (5-year average ${ia.avg5}%)` });  // pin-ok: the frozen fixtures in test/fixtures/infographic, not live data
  assert.deepEqual(s.chart.highlight, ["IA"]);
  assert.equal(s.facts[0].text, `U.S. corn harvest: ${nat.pct}% done, ${nat.avg5 - nat.pct} points behind the 5-year average of ${nat.avg5}%.`);
  assert.equal(s.facts[1].text, `U.S. soybean harvest: ${soy.pct}% done, ${soy.pct - soy.avg5} points ahead of the 5-year average of ${soy.avg5}%.`);
  const behind = corn.filter((r) => r.values[0] < r.values[1]).length;
  assert.equal(s.facts[2].text, `${behind} of the ${corn.length} corn states NASS prints an average for are behind it.`);
  for (const f of s.facts) { assert.equal(f.date, "2026-11-01"); assert.equal(f.source, "USDA NASS Crop Progress, week ending Nov 1, 2026"); }  // pin-ok: the frozen fixtures in test/fixtures/infographic, not live data
  assert.deepEqual(s.sources.map((x) => x.period), ["Week ending Nov 1, 2026"]);  // pin-ok: the frozen fixtures in test/fixtures/infographic, not live data
  assert.equal(s.related_page, "/conditions");
  assert.doesNotMatch(JSON.stringify(s), DASH);
});

test("funds-corn: the net, its run and the long/short split recomputed from the COT files (positions Nov 3, 2026)", () => {
  const h = fx("cot-history.json").history.corn, an = fx("cot-analysis.json"), s = spec("funds-corn", "2026-11-06");
  const last = h[h.length - 1], prev = h[h.length - 2];
  assert.equal(last.date, an.report_date);
  // the run of consecutive weekly cuts ending this week
  let n = 0;
  for (let i = h.length - 1; i > 0 && h[i].net < h[i - 1].net && (Date.parse(h[i].date) - Date.parse(h[i - 1].date)) === 7 * 864e5; i--) n++;
  assert.equal(n, an.commodities.corn.card.streak, "the run agrees with the analysis file's streak");
  const path_ = h.slice(-1 - n);
  assert.deepEqual(s.chart.points.map((p) => [p.x, p.y]), path_.map((r) => [r.date, r.net]));
  const total = last.net - path_[0].net;
  assert.equal(s.title, `Funds' corn net down ${num(total)} contracts in ${n} weeks`);
  assert.ok(s.title.length <= 60);
  assert.deepEqual(s.big, { value: last.net, unit: "contracts net long", label: "Managed money in corn futures, positions Nov 3, 2026" });  // pin-ok: the frozen fixtures in test/fixtures/infographic, not live data
  const dl = last.long - prev.long, ds = last.short - prev.short;
  assert.deepEqual([dl, ds], [an.commodities.corn.card.how.long_change, an.commodities.corn.card.how.short_change], "the split agrees with the history rows");
  assert.equal(s.facts[0].text, `This week: net down ${num(last.net - prev.net)} contracts to ${num(last.net)} long.`);
  assert.equal(s.facts[1].text, `Longs \u2212${num(dl)}, shorts +${num(ds)}: ${an.commodities.corn.card.how.label}.`);
  assert.equal(s.facts[2].text, `${n} straight weekly cuts: ${num(path_[0].net)} net long on Sep 15, ${num(last.net)} long on Nov 3.`);  // pin-ok: the frozen fixtures in test/fixtures/infographic, not live data
  for (const f of s.facts) { assert.equal(f.date, last.date); assert.match(f.source, /^CFTC Commitments of Traders, Disaggregated Futures-Only, positions Nov 3, 2026, released Nov 6, 2026$/); }  // pin-ok: the frozen fixtures in test/fixtures/infographic, not live data
  assert.deepEqual(s.chart.split, { long_change: dl, short_change: ds, label: an.commodities.corn.card.how.label });
  assert.equal(s.related_page, "/cot");
});

test("the spec builder refuses look-ahead, old news and two files that disagree", () => {
  for (const [kind, date, why] of [["harvest-gap", "2026-11-01", /published 2026-11-02, after/], ["funds-corn", "2026-11-05", /published 2026-11-06, after/],
    ["harvest-gap", "2026-11-30", /more than 14 days/]]) {
    const r = py("scripts/build_infographic.py", kind, date, "--root", FX, "--print");
    assert.equal(r.status, 1, kind + " " + date);
    assert.match(r.stdout, why);
  }
  const d = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "igfx-"));
  fs.mkdirSync(path.join(d, "data"));
  for (const f of ["cot-history.json", "cot-analysis.json"]) fs.copyFileSync(path.join(ROOT, FX, "data", f), path.join(d, "data", f));
  const an = fx("cot-analysis.json"); an.commodities.corn.card.how.short_change += 1;
  fs.writeFileSync(path.join(d, "data", "cot-analysis.json"), JSON.stringify(an));
  const r = py("scripts/build_infographic.py", "funds-corn", "2026-11-06", "--root", d, "--print");
  assert.equal(r.status, 1); assert.match(r.stdout, /disagrees with cot-history/);
  fs.rmSync(d, { recursive: true, force: true });
  assert.equal(py("scripts/build_infographic.py", "--selftest").status, 0);
  assert.equal(py("scripts/build_infographic_pages.py", "--selftest").status, 0);
});

// ------------------------------------------------------------------ 4a. the poster block (Friday Chart)
const posterOf = (s) => Object.fromEntries(s.poster.panels.map((p) => [p.id, p]));
test("poster, harvest-gap: every panel number recomputed from the Crop Progress file, ties shown, a source and date on each", () => {
  const cp = fx("crop-progress.json"), s = spec("harvest-gap", "2026-11-06"), P = posterOf(s), wk = cp.progress.corn_harvested.date;
  const names = Object.fromEntries(s.chart.panels[0].rows.map((r) => [r.key, r.label])), STNAME = (k) => names[k];
  assert.deepEqual(s.poster.panels.map((p) => p.id), ["hook", "map", "count", "crops", "lists", "means"]);
  for (const p of s.poster.panels) {
    assert.equal(p.date, wk, p.id + " date");
    assert.match(p.source, /^(Source|Definitions): USDA NASS Crop Progress/, p.id + " source");
    if (p.id !== "means") assert.ok(p.source.includes("Nov 1, 2026"), p.id + " names the week");  // pin-ok: the frozen fixtures in test/fixtures/infographic, not live data
  }
  const rows = Object.entries(cp.states).filter(([, v]) => v.corn_harvested && v.corn_harvested.avg5_by === "NASS" && v.corn_harvested.date === wk)
    .map(([k, v]) => ({ k, gap: v.corn_harvested.pct - v.corn_harvested.avg5, pct: v.corn_harvested.pct, avg: v.corn_harvested.avg5, prev: v.corn_harvested.prev_week }));
  const far = [...rows].sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap) || STNAME(a.k).localeCompare(STNAME(b.k)))[0];
  assert.deepEqual(s.poster.headline, { lead: "Iowa corn is ", em: `${-far.gap} points`, tail: " behind pace" });
  assert.deepEqual([P.hook.big.value, P.hook.big.vs], [far.pct, far.avg]);
  assert.equal(P.hook.note.value, `+${far.pct - far.prev} pts`);
  assert.deepEqual(P.hook.note.label, ["harvested in one week", `(${far.prev}% to ${far.pct}%)`]);
  const nat = cp.progress.corn_harvested, soy = cp.progress.soybeans_harvested;
  const words = (g) => g === 0 ? "even with average" : `${Math.abs(g)} pt${Math.abs(g) === 1 ? "" : "s"} ${g < 0 ? "behind" : "ahead"}`;
  assert.equal(s.poster.lede.map((x) => x.s).join(""), `Of the ${rows.length} states with a NASS average, Iowa has the widest corn gap. Nationally, corn is ${words(nat.pct - nat.avg5)} average and soybeans are ${words(soy.pct - soy.avg5)}.`);
  // the map: every state with a NASS average, its own gap
  assert.equal(P.map.tiles.length, rows.length);
  for (const t of P.map.tiles) assert.equal(t.gap, rows.find((r) => r.k === t.key).gap, t.key);
  for (const r of rows) assert.equal(P.map.bins.filter((b) => (b.lo == null || r.gap >= b.lo) && (b.hi == null || r.gap <= b.hi)).length, 1, "one bin for " + r.k);
  // behind, even, ahead
  const nb = rows.filter((r) => r.gap < 0).length, ne = rows.filter((r) => r.gap === 0).length, na = rows.filter((r) => r.gap > 0).length;
  assert.deepEqual([P.count.behind, P.count.even, P.count.ahead, P.count.n], [nb, ne, na, rows.length]);
  assert.equal(P.count.big, `${nb} of ${rows.length}`);
  assert.equal(P.count.sub, `${na} ahead, ${ne} even (Colorado)`);
  assert.deepEqual(P.count.icons.map((i) => i.side), P.map.tiles.map((t) => Math.sign(t.gap)));
  // the U.S. rings
  for (const [i, x] of [nat, soy].entries()) {
    const c = P.crops.crops[i];
    assert.deepEqual([c.pct, c.avg5, c.gap, c.week_gain], [x.pct, x.avg5, x.pct - x.avg5, x.pct - x.prev_week]);
    assert.equal(c.words, words(x.pct - x.avg5));
  }
  // the lists: the five furthest each way, every row tied at the fifth place kept, the tie said in words
  for (const [ci, sign] of [[0, -1], [1, 1]]) {
    const side = rows.filter((r) => r.gap * sign > 0).sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap) || STNAME(a.k).localeCompare(STNAME(b.k)));
    const cut = side[4].gap, want = side.filter((r) => Math.abs(r.gap) >= Math.abs(cut));
    const col = P.lists.cols[ci];
    assert.deepEqual(col.rows.map((r) => [r.key, r.gap, r.pct, r.avg]), want.map((r) => [r.k, r.gap, r.pct, r.avg]), "list " + ci);
  }
  assert.equal(P.lists.cols[0].rows.length, 5);
  assert.equal(P.lists.cols[1].rows.length, 6, "Indiana and Wisconsin both shown at the fifth place");
  assert.equal(P.lists.cols[1].tie, "Indiana and Wisconsin tie at +4.");
  assert.equal(P.lists.cols[0].tie, "");
  assert.equal(P.lists.scale, Math.max(...rows.map((r) => Math.abs(r.gap))));
  assert.ok(P.means.yes[0].includes("2021-2025") && s.poster.data_line.includes("(2021-2025)"), "the five years before the crop year");
  assert.doesNotMatch(JSON.stringify(s.poster), DASH);
});

test("poster lists: a tie that would run past 8 rows is named in a line, not drawn", () => {
  const r = py("-c", "import sys, json; sys.path.insert(0, 'scripts'); import build_infographic as B\n"
    + "rows = [{'key': k, 'label': k, 'gap': g, 'values': [0, 0]} for k, g in [('A', 9), ('B', 8), ('C', 7), ('D', 6)] + [('T%d' % i, 2) for i in range(7)]]\n"
    + "keep, tie = B.top_list(rows, 1); print(json.dumps([[x['key'] for x in keep], tie]))");
  assert.equal(r.status, 0, r.stderr);
  const [keep, tie] = JSON.parse(r.stdout);
  assert.deepEqual(keep, ["A", "B", "C", "D"]);
  assert.equal(tie, "7 states tie at +2: T0, T1, T2, T3, T4, T5 and T6.");
});

test("poster, funds-corn: the net, its path, longs and shorts, each week's move and the record rank recomputed from the COT files", () => {
  const h = fx("cot-history.json").history.corn, an = fx("cot-analysis.json"), c = an.commodities.corn, s = spec("funds-corn", "2026-11-06"), P = posterOf(s);
  assert.deepEqual(s.poster.panels.map((p) => p.id), ["hook", "line", "split", "changes", "rank", "means"]);
  for (const p of s.poster.panels) { assert.equal(p.date, an.report_date, p.id); assert.match(p.source, /^(Source|Definitions): CFTC Commitments of Traders/, p.id); }
  const n = c.card.streak, path_ = h.slice(-1 - n), first = path_[0], last = h[h.length - 1], prev = h[h.length - 2];
  assert.deepEqual(s.poster.headline, { lead: "Funds' corn net is down ", em: `${num(last.net - first.net)} contracts`, tail: ` in ${n} weeks` });
  assert.deepEqual([P.hook.big.value, P.hook.big.vs], [last.net, first.net]);
  assert.equal(P.hook.note.value, "−" + num(last.net - prev.net));
  assert.deepEqual(P.line.points.map((p) => [p.x, p.y]), path_.map((r) => [r.date, r.net]));
  assert.deepEqual(P.split.weeks.map((w) => [w.x, w.long, w.short]), [first, last].map((r) => [r.date, r.long, r.short]));
  assert.deepEqual([P.split.change.long, P.split.change.short], [c.card.how.long_change, c.card.how.short_change]);
  assert.deepEqual(P.changes.rows.map((r) => [r.x, r.chg]), path_.slice(1).map((r, i) => [r.date, r.net - path_[i].net]));
  assert.equal(P.changes.rows.reduce((a, r) => a + r.chg, 0), last.net - first.net, "the moves add up to the headline");
  assert.deepEqual([P.rank.pctl, P.rank.pctl_prev, P.rank.weeks, P.rank.net_oi], [c.pctl.net_oi_all, c.pctl_prev, c.weeks_of_history, c.net_oi]);
  assert.equal(P.rank.pctl, last.rk, "the rank agrees with the history row");
  assert.equal(P.rank.line, `${Math.round(c.pctl.net_oi_all)}% of the ${num(c.weeks_of_history)} weeks since 2010 were at or below this week, as a share of open interest.`);
  assert.doesNotMatch(JSON.stringify(s.poster), /crowd/i, "measured record wording, no crowding call");
  // without the rank in cot-analysis.json the panel is left out; a rank for another week refuses
  const d = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "igrank-"));
  fs.mkdirSync(path.join(d, "data"));
  fs.copyFileSync(path.join(ROOT, FX, "data/cot-history.json"), path.join(d, "data/cot-history.json"));
  const bare = fx("cot-analysis.json"); delete bare.commodities.corn.pctl;
  fs.writeFileSync(path.join(d, "data/cot-analysis.json"), JSON.stringify(bare));
  let r = py("scripts/build_infographic.py", "funds-corn", "2026-11-06", "--root", d, "--print");
  assert.equal(r.status, 0, r.stdout);
  assert.deepEqual(JSON.parse(r.stdout).poster.panels.map((p) => p.id), ["hook", "line", "split", "changes", "means"]);
  const off = fx("cot-analysis.json"); off.commodities.corn.net += 1;
  fs.writeFileSync(path.join(d, "data/cot-analysis.json"), JSON.stringify(off));
  r = py("scripts/build_infographic.py", "funds-corn", "2026-11-06", "--root", d, "--print");
  assert.equal(r.status, 1); assert.match(r.stdout, /disagrees with cot-history/);
  fs.rmSync(d, { recursive: true, force: true });
});

// ------------------------------------------------------------------ 2. the pages
const TMP = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "infog-"));
process.on("exit", () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {} });
fs.mkdirSync(path.join(TMP, "data/infographics"), { recursive: true });
fs.copyFileSync(path.join(ROOT, "cot.html"), path.join(TMP, "cot.html"));
const DATES = { "2026-11-06": "harvest-gap", "2026-10-30": "funds-corn" };
execFileSync("python3", ["scripts/build_infographic.py", "harvest-gap", "2026-11-06", "--root", FX, "--out", path.join(TMP, "data/infographics")], { cwd: ROOT });
// an older funds spec for the "last 4" links: the same week's files cannot make a Nov 6 funds spec dated Oct 30, so
// it is the Nov 6 spec saved under Oct 30's name with its date changed (a layout fixture, not a number check)
const older = spec("funds-corn", "2026-11-06");
older.date = older.slug = "2026-10-30";
older.facts = older.facts.map((f) => ({ ...f, date: "2026-10-27" }));
fs.writeFileSync(path.join(TMP, "data/infographics/2026-10-30.json"), JSON.stringify(older));
execFileSync("python3", ["scripts/build_infographic_pages.py", "--root", TMP, "--out", path.join(TMP, "infographic")], { cwd: ROOT });
const page = (d) => fs.readFileSync(path.join(TMP, "infographic", d + ".html"), "utf8");

test("the infographic page: hook as title and H1, JSON-LD, og:image the card, the facts with sources, related and recent links", () => {
  const s = JSON.parse(fs.readFileSync(path.join(TMP, "data/infographics/2026-11-06.json"), "utf8"));
  const h = page("2026-11-06");
  assert.ok(h.includes(`<title>${s.title} | Friday Chart | AGSIST</title>`), "the hook, then the series name");
  assert.equal((h.match(/<h1[ >]/g) || []).length, 1);
  assert.ok(h.includes(`<h1>${s.title}</h1>`));
  assert.match(h, /<link rel="canonical" href="https:\/\/agsist\.com\/infographic\/2026-11-06">/);  // pin-ok: the frozen fixtures in test/fixtures/infographic, not live data
  const og = h.match(/<meta property="og:image" content="([^"]+)">/)[1];
  assert.match(og, /^https:\/\/agsist\.com\/infographic\/og\/2026-11-06\.jpg\?v=[0-9a-f]{8}$/);  // pin-ok: the frozen fixtures in test/fixtures/infographic, not live data
  assert.ok(fs.statSync(path.join(TMP, "infographic/og/2026-11-06.jpg")).size < 120 * 1024, "the card under 120 KB");  // pin-ok: the frozen fixtures in test/fixtures/infographic, not live data
  const lds = [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const types = lds.map((j) => j["@type"]);
  assert.deepEqual(types, ["ImageObject", "Dataset", "BreadcrumbList"]);
  assert.equal(lds[0].contentUrl, og.split("?")[0]);
  assert.equal(lds[1].distribution[0].contentUrl, "https://agsist.com/data/infographics/2026-11-06.json");  // pin-ok: the frozen fixtures in test/fixtures/infographic, not live data
  for (const f of s.facts) assert.ok(h.includes(f.text.replace(/'/g, "&#x27;")), f.text);
  assert.ok(h.includes("<small>USDA NASS Crop Progress, week ending Nov 1, 2026.</small>"), "each fact's source and date");  // pin-ok: the frozen fixtures in test/fixtures/infographic, not live data
  assert.match(h, /<img class="ig-img" src="\/infographic\/og\/2026-11-06\.jpg\?v=[0-9a-f]{8}" width="1200" height="630"/);  // pin-ok: the frozen fixtures in test/fixtures/infographic, not live data
  assert.match(h, /<details><summary>Sources<\/summary>/, "sources collapsed by default");
  assert.ok(!/<a [^>]*href="https?:\/\/(www\.)?(nass|cftc)/.test(h), "sources in plain text, no link to a data source");
  assert.ok(h.includes('href="/conditions"'), "the related page");
  assert.ok(h.includes('href="/infographic/2026-10-30"') && h.includes('href="/infographic/"'), "the recent ones and the archive");  // pin-ok: the frozen fixtures in test/fixtures/infographic, not live data
  const inl = JSON.parse(h.match(/<script type="application\/json" id="ig-spec">([\s\S]*?)<\/script>/)[1]);
  assert.deepEqual(inl, s, "the page carries the spec as it is");
  assert.match(h, /<script src="\/components\/share-kit\.js\?v=\d+" defer><\/script>\s*<script src="\/components\/qr\.js\?v=\d+" defer><\/script>\s*<script src="\/components\/infographic\.js\?v=2" defer><\/script>/);
  assert.match(h, /<div class="ig-tools" id="ig-tools" hidden>/, "the buttons hidden until the kit is there");
  const v = (n) => (read("cot.html").match(new RegExp(`/components/${n.replace(".", "\\.")}\\?v=(\\w+)`)) || [])[1];
  for (const n of ["styles.css", "share-kit.js", "qr.js", "loader.js"]) assert.ok(h.includes(`/components/${n}?v=${v(n)}`), n + " at the version cot.html loads");
  for (const d of Object.keys(DATES)) {
    const p = page(d);
    assert.doesNotMatch(p, DASH, d);
    assert.ok(Buffer.byteLength(p) < 150 * 1024, d + " under the 150 KB page budget");
    assert.doesNotMatch(p.match(/<main[\s\S]*?<\/main>/)[0], /\b(should|recommend|forecast|will rise|will fall)\b/i, "no advice or forecast");
  }
});

test("the archive: newest first, indexable once there is one; empty, it says so and is noindex", () => {
  const a = fs.readFileSync(path.join(TMP, "infographic/index.html"), "utf8");
  const order = [...a.matchAll(/<li><a href="\/infographic\/(\d{4}-\d{2}-\d{2})">/g)].map((m) => m[1]);
  assert.deepEqual(order, ["2026-11-06", "2026-10-30"]);  // pin-ok: the frozen fixtures in test/fixtures/infographic, not live data
  assert.match(a, /<meta name="robots" content="index,follow">/);
  assert.equal(fs.readFileSync(path.join(TMP, "infographic/_indexable.txt"), "utf8"), "/infographic/2026-11-06\n/infographic/2026-10-30\n/infographic/\n");  // pin-ok: the frozen fixtures in test/fixtures/infographic, not live data
  const e = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "infog0-"));
  execFileSync("python3", ["scripts/build_infographic_pages.py", "--root", e, "--out", path.join(e, "infographic"), "--no-images"], { cwd: ROOT });
  const z = fs.readFileSync(path.join(e, "infographic/index.html"), "utf8");
  assert.match(z, /No Friday Chart is posted yet\./);
  assert.match(z, /<meta name="robots" content="noindex,follow">/);
  fs.rmSync(e, { recursive: true, force: true });
});

test("a generated set: built on main by infographic-pages.yml, the stylesheet written by hand, no Daily or homepage wiring yet", () => {
  const r = py("-c", "import sys; sys.path.insert(0, 'scripts'); import generated_sets as G, json; print(json.dumps([G.owner(p) for p in "
    + "['infographic/2026-11-06.html', 'infographic/index.html', 'infographic/og/2026-11-06.jpg', 'infographic/infographic.css', 'data/infographics/2026-11-06.json']]))");
  assert.deepEqual(JSON.parse(r.stdout), ["infographic", "infographic", "infographic", null, null]);
  const wf = read(".github/workflows/infographic-pages.yml");
  assert.doesNotMatch(wf, /\n  schedule:/, "no schedule");
  assert.match(wf, /data\/infographics\/\*\*/, "a new spec on main rebuilds the pages");
  assert.ok(!fs.existsSync(path.join(ROOT, "data/infographics/latest.json")), "the weekend Daily slot reads latest.json: not written yet");
  assert.doesNotMatch(read("scripts/build_infographic.py") + read("scripts/build_infographic_pages.py"), /latest\.json/);
  assert.doesNotMatch(read("index.html"), /\/infographic\//, "not on the homepage yet");
  for (const f of ["components/infographic.js", "infographic/infographic.css", "scripts/build_infographic.py", "scripts/build_infographic_pages.py"]) assert.doesNotMatch(read(f), DASH, f);
});

// ------------------------------------------------------------------ 3. in a browser
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (fs.existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !fs.existsSync(CHROME) ? "Playwright or Chromium not found here" : false;
function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".woff2": "font/woff2" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (!path.extname(p)) p += ".html";
    const own = /^\/infographic\/(\d{4}-\d{2}-\d{2}\.html|og\/.*|index\.html)$/.test(p) ? TMP : ROOT;
    const f = path.normalize(path.join(own, p));
    if (!f.startsWith(own) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" });
    res.end(fs.readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}
const pages = (buf) => (buf.toString("latin1").match(/\/Type\s*\/Page(?![a-z])/g) || []).length;
async function open(browser, port, url, block) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1200, height: 900 } });
  const pg = await ctx.newPage();
  const errors = [];
  pg.on("pageerror", (e) => errors.push(String(e)));
  await pg.route("**/*", (r) => {
    const u = new URL(r.request().url());
    if (u.origin !== `http://127.0.0.1:${port}`) return r.abort();
    if (block && block.test(u.pathname)) return r.abort();
    return r.continue();
  });
  await pg.goto(`http://127.0.0.1:${port}${url}`, { waitUntil: "load" });
  return { ctx, pg, errors };
}

test("in a browser: the phone and link pictures from the spec, the print sheet on 1 page (Letter and A4)", { skip, timeout: 180000 }, async () => {
  const srv = await serve(), port = srv.address().port, OUTD = process.env.INFOG_OUT;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const d of Object.keys(DATES)) {
      const { ctx, pg, errors } = await open(browser, port, "/infographic/" + d);
      await pg.waitForFunction(() => window.AgInfographic && !document.getElementById("ig-tools").hidden);
      const s = JSON.parse(fs.readFileSync(path.join(TMP, "data/infographics", d + ".json"), "utf8"));
      for (const shape of ["phone", "link"]) {
        const r = await pg.evaluate(async (shape) => {
          await document.fonts.ready;
          const spec = JSON.parse(document.getElementById("ig-spec").textContent);
          const m = shape === "phone" ? window.AgQR.matrix(window.AgInfographic.tagged(spec, "share", "qr"), null, null, 10) : null;
          const im = window.AgInfographic.picture(spec, document, shape, { qr: m });
          return { w: im.canvas.width, h: im.canvas.height, texts: im.texts, sizes: im.sizes, ys: im.ys, png: im.canvas.toDataURL("image/png") };
        }, shape);
        assert.deepEqual([r.w, r.h], shape === "phone" ? [1080, 1350] : [1200, 630], d + " " + shape);
        const all = r.texts.join(" ");
        assert.ok(all.includes(s.title.split(" ").slice(0, 3).join(" ")), d + " " + shape + ": the hook");
        assert.ok(r.texts.some((t) => t === s.big.value.toLocaleString("en-US") || t === s.big.value + "%"), d + " " + shape + ": the big number " + r.texts.join(" | "));
        assert.ok(all.includes(s.sources[0].name), "the source on the picture");
        assert.ok(Math.min(...r.sizes) >= 16, "no word under 16 px");
        if (shape === "phone" && s.chart.type === "line") {
          const lab = r.texts.lastIndexOf(s.chart.points[s.chart.points.length - 1].label), fact = r.texts.findIndex((t) => t.startsWith(s.facts[0].text.split(" ").slice(0, 3).join(" ")));
          assert.ok(r.ys[fact] - r.ys[lab] >= 60, d + ": room between the date labels and the first fact (" + (r.ys[fact] - r.ys[lab]) + " px)");
        }
        if (shape === "phone") for (const f of s.facts) assert.ok(all.includes(f.text.split(" ").slice(0, 3).join(" ")), "fact on the phone picture: " + f.text);
        assert.doesNotMatch(all, DASH);
        if (OUTD) fs.writeFileSync(path.join(OUTD, `${d}-${shape}.png`), Buffer.from(r.png.split(",")[1], "base64"));
      }
      await pg.evaluate(() => { window.print = () => {}; });
      await pg.click("#ig-print");
      assert.ok(await pg.evaluate(() => document.documentElement.classList.contains("igs-on")), "Print sets the sheet on");
      const sh = await pg.evaluate(() => ({ fit: document.getElementById("igs").dataset.fit, qr: !!document.querySelector("#igs .igs-qr svg"),
        text: document.getElementById("igs").textContent }));
      assert.equal(sh.fit, "1", d + ": the sheet fits without scaling");
      assert.ok(sh.qr, "a QR code on the sheet");
      for (const f of s.facts) assert.ok(sh.text.includes(f.text), "fact on the sheet");
      assert.doesNotMatch(sh.text, DASH);
      for (const format of ["Letter", "A4"]) {
        await pg.evaluate(() => document.documentElement.classList.add("igs-on", "sk-on"));
        const buf = await pg.pdf({ format });
        assert.equal(pages(buf), 1, d + " " + format + ": exactly 1 page");
        if (OUTD && format === "Letter") fs.writeFileSync(path.join(OUTD, d + "-sheet.pdf"), buf);
      }
      assert.deepEqual(errors, []);
      await ctx.close();
    }
    // fails soft: no share kit, the page is whole and the buttons stay hidden
    const { ctx, pg, errors } = await open(browser, port, "/infographic/2026-11-06", /share-kit\.js$/);
    await pg.waitForTimeout(300);
    assert.equal(await pg.$eval("#ig-tools", (e) => e.hidden), true);
    assert.ok((await pg.$eval("main", (e) => e.textContent)).includes("Iowa corn harvest 13 points behind"));
    assert.deepEqual(errors, []);
    await ctx.close();
  } finally { await browser.close(); srv.close(); }
});

test("in a browser: the Friday Chart poster, dark 1080 x 2400 and paper for print, fits; the paper poster prints on one 11 x 17 page", { skip, timeout: 240000 }, async () => {
  const srv = await serve(), port = srv.address().port, OUTD = process.env.INFOG_OUT;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const d of Object.keys(DATES)) {
      const { ctx, pg, errors } = await open(browser, port, "/infographic/" + d);
      await pg.waitForFunction(() => window.AgInfographic && !document.getElementById("ig-tools").hidden);
      const s = JSON.parse(fs.readFileSync(path.join(TMP, "data/infographics", d + ".json"), "utf8")), P = posterOf(s);
      for (const id of ["ig-poster", "ig-poster-17", "ig-poster-letter"]) assert.equal(await pg.$eval("#" + id, (e) => e.hidden), false, id + " shown");
      for (const [theme, layout] of [["dark", "phone"], ["paper", "print"], ["paper", "phone"], ["dark", "print"]]) {
        const r = await pg.evaluate(async ([theme, layout]) => {
          const A = window.AgInfographic, spec = JSON.parse(document.getElementById("ig-spec").textContent);
          await A.posterFonts(document, theme);
          const c = A.posterCanvas(spec, document, { theme, layout, qr: window.AgQR.matrix(A.tagged(spec, "share", "qr"), null, null, 10) }), L = c.layout;
          return { w: c.canvas.width, h: c.canvas.height, bottom: L.bottom, fits: L.fits, boxes: L.boxes, texts: L.texts, qr: L.ops.some((q) => q.t === "qr"),
            png: theme === "dark" && layout === "phone" ? c.canvas.toDataURL("image/png") : null };
        }, [theme, layout]);
        const tag = `${d} ${theme} ${layout}`;
        if (layout === "phone") assert.deepEqual([r.w, r.h], [1080, 2400], tag);
        else assert.equal(r.w, 1320, tag);
        assert.ok(r.fits && r.bottom <= r.h - 20, `${tag}: content ends at ${Math.round(r.bottom)} of ${r.h}`);
        assert.ok(r.qr, tag + ": a QR code");
        const issues = [];
        for (const t of r.texts) {
          const b = r.boxes[t.box];
          if (!b) { issues.push("no panel: " + t.s); continue; }
          if (t.x0 < b.x - 1 || t.x1 > b.x + b.w + 1 || t.top < b.y - 1 || t.bot > b.y + b.h + 1) issues.push(`outside ${b.id}: ${t.s}`);
        }
        for (let i = 0; i < r.texts.length; i++) for (let k = i + 1; k < r.texts.length; k++) {
          const a = r.texts[i], b = r.texts[k];
          if (a.x0 < b.x1 - 1 && b.x0 < a.x1 - 1 && a.top < b.bot - 1 && b.top < a.bot - 1) issues.push(`overlap: ${a.s} / ${b.s}`);
        }
        for (let i = 0; i < r.boxes.length; i++) for (let k = i + 1; k < r.boxes.length; k++) {
          const a = r.boxes[i], b = r.boxes[k];
          if (a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1) issues.push(`panels overlap: ${a.id} / ${b.id}`);
          }
        assert.deepEqual(issues, [], tag);
        assert.ok(Math.min(...r.texts.map((t) => t.size)) >= 13, tag + ": no word under 13 px");
        const all = r.texts.map((t) => t.s).join(" ");
        assert.doesNotMatch(all, DASH, tag);
        assert.ok(all.includes("FRIDAY CHART") && all.includes("INFOGRAPHIC OF THE WEEK"), tag + ": the name and the subtitle");
        assert.ok(all.includes(s.poster.headline.em.split(" ")[0]), tag + ": the headline number");
        for (const p of s.poster.panels) for (const w of p.source.split(" ").slice(0, 4)) assert.ok(all.includes(w), `${tag}: the ${p.id} source`);
        if (s.kind === "harvest-gap") {
          for (const x of [P.count.big, P.hook.note.value, P.lists.cols[1].tie, P.crops.crops[0].pct + "%", P.crops.crops[1].words]) assert.ok(all.includes(x), `${tag}: ${x}`);
          for (const t of P.map.tiles) assert.ok(r.texts.some((q) => q.s === t.key), tag + " tile " + t.key);
          assert.equal(r.boxes.map((b) => b.id).join(","), layout === "phone" ? "head,map,count,crops,lists,means,foot" : "head,map,count,crops,lists,means,foot");
        } else {
          for (const x of P.changes.rows.map((q) => (q.chg < 0 ? "−" : "+") + Math.abs(q.chg).toLocaleString("en-US")).concat([P.rank.line.split(" ").slice(0, 4).join(" ")])) assert.ok(all.includes(x.split(" ")[0]), `${tag}: ${x}`);
        }
        if (OUTD && r.png) fs.writeFileSync(path.join(OUTD, `${d}-poster-dark-phone.png`), Buffer.from(r.png.split(",")[1], "base64"));
      }
      // the paper poster on paper: one page, 11 x 17 (792 x 1224 pt) or Letter (612 x 792 pt)
      for (const [size, box] of [["17", "0 0 792 1224"], ["letter", "0 0 612 792"]]) {
        await pg.evaluate(async (size) => { await window.AgInfographic.buildPoster(size); document.documentElement.classList.add("sk-on", "igp-on"); }, size);
        const sh = await pg.evaluate(() => ({ cls: document.getElementById("igp").className, svg: !!document.querySelector("#igp svg.igp-svg"), fits: window.AgInfographic.lastPoster.fits,
          igs: !!document.getElementById("igs") && getComputedStyle(document.getElementById("igs")).display }));
        assert.ok(sh.svg && sh.fits, d + " " + size + ": the poster sheet");
        assert.match(sh.cls, size === "17" ? /\bigp-17\b/ : /\bigp-letter\b/);
        const buf = await pg.pdf({ preferCSSPageSize: true, printBackground: true });
        assert.equal(pages(buf), 1, d + " " + size + ": exactly 1 page");
        assert.equal((buf.toString("latin1").match(/\/MediaBox\s*\[([^\]]+)\]/) || [])[1].trim().split(/\s+/).map(Number).join(" "), box, d + " " + size + ": the page size");
        if (OUTD) fs.writeFileSync(path.join(OUTD, `${d}-poster-paper-${size === "17" ? "11x17" : "letter"}.pdf`), buf);
        await pg.evaluate(() => document.documentElement.classList.remove("sk-on", "igp-on"));
      }
      // the one-page sheet still prints on its own (the poster hides on any other print)
      await pg.evaluate(() => { window.print = () => {}; });
      await pg.click("#ig-print");
      const one = await pg.pdf({ format: "Letter" });
      assert.equal(pages(one), 1, d + ": the one-page sheet after the poster");
      assert.ok(!(one.toString("latin1").includes("792 1224")), "not on the poster's 11 x 17 page");
      // the Save button draws the dark poster
      await pg.evaluate(() => { window.__dl = []; HTMLAnchorElement.prototype.click = function () { window.__dl.push(this.download); }; });
      await pg.click("#ig-poster");
      await pg.waitForFunction(() => window.__dl.length > 0);
      assert.deepEqual(await pg.evaluate(() => [window.__dl[0], window.AgInfographic.lastPoster.w, window.AgInfographic.lastPoster.h, window.AgInfographic.lastPoster.fits]), [`agsist-friday-chart-${d}.png`, 1080, 2400, true]);
      assert.deepEqual(errors, []);
      await ctx.close();
    }
    // fails soft: no share kit, no poster buttons and no errors
    const { ctx, pg, errors } = await open(browser, port, "/infographic/2026-11-06", /share-kit\.js$/);
    await pg.waitForTimeout(300);
    assert.equal(await pg.$eval("#ig-tools", (e) => e.hidden), true, "the tools, poster buttons with them, stay hidden");
    assert.equal(await pg.evaluate(() => !!document.getElementById("igp")), false);
    assert.deepEqual(errors, []);
    await ctx.close();
  } finally { await browser.close(); srv.close(); }
});
