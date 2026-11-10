/* One sale, linked (Nov 3 2026): every sale in the monthly land sale email links to its own row on
 * the county sale page, land-sales/<state>/<county>#s-<sale id> (scripts/send_land_alert.py sale_url,
 * the id from scripts/land_alert.py sale_id, the row from scripts/build_land_sales.py).
 *   - the selftests: each row has its id, the ids hold across builds, each email sale line has exactly one
 *     link, that link's anchor is on the built page, no name in any link;
 *   - in Chromium: a synthetic county with 70 sales, built by the builder; #s-<id> marks a row in the page,
 *     and a row past the newest 50 is drawn (Show more) and marked. Every outside host is aborted and
 *     service workers are blocked (build rule 58).
 *
 *   node --test test/land-sale-anchor.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PLACES_ROUTE } from "./fixtures/places-mock.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const py = (args, input) => execFileSync("python3", args, { cwd: ROOT, encoding: "utf8", timeout: 300000, input });

test("the selftests: row ids, stable across builds; one link per sale line; its anchor on the built page; no names", () => {
  const b = py(["scripts/build_land_sales.py", "--selftest"]);
  for (const name of ["county page: each listed sale's row carries its id, once", "county page: the row ids are the same on a second build",
    "county page: #s-<id> marks the row (:target) and the page opens Show more for an older one", "the row id is a hash, never a name or document"]) {
    assert.ok(b.includes("ok   " + name), "build_land_sales selftest ran: " + name);
  }
  const s = py(["scripts/send_land_alert.py", "--selftest"]);
  for (const name of ["every sale in the email has exactly one link, in the HTML row and under the line in the text",
    "each link opens its sale's own row on the built county page (#s-<id>)", "no name, parcel, legal or document in any sale link"]) {
    assert.ok(s.includes("ok   " + name), "send_land_alert selftest ran: " + name);
  }
  assert.match(py(["scripts/land_alert.py", "--selftest"]), /OK: 0 failure\(s\)/);
});

// a synthetic county (70 sales, made-up names that must never reach a page) built into a temp folder
function buildSite() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ls-anchor-"));
  const code = `
import json, os, sys
from pathlib import Path
sys.path.insert(0, "scripts")
import build_land_sales as BS
t = Path(sys.argv[1])
(t / "data" / "land" / "wi").mkdir(parents=True)
(t / "data" / "land-sales").mkdir(parents=True)
(t / "grain-emc.html").write_text("<script>/* agsist-theme-early */</script><script>/* agsist-ga-guard */</script>")
(t / "data" / "land-sales" / "coverage.json").write_text(json.dumps({"labels": {"live": "Sales on this site"}, "note": "",
    "states": [{"st": "WI", "name": "Wisconsin", "status": "live"}]}))
cols = ["doc", "date", "price", "acres", "tac", "np", "cls", "conv", "pid", "muni", "legal", "exempt", "grantor", "grantee", "ac1", "rec"]
rows = []
for i in range(70):
    d = "2026-%02d-%02d" % (9 - i // 28, 28 - i % 28)
    rows.append(["DOC%d" % i, d, 400000 + 1000 * i, 40.0 + i, None, 1, "4", "Warranty Deed", "PIN%d" % i, "0", "LEGAL %d" % i, 0,
                 "SELLER SYNTH%d" % i, "BUYER SYNTH%d" % i, None, d])
(t / "data" / "land" / "wi" / "55999.json").write_text(json.dumps({"state": "WI", "county": "Testa", "fips": "55999",
    "fetched_utc": "2026-10-18T00:00:00Z", "cols": cols, "rows": rows, "munis": {"0": ["Town of Test", 45.0, -91.0]},
    "coverage": {"from": "2020-01-01", "to": "2026-09-30"}}))
(t / "data" / "land" / "wi" / "index.json").write_text(json.dumps({"state": "WI", "fetched_utc": "2026-10-18T00:00:00Z",
    "counties": [{"fips": "55999", "name": "Testa", "lat": 45.0, "lng": -91.0}]}))
texts = BS.build(t)
for p, x in texts.items():
    (t / p).parent.mkdir(parents=True, exist_ok=True)
    (t / p).write_text(x, encoding="utf-8")
lf = json.loads(texts["data/land-sales/wi/55999.json"])
ids = [a[lf["cols"].index("id")] for a in lf["s"]]
print(json.dumps({"ids": ids}))
`;
  const out = JSON.parse(py(["-", tmp], code).trim().split("\n").pop());
  return { tmp, ids: out.ids };
}

const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (fs.existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !fs.existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

test("in Chromium: #s-<id> marks the sale's row, in the page and past the newest 50 (Show more)", { skip }, async () => {
  const { tmp, ids } = buildSite();
  assert.equal(ids.length, 70, "70 sales on the list, newest first");
  const page = fs.readFileSync(path.join(tmp, "land-sales/wisconsin/testa-county.html"), "utf8");
  assert.ok(page.includes(`<tr id="s-${ids[2]}"`), "the third newest sale is in the page");
  assert.ok(!page.includes(`id="s-${ids[65]}"`), "the 66th is not: it loads with Show more");
  assert.doesNotMatch(page, /SYNTH\d/, "no name in the page");
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".svg": "image/svg+xml" };
  // the built files first, then the checkout (components, styles)
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index.html";
    if (!path.extname(p)) p += ".html";
    for (const dir of [tmp, ROOT]) {
      const f = path.normalize(path.join(dir, p));
      if (f.startsWith(dir) && fs.existsSync(f) && fs.statSync(f).isFile()) {
        res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" });
        res.end(fs.readFileSync(f));
        return;
      }
    }
    res.writeHead(404); res.end();
  });
  await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 800 } });
    // every outside host goes nowhere: no worker, no form, no mail list (build rule 58)
    await ctx.route(PLACES_ROUTE, (r) => r.abort());
    await ctx.route("**/*", (r) => (r.request().url().startsWith(base) ? r.continue() : r.abort()));
    const pg = await ctx.newPage();
    const errors = [];
    pg.on("pageerror", (e) => errors.push(String(e)));
    const marked = async (id) => {
      await pg.waitForFunction((i) => { const r = document.querySelector(`#ls-all tbody tr button.ls-nm[data-ls-id="${i}"]`); return r && r.closest("tr").matches(".ls-hit"); },
        id, { timeout: 30000 });
      await pg.waitForTimeout(2200);    // the page scrolls again at 0.6 and 1.6 s, after the late blocks above it settle
      return pg.evaluate((i) => {
        const tr = document.querySelector(`#ls-all tbody tr button.ls-nm[data-ls-id="${i}"]`).closest("tr");
        const r = tr.getBoundingClientRect(), cs = getComputedStyle(tr), td = getComputedStyle(tr.querySelector("td"));
        return { top: r.top, sy: scrollY, inView: r.top < innerHeight && r.bottom > 0, outline: cs.outlineStyle, bg: td.backgroundColor, n: document.querySelectorAll("#ls-all tbody tr").length };
      }, id);
    };
    await pg.goto(`${base}/land-sales/wisconsin/testa-county#s-${ids[2]}`);
    const a = await marked(ids[2]);
    assert.ok(a.inView, "the row is scrolled into view");
    assert.equal(a.outline, "solid", "the row is outlined");
    assert.notEqual(a.bg, "rgba(0, 0, 0, 0)", "the row is shaded");
    assert.equal(await pg.evaluate(() => document.querySelectorAll("#ls-all tbody tr.ls-hit").length), 1, "one row marked");

    // a second link in the same tab (only the hash changes): the older row, drawn by Show more, is marked instead
    await pg.evaluate((i) => { location.hash = "#s-" + i; }, ids[65]);
    const b = await marked(ids[65]);
    assert.equal(await pg.evaluate(() => document.querySelectorAll("#ls-all tbody tr.ls-hit").length), 1, "only the new row marked");
    assert.ok(b.n >= 66, "Show more was pressed until the row was drawn: " + b.n);
    assert.ok(b.inView, "the older row is scrolled into view: " + JSON.stringify(b));
    assert.notEqual(b.bg, "rgba(0, 0, 0, 0)", "the older row is shaded");
    // and a fresh page opened straight on the older row
    const pg2 = await ctx.newPage();
    pg2.on("pageerror", (e) => errors.push(String(e)));
    await pg2.goto(`${base}/land-sales/wisconsin/testa-county#s-${ids[65]}`);
    await pg2.waitForFunction((i) => { const r = document.querySelector(`#ls-all tbody tr button.ls-nm[data-ls-id="${i}"]`); return r && r.closest("tr").matches(".ls-hit"); },
      ids[65], { timeout: 30000 });
    assert.deepEqual(errors.filter((x) => /s-[0-9a-f]{10}|ls-hit|closest/.test(x)), [], "no error from the anchor script");
    await ctx.close();
  } finally {
    await browser.close();
    srv.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
