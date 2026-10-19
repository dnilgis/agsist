# AGSIST standing decisions (as of Oct 16, 2026)

This file is public (the repo and GitHub Pages serve it). Keep anything private out.

These are decisions Sig has made. Any session working on agsist.com, dnilgis/bids or Flash Grain follows them until Sig changes them.

## Voice and honesty
- Copy reads like Sig wrote it: plain, short, a little dry. No em dashes. No AI-sounding phrases.
- Honest numbers only. Anything derived is labeled and sourced. Nothing invented. A missing number stays missing.
- Byline: "Sigurd Lindquist, Certified Crop Adviser (CCA)". Never "crop insurance agent".
- Subscriber emails never go into logs, files or chat. Counts only.

## Business lines
- No consulting. No building websites for elevators.
- No affiliate gear page. No sponsored ARC/PLC reminder emails.
- No ads for Sig's own businesses (Farmers First, Loke Drone). Ownership disclosures stay where they are.

## Sponsors
- Say "Sponsor", never "founding".
- Sponsor terms and prices stay as they are unless Sig changes them.
- Unsold slots show nothing. No open-slot counters. The sponsor page uses national numbers.
- PRF state sponsor slots:
  - every /prf/<state> page offers one
  - the price is on request, never printed and never suggested
  - prepaid, with placement guaranteed through Dec 31 and first say on renewing
  - kept out of /sponsor-apply and data/sponsor-slots.json
  - Farmers First never appears in a slot
- The PRF sponsor button emails sig@farmers1st.com until Sig picks a separate ad inbox.

## PRF
- The page stays neutral. No lead capture, no routing to an agent, no "best" months or coverage, no return-per-premium-dollar pitch.
- No tracking leads and no commission sharing.
- USDA practice code 002 = Irrigated; 003 = Non-Irrigated.

## Rain Print
- Products:
  - Sizes: 12 x 18 only, printed by Sig himself (never name the printer on the page; Sig will upgrade it when orders come, 2026-10-13).
  - Prices: digital $19, print $45, framed $89 (black stock frame, real glass front, padded well; Sig chose glass over acrylic 2026-10-13).
  - No store names on the page.
- (Superseded Oct 13: Rain Print is in the menu and footer and promote is on; see the Oct 13 line below.)
- The QR maker's mark is square to the page.
- Business orders: see the Oct 13 delivered tiers below (they replace the old min-10 / percent-off / per-print shipping rules). Christmas cutoff for business orders: Nov 20.
- Gift notes are free. No prices go in the box.
- Serial under the QR on physical prints only: "No. 0001" (Sig initials each print by hand in pencil, Oct 15), one running count forever starting at 0001, never reused (a reprint keeps its number). No serial on the digital file. QR to become a short-link 25x25 code, muted, about 0.85 in (pending design pick).

## Barchart
- The Barchart feed is off. Sig handles the cancellation.

## Engineering
- Commit as dnilgis <dnilgis@gmail.com>. Plain messages, no AI mentions, no Co-Authored-By.
- Never weaken a test. Never run sender scripts. No git stash. Never run scripts with --help.
- Follow CLAUDE.md: GitHub Pages has a 1 GB limit, and no page in a generated set may go over 150 KB. Bulky content loads from data on demand.
- Merges to main are authorized. Work happens on a claude/ branch, then goes to main.

## Working style
- When Sig pastes a thought or comment mid-work, keep working and fold it in. Stop only when he asks to stop and talk.

## Rain Print designs (Oct 13)
- R1 "Staircase" and R2 "Roots" both sell as style options (4.5 each). R3 dropped (1).
- Snow days draw above the line only. Optional 30-year monthly normals on both. Records layer adds coldest/hottest day and other remarkable events as opt-in overlays.

## Rain Print decisions (Oct 13, Sig)
- Retail $19 / $45 / $89 include US shipping.
- Business, delivered: 5-9 retail; 10-24 $40/$79; 25-49 $37/$75; 50-100 $35/$72; $3/$6 off each when all ship to one address. Minimum 5. Over 100: ask Sig.
- No "Compliments of" on the print; note card in the box is fine.
- No mats yet. Print on archival paper, but never claim the print is archival. Ship flat between chipboard.
- No order cap; Sig gets help if volume comes.
- Current-year prints ship in January once the full year is in.
- Invoice net 30, W-9 on request, one proof sheet per business order.
- Oct 13: Sig: Rain Print AND rain gauge waitlist go live in menus now, with tasteful cross-promotion (max one per page, after main content). promote:true. Orders run as requests until Stripe links arrive.
- Snow is drawn above the line only in both styles (Staircase and Roots), never below the zero line; rain and snow must be clearly distinguishable at a glance (Sig, 2026-10-13).
- (2026-10-14) Ships within 3 business days of the proof OK (was 7). Christmas cutoffs follow from it (about Dec 10 print, Dec 9 framed). Framed target cost: print+frame+packing+shipping under about $45 at the $89 price (Sig aims to double his money); revisit price only after a few real orders.
- (Oct 16) Rain Print reaches Canada (metric, French, Environment and Climate Change Canada data, credited), and stops there: no other countries. Canadians must be able to buy prints and framed prints, not only the digital file; Canadian shipping price is Sig's call before it switches on. Focus is the best possible product, not more markets.
- (2026-10-14) Rain gauge: manufacturing this winter, available before planting 2027. First batch priced barely over Sig's cost, as a thank-you to people who try it early (no price printed until Sig sets one; never 'founding'). Good-faith lifetime warranty: as long as Sig is alive and the business is running, if it breaks he fixes or replaces it. Build details stay private (see briefs/gauge-vision.md).
- (Oct 14) Gauge design stays private: /gauge-lab and the reader files removed from the site; never publish reading method, strip or ratio.
- (Oct 14) Gauge waitlist: first-batch price honored for everyone on the list.
- (Oct 14) Business logo: name stays off the print; a logo can go on, small next to the name, if they upload one.
- (Oct 14) Lost/damaged in shipping: reprint for $15.
- (Oct 14) Ships to all 50 states incl. Alaska and Hawaii; Christmas dates apply there. Puerto Rico undecided.
- (Oct 14) The QR on any preview (page, up-close view, preview download, gift card, wall shots) is one standard QR to https://agsist.com/rain-print (same for everyone, no short link minted); the print's own short-link QR only on files made after payment (maker print/digital files). Sig's test prints and mockups use the standard one.
- (Oct 14) Rain Print flow approved: three steps (town+year / your words / pick one and check out), Framed $89 preselected, one picker, sticky phone bar, business folded to one card.
- (Oct 14) Example words are gray placeholder hints only, never pre-filled on a buyer's print (example guard no longer needed).
- (Oct 14) Stripe checkout in the same tab; Payment Links redirect back to a "Paid, thank you" view (Sig sets the redirect in each link).
- (Oct 14) Manure value: show the value of ALL the nutrients in the manure (N, P2O5, K2O at today's prices), period. No buyer-needs / seller-uses boxes, no selling/buying split, no 'fair range' from soil tests.
- (Oct 15) Rain Print station pick: prefer the nearest station with a full record of BOTH rain and snowfall, even a few miles farther, over a closer rain-only gauge (CoCoRaHS often lacks snowfall).
- (Oct 15) No sponsor on Rain Print, gift card or rain gauge pages (test/rain-no-sponsor.test.mjs).

## 2026-10-15 (Sig, after the head-to-head builds)
- Cash bids "basis since June" history: show the pre-Oct-11 history (it partly came from the Barchart feed). Sig: "yes show it".
- ARC/PLC election line: corrected Oct 15 (FSA says elect at the county office; Login.gov only views base acre notices). Old claim was false.
- Rain gauge page: no "First shown here on ..." dateline (Sig: "kinda lame"). datePublished stays in JSON-LD only.
- EMC calculator (Oct 15): credit "Zach A." by name (stamp under byline, "Zach's window" best-window card, bottom credit line). Nothing else about him anywhere.
- LRP optimizer: start only AFTER the EMC calculator ships, is audited (panel), benchmarked and fully tested. Sig: "no stone unturned" on EMC first.

## 2026-10-15 / 16 (Sig)
- Commits stay as dnilgis <dnilgis@gmail.com>, even if a hook asks for another author.
- Rain Print opens with the 30-year normals AND remarkable days on for every new visitor and every hand-written link (story links, county pages, emails). Tool-made links and d= codes open exactly as made.
- Fertilizer: Sig's hand-typed dealer sheet is gone for good. Every fertilizer price on the site comes ONLY from the co-ops in scripts/coop_fert_sources.json (4 Kansas co-ops Sig sent), read each weekday. No USDA blending, no USDA Illinois box on /fertilizer, no co-op discovery crawler. More sources come from links Sig sends (reminder set for the week of Oct 19).
- One shared price file (data/fertilizer-prices.json); no page may type its own fertilizer price (test/fert-price-guard.test.mjs).
- (Oct 16, Sig) A co-op's emailed price sheet is entered as that co-op's posted prices (scripts/coop_fert_sources.json, layout sheet), like any co-op; no separate booking box.
- Harvest price tracker lives under Markets as "Harvest price tracker".
- LRP: calculator first on /lrp; stats and tests on /lrp/record. Sells nothing, never routes to agents. 25,000 head limit counts every endorsement together (each class its own 25,000).
- Stripe: payment-link redirects, shipping, glass description and descriptor done (Oct 15). Still open: STRIPE_READ_KEY secret and an 85-cent test order (refund returns the $19 minus Stripe's fee).
- (Oct 16, Sig) Byline reads 'Sigurd Lindquist, CCA' everywhere on the site; structured data jobTitle keeps the full credential.

## 2026-10-17 (Sig)
- Homepage: no byline line in the hero band (Sig: "i dont like highlighted text"). test/home-to50.test.mjs.
- Cash Bid Index: monthly page /cash-bid-index, scheduled run on the 1st of each month (approved). No reporter email drafts, ever.
- Elevator widgets: on hold.
- land-data.yml monthly schedule: NOT approved yet (proposed the 3rd); runs by hand only.
- Rain Print size: printed on 13 x 19 paper, untrimmed. Framed = 13 x 19 black frame, real glass front, small white mat (11 x 17 mat). All art text and the code stay inside the mat window. Unframed ships as the 13 x 19 sheet.
- Rain Print box letter: one letter-size page on top in every print/framed box. The buyer's gift note and a business's message print on the letter; no separate note card. No prices in the box.
- Rain Print paper: Sig wants heavy, textured paper (testing Epson Velvet Fine Art on his own printer). Site paper wording changes only once he picks. Never name the printer on the site.
- FFAI (farmers1st): Sig approved the audit fixes: price-position labels vs 1995-2019 instead of STRESSED/STRONG, year-ago comparison first, v3 JSON marked retired, in-sample quarters marked, stricter NASS parse, stress run.
- (Oct 17, Sig) Radar rain at any address (NOAA MRMS, 24 h / 3 day / 7 day): approved to run a few times a day on its own schedule.
- (Oct 17, Sig) Wisconsin transfer data: OK to fetch with an automated browser from DOR's public pages. Minnesota eCRV extract: Sig emails ecrv.support@state.mn.us.
- (Oct 17, Sig) Oct 16 Daily correction added (expired hogs, afternoon trades). FFAI audit fixes pushed live on farmers1st.
- (Oct 17, Sig) Rain Print Staircase default becomes "A2 clean" (typographer list, warm stone fill #ECE6DE, big year, heavier line, word-only line ends, "short" bracket). Plain italic dedication in both styles.
- (Oct 17, Sig) New Rain Print options: crop overlay (corn, soybeans, sunflowers if a cited GDD stage source exists) placed by the station's real GDUs; plant drawings are their own toggle; plants stand on the horizontal axis / ground line like the soil surface, in both styles; optional usual-year ghost plants from 30-year normals.
- (Oct 17, Sig) "Every year behind your year" history threads: an option, with the 2 wettest and 2 driest years subtly labeled.
- (Oct 17, Sig) Box letter stays as today ("What you're holding" first). Family code: not decided.
- (Oct 17, Sig) Radar rain: coarser grid (about 2 to 3 mi), 4 runs a day. Off-repo data hosting tabled for another day (repo is 1.38 GB; bids churn is the main growth).
- (Oct 17, Sig) land-data monthly run approved: the 3rd of each month (Illinois MyDec, Wisconsin RETR newest months, parcel probe).
- (Oct 17, Sig) No "Gifts" menu group for now.
- (Oct 17, Sig) Farmland Atlas gets recorded farm sales (IL, WI) with unusually large sales noted; no buyer or seller names on indexed atlas pages.
- (Oct 17, Sig) Daily briefing gets a second, stronger fact-check pass (newest strongest model) that can block the send. New daily-site-check.yml approved: once a day, runs the number check and staleness checks, keeps one GitHub issue "Daily site check" updated.
- (Oct 17, Sig) PRF "this interval so far" (NCEI nClimGrid, RMA's source) approved to run daily at 14:23 UTC.
- (Oct 17, Sig) Daily briefing fact check: Opus 5.5, report-only for a week (review Oct 24), then decide on block.
- (Oct 17, Sig) Rain Print serials: No. 0000 is Sig's own test prints (?maker=1&serial=0, real QR); orders count from 1; No. 0001 is his wife's.
- (Oct 17, Sig) The box letter carries a discount code for the next print; off until Sig sets the Stripe code (data/rain-print.json letter_offer).
- (Oct 17, Sig) More email signups wherever a reader has a reason to want an email; every ask must have a real sender.
- (Oct 17, Sig) Bid boards skipped on a pass count for 6 h after their last good read, everywhere (pages, ZIP search, homepage card).
- (Oct 17, Sig) The bids repo is attached to Claude Code sessions; fixes there are fine to push (npm test first, author dnilgis).
- (Oct 18, Sig) Rain Print: shipping damage or loss replaced free, same serial; phone 715-797-2428 on Rain Print and business pages;
  email stays sig@farmers1st.com; paper is heavy textured cotton fine-art paper (no brand on the site; dye inks, no archival claim);
  framed prints get a white mat (mats arrive Mon Oct 19); Stripe address field stays on; prices unchanged this Christmas; business
  sample = order one at regular price, credited on 10+; footer Sponsor link hidden on Rain Print pages.
- (Oct 18, Sig) Menu: full redesign approved (Prices | Livestock | Field | Money & Land | Daily, ZIP chip, signup footer, Bids by state
  page). Phone bottom bar and footer state links deferred.
- (Oct 18, Sig) Spend the expiring API credits: stories for PRF/Atlas/town/co-op pages, accuracy passes (top pages and every set),
  elevator website classifier for bids coverage, tool FAQ gaps, first-time visitor read. Monthly story refreshes are OK.
- (Oct 18, Sig) Indiana land sales (STATS Indiana sales disclosure) go live with names in Field Scout and the comp report, like IL and WI: public record. Never on indexed pages.
- (Oct 18, Sig) No name at the top of any page. The name goes in one quiet "Made by Sigurd Lindquist, CCA, Chetek, Wisconsin."
  line at the end (class by-end) or a source note lower down; structured data keeps the author (test/byline-bottom.test.mjs).
- (Oct 18, Sig) Footer bottom line: "Updated as each source posts. For information, not financial advice. Where the numbers come from".
- (Oct 18, Sig) Net elevator price tool: not yet.
- (Oct 18, Sig) Sponsors on land pages: any sponsor is OK, realtors included ("Sponsor" label, unsold shows nothing).
- (Oct 18, Sig) Paid tools: undecided; build free first. Owner contact exports and a hay listings board: open questions (see the opportunity map doc).
- (Oct 18, Sig) Owner names, middle ground: one parcel's owner shows on click as today; no bulk owner or contact lists for anyone (energy agents included). Screening reports carry no names and link to the county's own owner lookup.
- (Oct 18, Sig) Hay listing board: build it (readers post hay for sale or wanted; no cut, no routing, contacts never in the page HTML or feed).
- (Oct 18, Sig) Net price tool: wait.
- (Oct 18, Sig) PRF state sponsor slots: crop insurance agencies may sponsor (labeled "Sponsor"; Farmers First still never takes a slot; no lead capture or routing).
- (Oct 18, Sig) PRF month picker ("What the numbers would pick") stays as is, button included. Sig: publishing what the numbers say about the best months is just math. This replaces "no best months" for the picker: a pick may be shown, always beside its own out-of-sample record (how often it beat an even spread); "stands out" only when a real significance test says so, outlook included.
