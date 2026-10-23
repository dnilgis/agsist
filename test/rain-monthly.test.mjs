/* The monthly county rain email (Sig, Oct 23 2026: new list, sender and
 * schedule approved; Plan A sending not yet, so it goes the way the other
 * list senders go). Topic rain-month:<fips> (subs worker v5.54), mailed by
 * scripts/send_rain_month.py from .github/workflows/rain-monthly.yml on the
 * 2nd, numbers from scripts/rain_month.py.
 *   - the gate: nothing reaches the list without the repo variable
 *     RAIN_MONTHLY_LIVE=1, in the workflow and in the script;
 *   - sample renders for Barron County, Wisconsin (55005) and an Iowa county
 *     (Story, 19169), from the real data files, saying the page's numbers;
 *   - the unsubscribe link: the agsist.com front door, a link id, that county
 *     only, and the worker takes it.
 *
 *   node --test test/rain-monthly.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const py = (args, env = {}) => execFileSync("python3", args, { cwd: ROOT, encoding: "utf8", timeout: 180000,
  env: Object.assign({}, process.env, { SEND: "", PREVIEW: "", DRY_RUN: "", RAIN_MONTHLY_LIVE: "", SIG_TO: "", SIG_TEST_EMAILS: "" }, env) });
const DASH = /[–—]|&mdash;|&ndash;/;
const WF = read(".github/workflows/rain-monthly.yml");

test("the selftests: the page's numbers, the gate, the stop link the worker takes", () => {
  assert.match(py(["scripts/rain_month.py", "--selftest"]), /OK: 0 failure\(s\)/);
  const out = py(["scripts/send_rain_month.py", "--selftest"]);
  assert.match(out, /OK: 0 failure\(s\)/);
  for (const name of ["gate: --send without RAIN_MONTHLY_LIVE sends nothing, reads nothing, exits 1",
    "the worker asks, stops this county only, and refuses a forged token",
    "preview: Sig only, both sample counties, [Preview] subject, list untouched"]) {
    assert.ok(out.includes("ok   " + name), "selftest ran: " + name);
  }
});

test("the gate in the workflow: the list only with RAIN_MONTHLY_LIVE=1, scheduled or by hand", () => {
  const crons = [...WF.matchAll(/- cron: "([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(crons, ["41 14 2 * *"], "the 2nd of each month, the schedule Sig approved (Oct 23)");
  assert.match(WF, /options: \[dry, preview, send\]\n\s+default: dry/);
  assert.ok(WF.includes("SEND: ${{ ((github.event_name == 'schedule' && vars.RAIN_MONTHLY_LIVE == '1') || (github.event_name == 'workflow_dispatch' && inputs.mode == 'send' && vars.RAIN_MONTHLY_LIVE == '1')) && '1' || '' }}"),
    "SEND=1 only with the variable, on both triggers");
  assert.ok(WF.includes("RAIN_MONTHLY_LIVE: ${{ vars.RAIN_MONTHLY_LIVE }}"), "the script sees the variable too and refuses without it");
  assert.ok(WF.includes("PREVIEW: ${{ github.event_name == 'workflow_dispatch' && inputs.mode == 'preview' && '1' || '' }}"), "preview by hand only");
  assert.match(WF, /if \[ "\$ASKED_SEND" = 1 \] && \[ "\$SEND" != 1 \]; then\n\s+echo "::error::[^"]*RAIN_MONTHLY_LIVE[^"]*"\n\s+exit 1/, "a send asked for without the variable fails loudly");
  assert.ok(!/--send/.test(WF.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n")), "the workflow never passes --send: SEND comes only from the gated expression");
  const send = WF.indexOf("python3 scripts/send_rain_month.py $ARGS");
  assert.ok(WF.indexOf("python scripts/send_rain_month.py --selftest") > 0 && WF.indexOf("python scripts/send_rain_month.py --selftest") < send, "selftest before the send");
  assert.ok(WF.includes("SIG_TEST_EMAILS: ${{ secrets.SIG_TEST_EMAILS }}") && WF.includes("SIG_TO: ${{ secrets.SIG_TO }}"), "preview addresses from secrets");
  // the email job reads the data the fresh job just pushed, and sends nothing after a failed fetch
  const email = WF.slice(WF.indexOf("\n  email:\n"));
  assert.match(email, /needs: fresh\n/);
  assert.ok(email.includes("if: always() && (needs.fresh.result == 'success' || needs.fresh.result == 'skipped')"));
  assert.match(email, /uses: actions\/checkout@v4\n\s+with:\n\s+ref: main/);
});

test("the gate in the script: SEND=1 without RAIN_MONTHLY_LIVE=1 reads nothing and sends nothing", () => {
  for (const live of ["", "0", "true"]) {
    let rc = 0, out = "";
    try { out = py(["scripts/send_rain_month.py"], { SEND: "1", RAIN_MONTHLY_LIVE: live, LIST_URL: "http://127.0.0.1:9", LIST_TOKEN: "x", UNSUB_SECRET: "x" }); }
    catch (e) { rc = e.status; out = String(e.stdout); }
    assert.equal(rc, 1, "exit 1 with RAIN_MONTHLY_LIVE=" + JSON.stringify(live));
    assert.match(out, /refused: RAIN_MONTHLY_LIVE is not 1/);
    assert.ok(!/could not read the list|to mail/.test(out), "the list was never read");
  }
});

test("the fresh job is county-rain.yml's own fetch, build and commit, in its queue", () => {
  const cr = read(".github/workflows/county-rain.yml");
  for (const line of ["python scripts/fetch_county_rain.py --selftest", "python scripts/build_county_rain.py --selftest",
    "python scripts/fetch_county_rain.py --check", "python scripts/build_county_rain.py\n", "python scripts/build_county_rain.py --check",
    "python scripts/cross_links.py --stamp", "python scripts/check_seo.py", "python scripts/check_site_budget.py",
    "python3 scripts/build_share_images.py --only rain",
    'git add -A data/rain data/pointers rain rain.html sitemap-rain.xml img/og/rain.jpg img/og/rain-??.jpg prf farmland-atlas arc-plc 2>/dev/null || true',
    'git commit -q -m "data: county rain ($N states)"']) {
    assert.ok(cr.includes(line), "county-rain.yml still has: " + line);
    assert.ok(WF.includes(line), "rain-monthly.yml has it too: " + line);
  }
  const fresh = WF.slice(WF.indexOf("\n  fresh:\n"), WF.indexOf("\n  email:\n"));
  assert.match(fresh, /concurrency:\n\s+group: county-rain\n\s+cancel-in-progress: false/, "one queue with county-rain.yml");
  assert.ok(fresh.includes("if: github.event_name == 'schedule' || inputs.fetch == true"));
  assert.ok(!fresh.includes("send_rain"), "no mail from the fetch job");
});

test("the samples: Barron County, Wisconsin and Story County, Iowa, in the page's own numbers", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rain-month-"));
  // no network in the test: the station record is "did not load", which the email says
  const code = `
import sys, json, os
sys.path.insert(0, 'scripts')
import send_rain_month as S, rain_month as RM, email_links as L
from datetime import date
data, w = S.load('.'), S.load_drought('.')
out = {}
for fips in ('55005', '19169'):
    st, d, c, day = data[fips]
    y = d['year']
    full = [i for i, r in enumerate(c['months']) if r[2] == r[3] and r[3] == __import__('calendar').monthrange(y, i + 1)[1]]
    m = full[-1]
    parts, why = S.compose(fips, y, m, data, w, S.Records(lambda g: None), date(y, 10, 23), '.')
    msg = S.render(fips, 'reader@example.com', 'https://w.dev', 'sec', L.SAMPLE_LID, parts, 'news@agsist.com')
    out[fips] = {'subject': msg['Subject'], 'reply': msg['Reply-To'], 'lu': msg['List-Unsubscribe'], 'm': m, 'y': y,
                 'txt': msg.get_body(('plain',)).get_content(), 'html': msg.get_body(('html',)).get_content()}
print(json.dumps(out))
`;
  const R = JSON.parse(py(["-c", code]));
  for (const [fips, st, page] of [["55005", "wi", "rain/wisconsin/barron-county"], ["19169", "ia", "rain/iowa/story-county"]]) {
    const r = R[fips], c = JSON.parse(read(`data/rain/${st}.json`)).counties[fips];
    const [t, u] = c.months[r.m];
    const MON = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    // the page's month row, said the way the page's table says it
    assert.ok(r.subject.startsWith(`${c.name} rain, ${MON[r.m]}: ${t.toFixed(2)} in`), fips + " subject: " + r.subject);
    assert.ok(r.txt.includes(`${MON[r.m]}: ${t.toFixed(2)} inches at `), fips + ": the month total");
    const d = t - u;
    if (Math.abs(d) >= 0.05) assert.ok(r.txt.includes(`${Math.abs(d).toFixed(2)} inches ${d > 0 ? "more" : "less"} than usual for the month (usual ${u.toFixed(2)}`), fips + ": vs usual");
    // year to date: the page's rows added up
    const yt = c.months.slice(0, r.m + 1).reduce((a, x) => a + x[0], 0);
    assert.ok(r.txt.includes(`: ${yt.toFixed(2)} inches. That is `), fips + ": year to date " + yt.toFixed(2));
    assert.ok(r.txt.includes("The station's past record did not load this time"), fips + ": a record that did not load says so");
    assert.ok(/Drought Monitor, map valid [A-Z][a-z]{2} \d+, \d{4}: /.test(r.txt) || r.txt.includes("has no county figure"), fips + ": drought line");
    assert.equal((r.txt.match(/In the field: /g) || []).length, 1, fips + ": one field line");
    assert.equal((r.txt.match(/Rain Print:/g) || []).length, 1, fips + ": Rain Print once");
    assert.ok(r.txt.indexOf("Rain Print:") > r.txt.indexOf("Month by month"), fips + ": at the bottom");
    if (fs.existsSync(path.join(ROOT, page + ".html"))) assert.ok(r.txt.includes(`https://agsist.com/${page}?utm_source=rain_month`), fips + ": links the county page");
    assert.ok(/NOAA daily records through RCC-ACIS, read [A-Z][a-z]{2} \d+, \d{4}/.test(r.txt), fips + ": source and date");
    assert.equal(r.reply, "news@agsist.com");
    assert.ok(r.txt.includes("PO Box 243, Chetek, WI 54728") && r.html.includes(">Unsubscribe</a>"), fips + ": standard footer");
    assert.ok(!DASH.test(r.txt + r.html) && !r.txt.includes("!"), fips + ": no dashes, no exclamation marks");
    assert.ok(/\bI use\b/.test(r.txt) && /\n\nSig\n\n/.test(r.txt), fips + ": Sig, first person");
    // the unsubscribe link
    const stop = /Unsubscribe: (\S+)/.exec(r.txt)[1];
    const u2 = new URL(stop);
    assert.equal(u2.origin + u2.pathname, "https://agsist.com/e", "the agsist.com front door (BUILD-RULES 11)");
    assert.equal(u2.searchParams.get("a"), "notice-unsubscribe");
    assert.equal(u2.searchParams.get("topic"), "rain-month:" + fips, "stops this county only");
    assert.equal(u2.searchParams.get("t"), crypto.createHmac("sha256", "sec").update(u2.searchParams.get("k")).digest("hex").slice(0, 16), "hmac16 of the link id, UNSUB_SECRET");
    assert.ok(!/@|%40/.test(stop) && !/workers\.dev/.test(r.txt + r.html), "no address and no shared host in any link");
    assert.ok(r.lu.includes(stop) && r.lu.includes("mailto:news@agsist.com"), "List-Unsubscribe carries it");
    fs.writeFileSync(path.join(tmp, fips + ".html"), r.html);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("the worker takes the topic and its stop link, and says so in its header", async () => {
  const W = read("workers/subs-worker.js");
  assert.ok(W.includes(" * v5.54 (2026-10-23): MONTHLY COUNTY RAIN"), "the header names the change");
  assert.ok(W.indexOf(" * v5.54 ") < W.indexOf(" * v5.53 "), "newest first");
  const tmp = path.join(os.tmpdir(), "subs-worker-rain-month-" + process.pid + ".mjs");
  fs.copyFileSync(path.join(ROOT, "workers/subs-worker.js"), tmp);
  const w = (await import(pathToFileURL(tmp).href)).default;
  fs.unlinkSync(tmp);
  const store = new Map();
  const env = { UNSUB_SECRET: "sec", LIST_TOKEN: "tok", SUBS: {
    async get(k) { return store.has(k) ? store.get(k) : null; }, async put(k, v) { store.set(k, v); }, async delete(k) { store.delete(k); },
    async list({ prefix }) { return { keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }; } } };
  const post = (b) => w.fetch(new Request("https://x.dev/notice", { method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://agsist.com" }, body: JSON.stringify(b) }), env);
  let r = await post({ email: "a@example.com", topic: "rain-month:55005", source: "page:rain/wisconsin/barron-county" });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).topic, "rain-month:55005");
  for (const t of ["rain-month:72001", "rain-month:19000", "rain-month:1916", "rain-month:19169:2026"]) {
    r = await post({ email: "b@example.com", topic: t });
    assert.equal(r.status, 400, t);
  }
});

test("the ask: from data/rain-month.json, drawn by signup-ask.js, the Daily box unticked", () => {
  const conf = JSON.parse(read("data/rain-month.json"));
  assert.equal(typeof conf.live, "boolean");
  for (const k of ["ask", "btn", "ok", "note"]) assert.ok(conf[k] && !DASH.test(conf[k]), k);
  const on = py(["-c", "import sys,json; sys.path.insert(0,'scripts'); import rain_month as RM; c=RM.ask_conf(); c['live']=True; print(RM.ask_html('Barron County','55005',conf=c))"]).trim();
  assert.match(on, /^<div data-signup-ask="Email me Barron County&rsquo;s rain at the start of each month\." data-topic="rain-month:55005" data-btn="[^"]+" data-ok="[^"]+" data-note="[^"]+"><\/div>$/);
  assert.ok(!/data-daily/.test(on), "no ask pre-ticks the Daily (Sig, Oct 19)");
  const off = py(["-c", "import sys; sys.path.insert(0,'scripts'); import rain_month as RM; c=RM.ask_conf(); c['live']=False; print(repr(RM.ask_html('Barron County','55005',conf=c)))"]).trim();
  assert.equal(off, "''", "off: no ask on the page");
  const SA = read("components/signup-ask.js");
  assert.ok(SA.includes("(/^(?:rainyear:\\d{4}|rain-month):(\\d{5})$/.exec(topic) || [])[1]"), "One more? knows the county of a rain-month signup");
  assert.ok(SA.includes("'<label class=\"sa-optin sa-d\" for=\"' + did + '\"><input type=\"checkbox\" id=\"' + did + '\"> Also send the morning briefing</label>'"), "the Daily box, unticked");
  assert.ok(read("scripts/send_rain_month.py").includes('TOPIC_RE = re.compile(r"rain-month:(\\d{5})")'), "the sender reads the topic the ask posts");
});
