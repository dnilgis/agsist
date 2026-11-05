"""Credit lines that must travel with other people's data.

One place for the wording, so a builder, a page and an email print the same
sentence. USDA NASS asks that anything built on its Quick Stats API carry the
notice below. Figures AGSIST works out from NASS numbers (averages, trends,
ranks, estimates) are labelled as ours wherever they are shown.
"""

NASS_NOTICE = "This product uses the NASS API but is not endorsed or certified by NASS."
AGSIST_CALC = "Averages, trends, ranks and estimates are calculations by AGSIST."
NASS_CREDIT = NASS_NOTICE + " " + AGSIST_CALC
