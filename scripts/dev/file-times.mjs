// A node --test reporter beside TAP (scripts/dev/node-tests.sh): one line per test file,
// "<milliseconds>\t<path from the repo root>", from the file's own complete event (its wall time:
// start of the child process to its end). It changes nothing about what runs or what passes;
// the PR checks print the slowest files and scripts/dev/test-durations.json comes from these lines.
import path from 'node:path';

export default async function* times(source) {
  const cwd = process.cwd();
  for await (const e of source) {
    if (e.type !== 'test:complete' || !e.data || !e.data.file || e.data.nesting !== 0) continue;
    const rel = path.relative(cwd, e.data.file);
    if (e.data.name !== rel && e.data.name !== path.basename(e.data.file) && e.data.name !== e.data.file) continue;
    const ms = e.data.details && e.data.details.duration_ms;
    if (typeof ms === 'number') yield `${Math.round(ms)}\t${rel.split(path.sep).join('/')}\n`;
  }
}
