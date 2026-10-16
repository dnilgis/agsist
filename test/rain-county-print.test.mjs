/* The Rain Print on each county rain page (components/rain-county-print.js).
 * The days come packed in data/rain/daily/<st>.json (scripts/county_rain.py
 * pack_days); the page draws only when the engine's numbers from those days
 * agree with the page. This holds the JS unpacking to the Python packing, and
 * the engine's total from the unpacked days to the county file's total, on the
 * saved ACIS answers (and on the shipped daily files, when there are any).
 *
 *   node --test test/rain-county-print.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const ctx = { window: undefined };
ctx.window = ctx;
vm.createContext(ctx);
for (const f of ["components/rain-print.js", "components/rain-county-print.js"]) vm.runInContext(readFileSync(ROOT + f, "utf8"), ctx, { filename: f });
const { unpack, daysOf } = ctx.AgRainCountyPrint;
const RP = ctx.RainPrint;

test("JS unpacks what Python packs", () => {
  const vals = ["0.00", "0.00", "0.00", "0.00", "T", "1.25", "S", "S", "2.50A", "M", "M", "0.10", "0.10", "0.00"];
  const packed = execFileSync("python3", ["-c", `import sys,json;sys.path.insert(0,'scripts');import county_rain as R;print(R.pack_days(json.loads(sys.argv[1])))`, JSON.stringify(vals)], { cwd: ROOT, encoding: "utf8" }).trim();
  assert.deepEqual([...unpack(packed)], vals);
});

function checkDir(dir) {
  let n = 0;
  for (const f of readdirSync(join(dir, "daily"))) {
    const dd = JSON.parse(readFileSync(join(dir, "daily", f), "utf8"));
    const st = JSON.parse(readFileSync(join(dir, f), "utf8"));
    for (const [fips, rec] of Object.entries(dd.counties)) {
      const c = st.counties[fips];
      const days = daysOf(RP, dd.year, rec), d = RP.derive(days);
      assert.equal(days.length, c.days, `${f} ${fips}: days`);
      assert.ok(Math.abs(d.total - c.total) <= 0.011, `${f} ${fips}: engine total ${d.total} vs page ${c.total}`);
      assert.equal(d.missing, c.missing, `${f} ${fips}: missing days`);
      n++;
    }
  }
  return n;
}

test("the engine's numbers from the packed days match the county files (saved ACIS answers)", () => {
  const out = mkdtempSync(join(tmpdir(), "rcp-"));
  for (const [st, ed] of [["IA", "2026-10-12"], ["KS", "2026-10-12"], ["DE", "2024-12-31"]])
    execFileSync("python3", ["scripts/fetch_county_rain.py", "--fixtures", "test/fixtures/rain", "--out", out, "--states", st, "--edate", ed], { cwd: ROOT, stdio: "ignore" });
  assert.ok(checkDir(out) > 5);
});

test("shipped daily files match the shipped county files", () => {
  const dir = join(ROOT, "data/rain");
  if (!existsSync(join(dir, "daily"))) return;
  checkDir(dir);
});

test("county pages load the print script only with its placeholder, and never inline the art", () => {
  const dir = join(ROOT, "rain");
  if (!existsSync(dir)) return;
  for (const st of readdirSync(dir, { withFileTypes: true }).filter((x) => x.isDirectory())) {
    for (const f of readdirSync(join(dir, st.name))) {
      const h = readFileSync(join(dir, st.name, f), "utf8");
      assert.equal(h.includes("rain-county-print.js"), h.includes('id="rc-print"'), `${st.name}/${f}`);
      assert.ok(!h.includes("rain-print-art.js"), `${st.name}/${f} loads the art statically`);
    }
  }
});

test("county pages load the same Rain Print engine and art versions as /rain-print", () => {
  const rp = readFileSync(new URL("../rain-print.html", import.meta.url), "utf8");
  const cp = readFileSync(new URL("../components/rain-county-print.js", import.meta.url), "utf8");
  for (const f of ["rain-print-art.js", "rain-print.js"]) {
    const want = rp.match(new RegExp("/components/" + f.replace(/\./g, "\\.") + "\\?v=(\\d+)"))[1];
    assert.ok(cp.includes("/components/" + f + "?v=" + want), f + " should be ?v=" + want + " in rain-county-print.js");
  }
});

// 2026-10-16 (gaps1): the usual-year line. The page carries NOAA's normal for each month summed
// over the days the station reported (data-mn, the month table's own numbers); the print spreads
// each over that month's reported days. By hand: Jan 3 days all reported, Jan usual 0.30 ->
// 0.10 a day; Feb 2 days, one missing, Feb usual 0.20 -> 0.20 on the reported day, 0 on the
// missing one; year usual 0.50.
test("usualOf: month usuals spread over reported days, by hand", () => {
  const { usualOf } = ctx.AgRainCountyPrint;
  const days = [{ m: 0, v: 0 }, { m: 0, v: 0.5 }, { m: 0, v: 0 }, { m: 1, v: null }, { m: 1, v: 0.1 }];
  const o = usualOf(days, "0.30,0.20", "0.50");
  assert.deepEqual(o.daily.map((v) => +v.toFixed(4)), [0.1, 0.1, 0.1, 0, 0.2]);
  assert.ok(Math.abs(o.total - 0.5) < 1e-9);
  assert.equal(usualOf(days, "0.30,0.20", "0.60"), null, "a sum that is not the page's usual: no line");
  assert.equal(usualOf([{ m: 0, v: 0 }, { m: 1, v: null }], "0.30,0.20", "0.50"), null, "a month with a usual and no reported day: no line");
  assert.equal(usualOf(days, "", "0.50"), null, "no data: no line");
});

test("every shipped county page with a usual draws the line, and its month usuals are the page's", () => {
  const { usualOf } = ctx.AgRainCountyPrint;
  const dir = join(ROOT, "data/rain");
  if (!existsSync(join(dir, "daily"))) return;
  const names = JSON.parse(execFileSync("python3", ["-c",
    "import sys,json;sys.path.insert(0,'scripts');import build_county_rain as B;import glob,os\n" +
    "out={}\nfor f in glob.glob('rain/*/*.html'):\n  h=open(f).read()\n  import re\n  m=re.search(r'data-st=\"([a-z]{2})\" data-fips=\"(\\d+)\"[^>]*?data-mn=\"([^\"]+)\" data-usual=\"([^\"]+)\"',h)\n  if m: out[m.group(1)+m.group(2)]=[m.group(3),m.group(4)]\nprint(json.dumps(out))"],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 26 }));
  let drawn = 0, n = 0;
  for (const f of readdirSync(join(dir, "daily"))) {
    const dd = JSON.parse(readFileSync(join(dir, "daily", f), "utf8"));
    const st = JSON.parse(readFileSync(join(dir, f), "utf8"));
    for (const [fips, rec] of Object.entries(dd.counties)) {
      const pg = names[f.slice(0, 2) + fips];
      if (!pg) continue;
      n++;
      const days = daysOf(RP, dd.year, rec), o = usualOf(days, pg[0], pg[1]);
      assert.ok(o, `${f} ${fips}: no usual line though the page has a usual`);
      const mn = pg[0].split(",").map(Number), sums = mn.map(() => 0);
      days.forEach((x, i) => { sums[x.m] += o.daily[i]; });
      mn.forEach((v, m) => assert.ok(Math.abs(sums[m] - v) < 0.006, `${f} ${fips} month ${m + 1}: ${sums[m]} vs ${v}`));
      assert.ok(Math.abs(o.total - st.counties[fips].usual) <= 0.02, `${f} ${fips}: year usual`);
      drawn++;
    }
  }
  assert.ok(n > 1000 && drawn === n, `${drawn} of ${n}`);
});
