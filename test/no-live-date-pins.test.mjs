/**
 * No test pins a month, a date or a season to live data or to today's clock (Nov 3, 2026). In one day test/drought-to50 pinned "September",
 * test/lrp-page assumed CDT after DST, test/conditions-week assumed the condition week was the harvest week, and
 * scripts/test_daily_numbers.py compared a fixture to the live data/harvest-prices.json and held the Daily.
 *
 * The rule: a test that reads a live file under data/ (a bot rewrites it) or today's clock (new Date with no
 * argument, Date.now, datetime.now, date.today) may not hold a literal month name or a literal date
 * (YYYY-MM-DD) in what it asserts. Copy the real file into test/fixtures/ and assert on the copy, or compute
 * the expectation from the data or the date.
 *
 * What counts: the EXPECTED side of an assertion only (assert.equal/strictEqual/deepEqual: the 2nd argument;
 * assert.match: the pattern; assert.ok and python check/ck: the condition), never the message.
 * A literal that is an inline fixture (the value is built in the test itself, not read from data/ or the clock)
 * can say so on its line: a comment "pin-ok: <why>" (// in node, # in python) and the line is not counted.
 * test/no-live-date-pins.json holds the count each older file had on Nov 3 (most are inline fixtures that only
 * look like pins); a file may go down, never up, and a file not listed must have none.
 *   node --test test/no-live-date-pins.test.mjs
 *   AGSIST_PIN_REPORT=1 node --test test/no-live-date-pins.test.mjs   prints every flagged line
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SELF = "test/no-live-date-pins.test.mjs";
const RATCHET = "test/no-live-date-pins.json";

const MONTH = /\b(January|February|March|April|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)\b/;
const ISO = /\b20\d\d-[01]\d-[0-3]\d\b/;

// reads a live data/ file: a quoted path under data/ (not test/fixtures), or a path joined from "data"
const LIVE_JS = /["'`](?:\.\.\/|\.\/)?data\/[\w./${}-]+["'`]|join\([^)\n]*["']data["']/;
const LIVE_PY = /["'](?:\.\.\/)?data\/[\w./{}-]+["']|\/\s*["']data["']|join\([^)\n]*["']data["']/;
const CLOCK_JS = /new Date\(\s*\)|Date\.now\(\)/;
const CLOCK_PY = /datetime\.(?:now|utcnow|today)\(|\bdate\.today\(\)|time\.time\(\)/;

// split "a, b, c" at top-level commas, skipping strings, template literals, regexes and brackets
function args(src, open) {
  const out = []; let depth = 0, cur = "", i = open + 1, q = null;
  for (; i < src.length; i++) {
    const c = src[i];
    if (q) {
      cur += c;
      if (c === "\\") { cur += src[++i] || ""; continue; }
      if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { q = c; cur += c; continue; }
    if (c === "/" && /[(,=:[!&|?{};]\s*$|^\s*$/.test(cur.slice(-20)) && src[i + 1] !== "/" && src[i + 1] !== "*") { q = "/"; cur += c; continue; }
    if ("([{".includes(c)) depth++;
    if (")]}".includes(c)) { if (depth === 0) { out.push(cur); return out; } depth--; }
    if (c === "," && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

// the expected side of each assertion in a source file, with its line number
function expectedParts(src, py) {
  const parts = [];
  const re = py ? /\b(check|ck|assert)\s*[( ]/g : /\bassert(?:\.(\w+))?\s*\(/g;
  let m;
  while ((m = re.exec(src))) {
    const line = src.slice(0, m.index).split("\n").length;
    const lineText = src.split("\n")[line - 1];
    if (/^\s*(\/\/|#|\*)/.test(lineText) || /pin-ok:/.test(lineText)) continue;
    if (py) {
      if (m[1] === "assert") { parts.push([line, src.slice(m.index + 6, src.indexOf("\n", m.index)).split(/,\s*["'f]/)[0]]); continue; }
      if (src[m.index + m[0].length - 1] !== "(") continue;
      parts.push([line, args(src, m.index + m[0].length - 1)[0] || ""]);
      continue;
    }
    const kind = m[1] || "ok";
    const a = args(src, m.index + m[0].length - 1);
    if (/^(equal|strictEqual|deepEqual|deepStrictEqual|notEqual|notDeepEqual)$/.test(kind)) parts.push([line, a[1] || ""]);
    else if (/^(match|doesNotMatch)$/.test(kind)) parts.push([line, a[1] || ""]);
    else if (kind === "ok" || kind === "") parts.push([line, a[0] || ""]);
  }
  return parts;
}

function scan(rel, src = fs.readFileSync(path.join(ROOT, rel), "utf8")) {
  const py = rel.endsWith(".py");
  const live = (py ? LIVE_PY : LIVE_JS).test(src);
  const clock = (py ? CLOCK_PY : CLOCK_JS).test(src);
  if (!live && !clock) return [];
  return expectedParts(src, py)
    .filter(([, e]) => MONTH.test(e.replace(/\/\/.*$/gm, "")) || ISO.test(e))
    .map(([line, e]) => `${rel}:${line}: ${e.replace(/\s+/g, " ").trim().slice(0, 140)}`);
}

export function testFiles() {
  const out = [];
  for (const f of fs.readdirSync(path.join(ROOT, "test")).sort())
    if (f.endsWith(".test.mjs") && `test/${f}` !== SELF) out.push(`test/${f}`);
  for (const f of fs.readdirSync(path.join(ROOT, "scripts")).sort())
    if (/^test_[\w-]+\.py$/.test(f)) out.push(`scripts/${f}`);
  return out;
}

test("the scanner sees a live pin and leaves a fixture or a computed expectation alone", () => {
  const pin = 'const d = JSON.parse(fs.readFileSync("data/drought/summary.json"));\nassert.equal(d.month, "September");\n';
  const fx = 'const d = JSON.parse(fs.readFileSync("test/fixtures/drought/summary.json"));\nassert.equal(d.month, "September");\n';
  const rel = 'const d = JSON.parse(fs.readFileSync("data/drought/summary.json"));\nassert.equal(d.month, monthName(d.through), "not September");\n';
  const clock = 'const now = new Date();\nassert.match(label(now), /November/);\n';
  assert.equal(scan("test/a.test.mjs", pin).length, 1, "live file + month literal");
  assert.equal(scan("test/b.test.mjs", fx).length, 0, "a fixture copy is fine");
  assert.equal(scan("test/c.test.mjs", rel).length, 0, "a month only in the message is fine");
  assert.equal(scan("test/d.test.mjs", clock).length, 1, "today's clock + month literal");
  assert.equal(scan("test/e.test.mjs", pin.replace('"September");', '"September"); // pin-ok: inline row above')).length, 0, "a marked inline fixture");
  const pyPin = 'hp = json.load(open(REPO / "data" / "harvest-prices.json"))\ncheck(hp["windows"][0]["start"] == "2026-10-01", "October window")\n';
  assert.equal(scan("scripts/test_x.py", pyPin).length, 1, "python: live file + date literal");
  assert.equal(scan("scripts/test_y.py", pyPin.replace('REPO / "data" / "harvest-prices.json"', 'FIX / "harvest-prices.json"')).length, 0, "python fixture");
});

test("no test adds a month or date pin against live data or today's clock", () => {
  const allowed = JSON.parse(fs.readFileSync(path.join(ROOT, RATCHET), "utf8")).files;
  const found = {};
  const lines = [];
  for (const rel of testFiles()) {
    const hits = scan(rel);
    if (hits.length) { found[rel] = hits.length; lines.push(...hits); }
  }
  if (process.env.AGSIST_PIN_REPORT) console.log(lines.join("\n") + "\n" + JSON.stringify(found, null, 1));
  const over = Object.entries(found).filter(([f, n]) => n > (allowed[f] || 0))
    .map(([f, n]) => `${f}: ${n} pinned assertion(s), ${allowed[f] || 0} allowed\n    ` + lines.filter((l) => l.startsWith(f + ":")).join("\n    "));
  assert.deepEqual(over, [], "a test that reads live data/ or today's clock asserts a literal month or date. Copy the real data "
    + "into test/fixtures/ and assert on the copy, or compute the expectation from the data or the date (Sig, Nov 3, 2026)");
  // the list only shrinks: a count above what the file has now is lowered in the same change
  const stale = Object.entries(allowed).filter(([f, n]) => (found[f] || 0) < n).map(([f, n]) => `${f}: allowed ${n}, has ${found[f] || 0}`);
  assert.deepEqual(stale, [], `lower these counts in ${RATCHET} (the list only goes down)`);
});
