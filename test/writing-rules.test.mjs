/* Writing rules check: a ratchet. Counts may only go down.
 *
 * For each hand-kept public page (.html, not in test/, notes/ or scripts/; not a generated set's page; not
 * the Daily archive; not the legal pages) it counts, in the visible text only:
 *   long   sentences over 25 words (instructions are counted under "instr")
 *   instr  instruction sentences over 20 words (a sentence that starts with a command word)
 *   terms  uses of a word the term list replaces (see TERMS below)
 *   dash   em dashes
 * Left out of the text: scripts, styles, code, pre, svg, the head, site nav and footer, table headers,
 * field labels, buttons, options, headings, and short quoted names. Text that a script writes into the page
 * is not read here.
 *
 * test/writing-rules-baseline.json holds today's counts per file. The check fails when a count goes up or a
 * page has a count and is not listed. When counts go down, lower the baseline:
 *   WRITING_UPDATE=1 node --test test/writing-rules.test.mjs
 * (that also lists a new page; commit the file).  Print a table:  WRITING_REPORT=1 node --test ...
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const ROOT = new URL("../", import.meta.url);
const BASELINE = new URL("test/writing-rules-baseline.json", ROOT);
const LEGAL = new Set(["terms.html", "privacy.html", "cookies.html", "accessibility.html", "disclaimer.html"]);
const MAX_SENTENCE = 25, MAX_INSTRUCTION = 20;

// Not words from the term list (notes: writing rules). Words that also have an honest everyday use
// (offer, quote, location, rent, in) are not counted.
const TERMS = {
  "posted price": /\bposted prices?\b/gi,
  "bid price": /\bbid prices?\b/gi,
  "elevator price": /\belevator prices?\b/gi,
  "price quote": /\bprice quotes?\b/gi,
  buyer: /\bbuyers?\b/gi,
  facility: /\bfacilit(?:y|ies)\b/gi,
  "rental rate": /\brental rates?\b/gi,
  zip: /\bzip\b(?!\s*codes?\b)/gi,
  briefing: /\bbriefings?\b/gi,
  newsletter: /\bnewsletters?\b/gi,
  subscribe: /\bsubscribe\b|\bjoin (?:the|us|our|free)\b/gi,
  average: /\baverages?\b/gi,
  typical: /\btypical(?:ly)?\b|\busual(?:ly)?\b/gi,
  middle: /\bmiddle\b/gi,
  "trading session": /\btrading sessions?\b|\bmarket days?\b/gi,
  "the board": /\bthe board\b|\bCBOT\b/g,
  "weather station": /\bweather stations?\b/gi,
  "bu/ac": /\b(?:bu|ac)\b/g,
  I: /\bI(?:'m|'ve|'ll|'d)?\b(?!\.)/g,
};
const COMMANDS = new Set(("add apply ask book browse call change check choose click compare compute confirm contact copy count divide " +
  "download drag enter fill find follow get go hover keep learn let look make move multiply note open paste pick press print " +
  "pull read reload remember remove reload review save scroll search see select send set share show sign start submit subtract " +
  "swipe take tap tell toggle try turn type update use visit wait watch zoom enter choose divide estimate multiply " +
  "refresh reset clear subscribe use pick please").split(/\s+/));
const ABBR = /(?:\b(?:[A-Za-z]\.[A-Za-z]|vs|etc|approx|No|Nos|St|Mt|Dr|Mr|Mrs|Ms|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|Fig|Inc|Co|Corp|Ltd|avg|est|incl|ca|cf|Ft|Rd|Sr|Jr)\.|\b[A-Z]\.)$/;

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", hellip: "…", middot: "·", times: "×", deg: "°", thinsp: " ", ensp: " ", emsp: " " };
const decode = (s) => s.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (m, d, x, n) =>
  d ? String.fromCodePoint(+d) : x ? String.fromCodePoint(parseInt(x, 16)) : (ENT[n.toLowerCase()] ?? m));

const DROP = "script|style|noscript|svg|template|code|pre|kbd|samp|head|nav|footer|header|th|label|button|option|select|textarea|title|h[1-6]";
const DROP_RE = new RegExp(`<(${DROP})\\b[^>]*>[\\s\\S]*?</\\1\\s*>`, "gi");
const BLOCK_RE = /<\/?(?:p|div|li|ul|ol|td|tr|table|tbody|thead|section|article|aside|main|details|summary|blockquote|figure|figcaption|dd|dt|dl|form|br|hr|caption|fieldset|legend)\b[^>]*>/gi;

export function blocks(html) {
  let s = html.replace(/<!--[\s\S]*?-->/g, " ");
  for (let i = 0; i < 3; i++) s = s.replace(DROP_RE, "\n"); // a second pass reaches elements nested in a dropped one
  s = s.replace(BLOCK_RE, "\n").replace(/<[^>]*>/g, "");
  return decode(s).split("\n").map((b) => b.replace(/\s+/g, " ").trim()).filter(Boolean);
}
export function sentences(block) {
  const parts = block.split(/(?<=[.!?]["')\]”’]?)\s+(?=["'(\[“‘]?[A-Z0-9])/);
  const out = [];
  for (const p of parts) {
    if (out.length && ABBR.test(out[out.length - 1])) out[out.length - 1] += " " + p; else out.push(p);
  }
  return out;
}
const words = (s) => s.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
const isInstruction = (s) => COMMANDS.has((s.match(/^[("'“]*([A-Za-z]+)/)?.[1] ?? "").toLowerCase()) && !/^(?:use|see|note|get|let|keep|make|take|look|read|set)\b[^.]*\b(?:is|are|was|were)\b/i.test(s.slice(0, 40));

export function count(html) {
  const c = { long: 0, instr: 0, terms: 0, dash: 0 }, by = {};
  for (const b of blocks(html)) {
    c.dash += (b.match(/—/g) || []).length;
    const unquoted = b.replace(/[“"][^”"]{1,80}[”"]/g, " ");
    for (const [k, re] of Object.entries(TERMS)) { const n = (unquoted.match(re) || []).length; if (n) { c.terms += n; by[k] = (by[k] || 0) + n; } }
    for (const s of sentences(b)) {
      const w = words(s);
      if (isInstruction(s)) { if (w > MAX_INSTRUCTION) c.instr++; } else if (w > MAX_SENTENCE) c.long++;
    }
  }
  return { c, by };
}

function files() {
  const all = execFileSync("git", ["ls-files", "*.html"], { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 26 }).split("\n").filter(Boolean)
    .filter((f) => !/^(test|notes|scripts|daily)\//.test(f) && !LEGAL.has(f));
  // generated sets are built on main: leave out every page a set's outputs hold
  const built = execFileSync("python3", ["scripts/dev/main_build.py", "paths"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
  // and every file built on main (What's new, the changelog, the test map)
  const py = "import sys,json;sys.path.insert(0,'scripts');import generated_sets as g;b=set(sys.argv[1:]);print(json.dumps([f for f in json.load(sys.stdin) if not g.owner(f) and f not in b]))";
  return JSON.parse(execFileSync("python3", ["-c", py, ...built],
    { cwd: ROOT, input: JSON.stringify(all), encoding: "utf8", maxBuffer: 1 << 26 }));
}

const KEYS = ["long", "instr", "terms", "dash"];
test("writing rules: counts per page only go down", () => {
  const now = {}, by = {}, tot = { long: 0, instr: 0, terms: 0, dash: 0 }, byTot = {};
  for (const f of files()) {
    const { c, by: b } = count(readFileSync(new URL(f, ROOT), "utf8"));
    if (KEYS.some((k) => c[k])) now[f] = Object.fromEntries(KEYS.filter((k) => c[k]).map((k) => [k, c[k]]));
    for (const k of KEYS) tot[k] += c[k];
    for (const [k, n] of Object.entries(b)) byTot[k] = (byTot[k] || 0) + n;
    by[f] = b;
  }
  if (process.env.WRITING_REPORT) {
    console.log("totals", JSON.stringify(tot), "\nterms", JSON.stringify(byTot));
    for (const [f, v] of Object.entries(now).sort((a, b) => (b[1].long || 0) - (a[1].long || 0)).slice(0, 25)) console.log(f, JSON.stringify(v));
  }
  if (process.env.WRITING_UPDATE) {
    writeFileSync(BASELINE, JSON.stringify({ totals: tot, files: Object.fromEntries(Object.entries(now).sort()) }, null, 1) + "\n");
    console.log("writing rules baseline written:", JSON.stringify(tot));
    return;
  }
  const base = JSON.parse(readFileSync(BASELINE, "utf8")).files;
  const up = [], down = [];
  for (const f of new Set([...Object.keys(now), ...Object.keys(base)])) {
    for (const k of KEYS) {
      const a = now[f]?.[k] || 0, b = base[f]?.[k] || 0;
      if (a > b) up.push(`${f}: ${k} ${b} -> ${a}` + (k === "terms" && Object.keys(by[f]).length ? ` (${Object.entries(by[f]).map(([t, n]) => `${t} x${n}`).join(", ")})` : ""));
      else if (a < b) down.push(`${f}: ${k} ${b} -> ${a}`);
    }
  }
  if (down.length) console.log(`writing rules: ${down.length} count(s) went down. Lower the baseline: WRITING_UPDATE=1 node --test test/writing-rules.test.mjs and commit test/writing-rules-baseline.json\n  ` + down.slice(0, 20).join("\n  "));
  assert.deepEqual(up, [], `writing rules: counts went up (long and instr: shorten the sentence; terms: use the word from the term list; dash: remove the em dash). Keep sentences to 25 words, instructions to 20. Rules: the writing rules note.\n  ${up.join("\n  ")}`);
});

test("writing rules: the counter reads what it should", () => {
  const long = Array(26).fill("word").join(" ") + ".";
  const ok = Array(25).fill("word").join(" ") + ".";
  const ins = "Enter " + Array(20).fill("word").join(" ") + ".";
  const html = `<head><title>x. ${long}</title></head><nav><p>${long}</p></nav><h2>${long}</h2><p>${long} ${ok} Short one.</p>` +
    `<p>${ins}</p><p>Enter your ZIP code. Enter your zip. We use the U.S. average — and a buyer. He said &mdash; ok.</p>` +
    `<script>var s = "${long}";</script><code>${long}</code><table><tr><th>${long}</th></tr></table><p>Call the “buyer” now.</p>`;
  const { c, by } = count(html);
  assert.deepEqual(c, { long: 1, instr: 1, terms: 3, dash: 2 }, JSON.stringify(by));
  assert.deepEqual(by, { buyer: 1, zip: 1, average: 1 });
  assert.equal(sentences("We saw 4.41 corn in the U.S. today. Next one.").length, 2);
});
