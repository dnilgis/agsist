/**
 * Faster PR checks without generated-file conflicts (Sig, Oct 29, 2026: "yes do all five").
 *
 * - What's new is one file per entry (data/whats-new/); the migration kept every old item, same ids,
 *   same order. data/whats-new.json, the homepage line and /changelog are built on main.
 * - The built-files guard (scripts/dev/main_build.py guard) fails a branch that edits a built block by
 *   hand, and passes one that edits only inputs or text outside the blocks.
 * - The test pick (scripts/dev/test_map.py): a page change picks the tests that read it plus the core,
 *   a shared file or a path the map cannot place picks every test, a deleted file picks the tests that
 *   read it before, a test file git does not track (an engine copy) always runs.
 * - The split shards cover the pick exactly once.
 *   node --test test/main-build.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const py = (code, args = []) => execFileSync("python3", ["-c", code, ...args], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 << 20 });
const tmp = (p) => fs.mkdtempSync(path.join(process.env.TMPDIR || "/tmp", p));

test("the What's new migration kept every item: same ids, same fields, same order", () => {
  const before = JSON.parse(read("test/fixtures/whats-new-before-split.json")).items;
  assert.equal(before.length, 45, "the list as it stood on main on Oct 29, 2026, when it was split");
  const built = JSON.parse(execFileSync("python3", ["scripts/build_whats_new.py", "--list"], { cwd: ROOT, encoding: "utf8" }));
  const ids = new Set(before.map((i) => i.id));
  assert.deepEqual(built.filter((i) => ids.has(i.id)), before, "the old items come out exactly as they were, in order");
  for (const it of before) {
    const f = `data/whats-new/${it.id}.json`;
    assert.ok(fs.existsSync(path.join(ROOT, f)), f);
    const e = JSON.parse(read(f));
    for (const k of ["id", "date", "title", "line", "link"]) assert.equal(e[k], it[k], `${f} ${k}`);
  }
  // later entries sort in: newest day first, within a day by rank then id
  const dates = built.map((i) => i.date);
  assert.deepEqual(dates, [...dates].sort().reverse());
});

test("an entry file that breaks the rules is refused by name", () => {
  const dir = tmp("wn-");
  const ok = { id: "2026-11-02-good", date: "2026-11-02", title: "A plain title", line: "One plain line.", link: "/" };
  const put = (name, obj) => fs.writeFileSync(path.join(dir, name), typeof obj === "string" ? obj : JSON.stringify(obj));
  const load = () => spawnSync("python3", ["-c", "import sys; sys.path.insert(0, 'scripts'); import build_whats_new as w; print(len(w.load(sys.argv[1])))", dir], { cwd: ROOT, encoding: "utf8" });
  put("2026-11-02-good.json", ok);
  let r = load();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), "1");
  const bad = [
    ["2026-11-02-other.json", ok, /file name must be the id/],
    ["2026-11-03-x.json", { ...ok, id: "2026-11-03-x", date: "2026-11-02" }, /must start with its date/],
    ["2026-11-02-dash.json", { ...ok, id: "2026-11-02-dash", title: "A title — with a dash" }, /em dash/],
    ["2026-11-02-nolink.json", { ...ok, id: "2026-11-02-nolink", link: "" }, /missing link/],
    ["2026-11-02-extra.json", { ...ok, id: "2026-11-02-extra", note: "x" }, /unknown field/],
    ["2026-13-02-date.json", { ...ok, id: "2026-13-02-date", date: "2026-13-02" }, /bad date/],
    ["2026-11-02-broken.json", "{not json", /not JSON/],
  ];
  for (const [name, obj, re] of bad) {
    put(name, obj);
    r = load();
    assert.notEqual(r.status, 0, name);
    assert.match(r.stderr + r.stdout, re, name);
    fs.rmSync(path.join(dir, name));
  }
});

test("the built-files guard: a hand edit of a built block fails, inputs and text outside the blocks pass", () => {
  const dir = tmp("guard-");
  const git = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  git("init", "-q", "-b", "main");
  fs.mkdirSync(path.join(dir, "scripts/dev"), { recursive: true });
  fs.copyFileSync(path.join(ROOT, "scripts/dev/main_build.py"), path.join(dir, "scripts/dev/main_build.py"));
  fs.mkdirSync(path.join(dir, "data/whats-new"), { recursive: true });
  const home = (link, other) => `<p>${other}</p>\n<!-- WHATSNEW:link (x) --><p class="wn-link">${link}</p><!-- /WHATSNEW:link -->\n<p class="by-end"></p>\n`;
  fs.writeFileSync(path.join(dir, "index.html"), home("latest: A", "intro"));
  fs.writeFileSync(path.join(dir, "data/whats-new.json"), '{"items": []}\n');
  git("add", "-A"); git("commit", "-qm", "base");
  git("checkout", "-qb", "fx/x");
  const guard = () => spawnSync("python3", ["scripts/dev/main_build.py", "guard", "--base", "main"], { cwd: dir, encoding: "utf8" });
  const step = (f, body, msg) => { fs.writeFileSync(path.join(dir, f), body); git("add", "-A"); git("commit", "-qm", msg); };

  step("data/whats-new/2026-11-02-a.json", "{}\n", "an entry file");
  let r = guard();
  assert.equal(r.status, 0, "an entry file alone passes: " + r.stdout);
  step("index.html", home("latest: A", "a new intro"), "text outside the block");
  r = guard();
  assert.equal(r.status, 0, "an edit outside the built block passes: " + r.stdout);
  step("index.html", home("latest: B", "a new intro"), "the block by hand");
  r = guard();
  assert.equal(r.status, 1, "a hand edit of the block fails");
  assert.match(r.stdout, /edits files that are built on main: index\.html/);
  step("index.html", home("latest: A", "a new intro"), "put the block back");
  assert.equal(guard().status, 0, "the block as on main again");
  step("data/whats-new.json", '{"items": [1]}\n', "the built list by hand");
  r = guard();
  assert.equal(r.status, 1);
  assert.match(r.stdout, /data\/whats-new\.json/);
  // on main itself (nothing between the merge base and HEAD) it passes
  git("checkout", "-q", "main");
  assert.equal(guard().status, 0);
});

const PICK = `
import json, sys
sys.path.insert(0, "scripts/dev")
import test_map as T
files = T.git_files()
head = T.build(files)
cases = json.loads(sys.argv[1])
out = {}
for name, c in cases.items():
    mode, why = T.select(c["changed"], head, c.get("base_map"), head_files=files, base_files=c.get("base_files", []),
                         present_tests=c.get("present", []))
    out[name] = {"mode": mode, "tests": sorted(t for t in why if t != "*"), "why": why}
print(json.dumps(out))
`;

test("the test pick: a page picks its tests and the core; a shared or unplaceable file picks everything", () => {
  const cases = {
    milk: { changed: ["milk-prices.html"] },
    loader: { changed: ["components/loader.js"] },
    unknown: { changed: [`no/such/file-${process.pid}.txt`] },
    selftest: { changed: ["test/main-build.test.mjs"] },
    gone: { changed: ["data/gone-before.json"], base_files: ["data/gone-before.json"], base_map: { tests: { "test/r8fix.test.mjs": { files: ["data/gone-before.json"], dirs: [] } } } },
    goneNoMap: { changed: ["data/gone-before.json"], base_files: ["data/gone-before.json"] },
    engineCopy: { changed: ["milk-prices.html"], present: ["test/only-on-the-engine.test.mjs"] },
  };
  const r = JSON.parse(py(PICK, [JSON.stringify(cases)]));
  const core = JSON.parse(py("import sys; sys.path.insert(0,'scripts/dev'); import test_map as T, json; print(json.dumps(T.CORE))"));
  for (const t of core) assert.ok(fs.existsSync(path.join(ROOT, t)), `core test ${t} exists`);

  assert.equal(r.milk.mode, "some");
  const milkTests = fs.readdirSync(path.join(ROOT, "test")).filter((f) => /^milk.*\.test\.mjs$/.test(f) && read("test/" + f).includes("milk-prices")).map((f) => "test/" + f);
  assert.ok(milkTests.length >= 3, `milk tests: ${milkTests}`);
  for (const t of milkTests) assert.ok(r.milk.tests.includes(t), `${t} is picked for milk-prices.html`);
  for (const t of core) assert.ok(r.milk.tests.includes(t), `core ${t} is picked`);
  assert.ok(r.milk.tests.length < fs.readdirSync(path.join(ROOT, "test")).filter((f) => f.endsWith(".test.mjs")).length, "not every test");

  assert.equal(r.loader.mode, "all", "components/loader.js is shared");
  assert.match(r.loader.why["*"][0], /shared file components\/loader\.js/);
  assert.equal(r.unknown.mode, "all", "a path the map cannot place");
  assert.match(r.unknown.why["*"][0], /cannot place/);
  assert.ok(r.selftest.tests.includes("test/main-build.test.mjs"), "a changed test runs");
  assert.ok(r.gone.tests.includes("test/r8fix.test.mjs"), "a deleted file picks the tests that read it on the base");
  assert.equal(r.goneNoMap.mode, "all", "a deleted file with no base map picks everything");
  assert.ok(r.engineCopy.tests.includes("test/only-on-the-engine.test.mjs"), "an untracked test in the checkout still runs");
});

test("the shared list covers the brief's shared files, and the map reads what a test writes out", () => {
  const T = JSON.parse(py("import sys; sys.path.insert(0,'scripts/dev'); import test_map as T, json; print(json.dumps(T.SHARED))"));
  for (const f of ["components/loader.js", "components/header.html", "components/styles.css", "sw.js", "scripts/dev/checks.sh", "package.json", "test/skips-allowed.txt", "scripts/dev/test_map.py"]) assert.ok(T.includes(f), f);
  const m = JSON.parse(py("import sys, json; sys.path.insert(0,'scripts/dev'); import test_map as T; print(json.dumps(T.build()['tests']['test/r8fix.test.mjs']))"));
  for (const f of ["data/whats-new.json", "scripts/build_whats_new.py", "components/glossary.js", "data/glossary.json", "index.html"]) {
    assert.ok(m.files.includes(f) || m.dirs.some((d) => d === "" || (d === "./" ? !f.includes("/") : f.startsWith(d))), `r8fix reads ${f}`);
  }
});

test("the shard split puts every picked file in exactly one shard", () => {
  const files = fs.readdirSync(path.join(ROOT, "test")).filter((f) => f.endsWith(".test.mjs")).slice(0, 60).map((f) => "test/" + f);
  const got = [];
  for (let n = 1; n <= 4; n++) got.push(...execFileSync("python3", ["scripts/dev/test_map.py", "--split", `${n}/4`, ...files], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean));
  assert.deepEqual([...got].sort(), [...files].sort());
  assert.equal(spawnSync("python3", ["scripts/dev/test_map.py", "--split", "5/4", "a"], { cwd: ROOT }).status, 2);
});

test("node-tests.sh runs only the picked files when given them, and every test when not", () => {
  const dir = tmp("nts-");
  fs.writeFileSync(path.join(dir, "a.test.mjs"), "import { test } from 'node:test'; test('a', () => {});\n");
  fs.writeFileSync(path.join(dir, "b.test.mjs"), "import { test } from 'node:test'; test('b', () => {}); test('b2', () => {});\n");
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== "NODE_TEST_CONTEXT")) };
  const go = (files) => { const nt = path.join(dir, "nt.out"); const r = spawnSync("bash", [path.join(ROOT, "scripts/dev/node-tests.sh"), nt, ""], { cwd: dir, encoding: "utf8", env: { ...env, AGSIST_TEST_FILES: files } }); assert.equal(r.status, 0, r.stdout + r.stderr); return fs.readFileSync(nt, "utf8"); };
  assert.match(go(""), /^# pass 3$/m, "all");
  assert.match(go("a.test.mjs"), /^# pass 1$/m, "only a");
});

test("during the move, a line a branch still added to data/whats-new.json gets its entry file on main instead of being dropped", () => {
  const dir = tmp("adopt-");
  fs.mkdirSync(path.join(dir, "e"));
  fs.writeFileSync(path.join(dir, "d.json"), JSON.stringify({ items: [{ id: "2026-10-30-late", date: "2026-10-30", title: "T", line: "L", link: "/" }] }));
  const code = "import sys, json; sys.path.insert(0, 'scripts'); import build_whats_new as w; w.ENTRIES, w.DATA = sys.argv[1], sys.argv[2]; print(json.dumps([w.adopt('2026-11-08'), w.adopt('2026-10-30'), w.adopt('2026-10-30')]))";
  const [late, kept, again] = JSON.parse(py(code, [path.join(dir, "e"), path.join(dir, "d.json")]).trim().split("\n").pop());
  assert.deepEqual(late, [], "after the move window nothing is kept: deleting an entry file takes the entry down");
  assert.deepEqual(kept, ["2026-10-30-late"]);
  assert.deepEqual(again, [], "once");
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, "e/2026-10-30-late.json"), "utf8")), { id: "2026-10-30-late", date: "2026-10-30", title: "T", line: "L", link: "/" });
  const cp = JSON.parse(py("import sys, json; sys.path.insert(0, 'scripts/dev'); import main_build as m; print(json.dumps(m.COMMIT))"));
  assert.ok(cp.includes("data/whats-new"), "the rebuild on main commits kept entry files");
});

test("every built file can be staged on main, even under the engine's info/exclude (main-checks.yml, Oct 29: scripts/ is excluded there)", () => {
  const dir = tmp("stage-");
  const git = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  git("init", "-q", "-b", "main");
  const built = JSON.parse(py("import sys, json; sys.path.insert(0, 'scripts/dev'); import main_build as m; print(json.dumps(list(m.BUILT)))"));
  for (const f of [...built, "data/whats-new/2026-11-01-a.json"]) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), "x\n"); }
  fs.writeFileSync(path.join(dir, "other.txt"), "not built\n");
  // what the Engine checkout writes in Actions (.github/actions/engine/engine.sh exclude_paths)
  fs.appendFileSync(path.join(dir, ".git/info/exclude"), "/.engine-src/\n/scripts\n/test\n/build\n");
  assert.ok(execFileSync("git", ["-C", dir, "check-ignore", "scripts/dev/test-map.json"], { encoding: "utf8" }).trim(), "the map is ignored there, as in the Oct 29 red run");
  const staged = JSON.parse(py("import sys, json; sys.path.insert(0, 'scripts/dev'); import main_build as m; print(json.dumps(m.stage(sys.argv[1])))", [dir]));
  assert.deepEqual([...staged].sort(), [...built, "data/whats-new/2026-11-01-a.json"].sort(), "every built file and the entry files, and nothing else");
  // each built path is either not ignored at all, or staged on purpose with -f (main_build.py stage)
  const src = read("scripts/dev/main_build.py");
  assert.match(src, /"add", "-f", "--"\] \+ files/, "-f only with the exact built file list");
});
