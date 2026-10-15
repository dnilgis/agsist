/* /scorecard opens with one plain sentence (Oct 15 review): what the backtest
 * says, why the page exists anyway, and that the open calls are not graded
 * until their grading day. The baked copy (scripts/seed_static.py pb_plain)
 * and the live copy (plainLine in scorecard.html) must say the same words. */
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

const FIX = {
  backtest: { records: { all: { verdict: "coin_flip", hit_rate: 47.6, first: "2013-01-07", last: "2026-08-31" } } },
  calls: [
    { crop: "corn", status: "open", exit_day: "2026-11-02" }, { crop: "beans", status: "open", exit_day: "2026-11-02" },
    { crop: "wheat", status: "graded", exit_day: "2026-10-05" },
  ],
};
const WANT = "In plain words: replayed on history since 2013, the bot’s rule was right 47.6% of the time, no better than a coin flip. "
  + "I publish its calls anyway, graded by code, so you can hold any market call to the same test. "
  + "The 2 open calls are not graded until Nov 2, 2026, on that day’s close only.";

function pyPlain(d) {
  const out = execFileSync("python3", ["-c", "import sys,json,html;sys.path.insert(0,'scripts');import seed_static as s;print(html.unescape(s.pb_plain(json.loads(sys.stdin.read()))))"],
    { cwd: ROOT, input: JSON.stringify(d), encoding: "utf8" });
  return out.trim();
}

test("baked plain sentence: backtest verdict, why we publish, open calls not graded until their day", () => {
  assert.equal(pyPlain(FIX), WANT);
  const one = pyPlain({ ...FIX, calls: [{ status: "open", exit_day: "2026-11-02" }] });
  assert.match(one, /The open call is not graded until Nov 2, 2026/);
  assert.ok(!/open call/.test(pyPlain({ ...FIX, calls: [] })), "no open calls, no open-call clause");
  const page = readFileSync(join(ROOT, "scorecard.html"), "utf8");
  const seeded = page.match(/<!--SEED:pb:pb-plain-->(.*?)<!--\/SEED-->/)[1];
  assert.match(seeded, /^In plain words: replayed on history since \d{4}/);
});

test("the live sentence in the browser matches the baked one", { skip }, async () => {
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/scorecard") p = "/scorecard.html";
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
    await pg.goto(`http://127.0.0.1:${port}/scorecard`);
    await pg.waitForFunction(() => document.getElementById("pb-updated") && document.getElementById("pb-updated").textContent.trim() !== "", null, { timeout: 15000 });
    await pg.waitForTimeout(500);
    const live = (await pg.textContent("#pb-plain")).trim();
    const d = JSON.parse(readFileSync(join(ROOT, "data/predictions.json"), "utf8"));
    assert.equal(live, pyPlain(d));
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});
