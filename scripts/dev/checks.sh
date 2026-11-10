#!/bin/bash
# Every ship check, run from the repo root (or a worktree): prints ok/FAIL per check, then FAILS=N.
# Push only on FAILS=0 (the exit status is 0 only then). Usage: scripts/dev/checks.sh   (from anywhere inside the checkout)
#   --list            print the name of every check that would run, run nothing
#   --only=a,b        run only the named checks (names as --list prints them)
#   --skip-node       every check except node-test
#   --shard=N/M       node-test runs only its share of the test files (node --test --test-shard=N/M;
#                     with AGSIST_TEST_FILES set, its share of those files: scripts/dev/node-tests.sh)
# This file is the one list of ship checks. .github/workflows/pr-checks.yml runs it the same way
# (node-test in 4 shards, then --skip-node), so the PR checks and the local checks cannot drift.
cd "$(git rev-parse --show-toplevel)" || exit 1
LIST=0; ONLY=""; SKIPNODE=0; SHARD=""
for a in "$@"; do
  case "$a" in
    --list) LIST=1 ;;
    --only=*) ONLY=",${a#--only=}," ;;
    --skip-node) SKIPNODE=1 ;;
    --shard=*) SHARD="${a#--shard=}"
      [[ "$SHARD" =~ ^[1-9][0-9]*/[1-9][0-9]*$ ]] && [ "${SHARD%/*}" -le "${SHARD#*/}" ] || { echo "checks.sh: --shard wants N/M with 1<=N<=M, not '$SHARD'" >&2; exit 2; } ;;
    -h|--help) sed -n '2,8p' "$0"; exit 0 ;;
    *) echo "checks.sh: unknown option '$a' (see --help)" >&2; exit 2 ;;
  esac
done
OUT="${TMPDIR:-/tmp}/agsist-checks"; mkdir -p "$OUT"
# optional: QR decode tests use jsqr if JSQR_PATH points at it
fails=0; seen=","
picked(){ [ "$SKIPNODE" = 1 ] && [ "$1" = node-test ] && return 1; [ -z "$ONLY" ] && return 0; case "$ONLY" in *",$1,"*) return 0 ;; esac; return 1; }
want(){ seen="$seen$1,"; picked "$1"; }
run(){ name="$1"; shift; want "$name" || return 0; [ "$LIST" = 1 ] && { echo "$name"; return 0; }
  out=$("$@" 2>&1); rc=$?; if [ $rc -ne 0 ]; then echo "FAIL $name"; echo "$out" | tail -25; fails=$((fails+1)); else echo "ok   $name"; fi; }
# FSA's program files live on the raw branch (Oct 20); build_arc_plc.py (--check, --selftest) and the node tests need them
if [ "$LIST" = 0 ] && { picked node-test || picked build_arc_plc; }; then
  ls data/fsa/arcco_*.xls* >/dev/null 2>&1 || bash scripts/pull_raw.sh data/fsa >/dev/null || { echo "FAIL fsa-pull (bash scripts/pull_raw.sh data/fsa)"; fails=$((fails+1)); }
fi
# the Atlas drought pull moved to raw too (Oct 29); test/drought-county-week.test.mjs reads it
if [ "$LIST" = 0 ] && picked node-test; then
  [ -s data/atlas/raw/drought.json ] || bash scripts/pull_raw.sh data/atlas/raw/drought.json >/dev/null || { echo "FAIL drought-pull (bash scripts/pull_raw.sh data/atlas/raw/drought.json)"; fails=$((fails+1)); }
  # builder-only data moved off main on Nov 4 (test/raw-readers.test.mjs); test/funds-weekly.test.mjs reads this one
  [ -s data/cot-deep.json ] || bash scripts/pull_raw.sh data/cot-deep.json >/dev/null || { echo "FAIL cot-deep-pull (bash scripts/pull_raw.sh data/cot-deep.json)"; fails=$((fails+1)); }
fi
# AGSIST_PREBUILD=1 (the PR checks and main-checks.yml set it): first build the files that are built on
# main (scripts/dev/main_build.py: What's new, the changelog, the test map) in this copy, so every check
# sees what main will serve. A pull request never commits them (the built-guard line below).
if [ "$LIST" = 0 ] && [ "${AGSIST_PREBUILD:-}" = 1 ]; then
  pb=$(python3 scripts/dev/main_build.py build 2>&1) || { echo "FAIL prebuild (python3 scripts/dev/main_build.py build)"; echo "$pb" | tail -25; fails=$((fails+1)); }
fi
# AGSIST_GEN_BASE (the PR checks set it): a generated page set whose builder the change touches is rebuilt in this
# copy too (scripts/generated_sets.py prebuild), so its --check and the tests see what main will serve after
# the rebuild there. Nothing is committed: generated pages are built on main.
if [ "$LIST" = 0 ] && [ "${AGSIST_PREBUILD:-}" = 1 ] && [ -n "${AGSIST_GEN_BASE:-}" ]; then
  gp=$(python3 scripts/generated_sets.py prebuild --base "$AGSIST_GEN_BASE" 2>&1); grc=$?
  echo "$gp" | grep -E '^prebuild' >&2
  [ $grc = 0 ] || { echo "FAIL gen-prebuild (python3 scripts/generated_sets.py prebuild --base $AGSIST_GEN_BASE)"; echo "$gp" | tail -25; fails=$((fails+1)); }
fi
NT="$OUT/nt${SHARD:+-${SHARD%/*}of${SHARD#*/}}.out"
# AGSIST_NO_SKIPS=1 (the PR checks set it): a skipped node test fails node-test too, a skip is not a pass
# (scripts/dev/check-skips.sh; test/skips-allowed.txt holds the either/or pairs it accepts)
DEV="$PWD/scripts/dev"
run node-test bash -c "bash '$DEV/node-tests.sh' '$NT' '$SHARD'; grep -E '^# fail 0$' '$NT' >/dev/null || { grep -E '^# (pass|fail)' '$NT'; grep -B2 -A15 -E '^\s*not ok' '$NT' | head -60; exit 1; }; [ \"\${AGSIST_NO_SKIPS:-}\" != 1 ] || bash '$DEV/check-skips.sh' '$NT'"
# built on main, never by hand in a branch; the inputs (data/whats-new/ entries, data/changelog.json) valid;
# and the built files fresh (true after the prebuild above, and on main after main-checks.yml commits them)
run built-guard python3 scripts/dev/main_build.py guard
run built-inputs python3 scripts/dev/main_build.py validate
run built-files python3 scripts/dev/main_build.py check
run seo python3 scripts/check_seo.py
run budget python3 scripts/check_site_budget.py
run layers python3 scripts/check_layers.py
run place-pct python3 scripts/build_place_pct.py --check
run nav python3 scripts/inject_static_nav.py --check
run feeds bash -c 'python3 scripts/build_feeds.py && python3 scripts/test_feeds.py'
for f in network-checks delivery-checks market-clock-checks network-safety-checks homepage-bids-checks sponsor-checks; do run $f node scripts/$f.mjs; done
for t in scripts/test_send_loops.py scripts/test_daily_delivery_line.py scripts/test_list_fallback.py scripts/test_basis_states.py scripts/test_basis_companies.py scripts/test_basis_usda.py scripts/test_ownership_changes.py scripts/test_share_images.py scripts/test_fact_check.py scripts/test_sponsor_portal.py scripts/test_rate_card.py; do [ -f $t ] && run "$(basename $t)" python3 $t; done
run llms bash -c "python3 scripts/build_llms_txt.py --selftest && python3 scripts/build_llms_txt.py --check"
# number consistency: rule selftests must pass; on the real data it reports only (prints, never fails) until it has run clean
run numbers bash -c "python3 scripts/check_number_consistency.py --selftest >/dev/null && python3 scripts/check_number_consistency.py > '$OUT/numbers.out' 2>&1; tail -1 '$OUT/numbers.out' >&2; true"
run site-check python3 scripts/daily_site_check.py --selftest
# a correction USDA published (data/usda-corrections.json) is shown beside the printed figure wherever it is used
run usda-corrections bash -c "python3 scripts/usda_corrections.py --selftest >/dev/null && python3 scripts/usda_corrections.py --check"
run ids python3 scripts/build_ids.py --selftest
# company ids on evidence only (scripts/company_ids.py, Nov 9 2026): rules selftest, then the committed file
run company-ids bash -c "python3 scripts/company_ids.py --selftest && python3 scripts/company_ids.py --check"
# buyer and seller names out of the county transfer files (scripts/land_names.py, PR 324, Nov 4, 2026)
run land-names python3 scripts/land_names.py --selftest
run basis-join bash -c "python3 scripts/build_basis_join.py --selftest && python3 scripts/build_basis_join.py --check"
# county code table and per data set join rates (scripts/join_report.py FLOORS): a rate below its floor fails
run geo-crosswalk bash -c "python3 scripts/build_geo_crosswalk.py --selftest && python3 scripts/build_geo_crosswalk.py --check"
run join-report bash -c "python3 scripts/join_report.py --selftest >/dev/null && python3 scripts/join_report.py"
run worker node scripts/test_form_worker.mjs
run share python3 scripts/build_share_images.py --check
for b in build_arc_plc build_breakeven_data build_prf_states build_prf_counties build_county_rain build_land_sales cash_bid_index stamp_prf build_croptour build_farmbill; do [ -f scripts/$b.py ] && run $b python3 scripts/$b.py --check; done
# a name given to --only that is not a check is a typo, not a pass
if [ -n "$ONLY" ]; then
  IFS=, read -ra asked <<< "${ONLY#,}"
  for n in "${asked[@]}"; do [ -z "$n" ] && continue; case "$seen" in *",$n,"*) ;; *) echo "FAIL unknown check '$n' (scripts/dev/checks.sh --list)"; fails=$((fails+1)) ;; esac; done
fi
[ "$LIST" = 1 ] && [ "$fails" = 0 ] && exit 0
echo "FAILS=$fails"
[ "$fails" -eq 0 ]
