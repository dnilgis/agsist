#!/usr/bin/env node
// PreToolUse hook for Bash (.claude/settings.json). Backs up the permissions.deny rules where a
// rule cannot say it: blocks (exit 2, reason on stderr)
//   - rm with -r and -f on any target that is not under /tmp/ (deny rules cannot carve /tmp out,
//     because deny always wins over allow)
//   - git push to main (any spelling: main, :main, HEAD:main, refs/heads/main, git -C dir push ...)
//   - a forced git push (--force, --force-with-lease, -f in any flag group, a +refspec)
// Everything else, and any error of its own: exit 0 (the normal permission rules decide).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// split a command line into simple commands and their words; quotes kept together, $VARS left as text
function commands(src) {
  const out = []; let words = []; let w = ''; let q = null; let has = false;
  const end = () => { if (has) words.push(w); w = ''; has = false; };
  const cut = () => { end(); if (words.length) out.push(words); words = []; };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) { if (c === q) q = null; else if (c === '\\' && q === '"' && i + 1 < src.length) w += src[++i]; else w += c; continue; }
    if (c === "'" || c === '"') { q = c; has = true; continue; }
    if (c === '\\' && i + 1 < src.length) { w += src[++i]; has = true; continue; }
    if (c === ' ' || c === '\t') { end(); continue; }
    if (c === '\n' || c === ';' || c === '|' || c === '&' || c === '(' || c === ')' || c === '`') { cut(); continue; }
    if (c === '$' && src[i + 1] === '(') { cut(); i++; continue; }
    w += c; has = true;
  }
  cut();
  // drop leading VAR=x assignments and wrappers
  return out.map((ws) => { let k = 0; while (k < ws.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(ws[k]) || ['sudo', 'command', 'builtin', 'nohup', 'time', 'nice', 'exec', 'env', 'xargs'].includes(ws[k]))) k++; if (ws[k] === 'timeout') { k++; while (k < ws.length && (/^-/.test(ws[k]) || /^\d/.test(ws[k]))) k++; } return ws.slice(k); }).filter((ws) => ws.length);
}

function underTmp(p, cwd) {
  if (!p || /[$`~*?]/.test(p) && !/^\/tmp\/[^$`~]*$/.test(p)) return false;   // unresolvable (a $VAR, ~, a glob outside /tmp): not provably /tmp
  const abs = path.resolve(cwd || '/', p);
  return abs.startsWith('/tmp/') && abs !== '/tmp/' && !abs.split('/').includes('..');
}

function problems(cmd, cwd0) {
  const out = []; let cwd = cwd0;
  for (const ws of commands(cmd)) {
    const prog = path.basename(ws[0]);
    if (prog === 'cd' && ws[1] && !/[$`~]/.test(ws[1])) { cwd = path.resolve(cwd || '/', ws[1]); continue; }
    if (prog === 'rm') {
      let r = false, f = false; const targets = []; let opts = true;
      for (const a of ws.slice(1)) {
        if (opts && a === '--') { opts = false; continue; }
        if (opts && /^--/.test(a)) { if (a === '--recursive') r = true; if (a === '--force') f = true; continue; }
        if (opts && /^-[A-Za-z]+$/.test(a)) { if (/[rR]/.test(a)) r = true; if (/f/.test(a)) f = true; continue; }
        targets.push(a);
      }
      if (r && f) { const bad = targets.filter((t) => !underTmp(t, cwd)); if (bad.length || !targets.length) out.push(`rm -rf is only allowed on literal paths under /tmp/ (not: ${bad.join(' ') || '(no target)'}). Remove worktrees with git worktree remove, or ask Sig.`); }
    }
    if (prog === 'git') {
      let k = 1, dir = cwd; while (k < ws.length && /^-/.test(ws[k])) { if (ws[k] === '-C' && ws[k + 1]) dir = path.resolve(dir || '/', ws[k + 1]); k += (ws[k] === '-C' || ws[k] === '-c') ? 2 : 1; }
      if (ws[k] !== 'push') continue;
      const args = ws.slice(k + 1);
      if (args.some((a) => /^--force(-with-lease|-if-includes)?(=|$)/.test(a) || /^-[A-Za-z]*f[A-Za-z]*$/.test(a) || /^\+/.test(a) || /^--mirror$/.test(a))) out.push('a forced git push is never allowed here (BUILD-RULES 18: nothing on a branch may be lost). Merge origin/<branch> and push plain.');
      const refs = args.filter((a) => !/^-/.test(a)).slice(1);   // after the remote
      // no refspec, or plain HEAD: it goes where the current branch is
      const cur = () => { const r = spawnSync('git', ['symbolic-ref', '--short', '-q', 'HEAD'], { cwd: dir || undefined, encoding: 'utf8', timeout: 5000 }); return r.status === 0 ? r.stdout.trim() : ''; };
      if (refs.some((a) => /(^|:|refs\/heads\/)main$/.test(a.replace(/^\+/, ''))) || ((!refs.length || refs.includes('HEAD')) && cur() === 'main')) out.push('pushing to main is not allowed from a session or helper: push your fx/* branch and open a pull request; the lead ships main.');
    }
  }
  return [...new Set(out)];
}

try {
  const inp = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  const cmd = inp.tool_input && inp.tool_input.command;
  if (inp.tool_name === 'Bash' && typeof cmd === 'string') {
    const p = problems(cmd, inp.cwd);
    if (p.length) { process.stderr.write(`Blocked: ${p.join(' ')}\n`); process.exit(2); }
  }
} catch { /* never block on our own error */ }
process.exit(0);
