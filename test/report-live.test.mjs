/* Report day: the graded USDA result on the page and in the email within a minute of the release.
 *
 *   - the worker route (subs worker v5.67): a signed result in the fixed shape is kept and served;
 *     no signature, a wrong one, an old timestamp, markup, an unknown field, a live result for
 *     another month and an older copy of the same release are refused; the rehearsal's record is
 *     separate from the live one; no secret on the worker means 503, never an open door.
 *   - the worker and scripts/report_live.py validate() agree on the same cases.
 *   - the whole path on a fixture: last month's PDF appears after two misses, the job reads it,
 *     grades it, signs it, the worker (run here) keeps it, serves it, and the report-day email
 *     renders from it as a dry run. From "file appears" to "live value served": under 30 s.
 *   - the workflow: start ticks cover every report day on file, five minutes ahead; a watchdog at
 *     release + 3 and + 10; the rehearsal the day before; the push loop commits once; the email
 *     shares report-day.yml's queue; the poll step holds no write token.
 *   - the pages: /usda-calendar and the homepage card read the live result first and keep the
 *     committed files otherwise; no method text on the page.
 *
 *   node --test test/report-live.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { createServer } from "node:http";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const SECRET = "report-live-test-secret";

async function loadWorker() {
  const tmp = path.join(os.tmpdir(), "subs-worker-report-live-" + process.pid + "-" + Math.random().toString(36).slice(2) + ".mjs");
  fs.copyFileSync(path.join(ROOT, "workers/subs-worker.js"), tmp);
  const w = (await import(pathToFileURL(tmp).href)).default;
  fs.unlinkSync(tmp);
  const store = new Map();
  const SUBS = {
    async get(k, o) { const v = store.has(k) ? store.get(k) : null; const t = typeof o === "string" ? o : o && o.type; return v !== null && t === "json" ? JSON.parse(v) : v; },
    async put(k, v) { store.set(k, v); }, async delete(k) { store.delete(k); },
    async list({ prefix }) { return { keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }; },
  };
  return { w, store, env: { UNSUB_SECRET: SECRET, LIST_TOKEN: "tok", SUBS } };
}
const hmac = (k, m) => crypto.createHmac("sha256", k).update(m).digest("hex");
const KEY = hmac(SECRET, "report-live|v1");
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
function good(over = {}) {
  return Object.assign({ v: 1, test: false, release: today(), report: "December WASDE", generated: new Date().toISOString().slice(0, 19) + "Z",
    counts: { metrics: 1, in_line: 0, ungraded: 0 }, big: "corn_2627",
    rows: [{ key: "corn_2627", label: "2026/27 corn ending stocks", unit: "bil bu", actual: 2.1, expected: 1.9, low: 1.8, high: 2.0,
      usda_current: 1.95, surprise: "bearish", gap_pct: 10.5, context: "above the range" }],
    balance: [{ crop: "corn", my: "2026/27", prev_month: "Nov", stocks: 2100, stocks_prev: 1950, price: 4.1, price_prev: 4.2 }] }, over);
}
function post(w, env, body, { ts = Math.floor(Date.now() / 1000), key = KEY, sig } = {}) {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  return w.fetch(new Request("https://x.dev/report-live", { method: "POST", body: raw,
    headers: { "Content-Type": "application/json", "X-Report-Ts": String(ts), "X-Report-Sig": sig || hmac(key, ts + "." + raw) } }), env);
}
const getLive = async (w, env, q = "") => (await (await w.fetch(new Request("https://x.dev/report-live" + q, { headers: { Origin: "https://agsist.com" } }), env)).json()).live;

test("the worker keeps a signed result and serves it; the rehearsal's record is its own", async () => {
  const { w, env } = await loadWorker();
  assert.equal(await getLive(w, env), null, "nothing before the first result");
  const p = good();
  let r = await post(w, env, p);
  assert.equal(r.status, 200, await r.clone().text());
  const live = await getLive(w, env);
  assert.equal(live.release, p.release);
  assert.deepEqual(Object.fromEntries(Object.entries(live).filter(([k]) => k !== "received")), p, "served exactly as sent");
  const res = await w.fetch(new Request("https://x.dev/report-live", { headers: { Origin: "https://agsist.com" } }), env);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), "https://agsist.com");
  assert.match(res.headers.get("Cache-Control"), /max-age=10/);
  const t = good({ test: true, release: daysAgo(30), report: "October WASDE" });
  assert.equal((await post(w, env, t)).status, 200);
  assert.equal((await getLive(w, env, "?test=1")).release, daysAgo(30), "the rehearsal writes the test record");
  assert.equal((await getLive(w, env)).release, p.release, "and never the live one");
});

test("the worker refuses what is not a signed result in the fixed shape", async () => {
  const { w, env } = await loadWorker();
  const p = good();
  const raw = JSON.stringify(p);
  const now = Math.floor(Date.now() / 1000);
  assert.equal((await w.fetch(new Request("https://x.dev/report-live", { method: "POST", body: raw }), env)).status, 403, "no signature");
  assert.equal((await post(w, env, p, { key: "wrong" })).status, 403, "a wrong key");
  assert.equal((await post(w, env, p, { key: SECRET })).status, 403, "the root secret itself does not sign this route");
  assert.equal((await post(w, env, p, { ts: now - 900 })).status, 403, "an old timestamp");
  assert.equal((await post(w, env, p, { sig: hmac(KEY, now + "." + raw + " ") })).status, 403, "a signature over other bytes");
  const cases = [
    [Object.assign(good(), { extra: 1 }), "shape"],
    [good({ report: "<b>x</b>" }), "report"],
    [good({ rows: [Object.assign(good().rows[0], { label: "<img src=x onerror=1>" })] }), "row text"],
    [good({ rows: [Object.assign(good().rows[0], { actual: null })] }), "row number"],
    [good({ rows: [Object.assign(good().rows[0], { surprise: "huge" })] }), "row grade"],
    [good({ release: daysAgo(30) }), "release"],
    [good({ big: "wheat_2627" }), "big"],
    [good({ rows: [], balance: [] }), "rows"],
    [good({ balance: [{ crop: "cotton", my: "", prev_month: "", stocks: 1, stocks_prev: null, price: null, price_prev: null }] }), "balance"],
  ];
  for (const [b, why] of cases) {
    const r = await post(w, env, b);
    assert.equal(r.status, 400, why);
    assert.equal((await r.json()).error, why);
  }
  assert.equal((await post(w, env, "x".repeat(13000))).status, 413, "too big");
  assert.equal((await post(w, env, p)).status, 200);
  const older = good({ generated: "2000-01-01T00:00:00Z" });
  assert.equal((await post(w, env, older)).status, 409, "an older copy of the same release never replaces a newer one");
  assert.equal((await w.fetch(new Request("https://x.dev/report-live", { method: "PUT" }), env)).status, 405);
  delete env.UNSUB_SECRET;
  assert.equal((await post(w, env, p)).status, 503, "no secret on the worker: nothing is kept");
  assert.ok(read("workers/subs-worker.js").includes(" * v5.67 (2026-11-10): REPORT-DAY RESULT."), "the worker header names the change");
});

test("the worker and report_live.validate() agree", async () => {
  const { w, env } = await loadWorker();
  const cases = [good(), good({ report: "x" }), good({ counts: { metrics: 1, in_line: 0 } }), good({ generated: "today" }),
    good({ rows: [Object.assign(good().rows[0], { key: "Corn Stocks" })] }), good({ rows: [Object.assign(good().rows[0], { gap_pct: "1" })] }),
    good({ test: true, release: daysAgo(30) }), good({ test: "yes" }), good({ balance: [] }), good({ rows: [], big: null })];
  const py = JSON.parse(execFileSync("python3", ["-c", `
import json, sys
sys.path.insert(0, "scripts")
import report_live as r
print(json.dumps([r.validate(c) for c in json.load(sys.stdin)]))`], { cwd: ROOT, input: JSON.stringify(cases), encoding: "utf8" }));
  for (let i = 0; i < cases.length; i++) {
    const r = await post(w, env, cases[i]);
    const js = r.status === 200 ? "" : (await r.json()).error;
    assert.equal(js === "" || js === "older", py[i] === "", `case ${i}: worker ${js || "ok"}, python ${py[i] || "ok"}`);
  }
});

test("the whole path on a fixture: file appears -> read -> graded -> served in under 30 s, and the email renders from it", async () => {
  const { w, env } = await loadWorker();
  const srv = createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const r = await w.fetch(new Request("http://127.0.0.1" + req.url, { method: req.method, headers: req.headers, body: req.method === "POST" ? Buffer.concat(chunks) : undefined }), env);
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer()));
  });
  await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
  const url = "http://127.0.0.1:" + srv.address().port;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "report-live-"));
  try {
    const out = await new Promise((ok, no) => {
      const p = spawn("python3", ["scripts/report_live.py", "rehearse", "--worker", url, "--fast", "--no-nass"], {
        cwd: ROOT, env: Object.assign({}, process.env, { UNSUB_SECRET: SECRET, REPORT_KEY_FILE: "", NASS_API_KEY: "", REPORT_LIVE_URL: url,
          DRY_RUN: "1", TMPDIR: tmp, GITHUB_OUTPUT: "", PRIVATE_REPO_TOKEN: "" }) });
      let s = "", e = ""; p.stdout.on("data", (d) => (s += d)); p.stderr.on("data", (d) => (e += d));
      const t = setTimeout(() => { p.kill(); no(new Error("rehearsal took over 3 minutes\n" + s + e)); }, 180000);
      p.on("close", (code) => { clearTimeout(t); ok({ code, s, e }); });
    });
    const line = out.s.split("\n").find((l) => l.startsWith("REHEARSAL "));
    assert.ok(line, "the rehearsal printed its result\n" + out.s.slice(-1500) + out.e.slice(-800));
    const res = JSON.parse(line.slice(10));
    assert.deepEqual(res.steps, { fixture: true, read: true, served: true, email: true }, out.s.slice(-1500));
    assert.ok(res.timings.appear_to_served_s < 30, `file appears -> live value served took ${res.timings.appear_to_served_s} s`);
    assert.equal(res.pass, true);
    assert.equal(out.code, 0);
    assert.ok(res.figures >= 1, "at least one graded figure served");
    const t = await getLive(w, env, "?test=1");
    assert.equal(t.release, res.release, "the worker holds the rehearsal's result in the test record");
    assert.equal(await getLive(w, env), null, "the live record was never touched");
    assert.doesNotMatch(out.s, /[A-Za-z0-9._%+-]+@(?!example\.com|agsist\.com)[A-Za-z0-9.-]+\.[a-z]{2,}/, "no reader address in the output");
  } finally {
    srv.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

const WF = read(".github/workflows/report-day-live.yml");
const job = (name) => { const i = WF.indexOf("\n  " + name + ":\n"); assert.ok(i > 0, name); const rest = WF.slice(i + 1); const n = rest.slice(1).search(/\n  [a-z][\w-]*:\n/); return n < 0 ? rest : rest.slice(0, n + 1); };

test("the workflow: start ticks for every report day, a watchdog, a rehearsal the day before", () => {
  const crons = [...WF.matchAll(/- cron: "([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(crons, ["38 15,16 8-12,30,31 * *", "48 15,16 8-12,30,31 * *", "17 19 7-11,29,30 * *"]);
  const st = execFileSync("python3", ["scripts/report_live.py", "--selftest"], { cwd: ROOT, encoding: "utf8" });
  assert.match(st, /ok {3}every report day on file starts inside the workflow's start ticks/);
  assert.match(st, /ok {3}the day before is the rehearsal/);
  assert.match(st, /OK: 0 failure\(s\)/);
  // every report day on file: a start tick lands between 25 and 5 minutes before its release, and a rehearsal tick the day before
  const days = JSON.parse(execFileSync("python3", ["-c", `
import json, sys
sys.path.insert(0, "scripts")
import report_live as r
from datetime import timedelta
print(json.dumps([[d.isoformat(), r.release_at(d).isoformat()] for d in r.report_days()]))`], { cwd: ROOT, encoding: "utf8" }));
  assert.ok(days.length >= 24, "report days on file: " + days.length);
  for (const [d, at] of days) {
    const rel = new Date(at), ticks = [38, 48].map((m) => { const t = new Date(rel); t.setUTCMinutes(m, 0, 0); if (t > rel) t.setUTCHours(t.getUTCHours() - 1); return t; });
    assert.ok(ticks.every((t) => rel - t >= 5 * 60000 && rel - t <= 25 * 60000 && [15, 16].includes(t.getUTCHours())), d + " start ticks");
    assert.ok([8, 9, 10, 11, 12, 30, 31].includes(+d.slice(8)), d + " day of month");
    const before = new Date(Date.parse(d + "T00:00:00Z") - 864e5).getUTCDate();
    assert.ok([7, 8, 9, 10, 11, 29, 30].includes(before), d + " rehearsal day");
  }
  assert.match(job("watchdog"), /report_live\.py watchdog --release/);
  assert.match(read("scripts/report_live.py"), /WATCH_MIN = \(3, 10\)/);
  assert.match(job("rehearse"), /report_live\.py rehearse --release "\$\{\{ needs\.gate\.outputs\.source \}\}" --fast --notify/);
});

test("the workflow: no write token where USDA is read, one email queue, a commit once with the push loop", () => {
  const live = job("live");
  assert.doesNotMatch(live, /contents: write|LIST_TOKEN|SMTP_PASS|GITHUB_TOKEN/, "the reading job holds no write token");
  assert.match(live, /persist-credentials: false/);
  const pollStep = live.slice(live.indexOf("- name: Check USDA every 10 seconds"), live.indexOf("- name: What changed"));
  assert.doesNotMatch(pollStep, /UNSUB_SECRET/, "the step that reads USDA holds only the route's own key");
  assert.match(pollStep, /REPORT_KEY_FILE/);
  assert.match(job("email"), /group: report-day-email/, "the same queue as report-day.yml's sender");
  assert.match(read(".github/workflows/report-day.yml"), /group: report-day-email/);
  assert.match(job("email"), /needs: \[gate, email-wait\]/, "the email starts on the live result, not on the commit");
  const c = job("commit");
  assert.match(c, /contents: write/);
  const commit = c.indexOf('git commit -m "report day: graded'), loop = c.indexOf("for i in 1 2 3 4 5; do");
  assert.ok(commit > 0 && loop > commit, "commits once, before the loop");
  assert.match(c, /git pull --rebase --autostash origin "\$\{GITHUB_REF_NAME:-main\}" \|\| \{ echo "Rebase failed\."; exit 1; \}/);
  assert.match(c, /Failed to push after 5 attempts\."; exit 1/);
  for (const j of ["live", "email", "watchdog"]) assert.match(job(j), /DRY_RUN: +\$\{\{ \(github\.event_name == 'workflow_dispatch' && inputs\.dry_run\) && '1' \|\| '' \}\}/, j + " honours DRY_RUN");
  assert.match(read("scripts/report_live.py"), /def issue\(title, body, close=False\):\n[\s\S]{0,400}if os\.environ\.get\("DRY_RUN"\) == "1":/, "the issue honours DRY_RUN");
  assert.match(read("scripts/report_live.py"), /def notify\(subject, lines\):\n[\s\S]{0,200}if os\.environ\.get\("DRY_RUN"\) == "1":/, "the notice honours DRY_RUN");
  assert.match(read(".github/workflows/wasde-watch.yml"), /WASDE watch/, "the backup stays");
});

test("the pages read the live result first and keep the committed files otherwise; no method text", () => {
  const rl = read("components/report-live.js"), pi = read("components/priced-in.js"), cal = read("usda-calendar.html"), home = read("index.html");
  assert.match(rl, /https:\/\/agsist-api\.dnilgis\.workers\.dev\/report-live/);
  assert.match(cal, /'priced-in':\['\/components\/util\.js\?v=18','\/components\/report-live\.js\?v=1','\/components\/priced-in\.js\?v=4'\]/);
  assert.equal((home.match(/<script src="\/components\/report-live\.js\?v=1" defer><\/script>/g) || []).length, 1);
  assert.match(pi, /window\.agsReportLive\.watch\(d\.upcoming\.date/);
  assert.match(rl, /function esc\(/, "the homepage card escapes text");
  assert.doesNotMatch(rl + pi, /\u2014/, "no em dash");
  const py = execFileSync("python3", ["-c", `
import json, sys
sys.path.insert(0, "scripts")
import prerender_wpi_scorecard as p
w = {"latest_result": None, "history": [], "upcoming": {"date": "2026-12-10"}}
print(p.home_usda_card(w))`], { cwd: ROOT, encoding: "utf8" });
  assert.match(py, /<div class="usda-cal-card gs-card" data-next="2026-12-10" data-shown="" style="display:none"><\/div>/, "an empty card still waits for the live result");
});

test("the homepage card from a live record reads like the baked one", () => {
  const src = read("components/report-live.js");
  const win = {}; const doc = { readyState: "complete", querySelector: () => null, addEventListener() {} };
  new Function("window", "document", src)(win, doc);
  const html = win.agsReportLive.homeCard(good({ release: "2026-12-10" }));
  assert.match(html, /<span class="gs-t">December WASDE &middot; Dec 10<\/span>/);
  // what a reader sees says nothing about how the number gets there
  assert.doesNotMatch(html.replace(/<[^>]+>/g, " "), /worker|KV|cron|GitHub|poll|pipeline|signed|live result/i, "no method text on the card");
  assert.match(html, /0 of 1 graded figures in line with the trade\. Biggest miss: 2026\/27 corn ending stocks, \+10\.5%, bearish\./);
  assert.match(html, /<p>2026\/27 corn ending stocks: 2\.1 bil bu, trade 1\.9\. Bearish, above the range\.<\/p>/);
  const r = win.agsReportLive.toResult(good({ release: "2026-12-10" }), { date: "2026-12-10", numbers: [{ key: "corn_2627", label: "2026/27 corn ending stocks", source: "https://example.com/s", expected: 1.9, actual: null }, { key: "soy_2627", label: "2026/27 soybean ending stocks", actual: null }] });
  assert.equal(r.numbers.length, 2, "rows not yet printed stay as waiting");
  assert.equal(r.numbers[0].actual, 2.1);
  assert.equal(r.numbers[0].source, "https://example.com/s", "the survey source credit stays");
  assert.equal(r.biggest_surprise.metric, "2026/27 corn ending stocks");
  assert.equal(r.metric_count, 1);
});
