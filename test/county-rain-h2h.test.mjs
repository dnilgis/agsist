/* County rain pages, the 2026-10-15 head-to-head fixes.
 *
 *   1. The Rain Print caption says "Light blue is snow" only when the print
 *      on that page really draws snow: the engine's own rule (components/
 *      rain-print.js derive(): a snowfall record on nearly every reported day
 *      and at least 0.1 in of snow). It used to say it whenever the station
 *      sent any snowfall field at all.
 *   2. No page claims "rebuilt every Monday": runs also happen in between
 *      (a page read on a Thursday said Monday).
 *
 * Checks every shipped county page against the shipped daily files.
 *
 *   node --test test/county-rain-h2h.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const ctx = { window: undefined };
ctx.window = ctx;
vm.createContext(ctx);
for (const f of ["components/rain-print.js", "components/rain-county-print.js"]) vm.runInContext(readFileSync(ROOT + f, "utf8"), ctx, { filename: f });
const { daysOf } = ctx.AgRainCountyPrint;
const RP = ctx.RainPrint;

function* countyPages() {
  const top = join(ROOT, "rain");
  if (!existsSync(top)) return;
  for (const st of readdirSync(top, { withFileTypes: true })) {
    if (!st.isDirectory()) continue;
    for (const f of readdirSync(join(top, st.name))) if (f.endsWith(".html")) yield join(top, st.name, f);
  }
}

test("'Light blue is snow' appears exactly where the print draws snow", () => {
  const daily = {};
  let n = 0, said = 0, drawn = 0;
  for (const p of countyPages()) {
    const html = readFileSync(p, "utf8");
    const m = /id="rc-print" data-st="([a-z]{2})" data-fips="(\d+)" data-year="(\d+)"/.exec(html);
    if (!m) continue;
    const [, st, fips, year] = m;
    daily[st] ??= JSON.parse(readFileSync(join(ROOT, "data/rain/daily", st + ".json"), "utf8"));
    const rec = daily[st].counties[fips];
    assert.ok(rec, `${p}: no daily record`);
    const d = RP.derive(daysOf(RP, +year, rec));
    const says = html.includes("Light blue is snow");
    assert.equal(says, d.snow != null, `${p.slice(ROOT.length)}: caption says snow=${says}, print draws snow=${d.snow}`);
    n++; if (says) said++; if (d.snow != null) drawn++;
  }
  if (n) assert.ok(n > 100, "checked the county pages");
});

test("no rain page says it is rebuilt every Monday", () => {
  const files = [join(ROOT, "rain.html"), ...countyPages()];
  for (const top of readdirSync(join(ROOT, "rain"))) if (top.endsWith(".html")) files.push(join(ROOT, "rain", top));
  for (const f of files) {
    if (!existsSync(f)) continue;
    assert.doesNotMatch(readFileSync(f, "utf8"), /every Monday/, f.slice(ROOT.length));
  }
});
