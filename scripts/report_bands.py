#!/usr/bin/env python3
"""
report_bands.py — one definition of "in line", used by everything that says it.

WHY THIS FILE EXISTS

On 2026-09-09 the What's Priced In page said two different things about one
number, on one screen, at the same time:

    Track record   2026/27 corn yield   BULLISH    182.0 -> 180.7
    Graded calls   2026/27 corn yield   IN LINE    trade 182 -> actual 180.7

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


def surprise(expected, actual, metric_label=""):
    """"bullish" | "bearish" | "in line" | "" — and "" means NOT COMPARABLE.

    A print BELOW the trade estimate is bullish (less supply than expected) and
    above it is bearish. That convention holds for ending stocks, production and
    yield alike, which is why one function can serve all three.

    The empty string is the important return. It means there was no estimate to
    compare against, and a caller must print that in words rather than let a
    reader assume the print was unremarkable.
    """
    if expected in (None, 0) or actual is None:
        return ""
    gap = (actual - expected) / abs(expected)
    if abs(gap) <= band_for(metric_label):
        return "in line"
    return "bullish" if actual < expected else "bearish"


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
