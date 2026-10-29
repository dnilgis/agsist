// Shared guard so a script never does work when asked for --help.
// A script calls guard(import.meta.url) as its first statement after the imports.
// When the script is the one being run (not imported by a test):
//   -h / --help   print the script's usage (its top comment) and exit 0.
//   unknown flag  a dash argument that does not appear as a quoted string in the
//                 script's own source exits 2 with one short line.
// Real arguments are untouched: any flag the script names in quotes passes, and
// positional arguments are never checked.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ARG = /^-{1,2}[A-Za-z][\w-]*(=.*)?$/;

export function guard(metaUrl, argv = null) {
  const file = fileURLToPath(metaUrl);
  const args = argv || process.argv.slice(2);
  if (!argv) {
    let main = '';
    try { main = fs.realpathSync(process.argv[1] || ''); } catch { return; }
    if (main !== fs.realpathSync(file)) return; // imported, not run
  }
  const flags = args.filter(a => ARG.test(a));
  if (!flags.length) return;
  const src = fs.readFileSync(file, 'utf8');
  const name = path.basename(file);
  if (flags.some(a => a === '-h' || a === '--help')) {
    const lines = [];
    for (const line of src.split('\n').slice(src.startsWith('#!') ? 1 : 0)) {
      const t = line.trim();
      if (t.startsWith('//')) lines.push(t.replace(/^\/\/+\s?/, ''));
      else if (t.startsWith('/*') || t.startsWith('*')) lines.push(t.replace(/^\/?\*+\/?\s?/, '').replace(/\*\/$/, ''));
      else if (lines.length || t) break;
    }
    console.log('usage: ' + name + ' [-h]');
    if (lines.length) console.log('\n' + lines.slice(0, 40).join('\n').trim());
    process.exit(0);
  }
  if (/["'`]--?["'`]\s*\+|`--?\$\{/.test(src)) return; // flag names built at run time: only --help is guarded
  const known = new Set([...src.matchAll(/["'`](-{1,2}[A-Za-z][\w-]*)/g)].map(m => m[1]));
  for (const a of flags) {
    const k = a.split('=')[0];
    if (!known.has(k)) { console.error(name + ': unknown option ' + k + ' (try --help)'); process.exit(2); }
  }
}
