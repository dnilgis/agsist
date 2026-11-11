Fixtures for scripts/fetch_hog_cash.py --selftest.

REAL captures from the hog probe run of 2026-11-03 (cattle-cash workflow,
hog_probe ticked, run 41562351917; the PDFs are on the raw branch under
data/hog-cash-raw/). Copied unchanged so the selftest keeps the real layout.

  lm_hg201_2026-11-02.txt         LM_HG201 (ams_2511.pdf), Nov 2, 2026, slaughter
                                  Oct 30-31: the runner's text, one cell per line
  lm_hg201_2026-11-02.layout.txt  the same PDF through pdftotext -layout
                                  (producer sold: negotiated 8,718 head, base
                                  64.49; all types 340,653 head, base 66.91)
  lm_pk602_2026-11-02.txt         LM_PK602 (ams_2498.pdf), Nov 2, 2026, runner text
  lm_pk602_2026-11-02.layout.txt  the same PDF through pdftotext -layout
                                  (carcass cutout 72.28, 310.84 loads = 272.50
                                  cuts + 38.34 trim, change +2.18 from 70.10)

DataMart answers from the same probe (LMR DataMart, no key), trimmed to the
fields the history backfill reads; every value unchanged:

  datamart_lm_hg201_barrows_gilts_2026-11-03.json  LM_HG201 section
                                  Barrows/Gilts, reports Oct 27 to Nov 2, every
                                  purchase type (Prod. Sold Negotiated Nov 2:
                                  8,718 head, base 64.49, the same as the PDF)
  datamart_lm_pk602_cutout_2026-11-03.json         LM_PK602 section Cutout and
                                  Primal Values, Oct 27 to Nov 2 (Nov 2 carcass
                                  72.28, the same as the PDF)
