/* The Rain Print QR with the subs worker down (Oct 22, 2026): /r opens a
 * sealed copy from data/rp-sealed/ (scripts/build_rp_sealed.mjs).
 *
 *  - the derivation is pinned (salt, iterations, sizes, a known answer), and
 *    r.html / R.html use the very same constants;
 *  - worker blocked (403 page), down, slow, or an HTML 200: the print still
 *    opens, from the sealed file;
 *  - an id with no file: the honest "isn't one the site knows";
 *  - a file that does not open: "connection dropped", never a wrong design;
 *  - the folder never holds an id, a design code or an index, and every file
 *    is the same size; the repo's own folder is checked the same way;
 *  - pruning, no churn, and a broken copy that cannot wipe the folder;
 *  - the workflow step: an existing daily job, no new schedule.
 *
 * Every design code here is made up. node --test test/rp-sealed.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, rmSync, existsSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import * as S from "../scripts/build_rp_sealed.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");
const FILE_BYTES = 1 + 12 + S.PAD + 16;

const ctx = { TextEncoder, TextDecoder, URLSearchParams, btoa, atob };
ctx.window = ctx;
vm.runInNewContext(read("components/rain-print.js"), ctx);
const RP = ctx.RainPrint;
const CODES = {
  K7Q2M: RP.encodeCode({ place: "Testville, WI", station: "USC00470000", year: 2025, palette: "paper", name: "The Made-Up Farm" }),
  ZX9PQ: RP.encodeCode({ place: "Nowhere, IA", station: "USC00130000", year: 2024, palette: "paper", name: "Pat and Lee Example",
    markers: [{ date: "2024-06-01", label: "Planted the last field" }] }),
  "4HJ8T0": RP.encodeCode({ place: "Sample, MN", station: "USC00210000", year: 2023, palette: "paper", name: "X" }),
};
const kvDoc = (recs, extra = []) => gzipSync(JSON.stringify({ taken: "2026-10-22T00:00:00Z", count: 0,
  keys: Object.entries(recs).map(([id, v]) => ({ name: "rps:" + id, value: v })).concat(extra) }));
const tmp = () => mkdtempSync(path.join(os.tmpdir(), "rps-"));

test("the derivation is pinned, and r.html and R.html use the same constants", async () => {
  assert.equal(S.SALT, "agsist.com/r sealed v1");
  assert.equal(S.ITERATIONS, 600000);
  assert.ok(S.ITERATIONS >= 200000, "at least 200k iterations");
  assert.equal(S.NAME_BYTES, 16);
  assert.equal(S.PAD, 400);
  // Known answer, also checked by hand with Python's hashlib.pbkdf2_hmac + RFC 5869 HKDF
  assert.equal((await S.derive("K7Q2M")).name, "a2f77e42f14846fbb98d0ac139e1d900");
  const R = read("R.html");
  assert.equal(read("r.html"), R, "r.html and R.html are the same bytes");
  assert.match(R, /var SALT = 'agsist\.com\/r sealed v1', ITERATIONS = 600000, NAME_BYTES = 16,/);
  assert.match(R, /info: E\.encode\('name'\)/);
  assert.match(R, /info: E\.encode\('key'\)/);
  assert.match(R, /fetch\('\/data\/rp-sealed\/' \+ name \+ '\.bin'\)/);
  assert.match(R, /var wt = setTimeout\(sealedOnce, 3000\);/, "the worker gets 3 s");
  const src = read("scripts/build_rp_sealed.mjs");
  assert.match(src, /THREAT MODEL/);
  assert.match(src, /32\^5 = 33\.5 million/);
});

test("seal and open round-trip; a wrong id or a moved file does not open", async () => {
  const d = await S.derive("K7Q2M"), e = await S.derive("K7Q2N");
  const f = await S.seal(CODES.K7Q2M, d);
  assert.equal(f.length, FILE_BYTES);
  assert.equal(await S.open(f, d), CODES.K7Q2M);
  assert.equal(await S.open(f, e), null, "another id's key");
  assert.equal(await S.open(f, { name: e.name, key: d.key }), null, "the name is bound in (a file copied to another name)");
  const bad = Uint8Array.from(f); bad[40] ^= 1;
  assert.equal(await S.open(bad, d), null, "a changed byte");
});

test("the folder holds no id, no design code and no index; every file is the same size", async () => {
  const dir = tmp();
  try {
    const r = await S.build(S.records(kvDoc(CODES, [{ name: "sub:someone", value: "{}" }, { name: "rps:BAD!", value: "x" }])), dir);
    assert.deepEqual([r.records, r.written, r.kept, r.pruned], [3, 3, 0, 0]);
    const files = readdirSync(dir);
    assert.equal(files.length, 3);
    for (const f of files) {
      assert.match(f, /^[0-9a-f]{32}\.bin$/);
      const b = readFileSync(path.join(dir, f));
      assert.equal(b.length, FILE_BYTES, "same size whatever the code's length");
      const text = b.toString("latin1");
      for (const [id, code] of Object.entries(CODES)) {
        assert.ok(!f.toUpperCase().includes(id), "no id in a file name");
        assert.ok(!text.includes(id) && !text.includes(code) && !text.includes(code.slice(0, 16)), "no id or code inside");
        assert.ok(!text.includes("Testville") && !text.includes("Example"));
      }
      assert.doesNotMatch(text, /[A-Za-z0-9_-]{20,}/, "no run that looks like a design code");
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the repo's own data/rp-sealed holds only sealed files", () => {
  const dir = ROOT + "data/rp-sealed";
  if (!existsSync(dir)) return;            // written by sponsor-report.yml after the first run
  for (const f of readdirSync(dir)) {
    assert.match(f, /^[0-9a-f]{32}\.bin$/, "only sealed files, no index: " + f);
    assert.equal(statSync(path.join(dir, f)).size, FILE_BYTES, f);
    assert.doesNotMatch(readFileSync(path.join(dir, f)).toString("latin1"), /[A-Za-z0-9_-]{20,}/, f);
  }
});

test("rebuilds: unchanged files stay byte for byte, gone ids are pruned, a broken copy wipes nothing", async () => {
  const dir = tmp();
  try {
    await S.build(S.records(kvDoc(CODES)), dir);
    const snap = Object.fromEntries(readdirSync(dir).map((f) => [f, readFileSync(path.join(dir, f)).toString("hex")]));
    let r = await S.build(S.records(kvDoc(CODES)), dir);
    assert.deepEqual([r.kept, r.written, r.pruned], [3, 0, 0]);
    for (const f of readdirSync(dir)) assert.equal(readFileSync(path.join(dir, f)).toString("hex"), snap[f], "no daily churn");
    const two = { K7Q2M: CODES.K7Q2M, ZX9PQ: CODES.ZX9PQ };
    r = await S.build(S.records(kvDoc(two)), dir);
    assert.equal(r.pruned, 1);
    assert.ok(!existsSync(path.join(dir, (await S.derive("4HJ8T0")).name + ".bin")), "the removed id's file is gone");
    r = await S.build(S.records(kvDoc({})), dir);
    assert.ok(r.skipped, "an empty copy changes nothing");
    assert.equal(readdirSync(dir).length, 2);
    r = await S.build(S.records(kvDoc({ "9ABCD": CODES.ZX9PQ })), dir);
    assert.equal(r.prune_refused, true, "more than half gone at once: nothing removed");
    assert.equal(readdirSync(dir).length, 3);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------- the /r page's own script, with real WebCrypto ----------
async function runR(search, worker, dir, waitMs = 1500) {
  const js = /<script>([\s\S]*?)<\/script>/.exec(read("r.html"))[1];
  const els = { msg: { textContent: "" }, sub: { textContent: "" }, box: { className: "" }, again: { hidden: true } };
  const out = { replaced: null, asked: [], els };
  const c = {
    location: { search, replace(u) { out.replaced = u; } },
    document: { getElementById: (k) => els[k] },
    setTimeout, clearTimeout, crypto: globalThis.crypto, TextEncoder, TextDecoder, Uint8Array, Promise,
  };
  c.window = c;
  c.fetch = async (u) => {
    out.asked.push(u);
    if (u.startsWith("/data/rp-sealed/")) {
      const f = path.join(dir, u.slice("/data/rp-sealed/".length));
      if (!/^[0-9a-f]{32}\.bin$/.test(path.basename(f)) || !existsSync(f)) return { ok: false, status: 404 };
      const b = readFileSync(f);
      return { ok: true, status: 200, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.length) };
    }
    return worker(u);
  };
  vm.runInNewContext(js, c);
  const t0 = Date.now();
  while (Date.now() - t0 < waitMs && out.replaced === null && els.box.className !== "now") await new Promise((r) => setTimeout(r, 25));
  return out;
}
const htmlPage = async () => ({ ok: false, status: 403, json: async () => { throw new SyntaxError("Unexpected token <"); } });
const WORKERS = {
  "blocked (Cloudflare's 403 page)": htmlPage,
  "down (no answer at all)": async () => { throw new TypeError("Failed to fetch"); },
  "an HTML page with a 200": async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("Unexpected token <"); } }),
  "a 503": async () => ({ ok: false, status: 503, json: async () => ({}) }),
  "an HTML 404 (not the worker's own)": async () => ({ ok: false, status: 404, json: async () => { throw new SyntaxError("<"); } }),
};

test("/r: worker blocked, down or answering HTML: the print still draws, from the sealed file", async () => {
  const dir = tmp();
  try {
    await S.build(S.records(kvDoc(CODES)), dir);
    for (const [why, w] of Object.entries(WORKERS)) {
      const o = await runR("?K7Q2M", w, dir);
      assert.equal(o.replaced, "/rain-print?d=" + CODES.K7Q2M, why);
      assert.equal(o.els.box.className, "", "no message " + why);
      assert.equal(o.asked[0], "https://agsist-subs.dnilgis.workers.dev/rp-short/K7Q2M", "worker first " + why);
    }
    const o = await runR("?id=4hj8to&fbclid=x", WORKERS["down (no answer at all)"], dir);
    assert.equal(o.replaced, "/rain-print?d=" + CODES["4HJ8T0"], "a 6-letter id, lower case and look-alikes");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("/r: a worker that hangs gets 3 s, then the sealed file opens", async () => {
  const dir = tmp();
  try {
    await S.build(S.records(kvDoc(CODES)), dir);
    const t0 = Date.now();
    const o = await runR("?ZX9PQ", () => new Promise(() => {}), dir, 8000);
    assert.equal(o.replaced, "/rain-print?d=" + CODES.ZX9PQ);
    assert.ok(Date.now() - t0 >= 2900, "waited for the worker first");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("/r: with the worker up, nothing changes; its own 'not found' is believed", async () => {
  const dir = tmp();
  try {
    const up = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, code: CODES.K7Q2M }) });
    let o = await runR("?K7Q2M", up, dir);
    assert.equal(o.replaced, "/rain-print?d=" + CODES.K7Q2M);
    assert.equal(o.asked.length, 1, "no sealed file fetched");
    o = await runR("?K7Q2M", async () => ({ ok: false, status: 404, json: async () => ({ ok: false, error: "not found" }) }), dir);
    assert.equal(o.replaced, null);
    assert.match(o.els.sub.textContent, /isn’t one the site knows/);
    assert.equal(o.asked.length, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("/r: a wrong id with the worker down says honestly it is not known; a bad file never opens a design", async () => {
  const dir = tmp();
  try {
    await S.build(S.records(kvDoc(CODES)), dir);
    let o = await runR("?K7Q2N", htmlPage, dir);
    assert.equal(o.replaced, null);
    assert.equal(o.els.box.className, "now");
    assert.match(o.els.sub.textContent, /isn’t one the site knows/);
    assert.equal(o.els.again.hidden, true, "no Try again for an unknown link");
    const f = path.join(dir, (await S.derive("K7Q2M")).name + ".bin");
    const b = readFileSync(f); b[50] ^= 1; writeFileSync(f, b);
    o = await runR("?K7Q2M", htmlPage, dir);
    assert.equal(o.replaced, null);
    assert.match(o.els.sub.textContent, /connection dropped/);
    assert.equal(o.els.again.hidden, false, "Try again offered");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the copy is written by an existing daily job (sponsor-report.yml), no new schedule, never stopping it", () => {
  const y = read(".github/workflows/sponsor-report.yml");
  const crons = [...y.matchAll(/-\s*cron:\s*'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(crons, ["12 11 * * *"], "the schedule it already had");
  const step = y.slice(y.indexOf("- name: Rain Print QR backup"), y.indexOf("- name: Commit"));
  assert.match(step, /continue-on-error: true/);
  assert.match(step, /PRIVATE_REPO_TOKEN: \$\{\{ secrets\.PRIVATE_REPO_TOKEN \}\}/);
  assert.match(step, /node scripts\/build_rp_sealed\.mjs "\$RUNNER_TEMP\/kv\.json\.gz"/);
  assert.match(step, /rm -f "\$RUNNER_TEMP\/kv\.json\.gz"/, "the storage copy is not left on the runner");
  assert.match(y, /git add -A data\/rp-sealed/);
  assert.doesNotMatch(read("scripts/build_rp_sealed.mjs"), /console\.log\([^)]*\b(id|code)\b[^)]*\)/, "counts only in the log");
});
