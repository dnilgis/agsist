# agsist

Static site (GitHub Pages). Before building, read notes/HANDOFF.md (START HERE), notes/STANDING-DECISIONS.md and
notes/BUILD-RULES.md in the private notes repo (dnilgis/feedbag, branch restoredcode).

- Never commit on main; work on an fx/* branch in its own worktree and open a pull request.
- The gate is the PR checks (.github/workflows/pr-checks.yml). While building: scripts/dev/quick.sh. The full
  scripts/dev/checks.sh only when CI is unavailable, never two at once.
- Generated page sets (scripts/generated_sets.py) are built on main: change the builder and its fixture tests, never
  commit a set's pages. Files built on main (What's new, changelog, test map: scripts/dev/main_build.py) are never
  edited by hand; a What's new note is one file in data/whats-new/.
- Code jobs take scripts/, test/ and build/ from the private engine branch (.github/actions/engine, .github/engine-paths).
- Size limits: scripts/check_site_budget.py (150 KB per generated page).
