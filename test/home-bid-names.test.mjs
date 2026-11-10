/* Nov 9: the homepage cash bid card prints elevator names clean. data/bids.json carries archived copies with the
 * source system's marks ("zShawnee Feed Old", "zWest-Con") and a page title tail ("... - Cash Bid Include");
 * /cash-bids cleans them with cbRank.displayName (components/cb-rank.js) and the card (components/bids-homepage.js)
 * now does the same.   node --test test/home-bid-names.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (f) => readFileSync(ROOT + f, "utf8");
const cbRank = createRequire(import.meta.url)(ROOT + "components/cb-rank.js");

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
    assert.equal(H.displayName(raw), cbRank.displayName(raw), "same answer as /cash-bids for " + raw);
  }
});

test("the card's name rule agrees with cbRank.displayName on every facility name in data/bids.json", () => {
  const H = load();
  const names = [...new Set(BIDS.map((b) => b.facility).filter(Boolean))];
  assert.ok(names.length > 50, "names checked: " + names.length);
  for (const n of names) assert.equal(H.displayName(n), cbRank.displayName(n), n);
});

test("the mirrored rules are the same three regexes as cb-rank.js, and cbRank is used when the page has it", () => {
  const src = read("components/bids-homepage.js"), cb = read("components/cb-rank.js");
  for (const k of ["OP_HEAD", "OP_TAIL", "OP_ARCHIVED"]) {
    const re = new RegExp("var " + k + "\\s*=\\s*(/.+?/[gimsuy]*);");
    assert.equal(src.match(re)?.[1], cb.match(re)?.[1], k + " drifted from cb-rank.js");
  }
  const H = load({ cbRank: { displayName: (n) => "EXACT:" + n } });
  assert.equal(H.displayName("zShawnee Feed Old"), "EXACT:zShawnee Feed Old", "the shared function wins when loaded");
  assert.match(read("index.html"), /\/components\/bids-homepage\.js\?v=48"/);
});
