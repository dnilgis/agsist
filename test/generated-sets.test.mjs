/* Generated page sets are built on main, never carried in a pull request (Nov 4, 2026).
 * On Nov 3 four pull requests carried generated sets (#280 rain, #282 cash bid town pages twice, #296 land
 * sales); main's own jobs rebuilt those sets within hours, so the branches conflicted or merged on checks run
 * against an older main and main went red. BUILD-RULES 49 and 60 asked the lead to remember; this holds the
 * mechanical version together:
 *   - the table (scripts/generated_sets.py) covers every folder of generated pages and every --check builder,
 *     and every path, builder and workflow it names exists;
 *   - a pull request that changes a set's pages fails the guard (fixture repository), unless the data bot
 *     made it or the lead set the regen-ok label;
 *   - the PR checks rebuild a set whose builder changed in their own copy; main-checks.yml rebuilds it on main
 *     right after the merge, before the suite;
 *   - merge-when-green never merges on checks run against an older main (the stale rule, unit cases).
 *
 *   node --test test/generated-sets.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const T = JSON.parse(execFileSync("python3", ["scripts/generated_sets.py", "json"], { cwd: ROOT, encoding: "utf8" }));
const py = (code) => execFileSync("python3", ["-c", "import sys, json; sys.path.insert(0, 'scripts'); sys.path.insert(0, 'scripts/dev'); " + code],
  { cwd: ROOT, encoding: "utf8" });
const tracked = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28 }).split("\n").filter(Boolean);
const SET_MIN = Number(/^SET_MIN = (\d+)/m.exec(read("scripts/check_site_budget.py"))[1]);

test("every folder of generated pages is a set in the table, or listed with the reason it is not", () => {
  const pages = {};
  for (const f of tracked) if (f.endsWith(".html") && f.includes("/")) pages[f.split("/")[0]] = (pages[f.split("/")[0]] || 0) + 1;
  const folders = Object.keys(pages).filter((d) => pages[d] >= SET_MIN && !d.startsWith("."));
  assert.ok(folders.length >= 10, "the scan finds the page folders");
  const inSet = new Set(T.sets.flatMap((s) => s.outputs.filter((p) => !p.startsWith("!") && p.includes("/")).map((p) => p.split("/")[0])));
  for (const d of folders) assert.ok(inSet.has(d) || T.not_sets[d], `${d}/ has ${pages[d]} pages: a set in scripts/generated_sets.py, or NOT_SETS with a reason`);
  for (const [d, why] of Object.entries(T.not_sets)) {
    assert.ok(!inSet.has(d), `${d}: a set and not a set`);
    assert.ok(fs.existsSync(path.join(ROOT, d)), `${d}: listed as not a set but not there (remove it)`);
    assert.ok(why.length > 20, `${d}: a reason`);
  }
});

test("every --check builder in checks.sh is a set's check, or listed with the reason it is not", () => {
  const src = read("scripts/dev/checks.sh");
  const loop = /for b in ([\w ]+); do \[ -f scripts\/\$b\.py \] && run \$b python3 scripts\/\$b\.py --check; done/.exec(src);
  assert.ok(loop, "the builder --check loop in checks.sh");
  const setChecks = new Set(T.sets.flatMap((s) => (s.check || []).map((c) => path.basename(c[1], ".py"))));
  for (const b of loop[1].trim().split(/\s+/)) assert.ok(setChecks.has(b) || T.not_set_checks[b], `${b}: in the table or NOT_SET_CHECKS`);
  for (const b of setChecks) assert.ok(loop[1].split(/\s+/).includes(b), `${b}: a set's --check runs in checks.sh (the PR checks and main-checks)`);
  for (const b of Object.keys(T.not_set_checks)) assert.ok(loop[1].split(/\s+/).includes(b), `${b}: listed but not in checks.sh`);
});

test("every path, builder and workflow the table names exists, and each set's workflow runs its builder", () => {
  const files = new Set(tracked);
  const has = (p) => files.has(p) || tracked.some((f) => f.startsWith(p + "/"));
  for (const s of T.sets) {
    for (const p of s.outputs) {
      const base = p.replace(/^!/, "").split("*")[0].replace(/\/$/, "");
      assert.ok(has(base), `${s.id}: output ${p} is in the repository`);
    }
    for (const c of [...s.build, ...(s.check || [])]) assert.ok(files.has(c[1]), `${s.id}: ${c.join(" ")}`);
    for (const p of s.code_paths) assert.ok(files.has(p), `${s.id}: code ${p}`);
    for (const p of s.stage) assert.ok(has(p), `${s.id}: staged path ${p}`);
    assert.ok(s.code_paths.includes(s.build.find((c) => c[1].endsWith(".py"))[1]), `${s.id}: its builder is its code`);
    const wf = read(".github/workflows/" + s.workflow);
    for (const c of s.build) assert.ok(wf.includes(path.basename(c[1])), `${s.id}: ${s.workflow} runs ${c[1]} (the job that rebuilds it on main)`);
    assert.match(wf, /\n  workflow_dispatch:/, `${s.id}: ${s.workflow} can be started by hand`);
    if (!s.offline) {
      for (const k of Object.keys(s.dispatch || {})) assert.match(wf, new RegExp(`\\n      ${k}:\\n`), `${s.id}: ${s.workflow} takes the input ${k}`);
    }
  }
  // the town pages are built first on main: the rain and Atlas pages link only towns that have a page
  assert.equal(T.sets[0].id, "cash-bids");
  assert.deepEqual(T.sets.filter((s) => !s.offline).map((s) => s.id), ["cash-bids"], "only the town pages read the live network");
});

test("the pages are outputs, the hubs and builders edited by hand are not", () => {
  const cases = {
    "rain/iowa/story-county.html": "rain", "sitemap-rain.xml": "rain", "cash-bids/iowa/ames.html": "cash-bids",
    "land-sales/illinois/mclean-county.html": "land-sales", "prf/texas/anderson-county.html": "prf",
    "arc-plc/iowa/story-county.html": "arc-plc", "farmland-atlas/iowa/story-county.html": "farmland-atlas",
    "farmland-atlas/og/19169.png": "atlas-cards", "rent/iowa.html": "rent", "yield/iowa.html": "yield",
    "hail/2026-06-11.html": "hail", "hail-map/iowa.html": "hail-map",
    "rain.html": null, "prf.html": null, "arc-plc.html": null, "farmland-atlas/compare.html": null, "farmland-atlas/methods.html": null,
    "scripts/build_county_rain.py": null, "data/land-sales/coverage.json": null, "components/prf.js": null, "daily/2026-11-03.html": null,
  };
  const got = JSON.parse(py(`import generated_sets as G; print(json.dumps({p: G.owner(p) for p in json.loads(${JSON.stringify(JSON.stringify(Object.keys(cases)))})}))`));
  assert.deepEqual(got, cases);
});

// a fixture repository: main with a page set, and a pull request commit on top
const fixture = (files) => {
  const d = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "genguard-"));
  const g = (...a) => execFileSync("git", ["-C", d, "-c", "user.name=t", "-c", "user.email=t@t", ...a], { encoding: "utf8" });
  g("init", "-q");
  fs.mkdirSync(path.join(d, "rain/iowa"), { recursive: true });
  fs.writeFileSync(path.join(d, "rain/iowa/story-county.html"), "old\n");
  g("add", "-A"); g("commit", "-qm", "main");
  for (const [f, body] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), body); }
  g("add", "-A"); g("commit", "-qm", "pull request");
  return d;
};
const runGuard = (dir, pr) => {
  const ev = path.join(dir, "event.json");
  fs.writeFileSync(ev, JSON.stringify({ pull_request: pr }));
  const env = { ...process.env, GITHUB_EVENT_PATH: ev };
  delete env.GITHUB_REPOSITORY; delete env.GITHUB_ACTIONS;
  return spawnSync("python3", ["scripts/generated_sets.py", "guard", "--base", "HEAD^1", "--root", dir], { cwd: ROOT, encoding: "utf8", env });
};

test("the guard: a pull request that changes generated pages fails with the rule; a builder-only change passes", () => {
  const bad = fixture({ "rain/iowa/story-county.html": "new\n", "scripts/build_county_rain.py": "# x\n" });
  let r = runGuard(bad, { user: { login: "dnilgis" }, labels: [{ name: "merge-when-green" }] });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /^generated pages are built on main; change the builder and its fixture tests only\./m);
  assert.match(r.stdout, /  rain: 1 file\(s\), e\.g\. rain\/iowa\/story-county\.html \(builder: python3 scripts\/build_county_rain\.py; rebuilt on main by county-rain\.yml\)/);
  r = runGuard(bad, { user: { login: "github-actions[bot]" }, labels: [] });
  assert.equal(r.status, 0, "the data bot may: " + r.stdout);
  r = runGuard(bad, { user: { login: "dnilgis" }, labels: [{ name: "regen-ok" }] });
  assert.equal(r.status, 0, "the lead's regen-ok label lets it through: " + r.stdout);
  const good = fixture({ "scripts/build_county_rain.py": "# x\n", "test/fixtures/rain/x.json": "{}\n" });
  r = runGuard(good, { user: { login: "dnilgis" }, labels: [] });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /no generated page set is changed by hand/);
  for (const d of [bad, good]) fs.rmSync(d, { recursive: true, force: true });
});

test("pr-checks: the guard step on pull requests; the shards and other checks rebuild a changed set in their copy", () => {
  const pr = read(".github/workflows/pr-checks.yml");
  assert.match(pr, /- name: generated pages are built on main\n        if: github\.event_name == 'pull_request'\n        env:\n          GH_TOKEN: \$\{\{ github\.token \}\}\n        run: python3 scripts\/generated_sets\.py guard --base HEAD\^1\n/);
  const base = /AGSIST_GEN_BASE: \$\{\{ \(github\.event_name == 'pull_request' && !inputs\.full\) && 'HEAD\^1' \|\| \(github\.event_name == 'workflow_dispatch' && !inputs\.full && github\.ref != 'refs\/heads\/main'\) && 'origin\/main' \|\| '' \}\}/g;
  assert.equal((pr.match(base) || []).length, 2, "node tests and other checks, never on main-checks.yml's full call");
  const src = read("scripts/dev/checks.sh");
  assert.match(src, /\[ -n "\$\{AGSIST_GEN_BASE:-\}" \]; then\n\s+gp=\$\(python3 scripts\/generated_sets\.py prebuild --base "\$AGSIST_GEN_BASE" 2>&1\)/);
  assert.ok(src.indexOf("generated_sets.py prebuild") > src.indexOf("main_build.py build"), "after the built files");
  assert.ok(src.indexOf("generated_sets.py prebuild") < src.indexOf("run node-test"), "before any check");
});

test("main-checks.yml: a set whose builder changed is rebuilt on main before the suite; a network set waits for its own run", () => {
  const mc = read(".github/workflows/main-checks.yml");
  assert.match(mc, /\n  generated:\n    name: [^\n]+\n    needs: gate\n    if: needs\.gate\.outputs\.go == '1'\n/);
  assert.match(mc, /GH_TOKEN: \$\{\{ github\.token \}\}\n\s+PRIVATE_REPO_TOKEN: \$\{\{ secrets\.PRIVATE_REPO_TOKEN \}\}\n\s+run: \|\n\s+git config user\.name "AGSIST Bot"\n\s+git config user\.email "bot@agsist\.com"\n\s+python3 scripts\/generated_sets\.py main --window 360\n/);
  assert.match(mc, /^  actions: write$/m, "it may start the town pages' workflow");
  const out = py(`import generated_sets as G
ch = [(100, ["data/bids.json", "rain/iowa/x.html"]), (200, ["scripts/build_county_rain.py"]), (300, ["scripts/cross_links.py"]), (400, ["scripts/build_cash_bid_pages.py"])]
p = G.pending(ch)
print(json.dumps({"rain": p.get("rain"), "cash": p.get("cash-bids"), "prf": p.get("prf"), "land": p.get("land-sales"), "none": G.pending([(9, ["rain/a.html", "data/x.json"])])}))`);
  assert.deepEqual(JSON.parse(out), { rain: 300, cash: 400, prf: 300, land: null, none: {} },
    "a builder or a module it imports changed: pending from that commit; data and page commits never");
  const r = spawnSync("python3", ["scripts/generated_sets.py", "--selftest"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /all generated_sets checks passed/);
});

test("merge-when-green: no merge on checks run against an older main", () => {
  const out = py(`import merge_when_green as M
c = lambda s, n=1: {"sha": s * 40, "parents": [{}] * n}
data = {"status": "ahead", "total_commits": 2, "commits": [c("a"), c("b")], "files": [{"filename": "data/bids.json"}, {"filename": "rain/iowa/x.html"}]}
pr = {"state": "open", "labels": [{"name": M.LABEL}], "head": {"repo": {"full_name": "o/r"}, "sha": "h" * 40}, "mergeable_state": "clean", "mergeable": True, "draft": False, "number": 1}
green = [{"name": n, "status": "completed", "conclusion": "success"} for n in M.REQUIRED]
print(json.dumps({
  "data": M.stale(["scripts/x.py"], data),
  "overlap": M.stale(["rain/iowa/x.html"], data),
  "merge": M.stale(["scripts/x.py"], dict(data, total_commits=3, commits=data["commits"] + [c("m", 2)])),
  "big": M.stale(["scripts/x.py"], dict(data, total_commits=999)),
  "same": M.stale(["scripts/x.py"], {"status": "identical"}),
  "decide_stale": M.decide(pr, "o/r", green, ["scripts/x.py"], "another merge landed on main since (x)")[0],
  "decide_fresh": M.decide(pr, "o/r", green, ["scripts/x.py"], None)[0],
}))`);
  const r = JSON.parse(out);
  assert.equal(r.data, null, "the data jobs' commits to other files do not hold a merge");
  assert.match(r.overlap, /^main changed 1 file\(s\) this pull request also changes/);
  assert.match(r.merge, /^another merge landed on main since/);
  assert.match(r.big, /^main moved by more than the compare lists/);
  assert.equal(r.same, null);
  assert.equal(r.decide_stale, "update", "stale: bring main in and check again, never merge");
  assert.equal(r.decide_fresh, "merge");
  const src = read("scripts/dev/merge_when_green.py");
  assert.match(src, /"\/repos\/%s\/pulls\/%d\/update-branch"/, "updates the branch from main");
  assert.match(src, /"\/repos\/%s\/actions\/workflows\/pr-checks\.yml\/dispatches" % repo, \{"ref": pr\["head"\]\["ref"\], "inputs": \{"pick_base": ""\}\}/, "and starts every test on it");
});
