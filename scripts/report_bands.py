#!/usr/bin/env python3
"""
report_bands.py — one definition of "in line", used by everything that says it.

WHY THIS FILE EXISTS

On 2026-09-09 the What's Priced In page said two different things about one
number, on one screen, at the same time:

    Track record   2026/27 corn yield   BULLISH    182.0 -> 180.7
    Scored report  2026/27 corn yield   IN LINE    trade 182 -> actual 180.7

Same metric, same consensus, same print. Two builders, two bands.
build_whats_priced_in.py had been corrected on 2026-08-11 —

    "a flat 2% band is calibrated for ending stocks (2% of 2.1B bu = ~42M,
     sane) but absurd for YIELD (2% of 183 bu = 3.7 bu — nearly any August
     print would score 'in line'). Yield metrics get a tighter band: 0.5% of
     expected (~0.9 bu on corn, ~0.26 on beans) matches how the trade actually
     reads a yield print."

— and build_analyst_scorecard.py had not. Standing rule 37: two places applying
"the same" threshold must apply it to the same quantity. Export one function and
have both callers use it.

THE SECOND THING THIS FIXES. Both copies returned "in line" when there was NO
consensus to compare against:

    if consensus in (None, 0) or actual is None:
        return "in line"

That is not a withheld number, it is an asserted one — the page told a reader
that a print nobody had an estimate for landed where the trade expected. It now
returns "" and every caller prints the reason instead.

    python3 scripts/report_bands.py --selftest
"""
import sys

# Within this much of the trade estimate counts as landing where the trade
# expected. Stocks-type metrics run in the billions of bushels and move in
# tens of millions; yields run in the tens and move in tenths.
IN_LINE_PCT = 0.02
IN_LINE_PCT_YIELD = 0.005

# WHAT COUNTS AS A YIELD METRIC. Matched on the label because that is what both
# source files carry — "2026/27 corn yield", "2026/27 soybean yield". Written as
# a list rather than one substring so a future "yield per harvested acre" or
# "trend yield" lands in the same band without anyone having to notice.
YIELD_WORDS = ("yield",)


def band_for(metric_label):
    """The in-line band for this metric, as a fraction of the estimate."""
    label = str(metric_label or "").lower()
    return IN_LINE_PCT_YIELD if any(w in label for w in YIELD_WORDS) else IN_LINE_PCT


def _range(low, high):
    """(lo, hi) when both bounds are usable numbers in order, else None."""
    if low is None or high is None:
        return None
    try:
        lo, hi = float(low), float(high)
    except (TypeError, ValueError):
        return None
    return (lo, hi) if lo <= hi else None


def surprise(expected, actual, metric_label="", low=None, high=None):
    """"bullish" | "bearish" | "in line" | "" — and "" means NOT COMPARABLE.

    THE TRADE RANGE COMES FIRST (2026-10-03). When the survey's own low and high
    are on file, a print outside them is the surprise and a print inside them is
    not: some analyst on record expected that level. The September 2026 soybean
    stocks print (0.315 against a 0.324 average, range 0.304-0.349) was called
    "bullish, in range" because 2.8% under the average cleared the 2% band. That
    told a reader two things at once. Inside the range there is no bullish or
    bearish label now; describe() says which side of the average it fell.
    Only when no range is on file does the percentage band below decide.

    A print BELOW the trade estimate is bullish (less supply than expected) and
    above it is bearish. That convention holds for ending stocks, production and
    yield alike, which is why one function can serve all three.

    The empty string is the important return. It means there was no estimate to
    compare against, and a caller must print that in words rather than let a
    reader assume the print was unremarkable.
    """
    if expected in (None, 0) or actual is None:
        return ""
    rng = _range(low, high)
    if rng:
        if actual < rng[0]:
            return "bullish"
        if actual > rng[1]:
            return "bearish"
        return "in line"
    gap = (actual - expected) / abs(expected)
    if abs(gap) <= band_for(metric_label):
        return "in line"
    return "bullish" if actual < expected else "bearish"


def describe(expected, actual, metric_label="", low=None, high=None):
    """The words a card prints beside the grade. One function, so the homepage card
    and What's Priced In cannot phrase the same print two ways.

      outside the range -> "below the trade range, bullish" / "above the trade range, bearish"
      inside the range  -> "2.8% below average, inside the range" (no bullish or bearish word)
      no range on file  -> the band's verdict: "bullish" / "bearish" / "in line"
      nothing to grade  -> "no trade estimate" / "not printed yet"
    """
    if actual is None:
        return "not printed yet"
    if expected in (None, 0):
        return "no trade estimate"
    v = surprise(expected, actual, metric_label, low, high)
    rng = _range(low, high)
    if not rng:
        return v
    if v == "bullish":
        return "below the trade range, bullish"
    if v == "bearish":
        return "above the trade range, bearish"
    # Inside the range there is no bullish or bearish word, but a professional
    # still grades on the gap to the average, so the size of it is printed.
    g = gap_pct(expected, actual)
    if not g:
        return "at the average, inside the range"
    return f"{abs(g):.1f}% {'below' if g < 0 else 'above'} average, inside the range"


def gap_pct(expected, actual):
    """Signed distance from the trade estimate, in percent, or None."""
    if expected in (None, 0) or actual is None:
        return None
    return round((actual - expected) / abs(expected) * 100, 1)


def _selftest():
    fails = []

    def check(got, want, label):
        ok = got == want
        print(("  ok    " if ok else "  FAIL  ") + label + ("" if ok else "  -- got %r want %r" % (got, want)))
        if not ok:
            fails.append(label)

    print("the two bands, on the real numbers that produced them")
    # August 2026 corn yield: trade 182.0, USDA 180.7. Gap 0.71%. Under the flat
    # 2% band this scored "in line" on one half of the page while the other half
    # called it bullish. 0.71% is outside 0.5%.
    check(surprise(182.0, 180.7, "2026/27 corn yield"), "bullish",
          "corn yield 182.0 -> 180.7 is bullish, not in line")
    check(surprise(182.0, 180.7, "2026/27 corn ending stocks"), "in line",
          "the same gap on a stocks metric IS in line")
    # August soybean yield: 52.9 -> 52.7 is 0.38%, inside the yield band.
    check(surprise(52.9, 52.7, "2026/27 soybean yield"), "in line",
          "soybean yield 52.9 -> 52.7 is in line")
    # June wheat ending stocks: 765 -> 744 is -2.7%, outside 2%.
    check(surprise(765, 744, "2026/27 wheat ending stocks"), "bullish",
          "wheat stocks 765 -> 744 is bullish")
    # May soybean ending stocks: 355 -> 310 is -12.7%.
    check(surprise(355, 310, "2026/27 soybean ending stocks"), "bullish",
          "soybean stocks 355 -> 310 is bullish")
    # June corn 25/26: 2.138 -> 2.145 is +0.33%, inside 2%.
    check(surprise(2.138, 2.145, "2025/26 corn ending stocks"), "in line",
          "corn stocks 2.138 -> 2.145 is in line")

    print("\nthe trade range is graded first (2026-10-03)")
    # September 2026 Grain Stocks, Pro Farmer survey published 2026-09-26.
    # Soybeans: average 0.324, range 0.304-0.349, print 0.315. -2.8% clears the 2%
    # band, but 0.315 is inside 0.304-0.349: some analyst expected it.
    check(surprise(0.324, 0.315, "Soybean stocks, all positions, Sept 1", 0.304, 0.349), "in line",
          "soy stocks 0.315 inside 0.304-0.349 is not bullish")
    check(surprise(0.324, 0.315, "Soybean stocks, all positions, Sept 1"), "bullish",
          "the same print with no range on file falls back to the 2% band")
    check(describe(0.324, 0.315, "Soybean stocks, all positions, Sept 1", 0.304, 0.349), "2.8% below average, inside the range",
          "and is described as 2.8% below average, inside the range")
    # Corn: average 1.918, range 1.843-2.005, print 2.095, above the top of the range.
    check(surprise(1.918, 2.095, "Corn stocks, all positions, Sept 1", 1.843, 2.005), "bearish",
          "corn stocks 2.095 above 2.005 is bearish")
    check(describe(1.918, 2.095, "Corn stocks, all positions, Sept 1", 1.843, 2.005), "above the trade range, bearish",
          "and says it cleared the range")
    # A print under the low end: hand-made, 0.300 under 0.304.
    check(describe(0.324, 0.300, "soy stocks", 0.304, 0.349), "below the trade range, bullish",
          "a print under the low end is bullish")
    # The ends of the range are inside it.
    check(surprise(0.324, 0.349, "soy stocks", 0.304, 0.349), "in line", "the high end itself is inside")
    check(describe(0.324, 0.330, "soy stocks", 0.304, 0.349), "1.9% above average, inside the range",
          "above average inside the range carries no bearish word")
    # Inside the range wins over the tight yield band too: 182.0 -> 180.7 is 0.7%,
    # outside 0.5%, but a hand-made range 179-185 contains it.
    check(surprise(182.0, 180.7, "2026/27 corn yield", 179.0, 185.0), "in line",
          "a yield inside its range is not bullish either")
    # A half range or a reversed range is no range: the band decides.
    check(surprise(182.0, 180.7, "2026/27 corn yield", 179.0, None), "bullish", "a missing high end means no range")
    check(surprise(182.0, 180.7, "2026/27 corn yield", 185.0, 179.0), "bullish", "a reversed range is ignored")
    check(describe(None, 1.846, "Wheat stocks", None, None), "no trade estimate", "wheat stocks with no estimate say so")
    check(describe(0.324, None, "soy stocks", 0.304, 0.349), "not printed yet", "an unreleased print says so")

    print("\nno estimate is not the same as no surprise")
    check(surprise(None, 180.7, "2026/27 corn yield"), "",
          "a metric with no consensus returns the empty string")
    check(surprise(0, 180.7, "corn yield"), "", "and so does a zero consensus")
    check(surprise(182.0, None, "corn yield"), "", "and so does an unreleased actual")

    print("\nthe band is chosen by the label, and says which it chose")
    check(band_for("2026/27 corn yield"), 0.005, "a yield label gets 0.5%")
    check(band_for("2026/27 corn ending stocks"), 0.02, "a stocks label gets 2%")
    check(band_for(""), 0.02, "an unlabelled metric gets the wider band, not the tighter one")
    check(band_for(None), 0.02, "and None does not throw")

    print("\nthe distance itself")
    check(gap_pct(182.0, 180.7), -0.7, "corn yield is 0.7% under the trade")
    check(gap_pct(765, 744), -2.7, "wheat stocks 2.7% under")
    check(gap_pct(None, 744), None, "no estimate, no distance")

    print()
    if fails:
        print("FAILED (%d): %s" % (len(fails), "; ".join(fails)))
        return 1
    print("report bands: all passed")
    return 0


if __name__ == "__main__":
    sys.exit(_selftest() if "--selftest" in sys.argv else 0)
