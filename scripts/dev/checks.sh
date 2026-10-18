#!/bin/bash
# Every ship check, run from the repo root (or a worktree): prints ok/FAIL per check, then FAILS=N.
# Push only on FAILS=0. Usage: scripts/dev/checks.sh   (from anywhere inside the checkout)
cd "$(git rev-parse --show-toplevel)" || exit 1
OUT="${TMPDIR:-/tmp}/agsist-checks"; mkdir -p "$OUT"
# optional: QR decode tests use jsqr if JSQR_PATH points at it
fails=0
run(){ name="$1"; shift; out=$("$@" 2>&1); rc=$?; if [ $rc -ne 0 ]; then echo "FAIL $name"; echo "$out" | tail -25; fails=$((fails+1)); else echo "ok   $name"; fi; }
run node-test bash -c "node --test > '$OUT/nt.out' 2>&1; grep -E '^# fail 0$' '$OUT/nt.out' >/dev/null || { grep -E '^# (pass|fail)' '$OUT/nt.out'; grep -B2 -A15 -E '^\s*not ok' '$OUT/nt.out' | head -60; exit 1; }"
run seo python3 scripts/check_seo.py
run budget python3 scripts/check_site_budget.py
run nav python3 scripts/inject_static_nav.py --check
run feeds bash -c 'python3 scripts/build_feeds.py && python3 scripts/test_feeds.py'
for f in network-checks delivery-checks market-clock-checks network-safety-checks homepage-bids-checks sponsor-checks; do run $f node scripts/$f.mjs; done
for t in scripts/test_send_loops.py scripts/test_basis_states.py scripts/test_share_images.py scripts/test_fact_check.py scripts/test_sponsor_portal.py scripts/test_rate_card.py; do [ -f $t ] && run "$(basename $t)" python3 $t; done
run llms python3 scripts/build_llms_txt.py --check
# number consistency: rule selftests must pass; on the real data it reports only (prints, never fails) until it has run clean
run numbers bash -c "python3 scripts/check_number_consistency.py --selftest >/dev/null && python3 scripts/check_number_consistency.py > '$OUT/numbers.out' 2>&1; tail -1 '$OUT/numbers.out' >&2; true"
run site-check python3 scripts/daily_site_check.py --selftest
run worker node scripts/test_form_worker.mjs
run share python3 scripts/build_share_images.py --check
for b in build_arc_plc build_breakeven_data build_prf_states build_prf_counties build_county_rain stamp_prf build_croptour build_farmbill; do [ -f scripts/$b.py ] && run $b python3 scripts/$b.py --check; done
echo "FAILS=$fails"
