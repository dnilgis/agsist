/* The homepage store-or-sell options take the earliest delivery tier in the nearest month.
 *
 * Nov 2, 2026 audit (Sig's rule: spot/cash, FH and the whole month are one tier; LH, or a
 * day range inside one month starting on the 11th or later, ranks after). Lincolnway Energy,
 * Nevada IA, posted corn "FH Nov 2026" $4.17 (-30c) and "LH Nov 2026" $4.22 (-25c), both
 * filed under Nov. components/bids-homepage.js storeOptions kept the higher one, so the
 * last half (later delivery) stood in as "now" in the store-or-sell box.
 *
 * The shipped file runs in a vm with the clock set to Nov 2, 2026; the tier patterns are
 * also held to scripts/build_cash_bid_pages.py period_rank on the same labels.
 *
 *   node --test test/home-store-tier.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (f) => readFileSync(ROOT + f, "utf8");

function load(nowIso) {
  const T = Date.parse(nowIso);
  class FixedDate extends Date {
    constructor(...a) { if (a.length) super(...a); else super(T); }
    static now() { return T; }
  }
  const noop = () => {};
  const el = () => ({ style: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false }, setAttribute: noop,
    appendChild: noop, addEventListener: noop, querySelector: () => null, querySelectorAll: () => [] });
  const document = { readyState: "complete", getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    createElement: el, addEventListener: noop, head: el(), body: el(), documentElement: el() };
  const window = { document, addEventListener: noop, removeEventListener: noop, dispatchEvent: noop,
    location: { search: "", hostname: "x", pathname: "/" }, navigator: {}, localStorage: { getItem: () => null, setItem: noop } };
  window.window = window;
  const ctx = vm.createContext({ window, document, navigator: {}, location: window.location, localStorage: window.localStorage,
    setTimeout, clearTimeout, console, Date: FixedDate, Intl, CustomEvent: function () {}, fetch: () => Promise.reject(new Error("offline")) });
  vm.runInContext(read("components/util.js"), ctx);
  vm.runInContext(read("components/elev-names.js"), ctx);   // the page loads it before bids-homepage.js
  vm.runInContext(read("components/bids-homepage.js"), ctx);
  return window.__agsistHomeBidsInternals;
}

// a network row as fromNetwork() hands it on (bids-homepage.js), real values from Nov 2
const row = (delivery, period, cash, basis) => ({
  facility: "Lincolnway Energy", branch: "", city: "Nevada", town: "Nevada", state: "IA", distance: 8,
  phone: "", commodity: "Corn", cashPrice: cash, basis, deliveryMonth: delivery, delivery, checkedAt: null,
  pricedAt: "2026-11-02T19:31:38Z", netCrop: "corn", place: "Lincolnway Energy||Nevada|IA", sourceId: "",
  deliveryStart: period, category: "corn", source: "network", currency: "USD", bestCash: null, bestPeriod: "", lat: 42.02, lon: -93.45,
});
const FH = row("FH Nov 2026", "2026-11", 4.17, -0.30);
const LH = row("LH Nov 2026", "2026-11", 4.22, -0.25);
const DEC = row("Dec 2026", "2026-12", 4.30, -0.25);

test("Nevada IA: FH Nov $4.17 is now, not LH Nov $4.22, whatever order the rows come in", () => {
  const H = load("2026-11-02T18:00:00Z");
  for (const bids of [[FH, LH, DEC], [LH, FH, DEC], [DEC, LH, FH]]) {
    const o = H.storeOptions(bids, null).filter((x) => x.crop === "corn");
    assert.equal(o.length, 1, "one option per elevator and crop");
    assert.equal(o[0].cash, 4.17, "the first half is today's price");
    assert.equal(o[0].monthKey, "2026-11");
    assert.equal(o[0].tier, 0);
    const lh = o[0].periods.find((p) => p.label === "LH Nov 2026");
    assert.ok(lh && lh.period === "2026-11", "the periods carry the label and period for the tier");
  }
});

test("an LH bid alone in the nearest month is still the option (nothing earlier posted)", () => {
  const H = load("2026-11-02T18:00:00Z");
  const o = H.storeOptions([LH, DEC], null).filter((x) => x.crop === "corn");
  assert.equal(o[0].cash, 4.22);
  assert.equal(o[0].tier, 1);
});

test("inside one tier the higher bid still wins", () => {
  const H = load("2026-11-02T18:00:00Z");
  const o = H.storeOptions([FH, row("Nov 2026", "2026-11", 4.19, -0.28), LH], null).filter((x) => x.crop === "corn");
  assert.equal(o[0].cash, 4.19, "FH and the whole month are one tier");
});

// real labels from the bids snapshot of Nov 2, 2026 (printed and raw), plus the printed form of a late range
const LABELS = [
  ["FH Nov 2026", "2026-11"], ["LH Nov 2026", "2026-11"], ["Nov 26 - LH", "2026-11"], ["LH Nov '26 (2026-12)", "2026-11"],
  ["November 2026 Second Half", "2026-11"], ["Nov 2026 Second Half", "2026-11"], ["November 2026 First Half", "2026-11"],
  ["14% Pro Dlvd LOGAN LH Nov-Dec", "2026-11/2026-12"], ["Oct 2H 26 (17 Oct 2026 to 31 Oct 2026)", "2026-10"],
  ["16 Nov 2026 to 30 Nov 2026", "2026-11"], ["Nov 16-30, 2026", "2026-11"], ["Nov 16-30", "2026-11"], ["Oct 20-31, 2026", "2026-10"],
  ["02 Nov 2026 to 30 Nov 2026", "2026-11"], ["Nov 2-30, 2026", "2026-11"], ["Nov 1-15", "2026-11"], ["Dec 1-5 2026", "2026-12"],
  ["28 Oct 2026 to 30 Nov 2026", "2026-10/2026-11"], ["Fall 26 (16 Sep 2026 to 30 Nov 2026)", "2026-09/2026-11"],
  ["NOV 2026 (01 Nov 2026 to 30 Nov 2026)", "2026-11"], ["CASH", "spot"], ["Dec 2026", "2026-12"], ["11/01/2026", "2026-11"],
];

test("the homepage tier agrees with the cash bid pages' period_rank on every real label", () => {
  const H = load("2026-11-02T18:00:00Z");
  const py = JSON.parse(execFileSync("python3", ["-c",
    "import json,sys; sys.path.insert(0, sys.argv[1]); import build_cash_bid_pages as B; " +
    "print(json.dumps([B.period_rank({'label': l, 'period': p}) for l, p in json.loads(sys.argv[2])]))",
    ROOT + "scripts", JSON.stringify(LABELS)], { encoding: "utf8" }));
  const js = LABELS.map(([l, p]) => H.periodRank(l, p));
  assert.deepEqual(js, py);
  assert.deepEqual(js.slice(0, 3), [0, 1, 1]);
  assert.equal(js[LABELS.findIndex((x) => x[0] === "Nov 16-30, 2026")], 1, "the printed late range ranks after");
});
