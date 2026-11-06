/* Every schedule that matters is gated (Nov 3, 2026). GitHub's scheduler never started land-data.yml's
 * monthly run on Nov 3, so the land sale email that afternoon found no October files and mailed none
 * of its readers ("wait-data"); the same class as Nov 2 (rain-monthly, county-rain; #245). Sig: stop
 * foreseeable failures. So every data, page and email workflow with a schedule that matters also runs
 * after "Fetch Grain Bids" (cron-job.org, every 15 minutes), and a cron_gate.py tick step carrying the
 * workflow's own schedule lets one run per tick do the work. This file holds, for each of them:
 *   - it runs on workflow_run after Fetch Grain Bids, its schedule unchanged, a run by hand kept;
 *   - the gate step carries exactly the schedule's crons, and the max-lag window closes before the
 *     next tick and inside six hours;
 *   - every working job needs the gate and runs only on go; the queue is per job, not per workflow;
 *   - a chained run takes the scheduled path (no step tells schedule apart from workflow_run);
 *   - a run by hand or a push does not use up the tick, and cron health watches the gate clock.
 * And the inventory: a workflow with a schedule is gated, or it is listed below with the reason it is
 * not, so a new schedule cannot slip in ungated.
 *
 *   node --test test/cron-gated.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const WF = path.join(ROOT, ".github/workflows");
const read = (f) => fs.readFileSync(path.join(WF, f), "utf8");

// workflow, its schedule (unchanged from before the gate), the gate's max-lag in minutes
const GATED = [
  ["agstocks.yml", ["17 22 * * 1-5"], 360],
  ["analyst-scorecard.yml", ["25 11 * * *"], 360],
  ["cash-bid-index.yml", ["23 11 1 * *"], 360],
  ["cash-rent.yml", ["20 14 * * 3"], 360],
  ["cattle-auction.yml", ["23 1 * * 2-6", "37 14 * * 1-5"], 360],
  ["cattle-cash.yml", ["43 21 * * 1-5", "17 15 * * 1,2"], 360],
  ["ccc-loan.yml", ["23 14 1-5 * *", "23 14 15 * *"], 360],
  ["climate-indices.yml", ["37 14 9 * *"], 360],
  ["cot-deep-rebuild.yml", ["20 9 * * 0"], 360],
  ["coverage-map.yml", ["38 12 * * *"], 360],
  ["dairy.yml", ["37 15 1-9 * *", "37 21 1-9 * *", "37 15 28-31 * *", "11 14 * * 2", "23 16 15-27 * *"], 76],
  ["drought-county-week.yml", ["52 13 * * 4", "37 14 * * 5"], 360],
  ["fall-nitrogen.yml", ["23 13 * 3-6,9-12 *", "47 22 * 3-6,9-12 *"], 360],
  ["farmland-atlas.yml", ["17 9 12 * *"], 360],
  ["fertilizer-ams.yml", ["23 20 * * 5", "23 1 * * 6", "23 15 * * 1"], 290],
  ["fertilizer-coops.yml", ["41 13 * * 1-5"], 360],
  ["fetch-fsa-arcplc.yml", ["37 13 * * 1"], 360],
  ["hail-data.yml", ["41 6 1 * *"], 360],
  ["hail-states.yml", ["20 6 2 * *"], 360],
  ["hay-ams.yml", ["17 23 * * 1-5", "41 14 * * 6"], 360],
  ["hay-prices.yml", ["23 20 27-31 * *", "23 14 1,2 * *"], 360],
  ["land-data.yml", ["23 9 3 * *"], 360],
  ["list-hygiene.yml", ["23 13 * * *"], 360],
  ["markets.yml", ["23 9 * * *"], 360],
  ["mesh.yml", ["25 8 * * *"], 360],
  ["nass-series.yml", ["45 12 16 * *"], 360],
  ["ncei.yml", ["47 8 15 1 *"], 360],
  ["planting-normals.yml", ["23 9 2 2 *"], 360],
  ["predictions.yml", ["41 19 * * 1-5", "41 20 * * 1-5", "41 22 * * 1-5", "41 23 * * 1-5"], 50],
  ["prf-outlook.yml", ["47 15 * * 4", "17 11 * * 5"], 360],
  ["prf-season.yml", ["23 14 * * *"], 360],
  ["prf.yml", ["23 10 * * 3"], 360],
  ["radar-rain.yml", ["17 1,7,13,19 * * *"], 350],
  ["refs.yml", ["23 9 3 * *"], 360],
  ["rma-prices.yml", ["10 22 * * *"], 360],
  ["rp-canada-stations.yml", ["23 9 3 * *"], 360],
  ["rp-design-email.yml", ["23 * * * *"], 50],
  ["seasonal-models.yml", ["41 15 15 11,12 *"], 360],
  ["share-images.yml", ["23 12 * * *"], 360],
  ["site-usage.yml", ["37 14 2 * *"], 360],
  ["sitemap.yml", ["17 9 * * *"], 360],
  ["sponsor-report.yml", ["12 11 * * *"], 360],
  ["state-rent-pages.yml", ["55 15 * * 3"], 360],
  ["stats-ingest.yml", ["47 12 * * *"], 360],
  ["storage.yml", ["35 7 20 1 *", "35 7 1,14 10 *", "35 7 14 11 *"], 360],
  ["tenure.yml", ["25 6 15 2 *"], 360],
  ["transport.yml", ["43 11 * * 5"], 360],
  ["vintage.yml", ["37 17 * * 1-5"], 360],
  ["whats-priced-in.yml", ["20 11 * * *"], 360],
  // Nov 4, 2026 (BUILD-RULES 59): data commits carry [skip ci], so main could sit red for hours unseen
  ["main-checks.yml", ["17 */2 * * *"], 100],
];

// Scheduled workflows that are not gated by a tick of their own, and why.
const NOT_GATED = {
  "fetch_bids.yml": "the chain itself: cron-job.org dispatches it every 15 minutes; its cron is GitHub's fallback",
  "prices.yml": "dispatched by cron-job.org every 15 minutes; hourly cron is the fallback",
  "price-watch.yml": "runs after every Fetch Prices; the cron is a fallback",
  "elevator-watch.yml": "runs after every Fetch Grain Bids; the cron is a fallback",
  "form-digest.yml": "runs after every Fetch Grain Bids; the cron is a fallback",
  "sponsor-apply.yml": "runs after every Fetch Grain Bids; the cron is a fallback",
  "weekend-heartbeat.yml": "runs after every Fetch Grain Bids and starts the Daily on weekends",
  "wasde-watch.yml": "runs after every Fetch Grain Bids on WASDE days (cron health watches it)",
  "cash-bid-pages.yml": "runs after every Fetch Grain Bids; the six-hourly cron is a backstop",
  "farmland-atlas-watch.yml": "runs after every Fetch Grain Bids; the hourly cron is a fallback",
  "farmland-atlas-pages.yml": "runs after farmland-atlas, land-data and the credit workflows; the weekly cron is a backstop",
  "report-day.yml": "runs after WASDE watch, What's Priced In and Fetch Grain Bids (cron health watches it)",
  "arc-plc-refresh.yml": "runs after WASDE watch; the Monday and signup crons are a backstop (open: gate the Monday tick)",
  "croptour.yml": "runs after WASDE watch; the daily cron is a backstop",
  "state-stats.yml": "runs after WASDE watch; the monthly cron is a backstop",
  "yield-panel.yml": "runs after WASDE watch; the daily cron is a backstop",
  "yield-pages.yml": "runs after Build State Stats; the monthly cron is a backstop",
  "cot.yml": "cot-release-watch.yml (gated) is the fast path; these crons are the backstop",
  "daily.yml": "the Daily is started by morning-report.yml and weekend-heartbeat.yml (both chained) and watched by daily_late.py",
  "daily-site-check.yml": "a watcher on GitHub's own cron on purpose, so it still reports when cron-job.org stops",
  "audit.yml": "a render audit with no published output; a missed day is caught the next day",
  "feeds-guard.yml": "a weekly guard with no published output",
  "schedule-guard.yml": "a weekly guard with no published output",
  "gsc-sitemaps.yml": "a weekly sitemap submission to Search Console; a missed week changes nothing readers see",
  "indexnow.yml": "a weekly IndexNow submission; a missed week changes nothing readers see",
  "seo-weekly.yml": "an internal noindex report for Sig; a missed week changes nothing readers see",
  "tools-fresh.yml": "hourly; gating it would add up to 24 commits a day to main, and the next fire that arrives catches up",
  "fetch_outlooks.yml": "every two hours for sources that change twice a month or weekly; any fire that arrives catches up",
  "mesh-partial.yml": "hourly March to September (off season now); gating would add up to 24 commits a day in season",
};

const job = (wf, name) => {
  const i = wf.indexOf("\n  " + name + ":\n");
  assert.ok(i > 0, "job " + name);
  const rest = wf.slice(i + 1);
  const next = rest.slice(1).search(/\n  [a-z][\w-]*:\n/);
  return next < 0 ? rest : rest.slice(0, next + 1);
};
const jobs = (wf) => [...wf.slice(wf.indexOf("\njobs:\n")).matchAll(/\n  ([a-z][\w-]*):\n/g)].map((m) => m[1]);
const onBlock = (wf) => wf.slice(wf.indexOf("\non:\n"), wf.indexOf("\njobs:\n"));
const crons = (wf) => [...onBlock(wf).matchAll(/^\s+- cron: ["']([^"']+)["']/gm)].map((m) => m[1]);

// the shortest gap between two ticks of each schedule over a year, from cron_gate.py's own cron reader
const gaps = JSON.parse(execFileSync("python3", ["-c", `
import json, sys
sys.path.insert(0, "scripts")
from datetime import datetime, timedelta, timezone
from cron_gate import ticks
b = datetime(2026, 1, 1, tzinfo=timezone.utc)
out = {}
for wf, cr in json.loads(sys.argv[1]):
    t = ticks(cr, b, b + timedelta(days=366))
    out[wf] = min(int((y - x).total_seconds() // 60) for x, y in zip(t, t[1:])) if len(t) > 1 else None
print(json.dumps(out))
`, JSON.stringify(GATED.map(([f, c]) => [f, c]))], { cwd: ROOT, encoding: "utf8" }));

for (const [file, sched, lag] of GATED) {
  test(`${file}: runs after Fetch Grain Bids, gated to its own schedule`, () => {
    const wf = read(file);
    const on = onBlock(wf);
    assert.deepEqual(crons(wf), sched, "the schedule is unchanged");
    assert.match(on, /\n  workflow_run:\n    workflows: \["Fetch Grain Bids"\]\n    types: \[completed\]\n/);
    assert.match(on, /\n  workflow_dispatch:/, "a run by hand stays");

    const gate = job(wf, "gate");
    const m = /python3 scripts\/cron_gate\.py tick --workflow (\S+) --max-lag (\d+)((?:\n\s+--cron "[^"]+")+)/.exec(gate);
    assert.ok(m, "a cron_gate.py tick step");
    assert.equal(m[1], file, "the gate counts this workflow's own runs");
    assert.deepEqual([...m[3].matchAll(/--cron "([^"]+)"/g)].map((x) => x[1]), sched, "the gate carries the schedule's own crons");
    assert.equal(Number(m[2]), lag);
    assert.ok(lag <= 360, "the window closes inside six hours");
    if (gaps[file] !== null) assert.ok(lag < gaps[file], `the window (${lag} min) closes before the next tick (${gaps[file]} min on)`);
    assert.match(gate, /permissions:\n\s+actions: read\n\s+contents: read\n/, "the gate may list runs and nothing more");
    // predictions.yml (Nov 6): a second step, the entry-day pass, may also say go when the tick did not
    const predict = file === "predictions.yml";
    if (predict) {
      assert.match(gate, /outputs:\n\s+go: \$\{\{ steps\.g\.outputs\.go == '1' && '1' \|\| steps\.p\.outputs\.go \}\}/);
      assert.match(gate, /- id: p\n\s+if: steps\.g\.outputs\.go != '1'\n\s+run: python3 scripts\/cron_gate\.py predict\n/);
    } else assert.match(gate, /outputs:\n\s+go: \$\{\{ steps\.g\.outputs\.go \}\}/);
    assert.match(gate, new RegExp("sparse-checkout: \\|\\n\\s+scripts/cron_gate\\.py\\n" + (predict ? "\\s+data/predictions\\.json\\n" : "") +
      "\\s+/\\.github/actions/engine/\\n\\s+/\\.github/engine-paths\\n\\s+sparse-checkout-cone-mode: false"),
      "the skip is cheap: only the gate script and the engine step are checked out");
    assert.match(gate, /persist-credentials: false/);
    assert.ok(gate.indexOf("name: Engine checkout") > gate.indexOf("actions/checkout@v4") && gate.indexOf("name: Engine checkout") < gate.indexOf("python3 scripts/cron_gate.py"),
      "the engine step right after the checkout, before the gate runs");
    assert.match(gate, /GH_TOKEN: \$\{\{ github\.token \}\}/);

    for (const name of jobs(wf).filter((j) => j !== "gate")) {
      const j = job(wf, name);
      assert.match(j, /\n    needs: (gate|\[gate(, [\w-]+)+\])\n/, name + " needs the gate");
      assert.match(j, /\n    if: needs\.gate\.outputs\.go == '1'( && \(.*\))?\n/, name + " runs only when the gate says go");
    }
    assert.doesNotMatch(wf.slice(0, wf.indexOf("\njobs:\n")), /^concurrency:/m,
      "the queue is on the working job, not the workflow: a skipped chained run never waits or replaces one");

    // a chained run takes the scheduled path
    for (const x of wf.matchAll(/github\.event_name == 'schedule'(.{0,40})/g)) {
      assert.ok(x[1].startsWith(" || github.event_name == 'workflow_run'"), "where a step asks for a scheduled run, a chained run counts too: " + x[0]);
    }
    assert.doesNotMatch(wf, /event_name != 'schedule'|event\.schedule|"schedule" \]/, "no step tells a scheduled run from a chained one");
  });
}

// GitHub expressions in these lines use only ==, !=, &&, || and parentheses on strings and booleans.
// GitHub compares a missing input to false as equal (null and false both coerce to 0); so does JS's ==.
const evalExpr = (expr, ctx) => {
  const js = expr
    .replace(/github\.event_name/g, JSON.stringify(ctx.event))
    .replace(/github\.ref_name/g, JSON.stringify("main"))
    .replace(/vars\.(\w+)/g, (_, k) => JSON.stringify((ctx.vars || {})[k] || ""))
    .replace(/inputs\.(\w+)/g, (_, k) => (k in (ctx.inputs || {}) ? JSON.stringify(ctx.inputs[k]) : "null"))
    .replace(/'([^']*)'/g, (_, s) => JSON.stringify(s))
    .replace(/null == false/g, "true");
  assert.doesNotMatch(js, /[a-z_]+\.[a-z_]/i, "every name replaced: " + js);
  return Function("return (" + js + ");")();
};
const envExpr = (wf, key) => {
  const m = new RegExp("\\n\\s+" + key + ": \\$\\{\\{ (.*) \\}\\}\\n").exec(wf);
  assert.ok(m, key);
  return m[1];
};

test("rp-design-email.yml: a chained run is exactly as live as a scheduled run; never live without the variable", () => {
  // Nov 3, 2026: on main this line reads '1' (dry) in every case, the variable or not: (A && '') is
  // falsy, so the || falls through to '1'. Reported, not changed here: making it live would start
  // reader email. This holds what the gate must not change.
  const dry = envExpr(read("rp-design-email.yml"), "DRY_RUN");
  for (const vars of [{ RP_DESIGN_EMAIL_LIVE: "1" }, {}]) {
    assert.equal(evalExpr(dry, { event: "workflow_run", vars }), evalExpr(dry, { event: "schedule", vars }),
      "chained and scheduled agree (" + JSON.stringify(vars) + ")");
  }
  assert.equal(evalExpr(dry, { event: "workflow_run", vars: {} }), "1", "chained: dry without the variable (a missing input is not dry_run false)");
  assert.equal(evalExpr(dry, { event: "workflow_dispatch", vars: {}, inputs: { dry_run: true } }), "1", "by hand: dry by default");
});

test("dairy.yml: a chained run sends the milk price email exactly like the scheduled run", () => {
  const send = envExpr(read("dairy.yml"), "SEND");
  assert.equal(evalExpr(send, { event: "schedule" }), "1");
  assert.equal(evalExpr(send, { event: "workflow_run" }), "1", "chained: the scheduled path");
  assert.equal(evalExpr(send, { event: "workflow_dispatch", inputs: { email: "dry" } }), "", "by hand: dry by default");
});

test("land-data.yml: a chained run checks the services and fetches every state's transfers, like the scheduled run", () => {
  const wf = read("land-data.yml");
  for (const step of ["Check parcel services", "Build transfers", "Wisconsin transfer returns (browser)"]) {
    const i = wf.indexOf("- name: " + step);
    assert.ok(i > 0, step);
    const iff = /\n\s+if: \$\{\{ (.*) \}\}\n/.exec(wf.slice(i))[1];
    assert.match(iff, /github\.event_name == 'schedule' \|\| github\.event_name == 'workflow_run'/, step + ": a chained run takes it");
  }
  assert.match(job(wf, "build"), /concurrency:\n\s+group: land-data\n\s+cancel-in-progress: false/);
});

test("prf-season.yml: a chained run builds, like the scheduled run (a run by hand defaults to a probe)", () => {
  const wf = read("prf-season.yml");
  const ifs = [...wf.matchAll(/\n\s+if: \$\{\{ (github\.event_name == 'schedule'.*) \}\}\n/g)].map((m) => m[1]);
  assert.equal(ifs.length, 2);
  for (const iff of ifs) {
    assert.equal(evalExpr(iff, { event: "workflow_run" }), true);
    assert.equal(evalExpr(iff, { event: "workflow_dispatch", inputs: { mode: "probe" } }), false);
  }
});

test("every workflow with a schedule is gated, or listed here with the reason it is not", () => {
  const gated = new Set(GATED.map(([f]) => f));
  const scheduled = fs.readdirSync(WF).filter((f) => f.endsWith(".yml") && crons(read(f)).length);
  for (const f of scheduled) {
    const wf = read(f);
    const ticks = /cron_gate\.py (tick|cot|lrp|conditions|condyield)/.test(wf);
    assert.ok(ticks || NOT_GATED[f], f + ": has a schedule but no gate and no reason here (GitHub drops scheduled fires; see scripts/cron_gate.py)");
    if (gated.has(f)) assert.ok(ticks, f);
  }
  for (const [f, why] of Object.entries(NOT_GATED)) {
    assert.ok(scheduled.includes(f), f + ": listed as not gated but has no schedule (remove it here)");
    assert.doesNotMatch(read(f), /cron_gate\.py tick/, f + ": gated now; move it to the gated list");
    assert.ok(why.length > 20, f + ": a reason");
  }
});

test("the gate passes over runs by hand for these, the land email retries after late land data, and cron health watches every gate clock", () => {
  const out = execFileSync("python3", ["scripts/cron_gate.py", "--selftest"], { cwd: ROOT, encoding: "utf8" });
  assert.match(out, /all cron_gate checks passed/);
  for (const name of [
    "the four mail and rain workflows and the 50 gated Nov 3 and 4, and only those, ignore runs by hand",
    "land email: the first chained run after late land data goes once more",
    "land email: only one retry per land data commit",
    "land email: the land data landed before the tick's run, no retry",
    "land email: a dry run by hand after the land run does not use up the retry",
    "the land email, and only it, retries after its feed"]) {
    assert.ok(out.includes("ok   " + name), "cron_gate selftest ran: " + name);
  }
  const gateSrc = fs.readFileSync(path.join(ROOT, "scripts/cron_gate.py"), "utf8");
  const nov3 = /GATED_NOV3 = \{([^}]*)\}/.exec(gateSrc)[1];
  assert.deepEqual([...nov3.matchAll(/"([\w.-]+\.yml)"/g)].map((m) => m[1]).sort(), GATED.map(([f]) => f).sort(),
    "cron_gate.py's list of workflows that ignore runs by hand is exactly the gated list here");

  const ch = execFileSync("python3", ["scripts/cron_health.py", "--selftest"], { cwd: ROOT, encoding: "utf8" });
  assert.match(ch, /all cron_health checks passed/);
  const src = fs.readFileSync(path.join(ROOT, "scripts/cron_health.py"), "utf8");
  for (const [file] of [...GATED, ["land-alert.yml"]]) {
    assert.match(src, new RegExp('\\("' + file.replace(/[.]/g, "\\.") + '", None, \\d+, False,'), file + ": the row reads the gate clock");
    assert.ok(ch.includes("ok   " + file + ": gated row, its clock is the workflow's schedule"), file + ": cron health checked the gate clock");
  }
});

// PR #285 review (Nov 3, 2026): a gated workflow's skipped runs still end "success", so a workflow that
// follows it on workflow_run would rebuild or mail every 15 minutes (the Atlas page rebuild, the hail
// alert email, report-day's send). Every follower of a filtered workflow (one with a job named "gate" or
// "upstream") checks that the run that started it did its work, with one shared action.
const ALL = JSON.parse(execFileSync("python3", ["-c", `
import glob, json, os, yaml
out = {}
for f in sorted(glob.glob(".github/workflows/*.yml")):
    y = yaml.safe_load(open(f))
    on = y.get(True) or y.get("on") or {}
    out[os.path.basename(f)] = {
        "name": y.get("name"),
        "after": (on.get("workflow_run") or {}).get("workflows", []) if isinstance(on, dict) else [],
        "concurrency": "concurrency" in y,
        "jobs": {k: {"name": v.get("name"), "needs": v.get("needs"), "if": v.get("if"),
                     "permissions": v.get("permissions"), "steps": v.get("steps") or [],
                     "outputs": v.get("outputs")} for k, v in (y.get("jobs") or {}).items()},
    }
print(json.dumps(out))
`], { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 26 }));
const BY_NAME = Object.fromEntries(Object.entries(ALL).map(([f, w]) => [w.name, f]));
const FILTERED = new Set(Object.entries(ALL).filter(([, w]) => w.jobs.gate || w.jobs.upstream).map(([f]) => f));

test("the filter jobs keep their ids as names, so the upstream check can find them", () => {
  for (const [f, w] of Object.entries(ALL)) {
    for (const id of ["gate", "upstream"]) {
      if (w.jobs[id]) assert.ok(!w.jobs[id].name || w.jobs[id].name === id, `${f}: job ${id} must not be renamed`);
    }
  }
});

test("every workflow that follows a filtered workflow acts only when that run did its work", () => {
  const followers = Object.entries(ALL).filter(([, w]) => w.after.some((n) => FILTERED.has(BY_NAME[n])));
  assert.ok(followers.length >= 11, "the followers found: " + followers.map(([f]) => f).join(", "));
  for (const [f, w] of followers) {
    const up = w.jobs.upstream;
    assert.ok(up, `${f}: follows ${w.after.filter((n) => FILTERED.has(BY_NAME[n])).join(", ")} but has no upstream job`);
    assert.ok(up.steps.some((s) => s.uses === "./.github/actions/upstream-did-work" && s.id === "u"), f + ": the shared action");
    assert.equal(up.outputs?.go, "${{ steps.u.outputs.go }}", f);
    assert.equal(up.permissions?.actions, "read", f + ": may list the upstream run's jobs");
    assert.ok(up.needs == null, f + ": the check runs first");
    for (const [id, j] of Object.entries(w.jobs)) {
      if (id === "upstream") continue;
      const needs = [].concat(j.needs || []);
      if (!needs.length || needs.includes("upstream")) {
        assert.ok(needs.includes("upstream"), `${f}: job ${id} starts without the upstream check`);
        assert.match(String(j.if), /^needs\.upstream\.outputs\.go == '1'( && \(.*\))?$/, `${f}: job ${id} runs only when the upstream did its work`);
      }
    }
    assert.equal(w.concurrency, false, f + ": the queue is on the working job; a filtered run never replaces a real one waiting in it");
  }
  for (const f of ["farmland-atlas-pages.yml", "alert-check.yml", "report-day.yml"]) {
    assert.ok(followers.some(([x]) => x === f), f + " is held here (the three named in the review)");
  }
});

test("upstream-did-work: the decision, failing closed", () => {
  const out = execFileSync("python3", [".github/actions/upstream-did-work/did_work.py", "--selftest"], { cwd: ROOT, encoding: "utf8" });
  assert.match(out, /all did_work checks passed/);
  for (const name of ["the upstream's gate skipped it: no go (the every-15-minutes case)", "jobs unreadable: fail closed",
    "an ungated upstream: go, as before", "an upstream that was itself filtered out did nothing: no go"]) {
    assert.ok(out.includes("ok   " + name), name);
  }
  const action = fs.readFileSync(path.join(ROOT, ".github/actions/upstream-did-work/action.yml"), "utf8");
  assert.match(action, /RUN_ID: \$\{\{ github\.event\.workflow_run\.id \}\}/);
  assert.match(action, /python3 "\$GITHUB_ACTION_PATH\/did_work\.py"/, "the script beside the action, never the engine copy");
});
