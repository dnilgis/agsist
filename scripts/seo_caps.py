"""seo_caps.py: the site's one title and meta description length cap.

Night SEO audit, Oct 19, 2026: one quantity had five caps (bake_seo 68, PRF 75,
county rain none for titles and 165 for descriptions, check_seo 170) and 2,679
indexable titles ran past 68. Every builder that fits a title or a description
reads these, and check_seo.py warns past them. A builder may hold itself to less
(cash bids and ARC/PLC keep titles to 60, pinned by their selftests; the Daily
keeps its whole headline, scripts/generate_daily.py says why) but never more.

When a title runs long, " | AGSIST" gives way first (Google shows the site name
above the result anyway), then words; a number in the title goes last.
"""
TITLE_MAX = 68          # Google truncates around 600px; 68 characters is a safe ceiling
DESC_MAX = 160          # Google's snippet length
SUFFIX = " | AGSIST"


def fit(cands, cap=TITLE_MAX):
    """The first candidate that fits the cap, else the shortest one."""
    cands = [c for c in cands if c]
    for c in cands:
        if len(c) <= cap:
            return c
    return min(cands, key=len) if cands else ""
