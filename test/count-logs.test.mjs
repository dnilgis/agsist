/* Subscriber counts stay out of the public Actions logs, and the list token
 * travels in an Authorization header, never in an address.
 *
 * One generic rule for the steps and functions that read the subscriber list:
 * only fixed strings may be printed there. A print, log, echo or printf that
 * prints a variable, a % or .format() expression, an f-string or a joined
 * string fails, whatever the variable is called.
 *
 *   node --test test/count-logs.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const ROOT = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), "utf8");
const fn = (src, name) => {
  const a = src.indexOf("\ndef " + name + "(");
  assert.ok(a >= 0, name + " exists");
  const b = src.indexOf("\ndef ", a + 5);
  return src.slice(a, b < 0 ? undefined : b);
};
// the run block of one named step in a workflow
const step = (yml, name) => {
  const a = yml.indexOf("- name: " + name + "\n");
  assert.ok(a >= 0, "step " + name + " exists");
  const b = yml.indexOf("\n      - ", a + 5);
  const s = yml.slice(a, b < 0 ? undefined : b);
  const r = s.indexOf("run: |");
  assert.ok(r >= 0, "step " + name + " has a run block");
  return s.slice(r + 6);
};

// The argument list of a call that opens at s[i] === "(", strings respected.
function callArgs(s, i) {
  let depth = 0, q = null;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (q) {
      if (c === "\\") j++;
      else if (s.startsWith(q, j)) { j += q.length - 1; q = null; }
      continue;
    }
    if (s.startsWith('"""', j) || s.startsWith("'''", j)) { q = s.slice(j, j + 3); j += 2; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return s.slice(i + 1, j);
  }
  return s.slice(i + 1);
}

const PY_LITERAL = /^\s*(?:"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')(?:\s*,\s*(?:file|flush|end|sep)\s*=\s*[\w.]+)*\s*$/;
const PY_PRINTERS = /(?<![\w.])(?:print|log|warn|sys\.stdout\.write|sys\.stderr\.write)\s*\(/g;

/** Every print-like call in Python source whose argument is not one fixed string. */
export function pyPrintsOfValues(src) {
  const bad = [];
  for (const m of src.matchAll(PY_PRINTERS)) {
    const line = src.slice(src.lastIndexOf("\n", m.index) + 1, m.index);
    if (/^\s*(?:def|#)/.test(line)) continue;           // a definition or a comment
    const args = callArgs(src, m.index + m[0].length - 1);
    if (!PY_LITERAL.test(args)) bad.push(m[0] + args + ")");
  }
  return bad;
}

/** Every echo or printf in shell whose output reaches the log and carries a $ value or a backtick. */
export function shPrintsOfValues(src) {
  const bad = [];
  for (const raw of src.split("\n")) {
    if (/^\s*#/.test(raw)) continue;
    // split a line into statements, quotes respected, and keep the pipe after each
    let q = null, cur = "";
    const parts = [];
    for (let j = 0; j < raw.length; j++) {
      const c = raw[j];
      if (q) { cur += c; if (c === "\\" && q === '"') cur += raw[++j] ?? ""; else if (c === q) q = null; continue; }
      if (c === '"' || c === "'") { q = c; cur += c; continue; }
      if (c === ";" || c === "&" || c === "|" || c === "{" || c === "}" || c === "(" || c === ")") {
        parts.push({ s: cur, piped: c === "|" && raw[j + 1] !== "|" }); cur = "";
        if ((c === "|" || c === "&") && raw[j + 1] === c) j++;
        continue;
      }
      cur += c;
    }
    parts.push({ s: cur, piped: false });
    for (const p of parts) {
      const t = p.s.trim();
      if (!/^(?:echo|printf)\b/.test(t) || p.piped) continue;
      // single-quoted text never expands; anything else with $ or ` does
      const live = t.replace(/'[^']*'/g, "''");
      if (/[$`]/.test(live)) bad.push(t);
    }
  }
  return bad;
}

test("the rule itself: a printed variable fails, a fixed string passes (mutations)", () => {
  for (const s of ['print(keep)', 'print(json.dumps(keep, indent=2))', 'log("email: %d" % email)',
    'log("email: %d subscribers" % email)', 'print(f"{n} readers")', 'print("read " + str(n))',
    'print("n: {}".format(n))', 'print("n", n)', 'sys.stdout.write(str(n))', 'log("::warning::failed: " + err)',
    '    print("::error::count failed: %s %s" % (type(ex).__name__, getattr(ex, "code", "")))']) {
    assert.ok(pyPrintsOfValues(s).length === 1, "should fail: " + s);
  }
  for (const s of ['print("counts read")', "print('ok', flush=True)", 'log("email: count read")',
    'print("::error::count failed", file=sys.stderr)', '# print(keep)', 'def log(msg):']) {
    assert.deepEqual(pyPrintsOfValues(s), [], "should pass: " + s);
  }
  for (const s of ['echo "worker replied: $RESP"', 'echo "list now holds $COUNT addresses"', "echo `wc -l < x`",
    'printf "%s\\n" "$RESP"', 'X=1; echo "$X"', '[ -n "$A" ] || { echo "n=$N"; exit 1; }']) {
    assert.ok(shPrintsOfValues(s).length === 1, "should fail: " + s);
  }
  for (const s of ['echo "import ok"', "echo 'costs $5'", "printf '%s' \"$RESP\" | grep -q ok",
    '{ echo "import FAILED"; exit 1; }', '# echo "$RESP"']) {
    assert.deepEqual(shPrintsOfValues(s), [], "should pass: " + s);
  }
});

// The steps and functions that hold the list or its counts.
const SCOPES = () => {
  const sc = read(".github/workflows/subs-count.yml");
  const kv = read(".github/workflows/import-kv.yml");
  const r = read("scripts/subscriber_report.py");
  const a = read("scripts/build_audience.py");
  const s = read("scripts/build_signups.py");
  const am = fn(a, "main");
  const e0 = am.indexOf('lu, lt = os.environ.get("LIST_URL"');
  assert.ok(e0 >= 0, "build_audience main reads the list");
  const e1 = am.indexOf("\n\n", e0);
  return {
    "subs-count.yml Counts": { sh: step(sc, "Counts") },
    "import-kv.yml Import": { sh: step(kv, "Import") },
    "subscriber_report.py main": { py: fn(r, "main") },
    "subscriber_report.py get": { py: fn(r, "get") },
    "build_audience.py email_count": { py: fn(a, "email_count") },
    "build_audience.py main, the list block": { py: am.slice(e0, e1 < 0 ? undefined : e1) },
    "build_signups.py main": { py: fn(s, "main") },
    "build_signups.py get_notices": { py: fn(s, "get_notices") },
  };
};

test("the scopes are found: the count step's Python and each function", () => {
  const sc = SCOPES()["subs-count.yml Counts"].sh;
  assert.match(sc, /keep\["generated_at"\]/, "the count step's Python is in scope");
  for (const [name, v] of Object.entries(SCOPES())) assert.ok((v.sh || v.py || "").length > 40, name + " is not empty");
});

test("only fixed strings are printed where the subscriber list is read", () => {
  for (const [name, { sh, py }] of Object.entries(SCOPES())) {
    if (sh !== undefined) {
      assert.deepEqual(shPrintsOfValues(sh), [], name + ": shell prints");
      // the Python heredoc inside a step follows the Python rule
      const docs = [...sh.matchAll(/<<'?PY'?\n([\s\S]*?)\n\s*PY(?:\n|$)/g)];
      if (/<<'?PY/.test(sh)) assert.ok(docs.length > 0, name + ": its Python heredoc is read");
      for (const m of docs) assert.deepEqual(pyPrintsOfValues(m[1]), [], name + ": python prints");
    }
    if (py !== undefined) assert.deepEqual(pyPrintsOfValues(py), [], name);
  }
});

test("no workflow puts a token in a URL", () => {
  for (const f of readdirSync(new URL(".github/workflows/", ROOT)).filter((x) => /\.ya?ml$/.test(x))) {
    assert.doesNotMatch(read(".github/workflows/" + f), /[?&]token=/, f);
  }
});

test("subscriber counts: saved to the private repo; the private key never reaches the step that reads the list", () => {
  const w = read(".github/workflows/subs-count.yml");
  assert.match(w, /"Authorization": "Bearer " \+ os\.environ\["LIST_TOKEN"\]/);
  assert.match(w, /private\/data\/subs-count\.json/);
  assert.match(w, /RAW_BRANCH: private-data\n\s+run: bash scripts\/push_raw\.sh "subscriber counts" private\/data\/subs-count\.json/);
  assert.doesNotMatch(step(w, "Counts"), /PRIVATE_REPO_TOKEN/, "the count step gets the list key only");
  assert.doesNotMatch(w.slice(w.indexOf("- name: Counts"), w.indexOf("- name: Save")), /PRIVATE_REPO_TOKEN/);
  assert.equal((w.match(/secrets\.PRIVATE_REPO_TOKEN/g) || []).length, 2, "the private key: the engine checkout and the save step, nowhere else");
  assert.match(w, /persist-credentials: false/, "the checkout keeps no job token on disk");
  const k = read(".github/workflows/import-kv.yml");
  assert.match(k, /-H "Authorization: Bearer \$LIST_TOKEN"/);
});

test("the report and count scripts send the token as a header", () => {
  const r = read("scripts/subscriber_report.py");
  assert.match(fn(r, "get"), /"Authorization": "Bearer " \+ token/);
  assert.doesNotMatch(fn(r, "get"), /token=/);
  assert.doesNotMatch(fn(r, "main"), /summary\(/, "the per-list totals go only in the email");
  const a = read("scripts/build_audience.py");
  assert.match(fn(a, "email_count"), /"Authorization": "Bearer " \+ token/);
  assert.doesNotMatch(fn(a, "email_count"), /token=/);
  const s = read("scripts/build_signups.py");
  assert.match(fn(s, "get_notices"), /Authorization="Bearer " \+ token/);
  assert.doesNotMatch(fn(s, "get_notices"), /token=/);
});
