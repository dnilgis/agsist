// Pointer pages (scripts/pointer_pages.py): a generated page that dropped out
// of its set stays as a small noindex page that sends readers to its parent.
// Every pointer in data/pointers is checked against its file, the sitemaps,
// llms.txt and the search index; the Python selftests cover the generators.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const MDIR = path.join(ROOT, "data/pointers");
const manifest = {};
for (const f of fs.readdirSync(MDIR).filter((f) => f.endsWith(".json"))) {
  Object.assign(manifest, JSON.parse(fs.readFileSync(path.join(MDIR, f), "utf8")).pointers);
}
const urlOf = (rel) => "/" + rel.replace(/\/index\.html$/, "/").replace(/\.html$/, "");
const fileOf = (url) => {
  const p = url.replace(/^\//, "");
  return p === "" || p.endsWith("/") ? [p + "index.html"] : [p + ".html", p + "/index.html"];
};

test("python selftest: pointer helper", () => {
  const out = execFileSync("python3", ["scripts/pointer_pages.py", "--selftest"], { cwd: ROOT, encoding: "utf8" });
  assert.match(out, /selftest ok/);
});

test("the backfill is there: dropped cash-bids, rain and ARC/PLC pages and /elevator-websites", () => {
  const n = (pre) => Object.keys(manifest).filter((k) => k.startsWith(pre)).length;
  assert.ok(n("cash-bids/") >= 42, `cash-bids pointers ${n("cash-bids/")}`);
  assert.ok(n("rain/") >= 39, `rain pointers ${n("rain/")}`);
  assert.ok(n("arc-plc/connecticut") >= 9, `arc-plc pointers ${n("arc-plc/connecticut")}`);
  assert.equal(manifest["elevator-websites.html"]?.to, "/cash-bids");
  assert.equal(manifest["arc-plc/connecticut/fairfield-county.html"]?.to, "/arc-plc", "no Connecticut page left: the hub");
  assert.equal(manifest["rain/texas/crane-county.html"]?.to, "/rain/texas");
});

test("every pointer: small, noindex, canonical and instant refresh to a real parent, a visible line", () => {
  for (const [rel, e] of Object.entries(manifest)) {
    const p = path.join(ROOT, rel);
    assert.ok(fs.existsSync(p), `${rel} missing`);
    const t = fs.readFileSync(p, "utf8");
    assert.ok(Buffer.byteLength(t) <= 1536, `${rel} is ${Buffer.byteLength(t)} bytes`);
    assert.ok(t.includes('<meta name="robots" content="noindex, follow">'), `${rel} noindex`);
    assert.ok(t.includes(`<meta name="agsist-pointer" content="${e.to}">`), `${rel} marker`);
    assert.ok(t.includes(`<link rel="canonical" href="https://agsist.com${e.to}">`), `${rel} canonical`);
    assert.ok(t.includes(`<meta http-equiv="refresh" content="0; url=${e.to}">`), `${rel} refresh`);
    assert.match(t, /<p>This page moved\. [^<]+ <a href="[^"]+">[^<]+ page<\/a>\.<\/p>/, `${rel} visible line`);
    assert.ok(!t.includes("—"), `${rel} em dash`);
    assert.match(e.since, /^2026-\d\d-\d\d$/, `${rel} date`);
    const tgt = fileOf(e.to).find((f) => fs.existsSync(path.join(ROOT, f)));
    assert.ok(tgt, `${rel}: target ${e.to} has no page`);
    const tt = fs.readFileSync(path.join(ROOT, tgt), "utf8");
    assert.ok(!tt.includes('name="agsist-pointer"') && !/http-equiv="refresh"/i.test(tt.slice(0, 4096)), `${rel}: target ${e.to} is a redirect`);
  }
});

test("no pointer in any sitemap, llms.txt or the search index", () => {
  const urls = new Set(Object.keys(manifest).map((r) => "https://agsist.com" + urlOf(r)));
  const paths = new Set(Object.keys(manifest).map(urlOf));
  for (const f of fs.readdirSync(ROOT).filter((f) => /^sitemap.*\.xml$/.test(f))) {
    const locs = [...fs.readFileSync(path.join(ROOT, f), "utf8").matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
    const hit = locs.filter((u) => urls.has(u));
    assert.deepEqual(hit, [], `${f} lists pointers`);
  }
  const llms = fs.readFileSync(path.join(ROOT, "llms.txt"), "utf8");
  for (const u of urls) assert.ok(!llms.includes(u + ")") && !llms.includes(u + " "), `llms.txt lists ${u}`);
  for (const f of ["data/search-index.json", "data/search-places.json", "data/search-elevators.json"]) {
    const txt = fs.readFileSync(path.join(ROOT, f), "utf8");
    const hit = (txt.match(/"\/[^"]*"/g) || []).map((s) => s.slice(1, -1)).filter((u) => paths.has(u));
    assert.deepEqual(hit, [], `${f} lists pointers`);
  }
});
