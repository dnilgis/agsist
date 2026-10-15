# Head to head: agsist.com/conditions-yield ("2026 crop size: every forecast")

Checked Oct 15, 2026, from the read-only checkout. I rendered conditions-yield.html at 390x844 and 1280x800. No sideways scroll, no JS errors, about 155-210 KB loaded. The nowcast is from ratings for the week ending Oct 4, generated Oct 13 10:36 UTC.

**What I could not see:** I could not open any competitor host (DNS refusal). Competitor cells are from search-result text and are marked *.

## Numbers checked by hand
- **Corn forecasts low to high:** 173.2 (Pro Farmer), 178.5 (DTN), 180.6 (ours), 181.2 (USDA).
  - Ours is "3 of 4", and 180.6 - 173.2 = **7.4** over the lowest. The full spread is 181.2 - 173.2 = **8.0**.
  - All match.
- **Soybeans:** 52.1 / 53.1 / 53.3 / 53.5. Ours is the highest, and 53.5 - 52.1 = **1.4**. Match.
- **Bands:** 180.6 ± 6.9 = 173.7-187.5, and 53.5 ± 2.4 = 51.1-55.9. Match.
- **Gaps to trend:**
  - "8.1 below our trend": 188.7 - 180.6. Matches.
  - "2.4 below USDA's 183.0 trend": matches.
  - I refit the 2010-2025 USDA finals and got 188.7, so the trend line is right and labeled right here.
- **Skill:** 1 - 4.2 / 5.5 = 24% for corn, and 1 - 1.3 / 2.4 = 46% for soybeans. Match.
- **On the record:** graded calls are Oct beans right, Oct corn right, Sep beans right, Sep corn wrong, Aug beans wrong, Aug corn wrong, so **3 of 6**. Matches.
- **Pro Farmer 173.2 corn and 53.3 soybeans:** confirmed in search snippets* (Pro Farmer release: 15.344 B bu corn, 4.572 B soybeans).
- **No errors.**
- **Timing note (low):** the Oct 13 run used ratings for the week ending Oct 4. Columbus Day pushed Crop Progress to Tuesday afternoon, after the run. The page says which week it uses, so this is not hidden. A rerun the day after a holiday release would keep it current.

## Scores (1-5)

| Page | First screen | Current | Accurate/sourced | Local | Clear | Depth | Phone | Trust | Speed | Unique | Total |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **AGSIST /conditions-yield** | 5 | 4 | 5 | 2 | 4 | 5 | 4 | 5 | 4 | 5 | **43** |
| USDA NASS Crop Production / WASDE* | 3 | 5 | 5 | 3 | 2 | 4 | 2 | 5 | 3 | 3 | 35 |
| Pro Farmer / AgWeb Crop Tour coverage* | 4 | 4 | 4 | 2 | 3 | 4 | 3 | 3 | 2 | 3 | 32 |
| StoneX monthly US yield estimate (via Reuters)* | 3 | 4 | 3 | 1 | 4 | 2 | 3 | 3 | 3 | 3 | 29 |
| Academic accuracy studies (farmdoc / Irwin et al.)* | 2 | 2 | 5 | 1 | 2 | 4 | 2 | 5 | 3 | 3 | 29 |

\* from search snippets only; not opened. Snippet facts used:
- StoneX lowered its 2026 corn yield to 182.1 from 182.9 (September), with 184.8 in August. The Reuters item is undated, so the October date is not confirmed.
- Irwin et al. found USDA most accurate for corn in all periods but August, and private firms most accurate for soybeans in August and September.

## Where we win
- **It is the only page I found that lines up every public 2026 yield forecast with its date and source,** puts our own model among them, and refuses to score anyone until the January final.
- **Our own record is printed, misses included.** It shows 3 of 6, two calls on a defective input "graded as called", and superseded locks shown rather than dropped.
- **Two trends shown side by side** (our straight line and USDA's weather-adjusted 183.0), with the reason they differ.

## Where a competitor beats us, and how
- **Coverage of private forecasts.** StoneX publishes a monthly yield (182.1 corn per snippets*), and the page has no StoneX line. AGSIST already tracks StoneX (Arlan Suderman) in data/analyst-estimates.json for report estimates.
- **Local.** USDA publishes state yields monthly. The page's own state research is further down, but there is no "your state" forecast table at the top.
- **The pre-report trade average.** Reuters and Bloomberg publish the average of analyst yield estimates before each WASDE. AGSIST shows that average on /whats-priced-in but not on this line-up.

## Five changes, ranked by impact
1. **Add StoneX (and any other firm with a public, dated yield) to the line-up (S).** Use a source link and date, kept in the existing hand-maintained file. The 182.1 figure must be confirmed at a primary source first, not taken from the snippet.
2. **Add the pre-WASDE trade average as one row (S),** read from the file /whats-priced-in already uses, so the two pages cannot disagree.
3. **A "your state" row set (M):** USDA's state yield, our state fit and the tour's state sample where it exists. Load per state from data on demand.
4. **Rerun the nowcast after a holiday-delayed Crop Progress (S).** Schedule a Wednesday run when Monday is a federal holiday.
5. **A "who was closest" table after January (M),** using the same rules as the crop-tour page's record. Promise it on the page now, with the date it will post.

## Verdict
Best on the internet today? **Yes, on substance.** I found no other page that puts every dated public forecast, a backtested model and its own graded record in one place, and every number I checked is right. Adding StoneX and the trade average would make the "every forecast" claim fully true.
