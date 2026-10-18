/* The generated page sets after the Oct 18, 2026 accuracy pass
 * (accuracy-pass/sets-2026-10 on the raw branch, 138 leads). One test per class
 * of fix, held against the builders' own selftests and against the pages as
 * they are built now, so a regression in a builder or a stale page shows here.
 *
 *   node --test test/accuracy-sets-oct18.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const py = (args) => execFileSync("python3", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 << 20 });
const read = (p) => readFileSync(ROOT + p, "utf8");
function pages(dir, keep = (f) => f.endsWith(".html") && f !== "index.html") {
  const out = [];
  for (const st of readdirSync(ROOT + dir, { withFileTypes: true })) {
    if (!st.isDirectory()) continue;
    for (const f of readdirSync(ROOT + dir + "/" + st.name)) if (keep(f)) out.push(dir + "/" + st.name + "/" + f);
  }
  return out;
}
const text = (h) => h.replace(/<[^>]+>/g, " ").replace(/&rsquo;|&#x27;/g, "'").replace(/\s+/g, " ");

test("Atlas builder selftest: one planted read per class is dropped, true reads pass, shares round once", () => {
  assert.match(py(["scripts/build_atlas_pages.py", "--selftest"]), /selftest: ok/);
});

test("Atlas county pages: every written read that prints passes the sets-pass read gate", () => {
  const out = py(["-c", `
import sys, json, re, glob, html
sys.path.insert(0, "scripts")
import build_atlas_pages as A
bad, n = [], 0
for p in glob.glob("farmland-atlas/*/*.html"):
    h = open(p, encoding="utf-8").read()
    m = re.search(r'<div class="read"><p style="margin:0">(.*?)</p></div>', h)
    if not m:
        continue
    f = re.search(r"FIPS (\\d{5})", h).group(1)
    d = json.load(open("data/atlas/counties/%s.json" % f, encoding="utf-8"))
    n += 1
    w = A.read_wrong(html.unescape(m.group(1)), d, 2026)
    if w:
        bad.append((p, w))
print(json.dumps({"n": n, "bad": bad[:5], "nbad": len(bad)}))
`]);
  const r = JSON.parse(out);
  assert.ok(r.n > 50, `reads still print on pages with no story (${r.n})`);
  assert.equal(r.nbad, 0, JSON.stringify(r.bad));
});

test("Atlas county pages: a worst year, a drought share and the rent-per-bushel note say only what the record gives", () => {
  let worst = 0, d2 = 0, withheld = 0;
  for (const p of pages("farmland-atlas")) {
    const h = read(p);
    // the worst year names the gate it is out of; Cole Co., MO printed 0.29 as its "worst" from 1 gated year
    for (const m of h.matchAll(/Worst year<\/span><span class="r">\d{4}<small>([^<]*)<\/small>/g)) {
      worst++;
      assert.match(m[1], /^ratio \d+\.\d\d, of the \d+ crop years with at least \$1,000,000 of premium$/, p);
    }
    // 142 of 1,357 weeks is 10%, not the stored 10.5 rounded again to 11%
    const w = h.match(/(\d[\d,]*) of (\d[\d,]*) weeks<small>(\d+)% of weeks/);
    if (w) {
      d2++;
      const a = +w[1].replace(/,/g, ""), b = +w[2].replace(/,/g, "");
      assert.equal(+w[3], Math.round((100 * a) / b + 1e-9), p);
    }
    if (h.includes("Rent per bushel is withheld here")) withheld++;
    assert.ok(!(h.includes("rent-per-bushel trend withheld") && h.includes("Rent per bushel uses this year")), p + ": trend withheld but the note uses it");
    assert.ok(!h.includes("The census value is this county's, from") || !/Land and buildings, \d{4}<\/span><span class="r">n\/a/.test(h), p + ": suppressed census value called this county's");
  }
  assert.ok(worst > 1000 && d2 > 2000 && withheld > 50, `${worst} worst years, ${d2} drought shares, ${withheld} withheld notes`);
  assert.match(read("farmland-atlas/nevada/index.html"), /with history back to 2009/);
});

test("Atlas, PRF and county rain story validators: the sets-pass classes are caught, true stories pass", () => {
  assert.match(py(["scripts/stories_core.py", "selftest", "atlas", "prf"]), /atlas stories selftest: ok[\s\S]*prf stories selftest: ok/);
  assert.match(py(["scripts/county_stories.py", "selftest"]), /county stories selftest: ok/);
});

test("PRF county pages: a pair of months priced on fewer grids says how many and is never 'the middle of' all of them", () => {
  let few = 0;
  for (const p of pages("prf")) {
    const h = read(p);
    const ng = +(h.match(/<dt>Grids<\/dt><dd>(\d+)<\/dd>/) || [0, 0])[1];
    const rows = [...h.matchAll(/<span class="prf-th-s">(\d+) of (\d+) grids<\/span>/g)];
    if (!rows.length) continue;
    few++;
    for (const r of rows) assert.ok(+r[1] < +r[2] && +r[2] === ng, p);
    assert.ok(!h.includes(`first the middle of the ${ng} for that pair of months`), p);
  }
  assert.ok(few >= 30, `counties with a row on fewer grids (${few})`);
  assert.match(read("prf/california/madera-county.html"), /3 of 19 grids/);
});

test("ARC/PLC county pages: a trigger over the benchmark never prints a whole number under it, titles round half up", () => {
  assert.match(py(["scripts/build_arc_plc.py", "--selftest"]), /OK: 0 failure/);
  let over = 0;
  for (const p of pages("arc-plc", (f) => f.endsWith(".html") && !f.endsWith("-sheet.html"))) {
    const h = read(p);
    for (const m of h.matchAll(/under <b>([\d,.]+) (?:bu|lb)<\/b>[^<]*?That is above the ([\d,.]+) (?:bu|lb) benchmark/g)) {
      over++;
      assert.ok(+m[1].replace(/,/g, "") > +m[2].replace(/,/g, ""), `${p}: under ${m[1]} said to be above ${m[2]}`);
    }
  }
  assert.ok(over > 100, `trigger lines over the benchmark (${over})`);
  assert.match(read("arc-plc/kansas/chase-county.html"), /<title>Chase County, KS ARC or PLC 2026: Wheat Benchmark 54\.1 bu/);
  assert.ok(!read("arc-plc/texas.html").includes("ARC-CO benchmark yield (bu/acre)"), "state dataset names pound crops");
});

test("County rain pages: the gauge's coordinates sit on the gauge, not on the county", () => {
  const h = read("rain/texas/bowie-county.html");
  const ld = [...h.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((m) => JSON.parse(m[1]));
  const ds = ld.find((x) => x["@type"] === "Dataset");
  const places = [].concat(ds.spatialCoverage);
  assert.ok(places.some((x) => x.name === "Bowie County, Texas" && !x.geo), "the county, with no point");
  assert.ok(places.some((x) => /TEXARKANA/.test(x.name) && x.geo && x.geo.latitude === 33.4368), "the gauge, with its point");
});

test("Hail state, state yield and cash bid pages: no claim the data does not hold, time zone named", () => {
  for (const f of readdirSync(ROOT + "hail-map").filter((f) => f.endsWith(".html"))) assert.ok(!read("hail-map/" + f).includes("persistent leaders"), f);
  for (const f of readdirSync(ROOT + "yield").filter((f) => f.endsWith(".html"))) assert.ok(!read("yield/" + f).includes("where NASS publishes them"), f);
  const out = py(["-c", `
import sys, datetime as dt
sys.path.insert(0, "scripts")
import build_cash_bid_pages as C
print(C.asof_time(dt.datetime(2026, 10, 16, 19, 13, tzinfo=dt.timezone.utc)))
`]);
  assert.match(out, /Updated Oct 16, 2:13 pm CT<\/time>/);
  const src = read("scripts/build_cash_bid_pages.py");
  assert.match(src, /Kept apart: a basis against one futures contract does not compare with another/);
});

test("Daily voice lint: an index level in dollars is a tell", () => {
  assert.match(py(["scripts/voice_lint.py", "--selftest"]), /voice_lint selftest: 0 failure/);
});
