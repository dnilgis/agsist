/* Every email scripts/sponsor_apply.py can send, rendered with the real rate card (Nov 11, 2026 terms, A17):
 * pay when you book (card or a yearly invoice by mail, net 30), money back inside 30 days, the price from
 * data/rate-card.json. No email offers a free month or a founding rate.
 *   node --test test/sponsor-apply-emails.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const src = readFileSync(ROOT + "scripts/sponsor_apply.py", "utf8");
const body = src.slice(src.indexOf("def emails_for("), src.indexOf("\ndef ", src.indexOf("def emails_for(") + 10));
const KINDS = [...new Set([...body.matchAll(/if action == "([a-z]+)":/g)].map((m) => m[1]))];

const PY = `
import sys, json
from datetime import date
sys.path.insert(0, "scripts")
import sponsor_apply as S
card = json.load(open("data/rate-card.json"))
slots = (json.load(open("data/sponsor-slots.json")).get("slots")) or []
base = dict(id="a1b2c3d4e5f6", status="confirmed", tier="page", slot="state-ia", company="Valley Coop", contact="Pat",
            email="pat@example.com", phone="", headline="Fair bids", body="How I pay: yearly invoice by mail", url="https://example.com",
            logo_len=0, start="2026-11-02", invoiced=0, _page="/rain/iowa")
apps = [dict(base), dict(base, tier="daily", slot=""), dict(base, slot="state-wi"), dict(base, slot="state-tx"), dict(base, slot="cash-bids-iowa")]
out = {}
for k in json.loads(sys.argv[1]):
    out[k] = []
    for a in apps:
        for to, kw in S.emails_for(k, a, "https://w.dev", "sec", card, date(2026, 11, 11), "owner@x.com", slots):
            out[k].append({"to": to, "text": " ".join([kw.get("subject", "")] + list(kw.get("paras") or []))})
print(json.dumps(out))
`;

test("every email kind renders, and none offers a free month or a founding rate", () => {
  assert.ok(KINDS.length >= 9, "email kinds found: " + KINDS.join(" "));
  const out = JSON.parse(execFileSync("python3", ["-c", PY, JSON.stringify(KINDS)], { cwd: ROOT, encoding: "utf8" }));
  for (const k of KINDS) {
    assert.ok(out[k].length > 0, k + " renders an email");
    for (const e of out[k]) assert.doesNotMatch(e.text, /free month|first month free|month free|founding|day-30|day 30|no reply means/i, k + ": " + e.text);
  }
});

test("the confirm and owner emails carry the A17 terms and the rate card's prices", () => {
  const card = JSON.parse(readFileSync(ROOT + "data/rate-card.json", "utf8"));
  const sw = card.tiers.find((t) => t.id === "sitewide"), st = card.tiers.find((t) => t.id === "state");
  const n = (x) => x.toLocaleString("en-US");
  const out = JSON.parse(execFileSync("python3", ["-c", PY, JSON.stringify(["confirm", "notify", "golive"])], { cwd: ROOT, encoding: "utf8" }));
  const [ia, sitewide, wi] = out.confirm;
  for (const e of out.confirm) {
    assert.match(e.text, /You pay when you book: by card, or by a yearly invoice we mail you \(net 30\)\./);
    assert.match(e.text, /Money back if you ask inside 30 days\./);
  }
  assert.ok(ia.text.includes(`$${n(st.price_month)} a month, or $${n(st.price_month * card.year_months)} a year`), ia.text);
  assert.ok(sitewide.text.includes(`$${n(sw.price_month)} a month, or $${n(sw.price_month * card.year_months)} a year`), sitewide.text);
  assert.ok(wi.text.includes(`$${n(st.price_by_state.WI)} a month, or $${n(st.price_by_state.WI * card.year_months)} a year`), wi.text);
  for (const e of out.notify) assert.match(e.text, /Paid at booking, by card or a yearly invoice by mail \(net 30\)\. Money back if they ask inside 30 days\./);
  for (const e of out.golive) assert.match(e.text, /Money back if (you|they) ask by Dec 1, 2026/);
});
