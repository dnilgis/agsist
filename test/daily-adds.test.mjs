/* The Daily's two small additions: the week / month / year price change under
 * the quote strip, and the USDA weather lines. Both fail soft. Fixtures only:
 * no network, no archive reads outside a temp folder. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const py = (code) => JSON.parse(execFileSync("python3", ["-I", "-c", `import sys,json;sys.path.insert(0,${JSON.stringify(ROOT + "scripts")})\n${code}`], { encoding: "utf8" }));

function archive(days) {
  const dir = mkdtempSync(join(tmpdir(), "adds-"));
  for (const [d, ch] of Object.entries(days)) writeFileSync(join(dir, d + ".json"), JSON.stringify({ locked_changes: ch }));
  return dir;
}
const C = (prev, prev_date) => ({ prev, prev_date });
const Q = [{ key: "corn-dec", name: "Corn", last: 4.5 }, { key: "beans-nov", name: "Soybeans", last: 12.0 }, { key: "wheat", name: "Wheat", last: 6.0 }];
const run = (dir, today, ch) => py(`import daily_adds as a\nprint(json.dumps(a.price_windows(${JSON.stringify(today)}, ${JSON.stringify(Q)}, ${JSON.stringify(ch)}, ${JSON.stringify(dir)})))`);

test("week and month windows use the close just before the window", () => {
  const dir = archive({
    "2026-11-02": { "corn-dec": C(4.4, "2026-10-30"), "beans-nov": C(12.1, "2026-10-30"), wheat: C(6.1, "2026-10-30") },
    "2026-11-03": { "corn-dec": C(4.45, "2026-11-02"), "beans-nov": C(12.05, "2026-11-02"), wheat: C(6.05, "2026-11-02") },
  });
  const out = run(dir, "2026-11-04", { "corn-dec": C(4.48, "2026-11-03"), "beans-nov": C(12.0, "2026-11-03"), wheat: C(6.0, "2026-11-03") });
  const w = Object.fromEntries(out.map((x) => [x.label, x.items]));
  // no year window: the archive does not reach back. No month row either: November began on a Sunday, so month to
  // date equals week so far and is left out (Daily panel, Nov 9 2026: Nov 7 and 8 printed both rows the same)
  assert.deepEqual(Object.keys(w), ["Week so far"], "no year window, and no month row equal to the week row");
  assert.equal(w["Week so far"].find((i) => i.name === "Corn").text, "+10¢ (+2.27%)");
  assert.ok(w["Week so far"].find((i) => i.name === "Soybeans").text.startsWith("−10¢"));
  assert.ok(!w["Week so far"].some((i) => i.name === "Wheat"), "wheat is held back until its stored closes are one contract");
});

test("month to date prints when it differs from week so far", () => {
  const dir = archive({
    "2026-11-09": { "corn-dec": C(4.4, "2026-11-06") },
    "2026-11-10": { "corn-dec": C(4.45, "2026-11-09") },
  });
  const out = run(dir, "2026-11-11", { "corn-dec": C(4.48, "2026-11-10") }).map((x) => x.label);
  assert.deepEqual(out, ["Week so far"], "the archive does not reach back to Oct 30, so no month baseline");
  const dir2 = archive({
    "2026-11-02": { "corn-dec": C(4.3, "2026-10-30") },
    "2026-11-09": { "corn-dec": C(4.4, "2026-11-06") },
    "2026-11-10": { "corn-dec": C(4.45, "2026-11-09") },
  });
  const out2 = run(dir2, "2026-11-11", { "corn-dec": C(4.48, "2026-11-10") });
  assert.deepEqual(out2.map((x) => x.label), ["Week so far", "Month to date"], "different baselines: both rows print");
});

test("a gap in the stored issues leaves the window out", () => {
  const dir = archive({ "2026-11-03": { "corn-dec": C(4.45, "2026-11-02") } });
  const out = run(dir, "2026-11-04", { "corn-dec": C(4.48, "2026-11-03") });
  assert.deepEqual(out, [], "first stored issue of the week has a prior close inside the week");
});

test("the first issue of a week gives no week line", () => {
  const dir = archive({ "2026-10-30": { "corn-dec": C(4.4, "2026-10-29") } });
  const out = run(dir, "2026-11-02", { "corn-dec": C(4.41, "2026-10-30") });
  assert.ok(!out.some((x) => x.label === "Week so far"));
  assert.ok(out.some((x) => x.label === "Month to date"));
});

test("USDA weather: first sentences, named, and soft when unreadable", () => {
  const page = "<html><body><h1>AGRICULTURAL WEATHER HIGHLIGHTS</h1>\n\n<p>Showers and thunderstorms crossed the central Corn Belt on Wednesday, slowing the last of the harvest. Temperatures ran near normal across the Plains. Dry weather returned to the Delta. A fourth sentence that should not appear.</p></body></html>";
  const r = py(`import daily_adds as a\npage=${JSON.stringify(page)}\nprint(json.dumps([a.ag_weather(lambda u: page, today_iso="2026-11-05"), a.ag_weather(lambda u: None), a.ag_weather(lambda u: "%PDF-1.4 junk"), a.ag_weather(lambda u: 1/0)]))`);
  assert.match(r[0].text, /^Showers and thunderstorms.*Delta\.$/);
  assert.ok(!/fourth/.test(r[0].text));
  assert.match(r[0].source, /USDA/);
  assert.deepEqual(r.slice(1), [null, null, null]);
});

test("the archive page and the live page both draw the added lines", () => {
  const issue = { price_windows: [{ label: "Week so far", items: [{ name: "Corn", text: "+10¢ (+2.27%)" }] }], ag_weather: { text: "Dry in the Delta. Mild in the Plains.", source: "USDA Office of the Chief Economist, agricultural weather highlights" } };
  const html = py(`import generate_daily as g\nprint(json.dumps(g.render_adds_html(json.loads(${JSON.stringify(JSON.stringify(issue))}))))`);
  assert.match(html, /Week so far:<\/strong> Corn \+10¢/);
  assert.match(html, /USDA weather:<\/strong> Dry in the Delta/);
  assert.ok(!/href=/.test(html), "the source is named, never linked");
  assert.equal(py(`import generate_daily as g\nprint(json.dumps(g.render_adds_html({})))`), "");
  const live = readFileSync(ROOT + "daily.html", "utf8");
  assert.ok(live.includes("data.price_windows") && live.includes("data.ag_weather"));
});

test("the weather line never prints an error or landing page", () => {
  const r = execFileSync("python3", ["-c", `
import sys; sys.path.insert(0, "scripts")
import daily_adds as d
nf = "<html><body><h1>Page Not Found</h1><p>The page you requested could not be found on this server. Please check the address and try again. You may also return to the home page and search.</p></body></html>"
land = "<html><body><p>Welcome to the Office of the Chief Economist. We provide economic analysis to the Secretary. Our staff supports policy decisions across the department every day.</p></body></html>"
wx = "AGRICULTURAL WEATHER HIGHLIGHTS\\n\\nIn the Corn Belt, rain showers are slowing harvest across the eastern half of the region. Temperatures remain near normal for early November. Fieldwork resumes where it is dry."
print(d.ag_weather(lambda u: nf) is None, d.ag_weather(lambda u: land) is None, bool(d.ag_weather(lambda u: wx)))
`], { cwd: ROOT, encoding: "utf8" }).trim();
  assert.equal(r, "True True True");
});
