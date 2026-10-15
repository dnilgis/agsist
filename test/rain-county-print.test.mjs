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
