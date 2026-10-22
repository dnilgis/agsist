#!/bin/bash
# Every ship check, run from the repo root (or a worktree): prints ok/FAIL per check, then FAILS=N.
# Push only on FAILS=0 (the exit status is 0 only then). Usage: scripts/dev/checks.sh   (from anywhere inside the checkout)
#   --list            print the name of every check that would run, run nothing
#   --only=a,b        run only the named checks (names as --list prints them)
#   --skip-node       every check except node-test
#   --shard=N/M       node-test runs only its share of the test files (node --test --test-shard=N/M)
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
NT="$OUT/nt${SHARD:+-${SHARD%/*}of${SHARD#*/}}.out"
# AGSIST_NO_SKIPS=1 (the PR checks set it): a skipped node test fails node-test too; a skip is not a pass
run node-test bash -c "node --test ${SHARD:+--test-shard=$SHARD} > '$NT' 2>&1; grep -E '^# fail 0$' '$NT' >/dev/null || { grep -E '^# (pass|fail)' '$NT'; grep -B2 -A15 -E '^\s*not ok' '$NT' | head -60; exit 1; }; [ \"\${AGSIST_NO_SKIPS:-}\" != 1 ] || grep -E '^# skipped 0$' '$NT' >/dev/null || { grep -E '^# (pass|fail|skipped)' '$NT'; echo 'a skipped test is not a pass (AGSIST_NO_SKIPS=1, as in pr-checks):'; grep -E '^\s*ok [0-9]+ - .* # SKIP' '$NT' | head -40; exit 1; }"
run seo python3 scripts/check_seo.py
run budget python3 scripts/check_site_budget.py
run layers python3 scripts/check_layers.py
run place-pct python3 scripts/build_place_pct.py --check
run nav python3 scripts/inject_static_nav.py --check
run feeds bash -c 'python3 scripts/build_feeds.py && python3 scripts/test_feeds.py'
for f in network-checks delivery-checks market-clock-checks network-safety-checks homepage-bids-checks sponsor-checks; do run $f node scripts/$f.mjs; done
for t in scripts/test_send_loops.py scripts/test_list_fallback.py scripts/test_basis_states.py scripts/test_share_images.py scripts/test_fact_check.py scripts/test_sponsor_portal.py scripts/test_rate_card.py; do [ -f $t ] && run "$(basename $t)" python3 $t; done
run llms bash -c "python3 scripts/build_llms_txt.py --selftest && python3 scripts/build_llms_txt.py --check"
# number consistency: rule selftests must pass; on the real data it reports only (prints, never fails) until it has run clean
run numbers bash -c "python3 scripts/check_number_consistency.py --selftest >/dev/null && python3 scripts/check_number_consistency.py > '$OUT/numbers.out' 2>&1; tail -1 '$OUT/numbers.out' >&2; true"
run site-check python3 scripts/daily_site_check.py --selftest
run ids python3 scripts/build_ids.py --selftest
run basis-join bash -c "python3 scripts/build_basis_join.py --selftest && python3 scripts/build_basis_join.py --check"
run worker node scripts/test_form_worker.mjs
run share python3 scripts/build_share_images.py --check
for b in build_arc_plc build_breakeven_data build_prf_states build_prf_counties build_county_rain stamp_prf build_croptour build_farmbill; do [ -f scripts/$b.py ] && run $b python3 scripts/$b.py --check; done
# a name given to --only that is not a check is a typo, not a pass
if [ -n "$ONLY" ]; then
  IFS=, read -ra asked <<< "${ONLY#,}"
  for n in "${asked[@]}"; do [ -z "$n" ] && continue; case "$seen" in *",$n,"*) ;; *) echo "FAIL unknown check '$n' (scripts/dev/checks.sh --list)"; fails=$((fails+1)) ;; esac; done
fi
[ "$LIST" = 1 ] && [ "$fails" = 0 ] && exit 0
echo "FAILS=$fails"
[ "$fails" -eq 0 ]
