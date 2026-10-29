/* Trust contradictions (credibility panel, read 2026-10-25). Each block is a
 * phrase a reader found on one page that another page, or the page itself,
 * contradicted. The rule each block holds to is named beside it; the phrases
 * must not come back anywhere a reader can see them (pages, the components
 * that write into them, the scripts that bake them). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const list = (dir, re) => readdirSync(join(ROOT, dir)).filter((f) => re.test(f)).map((f) => (dir === "." ? f : dir + "/" + f));
/* every top-level page, every component, every page-writing script (not the Daily archive:
   "live futures" there means live cattle futures) */
const SURFACE = [...list(".", /\.html$/), ...list("components", /\.js$/),
  ...list("scripts", /^(?!test_).*\.(py|mjs)$/)];

function hits(re, files = SURFACE) {
  const out = [];
  for (const f of files) {
    if (!existsSync(join(ROOT, f))) continue;
    const s = read(f);
    const m = s.match(re);
    if (m) out.push(f + ": " + m[0]);
  }
  return out;
}

/* 1. Market timing. /editorial-standards#sources is the rule (it was /data-sources until Oct 29, 2026): Yahoo lists CBOT and CME at a 10-minute
   exchange delay, AGSIST fetches about every 15 minutes, so a grain or livestock price
   is about 10 to 25 minutes old while markets trade. Not "live", not "at least 15". */
test("no page calls the futures live or puts the delay at 15 minutes", () => {
  const ds = read("editorial-standards.html");
  assert.match(ds, /10-minute exchange delay/);
  assert.match(ds, /about 10 to 25 minutes old while markets trade/);
  const bad = /Live futures across|Prices are not live|delayed (?:a )?minimum of 15|at least 15 minutes old|15[- ]min(?:ute)? delayed|about 15 minutes delayed|delayed about 15 minutes|Delayed 15 min/i;
  assert.deepEqual(hits(bad), []);
  assert.match(read("about.html"), /about 10 to 25 minutes old while markets trade/);
  const terms = read("terms.html");
  assert.match(terms, /10-minute exchange delay/);
  assert.match(terms, /about 10 to 25 minutes old/);
  assert.match(terms, /time of its quote/);
});

/* 2. What's Priced In grades on the distance from the trade AVERAGE (bands per kind of
   number); the survey's low and high are context. The methods paragraph once called the
   surprise thresholds "the edges of the trade range", a second definition. And the
   "No report data yet" box sat in the page text (hidden by CSS) beside the results; it is
   written only when the data really is a sample. */
test("What's Priced In has one grading definition and no empty-state text beside results", () => {
  // What's priced in is a section of /usda-calendar since the Oct 22 merges (scripts/moved_pages.py); its script is components/priced-in.js
  const h = read("usda-calendar.html"), pj = read("components/priced-in.js");
  assert.ok(!/edges of the trade range|ends of the trade range/.test(pj), "a second, range-edge definition in the script");
  assert.ok(!/edges of the trade range|ends of the trade range/.test(h), "a second, range-edge definition of the thresholds");
  assert.match(h, /surprise thresholds<\/b> on the report card are the trade average minus and plus that same band/);
  assert.match(h, /<div class="wp-sample" id="wp-sample"><\/div>/, "the sample box is empty in the page text");
  const visible = h.replace(/<script[\s\S]*?<\/script>/g, "");
  assert.ok(!/No report data yet/.test(visible), "No report data yet is in the page text");
  assert.match(pj, /if\(d\.sample\)\{var ws=document\.getElementById\('wp-sample'\);ws\.textContent='No report data yet/);
});

/* 3. Privacy. The summary must not promise more than the details: coordinates, ZIPs and
   towns go to outside services, and a signup is stored on the server with what it watches
   (a hail alert keeps the pinned spot). And each alert type says how often it can mail,
   as the worker and senders behave: the futures price alert and the elevator cash alert
   fire once (workers/subs-worker.js price-watch-mark fired, kind cash one-shot); the basis
   watch (kind move) and the ZIP crossing (ewid "ab"+ZIP+miles, re-armed by
   scripts/send_zip_alert.py) can repeat. Before, one row said "An alert fires once". */
test("privacy summary matches the details, and each alert type has its own row", () => {
  const P = read("privacy.html");
  const sum = P.match(/<div class="tldr">([\s\S]*?)<\/div>/)[1];
  assert.ok(!/stays in your browser|stays on your device|never leaves/i.test(sum), "the summary says location stays in the browser");
  assert.match(sum, /send the place you ask about \(your browser&rsquo;s location, a ZIP code or a town\) to the outside services/);
  assert.match(sum, /stored on AGSIST&rsquo;s server with what you asked to watch \(for a hail alert, the spot you pinned\)/);
  assert.ok(!/<strong>Price alerts<\/strong>: [^<]*An alert fires once/.test(P), "one row for every alert type again");
  for (const [name, how] of [["Futures price alert", /It fires once/], ["Elevator cash alert", /It fires once/],
    ["Elevator basis watch", /each new posting that changes the posted basis/], ["Nearby price crossing", /so it can repeat/],
    ["Hail alerts", /so it can repeat/]]) {
    const row = P.match(new RegExp("<li><strong>" + name + "</strong>[^\\n]*</li>"));
    assert.ok(row, name + " has no row");
    assert.match(row[0], how, name);
  }
  // the behavior the rows describe
  const W = read("workers/subs-worker.js");
  assert.match(W, /one-shot: the sender already mailed the hit, so the alert never re-arms/);
  assert.match(W, /a ZIP-wide alert \(ewid "ab" \+ ZIP \+ miles\) re-arms/);
  assert.match(read("scripts/send_zip_alert.py"), /a ZIP alert re-arms; it is never removed by a send/);
});

/* 4. ARC/PLC printed "Pick PLC" / "Pick ARC-CO", a recommendation that travels farther
   than its assumptions. The answer is the program expected to pay more on the stated
   assumptions, and the calculator puts those assumptions beside it. */
test("ARC/PLC says which program is expected to pay more, with the assumptions beside it", () => {
  const PICK = /Pick (PLC|ARC-CO)/;
  for (const f of ["arc-plc.html", "components/arc-plc.js", "components/arc-plc-math.js"]) {
    assert.ok(!PICK.test(read(f)), f + " still says Pick");
  }
  // the build's word tables (its selftest labels may keep the old shorthand; they are not printed)
  const py = read("scripts/build_arc_plc.py");
  for (const tbl of ["VWORD", "TIER_HEAD", "SHORT"]) {
    const m = py.match(new RegExp("^" + tbl + " = \\{[^}]*\\}", "m"));
    assert.ok(m, tbl);
    assert.ok(!PICK.test(m[0]), tbl + " still says Pick");
  }
  assert.ok(!/return f"Pick /.test(py), "verdict_line still says Pick");
  for (const st of ["iowa", "texas"]) {
    for (const f of readdirSync(join(ROOT, "arc-plc", st)).slice(0, 40)) assert.ok(!PICK.test(read(`arc-plc/${st}/${f}`)), f);
  }
  const js = read("components/arc-plc.js");
  assert.match(js, /plc: 'PLC expected to pay more', arc: 'ARC-CO expected to pay more'/);
  assert.match(js, /<p class="ap-small ap-assume">On these assumptions: prices centered at /);
  assert.match(read("components/arc-plc-math.js"), /plc: 'PLC expected to pay more', arc: 'ARC-CO expected to pay more'/);
  assert.match(read("scripts/build_arc_plc.py"), /VWORD = \{"plc": "PLC expected to pay more", "arc": "ARC-CO expected to pay more"/);
});

/* 5. Cash bids. "Total Net" and the FAQ's "The top one pays you the most" claimed more
   than the math does: the net is the load at the posted bid minus the round-trip hauling
   cost the reader entered. Discounts, shrink, waits and delivery terms are not in it. */
test("cash bids net is limited to the hauling cost the reader entered", () => {
  const h = read("cash-bids.html"), js = read("components/cash-bids.js");
  assert.ok(!/pays you the most/.test(h), "the FAQ says the top one pays you the most");
  assert.ok(!/>Total Net</.test(h) && !/data-l="Total net"/.test(js), "Total Net is back");
  assert.equal((h.match(/The top one nets the most after the hauling cost you entered\. Discounts, shrink, waits and delivery terms are not in that number/g) || []).length, 2,
    "the FAQ and its structured-data copy say the same");
  assert.match(h, />Net after hauling<\/th>/);
  assert.match(js, /after round-trip hauling at the \$'\+fpm\.toFixed\(2\)\+' a mile you entered/);
  assert.match(js, /Discounts, shrink and delivery terms are not counted: call to confirm before you haul\./);
  assert.match(h, /components\/cash-bids\.js\?v=16/);   // 16: fx/quickwins (posted date beside an old price); 15: fx/bidflags; 14 was fx/smallfixes
});
