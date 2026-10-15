Fixtures for scripts/fetch_fert_ams.py --selftest.

These are RECONSTRUCTIONS, not captures. The sandbox that wrote them could not
reach any usda.gov host, so the real ams_3195.pdf has never been read here.
The layout follows what public search snippets show of the My Market News
version of the report (product, grade, price range, average, "Per Ton",
F.O.B.). EVERY PRICE IN THESE FILES IS MADE UP for the test. None of them is a
USDA figure and none may ever be copied onto the site.

Once the workflow has run with probe ticked, data/fert-ams-raw/ams_3195.txt
holds the real pdftotext output. Add it here as a third fixture and assert
the parser reads it.
