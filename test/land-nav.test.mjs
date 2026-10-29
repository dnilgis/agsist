/* Land sales easy to find (Sig, Oct 29, 2026: "the farmland sale page should be easy to find").
 *
 * Every link into /land-sales/ from the Atlas county homes, the rent pages, the cash bid town
 * pages, Fast Facts' place row and the hub's own jump row must land on a file in this checkout
 * (and an anchor that is on that page). Atlas county homes in a state without sales on the site
 * say the state's status from data/land-sales/coverage.json and link the source table, never a
 * county page that does not exist.
 *
 *   node --test test/land-nav.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const rd = (p) => readFileSync(ROOT + p, "utf8");
const cov = JSON.parse(rd("data/land-sales/coverage.json"));
const COV = Object.fromEntries(cov.states.map((r) => [r.name, r]));
const LIVE = { illinois: "IL", wisconsin: "WI", indiana: "IN", vermont: "VT" };

/* '/land-sales/x/y#z' -> true when the file exists and, with a #z, the page carries id="z" */
const ids = {};
function resolves(href) {
  const [path, hash] = href.split("#");
  const rel = path.replace(/^\//, "");
  const f = rel === "" ? "index.html" : rel.endsWith("/") ? rel + "index.html" : rel + ".html";
  if (!existsSync(ROOT + f)) return false;
  if (!hash) return true;
  ids[f] ??= new Set([...rd(f).matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  return ids[f].has(hash);
}
const hrefs = (html) => [...html.matchAll(/href="(\/land-sales\/[^"]*)"/g)].map((m) => m[1]);

test("every Atlas county home has one land sales line, to a real county page or the state's status", () => {
  let county = 0, state = 0;
  for (const st of readdirSync(ROOT + "farmland-atlas")) {
    const dir = "farmland-atlas/" + st;
    if (!statSync(ROOT + dir).isDirectory() || st === "data") continue;
    for (const f of readdirSync(ROOT + dir)) {
      if (!f.endsWith(".html") || f === "index.html") continue;
      const html = rd(dir + "/" + f);
      if (!/<h2 id="c-land">/.test(html)) continue;
      const doors = [...html.matchAll(/<p class="note" data-ls-door="(county|state)">(.*?)<\/p>/g)];
      assert.equal(doors.length, 1, `${dir}/${f}: one land sales line`);
      const [, kind, body] = doors[0];
      for (const h of hrefs(body)) assert.ok(resolves(h), `${dir}/${f}: ${h} resolves`);
      if (kind === "county") {
        county++;
        assert.ok(LIVE[st], `${dir}/${f}: a county sales link only in a state with sales`);
        assert.equal(hrefs(body)[0], `/land-sales/${st}/${f.slice(0, -5)}`, `${dir}/${f}: its own county`);
        assert.match(body, />Recorded sales in [^<]+<\/a>/);
      } else {
        state++;
        assert.deepEqual(hrefs(body), ["/land-sales/#coverage"], `${dir}/${f}: the source table, no county page`);
        const name = (html.match(/<a href="\/farmland-atlas\/[a-z-]+\/">All ([^<]+) counties<\/a>/) || [])[1];
        const row = COV[name];
        if (row && row.status === "unchecked") assert.match(body, /not checked yet/, `${dir}/${f}`);
        if (row && row.status === "nondisclosure") assert.match(body, /public record|public file/, `${dir}/${f}`);
        if (row && row.status === "county") assert.match(body, /county by county; not on this site yet/, `${dir}/${f}`);
        if (row && row.status === "request") assert.match(body, /on request or for a fee/, `${dir}/${f}`);
        assert.ok(!(row && LIVE[st]), `${dir}/${f}: a state with sales links the county`);
      }
    }
  }
  assert.ok(county >= 260, "county links: " + county);
  assert.ok(state >= 2800, "state lines: " + state);
});

test("rent pages: every land sales link resolves, and the three states with sales link their counties", () => {
  for (const f of readdirSync(ROOT + "rent")) {
    if (!f.endsWith(".html")) continue;
    const html = rd("rent/" + f);
    for (const h of hrefs(html)) assert.ok(resolves(h), `rent/${f}: ${h}`);
    const st = f.slice(0, -5);
    if (LIVE[st]) {
      assert.ok(html.includes(`href="/land-sales/#${st}"`), `rent/${f}: the state's land sales line`);
      // Vermont has 14 counties (13 in the rent table): every row links; the bigger states keep 60 or more
      const need = st === "vermont" ? (html.match(/<tr><td/g) || []).length : 60;
      assert.ok(need > 0 && (html.match(/class="rs-ls"/g) || []).length >= need, `rent/${f}: county sales links`);
    } else assert.equal(hrefs(html).length, 0, `rent/${f}: no land sales link without sales`);
  }
});

test("cash bid town pages: every land sales link resolves", () => {
  for (const st of readdirSync(ROOT + "cash-bids")) {
    const dir = "cash-bids/" + st;
    if (!statSync(ROOT + dir).isDirectory()) continue;
    for (const f of readdirSync(ROOT + dir)) {
      if (!f.endsWith(".html")) continue;
      for (const h of hrefs(rd(dir + "/" + f))) assert.ok(resolves(h), `${dir}/${f}: ${h}`);
    }
  }
  // the builder adds the link only where the county's page is on disk (its selftest checks both cases)
  assert.match(rd("scripts/build_cash_bid_pages.py"), /\(f"land-sales\/\{ssl\}\/\{slug\}\.html", f"\/land-sales\/\{ssl\}\/\{slug\}", "land sales near here"\)/);
});

test("Fast Facts place row: flag l exactly where the county's land sales page is on disk", () => {
  for (const [slug, ST] of Object.entries(LIVE)) {
    const pct = JSON.parse(rd(`data/atlas/pct/${ST}.json`));
    for (const [fips, c] of Object.entries(pct.counties)) {
      const has = existsSync(ROOT + `land-sales/${slug}/${c.s}.html`);
      assert.equal((c.k || "").includes("l"), has, `${ST} ${fips} ${c.s}`);
    }
  }
  const other = JSON.parse(rd("data/atlas/pct/IA.json"));
  assert.ok(Object.values(other.counties).every((c) => !(c.k || "").includes("l")), "no flag without a page");
});

test("the hub: a jump row to every state list and the source table, and the saved-place line", () => {
  const html = rd("land-sales/index.html");
  const row = (html.match(/<p class="ls-jump">(.*?)<\/p>/) || [])[1];
  assert.ok(row, "jump row");
  const jumps = [...row.matchAll(/href="(#[a-z-]+)"/g)].map((m) => m[1]);
  assert.deepEqual(jumps, ["#illinois", "#wisconsin", "#indiana", "#vermont", "#coverage"]);
  for (const j of jumps) assert.ok(resolves("/land-sales/" + j), j);
  assert.ok(html.indexOf('class="ls-jump"') < html.indexOf('<h2 id="illinois">'), "near the top");
  assert.match(html, /<p class="ls-mine" id="ls-mine" hidden><\/p>/);
  assert.ok(!/—/.test(row), "no em dash");
});
