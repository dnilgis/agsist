// PRIVATE SPONSOR LINKS (Sig, Nov 4, 2026: "move the codes to feedbag").
// Until then data/sponsors.json listed every sponsor's link token and each report was a public file,
// data/sponsors/<slug>-<token>.json, so the repo and agsist.com handed out every sponsor's numbers.
// Now the tokens live in the private repo only, the reports are served by the subs worker
// (GET /sponsor-report?r=<slug>-<token>, v5.65) and every old token was replaced.
// - the public tree: no token in data/sponsors.json, no data/sponsors/ folder, and no sponsor link
//   with a real-looking token in any tracked file (made-up test tokens only);
// - the worker route on an in-memory KV: right token, retired token, wrong token, Bearer-only writes;
// - end to end: scripts/sponsor_publish.py publish posts a report through a local server in front of
//   the worker, and the portal's own request reads it back.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, copyFileSync, unlinkSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const CONF = JSON.parse(read("data/sponsors.json"));
const SLUGS = (CONF.sponsors || []).map((s) => s.slug).filter(Boolean);
// A made-up token: one character sixteen times, the plain run, or fifteen zeros and a digit
// (the same rule as FAKE_RE in scripts/sponsor_publish.py).
const FAKE = /^(?:(.)\1{15,}|0123456789abcdef|0{15,}\d)$/;

test("the public registry carries no token, and no report folder is published", () => {
  assert.ok(SLUGS.length >= 1);
  for (const s of CONF.sponsors) assert.equal(s.token, undefined, s.slug + ": a link token in data/sponsors.json");
  assert.ok(!existsSync(join(ROOT, "data/sponsors")), "data/sponsors/ is back");
  const tracked = execFileSync("git", ["-C", ROOT, "ls-files", "data/sponsors/"], { encoding: "utf8" }).trim();
  assert.equal(tracked, "", "files tracked under data/sponsors/");
  assert.match(read(".gitignore"), /^\/private\/$/m, "private/ (where the job unpacks the tokens) is never committed");
});

test("no tracked file holds a sponsor link with a real-looking token", () => {
  // any run of 16 or more hex characters right after a sponsor's slug (with or without a separator), any
  // portal link, and any old report file name
  const pats = [...SLUGS.map((s) => "\\b" + s + "[-_/=:.]?[0-9a-f]{16,}"), "sponsor-report(\\.html)?\\?r=[a-z0-9-]+-[0-9a-f]{16,}", "data/sponsors/[a-z0-9-]+-[0-9a-f]{16,}"];
  let out = "";
  try {
    out = execFileSync("git", ["-C", ROOT, "grep", "-I", "-n", "-o", "-E", ...pats.flatMap((p) => ["-e", p])], { encoding: "utf8", maxBuffer: 64 << 20 });
  } catch (e) { if (e.status !== 1) throw e; }
  const bad = [];
  for (const line of out.split("\n").filter(Boolean)) {
    const m = /([0-9a-f]{16,})$/.exec(line);
    if (m && !FAKE.test(m[1])) bad.push(line.split(":").slice(0, 2).join(":"));   // file and line only, never the token
  }
  assert.deepEqual(bad, [], "a sponsor link token in a public file (rotate every token: scripts/sponsor_publish.py rotate --all)");
});

test("the portal asks the worker, never a file on the site, and keeps its address out of analytics", () => {
  const page = read("sponsor-report.html");
  assert.doesNotMatch(page, /fetch\('\/data\/sponsors\//);
  assert.match(page, /fetch\(API \+ '\/sponsor-report\?r=' \+ encodeURIComponent/);
  assert.match(page, /x\.status === 410/, "a retired link says it has changed");
  assert.match(page, /This link has changed\. Ask AGSIST for your new link\./);
  assert.match(page, /<meta name="referrer" content="no-referrer">/);
  assert.match(page, /window\.gtag = function \(\) \{\};/, "loader.js loads no analytics on this page (the address holds the link)");
  assert.ok(page.indexOf("window.gtag = function") < page.indexOf("/components/loader.js"), "before loader.js");
  const desk = read("desk.html");
  assert.doesNotMatch(desk, /\/data\/sponsors\//);
  assert.match(desk, /worker\('sponsor-report\/list'\)/);
});

test("the sponsor report job keeps tokens and reports private and commits neither", () => {
  const yml = read(".github/workflows/sponsor-report.yml");
  assert.doesNotMatch(yml, /git add [^\n]*data\/sponsors\b(?!\.json)/, "the job commits no report files");
  assert.match(yml, /pull_raw\.sh private\/sponsors/);
  assert.match(yml, /sponsor_publish\.py mint\n(?:\s*#[^\n]*\n)*\s*RAW_KEEP=1 bash scripts\/push_raw\.sh "sponsor tokens" private\/sponsors\/tokens\n\s*bash scripts\/pull_raw\.sh private\/sponsors\/tokens/,
    "a new token is saved before it is used, never over one already saved (the first token wins), then read back");
  assert.match(yml, /sponsor_publish\.py publish/);
  assert.match(yml, /sponsor_publish\.py --selftest/);
  assert.match(read("scripts/build_sponsor_report.py"), /OUTDIR = Path\(os\.environ\.get\("SPONSOR_PRIVATE_DIR"\) or \(ROOT \/ "private" \/ "sponsors"\)\) \/ "reports"/);
  assert.doesNotMatch(read("scripts/build_sponsor_report.py"), /s\["token"\]|\.get\("token"\)/, "the builder needs no token");
  assert.doesNotMatch(read("scripts/sponsor_apply.py"), /"token": secrets\.token_hex/, "a new sponsor's token is not written to the public registry");
});

// ── the worker route, on an in-memory KV ──
async function loadWorker() {
  const tmp = join(tmpdir(), "subs-worker-spr-" + process.pid + "-" + Math.random().toString(36).slice(2) + ".mjs");
  copyFileSync(join(ROOT, "workers/subs-worker.js"), tmp);
  const w = (await import(pathToFileURL(tmp).href)).default;
  unlinkSync(tmp);
  return w;
}
function kv() {
  const store = new Map();
  return { store, async get(k) { return store.has(k) ? store.get(k) : null; }, async put(k, v) { store.set(k, v); }, async delete(k) { store.delete(k); },
    async list({ prefix = "", limit = 1000, cursor } = {}) {
      const all = [...store.keys()].filter((k) => k.startsWith(prefix)).sort(), at = cursor ? Number(cursor) : 0, end = Math.min(all.length, at + limit);
      return { keys: all.slice(at, end).map((name) => ({ name })), list_complete: end >= all.length, cursor: end >= all.length ? undefined : String(end) };
    } };
}
// Made up at run time: a token typed into this file would sit in the public tree, and the publish
// step refuses to run while any token it holds is in a tracked file.
const LIVE = randomBytes(8).toString("hex"), OLD = randomBytes(8).toString("hex");

test("worker v5.65: a report is read with its own link only; old links say changed; writes are Bearer only", async () => {
  const w = await loadWorker(), env = { SUBS: kv(), LIST_TOKEN: "tok", UNSUB_SECRET: "sec" };
  const call = (path, { method = "GET", body, auth } = {}) => w.fetch(new Request("https://w.test" + path, { method,
    headers: Object.assign({ Origin: "https://agsist.com" }, body ? { "Content-Type": "application/json" } : {}, auth ? { Authorization: auth } : {}),
    body: body ? JSON.stringify(body) : undefined }), env);
  const report = { schema: "agsist-sponsor-report/1", slug: "barnco", through: "2026-11-03", totals: { viewable: 71, clicks: 0 } };
  const put = { slug: "barnco", token: LIVE, retired: [OLD], report };
  assert.equal((await call("/sponsor-report/put", { method: "POST", body: put })).status, 403, "no Bearer");
  assert.equal((await call("/sponsor-report/put", { method: "POST", body: put, auth: "Bearer nope" })).status, 403, "wrong Bearer");
  assert.equal((await call("/sponsor-report/put?token=tok", { method: "POST", body: put, auth: "Bearer tok" })).status, 403, "?token= refused");
  assert.equal(env.SUBS.store.size, 0, "nothing written by a refused call");
  for (const [b, why] of [[{ ...put, token: "short" }, "short token"], [{ ...put, slug: "Bad Slug" }, "bad slug"], [{ ...put, retired: [LIVE] }, "live token retired"], [{ ...put, report: [] }, "report not an object"]]) {
    const r = await call("/sponsor-report/put", { method: "POST", body: b, auth: "Bearer tok" });
    assert.equal(r.status, 400, why);
  }
  const ok = await call("/sponsor-report/put", { method: "POST", body: put, auth: "Bearer tok" });
  assert.equal(ok.status, 200);
  const rec = JSON.parse(env.SUBS.store.get("spr:barnco"));
  assert.ok(!JSON.stringify(rec.old).includes(OLD), "a retired token is kept only as a hash");

  const got = await call("/sponsor-report?r=barnco-" + LIVE);
  assert.equal(got.status, 200);
  assert.equal(got.headers.get("Cache-Control"), "no-store");
  assert.equal(got.headers.get("Access-Control-Allow-Origin"), "https://agsist.com");
  const j = await got.json();
  assert.deepEqual(j, { ok: true, report });
  assert.ok(!JSON.stringify(j).includes(LIVE), "the answer does not repeat the token");

  const old = await call("/sponsor-report?r=barnco-" + OLD);
  assert.equal(old.status, 410, "a retired link answers 410");
  assert.deepEqual(await old.json(), { ok: false, changed: true }, "and never names the new one");
  for (const r of ["barnco-" + LIVE.slice(0, 15) + (LIVE.slice(-1) === "0" ? "1" : "0"), "barnco-" + LIVE + "0", "nobody-" + LIVE, "barnco", "", "barnco-" + LIVE.toUpperCase().replace(/[0-9]/g, "Z")]) {
    const x = await call("/sponsor-report?r=" + encodeURIComponent(r));
    assert.equal(x.status, 404, "unknown: " + r.replace(LIVE, "<live>"));
    assert.deepEqual(await x.json(), { ok: false }, "a bare 404");
    assert.equal(x.headers.get("Cache-Control"), "no-store");
  }

  const list = await call("/sponsor-report/list", { auth: "Bearer tok" });
  const L = await list.json();
  assert.equal(L.reports.length, 1);
  assert.equal(L.reports[0].r, "barnco-" + LIVE, "the desk gets the link to open");
  assert.equal((await call("/sponsor-report/list")).status, 403);
  assert.equal((await call("/sponsor-report/drop", { method: "POST", body: { slug: "barnco" }, auth: "Bearer tok" })).status, 200);
  assert.equal((await call("/sponsor-report?r=barnco-" + LIVE)).status, 404, "dropped");
});

test("worker v5.65: the token is compared in constant time, and the version note says so", () => {
  const src = read("workers/subs-worker.js");
  const fn = src.slice(src.indexOf("async function sprGet("), src.indexOf("async function sprPut("));
  assert.match(fn, /safeEq\(p\.token, rec\.t\)/);
  assert.match(fn, /old = safeEq\(h, x\) \|\| old;/, "every retired hash checked, no early exit");
  assert.doesNotMatch(fn, /p\.token\s*[!=]==|[!=]==\s*p\.token/, "never a plain comparison of the token");
  assert.match(src, /^ \* v5\.65 \([0-9-]+\): PRIVATE SPONSOR REPORTS/m);
});

test("end to end: sponsor_publish.py posts through the worker route and the portal's request reads it back", { timeout: 60000 }, async () => {
  const w = await loadWorker(), env = { SUBS: kv(), LIST_TOKEN: "tok-e2e", UNSUB_SECRET: "sec" };
  const srv = createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const r = await w.fetch(new Request("https://w.test" + req.url, { method: req.method, headers: req.headers, body: req.method === "GET" ? undefined : body }), env);
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer()));
  });
  await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
  const dir = mkdtempSync(join(tmpdir(), "spr-e2e-"));
  try {
    const slug = SLUGS[0];
    mkdirSync(join(dir, "tokens"), { recursive: true }); mkdirSync(join(dir, "reports"));
    writeFileSync(join(dir, "tokens", slug + ".json"), JSON.stringify({ slug, token: LIVE, retired: [OLD] }));
    const report = JSON.parse(read("test/fixtures/sponsoraudit/rootlot-2026-11-04.json"));
    writeFileSync(join(dir, "reports", slug + ".json"), JSON.stringify(report));
    const out = await new Promise((ok, no) => {
      const p = spawn("python3", ["scripts/sponsor_publish.py", "publish"], { cwd: ROOT,
        env: Object.assign({}, process.env, { GITHUB_ACTIONS: "true", SPONSOR_PRIVATE_DIR: dir, LIST_URL: "http://127.0.0.1:" + srv.address().port, LIST_TOKEN: "tok-e2e", UNSUB_SECRET: "sec" }) });
      let o = ""; p.stdout.on("data", (d) => { o += d; }); p.stderr.on("data", (d) => { o += d; });
      p.on("close", (code) => code === 0 ? ok(o) : no(new Error("exit " + code + ": " + o.split(LIVE).join("<live>").split(OLD).join("<old>"))));
    });
    assert.match(out, new RegExp("sent 1 report\\(s\\): " + slug));
    // Run as in Actions (GITHUB_ACTIONS=true, here and in CI alike): the first lines are ::add-mask:: for
    // both tokens, which the runner consumes and blanks from the log; no other line may name a token.
    const lines = out.split("\n"), masks = lines.filter((l) => l.startsWith("::add-mask::"));
    assert.deepEqual(masks.map((l) => l.slice(12)).sort(), [LIVE, OLD].sort(), "both tokens masked, once each");
    assert.deepEqual(lines.slice(0, masks.length), masks, "the masks come before any other line");
    const rest = lines.slice(masks.length).join("\n");
    assert.ok(!rest.includes(LIVE) && !rest.includes(OLD), "the log names no token outside its masks");
    const links = JSON.parse(readFileSync(join(dir, "links.json"), "utf8"));
    assert.equal(links.signed, true);
    assert.match(links.links[slug], new RegExp("^https://agsist\\.com/sponsor-report\\?r=" + slug + "-" + LIVE + "&k=[0-9a-f]{16}$"));
    // the portal's own request (sponsor-report.html: API + '/sponsor-report?r=' + r)
    const base = "http://127.0.0.1:" + srv.address().port;
    const j = await (await fetch(base + "/sponsor-report?r=" + slug + "-" + LIVE, { headers: { Origin: "https://agsist.com" } })).json();
    assert.equal(j.ok, true);
    assert.deepEqual(j.report, report, "the same report, byte for byte as JSON");
    assert.equal((await fetch(base + "/sponsor-report?r=" + slug + "-" + OLD)).status, 410);
  } finally { srv.close(); rmSync(dir, { recursive: true, force: true }); }
});
