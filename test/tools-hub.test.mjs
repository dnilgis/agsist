/* /tools, from the Oct 15 review: the groups and cards run in order of what
 * people open (data/site-usage.json, 90-day page views), "Sell now or store?"
 * has a card, and nothing on a card calls delayed or hours-old prices live. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const html = readFileSync(join(ROOT, "tools.html"), "utf8");

function groups() {
  const out = [];
  const re = /<div class="cat-label">([^<]+)<\/div>\s*<div class="tools-grid">([\s\S]*?)\n    <\/div>/g;
  let m;
  while ((m = re.exec(html))) out.push({ label: m[1], hrefs: [...m[2].matchAll(/<a href="([^"]+)" class="tool-card"[^>]*>/g)].map((x) => x[1]) });
  return out;
}

test("tools hub has a Sell now or store? card", () => {
  assert.ok(groups().some((g) => g.hrefs.includes("/store-or-sell")));
  assert.match(html, /<div class="name">Sell now or store\?<\/div>/);
});

test("tool groups and the cards in each run by 90-day views, new pages last", () => {
  // Pinned to the Oct 10, 2026 usage file, so a data refresh never fails the
  // build; re-sort by hand when the numbers move a lot. Views then: money
  // 9,872 (cash bids 9,493), crop tracking 3,100, markets 2,114 without the
  // homepage, reference 1,773, spray and fertilizer 1,200, bins 422.
  assert.deepEqual(groups().map((g) => g.hrefs), [
    ["/cash-bids", "/breakeven", "/arc-plc", "/prf", "/store-or-sell", "/lrp", "/commodity-loan"],
    ["/hail-map", "/gdu-calculator", "/field-scout", "/planting-date"],
    ["/usda-calendar", "/tariffs", "/", "/hay-prices", "/cattle-auction-prices"],
    ["/usda-quick-stats", "/yield-estimator", "/fast-facts", "/data-sources"],
    ["/spray", "/fertilizer", "/urea", "/manure-value", "/nutrient-removal", "/fall-nitrogen"],
    ["/grain-bin-calculator", "/grain-emc", "/grain-shrink", "/combine-loss", "/harvest-or-wait"],
  ]);
});

test("no tool card calls delayed futures or posted bids live", () => {
  const cards = [...html.matchAll(/<a href="[^"]+" class="tool-card"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => m[1]).join("\n");
  assert.ok(!/\bLive\b/i.test(cards), "a card still says live");
  assert.match(cards, /each with how long ago it was posted/);
});

test("in Oct and Nov the grain storage group moves ahead of crop tracking on the page", async () => {
  const m = html.match(/<script>\(function\(\)\{var m=new Date\(\)\.getMonth\(\);if\(m!==9&&m!==10\)return;[\s\S]*?<\/script>/);
  assert.ok(m, "the seasonal reorder script is on the page");
  // run it against the page's own groups with the clock on Oct 16 and Jul 16
  const vm = await import("node:vm");
  for (const [iso, want] of [["2026-10-16T15:00:00Z", ["Selling, costs and programs", "Grain storage", "Crop tracking"]], ["2026-07-16T15:00:00Z", ["Selling, costs and programs", "Crop tracking"]]]) {
    const labels = groups().map((g) => ({ textContent: g.label, grid: { label: g.label } }));
    const order = [];
    labels.forEach((l) => order.push(l, l.grid));
    const parent = { insertBefore(a, b) { order.splice(order.indexOf(a), 1); order.splice(order.indexOf(b), 0, a); } };
    labels.forEach((l) => { l.parentNode = parent; Object.defineProperty(l, "nextElementSibling", { get: () => order[order.indexOf(l) + 1] }); });
    const T = Date.parse(iso);
    class D extends Date { constructor(...a) { super(...(a.length ? a : [T])); } }
    vm.runInNewContext(m[0].replace(/^<script>|<\/script>$/g, ""), { Date: D, document: { querySelectorAll: () => labels } });
    const seq = order.filter((x) => x.textContent).map((x) => x.textContent);
    assert.deepEqual(seq.slice(0, want.length), want, iso);
    assert.equal(order.length, labels.length * 2);
    for (const l of labels) assert.equal(order[order.indexOf(l) + 1], l.grid, "each label keeps its grid");
  }
});

/* Oct 16 benchmark: phone cards showed only a name and a tag; the GDU card
 * still said Wisconsin normals; fertilizer cards said "dealer" where the
 * prices come from co-ops; Pod counts and Rain by county were missing from
 * the page body. */
test("every card has one short phone line, and phones show it", () => {
  const cards = [...html.matchAll(/<a href="([^"]+)" class="tool-card"[^>]*>([\s\S]*?)<\/a>/g)];
  assert.ok(cards.length >= 29);
  for (const [, href, body] of cards) {
    const m = body.match(/<div class="short">([^<]+)<\/div>/);
    assert.ok(m, `${href} has a short line`);
    assert.ok(m[1].length <= 30, `${href} short line fits a phone card: ${m[1]}`);
    assert.ok(body.indexOf('class="name"') < body.indexOf('class="short"'), `${href}: short line under the name`);
  }
  const phone = html.match(/@media \(max-width: 600px\) \{([\s\S]*?)\n    \}/)[1];
  assert.match(phone, /\.tool-card \.short \{ display: block;/);
  assert.match(html, /\.tool-card \.short \{ display: none; \}/, "wide screens keep the full description instead");
});

test("card text matches the pages it links", () => {
  const card = (href) => html.match(new RegExp(`<a href="${href}" class="tool-card"[^>]*>([\\s\\S]*?)</a>`))[1];
  assert.ok(!/Wisconsin/.test(card("/gdu-calculator")), "GDU card no longer says Wisconsin normals");
  assert.match(card("/gdu-calculator"), /1991-2020 normal/);
  for (const h of ["/fertilizer", "/manure-value", "/nutrient-removal"]) {
    assert.ok(!/dealer/i.test(card(h)), `${h} card says co-op, not dealer`);
    assert.match(card(h), /co-op posted/i, h);
  }
  assert.ok(!html.includes("—") && !html.includes("&mdash;"), "no em dashes");
});

test("Pod counts and Rain by county are in the page body", () => {
  const body = html.slice(html.indexOf('<main'), html.indexOf('<div id="site-footer">'));
  assert.ok(body.includes('href="/pod-counts"'), "pod counts");
  assert.ok(body.includes('href="/rain"'), "rain by county");
});

/* Oct 16, to 50: a find box and task chips, a Your state box built from the
 * folders on disk, a byline, a not-covered note and a CollectionPage list. */
const script = () => html.match(/<script>\/\* Find box[\s\S]*?<\/script>/)[0];

test("every card and every Everything-else link carries known task tags", () => {
  const keys = [...html.matchAll(/<button type="button" data-k="(\w*)"/g)].map((m) => m[1]);
  assert.deepEqual(keys, ["", "sell", "harvest", "inputs", "field", "ins", "stock", "land"]);
  const tagged = [...html.matchAll(/<a (?:href="[^"]+" class="tool-card"|class="tool-more-item" href="[^"]+") data-t="([^"]*)"/g)];
  const all = [...html.matchAll(/class="tool-card"|class="tool-more-item"/g)];
  assert.equal(tagged.length, all.length, "no card without data-t");
  for (const [, t] of tagged) for (const k of t.split(" ").filter(Boolean)) assert.ok(keys.includes(k), k);
  for (const k of keys.filter(Boolean)) assert.ok(tagged.filter(([, t]) => t.split(" ").includes(k)).length >= 4, `${k} chip shows at least 4 tools`);
});

const SLUG = { AL: "alabama", AK: "alaska", AZ: "arizona", AR: "arkansas", CA: "california", CO: "colorado", CT: "connecticut", DE: "delaware", FL: "florida", GA: "georgia", HI: "hawaii", ID: "idaho", IL: "illinois", IN: "indiana", IA: "iowa", KS: "kansas", KY: "kentucky", LA: "louisiana", ME: "maine", MD: "maryland", MA: "massachusetts", MI: "michigan", MN: "minnesota", MS: "mississippi", MO: "missouri", MT: "montana", NE: "nebraska", NV: "nevada", NH: "new-hampshire", NJ: "new-jersey", NM: "new-mexico", NY: "new-york", NC: "north-carolina", ND: "north-dakota", OH: "ohio", OK: "oklahoma", OR: "oregon", PA: "pennsylvania", RI: "rhode-island", SC: "south-carolina", SD: "south-dakota", TN: "tennessee", TX: "texas", UT: "utah", VT: "vermont", VA: "virginia", WA: "washington", WV: "west-virginia", WI: "wisconsin", WY: "wyoming" };

test("Your state links only to state pages that exist, and to every one that does", async () => {
  const { existsSync } = await import("node:fs");
  const vm = await import("node:vm");
  // run the page's own has() and table
  const src = script();
  const table = src.match(/var S=\[([\s\S]*?)\]\];/)[0];
  const has = src.match(/function has\(list,c\)\{[^\n]*\}/)[0];
  const ctx = {};
  vm.runInNewContext(table + has + ";this.S=S;this.has=has;", ctx);
  assert.equal(ctx.S.length, 8);
  for (const [label, pat, list] of ctx.S) {
    for (const [code, slug] of Object.entries(SLUG)) {
      const p = pat.replace("%", slug);
      const file = join(ROOT, p.endsWith("/") ? p + "index.html" : p + ".html");
      assert.equal(ctx.has(list, code), existsSync(file), `${label} ${code}: table says ${ctx.has(list, code)}, disk says ${existsSync(file)}`);
    }
  }
  // the state names in the page match the slug table
  for (const [code, slug] of Object.entries(SLUG)) assert.ok(src.includes(`${code}:'`), code);
});

test("find box and chips filter the cards, hide empty groups, and say when nothing matches", () => {
  const src = script();
  assert.match(html, /<input id="tf-q" type="search"/);
  assert.match(html, /<label for="tf-q"/);
  assert.match(html, /id="tf-none" class="tf-none" hidden>No tool on this page matches\./);
  assert.match(src, /g\.hidden=!any/, "a group with no shown card is hidden");
  assert.match(src, /none\.hidden=shown>0/);
  assert.match(src, /'#t='\+k/, "a chip makes a shareable #t= link");
  // county links are shown only after the county page answers
  assert.match(src, /method:'HEAD'\}\)\.then\(function\(x\)\{if\(x\.ok/);
  // the saved location is only read, never written, by this page
  assert.ok(!/setItem\('agsist-wx-loc'/.test(src));
});

test("byline, not-covered note and structured data", () => {
  assert.match(html, /By <a href="\/about">Sigurd Lindquist, Certified Crop Adviser \(CCA\)<\/a>/);
  assert.match(html, /id="not-here">Not on this site yet</);
  assert.match(html, /No irrigation scheduling tools\./);
  const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  const page = ld["@graph"].find((x) => x["@type"] === "CollectionPage");
  assert.ok(page, "CollectionPage");
  assert.equal(page.author.name, "Sigurd Lindquist");
  const cards = [...html.matchAll(/<a href="([^"]+)" class="tool-card"/g)].map((m) => "https://agsist.com" + m[1]);
  assert.deepEqual(page.mainEntity.itemListElement.map((i) => i.url), cards, "ItemList matches the cards in order");
  assert.equal(page.mainEntity.numberOfItems, cards.length);
});

test("page stays light: no new outside script, under 55 KB", () => {
  assert.ok(Buffer.byteLength(html) < 55000, `${Buffer.byteLength(html)} bytes`);
  const srcs = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(srcs, ["/components/util.js?v=17", "/components/loader.js?v=19"]);
});
