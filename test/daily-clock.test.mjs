/* The Daily's one clock (panel Nov 9 2026, skeptic 3(a) 1 to 5): each crop on
 * its own clock, Jan beans after Nov first notice, chart and month to date on
 * settles of one contract, the note under the strip naming the settle's own
 * day, a rolled contract named by its month, the harvest pace and subject
 * settle checks, issue numbers, plurals and the harvest clock at 0. Each case
 * is a real published day; scripts/test_daily_clock.py holds them. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

test("the Daily's one clock holds on the real days it broke", () => {
  const out = execFileSync("python3", ["scripts/test_daily_clock.py"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  assert.match(out, /test_daily_clock: 0 failure\(s\)/, out);
});

test("/daily names the settle's own day, the same as the archive page", () => {
  const HTML = readFileSync(ROOT + "daily.html", "utf8");
  const ctx = { Date, Intl, String, Object };
  vm.createContext(ctx);
  vm.runInContext(HTML.slice(HTML.indexOf("/* stripNote:start"), HTML.indexOf("/* stripNote:end */")), ctx);
  // Nov 9 2026: Friday's Nov bean settle beside Monday's overnight corn and wheat
  const base = { asof: "2026-11-09T11:46:14Z", session: "2026-11-09", vs_session: "2026-11-06" };
  const Q = (name, kind, extra) => Object.assign({ name, kind, last: 1, prev: 1, pct: 0 }, extra || {});
  const cases = [
    Object.assign({}, base, { quotes: [Q("Corn", "last", { at: "2026-11-09T11:45:54Z" }), Q("Soybeans", "settle", { date: "2026-11-06" }), Q("Wheat", "last", { at: "2026-11-09T11:46:02Z" })] }),
    Object.assign({}, base, { quotes: [Q("Corn", "settle", { date: "2026-11-06" }), Q("Soybeans", "settle", { date: "2026-11-05" })] }),
    Object.assign({}, base, { quotes: [Q("Corn", "settle"), Q("Soybeans", "settle")] }),
  ];
  const py = JSON.parse(execFileSync("python3", ["-c",
    "import sys,json;sys.path.insert(0,'scripts');import generate_daily as g;print(json.dumps([g.quote_strip_note(s) for s in json.load(sys.stdin)]))"],
    { cwd: ROOT, encoding: "utf8", input: JSON.stringify(cases) }));
  assert.equal(py[0], "Exchange settles, Fri Nov 6, except the last trade for Corn and Wheat as of 5:45 AM CT Mon · change vs Fri settle · Yahoo Finance, delayed");
  assert.ok(!py[0].includes("Mon Nov 9"));
  assert.ok(py[1].startsWith("Exchange settles · "), "settles from two days: no one day named");
  assert.ok(py[2].startsWith("Exchange settles, Mon Nov 9"), "a strip whose settles carry no day keeps its old words");
  for (let i = 0; i < cases.length; i++) assert.equal(ctx.stripNote(cases[i]), py[i], "case " + i);
});
