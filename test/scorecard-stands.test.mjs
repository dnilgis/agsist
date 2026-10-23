/* /scorecard, Oct 16 benchmark: a "where it stands" column for open calls
 * (labeled not graded, never counted), the Chicago wheat reason that read as
 * if the fund percentile were the trend, one date per missed call, and the
 * next entry close named with any federal holiday that moves it. The baked
 * cells (scripts/seed_static.py) and the live ones (components/bot-scorecard.js) must say
 * the same words; the browser half checks that against a fixture file.
 *
 * Hand checks: Dec corn entered 497.25 on Oct 5, closed 478.25 on Oct 15:
 * 19 cents under on a down call = right side so far. Nov beans 1280.75 vs
 * 1264.25 = 16.5 cents under. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;
const page = readFileSync(join(ROOT, "usda-calendar.html"), "utf8")   /* the scorecard is a section of the USDA calendar since Oct 22, 2026 */;

const CALLS = [
  { crop: "corn", status: "open", direction: "down", signal: "crowded_long", cot_pct: 97.4, trend_pct: 3.93, entry: 497.25, contract: "Dec '26", exit_day: "2026-11-02", made: "2026-10-05", mark: { date: "2026-10-15", close: 478.25 } },
  { crop: "beans", status: "open", direction: "down", signal: "crowded_long", cot_pct: 96.2, trend_pct: 2.24, entry: 1280.75, contract: "Nov '26", exit_day: "2026-11-02", made: "2026-10-05", mark: { date: "2026-10-15", close: 1264.25 } },
  { crop: "wheat", status: "open", direction: "up", signal: "trend_up", cot_pct: 87.2, trend_pct: 2.48, entry: 692.25, contract: "Dec '26", exit_day: "2026-11-02", made: "2026-10-05", mark: { date: "2026-10-15", close: 692.25 } },
  { crop: "kcwheat", status: "open", direction: "down", signal: "crowded_long", cot_pct: 92.3, trend_pct: 4.27, entry: 742.25, contract: "Dec '26", exit_day: "2026-11-02", made: "2026-10-05" },
];
const WANT_STAND = [
  "$4.7825 on Oct 15, 19 cents under entry: right side so far",
  "$12.6425 on Oct 15, 16.5 cents under entry: right side so far",
  "$6.9225 on Oct 15, level with entry (a tie grades as a miss)",
  "Shows after the bot’s next run",
];
const WHEAT_WHY = "13-week trend up (+2.5% over 13 weeks). Funds at the 87th percentile of the last 156 reports, not in the top or bottom tenth, so the trend decides";
const NEXT = { report: "2026-10-06", day: "2026-10-13", after_holiday: "2026-10-12" };
const WANT_NEXT = "Next calls: at the Oct 13, 2026 close, on the Oct 6, 2026 report. Oct 12, 2026 is a federal holiday, so the entry moves to the next business day.";

function py(expr, input) {
  return JSON.parse(execFileSync("python3", ["-c",
    `import sys,json,html;sys.path.insert(0,'scripts');import seed_static as s;d=json.loads(sys.stdin.read());print(json.dumps(${expr}))`],
    { cwd: ROOT, input: JSON.stringify(input), encoding: "utf8" }));
}

test("baked cells: where it stands, the wheat reason, the next entry", () => {
  assert.deepEqual(py("[html.unescape(s._pb_stand(c)) for c in d]", CALLS), WANT_STAND);
  assert.equal(py("s._pb_why(d)", CALLS[2]), WHEAT_WHY);
  assert.equal(py("s._pb_why(d)", CALLS[0]), "The bot’s own rule: funds in the top tenth of 3 years (97th percentile of the last 156 reports)");
  assert.equal(py("s._pb_next(d)", NEXT), WANT_NEXT);
  assert.equal(py("s._pb_next(d)", { ...NEXT, after_holiday: null }), "Next calls: at the Oct 13, 2026 close, on the Oct 6, 2026 report.");
  assert.equal(py("html.unescape(s._pb_stand(d))", { ...CALLS[0], status: "graded", outcome: "hit" }), "Graded: right");
  assert.equal(py("html.unescape(s._pb_stand(d))", { ...CALLS[2], direction: "down", mark: { date: "2026-10-15", close: 700 } }),
    "$7.00 on Oct 15, 7.75 cents over entry: wrong side so far");
});

test("the column is labeled not graded and says it is never counted", () => {
  assert.match(page, /<th scope="col">Where it stands \(not graded\)<\/th>/);
  assert.match(page, /It is not a grade: a call is graded on its grading day&rsquo;s close only, and nothing in that column is ever counted\./);
  const seeded = page.match(/<!--SEED:pb:latest-->([\s\S]*?)<!--\/SEED-->/)[1];
  for (const row of seeded.match(/<tr>[\s\S]*?<\/tr>/g) || []) assert.equal((row.match(/<td/g) || []).length, 7, "seven cells a row");
  assert.ok(!seeded.includes("13-week trend up (87th percentile"), "the old wheat wording is gone");
  assert.ok(!page.includes("—") && !page.includes("&mdash;"));
});

test("the bot writes the mark and the next entry, and has a watch", () => {
  const bot = readFileSync(join(ROOT, "scripts/prediction_bot.py"), "utf8");
  assert.match(bot, /def mark_open\(/);
  assert.match(bot, /"next_entry": next_entry\(deep, _today_ct\(\)\)/);
  assert.match(bot, /"entry_day": ed\.isoformat\(\)/, "a miss records its entry close");
  const out = execFileSync("python3", ["scripts/prediction_bot.py", "--selftest"], { cwd: ROOT, encoding: "utf8" });
  assert.match(out, /all prediction_bot selftests passed/);
  for (const name of ["next entry after Columbus Day", "watch: Oct 13 evening, no call -> alarm", "mark: latest close before an evening run's today"])
    assert.ok(out.includes("PASS  " + name), name);
  const wf = readFileSync(join(ROOT, ".github/workflows/predictions.yml"), "utf8");
  assert.match(wf, /- name: Entry-day watch\n\s+if: always\(\)\n\s+run: python scripts\/prediction_bot.py --watch/);
});

test("live page renders the same cells, one date per miss", { skip }, async () => {
  const fix = JSON.parse(readFileSync(join(ROOT, "data/predictions.json"), "utf8"));
  fix.latest = { date: "2026-10-05", calls: CALLS };
  fix.next_entry = NEXT;
  fix.skipped = ["corn", "beans", "wheat", "kcwheat"].map((k) => ({ crop: k, report: "2026-10-06", date: "2026-10-15", reason: "missed: no run at its entry close on 2026-10-13; never made late" }));
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/usda-calendar") p = "/usda-calendar.html";
    if (p === "/data/predictions.json") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(fix)); return; }
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": { ".js": "text/javascript", ".json": "application/json", ".html": "text/html", ".css": "text/css" }[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
  const port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const ctx = await browser.newContext({ serviceWorkers: "block" });
    const pg = await ctx.newPage();
    const errors = [];
    pg.on("pageerror", (e) => errors.push(String(e)));
    await pg.route("**/*", (r) => (r.request().url().startsWith(`http://127.0.0.1:${port}`) ? r.continue() : r.abort()));
    await pg.goto(`http://127.0.0.1:${port}/usda-calendar#scorecard`);
    await pg.waitForFunction(() => /Next calls/.test(document.getElementById("pb-next").textContent), null, { timeout: 15000 });
    const cells = await pg.$$eval("#pb-latest tbody tr", (rs) => rs.map((r) => [...r.cells].map((c) => c.textContent)));
    assert.deepEqual(cells.map((r) => r[5]), WANT_STAND);
    assert.equal(cells[2][6], WHEAT_WHY);
    assert.equal((await pg.textContent("#pb-next")).trim(), WANT_NEXT);
    const sk = (await pg.textContent("#pb-skipped")).trim();
    assert.equal(sk, "Oct 13, 2026 close (Oct 6, 2026 report): Corn, Soybeans, Chicago wheat, KC wheat. Missed: the bot did not run at that close, and a call is never made late.");
    assert.ok(!sk.includes("Oct 15"), "the day the miss was written down is not shown");
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});
