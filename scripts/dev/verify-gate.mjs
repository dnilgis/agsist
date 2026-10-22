#!/usr/bin/env node
// Stop / SubagentStop hook (.claude/settings.json): a session or helper cannot finish while
// its last test run (scripts/dev/verify.sh -> .verify/last.json) had a failure or a skipped
// test, or while it has changed components/, scripts/, workers/ or test/ since that run.
//
// Only gates a checkout whose .verify/last.json was written after this session (or helper)
// started, or that has such changes since it. No record at all: no gate.
// stop_hook_active (already continued once for a stop hook): never blocks, so it cannot loop.
// Blocks with exit 2 and a plain reason on stderr (Claude reads it). Any error: exit 0.
//
// Checkouts looked at: the hook's cwd and CLAUDE_PROJECT_DIR, plus, for a helper
// (SubagentStop), each worktree of that repo whose path appears in the helper's transcript.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const WATCH = ['components/', 'scripts/', 'workers/', 'test/'];
const git = (cwd, ...a) => { const r = spawnSync('git', a, { cwd, encoding: 'utf8', timeout: 10000 }); return r.status === 0 ? r.stdout : null; };
const top = (d) => { try { if (!d || !fs.statSync(d).isDirectory()) return null; } catch { return null; } const t = git(d, 'rev-parse', '--show-toplevel'); return t ? t.trim() : null; };

function startOf(file) { // when the session / helper started: the first timestamp in its transcript
  if (!file) return null;
  try {
    const fd = fs.openSync(file, 'r'); const buf = Buffer.alloc(65536); const n = fs.readSync(fd, buf, 0, buf.length, 0); fs.closeSync(fd);
    for (const line of buf.subarray(0, n).toString('utf8').split('\n')) {
      try { const t = Date.parse(JSON.parse(line).timestamp); if (t) return t; } catch { /* next line */ }
    }
    const st = fs.statSync(file); if (st.birthtimeMs > 0) return st.birthtimeMs;
  } catch { /* no transcript */ }
  return null;
}

function check(dir, start) {
  const f = path.join(dir, '.verify/last.json');
  let rec, m;
  try { rec = JSON.parse(fs.readFileSync(f, 'utf8')); m = fs.statSync(f).mtimeMs; } catch { return []; }
  const fresh = start != null && m >= start;
  const base = rec.head && git(dir, 'cat-file', '-e', `${rec.head}^{commit}`) !== null ? rec.head : 'HEAD';
  const names = new Set([...(git(dir, 'diff', '--name-only', base) || '').split('\n'), ...(git(dir, 'ls-files', '--others', '--exclude-standard') || '').split('\n')]);
  const changed = [...names].filter((p) => p && WATCH.some((w) => p.startsWith(w))).filter((p) => { try { return fs.statSync(path.join(dir, p)).mtimeMs > m; } catch { return false; } });
  if (!fresh && !changed.length) return [];
  const out = [];
  const where = dir;
  if (rec.fail > 0) out.push(`${where}: the last test run (scripts/dev/verify.sh, ${rec.at}) had ${rec.fail} failure(s). Fix them and run scripts/dev/verify.sh again.`);
  if (rec.skipped > 0) out.push(`${where}: the last test run (${rec.at}) skipped ${rec.skipped} test(s). A skip is not a pass: make them run (install what they need, e.g. JSQR_PATH or Playwright at /opt/pw-browsers) and run scripts/dev/verify.sh again, or say plainly in your report which tests did not run and why.` + (rec.skips && rec.skips.length ? ` Skipped: ${rec.skips.slice(0, 10).join('; ')}` : ''));
  if (changed.length) out.push(`${where}: changed since the last test run: ${changed.slice(0, 8).join(', ')}${changed.length > 8 ? ` and ${changed.length - 8} more` : ''}. Run scripts/dev/verify.sh before finishing.`);
  return out;
}

try {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { process.exit(0); }
  const inp = JSON.parse(raw || '{}');
  if (inp.stop_hook_active) process.exit(0);
  const sub = inp.hook_event_name === 'SubagentStop';
  const tfile = sub ? inp.agent_transcript_path : inp.transcript_path;
  const start = startOf(tfile);
  const dirs = new Set([top(inp.cwd), top(process.env.CLAUDE_PROJECT_DIR)].filter(Boolean));
  if (sub && tfile) {
    let tx = '';
    try { const st = fs.statSync(tfile); if (st.size < 50e6) tx = fs.readFileSync(tfile, 'utf8'); } catch { /* none */ }
    for (const d of [...dirs]) {
      for (const w of (git(d, 'worktree', 'list', '--porcelain') || '').split('\n')) {
        const p = w.startsWith('worktree ') ? w.slice(9) : null;
        if (p && tx.includes(p)) dirs.add(p);
      }
    }
  }
  const problems = [...dirs].flatMap((d) => check(d, start));
  if (problems.length) { process.stderr.write(`Not finished yet. ${problems.join(' ')}\n`); process.exit(2); }
} catch { /* never fail the turn on our own error */ }
process.exit(0);
