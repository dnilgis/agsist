/* A repository variable that is not set reads as null in a workflow expression. GitHub compares
 * loosely: when the two sides differ in type, both become numbers, and null, '' and '0' all become 0.
 * So `vars.X != '0'` is FALSE when X is unset, and a job gated on it never starts. The implied futures
 * shadow test skipped every chained run for this reason (Oct 28 to Nov 11, 2026).
 *
 * The safe form gives the variable a default first: `(vars.X || 'on') != '0'` compares string to string.
 * Comparing with any other number string ('1') is fine: null becomes 0, which is not 1.
 *
 *   node --test test/workflow-var-compare.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WF = path.join(root, '.github', 'workflows');
const workflows = fs.readdirSync(WF).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));

// GitHub's documented loose equality, enough of it to show the failure.
function toNumber(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number') return v;
  if (v.trim() === '') return 0;
  const n = Number(v);
  return Number.isNaN(n) ? NaN : n;
}
function ghEq(a, b) {
  const ta = a === null || a === undefined ? 'null' : typeof a;
  const tb = b === null || b === undefined ? 'null' : typeof b;
  if (ta === tb) return ta === 'string' ? a.toLowerCase() === b.toLowerCase() : a === b;
  return toNumber(a) === toNumber(b);
}
const ghOr = (a, b) => (a === null || a === undefined || a === '' || a === false || a === 0 ? b : a);

test('the skip reason: an unset variable equals the string 0', () => {
  assert.equal(ghEq(null, '0'), true, 'null == \'0\' under loose compare');
  assert.equal(!ghEq(null, '0'), false, 'so `vars.X != \'0\'` is false when X is unset');
  assert.equal(!ghEq(ghOr(null, 'on'), '0'), true, 'the default form runs when X is unset');
  assert.equal(!ghEq(ghOr('0', 'on'), '0'), false, 'and still stops when X is 0');
  assert.equal(!ghEq(ghOr('1', 'on'), '0'), true, 'and runs when X is 1');
  assert.equal(ghEq(null, '1'), false, '`vars.X == \'1\'` stays off when unset, as meant');
});

// Known uses of the bare form, kept as they are on purpose. This list may only shrink.
//   dairy.yml DAIRY_MONTHLY_LIVE: the expression reads as "off" when the variable is unset. It feeds a
//   send step, so changing its default would start a send; it stays as it is until switched on on purpose.
const KNOWN = ['dairy.yml: DAIRY_MONTHLY_LIVE'];

test('no workflow compares a repository variable bare with \'0\' or \'\'', () => {
  const bad = [];
  const re = /vars\.([A-Za-z_][A-Za-z0-9_]*)\s*(==|!=)\s*'(0|)'|'(0|)'\s*(==|!=)\s*vars\.([A-Za-z_][A-Za-z0-9_]*)/g;
  for (const f of workflows) {
    const lines = fs.readFileSync(path.join(WF, f), 'utf8').split('\n');
    for (const line of lines) {
      if (line.trim().startsWith('#')) continue;
      for (const m of line.matchAll(re)) bad.push(`${f}: ${m[1] || m[6]}`);
    }
  }
  const fresh = [...new Set(bad)].filter((b) => !KNOWN.includes(b));
  assert.deepEqual(fresh, [], 'use (vars.X || \'on\') != \'0\' so an unset variable does not read as 0');
  const gone = KNOWN.filter((k) => !bad.includes(k));
  assert.deepEqual(gone, [], 'fixed: take it off the KNOWN list');
});

test('implied futures: the chained gate uses the default form', () => {
  const y = fs.readFileSync(path.join(WF, 'implied-futures.yml'), 'utf8');
  assert.match(y, /\(vars\.IMPLIED_FUTURES_LIVE \|\| 'on'\) != '0'/);
  assert.doesNotMatch(y.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n'), /[^(]vars\.IMPLIED_FUTURES_LIVE != '0'/);
});
