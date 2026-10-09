#!/usr/bin/env python3
"""
SIG'S VOICE, CHECKED BY A MACHINE: voice_lint and the three places it is wired.

The AGSIST Daily carries Sig's name. This drives voice_lint with drafts that
must fail (an invented first-person experience, machine tells) and drafts that
must pass (plain prose, first person used only for an opinion), then checks
each caller does what it says:

  generate_daily.py     fix_headline_case() puts headlines and titles in
                        sentence case; the system prompt carries the hard
                        first-person rule and its own voice samples are clean
  critique_briefing.py  apply_rewrite() refuses a rewrite that adds an
                        invented first-person sentence
  briefing_gate.py      FAIL on an invented first-person sentence, WARN on a tell

    python3 scripts/test_voice_lint.py

No network, no API key, about a second.
"""
import copy
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import voice_lint  # noqa: E402

fails = []


def check(ok, msg):
    print(f"  {'PASS' if ok else 'FAIL'}  {msg}")
    if not ok:
        fails.append(msg)


print("voice_lint: drafts that must fail and drafts that must pass\n")

MUST_FAIL_FABRICATED = [
    "I talked to three elevators this morning and basis is firm.",
    "My neighbor said his beans ran 60 bushels.",
    "I sold some corn at $5.00 today.",
    "We hauled the last of the beans Tuesday.",
    "A buyer told me the bids are wide.",
    "Around here the combines are parked.",
    "I've been hearing yields are better than expected.",
    "I'm hearing the river is low at the terminals.",
    "This morning I checked the cash bids.",
    "The guys I talk to are holding beans.",
    "We got 2 inches of rain last night.",
    "Our elevator dropped basis a dime.",
    "I was at the co-op Tuesday and nobody was selling.",
]
MUST_PASS = [
    "I'd keep an eye on $5.00 corn.",
    "I think the market already knew that corn was there.",
    "My read is the stocks number was already priced in.",
    "I'm not sure the bounce lasts past Thursday.",
    "We'll see what export sales say Thursday.",
    "Corn is at $5.00 overnight, up 3 cents from Monday's $4.97¼ settle.",
    "Beans only gained 7¾ cents to $12.89, so the products are pulling the soy complex.",
    "Corn, beans and wheat all firmed.",
    "Cattle eased a quarter; nothing new in the boxed beef.",
    "Short local storage can weigh on basis even when futures sit still.",
]
MUST_FAIL_TELL = [
    ("Corn is navigating a tricky landscape.", "navigate"),
    ("It's worth noting that beans firmed.", "worth-noting"),
    ("In today's market, cattle led.", "in-todays"),
    ("A game-changer for feeders.", "game-changer"),
    ("An unprecedented move in soy oil.", "unprecedented"),
    ("Demand stayed robust.", "robust"),
    ("Let's delve into the numbers.", "delve"),
    ("Corn held $5 — barely.", "dash"),
    ("This is not just a corn story but a basis story.", "not-just-but"),
    ("This isn't just a rally; it's a warning.", "not-just-but"),
    ("The market was volatile, uncertain and fragile.", "triple-adjective"),
    ("A rich tapestry of factors moved grain.", "tapestry"),
    ("Basis is yelling and carry's working.", "slang"),
    ("Soy oil had a massive day.", "hype"),
]

for s in MUST_FAIL_FABRICATED:
    check(bool(voice_lint.fabricated_hits({"lead": s})), f"fabricated caught: {s!r}")
for s in MUST_PASS:
    r = voice_lint.lint({"lead": s})
    check(not r["fabricated"] and not r["tells"], f"clean passes: {s!r}")
for s, code in MUST_FAIL_TELL:
    codes = [c for c, _, _ in voice_lint.tell_hits({"lead": s})]
    check(code in codes, f"tell [{code}] caught: {s!r}")

# Fields the model does not write in Sig's voice are not scanned.
check(not voice_lint.lint({"daily_quote": {"text": "I sold my farm in 1985."},
                           "action": "I'd hold beans."})["fabricated"],
      "the quote of the day and the bot's Action are not scanned")

# Fabricated text anywhere the model writes.
for loc, b in (("section body", {"sections": [{"title": "Corn", "body": "- My neighbor said yields are good."}]}),
               ("one_number.context", {"one_number": {"context": "I talked to two elevators about it."}}),
               ("outside_the_pit", {"outside_the_pit": [{"title": "x", "body": "A buyer told me so."}]}),
               ("watch_list", {"watch_list": [{"time": "Ongoing", "desc": "I'm hearing basis widen."}]})):
    check(bool(voice_lint.fabricated_hits(b)), f"fabricated caught in {loc}")

print("\nthe deterministic fixes\n")
b = {"lead": "Corn held $5.00. I talked to elevators today. Beans firmed.",
     "sections": [{"title": "Corn", "body": "- Corn held **$5.00**.\n- My neighbor said yields are good.",
                   "so_what": "Plain."}]}
b, log = voice_lint.strip_fabricated(b)
check(b["lead"] == "Corn held $5.00. Beans firmed.", "strip_fabricated cuts the sentence from the lead")
check(b["sections"][0]["body"] == "- Corn held **$5.00**.", "strip_fabricated drops the emptied bullet")
check(not voice_lint.fabricated_hits(b) and len(log) == 2, "nothing fabricated left, two cuts logged")
check(voice_lint.needs_regen(voice_lint.lint({"lead": "I sold corn today."})), "a fabricated sentence costs a regeneration")
check(not voice_lint.needs_regen(voice_lint.lint({"headline": "CORN HOLDS $5", "lead": "Corn held — barely."})),
      "a dash or an ALL CAPS headline alone does not (a sweep fixes both)")

print("\ngenerate_daily: sentence case and the prompt\n")
import generate_daily as g  # noqa: E402

cases = [
    ("CORN HOLDS $5 AS GRAIN STOCKS COME IN HEAVY", "Corn holds $5 as grain stocks come in heavy"),
    ("CRUDE RUNS 5% ON HORMUZ, SOY OIL BREAKS HARD", "Crude runs 5% on Hormuz, soy oil breaks hard"),
    ("Corn holds $5 even with heavy grain stocks", "Corn holds $5 even with heavy grain stocks"),
]
for raw, want in cases:
    out = g.fix_headline_case({"headline": raw, "lead": "x"})["headline"]
    check(out == want, f"headline {raw!r} -> {out!r}")
b = g.fix_headline_case({"headline": "x", "lead": "Crude is at $92.61 after a tanker was hit off Qatar.",
                         "sections": [{"title": "Crude Runs On Fresh Tanker Hit", "body": "- x"},
                                      {"title": "ENERGY & INPUTS", "body": "- x"}],
                         "outside_the_pit": [{"title": "Santa Teresa Port Reopens To Zebu Trade", "body": "x"}]})
check(b["sections"][0]["title"] == "Crude runs on fresh tanker hit", f"Title Case section title -> {b['sections'][0]['title']!r}")
check(b["sections"][1]["title"] == "Energy & inputs", f"ALL CAPS section title -> {b['sections'][1]['title']!r}")
check(b["outside_the_pit"][0]["title"] == "Santa Teresa Port Reopens To Zebu Trade",
      "a title with a name the lists do not know is left alone, not half-cased")

ms = {"is_closed": False, "day_name": "Friday", "reason": "", "note": ""}
prompt = g.build_system_prompt(ms, [], None, None, "", "", [], [], "")
check("NEVER invent an experience" in prompt, "prompt carries the hard first-person rule")
check("6. First person is for opinion only" in prompt, "the writing rules repeat it")
check('"headline": "Sentence case' in prompt, "the output schema asks for a sentence-case headline")
for gone in ("ALL CAPS, 6-10 words", "imperative tone", "operator vocabulary", "sharp friend",
             "VOICE OR DEATH", "basis is talking\" / \"basis is firming", "One punchy sentence"):
    check(gone not in prompt, f"prompt no longer says {gone!r}")
check("—" not in prompt and "–" not in prompt, "prompt has no em or en dashes for the model to copy")

# The samples must pass the same lint the drafts are held to.
i, j = prompt.index("VOICE SAMPLES."), prompt.index("NO ACTION FIELD.")
samples = re.findall(r'"([^"]{25,})"', prompt[i:j])
check(len(samples) >= 10, f"found {len(samples)} sample lines")
for s in samples:
    r = voice_lint.lint({"lead": s})
    check(not r["fabricated"] and not r["tells"], f"sample is clean: {s[:60]!r}")
for h in re.findall(r'^- "([^"]+)"$', prompt[i:prompt.index("LEAD example")], re.M):
    check(voice_lint._case_problem(h) is None, f"sample headline is sentence case: {h!r}")

print("\ncritique_briefing: a rewrite may not add an invented first person\n")
import critique_briefing as cb  # noqa: E402

base = json.load(open(os.path.join(HERE, "..", "data", "daily-archive", "2026-10-08.json")))
br = copy.deepcopy(base)
old_lead = br["lead"]
out, applied = cb.apply_rewrite(br, {"weakest_target": "lead",
                                     "rewritten_content": {"lead": "I talked to three elevators this morning. Crude is at $92.61."}})
check(applied is None and out["lead"] == old_lead, "rewrite with 'I talked to three elevators' refused")
br = copy.deepcopy(base)
out, applied = cb.apply_rewrite(br, {"weakest_target": "lead",
                                     "rewritten_content": {"lead": "Crude is at $92.61 overnight, up 4.9%, after another tanker was hit off Qatar."}})
check(applied == "lead" and out["lead"].startswith("Crude is at $92.61"), "a clean rewrite still applies")
check("fabricated" in cb._voice_payload({"lead": "My neighbor said so."}), "the editor is shown voice_lint findings")

print("\nbriefing_gate: FAIL on invented first person, WARN on a tell\n")
import briefing_gate  # noqa: E402

clean = copy.deepcopy(base)
clean["lead"] = "Crude is at $92.61 overnight, up 4.9%, after another tanker was hit off Qatar."
_, issues = briefing_gate.run(clean, None)
check(not any(c == "voice-fabricated" for _, c, _ in issues), "clean draft: no voice-fabricated issue")
dirty = copy.deepcopy(clean)
dirty["lead"] += " My neighbor said the beans ran 60."
passed, issues = briefing_gate.run(dirty, None)
check(not passed and any(s == "FAIL" and c == "voice-fabricated" for s, c, _ in issues),
      "fabricated draft: gate FAILs")
tell = copy.deepcopy(clean)
tell["lead"] += " Demand stayed robust."
_, issues = briefing_gate.run(tell, None)
check(any(s == "WARN" and c == "voice-tell" for s, c, _ in issues)
      and not any(c == "voice-fabricated" for _, c, _ in issues), "a tell: gate WARNs, does not FAIL")

print(f"\n{len(fails)} failure(s)")
sys.exit(1 if fails else 0)
