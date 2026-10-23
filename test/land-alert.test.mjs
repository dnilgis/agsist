/* The monthly land sale email (Sig, Oct 23 2026: new list, sender and monthly schedule
 * approved; gated on a repo variable until he flips it). Topic landsales:<ZIP>:<miles>
 * (subs worker v5.55), mailed by scripts/send_land_alert.py from
 * .github/workflows/land-alert.yml on the 3rd, numbers from scripts/land_alert.py.
 *   - no buyer or seller name, parcel, legal or document number in any email, checked on
 *     the real county files for both samples (Chetek 54728, Charleston IL 61920);
 *   - the gate: nothing reaches the list without LANDSALES_MONTHLY_LIVE=1, in the workflow
 *     and in the script; and never through Sig's Google account (BUILD-RULES 12);
 *   - the unsubscribe: front door, link id, UNSUB_SECRET hmac, topic=landsales, no ZIP;
 *   - an empty month sends nothing; the radius math; Illinois and Wisconsin only;
 *   - the ask on Field Scout, the comp report, Fast Facts and the Atlas county pages.
 *
 *   node --test test/land-alert.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const CLEAN = { SEND: "", PREVIEW: "", DRY_RUN: "", LANDSALES_MONTHLY_LIVE: "", SIG_TO: "", SIG_TEST_EMAILS: "", SMTP_HOST: "", SMTP_USER: "", FROM_ADDR: "" };
const py = (args, env = {}, input) => execFileSync("python3", args, { cwd: ROOT, encoding: "utf8", timeout: 240000, input,
  env: Object.assign({}, process.env, CLEAN, env) });
const DASH = /[–—]|&mdash;|&ndash;/;
const WF = read(".github/workflows/land-alert.yml");

test("the selftests: the radius, the list, the gate, the route, the stop link the worker takes", () => {
  const la = py(["scripts/land_alert.py", "--selftest"]);
  assert.match(la, /OK: 0 failure\(s\)/);
  for (const name of ["one degree of latitude is 69.1 miles", "the 26-mile sale is outside 25 and inside 50", "10 miles keeps only the 7-mile sale",
    "a row carries no name, parcel, legal or document", "an empty month is an answer with no rows, not a skip",
    "median by hand: 16 sales, $5,650; the year before 12 sales, $5,350; up 5.6%", "Indiana is not a state this email reads"]) {
    assert.ok(la.includes("ok   " + name), "land_alert selftest ran: " + name);
  }
  const out = py(["scripts/send_land_alert.py", "--selftest"]);
  assert.match(out, /OK: 0 failure\(s\)/);
  for (const name of ["gate: --send without LANDSALES_MONTHLY_LIVE sends nothing, reads nothing, exits 1",
    "live through a Google server: refused before the list is read or SMTP opened",
    "no names, parcel numbers, legal descriptions or document numbers, anywhere",
    "the worker asks, stops every land sale topic and nothing else, and refuses a forged token",
    "an empty month (nothing recorded in August) mails nobody and marks nobody",
    "preview: Sig only, each sample, [Preview] subject, list untouched"]) {
    assert.ok(out.includes("ok   " + name), "send_land_alert selftest ran: " + name);
  }
});

test("no names in the email, on the real county files: Chetek 54728 and Charleston, IL 61920", () => {
  // the ZIP centroids from the bids repo's ZIP table, written in so the test needs no network
  const code = `
import json, re, sys
sys.path.insert(0, "scripts")
import send_land_alert as S, land_alert as LA, email_links
zips = S.Zips(data={"54728": (45.317, -91.6542, "Chetek, WI"), "61920": (39.4869, -88.1761, "Charleston, IL")})
land = LA.Land()
out = {}
for z in ("54728", "61920"):
    names, places = set(), set()
    for st, c in land.counties_near(zips.coord(z), 25):
        f = land.file(st, c["fips"]) or {}
        places |= {str(f.get("county") or "").upper(), str(f.get("county") or "").upper() + " COUNTY"}
        places |= {str(m[0]).upper() for m in (f.get("munis") or {}).values() if m and m[0]}
        cols = f.get("cols") or []
        for r in f.get("rows") or []:
            o = dict(zip(cols, r))
            # each buyer and seller as written (one person or company per ; part), the parcel number,
            # the document number and the whole legal description
            parts = [x.strip() for k in ("grantor", "grantee") for x in str(o.get(k) or "").split(";")]
            parts += [str(o.get(k) or "").strip() for k in ("doc", "pid", "legal")]
            for part in parts:
                # a single plain word ("FARMLAND") cannot be told from the email's own words; names have two
                # words or more, and document and parcel numbers have digits
                if len(part) >= 6 and (re.search(r"[\s,]", part) or re.search(r"\d", part)) and not re.fullmatch(r"[0-9-]+|N/?A|NONE|UNKNOWN", part, re.I):
                    names.add(part.upper())
    # a county or town that bought or sold land is also a place name the email prints
    names = {x for x in names if not any(x == p or x.startswith(p + ",") or x.startswith(p + " ") and len(x) <= len(p) + 12 for p in places if p)}
    parts, why = S.compose(z, 25, 2026, 8, land, zips, "2026-10-23", ".", need_fresh=False)
    if not parts:
        out[z] = {"why": why}
        continue
    m = S.render("reader@example.com", "https://w.dev", "sec", email_links.SAMPLE_LID, parts, "news@agsist.com")
    body = (str(m["Subject"]) + m.get_body(("plain",)).get_content() + m.get_body(("html",)).get_content()).upper()
    out[z] = {"n": len(names), "hits": sorted(x for x in names if re.search(r"(?<![A-Z0-9])" + re.escape(x) + r"(?![A-Z0-9])", body))[:5], "rows": len(parts[2][[k for k, v in parts[2]].index("sales")][1]),
              "zip_in_link": [u for u in email_links.hrefs(m.get_body(("html",)).get_content()) if z in u]}
print(json.dumps(out))
`;
  const r = JSON.parse(py(["-c", code]));
  for (const z of ["54728", "61920"]) {
    assert.ok(r[z].rows >= 1, z + ": September 2026 has sales to list (" + JSON.stringify(r[z]) + ")");
    assert.ok(r[z].n > 100, z + ": the county files nearby were read with their names (" + r[z].n + ")");
    assert.deepEqual(r[z].hits, [], z + ": a buyer, seller, parcel, legal or document string reached the email");
    assert.deepEqual(r[z].zip_in_link, [], z + ": the reader's ZIP is in a link");
  }
});

test("the gate in the workflow: the list only with LANDSALES_MONTHLY_LIVE=1, scheduled or by hand", () => {
  const crons = [...WF.matchAll(/- cron: "([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(crons, ["47 15 3-5 * *"], "the 3rd, after land-data, with the 4th and 5th to catch up");
  const rain = fs.existsSync(path.join(ROOT, ".github/workflows/rain-monthly.yml")) ? read(".github/workflows/rain-monthly.yml") : "";
  const rd = /- cron: "\d+ \d+ (\d+)/.exec(rain);
  if (rd) assert.notEqual(rd[1], "3", "never on the rain email's day");
  assert.match(read(".github/workflows/land-data.yml"), /- cron: '23 9 3 \* \*'/, "land-data runs the morning of the 3rd, before this");
  assert.match(WF, /options: \[dry, preview, send\]\n\s+default: dry/);
  assert.ok(WF.includes("SEND: ${{ ((github.event_name == 'schedule' && vars.LANDSALES_MONTHLY_LIVE == '1') || (github.event_name == 'workflow_dispatch' && inputs.mode == 'send' && vars.LANDSALES_MONTHLY_LIVE == '1')) && '1' || '' }}"),
    "SEND=1 only with the variable, on both triggers");
  assert.ok(WF.includes("LANDSALES_MONTHLY_LIVE: ${{ vars.LANDSALES_MONTHLY_LIVE }}"), "the script sees the variable and refuses without it");
  assert.ok(WF.includes("PREVIEW: ${{ github.event_name == 'workflow_dispatch' && inputs.mode == 'preview' && '1' || '' }}"), "preview by hand only");
  assert.match(WF, /if \[ "\$ASKED_SEND" = 1 \] && \[ "\$SEND" != 1 \]; then\n\s+echo "::error::[^"]*LANDSALES_MONTHLY_LIVE[^"]*"\n\s+exit 1/);
  assert.ok(!/--send/.test(WF.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n")), "the workflow never passes --send");
  assert.ok(WF.indexOf("python scripts/send_land_alert.py --selftest") > 0 && WF.indexOf("python scripts/send_land_alert.py --selftest") < WF.indexOf("python3 scripts/send_land_alert.py $ARGS"), "selftest first");
  assert.ok(WF.includes("SMTP_USER: ${{ secrets.SMTP_USER }}") && !/GMAIL_/.test(WF), "no Gmail fallback secrets");
  assert.ok(WF.includes("SIG_TEST_EMAILS: ${{ secrets.SIG_TEST_EMAILS }}") && WF.includes("SIG_TO: ${{ secrets.SIG_TO }}"));
  assert.match(WF, /- uses: actions\/checkout@v4\n\s+with:\n\s+ref: main\n\s+- name: Engine checkout\n/, "the engine checkout right after the checkout");
  assert.match(WF, /permissions:\n\s+contents: read/);
});

test("the gate in the script: SEND=1 without LANDSALES_MONTHLY_LIVE=1 reads nothing and sends nothing", () => {
  for (const live of ["", "0", "true"]) {
    let rc = 0, out = "";
    try { out = py(["scripts/send_land_alert.py"], { SEND: "1", LANDSALES_MONTHLY_LIVE: live, LIST_URL: "http://127.0.0.1:9", LIST_TOKEN: "x", UNSUB_SECRET: "x" }); }
    catch (e) { rc = e.status; out = String(e.stdout); }
    assert.equal(rc, 1, "exit 1 with LANDSALES_MONTHLY_LIVE=" + JSON.stringify(live));
    assert.match(out, /refused: LANDSALES_MONTHLY_LIVE is not 1/);
    assert.ok(!/could not read the list|to mail/.test(out), "the list was never read");
  }
  // live, but SMTP still points at Gmail (today's secrets): refused
  let rc = 0, out = "";
  try { out = py(["scripts/send_land_alert.py"], { SEND: "1", LANDSALES_MONTHLY_LIVE: "1", SMTP_HOST: "smtp.gmail.com", FROM_ADDR: "news@agsist.com", LIST_URL: "http://127.0.0.1:9", LIST_TOKEN: "x", UNSUB_SECRET: "x" }); }
  catch (e) { rc = e.status; out = String(e.stdout); }
  assert.equal(rc, 1);
  assert.match(out, /refused: SMTP_HOST is a Google mail server\. BUILD-RULES 12/);
});

test("the unsubscribe link: front door, link id, UNSUB_SECRET hmac, topic=landsales and no ZIP", () => {
  const s = read("scripts/send_land_alert.py");
  assert.match(s, /stop = SN\.unsub_link\(base, secret, lid, STOP_TOPIC\)/);
  assert.match(s, /STOP_TOPIC = "landsales"/);
  const w = read("workers/subs-worker.js");
  assert.match(w, /const one = tq === LAND_ALL \? LAND_ALL : tq \? noticeTopic\(tq, true\) : "";/);
  assert.match(w, /if \(one === LAND_ALL\) \{ for \(const k of Object\.keys\(r\.t\)\) if \(k\.startsWith\(LAND_ALL \+ ":"\)\) delete r\.t\[k\]; \}/);
  assert.match(w, /const ls = \/\^landsales:\(\\d\{5\}\):\(\\d\{2\}\)\$\/\.exec\(t\);\n\s+if \(ls\) return ls\[1\] !== "00000" && LAND_MILES\.includes\(\+ls\[2\]\) \? t : null;/);
  assert.match(w, /const LAND_MILES = \[10, 25, 50\];/);
  assert.match(w, /\* v5\.55 \(2026-10-23\): MONTHLY LAND SALE EMAIL/);
});

test("Illinois and Wisconsin only; Indiana held and said so", () => {
  const la = read("scripts/land_alert.py");
  assert.match(la, /^STATES = \("IL", "WI"\)/m);
  assert.match(la, /Indiana is held/);
  assert.ok(!/"IN"/.test(la.replace(/"IN" not in STATES/, "")), "no Indiana in the module");
  assert.match(read("scripts/fetch_land_sales.py"), /rec = st in \("WI", "IL"\) and any\(r\.get\("rec"\) for r in recs\)/, "Illinois keeps the recorded date");
});

test("the ask: email, ZIP, 10/25/50 with 25 picked, the topic, One more? with the Daily unticked", () => {
  const js = read("components/land-alert.js");
  assert.match(js, /var MILES = \[10, 25, 50\], DEF = 25;/);
  assert.match(js, /function topicOf\(zip, mi\) \{ return 'landsales:' \+ zip \+ ':' \+ mi; \}/);
  assert.match(js, /S\(\)\.oneMore\(el, \{ gave: 'notice', topic: topic, email: email, zip: zip \}\)/);
  assert.ok(!/type="checkbox"/.test(js), "no box of its own; One more? owns the Daily box, never ticked");
  assert.match(js, /daily: false/);
  assert.ok(!DASH.test(js), "no em dashes");
  assert.match(js, /Never who bought or sold\./);
  assert.match(js, /EP = 'https:\/\/agsist-api\.dnilgis\.workers\.dev\/notice'/);
  // the ZIP3 test for Fast Facts: in or beside IL and WI, not far away
  const ctx = { window: {}, document: { readyState: "loading", addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; } }, location: { search: "", pathname: "/" }, setTimeout() {} };
  vm.runInNewContext(js, ctx);
  const A = ctx.window.AgLandAlert;
  for (const z of ["54728", "61920", "60601", "53201", "50010", "55401", "46201", "63101", "40202", "49503"]) assert.ok(A.NEAR.test(z), z + " is near");
  for (const z of ["75001", "90210", "10001", "83301", "68508", "58102"]) assert.ok(!A.NEAR.test(z), z + " is not near");
  assert.equal(A.topicOf("54728", 25), "landsales:54728:25");
  assert.ok(A.okZip("54728") && !A.okZip("00000") && !A.okZip("5472"));
});

test("where the ask shows, and how it loads", () => {
  assert.match(read("field-scout.html"), /<div data-land-alert data-follow="#fl-comps" data-source="page:field-scout" hidden><\/div>/);
  assert.match(read("field-scout-land.js"), /id="fl-comps"/, "Field Scout still draws Sold land nearby where the ask follows it");
  assert.match(read("comp-report.html"), /<div data-land-alert data-source="page:comp-report"><\/div>\n\s+<p class="cr-made">/);
  assert.match(read("fast-facts.html"), /<div data-land-alert data-near-only="1" data-source="page:fast-facts" hidden><\/div>/);
  assert.match(read("farmland-atlas/wisconsin/barron-county.html"), /<section class="as" data-atlas-sales="county" data-st="WI"/, "the Atlas county block the ask follows");
  assert.match(read("components/land-alert.js"), /section\[data-atlas-sales="county"\]/);
  const L = read("components/loader.js");
  assert.match(L, /s\.src = '\/components\/land-alert\.js\?v=1';/);
  assert.match(L, /document\.querySelector\('\[data-land-alert\],section\[data-atlas-sales="county"\]'\)/);
  assert.match(L, /var CV = '93';/);
  assert.ok(Number(/var CACHE_VERSION = (\d+);/.exec(read("sw.js"))[1]) >= 250);
});

test("the morning report, signups and cron health know the list; signups count by radius, never a ZIP", () => {
  assert.match(read("scripts/morning_report.py"), /\("land-alert\.yml", "send_land_alert\.py", "Monthly land sales", "email"\)/);
  assert.match(read("scripts/morning_report.py"), /"landsales": "land sales"/);
  assert.match(read("scripts/build_signups.py"), /if kind == "landsales":\n\s+sub = sub\.rsplit\(":", 1\)\[-1\] \+ " mi"/);
  assert.match(read("scripts/cron_health.py"), /\("land-alert\.yml", \["47 15 3-5 \* \*"\]/);
  assert.match(read("scripts/list_source.py"), /elif t\.startswith\("landsales:"\):/);
});
