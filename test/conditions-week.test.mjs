/* /conditions names one week, the week its data files are on.
 *
 * 2026-10-15: the title said "Corn 54%", and the summary, the stats line and
 * the table caption said "week ending Oct 4", while data/crop-progress.json
 * and data/conditions/conditions.json were both on Oct 11 and the live table
 * said 2026-10-11. The seeds were only re-baked by the freshness job. Now the
 * two data workflows re-bake right after each fetch, and this test holds the
 * shipped page, the builder and the workflows to that.
 *
 * 2026-11-02: USDA's last corn rating was the week ending Oct 25 but the Nov 1
 * report still counted harvest (corn 74%). Keyed on the rating week, the page
 * said "No state harvest numbers for the week ending Oct 25". The rule is now:
 * condition parts name the condition week, harvest parts the harvest week (the
 * newer one when USDA keeps counting harvest after its last rating), and no
 * other week appears. Real case: test/fixtures/conditions-2026-11-02/.
 *
 *   node --test test/conditions-week.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (f) => readFileSync(ROOT + f, "utf8");
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const nice = (iso) => { const [y, m, d] = iso.split("-").map(Number); return `${MON[m - 1]} ${d}, ${y}`; };
const toIso = (s) => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^([A-Z][a-z]{2}) (\d{1,2}), (\d{4})$/);
  return `${m[3]}-${String(MON.indexOf(m[1]) + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
};
const seed = (html, tag) => {
  const m = html.match(new RegExp(`<!--SEED:${tag}-->([\\s\\S]*?)<!--/SEED-->`));
  assert.ok(m, `seed ${tag} present`);
  return m[1];
};
// every "week ending <date>" outside <script>, as ISO dates
// the week the harvest numbers are on: the newer of the rating week and the harvest date
const harvestWeek = (cp, k = "corn_harvested") => {
  const rd = (cp.corn || {}).report_date || cp.report_date;
  const d = ((cp.progress || {})[k] || {}).date || (k === "corn_harvested" ? (cp.corn || {}).harvest_date : null);
  return d && rd && d > rd ? d : rd;
};
const weeksNamed = (html) => {
  const body = html.replace(/<script[\s\S]*?<\/script>/g, "");
  const out = new Set();
  for (const m of body.matchAll(/week ending ((?:[A-Z][a-z]{2} \d{1,2}, \d{4})|\d{4}-\d{2}-\d{2})/gi)) out.add(toIso(m[1]));
  return out;
};

test("shipped page: condition parts name the condition week, harvest parts the harvest week", () => {
  const html = read("conditions.html");
  const cp = JSON.parse(read("data/crop-progress.json"));
  const cj = JSON.parse(read("data/conditions/conditions.json"));
  const rd = cp.corn.report_date || cp.report_date;
  const we = cj.crops.corn.week_ending;
  const hd = harvestWeek(cp);
  if (!cp.in_season) return;
  const ge = cp.corn.good_excellent;
  const title = html.match(/<title>([^<]*)<\/title>/)[1];
  // Oct 20 (panel B): in harvest season the title leads with this week's harvest percent
  const hp = cp.corn.harvest_pct, harvest = typeof hp === "number" && hp > 0 && hp < 100 && cp.corn.harvest_date === rd;
  if (harvest) {
    assert.match(title, new RegExp(`^Corn ${hp}% Harvested`), "title leads with this week's corn harvest");
    assert.ok(title.includes(`Week Ending ${nice(rd).replace(/, \d{4}$/, "")}`), "and names the week: " + title);
  } else {
    assert.match(title, new RegExp(`Corn ${ge}% Good-Excellent`), "title carries this week's corn G+E");
  }
  const desc = html.match(/<meta name="description" content="([^"]*)"/)[1];
  assert.match(desc, new RegExp(`(US c|C)orn is ${ge}% good to excellent`), "meta description too");
  if (harvest) assert.match(desc, new RegExp(`US corn is ${hp}% harvested`), "and the harvest");
  // The page withholds a rating once its week is older than the builder's conditions limit
  // (seed_static.STALE_DAYS); USDA stops rating corn in late October, so by mid-November the
  // top lines say "No current ... rating" and still name the last week on file. The harvest
  // parts keep their own week and freshness.
  const limit = Number(execFileSync("python3", ["-c", "import sys; sys.path.insert(0, 'scripts'); import seed_static as s; print(s.STALE_DAYS['conditions'])"], { cwd: ROOT, encoding: "utf8" }));
  const age = (iso) => Math.floor((Date.now() - Date.parse(iso + "T00:00:00Z")) / 864e5);
  const ratingStale = age(rd) > limit, tableStale = age(we) > limit;
  for (const tag of ["condweek", "condvsent", "condstats"]) {
    const t = seed(html, tag);
    assert.ok(t.toLowerCase().includes(`week ending ${nice(rd)}`.toLowerCase()), `${tag} names ${nice(rd)}`);
    if (ratingStale) assert.match(t, /^No current (national )?rating/, `${tag} withholds a rating that is ${age(rd)} days old`);
    else assert.ok(t.includes(`${ge}%`), `${tag} carries ${ge}%`);
  }
  assert.ok(seed(html, "condharvline").includes(`week ending ${nice(hd)}`), `condharvline names the harvest week ${nice(hd)}`);
  if (tableStale) {
    assert.ok(seed(html, "condtable").includes(`No current state ratings: latest state file is the week ending ${nice(we)}`), "rank table withheld, names its week");
    assert.equal(seed(html, "condfresh"), "-", "table header withheld");
  } else {
    assert.ok(seed(html, "condtable").includes(`<caption>Corn, week ending ${nice(we)}`), "rank table caption");
    assert.equal(seed(html, "condfresh"), `week ending ${we}`, "table header");
  }
  assert.ok(seed(html, "condharvtable").includes(`harvested, week ending ${nice(hd)}`), "harvest caption on the harvest week");
  for (const tag of ["condvsent", "condstats", "condtable", "condfresh"])
    for (const w of weeksNamed(seed(html, tag))) assert.ok(w === rd || w === we, `${tag}: ${w} is not the condition week`);
  for (const tag of ["condharvline", "condharvtable", "condharvlead"])
    for (const w of weeksNamed(seed(html, tag))) assert.ok(w === hd || (w === rd && tag === "condharvline"), `${tag}: ${w} is not the harvest week`);
  const named = weeksNamed(html);
  for (const w of named) assert.ok(w === rd || w === we || w === hd, `stray week ${w}`);
  const alt = html.match(/<meta property="og:image:alt" content="([^"]*)"/);
  // since #465 the card leads with harvest (and its week) once the rating is past the page's limit
  if (alt && /week ending/.test(alt[1])) assert.ok(alt[1].includes(nice(/harvest/i.test(alt[1]) ? hd : rd)), "share image alt");
});

test("builder: with both files on one week, every seeded line names that week", () => {
  const dir = mkdtempSync(join(tmpdir(), "cond-"));
  mkdirSync(join(dir, "data/conditions"), { recursive: true });
  copyFileSync(ROOT + "conditions.html", join(dir, "conditions.html"));
  const state = (ge, hist) => ({ ge, rank_from_worst: 2, of: hist.length + 1, pctile: 10, best: 90, worst: 30, avg: 60, hist });
  const hist = []; for (let y = 2001; y < 2026; y++) if (y !== 2012 && y !== 2025) hist.push([y, 60]);
  const cp = {
    report_date: "2026-10-18", in_season: true,
    corn: { good_excellent: 61, report_date: "2026-10-18", good_excellent_prev_week: 56, harvest_pct: 45, harvest_date: "2026-10-18", harvest_5yr_avg: 50 },
    soybeans: { good_excellent: 58, report_date: "2026-10-18" },
    progress: { corn_harvested: { date: "2026-10-18", pct: 45, avg5: 50 }, soybeans_harvested: { date: "2026-10-18", pct: 60, avg5: 64 } },
    states: {
      IA: { corn_harvested: { date: "2026-10-18", pct: 30, prev_week: 14, prev_year: null, avg5: 48 } },
      IL: { corn_harvested: { date: "2026-10-18", pct: 55, prev_week: 40, prev_year: null, avg5: 52 } },
      TX: { corn_harvested: { date: "2026-10-04", pct: 90, prev_year: null, avg5: 88 } },
    },
  };
  const cj = { generated: "2026-10-20T01:00:00Z", crops: { corn: { week_ending: "2026-10-18", states: { IA: state(61, hist), IL: state(70, hist) } } } };
  writeFileSync(join(dir, "data/crop-progress.json"), JSON.stringify(cp));
  writeFileSync(join(dir, "data/conditions/conditions.json"), JSON.stringify(cj));
  execFileSync("python3", ["-c",
    "import os,sys; sys.path.insert(0, sys.argv[1]); os.chdir(sys.argv[2]); import seed_static; seed_static.seed_conditions('2026-10-20')",
    ROOT + "scripts", dir], { stdio: "pipe" });
  const html = readFileSync(join(dir, "conditions.html"), "utf8");
  const named = new Set();
  for (const tag of ["condweek", "condvsent", "condstats", "condtable", "condfresh", "condharvline", "condharvtable"])
    for (const w of weeksNamed(seed(html, tag))) named.add(w);
  assert.deepEqual([...named], ["2026-10-18"], "every seed on Oct 18");
  const stats = seed(html, "condstats");
  assert.ok(stats.includes("2001&ndash;present"), "says where this week's comparison starts");
  assert.ok(stats.includes("2000, 2012 or 2025"), "names the years with no rating at this week");
  const harv = seed(html, "condharvtable");
  assert.ok(harv.includes("Iowa") && harv.includes("Illinois"), "states on this week listed");
  assert.ok(!harv.includes("Texas"), "a state on an older week is left off, not shown as this week");
  assert.ok(harv.indexOf("Iowa") < harv.indexOf("Illinois"), "furthest behind first");
  assert.ok(harv.includes("&minus;18 pts"), "IA 30% vs 48% avg = -18");
  assert.ok(harv.includes("Week before") && harv.includes("14%"), "week-before column when the file has it");
  assert.ok(!harv.includes("Last year"), "no last-year column when no state has one");

  // files a week apart: the page says so instead of passing two weeks off as one
  cj.crops.corn.week_ending = "2026-10-11";
  writeFileSync(join(dir, "data/conditions/conditions.json"), JSON.stringify(cj));
  execFileSync("python3", ["-c",
    "import os,sys; sys.path.insert(0, sys.argv[1]); os.chdir(sys.argv[2]); import seed_static; seed_static.seed_conditions('2026-10-20')",
    ROOT + "scripts", dir], { stdio: "pipe" });
  const s2 = seed(readFileSync(join(dir, "conditions.html"), "utf8"), "condstats");
  assert.match(s2, /state ranks are still on the week ending Oct 11, 2026/);
});

test("both data workflows re-bake the page right after their fetch and commit it", () => {
  for (const [wf, fetch] of [["crop_progress.yml", "fetch_crop_progress.py"], ["conditions.yml", "fetch_conditions.py"]]) {
    const y = read(".github/workflows/" + wf);
    const iFetch = y.search(new RegExp(`run: python scripts/${fetch.replace(".", "\\.")}\\s*$`, "m"));
    const iSeed = y.indexOf("python scripts/seed_static.py --only conditions");
    const iBake = y.indexOf("python scripts/bake_seo.py --page conditions.html");
    const iCommit = y.search(/git add [^\n]*conditions\.html/);
    assert.ok(iFetch > 0 && iSeed > iFetch && iBake > iSeed && iCommit > iBake, `${wf}: fetch, seed, bake, commit conditions.html`);
  }
  assert.ok(read("scripts/seed_static.py").includes('sys.argv[1:] == ["--only", "conditions"]'), "seed_static has --only conditions");
});

// 2026-10-16 audit: in October the page opened "Every drought summer..." and
// buried harvest pace. Oct-Nov lead with harvest pace by state vs average.
test("builder: Oct-Nov lead with harvest pace by state; summer lede only Jun-Sep", () => {
  const dir = mkdtempSync(join(tmpdir(), "cond-season-"));
  mkdirSync(join(dir, "data/conditions"), { recursive: true });
  copyFileSync(ROOT + "conditions.html", join(dir, "conditions.html"));
  const mk = (rd) => ({
    report_date: rd, in_season: true,
    corn: { good_excellent: 61, report_date: rd },
    soybeans: { good_excellent: 58, report_date: rd },
    progress: { corn_harvested: { date: rd, pct: 45, avg5: 50 }, soybeans_harvested: { date: rd, pct: 60, avg5: 64 } },
    states: {
      IA: { corn_harvested: { date: rd, pct: 30, avg5: 48 }, soybeans_harvested: { date: rd, pct: 70, avg5: 66 } },
      IL: { corn_harvested: { date: rd, pct: 55, avg5: 52 } },
      TX: { corn_harvested: { date: rd, pct: 90, avg5: 88 } },
    },
  });
  const run = (rd, today) => {
    writeFileSync(join(dir, "data/crop-progress.json"), JSON.stringify(mk(rd)));
    writeFileSync(join(dir, "data/conditions/conditions.json"), JSON.stringify({ crops: {} }));
    execFileSync("python3", ["-c",
      "import os,sys; sys.path.insert(0, sys.argv[1]); os.chdir(sys.argv[2]); import seed_static; seed_static.seed_conditions(sys.argv[3])",
      ROOT + "scripts", dir, today], { stdio: "pipe" });
    return readFileSync(join(dir, "conditions.html"), "utf8");
  };
  let html = run("2026-10-18", "2026-10-20");
  let lede = seed(html, "condlede"), lead = seed(html, "condharvlead");
  assert.match(lede, /^Harvest pace first/, "October lede leads with harvest");
  assert.ok(!/drought summer/i.test(lede), "no summer lede in October");
  assert.ok(lead.includes("Harvest pace by state vs average") && lead.includes("week ending Oct 18, 2026"), "harvest block on this week");
  // hand-worked: IA corn 30 vs 48 = -18, beans 70 vs 66 = +4; IL corn 55 vs 52 = +3, no beans row
  assert.ok(/Iowa<\/td><td class="num">30% <span class="cd-hl-gap lo">&minus;18<\/span><\/td><td class="num">70% <span class="cd-hl-gap">\+4<\/span>/.test(lead), "Iowa corn -18, beans +4");
  assert.ok(/Illinois<\/td><td class="num">55% <span class="cd-hl-gap">\+3<\/span><\/td><td class="num" style="color:#8a948f">&ndash;<\/td>/.test(lead), "Illinois beans not reported shows a dash");
  assert.ok(!lead.includes("Texas"), "only the big corn and soybean states up top");
  assert.ok(html.indexOf("SEED:condharvlead") < html.indexOf('id="cd-grid"'), "harvest block sits above the state map");
  assert.ok(!html.includes("—"), "no em dashes");

  html = run("2026-07-12", "2026-07-14");
  assert.match(seed(html, "condlede"), /drought summer/, "summer lede in July");
  assert.equal(seed(html, "condharvlead"), "", "no harvest block in July");

  html = run("2026-11-29", "2026-12-01");
  assert.ok(!/drought summer/i.test(seed(html, "condlede")), "no summer lede in December");
  assert.equal(seed(html, "condharvlead"), "", "no harvest block in December");
});

// 2026-11-02 real case: data/crop-progress.json held the last corn rating (week ending Oct 25,
// 56%) and the Nov 1 harvest (corn 74%, soybeans 88%, 30 corn states, no five-year average:
// the 2025 shutdown gap leaves none). The page said "No state harvest numbers for the week
// ending Oct 25, 2026" and dropped harvest entirely.
test("builder, Nov 2 real case: harvest parts on Nov 1, condition parts on Oct 25", () => {
  const FX = ROOT + "test/fixtures/conditions-2026-11-02/";
  const dir = mkdtempSync(join(tmpdir(), "cond-nov2-"));
  mkdirSync(join(dir, "data/conditions"), { recursive: true });
  copyFileSync(ROOT + "conditions.html", join(dir, "conditions.html"));
  copyFileSync(FX + "crop-progress.json", join(dir, "data/crop-progress.json"));
  copyFileSync(FX + "conditions.json", join(dir, "data/conditions/conditions.json"));
  const run = (today) => {
    execFileSync("python3", ["-c",
      "import os,sys; sys.path.insert(0, sys.argv[1]); os.chdir(sys.argv[2]); import seed_static; seed_static.seed_conditions(sys.argv[3])",
      ROOT + "scripts", dir, today], { stdio: "pipe" });
    return readFileSync(join(dir, "conditions.html"), "utf8");
  };
  let html = run("2026-11-02");
  const line = seed(html, "condharvline"), tab = seed(html, "condharvtable"), lead = seed(html, "condharvlead");
  assert.ok(line.startsWith("US, week ending Nov 1, 2026: Corn <strong>74%</strong> harvested; Soybeans <strong>88%</strong> harvested."), line);
  assert.ok(line.includes("30 corn states reported this week."), "30 states on Nov 1");
  assert.ok(line.includes("Condition ratings on this page are for the week ending Oct 25, 2026."), "says the ratings are a week older");
  assert.ok(!/No state harvest numbers|No national harvest/.test(line + tab), "the harvest is not hidden");
  assert.ok(tab.startsWith("<caption>Corn harvested, week ending Nov 1, 2026 &middot; least harvested first</caption>"), tab.slice(0, 120));
  assert.ok(!tab.includes("5-yr avg") && !tab.includes("vs avg"), "no empty five-year columns");
  assert.ok(tab.indexOf("New York") < tab.indexOf("Michigan") && tab.indexOf("Michigan") < tab.indexOf("Iowa") && tab.indexOf("Iowa") < tab.indexOf("Alabama"), "NY 28%, then MI 43%, IA 66%, AL 100%");
  assert.ok(/Iowa<\/td><td class="num">66%<\/td><td class="num">47%<\/td><\/tr>/.test(tab), "Iowa 66%, 47% the week before");
  assert.ok(lead.includes("week ending Nov 1, 2026") && !lead.includes("five-year average"), "top block on Nov 1, no average claimed");
  assert.match(seed(html, "condlede"), /^Harvest pace first/);
  const wk = seed(html, "condweek");
  assert.ok(wk.startsWith("Week ending Oct 25, 2026") && wk.includes("<b>56%</b>"), wk);
  assert.ok(wk.endsWith("Harvested, week ending Nov 1, 2026: corn 74%, soybeans 88%."), wk);
  for (const tag of ["condvsent", "condstats", "condtable", "condfresh"])
    for (const w of weeksNamed(seed(html, tag))) assert.equal(w, "2026-10-25", `${tag} on the condition week`);
  const all = new Set();
  for (const tag of ["condweek", "condvsent", "condstats", "condtable", "condfresh", "condharvline", "condharvtable", "condharvlead"])
    for (const w of weeksNamed(seed(html, tag))) all.add(w);
  assert.deepEqual([...all].sort(), ["2026-10-25", "2026-11-01"], "no other week");

  // Nov 9: the Oct 25 rating is past 14 days and withheld; the Nov 1 harvest still shows
  html = run("2026-11-09");
  assert.match(seed(html, "condweek"), /^No current national rating/);
  assert.ok(seed(html, "condharvline").startsWith("US, week ending Nov 1, 2026: Corn <strong>74%</strong>"), "harvest stands on its own week");
  assert.ok(!seed(html, "condharvline").includes("Condition ratings on this page"), "no pointer to a withheld rating");
  // Nov 20: the harvest week is stale too
  html = run("2026-11-20");
  assert.match(seed(html, "condharvline"), /^No current harvest numbers: the latest report on file is the week ending Nov 1, 2026\./);
});
