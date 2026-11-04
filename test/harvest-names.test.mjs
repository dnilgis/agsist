/* Harvest-contract names past first notice (fx/smallfix1104, from the #320 checker, Nov 4 2026).
 *
 * #320 put every page on one headline contract (seed_static.py nearby_of / harvest_of, twins of
 * AgPxStamp.headline / .harvest). Three writers still named the harvest aliases: the share card
 * (build_social_card.py, "Nov beans"), the Daily email (brief_email.py, "Beans, Nov") and the
 * wire (build_news.py, "November beans"). On Nov 4 the Nov '26 soybean month was in delivery
 * and the briefing was written on Jan '27.
 *
 * Fixed clock: the real Nov 4 price file (test/fixtures/soyroll2), and the same file moved back
 * 7 days to Oct 28 with its nearby aliases picked again by fetch_prices.add_nearby, as
 * test/headline-contract.test.mjs builds it. Each briefing is locked from its file the way
 * generate_daily.py locks one (preflight_prices.daily_quote plus the contract stamp).
 *   node --test test/harvest-names.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const FX = join(ROOT, "test/fixtures/soyroll2/prices-2026-11-04.json");

function namesOn(day, back, display) {
  const code = `
import sys, json, re, types, contextlib, io
sys.path.insert(0, 'scripts')
from datetime import datetime, timedelta, timezone
sys.modules.setdefault('yfinance', types.ModuleType('yfinance'))
import fetch_prices as F
from preflight_prices import daily_quote
import build_social_card as C, brief_email as B, build_news as N
raw = open(${JSON.stringify(FX)}).read()
def mv(m):
    d = datetime(int(m.group(1)), int(m.group(2)), int(m.group(3))) - timedelta(days=${back})
    return d.strftime('%Y-%m-%d') + (m.group(4) or '')
raw = re.sub(r'\\b(20\\d\\d)-(\\d\\d)-(\\d\\d)(T[\\d:.]+Z)?', mv, raw)
d = json.loads(raw)
q = d['quotes']
for k in [k for k in q if k.endswith('-nearby')]:
    del q[k]
now = datetime.strptime(${JSON.stringify(day)}, '%Y-%m-%d').replace(hour=12, tzinfo=timezone.utc)
with contextlib.redirect_stdout(io.StringIO()):
    F.add_nearby(q, list(q.keys()), now)
# the briefing, locked the way generate_daily.load_prices locks it
lp, lc = {}, {}
for k in ('corn', 'corn-dec', 'beans', 'beans-nov', 'wheat'):
    v = daily_quote(q, k)
    if not v or v.get('close') is None:
        continue
    lp[k] = v['close'] / 100
    lc[k] = {'prev': v.get('open', v['close']) / 100, 'pct': v.get('pctChange')}
    if k in ('corn', 'beans', 'wheat') and v.get('alias_of'):
        lc[k]['contract'] = v.get('contract')
daily = {'date': ${JSON.stringify(display)}, 'locked_prices': lp, 'locked_changes': lc}
print(json.dumps({
  'card': [n for k, n in C.quote_rows(daily)],
  'email': [l for k, l, g in B.rows_of(daily)][:4],
  'news': [n for k, v, n, u in N.board_quotes(q)],
  'news_keys': [k for k, v, n, u in N.board_quotes(q)],
  'html': B.price_table(daily, None, None),
}))`;
  return JSON.parse(execFileSync("python3", ["-c", code], { cwd: ROOT, encoding: "utf8" }));
}

const NOV4 = namesOn("2026-11-04", 0, "Wednesday, November 4, 2026");
const OCT28 = namesOn("2026-10-28", 7, "Wednesday, October 28, 2026");
const GRAIN = /\b(corn|soybeans|beans|Corn|Beans)\b/;
const MONTH = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) '\d\d\b/;

test("Nov 4 (past first notice): Jan '27 soybeans everywhere, no Nov '26 bean row", () => {
  assert.deepEqual(NOV4.card, ["Dec '26 corn", "Jan '27 soybeans", "Wheat"]);
  assert.deepEqual(NOV4.email, ["Corn, Dec '26", "Beans, Jan '27", "Wheat", "Live cattle"]);
  assert.deepEqual(NOV4.news.slice(0, 4), ["Dec '27 corn", "Dec '26 corn", "Nov '27 soybeans", "Jan '27 soybeans"]);
  assert.deepEqual(NOV4.news_keys.slice(0, 4), ["corn-dec27", "corn-dec26", "beans-nov27", "beans-jan27"]);
  for (const s of [NOV4.card, NOV4.email, NOV4.news].flat()) assert.doesNotMatch(s, /Nov '26|^Nov beans$|November beans|Beans, Nov$/, s);
  assert.doesNotMatch(NOV4.html, /Nov '26|Beans, Nov</);
});

test("Oct 28 (before first notice): Nov '26 soybeans is the headline", () => {
  assert.deepEqual(OCT28.card, ["Dec '26 corn", "Nov '26 soybeans", "Wheat"]);
  assert.deepEqual(OCT28.email, ["Corn, Dec '26", "Beans, Nov '26", "Wheat", "Live cattle"]);
  assert.deepEqual(OCT28.news.slice(0, 4), ["Dec '27 corn", "Dec '26 corn", "Nov '27 soybeans", "Nov '26 soybeans"]);
});

test("every grain row names its month", () => {
  for (const s of [NOV4, OCT28].flatMap((o) => [o.card, o.email, o.news].flat())) {
    if (GRAIN.test(s)) assert.match(s, MONTH, s);
  }
});

test("an issue from before the month was stamped keeps its harvest rows, named with the year", () => {
  const out = JSON.parse(execFileSync("python3", ["-c", `
import sys, json; sys.path.insert(0, 'scripts')
import build_social_card as C, brief_email as B
d = {'date': 'Monday, August 3, 2026', 'locked_prices': {'corn': 4.1, 'corn-dec': 4.3, 'beans': 10.2, 'beans-nov': 10.4}}
print(json.dumps([C.quote_rows(d), B.rows_of(d)[:4]]))`], { cwd: ROOT, encoding: "utf8" }));
  assert.deepEqual(out[0], [["corn-dec", "Dec '26 corn"], ["beans-nov", "Nov '26 soybeans"], ["wheat", "Wheat"]]);
  assert.deepEqual(out[1].map((r) => r[1]), ["Corn", "Corn, Dec '26", "Beans", "Beans, Nov '26"]);
});
