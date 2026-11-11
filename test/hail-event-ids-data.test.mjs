/* The events files the monthly hail run writes: every record carries an id,
 * ids are unique across years, no exact duplicate points (the rule in
 * scripts/fetch_hail.py finish_events; fixtures in test/hail-event-ids.test.mjs).
 *
 *   node --test test/hail-event-ids-data.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

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
