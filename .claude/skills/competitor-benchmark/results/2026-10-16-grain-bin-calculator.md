# Head to head: grain-bin-calculator.html, 2026-10-16

Our page: /home/user/agsist at d578415f0 (84 KB). Served locally and rendered at 390 x 844 and 1280 x 800. No sideways scroll at 390 (scrollWidth 390). The phone page is 8,512 px tall. The phone's first screen shows the byline, the date and the inputs, and the sticky bar reads "14,957 bu". The page needs no live data.

Competitors: scored only from the copies GitHub Actions saved on the references branch (fetched Oct 16, 16:06 UTC).
- GSI 40-Series (bench-grain-bin-calculator-1): **not in the Oct 16 fetch index**. Not readable, so its cells are "?".
- Brock BR-2286 (PDF, file dated 2022-01), Sukup metric spec sheet (PDF, L11283-032014S), UNL CropWatch, Omni Calculator, ToolGrit: all read.
- Phone could not be judged from a saved text copy, so HTML competitors are scored out of 45 with phone "?". For the two PDFs, phone is scored from the format itself.

## Scores (1-5)

| | First screen | Current | Accurate+sourced | Local/personal | Clear | Depth | Phone | Trust | Speed | Unique | Total | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **AGSIST** | 5 | 4 | 5 | 4 | 4 | 5 | 5 | 5 | 5 | 5 | **47** | rendered Oct 16; hand checks below |
| Brock BR-2286 | 3 | 2 | 5 | 2 | 4 | 3 | 2 | 4 | 3 | 3 | 31 | fetched Oct 16 (PDF, Jan 2022) |
| UNL CropWatch | 3 | 2 | 4 | 2 | 5 | 2 | ? | 5 | 4 | 2 | 29/45 | fetched Oct 16 (article dated Sept 14, 2012) |
| ToolGrit | 3 | 4 | 3 | 2 | 3 | 4 | ? | 3 | 4 | 3 | 29/45 | fetched Oct 16 (guide dated Feb 10, 2026) |
| Sukup spec sheet | 2 | 1 | 4 | 1 | 2 | 3 | 1 | 4 | 3 | 2 | 23 | fetched Oct 16 (metric PDF, Mar 2014 code) |
| Omni Calculator | 4 | 2 | 2 | 3 | 3 | 3 | ? | 2 | 2 | 2 | 23/45 | fetched Oct 16 |
| GSI 40-Series | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | not readable (not in fetch index) |

What the saved copies show:
- **Brock:** the footnote reads "Maximum Capacity for a bin allows for grain to be at a 28° angle of repose, starting one inch (25 mm) below the eave... based on ASAE Standard S413.1, with a compaction factor of 6%." Every model also has "Capacity with Drying or Aeration Floor" columns (low and high floor), plus US and metric tons for corn and wheat.
- **Sukup:** metric only (meters, metric tons). Commercial bins are given as ranges. Its footer says "Max. capacities are based on ASABE Standard S413.1 ... no plenum and grain peaked at 28o angle of repose with 6% compaction", and the specs "should only be used as estimates".
- **UNL:** "By Tom Dorn - Former Nebraska Extension Educator", dated Sept 14, 2012. Uses 0.628 x D² x H, 0.209 for the peak, and 0.8 bu/ft³ for flat storage. One worked example contains the typo "0209 x (30 x 30) x 6". The calculator itself is not in this copy; the article only links to it.
- **Omni:** the conversion constant is "0.7786 bushels per cubic feet", which is the imperial bushel and reads about 3.1% low against the US bushel (0.8036). Its curved-top formula, πR²·(2/3·R + H2), is not the volume of a dome. No author or date appears in the copy.
- **ToolGrit:** uses "1.2444 cubic feet per bushel", correct water-shrink math (20,000 bu at 20% dried to 15% = 18,824), headspace (12-18 in minimum), auger fill time and aeration CFM. It gives no sources or author. Checked by hand: 36 x 22 level = 17,996 bu, which it rounds to "17,900".

## Where we win
- One screen goes from bin size to volume bushels, market bushels at your test weight, water shrink plus handling loss, drying charged per wet bushel, and net dollars. The phone keeps a sticky total.
- The page explains a dealer chart's number instead of contradicting it. "Count it like: Plain 25°, no pack / Match my dealer's chart" plus the aeration floor input reproduces both GSI table rows to within 1.4%. No competitor read here explains its own basis against anyone else's.
- It now has a visible byline ("Sigurd Lindquist, Certified Crop Adviser (CCA) · Updated Oct 15, 2026") and a Sources block: ASABE EP413.2/WPACKING, Bhadra et al. 2015 and 2018 with DOIs, NCH-61, ISU drying and SDSU. That beats every competitor on sourcing except the Brock footnote.
- Sizing uses real ring heights (32 in GSI, 44 in Sukup). The 50,000 bu FAQ now names its basis.
- Bushel = 1.2445 ft³ (US). Omni is about 3% low.

## Where they beat us
- **Brock prints drying-floor capacity per model.** Each bin has "Capacity with Drying or Aeration Floor (Bushels) Low Floor / High Floor" next to maximum capacity. Our page has one floor-height input but no "what you lose to the floor" line.
- **ToolGrit covers what happens after the bushels:** headspace for aeration and safety, auger fill and unload hours, and fan CFM per bushel. Our page stops at bushels and dollars, and it does not hand off to storage cost (Sell now or store).
- **UNL frames the farmer's real October question:** "how much capacity is remaining" in a partly filled bin. Our depth slider gives the bushels in the bin, but there is no "room left" figure, and no "measured down from the eave" input (what a farmer actually tapes from the roof hatch).

## Math checked by hand (Python, then the live page via Playwright)
| Case | Hand | Page |
|---|---|---|
| 30 x 24 round, peaked, plain (25°, 0 pack) | cyl 16,964.6 + cone 1,648.1 = 18,612.7 ft³ x 0.8036 = 14,957 | 14,957 bu, 16,965 / +1,648 / 18,613 ft³ |
| Same, TW 54, 20% to 15.5%, 1.3/pt, $4.00, $0.04/pt | market 14,957 x 54/56 = 14,423; shrink 5.85% (water 4.5x100/84.5 = 5.33%, handling 0.52%); dry 13,579; value $54,317; drying 4.5 x 0.04 x 14,423 = $2,596; net $51,721 | identical on every row |
| GSI 36 ft, 12 rings, 32 ft 2 in eave, 12 in floor, dealer basis | depth 31.167; cyl 31,724 + cone (18 tan 28° = 9.571 ft) 3,247 = 34,971 ft³ x 0.8036 x 1.06 = 29,789; GSI chart 29,404 (+1.3%) | 29,789 bu |
| FAQ: 48 ft, 11 rings of 32 in, dealer basis | 29.333 ft: 53,080 + 7,697 = 60,777 ft³ x 0.8518 = 51,771, "about 51,800"; Brock 11-ring narrow (7-04811) 51,241 at 29'6" | text matches |
| FAQ: 13 rings 32 in or 10 rings 44 in level, no pack | 50,408 and 53,317 bu (both ≥ 50,000; one ring fewer gives 46,531 and 47,985, short) | text matches |

## Bugs found
| # | Finding | Severity |
|---|---|---|
| G1 | The dealer check table and Sources still say "Brock 48 ft, 8 rings (unverified)" and "not checked against the chart itself". The Oct 16 copy of BR-2286 confirms it: narrow corrugation model **7-04808, 8 rings, 39,053 bu, eave 21'-6"**. The row is right; only the "unverified" label is now out of date. | Low (sourcing) |
| G2 | The same Brock row uses the full 21'6" eave (39,697, +1.6%). Brock's footnote says its peak starts "one inch (25 mm) below the eave"; with that inch the dealer-basis figure is 39,569 (+1.3%). | Low |
| G3 | Hopper edge cases from Oct 15 (M9: an empty-cylinder hopper reads 0; hopper + draw subtracts the full cone) were not rechecked this run. Carried open. | Low |
| OK | Every number above, plus the weight 14,423 x 56 = 807,688 lb, the water-shrink split and drying per wet bushel (fixed since Oct 15), all check. The drying row hides when there are no points to dry; its old value stays only in the hidden row. | |

## The 5 changes, ranked (farmers helped x gap / effort)
1. **"Room left" and "measured from the top" (S).** Add an output line "Room left to the eave / to a full peak: X bu", and an optional input "grain is ___ ft below the eave" that sets the depth. That answers the October question UNL's article is built around, from the bin's own geometry. Honesty risk: low (pure geometry; say "volume, before pack").
2. **Mark Brock verified and cite it (S).** Replace "(unverified)" with "Brock BR-2286 (Jan 2022), narrow corrugation 7-04808, read Oct 16, 2026", take the 1 in below the eave (G2), and cite 7-04811 (51,241 bu) next to the 50,000 bu FAQ. Honesty risk: none; it removes a stale hedge.
3. **Floor and headspace lines (S).** Under the total: "Your aeration floor costs about X bu" (difference with floor 0), and an optional "keep ___ ft of headspace" that trims the peak. Brock prints floor columns and ToolGrit makes the headspace point; we can compute both for any bin. Risk: low; headspace is the user's own number, with no default claimed as a rule.
4. **Hand the bushels to Sell now or store (S).** Add one link that carries market bushels, crop and price to /store-or-sell, so storage months, interest and carry live in one place (Oct 15 M11, still open). Risk: none on this page; store-or-sell's own defaults must stay labeled.
5. **Hopper edge cases (S-M).** Fix G3/M9: count the full hopper cone when the cylinder is empty, use the wedge integral for hopper + draw, and offer a 60° hopper next to 45°. Risk: low.

Budget: none of this needs a data file. The page stays about 85 KB, a single page, not a generated set.

## Verdict
**Yes.** Every competitor that could be read scores 31 or lower. Ours is the only one that explains the dealer's number, prices the grain and cites its constants, and all five hand checks match. The gaps left (room left, floor and headspace, the Brock label) are small.

**Change since Oct 15: 40 → 47 (+7).** Byline and date, dealer-basis toggle, test weight and market bushels, sources, ring heights and per-wet-bushel drying all shipped. Oct 15 competitor scores came from search snippets; today's come from saved copies, so competitor totals are not comparable run to run.
