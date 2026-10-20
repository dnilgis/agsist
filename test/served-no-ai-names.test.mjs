// What the site serves names no AI vendor or model (Sig, 2026-10-20: "de AI, de Claude").
// Served = every file Pages publishes; this checks the text kinds (html, js, css, json,
// txt, xml and friends) outside test/, scripts/, .claude/ and .github/.
//
// "anthropic" never appears. "claude" does, honestly, as people and places: land sale
// grantors ("CLAUDE ROGER BAILEY"), Claude, TX and St Claude, MB. A capitalized name
// is allowed; anything that reads as the software is not: lowercase "claude" (model ids
// like claude-opus-5-5, /home/claude paths, .claude/), CLAUDE.md, or the name followed by
// a product word (Claude Code, Claude AI, Claude Opus...).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKIP_DIRS = new Set([".git", "node_modules", "test", "scripts", ".claude", ".github"]);
const EXT = /\.(html?|m?js|css|json|geojson|txt|xml|svg|webmanifest|csv)$/i;

export function aiNames(text) {
  const out = [];
  const re = /anthropic|claude/gi;
  let m;
  while ((m = re.exec(text))) {
    const w = m[0], before = text.slice(Math.max(0, m.index - 1), m.index), after = text.slice(re.lastIndex, re.lastIndex + 12);
    let bad;
    if (/^anthropic$/i.test(w)) bad = true;
    // lowercase only as the slug of Claude, TX (/texas/claude/, /tx/claude.html)
    else if (w === "claude") bad = !(/\/(texas|tx)\/$/i.test(text.slice(Math.max(0, m.index - 7), m.index)) && /^(\/|\.html|\b)/.test(after));
    else if (w === "Claude" || w === "CLAUDE")
      bad = /[.\/@]$/.test(before) || /^[ .\-_]?(md|ai|code|opus|sonnet|haiku|fable|api|model)\b/i.test(after);
    else bad = true; // cLaude and the like are not anybody's name
    if (bad) out.push(text.slice(Math.max(0, m.index - 30), re.lastIndex + 30).replace(/\s+/g, " "));
  }
  return out;
}

function* served(dir, rel = "") {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!(rel === "" && SKIP_DIRS.has(e.name)) && e.name !== ".git" && e.name !== "node_modules") yield* served(path.join(dir, e.name), rel + e.name + "/"); }
    else if (e.isFile() && EXT.test(e.name)) yield [rel + e.name, path.join(dir, e.name)];
  }
}

test("the matcher: software names are caught, people and places are not", () => {
  for (const s of ['"model":"claude-opus-5-5"', "/home/claude/agsist", "(CLAUDE.md: depth on demand)", "see .claude/notes",
                   "Anthropic", "made with Claude Code", "Claude AI", "Claude Opus 5", "claude-haiku-4-5-20251001", "CLAUDE.MD"])
    assert.ok(aiNames(s).length, `should catch: ${s}`);
  for (const s of ['"Claude, TX"', '"ST CLAUDE","MB"', '"CLAUDE ROGER BAILEY"', '"Rex, Claude H. and Elaine M."',
                   "CLAUDETTE OBERJOHANN", '["Heartland Co-op","CLAUDE","known"]', "/cash-bids/texas/claude/", "/cash-bids/texas/claude.html"])
    assert.deepEqual(aiNames(s), [], `should allow: ${s}`);
});

test("no served file names an AI vendor or model", () => {
  const hits = [];
  let n = 0;
  for (const [rel, abs] of served(ROOT)) {
    n++;
    const t = fs.readFileSync(abs, "latin1");
    if (!/anthropic|claude/i.test(t)) continue;
    for (const h of aiNames(t)) hits.push(`${rel}: ...${h}...`);
  }
  assert.ok(n > 1000, `walked ${n} served files`);
  assert.deepEqual(hits.slice(0, 20), [], `${hits.length} mention(s) in served files`);
});
