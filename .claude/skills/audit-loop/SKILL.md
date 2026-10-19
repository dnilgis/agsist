---
name: audit-loop
description: Use when Sig asks to audit, review, check, panel or "make perfect" any AGSIST or bids page, tool, data set or workflow, or on a scheduled audit rotation. Runs reviewers in parallel, sends every finding to an adversary, fixes only what survives with regression tests from the real case, ships through the normal checks, and records everything in the findings log.
---
# The audit loop (Oct 19, 2026)

Built from the Oct 18 to 19 runs (land sales, comp report, Daily, cash bids, PRF/LRP, rain, Atlas, price labels,
harvest price tracker). Every run found real defects, and the adversary pass killed or narrowed about a third of
them, once saving 106 real bids from a "fix". The loop is the product; follow it in order.

Log: `.claude/notes/FINDINGS.md` (public: no names, no emails, business names fine). Read it first: do not re-audit
what was checked recently unless the code or data changed since.

## 1. Pick lenses from what could be wrong
Always: the real end user (phone, 2 minutes, real money), a hostile domain professional, a quantitative reviewer
whenever a number is derived, failure modes plus accessibility. Add per artifact: privacy (names, analytics URLs),
SEO / answer engines, a ruthless simplifier, plain language. 3 to 5 reviewers, launched in ONE message, in the
background. Simulated personas are labeled simulated when reported to Sig.

## 2. Brief each reviewer with briefs/panelist.md
Fill: artifact, files, data, the lens, and Sig's rules that apply. The template forces the things that worked:
recompute from RAW data (never trust the page), render at 390 and 1280 px, real examples with numbers, reach
(how many pages / readers / dollars), confidence and "how I could be wrong", an INDEPENDENT source (the Daily's fact
check missed errors because it trusted the same broken calendar the generator used), an insight section, and
"what I checked and found correct". Read-only. No praise.

## 3. Adversary: briefs/adversary.md
Merge the reviewers' findings, dedupe, number them, send ALL of them to one adversary told to refute each with its
own reproduction. Verdicts: SURVIVES / PARTLY / REFUTED, plus the minimal fix that keeps existing tests passing and
the tests that pin current behavior. Also ask it to check for Sig approvals in STANDING-DECISIONS, HANDOFF and git
history (a "violation" may be an approved choice).

## 4. Decide
- Survives and inside Sig's rules: fix it.
- Touches a rule, a sale, a price, a public claim or a policy choice: ask Sig in one short message with a
  recommendation (Oct 18: the PRF month picker was his call, not ours). Record his answer in STANDING-DECISIONS.
- Refuted: log it as refuted with the reason, so nobody re-raises it.

## 5. Fix: briefs/fixer.md
One helper per area, its own worktree (`git worktree add /tmp/x/<name> -b fx/<name> origin/main`), owned files
listed, forbidden files listed (other helpers' areas). Every confirmed bug gets a regression test built from the
real case (saved fixture of the real data), not a made-up one. Never weaken a test; changing a pinned version or
a pinned string because Sig changed the rule is allowed and is said in the commit. No em dashes. Commit as dnilgis.

## 6. Ship
`scripts/dev/checks.sh` with a short TMPDIR (`/tmp/x/ckNN`) until FAILS=0; read every `not ok` including nested;
rerun a known-flaky browser test alone and say so. Merge origin/main first. `scripts/dev/push.sh <working-branch>`
(it now merges the working branch first and never force-pushes; never `git push -f`). Workers deploy on merge.
Generated pages: change the builder, never only the output; the scheduled build or a local rebuild regenerates.

## 7. Log and report
Append one row per finding to `.claude/notes/FINDINGS.md`: date, area, finding (short), verdict, fix commit or
"Sig decides" or "refuted: why", reach. Tell Sig: what shipped, what waits on him (with a recommendation), the
two or three findings that would have cost someone money. Short.

## Cost
Mechanical recomputes and scans can run on a cheaper model (Agent `model: "sonnet"` or `"haiku"`); judgment,
adversary and fixes stay on the default. Sig watches usage and the API credits expire Nov 19.
