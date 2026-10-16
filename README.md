# raw (data branch, never deployed)

Raw build inputs for agsist.com that no page ever fetches: probe captures
(what USDA AMS, NASS, FSA and the weather networks actually returned, kept so
a parser can be checked against the real layout) and the Farmland Atlas
per-layer pulls that scripts/build_farmland_atlas.py reads.

GitHub Pages deploys `main` only. This branch shares no history with `main`
and is not published, so nothing here counts toward the 1 GB site limit.
Moved off main on 2026-10-16 (data/ was at 290 of its 300 MB budget). Nothing
was deleted: the files are here at the same paths they had on main, and main's
git history still has every old version.

## What is here

- `data/atlas/raw/*.json`: Farmland Atlas layer pulls (heat, water, loss, sob,
  value, crp, energy, wells, practices, climate, storms, livestock, frost,
  wells_states). `drought.json` stays on main (a test reads it).
- `data/cattle-auction-raw/`, `data/cattle-cash-raw/`, `data/ccc-loan-raw/`,
  `data/dairy-raw/`, `data/fall-nitrogen-raw/`, `data/fert-ams-raw/`,
  `data/hay-ams-raw/`, `data/hay-raw/`, `data/drought/probe/`: what each
  workflow's "probe" run saved. A probe's `listing.json` (cattle auction, hay
  AMS) is also kept on main, because the normal run reads it.

## Who writes it

- `scripts/push_raw.sh` on main, called by .github/workflows/farmland-atlas.yml
  after every build and by each workflow above when dispatched with probe
  ticked. It copies over the same paths and never deletes a file here.
- `scripts/pull_raw.sh data/atlas/raw` unpacks the Atlas pulls into a
  checkout before the Atlas fetches and build (the paths are in .gitignore on
  main, so they never get committed there).

## Read it

    git fetch origin raw
    git show origin/raw:data/hay-raw/summary.json
    git archive origin/raw data/atlas/raw | tar -x     # into a main checkout
