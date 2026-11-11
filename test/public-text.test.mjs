/* Public text guard.
 *
 * 1. Comments in the files the site serves (pages, components, style sheets,
 *    the service worker) carry the technical reason only: no owner name, no
 *    decision or review wording, no private repo or notes paths. Visible text
 *    (the byline and contact lines) is not a comment and is not checked.
 * 2. Public data files (data/**\/*.json) do not gain method text: script
 *    names, data service endpoint names, private repo paths or the owner's
 *    name. test/public-data-text.json lists what is left, per file; the list
 *    only goes down.
 *
 *   node --test test/public-text.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const ROOT = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), "utf8");
const git = (args) => {
  try { return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28 }); }
  catch (e) { if (e.status === 1) return ""; throw e; }
};

// a small reader for comment spans [start, end) in JS, CSS and HTML

const KW = new Set(["return", "typeof", "case", "do", "else", "in", "of", "new", "delete", "void", "throw", "yield", "await", "instanceof"]);
const PUNCT_RE = "(,=:[!&|?{};+-*%<>~^";
function jsComments(src) {
  const out = [];
  let i = 0;
  const n = src.length;
  let last = "";      // last significant token: a punctuation char, "w" word, "k" keyword, "v" value
  const stack = [];   // template brace depths
  const isId = (c) => /[A-Za-z0-9_$\u0080-￿]/.test(c);
  function str(q) { i++; while (i < n) { const c = src[i]; if (c === "\\") { i += 2; continue; } if (c === q || c === "\n") { i++; return; } i++; } }
  function tmpl() { // at a backtick or after a closing } of ${}: scan template text
    while (i < n) {
      const c = src[i];
      if (c === "\\") { i += 2; continue; }
      if (c === "`") { i++; last = "v"; return; }
      if (c === "$" && src[i + 1] === "{") { i += 2; stack.push(0); last = "{"; return; }
      i++;
    }
  }
  function regex() {
    i++; let cls = false;
    while (i < n) {
      const c = src[i];
      if (c === "\\") { i += 2; continue; }
      if (c === "\n") break;
      if (cls) { if (c === "]") cls = false; }
      else if (c === "[") cls = true;
      else if (c === "/") { i++; break; }
      i++;
    }
    while (i < n && /[a-z]/i.test(src[i])) i++;
    last = "v";
  }
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === "/" && d === "/") { const s = i; while (i < n && src[i] !== "\n") i++; out.push([s, i]); continue; }
    if (c === "/" && d === "*") { const s = i; const e = src.indexOf("*/", i + 2); i = e < 0 ? n : e + 2; out.push([s, i]); continue; }
    if (c === "'" || c === '"') { str(c); last = "v"; continue; }
    if (c === "`") { i++; tmpl(); continue; }
    if (c === "/") {
      if (last === "" || last === "k" || PUNCT_RE.includes(last)) { regex(); continue; }
      i++; last = "/"; continue;
    }
    if (/\s/.test(c)) { i++; continue; }
    if (isId(c)) { const s = i; while (i < n && isId(src[i])) i++; const w = src.slice(s, i); last = KW.has(w) ? "k" : "w"; continue; }
    if (c === "{") { if (stack.length) stack[stack.length - 1]++; i++; last = "{"; continue; }
    if (c === "}") {
      if (stack.length) { if (stack[stack.length - 1] === 0) { stack.pop(); i++; tmpl(); continue; } stack[stack.length - 1]--; }
      i++; last = "}"; continue;
    }
    if (c === ")" || c === "]") { i++; last = ")"; continue; }
    i++; last = c;
  }
  return out;
}
function cssComments(src) {
  const out = []; let i = 0; const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "*") { const s = i; const e = src.indexOf("*/", i + 2); i = e < 0 ? n : e + 2; out.push([s, i]); continue; }
    if (c === "'" || c === '"') { i++; while (i < n && src[i] !== c && src[i] !== "\n") { if (src[i] === "\\") i++; i++; } i++; continue; }
    i++;
  }
  return out;
}
function htmlComments(src) {
  const out = []; let i = 0;
  const re = /<!--[\s\S]*?-->|<script\b([^>]*)>([\s\S]*?)<\/script>|<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  let m;
  while ((m = re.exec(src))) {
    if (m[0].startsWith("<!--")) { out.push([m.index, m.index + m[0].length]); continue; }
    if (m[3] !== undefined) {
      const off = m.index + m[0].indexOf(">") + 1;
      for (const [a, b] of cssComments(m[3])) out.push([off + a, off + b]);
      continue;
    }
    const attrs = m[1] || "";
    if (/\bsrc\s*=/.test(attrs)) continue;
    const t = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs);
    if (t && !/^(text\/javascript|module|application\/javascript)$/i.test(t[1])) continue;
    const off = m.index + m[0].indexOf(">") + 1;
    for (const [a, b] of jsComments(m[2])) out.push([off + a, off + b]);
  }
  return out;
}
function commentsFor(path, src) {
  if (/\.(m?js)$/.test(path)) return jsComments(src);
  if (/\.css$/.test(path)) return cssComments(src);
  if (/\.html?$/.test(path)) return htmlComments(src);
  return null;
}

const WORDING = /\bSig\b|\bSIG\b|TODO-SIG|\bfeedbag\b|\bnotes\/[A-Z][\w-]*\.md|\bBUILD-RULES\b|\bSTANDING-DECISIONS\b|\b[Ss]keptic\b|\bby the lead\b|\b[Aa]dversar(?:y|ial) (?:pass|review|check)\b/;
const WORDING_GREP = "\\bSig\\b|\\bSIG\\b|feedbag|notes/[A-Z]|BUILD-RULES|STANDING-DECISIONS|[Ss]keptic|by the lead|[Aa]dversar";
const NOT_SERVED = /^(scripts|test|build|vendor|references|workers|\.github|\.claude)\//;

test("comments in served files carry no owner name or process wording", () => {
  const hits = git(["grep", "-l", "-I", "-E", WORDING_GREP, "--", "*.html", "*.js", "*.css"])
    .split("\n").filter((f) => f && !NOT_SERVED.test(f));
  assert.ok(hits.length > 0, "the byline pages name the owner in visible text, so git grep finds something");
  const bad = [];
  for (const f of hits) {
    const src = read(f);
    for (const [a, b] of commentsFor(f, src) || []) {
      const c = src.slice(a, b), m = WORDING.exec(c);
      if (m) bad.push(f + ":" + src.slice(0, a).split("\n").length + ": " + c.slice(Math.max(0, m.index - 40), m.index + 40).replace(/\s+/g, " "));
    }
  }
  assert.deepEqual(bad, [], "write the reason in neutral words");
});

test("the comment reader finds comments and leaves strings and regexes alone", () => {
  const js = "var a = '// not'; var r = /\\/\\/x/g; // yes Sig\n/* block */ var t = `x ${ '/*' } y`; // two";
  assert.deepEqual(jsComments(js).map(([a, b]) => js.slice(a, b)), ["// yes Sig", "/* block */", "// two"]);
  const h = '<p>Sig</p><!-- c --><script>var x = "<!--"; // d\n</script><style>a{b:"/*"}/* e */</style>';
  assert.deepEqual(htmlComments(h).map(([a, b]) => h.slice(a, b)), ["<!-- c -->", "// d", "/* e */"]);
});

const METHOD_GREP = "msgbatch_|\"batch_id\"|\\bSig\\b|scripts/[A-Za-z0-9_-]+\\.(py|mjs|sh)\\b|\\b(MultiStnData|StnData|GridData)\\b|feedbag|\\.github/workflows";
const METHOD_RE = new RegExp(METHOD_GREP, "g");
// every hit in each file's whole text (git grep -c counts lines, so a one-line file counted once)
const hitsPerFile = (files) => Object.fromEntries(files.map((f) => [f, (read(f).match(METHOD_RE) || []).length]).filter(([, n]) => n > 0));

test("the ratchet counts hits in the whole file, not lines", () => {
  const one = '{"a": "see scripts/x.py", "b": "and scripts/y.py", "c": "msgbatch_1"}';
  assert.equal((one.match(METHOD_RE) || []).length, 3, "three hits on one line count three");
  assert.equal(('"batch_id": 1\n"batch_id": 2'.match(METHOD_RE) || []).length, 2);
});

test("public data files gain no method text (the list only goes down)", () => {
  const allowed = JSON.parse(read("test/public-data-text.json"));
  // hits per file content, not per line: a minified file is one line and may hold many hits
  const have = hitsPerFile(git(["grep", "-l", "-I", "-E", METHOD_GREP, "--", "data/*.json", "data/**/*.json"]).split("\n").filter(Boolean));
  const over = Object.entries(have).filter(([f, n]) => n > (allowed[f] || 0)).map(([f, n]) => f + ": " + n + " hit(s), allowed " + (allowed[f] || 0));
  assert.deepEqual(over, [], "name the source in plain words; no script, endpoint or private path in a public data file");
  // data/ids is rebuilt on main by the bids job, never in a pull request: a count there that drops (or a file the
  // rebuild removes) is not asked of this list; a rise still fails above
  const lower = Object.entries(allowed).filter(([f, n]) => (have[f] || 0) < n && !f.startsWith("data/ids/")).map(([f, n]) => f + ": allowed " + n + ", has " + (have[f] || 0));
  assert.deepEqual(lower, [], "lower these counts in test/public-data-text.json");
  for (const f of ["data/rain-month.json", "data/rain/ia.json", "data/rain/context/ia.json"]) assert.ok(!(f in allowed), f + " stays clean");
});
