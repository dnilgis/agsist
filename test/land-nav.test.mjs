/* Land sales easy to find (Oct 29, 2026).
 *
 * Every link into /land-sales/ from the Atlas county homes, the rent pages, the cash bid town
 * pages, Fast Facts' place row and the hub's own jump row must land on a file in this checkout
 * (and an anchor that is on that page). Atlas county homes in a state without sales on the site
 * print no land sales line and no research status (Nov 8, 2026); a county without a sale in a
 * state with sales gets one neutral line to the farm sales page; never a county page that does not exist.
 *
 *   node --test test/land-nav.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const rd = (p) => readFileSync(ROOT + p, "utf8");
const LIVE = { illinois: "IL", wisconsin: "WI", indiana: "IN", vermont: "VT", "new-jersey": "NJ", florida: "FL" };

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

const PHRASES = /not checked yet|on request or for a fee|commonly listed|public record|public file|county by county; not on this site yet|sales are on file|Where each state stands|#coverage/i;
const NEUTRAL = /^Farm sales by county: see the <a href="\/land-sales\/">farm sales page<\/a>\.$/;

test("every Atlas county home: a county sales link, one neutral line in a state with sales, nothing elsewhere", () => {
  let county = 0, neutral = 0, none = 0, stale = 0;
  for (const st of readdirSync(ROOT + "farmland-atlas")) {
    const dir = "farmland-atlas/" + st;
    if (!statSync(ROOT + dir).isDirectory() || st === "data") continue;
    for (const f of readdirSync(ROOT + dir)) {
      if (!f.endsWith(".html") || f === "index.html") continue;
      const html = rd(dir + "/" + f);
      if (!/<h2 id="c-land">/.test(html)) continue;
      const doors = [...html.matchAll(/<p class="note" data-ls-door="(county|state)">(.*?)<\/p>/g)];
      assert.ok(doors.length <= 1, `${dir}/${f}: at most one land sales line`);
      if (!doors.length) { none++; continue; }
      const [, kind, body] = doors[0];
      // the county pages are built on main, so a page may still be the build before this change; the
      // fixture test below holds the builder itself to the new words
      if (kind === "state" && /#coverage/.test(body)) { stale++; continue; }
      for (const h of hrefs(body)) assert.ok(resolves(h), `${dir}/${f}: ${h} resolves`);
      if (kind === "county") {
        county++;
        assert.ok(LIVE[st], `${dir}/${f}: a county sales link only in a state with sales`);
        assert.equal(hrefs(body)[0], `/land-sales/${st}/${f.slice(0, -5)}`, `${dir}/${f}: its own county`);
        assert.match(body, />Recorded sales in [^<]+<\/a>/);
      } else {
        neutral++;
        assert.ok(LIVE[st], `${dir}/${f}: the neutral line only in a state with sales`);
        assert.match(body, NEUTRAL, `${dir}/${f}`);
        const S = JSON.parse(rd(`data/land-sales/${LIVE[st].toLowerCase()}.json`));
        assert.ok(!Object.values(S.counties).some((c) => c.slug === f.slice(0, -5)), `${dir}/${f}: a county with its own page links it`);
      }
    }
  }
  assert.ok(county >= 360, "county links: " + county);
  assert.ok(county + neutral + none + stale >= 2780, "county pages: " + (county + neutral + none + stale));
});

test("builder fixture: a state without sales prints no status, whatever its coverage row says", () => {
  const py = [
    "import sys, json, os, tempfile, types",
    "sys.path.insert(0, 'scripts')",
    "import build_atlas_pages as B",
    "out = {}",
    "for status, src in (('unchecked', ''), ('nondisclosure', 'Commonly listed by the state lists'), ('nondisclosure', 'our own look'), ('county', ''), ('request', ''), ('live', ''), ('held', '')):",
    "    t = tempfile.mkdtemp()",
    "    os.makedirs(t + '/data/land-sales'); os.makedirs(t + '/land-sales')",
    "    open(t + '/land-sales/index.html', 'w').write('x')",
    "    json.dump({'states': [{'st': 'KS', 'name': 'Kansas', 'status': status, 'source': src}]}, open(t + '/data/land-sales/coverage.json', 'w'))",
    "    W = types.SimpleNamespace(root=t)",
    "    out[status + '/' + src] = B._land_sales_door(W, '20001', 'Allen County', 'KS')",
    "t = tempfile.mkdtemp()",
    "os.makedirs(t + '/data/land-sales'); os.makedirs(t + '/land-sales/wisconsin')",
    "open(t + '/land-sales/index.html', 'w').write('x')",
    "open(t + '/land-sales/wisconsin/barron-county.html', 'w').write('x')",
    "json.dump({'counties': {'55005': {'slug': 'barron-county'}}}, open(t + '/data/land-sales/wi.json', 'w'))",
    "W = types.SimpleNamespace(root=t)",
    "out['county'] = B._land_sales_door(W, '55005', 'Barron County', 'WI')",
    "out['nosale'] = B._land_sales_door(W, '55999', 'Testc County', 'WI')",
    "os.remove(t + '/land-sales/index.html')",
    "W = types.SimpleNamespace(root=t)",
    "out['nohub'] = B._land_sales_door(W, '55999', 'Testc County', 'WI')",
    "print(json.dumps(out))",
  ].join("\n");
  const out = JSON.parse(execFileSync("python3", ["-I", "-c", py], { cwd: ROOT, env: { ...process.env, PYTHONPATH: ROOT + "scripts" }, encoding: "utf8" }).trim().split("\n").pop());
  for (const [k, v] of Object.entries(out)) {
    if (k === "county") { assert.match(v, /data-ls-door="county"[^>]*>Land sales: <a href="\/land-sales\/wisconsin\/barron-county">Recorded sales in Barron County<\/a>/); continue; }
    if (k === "nosale") { assert.match(v, /Farm sales by county: see the <a href="\/land-sales\/">farm sales page<\/a>\./); assert.doesNotMatch(v, PHRASES); continue; }
    assert.equal(v, "", `${k}: nothing printed`);
  }
});

test("rent pages: every land sales link resolves, and the states with sales link their counties", () => {
  for (const f of readdirSync(ROOT + "rent")) {
    if (!f.endsWith(".html")) continue;
    const html = rd("rent/" + f);
    for (const h of hrefs(html)) assert.ok(resolves(h), `rent/${f}: ${h}`);
    const st = f.slice(0, -5);
    if (LIVE[st]) {
      assert.ok(html.includes(`href="/land-sales/#${st}"`), `rent/${f}: the state's land sales line`);
      // Vermont (14 counties), New Jersey (21) and Florida (59 rent rows): every row of the rent table links; the bigger states keep 60 or more
      const need = st === "vermont" || st === "new-jersey" || st === "florida" ? (html.match(/<tr><td/g) || []).length : 60;
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

test("the hub: the map, the state and county picker, and the saved-place line", () => {
  // Nov 8, 2026: the jump row and the source table are gone; the map (the shared US map) and the picker are the way in
  const html = rd("land-sales/index.html");
  assert.match(html, /<div id="coverage">[\s\S]*?id="ls-map"/, "the map");
  assert.match(html, /<form class="ls-pick" id="ls-pick"/, "the picker");
  assert.ok(html.indexOf('id="ls-map"') < html.indexOf('id="ls-pick"'), "map before picker");
  assert.doesNotMatch(html, /class="ls-jump"|Where each state stands/, "no jump row, no source table");
  assert.match(html, /<p class="ls-mine" id="ls-mine" hidden><\/p>/);
});
