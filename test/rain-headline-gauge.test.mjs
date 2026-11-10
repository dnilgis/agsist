// County rain pages name the gauge, not the county, where a number is one gauge's (Nov 10): the title, the
// og:title, the first lede and the state page's "Most:" line, with the county-wide estimate beside it.
// A SNOTEL mountain snow site never leads a county page; the county-wide estimate does. A dry rank waits
// when the year's missing days could close the gap to the next year. /rain opens on the saved place and
// links the radar ZIP lookup. Real records saved Nov 10, 2026 (test/fixtures/rain-headline/counties.json).
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const PY = String.raw`
import sys, json, copy
sys.path.insert(0, "scripts")
import build_county_rain as B
B.BOOT = B.S.boot()
fx = json.load(open("test/fixtures/rain-headline/counties.json"))
def page(f, ctx=None, c=None):
    v = fx[f]
    return B.county_page({"c": c or v["c"], "st": v["st"], "fips": f, "year": v["d"]["year"], "d": v["d"], "slug": "x", "nbrs": [],
                          "n_ok": v["c"].get("n_ok", 1), "ctx": v["ctx"] if ctx is None else ctx, "edate": v["d"]["edate"]})
out = {f: page(f) for f in fx}
ark = copy.deepcopy(fx["05001"]["ctx"])
ark["rank"]["up"] = 9.0          # wider than three times the usual rain of its 15 missing days
out["ark_wide"] = page("05001", ark)
ark["rank"]["up"] = 1.0
out["ark_narrow"] = page("05001", ark)
out["pondera_nogrid"] = page("30073", {})
def st(fips_list, st_):
    d = dict(fx[fips_list[0]]["d"], counties={f: fx[f]["c"] for f in fips_list})
    return B.state_page(st_, d, {f: (fx[f]["c"]["name"], "/rain/x/" + f, "", "") for f in fips_list}, [], None)
out["fl_state"] = st(["12099"], "FL")
pal = copy.deepcopy(fx["12099"]); pal["c"]["total"] = 10.0; pal["c"]["name"] = "Glacier County"
fx["30035"] = pal
out["mt_state"] = st(["30073", "30035"], "MT")
files = {"FL": dict(fx["12099"]["d"], counties={"12099": fx["12099"]["c"]})}
out["hub"] = B.hub_page(files, "2026-11-09", [])
out["saved_js"] = B.SAVED_JS
print(json.dumps(out))
`;
const P = JSON.parse(execFileSync("python3", ["-c", PY], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 << 20 }));
const title = (h) => h.match(/<title>([^<]*)<\/title>/)[1];
const og = (h) => h.match(/<meta property="og:title" content="([^"]*)">/)[1];
const lede = (h) => h.match(/<p class="rc-answer">(.*?)<\/p>/)[1];
const lead = (h) => h.slice(h.indexOf('<p class="rc-answer">'), h.indexOf('<dl class="rc-figs">'));
const visible = (h) => h.replace(/<details[^]*?<\/details>/g, "");

test("Palm Beach FL: the title, og:title and lede name the Aberdeen gauge; the county-wide estimate sits beside it", () => {
  const h = P["12099"];
  assert.match(title(h), /^75\.03 in of Rain at (the )?Aberdeen( Gauge)?, Palm Beach County, FL, 2026( \| AGSIST)?$/);
  assert.equal(og(h), title(h).replace(/ \| AGSIST$/, ""));
  assert.match(lede(h), /^<b>75\.03 inches<\/b> of rain have fallen so far in 2026 at the volunteer rain gauge 4\.2 miles north-northwest of Aberdeen in Palm Beach County, through Nov 8\./);
  assert.match(lead(h), /Averaged over the whole county, about 57\.82 inches, 109% of usual/);
  assert.match(h, /<meta name="description" content="75\.03 inches of rain at the Aberdeen gauge in Palm Beach County, Florida/);
  assert.match(visible(h), /<h2>The station<\/h2>\s*<p>The numbers come from NOAA&rsquo;s daily record for the volunteer rain gauge 4\.2 miles north-northwest of Aberdeen/,
    "the gauge stays named outside any fold");
});

test("Story County IA: the title names Gilbert", () => {
  assert.match(title(P["19169"]), /^55\.56 in of Rain at (the )?Gilbert( Gauge)?, Story County, IA, 2026/);
});

for (const [f, county, st, site, est, pct] of [["30073", "Pondera County", "MT", "Pike Creek", "16.85", 116], ["16041", "Franklin County", "ID", "Franklin Basin", "18.35", 94]]) {
  test(`${county} ${st}: a SNOTEL site never leads; the county-wide estimate does, and the gauge is named as a mountain snow site`, () => {
    const h = P[f];
    assert.equal(title(h).replace(/ \| AGSIST$/, ""), `About ${est} in of Rain in ${county}, ${st}, 2026`);
    assert.ok(!title(h).includes(site) && !og(h).includes(site), "the snow site is not in the title");
    assert.match(lede(h), new RegExp(`^<b>${est.replace(".", "\\.")} inches</b> of rain have fallen so far in 2026 averaged over ${county}, Jan 1 to Nov 8, an estimate from a weather grid \\(${pct}% of usual\\)\\.$`));
    assert.match(lead(h), new RegExp(`mountain snow site.*the ${site} SNOTEL site`));
    assert.match(h, /<dl class="rc-figs"><div><dt>Across the county, estimate<\/dt><dd>/);
    assert.ok(!/<dt>Rain so far<\/dt>/.test(h), "the snow site's figures are labeled as the snow site's");
    assert.match(h, /<meta name="description" content="About [\d.]+ inches of rain averaged over/);
  });
}

test("Franklin ID: two qualifying stations, both mountain sites, said as such", () => {
  assert.match(lead(P["16041"]), /All 2 stations in Franklin County that reported nearly every day are high mountain sites; the one used is the Franklin Basin SNOTEL site/);
  assert.match(lead(P["30073"]), /The only station in Pondera County that reported nearly every day is the Pike Creek SNOTEL site/);
});

test("a mountain site with no county-wide estimate keeps its lede but says what it is", () => {
  const h = P.pondera_nogrid;
  assert.match(title(h), /^37\.50 in of Rain at (the )?Pike Creek( Snow Site)?, Pondera County, MT, 2026/);
  assert.match(lede(h), /This station is a mountain snow site/);
});

test("Arkansas County AR: driest of 71 years is withheld with 15 missing days unless the gap is wider than they could hold", () => {
  for (const k of ["05001", "ark_narrow"]) {
    assert.ok(!P[k].includes("On record:"), k + ": no dry rank");
    assert.ok(!/least rain by/.test(P[k]), k);
  }
  assert.match(P.ark_wide, /<b>On record:<\/b> the least rain by Nov 3 in 71 years on record here \(1941 on\)/);
  // a wet rank from a gappy year stands: Pondera (19 wetter, 26 drier) keeps its line
  assert.match(P["30073"], /<b>On record:<\/b> 20th wettest/);
});

test("state pages: Most names the gauge; a mountain snow site is not the state's Most", () => {
  assert.match(P.fl_state, /Most: 75\.03 in at (the Aberdeen gauge in|Aberdeen,) Palm Beach County\./);
  assert.match(P.mt_state, /Most: 10\.00 in at (the Aberdeen gauge in|Aberdeen,) Glacier County\./);
  assert.ok(!P.mt_state.includes("Most: 37.50"), "Pike Creek's 37.50 in is not Montana's Most");
});

test("/rain: records are worded as the code counts them, one radar link, and the saved place", () => {
  const h = P.hub;
  assert.ok(!h.includes("Records count only full years"));
  assert.match(h, /reported at least 95% of the days to the same date \(3 missed days are always allowed\)/);
  const body = h.slice(h.indexOf('<div class="rc">'), h.indexOf('<p class="rc-byline">'));   // the page's own body, not the menu
  assert.equal((body.match(/href="\/rain-radar"/g) || []).length, 1);
  assert.match(body, /<a href="\/rain-radar">Look up radar rain by ZIP<\/a>/);
  assert.match(h, /<script src="\/components\/saved-place\.js\?v=1"><\/script>/);
  assert.match(h, /<p class="rc-fine" id="rc-mine" data-st="\{&quot;FL&quot;:\[&quot;florida&quot;,&quot;Florida&quot;\]\}" hidden><\/p>/);
});

// The saved-place line, run against a stubbed page: the state page's own table finds the county page.
function runSaved(place, statePage) {
  const els = {
    "rc-mine": { hidden: true, textContent: "", kids: [], getAttribute: () => '{"FL":["florida","Florida"]}',
                 appendChild(n) { this.kids.push(n); } },
    "rc-pick-st": { value: "" },
  };
  const fetched = [];
  const anchors = [...statePage.matchAll(/<th scope="row"><a href="([^"]+)">([^<]+)<\/a>/g)].map((m) => ({ textContent: m[2], getAttribute: () => m[1] }));
  const P2 = { county: (s) => String(s || "").replace(/\s+(County|Parish|Borough)$/i, "").trim(), full: () => Promise.resolve(place) };
  const win = {
    AgSavedPlace: P2,
    fetch: (u) => { fetched.push(u); return Promise.resolve({ ok: true, text: () => Promise.resolve(statePage) }); },
    DOMParser: function () { this.parseFromString = () => ({ querySelectorAll: () => anchors }); },
    document: { getElementById: (id) => els[id], createElement: () => ({}), createTextNode: (t) => ({ t }) },
  };
  win.window = win;
  vm.runInNewContext(P.saved_js, win);
  return new Promise((r) => setTimeout(() => r({ els, fetched }), 20));
}

test("/rain saved place: the county page is linked and the state is chosen; nothing without a saved county", async () => {
  const sp = P.fl_state.replace('href="/rain/x/12099"', 'href="/rain/florida/palm-beach-county"');
  let r = await runSaved({ state: "FL", county: "Palm Beach" }, sp);
  assert.deepEqual(r.fetched, ["/rain/florida"]);
  assert.equal(r.els["rc-pick-st"].value, "/rain/florida");
  assert.equal(r.els["rc-mine"].hidden, false);
  assert.equal(r.els["rc-mine"].textContent, "Your saved place is in Palm Beach, Florida: ");
  assert.equal(r.els["rc-mine"].kids[0].href, "/rain/florida/palm-beach-county");
  r = await runSaved({ state: "FL", county: "Dade" }, sp);
  assert.equal(r.els["rc-mine"].kids[0].href, "/rain/florida", "a county with no page links the state page");
  r = await runSaved({ state: "FL", county: "" }, sp);
  assert.equal(r.els["rc-mine"].hidden, true);
  assert.deepEqual(r.fetched, []);
  r = await runSaved({ state: "WY", county: "Albany" }, sp);
  assert.equal(r.els["rc-mine"].hidden, true, "a state with no rain pages shows nothing");
});
