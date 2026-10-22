// Sig, 2026-10-22: the site's public email addresses are on agsist.com (sig@, privacy@,
// news@, bids@). No farmers1st.com email address may appear anywhere in the repo:
// pages, generated pages, data, scripts, workers, workflows or tests. Links to the
// farmers1st.com website that identify Sig (sameAs, "about me") are fine; only an
// address (name@ or name%40 the domain) fails. The allow-list is empty on purpose.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("../", import.meta.url).pathname;
const DOMAIN = ["farmers1st", "com"].join("\\.");
const RX = new RegExp("[A-Za-z0-9._%+'-]+(?:@|%40)" + DOMAIN + "\\b", "i");
const ERE = "[A-Za-z0-9._%+'-]+(@|%40)" + DOMAIN;   // the same, for git grep -E
const ALLOW = new Set([]);

function hitsByGit() {
  try {
    const out = execFileSync("git", ["grep", "-I", "-n", "-i", "-E", ERE], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 << 20 });
    return out.split("\n").filter((l) => l && RX.test(l));
  } catch (e) {
    if (e.status === 1) return [];          // git grep: no match
    return null;                            // no git here: walk the tree instead
  }
}

function hitsByWalk() {
  const hits = [];
  const walk = (d) => {
    for (const n of readdirSync(d)) {
      if (n === ".git" || n === "node_modules") continue;
      const p = join(d, n), s = statSync(p);
      if (s.isDirectory()) { walk(p); continue; }
      if (s.size > 16 << 20) continue;
      const b = readFileSync(p);
      if (b.includes(0)) continue;          // binary
      b.toString("utf8").split("\n").forEach((l, i) => { if (RX.test(l)) hits.push(`${relative(ROOT, p)}:${i + 1}:${l}`); });
    }
  };
  walk(ROOT);
  return hits;
}

test("the pattern catches an address and leaves the website link alone", () => {
  const at = "@", dom = "farmers1st.com";
  assert.ok(RX.test("write to sig" + at + dom));
  assert.ok(RX.test("mailto:a" + at + dom.toUpperCase()));
  assert.ok(RX.test("mailto:sig%40" + dom));
  assert.ok(!RX.test('"sameAs": ["https://' + dom + '"]'));
  assert.ok(!RX.test("sig@agsist.com"));
});

test("no farmers1st.com email address anywhere in the repo (allow-list: none)", () => {
  const hits = (hitsByGit() ?? hitsByWalk()).filter((h) => !ALLOW.has(h.split(":")[0]));
  assert.deepEqual(hits.slice(0, 20).map((h) => h.slice(0, 200)), [], `${hits.length} line(s) carry a farmers1st.com address; use sig@, privacy@, news@ or bids@agsist.com`);
});
