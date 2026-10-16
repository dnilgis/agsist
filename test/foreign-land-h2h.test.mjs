/* /foreign-land, Oct 16, 2026 head-to-head fixes:
 *   - the China number in the hero, the visible FAQ and the JSON-LD:
 *     247,659 / 47,241,820 = 0.524%, printed as 0.5%
 *   - a "who is behind it" line beside the headline from our own sums:
 *     codes 998 + 999 = 1,382,633 + 1,546,303 = 2,928,936 acres, / 47,241,820 = 6.2%
 *     The owned vs lease split is withheld until scripts/process_afida.py has sorted the
 *     interest column (the page shows it only when 99% of acres sort)
 *   - the map libraries are self-hosted and pinned (Leaflet 1.9.4, topojson-client 3.1.0,
 *     us-atlas 3.0.1); no outside host is needed to draw it
 *
 *   node --test test/foreign-land-h2h.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { extname, join, normalize } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;
const HTML = readFileSync(ROOT + "foreign-land.html", "utf8");
const NAT = JSON.parse(readFileSync(ROOT + "data/afida/national.json", "utf8"));

test("China: 247,659 acres, 0.5%, in the hero, the FAQ and the JSON-LD", () => {
  const tot = NAT.total_by_year[String(NAT.latest_year)];
  assert.equal(NAT.by_country.CHINA, 247659);
  assert.equal((100 * 247659 / tot).toFixed(1), "0.5");
  const ld = JSON.parse(HTML.match(/<script type="application\/ld\+json">\s*(\{"@context": "https:\/\/schema.org", "@type": "FAQPage"[\s\S]*?)<\/script>/)[1]);
  const q = ld.mainEntity.find((x) => /China/.test(x.name));
  assert.match(q.acceptedAnswer.text, /247,659 acres/);
  assert.match(q.acceptedAnswer.text, /0\.5%/);
  assert.equal((HTML.match(/Not much: 247,659 acres at the end of 2024/g) || []).length, 2, "visible FAQ and JSON-LD say the same");
  assert.match(HTML, /<b>China:<\/b> 247,659 acres, 0\.5% of foreign-held acres \(USDA AFIDA, Dec 31, 2024\)/);
  assert.equal(NAT.by_country["HONG KONG"], 144090);
});

test("the no-country line is our own sum, and no owned-outright number is printed yet", () => {
  const tot = NAT.total_by_year[String(NAT.latest_year)];
  const codes = Object.entries(NAT.by_country).filter(([k]) => /^99[89]\b/.test(k)).reduce((a, [, v]) => a + v, 0);
  assert.equal(codes, 2928936);
  assert.equal((codes / 1e6).toFixed(1), "2.9");
  assert.equal((100 * codes / tot).toFixed(1), "6.2");
  assert.match(HTML, /2\.9 million of the 47\.2 million acres in USDA&rsquo;s detail files \(6\.2%\) name no foreign country/);
  assert.match(HTML, /We have not added up that split yet/);
  assert.ok(!NAT.by_interest, "if this fails, the split now exists: update the hero copy and this test");
  // the live line needs both buckets and 99% sorted
  assert.match(HTML, /\(bi\.owned\+bi\.lease\)\/tot<0\.99\) return;/);
});

test("process_afida sorts the interest column and keeps what it cannot sort out of the split", () => {
  const out = execFileSync("python3", ["-c", `
import sys, json; sys.path.insert(0, 'scripts'); import process_afida as p
rows = [{'interest': 'Fee Simple', 'ac': 100, 'country': 'CANADA'},
        {'interest': 'Leasehold', 'ac': 40, 'country': 'GERMANY'},
        {'interest': 'Life estate', 'ac': 7, 'country': '999 - NO PREDOMINANT COUNTRY CODE'}]
print(json.dumps([p.interest_col(['State', 'Type of Interest']), p.interest_col(['State', 'Country']),
                  p.interest_split(rows), p.interest_split([{'interest': None, 'ac': 1, 'country': 'X'}])]))`],
  { cwd: ROOT, encoding: "utf8" });
  const [col, none, split, nosplit] = JSON.parse(out);
  assert.equal(col, 1);
  assert.equal(none, null);
  assert.deepEqual([split.owned, split.lease, split.unsorted, split.nocountry], [100, 40, 7, 7]);
  assert.equal(nosplit, null, "a file with no interest column gives no split");
});

test("the map loads only pinned, self-hosted files", () => {
  assert.doesNotMatch(HTML, /cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|unpkg\.com/);
  for (const f of ["vendor/leaflet-1.9.4/leaflet.js", "vendor/leaflet-1.9.4/leaflet.css",
    "vendor/topojson-client-3.1.0/topojson-client.min.js", "vendor/us-atlas-3.0.1/counties-10m.json"]) {
    assert.ok(existsSync(ROOT + f), f);
    assert.ok(HTML.includes("/" + f), `page loads /${f}`);
  }
  assert.doesNotMatch(HTML, /—/, "no em dashes");
});

test("in Chromium with every outside host blocked, the county map draws", { skip }, async () => {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".svg": "image/svg+xml", ".png": "image/png" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (!extname(p)) p += ".html";
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
  const port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
    const pg = await ctx.newPage();
    const errors = [];
    pg.on("pageerror", (e) => errors.push(String(e)));
    await pg.route("**/*", (r) => (r.request().url().startsWith(`http://127.0.0.1:${port}`) ? r.continue() : r.abort()));
    await pg.goto(`http://127.0.0.1:${port}/foreign-land`);
    await pg.waitForFunction(() => document.querySelectorAll("#fl-map path").length > 1000 || /unavailable/i.test(document.getElementById("fl-map").textContent), null, { timeout: 30000 });
    const n = await pg.$$eval("#fl-map path", (a) => a.length);
    assert.ok(n > 3000, `county paths drawn: ${n}`);
    assert.doesNotMatch(await pg.textContent("#fl-map"), /unavailable/i);
    assert.deepEqual(errors, []);
    await ctx.close();
  } finally { await browser.close(); srv.close(); }
});
