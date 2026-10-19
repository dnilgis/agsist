# Findings log

One row per audit finding, newest first. Written by the audit-loop skill (.claude/skills/audit-loop/SKILL.md).
Public file: no names of people, no emails; business names are fine. Verdict: fixed (commit) / Sig decides /
Sig decided: <what> / refuted: <why> / open.

| Date | Area | Finding | Verdict | Reach |
| --- | --- | --- | --- | --- |
| 2026-10-19 | Harvest price tracker | Panel (farmer, statistician, plain language) done; expert pending. Every number recomputes exactly; issues: closed windows say "if the window closed today", projected price labeled "guarantee", no trigger yield ("will I collect"), county windows skip the exchange-settle swap, hero cards never refresh, three day counts, no print CSS | open (adversary next) | 1 page, Oct traffic peak |
| 2026-10-19 | Farmland Atlas | 10 counties recomputed: all headline numbers, ranks and withholding match raw; small: sheet rounds no-till twice (Barron 31% vs 30%), years-over-premium counted on rounded ratio (Fresno 10 vs 11), tie years, "0%" for nonzero, sheet rank note, decimals | open (adversary) | 2,902 pages, minor |
| 2026-10-19 | Rain pages / Rain Print | All 2,691 county totals recompute with zero mismatches; station pick ignores the both-records rule (about 1,049 northern counties draw no snow), late-Oct missing snowfall wipes winter (Vilas WI 70 in), all-zero snow reads "under 0.1 in", dry-run A-day mismatch, "rain and snow drawn" wording | open (adversary) | about 1,000 county pages, Rain Print buyers |
| 2026-10-19 | Price pages | Homepage ticker badge says "Delayed 15 min" overnight over settled prices incl. livestock; cattle page shows zero change as green up; homepage rows lack per-row dates; markets stamp uses newest date; feeders-oct26 hardcoded | open (adversary) | homepage, cattle page |
| 2026-10-18 | Daily briefing | 18 of 78 claims wrong in 7 issues: livestock session mislabeled (10), export sales Thursday in a holiday week (4), other (3); fact check caught 1 of 1 where it ran | fixed (5d604084b); calendar and homepage strip follow (fx/holidayweek) | every Daily |
| 2026-10-18 | Daily fact check | Trusts the same calendar and timing block the generator uses, so it cannot catch those errors; output was not saved | partly fixed (saved to raw daily-fact-check/); block mode: Sig decides Oct 24 | every Daily |
| 2026-10-18 | Cash bid town pages | Wrong year on multi-month delivery labels (27 pages: Cameron MO, Cortland OH, Newaygo MI, CHS DEC-JAN); Ackley IA headline town; share text class mismatch (36 pages); restricted bid headline (Sheldon WI); state Best wheat uses town-flagged rows; Co-op/Coop key | fixing (fx/cbfix); proposed year guard refuted (would drop 106 real bids), narrowed | 1,627 indexed pages |
| 2026-10-18 | Cash bid town pages | "Today" over Friday prices on most pages | refuted mostly: Sunday, every price says "posted Oct 16"; FAQ wording only | |
| 2026-10-18 | PRF / LRP | County example compares payout to the farmer's share (subsidy gap); "$0.86 per $1"; 2026 index source; LRP lot line uses today's subsidy back to 2013; byline vs agency sponsors | fixing wording (fx/prfwords) | 3,020 county pages |
| 2026-10-18 | PRF month picker | Names months and coverage on expected dollars; lost to even spread in 54% of grid-years | Sig decided: keep, shown with its own record | /prf |
| 2026-10-18 | Land sales / comp report | Split or share deeds counted as whole sales (McLean 5 deeds, Pulaski 9); refiled duplicates; IL sq ft as acres (Kankakee 10,124 ac at $19/ac); improved land in medians (Tippecanoe $23,333 vs $15,843 bare); tiles on 15 listed comps; Field Scout since 2004; 7-county cap; future-dated sales; no $/ac floor | fixed (land rule + fetch fields, Oct 18) | comp report, Field Scout, Atlas IL/WI |
| 2026-10-18 | Comp report privacy | Analytics got full URL with parcel ids and field outlines; failed loads read as false statements; names test missed Indiana | fixed (Oct 18) | |
| 2026-10-18 | Field Scout layers | MN feedlot size field au_count; inactive feedlots counted; NCED needs a token; Overpass at capacity | fixed (Oct 18) | |
