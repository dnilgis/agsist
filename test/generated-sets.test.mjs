/* Generated page sets are built on main, never carried in a pull request (Nov 4, 2026).
 * On Nov 3 four pull requests carried generated sets (#280 rain, #282 cash bid town pages twice, #296 land
 * sales); main's own jobs rebuilt those sets within hours, so the branches conflicted or merged on checks run
 * against an older main and main went red. build rule 49 and 60 asked the lead to remember; this holds the
 * mechanical version together:
 *   - the table (scripts/generated_sets.py) covers every folder of generated pages and every --check builder,
 *     and every path, builder and workflow it names exists;
 *   - a pull request that changes a set's pages fails the guard (fixture repository), unless the data bot
 *     made it or the lead set the regen-ok label;
 *   - the PR checks rebuild a set whose builder changed in their own copy; main-checks.yml rebuilds it on main
 *     right after the merge, before the suite;
 *   - merge-when-green never merges on checks run against an older main (the stale rule, unit cases);
 *   - build rule 61 (Nov 4: a hand run of cash-bid-index.yml left llms.txt on the partial edition and main
 *     went red): every summary file a set feeds is that set's dependent, found by tracing what each summary
 *     builder really reads (scripts/trace_reads.py), and every workflow that runs a set's builder rebuilds
 *     those summaries before its commit.
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
    "farmland-atlas/og/19169.png": "farmland-atlas", "rent/iowa.html": "rent", "yield/iowa.html": "yield",
    "hail/2026-06-11.html": "hail", "hail-map/iowa.html": "hail-map",
    "cash-bid-index.html": "cash-bid-index", "data/cash-index/editions.json": "cash-bid-index", "data/cash-index/acc-2026-11.json": null,
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

test("the guard: data/ids is built on main; a pull request that carries it fails, a builder-only change passes", () => {
  // Nov 11, 2026: the bids job rewrites data/ids every 15 minutes, so a branch that committed rebuilt ids
  // conflicted with main within minutes (three times on one pull request)
  const bad = fixture({ "data/ids/elevators.json": "{}\n", "data/ids/basis-join/IA.json": "{}\n", "scripts/build_ids.py": "# x\n" });
  let r = runGuard(bad, { user: { login: "dnilgis" }, labels: [{ name: "merge-when-green" }] });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /^data\/ids is built on main; change the builder and its tests\.$/m);
  assert.match(r.stdout, /changes 2 file\(s\) there, e\.g\. data\/ids\/basis-join\/IA\.json, data\/ids\/elevators\.json \(rebuilt on main by fetch_bids\.yml/);
  assert.doesNotMatch(r.stdout, /generated set\(s\)/, "no page set is named when only data/ids is carried");
  // any file under data/ids, the hand-kept ones too; nothing next to it (data/idsx) is caught
  const one = fixture({ "data/ids/parcel-rules.json": "{}\n" });
  assert.equal(runGuard(one, { user: { login: "dnilgis" }, labels: [] }).status, 1);
  const near = fixture({ "data/idsx/a.json": "{}\n", "data/ids.json": "{}\n" });
  assert.equal(runGuard(near, { user: { login: "dnilgis" }, labels: [] }).status, 0);
  // both kinds at once: both named
  const both = fixture({ "data/ids/companies.json": "{}\n", "rain/iowa/story-county.html": "new\n" });
  r = runGuard(both, { user: { login: "dnilgis" }, labels: [] });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^data\/ids is built on main/m);
  assert.match(r.stdout, /^  rain: 1 file\(s\)/m);
  r = runGuard(bad, { user: { login: "github-actions[bot]" }, labels: [] });
  assert.equal(r.status, 0, "the data bot may: " + r.stdout);
  r = runGuard(bad, { user: { login: "dnilgis" }, labels: [{ name: "regen-ok" }] });
  assert.equal(r.status, 0, "the lead's regen-ok label lets it through: " + r.stdout);
  const good = fixture({ "scripts/build_ids.py": "# x\n", "scripts/build_basis_join.py": "# x\n", "test/ids.test.mjs": "//\n" });
  r = runGuard(good, { user: { login: "dnilgis" }, labels: [] });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  for (const d of [bad, one, near, both, good]) fs.rmSync(d, { recursive: true, force: true });
});

test("data/ids: main rebuilds it on every bids run from the engine copy; the join tests build their own", () => {
  const G = JSON.parse(py("import generated_sets as G; print(json.dumps(G.BUILT_ON_MAIN))"));
  assert.deepEqual(Object.keys(G), ["data/ids"]);
  const fb = read(".github/workflows/fetch_bids.yml");
  assert.match(fb, /- name: Engine checkout\n        uses: \.\/\.github\/actions\/engine\n/);
  assert.match(fb, /python scripts\/build_ids\.py /);
  assert.match(fb, /python scripts\/build_basis_join\.py /);
  assert.match(fb, /git add -A data\/ids\/basis-join/);
  // engine-sync refreshes the engine copy on every merge that changes scripts/
  assert.match(read(".github/workflows/engine-sync.yml"), /branches: \[main\]\n    paths:\n      - "scripts\/\*\*"/);
  // no check compares the committed join with the builder (a builder change would fail until main's next run)
  assert.doesNotMatch(read("scripts/dev/checks.sh"), /build_basis_join\.py --check/);
  for (const t of ["test/basis-stitch.test.mjs", "test/here-first.test.mjs"]) {
    assert.doesNotMatch(read(t), /build_basis_join\.py", "--check"/, t);
    assert.match(read(t), /build_basis_join\.py", "--out"/, t);
  }
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
print(json.dumps({"rain": p.get("rain"), "cash": p.get("cash-bids"), "prf": p.get("prf"), "land": p.get("land-sales"), "info": p.get("infographic"), "none": G.pending([(9, ["rain/a.html", "data/x.json"])])}))`);
  // land sales imports cross_links since its county pages carry the same-state row (Nov 10, 2026); the
  // infographic set imports neither changed module
  assert.deepEqual(JSON.parse(out), { rain: 300, cash: 400, prf: 300, land: 300, info: null, none: {} },
    "a builder or a module it imports changed: pending from that commit; data and page commits never");
  const r = spawnSync("python3", ["scripts/generated_sets.py", "--selftest"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /all generated_sets checks passed/);
});

test("main-checks: a network set's run cancelled by its workflow's concurrency group counts the newer run that replaced it", () => {
  // Nov 10: the dispatched cash-bid-pages run was cancelled when a newer run queued; main-checks went red although
  // the newer run rebuilt the pages. Fake run lists: the watched run by hand, then what came after it.
  const out = py(`import generated_sets as G
S = next(s for s in G.SETS if s["id"] == "cash-bids")
GONE = {"id": 1, "event": "workflow_dispatch", "status": "completed", "conclusion": "cancelled", "head_branch": "main", "created_at": "2026-11-10T02:29:41Z"}
def run(i, t, c, st="completed", ev="workflow_run"):
    return {"id": i, "event": ev, "status": st, "conclusion": c, "head_branch": "main", "created_at": t}
class Fake:
    repo = "o/r"
    def __init__(self, seq, jobs=None):
        self.seq, self.jobs, self.posts = list(seq), jobs or {}, 0
    def call(self, m, path, body=None):
        if m == "POST":
            self.posts += 1
            return None
        if "/jobs" in path:
            rid = int(path.split("/runs/")[1].split("/")[0])
            return {"jobs": [{"name": "gate", "conclusion": "success"}, {"name": "build", "conclusion": self.jobs.get(rid, "success")}]}
        if "event=workflow_dispatch" in path:
            return {"workflow_runs": [GONE]}
        rs = self.seq.pop(0) if len(self.seq) > 1 else self.seq[0]
        return {"workflow_runs": [GONE, run(0, "2026-11-10T02:00:00Z", "failure")] + rs}
class Clock:
    t = 0.0
    def __call__(self): return self.t
    def sleep(self, n): self.t += n
def go(seq, jobs=None, wait=30):
    c = Clock(); g = Fake(seq, jobs)
    r = G.await_network(g, S, G._ts("2026-11-10T02:20:00Z"), wait_min=wait, sleep=c.sleep, clock=c)
    return [r, g.posts]
ok = run(2, "2026-11-10T02:30:10Z", "success")
print(json.dumps({
  "then_success": go([[ok]]),
  "none_newer": go([[]]),
  "then_failure": go([[run(2, "2026-11-10T02:30:10Z", "failure")]]),
  "gate_skipped": go([[ok]], {2: "skipped"}),
  "gate_skipped_then_built": go([[ok, run(3, "2026-11-10T04:30:00Z", "success")]], {2: "skipped"}),
  "chain": go([[run(2, "2026-11-10T02:30:10Z", "cancelled"), run(3, "2026-11-10T02:31:00Z", "success")]]),
  "waits": go([[run(2, "2026-11-10T02:30:10Z", None, "in_progress")], [run(2, "2026-11-10T02:30:10Z", "success")]]),
  "times_out": go([[run(2, "2026-11-10T02:30:10Z", None, "in_progress")]], wait=5),
}))`);
  const r = JSON.parse(out.trim().split("\n").pop());
  assert.deepEqual(r.then_success, ["success", 0], "cancelled, then a newer run that rebuilt: pass");
  assert.deepEqual(r.none_newer, ["cancelled (no newer run)", 0], "cancelled with no newer run: fail");
  assert.deepEqual(r.then_failure, ["newer run 2 failure", 0], "cancelled, then a newer run that failed: fail");
  assert.deepEqual(r.gate_skipped, ["cancelled (no newer run rebuilt the pages)", 0], "a newer run whose build job its gate skipped did not rebuild");
  assert.deepEqual(r.gate_skipped_then_built, ["success", 0]);
  assert.deepEqual(r.chain, ["success", 0], "a newer run cancelled in turn passes the wait on to the one after it");
  assert.deepEqual(r.waits, ["success", 0], "a newer run still going is waited for");
  assert.deepEqual(r.times_out, ["timed out", 0], "the wait is bounded");
  const wf = read(".github/workflows/cash-bid-pages.yml");
  const S = T.sets.find((s) => s.id === "cash-bids");
  assert.ok(new RegExp(`\\n  ${S.build_job}:\\n`).test(wf), `cash-bid-pages.yml has the job the wait checks (${S.build_job})`);
});

test("merge-when-green: no merge on checks run against an older main", () => {
  const out = py(`import merge_when_green as M
pr = {"state": "open", "labels": [{"name": M.LABEL}], "head": {"repo": {"full_name": "o/r"}, "sha": "h" * 40}, "mergeable_state": "clean", "mergeable": True, "draft": False, "number": 1}
green = [{"name": n, "status": "completed", "conclusion": "success"} for n in M.REQUIRED]
bot = ["data/bids.json"] + ["cash-bids/s/t%d.html" % k for k in range(2900)]
print(json.dumps({
  "bot": M.stale(["scripts/x.py"], bot),
  "overlap": M.stale(["cash-bids/s/t7.html"], bot),
  "merge_apart": M.stale(["scripts/x.py"], ["scripts/y.py", "test/y.test.mjs"]),
  "set": M.stale(["scripts/build_county_rain.py"], ["rain/iowa/x.html"], M.relevant_to(["scripts/build_county_rain.py"], ".")),
  "unread": M.stale(["a"], None),
  "bot308": M.stale(["scripts/build_cash_bid_pages.py"], bot, M.relevant_to(["scripts/build_cash_bid_pages.py"], "."), M.others_of([({"parents": 1, "author": "bot@agsist.com", "committer": "bot@agsist.com", "subject": "pages: rebuild /cash-bids town pages"}, bot)])),
  "merge308": M.stale(["scripts/build_cash_bid_pages.py"], bot, M.relevant_to(["scripts/build_cash_bid_pages.py"], "."), M.others_of([({"parents": 2, "author": "41898282+github-actions[bot]@users.noreply.github.com", "committer": "noreply@github.com", "subject": "Merge pull request #307 from dnilgis:fx/wave1a"}, bot[:2])])),
  "wf": M.stale(["scripts/x.py"], [".github/workflows/x.yml"], None, []),
  "decide_stale": M.decide(pr, "o/r", green, ["scripts/x.py"], "main changed 1 file(s)")[0],
  "decide_fresh": M.decide(pr, "o/r", green, ["scripts/x.py"], None)[0],
}))`);
  const r = JSON.parse(out);
  assert.equal(r.bot, null, "a 2,900-file data commit touching nothing the PR's checks read does not hold a merge");
  assert.match(r.overlap, /^main changed 1 file\(s\) this pull request's checks read/);
  assert.equal(r.merge_apart, null, "another PR's merge counts only when it overlaps");
  assert.match(r.set, /^main changed 1 file/, "main moved the pages of the set whose builder the PR changes (#280)");
  assert.match(r.unread, /could not be read/);
  assert.equal(r.bot308, null, "#308: the bids bot rebuilding the set a builder PR changes does not hold it (the checks would never be fresh)");
  assert.match(r.merge308, /^main changed \d+ file\(s\)/, "another PR's merge touching that set does");
  assert.match(r.wf, /workflow file/, "main changed a workflow: stale");
  assert.equal(r.decide_stale, "update", "stale: bring main in and check again, never merge");
  assert.equal(r.decide_fresh, "merge");
  const src = read("scripts/dev/merge_when_green.py");
  assert.match(src, /"\/repos\/%s\/pulls\/%d\/update-branch"/, "updates the branch from main");
  assert.match(src, /"\/repos\/%s\/actions\/workflows\/pr-checks\.yml\/dispatches" % repo, \{"ref": ref, "inputs": \{"pick_base": ""\}\}/, "and starts every test on it");
  assert.match(src, /"git", "-C", root\] \+ list\(a\)/, "main's changed files from git, not the 300-file compare");
});

// ── build rule 61: a builder run by hand leaves every summary of its output current ──────────────────────
const summary = Object.fromEntries(T.summaries.map((x) => [x.id, x]));
const setById = Object.fromEntries(T.sets.map((s) => [s.id, s]));
const traced = {};
for (const x of T.summaries) {
  const r = spawnSync("python3", ["scripts/generated_sets.py", "trace", x.id], { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 26 });
  traced[x.id] = r.status === 0 ? JSON.parse(r.stdout) : { error: r.stdout + r.stderr };
}

test("rule 61: every set a summary builder reads lists that summary as a dependent (traced, not declared)", () => {
  for (const x of T.summaries) {
    const t = traced[x.id];
    assert.ok(!t.error, `${x.id}: the trace ran (${t.error})`);
    assert.deepEqual(t.written.filter((f) => !x.files.some((o) => f === o || f.startsWith(o + "/"))), [],
      `${x.id}: its trace pass (${x.build.join(" ")} ${x.trace.join(" ")}) writes only its own files`);
    const sets = Object.keys(t.sets);
    assert.ok(sets.length > 0, `${x.id}: reads no set's output; it is not a summary (move it to NOT_SUMMARIES)`);
    for (const sid of sets) {
      assert.ok(setById[sid].dependents.includes(x.id),
        `${x.id} (${x.build[1]}) reads ${sid}'s output (${t.sets[sid].slice(0, 3).join(", ")}): add "${x.id}" to ${sid}'s dependents in scripts/generated_sets.py`);
    }
    // a summary that reads another summary's file is rebuilt after it, wherever that one is
    for (const a of t.summaries) {
      assert.ok(T.summaries.findIndex((y) => y.id === a) < T.summaries.findIndex((y) => y.id === x.id), `${x.id} reads ${a}: ${a} comes first in SUMMARIES`);
      for (const s of T.sets) if (s.dependents.includes(a)) assert.ok(s.dependents.includes(x.id), `${x.id} reads ${a}'s files: ${s.id} lists ${a}, so it lists ${x.id} too`);
    }
  }
  // the Nov 4 case itself: the Cash Bid Index is a set and llms.txt reads its edition
  assert.ok(traced.llms.sets["cash-bid-index"], "llms.txt reads the Cash Bid Index edition");
  assert.ok(setById["cash-bid-index"].dependents.includes("llms"));
});

const NOT_A_BUILD = /--(check|selftest|out|fold|help|validate|dry-run)\b/;
const builderRuns = (src, script) => src.split("\n").map((l, i) => [l, i])
  .filter(([l]) => !/^\s*#/.test(l) && new RegExp(`(python3?|node)\\s+(\\S*/)?scripts/${script.replace(/\./g, "\\.")}(\\s|$)`).test(l) && !NOT_A_BUILD.test(l))
  .map(([, i]) => i);

test("rule 61: every workflow that runs a set's builder rebuilds that set's summary files before its commit", () => {
  const wfs = fs.readdirSync(path.join(ROOT, ".github/workflows")).filter((f) => f.endsWith(".yml"));
  let seen = 0;
  for (const s of T.sets) {
    const scripts = s.build.map((c) => path.basename(c[1]));
    let inOwn = false;
    for (const wf of wfs) {
      const src = read(".github/workflows/" + wf);
      const lines = src.split("\n");
      const runs = scripts.flatMap((b) => builderRuns(src, b));
      if (!runs.length) continue;
      if (wf === s.workflow) inOwn = true;
      if (!s.dependents.length) continue;
      const calls = lines.map((l, i) => [l, i]).filter(([l]) => /generated_sets\.py dependents /.test(l) && !/^\s*#/.test(l))
        .map(([l, i]) => ({ i, ids: /dependents ([\w -]+?) --stage( \|\| true)?\s*$/.exec(l)?.[1].split(/\s+/) || [] }));
      for (const r of runs) {
        const c = calls.find((c) => c.i > r && c.ids.includes(s.id));
        assert.ok(c, `${wf} runs ${s.id}'s builder (line ${r + 1}) but never calls \`python3 scripts/generated_sets.py dependents ${s.id} --stage\` after it (BUILD-RULES 61)`);
        assert.ok(lines.slice(c.i + 1).some((l) => /git commit/.test(l)), `${wf}: the dependents call (line ${c.i + 1}) comes before its commit`);
        seen++;
      }
    }
    assert.ok(inOwn, `${s.id}: ${s.workflow} runs its builder`);
  }
  assert.ok(seen >= 12, `the scan finds the builder runs (${seen})`);
});

test("rule 61: the dependents call runs each summary builder once, in order, and names what it stages", () => {
  const run = (...a) => execFileSync("python3", ["scripts/generated_sets.py", "dependents", ...a], { cwd: ROOT, encoding: "utf8" });
  const want = (ids) => T.summaries.filter((x) => ids.includes(x.id));
  for (const s of T.sets) {
    const out = run(s.id, "--dry-run").trim().split("\n").slice(1);
    assert.deepEqual(out, want(s.dependents).map((x) => x.build.join(" ")), `${s.id}: its dependents, in SUMMARIES order`);
    assert.equal(run(s.id, "--files").trim(), want(s.dependents).flatMap((x) => x.files).join(" "));
  }
  const both = run("cash-bids", "rain", "farmland-atlas", "--dry-run").trim().split("\n").slice(1);
  assert.equal(new Set(both).size, both.length, "a summary two sets share is built once");
  assert.equal(spawnSync("python3", ["scripts/generated_sets.py", "dependents", "nope"], { cwd: ROOT }).status, 2, "an unknown set is refused");
  for (const x of T.summaries) for (const f of x.files) assert.ok(fs.existsSync(path.join(ROOT, f)), `${x.id}: ${f} is in the repository`);
  const mainSrc = read("scripts/generated_sets.py");
  assert.match(mainSrc, /run_dependents\(deps\)/, "main-checks' rebuild of a set rebuilds its summaries too");
  assert.match(mainSrc, /commit_and_push\(\[s\["id"\] for s in offline\], rebuild, summary_files\(deps\)\)/, "and commits them with the set");
});

test("rule 61: every --check builder in checks.sh is a set, a summary, or listed with the reason it is neither", () => {
  const src = read("scripts/dev/checks.sh");
  const names = new Set([...src.matchAll(/python3 scripts\/(\w+)\.py --check/g)].map((m) => m[1]));
  for (const b of /for b in ([\w ]+); do/.exec(src)[1].trim().split(/\s+/)) names.add(b);
  const known = new Set([
    ...T.sets.flatMap((s) => [...s.build, ...(s.check || [])].map((c) => path.basename(c[1], ".py"))),
    ...T.summaries.map((x) => path.basename(x.build[1], ".py")),
    ...Object.keys(T.not_set_checks), ...Object.keys(T.not_summaries)]);
  assert.ok(names.size >= 15, `the scan finds the --check lines (${names.size})`);
  for (const b of names) assert.ok(known.has(b), `${b}: a set, a summary (SUMMARIES) or NOT_SUMMARIES with a reason, in scripts/generated_sets.py`);
  for (const [b, why] of Object.entries(T.not_summaries)) {
    assert.ok(fs.existsSync(path.join(ROOT, "scripts", b + ".py")), `${b}: listed but not in scripts/`);
    assert.ok(why.length > 20, `${b}: a reason`);
  }
});

// a fixture repository and a fake summary (its builder counts the lines of every page) for the rebuild rules
const sumFixture = () => {
  const d = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "gensum-"));
  const remote = d + "/remote.git", a = d + "/a", b = d + "/b";
  const g = (cwd, ...x) => execFileSync("git", ["-C", cwd, "-c", "user.name=t", "-c", "user.email=t@t", ...x], { encoding: "utf8" });
  g(d, "init", "-q", "--bare", "-b", "main", remote);
  fs.mkdirSync(a); g(a, "init", "-q", "-b", "main");
  fs.mkdirSync(a + "/pages"); fs.writeFileSync(a + "/pages/one.html", "1\n");
  fs.writeFileSync(a + "/build_sum.py", "import glob\nopen('sum.txt.tmp','w').write(''.join(sorted(open(f).read() for f in glob.glob('pages/*.html'))))\nimport os; os.replace('sum.txt.tmp','sum.txt')\n");
  fs.writeFileSync(a + "/fail_sum.py", "open('sum.txt','w').write('HALF')\nraise SystemExit(3)\n");
  execFileSync("python3", ["build_sum.py"], { cwd: a });
  g(a, "add", "-A"); g(a, "commit", "-qm", "main"); g(a, "remote", "add", "origin", remote); g(a, "push", "-q", "origin", "main");
  g(d, "clone", "-q", remote, b);
  return { d, a, b, g };
};
// the runner's git, not this machine's: no global or system config, so no identity and no autostash setting
const bareGit = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
delete bareGit.GIT_AUTHOR_NAME; delete bareGit.GIT_AUTHOR_EMAIL; delete bareGit.GIT_COMMITTER_NAME; delete bareGit.GIT_COMMITTER_EMAIL;
const pyBare = (code) => execFileSync("python3", ["-c", "import sys, json; sys.path.insert(0, 'scripts'); " + code], { cwd: ROOT, encoding: "utf8", env: bareGit });
const withFake = (root, code, build = "build_sum.py") => pyBare(`import generated_sets as G
G.ROOT = G.GIT_ROOT = ${JSON.stringify(root)}
G.SUMMARIES = [{"id": "sum", "build": ["python3", ${JSON.stringify(build)}], "trace": [], "files": ["sum.txt"]}]
G.SUMMARY = {"sum": G.SUMMARIES[0]}
G.SETS = [dict(G.SETS[0], id="pages", dependents=["sum"])]
${code}`);

test("rule 61: a summary whose builder fails is not staged and is put back whole", () => {
  const { d, a, g } = sumFixture();
  fs.writeFileSync(a + "/pages/two.html", "2\n");
  let out = JSON.parse(withFake(a, `bad = G.run_dependents(["sum"], stage=True)
print(json.dumps(bad))`, "fail_sum.py").trim().split("\n").at(-1));
  assert.deepEqual(out, ["sum"]);
  assert.equal(fs.readFileSync(a + "/sum.txt", "utf8"), "1\n", "HEAD's copy is back, not the half-written one");
  assert.equal(g(a, "diff", "--staged", "--name-only").trim(), "", "nothing staged");
  out = JSON.parse(withFake(a, `print(json.dumps(G.run_dependents(["sum"], stage=True)))`).trim().split("\n").at(-1));
  assert.deepEqual(out, []);
  assert.equal(g(a, "diff", "--staged", "--name-only").trim(), "sum.txt", "a built summary is staged");
  fs.rmSync(d, { recursive: true, force: true });
});

// Nov 10, 2026: a pull request changed a module every set builder imports (scripts/source_links.py). The PR
// prebuild rebuilt arc-plc ("its code changed") but not build_breakeven_data.py, its dependent, so
// data/breakeven read stale against the new arc-plc data and other checks failed. The fixture: a shared import,
// a set that imports it, a summary that reads the set (as breakeven reads arc-plc) and a summary that reads
// that summary (transitive).
const depFixture = () => {
  const d = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "gendep-"));
  const g = (...x) => execFileSync("git", ["-C", d, "-c", "user.name=t", "-c", "user.email=t@t", ...x], { encoding: "utf8" });
  g("init", "-q", "-b", "main");
  const w = (f, body) => { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), body); };
  w("scripts/shared_links.py", "LABEL = 'old'\n");
  w("scripts/build_set.py", "from shared_links import LABEL\nimport os\nos.makedirs('data/set', exist_ok=True)\nopen('data/set/a.json', 'w').write(LABEL + '\\n')\n");
  const sum = (src, out) => `import sys, os\nbody = 'from ' + open(${JSON.stringify(src)}).read()\nif '--check' in sys.argv:\n    sys.exit(0 if os.path.exists(${JSON.stringify(out)}) and open(${JSON.stringify(out)}).read() == body else 1)\nos.makedirs(os.path.dirname(${JSON.stringify(out)}), exist_ok=True)\nopen(${JSON.stringify(out)}, 'w').write(body)\n`;
  w("scripts/build_sum.py", sum("data/set/a.json", "data/sum/a.json"));
  w("scripts/build_sum2.py", sum("data/sum/a.json", "data/sum2/a.json"));
  for (const b of ["build_set.py", "build_sum.py", "build_sum2.py"]) execFileSync("python3", ["scripts/" + b], { cwd: d });
  g("add", "-A"); g("commit", "-qm", "main");
  w("scripts/shared_links.py", "LABEL = 'new label'\n");  // another length: a .pyc from the same second is not reused
  g("add", "-A"); g("commit", "-qm", "pull request: the shared import changes");
  return d;
};
const prebuildFake = (root) => pyBare(`import generated_sets as G
G.ROOT = G.GIT_ROOT = ${JSON.stringify(root)}
G.SUMMARIES = [{"id": "sum", "build": ["python3", "scripts/build_sum.py"], "trace": ["--check"], "files": ["data/sum"], "dependents": ["sum2"]},
               {"id": "sum2", "build": ["python3", "scripts/build_sum2.py"], "trace": ["--check"], "files": ["data/sum2"]}]
G.SUMMARY = {x["id"]: x for x in G.SUMMARIES}
G.SETS = [{"id": "base-set", "offline": True, "workflow": "x.yml", "build": [["python3", "scripts/build_set.py"]],
           "check": None, "outputs": ["data/set/**"], "writes": [], "code": ["scripts/build_set.py"], "inputs": [],
           "dependents": ["sum"]}]
print("RC=%d" % G.cmd_prebuild("HEAD^1"))`);

test("prebuild: a set rebuilt because a shared import changed gets its dependents rebuilt too, transitively, in order", () => {
  const d = depFixture();
  const out = prebuildFake(d);
  assert.match(out, /prebuild: base-set \(its code changed\)/, out);
  assert.match(out, /RC=0/, out);
  assert.equal(fs.readFileSync(d + "/data/set/a.json", "utf8"), "new label\n", "the set is rebuilt with the new import");
  for (const b of ["build_sum.py", "build_sum2.py"]) {
    const r = spawnSync("python3", ["scripts/" + b, "--check"], { cwd: d, encoding: "utf8" });
    assert.equal(r.status, 0, `${b} --check reads fresh after the prebuild:\n${out}`);
  }
  assert.equal(fs.readFileSync(d + "/data/sum2/a.json", "utf8"), "from from new label\n", "the summary of the summary, after it");
  assert.ok(out.indexOf("build_sum.py") < out.indexOf("build_sum2.py"), "dependency order");
  fs.rmSync(d, { recursive: true, force: true });
});

test("prebuild: the real table lists breakeven as an arc-plc dependent, and a shared import change rebuilds both", () => {
  assert.ok(T.sets.find((s) => s.id === "arc-plc").dependents.includes("breakeven"));
  const r = JSON.parse(py(`import generated_sets as G
print(json.dumps({"touched": G.touched(G.SETS, ["scripts/source_links.py"], G.ROOT), "closure": G.summary_closure(["breakeven"])}))`).trim().split("\n").at(-1));
  if (fs.existsSync(path.join(ROOT, "scripts/source_links.py"))) assert.ok(r.touched.includes("arc-plc"), "arc-plc imports source_links: " + r.touched);
  assert.deepEqual(r.closure.slice(0, 1), ["breakeven"]);
});

test("rule 61: pull-rebase rebuilds a summary that conflicts, never keeping either side; another conflict aborts", () => {
  const { d, a, b, g } = sumFixture();
  // main moves on: another job adds a page and rebuilds the summary
  fs.writeFileSync(b + "/pages/three.html", "3\n"); execFileSync("python3", ["build_sum.py"], { cwd: b });
  g(b, "add", "-A"); g(b, "commit", "-qm", "three"); g(b, "push", "-q", "origin", "main");
  // this job adds its page and its summary, from the older main
  fs.writeFileSync(a + "/pages/two.html", "2\n"); execFileSync("python3", ["build_sum.py"], { cwd: a });
  g(a, "add", "-A"); g(a, "commit", "-qm", "two");
  const rcOut = withFake(a, `print(json.dumps(G.pull_rebase(["pages"])))`);
  const rc = JSON.parse(rcOut.trim().split("\n").at(-1));
  assert.equal(rc, 0, "rebased: " + rcOut);
  assert.equal(fs.readFileSync(a + "/sum.txt", "utf8"), "1\n2\n3\n", "the summary is rebuilt from both sides' pages");
  assert.equal(g(a, "status", "--porcelain").trim(), "", "clean, no rebase in progress");
  assert.match(g(a, "log", "--format=%s", "-2"), /^two\nthree\n$/);
  // a conflict outside the summary files aborts (the job's own recovery takes over)
  fs.writeFileSync(b + "/pages/one.html", "1b\n"); g(b, "commit", "-qam", "b edits one"); g(b, "push", "-q", "origin", "main");
  fs.writeFileSync(a + "/pages/one.html", "1a\n"); g(a, "commit", "-qam", "a edits one");
  const rc2 = JSON.parse(withFake(a, `print(json.dumps(G.pull_rebase(["pages"])))`).trim().split("\n").at(-1));
  assert.equal(rc2, 1);
  assert.ok(!fs.existsSync(a + "/.git/rebase-merge") && !fs.existsSync(a + "/.git/rebase-apply"), "the rebase was aborted");
  fs.rmSync(d, { recursive: true, force: true });
});

test("rule 61: every workflow that rebuilds summaries rebases through pull-rebase or resets and rebuilds; no push is ignored", () => {
  for (const wf of fs.readdirSync(path.join(ROOT, ".github/workflows")).filter((f) => f.endsWith(".yml"))) {
    const src = read(".github/workflows/" + wf).split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
    if (!/generated_sets\.py dependents /.test(src)) continue;
    assert.doesNotMatch(src, /git pull[^\n]*--rebase/, `${wf}: a raw git pull --rebase keeps one side of a conflicting summary; use generated_sets.py pull-rebase`);
    assert.doesNotMatch(src, /git push[^\n]*\|\| true/, `${wf}: a failed push is never ignored`);
    assert.ok(/generated_sets\.py pull-rebase /.test(src) || /git reset (-q )?--hard "?origin\//.test(src), `${wf}: on a race it rebases through pull-rebase or resets to main and rebuilds`);
  }
  for (const f of ["scripts/build_llms_txt.py", "scripts/build_feeds.py", "scripts/build_search_index.py", "scripts/stamp_prf.py", "scripts/build_breakeven_data.py"])
    assert.match(read(f), /os\.replace\(/, `${f} writes a whole file and renames it`);
});
