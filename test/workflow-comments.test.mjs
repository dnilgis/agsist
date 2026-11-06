/**
 * Workflow files carry one neutral line of comment (Curtain P2a). The stripper keeps the
 * parsed workflow, every run block and every condition the same; only comments change.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WF = path.join(root, '.github/workflows');

const py = (code) => spawnSync('python3', ['-I', '-c', `import sys; sys.path.insert(0, ${JSON.stringify(path.join(root, 'scripts/dev'))})\n` + code], { encoding: 'utf8' });

test('stripper keeps steps, run lines, conditions and env; only comments go', () => {
  const r = py(`
import workflow_comments as w
old = '''name: T
# long story about how
on:
  schedule:
    # why this hour
    - cron: "5 4 * * *"   # explained
jobs:
  a:
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'   # gate
    env:
      K: v   # note
    steps:
      - run: |
          # explain
          echo "a # not a comment"
          cat <<'EOT'
          # data line
          EOT
          python3 - <<'PY'
          # py note
          print(1)
          PY
          x="multi
          # inside quote"
          git push   # never force
'''
new = w.strip_comments(old, 't')
assert w.compare(old, new), new
assert '# data line' in new and '# inside quote' in new and 'not a comment' in new
assert 'explain' not in new and 'py note' not in new and 'why this hour' not in new and 'explained' not in new
bad = new.replace('print(1)', 'print(2)')
assert not w.compare(old, bad)
print('ok')
`);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /ok/);
});

test('every workflow has only its neutral header line (plus operator notes)', () => {
  const keep = /never force|do not force|force[- ]push|do not rename|secrets? needed/i;
  for (const f of fs.readdirSync(WF).filter((n) => n.endsWith('.yml'))) {
    const text = fs.readFileSync(path.join(WF, f), 'utf8');
    const comments = text.split('\n').filter((l) => /^\s*#/.test(l) && !/^\s*#!/.test(l) && !keep.test(l));
    const loose = comments.filter((l) => !/\bSig\b|approved|^\s*#\s*(-\s*cron:|schedule:|on:)|cron above/i.test(l));
    assert.ok(loose.length <= 1, `${f}: ${loose.length} comment lines, expected one neutral line`);
    assert.ok(!loose.length || loose[0].length < 100, `${f}: header too long`);
  }
});
