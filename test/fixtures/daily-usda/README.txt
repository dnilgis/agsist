Fixtures for scripts/test_daily_usda.py (the USDA lines handed to the Daily's writer).

The real files as of the Nov 2, 2026 reports, copied unchanged from the branches that
build them (they land on main as their PRs merge):
  data/state-grain-ams.json   fx/marsgrain (#267): Gulf export bids, top daily_line
  data/slaughter.json         fx/marsgrain (#267): USDA estimated FI slaughter, Nov 2
  data/production-costs.json  fx/marsfert (#269): dealer fertilizer and farm diesel, Oct 30
  data/ethanol-bids.json      fx/marseth (#271): ethanol plant corn bids, Nov 2
  data/hog-cash.json          fx/hogprobe (#268): written by that branch's
                              scripts/fetch_hog_cash.py run() from its real Nov 2 captures
                              (test/fixtures/hog-cash/lm_hg201_2026-11-02.txt and
                              lm_pk602_2026-11-02.txt, nearby futures 58.375 as in its
                              selftest), at 2026-11-02T21:45:00Z. No number was typed by hand.
