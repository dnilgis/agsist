/* The monthly backup (Sig, Oct 20: "how are we going to back up our repos
 * monthly exactly. i have an external ssd drive").
 *   - worker v5.39 GET /export (scripts/test_export_worker.mjs, run here so
 *     `node --test` covers it): Bearer LIST_TOKEN only, ?token= refused,
 *     pages through every key, values round-trip exactly;
 *   - scripts/backup/: the double-click wrapper and the PowerShell it runs
 *     (read here; there is no PowerShell on the test box);
 *   - the morning email's reminder on the 1st (scripts/morning_report.py --selftest).
 *
 *   node --test test/backup.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");

test("worker /export (scripts/test_export_worker.mjs)", () => {
  const out = execFileSync(process.execPath, [ROOT + "scripts/test_export_worker.mjs"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  assert.match(out, /export checks: \d+ passed/);
});

test("worker: the header names v5.39 and the route is Bearer only, read-only, never cached", () => {
  const w = read("workers/subs-worker.js");
  assert.ok(w.includes(" * v5.39 (2026-10-20): MONTHLY BACKUP."));
  const at = w.indexOf('if (path === "/export")');
  assert.ok(at > w.indexOf("const sig = !!bearer && authed;"), "after the Bearer-only check is built");
  const route = w.slice(at, w.indexOf("\n    }\n", at));
  assert.match(route, /if \(!sig \|\| url\.searchParams\.has\("token"\)\) return json\(\{ ok: false \}, 403/);
  assert.match(route, /"Cache-Control": "no-store"/);
  const page = w.slice(w.indexOf("async function exportPage"), w.indexOf("function escHtml"));
  assert.ok(!/\.put\(|\.delete\(/.test(page), "exportPage never writes");
});

test("the .cmd runs the .ps1 next to it with Bypass, then waits so the line can be read", () => {
  const c = read("scripts/backup/backup-agsist.cmd");
  assert.ok(/\r\n/.test(c) && !/[^\r]\n/.test(c), "CRLF line ends for cmd.exe");
  assert.match(c, /cd \/d "%~dp0"/);
  assert.match(c, /powershell\.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0backup-agsist\.ps1"/);
  assert.match(c, /set "RC=%ERRORLEVEL%"\r\necho\.\r\npause\r\nexit \/b %RC%/);
});

test("the .ps1: ASCII, the four repos as mirrors, no token in a URL, DPAPI, counts-only log, keep 12", () => {
  const p = read("scripts/backup/backup-agsist.ps1");
  assert.ok(!/[^\x00-\x7f]/.test(p), "plain ASCII (Windows PowerShell 5.1 misreads UTF-8 without a BOM)");
  assert.match(p, /\$Repos = @\('feedbag', 'agsist', 'bids', 'flashgrain'\)/);
  assert.match(p, /git clone --mirror \$url \$dir/);
  assert.match(p, /git -C \$dir remote update --prune/);
  assert.match(p, /\$url = 'https:\/\/github\.com\/' \+ \$Owner \+ '\/' \+ \$name \+ '\.git'/, "plain https; Git Credential Manager logs in");
  assert.ok(!/token=|@github\.com|x-access-token/i.test(p), "no token in any URL");
  assert.match(p, /\$ExportUrl = 'https:\/\/agsist-api\.dnilgis\.workers\.dev\/export'/);
  assert.match(p, /AuthenticationHeaderValue\('Bearer', \$token\)/);
  assert.match(p, /Read-Host -Prompt 'LIST_TOKEN' -AsSecureString/);
  assert.match(p, /ConvertFrom-SecureString \$sec\)/, "DPAPI, current user (no -Key)");
  assert.ok(!/ConvertFrom-SecureString[^\n]*-Key/.test(p));
  assert.match(p, /'kv-' \+ \$Stamp \+ '\.json'/);
  assert.match(p, /\$Keep = 12/);
  assert.match(p, /'backup-' \+ \$Stamp \+ '\.txt'/);
  assert.match(p, /'Backup done: ' \+ \$repoOk \+ ' repos up to date, ' \+ \(Format-N \$total\) \+ ' records saved, ' \+ \$Nice \+ '\.'/);
  assert.match(p, /https:\/\/git-scm\.com\/download\/win/);
  for (const m of p.matchAll(/Write-Log \(?(.*)/g)) assert.ok(!/\$token|\$text|\$inner|\.value|\$nm\b|\$k\b/.test(m[1]), "never logs a token, a key or a value: " + m[1]);
  assert.ok(!/\u2014/.test(p + read("scripts/backup/README.txt")), "no em dashes");
});

test("README.txt: first time, monthly, restore, and keep the drive safe", () => {
  const r = read("scripts/backup/README.txt");
  for (const s of ["https://git-scm.com/download/win", "First time", "Every month", "How to restore", "git clone E:/agsist-backup/repos/agsist.git", "KEEP THIS DRIVE SAFE", "email address"]) assert.ok(r.includes(s), s);
});

test("morning report: the reminder on the 1st, Central time", () => {
  const out = execFileSync("python3", [ROOT + "scripts/morning_report.py", "--selftest"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  assert.match(out, /ok {3}the 1st: the line is in Needs you/);
  assert.match(out, /ok {3}the 2nd: no line/);
  assert.match(out, /morning_report: all checks pass/);
});
