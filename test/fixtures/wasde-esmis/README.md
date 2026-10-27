Test fixtures for scripts/read_wasde_text.py and the ESMIS steps of scripts/backfill_wasde.py.

- wasde-2026-10-09.txt: the cover lines and the U.S. wheat, corn and soybean tables of USDA's
  October 9, 2026 WASDE (WASDE-676), as `pdftotext -layout` prints data/wasde-pdf/wasde1026.pdf.
  These are USDA's published figures (public domain), cut down to the tables the reader uses.
- old-layout.txt: an older text layout (column rules, lower-case labels, two months under one
  market year). Every number in this file is invented for the tests; none is a USDA figure.
- esmis-order-*.html: listing pages in the order ESMIS really prints them (each release's files
  before its own link, the current release's files once more at the foot of every page, and
  2018 to 2021 files all named latest.*). The order was read off the Oct 27, 2026 crawl
  (history/wasde/esmis/index.json, private raw branch); the ids and links are trimmed copies.
