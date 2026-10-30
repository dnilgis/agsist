#!/bin/bash
# .github/pages-kick.sh: start the site deploy (.github/workflows/pages.yml) right after a push to main.
#
# A push made with GITHUB_TOKEN starts no other workflow; a repository_dispatch
# does, and sending one needs only the contents: write the pushing job already
# holds. Called by the fast jobs (prices, markets, fetch_bids, daily) so new
# numbers reach readers about as fast as the branch deploy brought them.
#
# Off unless PAGES_FROM_ACTIONS=1 (the repository variable that goes on with
# Settings > Pages > Source = GitHub Actions). Never fails the caller: a missed
# start is picked up by the next fast job, and pages.yml skips a commit that is
# deployed already.
# Step env: GH_TOKEN: ${{ github.token }}, PAGES_FROM_ACTIONS: ${{ vars.PAGES_FROM_ACTIONS }}
[ "${PAGES_FROM_ACTIONS:-}" = 1 ] || exit 0
if [ -z "${GH_TOKEN:-}" ] || [ -z "${GITHUB_REPOSITORY:-}" ]; then
  echo "::warning::site deploy not started: no GH_TOKEN or GITHUB_REPOSITORY in this step"
  exit 0
fi
if gh api -X POST "repos/${GITHUB_REPOSITORY}/dispatches" -f event_type=pages-deploy >/dev/null 2>&1; then
  echo "site deploy started"
else
  echo "::warning::could not start the site deploy; the next fast job starts it"
fi
exit 0
