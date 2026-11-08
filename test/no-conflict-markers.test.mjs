/* No git conflict markers in a tracked text file (Nov 8, 2026: a merge with conflict markers in index.html reached
 * main in #424, 4158aca, and no check caught it).
 *
 * The rule: no tracked html, css, js, mjs, py, json, md, yml, yaml or sh file (node_modules and binary files skipped)
 * holds a line that starts with "<<<<<<<" or ">>>>>>>" (alone or followed by a space), and no "=======" line alone
 * inside such a block. A lone "=======" outside a block is a markdown setext heading and passes.
 * git grep finds the candidate files (tracked only, binary skipped); markerLines() decides.
 * This file builds its markers with repeat() so it never holds one itself.
 * Runs in every pull request (CORE in scripts/dev/test_map.py).
 *   node --test test/no-conflict-markers.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OPEN = "<".repeat(7), MID = "=".repeat(7), BASE = "|".repeat(7), CLOSE = ">".repeat(7);
const EXTS = ["html", "css", "js", "mjs", "py", "json", "md", "yml", "yaml", "sh"];
const PATHSPEC = [...EXTS.map((e) => `*.${e}`), ":(exclude)node_modules", ":(exclude,glob)**/node_modules/**"];
const isMark = (line, m) => line === m || line.startsWith(m + " ");

// the 1-based line numbers of conflict markers in one text
export function markerLines(text) {
  const out = [];
  let open = false;
  text.split(/\r?\n/).forEach((line, i) => {
    if (isMark(line, OPEN)) { out.push(i + 1); open = true; }
    else if (isMark(line, CLOSE)) { out.push(i + 1); open = false; }
    else if (open && (line === MID || isMark(line, BASE))) out.push(i + 1);
  });
  return out;
}

// "path:line" for every marker in the tracked text files of the git checkout at dir
export function scanRepo(dir) {
  let list = "";
  try {
    list = execFileSync("git", ["-C", dir, "grep", "-lzIE", `^(${OPEN}|${MID}|>{7})( |$)`, "--", ...PATHSPEC],
      { encoding: "utf8", maxBuffer: 64 << 20 });
  } catch (e) {
    if (e.status === 1) return [];  // git grep: no match
    throw e;
  }
  const hits = [];
  for (const rel of list.split("\0").filter(Boolean)) {
    let text;
    try { text = fs.readFileSync(path.join(dir, rel), "utf8"); } catch { continue; }
    for (const n of markerLines(text)) hits.push(`${rel}:${n}`);
  }
  return hits;
}

test("no tracked text file in this checkout holds a git conflict marker", () => {
  const hits = scanRepo(ROOT);
  assert.deepEqual(hits, [], `conflict markers left by a merge (resolve them):\n${hits.join("\n")}`);
});

test("fixture: a real marker block fails, a markdown heading and a stray rule pass", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "conflict-markers-"));
  try {
    execFileSync("git", ["init", "-q", dir]);
    const w = (name, body) => fs.writeFileSync(path.join(dir, name), body);
    w("index.html", ["<p>a</p>", `${OPEN} HEAD`, "<p>ours</p>", MID, "<p>theirs</p>", `${CLOSE} 4158aca`, ""].join("\n"));
    w("diff3.js", ["x = 1;", `${OPEN} ours`, "y = 1;", `${BASE} base`, "y = 0;", MID, "y = 2;", CLOSE, ""].join("\n"));
    w("half.py", ["a = 1", `${CLOSE} main`, ""].join("\n"));  // half resolved: the close marker left behind
    w("README.md", ["Title", MID, "", "Text", "", "Other", "=".repeat(12), ""].join("\n"));
    w("rule.css", ["/*", MID, "*/", ".a{}", ""].join("\n"));
    w("photo.png", `${OPEN} HEAD\n`);  // not a text extension
    fs.mkdirSync(path.join(dir, "node_modules", "x"), { recursive: true });
    w("node_modules/x/i.js", `${OPEN} HEAD\n${MID}\n${CLOSE} b\n`);
    w("bin.json", Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(`\n${OPEN} HEAD\n`)]));  // binary: skipped
    execFileSync("git", ["-C", dir, "add", "-f", "-A"]);
    w("untracked.html", `${OPEN} HEAD\n`);  // not tracked: skipped
    assert.deepEqual(scanRepo(dir).sort(), ["diff3.js:2", "diff3.js:4", "diff3.js:6", "diff3.js:8", "half.py:2",
      "index.html:2", "index.html:4", "index.html:6"]);
    assert.deepEqual(markerLines(["Heading", MID, "body"].join("\n")), []);
    assert.deepEqual(markerLines(["a", `${OPEN} HEAD`, "b", MID, "c", `${CLOSE} x`].join("\r\n")), [2, 4, 6]);
    assert.deepEqual(markerLines(`${OPEN}x\n${CLOSE}y\n`), []);  // a marker is the run alone or followed by a space
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
