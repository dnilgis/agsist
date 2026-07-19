EPIC-2 PAGES KIT v2 — REPLACES agsist-epic2-pages.zip (delete that one)
========================================================================
Same three pages + data fixes, with your nav call applied: "Cash Rent
by State" is OUT of every menu. The /rent pages stay (search doorway,
linked from the cash-rent page's browse-by-state section) — they just
don't burn a menu slot next to Cash Rent by County.

ABOUT THE LOGS YOU SENT: both storage runs (01:47 & 01:49) used the
OLD fetcher — 13,771 corn rows is the census-duplication signature.
The fix below pulls ~1,300. Upload scripts/ first, then re-run.

UPLOAD (folder by folder)
  1. Repo root -> the 12 root files -> commit
     (three NEW pages: land-tenure, storage-crunch, conditions-yield;
      index/cot/etc are nav-line updates)
  2. components/ -> the 4 files -> commit
  3. scripts/ -> the 3 files -> commit
     (fetch_tenure + fetch_storage = DATA FIXES;
      build_state_rent_pages = nav fix for the generated /rent pages)

RUN (Actions)
  4. "tenure"  -> Run workflow    (county history 1997-2022 restored)
  5. "storage" -> Run workflow    (census-year ratios cleaned)
  6. "state-rent-pages" -> Run workflow  (if you already ran it, run
     again — regenerates /rent pages without the menu entry;
     if you never ran it, this is what creates agsist.com/rent/iowa)
  7. "sitemap-add" -> Run workflow with:
     https://agsist.com/land-tenure https://agsist.com/storage-crunch https://agsist.com/conditions-yield

VERIFY
  - menus show Cash Rent by County only (no "by State" anywhere)
  - /land-tenure, /storage-crunch, /conditions-yield all render
  - /rent/iowa exists and its county table sorts
  - after the storage re-run: /storage-crunch -> click Iowa -> the
    2002/2007/2012/2017/2022 bars appear instead of "excluded"
