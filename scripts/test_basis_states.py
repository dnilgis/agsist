#!/usr/bin/env python3
"""NO ELEVATOR IS WRITTEN TO A SHARD THE PAGE CANNOT ASK FOR.

    python3 scripts/test_basis_states.py

cash-bids.html fetches /data/basis/{STATE}.json. build_basis_history.py used to
bucket on `st or "??"`, and there is no control on that page — and no state in
the union — that can ever ask for "??". Every row that landed there was basis
history collected, written, committed and unreachable.

Two rows were in it. One of them states its own state:

    HILLSIDE GRAIN, LLC | GOLDEN CITY, MO
    ONE EARTH ENERGY    | GIBSON CITY

Reading "MO" off the end of a city field is reading. Inferring "IL" from
"GIBSON CITY" because a person happens to know Illinois is guessing, and Rule 1
says do not — so that row stays stateless and gets NAMED in the run instead of
filed somewhere nobody can open.

The function is LIFTED out of build_basis_history.py, so this cannot pass
against a version the script no longer has.
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = (ROOT / "scripts" / "build_basis_history.py").read_text(encoding="utf-8")

fails, passes = [], 0


def check(cond, msg):
    global passes
    if cond:
        passes += 1
    else:
        fails.append(msg)


# ── lift US_STATES and state_of ───────────────────────────────────────────
i = SRC.find("    US_STATES = frozenset(")
j = SRC.find("    by_state, stateless = {}, []")
check(i >= 0, "build_basis_history.py no longer defines US_STATES in write_shards()")
check(j > i, "build_basis_history.py no longer bucketing after state_of()")
if i < 0 or j <= i:
    for f in fails:
        print("FAIL: " + f)
    sys.exit(1)

body = "\n".join(ln[4:] if ln.startswith("    ") else ln
                 for ln in SRC[i:j].splitlines())
ns = {"frozenset": frozenset, "len": len}
exec(compile(body, "<lifted from build_basis_history.py>", "exec"), ns)
state_of = ns["state_of"]
US_STATES = ns["US_STATES"]

# ── the bucket that could never be read is gone ───────────────────────────
# THE DEFECT ITSELF, NOT THE PROSE EXPLAINING IT. A first cut asked whether
# the string "??" appeared anywhere in the file and failed on the comment that
# describes why it was removed — comments are not coverage, and here they were
# not evidence of a bug either.
check("setdefault(st or" not in SRC,
      'build_basis_history.py still buckets on `st or "??"`, so rows with no '
      "state go to a shard cash-bids.html can never fetch")
_code = "\n".join(ln for ln in SRC.splitlines() if not ln.lstrip().startswith("#"))
check('by_state.setdefault("??"' not in _code and "'??'," not in _code,
      'a "??" shard is still being written somewhere in the bucketing code')

# ── a state the row carries is read ───────────────────────────────────────
check(state_of("GOLDEN CITY, MO", None) == "MO",
      "Hillside Grain's own city field says MO and it was not read")
check(state_of("Petrolia, ON", None) is None,
      "an Ontario address was accepted as a US state shard")
check(state_of("Bloomer, wi", None) == "WI", "a lowercase state code was not read")
check(state_of("Elk Mound , WI ", None) == "WI", "whitespace defeated the read")

# ── and a state the row does NOT carry is never invented ──────────────────
check(state_of("GIBSON CITY", None) is None,
      "a state was invented for a city that does not state one — Rule 1")
check(state_of("", None) is None, "an empty city produced a state")
check(state_of(None, None) is None, "a missing city threw or produced a state")
check(state_of("SIOUX CITY, XX", None) is None,
      "'XX' was accepted as a state, so a typo becomes a shard nobody fetches")
check(state_of("KANSAS CITY, MISSOURI", None) is None,
      "a spelled-out state was read as a two-letter code")

# ── an explicit state always wins over the city string ────────────────────
check(state_of("GOLDEN CITY, MO", "KS") == "KS",
      "the row's own state field was overridden by its city string")

# ── the set is the union, not a subset somebody trimmed ───────────────────
for code in ("WI", "MN", "IA", "IL", "MO", "KS", "NE", "ND", "SD", "TX", "OH", "IN"):
    check(code in US_STATES, "%s is missing from US_STATES" % code)
check("ON" not in US_STATES and "BC" not in US_STATES,
      "a Canadian province is in the US state set")

# ── the stateless rows are named, not counted ─────────────────────────────
check("::warning::" in SRC,
      "rows with no state are dropped without any annotation — they would "
      "disappear as quietly as the ?? shard did")
check("facility" in SRC[SRC.find("stateless.append"):SRC.find("stateless.append") + 120],
      "the stateless report does not name the elevator, so nobody can fix it")

if fails:
    for f in fails:
        print("FAIL: " + f)
    print("\n%d passed, %d failed" % (passes, len(fails)))
    sys.exit(1)
print("basis states: %d passed — a state written in the row is read, a state that "
      "is not there is never invented, and nothing is filed where the page cannot "
      "look" % passes)
