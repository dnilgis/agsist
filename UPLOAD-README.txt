PROBE EPIC-2 KIT — 2 files, 5 minutes
=====================================

WHAT THIS IS
A read-only diagnostic that settles the data questions behind the next
three NASS-backed pages (who-owns-the-ground, storage crunch,
conditions-vs-yield). It writes nothing and commits nothing.
The other two pages don't need it: per-state rent pages build from data
we already have, and the payments page waits on your FSA downloads
(see FSA-DOWNLOAD-LIST.txt).

UPLOAD (never bulk-drag to root!)
1. github.com/dnilgis/agsist -> open the  scripts/  folder ->
   "Add file > Upload files" -> drop  probe_epic2.py  -> commit.
2. Open  .github/workflows/  -> "Add file > Upload files" ->
   drop  probe-epic2.yml  -> commit.

RUN
3. Actions tab -> "probe-epic2" -> "Run workflow" (green button).
4. When it finishes (up to ~30 min - it walks 26 years of IA history
   politely), open the run -> "Probe epic-2 data sources" step ->
   copy the WHOLE log -> paste it to me.

That log decides how three pages get designed. No guessing.
