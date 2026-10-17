/* The line under the Daily's quote strip follows each quote's close_kind
 * (fetch_prices v3.7, carried in locked_changes): "Exchange settles, Fri Oct
 * 16" over a row of settles, "Last trades as of ..., not the settle" over
 * trades, and the trades named when the two mix. Issues published before the
 * strip carried a kind keep the words they were published with. The /daily
 * renderer (stripNote in daily.html) and the archive renderer
 * (quote_strip_note in generate_daily.py) must print the same line. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const HTML = readFileSync(ROOT + "daily.html", "utf8");
const src = HTML.slice(HTML.indexOf("/* stripNote:start"), HTML.indexOf("/* stripNote:end */"));
const ctx = { Date, Intl, String };
vm.createContext(ctx);
vm.runInContext(src, ctx);

const base = { asof: "2026-10-17T06:46:21Z", session: "2026-10-16", vs_session: "2026-10-15" };
const Q = (name, kind, at) => Object.assign({ name, last: 1, prev: 1, pct: 0 }, kind ? { kind } : {}, at ? { at } : {});
const CASES = [
  Object.assign({}, base, { quotes: [Q("Corn", "settle"), Q("Soybeans", "settle"), Q("Wheat", "settle")] }),
  Object.assign({}, base, { quotes: [Q("Corn", "settle"), Q("Soybeans", "settle"), Q("Wheat", "last", "2026-10-16T18:46:00Z")] }),
  Object.assign({}, base, { asof: "2026-10-16T18:46:00Z", quotes: [Q("Corn", "last", "2026-10-16T18:46:00Z"), Q("Soybeans", "last", "2026-10-16T18:46:00Z")] }),
  Object.assign({}, base, { quotes: [Q("Corn"), Q("Wheat")] }),
];
const py = JSON.parse(execFileSync("python3", ["-c",
  "import sys,json;sys.path.insert(0,'scripts');import generate_daily as g;print(json.dumps([g.quote_strip_note(s) for s in json.load(sys.stdin)]))"],
  { cwd: ROOT, encoding: "utf8", input: JSON.stringify(CASES) }));

test("settles, trades and a mix each say what they are", () => {
  assert.equal(py[0], "Exchange settles, Fri Oct 16 · change vs Thu settle · Yahoo Finance, delayed");
  assert.equal(py[1], "Exchange settles, Fri Oct 16, except the last trade for Wheat as of 1:46 PM CT Fri · change vs Thu settle · Yahoo Finance, delayed");
  assert.equal(py[2], "Last trades as of 1:46 PM CT Fri, not the settle · change vs Thu settle · Yahoo Finance, delayed");
  assert.equal(py[3], "Quotes as of 1:46 AM CT Sat · change vs Thu close · Yahoo Finance, delayed, not CME settlements", "an older issue keeps its words");
  for (const t of py) assert.ok(!t.includes("—"));
});

test("/daily prints the same line as the archive page", () => {
  for (let i = 0; i < 3; i++) assert.equal(ctx.stripNote(CASES[i]), py[i], "case " + i);
  assert.equal(ctx.stripNote(CASES[3]), "", "no kind: the page keeps its old line");
});

test("the generator carries each quote's kind into the strip", () => {
  const out = JSON.parse(execFileSync("python3", ["-c", `
import sys,json;sys.path.insert(0,'scripts');import generate_daily as g
s=g.build_quote_strip({'corn-dec':4.7425,'beans-nov':12.6125,'wheat':6.605},
  {'corn-dec':{'prev':4.78,'pct':-0.78,'kind':'settle'},'beans-nov':{'prev':12.63,'pct':-0.14,'kind':'settle'},
   'wheat':{'prev':6.7,'pct':-1.42,'kind':'last','at':'2026-10-16T18:46:00Z'}},
  {'fetched':'2026-10-17T06:46:21Z','quote_session':'2026-10-16','prev_close_session':'2026-10-15'})
print(json.dumps({'kinds':[q.get('kind') for q in s['quotes']],'at':s['quotes'][2].get('at'),'html':g.render_quote_strip_html(s)}))`], { cwd: ROOT, encoding: "utf8" }));
  assert.deepEqual(out.kinds, ["settle", "settle", "last"]);
  assert.equal(out.at, "2026-10-16T18:46:00Z");
  assert.match(out.html, /except the last trade for Wheat as of 1:46 PM CT Fri/);
  assert.ok(!out.html.includes("not CME settlements"));
});
