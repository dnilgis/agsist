/* Data jobs push after a rebase: a workflow step that commits and then retries its
 * push must commit once, outside the loop. If the loop re-checked "anything staged"
 * after a rebase, the commit already made would look like no change and the step
 * would exit without pushing. A rebase that fails must fail the step, and a loop
 * that never pushes must exit non-zero.
 *
 *   node --test test/workflow-push-retry.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, '.github', 'workflows');

// Each loop (for ... done) that contains a rebase and a push.
function pushLoops(text) {
  const lines = text.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*for \w+ in [\d ]+; do\s*$/.test(lines[i])) continue;
    const indent = lines[i].match(/^\s*/)[0].length;
    let j = i + 1;
    while (j < lines.length && !(/^\s*done\b/.test(lines[j]) && lines[j].match(/^\s*/)[0].length === indent)) j++;
    const body = lines.slice(i, j + 1).join('\n');
    if (/\bgit pull\b[^\n]*--rebase/.test(body) && /\bgit push\b/.test(body)) {
      out.push({ line: i + 1, body, after: lines.slice(j + 1, j + 4).join('\n') });
    }
  }
  return out;
}

// The jobs that commit a graded or fetched data file and retry the push after a rebase.
const files = ['wasde-watch.yml', 'wasde-archive.yml', 'fetch-wasde-pdf.yml', 'fetch-fsa-arcplc.yml', 'fetch-fsa-files.yml', 'seo-weekly.yml'];

test('a push loop with a rebase never re-checks staged changes or commits inside the loop', () => {
  let seen = 0;
  for (const f of files) {
    for (const l of pushLoops(fs.readFileSync(path.join(dir, f), 'utf8'))) {
      seen++;
      assert.ok(!/diff (--staged|--cached) --quiet/.test(l.body), `${f}:${l.line} checks staged changes inside the push loop`);
      assert.ok(!/\bgit commit\b/.test(l.body), `${f}:${l.line} commits inside the push loop`);
    }
  }
  assert.ok(seen === 6, `expected the data jobs' push loops, found ${seen}`);
});

test('the loop pushes after a rebase, fails on a failed rebase and exits 1 if never pushed', () => {
  for (const f of files) {
    for (const l of pushLoops(fs.readFileSync(path.join(dir, f), 'utf8'))) {
      const rebase = l.body.search(/--rebase/);
      assert.ok(/\bgit push\b/.test(l.body), `${f}:${l.line} has no push`);
      assert.ok(!/--rebase[^\n]*\|\| true/.test(l.body), `${f}:${l.line} ignores a failed rebase`);
      assert.ok(/--rebase[^\n]*\|\|\s*\{[^}]*exit 1/.test(l.body), `${f}:${l.line} does not fail the step when the rebase fails`);
      assert.ok(/exit 1/.test(l.after), `${f}:${l.line} does not exit 1 when no attempt pushed`);
      // a push exists in the loop and the rebase runs on a failed push, then the loop comes round to push again
      assert.ok(rebase > 0);
      assert.ok(/for \w+ in 1 2 3 4 5/.test(l.body), `${f}:${l.line} should try 5 times`);
    }
  }
});

test('wasde-watch commits once, before the loop', () => {
  const t = fs.readFileSync(path.join(dir, 'wasde-watch.yml'), 'utf8');
  const commit = t.indexOf('git commit -m "wasde: graded');
  const loop = t.indexOf('for i in 1 2 3 4 5; do', commit);
  assert.ok(commit > 0 && loop > commit);
});
