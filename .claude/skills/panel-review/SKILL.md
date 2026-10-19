---
name: panel-review
description: Use whenever Sig asks for a panel, a panel review, a roundtable, a board, experts or "smart people" to look at anything on AGSIST or bids, whether to find defects (audit) or to shape a vision or strategy (board). The one standard way to run it: seats, a shared brief, evidence rules, a skeptic who checks every number, a synthesis, and a written record.
---
# Panel review: the standard (Oct 19, 2026)

Two modes, one process. Pick the mode from what Sig asked:
- **Audit** ("audit", "check", "make it perfect"): find what is wrong. Run `.claude/skills/audit-loop` (it is this
  process tuned for defects, with fixer and ship steps). Everything below still applies.
- **Board** ("roundtable", "board", "experts", "vision", "what would they build"): shape what to build next.
- **Both**: board first, then an audit of whatever the board wants to build on.

## 0. Before launching
- Read `.claude/notes/FINDINGS.md` (audits) and `.claude/notes/BOARD.md` (board sessions). Do not re-ask what a
  recent session answered unless the code or data changed.
- Know what is on main vs only on a branch. Seats read origin/main; list unshipped branches that matter in the brief
  (Oct 19: a seat called data/ids/ missing because it was still on fx/holidayweek).

## 1. Seats
Pick lenses from what could be wrong or what could be built. 3 to 7 seats, launched in ONE message, background.
- Always: the real end user (phone, 2 minutes, real money), a hostile domain professional, a quantitative seat
  whenever a number is derived or a correlation is claimed.
- Board adds: first-principles builder (10x, the bottleneck, delete parts), data integration / ontology (shared
  keys, entity resolution), AI-native product (what a model plus this data answers, cost per answer), consumer
  growth (hook, return visits, signups, sales), ag economist / climate (landscape shifts, confounders).
- Audit adds per artifact: privacy, SEO / answer engines, accessibility and failure modes, plain language, a
  ruthless simplifier.
- Seats are archetypes ("a first-principles builder"), never named real people or a named company's staff. Tell
  Sig so once, in one line, the first time.

## 2. One shared brief, written to a file
`briefs/board-seat.md` (board) or `../audit-loop/briefs/panelist.md` (audit). Save the filled brief in the
scratchpad and point every seat at the same file, so every seat answers the same questions in the same shape.
The brief must carry:
- Read-only. Real files and data paths. What is on main and what is still on a branch.
- Sig's rules that apply (STANDING-DECISIONS, CLAUDE.md budget).
- The evidence rules: load and follow the account skills `honest-numbers` (sample beside every claim, withhold
  rather than hedge, count the whole search, no look-ahead) and `could-this-evidence-differ` ("what else would
  produce exactly this?"), and for audits `count-the-copies`. Seats with the Skill tool load them; otherwise paste
  the one-line versions.
- Fixed output sections, a word cap, every number with its file or source, every untested idea marked hypothesis,
  plus "what I checked and found correct" so you can tell a seat actually read the code.

## 3. Evidence the seats should use (do not miss these)
- Raw data in data/ and the raw branch; recompute, never trust the page.
- Pixels: render with Playwright (Chromium is preinstalled; never `playwright install`) at 390 and 1280 px.
- Traffic: data/audience.json (GA4), Search/Bing exports in HANDOFF, subscriber counts (skill subscriber-count;
  counts only, never emails).
- Outside facts (a market, a competitor, a statistic): the deep-research skill or WebSearch. Note that the sandbox
  proxy blocks most hosts; a seat says what it could not reach rather than guessing.
- Sweeping many files for a locate-only question: an Explore agent. Mechanical recomputes: `model: "sonnet"` or
  `"haiku"`. Judgment, skeptic and synthesis: default model.
- More than 7 seats or several artifacts at once: the Workflow tool (a panel review request is the opt-in; keep
  under 10 agents unless Sig says more).

## 4. Skeptic (always)
`briefs/skeptic.md`. One agent gets every seat's file. It recomputes every number a seat cited, checks every
"does not exist" against main and the branches, checks claims against STANDING-DECISIONS (a "problem" may be Sig's
choice), names correlations whose test is not honest yet, and marks each claim HOLDS / PARTLY / WRONG. Nothing
reaches Sig that the skeptic marked WRONG, unless it is listed as refuted.

## 5. Synthesis
`briefs/synthesis.md`. Where seats agree (and whether for the same reason), where they disagree, the decisions only
Sig can make (each with a recommendation), the bets ranked by cost and how fast they prove or disprove themselves,
and what cannot be known yet with the data we have.

## 6. Record and deliver
- Board: one Claude Doc (docs skill), short, with the verdict first; link it to Sig. Append a row to
  `.claude/notes/BOARD.md`. Audit: FINDINGS.md rows per the audit loop.
- Sig's answers go into STANDING-DECISIONS the same day.
- Tell Sig in chat: three lines and the link. What the board agreed, the one decision for Sig, the first bet.

## Improve this skill
After each run add one line under "Learned" below. Use the skill-creator skill to test a change to this file
before relying on it.

## Learned
- 2026-10-19 board (Field Scout, Atlas, /here): 6 seats agreed unprompted the bottleneck is return visits (about 98%
  of users new), not data. Two seats cited a missing data/ids/ that was on an unshipped branch: brief must list
  branches. The economist seat caught an unadjusted claim in our own HANDOFF.
