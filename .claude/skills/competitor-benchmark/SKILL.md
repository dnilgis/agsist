---
name: competitor-benchmark
description: Use when Sig asks how an AGSIST page or tool stacks up against others, asks for a head-to-head or competitor review, or on the monthly benchmark run. Finds every serious competitor (established, university, government, vendor, startup), scores each page against them on one rubric, records it, and turns the gaps into a ranked plan.
---
# Competitor benchmark

Sig's goal (Oct 15, 2026): "go out, seek all relevant competitors, upcoming, established, university, etc, and make
sure that every page and tool, element etc is ranked against everyone else attempting something similar, and use
this data to continually improve the project."

Files (all public on GitHub and the site, so write facts, not snark):
- `registry.json`: every AGSIST page/tool we benchmark, the farmer's real search queries for it, and the competitors
  found for it (name, url, kind, what it offers, date last checked, latest scores).
- `results/<date>-<page>.md`: one head-to-head report per page per run (score table, where we win, where they beat us,
  the 5 ranked changes, verdict yes / close / no).

## One run, per page (use parallel helpers, one page each; the run-helpers skill)
1. **Find competitors the way a farmer would.** Search the queries in registry.json (add new ones a farmer would type).
   Also look on purpose for each kind, so nobody is missed: established ag media and data (DTN, Barchart, Farm Journal,
   Successful Farming, Agri-Pulse), farmer apps and startups (FBN and newer; check Product Hunt, AgFunder news, app
   stores), university extension and ag econ (farmdoc, AFPC, Ag Decision Maker, K-State, NDSU, Purdue, state
   extension), government (USDA FSA/RMA/NASS/AMS, CRS, committee pages), vendors and lenders (insurance companies,
   equipment and bin makers, Farm Credit), and Wikipedia/AI answer engines (what does a chatbot answer for the query,
   and does it cite us?). Add every serious one to registry.json, including ones that are new since the last run.
2. **Read them, never guess.** Open each competitor (WebFetch; a browser if WebFetch is blocked). If it can't be
   opened from where you run, say so in the report and mark its cells "?" or "from search snippets". The cloud sandbox
   proxy blocks most outside sites; a run from Sig's computer or GitHub Actions can read them.
3. **Score ours and each competitor 1-5** on the fixed rubric so runs compare over time:
   first-screen answer | current (dated, how recent) | accurate and sourced | local/personal (my county, my elevator,
   my number) | clear and concise | depth on demand | phone | trust (author, sources, no sales agenda) | speed and no
   clutter | unique value. Total out of 50. Render our page at 390 and 1280 and LOOK.
4. **Check our numbers by hand** where the page computes something (work 2-3 real cases), and record any error as a
   bug with severity. Accuracy beats every other score.
5. **Write the report** to results/<date>-<page>.md and update registry.json (scores, date, new competitors).
6. **Skeptic pass** (anthropic-skills:adversarial-audit-panel): every claimed gap or competitor fact gets checked
   before it becomes work. Facts from snippets get verified at a primary source first.
7. **Plan:** rank changes across all pages by (farmers helped x gap size) / effort, and send Sig one short list.
   Nothing ships without the normal shipping checks (ship-helper-branch skill).

## Rules that limit the fixes
Sig's standing decisions apply (no selling insurance or routing to agents, no consulting, honest numbers with source
and date, plain first-person voice, no em dashes, CLAUDE.md page budget: bulky depth loads from data on demand).
Never copy a competitor's text or data; beat them with better answers.

## Cadence
Monthly for the top pages (cash-bids, prf, arc-plc, farm-bill, grain-bin-calculator, rain-print, manure-value,
markets/futures, conditions, farmland-atlas), quarterly for the rest, and at once when Sig asks or a new competitor
shows up. Compare each run's totals with the last to show whether we gained or lost ground.
