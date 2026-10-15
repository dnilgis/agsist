# Head to head: agsist.com/storage-crunch (now /basis#storage, "Why basis is wide this fall")

Checked Oct 15, 2026, from the read-only checkout. storage-crunch.html redirects to /basis#storage, and the section opens itself on that hash. I rendered basis.html#storage at 390x844 and 1280x800. No sideways scroll on the page and no JS errors. On a phone the table's last two columns (2026 fall crop and capacity) sit off to the right inside a scroll box. The basis page as a whole has its own report (2026-10-15-basis.md). This one scores only the storage section.

**What I could not see:** I could not open farmdoc or any competitor host (DNS refusal). Competitor cells are from search-result text and are marked *.

## Numbers checked by hand (ratio = (Sept 1 stocks + 2026 fall crop) / capacity)
- Missouri: (99 + 910) / 860 = **1.17**. SD: (243 + 1,120) / 1,200 = **1.14**. NE: (315 + 2,133) / 2,170 = **1.13**. OH: (185 + 952) / 1,035 = **1.10**.
- Indiana: 1,537 / 1,410 = **1.09**. Iowa: 3,893 / 3,590 = **1.08**. IL: 3,335 / 3,170 = **1.05**. MI: 566 / 540 = **1.05**.
- MN: 2,352 / 2,370 = **0.99**. KS: 1,564 / 1,605 = **0.97**. ND: 1,201 / 1,390 = **0.86**.
- **"8 of 11 over 1.00x":** 8 states are over. Correct.
- Iowa fall crop: 2,803 corn + 613 soybeans = 3,416. Illinois: 2,278 + 709 = 2,987. Ohio: 646 + 306 = 952. All match data/state-stats.json (Oct NASS forecast).
- Capacity: IA 3.59 B, IL 3.17 B, MN 2.37 B, NE 2.17 B. These match farmdoc's Dec 2025 state capacities as reported (about 3.6, 3.2, 2.4, 2.2).*
- **Wisconsin is left out (low).** Wisconsin's file (data/storage/storage.json) has no Sept 1 wheat stocks, so the state gets no ratio. But without wheat its known grain is 106 + 11 + 7 + 564 + 120 = 808 M bu against 780 M capacity, already **at least 1.04x**. A missing crop can only push that up. The exclusion is honest, but it hides a state that is crowded on the numbers it has.
- **Framing issue (medium):**
  - The section is titled "Why basis is wide this fall: more grain than bins" and says it uses the "same measure as farmdoc daily (Dhakal and Janzen, Oct 7, 2026)".
  - That farmdoc article finds carry-in plus production is over capacity in most Corn Belt states. That agrees with our 8 of 11. But its conclusion is that "a storage crunch is unlikely this year", because the system has historically cleared the pressure between September and December.*
  - Our page cites the method but leaves out the conclusion. A farmer could read "1.08x" as "Iowa has no room", which the source says is unlikely.

## Scores (1-5)

| Page | First screen | Current | Accurate/sourced | Local | Clear | Depth | Phone | Trust | Speed | Unique | Total |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **AGSIST storage section (/basis#storage)** | 4 | 5 | 4 | 3 | 4 | 3 | 3 | 4 | 4 | 4 | **38** |
| farmdoc daily, "Enough Room for the Harvest?" (Oct 7, 2026)* | 3 | 5 | 5 | 3 | 4 | 5 | 3 | 5 | 3 | 4 | 40 |
| AFBF Market Intel, "Grain storage remains tight"* | 3 | 3 | 4 | 3 | 4 | 3 | 3 | 4 | 4 | 3 | 34 |
| High Plains Journal, "Grain storage capacity bulging with record crop supplies"* | 3 | 3 | 3 | 2 | 3 | 2 | 3 | 3 | 3 | 2 | 27 |

\* from search snippets only; not opened.

## Where we win
- **It updates with every NASS forecast, every state is in one table, and it sits next to the farmer's basis.** farmdoc's article is a fixed date. Ours rebuilds itself (built 2026-10-14 from the Oct 9 forecast).
- **It is open about who is missing and why.** It lists 25 states with no ratio, and it counts wheat once.

## Where farmdoc beats us, and how
- **The conclusion and the history.** farmdoc shows how fast each state has cleared storage pressure from September to December in past years, and concludes this year is manageable.* We give the ratio without that context.
- **Capacity trend.** farmdoc notes slower investment in new bins.* Our data has capacity back to 2000 (storage.json) but the section does not show it.

## Five changes, ranked by impact
1. **Add farmdoc's conclusion and our own past years (S).** For example: "Iowa was 1.0Xx in 20XX too; farmdoc says the system usually clears it by December, and a crunch is unlikely this year." Use the ratio history already in storage.json.
2. **Wisconsin as a lower bound (S).** Show "at least 1.04x (wheat stocks not published)" in place of dropping it. Do the same for any state where only a small crop is missing.
3. **Phone layout (S).** Put state, ratio and a bar on the phone, and show the inputs on tap. The two columns that justify the ratio are now hidden off to the right.
4. **Soften the heading (S).** Use "More grain than bins in 8 of 11 states" in place of "Why basis is wide", unless the basis data on the same page shows those states are actually wide against normal.
5. **Keep the redirect (none).** It works and opens the section.

## Verdict
Best on the internet today? **Close.** It is the only live, every-state version of the farmdoc measure, and every ratio checks out. But it leaves out the source's own conclusion that a crunch is unlikely this year, and that context matters more to a farmer than the third decimal.
