/* "Only on AGSIST" (scripts/daily_edge.py, components/daily-edge.js): the
 * hand-worked fact math and refusal rules live in the script's --selftest;
 * this runs it, holds the page renderer equal to the archive renderer, and
 * checks the generator, email, schema and workflow carry the block. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createRequire } from "node:module";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const py = (args, input) => execFileSync("python3", args, { cwd: ROOT, encoding: "utf8", input });
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const EDGE = {
  label: "Only on AGSIST", generated: "2026-10-16T10:30:00Z",
  facts: [
    { id: "cash_change_corn", sentence: "On Thursday, Oct 15, 617 of the 1,455 elevators AGSIST reads posted a lower cash corn bid than Wednesday, 81 a higher one; 144 changed their basis, 65 weaker and 79 stronger.",
      key: "617 of the 1,455 elevators", detail: "757 unchanged. Median change 0¢: Thursday's last posted bid against Wednesday's.", url: "/cash-bids" },
    { id: "basis_spread_corn", sentence: "Corn basis on Oct 16 ran from 55¢ over December futures in Texas to 80¢ under in North Dakota & South Dakota, \"state\" medians.",
      key: "55¢ over December futures", detail: "", url: "/basis" },
    { id: "x", sentence: "No link here.", key: "missing", url: "https://evil.example/" },
    { id: "y", sentence: "Fourth fact never shows.", key: "Fourth", url: "/basis" },
  ],
};

test("selftest: fact math, refusal rules and the CCA note", () => {
  assert.match(py(["scripts/daily_edge.py", "--selftest"]), /daily_edge selftest ok/);
});

test("the /daily renderer draws exactly what the archive page draws", () => {
  const js = require(join(ROOT, "components/daily-edge.js"));
  const pyHtml = py(["-c", "import sys,json;sys.path.insert(0,'scripts');import daily_edge as d;e=json.load(sys.stdin);print(d.render_html(e,'2026-10-16')+'|'+d.render_note_html({'text':'Basis is the story.'})+'|'+d.CSS,end='')"], JSON.stringify(EDGE));
  const [ph, pn, pc] = pyHtml.split("|");
  assert.equal(js.html(EDGE, "2026-10-16"), ph);
  assert.equal(js.note({ text: "Basis is the story." }), pn);
  assert.equal(js.CSS, pc);
  assert.ok(ph.includes('<a href="/cash-bids">617 of the 1,455 elevators</a>'), "the key number links to its page");
  assert.ok(!ph.includes("evil.example") && !ph.includes("Fourth fact"), "off-site links never drawn; three facts at most");
  assert.ok(ph.includes("agsist.com/daily/2026-10-16"), "how to cite, with the date");
  assert.equal(js.html(null), "");
  assert.equal(js.html({ facts: [] }), "");
  assert.equal(js.note({ text: "  " }), "");
});

test("generator attaches the block, the archive page and NewsArticle carry it", () => {
  const out = py(["-c", `
import sys,json;sys.path.insert(0,'scripts')
import generate_daily as g
b=json.load(open('test/fixtures/daily/2026-10-16-first-publish.json'))
b['edge']=json.loads(sys.stdin.read())
h=g.generate_archive_html(b,'2026-10-16',None,None)
print(json.dumps({'block':'class="dv3-edge"' in h,'ld':'617 of the 1,455 elevators AGSIST reads' in h.split('application/ld+json')[1],
 'local':'data-daily-local' in h and '/components/daily-local.js' in h,
 'order':h.index('class="dv3-edge"')<h.index('class="dv3-sections"')}))
b.pop('edge')
h=g.generate_archive_html(b,'2026-10-16',None,None)
print(json.dumps({'none':'class="dv3-edge"' not in h}))`], JSON.stringify(EDGE)).trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(out[0], { block: true, ld: true, local: true, order: true });
  assert.deepEqual(out[1], { none: true });
});

test("wiring: workflow, schema, email, /daily", () => {
  const wf = read(".github/workflows/daily.yml");
  assert.ok(wf.indexOf("python scripts/daily_edge.py\n") < wf.indexOf("python scripts/generate_daily.py"), "facts built before the draft");
  assert.match(wf, /git add data\/daily\.json data\/daily-edge\.json/);
  assert.match(read("scripts/daily_schema.py"), /"edge",/);
  assert.match(read("scripts/daily_schema.py"), /"cca_note",/);
  const em = read("scripts/brief_email.py");
  assert.match(em, /L \+= edge_text\(daily\)/);
  assert.match(em, /_edge = edge_html\(daily\)/);
  const d = read("daily.html");
  assert.match(d, /\/components\/daily-edge\.js\?v=1/);
  assert.match(d, /lead\+edgeH\+hclock/);
  const note = JSON.parse(read("data/cca-note.json"));
  assert.equal(note.text, "", "the note ships empty: the slot stays hidden until Sig writes one");
});

test("no em dashes and no record claims in the new files", () => {
  for (const f of ["scripts/daily_edge.py", "components/daily-edge.js", "components/daily-local.js", "data/cca-note.json"]) {
    assert.ok(!read(f).includes("—"), f);
  }
  const blk = JSON.parse(read("data/daily-edge.json"));
  for (const f of blk.facts) assert.ok(!/\b(first|record|ever)\b/i.test(f.sentence + " " + f.detail), f.sentence);
});
