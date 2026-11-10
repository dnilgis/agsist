/* The one elevator name key: scripts/elevator_names.py and its twin
 * components/elev-names.js give the same answer on every case, and no page
 * script or builder grows its own copy again.
 *
 *   node --test test/elev-names.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { execFileSync } from "node:child_process";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");

function load() {
  const ctx = { console };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(read("components/elev-names.js"), ctx);
  ctx.elevNames.setNames(JSON.parse(read("data/elevator-names.json")));
  return ctx.elevNames;
}
const PY = JSON.parse(execFileSync("python3", ["-I", "-c",
  "import sys,json;sys.path.insert(0,sys.argv[1]);import elevator_names as e;print(json.dumps([e.CASES_OP,e.CASES_PLACE,e.CASES_KEY]))",
  ROOT + "scripts"], { encoding: "utf8" }));
const JS_FN = { basis_name: "basisName", fac_key: "facKey", merge_key: "mergeKey", name_key: "nameKey", trade_key: "tradeKey", nice_case: "niceCase" };

test("Python and JS print the same name and place on every case", () => {
  const E = load();
  const [ops, places] = PY;
  assert.ok(ops.length >= 20 && places.length >= 10);
  for (const [a, b] of ops) assert.equal(E.displayName(a), b, `operator ${a}`);
  for (const [a, b] of places) assert.equal(E.cleanPlace(a), b, `place ${a}`);
});

test("Python and JS give the same key on every case", () => {
  const E = load();
  const keys = PY[2];
  assert.ok(keys.length >= 25);
  const fns = new Set();
  for (const [fn, a, b] of keys) {
    assert.ok(JS_FN[fn], `no JS twin for ${fn}`);
    fns.add(fn);
    const got = fn === "trade_key" ? E.tradeKey(...a.split("|")) : E[JS_FN[fn]](a);
    assert.equal(got, b, `${fn}(${JSON.stringify(a)})`);
  }
  assert.deepEqual([...fns].sort(), Object.keys(JS_FN).sort(), "every key has cases");
});

test("the real archived names print and key as the elevator (Fosston, Montevideo, Pettisville)", () => {
  const E = load();
  assert.equal(E.displayName("zFosston Tri-Coop2017"), "Fosston Tri-Coop");
  assert.equal(E.basisName("zFarmers Cooperative Elevator Co.OLD"), "FARMERS COOPERATIVE ELEVATOR CO");
  assert.equal(E.facKey("zFarmers Cooperative Elevator Co.OLD"), E.facKey("FARMERS COOPERATIVE ELEVATOR CO"));
  assert.equal(E.displayName("zOLDPettisville Grain Co."), "Pettisville Grain Co.");
  assert.equal(E.displayName("Zeeland Farm Services"), "Zeeland Farm Services");
  assert.equal(E.displayName("Route 2020"), "Route 2020");
});

/* THE REAL CORPUS. The hand-picked cases above catch the rules someone thought
   of; this runs a fixed sample of ~300 real names and towns (test/fixtures/
   elev-names-real.json, from data/ids/elevators.json) through every key
   function on both sides, so a copy that drifts on a name nobody listed is
   caught by what it does. */
const REAL = JSON.parse(read("test/fixtures/elev-names-real.json")).names;
const REAL_FNS = { display_name: "displayName", archive_clean: "archiveClean", basis_name: "basisName",
  fac_key: "facKey", merge_key: "mergeKey", name_key: "nameKey", nice_case: "niceCase" };

test("Python and JS give the same answer on every real name in the sample, for every key function", () => {
  const E = load();
  assert.ok(REAL.length >= 250, "the sample is about 300 real names");
  const py = JSON.parse(execFileSync("python3", ["-I", "-c",
    "import sys,json;sys.path.insert(0,sys.argv[1]);import elevator_names as e\n" +
    "R=json.load(open(sys.argv[2]))['names'];F=json.loads(sys.argv[3])\n" +
    "print(json.dumps({'fns':{f:[getattr(e,f)(n) for n,_ in R] for f in F}," +
    "'trade':[e.trade_key(n,t) for n,t in R],'place':[e.clean_place(t) for _,t in R]," +
    "'nice_place':[e.nice_case(t) for _,t in R]}))",
    ROOT + "scripts", ROOT + "test/fixtures/elev-names-real.json", JSON.stringify(Object.keys(REAL_FNS))],
    { encoding: "utf8", maxBuffer: 32 << 20 }));
  const bad = [];
  for (const [fn, js] of Object.entries(REAL_FNS)) {
    assert.equal(typeof E[js], "function", `no JS twin ${js}`);
    REAL.forEach(([n], i) => { const g = E[js](n); if (g !== py.fns[fn][i]) bad.push(`${fn}(${JSON.stringify(n)}): py ${JSON.stringify(py.fns[fn][i])}, js ${JSON.stringify(g)}`); });
  }
  REAL.forEach(([n, t], i) => {
    const g = E.tradeKey(n, t);
    if (g !== py.trade[i]) bad.push(`trade_key(${JSON.stringify(n)}, ${JSON.stringify(t)}): py ${JSON.stringify(py.trade[i])}, js ${JSON.stringify(g)}`);
    const c = E.cleanPlace(t);
    if (c !== py.place[i]) bad.push(`clean_place(${JSON.stringify(t)}): py ${JSON.stringify(py.place[i])}, js ${JSON.stringify(c)}`);
    const k = E.niceCase(t);
    if (k !== py.nice_place[i]) bad.push(`nice_case(${JSON.stringify(t)}): py ${JSON.stringify(py.nice_place[i])}, js ${JSON.stringify(k)}`);
  });
  assert.deepEqual(bad, []);
});

/* The copies the drift came from: each rule's own words, anywhere but the two twins. */
const OWN = [
  [/FAC_TAIL\s*=/, "a facility tail list"],
  [/LEGAL(?:_SUFFIX)?\s*=\s*\{\s*["']?llc/i, "a legal-suffix list"],
  [/OP_ARCHIVED|_ARCH_HEAD|\^z\(\?=\[A-Z\]\)/, "the archived-name rule"],
  [/OP_NOISE\s*=/, "the trade-word list"],
  [/OP_HEAD\s*=/, "the page-title rule"],
  [/_LEGAL_TAIL\s*=/, "the legal-tail rule"],
];
const TWINS = new Set(["components/elev-names.js", "scripts/elevator_names.py"]);

test("no page script or builder keeps its own copy of the name rules", () => {
  const bad = [];
  for (const dir of ["components", "scripts"]) {
    for (const f of readdirSync(ROOT + dir)) {
      if (!/\.(js|py)$/.test(f)) continue;
      const p = `${dir}/${f}`;
      if (TWINS.has(p)) continue;
      const src = read(p);
      for (const [re, what] of OWN) if (re.test(src)) bad.push(`${p}: ${what}`);
    }
  }
  assert.deepEqual(bad, []);
});

test("every site that cleans or matches a name uses the shared key", () => {
  const uses = {
    "components/bids-homepage.js": /elevNames\.mergeKey/,
    "components/cb-basis-hist.js": /elevNames\.facKey/,
    "components/homepage-extras.js": /elevNames\.facKey/,
    "components/cash-bids.js": /elevNames\.basisName/,
    "components/cb-myelev.js": /elevNames\.basisName\(fc\[0\]\)[\s\S]*elevNames\.basisName\(p\.operator\)/,
    "components/cb-rank.js": /elevNames/,
    "components/list-elevator.js": /\.niceCase\(/,
    "scripts/basis_method.py": /from elevator_names import name_key/,
    "scripts/build_cash_bid_pages.py": /from elevator_names import fac_key, trade_key/,
    "scripts/build_ids.py": /from elevator_names import trade_key/,
    "scripts/fetch_bids.py": /from elevator_names import merge_key/,
    "scripts/local_bid.py": /from elevator_names import merge_key/,
    "scripts/build_basis_join.py": /from elevator_names import basis_name/,
    "scripts/build_basis_history.py": /from elevator_names import archive_clean_upper, basis_name/,
    "scripts/build_basis_sparklines.py": /clean_facility/,
  };
  for (const [p, re] of Object.entries(uses)) assert.match(read(p), re, p);
  /* and each page that runs them loads the twin first */
  for (const [page, after] of [["index.html", "bids-homepage.js"], ["cash-bids.html", "cb-myelev.js"], ["list-your-elevator.html", "list-elevator.js"]]) {
    const h = read(page), i = h.indexOf("/components/elev-names.js?v="), j = h.indexOf("/components/" + after);
    assert.ok(i > 0 && j > i, `${page} loads elev-names.js before ${after}`);
  }
  assert.match(read("scripts/build_cash_bid_pages.py"), /HIST_JS = '<script src="\/components\/elev-names\.js\?v=2" defer><\/script><script src="\/components\/cb-basis-hist\.js/);
});
