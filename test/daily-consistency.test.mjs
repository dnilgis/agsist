/* AGSIST Daily, Oct 16 benchmark: (1) a consistency check in the critic pass
 * (lead vs sections vs watch list vs homepage teaser), and (2) RMA's posted
 * harvest price dated next to ours. The hand-worked cases live in each
 * script's --selftest; this runs them and checks the real Oct 16 issue. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const py = (args, input) => execFileSync("python3", args, { cwd: ROOT, encoding: "utf8", input });

test("consistency check: selftest, and the published Oct 16 issue is caught", () => {
  assert.match(py(["scripts/briefing_consistency.py", "--selftest"]), /briefing_consistency selftest ok/);
  // the issue as first published at 5:47 am (the live archive file is regenerated later the same day)
  const f = join(ROOT, "test/fixtures/daily/2026-10-16-first-publish.json");
  const found = JSON.parse(py(["scripts/briefing_consistency.py", f]));
  const kinds = found.filter((x) => x.field === "watch_list" && x.index === 0).map((x) => x.kind).sort();
  assert.deepEqual(kinds, ["fund_flow", "trigger"], "the short-covering watch item, half a cent from its trigger");
  const fixed = JSON.parse(py(["-c", "import sys,json;sys.path.insert(0,'scripts');import briefing_consistency as c;b,l=c.fix(json.load(open(sys.argv[1])));print(json.dumps(b['watch_list']))", f]));
  assert.ok(fixed.every((w) => !/short-covering/.test(w.desc)), "the contradicting item is gone");
  assert.ok(fixed.some((w) => /^Crude holding above \$95/.test(w.desc)), "a sound item stays");
});

test("the critic pass runs the check: in the editor's payload and by code after it", () => {
  const src = readFileSync(join(ROOT, "scripts/critique_briefing.py"), "utf8");
  assert.match(src, /"consistency": briefing_consistency\.check\(briefing\)/);
  assert.match(src, /fixed, cons_log = briefing_consistency\.fix\(briefing\)/);
  assert.match(src, /"consistency": cons_log,/);
  assert.ok(src.indexOf("briefing_consistency.fix(") < src.indexOf("if rewrite_log and not args.dry_run"), "fixed before the archive is re-rendered");
});

test("harvest price clock dates RMA's figure beside ours", () => {
  assert.match(py(["scripts/harvest_clock.py", "--selftest"]), /harvest_clock selftest ok/);
  const src = readFileSync(join(ROOT, "scripts/harvest_clock.py"), "utf8");
  assert.ok(src.includes("RMA posts corn at $4.93 and soybeans at $12.87, both through Oct 14."), "the Oct 16 case is pinned");
});

test("no em dashes in the new script", () => {
  const s = readFileSync(join(ROOT, "scripts/briefing_consistency.py"), "utf8");
  assert.ok(!s.includes("—"));
});
