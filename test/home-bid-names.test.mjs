/* Nov 9: the homepage cash bid card prints elevator names clean. data/bids.json carries archived copies with the
 * source system's marks ("zShawnee Feed Old", "zWest-Con") and a page title tail ("... - Cash Bid Include");
 * the card (components/bids-homepage.js) prints them through the one name cleaner, elevNames.displayName
 * (components/elev-names.js), the same one /cash-bids uses.   node --test test/home-bid-names.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (f) => readFileSync(ROOT + f, "utf8");
const elevNames = createRequire(import.meta.url)(ROOT + "components/elev-names.js");

function load(extra = {}) {
  const noop = () => {};
  const el = () => ({ style: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false }, setAttribute: noop,
    appendChild: noop, addEventListener: noop, querySelector: () => null, querySelectorAll: () => [] });
  const document = { readyState: "complete", getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    createElement: el, addEventListener: noop, head: el(), body: el(), documentElement: el() };
  const window = { document, addEventListener: noop, removeEventListener: noop, dispatchEvent: noop,
    location: { search: "", hostname: "x", pathname: "/" }, navigator: {}, localStorage: { getItem: () => null, setItem: noop }, ...extra };
  window.window = window;
  const ctx = vm.createContext({ window, document, navigator: {}, location: window.location, localStorage: window.localStorage,
    setTimeout, clearTimeout, console, Date, Intl, CustomEvent: function () {}, fetch: () => Promise.reject(new Error("offline")) });
  vm.runInContext(read("components/util.js"), ctx);
  if (!extra.elevNames) vm.runInContext(read("components/elev-names.js"), ctx);   // index.html loads it before the card
  ctx.AG = window.AG;   // the page reads AG as a global, as a browser does
  vm.runInContext(read("components/bids-homepage.js"), ctx);
  return window.__agsistHomeBidsInternals;
}

// the real raw rows, read from the data the card is fed
const BIDS = JSON.parse(read("data/bids.json")).bids;
const rawRow = (name) => {
  const r = BIDS.find((b) => b.facility === name);
  assert.ok(r, name + " is in data/bids.json");
  return r;
};

test("a real archived board from data/bids.json prints clean on the homepage card", () => {
  const H = load();
  for (const [raw, clean] of [["zShawnee Feed Old", "Shawnee Feed"], ["zWest-Con", "West-Con"],
    ["American Plains Co-op - Cash Bid Include", "American Plains Co-op"]]) {
    const r = { ...rawRow(raw), category: "corn" };
    const elev = H.groupByElevator([r])[0];
    assert.equal(elev.facility, raw, "the grouped board keeps its raw name (keys and alert ids use it)");
    const html = H.renderElevatorHTML(elev, "corn", false, [], false, "");
    const shown = html.match(/<span class="bh-name">([^<]*)<\/span>/);
    assert.ok(shown, "the card has a name");
    assert.equal(shown[1], clean.replace(/&/g, "&amp;"), raw);
    assert.doesNotMatch(html, /<span class="bh-name">z[A-Z]|Old<\/span>|Cash Bid Include/i, raw);
    assert.equal(H.displayName(raw), elevNames.displayName(raw), "same answer as the shared name cleaner for " + raw);
  }
});

test("the card's names agree with elevNames.displayName on every facility name in data/bids.json", () => {
  const H = load();
  const names = [...new Set(BIDS.map((b) => b.facility).filter(Boolean))];
  assert.ok(names.length > 50, "names checked: " + names.length);
  for (const n of names) assert.equal(H.displayName(n), elevNames.displayName(n), n);
});

test("the card keeps no name rules of its own: it calls elevNames, loaded before it on the home page", () => {
  const src = read("components/bids-homepage.js");
  for (const k of ["OP_HEAD", "OP_TAIL", "OP_ARCHIVED"]) assert.ok(!src.includes("var " + k), k + " is not copied into the card");
  const H = load({ elevNames: { displayName: (n) => "EXACT:" + n } });
  assert.equal(H.displayName("zShawnee Feed Old"), "EXACT:zShawnee Feed Old", "the shared function is what prints");
  const page = read("index.html");
  assert.ok(page.indexOf("/components/elev-names.js?v=") > -1 && page.indexOf("/components/elev-names.js?v=") < page.indexOf("/components/bids-homepage.js?v=50\""), "elev-names.js loads before the card");
});
