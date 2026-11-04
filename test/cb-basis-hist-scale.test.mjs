/* Town page basis history (Nov 4, 2026, site panel, viz seat): one scale per town and crop, with axis values.
 *
 * The real case: components/cb-basis-hist.js took the low, the high and the start date per elevator, so a
 * 15-cent swing at one elevator filled the same height as a 30-cent swing at the next, and no chart had a
 * number on its axis. A fixture town with two elevators of different swings (the log's own key format,
 * scripts/build_basis_sparklines.py) is drawn through the page's own render().
 *
 *   node --test test/cb-basis-hist-scale.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const H = require(ROOT + "components/cb-basis-hist.js");

const DATA = {
  generated: "2026-11-04T02:00:00Z",
  series: {
    // 15 cents of swing
    "IA|HEART OF IOWA COOP|NEVADA|corn|ZCZ26|NOV 26": [{ date: "2026-09-02", cents: -30 }, { date: "2026-09-20", cents: -22 }, { date: "2026-10-10", cents: -37 }],
    // 30 cents of swing, starting later
    "IA|LINCOLNWAY ENERGY|NEVADA|corn|ZCZ26|NOV 26": [{ date: "2026-09-15", cents: -20 }, { date: "2026-10-01", cents: -50 }, { date: "2026-10-20", cents: -35 }],
    "IA|HEART OF IOWA COOP|NEVADA|soybeans|ZSX26|NOV 26": [{ date: "2026-09-02", cents: -80 }, { date: "2026-10-02", cents: -70 }],
  },
};
function draw(boards) {
  const body = { innerHTML: "" }, sum = { textContent: "" };
  const box = { getAttribute: (k) => (k === "data-boards" ? JSON.stringify(boards) : null),
    querySelector: (s) => (s === ".cbt-hist-body" ? body : s === "summary" ? sum : null) };
  H.render(box, DATA);
  return body.innerHTML;
}

test("two elevators in one town share one scale and one time span per crop, so a 15-cent swing looks smaller than a 30-cent one", () => {
  const html = draw([["Heart of Iowa Coop", ["Nevada"]], ["Lincolnway Energy", ["Nevada"]]]);
  const labels = [...html.matchAll(/aria-label="Corn basis at ([^"]+)"/g)].map((m) => m[1]);
  assert.equal(labels.length, 2, html);
  for (const l of labels) assert.match(l, /on a scale from −50¢ to −20¢$/);
  // the y positions: both charts use the same cents-to-height rule (y = 8 + (hi - c) * 68 / 30)
  const ys = [...html.matchAll(/<polyline points="([^"]+)"/g)].map((m) => m[1].split(" ").map((p) => +p.split(",")[1]));
  const span = ys.map((v) => Math.max(...v) - Math.min(...v));
  assert.ok(Math.abs(span[0] - 15 * 68 / 30) < 0.2 && Math.abs(span[1] - 30 * 68 / 30) < 0.2, span.join(" "));
  // one time axis: both start at the town's first logged corn date and end at the log's last run
  const xa = [...html.matchAll(/<div class="cbh-xa" aria-hidden="true"><span>([^<]+)<\/span><span>([^<]+)<\/span>/g)].map((m) => m[1] + "|" + m[2]);
  assert.deepEqual(xa.slice(0, 2), ["Sep 2|Nov 4", "Sep 2|Nov 4"]);
  // the axis values print: high, zero only when inside, low
  const ya = [...html.matchAll(/<div class="cbh-ya" aria-hidden="true">(.*?)<\/div>/g)].map((m) => [...m[1].matchAll(/>([^<]+)<\/span>/g)].map((x) => x[1]));
  assert.deepEqual(ya[0], ["−20¢", "−50¢"]);
  assert.match(html, /Every elevator's chart for a crop shares one scale and one time span/);
  // soybeans have their own scale, rounded out to 5 cents
  assert.match(html, /aria-label="Soybeans basis at [^"]+on a scale from −80¢ to −70¢"/);
});

test("the scale rounds out to 5 cents, puts even money on the axis only when it is well inside, and pads a flat line", () => {
  assert.deepEqual(H.scaleFor([[{ date: "2026-09-01", cents: -31 }, { date: "2026-10-01", cents: -18 }]], "2026-11-04"), { lo: -35, hi: -15, d0: "2026-09-01", d1: "2026-11-04" });
  assert.deepEqual(H.scaleFor([[{ date: "2026-09-01", cents: -10 }, { date: "2026-09-05", gap: true, dm: "2026-09" }]], "2026-09-30"), { lo: -15, hi: -5, d0: "2026-09-01", d1: "2026-09-30" });
  assert.equal(H.scaleFor([[{ date: "2026-09-01", gap: true, dm: "2026-09" }]], "2026-09-30"), null);
  const pts = [{ date: "2026-09-01", cents: -20, dm: "2026-11", con: "Dec '26" }, { date: "2026-10-01", cents: 15, dm: "2026-11", con: "Dec '26" }];
  const c = H.chart(pts, "2026-11-04", "x", H.scaleFor([pts], "2026-11-04"));
  assert.match(c, /<span style="top:[\d.]+%">\+15¢<\/span><span style="top:[\d.]+%">even<\/span><span style="top:[\d.]+%">−20¢<\/span>/);
});
