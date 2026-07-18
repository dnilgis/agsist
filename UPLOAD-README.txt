AGSIST MEGA KIT — supersedes agsist-nav-complete.zip (throw that one away)
==========================================================================
Everything pending, rebuilt against tonight's live repo. Two important
things inside:

  ★ cot.html FIXES A LIVE BUG — /cot is currently serving the
    AG-ODDS page (a missed scramble victim). This restores the real
    COT page. Upload it first if you do nothing else.
  ★ index.html was rebuilt from the LIVE homepage (today's briefing +
    social card) + only the new nav links — safe to upload, but do it
    TODAY/TONIGHT. If you wait past tomorrow's ~11:00 UTC daily run,
    ask me for a fresh copy instead of uploading this one.

WHAT'S IN HERE
  Root (17): basis + conditions (NEW pages), cot (bug fix), index,
    cash-rent (browse-by-state cloud), cash-lease, breakeven, farm-bill,
    ag-odds, cash-bids, tariffs, usda-quick-stats, usda-calendar,
    fast-facts, seo-template, llms.txt, .gitignore
  components/ (4): header, footer + both fallbacks — "Cash Rent by
    State" everywhere, new map icon
  scripts/ (6): build_state_rent_pages.py (generates 47 state rent
    pages + /rent hub) and the five fail-loud polish scripts the repair
    reverted (bids, crop_progress, markets, nass, mesh)
  .github/workflows/ (1): state-rent-pages.yml
  docs/ (1): NEW-PAGE-CHECKLIST.md

UPLOAD ORDER (folder by folder — never drag the whole zip tree to root)
  1. Repo root -> "Add file > Upload files" -> drag the 17 ROOT FILES
     only (the loose files, not the folders) -> commit.
  2. Open components/ -> upload the 4 component files -> commit.
  3. Open scripts/ -> upload the 6 scripts -> commit.
  4. Open .github/workflows/ -> upload state-rent-pages.yml -> commit.
  5. Open docs/ -> upload NEW-PAGE-CHECKLIST.md -> commit.

THEN — TWO WORKFLOW RUNS (Actions tab)
  6. "state-rent-pages" -> Run workflow. It generates all 47
     /rent/<state> pages + the /rent hub AND adds them to the sitemap
     by itself. ~2 min. After it's green, spot-check
     agsist.com/rent/iowa and agsist.com/rent/
  7. "sitemap-add" -> Run workflow with this exact string in the urls
     box (adds the pages that aren't machine-added):
     https://agsist.com/basis https://agsist.com/conditions https://agsist.com/cash-lease https://agsist.com/foreign-land

VERIFY (60 seconds)
  - agsist.com/cot shows "CFTC COT Report" (not prediction markets)
  - agsist.com/rent/iowa loads with the county table
  - homepage still shows today's briefing
  - any page's Numbers menu shows "Cash Rent by State"

Separately: the probe-epic2 kit you already have -> upload its 2 files,
run "probe-epic2", paste me the log. That unlocks the next 3 pages.
