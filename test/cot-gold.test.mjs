/* /cot gold standard, build 1 (Nov 6 2026, Sig: "get the cot page done now"; "make sure on the cot page that there is
 * a clear indicator or countdown until the release that you can't miss").
 *   1. One rank engine: every cot-history.json row carries oi and rk (share of open interest, ranked since the record's
 *      first week against that week and the weeks before it only, at or below), the latest rk is the headline rank
 *      exactly, Compare plots rk, and the browser ranks nothing. The page prints two ranks only: share of open
 *      interest since 2010, and the map's contracts over the last 3 years, each in words, never an ordinal.
 *   2. The release bar at the very top and the answer line under the chart title, both on the first screen at 390 px,
 *      both baked for scripts off; one countdown, not a live region; holiday-aware wording.
 *   3. A record is said with its measure and start year.
 *   4. Save image is 1080x1350 on a phone, headline 56 px or more, every other word 26 px or more.
 *   5. The analysis file's public keys are plain: passes and survivors.
 * The data checks are rules every report keeps (no dates or live values pinned); the wording checks use the frozen
 * Oct 27 fixtures.
 *
 *   node --test test/cot-gold.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const json = (p) => JSON.parse(read(p));
const G = require(path.join(ROOT, "components/cot-glance.js"));
const C = require(path.join(ROOT, "components/cot-chart.js"));
const HTML = read("cot.html");
const FX = { cot: json("test/fixtures/funds/cot-2026-10-27.json"), cx: json("test/fixtures/funds/cot-analysis-2026-10-27.json"),
  hist: json("test/fixtures/funds/cot-history-2026-10-27.json") };
const LIVE = { cot: json("data/cot.json"), cx: json("data/cot-analysis.json"), hist: json("data/cot-history.json") };
const DASH = /[–—]|&mdash;|&ndash;/;
const ORDINAL_RANK = /\b\d{1,3}(st|nd|rd|th) (percentile|since|of (the|every|its))\b/i;
const py = (code) => spawnSync("python3", ["-c", code], { cwd: ROOT, encoding: "utf8", timeout: 120000 });

// ------------------------------------------------------------------ 1. one rank engine
test("every history row carries oi and rk; the latest rk is the headline rank exactly (live data and the fixture)", () => {
  for (const [name, D] of [["live", LIVE], ["fixture", FX]]) {
    for (const [k, rows] of Object.entries(D.hist.history)) {
      const c = D.cx.commodities[k];
      if (!c) continue;
      const last = rows[rows.length - 1];
      if (last.date !== c.date) continue;          // the files can be a week apart while a release lands
      assert.equal(last.rk, c.pctl.net_oi_all, `${name} ${k}: latest rk ${last.rk} = headline ${c.pctl.net_oi_all}`);
      for (const r of rows) {
        if (r.rk === undefined) continue;
        assert.ok(r.rk > 0 && r.rk <= 100, `${name} ${k} ${r.date}: at or below, so never 0 (${r.rk})`);
        assert.ok(Number.isInteger(r.oi) && r.oi > 0, `${name} ${k} ${r.date}: open interest`);
      }
      assert.ok(rows.filter((r) => typeof r.rk === "number").length >= rows.length - 1, `${name} ${k}: rk on the rows`);
    }
  }
});

test("rk uses only that week and earlier weeks (the pipeline's own check), and fetch_cot.py writes oi per week", () => {
  const r = spawnSync("python3", ["scripts/cot_analysis.py", "--selftest"], { cwd: ROOT, encoding: "utf8", timeout: 120000 });
  assert.equal(r.status, 0, r.stdout.slice(-2000) + r.stderr);
  assert.match(r.stdout, /PASS\s+rk: each week ranked against itself and the weeks before it only, at or below/);
  assert.match(read("scripts/fetch_cot.py"), /"short": r\["short"\], "oi": r\.get\("oi"\)\}/);
  assert.match(read("scripts/cot_analysis.py"), /r\["rk"\] = percentile_rank\(net_oi\[:i \+ 1\], net_oi\[i\]\)/);
});

test("Compare plots rk with its plain label; no ranking code in the browser", () => {
  const m = C.cmpModel(["corn", "leanhogs"], FX.hist, FX.cot, FX.cx);
  assert.match(m.headline, /: share of open interest, rank since 2010$/);
  for (const s of m.series) assert.equal(s.vals[s.vals.length - 1], FX.cx.commodities[s.key].pctl.net_oi_all);
  for (const f of ["components/cot-chart.js", "components/cot-page.js", "components/cot-glance.js"]) {
    assert.doesNotMatch(read(f), /rankPct|function percentile|\.sort\([^)]*\)\.indexOf/, f + ": no browser-side ranking");
  }
});

// ------------------------------------------------------------------ 2. the words: two ranks, no ordinals
test("rank words: long, short and the table cell; never an ordinal", () => {
  assert.equal(G.facts("corn", FX.cot, FX.cx).words, "higher than 48% of weeks since 2010");
  assert.equal(G.facts("wheat", FX.cot, FX.cx).words, "a bigger net short than 67% of weeks since 2010");
  assert.equal(G.row("corn", FX.cot, FX.cx).rank, "above 48%");
  assert.equal(G.row("wheat", FX.cot, FX.cx).rank, "below 67%");
  for (const k of G.ORDER) {
    const c = FX.cx.commodities[k];
    const n = c.net < 0 ? 100 - c.crowd.shown : c.crowd.shown;
    assert.ok(c.crowd.words.includes(n + "% of weeks since " + c.crowd.since), k + ": " + c.crowd.words);
    assert.equal("pct52_contracts" in c.crowd, false, k + ": the third rank's data path is gone");
  }
  for (const s of [JSON.stringify(LIVE.cx.grain_lines), JSON.stringify(LIVE.cx.read), ...Object.values(LIVE.cx.commodities).map((c) => c.read)]) {
    assert.doesNotMatch(s, ORDINAL_RANK, "pipeline text: " + s);
  }
});

test("the answer line: direction, size, rank in words, the Tuesday, the next report; the bake says the same", () => {
  const before = G.etInstant(FX.cot.next_release, "12:00") - 4 * 86400000;      // a few days before the release
  const a = G.answer("corn", FX.cot, FX.cx, before);
  // kit v2: the headline (brief) says what changed and where funds stand; the answer line says when, with the year, and the rank
  assert.equal(a.did, "Week to Tue, Oct 27, 2026. Released Fri, Oct 30, 2026. Rank: higher than 48% of weeks since 2010 (share of open interest)."); // pin-ok: the Oct 27 fixture (test/fixtures/funds), not live data
  assert.equal(G.brief("corn", FX.cot, FX.cx).text, "Corn funds cut their net long by 83,310 contracts. Still net long: 81,113."); // pin-ok: the Oct 27 fixture
  assert.equal(a.next, "Next report: Friday Nov 6, 3:30 PM ET."); // pin-ok: the Oct 27 fixture (test/fixtures/funds), not live data
  assert.equal(G.answer("corn", FX.cot, FX.cx, G.etInstant(FX.cot.next_release, "09:00")).next, "Next report: today 3:30 PM ET.");
  assert.ok(!DASH.test(a.text) && !/bootstrap|draws|FDR|false discovery|Benjamini/i.test(a.text));
  // the bake (scripts off) is the same sentence, without "today"
  const r = py(`import sys, json; sys.path.insert(0, "scripts"); import prerender_wpi_scorecard as p
d = json.load(open("test/fixtures/funds/cot-2026-10-27.json")); cx = json.load(open("test/fixtures/funds/cot-analysis-2026-10-27.json"))
print(p.cot_answer(d, cx)); print(p.cot_release_html(d)); print(p.cot_answer(d, cx, "leanhogs")); print(p.cot_head(d, cx)); print(p.cot_head(d, cx, "wheat"))`);
  assert.equal(r.status, 0, r.stderr);
  const [baked, bar, hogs, head, wheat] = r.stdout.trim().split("\n");
  assert.equal(head, G.brief("corn", FX.cot, FX.cx).html, "the baked headline is the live one");
  assert.equal(wheat, G.brief("wheat", FX.cot, FX.cx).html);
  assert.equal(baked, a.text);
  assert.equal(bar, "Next report: Friday Nov 6, 3:30 PM ET"); // pin-ok: the Oct 27 fixture (test/fixtures/funds), not live data
  assert.equal(hogs, G.answer("leanhogs", FX.cot, FX.cx, before).text);
});

test("record wording names the measure and the start year (lean hogs, Oct 27: largest net short in contracts since 2010)", () => {
  const hogs = FX.cx.commodities.leanhogs;
  assert.deepEqual(hogs.record_contracts, { side: "short", since: "2010", weeks: hogs.weeks_of_history });
  assert.match(G.answer("leanhogs", FX.cot, FX.cx).did, /Largest net short in contracts since 2010\. Rank: a bigger net short than 99% of weeks since 2010 \(share of open interest\)\.$/);
  assert.equal(G.brief("leanhogs", FX.cot, FX.cx).record, "Largest net short in contracts since 2010");
  assert.equal(G.brief("corn", FX.cot, FX.cx).record, "", "no record, no badge");
  // the rule on live data: a contracts record is claimed exactly when this week's net is the record's extreme
  for (const [k, c] of Object.entries(LIVE.cx.commodities)) {
    if (c.record_contracts) assert.equal(c.net, c.record_contracts.side === "short" ? c.rank.record_low.net : c.rank.record_high.net, k);
    if (c.crowd.record) assert.match(c.crowd.record, /^the largest net (long|short) (in contracts|as a share of open interest) since \d{4}$/, k);
  }
  for (const f of ["components/cot-market.js", "components/cot-glance.js", "components/cot-page.js"]) {
    assert.doesNotMatch(read(f).replace(/\/\*[\s\S]*?\*\//g, ""), /'record (long|short)'/, f + ": no bare 'record'");
  }
});

test("the release bar: countdown, out and updating, late, updated today, and a holiday Monday said plainly", () => {
  const due = G.etInstant(FX.cot.next_release, "15:30");
  const at = (min) => G.release(FX.cot, FX.cx, due + min * 60000);
  assert.deepEqual([at(-134).state, at(-134).text], ["countdown", "New report in 2 h 14 m · today 3:30 PM ET"]);
  assert.equal(at(-3 * 1440).text, "New report in 3 d 0 h · Friday 3:30 PM ET");
  assert.deepEqual([at(1).state, at(1).text], ["due", "New report out at 3:30 PM ET, updating"]);
  assert.deepEqual([at(200).state, at(200).text], ["late", "The report due Friday Nov 6, 3:30 PM ET is late. Still checking."]); // pin-ok: the Oct 27 fixture (test/fixtures/funds), not live data
  // the loaded report came out today: "Updated today" until midnight ET, then the countdown
  const rel = G.etInstant(FX.cx.release_date, "15:30");
  assert.deepEqual([G.release(FX.cot, FX.cx, rel + 3600000).state, G.release(FX.cot, FX.cx, rel + 3600000).text], ["updated", "Updated today with the report of Tuesday, Oct 27"]); // pin-ok: the Oct 27 fixture (test/fixtures/funds), not live data
  assert.equal(G.release(FX.cot, FX.cx, rel + 12 * 3600000).state, "countdown");
  // a holiday week (cot_calendar.release_date moves it to the Monday)
  const hol = { ...FX.cot, next_release: "2026-11-30" }; // pin-ok: a made-up holiday Monday, not live data
  const h = G.release(hol, FX.cx, G.etInstant("2026-11-25", "12:00")); // pin-ok
  assert.equal(h.text, "New report in 5 d 3 h · Monday 3:30 PM ET (holiday week)");
  assert.equal(h.inbox, "Get it in your inbox Monday");
  assert.equal(G.release({ ...FX.cot, next_release: "" }, null, Date.now()).state, "none");
});

test("cot.html: the bar is the first thing in main, above the chart, with the next release date baked; one countdown", () => {
  const main = HTML.indexOf('<main id="main"'), bar = HTML.indexOf('id="cot-rel"'), chart = HTML.indexOf('id="cot-chart-box"'), hero = HTML.indexOf('class="cot-hero"');
  assert.ok(main > 0 && main < bar && bar < hero && hero < chart, "bar first in main, above the hero and the chart");
  const nr = LIVE.cot.next_release, d = new Date(nr + "T12:00:00");
  const words = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][d.getDay()] + " "
    + ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()] + " " + d.getDate() + ", 3:30 PM ET";
  assert.ok(HTML.includes("<!-- PRERENDER:cot-release -->Next report: " + words), "the baked bar names " + words);
  assert.ok(HTML.includes("Next report: " + words), "the baked answer line names it too");
  assert.doesNotMatch(HTML, /id="cot-countdown"/, "the old countdown in the fold is gone");
  assert.match(HTML, /<a class="cot-rel-a" id="cot-rel-a" href="#cot-signup">Get it in your inbox/);
  assert.match(HTML, /<div data-signup-ask="[^"]*" data-topic="cot"[^>]* id="cot-signup"><\/div>/);
  assert.match(HTML, /\.cot-rel-a\{[^}]*min-height:44px/);
  assert.match(HTML, /<span class="sr-only" id="cot-rel-live" aria-live="polite"><\/span>/);
  assert.doesNotMatch(HTML.match(/<span class="cot-rel-t"[^>]*>/)[0], /aria-live|role=/);
  const r = spawnSync("python3", ["scripts/check_cot_baked.py"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test("the analysis file's public keys are plain (passes, survivors) and every reader uses them", () => {
  for (const f of ["data/cot-analysis.json", "test/fixtures/funds/cot-analysis-2026-10-27.json", "components/cot-market.js", "components/cot-analysis.js", "scripts/cot_analysis.py"]) {
    assert.doesNotMatch(read(f), /fdr_pass|fdr_survivors/, f);
  }
  assert.equal(typeof LIVE.cx.family.survivors, "number");
  const st = Object.values(LIVE.cx.commodities).flatMap((c) => Object.values(c.studies || {}).flatMap((g) => Object.values(g)));
  assert.ok(st.length && st.every((t) => typeof t.passes === "boolean"));
});

// ------------------------------------------------------------------ in a browser
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (fs.existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !fs.existsSync(CHROME) ? "Playwright or Chromium not found here" : false;
const OWN = { "/data/cot.json": read("test/fixtures/funds/cot-2026-10-27.json"), "/data/cot-analysis.json": read("test/fixtures/funds/cot-analysis-2026-10-27.json"),
  "/data/cot-history.json": read("test/fixtures/funds/cot-history-2026-10-27.json") };

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (!path.extname(p)) p += ".html";
    const f = path.normalize(path.join(ROOT, p));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" });
    res.end(fs.readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}
async function open(browser, port, url, o = {}) {
  const ctx = await browser.newContext({ serviceWorkers: "block", acceptDownloads: true, javaScriptEnabled: o.js !== false, viewport: { width: o.width || 390, height: o.width > 900 ? 900 : 844 } });
  const pg = await ctx.newPage();
  await pg.route("**/*", (r) => {
    const u = new URL(r.request().url());
    if (u.origin !== `http://127.0.0.1:${port}`) return r.abort();
    if (OWN[u.pathname]) return r.fulfill({ status: 200, contentType: "application/json", body: OWN[u.pathname] });
    return r.continue();
  });
  const t0 = new Date(o.now || G.etInstant(FX.cot.next_release, "15:30") - 134.5 * 60000);
  if (o.js !== false) { if (o.fixed) await pg.clock.setFixedTime(t0); else await pg.clock.install({ time: t0 }); }
  await pg.goto(`http://127.0.0.1:${port}${url}`, { waitUntil: "load" });
  if (o.js !== false) await pg.waitForFunction(() => { const b = document.getElementById("cot-chart-box"); return b && b.dataset.latest && /funds/i.test(document.getElementById("cc-head").textContent); });
  return pg;
}
const box = (pg, id) => pg.$eval("#" + id, (e) => { const b = e.getBoundingClientRect(); return { top: b.top + scrollY, bottom: b.bottom + scrollY, text: e.textContent.trim() }; });

test("390 px: the bar and the answer line are on the first screen, scripts on and off; state changes are announced once", { skip, timeout: 180000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const pg = await open(browser, port, "/cot");
    const bar = await box(pg, "cot-rel"), ans = await box(pg, "cc-answer"), chart = await box(pg, "cc-plot");
    assert.ok(bar.top < chart.top && bar.bottom < 300, "the bar is at the top: " + JSON.stringify(bar));
    assert.ok(ans.bottom <= 844, "the answer line ends on the first screen: " + ans.bottom);
    assert.match(bar.text, /^New report in 2 h 14 m · today 3:30 PM ET/);
    assert.equal(ans.text, G.answer("corn", FX.cot, FX.cx, G.etInstant(FX.cot.next_release, "15:30") - 134.5 * 60000).text);
    const colors = await pg.$eval("#cot-rel", (e) => [getComputedStyle(e).backgroundColor, getComputedStyle(e).color, parseFloat(getComputedStyle(e).fontSize)]);
    assert.ok(colors[2] >= 16, "large text " + colors[2]);
    assert.equal(colors[1], "rgb(17, 17, 17)", "dark text on the bright bar");
    const tap = await pg.$eval("#cot-rel-a", (a) => a.getBoundingClientRect().height);
    assert.ok(tap >= 44, "tap target " + tap);
    assert.equal(await pg.textContent("#cot-rel-live"), "", "the first paint is not announced");
    // a minute later: new text, no announcement; past the release: one announcement
    await pg.clock.runFor(61000);
    assert.match(await pg.textContent("#cot-rel-t"), /^New report in 2 h 13 m/);
    assert.equal(await pg.textContent("#cot-rel-live"), "", "minutes are not announced");
    await pg.clock.runFor(134 * 60000);
    assert.equal(await pg.textContent("#cot-rel-t"), "New report out at 3:30 PM ET, updating");
    assert.equal(await pg.getAttribute("#cot-rel", "data-state"), "due");
    assert.equal(await pg.textContent("#cot-rel-live"), "New report out at 3:30 PM ET, updating");
    assert.match(await pg.textContent("#cc-answer"), /Next report: out today at 3:30 PM ET, updating\.$/);
    await pg.context().close();
    // scripts off: the baked bar and answer line, both on the first screen
    const off = await open(browser, port, "/cot", { js: false });
    const b2 = await box(off, "cot-rel"), a2 = await box(off, "cc-answer");
    assert.match(b2.text, /^Next report: \w+day \w{3} \d{1,2}, 3:30 PM ET/);
    assert.match(a2.text, /^Week to \w{3}, \w{3} \d{1,2}, \d{4}\. .* Next report: \w+day \w{3} \d{1,2}, 3:30 PM ET/);
    assert.match((await box(off, "cc-head")).text, /^Corn funds .+ contracts\. (Still|Now|About even)/, "scripts off, the headline is baked too");
    assert.ok(a2.bottom <= 844, "scripts off, the answer line ends on the first screen: " + a2.bottom);
    await off.context().close();
  } finally { await browser.close(); srv.close(); }
});

test("two ranks only: with every fold open, each printed rank is the headline rank or the map's 3-year rank, in words", { skip, timeout: 180000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const url of ["/cot", "/cot?m=corn,soybeans,lean-hogs"]) {
      const pg = await open(browser, port, url, { width: 1280, fixed: true });
      await pg.evaluate(() => document.querySelectorAll("details").forEach((d) => { d.open = true; }));
      for (const id of ["cot-opt", "cx-board-sec", "cx-deep-sec"]) { await pg.evaluate((i) => document.getElementById(i).scrollIntoView(), id); await pg.waitForTimeout(400); }
      await pg.waitForFunction(() => document.querySelectorAll("#cm-wrap button").length > 10 && document.querySelector("#cx-deep .cx-market"));
      await pg.evaluate(() => document.querySelectorAll("details").forEach((d) => { d.open = true; }));
      await pg.click("#cm-wrap button[data-k='corn'][data-s='fut'][data-g='mm']");
      await pg.waitForTimeout(300);
      const text = await pg.evaluate(() => document.querySelector("main").innerText);
      assert.doesNotMatch(text, ORDINAL_RANK, "no ordinal ranks");
      assert.doesNotMatch(text, /own 52 weeks|of the 52 weeks|52-week percentile|Rank by raw contracts|percentile of their own record/i, "no third yardstick");
      const allowed = new Set();
      for (const c of Object.values(FX.cx.commodities)) { allowed.add(c.crowd.shown); allowed.add(100 - c.crowd.shown); }
      allowed.add(Math.round(FX.cx.board.mean_pctl));
      for (const m of text.matchAll(/(?:higher than|bigger net short than|above|below) (\d+)% of weeks since \d{4}/g)) assert.ok(allowed.has(+m[1]), "a headline rank: " + m[0]);
      for (const m of text.matchAll(/(?:above|below) (\d+)%\s/g)) assert.ok(allowed.has(+m[1]), "a table rank: " + m[0]);
      for (const m of text.matchAll(/(\d+)% of the last (\d+) weeks/g)) assert.match(m[0] + text.slice(text.indexOf(m[0]) + m[0].length, text.indexOf(m[0]) + m[0].length + 16), /in contracts/, "the map's rank names contracts: " + m[0]);
      await pg.context().close();
    }
  } finally { await browser.close(); srv.close(); }
});

test("phone save image: 1080x1350, headline 56 px or more, everything else 26 px or more, the answer, price, site, date, source", { skip, timeout: 180000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const pg = await open(browser, port, "/cot");
    const [dl] = await Promise.all([pg.waitForEvent("download"), pg.click("#cc-save")]);
    const buf = fs.readFileSync(await dl.path());
    assert.deepEqual([buf.readUInt32BE(16), buf.readUInt32BE(20)], [1080, 1350], "4:5 on a phone-width screen");
    const im = await pg.evaluate(() => window.AgCotChart.lastImage);
    // the source line is small print (Sig, Nov 6: "make the source print smaller"): 20 px; every other word 26 px or more
    assert.ok(Math.min(...im.sizes.filter((z) => z !== 20)) >= 26 && Math.min(...im.sizes) >= 20, "every word 26 px or more, source 20 px: " + Math.min(...im.sizes));
    const head = im.texts.findIndex((t) => t.startsWith("Corn funds cut their net long by"));
    assert.ok(head >= 0 && im.sizes[head] >= 56, "headline 56 px or more");
    const stand = im.texts.indexOf("Still net long: 81,113.");
    assert.ok(stand > head && im.sizes[stand] >= 40, "where funds stand, right under what changed");
    for (const t of ["agsist.com/cot", "Week to Tue, Oct 27, 2026. Released Fri, Oct 30, 2026.", "$4.48\u00be/bu", "Net contracts", "Oct 27, 2026"]) assert.ok(im.texts.includes(t), t + " in " + im.texts.join(" | "));
    assert.ok(im.texts.some((t) => t.startsWith("Rank: higher than 48%")), "the rank line");
    assert.ok(!im.texts.some((t) => /\bthis week\b|\btoday\b|moderate|crowded/i.test(t)), "no 'this week', 'today' or weight words on the picture");
    assert.ok(im.texts.some((t) => t.startsWith("Source: CFTC Commitments of Traders")), "the source");
    assert.ok(!im.texts.some((t) => DASH.test(t)));
    // the Funds this week ask (Sig, Nov 6): its own last line, 26 px or more, clear of the source and of the bottom edge
    const ask = im.texts.indexOf("Free every Friday: agsist.com/cot");
    assert.ok(ask >= 0 && im.sizes[ask] >= 26, "the ask line, 26 px or more");
    const below = im.ys.slice(0, ask);   // every line drawn before it: the site, date, headline, answer, axis words, source
    assert.ok(im.ys[ask] === Math.max(...im.ys) && im.ys[ask] <= 1350 - im.sizes[ask] * 0.3, "the ask is the last line and not clipped: " + im.ys[ask]);
    assert.ok(im.ys[ask] - Math.max(...below) >= im.sizes[ask] * 1.6, "a clear gap above the ask: " + (im.ys[ask] - Math.max(...below)));
    if (process.env.COT_SHOTS) fs.writeFileSync(path.join(process.env.COT_SHOTS, "save-phone.png"), buf);
    await pg.context().close();
    // desktop keeps 1200x675
    const d = await open(browser, port, "/cot", { width: 1280 });
    const [dl2] = await Promise.all([d.waitForEvent("download"), d.click("#cc-save")]);
    const b2 = fs.readFileSync(await dl2.path());
    assert.deepEqual([b2.readUInt32BE(16), b2.readUInt32BE(20)], [1200, 675]);
    const di = await d.evaluate(() => window.AgCotChart.lastImage), da = di.texts.indexOf("Free every Friday: agsist.com/cot");
    assert.ok(da >= 0 && di.ys[da] === Math.max(...di.ys) && di.ys[da] <= 675 - 5, "desktop: the ask on its own last line, not clipped");
    assert.ok(di.ys[da] - Math.max(...di.ys.slice(0, da)) >= di.sizes[da] * 1.6, "desktop: a clear gap above the ask");
    if (process.env.COT_SHOTS) fs.writeFileSync(path.join(process.env.COT_SHOTS, "save-desktop.png"), b2);
    await d.context().close();
  } finally { await browser.close(); srv.close(); }
});
