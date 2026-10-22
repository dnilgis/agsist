// The Daily email v2 (Sig, Oct 22 2026): every rule has a check here.
// scripts/test_daily_v2.py runs the content rules on the real archived issues
// (subject never the elevator count, no raw elevator-count line anywhere, the
// number check that blocks, sourced facts, the print slot skipped when there is
// no picture, no em dash, no shared host in a link, the switch, contrast).
// This file runs it and the module selftests, pins the workflow switch, and
// measures the length at a 390 px phone in Chromium.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const py = (args, env = {}) => execFileSync("python3", args, { cwd: ROOT, encoding: "utf8", env: { ...process.env, ...env }, timeout: 300000 });

test("content rules on the real issues (scripts/test_daily_v2.py)", () => {
  const out = py(["scripts/test_daily_v2.py"]);
  assert.match(out, /test_daily_v2: 0 failure\(s\)/, out.slice(-3000));
});

for (const s of ["daily_v2", "only_here", "daily_fact", "print_of_day"]) {
  test(`${s} selftest`, () => {
    assert.match(py([`scripts/${s}.py`, "--selftest"]), /selftest ok/);
  });
}

test("every fact in the pool carries its source, link, date and the source's words", () => {
  assert.match(py(["scripts/daily_fact.py", "--check"]), /0 without a full source/);
  const pool = JSON.parse(readFileSync(join(ROOT, "data/daily-facts.json"), "utf8")).facts;
  assert.ok(pool.length >= 10);
  for (const f of pool) {
    for (const k of ["fact", "source", "url", "checked", "quote"]) assert.ok(String(f[k] || "").trim(), `${f.id}: ${k}`);
    assert.match(f.url, /^https:\/\//, f.id);
    assert.match(f.checked, /^\d{4}-\d{2}-\d{2}$/, f.id);
  }
});

const wf = readFileSync(join(ROOT, ".github/workflows/daily.yml"), "utf8");
const job = (name) => {
  const i = wf.indexOf(`\n  ${name}:\n`);
  assert.ok(i > 0, name);
  const j = wf.slice(i + 1).search(/\n  [a-z][a-z0-9-]*:\n/);
  return wf.slice(i, j > 0 ? i + 1 + j : undefined);
};

test("the switch: v2 is live for the list, one input or one variable rolls it back", () => {
  assert.match(wf, /format:\n\s+description: "The Daily email's format[^\n]*\n\s+type: choice\n\s+options: \[v2, current\]\n\s+default: v2/);
  const FMT = "DAILY_FORMAT: ${{ inputs.format || vars.DAILY_FORMAT || 'v2' }}";
  const gen = job("generate");
  const send = gen.slice(gen.indexOf("- name: Send daily email"));
  assert.ok(send.startsWith("- name: Send daily email"));
  assert.ok(send.includes(FMT), "the list's send reads the format input, else the repo variable, else v2");
  assert.match(send, /PRINT_OF_DAY: \$\{\{ runner\.temp \}\}\/print-of-day\.json/);
  assert.match(send, /OWNER_TO:\s+\$\{\{ secrets\.SIG_TO \}\}/, "a held issue alerts Sig");
  const t = job("test-to-sig");
  assert.match(t, /TEST_TO_SIG:\s+'1'/);
  assert.match(t, /LIST_SOURCE:\s+backup/);
  assert.ok(t.includes(FMT));
  const sd = readFileSync(join(ROOT, "scripts/send_daily.py"), "utf8");
  assert.match(sd, /return "v2" if \(os\.environ\.get\("DAILY_FORMAT"\) or ""\)\.strip\(\)\.lower\(\) == "v2" else "current"/);
  assert.match(sd, /v2_gate\(day, b, alert=not \(dry or test\)\)/);
});

test("the live print never stops or delays the send past its caps", () => {
  const gen = job("generate");
  const draw = gen.slice(gen.indexOf("- name: Print of the day, drawn"), gen.indexOf("- name: GATE 0 "));
  assert.ok(draw.length > 100, "drawn at the top of the job, before the briefing is written");
  assert.match(draw, /continue-on-error: true\n\s+timeout-minutes: 7/);
  assert.match(draw, /git add "\$f"/);
  assert.ok(!/git add -A|git add \./.test(draw));
  const live = gen.slice(gen.indexOf("- name: Print of the day, is it live"), gen.indexOf("- name: Send daily email"));
  assert.match(live, /continue-on-error: true\n\s+timeout-minutes: 4/);
  assert.match(live, /seq 1 12\)[\s\S]*sleep 15/, "at most 3 minutes of waiting");
  assert.ok(gen.indexOf("- name: Print of the day, drawn") < gen.indexOf("- name: Generate daily briefing"));
});

test("the print job runs only for a v2 test copy, and commits only its picture", () => {
  const p = job("print-of-day");
  assert.match(p, /inputs\.test_to_sig == true && inputs\.send_email == true && inputs\.format != 'current'/);
  assert.match(p, /continue-on-error: true[\s\S]*continue-on-error: true/, "a failed render never fails the run");
  assert.match(p, /git checkout -q -B pod origin\/main/);
  assert.match(p, /git add "\$f"/);
  assert.ok(!/git add -A|git add \./.test(p));
  assert.match(job("test-to-sig"), /needs: \[print-of-day\]\n\s+if: \$\{\{ !cancelled\(\)/, "the email goes whether or not the picture does");
});

test("length: about two phone screens at 390 px, nothing wider than the screen", async (t) => {
  const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
  if (!existsSync(PW)) { t.skip("no Playwright here"); return; }
  const dir = mkdtempSync(join(tmpdir(), "dv2-"));
  const code = `
import json, sys
sys.path.insert(0, "scripts")
import daily_v2 as V
pod = {"image_url": "https://agsist.com/daily/img/print-2026-10-21.png", "why": "Hamilton County, Kansas: 29.92 in. of rain this year through Oct 17 at the Syracuse station, 195% of normal. The wettest against normal of the 472 farm-state counties we read.", "make_url": "/rain-print?place=Syracuse%2C+KS&year=2026", "alt": "Rain Print"}
fact = {"id": "x", "kind": "pool", "text": "There were 94.2 million cattle and calves on US farms on July 1, 2026. The 2026 calf crop was put at 32.5 million head, down 2% from 2025.", "source": "USDA NASS", "url": "https://www.nass.usda.gov/x", "file": None}
local = {"head": "Near Chetek, WI: top corn bid $4.01 (River Country Co-op, 18 mi), soybeans $11.75 (CDR Farms LLC, 17 mi).", "detail": [], "note": "The elevators' own posted boards, read when this email was sent. Straight-line miles. Not a contract. Call before you haul."}
for d in ("2026-10-19", "2026-10-20", "2026-10-21"):
    daily = json.load(open("data/daily-archive/%s.json" % d))
    b = V.build(daily, "https://agsist.com/daily/%s.html" % d, local=local, rain={"zip": "50010", "town": "Ames, IA"},
                loc=(42.0379, -93.6003, "IA"), pod=pod, fact=fact, forward_url="https://agsist.com/?ref=email-forward")
    open(sys.argv[1] + "/%s.html" % d, "w").write(b["html"].replace(pod["image_url"], "data:image/gif;base64,R0lGODlhAQABAAAAACw=").replace('width="552"', 'width="552" height="368"'))
`;
  execFileSync("python3", ["-c", code, dir], { cwd: ROOT });
  const { chromium } = await import(PW);
  const exe = existsSync("/opt/pw-browsers/chromium") ? { executablePath: "/opt/pw-browsers/chromium" } : {};
  const b = await chromium.launch(exe);
  try {
    for (const d of ["2026-10-19", "2026-10-20", "2026-10-21"]) {
      const p = await b.newPage({ viewport: { width: 390, height: 844 } });
      await p.goto("file://" + join(dir, d + ".html"));
      const [h, w] = await p.evaluate(() => [document.documentElement.scrollHeight, document.documentElement.scrollWidth]);
      assert.ok(w <= 390, `${d}: ${w} px wide`);
      // ZIP reader, every slot on: was 2,759 to 3,016 px (3.3 to 3.6 screens) before v2
      assert.ok(h <= 2100, `${d}: ${h} px at 390 wide`);
      await p.close();
    }
  } finally { await b.close(); }
});
