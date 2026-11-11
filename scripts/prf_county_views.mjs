/* scripts/prf_county_views.mjs: every PRF county view as a reader sees it.
 *
 * WHY. Since the Nov 2026 fold a county's PRF figures are a data file
 * (prf/<state>/<county>.json, scripts/build_prf_counties.py) that
 * components/prf-county.js lays out on the state page. Checks that held the
 * old county pages to their facts (scripts/stories_prf.py selftest, the tests)
 * read this instead: the same layout code the browser runs, on the shipped files.
 *
 * It writes nothing. It prints one JSON object to stdout:
 * { "<five-digit code>": { "file": "prf/<state>/<county>.json", "html": "..." } }
 *
 *   node scripts/prf_county_views.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { guard } from './_argguard.mjs'; guard(import.meta.url);

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);

export function views(root = ROOT) {
  const C = require(path.join(root, 'components/prf-county.js'));
  const out = {};
  const top = path.join(root, 'prf');
  for (const st of fs.readdirSync(top).sort()) {
    const dir = path.join(top, st);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir).sort()) {
      if (!f.endsWith('.json')) continue;
      const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      out[d.fips] = { file: `prf/${st}/${f}`, html: C.render(d) };
    }
  }
  return out;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(JSON.stringify(views()));
}
