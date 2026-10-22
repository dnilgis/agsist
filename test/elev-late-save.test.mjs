/* A late elevator save keeps its own time (Sig, Oct 22 2026): the page sends
 * entered_at with every save, the worker (v5.50) stores it and refuses a save
 * older than the listing's newest change (scripts/test_elev_worker.mjs runs
 * the worker), and the board says when the elevator last saved, in plain
 * time: "Updated 6:10 AM Wed".
 *
 *   node --test test/elev-late-save.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");
const CB = read("components/cash-bids.js");

function portalWhen() {
  const src = /function portalWhen\(ms,nowMs\)\{[\s\S]*?\n\}/.exec(CB)[0];
  const c = {};
  vm.runInNewContext(src + "; this.portalWhen = portalWhen;", c);
  return c.portalWhen;
}

test("the board's time: 'Updated 6:10 AM Wed' in Central time, the date past six days", () => {
  const f = portalWhen();
  const wed = Date.parse("2026-10-21T11:10:00Z");                  // 6:10 AM CDT, Wednesday
  assert.equal(f(wed, Date.parse("2026-10-22T15:00:00Z")), "6:10 AM Wed");
  assert.equal(f(wed, Date.parse("2026-10-30T15:00:00Z")), "6:10 AM Oct 21");
  assert.equal(f(Date.parse("2026-12-02T20:05:00Z"), Date.parse("2026-12-03T12:00:00Z")), "2:05 PM Wed", "CST in winter");
});

test("a card for an elevator that posts its own bids always says when it last saved", () => {
  assert.match(CB, /fromPortal:!!\(shard\.info&&typeof shard\.info==='object'&&!Array\.isArray\(shard\.info\)\),/);
  assert.match(CB, /if\(b\.fromPortal\)e\.fromPortal=true;/);
  assert.match(CB, /if\(elev\.fromPortal&&elev\.asOfT!=null\)\{\n\s+html\+='<div class="elev-posted'\+\(mktSessionsClosedSince\(elev\.asOfT,new Date\(\)\)>=2\?' elev-stale':''\)\+'" title="When this elevator last saved its bids on AGSIST">Updated '\+escH\(portalWhen\(elev\.asOfT,Date\.now\(\)\)\)\+'<\/div>';/);
  assert.match(read("cash-bids.html"), /<script src="\/components\/cash-bids\.js\?v=12"><\/script>/);
});

test("the page sends the time Save was pressed with every save, and a kept save is never dropped for age", () => {
  const E = read("components/elev-post.js");
  assert.match(E, /closed_today: form\.closed, entered_at: new Date\(\)\.toISOString\(\) \};/);
  assert.match(E, /var nb = \{ k: key, no_change: true, entered_at: new Date\(\)\.toISOString\(\) \};/);
  assert.doesNotMatch(E, /expires:/);
  assert.match(E, /A newer save is already posted\. Open the page again to see it\./);
});

test("the worker keeps the entry time and lets the newer save win (scripts/test_elev_worker.mjs)", () => {
  const out = execFileSync(process.execPath, [ROOT + "scripts/test_elev_worker.mjs"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  assert.match(out, /elevator portal worker: \d+ checks passed/);
  const W = read("workers/subs-worker.js");
  assert.match(W, /v5\.50 \(2026-10-22\): A LATE ELEVATOR SAVE KEEPS ITS OWN TIME/);
  assert.match(W, /if \(atMs < newest\) return json\(\{ ok: false, error: "A newer save from this elevator is already posted, so this older one was not used\.", newer: true/);
  assert.match(read("scripts/test_elev_worker.mjs"), /v5\.50: with its own entry time, not the delivery time/);
  assert.match(read("scripts/test_elev_worker.mjs"), /v5\.50: a delayed save older than the newest change is refused/);
});
