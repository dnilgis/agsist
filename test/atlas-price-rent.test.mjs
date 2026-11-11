/* Rent against price on the Farmland Atlas (Nov 11, 2026).
 *
 *   node --test test/atlas-price-rent.test.mjs
 *
 * A county with 5 or more market sales in the 24-month sale file (data/land-sales/<st>.json, the same median
 * "Sold for" prints) and a USDA NASS non-irrigated cash rent not more than three survey years old gets one line:
 * the rent as a percent of the median sale price and about how many years of rent equal the price, with both
 * counts (the number of sales, the rent survey year). The state page gets two sortable columns from the same
 * answer. Under 5 sales, a rent too old, only an irrigated rent, no rent or no sale file: no line. Rent under 1% of
 * the median (more than 100 years of rent): the sales are priced well above farm value, so no line, and the state
 * table says so in place of the two figures.
 *
 * These read the builder (scripts/build_atlas_pages.py), never the pages built on main, and work any figure out
 * again from the data file the builder read, so a new month of sales or a new rent survey keeps them honest. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import os from "node:os";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const J = (p) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));
const ENV = { ...process.env, PYTHONHASHSEED: "0" };
const py = (code) => JSON.parse(execFileSync("python3", ["-c", "import sys, json; sys.path.insert(0, 'scripts'); import build_atlas_pages as B\n" + code],
  { cwd: ROOT, env: ENV, stdio: ["ignore", "pipe", "pipe"] }).toString());
const LINE = /<p class="note" data-pr><b>Rent against price:<\/b> (\$[\d,]+(?:\.\d\d)?) an acre cash rent is ([\d.]+)% of the (\$[\d,]+) median sale price, about ([\d,]+) years? of rent to equal the price\. (\d+) sales?, ([A-Z][a-z]{2} \d{4} to [A-Z][a-z]{2} \d{4}); rent USDA NASS (\d{4})\. Sales are bare farmland of every kind; the rent is for non-irrigated cropland\.<\/p>/;
const ATLAS = J("data/atlas/atlas.json").counties;
const LATEST = Math.max(...Object.values(ATLAS).map((c) => (c.rent && c.rent.nonirr && c.rent.nonirr.year) || 0));

const SPAN = ["Nov", 2024, "to", "Oct", 2026].join(" ");   // a made-up window for the hand-worked line, not live data

test("the arithmetic and the gates, hand-worked", () => {
  const r = py(`
P = B.price_rent
out = {
  "adams": P({"med": 7919, "n": 66}, {"year": 2026, "value": 238.0}, 2026),
  "charlotte": P({"med": 13880, "n": 9}, {"year": 2026, "value": 26.5}, 2026),
  "addison": P({"med": 3713, "n": 20}, {"year": 2026, "value": 65.5}, 2026),
  "one": P({"med": 10000, "n": 5}, {"year": 2026, "value": 100.0}, 2026),
  "under1": P({"med": 10000, "n": 5}, {"year": 2026, "value": 99.5}, 2026),
  "four": P({"med": 7919, "n": 4}, {"year": 2026, "value": 238.0}, 2026),
  "five": P({"med": 7919, "n": 5}, {"year": 2026, "value": 238.0}, 2026),
  "rent2023": P({"med": 7919, "n": 66}, {"year": 2023, "value": 238.0}, 2026),
  "rent2022": P({"med": 7919, "n": 66}, {"year": 2022, "value": 238.0}, 2026),
  "nosale": P(None, {"year": 2026, "value": 238.0}, 2026),
  "nomedian": P({"med": None, "n": 3}, {"year": 2026, "value": 238.0}, 2026),
  "norent": P({"med": 7919, "n": 66}, None, 2026),
  "rentnull": P({"med": 7919, "n": 66}, {"year": 2026, "value": None}, 2026),
  "nolatest": P({"med": 7919, "n": 66}, {"year": 2026, "value": 238.0}, 0),
}
out["pct"] = [B.pr_pct(out["adams"]["pct"]), B.pr_pct(out["charlotte"]["pct"])]
out["line"] = B.price_rent_line(dict(out["addison"], span=${JSON.stringify(SPAN)}))
out["highline"] = B.price_rent_line(dict(out["charlotte"], span=${JSON.stringify(SPAN)}))
out["highcells"] = B.pr_cells(out["charlotte"])
out["highattrs"] = B.pr_attrs(out["charlotte"])
out["none"] = B.price_rent_line(None)
print(json.dumps(out))`);
  // 238 / 7,919 = 3.0054%; 7,919 / 238 = 33.27, about 33 years
  assert.ok(Math.abs(r.adams.pct - 3.00543) < 1e-4, String(r.adams.pct));
  assert.equal(r.adams.years, 33);
  assert.equal(r.adams.n, 66);
  assert.equal(r.adams.ry, 2026);
  // 26.50 / 13,880 = 0.1909%; 13,880 / 26.5 = 523.8, about 524 years
  assert.equal(r.charlotte.years, 524);
  assert.deepEqual(r.pct, ["3.0%", "0.19%"]);
  assert.equal(r.four, null, "4 sales: no line");
  assert.ok(r.five, "5 sales: a line");
  assert.ok(r.rent2023, "a 2023 rent on the 2026 survey is three years old: kept");
  assert.equal(r.rent2022, null, "a 2022 rent on the 2026 survey is too old");
  for (const k of ["nosale", "nomedian", "norent", "rentnull", "nolatest"]) assert.equal(r[k], null, k);
  const m = LINE.exec(r.line);
  assert.ok(m, r.line);
  // 65.50 / 3,713 = 1.764%; 3,713 / 65.5 = 56.7, about 57 years
  assert.deepEqual(m.slice(1, 6), ["$65.50", "1.8", "$3,713", "57", "20"]);
  // under 1% of the price: worked out, then held back as priced well above farm value
  assert.equal(r.charlotte.high, true);
  assert.equal(r.adams.high, false);
  assert.equal(r.one.high, false, "exactly 1%: shown");
  assert.equal(r.under1.high, true, "0.995%: held back");
  assert.equal(r.highline, "", "no county line");
  assert.equal(r.highattrs, ' data-ph="1"', "the map path carries only the flag");
  assert.equal(r.highcells, '<td data-v=""></td><td data-v=""><small>sale prices well above farm value</small></td>');
  assert.equal(m[6], SPAN, "the window as given");
  assert.equal(+m[7], 2026, "the rent year as given");
  assert.equal(r.none, "");
  assert.doesNotMatch(r.line, /—/, "no em dash");
});

test("the builder: a line only with 5+ sales and a current dry rent, worked again from the sale file", () => {
  const out = mkdtempSync(join(os.tmpdir(), "atlas-pr-"));
  // Adams IL: a line. Alachua FL: rent 0.37% of the price, priced above farm value. Citrus FL: under 5 sales. Iroquois IL: a 2022 rent. Atlantic NJ: only an
  // irrigated rent. Essex VT: no rent. Story IA: no sale file.
  const cases = { "17001": "illinois/adams-county", "12001": "florida/alachua-county", "12017": "florida/citrus-county",
    "17075": "illinois/iroquois-county", "34001": "new-jersey/atlantic-county", "50009": "vermont/essex-county", "19169": "iowa/story-county" };
  try {
    execFileSync("python3", ["scripts/build_atlas_pages.py", "--only", ...Object.keys(cases), "--out", out], { cwd: ROOT, env: ENV, stdio: "pipe" });
    let shown = 0, wanted = 0;
    for (const [f, path] of Object.entries(cases)) {
      const h = readFileSync(join(out, "farmland-atlas", path + ".html"), "utf8");
      const st = ATLAS[f].state.toLowerCase();
      let file = {};
      try { file = J(`data/land-sales/${st}.json`); } catch (e) { file = {}; }
      const u = ((file.counties || {})[f] || {}).usual;
      const R = ATLAS[f].rent || {};
      const dry = R.status === "ok" ? R.nonirr : null;
      const want = !!(u && u.med != null && u.n >= 5 && dry && dry.value != null && dry.year >= LATEST - 3 && dry.value / u.med * 100 >= 1);
      wanted += want ? 1 : 0;
      const m = LINE.exec(h);
      assert.equal(!!m, want, `${path}: line ${want ? "expected" : "not expected"}`);
      assert.equal(h.includes("Rent against price: the county"), want, `${path}: the Sources and terms note only beside a line`);
      if (!m) { assert.doesNotMatch(h, /data-pr/, path); continue; }
      shown++;
      const money = (x) => "$" + Math.floor(x + 0.5).toLocaleString("en-US");
      assert.equal(m[1], Number.isInteger(dry.value) ? money(dry.value) : "$" + dry.value.toFixed(2), `${path}: the rent as published`);
      assert.equal(m[3], money(u.med), `${path}: the same median as the sale file`);
      assert.equal(+m[5], u.n, `${path}: the sale count`);
      assert.equal(+m[7], dry.year, `${path}: the rent survey year`);
      const pct = dry.value / u.med * 100;
      assert.equal(m[2], pct >= 1 ? pct.toFixed(1) : pct.toFixed(2), `${path}: rent as a percent of the price`);
      assert.equal(m[4], Math.round(u.med / dry.value).toLocaleString("en-US"), `${path}: years of rent`);
      // the line sits right under the land block, inside no other section, and the block itself stays price-only
      const lf = h.indexOf('<section class="lf"'), at = h.indexOf("data-pr");
      if (lf >= 0) {
        assert.ok(at > h.indexOf("</section>", lf) && at < h.indexOf('<p class="sub">'), `${path}: under the land block`);
      }
      // the Sources and terms fold stays closed
      assert.match(h, /<details><summary>Sources and terms<\/summary>[\s\S]*Rent against price: the county[\s\S]*?<\/details>/);
    }
    assert.equal(shown, wanted, "every county the data allow shows its line (Adams IL on the Nov 2026 files)");
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test("the state page: two sortable columns from the same answer, only in a state with a sale file", () => {
  const r = py(`
W = B.World(".")
out = {}
for st in ("IL", "IA"):
    h = B.state_page(W, st)
    want = {f: B.county_price_rent(W, f, st) for f in W.by_state[st]}
    out[st] = {"th": "Median sale, 24 mo</th><th class=\\"s\\" scope=\\"col\\">Rent % of sale</th></tr>" in h,
               "attrs": h.count(" data-sp="), "want": sum(1 for v in want.values() if v and not v["high"]),
               "ph": h.count(' data-ph="1"'), "high": sum(1 for v in want.values() if v and v["high"]),
               "under5": sum(1 for f in W.by_state[st] if ((B.land_sales_file(W, st).get("counties") or {}).get(f) or {}).get("usual") is None and want[f]),
               "js": "about '+g('yr')+' yrs" in h, "pr1": "+(1?(g('ph')!==null?" in h and "sale prices well above farm value</small>" in h, "note": "shown with 5 or more sales" in h}
print(json.dumps(out))`);
  assert.equal(r.IL.th, true, "Illinois: the two columns");
  assert.equal(r.IL.attrs, r.IL.want, "one map path per county with an answer");
  assert.equal(r.IL.ph, r.IL.high, "one flag per county priced above farm value");
  assert.ok(r.IL.want >= 1, "Illinois has counties with an answer");
  assert.equal(r.IL.under5, 0, "no answer without a sale median");
  assert.ok(r.IL.js && r.IL.pr1 && r.IL.note, "the page script writes the cells; the note names the gate");
  assert.equal(r.IA.th, false, "Iowa: no sale file, no columns");
  assert.equal(r.IA.attrs, 0);
  assert.equal(r.IA.note, false);
});
