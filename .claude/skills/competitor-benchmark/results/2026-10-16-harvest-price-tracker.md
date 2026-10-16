# Head to head: agsist.com/harvest-price-tracker, 2026-10-16

Checked Oct 16, 2026 from the checkout (same as origin/main for this page and its data). I rendered harvest-price-tracker.html at 390x844 and 1280x800, opened every section, and drove the guarantee calculator for Iowa and Georgia (200 bu APH, 80%, 500 acres). There was no sideways scroll and no JS errors. harvest-prices.json was updated Oct 15, with Oct 15 marked provisional. The RMA mirror was read Oct 15. The page loads 883 KB, 430 KB of it data/rma-prices.json, which loads before any state is picked.

Competitors were scored only from the Oct 16 copies (references branch). I did not render them, so phone is "?" and their totals are out of 45. Ours without phone is 42/45.

What I could not read:
- **ISU Ag Decision Maker A1-54** (bench-harvest-price-tracker-3) failed with HTTP 403 and has no archived copy.
- **USDA RMA Price Discovery** (-2) was never fetched. It has no entry in index.json; the list marked it a JS app.

Both are "?".

Since Oct 15 the page shipped changes 1, 2 and 3 and fixed W1-W3:
- The H1 now carries the number: "2026 harvest price so far: corn $4.92, soybeans $12.85".
- Each crop card says what the remaining settles would have to average for the harvest price to finish below projected.
- Oct 15 is labeled provisional.
- The note says which days each figure covers.
- "Your agent" is gone.

Not shipped: the chart (change 4).

## Numbers checked by hand
- **Running averages:**
  - Corn: the 11 Dec settles Oct 1-15 sum to 54.12, / 11 = $4.920. The page shows $4.92. OK.
  - Soybeans: 141.36 / 11 = $12.851. The page shows $12.85. OK.
- **Without the provisional Oct 15:** corn is $4.934 and soybeans $12.872. These equal RMA's mirrored $4.93 / $12.87 (through Oct 14). OK.
- **The level that would put harvest under projected:**
  - Corn: (4.62 x 22 - 54.12) / 11 = $4.320. At an exact $4.32 the final rounds to $4.62, not under it, so "$4.31 or less" is right after RMA's cent rounding.
  - Soybeans: (11.09 x 22 - 141.36) / 11 = $9.329. At $9.32 the final rounds to $11.09, so "$9.31 or less" is right. "47¢ under $4.78¼" and "$3.33 under $12.64¼" are OK.
- **Calculator:**
  - Iowa corn: 200 x 0.80 x $4.62 = $739.20, shown as $739. At $4.93: 160 x 4.93 = $788.80, shown as $789, +6.7%, +$49.60 shown as $50. OK.
  - Georgia corn (state projected $4.42, final harvest $4.69): 160 x 4.42 = $707.20, 160 x 4.69 = $750.40, +6.1%. OK.
- **History:**
  - Corn below projected in 2013-19 and 2023-25: 10 of 15.
  - Soybeans below in 2011, 2014-15, 2017-19 and 2022-25: 10 of 15 (2013 equal, not counted).
  - 2012 corn 7.50 / 5.68 = +32%. OK.
- **Against farmdoc's saved copy:** projected prices $4.62 / $11.09 match "The 2026 Projected Price for corn is $4.62 ... soybeans is $11.09".

## Scores (1-5)

| Page | First screen | Current | Accurate/sourced | Local | Clear | Depth | Phone | Trust | Speed | Unique | Total | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **AGSIST /harvest-price-tracker** | 5 | 5 | 5 | 5 | 4 | 5 | 4 | 4 | 4 | 5 | **46/50** (42/45 without phone) | rendered Oct 16 |
| farmdoc daily, impacts of projected vs futures prices (Mar 13) | 2 | 2 | 5 | 2 | 3 | 5 | ? | 5 | 3 | 4 | 31/45 | fetched Oct 16 |
| farmdoc daily, projected prices and volatility factors (Mar 3) | 4 | 2 | 5 | 2 | 4 | 3 | ? | 5 | 3 | 2 | 30/45 | fetched Oct 16 |
| AFBF Market Intel, risk management options for 2026 (Mar 3) | 2 | 2 | 4 | 1 | 3 | 3 | ? | 4 | 3 | 2 | 24/45 | fetched Oct 16 |
| ISU Ag Decision Maker A1-54 | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | not readable (HTTP 403, no archive) |
| USDA RMA Price Discovery | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | not fetched (no copy on references) |

How I scored the competitors:
- **Current:** every readable competitor is a March article. None has a harvest price, running or final.
- **AFBF:** the saved text runs about 220 lines of site menu before the article. It gives the prices as "approximately $4.62 ... $11.09 ... $6.19".

## Where we win
- **The running number in October, and what it would take to lose it.** No saved competitor has any harvest-price figure. farmdoc and AFBF stop at the February projected price. Our page shows the running average with a day count, RMA's own running figure, and what the rest of October would have to average to finish below projected.
- **State by state.** Picking a state changes the crop list, windows and prices: Georgia corn is projected $4.42 and its harvest price is final at $4.69. farmdoc speaks for March 15 sales-closing counties, and its case farm is in Champaign County.
- **The guarantee in dollars.** "$739 /ac ... $789 /ac at the running harvest price of $4.93, up +6.7%, or $50 /ac". Below it, guaranteed bushels for forward sales come with the plain warning that RP covers revenue, not delivery.
- **Honest about provisional figures.** "Oct 15 is Yahoo Finance's close that afternoon ... the next evening's run replaces it with the settle." Competitors give no in-window figure at all.

## Where they beat us, and how
- **Expected indemnity analysis (farmdoc, Mar 13).** farmdoc models expected RP and RP-HPE payments for a case farm as futures move away from the projected price. For example: "RP 85% insurance would be expected to make payments of $18.86/acre ... frequency ... 23.1%". We show the guarantee, not what it is likely to pay. Copying that would mean building a yield-and-price model, which our honest-numbers rule would only allow with a published backtest. I would not chase it; I list it so the gap is on record.
- **Volatility factor and premium context (farmdoc, Mar 3).** farmdoc reports "Volatility Factors ... 0.15 for corn and 0.13 for soybean" and what they do to premiums. We do not show the volatility factor, which is RMA's own published number.
- **Institutional trust.** farmdoc carries five named university authors and a citation line. Our byline is a CCA, and the contact is sig@farmers1st.com, on an insurance topic. The page sells nothing, but the domain reads like an insurance agency.

## Bugs found

| # | Finding | Severity |
|---|---|---|
| H1 | **Two different "running" harvest prices on one page.** The H1 and cards show corn $4.92 (ours, through Oct 15 provisional). The calculator says "at the running harvest price of $4.93" (RMA's mirror, through Oct 14), with no day count. A farmer sees $4.92 and $4.93 a scroll apart. | Low |
| H2 | data/rma-prices.json (430 KB uncompressed) loads on every visit before a state is picked. CLAUDE.md says bulky data loads on demand. GitHub Pages compresses it, so readers feel it less, but it is still the largest file on the page. | Low |
| H3 | The method line says "Sources · CBOT settles", but the newest day is a Yahoo close. The note below says so; the Sources line does not. | Low |

## The 5 changes, ranked
1. **A small chart of the window.** Draw October's daily settles, the running-average line and a flat projected-price line, in inline SVG, from the series already in harvest-prices.json. Mark the provisional day hollow. Why: the "would have to average $4.31" line is easier to grasp when the gap is drawn, and no competitor shows the path. Effort S. Honesty risk none: plotted settles only.
2. **One running number everywhere (H1, H3).** The calculator should use the same running average as the H1, with its day count ("$4.92, Oct 1-15, 11 of 22 days"). Show RMA's figure once, as "RMA official, through Oct 14: $4.93". Why: two numbers for the same thing cost trust. Effort S. Honesty risk none.
3. **Load rma-prices.json only when a state is picked, or split it per state (H2).** Why: it is the CLAUDE.md on-demand rule and halves the page weight for national readers. Effort S-M. Honesty risk none.
4. **The final-price day (Nov 2 for October windows).** Switch each card to "Final harvest price $X (RMA), +Y% vs projected". The calculator should then say "your RP guarantee rose $Z/ac; RP-HPE and YP stayed at projected". Add 2026 to the 15-year table and recount "below projected in N of 16". Why: the page has to keep working the week farmers look up their final number. Effort S. Honesty risk: use RMA's posted final only, never our own average labeled as final.
5. **Show RMA's volatility factor and a neutral contact.** Add the 2026 volatility factors (RMA published, dated) under the projected price, with one line on what they do to premium. Sig decides on a contact address that is not the insurance agency domain. Why: this closes farmdoc's context gap and the trust gap without modelling. Effort S. Honesty risk: low if only RMA's number is printed. The address change needs Sig's call (standing decisions keep ownership disclosures as they are).

## Verdict
**Best on the internet today? Yes, for corn and soybean farmers in October.** It is the only page among the saved competitors with any 2026 harvest price, and it shows the running figure, RMA's own figure, state windows, guarantee dollars and the arithmetic of what it would take to finish under projected. Every number I checked by hand matches. The caveats: RMA's own tool and ISU AgDM could not be read this run, and farmdoc's expected-indemnity work is deeper on a question we deliberately do not model.

**Change since Oct 15: 45 → 46 (+1).** Accurate went from 4 to 5 (the provisional settle is labeled and the coverage note fixed). Trust stays at 4 (the agent wording is gone, but the contact domain remains).
