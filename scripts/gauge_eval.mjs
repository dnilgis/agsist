#!/usr/bin/env node
/* Score the /gauge-lab reader on the synthetic photos from scripts/gauge_synth.py.
 *
 *   python3 scripts/gauge_synth.py /tmp/gauge-cases
 *   node scripts/gauge_eval.mjs /tmp/gauge-cases
 *
 * Runs components/gauge-read.js (the file the page loads) on each case_NN.ppm
 * and prints the error in inches of rain, the mean absolute error, and the
 * failures. Reads files only.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const dir = process.argv[2];
if (!dir) { console.log("usage: node scripts/gauge_eval.mjs CASE_DIR"); process.exit(2); }

const ctx = {}; ctx.window = ctx;
vm.runInNewContext(readFileSync(ROOT + "components/gauge-read.js", "utf8"), ctx);
const G = ctx.GaugeRead;
const spec = JSON.parse(readFileSync(ROOT + "data/gauge-strip.json", "utf8"));

export function readPPM(buf) {
  let pos = 0;
  const tok = () => {
    while (/\s/.test(String.fromCharCode(buf[pos]))) pos++;
    let s = "";
    while (!/\s/.test(String.fromCharCode(buf[pos]))) s += String.fromCharCode(buf[pos++]);
    return s;
  };
  if (tok() !== "P6") throw new Error("not a P6 ppm");
  const w = +tok(), h = +tok(); tok(); pos++;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0, p = pos; i < w * h; i++, p += 3) {
    data[i * 4] = buf[p]; data[i * 4 + 1] = buf[p + 1]; data[i * 4 + 2] = buf[p + 2]; data[i * 4 + 3] = 255;
  }
  return { width: w, height: h, data };
}

const truth = JSON.parse(readFileSync(dir + "/truth.json", "utf8"));
const rows = [];
for (const c of truth) {
  const img = readPPM(readFileSync(`${dir}/${c.name}.ppm`));
  const t0 = Date.now();
  const r = G.read(img, spec);
  const ms = Date.now() - t0;
  rows.push({ ...c, ok: r.ok, got: r.ok ? r.rain : null, code: r.code || "", method: r.method || "", ms,
    err: r.ok ? Math.round((r.rain - c.rain) * 100) / 100 : null,
    tubeErr: r.ok ? r.levelIn - c.rain * spec.ratio : null });
}
const pad = (s, n) => String(s).padEnd(n);
console.log(pad("case", 9) + pad("kind", 10) + pad("truth", 7) + pad("read", 7) + pad("err", 7) + pad("how", 10) + pad("tube err", 10) + "ms");
for (const r of rows) {
  console.log(pad(r.name, 9) + pad(r.kind, 10) + pad(r.rain.toFixed(2), 7) +
    pad(r.ok ? r.got.toFixed(2) : "-", 7) + pad(r.ok ? r.err.toFixed(2) : r.code, 7) + pad(r.method, 10) + pad(r.ok ? r.tubeErr.toFixed(3) : "", 10) + r.ms);
}
function summary(label, set) {
  const read = set.filter((r) => r.ok);
  const mae = read.length ? read.reduce((s, r) => s + Math.abs(r.err), 0) / read.length : NaN;
  const within = read.filter((r) => Math.abs(r.err) <= 0.02 + 1e-9).length;
  const worst = read.reduce((m, r) => Math.max(m, Math.abs(r.err)), 0);
  const tmae = read.length ? read.reduce((s, r) => s + Math.abs(r.tubeErr), 0) / read.length : NaN;
  console.log(`${label}: ${set.length} cases, ${read.length} read, ${set.length - read.length} failed, ` +
    `MAE ${mae.toFixed(4)} in, within 0.02 in: ${within}/${read.length}, worst ${worst.toFixed(2)} in; ` +
    `level error before rounding ${(tmae / spec.ratio).toFixed(4)} in of rain`);
}
summary("normal", rows.filter((r) => r.kind === "normal"));
summary("hard (small, steep, dark, blurry)", rows.filter((r) => ["small", "steep", "dark", "blurry"].includes(r.kind)));
summary("stress (weak stripe, glare, small, heavy blur and noise)", rows.filter((r) => r.kind === "stress"));
const shouldFail = rows.filter((r) => r.expect === "fail");
console.log(`should fail (cropped, sideways): ${shouldFail.filter((r) => !r.ok).length}/${shouldFail.length} failed with: ${shouldFail.map((r) => r.code || "read " + r.got).join(", ")}`);
