/* Nearby buyers (Oct 29, 2026): ethanol plants, oilseed crushers, export
 * elevators, rail shuttle loaders and river terminals, placed at their town
 * point by scripts/build_buyers.py into data/buyers.json. Cash bid town pages
 * and Atlas county homes print one closed line ("Nearby buyers within 50
 * miles: 2 ethanol plants, 1 oilseed crusher"); components/cb-buyers.js draws
 * the list from the data file when it is opened.
 *
 *   node --test test/buyers.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import os from "node:os";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const py = (code) => execFileSync("python3", ["-c", "import sys,json;sys.path.insert(0,'scripts');" + code],
  { cwd: ROOT, encoding: "utf8" });
const DATA = JSON.parse(read("data/buyers.json"));
// the list each row came from: 01/02 rail, 03 ethanol (RFA), 04 crush (NOPA), 05 river (USACE), 06 export
const FILE_KIND = { "01": "rail", "02": "rail", "03": "ethanol", "04": "crush", "05": "river", "06": "export" };

test("builder selftest: trace rows, no invented capacity, fixture counts, no line when none", () => {
  assert.match(execFileSync("python3", ["scripts/build_buyers.py", "--selftest"], { cwd: ROOT, encoding: "utf8" }),
    /build_buyers selftest: ok/);
});

test("every placed buyer traces to a source row of its own kind and has a town point", () => {
  const P = Object.entries(DATA.plants);
  assert.ok(P.length >= 300, `only ${P.length} buyers placed`);
  for (const [id, p] of P) {
    assert.match(id, /^[0-9a-f]{5}$/);
    assert.ok(DATA.kinds[p.k], `${id}: kind ${p.k}`);
    assert.ok(DATA.sources[p.src], `${id}: source ${p.src}`);
    assert.ok(Array.isArray(p.rows) && p.rows.length >= 1, `${id}: no source row`);
    for (const r of p.rows) {
      const m = /^(0[1-6]):(\d+)$/.exec(r);
      assert.ok(m, `${id}: row ${r}`);
      assert.equal(FILE_KIND[m[1]], p.k, `${id}: row ${r} is not a ${p.k} list`);
    }
    assert.ok(p.ll[0] > 18 && p.ll[0] < 72 && p.ll[1] > -170 && p.ll[1] < -64, `${id}: point ${p.ll}`);
    assert.ok(p.town && /^[A-Z]{2}$/.test(p.st), `${id}: town`);
  }
  for (const k of ["ethanol", "crush", "export", "rail", "river"]) {
    assert.ok(P.some(([, p]) => p.k === k), `no ${k} placed`);
  }
});

test("capacity is only ever what a list published", () => {
  for (const [id, p] of Object.entries(DATA.plants)) {
    if (p.k === "ethanol") {
      assert.match(p.cap, /^\d[\d,.]* million gal a year$/, `${id}: RFA publishes every plant's capacity`);
      if (p.eia) assert.match(p.eia, /^\d[\d.]* million gal a year$/, id);
    } else if (p.k === "export") {
      if (p.cap) assert.match(p.cap, /(bushels grain storage|metric tons of grain a year)/, `${id}: ${p.cap}`);
    } else {
      assert.equal(p.cap, undefined, `${id}: the ${p.k} list publishes no capacity`);
    }
  }
});

test("real data: Nevada, IA has its two ethanol plants in town; a point far from any buyer gets no line", () => {
  const out = JSON.parse(py(
    "import build_buyers as B;P=B.load('.');" +
    "h=B.near(42.0227,-93.4522,P);" +
    "print(json.dumps({'near':[[d,p['n'],p['k']] for d,p in h if d==0],'line':B.line_html(h,'x')[:200]," +
    "'none':B.line_html(B.near(39.25,-114.89,P),'x')}))"));
  const names = out.near.map((x) => x[1]).sort();
  assert.deepEqual(names, ["Lincolnway Energy LLC", "VERBIO Nevada Biorefinery"]);
  assert.match(out.line, /Nearby buyers within 50 miles: \d+ ethanol plants/);
  assert.equal(out.none, "");
});

test("the town page and Atlas builders print the line through build_buyers, the script once", () => {
  const cb = read("scripts/build_cash_bid_pages.py");
  assert.match(cb, /import build_buyers as BUY/);
  assert.match(cb, /_selftest_buyers\(\)/);
  const at = read("scripts/build_atlas_pages.py");
  assert.match(at, /BUY\.line_html\(BUY\.near\(ctr\[0\], ctr\[1\], BUY\.load\(W\.root\)\)/);
  const tmp = mkdtempSync(join(os.tmpdir(), "buyers-atlas-"));
  try {
    execFileSync("python3", ["scripts/build_atlas_pages.py", "--only", "19169", "32023", "--out", tmp],
      { cwd: ROOT, env: { ...process.env, PYTHONHASHSEED: "0" }, stdio: "pipe" });
    const story = readFileSync(join(tmp, "farmland-atlas/iowa/story-county.html"), "utf8");
    assert.match(story, /<details class="buyers" data-buyers="[0-9a-f]{5}:\d+(,[0-9a-f]{5}:\d+)*"><summary>Nearby buyers within 50 miles: /);
    assert.equal(story.split("/components/cb-buyers.js?v=1").length - 1, 1);
    assert.match(story, /Straight-line miles from the middle of Story County/);
    assert.match(story, />Renewable Fuels Association<\/a>/);
    for (const m of story.match(/data-buyers="([^"]+)"/)[1].split(",")) {
      assert.ok(DATA.plants[m.split(":")[0]], `id ${m} is not in data/buyers.json`);
    }
    const nye = readFileSync(join(tmp, "farmland-atlas/nevada/nye-county.html"), "utf8");
    assert.ok(!nye.includes("data-buyers") && !nye.includes("cb-buyers.js"), "no buyer within 50 miles: no line");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

function run(fetchImpl) {
  const box = { innerHTML: "", textContent: "" };
  const attrs = { "data-buyers": "7ef53:0,zzzzz:3,bfc9d:47" };
  const el = {
    open: true, getAttribute: (k) => attrs[k] || null, setAttribute: (k, v) => { attrs[k] = v; },
    querySelector: (s) => (s === ".buyers-list" ? box : null), addEventListener() {},
  };
  const ctx = { document: { readyState: "complete", querySelectorAll: () => [el] }, fetch: fetchImpl, Promise, String };
  vm.runInNewContext(read("components/cb-buyers.js"), ctx);
  return new Promise((r) => setTimeout(() => r({ box, attrs }), 20));
}

test("cb-buyers.js lists each buyer by id with the page's miles, and says so when the file cannot be read", async () => {
  const data = { kinds: DATA.kinds, plants: {
    "7ef53": { k: "ethanol", n: "Lincolnway Energy LLC", town: "Nevada", st: "IA", cap: "90 million gal a year" },
    "bfc9d": { k: "crush", n: "Ag <Processing>", town: "Eagle Grove", st: "IA" } } };
  const ok = await run(() => Promise.resolve({ ok: true, json: () => Promise.resolve(data) }));
  assert.match(ok.box.innerHTML, /<b>Lincolnway Energy LLC<\/b>, Nevada, IA<br><span class="cbt-mut"[^>]*>ethanol plant &middot; under 1 mi &middot; 90 million gal a year/);
  assert.match(ok.box.innerHTML, /Ag &lt;Processing&gt;.*oilseed crusher &middot; 47 mi &middot; capacity not published/);
  assert.equal((ok.box.innerHTML.match(/<li[ >]/g) || []).length, 2, "an id not in the file is skipped");
  const bad = await run(() => Promise.reject(new Error("offline")));
  assert.match(bad.box.textContent, /could not be loaded right now/);
  assert.equal(bad.attrs["data-drawn"], undefined, "a failed load tries again on the next open");
});
