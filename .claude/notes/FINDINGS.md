# Findings log

One row per audit finding, newest first. Written by the audit-loop skill (.claude/skills/audit-loop/SKILL.md).
Public file: no names of people, no emails; business names are fine. Verdict: fixed (commit) / Sig decides /
Sig decided: <what> / refuted: <why> / open.

| Date | Area | Finding | Verdict | Reach |
| --- | --- | --- | --- | --- |
| 2026-10-19 | Rain Print | Maker saved a numbered print/digital file without the usual-year line when NOAA's normal failed or took over 15 s; page said "no NOAA normal" | fixed (batch 7): order and files blocked, "didn't load, press Draw again" | /rain-print |
| 2026-10-19 | Rain Print | Morning email named NEXTPRINT orders by amount_total (no product) and skipped paid sessions with no design reference | fixed | morning email |
| 2026-10-19 | Rain Print | Letter said "$10 off" but the coupon covers print and framed only | fixed: "a print or framed print" | box letter |
| 2026-10-19 | Rain Print | Gift "ships in January" can slip to early Feb; AK/HI transit; buyer "First frost" label vs auto mark | Sig decides | |
| 2026-10-19 | Accessibility | Cash bids basis stronger/weaker by color only (1.02:1 light); fixed 17px base ignored larger fonts; gold buttons 3.55:1; --blue no light value; orange note 2.38:1; unnamed checkboxes, unreachable scroll tables; zero change green | fixed (batch 7) | site-wide |
| 2026-10-19 | Accessibility | Link underlines in source notes, small-type floor, breadcrumb padding | Sig decides | |
| 2026-10-19 | Signups | Cattle futures form swallowed errors, no source or ZIP; duplicate asks on tariffs and COT; Atlas watch said "up to 5 counties" for every 429 | fixed (batch 6) | 3 pages + 3,148 Atlas pages |
| 2026-10-19 | Signups | "Every weekday" in 25 places but the Daily sends daily; "by 6am CT" missed 13 of 28 Sep 20-Oct 18 | Sig decides wording | site-wide |
| 2026-10-19 | Signups | PRF and county rain asks pre-tick the Daily box | Sig decides | /prf, rain/ |
| 2026-10-19 | Phone | Location requested about 1 s after load with no tap on /, /cash-bids, corn, cattle, fertilizer, spray | Sig decides (built on purpose in May) | about 5,000 views/month |
| 2026-10-19 | Phone | Futures pages layout shift 0.19-0.22 (seed note hidden; new-crop seed picked the wrong contract) | fixed: under 0.01 | 3 pages |
| 2026-10-19 | Phone | Atlas headline irrigated rent tile showed 2009-2022 rents with no age rule | fixed: n/a past three survey years, 314 pages; dry rent tile same issue (Sig decides) | farmland-atlas/ |
| 2026-10-19 | Phone | Shared Rain Print link opens below the fold; Atlas leads with census value over recorded sales | Sig decides | /rain-print, farmland-atlas/ |
| 2026-10-19 | Phone | "Last trade 12:45 am" with no day | refuted: the stamp adds the date when not today | |
| 2026-10-19 | Breakeven | Corn N default 213 lb/ac (unsourced 0.90 lb/bu) vs cited A2809 120 after soybeans; +$62/ac, +26c/bu | fixed (fx/nightmoney, batch 5): 120 lb, $4.92 to $4.58 | /breakeven |
| 2026-10-19 | ARC/PLC | 2026 expected dollars rested on corn's price spread for 21 other crops (about 3/4 of Sumner KS wheat's $6.76) | fixed: withheld with reason, 2,570 pages | arc-plc/ |
| 2026-10-19 | ARC/PLC | Sequestration "before the limit" stated as fact; payment limit "not out" | fixed: order clause removed; "$164,000 by the rule's own method" | /arc-plc |
| 2026-10-19 | Custom rates / rent | NE irrigated row in comparison; MO labeled 2023 with 2022 rates; IA median change read as typical county | fixed | custom-rates, cash-rent |
| 2026-10-19 | CCC loan | No interest rate until Nov 1; FSA unreachable from runners | Sig: browser check | /commodity-loan |
| 2026-10-19 | llms.txt / AI | Called Sig a crop insurance agent; false licensed-feed line; town and rain sets missing; --check blind to them | fixed (fx/nightseo) | llms.txt |
| 2026-10-19 | Futures pages | "Refreshed in session" over Friday settles on a Sunday | fixed: "Settle Oct 16" | 3 pages |
| 2026-10-19 | Homepage / fertilizer | Prices JS-only, empty for crawlers | Sig decides (seed dated settles) | 2 pages |
| 2026-10-19 | SEO | Fertilizer title lost "Prices"; county sets never linked to the same county's rain page; /test/ fixtures served; caps differ by builder; 34 JSON-LD names stale | fixed | about 12,800 pages |
| 2026-10-19 | SEO | USDA calendar title overridden by Crop Production branch 6 months a year | Sig decides | /usda-calendar |
| 2026-10-19 | SEO | Hidden "$29/mo" sponsor text read by crawlers on 77 pages | Sig decides | 77 pages |
| 2026-10-19 | SEO | PRF pages templated; SEO report missing | refuted: county stories already there; report removed on purpose Oct 12 | |
| 2026-10-19 | Atlas reads | 535 stored map reads stated trends whose range crosses zero (Adams CO "falling 2.3 bu a year") | fixed: significance gate in stories_core, reads marked for recheck; 738 other reads fail page checks (open) | /farmland-atlas |
| 2026-10-19 | Traffic | Two GA4 files disagree 9,493 vs 5,848: different filters (country, server towns, path folding), not a bug | explained (fx/returns) | |
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
| 2026-10-19 | Flash Grain (flshgrn.com) | Fall rows on contracts that expire before the row does (Nov 26 beans FND Oct 30, LTD Nov 13; Dec corn LTD Dec 14), nothing rolled or dashed them | fixed: data/cbot.json calendar, dash + off feed after LTD, admin roll card (Jeff confirms) | every visitor, bids feed |
| 2026-10-19 | Flash Grain | futures_source said "dtn" for backup prices; 15% check compared backup to itself; quote_time null since DTN dropped cell titles | fixed: per-contract sources, cents band, quote_time from DTN stamp or run time | latent (DTN answering) |
| 2026-10-19 | Flash Grain | CBOT holidays and early closes not modelled (live dot on Thanksgiving) | fixed (CME rule dates; Nov 27 12:05, Dec 24, Juneteenth to confirm on CME) | site + harvester |
| 2026-10-19 | Flash Grain | feed stayed "ok" in bids up to 14 h while the page withholds at 2 h | fixed in bids: per-source maxAgeH 2 (branch, Sig OK'd the policy) | bids feed |
| 2026-10-19 | Flash Grain | bolt ignored reduced motion; CLS 0.058 / 0.175; JS-off "Loading" forever; weather strip not keyboard reachable; no CT on times; futures hidden under 400 px; no CSP on public pages | fixed (axe 0 at 390 and 1280) | public pages |
| 2026-10-19 | Flash Grain admin | native confirm, conflict said "press Load" (hidden), "7-9" read as AM, typo guard skipped new months, raw 401 text, no draft, no undo, nearby bids far from inputs | fixed (review sheet, merge-on-conflict, hours ask, draft, undo, roll card); morning edit 4 taps to 3 | Jeff |
| 2026-10-19 | Flash Grain | "page reloads when tab returns"; cron-job.org token too broad | refuted: only JSON refetch; Actions write is the minimum for dispatch | |
| 2026-10-19 | Flash Grain discounts | range edges (15.0, 54.0, 3.0, 1.0), "< 15.0 $0.16" wording, soy 18% vs 16% | Sig: leave as is | discounts.html |
