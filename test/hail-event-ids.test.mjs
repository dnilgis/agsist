/* Every hail report in data/hail/events-YYYY.json carries a stable id, and
 * exact duplicate points are removed and counted (Nov 10, 2026; god's-eye
 * status "a storm id"). IEM's storm report CSV has no id column, so the id is
 * built from the storm day, state, position to 2 decimals and size. The real
 * case: events-2026.json listed the 0.75 inch report at 35.37 -97.55,
 * Oklahoma, Jan 8 twice (426 such repeats in 2026).
 *
 *   node --test test/hail-event-ids.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

function py(code) {
  const pre = "import sys, json; sys.path.insert(0, 'scripts'); sys.dont_write_bytecode = True\n";
  return JSON.parse(execFileSync("python3", ["-c", pre + code], { cwd: ROOT, encoding: "utf8" }));
}

// The two Oklahoma rows as IEM sends them (same storm day, place and size),
// plus a different size at the same spot and a report the next storm day.
const ROWS = `[
  {"valid": "202601082105", "typetext": "HAIL", "mag": "0.75", "lat": "35.3712", "lon": "-97.5498", "state": "OK"},
  {"valid": "202601082105", "typetext": "HAIL", "mag": "0.75", "lat": "35.3712", "lon": "-97.5498", "state": "OK"},
  {"valid": "202601082110", "typetext": "HAIL", "mag": "1.00", "lat": "35.3700", "lon": "-97.5500", "state": "OK"},
  {"valid": "202601091300", "typetext": "HAIL", "mag": "0.75", "lat": "35.3712", "lon": "-97.5498", "state": "OK"},
  {"valid": "202601082200", "typetext": "HAIL", "mag": "", "lat": "35.37", "lon": "-97.55", "state": "OK"}
]`;

test("the Oklahoma Jan 8 duplicate is kept once and counted; other sizes and days stay", () => {
  const out = py(`
import fetch_hail as fh
rows = json.loads('''${ROWS}''')
ev, removed = fh.events_year_counted(rows, 2026)
print(json.dumps({"ev": ev, "removed": removed, "plain": fh.events_year(rows, 2026)}))
`);
  assert.equal(out.removed, 1);
  assert.equal(out.ev.length, 4);
  const ok = out.ev.filter((e) => e[0] === 35.37 && e[1] === -97.55 && e[2] === 0.75 && e[3] === "01-08");
  assert.equal(ok.length, 1, "the duplicate point is listed once");
  assert.deepEqual(out.plain, out.ev, "events_year returns the same records");
  for (const e of out.ev) {
    assert.equal(e.length, 6, "five original fields plus the id");
    assert.match(e[5], /^[0-9a-f]{10}$/);
  }
  assert.equal(new Set(out.ev.map((e) => e[5])).size, 4, "ids are unique");
  // an unmeasured size is its own report, not a duplicate of the 0.75
  assert.ok(out.ev.some((e) => e[2] === null && e[3] === "01-08"));
});

test("a re-run gives the same ids: other row order, and a second pass over finished records", () => {
  const out = py(`
import fetch_hail as fh
rows = json.loads('''${ROWS}''')
a = fh.events_year(rows, 2026)
b = fh.events_year(list(reversed(rows)), 2026)
again, removed_again = fh.finish_events(a, 2026)
print(json.dumps({"a": {e[5]: e[:5] for e in a}, "b": {e[5]: e[:5] for e in b},
                  "again": again, "first": a, "removed_again": removed_again,
                  "key": fh.event_key(2026, [35.37, -97.55, 0.75, "01-08", "OK"])}))
`);
  assert.deepEqual(out.a, out.b, "row order does not change an id");
  assert.deepEqual(out.again, out.first, "a second pass changes nothing");
  assert.equal(out.removed_again, 0);
  assert.equal(out.key, "2026-01-08|OK|35.37|-97.55|0.75");
});

test("two keys that share the short id both get the long form, whatever the order", () => {
  const out = py(`
import fetch_hail as fh, hashlib
fh.EVENT_ID_HEX = 1          # force a shared short form
ev = [[35.0 + i / 100, -97.0, 1.0, "05-01", "OK"] for i in range(40)]
a, _ = fh.finish_events(ev, 2026)
b, _ = fh.finish_events(list(reversed(ev)), 2026)
print(json.dumps({"a": sorted(e[5] for e in a), "b": sorted(e[5] for e in b), "lens": sorted({len(e[5]) for e in a})}))
`);
  assert.deepEqual(out.a, out.b);
  assert.ok(out.lens.includes(16), "colliding ids are lengthened");
  assert.equal(new Set(out.a).size, 40);
});

test("--ids is a flag the script reads (the argument guard passes it)", () => {
  const src = readFileSync(ROOT + "scripts/fetch_hail.py", "utf8");
  assert.match(src, /"--ids" in sys\.argv/);
  assert.match(src, /write_events\(y, ev, removed\)/, "the monthly fetch writes ids and the count too");
});

// The rule, checked over whatever the monthly run last wrote: no state of the
// data is pinned, only what the builder guarantees for any reports.
test("every events file on disk: ids on every record, unique across years, no exact duplicates", () => {
  const files = readdirSync(ROOT + "data/hail").filter((f) => /^events-\d{4}\.json$/.test(f));
  assert.ok(files.length >= 5, `only ${files.length} events files; the files have moved`);
  const ids = new Set();
  let n = 0;
  for (const f of files) {
    const d = JSON.parse(readFileSync(ROOT + "data/hail/" + f, "utf8"));
    const year = +f.slice(7, 11);
    assert.equal(d.n, d.ev.length, `${f}: n matches the records`);
    assert.ok(Number.isInteger(d.dup_removed) && d.dup_removed >= 0, `${f}: dup_removed is a count`);
    assert.ok(d.dup_rule && d.id_rule, `${f}: states its rules`);
    const keys = new Set();
    for (const e of d.ev) {
      n++;
      assert.equal(e.length, 6, `${f}: ${JSON.stringify(e)} has no id`);
      assert.ok(!ids.has(e[5]), `${f}: id ${e[5]} used twice`);
      ids.add(e[5]);
      const k = [year, e[3], e[4], e[0].toFixed(2), e[1].toFixed(2), e[2] == null ? "" : e[2].toFixed(2)].join("|");
      assert.ok(!keys.has(k), `${f}: exact duplicate ${k}`);
      keys.add(k);
    }
  }
  assert.ok(n > 10000, `only ${n} records seen`);
});

test("readers still take fields 0 to 4: the storm-day builder reads records with an id", () => {
  const out = py(`
import generate_hail_events as g
rec = g._new_rec("events-2026.json", "spc-12z")
g._add_report(rec, 35.37, -97.55, 0.75, "OK")
print(json.dumps({"ok": True}))
`);
  assert.equal(out.ok, true);
  const scout = readFileSync(ROOT + "scripts/build_field_scout_data.py", "utf8");
  assert.match(scout, /\[e\[0\], e\[1\], e\[2\], e\[3\], y\]/, "Field Scout cells copy fields 0 to 3, not the whole record");
});
