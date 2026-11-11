/* The public basis record starts on Oct 12, 2026, the day after the old feed's last day
 * (build_basis_history.py PUBLIC_FROM).
 *
 * The real case: data/basis held daily change files from Jun 10, the state shards carried first-seen and
 * changed-on days from Jun 9, data/basis-sparklines (the town page "Basis since" box) ran from Jun 10, and
 * the weekly state basis on /grain-transport started Jun 12. Every one of those copies now starts on the
 * builder's PUBLIC_FROM day.
 *
 * What is checked:
 *   1. no data/basis/changes-<date>.json dated before PUBLIC_FROM is tracked;
 *   2. every bids-run file that says where its record starts (publicFrom) says PUBLIC_FROM and holds no
 *      earlier date: the state shards, the sparklines, the weekly basis and its connection file. A file
 *      without publicFrom was written before this change; the bids run (every 15 minutes) rewrites it.
 *      Once one file in a folder carries publicFrom every file there must, and after STAMP_BY no file
 *      may go without it;
 *   3. a town page built by this builder (cb-basis-hist.js?v=6) heads its box with PUBLIC_FROM, and once
 *      any is built, no town page names the old feed or a June start;
 *   4. the builders' own selftests, and the box drawn by the page's own render().
 *
 *   node --test test/basis-history-start.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const SRC = fs.readFileSync(path.join(ROOT, "scripts/build_basis_history.py"), "utf8");
const START = (SRC.match(/^PUBLIC_FROM = "(\d{4}-\d{2}-\d{2})"/m) || [])[1];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const START_WORDS = START ? MON[+START.slice(5, 7) - 1] + " " + +START.slice(8, 10) + ", " + START.slice(0, 4) : "";
const ISO = /^\d{4}-\d{2}-\d{2}/;
// the bids run rewrites the shards and sparklines every 15 minutes and the transport run the weekly basis;
// a file still unstamped after this day was not rewritten by the new builders, and fails
const STAMP_BY = "2026-11-14";
const PAST_STAMP_BY = new Date().toISOString().slice(0, 10) > STAMP_BY;

function tracked(dir) {
  return execFileSync("git", ["ls-files", "--", dir], { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 26 }).split("\n").filter(Boolean);
}
function readJSON(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
}
// every YYYY-MM-DD string anywhere in a value
function dates(v, out = []) {
  if (typeof v === "string") { if (ISO.test(v)) out.push(v.slice(0, 10)); }
  else if (Array.isArray(v)) v.forEach((x) => dates(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => dates(x, out));
  return out;
}
// the dated part of each file: what a page draws or prints (not "generated", the run's own time)
const DATED = {
  shard: (d) => d.d || [],
  sparkline: (d) => dates(d.series || {}),
  ours: (d) => dates([d.weeks, d.states, d.groups, d.since]),
  connection: (d) => dates(Object.fromEntries(Object.entries(d.ours || {}).filter(([k]) => k !== "publicFrom"))),
};

test("the builder names one start day", () => {
  assert.ok(START, "PUBLIC_FROM in scripts/build_basis_history.py");
  for (const f of ["scripts/build_basis_sparklines.py", "scripts/fetch_grain_moves.py", "scripts/build_cash_bid_pages.py"]) {
    assert.match(fs.readFileSync(path.join(ROOT, f), "utf8"), /from build_basis_history import [^\n]*PUBLIC_FROM/, f + " takes the start from the one builder");
  }
});

test("no daily change file before the start day is in the public folder", () => {
  const files = tracked("data/basis").filter((f) => /\/changes-\d{4}-\d{2}-\d{2}\.json$/.test(f));
  assert.ok(files.length > 0, "the change files from the start day on are still here");
  const early = files.filter((f) => path.basename(f).slice(8, 18) < START);
  assert.deepEqual(early, [], early.length + " change file(s) before the start day");
});

function checkFolder(label, files, kind) {
  let stamped = 0, old = 0;
  const bad = [];
  for (const f of files) {
    const d = readJSON(f);
    const from = kind === "connection" ? (d.ours || {}).publicFrom : d.publicFrom;
    if (from === undefined) { old++; continue; }
    stamped++;
    assert.equal(from, START, f + " says its record starts on the builder's day");
    const early = DATED[kind](d).filter((x) => x < START);
    if (early.length) bad.push(f + ": " + early.length + " date(s) before the start day, first " + early.sort()[0]);
  }
  assert.deepEqual(bad, [], label);
  if (stamped) assert.equal(old, 0, label + ": " + old + " file(s) written before the start day rule beside " + stamped + " written after it");
  assert.ok(!(PAST_STAMP_BY && old), label + ": " + old + " file(s) still without publicFrom after " + STAMP_BY);
  return { stamped, old };
}

test("the state shards carry nothing before the start day", (t) => {
  // every shard, the old "??" file included: a state with no row since the start day leaves the folder
  const files = tracked("data/basis").filter((f) => /^data\/basis\/[^/]{2}\.json$/.test(f));
  const r = checkFolder("data/basis shards", files, "shard");
  const idx = readJSON("data/basis/index.json");
  if (r.stamped) assert.equal(idx.publicFrom, START, "the index says where the record starts");
  else t.diagnostic(r.old + " shards were written before this change; the next bids run rewrites them");
});

test("the town page basis box data carries nothing before the start day", (t) => {
  const files = tracked("data/basis-sparklines").filter((f) => /^data\/basis-sparklines\/[A-Z]{2}\.json$/.test(f));
  const r = checkFolder("data/basis-sparklines", files, "sparkline");
  if (!r.stamped) t.diagnostic(r.old + " sparkline files were written before this change; the next bids run rewrites them");
});

test("the weekly state basis and its connection carry nothing before the start day", (t) => {
  for (const [f, kind] of [["data/transport/moves/our-basis.json", "ours"], ["data/transport/moves/connection.json", "connection"]]) {
    if (!fs.existsSync(path.join(ROOT, f))) continue;
    const r = checkFolder(f, [f], kind);
    if (!r.stamped) t.diagnostic(f + " was written before this change; the next transport run rewrites it");
  }
});

test("a town page this builder wrote heads its basis box with the start day", (t) => {
  const pages = tracked("cash-bids").filter((f) => f.endsWith(".html"));
  let built = 0, old = 0;
  const bad = [];
  for (const f of pages) {
    const h = fs.readFileSync(path.join(ROOT, f), "utf8");
    if (!h.includes('class="cbt-hist"')) continue;
    if (!h.includes("/components/cb-basis-hist.js?v=6")) { old++; continue; }
    built++;
    const m = h.match(/<summary>Basis since ([^<]+)<\/summary>/);
    if (!m || m[1] !== START_WORDS) bad.push(f + ": " + (m ? m[1] : "no heading"));
  }
  assert.deepEqual(bad.slice(0, 5), [], bad.length + " town page(s) with another heading");
  if (!built) { t.diagnostic(old + " town pages were built before this change; the cash-bid pages rebuild on main follows"); return; }
  // once the set is built by this builder, no town page names the old feed or a June start
  const stale = pages.filter((f) => /licensed bid feed|[Ss]ince Jun(e|\b)/.test(fs.readFileSync(path.join(ROOT, f), "utf8")));
  assert.deepEqual(stale.slice(0, 5), [], stale.length + " town page(s) name the old feed or a June start");
});

test("the builders' selftests hold the start day", () => {
  const h = execFileSync("python3", ["scripts/build_basis_history.py", "--selftest"], { cwd: ROOT, encoding: "utf8" });
  assert.match(h, /FAILS=0/);
  assert.match(h, /ok {3}no change file before Oct 12 is written/); // pin-ok: the selftest's own line, not live data
  assert.match(h, /ok {3}the shards carry no date before Oct 12 and drop the row last seen Oct 11, the old feed's last day/); // pin-ok: the selftest's own line, not live data
  const s = execFileSync("python3", ["scripts/build_basis_sparklines.py", "--selftest"], { cwd: ROOT, encoding: "utf8" });
  assert.match(s, /a change logged before Oct 12, 2026 adds no point/); // pin-ok: the selftest's own line, not live data
});

test("the box names the start day in its heading and its lines", () => {
  const H = require(path.join(ROOT, "components/cb-basis-hist.js"));
  const data = { generated: "2026-11-04T02:00:00Z", publicFrom: "2026-10-12", series: {
    "IA|HEART OF IOWA COOP|NEVADA|corn|ZCZ26|NOV 26": [{ date: "2026-10-14", cents: -30 }, { date: "2026-10-20", cents: -22 }] } };
  const body = { innerHTML: "" }, sum = { textContent: "" };
  const boards = [["Heart of Iowa Coop", ["Nevada"]], ["Lincolnway Energy", ["Nevada"]]];
  const box = { getAttribute: (k) => (k === "data-boards" ? JSON.stringify(boards) : null),
    querySelector: (s) => (s === ".cbt-hist-body" ? body : s === "summary" ? sum : null) };
  H.render(box, data);
  assert.equal(sum.textContent, "Basis since Oct 12, 2026"); // pin-ok: inline fixture above, not live data
  assert.match(body.innerHTML, /on each date, since Oct 12, 2026\./); // pin-ok: inline fixture
  assert.match(body.innerHTML, /No basis change logged since Oct 12, 2026 for Lincolnway Energy\./); // pin-ok: inline fixture
});
