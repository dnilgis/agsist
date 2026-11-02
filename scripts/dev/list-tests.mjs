// The files a bare `node --test` runs from this folder, one per line: Node 22's own default pattern
// (lib/internal/test_runner/utils.js kDefaultPattern) with node_modules left out, as its runner does.
// scripts/dev/node-tests.sh splits this list across the PR checks' shards, so a shard runs exactly
// what node's own discovery would have run there (test/main-build.test.mjs holds the two together).
import fs from 'node:fs';
import path from 'node:path';

export const PATTERN = '**/{test,test/**/*,test-*,*[._-]test}.{js,mjs,cjs,ts,mts,cts}';
const skip = (e) => path.basename(typeof e === 'string' ? e : e.name) === 'node_modules';
export const list = (cwd = process.cwd()) => fs.globSync(PATTERN, { cwd, exclude: skip }).map((f) => f.split(path.sep).join('/')).sort();

if (import.meta.url === `file://${process.argv[1]}`) for (const f of list()) console.log(f);
