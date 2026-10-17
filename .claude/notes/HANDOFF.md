# AGSIST handoff: start here (updated Oct 16, 2026)

Read this, then `.claude/notes/STANDING-DECISIONS.md` (Sig's rules), then `CLAUDE.md` (the 1 GB / 150 KB page budget).
This file is public (the repo and Pages serve it). Nothing private goes in it.

## Who and what
- Sig = Sigurd Lindquist, CCA, Chetek WI (Central time). Runs agsist.com (this repo, dnilgis/agsist, static GitHub Pages)
  and dnilgis/bids (the cash bid readers). Byline: "Sigurd Lindquist, Certified Crop Adviser (CCA)".
- He writes short, fast messages from his phone, often mid-task. Keep working and fold them in; stop only when he asks.
- He is watching his usage. Answer short. Spend helpers and panels only on big launches. Skip screenshot
  round trips when he says "ship it if it looks right".

## How we ship
1. Work on a branch or a worktree; commit as `git -c user.name=dnilgis -c user.email=dnilgis@gmail.com commit`, plain messages.
2. Changed a component's JS or CSS? Bump its `?v=` everywhere it loads AND `sw.js` CACHE_VERSION (+1, with a note).
   Menu or footer change: also `CV` in components/loader.js. Rain Print engine: the ENGINE pin in
   components/rain-county-print.js must match (a test checks), then bump its ?v= in scripts/build_county_rain.py and rebuild county pages.
3. `scripts/dev/checks.sh` must print `FAILS=0`. Never push on a fail, never weaken a test.
4. `scripts/dev/push.sh <working-branch>` pushes to main (merges are authorized) and mirrors the working branch.
- Workflows: dispatch with the REST API (`gh workflow` uses GraphQL and is blocked):
  `gh api -X POST repos/dnilgis/agsist/actions/workflows/<file>.yml/dispatches -f ref=main [-F 'inputs[x]=y']`.
  Read results through annotations: `gh api repos/dnilgis/agsist/check-runs/<job id>/annotations`.
- The sandbox cannot reach USDA, RMA, NOAA (RCC-ACIS) or most co-op sites. GitHub runners can: fetch there.
- Helpers: write a brief file first (rules in `.claude/notes/helper-rules.md`), one helper per worktree, never two in the same one.

- Browser tests skip unless Playwright is at /home/user/node_modules: `cd /home/user && npm i --no-save playwright@1.56.1`.

## Where things live
- `references` branch (never deployed): primary sources (refs/<id>.txt, index.json, refs.yml fetches them),
  Sig's uploads in manual/ (RMA LRP handbook text; Bing AI performance exports in manual/bing-ai-performance/2026-10-16/).
- `lrp-history` branch: raw RMA LRP offers and ending values.
- `raw` branch (never deployed, Oct 16): raw build inputs no page reads, same paths as they had on main: the Farmland Atlas pulls
  (data/atlas/raw/*, except drought.json which stays on main) and every probe capture (data/*-raw/, data/drought/probe/).
  Workflows save them with scripts/push_raw.sh; farmland-atlas.yml unpacks them with scripts/pull_raw.sh. The paths are in
  .gitignore on main. Local Atlas build: `bash scripts/pull_raw.sh data/atlas/raw`. data/fsa stays on main (arc-plc --check reads it).
- TODO-SIG.md: Sig's own to-do list; the morning report email shows it.
- Subscriber counts: the subscriber-count skill (counts only, never an address). sponsor-report.yml also prints
  signups by page and the rent / rain-gauge notice lists as job annotations.

## State on Oct 16
- Live today: /lrp redesign (calculator first, stats on /lrp/record); fertilizer prices from 4 Kansas co-ops only
  (scripts/coop_fert_sources.json, fertilizer-coops.yml weekdays 13:41 UTC, data/fertilizer-prices.json is the one shared
  price file); Rain Print opens with normals and remarkable days on; Harvest price tracker under Markets.
- Subscribers 146 (about 3 a day). Rent notice list 5, rain gauge waitlist 2.
- Reminder set for Mon Oct 19: help Sig find more retailer fertilizer price pages (WI, IA, MN, IL first).

- Oct 16 later: site audit panel (report: Claude artifact "Harvest site audit"). Shipped from it: cash-bid fixes (outlier bids flagged never Best,
  delivery point in town headlines, road miles x1.25, Read vs Posted, clean elevator names via data/elevator-names.json), /grain-shrink,
  /nutrient-removal (A2809 numbers; fertilizer page and Fast Facts now match), soybeans on /grain-emc, /hay-prices (NASS, monthly),
  /cattle-auction-prices (USDA AMS auction PDFs; parser fixed against real reports, fixtures in test/fixtures/cattle-auction/).

## State on Oct 17 (overnight, cache v152)
- Live: Daily "Only on AGSIST" facts + local line + Sig's note slot (data/cca-note.json); /cash-bid-index (cron on the 1st, approved);
  true CBOT settles (fetch_prices v3.7 close_kind, settle vs last trade wording everywhere; hogs roll on the 10th business day);
  Rain Print on 13 x 19 paper with box letter (rp-insert.js; note printed on the letter, no card) and What's in the box;
  field scout land card: WI 72/72 + MN 36/87 parcel owners, Illinois MyDec transfers with names (acres_rule 2; robots disallows /data/land/);
  break-even rebuilt on farmdoc 2027 budgets, county fill, state median basis, Dec '27 default; phone folds on futures pages;
  state cash line under prices (price-local.js); tariffs China gauge (FAS ESR) and FBA trade-aid row (verified at FSA); Census county names.
- Re-score 7 (scratchpad report/rescore-7.json): all 54 scored pages ahead of their best saved competitor, average 43.5.
- FFAI fixes ready on farmers1st branch fx/ffai-audit (labels LOW..HIGH vs 1995-2019, year-ago headline, stress track record).
  The deploy to farmers1st main was blocked by the permission check: waits on Sig.
- WI sales (eRETR) sit behind DOR's My Tax Account app; MN eCRV extract is request-only (ecrv.support@state.mn.us); Iowa has no free file.
  Raw-branch pushes from the land workflow are refused by a repo rule (needs Sig in settings).

## Open items
- Sig to decide: Oct 16 Daily correction (expired hogs $75.55); WI headless fetch vs emailing DOR; emailing MN for eCRV; FFAI push;
  textured paper pick (then change "matte paper" wording); real mat window measurement (components/rain-print.js SHEET).
- Sig: STRIPE_READ_KEY secret (restricted, read Charges + Checkout Sessions); the $19 test order (costs ~85 cents after refund);
  submit sitemaps in Search Console; Rain Print gift-guide pitches by Oct 31.
- Bunge Ladoga (Haw Creek) email bid reader in dnilgis/bids (waits on Sig's Gmail app password).
- Sale barns: 21 of 40 sources read. 18 barns need their AMS report number (the probe's listing fetch failed; fix listing_slugs/probe);
  Sioux Falls is wired to a slaughter report. scripts/cattle_auction_sources.json.
- dnilgis/bids: week rows can hide month rows in merge_bids.mjs dedupe(); patch drafted (session scratchpad, bids-dedupe.patch) but needs the
  agsist side to prefer whole-month rows first. This session could not attach the bids repo.
- USDA payments: data/payments covers 21 states only; Sig downloads all FY2025 FSA payment xlsx files (FSA blocks datacenters), then
  scripts/process_payments.py runs locally. Build /payments only with all states or a clear "21 states" label.
- Soybean EMC low fit (Modified Henderson constants) is from ASAE D245 memory, matched to Minnesota and Hellevang's two figures (10.2% 2015 slide, 13.5% 2020 release); NDSU's 2011 table matches neither fit (22 of 30 cells outside the range, pinned in tests). D245 itself is paywalled; listing saved to references.
- Gap list from the audit (not built): fall anhydrous soil-temp go/no-go by county (window is now), harvest now or wait in dollars,
  CCC loan calculator, combine loss check, DDGS feed value.

## What the Bing AI data says (Oct 16 exports)
- AI answers cited agsist about 500 to 800 times a weekday in mid-July and 2,300 to 2,800 by October; cited pages went from ~20 to ~118.
- Strongest: cash bids by ZIP (grain bids by zip code 54% share, cash grain prices by zip 44%) and named elevators
  (town pages). Price-today queries are the volume (corn prices today 5,762 citations at 20%).
- Weak share where AGSIST has a page: WASDE (3%), crop progress (4%), Pro Farmer crop tour 2026 (2%), fertilizer prices (9%),
  crop yield (4%). Opportunity queries on mission: farm bill 2026, cattle prices / beef shortage / screwworm, USDA payments
  to farmers, heifer retention, tariff impact. Sugar, rice and general weather are off mission.
