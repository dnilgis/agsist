/* scripts/rain_print_examples_pack.mjs: the station's full history (StnData
 * sdate=por, every day the station has kept, often 50,000 rows) kept small in
 * data/rain-print-examples/<slug>.json, and given back exactly as NOAA sent it.
 *
 * NOAA answers the por call with { meta: {...}, data: [[date, v1, v2, ...], ...] },
 * one row a day with no day skipped. pack() keeps the first date and each
 * column as one space-joined line, gzipped and in base64 (about 3 bytes a day
 * instead of 29), and everything else in the answer (the station's meta) as it
 * came, in the same key order. It packs only an answer it can give back
 * unchanged (rows of strings with no spaces, one a day in order): unpack()
 * rebuilds it, and pack() checks the rebuilt answer is the same JSON.
 *
 * A saved request is { url, status, body } or, for a packed answer,
 * { url, status, pack: { keys, rest, from, days, cols, gz } }. answerOf(request) is the
 * answer either way.
 */
import { gzipSync, gunzipSync } from "node:zlib";

const DAY = 86400000;
const iso = (t) => new Date(t).toISOString().slice(0, 10);

export function pack(body) {
  if (!body || typeof body !== "object" || Array.isArray(body) || !Array.isArray(body.data) || !body.data.length) return null;
  const keys = Object.keys(body), rest = {};
  for (const k of keys) if (k !== "data") rest[k] = body[k];
  const rows = body.data, cols = rows[0].length;
  if (cols < 2) return null;
  const t0 = Date.parse(rows[0][0] + "T00:00:00Z");
  if (!(t0 > -1e15)) return null;
  const lines = [];
  for (let c = 1; c < cols; c++) lines.push([]);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!Array.isArray(r) || r.length !== cols || r[0] !== iso(t0 + i * DAY)) return null;
    for (let c = 1; c < cols; c++) {
      if (typeof r[c] !== "string" || r[c] === "" || /\s/.test(r[c])) return null;
      lines[c - 1].push(r[c]);
    }
  }
  const p = { keys, rest, from: rows[0][0], days: rows.length, cols: cols - 1,
    gz: gzipSync(lines.map((l) => l.join(" ")).join("\n"), { level: 9 }).toString("base64") };
  // only what comes back the same is kept packed
  return JSON.stringify(unpack(p)) === JSON.stringify(body) ? p : null;
}

export function unpack(p) {
  const lines = gunzipSync(Buffer.from(p.gz, "base64")).toString("utf8").split("\n").map((l) => l.split(" "));
  if (lines.length !== p.cols || lines.some((l) => l.length !== p.days)) throw new Error("packed history doesn't match its own count");
  const t0 = Date.parse(p.from + "T00:00:00Z"), data = [];
  for (let i = 0; i < p.days; i++) data.push([iso(t0 + i * DAY)].concat(lines.map((l) => l[i])));
  const out = {};
  for (const k of p.keys || ["data"]) out[k] = k === "data" ? data : p.rest[k];
  return out;
}

export const answerOf = (q) => (q.pack ? unpack(q.pack) : q.body);
