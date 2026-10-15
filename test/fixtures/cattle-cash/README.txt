Fixtures for scripts/fetch_cattle_cash.py --selftest.

These two files are REAL captures: the pdftotext output of the USDA AMS PDFs
that the cattle-cash workflow saved with "probe" ticked on 2026-10-15
(data/cattle-cash-raw/). They are copied here unchanged so the selftest keeps
reading the real layout after data/cattle-cash-raw/ is overwritten.

  lm_xb403_2026-10-14.txt  LM_XB403 boxed beef cutout, PM, October 14, 2026
                           (Choice 376.50, Select 358.47, spread 18.03)
  lm_ct150_2026-10-11.txt  LM_CT150 5-area weekly, week ending 10/11/2026
                           (steers live FOB, total all grades 19,561 head at
                           220.14; matches the "Live FOB Steer" weekly row)

The row-per-line reconstructions inside the script (CUTOUT_FIX, STEER_FIX)
are kept as a second layout; their numbers came from search snippets.
