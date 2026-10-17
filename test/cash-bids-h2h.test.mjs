/* /cash-bids and its town pages, the 2026-10-15 head-to-head fixes:
 *  - the delivery label on a card never wraps one letter per line
 *  - the green/red basis colors have a key on the page
 *  - one "best after the drive" line under the best-price cards
 *  - "Basis since June" on town pages (components/cb-basis-hist.js), whose
 *    month, facility and town rules are twins of scripts/build_cash_bid_pages.py
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const JS = readFileSync(ROOT + "components/cash-bids.js", "utf8");
const HTML = readFileSync(ROOT + "cash-bids.html", "utf8");
const require = createRequire(import.meta.url);
const H = require(ROOT + "components/cb-basis-hist.js");

function liftFn(name) {
  const i = JS.indexOf("function " + name + "(");
  assert.ok(i >= 0, `components/cash-bids.js no longer defines ${name}()`);
  let d = 0, j = JS.indexOf("{", i);
  for (; j < JS.length; j++) {
    if (JS[j] === "{") d++;
    else if (JS[j] === "}" && --d === 0) break;
  }
  return JS.slice(i, j + 1);
}
function liftVar(name) {
  const m = new RegExp("var " + name + "=[\\s\\S]*?;\\n").exec(JS);
  assert.ok(m, `components/cash-bids.js no longer defines var ${name}`);
  return m[0];
}
function load() {
  const ctx = { Number, String, window: {} };
  vm.createContext(ctx);
  vm.runInContext(["EARN_MIN", "EARN_CROP"].map(liftVar).join("\n") + "\n" +
    ["earningsLine", "basisKey"].map(liftFn).join("\n"), ctx);
  return ctx;
}
const money = (n) => "$" + Math.round(Math.abs(n)).toLocaleString("en-US");

test("the delivery label keeps its width; the contract tag is what gives way", () => {
  assert.match(HTML, /\.bid-del-fwd,\.bid-del-spot\{white-space:nowrap;flex:0 0 auto\}/,
    "a long futures tag squeezed 'Oct 2026' to one letter per line (Wheaton Grain, Nov '26 Soybeans)");
  const tag = /\.bid-fut-tag\{([^}]*)\}/.exec(HTML)[1];
  assert.match(tag, /flex:0 1 auto/);
  assert.match(tag, /min-width:0/);
  assert.match(tag, /text-overflow:ellipsis/);
  assert.match(JS, /contractLabel\(bid\)\.replace\(\/\\s\+\(corn\|soybeans\?\|beans\)\$\/i,''\)/,
    "the crop word is not repeated in the tag under its own heading");
});

test("the basis colors get a one-line key, only when a card is colored", () => {
  const c = load();
  assert.equal(c.basisKey('<span class="bid-basis flat bz-mid">'), "");
  const k = c.basisKey('<span class="bid-basis bz-up">-60¢</span>');
  assert.match(k, /^<p class="cb-basis-key">Basis color: <span class="bz-up">green<\/span> is stronger than the middle/);
  assert.match(k, /<span class="bz-dn">red<\/span> is weaker, grey is within 2¢/);
  assert.match(JS, /results\.innerHTML=basisKey\(html\)\+html;/);
  assert.match(HTML, /\.cb-basis-key\{/);
});

test("best after the drive: one line, a winner, the closest, or nothing", () => {
  const c = load();
  assert.equal(c.earningsLine({ name: "Mid-Iowa Cooperative", net: 228.4, crop: "soybeans" }, ["corn", "soybeans"], 1000, money),
    "Best after the drive on 1,000 bu of soybeans: Mid-Iowa Cooperative, $228 more than your closest elevator.");
  assert.equal(c.earningsLine(null, ["corn", "soybeans", "wheat"], 1000, money),
    "Best after the drive on 1,000 bu: your closest elevator. No other nets $50 more on corn, soybeans or wheat after round-trip fuel.");
  assert.equal(c.earningsLine(null, ["corn"], 2500, money),
    "Best after the drive on 2,500 bu: your closest elevator. No other nets $50 more on corn after round-trip fuel.");
  assert.equal(c.earningsLine(null, [], 1000, money), "", "nothing compared, no line");
  assert.match(JS, /win\.net>EARN_MIN&&/, "the banner and the line use one threshold");
  assert.match(HTML, /\.earnings-callout\.flat\{/);
});

test("basis since June: delivery months read the way the log writes them", () => {
  const cases = [["JUN26", "2026-06-01", "2026-06"], ["OCT 01, 2026", "2026-09-30", "2026-10"],
    ["NOVEMBER", "2026-09-30", "2026-11"], ["JANUARY", "2026-12-02", "2027-01"], ["10/01/2026", "2026-09-01", "2026-10"],
    ["JAN 27", "2026-10-01", "2027-01"], ["OCT-26", "2026-10-01", "2026-10"], ["OCTOBER (2026-12)", "2026-10-01", "2026-10"],
    ["01 OCT 2026 TO 31 OCT 2026", "2026-10-01", "2026-10"], ["OCT-NOV 26", "2026-10-01", "2026-10"],
    ["LH SEPT CORN 26", "2026-09-22", "2026-09"], ["DEC CORN (2026-12)", "2026-09-24", "2026-12"],
    ["HARVEST 26", "2026-09-01", null], ["FALL 2026 (2026-11)", "2026-09-01", null], ["IN STORE", "2026-09-01", null],
    ["NEW CROP 2026", "2026-09-01", null], ["13/01/2026", "2026-09-01", null]];
  for (const [s, d, want] of cases) assert.equal(H.parseDm(s, d), want, s);
  // the builder decides which elevators get the box with its own twin; they must agree
  const py = JSON.parse(execFileSync("python3", ["-c",
    "import sys,json;sys.path.insert(0,'scripts');import build_cash_bid_pages as B;" +
    "c=json.loads(sys.argv[1]);print(json.dumps([[B.parse_dm(s,d),B.norm_fac(f),B.norm_town(t)] for s,d,f,t in c]))",
    JSON.stringify(cases.map(([s, d], i) => [s, d, ["CDR FARMS, LLC", "Farmers Co-op Co.", "A & B Grain Inc"][i % 3],
      ["ST. ANSGAR", "Saint Ansgar", "Ft Dodge", "Chippewa Falls"][i % 4]]))], { cwd: ROOT, encoding: "utf8" }));
  cases.forEach(([s, d], i) => {
    assert.equal(py[i][0], H.parseDm(s, d), "parse_dm twin: " + s);
    assert.equal(py[i][1], H.normFac(["CDR FARMS, LLC", "Farmers Co-op Co.", "A & B Grain Inc"][i % 3]));
    assert.equal(py[i][2], H.normKey(["ST. ANSGAR", "Saint Ansgar", "Ft Dodge", "Chippewa Falls"][i % 4]));
  });
  assert.equal(H.normFac("CDR Farms LLC"), H.normFac("CDR FARMS, LLC"));
  assert.equal(H.normKey("St. Ansgar"), H.normKey("SAINT ANSGAR"));
});

test("basis since June: the nearest delivery month on each date, change points only", () => {
  const data = { series: {
    "WI|CDR FARMS, LLC|BLOOMER|corn|ZCN26|JUN26": [{ date: "2026-06-16", cents: -64 }],
    "WI|CDR FARMS, LLC|BLOOMER|corn|ZCU26|JUL26": [{ date: "2026-07-15", cents: -65 }],
    "WI|CDR FARMS LLC|BLOOMER|corn||OCT 01, 2026": [{ date: "2026-09-30", cents: -65 }],
    "WI|CDR FARMS LLC|BLOOMER|corn|ZCZ26|SEP26": [{ date: "2026-09-10", cents: -80 }],
    "WI|CDR FARMS LLC|BLOOMER|soybeans|ZSX26|NOV26": [{ date: "2026-09-10", cents: -70 }],
    "WI|CDR FARMS LLC|CADOTT|corn|ZCZ26|OCT26": [{ date: "2026-10-02", cents: -1 }],
  } };
  const keys = H.keysFor(data, "CDR Farms LLC", ["Bloomer"], "corn");
  assert.equal(keys.length, 4, "another town's board is not this one");
  const s = H.nearestSeries(keys, "2026-10-15");
  // Jun 16: June delivery vs Jul '26. June rolls off Jul 1 and July was not logged
  // until Jul 15: a gap, not June carried on. August has nothing logged until
  // September's -80 on Sep 10; October opens Oct 1.
  const EXPECT = [["2026-06-16", -64, "2026-06", "Jul '26"], ["2026-07-01", "gap", "2026-07", ""],
    ["2026-07-15", -65, "2026-07", "Sep '26"], ["2026-08-01", "gap", "2026-08", ""],
    ["2026-09-10", -80, "2026-09", "Dec '26"], ["2026-10-01", -65, "2026-10", ""]];
  assert.deepEqual(s.map((p) => p.gap ? [p.date, "gap", p.dm, ""] : [p.date, p.cents, p.dm, p.con]), EXPECT);
  // the specifics that matter, stated plainly:
  assert.deepEqual(s[0], { date: "2026-06-16", cents: -64, dm: "2026-06", con: "Jul '26" });
  assert.ok(!s.some((p) => !p.gap && p.date < "2026-07-15" && p.dm === "2026-07"), "no value shown before the day it was logged");
  assert.deepEqual(s[s.length - 1], { date: "2026-10-01", cents: -65, dm: "2026-10", con: "" },
    "a month that opened since the last change takes over on its first day, through the log's last run");
  assert.ok(s.some((p) => p.cents === -80 && p.dm === "2026-09" && p.con === "Dec '26"));
  for (let i = 1; i < s.length; i++) {
    const a = s[i - 1], b = s[i];
    if (a.gap || b.gap) { assert.ok(!(a.gap && b.gap), "one gap, not two in a row"); continue; }
    assert.ok(a.cents !== b.cents || a.dm !== b.dm || a.con !== b.con, "a point only where something changed");
  }
  assert.deepEqual(H.nearestSeries(H.keysFor(data, "Nobody Grain", ["Bloomer"], "corn"), "2026-10-15"), []);
  assert.equal(H.contractOf("NOV 26 SOYBEANS"), "Nov '26");
  assert.equal(H.contractOf("ZCZ6"), "Dec '26");
  assert.equal(H.contractOf(""), "");
});

test("town pages load the history script only from the builder, and the data only on open", () => {
  const src = readFileSync(ROOT + "components/cb-basis-hist.js", "utf8");
  assert.match(src, /box\.addEventListener\('toggle'/);
  assert.match(src, /fetch\('\/data\/basis-sparklines\/' \+ st \+ '\.json'\)/);
  assert.ok(src.indexOf("fetch(") > src.indexOf("function open("), "nothing is fetched until the box is opened");
  const py = readFileSync(ROOT + "scripts/build_cash_bid_pages.py", "utf8");
  assert.match(py, /HIST_JS = '<script src="\/components\/cb-basis-hist\.js\?v=2" defer><\/script>/);
});

// 2026-10-17 audit N5: the box heading names the log's first date, and the
// log leaves out points the bid pages would call a misread (-200c at Primient).
test("the basis log box is headed by its own first date, and misreads are screened out of the log", () => {
  const src = readFileSync(ROOT + "components/cb-basis-hist.js", "utf8");
  assert.match(src, /sum\.textContent = 'Basis since ' \+ dayText\(first\)/);
  assert.doesNotMatch(src, /since June/);
  const py = readFileSync(ROOT + "scripts/build_cash_bid_pages.py", "utf8");
  assert.match(py, /head = "Basis since " \+ since_words\(first\)/);
  assert.doesNotMatch(py, /<summary>Basis since June<\/summary>/);
  const sp = readFileSync(ROOT + "scripts/build_basis_sparklines.py", "utf8");
  assert.match(sp, /from basis_method import relative_outlier/);
  const il = JSON.parse(readFileSync(ROOT + "data/basis-sparklines/IL.json", "utf8"));
  const pri = Object.entries(il.series).filter(([k]) => k.startsWith("IL|PRIMIENT GRAIN|DECATUR|corn|"));
  assert.ok(pri.length > 0);
  for (const [k, pts] of pri) for (const p of pts) assert.notEqual(p.cents, -200, k);
});
