/* Funds this week (scripts/send_cot_weekly.py), the weekly COT email.
 *
 *  1. The sender's own selftest: hand-worked numbers from fixtures, the link
 *     guard, dry run by default, preview to Sig only, the send path with the
 *     list, the flag and the mail server mocked.
 *  2. The email made from the repo's real COT files: every net and change it
 *     prints is data/cot.json's, and each rank is the page's own words
 *     (data/cot-analysis.json crowd.words), recounted from data/cot-deep.json.
 *  3. The workflows: funds-weekly.yml runs by hand only (no schedule until
 *     Sig says so) and is a dry run unless told otherwise; the run after a new
 *     report sends to the list only with FUNDS_WEEKLY_LIVE set.
 *
 *   node --test test/funds-weekly.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const json = (p) => JSON.parse(read(p));
const code = (y) => y.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
const MARKETS = [["corn", "CORN", "corn"], ["beans", "SOYBEANS", "soybean"], ["wheat", "CHICAGO WHEAT", "Chicago wheat"],
  ["livecattle", "LIVE CATTLE", "live cattle"], ["feedercattle", "FEEDER CATTLE", "feeder cattle"], ["leanhogs", "LEAN HOGS", "lean hog"]];
const comma = (n) => Math.abs(n).toLocaleString("en-US");

test("the sender's selftest passes (fixtures, links, modes, mocked send)", () => {
  const r = spawnSync("python3", ["scripts/send_cot_weekly.py", "--selftest"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /send_cot_weekly selftest ok/);
});

test("the email from the real COT files: every number recomputed from the raw files", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "funds-"));
  try {
    const out = path.join(dir, "funds.html");
    const r = spawnSync("python3", ["scripts/send_cot_weekly.py", "--render", out, "--live"], { cwd: ROOT, encoding: "utf8" });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const text = fs.readFileSync(out + ".txt", "utf8");
    const html = fs.readFileSync(out, "utf8");
    const cot = json("data/cot.json"), deep = json("data/cot-deep.json"), ana = json("data/cot-analysis.json");
    const asOf = new Date(cot.report_date + " 12:00 UTC");
    const iso = asOf.toISOString().slice(0, 10);
    const month = asOf.toLocaleString("en-US", { month: "long", timeZone: "UTC" });
    assert.ok(text.includes(`Positions as of Tuesday, ${month} ${asOf.getUTCDate()}.`), "the as-of date is data/cot.json's");
    assert.match(text, /Source: CFTC Commitments of Traders, Disaggregated, futures only, report as of /);
    assert.ok(!/[–—]/.test(text + html), "no em or en dash");
    assert.ok(!/workers\.dev/.test(text + html), "no shared host");
    const lines = text.split("\n");
    assert.ok(!/percentile|\d(st|nd|rd|th)\b|head for the exit|could be forced|between here and flat/i.test(text + html),
      "one rank, in words: no ordinals, no percentile, no exposure lines");
    const subject = lines[0].replace(/^Subject: /, "");
    assert.ok(subject && subject.length <= 80 && !/[–—]/.test(subject), `a short subject: ${subject}`);
    assert.ok(lines[4].startsWith("This week: Funds "), `the lead right under the masthead: ${lines[4]}`);
    let shown = 0;
    for (const [key, NAME, noun] of MARKETS) {
      const i = lines.indexOf(NAME);
      assert.ok(i > 0, `${NAME} is in the email, with numbers or with the reason it has none`);
      const body = lines[i + 1];
      if (body.startsWith("No reading this week: ")) continue;
      const c = cot[key];
      const held = c.side === "flat" && c.net ? "about even (net " + (c.net > 0 ? "long " : "short ") + comma(c.net) + ")"
        : c.net > 0 ? "net long " + comma(c.net) : c.net < 0 ? "net short " + comma(c.net) : "flat";
      const ch = c.net - c.prev;
      if (/^Funds (sold|bought) a net [\d,]+ /.test(body) && !/ since the /.test(body)) {
        assert.ok(body.startsWith(`Funds ${ch > 0 ? "bought" : "sold"} a net ${comma(ch)} ${noun} contracts, `), `${NAME} change ${ch}: ${body}`);
      }
      assert.ok(body.includes(` ${held}`), `${NAME} net from data/cot.json (${held}): ${body}`);
      const m = body.match(/: (higher than (\d+)% of weeks since (\d{4})|a bigger net short than (\d+)% of weeks since (\d{4})) \(share of open interest\)\.$/);
      if (!m) {
        assert.match(body, /No rank this week: /, `${NAME}: a rank in words or a reason: ${body}`);
        continue;
      }
      const a = ana.commodities[key];
      assert.equal(a.date, iso, `${NAME}: the ranking file is on this report`);
      assert.equal(m[1], a.crowd.words, `${NAME}: the page's own words (cot-analysis.json crowd.words)`);
      if (a.crowd.record) assert.ok(body.includes(", " + a.crowd.record + ": "), `${NAME}: the record, with its measure`);
      // recount from the weekly record: net as a share of open interest, the share of weeks at or below this one
      const d = deep.commodities[key];
      if (d && d.dates[d.dates.length - 1] === iso) {
        const r3 = (x) => Math.round(x * 1000) / 1000;
        const xs = d.dates.map((_, j) => (d.oi[j] ? r3((100 * (d.mm_long[j] - d.mm_short[j])) / d.oi[j]) : null)).filter((x) => x !== null);
        const v = xs[xs.length - 1];
        const pct = Math.round((1000 * xs.filter((x) => x <= v).length) / xs.length) / 10;
        assert.ok(Math.abs(pct - a.pctl.net_oi_all) <= 0.11, `${NAME}: recounted ${pct}, file ${a.pctl.net_oi_all}`);
        const n = m[2] !== undefined ? Number(m[2]) : 100 - Number(m[4]);
        assert.equal(n, a.crowd.shown, `${NAME}: the printed number is the page's shown whole number`);
        assert.ok(Math.abs(n - pct) <= 2, `${NAME}: ${n} against a recount of ${pct}`);
        assert.equal(m[3] || m[5], d.dates[0].slice(0, 4), `${NAME}: since the first report on record`);
      }
      shown++;
    }
    assert.ok(shown >= 3, "at least three markets carry a rank");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("funds-weekly.yml: by hand only, dry by default, preview to Sig, engine step", () => {
  const y = read(".github/workflows/funds-weekly.yml");
  const c = code(y);
  assert.match(c, /^on:\s*\n\s+workflow_dispatch:/m, "workflow_dispatch");
  assert.ok(!/^\s*schedule:/m.test(c), "no schedule: a new scheduled workflow needs Sig's OK");
  assert.ok(!/workflow_run:|^\s*push:|pull_request/m.test(c), "no other automatic trigger");
  assert.match(y, /#\s+- cron: '13 21 \* \* 1,5'/, "the proposed schedule is written down, commented out");
  assert.match(c, /options: \[dry, preview, send\]\s*\n\s+default: dry/, "dry is the default");
  assert.match(c, /PREVIEW:\s+\$\{\{ inputs\.mode == 'preview' && '1' \|\| '' \}\}/);
  assert.match(c, /SEND:\s+\$\{\{ inputs\.mode == 'send' && '1' \|\| '' \}\}/);
  assert.match(c, /SIG_TO:\s+\$\{\{ secrets\.SIG_TO \}\}/);
  assert.match(c, /- name: Checkout repo\s*\n\s+uses: actions\/checkout@v4\s*\n\s+- name: Engine checkout/, "Engine checkout right after the checkout");
  assert.match(c, /group: fetch-cot/, "queued with the COT data jobs");
});

test("cot-release-watch.yml sends to the list only with FUNDS_WEEKLY_LIVE (or a ticked manual run)", () => {
  const c = code(read(".github/workflows/cot-release-watch.yml"));
  const step = c.slice(c.indexOf("- name: Email Funds this week"));
  assert.match(step, /SEND:\s+\$\{\{ \(\(github\.event_name != 'workflow_dispatch' && vars\.FUNDS_WEEKLY_LIVE == '1'\) \|\| \(github\.event_name == 'workflow_dispatch' && inputs\.send_email == true\)\) && '1' \|\| '' \}\}/);
  assert.ok(!/DRY_RUN:\s+\$\{\{[^}]*\}\}\s*\n\s+run: python scripts\/send_cot_weekly\.py/.test(step), "no send that rests on DRY_RUN being empty");
  const s = read("scripts/send_cot_weekly.py");
  assert.match(s, /def mode_of\(argv\):[\s\S]*?return "dry"\n/, "the script itself is dry unless SEND=1");
});
