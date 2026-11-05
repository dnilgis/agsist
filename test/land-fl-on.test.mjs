/* Florida farm sales switched on (Nov 5, 2026). Florida's sale data files give the sale month, not the day, and its county
 * files are served from agsist-data, not this site. Synthetic rows only (test/fixtures/land-fl): no real parcel, no name.
 *
 *   node --test test/land-fl-on.test.mjs
 *
 * The Field Scout sale panel uses Florida's own labels; month-date deeds are never merged as a refiled copy (JavaScript and
 * Python alike); a big county is split into recent and older years and read back whole; every reader shows a Florida sale
 * as a month (the county and monthly land-sales pages, their data files, the Atlas lines, the change lines, the land sale
 * email); a build without the agsist-data copy keeps every Florida page as it is; no name anywhere; the other states'
 * summaries are what main's code makes. Browser runs: test/land-fl-browser.test.mjs. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const F = require(path.join(ROOT, "field-scout-land.js"));
const AS = require(path.join(ROOT, "components/atlas-sales.js"));
const CL = require(path.join(ROOT, "components/change-lines.js"));
const FIX = path.join(ROOT, "test/fixtures/land-fl");
const DAY = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}, 20\d\d\b/;
const py = (code, ...args) => {
  const r = spawnSync("python3", ["-c", code, path.join(ROOT, "scripts"), ...args], { encoding: "utf8", cwd: ROOT });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim().split("\n").pop();
};

let SITE = null;
function site() {
  if (SITE) return SITE;
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "flon-"));
  const r = spawnSync("python3", [path.join(FIX, "make_site.py"), out], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  SITE = { dir: out, info: JSON.parse(r.stdout.trim().split("\n").pop()) };
  return SITE;
}
const rd = (p) => fs.readFileSync(path.join(site().dir, p), "utf8");

function builtFile() {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "flp-"));
  py(["import json,sys", "sys.path.insert(0,sys.argv[1])", "import fetch_land_sales as L", "L.OUT=sys.argv[3]",
    "print(json.dumps(L.build('FL',L.fl_recs(sys.argv[2],{}),{},'2026-11-05T00:00:00Z')))"].join("\n"), FIX, out);
  const f = JSON.parse(fs.readFileSync(path.join(out, "fl", "12049.json"), "utf8"));
  fs.rmSync(out, { recursive: true, force: true });
  return f;
}

test("the Field Scout sale panel uses Florida's own labels", () => {
  const f = builtFile();
  const rows = F.rowObjs(f), by = Object.fromEntries(rows.map((r) => [r.pid, r]));
  const q = F.saleDetailHTML(by["FX-001"], f, []);
  assert.match(q, /<th scope="row">Sale month<\/th><td>Aug 2025/);   // pin-ok: synthetic fixture site (test/fixtures/land-fl), not live data
  assert.match(q, /Sale price on the Florida sale data file/);
  assert.match(q, /<th scope="row">Qualification code<\/th><td>01, arm's length, deed examined: <b>qualified sale<\/b>/);
  assert.match(q, /Codes 01 and 02 are qualified/);
  assert.match(q, /<th scope="row">Vacant or improved<\/th><td>Vacant land/);
  assert.match(q, /<th scope="row">In the market-sales list<\/th><td>Yes/);
  assert.match(q, /Clerk of Court/);
  for (const html of [q, F.saleDetailHTML(by["FX-004"], f, []), F.saleDetailHTML(by["FX-005"], f, []), F.saleDetailHTML(by["FX-002"], f, [])]) {
    assert.doesNotMatch(html, /Deed date|date of conveyance|Recorded \(filed\)|recording date/i, "no deed-day or recording-date wording");
    assert.doesNotMatch(html, /Register of Deeds|Transfer fee|transfer tax|Exemption claimed|No exemption claimed|Buyer and seller related|Deed or conveyance type/);
    assert.doesNotMatch(html.replace(/Our copy was read [A-Za-z]{3} \d{1,2}, \d{4}/, ""), DAY, "no sale day anywhere in the panel");
  }
  assert.match(F.saleDetailHTML(by["FX-004"], f, []), /<th scope="row">Vacant or improved<\/th><td>Improved: buildings on the land/);
  const fam = F.saleDetailHTML(by["FX-005"], f, []);
  assert.match(fam, /<th scope="row">Qualification code<\/th><td>30, between relatives or affiliated companies: <span class="fl-warn">not qualified/);
  assert.match(fam, /<th scope="row">In the market-sales list<\/th><td>No: not a qualified sale on the Florida file/);
  const nom = F.saleDetailHTML(by["FX-002"], f, []);
  assert.match(nom, /No sale price \(\$100 on the file, minimum stamps\)/);
  assert.match(nom, /not a qualified sale on the Florida file, no sale price/);
  assert.deepEqual(F.flCode(by["FX-003"].conv), { code: "02", words: "arm's length, other evidence", qualified: true, nominal: false });
  assert.equal(F.flCode("Warranty Deed"), null, "another state's deed type is not read as a Florida code");
  assert.equal(F.classLabel("4 7", "FL"), "Agricultural land, Improved (buildings)");
  assert.equal(F.classLabel("6", "FL"), "Timberland");
  // other states keep their own labels
  const il = F.saleDetailHTML({ st: "IL", date: "2026-03-05", price: 500000, acres: 50, conv: "Warranty Deed", cls: "4" }, { state: "IL", cols: ["rec"] }, []);
  assert.match(il, /Deed date \(instrument date\)/);
  assert.match(il, /Recorded \(filed\)/);
  assert.doesNotMatch(il, /Sale month|Qualification code/);
});

test("month-date deeds are never merged as a refiled copy, in JavaScript and Python alike", () => {
  const cols = ["doc", "date", "price", "acres", "tac", "np", "cls", "conv", "pid", "muni", "legal", "exempt"];
  const two = [["I 2025000501 2025-06", "2025-06-01", 250000, 40, null, 1, "4", "Qualified sale, Florida code 01: arm's length, deed examined", "FX-050", "", "", 0],
    ["I 2025000502 2025-06", "2025-06-01", 250000, 40, null, 1, "4", "Qualified sale, Florida code 01: arm's length, deed examined", "FX-050", "", "", 0]];
  const fl = { state: "FL", fips: "12049", county: "Hardee", dates: "month", cols, rows: two, coverage: { from: "2025-06-01", to: "2025-06-01", dates: "month" } };
  const day = { state: "WI", fips: "55999", county: "Testc", cols, rows: two.map((r, i) => [r[0], "2025-06-1" + i, ...r.slice(2)].map((v, k) => (k === 1 ? "2025-06-10" : v))) };
  const today = "2026-11-05";
  assert.equal(F.saleRows(F.rowObjs(fl), today).length, 2, "Florida: two deeds, two rows");
  assert.equal(F.saleRows(F.rowObjs(day), today).length, 1, "a state with deed days: the same sale filed twice is one row");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fld-"));
  try {
    for (const [n, f] of [["fl.json", fl], ["wi.json", day]]) {
      fs.writeFileSync(path.join(tmp, n), JSON.stringify(f));
      const r = spawnSync("python3", [path.join(ROOT, "scripts/build_land_summary.py"), "--rule", path.join(tmp, n), today], { encoding: "utf8" });
      assert.equal(r.status, 0, r.stderr);
      const js = F.saleRows(F.rowObjs(f), today).map((r) => [r.doc, String(r.date || "").slice(0, 10), Math.round(F.num(r.price) || 0), F.num(r.acres), r.ppa, F.marketSale(r, today), F.statOK(r), r.grp || 1]);
      assert.deepEqual(JSON.parse(r.stdout)[0], js, n);
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test("a big county is split into its recent years and older yearly files, and read back whole", async () => {
  const dir = path.join(site().dir, "data/land-hosted/fl");
  const main = JSON.parse(fs.readFileSync(path.join(dir, "12049.json"), "utf8"));
  assert.deepEqual(main.older, [{ y: 2021, n: 1, f: "12049-2021.json" }]);
  assert.ok(main.rows.every((r) => r[1] >= "2024-01-01"), "the county file holds the last 3 years only");   // pin-ok: synthetic fixture site (test/fixtures/land-fl), not live data
  const before = F.olderLeft([main]);
  assert.deepEqual(before, { years: 1, n: 1, before: 2022 });
  const whole = JSON.parse(py("import sys,json\nsys.path.insert(0,sys.argv[1])\nimport build_land_summary as B\nprint(json.dumps(B.read_county(sys.argv[2])['rows']))", path.join(dir, "12049.json")));
  const asked = [];
  const get = (url) => { asked.push(url); return Promise.resolve(JSON.parse(fs.readFileSync(path.join(dir, path.basename(url)), "utf8"))); };
  const res = await F.loadOlder("FL", [main], get);
  assert.equal(res.failed, 0);
  assert.deepEqual(asked, ["https://dnilgis.github.io/agsist-data/land/fl/12049-2021.json"]);
  assert.deepEqual(main.rows, whole, "the same rows in the same order as the Python readers");
  assert.equal(F.olderLeft([main]).years, 0);
  const again = await F.loadOlder("FL", [main], () => { throw new Error("no second load"); });
  assert.equal(again.failed, 0);
  const miss = JSON.parse(fs.readFileSync(path.join(dir, "12049.json"), "utf8"));
  const res2 = await F.loadOlder("FL", [miss], () => Promise.reject(new Error("404")));
  assert.equal(res2.failed, 1);
  assert.equal(miss.rows.length, main.rows.length - 1, "a year that does not load leaves the county as it was");
});

test("the land-sales pages and their files show every Florida sale as a month, with no name", () => {
  const { info } = site();
  assert.equal(info.leaks, 0);
  const cp = rd("land-sales/florida/hardee-county.html");
  const table = cp.slice(cp.indexOf('id="ls-all"'), cp.indexOf("</table>", cp.indexOf('id="ls-all"')));
  assert.match(table, /<td>Aug 2025<\/td>/);   // pin-ok: synthetic fixture site (test/fixtures/land-fl), not live data
  assert.match(table, /<td>Jun 2021<\/td>/, "the older year's sale is listed too");   // pin-ok: synthetic fixture site (test/fixtures/land-fl), not live data
  assert.doesNotMatch(table, DAY);
  assert.doesNotMatch(table, /\*/, "no deed-date mark on a sale month");
  assert.match(cp, /4 sales on file, Jun 2021 to Aug 2025/);   // pin-ok: synthetic fixture site (test/fixtures/land-fl), not live data
  assert.match(cp, /No market middle: 2 bare farmland sales of 20 acres or more at \$500 an acre or more, Feb 2024 to Jan 2026, and it takes 5\./);   // pin-ok: synthetic fixture site (test/fixtures/land-fl), not live data
  assert.match(cp, /Florida sales come from the Department of Revenue/);
  assert.doesNotMatch(cp, /data-land-alert/, "the email ask waits for Florida");
  const body = cp.replace(/<script[\s\S]*?<\/script>/g, "").replace(/read [A-Za-z]{3} \d{1,2}, \d{4}/g, "");
  assert.doesNotMatch(body, DAY, "no day anywhere on the Florida county page but the date the files were read");
  const lf = JSON.parse(rd("data/land-sales/fl/12049.json")), sf = JSON.parse(rd("data/land-sales/fl.json"));
  assert.equal(lf.dates, "month");
  assert.equal(sf.dates, "month");
  assert.ok(lf.s.every((a) => /^\d{4}-\d{2}-01$/.test(a[1]) && a[2] === 0));
  assert.deepEqual(lf.s.map((a) => a[lf.cols.indexOf("ri")]), [0, 2, 5, 7], "row numbers count across the split county, the 2021 sale past the recent rows");
  const mp = rd(info.month);
  assert.match(mp, /1 in Florida \(by sale month\)/);
  assert.match(mp, /<td>Aug 2025<\/td><td>Wauchula, <a href="\/land-sales\/florida\/hardee-county">Hardee County, FL<\/a><\/td>/);   // pin-ok: synthetic fixture site (test/fixtures/land-fl), not live data
  const latest = JSON.parse(rd("data/land-sales/latest.json"));
  assert.equal(latest.top_state.FL.basis, "sale month");
  assert.equal(JSON.parse(rd("data/land-sales/lead.json")).lead.FL, null, "no home lead from sale months");
  for (const p of info.files.filter((x) => /fl|florida/.test(x))) {
    const t = rd(p);
    for (const n of info.names) assert.ok(!t.includes(n), p + " names no one");
    assert.doesNotMatch(t, /FX-0\d\d|grantor|grantee/, p + ": no parcel number or name column");
  }
});

test("a build without the agsist-data copy keeps every Florida page and the pages that mix the states as they are", () => {
  const { dir } = site();
  const code = ["import sys,json", "sys.path.insert(0,sys.argv[1])", "import build_land_sales as B", "from pathlib import Path",
    "t=B.build(Path(sys.argv[2]))", "print(json.dumps({k: (Path(sys.argv[2])/k).read_text() == v for k, v in t.items()}))"].join("\n");
  const away = dir + "-hosted";
  fs.renameSync(path.join(dir, "data/land-hosted"), away);
  try {
    const same = JSON.parse(py(code, dir));
    assert.ok(Object.keys(same).some((k) => k.startsWith("land-sales/florida/")), "the Florida pages are in the build");
    assert.deepEqual(Object.keys(same).filter((k) => !same[k]), [], "nothing differs from what was built with the copy");
  } finally { fs.renameSync(away, path.join(dir, "data/land-hosted")); }
});

test("the Atlas sales lines, Fast Facts and the change lines say Florida's dates as months", () => {
  const sum = JSON.parse(rd("data/land/fl/summary.json"));
  assert.equal(sum.dates, "month");
  assert.equal(sum.through, "2026-01-31", "through the newest sale month on file, not the month before the files were read");   // pin-ok: synthetic fixture site (test/fixtures/land-fl), not live data
  const tile = AS.tile(sum, "12049");
  assert.match(tile.sub, /sales dated through Jan 2026$/);   // pin-ok: synthetic fixture site (test/fixtures/land-fl), not live data
  const html = AS.countyHTML(sum, "12049", null);
  assert.match(html, /Sales dated through Jan 2026/);   // pin-ok: synthetic fixture site (test/fixtures/land-fl), not live data
  assert.doesNotMatch(html, DAY);
  assert.equal(AS.thru({ through: "2026-09-30" }), "Sep 30, 2026", "other states keep the day");   // pin-ok: synthetic fixture site (test/fixtures/land-fl), not live data
  assert.ok(AS.STATES.FL);
  const sf = JSON.parse(rd("data/land-sales/fl.json"));
  const s = CL.newSales(sf, "12049", "FL");
  const line = CL.salesLine(s, "Hardee County");
  assert.match(line.date, /^records through Jan 2026, read /);   // pin-ok: synthetic fixture site (test/fixtures/land-fl), not live data
  assert.doesNotMatch(line.date.replace(/read .*$/, ""), DAY);
  const wi = CL.salesLine(CL.newSales({ through: "2026-09-30", fetched: "2026-10-18", counties: { "55999": { s: [] } } }, "55999", "WI"), "Testc County");
  assert.match(wi.date, /^records through Sep 30, read /, "other states keep the day");   // pin-ok: synthetic fixture site (test/fixtures/land-fl), not live data
  const code = ["import sys,json", "sys.path.insert(0,sys.argv[1])", "import build_atlas_pages as A", "class W: pass",
    "w=W(); w.root=sys.argv[2]", "print(json.dumps([A.land_first(w,'12049','Hardee County, FL','FL',''), A.sales_tile(w,'12049','FL'), A._sday('2025-08-01', True)]))"].join("\n");
  fs.mkdirSync(path.join(site().dir, "components"), { recursive: true });
  fs.copyFileSync(path.join(ROOT, "components/atlas-sales.js"), path.join(site().dir, "components/atlas-sales.js"));
  const [lf, st, m] = JSON.parse(py(code, site().dir));
  assert.equal(m, "Aug 2025");   // pin-ok: synthetic fixture site (test/fixtures/land-fl), not live data
  assert.match(lf, /<span class="lf-d">Aug 2025<\/span>/);   // pin-ok: synthetic fixture site (test/fixtures/land-fl), not live data
  assert.match(lf, /Sales through Jan 2026/);   // pin-ok: synthetic fixture site (test/fixtures/land-fl), not live data
  assert.doesNotMatch(lf, /deed date/);
  assert.doesNotMatch(lf, DAY);
  assert.match(st.sub, /sales dated through Jan 2026$/);   // pin-ok: synthetic fixture site (test/fixtures/land-fl), not live data
});

test("the land sale email for a Florida reader lists sales by month", () => {
  const { dir } = site();
  const code = ["import sys,json", "sys.path.insert(0,sys.argv[1])", "import land_alert as LA, send_land_alert as S",
    "class Z:", "  def coord(self, z): return (27.55, -81.80)", "  def town(self, z): return 'Wauchula'",
    "land=LA.Land(sys.argv[2])", "f=land.file('FL','12049')",
    "ready=[LA.ready(land,'FL',f,2025,m0) for m0 in (6,7)] + [LA.ready(land,'FL',land.file('FL','12055'),2026,0)]",
    "c, why = S.compose('33873', 25, 2025, 7, land, Z(), '2026-11-05', sys.argv[2])",
    "subject, pre, blocks = c", "import email_links", "msg = S.render('reader@example.com', 'https://w.dev', 'sec', email_links.SAMPLE_LID, c, 'news@agsist.com')",
    "txt = '\\n'.join(p.get_payload(decode=True).decode() for p in msg.walk() if p.get_content_type() == 'text/plain')",
    "htm = '\\n'.join(p.get_payload(decode=True).decode() for p in msg.walk() if p.get_content_type() == 'text/html')",
    "print(json.dumps({'ready': ready, 'why': why, 'subject': subject, 'pre': pre, 'blocks': [list(b) for b in blocks], 'text': txt, 'html': htm}))"].join("\n");
  const r = JSON.parse(py(code, dir));
  assert.deepEqual(r.ready, [true, true, false], "a month is posted once the files hold a later month; the newest month waits");
  assert.equal(r.why, "send");
  const sales = r.blocks.find((b) => b[0] === "sales")[1];
  assert.equal(sales.length, 1);
  assert.equal(sales[0].basis, "sale month");
  assert.match(r.pre, /^Nearest: 40 acres at \$10,000 an acre/);
  assert.ok(r.blocks.some((b) => b[0] === "p" && /Florida sales are listed by the month of the sale/.test(b[1])));
  assert.match(r.text, /Aug 2025: 40 acres/);   // pin-ok: synthetic fixture site (test/fixtures/land-fl), not live data
  assert.match(r.html, /<th scope="col"[^>]*>Sale month<\/th>/, "the table is headed Sale month");
  assert.match(r.html, />Aug 2025<\/a>/);   // pin-ok: synthetic fixture site (test/fixtures/land-fl), not live data
  assert.doesNotMatch(r.text.replace(/read [A-Za-z]{3} \d{1,2}, \d{4}/g, ""), DAY);
  assert.doesNotMatch(r.text + r.html, /Aug 1\b|\(deed date\)/);   // pin-ok: synthetic fixture site (test/fixtures/land-fl), not live data
});

test("the other states' summaries are what main's code makes (summary hash)", () => {
  const code = ["import sys,json,hashlib", "sys.path.insert(0,sys.argv[1])", "import build_land_summary as B",
    "fx=json.load(open(sys.argv[2]))", "s=B.dump(B.build_state('IL',[fx['file']],fetched=fx['fetched']))",
    "s2=B.dump(B.build_state('WI',[dict(fx['file'],state='WI')],fetched=fx['fetched']))",
    "print(hashlib.sha256((s+s2).encode()).hexdigest()[:16])"].join("\n");
  // 91ca80a7384a2629: the same fixture through build_land_summary.py on main at 7fc9233 (#353), before Florida was switched on
  assert.equal(py(code, path.join(ROOT, "test/fixtures/land-summary.json")), "91ca80a7384a2629");
});

test.after(() => { if (SITE) fs.rmSync(SITE.dir, { recursive: true, force: true }); });
