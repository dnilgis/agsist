/* /conditions names one week, the week its data files are on.
 *
 * 2026-10-15: the title said "Corn 54%", and the summary, the stats line and
 * the table caption said "week ending Oct 4", while data/crop-progress.json
 * and data/conditions/conditions.json were both on Oct 11 and the live table
 * said 2026-10-11. The seeds were only re-baked by the freshness job. Now the
 * two data workflows re-bake right after each fetch, and this test holds the
 * shipped page, the builder and the workflows to that.
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
const weeksNamed = (html) => {
  const body = html.replace(/<script[\s\S]*?<\/script>/g, "");
  const out = new Set();
  for (const m of body.matchAll(/week ending ((?:[A-Z][a-z]{2} \d{1,2}, \d{4})|\d{4}-\d{2}-\d{2})/gi)) out.add(toIso(m[1]));
  return out;
};

test("shipped page: title, summary, stats, caption and harvest table all name the data's week", () => {
  const html = read("conditions.html");
  const cp = JSON.parse(read("data/crop-progress.json"));
  const cj = JSON.parse(read("data/conditions/conditions.json"));
  const rd = cp.corn.report_date || cp.report_date;
  const we = cj.crops.corn.week_ending;
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
  for (const tag of ["condweek", "condvsent", "condstats", "condharvline"]) {
    assert.ok(seed(html, tag).toLowerCase().includes(`week ending ${nice(rd)}`.toLowerCase()), `${tag} names ${nice(rd)}`);
    assert.ok(seed(html, tag).includes(`${ge}%`) || tag === "condharvline", `${tag} carries ${ge}%`);
  }
  assert.ok(seed(html, "condtable").includes(`<caption>Corn, week ending ${nice(we)}`), "rank table caption");
  assert.equal(seed(html, "condfresh"), `week ending ${we}`, "table header");
  assert.ok(seed(html, "condharvtable").includes(`harvested, week ending ${nice(rd)}`), "harvest caption");
  const named = weeksNamed(html);
  if (rd === we) assert.deepEqual([...named], [rd], "one week on the whole page");
  else for (const w of named) assert.ok(w === rd || w === we, `stray week ${w}`);
  const alt = html.match(/<meta property="og:image:alt" content="([^"]*)"/);
  if (alt && /week ending/.test(alt[1])) assert.ok(alt[1].includes(nice(rd)), "share image alt");
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
